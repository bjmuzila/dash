/**
 * scripts/streaks.mjs
 *
 * "How many up bars until a down bar?" — answered honestly.
 *
 *   node scripts/streaks.mjs --in public/data/NVDA_daily.csv --daily
 *   node scripts/streaks.mjs --in public/data/NVDA_1min.csv --tf 3
 *
 * FLAGS
 *   --in <path>     CSV: YYYYMMDD HHMMSS,o,h,l,c,v
 *   --daily         one bar per row (no resampling, no session grouping)
 *   --tf <min>      intraday timeframe to resample to (ignored with --daily)
 *   --json          machine-readable
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE OBVIOUS VERSION OF THIS STUDY IS WRONG
 *
 * The tempting output is "NVDA averages 2.4 up days before a down day." That
 * number is worthless, for two reasons:
 *
 * 1. DRIFT. NVDA compounded ~30x over this period, so P(up bar) is structurally
 *    well above 50%. Long runs follow automatically. Comparing observed run
 *    lengths to a fair coin (0.5^k) "discovers" momentum that is nothing but the
 *    stock going up. The correct null is the asset's OWN base rate p, and the
 *    only question worth asking is:
 *
 *        does P(up | k prior up bars) differ from p ?
 *
 *    Flat across k ⇒ streaks carry no information (this is the usual answer).
 *    Falling in k ⇒ exhaustion. Rising in k ⇒ momentum.
 *
 * 2. SURVIVORSHIP / SAMPLE COLLAPSE. Counts fall off a cliff as k grows: at
 *    p≈0.53 you have ~1400 samples at k=1 and ~50 by k=6. "After 7 up days it
 *    reverses 71% of the time" is 7 observations. Every k gets a Wilson 95% CI
 *    printed next to it, and any k whose CI contains the base rate is telling
 *    you nothing.
 *
 * Also: the base rate is computed PER YEAR as well as pooled. NVDA 2015-2026 is
 * not one regime — it's a melt-up with two splits and several -50% drawdowns. A
 * pooled p hides that.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from "node:fs";
import engine from "../server-v2/strategy-engine.js";

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const IN = arg("in");
const DAILY = argv.includes("--daily");
const TF = +arg("tf", 3);
const AS_JSON = argv.includes("--json");

if (!IN) { console.error("usage: node scripts/streaks.mjs --in <csv> [--daily | --tf 3]"); process.exit(1); }

const rows = engine.parseCsv(fs.readFileSync(IN, "utf8"));
if (!rows.length) { console.error("no bars parsed"); process.exit(1); }

/* ── build the bar series ─────────────────────────────────────────────────── */
// Daily: one bar per row, and the series is CONTINUOUS across days — an up bar
// is close>prev close over the overnight gap, which is the whole point.
// Intraday: resample, and NEVER let a run span the overnight gap (that's a
// different animal and would silently inflate every count).
let series; // array of {date, bars:[...]} — "sessions" for streak purposes
if (DAILY) {
  series = [{ date: "all", bars: rows.sort((a, b) => (a.date < b.date ? -1 : 1)) }];
} else {
  const bars = engine.resample(rows, TF, { session: "RTH" });
  const byDay = new Map();
  for (const b of bars) { if (!byDay.has(b.date)) byDay.set(b.date, []); byDay.get(b.date).push(b); }
  series = [...byDay.entries()].sort().map(([date, bars]) => ({ date, bars }));
}

/* ── base rate ────────────────────────────────────────────────────────────── */
// An "up bar" = close > previous close. Flat closes (close == prev) are their
// own category and are EXCLUDED from both numerator and denominator — folding
// them into "down" would fake an exhaustion effect that is really just ties.
let up = 0, down = 0, flat = 0;
const byYear = new Map();
for (const s of series) {
  for (let i = 1; i < s.bars.length; i++) {
    const d = s.bars[i].c - s.bars[i - 1].c;
    const y = s.bars[i].date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, { up: 0, down: 0 });
    if (d > 0) { up++; byYear.get(y).up++; }
    else if (d < 0) { down++; byYear.get(y).down++; }
    else flat++;
  }
}
const p = up / (up + down); // THE NULL. Not 0.5.

/* ── P(up | k prior up bars) ──────────────────────────────────────────────── */
const cont = new Map(); // k → {cont, n}
for (const s of series) {
  let run = 0;
  for (let i = 1; i < s.bars.length; i++) {
    const d = s.bars[i].c - s.bars[i - 1].c;
    if (d === 0) { run = 0; continue; } // tie breaks the run, counted nowhere
    const isUp = d > 0;
    if (run > 0) {
      if (!cont.has(run)) cont.set(run, { cont: 0, n: 0 });
      const c = cont.get(run);
      c.n++;
      if (isUp) c.cont++;
    }
    run = isUp ? run + 1 : 0;
  }
}

/* ── run-length distribution (the literal question asked) ─────────────────── */
const runLens = [];
for (const s of series) {
  let run = 0;
  for (let i = 1; i < s.bars.length; i++) {
    const d = s.bars[i].c - s.bars[i - 1].c;
    if (d > 0) run++;
    else if (d < 0) { if (run > 0) runLens.push(run); run = 0; }
  }
}
const dist = new Map();
for (const r of runLens) dist.set(r, (dist.get(r) || 0) + 1);

/** Wilson 95% interval — correct at small n, unlike the normal approximation. */
function wilson(k, n) {
  if (!n) return [0, 1];
  const z = 1.96, ph = k / n, d = 1 + z * z / n;
  const c = (ph + z * z / (2 * n)) / d;
  const m = (z * Math.sqrt((ph * (1 - ph) + z * z / (4 * n)) / n)) / d;
  return [c - m, c + m];
}

if (AS_JSON) {
  console.log(JSON.stringify({
    n: up + down, p, up, down, flat,
    byYear: Object.fromEntries([...byYear].map(([y, v]) => [y, v.up / (v.up + v.down)])),
    continuation: [...cont].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ k, ...v, rate: v.cont / v.n })),
    runLengths: Object.fromEntries([...dist].sort((a, b) => a[0] - b[0])),
  }, null, 2));
  process.exit(0);
}

const f = (x, d = 1) => (x == null ? "—" : (+x).toFixed(d));
const bar = "─".repeat(72);
console.log(bar);
console.log(`STREAKS  ${IN.split(/[/\\]/).pop()}   ${DAILY ? "DAILY bars" : `${TF}m bars, RTH`}`);
console.log(bar);

console.log(`\nBASE RATE  (an "up bar" = close > previous close)`);
console.log(`  ${(up + down).toLocaleString()} directional bars   up ${up.toLocaleString()}  down ${down.toLocaleString()}  ties ${flat} (excluded)`);
console.log(`  p(up) = ${f(p * 100, 2)}%   ← THIS is the null, not 50%.`);
console.log(`  A fair coin would give 50%. The gap is DRIFT, not edge.`);

console.log(`\n  by year:`);
const yrs = [...byYear].sort();
for (const [y, v] of yrs) {
  const n = v.up + v.down;
  if (n < 20) continue;
  const py = v.up / n;
  const bars = "█".repeat(Math.round(py * 40));
  console.log(`    ${y}  ${f(py * 100, 1).padStart(5)}%  n=${String(n).padStart(5)}  ${bars}`);
}
console.log(`  → if these swing a lot, a pooled p(up) is a fiction and so is everything below.`);

console.log(`\nRUN LENGTH  (consecutive up bars before a down bar) — the literal question`);
const totalRuns = runLens.length;
const mean = runLens.reduce((a, b) => a + b, 0) / (totalRuns || 1);
// A memoryless (coin-flip) series with this base rate gives E[L | L>=1] = 1/(1-p).
// This single comparison IS the answer to "how many up bars until a down bar" —
// everything below is just showing the shape.
const meanNull = 1 / (1 - p);
console.log(`  ${totalRuns.toLocaleString()} completed runs   mean ${f(mean, 2)}   median ${f(engine.pct(runLens, 0.5), 0)}   max ${Math.max(...runLens)}`);
console.log(`  a memoryless coin at p=${f(p * 100, 2)}% gives mean ${f(meanNull, 2)}  →  observed/null = ×${f(mean / meanNull, 3)}`);
console.log(`  ${"len".padStart(4)} ${"count".padStart(7)} ${"share".padStart(7)}   ${"vs geometric null".padStart(17)}`);
for (const [len, n] of [...dist].sort((a, b) => a[0] - b[0])) {
  if (len > 12) continue;
  const share = n / totalRuns;
  // Null: geometric, driven by the base rate. But we only ever RECORD runs of
  // length >= 1 (a run of 0 isn't a run), so the null must be CONDITIONED on
  // L>=1 too:
  //     P(L=k)         = p^k     * (1-p)      ... sums to 1 over k=0,1,2,...
  //     P(L>=1)        = p
  //     P(L=k | L>=1)  = p^(k-1) * (1-p)      ... sums to 1 over k=1,2,3,...
  // Using the unconditional form against a conditional sample inflates EVERY
  // ratio by 1/p (=1.84 here) — which looked like "runs are 2x more common than
  // chance" across the board. A uniform multiplier on every row is the
  // signature of a normalisation bug, never of a real effect.
  const exp = Math.pow(p, len - 1) * (1 - p);
  const ratio = share / exp;
  console.log(
    `  ${String(len).padStart(4)} ${String(n).padStart(7)} ${f(share * 100, 2).padStart(6)}%   ` +
    `exp ${f(exp * 100, 2).padStart(5)}%  ×${f(ratio, 2)}`
  );
}

console.log(`\nCONTINUATION  P(next bar up | k consecutive up bars)  ← the only thing that matters`);
console.log(`  ${"k".padStart(3)} ${"n".padStart(7)} ${"P(up)".padStart(7)}   ${"95% CI".padStart(15)}   verdict`);
for (const [k, v] of [...cont].sort((a, b) => a[0] - b[0])) {
  if (k > 10 || v.n < 5) continue;
  const rate = v.cont / v.n;
  const [lo, hi] = wilson(v.cont, v.n);
  // If the CI straddles the base rate, this k tells you NOTHING. Say so plainly
  // rather than letting a point estimate imply a finding.
  const informative = lo > p || hi < p;
  const verdict = !informative
    ? "— (CI contains base rate)"
    : rate > p ? "MOMENTUM" : "EXHAUSTION";
  console.log(
    `  ${String(k).padStart(3)} ${String(v.n).padStart(7)} ${f(rate * 100, 1).padStart(6)}%   ` +
    `[${f(lo * 100, 1)}, ${f(hi * 100, 1)}]`.padStart(15) + `   ${verdict}`
  );
}
console.log(`\n  Compare each row to p(up)=${f(p * 100, 2)}%, NOT to 50%.`);
console.log(`  Rows marked "—" are noise. With ~${Math.round(Math.log(0.05) / Math.log(p))} tests here, expect ~1 false`);
console.log(`  positive by chance alone — a lone flagged k with no trend across k is not a finding.`);
console.log(`\n${bar}`);
