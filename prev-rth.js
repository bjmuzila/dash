const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await p.query("SELECT date, ROUND(close::numeric,2) AS es_close, time FROM es_candles WHERE time='16:00' ORDER BY date DESC LIMIT 1;");
  const row = r.rows[0];
  if (row) console.log(`Prior-day ES RTH close: ${row.es_close}  (${row.date} @ 16:00 ET)`);
  else console.log('No 16:00 ET candle found.');
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });
