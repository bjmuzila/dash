'use strict';
/**
 * server-v2/scripts/probe-option-candles.js
 *
 * ONE QUESTION: does tastytrade's dxLink entitlement serve historical Candle
 * bars for an OPRA option symbol?
 *
 * Nothing in the app depends on this file. It is a diagnostic — run it, read the
 * answer, delete it. It makes no writes and touches no proxy code: it resolves
 * the contract's streamer symbol off the chain TastyTrade already serves, then
 * asks candle-history.js (the same throwaway dxLink connection the /flow price
 * line uses) for bars since `days` ago.
 *
 * Usage, from inside the dashboard container:
 *   docker compose exec dashboard \
 *     node server-v2/scripts/probe-option-candles.js FBL 2026-08-21 23 C
 *
 *   node server-v2/scripts/probe-option-candles.js SYMBOL EXPIRY STRIKE TYPE [interval] [days]
 *     interval  dxLink period, default 1d. Try 1h/5m if 1d comes back empty —
 *               entitlements differ per aggregation.
 *     days      how far back to ask, default 30.
 *
 * READING THE RESULT
 *   Bars printed        → option candle history IS entitled. A dxLink backfill
 *                         for far_cb_contract_daily is buildable.
 *   "0 bars"            → either not entitled, or the contract never traded in
 *                         the window. Re-run against a LIQUID contract (e.g. an
 *                         ATM SPY call) to tell those two apart: liquid also
 *                         empty = not entitled; liquid full = entitled, and the
 *                         far-OTM name simply has no prints to serve.
 */

const { fetchChain } = require('../proxy-tastytrade');
const { fetchIntradayCandles } = require('../candle-history');

const [, , symbolArg, expiryArg, strikeArg, typeArg, intervalArg, daysArg] = process.argv;

if (!symbolArg || !expiryArg || !strikeArg || !typeArg) {
  console.error('usage: node probe-option-candles.js SYMBOL EXPIRY STRIKE TYPE [interval] [days]');
  console.error('   eg: node probe-option-candles.js FBL 2026-08-21 23 C 1d 30');
  process.exit(2);
}

const symbol   = String(symbolArg).toUpperCase();
const expiry   = String(expiryArg).trim();
const strike   = Number(strikeArg);
const type     = String(typeArg).toUpperCase().startsWith('P') ? 'P' : 'C';
const interval = String(intervalArg || '1d').trim();
const days     = Number(daysArg || 30);

(async () => {
  console.log(`[probe] ${symbol} ${strike}${type} ${expiry} · interval=${interval} · last ${days}d\n`);

  const { contracts } = await fetchChain(symbol);
  const match = contracts.find(
    (c) => c.expiration === expiry && Math.abs(Number(c.strike) - strike) < 0.01 && c.type === type
  );

  if (!match) {
    const near = contracts
      .filter((c) => c.expiration === expiry && c.type === type)
      .map((c) => Number(c.strike))
      .sort((a, b) => Math.abs(a - strike) - Math.abs(b - strike))
      .slice(0, 8);
    console.error(`[probe] no ${strike}${type} on ${expiry}. Nearest strikes that DO exist: ${near.join(', ') || '(none — check the expiry)'}`);
    process.exit(1);
  }

  console.log(`[probe] streamer symbol: ${match.streamerSymbol}`);
  console.log(`[probe] occ symbol:      ${match.occSymbol}\n`);

  const fromTime = Date.now() - days * 86400_000;
  const t0 = Date.now();
  // cache:false — the cache key is symbol|interval and ignores fromTime, so a
  // multi-day pull must never be served from (or seed) the live path's entry.
  // The generous windows are because a historical replay is slower to settle
  // than the single-session request the defaults are tuned for.
  const bars = await fetchIntradayCandles(match.streamerSymbol, interval, fromTime, {
    cache: false,
    quietMs: 2500,
    hardMs: 25_000,
  });
  const ms = Date.now() - t0;

  if (!bars.length) {
    console.log(`[probe] 0 bars in ${ms}ms — no option candle history on this symbol/interval.`);
    console.log('[probe] Before concluding "not entitled", re-run against a LIQUID contract');
    console.log('[probe] (an ATM SPY call a week out). If that is empty too, the entitlement');
    console.log('[probe] is the answer. If it returns bars, this contract simply never traded.');
    process.exit(0);
  }

  console.log(`[probe] ${bars.length} bars in ${ms}ms\n`);
  console.log('DATE                 OPEN     HIGH      LOW    CLOSE   VOLUME');
  for (const b of bars) {
    const d = new Date(b.time).toISOString().slice(0, 16).replace('T', ' ');
    const f = (v) => String(Number(v).toFixed(2)).padStart(8);
    console.log(`${d}${f(b.open)}${f(b.high)}${f(b.low)}${f(b.close)}${String(b.volume).padStart(9)}`);
  }
  console.log('\n[probe] Bars above = a dxLink backfill for far_cb_contract_daily is buildable.');
  process.exit(0);
})().catch((e) => {
  console.error('[probe] failed:', e?.message || e);
  process.exit(1);
});
