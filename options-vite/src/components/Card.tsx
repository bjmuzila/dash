import type { ReactNode } from 'react'
import { cardStyle, cardHead, C } from '../theme'

export default function Card({
  title,
  right,
  children,
}: {
  title: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <section style={cardStyle}>
      <header style={cardHead}>
        <span>{title}</span>
        {right ? (
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: C.muted }}>{right}</span>
        ) : null}
      </header>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </section>
  )
}
