import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import { C } from './theme'

// Live candles for ES / NQ / SPY / QQQ.
//
// ES + NQ ride the shared /ws/gex feed — the snapshot seeds today's bars, then
// `esCandles` / `nqCandles` frames push live updates (the server already
// broadcasts both; see server-v2/websocket-server.js).
//
// SPY + QQQ have no push feed to the browser — the server only records them to
// Postgres every 60s (server-v2/state/etf-candle-recorder.js). Instead we poll
// the same on-demand route that recorder itself uses,
// GET /proxy/candles-intraday?symbol=SPY&interval=1m (server-v2/candle-history.js,
// backed by a short-lived isolated dxLink subscription — works for any dxLink
// symbol), refreshing every 15s.
//
// No SQLite/Postgres history is read here — this is the live session view; a
// future /candles page can add multi-day history, TPO, bubbles, etc.
export type CandleSymbol = 'ES' | 'NQ' | 'SPY' | 'QQQ'

type RawCandle = Record<string, unknown>
type Bar = { time: UTCTimestamp; open: number; high: number; low: number; close: number }

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : NaN }

// slotKey "YYYY-MM-DDTHH:MM" (ET wall clock). Parse AS UTC so the axis shows the
// ET wall-clock label directly; bars stay monotonic and spaced.
function timeOf(c: RawCandle): UTCTimestamp | null {
  const sk = String(c.slotKey ?? '')
  if (sk.length >= 16) { const t = Date.parse(sk.slice(0, 16) + ':00Z'); if (Number.isFinite(t)) return (t / 1000) as UTCTimestamp }
  const ts = n(c.ts ?? c.timestamp ?? c.time)
  if (Number.isFinite(ts)) return (Math.floor((ts < 1e12 ? ts * 1000 : ts) / 1000)) as UTCTimestamp
  return null
}

function toBar(c: RawCandle): Bar | null {
  const time = timeOf(c)
  const open = n(c.open ?? c.o), high = n(c.high ?? c.h), low = n(c.low ?? c.l), close = n(c.close ?? c.c)
  if (time == null || ![open, high, low, close].every(Number.isFinite)) return null
  return { time, open, high, low, close }
}

/** Epoch ms of today's ET midnight — anchors the SPY/QQQ REST fetch to the session. */
function etDayStartMs(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0)
  const minsSinceMidnight = get('hour') * 60 + get('minute')
  return Date.now() - minsSinceMidnight * 60_000
}

const WS_TYPES: Record<'ES' | 'NQ', string> = { ES: 'esCandles', NQ: 'nqCandles' }
const WS_FIELDS: Record<'ES' | 'NQ', string> = { ES: 'esCandles', NQ: 'nqCandles' }

export default function EsCandlesView({ symbol = 'ES' }: { symbol?: CandleSymbol }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let chart: IChartApi | null = createChart(el, {
      layout: { background: { color: 'transparent' }, textColor: '#8a97ad', fontFamily: 'var(--font-mono)' },
      grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.1)', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
    })
    const series: ISeriesApi<'Candlestick'> = chart.addSeries(CandlestickSeries, {
      upColor: C.green, downColor: C.negBar, wickUpColor: C.green, wickDownColor: C.negBar, borderVisible: false,
    })

    const bars = new Map<number, Bar>()
    const commit = () => {
      const arr = [...bars.values()].sort((a, b) => (a.time as number) - (b.time as number))
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
    let pollTimer: ReturnType<typeof setInterval> | null = null

    if (symbol === 'ES' || symbol === 'NQ') {
      const wantedType = WS_TYPES[symbol]
      const wantedField = WS_FIELDS[symbol]
      const handle = (rawMsg: string) => {
        let m: Record<string, unknown>
        try { m = JSON.parse(rawMsg) } catch { return }
        const type = String(m.type ?? '')
        const d = (m.data && typeof m.data === 'object' ? m.data : m) as Record<string, unknown>
        if (type === 'snapshot' || type === 'gex') { if (d[wantedField]) ingest(d[wantedField]) }
        else if (type === wantedType) ingest(d[wantedField] ?? d.candles ?? d)
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
    } else {
      // SPY / QQQ — no push feed; poll the on-demand intraday candle route.
      const fetchOnce = async () => {
        try {
          const url = `/proxy/candles-intraday?symbol=${symbol}&interval=1m&fromMs=${etDayStartMs()}`
          const r = await fetch(url, { cache: 'no-store' })
          if (!r.ok) return
          const j = await r.json()
          if (!unmounted && Array.isArray(j?.candles)) ingest(j.candles)
        } catch { /* ignore — try again next tick */ }
      }
      fetchOnce()
      pollTimer = setInterval(fetchOnce, 15_000)
    }

    return () => {
      unmounted = true
      if (reconnect) clearTimeout(reconnect)
      if (pollTimer) clearInterval(pollTimer)
      if (ws) { ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close() } catch { /* ignore */ } }
      if (chart) { chart.remove(); chart = null }
    }
  }, [symbol])

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#7f92a8', textTransform: 'uppercase', flexShrink: 0 }}>
        {symbol} {symbol === 'ES' || symbol === 'NQ' ? '5-min' : '1-min'} · live session
      </div>
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  )
}
