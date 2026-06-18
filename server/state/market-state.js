/**
 * Central in-memory market state.
 * Single source of truth for GEX rows, spot price, expiry, and summary levels.
 * The GEX loop writes here; the WS broadcaster reads from here.
 */
'use strict';

const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

const state = {
  // GEX chart data — ChainRow-compatible array
  gexRows:    [],
  // Spot price
  spot:       0,
  // Active expiry date string 'YYYY-MM-DD'
  expiry:     '',
  // All available expiry dates for the toolbar
  expirations: [],
  // Summary levels
  callWall:   null,
  putWall:    null,
  gexFlip:    null,
  totalNetGex: 0,
  // Last successful update timestamp
  updatedAt:  0,
  // Error state (null = ok, string = last error message)
  lastError:  null,
};

/**
 * Update state and emit 'change' with the fields that changed.
 * Only emits if something actually changed.
 */
function setState(patch) {
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (state[key] !== value) {
      state[key] = value;
      changed = true;
    }
  }
  if (changed) emitter.emit('change', { ...state });
}

/** Get a snapshot of current state (shallow copy). */
function getState() {
  return { ...state };
}

/** Subscribe to state changes. Returns an unsubscribe function. */
function onChange(fn) {
  emitter.on('change', fn);
  return () => emitter.off('change', fn);
}

/** Mark a successful GEX update. */
function setGexUpdate({ gexRows, spot, expiry, callWall, putWall, gexFlip, totalNetGex }) {
  setState({
    gexRows:     gexRows     ?? state.gexRows,
    spot:        spot        ?? state.spot,
    expiry:      expiry      ?? state.expiry,
    callWall:    callWall    ?? state.callWall,
    putWall:     putWall     ?? state.putWall,
    gexFlip:     gexFlip     ?? state.gexFlip,
    totalNetGex: totalNetGex ?? state.totalNetGex,
    updatedAt:   Date.now(),
    lastError:   null,
  });
}

/** Update available expirations list. */
function setExpirations(expirations) {
  setState({ expirations });
}

/** Set active expiry (persists across loop ticks). */
function setExpiry(expiry) {
  setState({ expiry });
}

/** Record an error without clearing existing GEX data. */
function setError(msg) {
  setState({ lastError: msg });
}

module.exports = {
  getState,
  setState,
  onChange,
  setGexUpdate,
  setExpirations,
  setExpiry,
  setError,
};
