/**
 * regimeHmm.ts — compact 3-state Gaussian Hidden Markov Model for regime
 * detection (Trend / Chop / Panic), fit client-side via Baum-Welch EM on a
 * sequence of log returns.
 *
 * Used by the "Regime Engine" test-lab tab (app/test/page.tsx) to decode a
 * live hidden-state probability for ESU/NQU from 5m candles (useEsCandles /
 * useNqCandles). Pure math, no framework deps — safe to unit-test standalone.
 *
 * Algorithm: standard scaled forward-backward + Baum-Welch re-estimation for
 * a Gaussian-emission HMM. States are unordered coming out of the fit, so
 * after convergence we label them by their emission stats:
 *   - Panic = highest volatility (std) state
 *   - Trend = highest |mean|/std ("Sharpe-like") among the remaining two
 *   - Chop  = whatever's left
 */

export type RegimeLabel = "Trend" | "Chop" | "Panic";
export const REGIME_LABELS: RegimeLabel[] = ["Trend", "Chop", "Panic"];

export interface HmmResult {
  /** raw-state-index -> label, e.g. labels[2] === "Panic" */
  labels: RegimeLabel[];
  stateIndexByLabel: Record<RegimeLabel, number>;
  /** 3x3, label-ordered [Trend,Chop,Panic] both axes. transition[i][j] = P(next=j | cur=i) */
  transition: number[][];
  /** stationary distribution, label-ordered */
  stationary: number[];
  /** per-bar posterior state probabilities, label-ordered, one row per input return */
  gammaByLabel: { Trend: number; Chop: number; Panic: number }[];
  /** argmax decoded label per bar (same length/alignment as gammaByLabel) */
  decodedPath: RegimeLabel[];
  /** last bar's posterior, convenience accessor */
  currentProbs: { Trend: number; Chop: number; Panic: number };
  currentLabel: RegimeLabel;
  means: number[]; // raw-state-indexed
  stds: number[]; // raw-state-indexed
  logLik: number;
  iterations: number;
}

function gaussPdf(x: number, mu: number, sigma: number): number {
  const s = Math.max(sigma, 1e-8);
  const z = (x - mu) / s;
  return Math.exp(-0.5 * z * z) / (s * Math.sqrt(2 * Math.PI));
}

/**
 * Fit a K-state Gaussian HMM to a 1D observation sequence via Baum-Welch EM.
 * Returns null if there isn't enough data to fit meaningfully.
 */
export function fitGaussianHmm(
  returns: number[],
  opts?: { states?: number; iters?: number }
): HmmResult | null {
  const K = opts?.states ?? 3;
  const iters = opts?.iters ?? 25;
  const T = returns.length;
  if (T < K * 20) return null;

  // ---- init: quantile-seeded means, global std, uniform transitions ----
  const sorted = [...returns].sort((a, b) => a - b);
  const globalMean = returns.reduce((a, b) => a + b, 0) / T;
  const globalVar = returns.reduce((a, b) => a + (b - globalMean) ** 2, 0) / T;
  const std0 = Math.sqrt(globalVar) || 1e-6;

  let means = Array.from({ length: K }, (_, k) => sorted[Math.min(T - 1, Math.floor(((k + 0.5) / K) * T))]);
  let stds = new Array(K).fill(std0);
  let A: number[][] = Array.from({ length: K }, () => new Array(K).fill(1 / K));
  let pi0 = new Array(K).fill(1 / K);

  let gamma: number[][] = [];
  let logLik = -Infinity;
  let ranIters = 0;

  for (let it = 0; it < iters; it++) {
    ranIters = it + 1;
    // emission likelihoods B[t][k]
    const B: number[][] = new Array(T);
    for (let t = 0; t < T; t++) {
      const row = new Array(K);
      for (let k = 0; k < K; k++) row[k] = gaussPdf(returns[t], means[k], stds[k]) + 1e-12;
      B[t] = row;
    }

    // scaled forward
    const alpha: number[][] = new Array(T);
    const c: number[] = new Array(T);
    alpha[0] = new Array(K);
    let s0 = 0;
    for (let k = 0; k < K; k++) {
      alpha[0][k] = pi0[k] * B[0][k];
      s0 += alpha[0][k];
    }
    c[0] = s0 > 0 ? 1 / s0 : 1;
    for (let k = 0; k < K; k++) alpha[0][k] *= c[0];
    for (let t = 1; t < T; t++) {
      alpha[t] = new Array(K).fill(0);
      for (let j = 0; j < K; j++) {
        let sum = 0;
        for (let i = 0; i < K; i++) sum += alpha[t - 1][i] * A[i][j];
        alpha[t][j] = sum * B[t][j];
      }
      let s = 0;
      for (let k = 0; k < K; k++) s += alpha[t][k];
      c[t] = s > 0 ? 1 / s : 1;
      for (let k = 0; k < K; k++) alpha[t][k] *= c[t];
    }

    // scaled backward (same scale factors)
    const beta: number[][] = new Array(T);
    beta[T - 1] = new Array(K).fill(c[T - 1]);
    for (let t = T - 2; t >= 0; t--) {
      beta[t] = new Array(K).fill(0);
      for (let i = 0; i < K; i++) {
        let sum = 0;
        for (let j = 0; j < K; j++) sum += A[i][j] * B[t + 1][j] * beta[t + 1][j];
        beta[t][i] = sum * c[t];
      }
    }

    // gamma (posterior state probs)
    gamma = new Array(T);
    for (let t = 0; t < T; t++) {
      const row = new Array(K);
      let s = 0;
      for (let k = 0; k < K; k++) {
        row[k] = alpha[t][k] * beta[t][k];
        s += row[k];
      }
      for (let k = 0; k < K; k++) row[k] = s > 0 ? row[k] / s : 1 / K;
      gamma[t] = row;
    }

    // xi accumulated over t (transition re-estimation)
    const xiSum: number[][] = Array.from({ length: K }, () => new Array(K).fill(0));
    for (let t = 0; t < T - 1; t++) {
      let denom = 0;
      const num: number[][] = Array.from({ length: K }, () => new Array(K).fill(0));
      for (let i = 0; i < K; i++) {
        for (let j = 0; j < K; j++) {
          const v = alpha[t][i] * A[i][j] * B[t + 1][j] * beta[t + 1][j];
          num[i][j] = v;
          denom += v;
        }
      }
      if (denom > 0) {
        for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) xiSum[i][j] += num[i][j] / denom;
      }
    }

    // M-step
    pi0 = gamma[0].slice();
    const newA: number[][] = Array.from({ length: K }, () => new Array(K).fill(0));
    for (let i = 0; i < K; i++) {
      let gSum = 0;
      for (let t = 0; t < T - 1; t++) gSum += gamma[t][i];
      for (let j = 0; j < K; j++) newA[i][j] = gSum > 0 ? xiSum[i][j] / gSum : 1 / K;
    }
    A = newA;

    const newMeans = new Array(K).fill(0);
    const newStds = new Array(K).fill(0);
    for (let k = 0; k < K; k++) {
      let gSum = 0,
        wSum = 0;
      for (let t = 0; t < T; t++) {
        gSum += gamma[t][k];
        wSum += gamma[t][k] * returns[t];
      }
      const mu = gSum > 0 ? wSum / gSum : means[k];
      let vSum = 0;
      for (let t = 0; t < T; t++) vSum += gamma[t][k] * (returns[t] - mu) ** 2;
      newMeans[k] = mu;
      newStds[k] = Math.max(gSum > 0 ? Math.sqrt(vSum / gSum) : stds[k], 1e-6);
    }
    means = newMeans;
    stds = newStds;

    let ll = 0;
    for (let t = 0; t < T; t++) ll += -Math.log(c[t] || 1e-300);
    logLik = ll;
  }

  // ---- label raw states by emission characteristics ----
  const idxs = Array.from({ length: K }, (_, k) => k);
  const panicIdx = idxs.reduce((best, k) => (stds[k] > stds[best] ? k : best), idxs[0]);
  const remaining = idxs.filter((k) => k !== panicIdx);
  const trendScore = (k: number) => Math.abs(means[k]) / Math.max(stds[k], 1e-9);
  const trendIdx = remaining.reduce((best, k) => (trendScore(k) > trendScore(best) ? k : best), remaining[0]);
  const chopIdx = remaining.find((k) => k !== trendIdx)!;

  const labels: RegimeLabel[] = new Array(K);
  labels[trendIdx] = "Trend";
  labels[chopIdx] = "Chop";
  labels[panicIdx] = "Panic";
  const stateIndexByLabel = { Trend: trendIdx, Chop: chopIdx, Panic: panicIdx };

  const idxOf = (l: RegimeLabel) => stateIndexByLabel[l];
  const transition = REGIME_LABELS.map((li) => REGIME_LABELS.map((lj) => A[idxOf(li)][idxOf(lj)]));

  // stationary distribution via power iteration on raw A
  let stat = new Array(K).fill(1 / K);
  for (let i = 0; i < 500; i++) {
    const next = new Array(K).fill(0);
    for (let j = 0; j < K; j++) {
      let s = 0;
      for (let ii = 0; ii < K; ii++) s += stat[ii] * A[ii][j];
      next[j] = s;
    }
    const sum = next.reduce((a, b) => a + b, 0);
    stat = next.map((v) => (sum > 0 ? v / sum : 1 / K));
  }
  const stationary = REGIME_LABELS.map((l) => stat[idxOf(l)]);

  const gammaByLabel = gamma.map((row) => ({
    Trend: row[trendIdx],
    Chop: row[chopIdx],
    Panic: row[panicIdx],
  }));
  const decodedPath: RegimeLabel[] = gamma.map((row) => {
    let bestK = 0,
      bestV = -1;
    for (let k = 0; k < K; k++) {
      if (row[k] > bestV) {
        bestV = row[k];
        bestK = k;
      }
    }
    return labels[bestK];
  });

  const currentProbs = gammaByLabel[gammaByLabel.length - 1];
  const currentLabel = decodedPath[decodedPath.length - 1];

  return {
    labels,
    stateIndexByLabel,
    transition,
    stationary,
    gammaByLabel,
    decodedPath,
    currentProbs,
    currentLabel,
    means,
    stds,
    logLik,
    iterations: ranIters,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Simple Donchian-channel backtest used for the "same strategy / wrong regime"
// vs "regime-gated" comparison. Deliberately simple (prototype, not a real
// trading system) — the point is to show the SAME rule set with and without
// a regime gate on real price data.
// ─────────────────────────────────────────────────────────────────────────────

export interface BacktestResult {
  returnPct: number;
  maxDrawdownPct: number;
  bars: number;
}

/**
 * @param closes    close price series
 * @param period    Donchian lookback (bars)
 * @param gateLabel If provided, only take a position when gate[t] === gateLabel;
 *                  otherwise flat. gate[t] aligns 1:1 with closes[t] (gate[0] unused).
 */
export function donchianBacktest(
  closes: number[],
  period: number,
  gate?: (RegimeLabel | undefined)[],
  gateLabel: RegimeLabel = "Trend"
): BacktestResult {
  let position = 0; // -1, 0, 1
  let equity = 1;
  let peak = 1;
  let maxDD = 0;
  let bars = 0;
  for (let t = period; t < closes.length; t++) {
    const windowHigh = Math.max(...closes.slice(t - period, t));
    const windowLow = Math.min(...closes.slice(t - period, t));
    if (closes[t] > windowHigh) position = 1;
    else if (closes[t] < windowLow) position = -1;

    let effPos = position;
    if (gate) {
      const g = gate[t];
      if (g !== gateLabel) effPos = 0;
    }
    const ret = (closes[t] - closes[t - 1]) / closes[t - 1];
    equity *= 1 + effPos * ret;
    peak = Math.max(peak, equity);
    const dd = (equity - peak) / peak;
    if (dd < maxDD) maxDD = dd;
    bars++;
  }
  return { returnPct: (equity - 1) * 100, maxDrawdownPct: maxDD * 100, bars };
}

/** Align an HMM decodedPath (indexed by return t, i.e. return between closes[t] & closes[t+1]) to a closes[] index. */
export function alignDecodedPathToCloses(decodedPath: RegimeLabel[]): (RegimeLabel | undefined)[] {
  // decodedPath[k] describes the return closes[k+1]-closes[k], i.e. it's "known" as of closes[k+1].
  const out: (RegimeLabel | undefined)[] = [undefined];
  for (const l of decodedPath) out.push(l);
  return out;
}
