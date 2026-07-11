// Discover GEX-related tables + columns.  node discover_gex.mjs
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL first.'); process.exit(1); }
const c = new pg.Client({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
await c.connect();

const t = await c.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public'
    AND (table_name ILIKE '%gex%' OR table_name ILIKE '%level%'
         OR table_name ILIKE '%flip%' OR table_name ILIKE '%wall%' OR table_name ILIKE '%eod%')
  ORDER BY table_name`);
console.log('=== candidate tables ===');
console.log(t.rows.map(r => r.table_name).join('\n') || '(none)');

for (const r of t.rows) {
  const cols = await c.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [r.table_name]);
  console.log(`\n--- ${r.table_name} ---`);
  console.log(cols.rows.map(x => `${x.column_name} (${x.data_type})`).join(', '));
  const cnt = await c.query(`SELECT count(*)::int n, min(1) FROM "${r.table_name}"`).catch(() => null);
  if (cnt) console.log(`rows: ${cnt.rows[0].n}`);
}
await c.end();
