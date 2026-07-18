import { useState } from 'react'
import { C } from './theme'
import FlowPanel from './panels/FlowPanel'

// Bottom-left multi-tab card: Economic Calendar / Flow / Whale / Greeks / Scanner.
// Flow is wired to /proxy/flow-history. The others are framed placeholders that
// name the backend endpoint their real panel reads, ready to port next.
type Tab = 'calendar' | 'flow' | 'whale' | 'greeks' | 'scanner'

const TABS: { id: Tab; label: string }[] = [
  { id: 'calendar', label: 'Economic Calendar' },
  { id: 'flow', label: 'Flow' },
  { id: 'whale', label: 'Whale' },
  { id: 'greeks', label: 'Greeks' },
  { id: 'scanner', label: 'Scanner' },
]

function Placeholder({ title, endpoint }: { title: string; endpoint: string }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#5a6b85', textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#8a97ad' }}>{title}</div>
      <div style={{ fontSize: 12 }}>Live panel — reads <code style={{ color: C.cyan, fontFamily: 'var(--font-mono)' }}>{endpoint}</code> on your backend.</div>
      <div style={{ fontSize: 11, opacity: 0.7 }}>Port the component from <code style={{ fontFamily: 'var(--font-mono)' }}>components/dashboard/</code> to fill this in.</div>
    </div>
  )
}

export default function TabCard() {
  const [tab, setTab] = useState<Tab>('calendar')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', flexShrink: 0, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', fontSize: 12, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', flexShrink: 0,
              background: 'none', border: 'none', cursor: 'pointer', color: tab === t.id ? C.cyan : '#fff',
              borderBottom: tab === t.id ? `2px solid ${C.cyan}` : '2px solid transparent', marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tab === 'calendar' && <Placeholder title="Economic Calendar" endpoint="/api/econ-calendar" />}
        {tab === 'flow' && <FlowPanel />}
        {tab === 'whale' && <Placeholder title="Whale Orders" endpoint="/proxy/flow-history (large prints)" />}
        {tab === 'greeks' && <Placeholder title="Live Greeks" endpoint="/ws/gex greeks + /api/levels" />}
        {tab === 'scanner' && <Placeholder title="Scanner" endpoint="/api/scanner" />}
      </div>
    </div>
  )
}
