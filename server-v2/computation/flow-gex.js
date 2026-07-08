'use strict';
/**
 * server-v2/computation/flow-gex.js
 *
 * Dealer inventory tracking and flow-based GEX calculation.
 * - Accumulates buy/sell flow from the tape into per-strike dealer positions
 * - Dealer position = mirror image of taker flow (buy → dealer short, sell → dealer long)
 * - Flow GEX = gamma × dealer_inventory × spot²
 * - Resets daily at market open (or on manual reset)
 */

class FlowGexAccumulator {
  /**
   * @param {object} [opts]
   * @param {string} [opts.timezone] timezone for daily reset (default 'America/New_York')
   */
  constructor({ timezone = 'America/New_York' } = {}) {
    this.timezone = timezone;
    // Map: "YYYY-MM-DD|strike" -> { callBuyVol, callSellVol, putBuyVol, putSellVol }
    this.dealerInventory = new Map();
    // Track current trading day to detect roll/reset
    this.lastDate = null;
    // bucket()'s tape is a rolling snapshot (same order objects persist and
    // mutate in place while coalescing) re-ingested every 500ms tick — track
    // the size already counted per order so re-ingesting doesn't re-add it,
    // and a coalesced size bump only contributes its delta. WeakMap so
    // evicted/spliced orders are freed automatically.
    this._seenSize = new WeakMap();
  }

  /**
   * Ingest the latest flow tape. Accumulate buy/sell volume per strike.
   * Tape entries are { type: 'C'|'P', side: 'buy'|'sell', strike, size, underlying, expiration }
   * @param {Array} tape filtered tape from FlowProcessor.bucket()
   * @param {string} [expiration] active expiration 'YYYY-MM-DD'
   */
  ingestTape(tape, expiration = '') {
    if (!Array.isArray(tape)) return;

    // Check for date roll (reset inventory)
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    if (this.lastDate && this.lastDate !== currentDate) {
      // Market opened on a new day → reset inventory
      this.dealerInventory.clear();
      this._seenSize = new WeakMap();
    }
    this.lastDate = currentDate;

    for (const order of tape) {
      const { type, side, strike, size } = order;
      if (!(strike > 0) || !(size > 0)) continue;

      // Only count what's new since the last tick for this order (see
      // _seenSize comment in the constructor).
      const lastSeen = this._seenSize.get(order) ?? 0;
      const delta = size - lastSeen;
      if (delta <= 0) continue;
      this._seenSize.set(order, size);

      const key = `${currentDate}|${expiration}|${strike}`;
      if (!this.dealerInventory.has(key)) {
        this.dealerInventory.set(key, {
          callBuyVol: 0,
          callSellVol: 0,
          putBuyVol: 0,
          putSellVol: 0,
        });
      }

      const inv = this.dealerInventory.get(key);
      // Dealer position = mirror of taker flow
      // Taker buy → dealer short (subtracts from inventory)
      // Taker sell → dealer long (adds to inventory)
      if (type === 'C') {
        if (side === 'buy') {
          inv.callSellVol += delta; // dealer sold call to taker
        } else {
          inv.callBuyVol += delta; // dealer bought call from taker
        }
      } else if (type === 'P') {
        if (side === 'buy') {
          inv.putSellVol += delta; // dealer sold put to taker
        } else {
          inv.putBuyVol += delta; // dealer bought put from taker
        }
      }
    }
  }

  /**
   * Get cumulative dealer inventory per strike (net position).
   * Positive = dealer long, negative = dealer short.
   * @param {string} expiration 'YYYY-MM-DD'
   * @param {string} [date] defaults to today
   * @returns {Map<number, {callNet, putNet}>} strike -> inventory net
   */
  getInventory(expiration, date = null) {
    if (!date) {
      const now = new Date();
      date = now.toISOString().split('T')[0];
    }

    const result = new Map();
    for (const [key, inv] of this.dealerInventory.entries()) {
      const [keyDate, keyExp, keyStrike] = key.split('|');
      if (keyDate === date && keyExp === expiration) {
        const strike = Number(keyStrike);
        const callNet = inv.callBuyVol - inv.callSellVol;
        const putNet = inv.putBuyVol - inv.putSellVol;
        result.set(strike, { callNet, putNet, ...inv });
      }
    }
    return result;
  }

  /**
   * Compute flow GEX contribution for a strike given dealer inventory and gamma.
   * Flow GEX = gamma × dealer_inventory × spot²
   *
   * callInventory/putInventory are the DEALER'S OWN signed position (positive
   * = dealer long, negative = dealer short) — not customer/public OI. Unlike
   * OI-based GEX (which negates the put term to convert "customer long puts"
   * into "dealer implicitly short puts"), that conversion is already baked
   * into these signs, so both legs use the same polarity: dealer long
   * (either side) = positive contribution, dealer short (either side) =
   * negative contribution. See computeGexRows's inline flowGEX for the same
   * reasoning (this static method itself isn't currently wired up anywhere).
   * @param {number} callGamma absolute call gamma
   * @param {number} putGamma absolute put gamma
   * @param {number} callInventory dealer call inventory (positive = long)
   * @param {number} putInventory dealer put inventory (positive = long)
   * @param {number} spot SPX spot
   * @returns {number} net flow GEX for the strike
   */
  static computeFlowGEX(callGamma, putGamma, callInventory, putInventory, spot) {
    if (!(spot > 0)) return 0;
    const callGEX = callGamma * callInventory * spot * spot;
    const putGEX = putGamma * putInventory * spot * spot;
    return callGEX + putGEX;
  }

  reset() {
    this.dealerInventory.clear();
    this.lastDate = null;
    this._seenSize = new WeakMap();
  }

  /**
   * Bulk-load pre-aggregated per-strike buy/sell volumes (e.g. rebuilt from
   * Postgres flow_prints on process boot) without going through ingestTape's
   * per-order delta tracking. Merges additively so this can also be used to
   * fold in a rehydrate batch on top of whatever's already accumulated.
   * @param {string} date 'YYYY-MM-DD'
   * @param {string} expiration
   * @param {Map<number, {callBuyVol,callSellVol,putBuyVol,putSellVol}>} inventoryByStrike
   */
  hydrate(date, expiration, inventoryByStrike) {
    if (!date || !inventoryByStrike) return;
    this.lastDate = date;
    for (const [strike, vols] of inventoryByStrike) {
      const key = `${date}|${expiration}|${strike}`;
      const inv = this.dealerInventory.get(key) || {
        callBuyVol: 0, callSellVol: 0, putBuyVol: 0, putSellVol: 0,
      };
      inv.callBuyVol += Number(vols.callBuyVol ?? 0);
      inv.callSellVol += Number(vols.callSellVol ?? 0);
      inv.putBuyVol += Number(vols.putBuyVol ?? 0);
      inv.putSellVol += Number(vols.putSellVol ?? 0);
      this.dealerInventory.set(key, inv);
    }
  }
}

module.exports = {
  FlowGexAccumulator,
};
