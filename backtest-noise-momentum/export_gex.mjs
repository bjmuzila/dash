// Export daily GEX regime rows -> gex.csv for the backtest.
//   node export_gex.mjs            (uses SYMBOL=SPX)
//   $env:SYMBOL='SPX'; node export_gex.mjs
// Needs DATABASE_URL in env.  netGex from eod_gex, walls from ticker_wall_snapshots.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'gex.csv');
const SYMBOL = process.env.SYMBOL || 'SPX';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL first.'); process.exit(1); }
const c = new pg.Client({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
await c.connect();

// diagnostics: what symbols/tickers exist and their coverage
const eg = await c.query(`SELECT symbol, count(*) n, min(date) lo, max(date) hi FROM eod_gex GROUP BY symbol ORDER BY n DESC`);
console.error('eod_gex symbols:', eg.rows.map(r => `${r.symbol}(${r.n}: ${r.lo}->${r.hi})`).join('  '));
const wt = await c.query(`SELECT ticker, count(*) n, min(date) lo, max(date) hi FROM ticker_wall_snapshots GROUP BY ticker ORDER BY n DESC`);
console.error('wall tickers  :', wt.rows.map(r => `${r.ticker}(${r.n}: ${r.lo}->${r.hi})`).join('  '));

// join: normalize date to YYYYMMDD; take last wall snapshot per day
const q = `
  WITH eg AS (
    SELECT regexp_replace(date,'\\D','','g') AS day, total_gex AS netgex, spot
    FROM eod_gex WHERE symbol = $1
  ),
  w AS (
    SELECT DISTINCT ON (regexp_replace(date,'\\D','','g'))
           regexp_replace(date,'\\D','','g') AS day, call_wall_strike, put_wall_strike
    FROM ticker_wall_snapshots WHERE ticker = $1
    ORDER BY regexp_replace(date,'\\D','','g'), timestamp DESC
  )
  SELECT eg.day, eg.netgex AS "netGex", eg.spot,
         w.call_wall_strike AS "callWall", w.put_wall_strike AS "putWall"
  FROM eg LEFT JOIN w USING (day)
  ORDER BY eg.day`;
const { rows } = await c.query(q, [SYMBOL]);
await c.end();

if (!rows.length) { console.error(`No eod_gex rows for symbol='${SYMBOL}'. Pick one from the list above via $env:SYMBOL.`); process.exit(1); }

const cols = ['day', 'netGex', 'spot', 'callWall', 'putWall'];
let csv = cols.join(',') + '\n';
for (const r of rows) csv += cols.map(k => (r[k] ?? '')).join(',') + '\n';
fs.writeFileSync(OUT, csv);
const withWalls = rows.filter(r => r.callWall != null).length;
console.error(`\nWrote ${rows.length} rows -> gex.csv  (${rows[0].day} → ${rows[rows.length - 1].day}), ${withWalls} with walls`);
