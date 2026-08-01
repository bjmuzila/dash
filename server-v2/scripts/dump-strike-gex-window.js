'use strict';
/**
 * server-v2/scripts/dump-strike-gex-window.js
 *
 * ONE-OFF RESCUE. Dumps whatever is currently inside option_strike_gex_history
 * to CSV before retention deletes it.
 *
 * Why this exists: insertOptionStrikeGexRows() ends with an unscoped
 *
 *     DELETE FROM option_strike_gex_history WHERE timestamp < now() - 48h
 *
 * that runs on EVERY recorder POST. There is no archive behind it, so a session
 * is unrecoverable roughly 48 hours after each row was written — a Friday
 * session starts disappearing Sunday morning, oldest rows first. Nothing else
 * on disk holds a per-strike ladder: gex_strike_history.csv stops at 2026-07-20
 * and predates the expiry/symbol/net_vol_gex columns entirely.
 *
 * The dump is SCHEMA-INTROSPECTED rather than hardcoded, so it captures whatever
 * columns the table actually has on the machine it runs on — net_dex and
 * net_vol_dex included once the writer has added them, absent without error on a
 * server that has not upgraded yet. A rescue script that throws on an unexpected
 * column is not a rescue script.
 *
 * Usage (inside the dashboard container, where DATABASE_URL is set):
 *
 *   node server-v2/scripts/dump-strike-gex-window.js
 *   node server-v2/scripts/dump-strike-gex-window.js --date=2026-07-31
 *   node server-v2/scripts/dump-strike-gex-window.js --date=2026-07-31 --gz
 *   node server-v2/scripts/dump-strike-gex-window.js --all --out=/tmp/rescue
 *
 *   --date=YYYY-MM-DD   only this session (repeatable, comma-separated)
 *   --all               every session still in the table (default)
 *   --symbol=$SPX       only this underlying (default: all)
 *   --out=DIR           output directory (default: cwd)
 *   --gz                gzip each CSV
 *
 * Writes one CSV per session per symbol plus a manifest.json holding the row
 * counts, the column list and the true time span of each file, so a later import
 * can verify it got everything instead of trusting the filename.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TABLE = 'option_strike_gex_history';

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, dflt = null) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
};
const OUT_DIR = String(arg('out', process.cwd()));
const GZIP = Boolean(arg('gz', false));
const ONLY_SYMBOL = arg('symbol', null);
const ONLY_DATES = arg('date', null)
  ? String(arg('date')).split(',').map((s) => s.trim()).filter(Boolean)
  : null;

function getPool() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — run this inside the dashboard container.');
    process.exit(1);
  }
  const { Pool } = require('pg');
  const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: local ? undefined : { rejectUnauthorized: false },
    max: 2,
  });
}

/** RFC4180-ish. Values here are numbers and short identifiers, but quote anyway. */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const etStamp = (ms) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(Number(ms)));

async function main() {
  const pool = getPool();

  // Whatever the table actually looks like here, in ordinal order.
  const { rows: colRows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 ORDER BY ordinal_position`, [TABLE]
  );
  if (!colRows.length) {
    console.error(`table ${TABLE} does not exist on this database.`);
    process.exit(1);
  }
  const cols = colRows.map((r) => r.column_name);
  console.log(`columns (${cols.length}): ${cols.join(', ')}`);
  for (const wanted of ['expiry', 'symbol', 'net_vol_gex', 'net_dex', 'net_vol_dex']) {
    if (!cols.includes(wanted)) console.warn(`  ! ${wanted} absent — dumps from this server will not carry it`);
  }

  // What is left in the window, and how close each session is to the cliff.
  const { rows: sessions } = await pool.query(
    `SELECT ${cols.includes('symbol') ? 'symbol' : `'$SPX' AS symbol`} AS symbol,
            date,
            ${cols.includes('expiry') ? 'expiry' : `date AS expiry`} AS expiry,
            COUNT(*)::bigint            AS rows,
            COUNT(DISTINCT timestamp)::int AS snaps,
            MIN(timestamp)::bigint      AS first_ts,
            MAX(timestamp)::bigint      AS last_ts
       FROM ${TABLE}
      GROUP BY 1, 2, 3
      ORDER BY date DESC, symbol ASC, expiry ASC`
  );
  if (!sessions.length) {
    console.error('table is empty — nothing to rescue.');
    await pool.end();
    process.exit(1);
  }

  const CUTOFF = Date.now() - 2 * 24 * 60 * 60 * 1000;
  console.log('\nIn the window right now:');
  for (const s of sessions) {
    const dead = Number(s.first_ts) < CUTOFF;
    const hoursLeft = (Number(s.first_ts) - CUTOFF) / 3600000;
    console.log(
      `  ${String(s.symbol).padEnd(6)} ${String(s.date).slice(0, 10)} exp ${String(s.expiry).slice(0, 10)}` +
      ` · ${String(s.rows).padStart(8)} rows · ${String(s.snaps).padStart(5)} snaps` +
      ` · ${etStamp(s.first_ts)}–${etStamp(s.last_ts).slice(-5)} ET` +
      (dead
        ? '  ← ALREADY PAST THE 48h CUTOFF, oldest rows may be gone'
        : `  ← ~${hoursLeft.toFixed(1)}h until the oldest rows are deleted`)
    );
  }

  const targets = sessions.filter((s) => {
    const d = String(s.date).slice(0, 10);
    if (ONLY_DATES && !ONLY_DATES.includes(d)) return false;
    if (ONLY_SYMBOL && String(s.symbol) !== ONLY_SYMBOL) return false;
    return true;
  });
  if (!targets.length) {
    console.error(`\nnothing matched --date/--symbol. Available: ${[...new Set(sessions.map((s) => String(s.date).slice(0, 10)))].join(', ')}`);
    await pool.end();
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = { table: TABLE, columns: cols, dumpedAt: new Date().toISOString(), files: [] };

  console.log(`\nWriting ${targets.length} file(s) to ${OUT_DIR}`);
  const selectList = cols.map((c) => `"${c}"`).join(', ');

  for (const s of targets) {
    const date = String(s.date).slice(0, 10);
    const expiry = String(s.expiry).slice(0, 10);
    const sym = String(s.symbol).replace(/[^A-Za-z0-9]/g, '') || 'SPX';
    const base = `osgh_${sym}_${date}_exp${expiry}.csv`;
    const file = path.join(OUT_DIR, GZIP ? `${base}.gz` : base);

    const where = [`date = $1`];
    const params = [String(s.date)];
    if (cols.includes('expiry')) { where.push(`expiry = $${params.length + 1}`); params.push(String(s.expiry)); }
    if (cols.includes('symbol')) { where.push(`symbol = $${params.length + 1}`); params.push(String(s.symbol)); }

    // Ordered by (timestamp, strike) so the file is directly re-importable and
    // diffable, and so a truncated write is obvious rather than subtly wrong.
    const { rows } = await pool.query(
      `SELECT ${selectList} FROM ${TABLE} WHERE ${where.join(' AND ')} ORDER BY timestamp ASC, strike ASC`,
      params
    );

    const lines = [cols.join(',')];
    for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
    const body = lines.join('\n') + '\n';
    const buf = GZIP ? zlib.gzipSync(Buffer.from(body), { level: 9 }) : Buffer.from(body);
    fs.writeFileSync(file, buf);

    const entry = {
      file: path.basename(file), symbol: String(s.symbol), date, expiry,
      rows: rows.length, snaps: Number(s.snaps),
      firstTs: Number(s.first_ts), lastTs: Number(s.last_ts),
      firstEt: etStamp(s.first_ts), lastEt: etStamp(s.last_ts),
      bytes: buf.length,
    };
    manifest.files.push(entry);
    console.log(`  ${entry.file}  ${rows.length.toLocaleString()} rows  ${(buf.length / 1e6).toFixed(2)} MB`);
    if (rows.length !== Number(s.rows)) {
      console.warn(`  ! expected ${s.rows} rows, wrote ${rows.length} — retention may have run mid-dump`);
    }
  }

  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nmanifest: ${manifestPath}`);
  console.log(`total: ${manifest.files.reduce((a, f) => a + f.rows, 0).toLocaleString()} rows, ` +
    `${(manifest.files.reduce((a, f) => a + f.bytes, 0) / 1e6).toFixed(2)} MB`);
  console.log('\nCopy these OFF the container — they are on ephemeral disk until you do.');

  await pool.end();
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
