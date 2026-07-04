#!/usr/bin/env node
/* Does the SIZE of the MVC (its $B net-GEX magnitude) relate to whether the
 * level gets touched, and once touched, held vs broken?
 *
 * Join: confidence_log (graded outcome per level/day) -> mvc_snapshots (the MVC
 * size at that strike that day). Size = MAX |mvcValueOIVol| among snapshots whose
 * strike is within TOL of the graded level. Then bucket by size tercile.
 *
 * Run on VPS:  docker exec -i dashboard-dashboard-1 node - < scripts/backtest-mvc-size.mjs
 */
import pg from "pg";
const TOL = Number(process.env.TOL ?? 10);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const { rows } = await pool.query(`
  SELECT c.date, c.level, c.touched, c.held, c.broke,
         MAX(ABS(m."mvcValueOIVol")) AS size_b,
         MAX(m."pctOI_Vol")          AS pct
  FROM confidence_log c
  JOIN mvc_snapshots m
    ON m.date = c.date AND ABS(m."strikeOIVol" - c.level) <= ${TOL}
  WHERE c.graded_at IS NOT NULL AND c.level > 0
  GROUP BY c.date, c.level, c.touched, c.held, c.broke
  ORDER BY c.date
`);
if (rows.length < 3) { console.log(`Only ${rows.length} matched rows — not enough to bucket.`); await pool.end(); process.exit(0); }

// UNIT FIX: mvcValueOIVol is stored in $B by import-mvc.js but in RAW dollars by
// auto-snapshot-mvc.js. Normalize: anything > 1e5 is raw dollars -> divide to $B.
const toB = v => Math.abs(v) > 1e5 ? Math.abs(v) / 1e9 : Math.abs(v);
const data = rows.map(r => ({
  date: r.date, size: toB(+r.size_b), pct: r.pct == null ? null : +r.pct,
  touched: !!r.touched, held: !!r.held, broke: !!r.broke,
})).filter(d => Number.isFinite(d.size));

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const rate = (a, f) => a.length ? (100 * a.filter(f).length / a.length).toFixed(0) + "%" : "-";

console.log(`date        level   size($B)   pct%   touched  outcome`);
for (const d of data) {
  console.log(`${d.date}  ${"".padStart(0)}${String(Math.round(rows.find(r=>r.date===d.date).level)).padStart(5)}   ${d.size.toFixed(1).padStart(7)}   ${(d.pct==null?"-":d.pct.toFixed(0)).padStart(4)}   ${d.touched?" yes":"  no"}     ${d.touched?(d.held?"held":"broke"):"-"}`);
}

// Terciles by size
const sorted = [...data].sort((a, b) => a.size - b.size);
const t1 = sorted[Math.floor(sorted.length / 3)].size;
const t2 = sorted[Math.floor(2 * sorted.length / 3)].size;
const bucket = d => d.size <= t1 ? 0 : d.size <= t2 ? 1 : 2;
const labels = [`small (≤${t1.toFixed(1)}B)`, `mid`, `large (>${t2.toFixed(1)}B)`];

console.log(`\n=== MVC size vs touch/hold (${data.length} levels) ===`);
console.log(`bucket            n   touched   of touched: held   broke`);
for (let b = 0; b < 3; b++) {
  const g = data.filter(d => bucket(d) === b);
  const tt = g.filter(d => d.touched);
  console.log(`${labels[b].padEnd(16)} ${String(g.length).padStart(2)}   ${rate(g, d=>d.touched).padStart(5)}     held ${rate(tt, d=>d.held).padStart(4)}   broke ${rate(tt, d=>d.broke).padStart(4)}`);
}

// Simple correlation: avg size for touched vs missed, held vs broke
const touched = data.filter(d => d.touched), missed = data.filter(d => !d.touched);
console.log(`\nAvg MVC size — touched: ${mean(touched.map(d=>d.size)).toFixed(1)}B   missed: ${mean(missed.map(d=>d.size)).toFixed(1)}B`);
const held = touched.filter(d=>d.held), broke = touched.filter(d=>d.broke);
console.log(`Avg MVC size — held: ${mean(held.map(d=>d.size)).toFixed(1)}B   broke: ${mean(broke.map(d=>d.size)).toFixed(1)}B`);

// pct% view (unit-independent concentration measure)
const withPct = data.filter(d => d.pct != null && Number.isFinite(d.pct));
if (withPct.length >= 6) {
  const s = [...withPct].sort((a,b)=>a.pct-b.pct);
  const p1 = s[Math.floor(s.length/3)].pct, p2 = s[Math.floor(2*s.length/3)].pct;
  const pb = d => d.pct <= p1 ? 0 : d.pct <= p2 ? 1 : 2;
  const plab = [`low  (≤${p1.toFixed(0)}%)`, `mid`, `high (>${p2.toFixed(0)}%)`];
  console.log(`\n=== MVC concentration (pct%) vs touch/hold (${withPct.length} levels) ===`);
  console.log(`bucket            n   touched   of touched: held`);
  for (let b=0;b<3;b++){ const g=withPct.filter(d=>pb(d)===b); const tt=g.filter(d=>d.touched);
    console.log(`${plab[b].padEnd(16)} ${String(g.length).padStart(2)}   ${rate(g,d=>d.touched).padStart(5)}     held ${rate(tt,d=>d.held).padStart(4)}`); }
}
await pool.end();
