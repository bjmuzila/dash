import { useEffect, useState } from 'react'
import { C } from './theme'

// Horizontal signals row — newest leftmost. Sourced from the same public
// signals.txt the live app polls (proxied to your backend). Each non-empty line
// is one signal; an optional leading "HH:MM AM • TAG" prefix is styled.
type Signal = { time: string; tag: string; text: string }

function parse(line: string): Signal {
  // e.g. "12:56 PM • FLOW • ↑ Whale call buy — NVDA 205C $1.4M"
  const parts = line.split('•').map((s) => s.trim())
  if (parts.length >= 3) return { time: parts[0], tag: parts[1], text: parts.slice(2).join(' • ') }
  if (parts.length === 2) return { time: parts[0], tag: '', text: parts[1] }
  return { time: '', tag: '', text: line }
}

export default function SignalsFeed() {
  const [signals, setSignals] = useState<Signal[]>([])

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const r = await fetch('/signals.txt', { cache: 'no-store' })
        if (!r.ok) return
        const txt = await r.text()
        const rows = txt.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12).map(parse)
        if (live) setSignals(rows)
      } catch { /* keep last */ }
    }
    load()
    const id = setInterval(load, 20000)
    return () => { live = false; clearInterval(id) }
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, color: C.cyan, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>
        Signals
      </div>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', flex: 1, minWidth: 0, paddingBottom: 4 }}>
        {signals.length === 0 && (
          <span style={{ fontSize: 11, color: '#5a6b85' }}>Waiting for signals… (served from /signals.txt on your backend)</span>
        )}
        {signals.map((s, i) => (
          <div key={i} style={{ flexShrink: 0, minWidth: 240, background: 'rgba(13,17,25,0.6)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#9fb0c3', fontFamily: 'var(--font-mono)' }}>{s.time}</span>
              {s.tag && <span style={{ fontSize: 9, fontWeight: 800, color: C.cyan, letterSpacing: '0.08em' }}>{s.tag}</span>}
            </div>
            <div style={{ fontSize: 12, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
