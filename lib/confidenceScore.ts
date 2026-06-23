// Confidence scoring engine for MVC levels.
// Pure, dependency-free, server- and client-safe.
//
// Two-stage probability model for the CURRENT MVC level:
//   Stage 1 — HIT ("reach"): probability price gets to / interacts with the level
//             today. Stands alone (0-100).
//   Stage 2 — GIVEN a hit, exactly one of these happens, so they are CONDITIONAL
//             probabilities that PARTITION the outcome space and sum to 100%:
//               - pivot : the level rejects price (reversal / defended wall)
//               - chop  : range-bound / sticky action around the level
//               - break : price slices THROUGH the level (fails to hold)
//
// Raw structural scores blend(liveRulePrior, historicalAnalogRate) and absorb the
// rejection-rate / GEX-rank / regime adjustments; the three Stage-2 scores are
// then renormalized to sum to 100. When no historical analogs exist, weight
// collapses to the live prior so the page still works.

export interface LevelContext {
  /** The MVC price level we are scoring (SPX or ES points). */
  level: number;
  /** Current underlying price in the SAME units as `level`. */
  price: number;
  /** Estimated Move size (points, one side). Used to normalize proximity. */
  emSize: number;
  /** Realized intraday half-range (points). Preferred proximity scale — reflects
   *  how far price has actually traveled today, giving real strike-to-strike
   *  contrast instead of the (often floored) EM. Falls back to emSize if absent. */
  intradayRange?: number;
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
  /** Relative GEX rank of this level among today's MVC strikes: 1.0 = the day's
   *  dominant magnet, 0.8 = 2nd, 0.6 = 3rd… A normalized substitute for raw GEX
   *  size so a strong-but-not-top strike doesn't inflate pivot odds. Default 1. */
  gexRank?: number;
  /** Open-at-MVC special case: price OPENED at the MVC (first ~15 min, on the
   *  level). The study found an 84% pivot-and-close-the-gap rate in this setup, so
   *  when true we anchor pivot to that elevated rate. */
  openAtMVC?: boolean;
}

/**
 * Empirical MVC base rates: $SPX index, 0DTE only, valid for intraday IV ~16–45%.
 * Used as the PRIOR the live structural scores are anchored to (structure then
 * tilts around these), rather than building each score from a flat low base.
 *   - reach : MVC is met 75% of the time.
 *   - When met → pivot 55% / within-range(±$5) 26% (chop) / outside-range 17% (break).
 *   - openAtMVC: opens at MVC → 85% pivot + closes the overnight gap in first 15m.
 */
export const STUDY = {
  reach: 0.75,
  pivot: 0.55,
  chop: 0.26,
  break: 0.17,
  openAtMVCPivot: 0.85,
  ivLow: 16,
  ivHigh: 45,
} as const;

export interface HistoricalAnalogStats {
  /** Number of past analog levels found. 0 → no historical signal. */
  sampleSize: number;
  hitRate: number; // 0..1
  pivotRate: number; // 0..1 (conditional on being approached)
  chopRate: number; // 0..1
  /** Fraction of past same-cluster touches that REJECTED price (reversal/squeeze)
   *  rather than broke through. The "history of actual rejections" signal — a
   *  defended wall earns pivot confidence and sheds break confidence. 0..1. */
  rejectionRate?: number;
  /** Sessions since the cluster's last successful defense (for pivot time-decay).
   *  Larger → staler defense → less pivot credit. Optional. */
  sessionsSinceDefense?: number;
}

export interface ConfidenceResult {
  hit: number; // 0..100
  pivot: number; // 0..100
  chop: number; // 0..100
  break: number; // 0..100 — probability price breaks THROUGH the level (fails to hold)
  /** Net Wall Bias = pivot − break, range -100..100. Positive (large) = expect the
   *  wall to defend / hold; negative = respect the break. The single decision read. */
  netWallBias: number; // -100..100
  /** True when the open-at-MVC 84% setup is active (price opened on the level). */
  openAtMVC: boolean;
  /** Per-factor contributions for the live prior (for UI explainability). */
  factors: {
    proximity: number; // 0..1 (1 = on top of level)
    gexMagnitude: number; // 0..1 (1 = dominant gamma)
    gammaRegime: "positive" | "negative" | "flat";
    flipProximity: number; // 0..1 (1 = right at flip)
    dexBias: number; // -1..1 (sign = directional pull)
    timeWeight: number; // 0..1
    gexRank: number; // 0..1 (1 = today's dominant MVC strike)
    rejectionRate: number; // 0..1 (historical same-cluster rejection rate; 0 if none)
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
  break: number;
  factors: ConfidenceResult["factors"];
} {
  const distance = ctx.level - ctx.price;
  // Proximity scale: prefer the realized intraday half-range so distance is
  // measured against how far price actually moves today. This is what gives the
  // scores real strike-to-strike contrast (a strike 80 pts away no longer looks
  // as reachable as one 5 pts away). Fall back to EM when range is unavailable.
  const distScale =
    ctx.intradayRange != null && Number.isFinite(ctx.intradayRange) && ctx.intradayRange > 0
      ? ctx.intradayRange
      : ctx.emSize;
  const proximity = proximityFactor(distance, distScale);
  const gexMagnitude = gexMagnitudeFactor(ctx.netGexAtLevel, ctx.totalAbsNetGEX);
  const flipProximity = flipProximityFactor(ctx.price, ctx.gexFlip, distScale);

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

  // Relative GEX rank among today's MVC strikes (1 = dominant magnet). Used as a
  // normalized strength multiplier so only the day's top wall(s) earn the full
  // pivot/break structural credit — a strong-but-#3 strike is discounted.
  const gexRank = ctx.gexRank == null ? 1 : clamp01(ctx.gexRank);

  // ── HIT ────────────────────────────────────────────────────────────────
  // Low base (0.15) so the score is genuinely driven by proximity + magnet pull
  // rather than floored near 50. A far, low-gamma strike now scores low; a near,
  // dominant strike scores high — real contrast across the timeline.
  const dexTowardLevel = Math.sign(distance) === Math.sign(ctx.netDexAtLevel) ? Math.abs(dexBias) : 0;
  let hit =
    0.15 +
    0.45 * proximity +
    0.25 * gexMagnitude +
    0.10 * timeWeight +
    0.10 * dexTowardLevel;
  // Magnet effect of a dominant level is stronger early & on 0DTE/OPEX.
  if (ctx.isOpexOr0DTE) hit += 0.05 * gexMagnitude;
  hit = clamp(hit, 0, 0.95);

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
    0.35 * posGamma * gexMagnitude * gexRank +
    0.25 * proximity +
    0.20 * dexOpposes;
  // Crossing the flip near the peak raises volatility → less clean pivot.
  pivot -= 0.15 * flipProximity * (gammaRegime === "negative" ? 1 : 0);
  pivot = clamp(pivot, 0, 0.9);

  // ── BREAK ──────────────────────────────────────────────────────────────
  // Probability price slices THROUGH the level instead of holding. The mirror
  // of Pivot/Chop: high in NEGATIVE-gamma regime (dealers amplify moves) at a
  // dominant level with price extended toward it; DEX pushing toward the level
  // adds momentum. Near the flip in negative gamma raises breakthrough odds.
  const negGamma = gammaRegime === "negative" ? 1 : gammaRegime === "flat" ? 0.4 : 0;
  let brk =
    0.05 +
    0.40 * negGamma * gexMagnitude +
    0.25 * proximity * negGamma +
    0.20 * dexTowardLevel * negGamma +
    0.15 * flipProximity * negGamma;
  // Positive-gamma dominant peaks actively resist a clean break — and a top-ranked
  // wall resists harder than a minor one.
  brk -= 0.20 * posGamma * gexMagnitude * gexRank;
  brk = clamp(brk, 0, 0.9);

  return {
    hit,
    pivot,
    chop,
    break: brk,
    factors: { proximity, gexMagnitude, gammaRegime, flipProximity, dexBias, timeWeight, gexRank, rejectionRate: 0 },
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
  let brk = prior.break;
  let rejectionRate = 0;

  if (history && history.sampleSize > 0) {
    // Saturating weight: ~0.22 at n=5, ~0.39 at n=15, ~0.65 cap.
    historyWeight = clamp(0.65 * (history.sampleSize / (history.sampleSize + 10)), 0, 0.65);

    hit = (1 - historyWeight) * prior.hit + historyWeight * clamp01(history.hitRate);
    pivot = (1 - historyWeight) * prior.pivot + historyWeight * clamp01(history.pivotRate);
    chop = (1 - historyWeight) * prior.chop + historyWeight * clamp01(history.chopRate);
    notes.push(
      `Blended ${Math.round(historyWeight * 100)}% historical (${history.sampleSize} analog level${history.sampleSize === 1 ? "" : "s"}).`
    );

    // ── Rejection-rate adjustment ─────────────────────────────────────────
    // The "history of actual rejections beats raw size" rule. A wall that has
    // repeatedly defended earns pivot confidence and sheds break confidence.
    // Time-decay: a defense that's many sessions stale counts for less.
    if (history.rejectionRate != null && Number.isFinite(history.rejectionRate)) {
      rejectionRate = clamp01(history.rejectionRate);
      const stale = history.sessionsSinceDefense ?? 0;
      const decay = clamp01(1 - stale * 0.08); // -8%/session, floored at 0
      const boost = rejectionRate * decay;       // 0..1 effective defense strength
      // Confidence in the rate scales with sample size (same saturating shape).
      const conf = clamp(history.sampleSize / (history.sampleSize + 6), 0, 1);
      pivot = clamp(pivot + 0.30 * boost * conf, 0, 0.95);
      brk = clamp(brk - 0.25 * boost * conf, 0, 0.9);
      if (rejectionRate >= 0.6 && conf >= 0.4)
        notes.push(`Defended ${Math.round(rejectionRate * 100)}% of prior touches${stale > 0 ? ` (last ${stale} session${stale === 1 ? "" : "s"} ago)` : ""} → pivot-favored.`);
    }
  } else {
    notes.push("No historical analogs yet — live structural prior only.");
  }

  if (prior.factors.gexMagnitude >= 0.4) notes.push("Dominant gamma level (strong magnet).");
  if (prior.factors.gammaRegime === "positive") notes.push("Positive-gamma regime → dealers dampen moves (chop-prone).");
  if (prior.factors.gammaRegime === "negative") notes.push("Negative-gamma regime → moves accelerate (breakthrough-prone).");
  if (ctx.isOpexOr0DTE) notes.push("0DTE/OPEX → pinning & chop amplified.");

  if (prior.factors.gammaRegime === "negative" && prior.factors.gexMagnitude >= 0.4 && prior.break >= 0.5)
    notes.push("Breakthrough-prone: dominant level in negative gamma.");
  if (ctx.gexRank != null && ctx.gexRank < 0.8)
    notes.push(`Secondary magnet (GEX rank ${Math.round(clamp01(ctx.gexRank) * 100)}%) → structural credit discounted.`);

  // ── Study base-rate anchoring ─────────────────────────────────────────────
  // Pull each structural score toward the empirical MVC base rate (reach 75% /
  // pivot 55% / chop 26% / break 17%). The live structure
  // (gamma/proximity/DEX + rejection history) then TILTS around that anchor rather
  // than driving from a flat low base. ANCHOR = how much the study prior pulls.
  const ANCHOR = 0.5; // 50% study base rate, 50% live structure
  hit = ANCHOR * STUDY.reach + (1 - ANCHOR) * hit;
  pivot = ANCHOR * STUDY.pivot + (1 - ANCHOR) * pivot;
  chop = ANCHOR * STUDY.chop + (1 - ANCHOR) * chop;
  brk = ANCHOR * STUDY.break + (1 - ANCHOR) * brk;
  notes.push(`Anchored to MVC study base rates (reach ${Math.round(STUDY.reach * 100)}% · pivot ${Math.round(STUDY.pivot * 100)}% / chop ${Math.round(STUDY.chop * 100)}% / break ${Math.round(STUDY.break * 100)}%).`);

  // Special case: price OPENED at the MVC → study's 84% pivot-and-close-the-gap.
  // Pull pivot hard toward 0.84 and reach toward certainty (it's already there).
  if (ctx.openAtMVC) {
    pivot = 0.7 * STUDY.openAtMVCPivot + 0.3 * pivot;
    hit = Math.max(hit, 0.9);
    notes.push(`Opened AT the MVC → ${Math.round(STUDY.openAtMVCPivot * 100)}% setup: expect a pivot + overnight-gap close in the first 15 min.`);
  }

  // ── Two-stage probability model ───────────────────────────────────────────
  // Stage 1: HIT = "reach" — does price get to the level at all? Stands alone.
  // Stage 2: GIVEN a hit, exactly one of {pivot, chop, break} happens, so they
  // are CONDITIONAL probabilities that must partition the outcome space → sum to
  // 100%. We renormalize the three raw structural scores (which already carry the
  // rejection-rate / rank / regime adjustments) into a true conditional split.
  const hitPct = Math.round(hit * 100);
  const condSum = pivot + chop + brk;
  let pivotPct: number, chopPct: number, brkPct: number;
  if (condSum > 0) {
    pivotPct = Math.round((pivot / condSum) * 100);
    brkPct = Math.round((brk / condSum) * 100);
    chopPct = Math.max(0, 100 - pivotPct - brkPct); // remainder absorbs rounding → exact 100
  } else {
    // Degenerate (all three zero) → split evenly so the bar still renders.
    pivotPct = 33; chopPct = 34; brkPct = 33;
  }
  // Net Wall Bias now compares the two DECISIVE on-touch outcomes: a defended
  // pivot vs a clean break (chop is the indecisive middle). −100..100.
  const netWallBias = pivotPct - brkPct;
  if (netWallBias >= 25) notes.push(`Net Wall Bias +${netWallBias} → lean defense / continuation if it holds.`);
  else if (netWallBias <= -25) notes.push(`Net Wall Bias ${netWallBias} → respect the break; don't fight it.`);
  else notes.push(`Net Wall Bias ${netWallBias >= 0 ? "+" : ""}${netWallBias} → neutral; smaller size until a clear reaction.`);

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
    notes,
  };
}
