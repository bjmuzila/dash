'use strict';
/**
 * server-v2/gex-levels-history-recorder.js
 *
 * Hard-persists the /test → GEX Levels "History of key level changes" table
 * into Postgres FOREVER (previously browser-localStorage only, 60-day cap).
 *
 * One row per (date, symbol), upserted in place all session; once the ET date
 * rolls over the row is frozen. Fields mirror the client's deriveGexLevels():
 *   spot, resistance (callWall), support (putWall), neutral (gexFlip),
 *   dollar_gamma (totalNetGex), cpg_ratio, r2, s2, open_int (ΣcallOI+ΣputOI).
 *
 * Source: /proxy/gex live snapshot (same feed the tab renders from), so the
 * saved row always matches what the tab showed.
 *
 * Cadence: every POLL_MINS (default 5) during 09:25–16:10 ET on trading days.
 * Wiring: startGexLevelsHistoryRecorder(PORT) in server-with-proxy.js.
 * Read API: GET /proxy/gex-levels-history  (route in server-with-proxy.js).
 */

const { findCallWall, findPutWall, findGexFlip, totalNetGex } = require('./computation/gex-calculator');
const { computeHistoricalGexRows } = require('./eod-gex-recorder');

const POLL_MINS = Number(process.env.GEX_LEVELS_HISTORY_POLL_MINS || 5);

// ── Level definition (this recorder only — the live /proxy/gex feed is not
//    touched by any of this) ────────────────────────────────────────────────
//
// Until 2026-08-23 this file stored whatever /proxy/gex had already put in
// v2.callWall / v2.putWall / v2.gexFlip. Those come from the default
// 'oivol' basis on a SINGLE nearest expiry, where the volume term and the
// at-the-money gamma peak stack and drag both walls onto the strike next to
// spot. The recorded evidence, 30 sessions of it: median support→resistance
// width 18 points, median resistance 7.8 points above spot, R2 exactly one
// strike past resistance every session, and spot closing INSIDE the band 30
// times out of 30. Those are not walls, they are spot with a rounding error.
//
// So the recorder now DERIVES its own levels from the snapshot's gexRows using
// the opt-in options added to gex-calculator, instead of trusting the
// pre-computed fields. Every knob is env-overridable, because the right basis
// is a product decision and should not need a redeploy to change.
//
//   GEX_LEVELS_WALL_BASIS    'oi' (default) | 'oivol' | 'vol' | 'oiRaw'
//   GEX_LEVELS_WALL_MIN_PCT  dead zone around spot, in percent (default 0.25)
//   GEX_LEVELS_FLIP_BAND_PCT flip must be within this % of spot (default 5)
//
// Defaults chosen from the same live chain the table above was measured on:
// 'oi' keeps the gamma weighting the product is built around while dropping the
// day's volume, and 0.25% (~19 pts on SPX at 7,650) is the smallest dead zone
// that pushed the put wall off the adjacent strike. Set 'oiRaw' for the plain
// "most open contracts" wall, which sits considerably further out.
const WALL_BASIS = String(process.env.GEX_LEVELS_WALL_BASIS || 'oi');
const WALL_MIN_PCT = Number(process.env.GEX_LEVELS_WALL_MIN_PCT ?? 0.25);
const FLIP_BAND_PCT = Number(process.env.GEX_LEVELS_FLIP_BAND_PCT ?? 5);
const WALL_OPTS = { basis: WALL_BASIS, minDistancePct: WALL_MIN_PCT };

// RTH-ish window (ET minutes-since-midnight): 09:25–16:10.
const WINDOW_OPEN_MINS = 9 * 60 + 25;
const WINDOW_CLOSE_MINS = 16 * 60 + 10;

// Market holidays — keep in sync with eod-gex-recorder.js / mvc-auto-snapshot.js
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── PG pool (same lazy, no-DB-safe pattern as eod-gex-recorder.js) ───────────

let pool = null;
let pgUnavailable = false;
let _schemaReady = false;

function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) { pgUnavailable = true; return null; }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
        ? undefined
        : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[gex-levels-hist] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[gex-levels-hist] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (_schemaReady) return true;
  await p.query(`
    CREATE TABLE IF NOT EXISTS gex_levels_history (
      date         DATE NOT NULL,
      symbol       TEXT NOT NULL DEFAULT '$SPX',
      spot         DOUBLE PRECISION NOT NULL,
      resistance   DOUBLE PRECISION,
      support      DOUBLE PRECISION,
      neutral      DOUBLE PRECISION,
      dollar_gamma DOUBLE PRECISION NOT NULL DEFAULT 0,
      cpg_ratio    DOUBLE PRECISION NOT NULL DEFAULT 0,
      r2           DOUBLE PRECISION,
      s2           DOUBLE PRECISION,
      open_int     DOUBLE PRECISION NOT NULL DEFAULT 0,
      curve        JSONB,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol)
    )
  `);
  // Additive for tables created before the curve snapshot existed — pre-curve
  // rows stay NULL and the client renders a dash for them.
  await p.query(`ALTER TABLE gex_levels_history ADD COLUMN IF NOT EXISTS curve JSONB`);
  // 'live' = intraday snapshot; 'theta' = boot catch-up re-derived from settled OI.
  await p.query(`ALTER TABLE gex_levels_history ADD COLUMN IF NOT EXISTS source TEXT`);
  // cpg_ratio was created NOT NULL DEFAULT 0, from when a missing ratio was
  // written as 0. It is now null when the put-gamma denominator is below the
  // floor (see deriveFromSnapshot), because 0 and "not measurable" are different
  // readings and a chart should be able to tell them apart. Idempotent.
  await p.query(`ALTER TABLE gex_levels_history ALTER COLUMN cpg_ratio DROP NOT NULL`);
  _schemaReady = true;
  return true;
}

// ── Time helpers ─────────────────────────────────────────────────────────────

function etDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

function inWindow() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t)?.value;
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(etDateStr())) return false;
  const mins = Number(get('hour')) * 60 + Number(get('minute'));
  return mins >= WINDOW_OPEN_MINS && mins <= WINDOW_CLOSE_MINS;
}

// ── Derivation — mirrors deriveGexLevels() in app/test/page.tsx ──────────────

const oiVolNet = (r) => (Number(r.netGEX) || 0) + (Number(r.netVolGEX) || 0);

// Downsampled cumulative net-GEX-by-strike curve (running sum from the lowest
// strike up — same math as glCumulativeByStrike / findGexFlip). Snapshotted per
// day so the tab's history table can sparkline the whole gamma profile, not
// just the walls. Kept to GL_CURVE_POINTS so the JSONB stays a few KB/day.
// `rows` must already be sorted ascending by strike.
const GL_CURVE_POINTS = 48;
function cumulativeCurve(rows) {
  let cum = 0;
  const pts = rows.map((r) => { cum += oiVolNet(r); return { k: Number(r.strike), c: cum }; });
  const at = (p) => ({ k: Number(p.k.toFixed(2)), c: Math.round(p.c) });
  if (pts.length <= GL_CURVE_POINTS) return pts.map(at);
  const step = (pts.length - 1) / (GL_CURVE_POINTS - 1);
  return Array.from({ length: GL_CURVE_POINTS }, (_, i) => at(pts[Math.round(i * step)]));
}

function deriveFromSnapshot(v2) {
  const rows = (Array.isArray(v2.gexRows) ? v2.gexRows : [])
    .filter((r) => Number.isFinite(Number(r.strike)))
    .sort((a, b) => a.strike - b.strike);
  const spot = Number(v2.spot ?? 0);
  if (!rows.length || !(spot > 0)) return null;

  // Derived here, NOT read from v2.callWall / v2.putWall / v2.gexFlip — see the
  // WALL_BASIS block at the top of this file for why. v2's own fields stay
  // exactly as they are and keep feeding the live dashboards untouched.
  const asNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const resistance = asNum(findCallWall(rows, spot, WALL_OPTS));
  const support = asNum(findPutWall(rows, spot, WALL_OPTS));
  const neutral = asNum(findGexFlip(rows, spot, { nearest: true, maxDistancePct: FLIP_BAND_PCT }));

  const dollarGamma = Number.isFinite(Number(v2.totalNetGex))
    ? Number(v2.totalNetGex)
    : rows.reduce((s, r) => s + oiVolNet(r), 0);

  let totalCallGEX = 0, totalPutGEXabs = 0, totalCallOI = 0, totalPutOI = 0;
  for (const r of rows) {
    totalCallGEX += Math.max(0, Number(r.callGEX) || 0);
    totalPutGEXabs += Math.abs(Number(r.putGEX) || 0);
    totalCallOI += Number(r.callOI) || 0;
    totalPutOI += Number(r.putOI) || 0;
  }
  // CPG ratio — call gamma over |put gamma|. The denominator needs a FLOOR: on a
  // chain whose put gamma is ~0 this divides by almost nothing and prints a
  // number that is noise wearing a ratio's clothes. The stored history has
  // 599.109 (2026-08-04) and 13.276 (2026-08-13) from exactly that. Anything
  // under a millionth of the call side is treated as no put gamma at all, and
  // the ratio is stored as null rather than a fake reading.
  const CPG_FLOOR = Math.max(1, totalCallGEX * 1e-6);
  const cpgRatio = totalPutGEXabs > CPG_FLOOR ? totalCallGEX / totalPutGEXabs : null;

  // R2/S2 — 2nd-strongest wall each side. Same basis and same dead zone as the
  // primary walls, or they land one strike past them and say nothing: the old
  // version used raw oiVolNet with no dead zone, and duly recorded r2 =
  // resistance + 5 and s2 = support − 5 on essentially every session.
  const r2 = asNum(findCallWall(rows, spot, { ...WALL_OPTS, exclude: resistance }));
  const s2 = asNum(findPutWall(rows, spot, { ...WALL_OPTS, exclude: support }));

  return {
    spot, resistance, support, neutral, dollarGamma, cpgRatio, r2, s2,
    openInt: totalCallOI + totalPutOI,
    curve: cumulativeCurve(rows),
  };
}

// ── Upsert ───────────────────────────────────────────────────────────────────

async function upsertLevels(date, symbol, d, source = 'live') {
  const p = getPool();
  if (!p) return false;
  await p.query(
    `INSERT INTO gex_levels_history
       (date, symbol, spot, resistance, support, neutral, dollar_gamma, cpg_ratio, r2, s2, open_int, curve, source, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13, now())
     ON CONFLICT (date, symbol) DO UPDATE SET
       spot = EXCLUDED.spot, resistance = EXCLUDED.resistance, support = EXCLUDED.support,
       neutral = EXCLUDED.neutral, dollar_gamma = EXCLUDED.dollar_gamma, cpg_ratio = EXCLUDED.cpg_ratio,
       r2 = EXCLUDED.r2, s2 = EXCLUDED.s2, open_int = EXCLUDED.open_int,
       curve = EXCLUDED.curve, source = EXCLUDED.source, updated_at = now()`,
    [date, symbol, d.spot, d.resistance, d.support, d.neutral, d.dollarGamma, d.cpgRatio, d.r2, d.s2, d.openInt,
     d.curve?.length ? JSON.stringify(d.curve) : null, source]
  );
  return true;
}

// ── Collect + upsert ─────────────────────────────────────────────────────────

async function collectGexLevelsHistory(base, opts = {}) {
  const force = !!opts.force;
  if (!force && !inWindow()) return null;
  if (!(await ensureSchema())) return null;

  const res = await fetch(`${base}/proxy/gex`, {
    cache: 'no-store',
    headers: process.env.INTERNAL_API_TOKEN
      ? { 'x-internal-token': process.env.INTERNAL_API_TOKEN } : {},
  });
  if (!res.ok) throw new Error(`/proxy/gex returned ${res.status}`);
  const v2 = await res.json();

  const d = deriveFromSnapshot(v2);
  if (!d) throw new Error('snapshot not ready (no rows / spot 0)');

  const symbol = String(v2.symbol || '$SPX');
  const date = etDateStr();
  if (!getPool()) return null;
  await upsertLevels(date, symbol, d, 'live');
  return { date, symbol, ...d };
}

// ── Boot catch-up ────────────────────────────────────────────────────────────
//
// The recorder only writes LIVE during 09:25–16:10 ET. Any day the process was
// down for that whole window (redeploy, crash) — or the feed was dead — leaves
// zero rows, and nothing ever fills them. On boot, look back CATCHUP_DAYS
// trading days and backfill any hole by re-deriving walls/curve from Theta
// settled OI (strikeRange 500, same as EOD), then running the SAME
// deriveFromSnapshot the live path uses. Only fills gaps — never touches an
// existing row. $SPX only (the recorder is single-symbol). Excludes today.

const CATCHUP_DAYS = 5;
const CATCHUP_DELAY_MS = 90_000; // let Theta finish connecting first
// The live path stores whatever /proxy/gex returns as v2.symbol — that's 'SPX'
// (no '$'). But eod-gex-recorder's Theta index history is keyed '$SPX' (the
// sentinel fetchSettleSpot uses to pick fetchIndexEodTheta over the stock EOD
// path). So we FETCH under '$SPX' and STORE under 'SPX' to line up with live.
const STORE_SYMBOL = 'SPX';
const THETA_SYMBOL = '$SPX';

function isTradingDay(dateStr, weekday) {
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return !MARKET_HOLIDAYS.has(dateStr);
}

function prevTradingDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  for (let i = 0; i < 10; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const iso = d.toISOString().slice(0, 10);
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(d);
    if (isTradingDay(iso, wd)) return iso;
  }
  return null;
}

// Trading days in [from, to] with NO gex_levels_history row for `symbol`.
async function missingDates(symbol, fromDate, toDate) {
  const p = getPool();
  if (!p) return [];
  const { rows } = await p.query(
    `SELECT date FROM gex_levels_history WHERE symbol = $1 AND date BETWEEN $2 AND $3`,
    [symbol, fromDate, toDate]
  );
  const have = new Set(rows.map((r) => String(r.date).slice(0, 10)));
  const out = [];
  const d = new Date(`${fromDate}T12:00:00Z`);
  const end = new Date(`${toDate}T12:00:00Z`);
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(d);
    if (isTradingDay(iso, wd) && !have.has(iso)) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function catchUpMissing(opts = {}) {
  if (!(await ensureSchema())) return;
  const lookback = Number(opts.days || CATCHUP_DAYS);
  const symbol = opts.symbol || STORE_SYMBOL;              // storage/dedupe key ('SPX')
  const thetaSym = symbol === STORE_SYMBOL ? THETA_SYMBOL : symbol; // Theta index key ('$SPX')

  // Window = [lookback trading days back, prior trading day]. Today is excluded:
  // its row is the live poll's job and isn't "missing" until the close.
  const to = prevTradingDay(etDateStr());
  if (!to) return;
  let from = to;
  for (let i = 1; i < lookback; i++) {
    const p = prevTradingDay(from);
    if (!p) break;
    from = p;
  }

  let gaps = [];
  try { gaps = await missingDates(symbol, from, to); }
  catch (e) { console.warn(`[gex-levels-hist/catchup] gap scan failed: ${e.message}`); return; }
  if (!gaps.length) { console.log(`[gex-levels-hist/catchup] no gaps in last ${lookback} trading days`); return; }

  console.log(`[gex-levels-hist/catchup] ${symbol} — ${gaps.length} missing: ${gaps.join(', ')}`);
  const filled = [];
  for (const date of gaps) {
    try {
      const { gexRows, spot } = await computeHistoricalGexRows(thetaSym, date);
      // No callWall/putWall/gexFlip passed any more: deriveFromSnapshot computes
      // all three itself, so the catch-up path and the live path cannot drift
      // into two different definitions of the same column.
      const d = deriveFromSnapshot({ symbol, spot, gexRows, totalNetGex: totalNetGex(gexRows) });
      if (!d) throw new Error('derive returned null');
      await upsertLevels(date, symbol, d, 'theta');
      filled.push(date);
      console.log(`[gex-levels-hist/catchup] ${symbol} ${date} — theta  R=${d.resistance ?? '—'} S=${d.support ?? '—'} flip=${d.neutral ?? '—'} γ=${(d.dollarGamma / 1e9).toFixed(3)}B`);
    } catch (e) {
      console.warn(`[gex-levels-hist/catchup] ${symbol} ${date} — ${e.message}`);
    }
  }
  if (filled.length) console.log(`[gex-levels-hist/catchup] filled ${filled.length}: ${filled.join(', ')}`);
  else console.log(`[gex-levels-hist/catchup] no rows filled (Theta history unavailable for the gaps)`);
  return { from, to, filled };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

function startGexLevelsHistoryRecorder(port) {
  const base = `http://localhost:${port}`;
  console.log(`[gex-levels-hist] enabled — ${POLL_MINS}m poll, 09:25–16:10 ET trading days → gex_levels_history`);
  const tick = async () => {
    try { await collectGexLevelsHistory(base); }
    catch (e) { if (inWindow()) console.warn('[gex-levels-hist] tick:', e.message); }
  };
  // Fire once shortly after boot (covers mid-session restarts), then poll.
  setTimeout(() => { void tick(); }, 30_000).unref?.();
  _timer = setInterval(() => { void tick(); }, POLL_MINS * 60_000);
  _timer.unref?.();
  // Boot catch-up: backfills whole days the recorder was down for. Delayed so
  // Theta has time to connect before we ask it for history.
  setTimeout(() => {
    catchUpMissing().catch((e) => console.warn('[gex-levels-hist/catchup] error:', e.message));
  }, CATCHUP_DELAY_MS).unref?.();
  return () => { if (_timer) clearInterval(_timer); };
}

module.exports = { startGexLevelsHistoryRecorder, collectGexLevelsHistory, catchUpMissing, missingDates, ensureSchema, getPool };
