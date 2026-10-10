"use client";

/**
 * DEPRECATED — no known importers. getSupabaseBrowser() (lib/supabase/client.ts)
 * is now a thin Supabase client used ONLY for the /chat Realtime channel
 * (authenticated via a minted JWT, see /api/auth/chat-token) — Auth itself is
 * fully custom now (lib/auth/*, lib/supabase/server.ts's getServerUserId etc).
 * There is no getSupabaseServer() anymore; server-side session reads go
 * through @/lib/supabase/server's getServerSession/getServerUserId/getServerUser.
 */
export { getSupabaseBrowser } from "@/lib/supabase/client";
