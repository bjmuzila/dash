'use strict';
/**
 * server-v2/etf-live-candles.js
 *
 * The LIVE half of the ETF candle story. `etf-candle-recorder.js` persists a
 * 1-minute bar per symbol once a minute; this file keeps the FORMING bar
 * current between those writes, so a chart can tick in near-real-time instead
 * of stepping once a minute.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * SPY/QQQ (and every other typed ticker on ES-Candles) have no /ws/gex stream —
 * that feed is SPX/ES. Their bars reach the browser over HTTP, and the whole
 * chain used to be minute-granular at BOTH ends: the recorder wrote once a
 * minute, and `useEtfCandles` polled once a minute. Worst case a candle on
 * screen was ~2 minutes behind the tape.
 *
 * ── Two ways to read it ────────────────────────────────────────────────────
 * `getLiveCandleRows()` is a pull — the 2s probe route reads the map and
 * answers. `subscribeLive()` is a push — the SSE route registers a callback
 * and the hub calls it the moment a candle event lands, which takes the
 * client's staleness from "poll interval + latency" down to just latency.
 *
 * Both hold the SAME subscription and read the SAME bars. The difference is
 * only who starts the conversation.
 *
 * ── What it does ───────────────────────────────────────────────────────────
 * ONE persistent dxLink connection, subscribed to `SYMBOL{=1m}` for the symbols
 * a browser is ACTUALLY LOOKING AT, holding the last few bars per symbol in
 * memory. dxFeed streams the forming bar as it changes, so the map is current
 * to the tick. `/api/snapshots/etf-candles/live` reads that map and returns the
 * last bucket or two — a couple hundred bytes — which the client merges over
 * its history at a 2s poll.
 *
 * ── Why a persistent connection and not candle-history.js ──────────────────
 * `fetchIntradayCandles` opens a THROWAWAY dxLink connection per call: connect,
 * auth, subscribe, settle, tear down — seconds of handshake for one answer, and
 * a 60s cache on top. Polling that every 2 seconds would be a new websocket
 * every 2 seconds. The handshake is exactly what a persistent connection
 * amortises away, which is the same reasoning that turned the recorder's
 * per-symbol fetch into `fetchIntradayCandlesMulti`.
 *
 * ── Interest, not a roster ─────────────────────────────────────────────────
 * There is no symbol list in this file. A symbol goes live because a browser
 * asked for it, and stays live for INTEREST_MS after the last ask. With nobody
 * looking, the connection closes. That is what keeps this from becoming a
 * second always-on feed for a 106-name roster nobody is watching.
 *
 * ── What it does NOT do ────────────────────────────────────────────────────
 * It does not write to Postgres and it does not replace the recorder. The
 * recorder is still the system of record for history; this is a volatile
 * in-memory overlay on top of the newest minute. If it fails, is off-hours, or
 * the feed is down, callers get an empty answer and the chart falls back to the
 * 60-second recorded path with no error path of its own.
 *
 * NOTE ON proxy-tastytrade.js: this file IMPORTS `DxLinkClient` and
 * `getQuoteToken` and changes nothing in them. It does add ONE dxLink
 * connection while a chart is open, alongside the main feed's.
 *
 * Wiring: nothing to start. The hub connects lazily on the first request and
 * closes itself when interest lapses.
 */

const { DxLinkClient, getQuoteToken } = require('./proxy-tastytrade');

// ── Tunables ────────────────────────────────────────────────────────────────
// One /live request keeps a symbol hot this long. Must comfortably exceed the
// client's poll period (2s) plus a slow request, or a symbol being actively
// watched flickers in and out of the subscription set.
const INTEREST_MS = Math.max(5_000, Number(process.env.ETF_LIVE_INTEREST_MS || 20_000));
// Nobody interested for this long → drop the connection entirely.
const IDLE_CLOSE_MS = Math.max(30_000, Number(process.env.ETF_LIVE_IDLE_MS || 120_000));
// dxFeed replays bars since this far back when we subscribe. It must cover more
// than one bucket of the LARGEST interval a caller can ask for (5m), or the
// first aggregate after a fresh subscribe would be a partial bucket with the
// wrong open/high/low. See `clipIncomplete` below for the guard that enforces it.
const WARMUP_MS = Math.max(5 * 60_000, Number(process.env.ETF_LIVE_WARMUP_MS || 20 * 60_000));
// Retained 1m bars per symbol. 16 covers three whole 5m buckets.
const KEEP_BARS = 16;
// A dropped socket retries this often while anything is still interested.
const RECONNECT_MS = 5_000;
// The connection accumulates subscriptions — DxLinkClient has no candle
// unsubscribe, and adding one would mean editing the proxy. Past this many
// stale names the connection is rebuilt instead, which re-subscribes only what
// is currently wanted. Someone paging through tickers hits this; nobody else does.
const MAX_SUBS = Math.max(4, Number(process.env.ETF_LIVE_MAX_SUBS || 24));
const SWEEP_MS = 15_000;

// ── State ───────────────────────────────────────────────────────────────────
let client = null;
let connecting = false;
let authed = false;
let reconnectTimer = null;
let sweepTimer = null;
let lastInterestAt = 0;

const interest = new Map();   // SYMBOL → epoch ms the interest expires
const subscribed = new Set(); // SYMBOL — sent on the CURRENT connection
const canonToSym = new Map(); // canonical dxFeed candle symbol → SYMBOL
const bars = new Map();       // SYMBOL → Map(barStartMs → bar)
// ── Streams hold a symbol open; polls only rent it ──────────────────────────
// A poll's interest EXPIRES — that is what lets a closed tab release a
// subscription without any teardown code. An SSE connection is the opposite:
// it is explicitly open, it will be explicitly closed, and its symbol must not
// lapse underneath it just because 20 seconds went by without a new request.
// So streams are counted, not timed, and `hasWatchers()` is the union.
const streams = new Map();    // SYMBOL → open SSE connection count
const listeners = new Map();  // SYMBOL → Set<fn> called on every candle event

/** Every symbol something is currently reading, by either route. */
function watchedSymbols() {
  return new Set([...interest.keys(), ...streams.keys()]);
}

/** Is anything at all reading this hub right now? */
function hasWatchers() {
  return interest.size > 0 || streams.size > 0;
}

// ── ET helpers ──────────────────────────────────────────────────────────────
// Row shape must match etf-candle-recorder / /api/snapshots/etf-candles exactly,
// because the client merges these rows into that series BY slotKey.
const ET_HM = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
});
const ET_YMD = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const ET_WD = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' });

/** Same 04:00–20:00 ET weekday window the recorder uses. Nothing to stream outside it. */
function isLiveWindowET() {
  if (process.env.ETF_LIVE_IGNORE_HOURS === '1') return true;
  const now = new Date();
  const wd = ET_WD.format(now);
  if (wd === 'Sat' || wd === 'Sun') return false;
  const parts = ET_HM.formatToParts(now);
  const get = (t) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  const mins = get('hour') * 60 + get('minute');
  return mins >= 240 && mins < 1200;
}

// ── Connection ──────────────────────────────────────────────────────────────

function subscribeSymbol(sym) {
  if (!client || subscribed.has(sym)) return;
  subscribed.add(sym);
  const candleSymbol = `${sym}{=1m}`;
  // dxFeed echoes candle symbols back canonicalized, and an implicit 1-multiplier
  // is DROPPED: "QQQ{=1m}" streams back tagged "QQQ{=m}". Matching on the sent
  // string silently discards every event — the exact trap candle-history.js
  // documents at length.
  canonToSym.set(DxLinkClient.canonCandleSymbol(candleSymbol), sym);
  // subscribeCandle queues internally until the FEED channel opens, so calling
  // it before auth completes is correct and intentional.
  client.subscribeCandle(candleSymbol, Date.now() - WARMUP_MS);
}

function onCandleEvent(ev) {
  if (ev.eventType !== 'Candle') return;
  const sym = canonToSym.get(DxLinkClient.canonCandleSymbol(ev.eventSymbol));
  if (!sym) return;
  const t = Number(ev.time);
  const close = Number(ev.close);
  if (!(t > 0) || !(close > 0)) return;
  let volume = Number(ev.volume);
  if (!Number.isFinite(volume)) volume = 0;

  let m = bars.get(sym);
  if (!m) { m = new Map(); bars.set(sym, m); }
  const prev = m.get(t);
  // Identical reduction to candle-history.js: dxFeed re-sends a bar as it forms,
  // so the last close wins, the range only widens, and volume is the MAX (it is
  // cumulative within the bar) rather than a sum.
  m.set(t, prev
    ? {
      time: t,
      open: prev.open,
      high: Math.max(prev.high, Number(ev.high) || prev.high),
      low: Math.min(prev.low, Number(ev.low) || prev.low),
      close,
      volume: Math.max(prev.volume, volume),
    }
    : {
      time: t,
      open: Number(ev.open) || close,
      high: Number(ev.high) || close,
      low: Number(ev.low) || close,
      close,
      volume,
    });

  if (m.size > KEEP_BARS) {
    const ordered = [...m.keys()].sort((a, b) => a - b);
    for (let i = 0; i < ordered.length - KEEP_BARS; i++) m.delete(ordered[i]);
  }

  // Push. Listeners are told a symbol moved, not what it moved to — the
  // subscriber reads the map itself, so a burst of events (the snapshot replay
  // on a fresh subscribe is ~20 bars in a few hundred ms) coalesces naturally
  // into however many reads the subscriber chooses to do.
  //
  // Wrapped: a throwing listener is a broken client connection, and it must not
  // take down the feed handler for every other symbol on the socket.
  const subs = listeners.get(sym);
  if (subs) {
    for (const fn of subs) {
      try { fn(sym); } catch { /* one dead listener is not the feed's problem */ }
    }
  }
}

function closeConnection(reason) {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  const had = !!client;
  try { client?.close(); } catch { /* noop */ }
  client = null;
  authed = false;
  connecting = false;
  subscribed.clear();
  canonToSym.clear();
  if (had && reason) console.log(`[etf-live] connection closed — ${reason}`);
}

function scheduleReconnect() {
  if (reconnectTimer || !hasWatchers()) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (hasWatchers()) ensureConnection();
  }, RECONNECT_MS);
  if (reconnectTimer.unref) reconnectTimer.unref();
}

function ensureConnection() {
  if (client || connecting) return;
  if (!hasWatchers() || !isLiveWindowET()) return;
  connecting = true;
  getQuoteToken().then(({ token, url }) => {
    // Every watcher can go away during the token round trip.
    if (!hasWatchers()) { connecting = false; return; }
    const c = new DxLinkClient({
      url,
      token,
      onEvent: onCandleEvent,
      onStatus: (s) => {
        if (!s) return;
        if (s.dxlinkConnected) {
          if (authed) return; // status repeats; subscribe exactly once per connection
          authed = true;
          const want = watchedSymbols();
          for (const sym of want) subscribeSymbol(sym);
          console.log(`[etf-live] streaming 1m candles for ${[...want].join(',') || '(none)'}`);
        } else if (c === client) {
          // Close or error on the CURRENT connection. A late status from a
          // connection we already replaced must not tear down the new one.
          authed = false;
          closeConnection(null);
          scheduleReconnect();
        }
      },
    });
    client = c;
    connecting = false;
    try { c.connect(); } catch (e) {
      console.warn('[etf-live] connect failed:', e.message);
      closeConnection(null);
      scheduleReconnect();
    }
  }).catch((e) => {
    connecting = false;
    console.warn('[etf-live] quote token failed:', e.message);
    scheduleReconnect();
  });
}

/**
 * Housekeeping: expire interest, forget cold symbols' bars, close on idle, and
 * rebuild a connection that has collected too many dead subscriptions.
 */
function sweep() {
  const now = Date.now();
  for (const [sym, until] of interest) {
    // A symbol with an open stream keeps its bars even when the poll interest
    // that first created them lapses — dropping the map would restart that
    // symbol's history from the next event, and the stream would go quiet for
    // as long as the snapshot took to replay.
    if (until <= now) {
      interest.delete(sym);
      if (!streams.has(sym)) bars.delete(sym);
    }
  }
  if (!hasWatchers()) {
    if (client && now - lastInterestAt > IDLE_CLOSE_MS) closeConnection('idle');
    return;
  }
  if (!isLiveWindowET()) { closeConnection('outside 04:00-20:00 ET'); return; }
  const wanted = watchedSymbols().size;
  if (client && subscribed.size > MAX_SUBS && subscribed.size > wanted * 2) {
    // No candle unsubscribe exists on DxLinkClient, so a symbol stays on the
    // wire for the life of the connection. Rebuilding is the cheap way to shed
    // them without touching the proxy.
    closeConnection(`${subscribed.size} subscriptions for ${wanted} watched symbols — rebuilding`);
  }
  ensureConnection();
}

function startSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweep, SWEEP_MS);
  if (sweepTimer.unref) sweepTimer.unref();
}

// ── Read side ───────────────────────────────────────────────────────────────

/** Shape one aggregated bucket into the recorded-row shape the chart merges by slotKey. */
function shapeRow(symbol, b, intervalMinutes) {
  const d = new Date(b.time);
  const parts = ET_HM.formatToParts(d);
  const get = (t) => parts.find((x) => x.type === t)?.value ?? '00';
  const hhmm = `${get('hour')}:${get('minute')}`;
  const date = ET_YMD.format(d);
  return {
    timestamp: b.time,
    date,
    slotKey: `${date}T${hhmm}`,
    time: `${hhmm}:00`,
    symbol,
    intervalMinutes,
    source: 'dxlink-live',
    open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
  };
}

/**
 * Live bars for `symbols`, aggregated to `interval` minutes, newest `maxBuckets`
 * buckets only. REGISTERS INTEREST as a side effect — asking is what keeps a
 * symbol subscribed — and starts the connection if it isn't up.
 *
 * Returns `{}` for anything with no live data yet (first call, off-hours, feed
 * down). That is a normal answer, not an error: the caller already has the
 * recorded series and simply has nothing to overlay.
 *
 * @param {string[]} symbols
 * @param {1|5} interval
 * @param {number} maxBuckets
 * @returns {Record<string, Array<object>>} symbol → rows, oldest-first
 */
function getLiveCandleRows(symbols, interval = 1, maxBuckets = 2) {
  const { list, iv, want } = normalizeRead(symbols, interval, maxBuckets);
  if (!list.length) return {};

  const now = Date.now();
  if (isLiveWindowET()) {
    lastInterestAt = now;
    for (const sym of list) {
      const fresh = !interest.has(sym) && !streams.has(sym);
      interest.set(sym, now + INTEREST_MS);
      // A symbol that arrives while the connection is already up subscribes
      // immediately rather than waiting for the next sweep.
      if (fresh && authed) subscribeSymbol(sym);
    }
    startSweep();
    ensureConnection();
  }

  return readRows(list, iv, want);
}

/** Shared argument grinding for both read paths. */
function normalizeRead(symbols, interval, maxBuckets) {
  return {
    iv: Number(interval) === 5 ? 5 : 1,
    want: Math.max(1, Math.min(6, Number(maxBuckets) || 2)),
    list: [...new Set((symbols || [])
      .map((s) => String(s || '').trim().toUpperCase())
      .filter(Boolean))].slice(0, 8),
  };
}

/**
 * The read itself — no interest, no connection, no side effects at all.
 *
 * Split out of getLiveCandleRows so the SSE route can answer from the same map
 * without re-registering interest on every event: a stream already holds its
 * symbol open through `streams`, and renewing a poll timer from a push handler
 * would be two lifetimes fighting over one symbol.
 */
function readRows(list, iv, want) {
  const out = {};
  const bucketMs = iv * 60_000;
  for (const sym of list) {
    const m = bars.get(sym);
    if (!m || !m.size) continue;
    const raw = [...m.values()].sort((a, b) => a.time - b.time);
    const earliest = raw[0].time;

    const buckets = new Map();
    for (const c of raw) {
      const key = Math.floor(c.time / bucketMs) * bucketMs;
      const prev = buckets.get(key);
      if (!prev) {
        buckets.set(key, { time: key, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
      } else {
        prev.high = Math.max(prev.high, c.high);
        prev.low = Math.min(prev.low, c.low);
        prev.close = c.close;
        prev.volume += c.volume;
      }
    }
    // clipIncomplete: the oldest retained bucket may be missing the minutes that
    // fell off KEEP_BARS, which would publish a wrong open/high/low over a bar
    // the recorder had right. Only buckets whose start is covered by retained
    // 1m bars are trustworthy.
    const ordered = [...buckets.values()]
      .filter((b) => b.time >= earliest)
      .sort((a, b) => a.time - b.time);
    const kept = ordered.slice(-want);
    if (kept.length) out[sym] = kept.map((b) => shapeRow(sym, b, iv));
  }
  return out;
}

/**
 * PUSH. Register `onTick` for `symbol` and hold that symbol subscribed for as
 * long as the returned function has not been called.
 *
 * `onTick(symbol)` fires on every candle event the feed delivers — which, with
 * the dxLink channel's `acceptAggregationPeriod: 1`, is about once a second per
 * symbol while it is trading. It carries no payload on purpose: the caller
 * reads `liveRowsFor()` when it is ready to write, so a burst of events becomes
 * one read rather than a queue of stale ones.
 *
 * Unsubscribing is NOT optional — a stream's hold never expires (that is the
 * point of it), so a caller that forgets pins a dxLink subscription for the
 * life of the process. Call it from the connection's close handler, and call it
 * exactly once; a second call is a no-op.
 *
 * @param {string} symbol
 * @param {(symbol: string) => void} onTick
 * @returns {() => void} unsubscribe
 */
function subscribeLive(symbol, onTick) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym || typeof onTick !== 'function') return () => {};

  let set = listeners.get(sym);
  if (!set) { set = new Set(); listeners.set(sym, set); }
  set.add(onTick);
  streams.set(sym, (streams.get(sym) || 0) + 1);
  lastInterestAt = Date.now();

  startSweep();
  if (authed) subscribeSymbol(sym);
  ensureConnection();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const s = listeners.get(sym);
    if (s) { s.delete(onTick); if (!s.size) listeners.delete(sym); }
    const n = (streams.get(sym) || 1) - 1;
    if (n > 0) streams.set(sym, n);
    else {
      streams.delete(sym);
      // Hand the symbol back to the POLL lifetime rather than dropping it dead.
      // A card that loses its stream falls back to the 2s probe, and the few
      // seconds of grace mean that fallback finds bars already there instead of
      // waiting out a fresh snapshot replay.
      if (!interest.has(sym)) interest.set(sym, Date.now() + INTEREST_MS);
    }
    // No connection teardown here — sweep() owns that, and it is the only place
    // the idle rule lives.
  };
}

/** Current rows for ONE symbol, in the same shape the poll route returns. */
function liveRowsFor(symbol, interval = 1, maxBuckets = 1) {
  const { list, iv, want } = normalizeRead([symbol], interval, maxBuckets);
  return list.length ? readRows(list, iv, want) : {};
}

/** Diagnostics for a health route / owner page. */
function liveCandleStatus() {
  return {
    connected: !!client && authed,
    connecting,
    window: isLiveWindowET(),
    watching: [...watchedSymbols()],
    polled: [...interest.keys()],
    streamed: Object.fromEntries(streams),
    subscribed: [...subscribed],
    barCounts: Object.fromEntries([...bars].map(([s, m]) => [s, m.size])),
  };
}

/** Test/shutdown hook. */
function stopEtfLiveCandles() {
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
  interest.clear();
  streams.clear();
  listeners.clear();
  bars.clear();
  closeConnection('stopped');
}

module.exports = {
  getLiveCandleRows, subscribeLive, liveRowsFor, liveCandleStatus, stopEtfLiveCandles,
};
