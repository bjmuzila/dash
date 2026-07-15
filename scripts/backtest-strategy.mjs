/**
 * scripts/backtest-strategy.mjs
 *
 * Replay any spec-defined strategy against a raw 1-minute CSV and report the
 * excursion distributions, suggested exits, and a walk-forward split.
 *
 *   node scripts/backtest-strategy.mjs --spec scripts/strategies/bb-fade-3m.json \
 *        --in "C:\path\to\ES_1min.csv"
 *
 * FLAGS
 *   --spec <path>       strategy JSON (required)
 *   --in <path>         raw 1-minute CSV (required) — same format as build-bar-stats.mjs:
 *                          YYYYMMDD HHMMSS,open,high,low,close,volume
 *   --horizon <min>     excursion horizon for exit fitting (default 20)
 *   --tp <pts>          override TP and just score it
 *   --sl <pts>          override SL and just score it
 *   --json              emit machine-readable output instead of the table
 *
 * READ THE OUTPUT IN THIS ORDER:
 *   1. n — under ~200 trades, nothing below it means anything.
 *   2. The MFE/MAE curve — this is the real product. It shows you where the move
 *      is done. A flat median-MFE curve past 10m means there is no trend to ride.
 *   3. OUT-OF-SAMPLE expectancy. Not win rate, not the in-sample column.
 *      Expectancy <= 0 out-of-sample = the strategy does not work. Ship that
 *      verdict to the customer honestly; it is the whole value of the feature.
 */

import fs from "node:fs";
import engine from "../server-v2/strategy-engine.js";

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const SPEC_PATH = arg("spec");
const IN = arg("in");
const HORIZON = +arg("horizon", 20);
const TP = arg("tp") != null ? +arg("tp") : null;
const SL = arg("sl") != null ? +arg("sl") : null;
const AS_JSON = argv.includes("--json");

if (!SPEC_PATH || !IN) {
  console.error("usage: node scripts/backtest-strategy.mjs --spec <spec.json> --in <1min.csv>");
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
console.error(`reading ${IN} ...`);
const text = fs.readFileSync(IN, "utf8");
const rows = engine.parseCsv(text);
if (!rows.length) {
  console.error("no bars parsed — check the CSV format (YYYYMMDD HHMMSS,o,h,l,c,v)");
  process.exit(1);
}

const spanD = [...new Set(rows.map((r) => r.date))];
console.error(`parsed ${rows.length.toLocaleString()} 1m bars over ${spanD.length} sessions (${spanD[0]} → ${spanD[spanD.length - 1]})`);

const isPattern = spec.engine === "pattern";
const { bars, trades, tf, diag } = isPattern
  ? engine.runPattern(rows, spec)
  : engine.runStrategy(rows, spec);
console.error(`resampled → ${bars.length.toLocaleString()} ${tf}m bars; ${trades.length} signals\n`);

if (!trades.length) {
  console.error("zero signals — loosen the spec or check the band/offset logic.");
  process.exit(0);
}

const fitted = TP != null || SL != null
  ? { tp: TP, sl: SL, horizonMin: HORIZON, curve: engine.suggestExits(trades, { horizonMin: HORIZON }).curve }
  : engine.suggestExits(trades, { horizonMin: HORIZON });

const scoredAll = engine.applyExits(trades, fitted.tp, fitted.sl, HORIZON);
const inSample = engine.summarize(scoredAll);
const wf = engine.walkForward(trades, { horizonMin: HORIZON });

if (AS_JSON) {
  console.log(JSON.stringify({ spec: spec.id, tf, n: trades.length, fitted, inSample, walkForward: wf }, null, 2));
  process.exit(0);
}

const f = (x, d = 2) => (x == null ? "—" : (+x).toFixed(d));
const bar = "─".repeat(64);

console.log(bar);
console.log(`${spec.name || spec.id}   [${spec.symbol} ${tf}m ${spec.side} ${spec.session || "RTH"}]`);
console.log(bar);

console.log(`\nSIGNALS  ${trades.length}   over ${[...new Set(trades.map((t) => t.date))].length} sessions`);
if (trades.length < 200) {
  console.log(`  ⚠ under 200 trades — treat every number below as directional, not decisive.`);
}

console.log(`\nEXCURSION CURVE (points, median across all signals)`);
console.log(`  ${"min".padStart(5)} ${"medMFE".padStart(8)} ${"p75MFE".padStart(8)} ${"medMAE".padStart(8)}`);
for (const c of fitted.curve || []) {
  console.log(`  ${String(c.min).padStart(5)} ${f(c.medMfe).padStart(8)} ${f(c.p75Mfe).padStart(8)} ${f(c.medMae).padStart(8)}`);
}
console.log(`  → find where medMFE stops climbing. That plateau is your TP ceiling.`);
console.log(`     If it never climbs, there is no move to capture and no TP will save it.`);

console.log(`\nSUGGESTED EXITS  @ ${HORIZON}m horizon`);
if (fitted.tp == null) {
  console.log(`  ✗ ${fitted.note}`);
  console.log(`\n${bar}`);
  process.exit(0);
}
console.log(`  TP ${f(fitted.tp)} pts     SL ${f(fitted.sl)} pts     R:R ${f(fitted.tp / fitted.sl)}`);
console.log(`  (SL = 85th pct MAE of trades that worked; TP = median MFE of the same.`);
console.log(`   Derived from the distribution — NOT searched for the best win rate.)`);
if (fitted.note) console.log(`  ⚠ ${fitted.note}`);

console.log(`\nIN-SAMPLE  (fitted and scored on the same data — DO NOT SHIP THIS NUMBER)`);
console.log(`  n ${inSample.n}   win ${f(inSample.winRate * 100, 1)}%   expectancy ${f(inSample.expectancy)} R`);

if (wf) {
  console.log(`\nWALK-FORWARD  (exits fit on sessions < ${wf.cutDate}, scored after)`);
  console.log(`  ${"".padEnd(10)} ${"n".padStart(6)} ${"win%".padStart(8)} ${"expectancy".padStart(12)}`);
  console.log(`  ${"train".padEnd(10)} ${String(wf.train.n).padStart(6)} ${f(wf.train.winRate * 100, 1).padStart(8)} ${f(wf.train.expectancy).padStart(12)}`);
  console.log(`  ${"TEST".padEnd(10)} ${String(wf.test.n).padStart(6)} ${f(wf.test.winRate * 100, 1).padStart(8)} ${f(wf.test.expectancy).padStart(12)}  ← the only honest column`);
  const drop = wf.train.expectancy - wf.test.expectancy;
  if (wf.test.expectancy <= 0) {
    console.log(`\n  ✗ VERDICT: out-of-sample expectancy is ${f(wf.test.expectancy)} R. This strategy does not work.`);
  } else if (drop > Math.abs(wf.train.expectancy) * 0.5) {
    console.log(`\n  ⚠ VERDICT: expectancy fell ${f(drop)} R out-of-sample — heavily curve-fit. Do not trust the train column.`);
  } else {
    console.log(`\n  ✓ Holds out-of-sample. Next: split by regime before believing it's tradeable.`);
  }
} else {
  console.log(`\n  (too few sessions to split walk-forward — no out-of-sample verdict possible)`);
}
console.log(`\n${bar}`);
