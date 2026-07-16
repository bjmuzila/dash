'use strict';
/**
 * server-v2/state/market-state.js
 *
 * Central in-memory market state — single source of truth for GEX rows,
 * spot, expiry, exposure totals, flow, and feed health.
 *
 * The data-fetch/compute side writes here; the WebSocket broadcaster and the
 * REST snapshot endpoint read from here. Emits 'change' (with the field keys
 * that changed) only when something actually changed.
 *
 * Pattern ported from the original server/state/market-state.js.
 */

const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

const state = {
  symbol: 'SPX',
  // GEX chart data — per-strike rows from gex-calculator
  gexRows: [],
  // Spot price
  spot: 0,
  // Underlying prior close (for change calc) and date.
  prevClose: 0,
  prevCloseDate: null,
  // Auxiliary live quotes: VIX index + front ES/NQ futures, with prior closes.
  vix: 0,
  esFut: 0,
  nqFut: 0,
  vixPrevClose: 0,
  esFutPrevClose: 0,
  nqFutPrevClose: 0,
  // Display SPX: live broker quote during RTH, esFut+cashBasis off-hours. Kept
  // separate from `spot` (broker quote used for all GEX math) so display can be
  // kept live without affecting strike/level pricing.
  spotDisplay: 0,
  // ES/SPX basis (esFut - spot), computed HERE so the client never has to
  // stitch it together from two independently-timed feeds (Theta index for
  // spot, TT/dxLink for esFut). Null until both sides have been seen fresh
  // together at least once. See _recomputeBasis below.
  basis: null,
  // Last-update timestamps for spot/esFut, used only to gate basis recompute.
  spotAt: 0,
  esFutAt: 0,
  // Active expiry 'YYYY-MM-DD'
  expiry: '',
  // All available expiries for the toolbar
  expirations: [],
  // Aggregate exposure totals (GEX/DEX/VEX/CHEX/Vega)
  totals: null,
  // Summary levels
  callWall: null,
  putWall: null,
  gexFlip: null,
  totalNetGex: 0,
  totalFlowGex: 0, // flow-based GEX from dealer inventory
  // Latest flow bucket
  flow: null,
  // 5-minute ES futures candles (raw OHLCV bars, ~15 sessions). Client computes
  // relative-volume baselines + IB levels from these.
  esCandles: [],
  // Delta of just-changed 5m bars (forming bar + any newly-closed one). Emitted
  // on each flush so the WS broadcast carries only the moved bars, not all 600.
  esCandlesDelta: [],
  // 5-minute NQ futures candles — parallel to esCandles, drives the ICT NQU tab.
  nqCandles: [],
  nqCandlesDelta: [],
  // 1-minute ES candles — a SECOND dxLink stream (ES_1M_CANDLES=1), not a view of
  // esCandles: dxLink aggregates server-side by the {=Nm} suffix, so 1m detail
  // does not exist inside the 5m feed. Kept in its own keys because the two share
  // a slotKey space (09:30 is 09:30 at either aggregation) and merging them would
  // interleave two aggregations into one series. Empty when 1m is disabled.
  es1mCandles: [],
  es1mCandlesDelta: [],
  // Feed health
  status: {
    ttAuthenticated: false,
    dxlinkConnected: false,
    contractsSubscribed: 0,
    lastFeedAt: null,
    lastError: null,
    idle: false,
    // Chart-readiness gate: false until OI + broker greeks are warm. The client
    // shows a loader and withholds the GEX chart until this flips true.
    chartReady: false,
    oiCoverage: 0,
    greeksCoverage: 0,
  },
  // Last successful update timestamp
  updatedAt: 0,
};

function shallowEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

/** Apply a patch; emit 'change' with the set of changed keys if anything changed. */
function setState(patch) {
  const changedKeys = [];
  for (const [key, value] of Object.entries(patch)) {
    // Arrays/objects: replace by reference (callers pass fresh objects).
    if (state[key] !== value) {
      state[key] = value;
      changedKeys.push(key);
    }
  }
  if (changedKeys.length) {
    emitter.emit('change', { state: getState(), changedKeys });
  }
  return changedKeys;
}

/**
 * Apply a patch WITHOUT emitting 'change'. Used for fields that back the
 * connect-time snapshot but should not trigger a per-change broadcast — e.g. the
 * full esCandles array, which is sent once on connect while live updates go out
 * as a small esCandlesDelta instead.
 */
function setStateSilent(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (state[key] !== value) state[key] = value;
  }
}

/** Snapshot of current state (shallow copy; nested objects shared by ref). */
function getState() {
  return { ...state, status: { ...state.status } };
}

/** Subscribe to changes. Returns an unsubscribe function. */
function onChange(fn) {
  emitter.on('change', fn);
  return () => emitter.off('change', fn);
}

// Both sides of the basis (spot from Theta's index feed, esFut from TT/dxLink)
// update independently on their own feeds' cadence. If one side is stale
// relative to the other by more than this, hold the last good basis instead
// of publishing a skewed reading — this is what was making the ES Candles
// basis badge / ES-converted Put Wall jump around.
const BASIS_FRESH_WINDOW_MS = 4000;

/** Recompute `basis` iff spot and esFut were both updated within the fresh window of each other. */
function _recomputeBasis() {
  const { spot, esFut, spotAt, esFutAt } = state;
  if (!(spot > 0) || !(esFut > 0) || !spotAt || !esFutAt) return;
  if (Math.abs(spotAt - esFutAt) > BASIS_FRESH_WINDOW_MS) return; // one side stale — hold last good basis
  const basis = Math.round((esFut - spot) * 100) / 100;
  if (state.basis !== basis) setState({ basis });
}

/** Record a full GEX computation result. */
function setGexUpdate({
  gexRows,
  spot,
  expiry,
  totals,
  callWall,
  putWall,
  gexFlip,
  totalNetGex,
  totalFlowGex,
}) {
  if (spot > 0) setStateSilent({ spotAt: Date.now() });
  setState({
    gexRows: gexRows ?? state.gexRows,
    spot: spot ?? state.spot,
    expiry: expiry ?? state.expiry,
    totals: totals ?? state.totals,
    callWall: callWall ?? state.callWall,
    putWall: putWall ?? state.putWall,
    gexFlip: gexFlip ?? state.gexFlip,
    totalNetGex: totalNetGex ?? state.totalNetGex,
    totalFlowGex: totalFlowGex ?? state.totalFlowGex,
    updatedAt: Date.now(),
  });
  if (spot > 0) _recomputeBasis();
  clearError();
}

/** Record the latest flow bucket. */
function setFlow(flow) {
  setState({ flow });
}

/** Update spot independently of a full GEX recompute. */
function setSpot(spot) {
  if (!(spot > 0)) return;
  setStateSilent({ spotAt: Date.now() });
  setState({ spot });
  _recomputeBasis();
}

/** Current authoritative spot (broker scale). 0 until first quote/GEX recompute. */
function getSpot() {
  return state.spot || 0;
}

/** Update auxiliary VIX / ES future quotes (and their prior closes). */
function setAux(patch) {
  const next = {};
  if (patch.vix > 0) next.vix = patch.vix;
  if (patch.esFut > 0) { next.esFut = patch.esFut; setStateSilent({ esFutAt: Date.now() }); }
  if (patch.vixPrevClose > 0) next.vixPrevClose = patch.vixPrevClose;
  if (patch.esFutPrevClose > 0) next.esFutPrevClose = patch.esFutPrevClose;
  if (patch.spotDisplay > 0) next.spotDisplay = patch.spotDisplay;
  if (Object.keys(next).length) setState(next);
  if (patch.esFut > 0) _recomputeBasis();
}

/** Update available expirations list. */
function setExpirations(expirations) {
  setState({ expirations });
}

/** Set active expiry. */
function setExpiry(expiry) {
  setState({ expiry });
}

/** Patch feed-health status. */
function setStatus(patch) {
  const next = { ...state.status, ...patch };
  if (!shallowEqual(next, state.status)) {
    state.status = next;
    emitter.emit('change', { state: getState(), changedKeys: ['status'] });
  }
}

function setError(msg) {
  setStatus({ lastError: msg });
}

function clearError() {
  if (state.status.lastError !== null) setStatus({ lastError: null });
}

module.exports = {
  getState,
  setState,
  setStateSilent,
  onChange,
  setGexUpdate,
  setFlow,
  setSpot,
  getSpot,
  setAux,
  setExpirations,
  setExpiry,
  setStatus,
  setError,
  clearError,
};
