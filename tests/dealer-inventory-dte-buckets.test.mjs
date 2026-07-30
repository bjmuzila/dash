/**
 * tests/dte-buckets.test.mjs
 *
 * Verifies server-v2/computation/dte-buckets.js.
 *
 * The failure modes this pins down:
 *   1. Rollups double-counting (Ex-0DTE + All are sums of buckets, not buckets).
 *   2. Shares that don't sum to 100% when gamma straddles zero.
 *   3. A "measured" chip appearing over mostly-assumed numbers.
 *   4. Expired contracts leaking into the book.
 *   5. The convention basis dropping its put-leg negation, or the measured
 *      basis double-flipping it.
 *
 * Run: node --test tests/dte-buckets.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const B = require('../server-v2/computation/dte-buckets.js');

const SESSION = '2026-07-29';
const SPOT = 6400;
const G = 0.002;

/** One strike row on the convention basis (no flow captured). */
const conv = (expiration, strike, callOi, putOi) => ({
  expiration, strike, callGamma: G, putGamma: G, callOi, putOi,
});

/** One strike row with captured flow, so it can use the measured basis. */
const meas = (expiration, strike, inv, dOi) => ({
  expiration, strike, callGamma: G, putGamma: G, callOi: 0, putOi: 0,
  inventory: inv, callOiDelta: dOi?.call ?? 0, putOiDelta: dOi?.put ?? 0,
});

// ───────────────────────────────────────────────────────────────────────────
test('dteBetween counts calendar days', () => {
  assert.equal(B.dteBetween(SESSION, '2026-07-29'), 0);
  assert.equal(B.dteBetween(SESSION, '2026-07-30'), 1);
  assert.equal(B.dteBetween(SESSION, '2026-10-27'), 90);
  assert.equal(B.dteBetween(SESSION, '2026-07-28'), -1);
  assert.equal(B.dteBetween(SESSION, 'nonsense'), null);
});

test('bucketForDte covers 0..inf with no gaps or overlaps', () => {
  const seen = [];
  for (let d = 0; d <= 400; d += 1) {
    const b = B.bucketForDte(d);
    assert.ok(b, `dte ${d} fell through every bucket`);
    seen.push(b.key);
  }
  assert.equal(B.bucketForDte(0).key, '0dte');
  assert.equal(B.bucketForDte(1).key, 'near');
  assert.equal(B.bucketForDte(7).key, 'near');
  assert.equal(B.bucketForDte(8).key, 'front');
  assert.equal(B.bucketForDte(30).key, 'front');
  assert.equal(B.bucketForDte(31).key, 'mid');
  assert.equal(B.bucketForDte(90).key, 'mid');
  assert.equal(B.bucketForDte(91).key, 'back');
  assert.equal(new Set(seen).size, 5);
});

test('bucketForDte rejects expired and invalid input', () => {
  assert.equal(B.bucketForDte(-1), null);
  assert.equal(B.bucketForDte(NaN), null);
  assert.equal(B.bucketForDte(null), null);
});

// ───────────────────────────────────────────────────────────────────────────
test('convention basis negates the put leg', () => {
  const callsOnly = B.conventionStrikeGamma({ callGamma: G, putGamma: G, callOi: 1000, putOi: 0 }, SPOT);
  const putsOnly = B.conventionStrikeGamma({ callGamma: G, putGamma: G, callOi: 0, putOi: 1000 }, SPOT);
  assert.ok(callsOnly > 0, 'call OI must be positive gamma');
  assert.ok(putsOnly < 0, 'put OI must be negative gamma');
  assert.equal(callsOnly, -putsOnly);
});

test('measured basis does NOT negate the put leg', () => {
  // Dealer sold puts to takers -> short gamma. Negating again would flip it.
  const s = meas('2026-07-29', 6400, { putSellVol: 1000 }, { put: 1000 });
  assert.ok(B.measuredStrikeGamma(s, SPOT, 'oi') < 0);
});

test('measured basis: dealer buying is long gamma on both legs', () => {
  const c = meas('2026-07-29', 6400, { callBuyVol: 500 }, { call: 500 });
  const p = meas('2026-07-29', 6400, { putBuyVol: 500 }, { put: 500 });
  assert.ok(B.measuredStrikeGamma(c, SPOT, 'oi') > 0);
  assert.ok(B.measuredStrikeGamma(p, SPOT, 'oi') > 0);
});

// ───────────────────────────────────────────────────────────────────────────
test('bucketChain assigns strikes to the right buckets', () => {
  const out = B.bucketChain({
    sessionDate: SESSION, spot: SPOT,
    strikes: [
      conv('2026-07-29', 6400, 1000, 0),   // 0 dte
      conv('2026-08-03', 6400, 1000, 0),   // 5 dte  -> near
      conv('2026-08-20', 6400, 1000, 0),   // 22 dte -> front
      conv('2026-09-15', 6400, 1000, 0),   // 48 dte -> mid
      conv('2027-01-15', 6400, 1000, 0),   // 170dte -> back
    ],
  });
  const by = Object.fromEntries(out.buckets.map((b) => [b.key, b]));
  for (const k of ['0dte', 'near', 'front', 'mid', 'back']) {
    assert.equal(by[k].strikes, 1, `${k} should hold exactly one strike`);
  }
  assert.equal(out.expirations, 5);
  assert.equal(out.strikes, 5);
});

test('empty buckets still render as zero rows, not missing rows', () => {
  const out = B.bucketChain({
    sessionDate: SESSION, spot: SPOT,
    strikes: [conv('2026-07-29', 6400, 1000, 0)],
  });
  assert.equal(out.buckets.length, 5, 'all five buckets must be present');
  const back = out.buckets.find((b) => b.key === 'back');
  assert.equal(back.strikes, 0);
  assert.equal(back.netGamma, 0);
});

test('expired contracts are excluded from the book', () => {
  const out = B.bucketChain({
    sessionDate: SESSION, spot: SPOT,
    strikes: [
      conv('2026-07-28', 6400, 9999, 0),  // yesterday — settled
      conv('2026-07-29', 6400, 1000, 0),
    ],
  });
  assert.equal(out.strikes, 1);
  assert.equal(out.expirations, 1);
});

// ───────────────────────────────────────────────────────────────────────────
test('rollups are sums of buckets, never additional buckets', () => {
  const out = B.bucketChain({
    sessionDate: SESSION, spot: SPOT,
    strikes: [
      conv('2026-07-29', 6400, 0, 2000),   // 0dte, net negative
      conv('2026-08-03', 6400, 1000, 0),   // near, positive
      conv('2027-01-15', 6400, 3000, 0),   // back, positive
    ],
  });
  assert.equal(out.buckets.length, 5);
  assert.equal(out.rollups.length, 2);

  const bucketSum = out.buckets.reduce((a, b) => a + b.netGamma, 0);
  const all = out.rollups.find((r) => r.key === 'all');
  const ex = out.rollups.find((r) => r.key === 'ex0dte');
  const zero = out.buckets.find((b) => b.key === '0dte');

  assert.ok(Math.abs(all.netGamma - bucketSum) < 1e-6, 'All = sum of buckets');
  assert.ok(Math.abs(ex.netGamma - (bucketSum - zero.netGamma)) < 1e-6, 'Ex-0DTE = All - 0DTE');
  assert.ok(Math.abs(out.totals.ex0dte + out.totals.zeroDte - out.totals.net) < 1e-6);
});

test('Ex-0DTE OI excludes the 0DTE leg', () => {
  const out = B.bucketChain({
    sessionDate: SESSION, spot: SPOT,
    strikes: [
      conv('2026-07-29', 6400, 500, 400),
      conv('2026-08-03', 6400, 300, 200),
    ],
  });
  const ex = out.rollups.find((r) => r.key === 'ex0dte');
  const all = out.rollups.find((r) => r.key === 'all');
  assert.equal(ex.callOi, 300);
  assert.equal(ex.putOi, 200);
  assert.equal(all.callOi, 800);
  assert.equal(all.putOi, 600);
});

test('shares of gross sum to 100% even when gamma straddles zero', () => {
  const out = B.bucketChain({
    sessionDate: SESSION, spot: SPOT,
    strikes: [
      conv('2026-07-29', 6400, 0, 3000),   // strongly negative
      conv('2026-08-03', 6400, 1000, 0),
      conv('2026-09-15', 6400, 2000, 0),
    ],
  });
  const shares = out.buckets.map((b) => B.shareOfGross(b.netGamma, out.totals.gross));
  const sum = shares.reduce((a, s) => a + s, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `shares summed to ${sum}, expected 1`);
});

test('shareOfGross is safe when gross is zero', () => {
  assert.equal(B.shareOfGross(0, 0), 0);
  assert.equal(B.shareOfGross(NaN, 100), 0);
});

// ───────────────────────────────────────────────────────────────────────────
test('far-dated buckets are always convention, never measured', () => {
  const out = B.bucketChain({
    sessionDate: SESSION, spot: SPOT,
    strikes: [
      // Even WITH an inventory attached, a 170-DTE strike cannot be measured —
      // the feed never subscribed it, so any inventory here is spurious.
      { ...meas('2027-01-15', 6400, { callSellVol: 1000 }, { call: 1000 }), callOi: 500 },
    ],
  });
  const back = out.buckets.find((b) => b.key === 'back');
  assert.equal(back.basis, 'convention');
});

test('a near bucket with no captured flow is convention, not measured', () => {
  const out = B.bucketChain({
    sessionDate: SESSION, spot: SPOT,
    strikes: [conv('2026-08-03', 6400, 1000, 0)],   // no `inventory`
  });
  const near = out.buckets.find((b) => b.key === 'near');
  assert.equal(near.measuredCoverage, 0);
  assert.notEqual(near.basis, 'measured');
});

test('partial flow coverage downgrades the basis chip to partial', () => {
  const out = B.bucketChain({
    sessionDate: SESSION, spot: SPOT,
    strikes: [
      meas('2026-07-29', 6400, { callSellVol: 100 }, { call: 100 }),
      conv('2026-07-29', 6425, 1000, 0),
      conv('2026-07-29', 6450, 1000, 0),
      conv('2026-07-29', 6475, 1000, 0),
    ],
  });
  const z = out.buckets.find((b) => b.key === '0dte');
  assert.equal(z.measuredCoverage, 0.25);
  assert.equal(z.basis, 'partial', 'a quarter-covered bucket must not claim "measured"');
});

test('majority flow coverage earns the measured chip', () => {
  const out = B.bucketChain({
    sessionDate: SESSION, spot: SPOT,
    strikes: [
      meas('2026-07-29', 6400, { callSellVol: 100 }, { call: 100 }),
      meas('2026-07-29', 6425, { callSellVol: 100 }, { call: 100 }),
      meas('2026-07-29', 6450, { callSellVol: 100 }, { call: 100 }),
      conv('2026-07-29', 6475, 1000, 0),
    ],
  });
  const z = out.buckets.find((b) => b.key === '0dte');
  assert.equal(z.measuredCoverage, 0.75);
  assert.equal(z.basis, 'measured');
});

test('the measured/convention line is configurable', () => {
  const strikes = [conv('2026-08-20', 6400, 1000, 0)]; // 22 dte -> front
  const wide = B.bucketChain({ sessionDate: SESSION, spot: SPOT, strikes }, { measurableMaxDte: 30 });
  const front = wide.buckets.find((b) => b.key === 'front');
  // Widening the line makes the bucket ELIGIBLE, but with no captured flow it
  // still must not claim "measured".
  assert.notEqual(front.basis, 'measured');
  assert.equal(front.measuredCoverage, 0);
});

// ───────────────────────────────────────────────────────────────────────────
test('bucketChain survives junk input without throwing', () => {
  assert.doesNotThrow(() => B.bucketChain({}));
  assert.doesNotThrow(() => B.bucketChain(null));
  const out = B.bucketChain({
    sessionDate: SESSION, spot: SPOT,
    strikes: [null, {}, { expiration: '' }, { expiration: 'bad', strike: 1 }],
  });
  assert.equal(out.strikes, 0);
  assert.equal(out.buckets.length, 5);
  assert.equal(out.totals.net, 0);
});

test('zero spot yields zero gamma rather than NaN', () => {
  const out = B.bucketChain({
    sessionDate: SESSION, spot: 0,
    strikes: [conv('2026-07-29', 6400, 1000, 0)],
  });
  assert.equal(out.totals.net, 0);
  assert.ok(Number.isFinite(out.totals.gross));
});

test('the 1% scaling matches the canonical multiplier', () => {
  // One call strike, 1000 OI, gamma 0.002 -> gamma*oi*100*S^2*0.01
  const out = B.bucketChain({
    sessionDate: SESSION, spot: SPOT,
    strikes: [conv('2026-07-29', 6400, 1000, 0)],
  });
  const expected = G * 1000 * 100 * SPOT * SPOT * 0.01;
  assert.ok(Math.abs(out.totals.net - expected) < 1e-6);
});
