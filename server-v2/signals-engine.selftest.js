'use strict';
/**
 * server-v2/signals-engine.selftest.js
 *
 * Pure-logic test for the signals detector. No DB, no feed, no network — it
 * drives synthetic frames through evaluateFrame() and asserts the expected
 * long/short signals fire for each of the four setups (+ confluence + cooldown).
 *
 * Run:  node server-v2/signals-engine.selftest.js
 * Exit: 0 = all pass, 1 = a failure (prints which).
 *
 * Frames are built in ES space with basis=0 so SPX-level inputs map 1:1 to ES.
 */

const { evaluateFrame, evaluateFlowDivergence, __setAlertCacheForTest } = require('./signals-engine');

// flip_cross is production-disabled by default via the live DB-backed
// ALERT_CATALOG toggle (isAlertEnabled('flip_cross')), not the old
// FLIP_CROSS_ENABLED cfg flag. There's no DB in this pure-logic test, so flip
// the in-memory cache directly (test-only escape hatch — see signals-engine.js)
// to keep the pure flip-cross logic (tests 1/2/8/9) covered.
__setAlertCacheForTest('flip_cross', true);

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function freshMem() { return { prev: null, levels: {}, cooldowns: new Map() }; }
function frame(ts, priceEs, extra = {}) {
  return { ts, priceEs, spx: priceEs, basis: 0, callSpx: null, putSpx: null, flipSpx: null, cbSpx: null, cbSize: null, ctx: {}, ...extra };
}
// Run a list of frames through one mem, return all signals emitted.
function run(mem, frames) {
  const all = [];
  for (const f of frames) for (const s of evaluateFrame(f, mem)) all.push(s);
  return all;
}
function runFd(mem, frames) {
  const all = [];
  for (const f of frames) for (const s of evaluateFlowDivergence(f, mem)) all.push(s);
  return all;
}
const T = 1_700_000_000_000; // arbitrary base epoch ms
const step = 4000;

// 1) FLIP CROSS ↑ → LONG
(() => {
  console.log('1) flip cross up → long');
  const sigs = run(freshMem(), [
    frame(T,          4998, { flipSpx: 5000 }),
    frame(T + step,   5002, { flipSpx: 5000 }),
  ]);
  const s = sigs.find((x) => x.kind === 'flip_cross');
  check('one flip_cross fired', sigs.filter((x) => x.kind === 'flip_cross').length === 1);
  check('direction long', !!s && s.direction === 'long');
  check('level is Flip @ 5000', !!s && s.levelName === 'Flip' && Math.round(s.levelEs) === 5000);
})();

// 2) FLIP CROSS ↓ → SHORT
(() => {
  console.log('2) flip cross down → short');
  const sigs = run(freshMem(), [
    frame(T,          5002, { flipSpx: 5000 }),
    frame(T + step,   4998, { flipSpx: 5000 }),
  ]);
  const s = sigs.find((x) => x.kind === 'flip_cross');
  check('direction short', !!s && s.direction === 'short');
})();

// 3) CALL WALL REJECT → SHORT
(() => {
  console.log('3) call wall reject → short');
  const sigs = run(freshMem(), [
    frame(T,            5045, { callSpx: 5050 }), // approach from below
    frame(T + step,     5049, { callSpx: 5050 }), // touch (dist -1)
    frame(T + 2 * step, 5048.3, { callSpx: 5050 }), // push back down ≥1.5
  ]);
  const s = sigs.find((x) => x.kind === 'wall_reject');
  check('wall_reject fired', !!s);
  check('direction short', !!s && s.direction === 'short');
  check('level Call Wall', !!s && s.levelName === 'Call Wall');
})();

// 4) PUT WALL BREAK → SHORT
(() => {
  console.log('4) put wall break → short');
  const sigs = run(freshMem(), [
    frame(T,          4953, { putSpx: 4950 }),
    frame(T + step,   4947.8, { putSpx: 4950 }), // dist -2.2 ≤ -break(2)
  ]);
  const s = sigs.find((x) => x.kind === 'wall_break');
  check('wall_break fired', !!s);
  check('direction short', !!s && s.direction === 'short');
})();

// 5) CALL WALL BREAK → LONG
(() => {
  console.log('5) call wall break → long');
  const sigs = run(freshMem(), [
    frame(T,          5047, { callSpx: 5050 }),
    frame(T + step,   5052.5, { callSpx: 5050 }), // dist +2.5 ≥ break
  ]);
  const s = sigs.find((x) => x.kind === 'wall_break');
  check('direction long', !!s && s.direction === 'long');
})();

// 6) CB REJECT (support, from above) → LONG, size-gated score
(() => {
  console.log('6) CB reject support → long');
  const sigs = run(freshMem(), [
    frame(T,            5105, { cbSpx: 5100, cbSize: 3.0 }), // above
    frame(T + step,     5101, { cbSpx: 5100, cbSize: 3.0 }), // touch from above
    frame(T + 2 * step, 5101.7, { cbSpx: 5100, cbSize: 3.0 }), // bounce up ≥1.5
  ]);
  const s = sigs.find((x) => x.kind === 'cb_reject');
  check('cb_reject fired', !!s);
  check('direction long', !!s && s.direction === 'long');
  check('score ≥ 3 (size ≥ 2B)', !!s && s.score >= 3);
})();

// 7) SMALL CB → low-confidence score (≤2)
(() => {
  console.log('7) small CB reject → low score');
  const sigs = run(freshMem(), [
    frame(T,            5105, { cbSpx: 5100, cbSize: 1.0 }),
    frame(T + step,     5101, { cbSpx: 5100, cbSize: 1.0 }),
    frame(T + 2 * step, 5101.7, { cbSpx: 5100, cbSize: 1.0 }),
  ]);
  const s = sigs.find((x) => x.kind === 'cb_reject');
  check('cb_reject fired', !!s);
  check('score ≤ 2 (small CB)', !!s && s.score <= 2);
})();

// 8) CONFLUENCE BOOSTER — flip cross with POC stacked at the flip
(() => {
  console.log('8) confluence booster on flip cross');
  const sigs = run(freshMem(), [
    frame(T,        4998, { flipSpx: 5000, ctx: { poc: 5001 } }),
    frame(T + step, 5002, { flipSpx: 5000, ctx: { poc: 5001 } }),
  ]);
  const s = sigs.find((x) => x.kind === 'flip_cross');
  check('confluence names POC', !!s && /POC/.test(s.confluence || ''));
  check('score boosted to 4', !!s && s.score === 4);
})();

// 9) COOLDOWN — same flip cross twice within the window fires once
(() => {
  console.log('9) cooldown suppresses repeat');
  const mem = freshMem();
  const sigs = run(mem, [
    frame(T,            4998, { flipSpx: 5000 }),
    frame(T + step,     5002, { flipSpx: 5000 }), // fires
    frame(T + 2 * step, 4998, { flipSpx: 5000 }), // back below
    frame(T + 3 * step, 5002, { flipSpx: 5000 }), // within cooldown → suppressed
  ]);
  check('only one flip_cross', sigs.filter((x) => x.kind === 'flip_cross').length === 1);
})();

// 10) FLOW GEX DIVERGENCE — price up, aggregate flow bearish, one strike dominates → LONG
(() => {
  console.log('10) flow divergence → long catalyst');
  const sigs = runFd(freshMem(), [
    frame(T,        5000, { totalFlowGex: -2.5e9, maxFlow: -4.5e9, maxFlowStrike: 5075 }), // seed prev
    frame(T + step, 5005, { totalFlowGex: -2.5e9, maxFlow: -4.5e9, maxFlowStrike: 5075 }), // price up → fire
  ]);
  const s = sigs.find((x) => x.kind === 'flow_divergence');
  check('flow_divergence fired', !!s);
  check('direction long', !!s && s.direction === 'long');
  check('level Flow 5075', !!s && s.levelName === 'Flow 5075' && Math.round(s.levelSpx) === 5075);
})();

// 11) NO DIVERGENCE — aggregate flow agrees with price (both bullish) → no fire
(() => {
  console.log('11) flow aligned with price → no signal');
  const sigs = runFd(freshMem(), [
    frame(T,        5000, { totalFlowGex: 3e9, maxFlow: 4.5e9, maxFlowStrike: 5075 }),
    frame(T + step, 5005, { totalFlowGex: 3e9, maxFlow: 4.5e9, maxFlowStrike: 5075 }),
  ]);
  check('no flow_divergence', sigs.filter((x) => x.kind === 'flow_divergence').length === 0);
})();

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
