#!/usr/bin/env node
/* Gamma-wall tests on option_strike_gex_history (SPX per-strike net GEX + spot).
 * All aggregation happens in Postgres → only 1 row per day is transferred.
 *
 * Per day: wall = strike with the largest positive summed net GEX in the OPEN
 * snapshot (earliest ts of the day).
 *   TEST 1 — pin: is spot closer to the wall at close than at open?
 *   TEST 2 — wall as resistance/support: did intraday spot reach the wall and
 *            reject (finish on the original side) vs break through?
 *
 * Run on VPS:  docker exec -i dashboard-dashboard-1 node - < scripts/backtest-gamma-wall.mjs
 */
import pg from "pg";
const TOL     = Number(process.env.TOL ?? 5);      // slack for "reached"/"broke"
const NEAR    = Number(process.env.NEAR ?? 150);   // wall must be within this many pts of open spot
const MINRANGE= Number(process.env.MINRANGE ?? 5); // day's spot must move at least this (drops frozen weekends)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const sql = `
WITH snap AS (
  SELECT date, timestamp AS ts, spot, strike, net_gex
  FROM option_strike_gex_history
  WHERE spot > 0 AND net_gex IS NOT NULL
    AND EXTRACT(DOW FROM date::date) BETWEEN 1 AND 5   -- weekdays only
),
spots AS (SELECT DISTINCT date, ts, spot FROM snap),
day AS (
  SELECT date, MIN(ts) AS open_ts, MAX(ts) AS close_ts,
         MIN(spot) AS lo, MAX(spot) AS hi
  FROM spots GROUP BY date
),
open_spot  AS (SELECT s.date, MIN(s.spot) AS spot FROM spots s JOIN day d ON s.date=d.date AND s.ts=d.open_ts  GROUP BY s.date),
close_spot AS (SELECT s.date, MIN(s.spot) AS spot FROM spots s JOIN day d ON s.date=d.date AND s.ts=d.close_ts GROUP BY s.date),
open_strikes AS (
  SELECT sn.date, sn.strike, SUM(sn.net_gex) AS g
  FROM snap sn
  JOIN day d       ON sn.date=d.date AND sn.ts=d.open_ts
  JOIN open_spot o ON o.date=sn.date
  WHERE ABS(sn.strike - o.spot) <= ${NEAR}          -- wall must be near spot (kill far-OTM garbage)
  GROUP BY sn.date, sn.strike
),
wall AS (
  SELECT DISTINCT ON (date) date, strike AS wall FROM open_strikes ORDER BY date, g DESC
)
SELECT d.date, w.wall, o.spot AS open_spot, c.spot AS close_spot, d.lo, d.hi
FROM day d
JOIN wall w        ON w.date=d.date
JOIN open_spot o   ON o.date=d.date
JOIN close_spot c  ON c.date=d.date
WHERE d.open_ts < d.close_ts
  AND (d.hi - d.lo) >= ${MINRANGE}                   -- real session, not a frozen snapshot
ORDER BY d.date;
`;

const { rows } = await pool.query(sql);
if (!rows.length) { console.log("No usable days."); await pool.end(); process.exit(0); }

let days = 0, pulled = 0, sumOpen = 0, sumClose = 0, approached = 0, rejected = 0;
console.log(`date        wall    spotOpen spotClose  openΔ  closeΔ  side     approach reject`);
for (const r of rows) {
  const wall = +r.wall, sO = +r.open_spot, sC = +r.close_spot, hi = +r.hi, lo = +r.lo;
  const openD = Math.abs(sO - wall), closeD = Math.abs(sC - wall);
  const isPull = closeD < openD;
  days++; sumOpen += openD; sumClose += closeD; if (isPull) pulled++;

  let side = "at-spot", app = false, rej = false;
  if (wall > sO + TOL)      { side = "resist";  app = hi >= wall - TOL; if (app) rej = sC <= wall + TOL; }
  else if (wall < sO - TOL) { side = "support"; app = lo <= wall + TOL; if (app) rej = sC >= wall - TOL; }
  if (app) { approached++; if (rej) rejected++; }

  console.log(`${r.date}  ${String(wall).padStart(6)}  ${sO.toFixed(0).padStart(7)}  ${sC.toFixed(0).padStart(8)}  ${openD.toFixed(0).padStart(5)}  ${closeD.toFixed(0).padStart(6)}  ${side.padEnd(7)}  ${app ? "  yes " : "   -  "}  ${app ? (rej ? "REJECT" : "broke ") : "  -   "}`);
}

console.log(`\n=== TEST 1: Gamma pin (${days} days) ===`);
console.log(`Avg distance to wall — open: ${(sumOpen/days).toFixed(1)}pt  →  close: ${(sumClose/days).toFixed(1)}pt`);
console.log(`Days spot pulled TOWARD wall by close: ${pulled}/${days} (${(100*pulled/days).toFixed(0)}%)`);
console.log(`\n=== TEST 2: Wall as resistance/support ===`);
console.log(`Days spot approached the wall (±${TOL}pt): ${approached}/${days}`);
console.log(`Of those, rejected (didn't break through): ${rejected}/${approached} (${approached ? (100*rejected/approached).toFixed(0)+'%' : '-'})`);
await pool.end();
