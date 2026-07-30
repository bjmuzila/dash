/**
 * tests/dealer-inventory.test.mjs
 *
 * Verifies server-v2/computation/dealer-inventory.js.
 *
 * The point of this suite is not coverage theatre — it pins down the four
 * things that are easy to get silently wrong in gamma exposure math:
 *
 *   1. The 100 x 0.01 = 1 cancellation, so the long form and the reduced form
 *      (and the existing gex-calculator.js expression) provably agree.
 *   2. Sign convention — that a dealer who SOLD calls to takers ends up SHORT
 *      gamma, and that the put leg is not double-flipped.
 *   3. Opening-ratio behaviour, including negative ΔOI (net closing) and the
 *      clamp that absorbs measurement noise.
 *   4. Cross-day accumulation, including expiry dropout.
 *
 * Run: node --test tests/dealer-inventory.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../server-v2/computation/dealer-inventory.js');

const SPOT = 6400;

// ───────────────────────────────────────────────────────────────────────────
test('1% notional scaling: long form == reduced form', () => {
  const cases = [
    [0.0021, 1500, 6400],
    [0.00005, -20000, 5900],
    [0.013, 1, 100],
    [0, 5000, 6400],
  ];
  for (const [g, pos, s] of cases) {
    assert.equal(
      D.notionalGammaPer1Pct(g, pos, s),
      D.notionalGammaPer1PctReduced(g, pos, s),
      `mismatch for gamma=${g} pos=${pos} spot=${s}`
    );
  }
});

test('reduced form matches the existing gex-calculator expression', () => {
  // server-v2/computation/gex-calculator.js does: gamma * oi * spot * spot
  const gamma = 0.0018;
  const oi = 4200;
  const legacy = gamma * oi * SPOT * SPOT;
  assert.equal(D.notionalGammaPer1Pct(gamma, oi, SPOT), legacy);
});

test('1% scaling is dimensionally right: delta change x notional', () => {
  // Hand-check one case end to end rather than trusting the formula shape.
  const gamma = 0.002;      // delta change per $1 move, per share
  const contracts = 1000;   // dealer long 1000 contracts
  const deltaPerShare = gamma * SPOT * 0.01;             // delta change per 1% move
  const shares = contracts * 100;                         // contract multiplier
  const expected = deltaPerShare * shares * SPOT;         // -> dollar notional
  assert.ok(
    Math.abs(D.notionalGammaPer1Pct(gamma, contracts, SPOT) - expected) < 1e-6,
    'closed form disagrees with the step-by-step derivation'
  );
});

test('notional scaling rejects junk input instead of returning NaN', () => {
  assert.equal(D.notionalGammaPer1Pct(NaN, 100, SPOT), 0);
  assert.equal(D.notionalGammaPer1Pct(0.002, NaN, SPOT), 0);
  assert.equal(D.notionalGammaPer1Pct(0.002, 100, 0), 0);
  assert.equal(D.notionalGammaPer1Pct(0.002, 100, -SPOT), 0);
});

// ───────────────────────────────────────────────────────────────────────────
test('signedPosition mirrors taker flow into a dealer book', () => {
  // Field names follow flow-gex.js: callBuyVol is what the DEALER bought.
  // Dealer bought 300, sold 500 -> net short 200 calls.
  const { callNet, putNet } = D.signedPosition({
    callBuyVol: 300, callSellVol: 500, putBuyVol: 100, putSellVol: 40,
  });
  assert.equal(callNet, -200);
  assert.equal(putNet, 60);
});

test('dealer who sold calls to takers is SHORT gamma', () => {
  const position = D.signedPosition({ callBuyVol: 0, callSellVol: 1000 });
  const out = D.strikeDealerGamma(position, { callGamma: 0.002, putGamma: 0 }, SPOT);
  assert.ok(out.netGamma$ < 0, 'selling calls must produce negative gamma');
});

test('dealer who sold puts to takers is ALSO short gamma (no double flip)', () => {
  // This is the trap: the OI-convention path negates the put term, and doing
  // that here as well would flip a short put position to positive gamma.
  const position = D.signedPosition({ putBuyVol: 0, putSellVol: 1000 });
  const out = D.strikeDealerGamma(position, { callGamma: 0, putGamma: 0.002 }, SPOT);
  assert.ok(out.netGamma$ < 0, 'selling puts must ALSO produce negative gamma');
});

test('long calls and long puts both give positive gamma', () => {
  const long = { callBuyVol: 500, callSellVol: 0, putBuyVol: 500, putSellVol: 0 };
  const out = D.strikeDealerGamma(D.signedPosition(long), { callGamma: 0.002, putGamma: 0.002 }, SPOT);
  assert.ok(out.callGamma$ > 0 && out.putGamma$ > 0);
});

test('a negative vendor gamma cannot flip a leg', () => {
  // gex-calculator.js applies Math.abs to vendor gamma for exactly this reason.
  const position = { callNet: 1000, putNet: 0 };
  const clean = D.strikeDealerGamma(position, { callGamma: 0.002 }, SPOT);
  const dirty = D.strikeDealerGamma(position, { callGamma: -0.002 }, SPOT);
  assert.equal(clean.netGamma$, dirty.netGamma$);
});

// ───────────────────────────────────────────────────────────────────────────
test('turnoverRatio: all volume changed open interest -> 1', () => {
  assert.equal(D.turnoverRatio(1000, 1000), 1);
});

test('turnoverRatio: pure intraday round-trip -> 0', () => {
  assert.equal(D.turnoverRatio(0, 5000), 0);
});

test('turnoverRatio is a magnitude, so net closing is still positive', () => {
  assert.equal(D.turnoverRatio(-400, 800), 0.5);
});

test('turnoverRatio clamps noise above 1', () => {
  // |ΔOI| > recorded volume happens routinely because flow_prints is
  // premium-floored and the OI snapshot is taken at a different instant.
  assert.equal(D.turnoverRatio(5000, 1000), 1);
  assert.equal(D.turnoverRatio(-5000, 1000), 1);
});

test('turnoverRatio returns 0 for unusable volume rather than Infinity', () => {
  assert.equal(D.turnoverRatio(100, 0), 0);
  assert.equal(D.turnoverRatio(100, -5), 0);
  assert.equal(D.turnoverRatio(NaN, 100), 0);
});

// ───────────────────────────────────────────────────────────────────────────
test("reconcile 'flow' mode is the naive mirror, ignoring OI", () => {
  const signed = { callNet: -1000, putNet: 400 };
  const out = D.reconcilePositionChange(signed, { call: 5, put: 5 }, 'flow');
  assert.deepEqual(out, { callNet: -1000, putNet: 400 });
});

test("reconcile 'oi' mode takes magnitude from OI, direction from flow", () => {
  // Tape says dealer sold 1000 calls, but OI only moved 300 -> trust OI's size.
  const out = D.reconcilePositionChange({ callNet: -1000, putNet: 0 }, { call: 300 }, 'oi');
  assert.equal(out.callNet, -300);
});

test("reconcile 'oi' mode does NOT flip sign when OI falls", () => {
  // This is the bug the earlier ΔOI/volume weighting had: a negative OI delta
  // multiplied a positive flow and drove the book further short.
  const out = D.reconcilePositionChange({ callNet: 1000, putNet: 0 }, { call: -1000 }, 'oi');
  assert.equal(out.callNet, 1000, 'dealer buying back must stay positive');
});

test("reconcile 'min' mode never exceeds either source", () => {
  assert.equal(D.reconcilePositionChange({ callNet: -1000 }, { call: 300 }, 'min').callNet, -300);
  assert.equal(D.reconcilePositionChange({ callNet: -200 }, { call: 900 }, 'min').callNet, -200);
});

test('reconcile: zero flow means no directional claim, whatever OI did', () => {
  // OI moved but the tape saw balanced two-way flow — we have no sign, so we
  // must not invent one.
  const out = D.reconcilePositionChange({ callNet: 0, putNet: 0 }, { call: 5000, put: 5000 }, 'oi');
  assert.deepEqual(out, { callNet: 0, putNet: 0 });
});

test('reconcile handles missing OI data without producing NaN', () => {
  const out = D.reconcilePositionChange({ callNet: -1000, putNet: 500 }, {}, 'oi');
  assert.equal(out.callNet, 0);
  assert.equal(out.putNet, 0);
  const min = D.reconcilePositionChange({ callNet: -1000 }, { call: undefined }, 'min');
  assert.equal(min.callNet, 0);
});

// ───────────────────────────────────────────────────────────────────────────
test('accumulateBook sums across days and expiries', () => {
  const days = [
    { date: '2026-07-27', expiration: '2026-07-31', strike: 6400,
      inventory: { callSellVol: 1000 }, callOiDelta: 1000, callVolume: 1000 },
    { date: '2026-07-28', expiration: '2026-07-31', strike: 6400,
      inventory: { callSellVol: 500 }, callOiDelta: 500, callVolume: 500 },
    { date: '2026-07-28', expiration: '2026-08-21', strike: 6500,
      inventory: { putSellVol: 200 }, putOiDelta: 200, putVolume: 200 },
  ];
  const book = D.accumulateBook(days);
  assert.equal(book.size, 2, 'two distinct expiry|strike keys');
  // OI delta equals flow at every strike here, so the days accumulate in full.
  assert.equal(book.get('2026-07-31|6400').callNet, -1500);
  assert.equal(book.get('2026-08-21|6500').putNet, -200);
});

test('OI anchoring shrinks a book the tape overstates', () => {
  // Tape shows 1000 contracts of dealer selling each day, but OI barely moved:
  // most of that volume was round-tripped, or was market-maker crossing.
  const days = [
    { date: '2026-07-27', expiration: '2026-07-31', strike: 6400,
      inventory: { callSellVol: 1000 }, callOiDelta: 50, callVolume: 1000 },
    { date: '2026-07-28', expiration: '2026-07-31', strike: 6400,
      inventory: { callSellVol: 1000 }, callOiDelta: 50, callVolume: 1000 },
  ];
  const naive = D.accumulateBook(days, { mode: 'flow' });
  const recon = D.accumulateBook(days, { mode: 'oi' });
  assert.equal(naive.get('2026-07-31|6400').callNet, -2000, 'naive accumulates the full mirror');
  assert.equal(recon.get('2026-07-31|6400').callNet, -100, 'OI-anchored keeps only what stuck');
});

test('a round trip across two days flattens the book (the regression case)', () => {
  // Dealer sells 1000 calls Monday, buys them back Tuesday. The book must end
  // FLAT. An earlier design multiplied signed flow by ΔOI/volume, which flipped
  // Tuesday's sign and reported short 2000 instead of zero.
  const days = [
    { date: '2026-07-27', expiration: '2026-08-21', strike: 6400,
      inventory: { callSellVol: 1000 }, callOiDelta: 1000, callVolume: 1000 },
    { date: '2026-07-28', expiration: '2026-08-21', strike: 6400,
      inventory: { callBuyVol: 1000 }, callOiDelta: -1000, callVolume: 1000 },
  ];
  for (const mode of ['flow', 'oi', 'min']) {
    assert.equal(
      D.accumulateBook(days, { mode }).get('2026-08-21|6400').callNet, 0,
      `mode '${mode}' must flatten a completed round trip`
    );
  }
});

test('accumulateBook drops contracts that already expired', () => {
  const days = [
    { date: '2026-07-20', expiration: '2026-07-24', strike: 6400,
      inventory: { callSellVol: 1000 }, callOiDelta: 1000, callVolume: 1000 },
    { date: '2026-07-28', expiration: '2026-08-21', strike: 6400,
      inventory: { callSellVol: 500 }, callOiDelta: 500, callVolume: 500 },
  ];
  const book = D.accumulateBook(days, { asOf: '2026-07-28' });
  assert.equal(book.size, 1);
  assert.ok(book.has('2026-08-21|6400'));
});

test('accumulateBook ignores malformed rows instead of throwing', () => {
  const book = D.accumulateBook([
    { date: '2026-07-28', expiration: '', strike: 6400, inventory: {} },
    { date: '2026-07-28', expiration: '2026-07-31', strike: 0, inventory: {} },
    { date: '2026-07-28', expiration: '2026-07-31', strike: NaN, inventory: {} },
    null,
  ]);
  assert.equal(book.size, 0);
  assert.equal(D.accumulateBook(null).size, 0);
});

// ───────────────────────────────────────────────────────────────────────────
test('bookDealerGamma totals and reports gamma coverage', () => {
  const book = D.accumulateBook([
    { date: '2026-07-28', expiration: '2026-07-31', strike: 6400,
      inventory: { callSellVol: 1000 }, callOiDelta: 1000, callVolume: 1000 },
    { date: '2026-07-28', expiration: '2026-07-31', strike: 6500,
      inventory: { callSellVol: 1000 }, callOiDelta: 1000, callVolume: 1000 },
  ]);
  const gammas = new Map([['2026-07-31|6400', { callGamma: 0.002, putGamma: 0.002 }]]);
  const { rows, totalGamma$, coverage } = D.bookDealerGamma(book, gammas, SPOT);
  assert.equal(rows.length, 2);
  assert.equal(coverage, 0.5, 'one of two strikes had a gamma supplied');
  assert.ok(totalGamma$ < 0, 'short calls at both strikes -> net short gamma');
  // The strike with no gamma contributes nothing rather than NaN.
  assert.equal(rows.find((r) => r.strike === 6500).netGamma$, 0);
});

test('bookDealerGamma accepts a plain object for gammas', () => {
  const book = D.accumulateBook([
    { date: '2026-07-28', expiration: '2026-07-31', strike: 6400,
      inventory: { callBuyVol: 100 }, callOiDelta: 100, callVolume: 100 },
  ]);
  const { totalGamma$ } = D.bookDealerGamma(book, { '2026-07-31|6400': { callGamma: 0.002 } }, SPOT);
  assert.ok(totalGamma$ > 0);
});

// ───────────────────────────────────────────────────────────────────────────
test('dealerGammaFlip interpolates the zero crossing', () => {
  // Cumulative curve: -100 at 6300, then +100 added at 6500 -> crosses at 6400.
  const rows = [
    { strike: 6300, netGamma$: -100 },
    { strike: 6500, netGamma$: 200 },
  ];
  const flip = D.dealerGammaFlip(rows, SPOT);
  assert.ok(Math.abs(flip - 6400) < 1e-9, `expected ~6400, got ${flip}`);
});

test('dealerGammaFlip picks the crossing nearest spot', () => {
  const rows = [
    { strike: 6000, netGamma$: -100 },
    { strike: 6100, netGamma$: 200 },   // crosses ~6050
    { strike: 6200, netGamma$: -200 },  // crosses again ~6250
    { strike: 6400, netGamma$: 0 },
    { strike: 6500, netGamma$: 400 },
  ];
  const flip = D.dealerGammaFlip(rows, 6300);
  assert.ok(flip > 6100, `expected the crossing near spot, got ${flip}`);
});

test('dealerGammaFlip returns null when the curve never crosses', () => {
  assert.equal(D.dealerGammaFlip([
    { strike: 6300, netGamma$: 100 },
    { strike: 6400, netGamma$: 100 },
  ], SPOT), null);
  assert.equal(D.dealerGammaFlip([{ strike: 6400, netGamma$: 1 }], SPOT), null);
  assert.equal(D.dealerGammaFlip(null, SPOT), null);
});

test('dealerGammaFlip aggregates duplicate strikes across expiries first', () => {
  const rows = [
    { strike: 6300, netGamma$: -50, expiration: 'a' },
    { strike: 6300, netGamma$: -50, expiration: 'b' },
    { strike: 6500, netGamma$: 200, expiration: 'a' },
  ];
  const flip = D.dealerGammaFlip(rows, SPOT);
  assert.ok(Math.abs(flip - 6400) < 1e-9, `expected ~6400, got ${flip}`);
});
