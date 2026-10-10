// Dislocation velocity: z-scored bar-range deviation vs an EWMA-conditioned
// mean/var, gated on close-location to separate directional impulse from
// two-sided volatility expansion.
export type Bar = { high: number; low: number; close: number };

export type DVState = { mean: number; var: number; n: number };
export type DVOut = {
  z: number;            // range z-score vs EWMA distribution
  clv: number;          // close-location value, [-1,1] (−1 = close on low)
  velocity: number;     // signed impulse: z·clv when gated, else 0
  regime: "impulse-up" | "impulse-down" | "two-sided" | "quiet";
};

export function initDV(): DVState { return { mean: 0, var: 0, n: 0 }; }

// lambda = EWMA weight on the newest bar; gate = |clv| floor for "directional".
export function pushDV(
  st: DVState, bar: Bar, { lambda = 0.06, gate = 0.5, zThresh = 2 } = {},
): { state: DVState; out: DVOut } {
  const range = Math.max(bar.high - bar.low, 0);
  const clv = range > 0 ? 2 * ((bar.close - bar.low) / range) - 1 : 0;

  // EWMA mean + EWMA variance (deviation taken vs prior mean).
  const prevMean = st.mean;
  const mean = st.n === 0 ? range : lambda * range + (1 - lambda) * prevMean;
  const dev = range - prevMean;
  const varr = st.n === 0 ? 0 : lambda * dev * dev + (1 - lambda) * st.var;
  const state: DVState = { mean, var: varr, n: st.n + 1 };

  const sd = Math.sqrt(varr);
  const z = sd > 1e-9 ? (range - mean) / sd : 0;

  const directional = Math.abs(clv) >= gate;
  const hot = z >= zThresh;
  const velocity = hot && directional ? z * clv : 0;
  const regime: DVOut["regime"] =
    !hot ? "quiet"
    : directional ? (clv > 0 ? "impulse-up" : "impulse-down")
    : "two-sided";

  return { state, out: { z, clv, velocity, regime } };
}
