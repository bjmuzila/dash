import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getUserByEmail, createUser } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_SEC, sessionCookieOptions } from "@/lib/auth/session";
import { verifyTurnstile } from "@/lib/turnstile";
import { rateLimit, clientIp } from "@/lib/rateLimit";

// Enforced email/password sign-up against our own users table (replaces
// Supabase's signUp). Same Turnstile + throttle protections as before.
// No email-confirmation gate: the account and session are created immediately,
// matching the prior (confirmation-off) Supabase project config.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Signups are rarer than logins — throttle harder: 5 / hour per IP.
const RATE = { windowMs: 60 * 60_000, max: 5, blockMs: 60 * 60_000 };

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);

  const rl = rateLimit(`signup:${ip}`, RATE);
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
    email = String(body?.email || "").trim().toLowerCase();
    password = String(body?.password || "");
    turnstileToken = body?.turnstileToken ?? null;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const captcha = await verifyTurnstile(turnstileToken, ip);
  if (!captcha.ok) {
    return NextResponse.json(
      { error: "Captcha verification failed. Please retry." },
      { status: 400 },
    );
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    // A row with no password_hash can neither sign in (nothing to type) nor
    // sign up (this branch), so it would be a dead end. Two ways to get one:
    //   · the retired Google sign-in, which never set a password;
    //   · a comped account the owner provisioned from the Admin page
    //     (app/api/admin/comp-access), which mails a set-password link.
    // The same reset flow fixes both — it sets a password on the row that
    // already exists. google_sub only picks which explanation they get.
    if (!existing.password_hash) {
      return NextResponse.json(
        {
          error: existing.google_sub
            ? "That email was registered with Google sign-in, which has been retired. Use “Forgot password?” on the sign-in page to set a password for it."
            : "An account already exists for that email. Use “Forgot password?” on the sign-in page to set your password — that's all that's left to do.",
        },
        { status: 400 },
      );
    }
    // Same generic-error stance as login: don't confirm/deny account existence
    // beyond what's necessary for a usable error message.
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({ id: randomUUID(), email, password_hash: passwordHash });

  const { token } = await createSession(user.id, {
    userAgent: req.headers.get("user-agent"),
    ip,
  });

  const res = NextResponse.json({ ok: true, session: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_COOKIE_MAX_AGE_SEC));
  return res;
}
