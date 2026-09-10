#!/usr/bin/env node
/**
 * db-run.mjs — run maintenance SQL against the Postgres, one statement at a
 * time (autocommit, so CONCURRENTLY works), printing DB size after each.
 *
 *   node /tmp/db-run.mjs reindex          # rebuild bloated indexes (safe, no drops)
 *   node /tmp/db-run.mjs drops            # drop dead indexes (resolved by definition)
 *   node /tmp/db-run.mjs --sql "SELECT 1"
 *   node /tmp/db-run.mjs --file /tmp/x.sql
 *   ... add --dry to print what it WOULD do and exit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

let pg = null;
for (const r of ['/app', '/opt/dashboard', process.cwd()]) { try { pg = createRequire(path.join(r, 'x.js'))('pg'); break; } catch {} }
if (!pg) { console.error("no 'pg' module — run inside the dashboard container"); process.exit(1); }
let U = process.env.DATABASE_URL;
if (!U) for (const f of ['/app/.env.local', '/opt/dashboard/.env.local']) {
  if (!fs.existsSync(f)) continue;
  const m = /^\s*DATABASE_URL\s*=\s*(.+)$/m.exec(fs.readFileSync(f, 'utf8'));
  if (m) { U = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!U) { console.error('no DATABASE_URL'); process.exit(1); }

const A = process.argv.slice(2);
const DRY = A.includes('--dry');
const mode = A.find((x) => !x.startsWith('--')) || '';
const argOf = (n) => { const i = A.indexOf(n); return i >= 0 ? A[i + 1] : null; };

const B = (n) => { const u = ['B','KB','MB','GB','TB']; let v = Number(n), i = 0; while (v >= 1024 && i < 4) { v /= 1024; i++; } return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`; };

// Indexes to drop, identified by the TAIL of their definition so we never
// depend on a guessed index name. reason = why it is safe.
const DROPS = [
  ['option_strike_gex_history', 'btree (id)',                              'PK, 5 scans ever; nothing reads/updates by id'],
  ['oi_daily',                  'btree (symbol, expiry, date DESC, strike)', '253 MB, 76 scans'],
  ['oi_daily',                  'btree (date)',                            'redundant: pkey leads with date'],
  ['oi_daily',                  'btree (symbol, date DESC)',               '38 MB, 48 scans'],
  ['etf_candles',               'btree (symbol, date, "timestamp")',       '123 MB, 885 scans vs 440M on (symbol,timestamp)'],
  ['strike_growth_expiry',      'btree (symbol, expiry, date, ts DESC)',   '76 MB, 53 scans'],
  ['darkpool_prints',           'btree (underlying, date, seq)',           '60 MB, ZERO scans'],
  ['watch_snapshots',           'btree (id)',                              'PK, zero scans'],
  ['es_candles',                'btree ("slotKey")',                       'redundant with ("slotKey","intervalMinutes")'],
  ['nq_candles',                'btree ("slotKey")',                       'exact duplicate index — drops the unused copy only'],
];

const REINDEX = [
  ['flow_prints',   '3.8 GB of index on a 209 MB heap — ~20x bloat'],
  ['strike_growth', '1.5 GB of index on 2.2M rows'],
  ['oi_daily',      '508 MB of index, 349k dead tuples'],
];

const c = new pg.Client({ connectionString: U, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('set statement_timeout = 0');
const size = async () => Number((await c.query('select pg_database_size(current_database()) s')).rows[0].s);
let start = await size();
console.log(`DB size now: ${B(start)}\n`);

const run = async (sql, label) => {
  if (DRY) { console.log(`[dry] ${sql}`); return; }
  const t0 = Date.now();
  process.stdout.write(`${label}\n  ${sql}\n  ... `);
  try {
    await c.query(sql);
    const now = await size();
    console.log(`ok in ${((Date.now() - t0) / 1000).toFixed(1)}s — DB ${B(now)} (freed ${B(Math.max(0, start - now))} so far)`);
    start = Math.min(start, start); // keep original baseline
  } catch (e) { console.log(`FAILED: ${e.message}`); }
};

if (mode === 'drops') {
  for (const [tbl, def, why] of DROPS) {
    const rows = await c.query(`
      select i.indexname, i.indexdef, s.idx_scan,
             (select conname from pg_constraint where conindid = (quote_ident(i.schemaname)||'.'||quote_ident(i.indexname))::regclass) con,
             pg_relation_size((quote_ident(i.schemaname)||'.'||quote_ident(i.indexname))::regclass) sz
        from pg_indexes i
        left join pg_stat_user_indexes s on s.indexrelname = i.indexname and s.relname = i.tablename
       where i.schemaname='public' and i.tablename=$1 and i.indexdef like $2
       order by s.idx_scan asc nulls first`, [tbl, '%' + def]);
    if (!rows.rows.length) { console.log(`SKIP ${tbl} ${def} — not found (already dropped?)\n`); continue; }
    const r = rows.rows[0];
    const sql = r.con
      ? `ALTER TABLE ${tbl} DROP CONSTRAINT ${r.con}`
      : `DROP INDEX CONCURRENTLY IF EXISTS ${r.indexname}`;
    await run(sql, `DROP ${B(r.sz)}  ${tbl}.${r.indexname}  (scans=${r.idx_scan ?? '?'}) — ${why}`);
    console.log('');
  }
} else if (mode === 'reindex') {
  for (const [tbl, why] of REINDEX) {
    await run(`REINDEX TABLE CONCURRENTLY ${tbl}`, `REINDEX ${tbl} — ${why}`);
    const bad = (await c.query(`select indexrelid::regclass::text n from pg_index
      where not indisvalid and indrelid = $1::regclass`, [tbl])).rows;
    for (const b of bad) await run(`DROP INDEX CONCURRENTLY IF EXISTS ${b.n}`, `  cleanup of failed rebuild ${b.n}`);
    console.log('');
  }
} else if (argOf('--sql') || argOf('--file')) {
  const raw = argOf('--sql') || fs.readFileSync(argOf('--file'), 'utf8');
  const stmts = raw.split(/;\s*(?:\r?\n|$)/).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
  for (const s of stmts) {
    if (DRY) { console.log(`[dry] ${s}`); continue; }
    try { const r = await c.query(s); console.log(`${s.slice(0, 90)} → ${r.command || ''} ${r.rowCount ?? ''}`); if (r.rows?.length) console.table(r.rows.slice(0, 60)); }
    catch (e) { console.log(`${s.slice(0, 90)} → FAILED: ${e.message}`); }
  }
} else {
  console.log('usage: node db-run.mjs [reindex|drops] [--dry]   |   --sql "..."   |   --file x.sql');
}

console.log(`\nFinal DB size: ${B(await size())}`);
await c.end();
