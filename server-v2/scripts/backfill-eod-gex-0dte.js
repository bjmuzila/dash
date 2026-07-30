'use strict';
/**
 * server-v2/scripts/backfill-eod-gex-0dte.js
 *
 * Backfills eod_gex.total_gex_0dte — 0DTE-only net GEX on the OI+Vol basis —
 * for sessions recorded before that column existed.
 *
 * WHY A BACKFILL AT ALL. total_gex is historically mixed: source='ladder' rows
 * are 0DTE OI-only, source='theta' rows are all-expiration OI+Vol, and the AM
 * settled pass overwrites the PM row, so a total_gex series silently changes
 * definition partway along. total_gex_0dte has ONE definition, which means the
 * old sessions have to be recomputed rather than copied.
 *
 * SOURCE. The persisted per-strike ladder in option_strike_gex_history, exactly
 * as the live PM path reads it (server-v2/eod-gex-recorder.js fetchSpxLadder):
 *   - rows WHERE expiry = date          → the 0DTE expiry only
 *   - at the last snapshot STRICTLY BEFORE 16:00 ET (post-close snapshots drift)
 *   - value = Σ (net_gex + net_vol_gex) → OI+Vol
 * Same query, same cutoff, same basis as a live write, so a backfilled bar and
 * a fresh bar are the same measurement.
 *
 * WHAT IT WILL NOT DO. net_vol_gex was added to option_strike_gex_history after
 * the table existed. A session whose ladder has it on fewer than VOL_COVERAGE_MIN
 * of its strikes CANNOT yield an OI+Vol total, and this script leaves those rows
 * NULL and lists them at the end instead of coalescing to an OI-only number that
 * would then be charted under an OI+Vol label. Expect a tail of unfillable early
 * sessions; that is the honest outcome, not a bug.
 *
 * USAGE (inside the dashboard container, DATABASE_URL in env):
 *   node server-v2/scripts/backfill-eod-gex-0dte.js                 # dry run, all rows
 *   node server-v2/scripts/backfill-eod-gex-0dte.js --commit        # write
 *   node server-v2/scripts/backfill-eod-gex-0dte.js --days=90 --commit
 *   node server-v2/scripts/backfill-eod-gex-0dte.js --from=2026-06-01 --to=2026-07-29
 *   node server-v2/scripts/backfill-eod-gex-0dte.js --force --commit # redo non-null rows
 *
 * Dry run by default: it prints what each session would get and touches nothing.
 */

const path = require('node:path');
const { Pool } = require('pg');
// From computation/utils (pure) rather than eod-gex-recorder, so this script
// doesn't pull in the recorder's Theta/TT module graph or its timers.
const { etEpochMs } = require('../computation/utils');

// DATABASE_URL lives in .env.local (the same file server-with-proxy.js loads with
// dotenv override:true, and the only env_file the dashboard container mounts).
// Load it ourselves when it isn't already in the environment, so this runs the
// same way from a bare shell on the host as it does inside the container —
// otherwise a host run just prints "DATABASE_URL is not set" and looks broken.
if (!process.env.DATABASE_URL) {
  const ROOT = path.join(__dirname, '..', '..');
  for (const f of ['.env.local', '.env']) {
    try {
      require('dotenv').config({ path: path.join(ROOT, f), override: false });
    } catch { /* dotenv absent — fall through to the explicit error below */ }
    if (process.env.DATABASE_URL) { console.log(`[backfill-0dte] loaded DATABASE_URL from ${f}`); break; }
  }
}

// Kept in sync with fetchSpxLadder's guards by intent — if you change them
// there, change them here, or a backfilled bar stops matching a live one.
const MIN_POPULATED_STRIKES = 20;
const VOL_COVERAGE_MIN = 0.5;

const SYMBOL = '$SPX'; // the only symbol with a persisted per-strike ladder

function parseArgs(argv) {
  const out = { commit: false, force: false, days: null, from: null, to: null, symbol: SYMBOL };
  for (const a of argv.slice(2)) {
    if (a === '--commit') out.commit = true;
    else if (a === '--force') out.force = true;
    else if (a.startsWith('--days=')) out.days = Math.max(1, Number(a.slice(7)) || 0);
    else if (a.startsWith('--from=')) out.from = a.slice(7);
    else if (a.startsWith('--to=')) out.to = a.slice(5);
    else if (a.startsWith('--symbol=')) out.symbol = a.slice(9);
    // `node -r dotenv/config script.js dotenv_config_path=…` puts dotenv's own
    // settings in argv; ignore them instead of aborting on "unknown arg".
    else if (a.startsWith('dotenv_config_')) continue;
    else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function getPool() {
  const cs = process.env.DATABASE_URL;
  if (!cs) {
    console.error('DATABASE_URL is not set, and no .env.local / .env at the repo root supplied one.');
    console.error('Run it where the DB is configured, e.g. inside the dashboard container:');
    console.error('  docker compose exec dashboard node server-v2/scripts/backfill-eod-gex-0dte.js');
    process.exit(2);
  }
  // SSL rule copied VERBATIM from eod-gex-recorder.js getPool(): TLS for every
  // non-loopback host, regardless of what sslmode says in the URL. Gating on
  // `sslmode=require` instead (the obvious-looking choice) connects in the clear
  // to a TLS-only server, which closes the socket and surfaces as a bare
  // "read ECONNRESET" that looks like a network problem rather than a TLS one.
  const loopback = cs.includes('localhost') || cs.includes('127.0.0.1');
  return new Pool({
    connectionString: cs,
    ssl: loopback ? undefined : { rejectUnauthorized: false },
    max: 3,
    keepAlive: true,
  });
}

/** eod_gex rows in scope, oldest first. */
async function targetRows(p, args) {
  const where = ['symbol = $1'];
  const params = [args.symbol];
  if (!args.force) where.push('total_gex_0dte IS NULL');
  if (args.from) { params.push(args.from); where.push(`date >= $${params.length}`); }
  if (args.to) { params.push(args.to); where.push(`date <= $${params.length}`); }
  let sql = `SELECT date, symbol, total_gex, total_gex_0dte, source
             FROM eod_gex WHERE ${where.join(' AND ')} ORDER BY date ASC`;
  if (args.days) { params.push(args.days); sql = `${sql.replace('ORDER BY date ASC', 'ORDER BY date DESC')} LIMIT $${params.length}`; }
  const { rows } = await p.query(sql, params);
  // `date` is TEXT in this table, but tolerate a Date if the column ever changes.
  const norm = rows.map((r) => ({
    ...r,
    date: typeof r.date === 'string' ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10),
  }));
  return args.days ? norm.reverse() : norm;
}

/**
 * 0DTE OI+Vol total for one session from the persisted ladder.
 * Returns { value, strikes, volRows, snapMs } or { skip: '<reason>' }.
 */
async function ladder0dte(p, symbol, date) {
  const cutoff = etEpochMs(date, 16, 0);
  const { rows } = await p.query(
    `WITH snap AS (
       SELECT max(timestamp) AS t
       FROM option_strike_gex_history
       WHERE symbol = $1 AND date = $2 AND expiry = $2 AND timestamp < $3
     )
     SELECT h.strike, h.net_gex, h.net_vol_gex, h.timestamp
     FROM option_strike_gex_history h, snap
     WHERE h.symbol = $1 AND h.date = $2 AND h.expiry = $2
       AND h.timestamp = snap.t`,
    [symbol, date, cutoff]
  );

  if (!rows.length) return { skip: 'no 0DTE ladder rows before 16:00 ET' };

  let sum = 0, volRows = 0;
  for (const r of rows) {
    const g = Number(r.net_gex) || 0;
    if (r.net_vol_gex != null && Number.isFinite(Number(r.net_vol_gex))) {
      volRows++;
      sum += g + Number(r.net_vol_gex);
    } else {
      sum += g;
    }
  }

  // Two distinct failures, kept distinct in the message: a ladder too thin to
  // trust at all, vs. a full-size ladder whose net_vol_gex was never recorded.
  if (rows.length < MIN_POPULATED_STRIKES) {
    return { skip: `ladder has only ${rows.length} strikes (min ${MIN_POPULATED_STRIKES}) — too thin to trust` };
  }
  if (volRows / rows.length < VOL_COVERAGE_MIN) {
    return {
      skip: `net_vol_gex on ${volRows}/${rows.length} strikes ` +
            `(need ≥${(VOL_COVERAGE_MIN * 100).toFixed(0)}%) — sum would be OI-only wearing an OI+Vol label`,
    };
  }
  return { value: sum, strikes: rows.length, volRows, snapMs: Number(rows[0].timestamp) };
}

const bn = (v) => `${v >= 0 ? '+' : ''}${(v / 1e9).toFixed(3)}B`;
const etTime = (ms) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit',
}).format(new Date(ms));

async function main() {
  const args = parseArgs(process.argv);
  const p = getPool();

  const rows = await targetRows(p, args);
  if (!rows.length) {
    console.log(`[backfill-0dte] nothing to do (${args.force ? 'no rows in range' : 'every row in range already has total_gex_0dte'})`);
    await p.end();
    return;
  }

  console.log(
    `[backfill-0dte] ${rows.length} session(s) in scope for ${args.symbol}` +
    `${args.force ? ' (--force: recomputing rows that already have a value)' : ''}` +
    `  ${args.commit ? 'MODE: COMMIT' : 'MODE: DRY RUN (pass --commit to write)'}`
  );

  const filled = [];
  const skipped = [];

  for (const row of rows) {
    let r;
    try {
      r = await ladder0dte(p, args.symbol, row.date);
    } catch (e) {
      skipped.push({ date: row.date, why: `query failed: ${e.message}` });
      continue;
    }

    if (r.skip) {
      skipped.push({ date: row.date, why: r.skip });
      console.log(`  ${row.date}  SKIP   ${r.skip}`);
      continue;
    }

    // Sanity line, not a gate: the ladder's OI-only sum is what total_gex holds
    // for source='ladder' rows, so a wildly different OI+Vol value is expected
    // on 0DTE (volume routinely dwarfs OI) — printing it makes that visible
    // rather than surprising.
    const legacy = Number(row.total_gex);
    const cmp = Number.isFinite(legacy) && legacy !== 0
      ? `  legacy total_gex ${bn(legacy)} (src=${row.source || '?'}, ratio ${(r.value / legacy).toFixed(1)}x)`
      : '';

    if (args.commit) {
      await p.query(
        `UPDATE eod_gex SET total_gex_0dte = $1 WHERE symbol = $2 AND date = $3`,
        [r.value, args.symbol, row.date]
      );
    }
    filled.push(row.date);
    console.log(
      `  ${row.date}  ${args.commit ? 'WROTE ' : 'would '} 0dte OI+Vol ${bn(r.value)}` +
      `  [${r.volRows}/${r.strikes} strikes w/ vol, snap ${etTime(r.snapMs)} ET]${cmp}`
    );
  }

  console.log(
    `\n[backfill-0dte] ${args.commit ? 'wrote' : 'would write'} ${filled.length}, skipped ${skipped.length}`
  );
  if (skipped.length) {
    console.log('[backfill-0dte] these sessions stay NULL (they will drop out of the chart, by design):');
    for (const s of skipped) console.log(`    ${s.date}  ${s.why}`);
  }
  if (!args.commit && filled.length) {
    console.log('[backfill-0dte] dry run — nothing was written. Re-run with --commit.');
  }

  await p.end();
}

main().catch((e) => {
  console.error('[backfill-0dte] FAILED:', e.message);
  // Connection-level failures from a developer machine are almost always reach,
  // not logic: the Postgres host may only accept connections from the VPS.
  if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|terminat/i.test(String(e.message))) {
    console.error('');
    console.error('That is a connection failure, not a data problem. If this host cannot reach');
    console.error('the database directly, run it where the app already does:');
    console.error('  docker compose exec dashboard node server-v2/scripts/backfill-eod-gex-0dte.js');
  }
  process.exit(1);
});
