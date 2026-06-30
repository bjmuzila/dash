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

  return { res, userId: user?.id ?? null };
}
