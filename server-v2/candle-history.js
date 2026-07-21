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
 */
async function fetchIntradayCandles(symbol, interval, fromTime) {
  const sym = String(symbol || '').trim().toUpperCase();
  const iv = String(interval || '1m').trim();
  if (!sym) throw new Error('symbol required');
  const key = `${sym}|${iv}`;

  const cached = _cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;
  if (_inflight.has(key)) return _inflight.get(key);

  const run = (async () => {
    const { token, url } = await getQuoteToken();
    const candleSymbol = `${sym}{=${iv}}`;
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
          if (ev.eventType !== 'Candle' || ev.eventSymbol !== candleSymbol) return;
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
          quietTimer = setTimeout(finish, QUIET_MS);
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

      const hardTimer = setTimeout(finish, HARD_MS);
      try { client.connect(); } catch { finish(); }
    });
    _cache.set(key, { at: Date.now(), rows });
    return rows;
  })();

  _inflight.set(key, run);
  try { return await run; }
  finally { _inflight.delete(key); }
}

module.exports = { fetchIntradayCandles };
