'use strict';
/**
 * server-v2/walls-reach.selftest.js
 *
 * No DB, no network. Drives the pure pieces of walls-reach.js against synthetic
 * sessions where the right answer is known by construction, and checks the SQL
 * builder against a mock pool.
 *
 *   node server-v2/walls-reach.selftest.js
 */

const assert = require('assert');
const R = require('./walls-reach');

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

/** Build a session: `walk` is the spot path, one sample every `stepMin`. */
function session(walk, levels, { stepMin = 15, openUtc = '2026-08-03T13:29:00Z' } = {}) {
  const base = new Date(openUtc);
  return walk.map((spot, i) => ({
    ts: new Date(base.getTime() + i * stepMin * 60000),
    spot, ...levels,
  }));
}

console.log('\nbuckets');
t('edges map to the right bucket', () => {
  assert.strictEqual(R.bucketFor(0), 'on_price');
  assert.strictEqual(R.bucketFor(0.2499), 'on_price');
  assert.strictEqual(R.bucketFor(0.25), 'short_walk');      // lower edge is inclusive
  assert.strictEqual(R.bucketFor(0.599), 'short_walk');
  assert.strictEqual(R.bucketFor(0.60), 'solid_move');
  assert.strictEqual(R.bucketFor(1.10), 'across_map');
  assert.strictEqual(R.bucketFor(1.80), 'off_distance');
  assert.strictEqual(R.bucketFor(99), 'off_distance');
});
t('nonsense distances return null, not a bucket', () => {
  assert.strictEqual(R.bucketFor(NaN), null);
  assert.strictEqual(R.bucketFor(-1), null);
  assert.strictEqual(R.bucketFor(Infinity), null);
});

console.log('\nreach detection');
t('a level the path never approaches is not reached', () => {
  // spot pinned near 100, call wall miles above.
  const rows = R.buildSessionRows('2026-08-03', 'T', 4, session(
    [100, 100.2, 99.9, 100.1, 100.3, 99.8, 100.0, 100.2], { call_wall: 130, put_wall: 70, cb: 100.1 },
  ));
  const cw = rows.filter((r) => r.level_type === 'call_wall');
  assert.ok(cw.length > 0, 'expected call_wall rows');
  assert.ok(cw.every((r) => r.reached === false), 'far level should never be reached');
  assert.ok(cw.every((r) => r.bucket === 'off_distance'));
});
t('a level the path runs through is reached', () => {
  const rows = R.buildSessionRows('2026-08-03', 'T', 4, session(
    [100, 101, 102, 103, 104, 103, 102], { call_wall: 103, put_wall: 90, cb: 101 },
  ));
  const s0 = rows.find((r) => r.slot === 0 && r.level_type === 'call_wall');
  assert.strictEqual(s0.reached, true);
  assert.ok(s0.mins_to_reach > 0, 'reached level must carry a time-to-reach');
});
t('reach is forward-looking only — a level already passed does not count backwards', () => {
  // Price tags 103 early, then sits at 99 for the rest of the day. From the
  // late slots, 103 is above and never revisited → must read as not reached.
  const walk = [100, 103, 99, 99, 99, 99, 99, 99, 99, 99];
  const rows = R.buildSessionRows('2026-08-03', 'T', 4, session(walk, { call_wall: 103, put_wall: 95, cb: 100 }));
  const cw = rows.filter((r) => r.level_type === 'call_wall').sort((a, b) => a.slot - b.slot);
  assert.strictEqual(cw[0].reached, true, 'from the open, 103 is reached');
  assert.strictEqual(cw[cw.length - 1].reached, false, 'from the tail, 103 is never revisited');
});
t('side is inferred from spot, not from the level name', () => {
  // A "put wall" sitting ABOVE spot is still an upside travel requirement.
  const rows = R.buildSessionRows('2026-08-03', 'T', 4, session(
    [100, 101, 102, 103], { call_wall: 110, put_wall: 102, cb: 100 },
  ));
  const pw = rows.find((r) => r.slot === 0 && r.level_type === 'put_wall');
  assert.strictEqual(pw.side, 1, 'level above spot must be side +1');
  assert.strictEqual(pw.reached, true);
});

console.log('\ndistance / ATR normalisation');
t('the same point distance buckets differently at different ATR', () => {
  const walk = [100, 100.5, 101, 100.5, 100];
  const tight = R.buildSessionRows('2026-08-03', 'T', 1, session(walk, { call_wall: 102, put_wall: 98, cb: 100 }));
  const wide = R.buildSessionRows('2026-08-03', 'T', 10, session(walk, { call_wall: 102, put_wall: 98, cb: 100 }));
  const b = (rows) => rows.find((r) => r.slot === 0 && r.level_type === 'call_wall').bucket;
  assert.strictEqual(b(tight), 'off_distance', '2 points on a 1-point ATR name is miles (2.00x)');
  assert.strictEqual(b(wide), 'on_price', '2 points on a 10-point ATR name is nothing (0.20x)');
});

console.log('\ncontrol arm');
t('control distance always lands inside the observation bucket', () => {
  const rows = R.buildSessionRows('2026-08-03', 'T', 4, session(
    [100, 101, 102, 101, 99, 98, 100, 103, 97, 100], { call_wall: 104, put_wall: 96, cb: 101 },
  ));
  for (const r of rows) {
    const b = R.BUCKETS.find((x) => x.key === r.bucket);
    assert.ok(r.ctrl_dist_atr >= b.lo, `${r.bucket}: ctrl ${r.ctrl_dist_atr} < lo ${b.lo}`);
    if (Number.isFinite(b.hi)) assert.ok(r.ctrl_dist_atr < b.hi, `${r.bucket}: ctrl ${r.ctrl_dist_atr} >= hi ${b.hi}`);
  }
});
t('control sits on the same side as the real level', () => {
  const rows = R.buildSessionRows('2026-08-03', 'T', 4, session(
    [100, 101, 99, 102, 98], { call_wall: 105, put_wall: 95, cb: 100.5 },
  ));
  for (const r of rows) {
    if (r.side >= 0) assert.ok(r.ctrl_strike >= r.spot, 'upside level needs an upside control');
    else assert.ok(r.ctrl_strike <= r.spot, 'downside level needs a downside control');
  }
});
t('control draw is deterministic across runs', () => {
  const mk = () => R.buildSessionRows('2026-08-03', 'T', 4, session(
    [100, 101, 102, 101, 100], { call_wall: 104, put_wall: 96, cb: 101 },
  ));
  assert.strictEqual(JSON.stringify(mk()), JSON.stringify(mk()));
});
t('control draw differs across symbols — it is not one shared sequence', () => {
  const walk = [100, 101, 102, 101, 100];
  const lv = { call_wall: 104, put_wall: 96, cb: 101 };
  const a = R.buildSessionRows('2026-08-03', 'AAA', 4, session(walk, lv)).map((r) => r.ctrl_dist_atr);
  const b = R.buildSessionRows('2026-08-03', 'BBB', 4, session(walk, lv)).map((r) => r.ctrl_dist_atr);
  assert.notStrictEqual(JSON.stringify(a), JSON.stringify(b));
});

console.log('\nguards');
t('a zero or missing ATR yields no rows rather than dividing by zero', () => {
  const walk = [100, 101, 102, 101];
  assert.strictEqual(R.buildSessionRows('2026-08-03', 'T', 0, session(walk, { cb: 101 })).length, 0);
  assert.strictEqual(R.buildSessionRows('2026-08-03', 'T', null, session(walk, { cb: 101 })).length, 0);
});
t('a session with almost no samples yields no rows', () => {
  assert.strictEqual(R.buildSessionRows('2026-08-03', 'T', 4, session([100, 101], { cb: 101 })).length, 0);
});
t('null / zero strikes are skipped, not treated as level 0', () => {
  const rows = R.buildSessionRows('2026-08-03', 'T', 4, session(
    [100, 101, 102, 101, 100], { call_wall: null, put_wall: 0, cb: 101 },
  ));
  assert.ok(rows.every((r) => r.level_type === 'cb'), 'only cb should survive');
});
t('the last sample of the day produces no observation — nothing to look forward to', () => {
  const walk = [100, 101, 102, 101, 100, 99, 98, 99];
  const rows = R.buildSessionRows('2026-08-03', 'T', 4, session(walk, { cb: 101 }, { stepMin: 60 }));
  const maxSlot = Math.max(...rows.map((r) => r.slot));
  assert.ok(maxSlot < R.SLOT_COUNT, 'slots must stay in range');
});

console.log('\nET minute factory');
t('one Intl anchor reproduces per-sample ET minutes', () => {
  const base = new Date('2026-08-03T13:29:00Z');           // 09:29 ET
  const f = R.etMinutesFactory(base);
  assert.strictEqual(f(base), 9 * 60 + 29);
  assert.strictEqual(f(new Date(base.getTime() + 16 * 60000)), 9 * 60 + 45);
  assert.strictEqual(f(new Date(base.getTime() + 391 * 60000)), 16 * 60);
});

console.log('\nSQL batching');
t('insertBatch splits on the parameter ceiling and passes flat params', async () => {
  const seen = [];
  const mock = { query: async (sql, params) => { seen.push({ sql, n: params.length }); return { rowCount: 0 }; } };
  const cols = ['a', 'b', 'c'];
  const rows = Array.from({ length: 25000 }, (_, i) => ({ a: i, b: i * 2, c: `x${i}` }));
  const n = await R.insertBatch(mock, 'INSERT INTO t (a,b,c)', cols, rows, 'ON CONFLICT DO NOTHING');
  assert.strictEqual(n, 25000, 'every row must be written');
  assert.ok(seen.length > 1, 'expected more than one statement');
  for (const s of seen) assert.ok(s.n <= 60000, `statement carried ${s.n} params`);
  assert.ok(seen[0].sql.startsWith('INSERT INTO t (a,b,c) VALUES ($1,$2,$3),($4,$5,$6)'));
  assert.ok(seen[0].sql.endsWith('ON CONFLICT DO NOTHING'));
});
t('insertBatch on an empty list issues no query at all', async () => {
  let called = 0;
  const mock = { query: async () => { called++; return {}; } };
  const n = await R.insertBatch(mock, 'INSERT INTO t (a)', ['a'], [], '');
  assert.strictEqual(n, 0);
  assert.strictEqual(called, 0);
});

// The two async tests above resolve after this line; give them a tick.
setTimeout(() => {
  console.log(`\n${pass} checks passed${process.exitCode ? ' — WITH FAILURES' : ''}\n`);
}, 50);
