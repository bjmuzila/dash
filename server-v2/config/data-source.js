'use strict';
/**
 * server-v2/config/data-source.js
 *
 * The options data provider. There is exactly one now: TastyTrade + dxLink.
 *
 * ── History ─────────────────────────────────────────────────────────────────
 * This file used to be the ThetaData rollback switch — `DATA_SOURCE=tt|theta`
 * plus a separate `INDEX_SOURCE=dxlink|theta` for SPX/VIX spot — so a bad Theta
 * day could be reverted with one env change and no code rollback.
 *
 * ThetaData was removed on 2026-08-18. Its container could never build a
 * working terminal: the image only shipped the BOOTSTRAP jar and downloaded the
 * real runtime jar over the network at every boot, so when that download began
 * 404ing it crash-looped — and because the dashboard had a
 * `depends_on: theta-terminal: condition: service_healthy` gate, it took the
 * whole site down with it. The stack had been running `DATA_SOURCE=tt` for a
 * long time, so nothing user-visible was on the Theta path.
 *
 * `useTastytradeForOptions()` is kept (it is imported in a few places and is now
 * trivially true) rather than deleted, so callers reading "is TT the options
 * provider" still read as a question with an answer.
 *
 * Futures (ES/NQ candles, settle, watchlist) were ALWAYS on TastyTrade/dxLink —
 * Theta never sold futures data, so there was never anything to switch there.
 */

const DATA_SOURCE = 'tt';
const useTastytradeForOptions = () => true;

const INDEX_SOURCE = 'dxlink';

// eslint-disable-next-line no-console
console.log('[DATA_SOURCE] options provider = TASTYTRADE/dxLink');
// eslint-disable-next-line no-console
console.log('[INDEX_SOURCE] SPX/VIX spot = dxLink');

module.exports = {
  DATA_SOURCE,
  useTastytradeForOptions,
  INDEX_SOURCE,
};
