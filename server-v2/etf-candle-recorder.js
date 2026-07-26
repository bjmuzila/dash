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
const SYMBOLS = String(process.env.ETF_CANDLE_SYMBOLS || 'SPY,QQQ')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
// Sessions of 1-minute history pulled once on boot. dxFeed serves ~7 days of
// 1m, so 5 is the practical ceiling that still returns in one request; 0 skips
// the backfill entirely.
const BACKFILL_DAYS = Math.max(0, Math.min(7, Number(process.env.ETF_CANDLE_BACKFILL_DAYS ?? 5)));

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

/**
 * ET session date (YYYY-MM-DD) for an arbitrary bar timestamp. The per-tick
 * writer can get away with `todayYmdET()` because it only ever inserts today's
 * bars; the BACKFILL walks several sessions, so each bar must be stamped with
 * its OWN date or a week of history lands under one key and every date-filtered
 * read returns the wrong day.
 */
const ET_DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
function ymdEtOf(ms) {
  return ET_DATE_FMT.format(new Date(ms));
}

// ── Tick / write ─────────────────────────────────────────────────────────────

// Postgres caps a statement at 65535 bind parameters. At 8 params per bar a
// 5-session backfill (~1950 bars) fits comfortably, but chunking keeps the
// statement small enough to stay fast and leaves headroom if the window grows.
const INSERT_CHUNK = 500;

/**
 * Upsert bars for one symbol. Each bar is stamped with ITS OWN ET session date
 * (see ymdEtOf) so the same function serves both the live tick and the
 * multi-day backfill. Returns the number of rows written.
 */
async function upsertBars(p, symbol, candles) {
  if (!Array.isArray(candles) || !candles.length) return 0;
  let written = 0;
  for (let off = 0; off < candles.length; off += INSERT_CHUNK) {
    const slice = candles.slice(off, off + INSERT_CHUNK);
    const cols = [];
    const vals = [];
    slice.forEach((c, i) => {
      const b = i * 8;
      const ts = Number(c.time);
      cols.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`);
      vals.push(symbol, ts, ymdEtOf(ts), Number(c.open), Number(c.high), Number(c.low), Number(c.close), Number(c.volume) || 0);
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
    written += slice.length;
  }
  return written;
}

async function tick() {
  const p = getPool();
  if (!p || !(await ensureSchema())) return;
  if (!isRthNowET()) return; // SPY/QQQ 1m only meaningful during RTH

  for (const symbol of SYMBOLS) {
    try {
      const candles = await fetchIntradayCandles(symbol, '1m', etDayStartMs()); // eslint-disable-line no-await-in-loop
      await upsertBars(p, symbol, candles); // eslint-disable-line no-await-in-loop
    } catch (e) {
      console.warn(`[etf-candle] ${symbol} record failed:`, e.message);
    }
  }
}

/**
 * One-shot history backfill. The per-minute tick only ever reaches back to
 * today's ET midnight, so a freshly-deployed server has no prior sessions — and
 * the ES-Candles chart wants a multi-day window. dxFeed serves roughly a week of
 * 1-minute bars, so pulling `days` back on boot fills the gap in one request per
 * symbol. Idempotent: it goes through the same ON CONFLICT upsert as the tick.
 *
 * Runs regardless of RTH — the request is historical, not a live subscription.
 */
async function backfill(days = BACKFILL_DAYS) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return;
  const from = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000;
  for (const symbol of SYMBOLS) {
    try {
      const candles = await fetchIntradayCandles(symbol, '1m', from); // eslint-disable-line no-await-in-loop
      const n = await upsertBars(p, symbol, candles); // eslint-disable-line no-await-in-loop
      console.log(`[etf-candle] backfill ${symbol}: ${n} 1m bars over ~${days}d`);
    } catch (e) {
      console.warn(`[etf-candle] ${symbol} backfill failed:`, e.message);
    }
  }
}

let _timer = null;

function startEtfCandleRecorder() {
  if (_timer) return;
  // Backfill FIRST, before any tick has run.
  //
  // fetchIntradayCandles caches on `symbol|interval` only — `fromTime` is NOT
  // part of the key — so whichever call runs first owns the cache for the next
  // 60s and the other is served its rows. Ordering the backfill after a tick
  // means it gets handed that tick's today-only bars and writes no history at
  // all, and because the periodic interval also fires at t=60s there is no safe
  // gap to slot it into during RTH. Running it first inverts the race harmlessly:
  // the first tick may be served the backfill's rows, which are a superset of
  // what it wanted (the same 1m bars, reaching further back).
  if (BACKFILL_DAYS > 0) {
    setTimeout(() => {
      backfill().catch((e) => console.warn('[etf-candle] backfill error:', e.message));
    }, 5_000);
  }
  _timer = setInterval(() => {
    tick().catch((e) => console.warn('[etf-candle] tick error:', e.message));
  }, INTERVAL_MS);
  if (_timer.unref) _timer.unref();
  setTimeout(() => {
    tick().catch((e) => console.warn('[etf-candle] initial tick error:', e.message));
  }, 20_000);
  console.log(
    `[etf-candle] recorder started — ${SYMBOLS.join('/')} 1m (RTH) every ${INTERVAL_MS / 1000}s` +
    (BACKFILL_DAYS > 0 ? `, ${BACKFILL_DAYS}d backfill on boot` : ''),
  );
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

/**
 * Rolling history in the ES-Candles record shape, aggregated up from the stored
 * 1-minute bars.
 *
 * Only 1m is PERSISTED. Anything coarser is derived here in SQL rather than
 * recorded separately, because dxLink's {=5m} stream is an independent
 * aggregation — recording both would mean two tables that disagree at the edges
 * and a second backfill to keep in sync. Floor-bucketing the 1m rows gives
 * exact, reproducible 5m bars from the one source of truth.
 *
 * open/close come from the first/last bar in each bucket (FIRST_VALUE /
 * LAST_VALUE over the bucket, not MIN/MAX of the timestamps), high/low/volume
 * are the bucket's max/min/sum.
 *
 * @param {string} symbol   SPY / QQQ
 * @param {number} daysBack Calendar days of history (default 5)
 * @param {1|5}    interval Bar size in minutes
 * @param {number} limit    Max bars returned (most recent kept)
 * @returns {Promise<Array<{timestamp:number,date:string,slotKey:string,time:string,symbol:string,intervalMinutes:number,open:number,high:number,low:number,close:number,volume:number}>>}
 */
async function getEtfCandleHistory(symbol, daysBack = 5, interval = 5, limit = 5000) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return [];
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return [];
  const iv = Number(interval) === 1 ? 1 : 5;
  const bucketMs = iv * 60_000;
  const since = Date.now() - Math.max(1, Number(daysBack) || 5) * 24 * 60 * 60 * 1000;
  const cap = Math.max(1, Math.min(50_000, Number(limit) || 5000));

  try {
    const { rows } = await p.query(
      `SELECT bucket_ts AS timestamp,
              MIN(date)                                            AS date,
              (ARRAY_AGG(open  ORDER BY timestamp ASC))[1]         AS open,
              MAX(high)                                            AS high,
              MIN(low)                                             AS low,
              (ARRAY_AGG(close ORDER BY timestamp DESC))[1]        AS close,
              SUM(volume)                                          AS volume
         FROM (
           SELECT (FLOOR(timestamp / $3::bigint) * $3::bigint) AS bucket_ts,
                  timestamp, date, open, high, low, close, volume
             FROM etf_candles
            WHERE symbol = $1 AND timestamp >= $2
         ) b
        GROUP BY bucket_ts
        ORDER BY bucket_ts DESC
        LIMIT $4`,
      [sym, since, bucketMs, cap],
    );

    // Query returns newest-first (so LIMIT keeps the most RECENT bars); the
    // chart wants oldest-first.
    return rows.reverse().map((r) => {
      const ts = Number(r.timestamp);
      // slotKey / time are ET wall-clock, matching lib/snapdb's es_candles rows
      // so the page's existing merge-by-slotKey and slot-average code works
      // against ETF bars unchanged.
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hourCycle: 'h23',
        hour: '2-digit', minute: '2-digit',
      }).formatToParts(new Date(ts));
      const get = (t) => parts.find((x) => x.type === t)?.value ?? '00';
      const hhmm = `${get('hour')}:${get('minute')}`;
      const date = String(r.date ?? ymdEtOf(ts));
      return {
        timestamp: ts,
        date,
        slotKey: `${date}T${hhmm}`,
        time: `${hhmm}:00`,
        symbol: sym,
        intervalMinutes: iv,
        source: 'etf_candles',
        open: Number(r.open), high: Number(r.high),
        low: Number(r.low), close: Number(r.close),
        volume: Number(r.volume) || 0,
      };
    });
  } catch (e) {
    console.warn('[etf-candle] getEtfCandleHistory query failed:', e.message);
    return [];
  }
}

module.exports = {
  startEtfCandleRecorder, getEtfCandles, getEtfCandleHistory,
  backfill, ensureSchema, getPool,
};
