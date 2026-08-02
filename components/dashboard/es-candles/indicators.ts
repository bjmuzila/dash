/**
 * components/dashboard/es-candles/indicators.ts
 *
 * Pure math for the chart's indicator overlays. No React, no canvas, no chart
 * library — every function here takes numbers and returns numbers, so the draw
 * code stays about pixels and this stays testable on its own.
 *
 * Every series returns an array the SAME LENGTH as its input, with `null` in the
 * warm-up slots rather than a shorter array. A shorter array would silently
 * shift every value one bar earlier the moment a caller zipped it against the
 * bars — the classic off-by-warmup that makes an indicator look prophetic.
 */

/** Simple moving average. `null` until `n` samples exist. */
export function sma(values: number[], n: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (n <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/**
 * Exponential moving average, seeded with the first `n`-bar SMA.
 *
 * Seeding matters: starting from values[0] instead lets one opening print
 * dominate the line for the first few dozen bars, which on a 5m intraday chart
 * is most of the morning.
 */
export function ema(values: number[], n: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (n <= 0 || values.length < n) return out;
  const k = 2 / (n + 1);
  let seed = 0;
  for (let i = 0; i < n; i++) seed += values[i];
  let prev = seed / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Rolling POPULATION standard deviation about the same window's SMA.
 *
 * Population (÷n), not sample (÷n−1), because that is what Bollinger specified
 * and what every charting package plots. The difference is small at n=20 but it
 * is a real difference, and a band that sits a hair wider than the platform the
 * user is comparing against reads as a bug in exactly the moments that matter.
 */
export function stdev(values: number[], n: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (n <= 0) return out;
  const basis = sma(values, n);
  for (let i = n - 1; i < values.length; i++) {
    const mb = basis[i];
    if (mb == null) continue;
    let acc = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const d = values[j] - mb;
      acc += d * d;
    }
    out[i] = Math.sqrt(acc / n);
  }
  return out;
}

export type BollingerBands = {
  basis: Array<number | null>;
  /** Inner cloud edge — basis ± innerMult × σ. */
  upperInner: Array<number | null>;
  lowerInner: Array<number | null>;
  /** Outer cloud edge — basis ± outerMult × σ. */
  upperOuter: Array<number | null>;
  lowerOuter: Array<number | null>;
};

export const BB_DEFAULT_PERIOD = 20;
export const BB_DEFAULT_INNER = 2.3;
export const BB_DEFAULT_OUTER = 3.0;

/**
 * Bollinger bands with TWO multiples, so the space between them can be shaded
 * as a cloud rather than drawn as four unrelated lines.
 *
 *   MB      = SMA(price, n)
 *   sigma   = population stdev over the same n
 *   inner   = MB ± innerMult × sigma      (2.3 by default)
 *   outer   = MB ± outerMult × sigma      (3.0 by default)
 *
 * The band pair is deliberately not sorted or clamped: if a caller passes
 * innerMult > outerMult the cloud inverts, which is visible immediately and
 * therefore better than silently swapping them behind their back.
 */
export function bollinger(
  values: number[],
  n: number = BB_DEFAULT_PERIOD,
  innerMult: number = BB_DEFAULT_INNER,
  outerMult: number = BB_DEFAULT_OUTER,
): BollingerBands {
  const basis = sma(values, n);
  const sd = stdev(values, n);
  const mk = (mult: number, sign: 1 | -1) => basis.map((mb, i) => {
    const s = sd[i];
    return mb == null || s == null ? null : mb + sign * mult * s;
  });
  return {
    basis,
    upperInner: mk(innerMult, 1),
    lowerInner: mk(innerMult, -1),
    upperOuter: mk(outerMult, 1),
    lowerOuter: mk(outerMult, -1),
  };
}

/**
 * Wilder's RSI. `null` until there are `n` changes to average.
 *
 * Wilder's smoothing (the 1/n recursive average), not a plain SMA of gains and
 * losses — the two diverge quickly and every platform quotes Wilder's.
 */
export function rsi(values: number[], n = 14): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (n <= 0 || values.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / n, avgLoss = loss / n;
  // avgLoss === 0 is not a divide-by-zero to guard past — it is a genuine 100.
  out[n] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d >= 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (n - 1) + g) / n;
    avgLoss = (avgLoss * (n - 1) + l) / n;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** mm:ss (or h:mm:ss past an hour) left in the forming bar. */
export function fmtCountdown(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
