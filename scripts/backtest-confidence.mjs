#!/usr/bin/env node
/* Is the MVC confidence score calibrated? Uses confidence_log: predicted
 * reach/pivot/chop/break probabilities vs graded touched/held/broke outcomes.
 * One row per day.
 *
 * Calibration = does "we said 70% reach" actually reach ~70% of the time.
 *   REACH : predicted reach%          vs actual touched rate (all days)
 *   HOLD  : predicted pivot+chop%      vs actual held rate   (given touched)
 *   BREAK : predicted break%           vs actual broke rate  (given touched)
 *
 * Run on VPS:  docker exec -i dashboard-dashboard-1 node - < scripts/backtest-confidence.mjs
 */
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const { rows } = await pool.query(
  `SELECT date, level, regime, reach, pivot, chop, "break" AS brk,
          touched, held, broke, actual_outcome
   FROM confidence_log WHERE graded_at IS NOT NULL ORDER BY date`
);
if (!rows.length) { console.log("No graded confidence_log rows yet."); await pool.end(); process.exit(0); }

// Normalize predictions to 0..1 (columns may be stored 0-100 or 0-1).
const maxReach = Math.max(...rows.map(r => +r.reach || 0));
const scale = maxReach > 1.5 ? 100 : 1;
const P = (v) => (+v || 0) / scale;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const pctErr = (pred, act) => `pred ${(100*pred).toFixed(0)}%  actual ${(100*act).toFixed(0)}%  (gap ${((pred-act)*100>=0?"+":"")}${((pred-act)*100).toFixed(0)}pt)`;

console.log(`date        level  regime   reach  →touched   pred-hold →held    outcome`);
for (const r of rows) {
  const hold = P(r.pivot) + P(r.chop);
  console.log(`${r.date}  ${String(Math.round(+r.level)).padStart(5)}  ${(r.regime||"-").padEnd(7)}  ${(100*P(r.reach)).toFixed(0).padStart(4)}%  ${r.touched? " reached":" missed "}   ${(100*hold).toFixed(0).padStart(6)}%  ${r.touched?(r.held?" held":" broke"):"  -  "}   ${r.actual_outcome||"-"}`);
}

const N = rows.length;
const touched = rows.filter(r => r.touched);
console.log(`\n=== Calibration (${N} graded days, ${touched.length} touched) ===`);
console.log(`REACH:  ${pctErr(mean(rows.map(r => P(r.reach))), mean(rows.map(r => r.touched ? 1 : 0)))}`);
if (touched.length) {
  console.log(`HOLD :  ${pctErr(mean(touched.map(r => P(r.pivot) + P(r.chop))), mean(touched.map(r => r.held ? 1 : 0)))}   (given touched)`);
  console.log(`BREAK:  ${pctErr(mean(touched.map(r => P(r.brk))), mean(touched.map(r => r.broke ? 1 : 0)))}   (given touched)`);
}

// Reach calibration by predicted-probability bucket.
console.log(`\nReach by predicted bucket:`);
const buckets = [[0,0.4,"low  <40%"],[0.4,0.7,"mid 40-70%"],[0.7,1.01,"high >70%"]];
for (const [lo, hi, lbl] of buckets) {
  const g = rows.filter(r => P(r.reach) >= lo && P(r.reach) < hi);
  if (!g.length) { console.log(`  ${lbl}:  (none)`); continue; }
  console.log(`  ${lbl}:  n=${String(g.length).padStart(2)}  actual reached ${(100*mean(g.map(r=>r.touched?1:0))).toFixed(0)}%`);
}
await pool.end();
