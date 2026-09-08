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
  if (reconnectTimer || !interest.size) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (interest.size) ensureConnection();
  }, RECONNECT_MS);
  if (reconnectTimer.unref) reconnectTimer.unref();
}

function ensureConnection() {
  if (client || connecting) return;
  if (!interest.size || !isLiveWindowET()) return;
  connecting = true;
  getQuoteToken().then(({ token, url }) => {
    // Interest can lapse during the token round trip.
    if (!interest.size) { connecting = false; return; }
    const c = new DxLinkClient({
      url,
      token,
      onEvent: onCandleEvent,
      onStatus: (s) => {
        if (!s) return;
        if (s.dxlinkConnected) {
          if (authed) return; // status repeats; subscribe exactly once per connection
          authed = true;
          for (const sym of interest.keys()) subscribeSymbol(sym);
          console.log(`[etf-live] streaming 1m candles for ${[...interest.keys()].join(',') || '(none)'}`);
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
    if (until <= now) { interest.delete(sym); bars.delete(sym); }
  }
  if (!interest.size) {
    if (client && now - lastInterestAt > IDLE_CLOSE_MS) closeConnection('idle');
    return;
  }
  if (!isLiveWindowET()) { closeConnection('outside 04:00-20:00 ET'); return; }
  if (client && subscribed.size > MAX_SUBS && subscribed.size > interest.size * 2) {
    // No candle unsubscribe exists on DxLinkClient, so a symbol stays on the
    // wire for the life of the connection. Rebuilding is the cheap way to shed
    // them without touching the proxy.
    closeConnection(`${subscribed.size} subscriptions for ${interest.size} watched symbols — rebuilding`);
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
  const iv = Number(interval) === 5 ? 5 : 1;
  const want = Math.max(1, Math.min(6, Number(maxBuckets) || 2));
  const list = [...new Set((symbols || [])
    .map((s) => String(s || '').trim().toUpperCase())
    .filter(Boolean))].slice(0, 8);
  const out = {};
  if (!list.length) return out;

  const now = Date.now();
  if (isLiveWindowET()) {
    lastInterestAt = now;
    for (const sym of list) {
      const fresh = !interest.has(sym);
      interest.set(sym, now + INTEREST_MS);
      // A symbol that arrives while the connection is already up subscribes
      // immediately rather than waiting for the next sweep.
      if (fresh && authed) subscribeSymbol(sym);
    }
    startSweep();
    ensureConnection();
  }

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

/** Diagnostics for a health route / owner page. */
function liveCandleStatus() {
  return {
    connected: !!client && authed,
    connecting,
    window: isLiveWindowET(),
    watching: [...interest.keys()],
    subscribed: [...subscribed],
    barCounts: Object.fromEntries([...bars].map(([s, m]) => [s, m.size])),
  };
}

/** Test/shutdown hook. */
function stopEtfLiveCandles() {
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
  interest.clear();
  bars.clear();
  closeConnection('stopped');
}

module.exports = { getLiveCandleRows, liveCandleStatus, stopEtfLiveCandles };
