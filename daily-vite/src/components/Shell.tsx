import { useState, type CSSProperties, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { T, label, body, display, MONO } from '../theme'

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

/**
 * Six tabs, all internal.
 *
 * The private household app had an external tab pointing at a cookbook on
 * another subdomain. That is the owner's own recipe collection and it has no
 * business in a product somebody pays for, so the slot went to Markets — the
 * economic and earnings calendars, and the reason a trader picks this planner
 * over any other planner.
 *
 * Habits, Projects and Journal keep their routes and their data; they have no
 * tab and are reached from More, exactly as before.
 */
const TABS = [
  { to: '/today', label: 'Today' },
  { to: '/todo', label: 'Todo' },
  { to: '/lists', label: 'Lists' },
  { to: '/markets', label: 'Markets' },
  { to: '/money', label: 'Money' },
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
  // Habits, Projects and Journal still have routes but no tab, so the title
  // falls back to a small map rather than reading "Home" on those screens.
  const EXTRA: Record<string, string> = {
    '/routines': 'Habits', '/projects': 'Projects', '/journal': 'Journal',
  }
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

      <AccountBanner />

      <nav style={{
        flexShrink: 0,
        display: 'grid',
        gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
        borderTop: `1px solid ${T.ruleStrong}`,
        background: T.paper,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {TABS.map((t) => {
          // Six tabs on a 390px screen is 65px each. At 0.12em tracking a long
          // word wraps to two lines and drags the whole bar taller, so the
          // tracking goes, not the label — the word is what makes a tab findable.
          const base: CSSProperties = {
            display: 'grid',
            placeItems: 'center',
            // 52px keeps the whole tab a comfortable thumb target.
            minHeight: 52,
            textDecoration: 'none',
            fontFamily: MONO,
            fontSize: 9.5,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }

          return (
            <NavLink
              key={t.to}
              to={t.to}
              style={({ isActive }) => ({
                ...base,
                color: isActive ? T.accent : T.muted,
                // A 2px accent rule marks the current tab — no icons, no fills.
                boxShadow: isActive ? `inset 0 2px 0 ${T.accent}` : 'none',
              })}
            >
              {t.label}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}

/**
 * The one line where being a paid product is allowed to show.
 *
 * A declined card and an unconfirmed email are both things that will quietly
 * cost someone their account, and both are fixed in More — so this says which
 * one it is and gets out of the way. One line, above the tab bar, where it sits
 * in the same place every time rather than pushing the page content down.
 *
 * Dismissal is component state on purpose: it lasts the visit and comes back on
 * the next load. Nothing about a lapsed payment gets remembered as "handled"
 * across sessions — a dunning notice you can permanently swipe away is how a
 * subscription ends without anyone noticing. And it is not a modal: the person
 * has paid for this app, and holding their todo list hostage over an email
 * confirmation would be extortion, not a reminder.
 */
function AccountBanner() {
  const { user } = useAuth()
  const [dismissed, setDismissed] = useState(false)

  if (!user || dismissed) return null

  const notice = user.subscription.status === 'past_due'
    ? 'Your card was declined — update it in More'
    : !user.emailVerified
      ? 'Confirm your email'
      : null
  if (!notice) return null

  // Orange, not red. Neither of these is broken yet — they are things to act on,
  // which is the entire job of T.warn in this palette.
  return (
    <div style={{
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '9px 13px',
      borderTop: `1px solid ${T.ruleStrong}`,
      background: 'rgba(251,133,1,0.10)',
    }}>
      <Link to="/settings" style={{
        ...body(13), color: T.warn, textDecoration: 'none',
        flex: 1, minWidth: 0,
        // One line, always. A banner that wraps to three lines on a narrow
        // phone is a panel, and a panel needs a reason to exist.
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {notice}
      </Link>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
          color: T.warn, fontSize: 16, lineHeight: 1,
          // 44px of hit area for a 16px glyph — this sits directly above the tab
          // bar, and a near-miss must not open Money.
          minHeight: 44, minWidth: 44, padding: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}
