'use strict';
/**
 * server-v2/state/es-candle-writer.selftest.js
 *
 * Covers _coalesceCandles, the batch-dedupe in front of the multi-row upsert.
 * Pure function, no socket and no DB:
 *   node server-v2/state/es-candle-writer.selftest.js
 *
 * Why this file exists: writeCandles used to issue one INSERT per row, so
 * duplicate rows for the same slot were merged by Postgres itself via
 * ON CONFLICT. Batching moves that merge into JS, and getting it wrong is
 * silent -- a wrong high/low is a plausible-looking bar, not an error. Worse,
 * failing to dedupe at all makes the whole statement abort with "ON CONFLICT
 * DO UPDATE command cannot affect row a second time", which would stop the
 * live recorder. Both are asserted below.
 */
const assert = require('assert');
const { _coalesceCandles: coalesce } = require('./es-candle-writer');

let n = 0; const fails = [];
const check = (name, fn) => { try { fn(); n++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL ${name}\n       ${e.message}`); } };

const bar = (over = {}) => ({
  timestamp: 1_700_000_000_000, date: '2026-08-14', slotKey: '2026-08-14 09:30',
  time: '09:30', symbol: '/ES', intervalMinutes: 5, source: 'dxlink',
  open: 100, high: 101, low: 99, close: 100.5, volume: 10, avgVolume: 5, ...over,
});
// The conflict target actually used by each table.
// Both tables share it since 2026-09-24 (nq_candles migrated for the NQ 1m stream).
const ckey = (r) => `${r.slotKey}\u0000${r.intervalMinutes}\u0000${r.contract}`;

console.log('es-candle-writer selftest');

check('a single row survives with its values intact', () => {
  const [r] = coalesce([bar()], 'es_candles', '/ES');
  assert.strictEqual(r.slotKey, '2026-08-14 09:30');
  assert.strictEqual(r.open, 100);
  assert.strictEqual(r.high, 101);
  assert.strictEqual(r.low, 99);
  assert.strictEqual(r.close, 100.5);
});

check('many ticks of one forming bar collapse to exactly one row', () => {
  // This is the property that keeps the statement legal. A 5m bar is rewritten
  // on every tick, so a real flush batch looks like this.
  const ticks = Array.from({ length: 200 }, (_, i) =>
    bar({ timestamp: 1_700_000_000_000 + i * 1000, close: 100 + i * 0.01, volume: i }));
  const out = coalesce(ticks, 'es_candles', '/ES');
  assert.strictEqual(out.length, 1, 'must be one row per conflict target');
});

check('high is GREATEST and low is LEAST across the batch', () => {
  const out = coalesce([
    bar({ high: 101, low: 99 }),
    bar({ high: 105, low: 97 }),   // the extremes, arriving mid-batch
    bar({ high: 102, low: 98 }),
  ], 'es_candles', '/ES');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].high, 105, 'a later lower high must not shrink the bar');
  assert.strictEqual(out[0].low, 97, 'a later higher low must not raise the bar');
});

check('timestamp/close/volume take the LAST value, open keeps the FIRST', () => {
  // Mirrors the ON CONFLICT clause: open is INSERT-only, the rest are EXCLUDED.
  const out = coalesce([
    bar({ timestamp: 1000, open: 100, close: 100.5, volume: 10, avgVolume: 1 }),
    bar({ timestamp: 2000, open: 999, close: 103.25, volume: 42, avgVolume: 7 }),
  ], 'es_candles', '/ES');
  assert.strictEqual(out[0].open, 100, 'open must not be overwritten by a later tick');
  assert.strictEqual(out[0].timestamp, 2000);
  assert.strictEqual(out[0].close, 103.25);
  assert.strictEqual(out[0].volume, 42);
  assert.strictEqual(out[0].avgVolume, 7);
});

check('es_candles keeps 1m and 5m of the same clock time APART', () => {
  // es_candles is UNIQUE("slotKey","intervalMinutes"). Merging these would
  // overwrite the 5m close+volume with 1m values -- the exact bug the composite
  // key migration was written to fix.
  const out = coalesce([
    bar({ intervalMinutes: 1, close: 1, volume: 11 }),
    bar({ intervalMinutes: 5, close: 5, volume: 55 }),
  ], 'es_candles', '/ES');
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out.find((r) => r.intervalMinutes === 1).volume, 11);
  assert.strictEqual(out.find((r) => r.intervalMinutes === 5).volume, 55);
});

check('es_candles keeps two CONTRACTS at the same slot APART', () => {
  // The quarterly-roll case. Before `contract` joined the key, the incoming
  // contract's 09:30 bar upserted straight over the outgoing contract's 09:30
  // bar -- two futures ~35pt apart, one of them silently destroyed.
  const out = coalesce([
    bar({ intervalMinutes: 5, contract: '/ESU6', close: 7500, volume: 11 }),
    bar({ intervalMinutes: 5, contract: '/ESZ6', close: 7535, volume: 55 }),
  ], 'es_candles', '/ES');
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out.find((r) => r.contract === '/ESU6').close, 7500);
  assert.strictEqual(out.find((r) => r.contract === '/ESZ6').close, 7535);
});

check('es_candles still merges ticks WITHIN one contract', () => {
  // The widened key must not defeat the dedupe it exists inside: a forming bar
  // rewritten on every tick is still one row, or the multi-row upsert aborts
  // with "cannot affect row a second time".
  const out = coalesce([
    bar({ intervalMinutes: 5, contract: '/ESZ6', close: 7530, volume: 10 }),
    bar({ intervalMinutes: 5, contract: '/ESZ6', close: 7535, volume: 20 }),
  ], 'es_candles', '/ES');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].close, 7535);
  assert.strictEqual(out[0].volume, 20);
});

check('a contract-less row defaults to the legacy empty string', () => {
  // Pre-migration rows and any caller that has not been taught the column land
  // on '' rather than undefined, which would break the NOT NULL column.
  const out = coalesce([bar({ intervalMinutes: 5 })], 'es_candles', '/ES');
  assert.strictEqual(out[0].contract, '');
});

check('nq_candles keeps a 1m and a 5m bar at the same clock time apart', () => {
  // nq_candles is UNIQUE("slotKey","intervalMinutes","contract") since the NQ 1m
  // stream landed. Merging these would write the 1m close over the 5m bar.
  const out = coalesce([
    bar({ intervalMinutes: 1, symbol: '/NQ', contract: '/NQZ6' }),
    bar({ intervalMinutes: 5, symbol: '/NQ', contract: '/NQZ6' }),
  ], 'nq_candles', '/NQ');
  assert.strictEqual(out.length, 2);
});

check('rows with no slotKey or a non-positive timestamp are dropped', () => {
  const out = coalesce([
    bar({ slotKey: '' }),
    bar({ timestamp: 0 }),
    bar({ timestamp: -1 }),
    bar({ slotKey: '2026-08-14 09:35' }),
  ], 'es_candles', '/ES');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].slotKey, '2026-08-14 09:35');
});

check('defaults fill in symbol/source/interval when the caller omits them', () => {
  const [r] = coalesce([{ timestamp: 1, slotKey: '2026-08-14 09:30', date: '2026-08-14',
    open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 }], 'nq_candles', '/NQ');
  assert.strictEqual(r.symbol, '/NQ');
  assert.strictEqual(r.source, 'dxlink');
  assert.strictEqual(r.intervalMinutes, 5);
  assert.strictEqual(r.avgVolume, 0);
});

check('no two output rows ever share a conflict target', () => {
  // The invariant. If this fails, Postgres aborts the whole chunk at runtime.
  for (const tbl of ['es_candles', 'nq_candles']) {
    const messy = [];
    for (let i = 0; i < 500; i++) {
      messy.push(bar({
        slotKey: `2026-08-14 09:${String(30 + (i % 7)).padStart(2, '0')}`,
        intervalMinutes: i % 2 ? 1 : 5,
        timestamp: 1_700_000_000_000 + i,
        high: 100 + (i % 13), low: 100 - (i % 11),
      }));
    }
    const out = coalesce(messy, tbl, '/ES');
    const keys = out.map((r) => ckey(r));
    assert.strictEqual(new Set(keys).size, keys.length, `${tbl}: duplicate conflict target in one chunk`);
  }
});

check('the merged extremes match a row-at-a-time replay', () => {
  // Differential check against the semantics of the old loop.
  const rows = Array.from({ length: 300 }, (_, i) =>
    bar({ timestamp: 1000 + i, high: 100 + ((i * 37) % 23), low: 100 - ((i * 17) % 19), close: i }));
  const expectHigh = Math.max(...rows.map((r) => r.high));
  const expectLow = Math.min(...rows.map((r) => r.low));
  const [out] = coalesce(rows, 'es_candles', '/ES');
  assert.strictEqual(out.high, expectHigh);
  assert.strictEqual(out.low, expectLow);
  assert.strictEqual(out.close, rows[rows.length - 1].close);
  assert.strictEqual(out.open, rows[0].open);
});

console.log(fails.length ? `\nFAILED (${fails.length})` : `\nall ${n} candle-coalesce checks passed`);
process.exit(fails.length ? 1 : 0);
