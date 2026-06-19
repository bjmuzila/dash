// Confidence scoring engine for MVC levels.
// Pure, dependency-free, server- and client-safe.
//
// Produces three 0-100 scores for the CURRENT MVC level:
//   - hit    : probability ES reaches / interacts with the level today
//   - pivot  : probability the level acts as a reversal once approached
//   - chop   : probability of range-bound / sticky action around the level
//
// Each score = blend(liveRulePrior, historicalAnalogRate). When no historical
// analogs exist, weight collapses to the live prior so the page still works.

export interface LevelContext {
  /** The MVC price level we are scoring (SPX or ES points). */
  level: number;
  /** Current underlying price in the SAME units as `level`. */
  price: number;
  /** Estimated Move size (points, one side). Used to normalize proximity. */
  emSize: number;
  /** Total net GEX magnitude for the day (any units; only relative scale used). */
  totalAbsNetGEX: number;
  /** Signed net GEX at/around the level (positive = dealers long gamma). */
  netGexAtLevel: number;
  /** Signed net DEX at/around the level. */
  netDexAtLevel: number;
  /** Gamma flip price level (null if unknown). */
  gexFlip: number | null;
  /** 0DTE / OPEX day → stronger pinning & chop. */
  isOpexOr0DTE?: boolean;
  /** Fraction of the RTH session elapsed, 0..1 (earlier = stronger magnet). */
  sessionProgress?: number;
}

export interface HistoricalAnalogStats {
  /** Number of past analog levels found. 0 → no historical signal. */
  sampleSize: number;
  hitRate: number; // 0..1
  pivotRate: number; // 0..1 (conditional on being approached)
  chopRate: number; // 0..1
}

export interface ConfidenceResult {
  hit: number; // 0..100
  pivot: number; // 0..100
  chop: number; // 0..100
  /** Per-factor contributions for the live prior (for UI explainability). */
  factors: {
    proximity: number; // 0..1 (1 = on top of level)
    gexMagnitude: number; // 0..1 (1 = dominant gamma)
    gammaRegime: "positive" | "negative" | "flat";
    flipProximity: number; // 0..1 (1 = right at flip)
    dexBias: number; // -1..1 (sign = directional pull)
    timeWeight: number; // 0..1
  };
  /** How much of each score came from historical data, 0..1. */
  historyWeight: number;
  sampleSize: number;
  notes: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

/** Proximity factor: 1 when on the level, decaying to 0 at ~1 EM away. */
export function proximityFactor(distance: number, emSize: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(emSize) || emSize <= 0) return 0;
  return clamp01(1 - Math.abs(distance) / emSize);
}

/**
 * GEX magnitude factor: how dominant is the gamma at this level relative to the
 * day's total absolute GEX. 1 = this level holds essentially all the gamma.
 */
export function gexMagnitudeFactor(netGexAtLevel: number, totalAbsNetGEX: number): number {
  if (!Number.isFinite(totalAbsNetGEX) || totalAbsNetGEX <= 0) return 0;
  return clamp01(Math.abs(netGexAtLevel) / totalAbsNetGEX);
}

/** Flip proximity: 1 when price/level sits right on the gamma flip. */
export function flipProximityFactor(price: number, gexFlip: number | null, emSize: number): number {
  if (gexFlip == null || !Number.isFinite(gexFlip) || emSize <= 0) return 0;
  return clamp01(1 - Math.abs(price - gexFlip) / emSize);
}

/**
 * Live rule-based prior (the formula from the trading notes), returned as
 * 0..1 rates so it blends cleanly with historical rates.
 */
export function liveRulePrior(ctx: LevelContext): {
  hit: number;
  pivot: number;
  chop: number;
  factors: ConfidenceResult["factors"];
} {
  const distance = ctx.level - ctx.price;
  const proximity = proximityFactor(distance, ctx.emSize);
  const gexMagnitude = gexMagnitudeFactor(ctx.netGexAtLevel, ctx.totalAbsNetGEX);
  const flipProximity = flipProximityFactor(ctx.price, ctx.gexFlip, ctx.emSize);

  const gammaRegime: "positive" | "negative" | "flat" =
    ctx.netGexAtLevel > 0 ? "positive" : ctx.netGexAtLevel < 0 ? "negative" : "flat";

  // DEX bias: signed directional pull, normalized against total gamma scale.
  const dexBias =
    ctx.totalAbsNetGEX > 0
      ? clamp(ctx.netDexAtLevel / ctx.totalAbsNetGEX, -1, 1)
      : 0;

  // Earlier in the session a strong level acts more like a magnet.
  const sp = ctx.sessionProgress == null ? 0.5 : clamp01(ctx.sessionProgress);
  const timeWeight = clamp01(1 - sp * 0.6); // 1.0 at open → 0.4 at close

  // ── HIT ────────────────────────────────────────────────────────────────
  // Base 50% (random within EM), + proximity, + magnitude (magnet pull),
  // + time, small DEX-alignment bump when DEX points toward the level.
  const dexTowardLevel = Math.sign(distance) === Math.sign(ctx.netDexAtLevel) ? Math.abs(dexBias) : 0;
  let hit =
    0.5 +
    0.30 * proximity +
    0.20 * gexMagnitude +
    0.10 * timeWeight +
    0.10 * dexTowardLevel;
  // Magnet effect of a dominant level is stronger early & on 0DTE/OPEX.
  if (ctx.isOpexOr0DTE) hit += 0.05 * gexMagnitude;
  hit = clamp(hit, 0, 0.9); // nothing is certain

  // ── CHOP ───────────────────────────────────────────────────────────────
  // High in positive-gamma regime near a dominant peak (dealers dampen moves),
  // amplified on 0DTE/OPEX. Low in negative-gamma regime.
  const posGamma = gammaRegime === "positive" ? 1 : gammaRegime === "flat" ? 0.4 : 0;
  let chop = 0.15 + 0.45 * posGamma * gexMagnitude + 0.25 * proximity * posGamma;
  if (ctx.isOpexOr0DTE) chop += 0.10 * posGamma;
  chop = clamp(chop, 0, 0.9);

  // ── PIVOT ──────────────────────────────────────────────────────────────
  // High when a strong positive-gamma peak acts as resistance/support AND
  // price is extended toward it (proximity high) with DEX opposing the move.
  const dexOpposes = Math.sign(distance) !== Math.sign(ctx.netDexAtLevel) ? Math.abs(dexBias) : 0;
  let pivot =
    0.10 +
    0.35 * posGamma * gexMagnitude +
    0.25 * proximity +
    0.20 * dexOpposes;
  // Crossing the flip near the peak raises volatility → less clean pivot.
  pivot -= 0.15 * flipProximity * (gammaRegime === "negative" ? 1 : 0);
  pivot = clamp(pivot, 0, 0.9);

  return {
    hit,
    pivot,
    chop,
    factors: { proximity, gexMagnitude, gammaRegime, flipProximity, dexBias, timeWeight },
  };
}

/**
 * Blend the live prior with historical analog rates. The more analogs we have,
 * the more weight history gets (capped at 0.65 so live structure always counts).
 */
export function scoreConfidence(
  ctx: LevelContext,
  history?: HistoricalAnalogStats | null
): ConfidenceResult {
  const prior = liveRulePrior(ctx);
  const notes: string[] = [];

  let historyWeight = 0;
  let hit = prior.hit;
  let pivot = prior.pivot;
  let chop = prior.chop;

  if (history && history.sampleSize > 0) {
    // Saturating weight: ~0.22 at n=5, ~0.39 at n=15, ~0.65 cap.
    historyWeight = clamp(0.65 * (history.sampleSize / (history.sampleSize + 10)), 0, 0.65);

    hit = (1 - historyWeight) * prior.hit + historyWeight * clamp01(history.hitRate);
    pivot = (1 - historyWeight) * prior.pivot + historyWeight * clamp01(history.pivotRate);
    chop = (1 - historyWeight) * prior.chop + historyWeight * clamp01(history.chopRate);
    notes.push(
      `Blended ${Math.round(historyWeight * 100)}% historical (${history.sampleSize} analog level${history.sampleSize === 1 ? "" : "s"}).`
    );
  } else {
    notes.push("No historical analogs yet — live structural prior only.");
  }

  if (prior.factors.gexMagnitude >= 0.4) notes.push("Dominant gamma level (strong magnet).");
  if (prior.factors.gammaRegime === "positive") notes.push("Positive-gamma regime → dealers dampen moves (chop-prone).");
  if (prior.factors.gammaRegime === "negative") notes.push("Negative-gamma regime → moves accelerate (breakthrough-prone).");
  if (ctx.isOpexOr0DTE) notes.push("0DTE/OPEX → pinning & chop amplified.");

  return {
    hit: Math.round(hit * 100),
    pivot: Math.round(pivot * 100),
    chop: Math.round(chop * 100),
    factors: prior.factors,
    historyWeight,
    sampleSize: history?.sampleSize ?? 0,
    notes,
  };
}
