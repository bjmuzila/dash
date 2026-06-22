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

/** A quote older than this (ms) can't be trusted for at/outside-spread
 *  classification — a stale low ask makes every later print look like a
 *  buy (`price >= ask`), which collapses sell volume to ~0. */
const QUOTE_FRESH_MS = 2500;

/**
 * Infer aggressor side from a print vs the prevailing quote (Lee-Ready) with a
 * tick-rule fallback when the quote is stale or the print sits outside a stale
 * spread.
 * @param {number} price trade price
 * @param {object|null} quote prevailing quote { bid, ask, t? }
 * @param {number} [lastTrade] previous trade price for this symbol (tick rule)
 * @param {number} [now] current epoch ms
 * @returns {'buy'|'sell'|'mid'|'unknown'}
 */
function inferSide(price, quote, lastTrade = null, now = Date.now()) {
  const tick = () => {
    if (lastTrade == null || !(lastTrade > 0)) return 'unknown';
    if (price > lastTrade) return 'buy';
    if (price < lastTrade) return 'sell';
    return 'unknown';
  };
  if (!quote || quote.bid == null || quote.ask == null) return tick();
  const { bid, ask } = quote;
  if (!(ask >= bid)) return tick();
  const fresh = quote.t == null || (now - quote.t) <= QUOTE_FRESH_MS;
  const mid = (bid + ask) / 2;
  // Inside the spread is reliable regardless of freshness.
  if (price > bid && price < ask) {
    if (price > mid) return 'buy';
    if (price < mid) return 'sell';
    return 'mid';
  }
  // At/outside the spread: only trust a fresh quote; otherwise the quote has
  // likely lagged the market — defer to the tick rule.
  if (!fresh) return tick();
  if (price >= ask) return 'buy';
  if (price <= bid) return 'sell';
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
  constructor({ windowMs = 5 * 60 * 1000, maxPrints = 50000, tapeCap = 500, tapeFloorPremium = 10000 } = {}) {
    this.windowMs = windowMs;
    this.maxPrints = maxPrints;
    this.tapeCap = tapeCap;
    // Server-side noise floor: prints below this premium ($) never enter the
    // tape, so the cap isn't consumed by tiny prints that evict real blocks
    // before the client's ≥$100k filter can ever see them (flow logic §5.3).
    this.tapeFloorPremium = tapeFloorPremium;
    /** @type {Array<{time,side,type,size,price,premium}>} */
    this.prints = [];
    /** streamerSymbol -> last trade price, for the tick-rule side fallback. */
    this.lastTradePx = new Map();
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
    const lastTrade = this.lastTradePx.get(streamerSymbol);
    const side = inferSide(price, quote, lastTrade, time);
    this.lastTradePx.set(streamerSymbol, price);
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
    const tapeSide = side === 'buy' || side === 'sell' ? side : 'buy';
    // The tape is an SPX-only flow view; non-SPX underlyings never belong on it
    // and must not consume cap slots (previously filtered only at read time,
    // after the cap had already evicted real SPX blocks).
    const isSpx = parsed.root === 'SPX' || parsed.root === 'SPXW';
    if (!isSpx) return;
    // Coalesce prints on the same contract + side into 500ms aggregate orders.
    // The tape is oldest-first, so the candidate to merge into is the last entry;
    // merge when it shares symbol+side+action and falls in the same 500ms slot.
    const slot = Math.floor(time / 500);
    const last = this.tape[this.tape.length - 1];
    if (
      last &&
      last.symbol === streamerSymbol &&
      last.side === tapeSide &&
      last.action === action &&
      Math.floor(last.ts / 500) === slot
    ) {
      const newSize = last.size + size;
      // Size-weighted average fill price across the aggregated prints.
      last.price = newSize > 0 ? (last.price * last.size + price * size) / newSize : price;
      last.size = newSize;
      last.premium += premium;
    } else {
      // Always open the slot so small prints in the window coalesce into it
      // (premium accumulates). The noise floor is applied at read time in
      // bucket(), so a sweep that starts small can still grow into a real block.
      this.tape.push({
        ts: slot * 500, // pin to the 500ms slot start so later prints coalesce
        symbol: streamerSymbol,
        underlying: parsed.root,
        expiration: parsed.expiration,
        strike: parsed.strike,
        type: parsed.type,
        side: tapeSide,
        action,
        bucket,
        price,
        size,
        premium,
        isOtm,
      });
      // Evict by counting only above-floor blocks, so a burst of sub-floor
      // 500ms slots can't push real ≥floor blocks out of the cap before the
      // read-time filter in bucket() ever sees them. Drop oldest sub-floor
      // slots first; only trim real blocks once they alone exceed the cap.
      if (this.tape.length > this.tapeCap) {
        const realCount = this.tape.reduce(
          (n, o) => n + (o.premium >= this.tapeFloorPremium ? 1 : 0), 0);
        if (realCount > this.tapeCap) {
          // Too many real blocks: keep the newest tapeCap of everything.
          this.tape.splice(0, this.tape.length - this.tapeCap);
        } else {
          // Drop oldest sub-floor slots until within cap (keep all real blocks).
          let over = this.tape.length - this.tapeCap;
          for (let i = 0; i < this.tape.length && over > 0; ) {
            if (this.tape[i].premium < this.tapeFloorPremium) {
              this.tape.splice(i, 1);
              over--;
            } else {
              i++;
            }
          }
        }
      }
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
      // SPX-only (see addPrint); noise floor applied here so coalesced sweeps
      // that grew past the floor are kept, while never-grew slots are dropped.
      tape: this.tape.filter((o) => o.premium >= this.tapeFloorPremium),
    };
  }

  reset() {
    this.prints = [];
    this.tape = [];
    this.lastTradePx.clear();
  }
}

module.exports = {
  FlowProcessor,
  inferSide,
  getLatestBuySellPct,
};
