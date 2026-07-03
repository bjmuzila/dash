#!/usr/bin/env node
/* Do the top-GEX strike and top-VEX strike sit at the same level, and does
 * price hit that level? Uses per-strike greek_snapshots (SPX).
 *
 * Per day: take the FIRST snapshot ts (reference, near open). The top-GEX strike
 * = strike with max |gamma_net|; top-VEX strike = max |vanna_net|. "Aligned" =
 * same strike (within TOL points). "Hit" = spot reaches that strike at any later
 * snapshot the same day (strike within [min,max] of subsequent spot).
 *
 * Run on VPS via the dashboard container (has pg + DATABASE_URL):
 *   docker exec -i dashboard-dashboard-1 node - < scripts/backtest-gex-vex-level.mjs
 */
import pg from "pg";
const TOL = Number(process.env.TOL ?? 5);   // strikes within this many points count as "same level"
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const { rows } = await pool.query(
  `SELECT date, ts, strike, spot, gamma_net, vanna_net
   FROM greek_snapshots WHERE symbol='SPX' AND spot > 0
   ORDER BY date, ts, strike`
);
if (!rows.length) { console.log("No greek_snapshots rows found."); await pool.end(); process.exit(0); }

// group -> date -> ts(iso) -> [{strike,spot,gamma,vanna}]
const byDate = new Map();
for (const r of rows) {
  const t = new Date(r.ts).getTime();
  if (!byDate.has(r.date)) byDate.set(r.date, new Map());
  const snaps = byDate.get(r.date);
  if (!snaps.has(t)) snaps.set(t, []);
  snaps.get(t).push({ strike: +r.strike, spot: +r.spot, g: +r.gamma_net, v: +r.vanna_net });
}

const topBy = (arr, key) => arr.reduce((b, x) => Math.abs(x[key]) > Math.abs(b[key]) ? x : b, arr[0]);

let days = 0, aligned = 0, gexHit = 0, vexHit = 0, alignHit = 0;
console.log(`date        topGEX   topVEX   aligned  gexHit  vexHit`);
for (const [date, snaps] of byDate) {
  const times = [...snaps.keys()].sort((a, b) => a - b);
  if (times.length < 2) continue;                 // need a reference + later prints to test a hit
  const ref = snaps.get(times[0]);
  const gStrike = topBy(ref, "g").strike;
  const vStrike = topBy(ref, "v").strike;
  const later = times.slice(1).flatMap(t => snaps.get(t).map(x => x.spot));
  const lo = Math.min(...later), hi = Math.max(...later);
  const isAligned = Math.abs(gStrike - vStrike) <= TOL;
  const gHit = gStrike >= lo - TOL && gStrike <= hi + TOL;
  const vHit = vStrike >= lo - TOL && vStrike <= hi + TOL;
  days++; if (isAligned) aligned++; if (gHit) gexHit++; if (vHit) vexHit++;
  if (isAligned && gHit) alignHit++;
  console.log(`${date}  ${String(gStrike).padStart(7)}  ${String(vStrike).padStart(7)}  ${isAligned ? "  YES  " : "   no  "}  ${gHit ? " HIT " : "  -  "}  ${vHit ? " HIT " : "  -  "}`);
}

const pct = (n) => days ? (100 * n / days).toFixed(0) + "%" : "-";
console.log(`\nDays: ${days} | tol ±${TOL}pt`);
console.log(`Top GEX & VEX at same level: ${aligned}/${days} (${pct(aligned)})`);
console.log(`Top-GEX level hit same day:  ${gexHit}/${days} (${pct(gexHit)})`);
console.log(`Top-VEX level hit same day:  ${vexHit}/${days} (${pct(vexHit)})`);
console.log(`When aligned, level hit:     ${alignHit}/${aligned} (${aligned ? (100*alignHit/aligned).toFixed(0)+'%' : '-'})`);
await pool.end();
