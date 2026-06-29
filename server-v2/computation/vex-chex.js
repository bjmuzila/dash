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
 * @param {number} args.contracts - OI (drives totalGEX and the OI-weighted greeks)
 * @param {number} [args.volContracts] - OI + volume; drives the parallel
 *   totalGEXOiVol total (heatmap / mult-greek basis). Defaults to `contracts`
 *   (OI only) when not supplied, so existing callers are unchanged.
 * @param {number} [args.volOnly] - volume only; drives totalGEXVol (Vol-only
 *   basis). Defaults to 0 when not supplied.
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
  volContracts,
  volOnly = 0,
  spot,
}) {
  const mult = 100 * spot;
  const gexMult = spot * spot;
  const oiVol = volContracts == null ? contracts : volContracts;

  if (isCall) {
    totals.totalGEX += Math.abs(gamma) * contracts * gexMult;
    totals.totalGEXOiVol += Math.abs(gamma) * oiVol * gexMult;
    totals.totalGEXVol += Math.abs(gamma) * volOnly * gexMult;
    // Delta (calls add). Three bases: OI (legacy call/put split), OI+Vol, Vol-only.
    totals.totalDeltaCall += Math.abs(delta) * contracts * mult;
    totals.totalDeltaOiVol += Math.abs(delta) * oiVol * mult;
    totals.totalDeltaVol += Math.abs(delta) * volOnly * mult;
    // Charm (CHEX): calls add. Note totalCharmCall keeps the legacy -theta basis;
    // totalCHEX* are the true charm-exposure totals matching per-strike chex.
    totals.totalCharmCall += -theta * contracts * mult;
    totals.totalCHEX += charm * contracts * mult;
    totals.totalCHEXOiVol += charm * oiVol * mult;
    totals.totalCHEXVol += charm * volOnly * mult;
    // Vega: calls add.
    totals.totalVegaCall += vega * contracts * mult;
    totals.totalVegaOiVol += vega * oiVol * mult;
    totals.totalVegaVol += vega * volOnly * mult;
    // Vanna (VEX): calls add.
    totals.totalVEX += vanna * contracts * mult;
    totals.totalVEXOiVol += vanna * oiVol * mult;
    totals.totalVEXVol += vanna * volOnly * mult;
    return;
  }

  totals.totalGEX -= Math.abs(gamma) * contracts * gexMult;
  totals.totalGEXOiVol -= Math.abs(gamma) * oiVol * gexMult;
  totals.totalGEXVol -= Math.abs(gamma) * volOnly * gexMult;
  // Delta (puts subtract).
  totals.totalDeltaPut -= Math.abs(delta) * contracts * mult;
  totals.totalDeltaOiVol -= Math.abs(delta) * oiVol * mult;
  totals.totalDeltaVol -= Math.abs(delta) * volOnly * mult;
  // Charm (CHEX): puts subtract (matches per-strike chex sign).
  totals.totalCharmPut += theta * contracts * mult;
  totals.totalCHEX -= charm * contracts * mult;
  totals.totalCHEXOiVol -= charm * oiVol * mult;
  totals.totalCHEXVol -= charm * volOnly * mult;
  // Vega: puts subtract.
  totals.totalVegaPut -= vega * contracts * mult;
  totals.totalVegaOiVol -= vega * oiVol * mult;
  totals.totalVegaVol -= vega * volOnly * mult;
  // Vanna (VEX): puts subtract.
  totals.totalVEX -= vanna * contracts * mult;
  totals.totalVEXOiVol -= vanna * oiVol * mult;
  totals.totalVEXVol -= vanna * volOnly * mult;
}

/** Fresh zeroed totals object. */
function emptyTotals() {
  return {
    totalGEX: 0,
    totalGEXOiVol: 0,
    totalGEXVol: 0,
    // Delta (DEX): OI split + OI+Vol + Vol-only
    totalDeltaCall: 0,
    totalDeltaPut: 0,
    totalDeltaOiVol: 0,
    totalDeltaVol: 0,
    // Charm legacy split (theta-based) kept for back-compat
    totalCharmCall: 0,
    totalCharmPut: 0,
    // Vega: OI split + OI+Vol + Vol-only
    totalVegaCall: 0,
    totalVegaPut: 0,
    totalVegaOiVol: 0,
    totalVegaVol: 0,
    // Vanna (VEX): OI net + OI+Vol + Vol-only
    totalVEX: 0,
    totalVEXOiVol: 0,
    totalVEXVol: 0,
    // Charm (CHEX): OI net + OI+Vol + Vol-only
    totalCHEX: 0,
    totalCHEXOiVol: 0,
    totalCHEXVol: 0,
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
  const callVol = Number(call?.volume ?? 0);
  const putVol = Number(put?.volume ?? 0);
  const callVanna = Number(call?.vanna ?? 0);
  const putVanna = Number(put?.vanna ?? 0);
  const callCharm = Number(call?.charm ?? 0);
  const putCharm = Number(put?.charm ?? 0);

  // Vanna exposure (OI-weighted) — dashboard field name: netVanna
  const netVanna = callVanna * callOI * mult - putVanna * putOI * mult;
  // Vanna exposure (volume-weighted) — dashboard field name: netVolVanna
  const netVolVanna = callVanna * callVol * mult - putVanna * putVol * mult;
  // Charm exposure (OI-weighted)
  const chex = callCharm * callOI * mult - putCharm * putOI * mult;
  // Charm exposure (volume-weighted) — Vol twin of chex
  const volChex = callCharm * callVol * mult - putCharm * putVol * mult;
  return { netVanna, netVolVanna, chex, volChex, vex: netVanna };
}

/** Sum VEX / CHEX across already-computed GEX rows. */
function totalVexChex(gexRows) {
  let vex = 0;
  let volVex = 0;
  let chex = 0;
  let volChex = 0;
  for (const r of gexRows) {
    vex += r.vex ?? r.netVanna ?? 0;
    volVex += r.netVolVanna ?? 0;
    chex += r.chex ?? 0;
    volChex += r.volChex ?? 0;
  }
  return { totalVEX: vex, totalVEXVol: volVex, totalCHEX: chex, totalCHEXVol: volChex };
}

module.exports = {
  accumulateExposureTotals,
  emptyTotals,
  computeVexChexRow,
  totalVexChex,
};
