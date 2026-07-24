var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../mnt/user-data/uploads/spx-gex-dashboard-tt-fixed/lib/confidenceScore.ts
var confidenceScore_exports = {};
__export(confidenceScore_exports, {
  STUDY: () => STUDY,
  flipProximityFactor: () => flipProximityFactor,
  gexMagnitudeFactor: () => gexMagnitudeFactor,
  liveRulePrior: () => liveRulePrior,
  proximityFactor: () => proximityFactor,
  scoreConfidence: () => scoreConfidence
});
module.exports = __toCommonJS(confidenceScore_exports);
var STUDY = {
  reach: 0.75,
  pivot: 0.55,
  chop: 0.26,
  break: 0.17,
  openAtMVCPivot: 0.85,
  ivLow: 16,
  ivHigh: 45
};
var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
var clamp01 = (v) => clamp(v, 0, 1);
function proximityFactor(distance, emSize) {
  if (!Number.isFinite(distance) || !Number.isFinite(emSize) || emSize <= 0) return 0;
  return clamp01(1 - Math.abs(distance) / emSize);
}
function gexMagnitudeFactor(netGexAtLevel, totalAbsNetGEX) {
  if (!Number.isFinite(totalAbsNetGEX) || totalAbsNetGEX <= 0) return 0;
  return clamp01(Math.abs(netGexAtLevel) / totalAbsNetGEX);
}
function flipProximityFactor(price, gexFlip, emSize) {
  if (gexFlip == null || !Number.isFinite(gexFlip) || emSize <= 0) return 0;
  return clamp01(1 - Math.abs(price - gexFlip) / emSize);
}
function liveRulePrior(ctx) {
  const distance = ctx.level - ctx.price;
  const distScale = ctx.intradayRange != null && Number.isFinite(ctx.intradayRange) && ctx.intradayRange > 0 ? ctx.intradayRange : ctx.emSize;
  const proximity = proximityFactor(distance, distScale);
  const gexMagnitude = gexMagnitudeFactor(ctx.netGexAtLevel, ctx.totalAbsNetGEX);
  const flipProximity = flipProximityFactor(ctx.price, ctx.gexFlip, distScale);
  const gammaRegime = ctx.netGexAtLevel > 0 ? "positive" : ctx.netGexAtLevel < 0 ? "negative" : "flat";
  const dexBias = ctx.totalAbsNetGEX > 0 ? clamp(ctx.netDexAtLevel / ctx.totalAbsNetGEX, -1, 1) : 0;
  const sp = ctx.sessionProgress == null ? 0.5 : clamp01(ctx.sessionProgress);
  const timeWeight = clamp01(1 - sp * 0.6);
  const gexRank = ctx.gexRank == null ? 1 : clamp01(ctx.gexRank);
  const dexTowardLevel = Math.sign(distance) === Math.sign(ctx.netDexAtLevel) ? Math.abs(dexBias) : 0;
  let hit = 0.15 + 0.45 * proximity + 0.25 * gexMagnitude + 0.1 * timeWeight + 0.1 * dexTowardLevel;
  if (ctx.isOpexOr0DTE) hit += 0.05 * gexMagnitude;
  hit = clamp(hit, 0, 0.95);
  const posGamma = gammaRegime === "positive" ? 1 : gammaRegime === "flat" ? 0.4 : 0;
  let chop = 0.15 + 0.45 * posGamma * gexMagnitude + 0.25 * proximity * posGamma;
  if (ctx.isOpexOr0DTE) chop += 0.1 * posGamma;
  chop = clamp(chop, 0, 0.9);
  const dexOpposes = Math.sign(distance) !== Math.sign(ctx.netDexAtLevel) ? Math.abs(dexBias) : 0;
  let pivot = 0.1 + 0.35 * posGamma * gexMagnitude * gexRank + 0.25 * proximity + 0.2 * dexOpposes;
  pivot -= 0.15 * flipProximity * (gammaRegime === "negative" ? 1 : 0);
  pivot = clamp(pivot, 0, 0.9);
  const negGamma = gammaRegime === "negative" ? 1 : gammaRegime === "flat" ? 0.4 : 0;
  let brk = 0.05 + 0.4 * negGamma * gexMagnitude + 0.25 * proximity * negGamma + 0.2 * dexTowardLevel * negGamma + 0.15 * flipProximity * negGamma;
  brk -= 0.2 * posGamma * gexMagnitude * gexRank;
  brk = clamp(brk, 0, 0.9);
  return {
    hit,
    pivot,
    chop,
    break: brk,
    factors: { proximity, gexMagnitude, gammaRegime, flipProximity, dexBias, timeWeight, gexRank, rejectionRate: 0 }
  };
}
function scoreConfidence(ctx, history) {
  const prior = liveRulePrior(ctx);
  const notes = [];
  let historyWeight = 0;
  let hit = prior.hit;
  let pivot = prior.pivot;
  let chop = prior.chop;
  let brk = prior.break;
  let rejectionRate = 0;
  if (history && history.sampleSize > 0) {
    historyWeight = clamp(0.65 * (history.sampleSize / (history.sampleSize + 10)), 0, 0.65);
    hit = (1 - historyWeight) * prior.hit + historyWeight * clamp01(history.hitRate);
    pivot = (1 - historyWeight) * prior.pivot + historyWeight * clamp01(history.pivotRate);
    chop = (1 - historyWeight) * prior.chop + historyWeight * clamp01(history.chopRate);
    notes.push(
      `Blended ${Math.round(historyWeight * 100)}% historical (${history.sampleSize} analog level${history.sampleSize === 1 ? "" : "s"}).`
    );
    if (history.rejectionRate != null && Number.isFinite(history.rejectionRate)) {
      rejectionRate = clamp01(history.rejectionRate);
      const stale = history.sessionsSinceDefense ?? 0;
      const decay = clamp01(1 - stale * 0.08);
      const boost = rejectionRate * decay;
      const conf = clamp(history.sampleSize / (history.sampleSize + 6), 0, 1);
      pivot = clamp(pivot + 0.3 * boost * conf, 0, 0.95);
      brk = clamp(brk - 0.25 * boost * conf, 0, 0.9);
      if (rejectionRate >= 0.6 && conf >= 0.4)
        notes.push(`Defended ${Math.round(rejectionRate * 100)}% of prior touches${stale > 0 ? ` (last ${stale} session${stale === 1 ? "" : "s"} ago)` : ""} \u2192 pivot-favored.`);
    }
  } else {
    notes.push("No historical analogs yet \u2014 live structural prior only.");
  }
  if (prior.factors.gexMagnitude >= 0.4) notes.push("Dominant gamma level (strong magnet).");
  if (prior.factors.gammaRegime === "positive") notes.push("Positive-gamma regime \u2192 dealers dampen moves (chop-prone).");
  if (prior.factors.gammaRegime === "negative") notes.push("Negative-gamma regime \u2192 moves accelerate (breakthrough-prone).");
  if (ctx.isOpexOr0DTE) notes.push("0DTE/OPEX \u2192 pinning & chop amplified.");
  if (prior.factors.gammaRegime === "negative" && prior.factors.gexMagnitude >= 0.4 && prior.break >= 0.5)
    notes.push("Breakthrough-prone: dominant level in negative gamma.");
  if (ctx.gexRank != null && ctx.gexRank < 0.8)
    notes.push(`Secondary magnet (GEX rank ${Math.round(clamp01(ctx.gexRank) * 100)}%) \u2192 structural credit discounted.`);
  const ANCHOR = 0.5;
  hit = ANCHOR * STUDY.reach + (1 - ANCHOR) * hit;
  pivot = ANCHOR * STUDY.pivot + (1 - ANCHOR) * pivot;
  chop = ANCHOR * STUDY.chop + (1 - ANCHOR) * chop;
  brk = ANCHOR * STUDY.break + (1 - ANCHOR) * brk;
  notes.push(`Anchored to MVC study base rates (reach ${Math.round(STUDY.reach * 100)}% \xB7 pivot ${Math.round(STUDY.pivot * 100)}% / chop ${Math.round(STUDY.chop * 100)}% / break ${Math.round(STUDY.break * 100)}%).`);
  if (ctx.openAtMVC) {
    pivot = 0.7 * STUDY.openAtMVCPivot + 0.3 * pivot;
    hit = Math.max(hit, 0.9);
    notes.push(`Opened AT the MVC \u2192 ${Math.round(STUDY.openAtMVCPivot * 100)}% setup: expect a pivot + overnight-gap close in the first 15 min.`);
  }
  const hitPct = Math.round(hit * 100);
  const condSum = pivot + chop + brk;
  let pivotPct, chopPct, brkPct;
  if (condSum > 0) {
    pivotPct = Math.round(pivot / condSum * 100);
    brkPct = Math.round(brk / condSum * 100);
    chopPct = Math.max(0, 100 - pivotPct - brkPct);
  } else {
    pivotPct = 33;
    chopPct = 34;
    brkPct = 33;
  }
  const netWallBias = pivotPct - brkPct;
  if (netWallBias >= 25) notes.push(`Net Wall Bias +${netWallBias} \u2192 lean defense / continuation if it holds.`);
  else if (netWallBias <= -25) notes.push(`Net Wall Bias ${netWallBias} \u2192 respect the break; don't fight it.`);
  else notes.push(`Net Wall Bias ${netWallBias >= 0 ? "+" : ""}${netWallBias} \u2192 neutral; smaller size until a clear reaction.`);
  return {
    hit: hitPct,
    pivot: pivotPct,
    chop: chopPct,
    break: brkPct,
    netWallBias,
    openAtMVC: ctx.openAtMVC ?? false,
    factors: { ...prior.factors, rejectionRate },
    historyWeight,
    sampleSize: history?.sampleSize ?? 0,
    notes
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  STUDY,
  flipProximityFactor,
  gexMagnitudeFactor,
  liveRulePrior,
  proximityFactor,
  scoreConfidence
});
