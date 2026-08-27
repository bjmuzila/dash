// ─────────────────────────────────────────────────────────────────────────────
// Real candlestick chart for ES Candles — a v3-native equivalent of v2's
// EsChartCard, scoped to what was actually asked for: the candlestick look,
// real zoom/pan, and GEX bubbles. NOT a port of v2's ~400KB component — that
// carries a full charting toolbar, replay transport, and EMA/Bollinger/RSI/
// volume indicators, which alone would blow every budget in budgets.json many
// times over. This is the chart itself, done properly.
//
// `lightweight-charts` is loaded via dynamic import, not a static one, so it
// lands in its own chunk (budgets.json's 'route' category, 80kb brotli) and
// never touches the entry bundle every other card pays for on first paint.
//
// GEX bubbles use the same technique v2's EsChartCard does: read the series'
// own price->pixel mapping (series.priceToCoordinate) and draw plain canvas
// circles on top, one per strike, sized by |netGEX|. v2 draws a full
// heatmap-over-time; this draws one column of bubbles pinned to the chart's
// right edge — the "wall" is the point, not a historical trail of it — which
// is what "gex bubbles" scopes down to without the rest of v2's overlay stack.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useRef } from 'react'
import type { ChartHandle } from '@/design/primitives/ChartFrame'
import type { GexRow } from '@/contract/frames'
import type { Candle } from './chart-render'

function cssVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

export interface LwChartHandle {
  setCandles: (candles: Candle[]) => void
  setGexRows: (rows: GexRow[]) => void
  destroy: () => void
}

export async function mountLwChart(container: HTMLElement): Promise<LwChartHandle> {
  const { createChart, CandlestickSeries, ColorType } = await import('lightweight-charts')

  // Colours read from tokens.css at mount time — the "no colour literal" rule
  // applies here too, it's just enforced at runtime instead of by Tailwind,
  // since the chart library takes plain colour strings, not classNames.
  const line = cssVar(container, '--color-line', '#23272e')
  const muted = cssVar(container, '--color-muted', '#9aa2ad')
  const up = cssVar(container, '--color-up', cssVar(container, '--color-accent', '#5b8cff'))
  const down = cssVar(container, '--color-down', '#e0645f')

  const chart = createChart(container, {
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: muted, fontSize: 11 },
    grid: { vertLines: { color: line }, horzLines: { color: line } },
    rightPriceScale: { borderColor: line },
    timeScale: { borderColor: line, timeVisible: true, secondsVisible: false },
    crosshair: {
      vertLine: { color: muted, labelBackgroundColor: muted },
      horzLine: { color: muted, labelBackgroundColor: muted },
    },
    autoSize: true,
  })

  const series = chart.addSeries(CandlestickSeries, {
    upColor: up,
    downColor: down,
    borderUpColor: up,
    borderDownColor: down,
    wickUpColor: up,
    wickDownColor: down,
  })

  // A transparent canvas laid over the chart's own canvas for the bubbles.
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
  const bubbleCanvas = document.createElement('canvas')
  bubbleCanvas.style.position = 'absolute'
  bubbleCanvas.style.inset = '0'
  bubbleCanvas.style.pointerEvents = 'none'
  container.appendChild(bubbleCanvas)

  let gexRows: GexRow[] = []
  let raf = 0

  // A steady rAF redraw rather than chasing every lightweight-charts event
  // that can move the price axis (pan, zoom, autoscale, and resize all
  // qualify). The draw itself is a handful of arcs — cheap enough that a
  // continuous redraw is simpler and more correct than enumerating "the axis
  // might have moved" events one at a time.
  function draw() {
    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    if (bubbleCanvas.width !== w * dpr || bubbleCanvas.height !== h * dpr) {
      bubbleCanvas.width = w * dpr
      bubbleCanvas.height = h * dpr
      bubbleCanvas.style.width = `${w}px`
      bubbleCanvas.style.height = `${h}px`
    }
    const ctx = bubbleCanvas.getContext('2d')
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (gexRows.length) {
        const maxAbs = Math.max(1, ...gexRows.map((r) => Math.abs(r.netGEX)))
        const maxR = Math.min(20, h / (gexRows.length * 1.4))
        for (const row of gexRows) {
          const y = series.priceToCoordinate(row.strike)
          if (y == null) continue
          const r = Math.max(3, Math.sqrt(Math.abs(row.netGEX) / maxAbs) * maxR)
          ctx.globalAlpha = 0.5
          ctx.fillStyle = row.netGEX >= 0 ? up : down
          ctx.beginPath()
          ctx.arc(w - r - 8, y, r, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }
    }
    raf = requestAnimationFrame(draw)
  }
  raf = requestAnimationFrame(draw)

  return {
    setCandles(candles) {
      series.setData(
        candles.map((c) => ({
          time: Math.floor(Number(c.t) / 1000) as import('lightweight-charts').UTCTimestamp,
          open: c.o,
          high: c.h,
          low: c.l,
          close: c.c,
        })),
      )
      chart.timeScale().fitContent()
    },
    setGexRows(rows) {
      gexRows = rows
    },
    destroy() {
      cancelAnimationFrame(raf)
      bubbleCanvas.remove()
      chart.remove()
    },
  }
}

/**
 * Wires an lwChart to a <ChartFrame>. `setCandles`/`setGexRows` are safe to
 * call before the chart has finished mounting (the dynamic import is async) —
 * the latest value is queued and flushed once mountLwChart resolves, the same
 * "always paint what's current" contract useCanvasRenderer gives its callers.
 */
export function useLwChartRenderer() {
  const handleRef = useRef<LwChartHandle | null>(null)
  const pendingCandles = useRef<Candle[] | null>(null)
  const pendingGex = useRef<GexRow[] | null>(null)

  const onMount = useCallback((h: ChartHandle): (() => void) => {
    let cancelled = false
    mountLwChart(h.el).then((created) => {
      if (cancelled) {
        created.destroy()
        return
      }
      handleRef.current = created
      if (pendingCandles.current) created.setCandles(pendingCandles.current)
      if (pendingGex.current) created.setGexRows(pendingGex.current)
    })
    return () => {
      cancelled = true
      handleRef.current?.destroy()
      handleRef.current = null
    }
  }, [])

  const setCandles = useCallback((candles: Candle[]) => {
    pendingCandles.current = candles
    handleRef.current?.setCandles(candles)
  }, [])

  const setGexRows = useCallback((rows: GexRow[]) => {
    pendingGex.current = rows
    handleRef.current?.setGexRows(rows)
  }, [])

  return { onMount, setCandles, setGexRows }
}
