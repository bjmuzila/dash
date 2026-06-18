/**
 * GEX computation loop.
 *
 * Every GEX_INTERVAL ms:
 *   1. Fetch SPXW chain from TT REST (or use cached if fresh)
 *   2. Fetch SPX spot price
 *   3. Compute GEX rows (pure function)
 *   4. Update market-state (triggers WS broadcast)
 *   5. Write snapshot to Postgres
 *
 * No dxGreeksCache dependency. No per-client request handling.
 * Data is always available when clients connect.
 */
'use strict';

const { fetchChainRows, fetchSpxwExpirations, fetchSpxSpot } = require('../fetchers/tt-chain');
const { computeGexRows, findGexFlip, findCallWall, findPutWall, totalNetGex } = require('../computation/gex-calculator');
const marketState = require('../state/market-state');

const GEX_INTERVAL        = 5_000;   // ms between GEX updates
const EXPIRY_INTERVAL     = 60_000;  // ms between expiry list refreshes
const CHAIN_CACHE_TTL     = 4_000;   // don't re-fetch if last fetch was < 4s ago
const PG_WRITE_INTERVAL   = 30_000;  // write to Postgres at most every 30s

let pgPool = null;         // set via init()
let loopTimer = null;
let expiryTimer = null;
let lastFetchAt = 0;
let lastPgWriteAt = 0;
let cachedRows = [];       // raw option rows from last fetch
let isRunning = false;

// ── Postgres write (non-blocking, fire-and-forget) ───────────────────────────

async function pgWriteGexSnapshot(gexRows, spot, expiry) {
  if (!pgPool || !gexRows.length || !(spot > 0)) return;
  const now = Date.now();
  if (now - lastPgWriteAt < PG_WRITE_INTERVAL) return;
  lastPgWriteAt = now;

  const date = new Date().toISOString().slice(0, 10);
  try {
    for (const row of gexRows) {
      await pgPool.query(
        `INSERT INTO option_strike_gex_history (timestamp, date, expiry, spot, strike, net_gex)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [now, date, expiry, spot, row.strike, row.netGEX]
      );
    }
  } catch (e) {
    console.error('[gex-loop] pg write error:', e.message);
  }
}

// ── Single loop tick ─────────────────────────────────────────────────────────

async function tick() {
  const expiry = marketState.getState().expiry;
  if (!expiry) {
    console.log('[gex-loop] No expiry selected yet, skipping tick');
    return;
  }

  try {
    // 1. Fetch spot price
    const spot = await fetchSpxSpot();
    if (!(spot > 0)) {
      console.warn('[gex-loop] Could not fetch spot price');
      return;
    }

    // 2. Fetch chain (use cached rows if fresh)
    const now = Date.now();
    if (now - lastFetchAt > CHAIN_CACHE_TTL || !cachedRows.length) {
      cachedRows = await fetchChainRows(expiry, spot);
      lastFetchAt = now;
      console.log(`[gex-loop] Fetched ${cachedRows.length} option rows for ${expiry}`);
    }

    if (!cachedRows.length) {
      marketState.setError(`No chain rows returned for ${expiry}`);
      return;
    }

    // 3. Compute GEX
    const gexRows = computeGexRows(cachedRows, spot);

    // 4. Compute summary levels
    const flip    = findGexFlip(gexRows, spot);
    const cw      = findCallWall(gexRows, spot);
    const pw      = findPutWall(gexRows, spot);
    const netGex  = totalNetGex(gexRows);

    // 5. Update state (triggers WS broadcast via onChange listener in broadcaster)
    marketState.setGexUpdate({
      gexRows,
      spot,
      expiry,
      callWall:    cw,
      putWall:     pw,
      gexFlip:     flip,
      totalNetGex: netGex,
    });

    // 6. Write to Postgres (rate-limited)
    pgWriteGexSnapshot(gexRows, spot, expiry).catch(() => {});

  } catch (err) {
    console.error('[gex-loop] tick error:', err.message);
    marketState.setError(err.message);
  }
}

// ── Expiry refresh ───────────────────────────────────────────────────────────

async function refreshExpirations() {
  try {
    const expirations = await fetchSpxwExpirations();
    if (!expirations.length) return;

    marketState.setExpirations(expirations);

    // Auto-select 0DTE if no expiry is set yet
    const current = marketState.getState().expiry;
    if (!current && expirations[0]) {
      const selected = expirations[0];
      marketState.setExpiry(selected);
      cachedRows = []; // force re-fetch for new expiry
      console.log(`[gex-loop] Auto-selected expiry: ${selected}`);
    }

    console.log(`[gex-loop] Expirations refreshed: ${expirations.slice(0, 3).join(', ')}...`);
  } catch (err) {
    console.error('[gex-loop] refreshExpirations error:', err.message);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the GEX loop.
 * @param {object} options
 * @param {object} options.pool  - pg Pool instance (optional, for Postgres writes)
 */
async function start({ pool } = {}) {
  if (isRunning) return;
  isRunning = true;
  pgPool = pool || null;

  console.log('[gex-loop] Starting...');

  // Fetch expirations immediately, then on interval
  await refreshExpirations();
  expiryTimer = setInterval(refreshExpirations, EXPIRY_INTERVAL);

  // Run first tick immediately (after expiry is set), then on interval
  await tick();
  loopTimer = setInterval(tick, GEX_INTERVAL);

  console.log(`[gex-loop] Running. Interval: ${GEX_INTERVAL}ms`);
}

function stop() {
  if (loopTimer)   clearInterval(loopTimer);
  if (expiryTimer) clearInterval(expiryTimer);
  loopTimer   = null;
  expiryTimer = null;
  isRunning   = false;
  console.log('[gex-loop] Stopped.');
}

/**
 * Switch active expiry (called when user clicks a DTE button).
 * Forces an immediate re-fetch and tick.
 */
async function setExpiry(expiry) {
  if (!expiry) return;
  marketState.setExpiry(expiry);
  cachedRows  = [];    // force re-fetch
  lastFetchAt = 0;
  await tick();
}

module.exports = { start, stop, setExpiry };
