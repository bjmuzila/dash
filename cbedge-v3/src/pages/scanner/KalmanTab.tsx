// ─────────────────────────────────────────────────────────────────────────────
// KALMAN — the render layer for /scanner?tab=kalman.
//
// A level + trend Kalman filter over the session's SPX GEX, one observation per
// recorded minute. The model, its definitions and the reasons behind every
// constant live in `kalman.ts`; this file fetches, wires and paints.
//
// FOUR THINGS ABOUT THIS FILE THAT ARE NOT OBVIOUS FROM READING IT
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
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Card, CardToolbar } from '@/design/primitives/Card'
import { ChartFrame, type ChartHandle } from '@/design/primitives/ChartFrame'
import { SegGroup } from '@/design/primitives/Controls'
import { Stat, type Direction } from '@/design/primitives/Stat'
import { T, VIOLET, alpha, tokenHex, tokenHexAlpha } from '@/design/theme'
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
  forecast,
  lastUpdated,
  runKalman,
  sessionObs,
  type KfForecastPoint,
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

const SERIES_OPTIONS: Array<{ value: KfSeries; label: string; title: string }> = [
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

const SERIES_NAME: Record<KfSeries, string> = { flip: 'Flip', netgex: 'Net GEX', spot: 'Spot' }

/** The token each series' filtered line is drawn in. The flip is VIOLET everywhere. */
const SERIES_TOKEN: Record<KfSeries, string> = {
  flip: '--color-violet',
  netgex: '--color-accent',
  spot: '--color-accent',
}
/** The same, as the var() string the DOM legend paints with. */
const SERIES_VAR: Record<KfSeries, string> = { flip: VIOLET, netgex: T.cyan, spot: T.cyan }

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
  surprises: KfPoint[]
  /** Points where the state restarted on a confirmed level break. */
  breaks: KfPoint[]
  /** The cone, from the last column forward. */
  fc: KfForecastPoint[]
  horizonMin: number
}

/** How far the cone reaches: a tenth of the session on screen, 10–45 minutes. */
function horizonFor(run: KfRun): number {
  const pts = run.points
  if (pts.length < 2) return 0
  const spanMin = ((pts[pts.length - 1] as KfPoint).t - (pts[0] as KfPoint).t) / 60_000
  return Math.max(10, Math.min(45, Math.round(spanMin * 0.1)))
}

// ── The shared hover ─────────────────────────────────────────────────────────
// One index, three canvases. A plain subscribe/notify in a ref rather than
// React state, so a mouse move repaints canvases and renders nothing.

interface HoverBus {
  get(): number | null
  set(i: number | null): void
  sub(fn: () => void): () => void
}

function makeHoverBus(): HoverBus {
  let cur: number | null = null
  const subs = new Set<() => void>()
  return {
    get: () => cur,
    set: (i) => {
      if (i === cur) return
      cur = i
      for (const fn of Array.from(subs)) fn()
    },
    sub: (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
  }
}

// ── The tab ──────────────────────────────────────────────────────────────────

export default function KalmanTab() {
  const [series, setSeries] = useState<KfSeries>('flip')
  const [smooth, setSmooth] = useState<KfSmooth>('med')
  const [session, setSession] = useState<KfSession>('rth')
  const bus = useMemo(makeHoverBus, [])

  const expiryQ = useQuery<ExpirationsResponse>(EXPIRATIONS_URL, { staleMs: 300_000 })
  const weekendDay = useMemo(() => weekendSessionDay(), [])
  const listed = expiryQ.data?.data?.items?.[0]?.['expiration-date'] ?? ''
  // Guess today's 0DTE while the list is in flight, exactly as the candles card
  // does — on a trading day the guess IS the answer, so nothing refetches.
  const expiry = weekendDay || listed || (expiryQ.data ? '' : ET_DATE.format(new Date()))
  const minutes = useMemo(() => historyMinutesFor(weekendDay), [weekendDay])

  const url = expiry ? gexHistoryUrl(GEX_SYMBOL, expiry, minutes, BUBBLE_LADDER_REQUEST) : null
  const histQ = useQuery<unknown>(url, { staleMs: 30_000, pollMs: 60_000 })

  const columns = useMemo(() => latestSession(parseGexHistory(histQ.data)), [histQ.data])
  const allObs = useMemo(() => columnsToObs(columns), [columns])
  const { obs, fellBack } = useMemo(() => sessionObs(allObs, session), [allObs, session])

  const model = useMemo<Model | null>(() => {
    if (!obs.length) return null
    const run = runKalman(obs, series, smooth)
    // runKalman drops columns before the first print; line the spots up with
    // the points it kept by timestamp, not by index.
    const spotAt = new Map(obs.map((o) => [o.t, o.spot]))
    const spots = run.points.map((p) => spotAt.get(p.t) ?? null)
    const surprises = run.points.filter((p) => Math.abs(calibratedZ(p, run.calib) ?? 0) > KF_SURPRISE_SIGMA)
    const breaks = run.points.filter((p) => p.kind === 'break')
    const horizonMin = horizonFor(run)
    return { series, run, spots, surprises, breaks, fc: forecast(run, horizonMin), horizonMin }
  }, [obs, series, smooth])

  // A new model can be shorter than the index under the mouse.
  useEffect(() => {
    bus.set(null)
  }, [model, bus])

  const last = model?.run.points[model.run.points.length - 1] ?? null
  const upd = model ? lastUpdated(model.run.points) : null
  const lastTs = columns[columns.length - 1]?.slotTs ?? null

  const loading = histQ.loading || (expiryQ.loading && !expiry)
  const err = histQ.error ? readableError(histQ.error) : null

  return (
    <Card title="Kalman · SPX GEX">
      <CardToolbar>
        <SegGroup<KfSeries> options={SERIES_OPTIONS} value={series} onChange={setSeries} title="Series to filter" />
        <SegGroup<KfSmooth> options={SMOOTH_OPTIONS} value={smooth} onChange={setSmooth} title="Smoothing (q/R)" />
        <SegGroup<KfSession> options={SESSION_OPTIONS} value={session} onChange={setSession} title="Session" />
      </CardToolbar>

      <div className="mb-3 text-xs text-muted">
        {[
          'SPX',
          expiry ? `front expiry ${expiry}` : null,
          `${columns.length} columns`,
          lastTs ? `last ${etClock(lastTs)} ET` : null,
          `ladder top ${BUBBLE_LADDER_REQUEST}`,
          fellBack ? 'no RTH yet — showing all' : null,
          loading ? 'loading…' : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>

      {err && <div className="mb-3 text-xs text-down">{err}</div>}

      <StatRow model={model} last={last} upd={upd} smooth={smooth} />

      <div className="relative mt-3 flex flex-col" style={{ height: 420 }}>
        <Panel model={model} bus={bus} paint={paintMain} axisW={AXIS_W} horizon />
        <EmptyNote model={model} loading={loading} expiry={expiry} hasColumns={columns.length > 0} />
      </div>

      <Legend series={series} horizonMin={model?.horizonMin ?? 0} />

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SubPanel
          title="Innovation residuals"
          note={`Print − forecast, in calibrated σ. Should scatter inside ±2σ around zero. A run on one side = the model is lagging (go FAST); markers at the edge = held prints and breaks.`}
        >
          <Panel model={model} bus={bus} paint={paintResiduals} axisW={SUB_AXIS_W} horizon={false} />
        </SubPanel>
        <SubPanel
          title="Variance · predict → update"
          note="√P of the level. Each predict step adds Q and σ rises; each print folds in and σ drops. Even teeth = settled; a spike = a held print or a break restarting the state."
        >
          <Panel model={model} bus={bus} paint={paintVariance} axisW={SUB_AXIS_W} horizon={false} />
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
  const s = model?.series ?? 'flip'
  const lastSurprise = model?.surprises[model.surprises.length - 1] ?? null
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      <Stat
        label={`Filtered ${SERIES_NAME[s].toLowerCase()}`}
        value={fmtVal(s, last?.level)}
        sub={`raw ${fmtVal(s, last?.z ?? upd?.z ?? null)}`}
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
      ) : (
        <LiveSpotStat
          series={s}
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

/**
 * The one live number. Isolated so the socket's spot rate re-renders this
 * tile and nothing else — see note 3 at the top.
 */
function LiveSpotStat({
  series,
  level,
  obsSd,
}: {
  series: KfSeries
  level: number | null
  obsSd: number | null
}) {
  const spot = useField<SpotFrame, number>('spot', (f) => {
    const v = Number(f?.data?.spot)
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0
  })
  if (series === 'flip') {
    const d = spot > 0 && level != null ? spot - level : null
    return (
      <Stat
        label="Spot − flip"
        value={d != null ? fmtDelta('flip', d) : EM_DASH}
        direction={d != null ? dirOf(d) : undefined}
        sub={d == null ? 'live spot' : d >= 0 ? `above flip · +γ · spot ${spot.toFixed(2)}` : `below flip · −γ · spot ${spot.toFixed(2)}`}
      />
    )
  }
  // Spot series: how stretched live price is from its own filtered level.
  const z = spot > 0 && level != null && obsSd != null && obsSd > 0 ? (spot - level) / obsSd : null
  return (
    <Stat
      label="Stretch"
      value={z != null ? `${z >= 0 ? '+' : '-'}${Math.abs(z).toFixed(1)}σ` : EM_DASH}
      direction={z != null ? dirOf(z, 0.5) : undefined}
      sub={spot > 0 ? `live ${spot.toFixed(2)} vs filtered` : 'live spot'}
    />
  )
}

// ── Empty states, legend, sub-panel frame ────────────────────────────────────

function EmptyNote({
  model,
  loading,
  expiry,
  hasColumns,
}: {
  model: Model | null
  loading: boolean
  expiry: string
  hasColumns: boolean
}) {
  let text: string | null = null
  if (!hasColumns) text = loading ? 'Loading the session’s GEX ladders…' : `No GEX history recorded for ${expiry || 'this expiry'} yet.`
  else if (model && model.run.observed < 3) {
    text =
      model.series === 'flip'
        ? 'No zero-gamma crossing in the ladder for most of this session — the board stayed one-signed, so there is no flip to filter. Try NET GEX.'
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
    { label: horizonMin ? `Forecast +${horizonMin}m` : 'Forecast', color: T.orange, shape: 'dash' },
    { label: `Surprise >${KF_SURPRISE_SIGMA}σ`, color: T.orange, shape: 'ring' },
    { label: 'Level break', color: T.orange, shape: 'diamond' },
  ]
  if (series === 'flip') items.push({ label: 'Spot', color: alpha(T.text, 0.4), shape: 'line' })
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <Swatch color={it.color} shape={it.shape} />
          {it.label}
        </span>
      ))}
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

function HowItWorks({ smooth, model }: { smooth: KfSmooth; model: Model | null }) {
  return (
    <div className="mt-3 border-t border-line pt-2 text-xs leading-relaxed text-muted">
      <span className="text-fg">How it works.</span> Every recorded minute the filter predicts the next value from
      its state (level + trend), then folds in the new print weighted by the Kalman gain K. K balances Q, how fast
      the true level can move, against R, how noisy a single print is. R is measured from this session’s own prints
      {model ? ` (σ ${fmtDelta(model.series, Math.sqrt(model.run.r)).replace(/^\+/, '')})` : ''}, never below{' '}
      {Math.round(KF_R_FLOOR_FRAC * 100)}% of the session’s range; Q is R × {KF_RATIO[smooth]} on {smooth.toUpperCase()}.
      Small K = the model is trusted and one print barely moves it; large K = it snaps onto the print. R is ×
      {KF_OPEN_BOOST} for the first 15 minutes of RTH. A print more than {KF_BREAK_SIGMA}σ off is held; a second one
      on the same side is a level break and the filter restarts on it, so a step (the morning OI update, say) is drawn
      as a step instead of an overshoot. The band is where the next print is expected (±2σ, widened by how far this
      model has actually been missing today); the cone carries the last level and trend forward with no new prints.
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

type Painter = (canvas: HTMLCanvasElement, w: number, h: number, m: Model | null, hover: number | null, axisW: number) => void

interface Geom {
  plotR: number
  plotW: number
  t0: number
  t1: number
  tEnd: number
  x: (t: number) => number
  tAt: (px: number) => number
}

/**
 * The x mapping, ONE definition for painting and hit-testing. `horizon` adds
 * the forecast reach to the right of the last column.
 */
function geom(w: number, m: Model, axisW: number, horizon: boolean): Geom {
  const pts = m.run.points
  const plotR = w - axisW
  const plotW = Math.max(1, plotR - PAD_L)
  const t0 = (pts[0] as KfPoint).t
  const t1 = (pts[pts.length - 1] as KfPoint).t
  const tEnd = horizon ? t1 + m.horizonMin * 60_000 : t1
  const span = Math.max(60_000, tEnd - t0)
  return {
    plotR,
    plotW,
    t0,
    t1,
    tEnd,
    x: (t) => PAD_L + ((t - t0) / span) * plotW,
    tAt: (px) => t0 + ((px - PAD_L) / plotW) * span,
  }
}

/** Nearest point by time. Points are in time order. */
function nearestIndex(pts: KfPoint[], t: number): number {
  let lo = 0
  let hi = pts.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((pts[mid] as KfPoint).t < t) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs((pts[lo - 1] as KfPoint).t - t) < Math.abs((pts[lo] as KfPoint).t - t)) return lo - 1
  return lo
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

function Panel({
  model,
  bus,
  paint,
  axisW,
  horizon,
}: {
  model: Model | null
  bus: HoverBus
  paint: Painter
  axisW: number
  horizon: boolean
}) {
  const { onMount: mountCanvas, onResize, onVisibility, setDraw } = useCanvasRenderer()
  const modelRef = useRef<Model | null>(model)
  modelRef.current = model

  const draw = useCallback(
    (canvas: HTMLCanvasElement, w: number, h: number) => paint(canvas, w, h, modelRef.current, bus.get(), axisW),
    [paint, bus, axisW],
  )

  // A new model (poll, series, smoothing) → one repaint. setDraw paints, and
  // defers the paint while the frame is off screen.
  useEffect(() => {
    setDraw(draw)
  }, [model, draw, setDraw])

  // The shared hover → one repaint per animation frame at most.
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
      const onMove = (e: MouseEvent) => {
        const m = modelRef.current
        if (!m || m.run.points.length < 2) return
        const rect = el.getBoundingClientRect()
        const g = geom(rect.width, m, axisW, horizon)
        bus.set(nearestIndex(m.run.points, g.tAt(e.clientX - rect.left)))
      }
      const onLeave = () => bus.set(null)
      el.addEventListener('mousemove', onMove)
      el.addEventListener('mouseleave', onLeave)
      return () => {
        el.removeEventListener('mousemove', onMove)
        el.removeEventListener('mouseleave', onLeave)
        cleanup?.()
      }
    },
    [mountCanvas, bus, axisW, horizon],
  )

  return <ChartFrame className="cursor-crosshair" onMount={onMount} onResize={onResize} onVisibility={onVisibility} />
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

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r, y)
  ctx.lineTo(x, y + r)
  ctx.lineTo(x - r, y)
  ctx.closePath()
  ctx.fill()
}

const paintMain: Painter = (canvas, w, h, m, hover, axisW) => {
  const ctx = sizeCanvas(canvas, w, h)
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  if (!ready(m)) return
  const pts = m.run.points
  const calib = m.run.calib

  const s = m.series
  const mono = fontMono()
  const ink = tokenHex('--color-fg')
  const dim = tokenHexAlpha('--color-fg', 0.5)
  const grid = tokenHexAlpha('--color-line', 0.9)
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

  const g = geom(w, m, axisW, true)
  const { plotR, plotW, x, t0, t1, tEnd } = g
  const usableH = Math.max(40, h - PAD_T - X_AXIS_H - PANE_GAP)
  const mainH = usableH * (1 - TREND_FRACTION)
  const trendTop = PAD_T + mainH + PANE_GAP
  const trendH = usableH * TREND_FRACTION

  // ── Main pane range: prints, the filtered line, spot (flip) and the cone's
  // centre line. The band and the cone are drawn clipped rather than allowed
  // to set the scale — the seed step's band is deliberately wide and the cone
  // grows as h³, and either would flatten the rest of the day.
  let lo = Infinity
  let hi = -Infinity
  const take = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as KfPoint
    take(p.z)
    take(p.level)
    if (s === 'flip') take(m.spots[i])
  }
  for (const f of m.fc) take(f.level)
  if (!(hi > lo)) {
    const c = Number.isFinite(lo) ? lo : 0
    lo = c - 1
    hi = c + 1
  }
  const padY = (hi - lo) * 0.08
  lo -= padY
  hi += padY
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

  ctx.save()
  ctx.beginPath()
  ctx.rect(PAD_L, PAD_T, plotW, mainH)
  ctx.clip()

  // ±2σ next-print band. Split at breaks: the state restarted there, and a
  // band bridging the two levels would describe nobody's forecast.
  const bandSeg = (from: number, to: number) => {
    if (to - from < 1) return
    ctx.beginPath()
    for (let i = from; i <= to; i++) {
      const p = pts[i] as KfPoint
      const py = y(p.level + 2 * p.obsSd * calib)
      if (i === from) ctx.moveTo(x(p.t), py)
      else ctx.lineTo(x(p.t), py)
    }
    for (let i = to; i >= from; i--) {
      const p = pts[i] as KfPoint
      ctx.lineTo(x(p.t), y(p.level - 2 * p.obsSd * calib))
    }
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = bandC
  let segFrom = 0
  for (let i = 1; i < pts.length; i++) {
    if ((pts[i] as KfPoint).kind === 'break') {
      bandSeg(segFrom, i - 1)
      segFrom = i
    }
  }
  bandSeg(segFrom, pts.length - 1)

  // The forecast cone.
  if (m.fc.length > 1) {
    ctx.fillStyle = coneC
    ctx.beginPath()
    m.fc.forEach((f, i) => {
      const py = y(f.level + 2 * f.sd)
      if (i === 0) ctx.moveTo(x(f.t), py)
      else ctx.lineTo(x(f.t), py)
    })
    for (let i = m.fc.length - 1; i >= 0; i--) {
      const f = m.fc[i] as KfForecastPoint
      ctx.lineTo(x(f.t), y(f.level - 2 * f.sd))
    }
    ctx.closePath()
    ctx.fill()
  }

  // Breaks: a dashed rule through the pane where the state restarted.
  ctx.strokeStyle = heldC
  ctx.lineWidth = 1
  ctx.setLineDash([2, 4])
  for (const b of m.breaks) {
    const bx = Math.round(x(b.t)) + 0.5
    ctx.beginPath()
    ctx.moveTo(bx, PAD_T)
    ctx.lineTo(bx, PAD_T + mainH)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // Spot under the flip — which side of it price sits on is the regime read.
  if (s === 'flip') {
    ctx.strokeStyle = spotC
    ctx.lineWidth = 1
    ctx.beginPath()
    let pen = false
    m.spots.forEach((v, i) => {
      if (v == null) {
        pen = false
        return
      }
      const px = x((pts[i] as KfPoint).t)
      if (!pen) ctx.moveTo(px, y(v))
      else ctx.lineTo(px, y(v))
      pen = true
    })
    ctx.stroke()
  }

  // Raw prints. Held ones in the warning hue — the filter did not take them.
  for (const p of pts) {
    if (p.z == null) continue
    ctx.fillStyle = p.kind === 'held' ? heldC : dotC
    ctx.beginPath()
    ctx.arc(x(p.t), y(p.z), p.kind === 'held' ? 2.4 : 1.6, 0, Math.PI * 2)
    ctx.fill()
  }

  // Surprises.
  ctx.strokeStyle = warnC
  ctx.lineWidth = 1.5
  for (const p of m.surprises) {
    if (p.z == null) continue
    ctx.beginPath()
    ctx.arc(x(p.t), y(p.z), 4.5, 0, Math.PI * 2)
    ctx.stroke()
  }

  // The filtered level — a vertical step at each break, never a slope.
  ctx.strokeStyle = lineC
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.beginPath()
  pts.forEach((p, i) => {
    const px = x(p.t)
    if (i === 0) ctx.moveTo(px, y(p.level))
    else if (p.kind === 'break') {
      ctx.lineTo(px, y((pts[i - 1] as KfPoint).level))
      ctx.lineTo(px, y(p.level))
    } else ctx.lineTo(px, y(p.level))
  })
  ctx.stroke()

  // Break markers on the line.
  ctx.fillStyle = warnC
  for (const b of m.breaks) diamond(ctx, x(b.t), y(b.level), 4)

  // The forecast centre line.
  if (m.fc.length > 1) {
    ctx.strokeStyle = warnC
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    m.fc.forEach((f, i) => {
      if (i === 0) ctx.moveTo(x(f.t), y(f.level))
      else ctx.lineTo(x(f.t), y(f.level))
    })
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.restore()

  // "Now" — where the prints stop and the cone starts.
  const nowX = Math.round(x(t1)) + 0.5
  ctx.strokeStyle = dim
  ctx.lineWidth = 1
  ctx.setLineDash([2, 3])
  ctx.beginPath()
  ctx.moveTo(nowX, PAD_T)
  ctx.lineTo(nowX, PAD_T + mainH)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = lineC
  ctx.beginPath()
  ctx.arc(x(t1), y((pts[pts.length - 1] as KfPoint).level), 3.5, 0, Math.PI * 2)
  ctx.fill()

  // Last-value tags on the axis: filtered (solid), the cone's end, and spot.
  ctx.font = `${TIP_PX}px ${mono}`
  const tag = (v: number, fill: string, text: string) => {
    const ty = Math.max(PAD_T + 7, Math.min(PAD_T + mainH - 7, y(v)))
    ctx.fillStyle = fill
    ctx.fillRect(plotR + 1, ty - 7, axisW - 2, 14)
    ctx.fillStyle = tagInk
    ctx.textAlign = 'left'
    ctx.fillText(text, plotR + 5, ty)
  }
  const fmtTag = (v: number) => (s === 'netgex' ? fmtB(v) : v.toFixed(1))
  const lastP = pts[pts.length - 1] as KfPoint
  if (s === 'flip') {
    const lastSpot = [...m.spots].reverse().find((v) => v != null)
    if (lastSpot != null) tag(lastSpot, ink, fmtTag(lastSpot))
  }
  const fcEnd = m.fc[m.fc.length - 1]
  if (fcEnd) tag(fcEnd.level, warnC, fmtTag(fcEnd.level))
  tag(lastP.level, lineC, fmtTag(lastP.level))

  // ── Trend pane ─────────────────────────────────────────────────────────────
  let tMax = 0
  for (const p of pts) tMax = Math.max(tMax, Math.abs(p.trend))
  if (!(tMax > 0)) tMax = 1
  const mid = trendTop + trendH / 2
  const ty = (v: number) => mid - (v / tMax) * (trendH / 2 - 2)
  ctx.strokeStyle = grid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_L, Math.round(mid) + 0.5)
  ctx.lineTo(plotR, Math.round(mid) + 0.5)
  ctx.stroke()
  const barW = Math.max(1, (plotW / Math.max(1, (tEnd - t0) / 60_000)) * 0.8)
  for (const p of pts) {
    const top = ty(p.trend)
    ctx.fillStyle = p.trend >= 0 ? upC : downC
    ctx.fillRect(x(p.t) - barW / 2, Math.min(top, mid), barW, Math.max(1, Math.abs(top - mid)))
  }
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
  const spanMin = (tEnd - t0) / 60_000
  const every = spanMin > 600 ? 120 : spanMin > 240 ? 60 : spanMin > 90 ? 30 : 15
  const axisY = h - X_AXIS_H / 2
  ctx.fillStyle = dim
  ctx.textAlign = 'center'
  const firstTick = Math.ceil(t0 / (every * 60_000)) * every * 60_000
  for (let t = firstTick; t <= tEnd; t += every * 60_000) {
    const tx = x(t)
    if (tx < PAD_L + 14 || tx > plotR - 14) continue
    if (Math.abs(tx - nowX) < 36) continue
    ctx.strokeStyle = grid
    ctx.beginPath()
    ctx.moveTo(Math.round(tx) + 0.5, PAD_T + mainH)
    ctx.lineTo(Math.round(tx) + 0.5, PAD_T + mainH + 3)
    ctx.stroke()
    ctx.fillText(etClock(t), tx, axisY)
  }
  ctx.fillStyle = ink
  ctx.fillText('now', nowX, axisY)

  // ── Hover ──────────────────────────────────────────────────────────────────
  if (hover == null) return
  const hp = pts[hover]
  if (!hp) return
  const hx = Math.round(x(hp.t)) + 0.5
  crosshair(ctx, hx, PAD_T, trendTop + trendH, dim)
  ctx.fillStyle = lineC
  ctx.beginPath()
  ctx.arc(hx, y(hp.level), 3, 0, Math.PI * 2)
  ctx.fill()

  const cz = calibratedZ(hp, calib)
  const kindLine: Record<KfPoint['kind'], string> = {
    seed: 'SEED — first print',
    update: '',
    predict: 'no print — predicted only',
    held: `HELD — >${KF_BREAK_SIGMA}σ off, not folded in`,
    break: 'BREAK — restarted on this print',
  }
  const lines = [
    `${etClock(hp.t)} ET`,
    `raw      ${fmtVal(s, hp.z)}`,
    `filtered ${fmtVal(s, hp.level)}`,
    `trend    ${fmtTrendHr(s, hp.trend)}`,
    `K        ${hp.k != null ? hp.k.toFixed(2) : EM_DASH}`,
    `resid    ${cz != null ? `${cz >= 0 ? '+' : '-'}${Math.abs(cz).toFixed(1)}σ` : EM_DASH}`,
  ]
  const spotH = m.spots[hover]
  if (s === 'flip' && spotH != null) lines.push(`spot     ${spotH.toFixed(2)}`)
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

/** Shared sub-pane time axis: first, middle and last column. */
function subAxis(ctx: CanvasRenderingContext2D, g: Geom, h: number, color: string) {
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  const ay = h - X_AXIS_H / 2
  const ticks: Array<[number, CanvasTextAlign]> = [
    [g.t0, 'left'],
    [(g.t0 + g.t1) / 2, 'center'],
    [g.t1, 'right'],
  ]
  for (const [t, align] of ticks) {
    ctx.textAlign = align
    ctx.fillText(etClock(t), g.x(t), ay)
  }
}

const paintResiduals: Painter = (canvas, w, h, m, hover, axisW) => {
  const ctx = sizeCanvas(canvas, w, h)
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  if (!ready(m)) return
  const pts = m.run.points
  const calib = m.run.calib
  const mono = fontMono()
  const dim = tokenHexAlpha('--color-fg', 0.5)
  const barC = tokenHexAlpha('--color-fg', 0.45)
  const warnC = tokenHex('--color-warn')
  const grid = tokenHexAlpha('--color-line', 0.9)
  const wash = tokenHexAlpha('--color-fg', 0.05)

  const g = geom(w, m, axisW, false)
  const top = PAD_T
  const paneH = Math.max(20, h - PAD_T - X_AXIS_H)
  let lim = 3
  for (const p of pts) {
    const z = calibratedZ(p, calib)
    if (z != null) lim = Math.max(lim, Math.abs(z))
  }
  lim = Math.min(6, Math.ceil(lim))
  const mid = top + paneH / 2
  const yz = (z: number) => mid - (Math.max(-lim, Math.min(lim, z)) / lim) * (paneH / 2)

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

  const barW = Math.max(1, (g.plotW / Math.max(1, pts.length)) * 0.6)
  for (const p of pts) {
    const px = g.x(p.t)
    if (p.kind === 'held' || p.kind === 'break') {
      // Off the scale by definition: a tick at the edge on the miss's side.
      const up = (p.nz ?? 0) >= 0
      ctx.fillStyle = warnC
      ctx.beginPath()
      const ey = up ? top + 1 : top + paneH - 1
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

  ctx.font = `${AXIS_PX}px ${mono}`
  ctx.fillStyle = dim
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(`+${lim}σ`, g.plotR + 4, top + 5)
  ctx.fillText('±2σ', g.plotR + 4, yz(2))
  ctx.fillText(`-${lim}σ`, g.plotR + 4, top + paneH - 5)
  subAxis(ctx, g, h, dim)

  if (hover == null) return
  const hp = pts[hover]
  if (!hp) return
  crosshair(ctx, Math.round(g.x(hp.t)) + 0.5, top, top + paneH, dim)
}

const paintVariance: Painter = (canvas, w, h, m, hover, axisW) => {
  const ctx = sizeCanvas(canvas, w, h)
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  if (!ready(m)) return
  const pts = m.run.points
  const s = m.series
  const mono = fontMono()
  const dim = tokenHexAlpha('--color-fg', 0.5)
  const lineC = tokenHex(SERIES_TOKEN[s])
  const warnC = tokenHexAlpha('--color-warn', 0.6)
  const grid = tokenHexAlpha('--color-line', 0.9)

  const g = geom(w, m, axisW, false)
  const top = PAD_T
  const paneH = Math.max(20, h - PAD_T - X_AXIS_H)
  // Scale to the settled teeth, not the seed or a restart: the 98th percentile
  // of the prior σ after the first few columns. Spikes above it clip.
  const tops = pts.slice(3).map((p) => p.priorSd).sort((a, b) => a - b)
  let yMax = tops.length ? (tops[Math.floor(0.98 * (tops.length - 1))] as number) : (pts[0] as KfPoint).priorSd
  if (!(yMax > 0)) yMax = 1
  yMax *= 1.15
  const ys = (v: number) => top + (1 - Math.min(v, yMax) / yMax) * paneH

  ctx.strokeStyle = grid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD_L, Math.round(top + paneH) + 0.5)
  ctx.lineTo(g.plotR, Math.round(top + paneH) + 0.5)
  ctx.stroke()

  // Breaks and held prints: where the sawtooth is interrupted.
  ctx.strokeStyle = warnC
  ctx.setLineDash([2, 4])
  for (const p of pts) {
    if (p.kind !== 'break' && p.kind !== 'held') continue
    const bx = Math.round(g.x(p.t)) + 0.5
    ctx.beginPath()
    ctx.moveTo(bx, top)
    ctx.lineTo(bx, top + paneH)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // The sawtooth: up to the predicted σ, down to the updated σ, every column.
  ctx.save()
  ctx.beginPath()
  ctx.rect(PAD_L, top - 1, g.plotW, paneH + 2)
  ctx.clip()
  ctx.strokeStyle = lineC
  ctx.lineWidth = 1
  ctx.beginPath()
  pts.forEach((p, i) => {
    const px = g.x(p.t)
    if (i === 0) ctx.moveTo(px, ys(p.sd))
    else {
      ctx.lineTo(px, ys(p.priorSd))
      ctx.lineTo(px, ys(p.sd))
    }
  })
  ctx.stroke()
  ctx.restore()

  ctx.font = `${AXIS_PX}px ${mono}`
  ctx.fillStyle = dim
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(s === 'netgex' ? fmtB(yMax).replace(/^\+/, '') : yMax.toFixed(2), g.plotR + 4, top + 5)
  ctx.fillText('0', g.plotR + 4, top + paneH - 4)
  subAxis(ctx, g, h, dim)

  if (hover == null) return
  const hp = pts[hover]
  if (!hp) return
  crosshair(ctx, Math.round(g.x(hp.t)) + 0.5, top, top + paneH, dim)
}
