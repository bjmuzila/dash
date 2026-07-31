'use strict';
// Stream-layer checks. Stubs proxy-tastytrade so no socket is opened.
const assert = require('assert');
// Runs with a stub dxLink client so no socket is opened and no token is needed:
//   node server-v2/cb-stream.selftest.js
// The stub lives in the test itself — see makeStub() below.
const Module = require('module');
const path = require('path');
const TT = path.join(__dirname, 'proxy-tastytrade.js');
let onEventCb = null, onStatusCb = null; const subscribed = [];
class FakeClient {
  constructor({ onEvent, onStatus }) { onEventCb = onEvent; onStatusCb = onStatus; }
  connect() { setImmediate(() => onStatusCb({ dxlinkConnected: true })); }
  subscribe(syms) { subscribed.push(...syms); }
  close() { this.closed = true; }
}
require.cache[TT] = { id: TT, filename: TT, loaded: true, exports: {
  DxLinkClient: FakeClient, getQuoteToken: async () => ({ token: 't', url: 'wss://x' }) } };
void Module;
const hooks = { ev: () => onEventCb, st: () => onStatusCb, subs: subscribed };
const s = require('./cb-stream');


let n = 0; const fails = [];
const check = (name, fn) => { try { fn(); n++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL ${name}\n       ${e.message}`); } };
const quote = (sym, bid, ask) => hooks.ev()({ eventType: 'Quote', eventSymbol: sym, bidPrice: bid, askPrice: ask });
const SYM = '.SPXW260731C6650';

(async () => {
  console.log('cb-stream selftest');
  s.track([{ id: 1, streamer_symbol: SYM }]);
  // The token fetch is async, so the socket is not up on the next tick. Wait for
  // the connect handler to run — that is also what does the first subscribe.
  await new Promise((r) => setTimeout(r, 30));

  check('the held contract is subscribed once the socket comes up', () => {
    s.track([{ id: 1, streamer_symbol: SYM }]);   // idempotent re-track
    assert.deepStrictEqual(subscribed, [SYM], 'exactly one subscription, no duplicate from the re-track');
  });
  check('connected but silent is NOT reported as working', () => {
    // The whole failure model: a live socket that never delivers an event must
    // not look healthy, or a frozen row reads as a flat market.
    assert.strictEqual(s.isFresh(SYM), false);
    assert.strictEqual(s.health().fresh, 0);
  });
  check('a quote makes the symbol fresh', () => {
    quote(SYM, 1.00, 1.10);
    assert.strictEqual(s.isFresh(SYM), true);
    assert.strictEqual(s.health().fresh, 1);
  });
  check('a symbol gone quiet past the stale window falls back to REST', () => {
    const future = Date.now() + s.CONFIG.STALE_MS + 1000;
    assert.strictEqual(s.isFresh(SYM, future), false);
    assert.strictEqual(s.health(future).stale, 1);
  });
  check('the forming minute is withheld from drain()', () => {
    // Persisting a partial bar would let its high be revised after it was
    // written, and the caller uses the high to move a high-water mark.
    assert.deepStrictEqual(s.drain(), []);
  });
  check('a completed minute drains as OHLC of the MID, not the last price', () => {
    quote(SYM, 2.00, 2.20);   // mid 2.10 — the spike
    quote(SYM, 0.90, 1.00);   // mid 0.95 — the trough
    quote(SYM, 1.40, 1.50);   // mid 1.45 — the close
    // Force the minute to roll by emitting into the next bar.
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    quote(SYM, 1.30, 1.40);
    Date.now = realNow;
    const bars = s.drain();
    assert.strictEqual(bars.length, 1, `expected one completed bar, got ${bars.length}`);
    const b = bars[0];
    assert.ok(Math.abs(b.open - 1.05) < 1e-9, `open ${b.open}`);
    assert.ok(Math.abs(b.high - 2.10) < 1e-9, `high ${b.high} — the intra-minute spike a 60s poll would have missed`);
    assert.ok(Math.abs(b.low - 0.95) < 1e-9, `low ${b.low}`);
    assert.ok(Math.abs(b.close - 1.45) < 1e-9, `close ${b.close}`);
    assert.strictEqual(b.tradeId, 1);
    assert.strictEqual(b.events, 4);
  });
  check('draining twice does not replay the same bar', () => {
    assert.deepStrictEqual(s.drain(), []);
  });
  check('a reconnect resubscribes every held symbol', () => {
    const before = subscribed.length;
    hooks.st()({ dxlinkConnected: false });
    hooks.st()({ dxlinkConnected: true });
    assert.ok(subscribed.length > before, 'a subscription that silently did not survive is the likeliest failure');
    assert.ok(subscribed.slice(before).includes(SYM));
  });
  check('an event for an unsubscribed symbol is ignored', () => {
    quote('.SPXW260731P1234', 5, 6);
    assert.strictEqual(s.health().symbols['.SPXW260731P1234'], undefined);
  });
  check('stop() flushes the partial bar rather than losing the close', () => {
    quote(SYM, 3.00, 3.20);
    s.stop();
    const bars = s.drain();
    assert.ok(bars.length >= 1, 'the last partial minute must survive the teardown');
    assert.strictEqual(s.health().subscribed, 0);
  });
  console.log(fails.length ? `\nFAILED (${fails.length})` : `\nall ${n} stream checks passed`);
  process.exit(fails.length ? 1 : 0);
})();
