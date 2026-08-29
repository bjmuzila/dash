'use strict';
/**
 * server-v2/earnings-calendar-recorder.js
 *
 * Weekly earnings calendar for the /economic-calendar earnings tab and the
 * earnings rows woven into the calendar tab.
 *
 * Source : Nasdaq public calendar API
 *          https://api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD
 *
 * FILTER — there isn't one any more, and that is the whole point.
 *
 *   This recorder used to drop everything under EARNINGS_MIN_MCAP ($100B, then
 *   $25B). $25B is roughly the bottom of the S&P 500, which sounds reasonable
 *   until you compare the result against any "most anticipated earnings" board:
 *   the names traders actually position for that week — CRDO, GTLB, MDB, PATH,
 *   CIEN, DOCU, FIVE, OLLI, DLTH, DAKT, KNOP — are ALL far below it, and the
 *   ones that are not (AVGO, MDT, LULU) were never the missing half. The floor
 *   was throwing away the list it was supposed to produce.
 *
 *   So: STORE EVERYTHING Nasdaq returns and let the surfaces narrow. A row that
 *   was never written can't be recovered by a client filter, whereas a row that
 *   is present costs ~80 bytes and can be hidden by one. The default floor is
 *   now 0; EARNINGS_MIN_MCAP still overrides it if a week ever needs trimming
 *   at the source, and a single sweep can override it without a redeploy (see
 *   runSweep).
 *
 *   The "which of these actually matter" decision moved to lib/econCalendar.ts
 *   (`pickAnticipated`), which every surface shares. That is a display concern
 *   and belongs where it can be changed without a re-scrape.
 *
 * RANGE  : this week AND next week (Mon–Fri each). The board has a week toggle,
 *          and the Saturday-only "scrape next week" cadence meant the current
 *          week was whatever last Saturday happened to catch.
 *
 * Cadence: Saturday 09:00–09:30 ET → sweep this + next week.
 *          Daily 06:30–07:00 ET    → re-sweep THIS week only. Nasdaq firms up
 *          "time-not-supplied" into pre-market/after-hours through the week, so
 *          a Saturday-only capture leaves most of the week sitting in the TBD
 *          bucket forever.
 *          Boot backfill: any of the two weeks that is empty or was captured by
 *          an older sweep version is re-swept ~20s after start.
 *
 * Table  : earnings_calendar (date, symbol) PK
 * Read   : GET  /proxy/earnings-week[?week=this|next|both]   (default: both)
 * Fire   : POST /proxy/earnings-week-run?week=this|next|both[&minMcap=10]
 *          minMcap is read as $B when < 1000, else as raw dollars.
 */

// 0 = no floor. See the header — the floor is what was breaking this feed.
const MIN_MCAP = Number(process.env.EARNINGS_MIN_MCAP || 0);

/**
 * Bumped whenever a sweep's SHAPE changes in a way that makes older rows wrong
 * or incomplete, so backfillIfEmpty can tell "already swept" from "swept under
 * the old rules". v1 = the mcap-floored sweeps; v2 = store-everything.
 *
 * This replaces the old min_mcap>0 heuristic, which cannot survive a legitimate
 * floor of 0 — under it every new row would look like a legacy row and the
 * recorder would re-scrape both weeks on every single boot.
 */
const SWEEP_VER = 2;

/**
 * Accepts 10 / "10B" / 10e9 and returns dollars. Anything under 1000 is read
 * as billions, because that is how the number gets typed by hand. Junk or a
 * negative → null, and the caller falls back to MIN_MCAP. Note 0 IS a valid
 * override ("no floor"), so it is returned rather than nulled.
 */
function normalizeMcap(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.eE+-]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  if (n === 0) return 0;
  return n < 1000 ? n * 1e9 : n;
}

const fmtB = (n) =>
  !n ? 'no floor' : `$${(n / 1e9) >= 10 ? (n / 1e9).toFixed(0) : (n / 1e9).toFixed(1)}B`;
const TICK_MINS = 15;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ── PG pool (same lazy, no-DB-safe pattern as the other recorders) ───────────

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
      console.warn('[earnings-cal] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[earnings-cal] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (_schemaReady) return true;
  await p.query(`
    CREATE TABLE IF NOT EXISTS earnings_calendar (
      date       DATE NOT NULL,
      symbol     TEXT NOT NULL,
      company    TEXT NOT NULL DEFAULT '',
      session    TEXT NOT NULL DEFAULT 'unknown',   -- pre | after | unknown
      market_cap DOUBLE PRECISION NOT NULL DEFAULT 0,
      eps_est    TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol)
    )
  `);
  // The cap the row was captured under. Informational now that the default is
  // 0 — kept so a one-off trimmed sweep is still self-describing.
  await p.query(`
    ALTER TABLE earnings_calendar
      ADD COLUMN IF NOT EXISTS min_mcap DOUBLE PRECISION NOT NULL DEFAULT 0
  `);
  // Sweep version — see SWEEP_VER. Legacy rows default to 0 and get re-swept
  // once, which is also what widens them from the old $25B capture.
  await p.query(`
    ALTER TABLE earnings_calendar
      ADD COLUMN IF NOT EXISTS sweep_ver INTEGER NOT NULL DEFAULT 0
  `);
  _schemaReady = true;
  return true;
}

// ── Time helpers (ET) ────────────────────────────────────────────────────────

function etDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { weekday: get('weekday'), mins: Number(get('hour')) * 60 + Number(get('minute')) };
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Mon..Fri (YYYY-MM-DD) of the week containing `ymd`; Sat/Sun roll forward. */
function weekMonFri(ymd) {
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  const toMon = dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow;
  const mon = addDays(ymd, toMon);
  return [0, 1, 2, 3, 4].map((i) => addDays(mon, i));
}

/** Mon..Fri of the NEXT week relative to `ymd`. */
function nextWeekMonFri(ymd) {
  return weekMonFri(addDays(ymd, 7));
}

/** The Mon–Fri day list for a week key. 'both' = this week then next, in order. */
function daysForWeek(week, today = etDateStr()) {
  if (week === 'next') return nextWeekMonFri(today);
  if (week === 'both') return [...weekMonFri(today), ...nextWeekMonFri(today)];
  return weekMonFri(today);
}

// ── Nasdaq fetch ─────────────────────────────────────────────────────────────

function parseMcap(v) {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseSession(t) {
  const s = String(t ?? '').toLowerCase();
  if (s.includes('pre-market')) return 'pre';
  if (s.includes('after-hours')) return 'after';
  return 'unknown';
}

async function fetchNasdaqDay(date, minMcap = MIN_MCAP) {
  const res = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`nasdaq ${date} → HTTP ${res.status}`);
  const j = await res.json();
  const rows = j?.data?.rows;
  if (!Array.isArray(rows)) return []; // no earnings that day → data:null
  const out = rows
    .map((r) => ({
      symbol: String(r.symbol || '').toUpperCase().trim(),
      company: String(r.name || '').trim(),
      session: parseSession(r.time),
      // Nasdaq sends "$1,234,567,890" — and "" or "N/A" for anything without a
      // published cap (SPACs, recent listings, some ADRs). Those become 0, which
      // is a real value here: with no floor they are KEPT, they just sort last.
      marketCap: parseMcap(r.marketCap),
      epsEst: r.epsForecast ? String(r.epsForecast) : null,
    }))
    .filter((r) => r.symbol && (!minMcap || r.marketCap >= minMcap));

  // Nasdaq occasionally repeats a symbol within one day (dual share classes
  // resolving to the same ticker, or a re-listed row). (date, symbol) is the
  // PK, so a duplicate inside one multi-row INSERT throws
  // "ON CONFLICT DO UPDATE command cannot affect row a second time" and takes
  // the whole day's chunk with it. De-dupe here, keeping the larger cap.
  const seen = new Map();
  for (const r of out) {
    const prev = seen.get(r.symbol);
    if (!prev || r.marketCap > prev.marketCap) seen.set(r.symbol, r);
  }
  return [...seen.values()];
}

// ── Sweep + upsert ───────────────────────────────────────────────────────────

const COLS = 8;            // date, symbol, company, session, market_cap, eps_est, min_mcap, sweep_ver
const CHUNK = 400;         // 400 * 8 = 3200 params, far under PG's 65535 cap

/**
 * Multi-row INSERT. The old loop issued one round-trip PER NAME, which was
 * tolerable at ~30 rows a week and is not at ~2,500: a full both-weeks sweep
 * would have been 2,500 sequential queries against a remote Postgres.
 */
async function insertRows(p, date, rows, minMcap) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = slice.map((r, k) => {
      const b = k * COLS;
      params.push(date, r.symbol, r.company, r.session, r.marketCap, r.epsEst, minMcap, SWEEP_VER);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
    });
    await p.query(
      `INSERT INTO earnings_calendar
         (date, symbol, company, session, market_cap, eps_est, min_mcap, sweep_ver)
       VALUES ${tuples.join(',')}
       ON CONFLICT (date, symbol) DO UPDATE SET
         company = EXCLUDED.company, session = EXCLUDED.session,
         market_cap = EXCLUDED.market_cap, eps_est = EXCLUDED.eps_est,
         min_mcap = EXCLUDED.min_mcap, sweep_ver = EXCLUDED.sweep_ver,
         updated_at = now()`,
      params
    );
  }
}

/**
 * @param {'this'|'next'|'both'} week
 * @param {{minMcap?: number|string}} [opts]  per-run cap override, $B or dollars.
 *        Omitted → MIN_MCAP (0, no floor). The sweep DELETEs each day before
 *        inserting, so a lower cap widens the week and a higher one trims it —
 *        no stale rows either way.
 */
async function runSweep(week = 'this', opts = {}) {
  if (!(await ensureSchema())) return null;
  const override = normalizeMcap(opts?.minMcap);
  const minMcap = override == null ? MIN_MCAP : override;
  const today = etDateStr();
  const days = daysForWeek(week, today);
  const p = getPool();
  let inserted = 0;
  const failed = [];

  for (const date of days) {
    let rows = [];
    try {
      rows = await fetchNasdaqDay(date, minMcap);
    } catch (e) {
      // A failed day must NOT clear what is already stored for it — a 429 from
      // Nasdaq would otherwise blank that day until the next sweep.
      console.warn('[earnings-cal]', e.message);
      failed.push(date);
      continue;
    }
    // Clear the day first so de-listed/moved names don't linger.
    await p.query('DELETE FROM earnings_calendar WHERE date = $1', [date]);
    if (rows.length) await insertRows(p, date, rows, minMcap);
    inserted += rows.length;
    await new Promise((r) => setTimeout(r, 400)); // be polite to nasdaq
  }
  console.log(
    `[earnings-cal] ${week} ${days[0]}→${days[days.length - 1]} — ${inserted} names (${fmtB(minMcap)})` +
    (failed.length ? ` — ${failed.length} day(s) failed: ${failed.join(',')}` : '')
  );
  return { week, days, count: inserted, minMcap, failed };
}

/**
 * Stored rows for a week key.
 *
 * @param {'this'|'next'|'both'} week  default 'both'.
 *
 * Returns the FULL Mon–Fri of each requested week — including days already
 * past. The board is a week view and a Thursday that renders Mon–Wed as missing
 * is wrong; the surfaces that only want "from today" (the home panel weaves
 * earnings into a rolling 7-day event list) already filter by their own day
 * list, so this is additive for them.
 */
async function getWeekRows(week = 'both') {
  if (!(await ensureSchema())) return [];
  const days = daysForWeek(week);
  const { rows } = await getPool().query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, symbol, company, session, market_cap, eps_est
       FROM earnings_calendar
      WHERE date >= $1 AND date <= $2
      ORDER BY date ASC, market_cap DESC`,
    [days[0], days[days.length - 1]]
  );
  return rows;
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;
let _lastSatRun = null;
let _lastDailyRun = null;

/**
 * Boot repair. Re-sweeps a week when it is empty or when its rows predate the
 * current SWEEP_VER — which is exactly the case for every row written under the
 * old $25B floor, so the first boot after this change widens both weeks without
 * anyone firing the manual route.
 *
 * Checked per week rather than across both, so a normal boot in the middle of a
 * healthy week costs one COUNT query and no scraping.
 */
async function backfillIfEmpty() {
  try {
    if (!(await ensureSchema())) return;
    for (const week of ['this', 'next']) {
      const days = daysForWeek(week);
      const { rows } = await getPool().query(
        `SELECT COUNT(*)::int AS n, COALESCE(MIN(sweep_ver), 0) AS ver
           FROM earnings_calendar WHERE date >= $1 AND date <= $2`,
        [days[0], days[days.length - 1]]
      );
      const n = rows[0]?.n ?? 0;
      const ver = Number(rows[0]?.ver ?? 0);
      if (!n) {
        console.log(`[earnings-cal] ${week} week empty → backfilling now`);
      } else if (ver < SWEEP_VER) {
        console.log(`[earnings-cal] ${week} week is sweep v${ver} < v${SWEEP_VER} → re-sweeping wider`);
      } else {
        continue;
      }
      await runSweep(week);
    }
  } catch (e) {
    console.warn('[earnings-cal] backfill:', e.message);
  }
}

function startEarningsCalendarRecorder() {
  console.log(
    `[earnings-cal] enabled — Sat 09:00 ET both-week sweep, daily 06:30 ET this-week refresh, floor ${fmtB(MIN_MCAP)}`
  );
  setTimeout(() => { void backfillIfEmpty(); }, 20_000).unref?.();

  const tick = async () => {
    const { weekday, mins } = etParts();
    const key = etDateStr();

    // Saturday 09:00–09:30 ET — the full rebuild. From Saturday, weekMonFri()
    // has already rolled forward, so 'both' here is "the week starting Monday"
    // plus the one after it.
    if (weekday === 'Sat' && mins >= 9 * 60 && mins < 9 * 60 + 30 && _lastSatRun !== key) {
      _lastSatRun = key;
      try { await runSweep('both'); }
      catch (e) { console.warn('[earnings-cal] sat run:', e.message); _lastSatRun = null; }
      return;
    }

    // Daily 06:30–07:00 ET — refresh the CURRENT week only. This is what turns
    // "time not supplied" into pre/after as Nasdaq confirms it, and it picks up
    // names added to the calendar after Saturday.
    if (mins >= 6 * 60 + 30 && mins < 7 * 60 && _lastDailyRun !== key) {
      _lastDailyRun = key;
      try { await runSweep('this'); }
      catch (e) { console.warn('[earnings-cal] daily run:', e.message); _lastDailyRun = null; }
    }
  };

  _timer = setInterval(() => { void tick(); }, TICK_MINS * 60_000);
  _timer.unref?.();
  return () => { if (_timer) clearInterval(_timer); };
}

module.exports = {
  startEarningsCalendarRecorder,
  runSweep,
  getWeekRows,
  ensureSchema,
  getPool,
  normalizeMcap,
  daysForWeek,
  MIN_MCAP,
  SWEEP_VER,
};
