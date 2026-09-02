// ─────────────────────────────────────────────────────────────────────────────
// THE IB LEVEL LADDER — GEOMETRY.
//
// Transcribed 1:1 from v2's `components/scanner/IbLevelCanvas.tsx` (333 lines)
// against the checklist in docs/parity/scanner.md Part G, rows G279–G304.
//
// It prices the extension levels instead of quoting a percentage: the table says
// "34.8% of breaks reach 1.0×", this says 1.0× is 6,412.50, it is 22.3 points
// away, and 34.8% of breaks got there. That is the one thing on the tab this
// file does that nothing else does, and it is the reason it is transcribed
// rather than deleted.
//
// ── THREE FINDINGS THAT CHANGE WHAT "PORTING THIS" MEANS ─────────────────────
//
// 1. IT IS NOT A CANVAS. The file is named `IbLevelCanvas`, its header calls it
//    "the live IB state canvas", and the empty-state copy says "The canvas
//    builds itself…". There is NO `<canvas>` element, NO `getContext`, NO 2D
//    context and NO imperative draw call anywhere in it. The whole picture is
//    ONE declarative `<svg viewBox="0 0 560 460">` with about twenty children.
//    Everything below is therefore SVG geometry in USER UNITS, not CSS pixels.
//
//    DPR HANDLING: NONE EXISTS, AND NONE IS NEEDED. Resolution independence
//    comes from the viewBox — the browser rasterises the vector at whatever the
//    device pixel ratio happens to be. That is free here and NOT free in canvas:
//    if v3 rebuilds this as a real canvas it must size the backing store to
//    `cssPx * devicePixelRatio` and `ctx.scale(dpr, dpr)` itself, or the ladder
//    ships blurry on every retina screen. SVG's scaling does not port for free.
//
// 2. `data-cb-layer` (v3 non-negotiable 6) DOES NOT APPLY — there is no canvas
//    to tag. Stated plainly: the attribute is absent, and the `<svg>` does not
//    carry it either. It does carry `role="img"` and an `aria-label`. A canvas
//    rebuild must add the tag.
//
// 3. THE VISIBILITY GUARD (v3 non-negotiable 5) DOES APPLY, AND IS ABSENT.
//    `useEsCandles(true, 1)` — `enabled` is the HARDCODED LITERAL `true`. There
//    is no `handle.visible()`, no `onVisibility`, no `data-visible`, no
//    IntersectionObserver and no enabled gate anywhere in the file. The moment
//    it mounts it holds a socket subscription and re-renders at the feed's 250 ms
//    trailing coalesce — 4 Hz — whether or not a single pixel of it is on
//    screen. Four `useMemo`s re-evaluate and ~20 SVG nodes are diffed four times
//    a second, off-screen, forever.
//
// ── AND IT IS IMPORTED BY NOTHING ────────────────────────────────────────────
// `grep -rn "IbLevelCanvas"` matches only its own file. Nothing on ?tab=ibstats
// renders it; nothing anywhere else does either. EVERY export in this file is
// therefore tagged `@notWiredInV2`. The logic is transcribed so the decision is
// visible; step 3 makes it.
//
// ── WHAT A REVIVAL WOULD HAVE TO FIX, beyond the two non-negotiables ─────────
//   • ES ONLY. `useEsCandles` with no symbol prop, and `/data/ib-ES.json`
//     hardcoded — the NQ tab would show ES levels.
//   • 60m ONLY. `IB_START`/`IB_END` are literals; the window selector is ignored.
//   • IT BLENDS SESSIONS. The IB filter is minute-of-day with NO session-date
//     grouping, unlike `computeLiveSession`, so more than one session in
//     `candles` mixes yesterday's 09:30–10:30 into today's IB. `historyDays = 1`
//     keeps that mostly harmless, not structurally impossible.
//   • ONLY THE HIGH-SIDE 0.25 FIB IS DRAWN. There is no `ibl + 0.25 × width`
//     counterpart, so on a low break the retest line points the wrong way.
//   • THE RAIL SHOWS THE UP LADDER WHENEVER THE MARKET HAS NOT BROKEN DOWN —
//     including an unbroken session.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • The unscoped `@keyframes ibBrokenPulse` injected as an inline `<style>`
//   (`:163`), which also ignores `prefers-reduced-motion`. v3's tokens.css
//   carries the global reduced-motion rule; a keyframe belongs there.
// • The raw `rgba(255,255,255,…)` literals on the midpoint line and its label,
//   and the eleven hex-alpha string concatenations (`${color}1F` and friends).
//   Every one is an `alpha(token, …)` below, with the original suffix recorded
//   in the comment so the value is traceable.
// • `ib.bars` (`:85`) — computed and read by nothing.
//
// Spec: docs/parity/scanner.md Part G, rows G279–G304.
// ─────────────────────────────────────────────────────────────────────────────

import { LIGHT_BLUE, MOVE_DOWN, MOVE_UP, T, alpha } from '@/design/theme'
import { EM_DASH } from '@/pages/scanner/format'
import { etMin, type IbCandle, type IbDataset } from '@/pages/scanner/ibStats'

// ─────────────────────────────────────────────────────────────────────────────
// THE WINDOW — hardcoded 09:30–10:30 in v2 (`:32–33`).
// ─────────────────────────────────────────────────────────────────────────────

/** @notWiredInV2 */
export const LEVEL_IB_START = 570
/** @notWiredInV2 */
export const LEVEL_IB_END = 630

/** @notWiredInV2 Today's IB as this file computes it. */
export interface LevelIb {
  high: number
  low: number
  width: number
  mid: number
  /** The newest candle's close. */
  last: number
  complete: boolean
}

/**
 * @notWiredInV2
 *
 * `ib` (`:72–86`). NOTE the two guards — fewer than TWO bars inside the window,
 * or a non-positive width, and the whole card falls back to its empty state.
 *
 * NOTE ALSO the missing session grouping: this filters purely on minute-of-day.
 * `computeLiveSession` in ibStats.ts groups by ET date first, and that is the
 * correct behaviour; the difference is finding 3 in the header.
 */
export function computeLevelIb(candles: readonly IbCandle[]): LevelIb | null {
  if (!candles.length) return null
  const inIb = candles.filter((c) => {
    const m = etMin(c.timestamp)
    return m >= LEVEL_IB_START && m < LEVEL_IB_END
  })
  if (inIb.length < 2) return null
  const high = Math.max(...inIb.map((c) => c.high))
  const low = Math.min(...inIb.map((c) => c.low))
  const width = high - low
  if (!(width > 0)) return null
  const newest = candles[candles.length - 1]
  if (!newest) return null
  return {
    high,
    low,
    width,
    mid: (high + low) / 2,
    last: newest.close,
    complete: etMin(newest.timestamp) >= LEVEL_IB_END,
  }
}

/**
 * @notWiredInV2 The historical base rates (`:89–101`).
 *
 * EVERY VALUE IS A FRACTION 0–1, not a percentage — every render site multiplies
 * by 100 itself. They are also CONDITIONAL ON A BREAK HAPPENING AT ALL: "of the
 * breaks that occurred, 34.8% reached 1.0×", not "34.8% chance the market goes
 * there today". v2's header says so out loud, deliberately, because a level with
 * a confident-looking percentage beside it is exactly what gets over-trusted.
 */
export interface LevelRates {
  n: number
  h: Record<string, number | null>
  failRate: number | null
  fadeMid: number | null
  fadeOpp: number | null
}

/** @notWiredInV2 */
export function computeLevelRates(ds: IbDataset | null): LevelRates | null {
  if (!ds) return null
  const b = ds.days.filter((d) => d.fcb)
  const r = (k: string): number | null =>
    b.length ? b.filter((d) => d.fcb?.hit[k]).length / b.length : null
  const failed = b.filter((d) => d.fcb?.failed)
  return {
    n: b.length,
    h: { '0.5': r('0.5'), '1': r('1'), '1.5': r('1.5'), '2': r('2') },
    failRate: b.length ? failed.length / b.length : null,
    fadeMid: failed.length ? failed.filter((d) => d.fcb?.fadeMid).length / failed.length : null,
    fadeOpp: failed.length ? failed.filter((d) => d.fcb?.fadeOpp).length / failed.length : null,
  }
}

/** @notWiredInV2 One extension level, priced. */
export interface Lvl {
  mult: number
  side: 'up' | 'down'
  price: number
  /** Points from the live price. Signed. */
  dist: number
  /** The historical reach rate as a FRACTION, or null. */
  prob: number | null
}

/**
 * @notWiredInV2 The eight levels (`:103–113`) — four multiples, both sides.
 * Empty when either input is missing, which is what leaves the ladder bare.
 */
export function computeLevels(ib: LevelIb | null, rates: LevelRates | null): Lvl[] {
  if (!ib || !rates) return []
  const out: Lvl[] = []
  for (const m of [0.5, 1, 1.5, 2]) {
    const up = ib.high + m * ib.width
    const dn = ib.low - m * ib.width
    out.push({ mult: m, side: 'up', price: up, dist: up - ib.last, prob: rates.h[String(m)] ?? null })
    out.push({ mult: m, side: 'down', price: dn, dist: dn - ib.last, prob: rates.h[String(m)] ?? null })
  }
  return out
}

/** @notWiredInV2 Up levels are sorted DESCENDING by multiple, down levels ASCENDING. */
export function splitLevels(levels: readonly Lvl[]): { up: Lvl[]; dn: Lvl[] } {
  return {
    up: levels.filter((l) => l.side === 'up').sort((a, b) => b.mult - a.mult),
    dn: levels.filter((l) => l.side === 'down').sort((a, b) => a.mult - b.mult),
  }
}

/**
 * @notWiredInV2 The extension-level colour ladder (`:207`, `:210`, `:220`,
 * `:223`, `:295–296`) — the only place on this tab where an extension multiple
 * has a colour at all.
 *
 *   mult >= 1.5 → MOVE_DOWN (v2: HOME_THEME.red)
 *   mult >= 1   → T.orange
 *   otherwise   → LIGHT_BLUE
 *
 * It is a DISTANCE ladder, not a directional one: the same colours are used on
 * the down side, where a "red" level is a target below price.
 */
export function levelColor(mult: number): string {
  if (mult >= 1.5) return MOVE_DOWN
  if (mult >= 1) return T.orange
  return LIGHT_BLUE
}

// ─────────────────────────────────────────────────────────────────────────────
// BREAK STATE.
// Spec row G286.
// ─────────────────────────────────────────────────────────────────────────────

/** @notWiredInV2 */
export interface LevelBreakState {
  brokeUp: boolean
  brokeDown: boolean
  /** Whichever printed FIRST, or null. */
  broke: 'up' | 'down' | null
  /** Broke at some point, and price is back between the edges right now. */
  backInside: boolean
}

/**
 * @notWiredInV2 Break detection (`:147–156`).
 *
 * A break is ANY post-IB bar that CLOSED beyond the level, and once a close
 * prints outside the break is real for the rest of the session even if price
 * slips back in. v2's comment records that the previous version read only the
 * last bar and therefore forgot completed breaks — hence the full scan.
 */
export function computeLevelBreak(candles: readonly IbCandle[], ib: LevelIb): LevelBreakState {
  const postIbBars = candles
    .filter((c) => etMin(c.timestamp) >= LEVEL_IB_END)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
  let brokeUp = false
  let brokeDown = false
  let firstBreak: 'up' | 'down' | null = null
  for (const c of postIbBars) {
    if (!brokeUp && c.close > ib.high) {
      brokeUp = true
      firstBreak ??= 'up'
    }
    if (!brokeDown && c.close < ib.low) {
      brokeDown = true
      firstBreak ??= 'down'
    }
  }
  return {
    brokeUp,
    brokeDown,
    broke: firstBreak,
    backInside: firstBreak != null && ib.last <= ib.high && ib.last >= ib.low,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SVG GEOMETRY.
// Spec rows G292, G293. All values are USER UNITS inside the fixed viewBox.
// ─────────────────────────────────────────────────────────────────────────────

/** @notWiredInV2 */
export const LADDER = {
  W: 560,
  H: 460,
  PAD_T: 26,
  PAD_B: 26,
  /**
   * THE VERTICAL HEAD-ROOM FACTOR. The frame spans `high + 2.35×width` down to
   * `low − 2.35×width`, chosen so the 2× extension (at ±2.0 widths) sits inside
   * the frame with margin. Every level is drawn; nothing is clipped by design.
   */
  HEADROOM: 2.35,
  /** Left edge of the IB box and of every extension line. */
  BOX_L: 96,
  /** Right edge of the IB box, and the anchor the price chip is measured from. */
  BOX_R: 300,
  /** Right edge of the extension / midpoint / IB-edge lines. Labels start at +8. */
  LINE_R: 372,
  /** Labels sit 8 to the right of LINE_R, and 4 below the line's y. */
  LABEL_DX: 8,
  LABEL_DY: 4,
  viewBox: '0 0 560 460',
} as const

/** @notWiredInV2 The vertical band the ladder maps prices into. */
export function ladderBounds(ib: LevelIb): { top: number; bot: number } {
  return {
    top: ib.high + LADDER.HEADROOM * ib.width,
    bot: ib.low - LADDER.HEADROOM * ib.width,
  }
}

/**
 * @notWiredInV2 The price → y map (`:134`). A linear map over the usable height,
 * which is `H − PAD_T − PAD_B` = 408 units. Returns a curried function so the
 * bounds are computed once per render rather than per level.
 */
export function priceToY(ib: LevelIb): (p: number) => number {
  const { top, bot } = ladderBounds(ib)
  const usable = LADDER.H - LADDER.PAD_T - LADDER.PAD_B
  return (p: number) => LADDER.PAD_T + ((top - p) / (top - bot)) * usable
}

/** @notWiredInV2 A line to draw, in user units. */
export interface LineSpec {
  x1: number
  y1: number
  x2: number
  y2: number
  stroke: string
  strokeWidth: number
  /** SVG dash pattern, verbatim. */
  dash?: string
  opacity?: number
}

/** @notWiredInV2 A text label to draw, in user units. */
export interface LabelSpec {
  x: number
  y: number
  text: string
  fill: string
  opacity?: number
  /** v2's font weight for this label. Type SIZE is step 3's; the weight is data. */
  weight: 700 | 800
  anchor?: 'middle'
}

/** @notWiredInV2 A rectangle to draw, in user units. */
export interface RectSpec {
  x: number
  y: number
  width: number
  height: number
  rx: number
  fill: string
  stroke?: string
  strokeWidth?: number
}

/** @notWiredInV2 A circle to draw, in user units. */
export interface CircleSpec {
  cx: number
  cy: number
  r: number
  fill: string
  stroke?: string
  strokeWidth?: number
  opacity?: number
}

/** @notWiredInV2 Everything the ladder paints, as data. No JSX, no draw calls. */
export interface LadderDrawing {
  viewBox: string
  /** For the `<svg role="img">`. */
  ariaLabel: string
  lines: LineSpec[]
  labels: LabelSpec[]
  rects: RectSpec[]
  circles: CircleSpec[]
}

/**
 * @notWiredInV2 The extension lines and their labels (`:203–227`).
 *
 * Up labels read `1× (34.8%)`; down labels prefix a U+2212 MINUS: `−1× (…)`.
 * When `prob` is null the parenthesis group is the EMPTY STRING, which leaves
 * `"1× "` with a trailing space — v2's behaviour, kept.
 */
export function extensionLabel(l: Lvl): string {
  const pctPart = l.prob != null ? `(${(100 * l.prob).toFixed(1)}%)` : ''
  return l.side === 'up' ? `${l.mult}× ${pctPart}` : `−${l.mult}× ${pctPart}`
}

/**
 * @notWiredInV2 The whole picture, as draw data.
 *
 * Order matters — it is z-order: extension lines, the IB box, the 0.25 fib, the
 * midpoint, the IB edges, then the price marker on top.
 */
export function buildLadderDrawing(ib: LevelIb, levels: readonly Lvl[]): LadderDrawing {
  const y = priceToY(ib)
  const { up, dn } = splitLevels(levels)
  const lines: LineSpec[] = []
  const labels: LabelSpec[] = []
  const rects: RectSpec[] = []
  const circles: CircleSpec[] = []

  // ── extension lines, above then below. Dash "4 4" at 75% opacity, 1 wide.
  for (const l of [...up, ...dn]) {
    const col = levelColor(l.mult)
    lines.push({
      x1: LADDER.BOX_L,
      y1: y(l.price),
      x2: LADDER.LINE_R,
      y2: y(l.price),
      stroke: col,
      strokeWidth: 1,
      dash: '4 4',
      opacity: 0.75,
    })
    labels.push({
      x: LADDER.LINE_R + LADDER.LABEL_DX,
      y: y(l.price) + LADDER.LABEL_DY,
      text: extensionLabel(l),
      fill: col,
      weight: 700,
    })
  }

  // ── the IB box. Fill is the tab accent at 5% (v2: `${LIGHT_BLUE}0D`, 0x0D/255).
  // `Math.max(2, …)` floors a degenerate box at two units so it never vanishes.
  rects.push({
    x: LADDER.BOX_L,
    y: y(ib.high),
    width: LADDER.BOX_R - LADDER.BOX_L,
    height: Math.max(2, y(ib.low) - y(ib.high)),
    rx: 2,
    fill: alpha(LIGHT_BLUE, 0.05),
    stroke: alpha(T.text, 0.1), // v2: HOME_THEME.border
    strokeWidth: 1,
  })

  // ── the 0.25 fib pullback edge. HIGH SIDE ONLY — there is no low-side twin,
  // so on a low break this line points the wrong way. Dash "2 3", 55% opacity,
  // and it stops at BOX_R rather than running out to LINE_R.
  const fibY = y(ib.high - 0.25 * ib.width)
  lines.push({
    x1: LADDER.BOX_L,
    y1: fibY,
    x2: LADDER.BOX_R,
    y2: fibY,
    stroke: MOVE_UP, // v2: HOME_THEME.green
    strokeWidth: 1,
    dash: '2 3',
    opacity: 0.55,
  })
  labels.push({
    x: LADDER.BOX_L + 4,
    y: fibY - 4,
    text: FIB_LABEL,
    fill: MOVE_UP,
    opacity: 0.85,
    weight: 700,
  })

  // ── midpoint. Both the line and its label are raw white alphas in v2.
  lines.push({
    x1: LADDER.BOX_L,
    y1: y(ib.mid),
    x2: LADDER.LINE_R,
    y2: y(ib.mid),
    stroke: alpha(T.text, 0.35),
    strokeWidth: 1,
    dash: '5 5',
  })
  labels.push({
    x: LADDER.LINE_R + LADDER.LABEL_DX,
    y: y(ib.mid) + LADDER.LABEL_DY,
    text: 'MIDPOINT',
    fill: alpha(T.text, 0.6),
    weight: 700,
  })

  // ── the IB edges. NOTE the two edges are the tab ACCENT and the WARN colour —
  // neither carries a directional meaning, which is inconsistent with every
  // other surface in this part, where high = up-colour and low = down-colour.
  // Transcribed as written; step 3 decides whether to make them directional.
  lines.push({
    x1: LADDER.BOX_L,
    y1: y(ib.high),
    x2: LADDER.LINE_R,
    y2: y(ib.high),
    stroke: LIGHT_BLUE,
    strokeWidth: 2.5,
  })
  labels.push({
    x: LADDER.LINE_R + LADDER.LABEL_DX,
    y: y(ib.high) + LADDER.LABEL_DY,
    text: 'IB HIGH',
    fill: LIGHT_BLUE,
    weight: 800,
  })
  lines.push({
    x1: LADDER.BOX_L,
    y1: y(ib.low),
    x2: LADDER.LINE_R,
    y2: y(ib.low),
    stroke: T.orange,
    strokeWidth: 2.5,
  })
  labels.push({
    x: LADDER.LINE_R + LADDER.LABEL_DX,
    y: y(ib.low) + LADDER.LABEL_DY,
    text: 'IB LOW',
    fill: T.orange,
    weight: 800,
  })

  // ── the live price marker (`:254–270`). Coloured against the MIDPOINT, not
  // against the previous close. The x values are written in v2 as offsets from
  // BOX_R: −40 (dot), −118 (leader start), −124 (chip), −72 (chip text centre).
  // Nothing collision-avoids: the chip can overlap the IB HIGH line.
  const pxColor = ib.last >= ib.mid ? MOVE_UP : MOVE_DOWN
  const py = y(ib.last)
  circles.push({ cx: LADDER.BOX_R - 40, cy: py, r: 4, fill: pxColor })
  circles.push({
    cx: LADDER.BOX_R - 40,
    cy: py,
    r: 7,
    fill: 'none',
    stroke: pxColor,
    strokeWidth: 1,
    opacity: 0.35,
  })
  lines.push({
    x1: LADDER.BOX_R - 118,
    y1: py,
    x2: LADDER.BOX_R - 40,
    y2: py,
    stroke: pxColor,
    strokeWidth: 1,
    dash: '3 3',
    opacity: 0.5,
  })
  rects.push({
    x: LADDER.BOX_R - 124,
    y: py - 30,
    width: 104,
    height: 22,
    rx: 7,
    fill: alpha(T.panel, 0.72), // v2: HOME_THEME.panelBgStrong
    stroke: alpha(pxColor, 0.35), // v2: `${pxColor}59`
    strokeWidth: 1,
  })
  labels.push({
    x: LADDER.BOX_R - 72,
    y: py - 15,
    text: ib.last.toFixed(2),
    fill: pxColor,
    weight: 800,
    anchor: 'middle',
  })

  return {
    viewBox: LADDER.viewBox,
    ariaLabel: `ES initial balance ladder. IB high ${ib.high.toFixed(2)}, low ${ib.low.toFixed(2)}, last ${ib.last.toFixed(2)}.`,
    lines,
    labels,
    rects,
    circles,
  }
}

/** @notWiredInV2 */
export const FIB_LABEL = '0.25 fib — pullback entry'

// ─────────────────────────────────────────────────────────────────────────────
// THE STATUS PILLS.
// Spec rows G287–G291. All eight hex-alpha suffixes are recorded in the
// comments; the values here are `alpha(token, …)`.
// ─────────────────────────────────────────────────────────────────────────────

/** @notWiredInV2 */
export interface PillSpec {
  text: string
  /** A leading glyph, where v2 draws one. */
  glyph?: string
  color: string
  background: string
  border: string
  /** True only on a live break that has NOT come back inside. */
  pulse?: boolean
}

/**
 * @notWiredInV2 The three-or-four pills above the ladder (`:166–197`).
 *
 * The break pill PULSES (`ibBrokenPulse 1.1s ease-in-out infinite`) unless price
 * is back inside. The animation ignores `prefers-reduced-motion`; v3's tokens.css
 * carries the global rule, so a revival gets that for free and must not
 * re-inject the keyframe.
 */
export function statusPills(ib: LevelIb, brk: LevelBreakState): PillSpec[] {
  const out: PillSpec[] = []
  if (brk.broke) {
    const c = brk.broke === 'up' ? MOVE_UP : MOVE_DOWN
    out.push({
      text: `IB ${brk.broke === 'up' ? 'HIGH' : 'LOW'} BROKEN${brk.backInside ? ' · BACK INSIDE' : ''}`,
      glyph: brk.broke === 'up' ? '▲' : '▼',
      color: c,
      background: alpha(c, 0.12), // v2: `${c}1F`
      border: alpha(c, 0.4), // v2: `${c}66`
      pulse: !brk.backInside,
    })
  } else {
    out.push({
      text: 'IB UNBROKEN',
      color: LIGHT_BLUE,
      background: alpha(LIGHT_BLUE, 0.09), // v2: `${LIGHT_BLUE}17`
      border: alpha(LIGHT_BLUE, 0.27), // v2: `${LIGHT_BLUE}44`
    })
  }
  out.push(
    ib.complete
      ? {
          text: 'IB DONE',
          color: MOVE_UP,
          background: alpha(MOVE_UP, 0.08), // v2: `${green}14`
          border: alpha(MOVE_UP, 0.27), // v2: `${green}44`
        }
      : {
          text: 'IB FORMING',
          color: T.orange,
          background: alpha(T.orange, 0.09), // v2: `${orange}17`
          border: alpha(T.orange, 0.33), // v2: `${orange}55`
        },
  )
  if (ib.complete) {
    out.push({
      text: 'LOCKED',
      glyph: '🔒',
      color: LIGHT_BLUE,
      background: alpha(LIGHT_BLUE, 0.07), // v2: `${LIGHT_BLUE}12`
      border: alpha(LIGHT_BLUE, 0.23), // v2: `${LIGHT_BLUE}3B`
    })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// THE LEVEL RAIL AND THE FAIL PANEL.
// Spec rows G302–G304.
// ─────────────────────────────────────────────────────────────────────────────

/** @notWiredInV2 */
export interface RailRow {
  key: string
  label: string
  price: string
  /** Signed, two decimals, with an explicit "+" on non-negatives. */
  dist: string
  /** SIGN-based, not direction-based — see the note on `railRows`. */
  distColor: string
  prob: string
  probColor: string
  probBackground: string
}

/**
 * @notWiredInV2 The rail (`:274–303`).
 *
 * WHICH LADDER IT SHOWS: `broke === "down" ? dn : up` — so it shows the UP
 * ladder whenever the market has not broken DOWN, including an unbroken session.
 * And because `up` is sorted descending and `dn` ascending, the rail reads
 * 2×→0.5× on an up/unbroken day and 0.5×→2× on a down day.
 *
 * THE DISTANCE COLOUR IS SIGN-BASED: on a down ladder every level is below price,
 * so every distance is negative and every row paints the warn colour.
 */
export function railRows(levels: readonly Lvl[], broke: 'up' | 'down' | null): RailRow[] {
  const { up, dn } = splitLevels(levels)
  return (broke === 'down' ? dn : up).map((l) => {
    const col = levelColor(l.mult)
    return {
      key: `${l.side}${l.mult}`,
      label: `${l.mult}× extension`,
      price: l.price.toFixed(2),
      dist: `${l.dist >= 0 ? '+' : ''}${l.dist.toFixed(2)}`,
      distColor: l.dist >= 0 ? LIGHT_BLUE : T.orange,
      prob: l.prob != null ? `${(100 * l.prob).toFixed(1)}%` : EM_DASH,
      probColor: col,
      probBackground: alpha(col, 0.13), // v2: `${col}22`
    }
  })
}

/** @notWiredInV2 The rail header (`:275–282`). */
export function railHeader(broke: 'up' | 'down' | null, connected: boolean): {
  title: string
  status: string
  statusColor: string
} {
  return {
    title: `Targets — ${broke === 'up' ? 'upside live' : broke === 'down' ? 'downside live' : 'unbroken'}`,
    status: connected ? 'LIVE' : 'STALE',
    statusColor: connected ? MOVE_UP : MOVE_DOWN,
  }
}

/**
 * @notWiredInV2 The "If the break fails" panel (`:305–328`).
 *
 * When `failRate` is null the lead-in sentence is the EMPTY STRING and the two
 * stat tiles still render — orphaned under a heading with no lead-in. Ported as
 * written.
 */
export function failPanel(rates: LevelRates): {
  heading: string
  lead: string
  midLabel: string
  midValue: string
  midColor: string
  oppLabel: string
  oppValue: string
  oppColor: string
} {
  return {
    heading: 'If the break fails',
    lead:
      rates.failRate != null
        ? `${(100 * rates.failRate).toFixed(1)}% of breaks close back inside within 30 minutes. Of those:`
        : '',
    midLabel: 'Reach the mid',
    midValue: rates.fadeMid != null ? `${(100 * rates.fadeMid).toFixed(1)}%` : EM_DASH,
    midColor: MOVE_UP,
    oppLabel: 'Full rotation',
    oppValue: rates.fadeOpp != null ? `${(100 * rates.fadeOpp).toFixed(1)}%` : EM_DASH,
    oppColor: MOVE_DOWN,
  }
}

/** @notWiredInV2 The card chrome (`:115–125`, `:159–162`). */
export const LEVEL_CARD_TEXT = {
  title: 'Live IB state',
  emptySubtitle: "Today's Initial Balance, priced",
  /** The empty-state body still calls it a canvas. It is an SVG. */
  emptyConnected:
    'Waiting for the 09:30–10:30 ET bars. The canvas builds itself as the Initial Balance forms.',
  emptyDisconnected: 'Not connected to the ES candle feed.',
  subtitle: (ib: LevelIb): string =>
    `ES · IB ${ib.low.toFixed(2)}–${ib.high.toFixed(2)} · width ${ib.width.toFixed(2)} pts${ib.complete ? '' : ' · still forming'}`,
} as const
