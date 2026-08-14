'use strict';
/**
 * server-v2/state/es-candle-writer.js
 *
 * Postgres writer for ES/NQ futures candles. Mirrors the lazy-pool +
 * no-op-without-DB pattern of gex-history-writer.js. Writes into the existing
 * `es_candles` / `nq_candles` tables (created by lib/db.ts ensureAllTables),
 * upserting so a forming bar can be updated repeatedly within its slot.
 *
 * es_candles holds BOTH 1m and 5m bars, distinguished ONLY by intervalMinutes —
 * slotKey is identical for the same clock time at either aggregation. Every row
 * written here must therefore carry a correct intervalMinutes, and the conflict
 * target must include it. See the conflictTarget note below.
 *
 * No-ops cleanly when DATABASE_URL is unset.
 */

let pool = null;
let pgUnavailable = false;
let _lastPoolWarn = 0;

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
      max: 2,
      keepAlive: true,
    });
    pool.on('error', (e) => {
      console.warn('[es-candle] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    console.error('[es-candle] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

const maxN = (a, b) => (Number.isFinite(a) ? (Number.isFinite(b) ? Math.max(a, b) : a) : b);
const minN = (a, b) => (Number.isFinite(a) ? (Number.isFinite(b) ? Math.min(a, b) : a) : b);

/**
 * Normalize + de-duplicate a batch of candle rows down to one row per conflict
 * target, reproducing EXACTLY what the old row-at-a-time loop produced.
 *
 * This dedupe is not an optimization, it is REQUIRED: a multi-row
 * `INSERT .. ON CONFLICT DO UPDATE` aborts with "ON CONFLICT DO UPDATE command
 * cannot affect row a second time" if two VALUES tuples in the same statement
 * share a conflict target. A forming bar is written on every tick, so a flush
 * batch routinely contains many rows for one slot.
 *
 * Merge rules mirror the ON CONFLICT clause below:
 *   - date/slotKey/time/symbol/intervalMinutes/source/open are INSERT-only
 *     (never in DO UPDATE), so the FIRST row wins — same as the old loop, where
 *     the first row inserted and later ones only touched the updated columns.
 *   - timestamp/close/volume/avgVolume take EXCLUDED, so the LAST row wins.
 *   - high is GREATEST, low is LEAST.
 *
 * Exported as `_coalesceCandles` for state/es-candle-writer.selftest.js.
 * @returns {object[]} merged rows, in first-seen order
 */
function coalesceCandles(list, tbl, defSymbol) {
  const byKey = new Map();
  for (const r of list) {
    const ts = Number(r.timestamp);
    const slotKey = String(r.slotKey || '');
    if (!(ts > 0) || !slotKey) continue;
    const intervalMinutes = Number(r.intervalMinutes ?? 5);
    // nq_candles is still UNIQUE("slotKey") alone; es_candles is
    // UNIQUE("slotKey","intervalMinutes"). The dedupe key MUST match the
    // conflict target or the statement can still collide inside one chunk.
    const k = tbl === 'nq_candles' ? slotKey : `${slotKey}\u0000${intervalMinutes}`;
    const high = Number(r.high);
    const low = Number(r.low);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, {
        timestamp: ts,
        date: String(r.date || slotKey.slice(0, 10)),
        slotKey,
        time: String(r.time ?? slotKey.slice(11)),
        symbol: String(r.symbol ?? defSymbol),
        intervalMinutes,
        source: String(r.source ?? 'dxlink'),
        open: Number(r.open),
        high,
        low,
        close: Number(r.close),
        volume: Number(r.volume),
        avgVolume: Number(r.avgVolume ?? 0),
      });
      continue;
    }
    prev.timestamp = ts;
    prev.high = maxN(prev.high, high);
    prev.low = minN(prev.low, low);
    prev.close = Number(r.close);
    prev.volume = Number(r.volume);
    prev.avgVolume = Number(r.avgVolume ?? 0);
  }
  return Array.from(byKey.values());
}

const CANDLE_COLS = 13;
// 500 * 13 = 6500 params, well under Postgres' 65535-param cap.
const CANDLE_CHUNK = 500;

/**
 * Upsert one or many candle rows. Each row:
 *   { timestamp, date, slotKey, time, symbol, intervalMinutes, source,
 *     open, high, low, close, volume, avgVolume }
 * Fire-and-forget: never throws into the caller.
 * @param {object|object[]} rows
 */
async function writeCandles(rows, table = 'es_candles') {
  const p = getPool();
  if (!p) return;
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return;
  // Whitelist the table name (it's interpolated into SQL, never user-supplied).
  const tbl = table === 'nq_candles' ? 'nq_candles' : 'es_candles';
  const defSymbol = tbl === 'nq_candles' ? '/NQ' : '/ES';
  // The two tables have DIFFERENT unique keys, so the conflict target is not
  // shared:
  //   es_candles → UNIQUE("slotKey","intervalMinutes"). It holds 1m AND 5m bars,
  //     and slotKey carries no interval, so 09:30@1m and 09:30@5m are the same
  //     slotKey. Targeting slotKey alone here is not merely wrong — after
  //     scripts/migrate-es-candles-composite-key.sql that constraint does not
  //     exist and EVERY write throws "no unique or exclusion constraint matching
  //     the ON CONFLICT specification" into the catch below, silently halting the
  //     live recorder.
  //   nq_candles → still UNIQUE("slotKey") (5m only, no 1m writer). Same latent
  //     flaw; migrate it before adding any second NQ aggregation.
  const conflictTarget = tbl === 'nq_candles' ? '"slotKey"' : '"slotKey","intervalMinutes"';

  // One multi-row upsert per chunk instead of one statement per row. The forming
  // bar is rewritten on every tick, which made this the #2 and #4 statements by
  // call count in pg_stat_statements (162.9M es_candles + 136.6M nq_candles) for
  // two 19MB tables -- pure round-trip and dead-tuple churn.
  const merged = coalesceCandles(list, tbl, defSymbol);
  if (!merged.length) return;

  for (let i = 0; i < merged.length; i += CANDLE_CHUNK) {
    const chunk = merged.slice(i, i + CANDLE_CHUNK);
    const tuples = [];
    const params = [];
    for (const r of chunk) {
      const b = params.length;
      params.push(
        r.timestamp, r.date, r.slotKey, r.time, r.symbol, r.intervalMinutes, r.source,
        r.open, r.high, r.low, r.close, r.volume, r.avgVolume,
      );
      tuples.push(`(${Array.from({ length: CANDLE_COLS }, (_, j) => `$${b + j + 1}`).join(',')})`);
    }
    try {
      await p.query(
        `INSERT INTO ${tbl}
           (timestamp,date,"slotKey",time,symbol,"intervalMinutes",source,open,high,low,close,volume,"avgVolume")
         VALUES ${tuples.join(',')}
         ON CONFLICT(${conflictTarget}) DO UPDATE SET
           timestamp=EXCLUDED.timestamp,
           high=GREATEST(${tbl}.high,EXCLUDED.high),
           low=LEAST(${tbl}.low,EXCLUDED.low),
           close=EXCLUDED.close,
           volume=EXCLUDED.volume,
           "avgVolume"=EXCLUDED."avgVolume"`,
        params,
      );
    } catch (e) {
      const msg = String(e?.message || '');
      // Reset the cached pool so the next call rebuilds a fresh one. Includes
      // "Cannot use a pool after calling end" (the ended-pool case) and DB
      // restart/recovery errors — otherwise every later write hammers the dead
      // pool and spams the log until restart.
      if (/terminat|ECONNRESET|ETIMEDOUT|Connection|socket|server closed|after calling end|recovery mode|not yet accepting|cannot use a pool/i.test(msg)) {
        try { pool?.end().catch(() => {}); } catch {}
        pool = null;
        // Throttle the warning so a draining backlog doesn't flood the console.
        const now = Date.now();
        if (!_lastPoolWarn || now - _lastPoolWarn > 5000) {
          _lastPoolWarn = now;
          console.warn('[es-candle] DB unavailable, will reconnect:', msg.slice(0, 80));
        }
        // The pool is gone; the remaining chunks would all fail identically.
        break;
      } else {
        console.warn('[es-candle] write failed:', msg.slice(0, 120));
      }
    }
  }
}

const writeEsCandles = (rows) => writeCandles(rows, 'es_candles');
const writeNqCandles = (rows) => writeCandles(rows, 'nq_candles');

module.exports = { writeEsCandles, writeNqCandles, writeCandles, _coalesceCandles: coalesceCandles };
