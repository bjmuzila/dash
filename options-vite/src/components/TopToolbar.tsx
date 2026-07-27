import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { C, hairline } from '../theme'
import { useTicker } from '../TickerContext'
import { PAGES } from '../pages/registry'

function useClockET() {
  const [t, setT] = useState('')
  useEffect(() => {
    const tick = () =>
      setT(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date()),
      )
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return t
}

// Universal toolbar — spans the full width above every page.
export default function TopToolbar() {
  const clock = useClockET()
  const { ticker } = useTicker()

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        flexShrink: 0,
        margin: '10px 12px 0',
        padding: '10px 20px',
        background: 'rgba(10,13,20,0.9)',
        border: `1px solid ${hairline}`,
        borderRadius: 999,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.cyan, flexShrink: 0 }}>
        Options
      </span>

      <nav style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0, overflowX: 'auto' }}>
        {PAGES.map((p) => (
          <NavLink
            key={p.path}
            to={p.path}
            style={({ isActive }) => ({
              padding: '5px 12px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              color: isActive ? C.cyan : C.muted,
              background: isActive ? 'rgba(33,158,188,0.14)' : 'transparent',
            })}
          >
            {p.label}
          </NavLink>
        ))}
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: C.cyan }}>{ticker}</span>
        <span style={{ fontSize: 11, color: C.muted }}>PLACEHOLDER MODE</span>
        <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.04em' }}>{clock} ET</span>
      </div>
    </div>
  )
}
