// Deletes today's poisoned greeks_ts rows (old DEX formula).
// Run: node scripts/clear-greeks-today.js
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set (.env.local)'); process.exit(1); }

const pool = new Pool({
  connectionString: url,
  ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
  max: 2,
});

// ET date string, matching etDateStr() in the app
const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

(async () => {
  const res = await pool.query('DELETE FROM greeks_ts WHERE date = $1', [date]);
  console.log(`Deleted ${res.rowCount} greeks_ts rows for ${date}`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
