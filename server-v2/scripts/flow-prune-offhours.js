'use strict';
/**
 * server-v2/scripts/flow-prune-offhours.js
 *
 * One-off cleanup for the flow_prints corruption found 2026-08-15.
 *
 * WHY THESE ROWS EXIST
 * --------------------
 * stampFlowTime() in proxy-tastytrade.js used to fall back to `Date.now()` when
 * a dxLink TimeAndSale arrived without a usable `time`. dxLink replays a
 * contract's recent tape whenever a subscription is (re)established, and those
 * replayed prints frequently carry no time — so each replay wrote the print
 * again, stamped with the moment of the reconnect instead of the moment of the
 * trade. Two consequences, both visible in prod:
 *
 *   - prints landed in hours the instrument does not trade (SPX rows at 02:00
 *     and 22:00 ET; 711 rows in the 16:00 ET hour of 2026-08-14, more than that
 *     whole real session), and
 *   - the (ts, symbol, side) primary key could not collapse them, because the
 *     re-stamp changed `ts` itself. One $6.61M SPX print exists at hours 00, 01
 *     and 08 of the same day.
 *
 * The ingest fix stops new rows being written this way. This script removes the
 * ones already on disk.
 *
 * WHAT IT DELETES — and what it deliberately does not
 * --------------------------------------------------
 * ONLY rows whose timestamp falls outside the instrument's real trading window:
 *
 *   - index roots (SPX/SPXW/NDX/NDXP/RUT/RUTW/XSP/XSPW/VIX/DJX): 09:30–16:15 ET
 *   - everything else (equities, ETFs):                          04:00–20:00 ET
 *
 * That rule is provable rather than heuristic: an SPX option cannot print at
 * 02:00 ET, so such a row is fabricated by definition and nothing real is lost.
 *
 * It does NOT try to collapse same-day duplicates by (symbol, side, price,
 * size) — two genuinely distinct fills of the same contract at the same price
 * and size in one session are ordinary, and a dedupe on that key would destroy
 * real prints to remove fake ones. Those in-window duplicates are REPORTED so
 * you can see how many remain, and left in place.
 *
 * Weekend rows (Sat/Sun ET) are removed for every root — no US option prints
 * then, whatever the ticker.
 *
 * USAGE
 *   node server-v2/scripts/flow-prune-offhours.js --from 2026-08-01 --to 2026-08-15
 *   node server-v2/scripts/flow-prune-offhours.js --from 2026-08-01 --to 2026-08-15 --apply
 *
 * DRY RUN BY DEFAULT — nothing is deleted without --apply. Both modes print the
 * same per-day breakdown, so run it once without the flag and read it first.
 *
 * Requires DATABASE_URL (same one the server uses). Run it inside the container:
 *   docker compose exec dashboard node server-v2/scripts/flow-prune-offhours.js --from ... --to ...
 */

const { Pool } = require('pg');

// ── args ───────────────────────────────────────────────────────────────────
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const APPLY = process.argv.includes('--apply');
const FROM = String(arg('from', '') || '');
const TO = String(arg('to', '') || '');

if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM) || !/^\d{4}-\d{2}-\d{2}$/.test(TO)) {
  console.error('usage: node server-v2/scripts/flow-prune-offhours.js --from YYYY-MM-DD --to YYYY-MM-DD [--apply]');
  process.exit(2);
}
if (FROM > TO) {
  console.error(`--from (${FROM}) is after --to (${TO})`);
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — run this inside the dashboard container.');
  process.exit(2);
}

// Roots that trade only during the RTH cash session. Streamer variants included
// (SPX options stream under SPXW, NDX under NDXP, …) because underlying_norm
// holds whichever form the writer saw.
const INDEX_ROOTS = ['SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'RUTW', 'XSP', 'XSPW', 'VIX', 'DJX'];

// Session bounds in minutes past ET midnight.
const IDX_OPEN = 9 * 60 + 30;   // 09:30
const IDX_CLOSE = 16 * 60 + 15; // 16:15 — SPX/index options settle 15 min after the cash close
const EQ_OPEN = 4 * 60;         // 04:00 — pre-market
const EQ_CLOSE = 20 * 60;       // 20:00 — post-market

// A row is off-hours when its ET wall-clock minute sits outside its instrument's
// window, or it lands on a weekend. Expressed once, used by both the report and
// the delete so the two can never disagree about what "off-hours" means.
const OFFHOURS_PREDICATE = `
  (
    EXTRACT(DOW FROM (to_timestamp(ts/1000) AT TIME ZONE 'America/New_York')) IN (0, 6)
    OR (
      CASE WHEN underlying_norm = ANY($3) THEN 1 ELSE 0 END = 1
      AND (
        (EXTRACT(HOUR FROM (to_timestamp(ts/1000) AT TIME ZONE 'America/New_York')) * 60
         + EXTRACT(MINUTE FROM (to_timestamp(ts/1000) AT TIME ZONE 'America/New_York'))) < ${IDX_OPEN}
        OR
        (EXTRACT(HOUR FROM (to_timestamp(ts/1000) AT TIME ZONE 'America/New_York')) * 60
         + EXTRACT(MINUTE FROM (to_timestamp(ts/1000) AT TIME ZONE 'America/New_York'))) > ${IDX_CLOSE}
      )
    )
    OR (
      CASE WHEN underlying_norm = ANY($3) THEN 1 ELSE 0 END = 0
      AND (
        (EXTRACT(HOUR FROM (to_timestamp(ts/1000) AT TIME ZONE 'America/New_York')) * 60
         + EXTRACT(MINUTE FROM (to_timestamp(ts/1000) AT TIME ZONE 'America/New_York'))) < ${EQ_OPEN}
        OR
        (EXTRACT(HOUR FROM (to_timestamp(ts/1000) AT TIME ZONE 'America/New_York')) * 60
         + EXTRACT(MINUTE FROM (to_timestamp(ts/1000) AT TIME ZONE 'America/New_York'))) > ${EQ_CLOSE}
      )
    )
  )
`;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
  max: 2,
  statement_timeout: 300_000,
});

async function main() {
  console.log(`flow-prune-offhours  ${FROM} .. ${TO}  ${APPLY ? '*** APPLY (deletes rows) ***' : '(dry run)'}`);
  console.log(`  index roots  ${INDEX_ROOTS.join(', ')} → keep 09:30–16:15 ET`);
  console.log('  every other root                       → keep 04:00–20:00 ET');
  console.log('  weekends removed for all roots\n');

  // ── 1. what would go, per day ────────────────────────────────────────────
  const { rows: perDay } = await pool.query(
    `SELECT date,
            count(*)::int AS total,
            count(*) FILTER (WHERE ${OFFHOURS_PREDICATE})::int AS offhours
       FROM flow_prints
      WHERE date BETWEEN $1 AND $2
      GROUP BY date
      ORDER BY date`,
    [FROM, TO, INDEX_ROOTS]
  );

  if (!perDay.length) {
    console.log('no flow_prints rows in that range — nothing to do.');
    return;
  }

  let total = 0;
  let off = 0;
  for (const r of perDay) {
    total += r.total;
    off += r.offhours;
    const pct = r.total ? ((r.offhours / r.total) * 100).toFixed(1) : '0.0';
    console.log(`  ${r.date}   ${String(r.total).padStart(9)} rows   ${String(r.offhours).padStart(9)} off-hours (${pct}%)`);
  }
  console.log(`  ${'TOTAL'.padEnd(10)} ${String(total).padStart(9)} rows   ${String(off).padStart(9)} off-hours\n`);

  // ── 2. in-window duplicates — reported only, never deleted ───────────────
  const { rows: dupRows } = await pool.query(
    `SELECT coalesce(sum(extra), 0)::int AS extra_rows, count(*)::int AS groups
       FROM (
         SELECT count(*) - 1 AS extra
           FROM flow_prints
          WHERE date BETWEEN $1 AND $2
            AND NOT ${OFFHOURS_PREDICATE}
          GROUP BY date, symbol, side, price, size
         HAVING count(*) > 1
       ) d`,
    [FROM, TO, INDEX_ROOTS]
  );
  const dup = dupRows[0] || { extra_rows: 0, groups: 0 };
  console.log(`  in-window repeats: ${dup.extra_rows} extra row(s) across ${dup.groups} (symbol, side, price, size) group(s).`);
  console.log('  NOT deleted — a repeated fill at the same price and size is ordinary intraday behaviour');
  console.log('  and cannot be told apart from a replay by shape alone.\n');

  if (!APPLY) {
    console.log(`dry run — nothing deleted. Re-run with --apply to remove the ${off} off-hours row(s).`);
    return;
  }
  if (!off) {
    console.log('nothing to delete.');
    return;
  }

  // ── 3. delete, one day at a time ─────────────────────────────────────────
  // Per-day so a failure halfway leaves a clean boundary and the run can simply
  // be repeated (the predicate is idempotent — a second pass finds nothing).
  let deleted = 0;
  for (const r of perDay) {
    if (!r.offhours) continue;
    // eslint-disable-next-line no-await-in-loop
    // The predicate is written against $3 (third param of the report queries);
    // here it is the second. Function form, not a '$2' replacement string —
    // String.replace treats `$n` in a string replacement as a capture-group
    // reference, which is exactly the kind of silent mangling a DELETE must not
    // be exposed to.
    const res = await pool.query(
      `DELETE FROM flow_prints WHERE date = $1 AND ${OFFHOURS_PREDICATE.replace(/\$3/g, () => '$2')}`,
      [r.date, INDEX_ROOTS]
    );
    deleted += res.rowCount;
    console.log(`  deleted ${String(res.rowCount).padStart(9)} from ${r.date}`);
  }
  console.log(`\ndone — ${deleted} row(s) deleted.`);
  console.log('The /proxy/flow-netprem cache holds per-date bins in memory; restart the');
  console.log('container (or wait for eviction) before judging the /flow chart.');
}

main()
  .catch((e) => { console.error('failed:', e.message); process.exitCode = 1; })
  .finally(() => pool.end().catch(() => {}));
