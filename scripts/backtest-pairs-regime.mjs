#!/usr/bin/env node
/* Phase 2 backtest for server-v2/pairs-regime-trainer.js (REGIME_LEARNING_DESIGN.md
 * "Backtest pairs regimes against last 60D; log accuracy").
 *
 * Imports the REAL production trainer and runs it in dryRun mode over a longer
 * window (default 60D) — same β/spread/zscore construction, same HMM fit, same
 * MeanRevert/Drift/Stuck relabeling, same 5-bars-forward validation as the
 * daily 04:30 ET job — but writes NOTHING to Postgres and fires no broadcast.
 * Prints per-pair accuracy so you can judge whether the pairs regimes are
 * predictive before trusting them for gating.
 *
 * Run on VPS:  docker exec -i dashboard-dashboard-1 node scripts/backtest-pairs-regime.mjs
 *              (run BY PATH, not piped via stdin — relative import to
 *              ../server-v2/pairs-regime-trainer.js needs a real file path.)
 * Env knobs:   DAYS (default 60), BASE (default http://localhost:3002)
 *
 * Reading the output:
 *   hit_rate      — MeanRevert+Drift calls scored 5 bars forward (Stuck excluded)
 *   revert_hit    — MeanRevert bars where |z| halved or flipped sign
 *   drift_hit     — Drift bars where |z| kept growing
 *   stuck_neutral — Stuck bars where z barely moved (sanity, not edge)
 * Doc thresholds: <60% hit-rate = pair may be decorrelating; <50% = regime is
 * noise, don't gate on it.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { runTrainerForPair, PAIRS } = require("../server-v2/pairs-regime-trainer.js");

const DAYS = Number(process.env.DAYS || 60);
const BASE = process.env.BASE || `http://localhost:${process.env.PORT || 3002}`;

const pct = (v) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);

for (const pair of PAIRS) {
  console.log(`\n── ${pair.id} · ${DAYS}D dry-run backtest ──────────────────────────`);
  try {
    const r = await runTrainerForPair(BASE, pair, { daysBack: DAYS, dryRun: true });
    if (!r.ok) { console.log("skipped:", r); continue; }
    console.log(`obs bars:        ${r.obs}  (β=${r.beta.toFixed(4)})`);
    console.log(`label mix:       MeanRevert ${r.labelCounts.MeanRevert} · Drift ${r.labelCounts.Drift} · Stuck ${r.labelCounts.Stuck}`);
    console.log(`stationary:      MeanRevert ${pct(r.stationaryDist.MeanRevert)} · Drift ${pct(r.stationaryDist.Drift)} · Stuck ${pct(r.stationaryDist.Stuck)}`);
    console.log(`hit_rate:        ${pct(r.accuracy.hit_rate)} over ${r.accuracy.n} scored bars`);
    console.log(`  revert_hit:    ${pct(r.accuracy.revert_hit)}`);
    console.log(`  drift_hit:     ${pct(r.accuracy.drift_hit)}`);
    console.log(`  stuck_neutral: ${pct(r.accuracy.stuck_neutral)}`);
    const hr = r.accuracy.hit_rate;
    if (hr == null) console.log("verdict:         not enough scored bars");
    else if (hr < 0.5) console.log("verdict:         ✗ regime is noise (<50%) — do NOT gate on it");
    else if (hr < 0.6) console.log("verdict:         ⚠ below 60% threshold — pair may be decorrelating");
    else console.log("verdict:         ✓ predictive at the doc's 60% bar");
  } catch (e) {
    console.error(`${pair.id} failed:`, e?.message || e);
  }
}
process.exit(0);
