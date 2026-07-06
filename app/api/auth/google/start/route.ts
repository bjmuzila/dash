import { NextRequest, NextResponse } from "next/server";
import { buildGoogleAuthUrl, newOAuthState, googleConfigured } from "@/lib/auth/google";

// GET /api/auth/google/start?next=/home -> redirects to Google's consent
// screen. Replaces the client's supabase.auth.signInWithOAuth({provider:
// "google"}) call. The anti-CSRF `state` is stored in a short-lived httpOnly
// cookie and checked again in /auth/callback.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// See stripe/checkout, stripe/portal, auth/callback — same publicOrigin()
// pattern (behind Cloudflare + the in-container proxy, req.url resolves to the
// internal loopback, not the public domain).
function publicOrigin(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

export async function GET(req: NextRequest) {
  if (!googleConfigured()) {
    return NextResponse.json({ error: "Google sign-in is not configured" }, { status: 500 });
  }
  const next = req.nextUrl.searchParams.get("next") || "/home";
  const origin = publicOrigin(req);
  const redirectUri = `${origin}/auth/callback`;
  const state = newOAuthState();

  const res = NextResponse.redirect(buildGoogleAuthUrl(state, redirectUri));
  res.cookies.set("g_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min — just long enough for the round trip to Google and back
  });
  res.cookies.set("g_oauth_next", next, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
