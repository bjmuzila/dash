'use strict';
/**
 * server-v2/computation/vex-chex.js
 *
 * Vanna (VEX) and Charm (CHEX) exposure, plus the aggregate exposure
 * accumulator. Conventions ported from the original
 * server/computation/vex-chex.js:
 *   - contract multiplier   mult   = 100 × spot
 *   - gamma multiplier      gexMult = spot²
 *   - calls add, puts subtract for delta/vega; charm split call/put.
 *
 * Pure functions. No I/O.
 */

/**
 * Accumulate per-contract greeks into running exposure totals.
 * Ported verbatim (sign + multiplier conventions preserved), with VEX/CHEX
 * extended onto the same totals object.
 *
 * @param {object} args
 * @param {object} args.totals - mutated in place
 * @param {boolean} args.isCall
 * @param {number} args.gamma
 * @param {number} args.delta
 * @param {number} args.theta
 * @param {number} args.vega
 * @param {number} [args.vanna]
 * @param {number} [args.charm]
 * @param {number} args.contracts - OI or volume
 * @param {number} args.spot
 */
function accumulateExposureTotals({
  totals,
  isCall,
  gamma,
  delta,
  theta,
  vega,
  vanna = 0,
  charm = 0,
  contracts,
  spot,
}) {
  const mult = 100 * spot;
  const gexMult = spot * spot;

  if (isCall) {
    totals.totalGEX += Math.abs(gamma) * contracts * gexMult;
    totals.totalDeltaCall += Math.abs(delta) * contracts * mult;
    totals.totalCharmCall += -theta * contracts * mult;
    totals.totalVegaCall += vega * contracts * mult;
    totals.totalVEX += vanna * contracts * mult;
    totals.totalCHEX += charm * contracts * mult;
    return;
  }

  totals.totalGEX -= Math.abs(gamma) * contracts * gexMult;
  totals.totalDeltaPut -= Math.abs(delta) * contracts * mult;
  totals.totalCharmPut += theta * contracts * mult;
  totals.totalVegaPut -= vega * contracts * mult;
  totals.totalVEX -= vanna * contracts * mult;
  totals.totalCHEX -= charm * contracts * mult;
}

/** Fresh zeroed totals object. */
function emptyTotals() {
  return {
    totalGEX: 0,
    totalDeltaCall: 0,
    totalDeltaPut: 0,
    totalCharmCall: 0,
    totalCharmPut: 0,
    totalVegaCall: 0,
    totalVegaPut: 0,
    totalVEX: 0,
    totalCHEX: 0,
  };
}

/**
 * Per-strike VEX/CHEX used by the GEX calculator.
 *   VEX  = vanna × OI × spot × 100 (calls +, puts −)
 *   CHEX = charm × OI × spot × 100 (calls +, puts −)
 *
 * @param {object} args
 * @param {object|null} args.call - call row with { oi, vanna, charm }
 * @param {object|null} args.put  - put row with { oi, vanna, charm }
 * @param {number} args.spot
 * @returns {{vex:number, chex:number}}
 */
function computeVexChexRow({ call, put, spot }) {
  const mult = spot * 100;
  const callOI = Number(call?.oi ?? 0);
  const putOI = Number(put?.oi ?? 0);
  const callVanna = Number(call?.vanna ?? 0);
  const putVanna = Number(put?.vanna ?? 0);
  const callCharm = Number(call?.charm ?? 0);
  const putCharm = Number(put?.charm ?? 0);

  const vex = callVanna * callOI * mult - putVanna * putOI * mult;
  const chex = callCharm * callOI * mult - putCharm * putOI * mult;
  return { vex, chex };
}

/** Sum VEX / CHEX across already-computed GEX rows. */
function totalVexChex(gexRows) {
  let vex = 0;
  let chex = 0;
  for (const r of gexRows) {
    vex += r.vex ?? 0;
    chex += r.chex ?? 0;
  }
  return { totalVEX: vex, totalCHEX: chex };
}

module.exports = {
  accumulateExposureTotals,
  emptyTotals,
  computeVexChexRow,
  totalVexChex,
};
