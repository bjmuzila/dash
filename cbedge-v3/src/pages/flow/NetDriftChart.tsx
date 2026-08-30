import { useEffect, useRef, useState } from 'react'
import type {
  HistogramData,
  IChartApi,
  ISeriesApi,
  LineData,
  UTCTimestamp,
  WhitespaceData,
} from 'lightweight-charts'
import type { FlowTapePrint } from '@/contract/frames'
import { ChartFrame, type ChartHandle } from '@/design/primitives/ChartFrame'
import { T, alpha, tokenHex, tokenHexAlpha } from '@/design/theme'
import { fmtPremium, fmtSpot, isBullish, type NetPoint, type NetSeries } from '@/data/flowMath'

// ─────────────────────────────────────────────────────────────────────────────
// Net Drift (Premium) — cumulative net call vs net put premium, one point per
// minute, with the minute's contract volume docked underneath.
//
// Imperative, per non-negotiable 4: the chart is created once inside
// ChartFrame's onMount and every later update goes through the library's own
// setData. Nothing about a data tick passes through React state on its way to
// the canvas.
//
// Visibility, per non-negotiable 5: onVisibility gates the pushes. A hidden
// card queues its latest series and applies it on the way back in, so nothing
// is lost and nothing is drawn into a canvas no one can see.
//
// lightweight-charts is imported DYNAMICALLY. It is the single heaviest thing
// this route touches and the route chunk has an 80KB brotli budget; a static
// import would spend most of it before the page has drawn a row.
// ─────────────────────────────────────────────────────────────────────────────

/** What the crosshair is over. Content changes only when the minute changes. */
interface TipState {
  timeSec: number
  etLabel: string
  orders: FlowTapePrint[]
  /** Underlying at that minute, 0 when the overlay has no point there. */
  spot: number
}

const TIP_MAX_ROWS = 8

export interface NetDriftChartProps {
  series: NetSeries
  /**
   * The visible tape indexed by minute bucket, biggest premium first. Drives
   * the hover tooltip's list of what actually printed in that minute.
   */
  ordersByMin: Map<number, FlowTapePrint[]>
  /**
   * The underlying's own path over the same window (buildSpotSeries). Drawn as
   * a thin overlay on its own HIDDEN price scale — the visible right axis is
   * premium in dollars, and putting an index level on it would make both
   * meaningless. Shape is the point; the level is read off the crosshair.
   */
  spotPts?: readonly NetPoint[]
}

export function NetDriftChart({ series, ordersByMin, spotPts }: NetDriftChartProps) {
  const chartRef = useRef<IChartApi | null>(null)
  const callRef = useRef<ISeriesApi<'Line'> | null>(null)
  const putRef = useRef<ISeriesApi<'Line'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const spotRef = useRef<ISeriesApi<'Line'> | null>(null)

  // Read by the crosshair handler, which is created once and must not close
  // over a stale render's props.
  const seriesRef = useRef(series)
  seriesRef.current = series
  const ordersRef = useRef(ordersByMin)
  ordersRef.current = ordersByMin
  const spotDataRef = useRef<readonly NetPoint[]>(spotPts ?? [])
  spotDataRef.current = spotPts ?? []

  // Minute -> spot, for the crosshair readout. Rebuilt only when the overlay
  // itself changes; the tooltip must not walk an array on every mousemove.
  const spotByMinRef = useRef<Map<number, number>>(new Map())

  const visibleRef = useRef(true)
  /** Set while hidden; applied on the way back in. */
  const pendingRef = useRef<NetSeries | null>(null)
  const pendingSpotRef = useRef<readonly NetPoint[] | null>(null)

  const [tip, setTip] = useState<TipState | null>(null)
  const tipElRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLElement | null>(null)

  const applySpot = (pts: readonly NetPoint[]) => {
    const spot = spotRef.current
    if (!spot) return
    const m = new Map<number, number>()
    for (const p of pts) if (p.value !== undefined) m.set(p.time, p.value)
    spotByMinRef.current = m
    // Value-only points, never whitespace: a Line series joins across a missing
    // index, which is what keeps the overlay continuous through quiet minutes.
    spot.setData(
      pts
        .filter((p) => p.value !== undefined)
        .map((p) => ({ time: p.time as UTCTimestamp, value: p.value as number }) as LineData),
    )
  }

  const apply = (s: NetSeries) => {
    const call = callRef.current
    const put = putRef.current
    const vol = volRef.current
    const chart = chartRef.current
    if (!call || !put || !vol || !chart) return

    const up = tokenHexAlpha('--color-up', 0.55)
    const down = tokenHexAlpha('--color-down', 0.55)

    call.setData(
      s.callPts.map((p) =>
        p.value === undefined
          ? ({ time: p.time as UTCTimestamp } as WhitespaceData)
          : ({ time: p.time as UTCTimestamp, value: p.value } as LineData),
      ),
    )
    put.setData(
      s.putPts.map((p) =>
        p.value === undefined
          ? ({ time: p.time as UTCTimestamp } as WhitespaceData)
          : ({ time: p.time as UTCTimestamp, value: p.value } as LineData),
      ),
    )
    vol.setData(
      s.volPts.map((p) =>
        p.value === undefined
          ? ({ time: p.time as UTCTimestamp } as WhitespaceData)
          : ({
              time: p.time as UTCTimestamp,
              value: p.value,
              color: p.lean === 'up' ? up : down,
            } as HistogramData),
      ),
    )

    // Pin the axis to the computed window. Deliberately NOT fitContent(), which
    // trims the trailing whitespace and re-scrolls — floating the day's shape to
    // the right and re-scaling it on every poll.
    try {
      chart.timeScale().setVisibleRange({
        from: s.openSec as UTCTimestamp,
        to: s.closeSec as UTCTimestamp,
      })
    } catch {
      /* an empty or single-point range throws; the next poll fixes it */
    }
  }

  const onMount = (handle: ChartHandle) => {
    hostRef.current = handle.el
    visibleRef.current = handle.visible()
    let disposed = false
    let chart: IChartApi | null = null

    void (async () => {
      const { ColorType, CrosshairMode, HistogramSeries, LineSeries, createChart } = await import(
        'lightweight-charts'
      )
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
          borderColor: line,
          timeVisible: true,
          secondsVisible: false,
          // The axis ticks. localization.timeFormatter below only reaches the
          // crosshair label, so both are needed to get an ET axis.
          tickMarkFormatter: (time: unknown) =>
            typeof time === 'number'
              ? new Date(time * 1000).toLocaleTimeString('en-US', {
                  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit',
                })
              : '',
        },
        localization: {
          priceFormatter: (p: number) => fmtPremium(p),
          timeFormatter: (time: unknown) =>
            typeof time === 'number'
              ? new Date(time * 1000).toLocaleTimeString('en-US', {
                  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit',
                })
              : '',
        },
      })

      const callSeries = chart.addSeries(LineSeries, {
        color: tokenHex('--color-up'),
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      })
      const putSeries = chart.addSeries(LineSeries, {
        color: tokenHex('--color-down'),
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      })
      const volSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: 'vol',
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: 'volume' },
      })
      // Spot overlay. Its own scale id => an OVERLAY price scale, which is not
      // rendered — so the index level never lands on the premium axis. Thin and
      // washed out on purpose: this is context behind the drift lines, not a
      // fourth thing competing with them.
      const spotSeries = chart.addSeries(LineSeries, {
        priceScaleId: 'spot',
        color: tokenHexAlpha('--color-fg', 0.38),
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      })
      // The volume histogram is docked in the bottom band; the drift lines get
      // everything above it. Keep the two bands adjacent — every point of gap
      // between `vol.top` and `1 - right.bottom` is vertical range the lines
      // pay for and nothing draws in.
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } })
      chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.04, bottom: 0.16 } })
      // Same band as the drift lines so the two read against each other, inset
      // a little so a flat spot day does not sit exactly on a drift line.
      chart.priceScale('spot').applyOptions({ visible: false, scaleMargins: { top: 0.08, bottom: 0.20 } })

      chartRef.current = chart
      callRef.current = callSeries
      putRef.current = putSeries
      volRef.current = volSeries
      spotRef.current = spotSeries

      // Non-negotiable 6. These canvases are the library's, but they are the
      // ones that paint on this page's behalf, so scripts/perf-check.mjs has to
      // be able to see them — an untagged canvas is measured as nothing at all.
      for (const c of handle.el.querySelectorAll('canvas')) {
        if (c.dataset.cbLayer === undefined) c.dataset.cbLayer = 'netdrift'
      }

      chart.subscribeCrosshairMove((param) => {
        const t = typeof param.time === 'number' ? param.time : null
        const bin = t != null ? seriesRef.current.byBin.get(t) : undefined
        // Nothing printed this minute, or the pointer left the pane.
        if (!param.point || t == null || !bin || (bin.callVol === 0 && bin.putVol === 0)) {
          setTip(null)
          return
        }
        const orders = ordersRef.current.get(t) ?? []
        if (orders.length === 0) {
          setTip(null)
          return
        }
        // Position imperatively: the pointer moves far more often than the
        // minute under it changes, and re-rendering a list on every mousemove
        // to move it sixteen pixels is the kind of thing that makes a page feel
        // heavy for no visible reason.
        const el = tipElRef.current
        const host = hostRef.current
        if (el && host) {
          const hostW = host.clientWidth
          const tipW = el.offsetWidth
          let left = param.point.x + 16
          if (left + tipW > hostW) left = param.point.x - tipW - 16
          el.style.left = `${Math.max(4, left)}px`
          el.style.top = `${Math.max(4, param.point.y - 10)}px`
        }
        setTip((prev) =>
          prev && prev.timeSec === t
            ? prev
            : {
                timeSec: t,
                etLabel: new Date(t * 1000).toLocaleTimeString('en-US', {
                  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit',
                }),
                orders,
                spot: spotByMinRef.current.get(t) ?? 0,
              },
        )
      })

      apply(seriesRef.current)
      applySpot(spotDataRef.current)
    })()

    return () => {
      disposed = true
      chartRef.current = null
      callRef.current = null
      putRef.current = null
      volRef.current = null
      spotRef.current = null
      hostRef.current = null
      chart?.remove()
    }
  }

  // Data pushes. Queued while the card is off screen and flushed on return —
  // the gate, not a throttle: an invisible chart does no work at all.
  useEffect(() => {
    if (!visibleRef.current) {
      pendingRef.current = series
      return
    }
    apply(series)
    // `apply` is recreated per render but only ever reads refs; the series in
    // the dep list is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series])

  // Spot overlay, gated the same way.
  useEffect(() => {
    const pts = spotPts ?? []
    if (!visibleRef.current) {
      pendingSpotRef.current = pts
      return
    }
    applySpot(pts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotPts])

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      <ChartFrame
        onMount={onMount}
        onVisibility={(v) => {
          visibleRef.current = v
          if (v && pendingRef.current) {
            apply(pendingRef.current)
            pendingRef.current = null
          }
          if (v && pendingSpotRef.current) {
            applySpot(pendingSpotRef.current)
            pendingSpotRef.current = null
          }
        }}
      />
      {tip && (
        <div
          ref={tipElRef}
          className="pointer-events-none absolute z-20 min-w-[230px] overflow-hidden rounded-md border border-line bg-surface text-sm shadow-lg"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
            <span className="text-fg">
              {tip.etLabel}
              {tip.spot > 0 && (
                <span className="ml-2 tabular text-xs text-muted">{fmtSpot(tip.spot)}</span>
              )}
            </span>
            <span className="tabular text-xs tracking-wider text-muted">
              OTM · {tip.orders.length} print{tip.orders.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex flex-col gap-1 p-2">
            {tip.orders.slice(0, TIP_MAX_ROWS).map((o) => {
              const bull = isBullish(o.side, o.type)
              return (
                <div
                  key={`${o.ts}-${o.symbol}-${o.side}`}
                  // The 8% wash has no token of its own — it is this one row's
                  // tint, not a surface — so it comes through alpha(), which is
                  // still the token underneath.
                  style={{ background: alpha(bull ? T.green : T.red, 0.08) }}
                  className={[
                    'flex items-center gap-2 rounded-r-sm border-l-[3px] px-2 py-1 tabular',
                    bull ? 'border-up' : 'border-down',
                  ].join(' ')}
                >
                  <span className={['w-3 text-center', bull ? 'text-up' : 'text-down'].join(' ')}>
                    {bull ? '▲' : '▼'}
                  </span>
                  <span className={['w-8 font-semibold', bull ? 'text-up' : 'text-down'].join(' ')}>
                    {o.side === 'buy' ? 'BUY' : 'SELL'}
                  </span>
                  <span className="flex-1 text-fg">
                    {o.strike.toLocaleString()}
                    {o.type} ×{o.size.toLocaleString()}
                  </span>
                  <span className={bull ? 'text-up' : 'text-down'}>{fmtPremium(o.premium)}</span>
                </div>
              )
            })}
            {tip.orders.length > TIP_MAX_ROWS && (
              <div className="px-2 pt-1 text-xs text-muted">
                +{tip.orders.length - TIP_MAX_ROWS} more…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
