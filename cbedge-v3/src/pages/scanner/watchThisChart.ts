// ─────────────────────────────────────────────────────────────────────────────
// THE PROBE CHART — geometry and scales for the flagged contract's own price
// series. Pure functions in, plot data out; step 3 renders the SVG from what
// these return and adds nothing of its own.
//
// Transcribed 1:1 from v2's `ProbeChart` (`components/pages/Scanner.tsx:1280–1442`)
// against the checklist in docs/parity/scanner.md Part H, rows H160–H180.
//
// ── IT IS AN INLINE <svg>, HAND-ROLLED. NOT A CANVAS, NOT A CHART LIBRARY ────
// v2's doc comment gives the reason and it still holds: this chart renders
// inside a table cell that is already inside two other tables, and every
// charting library on the page wants a MEASURED container. A `viewBox` scales
// without measuring anything, which is the only reason this triple-nested cell
// can hold a chart at all. Keep it inline SVG in v3.
//
// Two v3 rules follow from that, and they point opposite ways:
//
//   * `data-cb-layer` DOES NOT APPLY. That rule governs canvases. There is no
//     canvas here — the only one in the whole of Part H was the offscreen
//     `document.createElement("canvas")` inside `captureFlagCard`, which was
//     never appended to the DOM and is not ported at all (see watchThis.ts's
//     REMOVED block).
//
//   * NON-NEGOTIABLE #5 DOES APPLY, AND v2 FAILS IT. `ProbeChart` has NO
//     visibility guard of any kind: no `document.hidden` check, no
//     intersection test, nothing. It repaints on every hover move regardless of
//     whether anyone can see it. Step 3 must mount it behind the v3 visibility
//     handle. Recorded here rather than fixed here, because the guard is a
//     render-layer concern and this file has no render layer. (H175, H214.)
//
// Four pieces of geometry that are not obvious from the picture:
//
//   1. THE X SCALE SPANS ALL DAYS, INCLUDING NO-TRADE DAYS. `n = days.length`,
//      not `points.length`. A day the contract never traded keeps its slot on
//      the axis so the timeline stays even, but carries no point — and the LINE
//      BREAKS there rather than drawing a straight segment across a gap that
//      never happened. That is what `segments` is for.
//
//   2. THE ENTRY PRICE IS FORCED INTO THE Y DOMAIN before the 10% padding is
//      applied. It is the chart's break-even — what taking the flag would have
//      cost — so the line the P/L is measured from can never fall off-canvas,
//      even when the contract has run far away from it.
//
//   3. THE THREE GRIDLINES SIT AT THE DATA hi / mid / lo, NOT at the padded
//      axis bounds. They label real prices on a right-hand rail, so the rail
//      reads as three quotes rather than three round numbers. When every close
//      is equal, all three stack on one y — v2's behaviour, unguarded.
//
//   4. THE TOUCHED MARKER IS AN EXACT STRING MATCH. `days.findIndex(d =>
//      d.date === ymd(touchedDate))` — no tolerance, no nearest-day search. A
//      touch date the `days` array does not contain draws nothing, silently.
//
// ── SPOT IS DELIBERATELY NOT DRAWN ───────────────────────────────────────────
// Price only, matching the owner site's card. Spot would need a second
// independent scale (the contract is worth a couple of dollars, spot is worth
// hundreds), and the day-by-day table directly below already carries spot, spot
// Δ% and the contract Δ$/Δ% for every point on this chart. (H180.)
//
// ── ONE KNOWING EXCEPTION TO "NO TYPE SIZES" ─────────────────────────────────
// `PROBE_CHART_GLYPH` names sizes. They are SVG USER UNITS inside a fixed
// 960×340 viewBox — coordinates in the same space as every x and y below, not
// CSS type sizes: the SVG scales as a whole and a text at 12 units is a fixed
// fraction of the plot however wide the cell is. Omitting them would not remove
// a magic number from the codebase, it would move it into step 3 as a guess.
//
// ── COLOUR ───────────────────────────────────────────────────────────────────
// v2 hardcoded eight `PROBE_*` literals here, and its comment says why: the PNG
// capture serialised this SVG standalone, where a `var()` reference resolves to
// nothing off-DOM. The capture is not ported, so the reason is gone and the
// literals go with it. The collapse (see watchThis.ts's header) puts:
//   PROBE_ICE #8ECAE6 (line, wash, hover dot) → LIGHT_BLUE — it always was one
//   PROBE_GRN #30d158 / PROBE_RED #ff5b5b     → MOVE_UP / MOVE_DOWN
//   the #7dd3fc TOUCHED marker                → LIGHT_BLUE
// which merges the line and the touched marker onto one token. In v2 those were
// #8ECAE6 and #7dd3fc — two light blues a hair apart that already read as the
// same colour; the dash pattern is what separated them on screen, and it still
// is.
//
// Spec: docs/parity/scanner.md Part H, rows H160–H180.
// ─────────────────────────────────────────────────────────────────────────────

import { LIGHT_BLUE, MOVE_DOWN, MOVE_UP, T, V2, alpha } from '@/design/theme'
import { ymd } from '@/pages/scanner/watchThis'
import type { OutcomeDetailDay } from '@/pages/scanner/watchThis'

// ═════════════════════════════════════════════════════════════════════════════
// GEOMETRY CONSTANTS (H160, H163, H164)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The viewBox and its padding. Plot area is therefore 870 × 284 user units:
 * `960 - 12 - 78` wide, `340 - 26 - 30` tall. The right pad is the widest by
 * far because the price rail and the last-mark pill live in it.
 */
export const PROBE_CHART = {
  w: 960,
  h: 340,
  padL: 12,
  padR: 78,
  padT: 26,
  padB: 30,
} as const

export const PROBE_CHART_VIEWBOX = `0 0 ${PROBE_CHART.w} ${PROBE_CHART.h}`

/** For the SVG element. v2 set both. (H160.) */
export const PROBE_CHART_ROLE = 'img'
export const PROBE_CHART_ARIA_LABEL = 'Contract price probe'

/** 10% headroom above and below the (entry-inclusive) data range. (H164.) */
export const PROBE_Y_PAD_FRACTION = 0.1

/** SVG user units, not CSS type sizes — see the header. */
export const PROBE_CHART_GLYPH = {
  railLabel: 12,
  marker: 11,
  extreme: 12,
  axis: 12,
  pill: 13,
  tipDate: 11,
  tipPrice: 15,
  tipPl: 13,
} as const

/** Stroke widths, radii and dash patterns, all in user units. */
export const PROBE_CHART_STROKE = {
  line: 1.9,
  grid: 1,
  entry: 1,
  touched: 1,
  crosshair: 1,
  extremeMarker: 1.6,
  hoverDot: 2,
  tooltip: 1,
} as const

export const PROBE_CHART_DASH = {
  /** The TOUCHED vertical. */
  touched: '3 3',
  /** The FLAGGED / break-even horizontal. */
  entry: '3 5',
  /** The hover crosshair. */
  crosshair: '2 3',
} as const

export const PROBE_CHART_RADIUS = {
  extremeMarker: 3.4,
  lastDot: 3.6,
  hoverDot: 4,
} as const

/** The touched marker's line opacity. (H168.) */
export const PROBE_TOUCHED_OPACITY = 0.65

/** The wash gradient: vertical, accent at 22% down to nothing. (H162.) */
export const PROBE_WASH_STOPS = [
  { offset: '0%', opacity: 0.22 },
  { offset: '100%', opacity: 0 },
] as const

/**
 * Every ink the chart draws with, resolved to v3 tokens. See the colour note in
 * the header for what each one used to be.
 */
export const PROBE_CHART_INK = {
  /** The price line, its wash, and the hover dot's ring. Was PROBE_ICE #8ECAE6. */
  line: LIGHT_BLUE,
  /** The dashed TOUCHED vertical and its label. Was LIGHT_BLUE #7dd3fc. */
  touched: LIGHT_BLUE,
  /** The session high's ring and label. Was PROBE_GRN #30d158. */
  high: MOVE_UP,
  /** The session low's ring and label. Was PROBE_RED #ff5b5b. */
  low: MOVE_DOWN,
  /** Rail prices, FLAGGED label, axis dates, tooltip text. Was PROBE_TXT #ffffff. */
  text: T.text,
  /** Ink INSIDE the solid last-mark pill — must stay dark on a filled chip. Was #06090d. */
  pillInk: V2.ink,
  /** The hover dot's fill. Was PROBE_BG #05060a. */
  hoverDotFill: V2.bg,
  gridline: alpha(T.text, 0.07),
  /** The break-even dashed line. */
  entryLine: alpha(T.text, 0.4),
  crosshair: alpha(T.text, 0.32),
  tooltipFill: alpha(V2.panel, 0.96),
  /**
   * The tooltip's border is UP-TONED WHATEVER THE SIGN — v2 drew
   * `rgba(48,209,88,0.45)` even when the hovered P/L was negative, so a losing
   * day reads inside a green box. Transcribed as written; whether it should
   * follow the P/L tone is Part H open question 7, and a decision, not a bug to
   * quietly fix here.
   */
  tooltipBorder: alpha(MOVE_UP, 0.45),
} as const

// ═════════════════════════════════════════════════════════════════════════════
// PLOT DATA
// ═════════════════════════════════════════════════════════════════════════════

/** A day that actually traded. `i` is its slot on the FULL day axis. */
export interface ProbePoint {
  i: number
  date: string
  v: number
}

/** One unbroken run of traded days. */
export interface ProbeSegment {
  /** `M…L…` path for the line. Coordinates at one decimal, as v2 emitted them. */
  line: string
  /**
   * The same path closed down to the axis for the wash fill. EMPTY STRING for a
   * segment shorter than two points — a lone traded day gets no wash, and its
   * line path is a bare `M` with no `L`, i.e. invisible. (H166, H167.)
   */
  area: string
}

export interface ProbeGridline {
  value: number
  y: number
  /** Two decimals, on the right-hand rail. */
  label: string
  labelX: number
  labelY: number
}

export interface ProbeMarker {
  value: number
  x: number
  y: number
  label: string
  labelX: number
  labelY: number
}

export interface ProbeLastMark {
  value: number
  x: number
  y: number
  /** `last >= entry` — INCLUSIVE, so exactly flat reads as up. (H173.) */
  up: boolean
  fill: string
  pill: { x: number; y: number; w: number; h: number; rx: number }
  textX: number
  textY: number
  text: string
}

export interface ProbeTouchedMarker {
  index: number
  x: number
  y1: number
  y2: number
  label: string
  labelX: number
  labelY: number
}

export interface ProbeGeometry {
  /** The `<svg id>`. Also seeds `washId`. (H148, H162.) */
  id: string
  washId: string
  viewBox: string
  /** Every day, traded or not — the x axis spans this many slots. */
  n: number
  points: ProbePoint[]
  segments: ProbeSegment[]
  gridlines: ProbeGridline[]
  /** The break-even horizontal: the FIRST PRICED close, not `opt_entry`. */
  entry: {
    value: number
    y: number
    x1: number
    x2: number
    label: string
    labelX: number
    labelY: number
  }
  high: ProbeMarker
  low: ProbeMarker
  last: ProbeLastMark
  /** `null` when there is no touch date, or when it matches no day in the series. */
  touched: ProbeTouchedMarker | null
  axis: { leftLabel: string; leftX: number; rightLabel: string; rightX: number; y: number }
  domain: { minY: number; maxY: number }
  /** Slot index → x. Exposed because the hover maths needs it. */
  sx: (i: number) => number
  /** Price → y. */
  sy: (v: number) => number
}

/**
 * Dates arrive as `YYYY-MM-DD`. Parsed at UTC NOON so a local timezone west of
 * Greenwich cannot roll the label back a day. Unparseable input falls back to
 * the raw string; an empty series yields `""`. (H172.)
 */
export function fmtProbeAxisDate(d: string): string {
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : d
}

/**
 * Build the whole plot.
 *
 * Returns `null` when fewer than TWO days carry a finite price — a single
 * priced day still returns null, and step 3 shows
 * `CHART_NOT_ENOUGH_HISTORY` from watchThis.ts instead of the SVG. (H161.)
 *
 * Spec: docs/parity/scanner.md Part H, rows H160–H180.
 */
export function buildProbeGeometry(
  days: OutcomeDetailDay[],
  touchedDate: string | null,
  chartId: string,
): ProbeGeometry | null {
  const { w: W, h: H, padL: PADL, padR: PADR, padT: PADT, padB: PADB } = PROBE_CHART

  // ── Every day keeps its slot on the axis; only traded days become points.
  const n = days.length
  const points: ProbePoint[] = []
  days.forEach((d, i) => {
    const v = d.contractClose
    if (v != null && Number.isFinite(v)) points.push({ i, date: d.date, v })
  })
  if (points.length < 2) return null

  const first = points[0]
  const lastPoint = points[points.length - 1]
  // Bound rather than indexed twice — under noUncheckedIndexedAccess an index
  // read is `T | undefined` however sure the length check above made us.
  if (!first || !lastPoint) return null

  const ys = points.map((p) => p.v)
  const hi = Math.max(...ys)
  const lo = Math.min(...ys)
  // `indexOf` takes the FIRST occurrence when the extreme repeats. (H170, H171.)
  const hiP = points[ys.indexOf(hi)]
  const loP = points[ys.indexOf(lo)]
  if (!hiP || !loP) return null

  // ── The y domain. The entry price is forced in FIRST, then the whole range is
  // padded — so the break-even line is inside the padded band, never on its
  // edge. A flat series (min === max) is widened by ±1 before padding, which is
  // what keeps the `|| 1` guard in `sy` from ever being the thing that saves it.
  const entryValue = first.v
  let minY = Math.min(lo, entryValue)
  let maxY = Math.max(hi, entryValue)
  if (minY === maxY) {
    minY -= 1
    maxY += 1
  }
  const gpad = (maxY - minY) * PROBE_Y_PAD_FRACTION
  minY -= gpad
  maxY += gpad

  const sx = (i: number): number => PADL + (n <= 1 ? 0 : i / (n - 1)) * (W - PADL - PADR)
  const sy = (v: number): number =>
    H - PADB - ((v - minY) / (maxY - minY || 1)) * (H - PADT - PADB)

  // ── Segments: walk the FULL day list and start a new run at every gap.
  const runs: { i: number; v: number }[][] = []
  {
    let cur: { i: number; v: number }[] = []
    days.forEach((d, i) => {
      const v = d.contractClose
      if (v == null || !Number.isFinite(v)) {
        if (cur.length) runs.push(cur)
        cur = []
        return
      }
      cur.push({ i, v })
    })
    if (cur.length) runs.push(cur)
  }

  const dOf = (s: { i: number; v: number }[]): string =>
    s.map((p, k) => `${k ? 'L' : 'M'}${sx(p.i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ')

  const areaOf = (s: { i: number; v: number }[]): string => {
    const head = s[0]
    const tail = s[s.length - 1]
    if (s.length < 2 || !head || !tail) return ''
    return `${dOf(s)} L${sx(tail.i).toFixed(1)},${H - PADB} L${sx(head.i).toFixed(1)},${H - PADB} Z`
  }

  const segments: ProbeSegment[] = runs.map((s) => ({ line: dOf(s), area: areaOf(s) }))

  // ── Three gridlines at the DATA high, midpoint and low. Not the axis bounds.
  const gridlines: ProbeGridline[] = [hi, (hi + lo) / 2, lo].map((v) => ({
    value: v,
    y: sy(v),
    label: v.toFixed(2),
    labelX: W - PADR + 10,
    labelY: sy(v) + 4,
  }))

  const lastValue = lastPoint.v
  const up = lastValue >= entryValue

  // ── EXACT string match against the normalised touch date. No tolerance.
  const touchIdx = touchedDate ? days.findIndex((d) => d.date === ymd(touchedDate)) : -1
  const touched: ProbeTouchedMarker | null =
    touchIdx >= 0
      ? {
          index: touchIdx,
          x: sx(touchIdx),
          y1: PADT,
          y2: H - PADB,
          label: 'TOUCHED',
          labelX: sx(touchIdx) + 5,
          labelY: PADT + 10,
        }
      : null

  return {
    id: chartId,
    washId: `${chartId}-wash`,
    viewBox: PROBE_CHART_VIEWBOX,
    n,
    points,
    segments,
    gridlines,
    entry: {
      value: entryValue,
      y: sy(entryValue),
      x1: PADL,
      x2: W - PADR,
      label: `FLAGGED ${entryValue.toFixed(2)}`,
      labelX: PADL + 4,
      labelY: sy(entryValue) - 7,
    },
    high: {
      value: hi,
      x: sx(hiP.i),
      y: sy(hi),
      label: `H ${hi.toFixed(2)}`,
      labelX: sx(hiP.i),
      labelY: sy(hi) - 11,
    },
    low: {
      value: lo,
      x: sx(loP.i),
      y: sy(lo),
      label: `L ${lo.toFixed(2)}`,
      labelX: sx(loP.i),
      labelY: sy(lo) + 18,
    },
    last: {
      value: lastValue,
      x: sx(lastPoint.i),
      y: sy(lastValue),
      up,
      fill: up ? PROBE_CHART_INK.high : PROBE_CHART_INK.low,
      pill: { x: W - PADR + 4, y: sy(lastValue) - 11, w: 62, h: 22, rx: 5 },
      textX: W - PADR + 35,
      textY: sy(lastValue) + 4,
      text: lastValue.toFixed(2),
    },
    touched,
    axis: {
      leftLabel: fmtProbeAxisDate(days[0]?.date ?? ''),
      leftX: PADL,
      rightLabel: fmtProbeAxisDate(days[n - 1]?.date ?? ''),
      rightX: W - PADR,
      y: H - 8,
    },
    domain: { minY, maxY },
    sx,
    sy,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// HOVER (H174–H179)
// ═════════════════════════════════════════════════════════════════════════════

/** The tooltip plate. Fixed width — the flip test below depends on it. */
export const PROBE_TIP = { w: 168, h: 44, rx: 7 } as const

/**
 * Which POINT the pointer is nearest.
 *
 * Converts client px to viewBox units through the element's own box, projects
 * that back onto the day axis, then snaps to the nearest DAY THAT ACTUALLY
 * TRADED — never to an empty slot. Hovering the right-hand rail (`x` past
 * `W - PADR`) therefore still lands on the last point rather than nothing.
 *
 * Returns an index into `geometry.points`, never into `days`.
 */
export function probeHoverIndex(
  g: ProbeGeometry,
  clientX: number,
  box: { left: number; width: number },
): number {
  const { w: W, padL: PADL, padR: PADR } = PROBE_CHART
  const vx = ((clientX - box.left) / box.width) * W
  const raw = ((vx - PADL) / (W - PADL - PADR)) * (g.n - 1)
  let best = 0
  let bd = Infinity
  g.points.forEach((p, k) => {
    const d = Math.abs(p.i - raw)
    if (d < bd) {
      bd = d
      best = k
    }
  })
  return best
}

export interface ProbeHover {
  point: ProbePoint
  /** The crosshair's x, and the anchor everything else is measured from. */
  x: number
  crosshair: { y1: number; y2: number }
  dot: { x: number; y: number }
  /** Translate for the tooltip group. */
  tip: { x: number; y: number; w: number; h: number; rx: number }
  /** Raw `YYYY-MM-DD` — NOT run through `fmtProbeAxisDate`, unlike the axis labels. (H177.) */
  dateText: string
  dateX: number
  dateY: number
  priceText: string
  priceX: number
  priceY: number
  /** `$` P/L per SINGLE contract, U+2212 minus, zero decimals. (H179.) */
  plText: string
  plX: number
  plY: number
  plUp: boolean
  plInk: string
}

/**
 * The crosshair, the dot and the tooltip for one hovered point.
 *
 * The tooltip FLIPS to the left of the crosshair once it would cross the right
 * rail (`hx + 12 + 168 > W - PADR`, i.e. past x≈702), and its top edge is
 * clamped at `PADT` so it cannot ride out of the viewBox on a high point.
 *
 * Returns `null` for an out-of-range index, which is how a cleared hover is
 * expressed. (H174–H179.)
 */
export function probeHover(g: ProbeGeometry, hoverIndex: number | null): ProbeHover | null {
  if (hoverIndex == null) return null
  const p = g.points[hoverIndex]
  if (!p) return null

  const { w: W, padT: PADT, padB: PADB, padR: PADR, h: H } = PROBE_CHART
  const hx = g.sx(p.i)
  const hy = g.sy(p.v)
  const pl = (p.v - g.entry.value) * 100
  const flip = hx + 12 + PROBE_TIP.w > W - PADR

  return {
    point: p,
    x: hx,
    crosshair: { y1: PADT, y2: H - PADB },
    dot: { x: hx, y: hy },
    tip: {
      x: flip ? hx - 12 - PROBE_TIP.w : hx + 12,
      y: Math.max(PADT, hy - 46),
      w: PROBE_TIP.w,
      h: PROBE_TIP.h,
      rx: PROBE_TIP.rx,
    },
    dateText: p.date,
    dateX: 12,
    dateY: 18,
    priceText: `$${p.v.toFixed(2)}`,
    priceX: 12,
    priceY: 35,
    plText: `${pl >= 0 ? '+' : '−'}$${Math.abs(pl).toFixed(0)}`,
    plX: 92,
    plY: 35,
    plUp: pl >= 0,
    // COLOUR COLLAPSE: v2's third up/down pair on this one panel — PROBE_GRN /
    // PROBE_RED, different again from HOME_THEME.green/red two rows above and
    // from the tooltip's own always-green border. One pair now.
    plInk: pl >= 0 ? PROBE_CHART_INK.high : PROBE_CHART_INK.low,
  }
}
