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
const { CORE_TICKERS, getActiveRoster } = require('./far-cb-tickers');
// Bad-print wick filter, applied on READ (the table keeps the raw tape).
const despikeLib = require('./candle-despike');

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

// ── WIDE roster — LIVE, resolved per tick (2026-08-27) ──────────────────────
// far-CB's ACTIVE roster: the owner Watchlists page's Scanner list (itself
// falling back to scanner-tickers.js) ∪ customer-added far_cb_custom_tickers,
// minus whatever the hot list already covers.
//
// It was CORE_TICKERS — the frozen file array — with a note about not letting a
// watchlist edit add upstream load. That was the wrong trade: it made the
// Watchlists page a half-truth, where a name added there showed up in the
// scanners immediately and never got candles, with nothing on screen saying why.
// The load worry is answered by WIDE_MAX below, not by ignoring the page.
//
// Cheaper here than in the GEX recorder, too: every symbol rides the SAME
// dxLink subscription, so twenty more names is a longer subscribe list, not
// twenty more connections.
//
// Override with ETF_CANDLE_WIDE_SYMBOLS; disable with ETF_CANDLE_WIDE=0.
const WIDE_FALLBACK = (process.env.ETF_CANDLE_WIDE_SYMBOLS
  ? String(process.env.ETF_CANDLE_WIDE_SYMBOLS).split(',')
  : (Array.isArray(CORE_TICKERS) ? CORE_TICKERS : []))
  .map((s) => String(s).trim().toUpperCase())
  .filter(Boolean)
  .filter((s, i, a) => a.indexOf(s) === i)
  .filter((s) => !SYMBOLS.includes(s));

// Ceiling on the wide roster, whatever the page says. Past it the list is
// TRUNCATED in place (stable order, so existing names keep their series rather
// than the tail flapping in and out) and the recorder says so. A watchlist edit
// can leave a name uncovered; it cannot silently double the recorder's work.
const WIDE_MAX = Math.max(1, Math.min(600, Number(process.env.ETF_CANDLE_WIDE_MAX || 200)));
let lastTruncatedAt = 0;

/**
 * Everything recorded this tick — hot first, so the log and the subscription
 * both read in priority order.
 *
 * Async now, because the roster is live. roster-store caches for 15s and the
 * far-CB layer sits on it, so on almost every tick this is a memory read.
 */
async function activeRoster() {
  if (process.env.ETF_CANDLE_WIDE === '0') return SYMBOLS.slice();
  let wide;
  if (process.env.ETF_CANDLE_WIDE_SYMBOLS) {
    wide = WIDE_FALLBACK;
  } else {
    try {
      const live = [...new Set((await getActiveRoster()).map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
      wide = live.length ? live.filter((s) => !SYMBOLS.includes(s)) : WIDE_FALLBACK;
    } catch (e) {
      console.warn('[etf-candle] far-CB roster unavailable, using the file baseline:', e.message);
      wide = WIDE_FALLBACK;
    }
  }
  if (wide.length > WIDE_MAX) {
    // On CHANGE only — this runs every tick, and a warning that repeats 960
    // times a session is a warning nobody reads.
    if (lastTruncatedAt !== wide.length) {
      lastTruncatedAt = wide.length;
      console.warn(
        `[etf-candle] wide roster is ${wide.length} symbols, over the ${WIDE_MAX} cap — ` +
        `recording the first ${WIDE_MAX}, SKIPPING ${wide.slice(WIDE_MAX).join(',')}. ` +
        'Raise ETF_CANDLE_WIDE_MAX if the feed can take it.',
      );
    }
    wide = wide.slice(0, WIDE_MAX);
  }
  return [...SYMBOLS, ...wide];
}

/**
 * Symbols whose PRIOR sessions are already in the table.
 *
 * Seeded by the boot backfill and added to as the round goes on, so a name
 * added on the Watchlists page at 10:15 gets its five sessions on its first
 * tick rather than starting life with a stub of today. Without it that name
 * would take the table branch in /api/snapshots/etf-candles — which only falls
 * through to the live pull when the table is EMPTY — and the chart would show
 * one partial session with no indication anything was missing.
 */
const historied = new Set();

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

const ET_HM_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
});
/** ET minute-of-day (0–1439) of an epoch-ms instant. */
function etMinuteOf(ms) {
  const parts = ET_HM_FMT.formatToParts(new Date(ms));
  const get = (t) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  return (get('hour') % 24) * 60 + get('minute');
}
/** Epoch ms of 00:00 ET on the ET date `ymd` (DST-correct). */
function etMidnightMs(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  for (const off of [4, 5]) {
    const t = Date.UTC(y, m - 1, d, off);
    if (ymdEtOf(t) === ymd && etMinuteOf(t) === 0) return t;
  }
  return Date.UTC(y, m - 1, d, 5);
}

// ── Which bars are real (2026-10-07 audit) ───────────────────────────────────
// dxLink keeps emitting a cash index's last value after the 16:00 close — flat,
// zero-volume bars 16:00–16:20 — plus the odd stray print later (16:40, 16:48),
// and a quiet name's extended session can carry flat zero-volume carry-forward
// bars. None of them traded. So:
//   · a CASH INDEX keeps only its regular session, 09:30–16:00 ET — an index
//     has no extended tape (VIX is left out: its values are computed outside
//     RTH too, and only its flat zero-volume bars are dropped)
//   · anything else drops a bar outside 09:30–16:00 that is BOTH zero-volume
//     and flat (O = H = L = C); a real extended-hours print is kept
// Applied when writing (upsertBars) AND when reading (getEtfCandleHistory), so
// the rows already in the table stop drawing too.
const RTH_OPEN_MIN = 9 * 60 + 30;
const RTH_CLOSE_MIN = 16 * 60;
const CASH_INDEXES = new Set(['SPX', 'NDX', 'RUT', 'XSP', 'DJX', 'OEX']);
function keepBar(symbol, c) {
  const m = etMinuteOf(Number(c.time));
  if (m >= RTH_OPEN_MIN && m < RTH_CLOSE_MIN) return true;
  if (CASH_INDEXES.has(String(symbol).toUpperCase())) return false;
  const o = Number(c.open), h = Number(c.high), l = Number(c.low), cl = Number(c.close);
  const flat = o === h && h === l && l === cl;
  return !(flat && !(Number(c.volume) > 0));
}

// ── Tick / write ─────────────────────────────────────────────────────────────

// Postgres caps a statement at 65535 bind parameters. At 8 params per bar a
// 5-session backfill (~1950 bars) fits comfortably, but chunking keeps the
// statement small enough to stay fast and leaves headroom if the window grows.
const INSERT_CHUNK = 500;
/** A session date needs this many 1m rows to count as a session (getEtfCandleHistory). */
const SESSION_MIN_ROWS = 10;

/**
 * Upsert bars for one symbol. Each bar is stamped with ITS OWN ET session date
 * (see ymdEtOf) so the same function serves both the live tick and the
 * multi-day backfill. Returns the number of rows written.
 */
async function upsertBars(p, symbol, candlesIn) {
  if (!Array.isArray(candlesIn) || !candlesIn.length) return 0;
  // no post-close leftovers, no flat zero-volume carry-forwards (see keepBar)
  const candles = candlesIn.filter((c) => keepBar(symbol, c));
  if (!candles.length) return 0;
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
 * Log the roster ONLY when it changes.
 *
 * The roster is live now, so "what is this recorder covering" is not answerable
 * from the boot line — it can change at 10:15 because someone edited a page.
 * On change it becomes an audit trail of watchlist edits, which is what you
 * want when a ticker's series starts or stops.
 */
let lastRosterKey = '';
function announceRoster(roster) {
  const key = roster.join(',');
  if (key === lastRosterKey) return;
  const first = !lastRosterKey;
  lastRosterKey = key;
  console.log(
    `[etf-candle] roster ${first ? 'resolved' : 'CHANGED'} — ${roster.length} symbols ` +
    `(${SYMBOLS.length} hot + ${roster.length - SYMBOLS.length} far-CB)` +
    (first ? '' : ' (owner Watchlists edit picked up)'),
  );
}

// Overrun guard. setInterval does not care whether the last run finished —
// without this, a slow feed turns into overlapping ticks that stack another
// full-roster subscription onto a socket layer that is already struggling.
// Skipping is the right response and costs nothing: the next tick re-fetches
// the whole day anyway, so a missed minute is filled in a minute later.
let ticking = false;
// Set when the boot backfill was skipped for a market-hours start (see
// startEtfCandleRecorder): the first tick then treats the whole roster as
// already historied instead of backfilling every name through the tick path.
let seedHistoriedOnFirstTick = false;

// SHORT WINDOW, FULL SWEEP EVERY N TICKS (2026-10-09). Every tick used to pull
// the whole day from ET midnight for the whole roster: by 09:40 that was ~55k
// 1m bars down one socket and 11–17k rows upserted EVERY minute, the ticks ran
// 61–74s (> the 60s interval), most symbols came back empty at the 40s cap, and
// the dashboard process sat at 115% CPU with second-long event-loop stalls. And
// it grows all day, because the window does. Now a tick asks for the last
// TICK_LOOKBACK_MIN minutes (the upsert merges, so a short window only adds or
// corrects recent bars), and every FULL_EVERY-th tick — and the first after boot —
// still sweeps the whole day so a late-corrected bar or a missed tick is caught.
// ETF_CANDLE_TICK_LOOKBACK_MIN=0 restores the old whole-day pull every tick.
const TICK_LOOKBACK_MIN = Math.max(0, Number(process.env.ETF_CANDLE_TICK_LOOKBACK_MIN ?? 15));
const FULL_EVERY = Math.max(1, Number(process.env.ETF_CANDLE_FULL_EVERY ?? 15));
let tickCount = 0;

async function tick() {
  if (ticking) {
    console.warn('[etf-candle] previous tick still running — skipping this one');
    return;
  }
  const p = getPool();
  if (!p || !(await ensureSchema())) return;
  if (!isMarketNowET()) return; // outside 04:00–20:00 ET there is nothing to record

  const roster = await activeRoster();
  if (!roster.length) return;
  announceRoster(roster);

  ticking = true;
  const t0 = Date.now();
  try {
    // Names the Watchlists page added since boot. They need HISTORY, not just
    // today, or the chart opens on a stub — see `historied`. Done first and on
    // its own so the per-minute pull below stays one predictable-size request.
    if (seedHistoriedOnFirstTick) {
      roster.forEach((s) => historied.add(s));
      seedHistoriedOnFirstTick = false;
    }
    const fresh = BACKFILL_DAYS > 0 ? roster.filter((s) => !historied.has(s)) : [];
    if (fresh.length) {
      console.log(`[etf-candle] ${fresh.length} new symbol(s) on the roster — backfilling ${BACKFILL_DAYS}d: ${fresh.join(',')}`);
      // Marked before the await, not after: a failed backfill must not put the
      // symbol back in the queue on every tick for the rest of the session. It
      // still records today from the normal pull, and the next restart retries.
      fresh.forEach((s) => historied.add(s));
      await backfill(BACKFILL_DAYS, fresh).catch((e) => console.warn('[etf-candle] new-symbol backfill failed:', e.message));
    }

    // ONE connection, the whole roster, today's bars from ET midnight.
    //
    // Every symbol every minute — which is what the GEX bubble trail needs, since
    // its finest bucket is one minute and a candle the bubbles have nothing to
    // sit on is a hole in the chart.
    const dayStart = etDayStartMs();
    const full = TICK_LOOKBACK_MIN === 0 || tickCount % FULL_EVERY === 0;
    tickCount += 1;
    const from = full ? dayStart : Math.max(dayStart, Date.now() - TICK_LOOKBACK_MIN * 60_000);
    const bySymbol = await fetchIntradayCandlesMulti(roster, '1m', from, {
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
async function backfill(days = BACKFILL_DAYS, symbolsArg = null) {
  const p = getPool();
  if (!p || !(await ensureSchema())) return [];
  // Resolved INSIDE, not as a default parameter: activeRoster() is async now,
  // and a default of `activeRoster()` would bind the Promise itself and iterate
  // it as if it were an array — silently backfilling nothing.
  const symbols = symbolsArg || await activeRoster();
  // Whatever this run covers is history the table now has, so the per-tick
  // new-symbol check must not queue it again.
  symbols.forEach((s) => historied.add(s));
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
  // A RESTART DURING MARKET HOURS SKIPS THE BOOT BACKFILL (2026-10-09). The
  // five-session re-pull of the whole roster is the heaviest thing this recorder
  // does, and on 2026-10-09 a 09:18 restart ran it into the open alongside every
  // other boot job, pinning the dashboard's one core for the first hour. The
  // prior sessions are already in the table (it has been recording for weeks),
  // so in session the boot pass is pure cost. 08:00–16:30 ET on weekdays it is
  // skipped unless ETF_CANDLE_BACKFILL_DAYS is set explicitly; the per-minute
  // tick still records today from the first minute. Outside those hours (a
  // night or weekend restart) the backfill runs exactly as before.
  const { weekday, mins } = etWallMins();
  const inSession = weekday !== 'Sat' && weekday !== 'Sun' && mins >= 8 * 60 && mins < 16 * 60 + 30;
  const skipBoot = inSession && process.env.ETF_CANDLE_BACKFILL_DAYS == null;
  if (skipBoot) {
    seedHistoriedOnFirstTick = true;
    console.log('[etf-candle] market-hours start — boot backfill skipped (prior sessions are already recorded; set ETF_CANDLE_BACKFILL_DAYS to force it)');
  } else if (BACKFILL_DAYS > 0) {
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
  // No symbol COUNT here — it isn't known yet, and quoting a require-time list
  // would be the one thing this change exists to stop: a number that looks
  // authoritative and goes stale the moment someone edits the Watchlists page.
  // announceRoster() prints the real one on the first tick and on every change.
  console.log(
    `[etf-candle] recorder started — 1m EVERY ${INTERVAL_MS / 1000}s on one dxLink connection ` +
    `(04:00-20:00 ET), roster resolved per tick from the owner Watchlists page ` +
    `(${SYMBOLS.length} hot` +
    (process.env.ETF_CANDLE_WIDE === '0' ? ', wide lane off)' : ` + far-CB, cap ${WIDE_MAX})`) +
    (BACKFILL_DAYS > 0 && !skipBoot ? `, ${BACKFILL_DAYS}d backfill on boot in chunks of ${BACKFILL_CHUNK}` : ''),
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
    return despikeLib.despike(rows.map((r) => ({
      time: Number(r.timestamp), open: Number(r.open), high: Number(r.high),
      low: Number(r.low), close: Number(r.close), volume: Number(r.volume),
    })));
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
 * DAYS ARE SESSIONS (2026-10-07). `daysBack` used to be calendar days counted
 * back from now, so days=5 on a Wednesday afternoon reached into the previous
 * Friday's evening — three sessions and a stray Friday bar. It is now the
 * newest `daysBack` ET session dates that hold real bars: weekdays with at
 * least SESSION_MIN_ROWS rows, so a holiday's or a weekend's stray prints never
 * count as a session. The window opens at 00:00 ET of the oldest one.
 *
 * @param {string} symbol   SPY / QQQ
 * @param {number} daysBack Sessions of history (default 5)
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
  const sessions = Math.max(1, Math.min(60, Math.floor(Number(daysBack) || 5)));
  const cap = Math.max(1, Math.min(50_000, Number(limit) || 5000));
  const cashIndex = CASH_INDEXES.has(sym);

  try {
    // The newest `sessions` real session dates. The scan is bounded by the
    // primary key (symbol, timestamp): two calendar days per session plus a
    // week covers any run of holidays.
    const scanFrom = Date.now() - (sessions * 2 + 7) * 86_400_000;
    const { rows: dates } = await p.query(
      `SELECT date
         FROM etf_candles
        WHERE symbol = $1 AND timestamp >= $2::bigint
          AND EXTRACT(ISODOW FROM date::date) < 6
        GROUP BY date
       HAVING COUNT(*) >= $3
        ORDER BY date DESC
        LIMIT $4`,
      [sym, scanFrom, SESSION_MIN_ROWS, sessions],
    );
    if (!dates.length) return [];
    const since = etMidnightMs(String(dates[dates.length - 1].date));

    // Bad-print wicks are clamped on the 1m rows BEFORE bucketing (candle-despike.js),
    // so the 5m bars — and every roll-up the client builds from them — are clean.
    // The read starts SQL_PAD_MS early so the window's first bar has past neighbours;
    // `clean` then drops the padding.
    const { rows } = await p.query(
      `WITH raw AS (
         SELECT timestamp, date, open, high, low, close, volume
           FROM etf_candles
          WHERE symbol = $1 AND timestamp >= $2::bigint - $5::bigint
            -- keepBar(), in SQL: outside 09:30–16:00 ET a cash index keeps
            -- nothing, anything else drops flat zero-volume bars
            AND (
              (EXTRACT(HOUR FROM to_timestamp(timestamp / 1000.0) AT TIME ZONE 'America/New_York') * 60
               + EXTRACT(MINUTE FROM to_timestamp(timestamp / 1000.0) AT TIME ZONE 'America/New_York'))
                BETWEEN ${RTH_OPEN_MIN} AND ${RTH_CLOSE_MIN - 1}
              OR (NOT $8::boolean AND NOT (COALESCE(volume, 0) = 0 AND open = high AND high = low AND low = close))
            )
       ), nb AS (
         SELECT raw.*, ${despikeLib.SQL_NEIGHBOUR_COLS}
           FROM raw
         ${despikeLib.SQL_WINDOWS}
       ), clean AS (
         SELECT timestamp, date, open, close, volume, ${despikeLib.sqlClampCols('$6', '$7')}
           FROM nb
          WHERE timestamp >= $2::bigint
       )
       SELECT bucket_ts AS timestamp,
              MIN(date)                                            AS date,
              (ARRAY_AGG(open  ORDER BY timestamp ASC))[1]         AS open,
              MAX(high)                                            AS high,
              MIN(low)                                             AS low,
              (ARRAY_AGG(close ORDER BY timestamp DESC))[1]        AS close,
              SUM(volume)                                          AS volume
         FROM (
           SELECT (FLOOR(timestamp / $3::bigint) * $3::bigint) AS bucket_ts,
                  timestamp, date, open, high, low, close, volume
             FROM clean
         ) b
        GROUP BY bucket_ts
        ORDER BY bucket_ts DESC
        LIMIT $4`,
      [sym, since, bucketMs, cap, despikeLib.SQL_PAD_MS, despikeLib.PCT, despikeLib.MULT, cashIndex],
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
  // activeRoster is ASYNC now, because the roster is live. A health check asking
  // "what is this actually recording" gets the same answer the next tick will
  // use, rather than a frozen require-time list.
  SYMBOLS, activeRoster, tick,
};
