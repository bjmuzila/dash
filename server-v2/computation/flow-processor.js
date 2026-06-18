'use strict';
/**
 * server-v2/computation/flow-processor.js
 *
 * Aggregates the option trade tape into rolling flow buckets.
 *   - Infers aggressor side (buy/sell) from trade price vs prevailing quote.
 *   - Buckets buy/sell volume split by call/put.
 *   - Net premium = (buy − sell) × price × size × 100.
 *   - buyPct ported from original server/computation/flow-processor.js semantics.
 *
 * Pure functions where possible; the FlowProcessor class holds a rolling
 * in-memory window of prints (no external I/O).
 */

const { parseOptionSymbol } = require('./utils');

/** Latest buy/sell percentage from a record series (ported). */
function getLatestBuySellPct(records) {
  if (!Array.isArray(records) || !records.length) return 0;
  const latest = records[records.length - 1];
  return Number(latest?.buyPct || 0);
}

/**
 * Infer aggressor side from a print vs the prevailing quote.
 * @returns {'buy'|'sell'|'mid'|'unknown'}
 */
function inferSide(price, quote) {
  if (!quote || quote.bid == null || quote.ask == null) return 'unknown';
  const { bid, ask } = quote;
  if (!(ask >= bid)) return 'unknown';
  const mid = (bid + ask) / 2;
  if (price >= ask) return 'buy';
  if (price <= bid) return 'sell';
  if (price > mid) return 'buy';
  if (price < mid) return 'sell';
  return 'mid';
}

class FlowProcessor {
  /**
   * @param {object} [opts]
   * @param {number} [opts.windowMs] rolling window length (default 5 min)
   * @param {number} [opts.maxPrints] hard cap on retained prints
   */
  /**
   * @param {object} [opts]
   * @param {number} [opts.windowMs] rolling window length (default 5 min)
   * @param {number} [opts.maxPrints] hard cap on retained prints
   * @param {number} [opts.tapeCap] hard cap on the per-order tape (default 200)
   */
  constructor({ windowMs = 5 * 60 * 1000, maxPrints = 50000, tapeCap = 200 } = {}) {
    this.windowMs = windowMs;
    this.maxPrints = maxPrints;
    this.tapeCap = tapeCap;
    /** @type {Array<{time,side,type,size,price,premium}>} */
    this.prints = [];
    /**
     * Capped FIFO of recent per-order tape entries, oldest-first. Each entry is
     * already in the FlowOrder shape the dashboard's FlowTape consumes.
     * @type {Array<object>}
     */
    this.tape = [];
  }

  /**
   * Add a trade print.
   * @param {object} args
   * @param {string} args.streamerSymbol
   * @param {number} args.price
   * @param {number} args.size
   * @param {number} [args.time] epoch ms
   * @param {object|null} [args.quote] prevailing quote {bid,ask} for side inference
   * @param {number} [args.spot] underlying spot at print time (for isOtm/bucket)
   */
  addPrint({ streamerSymbol, price, size, time = Date.now(), quote = null, spot = 0 }) {
    const parsed = parseOptionSymbol(streamerSymbol);
    if (!parsed || !(price > 0) || !(size > 0)) return;
    const side = inferSide(price, quote);
    const premium = price * size * 100;
    this.prints.push({
      time,
      side,
      type: parsed.type, // 'C' | 'P'
      size,
      price,
      premium,
    });
    if (this.prints.length > this.maxPrints) {
      this.prints.splice(0, this.prints.length - this.maxPrints);
    }

    // Build the FlowOrder-shaped tape entry. Only buy/sell prints get a
    // directional action; mid/unknown collapse to a neutral 'FLOW' row.
    const isCall = parsed.type === 'C';
    const isOtm = spot > 0
      ? (isCall ? parsed.strike > spot : parsed.strike < spot)
      : false;
    let action = 'FLOW';
    let bucket = 'neutral';
    if (side === 'buy' || side === 'sell') {
      const verb = side === 'buy' ? 'BUY' : 'SELL';
      action = `${verb} ${isCall ? 'CALL' : 'PUT'}`;
      // Bull = buy calls / sell puts; Bear = buy puts / sell calls.
      const bullish = (side === 'buy' && isCall) || (side === 'sell' && !isCall);
      bucket = bullish ? 'bull' : 'bear';
    }
    this.tape.push({
      ts: time,
      symbol: streamerSymbol,
      underlying: parsed.root,
      expiration: parsed.expiration,
      strike: parsed.strike,
      type: parsed.type,
      side: side === 'buy' || side === 'sell' ? side : 'buy',
      action,
      bucket,
      price,
      size,
      premium,
      isOtm,
    });
    if (this.tape.length > this.tapeCap) {
      this.tape.splice(0, this.tape.length - this.tapeCap);
    }
  }

  /** Drop prints older than the window relative to `now`. */
  prune(now = Date.now()) {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.prints.length && this.prints[i].time < cutoff) i++;
    if (i > 0) this.prints.splice(0, i);
  }

  /**
   * Aggregate current window into a flow bucket.
   * @param {string} symbol
   * @param {number} [now]
   * @returns {object} FlowBucket
   */
  bucket(symbol, now = Date.now()) {
    this.prune(now);
    let callBuyVol = 0;
    let callSellVol = 0;
    let putBuyVol = 0;
    let putSellVol = 0;
    let netPremium = 0;

    for (const p of this.prints) {
      const isCall = p.type === 'C';
      if (p.side === 'buy') {
        if (isCall) callBuyVol += p.size;
        else putBuyVol += p.size;
        netPremium += p.premium;
      } else if (p.side === 'sell') {
        if (isCall) callSellVol += p.size;
        else putSellVol += p.size;
        netPremium -= p.premium;
      }
    }

    const buyVol = callBuyVol + putBuyVol;
    const sellVol = callSellVol + putSellVol;
    const totalVol = buyVol + sellVol;
    const buyPct = totalVol > 0 ? (buyVol / totalVol) * 100 : 0;

    return {
      symbol,
      windowMs: this.windowMs,
      asOf: now,
      callBuyVol,
      callSellVol,
      putBuyVol,
      putSellVol,
      netPremium,
      buyPct,
      prints: this.prints.length,
      // Per-order tape (capped, oldest-first) for the dashboard FlowTape.
      // SPX-only: the tape is an SPX flow view regardless of the active feed
      // symbol, so non-SPX underlyings (e.g. NVDA) yield an empty tape.
      tape: this.tape.filter((o) => o.underlying === 'SPX' || o.underlying === 'SPXW'),
    };
  }

  reset() {
    this.prints = [];
    this.tape = [];
  }
}

module.exports = {
  FlowProcessor,
  inferSide,
  getLatestBuySellPct,
};
