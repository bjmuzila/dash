import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { exchangeCodeForTokens, verifyGoogleIdToken } from "@/lib/auth/google";
import { getUserByGoogleSub, getUserByEmail, setUserGoogleSub, createUser } from "@/lib/db";
import { createSession, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_SEC, sessionCookieOptions } from "@/lib/auth/session";

/**
 * Google OAuth callback (replaces Supabase's exchangeCodeForSession). Same
 * public URL as before (`/auth/callback`, already whitelisted in
 * middleware.ts) so the Google Cloud Console redirect-URI config didn't need
 * to change -- only what happens once the code lands here.
 *
 * Account resolution: match by google_sub first, then by email (links Google
 * to an existing password account on first Google sign-in with the same
 * email), else create a new Google-only account (no password_hash).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Behind Cloudflare + the VPS proxy, req.url's host is the internal loopback
// (localhost:3002), so new URL(req.url).origin would redirect users to localhost
// after OAuth. Resolve the real public origin from forwarded headers / an
// explicit base URL first, mirroring the Stripe routes' publicOrigin().
function publicOrigin(req: NextRequest, fallback: string): string {
  // Local dev: trust the actual request host so OAuth returns to localhost:PORT
  // instead of the configured prod URL. There's no Cloudflare/proxy locally, so
  // host is the real origin and the configured-URL override would wrongly send
  // dev sign-ins to prod.
  if (process.env.NODE_ENV !== "production") {
    const devHost = req.headers.get("host");
    const devProto = req.headers.get("x-forwarded-proto") || "http";
    if (devHost) return `${devProto}://${devHost}`;
  }
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return fallback;
}

function clearOAuthCookies(res: NextResponse): void {
  res.cookies.set("g_oauth_state", "", { path: "/", maxAge: 0 });
  res.cookies.set("g_oauth_next", "", { path: "/", maxAge: 0 });
}

export async function GET(req: NextRequest) {
  const { searchParams, origin: urlOrigin } = new URL(req.url);
  const origin = publicOrigin(req, urlOrigin);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = req.cookies.get("g_oauth_state")?.value;
  const next = req.cookies.get("g_oauth_next")?.value || "/home";

  if (!code || !state || !expectedState || state !== expectedState) {
    const res = NextResponse.redirect(`${origin}/sign-in?error=auth`);
    clearOAuthCookies(res);
    return res;
  }

  try {
    const redirectUri = `${origin}/auth/callback`;
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const identity = await verifyGoogleIdToken(tokens.id_token);

    let user = await getUserByGoogleSub(identity.sub);
    if (!user) {
      const byEmail = await getUserByEmail(identity.email);
      if (byEmail) {
        await setUserGoogleSub(byEmail.id, identity.sub);
        user = { ...byEmail, google_sub: identity.sub };
      } else {
        user = await createUser({ id: randomUUID(), email: identity.email, google_sub: identity.sub });
      }
    }

    const { token } = await createSession(user.id, {
      userAgent: req.headers.get("user-agent"),
      ip: req.headers.get("x-forwarded-for") || null,
    });

    const res = NextResponse.redirect(`${origin}${next}`);
    clearOAuthCookies(res);
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_COOKIE_MAX_AGE_SEC));
    return res;
  } catch (err) {
    console.error("[auth/callback] Google sign-in failed:", err);
    const res = NextResponse.redirect(`${origin}/sign-in?error=auth`);
    clearOAuthCookies(res);
    return res;
  }
}
