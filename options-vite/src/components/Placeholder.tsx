import { C, hairlineSoft } from '../theme'

// Generic "nothing wired up yet" body. Every panel renders one of these so the
// layout has real weight before any data lands.
export default function Placeholder({
  label,
  ticker,
  note,
  shape = 'bars',
}: {
  label: string
  ticker: string
  note?: string
  shape?: 'bars' | 'candles' | 'grid' | 'radial' | 'rows'
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 16,
        position: 'relative',
      }}
    >
      <Skeleton shape={shape} />
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', color: C.cyan }}>
          {ticker} · {label}
        </div>
        <div style={{ fontSize: 11, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {note ?? 'placeholder — no data wired'}
        </div>
      </div>
    </div>
  )
}

function Skeleton({ shape }: { shape: 'bars' | 'candles' | 'grid' | 'radial' | 'rows' }) {
  const base = { animation: 'ph-pulse 2.6s ease-in-out infinite' } as const

  if (shape === 'radial') {
    return (
      <div style={{ ...base, position: 'relative', width: 132, height: 132 }}>
        {[64, 46, 28].map((r, i) => (
          <div
            key={r}
            style={{
              position: 'absolute',
              inset: 66 - r,
              borderRadius: '50%',
              border: `10px solid ${[C.cyan, C.purple, C.orange][i]}`,
              opacity: 0.28 + i * 0.1,
            }}
          />
        ))}
      </div>
    )
  }

  if (shape === 'grid') {
    return (
      <div style={{ ...base, display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 3, width: 'min(100%, 340px)' }}>
        {Array.from({ length: 48 }).map((_, i) => (
          <div
            key={i}
            style={{
              paddingTop: '100%',
              borderRadius: 2,
              background: i % 5 === 0 ? C.negBar : i % 3 === 0 ? C.posBar : hairlineSoft,
              opacity: 0.45,
            }}
          />
        ))}
      </div>
    )
  }

  if (shape === 'rows') {
    return (
      <div style={{ ...base, display: 'flex', flexDirection: 'column', gap: 6, width: 'min(100%, 300px)' }}>
        {[0.9, 0.7, 0.8, 0.5, 0.65].map((w, i) => (
          <div key={i} style={{ height: 8, width: `${w * 100}%`, borderRadius: 4, background: hairlineSoft }} />
        ))}
      </div>
    )
  }

  if (shape === 'candles') {
    return (
      <div style={{ ...base, display: 'flex', alignItems: 'flex-end', gap: 6, height: 96 }}>
        {[38, 60, 48, 74, 56, 88, 66, 52, 80, 62, 44, 70].map((h, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: 2, height: 10, background: i % 2 ? C.posBar : C.negBar, opacity: 0.5 }} />
            <div style={{ width: 8, height: h, borderRadius: 1, background: i % 2 ? C.posBar : C.negBar, opacity: 0.45 }} />
            <div style={{ width: 2, height: 8, background: i % 2 ? C.posBar : C.negBar, opacity: 0.5 }} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ ...base, display: 'flex', alignItems: 'center', gap: 5, height: 88 }}>
      {[0.3, 0.55, 0.8, 0.45, 0.95, 0.6, 0.35, 0.7, 0.5].map((h, i) => (
        <div
          key={i}
          style={{
            width: 14,
            height: `${h * 100}%`,
            borderRadius: 2,
            background: i % 2 ? C.posBar : C.negBar,
            opacity: 0.45,
          }}
        />
      ))}
    </div>
  )
}
