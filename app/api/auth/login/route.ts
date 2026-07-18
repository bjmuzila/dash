import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, updateUserPasswordHash } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_SEC, sessionCookieOptions } from "@/lib/auth/session";
import { verifyTurnstile } from "@/lib/turnstile";
import { rateLimit, rateLimitReset, clientIp } from "@/lib/rateLimit";

// Enforced email/password sign-in against our own users table (replaces
// Supabase's signInWithPassword). Same Turnstile + per-IP throttle protections
// as before -- those never depended on Supabase and are unchanged.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 10 attempts / 15 min per IP, then a 15 min block. Tuned to blunt automated
// credential-stuffing without penalizing a human who mistypes a few times.
const RATE = { windowMs: 15 * 60_000, max: 10, blockMs: 15 * 60_000 };

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);

  const rl = rateLimit(`login:${ip}`, RATE);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }

  let email = "";
  let password = "";
  let turnstileToken: string | null = null;
  try {
    const body = await req.json();
    email = String(body?.email || "").trim();
    password = String(body?.password || "");
    turnstileToken = body?.turnstileToken ?? null;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const captcha = await verifyTurnstile(turnstileToken, ip);
  if (!captcha.ok) {
    return NextResponse.json(
      { error: "Captcha verification failed. Please retry." },
      { status: 400 },
    );
  }

  const user = await getUserByEmail(email);
  const check = await verifyPassword(password, user?.password_hash ?? null);
  if (!user || !check.ok) {
    // Generic message — never reveal whether the email exists (no enumeration).
    return NextResponse.json({ error: "Invalid login credentials." }, { status: 401 });
  }

  // Transparent upgrade: a legacy (migrated) bcrypt hash that just verified
  // gets re-hashed with scrypt so it's never checked against bcrypt again.
  if (check.needsRehash) {
    try {
      const upgraded = await hashPassword(password);
      await updateUserPasswordHash(user.id, upgraded);
    } catch (err) {
      console.warn("[auth/login] password rehash failed (non-fatal):", err);
    }
  }

  const { token } = await createSession(user.id, {
    userAgent: req.headers.get("user-agent"),
    ip,
  });

  // Successful login clears the honest user's throttle counter.
  rateLimitReset(`login:${ip}`);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_COOKIE_MAX_AGE_SEC));
  return res;
}
