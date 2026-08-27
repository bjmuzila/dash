// ─────────────────────────────────────────────────────────────────────────────
// candle-history.js — on-demand intraday OHLC candles for ANY dxLink symbol
// (SPY, QQQ, …) via a SHORT-LIVED, ISOLATED dxLink connection.
//
// Why isolated (not the live shared feed): the main TastytradeProxy feed powers
// the whole dashboard; piggybacking arbitrary candle subscriptions on it risks
// interleaving foreign bars into the ES/NQ candle maps and adds load to the hot
// _onEvent path. A throwaway connection per request keeps this completely
// separate — if it fails, only the caller's price line is missing.
//
// dxLink candle symbols carry a period suffix, e.g. "SPY{=1m}". Passing
// `fromTime` (epoch ms) makes dxFeed replay a historical snapshot of bars since
// that time (≈1440 bars for a 1-day, 1-minute request) and then stream the live
// forming bar. We collect the snapshot burst, settle after a quiet gap, and tear
// the connection down.
// ─────────────────────────────────────────────────────────────────────────────

const { DxLinkClient, getQuoteToken } = require('./proxy-tastytrade');

const QUIET_MS = 800;   // resolve this long after the last candle event arrives
const HARD_MS = 7000;   // absolute cap so a silent feed can't hang the request
const CACHE_TTL_MS = 60_000;

// symbol|interval → { at, rows }   and   symbol|interval → Promise (in-flight dedupe)
const _cache = new Map();
const _inflight = new Map();

/**
 * Fetch intraday candles for `symbol` (e.g. "SPY") at `interval` (e.g. "1m"),
 * starting from `fromTime` (epoch ms). Returns [{ time, open, high, low, close,
 * volume }] oldest-first. Cached ~60s per symbol+interval.
 *
 * @param {object} [opts]
 * @param {number} [opts.quietMs] Settle window after the last candle event.
 * @param {number} [opts.hardMs]  Absolute cap on the whole request.
 * @param {boolean} [opts.cache]  Default true. Pass false for a MULTI-DAY pull:
 *   the cache key is `symbol|interval` and does NOT include `fromTime`, so a
 *   cached one-session response would otherwise be handed straight back to a
 *   five-session request (and, worse, a big backfill would overwrite the cache
 *   the live path is about to read). Bypasses the in-flight dedupe for the same
 *   reason.
 *
 * The defaults are tuned for the live path — a single session, ~390 bars, on a
 * request a browser is waiting on. A multi-day replay is several thousand bars
 * and will be TRUNCATED at HARD_MS, so callers doing that must raise both.
 */
async function fetchIntradayCandles(symbol, interval, fromTime, opts = {}) {
  const sym = String(symbol || '').trim().toUpperCase();
  const iv = String(interval || '1m').trim();
  if (!sym) throw new Error('symbol required');
  const key = `${sym}|${iv}`;
  const quietMs = Number(opts.quietMs) > 0 ? Number(opts.quietMs) : QUIET_MS;
  const hardMs = Number(opts.hardMs) > 0 ? Number(opts.hardMs) : HARD_MS;
  const useCache = opts.cache !== false;

  if (useCache) {
    const cached = _cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;
    if (_inflight.has(key)) return _inflight.get(key);
  }

  const run = (async () => {
    const { token, url } = await getQuoteToken();
    const candleSymbol = `${sym}{=${iv}}`;
    // What the FEED tags events with — which is NOT what we sent. dxFeed
    // canonicalizes the period, and an implicit multiplier of 1 is dropped, so a
    // "SPY{=1m}" subscription streams back tagged "SPY{=m}". Comparing against
    // the sent string discarded every event and resolved [] — silently, because
    // the filter is a `return`, not an error, and the outer function treats an
    // empty result as a legitimate "no data". See DxLinkClient.canonCandleSymbol.
    const wantSymbol = DxLinkClient.canonCandleSymbol(candleSymbol);
    const rows = await new Promise((resolve) => {
      const bars = new Map(); // barTime(ms) → { time, open, high, low, close, volume }
      let done = false, quietTimer = null, subscribed = false;

      const finish = () => {
        if (done) return;
        done = true;
        if (quietTimer) clearTimeout(quietTimer);
        clearTimeout(hardTimer);
        try { client.close(); } catch { /* noop */ }
        resolve([...bars.values()].filter((b) => b.close > 0).sort((a, b) => a.time - b.time));
      };

      const client = new DxLinkClient({
        url,
        token,
        onEvent: (ev) => {
          if (ev.eventType !== 'Candle' || DxLinkClient.canonCandleSymbol(ev.eventSymbol) !== wantSymbol) return;
          const t = Number(ev.time);
          const close = Number(ev.close);
          if (!(t > 0) || !(close > 0)) return;
          let volume = Number(ev.volume);
          if (!Number.isFinite(volume)) volume = 0;
          // dxFeed replays a bar as multiple updates: last close wins, widen the
          // range, keep the max (cumulative-per-bar) volume.
          const prev = bars.get(t);
          bars.set(t, prev
            ? { time: t, open: prev.open, high: Math.max(prev.high, Number(ev.high) || prev.high), low: Math.min(prev.low, Number(ev.low) || prev.low), close, volume: Math.max(prev.volume, volume) }
            : { time: t, open: Number(ev.open) || close, high: Number(ev.high) || close, low: Number(ev.low) || close, close, volume });
          if (quietTimer) clearTimeout(quietTimer);
          quietTimer = setTimeout(finish, quietMs);
        },
        onStatus: (s) => {
          // dxlinkConnected flips true at AUTH; the candle sub queues until the
          // FEED channel opens, then flushes. Subscribe exactly once.
          if (s && s.dxlinkConnected && !subscribed) {
            subscribed = true;
            client.subscribeCandle(candleSymbol, fromTime);
          }
        },
      });

      const hardTimer = setTimeout(finish, hardMs);
      try { client.connect(); } catch { finish(); }
    });
    // A bypassed (multi-day) pull must not seed the cache the live single-session
    // path reads — same key, wildly different window.
    if (useCache) _cache.set(key, { at: Date.now(), rows });
    return rows;
  })();

  if (!useCache) return run;
  _inflight.set(key, run);
  try { return await run; }
  finally { _inflight.delete(key); }
}

/**
 * MANY symbols, ONE connection.
 *
 * fetchIntradayCandles opens a throwaway dxLink connection per call, which is
 * the right shape for a browser asking about one ticker and completely the wrong
 * shape for a recorder sweeping a hundred of them every minute: 106 connect /
 * auth / subscribe / settle / teardown cycles a minute, most of the wall clock
 * spent on handshakes rather than on data.
 *
 * dxLink has no problem with a multi-symbol candle subscription — the live feed
 * already runs ES 5m, NQ 5m and ES 1m down one client — so this opens ONE
 * connection, subscribes every symbol on it, and demultiplexes the events by
 * eventSymbol on the way in. One handshake for the whole roster.
 *
 * Returns a Map of symbol → rows (oldest-first, same row shape as the
 * single-symbol function). A symbol that produced no events is present with an
 * empty array, so a caller can tell "nothing traded" from "not requested".
 *
 * DELIBERATELY NOT CACHED. Every caller is a recorder that wants the current
 * state of a window it chose; the single-symbol cache is keyed
 * `symbol|interval` with no fromTime in it and seeding it from here would hand
 * a browser's one-session request whatever window the recorder last asked for.
 *
 * Timeouts: `quietMs` is the settle gap after the LAST event across ALL symbols
 * — a hundred snapshot bursts interleave, so a per-symbol gap would be wrong —
 * and `hardMs` is the absolute cap. Both default higher than the single-symbol
 * version because there is proportionally more to deliver; a hard-capped result
 * is TRUNCATED, not an error, so size them for the biggest roster you will pass.
 *
 * @param {string[]} symbols
 * @param {string} interval e.g. '1m'
 * @param {number} fromTime epoch ms
 * @param {{quietMs?:number, hardMs?:number}} [opts]
 * @returns {Promise<Map<string, Array<{time:number,open:number,high:number,low:number,close:number,volume:number}>>>}
 */
async function fetchIntradayCandlesMulti(symbols, interval, fromTime, opts = {}) {
  const iv = String(interval || '1m').trim();
  const list = [...new Set((symbols || []).map((s) => String(s || '').trim().toUpperCase()).filter(Boolean))];
  const out = new Map(list.map((s) => [s, []]));
  if (!list.length) return out;

  const quietMs = Number(opts.quietMs) > 0 ? Number(opts.quietMs) : 3_000;
  const hardMs = Number(opts.hardMs) > 0 ? Number(opts.hardMs) : 45_000;

  const { token, url } = await getQuoteToken();

  // Canonical eventSymbol → our plain ticker. The canonicalisation is the same
  // trap the single-symbol path documents at length: subscribe to "SPY{=1m}"
  // and every event comes back tagged "SPY{=m}", so comparing against the sent
  // string silently discards everything.
  const bySymbol = new Map(); // canon candle symbol → plain ticker
  for (const sym of list) bySymbol.set(DxLinkClient.canonCandleSymbol(`${sym}{=${iv}}`), sym);

  const bars = new Map(); // plain ticker → Map(barTime → bar)
  for (const sym of list) bars.set(sym, new Map());

  await new Promise((resolve) => {
    let done = false, quietTimer = null, subscribed = false;

    const finish = () => {
      if (done) return;
      done = true;
      if (quietTimer) clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      try { client.close(); } catch { /* noop */ }
      resolve();
    };

    const client = new DxLinkClient({
      url,
      token,
      onEvent: (ev) => {
        if (ev.eventType !== 'Candle') return;
        const sym = bySymbol.get(DxLinkClient.canonCandleSymbol(ev.eventSymbol));
        if (!sym) return;
        const t = Number(ev.time);
        const close = Number(ev.close);
        if (!(t > 0) || !(close > 0)) return;
        let volume = Number(ev.volume);
        if (!Number.isFinite(volume)) volume = 0;
        const m = bars.get(sym);
        const prev = m.get(t);
        // Same reduction as the single-symbol path: dxFeed replays a bar as
        // several updates, so last close wins, the range widens, and volume is
        // the max (it is cumulative per bar) rather than a sum.
        m.set(t, prev
          ? { time: t, open: prev.open, high: Math.max(prev.high, Number(ev.high) || prev.high), low: Math.min(prev.low, Number(ev.low) || prev.low), close, volume: Math.max(prev.volume, volume) }
          : { time: t, open: Number(ev.open) || close, high: Number(ev.high) || close, low: Number(ev.low) || close, close, volume });
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      },
      onStatus: (s) => {
        // dxlinkConnected flips true at AUTH; the subscriptions queue in the
        // client until the FEED channel opens, then flush. Subscribe exactly
        // once — this fires again on any later status change.
        if (s && s.dxlinkConnected && !subscribed) {
          subscribed = true;
          for (const sym of list) client.subscribeCandle(`${sym}{=${iv}}`, fromTime);
        }
      },
    });

    const hardTimer = setTimeout(finish, hardMs);
    try { client.connect(); } catch { finish(); }
  });

  for (const sym of list) {
    out.set(sym, [...bars.get(sym).values()].filter((b) => b.close > 0).sort((a, b) => a.time - b.time));
  }
  return out;
}

module.exports = { fetchIntradayCandles, fetchIntradayCandlesMulti };
