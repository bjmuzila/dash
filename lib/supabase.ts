"use client";

/**
 * DEPRECATED — Clerk-bridged Supabase client. Replaced by the Supabase Auth SSR
 * clients in lib/supabase/. Kept only as a thin re-export so any stray import
 * still resolves; new code should import directly:
 *
 *   browser:  import { getSupabaseBrowser } from "@/lib/supabase/client";
 *   server:   import { getSupabaseServer } from "@/lib/supabase/server";
 *
 * The old getSupabase(getToken) signature no longer exists — auth is cookie-based
 * now, so no token callback is needed.
 */
export { getSupabaseBrowser } from "@/lib/supabase/client";
