#!/usr/bin/env node
/* Backtest the /greeks DEX pre-flip alert against historical greeks_ts.
 *
 * Framework (mirrors app/greeks buildSignals):
 *   - Bucket each day's SPXW DEX series into 5-min buckets (avg + range).
 *   - Fire a "pre-flip" alert on a bucket when:
 *       bucketRange >= MULT * (avg of the prior 3 buckets' ranges)   [range expansion]
 *       AND |bucketAvg - priorWindowAvg| < priorWindowRange          [avg stalls]
 *   - Count it a HIT if within LOOK_MIN minutes AFTER the alert the DEX
 *     avg moves by >= HIT_MULT * priorWindowRange (the expansion delivered),
 *     or crosses the zero-line (a flip). Otherwise a false positive.
 *
 * Run on the VPS through the dashboard container (has pg + DATABASE_URL):
 *   docker exec -i dashboard-dashboard-1 node - < scripts/backtest-dex-preflip.mjs
 * or copy in and:  docker exec -i dashboard-dashboard-1 node /app/scripts/backtest-dex-preflip.mjs
 */
import pg from "pg";

const LOOK_MIN  = Number(process.env.LOOK_MIN  ?? 20);   // window after alert to look for the move
const HIT_ABS   = Number(process.env.HIT_ABS   ?? 50);   // hit = DEX avg moves >= this many $B, or flips
const MIN_PRANGE= Number(process.env.MIN_PRANGE?? 5);    // skip alert if prior avg range < this ($B) — kills frozen-DEX artifacts
const MULTS     = [2, 3];                                // alert thresholds to compare
const BUCKET_MS = 5 * 60_000;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const rng  = a => Math.max(...a) - Math.min(...a);

function bucketsForDay(rows) {
  // rows: {ts, dex} sorted asc. Group into fixed 5-min buckets keyed off day start.
  const byBucket = new Map();
  for (const r of rows) {
    const k = Math.floor(r.ts / BUCKET_MS);
    if (!byBucket.has(k)) byBucket.set(k, []);
    byBucket.get(k).push(r.dex);
  }
  return [...byBucket.entries()].sort((a, b) => a[0] - b[0]).map(([k, vals]) => ({
    ts: k * BUCKET_MS, avg: mean(vals), range: rng(vals), lo: Math.min(...vals), hi: Math.max(...vals),
  }));
}

function backtestDay(buckets, mult) {
  const alerts = [];
  for (let i = 3; i < buckets.length; i++) {
    const b = buckets[i];
    const prior = buckets.slice(i - 3, i);              // prior 15 min
    const priAvgRange = mean(prior.map(p => p.range)) || 1e-9;
    const priWinRange = rng(prior.flatMap(p => [p.lo, p.hi])) || 1e-9;
    const priWinAvg   = mean(prior.map(p => p.avg));
    const expansion = b.range >= mult * priAvgRange;
    const stall     = Math.abs(b.avg - priWinAvg) < priWinRange;
    if (priAvgRange < MIN_PRANGE) continue;   // ignore frozen/thin prior windows (garbage multiples)
    if (!(expansion && stall)) continue;

    // outcome: look forward LOOK_MIN — hit = big absolute DEX move or a zero-line flip
    const fwd = buckets.filter(x => x.ts > b.ts && x.ts <= b.ts + LOOK_MIN * 60_000);
    let hit = false, flip = false, maxMove = 0;
    for (const f of fwd) {
      const mv = Math.abs(f.avg - b.avg);
      maxMove = Math.max(maxMove, mv);
      if (mv >= HIT_ABS) hit = true;
      if (Math.sign(f.avg) !== 0 && Math.sign(b.avg) !== 0 && Math.sign(f.avg) !== Math.sign(b.avg)) flip = true;
    }
    alerts.push({ ts: b.ts, rangeMult: b.range / priAvgRange, hit: hit || flip, flip, maxMove });
  }
  return alerts;
}

const { rows } = await pool.query(
  `SELECT date, time, timestamp AS ts, dex FROM greeks_ts
   WHERE ticker='SPXW' AND dex IS NOT NULL
     AND "time" >= '09:30' AND "time" < '16:00'   -- RTH only (ET)
   ORDER BY date, timestamp ASC`
);
const byDate = new Map();
for (const r of rows) {
  if (!byDate.has(r.date)) byDate.set(r.date, []);
  byDate.get(r.date).push({ ts: Number(r.ts), dex: Number(r.dex) });
}

// ── Debug one day: DEBUG_DATE=2026-07-02 dumps every 5-min bucket + alert/outcome ──
const DEBUG_DATE = process.env.DEBUG_DATE;
if (DEBUG_DATE && byDate.has(DEBUG_DATE)) {
  const bkts = bucketsForDay(byDate.get(DEBUG_DATE));
  const et = ms => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false });
  const fired2 = new Set(backtestDay(bkts, 2).map(a => a.ts));
  const scored = new Map(backtestDay(bkts, 2).map(a => [a.ts, a]));
  console.log(`\nDEBUG ${DEBUG_DATE} (RTH 5-min buckets):`);
  console.log("time     avg      range    rangeMult  ALERT(2x)  outcome");
  for (let i = 0; i < bkts.length; i++) {
    const b = bkts[i];
    let mult = "";
    if (i >= 3) mult = (b.range / (mean(bkts.slice(i - 3, i).map(p => p.range)) || 1e-9)).toFixed(2) + "x";
    const a = scored.get(b.ts);
    const tag = fired2.has(b.ts) ? "  ►ALERT" : "";
    const out = a ? (a.flip ? " → FLIP" : a.hit ? ` → hit (mv ${a.maxMove.toFixed(1)})` : ` → miss (mv ${a.maxMove.toFixed(1)})`) : "";
    console.log(`${et(b.ts)} ${b.avg.toFixed(2).padStart(8)} ${b.range.toFixed(2).padStart(8)} ${mult.padStart(9)}${tag}${out}`);
  }
  await pool.end();
  process.exit(0);
}

console.log(`Days: ${byDate.size} | look-ahead: ${LOOK_MIN}m | hit = |ΔDEX| >= $${HIT_ABS}B or flip | min prior range $${MIN_PRANGE}B\n`);

// ── LIST=1: every 2x alert across all days with outcome ──
if (process.env.LIST) {
  const et = ms => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false });
  console.log("2x alerts (all days):");
  console.log("date        time      rangeMult  outcome");
  for (const [date, day] of byDate) {
    for (const a of backtestDay(bucketsForDay(day), 2)) {
      const out = a.flip ? "FLIP" : a.hit ? `hit  (mv ${a.maxMove.toFixed(1)})` : `miss (mv ${a.maxMove.toFixed(1)})`;
      console.log(`${date}  ${et(a.ts)}  ${(a.rangeMult.toFixed(2)+"x").padStart(8)}  ${out}`);
    }
  }
  console.log("");
}

const etHour = ms => Number(new Date(ms).toLocaleString("en-GB", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).slice(0, 2));

// EDGES=1 keeps only first 2h (09:30–11:30) and last 2h (14:00–16:00) of RTH.
const etMins = ms => { const s = new Date(ms).toLocaleString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }); return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)); };
const inEdges = ms => { const m = etMins(ms); return (m >= 570 && m < 690) || (m >= 840 && m < 960); };
const keep = ms => !process.env.EDGES || inEdges(ms);

for (const mult of MULTS) {
  let total = 0, hits = 0, flips = 0;
  const byHour = new Map(); // hr -> {n, h}
  for (const day of byDate.values()) {
    const a = backtestDay(bucketsForDay(day), mult).filter(x => keep(x.ts));
    total += a.length; hits += a.filter(x => x.hit).length; flips += a.filter(x => x.flip).length;
    for (const x of a) {
      const hr = etHour(x.ts);
      const e = byHour.get(hr) ?? { n: 0, h: 0 };
      e.n++; if (x.hit) e.h++;
      byHour.set(hr, e);
    }
  }
  const rate = total ? (100 * hits / total).toFixed(1) : "0.0";
  const fp   = total ? (100 * (total - hits) / total).toFixed(1) : "0.0";
  console.log(`${mult}x threshold:  alerts=${total}  hits=${hits} (${rate}%)  false=${total - hits} (${fp}%)  flips=${flips}`);
  console.log(`   by ET hour:`);
  for (const hr of [...byHour.keys()].sort((a, b) => a - b)) {
    const e = byHour.get(hr);
    console.log(`     ${String(hr).padStart(2, "0")}:00   alerts=${String(e.n).padStart(2)}  hits=${e.h}  (${(100 * e.h / e.n).toFixed(0)}%)`);
  }
}
await pool.end();
