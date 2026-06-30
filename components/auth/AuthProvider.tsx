"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";

/**
 * App-wide auth context backed by Supabase Auth. Replaces Clerk's useUser /
 * useAuth. Call sites read from useAuth() below:
 *
 *   const { user, userId, isLoaded, isSignedIn, signOut } = useAuth();
 *
 * `userId` is the Supabase auth.users UUID (used everywhere the Clerk userId was).
 * `displayName` resolves Google name → email local-part → "Trader".
 */

type AuthState = {
  user: User | null;
  session: Session | null;
  userId: string | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  displayName: string;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = getSupabaseBrowser();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setIsLoaded(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setIsLoaded(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    // Full reload clears any cached page state and re-runs middleware.
    window.location.href = "/";
  }, [supabase]);

  const value = useMemo<AuthState>(() => {
    const user = session?.user ?? null;
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const nameFromMeta =
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.name === "string" && meta.name) ||
      "";
    const emailLocal = user?.email ? user.email.split("@")[0] : "";
    return {
      user,
      session,
      userId: user?.id ?? null,
      isLoaded,
      isSignedIn: !!user,
      displayName: nameFromMeta || emailLocal || "Trader",
      signOut,
    };
  }, [session, isLoaded, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Defensive default so a component rendered outside the provider (e.g. an
    // error boundary fallback) doesn't crash — treated as signed-out/loading.
    return {
      user: null,
      session: null,
      userId: null,
      isLoaded: false,
      isSignedIn: false,
      displayName: "Trader",
      signOut: async () => {},
    };
  }
  return ctx;
}
