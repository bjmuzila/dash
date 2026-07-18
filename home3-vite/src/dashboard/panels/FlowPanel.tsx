import { useEffect, useState } from 'react'
import { C } from '../theme'

// Flow tape — reads the same /proxy/flow-history the live FlowNetPremPanel uses.
// Shows the most recent SPX option prints with side coloring. Shape is defensive
// (the proxy returns an array of orders or { orders: [...] }).
type Order = {
  time?: string | number
  strike?: number
  side?: string
  type?: string
  premium?: number
  size?: number
  price?: number
  sym?: string
}

function fmt$(v?: number): string {
  if (!v) return '—'
  const a = Math.abs(v)
  if (a >= 1e6) return `$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `$${(a / 1e3).toFixed(1)}K`
  return `$${a.toFixed(0)}`
}

export default function FlowPanel() {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const r = await fetch('/proxy/flow-history?underlying=SPX&limit=200', { cache: 'no-store' })
        if (!r.ok) { if (live) setErr(`backend ${r.status}`); return }
        const j = await r.json()
        const arr: Order[] = Array.isArray(j) ? j : Array.isArray(j.orders) ? j.orders : Array.isArray(j.tape) ? j.tape : []
        if (live) { setOrders(arr.slice(-120).reverse()); setErr(null) }
      } catch {
        if (live) setErr('backend unreachable')
      }
    }
    load()
    const id = setInterval(load, 15000)
    return () => { live = false; clearInterval(id) }
  }, [])

  const td: React.CSSProperties = { padding: '5px 10px', fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'nowrap' }
  const th: React.CSSProperties = { padding: '8px 10px', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7f92a8', textAlign: 'left', position: 'sticky', top: 0, background: 'rgba(10,13,20,0.98)' }

  if (err) return <div style={{ padding: 24, color: '#5a6b85', fontSize: 12 }}>Flow feed: {err}. Reads <code style={{ color: C.cyan }}>/proxy/flow-history</code> — start your backend to populate.</div>
  if (!orders) return <div style={{ padding: 24, color: '#5a6b85', fontSize: 12 }}>Loading flow…</div>
  if (!orders.length) return <div style={{ padding: 24, color: '#5a6b85', fontSize: 12 }}>No recent prints.</div>

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={th}>Time</th>
          <th style={th}>Contract</th>
          <th style={{ ...th, textAlign: 'right' }}>Size</th>
          <th style={{ ...th, textAlign: 'right' }}>Premium</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o, i) => {
          const call = (o.type ?? o.side ?? '').toLowerCase().includes('c')
          const col = call ? C.green : C.red
          return (
            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <td style={{ ...td, color: '#9fb0c3' }}>{typeof o.time === 'number' ? new Date(o.time).toLocaleTimeString('en-US', { hour12: false }) : o.time ?? '—'}</td>
              <td style={{ ...td, color: col, fontWeight: 700 }}>{o.sym ?? `${o.strike ?? ''}${call ? 'C' : 'P'}`}</td>
              <td style={{ ...td, textAlign: 'right', color: '#cdd8e6' }}>{o.size ?? '—'}</td>
              <td style={{ ...td, textAlign: 'right', color: '#e8eef7' }}>{fmt$(o.premium)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
