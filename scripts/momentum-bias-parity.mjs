// Verifies lib/momentumBias.js against the pandas reference.
//   1. No-dependency smoke tests (hand-computed WMA / EMA fixtures).
//   2. Full numeric parity: diffs the JS port against scripts/_mb_ref.csv
//      (produced by momentum-bias-ref.py) over identical inputs (_mb_data.csv).
//
// Run:  python3 scripts/momentum-bias-ref.py && node scripts/momentum-bias-parity.mjs
// Exits non-zero on any mismatch.
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const { getMomentumBiasIndex, wma, emaAdjustFalse } = require("../lib/momentumBias.js");

let failures = 0;
const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
function assert(cond, msg) {
  if (!cond) { console.error("  ✗ " + msg); failures++; }
  else console.log("  ✓ " + msg);
}

// ── 1. Hand-computed fixtures (no Python needed) ───────────────────────────
console.log("[smoke] WMA / EMA fixtures");
const w = wma([1, 2, 3, 4], 3); // weights 1,2,3 ; denom 6
assert(Number.isNaN(w[0]) && Number.isNaN(w[1]), "WMA NaN before window fills");
assert(approx(w[2], 14 / 6), `WMA[2] == 14/6 (got ${w[2]})`);
assert(approx(w[3], 20 / 6), `WMA[3] == 20/6 (got ${w[3]})`);
const e = emaAdjustFalse([2, 4, 6], 2); // alpha 2/3
assert(approx(e[0], 2), "EMA seeds on first value");
assert(approx(e[1], 10 / 3), `EMA[1] == 10/3 (got ${e[1]})`);
assert(approx(e[2], 46 / 9), `EMA[2] == 46/9 (got ${e[2]})`);

// ── 2. Numeric parity vs the pandas reference ──────────────────────────────
const DATA = join(HERE, "_mb_data.csv");
const REF = join(HERE, "_mb_ref.csv");
if (!existsSync(DATA) || !existsSync(REF)) {
  console.warn("\n[parity] skipped — run `python3 scripts/momentum-bias-ref.py` first to emit fixtures.");
} else {
  const bars = readFileSync(DATA, "utf8").trim().split("\n").slice(1).map((line) => {
    const [high, low, close] = line.split(",").map(Number);
    return { high, low, close };
  });
  const refRows = readFileSync(REF, "utf8").trim().split("\n").slice(1).map((line) => {
    const [up, down, boundary, bull, bear] = line.split(",");
    const num = (s) => (s === "" || s === undefined ? NaN : Number(s));
    const bool = (s) => String(s).trim().toLowerCase() === "true";
    return { up: num(up), down: num(down), boundary: num(boundary), bull: bool(bull), bear: bool(bear) };
  });

  console.log(`\n[parity] ${bars.length} bars vs pandas reference`);
  const js = getMomentumBiasIndex(bars);
  let maxDiff = 0, sigMismatch = 0, jsBull = 0, jsBear = 0, refBull = 0, refBear = 0;
  const cmp = (a, b) => {
    // Treat NaN==NaN as equal; otherwise track the largest absolute gap.
    if (Number.isNaN(b)) return; // reference NaN (leading warmup) — JS returns null there too
    const av = a == null ? NaN : a;
    if (Number.isNaN(av)) { maxDiff = Infinity; return; }
    maxDiff = Math.max(maxDiff, Math.abs(av - b));
  };
  for (let i = 0; i < bars.length; i++) {
    cmp(js[i].momentumUpBias, refRows[i].up);
    cmp(js[i].momentumDownBias, refRows[i].down);
    cmp(js[i].boundary, refRows[i].boundary);
    if (js[i].bullishTp !== refRows[i].bull || js[i].bearishTp !== refRows[i].bear) sigMismatch++;
    jsBull += js[i].bullishTp ? 1 : 0; jsBear += js[i].bearishTp ? 1 : 0;
    refBull += refRows[i].bull ? 1 : 0; refBear += refRows[i].bear ? 1 : 0;
  }
  assert(maxDiff <= 1e-6, `max bias/boundary diff <= 1e-6 (got ${maxDiff})`);
  assert(sigMismatch === 0, `signal columns match exactly (${sigMismatch} mismatched bars)`);
  console.log(`  JS signals:  ${jsBull} bull / ${jsBear} bear`);
  console.log(`  ref signals: ${refBull} bull / ${refBear} bear`);
}

console.log(failures ? `\nFAILED (${failures})` : "\nPASSED");
process.exit(failures ? 1 : 0);
