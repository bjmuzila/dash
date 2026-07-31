'use strict';
/**
 * server-v2/cb-contract-track.selftest.js
 *
 * Offline check for the CB contract trade rules and for the probe wiring.
 *
 *   node server-v2/cb-contract-track.selftest.js
 *
 * Phase 1 exercises the pure rule helpers (side selection, the $1.00 gate, the
 * 5-10 pt band, P&L, checkpoint scheduling, snapshot matching) — no DB, no TT.
 * Phase 2 stubs `/proxy/probe-rest` at the ctx.internalFetch boundary and checks
 * that probeContract() reads a real TastyTrade probe payload correctly and asks
 * for the right contract: root SPXW (not SPX — on monthly Fridays TT returns the
 * AM-settled monthly under the same date/strike, which is not the 0DTE
 * instrument this strategy trades), expiry = the session date, and the CB strike.
 *
 * Everything that touches cb_trades needs Postgres and is therefore NOT covered
 * here; run the route by hand against a dev DB for that:
 *   curl -XPOST localhost:3000/api/cb-trades -H 'x-internal-token: …' \
 *        -d '{"action":"checkpoint","checkpoint":"0945"}'
 *
 * Exits non-zero on the first failure.
 */

const assert = require('assert');

// _lib-db.cjs is required lazily inside the module (only the DB paths touch it),
// so this loads fine with no pg present.
const t = require('./cb-contract-track');

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}
async function checkAsync(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

const M = (h, m) => h * 60 + m;

console.log('cb-contract-track selftest');

// ── Rule 2: side selection ─────────────────────────────────────────────────
check('SPX under the CB buys the call', () => {
  assert.strictEqual(t.decideSide(6595, 6650), 'C');
});
check('SPX over the CB buys the put', () => {
  assert.strictEqual(t.decideSide(6700, 6650), 'P');
});
check('exactly at the CB defaults to the call', () => {
  assert.strictEqual(t.decideSide(6650, 6650), 'C');
});
check('a missing spot or strike picks no side at all', () => {
  assert.strictEqual(t.decideSide(null, 6650), null);
  assert.strictEqual(t.decideSide(6650, null), null);
});

// ── Rule 1: the $1.00 auto-buy gate ────────────────────────────────────────
check('a mark at the cap buys', () => assert.strictEqual(t.shouldBuy(1.0), true));
check('a mark under the cap buys', () => assert.strictEqual(t.shouldBuy(0.55), true));
check('a mark over the cap does not', () => assert.strictEqual(t.shouldBuy(1.01), false));
check('a null or zero mark never buys', () => {
  assert.strictEqual(t.shouldBuy(null), false);
  assert.strictEqual(t.shouldBuy(0), false);
});

// ── Rule 3: the 5-10 pt sell band ──────────────────────────────────────────
check('the sell fires at the OUTER edge of the band', () => {
  const r = t.sellCheck(6640, 6650);          // exactly 10 pts
  assert.strictEqual(r.dist, 10);
  assert.strictEqual(r.fire, true);
  assert.strictEqual(r.tight, false);
});
check('11 pts away does not fire', () => {
  assert.strictEqual(t.sellCheck(6639, 6650).fire, false);
});
check('a gap straight through the band still fires, and reads tight', () => {
  const r = t.sellCheck(6648, 6650);
  assert.strictEqual(r.dist, 2);
  assert.strictEqual(r.fire, true);
  assert.strictEqual(r.tight, true);
});
check('the band is symmetric — above the CB counts too', () => {
  assert.strictEqual(t.sellCheck(6657, 6650).fire, true);
});
check('no spot means no sell — never a fire on missing data', () => {
  assert.deepStrictEqual(t.sellCheck(null, 6650), { dist: null, fire: false, tight: false });
});

// ── P&L ────────────────────────────────────────────────────────────────────
check('P&L is exit minus entry, times the 100x multiplier for dollars', () => {
  assert.deepStrictEqual(t.computePnl(0.55, 3.4), { pnl: 2.85, pnlUsd: 285 });
});
check('a losing mark-out is negative, not clamped', () => {
  assert.deepStrictEqual(t.computePnl(0.9, 0.05), { pnl: -0.85, pnlUsd: -85 });
});
check('a missing exit yields no P&L rather than a zero', () => {
  assert.deepStrictEqual(t.computePnl(0.55, null), { pnl: null, pnlUsd: null });
});

// ── Checkpoint scheduling ──────────────────────────────────────────────────
check('a checkpoint is due from its minute through the grace window', () => {
  assert.deepStrictEqual(t.dueCheckpoints(M(9, 45)).map((c) => c.key), ['0945']);
  assert.deepStrictEqual(t.dueCheckpoints(M(10, 5)).map((c) => c.key), ['0945']);
});
check('a restart past the grace window does NOT fabricate a late entry', () => {
  // 14:00 is hours after every checkpoint. A "9:45 entry" filled at 2pm would be
  // a trade that never existed — worse than a missing row.
  assert.deepStrictEqual(t.dueCheckpoints(M(14, 0)), []);
});
check('nothing is due before the open', () => {
  assert.deepStrictEqual(t.dueCheckpoints(M(9, 30)), []);
});
check('12:00 is its own checkpoint, not a late 10:30', () => {
  assert.deepStrictEqual(t.dueCheckpoints(M(12, 0)).map((c) => c.key), ['1200']);
});

// ── CB snapshot matching ───────────────────────────────────────────────────
const snaps = [
  { min: M(9, 30), strike: 6640, spx: 6590 },
  { min: M(9, 44), strike: 6650, spx: 6595 },
  { min: M(10, 30), strike: 6650, spx: 6612 },
];
check('the checkpoint takes the nearest snapshot', () => {
  assert.strictEqual(t.snapshotAt(snaps, M(9, 45)).min, M(9, 44));
});
check('a snapshot outside the window is not used', () => {
  assert.strictEqual(t.snapshotAt(snaps, M(12, 0)), null);
});
check('an empty session matches nothing', () => {
  assert.strictEqual(t.snapshotAt([], M(9, 45)), null);
});

// ── Config is the spec ─────────────────────────────────────────────────────
check('defaults match the owner spec, and the probe root is SPXW', () => {
  assert.strictEqual(t.CONFIG.AUTO_BUY_MAX, 1.0);
  assert.strictEqual(t.CONFIG.SELL_TRIGGER_PTS, 10);
  assert.strictEqual(t.CONFIG.SELL_TIGHT_PTS, 5);
  assert.strictEqual(t.CONFIG.PROBE_TICKER, 'SPXW');
  assert.strictEqual(t.CONFIG.MULTIPLIER, 100);
});
check('the three checkpoints are 9:45 / 10:30 / 12:00 ET', () => {
  assert.deepStrictEqual(t.CHECKPOINTS.map((c) => c.label), ['9:45', '10:30', '12:00']);
  assert.deepStrictEqual(t.CHECKPOINTS.map((c) => c.min), [M(9, 45), M(10, 30), M(12, 0)]);
});

// ── Phase 2: the probe boundary ────────────────────────────────────────────
// A real /proxy/probe-rest success body, trimmed to the fields this module
// reads. Shape copied from proxy-tastytrade.js probeRestTT()'s return.
const PROBE_OK = {
  found: true,
  status: 'ready',
  source: 'tt',
  resolvedSymbol: '.SPXW260715C6650',
  occSymbol: 'SPXW  260715C06650000',
  resolvedStrike: 6650,
  result: {
    eventSymbol: '.SPXW260715C6650',
    occSymbol: 'SPXW  260715C06650000',
    feeds: {
      Quote: { bid: 0.5, ask: 0.6, mid: 0.55, mark: 0.55 },
      Trade: { last: 0.55, volume: 12000 },
      Summary: { openInterest: 3400 },
      Greeks: { delta: 0.11 },
    },
    exposures: { spot: 6595.25, oi: 3400, volume: 12000 },
  },
};

function stubCtx(handler) {
  const seen = [];
  return {
    seen,
    internalFetch: async (path) => { seen.push(path); return { json: async () => handler(path) }; },
  };
}

(async () => {
  await checkAsync('probeContract reads mark / bid / ask / spot off a TT probe', async () => {
    const ctx = stubCtx(() => PROBE_OK);
    const p = await t.probeContract(ctx, { expiry: '2026-07-15', side: 'C', strike: 6650 });
    assert.strictEqual(p.found, true);
    assert.strictEqual(p.mark, 0.55);
    assert.strictEqual(p.bid, 0.5);
    assert.strictEqual(p.ask, 0.6);
    assert.strictEqual(p.spot, 6595.25);
    assert.strictEqual(p.occSymbol, 'SPXW  260715C06650000');
  });

  await checkAsync('the probe asks for SPXW 0DTE at the CB strike', async () => {
    const ctx = stubCtx(() => PROBE_OK);
    await t.probeContract(ctx, { expiry: '2026-07-15', side: 'C', strike: 6650 });
    const url = ctx.seen[0];
    assert.match(url, /^\/proxy\/probe-rest\?/);
    assert.match(url, /ticker=SPXW/);          // NOT SPX — see the file header
    assert.match(url, /expiry=2026-07-15/);
    assert.match(url, /type=C/);
    assert.match(url, /strike=6650/);
  });

  await checkAsync('a mark-less quote falls back to the bid/ask midpoint', async () => {
    const ctx = stubCtx(() => ({
      ...PROBE_OK,
      result: { ...PROBE_OK.result, feeds: { ...PROBE_OK.result.feeds, Quote: { bid: 0.4, ask: 0.8 } } },
    }));
    const p = await t.probeContract(ctx, { expiry: '2026-07-15', side: 'C', strike: 6650 });
    assert.ok(Math.abs(p.mark - 0.6) < 1e-9, `expected ~0.60, got ${p.mark}`);
  });

  await checkAsync('an unresolvable strike degrades to a reason, never a throw', async () => {
    const ctx = stubCtx(() => ({ found: false, status: 'no-strike' }));
    const p = await t.probeContract(ctx, { expiry: '2026-07-15', side: 'C', strike: 9999 });
    assert.strictEqual(p.found, false);
    assert.match(p.reason, /no-strike/);
  });

  await checkAsync('an unreachable proxy degrades to a reason, never a throw', async () => {
    const ctx = { internalFetch: async () => { throw new Error('ECONNREFUSED'); } };
    const p = await t.probeContract(ctx, { expiry: '2026-07-15', side: 'C', strike: 6650 });
    assert.strictEqual(p.found, false);
    assert.match(p.reason, /ECONNREFUSED/);
  });

  // ── Rollups ──────────────────────────────────────────────────────────────
  const rows = [
    // 9:45 — bought at 0.55, sold on the signal at 3.40
    { checkpoint: '0945', status: 'closed', exit_reason: 'sell-signal', pnl: 2.85, pnl_usd: 285 },
    // 9:45 another session — bought, never triggered, marked out at the bell
    { checkpoint: '0945', status: 'closed', exit_reason: 'eod', pnl: -0.5, pnl_usd: -50 },
    // 9:45 a third — priced over the cap, no trade
    { checkpoint: '0945', status: 'skipped', skip_reason: 'mark $1.35 over the $1.00 cap', pnl: null },
    // 10:30 — still live
    { checkpoint: '1030', status: 'open', pnl: null },
  ];
  check('summarize separates probes from trades and scores only closed P&L', () => {
    const byKey = Object.fromEntries(t.summarize(rows).map((s) => [s.key, s]));
    assert.strictEqual(byKey['0945'].probes, 3);
    assert.strictEqual(byKey['0945'].trades, 2);        // the skipped row is not a trade
    assert.strictEqual(byKey['0945'].sellHits, 1);
    assert.strictEqual(byKey['0945'].wins, 1);
    assert.strictEqual(byKey['0945'].winRate, 0.5);
    assert.strictEqual(byKey['0945'].avgPnl, 1.18);      // (2.85 - 0.50) / 2
    assert.strictEqual(byKey['0945'].totalPnl, 2.35);
    assert.strictEqual(byKey['0945'].totalPnlUsd, 235);
    assert.strictEqual(byKey['1030'].openNow, 1);
    assert.strictEqual(byKey['1030'].winRate, null);     // nothing closed yet
    assert.strictEqual(byKey['1200'].probes, 0);
  });
  check('take rate reports how often a checkpoint actually qualified', () => {
    const byKey = Object.fromEntries(t.summarize(rows).map((s) => [s.key, s]));
    assert.ok(Math.abs(byKey['0945'].takeRate - 2 / 3) < 1e-9);
    assert.strictEqual(byKey['1200'].takeRate, null);
  });

  console.log(process.exitCode ? '\nFAILED' : `\nall ${passed} checks passed`);
})();
