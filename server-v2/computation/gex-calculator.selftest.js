'use strict';
/**
 * server-v2/computation/gex-calculator.selftest.js
 *
 *   node server-v2/computation/gex-calculator.selftest.js
 *
 * Covers the 2026-08-23 wall/flip options. The point of most of these cases is
 * the REGRESSION half: every existing caller passes no options, and must get
 * back exactly what it got before the options existed.
 *
 * The fixture reproduces the shape that made gex_levels_history useless — a
 * single near-dated expiry where the day's VOLUME dwarfs open interest and
 * piles up at the money, so the 'oivol' argmax lands on the strike next to
 * spot while the real open-interest concentration sits 70+ points away.
 */

const assert = require('assert');
const {
  findCallWall,
  findPutWall,
  findGexFlip,
} = require('./gex-calculator');

const SPOT = 7650;
const B = 1e9;

/** strike, OI-based netGEX (B$), volume-based netVolGEX (B$), callOI, putOI */
const F = [
  [7400, -0.4, -0.1, 20, 6800],   // the real put-side book, far from spot
  [7500, -0.3, -0.1, 40, 4200],
  [7580, -0.8, -0.3, 30, 6200],   // 'oi' put wall once the dead zone applies
  [7640, -0.1, -2.4, 200, 520],   // adjacent strike: tiny book, enormous tape
  [7645, -0.1, -1.9, 80, 310],    // ditto
  [7655, 0.1, 2.6, 950, 2000],    // ditto, other side
  [7660, 0.1, 3.1, 390, 400],     // 'oivol' call wall — 10 pts from spot
  [7720, 0.9, 0.2, 640, 360],     // 'oi' call wall
  [7850, 0.2, 0.0, 2600, 110],    // 'oiRaw' call wall — the open-contract peak
].map(([strike, oi, vol, callOI, putOI]) => ({
  strike, netGEX: oi * B, netVolGEX: vol * B, callOI, putOI,
}));

let n = 0;
const check = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

console.log('gex-calculator: walls');

check('no options = the old behaviour, exactly (oivol argmax)', () => {
  assert.strictEqual(findCallWall(F, SPOT), 7660);
  assert.strictEqual(findPutWall(F, SPOT), 7640);
});

check('the default walls really do hug spot — this is the bug being fixed', () => {
  assert.ok(findCallWall(F, SPOT) - SPOT <= 10);
  assert.ok(SPOT - findPutWall(F, SPOT) <= 10);
});

check("basis 'oi' drops the volume term and moves both walls out", () => {
  assert.strictEqual(findCallWall(F, SPOT, { basis: 'oi' }), 7720);
  assert.strictEqual(findPutWall(F, SPOT, { basis: 'oi' }), 7580);
});

check("basis 'oiRaw' picks the open-contract peak, gamma ignored", () => {
  assert.strictEqual(findCallWall(F, SPOT, { basis: 'oiRaw' }), 7850);
  assert.strictEqual(findPutWall(F, SPOT, { basis: 'oiRaw' }), 7400);
});

check('minDistancePct evicts the adjacent strike', () => {
  // 0.25% of 7650 = 19.1 pts, so 7640/7655/7660 are all out of the running.
  assert.strictEqual(findPutWall(F, SPOT, { minDistancePct: 0.25 }), 7580);
  assert.strictEqual(findCallWall(F, SPOT, { minDistancePct: 0.25 }), 7720);
});

check('minDistance in points works the same way', () => {
  assert.strictEqual(findPutWall(F, SPOT, { minDistance: 20 }), 7580);
});

check('minDistance and minDistancePct combine as a max, not a sum', () => {
  // 100 pts beats 0.25% (19 pts), so 7580 (70 pts out) is excluded too, leaving
  // 7400 (-0.5B) ahead of 7500 (-0.4B).
  assert.strictEqual(findPutWall(F, SPOT, { minDistance: 100, minDistancePct: 0.25 }), 7400);
});

check('a dead zone that excludes everything returns null, never a fallback', () => {
  assert.strictEqual(findCallWall(F, SPOT, { minDistancePct: 50 }), null);
  assert.strictEqual(findPutWall(F, SPOT, { minDistancePct: 50 }), null);
});

check('exclude still works, and composes with basis + dead zone', () => {
  const o = { basis: 'oi', minDistancePct: 0.25 };
  const r1 = findCallWall(F, SPOT, o);
  const r2 = findCallWall(F, SPOT, { ...o, exclude: r1 });
  assert.strictEqual(r1, 7720);
  assert.strictEqual(r2, 7850);
  assert.notStrictEqual(r2, r1 + 5);   // the old R2 was always one strike past R1
});

check('an unknown basis falls back to oivol rather than throwing', () => {
  assert.strictEqual(findCallWall(F, SPOT, { basis: 'nonsense' }), findCallWall(F, SPOT));
});

console.log('gex-calculator: flip');

// Cumulative net GEX crosses zero three times: ~7055, ~7250 and ~7622. The old
// scan takes the lowest one and calls it "neutral" — 600 points from spot.
const CROSSES = [
  [7000, -5], [7100, +9], [7200, -9], [7500, +8], [7600, -8], [7640, +9],
].map(([strike, v]) => ({ strike, netGEX: v * B, netVolGEX: 0 }));

check('no options = first negative→positive crossing from the bottom', () => {
  const f = findGexFlip(CROSSES, SPOT);
  assert.ok(f > 7050 && f < 7060, 'got ' + f);
});

check('nearest:true returns the crossing closest to spot instead', () => {
  const f = findGexFlip(CROSSES, SPOT, { nearest: true });
  assert.ok(f > 7615 && f < 7630, 'got ' + f);
});

check('nearest also sees positive→negative crossings, which the old scan missed', () => {
  const down = [[7500, +6], [7600, -9]].map(([strike, v]) => ({ strike, netGEX: v * B, netVolGEX: 0 }));
  assert.strictEqual(findGexFlip(down, SPOT), null);          // legacy: blind to it
  assert.ok(findGexFlip(down, SPOT, { nearest: true }) > 7500);
});

check('maxDistancePct rejects a crossing nobody should trade', () => {
  assert.strictEqual(findGexFlip(CROSSES, SPOT, { nearest: true, maxDistancePct: 0.05 }), null);
  assert.ok(findGexFlip(CROSSES, SPOT, { nearest: true, maxDistancePct: 1 }) > 7600);
});

check('a chain that never crosses returns null in both modes', () => {
  const flat = [[7500, -2], [7600, -3], [7700, -4]].map(([strike, v]) => ({ strike, netGEX: v * B, netVolGEX: 0 }));
  assert.strictEqual(findGexFlip(flat, SPOT), null);
  assert.strictEqual(findGexFlip(flat, SPOT, { nearest: true }), null);
});

check('empty input and a zero spot are null, not a throw', () => {
  assert.strictEqual(findGexFlip([], SPOT), null);
  assert.strictEqual(findGexFlip(CROSSES, 0), null);
  assert.strictEqual(findCallWall([], SPOT), null);
});

console.log('\n' + n + ' checks passed');
