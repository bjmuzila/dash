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
  /** `is_paid` claim from the custom_access_token_hook (mirrors middleware's
   *  server-side check) — lets client components gate UI without a round trip. */
  isPaid: boolean;
  /** `is_owner` claim, same source. */
  isOwnerClaim: boolean;
  displayName: string;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

/** Decode a JWT payload and read a boolean claim. No verification here — this
 *  is a client-side UI convenience only; every gated route/action is still
 *  enforced server-side (middleware.ts / ws-auth.js) regardless of this claim. */
function readClaim(accessToken: string | null | undefined, key: string): boolean {
  if (!accessToken) return false;
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return false;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json)?.[key] === true;
  } catch {
    return false;
  }
}

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
      isPaid: readClaim(session?.access_token, "is_paid"),
      isOwnerClaim: readClaim(session?.access_token, "is_owner"),
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
      isPaid: false,
      isOwnerClaim: false,
      displayName: "Trader",
      signOut: async () => {},
    };
  }
  return ctx;
}
