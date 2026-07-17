'use strict';
/**
 * server-v2/scanner-recorder.js
 *
 * MULTI-TICKER GEX scanner. Unlike greek-scanner-recorder.js (SPX-only, sourced
 * from the in-process /proxy/gex state), this sweeps an arbitrary list of roots
 * (SCANNER_TICKERS) using Theta REST bulk snapshots — one whole-chain call per
 * root per sweep — so it scales cheaply by ticker count and never touches the
 * stream or the single-SYMBOL SPX engine.
 *
 * Per sweep, for each root:
 *   1. fetch chain (expirations + contracts),
 *   2. resolve spot (index snapshot vs. stock snapshot),
 *   3. buildExpiryRows() for the nearest expiry (OI + greeks in one call each),
 *   4. computeGexSummary() → total net GEX, call/put walls, gex flip,
 *   5. write ONE aggregate row into scanner_snapshots.
 *
 * The /proxy/scanner endpoint ranks the latest row per ticker.
 *
 * Wiring: startScannerRecorder(PORT) from server-with-proxy.js.
 * Manual fire: POST /proxy/scanner-run
 * No-op unless SCANNER_TICKERS is set and DATABASE_URL is available.
 */

const { useTheta } = require('./config/data-source');
const thetaAdapter = useTheta() ? require('./proxy-thetadata') : require('./tt-snapshot');
const { computeGexSummary } = require('./computation/gex-calculator');

const INTERVAL_MINS = Number(process.env.SCANNER_INTERVAL_MINS || 5);
const MIN_STRIKES = 10; // guard: skip a ticker whose chain came back too thin

// Indices priced via /index snapshot; everything else via /stock snapshot.
const INDEX_ROOTS = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'VIX', 'RUT', 'XSP', 'DJX']);

const MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

const { SCANNER_TICKERS: DEFAULT_SCANNER_TICKERS } = require('./scanner-tickers');

function parseScannerTickers() {
  const env = String(process.env.SCANNER_TICKERS || '').trim();
  // Default to the curated scanner universe; env override still wins if set.
  if (!env) return [...DEFAULT_SCANNER_TICKERS];
  if (env.toUpperCase() === 'SCANNER') return [...DEFAULT_SCANNER_TICKERS];
  return env.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
}

// ── PG pool ──────────────────────────────────────────────────────────────────

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
      console.warn('[scanner] pool error:', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null; ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[scanner] pg unavailable:', e.message);
    pgUnavailable = true; return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (ensured) return true;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS scanner_snapshots (
        date          TEXT        NOT NULL,
        symbol        TEXT        NOT NULL,
        ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        spot          REAL,
        expiry        TEXT        NOT NULL DEFAULT '',
        total_net_gex REAL,
        call_wall     REAL,
        put_wall      REAL,
        gex_flip      REAL,
        strikes       INTEGER,
        PRIMARY KEY (date, symbol, ts)
      );
      CREATE INDEX IF NOT EXISTS idx_scanner_date_sym ON scanner_snapshots(date, symbol);
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error('[scanner] ensureSchema error:', e.message);
    return false;
  }
}

// ── Time helpers ───────────────────────────────────────────────────────────────

function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

function etDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

function isRTH() {
  const { hour, minute, weekday } = etParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (MARKET_HOLIDAYS.has(etDateStr())) return false;
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// ── Spot + per-ticker snapshot ───────────────────────────────────────────────

async function resolveSpot(root) {
  try {
    if (INDEX_ROOTS.has(root)) {
      const p = await thetaAdapter.fetchIndexPriceTheta(root);
      return p > 0 ? p : 0;
    }
    const q = await thetaAdapter.fetchStockQuoteTheta(root);
    return q && q.mark > 0 ? q.mark : (q && q.last > 0 ? q.last : 0);
  } catch {
    return 0;
  }
}

/** buildExpiryRows() rows -> gex-calculator input rows ({side,oi,gamma,...}). */
function toGexRows(expiryRows) {
  return expiryRows.map((r) => ({
    strike: r.strike,
    side: r.type === 'C' ? 'call' : 'put',
    oi: Number(r.oi ?? 0),
    volume: 0, // OI-basis scanner; volume can be layered in later if needed
    gamma: Number(r.gamma ?? 0),
    delta: Number(r.delta ?? 0),
    theta: Number(r.theta ?? 0),
    vega: Number(r.vega ?? 0),
    iv: Number(r.iv ?? 0),
    dte: r.dte,
  }));
}

/** Snapshot one root: returns the aggregate summary or null if not usable. */
async function snapshotTicker(root) {
  const chain = await thetaAdapter.fetchChainTheta(root).catch(() => null);
  const expiry = chain?.expirations?.[0];
  if (!expiry) return null;

  const [spot, expiryRows] = await Promise.all([
    resolveSpot(root),
    thetaAdapter.buildExpiryRows(root, expiry).catch(() => []),
  ]);
  if (!(spot > 0)) return null;

  const gexRows = toGexRows(expiryRows).filter((r) => r.oi > 0 || r.gamma !== 0);
  if (gexRows.length < MIN_STRIKES) return null;

  const summary = computeGexSummary(gexRows, spot);
  return {
    symbol: root,
    spot,
    expiry,
    totalNetGex: summary.totalNetGex,
    callWall: summary.callWall,
    putWall: summary.putWall,
    gexFlip: summary.gexFlip,
    strikes: summary.rows.length,
  };
}

// ── Sweep ────────────────────────────────────────────────────────────────────

async function runSweep({ force = false } = {}) {
  if (!force && !isRTH()) return { skipped: 'outside RTH' };

  const tickers = parseScannerTickers();
  if (!tickers.length) return { skipped: 'no SCANNER_TICKERS' };

  const p = getPool();
  if (!p || !(await ensureSchema())) return { skipped: 'no DB' };

  const date = etDateStr();
  const now = new Date();
  let written = 0;
  const errors = [];

  for (const root of tickers) {
    // Sequential — keep Theta REST load gentle across many roots.
    try {
      const s = await snapshotTicker(root); // eslint-disable-line no-await-in-loop
      if (!s) { errors.push(`${root}:thin/no-spot`); continue; }
      await p.query( // eslint-disable-line no-await-in-loop
        `INSERT INTO scanner_snapshots
           (date, symbol, ts, spot, expiry, total_net_gex, call_wall, put_wall, gex_flip, strikes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT DO NOTHING`,
        [date, root, now, s.spot, s.expiry, s.totalNetGex, s.callWall, s.putWall, s.gexFlip, s.strikes],
      );
      written++;
    } catch (e) {
      errors.push(`${root}:${String(e?.message || e).slice(0, 60)}`);
    }
  }

  console.log(`[scanner] wrote ${written}/${tickers.length} tickers @ ${now.toISOString()}${errors.length ? ` (skipped: ${errors.join(', ')})` : ''}`);
  return { ok: true, written, total: tickers.length, date, errors };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

function startScannerRecorder() {
  if (!parseScannerTickers().length) {
    console.log('[scanner] no SCANNER_TICKERS configured — recorder idle.');
    return;
  }
  const ms = INTERVAL_MINS * 60 * 1000;
  _timer = setInterval(() => {
    runSweep().catch((e) => console.warn('[scanner] sweep error:', e.message));
  }, ms);
  if (_timer.unref) _timer.unref();
  // Initial run after 12s so the terminal/feed can warm up.
  setTimeout(() => {
    runSweep().catch((e) => console.warn('[scanner] initial error:', e.message));
  }, 12_000);
  console.log(`[scanner] recorder started — sweeping ${parseScannerTickers().join(', ')} every ${INTERVAL_MINS}m`);
}

module.exports = { startScannerRecorder, runSweep, ensureSchema, getPool, parseScannerTickers };
