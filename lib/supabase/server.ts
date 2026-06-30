import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Server Supabase client (server components, route handlers).
 *
 * Reads/writes the auth session via Next's cookie store, so `auth.uid()` and
 * subscription gates work server-side. Use in API routes and server components
 * exactly where Clerk's server `auth()` was used:
 *
 *   const supabase = await getSupabaseServer();
 *   const { data: { user } } = await supabase.auth.getUser();
 *   if (!user) return 401;   // user.id is the Supabase UUID
 *
 * NOTE: in a pure server component (no response to mutate) cookie writes are
 * no-ops — that's expected and safe; the middleware refreshes the session.
 */

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

export async function getSupabaseServer(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component without a mutable response — safe to
          // ignore; the middleware handles session refresh.
        }
      },
    },
  });
}

/**
 * Convenience: the current signed-in user id (Supabase UUID) or null.
 * Mirrors the old `const { userId } = await auth()` shape.
 */
export async function getServerUserId(): Promise<string | null> {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

/**
 * Whether the current request is the owner. Prefers the JWT `is_owner` claim
 * (from the custom_access_token_hook); falls back to matching OWNER_USER_ID
 * while the hook is being rolled out. getUser() revalidates the token first,
 * so reading the claim from the local session here is trustworthy.
 */
export async function getServerIsOwner(): Promise<boolean> {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (token) {
    try {
      const payload = token.split(".")[1];
      if (payload) {
        const json = Buffer.from(
          payload.replace(/-/g, "+").replace(/_/g, "/"),
          "base64",
        ).toString("utf8");
        if (JSON.parse(json)?.is_owner === true) return true;
      }
    } catch {
      /* fall through to env match */
    }
  }
  return OWNER_USER_ID ? user.id.trim() === OWNER_USER_ID : false;
}
