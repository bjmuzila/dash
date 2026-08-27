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
 * ── THE WHOLE ROSTER, EVERY MINUTE, ON ONE CONNECTION (2026-08-27) ──────────
 * The ES-Candles picker is no longer a fixed fourteen names — it offers the
 * far-CB core roster and accepts any typed ticker — so the recorder roster grew
 * to ~106 to match it.
 *
 * The first cut at that used fetchIntradayCandles per symbol, which opens a
 * THROWAWAY dxLink CONNECTION each time: connect, auth, subscribe, settle, tear
 * down. A hundred of those do not fit in a 60s tick, so it ran a round-robin and
 * a wide symbol was visited every ~8 minutes.
 *
 * That is gone. `fetchIntradayCandlesMulti` (candle-history.js) subscribes the
 * ENTIRE roster on ONE connection and demultiplexes by eventSymbol, so the
 * per-symbol handshake — which was all the round-robin was ever rationing —
 * disappears. Every symbol is now recorded every minute, and the recorder opens
 * ONE websocket a minute instead of the fourteen it opened before this change.
 *
 * The lanes remain as ROSTERS, not cadences: HOT is the scanner MAIN lane + SPX
 * (the file's own list), WIDE is the rest of far-CB core. They are swept
 * together in one call; the split survives only so either half can be disabled
 * or overridden on its own.
 */

// Only the MULTI form. The single-symbol fetchIntradayCandles is still the right
// call for a route serving one browser one ticker (/proxy/candles-intraday, and
// /api/snapshots/etf-candles' live fallback); a recorder sweeping a roster wants
// one connection, not one per name.
const { fetchIntradayCandlesMulti } = require('./candle-history');
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
// A symbol dxLink will not serve 1m candles for (some indices) simply comes
// back with no events on the shared subscription and writes nothing. On the
// multi-symbol path it costs nothing at all — it is not a failed request, just
// a symbol that never speaks.
const DEFAULT_CANDLE_SYMBOLS = [
  'SPX', 'SPY', 'QQQ', 'NDX', 'VIX',
  'AAPL', 'AMD', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'SPCX', 'TSLA',
];
const SYMBOLS = String(process.env.ETF_CANDLE_SYMBOLS || DEFAULT_CANDLE_SYMBOLS.join(','))
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

// ── WIDE roster ──────────────────────────────────────────────────────────────
// The far-CB core roster (far-cb-tickers.js CORE_TICKERS) minus whatever the hot
// list already covers — 93 names as of today. Same cadence as the hot list;
// this is a separate constant only so it can be overridden or switched off on
// its own.
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

/** Everything recorded this tick — hot first, so the log reads in priority order. */
function activeRoster() {
  return process.env.ETF_CANDLE_WIDE === '0' ? SYMBOLS.slice() : [...SYMBOLS, ...WIDE_SYMBOLS];
}

// Settle window and hard cap for the per-minute multi-symbol pull.
//
// Sized for the WHOLE roster arriving down one socket: a hundred snapshot
// bursts interleave, so the quiet gap is measured across all of them, and the
// hard cap has to be generous enough that a slow session does not truncate the
// tail of the roster. Both are well inside the 60s tick, and the overrun guard
// below catches it if they ever aren't.
const TICK_QUIET_MS = Math.max(500, Number(process.env.ETF_CANDLE_TICK_QUIET_MS || 3_000));
const TICK_HARD_MS = Math.max(5_000, Number(process.env.ETF_CANDLE_TICK_HARD_MS || 40_000));

// Sessions of 1-minute history pulled once on boot. dxFeed serves ~7 days of
// 1m, so 5 is the practical ceiling that still returns in one request; 0 skips
// the backfill entirely.
const BACKFILL_DAYS = Math.max(0, Math.min(7, Number(process.env.ETF_CANDLE_BACKFILL_DAYS ?? 5)));

// Symbols per boot-backfill call.
//
// The backfill asks for five sessions rather than one, so each symbol carries
// ~5x the bars of a normal tick and the whole roster in a single subscription
// would be a very large burst on one socket. Chunked at 25 it is four or five
// connections instead of one, each with a wide hard cap — still nothing next to
// the 106 the per-symbol version would have opened.
const BACKFILL_CHUNK = Math.max(1, Math.min(200, Number(process.env.ETF_CANDLE_BACKFILL_CHUNK || 25)));

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

// Overrun guard. setInterval does not care whether the last run finished —
// without this, a slow feed turns into overlapping ticks that stack another
// full-roster subscription onto a socket layer that is already struggling.
// Skipping is the right response and costs nothing: the next tick re-fetches
// the whole day anyway, so a missed minute is filled in a minute later.
let ticking = false;

async function tick() {
  if (ticking) {
    console.warn('[etf-candle] previous tick still running — skipping this one');
    return;
  }
  const p = getPool();
  if (!p || !(await ensureSchema())) return;
  if (!isMarketNowET()) return; // outside 04:00–20:00 ET there is nothing to record

  const roster = activeRoster();
  if (!roster.length) return;

  ticking = true;
  const t0 = Date.now();
  try {
    // ONE connection, the whole roster, today's bars from ET midnight.
    //
    // Every symbol every minute — which is what the GEX bubble trail needs, since
    // its finest bucket is one minute and a candle the bubbles have nothing to
    // sit on is a hole in the chart.
    const bySymbol = await fetchIntradayCandlesMulti(roster, '1m', etDayStartMs(), {
      quietMs: TICK_QUIET_MS, hardMs: TICK_HARD_MS,
    });

    // Writes are per symbol so one bad ladder cannot lose the rest of the tick.
    let wrote = 0;
    let silent = 0;
    for (const symbol of roster) {
      const candles = bySymbol.get(symbol) || [];
      if (!candles.length) { silent++; continue; }
      try {
        wrote += await upsertBars(p, symbol, candles); // eslint-disable-line no-await-in-loop
      } catch (e) {
        console.warn(`[etf-candle] ${symbol} write failed:`, e.message);
      }
    }
    // A tick where MOST of the roster said nothing is the signature of a feed
    // problem, not of a quiet tape, and it is otherwise completely silent —
    // upsertBars simply has nothing to do and returns 0. Half the roster is a
    // deliberately loose threshold: pre-market, plenty of these names genuinely
    // do not print.
    if (silent > roster.length / 2) {
      console.warn(`[etf-candle] ${silent}/${roster.length} symbols returned no bars this tick (${wrote} rows written)`);
    }
  } catch (e) {
    console.warn('[etf-candle] tick fetch failed:', e.message);
  } finally {
    ticking = false;
    const ms = Date.now() - t0;
    // Only when it actually overran. A tick that fits is not news.
    if (ms > INTERVAL_MS) {
      console.warn(`[etf-candle] tick took ${Math.round(ms / 1000)}s (> ${INTERVAL_MS / 1000}s interval) — lower ETF_CANDLE_TICK_HARD_MS or trim the roster`);
    }
  }
}

/**
 * One-shot history backfill. The per-minute tick only ever reaches back to
 * today's ET midnight, so a freshly-deployed server has no prior sessions — and
 * the ES-Candles chart wants a multi-day window. dxFeed serves roughly a week of
 * 1-minute bars, so pulling `days` back on boot fills the gap.
 * Idempotent: it goes through the same ON CONFLICT upsert as the tick.
 *
 * Runs regardless of RTH — the request is historical, not a live subscription.
 *
 * Defaults to the WHOLE roster, hot and wide. The per-symbol version of this
 * was a serial loop with a 60s hard cap each, which is fine for fourteen names
 * and up to an hour and a half of solid upstream traffic for a hundred and six —
 * starting at the exact moment the process is trying to come up. Chunked
 * multi-symbol pulls make it four or five connections instead.
 *
 * This is not cosmetic. `/api/snapshots/etf-candles` falls through to its live
 * dxLink pull only when the table is EMPTY for a symbol, so a symbol recorded
 * with today's bars ONLY would take the table branch and the chart would
 * silently lose the four prior sessions the fallback had been giving it. The
 * backfill is what keeps the table out of that half-filled state.
 */
async function backfill(days = BACKFILL_DAYS, symbols = activeRoster()) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return [];
  const from = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000;
  const out = [];
  for (let i = 0; i < symbols.length; i += BACKFILL_CHUNK) {
    const chunk = symbols.slice(i, i + BACKFILL_CHUNK);
    try {
      // Wide timeouts. The tick's caps are sized for one session (~390 bars a
      // symbol); a five-session replay is several thousand and would be silently
      // TRUNCATED mid-stream, leaving a partial history that looks like a
      // successful backfill.
      // eslint-disable-next-line no-await-in-loop
      const bySymbol = await fetchIntradayCandlesMulti(chunk, '1m', from, {
        quietMs: 4_000, hardMs: 120_000,
      });
      for (const symbol of chunk) {
        const candles = bySymbol.get(symbol) || [];
        try {
          const n = await upsertBars(p, symbol, candles); // eslint-disable-line no-await-in-loop
          const dates = [...new Set(candles.map((c) => ymdEtOf(Number(c.time))))].sort();
          out.push({ symbol, bars: n, dates });
        } catch (e) {
          out.push({ symbol, bars: 0, dates: [], error: e.message });
          console.warn(`[etf-candle] ${symbol} backfill write failed:`, e.message);
        }
      }
      // One line per CHUNK, not per symbol. A hundred and six "backfill AAPL:
      // 1950 bars" lines is not a boot log anyone reads; the names that produced
      // nothing are the only ones worth calling out.
      const empty = chunk.filter((s) => !(bySymbol.get(s) || []).length);
      const bars = out.slice(-chunk.length).reduce((a, r) => a + r.bars, 0);
      console.log(
        `[etf-candle] backfill ${i + 1}-${i + chunk.length}/${symbols.length}: ${bars} 1m bars over ~${days}d` +
        (empty.length ? ` — no data: ${empty.join(',')}` : ''),
      );
    } catch (e) {
      for (const symbol of chunk) out.push({ symbol, bars: 0, dates: [], error: e.message });
      console.warn(`[etf-candle] backfill chunk ${i + 1}-${i + chunk.length} failed:`, e.message);
    }
  }
  return out;
}

let _timer = null;

function startEtfCandleRecorder() {
  if (_timer) return;
  // Backfill FIRST, before any tick has run.
  //
  // The old reason for this ordering was the single-symbol cache: it keys on
  // `symbol|interval` with no fromTime, so whichever call ran first owned the
  // rows for the next 60s and a backfill scheduled after a tick was handed that
  // tick's today-only bars. The multi-symbol path is not cached at all, so that
  // particular race is gone — but the ordering is still right, because a chart
  // opened in the first minute should find history rather than one session.
  if (BACKFILL_DAYS > 0) {
    setTimeout(() => {
      backfill().catch((e) => console.warn('[etf-candle] backfill error:', e.message));
    }, 5_000);
  }
  _timer = setInterval(() => {
    tick().catch((e) => console.warn('[etf-candle] tick error:', e.message));
  }, INTERVAL_MS);
  if (_timer.unref) _timer.unref();
  // 20s is now AFTER the backfill starts but very likely DURING it. That is
  // fine: both write through the same idempotent upsert, and the tick's
  // today-only rows are a subset of what the backfill is fetching.
  setTimeout(() => {
    tick().catch((e) => console.warn('[etf-candle] initial tick error:', e.message));
  }, 20_000);
  const roster = activeRoster();
  console.log(
    `[etf-candle] recorder started — ${roster.length} symbols ` +
    `(${SYMBOLS.length} hot + ${roster.length - SYMBOLS.length} far-CB) 1m EVERY ${INTERVAL_MS / 1000}s ` +
    `on one dxLink connection (04:00-20:00 ET)` +
    (BACKFILL_DAYS > 0 ? `, ${BACKFILL_DAYS}d backfill on boot in chunks of ${BACKFILL_CHUNK}` : ''),
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
