import { useEffect, useRef, useState } from 'react'
import { C } from '../theme'

// Live greeks — reads the `totals` block off the shared /ws/gex feed (same source
// GreeksHomePanel uses) and shows the 4 gauges (GEX/DEX/CHEX/VEX) + regime read.
// GEX/DEX in $B, CHEX/VEX in $M, OI+Vol basis.
type Point = { gex: number; dex: number; chex: number; vex: number; spot: number }

function pointFromTotals(t: Record<string, number> | null, spot: number | null): Point | null {
  if (!t) return null
  const dexOi = Number(t.totalDeltaCall ?? 0) + Number(t.totalDeltaPut ?? 0)
  const p: Point = {
    gex: Number(t.totalGEXOiVol ?? t.totalGEX ?? 0) / 1e9,
    dex: Number(t.totalDeltaOiVol ?? dexOi) / 1e9,
    chex: Number(t.totalCHEXOiVol ?? t.totalCHEX ?? 0) / 1e6,
    vex: Number(t.totalVEXOiVol ?? t.totalVEX ?? 0) / 1e6,
    spot: Number(spot ?? 0) || 0,
  }
  return (p.gex || p.dex || p.chex || p.vex) ? p : null
}

export default function GreeksPanel() {
  const [pt, setPt] = useState<Point | null>(null)
  const stateRef = useRef<{ totals: Record<string, number> | null; spot: number | null }>({ totals: null, spot: null })

  useEffect(() => {
    let unmounted = false
    let ws: WebSocket | null = null
    let reconnect: ReturnType<typeof setTimeout> | null = null
    const apply = () => { const p = pointFromTotals(stateRef.current.totals, stateRef.current.spot); if (p && !unmounted) setPt(p) }
    const handle = (raw: string) => {
      let m: Record<string, unknown>
      try { m = JSON.parse(raw) } catch { return }
      const type = String(m.type ?? '')
      const d = (m.data && typeof m.data === 'object' ? m.data : m) as Record<string, unknown>
      if (type === 'snapshot' || type === 'gex') {
        if (d.totals) stateRef.current.totals = d.totals as Record<string, number>
        if (d.spot != null && Number(d.spot) > 0) stateRef.current.spot = Number(d.spot)
        apply()
      } else if (type === 'spot' && d.spot != null) { stateRef.current.spot = Number(d.spot); apply() }
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
    return () => { unmounted = true; if (reconnect) clearTimeout(reconnect); if (ws) { ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close() } catch { /* ignore */ } } }
  }, [])

  if (!pt) return <div style={{ padding: 24, color: '#5a6b85', fontSize: 12 }}>Waiting for live greeks on /ws/gex…</div>

  const gauges = [
    { label: 'GEX', value: pt.gex, unit: 'B', good: pt.gex >= 0 },
    { label: 'DEX', value: pt.dex, unit: 'B', good: pt.dex >= 0 },
    { label: 'CHEX', value: pt.chex, unit: 'M', good: pt.chex >= 0 },
    { label: 'VEX', value: pt.vex, unit: 'M', good: pt.vex >= 0 },
  ]
  const regime = pt.gex >= 0
    ? { label: 'Positive gamma', body: 'Dealers long gamma — they sell rallies and buy dips. Expect mean-reversion, pinning toward large strikes, and compressed intraday range.', col: C.green }
    : { label: 'Negative gamma', body: 'Dealers short gamma — they buy rallies and sell dips. Expect trend continuation, faster moves, and expansion in range. Respect the flip level.', col: C.red }

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {gauges.map((g) => (
          <div key={g.label} style={{ background: 'rgba(13,17,25,0.5)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '12px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: '#7f92a8', textTransform: 'uppercase' }}>{g.label}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 800, color: g.good ? C.green : C.red, marginTop: 6 }}>
              {g.value >= 0 ? '+' : ''}{g.value.toFixed(2)}<span style={{ fontSize: 11, opacity: 0.7 }}>{g.unit}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: `radial-gradient(circle at 50% 0%, ${regime.col}14 0%, transparent 60%), rgba(13,17,25,0.4)`, border: `1px solid ${regime.col}44`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: regime.col, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{regime.label}</div>
        <div style={{ fontSize: 13, color: '#cdd8e6', lineHeight: 1.6 }}>{regime.body}</div>
      </div>
    </div>
  )
}
