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
  // spot: underlying spot at print time, added after the table already existed
  // in prod — lazy ALTER so old rows just read back NULL instead of failing.
  await p.query('ALTER TABLE flow_prints ADD COLUMN IF NOT EXISTS spot REAL');
  await p.query('CREATE INDEX IF NOT EXISTS flow_prints_date_ts_idx ON flow_prints (date, ts)');

  // underlying_norm: uppercased `underlying`, written at insert time so
  // /proxy/flow-history and /proxy/flow-netprem can filter on a plain indexed
  // column instead of `upper(underlying) = ANY(...)`, which can't use a plain
  // btree index and forces a per-row scan of the whole date partition.
  await p.query('ALTER TABLE flow_prints ADD COLUMN IF NOT EXISTS underlying_norm TEXT');
  await p.query('CREATE INDEX IF NOT EXISTS flow_prints_date_norm_ts_idx ON flow_prints (date, underlying_norm, ts)');
  // Covering index for /proxy/flow-netprem (see server-with-proxy.js) so the
  // per-bin aggregate query on a hot ticker like SPX can be answered as an
  // index-only scan instead of a heap fetch per matching row.
  await p.query('CREATE INDEX IF NOT EXISTS flow_prints_netprem_covering_idx ON flow_prints (date, underlying_norm, ts) INCLUDE (type, side, premium, size, is_otm)');
  // One-time backfill for rows written before this column existed.
  await p.query('UPDATE flow_prints SET underlying_norm = upper(underlying) WHERE underlying_norm IS NULL AND underlying IS NOT NULL');
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
// Keyed by cursor so INDEPENDENT tape streams (SPX engine vs. the multi-ticker
// recorder) each keep their own flush position — sharing one global cursor let
// whichever stream flushed last advance the tail past the other's unflushed rows.
const lastFlushedByCursor = new Map();
const SLOT_MS = 500;

/**
 * Persist new/updated tape entries. Fire-and-forget; never throws into caller.
 * @param {Array<object>} tape  FlowOrder-shaped entries (oldest-first)
 * @param {string} [cursor]     independent flush cursor (default 'spx'); the
 *                              multi-ticker recorder passes 'record'.
 */
async function writeFlowTape(tape, cursor = 'spx') {
  const p = getPool();
  if (!p || !Array.isArray(tape) || !tape.length) return;

  try {
    await ensureTable(p);

    // Only the tail can have changed: anything at or after the last-flushed slot.
    const lastFlushedTs = lastFlushedByCursor.get(cursor) || 0;
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
    const cols = 16;
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
        o.underlying != null ? String(o.underlying).toUpperCase() : null,
        Number.isFinite(Number(o.spot)) && Number(o.spot) > 0 ? Number(o.spot) : null,
      );
    }
    if (!values.length) return;

    await p.query(
      `INSERT INTO flow_prints
         (ts, date, symbol, underlying, expiration, strike, type, side, action, bucket, price, size, premium, is_otm, underlying_norm, spot)
       VALUES ${values.join(', ')}
       ON CONFLICT (ts, symbol, side) DO UPDATE SET
         size = EXCLUDED.size,
         price = EXCLUDED.price,
         premium = EXCLUDED.premium,
         action = EXCLUDED.action,
         bucket = EXCLUDED.bucket,
         is_otm = EXCLUDED.is_otm,
         underlying_norm = EXCLUDED.underlying_norm,
         spot = COALESCE(EXCLUDED.spot, flow_prints.spot)`,
      params
    );
    lastFlushedByCursor.set(cursor, maxTs);
  } catch (e) {
    console.warn('[flow-history] write failed (will retry next tick):', e.message);
    const msg = String(e?.message || '');
    if (/terminat|ECONNRESET|ETIMEDOUT|Connection|socket|server closed|after calling end|recovery mode|not yet accepting|cannot use a pool/i.test(msg)) {
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    }
  }
}

/**
 * Backfill historical flow rows (e.g. a morning session lost to a mid-session
 * container restart) into flow_prints. Differs from writeFlowTape in two ways:
 *   1. takes an EXPLICIT ET session date, stamped on every row (writeFlowTape
 *      always uses "today"), and
 *   2. has NO lastFlushedTs tail-cutoff — it writes every row handed to it.
 * Idempotent via the (ts, symbol, side) PK UPSERT, so re-running over the same
 * window can't duplicate. Chunked to stay under Postgres' 65535-param cap.
 * @param {Array<object>} rows    FlowOrder-shaped entries (any order)
 * @param {string} dateYmd        ET session date 'YYYY-MM-DD' stamped on all rows
 * @returns {Promise<number>}      rows written (post batch-dedupe)
 */
async function backfillFlowRows(rows, dateYmd) {
  const p = getPool();
  if (!p || !Array.isArray(rows) || !rows.length) return 0;
  await ensureTable(p);
  const date = String(dateYmd || todayYmdET());
  const cols = 16;
  const CHUNK = 500; // 500 * 16 = 8000 params, well under the 65535 cap

  // Dedupe within the batch by the PK — Postgres rejects one ON CONFLICT
  // touching the same row twice. Last occurrence wins.
  const byKey = new Map();
  for (const o of rows) {
    const ts = Number(o.ts);
    if (!Number.isFinite(ts)) continue;
    byKey.set(`${ts}|${o.symbol}|${o.side}`, o);
  }
  const fresh = [...byKey.values()];

  let sent = 0;
  for (let start = 0; start < fresh.length; start += CHUNK) {
    const slice = fresh.slice(start, start + CHUNK);
    const values = [];
    const params = [];
    let i = 0;
    for (const o of slice) {
      const ph = [];
      for (let c = 0; c < cols; c++) ph.push(`$${++i}`);
      values.push(`(${ph.join(',')})`);
      params.push(
        Number(o.ts),
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
        o.underlying != null ? String(o.underlying).toUpperCase() : null,
        Number.isFinite(Number(o.spot)) && Number(o.spot) > 0 ? Number(o.spot) : null,
      );
    }
    // eslint-disable-next-line no-await-in-loop
    await p.query(
      `INSERT INTO flow_prints
         (ts, date, symbol, underlying, expiration, strike, type, side, action, bucket, price, size, premium, is_otm, underlying_norm, spot)
       VALUES ${values.join(', ')}
       ON CONFLICT (ts, symbol, side) DO UPDATE SET
         size = EXCLUDED.size,
         price = EXCLUDED.price,
         premium = EXCLUDED.premium,
         action = EXCLUDED.action,
         bucket = EXCLUDED.bucket,
         is_otm = EXCLUDED.is_otm,
         underlying_norm = EXCLUDED.underlying_norm,
         spot = COALESCE(EXCLUDED.spot, flow_prints.spot)`,
      params,
    );
    sent += slice.length;
  }
  return sent;
}

module.exports = { writeFlowTape, backfillFlowRows };
