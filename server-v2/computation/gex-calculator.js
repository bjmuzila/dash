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
 * @returns {Array<object>} per-strike rows sorted ascending by strike
 */
function computeGexRows(rows, spot) {
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

    // DEX = delta × OI × spot × 100
    const netDEX = callDelta * callOI * spot * 100 - putDelta * putOI * spot * 100;
    const volNetDEX =
      callDelta * callVolume * spot * 100 - putDelta * putVolume * spot * 100;

    // Vanna / charm exposure computed by sibling module.
    // Field names match the dashboard's ChainRow: netVanna, netVolVanna.
    const { netVanna, netVolVanna, chex } = computeVexChexRow({ call, put, spot });

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
      netDEX,
      volNetDEX,
      netVanna,
      netVolVanna,
      chex,
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

/** Strike with highest positive OI+Vol net GEX above spot. */
function findCallWall(gexRows, spot) {
  const above = gexRows.filter((r) => r.strike > spot && oiVolNet(r) > 0);
  if (!above.length) return null;
  return above.reduce((best, r) => (oiVolNet(r) > oiVolNet(best) ? r : best)).strike;
}

/** Strike with most negative OI+Vol net GEX below spot. */
function findPutWall(gexRows, spot) {
  const below = gexRows.filter((r) => r.strike < spot && oiVolNet(r) < 0);
  if (!below.length) return null;
  return below.reduce((best, r) => (oiVolNet(r) < oiVolNet(best) ? r : best)).strike;
}

/** Total OI+Vol net GEX across all strikes. */
function totalNetGex(gexRows) {
  return gexRows.reduce((sum, r) => sum + oiVolNet(r), 0);
}

/**
 * Convenience: compute rows + all summary levels in one pass.
 * @returns {{rows, callWall, putWall, gexFlip, totalNetGex}}
 */
function computeGexSummary(rows, spot) {
  const computed = computeGexRows(rows, spot);
  return {
    rows: computed,
    callWall: findCallWall(computed, spot),
    putWall: findPutWall(computed, spot),
    gexFlip: findGexFlip(computed, spot),
    totalNetGex: totalNetGex(computed),
  };
}

module.exports = {
  computeGexRows,
  findGexFlip,
  findCallWall,
  findPutWall,
  totalNetGex,
  computeGexSummary,
};
