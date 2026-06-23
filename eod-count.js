const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await p.query("SELECT symbol, COUNT(*) n, MIN(date) first, MAX(date) last FROM eod_gex GROUP BY symbol ORDER BY symbol;");
  console.table(r.rows);
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });
