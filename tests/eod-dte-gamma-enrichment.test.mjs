/**
 * tests/eod-dte-gamma-enrichment.test.mjs
 *
 * Verifies the Postgres enrichment in server-v2/eod-dte-gamma-recorder.js —
 * the step that decides whether a bucket gets to claim "measured".
 *
 * A stub pool is injected, so this runs with no database and cannot touch one.
 *
 * The failure modes pinned down here:
 *   1. Dealer-mirror direction (taker buy must become dealer SELL).
 *   2. Strikes with flow but no OI baseline must fall back to convention
 *      rather than silently reporting zero gamma under the 'oi' estimator.
 *   3. Flow for a strike the chain doesn't list must not create phantom rows.
 *   4. A single oi_daily snapshot (no prior) must yield no deltas, not NaN.
 *
 * Run: node --test tests/eod-dte-gamma-enrichment.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../server-v2/eod-dte-gamma-recorder.js');

/** Minimal pg-shaped stub. Routes on distinguishing fragments of each query. */
function stubPool({ flow = [], oi = [] } = {}) {
  return {
    async query(sql) {
      if (/FROM flow_prints/.test(sql)) return { rows: flow };
      if (/FROM oi_daily/.test(sql)) return { rows: oi };
      throw new Error('stub: unexpected query');
    },
  };
}

const strike = (expiration, k) => ({
  expiration, strike: k, callGamma: 0.002, putGamma: 0.002, callOi: 100, putOi: 100,
});

const CTX = { symbol: '$SPX', date: '2026-07-29', underlying: 'SPX' };

const OI_TWO_DAYS = [
  { date: '2026-07-28', expiry: '2026-07-29', strike: 6400, call_oi: 1000, put_oi: 900 },
  { date: '2026-07-29', expiry: '2026-07-29', strike: 6400, call_oi: 1500, put_oi: 700 },
];

// ───────────────────────────────────────────────────────────────────────────
test('taker buys become dealer sells (the mirror)', async () => {
  const strikes = [strike('2026-07-29', 6400)];
  const out = await R.enrichWithFlowAndOi(strikes, CTX, stubPool({
    flow: [
      { expiration: '2026-07-29', strike: 6400, type: 'C', side: 'buy', vol: 800 },
      { expiration: '2026-07-29', strike: 6400, type: 'P', side: 'sell', vol: 300 },
    ],
    oi: OI_TWO_DAYS,
  }));
  assert.equal(out.flowStrikes, 1);
  assert.equal(strikes[0].inventory.callSellVol, 800, 'taker buy -> dealer sold');
  assert.equal(strikes[0].inventory.callBuyVol, 0);
  assert.equal(strikes[0].inventory.putBuyVol, 300, 'taker sell -> dealer bought');
  assert.equal(strikes[0].inventory.putSellVol, 0);
});

test('OI deltas are today minus the prior available snapshot', async () => {
  const strikes = [strike('2026-07-29', 6400)];
  const out = await R.enrichWithFlowAndOi(strikes, CTX, stubPool({ oi: OI_TWO_DAYS }));
  assert.equal(out.oiStrikes, 1);
  assert.equal(strikes[0].callOiDelta, 500);
  assert.equal(strikes[0].putOiDelta, -200);
});

test('flow with NO OI baseline falls back to convention', async () => {
  // Under the default 'oi' estimator, magnitude comes from |ΔOI|. With no
  // baseline that is zero, which would silently void the strike. It must lose
  // its inventory and be priced by convention instead.
  const strikes = [strike('2026-08-21', 6400)];
  const out = await R.enrichWithFlowAndOi(strikes, CTX, stubPool({
    flow: [{ expiration: '2026-08-21', strike: 6400, type: 'C', side: 'buy', vol: 500 }],
    oi: OI_TWO_DAYS, // only covers 2026-07-29, not this expiry
  }));
  assert.equal(strikes[0].inventory, undefined, 'inventory must be dropped');
  assert.equal(out.flowStrikes, 0, 'and must not be counted as measured');
});

test('flow for an unlisted strike creates no phantom rows', async () => {
  const strikes = [strike('2026-07-29', 6400)];
  const before = strikes.length;
  await R.enrichWithFlowAndOi(strikes, CTX, stubPool({
    flow: [{ expiration: '2026-07-29', strike: 9999, type: 'C', side: 'buy', vol: 500 }],
    oi: OI_TWO_DAYS,
  }));
  assert.equal(strikes.length, before);
  assert.equal(strikes[0].inventory, undefined);
});

test('a single OI snapshot yields no deltas rather than NaN', async () => {
  const strikes = [strike('2026-07-29', 6400)];
  const out = await R.enrichWithFlowAndOi(strikes, CTX, stubPool({
    oi: [OI_TWO_DAYS[1]], // today only
  }));
  assert.equal(out.oiStrikes, 0);
  assert.equal(strikes[0].callOiDelta, undefined);
});

test('multiple prints at one strike accumulate', async () => {
  const strikes = [strike('2026-07-29', 6400)];
  await R.enrichWithFlowAndOi(strikes, CTX, stubPool({
    flow: [
      { expiration: '2026-07-29', strike: 6400, type: 'C', side: 'buy', vol: 300 },
      { expiration: '2026-07-29', strike: 6400, type: 'C', side: 'sell', vol: 120 },
    ],
    oi: OI_TWO_DAYS,
  }));
  assert.equal(strikes[0].inventory.callSellVol, 300);
  assert.equal(strikes[0].inventory.callBuyVol, 120);
});

test('enrichment degrades quietly when a query throws', async () => {
  const strikes = [strike('2026-07-29', 6400)];
  const broken = { async query() { throw new Error('connection reset'); } };
  const out = await R.enrichWithFlowAndOi(strikes, CTX, broken);
  assert.deepEqual(out, { flowStrikes: 0, oiStrikes: 0 });
  assert.equal(strikes[0].inventory, undefined, 'strike survives, just unmeasured');
});

test('no pool and no strikes are both no-ops', async () => {
  assert.deepEqual(await R.enrichWithFlowAndOi([], CTX, stubPool()), { flowStrikes: 0, oiStrikes: 0 });
  assert.deepEqual(await R.enrichWithFlowAndOi(null, CTX, stubPool()), { flowStrikes: 0, oiStrikes: 0 });
});

// ───────────────────────────────────────────────────────────────────────────
test('end to end: enriched chain produces a measured 0DTE bucket', async () => {
  const { bucketChain } = require('../server-v2/computation/dte-buckets.js');
  const strikes = [
    strike('2026-07-29', 6400),          // 0DTE, will be enriched
    strike('2026-10-27', 6400),          // 90 DTE, convention only
  ];
  await R.enrichWithFlowAndOi(strikes, CTX, stubPool({
    flow: [{ expiration: '2026-07-29', strike: 6400, type: 'C', side: 'buy', vol: 800 }],
    oi: OI_TWO_DAYS,
  }));

  const snap = bucketChain({ sessionDate: CTX.date, spot: 6400, strikes });
  const zero = snap.buckets.find((b) => b.key === '0dte');
  const back = snap.buckets.find((b) => b.key === 'back');

  assert.equal(zero.basis, 'measured');
  assert.ok(zero.netGamma < 0, 'dealer sold calls into taker buying -> short gamma');
  assert.equal(back.basis, 'convention');

  // Rollup arithmetic must still hold after enrichment.
  const all = snap.rollups.find((r) => r.key === 'all');
  const ex = snap.rollups.find((r) => r.key === 'ex0dte');
  assert.ok(Math.abs(all.netGamma - snap.totals.net) < 1e-6);
  assert.ok(Math.abs(ex.netGamma - (snap.totals.net - zero.netGamma)) < 1e-6);
});
