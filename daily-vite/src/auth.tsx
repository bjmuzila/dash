import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { auth as authApi, ApiError, type User } from './api'

/**
 * Who is signed in.
 *
 * The session lives entirely in an HttpOnly cookie (dy_session). This context
 * holds no token and writes nothing to localStorage, so there is nothing on the
 * page for a script to steal and nothing client-side to go stale. "Am I signed
 * in?" is answered by asking the server — /api/daily/auth/me, once on mount and
 * again whenever the tab comes back to the foreground.
 *
 * ENTITLEMENT IS NOT DECIDED HERE. The server already made that call and put
 * `entitled` on the user (see publicUser in daily-routes.cjs). If this file
 * started re-deriving it from `subscription.status`, there would be two
 * definitions of "is this customer paid up" that could disagree — and the one
 * that decides whether somebody gets into the app they paid for should be the
 * one sitting next to Stripe, not the one in a bundle cached on a phone.
 */

type AuthState = {
  user: User | null
  /** True until the first /me round-trip settles. Rendering the router on this,
   *  rather than on `user`, is what stops a signed-in customer seeing the
   *  marketing page flash on every cold start. */
  loading: boolean
  /** Set when the server was unreachable, as opposed to us being signed out. */
  offline: boolean
  /** True from a successful sign-in until something consumes it. Kept in memory
   *  and never persisted — it exists so a fresh sign-in can re-open a one-per-load
   *  offer (the PIN prompt) for what may be a different person on a shared phone. */
  justSignedIn: boolean
  clearJustSignedIn: () => void
  signIn: (email: string, password: string) => Promise<void>
  /** Quick sign-in. Only works in a browser that has been armed: the PIN is half
   *  the credential, the HttpOnly dy_device cookie is the other half. */
  signInWithPin: (pin: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  setUser: (u: User) => void
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)
  const [justSignedIn, setJustSignedIn] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await authApi.me()
      setUser(u)
      setOffline(false)
    } catch (e) {
      // 401 is the ordinary signed-out path and clears the user. Status 0 means
      // the request never reached the server at all — keep whoever we had and
      // raise `offline` instead, because throwing somebody back to a sign-in
      // form for a two-second tunnel blip loses whatever they were typing and
      // teaches them the app logs them out at random.
      if (e instanceof ApiError && e.status === 0) setOffline(true)
      else { setUser(null); setOffline(false) }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Re-check when the tab comes back to the foreground. A phone left on the
  // home screen for a week wakes up to a possibly-expired session, and to a
  // subscription that may have lapsed or been fixed in the Stripe portal in
  // another tab; better to find out on focus than on the next write.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const signIn = useCallback(async (email: string, password: string) => {
    const { user: u } = await authApi.login(email, password)
    setUser(u)
    setOffline(false)
    setJustSignedIn(true)
  }, [])

  const signInWithPin = useCallback(async (pin: string) => {
    const { user: u } = await authApi.pinLogin(pin)
    setUser(u)
    setOffline(false)
    setJustSignedIn(true)
  }, [])

  const clearJustSignedIn = useCallback(() => setJustSignedIn(false), [])

  // Signing out deliberately leaves the dy_device cookie alone. Quick sign-in
  // exists to make coming back fast; forgetting this device is a separate,
  // explicit choice in Settings. `finally` rather than `then`: if the logout
  // call fails we still drop the user locally, because a sign-out button that
  // visibly does nothing is worse than one that is optimistic.
  const signOut = useCallback(async () => {
    try { await authApi.logout() } finally { setUser(null); setJustSignedIn(false) }
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, loading, offline, justSignedIn, clearJustSignedIn,
             signIn, signInWithPin, signOut, refresh, setUser }),
    [user, loading, offline, justSignedIn, clearJustSignedIn, signIn, signInWithPin,
     signOut, refresh],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>')
  return v
}
