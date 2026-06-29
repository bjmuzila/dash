import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const p = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
});
const sql = "SELECT count(*) n, min(date) mn, max(date) mx, round((avg(total_gex)/1e9)::numeric,2) avg_b FROM eod_gex WHERE symbol = '$SPX'";
const r = await p.query(sql);
console.log(r.rows[0]);
await p.end();
