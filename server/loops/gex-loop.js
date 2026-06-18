/**
 * GEX computation loop.
 *
 * Every GEX_INTERVAL ms:
 *   1. Call /api/gex (Next.js route → proxy chains/SPX → OI + estimated Greeks)
 *   2. Compute summary levels (flip, call wall, put wall)
 *   3. Update market-state (triggers WS broadcast to all /ws/gex clients)
 *   4. Write snapshot to Postgres
 *
 * No direct TT REST chain fetching — delegates to /api/gex which already
 * handles enrichment via the proxy's dxLink + estimateOptionGreekFallback.
 */
'use strict';

const { fetchSpxwExpirations } = require('../fetchers/tt-chain');
const { findGexFlip, findCallWall, findPutWall, totalNetGex } = require('../computation/gex-calculator');
const marketState = require('../state/market-state');
const http = require('http');

const NEXT_PORT = process.env.PORT || 3002;

/**
 * Fetch fully-computed GEX chain from the Next.js /api/gex route.
 * This route calls the proxy's chains/SPX endpoint which has OI + estimated Greeks.
 */
async function fetchGexFromApi(expiry) {
  return new Promise((resolve, reject) => {
    const url = `/api/gex?expiry=${encodeURIComponent(expiry)}`;
    const req = http.get({ hostname: '127.0.0.1', port: NEXT_PORT, path: url, timeout: 20000 }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('Invalid JSON from /api/gex')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('/api/gex timeout')); });
  });
}

const GEX_INTERVAL      = 5_000;   // ms between GEX updates
const EXPIRY_INTERVAL   = 60_000;  // ms between expiry list refreshes
const PG_WRITE_INTERVAL = 30_000;  // write to Postgres at most every 30s

let pgPool = null;
let loopTimer = null;
let expiryTimer = null;
let lastPgWriteAt = 0;
let cachedRows = [];       // last known GEX rows (used as fallback if fetch fails)
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
    // 1. Fetch GEX data from /api/gex (Next.js route that calls proxy w/ OI+Greeks)
    // Response shape: { chain: ChainRow[], spotPrice, callWall, putWall, gexFlip, summary }
    const apiResult = await fetchGexFromApi(expiry);
    const gexRows = Array.isArray(apiResult.chain) && apiResult.chain.length
      ? apiResult.chain
      : cachedRows;
    const spot    = Number(apiResult.spotPrice ?? 0) > 0
      ? Number(apiResult.spotPrice)
      : marketState.getState().spot;

    if (!gexRows.length) {
      marketState.setError(`No GEX rows returned for ${expiry}`);
      return;
    }
    if (!(spot > 0)) {
      console.warn('[gex-loop] Spot unknown — will retry next tick');
      return;
    }

    console.log(`[gex-loop] ${gexRows.length} GEX rows for ${expiry}, spot: ${spot}`);
    cachedRows = gexRows;

    // 2. Compute summary levels
    const flip   = findGexFlip(gexRows, spot);
    const cw     = findCallWall(gexRows, spot);
    const pw     = findPutWall(gexRows, spot);
    const netGex = totalNetGex(gexRows);

    // 3. Update state (triggers WS broadcast via onChange listener in broadcaster)
    marketState.setGexUpdate({
      gexRows,
      spot,
      expiry,
      callWall:    cw,
      putWall:     pw,
      gexFlip:     flip,
      totalNetGex: netGex,
    });

    // 4. Write to Postgres (rate-limited)
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
  cachedRows = [];    // clear so tick falls back to fresh fetch
  await tick();
}

module.exports = { start, stop, setExpiry };
