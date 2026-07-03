import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";
import { rateLimit, rateLimitReset, clientIp } from "@/lib/rateLimit";

// Enforced email/password sign-in. Replaces the client-side signInWithPassword
// so brute-force protections (Turnstile + per-IP throttle) actually run on the
// server and can't be bypassed by scripting Supabase directly.
//
// Flow: verify Turnstile → per-IP rate limit → signInWithPassword server-side
// (sets the auth cookies on the response) → 200. The browser then hard-reloads
// to /home so middleware + browser client hydrate the new session from cookies.
export const dynamic = "force-dynamic";

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

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Generic message — never reveal whether the email exists (no enumeration).
    return NextResponse.json({ error: "Invalid login credentials." }, { status: 401 });
  }

  // Successful login clears the honest user's throttle counter.
  rateLimitReset(`login:${ip}`);
  return NextResponse.json({ ok: true });
}
