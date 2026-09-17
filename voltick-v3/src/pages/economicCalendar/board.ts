// ─────────────────────────────────────────────────────────────────────────────
// EARNINGS WEEK BOARD — surfaces and geometry.
//
// Transcribed from the `BOARD` object and the chip constants in v2's
// components/pages/EconomicCalendar.tsx. Spec: docs/parity/economic-calendar.md
// (the "BOARD washes" table and "Shared page constants").
//
// WHY THESE ARE ALPHAS AND NOT PICKED COLOURS. v2's HT.panelBg is a dark panel
// at 45% over a near-black page. On a surface that is MOSTLY card — the week
// board is five columns of them edge to edge — that lands almost on the
// background and the whole tab reads as one flat black rectangle: the cards
// were there, they just had no luminance to separate them.
//
// So the board's cards are lifted with a WHITE alpha over the plate rather than
// by picking a lighter value. It keeps tracking the token if the theme moves,
// it stays neutral instead of drifting blue, and it is the same rung system the
// rest of the app uses for hover and active states.
//
// Three rungs, and the gap between them is what makes the board readable:
//   CARD — a day column. The lightest thing on the page.
//   HEAD — its date strip, one rung UP from the card so the date has a plate.
//   TILE — a ticker chip, one rung DOWN so the chips read as objects sitting ON
//          the column rather than holes cut into it.
// ─────────────────────────────────────────────────────────────────────────────

import { CAL, T, V2, alpha } from '@/design/theme'

/** v2's HT.panelBg — the plate every rung below is mixed over. */
const PLATE = alpha(V2.panel, 0.45)

export const BOARD = {
  /** Day column fill. */
  card: `linear-gradient(180deg, ${alpha(T.text, 0.075)} 0%, ${alpha(T.text, 0.045)} 100%), ${PLATE}`,
  /** Same, tinted for today. */
  cardToday: `linear-gradient(180deg, ${alpha(CAL.accent, 0.16)} 0%, ${alpha(T.text, 0.05)} 55%), ${PLATE}`,
  /** The board's own branded header. Same lift, deeper accent ramp. */
  header: `linear-gradient(180deg, ${alpha(CAL.accent, 0.18)} 0%, ${alpha(T.text, 0.05)} 75%), ${PLATE}`,
  /** Date strip across the top of a column. */
  head: alpha(T.text, 0.06),
  headToday: alpha(CAL.accent, 0.14),
  /** One ticker chip. */
  tile: alpha(T.text, 0.035),
  /** Card edge. Stronger than the app hairline, which disappears at this fill. */
  edge: alpha(T.text, 0.16),
  edgeToday: alpha(CAL.accent, 0.55),
  /** Divider between the PRE / AFTER / TBD blocks inside a column. */
  rule: alpha(T.text, 0.09),
} as const

// ── Chip geometry ────────────────────────────────────────────────────────────

/** Chip column width in the CALENDAR tab's woven earnings row. */
export const CHIP_W = 46
/** Flex gap between those chips. */
export const CHIP_GAP = 10

/**
 * Logo size on the week board.
 *
 * The logo was 30px in a track that resolves to ~57px on a five-column week, so
 * every tile carried ~25px of dead air around a small mark. 42px is the largest
 * logo that still clears the tile's 3px side padding at the SAME four-across
 * track — the chips get bigger without the grid reflowing to three per row,
 * which would have made a nine-name Wednesday taller, not denser.
 *
 * KEEP THESE TWO IN STEP: CHIP_LOGO + 6px of padding must stay under the track
 * width CHIP_MIN resolves to, or the logo drives the column width instead of
 * the other way round.
 */
export const CHIP_LOGO = 42
/** Grid track minimum for the board's chip grid. */
export const CHIP_MIN = 52

// ── Day header labels ────────────────────────────────────────────────────────

/**
 * "MONDAY" — the FULL weekday, not the three-letter form.
 *
 * The board is five wide columns and the abbreviation read as a label on the
 * date rather than as the day. "MONDAY SEP 1" is what a week board says, and it
 * fits: the header is a three-column grid whose middle track sizes to content,
 * and the longest pair is still well inside the 210px column minimum.
 */
export function dayFull(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()
}

/** "SEP 1". */
export function dayDate(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    .toUpperCase()
}
