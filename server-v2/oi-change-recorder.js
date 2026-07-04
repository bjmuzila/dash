'use strict';
/**
 * server-v2/oi-change-recorder.js
 *
 * "OI Change" scanner — day-over-day OPEN INTEREST change, OTM contracts only,
 * across the full EM watchlist (em-tickers.js EQUITY_TICKERS — the "stocks I
 * normally track" roster, ~380 names). Answers: which OTM strikes built or
 * unwound the most open interest overnight?
 *
 * OPRA OI is a once-daily value published ~06:30 ET that reflects the PRIOR
 * session's close (see proxy-thetadata.js header notes). So for a given
 * calendar date D:
 *   oi_now  = /v3/option/history/open_interest for date D   (posted ~06:30 ET)
 *   oi_prev = /v3/option/history/open_interest for the prior trading day
 * oi_chg = oi_now - oi_prev is the standard "OI changed since yesterday" the
 * request asks for. Each call covers ALL expirations for one ticker in one
 * REST hit (expiration=*), so a full sweep is ~2 Theta calls + 1 stock quote
 * per ticker, not per-expiry.
 *
 * OTM filter: calls OTM when strike > spot, puts OTM when strike < spot,
 * using the ticker's live spot at sweep time.
 *
 * Scope: only expirations within MAX_DTE_DAYS (default 45) are kept — near-term
 * flow is what an OI-change scanner is for; LEAPS OI barely moves day to day
 * and would just add noise + row volume.
 *
 * Table: oi_change_snapshots (date, symbol, expiry, strike, opt_type) — one
 * row per contract per day. Rows older than RETENTION_DAYS are pruned at the
 * start of each day's first sweep.
 *
 * Cadence: idempotent per (date, symbol) — a sweep tick skips any symbol that
 * already has rows for today, so after the first successful pass in a day the
 * remaining ticks are nearly free (just a SELECT). This lets it retry safely
 * every SWEEP_MINS in case OI wasn't published yet (pre-06:30 ET) or a batch
 * of tickers failed.
 *
 * Wiring: startOiChangeRecorder() from server-with-proxy.js.
 * Read:   GET  /proxy/oi-change?limit=100&side=all&dir=all
 * Manual: POST /proxy/oi-change-run   (force = bypass the time-window gate)
 */

const { EQUITY_TICKERS } = require('./em-tickers');
const { fetchOiHistoryTheta, fetchStockQuoteTheta } = require('./proxy-thetadata');

// ── tunables (env-overridable) ───────────────────────────────────────────────

const SWEEP_MINS       = Number(process.env.OI_CHANGE_SWEEP_MINS || 30);
const TICKER_DELAY_MS  = Number(process.env.OI_CHANGE_TICKER_DELAY_MS || 400);
const STRIKE_RANGE     = Number(process.env.OI_CHANGE_STRIKE_RANGE || 40); // ± strikes around that date's spot
const MAX_DTE_DAYS     = Number(process.env.OI_CHANGE_MAX_DTE_DAYS || 45); // near-term flow only
const MIN_OI_FLOOR     = Number(process.env.OI_CHANGE_MIN_OI_FLOOR || 10); // drop dust contracts
const RETENTION_DAYS   = Number(process.env.OI_CHANGE_RETENTION_DAYS || 14);
// Daily window (ET, minutes-since-midnight): OI posts ~06:30, give it margin.
const WINDOW_START_MINS = 6 * 60;       // 06:00
const WINDOW_END_MINS   = 20 * 60;      // 20:00

const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── PG pool (same lazy pattern as strike-growth-recorder.js) ─────────────────

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
      console.warn('[oi-change] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[oi-change] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  if (_schemaReady) return true;
  const p = getPool();
  if (!p) return false;
  await p.query(`
    CREATE TABLE IF NOT EXISTS oi_change_snapshots (
      date          DATE              NOT NULL,
      symbol        TEXT              NOT NULL,
      expiry        TEXT              NOT NULL,
      strike        DOUBLE PRECISION  NOT NULL,
      opt_type      TEXT              NOT NULL,
      oi_now        INTEGER           NOT NULL,
      oi_prev       INTEGER           NOT NULL,
      oi_chg        INTEGER           NOT NULL,
      oi_chg_pct    DOUBLE PRECISION,
      spot          DOUBLE PRECISION,
      otm           BOOLEAN           NOT NULL,
      otm_dist_pct  DOUBLE PRECISION,
      ts            TIMESTAMPTZ       NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol, expiry, strike, opt_type)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_oi_change_top
                 ON oi_change_snapshots (date, otm, oi_chg);`);
  _schemaReady = true;
  console.log('[oi-change] schema ready');
  return true;
}

// ── time helpers (mirrors strike-growth-recorder.js / play-recorder.js) ──────

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  let hh = get('hour'); if (hh === '24') hh = '00';
  return { hour: Number(hh), minute: Number(get('minute')), weekday: get('weekday') };
}

function etDateStr(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((p) => p.type !== 'literal')
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isWeekdayNonHoliday(ymd, weekday) {
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(ymd)) return false;
  return true;
}

function inDailyWindow() {
  const { hour, minute, weekday } = etParts();
  if (!isWeekdayNonHoliday(etDateStr(), weekday)) return false;
  const mins = hour * 60 + minute;
  return mins >= WINDOW_START_MINS && mins <= WINDOW_END_MINS;
}

// Walk back from `ymd` (YYYY-MM-DD) to the previous trading day, skipping
// weekends + MARKET_HOLIDAYS. Uses noon-UTC construction so date-only math
// never drifts a day from a DST boundary.
function prevTradingDateStr(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  for (let i = 0; i < 10; i += 1) {
    d.setUTCDate(d.getUTCDate() - 1);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay(); // 0 = Sun, 6 = Sat
    if (dow === 0 || dow === 6) continue;
    if (MARKET_HOLIDAYS.has(iso)) continue;
    return iso;
  }
  return ymd; // fallback — shouldn't happen
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── per-ticker snapshot ───────────────────────────────────────────────────────

/**
 * Build today-vs-prior OTM OI-change rows for one ticker. Returns [] if OI
 * for `date` hasn't posted yet (empty response = "not yet", never zero — see
 * proxy-thetadata.js). Filters to MAX_DTE_DAYS out and drops dust contracts
 * under MIN_OI_FLOOR on both sides.
 */
async function snapshotTicker(symbol, date, prevDate) {
  const quote = await fetchStockQuoteTheta(symbol);
  const spot = Number(quote?.last ?? quote?.mark ?? 0);
  if (!(spot > 0)) throw new Error(`spot 0 for ${symbol}`);

  const [todayMap, prevMap] = await Promise.all([
    fetchOiHistoryTheta(symbol, date, { strikeRange: STRIKE_RANGE }),
    fetchOiHistoryTheta(symbol, prevDate, { strikeRange: STRIKE_RANGE }),
  ]);
  if (!todayMap.size) return []; // not posted yet — caller retries next tick

  const cutoff = new Date(`${date}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + MAX_DTE_DAYS);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const rows = [];
  for (const [key, oiNow] of todayMap.entries()) {
    const [expiry, strikeStr, type] = key.split('|');
    if (expiry > cutoffIso) continue; // lexical ISO-date compare
    const strike = Number(strikeStr);
    if (!(strike > 0)) continue;
    const oiPrev = Number(prevMap.get(key) ?? 0);
    if (Math.max(oiNow, oiPrev) < MIN_OI_FLOOR) continue;

    const otm = type === 'C' ? strike > spot : strike < spot;
    if (!otm) continue;

    const chg = oiNow - oiPrev;
    if (chg === 0) continue;

    rows.push({
      expiry,
      strike,
      type,
      oiNow,
      oiPrev,
      chg,
      chgPct: oiPrev > 0 ? (chg / oiPrev) * 100 : null,
      spot,
      otmDistPct: (Math.abs(strike - spot) / spot) * 100,
    });
  }
  return rows;
}

// ── persistence ───────────────────────────────────────────────────────────────

async function writeRows(p, date, symbol, rows) {
  for (const r of rows) {
    await p.query(
      `INSERT INTO oi_change_snapshots
         (date, symbol, expiry, strike, opt_type, oi_now, oi_prev, oi_chg, oi_chg_pct, spot, otm, otm_dist_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11)
       ON CONFLICT (date, symbol, expiry, strike, opt_type) DO UPDATE SET
         oi_now = EXCLUDED.oi_now, oi_prev = EXCLUDED.oi_prev, oi_chg = EXCLUDED.oi_chg,
         oi_chg_pct = EXCLUDED.oi_chg_pct, spot = EXCLUDED.spot, otm_dist_pct = EXCLUDED.otm_dist_pct,
         ts = now()`,
      [date, symbol, r.expiry, r.strike, r.type, r.oiNow, r.oiPrev, r.chg, r.chgPct, r.spot, r.otmDistPct]
    );
  }
}

async function getDoneSymbols(p, date) {
  const { rows } = await p.query(
    `SELECT DISTINCT symbol FROM oi_change_snapshots WHERE date = $1`, [date]
  );
  return new Set(rows.map((r) => r.symbol));
}

async function pruneOld(p) {
  await p.query(
    `DELETE FROM oi_change_snapshots WHERE date < CURRENT_DATE - INTERVAL '${RETENTION_DAYS} days'`
  );
}

// ── sweep ─────────────────────────────────────────────────────────────────────

/**
 * One sweep pass. Idempotent per (date, symbol) — only fetches tickers that
 * don't already have today's rows, so re-running throughout the day is cheap
 * except for the first pass and any retries. `force` bypasses the daily
 * time-window gate (for the manual /proxy route).
 */
async function runSweep(opts = {}) {
  const force = !!opts.force;
  if (!force && !inDailyWindow()) return { skipped: 'outside window' };
  if (!(await ensureSchema())) return { skipped: 'no DB' };

  const p = getPool();
  const date = etDateStr();
  const prevDate = prevTradingDateStr(date);
  await pruneOld(p).catch((e) => console.warn('[oi-change] prune error:', e.message));

  const done = await getDoneSymbols(p, date);
  const roster = [...new Set(EQUITY_TICKERS)].map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  const todo = roster.filter((s) => !done.has(s));

  if (!todo.length) return { date, skipped: 'already complete', symbols: roster.length };

  console.log(`[oi-change] sweep ${date} vs ${prevDate} — ${todo.length}/${roster.length} symbols pending`);
  let ok = 0;
  let empty = 0;
  const failed = [];
  for (const symbol of todo) {
    try {
      const rows = await snapshotTicker(symbol, date, prevDate);
      if (rows.length) { await writeRows(p, date, symbol, rows); ok += 1; }
      else empty += 1; // OI not posted yet for this symbol — retry next tick
    } catch (e) {
      failed.push(`${symbol}:${e.message}`);
      console.warn(`[oi-change] ${symbol} — ${e.message}`);
    }
    await sleep(TICKER_DELAY_MS);
  }
  console.log(`[oi-change] sweep done — ${ok} written, ${empty} not-yet-posted, ${failed.length} failed`);
  return { date, prevDate, ok, empty, failed: failed.length, failures: failed.slice(0, 10) };
}

// ── scheduler ─────────────────────────────────────────────────────────────────

let _timer = null;
let _sweeping = false;
let _lastKey = null;

function startOiChangeRecorder() {
  console.log(`[oi-change] enabled — ${SWEEP_MINS}m retries inside 06:00-20:00 ET, ${EQUITY_TICKERS.length} EM tickers, OTM only`);
  const tick = async () => {
    if (!inDailyWindow()) return;
    const { hour, minute } = etParts();
    if (minute % SWEEP_MINS !== 0) return;
    const key = `${etDateStr()} ${hour}:${minute}`;
    if (key === _lastKey || _sweeping) return;
    _lastKey = key;
    _sweeping = true;
    runSweep()
      .catch((e) => console.warn('[oi-change] sweep error:', e.message))
      .finally(() => { _sweeping = false; });
  };
  _timer = setInterval(() => { void tick(); }, 60_000);
  _timer.unref?.();
  // Kick one off shortly after boot too (covers restarts mid-window).
  setTimeout(() => { runSweep().catch((e) => console.warn('[oi-change] initial sweep error:', e.message)); }, 25_000);
  return () => { if (_timer) clearInterval(_timer); };
}

module.exports = {
  startOiChangeRecorder,
  runSweep,
  ensureSchema,
  getPool,
  snapshotTicker,
  prevTradingDateStr,
};
