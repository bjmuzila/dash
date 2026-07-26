/**
 * Pure GEX computation functions.
 * Input: flat option rows (from tt-chain.js) + spot price.
 * Output: per-strike GEX rows ready for the chart and heatmap.
 * No I/O, no side effects — fully testable.
 */
'use strict';

/**
 * Group flat option rows by strike and compute all GEX fields.
 *
 * @param {Array}  rows  - from fetchChainRows()
 * @param {number} spot  - SPX spot price
 * @returns {Array} ChainRow-compatible objects sorted by strike
 */
function computeGexRows(rows, spot) {
  if (!rows.length || !(spot > 0)) return [];

  // Group by strike
  const byStrike = new Map();
  for (const row of rows) {
    if (!(row.strike > 0)) continue;
    if (!byStrike.has(row.strike)) {
      byStrike.set(row.strike, { call: null, put: null });
    }
    byStrike.get(row.strike)[row.side] = row;
  }

  const result = [];
  for (const [strike, sides] of byStrike) {
    const call = sides.call;
    const put  = sides.put;

    const callOI     = Number(call?.oi     ?? 0);
    const putOI      = Number(put?.oi      ?? 0);
    const callVolume = Number(call?.volume  ?? 0);
    const putVolume  = Number(put?.volume   ?? 0);
    const callGamma  = Math.abs(Number(call?.gamma ?? 0));
    const putGamma   = Math.abs(Number(put?.gamma  ?? 0));
    const callDelta  = Number(call?.delta  ?? 0);
    const putDelta   = Math.abs(Number(put?.delta  ?? 0));
    const callIV     = Number(call?.iv     ?? 0);
    const putIV      = Number(put?.iv      ?? 0);

    // GEX = gamma × OI × spot² (calls positive, puts negative)
    const callGEX   = callGamma * callOI * spot * spot;
    const putGEX    = -(putGamma * putOI * spot * spot);
    const netGEX    = callGEX + putGEX;

    // Vol GEX uses volume instead of OI
    const netVolGEX = callGamma * callVolume * spot * spot
                    - putGamma  * putVolume  * spot * spot;

    // DEX = delta × OI × spot × 100
    const netDEX    = callDelta * callOI     * spot * 100
                    - putDelta  * putOI      * spot * 100;
    const volNetDEX = callDelta * callVolume * spot * 100
                    - putDelta  * putVolume  * spot * 100;

    result.push({
      strike,
      spotPrice:  spot,
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
      callIV,
      putIV,
      dte: call?.dte ?? put?.dte ?? 0,
    });
  }

  return result.sort((a, b) => a.strike - b.strike);
}

/**
 * Find the GEX flip point (zero-crossing of cumulative net GEX).
 */
function findGexFlip(gexRows, spot) {
  if (!gexRows.length || !(spot > 0)) return null;
  const sorted = [...gexRows].sort((a, b) => a.strike - b.strike);
  let cum = 0, prevCum = 0, prevStrike = null;
  for (const row of sorted) {
    prevCum = cum;
    cum += row.netGEX;
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

/** Strike with highest positive net GEX above spot. */
function findCallWall(gexRows, spot) {
  const above = gexRows.filter(r => r.strike > spot && r.netGEX > 0);
  if (!above.length) return null;
  return above.reduce((best, r) => r.netGEX > best.netGEX ? r : best).strike;
}

/** Strike with most negative net GEX below spot. */
function findPutWall(gexRows, spot) {
  const below = gexRows.filter(r => r.strike < spot && r.netGEX < 0);
  if (!below.length) return null;
  return below.reduce((best, r) => r.netGEX < best.netGEX ? r : best).strike;
}

/** Total net GEX across all strikes. */
function totalNetGex(gexRows) {
  return gexRows.reduce((sum, r) => sum + (r.netGEX ?? 0), 0);
}

module.exports = { computeGexRows, findGexFlip, findCallWall, findPutWall, totalNetGex };
