/**
 * scripts/adjust-splits.mjs — back-adjust an existing CSV for stock splits.
 *
 *   node scripts/adjust-splits.mjs --in public/data/NVDA_daily.csv          # dry run
 *   node scripts/adjust-splits.mjs --in public/data/NVDA_daily.csv --write  # do it
 *
 * Dry-run by default: it prints what it FOUND and what it WOULD do, and writes
 * nothing. Silently rewriting someone's price data on first invocation is how
 * you end up unable to reproduce a result.
 *
 * Writes <name>.raw.csv alongside as a backup before overwriting.
 */

import fs from "node:fs";
import { detectSplits, applySplits, reportSplits } from "./lib/splits.mjs";

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const IN = arg("in");
const WRITE = argv.includes("--write");
if (!IN) { console.error("usage: node scripts/adjust-splits.mjs --in <csv> [--write]"); process.exit(1); }

const lines = fs.readFileSync(IN, "utf8").trim().split(/\r?\n/);
const bars = lines.map((l) => {
  const p = l.split(",");
  return { stamp: p[0], date: p[0].slice(0, 8), o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] || 0 };
}).filter((b) => b.c > 0);

console.error(`${IN}\n  ${bars.length.toLocaleString()} bars  ${bars[0].date} → ${bars[bars.length - 1].date}`);
console.error(`  first close ${bars[0].c}   last close ${bars[bars.length - 1].c}\n`);

const splits = detectSplits(bars);
reportSplits(splits);

const live = splits.filter((s) => s.ratio);
if (!live.length) { console.error(`\nnothing to do.`); process.exit(0); }

const before = bars[0].c;
const n = applySplits(bars, splits);
console.error(`\n  ${n.toLocaleString()} bars rescaled`);
console.error(`  first close ${before} → ${bars[0].c.toFixed(4)}  (÷${(before / bars[0].c).toFixed(1)})`);

// Re-detect on the adjusted series: if any split survives, the adjustment
// didn't take and something is wrong with the ratios.
const left = detectSplits(bars).filter((s) => s.ratio);
console.error(left.length
  ? `  ⚠ ${left.length} split-shaped jump(s) REMAIN — adjustment incomplete.`
  : `  ✓ no split-shaped jumps remain`);

if (!WRITE) { console.error(`\nDRY RUN — re-run with --write to apply.`); process.exit(0); }

const backup = IN.replace(/\.csv$/, ".raw.csv");
if (!fs.existsSync(backup)) { fs.copyFileSync(IN, backup); console.error(`\n  backup → ${backup}`); }

const dp = (x) => (Math.abs(x) < 1 ? x.toFixed(6) : x.toFixed(4));
fs.writeFileSync(IN, bars.map((b) => `${b.stamp},${dp(b.o)},${dp(b.h)},${dp(b.l)},${dp(b.c)},${Math.round(b.v)}`).join("\n") + "\n");
console.error(`  wrote ${IN}`);
