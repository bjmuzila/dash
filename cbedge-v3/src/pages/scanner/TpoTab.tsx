// ─────────────────────────────────────────────────────────────────────────────
// TPO STRUCTURES — THE RENDER LAYER (/v3/scanner?tab=tpo).
//
// Spec: docs/parity/scanner.md Part F, rows F1–F201. Every threshold, tie rule,
// label string, colour ladder, loader and poll cadence is already transcribed
// and is NOT re-decided here:
//
//   · pages/scanner/tpoTaxonomy.ts   — the eight structures and their four
//                                      string tables, the age buckets, base rates
//   · pages/scanner/tpoStructures.ts — the profile engine, the forward-fill,
//                                      the stats, the open-location card
//   · pages/scanner/amt.ts           — the auction read, its five ladders and
//                                      the fifteen-signal catalogue
//   · pages/scanner/tpoProfile.ts    — the letter profile's GEOMETRY. Pure. It
//                                      returns draw instructions; this file owns
//                                      every `ctx` call.
//   · pages/scanner/tpoData.ts       — the candle legs, the live frame, the
//                                      k-NN forecast
//
// This file is wiring. What was missing from the logic modules was added THERE
// and is listed at the bottom of this header.
//
// ── THE CENTREPIECE IS A CANVAS, AND THAT IS WHY THIS PORT EXISTS ────────────
//
// Five sessions × ~14 periods × ~60 bins is several thousand cells; that many
// DOM nodes re-rendering on a socket tick is the main-thread stall that froze
// this tab in v2, which is why the profile is painted rather than laid out. v2
// then undid the win twice over:
//
//   · its `<canvas>` (Scanner.tsx:2586) carries NO `data-cb-layer`, so the layer
//     audit cannot see it at all;
//   · its draw effect re-runs on all twelve of its deps — `spot` among them —
//     with NO visibility guard, so the whole canvas repaints on every new bar
//     whether or not the card is on screen and whether or not this is even the
//     visible tab.
//
// Both are fixed here and they are the specific thing this port is for. The
// canvas is created in `onMount` and TAGGED ON THE LINE IT IS CREATED; the paint
// is scheduled through one rAF with a dirty flag and gated on ONE visibility
// signal — `onVisibility`, with the initial state read off the handle, which is
// the contract `ChartFrame` states for an on-demand renderer. Work skipped while
// hidden is repainted on the way back in, once, not replayed.
//
// Canvas colours come through `resolveTpoPalette()` / `tokenHex`, resolved ONCE
// at mount: `ctx.fillStyle = 'var(--color-warn)'` does not throw, it silently
// keeps the previous fill, and resolving a palette inside a draw loop is layout
// work sixty times a second for values that never change.
//
// ── SEVEN THINGS THAT LOOK LIKE MISTAKES AND ARE NOT ─────────────────────────
//
//  1. THE FORECAST'S PRE-IB COPY DESCRIBES THE WRONG GATE. It says "Waiting on
//     today's open to print." under the subtitle "lights up at open", while the
//     server is waiting for the INITIAL BALANCE to complete at 10:30 ET. v2's
//     strings ship as written (F128); the server's own `note`, which v2 throws
//     away, is rendered beside them so the screen is not only wrong. See the
//     `// BUG (v2):` marker on `TPO_FORECAST_COPY`.
//  2. A NARROW IB THAT HAS EXTENDED BOTH WAYS READS "no extension yet". The
//     day-type ladder's narrow branch catches `both` alongside `none`
//     (`classifyDayType`'s BUG marker). Reproduced. The new Range-extension tile
//     is the only place on the card that then tells the truth.
//  3. THE NAKED-POC MAGNET IS THE NEWEST, NOT THE NEAREST. `res.open` is sorted
//     `createdTs` DESC and `amtRead` takes `[0]`, so on a quiet stretch the
//     "magnet" can be a long way from price while an older one sits under it.
//     v2's; spec open question 4.
//  4. THE DISTANCE IS SIGNED IN THE ROW AND UNSIGNED IN THE SORT, and the row's
//     distance is never coloured while `StructureRow`'s is. Both are v2's.
//  5. THE SIGNAL RAIL COMPUTES LIVENESS TWICE. The sort's copy is a memo on
//     `[signals, spot, livePad]`; the row's copy runs per render. Collapsing them
//     would either freeze the badge or re-sort the rail under the cursor.
//  6. "SPOT" IS THE LAST BAR'S CLOSE, so every live comparison on this tab —
//     signal liveness, the dashed spot line, the open-location subtitle — lags by
//     up to one 5-minute bar (F17).
//  7. THE STATS TABLE IS HAND-ROLLED. `design/primitives/Table` early-returns its
//     `empty` node INSTEAD of the table, which drops the header row, and it
//     cannot express the per-row bucket-chip line that hangs under each kind
//     (F173). Every class below is the primitive's own vocabulary so the two
//     still read as one table.
//
// ── THE DELIBERATE DEPARTURES FROM v2 ────────────────────────────────────────
//
//  A. ONE CANDLE WINDOW, NOT ONE PER SELECTOR POSITION. v2 derives `historyDays`
//     from `nSessions`, so a 5D→30D click re-fires the whole load after the first
//     has landed (v3 non-negotiable 4, "Do not port" 18). This tab loads
//     `TPO_HISTORY_DAYS` — the widest window the selector can ask for — once per
//     instrument, and the day selector is a pure client-side slice.
//     THE VISIBLE CONSEQUENCE: `ageSessions` is measured from the last loaded
//     session, so the structure stats no longer move when the day selector moves.
//     In v2 they do. See `TPO_HISTORY_DAYS`.
//  B. NO SOCKET. v2's `useNqCandles` opens its OWN raw `WebSocket` to /ws/gex, a
//     second connection to the broadcast `useEsCandles` already reaches (F11).
//     Live rows arrive through `watchFrame` from `@/data/hooks` instead, on v2's
//     own 250 ms trailing publish (`CANDLE_COALESCE_MS`) — which the ES path had
//     and the NQ path never got (F9). Refs are written every frame, so no bar is
//     dropped by the coalescing.
//  C. THE LEGEND'S DASHED-LINE COUNT IS THE DRAWN COUNT. v2 interpolates
//     `open.length` (routinely 40+) into a sentence about the twelve dashed lines
//     `open.slice(0, 12)` actually draws, in BOTH the card subtitle and the
//     legend (F25, F93). `profileCardSubtitle` and `openLevelsLegendLine` take
//     the drawn count; "Do not port" 15 asks for the fix rather than the bug.
//  D. A FAILED CANDLE LEG SAYS SO. v2 swallows both legs and shows the same
//     "Waiting on RTH candles." it shows at 04:00 on a Sunday (F192).
//  E. A FIFTH AMT TILE. The range-extension ladder is computed on every read and
//     reaches the screen in v2 only paraphrased inside a day-type note — and on
//     the buggy narrow branch, paraphrased WRONGLY. It gets a tile.
//  F. THE GRABBING CURSOR APPEARS ON THE FIRST PIXEL. v2 keeps the drag in a ref,
//     so `grabbing` only shows once the first pan `setState` has re-rendered.
//     `profileCursor`'s doc names this as step 3's to fix; the ladder is unchanged.
//
// ── WHAT IS DELIBERATELY NOT MOUNTED (`@notWiredInV2`) ───────────────────────
// `deriveStructureRow` / `STRUCTURE_ROW_COLUMNS` / `structureRowBase` (the dead
// structure rail), the whole forward-map set (`buildForwardMap`, `FORWARD_ROLE`,
// `forwardToneColor`, `forwardRateColor`, `forwardLeanText`, `FORWARD_MAP_COPY`,
// `forwardMapSubtitle`, `forwardLegendTarget`), and `filterByKind` /
// `KIND_FILTER_LABELS` — which get no segmented control, so the rail is built at
// the permanent `"all"` v2 has always run at. `amt.playbook` and `amt.avgIbRange`
// are `@neverReadInV2` and are left unread. All of it is Brandon's call, not this
// step's.
//
// ── ADDED TO THE LOGIC MODULES BY THIS STEP ──────────────────────────────────
// tpoData: `TPO_MAX_SESSIONS` / `TPO_HISTORY_DAYS` (departure A), `candleFrameType`,
//   `liveCandleRows`, `CANDLE_COALESCE_MS` (departure B), `candleLoadFailureLine`
//   (departure D). amt: `AMT_TILE_LABELS.rangeExt`, `RANGE_EXT_LABEL`,
//   `RANGE_EXT_TILE_NOTE` (departure E), `LIVE_COLOR` / `LIVE_BADGE` (the live
//   row's ink, which v2 typed as a hex in three places). tpoTaxonomy:
//   `HOLE_SIDE_RULE` and `AGE_BUCKET_PROBE`, so the taxonomy card can show the
//   `baseRateFor` ladder per bucket without paraphrasing a doc comment.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '@/design/primitives/Card'
import type { ChartHandle } from '@/design/primitives/ChartFrame'
import { ChartFrame } from '@/design/primitives/ChartFrame'
import { Chip, SegGroup } from '@/design/primitives/Controls'
import { T, alpha } from '@/design/theme'
import { useQuery } from '@/data/api'
import { watchFrame } from '@/data/hooks'
import { EM_DASH, pctOrDash } from '@/pages/scanner/format'
import type { AmtRead, AmtSignal } from '@/pages/scanner/amt'
import {
  AMT_TILE_LABELS,
  AMT_TITLE,
  IB_TILE_NOTE,
  LIVE_BADGE,
  LIVE_COLOR,
  RANGE_EXT_LABEL,
  RANGE_EXT_TILE_NOTE,
  SIGNALS_EMPTY,
  SIGNALS_EXPAND_HINT,
  SIGNALS_HEADING,
  amtRead,
  amtSubtitle,
  countLiveSignals,
  deriveSignalRow,
  ibColor,
  ibTileValue,
  livePadFor,
  railAccent,
  signalCountPill,
  sortAmtSignals,
  splitStateLabel,
  stateColor,
} from '@/pages/scanner/amt'
import type {
  BandDraw,
  CellDraw,
  HitRegion,
  LineDraw,
  RectDraw,
  TagDraw,
  TextDraw,
  TpoDrawPlan,
  TpoPalette,
  TpoProfileView,
} from '@/pages/scanner/tpoProfile'
import {
  DEFAULT_WIDTH,
  HOVER_CARD_WIDTH,
  PROFILE_ACCENT,
  PROFILE_TOOLBAR,
  TPO_CANVAS_TEXT,
  TPO_PROFILE_VIEW_DEFAULT,
  VIEW_H,
  anchorOffsets,
  buildProfilePlan,
  canvasBacking,
  hitTest,
  hoverCardContent,
  hoverCardPosition,
  hoverCardTint,
  panTo,
  profileCursor,
  resetView,
  resolveTpoPalette,
  tpoGeometry,
  wheelZoom,
  zoomPriceIn,
  zoomPriceOut,
  zoomWidthIn,
  zoomWidthOut,
} from '@/pages/scanner/tpoProfile'
import type { RefRow, TpoResult, TpoSession, TpoStructure } from '@/pages/scanner/tpoStructures'
import {
  INSTRUMENT_OPTIONS,
  MIN_SESSIONS_FOR_OPEN_LOCATION,
  OPEN_LOCATION_BANNER,
  OPEN_LOCATION_COLUMN_RIGHT,
  OPEN_LOCATION_FOOTNOTE,
  OPEN_LOCATION_LEAN,
  OPEN_LOCATION_NO_WEEK,
  OPEN_LOCATION_TITLE,
  PROFILE_LEGEND,
  STATS_CARD_TITLE,
  STATS_COLUMNS,
  STATS_EMPTY,
  STATS_SUMMARY_NOTE,
  STATS_SUMMARY_TITLE,
  TPO_DEFAULT_KIND_FILTER,
  WAITING_ON_CANDLES,
  binSizeFor,
  buildOpenLocation,
  buildTpoStructures,
  drawnLevels,
  hasGradedStats,
  locationOf,
  openLevelsLegendLine,
  openLocationColumnLeft,
  openLocationColumns,
  openLocationSubtitle,
  openLocationTone,
  openRail,
  profileCardSubtitle,
  profileCardTitle,
  sessionChoiceLabel,
  statsCardSubtitle,
  statsRows,
  structureBaseRateTooltip,
} from '@/pages/scanner/tpoStructures'
import type { AgeBucket, StructureKind } from '@/pages/scanner/tpoTaxonomy'
import {
  AGE_BUCKETS,
  AGE_BUCKET_PROBE,
  HOLE_SIDE_RULE,
  KIND_COLOR,
  KIND_LABEL,
  KIND_MEANING,
  KIND_NOTE,
  KIND_ORDER,
  KIND_RULE,
  KIND_SIDE,
  KIND_TITLE,
  MIN_N,
  ageBucket,
  baseRateFor,
} from '@/pages/scanner/tpoTaxonomy'
import type {
  EsCandle,
  EsCandleRecord,
  TpoForecast,
  TpoForecastError,
  TpoForecastOk,
  TpoForecastPending,
  TpoInstrument,
  TpoSessionChoice,
} from '@/pages/scanner/tpoData'
import {
  CANDLE_COALESCE_MS,
  TPO_DEFAULT_INSTRUMENT,
  TPO_DEFAULT_SESSIONS,
  TPO_FORECAST_COPY,
  TPO_FORECAST_POLL_MS,
  TPO_FORECAST_STALE_MS,
  TPO_HISTORY_DAYS,
  TPO_SESSION_CHOICES,
  accumulatingDetail,
  accumulatingLine,
  barCountKey,
  candleFrameType,
  candleLoadFailureLine,
  forecastSubtitle,
  forecastValueBand,
  isForecastError,
  liveCandleRows,
  loadTpoCandles,
  spotFromCandles,
  tpoForecastUrl,
  unionCandles,
} from '@/pages/scanner/tpoData'

// ─────────────────────────────────────────────────────────────────────────────
// CLASS ATOMS. Structure only — every colour is a token, applied through
// `style` where it varies per row and through a utility where it does not.
// ─────────────────────────────────────────────────────────────────────────────

const SUBTITLE = 'mb-2 text-xs text-muted'
const FOOTNOTE = 'mt-2 text-xs leading-relaxed text-muted'
const NOTE = 'text-xs leading-relaxed'
const TILE = 'flex min-w-0 flex-col gap-1 rounded-sm border border-line px-2 py-1.5'
const TILE_GRID = 'mb-3 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2'
const BANNER = 'mb-3 rounded-sm border px-3 py-2'
const SUMMARY = 'flex cursor-pointer list-none items-center gap-2 rounded-sm border px-3 py-1.5'
const TH_CLASS = 'border-b border-line px-2 py-1.5 text-2xs font-bold uppercase tracking-wide text-muted'
const TD_CLASS = 'border-b border-line/50 px-2 py-1'
const PILL = 'rounded-full border px-2 py-0.5 text-2xs font-bold uppercase tracking-wide'
/** The level chip and the kind badge. Square corners — v2's radius 5, not 999. */
const CHIP = 'rounded-sm border px-1.5 py-0.5 text-center text-2xs font-bold uppercase tracking-wide'
const CONTROL_ROW = 'mb-3 flex flex-wrap items-center gap-1.5'

/** F100 — label, value, optional note. `note` is omitted when falsy. */
function Tile({
  label,
  value,
  note,
  color,
}: {
  label: string
  value: string
  note?: string
  color?: string
}) {
  return (
    <div className={TILE}>
      <span className="text-2xs uppercase tracking-wide text-muted">{label}</span>
      <span className="text-sm font-bold" style={{ color: color ?? T.text }}>
        {value}
      </span>
      {note ? (
        <span className={NOTE} style={{ color: T.text }}>
          {note}
        </span>
      ) : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// THE CANVAS PAINTER.
//
// `tpoProfile.ts` hands back arrays of draw instructions and makes no canvas
// call of its own; everything below is the loop over those arrays. It is
// deliberately dumb — no arithmetic, no branching beyond "is there a letter" —
// because every decision has already been made in a pure function that can be
// tested without a DOM.
// ─────────────────────────────────────────────────────────────────────────────

function canvasFont(px: number, family: string, bold = false): string {
  return `${bold ? '700 ' : ''}${px}px ${family}`
}

function fillRectDraw(ctx: CanvasRenderingContext2D, r: RectDraw): void {
  ctx.fillStyle = r.fill
  ctx.fillRect(r.x, r.y, r.w, r.h)
}

function drawText(ctx: CanvasRenderingContext2D, t: TextDraw): void {
  ctx.font = canvasFont(t.fontPx, t.fontFamily, t.bold)
  ctx.fillStyle = t.color
  ctx.textAlign = t.align
  ctx.textBaseline = t.baseline
  ctx.fillText(t.text, t.x, t.y)
}

/** Every line in the plan is horizontal, which is why `y` is a scalar. */
function drawLine(ctx: CanvasRenderingContext2D, l: LineDraw): void {
  ctx.save()
  ctx.globalAlpha = l.alpha
  ctx.strokeStyle = l.color
  ctx.lineWidth = l.lineWidth
  ctx.setLineDash([...l.dash])
  ctx.beginPath()
  ctx.moveTo(l.x0, l.y)
  ctx.lineTo(l.x1, l.y)
  ctx.stroke()
  ctx.restore()
}

function drawCell(ctx: CanvasRenderingContext2D, c: CellDraw): void {
  ctx.fillStyle = c.fill
  ctx.fillRect(c.x, c.y, c.w, c.h)
  // null below the letter-visibility gate — the cell is then an anonymous
  // coloured box, which still carries the IB / later-period / POC distinction.
  if (c.letter == null) return
  ctx.font = canvasFont(c.fontPx, TPO_CANVAS_TEXT.monoFamily)
  ctx.fillStyle = c.ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(c.letter, c.textX, c.textY)
}

/** Leader line, then the label off its right end. F57–F61. */
function drawTag(ctx: CanvasRenderingContext2D, t: TagDraw): void {
  ctx.strokeStyle = t.color
  ctx.lineWidth = 1
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(t.x0, t.y)
  ctx.lineTo(t.x1, t.y)
  ctx.stroke()
  ctx.font = canvasFont(TPO_CANVAS_TEXT.monoPx, TPO_CANVAS_TEXT.monoFamily)
  ctx.fillStyle = t.color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(t.label, t.labelX, t.y)
}

function drawBand(ctx: CanvasRenderingContext2D, b: BandDraw): void {
  ctx.beginPath()
  ctx.roundRect(b.x, b.y, b.w, b.h, b.radius)
  ctx.fillStyle = b.fill
  ctx.fill()
  ctx.strokeStyle = b.stroke
  ctx.lineWidth = b.lineWidth
  ctx.setLineDash([])
  ctx.stroke()
}

/**
 * One frame.
 *
 * The clip is released before the gutter plate, the gridlines and the axis
 * labels, which is what puts the price axis ON TOP of the letters — not an
 * accident of ordering to tidy up. The axis must never scroll away under a pan.
 */
function paintPlan(ctx: CanvasRenderingContext2D, plan: TpoDrawPlan, width: number, bg: string): void {
  ctx.clearRect(0, 0, width, VIEW_H)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, VIEW_H)

  ctx.save()
  ctx.beginPath()
  ctx.rect(plan.clip.x, plan.clip.y, plan.clip.w, plan.clip.h)
  ctx.clip()

  for (const r of plan.vaWashes) fillRectDraw(ctx, r)
  for (const c of plan.cells) drawCell(ctx, c)
  for (const t of plan.tags) drawTag(ctx, t)
  for (const s of plan.spines) fillRectDraw(ctx, s)
  for (const b of plan.bands) drawBand(ctx, b)
  for (const d of plan.dateLabels) drawText(ctx, d)
  if (plan.spotLine) drawLine(ctx, plan.spotLine)
  if (plan.spotLabel) drawText(ctx, plan.spotLabel)
  for (const l of plan.openLevelLines) drawLine(ctx, l)
  for (const t of plan.openLevelLabels) drawText(ctx, t)

  ctx.restore()

  fillRectDraw(ctx, plan.gutterPlate)
  for (const g of plan.gridlines) drawLine(ctx, g)
  for (const a of plan.axisLabels) drawText(ctx, a)
}

// ─────────────────────────────────────────────────────────────────────────────
// THE LETTER PROFILE (F35–F88).
// ─────────────────────────────────────────────────────────────────────────────

interface HoverState {
  hit: HitRegion
  x: number
  y: number
}

function LetterProfile({
  sessions,
  spot,
  binSize,
  levels,
}: {
  sessions: readonly TpoSession[]
  spot: number | null
  binSize: number
  levels: readonly TpoStructure[]
}) {
  const [view, setView] = useState<TpoProfileView>(TPO_PROFILE_VIEW_DEFAULT)
  const [hover, setHover] = useState<HoverState | null>(null)
  // Departure F — driven from state so the cursor changes on the first pixel of
  // a drag rather than after the first pan commit.
  const [dragging, setDragging] = useState(false)
  const [width, setWidth] = useState(DEFAULT_WIDTH)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  // Resolved ONCE at mount. Each `tokenHex` is a getComputedStyle behind a
  // cache; a palette resolved per frame is layout work for values that never
  // change.
  const paletteRef = useRef<TpoPalette | null>(null)
  const widthRef = useRef(DEFAULT_WIDTH)
  const visibleRef = useRef(true)
  const pendingRef = useRef(false)
  const rafRef = useRef(0)
  // F76 — set on mount, on a session-count change and on every split toggle.
  const anchorRef = useRef(true)
  // F66 — hits live in a REF, so hovering never re-runs the draw.
  const hitsRef = useRef<readonly HitRegion[]>([])
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  const hoverRef = useRef<HoverState | null>(hover)
  hoverRef.current = hover

  // Everything the plan reads, in one ref, so the paint closure is stable and
  // the pointer listeners registered at mount see current values.
  const dataRef = useRef({ sessions, spot, binSize, levels, view })
  dataRef.current = { sessions, spot, binSize, levels, view }

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return
    const b = canvasBacking(widthRef.current)
    canvas.width = b.backingWidth
    canvas.height = b.backingHeight
    const [a, b1, c, d, e, f] = b.transform
    // Everything the painter draws is in CSS px from here on.
    ctx.setTransform(a, b1, c, d, e, f)
  }, [])

  const paint = useCallback(() => {
    const ctx = ctxRef.current
    const palette = paletteRef.current
    if (!ctx || !palette) return
    const { sessions: ss, spot: sp, binSize: bs, levels: lv, view: vw } = dataRef.current
    const w = widthRef.current
    // F45 / F46 — nothing to draw, or a degenerate price domain, leaves the
    // PREVIOUS frame on screen rather than clearing it. v2's early bail.
    if (!ss.length) return
    const geom = tpoGeometry(ss, bs, vw, w)
    if (!geom) return

    // F79 — the anchor pass RETURNS BEFORE DRAWING. Committing the offsets
    // re-runs this effect and the real paint happens next pass: one deliberately
    // dropped frame, which is what stops the view fighting its own pan.
    if (anchorRef.current) {
      anchorRef.current = false
      const a = anchorOffsets(ss, geom, vw, sp)
      if (a.changed) {
        setView((v) => ({ ...v, ox: a.ox, oy: a.oy }))
        return
      }
    }

    const plan = buildProfilePlan(ss, geom, vw, sp, lv, palette)
    hitsRef.current = plan.hits
    paintPlan(ctx, plan, w, palette.bg)
  }, [])

  /**
   * v3 non-negotiable 5, and the whole point of this port. A card nobody can see
   * does not paint: the request is remembered and served once on the way back in
   * rather than replayed frame by frame.
   */
  const schedule = useCallback(() => {
    if (!visibleRef.current) {
      pendingRef.current = true
      return
    }
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      paint()
    })
  }, [paint])

  useEffect(() => {
    schedule()
  }, [schedule, sessions, spot, binSize, levels, view, width])

  // F76 — the three things that re-anchor. A width change does NOT.
  useEffect(() => {
    anchorRef.current = true
    schedule()
  }, [schedule, sessions.length, view.split])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) canvas.style.cursor = profileCursor(dragging, hover != null)
  }, [dragging, hover])

  const onMount = useCallback(
    (h: ChartHandle) => {
      const canvas = document.createElement('canvas')
      // v3 non-negotiable 7 — tagged on the line it is created. v2's canvas
      // (Scanner.tsx:2586) carries nothing, so the layer audit cannot see it.
      canvas.setAttribute('data-cb-layer', 'tpo-profile')
      canvas.className = 'block h-full w-full touch-none rounded-md'
      // The pre-first-paint ground. A `var()` string is legal in a DOM style;
      // it is the canvas FILL that cannot take one.
      canvas.style.background = T.bg
      h.el.appendChild(canvas)

      canvasRef.current = canvas
      ctxRef.current = canvas.getContext('2d')
      paletteRef.current = resolveTpoPalette()
      widthRef.current = h.width || DEFAULT_WIDTH
      setWidth(widthRef.current)
      // The frame's contract: `onVisibility` is not called for the initial
      // state, so it is read off the handle here.
      visibleRef.current = h.visible()
      sizeCanvas()

      const onPointerDown = (e: PointerEvent) => {
        canvas.setPointerCapture(e.pointerId)
        const v = dataRef.current.view
        dragRef.current = { x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy }
        setDragging(true)
      }

      const onPointerMove = (e: PointerEvent) => {
        const d = dragRef.current
        if (d) {
          // F81 — starting a drag clears any hover card.
          if (hoverRef.current) setHover(null)
          const p = panTo(d, e.clientX, e.clientY)
          setView((v) => ({ ...v, ox: p.ox, oy: p.oy }))
          return
        }
        const r = canvas.getBoundingClientRect()
        const mx = e.clientX - r.left
        const my = e.clientY - r.top
        const hit = hitTest(hitsRef.current, mx, my)
        if (!hit) {
          if (hoverRef.current) setHover(null)
          return
        }
        // F83 — re-set on every x-pixel of movement inside one band, so the card
        // tracks the cursor horizontally.
        const cur = hoverRef.current
        if (!cur || cur.hit.structure.id !== hit.structure.id || cur.x !== mx) {
          setHover({ hit, x: mx, y: my })
        }
      }

      const endDrag = () => {
        dragRef.current = null
        setDragging(false)
      }
      const onPointerLeave = () => setHover(null)

      // F80 — a NATIVE listener with `{passive: false}`. React's synthetic wheel
      // handler is passive, where `preventDefault()` is a no-op and the page
      // scrolls instead of the chart zooming.
      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        const r = canvas.getBoundingClientRect()
        setView((v) => wheelZoom(v, e.deltaY, e.shiftKey, e.clientX - r.left, e.clientY - r.top))
      }

      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerup', endDrag)
      canvas.addEventListener('pointercancel', endDrag)
      canvas.addEventListener('pointerleave', onPointerLeave)
      canvas.addEventListener('wheel', onWheel, { passive: false })

      schedule()

      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
        canvas.removeEventListener('pointerdown', onPointerDown)
        canvas.removeEventListener('pointermove', onPointerMove)
        canvas.removeEventListener('pointerup', endDrag)
        canvas.removeEventListener('pointercancel', endDrag)
        canvas.removeEventListener('pointerleave', onPointerLeave)
        canvas.removeEventListener('wheel', onWheel)
        canvas.remove()
        canvasRef.current = null
        ctxRef.current = null
      }
    },
    [schedule, sizeCanvas],
  )

  const onResize = useCallback(
    (w: number) => {
      // F47 — a zero `clientWidth` falls back to 1180 rather than collapsing the
      // strip to nothing.
      widthRef.current = w || DEFAULT_WIDTH
      setWidth(widthRef.current)
      sizeCanvas()
      schedule()
    },
    [schedule, sizeCanvas],
  )

  const onVisibility = useCallback(
    (visible: boolean) => {
      visibleRef.current = visible
      if (visible && pendingRef.current) {
        pendingRef.current = false
        schedule()
      }
    },
    [schedule],
  )

  const btn = (label: string, onClick: () => void, on = false) => (
    <Chip key={label} label={label} on={on} onClick={onClick} />
  )

  const card = hover ? hoverCardContent(hover.hit) : null
  const cardPos = hover ? hoverCardPosition(hover.x, hover.y, width) : null

  return (
    <div>
      {/* F35–F44 — the toolbar, in strip order. The two zoom pairs and Reset
          never render active; v2's `btn(false)` for all five. */}
      <div className={CONTROL_ROW}>
        <SegGroup
          options={[
            { label: PROFILE_TOOLBAR.collapsed, value: 'collapsed' },
            { label: PROFILE_TOOLBAR.split, value: 'split' },
          ]}
          value={view.split ? 'split' : 'collapsed'}
          onChange={(v) => setView((s) => ({ ...s, split: v === 'split' }))}
        />
        {btn(PROFILE_TOOLBAR.labels, () => setView((s) => ({ ...s, labels: !s.labels })), view.labels)}
        {btn(PROFILE_TOOLBAR.priceIn, () => setView((s) => ({ ...s, zy: zoomPriceIn(s.zy) })))}
        {btn(PROFILE_TOOLBAR.priceOut, () => setView((s) => ({ ...s, zy: zoomPriceOut(s.zy) })))}
        {btn(PROFILE_TOOLBAR.widthIn, () => setView((s) => ({ ...s, zx: zoomWidthIn(s.zx) })))}
        {btn(PROFILE_TOOLBAR.widthOut, () => setView((s) => ({ ...s, zx: zoomWidthOut(s.zx) })))}
        {/* F42 — Reset re-anchors as well as zeroing; a "Reset" that leaves you
            on a 30-day-old profile is not a reset. */}
        {btn(PROFILE_TOOLBAR.reset, () => {
          anchorRef.current = true
          setView(resetView())
        })}
        <span className="text-xs" style={{ color: T.text }}>
          {PROFILE_TOOLBAR.hint}
        </span>
      </div>

      {/*
        The viewport is a FIXED height and the profile pans and zooms inside it —
        v2's, and spec open question 7 asks whether v3 keeps it. `VIEW_H` is the
        canvas geometry the whole draw plan is built against, so it is applied as
        a canvas dimension rather than a page size; it is not the type scale.
      */}
      <div className="relative flex" style={{ height: VIEW_H }}>
        <ChartFrame onMount={onMount} onResize={onResize} onVisibility={onVisibility} />

        {/* F85–F88 — the hover card. Absolutely positioned in CANVAS
            coordinates, which is why these are numbers: `hoverCardPosition`
            clamps them so the card never runs off an edge. The tint is v2's
            inset-shadow trick expressed as a flat gradient over the ground, so
            the plate stays opaque under it. */}
        {hover && card && cardPos && (
          <div
            className="pointer-events-none absolute z-10 rounded-sm border px-2 py-1.5"
            style={{
              left: cardPos.left,
              top: cardPos.top,
              width: HOVER_CARD_WIDTH,
              borderColor: card.color,
              backgroundColor: T.bg,
              backgroundImage: `linear-gradient(${hoverCardTint(card.color)}, ${hoverCardTint(card.color)})`,
            }}
          >
            <div className="text-xs font-bold" style={{ color: card.color }}>
              {card.title}
            </div>
            <div className={NOTE} style={{ color: T.text }}>
              {card.note}
            </div>
            <div className="tabular text-xs" style={{ color: T.text }}>
              {card.identity}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD 1 — the profile, its controls and its legend (F24–F34, F89–F94).
// ─────────────────────────────────────────────────────────────────────────────

function ProfileCard({
  instrument,
  onInstrument,
  nSessions,
  onSessions,
  shown,
  spot,
  binSize,
  drawn,
  failure,
}: {
  instrument: TpoInstrument
  onInstrument: (v: TpoInstrument) => void
  nSessions: TpoSessionChoice
  onSessions: (v: TpoSessionChoice) => void
  shown: readonly TpoSession[]
  spot: number | null
  binSize: number
  drawn: readonly TpoStructure[]
  failure: string | null
}) {
  return (
    <Card title={<span style={{ color: PROFILE_ACCENT }}>{profileCardTitle(shown.length)}</span>}>
      {/* Departure C — the drawn count, not `open.length`. v2 says "40" here and
          draws twelve lines. */}
      <p className={SUBTITLE}>{profileCardSubtitle(instrument, binSize, drawn.length)}</p>

      {/* Departure D — v2 swallows a failed leg entirely and shows nothing but
          "Waiting on RTH candles.", the same sentence it shows at 04:00 on a
          Sunday. Kept out of the empty branch on purpose: one leg can fail while
          the other still draws a profile, and that is exactly when a silent
          failure is worst. */}
      {failure && (
        <p className="mb-2 text-xs" style={{ color: T.orange }}>
          {failure}
        </p>
      )}

      {/* F26–F32 — instrument pair, then the day pills. Neither is persisted:
          no localStorage, no URL param, so a remount returns to ESU / 5D. */}
      <div className={CONTROL_ROW}>
        <SegGroup
          options={INSTRUMENT_OPTIONS.map((i) => ({ label: i, value: i }))}
          value={instrument}
          onChange={onInstrument}
        />
        <SegGroup
          options={TPO_SESSION_CHOICES.map((n) => ({ label: sessionChoiceLabel(n), value: String(n) }))}
          value={String(nSessions)}
          onChange={(v) => onSessions(Number(v) as TpoSessionChoice)}
        />
      </div>

      {/* F33 — the canvas is not mounted at all in this state, which is also the
          loading state: v2 has no spinner here and one is not invented. */}
      {!shown.length ? (
        <div className="p-6 text-center text-sm" style={{ color: T.text }}>
          {WAITING_ON_CANDLES}
        </div>
      ) : (
        <LetterProfile sessions={shown} spot={spot} binSize={binSize} levels={drawn} />
      )}

      {/* F89–F93. F94: there is still no `tail hi` / `tail lo` row. In v2 that
          actively misled — tails shared poor's orange — and the taxonomy split
          the two colours, so an unlabelled tail no longer reads as a poor high.
          The missing row is still missing; adding one is Brandon's call. */}
      <div className="mt-3 flex flex-wrap gap-3 text-xs" style={{ color: T.text }}>
        {PROFILE_LEGEND.map((e) => (
          <span key={e.term}>
            <b style={{ color: e.color }}>{e.term}</b>
            {e.gloss}
          </span>
        ))}
        <span>{openLevelsLegendLine(drawn.length)}</span>
      </div>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD 2 — the AMT panel (F95–F122).
// ─────────────────────────────────────────────────────────────────────────────

function SignalRow({ s, spot, livePad }: { s: AmtSignal; spot: number | null; livePad: number }) {
  // Liveness is recomputed HERE, per render, independently of the sort's copy —
  // so the badge reacts to every tick without re-sorting the rail under the
  // cursor. Not redundancy to remove.
  const r = deriveSignalRow(s, spot, livePad)
  return (
    <div
      className="grid grid-cols-[4.5rem_1fr_6rem] items-start gap-2 rounded-sm border px-2 py-1.5"
      style={{
        borderColor: r.live ? LIVE_COLOR : T.border,
        background: r.live ? alpha(LIVE_COLOR, 0.08) : 'transparent',
      }}
    >
      <div className="flex flex-col gap-1">
        {/* F115 — the level word, literally "action" / "watch" / "info". */}
        <span
          className={CHIP}
          style={{
            color: r.levelColor,
            borderColor: alpha(r.levelColor, 0.33),
            background: alpha(r.levelColor, 0.09),
          }}
        >
          {r.level}
        </span>
        {/* F116 — omitted entirely when not live. */}
        {r.live && (
          <span
            className="text-center text-2xs font-bold tracking-wide"
            style={{ color: LIVE_COLOR }}
          >
            {LIVE_BADGE}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-xs font-bold" style={{ color: T.text }}>
          {/* F117 — ▲ / ▼ / ◆. A hole is always the diamond: `STRUCT_DIR.hole` is
              undefined, so its `?? "flat"` is the answer, not a fallback. */}
          <span style={{ color: r.glyph.c }}>{r.glyph.g}</span>
          {r.title}
        </span>
        <span className={NOTE} style={{ color: T.text }}>
          {r.detail}
        </span>
      </div>

      <div className="flex flex-col gap-0.5 text-right text-xs tabular" style={{ color: T.text }}>
        <span className="font-bold">{r.trigger}</span>
        {/* F121 — the literal word "trail" for a null target: every range
            extension, tail and hole signal. */}
        <span>{r.target}</span>
        {/* F122 — SIGNED `trigger − spot`, never coloured, and the whole cell is
            omitted rather than dashed when either side is missing. */}
        {r.dist != null && <span>{r.dist}</span>}
      </div>
    </div>
  )
}

function AmtPanel({ amt, spot, binSize }: { amt: AmtRead; spot: number | null; binSize: number }) {
  // F95 — two bins or ~0.12% of price, whichever is larger.
  const livePad = livePadFor(binSize, spot)
  const signals = useMemo(
    () => sortAmtSignals(amt.signals, spot, livePad),
    [amt.signals, spot, livePad],
  )
  const liveCount = countLiveSignals(amt.signals, spot, livePad)

  const title = <span style={{ color: T.cyan }}>{AMT_TITLE}</span>

  // F96 — this IS the panel's loading state. Two reasons and no third.
  if (!amt.ok) {
    return (
      <Card title={title}>
        <div className="p-5 text-center text-sm" style={{ color: T.text }}>
          {amt.reason}
        </div>
      </Card>
    )
  }

  const state = splitStateLabel(amt.stateLabel)
  const tone = stateColor(amt.state)
  const accent = railAccent(liveCount)

  return (
    <Card title={title}>
      <p className={SUBTITLE}>{amtSubtitle(liveCount, spot)}</p>

      <div className={TILE_GRID}>
        {/* F101 — never null when `ok`. The narrow-IB branch's note says "no
            extension yet" on a day that has extended BOTH ways; see the BUG
            marker on `classifyDayType`, and the Range-extension tile beside it. */}
        <Tile label={AMT_TILE_LABELS.dayType} value={amt.dayType.label} note={amt.dayType.note} />
        <Tile
          label={AMT_TILE_LABELS.ibWidth}
          value={ibTileValue(amt.ibClass, amt.ibRatio)}
          note={IB_TILE_NOTE}
          color={ibColor(amt.ibClass)}
        />
        {/* Departure E — the ladder v2 computes and never shows. */}
        <Tile
          label={AMT_TILE_LABELS.rangeExt}
          value={RANGE_EXT_LABEL[amt.rangeExt]}
          note={RANGE_EXT_TILE_NOTE}
        />
        {/* F103 — split on " — " (space EM DASH space). */}
        <Tile label={AMT_TILE_LABELS.state} value={state.value} note={state.note} color={tone} />
        {/* F104 — all four labels carry "(approx)": with no tick tape the opening
            type is inferred from where the open sits in the REALIZED range. */}
        <Tile
          label={AMT_TILE_LABELS.opening}
          value={amt.opening?.label ?? EM_DASH}
          note={amt.opening?.note}
        />
      </div>

      {/* F105 */}
      <div
        className={BANNER}
        style={{ borderColor: alpha(tone, 0.25), background: alpha(tone, 0.06) }}
      >
        <div className="text-xs font-semibold leading-relaxed" style={{ color: T.text }}>
          {amt.bias}
        </div>
        <div className="mt-1 text-xs tabular" style={{ color: T.text }}>
          {amt.location}
        </div>
      </div>

      {/* F106–F111 — collapsed by default, and the summary is the toggle. */}
      <details>
        <summary
          className={SUMMARY}
          style={{
            borderColor: alpha(accent, 0.25),
            background: alpha(accent, 0.06),
            borderLeft: `3px solid ${accent}`,
          }}
        >
          <span className="text-sm font-bold uppercase tracking-wide" style={{ color: T.text }}>
            {SIGNALS_HEADING}
          </span>
          {/* F108 — `● 3 live`, or `12 armed`. */}
          <span
            className={PILL}
            style={{
              color: liveCount ? LIVE_COLOR : T.text,
              borderColor: liveCount ? LIVE_COLOR : T.border,
              background: liveCount ? alpha(LIVE_COLOR, 0.1) : 'transparent',
            }}
          >
            {signalCountPill(liveCount, signals.length)}
          </span>
          {/* F109 — never changes to "collapse" when open. v2's. */}
          <span className="ml-auto text-xs" style={{ color: T.text }}>
            {SIGNALS_EXPAND_HINT}
          </span>
        </summary>

        <div className="mt-2 flex flex-col gap-1.5">
          {signals.map((s) => (
            <SignalRow key={s.id} s={s} spot={spot} livePad={livePad} />
          ))}
          {!signals.length && (
            <div className="p-4 text-center text-sm" style={{ color: T.text }}>
              {SIGNALS_EMPTY}
            </div>
          )}
        </div>
      </details>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD 3 — the forecast one-liner (F123–F131).
// ─────────────────────────────────────────────────────────────────────────────

function ForecastLine({ body, subtitle }: { body: ReactNode; subtitle?: string }) {
  return (
    <Card title={<span style={{ color: T.orange }}>{TPO_FORECAST_COPY.title}</span>}>
      {subtitle ? <p className={SUBTITLE}>{subtitle}</p> : null}
      <div className="text-xs leading-relaxed" style={{ color: T.text }}>
        {body}
      </div>
    </Card>
  )
}

/**
 * F131 — the fields the response carries and v2's card renders none of.
 *
 * The two 201-point density curves are not values to print, so their point count
 * stands in for them; everything scalar is printed. `realized_*` is today's own
 * profile on the forecast's grid, which is the only way to see whether the k-NN
 * is currently right.
 */
function ForecastExtras({ fc }: { fc: TpoForecastOk }) {
  const parts: string[] = [
    `realized value ${fc.realized_va[0].toFixed(0)}–${fc.realized_va[1].toFixed(0)}`,
    `realized POC ${fc.realized_poc.toFixed(2)}`,
  ]
  if (fc.date) parts.push(`date ${fc.date}`)
  if (fc.nHistory != null) parts.push(`history ${fc.nHistory}`)
  if (fc.ibMid != null) parts.push(`IB mid ${fc.ibMid.toFixed(2)}`)
  if (fc.ibHigh != null) parts.push(`IB high ${fc.ibHigh.toFixed(2)}`)
  if (fc.ibLow != null) parts.push(`IB low ${fc.ibLow.toFixed(2)}`)
  if (fc.predicted?.length) parts.push(`predicted curve ${fc.predicted.length} pts`)
  if (fc.realized?.length) parts.push(`realized curve ${fc.realized.length} pts`)
  return (
    <div className="mt-1 text-xs tabular" style={{ color: T.muted }}>
      {parts.join(' · ')}
    </div>
  )
}

function ForecastCard({ instrument }: { instrument: TpoInstrument }) {
  // F123 — v2 refetches on a 60 s `setInterval` with no `AbortController`; an
  // in-flight response is dropped by an `alive` flag after it has downloaded.
  // `pollMs` is the same cadence and skips a hidden tab.
  const { data, error, loading } = useQuery<TpoForecast | TpoForecastError>(
    tpoForecastUrl(instrument),
    { staleMs: TPO_FORECAST_STALE_MS, pollMs: TPO_FORECAST_POLL_MS },
  )

  // F125. v2 reads `j.error` off a parsed 500 body; `query()` throws on a
  // non-2xx, so the thrown message is what reaches the screen instead. The
  // `isForecastError` branch still covers a 200 that carries an error.
  const errText = error ? error.message : isForecastError(data) ? data.error : null
  if (errText) {
    return (
      <ForecastLine
        body={
          <span style={{ color: T.text }}>
            {TPO_FORECAST_COPY.errorPrefix}
            {errText}
          </span>
        }
      />
    )
  }

  // F126 — the literal "Loading…", no subtitle. First paint.
  if (!data || loading) return <ForecastLine body={TPO_FORECAST_COPY.loading} />

  const fc = data as TpoForecast

  if (!fc.ok) {
    const pending = fc as TpoForecastPending
    const accumulating = pending.status === 'accumulating'
    return (
      <ForecastLine
        // BUG (v2): the pre-IB copy misdescribes its own gate — it says the card
        // is waiting on the 09:30 open when the server is waiting for the
        // INITIAL BALANCE to complete at 10:30 ET. Shipped as written (F128); the
        // corrected wording sits beside it in `TPO_FORECAST_COPY` as
        // `preIbBodyCorrected` / `preIbSubtitleCorrected`.
        body={
          <>
            <span>{accumulating ? accumulatingLine(pending) : TPO_FORECAST_COPY.preIbBody}</span>
            {/* F127 / F131 — the server's own `note`, which v2 throws away. It is
                the ONLY thing separating the two branches that both report
                "accumulating": a genuinely short history, and the `catch` around
                the `tpo_profiles` query when the recorder table does not exist,
                which reports `nHistory: 0`. On a fresh install both read
                "…0/40 sessions." */}
            <div className="mt-1 text-xs" style={{ color: T.muted }}>
              {accumulatingDetail(pending)}
            </div>
          </>
        }
        subtitle={
          accumulating ? TPO_FORECAST_COPY.accumulatingSubtitle : TPO_FORECAST_COPY.preIbSubtitle
        }
      />
    )
  }

  const ok = fc as TpoForecastOk
  return (
    <ForecastLine
      body={
        <>
          <span>
            {/* F129 — `fc.k` is the CONSTANT K = 25, so this always reads
                "(n=25)". It is the neighbour count, not a sample size that grows
                with history. */}
            {TPO_FORECAST_COPY.resultLead}
            {ok.k}
            {TPO_FORECAST_COPY.resultMid}
            <b className="tabular">{forecastValueBand(ok)}</b>
            {TPO_FORECAST_COPY.resultPocSep}
            <b className="tabular" style={{ color: PROFILE_ACCENT }}>
              {ok.predicted_poc.toFixed(2)}
            </b>
            {/* The SERVER's last today-bar close, not the client's `spot`. */}
            {ok.spot != null && (
              <>
                {TPO_FORECAST_COPY.resultSpotSep}
                <b className="tabular">{ok.spot.toFixed(2)}</b>
              </>
            )}
          </span>
          <ForecastExtras fc={ok} />
        </>
      }
      // F130 — `confidence` is printed RAW: an integer 0–100 with no rounding and
      // no `%`, so it reads as a bare number a user will not know is a percent.
      subtitle={forecastSubtitle(ok)}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD 4 — RTH open vs previous values (F132–F162).
// ─────────────────────────────────────────────────────────────────────────────

/** F146 / F147. The row does not exist at all when its price is null. */
function RefLine({ r }: { r: RefRow }) {
  return (
    <div className="flex items-center gap-2 border-t border-line/50 py-1">
      <span className="min-w-[7rem] text-xs" style={{ color: T.muted }}>
        {r.label}
      </span>
      <span className="min-w-[4rem] tabular text-xs font-bold" style={{ color: r.color }}>
        {r.price}
      </span>
      {r.delta && (
        <span className="tabular text-xs font-bold" style={{ color: r.deltaColor ?? T.text }}>
          {r.delta}
        </span>
      )}
    </div>
  )
}

function OpenLocationCard({
  res,
  spot,
  candles,
}: {
  res: TpoResult
  spot: number | null
  candles: readonly EsCandle[]
}) {
  const data = useMemo(() => buildOpenLocation(res, spot, candles), [res, spot, candles])
  const title = <span style={{ color: T.orange }}>{OPEN_LOCATION_TITLE}</span>

  // F133 — the same sentence as F33.
  if (!data) {
    return (
      <Card title={title}>
        <div className="p-4 text-sm" style={{ color: T.text }}>
          {WAITING_ON_CANDLES}
        </div>
      </Card>
    )
  }

  // F139 — both tests are STRICT, so an open exactly ON the VAH is "inside".
  const loc = locationOf(data.openPx, data.prior.vah, data.prior.val)
  const tone = openLocationTone(loc)
  const key = loc ?? 'none'
  const cols = openLocationColumns(data)

  return (
    <Card title={title}>
      <p className={SUBTITLE}>{openLocationSubtitle(data.openPx, spot)}</p>

      {/* F140–F145 */}
      <div
        className={BANNER}
        style={{ borderColor: alpha(tone, 0.33), background: alpha(tone, 0.08) }}
      >
        <div className="text-sm font-bold tracking-wide" style={{ color: tone }}>
          {OPEN_LOCATION_BANNER[key]}
        </div>
        <div className={`mt-1 ${NOTE}`} style={{ color: T.text }}>
          {OPEN_LOCATION_LEAN[key]}
        </div>
      </div>

      {/* F162 */}
      <div className="flex flex-wrap gap-4">
        <div className="min-w-[16rem] flex-1">
          <div className="mb-0.5 text-2xs font-bold uppercase tracking-wide" style={{ color: T.muted }}>
            {openLocationColumnLeft(data.prior.date)}
          </div>
          {cols.left.map((r) => (
            <RefLine key={r.label} r={r} />
          ))}
        </div>
        <div className="min-w-[16rem] flex-1">
          <div className="mb-0.5 text-2xs font-bold uppercase tracking-wide" style={{ color: T.muted }}>
            {OPEN_LOCATION_COLUMN_RIGHT}
          </div>
          {/* F136 — fewer than three merged bins and the whole pw trio is
              replaced by this one line. */}
          {cols.weekMissing && (
            <div className="py-1 text-xs" style={{ color: T.muted }}>
              {OPEN_LOCATION_NO_WEEK}
            </div>
          )}
          {/* F158 / F159 — when there is no open level on a side the price is
              null, `refRow` returns null and the row vanishes, which is why the
              "↑ open level" fallback label is unreachable. */}
          {cols.right.map((r) => (
            <RefLine key={r.label} r={r} />
          ))}
        </div>
      </div>

      <div className={FOOTNOTE}>{OPEN_LOCATION_FOOTNOTE}</div>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD 5 — structure stats (F163–F174).
//
// Hand-rolled: `Table` early-returns its `empty` node INSTEAD of the table,
// which drops the header row F166 needs, and it cannot express the bucket-chip
// line that hangs under each kind's row (F173).
// ─────────────────────────────────────────────────────────────────────────────

function StructureStats({ res }: { res: TpoResult }) {
  const rows = statsRows(res)
  const graded = hasGradedStats(res)

  return (
    <details>
      <summary className={SUMMARY} style={{ borderColor: T.border }}>
        <span className="text-sm font-bold" style={{ color: T.cyan }}>
          {STATS_SUMMARY_TITLE}
        </span>
        <span className="text-2xs font-semibold uppercase tracking-wide" style={{ color: T.text }}>
          {STATS_SUMMARY_NOTE}
        </span>
      </summary>

      <Card title={<span style={{ color: T.cyan }}>{STATS_CARD_TITLE}</span>}>
        {/* The `≥1` is `GRADING_MIN_AGE_SESSIONS`, so the copy and the code
            cannot drift. Calling a tail created twenty minutes ago "untested"
            drags every rate down. */}
        <p className={SUBTITLE}>{statsCardSubtitle(res.sessions.length)}</p>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {STATS_COLUMNS.map((c, i) => (
                  <th key={c} className={`${TH_CLASS} ${i === 0 ? 'text-left' : 'text-right'}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* F174 — spans the column list rather than a typed literal, so the
                  header above it cannot drift away from the span. */}
              {!graded && (
                <tr>
                  <td colSpan={STATS_COLUMNS.length} className={`${TD_CLASS} text-left`} style={{ color: T.text }}>
                    {STATS_EMPTY}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.kind}>
                  {/* F167 — the terse label, coloured by kind. There is NO colour
                      ladder anywhere in this table; the kind colour is the only
                      colour in it. */}
                  <td className={`${TD_CLASS} text-left font-bold`} style={{ color: r.color }}>
                    {r.label}
                    {/* F173 — empty buckets are dropped, so a kind whose buckets
                        are all empty shows its row with no chip line. */}
                    {r.chips.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-2 font-normal" style={{ color: T.text }}>
                        {r.chips.map((c) => (
                          <span key={c.bucket} className="tabular">
                            {c.bucket} <b>{c.testPct}</b> n={c.n}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className={`${TD_CLASS} text-right tabular`} style={{ color: T.text }}>
                    {r.n}
                  </td>
                  <td className={`${TD_CLASS} text-right tabular`} style={{ color: T.text }}>
                    {r.testPct}
                  </td>
                  <td className={`${TD_CLASS} text-right tabular`} style={{ color: T.text }}>
                    {r.repairPct}
                  </td>
                  {/* F171 — the UPPER median sessions-to-test, raw. */}
                  <td className={`${TD_CLASS} text-right tabular`} style={{ color: T.text }}>
                    {r.medD}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </details>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD 6 — the taxonomy (F.11, and the base-rate sentence the tab never said).
//
// Eight kinds, four string tables, the detection and repair rules, and the
// `baseRateFor` ladder at each age bucket. v2 has no such surface: `KIND_MEANING`
// is imported ONLY by the dead `StructureRow`, and `structureBaseRateTooltip` —
// "a base rate for the TYPE, not a probability for this level" — is the sentence
// both dead rails existed to say and neither ever said. Nothing `@notWiredInV2`
// is mounted to say it: this reads the taxonomy and `baseRateFor` directly.
// ─────────────────────────────────────────────────────────────────────────────

function KindBaseRates({ res, kind }: { res: TpoResult; kind: StructureKind }) {
  return (
    <div className="mt-1 flex flex-wrap gap-2 text-xs tabular" style={{ color: T.text }}>
      {AGE_BUCKETS.map((bucket: AgeBucket) => {
        const age = AGE_BUCKET_PROBE[bucket]
        const base = baseRateFor(res, kind, age)
        return (
          <span
            key={bucket}
            className="cursor-help"
            title={structureBaseRateTooltip(kind, age, base)}
          >
            {ageBucket(age)} <b>{pctOrDash(base.rate)}</b> n={base.n}{' '}
            <span style={{ color: T.muted }}>({base.scope})</span>
          </span>
        )
      })}
    </div>
  )
}

function TaxonomyCard({ res }: { res: TpoResult }) {
  return (
    <details>
      <summary className={SUMMARY} style={{ borderColor: T.border }}>
        <span className="text-sm font-bold" style={{ color: T.cyan }}>
          Structure taxonomy
        </span>
        <span className="text-2xs font-semibold uppercase tracking-wide" style={{ color: T.text }}>
          · what each kind means and how it is graded · tap to expand
        </span>
      </summary>

      <Card title={<span style={{ color: T.cyan }}>Structure taxonomy</span>}>
        <p className={SUBTITLE}>
          {`eight kinds · detection and repair · base rate falls back bucket → kind → none below n=${MIN_N}`}
        </p>

        <div className="flex flex-col gap-2">
          {KIND_ORDER.map((kind) => {
            const rule = KIND_RULE[kind]
            // `hole` is the one kind whose side is computed per structure rather
            // than fixed at construction, so it is not in `KIND_SIDE`.
            const side = kind === 'hole' ? HOLE_SIDE_RULE : KIND_SIDE[kind]
            return (
              <div key={kind} className="rounded-sm border border-line px-2 py-1.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={PILL}
                    style={{
                      color: KIND_COLOR[kind],
                      borderColor: alpha(KIND_COLOR[kind], 0.33),
                      background: alpha(KIND_COLOR[kind], 0.1),
                    }}
                  >
                    {KIND_LABEL[kind]}
                  </span>
                  {/* The `" — "` separator here is load-bearing elsewhere:
                      `openLevelLabel` splits on it to build the ↑/↓ open-level
                      rows. Not a hyphen. */}
                  <span className="text-xs font-bold" style={{ color: T.text }}>
                    {KIND_TITLE[kind]}
                  </span>
                  <span className="text-2xs uppercase tracking-wide" style={{ color: T.muted }}>
                    {`${rule.width} · side ${side}`}
                  </span>
                </div>
                <div className={NOTE} style={{ color: T.text }}>
                  {KIND_NOTE[kind]}
                </div>
                {/* F176 — v2 shows this only as a native tooltip on the dead
                    rail's badge. It is the if/then, so it is on screen here and
                    is still the `title=` as well. */}
                <div className={NOTE} title={KIND_MEANING[kind]} style={{ color: T.muted }}>
                  {KIND_MEANING[kind]}
                </div>
                <div className="mt-1 text-2xs leading-relaxed" style={{ color: T.muted }}>
                  <b>detect</b> {rule.detect}
                </div>
                <div className="text-2xs leading-relaxed" style={{ color: T.muted }}>
                  <b>repair</b> {rule.repair}
                </div>
                <KindBaseRates res={res} kind={kind} />
              </div>
            )
          })}
        </div>
      </Card>
    </details>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// THE CANDLE FEED.
//
// Two REST legs in parallel per instrument (`allSettled`, so a dead leg does not
// take the other with it), plus the live frame on v2's 250 ms trailing publish.
// No socket import — v3 non-negotiable 2 — and no second connection to the
// broadcast the data layer already holds.
// ─────────────────────────────────────────────────────────────────────────────

interface CandleFeed {
  today: EsCandleRecord[]
  historical: EsCandleRecord[]
  live: EsCandleRecord[]
  failure: string | null
}

const EMPTY_ROWS: EsCandleRecord[] = []

function useCandleFeed(instrument: TpoInstrument): CandleFeed {
  const [rest, setRest] = useState<{
    today: EsCandleRecord[]
    historical: EsCandleRecord[]
    failure: string | null
  }>({ today: EMPTY_ROWS, historical: EMPTY_ROWS, failure: null })
  const [live, setLive] = useState<EsCandleRecord[]>(EMPTY_ROWS)

  // Departure A — ONE window, the widest the selector can ask for, fired at
  // mount. The day selector never touches this.
  useEffect(() => {
    let alive = true
    setRest({ today: EMPTY_ROWS, historical: EMPTY_ROWS, failure: null })
    void loadTpoCandles(instrument, TPO_HISTORY_DAYS).then((r) => {
      if (!alive) return
      setRest({ today: r.today, historical: r.historical, failure: candleLoadFailureLine(r.failed) })
    })
    return () => {
      alive = false
    }
  }, [instrument])

  // v2's `COALESCE_MS`: the ref is written on EVERY frame so nothing is dropped,
  // and the publish is a 250 ms trailing timer — a 4 Hz render ceiling. The ES
  // hook learned this; the NQ hook never did, and fired `setTodayRows` per frame.
  useEffect(() => {
    const pending = { rows: null as EsCandleRecord[] | null }
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      if (pending.rows) {
        setLive(pending.rows)
        pending.rows = null
      }
    }
    const stop = watchFrame<unknown>(candleFrameType(instrument), (frame) => {
      const rows = liveCandleRows(frame)
      if (!rows.length) return
      pending.rows = rows
      if (timer == null) timer = setTimeout(flush, CANDLE_COALESCE_MS)
    })
    return () => {
      stop()
      if (timer != null) clearTimeout(timer)
      setLive(EMPTY_ROWS)
    }
  }, [instrument])

  return { today: rest.today, historical: rest.historical, live, failure: rest.failure }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE TAB.
// ─────────────────────────────────────────────────────────────────────────────

export default function TpoTab() {
  // F1 / F2 — neither is persisted. No localStorage, no URL param; remounting
  // the tab returns to ESU / 5D.
  const [instrument, setInstrument] = useState<TpoInstrument>(TPO_DEFAULT_INSTRUMENT)
  const [nSessions, setNSessions] = useState<TpoSessionChoice>(TPO_DEFAULT_SESSIONS)

  const feed = useCandleFeed(instrument)

  // F12 / F13 — history first, today's REST bars over it, the live frame last;
  // merged on `slotKey`, ascending by ms. Then the instrument filter, which
  // FALLS BACK to the unfiltered array when it empties — that fallback is why a
  // feed labelling bars `/ES` rather than `ESU25` still draws, and it also means
  // an NQU tab fed only ES bars would silently draw ES.
  const base = useMemo(
    () => [...feed.historical, ...feed.today],
    [feed.historical, feed.today],
  )
  const candles = useMemo(
    () => unionCandles(base, feed.live, instrument),
    [base, feed.live, instrument],
  )

  // F15
  const binSize = binSizeFor(instrument)

  // F14 — bar COUNT plus the last bar's date, deliberately NOT the contents.
  const key = useMemo(() => barCountKey(candles), [candles])

  // F16 — `candles` is deliberately absent from the deps: recomputing a full
  // multi-day structure walk on every intrabar tick is what froze this tab.
  // `spot` moves; the scan does not.
  const candlesRef = useRef(candles)
  candlesRef.current = candles
  const res = useMemo<TpoResult>(
    () => buildTpoStructures(candlesRef.current, binSize),
    [key, binSize],
  )

  // F17 — the last bar's CLOSE, not a live quote.
  const spot = useMemo(() => spotFromCandles(candles), [candles])

  // F18 — derived from the already-memoised scan, so it recomputes once per new
  // bar. Liveness is deliberately NOT computed here.
  const amt = useMemo(() => amtRead(res), [res])

  // F19 / F34 — the rail, then the twelve nearest, which is what the profile
  // draws as dashed lines. `filterByKind` has no control in v2 and gets none
  // here, so the filter is the permanent "all" it has always run at.
  const rail = useMemo(
    () => openRail(res.open, TPO_DEFAULT_KIND_FILTER, spot),
    [res.open, spot],
  )
  const drawn = useMemo(() => drawnLevels(rail), [rail])

  // F22 — the last N BUILT sessions. A session enters `res.sessions` only if its
  // RTH group has >= 6 bars and produced >= 3 price bins, so a day that opened
  // and halted inside 25 minutes is invisible to every panel here.
  const shown = useMemo(() => res.sessions.slice(-nSessions), [res.sessions, nSessions])

  // F21
  const enoughHistory = res.sessions.length >= MIN_SESSIONS_FOR_OPEN_LOCATION

  return (
    <div className="flex flex-col gap-4">
      <ProfileCard
        instrument={instrument}
        onInstrument={setInstrument}
        nSessions={nSessions}
        onSessions={setNSessions}
        shown={shown}
        spot={spot}
        binSize={binSize}
        drawn={drawn}
        failure={feed.failure}
      />

      <AmtPanel amt={amt} spot={spot} binSize={binSize} />

      <ForecastCard instrument={instrument} />

      {enoughHistory && <OpenLocationCard res={res} spot={spot} candles={candles} />}

      <StructureStats res={res} />

      <TaxonomyCard res={res} />
    </div>
  )
}
