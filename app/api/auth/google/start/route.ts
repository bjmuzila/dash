import { NextResponse, type NextRequest } from "next/server";

/**
 * RETIRED — Google sign-in was removed on 2026-08-20 (email/password only).
 *
 * Kept as a stub so any stale bookmark, cached bundle, or old email link that
 * still points at /api/auth/google/start lands on the sign-in page instead of
 * a 404 or a Google `redirect_uri_mismatch` error screen.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { origin } = new URL(req.url);
  return NextResponse.redirect(`${origin}/sign-in`);
}
