import { NextResponse, type NextRequest } from "next/server";

/**
 * RETIRED — this was the Google OAuth callback. Google sign-in was removed on
 * 2026-08-20; the app is email/password only.
 *
 * Kept as a stub (and still whitelisted in middleware.ts) so anything that
 * still hits /auth/callback — a stale consent screen left open, a cached
 * bundle, an old link — bounces to /sign-in rather than 404ing. Any leftover
 * OAuth cookies are cleared on the way through.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { origin } = new URL(req.url);
  const res = NextResponse.redirect(`${origin}/sign-in`);
  res.cookies.set("g_oauth_state", "", { path: "/", maxAge: 0 });
  res.cookies.set("g_oauth_next", "", { path: "/", maxAge: 0 });
  return res;
}
