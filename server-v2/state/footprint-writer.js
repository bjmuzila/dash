'use strict';
/**
 * server-v2/state/footprint-writer.js
 *
 * Postgres read/write for the ES big-order footprint. Stores ONE row per ET
 * session day (es_footprint table, created by lib/db.ts ensureAllTables): the
 * whole day's footprint is upserted as a JSON blob, overwritten every few seconds.
 *
 * This makes the footprint durable across machines — any server connected to the
 * same DATABASE_URL reloads today's session on boot, instead of relying on a local
 * disk file that only exists on the machine that wrote it.
 *
 * Mirrors the lazy-pool + no-op-without-DB pattern of es-candle-writer.js.
 * No-ops cleanly when DATABASE_URL is unset (proxy falls back to the local file).
 */

let pool = null;
let pgUnavailable = false;

function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) {
    pgUnavailable = true;
    return null;
  }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
        ? undefined
        : { rejectUnauthorized: false },
      max: 3,
    });
    pool.on('error', (e) => {
      console.warn('[footprint] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    console.error('[footprint] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

/** True if a DB is configured (so the proxy knows whether to trust PG). */
function footprintDbEnabled() {
  return !!process.env.DATABASE_URL && !pgUnavailable;
}

/**
 * Upsert the whole-day footprint blob for `day` (ET ymd). Fire-and-forget:
 * never throws into the caller.
 * @param {string} day   ET session ymd, e.g. "2026-06-21"
 * @param {string} symbol
 * @param {object} payload  { trades, delta } (the same shape saved to disk)
 */
async function saveFootprint(day, symbol, payload) {
  const p = getPool();
  if (!p || !day) return;
  try {
    await p.query(
      `INSERT INTO es_footprint (day, symbol, updated_at, payload)
         VALUES ($1, $2, $3, $4)
       ON CONFLICT (day) DO UPDATE SET
         symbol = EXCLUDED.symbol,
         updated_at = EXCLUDED.updated_at,
         payload = EXCLUDED.payload`,
      [String(day), symbol == null ? null : String(symbol), Date.now(), JSON.stringify(payload || {})]
    );
  } catch (e) {
    console.warn('[footprint] write failed:', e.message);
    const msg = String(e?.message || '');
    if (/terminat|ECONNRESET|ETIMEDOUT|Connection|socket|server closed/i.test(msg)) {
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    }
  }
}

/**
 * Load the footprint blob for `day`. Returns { symbol, payload } or null if no row
 * (or no DB). Never throws.
 * @param {string} day  ET session ymd
 */
async function loadFootprint(day) {
  const p = getPool();
  if (!p || !day) return null;
  try {
    const r = await p.query(
      `SELECT symbol, payload FROM es_footprint WHERE day = $1 LIMIT 1`,
      [String(day)]
    );
    const row = r.rows?.[0];
    if (!row) return null;
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    return { symbol: row.symbol ?? null, payload: payload ?? {} };
  } catch (e) {
    console.warn('[footprint] read failed:', e.message);
    return null;
  }
}

module.exports = { saveFootprint, loadFootprint, footprintDbEnabled };
