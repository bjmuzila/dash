import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";
import { rateLimit, clientIp } from "@/lib/rateLimit";

// Enforced email/password sign-up. Same Turnstile + throttle protections as the
// login route. If email confirmation is ON in Supabase, no session is returned
// and the client shows a "check your email" notice.
export const dynamic = "force-dynamic";

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
  let emailRedirectTo: string | undefined;
  try {
    const body = await req.json();
    email = String(body?.email || "").trim();
    password = String(body?.password || "");
    turnstileToken = body?.turnstileToken ?? null;
    emailRedirectTo = body?.emailRedirectTo ? String(body.emailRedirectTo) : undefined;
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

  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // session present → confirmation is OFF, user is signed in; else check email.
  return NextResponse.json({ ok: true, session: !!data.session });
}
