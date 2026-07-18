import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import { C } from './theme'

// Live 5-minute ES futures candles. Reads the `esCandles` array off the shared
// /ws/gex feed (the snapshot seeds today's bars; live `esCandles` frames update
// them) and renders with lightweight-charts. No SQLite history — this is the
// live session; the full /es-candles page adds ~20d history, TPO, bubbles.
type RawCandle = Record<string, unknown>

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : NaN }

// slotKey "YYYY-MM-DDTHH:MM" (ET wall clock). Parse AS UTC so the axis shows the
// ET wall-clock label directly; bars stay monotonic and 5-min spaced.
function timeOf(c: RawCandle): UTCTimestamp | null {
  const sk = String(c.slotKey ?? '')
  if (sk.length >= 16) { const t = Date.parse(sk.slice(0, 16) + ':00Z'); if (Number.isFinite(t)) return (t / 1000) as UTCTimestamp }
  const ts = n(c.ts ?? c.timestamp)
  if (Number.isFinite(ts)) return (Math.floor((ts < 1e12 ? ts * 1000 : ts) / 1000)) as UTCTimestamp
  return null
}

function toBar(c: RawCandle) {
  const time = timeOf(c)
  const open = n(c.open ?? c.o), high = n(c.high ?? c.h), low = n(c.low ?? c.l), close = n(c.close ?? c.c)
  if (time == null || ![open, high, low, close].every(Number.isFinite)) return null
  return { time, open, high, low, close }
}

export default function EsCandlesView() {
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let chart: IChartApi | null = createChart(el, {
      layout: { background: { color: 'transparent' }, textColor: '#8a97ad', fontFamily: "var(--font-mono)" },
      grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.1)', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
    })
    const series: ISeriesApi<'Candlestick'> = chart.addSeries(CandlestickSeries, {
      upColor: C.green, downColor: C.negBar, wickUpColor: C.green, wickDownColor: C.negBar, borderVisible: false,
    })

    const bars = new Map<number, ReturnType<typeof toBar>>()
    const commit = () => {
      const arr = [...bars.values()].filter(Boolean).sort((a, b) => (a!.time as number) - (b!.time as number))
      // @ts-expect-error narrowed by filter(Boolean)
      series.setData(arr)
    }
    const ingest = (list: unknown) => {
      const items = Array.isArray(list) ? list : list ? [list] : []
      let changed = false
      for (const raw of items) {
        const bar = toBar(raw as RawCandle)
        if (bar) { bars.set(bar.time as number, bar); changed = true }
      }
      if (changed) commit()
    }

    let unmounted = false
    let ws: WebSocket | null = null
    let reconnect: ReturnType<typeof setTimeout> | null = null
    const handle = (rawMsg: string) => {
      let m: Record<string, unknown>
      try { m = JSON.parse(rawMsg) } catch { return }
      const type = String(m.type ?? '')
      const d = (m.data && typeof m.data === 'object' ? m.data : m) as Record<string, unknown>
      if (type === 'snapshot' || type === 'gex') { if (d.esCandles) ingest(d.esCandles) }
      else if (type === 'esCandles') ingest(d.esCandles ?? d.candles ?? d)
    }
    const schedule = () => { if (!unmounted) { if (reconnect) clearTimeout(reconnect); reconnect = setTimeout(connect, 2000) } }
    function connect() {
      if (unmounted) return
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      try { ws = new WebSocket(`${proto}//${window.location.host}/ws/gex`) } catch { schedule(); return }
      ws.onmessage = (e) => handle(String(e.data))
      ws.onerror = () => { try { ws?.close() } catch { /* ignore */ } }
      ws.onclose = () => { if (!unmounted) schedule() }
    }
    connect()

    return () => {
      unmounted = true
      if (reconnect) clearTimeout(reconnect)
      if (ws) { ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close() } catch { /* ignore */ } }
      if (chart) { chart.remove(); chart = null }
    }
  }, [])

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#7f92a8', textTransform: 'uppercase', flexShrink: 0 }}>
        ES 5-min · live session
      </div>
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  )
}
