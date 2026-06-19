'use strict';
/**
 * server-v2/state/es-candle-writer.js
 *
 * Postgres writer for 5-minute ES futures candles. Mirrors the lazy-pool +
 * no-op-without-DB pattern of gex-history-writer.js. Writes into the existing
 * `es_candles` table (created by lib/db.ts ensureAllTables), upserting on the
 * unique slotKey so a forming bar can be updated repeatedly within its slot.
 *
 * No-ops cleanly when DATABASE_URL is unset.
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
async function writeEsCandles(rows) {
  const p = getPool();
  if (!p) return;
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return;

  for (const r of list) {
    const ts = Number(r.timestamp);
    const slotKey = String(r.slotKey || '');
    if (!(ts > 0) || !slotKey) continue;
    try {
      await p.query(
        `INSERT INTO es_candles
           (timestamp,date,"slotKey",time,symbol,"intervalMinutes",source,open,high,low,close,volume,"avgVolume")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT("slotKey") DO UPDATE SET
           timestamp=EXCLUDED.timestamp,
           high=GREATEST(es_candles.high,EXCLUDED.high),
           low=LEAST(es_candles.low,EXCLUDED.low),
           close=EXCLUDED.close,
           volume=EXCLUDED.volume,
           "avgVolume"=EXCLUDED."avgVolume"`,
        [
          ts, String(r.date || slotKey.slice(0, 10)), slotKey, String(r.time ?? slotKey.slice(11)),
          String(r.symbol ?? '/ES'), Number(r.intervalMinutes ?? 5), String(r.source ?? 'dxlink'),
          Number(r.open), Number(r.high), Number(r.low), Number(r.close),
          Number(r.volume), Number(r.avgVolume ?? 0),
        ]
      );
    } catch (e) {
      console.warn('[es-candle] write failed:', e.message);
      const msg = String(e?.message || '');
      if (/terminat|ECONNRESET|ETIMEDOUT|Connection|socket|server closed/i.test(msg)) {
        try { pool?.end().catch(() => {}); } catch {}
        pool = null;
      }
    }
  }
}

module.exports = { writeEsCandles };
