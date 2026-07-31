'use strict';
/**
 * server-v2/cb-contract-track.selftest.js
 *
 * Offline unit check for the CB contract auto-buy/auto-sell rules. Everything
 * under test is the PURE half of cb-contract-track.js (simulateCheckpoint,
 * barAtMinute, barDistanceTo), so this runs with no ThetaData, no DB and no
 * network — which is the point: the trade rules are the part that must not
 * drift silently, and they are the part hardest to eyeball on a live board.
 *
 *   node server-v2/cb-contract-track.selftest.js
 *
 * Exits non-zero on the first failure, prints one line per case otherwise.
 */

const assert = require('assert');

// Stub the Theta adapter BEFORE cb-contract-track requires it, so phase 2 can
// exercise the real fetch/cache/rollup path with a deterministic tape instead of
// a live theta-terminal. (Seeding require.cache is enough — require.resolve does
// not execute the module, so `ws` and the rest never load.)
const THETA_PATH = require.resolve('./proxy-thetadata');
const thetaCalls = { index: 0, option: 0 };
const thetaStub = { fetchIndexIntradayTheta: null, fetchOptionIntradayTheta: null };
require.cache[THETA_PATH] = { id: THETA_PATH, filename: THETA_PATH, loaded: true, exports: thetaStub };

const t = require('./cb-contract-track');

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

// ── Fixtures ───────────────────────────────────────────────────────────────
// One synthetic session. Minutes are ET minutes-of-day: 9:45 = 585, 10:30 = 630,
// 12:00 = 720. `time` values are arbitrary but monotonic — the engine sorts and
// compares on `min`, and only echoes `time` back for the UI's clock tooltips.
const M = (h, m) => h * 60 + m;
const bar = (min, close, high = close, low = close) => ({ min, time: min * 60_000, open: close, high, low, close });

/** SPX walks 6595 → 6640, crossing into 10 pts of a 6650 CB at 11:00. */
const spxUp = [
  bar(M(9, 45), 6595, 6597, 6593),
  bar(M(10, 0), 6600, 6602, 6598),
  bar(M(10, 30), 6612, 6614, 6610),
  bar(M(11, 0), 6641, 6643, 6639),   // 6650 - 6643 = 7 pts → inside the band
  bar(M(12, 0), 6648, 6652, 6646),   // trades through the CB
  bar(M(15, 55), 6630, 6632, 6628),
];
/** SPX drifts nowhere near a 6650 CB all session. */
const spxFlat = [
  bar(M(9, 45), 6595, 6597, 6593),
  bar(M(10, 30), 6592, 6594, 6590),
  bar(M(12, 0), 6588, 6590, 6586),
  bar(M(15, 55), 6585, 6587, 6583),
];
/** The 6650 call: 55c at 9:45, 1.10 at 10:30, rips as SPX arrives, dies at the bell. */
const call6650 = [
  bar(M(9, 45), 0.55),
  bar(M(10, 30), 1.10),
  bar(M(11, 0), 3.40),
  bar(M(12, 0), 6.20),
  bar(M(15, 55), 0.05),
];

const base = {
  checkpointMin: M(9, 45), strike: 6650, spxAt: 6595,
  optionBars: call6650, spxBars: spxUp, complete: true,
};

console.log('cb-contract-track selftest');

// ── Bar helpers ────────────────────────────────────────────────────────────
check('barAtMinute takes the last bar at or before the checkpoint', () => {
  const b = t.barAtMinute(spxUp, M(10, 35));
  assert.strictEqual(b.min, M(10, 30));
});
check('barAtMinute accepts a slightly late first bar when the tape starts late', () => {
  const late = [bar(M(9, 52), 1.0), bar(M(10, 30), 1.2)];
  assert.strictEqual(t.barAtMinute(late, M(9, 45)).min, M(9, 52));
});
check('barAtMinute returns null when nothing is in reach', () => {
  assert.strictEqual(t.barAtMinute([bar(M(14, 0), 1)], M(9, 45)), null);
});
check('barDistanceTo is 0 when the bar trades through the strike', () => {
  assert.strictEqual(t.barDistanceTo(bar(M(12, 0), 6648, 6652, 6646), 6650), 0);
});
check('barDistanceTo measures from the nearer extreme', () => {
  assert.strictEqual(t.barDistanceTo(bar(M(11, 0), 6641, 6643, 6639), 6650), 7);
});

// ── Side selection ─────────────────────────────────────────────────────────
check('SPX under the CB buys the call', () => {
  assert.strictEqual(t.simulateCheckpoint({ ...base, spxAt: 6595 }).right, 'C');
});
check('SPX over the CB buys the put', () => {
  assert.strictEqual(t.simulateCheckpoint({ ...base, spxAt: 6700 }).right, 'P');
});

// ── Auto-buy filter ────────────────────────────────────────────────────────
check('a contract over $1.00 is priced but never bought', () => {
  const r = t.simulateCheckpoint({ ...base, checkpointMin: M(10, 30) });
  assert.strictEqual(r.contractPrice, 1.10);
  assert.strictEqual(r.autoEntry, null);
  assert.strictEqual(r.pnl, null);
});
check('a contract at or under $1.00 is bought at the checkpoint print', () => {
  const r = t.simulateCheckpoint(base);
  assert.ok(r.autoEntry, 'expected an auto-entry');
  assert.strictEqual(r.autoEntry.price, 0.55);
});

// ── Auto-sell ──────────────────────────────────────────────────────────────
check('the sell fires the first time SPX is inside the band, and fills', () => {
  const r = t.simulateCheckpoint(base);
  assert.ok(r.sellSignal, 'expected a sell signal');
  assert.strictEqual(r.sellSignal.distPts, 7);
  assert.strictEqual(r.sellSignal.tight, false);      // 7 pts is the 5-10 band, not inside 5
  assert.strictEqual(r.sold.price, 3.40);
  assert.strictEqual(r.pnl, 2.85);                     // 3.40 - 0.55
});
check('the sell scan ignores the entry bar itself', () => {
  // SPX is ALREADY 2 pts from the CB at the checkpoint. A scan that included the
  // entry bar would buy and sell on the same print for a flat 0.00.
  const spxAtBand = [bar(M(9, 45), 6648, 6649, 6647), bar(M(12, 0), 6600, 6602, 6598)];
  const r = t.simulateCheckpoint({ ...base, spxBars: spxAtBand });
  assert.strictEqual(r.sellSignal, null);
  assert.strictEqual(r.pnl, -0.50);                    // 0.05 settle - 0.55 entry
});
check('a sub-5pt arrival is flagged tight', () => {
  const spxTight = [bar(M(9, 45), 6595), bar(M(11, 0), 6648, 6649, 6647), bar(M(15, 55), 6600)];
  const r = t.simulateCheckpoint({ ...base, spxBars: spxTight });
  assert.strictEqual(r.sellSignal.tight, true);
  assert.ok(r.sellSignal.distPts <= 5);
});
check('a signal with no contract print left to fill stays a signal', () => {
  const thinTape = [bar(M(9, 45), 0.55)];              // nothing after the entry
  const r = t.simulateCheckpoint({ ...base, optionBars: thinTape });
  assert.ok(r.sellSignal, 'expected a sell signal');
  assert.strictEqual(r.sold, null);
  assert.match(r.contractNote, /no contract bar to fill/);
});

// ── No-trigger outcomes ────────────────────────────────────────────────────
check('a finished session that never triggered settles at the last print', () => {
  const r = t.simulateCheckpoint({ ...base, spxBars: spxFlat });
  assert.strictEqual(r.sellSignal, null);
  assert.strictEqual(r.pnl, -0.50);                    // 0.05 - 0.55
  assert.strictEqual(r.open, false);
});
check('a live session marks to the last bar and flags the position open', () => {
  const r = t.simulateCheckpoint({ ...base, spxBars: spxFlat, complete: false });
  assert.strictEqual(r.open, true);
  assert.strictEqual(r.pnl, -0.50);
});

// ── Degradation ────────────────────────────────────────────────────────────
check('no contract bars degrades to a note, never a throw', () => {
  const r = t.simulateCheckpoint({ ...base, optionBars: [] });
  assert.strictEqual(r.contractPrice, null);
  assert.match(r.contractNote, /no contract bars/);
});
check('a missing strike or SPX degrades to a note', () => {
  const r = t.simulateCheckpoint({ ...base, strike: null });
  assert.match(r.contractNote, /no strike/);
});
check('an empty SPX path cannot invent a sell', () => {
  const r = t.simulateCheckpoint({ ...base, spxBars: [] });
  assert.ok(r.autoEntry);
  assert.strictEqual(r.sellSignal, null);
});

// ── Config is the spec ─────────────────────────────────────────────────────
check('defaults match the owner spec: buy <= $1.00, sell inside 5-10 pts', () => {
  assert.strictEqual(t.CONFIG.AUTO_BUY_MAX, 1.0);
  assert.strictEqual(t.CONFIG.SELL_TRIGGER_PTS, 10);
  assert.strictEqual(t.CONFIG.SELL_TIGHT_PTS, 5);
});

// ── Phase 2: the wired path (fetch → cache → per-cell merge → rollups) ─────
// Same rules, but driven through trackDay/enrichWithContracts against the stub,
// which is what the route actually calls. This is the part that catches wiring
// regressions the pure tests can't see: a fetch that asks for the wrong strike,
// a cache key that collides across sides, a rollup that counts skipped days.
const DATE = '2026-07-15';                                  // a Wednesday, EDT
const et = (h, m) => Date.parse(`${DATE}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-04:00`);
const tbar = (h, m, close, high = close, low = close) => ({ time: et(h, m), open: close, high, low, close });

const SPX_TAPE = [
  tbar(9, 45, 6595, 6597, 6593),
  tbar(10, 30, 6612, 6614, 6610),
  tbar(11, 0, 6641, 6643, 6639),      // 7 pts from a 6650 CB
  tbar(12, 0, 6648, 6652, 6646),
  tbar(15, 55, 6630, 6632, 6628),
];
const OPT_TAPE = {
  '6650|C': [tbar(9, 45, 0.55), tbar(10, 30, 1.10), tbar(11, 0, 3.40), tbar(12, 0, 6.20), tbar(15, 55, 0.05)],
  '6600|P': [tbar(12, 0, 0.40), tbar(15, 55, 0.02)],
};
const lastOptionArgs = [];
thetaStub.fetchIndexIntradayTheta = async () => { thetaCalls.index += 1; return SPX_TAPE; };
thetaStub.fetchOptionIntradayTheta = async (underlying, expiry, strike, right, date, interval, range) => {
  thetaCalls.option += 1;
  lastOptionArgs.push({ underlying, expiry, strike, right, date, interval, range });
  return OPT_TAPE[`${strike}|${right}`] || [];
};

const CHECKPOINT_DEFS = [
  { key: '0945', label: '9:45', min: M(9, 45) },
  { key: '1030', label: '10:30', min: M(10, 30) },
  { key: '1200', label: '12:00', min: M(12, 0) },
];
const makeDay = () => ({
  date: DATE,
  checkpoints: [
    { key: '0945', label: '9:45', strike: 6650, spxAt: 6595, matched: true, hit: false, closest: 7, tiers: {} },
    { key: '1030', label: '10:30', strike: 6650, spxAt: 6612, matched: true, hit: false, closest: 7, tiers: {} },
    // CB flips below spot after lunch → this one must buy the PUT, not the call.
    { key: '1200', label: '12:00', strike: 6600, spxAt: 6648, matched: true, hit: false, closest: 40, tiers: {} },
  ],
});
const makeSummary = () => CHECKPOINT_DEFS.map((c) => ({ key: c.key, label: c.label, samples: 1, hits: 0, hitRate: 0, avgClosest: 7, tiers: {} }));

(async () => {
  t.clearCache();
  thetaCalls.index = 0; thetaCalls.option = 0;
  const data = { days: [makeDay()], summary: makeSummary(), hitPts: 8, tiers: [5, 10, 15] };
  await t.enrichWithContracts(data, CHECKPOINT_DEFS, { [DATE]: [] });
  const cells = Object.fromEntries(data.days[0].checkpoints.map((c) => [c.key, c]));

  check('enrich fills the 9:45 cell end to end', () => {
    assert.strictEqual(cells['0945'].right, 'C');
    assert.strictEqual(cells['0945'].contractPrice, 0.55);
    assert.strictEqual(cells['0945'].autoEntry.price, 0.55);
    assert.strictEqual(cells['0945'].sold.price, 3.40);
    assert.strictEqual(cells['0945'].pnl, 2.85);
  });
  check('the 10:30 cell is priced but filtered out by the $1.00 rule', () => {
    assert.strictEqual(cells['1030'].contractPrice, 1.10);
    assert.strictEqual(cells['1030'].autoEntry, null);
  });
  check('a CB below spot flips the cell to the put side', () => {
    assert.strictEqual(cells['1200'].right, 'P');
    assert.strictEqual(cells['1200'].contractPrice, 0.40);
    assert.strictEqual(cells['1200'].autoEntry.price, 0.40);
  });
  check('one index call and one option call per DISTINCT strike+side', () => {
    assert.strictEqual(thetaCalls.index, 1);
    assert.strictEqual(thetaCalls.option, 2);   // 6650C shared by 9:45 + 10:30, plus 6600P
  });
  check('option fetches ask for 0DTE (expiry === session date) on SPX', () => {
    for (const a of lastOptionArgs) {
      assert.strictEqual(a.underlying, 'SPX');
      assert.strictEqual(a.expiry, DATE);
      assert.strictEqual(a.date, DATE);
      assert.ok(a.range >= Math.abs(a.strike - 6648), `strike window ${a.range} too narrow for ${a.strike}`);
    }
  });
  check('summary rollups count trades, sell hits and P&L per checkpoint', () => {
    const byKey = Object.fromEntries(data.summary.map((s) => [s.key, s]));
    assert.strictEqual(byKey['0945'].contractTrades, 1);
    assert.strictEqual(byKey['0945'].sellHits, 1);
    assert.strictEqual(byKey['0945'].avgPnl, 2.85);
    assert.strictEqual(byKey['0945'].contractWinRate, 1);
    assert.strictEqual(byKey['1030'].contractTrades, 0);
    assert.strictEqual(byKey['1030'].avgPnl, null);
    assert.strictEqual(byKey['1200'].contractTrades, 1);
    assert.strictEqual(byKey['1200'].sellHits, 0);       // SPX never got within 10 of 6600
  });
  check('the meta block describes the rules the UI renders', () => {
    assert.strictEqual(data.contracts.enabled, true);
    assert.strictEqual(data.contracts.autoBuyMax, 1.0);
    assert.deepStrictEqual(data.contracts.sellBand, [5, 10]);
    assert.strictEqual(data.contracts.daysTracked, 1);
  });

  // A completed session is immutable, so a second pass must serve from cache.
  const before = thetaCalls.index + thetaCalls.option;
  const again = { days: [makeDay()], summary: makeSummary() };
  await t.enrichWithContracts(again, CHECKPOINT_DEFS, { [DATE]: [] });
  check('a completed session is cached — the second render costs zero calls', () => {
    assert.strictEqual(thetaCalls.index + thetaCalls.option, before);
    assert.strictEqual(again.days[0].checkpoints[0].pnl, 2.85);
  });

  // Theta down must never take the hit-rate board down with it.
  t.clearCache();
  thetaStub.fetchIndexIntradayTheta = async () => { throw new Error('theta-terminal unreachable'); };
  thetaStub.fetchOptionIntradayTheta = async () => { throw new Error('theta-terminal unreachable'); };
  const degraded = { days: [makeDay()], summary: makeSummary() };
  await t.enrichWithContracts(degraded, CHECKPOINT_DEFS, { [DATE]: [] });
  check('a Theta outage degrades to notes, leaves hit-rate columns intact', () => {
    const c = degraded.days[0].checkpoints[0];
    assert.strictEqual(c.contractPrice, null);
    assert.strictEqual(c.autoEntry, null);
    assert.strictEqual(c.closest, 7);                    // untouched
    assert.strictEqual(degraded.summary[0].hitRate, 0);  // untouched
    assert.strictEqual(degraded.summary[0].contractTrades, 0);
  });

  console.log(process.exitCode ? '\nFAILED' : `\nall ${passed} checks passed`);
})();
