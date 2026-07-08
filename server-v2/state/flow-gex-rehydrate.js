'use strict';
/**
 * server-v2/state/flow-gex-rehydrate.js
 *
 * Rebuilds the day's dealer inventory (per-strike call/put buy+sell volume)
 * from `flow_prints` — the tape is already persisted there by
 * state/flow-history-writer.js every 500ms. This lets FlowGexAccumulator
 * survive a mid-day process restart instead of resetting to zero, since the
 * in-memory dealerInventory Map has no durability on its own.
 *
 * flow_prints rows are per-(ts,symbol,side) coalesced slots, not running
 * totals, so summing `size` across the day's rows per strike/type/side gives
 * the same total volume ingestTape() would have accumulated live.
 *
 * No-ops cleanly when DATABASE_URL is unset.
 */

let pool = null;
let pgUnavailable = false;

function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) { pgUnavailable = true; return null; }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[flow-gex-rehydrate] pool error:', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    console.error('[flow-gex-rehydrate] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

function todayYmdET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * Replay today's flow_prints for one expiration into a
 * strike -> {callBuyVol, callSellVol, putBuyVol, putSellVol} Map, applying
 * the same dealer-mirror rule as FlowGexAccumulator.ingestTape:
 *   taker buy  -> dealer sold  (callSellVol / putSellVol)
 *   taker sell -> dealer bought (callBuyVol / putBuyVol)
 *
 * @param {string} expiration 'YYYY-MM-DD'
 * @returns {Promise<{date: string, inventoryByStrike: Map}>}
 */
async function rebuildInventoryFromFlowPrints(expiration) {
  const date = todayYmdET();
  const empty = { date, inventoryByStrike: new Map() };
  const p = getPool();
  if (!p || !expiration) return empty;

  try {
    const { rows } = await p.query(
      `SELECT strike, type, side, SUM(size) AS vol
         FROM flow_prints
        WHERE date = $1 AND expiration = $2 AND strike IS NOT NULL AND size IS NOT NULL
        GROUP BY strike, type, side`,
      [date, expiration]
    );

    const inventoryByStrike = new Map();
    for (const r of rows) {
      const strike = Number(r.strike);
      const vol = Number(r.vol);
      if (!(strike > 0) || !(vol > 0)) continue;
      if (!inventoryByStrike.has(strike)) {
        inventoryByStrike.set(strike, {
          callBuyVol: 0, callSellVol: 0, putBuyVol: 0, putSellVol: 0,
        });
      }
      const inv = inventoryByStrike.get(strike);
      if (r.type === 'C') {
        if (r.side === 'buy') inv.callSellVol += vol; // dealer sold call to taker
        else if (r.side === 'sell') inv.callBuyVol += vol; // dealer bought call from taker
      } else if (r.type === 'P') {
        if (r.side === 'buy') inv.putSellVol += vol;
        else if (r.side === 'sell') inv.putBuyVol += vol;
      }
    }
    return { date, inventoryByStrike };
  } catch (e) {
    console.warn('[flow-gex-rehydrate] query failed:', e.message);
    return empty;
  }
}

/**
 * Convenience: rebuild + load straight into a FlowGexAccumulator instance.
 * Fire-and-forget friendly; never throws.
 * @param {import('../computation/flow-gex').FlowGexAccumulator} accumulator
 * @param {string} expiration
 */
async function rehydrateAccumulator(accumulator, expiration) {
  if (!accumulator || !expiration) return;
  try {
    const { date, inventoryByStrike } = await rebuildInventoryFromFlowPrints(expiration);
    if (inventoryByStrike.size) {
      accumulator.hydrate(date, expiration, inventoryByStrike);
      console.log(`[flow-gex-rehydrate] restored ${inventoryByStrike.size} strikes of dealer inventory for ${expiration} (${date}) from flow_prints`);
    }
  } catch (e) {
    console.warn('[flow-gex-rehydrate] rehydrate failed:', e.message);
  }
}

module.exports = { rebuildInventoryFromFlowPrints, rehydrateAccumulator };
