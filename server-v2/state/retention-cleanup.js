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

// Per-statement ceiling for THIS pool only (see the SET in getPool). Generous
// on purpose: a per-date DELETE here takes seconds, so anything approaching
// this is a bug worth surfacing rather than a budget to spend.
const STATEMENT_TIMEOUT_MS = Number(process.env.RETENTION_STATEMENT_TIMEOUT_MS || 600_000);

// Safety stop for the per-date loops, so a bad cutoff can never spin forever.
const MAX_DATES_PER_RUN = Number(process.env.RETENTION_MAX_DATES_PER_RUN || 400);

const CHECK_INTERVAL_MS = Number(process.env.RETENTION_CHECK_INTERVAL_MS || 10 * 60_000); // every 10 min
const WINDOW_START_MINS = Number(process.env.RETENTION_WINDOW_START_MINS || 5);   // 00:05 ET
const WINDOW_END_MINS   = Number(process.env.RETENTION_WINDOW_END_MINS || 40);    // 00:40 ET

// Per-table cutoffs (days). Env-overridable so any one can be loosened without
// a redeploy if a feature turns out to need more lookback than expected.
const RETENTION = {
  // 5 days is a LIVE-PANEL window, not a research window. The intraday
  // strike-GEX→move backtest (/api/backtests?test=strike-gex-move-intraday)
  // reads this table and can only ever see what survives here, so at the
  // default it returns a wiring check, not a study.
  //
  // This is deliberately left at 5 rather than raised for the backtest: the
  // table writes ~320MB/session, so every extra day is ~0.3GB resident and the
  // decision belongs to whoever is watching the VPS disk. Raise
  // RETENTION_STRIKE_GROWTH_DAYS (no redeploy needed) and the sample grows
  // FORWARD from that day — it cannot be backfilled, because this table is the
  // only record of those minutes. ~30 days ≈ 10GB and ≈ six weeks of waiting
  // before the intraday panel has a real n.
  //
  // The daily engine (test=strike-gex-move) has no such problem: it reads
  // eod_strike_gex, which keeps 400 sessions and is pruned by its own recorder.
  strike_growth:              Number(process.env.RETENTION_STRIKE_GROWTH_DAYS || 5),
  option_strike_gex_history:  Number(process.env.RETENTION_GEX_HISTORY_DAYS || 10),
  // Sessions of option_strike_gex_history kept at FULL 1-minute resolution.
  // Older days survive, thinned to the 5-minute grid. See the thinning note on
  // the DELETE below — this is the number that pays for the multi-ticker roster.
  gex_history_fullres_days:   Number(process.env.RETENTION_GEX_FULLRES_DAYS || 2),
  // etf_candles — 1-minute OHLC for the ES-Candles picker's roster.
  //
  // It had NO prune at all until 2026-08-27, which was survivable while the
  // recorder wrote fourteen names: ~13k rows a session, growing forever but
  // slowly enough that nobody noticed. The roster is now ~106 (the far-CB core,
  // see etf-candle-recorder.js) at ~960 extended-session bars each — ~100k rows
  // a session, ~25M a year — so "forever" became a real number and this table
  // needed a cutoff like every other high-volume one here.
  //
  // 30 days is generous on purpose. useEtfCandles asks for 9 calendar days and
  // /es-candles plots 5 sessions of it, so this is three weeks of headroom over
  // anything that reads it; it exists to bound the table, not to ration the
  // chart. Unlike option_strike_gex_history there is no thinning tier — 1m bars
  // ARE the resolution the page asks for, and the row is small.
  etf_candles_days:           Number(process.env.RETENTION_ETF_CANDLES_DAYS || 30),
  flow_prints:                Number(process.env.RETENTION_FLOW_PRINTS_DAYS || 5),    // ≥ big-premium prints kept this many session days (0–7DTE Combined lookback)
  flow_prints_big_premium:    Number(process.env.RETENTION_FLOW_BIG_PREMIUM || 500_000), // "big" = survives the full window regardless of expiry
  flow_prints_small_days:     Number(process.env.RETENTION_FLOW_SMALL_DAYS || 1),     // < big-premium prints: purged on expiry or after this many days (disk guard)
  greek_snapshots:            Number(process.env.RETENTION_GREEK_SNAPSHOTS_DAYS || 10),
  ticker_wall_snapshots:      Number(process.env.RETENTION_TICKER_WALL_DAYS || 10),
  scanner_snapshots:          Number(process.env.RETENTION_SCANNER_SNAPSHOTS_DAYS || 10),
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
    // STATEMENT TIMEOUT — set per session, deliberately.
    //
    // The DB role carries `statement_timeout=120s` (ALTER ROLE; see
    // pg_db_role_setting). That is the right default for the app's web pool —
    // it is what stops one slow query from pinning a slot in the max:5 pool —
    // but role settings are applied at LOGIN, so they override anything passed
    // in the startup packet (PGOPTIONS / the `options` connection field). The
    // only thing that beats them is a session-level SET, which is this.
    //
    // Why it matters: every statement here is a bulk DELETE over a tape table,
    // which legitimately runs longer than any web request. Inheriting 120s is
    // how the option_strike_gex_history prune silently failed every night from
    // 2026-07-24 to 2026-09-09 — the table reached 37.6M rows / 17.6GB while
    // this module reported success on everything else. The per-date loop below
    // keeps individual statements to seconds, so this ceiling is a backstop
    // against a pathological statement, not a working budget.
    pool.on('connect', (client) => {
      client.query(`SET statement_timeout = '${STATEMENT_TIMEOUT_MS}'`)
        .catch((e) => console.warn('[retention-cleanup] could not set statement_timeout:', e.message));
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
  // ISO day-of-week from the ET calendar date, 1 = Mon … 7 = Sun. Derived from
  // the formatted Y-M-D rather than from `new Date().getDay()`, which is the
  // SERVER's weekday and is a day off for anything ET-evening on a UTC box.
  const [y, m, d] = ymd.split('-').map(Number);
  const jsDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  const isoDow = jsDow === 0 ? 7 : jsDow;
  return { ymd, minsSinceMidnight, isoDow, isWeekend: isoDow >= 6 };
}

// ET-local expressions on the bigint epoch-ms `timestamp` column. Kept as
// constants so the date-cutoff pass and the thinning pass cannot drift apart.
const ET = 'America/New_York';
const ET_TS = `to_timestamp(t.timestamp / 1000) AT TIME ZONE '${ET}'`;
const OFF_RTH = `to_char(${ET_TS}, 'HH24:MI') NOT BETWEEN '09:30' AND '16:00'`;
const NOT_ON_5MIN = `(EXTRACT(MINUTE FROM ${ET_TS})::int % 5) <> 0`;

/**
 * option_strike_gex_history retention, one session date per statement.
 *
 * Two passes, both driven off `SELECT DISTINCT date` (43 rows, not 37.6M):
 *
 *   1. Whole dates past RETENTION.option_strike_gex_history — a plain
 *      `DELETE ... WHERE date = $1`, which uses idx_osgh_date.
 *   2. Surviving dates get the front-expiry and 5-minute-grid rules. Rows
 *      whose expiry is not that (date, symbol)'s front expiry go; off-RTH rows
 *      not on the 5-minute grid go; and once a date is older than
 *      RETENTION.gex_history_fullres_days, every row off the grid goes.
 *
 * Identical semantics to the single monster statement this replaced, with the
 * per-date scoping that makes each one finish. Errors are recorded per date
 * and do not stop the loop.
 *
 * Returns a summary object rather than a bare count so a partial failure is
 * visible in the run log instead of looking like a clean 0.
 */
async function pruneGexHistoryByDate(p) {
  const keepDays = RETENTION.option_strike_gex_history;
  const fullresDays = RETENTION.gex_history_fullres_days;
  const out = { aged_out_dates: 0, aged_out_rows: 0, thinned_dates: 0, thinned_rows: 0, errors: [] };

  // Pass 1 — drop whole dates past the window, oldest first.
  for (let i = 0; i < MAX_DATES_PER_RUN; i++) {
    let d;
    try {
      const r = await p.query(
        `SELECT MIN(date) AS d FROM option_strike_gex_history
          WHERE date::date < CURRENT_DATE - ($1::int)`, [keepDays]);
      d = r.rows[0] && r.rows[0].d;
    } catch (e) {
      out.errors.push(`cutoff lookup: ${e.message}`);
      console.warn('[retention-cleanup] gex cutoff lookup failed:', e.message);
      break;
    }
    if (!d) break;
    try {
      const x = await p.query(`DELETE FROM option_strike_gex_history WHERE date = $1`, [d]);
      out.aged_out_dates += 1;
      out.aged_out_rows += x.rowCount;
    } catch (e) {
      // Record and STOP pass 1: the loop re-selects MIN(date) each iteration,
      // so a date that cannot be deleted would otherwise be retried forever.
      out.errors.push(`${d}: ${e.message}`);
      console.warn(`[retention-cleanup] gex date delete failed for ${d}:`, e.message);
      break;
    }
  }

  // Pass 2 — thin what remains.
  let dates = [];
  try {
    dates = (await p.query(`SELECT DISTINCT date AS d FROM option_strike_gex_history ORDER BY 1`))
      .rows.map((r) => r.d);
  } catch (e) {
    out.errors.push(`date list: ${e.message}`);
    console.warn('[retention-cleanup] gex date list failed:', e.message);
    return out;
  }

  for (const d of dates) {
    // Newest `fullresDays` sessions keep full 1-minute resolution — that is
    // every window the ES-Candles page can actually request (1D/2D heatmap,
    // single-session bubbles, the replay day picker).
    const gridClause = `($2::date < CURRENT_DATE - (${Number(fullresDays)}::int) AND ${NOT_ON_5MIN})`;
    const sql = `
      DELETE FROM option_strike_gex_history t
      USING (
        SELECT symbol, MIN(expiry) AS front_expiry
          FROM option_strike_gex_history
         WHERE date = $1
         GROUP BY symbol
      ) f
      WHERE t.date = $1
        AND t.symbol IS NOT DISTINCT FROM f.symbol
        AND (
          t.expiry <> f.front_expiry
          OR (${OFF_RTH} AND ${NOT_ON_5MIN})
          OR ${gridClause}
        )`;
    try {
      const x = await p.query(sql, [d, d]);
      if (x.rowCount > 0) { out.thinned_dates += 1; out.thinned_rows += x.rowCount; }
    } catch (e) {
      out.errors.push(`thin ${d}: ${e.message}`);
      console.warn(`[retention-cleanup] gex thin failed for ${d}:`, e.message);
    }
  }

  return out;
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
  // GROUPED BY (date, symbol), not by date alone. `MIN(expiry) GROUP BY date`
  // was symbol-blind: SPX, SPY and QQQ rows for the same date all measured
  // themselves against ONE global minimum expiry, so any symbol whose front
  // expiry was not the smallest string on the board had its entire day deleted
  // every night. On a Friday, with SPX 0DTE at the same date and the ETFs
  // carrying a different front, that is the whole session gone.
  //
  // Time-of-day: this used to delete EVERYTHING outside 09:30–16:00 ET, which is
  // why the ES Candles heatmap went black from the 18:00 Globex open to midnight
  // — the columns were written, then purged overnight. The overnight tape is real
  // context for a futures chart, so non-RTH rows are now KEPT, thinned to the
  // 5-minute grid (SLOT_MS in app/es-candles/page.tsx) the heatmap buckets into
  // anyway. That's lossless for the chart at ~1/5th the overnight rows.
  //
  // ── AGE-BASED THINNING (2026-08-16) ────────────────────────────────────────
  // RTH used to keep full 1-minute resolution for the entire 10-day window. That
  // was affordable at three symbols. The recorder roster is now the scanner MAIN
  // lane (~13 names, see etf-gex-recorder.js), and RTH-only recorders keep every
  // row they write — 390 writes x 81 strikes x 13 symbols x 10 days is the shape
  // that produced the 2.9GB table in the first place.
  //
  // So full 1-minute resolution is kept for the newest `gex_history_fullres_days`
  // sessions — which is every window the ES-Candles page can actually request
  // (1D/2D heatmap, single-session bubbles, and the replay day picker) — and
  // everything older is thinned to the same 5-minute grid the heatmap buckets
  // into anyway. Roughly a 3.6x cut on the 10-day footprint, invisible to every
  // current reader.
  //
  // Raise RETENTION_GEX_FULLRES_DAYS if a reader ever wants minute resolution
  // further back; it is the only number that has to move.
  // ── ONE STATEMENT PER SESSION DATE, not one for the whole table ──────────
  //
  // The version this replaced was a single DELETE whose USING clause did
  // `SELECT date, symbol, MIN(expiry) GROUP BY date, symbol` over the ENTIRE
  // table and joined it back against every row, then evaluated two
  // `to_timestamp(...) AT TIME ZONE` conversions per row. Non-sargable, so
  // none of the table's indexes helped: a full scan plus per-row timezone
  // math plus a hash aggregate that spilled to temp, every night.
  //
  // Measured 2026-09-09 at 37.6M rows: the aggregate SUBQUERY ALONE took
  // 101 seconds. The full statement could not possibly finish inside the
  // role's 120s statement_timeout, so it was cancelled on every run and
  // caught by run()'s try/catch, which logged a warning and moved on. Six
  // weeks of that took the table to 17.6GB — 67% of the whole database — on
  // a 30GB disk, while every other table in this module pruned correctly.
  //
  // Scoped to one date the same work is trivial: the MIN(expiry) group is
  // ~44 rows instead of 1,893 over 37.6M, the date predicate uses
  // idx_osgh_date, and each statement finishes in seconds. 43 small
  // statements instead of one impossible one — and because each is its own
  // transaction, a single bad date can no longer block the other 42, and a
  // tight disk sees WAL recycled between them instead of one enormous
  // transaction's worth accumulating.
  results.option_strike_gex_history = await pruneGexHistoryByDate(p);

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

  // watch_snapshots has NO created_at column — it stamps `ts` as epoch
  // MILLISECONDS (verified 2026-09-09: min 1787668205044, max 1788974038960).
  // This statement read `created_at` from the day it was written, so it threw
  // `column "created_at" does not exist` on every single run and the table has
  // never once been pruned. It only escaped notice because run() swallows
  // per-table errors and the table is young enough that a 60-day cutoff would
  // not have removed anything yet.
  await run('watch_snapshots',
    `DELETE FROM watch_snapshots
      WHERE ts < (EXTRACT(EPOCH FROM NOW() - INTERVAL '${RETENTION.watch_snapshots_days} days') * 1000)::bigint`);

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

  // etf_candles — by the bar's own ET session date, NOT by a created_at.
  // `date` is stamped per bar (ymdEtOf) precisely so a backfill's five sessions
  // land under their own days rather than under the day they were written; a
  // created_at cut would spare a week-old bar imported this morning and delete
  // nothing that actually needs deleting.
  await run('etf_candles',
    `DELETE FROM etf_candles WHERE date::date < CURRENT_DATE - INTERVAL '${RETENTION.etf_candles_days} days'`);

  return results;
}

const VACUUM_TABLES = [
  'strike_growth', 'option_strike_gex_history', 'flow_prints',
  'greek_snapshots', 'ticker_wall_snapshots', 'scanner_snapshots',
  'watch_snapshots', 'preview_snapshots', 'home_static_snapshots',
  'mult_greek_static_snapshots', 'page_visits', 'ticker_events',
  'etf_candles',
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

// ─── db_map_snapshot ────────────────────────────────────────────────────────
//
// Feeds /api/owner/db-map (the Postgres page under /owner/db-map). Sizes and
// row estimates are catalog reads and cheap enough to serve live; HOW FAR BACK
// a table actually reaches is not — `min(date)` on a text date column is a
// sequential scan, measured at 43s on option_strike_gex_history alone. So it
// is computed here, once a night, right after the prune that determines it.
//
// The point of storing it rather than just displaying it: a table whose held
// days climb past its own cutoff is a retention policy that has stopped
// working. That is exactly what went unnoticed from 2026-07-24 to 2026-09-09,
// and with a row per night it is visible the day it starts.
const DB_MAP_SNAPSHOT_TABLES = Number(process.env.DB_MAP_SNAPSHOT_TABLES || 40);
const DB_MAP_PROBE_TIMEOUT_MS = Number(process.env.DB_MAP_PROBE_TIMEOUT_MS || 30_000);

// Preference order for "which column dates this row". First exact match wins,
// then first substring match, so `snap_ts` beats `updated_at` on a table with
// both.
const DATE_COL_PREF = [
  'date', 'session_date', 'trade_date', 'ts', 'snap_ts', 'snapshot_at', 'as_of', 'asof',
  'recorded_at', 'captured_at', 'created_at', 'inserted_at', 'event_time', 'timestamp', 'day',
];

async function writeDbMapSnapshot(p) {
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS db_map_snapshot (
        captured_at  timestamptz NOT NULL DEFAULT now(),
        table_name   text        NOT NULL,
        date_column  text,
        oldest       text,
        newest       text,
        span_days    int,
        PRIMARY KEY (captured_at, table_name)
      )`);
  } catch (e) {
    console.warn('[retention-cleanup] db_map_snapshot ensure failed:', e.message);
    return { error: e.message };
  }

  let targets = [];
  try {
    targets = (await p.query(`
      SELECT c.relname AS t
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r' AND n.nspname = 'public'
       ORDER BY pg_total_relation_size(c.oid) DESC
       LIMIT $1`, [DB_MAP_SNAPSHOT_TABLES])).rows.map((r) => r.t);
  } catch (e) {
    console.warn('[retention-cleanup] db_map target list failed:', e.message);
    return { error: e.message };
  }

  // Column types up front, one catalog read for all of them.
  const cols = new Map();
  try {
    for (const r of (await p.query(`
      SELECT table_name AS t, column_name AS c, data_type AS d
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1)`, [targets])).rows) {
      if (!cols.has(r.t)) cols.set(r.t, []);
      cols.get(r.t).push({ c: r.c, d: r.d });
    }
  } catch (e) {
    console.warn('[retention-cleanup] db_map column read failed:', e.message);
    return { error: e.message };
  }

  const pick = (t) => {
    const list = cols.get(t) || [];
    for (const want of DATE_COL_PREF) {
      const hit = list.find((x) => x.c.toLowerCase() === want);
      if (hit) return hit;
    }
    for (const want of DATE_COL_PREF) {
      const hit = list.find((x) => x.c.toLowerCase().includes(want));
      if (hit) return hit;
    }
    return null;
  };

  const stamped = new Date().toISOString();
  let written = 0, skipped = 0, failed = 0;

  for (const t of targets) {
    const col = pick(t);
    if (!col) { skipped += 1; continue; }

    // Epoch-ms bigints, epoch-second bigints, text dates and real date/timestamp
    // columns all have to come back as a comparable ISO day.
    const isNum = /int|numeric|double|real/.test(col.d);
    const isTxt = /char|text/.test(col.d);
    const q = isNum
      ? `SELECT to_char(to_timestamp(MIN("${col.c}")::double precision / (CASE WHEN MAX("${col.c}") > 1e12 THEN 1000 ELSE 1 END)), 'YYYY-MM-DD') lo,
                to_char(to_timestamp(MAX("${col.c}")::double precision / (CASE WHEN MAX("${col.c}") > 1e12 THEN 1000 ELSE 1 END)), 'YYYY-MM-DD') hi
           FROM "${t}"`
      : isTxt
        ? `SELECT substr(MIN("${col.c}")::text,1,10) lo, substr(MAX("${col.c}")::text,1,10) hi FROM "${t}"`
        : `SELECT to_char(MIN("${col.c}"),'YYYY-MM-DD') lo, to_char(MAX("${col.c}"),'YYYY-MM-DD') hi FROM "${t}"`;

    try {
      // Own timeout: an unindexed min() on a huge table is a scan, and a slow
      // probe must not eat the whole window.
      await p.query(`SET statement_timeout = ${DB_MAP_PROBE_TIMEOUT_MS}`);
      const r = (await p.query(q)).rows[0] || {};
      const span = (r.lo && r.hi)
        ? Math.max(0, Math.round((Date.parse(r.hi) - Date.parse(r.lo)) / 86_400_000))
        : null;
      await p.query(
        `INSERT INTO db_map_snapshot (captured_at, table_name, date_column, oldest, newest, span_days)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (captured_at, table_name) DO NOTHING`,
        [stamped, t, col.c, r.lo || null, r.hi || null, span]);
      written += 1;
    } catch (e) {
      failed += 1;
      console.warn(`[retention-cleanup] db_map probe failed for ${t}:`, e.message);
    } finally {
      try { await p.query(`SET statement_timeout = '${STATEMENT_TIMEOUT_MS}'`); } catch {}
    }
  }

  // Keep a rolling window — one row per table per night is small, but not
  // forever. This table must never become the next thing on this list.
  try {
    await p.query(`DELETE FROM db_map_snapshot WHERE captured_at < NOW() - INTERVAL '180 days'`);
  } catch (e) {
    console.warn('[retention-cleanup] db_map_snapshot prune failed:', e.message);
  }

  return { written, skipped, failed };
}

async function runCleanup({ force = false } = {}) {
  const p = getPool();
  if (!p) return { ok: false, reason: 'no DB pool' };
  const { ymd } = nowEtParts();
  if (!force && lastRunYmd === ymd) return { ok: false, reason: 'already ran today' };

  console.log(`[retention-cleanup] starting prune for ${ymd}...`);
  const deleted = await runDeletes(p);
  await runVacuum(p);
  // AFTER the vacuum, so the row-age figures the owner page shows describe the
  // table as the prune left it, not as it was before.
  deleted._db_map_snapshot = await writeDbMapSnapshot(p);
  lastRunYmd = ymd;
  console.log('[retention-cleanup] done:', deleted);

  // MAKE FAILURES LOUD.
  //
  // runDeletes() records `error: <msg>` per table and carries on, which is the
  // right resilience — one bad table must not block twelve good ones. But the
  // only trace was a console.warn buried in a log nobody greps, so
  // option_strike_gex_history failed nightly for six weeks and
  // watch_snapshots since inception, entirely unnoticed, while the summary
  // line above looked healthy. This restates the failures at the end, as an
  // error, naming every table that did not prune.
  const failed = Object.entries(deleted)
    .filter(([, v]) => (typeof v === 'string' && v.startsWith('error'))
                    || (v && Array.isArray(v.errors) && v.errors.length))
    .map(([t, v]) => `${t} (${typeof v === 'string' ? v : v.errors.join('; ')})`);
  if (failed.length) {
    console.error(`[retention-cleanup] ${failed.length} TABLE(S) DID NOT PRUNE: ${failed.join(', ')}`);
  }
  return { ok: true, ymd, deleted, failed };
}

function startRetentionCleanup() {
  if (!process.env.DATABASE_URL) return; // no-op without a DB, matches other recorders
  const tick = async () => {
    const { ymd, minsSinceMidnight, isWeekend } = nowEtParts();
    if (lastRunYmd === ymd) return; // already ran today
    // SKIP SATURDAY AND SUNDAY.
    //
    // Nothing is written between Friday 17:00 and Sunday 20:00 ET (see
    // isRecordingWindow in gex-history-writer.js), so a weekend run has no new
    // rows to reclaim — it can only re-apply the deletes to FRIDAY's data, twice,
    // before anyone has looked at it on Monday. Every cutoff here is 5 days or
    // more, so missing two nights costs nothing on disk; the Monday run catches
    // up on all three days at once.
    //
    // `force` (POST /proxy/retention-cleanup-run) still runs any day — this gate
    // is on the automatic tick only, so a manual disk emergency is unaffected.
    if (isWeekend) return;
    if (minsSinceMidnight < WINDOW_START_MINS || minsSinceMidnight > WINDOW_END_MINS) return;
    try {
      await runCleanup({ force: false });
    } catch (e) {
      console.warn('[retention-cleanup] tick error:', e.message);
    }
  };
  // Startup line, matching every other recorder ([oi-daily], [eod-strike-gex],
  // [atm-prem-intraday] all announce themselves). This module was silent until
  // it actually fired, so an empty `docker compose logs | grep retention` was
  // indistinguishable between "wired and waiting for the window" and "never
  // started" — which cost real time diagnosing the 2026-09 disk incident.
  console.log('[retention-cleanup] started — weekdays '
    + `${String(Math.floor(WINDOW_START_MINS / 60)).padStart(2, '0')}:${String(WINDOW_START_MINS % 60).padStart(2, '0')}`
    + `-${String(Math.floor(WINDOW_END_MINS / 60)).padStart(2, '0')}:${String(WINDOW_END_MINS % 60).padStart(2, '0')} ET, `
    + `checked every ${CHECK_INTERVAL_MS / 60_000}min; gex ${RETENTION.option_strike_gex_history}d `
    + `(${RETENTION.gex_history_fullres_days}d full-res), strike_growth ${RETENTION.strike_growth}d, `
    + `flow_prints ${RETENTION.flow_prints}d, etf_candles ${RETENTION.etf_candles_days}d; `
    + `statement_timeout ${STATEMENT_TIMEOUT_MS / 1000}s`);

  setInterval(tick, CHECK_INTERVAL_MS);
  // Also check shortly after boot, in case the process restarts inside the
  // window and would otherwise wait a full day for the next one.
  setTimeout(tick, 30_000);
}

// RETENTION is exported so /api/owner/db-map reports the cutoffs this module
// actually applies. The owner page must never carry its own copy of these
// numbers — a page that says "10 d" while the code says 5 is worse than no page.
module.exports = { startRetentionCleanup, runCleanup, RETENTION, writeDbMapSnapshot };
