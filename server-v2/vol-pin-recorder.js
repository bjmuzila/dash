'use strict';
/**
 * server-v2/vol-pin-recorder.js
 *
 * Volatility Pinning scanner — snapshots per-ticker "pin readiness" every
 * SWEEP_MINS minutes during RTH:
 *
 *   ATM IV   — midpoint of nearest call/put IV from ThetaData greeks snapshot
 *   RV       — annualized realized vol from the stored spot-price time series
 *              (log-return std of 5-min spots × √(252×78))
 *   IV-RV%   — (ATM_IV − RV) / ATM_IV   [contraction = shrinking over time]
 *   Pin strike — strike with highest OI within ±10% of spot (front expiry)
 *   Range    — rolling intraday spot high−low / spot   [contraction = tightening]
 *
 * A ticker is a "pin candidate" when ALL of:
 *   • IV-RV spread is contracting (shrinking last 2+ snapshots)
 *   • Price range is contracting
 *   • Spot is within 0.5% of pin_strike (or approaching it)
 *
 * Tickers: re-uses the strike_growth_watchlist (active rows only, max MAX_ACTIVE).
 * Indices (SPX/NDX) are excluded from the pin scan — pinning is an equity effect.
 *
 * Table: vol_pin_snapshots
 *   date TEXT, symbol TEXT, expiry TEXT, ts TIMESTAMPTZ,
 *   spot REAL, atm_strike REAL, atm_call_iv REAL, atm_put_iv REAL, atm_iv REAL,
 *   pin_strike REAL, pin_strike_oi REAL,
 *   day_hi REAL, day_lo REAL, range_pct REAL,
 *   rv_ann REAL, iv_rv_spread REAL,
 *   PRIMARY KEY (date, symbol, ts)
 *
 * Wiring: startVolPinRecorder(PORT) from server-with-proxy.js.
 * Manual fire: POST /proxy/vol-pin-run
 */

const {
  fetchChainTheta,
  fetchOpenInterestTheta,
  fetchGreeksTheta,
  fetchStockQuoteTheta,
} = require('./proxy-thetadata');

// ── tunables ──────────────────────────────────────────────────────────────────

const SWEEP_MINS   = Number(process.env.VOL_PIN_SWEEP_MINS   || 5);
const TICKER_DELAY = Number(process.env.VOL_PIN_TICKER_DELAY_MS || 800);
const MAX_ACTIVE   = Number(process.env.VOL_PIN_MAX_ACTIVE   || 30);
// Strike window for pin search: look within this % of spot.
const PIN_SEARCH_PCT = 0.10; // ±10%

// Exclude pure indices — no pinning mechanics (no gamma hedging pressure from dealers).
const EXCLUDE = new Set(['SPX','NDX','VIX','RUT','XSP']);

const MARKET_HOLIDAYS = new Set([
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25',
  '2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31',
  '2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24',
]);

// ── PG pool ───────────────────────────────────────────────────────────────────

let pool = null;
let pgUnavailable = false;
let ensured = false;

function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) { pgUnavailable = true; return null; }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
        ? undefined : { rejectUnauthorized: false },
      max: 2, keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[vol-pin] pool error:', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[vol-pin] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (ensured) return true;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS vol_pin_snapshots (
        date          TEXT        NOT NULL,
        symbol        TEXT        NOT NULL,
        expiry        TEXT        NOT NULL DEFAULT '',
        ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        spot          REAL,
        atm_strike    REAL,
        atm_call_iv   REAL,
        atm_put_iv    REAL,
        atm_iv        REAL,
        pin_strike    REAL,
        pin_strike_oi REAL,
        day_hi        REAL,
        day_lo        REAL,
        range_pct     REAL,
        rv_ann        REAL,
        iv_rv_spread  REAL,
        PRIMARY KEY (date, symbol, ts)
      );
      CREATE INDEX IF NOT EXISTS idx_vpin_date_sym ON vol_pin_snapshots(date, symbol);
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error('[vol-pin] ensureSchema error:', e.message);
    return false;
  }
}

// ── time helpers ──────────────────────────────────────────────────────────────

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
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

function isRTH() {
  const { hour, minute, weekday } = etParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(etDateStr())) return false;
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// ── RV from stored spot history ───────────────────────────────────────────────
// Annualized via 5-min bar factor: sqrt(252 * 78) ≈ 140.4 (78 bars/day at 5m).
// For SWEEP_MINS=5 each stored row = 1 bar. Use last ~24 rows (2 hours).
const RV_ANNUAL_FACTOR = Math.sqrt(252 * Math.round(390 / SWEEP_MINS));

async function calcRv(p, date, symbol) {
  try {
    const { rows } = await p.query(
      `SELECT spot FROM vol_pin_snapshots
       WHERE date = $1 AND symbol = $2 AND spot > 0
       ORDER BY ts DESC LIMIT 24`,
      [date, symbol],
    );
    if (rows.length < 3) return null;
    const spots = rows.map((r) => Number(r.spot)).reverse(); // oldest first
    const returns = [];
    for (let i = 1; i < spots.length; i++) {
      returns.push(Math.log(spots[i] / spots[i - 1]));
    }
    const n = returns.length;
    const mean = returns.reduce((a, v) => a + v, 0) / n;
    const variance = returns.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1);
    return Math.sqrt(variance) * RV_ANNUAL_FACTOR;
  } catch { return null; }
}

// ── per-ticker snapshot ───────────────────────────────────────────────────────

async function snapshotTicker(symbol, date, p) {
  // Spot price (equity only — indices excluded at call site).
  const quote = await fetchStockQuoteTheta(symbol).catch(() => null);
  const spot = Number(quote?.last ?? quote?.mark ?? 0);
  if (!(spot > 0)) { console.warn(`[vol-pin] ${symbol}: no spot, skipping`); return; }

  // Front expiry.
  const chain = await fetchChainTheta(symbol).catch(() => null);
  if (!chain?.expirations?.length) { console.warn(`[vol-pin] ${symbol}: no expirations`); return; }
  const expiry = chain.expirations[0];

  // Greeks for ATM IV.
  const greekMap = await fetchGreeksTheta(symbol, expiry).catch(() => new Map());
  let bestDelta = Infinity, atm_strike = 0, atm_call_iv = 0, atm_put_iv = 0;
  for (const [key, g] of greekMap) {
    const [, strikeStr, type] = key.split('|');
    const strike = Number(strikeStr);
    const dist = Math.abs(strike - spot);
    if (type === 'call' && dist < bestDelta) {
      bestDelta = dist; atm_strike = strike;
      atm_call_iv = Number(g.iv ?? 0);
    }
    if (type === 'put' && strike === atm_strike) atm_put_iv = Number(g.iv ?? 0);
  }
  // If put wasn't found in first pass, pick it up now.
  if (!(atm_put_iv > 0) && atm_strike > 0) {
    const pk = `${expiry}|${atm_strike}|put`;
    const pg = greekMap.get(pk);
    if (pg) atm_put_iv = Number(pg.iv ?? 0);
  }
  const atm_iv = atm_call_iv > 0 && atm_put_iv > 0
    ? (atm_call_iv + atm_put_iv) / 2
    : atm_call_iv || atm_put_iv;

  if (!(atm_iv > 0)) { console.warn(`[vol-pin] ${symbol}: no ATM IV`); return; }

  // OI → pin strike (highest OI within ±PIN_SEARCH_PCT of spot).
  const oiMap = await fetchOpenInterestTheta(symbol, expiry).catch(() => new Map());
  let pin_strike = 0, pin_strike_oi = 0;
  const lo = spot * (1 - PIN_SEARCH_PCT), hi = spot * (1 + PIN_SEARCH_PCT);
  for (const [key, oi] of oiMap) {
    const [, strikeStr] = key.split('|');
    const strike = Number(strikeStr);
    const totalOi = Number(oi?.callOI ?? 0) + Number(oi?.putOI ?? 0);
    if (strike >= lo && strike <= hi && totalOi > pin_strike_oi) {
      pin_strike = strike; pin_strike_oi = totalOi;
    }
  }

  // Day hi/lo from stored spots + current spot.
  const { rows: hiloRows } = await p.query(
    `SELECT MAX(spot) AS dhi, MIN(spot) AS dlo
     FROM vol_pin_snapshots WHERE date = $1 AND symbol = $2 AND spot > 0`,
    [date, symbol],
  ).catch(() => ({ rows: [{}] }));
  const day_hi = Math.max(Number(hiloRows[0]?.dhi ?? spot), spot);
  const day_lo = Math.min(Number(hiloRows[0]?.dlo ?? spot), spot);
  const range_pct = day_lo > 0 ? (day_hi - day_lo) / day_lo : 0;

  // RV from stored series.
  const rv_ann = await calcRv(p, date, symbol);
  const iv_rv_spread = rv_ann != null && atm_iv > 0 ? (atm_iv - rv_ann) / atm_iv : null;

  const now = new Date();
  await p.query(
    `INSERT INTO vol_pin_snapshots
       (date, symbol, expiry, ts, spot, atm_strike, atm_call_iv, atm_put_iv, atm_iv,
        pin_strike, pin_strike_oi, day_hi, day_lo, range_pct, rv_ann, iv_rv_spread)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT DO NOTHING`,
    [date, symbol, expiry, now, spot, atm_strike, atm_call_iv, atm_put_iv, atm_iv,
     pin_strike || null, pin_strike_oi || null,
     day_hi, day_lo, range_pct, rv_ann, iv_rv_spread],
  );
  return { symbol, spot, atm_iv, rv_ann, iv_rv_spread, pin_strike };
}

// ── sweep ─────────────────────────────────────────────────────────────────────

async function runSweep({ force = false } = {}) {
  if (!force && !isRTH()) return { skipped: 'outside RTH' };
  const p = getPool();
  if (!p || !(await ensureSchema())) return { skipped: 'no DB' };

  // Load active watchlist (equities only — no indices in vol-pin scan).
  const { rows: wl } = await p.query(
    `SELECT symbol FROM strike_growth_watchlist
     WHERE active = TRUE ORDER BY sort_idx ASC, symbol ASC LIMIT $1`,
    [MAX_ACTIVE],
  ).catch(() => ({ rows: [] }));

  const tickers = wl.map((r) => r.symbol).filter((s) => !EXCLUDE.has(s));
  if (!tickers.length) return { skipped: 'empty watchlist' };

  const date = etDateStr();
  const results = [];
  for (const sym of tickers) {
    try {
      const r = await snapshotTicker(sym, date, p);
      if (r) results.push(r);
    } catch (e) {
      console.warn(`[vol-pin] ${sym} error:`, e.message);
    }
    await new Promise((r) => setTimeout(r, TICKER_DELAY));
  }

  console.log(`[vol-pin] sweep done: ${results.length}/${tickers.length} tickers @ ${new Date().toISOString()}`);
  return { ok: true, swept: results.length };
}

// ── scheduler ─────────────────────────────────────────────────────────────────

let _timer = null;

function startVolPinRecorder() {
  const ms = SWEEP_MINS * 60 * 1000;
  _timer = setInterval(() => {
    runSweep().catch((e) => console.warn('[vol-pin] sweep error:', e.message));
  }, ms);
  setTimeout(() => {
    runSweep().catch((e) => console.warn('[vol-pin] initial error:', e.message));
  }, 15_000);
  console.log(`[vol-pin] recorder started — sweeping every ${SWEEP_MINS}m`);
}

module.exports = { startVolPinRecorder, runSweep, ensureSchema, getPool };
