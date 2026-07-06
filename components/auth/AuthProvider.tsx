"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";

/**
 * App-wide auth context backed by our own custom session (replaces the
 * Supabase-Session-based version, which itself replaced Clerk's useUser /
 * useAuth). Call sites read from useAuth() below, unchanged:
 *
 *   const { user, userId, isLoaded, isSignedIn, signOut } = useAuth();
 *
 * There's no client-side session object anymore (the session cookie is
 * httpOnly) -- state is fetched once from /api/auth/me, which reads the same
 * cookie server-side that middleware.ts already validates on every request.
 */

type MeUser = { id: string; email: string; isOwner: boolean; isPaid: boolean };

type AuthState = {
  user: MeUser | null;
  userId: string | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  isPaid: boolean;
  isOwnerClaim: boolean;
  displayName: string;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MeUser | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        setUser(data?.user ?? null);
        setIsLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setIsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    // Full reload clears any cached page state and re-runs middleware.
    window.location.href = "/";
  }, []);

  const value = useMemo<AuthState>(() => {
    const emailLocal = user?.email ? user.email.split("@")[0] : "";
    return {
      user,
      userId: user?.id ?? null,
      isLoaded,
      isSignedIn: !!user,
      isPaid: !!user?.isPaid,
      isOwnerClaim: !!user?.isOwner,
      displayName: emailLocal || "Trader",
      signOut,
    };
  }, [user, isLoaded, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Defensive default so a component rendered outside the provider (e.g. an
    // error boundary fallback) doesn't crash — treated as signed-out/loading.
    return {
      user: null,
      userId: null,
      isLoaded: false,
      isSignedIn: false,
      isPaid: false,
      isOwnerClaim: false,
      displayName: "Trader",
      signOut: async () => {},
    };
  }
  return ctx;
}
