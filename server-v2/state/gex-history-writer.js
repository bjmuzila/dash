'use strict';
/**
 * server-v2/state/gex-history-writer.js
 *
 * Rate-limited Postgres writer for per-strike net GEX history. Ports the write
 * behavior from the old server/loops/gex-loop.js (pgWriteGexSnapshot) so the
 * dashboard's rolling-net-GEX history (/api/snapshots/option-strike-gex-history)
 * keeps working under server-v2.
 *
 * Writes into the existing `option_strike_gex_history` table (created by
 * lib/db.ts ensureAllTables): (timestamp, date, expiry, spot, strike, net_gex).
 *
 * No-ops cleanly when DATABASE_URL is unset, so the feed runs fine without a DB.
 */

const PG_WRITE_INTERVAL_MS = Number(process.env.GEX_PG_WRITE_INTERVAL_MS || 30_000);

let pool = null;
let pgUnavailable = false;
let lastWriteAt = 0;

/** Lazily create a shared pg Pool. Returns null if DB isn't configured/available. */
function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) {
    pgUnavailable = true;
    return null;
  }
  try {
    // Require lazily so environments without pg/DATABASE_URL don't pay for it.
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
        ? undefined
        : { rejectUnauthorized: false },
      max: 3,
    });
    // Idle-client errors (Render closing idle conns) must not crash the process
    // and must not spam logs — drop the pool so the next write rebuilds it.
    pool.on('error', (e) => {
      console.warn('[gex-history] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    console.error('[gex-history] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

function todayYmdET() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts; // en-CA → YYYY-MM-DD
}

/**
 * Persist one GEX snapshot (one row per strike), rate-limited.
 * Fire-and-forget: never throws into the caller.
 *
 * @param {Array<{strike:number, netGEX:number}>} gexRows
 * @param {number} spot
 * @param {string} expiry  YYYY-MM-DD
 */
async function writeGexSnapshot(gexRows, spot, expiry) {
  const p = getPool();
  if (!p || !Array.isArray(gexRows) || !gexRows.length || !(spot > 0) || !expiry) return;

  const now = Date.now();
  if (now - lastWriteAt < PG_WRITE_INTERVAL_MS) return;

  const date = todayYmdET();
  try {
    // Single multi-row insert (faster + atomic) instead of N round-trips.
    const values = [];
    const params = [];
    let i = 0;
    for (const row of gexRows) {
      const strike = Number(row.strike);
      const netGex = Number(row.netGEX);
      if (!(strike > 0) || !Number.isFinite(netGex)) continue;
      values.push(`($${++i}, $${++i}, $${++i}, $${++i}, $${++i}, $${++i})`);
      params.push(now, date, expiry, spot, strike, netGex);
    }
    if (!values.length) return;
    await p.query(
      `INSERT INTO option_strike_gex_history (timestamp, date, expiry, spot, strike, net_gex)
       VALUES ${values.join(', ')}`,
      params
    );
    lastWriteAt = now; // only throttle after a successful write
  } catch (e) {
    console.warn('[gex-history] write failed (will retry next tick):', e.message);
    // Drop the pool so a terminated/SSL-dropped connection is rebuilt next time.
    try { pool?.end().catch(() => {}); } catch {}
    pool = null;
  }
}

module.exports = { writeGexSnapshot };
