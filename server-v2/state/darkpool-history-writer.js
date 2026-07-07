'use strict';
/**
 * server-v2/state/darkpool-history-writer.js
 *
 * Persists dark-pool (TRF) prints identified by darkpool-stream.js to Postgres
 * so /proxy/darkpool-history (tape) and /proxy/darkpool-accum (accumulation
 * chart) can serve them. Mirrors the pool/error handling in flow-history-writer.js.
 *
 * Table `darkpool_prints` is created on first write. Unlike flow_prints (which
 * coalesces same-contract fills and UPSERTs), each dark-pool print is a
 * standalone row keyed by (underlying, date, seq) — Theta's per-symbol trade
 * sequence — so a re-delivered print is just a no-op conflict.
 *
 * No-ops cleanly when DATABASE_URL is unset.
 */

let pool = null;
let pgUnavailable = false;
let tableEnsured = false;

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
      console.warn('[darkpool-history] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    console.error('[darkpool-history] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureTable(p) {
  if (tableEnsured) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS darkpool_prints (
      ts               BIGINT       NOT NULL,
      date             TEXT         NOT NULL,
      underlying       TEXT         NOT NULL,
      underlying_norm  TEXT         NOT NULL,
      seq              BIGINT       NOT NULL DEFAULT 0,
      price            REAL,
      size             INTEGER,
      notional         REAL,
      exchange         SMALLINT,
      condition        SMALLINT,
      PRIMARY KEY (underlying, date, seq)
    )
  `);
  await p.query('CREATE INDEX IF NOT EXISTS darkpool_prints_date_norm_ts_idx ON darkpool_prints (date, underlying_norm, ts)');
  tableEnsured = true;
}

// Track the newest ts already flushed per key so each tick only writes the tail.
let lastFlushedTs = 0;

/**
 * Persist new dark-pool prints. Fire-and-forget; never throws into caller.
 * @param {Array<object>} tape  DarkpoolPrint-shaped entries (oldest-first)
 */
async function writeDarkpoolTape(tape) {
  const p = getPool();
  if (!p || !Array.isArray(tape) || !tape.length) return;

  try {
    await ensureTable(p);

    const fresh = tape.filter((o) => Number(o.ts) >= lastFlushedTs);
    if (!fresh.length) return;

    const cols = 10;
    const values = [];
    const params = [];
    let i = 0;
    let maxTs = lastFlushedTs;
    for (const o of fresh) {
      const ts = Number(o.ts);
      if (!Number.isFinite(ts)) continue;
      if (ts > maxTs) maxTs = ts;
      const ph = [];
      for (let c = 0; c < cols; c++) ph.push(`$${++i}`);
      values.push(`(${ph.join(',')})`);
      params.push(
        ts,
        String(o.date ?? ''),
        String(o.underlying ?? ''),
        String(o.underlying ?? '').toUpperCase(),
        Number.isFinite(Number(o.seq)) ? Number(o.seq) : 0,
        Number.isFinite(Number(o.price)) ? Number(o.price) : null,
        Number.isFinite(Number(o.size)) ? Math.round(Number(o.size)) : null,
        Number.isFinite(Number(o.notional)) ? Number(o.notional) : null,
        Number.isFinite(Number(o.exchange)) ? Number(o.exchange) : null,
        Number.isFinite(Number(o.condition)) ? Number(o.condition) : null,
      );
    }
    if (!values.length) return;

    await p.query(
      `INSERT INTO darkpool_prints
         (ts, date, underlying, underlying_norm, seq, price, size, notional, exchange, condition)
       VALUES ${values.join(', ')}
       ON CONFLICT (underlying, date, seq) DO NOTHING`,
      params
    );
    lastFlushedTs = maxTs;
  } catch (e) {
    console.warn('[darkpool-history] write failed (will retry next tick):', e.message);
    const msg = String(e?.message || '');
    if (/terminat|ECONNRESET|ETIMEDOUT|Connection|socket|server closed|after calling end|recovery mode|not yet accepting|cannot use a pool/i.test(msg)) {
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    }
  }
}

module.exports = { writeDarkpoolTape, getPool };
