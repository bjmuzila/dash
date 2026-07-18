import { C } from './theme'

export type Tile = { label: string; value: string; color: string }

// The right-aligned NET GEX / walls / flip / CB / max pain / EM / GEX% / bull-bear
// strip above the chart (HomeClient levels strip).
export default function LevelsStrip({ tiles }: { tiles: Tile[] }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 6, padding: '0 10px 6px', flexShrink: 0 }}>
      {tiles.map((t) => (
        <div
          key={t.label}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            background: 'radial-gradient(circle at 50% 0%, rgba(126,211,252,0.10) 0%, transparent 60%), rgba(13,17,25,0.35)',
            border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '3px 10px', minWidth: 64,
          }}
        >
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{t.label}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 800, color: t.color }}>{t.value}</span>
        </div>
      ))}
    </div>
  )
}

export { C }
