import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Builds a Supabase client bound to the middleware request/response cookie pair
 * and returns both the (possibly refreshed) response and the current user.
 *
 * IMPORTANT (per Supabase SSR guidance): always create the response first, let
 * Supabase write refreshed-session cookies onto it, and return THAT response
 * object from middleware so the refreshed session reaches the browser. Call
 * getUser() (not getSession()) — getUser() revalidates the token with the auth
 * server; getSession() trusts the cookie and can be spoofed.
 */
export async function getUserFromMiddleware(req: NextRequest): Promise<{
  res: NextResponse;
  userId: string | null;
  isOwner: boolean;
}> {
  let res = NextResponse.next({ request: req });

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) =>
          res.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The `is_owner` claim is injected by the custom_access_token_hook and lives
  // in the signed JWT, not on the user object. getUser() above already
  // revalidated the token against the auth server, so trusting the claim here
  // is sound — we read it from the (local) session access token rather than
  // making another round-trip. Falls back to false when the hook isn't enabled.
  let isOwner = false;
  if (user) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    isOwner = readIsOwnerClaim(session?.access_token);
  }

  return { res, userId: user?.id ?? null, isOwner };
}

/** Decode a JWT payload and read the boolean `is_owner` claim. No verification
 *  needed here — the caller has already revalidated the token via getUser(). */
function readIsOwnerClaim(accessToken?: string | null): boolean {
  if (!accessToken) return false;
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return false;
    const json = Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    return JSON.parse(json)?.is_owner === true;
  } catch {
    return false;
  }
}
