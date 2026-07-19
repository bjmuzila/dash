import { C } from './theme'

export type Tile = { label: string; value: string; color: string }

// The right-aligned NET GEX / walls / flip / CB / max pain / EM / GEX% / bull-bear
// strip above the chart (HomeClient levels strip).
export default function LevelsStrip({ tiles }: { tiles: Tile[] }) {
  // Ledger style: de-boxed inline run — white uppercase labels, mono values in
  // their level color, split by hairline dividers instead of tiles.
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', padding: '10px 10px 4px', flexShrink: 0 }}>
      {tiles.map((t, i) => (
        <div
          key={t.label}
          style={{
            display: 'flex', flexDirection: 'column', gap: 2, padding: '0 16px', marginBottom: 8,
            borderRight: '1px solid rgba(255,255,255,0.08)',
            ...(i === 0 ? { paddingLeft: 0 } : null),
          }}
        >
          <span style={{ fontSize: 10, color: '#fff', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{t.label}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 800, color: t.color }}>{t.value}</span>
        </div>
      ))}
    </div>
  )
}

export { C }
