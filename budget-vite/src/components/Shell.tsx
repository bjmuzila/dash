import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { T, FONT, SHELL_GLOW, labelCap } from '../theme'

/**
 * Phone-first app shell: a compact header, the routed page, and a bottom tab
 * bar sized for a thumb.
 *
 * 100dvh (not 100vh): on iOS Safari plain vh measures the viewport WITHOUT the
 * collapsible URL bar, which parks the tab bar ~80px below the fold. This is
 * the same problem app-vite solves with .cb-app-viewport.
 */

const TABS = [
  { to: '/today', label: 'Today', icon: '◎' },
  { to: '/routines', label: 'Routines', icon: '↻' },
  { to: '/projects', label: 'Projects', icon: '◇' },
  { to: '/budget', label: 'Budget', icon: '▤' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
] as const

export default function Shell({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const title = TABS.find((t) => pathname.startsWith(t.to))?.label ?? 'Home'

  return (
    <div
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: T.ink,
        backgroundImage: SHELL_GLOW,
        color: T.text,
        fontFamily: FONT,
      }}
    >
      <header
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          padding: 'max(12px, env(safe-area-inset-top)) 16px 12px',
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '0.01em' }}>{title}</div>
        <div style={labelCap({ opacity: 0.7 })}>{user?.displayName}</div>
      </header>

      <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 16 }}>
        {children}
      </main>

      <nav
        style={{
          flexShrink: 0,
          display: 'grid',
          gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
          borderTop: `1px solid ${T.border}`,
          background: 'rgba(2,3,8,0.92)',
          backdropFilter: 'blur(12px)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            style={({ isActive }) => ({
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              // 54px keeps the whole tab a comfortable thumb target.
              minHeight: 54,
              textDecoration: 'none',
              color: isActive ? T.accent : T.muted,
              // 5 tabs on a 390px phone: 10px + tighter tracking keeps every
              // label on one line. Any larger and "Routines" wraps.
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            })}
          >
            <span style={{ fontSize: 17, lineHeight: 1 }}>{tab.icon}</span>
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
