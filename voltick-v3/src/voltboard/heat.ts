// ─────────────────────────────────────────────────────────────────────────────
// The board's size → brightness law, and the bar length beside it.
//
// Ported verbatim from Voltick's `heatscale.js` / `meterscale.js`, constants and
// all, because "brighter = bigger" is the first thing the legend teaches and the
// last thing anyone stops using. Two functions, deliberately NOT collapsed into
// one — they answer different questions about the same number:
//
//   heatT()    how BRIGHT, on a compressed curve (sqrt below the reference, log
//              above) so a calm board still saturates and one enormous strike
//              cannot wash the rest of the grid out.
//   meterPct() how LONG, straight-line in |v| / maxAbs.
//
// The compression is exactly why the bar exists. It makes neighbouring values
// look alike by design, so two mid-greens on a dense grid are a genuine guess.
// A bar run through the same curve would agree with the fill it was added to
// disambiguate. Length is the second, independent encoding.
//
// THE KNEE, and why the clamp is gone. The obvious version —
// `Math.sqrt(Math.min(|v| / ref, 1))` — flattens everything at or above the
// reference onto one colour, and the top decile of a board is precisely the
// walls, the Volt and the Surge. Growth through them was invisible. Below the
// reference this curve is that one; above it, the remaining headroom is spent
// on a log, so a wall that doubles still moves.
// ─────────────────────────────────────────────────────────────────────────────

/** The reference's floor, as a fraction of the board's largest cell. */
export const HEAT_FLOOR = 0.35

/** Where the reference lands on the 0..1 ramp. */
export const HEAT_KNEE = 0.84

/** The widest ratio the reference can ever be handed, given the floor above. */
const OVER = Math.log(1 / HEAT_FLOOR)

/**
 * 0..1 along the colour ramp.
 *
 * `ref` is the board's REFERENCE — p90-anchored, floored at HEAT_FLOOR × the
 * largest cell — not its maximum. The floor and this curve's ceiling are the
 * same constant by construction, so the brightest colour stays exactly
 * reachable and the two cannot drift apart the way two copies would.
 */
export function heatT(v: number, ref: number): number {
  if (!ref || !Number.isFinite(ref) || ref <= 0) return 0
  const r = Math.abs(Number(v) || 0) / ref
  if (!Number.isFinite(r)) return 0
  if (r <= 1) return Math.sqrt(r) * HEAT_KNEE
  return Math.min(1, HEAT_KNEE + (1 - HEAT_KNEE) * (Math.log(r) / OVER))
}

/**
 * The board's heat reference: the 90th percentile of the live cells, floored at
 * HEAT_FLOOR × the largest. Anchoring straight to the largest cell lets one
 * monster strike wash the field out, which is what the percentile is for.
 */
export function heatRef(values: number[]): number {
  const abs = values.map((v) => Math.abs(v)).filter((a) => a > 0)
  if (!abs.length) return 0
  abs.sort((a, b) => a - b)
  const p90 = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.9))]
  const max = abs[abs.length - 1]
  return Math.max(p90, max * HEAT_FLOOR)
}

/** px · the bar's height, pinned to the cell's bottom edge. */
export const METER_H = 3

/** % · the smallest bar a NON-ZERO cell may draw. */
const METER_MIN = 2

/**
 * `maxAbs`, NOT the heat reference. The reference is floored, so measuring bars
 * against it would peg every heavy cell to full width and say nothing.
 *
 * A non-zero cell always shows something: "too small to draw" and "nothing
 * here" are different facts, and the grid already prints $0 for the second.
 */
export function meterPct(v: number, maxAbs: number): number {
  const ref = Number(maxAbs)
  if (!Number.isFinite(ref) || ref <= 0) return 0
  const a = Math.abs(Number(v) || 0)
  if (a <= 0) return 0
  return Math.max(METER_MIN, Math.min(100, (a / ref) * 100))
}
