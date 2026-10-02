// ─────────────────────────────────────────────────────────────────────────────
// KALMAN — the render layer for /scanner?tab=kalman.
//
// A level + trend Kalman filter over the session's SPX GEX, one observation per
// recorded minute. The model, its definitions and the reasons behind every
// constant live in `kalman.ts`; this file fetches, wires and paints.
//
// SIX THINGS ABOUT THIS FILE THAT ARE NOT OBVIOUS FROM READING IT
//
//   1. THE FILTER IS REPLAYED, NOT ACCUMULATED. Every poll re-runs it from the
//      first column of the session. ~390 RTH columns × two 2×2 updates is
//      nothing, and it buys the property a client-side filter usually lacks: a
//      reload, a second tab and a phone all draw the SAME line, because the
//      state is a pure function of the recorded history rather than of how
//      long this page happened to be open.
//   2. NO NEW REQUEST. The ladder URL is built exactly as GexCandlesCard
//      builds it for SPX (same symbol, expiry, reach and top), so `query()`
//      dedupes the two and a board with the candles card open pays nothing
//      extra for this tab. Same for /api/expirations. If the candles card
//      changes its request, this tab keeps working — it just stops sharing.
//   3. THE ONE LIVE NUMBER IS SPOT. The model runs on minute columns; the
//      "spot vs filtered" stat reads the socket's `spot` so the distance to
//      the filtered flip is current between columns. It lives in its own
//      component so a 10Hz spot does not re-render the chart's parent.
//   4. THREE PLAIN CANVASES — the main chart (with the forecast cone), the
//      residuals and the variance sawtooth — each through `useCanvasRenderer`,
//      so each inherits the visibility gate and the `data-cb-layer` tag
//      (non-negotiables 5, 6). They share ONE hover index through a tiny bus
//      held in a ref: moving over any of them repaints all three at the same
//      minute, and nothing about the hover ever goes through React state.
//   5. ZOOM AND PAN WORK LIKE THE GEX CANDLES CARD (lightweight-charts'
//      defaults), on the same bus: wheel zooms the time axis around the
//      cursor, shift+wheel or a sideways swipe pans, click-drag pans, dragging
//      the right-hand price axis stretches it, double-click on the axis puts it
//      back on autoscale and double-click in the plot fits everything. The x
//      axis is LOGICAL (one slot per column), as it is on that card, so a night
//      between two sessions costs no width. All three canvases share the view.
//      While the view sits on the live edge a new column scrolls it along.
//   6. HISTORY. The per-minute ladder is pruned to ~2 sessions, so earlier
//      sessions come from the premarket replay store (5-minute frames, ~60
//      sessions kept) — see HISTORY in kalman.ts. The date picker sets the
//      LAST session shown and DAYS how many; ending on today keeps today live
//      (1-minute, polled) and stitches the earlier ones in front of it. Every
//      session runs its own filter (SESSIONS in kalman.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DatePicker } from '@/design/primitives/DatePicker'
import { Card, CardToolbar } from '@/design/primitives/Card'
import { ChartFrame, type ChartHandle } from '@/design/primitives/ChartFrame'
import { SegGroup } from '@/design/primitives/Controls'
import { Stat, type Direction } from '@/design/primitives/Stat'
import { LEVEL_COLORS, T, VIOLET, alpha, tokenHex, tokenHexAlpha } from '@/design/theme'
import { VOLTICK_UI } from '@/data/voltickLevels'
import { readableError, useQuery } from '@/data/api'
import { useField } from '@/data/hooks'
import type { SpotFrame } from '@/contract/frames'
import { sizeCanvas, useCanvasRenderer } from '@/board/chart-render'
import { gexHistoryUrl, latestSession, parseGexHistory } from '@/board/gexCandles/gexHistory'
import { BUBBLE_LADDER_REQUEST, GEX_HISTORY_MINUTES } from '@/board/gexCandles/settings'
import { EM_DASH, fmtB } from '@/pages/scanner/format'
import {
  KF_BREAK_SIGMA,
  KF_OPEN_BOOST,
  KF_RATIO,
  KF_R_FLOOR_FRAC,
  KF_SURPRISE_SIGMA,
  calibratedZ,
  columnsToObs,
  etClock,
  etDayKey,
  forecast,
  lastUpdated,
  replayFramesToObs,
  runKalman,
  sessionObs,
  type KfForecastPoint,
  type KfObs,
  type KfPoint,
  type KfRun,
  type KfSeries,
  type KfSession,
  type KfSmooth,
} from '@/pages/scanner/kalman'

// ── Request ──────────────────────────────────────────────────────────────────

/** The history table's key for SPX gamma. See board/gexCandles/symbols.ts. */
const GEX_SYMBOL = '$SPX'
const EXPIRATIONS_URL = '/api/expirations?ticker=SPX'

/** Which sessions the replay store holds. Same URL /premarket's picker asks for. */
const REPLAY_DATES_URL = '/proxy/premarket-replay?dates=1&limit=120&symbol=SPX'
const replayUrl = (date: string) => `/proxy/premarket-replay?date=${encodeURIComponent(date)}&symbol=SPX`

/** Most sessions one view stitches. Fixed, because each is a hook slot. */
const MAX_DAYS = 5
type KfDays = '1' | '2' | '3' | '5'
const DAYS_OPTIONS: Array<{ value: KfDays; label: string; title: string }> = [
  { value: '1', label: '1D', title: 'One session' },
  { value: '2', label: '2D', title: 'Two sessions, ending on the picked date' },
  { value: '3', label: '3D', title: 'Three sessions, ending on the picked date' },
  { value: '5', label: '5D', title: 'Five sessions, ending on the picked date' },
]

interface ExpirationsResponse {
  data?: { items?: Array<{ 'expiration-date'?: string }> }
}

const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const ET_WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' })

/**
 * Friday's date on a Saturday or Sunday, '' otherwise. The same rule
 * GexCandlesCard applies (its `etWeekendSessionDay`): /api/expirations lists
 * what is tradeable, so on a weekend its first entry is Monday — a session that
 * has not happened and has no columns.
 */
function weekendSessionDay(now = new Date()): string {
  const wd = ET_WEEKDAY.format(now)
  const back = wd === 'Sat' ? 1 : wd === 'Sun' ? 2 : 0
  if (!back) return ''
  const today = ET_DATE.format(now)
  return ET_DATE.format(new Date(Date.parse(`${today}T12:00:00Z`) - back * 86_400_000))
}

/** Same reach GexCandlesCard asks for, so the URLs match. */
function historyMinutesFor(weekendDay: string): number {
  if (!weekendDay) return GEX_HISTORY_MINUTES
  const preOpen = Date.parse(`${weekendDay}T08:00:00Z`)
  const back = Math.ceil((Date.now() - preOpen) / 60_000) + 60
  return Math.min(5760, Math.max(GEX_HISTORY_MINUTES, back))
}

// ── Controls ─────────────────────────────────────────────────────────────────

/** The CORE is called VOLT on the Voltick theme — same strike, same rule. */
const CORE_NAME = VOLTICK_UI ? 'Volt' : 'Core'

const SERIES_OPTIONS: Array<{ value: KfSeries; label: string; title: string }> = [
  {
    value: 'core',
    label: CORE_NAME.toUpperCase(),
    title: `${CORE_NAME}: the biggest |OI+VOL| gamma node. Filtered as its gamma-weighted centre (the node and its same-sign neighbours within ±25 pts)`,
  },
  { value: 'flip', label: 'FLIP', title: 'Zero-gamma flip (cumulative OI+VOL crossing nearest spot)' },
  { value: 'netgex', label: 'NET GEX', title: 'Σ OI+VOL net GEX across the recorded ladder' },
  { value: 'spot', label: 'SPOT', title: 'SPX spot as the recorder stamped it each minute' },
]

const SMOOTH_OPTIONS: Array<{ value: KfSmooth; label: string; title: string }> = [
  { value: 'fast', label: 'FAST', title: `q/R ${KF_RATIO.fast} — K ≈ 0.55, follows each print` },
  { value: 'med', label: 'MED', title: `q/R ${KF_RATIO.med} — K ≈ 0.28` },
  { value: 'slow', label: 'SLOW', title: `q/R ${KF_RATIO.slow} — K ≈ 0.13, trusts the model` },
]

const SESSION_OPTIONS: Array<{ value: KfSession; label: string; title: string }> = [
  { value: 'rth', label: 'RTH', title: '09:30–16:00 ET only' },
  { value: 'all', label: 'ALL', title: 'Every column the recorder wrote for this session, pre-market included' },
]

const SERIES_NAME: Record<KfSeries, string> = { core: CORE_NAME, flip: 'Flip', netgex: 'Net GEX', spot: 'Spot' }

/** The token each series' filtered line is drawn in. The flip is VIOLET everywhere. */
const SERIES_TOKEN: Record<KfSeries, string> = {
  // The core is GOLD everywhere — the CB tag, the GEX rail, the bubble leader.
  core: '--color-level-cb',
  flip: '--color-violet',
  netgex: '--color-accent',
  spot: '--color-accent',
}
/** The same, as the var() string the DOM legend paints with. */
const SERIES_VAR: Record<KfSeries, string> = { core: LEVEL_COLORS.cb, flip: VIOLET, netgex: T.cyan, spot: T.cyan }

/** Series measured in index points, read against spot. */
const ON_PRICE = (s: KfSeries) => s === 'core' || s === 'flip'

// ── Formatting ───────────────────────────────────────────────────────────────

function fmtVal(series: KfSeries, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return EM_DASH
  return series === 'netgex' ? fmtB(v) : v.toFixed(2)
}

/** A difference or a band width — same units, always signed for netgex. */
function fmtDelta(series: KfSeries, v: number): string {
  if (!Number.isFinite(v)) return EM_DASH
  if (series === 'netgex') return fmtB(v)
  return `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}`
}

function fmtTrendHr(series: KfSeries, perMin: number): string {
  const perHr = perMin * 60
  if (!Number.isFinite(perHr)) return EM_DASH
  if (series === 'netgex') return `${fmtB(perHr)}/hr`
  return `${perHr >= 0 ? '+' : '-'}${Math.abs(perHr).toFixed(1)} pts/hr`
}

/** Axis tick label. Compact; the tags and tooltip carry the precision. */
function fmtAxis(series: KfSeries, v: number, step: number): string {
  if (series === 'netgex') return fmtB(v)
  const dp = step >= 5 ? 0 : step >= 0.5 ? 1 : 2
  return v.toFixed(dp)
}

function kWord(k: number): string {
  if (k < 0.2) return 'model trusted'
  if (k > 0.5) return 'snapping to prints'
  return 'balanced'
}

// ── The model, derived ───────────────────────────────────────────────────────

interface Model {
  series: KfSeries
  run: KfRun
  /** Spot per point, for the flip overlay. Same index as run.points. */
  spots: Array<number | null>
  /** The raw core strike and its signed node, per point. Same index. */
  coreStrikes: Array<number | null>
  coreNets: Array<number | null>
  surprises: KfPoint[]
  /** Points where the state restarted on a confirmed level break. */
  breaks: KfPoint[]
  /** True when the last session is today's live feed — the cone only exists then. */
  live: boolean
  /** The cone, from the last column forward. Empty when not live. */
  fc: KfForecastPoint[]
  horizonMin: number
  /** Index of the first point of each session after the first. */
  dayStarts: number[]
  /** Sessions in the view, oldest first. */
  days: string[]
}

/** How far the cone reaches: a tenth of the LAST session, 10–45 minutes. */
function horizonFor(run: KfRun): number {
  const pts = run.points
  const last = pts[pts.length - 1]
  if (!last) return 0
  const first = pts.find((p) => p.day === last.day) ?? last
  const spanMin = (last.t - first.t) / 60_000
  return Math.max(10, Math.min(45, Math.round(spanMin * 0.1)))
}

// ── The shared bus: hover, the x view and the manual price range ─────────────
// Plain mutable state plus subscribe/notify, held in a ref. A mouse move, a
// wheel tick or a drag repaints canvases and renders nothing.

interface XView {
  /** Logical index at the plot's left edge. Fractional. */
  from: number
  /** …and at its right edge. */
  to: number
}

interface ChartBus {
  hover: number | null
  /** null = fit everything (the default, and what double-click returns to). */
  view: XView | null
  /** Main pane's price range while the axis has been dragged; null = autoscale. */
  yMain: { lo: number; hi: number } | null
  /** The main pane's last AUTOSCALED range — where an axis drag starts from. */
  autoY: { lo: number; hi: number } | null
  dragging: boolean
  notify(): void
  sub(fn: () => void): () => void
}

function makeBus(): ChartBus {
  const subs = new Set<() => void>()
  return {
    hover: null,
    view: null,
    yMain: null,
    autoY: null,
    dragging: false,
    notify() {
      for (const fn of Array.from(subs)) fn()
    },
    sub(fn) {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
  }
}

/** Slots the cone occupies to the right of the last column (one a minute). */
function horizonSlots(m: Model): number {
  return m.live ? m.fc.length - 1 : 0
}

/** Everything, with a couple of slots of air either side. */
function fitView(m: Model): XView {
  const n = m.run.points.length
  return { from: -1, to: n - 1 + horizonSlots(m) + 2 }
}

function viewOf(m: Model, bus: ChartBus): XView {
  return bus.view ?? fitView(m)
}

/** Keep some data on screen and the zoom inside sane limits. */
function clampView(v: XView, m: Model): XView {
  const fit = fitView(m)
  const fitW = fit.to - fit.from
  const w = Math.max(MIN_VIEW_SLOTS, Math.min(fitW * 1.5, v.to - v.from))
  let from = v.from
  let to = from + w
  const lastIdx = m.run.points.length - 1 + horizonSlots(m)
  // At least a quarter of the window must hold data on each side.
  if (to < w * 0.25) {
    to = w * 0.25
    from = to - w
  }
  if (from > lastIdx - w * 0.25) {
    from = lastIdx - w * 0.25
    to = from + w
  }
  return { from, to }
}

// ── The tab ──────────────────────────────────────────────────────────────────

export default function KalmanTab() {
  const [series, setSeries] = useState<KfSeries>('core')
  const [smooth, setSmooth] = useState<KfSmooth>('med')
  const [session, setSession] = useState<KfSession>('rth')
  const today = useMemo(() => ET_DATE.format(new Date()), [])
  const [endDate, setEndDate] = useState(today)
  const [daysOpt, setDaysOpt] = useState<KfDays>('1')
  const nDays = Number(daysOpt)
  const bus = useMemo(makeBus, [])

  const liveEnd = endDate >= today

  // ── Live (today, 1-minute) ─────────────────────────────────────────────────
  const expiryQ = useQuery<ExpirationsResponse>(EXPIRATIONS_URL, { staleMs: 300_000 })
  const weekendDay = useMemo(() => weekendSessionDay(), [])
  const listed = expiryQ.data?.data?.items?.[0]?.['expiration-date'] ?? ''
  // Guess today's 0DTE while the list is in flight, exactly as the candles card
  // does — on a trading day the guess IS the answer, so nothing refetches.
  const expiry = weekendDay || listed || (expiryQ.data ? '' : today)
  const minutes = useMemo(() => historyMinutesFor(weekendDay), [weekendDay])

  const liveUrl = liveEnd && expiry ? gexHistoryUrl(GEX_SYMBOL, expiry, minutes, BUBBLE_LADDER_REQUEST) : null
  const histQ = useQuery<unknown>(liveUrl, { staleMs: 30_000, pollMs: 60_000 })
  const liveColumns = useMemo(
    () => (liveEnd ? latestSession(parseGexHistory(histQ.data)) : []),
    [liveEnd, histQ.data],
  )
  const liveDay = liveColumns[0] ? etDayKey(liveColumns[0].slotTs) : ''

  // ── History (earlier sessions, 5-minute replay frames) ─────────────────────
  // The date list is one small request and always fetched: it bounds the
  // picker. The sessions themselves are only asked for when the view needs
  // them — five fixed hook slots, every one fired in parallel.
  const datesQ = useQuery<unknown>(REPLAY_DATES_URL, { staleMs: 600_000 })
  const replayDates = useMemo(() => {
    const rows = (datesQ.data as { rows?: unknown })?.rows
    if (!Array.isArray(rows)) return [] as string[]
    return (rows as Array<{ date?: unknown; frames?: unknown }>)
      .filter((r) => Number(r.frames) > 0)
      .map((r) => String(r.date ?? '').slice(0, 10))
      .filter(Boolean)
      .sort()
  }, [datesQ.data])

  const histDates = useMemo(() => {
    if (liveEnd) {
      // Today is the live feed; never also pull its replay. On a weekend the
      // live feed IS Friday, so Friday is excluded the same way.
      const cut = liveDay || today
      return nDays > 1 ? replayDates.filter((d) => d < cut).slice(-(nDays - 1)) : []
    }
    return replayDates.filter((d) => d <= endDate).slice(-nDays)
  }, [liveEnd, liveDay, today, replayDates, endDate, nDays])

  const slot = (i: number) => (histDates[i] ? replayUrl(histDates[i] as string) : null)
  const REPLAY_OPTS = { staleMs: 1_800_000 }
  const r0 = useQuery<unknown>(slot(0), REPLAY_OPTS)
  const r1 = useQuery<unknown>(slot(1), REPLAY_OPTS)
  const r2 = useQuery<unknown>(slot(2), REPLAY_OPTS)
  const r3 = useQuery<unknown>(slot(3), REPLAY_OPTS)
  const r4 = useQuery<unknown>(slot(4), REPLAY_OPTS)
  const replaySlots = [r0, r1, r2, r3, r4].slice(0, Math.min(MAX_DAYS, histDates.length))
  const replayLoading = replaySlots.some((q) => q.loading)
  const replayError = replaySlots.find((q) => q.error)?.error ?? null

  const allObs = useMemo<KfObs[]>(() => {
    const out: KfObs[] = []
    for (const q of [r0, r1, r2, r3, r4].slice(0, histDates.length)) out.push(...replayFramesToObs(q.data))
    out.push(...columnsToObs(liveColumns))
    out.sort((a, b) => a.t - b.t)
    return out
    // The five slot PAYLOADS are the inputs — the hook results around them are
    // new objects every render.
  }, [r0.data, r1.data, r2.data, r3.data, r4.data, histDates.length, liveColumns])
  const { obs, fellBack } = useMemo(() => sessionObs(allObs, session), [allObs, session])

  const model = useMemo<Model | null>(() => {
    if (!obs.length) return null
    const run = runKalman(obs, series, smooth)
    // runKalman drops columns before each session's first print; line the
    // spots up with the points it kept by timestamp, not by index.
    const obsAt = new Map(obs.map((o) => [o.t, o]))
    const spots = run.points.map((p) => obsAt.get(p.t)?.spot ?? null)
    const coreStrikes = run.points.map((p) => obsAt.get(p.t)?.coreStrike ?? null)
    const coreNets = run.points.map((p) => obsAt.get(p.t)?.coreNet ?? null)
    const surprises = run.points.filter((p) => Math.abs(calibratedZ(p, run.calib) ?? 0) > KF_SURPRISE_SIGMA)
    const breaks = run.points.filter((p) => p.kind === 'break')
    const lastPt = run.points[run.points.length - 1]
    const live = liveEnd && !!lastPt && lastPt.src === 'live'
    const horizonMin = live ? horizonFor(run) : 0
    const dayStarts: number[] = []
    const days: string[] = []
    run.points.forEach((p, i) => {
      if (i === 0 || p.day !== (run.points[i - 1] as KfPoint).day) {
        if (i > 0) dayStarts.push(i)
        days.push(p.day)
      }
    })
    return {
      series,
      run,
      spots,
      coreStrikes,
      coreNets,
      surprises,
      breaks,
      live,
      fc: live ? forecast(run, horizonMin) : [],
      horizonMin,
      dayStarts,
      days,
    }
  }, [obs, series, smooth, liveEnd])

  // ── The view across data changes ───────────────────────────────────────────
  // A different QUESTION (series, session, dates) starts from "fit all". A poll
  // that adds a column keeps the window where it is — and, if it was parked on
  // the live edge, slides it along with the new column, as the candles card does.
  useEffect(() => {
    bus.view = null
    bus.yMain = null
    bus.hover = null
    bus.notify()
  }, [bus, series, session, endDate, nDays])

  const prevRef = useRef<{ n: number; slots: number } | null>(null)
  useEffect(() => {
    if (!model) {
      prevRef.current = null
      return
    }
    const n = model.run.points.length
    const slots = horizonSlots(model)
    const prev = prevRef.current
    prevRef.current = { n, slots }
    if (prev && bus.view && n > prev.n) {
      const prevEdge = prev.n - 1 + prev.slots
      if (bus.view.to >= prevEdge - 1) {
        const d = n - prev.n
        bus.view = { from: bus.view.from + d, to: bus.view.to + d }
      }
    }
    if (bus.hover != null && bus.hover >= n) bus.hover = null
    bus.notify()
  }, [model, bus])

  const last = model?.run.points[model.run.points.length - 1] ?? null
  const upd = model ? lastUpdated(model.run.points) : null
  const lastTs = last?.t ?? null

  const loading = histQ.loading || (expiryQ.loading && liveEnd && !expiry) || replayLoading
  const errRaw = histQ.error ?? replayError
  const err = errRaw ? readableError(errRaw) : null
  const oldest = replayDates[0] ?? ''

  const sourceText = model
    ? [
        model.days.length > 1 ? `${model.days.length} sessions ${model.days[0]} → ${model.days[model.days.length - 1]}` : `session ${model.days[0]}`,
        histDates.length ? '5m replay' : null,
        model.live ? '1m live' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null

  return (
    <Card title="Kalman · SPX GEX">
      <CardToolbar>
        <SegGroup<KfSeries> options={SERIES_OPTIONS} value={series} onChange={setSeries} title="Series to filter" />
        <SegGroup<KfSmooth> options={SMOOTH_OPTIONS} value={smooth} onChange={setSmooth} title="Smoothing (q/R)" />
        <SegGroup<KfSession> options={SESSION_OPTIONS} value={session} onChange={setSession} title="Session" />
      </CardToolbar>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        <DatePicker
          size="sm"
          value={endDate}
          max={today}
          min={oldest || undefined}
          onChange={(v) => setEndDate(v || today)}
          title="Last session shown. Today = live; earlier dates come from the 5-minute replay recorder (≈60 sessions kept)."
          label={(v) => (v >= today ? 'Today · live' : v)}
          className="shrink-0"
        />
        <SegGroup<KfDays>
          options={DAYS_OPTIONS}
          value={daysOpt}
          onChange={setDaysOpt}
          title="How many sessions to stitch, ending on the picked date"
        />
        {!liveEnd && (
          <button
            type="button"
            onClick={() => setEndDate(today)}
            className="rounded-sm border border-line px-1.5 py-0.5 text-2xs font-semibold tracking-wide text-muted hover:bg-raised hover:text-fg"
          >
            BACK TO LIVE
          </button>
        )}
        <span>
          {[
            'SPX',
            sourceText,
            model?.live && expiry ? `front expiry ${expiry}` : null,
            `${model?.run.points.length ?? 0} columns`,
            lastTs ? `last ${etClock(lastTs)} ET` : null,
            fellBack ? 'no RTH yet — showing all' : null,
            loading ? 'loading…' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      {err && <div className="mb-3 text-xs text-down">{err}</div>}

      <StatRow model={model} last={last} upd={upd} smooth={smooth} />

      <div className="relative mt-3 flex flex-col" style={{ height: 420 }}>
        <Panel model={model} bus={bus} paint={paintMain} axisW={AXIS_W} main />
        <EmptyNote
          model={model}
          loading={loading}
          liveEnd={liveEnd}
          endDate={endDate}
          expiry={expiry}
          hasData={allObs.length > 0}
        />
      </div>

      <Legend series={series} horizonMin={model?.live ? model.horizonMin : 0} />

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SubPanel
          title="Innovation residuals"
          note="Print − forecast, in calibrated σ. Should scatter inside ±2σ around zero. A run on one side = the model is lagging (go FAST); markers at the edge = held prints and breaks."
        >
          <Panel model={model} bus={bus} paint={paintResiduals} axisW={SUB_AXIS_W} main={false} />
        </SubPanel>
        <SubPanel
          title="Variance · predict → update"
          note="√P of the level. Each predict step adds Q and σ rises; each print folds in and σ drops. Even teeth = settled; a spike = a held print, a break or a new session restarting the state."
        >
          <Panel model={model} bus={bus} paint={paintVariance} axisW={SUB_AXIS_W} main={false} />
        </SubPanel>
      </div>

      <HowItWorks smooth={smooth} model={model} />
    </Card>
  )
}

// ── Stats ────────────────────────────────────────────────────────────────────

function dirOf(v: number, eps = 0): Direction {
  return v > eps ? 'up' : v < -eps ? 'down' : 'flat'
}

/** The CORE tile's second line: the strike the node is on now, and its size. */
function coreSub(m: Model): string {
  const k = [...m.coreStrikes].reverse().find((v) => v != null)
  const n = [...m.coreNets].reverse().find((v) => v != null)
  if (k == null) return 'no node'
  const side = n == null ? '' : n >= 0 ? ' · call node' : ' · put node'
  return `strike ${k}${n != null ? ` ${fmtB(n)}` : ''}${side}`
}

function StatRow({
  model,
  last,
  upd,
  smooth,
}: {
  model: Model | null
  last: KfPoint | null
  upd: KfPoint | null
  smooth: KfSmooth
}) {
  const s = model?.series ?? 'core'
  const lastSurprise = model?.surprises[model.surprises.length - 1] ?? null
  const lastSpot = model ? ([...model.spots].reverse().find((v) => v != null) ?? null) : null
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      <Stat
        label={`Filtered ${SERIES_NAME[s].toLowerCase()}`}
        value={fmtVal(s, last?.level)}
        sub={
          s === 'core' && model
            ? coreSub(model)
            : `raw ${fmtVal(s, last?.z ?? upd?.z ?? null)}`
        }
      />
      <Stat
        label="Trend"
        value={last ? fmtTrendHr(s, last.trend) : EM_DASH}
        direction={last ? dirOf(last.trend) : undefined}
        sub="level drift, per hour"
      />
      <Stat
        label="Gain K"
        value={upd?.k != null ? upd.k.toFixed(2) : EM_DASH}
        sub={upd?.k != null ? kWord(upd.k) : `q/R ${KF_RATIO[smooth]}`}
      />
      <Stat
        label="Band ±2σ"
        value={last && model ? fmtDelta(s, 2 * last.obsSd * model.run.calib).replace(/^\+/, '±') : EM_DASH}
        sub={
          model
            ? `R σ ${fmtDelta(s, Math.sqrt(model.run.r)).replace(/^\+/, '')} · calib ×${model.run.calib.toFixed(2)}`
            : `q/R ${KF_RATIO[smooth]}`
        }
      />
      {s === 'netgex' ? (
        <Stat
          label="Regime"
          value={last ? (last.level >= 0 ? '+γ' : '−γ') : EM_DASH}
          direction={last ? dirOf(last.level) : undefined}
          sub={last ? (last.level >= 0 ? 'dealers long gamma · pinning' : 'dealers short gamma · trending') : undefined}
        />
      ) : model?.live ? (
        <LiveSpotStat
          series={s}
          level={last?.level ?? null}
          obsSd={last && model ? last.obsSd * model.run.calib : null}
        />
      ) : (
        <RecordedSpotStat
          series={s}
          spot={lastSpot}
          level={last?.level ?? null}
          obsSd={last && model ? last.obsSd * model.run.calib : null}
        />
      )}
      <Stat
        label="Surprises · breaks"
        value={model ? `${model.surprises.length} · ${model.run.breaks}` : EM_DASH}
        sub={
          lastSurprise
            ? `last surprise ${etClock(lastSurprise.t)} ET · >${KF_SURPRISE_SIGMA}σ`
            : `surprise >${KF_SURPRISE_SIGMA}σ · break 2×>${KF_BREAK_SIGMA}σ`
        }
      />
    </div>
  )
}

/** The spot tile's two readings, shared by the live and the recorded variant. */
function SpotTile({
  series,
  spot,
  level,
  obsSd,
  liveWord,
}: {
  series: KfSeries
  spot: number
  level: number | null
  obsSd: number | null
  liveWord: string
}) {
  if (series === 'flip') {
    const d = spot > 0 && level != null ? spot - level : null
    return (
      <Stat
        label="Spot − flip"
        value={d != null ? fmtDelta('flip', d) : EM_DASH}
        direction={d != null ? dirOf(d) : undefined}
        sub={
          d == null
            ? `${liveWord} spot`
            : `${d >= 0 ? 'above flip · +γ' : 'below flip · −γ'} · ${liveWord} ${spot.toFixed(2)}`
        }
      />
    )
  }
  if (series === 'core') {
    // Distance to the magnet. Price ABOVE the core is being pulled down toward
    // it, BELOW is being pulled up — the arrow says which way the pull runs.
    const d = spot > 0 && level != null ? spot - level : null
    return (
      <Stat
        label={`Spot − ${CORE_NAME.toLowerCase()}`}
        value={d != null ? fmtDelta('core', d) : EM_DASH}
        direction={d != null ? dirOf(d) : undefined}
        sub={
          d == null
            ? `${liveWord} spot`
            : `${CORE_NAME.toLowerCase()} ${d >= 0 ? 'below ↓' : 'above ↑'} · ${liveWord} ${spot.toFixed(2)}`
        }
      />
    )
  }
  // Spot series: how stretched price is from its own filtered level.
  const z = spot > 0 && level != null && obsSd != null && obsSd > 0 ? (spot - level) / obsSd : null
  return (
    <Stat
      label="Stretch"
      value={z != null ? `${z >= 0 ? '+' : '-'}${Math.abs(z).toFixed(1)}σ` : EM_DASH}
      direction={z != null ? dirOf(z, 0.5) : undefined}
      sub={spot > 0 ? `${liveWord} ${spot.toFixed(2)} vs filtered` : `${liveWord} spot`}
    />
  )
}

/**
 * The one live number. Isolated so the socket's spot rate re-renders this
 * tile and nothing else — see note 3 at the top.
 */
function LiveSpotStat({ series, level, obsSd }: { series: KfSeries; level: number | null; obsSd: number | null }) {
  const spot = useField<SpotFrame, number>('spot', (f) => {
    const v = Number(f?.data?.spot)
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0
  })
  return <SpotTile series={series} spot={spot} level={level} obsSd={obsSd} liveWord="live" />
}

/** A past session: the last spot the recorder stamped, never today's quote. */
function RecordedSpotStat({
  series,
  spot,
  level,
  obsSd,
}: {
  series: KfSeries
  spot: number | null
  level: number | null
  obsSd: number | null
}) {
  return <SpotTile series={series} spot={spot ?? 0} level={level} obsSd={obsSd} liveWord="last" />
}

// ── Empty states, legend, sub-panel frame ────────────────────────────────────

function EmptyNote({
  model,
  loading,
  liveEnd,
  endDate,
  expiry,
  hasData,
}: {
  model: Model | null
  loading: boolean
  liveEnd: boolean
  endDate: string
  expiry: string
  hasData: boolean
}) {
  let text: string | null = null
  if (!hasData) {
    if (loading) text = 'Loading the session’s GEX ladders…'
    else if (liveEnd) text = `No GEX history recorded for ${expiry || 'this expiry'} yet.`
    else text = `No replay frames recorded on or before ${endDate}. The replay recorder keeps about 60 sessions.`
  } else if (model && model.run.observed < 3) {
    text =
      model.series === 'flip'
        ? 'No zero-gamma crossing in the ladder for most of this view — the board stayed one-signed, so there is no flip to filter. Try NET GEX.'
        : 'Not enough prints to filter yet.'
  }
  if (!text) return null
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted">
      {text}
    </div>
  )
}

function Swatch({ color, shape }: { color: string; shape: 'dot' | 'line' | 'dash' | 'block' | 'ring' | 'diamond' }) {
  const base = 'inline-block shrink-0'
  switch (shape) {
    case 'dot':
      return <span className={`${base} h-1.5 w-1.5 rounded-full`} style={{ background: color }} />
    case 'line':
      return <span className={`${base} h-0.5 w-4`} style={{ background: color }} />
    case 'dash':
      return <span className={`${base} h-0 w-4 border-t border-dashed`} style={{ borderColor: color }} />
    case 'block':
      return <span className={`${base} h-2.5 w-4`} style={{ background: color }} />
    case 'ring':
      return <span className={`${base} h-2.5 w-2.5 rounded-full border`} style={{ borderColor: color }} />
    case 'diamond':
      return <span className={`${base} h-2 w-2 rotate-45`} style={{ background: color }} />
  }
}

function Legend({ series, horizonMin }: { series: KfSeries; horizonMin: number }) {
  const items: Array<{ label: string; color: string; shape: Parameters<typeof Swatch>[0]['shape'] }> = [
    { label: 'Print', color: alpha(T.text, 0.55), shape: 'dot' },
    { label: `Filtered ${SERIES_NAME[series].toLowerCase()}`, color: SERIES_VAR[series], shape: 'line' },
    { label: '±2σ next print', color: alpha(SERIES_VAR[series], 0.25), shape: 'block' },
  ]
  if (horizonMin) items.push({ label: `Forecast +${horizonMin}m`, color: T.orange, shape: 'dash' })
  items.push(
    { label: `Surprise >${KF_SURPRISE_SIGMA}σ`, color: T.orange, shape: 'ring' },
    { label: 'Level break', color: T.orange, shape: 'diamond' },
  )
  if (series === 'core') items.push({ label: `${CORE_NAME} strike`, color: alpha(LEVEL_COLORS.cb, 0.45), shape: 'dash' })
  if (ON_PRICE(series)) items.push({ label: 'Spot', color: alpha(T.text, 0.4), shape: 'line' })
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <Swatch color={it.color} shape={it.shape} />
          {it.label}
        </span>
      ))}
      <span className="ml-auto opacity-70">
        wheel zoom · drag pan · drag price axis to stretch · double-click to reset
      </span>
    </div>
  )
}

function SubPanel({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div className="flex flex-col border-t border-line pt-2">
      <span className="text-2xs font-semibold uppercase tracking-widest text-fg">{title}</span>
      <span className="mb-1 text-2xs leading-snug text-muted">{note}</span>
      <div className="flex flex-col" style={{ height: 160 }}>
        {children}
      </div>
    </div>
  )
}

const SERIES_DEF: Record<KfSeries, string> = {
  core: `${CORE_NAME} = the strike carrying the most |OI+VOL| gamma — the biggest node, the magnet price is pulled toward. A strike only jumps, so the filter runs on its centre of mass: the node and its same-sign neighbours within ±25 pts, weighted by gamma². It leans before the ${CORE_NAME.toLowerCase()} hops; a far jump is a level break. The dashed gold steps are the raw ${CORE_NAME.toLowerCase()} strike.`,
  flip: 'Flip = where cumulative OI+VOL gamma, summed up the strikes, crosses from negative to positive nearest spot. Above it dealers are net long gamma (they fade moves — pinning); below it net short (they chase — trending).',
  netgex: 'Net GEX = Σ OI+VOL net gamma across the ladder. Positive = dealers long gamma overall (dampening); negative = short gamma (amplifying).',
  spot: 'Spot = SPX as the recorder stamped it each column.',
}

function HowItWorks({ smooth, model }: { smooth: KfSmooth; model: Model | null }) {
  return (
    <div className="mt-3 border-t border-line pt-2 text-xs leading-relaxed text-muted">
      {model && (
        <>
          <span className="text-fg">{SERIES_NAME[model.series]}.</span> {SERIES_DEF[model.series]}{' '}
        </>
      )}
      <span className="text-fg">How it works.</span> Every recorded column the filter predicts the next value from
      its state (level + trend), then folds in the new print weighted by the Kalman gain K. K balances Q, how fast
      the true level can move, against R, how noisy a single print is. R is measured from each session’s own prints
      {model ? ` (σ ${fmtDelta(model.series, Math.sqrt(model.run.r)).replace(/^\+/, '')} on the last)` : ''}, never
      below {Math.round(KF_R_FLOOR_FRAC * 100)}% of that session’s range; Q is R × {KF_RATIO[smooth]} on{' '}
      {smooth.toUpperCase()}. Small K = the model is trusted and one print barely moves it; large K = it snaps onto
      the print. R is ×{KF_OPEN_BOOST} for the first 15 minutes of RTH. A print more than {KF_BREAK_SIGMA}σ off is
      held; a second one on the same side is a level break and the filter restarts on it, so a step (the morning OI
      update, say) is drawn as a step instead of an overshoot. Every session starts its own filter. The band is where
      the next print is expected (±2σ, widened by how far this model has actually been missing); the cone carries the
      last level and trend forward with no new prints. Past sessions are the 5-minute replay recorder’s frames (±20
      strikes around spot); today is the 1-minute ladder (top {BUBBLE_LADDER_REQUEST} strikes).
    </div>
  )
}

// ── The canvases ─────────────────────────────────────────────────────────────

/** On the type scale: text-2xs for ticks, text-xs for the tooltip and tags. */
const AXIS_PX = 10
const TIP_PX = 11
const AXIS_W = 64
const SUB_AXIS_W = 44
const PAD_L = 8
const PAD_T = 8
const X_AXIS_H = 18
const PANE_GAP = 10
const TREND_FRACTION = 0.24
/** Narrowest zoom, in columns. */
const MIN_VIEW_SLOTS = 12
/** Wheel sensitivity: the window scales by e^(deltaY · this). */
const WHEEL_ZOOM = 0.0015
/** Price-axis drag sensitivity: the range scales by e^(dy · this). */
const AXIS_STRETCH = 0.006

type Painter = (
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
  m: Model | null,
  bus: ChartBus,
  axisW: number,
) => void

interface Geom {
  plotR: number
  plotW: number
  from: number
  to: number
  /** Logical index → x. */
  x: (i: number) => number
  /** x → logical index (fractional). */
  iAt: (px: number) => number
  /** First and last DATA index inside the window. */
  i0: number
  i1: number
}

/** The x mapping, ONE definition for painting and for hit-testing. */
function geom(w: number, m: Model, axisW: number, view: XView): Geom {
  const n = m.run.points.length
  const plotR = w - axisW
  const plotW = Math.max(1, plotR - PAD_L)
  const { from, to } = view
  const span = Math.max(1e-6, to - from)
  return {
    plotR,
    plotW,
    from,
    to,
    x: (i) => PAD_L + ((i - from) / span) * plotW,
    iAt: (px) => from + ((px - PAD_L) / plotW) * span,
    i0: Math.max(0, Math.floor(from)),
    i1: Math.min(n - 1, Math.ceil(to)),
  }
}

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  const f = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10
  return f * mag
}

function fontMono(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
    return v || 'monospace'
  } catch {
    return 'monospace'
  }
}

const ET_SHORT_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'numeric', day: 'numeric' })

/**
 * Time labels for the visible window: a label wherever the ET clock crosses a
 * round step, the step picked so labels sit ≥ 64px apart. Day starts are
 * labelled with the date instead.
 */
function timeTicks(m: Model, g: Geom): Array<{ i: number; text: string; day: boolean }> {
  const pts = m.run.points
  if (g.i1 < g.i0) return []
  const pxPerSlot = g.plotW / Math.max(1e-6, g.to - g.from)
  // Median minutes per slot inside the window: 1 on the live ladder, 5 on replay.
  const steps: number[] = []
  for (let i = Math.max(g.i0, 1); i <= g.i1 && steps.length < 200; i++) {
    steps.push(((pts[i] as KfPoint).t - (pts[i - 1] as KfPoint).t) / 60_000)
  }
  steps.sort((a, b) => a - b)
  const minPerSlot = Math.max(1, Math.min(5, steps[steps.length >> 1] ?? 1))
  const every = [5, 15, 30, 60, 120, 240].find((e) => (e / minPerSlot) * pxPerSlot >= 64) ?? 480
  const out: Array<{ i: number; text: string; day: boolean }> = []
  let lastX = -Infinity
  for (let i = g.i0; i <= g.i1; i++) {
    const p = pts[i] as KfPoint
    const prev = pts[i - 1]
    const newDay = !prev || prev.day !== p.day
    const bucket = Math.floor(p.t / (every * 60_000))
    const crossed = !prev || Math.floor(prev.t / (every * 60_000)) !== bucket
    if (!newDay && !crossed) continue
    const x = g.x(i)
    if (x - lastX < 56) continue
    out.push({ i, text: newDay ? ET_SHORT_DATE.format(new Date(p.t)) : etClock(p.t), day: newDay })
    lastX = x
  }
  return out
}

/**
 * One canvas on the shared bus. Paints through `useCanvasRenderer` (visibility
 * gate, data-cb-layer) and turns pointer + wheel input into bus updates.
 */
function Panel({
  model,
  bus,
  paint,
  axisW,
  main,
}: {
  model: Model | null
  bus: ChartBus
  paint: Painter
  axisW: number
  /** The main chart owns the price axis drag; the sub-panes only zoom and pan. */
  main: boolean
}) {
  const { onMount: mountCanvas, onResize, onVisibility, setDraw } = useCanvasRenderer()
  const modelRef = useRef<Model | null>(model)
  modelRef.current = model

  const draw = useCallback(
    (canvas: HTMLCanvasElement, w: number, h: number) => paint(canvas, w, h, modelRef.current, bus, axisW),
    [paint, bus, axisW],
  )

  useEffect(() => {
    setDraw(draw)
  }, [model, draw, setDraw])

  // Any bus change → one repaint per animation frame at most.
  useEffect(() => {
    let raf = 0
    const off = bus.sub(() => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setDraw(draw)
      })
    })
    return () => {
      off()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [bus, draw, setDraw])

  const onMount = useCallback(
    (handle: ChartHandle) => {
      const cleanup = mountCanvas(handle)
      const el = handle.el
      el.style.touchAction = 'pan-y'

      const ctxOf = () => {
        const m = modelRef.current
        if (!m || m.run.points.length < 2) return null
        const rect = el.getBoundingClientRect()
        const g = geom(rect.width, m, axisW, viewOf(m, bus))
        return { m, rect, g }
      }
      /** Is this point over the main pane's price axis? */
      const onAxis = (px: number, py: number, rect: DOMRect, g: Geom) => {
        if (!main || px <= g.plotR) return false
        const usableH = Math.max(40, rect.height - PAD_T - X_AXIS_H - PANE_GAP)
        return py >= PAD_T && py <= PAD_T + usableH * (1 - TREND_FRACTION)
      }

      // ── wheel: zoom around the cursor; sideways / shift pans ────────────────
      const onWheel = (e: WheelEvent) => {
        const c = ctxOf()
        if (!c) return
        e.preventDefault()
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? c.rect.height : 1
        const dx = e.deltaX * unit
        const dy = e.deltaY * unit
        const v = viewOf(c.m, bus)
        const w = v.to - v.from
        let next: XView
        if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) {
          const d = ((e.shiftKey ? dy : dx) / c.g.plotW) * w
          next = { from: v.from + d, to: v.to + d }
        } else {
          const px = Math.max(PAD_L, Math.min(c.g.plotR, e.clientX - c.rect.left))
          const anchor = c.g.iAt(px)
          const nw = w * Math.exp(dy * WHEEL_ZOOM)
          const k = nw / w
          next = { from: anchor - (anchor - v.from) * k, to: anchor + (v.to - anchor) * k }
        }
        bus.view = clampView(next, c.m)
        bus.notify()
      }

      // ── drag: pan the time axis (and the price axis once it is manual), or
      // stretch the price axis when the press lands on it ──────────────────────
      let drag: {
        x: number
        y: number
        view: XView
        axis: boolean
        y0: { lo: number; hi: number } | null
        mainH: number
        moved: boolean
      } | null = null

      const onDown = (e: PointerEvent) => {
        if (e.button !== 0) return
        const c = ctxOf()
        if (!c) return
        const px = e.clientX - c.rect.left
        const py = e.clientY - c.rect.top
        const usableH = Math.max(40, c.rect.height - PAD_T - X_AXIS_H - PANE_GAP)
        drag = {
          x: e.clientX,
          y: e.clientY,
          view: viewOf(c.m, bus),
          axis: onAxis(px, py, c.rect, c.g),
          y0: bus.yMain ?? bus.autoY,
          mainH: usableH * (1 - TREND_FRACTION),
          moved: false,
        }
        el.setPointerCapture(e.pointerId)
      }

      const onMove = (e: PointerEvent) => {
        const c = ctxOf()
        if (!c) return
        const px = e.clientX - c.rect.left
        const py = e.clientY - c.rect.top
        if (!drag) {
          el.style.cursor = onAxis(px, py, c.rect, c.g) ? 'ns-resize' : 'crosshair'
          const i = Math.round(c.g.iAt(px))
          const hover = i >= 0 && i < c.m.run.points.length && px <= c.g.plotR ? i : null
          if (hover !== bus.hover) {
            bus.hover = hover
            bus.notify()
          }
          return
        }
        const dx = e.clientX - drag.x
        const dy = e.clientY - drag.y
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return
        if (!drag.moved) {
          drag.moved = true
          bus.dragging = true
          bus.hover = null
          el.style.cursor = drag.axis ? 'ns-resize' : 'grabbing'
        }
        if (drag.axis) {
          if (!drag.y0) return
          const mid = (drag.y0.lo + drag.y0.hi) / 2
          const half = ((drag.y0.hi - drag.y0.lo) / 2) * Math.exp(dy * AXIS_STRETCH)
          bus.yMain = { lo: mid - half, hi: mid + half }
        } else {
          const w = drag.view.to - drag.view.from
          const d = (-dx / c.g.plotW) * w
          bus.view = clampView({ from: drag.view.from + d, to: drag.view.to + d }, c.m)
          // Once the price axis is manual, a drag moves it too — as the candles
          // card does after its axis has been stretched.
          if (main && bus.yMain && drag.y0) {
            const per = (drag.y0.hi - drag.y0.lo) / Math.max(1, drag.mainH)
            bus.yMain = { lo: drag.y0.lo + dy * per, hi: drag.y0.hi + dy * per }
          }
        }
        bus.notify()
      }

      const onUp = (e: PointerEvent) => {
        if (!drag) return
        drag = null
        bus.dragging = false
        el.style.cursor = 'crosshair'
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
        bus.notify()
      }

      const onLeave = () => {
        if (drag || bus.hover == null) return
        bus.hover = null
        bus.notify()
      }

      // ── double-click: on the price axis → autoscale; in the plot → fit all ──
      const onDbl = (e: MouseEvent) => {
        const c = ctxOf()
        if (!c) return
        const px = e.clientX - c.rect.left
        const py = e.clientY - c.rect.top
        if (onAxis(px, py, c.rect, c.g)) bus.yMain = null
        else {
          bus.view = null
          bus.yMain = null
        }
        bus.notify()
      }

      el.addEventListener('wheel', onWheel, { passive: false })
      el.addEventListener('pointerdown', onDown)
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
      el.addEventListener('pointercancel', onUp)
      el.addEventListener('pointerleave', onLeave)
      el.addEventListener('dblclick', onDbl)
      el.style.cursor = 'crosshair'
      return () => {
        el.removeEventListener('wheel', onWheel)
        el.removeEventListener('pointerdown', onDown)
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
        el.removeEventListener('pointercancel', onUp)
        el.removeEventListener('pointerleave', onLeave)
        el.removeEventListener('dblclick', onDbl)
        cleanup?.()
      }
    },
    [mountCanvas, bus, axisW, main],
  )

  return <ChartFrame className="select-none" onMount={onMount} onResize={onResize} onVisibility={onVisibility} />
}

function ready(m: Model | null): m is Model {
  return !!m && m.run.points.length >= 2 && m.run.observed >= 3
}

/** The hover crosshair, shared by every pane. */
function crosshair(ctx: CanvasRenderingContext2D, hx: number, top: number, bottom: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(hx, top)
  ctx.lineTo(hx, bottom)
  ctx.stroke()
  ctx.setLineDash([])
}

/** Dashed rules where a new session starts. */
function sessionRules(ctx: CanvasRenderingContext2D, m: Model, g: Geom, top: number, bottom: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.setLineDash([6, 4])
  for (const i of m.dayStarts) {
    const sx = Math.round(g.x(i - 0.5)) + 0.5
    if (sx < PAD_L || sx > g.plotR) continue
    ctx.beginPath()
    ctx.moveTo(sx, top)
    ctx.lineTo(sx, bottom)
    ctx.stroke()
  }
  ctx.setLineDash([])
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r, y)
  ctx.lineTo(x, y + r)
  ctx.lineTo(x - r, y)
  ctx.closePath()
  ctx.fill()
}

const paintMain: Painter = (canvas, w, h, m, bus, axisW) => {
  const ctx = sizeCanvas(canvas, w, h)
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  if (!ready(m)) return
  const pts = m.run.points
  const n = pts.length
  const calib = m.run.calib
  const hover = bus.dragging ? null : bus.hover

  const s = m.series
  const mono = fontMono()
  const ink = tokenHex('--color-fg')
  const dim = tokenHexAlpha('--color-fg', 0.5)
  const grid = tokenHexAlpha('--color-line', 0.9)
  const ruleC = tokenHexAlpha('--color-fg', 0.22)
  const lineC = tokenHex(SERIES_TOKEN[s])
  const bandC = tokenHexAlpha(SERIES_TOKEN[s], 0.14)
  const dotC = tokenHexAlpha('--color-fg', 0.55)
  const spotC = tokenHexAlpha('--color-fg', 0.4)
  const warnC = tokenHex('--color-warn')
  const coneC = tokenHexAlpha('--color-warn', 0.12)
  const heldC = tokenHexAlpha('--color-warn', 0.6)
  const upC = tokenHexAlpha('--color-up', 0.75)
  const downC = tokenHexAlpha('--color-down', 0.75)
  const tagInk = tokenHex('--color-app')

  const g = geom(w, m, axisW, viewOf(m, bus))
  const { plotR, plotW, x, i0, i1 } = g
  const usableH = Math.max(40, h - PAD_T - X_AXIS_H - PANE_GAP)
  const mainH = usableH * (1 - TREND_FRACTION)
  const trendTop = PAD_T + mainH + PANE_GAP
  const trendH = usableH * TREND_FRACTION
  // Draw one slot past each edge so a line leaves the pane instead of stopping short.
  const d0 = Math.max(0, i0 - 1)
  const d1 = Math.min(n - 1, i1 + 1)
  // Forecast slots are indices n-1 … n-1+H.
  const fcIdx = (k: number) => n - 1 + k

  // ── Main pane range: autoscale over what is VISIBLE — prints, the filtered
  // line, spot (flip) and the cone's centre line — unless the axis has been
  // dragged. The band and the cone are clipped, never allowed to set the scale.
  let lo = Infinity
  let hi = -Infinity
  const take = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  for (let i = i0; i <= i1; i++) {
    const p = pts[i] as KfPoint
    take(p.z)
    take(p.level)
    if (ON_PRICE(s)) take(m.spots[i])
    if (s === 'core') take(m.coreStrikes[i])
  }
  m.fc.forEach((f, k) => {
    const fi = fcIdx(k)
    if (fi >= g.from && fi <= g.to) take(f.level)
  })
  if (!(hi > lo)) {
    const c = Number.isFinite(lo) ? lo : (pts[n - 1] as KfPoint).level
    lo = c - 1
    hi = c + 1
  }
  const padY = (hi - lo) * 0.08
  lo -= padY
  hi += padY
  bus.autoY = { lo, hi }
  if (bus.yMain) {
    lo = bus.yMain.lo
    hi = bus.yMain.hi
  }
  const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * mainH

  ctx.font = `${AXIS_PX}px ${mono}`
  ctx.textBaseline = 'middle'

  // Grid + right axis ticks.
  const step = niceStep(hi - lo, 5)
  ctx.lineWidth = 1
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const gy = Math.round(y(v)) + 0.5
    ctx.strokeStyle = grid
    ctx.beginPath()
    ctx.moveTo(PAD_L, gy)
    ctx.lineTo(plotR, gy)
    ctx.stroke()
    ctx.fillStyle = dim
    ctx.textAlign = 'left'
    ctx.fillText(fmtAxis(s, v, step), plotR + 6, gy)
  }
  if (bus.yMain) {
    // Say that the axis is manual, and how to give it back.
    ctx.fillStyle = dim
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText('axis manual · dbl-click axis', plotR - 4, PAD_T + 2)
    ctx.textBaseline = 'middle'
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(PAD_L, PAD_T, plotW, mainH)
  ctx.clip()

  // Zero line for net GEX: the regime boundary.
  if (s === 'netgex' && lo < 0 && hi > 0) {
    ctx.strokeStyle = dim
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(PAD_L, y(0))
    ctx.lineTo(plotR, y(0))
    ctx.stroke()
    ctx.setLineDash([])
  }

  sessionRules(ctx, m, g, PAD_T, PAD_T + mainH, ruleC)

  // ±2σ next-print band. Split at breaks and session starts: the state
  // restarted there, and a band bridging two levels describes nobody's forecast.
  const bandSeg = (from: number, to: number) => {
    if (to - from < 1) return
    ctx.beginPath()
    for (let i = from; i <= to; i++) {
      const p = pts[i] as KfPoint
      const py = y(p.level + 2 * p.obsSd * calib)
      if (i === from) ctx.moveTo(x(i), py)
      else ctx.lineTo(x(i), py)
    }
    for (let i = to; i >= from; i--) {
      const p = pts[i] as KfPoint
      ctx.lineTo(x(i), y(p.level - 2 * p.obsSd * calib))
    }
    ctx.closePath()
    ctx.fill()
  }
  const restarts = (i: number) => {
    const p = pts[i] as KfPoint
    return p.kind === 'break' || p.kind === 'seed'
  }
  ctx.fillStyle = bandC
  let segFrom = d0
  for (let i = d0 + 1; i <= d1; i++) {
    if (restarts(i)) {
      bandSeg(segFrom, i - 1)
      segFrom = i
    }
  }
  bandSeg(segFrom, d1)

  // The forecast cone.
  if (m.fc.length > 1) {
    ctx.fillStyle = coneC
    ctx.beginPath()
    m.fc.forEach((f, k) => {
      const py = y(f.level + 2 * f.sd)
      if (k === 0) ctx.moveTo(x(fcIdx(k)), py)
      else ctx.lineTo(x(fcIdx(k)), py)
    })
    for (let k = m.fc.length - 1; k >= 0; k--) {
      const f = m.fc[k] as KfForecastPoint
      ctx.lineTo(x(fcIdx(k)), y(f.level - 2 * f.sd))
    }
    ctx.closePath()
    ctx.fill()
  }

  // Breaks: a dotted rule through the pane where the state restarted.
  ctx.strokeStyle = heldC
  ctx.lineWidth = 1
  ctx.setLineDash([2, 4])
  for (let i = d0; i <= d1; i++) {
    if ((pts[i] as KfPoint).kind !== 'break') continue
    const bx = Math.round(x(i)) + 0.5
    ctx.beginPath()
    ctx.moveTo(bx, PAD_T)
    ctx.lineTo(bx, PAD_T + mainH)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // The raw core strike, as steps: where the node actually IS, under the
  // centre of mass the filter tracks. Lifted between sessions.
  if (s === 'core') {
    ctx.strokeStyle = tokenHexAlpha('--color-level-cb', 0.45)
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    let pen = false
    let prev = 0
    for (let i = d0; i <= d1; i++) {
      const v = m.coreStrikes[i]
      if (v == null || (pen && (pts[i] as KfPoint).kind === 'seed')) {
        pen = false
        if (v == null) continue
      }
      if (!pen) ctx.moveTo(x(i), y(v))
      else {
        ctx.lineTo(x(i), y(prev))
        ctx.lineTo(x(i), y(v))
      }
      prev = v
      pen = true
    }
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Spot under the flip / core — which side of it price sits on is the read.
  // Lifted between sessions.
  if (ON_PRICE(s)) {
    ctx.strokeStyle = spotC
    ctx.lineWidth = 1
    ctx.beginPath()
    let pen = false
    for (let i = d0; i <= d1; i++) {
      const v = m.spots[i]
      if (v == null || (pen && (pts[i] as KfPoint).kind === 'seed')) {
        pen = false
        if (v == null) continue
      }
      if (!pen) ctx.moveTo(x(i), y(v))
      else ctx.lineTo(x(i), y(v))
      pen = true
    }
    ctx.stroke()
  }

  // Raw prints. Held ones in the warning hue — the filter did not take them.
  for (let i = d0; i <= d1; i++) {
    const p = pts[i] as KfPoint
    if (p.z == null) continue
    ctx.fillStyle = p.kind === 'held' ? heldC : dotC
    ctx.beginPath()
    ctx.arc(x(i), y(p.z), p.kind === 'held' ? 2.4 : 1.6, 0, Math.PI * 2)
    ctx.fill()
  }

  // Surprises.
  ctx.strokeStyle = warnC
  ctx.lineWidth = 1.5
  for (let i = d0; i <= d1; i++) {
    const p = pts[i] as KfPoint
    if (p.z == null || Math.abs(calibratedZ(p, calib) ?? 0) <= KF_SURPRISE_SIGMA) continue
    ctx.beginPath()
    ctx.arc(x(i), y(p.z), 4.5, 0, Math.PI * 2)
    ctx.stroke()
  }

  // The filtered level — a vertical step at each break, lifted between sessions.
  ctx.strokeStyle = lineC
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.beginPath()
  for (let i = d0; i <= d1; i++) {
    const p = pts[i] as KfPoint
    if (i === d0 || p.kind === 'seed') ctx.moveTo(x(i), y(p.level))
    else if (p.kind === 'break') {
      ctx.lineTo(x(i), y((pts[i - 1] as KfPoint).level))
      ctx.lineTo(x(i), y(p.level))
    } else ctx.lineTo(x(i), y(p.level))
  }
  ctx.stroke()

  // Break markers on the line.
  ctx.fillStyle = warnC
  for (let i = d0; i <= d1; i++) {
    const p = pts[i] as KfPoint
    if (p.kind === 'break') diamond(ctx, x(i), y(p.level), 4)
  }

  // The forecast centre line.
  if (m.fc.length > 1) {
    ctx.strokeStyle = warnC
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    m.fc.forEach((f, k) => {
      if (k === 0) ctx.moveTo(x(fcIdx(k)), y(f.level))
      else ctx.lineTo(x(fcIdx(k)), y(f.level))
    })
    ctx.stroke()
    ctx.setLineDash([])
  }

  // "Now" — where the prints stop and the cone starts. Live only.
  const nowX = Math.round(x(n - 1)) + 0.5
  if (m.live) {
    ctx.strokeStyle = dim
    ctx.lineWidth = 1
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(nowX, PAD_T)
    ctx.lineTo(nowX, PAD_T + mainH)
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.fillStyle = lineC
  ctx.beginPath()
  ctx.arc(x(n - 1), y((pts[n - 1] as KfPoint).level), 3.5, 0, Math.PI * 2)
  ctx.fill()

  // Session date labels, top-left of each session. A session whose start has
  // scrolled off the left keeps its label pinned to the edge — but only the
  // newest such one, and only until the next session's own label reaches it.
  ctx.font = `${AXIS_PX}px ${mono}`
  ctx.fillStyle = dim
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  if (m.days.length > 1) {
    const labels: Array<{ x: number; text: string }> = []
    let pinned: string | null = null
    for (const si of [0, ...m.dayStarts]) {
      const text = ET_SHORT_DATE.format(new Date((pts[si] as KfPoint).t))
      const sx = x(si - 0.5) + 4
      if (sx < PAD_L + 2) pinned = text
      else if (sx < plotR - 40) labels.push({ x: sx, text })
    }
    const firstX = labels[0]?.x ?? Infinity
    if (pinned && firstX - (PAD_L + 2) > 72) labels.unshift({ x: PAD_L + 2, text: pinned })
    for (const l of labels) ctx.fillText(l.text, l.x, PAD_T + 2)
  }
  ctx.restore()

  // Last-value tags on the axis: filtered (solid), the cone's end, and spot.
  ctx.font = `${TIP_PX}px ${mono}`
  ctx.textBaseline = 'middle'
  const tag = (v: number, fill: string, text: string) => {
    const ty = Math.max(PAD_T + 7, Math.min(PAD_T + mainH - 7, y(v)))
    ctx.fillStyle = fill
    ctx.fillRect(plotR + 1, ty - 7, axisW - 2, 14)
    ctx.fillStyle = tagInk
    ctx.textAlign = 'left'
    ctx.fillText(text, plotR + 5, ty)
  }
  const fmtTag = (v: number) => (s === 'netgex' ? fmtB(v) : v.toFixed(1))
  const lastP = pts[n - 1] as KfPoint
  if (ON_PRICE(s)) {
    const lastSpot = [...m.spots].reverse().find((v) => v != null)
    if (lastSpot != null) tag(lastSpot, ink, fmtTag(lastSpot))
  }
  const fcEnd = m.fc[m.fc.length - 1]
  if (fcEnd) tag(fcEnd.level, warnC, fmtTag(fcEnd.level))
  tag(lastP.level, lineC, fmtTag(lastP.level))

  // ── Trend pane ─────────────────────────────────────────────────────────────
  let tMax = 0
  for (let i = i0; i <= i1; i++) tMax = Math.max(tMax, Math.abs((pts[i] as KfPoint).trend))
  if (!(tMax > 0)) tMax = 1
  const mid = trendTop + trendH / 2
  const ty = (v: number) => mid - (v / tMax) * (trendH / 2 - 2)
  ctx.save()
  ctx.beginPath()
  ctx.rect(PAD_L, trendTop, plotW, trendH)
  ctx.clip()
  ctx.strokeStyle = grid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_L, Math.round(mid) + 0.5)
  ctx.lineTo(plotR, Math.round(mid) + 0.5)
  ctx.stroke()
  sessionRules(ctx, m, g, trendTop, trendTop + trendH, ruleC)
  const barW = Math.max(1, (plotW / Math.max(1, g.to - g.from)) * 0.8)
  for (let i = d0; i <= d1; i++) {
    const p = pts[i] as KfPoint
    const top = ty(p.trend)
    ctx.fillStyle = p.trend >= 0 ? upC : downC
    ctx.fillRect(x(i) - barW / 2, Math.min(top, mid), barW, Math.max(1, Math.abs(top - mid)))
  }
  ctx.restore()
  ctx.font = `${AXIS_PX}px ${mono}`
  ctx.fillStyle = dim
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('TREND / HR', PAD_L + 2, trendTop)
  ctx.textBaseline = 'middle'
  const trendTick = (perMin: number) => {
    const v = perMin * 60
    return s === 'netgex' ? fmtB(v) : `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}`
  }
  ctx.fillText(trendTick(tMax), plotR + 6, trendTop + 6)
  ctx.fillText(trendTick(-tMax), plotR + 6, trendTop + trendH - 6)

  // ── Time axis ──────────────────────────────────────────────────────────────
  const axisY = h - X_AXIS_H / 2
  ctx.textAlign = 'center'
  for (const tk of timeTicks(m, g)) {
    const tx = x(tk.i)
    if (tx < PAD_L + 14 || tx > plotR - 14) continue
    if (m.live && Math.abs(tx - nowX) < 36) continue
    ctx.strokeStyle = grid
    ctx.beginPath()
    ctx.moveTo(Math.round(tx) + 0.5, PAD_T + mainH)
    ctx.lineTo(Math.round(tx) + 0.5, PAD_T + mainH + 3)
    ctx.stroke()
    ctx.fillStyle = tk.day ? ink : dim
    ctx.fillText(tk.text, tx, axisY)
  }
  if (m.live && nowX >= PAD_L && nowX <= plotR) {
    ctx.fillStyle = ink
    ctx.fillText('now', nowX, axisY)
  }

  // ── Hover ──────────────────────────────────────────────────────────────────
  if (hover == null) return
  const hp = pts[hover]
  if (!hp) return
  const hx = Math.round(x(hover)) + 0.5
  if (hx < PAD_L || hx > plotR) return
  crosshair(ctx, hx, PAD_T, trendTop + trendH, dim)
  ctx.fillStyle = lineC
  ctx.beginPath()
  ctx.arc(hx, y(hp.level), 3, 0, Math.PI * 2)
  ctx.fill()

  const cz = calibratedZ(hp, calib)
  const kindLine: Record<KfPoint['kind'], string> = {
    seed: 'SEED — session’s first print',
    update: '',
    predict: 'no print — predicted only',
    held: `HELD — >${KF_BREAK_SIGMA}σ off, not folded in`,
    break: 'BREAK — restarted on this print',
  }
  const lines = [
    `${m.days.length > 1 ? `${ET_SHORT_DATE.format(new Date(hp.t))} ` : ''}${etClock(hp.t)} ET · ${hp.src === 'live' ? '1m' : '5m'}`,
    `raw      ${fmtVal(s, hp.z)}`,
    `filtered ${fmtVal(s, hp.level)}`,
    `trend    ${fmtTrendHr(s, hp.trend)}`,
    `K        ${hp.k != null ? hp.k.toFixed(2) : EM_DASH}`,
    `resid    ${cz != null ? `${cz >= 0 ? '+' : '-'}${Math.abs(cz).toFixed(1)}σ` : EM_DASH}`,
  ]
  const spotH = m.spots[hover]
  if (s === 'core') {
    const ck = m.coreStrikes[hover]
    const cn = m.coreNets[hover]
    if (ck != null) lines.push(`strike   ${ck}${cn != null ? ` (${fmtB(cn)})` : ''}`)
  }
  if (ON_PRICE(s) && spotH != null) lines.push(`spot     ${spotH.toFixed(2)}`)
  if (kindLine[hp.kind]) lines.push(kindLine[hp.kind])
  ctx.font = `${TIP_PX}px ${mono}`
  let boxW = 0
  for (const l of lines) boxW = Math.max(boxW, ctx.measureText(l).width)
  boxW += 16
  const lineH = TIP_PX + 4
  const boxH = lines.length * lineH + 10
  const bx = hx + 12 + boxW > plotR ? hx - 12 - boxW : hx + 12
  const by = PAD_T + 6
  ctx.fillStyle = tokenHexAlpha('--color-surface2', 0.95)
  ctx.fillRect(bx, by, boxW, boxH)
  ctx.strokeStyle = grid
  ctx.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.round(boxW), Math.round(boxH))
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  lines.forEach((l, i) => {
    ctx.fillStyle = i === lines.length - 1 && kindLine[hp.kind] ? warnC : ink
    ctx.fillText(l, bx + 8, by + 6 + i * lineH)
  })
}

/** Shared sub-pane time axis — the same ticks the main chart picks. */
function subAxis(ctx: CanvasRenderingContext2D, m: Model, g: Geom, h: number, color: string, ink: string) {
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  const ay = h - X_AXIS_H / 2
  for (const tk of timeTicks(m, g)) {
    const tx = g.x(tk.i)
    if (tx < PAD_L + 14 || tx > g.plotR - 14) continue
    ctx.fillStyle = tk.day ? ink : color
    ctx.fillText(tk.text, tx, ay)
  }
}

const paintResiduals: Painter = (canvas, w, h, m, bus, axisW) => {
  const ctx = sizeCanvas(canvas, w, h)
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  if (!ready(m)) return
  const pts = m.run.points
  const n = pts.length
  const calib = m.run.calib
  const hover = bus.dragging ? null : bus.hover
  const mono = fontMono()
  const ink = tokenHex('--color-fg')
  const dim = tokenHexAlpha('--color-fg', 0.5)
  const barC = tokenHexAlpha('--color-fg', 0.45)
  const warnC = tokenHex('--color-warn')
  const grid = tokenHexAlpha('--color-line', 0.9)
  const ruleC = tokenHexAlpha('--color-fg', 0.22)
  const wash = tokenHexAlpha('--color-fg', 0.05)

  const g = geom(w, m, axisW, viewOf(m, bus))
  const top = PAD_T
  const paneH = Math.max(20, h - PAD_T - X_AXIS_H)
  const d0 = Math.max(0, g.i0 - 1)
  const d1 = Math.min(n - 1, g.i1 + 1)
  let lim = 3
  for (let i = g.i0; i <= g.i1; i++) {
    const z = calibratedZ(pts[i] as KfPoint, calib)
    if (z != null) lim = Math.max(lim, Math.abs(z))
  }
  lim = Math.min(6, Math.ceil(lim))
  const mid = top + paneH / 2
  const yz = (z: number) => mid - (Math.max(-lim, Math.min(lim, z)) / lim) * (paneH / 2)

  ctx.save()
  ctx.beginPath()
  ctx.rect(PAD_L, top - 1, g.plotW, paneH + 2)
  ctx.clip()

  // The ±2σ corridor.
  ctx.fillStyle = wash
  ctx.fillRect(PAD_L, yz(2), g.plotW, yz(-2) - yz(2))
  ctx.strokeStyle = grid
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  for (const v of [2, -2]) {
    ctx.beginPath()
    ctx.moveTo(PAD_L, Math.round(yz(v)) + 0.5)
    ctx.lineTo(g.plotR, Math.round(yz(v)) + 0.5)
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(PAD_L, Math.round(mid) + 0.5)
  ctx.lineTo(g.plotR, Math.round(mid) + 0.5)
  ctx.stroke()
  sessionRules(ctx, m, g, top, top + paneH, ruleC)

  const barW = Math.max(1, (g.plotW / Math.max(1, g.to - g.from)) * 0.6)
  for (let i = d0; i <= d1; i++) {
    const p = pts[i] as KfPoint
    const px = g.x(i)
    if (p.kind === 'held' || p.kind === 'break') {
      // Off the scale by definition: a tick at the edge on the miss's side.
      const up = (p.nz ?? 0) >= 0
      const ey = up ? top + 1 : top + paneH - 1
      ctx.fillStyle = warnC
      ctx.beginPath()
      ctx.moveTo(px - 3, ey)
      ctx.lineTo(px + 3, ey)
      ctx.lineTo(px, ey + (up ? 5 : -5))
      ctx.closePath()
      ctx.fill()
      continue
    }
    const z = calibratedZ(p, calib)
    if (z == null) continue
    const yt = yz(z)
    ctx.fillStyle = Math.abs(z) > KF_SURPRISE_SIGMA ? warnC : barC
    ctx.fillRect(px - barW / 2, Math.min(yt, mid), barW, Math.max(1, Math.abs(yt - mid)))
  }
  ctx.restore()

  ctx.font = `${AXIS_PX}px ${mono}`
  ctx.fillStyle = dim
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(`+${lim}σ`, g.plotR + 4, top + 5)
  ctx.fillText('±2σ', g.plotR + 4, yz(2))
  ctx.fillText(`-${lim}σ`, g.plotR + 4, top + paneH - 5)
  subAxis(ctx, m, g, h, dim, ink)

  if (hover == null) return
  const hx = Math.round(g.x(hover)) + 0.5
  if (hx < PAD_L || hx > g.plotR) return
  crosshair(ctx, hx, top, top + paneH, dim)
}

const paintVariance: Painter = (canvas, w, h, m, bus, axisW) => {
  const ctx = sizeCanvas(canvas, w, h)
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  if (!ready(m)) return
  const pts = m.run.points
  const n = pts.length
  const s = m.series
  const hover = bus.dragging ? null : bus.hover
  const mono = fontMono()
  const ink = tokenHex('--color-fg')
  const dim = tokenHexAlpha('--color-fg', 0.5)
  const lineC = tokenHex(SERIES_TOKEN[s])
  const warnC = tokenHexAlpha('--color-warn', 0.6)
  const grid = tokenHexAlpha('--color-line', 0.9)
  const ruleC = tokenHexAlpha('--color-fg', 0.22)

  const g = geom(w, m, axisW, viewOf(m, bus))
  const top = PAD_T
  const paneH = Math.max(20, h - PAD_T - X_AXIS_H)
  const d0 = Math.max(0, g.i0 - 1)
  const d1 = Math.min(n - 1, g.i1 + 1)
  // Scale to the settled teeth inside the window, not a seed or a restart: the
  // 98th percentile of the prior σ over updates. Spikes above it clip.
  const tops: number[] = []
  for (let i = g.i0; i <= g.i1; i++) {
    const p = pts[i] as KfPoint
    if (p.kind === 'update') tops.push(p.priorSd)
  }
  tops.sort((a, b) => a - b)
  let yMax = tops.length ? (tops[Math.floor(0.98 * (tops.length - 1))] as number) : (pts[n - 1] as KfPoint).priorSd
  if (!(yMax > 0)) yMax = 1
  yMax *= 1.15
  const ys = (v: number) => top + (1 - Math.min(v, yMax) / yMax) * paneH

  ctx.strokeStyle = grid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_L, Math.round(top + paneH) + 0.5)
  ctx.lineTo(g.plotR, Math.round(top + paneH) + 0.5)
  ctx.stroke()

  ctx.save()
  ctx.beginPath()
  ctx.rect(PAD_L, top - 1, g.plotW, paneH + 2)
  ctx.clip()
  sessionRules(ctx, m, g, top, top + paneH, ruleC)

  // Breaks and held prints: where the sawtooth is interrupted.
  ctx.strokeStyle = warnC
  ctx.setLineDash([2, 4])
  for (let i = d0; i <= d1; i++) {
    const p = pts[i] as KfPoint
    if (p.kind !== 'break' && p.kind !== 'held') continue
    const bx = Math.round(g.x(i)) + 0.5
    ctx.beginPath()
    ctx.moveTo(bx, top)
    ctx.lineTo(bx, top + paneH)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // The sawtooth: up to the predicted σ, down to the updated σ, every column.
  ctx.strokeStyle = lineC
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = d0; i <= d1; i++) {
    const p = pts[i] as KfPoint
    const px = g.x(i)
    if (i === d0 || p.kind === 'seed') ctx.moveTo(px, ys(p.sd))
    else {
      ctx.lineTo(px, ys(p.priorSd))
      ctx.lineTo(px, ys(p.sd))
    }
  }
  ctx.stroke()
  ctx.restore()

  ctx.font = `${AXIS_PX}px ${mono}`
  ctx.fillStyle = dim
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(s === 'netgex' ? fmtB(yMax).replace(/^\+/, '') : yMax.toFixed(2), g.plotR + 4, top + 5)
  ctx.fillText('0', g.plotR + 4, top + paneH - 4)
  subAxis(ctx, m, g, h, dim, ink)

  if (hover == null) return
  const hx = Math.round(g.x(hover)) + 0.5
  if (hx < PAD_L || hx > g.plotR) return
  crosshair(ctx, hx, top, top + paneH, dim)
}
