'use strict';
/**
 * server-v2/candle-despike.js — bad-print wicks out of the 1m cash tape.
 *
 * ── WHY (2026-10-07) ─────────────────────────────────────────────────────────
 * SPY 14:47 ET: one 1m bar's high read 779.10 while every bar around it topped
 * out near 777.70 — a single off-market print (late / out-of-sequence / block
 * reported away from the NBBO) that dxFeed's candle folded into the bar. On the
 * chart that is a needle a dollar and a half tall that never traded, and it
 * autoscales the pane around itself.
 *
 * Nothing caught it: the only guard anywhere was "range > 25% of price"
 * (sanitize() in cbedge-v3 candles.ts), and the recorder's upsert keeps
 * GREATEST(high), so once a bad print lands in etf_candles it stays.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 * For each 1m bar, look at the NEIGHBOURS bars either side (not the bar itself):
 *
 *   ref high  = the highest high among them
 *   tolerance = max(price × PCT, MULT × their average high-low range)
 *
 * cap = max(open, close, ref high). If the bar's high sticks out above cap by
 * more than the tolerance, the wick is clamped to cap. Same for the low, mirrored.
 *
 * What it can NOT touch:
 *   · the body — open and close are never moved, so a real breakout bar that
 *     CLOSES up there is untouched by construction;
 *   · a wick that any neighbour also reached (ref high covers it);
 *   · volume — the print was real volume, it just was not a real price.
 * So the only thing ever clamped is a wick that went somewhere nothing else
 * within ±5 minutes went, by a wide margin, and immediately came back.
 *
 * ── WHERE IT RUNS ────────────────────────────────────────────────────────────
 * At READ time, never at write time: etf_candles keeps the raw tape, so the
 * thresholds can be retuned (or ETF_DESPIKE=0 set) without a backfill.
 *
 *   · getEtfCandleHistory (etf-candle-recorder.js) — the same rule as SQL window
 *     functions, applied to the 1m rows BEFORE they are bucketed to 5m, so 5m and
 *     every client-side roll-up (15m, 1h, D) are clean too. SQL_* below.
 *   · getEtfCandles (same file) and the route's dxLink live fallback — despike().
 *   · the live hub (etf-live-candles.js readRows) — despike() over the retained
 *     1m bars. The forming bar has no future neighbours yet, so it is judged on
 *     the past side alone; once the next minutes arrive it is re-judged both ways.
 *
 * Keep the JS and SQL forms in step: same NEIGHBOURS, PCT, MULT.
 */

/** Bars each side compared against. */
const NEIGHBOURS = 5;
/** Tolerance floor as a fraction of price: 0.10% (≈0.78 on SPY at 778). */
const PCT = Number(process.env.ETF_DESPIKE_PCT || 0.001);
/** Tolerance as a multiple of the neighbours' average high-low range. */
const MULT = Number(process.env.ETF_DESPIKE_MULT || 4);
/** ETF_DESPIKE=0 turns the whole thing off (raw tape, as before). */
const ENABLED = process.env.ETF_DESPIKE !== '0';

/**
 * Clamp bad-print wicks. `bars` oldest-first, each { open, high, low, close, … }.
 * Returns a NEW array (bars that change are copied; the rest are passed through),
 * so callers holding the raw bars — the live hub's map — keep them raw.
 *
 * @param {Array<{open:number,high:number,low:number,close:number}>} bars
 * @param {{ neighbours?: number }} [opts]
 */
function despike(bars, opts = {}) {
  if (!ENABLED || !Array.isArray(bars) || bars.length < 2) return bars;
  const k = Math.max(1, opts.neighbours || NEIGHBOURS);
  const out = bars.slice();
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const o = Number(b.open);
    const h = Number(b.high);
    const l = Number(b.low);
    const c = Number(b.close);
    if (!(c > 0) || !(h > 0) || !(l > 0)) continue;

    let refHi = -Infinity;
    let refLo = Infinity;
    let rangeSum = 0;
    let n = 0;
    const lo = Math.max(0, i - k);
    const hi = Math.min(bars.length - 1, i + k);
    for (let j = lo; j <= hi; j++) {
      if (j === i) continue;
      const nb = bars[j];
      const nh = Number(nb.high);
      const nl = Number(nb.low);
      if (!(nh > 0) || !(nl > 0)) continue;
      if (nh > refHi) refHi = nh;
      if (nl < refLo) refLo = nl;
      rangeSum += nh - nl;
      n++;
    }
    if (!n) continue;

    const tol = Math.max(c * PCT, MULT * (rangeSum / n));
    let high = h;
    let low = l;
    // Measured from the higher of the neighbours and the bar's OWN body, so a
    // breakout bar's ordinary wick above its close is never trimmed.
    const capHi = Math.max(o, c, refHi);
    const capLo = Math.min(o, c, refLo);
    if (h > capHi + tol) high = capHi;
    if (l < capLo - tol) low = capLo;
    if (high !== h || low !== l) out[i] = { ...b, high, low };
  }
  return out;
}

// ── SQL form ─────────────────────────────────────────────────────────────────
// The same rule as window functions over etf_candles rows ordered by timestamp.
// MAX/MIN over an empty frame is NULL and GREATEST/LEAST skip NULLs, so the first
// and last rows are judged on whichever side they have.

/** Neighbour columns: nb_hi, nb_lo, nb_rng. Needs `WINDOW w_prev …, w_next …` (SQL_WINDOWS). */
const SQL_NEIGHBOUR_COLS = `
  GREATEST(MAX(high) OVER w_prev, MAX(high) OVER w_next) AS nb_hi,
  LEAST(MIN(low) OVER w_prev, MIN(low) OVER w_next)      AS nb_lo,
  (COALESCE(SUM(high - low) OVER w_prev, 0) + COALESCE(SUM(high - low) OVER w_next, 0))
    / NULLIF(COUNT(*) OVER w_prev + COUNT(*) OVER w_next, 0) AS nb_rng`;

const SQL_WINDOWS = `
  WINDOW w_prev AS (ORDER BY timestamp ROWS BETWEEN ${NEIGHBOURS} PRECEDING AND 1 PRECEDING),
         w_next AS (ORDER BY timestamp ROWS BETWEEN 1 FOLLOWING AND ${NEIGHBOURS} FOLLOWING)`;

/** The clamped high / low, given the neighbour columns above. */
function sqlClampCols(pctParam, multParam) {
  // Off: raw high/low, but still REFERENCE the params — Postgres rejects a bind
  // that supplies more parameters than the statement uses.
  if (!ENABLED) return `high, low, ${pctParam}::float8 AS _pct, ${multParam}::float8 AS _mult`;
  const tol = `GREATEST(close * ${pctParam}::float8, ${multParam}::float8 * COALESCE(nb_rng, 0))`;
  return `
    CASE WHEN nb_hi IS NOT NULL AND high > GREATEST(open, close, nb_hi) + ${tol}
         THEN GREATEST(open, close, nb_hi) ELSE high END AS high,
    CASE WHEN nb_lo IS NOT NULL AND low < LEAST(open, close, nb_lo) - ${tol}
         THEN LEAST(open, close, nb_lo) ELSE low END AS low`;
}

/** How far before the window to read so its first bar has past neighbours. */
const SQL_PAD_MS = (NEIGHBOURS + 5) * 60_000;

module.exports = {
  despike,
  NEIGHBOURS, PCT, MULT, ENABLED,
  SQL_NEIGHBOUR_COLS, SQL_WINDOWS, SQL_PAD_MS, sqlClampCols,
};
