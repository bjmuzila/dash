'use strict';
// node server-v2/vela-alert-lists.selftest.js
// The pure half of vela-alert-lists.cjs: when a row rings, and the level maths
// ported from the browser. No database, no network.
const assert = require('node:assert/strict');
const { _test: T } = require('./vela-alert-lists.cjs');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const now = Date.parse('2026-10-09T15:00:00Z');
const base = { prevAt: now - 60_000, now, lastFiredAt: null, cooldownMin: 30 };

console.log('decide');
ok('rings crossing up', () => {
  const d = T.decide({ ...base, prevPrice: 99, price: 101, level: 100 });
  assert.equal(d.ring, true); assert.equal(d.dir, 'up');
});
ok('rings crossing down, touching counts', () => {
  const d = T.decide({ ...base, prevPrice: 101, price: 100, level: 100 });
  assert.equal(d.ring, true); assert.equal(d.dir, 'down');
});
ok('no ring when both on one side', () => assert.equal(T.decide({ ...base, prevPrice: 101, price: 102, level: 100 }).ring, false));
ok('a level that jumped across a still price is not a cross', () => {
  // last minute the level was 98 (price above); now it is 103 (price below) but price did not move through it
  assert.equal(T.decide({ ...base, prevPrice: 101, price: 101.5, level: 103 }).ring, false);
});
ok('cooldown holds a second ring', () => {
  const d = T.decide({ ...base, prevPrice: 99, price: 101, level: 100, lastFiredAt: now - 10 * 60_000 });
  assert.equal(d.ring, false); assert.equal(d.why, 'cooling down');
});
ok('rings again after the cooldown', () => {
  assert.equal(T.decide({ ...base, prevPrice: 99, price: 101, level: 100, lastFiredAt: now - 31 * 60_000 }).ring, true);
});
ok('a stale previous reading (overnight gap) is not compared', () => {
  assert.equal(T.decide({ ...base, prevPrice: 99, price: 101, level: 100, prevAt: now - 3 * 3600_000 }).ring, false);
});
ok('first reading never rings', () => assert.equal(T.decide({ ...base, prevPrice: null, price: 101, level: 100 }).ring, false));

console.log('symbols');
ok('cleans tickers like the panel', () => {
  assert.equal(T.cleanSymbol('cbedge:nvda'), 'NVDA');
  assert.equal(T.cleanSymbol('/NQ'), 'NQ');
  assert.equal(T.cleanSymbol('ES1!'), 'ES');
  assert.equal(T.cleanSymbol('BRK.B'), 'BRK.B');
  assert.equal(T.cleanSymbol('not a ticker'), null);
  assert.equal(T.cleanSymbol(''), null);
});
ok('only Discord webhooks are accepted', () => {
  assert.equal(T.isHook('https://discord.com/api/webhooks/123/abc-DEF_1'), true);
  assert.equal(T.isHook('https://evil.example/api/webhooks/123/abc'), false);
  assert.equal(T.isHook('http://discord.com/api/webhooks/123/abc'), false);
});

console.log('session levels');
// 5-minute bars, ET. 2026-10-08 prior session, 2026-10-09 today.
const et = (d, hm) => Date.parse(`${d}T${hm}:00-04:00`);
const bar = (t, o, h, l, c) => ({ time: t, open: o, high: h, low: l, close: c, volume: 1 });
const bars = [
  bar(et('2026-10-08', '09:30'), 100, 102, 99, 101),
  bar(et('2026-10-08', '15:55'), 101, 105, 100, 104),
  bar(et('2026-10-08', '18:30'), 104, 106, 103, 105), // futures overnight
  bar(et('2026-10-09', '04:00'), 105, 108, 104, 107),
  bar(et('2026-10-09', '09:30'), 107, 109, 106, 108),
  bar(et('2026-10-09', '10:25'), 108, 111, 107, 110),
  bar(et('2026-10-09', '10:35'), 110, 112, 109, 111),
];
ok('stock: IB, overnight from 04:00, open, prior day', () => {
  const s = T.sessionLevels(bars, false);
  assert.equal(s.ibh, 111); assert.equal(s.ibl, 106);
  assert.equal(s.onh, 108); assert.equal(s.onl, 104);
  assert.equal(s.open, 107);
  assert.equal(s.pdh, 105); assert.equal(s.pdl, 99); assert.equal(s.pdc, 104);
});
ok('futures: overnight reaches back to 18:00', () => {
  const s = T.sessionLevels(bars, true);
  assert.equal(s.onh, 108); assert.equal(s.onl, 103);
});
ok('IB waits for 10:30', () => {
  const s = T.sessionLevels(bars.slice(0, 6), false);
  assert.equal(s.ibh, null);
});

console.log('voltick levels');
const ladder = [
  { strike: 95, net: -40 }, { strike: 100, net: -90 }, { strike: 105, net: 30 },
  { strike: 110, net: 200 }, { strike: 115, net: 120 }, { strike: 120, net: 60 },
];
ok('Volt, Reversal across spot, Surge, Coil', () => {
  const v = T.vtFromLadder(ladder, 104, {});
  assert.deepEqual(v, { volt: 110, reversal: 100, surge: 115, coil: null });
});
ok('Coil is at least half the Volt', () => {
  const v = T.vtFromLadder([...ladder, { strike: 125, net: 101 }], 104, {});
  assert.equal(v.coil, 125);
  assert.equal(T.vtFromLadder([...ladder, { strike: 125, net: 101 }], 104, { coil: false }).coil, null);
});
ok('flip: the sign change nearest spot', () => {
  assert.equal(T.flipOf(ladder, 104), 103.8);
});
ok('a futures chain shifts every level by the basis', () => {
  const chain = { data: { underlyingPrice: 104, items: [{ 'expiration-date': '2026-10-09', strikes: [
    { 'strike-price': 100, call: { gamma: 0.01, 'open-interest': 0, volume: 0 }, put: { gamma: 0.02, 'open-interest': 0, volume: 900 } },
    { 'strike-price': 110, call: { gamma: 0.03, 'open-interest': 0, volume: 1000 }, put: { gamma: 0, 'open-interest': 0, volume: 0 } },
  ] }] } };
  const g = T.gexLevels(chain, 154, 'vol', true, 50);
  assert.equal(g.volt, 160); assert.equal(g.reversal, 150);
});
ok('no basis on a futures symbol means no GEX levels, not unshifted ones', () => {
  assert.equal(T.gexLevels({ data: { underlyingPrice: 104, items: [] } }, 154, 'vol', true, NaN), null);
});

console.log(`\n${n} passed`);
