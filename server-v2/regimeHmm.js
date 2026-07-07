'use strict';
/**
 * server-v2/regimeHmm.js — CommonJS port of lib/regimeHmm.ts's fitGaussianHmm
 * ONLY (the piece regime-alert-recorder.js needs to decode a live state
 * server-side). Same algorithm, kept in sync by hand — if you change the
 * Baum-Welch fit or the Trend/Chop/Panic labeling rule in lib/regimeHmm.ts,
 * mirror the change here too.
 *
 * Compact 3-state Gaussian HMM fit via scaled forward-backward + Baum-Welch EM
 * on a sequence of log returns. States are unordered coming out of the fit, so
 * after convergence we label them by their emission stats:
 *   - Panic = highest volatility (std) state
 *   - Trend = highest |mean|/std ("Sharpe-like") among the remaining two
 *   - Chop  = whatever's left
 */

const REGIME_LABELS = ['Trend', 'Chop', 'Panic'];

function gaussPdf(x, mu, sigma) {
  const s = Math.max(sigma, 1e-8);
  const z = (x - mu) / s;
  return Math.exp(-0.5 * z * z) / (s * Math.sqrt(2 * Math.PI));
}

/**
 * Fit a K-state Gaussian HMM to a 1D observation sequence via Baum-Welch EM.
 * Returns null if there isn't enough data to fit meaningfully.
 */
function fitGaussianHmm(returns, opts) {
  const K = (opts && opts.states) || 3;
  const iters = (opts && opts.iters) || 25;
  const T = returns.length;
  if (T < K * 20) return null;

  const sorted = [...returns].sort((a, b) => a - b);
  const globalMean = returns.reduce((a, b) => a + b, 0) / T;
  const globalVar = returns.reduce((a, b) => a + (b - globalMean) ** 2, 0) / T;
  const std0 = Math.sqrt(globalVar) || 1e-6;

  let means = Array.from({ length: K }, (_, k) => sorted[Math.min(T - 1, Math.floor(((k + 0.5) / K) * T))]);
  let stds = new Array(K).fill(std0);
  let A = Array.from({ length: K }, () => new Array(K).fill(1 / K));
  let pi0 = new Array(K).fill(1 / K);

  let gamma = [];
  let logLik = -Infinity;
  let ranIters = 0;

  for (let it = 0; it < iters; it++) {
    ranIters = it + 1;
    const B = new Array(T);
    for (let t = 0; t < T; t++) {
      const row = new Array(K);
      for (let k = 0; k < K; k++) row[k] = gaussPdf(returns[t], means[k], stds[k]) + 1e-12;
      B[t] = row;
    }

    const alpha = new Array(T);
    const c = new Array(T);
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

    const beta = new Array(T);
    beta[T - 1] = new Array(K).fill(c[T - 1]);
    for (let t = T - 2; t >= 0; t--) {
      beta[t] = new Array(K).fill(0);
      for (let i = 0; i < K; i++) {
        let sum = 0;
        for (let j = 0; j < K; j++) sum += A[i][j] * B[t + 1][j] * beta[t + 1][j];
        beta[t][i] = sum * c[t];
      }
    }

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

    const xiSum = Array.from({ length: K }, () => new Array(K).fill(0));
    for (let t = 0; t < T - 1; t++) {
      let denom = 0;
      const num = Array.from({ length: K }, () => new Array(K).fill(0));
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

    pi0 = gamma[0].slice();
    const newA = Array.from({ length: K }, () => new Array(K).fill(0));
    for (let i = 0; i < K; i++) {
      let gSum = 0;
      for (let t = 0; t < T - 1; t++) gSum += gamma[t][i];
      for (let j = 0; j < K; j++) newA[i][j] = gSum > 0 ? xiSum[i][j] / gSum : 1 / K;
    }
    A = newA;

    const newMeans = new Array(K).fill(0);
    const newStds = new Array(K).fill(0);
    for (let k = 0; k < K; k++) {
      let gSum = 0, wSum = 0;
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

  const idxs = Array.from({ length: K }, (_, k) => k);
  const panicIdx = idxs.reduce((best, k) => (stds[k] > stds[best] ? k : best), idxs[0]);
  const remaining = idxs.filter((k) => k !== panicIdx);
  const trendScore = (k) => Math.abs(means[k]) / Math.max(stds[k], 1e-9);
  const trendIdx = remaining.reduce((best, k) => (trendScore(k) > trendScore(best) ? k : best), remaining[0]);
  const chopIdx = remaining.find((k) => k !== trendIdx);

  const labels = new Array(K);
  labels[trendIdx] = 'Trend';
  labels[chopIdx] = 'Chop';
  labels[panicIdx] = 'Panic';
  const stateIndexByLabel = { Trend: trendIdx, Chop: chopIdx, Panic: panicIdx };

  const idxOf = (l) => stateIndexByLabel[l];
  const transition = REGIME_LABELS.map((li) => REGIME_LABELS.map((lj) => A[idxOf(li)][idxOf(lj)]));

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
    Trend: row[trendIdx], Chop: row[chopIdx], Panic: row[panicIdx],
  }));
  const decodedPath = gamma.map((row) => {
    let bestK = 0, bestV = -1;
    for (let k = 0; k < K; k++) {
      if (row[k] > bestV) { bestV = row[k]; bestK = k; }
    }
    return labels[bestK];
  });

  const currentProbs = gammaByLabel[gammaByLabel.length - 1];
  const currentLabel = decodedPath[decodedPath.length - 1];

  return {
    labels, stateIndexByLabel, transition, stationary, gammaByLabel, decodedPath,
    currentProbs, currentLabel, means, stds, logLik, iterations: ranIters,
  };
}

module.exports = { fitGaussianHmm, REGIME_LABELS };
