import { useState } from 'react'
import Card from '../components/Card'
import Placeholder from '../components/Placeholder'
import { C, hairlineSoft } from '../theme'
import { useTicker } from '../TickerContext'

type Range = 'daily' | 'yearly'

// Persistent panel — renders on every page.
export default function HeatmapPanel() {
  const { ticker } = useTicker()
  const [range, setRange] = useState<Range>('daily')

  return (
    <Card
      title="Heatmap"
      right={
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {(['daily', 'yearly'] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                padding: '3px 10px',
                borderRadius: 999,
                border: `1px solid ${range === r ? C.cyan : hairlineSoft}`,
                background: range === r ? 'rgba(33,158,188,0.14)' : 'transparent',
                color: range === r ? C.cyan : C.muted,
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {r}
            </button>
          ))}
        </span>
      }
    >
      <Placeholder label={`${range} heatmap`} ticker={ticker} shape="grid" />
    </Card>
  )
}
