"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client wired to Clerk auth.
 *
 * Uses Clerk's native third-party-auth integration (the JWT-template method was
 * deprecated April 2025). Supabase is configured to trust Clerk as a provider;
 * we hand Supabase Clerk's default session token via the `accessToken`
 * callback, so RLS sees the Clerk user id as `jwt.sub`. No template, no shared
 * JWT secret, no Supabase Auth session.
 *
 * Usage:
 *   const { getToken } = useAuth();        // from @clerk/nextjs
 *   const supabase = getSupabase(getToken);
 */

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

type GetToken = () => Promise<string | null>;

let cached: SupabaseClient | null = null;
let cachedGetToken: GetToken | null = null;

export function getSupabase(getToken: GetToken): SupabaseClient {
  // Reuse the client across renders unless the token source changes, so the
  // realtime socket isn't torn down and rebuilt on every render.
  if (cached && cachedGetToken === getToken) return cached;

  if (!url || !anon) {
    throw new Error(
      "Supabase env missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY were not baked into this build."
    );
  }

  cached = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    async accessToken() {
      return (await getToken()) ?? null;
    },
  });
  cachedGetToken = getToken;
  return cached;
}
