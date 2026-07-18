import { useState } from 'react'
import { C } from './theme'
import FlowPanel from './panels/FlowPanel'
import EconPanel from './panels/EconPanel'
import GreeksPanel from './panels/GreeksPanel'
import ScannerPanel from './panels/ScannerPanel'

// Bottom-left multi-tab card. Whale tab intentionally omitted for now.
type Tab = 'calendar' | 'flow' | 'greeks' | 'scanner'

const TABS: { id: Tab; label: string }[] = [
  { id: 'calendar', label: 'Economic Calendar' },
  { id: 'flow', label: 'Flow' },
  { id: 'greeks', label: 'Greeks' },
  { id: 'scanner', label: 'Scanner' },
]

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
        {tab === 'calendar' && <EconPanel />}
        {tab === 'flow' && <FlowPanel />}
        {tab === 'greeks' && <GreeksPanel />}
        {tab === 'scanner' && <ScannerPanel />}
      </div>
    </div>
  )
}
