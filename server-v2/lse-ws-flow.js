'use strict';
/**
 * server-v2/lse-ws-flow.js — the LSE options tape over the websocket (2026-10-07).
 *
 * WHY
 *   The Top Flow sweep polls GET /options/flow every 20s and re-downloads the
 *   newest 5,000 prints each time — ~1,250 requests and ~1.5 GB a day for
 *   prints it mostly already holds. On 2026-10-07 the request cap ran out by
 *   09:40 and the whale archive stopped recording. The websocket pushes each
 *   print once, counts no requests, and only bytes against the monthly/weekly
 *   allowance.
 *
 * MODES (LSE_WS_MODE)
 *   off      not started (default)
 *   shadow   stream + measure only. Nothing is written. /api/lse/status shows
 *            what the stream WOULD add, how many of its prints the REST sweep
 *            also caught (matchedRest), and whether a tick looks like a trade.
 *   live     stream prints go into the same store the sweep feeds, and the
 *            REST sweep drops to a slower backup cadence while the stream is
 *            healthy (see api-router.js).
 *
 * WHAT IS NOT KNOWN YET — and is measured, not assumed:
 *   - whether an options tick is a TRADE or a QUOTE update;
 *   - whether `volume` is the print's size or a running day total.
 *   Both decide whether `live` is safe, so status() reports them, and live mode
 *   refuses to emit prints if volume looks cumulative (see volLooksCumulative).
 *
 * KEYS
 *   LSE_WS_API_KEY if set, else LSE_API_KEY, then LSE_API_KEY_2 … on
 *   QUOTA_EXCEEDED / INVALID_KEY. The key is never logged.
 *
 * Connects only inside the session window passed in (isOpen), so nothing
 * streams overnight or at weekends.
 */

const WS_URL = 'wss://data-ws.londonstrategicedge.com';
const FLUSH_MS = 1000;
const PING_MS = 30_000;
const GATE_MS = 30_000;
const STALE_MS = 90_000;
/** Volume that rises on ≥95% of consecutive trade ticks per contract, over at
 *  least this many samples, is a running total — not a print size. */
const CUM_MIN_SAMPLES = 300;
const CUM_RATIO = 0.95;

function wsCtor() {
  if (globalThis.WebSocket) return globalThis.WebSocket;
  try { return require('ws'); } catch { return null; }
}

function keysFromEnv() {
  const out = [];
  const push = (k) => { const v = String(k || '').trim(); if (v && !out.includes(v)) out.push(v); };
  push(process.env.LSE_WS_API_KEY);
  push(process.env.LSE_API_KEY);
  for (let i = 2; i <= 9; i++) {
    const v = process.env[`LSE_API_KEY_${i}`];
    if (!v) break;
    push(v);
  }
  return out;
}

const tsMs = (v) => {
  if (typeof v === 'number') return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== '') return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  const p = Date.parse(String(v || ''));
  return Number.isFinite(p) ? p : NaN;
};

/**
 * @param {object} o
 * @param {'shadow'|'live'} o.mode
 * @param {string[]} o.underlyings   option roots to subscribe (SPX, SPY, …)
 * @param {number}   o.minPremium    only prints at/above this are handed on
 * @param {() => boolean} o.isOpen   session window gate
 * @param {(prints: object[]) => void} o.onPrints  raw prints, see emit()
 */
function start({ mode, underlyings, minPremium, isOpen, onPrints }) {
  const WS = wsCtor();
  const keys = keysFromEnv();
  const st = {
    mode,
    underlyings,
    state: 'idle',            // idle | connecting | open | closed | disabled
    keyIndex: 0,
    keysAvailable: keys.length,
    connectedAt: null,
    lastMessageAt: 0,
    lastTickAt: 0,
    reconnects: 0,
    bytes: 0,
    ticks: 0,
    tradeTicks: 0,            // volume > 0 and price > 0
    quoteOnlyTicks: 0,        // no volume — a quote update
    repeatSkipped: 0,         // same price+volume as the last tick, quote moved
    bigPrints: 0,             // at/above minPremium
    emitted: 0,               // handed to onPrints (live only)
    matchedRest: 0,           // shadow: prints the REST store already had
    volUp: 0,
    volDown: 0,
    withQuote: 0,
    subscribed: {},           // underlying → contracts
    errors: [],               // last 10 {at, code, message}
    disabledReason: null,
  };
  const volLooksCumulative = () => {
    const n = st.volUp + st.volDown;
    return n >= CUM_MIN_SAMPLES && st.volUp / n >= CUM_RATIO;
  };
  if (!WS) { st.state = 'disabled'; st.disabledReason = 'no WebSocket in this Node'; return api(); }
  if (!keys.length) { st.state = 'disabled'; st.disabledReason = 'no LSE key'; return api(); }

  let ws = null;
  let buf = [];
  let pingT = null;
  let flushT = null;
  let retryT = null;
  let backoff = 2000;
  let wantOpen = false;
  const last = new Map(); // symbol → { price, volume, bid, ask }
  const spot = new Map(); // underlying → last price (when its own symbol streams)

  const note = (code, message) => {
    st.errors.push({ at: new Date().toISOString(), code, message: String(message || '').slice(0, 200) });
    if (st.errors.length > 10) st.errors.shift();
  };

  function send(o) { try { ws && ws.send(JSON.stringify(o)); } catch { /* reconnect handles it */ } }

  function onTick(m) {
    st.ticks += 1;
    st.lastTickAt = Date.now();
    const sym = String(m.symbol || '');
    const price = Number(m.price);
    const volume = Number(m.volume);
    const bid = Number(m.bid);
    const ask = Number(m.ask);

    // An underlying's own tick — keep it as spot for moneyness.
    if (underlyings.includes(sym)) { if (price > 0) spot.set(sym, price); return; }

    const prev = last.get(sym);
    last.set(sym, { price, volume, bid, ask });
    if (!(volume > 0) || !(price > 0)) { st.quoteOnlyTicks += 1; return; }
    st.tradeTicks += 1;
    if (bid > 0 && ask > 0) st.withQuote += 1;
    if (prev && prev.volume > 0) {
      if (volume > prev.volume) st.volUp += 1;
      else if (volume < prev.volume) st.volDown += 1;
      // Same trade fields, moved quote: a quote update re-carrying the last
      // print. Counting it again would invent a second whale.
      if (volume === prev.volume && price === prev.price && (bid !== prev.bid || ask !== prev.ask)) {
        st.repeatSkipped += 1;
        return;
      }
    }
    const premium = price * volume * 100;
    if (premium < minPremium) return;
    st.bigPrints += 1;
    const ts = tsMs(m.ts !== undefined ? m.ts : m.timestamp);
    if (!Number.isFinite(ts)) return;
    buf.push({ symbol: sym, ts, price, volume, premium, bid: bid > 0 ? bid : null, ask: ask > 0 ? ask : null });
  }

  function flush() {
    if (!buf.length) return;
    const batch = buf;
    buf = [];
    if (mode === 'live' && volLooksCumulative()) {
      // Not a print size — refuse rather than write running totals as whales.
      if (st.disabledReason !== 'volume looks cumulative') {
        st.disabledReason = 'volume looks cumulative';
        console.warn('[lse-ws] volume rises on almost every tick — treating it as a running total; live emits paused');
      }
      return;
    }
    // Attach spot from the subscribed underlying where we have one.
    for (const p of batch) {
      const root = /^([A-Z][A-Z0-9.]{0,5})\d{6}[CP]\d{8}$/.exec(p.symbol);
      const u = root ? root[1] : null;
      const fold = u === 'SPXW' ? 'SPX' : u === 'NDXP' ? 'NDX' : u;
      p.underlying = underlyings.includes(fold) ? fold : u;
      p.spot = spot.get(p.underlying) ?? null;
    }
    try { onPrints(batch); } catch (e) { note('ON_PRINTS', e && e.message); }
  }

  function connect() {
    if (ws || !wantOpen) return;
    st.state = 'connecting';
    const key = keys[st.keyIndex];
    try { ws = new WS(WS_URL); } catch (e) { note('CONNECT', e && e.message); return scheduleRetry(); }

    const onMsg = (raw) => {
      const text = typeof raw === 'string' ? raw : (raw && raw.data !== undefined ? raw.data : String(raw));
      st.bytes += Buffer.byteLength(String(text));
      st.lastMessageAt = Date.now();
      let m;
      try { m = JSON.parse(text); } catch { return; }
      switch (m.type) {
        case 'welcome':
          send({ action: 'auth', api_key: key });
          break;
        case 'authenticated':
          st.state = 'open';
          st.connectedAt = new Date().toISOString();
          backoff = 2000;
          for (const u of underlyings) {
            send({ action: 'subscribe_options', underlying: u });
            send({ action: 'subscribe', symbol: u }); // spot; an unknown symbol just never ticks
          }
          break;
        case 'options_subscribed':
          st.subscribed[m.underlying] = m.contracts;
          break;
        case 'tick':
          onTick(m);
          break;
        case 'error':
          note(m.code, m.message);
          if (m.code === 'QUOTA_EXCEEDED' || m.code === 'INVALID_KEY') {
            if (st.keyIndex + 1 < keys.length) {
              st.keyIndex += 1;
              console.warn(`[lse-ws] ${m.code} — switching to key ${st.keyIndex + 1}`);
            } else {
              st.disabledReason = `${m.code} on every key`;
              wantOpen = false;
              console.warn(`[lse-ws] ${m.code} on every key — stream stopped until restart`);
            }
            try { ws.close(); } catch { /* onclose reconnects */ }
          }
          break;
        default:
          break;
      }
    };
    const onClose = () => {
      ws = null;
      st.state = 'closed';
      clearInterval(pingT); pingT = null;
      if (wantOpen) scheduleRetry();
    };
    if (typeof ws.on === 'function') {
      ws.on('message', (d) => onMsg(d.toString()));
      ws.on('close', onClose);
      ws.on('error', (e) => note('WS', e && e.message));
    } else {
      ws.onmessage = (ev) => onMsg(ev.data);
      ws.onclose = onClose;
      ws.onerror = (e) => note('WS', e && e.message ? e.message : 'socket error');
    }
    pingT = setInterval(() => {
      send({ action: 'ping' });
      // Open but silent past STALE_MS — kill it and let the retry reconnect.
      if (st.state === 'open' && Date.now() - st.lastMessageAt > STALE_MS) { try { ws.close(); } catch { /* */ } }
    }, PING_MS);
    pingT.unref?.();
  }

  function scheduleRetry() {
    if (retryT || !wantOpen) return;
    st.reconnects += 1;
    retryT = setTimeout(() => { retryT = null; connect(); }, backoff);
    retryT.unref?.();
    backoff = Math.min(backoff * 2, 60_000);
  }

  function gate() {
    const open = Boolean(isOpen()) && !(st.disabledReason && /every key/.test(st.disabledReason));
    if (open && !wantOpen) { wantOpen = true; connect(); }
    if (!open && wantOpen) {
      wantOpen = false;
      flush();
      try { ws && ws.close(); } catch { /* */ }
      last.clear();
    }
  }

  flushT = setInterval(flush, FLUSH_MS); flushT.unref?.();
  const gateT = setInterval(gate, GATE_MS); gateT.unref?.();
  setTimeout(gate, 3000).unref?.();

  function api() {
    return {
      /** Open, authenticated and heard from recently. */
      healthy: () => st.state === 'open' && Date.now() - st.lastMessageAt < STALE_MS && !st.disabledReason,
      noteMatchedRest: (n) => { st.matchedRest += n; },
      noteEmitted: (n) => { st.emitted += n; },
      status: () => {
        const n = st.volUp + st.volDown;
        return {
          ...st,
          healthy: st.state === 'open' && Date.now() - st.lastMessageAt < STALE_MS && !st.disabledReason,
          mb: Math.round((st.bytes / 1048576) * 10) / 10,
          tradeShare: st.ticks ? Math.round((st.tradeTicks / st.ticks) * 1000) / 10 : null,
          volRisesShare: n ? Math.round((st.volUp / n) * 1000) / 10 : null,
          volumeLooksCumulative: volLooksCumulative(),
          lastTickAt: st.lastTickAt ? new Date(st.lastTickAt).toISOString() : null,
          lastMessageAt: st.lastMessageAt ? new Date(st.lastMessageAt).toISOString() : null,
        };
      },
    };
  }
  return api();
}

module.exports = { start };
