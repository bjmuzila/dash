#!/usr/bin/env node
/**
 * scripts/ib-blend-check.mjs
 *
 * Does the joined read in lib/ibBlend.ts actually recover the truth?
 *
 * The Condition Rail quotes one number built out of many overlapping
 * conditions, and the failure mode of every method that does that is silent:
 * it returns a confident number that is simply wrong, and nothing on screen
 * says so. So this drives the estimator against SYNTHETIC books where the true
 * conditional rate is known by construction, and asserts it lands near it.
 *
 * Three scenarios, each targeting a different way this can go wrong:
 *
 *   1. FAT COHORT — the exact intersection has hundreds of days. The joined
 *      number must be essentially the plain conditional rate: the estimator has
 *      to get out of the way when the data can answer directly.
 *   2. DUPLICATE PICKS — two criteria that are near-restatements of each other.
 *      Their evidence must NOT be counted twice.
 *   3. THIN COHORT, MOSTLY REDUNDANT PICKS — the real situation on the page:
 *      six criteria, four of them restating one latent condition, an exact
 *      intersection of a handful of days. The joined number must land near the
 *      true rate rather than near either the anecdote or the undamped stack.
 *
 * Run: node scripts/ib-blend-check.mjs
 */

import { build } from "esbuild";
import { Buffer } from "node:buffer";

const bundled = await build({
  entryPoints: ["lib/ibBlend.ts"],
  bundle: true,
  format: "esm",
  write: false,
  platform: "neutral",
});
const { blendMasks, makeMask } = await import(
  "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64")
);

/** Deterministic PRNG — a flaky statistical test is worse than none. */
const prng = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const pct = (v) => (v == null ? "—" : (100 * v).toFixed(1) + "%");
let failures = 0;

function check(name, got, want, tol, extra = "") {
  const ok = got != null && Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(
    `${ok ? "  ok  " : "  FAIL"} ${name.padEnd(34)} got ${pct(got).padStart(6)}  want ${pct(want)} ±${(100 * tol).toFixed(0)}pts  ${extra}`,
  );
}

/** Build a book whose outcome probability is a known function of the flags. */
function book(seed, n, gen) {
  const rnd = prng(seed);
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(gen(rnd));
  return rows;
}

const rateOf = (rows, pred) => {
  const s = rows.filter(pred);
  return { p: s.length ? s.filter((r) => r.out).length / s.length : null, n: s.length };
};

/* ── 1. fat cohort: the estimator must get out of the way ─────────────────── */
{
  const rows = book(1234, 4000, (rnd) => {
    const A = rnd() < 0.5;
    const B = rnd() < 0.5;
    return { A, B, out: rnd() < 0.4 + (A ? 0.2 : 0) + (B ? 0.1 : 0) };
  });
  const N = rows.length;
  const mk = (f) => makeMask(rows, f);
  const out = mk((r) => r.out);
  const b = blendMasks([mk((r) => r.A), mk((r) => r.B)], out, N);
  const truth = rateOf(rows, (r) => r.A && r.B);
  console.log(`\n1. FAT COHORT  (exact n=${truth.n})`);
  check("joined ≈ plain conditional rate", b.joined, truth.p, 0.03, `exact ${pct(b.exact)}`);
}

/* ── 2. duplicate picks must not double-count ─────────────────────────────── */
{
  const rows = book(777, 4000, (rnd) => {
    const latent = rnd() < 0.4;
    const A = latent ? rnd() < 0.95 : rnd() < 0.05;
    const B = latent ? rnd() < 0.93 : rnd() < 0.05; // a restatement of A
    return { A, B, latent, out: rnd() < 0.4 + (latent ? 0.25 : 0) };
  });
  const N = rows.length;
  const mk = (f) => makeMask(rows, f);
  const out = mk((r) => r.out);
  const one = blendMasks([mk((r) => r.A)], out, N);
  const two = blendMasks([mk((r) => r.A), mk((r) => r.B)], out, N);
  const truth = rateOf(rows, (r) => r.A && r.B);
  console.log(`\n2. DUPLICATE PICKS  (exact n=${truth.n}, λ=${two.lambda.toFixed(2)} on ${two.lambdaPairs} pair(s))`);
  check("A alone", one.joined, rateOf(rows, (r) => r.A).p, 0.03);
  check("A + its duplicate", two.joined, truth.p, 0.04, "must not stack twice");
  if (two.lambda >= 0.95) {
    failures++;
    console.log("  FAIL λ stayed at 1 for two near-identical criteria — the overlap check did not fire");
  } else {
    console.log(`  ok   λ discounted the repeat evidence to ${(100 * two.lambda).toFixed(0)}%`);
  }
}

/* ── 3. the real case: thin exact cohort, mostly redundant picks ──────────── */
{
  const rows = book(999, 3000, (rnd) => {
    const latent = rnd() < 0.35;
    const A = latent ? rnd() < 0.95 : rnd() < 0.05;
    const B = latent ? rnd() < 0.92 : rnd() < 0.06;
    const C = rnd() < 0.3; // the only genuinely separate signal
    // D/E/F restate the latent and add NOTHING to the outcome. They exist only
    // to shred the exact intersection — exactly what nine ticked chips do.
    const D = latent ? rnd() < 0.35 : rnd() < 0.02;
    const E = latent ? rnd() < 0.3 : rnd() < 0.02;
    const F = latent ? rnd() < 0.28 : rnd() < 0.02;
    return { A, B, C, D, E, F, out: rnd() < 0.4 + (latent ? 0.25 : 0) + (C ? 0.15 : 0) };
  });
  const N = rows.length;
  const mk = (f) => makeMask(rows, f);
  const out = mk((r) => r.out);
  const preds = [mk((r) => r.A), mk((r) => r.B), mk((r) => r.C), mk((r) => r.D), mk((r) => r.E), mk((r) => r.F)];
  const b = blendMasks(preds, out, N);

  // The truth: D/E/F carry no information, so the real rate for a session
  // matching all six is the rate for latent + C.
  const truth = rateOf(rows, (r) => r.A && r.B && r.C);
  const p0 = rateOf(rows, () => true).p;
  const l = (p) => Math.log(p / (1 - p));
  const naive = 1 / (1 + Math.exp(-(l(p0) + b.marg.reduce((s, m) => s + m.w, 0))));

  console.log(`\n3. THIN COHORT, REDUNDANT PICKS  (exact n=${b.exactN}, λ=${b.lambda.toFixed(2)} on ${b.lambdaPairs} pairs)`);
  console.log(`     for reference: base ${pct(p0)} · exact-match anecdote ${pct(b.exact)} · undamped naive Bayes ${pct(naive)}`);
  check("joined ≈ true conditional rate", b.joined, truth.p, 0.05, `truth from n=${truth.n}`);
  if (naive - truth.p < 0.08) {
    console.log("  note  the undamped stack was not far off here — scenario is not stressing the damping");
  } else {
    console.log(`  ok   damping pulled ${pct(naive)} back to ${pct(b.joined)} against a truth of ${pct(truth.p)}`);
  }
}

console.log(failures ? `\n${failures} check(s) FAILED\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
