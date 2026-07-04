'use strict';
/**
 * server-v2/far-cb-recorder.js
 *
 * "Watch This" scanner — finds the single highest OI+Vol net-GEX strike (the
 * "CB" level) across ALL expirations within FAR_CB_MAX_DTE_DAYS for each ticker
 * in the EM watchlist, and flags it when that strike sits unusually far OTM
 * (i.e. NOT the normal near-the-money CB) — % distance from spot > threshold.
 *
 * Answers: "is there a farther-out strike that's grown into the dominant GEX
 * level for this name, way outside where CB normally sits?"
 *
 * Basis: OI+Vol net GEX (netGEX + netVolGEX) — same canonical basis as
 * mvc-auto-snapshot.js / gex-calculator.js oiVolNet().
 *
 * Table: far_cb_watch (date, symbol) — one row per ticker per day, upserted
 * every sweep; only rows that ever crossed the OTM threshold are kept (a
 * symbol that stops qualifying is deleted on its next sweep). Old dates pruned.
 *
 * Wiring: startFarCbRecorder(PORT) from server-with-proxy.js.
 * Read:   GET  /proxy/far-cb-watch
 * Manual: POST /proxy/far-cb-watch-run   (force = bypass RTH gate)
 */

const { computeGexRows } = require('./computation/gex-calculator');
const {
  fetchChainTheta,
  fetchGreeksTheta,
  fetchOpenInterestTheta,
  fetchVolumeTheta,
  fetchStockQuoteTheta,
  fetchIndexPriceTheta,
} = require('./proxy-thetadata');
const { EQUITY_TICKERS } = require('./em-tickers');

const INDEX_SYMBOLS = new Set(['SPX', 'NDX', 'VIX', 'RUT', 'XSP']);
const keyOf = (exp, strike, type) => `${exp}|${Number(strike)}|${type}`;
const oiVolNet = (r) => Number(r.netGEX ?? 0) + Number(r.netVolGEX ?? 0);

// ── tunables (env-overridable) ───────────────────────────────────────────────

const SWEEP_MINS      = Number(process.env.FAR_CB_SWEEP_MINS || 30);
const MAX_DTE_DAYS     = Number(process.env.FAR_CB_MAX_DTE_DAYS || 30);
const OTM_THRESHOLD_PCT = Number(process.env.FAR_CB_OTM_PCT || 15); // "far OTM" cutoff
const STRIKE_RANGE_PCT = Number(process.env.FAR_CB_STRIKE_RANGE_PCT || 40); // ± around spot, %
const TICKER_DELAY_MS  = Number(process.env.FAR_CB_TICKER_DELAY_MS || 500);
const EXPIRY_DELAY_MS  = Number(process.env.FAR_CB_EXPIRY_DELAY_MS || 150);
const MAX_EXPIRIES     = Number(process.env.FAR_CB_MAX_EXPIRIES || 6); // cap Theta load/ticker
const RETENTION_DAYS   = Number(process.env.FAR_CB_RETENTION_DAYS || 7);

const RTH_OPEN_MINS  = 9 * 60 + 30;
const RTH_CLOSE_MINS = 16 * 60;

const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// ── PG pool (same lazy pattern as oi-change-recorder.js) ─────────────────────

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
      console.warn('[far-cb] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      _schemaReady = false;
    });
    return pool;
  } catch (e) {
    console.error('[far-cb] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  if (_schemaReady) return true;
  const p = getPool();
  if (!p) return false;
  await p.query(`
    CREATE TABLE IF NOT EXISTS far_cb_watch (
      date        DATE              NOT NULL,
      symbol      TEXT              NOT NULL,
      strike      DOUBLE PRECISION  NOT NULL,
      expiry      TEXT              NOT NULL,
      gex_value   DOUBLE PRECISION  NOT NULL,
      spot        DOUBLE PRECISION  NOT NULL,
      otm_pct     DOUBLE PRECISION  NOT NULL,
      dte_days    INTEGER           NOT NULL,
      ts          TIMESTAMPTZ       NOT NULL DEFAULT now(),
      PRIMARY KEY (date, symbol)
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_far_cb_watch_date ON far_cb_watch (date, otm_pct DESC);`);
  _schemaReady = true;
  console.log(`[far-cb] schema ready — OTM threshold ${OTM_THRESHOLD_PCT}%, ${MAX_DTE_DAYS}d window`);
  return true;
}

// ── time helpers (mirrors strike-growth-recorder.js) ─────────────────────────

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

function isRthWindow() {
  const { hour, minute, weekday } = etParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(etDateStr())) return false;
  const mins = hour * 60 + minute;
  return mins >= RTH_OPEN_MINS && mins <= RTH_CLOSE_MINS;
}

function daysBetween(fromYmd, toYmd) {
  const a = new Date(`${fromYmd}T12:00:00Z`);
  const b = new Date(`${toYmd}T12:00:00Z`);
  return Math.round((b - a) / 86400000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── per-ticker scan ───────────────────────────────────────────────────────────

/**
 * Find the single highest |OI+Vol GEX| strike across all expiries within
 * MAX_DTE_DAYS for one ticker. Returns { strike, expiry, gexValue, spot,
 * otmPct, dteDays } or null if nothing usable.
 */
async function scanTicker(symbol) {
  let spot;
  if (INDEX_SYMBOLS.has(symbol.toUpperCase())) {
    spot = Number(await fetchIndexPriceTheta(symbol));
  } else {
    const quote = await fetchStockQuoteTheta(symbol);
    spot = Number(quote?.last ?? quote?.mark ?? 0);
  }
  if (!(spot > 0)) throw new Error(`spot 0 for ${symbol}`);

  const { contracts, expirations } = await fetchChainTheta(symbol);
  if (!expirations?.length) throw new Error(`no expirations ${symbol}`);

  const today = etDateStr();
  const targetExps = expirations
    .filter((e) => daysBetween(today, e) >= 0 && daysBetween(today, e) <= MAX_DTE_DAYS)
    .slice(0, MAX_EXPIRIES);
  if (!targetExps.length) throw new Error(`no expiries within ${MAX_DTE_DAYS}d for ${symbol}`);

  const loBound = spot * (1 - STRIKE_RANGE_PCT / 100);
  const hiBound = spot * (1 + STRIKE_RANGE_PCT / 100);

  let best = null; // { strike, expiry, gexValue, dteDays }

  for (const expiry of targetExps) {
    const expContracts = contracts.filter(
      (c) => c.expiration === expiry && c.strike >= loBound && c.strike <= hiBound
    );
    if (!expContracts.length) { await sleep(EXPIRY_DELAY_MS); continue; }

    let greekMap, oiMap, volMap;
    try {
      [greekMap, oiMap, volMap] = await Promise.all([
        fetchGreeksTheta(symbol, expiry).catch(() => new Map()),
        fetchOpenInterestTheta(symbol, expiry).catch(() => new Map()),
        fetchVolumeTheta(symbol, expiry).catch(() => new Map()),
      ]);
    } catch {
      await sleep(EXPIRY_DELAY_MS);
      continue;
    }

    const flatRows = [];
    for (const c of expContracts) {
      const k = keyOf(c.expiration, c.strike, c.type);
      const g = greekMap.get(k) || {};
      const oi = Number(oiMap.get(k)?.oi ?? 0);
      const vol = Number(volMap.get(k) ?? 0);
      const gamma = Math.abs(Number(g.gamma ?? 0));
      if (!(gamma > 0) && !(oi > 0) && !(vol > 0)) continue;
      flatRows.push({ strike: c.strike, side: c.type === 'C' ? 'call' : 'put', oi, volume: vol, gamma, delta: 0 });
    }

    if (flatRows.length) {
      const gexRows = computeGexRows(flatRows, spot);
      for (const r of gexRows) {
        const val = oiVolNet(r);
        if (!best || Math.abs(val) > Math.abs(best.gexValue)) {
          best = { strike: r.strike, expiry, gexValue: val, dteDays: daysBetween(today, expiry) };
        }
      }
    }
    await sleep(EXPIRY_DELAY_MS);
  }

  if (!best) return null;
  const otmPct = (Math.abs(best.strike - spot) / spot) * 100;
  return { ...best, spot, otmPct };
}

// ── persistence ───────────────────────────────────────────────────────────────

async function upsertOrClear(p, date, symbol, result) {
  if (result && result.otmPct > OTM_THRESHOLD_PCT) {
    await p.query(
      `INSERT INTO far_cb_watch (date, symbol, strike, expiry, gex_value, spot, otm_pct, dte_days, ts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (date, symbol) DO UPDATE SET
         strike = EXCLUDED.strike, expiry = EXCLUDED.expiry, gex_value = EXCLUDED.gex_value,
         spot = EXCLUDED.spot, otm_pct = EXCLUDED.otm_pct, dte_days = EXCLUDED.dte_days, ts = now()`,
      [date, symbol, result.strike, result.expiry, result.gexValue, result.spot, result.otmPct, result.dteDays]
    );
  } else {
    // No longer qualifies (or no data) — drop any stale row for today.
    await p.query(`DELETE FROM far_cb_watch WHERE date = $1 AND symbol = $2`, [date, symbol]);
  }
}

async function pruneOld(p) {
  await p.query(`DELETE FROM far_cb_watch WHERE date < CURRENT_DATE - INTERVAL '${RETENTION_DAYS} days'`);
}

// ── sweep ─────────────────────────────────────────────────────────────────────

async function runSweep(opts = {}) {
  const force = !!opts.force;
  if (!force && !isRthWindow()) return { skipped: 'outside RTH' };
  if (!(await ensureSchema())) return { skipped: 'no DB' };

  const p = getPool();
  const date = etDateStr();
  await pruneOld(p).catch((e) => console.warn('[far-cb] prune error:', e.message));

  const roster = [...new Set(EQUITY_TICKERS)].map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  console.log(`[far-cb] sweep ${date} — ${roster.length} symbols, OTM>${OTM_THRESHOLD_PCT}%, ${MAX_DTE_DAYS}d window`);

  let flagged = 0;
  const failed = [];
  for (const symbol of roster) {
    try {
      const result = await scanTicker(symbol);
      await upsertOrClear(p, date, symbol, result);
      if (result && result.otmPct > OTM_THRESHOLD_PCT) flagged += 1;
    } catch (e) {
      failed.push(`${symbol}:${e.message}`);
    }
    await sleep(TICKER_DELAY_MS);
  }
  console.log(`[far-cb] sweep done — ${flagged} flagged, ${failed.length} failed`);
  return { date, flagged, failed: failed.length, failures: failed.slice(0, 10) };
}

// ── scheduler ─────────────────────────────────────────────────────────────────

let _timer = null;
let _sweeping = false;
let _lastKey = null;

function startFarCbRecorder() {
  console.log(`[far-cb] enabled — ${SWEEP_MINS}m sweeps during RTH, OTM>${OTM_THRESHOLD_PCT}%, ≤${MAX_DTE_DAYS}d`);
  const tick = async () => {
    if (!isRthWindow()) return;
    const { hour, minute } = etParts();
    if (minute % SWEEP_MINS !== 0) return;
    const key = `${etDateStr()} ${hour}:${minute}`;
    if (key === _lastKey || _sweeping) return;
    _lastKey = key;
    _sweeping = true;
    runSweep()
      .catch((e) => console.warn('[far-cb] sweep error:', e.message))
      .finally(() => { _sweeping = false; });
  };
  _timer = setInterval(() => { void tick(); }, 60_000);
  _timer.unref?.();
  setTimeout(() => { runSweep().catch((e) => console.warn('[far-cb] initial sweep error:', e.message)); }, 30_000);
  return () => { if (_timer) clearInterval(_timer); };
}

module.exports = {
  startFarCbRecorder,
  runSweep,
  ensureSchema,
  getPool,
  scanTicker,
  OTM_THRESHOLD_PCT,
  MAX_DTE_DAYS,
};
