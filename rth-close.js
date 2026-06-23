const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  // RTH close = the 16:00 ET 5m bar (covers 15:55-16:00). Match time '16:00' or '15:55'.
  const es = await p.query("SELECT date, ROUND(close::numeric,2) AS es_close, time FROM es_candles WHERE time IN ('16:00','15:55') ORDER BY date DESC, time DESC LIMIT 4;");
  console.log('--- ES RTH (4pm ET) close ---');
  console.table(es.rows);
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });
