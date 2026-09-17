import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// WHO IS LOOKING AT THIS.
//
// v3's own auth read. Deliberately NOT an import of v2's
// components/auth/AuthProvider — that file is a Next "use client" module that
// pulls in next/link through its call sites, and the clean-slate rule (see
// cbedge-v3/AGENTS.md) is that v3 shares no code with v2. What it DOES share is
// the wire: the same httpOnly session cookie, the same `/api/auth/me` endpoint
// that middleware.ts already validates on every request.
//
// The shape returned by /api/auth/me is fixed by server-v2's api-router:
//
//   { user: { id, email, isOwner, isPaid } | null }
//
// ── This is CHROME, not a gate ───────────────────────────────────────────────
// `isOwner` here decides what is DRAWN. It never decides what is allowed.
// Owner routes are hard-blocked server-side by middleware.ts (OWNER_PATTERNS,
// which today still covers the whole of /v3) and by OwnerGuard on the owner
// layouts. A hidden menu item is one devtools poke from being visible, so
// nothing sensitive may rely on this value alone.
// ─────────────────────────────────────────────────────────────────────────────

export interface MeUser {
  id: string
  email: string
  isOwner: boolean
  isPaid: boolean
}

export interface AuthState {
  user: MeUser | null
  userId: string | null
  /** false until /api/auth/me answers. Tells "not the owner" from "don't know yet". */
  isLoaded: boolean
  isSignedIn: boolean
  isPaid: boolean
  /** The server's own claim, unmodified. */
  isOwnerClaim: boolean
  /**
   * The claim OR a straight id match against VITE_OWNER_USER_ID, so the owner
   * cannot be locked out of their own tools before the claim is wired up on an
   * account. Same rule as v2's components/shared/useIsOwner.ts.
   */
  isOwner: boolean
  displayName: string
  signOut: () => Promise<void>
}

const SIGNED_OUT: AuthState = {
  user: null,
  userId: null,
  isLoaded: false,
  isSignedIn: false,
  isPaid: false,
  isOwnerClaim: false,
  isOwner: false,
  displayName: 'Trader',
  signOut: async () => {},
}

const Ctx = createContext<AuthState>(SIGNED_OUT)

/** Build-time owner id, optional. Empty string when unset. */
const OWNER_ID = String(import.meta.env.VITE_OWNER_USER_ID ?? '').trim()

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeUser | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: { user?: MeUser | null }) => {
        if (!active) return
        setUser(d?.user ?? null)
        setIsLoaded(true)
      })
      .catch(() => {
        if (!active) return
        setUser(null)
        setIsLoaded(true)
      })
    return () => {
      active = false
    }
  }, [])

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
    // Full reload rather than a route change: it clears every cache in the tab
    // (the REST cache in data/api.ts, the frame store, IndexedDB readers) and
    // re-runs middleware, which is what actually decides where a signed-out
    // visitor may go.
    window.location.href = '/'
  }, [])

  const value = useMemo<AuthState>(() => {
    const claim = !!user?.isOwner
    return {
      user,
      userId: user?.id ?? null,
      isLoaded,
      isSignedIn: !!user,
      isPaid: !!user?.isPaid,
      isOwnerClaim: claim,
      isOwner: claim || (!!OWNER_ID && !!user?.id && user.id === OWNER_ID),
      displayName: (user?.email ? user.email.split('@')[0] : '') || 'Trader',
      signOut,
    }
  }, [user, isLoaded, signOut])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  return useContext(Ctx)
}

/**
 * Owner-only chrome. Render on `isOwner` alone — it is false while loading, so
 * nothing flashes for a non-owner. Use `loaded` only when you need to tell
 * "not the owner" apart from "don't know yet".
 */
export function useIsOwner(): { isOwner: boolean; loaded: boolean } {
  const { isOwner, isLoaded } = useAuth()
  return { isOwner, loaded: isLoaded }
}
