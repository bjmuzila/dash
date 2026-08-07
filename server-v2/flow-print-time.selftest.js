'use strict';
/**
 * server-v2/flow-print-time.selftest.js
 *
 * Regression suite for the 2026-08-07 options-flow fixes (see CHANGELOG):
 * flow prints were stamped with the INGEST clock instead of the exchange
 * timestamp, so any batch dxLink replayed collapsed into a single 1-minute bin
 * — the /flow Net Drift line sat flat for an hour and then moved vertically in
 * one bar.
 *
 * Covers all four moving parts:
 *   1. stampFlowTime()          — exchange-time validation bounds
 *   2. FlowProcessor            — a replayed batch keeps its true minutes
 *   3. flow-history-writer      — those replayed rows still reach flow_prints
 *   4. DxLinkClient             — TimeAndSale subs survive the pre-open window
 *   5. flow-history-writer      — orders that cross the tape floor mid-coalesce
 *                                 are persisted, and a cold flush is chunked
 *
 * Run:  node server-v2/flow-print-time.selftest.js
 * No network, no database — (3) drives the writer against a stub `pg`, (4)
 * extracts DxLinkClient from proxy-tastytrade.js and drives it with a fake
 * socket (requiring that module outright would open real connections).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

let fails = 0;
const t = (name, fn) => {
  try { const r = fn(); if (r && typeof r.then === 'function') return r.then(
    () => console.log('  PASS', name),
    (e) => { fails++; console.log('  FAIL', name, '\n         ', e.message); });
    console.log('  PASS', name);
  } catch (e) { fails++; console.log('  FAIL', name, '\n         ', e.message); }
  return Promise.resolve();
};

const PROXY = path.join(__dirname, 'proxy-tastytrade.js');
const NOW = 1_770_000_000_000;

// ── 1. stampFlowTime ───────────────────────────────────────────────────────
// proxy-tastytrade.js cannot be required standalone (it dials out on import),
// so the function is lifted out of the source text. That also asserts it is
// still THERE and still named this — if it gets renamed or inlined, this fails
// loudly instead of quietly testing a stale copy.
function loadStampFlowTime() {
  const src = fs.readFileSync(PROXY, 'utf8');
  const consts = [...src.matchAll(/^const (FLOW_TS_MAX_AGE_MS|FLOW_TS_MAX_SKEW_MS) = [^;]+;/gm)].map((m) => m[0]);
  assert.strictEqual(consts.length, 2, 'FLOW_TS_MAX_AGE_MS / FLOW_TS_MAX_SKEW_MS not found in proxy-tastytrade.js');
  const start = src.indexOf('function stampFlowTime(');
  assert.ok(start > 0, 'stampFlowTime() not found in proxy-tastytrade.js');
  const end = src.indexOf('\n}', start) + 2;
  return new Function('process', `${consts.join('\n')}\n${src.slice(start, end)}\nreturn stampFlowTime;`)({ env: {} });
}

async function suiteStamp() {
  console.log('stampFlowTime — exchange-time validation');
  const stampFlowTime = loadStampFlowTime();
  await t('keeps a genuine 45-minute-old exchange time (the replay case)',
    () => assert.strictEqual(stampFlowTime(NOW - 45 * 60000, NOW), NOW - 45 * 60000));
  await t('keeps a normal live print', () => assert.strictEqual(stampFlowTime(NOW - 250, NOW), NOW - 250));
  await t('falls back when the field is absent', () => assert.strictEqual(stampFlowTime(undefined, NOW), NOW));
  await t('falls back on epoch 0', () => assert.strictEqual(stampFlowTime(0, NOW), NOW));
  await t('falls back on garbage', () => assert.strictEqual(stampFlowTime('abc', NOW), NOW));
  await t('falls back on a negative', () => assert.strictEqual(stampFlowTime(-5, NOW), NOW));
  await t('rejects a far-future stamp', () => assert.strictEqual(stampFlowTime(NOW + 5 * 60000, NOW), NOW));
  await t('tolerates 30s of clock skew', () => assert.strictEqual(stampFlowTime(NOW + 30000, NOW), NOW + 30000));
  await t('rejects a pre-1970-ish value', () => assert.strictEqual(stampFlowTime(1000, NOW), NOW));
}

// ── 2. FlowProcessor ───────────────────────────────────────────────────────
async function suiteProcessor() {
  console.log('FlowProcessor — a replayed batch keeps its true minutes');
  const { FlowProcessor } = require('./computation/flow-processor');
  const SYM = '.SPXW260807C6000';

  await t('60 prints delivered in ONE burst, exchange times a minute apart, land in 60 minutes', () => {
    const fp = new FlowProcessor({ tapeFloorPremium: 0 });
    for (let i = 0; i < 60; i++) {
      fp.addPrint({ streamerSymbol: SYM, price: 10, size: 10, time: NOW - (60 - i) * 60000, side: 'buy', spot: 5900 });
    }
    const mins = new Set(fp.tape.map((o) => Math.floor(o.ts / 60000)));
    assert.strictEqual(mins.size, 60, `expected 60 distinct minutes, got ${mins.size}`);
  });

  await t('with no time supplied they still collapse into one minute (the old behaviour)', () => {
    const fp = new FlowProcessor({ tapeFloorPremium: 0 });
    for (let i = 0; i < 60; i++) fp.addPrint({ streamerSymbol: SYM, price: 10, size: 10, side: 'buy', spot: 5900 });
    assert.strictEqual(new Set(fp.tape.map((o) => Math.floor(o.ts / 60000))).size, 1);
  });

  await t('coalescing still merges same-contract fills inside the window', () => {
    const fp = new FlowProcessor({ tapeFloorPremium: 0, coalesceMs: 5000 });
    fp.addPrint({ streamerSymbol: SYM, price: 10, size: 5, time: NOW, side: 'buy', spot: 5900 });
    fp.addPrint({ streamerSymbol: SYM, price: 10, size: 7, time: NOW + 900, side: 'buy', spot: 5900 });
    assert.strictEqual(fp.tape.length, 1);
    assert.strictEqual(fp.tape[0].size, 12);
    assert.strictEqual(fp.tape[0].fills, 2);
  });

  await t('an out-of-order fill inside the window merges (abs), not a stray order', () => {
    const fp = new FlowProcessor({ tapeFloorPremium: 0, coalesceMs: 5000 });
    fp.addPrint({ streamerSymbol: SYM, price: 10, size: 5, time: NOW, side: 'buy', spot: 5900 });
    fp.addPrint({ streamerSymbol: SYM, price: 10, size: 5, time: NOW - 800, side: 'buy', spot: 5900 });
    assert.strictEqual(fp.tape.length, 1);
  });

  await t('a fill beyond the window opens a new order', () => {
    const fp = new FlowProcessor({ tapeFloorPremium: 0, coalesceMs: 5000 });
    fp.addPrint({ streamerSymbol: SYM, price: 10, size: 5, time: NOW, side: 'buy', spot: 5900 });
    fp.addPrint({ streamerSymbol: SYM, price: 10, size: 5, time: NOW + 9000, side: 'buy', spot: 5900 });
    assert.strictEqual(fp.tape.length, 2);
  });

  await t('every entry carries lastFillAt, and it is the ingest clock', () => {
    const fp = new FlowProcessor({ tapeFloorPremium: 0 });
    fp.addPrint({ streamerSymbol: SYM, price: 10, size: 5, time: NOW - 3600000, side: 'buy', spot: 5900 });
    const o = fp.tape[0];
    assert.ok(Number.isFinite(o.lastFillAt), 'lastFillAt missing');
    assert.ok(o.lastFillAt > o.ts, 'lastFillAt must not be the exchange time');
  });
}

// ── 3. flow-history-writer ─────────────────────────────────────────────────
async function suiteWriter() {
  console.log('flow-history-writer — replayed rows still reach flow_prints');
  const inserts = [];
  // Stub `pg` for this process only, so the writer builds real SQL against a
  // real pool interface without a database.
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) {
    if (req === 'pg') return 'pg-stub';
    return origResolve.call(this, req, ...rest);
  };
  require.cache['pg-stub'] = { id: 'pg-stub', filename: 'pg-stub', loaded: true, exports: {
    Pool: class { on() {} async end() {}
      async query(sql, params) { if (String(sql).includes('INSERT INTO flow_prints')) inserts.push(params); return { rows: [] }; } },
  } };
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/selftest';
  process.env.FLOW_COALESCE_MS = process.env.FLOW_COALESCE_MS || '5000';

  const { writeFlowTape } = require('./state/flow-history-writer');
  const now = Date.now();
  const row = (o) => ({ premium: 1, size: 1, price: 1, side: 'buy', ...o });
  // The INSERT is 16 columns wide and `ts` is column 0 of each tuple.
  const writtenTs = () => inserts.flatMap((p) => p.filter((_, i) => i % 16 === 0));

  await t('a live tick writes its prints', async () => {
    await writeFlowTape([
      row({ ts: now - 2000, lastFillAt: now - 2000, symbol: 'A' }),
      row({ ts: now - 1000, lastFillAt: now - 1000, symbol: 'B' }),
    ], 'selftest');
    assert.strictEqual(writtenTs().length, 2);
  });

  inserts.length = 0;
  await t('an hour-old replayed batch is written, not skipped (the bug)', async () => {
    await writeFlowTape([
      row({ ts: now - 2000, lastFillAt: now - 2000, symbol: 'A' }),
      row({ ts: now - 3600000, lastFillAt: now, symbol: 'OLD1' }),
      row({ ts: now - 3000000, lastFillAt: now, symbol: 'OLD2', side: 'sell' }),
    ], 'selftest');
    const ts = writtenTs();
    assert.ok(ts.includes(now - 3600000), 'hour-old replayed row was dropped');
    assert.ok(ts.includes(now - 3000000), '50-min-old replayed row was dropped');
  });

  inserts.length = 0;
  await t('a long-settled row is not re-upserted every tick', async () => {
    await writeFlowTape([row({ ts: now - 600000, lastFillAt: now - 600000, symbol: 'STALE' })], 'selftest');
    assert.strictEqual(inserts.length, 0);
  });

  inserts.length = 0;
  await t('an order still merging fills IS re-upserted', async () => {
    await writeFlowTape([row({ ts: now - 3000, lastFillAt: Date.now(), symbol: 'GROW', premium: 99, size: 40 })], 'selftest');
    assert.strictEqual(inserts.length, 1);
  });

  inserts.length = 0;
  await t('an entry with no lastFillAt falls back to ts', async () => {
    await writeFlowTape([row({ ts: Date.now(), symbol: 'LEGACY' })], 'selftest');
    assert.strictEqual(inserts.length, 1);
  });

  inserts.length = 0;
  await t('a second cursor keeps its own flush position', async () => {
    await writeFlowTape([row({ ts: now - 3600000, lastFillAt: now, symbol: 'REC' })], 'record-selftest');
    assert.strictEqual(inserts.length, 1);
  });

  Module._resolveFilename = origResolve;
}

// ── 4. DxLinkClient ────────────────────────────────────────────────────────
async function suiteDxLink() {
  console.log('DxLinkClient — TimeAndSale subs survive the pre-CHANNEL_OPENED window');
  const src = fs.readFileSync(PROXY, 'utf8');
  const start = src.indexOf('class DxLinkClient {');
  const end = src.indexOf('// Field order MUST match');
  assert.ok(start > 0 && end > start, 'could not locate DxLinkClient in proxy-tastytrade.js');
  const sent = [];
  class FakeWS { constructor() { this.readyState = 1; } on() {} send(p) { sent.push(JSON.parse(p)); } close() {} }
  FakeWS.OPEN = 1;
  const DxLinkClient = new Function('WebSocket', `${src.slice(start, end)}\nreturn DxLinkClient;`)(FakeWS);

  const mk = () => { sent.length = 0; const c = new DxLinkClient({ url: 'x', token: 'y', onEvent() {}, onStatus() {} }); c.ws = new FakeWS(); return c; };
  const open = (c) => c._onMessage(JSON.stringify({ type: 'CHANNEL_OPENED', channel: c.channel }));
  const tsAdds = () => sent.filter((m) => m.type === 'FEED_SUBSCRIPTION' && (m.add || []).some((a) => a.type === 'TimeAndSale'))
    .flatMap((m) => m.add.filter((a) => a.type === 'TimeAndSale').map((a) => a.symbol));

  await t('subscribing before the channel opens queues and reports false', () => {
    const c = mk();
    assert.strictEqual(c.subscribeTimeSales(['.S1', '.S2']), false);
    assert.strictEqual(tsAdds().length, 0);
    assert.strictEqual(c.pending.filter((p) => p.__ts).length, 2);
  });
  await t('CHANNEL_OPENED flushes the queue', () => {
    const c = mk(); c.subscribeTimeSales(['.S1', '.S2']); open(c);
    assert.deepStrictEqual(tsAdds().sort(), ['.S1', '.S2']);
  });
  await t('queued TS symbols are not fanned out as Quote/Greeks/Summary/Trade', () => {
    const c = mk(); c.subscribeTimeSales(['.S1']); open(c);
    const types = sent.flatMap((m) => (m.add || []).filter((a) => a.symbol === '.S1').map((a) => a.type));
    assert.deepStrictEqual(types, ['TimeAndSale'], `got ${types.join(',')}`);
  });
  await t('regular / candle / TimeAndSale queues stay separated', () => {
    const c = mk();
    c.subscribe(['SPX']); c.subscribeCandle('/ESU26:XCME{=5m}'); c.subscribeTimeSales(['.S1']); open(c);
    const all = sent.flatMap((m) => m.add || []);
    assert.ok(all.some((a) => a.type === 'Quote' && a.symbol === 'SPX'), 'regular sub lost');
    assert.ok(all.some((a) => a.type === 'Candle'), 'candle sub lost');
    assert.ok(all.some((a) => a.type === 'TimeAndSale' && a.symbol === '.S1'), 'TS sub lost');
  });
  await t('once open it sends immediately and reports true', () => {
    const c = mk(); open(c); sent.length = 0;
    assert.strictEqual(c.subscribeTimeSales(['.S9']), true);
    assert.deepStrictEqual(tsAdds(), ['.S9']);
  });
  await t('a queued unsubscribe cancels its queued add', () => {
    const c = mk(); c.subscribeTimeSales(['.S1', '.S2']); c.unsubscribeTimeSales(['.S1']); open(c);
    assert.deepStrictEqual(tsAdds(), ['.S2']);
  });
  await t('empty / undefined input is a no-op', () => {
    const c = mk();
    assert.strictEqual(c.subscribeTimeSales([]), false);
    assert.strictEqual(c.subscribeTimeSales(undefined), false);
    assert.strictEqual(c.pending.length, 0);
  });
  await t('1200 symbols still chunk into 500s', () => {
    const c = mk(); open(c); sent.length = 0;
    c.subscribeTimeSales(Array.from({ length: 1200 }, (_, i) => `.S${i}`));
    assert.strictEqual(sent.filter((m) => (m.add || []).some((a) => a.type === 'TimeAndSale')).length, 3);
    assert.strictEqual(tsAdds().length, 1200);
  });
}

// ── 5. The floor-crossing loss (the actual /flow starvation) ───────────────
// Simulates the real 500ms flow-tape loop. Each tick a couple of orders are born
// ALREADY above the tape floor — these keep the writer's cursor marching with the
// live tape. Meanwhile ordinary SPX 0DTE orders open SUB-floor and only cross it
// after a few seconds of coalesced fills, and FlowProcessor keeps an order's `ts`
// at its FIRST fill. bucket() only exposes an order once it is above the floor,
// so the writer first sees these ~3s after their ts — already below a cutoff of
// `newest written ts - 500ms`. That silently dropped ~97% of real 0DTE flow.
async function suiteFloorCrossing() {
  console.log('flow-history-writer — orders that cross the floor while coalescing');
  const seen = [];
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) {
    if (req === 'pg') return 'pg-stub-2';
    return origResolve.call(this, req, ...rest);
  };
  require.cache['pg-stub-2'] = { id: 'pg-stub-2', filename: 'pg-stub-2', loaded: true, exports: {
    Pool: class { on() {} async end() {}
      async query(sql, params) {
        if (String(sql).includes('INSERT INTO flow_prints')) {
          if (params.length > 65535) throw new Error(`bind message supplies ${params.length} parameters, but prepared statement requires 65535`);
          for (let i = 0; i < params.length; i += 16) seen.push(String(params[i + 2]));
        }
        return { rows: [] };
      } } } };
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/selftest';
  delete require.cache[require.resolve('./state/flow-history-writer')];
  const { writeFlowTape } = require('./state/flow-history-writer');

  const T0 = Date.now(), TICK = 500, TICKS = 60, GROW_MS = 3000;
  const born = [], slow = [];
  for (let k = 0; k < TICKS; k++) {
    const t = T0 + k * TICK;
    born.push({ ts: t, lastFillAt: t, symbol: `BORN_${k}`, side: 'buy', premium: 9000, size: 9, price: 10 });
    slow.push({ ts: t, lastFillAt: t + GROW_MS, crossesAt: t + GROW_MS, symbol: `SLOW_${k}`, side: 'buy', premium: 800, size: 8, price: 1 });
  }
  for (let k = 0; k < TICKS; k++) {
    const nowT = T0 + k * TICK;
    const tape = [...born.filter((o) => o.ts <= nowT), ...slow.filter((o) => o.crossesAt <= nowT)].sort((a, b) => a.ts - b.ts);
    await writeFlowTape(tape, 'floor-selftest'); // eslint-disable-line no-await-in-loop
  }
  const set = new Set(seen);
  const nBorn = [...set].filter((x) => x.startsWith('BORN_')).length;
  const nSlow = [...set].filter((x) => x.startsWith('SLOW_')).length;
  const eligible = slow.filter((o) => o.crossesAt <= T0 + (TICKS - 1) * TICK).length;
  await t(`all ${TICKS} born-above-floor orders persist`, () => assert.strictEqual(nBorn, TICKS));
  await t(`all ${eligible} late-crossing orders persist (pre-fix: 0)`,
    () => assert.strictEqual(nSlow, eligible, `only ${nSlow}/${eligible} reached flow_prints`));

  // Bind-parameter ceiling: 16 params/row caps a single INSERT at 4095 rows.
  // A cold cursor hands in the whole session tape, which passes that by mid-day.
  seen.length = 0;
  const big = [];
  const base = Date.now();
  for (let i = 9000; i > 0; i--) big.push({ ts: base - i * 2400, lastFillAt: base - i * 2400, symbol: `S${i}`, side: 'buy', premium: 9000, size: 1, price: 1 });
  await t('a 9000-row cold flush is chunked, not rejected at 65535 params',
    async () => { await writeFlowTape(big, 'chunk-selftest'); assert.strictEqual(new Set(seen).size, 9000, `wrote ${new Set(seen).size}/9000`); });

  Module._resolveFilename = origResolve;
}

(async () => {
  await suiteStamp();
  await suiteProcessor();
  await suiteWriter();
  await suiteDxLink();
  await suiteFloorCrossing();
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
