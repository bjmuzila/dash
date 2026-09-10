import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CrosshairMode, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import { BaselineSeries, ColorType, createChart } from 'lightweight-charts'
import type { ChartHandle } from '@/design/primitives/ChartFrame'
import { ChartFrame } from '@/design/primitives/ChartFrame'
import { SegGroup, Select } from '@/design/primitives/Controls'
import { V2, alpha } from '@/design/theme'
import type { ExpiryInfo, VolFlowPoint, VolFlowSession, VolFlowTile } from '@/pages/scanner/gexLevels'
import {
  PANEL_REFRESH_LABEL,
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
  computeVolFlowPctStats,
  computeVolFlowStats,
  etTimeFromSec,
  fmtGexAxis,
  fmtPctAxis,
  pctAutoscaleRange,
  pctPointsOf,
  readPctView,
  signColor,
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
} from '@/pages/scanner/gexLevels'
import type { VolFlowLoad } from '@/pages/scanner/gexLevelsData'
import { loadVolGexFlow } from '@/pages/scanner/gexLevelsData'

// ─────────────────────────────────────────────────────────────────────────────
// NET VOL GEX FLOW — the scanner's card 12, as a board card.
//
// THE SAME COMPONENT, not a second implementation. `/v3/scanner?tab=gexlevels`
// mounts `<VolGexFlowPanel />` from this file and so does the home board; there
// is one picker, one session switch, one $/% toggle, one fetch, one poll and
// one canvas, and the two surfaces cannot drift. It moved HERE rather than the
// card importing the scanner tab because that import would pull the whole
// gexlevels route — eleven other charts, its layout store, its history table —
// into the board's chunk for one panel (non-negotiable 7). It still reaches
// into `pages/scanner/gexLevels(.Data)` for the maths, the copy and the loader:
// both are side-effect-free modules of exported consts and pure functions, so
// Rollup drops the eleven cards' worth this panel does not name. Watch the
// board's number on the next `npm run build` all the same — a budget is the
// only thing that proves that sentence.
//
// Everything below the imports is the panel exactly as it stood in
// `pages/scanner/GexLevelsTab.tsx` § 10 (spec rows B263–B266, B275–B334),
// including the two transcribed v2 bugs it is deliberately faithful to:
//
//   · the panel header says "30s buckets · today ET" while the scanner card's
//     subtitle says "5m buckets" — the panel sends `bin=BIN_SEC` = 30 and v2's
//     subtitle never caught up;
//   · the % view's Δ tile prints "−0.0pt" in the POSITIVE colour at exactly
//     zero (`volFlowPctTiles` carries the `// BUG (v2):` marker).
//
// It owns its own request. It takes no props, follows no board symbol and is
// SPX-only, because `/proxy/gex-vol-flow` is what the strike-GEX recorder
// writes and that recorder runs on the index — a ticker switch here would be a
// control that changes nothing.
//
// v3 additions the panel carries and v2 had none of: it mounts through
// `ChartFrame`, honours ONE visibility signal (`onVisibility`, initial state
// read off the handle) and tags its canvases `data-cb-layer` — non-negotiables
// 4, 5 and 6.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The two sentences `loadVolGexFlow` needs. Assembled here rather than in the
 * data module, which deliberately declares no user-visible string of its own.
 *
 * Exported because the scanner tab's entry loader fires this panel's request
 * alongside its own five and needs the same copy — one spelling of both
 * sentences, in the file that owns the panel.
 */
export const VOL_FLOW_ERR = { noDb: VOL_FLOW_COPY.errNoDb, feed: VOL_FLOW_COPY.errFeed } as const

/**
 * B19, B279 — one poll, with `useQuery`'s `pollMs` semantics: a tick is SKIPPED
 * while the tab is hidden and one fires immediately on the way back.
 *
 * A local copy of the scanner tab's hook rather than an import from it: this
 * module must not reach into that route (see the chunking note above), and the
 * hook is twenty lines of `setInterval` with no state of its own to share.
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

/** The panel's refresh affordance (B300). Same markup the scanner's five carry. */
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

export function VolGexFlowPanel() {
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
        <Select
          ariaLabel={VOL_FLOW_COPY.expiryAriaLabel}
          value={pick}
          onChange={setPick}
          menuWidth="w-36"
          triggerClassName="tabular flex items-center gap-1 rounded-sm border border-line bg-bg px-2 py-0.5 text-2xs text-fg hover:border-accent"
          options={options.map((o) => ({ value: o.value, label: o.label }))}
        />
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
            // v2's scrim is `HOME_THEME.bg` at 72% — that is `V2.bg`, the
            // carried-over v2 canvas, NOT v3's own `T.bg`.
            style={{ background: alpha(V2.bg, 0.72), color: volFlowScrimInk(error) }}
          >
            {volFlowScrimText(error, loading, pctView, session)}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The catalog entry's render. A thin alias: the board draws the frame, the
 * title and the ✕, so the card IS the panel and nothing here may add a second
 * heading inside one.
 */
export function VolGexFlowCard() {
  return <VolGexFlowPanel />
}
