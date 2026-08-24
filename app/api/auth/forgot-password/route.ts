import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { getUserByEmail, insertPasswordReset } from "@/lib/db";
import { sendAuthEmail } from "@/lib/emails/send";
import { resetPasswordEmail, resetPasswordText, RESET_PASSWORD_SUBJECT } from "@/lib/emails/reset-password";
import { rateLimit, clientIp } from "@/lib/rateLimit";

// Replaces Supabase's auth.resetPasswordForEmail(). Always returns a generic
// { ok: true } regardless of whether the email exists (no account enumeration)
// -- the UI (UserMenu.tsx) just shows "reset email sent" either way, same as
// the old Supabase-backed behavior.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE = { windowMs: 60 * 60_000, max: 5, blockMs: 60 * 60_000 };
const RESET_TTL_MS = 60 * 60_000; // 1 hour

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Same pattern as auth/callback: behind Cloudflare + the in-container proxy,
// req.url resolves to an internal loopback (or, under this custom server
// locally, some other default port), not the actual requested host -- so the
// forwarded/host header must be checked BEFORE falling back to req.url. Local
// dev has no Cloudflare/TLS in front of it, so trust the raw request host with
// an http fallback there instead of assuming https.
function publicOrigin(req: NextRequest): string {
  if (process.env.NODE_ENV !== "production") {
    const devHost = req.headers.get("host");
    const devProto = req.headers.get("x-forwarded-proto") || "http";
    if (devHost) return `${devProto}://${devHost}`;
  }
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`forgot-password:${ip}`, RATE);
  if (!rl.allowed) {
    return NextResponse.json({ ok: true }); // still generic — don't leak throttling either
  }

  let email = "";
  try {
    const body = await req.json();
    email = String(body?.email || "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });

  try {
    const user = await getUserByEmail(email);
    if (user) {
      const token = randomBytes(32).toString("base64url");
      await insertPasswordReset({
        token_hash: hashToken(token),
        user_id: user.id,
        expires_at: new Date(Date.now() + RESET_TTL_MS),
      });

      const resetUrl = `${publicOrigin(req)}/auth/reset-password?token=${token}`;
      const expiresInMinutes = RESET_TTL_MS / 60_000;

      // sendAuthEmail, NOT sendTransactional: a reset must not carry the
      // marketing unsubscribe footer, the List-Unsubscribe (bulk) headers, or
      // UTM params welded onto the tokenized link. All three push it to spam.
      await sendAuthEmail({
        to: user.email,
        subject: RESET_PASSWORD_SUBJECT,
        html: resetPasswordEmail({ resetUrl, expiresInMinutes }),
        text: resetPasswordText({ resetUrl, expiresInMinutes }),
      });
    }
  } catch (err) {
    console.error("[auth/forgot-password] failed:", err);
    // Fall through to the generic response regardless — never reveal failure detail.
  }

  return NextResponse.json({ ok: true });
}
