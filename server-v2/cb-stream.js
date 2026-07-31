'use strict';
/**
 * server-v2/cb-stream.js
 *
 * dxLink price stream for the CB contracts that are currently held.
 *
 * WHY THIS EXISTS
 *   The tracker used to price held positions by REST-probing each one once a
 *   minute. That works, but the number the Contracts board leads with is the
 *   day's PEAK — and a 60-second sample cannot see a spike between two polls.
 *   Peak was therefore a sampling artifact rather than a fact. Subscribing to
 *   the contract's Quote stream fixes exactly that: every NBBO update is seen,
 *   so the high-water mark is the real one.
 *
 * WHAT IT DOES NOT DO
 *   It does not write a row per event. A held 0DTE contract can quote hundreds
 *   of times a minute; storing that would be ~1M rows a session for a chart that
 *   renders 375 points. Instead every event updates an in-memory OHLC
 *   accumulator for the current minute, and `drain()` hands back completed
 *   60-second bars for the caller to persist. Peak precision comes from the
 *   stream; storage stays exactly where it was.
 *
 * FAILURE MODEL — the part worth reading
 *   A dead REST poll is loud: it throws, and the tracker stamps `last_error`.
 *   A dead SUBSCRIPTION is silent — events simply stop, and a row that is no
 *   longer updating looks identical to a contract that is not moving. That is
 *   the worst failure shape on a board whose whole job is to be trusted.
 *
 *   So this module never claims to be the source of truth. `health()` reports
 *   per-symbol staleness, and the tracker treats a stale symbol as "stream is
 *   not answering — go REST-probe it" rather than assuming quiet means flat.
 *   The stream is an accuracy upgrade layered over the REST path, not a
 *   replacement for it, and if dxLink never connects at all the tracker behaves
 *   exactly as it did before this file existed.
 *
 * Lifecycle: `track()` the open contracts each tick (idempotent — it diffs
 * against what is already subscribed), `drain()` for completed bars, `stop()`
 * at the bell.
 */

let tt = null;
try { tt = require('./proxy-tastytrade'); }
catch (e) { console.warn('[cb-stream] proxy-tastytrade not loadable — streaming disabled:', e.message); }

// A symbol is "stale" once it has been this long since its last event. RTH 0DTE
// contracts near the money quote constantly; 90s of silence on one means the
// subscription is broken, not that the market stopped.
const STALE_MS = Number(process.env.CB_STREAM_STALE_MS || 90_000);
// How long to wait for the first event after subscribing before declaring the
// stream unusable and letting the caller fall back.
const WARMUP_MS = Number(process.env.CB_STREAM_WARMUP_MS || 20_000);
const BAR_MS = 60_000;

const state = {
  client: null,
  connected: false,
  connectedAt: 0,
  lastError: null,
  subs: new Map(),   // streamerSymbol → { tradeId, lastEventAt, subscribedAt, bid, ask }
  bars: new Map(),   // `${symbol}|${barStart}` → { symbol, tradeId, t, open, high, low, close, n }
  done: [],          // completed bars waiting for drain()
};

const mid = (bid, ask) => {
  const b = Number(bid), a = Number(ask);
  if (Number.isFinite(b) && Number.isFinite(a) && b > 0 && a > 0) return (b + a) / 2;
  return null;
};

/** Roll an event into the current minute's OHLC accumulator for that symbol. */
function accumulate(symbol, markVal, now) {
  const sub = state.subs.get(symbol);
  if (!sub || markVal == null) return;
  const barStart = Math.floor(now / BAR_MS) * BAR_MS;
  const key = `${symbol}|${barStart}`;

  // Any bar for this symbol that is not the current one is finished. Close it
  // out here rather than on a timer — a symbol that stops quoting simply stops
  // producing bars, which is the honest representation.
  for (const [k, b] of state.bars) {
    if (b.symbol === symbol && b.t !== barStart) { state.done.push(b); state.bars.delete(k); }
  }

  const cur = state.bars.get(key);
  if (cur) {
    cur.high = Math.max(cur.high, markVal);
    cur.low = Math.min(cur.low, markVal);
    cur.close = markVal;
    cur.n += 1;
    cur.bid = sub.bid; cur.ask = sub.ask;
  } else {
    state.bars.set(key, {
      symbol, tradeId: sub.tradeId, t: barStart,
      open: markVal, high: markVal, low: markVal, close: markVal, n: 1,
      bid: sub.bid, ask: sub.ask,
    });
  }
}

function onEvent(ev) {
  if (!ev || ev.eventType !== 'Quote') return;
  const symbol = ev.eventSymbol;
  const sub = state.subs.get(symbol);
  if (!sub) return;
  const now = Date.now();
  sub.lastEventAt = now;
  sub.bid = Number(ev.bidPrice);
  sub.ask = Number(ev.askPrice);
  accumulate(symbol, mid(ev.bidPrice, ev.askPrice), now);
}

function ensureClient() {
  if (!tt?.DxLinkClient || !tt?.getQuoteToken) return null;
  if (state.client) return state.client;
  // Built lazily and kept for the session. Deliberately its own connection and
  // not the shared dashboard feed: an option subscription interleaved into the
  // hot _onEvent path there would add load to every quote the whole dashboard
  // renders, and a fault here would take that with it. Same reasoning as
  // candle-history.js, which also opens its own.
  const pending = { building: true };
  state.client = pending;
  (async () => {
    try {
      const { token, url } = await tt.getQuoteToken();
      const client = new tt.DxLinkClient({
        url,
        token,
        onEvent,
        onStatus: (s) => {
          if (s && typeof s.dxlinkConnected === 'boolean') {
            const was = state.connected;
            state.connected = s.dxlinkConnected;
            if (s.dxlinkConnected && !was) {
              state.connectedAt = Date.now();
              // Re-arm every symbol: a reconnect starts with an empty
              // subscription set on the far side, and a subscription that
              // silently didn't survive is the exact failure this module is
              // most likely to hit.
              const syms = [...state.subs.keys()];
              if (syms.length) { try { client.subscribe(syms); } catch { /* health() will catch it */ } }
              console.log(`[cb-stream] connected — resubscribed ${syms.length} contract(s)`);
            }
          }
          if (s && s.lastError) state.lastError = s.lastError;
        },
      });
      state.client = client;
      client.connect();
    } catch (e) {
      state.lastError = String(e.message || e);
      state.client = null;      // let the next tick retry
      console.warn('[cb-stream] connect failed —', state.lastError);
    }
  })();
  return state.client;
}

/**
 * Subscribe to exactly the given contracts, unsubscribing nothing (the
 * connection is torn down wholesale at the bell). Idempotent per tick.
 * @param {Array<{id:number, streamer_symbol:string}>} trades
 */
function track(trades) {
  if (!tt?.DxLinkClient) return { streaming: false, reason: 'dxlink unavailable' };
  const wanted = (trades || [])
    .map((t) => ({ id: t.id, symbol: String(t.streamer_symbol || '').trim() }))
    .filter((x) => x.symbol);
  if (!wanted.length) return { streaming: false, reason: 'nothing held' };

  const client = ensureClient();
  const fresh = [];
  for (const w of wanted) {
    if (state.subs.has(w.symbol)) { state.subs.get(w.symbol).tradeId = w.id; continue; }
    state.subs.set(w.symbol, { tradeId: w.id, lastEventAt: 0, subscribedAt: Date.now(), bid: null, ask: null });
    fresh.push(w.symbol);
  }
  if (fresh.length && client && !client.building) {
    // subscribe() queues internally until the FEED channel opens, so calling it
    // before the connection is up is safe and intended.
    try { client.subscribe(fresh); } catch (e) { state.lastError = String(e.message || e); }
    console.log(`[cb-stream] subscribed ${fresh.join(', ')}`);
  }
  return { streaming: true, subscribed: state.subs.size, added: fresh.length };
}

/**
 * Completed 60s bars since the last call. The still-forming bar is deliberately
 * withheld — persisting a partial minute would let a bar's high be revised after
 * it was written, and the caller uses these to move a high-water mark.
 */
function drain() {
  const out = state.done.splice(0);
  return out.map((b) => ({
    tradeId: b.tradeId,
    symbol: b.symbol,
    ts: b.t + BAR_MS - 1,        // stamp at the bar's end, matching a 60s poll
    open: b.open, high: b.high, low: b.low, close: b.close,
    bid: b.bid, ask: b.ask, events: b.n,
  }));
}

/**
 * Per-symbol liveness. `fresh` symbols are being priced by the stream; anything
 * else the caller must REST-probe. Never reports healthy on a connection that
 * has not yet delivered an event — "connected" is not "working".
 */
function health(now = Date.now()) {
  const per = {};
  let fresh = 0, stale = 0;
  for (const [symbol, s] of state.subs) {
    const age = s.lastEventAt ? now - s.lastEventAt : null;
    const warming = !s.lastEventAt && now - s.subscribedAt < WARMUP_MS;
    const ok = s.lastEventAt > 0 && age <= STALE_MS;
    if (ok) fresh += 1; else if (!warming) stale += 1;
    per[symbol] = { ok, warming, ageMs: age, lastEventAt: s.lastEventAt || null };
  }
  return {
    connected: state.connected,
    lastError: state.lastError,
    subscribed: state.subs.size,
    fresh, stale,
    symbols: per,
  };
}

/** True when this symbol is being priced live and does not need a REST probe. */
function isFresh(symbol, now = Date.now()) {
  const s = state.subs.get(String(symbol || ''));
  return !!(s && s.lastEventAt > 0 && now - s.lastEventAt <= STALE_MS);
}

function stop() {
  // Flush whatever the last partial minute held so the close is not lost.
  for (const [k, b] of state.bars) { state.done.push(b); state.bars.delete(k); }
  try { state.client?.close?.(); } catch { /* noop */ }
  state.client = null;
  state.connected = false;
  state.subs.clear();
  return { stopped: true };
}

module.exports = { track, drain, health, isFresh, stop, BAR_MS, CONFIG: { STALE_MS, WARMUP_MS } };
