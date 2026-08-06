import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { auth as authApi, ApiError, type HouseholdUser } from './api'

/**
 * Household auth context.
 *
 * The session lives entirely in an HttpOnly cookie — this holds no token and
 * writes nothing to localStorage, so there is nothing for a script on the page
 * to steal and nothing to go stale. "Am I signed in?" is answered by asking the
 * server (/api/hh/auth/me), once on mount.
 */

type AuthState = {
  user: HouseholdUser | null
  /** True until the first /me round-trip settles. Gate rendering on this or
   *  the login form flashes for an already-signed-in user on every load. */
  loading: boolean
  /** Set when the server was unreachable, as opposed to us being signed out. */
  offline: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  setUser: (u: HouseholdUser) => void
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<HouseholdUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await authApi.me()
      setUser(u)
      setOffline(false)
    } catch (e) {
      // 401 is the normal signed-out path. status 0 means we never reached the
      // server — keep whatever user we had rather than bouncing someone to the
      // login screen because the tunnel blipped.
      if (e instanceof ApiError && e.status === 0) setOffline(true)
      else { setUser(null); setOffline(false) }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Re-check when the tab comes back to the foreground. A phone left on the
  // home screen for a week wakes up to a possibly-expired session; better to
  // find out on focus than on the next write.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const signIn = useCallback(async (email: string, password: string) => {
    const { user: u } = await authApi.login(email, password)
    setUser(u)
    setOffline(false)
  }, [])

  const signOut = useCallback(async () => {
    try { await authApi.logout() } finally { setUser(null) }
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, loading, offline, signIn, signOut, refresh, setUser }),
    [user, loading, offline, signIn, signOut, refresh],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>')
  return v
}
