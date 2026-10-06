'use strict';
/**
 * server-v2/state/perf-indexes.js — indexes the chart reads need, built once in
 * the background (2026-10-06, after the outage: the database sat waiting on disk
 * and every chart request queued behind it).
 *
 * WHY CONCURRENTLY, AND WHY HERE. A plain CREATE INDEX on a big table blocks
 * writes for as long as it builds, and the recorders write every few seconds.
 * CONCURRENTLY builds without that lock, but it cannot run inside a transaction
 * or a multi-statement query, so it does not belong in the boot-time schema
 * ensures. This module runs each statement on its own connection, one at a
 * time, two minutes after boot (out of the way of the boot rush), with no
 * statement timeout (a build can take minutes) and a short lock timeout (it
 * never waits in front of other queries for a lock).
 *
 * A CONCURRENTLY build that fails part-way leaves an INVALID index behind,
 * which Postgres keeps maintaining on every write but never reads. Each index
 * is checked for that first and dropped before it is built again.
 *
 * Also creates the pg_stat_statements extension (Render's Postgres preloads it)
 * so the top queries by total time can be read. If it is not available this is
 * a no-op with one log line.
 */

const START_DELAY_MS = 120_000;

/** [index name, table, CREATE statement] — each must say CONCURRENTLY IF NOT EXISTS. */
const INDEXES = [
  [
    // Vela Whale Prints and the Whales page with a ticker: one underlying over a
    // date range, newest first. The (session_date, underlying, ts) index has the
    // range on its first column, so it read every ticker's whales for the range.
    'lse_top_flow_prints_und_session_ts_idx',
    'lse_top_flow_prints',
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS lse_top_flow_prints_und_session_ts_idx
       ON lse_top_flow_prints ((payload->>'underlying'), session_date, ts DESC)`,
  ],
];

let started = false;

async function run() {
  if (!process.env.DATABASE_URL) return;
  const { Client } = require('pg');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    await client.query(`SET statement_timeout = 0`);
    await client.query(`SET lock_timeout = '10s'`);

    // The database is Render's managed Postgres: the app role may not read
    // shared_preload_libraries, so whether the view works is the test.
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`);
      await client.query(`SELECT 1 FROM pg_stat_statements LIMIT 1`);
      console.log('[perf-indexes] pg_stat_statements on');
    } catch (e) {
      console.warn('[perf-indexes] pg_stat_statements unavailable:', e.message);
    }

    for (const [name, table, sql] of INDEXES) {
      try {
        const { rows: t } = await client.query(`SELECT to_regclass($1) AS t`, [`public.${table}`]);
        if (!t[0]?.t) continue; // table not created yet; next boot
        const { rows } = await client.query(
          `SELECT i.indisvalid AS valid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = $1`,
          [name],
        );
        if (rows.length && rows[0].valid) continue;
        if (rows.length) {
          console.warn(`[perf-indexes] ${name} is INVALID (an earlier build failed); dropping and rebuilding`);
          await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`);
        }
        const t0 = Date.now();
        console.log(`[perf-indexes] building ${name}…`);
        await client.query(sql);
        console.log(`[perf-indexes] ${name} built in ${Math.round((Date.now() - t0) / 1000)}s`);
      } catch (e) {
        console.warn(`[perf-indexes] ${name} failed (retried next boot):`, e.message);
      }
    }
  } catch (e) {
    console.warn('[perf-indexes] skipped:', e.message);
  } finally {
    try { await client.end(); } catch { /* closing */ }
  }
}

/** Once per process, START_DELAY_MS after boot. */
function startPerfIndexes() {
  if (started) return;
  started = true;
  setTimeout(() => { void run(); }, START_DELAY_MS).unref?.();
}

module.exports = { startPerfIndexes };
