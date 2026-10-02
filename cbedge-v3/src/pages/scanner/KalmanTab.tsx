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
//   4. THE CHART IS A PLAIN CANVAS through `useCanvasRenderer`, so it inherits
//      the visibility gate and the `data-cb-layer` tag (non-negotiables 5, 6).
//      Hover repaints the same draw function; nothing ticks through React.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardToolbar } from '@/design/primitives/Card'
import { ChartFrame, type ChartHandle } from '@/design/primitives/ChartFrame'
import { SegGroup } from '@/design/primitives/Controls'
import { Stat, type Direction } from '@/design/primitives/Stat'
import { tokenHex, tokenHexAlpha } from '@/design/theme'
import { readableError, useQuery } from '@/data/api'
import { useField } from '@/data/hooks'
import type { SpotFrame } from '@/contract/frames'
import { sizeCanvas, useCanvasRenderer } from '@/board/chart-render'
import { gexHistoryUrl, latestSession, parseGexHistory } from '@/board/gexCandles/gexHistory'
import { BUBBLE_LADDER_REQUEST, GEX_HISTORY_MINUTES } from '@/board/gexCandles/settings'
import { EM_DASH, fmtB } from '@/pages/scanner/format'
import {
  KF_OPEN_BOOST,
  KF_RATIO,
  KF_SURPRISE_SIGMA,
  calibratedZ,
  columnsToObs,
  etClock,
  lastUpdated,
  runKalman,
  sessionObs,
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
}

// ── The tab ──────────────────────────────────────────────────────────────────

export default function KalmanTab() {
  const [series, setSeries] = useState<KfSeries>('flip')
  const [smooth, setSmooth] = useState<KfSmooth>('med')
  const [session, setSession] = useState<KfSession>('rth')

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
    const surprises = run.points.filter((p) => (calibratedZ(p, run.calib) ?? 0) > KF_SURPRISE_SIGMA)
    return { series, run, spots, surprises }
  }, [obs, series, smooth])

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

      <div className="relative mt-3 flex flex-col" style={{ height: 440 }}>
        <KalmanChart model={model} />
        <EmptyNote model={model} loading={loading} expiry={expiry} hasColumns={columns.length > 0} />
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
        sub={`raw ${fmtVal(s, upd?.z ?? null)}`}
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
        label="Surprises"
        value={model ? String(model.surprises.length) : EM_DASH}
        sub={
          lastSurprise
            ? `last ${etClock(lastSurprise.t)} ET · >${KF_SURPRISE_SIGMA}σ`
            : `prints >${KF_SURPRISE_SIGMA}σ off forecast`
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

// ── Empty states ─────────────────────────────────────────────────────────────

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

function HowItWorks({ smooth, model }: { smooth: KfSmooth; model: Model | null }) {
  return (
    <div className="mt-3 border-t border-line pt-2 text-xs leading-relaxed text-muted">
      <span className="text-fg">How it works.</span> Every recorded minute the filter predicts the next value from
      its state (level + trend), then folds in the new print weighted by the Kalman gain K. K balances Q, how fast
      the true level can move, against R, how noisy a single print is. R is measured from this session’s own prints
      {model ? ` (σ ${fmtDelta(model.series, Math.sqrt(model.run.r)).replace(/^\+/, '')})` : ''}; Q is R × {KF_RATIO[smooth]}{' '}
      on {smooth.toUpperCase()}. Small K = the model is trusted and one print barely moves it; large K = it snaps onto
      the print. R is ×{KF_OPEN_BOOST} for the first 15 minutes of RTH, so the open does not drag the line. Shaded band =
      where the next print is expected (±2σ, widened by how far this model has actually been missing today); orange
      rings = prints more than {KF_SURPRISE_SIGMA}σ off that forecast.
    </div>
  )
}

// ── The chart ────────────────────────────────────────────────────────────────

/** On the type scale: text-2xs for ticks, text-xs for the tooltip and tags. */
const AXIS_PX = 10
const TIP_PX = 11
const AXIS_W = 64
const X_AXIS_H = 18
const PANE_GAP = 10
const TREND_FRACTION = 0.24

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

function KalmanChart({ model }: { model: Model | null }) {
  const { onMount: mountCanvas, onResize, onVisibility, setDraw } = useCanvasRenderer()
  const modelRef = useRef<Model | null>(model)
  modelRef.current = model
  const hoverRef = useRef<number | null>(null)

  const draw = useCallback((canvas: HTMLCanvasElement, w: number, h: number) => {
    paintKalman(canvas, w, h, modelRef.current, hoverRef.current)
  }, [])

  // A new model (poll, series, smoothing) → one repaint. setDraw paints, and
  // defers the paint while the frame is off screen.
  useEffect(() => {
    setDraw(draw)
  }, [model, draw, setDraw])

  const onMount = useCallback(
    (handle: ChartHandle) => {
      const cleanup = mountCanvas(handle)
      const el = handle.el
      let raf = 0
      const indexAt = (clientX: number): number | null => {
        const m = modelRef.current
        const pts = m?.run.points
        if (!pts || pts.length === 0) return null
        const rect = el.getBoundingClientRect()
        const x = clientX - rect.left
        const plotW = Math.max(1, rect.width - AXIS_W - 8)
        const t0 = (pts[0] as KfPoint).t
        const t1 = (pts[pts.length - 1] as KfPoint).t
        const t = t0 + ((x - 8) / plotW) * Math.max(1, t1 - t0)
        let best = 0
        let bestD = Infinity
        for (let i = 0; i < pts.length; i++) {
          const d = Math.abs((pts[i] as KfPoint).t - t)
          if (d < bestD) {
            bestD = d
            best = i
          }
        }
        return best
      }
      const repaint = () => {
        if (raf) return
        raf = requestAnimationFrame(() => {
          raf = 0
          setDraw(draw)
        })
      }
      const onMove = (e: MouseEvent) => {
        const i = indexAt(e.clientX)
        if (i === hoverRef.current) return
        hoverRef.current = i
        repaint()
      }
      const onLeave = () => {
        if (hoverRef.current == null) return
        hoverRef.current = null
        repaint()
      }
      el.addEventListener('mousemove', onMove)
      el.addEventListener('mouseleave', onLeave)
      return () => {
        if (raf) cancelAnimationFrame(raf)
        el.removeEventListener('mousemove', onMove)
        el.removeEventListener('mouseleave', onLeave)
        cleanup?.()
      }
    },
    [mountCanvas, draw, setDraw],
  )

  return (
    <ChartFrame
      className="cursor-crosshair"
      onMount={onMount}
      onResize={onResize}
      onVisibility={onVisibility}
    />
  )
}

function paintKalman(canvas: HTMLCanvasElement, w: number, h: number, m: Model | null, hover: number | null): void {
  const ctx = sizeCanvas(canvas, w, h)
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  const pts = m?.run.points ?? []
  if (!m || pts.length < 2 || m.run.observed < 3) return

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
  const upC = tokenHexAlpha('--color-up', 0.75)
  const downC = tokenHexAlpha('--color-down', 0.75)
  const tagInk = tokenHex('--color-app')

  const padL = 8
  const padT = 8
  const plotR = w - AXIS_W
  const plotW = Math.max(1, plotR - padL)
  const usableH = Math.max(40, h - padT - X_AXIS_H - PANE_GAP)
  const mainH = usableH * (1 - TREND_FRACTION)
  const trendTop = padT + mainH + PANE_GAP
  const trendH = usableH * TREND_FRACTION

  const t0 = (pts[0] as KfPoint).t
  const t1 = (pts[pts.length - 1] as KfPoint).t
  const span = Math.max(60_000, t1 - t0)
  const x = (t: number) => padL + ((t - t0) / span) * plotW

  // ── Main pane range: prints, the filtered line and (flip) spot. The band is
  // drawn clipped rather than allowed to set the scale — the seed step's band
  // is deliberately wide and would flatten the rest of the day.
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
  if (!(hi > lo)) {
    const c = Number.isFinite(lo) ? lo : 0
    lo = c - 1
    hi = c + 1
  }
  const padY = (hi - lo) * 0.08
  lo -= padY
  hi += padY
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * mainH

  ctx.font = `${AXIS_PX}px ${mono}`
  ctx.textBaseline = 'middle'

  // Grid + right axis ticks.
  const step = niceStep(hi - lo, 5)
  ctx.lineWidth = 1
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const gy = Math.round(y(v)) + 0.5
    ctx.strokeStyle = grid
    ctx.beginPath()
    ctx.moveTo(padL, gy)
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
    ctx.moveTo(padL, y(0))
    ctx.lineTo(plotR, y(0))
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(padL, padT, plotW, mainH)
  ctx.clip()

  // ±2σ forecast band.
  ctx.fillStyle = bandC
  ctx.beginPath()
  pts.forEach((p, i) => {
    const px = x(p.t)
    const py = y(p.level + 2 * p.obsSd * m.run.calib)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i] as KfPoint
    ctx.lineTo(x(p.t), y(p.level - 2 * p.obsSd * m.run.calib))
  }
  ctx.closePath()
  ctx.fill()

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

  // Raw prints.
  ctx.fillStyle = dotC
  for (const p of pts) {
    if (p.z == null) continue
    ctx.beginPath()
    ctx.arc(x(p.t), y(p.z), 1.6, 0, Math.PI * 2)
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

  // The filtered level.
  ctx.strokeStyle = lineC
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.beginPath()
  pts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(x(p.t), y(p.level))
    else ctx.lineTo(x(p.t), y(p.level))
  })
  ctx.stroke()
  ctx.restore()

  // Last-value tags on the axis: filtered (solid) and, for the flip, spot.
  ctx.font = `${TIP_PX}px ${mono}`
  const tag = (v: number, fill: string, text: string) => {
    const ty = Math.max(padT + 7, Math.min(padT + mainH - 7, y(v)))
    ctx.fillStyle = fill
    ctx.fillRect(plotR + 1, ty - 7, AXIS_W - 2, 14)
    ctx.fillStyle = tagInk
    ctx.textAlign = 'left'
    ctx.fillText(text, plotR + 5, ty)
  }
  const lastP = pts[pts.length - 1] as KfPoint
  if (s === 'flip') {
    const lastSpot = [...m.spots].reverse().find((v) => v != null)
    if (lastSpot != null) tag(lastSpot, ink, lastSpot.toFixed(1))
  }
  tag(lastP.level, lineC, s === 'netgex' ? fmtB(lastP.level) : lastP.level.toFixed(1))

  // ── Trend pane ─────────────────────────────────────────────────────────────
  let tMax = 0
  for (const p of pts) tMax = Math.max(tMax, Math.abs(p.trend))
  if (!(tMax > 0)) tMax = 1
  const mid = trendTop + trendH / 2
  const ty = (v: number) => mid - (v / tMax) * (trendH / 2 - 2)
  ctx.strokeStyle = grid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padL, Math.round(mid) + 0.5)
  ctx.lineTo(plotR, Math.round(mid) + 0.5)
  ctx.stroke()
  const barW = Math.max(1, (plotW / pts.length) * 0.8)
  for (const p of pts) {
    const top = ty(p.trend)
    ctx.fillStyle = p.trend >= 0 ? upC : downC
    ctx.fillRect(x(p.t) - barW / 2, Math.min(top, mid), barW, Math.max(1, Math.abs(top - mid)))
  }
  ctx.font = `${AXIS_PX}px ${mono}`
  ctx.fillStyle = dim
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('TREND / HR', padL + 2, trendTop)
  ctx.textBaseline = 'middle'
  const trendTick = (perMin: number) => {
    const v = perMin * 60
    return s === 'netgex' ? fmtB(v) : `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}`
  }
  ctx.fillText(trendTick(tMax), plotR + 6, trendTop + 6)
  ctx.fillText(trendTick(-tMax), plotR + 6, trendTop + trendH - 6)

  // ── Time axis ──────────────────────────────────────────────────────────────
  const spanMin = span / 60_000
  const every = spanMin > 600 ? 120 : spanMin > 240 ? 60 : spanMin > 90 ? 30 : 15
  const axisY = h - X_AXIS_H / 2
  ctx.fillStyle = dim
  ctx.textAlign = 'center'
  const firstTick = Math.ceil(t0 / (every * 60_000)) * every * 60_000
  for (let t = firstTick; t <= t1; t += every * 60_000) {
    const tx = x(t)
    if (tx < padL + 14 || tx > plotR - 14) continue
    ctx.strokeStyle = grid
    ctx.beginPath()
    ctx.moveTo(Math.round(tx) + 0.5, padT + mainH)
    ctx.lineTo(Math.round(tx) + 0.5, padT + mainH + 3)
    ctx.stroke()
    ctx.fillText(etClock(t), tx, axisY)
  }

  // ── Hover ──────────────────────────────────────────────────────────────────
  if (hover == null) return
  const hp = pts[hover]
  if (!hp) return
  const hx = Math.round(x(hp.t)) + 0.5
  ctx.strokeStyle = dim
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(hx, padT)
  ctx.lineTo(hx, trendTop + trendH)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = lineC
  ctx.beginPath()
  ctx.arc(hx, y(hp.level), 3, 0, Math.PI * 2)
  ctx.fill()

  const lines = [
    `${etClock(hp.t)} ET`,
    `raw      ${fmtVal(s, hp.z)}`,
    `filtered ${fmtVal(s, hp.level)}`,
    `trend    ${fmtTrendHr(s, hp.trend)}`,
    `K        ${hp.k != null ? hp.k.toFixed(2) : 'predict only'}`,
    `resid    ${(() => {
      const z = calibratedZ(hp, m.run.calib)
      return z != null ? `${z.toFixed(1)}σ` : EM_DASH
    })()}`,
  ]
  const spotH = m.spots[hover]
  if (s === 'flip' && spotH != null) lines.push(`spot     ${spotH.toFixed(2)}`)
  ctx.font = `${TIP_PX}px ${mono}`
  let boxW = 0
  for (const l of lines) boxW = Math.max(boxW, ctx.measureText(l).width)
  boxW += 16
  const lineH = TIP_PX + 4
  const boxH = lines.length * lineH + 10
  const bx = hx + 12 + boxW > plotR ? hx - 12 - boxW : hx + 12
  const by = padT + 6
  ctx.fillStyle = tokenHexAlpha('--color-surface2', 0.95)
  ctx.fillRect(bx, by, boxW, boxH)
  ctx.strokeStyle = grid
  ctx.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.round(boxW), Math.round(boxH))
  ctx.fillStyle = ink
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  lines.forEach((l, i) => ctx.fillText(l, bx + 8, by + 6 + i * lineH))
}
