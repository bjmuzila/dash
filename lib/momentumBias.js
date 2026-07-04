'use strict';
// Pure Momentum Bias Index math — no DB, no Next, no side effects. Plain JS so
// the server-v2 feed (CommonJS) can require() it to detect + record TP signals,
// while the TS UI imports it through lib/momentumBias.ts for the /es-candles
// oscillator pane. One source of truth, so the recorded signal IS the rendered
// signal.
//
// Ported 1:1 from the reference pandas get_momentum_bias_index: HMA/WMA smoothing
// (dot-product weights), volatility-normalized momentum (raw momentum / EMA of
// the H-L range), split up/down bias, a stdev "impulse boundary", and crossunder
// take-profit triggers. NaN semantics mirror pandas: any comparison involving a
// NaN is false, and rolling windows yield NaN until fully populated with finite
// values (min_periods == window).

/**
 * Weighted Moving Average. Oldest bar in the window gets weight 1, newest gets
 * weight `length` (matches np.dot(window, arange(1, length+1))). NaN if the
 * window is incomplete or contains a non-finite value.
 * @param {number[]} series
 * @param {number} length
 * @returns {number[]}
 */
function wma(series, length) {
  const n = series.length;
  const out = new Array(n).fill(NaN);
  if (length <= 0) return out;
  const denom = (length * (length + 1)) / 2; // sum of weights 1..length
  for (let i = length - 1; i < n; i++) {
    let acc = 0, ok = true;
    for (let k = 0; k < length; k++) {
      const v = series[i - length + 1 + k];
      if (!Number.isFinite(v)) { ok = false; break; }
      acc += v * (k + 1); // weight rises toward the most recent bar
    }
    out[i] = ok ? acc / denom : NaN;
  }
  return out;
}

/**
 * Hull Moving Average: WMA(2*WMA(n/2) - WMA(n), sqrt(n)). Lengths floored like
 * the Pine/pandas reference (int()).
 * @param {number[]} series
 * @param {number} length
 * @returns {number[]}
 */
function hma(series, length) {
  const half = Math.trunc(length / 2);
  const sq = Math.trunc(Math.sqrt(length));
  const wHalf = wma(series, half);
  const wFull = wma(series, length);
  const raw = new Array(series.length);
  for (let i = 0; i < series.length; i++) {
    const a = wHalf[i], b = wFull[i];
    raw[i] = (Number.isFinite(a) && Number.isFinite(b)) ? 2 * a - b : NaN;
  }
  return wma(raw, sq);
}

/**
 * EMA with adjust=False (matches pandas .ewm(span, adjust=False).mean() and
 * Pine ta.ema). Seeds on the first finite value; leading non-finite values stay
 * NaN.
 * @param {number[]} series
 * @param {number} span
 * @returns {number[]}
 */
function emaAdjustFalse(series, span) {
  const n = series.length;
  const out = new Array(n).fill(NaN);
  const alpha = 2 / (span + 1);
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    const v = series[i];
    if (!Number.isFinite(v)) { out[i] = prev; continue; }
    prev = Number.isFinite(prev) ? alpha * v + (1 - alpha) * prev : v;
    out[i] = prev;
  }
  return out;
}

/** Rolling sum, min_periods == window, NaN-aware. @returns {number[]} */
function rollingSum(series, window) {
  const n = series.length;
  const out = new Array(n).fill(NaN);
  for (let i = window - 1; i < n; i++) {
    let acc = 0, ok = true;
    for (let k = 0; k < window; k++) {
      const v = series[i - k];
      if (!Number.isFinite(v)) { ok = false; break; }
      acc += v;
    }
    out[i] = ok ? acc : NaN;
  }
  return out;
}

/** Rolling population standard deviation (ddof=0), min_periods == window. */
function rollingStdPop(series, window) {
  const n = series.length;
  const out = new Array(n).fill(NaN);
  for (let i = window - 1; i < n; i++) {
    let sum = 0, ok = true;
    for (let k = 0; k < window; k++) {
      const v = series[i - k];
      if (!Number.isFinite(v)) { ok = false; break; }
      sum += v;
    }
    if (!ok) continue;
    const mean = sum / window;
    let sq = 0;
    for (let k = 0; k < window; k++) { const d = series[i - k] - mean; sq += d * d; }
    out[i] = Math.sqrt(sq / window);
  }
  return out;
}

/**
 * @typedef {Object} MomentumBiasBar
 * @property {number|null} momentumUpBias
 * @property {number|null} momentumDownBias
 * @property {number|null} boundary
 * @property {boolean} bullishTp   TP for shorts / bullish reversal (down-bias crossunder above boundary)
 * @property {boolean} bearishTp   TP for longs / bearish reversal (up-bias crossunder above boundary)
 */

/**
 * Compute the Momentum Bias Index over an ordered (oldest→newest) array of bars.
 * @param {Array<{high:number, low:number, close:number}>} bars
 * @param {Object} [opts]
 * @param {number} [opts.momentumLength=10]
 * @param {number} [opts.biasLength=5]
 * @param {number} [opts.smoothLength=10]
 * @param {number} [opts.impulseBoundaryLength=30]
 * @param {number} [opts.stdDevMultiplier=3.0]
 * @param {boolean} [opts.smoothIndicator=true]
 * @returns {MomentumBiasBar[]} one entry per input bar, aligned by index
 */
function getMomentumBiasIndex(bars, opts) {
  const o = opts || {};
  const momentumLength = o.momentumLength != null ? o.momentumLength : 10;
  const biasLength = o.biasLength != null ? o.biasLength : 5;
  const smoothLength = o.smoothLength != null ? o.smoothLength : 10;
  const impulseBoundaryLength = o.impulseBoundaryLength != null ? o.impulseBoundaryLength : 30;
  const stdDevMultiplier = o.stdDevMultiplier != null ? o.stdDevMultiplier : 3.0;
  const smoothIndicator = o.smoothIndicator != null ? o.smoothIndicator : true;

  const n = bars.length;
  const close = new Array(n), hl = new Array(n);
  for (let i = 0; i < n; i++) {
    close[i] = Number(bars[i].close);
    hl[i] = Number(bars[i].high) - Number(bars[i].low);
  }

  // 1. Raw momentum & volatility normalization.
  const momentum = new Array(n).fill(NaN);
  for (let i = momentumLength; i < n; i++) momentum[i] = close[i] - close[i - momentumLength];
  const hlEma = emaAdjustFalse(hl, momentumLength).map((v) => (v === 0 ? 1e-10 : v));
  const stdDev = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(momentum[i]) && Number.isFinite(hlEma[i])) stdDev[i] = (momentum[i] / hlEma[i]) * 100;
  }

  // 2. Split directional momentum.
  const momUp = stdDev.map((v) => (Number.isFinite(v) ? Math.max(v, 0) : NaN));
  const momDown = stdDev.map((v) => (Number.isFinite(v) ? Math.min(v, 0) : NaN));

  // 3. Rolling summation.
  const sumUp = rollingSum(momUp, biasLength);
  const sumDown = rollingSum(momDown, biasLength);

  // 4. Smoothing + bias.
  let upBias, downBias;
  if (smoothIndicator) {
    const hUp = hma(sumUp, smoothLength);
    const hDown = hma(sumDown.map((v) => (Number.isFinite(v) ? -v : NaN)), smoothLength);
    upBias = hUp.map((v) => (Number.isFinite(v) ? Math.max(v, 0) : NaN));
    downBias = hDown.map((v) => (Number.isFinite(v) ? Math.max(v, 0) : NaN));
  } else {
    upBias = sumUp.slice();
    downBias = sumDown.map((v) => (Number.isFinite(v) ? -v : NaN));
  }

  // 5. Average bias + impulse boundary.
  const avgBias = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(upBias[i]) && Number.isFinite(downBias[i])) avgBias[i] = (upBias[i] + downBias[i]) / 2;
  }
  const avgEma = emaAdjustFalse(avgBias, impulseBoundaryLength);
  const avgStd = rollingStdPop(avgBias, impulseBoundaryLength);
  const boundary = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(avgEma[i]) && Number.isFinite(avgStd[i])) boundary[i] = avgEma[i] + avgStd[i] * stdDevMultiplier;
  }

  // 6. Crossunder TP triggers. crossunder(x): x[i] < x[i-1] && x[i-1] >= x[i-2].
  // Comparisons involving NaN are false, so early/undefined bars never fire.
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let bullishTp = false, bearishTp = false;
    if (i >= 2) {
      const crossDown = downBias[i] < downBias[i - 1] && downBias[i - 1] >= downBias[i - 2];
      if (crossDown && downBias[i] > boundary[i] && downBias[i] > upBias[i]) bullishTp = true;
      const crossUp = upBias[i] < upBias[i - 1] && upBias[i - 1] >= upBias[i - 2];
      if (crossUp && upBias[i] > boundary[i] && upBias[i] > downBias[i]) bearishTp = true;
    }
    out[i] = {
      momentumUpBias: Number.isFinite(upBias[i]) ? upBias[i] : null,
      momentumDownBias: Number.isFinite(downBias[i]) ? downBias[i] : null,
      boundary: Number.isFinite(boundary[i]) ? boundary[i] : null,
      bullishTp,
      bearishTp,
    };
  }
  return out;
}

module.exports = { getMomentumBiasIndex, wma, hma, emaAdjustFalse, rollingSum, rollingStdPop };
