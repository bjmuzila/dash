import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { getServerUser } from "@/lib/supabase/server";
import {
  getUserByEmail,
  insertPasswordReset,
  updateUserPasswordHash,
  deleteAllSessionsForUser,
} from "@/lib/db";
import { sendAuthEmail } from "@/lib/emails/send";
import {
  resetPasswordEmail,
  resetPasswordText,
  RESET_PASSWORD_SUBJECT,
} from "@/lib/emails/reset-password";

/**
 * Owner-only "force a password reset" — the button on each row of the Sales
 * page's Active Subscriptions table.
 *
 * WHY THIS EXISTS: Google sign-in was retired on 2026-08-20 (see
 * app/api/auth/google/start/route.ts). An account that only ever signed in
 * through Google has `password_hash = NULL`, so login fails generically and the
 * customer is locked out of something they are still paying for. This is the
 * one-click fix: clear whatever credential is there, kill their sessions, and
 * mail them a link to set a real password.
 *
 * It is deliberately BLUNTER than /api/auth/forgot-password:
 *
 *   1. password_hash -> NULL. Their old password (if any) stops working
 *      immediately. That is the point when the reason is a compromised account
 *      rather than a forgotten password.
 *   2. Every session row is deleted, so a live cookie somewhere can't outlive
 *      the reset.
 *   3. The link lives 7 DAYS, not forgot-password's 1 hour. Step 1 locks them
 *      out, so the link has to survive a weekend and an unread inbox — the same
 *      reasoning as the comp invite in /api/admin/comp-access.
 *
 * A bounced mail is never a dead end: a NULL hash still satisfies
 * forgot-password (it only needs the users row), so "Forgot password?" on the
 * sign-in page reaches the same place.
 *
 * Unlike forgot-password this DOES report whether the email exists — the caller
 * is the owner looking at their own customer list, so there is nothing to
 * enumerate, and "no account for that email" is the useful answer.
 *
 * POST { email } -> { ok: true, emailSent, hadPassword }
 *
 * SECURITY: fails CLOSED — unset/mismatched OWNER_USER_ID → 403. Same posture
 * as the sibling /api/admin/* routes, and deliberately NOT wired to the
 * INTERNAL_API_TOKEN bypass: nothing automated should ever be able to blank a
 * customer's password.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RESET_TTL_MS = 7 * 24 * 60 * 60_000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Same reasoning as app/api/admin/comp-access: behind Cloudflare + the
// in-container proxy, req.url resolves to an internal loopback, not the host
// that was actually requested — so the forwarded/host header must win.
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
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!OWNER_USER_ID || user.id !== OWNER_USER_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    const target = await getUserByEmail(email);
    if (!target) {
      return NextResponse.json(
        { error: `No CB Edge account for ${email}. Check the Stripe email matches the sign-up email.` },
        { status: 404 },
      );
    }

    const hadPassword = Boolean(target.password_hash);

    // Order matters. Blank the credential and drop the sessions FIRST: if the
    // mail send throws below, the account is still in the safe state and the
    // owner can just click again (or the customer uses "Forgot password?").
    // Doing it the other way round would mail a live link for an account whose
    // old password still works.
    await updateUserPasswordHash(target.id, null);
    await deleteAllSessionsForUser(target.id);

    const token = randomBytes(32).toString("base64url");
    await insertPasswordReset({
      token_hash: hashToken(token),
      user_id: target.id,
      expires_at: new Date(Date.now() + RESET_TTL_MS),
    });

    const resetUrl = `${publicOrigin(req)}/auth/reset-password?token=${token}`;

    // sendAuthEmail, NOT sendTransactional — this carries a tokenized
    // credential link. See lib/emails/send.ts for why the unsubscribe footer,
    // the List-Unsubscribe headers and UTM rewriting all have to stay off it.
    let emailSent = false;
    let emailError: string | undefined;
    try {
      const res = await sendAuthEmail({
        to: target.email,
        subject: RESET_PASSWORD_SUBJECT,
        html: resetPasswordEmail({ resetUrl, expiresLabel: "7 days", adminInitiated: true }),
        text: resetPasswordText({ resetUrl, expiresLabel: "7 days", adminInitiated: true }),
      });
      emailSent = res.ok;
      if (!res.ok) emailError = res.reason || "send failed";
    } catch (err) {
      console.error("[admin/force-password-reset] mail failed:", err);
      emailError = String(err);
    }

    return NextResponse.json({ ok: true, email, hadPassword, emailSent, emailError });
  } catch (err) {
    console.error("[admin/force-password-reset] failed:", err);
    return NextResponse.json({ error: "Reset failed", detail: String(err) }, { status: 500 });
  }
}
