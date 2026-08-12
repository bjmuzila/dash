import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { T, label, display, SANS } from '../theme'

/**
 * App shell — phone-first, same skeleton as budget-vite.
 *
 * 100dvh (not 100vh): on iOS Safari plain vh measures the viewport WITHOUT the
 * collapsible URL bar, which parks the tab bar ~80px below the fold.
 *
 * The recipe screen is the one exception to the header. A recipe opens with a
 * full-bleed photo of the food, and a title bar above it would push the only
 * thing you came to look at halfway down the screen — so on /r/:id the header
 * is dropped and the page draws its own floating back button over the image.
 */

const TABS = [
  { to: '/cookbook', label: 'Cookbook' },
  { to: '/add', label: 'Add' },
  { to: '/saved', label: 'Saved' },
  { to: '/settings', label: 'More' },
] as const

function dateLine(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export default function Shell({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const onRecipe = pathname.startsWith('/r/')
  const tab = TABS.find((t) => pathname.startsWith(t.to))
  const title = tab?.label ?? 'Cookbook'

  return (
    <div style={{
      height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: T.paper, backgroundImage: T.glow, color: T.ink, fontFamily: SANS,
    }}>
      {!onRecipe && (
        <header style={{
          flexShrink: 0,
          padding: 'max(14px, env(safe-area-inset-top)) 20px 12px',
          borderBottom: `1px solid ${T.rule}`,
        }}>
          <div style={{ maxWidth: 1040, margin: '0 auto' }}>
            <div style={{ ...label(), display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>{dateLine()}</span>
              <span>{user?.displayName}</span>
            </div>
            <h1 style={{ ...display(28), marginTop: 6 }}>{title}</h1>
          </div>
        </header>
      )}

      <main style={{
        flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        // The recipe page bleeds its hero image to the edges, so it owns its own
        // padding. Everywhere else gets the standard inset.
        padding: onRecipe ? 0 : '14px 13px 26px',
      }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>{children}</div>
      </main>

      <nav style={{
        flexShrink: 0,
        display: 'grid',
        gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
        borderTop: `1px solid ${T.rule}`,
        background: T.paperRaised,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            style={({ isActive }) => ({
              display: 'grid',
              placeItems: 'center',
              minHeight: 52,
              textDecoration: 'none',
              fontFamily: SANS,
              fontSize: 12,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              color: isActive ? T.accent : T.muted,
              boxShadow: isActive ? `inset 0 2px 0 ${T.accent}` : 'none',
            })}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
