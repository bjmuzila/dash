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

const { evaluateFrame, evaluateGexChangeTop, __setAlertCacheForTest } = require('./signals-engine');

// flip_cross is production-disabled by default via the live DB-backed
// ALERT_CATALOG toggle (isAlertEnabled('flip_cross')), not the old
// FLIP_CROSS_ENABLED cfg flag. There's no DB in this pure-logic test, so flip
// the in-memory cache directly (test-only escape hatch — see signals-engine.js)
// to keep the pure flip-cross logic (tests 1/2/8/9) covered.
__setAlertCacheForTest('flip_cross', true);
__setAlertCacheForTest('core_change', true);
__setAlertCacheForTest('core_touch', true);

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

// 9a) IB BREAK — the first one only, whichever side, once per day
(() => {
  console.log('9a) ib_break fires once a day');
  __setAlertCacheForTest('ib_break', true);
  const mem = freshMem();
  // The IB gate is RTH-only (09:30–16:00 ET), and the module-wide T above is
  // 17:13 ET — outside it. This case needs its own base epoch: Tue 11:00 ET.
  const R = 1_699_977_600_000;
  const ibCtx = { ibComplete: true, ibh: 5020, ibl: 4980 };
  const mk = (ts, price) => ({ ...frame(ts, price, { ctx: ibCtx }) });
  // Drive the 1-min close tracker: a minute must advance for last1mClose to set.
  const sigs = [];
  const feed = [
    [R,                 5000], // inside
    [R + 60_000,        5025], // minute rolls → close 5000 recorded, still inside
    [R + 120_000,       5025], // close 5025 → above IBH + 2 → FIRST BREAK
    [R + 180_000,       4990], // back inside
    [R + 240_000,       4975], // close 4990 inside
    [R + 300_000,       4975], // close 4975 → below IBL - 2 → must NOT fire again
  ];
  for (const [ts, px] of feed) for (const x of evaluateFrame(mk(ts, px), mem)) sigs.push(x);
  const brks = sigs.filter((x) => x.kind === 'ib_break');
  check('exactly one ib_break', brks.length === 1);
  check('and it is the upside one', brks[0] && brks[0].direction === 'long');
  check('reason says first break', brks[0] && brks[0].reason.includes('First break'));
})();

// 9b) CORE LEVEL CHANGE — the scored strike moves; the first one is silent
(() => {
  console.log('9b) core level change');
  const mem = freshMem();
  const sigs = run(mem, [
    frame(T,            5000, { cbSpx: 5050, cbSize: 3.1 }), // first core seen → remembered, not announced
    frame(T + step,     5000, { cbSpx: 5050, cbSize: 3.1 }), // unchanged → nothing
    frame(T + 2 * step, 5000, { cbSpx: 5075, cbSize: 3.4 }), // moved 25 pts → fire
  ]);
  const chg = sigs.filter((x) => x.kind === 'core_change');
  check('one core_change', chg.length === 1);
  check('direction neutral', chg[0].direction === 'neutral');
  check('setup names both strikes', chg[0].setup.includes('5050') && chg[0].setup.includes('5075'));
  check('level is the new core', Math.round(chg[0].levelSpx) === 5075);
})();

// 9c) CORE LEVEL TOUCH — latched, one alert per visit
(() => {
  console.log('9c) core level touch latches until price leaves');
  const mem = freshMem();
  const sigs = run(mem, [
    frame(T,            5040, { cbSpx: 5050 }), // 10 away → nothing
    frame(T + step,     5049, { cbSpx: 5050 }), // within 1.5 → fire
    frame(T + 2 * step, 5050, { cbSpx: 5050 }), // still on it → latched, silent
    frame(T + 3 * step, 5051, { cbSpx: 5050 }), // still inside re-arm gap → silent
  ]);
  const touch = sigs.filter((x) => x.kind === 'core_touch');
  check('one core_touch', touch.length === 1);
  check('direction neutral', touch[0].direction === 'neutral');
  check('arrival side noted', touch[0].reason.includes('from below'));
})();

// 9d) CORE TOUCH RE-ARMS once price leaves by CORE_REARM
(() => {
  console.log('9d) core touch re-arms after price leaves');
  const mem = freshMem();
  const sigs = run(mem, [
    frame(T,             5049, { cbSpx: 5050 }), // fire
    frame(T + step,      5060, { cbSpx: 5050 }), // away by 10 → re-armed
    // Cooldown is keyed kind:direction:level, so step past COOLDOWN_MS (10 min).
    frame(T + 11 * 60_000, 5050, { cbSpx: 5050 }), // back on it → fire again
  ]);
  check('two core_touch', sigs.filter((x) => x.kind === 'core_touch').length === 2);
})();

// 10) TOP GEX CHANGE — one signal per scanner pick, never twice for the same row
(() => {
  console.log('10) top gex change → one alert per pick');
  const mem = freshMem();
  const rows = [
    { date: '2026-09-15', slot: '10:30', rank: 1, symbol: 'nvda', expiry: '2026-09-19',
      strike: 180, spot: 178.4, latest_chg: 7.4e8, pct_open: 62, score: 88, watch_id: 991, ts: null },
    { date: '2026-09-15', slot: '10:37', rank: 1, symbol: 'SPY', expiry: '2026-09-17',
      strike: 660, spot: 658.2, latest_chg: -5.1e8, pct_open: -41, score: 51, watch_id: 992, live: true },
  ];
  const first = evaluateGexChangeTop(rows, mem);
  check('two picks fired', first.length === 2);
  check('kind gex_change_top', first.every((x) => x.kind === 'gex_change_top'));
  check('direction neutral', first.every((x) => x.direction === 'neutral'));
  check('symbol upper-cased in level', first[0].levelName === 'NVDA 180');
  check('score compressed 0-100 → 1-5', first[0].score === 4 && first[1].score === 3);
  check('live trigger labelled', first[1].setup.includes('live trigger'));

  // Same rows again on the next poll — the leaderboard is re-read every minute.
  check('no re-fire on re-read', evaluateGexChangeTop(rows, mem).length === 0);

  // A new pick lands in the same slot.
  const more = evaluateGexChangeTop([...rows,
    { date: '2026-09-15', slot: '11:00', rank: 2, symbol: 'TSLA', expiry: '2026-10-17',
      strike: 430, spot: 421, latest_chg: 9e8, pct_open: 77, score: 94, watch_id: 993 }], mem);
  check('only the new pick fires', more.length === 1 && more[0].meta.symbol === 'TSLA');
})();

// 11) TOP GEX CHANGE OFF — bookkeeping still runs, nothing is emitted
(() => {
  console.log('11) top gex change disabled → seen, not fired');
  __setAlertCacheForTest('gex_change_top', false);
  const mem = freshMem();
  const rows = [{ date: '2026-09-15', slot: '10:30', rank: 1, symbol: 'AMD',
    expiry: '2026-09-19', strike: 170, spot: 168, latest_chg: 6e8, pct_open: 55, score: 70, watch_id: 994 }];
  check('nothing fired while off', evaluateGexChangeTop(rows, mem).length === 0);
  __setAlertCacheForTest('gex_change_top', true);
  check('and not replayed when switched back on', evaluateGexChangeTop(rows, mem).length === 0);
})();

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
