const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const a = await p.query("SELECT date, ROUND(close::numeric,2) es FROM (SELECT DISTINCT ON(date) date, close FROM es_candles ORDER BY date, timestamp DESC) x ORDER BY date DESC LIMIT 10;");
  const b = await p.query("SELECT date, ROUND(spot::numeric,2) spx FROM eod_gex WHERE symbol='$SPX' ORDER BY date DESC LIMIT 10;");
  console.log('--- ES last candle/day ---'); console.table(a.rows);
  console.log('--- SPX eod_gex ---'); console.table(b.rows);
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });
