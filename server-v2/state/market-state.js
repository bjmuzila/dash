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
  // Auxiliary live quotes: VIX index + front ES future, with prior closes.
  vix: 0,
  esFut: 0,
  vixPrevClose: 0,
  esFutPrevClose: 0,
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
  // Latest flow bucket
  flow: null,
  // Feed health
  status: {
    ttAuthenticated: false,
    dxlinkConnected: false,
    contractsSubscribed: 0,
    lastFeedAt: null,
    lastError: null,
    idle: false,
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

/** Snapshot of current state (shallow copy; nested objects shared by ref). */
function getState() {
  return { ...state, status: { ...state.status } };
}

/** Subscribe to changes. Returns an unsubscribe function. */
function onChange(fn) {
  emitter.on('change', fn);
  return () => emitter.off('change', fn);
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
}) {
  setState({
    gexRows: gexRows ?? state.gexRows,
    spot: spot ?? state.spot,
    expiry: expiry ?? state.expiry,
    totals: totals ?? state.totals,
    callWall: callWall ?? state.callWall,
    putWall: putWall ?? state.putWall,
    gexFlip: gexFlip ?? state.gexFlip,
    totalNetGex: totalNetGex ?? state.totalNetGex,
    updatedAt: Date.now(),
  });
  clearError();
}

/** Record the latest flow bucket. */
function setFlow(flow) {
  setState({ flow });
}

/** Update spot independently of a full GEX recompute. */
function setSpot(spot) {
  if (spot > 0) setState({ spot });
}

/** Update auxiliary VIX / ES future quotes (and their prior closes). */
function setAux(patch) {
  const next = {};
  if (patch.vix > 0) next.vix = patch.vix;
  if (patch.esFut > 0) next.esFut = patch.esFut;
  if (patch.vixPrevClose > 0) next.vixPrevClose = patch.vixPrevClose;
  if (patch.esFutPrevClose > 0) next.esFutPrevClose = patch.esFutPrevClose;
  if (Object.keys(next).length) setState(next);
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
  onChange,
  setGexUpdate,
  setFlow,
  setSpot,
  setAux,
  setExpirations,
  setExpiry,
  setStatus,
  setError,
  clearError,
};
