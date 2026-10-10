"use client";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client — used ONLY for the /chat Realtime channel now.
 * Auth is fully custom (see lib/auth/*, lib/supabase/server.ts); this client
 * no longer manages any session of its own. Instead it authenticates as
 * `authenticated` via a short-lived JWT minted server-side from OUR session
 * cookie (GET /api/auth/chat-token, signed with SUPABASE_JWT_SECRET) — the
 * documented "bring your own auth" pattern for supabase-js v2's `accessToken`
 * option. RLS policies keyed on auth.uid() keep working unchanged because the
 * minted JWT's `sub` claim is the same user id our own users table uses.
 *
 * Singleton: one client per browser tab so the realtime socket isn't torn down
 * and rebuilt on every render.
 */

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

let cachedToken: { token: string; expiresAt: number } | null = null;

async function fetchChatToken(): Promise<string | null> {
  // Reuse the cached token until ~5 min before it expires.
  if (cachedToken && cachedToken.expiresAt - Date.now() > 5 * 60_000) {
    return cachedToken.token;
  }
  try {
    const res = await fetch("/api/auth/chat-token", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.token) return null;
    cachedToken = { token: data.token, expiresAt: data.expiresAt };
    return data.token;
  } catch {
    return null;
  }
}

let cached: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (cached) return cached;
  if (!url || !anon) {
    throw new Error(
      "Supabase env missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY were not baked into this build.",
    );
  }
  cached = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    accessToken: fetchChatToken,
  });
  return cached;
}
