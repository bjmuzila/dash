'use strict';
/**
 * server-v2/darkpool-recorder.js
 *
 * Bootstrap: connects DarkpoolStreamClient (STOCK TRF/"dark pool" prints),
 * buffers incoming prints in memory, and flushes new ones to Postgres every
 * few seconds via state/darkpool-history-writer.js. Mirrors the shape of the
 * other in-process recorders (oi-change-recorder.js, eod-gex-recorder.js) —
 * started once from server-with-proxy.js's server.listen callback, no separate
 * docker service needed.
 *
 * No-op unless THETA_WS_URL is reachable and DARKPOOL_ENABLED isn't set to '0'
 * (default on — Stocks Pro is required upstream; a 403 there just means this
 * recorder logs a warning and keeps retrying like the rest of the Theta feeds).
 */

const { DarkpoolStreamClient } = require('./darkpool-stream');
const { writeDarkpoolTape } = require('./state/darkpool-history-writer');

const FLUSH_INTERVAL_MS = 2000;
// Bounded in-memory buffer — flushed to Postgres every tick, so this only ever
// needs to hold a couple seconds' worth of prints across all tracked tickers.
const BUFFER_CAP = 5000;

let client = null;
let buffer = [];
let flushTimer = null;
let started = false;

function onDarkTrade(print) {
  buffer.push(print);
  if (buffer.length > BUFFER_CAP) buffer.splice(0, buffer.length - BUFFER_CAP);
}

async function flush() {
  if (!buffer.length) return;
  const batch = buffer;
  buffer = [];
  await writeDarkpoolTape(batch);
}

function startDarkpoolRecorder() {
  if (started) return;
  if (process.env.DARKPOOL_ENABLED === '0') {
    console.log('[DARKPOOL] disabled via DARKPOOL_ENABLED=0');
    return;
  }
  started = true;
  client = new DarkpoolStreamClient({ onDarkTrade });
  client.connect();
  flushTimer = setInterval(() => { flush().catch(() => {}); }, FLUSH_INTERVAL_MS);
  if (flushTimer.unref) flushTimer.unref();
  console.log('[DARKPOOL] recorder started');
}

/** Grow the tracked-root keep-list at runtime (e.g. a ticker chip-added on /flow). */
function addTrackedTicker(ticker) {
  client?.addRoot(ticker);
}

function isTracked(ticker) {
  return client ? client.isTracked(ticker) : false;
}

module.exports = { startDarkpoolRecorder, addTrackedTicker, isTracked };
