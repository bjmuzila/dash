import { useEffect, useRef, useState } from 'react'
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
// ── Almost every link is a NATIVE <a>, on purpose ────────────────────────────
// v3's router runs with basename="/v3". A <NavLink to="/docs"> would resolve to
// /v3/docs — which is not a v3 route and, by App.tsx's no-catch-all rule, would
// render NotFound rather than the real Next page. Those destinations are
// top-level Next routes OUTSIDE the SPA, so they need a real navigation. This is
// the exact bug v2's UserMenu carries three separate comments about.
//
// Feedback, My Tickets, Help & Docs, Site Guide, What's New and the legal
// links were removed from this menu on 2026-09-27.
// ─────────────────────────────────────────────────────────────────────────────

const STRIPE_PORTAL = 'https://billing.stripe.com/p/login/dR6cNfd9J3zE84U4gg'
const OWNER_HUB = 'https://owner.cbedge.net'

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
        title={user?.email ?? 'Account'}
        style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
        className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-line bg-raised bg-cover bg-center text-xs font-bold text-fg"
      >
        {!avatarUrl && initial}
      </button>

      {/* Phone (<640px): the panel is pinned to the VIEWPORT, not the avatar.
          The owner-only Voltick switch widened the phone toolbar enough that an
          avatar-anchored w-60 panel ran off the right edge. Fixed + clamped
          width keeps it on screen whatever the toolbar holds; desktop unchanged. */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 rounded-md border border-line bg-surface p-2 shadow-lg max-sm:fixed max-sm:left-auto max-sm:right-2 max-sm:top-12 max-sm:mt-0 max-sm:w-[min(15rem,calc(100vw-1rem))] max-sm:max-h-[calc(100dvh-4rem)] max-sm:overflow-y-auto">
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

          {/* Owner hub. CHROME ONLY — the link is hidden for everyone else, and
              the route behind it is hard-blocked server-side by middleware.ts
              (OWNER_PATTERNS) and by OwnerGuard on the owner layout. Hiding it
              here is convenience, not the gate. */}
          {isOwner && (
            <>
              <Divider />
              <a href={OWNER_HUB} className={ROW}>
                Owner ↗
              </a>
            </>
          )}

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
