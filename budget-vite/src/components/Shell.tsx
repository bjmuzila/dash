import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { T, label, display, MONO } from '../theme'

/**
 * App shell — phone-first.
 *
 * The reference app is desktop-first with a left sidebar; that layout doesn't
 * survive a 390px screen, so the STYLE is borrowed and the STRUCTURE isn't. The
 * header carries the serif page title and a mono date line; navigation stays a
 * bottom tab bar where a thumb can reach it.
 *
 * 100dvh (not 100vh): on iOS Safari plain vh measures the viewport WITHOUT the
 * collapsible URL bar, which parks the tab bar ~80px below the fold.
 */

const TABS = [
  { to: '/today', label: 'Today' },
  { to: '/todo', label: 'Todo' },
  { to: '/lists', label: 'Lists' },
  { to: '/journal', label: 'Journal' },
  { to: '/budget', label: 'Money' },
  { to: '/settings', label: 'More' },
] as const

/** "Mon, Aug 6 · Week 32" — the reference's date line, in spirit. */
function dateLine(): string {
  const now = new Date()
  const d = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const start = new Date(now.getFullYear(), 0, 1)
  const week = Math.ceil((((now.getTime() - start.getTime()) / 86_400_000) + start.getDay() + 1) / 7)
  return `${d} · Week ${week}`
}

export default function Shell({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  // Habits and Projects still have routes but no tab, so the title falls back
  // to a small map rather than reading "Home" on those screens.
  const EXTRA: Record<string, string> = { '/routines': 'Habits', '/projects': 'Projects' }
  const tab = TABS.find((t) => pathname.startsWith(t.to))
  const title = tab?.label
    ?? Object.entries(EXTRA).find(([k]) => pathname.startsWith(k))?.[1]
    ?? 'Home'

  return (
    <div style={{
      height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: T.paper, backgroundImage: T.glow, color: T.ink,
    }}>
      <header style={{
        flexShrink: 0,
        padding: 'max(14px, env(safe-area-inset-top)) 20px 12px',
        borderBottom: `1px solid ${T.ruleStrong}`,
      }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div style={{ ...label(), display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>{dateLine()}</span>
            <span>{user?.displayName}</span>
          </div>
          <h1 style={{ ...display(26), marginTop: 6 }}>{title}</h1>
        </div>
      </header>

      <main style={{
        flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        // Tighter than the old 20px side padding: every section is a card now
        // and carries its own 15px inset, so keeping 20 here put content 35px
        // from the edge of a 390px screen and squeezed the seven-day strip.
        padding: '14px 13px 26px',
      }}>
        {/* Capped and centred. Today is a two-column dashboard above 860px, and
            without a cap those columns keep widening on a monitor until a task
            title is a single word floating in a metre of card. Below the cap
            this div does nothing at all, so the phone layout is untouched. */}
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>{children}</div>
      </main>

      <nav style={{
        flexShrink: 0,
        display: 'grid',
        gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
        borderTop: `1px solid ${T.ruleStrong}`,
        background: T.paper,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            style={({ isActive }) => ({
              display: 'grid',
              placeItems: 'center',
              // 52px keeps the whole tab a comfortable thumb target.
              minHeight: 52,
              textDecoration: 'none',
              fontFamily: MONO,
              // Six tabs on a 390px screen is 65px each. At 0.12em tracking
              // "JOURNAL" is wider than that and wraps to two lines, which
              // drags the whole bar taller. The tracking goes, not the label —
              // the word is what makes the tab findable.
              fontSize: 9.5,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              color: isActive ? T.accent : T.muted,
              // A 2px accent rule marks the current tab — no icons, no fills.
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
