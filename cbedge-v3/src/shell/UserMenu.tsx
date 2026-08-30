import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/data/auth'

// ─────────────────────────────────────────────────────────────────────────────
// THE ACCOUNT MENU — top right of the toolbar.
//
// Same menu as v2's components/shared/UserMenu.tsx, rebuilt on v3's tokens.
// Every row, every endpoint and every gate is carried across deliberately;
// what is NOT carried across is v2's inline `HOME_THEME.*` styling, because
// non-negotiable 1 (no colour literal outside tokens.css) applies here like
// everywhere else. Nothing below names a colour.
//
// ── Every link is a NATIVE <a>, on purpose ───────────────────────────────────
// v3's router runs with basename="/v3". A <NavLink to="/docs"> would resolve to
// /v3/docs — which is not a v3 route and, by App.tsx's no-catch-all rule, would
// render NotFound rather than the real Next page. These destinations are all
// top-level Next routes OUTSIDE the SPA, so they need a real navigation. This
// is the exact bug v2's UserMenu carries three separate comments about; it is
// cheaper to state the rule once here: nothing in this file uses the router.
// ─────────────────────────────────────────────────────────────────────────────

const INFO_LINKS: { href: string; label: string }[] = [
  { href: '/feedback', label: 'Feedback & Support' },
  { href: '/docs', label: 'Help & Docs' },
  { href: '/disclaimer', label: 'Disclaimer' },
  { href: '/risk-disclosure', label: 'Risk Disclosure' },
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
]

const STRIPE_PORTAL = 'https://billing.stripe.com/p/login/dR6cNfd9J3zE84U4gg'
const OWNER_HUB = 'https://owner.cbedge.net'

/** Deep-links straight to the ticket list rather than the new-ticket form. */
const TICKETS_HREF = '/feedback?tab=mine'
const TICKET_POLL_MS = 60_000

interface DiscordStatus {
  connected: boolean
  username?: string | null
  avatarUrl?: string | null
}

const ROW =
  'block w-full rounded-sm px-2.5 py-1.5 text-left text-sm font-medium text-fg no-underline transition-colors hover:bg-raised'

function Divider() {
  return <div className="my-1.5 border-t border-line" />
}

export function UserMenu() {
  const { user, displayName, isPaid, isOwner, signOut } = useAuth()
  const canUseDiscord = isPaid || isOwner

  const [open, setOpen] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [discord, setDiscord] = useState<DiscordStatus>({ connected: false })
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!user) return
    let active = true
    fetch('/api/discord/status', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: DiscordStatus) => {
        if (active) setDiscord(d)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [user])

  // Unread ticket replies. COUNT comes back from Postgres as a string on some
  // paths, so it is coerced rather than trusted.
  const loadUnread = useCallback(async () => {
    try {
      const r = await fetch('/api/feedback?scope=mine&limit=1', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!r.ok) return // signed out / not provisioned — leave the badge dark
      const j = (await r.json()) as { unreadCount?: number | string }
      const n = Number(j?.unreadCount ?? 0)
      setUnread(Number.isFinite(n) && n > 0 ? n : 0)
    } catch {
      /* the badge is a nicety — never let it surface an error */
    }
  }, [])

  useEffect(() => {
    if (!user) {
      setUnread(0)
      return
    }
    void loadUnread()
    // A background tab is nobody looking at a badge — skip the query and catch
    // up on the way back, so a parked dashboard is not a query a minute.
    const tick = () => {
      if (!document.hidden) void loadUnread()
    }
    const id = window.setInterval(tick, TICKET_POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [user, loadUnread])

  // Opening the menu is the one moment the number is actually read — refresh
  // it then, so it is never a minute stale at the moment it matters.
  useEffect(() => {
    if (open && user) void loadUnread()
  }, [open, user, loadUnread])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const disconnectDiscord = async () => {
    await fetch('/api/discord/status', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
    setDiscord({ connected: false })
  }

  const resetPassword = async () => {
    if (!user?.email) return
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: user.email }),
    }).catch(() => {})
    setResetSent(true)
    setTimeout(() => setResetSent(false), 4000)
  }

  const avatarUrl = discord.connected ? (discord.avatarUrl ?? '') : ''
  const initial = (displayName || 'T').charAt(0).toUpperCase()

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          unread > 0
            ? `${unread} unread ticket ${unread === 1 ? 'reply' : 'replies'}`
            : (user?.email ?? 'Account')
        }
        style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
        className={[
          'flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border bg-raised bg-cover bg-center text-xs font-bold text-fg',
          unread > 0 ? 'border-warn' : 'border-line',
        ].join(' ')}
      >
        {!avatarUrl && initial}
      </button>

      {/* The "light up": a dot on the avatar itself, so an unread reply is
          visible without opening the menu. The count lives on the row inside. */}
      {unread > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-warn"
        />
      )}

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 rounded-md border border-line bg-surface p-2 shadow-lg">
          <div className="px-2.5 py-1">
            <div className="truncate text-sm font-bold text-fg">{displayName}</div>
            {user?.email && <div className="break-all text-xs text-faint opacity-60">{user.email}</div>}
          </div>

          <Divider />

          <button type="button" onClick={() => void resetPassword()} className={ROW}>
            {resetSent ? '✓ Reset email sent' : 'Change password'}
          </button>

          <a href={STRIPE_PORTAL} target="_blank" rel="noopener noreferrer" className={ROW}>
            Manage subscription ↗
          </a>

          {canUseDiscord && (
            <>
              <Divider />
              {discord.connected ? (
                <div className="px-2.5 py-1.5">
                  <div className="text-sm font-medium text-fg">Discord: {discord.username}</div>
                  <button
                    type="button"
                    onClick={() => void disconnectDiscord()}
                    className="mt-0.5 text-xs text-faint underline opacity-60 hover:opacity-100"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <a href="/api/discord/connect" className={ROW}>
                  Join Discord
                </a>
              )}
            </>
          )}

          <Divider />

          <a href="/guide" className={ROW}>
            Site Guide
          </a>
          <a href="/whats-new" className={ROW}>
            What&apos;s New
          </a>

          {/* Owner hub. CHROME ONLY — the link is hidden for everyone else, and
              the route behind it is hard-blocked server-side by middleware.ts
              (OWNER_PATTERNS) and by OwnerGuard on the owner layout. Hiding it
              here is convenience, not the gate. */}
          {isOwner && (
            <a href={OWNER_HUB} className={ROW}>
              Owner ↗
            </a>
          )}

          <Divider />

          <a
            href={TICKETS_HREF}
            className={[
              ROW,
              'flex items-center justify-between gap-2',
              unread > 0 ? 'bg-raised font-bold text-warn' : '',
            ].join(' ')}
          >
            <span>My Tickets</span>
            {unread > 0 && (
              <span className="tabular inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warn px-1.5 text-2xs font-extrabold text-bg">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </a>

          {INFO_LINKS.map((it) => (
            <a key={it.href} href={it.href} className={ROW}>
              {it.label}
            </a>
          ))}

          <Divider />

          <button
            type="button"
            onClick={() => void signOut()}
            className={[ROW, 'font-semibold text-down'].join(' ')}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export default UserMenu
