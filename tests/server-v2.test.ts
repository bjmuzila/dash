// tests/server-v2.test.ts
// Unit tests for the from-scratch proxy's pure calculation modules.
// Run with: npx tsx --test tests/server-v2.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

// CommonJS modules — import via require interop.
const {
  computeGexRows,
  findGexFlip,
  findCallWall,
  findPutWall,
  totalNetGex,
  computeGexSummary,
} = require('../server-v2/computation/gex-calculator');
const { bsGreeks, bsPrice, impliedVol, parseOptionSymbol } = require('../server-v2/computation/utils');
const { computeVexChexRow, emptyTotals, accumulateExposureTotals } = require('../server-v2/computation/vex-chex');
const { FlowProcessor, inferSide } = require('../server-v2/computation/flow-processor');

// ---------------------------------------------------------------------------
// GEX calculator
// ---------------------------------------------------------------------------

test('computeGexRows: GEX sign convention (calls +, puts -)', () => {
  const spot = 5000;
  const rows = [
    { strike: 5000, side: 'call', oi: 100, volume: 0, gamma: 0.01, delta: 0.5, theta: 0, vega: 0, vanna: 0, charm: 0, iv: 0.2, dte: 1 },
    { strike: 5000, side: 'put', oi: 100, volume: 0, gamma: 0.01, delta: -0.5, theta: 0, vega: 0, vanna: 0, charm: 0, iv: 0.2, dte: 1 },
  ];
  const out = computeGexRows(rows, spot);
  assert.equal(out.length, 1);
  const r = out[0];
  // callGEX = 0.01*100*5000^2 = 25,000,000 ; putGEX = -same ; net = 0
  assert.equal(r.callGEX, 0.01 * 100 * spot * spot);
  assert.equal(r.putGEX, -(0.01 * 100 * spot * spot));
  assert.equal(r.netGEX, 0);
});

test('computeGexRows: rows sorted ascending by strike', () => {
  const rows = [
    { strike: 5100, side: 'call', oi: 1, volume: 0, gamma: 0.01, delta: 0.5, theta: 0, vega: 0, vanna: 0, charm: 0, iv: 0.2, dte: 1 },
    { strike: 4900, side: 'put', oi: 1, volume: 0, gamma: 0.01, delta: -0.5, theta: 0, vega: 0, vanna: 0, charm: 0, iv: 0.2, dte: 1 },
  ];
  const out = computeGexRows(rows, 5000);
  assert.deepEqual(out.map((r: any) => r.strike), [4900, 5100]);
});

test('findGexFlip: interpolates the zero-crossing of cumulative net GEX', () => {
  // Construct rows so cumulative net GEX crosses zero between 5000 and 5010.
  const gexRows = [
    { strike: 4990, netGEX: -100 },
    { strike: 5000, netGEX: -100 }, // cum -200
    { strike: 5010, netGEX: 300 },  // cum +100 -> crossing in [5000,5010]
  ];
  const flip = findGexFlip(gexRows as any, 5000);
  assert.ok(flip > 5000 && flip < 5010, `flip ${flip} should be between 5000 and 5010`);
  // cum at 5000 = -200, range 300 -> 5000 + 10*(200/300) = 5006.67
  assert.ok(Math.abs(flip - 5006.6667) < 0.01);
});

test('findCallWall / findPutWall: extremes relative to spot', () => {
  const gexRows = [
    { strike: 4900, netGEX: -500 },
    { strike: 4950, netGEX: -200 },
    { strike: 5050, netGEX: 300 },
    { strike: 5100, netGEX: 800 },
  ];
  assert.equal(findCallWall(gexRows as any, 5000), 5100); // max positive above spot
  assert.equal(findPutWall(gexRows as any, 5000), 4900);  // most negative below spot
});

test('totalNetGex sums netGEX', () => {
  const gexRows = [{ netGEX: 100 }, { netGEX: -40 }, { netGEX: 5 }];
  assert.equal(totalNetGex(gexRows as any), 65);
});

test('computeGexSummary returns rows + all levels', () => {
  const rows = [
    { strike: 5050, side: 'call', oi: 100, volume: 0, gamma: 0.02, delta: 0.4, theta: 0, vega: 0, vanna: 0, charm: 0, iv: 0.2, dte: 1 },
    { strike: 4950, side: 'put', oi: 100, volume: 0, gamma: 0.02, delta: -0.4, theta: 0, vega: 0, vanna: 0, charm: 0, iv: 0.2, dte: 1 },
  ];
  const s = computeGexSummary(rows, 5000);
  assert.ok(Array.isArray(s.rows));
  assert.equal(s.callWall, 5050);
  assert.equal(s.putWall, 4950);
  assert.equal(typeof s.totalNetGex, 'number');
});

// ---------------------------------------------------------------------------
// Black-Scholes (utils)
// ---------------------------------------------------------------------------

test('bsGreeks: ATM call delta ~0.5, gamma > 0', () => {
  const g = bsGreeks({ S: 100, K: 100, T: 0.25, sigma: 0.2, r: 0.0, type: 'C' });
  assert.ok(Math.abs(g.delta - 0.5) < 0.05, `delta ${g.delta}`);
  assert.ok(g.gamma > 0);
  assert.ok(g.vega > 0);
});

test('bsGreeks: put delta = call delta - 1 (put-call parity on delta)', () => {
  const c = bsGreeks({ S: 100, K: 105, T: 0.5, sigma: 0.25, r: 0.03, type: 'C' });
  const p = bsGreeks({ S: 100, K: 105, T: 0.5, sigma: 0.25, r: 0.03, type: 'P' });
  assert.ok(Math.abs(p.delta - (c.delta - 1)) < 1e-9);
  // gamma identical for call & put
  assert.ok(Math.abs(c.gamma - p.gamma) < 1e-12);
});

test('bsPrice/impliedVol round-trip recovers sigma', () => {
  const sigma = 0.32;
  const px = bsPrice({ S: 100, K: 100, T: 0.5, sigma, r: 0.04, type: 'C' });
  const iv = impliedVol({ price: px, S: 100, K: 100, T: 0.5, r: 0.04, type: 'C' });
  assert.ok(Math.abs(iv - sigma) < 1e-3, `iv ${iv} vs ${sigma}`);
});

test('bsGreeks: zero/invalid inputs return zeros, not NaN', () => {
  const g = bsGreeks({ S: 0, K: 100, T: 0.5, sigma: 0.2, type: 'C' });
  assert.equal(g.gamma, 0);
  assert.equal(g.delta, 0);
});

test('parseOptionSymbol: parses dxFeed streamer symbol', () => {
  assert.deepEqual(parseOptionSymbol('.SPXW250620C5000'), {
    root: 'SPXW',
    expiration: '2025-06-20',
    type: 'C',
    strike: 5000,
  });
  assert.equal(parseOptionSymbol('garbage'), null);
});

// ---------------------------------------------------------------------------
// VEX / CHEX
// ---------------------------------------------------------------------------

test('computeVexChexRow: emits netVanna + netVolVanna (dashboard names)', () => {
  const out = computeVexChexRow({
    call: { oi: 100, volume: 10, vanna: 0.01, charm: 0.001 },
    put: { oi: 50, volume: 5, vanna: 0.01, charm: 0.001 },
    spot: 5000,
  });
  assert.ok('netVanna' in out);
  assert.ok('netVolVanna' in out);
  assert.ok('chex' in out);
  // netVanna = (0.01*100 - 0.01*50) * 5000*100 = 0.5 * 500000 = 250000
  assert.equal(out.netVanna, (0.01 * 100 - 0.01 * 50) * 5000 * 100);
});

test('accumulateExposureTotals: calls add, puts subtract on totalGEX', () => {
  const totals = emptyTotals();
  accumulateExposureTotals({ totals, isCall: true, gamma: 0.01, delta: 0.5, theta: 0, vega: 0, vanna: 0, charm: 0, contracts: 100, spot: 5000 });
  const afterCall = totals.totalGEX;
  assert.ok(afterCall > 0);
  accumulateExposureTotals({ totals, isCall: false, gamma: 0.01, delta: -0.5, theta: 0, vega: 0, vanna: 0, charm: 0, contracts: 100, spot: 5000 });
  assert.equal(totals.totalGEX, 0); // equal & opposite
});

// ---------------------------------------------------------------------------
// Flow processor
// ---------------------------------------------------------------------------

test('inferSide: classifies vs bid/ask', () => {
  const q = { bid: 1.0, ask: 1.2 };
  assert.equal(inferSide(1.2, q), 'buy');   // at ask
  assert.equal(inferSide(1.0, q), 'sell');  // at bid
  assert.equal(inferSide(1.1, q), 'mid');   // exact mid
  assert.equal(inferSide(1.15, q), 'buy');  // above mid
  assert.equal(inferSide(1.0, null), 'unknown');
});

test('FlowProcessor: buckets buy/sell volume and buyPct', () => {
  const fp = new FlowProcessor({ windowMs: 60000 });
  // call buy (at ask), put buy (at ask)
  fp.addPrint({ streamerSymbol: '.SPXW250620C5000', price: 1.2, size: 10, quote: { bid: 1.0, ask: 1.2 } });
  fp.addPrint({ streamerSymbol: '.SPXW250620P5000', price: 2.2, size: 30, quote: { bid: 2.0, ask: 2.2 } });
  // put sell (at bid)
  fp.addPrint({ streamerSymbol: '.SPXW250620P4900', price: 1.0, size: 10, quote: { bid: 1.0, ask: 1.3 } });
  const b = fp.bucket('SPX');
  assert.equal(b.callBuyVol, 10);
  assert.equal(b.putBuyVol, 30);
  assert.equal(b.putSellVol, 10);
  assert.equal(b.prints, 3);
  // buyPct = 40 / 50 = 80
  assert.ok(Math.abs(b.buyPct - 80) < 1e-6);
});

test('FlowProcessor.prune drops prints older than window', () => {
  const fp = new FlowProcessor({ windowMs: 1000 });
  const now = Date.now();
  fp.addPrint({ streamerSymbol: '.SPXW250620C5000', price: 1.2, size: 1, time: now - 5000, quote: { bid: 1.0, ask: 1.2 } });
  fp.addPrint({ streamerSymbol: '.SPXW250620C5000', price: 1.2, size: 1, time: now, quote: { bid: 1.0, ask: 1.2 } });
  const b = fp.bucket('SPX', now);
  assert.equal(b.prints, 1); // old one pruned
});
