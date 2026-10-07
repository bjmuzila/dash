import { NextRequest, NextResponse } from "next/server";
import { randomUUID, randomBytes, createHash } from "crypto";
import { getServerUser } from "@/lib/supabase/server";
import {
  listVelaBetaAccess,
  grantVelaBetaAccess,
  revokeVelaBetaAccess,
  getVelaBetaAccess,
  getUserByEmail,
  createUser,
  insertPasswordReset,
} from "@/lib/db";
import { sendAuthEmail } from "@/lib/emails/send";
import {
  velaInviteEmail,
  velaInviteText,
  VELA_INVITE_SUBJECT,
} from "@/lib/emails/vela-invite";

/**
 * Owner-only CRUD for Vela BETA TESTERS -- "let this email into
 * vela.cbedge.net, and nowhere else". Behind the owner Admin page's Vela Beta
 * Testers card.
 *
 * A DELIBERATE TWIN of app/api/admin/voltick-access (itself a twin of
 * comp-access). Same request shapes, same provisioning, same invite machinery,
 * same fail-closed posture. Read that file first; the differences are here:
 *
 *   - It writes `vela_beta_access`, which is NOT part of is_paid. A beta
 *     tester is an ordinary unpaid account on cbedge.net. Two places read the
 *     table: /api/vela/verify (the nginx door) and server-v2/ws-auth.js, which
 *     lets Vela's /api /proxy /ws data through ONLY when the request's Host is
 *     vela.cbedge.net.
 *   - It does not open voltick.cbedge.net, and does not touch is_owner.
 *   - The invite's set-password link carries ?next=https://vela.cbedge.net/
 *     so the tester ends up on Vela, not on a cbedge.net paywall.
 *
 * GET    -> { rows }                                live grants
 * POST   { email, note?, expiresAt?, sendInvite? } grant or re-grant (+provision)
 * PUT    { email }                                 re-send the set-password mail
 * DELETE ?email=...                                revoke
 *
 * Revoking stamps `revoked_at`; it never deletes the account. The door closes
 * on their next session-cache miss (~8s); an open socket is dropped by the
 * once-a-minute sweep in websocket-server.js.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VELA_URL = "https://vela.cbedge.net/";

// 7 days, matching comp-access: an invite is a thing the recipient was not
// waiting for, so it has to survive a weekend and an unread inbox.
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

async function requireOwner(): Promise<{ id: string; email: string } | NextResponse> {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!OWNER_USER_ID || user.id !== OWNER_USER_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return user;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Same reasoning as app/api/auth/forgot-password: behind Cloudflare + the
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

/**
 * Mail the recipient. Two shapes, and the difference matters:
 *
 *   - No password yet  → mint a 7-day set-password token and send the link.
 *   - Password already → send a plain "Vela is open to you" note with NO
 *     token. Never mail an unsolicited credential link to an account that has a
 *     working password; that is a phish-shaped email and it trains people badly.
 *
 * Returns the outcome rather than throwing: a grant whose mail bounced is still
 * a valid grant, and the panel says so. It must not read back as a failed grant.
 */
async function sendInviteMail(
  req: NextRequest,
  user: { id: string; email: string; password_hash?: string | null },
  accessExpiresAt: string | null,
): Promise<{ sent: boolean; reason?: string }> {
  try {
    let setPasswordUrl: string | null = null;
    if (!user.password_hash) {
      const token = randomBytes(32).toString("base64url");
      await insertPasswordReset({
        token_hash: hashToken(token),
        user_id: user.id,
        expires_at: new Date(Date.now() + INVITE_TTL_MS),
      });
      setPasswordUrl = `${publicOrigin(req)}/auth/reset-password?token=${token}&next=${encodeURIComponent(VELA_URL)}`;
    }

    const expiresInDays = INVITE_TTL_MS / (24 * 60 * 60_000);

    // sendAuthEmail, NOT sendTransactional — see lib/emails/send.ts.
    const res = await sendAuthEmail({
      to: user.email,
      subject: VELA_INVITE_SUBJECT,
      html: velaInviteEmail({ setPasswordUrl, expiresInDays, accessExpiresAt }),
      text: velaInviteText({ setPasswordUrl, expiresInDays, accessExpiresAt }),
    });
    return res.ok ? { sent: true } : { sent: false, reason: res.reason || "send failed" };
  } catch (err) {
    console.error("[admin/vela-beta] invite mail failed:", err);
    return { sent: false, reason: String(err) };
  }
}

export async function GET() {
  const gate = await requireOwner();
  if (gate instanceof NextResponse) return gate;
  try {
    const rows = await listVelaBetaAccess();
    return NextResponse.json({ ok: true, count: rows.length, rows });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireOwner();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    const note = String(body?.note ?? "").trim().slice(0, 200) || null;
    const wantsInvite = body?.sendInvite !== false;

    // expiresAt arrives as a plain YYYY-MM-DD from the date input, anchored to
    // the END of that day in ET. Identical reasoning to comp-access: a grant
    // that lasts an hour too long is invisible, one that ends an hour early is
    // someone locked out of what they were promised. Empty = never expires.
    const rawExpiry = String(body?.expiresAt ?? "").trim();
    let expiresAt: string | null = null;
    if (rawExpiry) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawExpiry)) {
        return NextResponse.json({ error: "expiresAt must be YYYY-MM-DD" }, { status: 400 });
      }
      const end = new Date(`${rawExpiry}T23:59:59-05:00`);
      if (Number.isNaN(end.getTime())) {
        return NextResponse.json({ error: "expiresAt is not a real date" }, { status: 400 });
      }
      expiresAt = end.toISOString();
    }

    // The grant row first: if provisioning below fails, the grant still stands
    // and an account they already have still opens Vela.
    await grantVelaBetaAccess(email, { note, expiresAt, grantedBy: gate.email });

    let user = await getUserByEmail(email);
    let created = false;
    if (!user) {
      try {
        user = await createUser({ id: randomUUID(), email, password_hash: null });
        created = true;
      } catch (err) {
        // Almost certainly a race on the unique email index — re-read rather
        // than fail the grant.
        console.warn("[admin/vela-beta] createUser failed, re-reading:", err);
        user = await getUserByEmail(email);
      }
    }

    let invite: { sent: boolean; reason?: string } | null = null;
    if (wantsInvite && user) invite = await sendInviteMail(req, user, expiresAt);

    const row = await getVelaBetaAccess(email);
    return NextResponse.json({
      ok: true,
      row,
      accountCreated: created,
      inviteSent: invite?.sent ?? false,
      inviteError: invite && !invite.sent ? invite.reason : undefined,
    });
  } catch (err) {
    return NextResponse.json({ error: "Grant failed", detail: String(err) }, { status: 500 });
  }
}

/** Re-send the set-password mail for an already-granted email. */
export async function PUT(req: NextRequest) {
  const gate = await requireOwner();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    const grant = await getVelaBetaAccess(email);
    if (!grant) {
      return NextResponse.json({ error: "No live grant for that email" }, { status: 404 });
    }

    let user = await getUserByEmail(email);
    if (!user) user = await createUser({ id: randomUUID(), email, password_hash: null });
    if (user.password_hash) {
      return NextResponse.json(
        { error: "That account already has a password — point them at “Forgot password?” instead." },
        { status: 400 },
      );
    }

    const invite = await sendInviteMail(req, user, grant.expires_at);
    if (!invite.sent) {
      return NextResponse.json({ error: "Invite mail failed", detail: invite.reason }, { status: 502 });
    }
    return NextResponse.json({ ok: true, inviteSent: true });
  } catch (err) {
    return NextResponse.json({ error: "Resend failed", detail: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireOwner();
  if (gate instanceof NextResponse) return gate;
  try {
    const email = (new URL(req.url).searchParams.get("email") || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "email query param required" }, { status: 400 });
    const { revoked } = await revokeVelaBetaAccess(email);
    return NextResponse.json({ ok: true, revoked, email });
  } catch (err) {
    return NextResponse.json({ error: "Revoke failed", detail: String(err) }, { status: 500 });
  }
}
