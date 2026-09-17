import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  HistogramData,
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  LineData,
  SeriesMarker,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import type { FlowTapePrint } from '@/contract/frames'
import { ChartFrame, type ChartHandle } from '@/design/primitives/ChartFrame'
import { T, alpha, tokenHex, tokenHexAlpha } from '@/design/theme'
import { fmtNum, fmtPct, fmtUsd } from '@/data/flowMath'
import type { ContractStat } from '@/data/flowData'

// ─────────────────────────────────────────────────────────────────────────────
// The tape's in-place whale expansion.
//
// Clicking a whale row (premium ≥ WHALE_FLOOR) opens this directly underneath
// it rather than in a modal: the tape stays on screen, so the print being
// inspected can be compared against the ones around it.
//
// Contents: a pan/zoomable contract chart (close line, volume docked to the
// bottom, fill/peak/trough price lines and a BOUGHT/SOLD marker on the fill
// bar), the since-fill tracking, and Vol/OI + IV/%OTM tiles.
//
// Both timeframes are anchored to the print — Today (its own session) and All
// (its session → now) — and both are intraday. There is deliberately no 30D/90D:
// history from BEFORE the order printed says nothing about how the order did,
// and it drags the price axis until the interesting part is a flat line.
// ─────────────────────────────────────────────────────────────────────────────

export interface Bar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

type TF = 'today' | 'all'
const TFS: { id: TF; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'all', label: 'All' },
]

const etDate = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

export interface ContractDrawerProps {
  order: FlowTapePrint
  /** Normalized underlying root (SPXW → SPX) — the API's chainTicker key. */
  ticker: string
  stat: ContractStat | null
  /** Live underlying spot, for the % OTM readout. 0 = not loaded yet. */
  liveSpot: number
  onClose: () => void
}

export function ContractDrawer({ order, ticker, stat, liveSpot, onClose }: ContractDrawerProps) {
  const [tf, setTf] = useState<TF>('today')
  const [bars, setBars] = useState<Bar[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  /** The fill being tracked: this print's own option price. */
  const fillPrice = Number(order.price) || 0

  // The print's own session — the anchor for BOTH timeframes. Note this is the
  // PRINT's date, not literally today: a tape loaded for a past date has to
  // chart that date's session.
  const fillDate = etDate(order.ts)
  const todayEt = etDate(Date.now())
  // With a same-day print the two timeframes are identical, so All is not
  // offered — it would be a button that redraws the same chart.
  const sameDay = fillDate === todayEt

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErr(null)
    const params = new URLSearchParams({
      ticker,
      expiry: order.expiration ?? '',
      strike: String(order.strike),
      type: order.type,
      start: fillDate,
      end: tf === 'today' ? fillDate : todayEt,
      // The row's own dxFeed streamer symbol (".SPXW260731P6300"). The route
      // serves contract history off dxLink candles, and this is the exact
      // string the feed published for this contract — server-side
      // reconstruction can only GUESS at the root (SPX monthlies stream under
      // "SPX", weeklies under "SPXW"), so hand it the real one.
      symbol: order.symbol ?? '',
    })
    fetch(`/proxy/option-history?${params}`, { credentials: 'same-origin' })
      // The route puts the upstream message in `error` on a 502 — surface it
      // instead of a bare "HTTP 502", which says nothing about what broke.
      .then(async (r) => {
        const j = await r.json().catch(() => null)
        if (!r.ok) throw new Error(j?.error ? String(j.error).slice(0, 160) : `HTTP ${r.status}`)
        return j
      })
      .then((j) => {
        if (cancelled) return
        setBars(Array.isArray(j?.bars) ? j.bars : [])
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setErr(e instanceof Error ? e.message : String(e))
        setBars([])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ticker, order.expiration, order.strike, order.type, order.symbol, fillDate, todayEt, tf])

  // ── Since-fill: current / peak / trough over bars AT OR AFTER the print. ──
  //
  // Both timeframes start AT the print, so the series cannot contain pre-order
  // history — but it can still contain the part of the session before the print
  // landed, so the >= fill-time filter stays. If nothing is at or after the fill
  // (an order in the last bar of the day), fall back to the latest close and
  // FLAG it, rather than reporting a peak that predates the order.
  const track = useMemo(() => {
    if (!bars.length || !(fillPrice > 0)) return null
    const after = bars.filter((b) => b.time >= order.ts - 60_000)
    const noPostFill = !after.length
    const scope = noPostFill ? bars.slice(-1) : after
    let peak = -Infinity
    let trough = Infinity
    for (const b of scope) {
      peak = Math.max(peak, b.high ?? b.close)
      trough = Math.min(trough, b.low ?? b.close)
    }
    const current = scope[scope.length - 1]?.close ?? 0
    const pct = (p: number) => ((p - fillPrice) / fillPrice) * 100
    return {
      current, peak, trough,
      currentPct: pct(current), peakPct: pct(peak), troughPct: pct(trough),
      noPostFill,
    }
  }, [bars, fillPrice, order.ts])

  const dte = useMemo(() => {
    if (!order.expiration) return null
    // Measured against the PRINT's own session, so this figure agrees with the
    // DTE column in the row above it. v2 computed the two differently — local
    // midnight here, UTC midnight there — and they disagreed on every
    // historical row.
    const exp = Date.parse(`${order.expiration}T00:00:00Z`)
    const base = Date.parse(`${fillDate}T00:00:00Z`)
    if (!Number.isFinite(exp) || !Number.isFinite(base)) return null
    return Math.round((exp - base) / 86_400_000)
  }, [order.expiration, fillDate])

  const otmPct =
    liveSpot > 0 && order.strike
      ? ((order.type === 'C' ? order.strike - liveSpot : liveSpot - order.strike) / liveSpot) * 100
      : null

  const bull = (order.side === 'buy') === (order.type === 'C')

  return (
    <div className="border-b border-line px-4 py-3" style={{ background: alpha(T.cyan, 0.05) }}>
      {/* ── Header ── */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-bold uppercase tracking-[0.1em] text-fg">
          ↳ {ticker} {order.strike.toLocaleString()}
          {order.type} · {order.expiration ?? '—'}
          {dte != null && <span className="text-muted opacity-60"> · {dte} DTE</span>}
          <span className={['ml-2', bull ? 'text-up' : 'text-down'].join(' ')}>
            {bull ? '▲ BULL' : '▼ BEAR'}
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          {TFS.map((t) => {
            if (t.id === 'all' && sameDay) return null
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTf(t.id)}
                title={
                  t.id === 'today'
                    ? 'The session this print landed in'
                    : `Since the print (${fillDate}) → now`
                }
                className={[
                  'rounded-sm border px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide',
                  tf === t.id ? 'border-accent bg-raised text-fg' : 'border-line text-muted',
                ].join(' ')}
              >
                {t.label}
              </button>
            )
          })}
          <button
            type="button"
            onClick={onClose}
            title="Collapse"
            className="rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold text-muted"
          >
            ▲ Collapse
          </button>
        </div>
      </div>

      {/* ── Chart + KPI rail. The chart cell is a flex column so it fills the
           row's FULL height — the rail is the tallest thing here and the chart
           stretches to match rather than leaving dead space underneath. ── */}
      <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[1fr_230px]">
        <div className="flex min-h-[300px] flex-col rounded-md border border-line bg-surface2 p-2">
          {loading ? (
            <p className="p-5 text-xs text-faint">Loading contract history…</p>
          ) : err ? (
            <p className="p-5 text-xs text-down">Contract history unavailable ({err}).</p>
          ) : !bars.length ? (
            <p className="p-5 text-xs text-faint">
              No traded bars for this contract {tf === 'today' ? 'this session' : 'since the print'}.
            </p>
          ) : (
            <ContractChart
              bars={bars}
              fillPrice={fillPrice}
              fillTs={order.ts}
              side={order.side}
              track={track}
            />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Kpi
            label="Since Fill"
            value={track ? fmtPct(track.currentPct) : '—'}
            valueClass={!track ? 'text-muted' : track.currentPct >= 0 ? 'text-up' : 'text-down'}
            accent={track && track.currentPct >= 0 ? T.green : undefined}
            note={`${fmtUsd(fillPrice)}${track ? ` → ${fmtUsd(track.current)}` : ''}${
              track?.noPostFill ? ' · latest close' : ''
            }`}
          />
          <Kpi
            label="Peak / Trough"
            small
            value={
              <>
                <span className="text-up">{track ? fmtPct(track.peakPct) : '—'}</span>
                <span className="text-muted opacity-30"> / </span>
                <span className="text-down">{track ? fmtPct(track.troughPct) : '—'}</span>
              </>
            }
            note={
              track
                ? track.noPostFill
                  ? 'no bars after the print yet'
                  : `${fmtUsd(track.peak)} / ${fmtUsd(track.trough)}`
                : 'no bars since fill'
            }
          />
          <Kpi
            label="Vol / OI"
            small
            accent={T.orange}
            valueClass="text-warn"
            value={stat?.vol != null && stat?.oi ? (stat.vol / stat.oi).toFixed(2) : '—'}
            note={`${fmtNum(stat?.vol)} vol · ${fmtNum(stat?.oi)} oi`}
          />
          <Kpi
            label="IV · % OTM"
            small
            value={
              <>
                {stat?.iv != null ? `${(stat.iv * 100).toFixed(1)}%` : '—'}
                <span className="text-muted opacity-30"> · </span>
                <span
                  className={
                    otmPct == null ? 'text-muted' : otmPct >= 0 ? 'text-accent' : 'text-down'
                  }
                >
                  {otmPct == null ? '—' : `${otmPct.toFixed(1)}%`}
                </span>
              </>
            }
            note={`${order.size.toLocaleString()} ct · ${fmtUsd(order.premium)}${
              otmPct != null && otmPct < 0 ? ' · now ITM' : ''
            }`}
          />
        </div>
      </div>
    </div>
  )
}

function Kpi({
  label,
  value,
  note,
  valueClass = '',
  accent,
  small = false,
}: {
  label: string
  value: React.ReactNode
  note: React.ReactNode
  valueClass?: string
  /** Tints the tile's edge. A token string, never a literal. */
  accent?: string
  small?: boolean
}) {
  return (
    <div
      className="rounded-md border border-line bg-surface2 px-3 py-2.5"
      style={accent ? { borderColor: alpha(accent, 0.4) } : undefined}
    >
      <div className="text-2xs uppercase tracking-[0.08em] text-muted opacity-60">{label}</div>
      <div className={['mt-1 font-bold tabular', small ? 'text-xs' : 'text-base', valueClass].join(' ')}>
        {value}
      </div>
      <div className="mt-0.5 text-2xs tabular text-muted opacity-50">{note}</div>
    </div>
  )
}

// ── The contract chart ───────────────────────────────────────────────────────
//
// Close line + volume histogram docked to the bottom. The guides come from bar
// HIGHS/LOWS while the line is CLOSES, so a peak guide sitting above the line is
// correct — it is the intraday extreme, not a bug.

function ContractChart({
  bars,
  fillPrice,
  fillTs,
  side,
  track,
}: {
  bars: Bar[]
  fillPrice: number
  fillTs: number
  side: 'buy' | 'sell'
  track: { peak: number; trough: number } | null
}) {
  const chartRef = useRef<IChartApi | null>(null)
  const priceRef = useRef<ISeriesApi<'Line'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const visibleRef = useRef(true)

  const dataRef = useRef({ bars, fillPrice, fillTs, side, track })
  dataRef.current = { bars, fillPrice, fillTs, side, track }

  // "All" can span several sessions, where a bare clock time would repeat 09:30
  // once per day and read as nonsense.
  const multiDay = bars.length > 1 && (bars[bars.length - 1]?.time ?? 0) - (bars[0]?.time ?? 0) > 86_400_000

  const draw = () => {
    const chart = chartRef.current
    const price = priceRef.current
    const vol = volRef.current
    const d = dataRef.current
    if (!chart || !price || !vol || !d.bars.length) return

    const sec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp
    // Theta can emit two bars inside one interval across a session boundary,
    // and lightweight-charts throws on duplicate or unordered times.
    const seen = new Set<number>()
    const linePts: LineData[] = []
    const volPts: HistogramData[] = []
    const nearFill = tokenHex('--color-warn')
    const away = tokenHexAlpha('--color-series-5', 0.45)
    for (const b of d.bars) {
      const t = sec(b.time)
      if (seen.has(t)) continue
      seen.add(t)
      linePts.push({ time: t, value: b.close })
      volPts.push({
        time: t,
        value: b.volume ?? 0,
        color: Math.abs(b.time - d.fillTs) < 5 * 60_000 ? nearFill : away,
      })
    }
    price.setData(linePts)
    vol.setData(volPts)

    // Fill / peak / trough as real price lines so they stay pinned while panning.
    const lines = [
      d.fillPrice > 0 ? { price: d.fillPrice, color: tokenHex('--color-warn') } : null,
      d.track && Number.isFinite(d.track.peak) ? { price: d.track.peak, color: tokenHex('--color-up') } : null,
      d.track && Number.isFinite(d.track.trough) ? { price: d.track.trough, color: tokenHex('--color-down') } : null,
    ].filter((x): x is { price: number; color: string } => x !== null)
    const handles = lines.map((l) =>
      price.createPriceLine({
        price: l.price, color: l.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: false,
      }),
    )

    // The purchase itself — an arrow pinned to the fill BAR, so it survives pan
    // and zoom instead of being drawn at a fixed pixel.
    const fillBar = d.bars.find((b) => b.time >= d.fillTs - 60_000) ?? d.bars[0]
    const markers: SeriesMarker<UTCTimestamp>[] = fillBar
      ? [{
          time: sec(fillBar.time),
          position: d.side === 'buy' ? 'belowBar' : 'aboveBar',
          color: tokenHex('--color-warn'),
          shape: d.side === 'buy' ? 'arrowUp' : 'arrowDown',
          text: `${d.side === 'buy' ? 'BOUGHT' : 'SOLD'} ${fmtUsd(d.fillPrice)}`,
        }]
      : []

    const scan = d.bars.filter((b) => b.time >= d.fillTs - 60_000)
    const src = scan.length ? scan : d.bars
    const seed = src[0]
    if (seed && d.track && Number.isFinite(d.track.peak)) {
      const peakBar = src.reduce((a, b) => (b.close > a.close ? b : a), seed)
      markers.push({
        time: sec(peakBar.time), position: 'aboveBar', color: tokenHex('--color-up'),
        shape: 'arrowDown', text: `PEAK ${fmtUsd(d.track.peak)}`,
      })
    }
    if (seed && d.track && Number.isFinite(d.track.trough)) {
      const troughBar = src.reduce((a, b) => (b.close < a.close ? b : a), seed)
      markers.push({
        time: sec(troughBar.time), position: 'belowBar', color: tokenHex('--color-down'),
        shape: 'arrowUp', text: `TROUGH ${fmtUsd(d.track.trough)}`,
      })
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number))
    markersRef.current?.setMarkers(markers)

    chart.timeScale().fitContent()
    return () => handles.forEach((h) => price.removePriceLine(h))
  }

  const onMount = (handle: ChartHandle) => {
    visibleRef.current = handle.visible()
    let disposed = false
    let chart: IChartApi | null = null

    void (async () => {
      const { ColorType, CrosshairMode, HistogramSeries, LineSeries, createChart, createSeriesMarkers } =
        await import('lightweight-charts')
      if (disposed) return

      const line = tokenHexAlpha('--color-line', 0.55)
      const grid = tokenHexAlpha('--color-line', 0.35)

      chart = createChart(handle.el, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: tokenHex('--color-muted'),
          fontFamily: 'inherit',
        },
        grid: { vertLines: { color: grid }, horzLines: { color: grid } },
        rightPriceScale: { visible: true, borderColor: line },
        leftPriceScale: { visible: false },
        crosshair: { mode: CrosshairMode.Normal },
        timeScale: {
          borderColor: line, timeVisible: true, secondsVisible: false, rightOffset: 4,
          tickMarkFormatter: (time: unknown) =>
            typeof time === 'number'
              ? new Date(time * 1000).toLocaleString('en-US', {
                  timeZone: 'America/New_York',
                  ...(multiDay
                    ? { month: 'short', day: 'numeric', hour: 'numeric' }
                    : { hour: '2-digit', minute: '2-digit' }),
                })
              : '',
        },
        localization: {
          priceFormatter: (p: number) => `$${p.toFixed(2)}`,
          timeFormatter: (time: unknown) =>
            typeof time === 'number'
              ? new Date(time * 1000).toLocaleString('en-US', {
                  timeZone: 'America/New_York', month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })
              : '',
        },
      })

      const price = chart.addSeries(LineSeries, {
        color: tokenHex('--color-series-5'), lineWidth: 2,
        priceLineVisible: false, lastValueVisible: true,
      })
      const vol = chart.addSeries(HistogramSeries, {
        priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false,
        priceFormat: { type: 'volume' },
      })
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
      chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: 0.26 } })

      chartRef.current = chart
      priceRef.current = price
      volRef.current = vol
      markersRef.current = createSeriesMarkers(price, [])

      for (const c of handle.el.querySelectorAll('canvas')) {
        if (c.dataset.cbLayer === undefined) c.dataset.cbLayer = 'contract'
      }

      if (visibleRef.current) draw()
    })()

    return () => {
      disposed = true
      markersRef.current = null
      priceRef.current = null
      volRef.current = null
      chartRef.current = null
      chart?.remove()
    }
  }

  // multiDay only flips when the timeframe changes; the formatter closes over it
  // at creation, so the chart is rebuilt when it does — otherwise the axis
  // labels quietly go on lying.
  useEffect(() => {
    if (visibleRef.current) return draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, fillPrice, fillTs, side, track])

  return (
    <ChartFrame
      key={multiDay ? 'multi' : 'intraday'}
      onMount={onMount}
      onVisibility={(v) => {
        visibleRef.current = v
        if (v) draw()
      }}
    />
  )
}
