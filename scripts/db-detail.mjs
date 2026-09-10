#!/usr/bin/env node
// Pass 2: index definitions, real date columns, age histograms, dead-tuple bloat.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

let pg = null;
for (const r of ['/app', '/opt/dashboard', process.cwd()]) { try { pg = createRequire(path.join(r, 'x.js'))('pg'); break; } catch {} }
if (!pg) { console.error("no 'pg' module — run inside the dashboard container"); process.exit(1); }

let U = process.env.DATABASE_URL;
if (!U) for (const f of ['/app/.env.local', '/opt/dashboard/.env.local', path.join(process.cwd(), '.env.local')]) {
  if (!fs.existsSync(f)) continue;
  const m = /^\s*DATABASE_URL\s*=\s*(.+)$/m.exec(fs.readFileSync(f, 'utf8'));
  if (m) { U = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!U) { console.error('no DATABASE_URL'); process.exit(1); }

const TABLES = (process.argv[2] || [
  'option_strike_gex_history','flow_prints','strike_growth','oi_daily','etf_candles',
  'strike_growth_expiry','darkpool_prints','last_events','scanner_variants','watch_snapshots',
  'scanner_snapshots','bzila_snapshots','wall_reach','eod_strike_gex','es_candles',
  'greeks_ts','premium_flow','ticker_wall_snapshots','nq_candles','atm_prem_intraday',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const lines = []; const say = (s = '') => { lines.push(s); console.log(s); };
const B = (n) => { const u = ['B','KB','MB','GB','TB']; let v = Number(n), i = 0; while (v >= 1024 && i < 4) { v /= 1024; i++; } return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`; };

const c = new pg.Client({ connectionString: U, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('set statement_timeout = 300000');

// dead tuples / vacuum state
say('=== TABLE HEALTH (dead tuples = space VACUUM FULL / pg_repack could reclaim) ===');
const st = (await c.query(`select relname, n_live_tup, n_dead_tup, last_vacuum, last_autovacuum, last_analyze
  from pg_stat_user_tables where relname = any($1) order by n_dead_tup desc`, [TABLES])).rows;
for (const r of st) say(`  ${r.relname.padEnd(34)} live=${String(r.n_live_tup).padStart(12)} dead=${String(r.n_dead_tup).padStart(11)}  last_autovac=${r.last_autovacuum ? new Date(r.last_autovacuum).toISOString().slice(0,16) : 'never'}`);
say('');

for (const t of TABLES) {
  const cols = (await c.query(`select column_name n, data_type d from information_schema.columns
    where table_schema='public' and table_name=$1 order by ordinal_position`, [t])).rows;
  if (!cols.length) { say(`### ${t} — NOT FOUND\n`); continue; }

  const sz = (await c.query(`select pg_total_relation_size($1::regclass) t, pg_relation_size($1::regclass) h`, [t])).rows[0];
  say(`### ${t}   total ${B(sz.t)} / heap ${B(sz.h)}`);
  say(`  columns: ${cols.map((x) => `${x.n}:${x.d.replace('timestamp with time zone','tstz').replace('timestamp without time zone','ts').replace('character varying','varchar').replace('double precision','f8')}`).join(', ')}`);

  const idx = (await c.query(`select indexname, indexdef, pg_relation_size((quote_ident(schemaname)||'.'||quote_ident(indexname))::regclass) sz
    from pg_indexes where schemaname='public' and tablename=$1 order by 3 desc`, [t])).rows;
  const scans = new Map((await c.query(`select indexrelname n, idx_scan s from pg_stat_user_indexes where relname=$1`, [t])).rows.map((r) => [r.n, r.s]));
  for (const i of idx) say(`  [${B(i.sz).padStart(8)} scans=${String(scans.get(i.indexname) ?? '?').padStart(12)}] ${i.indexdef.replace(/^CREATE (UNIQUE )?INDEX \S+ ON public\./, '')}`);

  // pick a date-ish column of ANY type
  const cand = cols.find((x) => /^(ts|snap_ts|snapshot_ts|as_of|asof|recorded_at|created_at|captured_at|trade_date|session_date|date|day|d)$/i.test(x.n))
            || cols.find((x) => /(^|_)(ts|date|day|time|created|recorded|snap|asof)($|_)/i.test(x.n));
  if (!cand) { say('  age: no date-ish column found'); say(''); continue; }
  const isNum = /int|numeric|double|real/.test(cand.d);
  const isTxt = /char|text/.test(cand.d);
  const expr = isNum ? `to_char(to_timestamp("${cand.n}"::double precision / (case when max_v > 1e12 then 1000 else 1 end)),'YYYY-MM')`
             : isTxt ? `substr("${cand.n}"::text,1,7)`
             : `to_char("${cand.n}",'YYYY-MM')`;
  try {
    let q;
    if (isNum) {
      const mx = (await c.query(`select max("${cand.n}")::double precision m from "${t}"`)).rows[0].m;
      const div = mx > 1e12 ? 1000 : 1;
      q = `select to_char(to_timestamp("${cand.n}"::double precision/${div}),'YYYY-MM') b, count(*) c from "${t}" group by 1 order by 1`;
    } else q = `select ${expr} b, count(*) c from "${t}" group by 1 order by 1`;
    const h = (await c.query(q)).rows;
    const tot = h.reduce((a, r) => a + Number(r.c), 0);
    const bytesPerRow = Number(sz.t) / Math.max(1, tot);
    say(`  age by "${cand.n}" (${cand.d}) — ${tot.toLocaleString()} rows, ~${B(bytesPerRow)}/row incl. indexes:`);
    for (const r of h) say(`     ${r.b}  ${String(Number(r.c).toLocaleString()).padStart(14)}  ~${B(Number(r.c) * bytesPerRow)}`);
  } catch (e) { say(`  age: FAILED (${e.message.slice(0, 60)})`); }
  say('');
}

try { fs.writeFileSync('/tmp/db-detail.txt', lines.join('\n')); console.log('Saved /tmp/db-detail.txt'); } catch {}
await c.end();
