'use strict';
/**
 * server-v2/es-gap-tracker.js
 *
 * In-process overnight ES gap tracker. Runs entirely inside the server (no
 * browser). Posts the day's gap once the 09:30 bar lands, then updates the fill
 * status every 5 minutes during RTH. Mirrors the gates/loop of mvc-auto-snapshot.js.
 *
 * The gap is two EXACT 5-minute ES candle prints (never substituted):
 *   prior_close = close of YESTERDAY's 15:55 bar   (the 16:00:00 ET print)
 *   open_0930   = open  of TODAY's     09:30 bar   (the 09:30:00 ET print)
 *   gap_pts     = open_0930 - prior_close
 *
 * Fill (continuous): price retracing toward prior_close fills the gap.
 *   gap up  (open > close): fills by trading DOWN; pct = (open - min(price,open)) / |gap| * 100
 *   gap down(open < close): fills by trading UP;   pct = (max(price,open) - open) / |gap| * 100
 *   filled=1 the moment price touches prior_close (pct ≥ 100).
 * pct_filled ratchets up and never reverses (enforced in db.updateEsGapFill).
 *
 * If a required bar (15:55 prior day or 09:30 today) is missing, the tracker does
 * NOT post a substituted number — it logs loudly and retries next boundary. Those
 * bars are written every session, so absence means a real feed/DB problem.
 *
 * Reads candles via   GET  /api/snapshots/candles?date=YYYY-MM-DD
 * Posts/updates via    POST /api/es-gap   (action: 'post' | 'fill')
 *
 * Start from server-with-proxy.js after server.listen():
 *   require('./es-gap-tracker').startEsGapTracker(PORT);
 */

const { computeGapFill, extremeToward } = require('../lib/esGapMath.js');

const INTERVAL_MIN = 5;
const SYMBOL = '/ES';

// Server-to-server calls to protected /api/* routes carry the shared token, else
// Clerk middleware redirects to "/" and returns landing HTML.
function internalHeaders(extra = {}) {
  return Object.assign(
    {},
    extra,
    process.env.INTERNAL_API_TOKEN ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {}
  );
}

function nowParts() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

function etDateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((p) => p.type !== 'literal')
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// US equity-market full-day closures (NYSE/Cboe), ET date strings. Kept in sync
// with mvc-auto-snapshot.js — extend before 2028.
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);
const MARKET_HALF_DAYS = new Set(['2026-11-27', '2026-12-24', '2027-11-26']);

/** RTH = Mon–Fri, 09:30–16:00 ET, excluding holidays. Half-days close 13:00 ET. */
function isRTH() {
  const { hour, minute, weekday } = nowParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const today = etDateStr();
  if (MARKET_HOLIDAYS.has(today)) return false;
  const mins = hour * 60 + minute;
  const close = MARKET_HALF_DAYS.has(today) ? 780 : 960;
  return mins >= 570 && mins < close;
}

/** Most recent trading day strictly before `dateStr` (skips weekends + holidays). */
function priorTradingDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  for (let i = 0; i < 10; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const ds = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const dow = d.getUTCDay(); // 0 Sun … 6 Sat
    if (dow === 0 || dow === 6) continue;
    if (MARKET_HOLIDAYS.has(ds)) continue;
    return ds;
  }
  return null;
}

async function fetchCandles(base, date) {
  const res = await fetch(`${base}/api/snapshots/candles?date=${date}&limit=2000`, {
    cache: 'no-store', headers: internalHeaders(),
  });
  if (!res.ok) throw new Error(`/api/snapshots/candles ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.rows) ? json.rows : [];
}

/** Find the bar whose slotKey time is exactly `HH:MM` (e.g. '09:30', '15:55'). */
function barAt(rows, hhmm) {
  return rows.find((r) => String(r.slotKey || '').slice(11) === hhmm) || null;
}

// Tracks whether today's gap is already posted so we don't re-query needlessly.
let _postedDate = null;

async function tick(base) {
  if (!isRTH()) return;
  const today = etDateStr();

  // ── 1. Ensure today's gap is posted (write-once) ──────────────────────────
  if (_postedDate !== today) {
    // Has the server already got a row (e.g. after a restart)? If so, adopt it.
    try {
      const r = await fetch(`${base}/api/es-gap?date=${today}`, { cache: 'no-store', headers: internalHeaders() });
      if (r.ok) {
        const j = await r.json();
        if (j.gap && j.gap.locked) { _postedDate = today; }
      }
    } catch { /* fall through to post attempt */ }
  }

  if (_postedDate !== today) {
    const prevDay = priorTradingDay(today);
    if (!prevDay) { console.warn('[es-gap] could not resolve prior trading day for', today); return; }

    let todayRows, prevRows;
    try {
      [todayRows, prevRows] = await Promise.all([fetchCandles(base, today), fetchCandles(base, prevDay)]);
    } catch (e) {
      console.warn('[es-gap] candle fetch failed — retry next boundary:', e.message);
      return;
    }

    const openBar  = barAt(todayRows, '09:30');
    const closeBar = barAt(prevRows, '15:55');

    if (!openBar) {
      // Expected to exist by 9:35 ET. Loud — a missing 09:30 bar is a real problem.
      console.warn(`[es-gap] MISSING 09:30 bar for ${today} (have ${todayRows.length} bars) — not posting, will retry`);
      return;
    }
    if (!closeBar) {
      console.warn(`[es-gap] MISSING 15:55 bar for prior day ${prevDay} (have ${prevRows.length} bars) — not posting, will retry`);
      return;
    }

    const open_0930   = Number(openBar.open);
    const prior_close = Number(closeBar.close);
    if (!(open_0930 > 0) || !(prior_close > 0)) {
      console.warn(`[es-gap] non-positive prints (open=${open_0930} close=${prior_close}) — not posting, will retry`);
      return;
    }

    const gap_pts = open_0930 - prior_close;
    try {
      const res = await fetch(`${base}/api/es-gap`, {
        method: 'POST',
        headers: internalHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'post', date: today, symbol: SYMBOL,
          prior_close, open_0930, open_ts: Number(openBar.timestamp) || Date.now(),
        }),
      });
      if (!res.ok) { console.warn('[es-gap] post failed:', res.status); return; }
      _postedDate = today;
      const dir = gap_pts > 0 ? 'UP' : gap_pts < 0 ? 'DOWN' : 'FLAT';
      console.log(`[es-gap] ${today} posted — close ${prior_close} → open ${open_0930} · gap ${gap_pts.toFixed(2)} (${dir})`);
    } catch (e) {
      console.warn('[es-gap] post error — retry next boundary:', e.message);
      return;
    }
  }

  // ── 2. Update fill from the latest candle close ───────────────────────────
  let gapRow;
  try {
    const r = await fetch(`${base}/api/es-gap?date=${today}`, { cache: 'no-store', headers: internalHeaders() });
    if (!r.ok) return;
    gapRow = (await r.json()).gap;
  } catch { return; }
  if (!gapRow || !gapRow.locked) return;

  const open = Number(gapRow.open_0930);
  const close = Number(gapRow.prior_close);
  const gapAbs = Math.abs(open - close);
  if (!(gapAbs > 0)) {
    // Flat gap — already 100% "filled" by definition; stamp once.
    await postFill(base, today, { pct: 100, extreme: open, filled: true });
    return;
  }

  let rows;
  try { rows = await fetchCandles(base, today); } catch { return; }
  // Only bars at/after the 09:30 open count toward the fill.
  const after = rows.filter((r) => String(r.slotKey || '').slice(11) >= '09:30');
  if (!after.length) return;

  // Furthest price has traveled toward the close: the session low (gap up) or
  // high (gap down) across the post-open bars. Same pure math the UI + test use.
  const sessionLow = Math.min(...after.map((r) => Number(r.low)));
  const sessionHigh = Math.max(...after.map((r) => Number(r.high)));
  const extreme = extremeToward(open, close, sessionLow, sessionHigh);
  const { pct, filled } = computeGapFill(close, open, extreme);
  const fill_ts = filled ? Date.now() : null;

  await postFill(base, today, { pct, extreme, filled, fill_ts });
}

async function postFill(base, date, { pct, extreme, filled, fill_ts }) {
  try {
    await fetch(`${base}/api/es-gap`, {
      method: 'POST',
      headers: internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        action: 'fill', date,
        pct_filled: pct, extreme_after: extreme, filled, fill_ts: fill_ts ?? undefined,
      }),
    });
    if (filled) console.log(`[es-gap] ${date} FILLED — gap closed (100%)`);
  } catch (e) {
    console.warn('[es-gap] fill update error:', e.message);
  }
}

/**
 * Begin the loop. Aligns to the next 5-minute wall-clock boundary (:00/:05/…),
 * then runs every 5 minutes. Self-rescheduling so it survives host sleep/drift.
 */
function startEsGapTracker(port) {
  const base = `http://localhost:${port}`;

  function msToNextBoundary() {
    const now = new Date();
    const minsToNext = INTERVAL_MIN - (now.getMinutes() % INTERVAL_MIN) || INTERVAL_MIN;
    return (minsToNext * 60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  }

  console.log(`[es-gap] enabled — posts the 9:30 gap + tracks fill every ${INTERVAL_MIN}m during RTH; first run in ${Math.round(msToNextBoundary() / 60000)}m`);

  // Startup probe ~25s after boot (feed warm-up) so a mid-session restart picks
  // up / re-posts today's gap without waiting for the next boundary.
  setTimeout(() => { void tick(base); }, 25_000);

  let stopped = false;
  let timer = null;
  function arm() {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick(base);
      arm();
    }, msToNextBoundary());
  }
  arm();

  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

module.exports = { startEsGapTracker, tick };
