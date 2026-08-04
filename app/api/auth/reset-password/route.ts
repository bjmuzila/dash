import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { consumePasswordReset, updateUserPasswordHash, deleteAllSessionsForUser } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { clearSessionCookie } from "@/lib/auth/session";

// Consumes a /api/auth/forgot-password token and sets a new password. Signs
// the user out everywhere (deleteAllSessionsForUser) so a leaked old session
// can't survive a password reset -- the caller's own browser included, so the
// client redirects to /sign-in afterward rather than assuming they're still
// logged in.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(req: NextRequest) {
  let token = "";
  let password = "";
  try {
    const body = await req.json();
    token = String(body?.token || "");
    password = String(body?.password || "");
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!token || !password) {
    return NextResponse.json({ error: "Token and new password are required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const consumed = await consumePasswordReset(hashToken(token));
  if (!consumed) {
    return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  await updateUserPasswordHash(consumed.user_id, passwordHash);
  await deleteAllSessionsForUser(consumed.user_id);

  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
