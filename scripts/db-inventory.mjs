#!/usr/bin/env node
// Postgres space + retention inventory. Run anywhere that can reach DATABASE_URL.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// --- find pg, wherever node_modules lives -------------------------------
let pg = null;
for (const root of ['/app', '/opt/dashboard', process.cwd(), '/opt/dashboard/server-v2']) {
  try { pg = createRequire(path.join(root, 'x.js'))('pg'); break; } catch {}
}
if (!pg) { console.error("Can't find the 'pg' module. Run this inside the app container:\n  docker compose cp /tmp/db-inventory.mjs dashboard:/tmp/db-inventory.mjs\n  docker compose exec -T dashboard node /tmp/db-inventory.mjs"); process.exit(1); }

// --- find DATABASE_URL --------------------------------------------------
let URL_ = process.env.DATABASE_URL;
if (!URL_) for (const f of ['/app/.env.local', '/opt/dashboard/.env.local', path.join(process.cwd(), '.env.local')]) {
  if (!fs.existsSync(f)) continue;
  const m = /^\s*DATABASE_URL\s*=\s*(.+)$/m.exec(fs.readFileSync(f, 'utf8'));
  if (m) { URL_ = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!URL_) { console.error('No DATABASE_URL in env or .env.local'); process.exit(1); }

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const TOP = Number(arg('--top', 30));
const TIMEOUT_S = Number(arg('--timeout', 60));
const DO_DATES = !process.argv.includes('--no-dates');
const OUT = arg('--out', '/tmp');

const B = (n) => { if (n == null) return ''; const u = ['B','KB','MB','GB','TB']; let v = Number(n), i = 0; while (v >= 1024 && i < 4) { v /= 1024; i++; } return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`; };
const P = (s, w, r) => { s = String(s ?? ''); return r ? s.padStart(w) : s.padEnd(w); };
const D = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const lines = []; const say = (s = '') => { lines.push(s); console.log(s); };

const PREF = ['ts','as_of','asof','recorded_at','captured_at','created_at','inserted_at','time','timestamp','snapshot_at','snap_ts','event_time','trade_date','session_date','date','day','updated_at'];

const c = new pg.Client({ connectionString: URL_, ssl: { rejectUnauthorized: false } });
await c.connect();

const db = (await c.query('select current_database() db, pg_database_size(current_database()) sz')).rows[0];
const tables = (await c.query(`select n.nspname schema, r.relname name,
    pg_total_relation_size(r.oid) total, pg_relation_size(r.oid) heap,
    pg_indexes_size(r.oid) idx, coalesce(pg_total_relation_size(r.reltoastrelid),0) toast,
    r.reltuples::bigint est_rows
  from pg_class r join pg_namespace n on n.oid=r.relnamespace
  where r.relkind in ('r','m','p') and n.nspname not in ('pg_catalog','information_schema','pg_toast')
  order by 3 desc`)).rows;

const dc = new Map();
for (const r of (await c.query(`select table_schema s, table_name t, column_name col from information_schema.columns
  where data_type in ('timestamp with time zone','timestamp without time zone','date')
    and table_schema not in ('pg_catalog','information_schema')`)).rows) {
  const k = `${r.s}.${r.t}`; if (!dc.has(k)) dc.set(k, []); dc.get(k).push(r.col);
}
const pick = (k) => { const cols = dc.get(k); if (!cols) return null;
  for (const p of PREF) { const h = cols.find((x) => x.toLowerCase() === p); if (h) return h; }
  for (const p of PREF) { const h = cols.find((x) => x.toLowerCase().includes(p)); if (h) return h; }
  return cols[0]; };

const prof = new Map();
if (DO_DATES) {
  await c.query(`set statement_timeout = ${TIMEOUT_S * 1000}`);
  for (const t of tables.slice(0, TOP)) {
    const k = `${t.schema}.${t.name}`; const col = pick(k);
    const rec = { col, min: null, max: null, span: null, note: col ? '' : 'no date col' };
    if (col) try {
      const r = (await c.query(`select min("${col}") lo, max("${col}") hi from "${t.schema}"."${t.name}"`)).rows[0];
      rec.min = r.lo; rec.max = r.hi;
      if (r.lo && r.hi) rec.span = Math.max(1, Math.round((new Date(r.hi) - new Date(r.lo)) / 864e5));
    } catch (e) { rec.note = /timeout/i.test(e.message) ? `>${TIMEOUT_S}s` : e.message.slice(0, 30); }
    prof.set(k, rec);
  }
  await c.query('set statement_timeout = 0');
}

const idxs = (await c.query(`select relname tbl, indexrelname idx, pg_relation_size(indexrelid) sz, idx_scan
  from pg_stat_user_indexes order by 3 desc limit 25`)).rows;

say(`Postgres inventory — ${db.db} — ${new Date().toISOString()}`);
say(`DB size ${B(db.sz)} across ${tables.length} tables`);
say('');
say(`${P('table',44)} ${P('total',9,1)} ${P('heap',9,1)} ${P('index',9,1)} ${P('toast',9,1)} ${P('~rows',13,1)} ${P('%db',5,1)}  ${P('oldest',11)}${P('newest',11)}${P('span',7)}~/day`);
say('-'.repeat(150));
for (const t of tables.slice(0, Math.max(TOP, 45))) {
  const p = prof.get(`${t.schema}.${t.name}`) || {};
  say(`${P((t.schema === 'public' ? '' : t.schema + '.') + t.name, 44)} ${P(B(t.total),9,1)} ${P(B(t.heap),9,1)} ${P(B(t.idx),9,1)} ${P(B(t.toast),9,1)} ${P(Number(t.est_rows).toLocaleString(),13,1)} ${P((Number(t.total)/Number(db.sz)*100).toFixed(1),5,1)}  ${P(D(p.min),11)}${P(D(p.max),11)}${P(p.span ? p.span + 'd' : (p.note || ''), 7)}${p.span ? B(Number(t.total) / p.span) : ''}`);
}
say('');
say('LARGEST INDEXES (idx_scan 0 = never used since stats reset)');
for (const i of idxs) say(`  ${P(B(i.sz),9,1)}  ${P(i.idx,52)} on ${P(i.tbl,32)} scans=${i.idx_scan}`);
say('');
say('TRIM CANDIDATES (>120d of history, sized)');
for (const t of tables.slice(0, Math.max(TOP, 45))) {
  const p = prof.get(`${t.schema}.${t.name}`); if (!p?.span || p.span <= 120) continue;
  const per = Number(t.total) / p.span;
  say(`  ${P(t.name,44)} ${P(B(t.total),9,1)}  ${p.span}d back to ${D(p.min)}  ~${B(per)}/day  → keep 90d frees ~${B(Math.max(0, Number(t.total) - per * 90))}`);
}

try { fs.writeFileSync(path.join(OUT, 'db-inventory.txt'), lines.join('\n')); say(`\nSaved ${path.join(OUT, 'db-inventory.txt')}`); } catch {}
await c.end();
