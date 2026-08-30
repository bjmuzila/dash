// Dislocation velocity: z-scored bar-range deviation vs an EWMA-conditioned
// mean/var, gated on close-location to separate directional impulse from
// two-sided volatility expansion.
//
// Transcribed verbatim from v2's lib/dislocationVelocity.ts. Forty lines, no
// dependencies, and every constant load-bearing — re-deriving it from the
// description would have produced a different indicator with the same name.

export type Bar = { high: number; low: number; close: number }

export type DVState = { mean: number; var: number; n: number }
export type DVOut = {
  /** Range z-score vs the EWMA distribution. */
  z: number
  /** Close-location value, [-1,1]. −1 = closed on the low. */
  clv: number
  /** Signed impulse: z·clv when gated, else 0. */
  velocity: number
  regime: 'impulse-up' | 'impulse-down' | 'two-sided' | 'quiet'
}

export function initDV(): DVState {
  return { mean: 0, var: 0, n: 0 }
}

/**
 * @param lambda EWMA weight on the newest bar.
 * @param gate   |clv| floor for a move to count as "directional".
 * @param zThresh range z above which the bar is "hot".
 *
 * The /flow page calls this with `{ lambda: 0.05, zThresh: 2 }` and leaves
 * `gate` at its default 0.5.
 */
export function pushDV(
  st: DVState,
  bar: Bar,
  { lambda = 0.06, gate = 0.5, zThresh = 2 } = {},
): { state: DVState; out: DVOut } {
  const range = Math.max(bar.high - bar.low, 0)
  const clv = range > 0 ? 2 * ((bar.close - bar.low) / range) - 1 : 0

  // EWMA mean + EWMA variance, with the deviation taken against the PRIOR mean.
  const prevMean = st.mean
  const mean = st.n === 0 ? range : lambda * range + (1 - lambda) * prevMean
  const dev = range - prevMean
  const varr = st.n === 0 ? 0 : lambda * dev * dev + (1 - lambda) * st.var
  const state: DVState = { mean, var: varr, n: st.n + 1 }

  const sd = Math.sqrt(varr)
  const z = sd > 1e-9 ? (range - mean) / sd : 0

  const directional = Math.abs(clv) >= gate
  const hot = z >= zThresh
  const velocity = hot && directional ? z * clv : 0
  const regime: DVOut['regime'] = !hot
    ? 'quiet'
    : directional
      ? clv > 0
        ? 'impulse-up'
        : 'impulse-down'
      : 'two-sided'

  return { state, out: { z, clv, velocity, regime } }
}
