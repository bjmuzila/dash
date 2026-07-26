function accumulateExposureTotals({
  totals,
  isCall,
  gamma,
  delta,
  theta,
  vega,
  contracts,
  spot
}) {
  const mult = 100 * spot;
  const gexMult = spot * spot;

  if (isCall) {
    totals.totalGEX += Math.abs(gamma) * contracts * gexMult;
    totals.totalDeltaCall += Math.abs(delta) * contracts * mult;
    totals.totalCharmCall += (-theta) * contracts * mult;
    totals.totalVegaCall += vega * contracts * mult;
    return;
  }

  totals.totalGEX -= Math.abs(gamma) * contracts * gexMult;
  totals.totalDeltaPut -= Math.abs(delta) * contracts * mult;
  totals.totalCharmPut += theta * contracts * mult;
  totals.totalVegaPut -= vega * contracts * mult;
}

module.exports = {
  accumulateExposureTotals
};
