'use strict';
/**
 * server-v2/computation/gex-calculator.js
 *
 * Pure GEX computation. Calculations ported from the original
 * server/computation/gex-calculator.js (formulas preserved verbatim):
 *   - GEX  = gamma × OI × spot²   (calls positive, puts negative)
 *   - volGEX uses volume in place of OI
 *   - DEX  = delta × OI × spot × 100
 *   - flip = zero-crossing of cumulative net GEX (linear interpolation)
 *   - walls = extreme net-GEX strikes above/below spot
 *
 * SCOPE WARNING: computeGexRows() is SINGLE-EXPIRY. It groups by strike alone,
 * so multi-expiry input keeps only the last expiry per (strike, side). For a
 * whole-board ladder use computeGexRowsMultiExpiry() instead.
 *
 * Input: flat option rows + spot. Output: per-strike rows + summary.
 * No I/O, no side effects — fully testable.
 */

const { computeVexChexRow } = require('./vex-chex');

/**
 * Group flat option rows by strike and compute all exposure fields.
 *
 * @param {Array<object>} rows - flattened option rows, each with:
 *   { strike, side:'call'|'put', oi, volume, gamma, delta, theta, vega, vanna, charm, iv, dte }
 * @param {number} spot - SPX spot price
 * @param {Map<number, {callNet, putNet}>} [flowInventory] - dealer inventory per strike for flow GEX
 * @returns {Array<object>} per-strike rows sorted ascending by strike
 */
function computeGexRows(rows, spot, flowInventory = null) {
  if (!Array.isArray(rows) || !rows.length || !(spot > 0)) return [];

  const byStrike = new Map();
  for (const row of rows) {
    if (!(row.strike > 0)) continue;
    if (!byStrike.has(row.strike)) byStrike.set(row.strike, { call: null, put: null });
    byStrike.get(row.strike)[row.side] = row;
  }

  const result = [];
  for (const [strike, sides] of byStrike) {
    const call = sides.call;
    const put = sides.put;

    const callOI = Number(call?.oi ?? 0);
    const putOI = Number(put?.oi ?? 0);
    const callVolume = Number(call?.volume ?? 0);
    const putVolume = Number(put?.volume ?? 0);
    const callGamma = Math.abs(Number(call?.gamma ?? 0));
    const putGamma = Math.abs(Number(put?.gamma ?? 0));
    const callDelta = Number(call?.delta ?? 0);
    const putDelta = Math.abs(Number(put?.delta ?? 0));
    const callIV = Number(call?.iv ?? 0);
    const putIV = Number(put?.iv ?? 0);

    // Contract price (mark, falling back to bid/ask mid) per side, so the
    // strike-detail popup can show the OTM contract price without a 2nd fetch.
    const midOf = (q) => {
      const b = Number(q?.bid ?? 0), a = Number(q?.ask ?? 0);
      return b > 0 && a > 0 ? (b + a) / 2 : 0;
    };
    const callMark = Number(call?.mark ?? 0) || midOf(call);
    const putMark = Number(put?.mark ?? 0) || midOf(put);

    // GEX = gamma × OI × spot² (calls positive, puts negative)
    const callGEX = callGamma * callOI * spot * spot;
    const putGEX = -(putGamma * putOI * spot * spot);
    const netGEX = callGEX + putGEX;

    // Vol GEX uses volume instead of OI
    const netVolGEX =
      callGamma * callVolume * spot * spot - putGamma * putVolume * spot * spot;

    // Directional Vol GEX. netVolGEX above assumes ALL volume is dealer-long
    // calls / short puts (the OI-sign convention) — it never checks whether a
    // trade lifted the ask (buy) or hit the bid (sell). Here we sign the day's
    // REST volume by the buy/sell ratio actually observed on the classified tape
    // (inferSide's bid/ask → buy/sell). flowInventory carries the dealer-mirrored
    // buy/sell split per strike; (dealerBuy − dealerSell)/total is the net
    // dealer-direction fraction, which scales the full REST volume into a signed
    // dealer quantity → GEX = γ × qty × spot². Dealer polarity means BOTH legs
    // use +gamma (dealer long = positive), same as flowGEX — no separate put
    // flip. A strike/side with no classified flow can't be signed, so it falls
    // back to the raw netVolGEX term (call side) or contributes 0 (missing side).
    let netVolGexDir = netVolGEX;
    if (flowInventory && flowInventory.has(strike)) {
      const fi = flowInventory.get(strike);
      const callTot = (fi.callBuyVol ?? 0) + (fi.callSellVol ?? 0);
      const putTot = (fi.putBuyVol ?? 0) + (fi.putSellVol ?? 0);
      if (callTot > 0 || putTot > 0) {
        const callDealerVol =
          callTot > 0 ? ((fi.callBuyVol - fi.callSellVol) / callTot) * callVolume : 0;
        const putDealerVol =
          putTot > 0 ? ((fi.putBuyVol - fi.putSellVol) / putTot) * putVolume : 0;
        netVolGexDir =
          callGamma * callDealerVol * spot * spot +
          putGamma * putDealerVol * spot * spot;
      }
    }

    // DEX = delta × OI × spot × 100
    const netDEX = callDelta * callOI * spot * 100 - putDelta * putOI * spot * 100;
    const volNetDEX =
      callDelta * callVolume * spot * 100 - putDelta * putVolume * spot * 100;

    // Flow GEX = gamma × dealer_inventory × spot²
    // inv.callNet / inv.putNet are already the DEALER'S OWN signed position
    // (positive = dealer long, negative = dealer short) — unlike OI-based GEX
    // (callOI/putOI), which is customer/public open interest and needs the
    // put term negated to convert "customer long puts" into "dealer implicitly
    // short puts." That conversion is already baked into inv.putNet's sign, so
    // negating again here would double-flip it: a dealer net SHORT puts
    // (inv.putNet < 0) is a short-gamma position and must contribute
    // NEGATIVE flow GEX, same polarity as being short calls — no separate
    // sign flip between the two legs like the OI-based formula uses.
    let flowGEX = 0;
    if (flowInventory && flowInventory.has(strike)) {
      const inv = flowInventory.get(strike);
      const callFlowGEX = callGamma * inv.callNet * spot * spot;
      const putFlowGEX = putGamma * inv.putNet * spot * spot;
      flowGEX = callFlowGEX + putFlowGEX;
    }

    // Vanna / charm exposure computed by sibling module.
    // Field names match the dashboard's ChainRow: netVanna, netVolVanna.
    const { netVanna, netVolVanna, chex, volChex } = computeVexChexRow({ call, put, spot });

    result.push({
      strike,
      spotPrice: spot,
      callOI,
      putOI,
      callVolume,
      putVolume,
      callGamma,
      putGamma,
      callDelta,
      putDelta,
      callGEX,
      putGEX,
      netGEX,
      netVolGEX,
      netVolGexDir,
      flowGEX,
      netDEX,
      volNetDEX,
      netVanna,
      netVolVanna,
      chex,
      volChex,
      callIV,
      putIV,
      callMark,
      putMark,
      dte: call?.dte ?? put?.dte ?? 0,
    });
  }

  return result.sort((a, b) => a.strike - b.strike);
}

/** Find the GEX flip point (zero-crossing of cumulative net GEX). */
function findGexFlip(gexRows, spot) {
  if (!gexRows.length || !(spot > 0)) return null;
  const sorted = [...gexRows].sort((a, b) => a.strike - b.strike);
  let cum = 0;
  let prevCum = 0;
  let prevStrike = null;
  for (const row of sorted) {
    prevCum = cum;
    cum += oiVolNet(row);
    if (prevStrike !== null && prevCum < 0 && cum >= 0) {
      const range = cum - prevCum;
      return Math.abs(range) > 0
        ? prevStrike + (row.strike - prevStrike) * (-prevCum / range)
        : row.strike;
    }
    prevStrike = row.strike;
  }
  return null;
}

// OI+Vol net GEX for a row = OI-net (netGEX) + vol-net (netVolGEX). This is the
// basis the dashboard heatmap / chart / MVC all use, so walls + totals must match.
function oiVolNet(r) {
  return Number(r.netGEX ?? 0) + Number(r.netVolGEX ?? 0);
}

/**
 * `exclude` — a strike to take OUT of the running before picking a wall.
 *
 * WHY. The Core Bullseye (largest |net GEX| ANYWHERE on the chain, computed
 * separately — see scanner-recorder.findCoreBullseye) is very often the same
 * strike as the call wall: the biggest node on the board is frequently the
 * biggest positive node above spot. Nothing stopped the two from landing on one
 * another, so a levels view drew CB and CW as one line and the second-biggest
 * wall — the level price actually has to get through after the core — was never
 * shown at all. Same story below spot with the put wall.
 *
 * Passing the CB in as `exclude` makes the wall fall back to the NEXT strike:
 * the 2nd-highest +GEX above spot, or the 2nd-most-negative below it. When CB
 * is not the wall (the usual case) excluding it changes nothing, because it was
 * not going to win the reduce anyway.
 *
 * Opt-in on purpose. Callers that want the plain definition — the SPX live feed,
 * the GEX chart, Multi Greek — pass nothing and are completely unaffected.
 */
function excluding(gexRows, exclude) {
  if (exclude == null || !(Number(exclude) > 0)) return gexRows;
  return gexRows.filter((r) => Number(r.strike) !== Number(exclude));
}

/** Strike with highest positive OI+Vol net GEX above spot. */
function findCallWall(gexRows, spot, { exclude = null } = {}) {
  const above = excluding(gexRows, exclude).filter((r) => r.strike > spot && oiVolNet(r) > 0);
  if (!above.length) return null;
  return above.reduce((best, r) => (oiVolNet(r) > oiVolNet(best) ? r : best)).strike;
}

/** Strike with most negative OI+Vol net GEX below spot. */
function findPutWall(gexRows, spot, { exclude = null } = {}) {
  const below = excluding(gexRows, exclude).filter((r) => r.strike < spot && oiVolNet(r) < 0);
  if (!below.length) return null;
  return below.reduce((best, r) => (oiVolNet(r) < oiVolNet(best) ? r : best)).strike;
}

/** Total OI+Vol net GEX across all strikes. */
function totalNetGex(gexRows) {
  return gexRows.reduce((sum, r) => sum + oiVolNet(r), 0);
}

/**
 * Per-strike ladder summed across MULTIPLE EXPIRATIONS.
 *
 * WHY THIS EXISTS. computeGexRows() groups by strike ALONE:
 *     byStrike.get(row.strike)[row.side] = row
 * so if you hand it rows from more than one expiration, every (strike, side)
 * keeps only the LAST expiry seen and the rest are silently discarded — a
 * two-expiry board with identical books returns the same GEX as one expiry, not
 * double. It was only ever designed for the single-expiry live feed.
 *
 * GEX is additive across expirations (γ × qty × spot², summed), so the correct
 * whole-board ladder is: compute each expiry's ladder independently, then sum
 * the exposure fields per strike. That is what this does.
 *
 * Rows must carry an `expiration` field; rows without one are treated as a
 * single unnamed expiry.
 *
 * ADDITIVE fields are summed: OI, volume, callGEX/putGEX/netGEX, netVolGEX,
 * netVolGexDir, flowGEX, netDEX, volNetDEX, vanna/chex.
 * PER-CONTRACT fields (callGamma, putGamma, callDelta, putDelta, IVs, marks,
 * dte) cannot be summed and are taken from the NEAREST expiry at that strike —
 * representative only. Do not read a merged row's gamma as "the" gamma; the
 * exposure fields are the meaningful output. `expiryCount` records how many
 * expirations contributed.
 *
 * flowInventory is deliberately NOT accepted: dealer inventory is tracked per
 * expiry, so there is no correct way to apply one map across a whole board.
 */
function computeGexRowsMultiExpiry(rows, spot) {
  if (!Array.isArray(rows) || !rows.length || !(spot > 0)) return [];

  const byExpiry = new Map();
  for (const row of rows) {
    const k = row?.expiration ?? '__single__';
    if (!byExpiry.has(k)) byExpiry.set(k, []);
    byExpiry.get(k).push(row);
  }

  const SUM_FIELDS = [
    'callOI', 'putOI', 'callVolume', 'putVolume',
    'callGEX', 'putGEX', 'netGEX', 'netVolGEX', 'netVolGexDir', 'flowGEX',
    'netDEX', 'volNetDEX', 'netVanna', 'netVolVanna', 'chex', 'volChex',
  ];
  // Carried from the nearest-dated expiry present at that strike, not summed.
  const NEAREST_FIELDS = [
    'callGamma', 'putGamma', 'callDelta', 'putDelta',
    'callIV', 'putIV', 'callMark', 'putMark',
  ];

  const merged = new Map(); // strike -> accumulated row
  for (const [, expRows] of byExpiry) {
    for (const r of computeGexRows(expRows, spot)) {
      const cur = merged.get(r.strike);
      if (!cur) {
        merged.set(r.strike, { ...r, expiryCount: 1 });
        continue;
      }
      for (const f of SUM_FIELDS) cur[f] = (Number(cur[f]) || 0) + (Number(r[f]) || 0);
      // Nearer expiry wins the per-contract fields (dte ascending).
      if ((Number(r.dte) || 0) < (Number(cur.dte) || 0)) {
        for (const f of NEAREST_FIELDS) cur[f] = r[f];
        cur.dte = r.dte;
      }
      cur.expiryCount += 1;
    }
  }

  return [...merged.values()].sort((a, b) => a.strike - b.strike);
}

/** Adds normalizedGexPct to each row: |netGEX| / Σ|netGEX| × 100. */
function normalizeGex(gexRows) {
  const totalAbs = gexRows.reduce((sum, r) => sum + Math.abs(oiVolNet(r)), 0);
  return gexRows.map((r) => ({
    ...r,
    normalizedGexPct: totalAbs > 0 ? (Math.abs(oiVolNet(r)) / totalAbs) * 100 : 0,
  }));
}

/** Total flow GEX across all strikes. */
function totalFlowGex(gexRows) {
  return gexRows.reduce((sum, r) => sum + (Number(r.flowGEX ?? 0)), 0);
}

/**
 * Convenience: compute rows + all summary levels in one pass.
 * @returns {{rows, callWall, putWall, gexFlip, totalNetGex, totalFlowGex}}
 */
function computeGexSummary(rows, spot, flowInventory = null) {
  const computed = computeGexRows(rows, spot, flowInventory);
  return {
    rows: computed,
    callWall: findCallWall(computed, spot),
    putWall: findPutWall(computed, spot),
    gexFlip: findGexFlip(computed, spot),
    totalNetGex: totalNetGex(computed),
    totalFlowGex: totalFlowGex(computed),
  };
}

module.exports = {
  computeGexRows,
  computeGexRowsMultiExpiry,
  findGexFlip,
  findCallWall,
  findPutWall,
  totalNetGex,
  totalFlowGex,
  normalizeGex,
  computeGexSummary,
};
