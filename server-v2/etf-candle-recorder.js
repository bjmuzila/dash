'use strict';
/**
 * server-v2/state/etf-candle-recorder.js
 *
 * Server-side recorder for SPY / QQQ 1-minute OHLC candles. Runs on its own
 * interval during RTH so today's session bars are persisted going forward —
 * building a real intraday history in Postgres instead of depending on the
 * on-demand dxLink snapshot each browser pulls (which only covers whatever
 * `fromTime` the client asks for, and vanishes when the tab closes).
 *
 * Same isolated dxLink candle fetch the /proxy/candles-intraday route uses
 * (candle-history.js fetchIntradayCandles) — SPY{=1m}/QQQ{=1m} from today's ET
 * session start — upserted one row per bar into etf_candles. The forming bar is
 * re-upserted each tick (ON CONFLICT DO UPDATE), so its close/high/low/volume
 * finalize as the minute completes.
 *
 * Sits ALONGSIDE the existing SPX-side recorders (eod-gex, ticker-wall, etc.);
 * SPX itself stays on the ES-basis pipeline and is not recorded here.
 *
 * Wiring: startEtfCandleRecorder() from server-with-proxy.js.
 * Read side: getEtfCandles(symbol, date) — available for a future read route;
 * the /test Condition card currently reads today live via /proxy/candles-intraday.
 */

const { fetchIntradayCandles } = require('./candle-history');

const INTERVAL_MS = Number(process.env.ETF_CANDLE_RECORDER_INTERVAL_MS || 60_000);
const SYMBOLS = ['SPY', 'QQQ'];

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
        ? undefined
        : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[etf-candle] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
      ensured = false;
    });
    return pool;
  } catch (e) {
    console.error('[etf-candle] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  if (ensured) return true;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS etf_candles (
        symbol     TEXT   NOT NULL,
        timestamp  BIGINT NOT NULL,   -- bar-start epoch ms
        date       TEXT   NOT NULL,   -- ET session date (YYYY-MM-DD)
        open       REAL,
        high       REAL,
        low        REAL,
        close      REAL,
        volume     REAL,
        PRIMARY KEY (symbol, timestamp)
      );
      CREATE INDEX IF NOT EXISTS idx_etf_candles_symbol_date_ts ON etf_candles(symbol, date, timestamp);
    `);
    ensured = true;
    return true;
  } catch (e) {
    console.error('[etf-candle] ensureSchema error:', e.message);
    return false;
  }
}

// ── Time helpers ─────────────────────────────────────────────────────────────
function todayYmdET() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function etWallMins() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => parts.find((x) => x.type === t)?.value ?? '';
  return { weekday: get('weekday'), mins: Number(get('hour')) * 60 + Number(get('minute')) };
}

function isRthNowET() {
  const { weekday, mins } = etWallMins();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return mins >= 570 && mins < 960; // 9:30–16:00 ET
}

/** Epoch ms of today's ET midnight — session-only fetch anchor (no overnight). */
function etDayStartMs() {
  const { mins } = etWallMins();
  return Date.now() - mins * 60_000;
}

// ── Tick / write ─────────────────────────────────────────────────────────────
async function tick() {
  const p = getPool();
  if (!p || !(await ensureSchema())) return;
  if (!isRthNowET()) return; // SPY/QQQ 1m only meaningful during RTH
  const date = todayYmdET();

  for (const symbol of SYMBOLS) {
    try {
      const candles = await fetchIntradayCandles(symbol, '1m', etDayStartMs()); // eslint-disable-line no-await-in-loop
      if (!Array.isArray(candles) || !candles.length) continue;

      const cols = [];
      const vals = [];
      candles.forEach((c, i) => {
        const b = i * 8;
        cols.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`);
        vals.push(symbol, Number(c.time), date, Number(c.open), Number(c.high), Number(c.low), Number(c.close), Number(c.volume) || 0);
      });

      await p.query( // eslint-disable-line no-await-in-loop
        `INSERT INTO etf_candles (symbol, timestamp, date, open, high, low, close, volume)
         VALUES ${cols.join(',')}
         ON CONFLICT (symbol, timestamp) DO UPDATE SET
           high   = GREATEST(etf_candles.high, EXCLUDED.high),
           low    = LEAST(etf_candles.low, EXCLUDED.low),
           close  = EXCLUDED.close,
           volume = GREATEST(etf_candles.volume, EXCLUDED.volume)`,
        vals,
      );
    } catch (e) {
      console.warn(`[etf-candle] ${symbol} record failed:`, e.message);
    }
  }
}

let _timer = null;

function startEtfCandleRecorder() {
  if (_timer) return;
  _timer = setInterval(() => {
    tick().catch((e) => console.warn('[etf-candle] tick error:', e.message));
  }, INTERVAL_MS);
  if (_timer.unref) _timer.unref();
  setTimeout(() => {
    tick().catch((e) => console.warn('[etf-candle] initial tick error:', e.message));
  }, 20_000);
  console.log(`[etf-candle] recorder started — SPY/QQQ 1m (RTH) every ${INTERVAL_MS / 1000}s`);
}

// ── Read side ────────────────────────────────────────────────────────────────
/** Today's (or `date`'s) recorded 1-min candles for one symbol, oldest-first. */
async function getEtfCandles(symbol, date) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return [];
  const d = date || todayYmdET();
  try {
    const { rows } = await p.query(
      `SELECT timestamp, open, high, low, close, volume
         FROM etf_candles
        WHERE symbol = $1 AND date = $2
        ORDER BY timestamp ASC`,
      [String(symbol).toUpperCase(), d],
    );
    return rows.map((r) => ({
      time: Number(r.timestamp), open: Number(r.open), high: Number(r.high),
      low: Number(r.low), close: Number(r.close), volume: Number(r.volume),
    }));
  } catch (e) {
    console.warn('[etf-candle] getEtfCandles query failed:', e.message);
    return [];
  }
}

module.exports = { startEtfCandleRecorder, getEtfCandles, ensureSchema, getPool };
