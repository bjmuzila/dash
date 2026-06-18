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
  constructor({ windowMs = 5 * 60 * 1000, maxPrints = 50000 } = {}) {
    this.windowMs = windowMs;
    this.maxPrints = maxPrints;
    /** @type {Array<{time,side,type,size,price,premium}>} */
    this.prints = [];
  }

  /**
   * Add a trade print.
   * @param {object} args
   * @param {string} args.streamerSymbol
   * @param {number} args.price
   * @param {number} args.size
   * @param {number} [args.time] epoch ms
   * @param {object|null} [args.quote] prevailing quote {bid,ask} for side inference
   */
  addPrint({ streamerSymbol, price, size, time = Date.now(), quote = null }) {
    const parsed = parseOptionSymbol(streamerSymbol);
    if (!parsed || !(price > 0) || !(size > 0)) return;
    const side = inferSide(price, quote);
    this.prints.push({
      time,
      side,
      type: parsed.type, // 'C' | 'P'
      size,
      price,
      premium: price * size * 100,
    });
    if (this.prints.length > this.maxPrints) {
      this.prints.splice(0, this.prints.length - this.maxPrints);
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
    };
  }

  reset() {
    this.prints = [];
  }
}

module.exports = {
  FlowProcessor,
  inferSide,
  getLatestBuySellPct,
};
