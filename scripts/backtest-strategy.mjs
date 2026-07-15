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
// Round-turn cost in POINTS. ES default: 0.25 spread + ~0.08 commission ($4/RT
// ÷ $50/pt). Every number in this file was cost-free until now, i.e. optimistic.
// A strategy that clears zero gross and dies at 0.33 pts is not a strategy.
const COST = arg("cost") != null ? +arg("cost") : 0.33;
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
console.log(`COSTS    ${f(COST)} pts round-turn (--cost 0 to see gross)`);
if (trades.length < 200) {
  console.log(`  ⚠ under 200 trades — treat every number below as directional, not decisive.`);
}

if (diag) {
  console.log(`\nFUNNEL  (which gate ate the setups)`);
  console.log(`  penetrations       ${String(diag.setups).padStart(6)}`);
  console.log(`  → no reversal bar  ${String(diag.noReversal).padStart(6)}   (no opposite-colour candle in time)`);
  console.log(`  reversal found     ${String(diag.reversalFound).padStart(6)}`);
  console.log(`  → invalidated      ${String(diag.invalidated).padStart(6)}   (new low before trigger)`);
  console.log(`  → no trigger       ${String(diag.noTrigger).padStart(6)}   (never closed above reversal close)`);
  console.log(`  triggered          ${String(diag.triggered).padStart(6)}`);
  console.log(`  filled             ${String(diag.filled).padStart(6)}`);
}

if (isPattern && trades.length) {
  console.log(`\nSTRUCTURAL STOP  (reversal bar's low — the pattern's own risk, no fitting)`);
  const risks = trades.map((t) => t.structStop).filter((x) => x > 0);
  console.log(`  median ${f(engine.pct(risks, 0.5))} pts   p25 ${f(engine.pct(risks, 0.25))}   p75 ${f(engine.pct(risks, 0.75))}`);
  console.log(`  ${"".padEnd(5)} ${"win%".padStart(6)} ${"need".padStart(6)} ${"W".padStart(5)} ${"L".padStart(5)} ${"flat".padStart(5)} ${"exp R".padStart(7)} ${"ambig".padStart(6)} ${"optim".padStart(7)}`);
  let sym = null;
  for (const R of [1, 1.5, 2, 3]) {
    const scored = engine.scoreStructural(trades, R, HORIZON, COST);
    const s = engine.summarizeR(scored); // r is continuous now (timeouts mark to market)
    const amb = scored.filter((t) => t.ambiguous).length;
    const opt = engine.summarize(engine.scoreStructuralOptimistic(trades, R, HORIZON));
    if (R === 1) sym = s;
    const breakeven = 100 / (1 + R);
    const flag = s.expectancy > 0 ? "✓" : " ";
    console.log(
      `  ${flag}${String(R).padStart(3)}R ${f(s.winRate * 100, 1).padStart(6)} ${f(breakeven, 1).padStart(6)} ` +
      `${String(s.wins).padStart(5)} ${String(s.losses).padStart(5)} ${String(s.flat).padStart(5)} ${f(s.expectancy).padStart(7)} ` +
      `${String(amb).padStart(6)} ${f(opt.expectancy).padStart(7)}`
    );
  }
  console.log(`  ambig = bars containing BOTH barriers (order unknowable from OHLC).`);
  console.log(`  exp R assumes stop-first; optim assumes target-first. TRUTH IS BETWEEN THEM.`);
  console.log(`  If those two straddle zero, this data can't resolve the strategy — you need ticks.`);
  console.log(`  → this is the setup on its OWN terms, before any optimization.`);
  console.log(`     If no R multiple clears breakeven here, tuning won't save it.`);

  console.log(`\nTRAILING STOP  (ratchet to each prior bar's low; no TP, risk = reversal low)`);
  console.log(`  ${"delay".padEnd(7)} ${"win%".padStart(6)} ${"avgW".padStart(6)} ${"avgL".padStart(6)} ${"bars".padStart(5)} ${"bestR".padStart(6)} ${"exp R".padStart(7)}`);
  for (const startAfter of [0, 1, 2, 3]) {
    const s = engine.summarizeR(engine.scoreTrailing(trades, { startAfter, costPts: COST }));
    if (!s.n) continue;
    const flag = s.expectancy > 0 ? "✓" : " ";
    console.log(
      `  ${flag}${String(startAfter + " bar").padEnd(6)} ${f(s.winRate * 100, 1).padStart(6)} ` +
      `${f(s.avgWin).padStart(6)} ${f(s.avgLoss).padStart(6)} ${f(s.medBars, 0).padStart(5)} ` +
      `${f(s.bestR, 1).padStart(6)} ${f(s.expectancy).padStart(7)}`
    );
  }
  console.log(`  → "delay" = bars before the trail activates (0 = from entry).`);
  console.log(`     Expect low win%, small avgL, fat avgW. Judge on exp R, nothing else.`);
  console.log(`     A 3m ES bar is ~2-3 pts, so a 0-bar trail stops out almost instantly.`);

  // ── SANITY GUARD ────────────────────────────────────────────────────────
  // At 1R the barriers are SYMMETRIC (+risk / -risk). A driftless series must
  // produce wins ≈ losses. A large skew means one of two things, and you have
  // to rule out the second before believing the first:
  //   1. the setup has real directional drift, or
  //   2. the scorer is broken.
  // A previous version of this file scored "both barriers touched in the
  // window" as a loss, which manufactured exactly this skew out of nothing.
  if (sym && sym.wins + sym.losses > 30) {
    const skew = (sym.losses - sym.wins) / (sym.wins + sym.losses);
    if (Math.abs(skew) > 0.15) {
      console.log(
        `\n  ⚠ SANITY: at 1R the barriers are symmetric, but W/L is ${sym.wins}/${sym.losses} ` +
        `(${f(skew * 100, 0)}% skew ${skew > 0 ? "toward losses" : "toward wins"}).`
      );
      console.log(`     Either the setup has genuine drift, or the scorer is lying. Rule out #2 first.`);
    }
  }
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
