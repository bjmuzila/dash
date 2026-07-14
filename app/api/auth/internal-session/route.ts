import { NextRequest, NextResponse } from "next/server";
import { createSession, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_SEC } from "@/lib/auth/session";

// Mints a short-lived owner session for INTERNAL automation only (the morning
// budget-email screenshotter). Gated by the shared INTERNAL_API_TOKEN — never
// reachable by end users. The caller sets the returned token as the
// `cbe_session` cookie in a headless browser so it can view owner-gated pages
// (e.g. /owner/budget) exactly as the owner would.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INTERNAL_API_TOKEN = (process.env.INTERNAL_API_TOKEN || "").trim();
const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();

export async function POST(req: NextRequest) {
  const token = (req.headers.get("x-internal-token") || "").trim();
  if (!INTERNAL_API_TOKEN || token !== INTERNAL_API_TOKEN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!OWNER_USER_ID) {
    return NextResponse.json({ error: "OWNER_USER_ID not set" }, { status: 500 });
  }
  const { token: session, expiresAt } = await createSession(OWNER_USER_ID, {
    userAgent: "internal-budget-email",
    ip: null,
  });
  return NextResponse.json({
    ok: true,
    cookieName: SESSION_COOKIE,
    token: session,
    maxAge: SESSION_COOKIE_MAX_AGE_SEC,
    expiresAt,
  });
}
