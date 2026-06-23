const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const es = await p.query("SELECT DISTINCT ON(date) date, ROUND(close::numeric,2) AS es_close, time FROM es_candles ORDER BY date DESC, timestamp DESC LIMIT 2;");
  console.log('--- ES daily close (latest 2 trading days) ---');
  console.table(es.rows);
  const prev = es.rows[1];
  if (prev) console.log(`Prior-day ES close: ${prev.es_close}  (${prev.date} @ ${prev.time})`);
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });
