// ─────────────────────────────────────────────────────────────────────────────
// GEX LEVELS — THE RENDER LAYER (/v3/scanner?tab=gexlevels).
//
// Spec: docs/parity/scanner.md Part B, rows B1–B335 — the longest Part in the
// inventory. Every threshold, boundary, label string, colour ladder, loader and
// poll cadence is already transcribed and is NOT re-decided here:
//
//   · pages/scanner/gexLevels.ts     — types, maths, copy, the 12-card registry
//   · pages/scanner/gexLevelsData.ts — the six endpoints and their failure modes
//
// This file is wiring. Two rules were missing from the logic module and were
// added THERE rather than inlined here: `fmtDateNoYear` (B104's year-stripped
// axis label) and `callPutDomain` (B235's split-extremes domain).
//
// ── WHAT THIS TAB IS ─────────────────────────────────────────────────────────
// A header card (four stat tiles, two semi-gauges, two read-only filters, one
// refresh) followed by TWELVE cards in two draggable columns:
//
//    1 oiDate         · 2 eodGex       · 3 eodGexEx0dte  · 4 history
//    5 oiExpiry       · 6 netGamma     · 7 netGammaAll   · 8 netGammaEx0dte
//    9 callPutGamma   · 10 netDelta    · 11 netDeltaEx0dte · 12 volFlow
//
// Eleven of the twelve draw hand-rolled inline SVG, which is what v2 does and
// what these charts want: they are small, they re-render on hover and on a pan
// that is already React state, and SVG keeps every colour as a `var(--color-…)`
// string instead of forcing a resolve. Card 12 is the ONLY canvas.
//
// ── SIX THINGS THAT LOOK LIKE MISTAKES AND ARE NOT ───────────────────────────
//
//  1. THE `d`-GATE. All twelve cards sit inside `{d && …}`, so a /proxy/gex
//     outage blanks the four cards that have their own source and may be
//     answering perfectly (both EOD boards, OI-by-date and the history log).
//     That is v2 (B96) and it is reproduced deliberately. THE DATA LAYER NO
//     LONGER REQUIRES IT — every loader is independently awaitable and each
//     card already owns its own loading/empty state — so lifting it is the ONE
//     `d &&` marked below and nothing else. Left for Brandon.
//
//  2. TWO OPPOSITE INTERACTION MODELS, SIDE BY SIDE. The four strike charts
//     implement bespoke wheel-zoom (non-passive listener) and drag-pan; card
//     12's chart sets `handleScale: false` / `handleScroll: false` and has
//     neither. Spec "Do not port" 29 asks for one model; both are transcribed
//     as they are, un-unified.
//
//  3. CARD 12 CONTRADICTS ITSELF. Its subtitle says "5m buckets" and its own
//     panel header, a few pixels below, says "30s buckets · today ET" — because
//     the panel sends `bin=BIN_SEC` = 30 and the subtitle never caught up. v2's
//     string ships as written; the `// BUG (v2):` marker on the registry's
//     `volFlow` subtitle carries the one-line fix.
//
//  4. THE % VIEW'S Δ TILE PRINTS "−0.0pt" IN THE POSITIVE COLOUR at exactly
//     zero. v2's glyph ternary is `> 0` and its ink ternary is `>= 0`. Rendered
//     wrong, on purpose — `volFlowPctTiles` carries the `// BUG (v2):` marker.
//
//  5. THE HISTORY TABLE'S TODAY ROW GOES STALE IN FIVE CELLS. Price, R2, S2,
//     Open Int and Curve are written but are not in the five-field rewrite test
//     (B147), so they can sit stale all session while the row looks live.
//
//  6. THE NET-DELTA CHARTS LABEL THEIR Y AXIS WITH `fmt0`, not `fmtBn` — the
//     only axis on the tab that does, so a delta reads "412,773,000" where
//     every neighbour would read "412.8M" (B250). v2's, kept.
//
// ── NON-NEGOTIABLES ──────────────────────────────────────────────────────────
// · No colour literals. Every colour is a token, and every SVG colour goes
//   through `style` rather than a presentation attribute — an inline
//   declaration is the one place a `var(--color-…)` is guaranteed to resolve.
// · No waterfall. `loadGexLevelsEntry` fires FIVE sources in one call at mount;
//   the sixth hop (/api/chains) is a real data dependency on /proxy/gex's
//   `expirations` field and is the only thing that waits on anything.
// · Polls skip a hidden tab and fire one tick on the way back — `usePoll`, the
//   same semantics `useQuery`'s `pollMs` has, since these five loaders parse
//   and cannot ride `useQuery` directly.
// · Card 12 mounts through `ChartFrame`, honours ONE visibility signal
//   (`onVisibility`, with the initial state read off the handle as the frame's
//   contract requires) and tags its canvases `data-cb-layer`. v2 had none of
//   the three.
// · `useRefreshButton`'s 1800 ms revert timer IS cleared on unmount here. The
//   value is the transcription; v2's leak is not.
//
// ── WHAT IS DELIBERATELY NOT MOUNTED ─────────────────────────────────────────
// `resetLayout` is `@notWiredInV2` — fully implemented, persists correctly, and
// connected to no button in v2 (B97). Not imported. Whether the layout gets a
// reset control is Brandon's call, not this step's.
// ─────────────────────────────────────────────────────────────────────────────

import type { DragEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CrosshairMode, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import { BaselineSeries, ColorType, createChart } from 'lightweight-charts'
import { Card } from '@/design/primitives/Card'
import type { ChartHandle } from '@/design/primitives/ChartFrame'
import { ChartFrame } from '@/design/primitives/ChartFrame'
import { SegGroup } from '@/design/primitives/Controls'
import type { Column } from '@/design/primitives/Table'
import { Table } from '@/design/primitives/Table'
import { T, alpha } from '@/design/theme'
import { EM_DASH } from '@/pages/scanner/format'
import type {
  CardKey,
  CardLayout,
  CardTitleContext,
  ChartGeom,
  ColumnId,
  CurvePt,
  DexBasis,
  EodGexField,
  EodGexRow,
  ExpiryInfo,
  GaugeBand,
  GexLevelsCardDef,
  GexLevelsRow,
  GexLevelsSnapshot,
  GexMultiLadder,
  GexMultiPayload,
  HistoryEntry,
  LegendItem,
  OiByExpiryRow,
  RefreshState,
  VolFlowPoint,
  VolFlowSession,
  VolFlowTile,
} from '@/pages/scanner/gexLevels'
import {
  BAR_WIDTH,
  CALL_LEG_COLOR,
  CHART_GEOM,
  CPG_GAUGE_MAX,
  CPG_GAUGE_MIN,
  CURVE_SPARK_GEOM,
  DEFAULT_LAYOUT,
  DEFAULT_SYMBOL,
  DRAG_COPY,
  DRAG_PAYLOAD_FORMAT,
  EMPTY_COPY,
  EOD_GEX_FIELD_META,
  ERROR_COPY,
  ERROR_INK,
  FLIP_LINE,
  GAUGE_COPY,
  GAUGE_GEOM,
  GEX_LEVELS_CARDS,
  GEX_MULTI_POLL_MS,
  HEADER_COPY,
  HISTORY_COLUMNS,
  HISTORY_CURVE_TITLE,
  LEGEND_CALL_PUT,
  LEGEND_NET_DELTA,
  LEGEND_NET_DELTA_MULTI,
  LEGEND_NET_GAMMA,
  LEGEND_NET_GAMMA_MULTI,
  OI_BAR_COLOR,
  OI_EXPIRY_CHART_COPY,
  PANEL_REFRESH_LABEL,
  PUT_LEG_COLOR,
  REFRESH_LABEL,
  REFRESH_LOCK_MS,
  SPOT_LINE,
  STATUS_COPY,
  TICK_CAP_EOD,
  TICK_CAP_OI_EXPIRY,
  TILE_ACCENT,
  TILE_COPY,
  TILE_TITLE,
  TOOLTIP_COPY,
  VOL_FLOW_COPY,
  VOL_FLOW_DEFAULT_PICK,
  VOL_FLOW_DEFAULT_SESSION,
  VOL_FLOW_PCT_MIN_MOVE,
  VOL_FLOW_POLL_MS,
  VOL_FLOW_SCALES,
  VOL_FLOW_SERIES_SHAPE,
  VOL_FLOW_SESSIONS,
  VOL_FLOW_SIZE_PUMP_FRAMES,
  VOL_FLOW_TILE_COUNT,
  VOL_FLOW_TILE_PLACEHOLDER,
  VOL_FLOW_VIEWS,
  WINDOW_FRAC_DEFAULT,
  WINDOW_FRAC_FULL_CHAIN,
  applyTodayHistoryRow,
  barWidth,
  baselineY,
  buildTodayHistoryRow,
  callPutDomain,
  canPan,
  clampPan,
  computeVolFlowPctStats,
  computeVolFlowStats,
  cpgGaugeBands,
  cumulativeByStrike,
  curveSignOf,
  curveSparkDomain,
  curveToPts,
  deltaBarColor,
  deriveGexLevels,
  dexOf,
  domainWithZero,
  draggedKeyFrom,
  eodBarColor,
  eodLegend,
  eodPlottable,
  eodStatusLine,
  eodZeroLine,
  etClock,
  etHourMinute,
  etTimeFromSec,
  expiryFilterOptions,
  flipInView,
  fmt0,
  fmt2,
  fmtBn,
  fmtDate,
  fmtDateNoYear,
  fmtExpiryLabel,
  fmtGexAxis,
  fmtPctAxis,
  gammaBarColor,
  gammaGaugeBands,
  gammaGaugeSpan,
  gaugeAngle,
  historyCellText,
  loadHistory,
  multiDeltaAllZero,
  multiDeltaStatusLine,
  multiEmptyNote,
  multiStatusLine,
  nextZoom,
  normalizeLayout,
  oiVolNet,
  padDomain,
  panDeltaStrikes,
  panWinHalf,
  pctAutoscaleRange,
  pctPointsOf,
  placeCard,
  plotW,
  pxPerStrike,
  readPctView,
  readStoredLayout,
  refreshInk,
  saveHistory,
  saveLayout,
  scopeNoteAll,
  scopeNoteEx0dte,
  showTickEveryNth,
  showTickOiDate,
  signAreaFill,
  signColor,
  signSegments,
  visibleWindow,
  volFlowChartOptions,
  volFlowDollarSeries,
  volFlowDollarTiles,
  volFlowExpiryOptions,
  volFlowPctSeries,
  volFlowPctTiles,
  volFlowScrimInk,
  volFlowScrimText,
  volFlowScrimVisible,
  volFlowSeriesColors,
  writePctView,
  xScale,
  yScale,
} from '@/pages/scanner/gexLevels'
import type { VolFlowLoad } from '@/pages/scanner/gexLevelsData'
import {
  GEX_POLL_MS,
  loadEodGex,
  loadGexByStrikeMulti,
  loadGexLevelsEntry,
  loadGexSnapshot,
  loadOiByExpiration,
  loadVolGexFlow,
} from '@/pages/scanner/gexLevelsData'

/** v2's `catch` text in both source files. */
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * The two sentences `loadVolGexFlow` needs. Assembled here rather than in the
 * data module, which deliberately declares no user-visible string of its own.
 */
const VOL_FLOW_ERR = { noDb: VOL_FLOW_COPY.errNoDb, feed: VOL_FLOW_COPY.errFeed } as const

// ─────────────────────────────────────────────────────────────────────────────
// § 1 — SHARED PLUMBING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * B19, B211, B279 — one poll, with `useQuery`'s `pollMs` semantics: a tick is
 * SKIPPED while the tab is hidden and one fires immediately on the way back.
 *
 * v2 ran all three of its polls at full rate in a background tab (B274) and
 * hand-rolled the wake-on-visible half in card 12 only, where it made a request
 * MORE eager rather than pausing anything. Both halves are here, once.
 */
function usePoll(tick: () => void, ms: number): void {
  const ref = useRef(tick)
  ref.current = tick
  useEffect(() => {
    const fire = () => {
      if (document.visibilityState !== 'hidden') ref.current()
    }
    const id = setInterval(fire, ms)
    const onVisible = () => {
      if (document.visibilityState === 'visible') ref.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ms])
}

/**
 * B59 — the header card's refresh ladder.
 *
 * `success` on any resolve, `error` on any throw, both reverting after
 * `REFRESH_LOCK_MS`, and the lock held for the whole request PLUS that window
 * so a second click is a no-op. THE TIMER IS CLEARED ON UNMOUNT, which v2 never
 * did — switching tabs mid-refresh fired a setState on an unmounted component.
 */
function useRefreshButton(fn: () => Promise<unknown>): { state: RefreshState; trigger: () => void } {
  const [state, setState] = useState<RefreshState>('idle')
  const locked = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const trigger = useCallback(() => {
    if (locked.current) return
    locked.current = true
    setState('refreshing')
    void fn()
      .then(() => setState('success'))
      .catch(() => setState('error'))
      .finally(() => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          setState('idle')
          locked.current = false
        }, REFRESH_LOCK_MS)
      })
  }, [fn])

  return { state, trigger }
}

type AnyRef<E> = { current: E | null } | ((n: E | null) => void) | null | undefined

/** B66 — one DOM node, two refs: the hover origin and the native wheel target. */
function mergeRefs<E>(...refs: AnyRef<E>[]): (node: E | null) => void {
  return (node: E | null) => {
    for (const r of refs) {
      if (!r) continue
      if (typeof r === 'function') r(node)
      else r.current = node
    }
  }
}

interface HoverPoint {
  idx: number
  x: number
  y: number
}

/**
 * B63 — which mark is under the cursor, and where the cursor is relative to the
 * chart's own `position:relative` wrapper, so an HTML tooltip can follow it.
 */
function useChartHover() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [hover, setHover] = useState<HoverPoint | null>(null)
  const show = useCallback((idx: number, e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setHover({ idx, x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [])
  const hide = useCallback(() => setHover(null), [])
  return { containerRef, hover, show, hide }
}

/**
 * B67–B71 — the four strike charts' shared interaction model. The maths is all
 * imported; this is the event wiring, which is step 3's.
 *
 * `draggingRef` is a REF and not state on purpose: the per-point hover handlers
 * check it synchronously to suppress a tooltip mid-drag, and a state update is
 * one tick too slow for that.
 */
function useChartPan(rows: GexLevelsRow[], spot: number, windowFrac = WINDOW_FRAC_DEFAULT) {
  const sorted = useMemo(() => rows.slice().sort((a, b) => a.strike - b.strike), [rows])
  const minStrike = sorted[0]?.strike ?? spot
  const maxStrike = sorted[sorted.length - 1]?.strike ?? spot
  const [zoom, setZoom] = useState(1)
  const [panOffset, setPanOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const draggingRef = useRef<{ startX: number; startPan: number; pxPerStrike: number } | null>(null)
  const winHalf = panWinHalf(spot, windowFrac, zoom)

  // B68 — React's onWheel is passive and cannot preventDefault the page scroll,
  // so the wheel goes on natively, non-passive, through mergeRefs.
  const wheelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = wheelRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => nextZoom(z, e.deltaY))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const clamp = useCallback(
    (raw: number) => clampPan(raw, { spot, minStrike, maxStrike, winHalf }),
    [spot, minStrike, maxStrike, winHalf],
  )

  const onDragStart = useCallback(
    (clientX: number, px: number) => {
      draggingRef.current = { startX: clientX, startPan: panOffset, pxPerStrike: px }
      setIsDragging(true)
    },
    [panOffset],
  )

  const onDragMove = useCallback(
    (clientX: number) => {
      const drag = draggingRef.current
      if (!drag) return
      const deltaStrikes = panDeltaStrikes(clientX - drag.startX, drag.pxPerStrike)
      setPanOffset(clamp(drag.startPan - deltaStrikes))
    },
    [clamp],
  )

  const onDragEnd = useCallback(() => {
    draggingRef.current = null
    setIsDragging(false)
  }, [])

  // B70 — double-click recentres on spot AND drops the zoom.
  const resetPan = useCallback(() => {
    setPanOffset(0)
    setZoom(1)
  }, [])

  return {
    center: spot + panOffset,
    winHalf,
    isDragging,
    draggingRef,
    wheelRef,
    onDragStart,
    onDragMove,
    onDragEnd,
    resetPan,
    canPan: canPan(minStrike, maxStrike, winHalf),
  }
}

/** B61 — the tab's single empty-state primitive. */
function Empty({ note }: { note: string }) {
  return <div className="p-6 text-center text-sm text-muted opacity-70">{note}</div>
}

/** B62 — the swatch row under a chart. */
function ChartLegend({ items }: { items: readonly LegendItem[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-xs" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/**
 * B65 — the floating tooltip. `left`/`top` are cursor pixels by construction;
 * v2 never clamped it to the container and neither does this.
 */
function ChartTooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-line px-3 py-2 text-xs leading-relaxed text-fg shadow-lg"
      style={{ left: x, top: y, transform: 'translate(-50%, -100%) translateY(-10px)', background: T.panel }}
    >
      {children}
    </div>
  )
}

/** The one refresh affordance for the five panel-level buttons (B125, B179, B220, B262, B300). */
function PanelRefresh({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-auto shrink-0 rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-accent"
    >
      {PANEL_REFRESH_LABEL}
    </button>
  )
}

/** The status + refresh line every data panel carries above its chart. */
function PanelHead({ status, onRefresh }: { status: string; onRefresh: () => void }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-xs text-muted">
      <span>{status}</span>
      <PanelRefresh onClick={onRefresh} />
    </div>
  )
}

/** Every error line on the tab. v2 painted all five the same red (B126, B180, B221, B259). */
function ErrorLine({ text }: { text: string }) {
  return (
    <div className="mb-2 text-sm" style={{ color: ERROR_INK }}>
      {text}
    </div>
  )
}

/**
 * B39–B42 — a header stat tile. v2 called this `AmTbrStat` and carried a doc
 * comment about an AM TBR feature that now lives on /es-candles; renamed for
 * what it is (spec "Do not port" 4).
 *
 * v2's value type was 3px SMALLER than its own label. Not reproduced — that is
 * a type-scale inversion, not a value.
 */
function StatTile({
  label,
  value,
  accent,
  scope,
  title,
}: {
  label: string
  value: string
  accent: string
  scope?: string
  title?: string
}) {
  return (
    <div className="min-w-24 rounded-md border border-line px-3 py-2" title={title}>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xs font-bold uppercase tracking-wider text-muted">{label}</span>
        {scope && (
          <span
            className="rounded-full px-1.5 text-3xs font-bold tracking-wide"
            style={{ color: CALL_LEG_COLOR, background: alpha(CALL_LEG_COLOR, 0.1), border: `1px solid ${alpha(CALL_LEG_COLOR, 0.28)}` }}
          >
            {scope}
          </span>
        )}
      </div>
      <div className="tabular mt-1 text-base font-bold" style={{ color: accent }}>
        {value}
      </div>
    </div>
  )
}

/** B50–B54 — the two header gauges. Geometry and the angle map are imported. */
function SemiGauge({
  caption,
  value,
  min,
  max,
  valueLabel,
  bands,
}: {
  caption: string
  value: number
  min: number
  max: number
  valueLabel: string
  bands: GaugeBand[]
}) {
  const g = GAUGE_GEOM
  const arc = (from: number, to: number) => {
    const a0 = gaugeAngle(from, min, max)
    const a1 = gaugeAngle(to, min, max)
    const x0 = g.cx + g.r * Math.cos(a0)
    const y0 = g.cy - g.r * Math.sin(a0)
    const x1 = g.cx + g.r * Math.cos(a1)
    const y1 = g.cy - g.r * Math.sin(a1)
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${g.r} ${g.r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
  }
  const theta = gaugeAngle(value, min, max)
  const needle = g.r * g.needleFrac

  return (
    <div className="w-48 max-w-full">
      <svg viewBox={`0 0 ${g.w} ${g.h + 8}`} width="100%" className="block">
        {/* Bands paint in array order; a later band paints over an earlier one. */}
        {bands.map((b) => (
          <path key={`${b.from}-${b.to}`} d={arc(b.from, b.to)} strokeWidth={13} opacity={0.9} style={{ stroke: b.color, fill: 'none' }} />
        ))}
        <line
          x1={g.cx}
          y1={g.cy}
          x2={g.cx + needle * Math.cos(theta)}
          y2={g.cy - needle * Math.sin(theta)}
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{ stroke: T.text }}
        />
        <circle cx={g.cx} cy={g.cy} r={4.5} style={{ fill: T.text }} />
        <text x={g.cx} y={82} textAnchor="middle" className="text-lg font-bold" style={{ fill: T.text }}>
          {valueLabel}
        </text>
      </svg>
      <div className="-mt-1.5 text-center text-2xs font-bold uppercase tracking-widest text-muted">{caption}</div>
    </div>
  )
}

/** Y-axis tick. Every chart on the tab puts them at `padL − n`, right-aligned. */
function AxisText({
  x,
  y,
  anchor,
  children,
}: {
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  children: ReactNode
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} className="text-2xs" opacity={0.55} style={{ fill: T.text }}>
      {children}
    </text>
  )
}

/** The 9-unit variant the EOD and OI-by-expiry charts use. */
function AxisTextSmall({
  x,
  y,
  anchor,
  children,
}: {
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  children: ReactNode
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} className="text-3xs" opacity={0.55} style={{ fill: T.text }}>
      {children}
    </text>
  )
}

/** The zero rule every chart draws across its plot. */
function ZeroLine({ g, y }: { g: ChartGeom; y: number }) {
  return <line x1={g.padL} x2={g.w - g.padR} y1={y} y2={y} strokeWidth={1} style={{ stroke: T.border }} />
}

/** The spot marker — ONE treatment, where v2 had three (see SPOT_LINE). */
function SpotLine({ g, x }: { g: ChartGeom; x: number }) {
  return (
    <line
      x1={x}
      x2={x}
      y1={g.padT}
      y2={g.h - g.padB}
      strokeWidth={1}
      strokeDasharray={SPOT_LINE.dash}
      opacity={SPOT_LINE.opacity}
      style={{ stroke: SPOT_LINE.color }}
    />
  )
}

/** The gamma-flip marker — likewise one treatment, where v2 had three. */
function FlipLine({ g, x }: { g: ChartGeom; x: number }) {
  return (
    <line
      x1={x}
      x2={x}
      y1={g.padT}
      y2={g.h - g.padB}
      strokeWidth={1}
      strokeDasharray={FLIP_LINE.dash}
      opacity={FLIP_LINE.opacity}
      style={{ stroke: FLIP_LINE.color }}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2 — CARD 1: OPEN INTEREST BY DATE (B98–B108)
// ─────────────────────────────────────────────────────────────────────────────

function OiByDateChart({ rows }: { rows: HistoryEntry[] }) {
  const { containerRef, hover, show, hide } = useChartHover()
  // B101 — the history array arrives date DESC; this chart re-sorts ASC.
  const data = useMemo(() => rows.slice().sort((a, b) => a.date.localeCompare(b.date)), [rows])
  if (!data.length) return <Empty note={EMPTY_COPY.historyLogging} />

  const g = CHART_GEOM.oiByDate
  const n = data.length
  const y0 = baselineY(g)
  const maxOi = Math.max(1, ...data.map((r) => r.openInt))
  // B103 — a single bar is hard-centred. v2 typed the resulting 382 as a
  // literal; it is padL + half the plot, which is where that number came from.
  const x = (i: number) => (n > 1 ? g.padL + (i / (n - 1)) * plotW(g) : g.padL + plotW(g) / 2)
  const barW = barWidth(plotW(g) / Math.max(n, 1), BAR_WIDTH.oiDate)
  const hp = hover ? data[hover.idx] : null

  return (
    <div ref={containerRef} className="relative">
      <svg
        viewBox={`0 0 ${g.w} ${g.h}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        className="block max-h-[240px]"
        onMouseLeave={hide}
      >
        <ZeroLine g={g} y={y0} />
        {data.map((r, i) => {
          const h = Math.max(1, (r.openInt / maxOi) * (y0 - g.padT))
          return (
            <rect
              key={r.date}
              x={x(i) - barW / 2}
              y={y0 - h}
              width={barW}
              height={h}
              opacity={hover?.idx === i ? 1 : 0.8}
              className="cursor-crosshair"
              // B103 — OI is never negative, so this is a series colour and not
              // a sign ladder: it stays the accent.
              style={{ fill: OI_BAR_COLOR }}
              onMouseMove={(e) => show(i, e)}
            />
          )
        })}
        {data.map((r, i) =>
          showTickOiDate(i, n) ? (
            <AxisText key={r.date} x={x(i)} y={y0 + 16} anchor="middle">
              {fmtDateNoYear(r.date)}
            </AxisText>
          ) : null,
        )}
        <AxisText x={g.padL - 8} y={g.padT + 4} anchor="end">
          {fmt0(maxOi)}
        </AxisText>
        <AxisText x={g.padL - 8} y={y0 + 4} anchor="end">
          {fmt0(0)}
        </AxisText>
      </svg>
      {/* B64 — the stale-hover guard, on all seven hover-capable charts: zoom,
          pan or a refresh rebuilds the slice while `hover.idx` still points at
          the old one. Render nothing rather than throw mid-render. */}
      {hover && hp && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div className="font-bold">{fmtDate(hp.date)}</div>
          <div>{TOOLTIP_COPY.totalOi(hp.openInt)}</div>
        </ChartTooltip>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3 — CARDS 2 & 3: EOD GEX BY SESSION (B109–B136)
// ─────────────────────────────────────────────────────────────────────────────

function EodGexBarChart({ rows, field }: { rows: EodGexRow[]; field: EodGexField }) {
  const { containerRef, hover, show, hide } = useChartHover()
  // B116 — a session with a null on THIS basis is dropped, never plotted at 0.
  const data = eodPlottable(rows, field)
  if (!data.length) return <Empty note={EOD_GEX_FIELD_META[field].empty} />

  const g = CHART_GEOM.eodGex
  const n = data.length
  const vals = data.map((r) => r[field] as number)
  const maxAbs = Math.max(1, ...vals.map((v) => Math.abs(v)))
  const zero = eodZeroLine(g, vals)
  const slotW = plotW(g) / n
  const barW = barWidth(slotW, BAR_WIDTH.eodSession)
  const hp = hover ? data[hover.idx] : null

  return (
    <div ref={containerRef} className="relative">
      <svg
        viewBox={`0 0 ${g.w} ${g.h}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        className="block"
        onMouseLeave={hide}
      >
        <ZeroLine g={g} y={zero.yZero} />
        {data.map((r, i) => {
          const v = r[field] as number
          const h = Math.max(1, (Math.abs(v) / maxAbs) * zero.half)
          const cx = g.padL + slotW * (i + 0.5)
          return (
            <rect
              key={r.date}
              x={cx - barW / 2}
              y={v >= 0 ? zero.yZero - h : zero.yZero}
              width={barW}
              height={h}
              opacity={hover?.idx === i ? 1 : 0.85}
              className="cursor-crosshair"
              style={{ fill: eodBarColor(v) }}
              onMouseMove={(e) => show(i, e)}
            />
          )
        })}
        {data.map((r, i) =>
          showTickEveryNth(i, n, TICK_CAP_EOD) ? (
            <AxisTextSmall key={r.date} x={g.padL + slotW * (i + 0.5)} y={g.h - g.padB + 16} anchor="middle">
              {fmtExpiryLabel(r.date)}
            </AxisTextSmall>
          ) : null,
        )}
        {/* B132 — an all-negative set prints "0" for its TOP label and "0" again
            at the zero line, because the top label is `hasPos ? maxAbs : 0`. */}
        <AxisTextSmall x={g.padL - 6} y={g.padT + 4} anchor="end">
          {fmtBn(zero.hasPos ? maxAbs : 0)}
        </AxisTextSmall>
        <AxisTextSmall x={g.padL - 6} y={zero.yZero + 4} anchor="end">
          {fmtBn(0)}
        </AxisTextSmall>
        {zero.hasPos && zero.hasNeg && (
          <AxisTextSmall x={g.padL - 6} y={g.padT + (g.h - g.padT - g.padB) + 4} anchor="end">
            {fmtBn(-maxAbs)}
          </AxisTextSmall>
        )}
      </svg>
      {hover && hp && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div className="font-bold">{fmtDate(hp.date)}</div>
          <div>{TOOLTIP_COPY.eodValue(field, hp[field] as number)}</div>
          <div>{TOOLTIP_COPY.spxClose(hp.spot)}</div>
        </ChartTooltip>
      )}
    </div>
  )
}

function EodGexPanel({
  rows,
  field,
  loading,
  error,
  loadedAt,
  onRefresh,
}: {
  rows: EodGexRow[]
  field: EodGexField
  loading: boolean
  error: string | null
  loadedAt: number | null
  onRefresh: () => void
}) {
  const hasData = eodPlottable(rows, field).length > 0
  return (
    <>
      <PanelHead status={eodStatusLine(rows, field, loading, loadedAt)} onRefresh={onRefresh} />
      {error && <ErrorLine text={ERROR_COPY.eod(error)} />}
      {/* B126 — the chart still renders under the error line when there is data. */}
      {hasData ? (
        <>
          <EodGexBarChart rows={rows} field={field} />
          <ChartLegend items={eodLegend(field)} />
        </>
      ) : (
        !error && <Empty note={loading ? EMPTY_COPY.eodLoading : EOD_GEX_FIELD_META[field].empty} />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4 — CARD 4: THE DAILY KEY-LEVEL LOG (B137–B168)
// ─────────────────────────────────────────────────────────────────────────────

/** B164–B168 — the inline sparkline in the table's Curve column. */
function CurveSpark({ pts, neutral }: { pts: CurvePt[]; neutral: number | null }) {
  const g = CURVE_SPARK_GEOM
  const dom = curveSparkDomain(pts)
  if (!dom) return null
  const x = (k: number) => ((k - dom.xlo) / (dom.xhi - dom.xlo || 1)) * g.w
  const y = (v: number) => g.h - g.padY - ((v - dom.lo) / (dom.hi - dom.lo || 1)) * (g.h - g.padY * 2)
  const y0 = y(0)

  return (
    <svg viewBox={`0 0 ${g.w} ${g.h}`} width={g.w} height={g.h} aria-hidden className="block">
      <line x1={0} x2={g.w} y1={y0} y2={y0} strokeWidth={1} style={{ stroke: T.border }} />
      {signSegments(pts).map((seg, i) => {
        const first = seg.pts[0]
        const last = seg.pts[seg.pts.length - 1]
        if (!first || !last) return null
        const line = seg.pts
          .map((p, j) => `${j === 0 ? 'M' : 'L'} ${x(p.strike).toFixed(2)} ${y(p.cum).toFixed(2)}`)
          .join(' ')
        const area = `${line} L ${x(last.strike).toFixed(2)} ${y0.toFixed(2)} L ${x(first.strike).toFixed(2)} ${y0.toFixed(2)} Z`
        return (
          <g key={i}>
            <path d={area} style={{ fill: signAreaFill(seg.sign), stroke: 'none' }} />
            <path d={line} strokeWidth={1.25} style={{ fill: 'none', stroke: signColor(seg.sign) }} />
          </g>
        )
      })}
      {/* The in-view test is `flipInView` everywhere on this tab now — see the
          note on it: v2's cumulative chart was the one place without it. */}
      {flipInView(neutral, dom.xlo, dom.xhi) && (
        <line
          x1={x(neutral as number)}
          x2={x(neutral as number)}
          y1={0}
          y2={g.h}
          strokeWidth={1}
          strokeDasharray={FLIP_LINE.dash}
          opacity={FLIP_LINE.opacity}
          style={{ stroke: FLIP_LINE.color }}
        />
      )}
    </svg>
  )
}

function HistoryTable({ rows }: { rows: HistoryEntry[] }) {
  // B151 — there is NO sort UI. Row order is the merge's (date DESC) with today
  // prepended at index 0. No header handler, no direction indicator.
  const columns: Column<HistoryEntry>[] = HISTORY_COLUMNS.map((c) => ({
    key: c.key,
    header: c.label,
    align: c.align,
    numeric: c.key !== 'date' && c.key !== 'curve',
    cell: (row: HistoryEntry) =>
      c.key === 'curve' ? (
        <div className="flex justify-center" title={HISTORY_CURVE_TITLE}>
          {row.curve && row.curve.length > 1 ? (
            <CurveSpark pts={curveToPts(row.curve)} neutral={row.neutral} />
          ) : (
            <span className="text-faint">{EM_DASH}</span>
          )}
        </div>
      ) : (
        historyCellText(row, c.key)
      ),
  }))

  return (
    <div className="max-h-[320px] overflow-auto rounded-md border border-line">
      <Table<HistoryEntry>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.date}
        empty={EMPTY_COPY.historyLogging}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5 — CARD 5: OPEN INTEREST BY EXPIRATION (B169–B189)
// ─────────────────────────────────────────────────────────────────────────────

function OiByExpiryMiniChart({
  rows,
  valueKey,
  label,
  color,
}: {
  rows: OiByExpiryRow[]
  valueKey: 'callOI' | 'putOI'
  label: string
  color: string
}) {
  const { containerRef, hover, show, hide } = useChartHover()
  if (!rows.length) return <Empty note={EMPTY_COPY.noExpirations} />

  const g = CHART_GEOM.oiByExpiry
  const n = rows.length
  const y0 = baselineY(g)
  const maxV = Math.max(1, ...rows.map((r) => r[valueKey]))
  const slotW = plotW(g) / n
  const barW = barWidth(slotW, BAR_WIDTH.oiExpiry)
  const hp = hover ? rows[hover.idx] : null

  return (
    <div ref={containerRef} className="relative">
      <div className="mb-0.5 text-center text-2xs font-bold uppercase tracking-widest" style={{ color }}>
        {label}
      </div>
      <svg
        viewBox={`0 0 ${g.w} ${g.h}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        className="block max-h-[200px]"
        onMouseLeave={hide}
      >
        {rows.map((r, i) => {
          const h = Math.max(1, (r[valueKey] / maxV) * (y0 - g.padT))
          const cx = g.padL + slotW * (i + 0.5)
          return (
            <rect
              key={r.expiry}
              x={cx - barW / 2}
              y={y0 - h}
              width={barW}
              height={h}
              opacity={hover?.idx === i ? 1 : 0.85}
              className="cursor-crosshair"
              style={{ fill: color }}
              onMouseMove={(e) => show(i, e)}
            />
          )
        })}
        {rows.map((r, i) =>
          showTickEveryNth(i, n, TICK_CAP_OI_EXPIRY) ? (
            <AxisTextSmall key={r.expiry} x={g.padL + slotW * (i + 0.5)} y={y0 + 14} anchor="middle">
              {fmtExpiryLabel(r.expiry)}
            </AxisTextSmall>
          ) : null,
        )}
        {/* B187 — `fmtBn` on a CONTRACT COUNT, so an axis can read "1.2M" while
            the tooltip beside it reads "1,240,000". v2's; spec open question 9. */}
        <AxisTextSmall x={g.padL - 6} y={g.padT + 4} anchor="end">
          {fmtBn(maxV)}
        </AxisTextSmall>
        <AxisTextSmall x={g.padL - 6} y={y0 + 4} anchor="end">
          {fmtBn(0)}
        </AxisTextSmall>
      </svg>
      {hover && hp && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div className="font-bold">{fmtDate(hp.expiry)}</div>
          <div>{TOOLTIP_COPY.legOi(label, hp[valueKey])}</div>
        </ChartTooltip>
      )}
    </div>
  )
}

function OiByExpirationPanel({
  rows,
  loading,
  error,
  loadedAt,
  onRefresh,
}: {
  rows: OiByExpiryRow[]
  loading: boolean
  error: string | null
  loadedAt: number | null
  onRefresh: () => void
}) {
  const status = loading
    ? STATUS_COPY.loading
    : loadedAt != null
      ? STATUS_COPY.oiLoaded(etHourMinute(loadedAt))
      : STATUS_COPY.none
  return (
    <>
      <PanelHead status={status} onRefresh={onRefresh} />
      {error && <ErrorLine text={ERROR_COPY.oiExpiry(error)} />}
      {!rows.length && !error ? (
        <Empty note={loading ? EMPTY_COPY.oiLoading : EMPTY_COPY.oiNoData} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <OiByExpiryMiniChart
            rows={rows}
            valueKey={OI_EXPIRY_CHART_COPY.call.valueKey}
            label={OI_EXPIRY_CHART_COPY.call.label}
            color={OI_EXPIRY_CHART_COPY.call.color}
          />
          <OiByExpiryMiniChart
            rows={rows}
            valueKey={OI_EXPIRY_CHART_COPY.put.valueKey}
            label={OI_EXPIRY_CHART_COPY.put.label}
            color={OI_EXPIRY_CHART_COPY.put.color}
          />
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6 — CARD 6: CUMULATIVE 0DTE NET GAMMA (B190–B205)
// ─────────────────────────────────────────────────────────────────────────────

function NetGammaCurveChart({
  rows,
  spot,
  neutral,
}: {
  rows: GexLevelsRow[]
  spot: number
  neutral: number | null
}) {
  const { containerRef, hover, show, hide } = useChartHover()
  // B193 — windowFrac 1: the default half-window is a whole spot, wider than the
  // listed chain, so every strike is on screen at first paint.
  const pan = useChartPan(rows, spot, WINDOW_FRAC_FULL_CHAIN)
  // The cumulative curve is computed over the WHOLE chain and only then
  // windowed, so the zero crossing lands on the real flip.
  const cumAll = useMemo(() => cumulativeByStrike(rows), [rows])
  if (!rows.length) return <Empty note={EMPTY_COPY.noChainRows} />

  const g = CHART_GEOM.netGammaCurve
  const shown = visibleWindow(cumAll, pan.center, pan.winHalf, (p) => p.strike)
  const first = shown[0]
  const last = shown[shown.length - 1]
  if (!first || !last) return <Empty note={EMPTY_COPY.noChainRows} />

  const xlo = first.strike
  const xhi = last.strike
  const x = xScale(g, xlo, xhi)
  const px = pxPerStrike(g, xlo, xhi)
  const raw = domainWithZero(shown.map((p) => p.cum))
  // B195 — 8% of the span on each side. Note the AXIS LABELS print the UNPADDED
  // extremes, which is v2's and is what makes the top tick land inside the plot.
  const dom = padDomain(raw.min, raw.max)
  const y = yScale(g, dom.min, dom.max)
  const y0 = y(0)
  const hp = hover ? shown[hover.idx] : null

  return (
    <div
      ref={mergeRefs<HTMLDivElement>(containerRef, pan.wheelRef)}
      className="relative"
      style={{
        cursor: pan.canPan ? (pan.isDragging ? 'grabbing' : 'grab') : 'default',
        userSelect: pan.isDragging ? 'none' : undefined,
      }}
      onMouseDown={(e) => {
        e.preventDefault()
        pan.onDragStart(e.clientX, px)
      }}
      onMouseMove={(e) => pan.onDragMove(e.clientX)}
      onMouseUp={pan.onDragEnd}
      onMouseLeave={() => {
        pan.onDragEnd()
        hide()
      }}
      onDoubleClick={pan.resetPan}
    >
      <svg viewBox={`0 0 ${g.w} ${g.h}`} width="100%" preserveAspectRatio="xMidYMid meet" className="block max-h-[240px]">
        <ZeroLine g={g} y={y0} />
        {signSegments(shown).map((seg, i) => {
          const segFirst = seg.pts[0]
          const segLast = seg.pts[seg.pts.length - 1]
          if (!segFirst || !segLast) return null
          const line = seg.pts
            .map((p, j) => `${j === 0 ? 'M' : 'L'} ${x(p.strike).toFixed(2)} ${y(p.cum).toFixed(2)}`)
            .join(' ')
          const area = `${line} L ${x(segLast.strike).toFixed(2)} ${y0.toFixed(2)} L ${x(segFirst.strike).toFixed(2)} ${y0.toFixed(2)} Z`
          return (
            <g key={i}>
              <path d={area} style={{ fill: signAreaFill(seg.sign), stroke: 'none' }} />
              <path d={line} strokeWidth={2} style={{ fill: 'none', stroke: signColor(seg.sign) }} />
            </g>
          )
        })}
        {flipInView(neutral, xlo, xhi) && <FlipLine g={g} x={x(neutral as number)} />}
        <SpotLine g={g} x={x(spot)} />
        {/* B200 — invisible hit targets. The HOVERED dot is drawn SMALLER (4)
            than the untouched ones (7); that is v2's, not a transposition. */}
        {shown.map((p, i) => (
          <circle
            key={p.strike}
            cx={x(p.strike)}
            cy={y(p.cum)}
            r={hover?.idx === i ? 4 : 7}
            style={{ cursor: 'inherit', fill: hover?.idx === i ? signColor(curveSignOf(p.cum)) : 'transparent' }}
            onMouseMove={(e) => {
              if (!pan.draggingRef.current) show(i, e)
            }}
          />
        ))}
        {[raw.min, 0, raw.max].map((v) => (
          <AxisText key={`y${v}`} x={g.padL - 8} y={y(v) + 4} anchor="end">
            {fmtBn(v)}
          </AxisText>
        ))}
        {[xlo, (xlo + xhi) / 2, xhi].map((k) => (
          <AxisText key={`x${k}`} x={x(k)} y={g.h - g.padB + 16} anchor="middle">
            {fmt0(k)}
          </AxisText>
        ))}
      </svg>
      {hover && hp && !pan.isDragging && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div className="font-bold">{TOOLTIP_COPY.strike(hp.strike)}</div>
          <div className="font-semibold" style={{ color: signColor(curveSignOf(hp.cum)) }}>
            {TOOLTIP_COPY.cumulativeGamma(hp.cum)}
          </div>
        </ChartTooltip>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7 — CARDS 7 & 8: MULTI-EXPIRY GAMMA BARS (B206–B231)
// ─────────────────────────────────────────────────────────────────────────────

function NetGammaBarsChart({
  rows,
  spot,
  neutral,
}: {
  rows: GexLevelsRow[]
  spot: number
  neutral: number | null
}) {
  const { containerRef, hover, show, hide } = useChartHover()
  const pan = useChartPan(rows, spot)
  const sortedAll = useMemo(() => rows.slice().sort((a, b) => a.strike - b.strike), [rows])
  if (!rows.length) return <Empty note={EMPTY_COPY.noChainRows} />

  const g = CHART_GEOM.netGammaBars
  const shown = visibleWindow(sortedAll, pan.center, pan.winHalf, (r) => r.strike)
  const first = shown[0]
  const last = shown[shown.length - 1]
  if (!first || !last) return <Empty note={EMPTY_COPY.noChainRows} />

  const xlo = first.strike
  const xhi = last.strike
  const x = xScale(g, xlo, xhi)
  const px = pxPerStrike(g, xlo, xhi)
  // B226 — no 8% padding here, unlike the cumulative chart.
  const dom = domainWithZero(shown.map((r) => oiVolNet(r)))
  const y = yScale(g, dom.min, dom.max)
  const y0 = y(0)
  const barW = barWidth(plotW(g) / shown.length, BAR_WIDTH.strikeBars)
  const hp = hover ? shown[hover.idx] : null

  return (
    <div
      ref={mergeRefs<HTMLDivElement>(containerRef, pan.wheelRef)}
      className="relative"
      style={{
        cursor: pan.canPan ? (pan.isDragging ? 'grabbing' : 'grab') : 'default',
        userSelect: pan.isDragging ? 'none' : undefined,
      }}
      onMouseDown={(e) => {
        e.preventDefault()
        pan.onDragStart(e.clientX, px)
      }}
      onMouseMove={(e) => pan.onDragMove(e.clientX)}
      onMouseUp={pan.onDragEnd}
      onMouseLeave={() => {
        pan.onDragEnd()
        hide()
      }}
      onDoubleClick={pan.resetPan}
    >
      <svg viewBox={`0 0 ${g.w} ${g.h}`} width="100%" preserveAspectRatio="xMidYMid meet" className="block max-h-[240px]">
        <ZeroLine g={g} y={y0} />
        {shown.map((r, i) => {
          const v = oiVolNet(r)
          return (
            <rect
              key={r.strike}
              x={x(r.strike) - barW / 2}
              y={v >= 0 ? y(v) : y0}
              width={barW}
              height={Math.max(1, Math.abs(y(v) - y0))}
              opacity={hover?.idx === i ? 1 : 0.85}
              style={{ fill: gammaBarColor(v) }}
              onMouseMove={(e) => {
                if (!pan.draggingRef.current) show(i, e)
              }}
            />
          )
        })}
        {flipInView(neutral, xlo, xhi) && <FlipLine g={g} x={x(neutral as number)} />}
        <SpotLine g={g} x={x(spot)} />
        {[dom.min, 0, dom.max].map((v) => (
          <AxisText key={`y${v}`} x={g.padL - 8} y={y(v) + 4} anchor="end">
            {fmtBn(v)}
          </AxisText>
        ))}
        {[xlo, (xlo + xhi) / 2, xhi].map((k) => (
          <AxisText key={`x${k}`} x={x(k)} y={g.h - g.padB + 16} anchor="middle">
            {fmt0(k)}
          </AxisText>
        ))}
      </svg>
      {hover && hp && !pan.isDragging && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div className="font-bold">{TOOLTIP_COPY.strike(hp.strike)}</div>
          {/* B230 — plain ink, NOT sign-coloured, unlike the cumulative chart. */}
          <div>{TOOLTIP_COPY.netGamma(oiVolNet(hp))}</div>
        </ChartTooltip>
      )}
    </div>
  )
}

function NetGammaMultiPanel({
  ladder,
  spot,
  scopeNote,
  loading,
  error,
  onRefresh,
}: {
  ladder: GexMultiLadder | null
  spot: number
  scopeNote: string
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  const rows = ladder?.rows ?? []
  return (
    <>
      <PanelHead status={multiStatusLine(ladder, loading, scopeNote)} onRefresh={onRefresh} />
      {/* B221 — the SAME shared error, worded as GEX here and as DEX on card 11. */}
      {error && <ErrorLine text={ERROR_COPY.multiGamma(error)} />}
      {rows.length ? (
        <>
          <NetGammaBarsChart rows={rows} spot={spot} neutral={ladder?.gexFlip ?? null} />
          <ChartLegend items={LEGEND_NET_GAMMA_MULTI} />
        </>
      ) : (
        <Empty note={multiEmptyNote(loading, error)} />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// § 8 — CARD 9: CALL/PUT GAMMA BY STRIKE (B232–B243)
// ─────────────────────────────────────────────────────────────────────────────

function CallPutGammaChart({ rows, spot }: { rows: GexLevelsRow[]; spot: number }) {
  const { containerRef, hover, show, hide } = useChartHover()
  const pan = useChartPan(rows, spot)
  const sortedAll = useMemo(() => rows.slice().sort((a, b) => a.strike - b.strike), [rows])
  if (!rows.length) return <Empty note={EMPTY_COPY.noChainRows} />

  const g = CHART_GEOM.callPutGamma
  const shown = visibleWindow(sortedAll, pan.center, pan.winHalf, (r) => r.strike)
  const first = shown[0]
  const last = shown[shown.length - 1]
  if (!first || !last) return <Empty note={EMPTY_COPY.noChainRows} />

  const xlo = first.strike
  const xhi = last.strike
  const x = xScale(g, xlo, xhi)
  const px = pxPerStrike(g, xlo, xhi)
  const dom = callPutDomain(
    shown.map((r) => r.callGEX ?? 0),
    shown.map((r) => r.putGEX ?? 0),
  )
  const y = yScale(g, dom.min, dom.max)
  const y0 = y(0)
  const slotW = plotW(g) / shown.length
  const barW = barWidth(slotW, BAR_WIDTH.callPutPaired)
  const hp = hover ? shown[hover.idx] : null

  return (
    <div
      ref={mergeRefs<HTMLDivElement>(containerRef, pan.wheelRef)}
      className="relative"
      style={{
        cursor: pan.canPan ? (pan.isDragging ? 'grabbing' : 'grab') : 'default',
        userSelect: pan.isDragging ? 'none' : undefined,
      }}
      onMouseDown={(e) => {
        e.preventDefault()
        pan.onDragStart(e.clientX, px)
      }}
      onMouseMove={(e) => pan.onDragMove(e.clientX)}
      onMouseUp={pan.onDragEnd}
      onMouseLeave={() => {
        pan.onDragEnd()
        hide()
      }}
      onDoubleClick={pan.resetPan}
    >
      <svg viewBox={`0 0 ${g.w} ${g.h}`} width="100%" preserveAspectRatio="xMidYMid meet" className="block max-h-[240px]">
        <ZeroLine g={g} y={y0} />
        {shown.map((r, i) => {
          const cv = r.callGEX ?? 0
          const pv = r.putGEX ?? 0
          // A 1-unit gutter centred on the strike: call left, put right.
          return (
            <g
              key={r.strike}
              onMouseMove={(e) => {
                if (!pan.draggingRef.current) show(i, e)
              }}
            >
              <rect
                x={x(r.strike) - barW - 0.5}
                y={cv >= 0 ? y(cv) : y0}
                width={barW}
                height={Math.max(1, Math.abs(y(cv) - y0))}
                opacity={hover?.idx === i ? 1 : 0.85}
                style={{ cursor: 'inherit', fill: CALL_LEG_COLOR }}
              />
              <rect
                x={x(r.strike) + 0.5}
                y={pv >= 0 ? y(pv) : y0}
                width={barW}
                height={Math.max(1, Math.abs(y(pv) - y0))}
                opacity={hover?.idx === i ? 1 : 0.85}
                style={{ cursor: 'inherit', fill: PUT_LEG_COLOR }}
              />
            </g>
          )
        })}
        {/* B240 — this chart takes no `neutral` at all. There is no flip line. */}
        <SpotLine g={g} x={x(spot)} />
        {[dom.min, 0, dom.max].map((v) => (
          <AxisText key={`y${v}`} x={g.padL - 8} y={y(v) + 4} anchor="end">
            {fmtBn(v)}
          </AxisText>
        ))}
        {[xlo, (xlo + xhi) / 2, xhi].map((k) => (
          <AxisText key={`x${k}`} x={x(k)} y={g.h - g.padB + 16} anchor="middle">
            {fmt0(k)}
          </AxisText>
        ))}
      </svg>
      {hover && hp && !pan.isDragging && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div className="font-bold">{TOOLTIP_COPY.strike(hp.strike)}</div>
          <div>{TOOLTIP_COPY.callGex(hp.callGEX)}</div>
          <div>{TOOLTIP_COPY.putGex(hp.putGEX)}</div>
        </ChartTooltip>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// § 9 — CARDS 10 & 11: NET DELTA BY STRIKE (B244–B262)
// ─────────────────────────────────────────────────────────────────────────────

function NetDeltaChart({
  rows,
  spot,
  basis,
}: {
  rows: GexLevelsRow[]
  spot: number
  basis: DexBasis
}) {
  const { containerRef, hover, show, hide } = useChartHover()
  const pan = useChartPan(rows, spot)
  const sortedAll = useMemo(() => rows.slice().sort((a, b) => a.strike - b.strike), [rows])
  if (!rows.length) return <Empty note={EMPTY_COPY.noChainRows} />

  const g = CHART_GEOM.netDelta
  const shown = visibleWindow(sortedAll, pan.center, pan.winHalf, (r) => r.strike)
  const first = shown[0]
  const last = shown[shown.length - 1]
  if (!first || !last) return <Empty note={EMPTY_COPY.noChainRows} />

  const xlo = first.strike
  const xhi = last.strike
  const x = xScale(g, xlo, xhi)
  const px = pxPerStrike(g, xlo, xhi)
  const dom = domainWithZero(shown.map((r) => dexOf(r, basis)))
  const y = yScale(g, dom.min, dom.max)
  const y0 = y(0)
  const barW = barWidth(plotW(g) / shown.length, BAR_WIDTH.strikeBars)
  const hp = hover ? shown[hover.idx] : null

  return (
    <div
      ref={mergeRefs<HTMLDivElement>(containerRef, pan.wheelRef)}
      className="relative"
      style={{
        cursor: pan.canPan ? (pan.isDragging ? 'grabbing' : 'grab') : 'default',
        userSelect: pan.isDragging ? 'none' : undefined,
      }}
      onMouseDown={(e) => {
        e.preventDefault()
        pan.onDragStart(e.clientX, px)
      }}
      onMouseMove={(e) => pan.onDragMove(e.clientX)}
      onMouseUp={pan.onDragEnd}
      onMouseLeave={() => {
        pan.onDragEnd()
        hide()
      }}
      onDoubleClick={pan.resetPan}
    >
      <svg viewBox={`0 0 ${g.w} ${g.h}`} width="100%" preserveAspectRatio="xMidYMid meet" className="block max-h-[240px]">
        <ZeroLine g={g} y={y0} />
        {shown.map((r, i) => {
          const v = dexOf(r, basis)
          return (
            <rect
              key={r.strike}
              x={x(r.strike) - barW / 2}
              y={v >= 0 ? y(v) : y0}
              width={barW}
              height={Math.max(1, Math.abs(y(v) - y0))}
              opacity={hover?.idx === i ? 1 : 0.85}
              style={{ fill: deltaBarColor(v) }}
              onMouseMove={(e) => {
                if (!pan.draggingRef.current) show(i, e)
              }}
            />
          )
        })}
        <SpotLine g={g} x={x(spot)} />
        {/* B250 — `fmt0`, not `fmtBn`: the only Y axis on the tab that spells a
            magnitude out in full. v2's, kept. */}
        {[dom.min, 0, dom.max].map((v) => (
          <AxisText key={`y${v}`} x={g.padL - 8} y={y(v) + 4} anchor="end">
            {fmt0(v)}
          </AxisText>
        ))}
        {[xlo, (xlo + xhi) / 2, xhi].map((k) => (
          <AxisText key={`x${k}`} x={x(k)} y={g.h - g.padB + 16} anchor="middle">
            {fmt0(k)}
          </AxisText>
        ))}
      </svg>
      {hover && hp && !pan.isDragging && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div className="font-bold">{TOOLTIP_COPY.strike(hp.strike)}</div>
          <div>{TOOLTIP_COPY.netDelta(dexOf(hp, basis))}</div>
          {/* B252/B261 — the split-legs line renders on the "oivol" basis only,
              i.e. only on card 11. */}
          {basis === 'oivol' && (
            <div className="opacity-60">{TOOLTIP_COPY.netDeltaLegs(hp.netDEX ?? 0, hp.volNetDEX ?? 0)}</div>
          )}
        </ChartTooltip>
      )}
    </div>
  )
}

function NetDeltaMultiPanel({
  ladder,
  spot,
  scopeNote,
  loading,
  error,
  onRefresh,
}: {
  ladder: GexMultiLadder | null
  spot: number
  scopeNote: string
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  const rows = ladder?.rows ?? []
  const allZero = multiDeltaAllZero(ladder)
  return (
    <>
      <PanelHead status={multiDeltaStatusLine(ladder, loading, scopeNote)} onRefresh={onRefresh} />
      {error && <ErrorLine text={ERROR_COPY.multiDelta(error)} />}
      {!rows.length ? (
        <Empty note={multiEmptyNote(loading, error)} />
      ) : allZero ? (
        // Say so instead of drawing a convincing flat line.
        <Empty note={EMPTY_COPY.multiDeltaAllZero} />
      ) : (
        <>
          <NetDeltaChart rows={rows} spot={spot} basis="oivol" />
          <ChartLegend items={LEGEND_NET_DELTA_MULTI} />
        </>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// § 10 — CARD 12: NET VOL GEX FLOW (B263–B266, B275–B334)
//
// The tab's ONLY canvas, and the only card that owns its own request. It takes
// no props — picker, session switch, view switch, fetch and poll are all its
// own, because the same panel renders on /home.
// ─────────────────────────────────────────────────────────────────────────────

function VolFlowTiles({ tiles }: { tiles: VolFlowTile[] }) {
  // B317 — six placeholder tiles when there are no stats, so the block's height
  // is fixed and the chart underneath never moves.
  const shown = tiles.length ? tiles : Array.from({ length: VOL_FLOW_TILE_COUNT }, () => VOL_FLOW_TILE_PLACEHOLDER)
  return (
    <div className="grid shrink-0 grid-cols-3 gap-1">
      {shown.map((t, i) => (
        <div key={`${t.label}-${i}`} className="min-w-0 rounded-sm border border-line px-2 py-1">
          <div className="truncate text-3xs font-bold uppercase tracking-wider text-muted">{t.label}</div>
          <div className="tabular truncate text-sm font-bold leading-tight" style={{ color: t.color }}>
            {t.value}
          </div>
          <div className="truncate text-3xs text-faint">{t.sub}</div>
        </div>
      ))}
    </div>
  )
}

interface VolFlowChartState {
  points: VolFlowPoint[]
  pctPoints: VolFlowPoint[]
  pctView: boolean
}

function VolFlowChart({ points, pctPoints, pctView }: VolFlowChartState) {
  const chartRef = useRef<IChartApi | null>(null)
  const dollarRef = useRef<ISeriesApi<'Baseline'> | null>(null)
  const pctRef = useRef<ISeriesApi<'Baseline'> | null>(null)
  // Read by the % series' autoscale provider, which lightweight-charts calls
  // inside its own layout pass — a REF, because the provider is captured once at
  // series creation and would otherwise close over a stale array.
  const pctValsRef = useRef<number[]>([])
  // THE VISIBILITY SIGNAL — `onVisibility`, one of the three ChartFrame offers.
  // Initial state comes off the handle in onMount, which is that callback's
  // documented contract (it is not fired for the initial state).
  const visibleRef = useRef(true)
  const pendingRef = useRef(false)
  const stateRef = useRef<VolFlowChartState>({ points, pctPoints, pctView })
  stateRef.current = { points, pctPoints, pctView }
  /** The chart's own `applySize`, published by onMount for ChartFrame's resize. */
  const sizeRef = useRef<(() => void) | null>(null)

  const sync = useCallback(() => {
    const chart = chartRef.current
    const dollar = dollarRef.current
    const pct = pctRef.current
    if (!chart || !dollar || !pct) return
    // A chart nobody can see does not paint. The skipped push is replayed by
    // onVisibility on the way back in.
    if (!visibleRef.current) {
      pendingRef.current = true
      return
    }
    const s = stateRef.current
    const border = volFlowChartOptions().borderColor
    dollar.setData(volFlowDollarSeries(s.points).map((p) => ({ time: p.time as UTCTimestamp, value: p.value })))
    pctValsRef.current = s.pctPoints.map((p) => p.posPct as number)
    pct.setData(volFlowPctSeries(s.pctPoints).map((p) => ({ time: p.time as UTCTimestamp, value: p.value })))
    // B309 — the view swap only flips visibility and which scale is showing; it
    // never tears the canvas down and rebuilds it.
    dollar.applyOptions({ visible: !s.pctView })
    pct.applyOptions({ visible: s.pctView })
    chart.applyOptions({
      rightPriceScale: { visible: !s.pctView, borderColor: border },
      leftPriceScale: { visible: s.pctView, borderColor: border },
    })
    try {
      chart.timeScale().fitContent()
    } catch {
      // not laid out yet
    }
  }, [])

  useEffect(sync, [sync, points, pctPoints, pctView])

  const onMount = useCallback(
    (h: ChartHandle) => {
      visibleRef.current = h.visible()
      const o = volFlowChartOptions()
      const colors = volFlowSeriesColors()
      const chart = createChart(h.el, {
        layout: {
          background: { type: ColorType.Solid, color: o.backgroundColor },
          textColor: o.textColor,
          attributionLogo: o.attributionLogo,
        },
        grid: { vertLines: { color: o.gridColor }, horzLines: { color: o.gridColor } },
        rightPriceScale: { visible: true, borderColor: o.borderColor },
        // The left scale carries the % series and is declared HERE rather than
        // added on demand: adding a price scale to a live chart re-lays-out the
        // pane and jumps the series.
        leftPriceScale: { visible: false, borderColor: o.borderColor },
        // No pan, no zoom — the opposite of the four strike charts above.
        handleScale: o.handleScale,
        handleScroll: o.handleScroll,
        crosshair: { mode: o.crosshairMode as CrosshairMode },
        timeScale: {
          borderColor: o.borderColor,
          timeVisible: o.timeVisible,
          secondsVisible: o.secondsVisible,
          tickMarkFormatter: (t: unknown) => (typeof t === 'number' ? etTimeFromSec(t) : ''),
        },
        localization: {
          priceFormatter: fmtGexAxis,
          timeFormatter: (t: unknown) => (typeof t === 'number' ? etTimeFromSec(t) : ''),
        },
      })

      // v3 non-negotiable 7. lightweight-charts creates the canvases, so they
      // are tagged the moment it has: v2 tagged nothing at all (B302).
      h.el.querySelectorAll('canvas').forEach((canvas) => canvas.setAttribute('data-cb-layer', 'volflow'))

      dollarRef.current = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: VOL_FLOW_SCALES.dollar.baseValue },
        ...colors,
        lineWidth: VOL_FLOW_SERIES_SHAPE.lineWidth,
        priceLineVisible: VOL_FLOW_SERIES_SHAPE.priceLineVisible,
      })
      chart.priceScale(VOL_FLOW_SCALES.dollar.priceScaleId).applyOptions({
        scaleMargins: VOL_FLOW_SERIES_SHAPE.scaleMargins,
      })

      pctRef.current = chart.addSeries(BaselineSeries, {
        priceScaleId: VOL_FLOW_SCALES.pct.priceScaleId,
        baseValue: { type: 'price', price: VOL_FLOW_SCALES.pct.baseValue },
        ...colors,
        lineWidth: VOL_FLOW_SERIES_SHAPE.lineWidth,
        priceLineVisible: VOL_FLOW_SERIES_SHAPE.priceLineVisible,
        visible: false,
        priceFormat: { type: 'custom', minMove: VOL_FLOW_PCT_MIN_MOVE, formatter: fmtPctAxis },
        autoscaleInfoProvider: () => ({ priceRange: pctAutoscaleRange(pctValsRef.current) }),
      })
      chart.priceScale(VOL_FLOW_SCALES.pct.priceScaleId).applyOptions({
        scaleMargins: VOL_FLOW_SERIES_SHAPE.scaleMargins,
      })
      chartRef.current = chart

      // B310 — the rAF pump. A chart created inside a flex box that has not laid
      // out yet has a width of 0 and would otherwise never recover.
      let lastW = 0
      let lastH = 0
      const applySize = () => {
        const w = h.el.clientWidth
        const height = h.el.clientHeight
        if (w > 0 && height > 0 && (w !== lastW || height !== lastH)) {
          lastW = w
          lastH = height
          chart.applyOptions({ width: w, height })
        }
      }
      let raf = 0
      let tries = 0
      const pump = () => {
        applySize()
        if ((lastW === 0 || lastH === 0) && tries++ < VOL_FLOW_SIZE_PUMP_FRAMES) raf = requestAnimationFrame(pump)
      }
      raf = requestAnimationFrame(pump)
      sizeRef.current = applySize
      sync()

      return () => {
        cancelAnimationFrame(raf)
        chart.remove()
        chartRef.current = null
        dollarRef.current = null
        pctRef.current = null
        sizeRef.current = null
      }
    },
    [sync],
  )

  return (
    <div className="relative min-h-0 flex-1">
      <ChartFrame
        className="absolute inset-0"
        onMount={onMount}
        onResize={() => sizeRef.current?.()}
        onVisibility={(visible) => {
          visibleRef.current = visible
          if (visible && pendingRef.current) {
            pendingRef.current = false
            sync()
          }
        }}
      />
    </div>
  )
}

function VolGexFlowPanel() {
  const [pick, setPick] = useState<string>(VOL_FLOW_DEFAULT_PICK)
  const [session, setSession] = useState<VolFlowSession>(VOL_FLOW_DEFAULT_SESSION)
  // THE VIEW TOGGLE NEVER REACHES THE URL. It is presentation over the same
  // response — `pctPointsOf` filters the buckets that carry a posPct and the
  // chart swaps which series and which price scale is visible. Only `pick` and
  // `session` are in `volGexFlowUrl`; if this joined them, a toggle would become
  // a request. (Data module § 11.)
  const [pctView, setPctView] = useState<boolean>(() => readPctView())
  const [points, setPoints] = useState<VolFlowPoint[]>([])
  const [expiries, setExpiries] = useState<ExpiryInfo[]>([])
  const [resolvedExpiry, setResolvedExpiry] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const apply = useCallback((res: VolFlowLoad) => {
    if (res.status === 'ok') {
      setPoints(res.points)
      setExpiries(res.expiries)
      setResolvedExpiry(res.resolvedExpiry)
      setUpdatedAt(res.updatedAt)
      setError(null)
      return
    }
    if (res.status === 'rejected') {
      // The body said ok:false: CLEAR the series, keep the expiry list, and
      // still advance the stamp — a failing feed goes on ticking "updated".
      setPoints([])
      setUpdatedAt(res.updatedAt)
      setError(res.error)
      return
    }
    // The request threw: KEEP the last good series under the scrim and do NOT
    // advance the stamp. Two failure modes, two side effects (B281 vs B282).
    setError(res.error)
  }, [])

  const load = useCallback(async () => {
    const res = await loadVolGexFlow(pick, session, VOL_FLOW_ERR)
    apply(res)
    setLoading(false)
  }, [pick, session, apply])

  // B283 — `loading` goes true on every pick / session change, so the scrim
  // returns; the 15s tick does not set it.
  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  usePoll(() => void load(), VOL_FLOW_POLL_MS)

  const pctPoints = useMemo(() => pctPointsOf(points), [points])
  const stats = useMemo(() => computeVolFlowStats(points), [points])
  const pctStats = useMemo(() => computeVolFlowPctStats(pctPoints), [pctPoints])
  const tiles = pctView
    ? pctStats
      ? volFlowPctTiles(pctStats)
      : []
    : stats
      ? volFlowDollarTiles(stats)
      : []
  const options = volFlowExpiryOptions(expiries, resolvedExpiry)

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-2xs font-bold uppercase tracking-widest text-fg">
          {pctView ? VOL_FLOW_COPY.titlePct : VOL_FLOW_COPY.titleDollar}
        </span>
        {/* B288 — LIVE, unlike the tab's own permanently-disabled Expiry Filter. */}
        <select
          aria-label={VOL_FLOW_COPY.expiryAriaLabel}
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="rounded-sm border border-line bg-bg px-2 py-0.5 text-2xs text-fg"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <SegGroup<VolFlowSession>
          value={session}
          onChange={setSession}
          options={VOL_FLOW_SESSIONS.map((s) => ({ value: s.id, label: s.label, title: s.title }))}
        />
        {/* ALWAYS rendered: an earlier version hid it whenever the window held
            no posPct rows, so the feature vanished on a weekend. */}
        <SegGroup<'dollar' | 'pct'>
          value={pctView ? 'pct' : 'dollar'}
          onChange={(v) => {
            const next = v === 'pct'
            if (next === pctView) return
            writePctView(pctView)
            setPctView(next)
          }}
          options={VOL_FLOW_VIEWS.map((v) => ({
            value: v.pct ? ('pct' as const) : ('dollar' as const),
            label: v.label,
            title: v.title,
          }))}
        />
        <span className="text-2xs tracking-wide text-muted">{VOL_FLOW_COPY.bucketNote}</span>
        {/* Omitted entirely before the first response. */}
        {updatedAt != null && <span className="tabular ml-auto text-2xs text-muted">{etTimeFromSec(Math.floor(updatedAt / 1000))}</span>}
        <PanelRefresh onClick={() => void load()} />
      </div>

      <VolFlowTiles tiles={tiles} />

      <div className="relative flex min-h-[200px] flex-1 flex-col">
        <VolFlowChart points={points} pctPoints={pctPoints} pctView={pctView} />
        {/* B311/B312 — corner labels instead of a legend, % view only: with one
            series on screen the question is which side of 50 you are on. */}
        {pctView && (
          <>
            <span className="pointer-events-none absolute left-2.5 top-1.5 text-3xs font-bold tracking-wider" style={{ color: alpha(signColor(1), 0.85) }}>
              {VOL_FLOW_COPY.longGamma}
            </span>
            <span className="pointer-events-none absolute bottom-6 left-2.5 text-3xs font-bold tracking-wider" style={{ color: alpha(signColor(-1), 0.85) }}>
              {VOL_FLOW_COPY.shortGamma}
            </span>
          </>
        )}
        {/* B313 — the scrim covers the CHART only; the six tiles above it stay
            visible and keep showing their last values. */}
        {/* The gate counts the $ series' buckets in BOTH views — an empty % view
            lands on the same "no snapshots" scrim the $ view already shows. */}
        {volFlowScrimVisible(loading, error, points.length) && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-md p-4 text-center text-xs font-semibold tracking-wide"
            style={{ background: alpha(T.bg, 0.72), color: volFlowScrimInk(error) }}
          >
            {volFlowScrimText(error, loading, pctView, session)}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// § 11 — CARD LAYOUT: TWO COLUMNS, DRAG AND DROP (B77–B96)
// ─────────────────────────────────────────────────────────────────────────────

function useCardLayout() {
  // B83 — first paint is ALWAYS the default arrangement and the stored one
  // swaps in after mount, because localStorage is unavailable during prerender.
  // A user with a custom layout therefore sees one frame of the default.
  const [layout, setLayout] = useState<CardLayout>(() => normalizeLayout(DEFAULT_LAYOUT))
  const [draggingId, setDraggingId] = useState<CardKey | null>(null)

  useEffect(() => {
    setLayout(readStoredLayout())
  }, [])

  const place = useCallback((key: CardKey, col: ColumnId, before: CardKey | null) => {
    setLayout((prev) => {
      const next = placeCard(prev, key, col, before)
      saveLayout(next)
      return next
    })
  }, [])

  const handleDragStart = (key: CardKey) => (e: DragEvent<HTMLSpanElement>) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(DRAG_PAYLOAD_FORMAT, key)
    setDraggingId(key)
  }
  const handleDragEnd = () => setDraggingId(null)

  const dragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  // B89 — stopPropagation so a drop on a card wins over the column underneath.
  const cardDrop = (col: ColumnId, key: CardKey) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const dragged = draggedKeyFrom(e.dataTransfer, draggingId)
    if (dragged && dragged !== key) place(dragged, col, key)
    setDraggingId(null)
  }

  // B90 — the tail strip appends, and is the ONLY way into an emptied column.
  const columnDrop = (col: ColumnId) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const dragged = draggedKeyFrom(e.dataTransfer, draggingId)
    if (dragged) place(dragged, col, null)
    setDraggingId(null)
  }

  return { layout, draggingId, handleDragStart, handleDragEnd, dragOver, cardDrop, columnDrop }
}

function CardTitleRow({
  label,
  onDragStart,
  onDragEnd,
}: {
  label: string
  onDragStart: (e: DragEvent<HTMLSpanElement>) => void
  onDragEnd: () => void
}) {
  return (
    <span className="flex items-center gap-2">
      <span>{label}</span>
      <span
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        // B86 — only the handle is draggable, and it swallows the mousedown so
        // the card drag and the charts' drag-pan cannot fight over one gesture.
        onMouseDown={(e) => e.stopPropagation()}
        title={DRAG_COPY.handleTitle}
        className="shrink-0 cursor-grab select-none px-1.5 text-muted opacity-40"
      >
        {DRAG_COPY.handleGlyph}
      </span>
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// § 12 — THE TAB
// ─────────────────────────────────────────────────────────────────────────────

interface Slot<T> {
  data: T | null
  error: string | null
  loading: boolean
}

const IDLE = { data: null, error: null, loading: false } as const

export default function GexLevelsTab() {
  const [snapSlot, setSnapSlot] = useState<Slot<GexLevelsSnapshot>>(IDLE)
  const [multiSlot, setMultiSlot] = useState<Slot<GexMultiPayload>>(IDLE)
  const [eodSlot, setEodSlot] = useState<Slot<EodGexRow[]>>(IDLE)
  const [eodLoadedAt, setEodLoadedAt] = useState<number | null>(null)
  // B145 — the localStorage copy is read SYNCHRONOUSLY so the table and the
  // OI-by-date chart paint from cache before any request lands.
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory())
  const [oiRows, setOiRows] = useState<OiByExpiryRow[]>([])
  const [oiSlot, setOiSlot] = useState<Slot<null>>(IDLE)
  const [oiLoadedAt, setOiLoadedAt] = useState<number | null>(null)
  const cards = useCardLayout()

  const snap = snapSlot.data
  const d = useMemo(() => deriveGexLevels(snap), [snap])

  // ── Mount: FIVE sources, one call, one round trip ─────────────────────────
  // Against v2's mount, which fired /proxy/gex, /proxy/gex-by-strike-multi,
  // /proxy/gex-levels-history, /proxy/gex-vol-flow and /api/eod-gex TWICE, then
  // waited on /proxy/gex to start twelve more. Each source lands in its OWN
  // settled slot, so a rejected /proxy/gex cannot take the EOD boards or the
  // history log down with it.
  useEffect(() => {
    let alive = true
    setMultiSlot((p) => ({ ...p, loading: true }))
    setEodSlot((p) => ({ ...p, loading: true }))
    void loadGexLevelsEntry({
      volFlowCopy: VOL_FLOW_ERR,
      volFlowPick: VOL_FLOW_DEFAULT_PICK,
      volFlowSession: VOL_FLOW_DEFAULT_SESSION,
    }).then((entry) => {
      if (!alive) return
      setSnapSlot(
        entry.snapshot.status === 'fulfilled'
          ? { data: entry.snapshot.value, error: null, loading: false }
          : { data: null, error: errText(entry.snapshot.reason), loading: false },
      )
      setMultiSlot(
        entry.multi.status === 'fulfilled'
          ? { data: entry.multi.value, error: null, loading: false }
          : { data: null, error: errText(entry.multi.reason), loading: false },
      )
      if (entry.eod.status === 'fulfilled') {
        setEodSlot({ data: entry.eod.value, error: null, loading: false })
        setEodLoadedAt(Date.now())
      } else {
        setEodSlot({ data: null, error: errText(entry.eod.reason), loading: false })
      }
      // B145 — an EMPTY server answer is DISCARDED rather than merged, so a dead
      // endpoint never clears a cache that has real rows in it.
      if (entry.history.status === 'fulfilled') setHistory(entry.history.value.merged)
      // entry.volFlow is fired and its RESULT dropped on purpose: card 12 owns
      // its own series and reads the SAME url one tick later, which `query()`
      // serves from this very in-flight promise. One request, one reader.
    })
    return () => {
      alive = false
    }
  }, [])

  // ── The three refreshable loads ───────────────────────────────────────────
  const runSnapshot = useCallback(async () => {
    try {
      const value = await loadGexSnapshot()
      setSnapSlot({ data: value, error: null, loading: false })
    } catch (e) {
      // ON FAILURE THE CARD SET DOES NOT BLANK: the previous snapshot stands
      // under the error banner, which is v2's behaviour.
      setSnapSlot((prev) => ({ data: prev.data, error: errText(e), loading: false }))
      throw e
    }
  }, [])

  const runMulti = useCallback(async () => {
    setMultiSlot((prev) => ({ ...prev, loading: true }))
    try {
      const value = await loadGexByStrikeMulti()
      setMultiSlot({ data: value, error: null, loading: false })
    } catch (e) {
      setMultiSlot((prev) => ({ data: prev.data, error: errText(e), loading: false }))
    }
  }, [])

  const runEod = useCallback(async () => {
    setEodSlot((prev) => ({ ...prev, loading: true }))
    try {
      const value = await loadEodGex()
      setEodSlot({ data: value, error: null, loading: false })
      setEodLoadedAt(Date.now())
    } catch (e) {
      setEodSlot((prev) => ({ data: prev.data, error: errText(e), loading: false }))
    }
  }, [])

  // B19 — 15s on the live 0DTE feed; B211 — 60s on the board sweep, which the
  // server caches for about that long. /api/eod-gex and the history log have no
  // poll at all: they fire once and only their own Refresh goes again.
  usePoll(() => void runSnapshot().catch(() => undefined), GEX_POLL_MS)
  usePoll(() => void runMulti(), GEX_MULTI_POLL_MS)

  // ── The second hop, and the only thing on this tab that waits ─────────────
  // /api/chains is addressed PER EXPIRY and the expiration list is a FIELD of
  // /proxy/gex's body, so this genuinely cannot be built without the first hop.
  // Everything else above fired beside it, unblocked.
  const symbol = snap?.symbol ?? DEFAULT_SYMBOL
  const expirations = useMemo(() => snap?.expirations ?? [], [snap])
  const expKey = expirations.join(',')
  const expsRef = useRef<string[]>(expirations)
  expsRef.current = expirations

  const runOi = useCallback(
    async (force: boolean) => {
      // v2's bail: no symbol or no expirations means the card sits at "no data
      // yet" — it does not error and it does not spin.
      if (!symbol || !expKey) return
      setOiSlot((prev) => ({ ...prev, loading: true }))
      try {
        const res = await loadOiByExpiration(symbol, expsRef.current, force)
        if (res.skipped) {
          setOiSlot((prev) => ({ ...prev, loading: false }))
          return
        }
        setOiRows(res.rows)
        setOiLoadedAt(res.loadedAt)
        setOiSlot({ data: null, error: null, loading: false })
      } catch (e) {
        // B175 — the card's one error line, thrown only when EVERY expiry's leg
        // rejected. A partial result is not an error.
        setOiSlot({ data: null, error: errText(e), loading: false })
      }
    },
    [symbol, expKey],
  )

  useEffect(() => {
    void runOi(false)
  }, [runOi])

  // ── The daily key-level log ──────────────────────────────────────────────
  useEffect(() => {
    if (!d) return
    setHistory((prev) => {
      // THE FIVE-FIELD REWRITE TEST lives in `applyTodayHistoryRow`: spot, r2,
      // s2, openInt and curve are written but not compared, so those five cells
      // can sit stale for a whole session while the row looks live (B147).
      const next = applyTodayHistoryRow(prev, buildTodayHistoryRow(d))
      if (next !== prev) saveHistory(next)
      return next
    })
  }, [d])

  const refresh = useRefreshButton(runSnapshot)

  const eodRows = eodSlot.data ?? []
  const multi = multiSlot.data
  const multiSpot = multi?.spot ?? d?.spot ?? 0
  const ctx: CardTitleContext = { symbol, expiry: snap?.expiry }

  // ── The 12 card bodies, keyed. The registry owns title, subtitle and order ──
  const bodies: Record<CardKey, ReactNode> = {
    oiDate: <OiByDateChart rows={history} />,
    eodGex: (
      <EodGexPanel
        rows={eodRows}
        field="totalGex0dte"
        loading={eodSlot.loading}
        error={eodSlot.error}
        loadedAt={eodLoadedAt}
        onRefresh={() => void runEod()}
      />
    ),
    eodGexEx0dte: (
      <EodGexPanel
        rows={eodRows}
        field="totalGexEx0dte"
        loading={eodSlot.loading}
        error={eodSlot.error}
        loadedAt={eodLoadedAt}
        onRefresh={() => void runEod()}
      />
    ),
    history: <HistoryTable rows={history} />,
    oiExpiry: (
      <OiByExpirationPanel
        rows={oiRows}
        loading={oiSlot.loading}
        error={oiSlot.error}
        loadedAt={oiLoadedAt}
        onRefresh={() => void runOi(true)}
      />
    ),
    netGamma: d ? (
      <>
        <NetGammaCurveChart rows={d.rows} spot={d.spot} neutral={d.neutral} />
        <ChartLegend items={LEGEND_NET_GAMMA} />
      </>
    ) : (
      <Empty note={EMPTY_COPY.noChainRows} />
    ),
    netGammaAll: (
      <NetGammaMultiPanel
        ladder={multi?.all ?? null}
        spot={multiSpot}
        scopeNote={scopeNoteAll(multi?.expiryCount)}
        loading={multiSlot.loading}
        error={multiSlot.error}
        onRefresh={() => void runMulti()}
      />
    ),
    netGammaEx0dte: (
      <NetGammaMultiPanel
        ladder={multi?.ex0dte ?? null}
        spot={multiSpot}
        scopeNote={scopeNoteEx0dte(multi?.expiryCount)}
        loading={multiSlot.loading}
        error={multiSlot.error}
        onRefresh={() => void runMulti()}
      />
    ),
    callPutGamma: d ? (
      <>
        <CallPutGammaChart rows={d.rows} spot={d.spot} />
        <ChartLegend items={LEGEND_CALL_PUT} />
      </>
    ) : (
      <Empty note={EMPTY_COPY.noChainRows} />
    ),
    netDelta: d ? (
      <>
        {/* The OI LEG ONLY — deliberately a different basis from every gamma
            ladder on the tab, and the one card that is not on `oiVolNet`. */}
        <NetDeltaChart rows={d.rows} spot={d.spot} basis="oi" />
        <ChartLegend items={LEGEND_NET_DELTA} />
      </>
    ) : (
      <Empty note={EMPTY_COPY.noChainRows} />
    ),
    netDeltaEx0dte: (
      <NetDeltaMultiPanel
        ladder={multi?.ex0dte ?? null}
        spot={multiSpot}
        scopeNote={scopeNoteEx0dte(multi?.expiryCount)}
        loading={multiSlot.loading}
        error={multiSlot.error}
        onRefresh={() => void runMulti()}
      />
    ),
    volFlow: (
      // B265 — a fixed wrapper. The panel takes no props.
      <div className="h-[460px]">
        <VolGexFlowPanel />
      </div>
    ),
  }

  const defFor = (key: CardKey): GexLevelsCardDef | undefined => GEX_LEVELS_CARDS.find((c) => c.key === key)

  const renderColumn = (col: ColumnId) => (
    <div
      className="flex min-h-[60px] flex-1 basis-[480px] flex-col gap-5"
      onDragOver={cards.dragOver}
      onDrop={cards.columnDrop(col)}
    >
      {cards.layout[col].map((key) => {
        const def = defFor(key)
        if (!def) return null
        return (
          <div
            key={key}
            onDragOver={cards.dragOver}
            onDrop={cards.cardDrop(col, key)}
            className="transition-opacity"
            style={{ opacity: cards.draggingId === key ? 0.35 : 1 }}
          >
            <Card
              title={
                <CardTitleRow
                  label={def.title(ctx)}
                  onDragStart={cards.handleDragStart(key)}
                  onDragEnd={cards.handleDragEnd}
                />
              }
            >
              <p className="mb-2 text-xs text-muted">{def.subtitle(ctx)}</p>
              {bodies[key]}
            </Card>
          </div>
        )
      })}
      {/* Rendered for the whole duration of a drag — it is the append target and
          the only way into a column that has been emptied out. */}
      {cards.draggingId && (
        <div className="rounded-md border border-dashed border-line p-3 text-center text-xs font-bold uppercase tracking-wide text-muted opacity-55">
          {DRAG_COPY.dropZone}
        </div>
      )}
    </div>
  )

  const gammaSpan = gammaGaugeSpan(d?.dollarGamma)

  return (
    <>
      <Card title={HEADER_COPY.title(snap?.symbol)}>
        <p className="mb-2 text-xs text-muted">
          {d
            ? HEADER_COPY.subtitle(snap?.expiry, d.spot, etClock(snap?.updatedAt))
            : HEADER_COPY.subtitleLoading}
        </p>

        {/* Rendered whenever the feed errored, INCLUDING alongside a stale `d` —
            the tiles keep showing the last good numbers underneath. */}
        {snapSlot.error && <ErrorLine text={HEADER_COPY.feedError(snapSlot.error)} />}
        {!d && !snapSlot.error && <Empty note={HEADER_COPY.waiting} />}

        {d && (
          <div className="flex flex-wrap items-center gap-3.5">
            <div className="flex min-w-[120px] flex-col gap-1">
              <span className="text-2xs font-bold uppercase tracking-wider text-muted">
                {HEADER_COPY.stockFilterLabel}
              </span>
              {/* A read-only PLATE, not a disabled input: it has no `disabled`
                  attribute in v2 either and is not focusable — it only looks
                  like one. */}
              <div className="rounded-md border border-line bg-bg px-3 py-2 text-center text-sm font-bold text-fg opacity-70">
                {snap?.symbol ?? DEFAULT_SYMBOL}
              </div>
            </div>

            <StatTile label={TILE_COPY.stockPrice} value={fmt2(d.spot)} accent={TILE_ACCENT.stockPrice} />
            <StatTile
              label={TILE_COPY.resistance}
              scope={TILE_COPY.scope0dte}
              accent={TILE_ACCENT.resistance}
              value={d.resistance != null ? fmt0(d.resistance) : EM_DASH}
              title={TILE_TITLE.resistance}
            />
            <StatTile
              label={TILE_COPY.support}
              scope={TILE_COPY.scope0dte}
              accent={TILE_ACCENT.support}
              value={d.support != null ? fmt0(d.support) : EM_DASH}
              title={TILE_TITLE.support}
            />
            <StatTile
              label={TILE_COPY.neutral}
              scope={TILE_COPY.scope0dte}
              accent={TILE_ACCENT.neutral}
              value={d.neutral != null ? fmt0(d.neutral) : EM_DASH}
              title={TILE_TITLE.neutral}
            />

            <SemiGauge
              caption={GAUGE_COPY.dollarGamma}
              value={d.dollarGamma}
              min={-gammaSpan}
              max={gammaSpan}
              valueLabel={fmtBn(d.dollarGamma)}
              bands={gammaGaugeBands(gammaSpan)}
            />
            {/* A FIXED 0–2 scale: a ratio above 2 clamps and pins hard right.
                An empty put book gives a ratio of 0, which lands in the RED left
                band — "maximally put-heavy" for a chain with no puts. v2's; spec
                open question 5. */}
            <SemiGauge
              caption={GAUGE_COPY.cpgRatio}
              value={d.cpgRatio}
              min={CPG_GAUGE_MIN}
              max={CPG_GAUGE_MAX}
              valueLabel={fmt2(d.cpgRatio)}
              bands={cpgGaugeBands()}
            />

            <div className="flex min-w-[170px] flex-col gap-1">
              <span className="text-2xs font-bold uppercase tracking-wider text-muted">
                {HEADER_COPY.expiryFilterLabel}
              </span>
              {/* Permanently disabled, exactly as in v2 — but as a native select
                  rather than a portal'd menu that can never open (spec "Do not
                  port" 22). The options are the snapshot's RAW `YYYY-MM-DD`
                  strings in SERVER order, unsorted and unformatted. */}
              <select
                disabled
                value={snap?.expiry ?? ''}
                aria-label={HEADER_COPY.expiryFilterLabel}
                className="rounded-md border border-line bg-bg px-3 py-2 text-sm font-bold text-fg opacity-50"
              >
                <option value="">{snap?.expiry ?? EM_DASH}</option>
                {expiryFilterOptions(snap).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={refresh.trigger}
              className="shrink-0 rounded-sm border border-line px-2.5 py-0.5 text-2xs font-bold tracking-wide"
              style={{ color: refreshInk(refresh.state) }}
            >
              {REFRESH_LABEL[refresh.state]}
            </button>
          </div>
        )}

        {/* A SIBLING of the gated block, so it shows under the waiting state too. */}
        <div className="mt-3 text-sm text-muted opacity-70">{HEADER_COPY.footnote}</div>
      </Card>

      {/*
        THE `d`-GATE (B96). All twelve cards — including the four with their own
        independent sources — are hidden until `deriveGexLevels` returns
        non-null, which needs BOTH rows AND a positive spot. So a /proxy/gex
        outage blanks nine sessions of history sitting in localStorage and two
        EOD boards that are answering fine.

        This is v2's behaviour, reproduced deliberately. The data layer makes
        each card independently awaitable and each one already renders its own
        loading and empty state, so lifting the gate is deleting the `d &&` on
        the next line and nothing else. Brandon's call, not this step's.
      */}
      {d && (
        <div className="mt-5 flex flex-wrap items-start gap-5">
          {renderColumn('left')}
          {renderColumn('right')}
        </div>
      )}
    </>
  )
}
