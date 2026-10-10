'use strict';
/**
 * server-v2/backfill-tpo-profiles.js  — one-shot.
 *
 * Writes a tpo_profiles row for EVERY date already in es_candles, so the
 * forecaster has an IB-only history to work with immediately instead of waiting
 * months for the nightly recorder to accumulate. GEX is null for dates before
 * option_strike_gex_history exists (~July 2026); every day still gets its
 * realized TPO profile + IB state, which is what the IB-only k-NN needs.
 *
 * Idempotent (upsert). Safe to re-run. On the VPS:
 *   cd /opt/dashboard && node server-v2/backfill-tpo-profiles.js
 */
const { recordDate } = require('./tpo-profiles-recorder');

(async () => {
  if (!process.env.DATABASE_URL) { console.error('no DATABASE_URL'); process.exit(1); }
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
      ? undefined : { rejectUnauthorized: false },
    max: 2,
  });
  const { rows } = await pool.query(
    `SELECT DISTINCT date FROM es_candles WHERE "intervalMinutes" = 5 ORDER BY date ASC`
  );
  console.log(`backfilling ${rows.length} dates…`);
  let ok = 0, skip = 0;
  for (const r of rows) {
    try { if (await recordDate(r.date)) ok++; else skip++; }
    catch (e) { console.warn(r.date, e.message); skip++; }
    if ((ok + skip) % 50 === 0) console.log(`… ${ok + skip}/${rows.length}  (${ok} written)`);
  }
  console.log(`done: ${ok} written, ${skip} skipped, of ${rows.length} dates`);
  await pool.end();
  process.exit(0);
})();
