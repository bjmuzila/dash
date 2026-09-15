'use strict';
/**
 * server-v2/ib-live-read.selftest.js
 *
 * Pure-logic test for the Live Read port. No DB, no feed, no network — it
 * builds synthetic 5m ES bars and asserts the two numbers the 10:30 alert
 * quotes come out as the /v3/scanner IB Stats card computes them.
 *
 * Run:  node server-v2/ib-live-read.selftest.js
 * Exit: 0 = all pass, 1 = a failure (prints which).
 *
 * THE ANCHOR CASE (test 4) is a reading taken off the live card on 2026-09-15:
 *   Overall break bias  -85   STRONG BEARISH BREAK
 *   Breakout target     83.3% LOW BREAK BIAS   (high first 16.7%)
 * with the range broken LOW and price under the midpoint. If a future export
 * moves the population, THAT is the number that moves — and this test is how
 * you find out, rather than an alert quietly saying something else.
 */

const M = require('./ib-live-read')._internals;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

// 5m ES bars for one ET session. `at(min)` is the UTC ms of an ET minute-of-day
// on a fixed EDT date, so the ET formatters in the module see what we intend.
const DAY = '2026-09-15';
const at = (min) => Date.parse(`${DAY}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00-04:00`);
const bar = (min, o, h, l, c) => ({ timestamp: at(min), open: o, high: h, low: l, close: c, volume: 1000 });

// ─────────────────────────────────────────────────────────────────────────────
// 1) ET mapping — the two formatters the whole port stands on
// ─────────────────────────────────────────────────────────────────────────────
(() => {
  console.log('1) ET date + minute-of-day');
  check('09:30 ET → 570', M.etMin(at(570)) === 570);
  check('10:30 ET → 630', M.etMin(at(630)) === 630);
  check('session date is ET, not UTC', M.etDate(at(570)) === DAY);
  // 20:00 ET is the NEXT UTC day — the case that blends two sessions if the
  // grouping is done on UTC dates.
  check('20:00 ET still reads as the same ET day', M.etDate(at(1200)) === DAY);
  check('range end for the 60m window is 10:30', M.rangeEnd(60) === 630);
})();

// ─────────────────────────────────────────────────────────────────────────────
// 2) The width ladder — narrow is tested FIRST, equality lands in normal
// ─────────────────────────────────────────────────────────────────────────────
(() => {
  console.log('2) width class');
  // width satisfying BOTH the narrow and the wide branch resolves narrow.
  check('narrow wins a tie with wide', M.widthClassOf(10, 100, 4) === 'narrow');
  check('equality is normal', M.widthClassOf(50, 100, 40) === 'normal');
  check('wide', M.widthClassOf(80, 50, 40) === 'wide');
  check('zero averages → em dash', M.widthClassLive(30, 0, 40) === '—');
  check('em dash matches no bucket', M.bucketKeyOf('—') === null);
  check('NARROW lower-cases into a bucket key', M.bucketKeyOf('NARROW') === 'narrow');
})();

// ─────────────────────────────────────────────────────────────────────────────
// 3) The live half — formation order, midpoint bias, inner ORB
// ─────────────────────────────────────────────────────────────────────────────
(() => {
  console.log('3) live session off the 5m tape');
  const hist = { avgIb: 35, avgAtr: 73 };

  // 09:30 prints the LOW, 10:00 prints the HIGH, close below the midpoint.
  const bars = [
    bar(570, 6000, 6002, 5996, 5998),   // inner ORB window: 09:30–09:45
    bar(575, 5998, 6000, 5995, 5997),   //   → ORB high 6002, ORB low 5995
    bar(585, 5997, 5998, 5990, 5991),   // closes under the ORB low → ORB down; prints the IB low
    bar(600, 5991, 6010, 5992, 6008),   // prints the IB high
    bar(625, 6008, 6009, 5994, 5995),   // IB close 5995, below the midpoint (6000)
    bar(630, 5995, 5996, 5988, 5989),   // post — the 10:30 bar, closing under IBL
  ];
  const live = M.liveRead(bars, hist, 60);
  check('range is the IB bars only — the post bar is not in it', live.ibh === 6010 && live.ibl === 5990);
  check('midpoint', live.mid === 6000);
  check('LOW formed first', live.first === 'L');
  check('close below mid → bias L', live.bias === 'L');
  check('inner ORB broke down', live.orbDir === 'L');
  check('10:30 bar makes the range complete', live.ibComplete === true);
  check('post bar closed under IBL → brokeL', live.brokeL === true && live.brokeH === false);

  // Same tape WITHOUT the 10:30 bar: the range is not complete and nothing has
  // broken, which is the state the alert actually fires in.
  const forming = M.liveRead(bars.slice(0, 5), hist, 60);
  check('no post bar → not complete', forming.ibComplete === false);
  check('no post bar → no break', forming.brokeH === false && forming.brokeL === false);

  // A single bar that is BOTH extremes resolves 'L' — no tie-break, by design.
  const oneBar = M.liveRead([bar(570, 6000, 6010, 5990, 6005)], hist, 60);
  check('one-bar range resolves first = L', oneBar.first === 'L');

  check('an empty tape is null, not a zeroed read', M.liveRead([], hist, 60) === null);
})();

// ─────────────────────────────────────────────────────────────────────────────
// 4) THE ANCHOR — the card's own reading, reproduced from the static export
// ─────────────────────────────────────────────────────────────────────────────
(() => {
  console.log('4) anchor: the 2026-09-15 card reading');
  const ds = M.loadDataset('ES');
  if (!ds) { console.log('  ⚠ dataset not found — skipped (public/data/ib-ES.json)'); return; }

  // The stack the card was conditioned on that afternoon.
  const live = {
    bias: 'L', first: 'H', bucket: 'NARROW', orbDir: 'L',
    price: 100, mid: 200,            // price under the midpoint
    brokeH: false, brokeL: true,     // one-sided break, LOW
    ibComplete: true,
  };
  const stack = M.conditionStack(live, 60);
  const group = M.bestSample(ds.days, stack.conds, stack.labels);
  const pHigh = M.pHighOf(group.g);

  check('full four-condition stack survived MIN_N',
    group.label === 'close < mid + HIGH first + NARROW IB 60m + inner ORB down');
  check('and the window label is the card\'s, not a bare "60m"', M.winLabel(60) === 'IB 60m');
  check('high-first probability is 16.7%', pHigh.toFixed(1) === '16.7');
  check('gauge reads 83.3% LOW first', (100 - pHigh).toFixed(1) === '83.3');
  check('overall break bias is -85', M.scoreText(M.overallScore(live, pHigh)) === '-85');
  check('verdict wording', M.overallVerdictText(M.overallScore(live, pHigh)) === 'STRONG BEARISH BREAK');
})();

// ─────────────────────────────────────────────────────────────────────────────
// 5) The score's term order — each term isolated
// ─────────────────────────────────────────────────────────────────────────────
(() => {
  console.log('5) overall score arithmetic');
  const base = { price: 100, mid: 100, brokeH: false, brokeL: false, bias: null, ibComplete: true };
  check('pHigh 50 with nothing else is 0', M.overallScore(base, 50) === 0);
  check('pHigh 100 → +80', M.overallScore(base, 100) === 80);
  check('one-sided high break adds 22',
    M.overallScore({ ...base, brokeH: true }, 50) === 22);
  // ×0.4 lands BEFORE the ±6 and ±4, so those two are undamped by it.
  check('both sides broken damps the base, not the price/bias terms',
    M.overallScore({ ...base, brokeH: true, brokeL: true, price: 101, bias: 'H' }, 100) === 80 * 0.4 + 6 + 4);
  check('a forming range halves everything',
    M.overallScore({ ...base, ibComplete: false, price: 101, bias: 'H' }, 100) === (80 + 6 + 4) * 0.5);
  check('clamped at +100', M.overallScore({ ...base, brokeH: true, price: 101, bias: 'H' }, 100) === 100);
  check('clamped at -100', M.overallScore({ ...base, brokeL: true, price: 99, bias: 'L' }, 0) === -100);
  check('exactly 0 reads neutral', M.overallVerdictText(0) === 'NEUTRAL — no edge');
  check('|19| is still neutral', M.convictionOf(-19) === 'NEUTRAL');
  check('|20| is a lean', M.convictionOf(20) === 'LEAN');
  check('|45| is strong', M.convictionOf(-45) === 'STRONG');
})();

// ─────────────────────────────────────────────────────────────────────────────
// 6) Sampling — the fallbacks that keep a thin day from quoting a thin number
// ─────────────────────────────────────────────────────────────────────────────
(() => {
  console.log('6) sampling floors');
  const day = (over) => ({ bias: 'H', first: 'H', widthBucket: 'narrow', orbDir: 'H', firstTouchSide: 'H', ...over });
  const days = [...Array(50)].map(() => day({}));

  // A condition matched by only 3 sessions is dropped for the looser one.
  const thin = [...days, ...[...Array(3)].map(() => day({ bias: 'L' }))];
  const g = M.bestSample(thin, [(d) => d.bias === 'L', (d) => d.first === 'H'], ['close < mid', 'HIGH first']);
  check('a 3-session stack falls back to every session', g.label === 'all sessions' && g.g.length === 53);

  check('no recorded first touch → a hard-coded 50',
    M.pHighOf([day({ firstTouchSide: null }), day({ firstTouchSide: null })]) === 50);
  check('sessions with no touch are excluded from the denominator',
    M.pHighOf([day({ firstTouchSide: 'H' }), day({ firstTouchSide: 'L' }), day({ firstTouchSide: null })]) === 50);
})();

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
