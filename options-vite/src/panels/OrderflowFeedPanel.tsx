import Card from '../components/Card'
import { C, hairlineSoft } from '../theme'
import { useTicker } from '../TickerContext'

const ROWS = [
  { t: '—:—:—', side: 'BUY', qty: '—', px: '—', tag: 'SWEEP' },
  { t: '—:—:—', side: 'SELL', qty: '—', px: '—', tag: 'BLOCK' },
  { t: '—:—:—', side: 'BUY', qty: '—', px: '—', tag: 'SPLIT' },
  { t: '—:—:—', side: 'SELL', qty: '—', px: '—', tag: 'SWEEP' },
  { t: '—:—:—', side: 'BUY', qty: '—', px: '—', tag: 'BLOCK' },
  { t: '—:—:—', side: 'SELL', qty: '—', px: '—', tag: 'SPLIT' },
]

export default function OrderflowFeedPanel() {
  const { ticker } = useTicker()
  return (
    <Card title="Live Orderflow Feed" right={`${ticker} · idle`}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '78px 52px 1fr 1fr 72px',
            gap: 8,
            padding: '8px 14px',
            color: C.muted,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            borderBottom: `1px solid ${hairlineSoft}`,
            position: 'sticky',
            top: 0,
            background: 'rgba(13,17,25,0.95)',
          }}
        >
          <span>Time</span>
          <span>Side</span>
          <span>Size</span>
          <span>Price</span>
          <span>Type</span>
        </div>
        {ROWS.map((r, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '78px 52px 1fr 1fr 72px',
              gap: 8,
              padding: '7px 14px',
              borderBottom: `1px solid ${hairlineSoft}`,
              opacity: 0.55,
            }}
          >
            <span style={{ color: C.muted }}>{r.t}</span>
            <span style={{ color: r.side === 'BUY' ? C.posBar : C.negBar, fontWeight: 800 }}>{r.side}</span>
            <span>{r.qty}</span>
            <span>{r.px}</span>
            <span style={{ color: C.muted }}>{r.tag}</span>
          </div>
        ))}
        <div style={{ padding: '12px 14px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted }}>
          {ticker} — placeholder rows, no stream connected
        </div>
      </div>
    </Card>
  )
}
