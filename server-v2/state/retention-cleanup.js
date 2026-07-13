'use strict';
/**
 * server-v2/state/retention-cleanup.js
 *
 * Nightly retention prune for the high-volume tape/snapshot tables that were
 * eating the Render Postgres disk (see 2026-07 disk-exhaustion incident:
 * flow_prints 3.6GB, option_strike_gex_history 2.9GB, strike_growth 1.6GB —
 * none of it was ever being deleted, so it grew forever). Mirrors the same
 * per-table cutoffs from scripts/db-prune.sql, run automatically instead of
 * by hand.
 *
 * Cadence: fires once per ET calendar day, in a short post-midnight window
 * (00:05-00:40 ET) — checked every CHECK_INTERVAL_MS via setInterval, gated
 * so a restart mid-window doesn't re-run it twice. `force=true` (the manual
 * /proxy/retention-cleanup-run endpoint) bypasses the window for testing.
 *
 * IMPORTANT: this only runs DELETE + plain VACUUM (ANALYZE), never
 * VACUUM FULL. VACUUM FULL needs up to 2x the table's on-disk size in free
 * space to rewrite it, and running that unattended on a disk that's already
 * tight is exactly what took the DB down before (Render auto-suspends a
 * Postgres instance that exceeds its storage limit). Reclaiming the actual
 * file size back from Postgres after this prune keeps running is a manual,
 * monitored VACUUM FULL — see scripts/db-prune.sql's comments.
 *
 * Wiring: startRetentionCleanup() from server-with-proxy.js.
 * Manual:  POST /proxy/retention-cleanup-run  (force = run immediately)
 */

const CHECK_INTERVAL_MS = Number(process.env.RETENTION_CHECK_INTERVAL_MS || 10 * 60_000); // every 10 min
const WINDOW_START_MINS = Number(process.env.RETENTION_WINDOW_START_MINS || 5);   // 00:05 ET
const WINDOW_END_MINS   = Number(process.env.RETENTION_WINDOW_END_MINS || 40);    // 00:40 ET

// Per-table cutoffs (days). Env-overridable so any one can be loosened without
// a redeploy if a feature turns out to need more lookback than expected.
const RETENTION = {
  strike_growth:              Number(process.env.RETENTION_STRIKE_GROWTH_DAYS || 5),
  option_strike_gex_history:  Number(process.env.RETENTION_GEX_HISTORY_DAYS || 10),
  flow_prints:                Number(process.env.RETENTION_FLOW_PRINTS_DAYS || 5),    // ≥ big-premium prints kept this many session days (0–7DTE Combined lookback)
  flow_prints_big_premium:    Number(process.env.RETENTION_FLOW_BIG_PREMIUM || 500_000), // "big" = survives the full window regardless of expiry
  flow_prints_small_days:     Number(process.env.RETENTION_FLOW_SMALL_DAYS || 1),     // < big-premium prints: purged on expiry or after this many days (disk guard)
  greek_snapshots:            Number(process.env.RETENTION_GREEK_SNAPSHOTS_DAYS || 10),
  ticker_wall_snapshots:      Number(process.env.RETENTION_TICKER_WALL_DAYS || 10),
  scanner_snapshots:          Number(process.env.RETENTION_SCANNER_SNAPSHOTS_DAYS || 10),
  vol_pin_snapshots:          Number(process.env.RETENTION_VOL_PIN_DAYS || 14),
  vol_pin_events:             Number(process.env.RETENTION_VOL_PIN_EVENTS_DAYS || 14),
  watch_snapshots_days:       Number(process.env.RETENTION_WATCH_SNAPSHOTS_DAYS || 60),   // created_at-based
  preview_snapshots_days:     Number(process.env.RETENTION_PREVIEW_SNAPSHOTS_DAYS || 30),  // created_at-based
  home_static_snapshots_days: Number(process.env.RETENTION_HOME_STATIC_DAYS || 5),         // created_at-based
  mult_greek_static_days:     Number(process.env.RETENTION_MULT_GREEK_STATIC_DAYS || 5),   // created_at-based
  page_visits_days:           Number(process.env.RETENTION_PAGE_VISITS_DAYS || 14),        // created_at-based
  ticker_events_days:         Number(process.env.RETENTION_TICKER_EVENTS_DAYS || 14),       // created_at-based
};

let pool = null;
let pgUnavailable = false;
let lastRunYmd = null; // ET calendar date (YYYY-MM-DD) this prune last ran on

function getPool() {
  if (pgUnavailable) return null;
  if (pool) return pool;
  if (!process.env.DATABASE_URL) { pgUnavailable = true; return null; }
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
      console.warn('[retention-cleanup] pool error (will reconnect):', e.message);
      try { pool?.end().catch(() => {}); } catch {}
      pool = null;
    });
    return pool;
  } catch (e) {
    console.error('[retention-cleanup] pg unavailable:', e.message);
    pgUnavailable = true;
    return null;
  }
}

function nowEtParts() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  const ymd = `${get('year')}-${get('month')}-${get('day')}`;
  const minsSinceMidnight = Number(get('hour')) * 60 + Number(get('minute'));
  return { ymd, minsSinceMidnight };
}

/** Runs every DELETE, logging (and swallowing) per-table errors so one bad
 * table (e.g. doesn't exist yet, or a column name drifted) never blocks the
 * rest of the prune. Returns a { table: rowCount|'error' } summary. */
async function runDeletes(p) {
  const results = {};
  const run = async (table, sql, params = []) => {
    try {
      const r = await p.query(sql, params);
      results[table] = r.rowCount;
    } catch (e) {
      results[table] = `error: ${e.message}`;
      console.warn(`[retention-cleanup] delete failed for ${table}:`, e.message);
    }
  };

  await run('strike_growth',
    `DELETE FROM strike_growth WHERE date::date < CURRENT_DATE - INTERVAL '${RETENTION.strike_growth} days'`);

  await run('greek_snapshots',
    `DELETE FROM greek_snapshots WHERE date::date < CURRENT_DATE - INTERVAL '${RETENTION.greek_snapshots} days'`);

  // option_strike_gex_history: keep only the front/0DTE expiry (see
  // scripts/db-prune.sql for the reasoning).
  //
  // Time-of-day: this used to delete EVERYTHING outside 09:30–16:00 ET, which is
  // why the ES Candles heatmap went black from the 18:00 Globex open to midnight
  // — the columns were written, then purged overnight. The overnight tape is real
  // context for a futures chart, so non-RTH rows are now KEPT, thinned to the
  // 5-minute grid (SLOT_MS in app/es-candles/page.tsx) the heatmap buckets into
  // anyway. That's lossless for the chart at ~1/5th the overnight rows. RTH keeps
  // full 1-min resolution.
  await run('option_strike_gex_history', `
    DELETE FROM option_strike_gex_history t
    USING (
      SELECT date, MIN(expiry) AS front_expiry
      FROM option_strike_gex_history
      GROUP BY date
    ) f
    WHERE t.date = f.date
      AND (
        t.date::date < CURRENT_DATE - INTERVAL '${RETENTION.option_strike_gex_history} days'
        OR t.expiry <> f.front_expiry
        OR (
          to_char(to_timestamp(t.timestamp / 1000) AT TIME ZONE 'America/New_York', 'HH24:MI')
            NOT BETWEEN '09:30' AND '16:00'
          AND (EXTRACT(MINUTE FROM to_timestamp(t.timestamp / 1000) AT TIME ZONE 'America/New_York')::int % 5) <> 0
        )
      )
  `);

  // flow_prints: big prints (premium >= flow_prints_big_premium) are kept the
  // full flow_prints-day window by session date so the /flow Combined preset
  // (0–7DTE, ≥$500K, OTM) can replay the last several days — even for 0DTE
  // contracts that already expired. Small prints keep the old aggressive purge
  // (dead the moment the contract expires, else a short date cutoff) so the
  // table doesn't balloon back toward the 3.6GB disk-exhaustion incident.
  await run('flow_prints', `
    DELETE FROM flow_prints
    WHERE date::date < CURRENT_DATE - INTERVAL '${RETENTION.flow_prints} days'
       OR (
         COALESCE(premium, 0) < ${RETENTION.flow_prints_big_premium}
         AND (
           (expiration IS NOT NULL AND expiration::date < CURRENT_DATE)
           OR date::date < CURRENT_DATE - INTERVAL '${RETENTION.flow_prints_small_days} days'
         )
       )
  `);

  await run('ticker_wall_snapshots',
    `DELETE FROM ticker_wall_snapshots WHERE date::date < CURRENT_DATE - INTERVAL '${RETENTION.ticker_wall_snapshots} days'`);

  await run('scanner_snapshots',
    `DELETE FROM scanner_snapshots WHERE date::date < CURRENT_DATE - INTERVAL '${RETENTION.scanner_snapshots} days'`);

  await run('vol_pin_snapshots',
    `DELETE FROM vol_pin_snapshots WHERE date::date < CURRENT_DATE - INTERVAL '${RETENTION.vol_pin_snapshots} days'`);

  await run('vol_pin_events',
    `DELETE FROM vol_pin_events WHERE date::date < CURRENT_DATE - INTERVAL '${RETENTION.vol_pin_events} days'`);

  await run('watch_snapshots',
    `DELETE FROM watch_snapshots WHERE created_at < NOW() - INTERVAL '${RETENTION.watch_snapshots_days} days'`);

  await run('preview_snapshots',
    `DELETE FROM preview_snapshots WHERE created_at < NOW() - INTERVAL '${RETENTION.preview_snapshots_days} days'`);

  await run('home_static_snapshots',
    `DELETE FROM home_static_snapshots WHERE created_at < NOW() - INTERVAL '${RETENTION.home_static_snapshots_days} days'`);

  await run('mult_greek_static_snapshots',
    `DELETE FROM mult_greek_static_snapshots WHERE created_at < NOW() - INTERVAL '${RETENTION.mult_greek_static_days} days'`);

  await run('page_visits',
    `DELETE FROM page_visits WHERE created_at < NOW() - INTERVAL '${RETENTION.page_visits_days} days'`);

  await run('ticker_events',
    `DELETE FROM ticker_events WHERE created_at < NOW() - INTERVAL '${RETENTION.ticker_events_days} days'`);

  return results;
}

const VACUUM_TABLES = [
  'strike_growth', 'option_strike_gex_history', 'flow_prints',
  'greek_snapshots', 'ticker_wall_snapshots', 'scanner_snapshots', 'vol_pin_snapshots',
  'watch_snapshots', 'preview_snapshots', 'home_static_snapshots',
  'mult_greek_static_snapshots', 'page_visits', 'ticker_events',
];

/** Plain VACUUM (ANALYZE) only — NOT FULL. Safe under any disk condition;
 * marks freed space reusable in-place instead of shrinking the file, which is
 * the whole point: no unattended job should risk needing 2x-table free disk. */
async function runVacuum(p) {
  for (const table of VACUUM_TABLES) {
    try {
      // VACUUM can't run inside a transaction block / multi-statement string,
      // so each table gets its own query call (same reason `-c "A; B"` fails
      // in psql for VACUUM).
      await p.query(`VACUUM (ANALYZE) ${table}`);
    } catch (e) {
      console.warn(`[retention-cleanup] vacuum failed for ${table}:`, e.message);
    }
  }
}

async function runCleanup({ force = false } = {}) {
  const p = getPool();
  if (!p) return { ok: false, reason: 'no DB pool' };
  const { ymd } = nowEtParts();
  if (!force && lastRunYmd === ymd) return { ok: false, reason: 'already ran today' };

  console.log(`[retention-cleanup] starting prune for ${ymd}...`);
  const deleted = await runDeletes(p);
  await runVacuum(p);
  lastRunYmd = ymd;
  console.log('[retention-cleanup] done:', deleted);
  return { ok: true, ymd, deleted };
}

function startRetentionCleanup() {
  if (!process.env.DATABASE_URL) return; // no-op without a DB, matches other recorders
  const tick = async () => {
    const { ymd, minsSinceMidnight } = nowEtParts();
    if (lastRunYmd === ymd) return; // already ran today
    if (minsSinceMidnight < WINDOW_START_MINS || minsSinceMidnight > WINDOW_END_MINS) return;
    try {
      await runCleanup({ force: false });
    } catch (e) {
      console.warn('[retention-cleanup] tick error:', e.message);
    }
  };
  setInterval(tick, CHECK_INTERVAL_MS);
  // Also check shortly after boot, in case the process restarts inside the
  // window and would otherwise wait a full day for the next one.
  setTimeout(tick, 30_000);
}

module.exports = { startRetentionCleanup, runCleanup };
