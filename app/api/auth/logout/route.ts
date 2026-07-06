import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, destroySessionByToken } from "@/lib/auth/session";

// Replaces the client's direct supabase.auth.signOut() call (AuthProvider no
// longer holds a Supabase client). Destroys the DB session row and clears the
// cookie; the client hard-navigates afterward same as before.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await destroySessionByToken(token);
    } catch (err) {
      console.warn("[auth/logout] session delete failed (clearing cookie anyway):", err);
    }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
