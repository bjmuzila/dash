// ─────────────────────────────────────────────────────────────────────────────
// THE TPO LETTER PROFILE — GEOMETRY ONLY. NOTHING HERE PAINTS.
//
// Transcribed 1:1 from v2's `components/pages/Scanner.tsx:2267–2649`
// (`TpoLetterProfile`) against the checklist in docs/parity/scanner.md Part F,
// rows F35–F88.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ READ THIS BEFORE MOUNTING ANYTHING. Two of v3's non-negotiables exist     │
// │ because of the v2 version of this component, and step 3 owns both:        │
// │                                                                           │
// │  • #6 — TAG THE CANVAS. v2's `<canvas>` (Scanner.tsx:2586) carries NO     │
// │    `data-cb-layer`, so it is invisible to the layer audit. Every canvas   │
// │    this plan is painted into must be tagged.                             │
// │  • #5 — HONOUR ONE VISIBILITY SIGNAL. v2's draw effect re-runs on all     │
// │    twelve of its deps — and `spot` is one of them — with NO visibility    │
// │    guard whatsoever. `spot` is the last bar's close, so the entire        │
// │    several-thousand-cell canvas repaints on every new bar whether or not  │
// │    the card is on screen, whether or not the tab is even the visible one. │
// │    Step 3 MUST mount through `ChartFrame` and gate the paint on the one   │
// │    visibility signal (`handle.visible()` / `onVisibility`).               │
// │                                                                           │
// │ Everything below is a PURE FUNCTION returning DRAW INSTRUCTIONS. There    │
// │ are no canvas calls, no refs, no effects and no JSX in this file, and     │
// │ every function is cheap enough to call inside a guarded frame: the plan   │
// │ is built from arithmetic over the already-memoised sessions, and the      │
// │ off-screen culling (`vis`, the session-window test) happens HERE, so a    │
// │ panned-away session costs nothing to skip.                                │
// └───────────────────────────────────────────────────────────────────────────┘
//
// WHY A CANVAS AT ALL. Five sessions × ~14 periods × ~60 bins is several
// thousand cells. That many DOM nodes re-rendering on a socket tick is the
// main-thread stall that froze this tab before, and it is why the profile is
// painted rather than laid out. The plan below is the boundary: geometry is
// testable and pure, painting is a loop over arrays.
//
// FOUR PIECES OF GEOMETRY THAT ARE NOT OBVIOUS FROM THE SCREEN:
//
//   1. ONE SHARED PRICE AXIS ACROSS THE WHOLE STRIP. `lo` and `hi` are the min
//      and max over EVERY drawn session, so profiles are directly comparable
//      left to right and a 30-day window is genuinely a year of price range
//      tall. That is also why the anchor pass exists — at `ox/oy = 0` the view
//      opens on the OLDEST profile with spot nowhere on screen.
//   2. COLLAPSED vs SPLIT IS ONE TERM IN ONE EXPRESSION. `cx = x + (split ? pi :
//      i) * cw` — collapsed packs a bin's letters left by ARRAY ORDER, split
//      parks each letter in the column of ITS OWN PERIOD. Split leaves gaps, and
//      the gaps are the point: they are the auction's development through TIME,
//      which is the entire reason Steidlmayer used letters instead of bars.
//   3. THE GRIDLINES ARE DRAWN OUTSIDE THE CLIP, i.e. ON TOP of the letters.
//      Not an accident of ordering to tidy up — the axis must never scroll away
//      under a pan, so it is painted after `restore()` along with the opaque
//      gutter plate that hides panned content behind it.
//   4. THE ANCHOR PASS RETURNS BEFORE DRAWING. When the offsets need to move,
//      v2 sets state and bails; the state change re-runs the effect and the real
//      paint happens on the next pass. One deliberately dropped frame. Here that
//      is `anchorOffsets` returning a target the caller applies before asking
//      for a plan — same behaviour, no hidden early return inside a draw.
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// `btn()`'s colour ternary (`Scanner.tsx:2565`) is
// `active ? HOME_THEME.text : HOME_THEME.text` — both branches identical, a
// no-op. It is not carried across; the active state is marked by border and fill
// only, which is all it ever did. Spec "Do not port" 14.
//
// ── A NOTE ON THE NUMBERS IN THIS FILE ───────────────────────────────────────
// v3 forbids naming px sizes and type sizes in a page module. A CANVAS CANNOT
// INHERIT A CSS TYPE SCALE — `ctx.font` takes a string and a fill takes device
// pixels — so the canvas glyph metrics below are unavoidable and are collected
// in `TPO_CANVAS_TEXT` rather than scattered through the plan builders. They are
// canvas drawing metrics, not the page's type scale, and step 3 still owns every
// DOM size on this card (the toolbar, the legend, the hover card's typography).
// The letter size itself is DERIVED from cell size, not chosen.
//
// Spec: docs/parity/scanner.md Part F, rows F35–F88.
// ─────────────────────────────────────────────────────────────────────────────

import { alpha, LIGHT_BLUE, T, tokenHex, tokenHexAlpha } from '@/design/theme'
import {
  KIND_COLOR_VAR_NAME,
  KIND_LABEL,
  KIND_NOTE,
  KIND_TITLE,
  KIND_ORDER,
  POC_COLOR_VAR_NAME,
  type StructureKind,
} from '@/pages/scanner/tpoTaxonomy'
import { priceBand, type TpoSession, type TpoStructure } from '@/pages/scanner/tpoStructures'

// ── FIXED GEOMETRY ───────────────────────────────────────────────────────────

/**
 * 36 glyphs: A–Z then 0–9. Period 26 wraps to `"0"` and period 36 back to
 * `"A"` — an RTH session is 13 periods, so the wrap is only reachable on a
 * malformed bar set, but the modulo is what stops it throwing.
 */
export const TPO_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/** Periods 0 and 1 — 09:30 and 10:00 — are the Initial Balance. */
export const IB_PERIODS = 2

/** The viewport is a FIXED height and the profile pans and zooms INSIDE it. */
export const VIEW_H = 660

/** Price-gutter width. */
export const AXIS = 58
export const TOP = 14
export const BOT = 26
/** Horizontal gap between two sessions — wide enough for the P/M/H/L leader tags. */
export const GUTTER = 118

/** Fallback when the wrapper reports a zero `clientWidth`. */
export const DEFAULT_WIDTH = 1180

/** Row height is clamped to this band before zoom. `(VIEW_H - TOP - BOT)` = 620. */
export const ROW_H_MIN = 5
export const ROW_H_MAX = 11
export const PLOT_H = VIEW_H - TOP - BOT

export const ZOOM_Y_MIN = 0.4
export const ZOOM_Y_MAX = 8
export const ZOOM_X_MIN = 0.4
export const ZOOM_X_MAX = 6
/** One wheel notch. Zoom out is the exact reciprocal, so a scroll round-trips. */
export const WHEEL_STEP = 1.12
/** One toolbar click. Not the same as a wheel notch. */
export const BUTTON_STEP = 1.25

/** Hit-test pad, all four sides. A 1-pt poor high is ~5 px tall and would
 *  otherwise be un-hoverable. */
export const HIT_PAD = 3

/** Retina is worth it; 3× is four times the fill rate for no visible gain. */
export const DPR_CAP = 2

/** Canvas glyph metrics — see the note in the header. */
export const TPO_CANVAS_TEXT = {
  /** Every price tag, axis label, spot label and open-level label. */
  monoPx: 10,
  monoFamily: 'ui-monospace, monospace',
  /** The session date under each profile. */
  sansPx: 10,
  sansFamily: 'ui-sans-serif, system-ui',
  /** The smallest legible letter; below this the gate hides letters entirely. */
  letterMinPx: 6,
  /** Leader-line lengths, per tag. */
  tagLenPoc: 46,
  tagLenMid: 34,
  tagLenHigh: 26,
  tagLenLow: 26,
} as const

// ── TOOLBAR ──────────────────────────────────────────────────────────────────

/** Every toolbar string, in strip order. U+2212 MINUS SIGN in the two `−`
 *  buttons, not a hyphen — they sit next to `+` and must balance it. */
export const PROFILE_TOOLBAR = {
  collapsed: 'Collapsed',
  split: 'Split / expanded',
  labels: 'Labels',
  priceIn: 'Price +',
  priceOut: 'Price −',
  widthIn: 'Width +',
  widthOut: 'Width −',
  reset: 'Reset',
  hint: 'drag to pan · wheel = price zoom · shift+wheel = width zoom · hover a structure for detail',
} as const

// ── VIEW STATE ───────────────────────────────────────────────────────────────

export interface TpoProfileView {
  /** false = collapsed (histogram); true = each letter in its own period column. */
  split: boolean
  /** Draws the outlined structure band on the NEWEST session only. */
  labels: boolean
  /** Horizontal zoom — cell width. */
  zx: number
  /** Vertical zoom — price resolution. */
  zy: number
  /** Pan offsets, px. */
  ox: number
  oy: number
}

/**
 * `split` starts false and `labels` starts TRUE. The labels toggle controls ONLY
 * the outlined band on the newest session — the 3 px spine beside every session
 * and the hover card are unaffected by it.
 */
export const TPO_PROFILE_VIEW_DEFAULT: TpoProfileView = {
  split: false,
  labels: true,
  zx: 1,
  zy: 1,
  ox: 0,
  oy: 0,
}

/**
 * Reset restores the default view AND re-anchors — it does not merely zero the
 * offsets. A "Reset" that leaves you on a 30-day-old profile is not a reset,
 * which is why `anchorOffsets` must be applied after this.
 */
export function resetView(): TpoProfileView {
  return { ...TPO_PROFILE_VIEW_DEFAULT }
}

/** Toolbar zoom steps, already clamped. */
export const zoomPriceIn = (zy: number) => Math.min(ZOOM_Y_MAX, zy * BUTTON_STEP)
export const zoomPriceOut = (zy: number) => Math.max(ZOOM_Y_MIN, zy / BUTTON_STEP)
export const zoomWidthIn = (zx: number) => Math.min(ZOOM_X_MAX, zx * BUTTON_STEP)
export const zoomWidthOut = (zx: number) => Math.max(ZOOM_X_MIN, zx / BUTTON_STEP)

// ── PALETTE ──────────────────────────────────────────────────────────────────

/**
 * A canvas needs RESOLVED colour strings — `ctx.fillStyle = 'var(--color-warn)'`
 * does not throw, it silently keeps the previous fill. `tokenHex()` reads the
 * token out of the stylesheet behind a cache, so the token stays the single
 * source of truth and no hex is typed here.
 *
 * CALL THIS AT MOUNT, NOT PER FRAME. Each read is a `getComputedStyle` behind a
 * cache; resolving a palette inside a draw loop is layout work sixty times a
 * second for values that never change.
 */
export interface TpoPalette {
  /** Canvas ground, and the opaque price-gutter plate painted over it. */
  bg: string
  /** POC letter cell and the `P:` tag. v2 used amber #F2A93B on the canvas and a
   *  different orange in the DOM for the same idea; collapsed onto one token. */
  pocFill: string
  /** Ink on the POC cell. v2's #3d2405 was a hand-picked dark brown; the
   *  palette's darkest ground does the same job and is already a token — the
   *  same reasoning v3 uses for ink on a solid level tag. */
  pocInk: string
  /** Initial-Balance letter cell (periods 0–1). */
  ibFill: string
  ibInk: string
  /** Every later period's cell. A blue distinct from the naked-POC blue so the
   *  letter grid never reads as a level. */
  periodFill: string
  periodInk: string
  /** The 70% value-area wash behind each profile. */
  vaWash: string
  /** Axis gridlines, drawn on top of the letters. */
  gridline: string
  /** Axis price labels and the session date labels. */
  axisLabel: string
  /** The `H:` and `L:` session tags. */
  extremeTag: string
  /** The `M:` range-midpoint tag. */
  midTag: string
  /** The spot dashed line and its label. */
  spot: string
  /** Per-kind spine, dashed open-level line and callout stroke. */
  kind: Record<StructureKind, string>
  /** The same, at the callout band's fill alpha. */
  kindBandFill: Record<StructureKind, string>
}

/** The callout band's fill — v2's `${color}1F` hex-suffix, which cannot survive
 *  the move to a `var()` string and becomes a real alpha here. */
export const BAND_FILL_ALPHA = 0.12
/** The dashed open-level lines are drawn at half opacity; their labels are not. */
export const OPEN_LEVEL_LINE_ALPHA = 0.5
/** The value-area wash. 5.5% white. */
export const VA_WASH_ALPHA = 0.055
export const GRIDLINE_ALPHA = 0.05
export const AXIS_LABEL_ALPHA = 0.9
/** v2's `rgba(140,190,235,0.8)` for the H/L tags — near enough to the tab's own
 *  light blue that the two collapse. */
export const EXTREME_TAG_ALPHA = 0.8

export function resolveTpoPalette(): TpoPalette {
  const kind = {} as Record<StructureKind, string>
  const kindBandFill = {} as Record<StructureKind, string>
  for (const k of KIND_ORDER) {
    const name = KIND_COLOR_VAR_NAME[k]
    kind[k] = tokenHex(name)
    kindBandFill[k] = tokenHexAlpha(name, BAND_FILL_ALPHA)
  }
  return {
    bg: tokenHex('--color-bg'),
    pocFill: tokenHex(POC_COLOR_VAR_NAME),
    pocInk: tokenHex('--color-app'),
    ibFill: tokenHex('--color-down'),
    ibInk: tokenHex('--color-fg'),
    periodFill: tokenHex('--color-accent'),
    periodInk: tokenHex('--color-app'),
    vaWash: tokenHexAlpha('--color-fg', VA_WASH_ALPHA),
    gridline: tokenHexAlpha('--color-fg', GRIDLINE_ALPHA),
    axisLabel: tokenHexAlpha('--color-fg', AXIS_LABEL_ALPHA),
    extremeTag: tokenHexAlpha('--color-series-5', EXTREME_TAG_ALPHA),
    midTag: tokenHex('--color-down'),
    // "You are here" is neither a direction nor chrome. v2 painted it
    // HOME_THEME.green — the value that also painted every card subtitle — which
    // says "price is up" on a line that means no such thing. Full-weight ink.
    spot: tokenHex('--color-fg'),
    kind,
    kindBandFill,
  }
}

/** The DOM-side equivalents, for the hover card's border and tint. */
export const HOVER_CARD_TINT_ALPHA = 0.1
export const hoverCardTint = (color: string) => alpha(color, HOVER_CARD_TINT_ALPHA)
/** The tab's light blue, re-exported so the toolbar and hover chrome do not
 *  reach past this module for the one accent they need. */
export const PROFILE_ACCENT = LIGHT_BLUE
export const PROFILE_INK = T.text

// ── GEOMETRY ─────────────────────────────────────────────────────────────────

export interface TpoGeometry {
  /** Lowest low and highest high across EVERY drawn session — one shared axis. */
  lo: number
  hi: number
  /** Bin rows spanning the domain. At least 1. */
  rows: number
  /** Unzoomed row height, clamped to [5, 11]. */
  baseRh: number
  /** Row height in px, after vertical zoom. */
  rh: number
  /** Cell width in px, after horizontal zoom. Floored at 4. */
  cw: number
  /** Viewport width in CSS px. */
  w: number
  binSize: number
  /** Price → y, including the pan offset. */
  y: (price: number) => number
  /** Is this y inside the viewport, allowing one row of overhang either side? */
  vis: (py: number) => boolean
  /** Row step that puts an axis label roughly every 28 px. */
  stepBins: number
}

/**
 * The whole coordinate system, or null when there is nothing to draw.
 *
 * `baseRh = clamp(620 / rows, 5, 11)` — the profile tries to fit the domain in
 * the viewport and gives up at both ends: below 5 px a row is unreadable, above
 * 11 px a quiet day would be absurdly tall. Beyond that band the view pans.
 *
 * `cw = max(4, (baseRh - 0.5) * zx)` — cell width tracks the UNZOOMED row height,
 * so vertical zoom does not stretch letters sideways. The `-0.5` is what makes a
 * default cell very slightly wider than tall, which is what a TPO letter wants.
 *
 * Returns null when there are no sessions or when the price domain is degenerate
 * (`hi <= lo`), which is v2's `if (!(hi > lo)) return` — an early bail that
 * leaves the PREVIOUS frame on screen rather than clearing it.
 */
export function tpoGeometry(
  sessions: readonly TpoSession[],
  binSize: number,
  view: TpoProfileView,
  width: number,
): TpoGeometry | null {
  if (!sessions.length) return null
  const lo = Math.min(...sessions.map((d) => d.low))
  const hi = Math.max(...sessions.map((d) => d.high))
  if (!(hi > lo)) return null

  const rows = Math.max(1, Math.round((hi - lo) / binSize))
  const baseRh = Math.max(ROW_H_MIN, Math.min(ROW_H_MAX, PLOT_H / rows))
  const rh = baseRh * view.zy
  const cw = Math.max(4, (baseRh - 0.5) * view.zx)

  const y = (p: number) => TOP + view.oy + ((hi - p) / binSize) * rh
  const vis = (py: number) => py > TOP - rh && py < VIEW_H - BOT + rh

  return {
    lo,
    hi,
    rows,
    baseRh,
    rh,
    cw,
    w: width,
    binSize,
    y,
    vis,
    stepBins: Math.max(1, Math.round(28 / rh)),
  }
}

/** How many columns a session occupies. Split = one per PERIOD; collapsed = one
 *  per TPO at the POC, i.e. the widest bin. `|| 1` guards a zero maxCount. */
export function sessionColumns(d: TpoSession, split: boolean): number {
  return split ? d.periods : d.maxCount || 1
}

/** DPR, capped. Guarded so the module stays importable without a window. */
export function deviceDpr(): number {
  if (typeof window === 'undefined') return 1
  return Math.min(DPR_CAP, window.devicePixelRatio || 1)
}

/** Backing-store size and the transform that maps CSS px onto it. */
export function canvasBacking(width: number, dpr = deviceDpr()) {
  return {
    backingWidth: width * dpr,
    backingHeight: VIEW_H * dpr,
    cssHeight: VIEW_H,
    /** `setTransform(dpr, 0, 0, dpr, 0, 0)` — everything below is CSS px. */
    transform: [dpr, 0, 0, dpr, 0, 0] as const,
  }
}

/**
 * Where the view should jump to on mount, on a session-count change and on
 * Reset.
 *
 * X puts the RIGHT edge of the strip — the NEWEST session — at the right edge of
 * the viewport; `Math.min(0, …)` stops a short strip from scrolling past its own
 * start. Y centres spot vertically, or leaves the offset at 0 when spot is
 * unknown.
 *
 * The caller applies these only when either moves by more than half a pixel;
 * below that the view is already anchored and re-committing it would be a
 * pointless render. See header note 4.
 */
export function anchorOffsets(
  sessions: readonly TpoSession[],
  geom: TpoGeometry,
  view: TpoProfileView,
  spot: number | null,
): { ox: number; oy: number; changed: boolean } {
  const totalW = sessions.reduce(
    (a, d) => a + sessionColumns(d, view.split) * geom.cw + GUTTER,
    0,
  )
  const ox = Math.min(0, geom.w - AXIS - 10 - totalW)
  const oy =
    spot != null ? VIEW_H / 2 - TOP - ((geom.hi - spot) / geom.binSize) * geom.rh : 0
  return {
    ox,
    oy,
    changed: Math.abs(ox - view.ox) > 0.5 || Math.abs(oy - view.oy) > 0.5,
  }
}

/**
 * Cursor-anchored wheel zoom. Shift zooms WIDTH, otherwise PRICE.
 *
 * The offset is re-solved as `o' = m - ((m - o) * nz) / z` so the price under
 * the pointer stays exactly where it was — that is what makes the zoom feel
 * attached to the cursor rather than to the viewport centre.
 *
 * v2 registers this as a NATIVE listener with `{passive: false}` rather than via
 * React's `onWheel`, because the synthetic wheel handler is passive and
 * `preventDefault()` there is a no-op — the page scrolls instead of the chart
 * zooming. Step 3 must keep the native registration.
 */
export function wheelZoom(
  view: TpoProfileView,
  deltaY: number,
  shiftKey: boolean,
  mx: number,
  my: number,
): TpoProfileView {
  const k = deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP
  if (shiftKey) {
    const nz = Math.max(ZOOM_X_MIN, Math.min(ZOOM_X_MAX, view.zx * k))
    return { ...view, zx: nz, ox: mx - ((mx - view.ox) * nz) / view.zx }
  }
  const nz = Math.max(ZOOM_Y_MIN, Math.min(ZOOM_Y_MAX, view.zy * k))
  return { ...view, zy: nz, oy: my - ((my - view.oy) * nz) / view.zy }
}

// ── THE DRAW PLAN ────────────────────────────────────────────────────────────

export interface RectDraw {
  x: number
  y: number
  w: number
  h: number
  fill: string
}

export interface CellDraw {
  x: number
  y: number
  w: number
  h: number
  fill: string
  /** null below the visibility gate — the cell is an anonymous coloured box. */
  letter: string | null
  ink: string
  /** Centre of the cell, where the glyph is drawn (baseline middle, align centre). */
  textX: number
  textY: number
  /** Derived from cell size; see `letterFontPx`. */
  fontPx: number
}

export interface TagDraw {
  /** Leader line, left to right. */
  x0: number
  x1: number
  y: number
  /** Label origin, left-aligned, baseline middle. */
  labelX: number
  label: string
  color: string
}

export interface BandDraw {
  x: number
  y: number
  w: number
  h: number
  radius: number
  stroke: string
  fill: string
  lineWidth: number
}

export interface LineDraw {
  x0: number
  x1: number
  y: number
  color: string
  /** `[5, 4]` for every dashed line here; empty for solid. */
  dash: readonly number[]
  alpha: number
  lineWidth: number
}

export interface TextDraw {
  x: number
  y: number
  text: string
  color: string
  align: 'left' | 'right' | 'center'
  baseline: 'top' | 'middle' | 'bottom' | 'alphabetic'
  fontPx: number
  fontFamily: string
  bold?: boolean
}

export interface HitRegion {
  structure: TpoStructure
  color: string
  x0: number
  x1: number
  yTop: number
  yBot: number
}

export interface TpoDrawPlan {
  /** Everything from the first session to the open-level labels is clipped to
   *  this, so a pan never puts content on the price gutter. */
  clip: { x: number; y: number; w: number; h: number }
  /** Painted first, under everything, inside the clip. */
  vaWashes: RectDraw[]
  cells: CellDraw[]
  /** P → M → H → L, in that order: later tags paint over earlier ones where
   *  prices coincide. */
  tags: TagDraw[]
  /** The 3 px kind-coloured bar in the 6 px gutter left of each profile. Naked
   *  POCs are EXCLUDED from the spine entirely — they are drawn as dashed lines
   *  across the strip instead. */
  spines: RectDraw[]
  /** The outlined structure box, NEWEST SESSION ONLY, and only when `labels`. */
  bands: BandDraw[]
  /** `MM-DD` under each drawn profile. */
  dateLabels: TextDraw[]
  spotLine: LineDraw | null
  spotLabel: TextDraw | null
  openLevelLines: LineDraw[]
  openLevelLabels: TextDraw[]
  /** Drawn AFTER the clip is released, so they sit ON TOP of the letters. */
  gutterPlate: RectDraw
  gridlines: LineDraw[]
  axisLabels: TextDraw[]
  /**
   * Collected for EVERY drawn session — hover works on all of them, even though
   * the outlined band is painted only on the newest. Store this in a REF, not in
   * state: hovering must not re-run the draw.
   */
  hits: HitRegion[]
}

/**
 * The letter's font size, DERIVED: `max(6, floor(min(rh, cw) - 1.5))`. It is a
 * function of the cell, not a typographic choice.
 */
export function letterFontPx(rh: number, cw: number): number {
  return Math.max(TPO_CANVAS_TEXT.letterMinPx, Math.floor(Math.min(rh, cw) - 1.5))
}

/**
 * THE LETTER VISIBILITY GATE. Below `rh >= 7 && cw >= 6` the letters are not
 * drawn at all and the cells are anonymous coloured boxes.
 *
 * This is not a nicety: at a 30-session window the rows are at their 5 px floor
 * and a glyph in a 5 px box is noise that costs several thousand `fillText`
 * calls. The colour still carries the IB / later-period / POC distinction, which
 * is the information that survives at that size.
 */
export function lettersVisible(rh: number, cw: number): boolean {
  return rh >= 7 && cw >= 6
}

/**
 * Build the complete draw plan. Pure — arithmetic and array building only.
 *
 * Sessions are laid out left to right OLDEST FIRST, because `res.sessions` is
 * date-ascending. A session outside the viewport contributes NOTHING to the plan
 * but still advances `x`, so the strip's geometry does not change when you pan.
 */
export function buildProfilePlan(
  sessions: readonly TpoSession[],
  geom: TpoGeometry,
  view: TpoProfileView,
  spot: number | null,
  levels: readonly TpoStructure[],
  palette: TpoPalette,
): TpoDrawPlan {
  const { rh, cw, w, y, vis } = geom
  const plan: TpoDrawPlan = {
    clip: { x: AXIS, y: 0, w: w - AXIS, h: VIEW_H - BOT + 14 },
    vaWashes: [],
    cells: [],
    tags: [],
    spines: [],
    bands: [],
    dateLabels: [],
    spotLine: null,
    spotLabel: null,
    openLevelLines: [],
    openLevelLabels: [],
    gutterPlate: { x: 0, y: 0, w: AXIS, h: VIEW_H, fill: palette.bg },
    gridlines: [],
    axisLabels: [],
    hits: [],
  }

  const fontPx = letterFontPx(rh, cw)
  const showLetters = lettersVisible(rh, cw)
  const lastDate = sessions[sessions.length - 1]?.date

  interface Callout {
    s: TpoStructure
    color: string
    yTop: number
    yBot: number
    x0: number
    x1: number
    today: boolean
  }
  const callouts: Callout[] = []

  let x = AXIS + 10 + view.ox

  for (const d of sessions) {
    const cols = sessionColumns(d, view.split)
    const wid = cols * cw

    // Session culling. An off-screen session draws nothing but still advances x.
    if (x + wid + GUTTER > 0 && x < w) {
      // ── the 70% value area wash, VAH→VAL ──────────────────────────────────
      if (vis(y(d.vah)) || vis(y(d.val))) {
        plan.vaWashes.push({
          x: x - 3,
          y: y(d.vah) - rh / 2,
          w: wid + 8,
          h: y(d.val) - y(d.vah) + rh,
          fill: palette.vaWash,
        })
      }

      // ── letter cells ──────────────────────────────────────────────────────
      for (const b of d.bins) {
        const cy = y(b.price)
        if (!vis(cy)) continue
        b.periods.forEach((pi, i) => {
          const cx = x + (view.split ? pi : i) * cw
          // THREE BRANCHES, IN THIS ORDER, AND THE ORDER IS THE RULE:
          //   1. on the POC row  → POC colour. This wins over the IB test, so an
          //      IB letter sitting on the POC is POC-coloured, never IB-coloured.
          //   2. pi < 2          → Initial Balance.
          //   3. everything else → a later period.
          let fill: string
          let ink: string
          if (Math.abs(b.price - d.poc) < 1e-9) {
            fill = palette.pocFill
            ink = palette.pocInk
          } else if (pi < IB_PERIODS) {
            fill = palette.ibFill
            ink = palette.ibInk
          } else {
            fill = palette.periodFill
            ink = palette.periodInk
          }
          const cellW = cw - 1.2
          plan.cells.push({
            x: cx,
            y: cy - rh / 2 + 0.5,
            w: cellW,
            h: rh - 1,
            fill,
            ink,
            letter: showLetters ? (TPO_LETTERS[pi % TPO_LETTERS.length] ?? null) : null,
            textX: cx + cellW / 2,
            textY: cy,
            fontPx,
          })
        })
      }

      // ── P / M / H / L leader tags, off the right edge of the profile ───────
      const tag = (price: number, color: string, label: string, len: number) => {
        if (!vis(y(price))) return
        plan.tags.push({
          x0: x + wid + 4,
          x1: x + wid + len,
          y: y(price),
          labelX: x + wid + len + 4,
          label,
          color,
        })
      }
      tag(d.poc, palette.pocFill, `P: ${d.poc.toFixed(2)}`, TPO_CANVAS_TEXT.tagLenPoc)
      // `M` is the RANGE midpoint `(high + low) / 2`, NOT the POC. Two different
      // "middles", and the leader lengths keep them from overlapping.
      tag(d.mid, palette.midTag, `M: ${d.mid.toFixed(2)}`, TPO_CANVAS_TEXT.tagLenMid)
      tag(d.high, palette.extremeTag, `H: ${d.high.toFixed(2)}`, TPO_CANVAS_TEXT.tagLenHigh)
      tag(d.low, palette.extremeTag, `L: ${d.low.toFixed(2)}`, TPO_CANVAS_TEXT.tagLenLow)

      // ── structure spines + hover callouts ─────────────────────────────────
      for (const s of d.structures) {
        if (s.kind === 'naked_poc') continue
        const color = palette.kind[s.kind]
        plan.spines.push({
          x: x - 6,
          y: y(s.priceHi) - rh / 2,
          w: 3,
          h: y(s.priceLo) - y(s.priceHi) + rh,
          fill: color,
        })
        const yTop = y(s.priceHi) - rh / 2
        const yBot = y(s.priceLo) + rh / 2
        if (yBot > TOP - rh && yTop < VIEW_H - BOT + rh) {
          callouts.push({
            s,
            color,
            yTop,
            yBot,
            x0: x - 8,
            x1: x + wid + 4,
            today: d.date === lastDate,
          })
        }
      }

      // `MM-DD` — the year is dropped; five sessions of "2026-" is noise.
      plan.dateLabels.push({
        x,
        y: VIEW_H - 10,
        text: d.date.slice(5),
        color: palette.axisLabel,
        align: 'left',
        baseline: 'alphabetic',
        fontPx: TPO_CANVAS_TEXT.sansPx,
        fontFamily: TPO_CANVAS_TEXT.sansFamily,
      })
    }

    x += wid + GUTTER
  }

  // ── the outlined bands: NEWEST SESSION ONLY ─────────────────────────────────
  // The BOX stays on the chart; the text moved to hover. Five sessions of
  // always-on cards was more annotation than profile, and the cards had to be
  // de-collided away from their own bands to fit — which is exactly when a label
  // stops pointing at the thing it labels.
  if (view.labels) {
    for (const c of callouts) {
      if (!c.today) continue
      plan.bands.push({
        x: c.x0,
        y: c.yTop,
        w: c.x1 - c.x0,
        h: Math.max(4, c.yBot - c.yTop),
        radius: 4,
        stroke: c.color,
        fill: palette.kindBandFill[c.s.kind],
        lineWidth: 1.5,
      })
    }
  }

  plan.hits = callouts.map((c) => ({
    structure: c.s,
    color: c.color,
    x0: c.x0,
    x1: c.x1,
    yTop: c.yTop,
    yBot: c.yBot,
  }))

  // ── spot ────────────────────────────────────────────────────────────────────
  if (spot != null && vis(y(spot))) {
    plan.spotLine = {
      x0: AXIS,
      x1: w - 4,
      y: y(spot),
      color: palette.spot,
      dash: [5, 4],
      alpha: 1,
      lineWidth: 1,
    }
    plan.spotLabel = {
      x: w - 6,
      y: y(spot) - 7,
      text: spot.toFixed(2),
      color: palette.spot,
      align: 'right',
      baseline: 'alphabetic',
      fontPx: TPO_CANVAS_TEXT.monoPx,
      fontFamily: TPO_CANVAS_TEXT.monoFamily,
    }
  }

  // ── open business, drawn ACROSS the whole strip ─────────────────────────────
  // Unfinished structures as dashed lines, coloured by kind, so "open business"
  // lives on the chart instead of in a separate table. The price is the band's
  // MIDPOINT, which for the zero-width kinds (naked POC, poor high/low) is the
  // level itself.
  for (const st of levels) {
    const pr = (st.priceLo + st.priceHi) / 2
    const py = y(pr)
    if (!vis(py)) continue
    const color = palette.kind[st.kind]
    plan.openLevelLines.push({
      x0: AXIS,
      x1: w - 4,
      y: py,
      color,
      dash: [5, 4],
      alpha: OPEN_LEVEL_LINE_ALPHA,
      lineWidth: 1,
    })
    plan.openLevelLabels.push({
      x: w - 6,
      y: py - 1,
      text: `${KIND_LABEL[st.kind]} ${pr.toFixed(2)}`,
      color,
      align: 'right',
      baseline: 'bottom',
      fontPx: TPO_CANVAS_TEXT.monoPx,
      fontFamily: TPO_CANVAS_TEXT.monoFamily,
      bold: true,
    })
  }

  // ── the price axis: OUTSIDE the clip, so it never scrolls away ──────────────
  for (let i = 0; i <= geom.rows; i += geom.stepBins) {
    const p = geom.hi - i * geom.binSize
    const py = y(p)
    if (!vis(py)) continue
    plan.gridlines.push({
      x0: AXIS,
      x1: w - 4,
      y: py,
      color: palette.gridline,
      dash: [],
      alpha: 1,
      lineWidth: 1,
    })
    plan.axisLabels.push({
      x: 4,
      y: py,
      text: p.toFixed(2),
      color: palette.axisLabel,
      align: 'left',
      baseline: 'middle',
      fontPx: TPO_CANVAS_TEXT.monoPx,
      fontFamily: TPO_CANVAS_TEXT.monoFamily,
    })
  }

  return plan
}

// ── POINTER ──────────────────────────────────────────────────────────────────

/**
 * First match in array order wins — and array order is oldest session first,
 * then that session's structure order. Overlapping bands from two sessions
 * therefore resolve to the OLDER one.
 */
export function hitTest(hits: readonly HitRegion[], mx: number, my: number): HitRegion | null {
  return (
    hits.find(
      (h) =>
        mx >= h.x0 - HIT_PAD &&
        mx <= h.x1 + HIT_PAD &&
        my >= h.yTop - HIT_PAD &&
        my <= h.yBot + HIT_PAD,
    ) ?? null
  )
}

export interface HoverCardContent {
  title: string
  note: string
  /** `2026-08-29 · 6412.50–6415.00`, or one price for a zero-width kind. */
  identity: string
  color: string
}

/** What the hover card says. All three strings come from the taxonomy. */
export function hoverCardContent(hit: HitRegion): HoverCardContent {
  return {
    title: KIND_TITLE[hit.structure.kind],
    note: KIND_NOTE[hit.structure.kind],
    identity: `${hit.structure.date} · ${priceBand(hit.structure)}`,
    color: hit.color,
  }
}

/** Card box geometry, in canvas CSS px. */
export const HOVER_CARD_WIDTH = 268
/** Clamp margin: the card is kept `w - 290` from the left edge at most, so it
 *  never runs off the right side. 290 = the card plus its 14 px cursor offset
 *  plus a hair. */
export const HOVER_CARD_RIGHT_MARGIN = 290
export const HOVER_CARD_CURSOR_DX = 14
export const HOVER_CARD_CURSOR_DY = 12
/** Bottom clamp: `VIEW_H - 92`, so the card never hangs off the canvas. */
export const HOVER_CARD_BOTTOM_LIMIT = VIEW_H - 92

export function hoverCardPosition(
  mx: number,
  my: number,
  width: number,
): { left: number; top: number } {
  return {
    left: Math.min(mx + HOVER_CARD_CURSOR_DX, Math.max(0, width - HOVER_CARD_RIGHT_MARGIN)),
    top: Math.min(my + HOVER_CARD_CURSOR_DY, HOVER_CARD_BOTTOM_LIMIT),
  }
}

/**
 * The canvas cursor.
 *
 * NOTE: v2 keeps the drag state in a REF, so the `grabbing` cursor only actually
 * appears once the first pan `setState` has re-rendered — the first few pixels
 * of a drag still show `grab`. Step 3 can fix that by driving the cursor from
 * state; the ladder itself is unchanged.
 */
export function profileCursor(dragging: boolean, hovering: boolean): string {
  return dragging ? 'grabbing' : hovering ? 'pointer' : 'grab'
}

/** Pan is 1:1 with the pointer. */
export function panTo(
  start: { x: number; y: number; ox: number; oy: number },
  clientX: number,
  clientY: number,
): { ox: number; oy: number } {
  return { ox: start.ox + (clientX - start.x), oy: start.oy + (clientY - start.y) }
}
