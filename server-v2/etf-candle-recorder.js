'use strict';
/**
 * server-v2/state/etf-candle-recorder.js
 *
 * Server-side recorder for 1-minute OHLC candles on every ES-Candles symbol
 * that is not ES itself — SPY/QQQ plus the scanner MAIN lane as of 2026-08-16.
 * Runs on its own
 * interval across the extended session (04:00–20:00 ET) so the day's bars are
 * persisted going forward —
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
 * Sits ALONGSIDE the existing SPX-side recorders (eod-gex, ticker-wall, etc.).
 *
 * Wiring: startEtfCandleRecorder() from server-with-proxy.js.
 * Read side: getEtfCandles(symbol, date) — available for a future read route;
 * the /test Condition card currently reads today live via /proxy/candles-intraday.
 *
 * ── TWO LANES (2026-08-27) ──────────────────────────────────────────────────
 * The ES-Candles picker is no longer a fixed fourteen names — it offers the
 * far-CB core roster and accepts any typed ticker — so the recorder roster grew
 * to match it. It could not simply grow in place: every symbol is a THROWAWAY
 * dxLink CONNECTION (connect, subscribe, settle, tear down — seconds, not
 * milliseconds), taken serially, and 106 of those do not fit in a 60s tick.
 *
 *   HOT  — the scanner MAIN lane + SPX. Every tick. These are the charts people
 *          actually leave open, and they get a fresh forming bar every minute.
 *   WIDE — the rest of the far-CB core. ROUND-ROBIN: each tick takes the next
 *          WIDE_BATCH names, so a tick's cost is bounded and the roster is
 *          covered every ceil(n/batch) minutes.
 *
 * The wide lane's staleness is bounded and its HISTORY is not thin, which is the
 * part that is easy to get wrong: every fetch replays the whole day from ET
 * midnight, so a symbol visited once every 8 minutes still ends the session with
 * a complete, gapless 1-minute series — only the newest bar or two lag.
 *
 * See LAZY BACKFILL below for how a wide symbol gets its PRIOR sessions without
 * a 93-request burst at boot.
 */

const { fetchIntradayCandles } = require('./candle-history');
const { CORE_TICKERS } = require('./far-cb-tickers');

const INTERVAL_MS = Number(process.env.ETF_CANDLE_RECORDER_INTERVAL_MS || 60_000);
// ── HOT lane ─────────────────────────────────────────────────────────────────
// Roster mirrors etf-gex-recorder's hot lane: a symbol with recorded gamma but
// no recorded bars renders as an empty ES-Candles chart, because useEtfCandles
// has nothing to draw the trail on.
//
// SPX IS HERE NOW. It used to be excluded ("SPX stays on the ES-basis
// pipeline"), which was true while ES was the only way to look at SPX gamma. It
// isn't: /es-candles has an SPX symbol that draws the SAME $SPX gamma on the
// CASH INDEX's candles, with no basis in the way. Without a recorded series
// every SPX chart load fell through to /api/snapshots/etf-candles' live dxLink
// fallback — a websocket round trip per card per 60s poll, forever.
//
// Note the asymmetry with etf-gex-recorder, which still excludes SPX and must:
// there, two writers on one key would fight over the heatmap's DISTINCT ON.
// Here there is no second writer — nothing else records SPX bars — so recording
// it is simply the missing half.
//
// A symbol dxLink will not serve 1m candles for (some indices) simply logs and
// is skipped by the per-symbol try/catch in tick(); it costs one failed fetch
// per visit and nothing else.
const DEFAULT_CANDLE_SYMBOLS = [
  'SPX', 'SPY', 'QQQ', 'NDX', 'VIX',
  'AAPL', 'AMD', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'SPCX', 'TSLA',
];
const SYMBOLS = String(process.env.ETF_CANDLE_SYMBOLS || DEFAULT_CANDLE_SYMBOLS.join(','))
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

// ── WIDE lane ────────────────────────────────────────────────────────────────
// The far-CB core roster (far-cb-tickers.js CORE_TICKERS) minus whatever the hot
// lane already covers — 93 names as of today.
//
// CORE_TICKERS and not getActiveRoster(): the static array needs no Postgres
// round trip at module load, and the active roster is the scanner universe plus
// every customer-added ticker, which would let one person's watchlist edit add
// permanent per-minute upstream load here. Same reasoning as the picker's own
// lookup route. Override with ETF_CANDLE_WIDE_SYMBOLS; disable with
// ETF_CANDLE_WIDE=0.
const WIDE_SYMBOLS = (process.env.ETF_CANDLE_WIDE_SYMBOLS
  ? String(process.env.ETF_CANDLE_WIDE_SYMBOLS).split(',')
  : (Array.isArray(CORE_TICKERS) ? CORE_TICKERS : []))
  .map((s) => String(s).trim().toUpperCase())
  .filter(Boolean)
  .filter((s, i, a) => a.indexOf(s) === i)
  .filter((s) => !SYMBOLS.includes(s));

// How many wide names per tick.
//
// 12 → the 93-name roster is covered every 8 minutes, and a tick adds ~12
// sequential dxLink round trips (~20-25s) on top of the hot lane's 14. That is
// the number to move if ticks start overrunning the interval — the overrun
// guard below will say so in the log before anything is actually lost.
const WIDE_BATCH = Math.max(1, Math.min(60, Number(process.env.ETF_CANDLE_WIDE_BATCH || 12)));
let wideCursor = 0;

// Sessions of 1-minute history pulled once on boot. dxFeed serves ~7 days of
// 1m, so 5 is the practical ceiling that still returns in one request; 0 skips
// the backfill entirely.
const BACKFILL_DAYS = Math.max(0, Math.min(7, Number(process.env.ETF_CANDLE_BACKFILL_DAYS ?? 5)));

// ── LAZY BACKFILL (wide lane) ────────────────────────────────────────────────
// A wide symbol's FIRST visit pulls BACKFILL_DAYS of history instead of just
// today; every visit after that is the normal today-only fetch.
//
// The boot backfill cannot be used for these. It is a serial loop with
// cache:false and a 60s hard cap per symbol — fine for fourteen names, and up to
// an hour and a half of solid upstream traffic for ninety-three, starting at the
// exact moment the process is trying to come up.
//
// Doing it on first visit spreads the same work across the round-robin at one
// symbol per slot, at no extra request: the visit was going to happen anyway,
// it just asks for a wider window. The roster is fully backfilled about one
// coverage period after boot.
//
// This matters more than it looks. `/api/snapshots/etf-candles` falls through to
// its live dxLink pull only when the table is EMPTY for a symbol — so a wide
// symbol recorded with today's bars ONLY would take the table branch and the
// chart would silently lose the four prior sessions it used to get from the
// fallback. First-visit backfill means the table is never in that half-filled
// state.
const wideBackfilled = new Set();

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

// Equity EXTENDED hours: 04:00–20:00 ET, weekdays.
//
// Was 09:30–16:00 (RTH only), which left a 17.5-hour hole every weekday night
// in which nothing was written. That was invisible until you looked at the
// chart pre-market: the last SPY/QQQ bar would be from 16:00 the previous day,
// and the only reason pre-market bars ever appeared was the boot backfill
// happening to run after 04:00 — i.e. by accident, on restart.
//
// The bounds are the real pre/post-market session, so this now tracks when SPY
// and QQQ actually trade rather than when the primary session is open. Volume
// out there is thin — single-digit shares a minute overnight — and bars only
// print on a trade, so expect gaps. A gappy line is correct, not a stall.
//
// etDayStartMs() already anchors the fetch to ET midnight, so the per-minute
// path picks up pre-market with no other change.
function isMarketNowET() {
  const { weekday, mins } = etWallMins();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return mins >= 240 && mins < 1200; // 04:00–20:00 ET
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

/**
 * Record one symbol.
 *
 * `wide` symbols get a MULTI-DAY window on their first visit (see the lazy
 * backfill note above) and today only thereafter. The multi-day pull needs
 * cache:false and wider timeouts for exactly the reason the boot backfill does:
 * the cache key is `symbol|interval` with no fromTime in it, and the default 7s
 * hard cap is sized for one session's ~390 bars, so a five-session request would
 * be silently truncated mid-stream and look like a successful backfill.
 */
async function recordOne(p, symbol, { wide = false } = {}) {
  const needsHistory = wide && BACKFILL_DAYS > 0 && !wideBackfilled.has(symbol);
  const candles = needsHistory
    ? await fetchIntradayCandles(symbol, '1m', Date.now() - BACKFILL_DAYS * 86_400_000, {
      cache: false, quietMs: 2_500, hardMs: 60_000,
    })
    : await fetchIntradayCandles(symbol, '1m', etDayStartMs());
  const n = await upsertBars(p, symbol, candles);
  if (needsHistory) {
    // Marked EVEN IF the pull came back empty. A symbol dxLink will not serve
    // candles for must not re-request a 60s-capped five-session window on every
    // pass through the round-robin for the rest of the process's life.
    wideBackfilled.add(symbol);
    console.log(`[etf-candle] wide backfill ${symbol}: ${n} 1m bars over ~${BACKFILL_DAYS}d`);
  }
  return n;
}

// Overrun guard. A tick is a long serial run of network round trips, and
// setInterval does not care whether the last one finished — without this, a
// slow upstream turns into overlapping ticks that queue more connections on an
// already-struggling feed. Skipping is the right response: the next tick picks
// up where this one left off (the round-robin cursor is only advanced by a run
// that actually happens) and the forming bar is re-upserted anyway.
let ticking = false;

async function tick() {
  if (ticking) {
    console.warn('[etf-candle] previous tick still running — skipping this one');
    return;
  }
  const p = getPool();
  if (!p || !(await ensureSchema())) return;
  if (!isMarketNowET()) return; // outside 04:00–20:00 ET there is nothing to record

  ticking = true;
  const t0 = Date.now();
  try {
    // HOT first, always, and in full. If the tick is going to run long, the
    // names people have on screen are the ones that must not be the casualty.
    for (const symbol of SYMBOLS) {
      try {
        await recordOne(p, symbol); // eslint-disable-line no-await-in-loop
      } catch (e) {
        console.warn(`[etf-candle] ${symbol} record failed:`, e.message);
      }
    }

    // WIDE: the next WIDE_BATCH names, wrapping. The cursor advances by the
    // batch regardless of per-symbol failures — a name that cannot be fetched
    // must not park the round-robin on itself and starve the rest.
    if (process.env.ETF_CANDLE_WIDE !== '0' && WIDE_SYMBOLS.length) {
      const batch = [];
      for (let i = 0; i < Math.min(WIDE_BATCH, WIDE_SYMBOLS.length); i++) {
        batch.push(WIDE_SYMBOLS[(wideCursor + i) % WIDE_SYMBOLS.length]);
      }
      wideCursor = (wideCursor + batch.length) % WIDE_SYMBOLS.length;
      for (const symbol of batch) {
        try {
          await recordOne(p, symbol, { wide: true }); // eslint-disable-line no-await-in-loop
        } catch (e) {
          console.warn(`[etf-candle] ${symbol} record failed:`, e.message);
        }
      }
    }
  } finally {
    ticking = false;
    const ms = Date.now() - t0;
    // Only when it actually overran. A tick that fits is not news.
    if (ms > INTERVAL_MS) {
      console.warn(`[etf-candle] tick took ${Math.round(ms / 1000)}s (> ${INTERVAL_MS / 1000}s interval) — lower ETF_CANDLE_WIDE_BATCH`);
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
async function backfill(days = BACKFILL_DAYS, symbols = SYMBOLS) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return [];
  const from = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000;
  const out = [];
  for (const symbol of symbols) {
    try {
      // cache:false + wide timeouts. The default 7s hard cap is sized for one
      // session (~390 bars); a five-session replay is several thousand and would
      // be silently TRUNCATED mid-stream, leaving a partial history that looks
      // like a successful backfill. cache:false because the cache key is
      // symbol|interval with no fromTime in it.
      // eslint-disable-next-line no-await-in-loop
      const candles = await fetchIntradayCandles(symbol, '1m', from, {
        cache: false, quietMs: 2_500, hardMs: 60_000,
      });
      const n = await upsertBars(p, symbol, candles); // eslint-disable-line no-await-in-loop
      const dates = [...new Set(candles.map((c) => ymdEtOf(Number(c.time))))].sort();
      out.push({ symbol, bars: n, dates });
      console.log(`[etf-candle] backfill ${symbol}: ${n} 1m bars over ~${days}d (${dates.join(', ') || 'no sessions'})`);
    } catch (e) {
      out.push({ symbol, bars: 0, dates: [], error: e.message });
      console.warn(`[etf-candle] ${symbol} backfill failed:`, e.message);
    }
  }
  return out;
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
  const wideOn = process.env.ETF_CANDLE_WIDE !== '0' && WIDE_SYMBOLS.length;
  console.log(
    `[etf-candle] recorder started — hot ${SYMBOLS.length} (${SYMBOLS.join('/')}) 1m every ${INTERVAL_MS / 1000}s` +
    (wideOn
      // The coverage period is the number that actually describes the wide lane,
      // so it is computed here rather than left for someone to work out from the
      // batch size at 3am.
      ? `; wide ${WIDE_SYMBOLS.length} round-robin ${WIDE_BATCH}/tick (~${Math.ceil(WIDE_SYMBOLS.length / WIDE_BATCH)}min coverage, ${BACKFILL_DAYS}d backfill on first visit)`
      : '; wide lane off') +
    ` (04:00-20:00 ET)` +
    (BACKFILL_DAYS > 0 ? `, ${BACKFILL_DAYS}d hot backfill on boot` : ''),
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
  // Exported so a health check / owner page can ask what is actually being
  // recorded without re-deriving the two rosters from the env vars.
  SYMBOLS, WIDE_SYMBOLS, tick,
};
