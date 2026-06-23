const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not found in .env.local'); process.exit(1); }
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const q = "SELECT e.date, s.spot AS spx, e.close AS es, ROUND((e.close - s.spot)::numeric,2) AS basis FROM (SELECT DISTINCT ON(date) date, close FROM es_candles ORDER BY date, timestamp DESC) e JOIN eod_gex s ON s.date = e.date AND s.symbol = '$SPX' ORDER BY e.date DESC LIMIT 10;";
  const r = await p.query(q);
  console.table(r.rows);
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });
