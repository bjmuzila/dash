"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client (Supabase Auth).
 *
 * Cookie-based session via @supabase/ssr — the session set by sign-in is shared
 * with the server (middleware, server components, route handlers) through
 * cookies, so RLS reads `auth.uid()` natively. No Clerk token bridge, no
 * accessToken callback, no manual realtime.setAuth (the client refreshes its own
 * token and pushes it to the realtime socket).
 *
 * Singleton: one client per browser tab so the realtime socket isn't torn down
 * and rebuilt on every render.
 */

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

let cached: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (cached) return cached;
  if (!url || !anon) {
    throw new Error(
      "Supabase env missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY were not baked into this build.",
    );
  }
  cached = createBrowserClient(url, anon);
  return cached;
}
