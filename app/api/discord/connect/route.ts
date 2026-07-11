import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/supabase/server";
import { buildAuthorizeUrl, discordConfigured } from "@/lib/discord";

// GET /api/discord/connect -> redirects to Discord's OAuth consent screen.
// Paid-gated: signed-out or free users are bounced back to /home rather than
// erroring, since this is only ever reached via the UserMenu button, which is
// itself paid-gated (belt & suspenders against a stale client / direct hit).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Same publicOrigin() pattern as auth/google/start — see that file's comment.
function publicOrigin(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  if (!session.isPaid) return NextResponse.redirect(new URL("/home", req.url));
  if (!discordConfigured()) {
    return NextResponse.json({ error: "Discord is not configured" }, { status: 500 });
  }

  const origin = publicOrigin(req);
  const redirectUri = `${origin}/api/discord/callback`;
  const state = randomBytes(16).toString("base64url");

  const res = NextResponse.redirect(buildAuthorizeUrl(redirectUri, state));
  res.cookies.set("discord_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
