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

  for (const r of list) {
    const ts = Number(r.timestamp);
    const slotKey = String(r.slotKey || '');
    if (!(ts > 0) || !slotKey) continue;
    try {
      await p.query(
        `INSERT INTO ${tbl}
           (timestamp,date,"slotKey",time,symbol,"intervalMinutes",source,open,high,low,close,volume,"avgVolume")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT(${conflictTarget}) DO UPDATE SET
           timestamp=EXCLUDED.timestamp,
           high=GREATEST(${tbl}.high,EXCLUDED.high),
           low=LEAST(${tbl}.low,EXCLUDED.low),
           close=EXCLUDED.close,
           volume=EXCLUDED.volume,
           "avgVolume"=EXCLUDED."avgVolume"`,
        [
          ts, String(r.date || slotKey.slice(0, 10)), slotKey, String(r.time ?? slotKey.slice(11)),
          String(r.symbol ?? defSymbol), Number(r.intervalMinutes ?? 5), String(r.source ?? 'dxlink'),
          Number(r.open), Number(r.high), Number(r.low), Number(r.close),
          Number(r.volume), Number(r.avgVolume ?? 0),
        ]
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
      } else {
        console.warn('[es-candle] write failed:', msg.slice(0, 120));
      }
    }
  }
}

const writeEsCandles = (rows) => writeCandles(rows, 'es_candles');
const writeNqCandles = (rows) => writeCandles(rows, 'nq_candles');

module.exports = { writeEsCandles, writeNqCandles, writeCandles };
