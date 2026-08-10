'use strict';
/**
 * server-v2/earnings-calendar-recorder.js
 *
 * Weekly earnings calendar for the /economic-calendar bottom strip.
 *
 * Source : Nasdaq public calendar API
 *          https://api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD
 * Filter : market cap >= EARNINGS_MIN_MCAP (default $25B)
 *          $100B only cleared a handful of names a week, so most weeks the
 *          strip read empty. $25B is roughly the bottom of the S&P 500 — a
 *          normal week lands a few dozen names that actually matter.
 *          A single sweep can override the cap without a redeploy (see
 *          runSweep) — that is the "bump the cap down for THIS week" path.
 * Cadence: Saturday 09:00–09:30 ET → scrapes the upcoming Mon–Fri.
 *          Plus a boot backfill: if the CURRENT week has no rows, scrape it
 *          immediately (this is the "manual scrape of this week" path).
 *
 * Table  : earnings_calendar (date, symbol) PK
 * Read   : GET  /proxy/earnings-week      (today → Friday)
 * Fire   : POST /proxy/earnings-week-run?week=this|next[&minMcap=10]
 *          minMcap is read as $B when < 1000, else as raw dollars.
 */

const MIN_MCAP = Number(process.env.EARNINGS_MIN_MCAP || 25e9);

/**
 * Accepts 10 / "10B" / 10e9 and returns dollars. Anything under 1000 is read
 * as billions, because that is how the number gets typed by hand. Junk or a
 * negative → null, and the caller falls back to MIN_MCAP.
 */
function normalizeMcap(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.eE+-]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1000 ? n * 1e9 : n;
}

const fmtB = (n) => `$${(n / 1e9) >= 10 ? (n / 1e9).toFixed(0) : (n / 1e9).toFixed(1)}B`;
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
  // The cap the row was captured under. Rows written before this column
  // existed default to 0 and read as "unknown cap", which is deliberately
  // NOT treated as stale — only a recorded cap above the current one is.
  await p.query(`
    ALTER TABLE earnings_calendar
      ADD COLUMN IF NOT EXISTS min_mcap DOUBLE PRECISION NOT NULL DEFAULT 0
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

/** Mon..Fri of the NEXT week relative to `ymd` (what Saturday 9am scrapes). */
function nextWeekMonFri(ymd) {
  return weekMonFri(addDays(ymd, 7)).map((d) => d); // ymd is Sat → weekMonFri already rolls fwd
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
  return rows
    .map((r) => ({
      symbol: String(r.symbol || '').toUpperCase().trim(),
      company: String(r.name || '').trim(),
      session: parseSession(r.time),
      marketCap: parseMcap(r.marketCap),
      epsEst: r.epsForecast ? String(r.epsForecast) : null,
    }))
    .filter((r) => r.symbol && r.marketCap >= minMcap);
}

// ── Sweep + upsert ───────────────────────────────────────────────────────────

/**
 * @param {'this'|'next'} week
 * @param {{minMcap?: number|string}} [opts]  per-run cap override, $B or dollars.
 *        Omitted → MIN_MCAP. Lowering it re-scrapes the week wider; the sweep
 *        DELETEs each day before inserting, so a lower cap widens the week and
 *        a higher one trims it back — no stale rows either way.
 */
async function runSweep(week = 'this', opts = {}) {
  if (!(await ensureSchema())) return null;
  const minMcap = normalizeMcap(opts?.minMcap) ?? MIN_MCAP;
  const today = etDateStr();
  const days = week === 'next' ? nextWeekMonFri(today) : weekMonFri(today);
  const p = getPool();
  let inserted = 0;

  for (const date of days) {
    let rows = [];
    try {
      rows = await fetchNasdaqDay(date, minMcap);
    } catch (e) {
      console.warn('[earnings-cal]', e.message);
      continue;
    }
    // Clear the day first so de-listed/moved names don't linger.
    await p.query('DELETE FROM earnings_calendar WHERE date = $1', [date]);
    for (const r of rows) {
      await p.query(
        `INSERT INTO earnings_calendar (date, symbol, company, session, market_cap, eps_est, min_mcap, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (date, symbol) DO UPDATE SET
           company = EXCLUDED.company, session = EXCLUDED.session,
           market_cap = EXCLUDED.market_cap, eps_est = EXCLUDED.eps_est,
           min_mcap = EXCLUDED.min_mcap, updated_at = now()`,
        [date, r.symbol, r.company, r.session, r.marketCap, r.epsEst, minMcap]
      );
      inserted++;
    }
    await new Promise((r) => setTimeout(r, 400)); // be polite to nasdaq
  }
  console.log(`[earnings-cal] ${week} week ${days[0]}→${days[4]} — ${inserted} names ≥ ${fmtB(minMcap)}`);
  return { week, days, count: inserted, minMcap };
}

/** Rows from today (ET) through Friday of the current week. */
async function getWeekRows() {
  if (!(await ensureSchema())) return [];
  const today = etDateStr();
  const days = weekMonFri(today);
  const from = today > days[4] ? days[0] : (today < days[0] ? days[0] : today);
  const { rows } = await getPool().query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, symbol, company, session, market_cap, eps_est
       FROM earnings_calendar
      WHERE date >= $1 AND date <= $2
      ORDER BY date ASC, market_cap DESC`,
    [from, days[4]]
  );
  return rows;
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;
let _lastRunWeek = null;

/**
 * Boot repair for the CURRENT week. Re-sweeps when the week is empty, and also
 * when its rows were captured under a HIGHER cap than the one now configured —
 * otherwise dropping MIN_MCAP would only take effect next Saturday and this
 * week would keep showing the old, thinner list.
 */
async function backfillIfEmpty() {
  try {
    if (!(await ensureSchema())) return;
    const days = weekMonFri(etDateStr());
    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS n, COALESCE(MAX(min_mcap), 0) AS cap
         FROM earnings_calendar WHERE date >= $1 AND date <= $2`,
      [days[0], days[4]]
    );
    const n = rows[0]?.n ?? 0;
    const cap = Number(rows[0]?.cap ?? 0);
    if (!n) {
      console.log('[earnings-cal] current week empty → backfilling now');
    } else if (cap > MIN_MCAP) {
      console.log(`[earnings-cal] current week captured at ${fmtB(cap)} > ${fmtB(MIN_MCAP)} → re-sweeping wider`);
    } else {
      return;
    }
    await runSweep('this');
  } catch (e) {
    console.warn('[earnings-cal] backfill:', e.message);
  }
}

function startEarningsCalendarRecorder() {
  console.log(`[earnings-cal] enabled — Sat 09:00 ET scrape of next Mon–Fri, mcap ≥ ${fmtB(MIN_MCAP)}`);
  setTimeout(() => { void backfillIfEmpty(); }, 20_000).unref?.();

  const tick = async () => {
    const { weekday, mins } = etParts();
    if (weekday !== 'Sat') return;
    if (mins < 9 * 60 || mins >= 9 * 60 + 30) return;
    const key = etDateStr();
    if (_lastRunWeek === key) return;
    _lastRunWeek = key;
    try { await runSweep('next'); }
    catch (e) { console.warn('[earnings-cal] sat run:', e.message); _lastRunWeek = null; }
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
  MIN_MCAP,
};
