'use strict';
/**
 * server-v2/state/flow-history-writer.js
 *
 * Persists the flow tape (per-order, coalesced 500ms slots; SPX + any
 * FLOW_TICKERS roots, each row tagged with its `underlying`) to Postgres so
 * the /flow page can backfill today's history on load instead of seeing only the
 * live in-memory buffer. Mirrors the pool/error handling in gex-history-writer.js.
 *
 * Table `flow_prints` is created on first write (server-v2 connects to PG
 * directly and does NOT run lib/db.ts ensureAllTables). Primary key
 * (ts, symbol, side) matches the FlowProcessor coalescing key: prints in the
 * same 500ms slot on the same contract+side merge into one row, so an UPSERT
 * keeps the row's final coalesced size/premium as the slot fills.
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
      console.warn('[flow-history] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    console.error('[flow-history] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

async function ensureTable(p) {
  if (tableEnsured) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS flow_prints (
      ts          BIGINT       NOT NULL,
      date        TEXT         NOT NULL,
      symbol      TEXT         NOT NULL,
      underlying  TEXT,
      expiration  TEXT,
      strike      REAL,
      type        TEXT,
      side        TEXT         NOT NULL,
      action      TEXT,
      bucket      TEXT,
      price       REAL,
      size        INTEGER,
      premium     REAL,
      is_otm      BOOLEAN,
      PRIMARY KEY (ts, symbol, side)
    )
  `);
  await p.query('CREATE INDEX IF NOT EXISTS flow_prints_date_ts_idx ON flow_prints (date, ts)');
  tableEnsured = true;
}

function todayYmdET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// Track the newest ts we've already flushed, so each tick only writes the tail.
// Coalescing mutates the latest slot in place, so we re-write any entry whose ts
// is >= (lastFlushedTs − one slot) to capture the slot's final accumulated size.
let lastFlushedTs = 0;
const SLOT_MS = 500;

/**
 * Persist new/updated tape entries. Fire-and-forget; never throws into caller.
 * @param {Array<object>} tape  FlowOrder-shaped entries (oldest-first)
 */
async function writeFlowTape(tape) {
  const p = getPool();
  if (!p || !Array.isArray(tape) || !tape.length) return;

  try {
    await ensureTable(p);

    // Only the tail can have changed: anything at or after the last-flushed slot.
    const cutoff = lastFlushedTs - SLOT_MS;
    // Dedupe within the batch by the PK (ts|symbol|side): the tape can hold more
    // than one entry sharing that key (e.g. different action in the same slot),
    // and Postgres rejects a single ON CONFLICT touching the same row twice.
    // Last occurrence wins — it carries the slot's most-accumulated values.
    const byKey = new Map();
    for (const o of tape) {
      if (Number(o.ts) < cutoff) continue;
      byKey.set(`${o.ts}|${o.symbol}|${o.side}`, o);
    }
    const fresh = [...byKey.values()];
    if (!fresh.length) return;

    const date = todayYmdET();
    const cols = 14;
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
        date,
        String(o.symbol ?? ''),
        o.underlying ?? null,
        o.expiration ?? null,
        Number.isFinite(Number(o.strike)) ? Number(o.strike) : null,
        o.type ?? null,
        String(o.side ?? ''),
        o.action ?? null,
        o.bucket ?? null,
        Number.isFinite(Number(o.price)) ? Number(o.price) : null,
        Number.isFinite(Number(o.size)) ? Math.round(Number(o.size)) : null,
        Number.isFinite(Number(o.premium)) ? Number(o.premium) : null,
        typeof o.isOtm === 'boolean' ? o.isOtm : null,
      );
    }
    if (!values.length) return;

    await p.query(
      `INSERT INTO flow_prints
         (ts, date, symbol, underlying, expiration, strike, type, side, action, bucket, price, size, premium, is_otm)
       VALUES ${values.join(', ')}
       ON CONFLICT (ts, symbol, side) DO UPDATE SET
         size = EXCLUDED.size,
         price = EXCLUDED.price,
         premium = EXCLUDED.premium,
         action = EXCLUDED.action,
         bucket = EXCLUDED.bucket,
         is_otm = EXCLUDED.is_otm`,
      params
    );
    lastFlushedTs = maxTs;
  } catch (e) {
    console.warn('[flow-history] write failed (will retry next tick):', e.message);
    const msg = String(e?.message || '');
    if (/terminat|ECONNRESET|ETIMEDOUT|Connection|socket|server closed|after calling end|recovery mode|not yet accepting|cannot use a pool/i.test(msg)) {
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    }
  }
}

module.exports = { writeFlowTape };
