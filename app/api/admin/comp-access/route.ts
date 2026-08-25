import { NextRequest, NextResponse } from "next/server";
import { randomUUID, randomBytes, createHash } from "crypto";
import { getServerUser } from "@/lib/supabase/server";
import {
  listCompAccess,
  grantCompAccess,
  revokeCompAccess,
  getCompAccess,
  getUserByEmail,
  createUser,
  insertPasswordReset,
} from "@/lib/db";
import { sendAuthEmail } from "@/lib/emails/send";
import { compInviteEmail, compInviteText, COMP_INVITE_SUBJECT } from "@/lib/emails/comp-invite";

/**
 * Owner-only CRUD for comped access — the "give this email what a paying
 * customer sees" switch behind the Admin page's Comped Access card.
 *
 * A grant writes one `comp_access` row; `getSessionWithUser()` ORs a live row
 * into `is_paid`, which is the single flag middleware.ts gates every paid route
 * on. It deliberately does NOT touch `users.is_owner`, so a comped account
 * still gets bounced from /owner/*, /social-media, /home3, /v3 and every
 * ownerApiGate endpoint.
 *
 * SINCE 2026-08 — the grant also PROVISIONS THE ACCOUNT.
 * The old behavior was that a comp for an unknown email sat there "pending"
 * until that person went and signed up. Two things went wrong with that: they
 * had to be told to go sign up (and spell the email exactly the way it was
 * comped), and until they did, nothing in the system said they existed. Now:
 *
 *   1. Grant creates the `users` row immediately, with password_hash = NULL.
 *   2. Unless the caller opts out (`sendInvite: false`), it mails them a
 *      tokenized /auth/reset-password link — the SAME one-shot token machinery
 *      forgot-password uses, just with a 7-day TTL instead of 1 hour.
 *   3. They set a password and land in a full paid-tier account. No sign-up
 *      step, no Stripe, nothing for them to get wrong.
 *
 * A passwordless row can't be signed into (login verifies against a NULL hash
 * and fails generically), and "Forgot password?" on the sign-in page reaches
 * the same place if the invite link expires — so a bounced invite is never a
 * dead end.
 *
 * GET    -> { rows: CompAccessRow[] }              live comps
 * POST   { email, note?, expiresAt?, sendInvite? } grant or re-grant (+provision)
 * PUT    { email }                                 re-send the set-password mail
 * DELETE ?email=...                                revoke
 *
 * Revoking does NOT delete the account row — it only stamps comp_access, so the
 * login keeps working and simply stops seeing paid routes. Deleting a user is a
 * separate, deliberate thing this endpoint has never done.
 *
 * SECURITY: fails CLOSED — unset/mismatched OWNER_USER_ID → 403. Same posture
 * as the sibling /api/admin/* routes. This endpoint can hand out paid access,
 * so it is NOT wired to the INTERNAL_API_TOKEN bypass that the scheduler-facing
 * routes use (lib/auth/ownerApiGate): there is no automated caller for it.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 7 days, not forgot-password's 1 hour: an invite is a thing the recipient
// wasn't waiting for, so it has to survive a weekend and an unread inbox.
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
 * Mint a set-password token for an existing user and mail it.
 * Returns the send outcome rather than throwing: a comp that was granted but
 * whose mail bounced is still a valid comp, and the panel says so — it must not
 * read back as "the grant failed".
 */
async function sendInviteMail(
  req: NextRequest,
  user: { id: string; email: string },
  compExpiresAt: string | null,
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const token = randomBytes(32).toString("base64url");
    await insertPasswordReset({
      token_hash: hashToken(token),
      user_id: user.id,
      expires_at: new Date(Date.now() + INVITE_TTL_MS),
    });

    const setPasswordUrl = `${publicOrigin(req)}/auth/reset-password?token=${token}`;
    const expiresInDays = INVITE_TTL_MS / (24 * 60 * 60_000);

    // sendAuthEmail, NOT sendTransactional — this carries a tokenized
    // credential link. See lib/emails/send.ts for why the unsubscribe footer,
    // the List-Unsubscribe headers and UTM rewriting all have to stay off it.
    const res = await sendAuthEmail({
      to: user.email,
      subject: COMP_INVITE_SUBJECT,
      html: compInviteEmail({ setPasswordUrl, expiresInDays, compExpiresAt }),
      text: compInviteText({ setPasswordUrl, expiresInDays, compExpiresAt }),
    });
    return res.ok ? { sent: true } : { sent: false, reason: res.reason || "send failed" };
  } catch (err) {
    console.error("[admin/comp-access] invite mail failed:", err);
    return { sent: false, reason: String(err) };
  }
}

export async function GET() {
  const gate = await requireOwner();
  if (gate instanceof NextResponse) return gate;
  try {
    const rows = await listCompAccess();
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
    // Default ON: the point of provisioning up front is that the person gets a
    // link instead of instructions. Opt out per-grant from the panel.
    const wantsInvite = body?.sendInvite !== false;

    // expiresAt arrives as a plain YYYY-MM-DD from the date input. Anchor it to
    // the END of that day in ET rather than midnight UTC — otherwise picking
    // "today" would expire the comp at 8pm the previous evening, which reads as
    // "I granted it and it never worked". Empty/absent = never expires.
    //
    // The offset is hardcoded to EST (-05:00) rather than resolved per-date, so
    // a summer expiry runs one extra hour. That is the deliberate direction to
    // be wrong in: a comp that lasts an hour too long is invisible; one that
    // ends an hour early is a customer locked out of what they were promised.
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

    // The comp row first: if provisioning below fails for any reason, the grant
    // itself still stands and the old wait-for-signup path still works.
    await grantCompAccess(email, { note, expiresAt, grantedBy: gate.email });

    // Provision the account. An existing row (a real customer, or a re-grant)
    // is left exactly as it is — never touch someone's password by re-comping.
    let user = await getUserByEmail(email);
    let created = false;
    if (!user) {
      try {
        user = await createUser({ id: randomUUID(), email, password_hash: null });
        created = true;
      } catch (err) {
        // Almost certainly a race on the unique email index — re-read rather
        // than fail the grant.
        console.warn("[admin/comp-access] createUser failed, re-reading:", err);
        user = await getUserByEmail(email);
      }
    }

    // Only mail an account that has no password yet. Re-comping a paying
    // customer must never send them a "set your password" link out of nowhere.
    let invite: { sent: boolean; reason?: string } | null = null;
    if (wantsInvite && user && !user.password_hash) {
      invite = await sendInviteMail(req, user, expiresAt);
    }

    const row = await getCompAccess(email);
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

    const comp = await getCompAccess(email);
    if (!comp) {
      return NextResponse.json({ error: "No live comp for that email" }, { status: 404 });
    }

    let user = await getUserByEmail(email);
    if (!user) {
      // A comp granted before this route provisioned accounts. Provision now.
      user = await createUser({ id: randomUUID(), email, password_hash: null });
    }
    if (user.password_hash) {
      return NextResponse.json(
        { error: "That account already has a password — point them at “Forgot password?” instead." },
        { status: 400 },
      );
    }

    const invite = await sendInviteMail(req, user, comp.expires_at);
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
    const { revoked } = await revokeCompAccess(email);
    return NextResponse.json({ ok: true, revoked, email });
  } catch (err) {
    return NextResponse.json({ error: "Revoke failed", detail: String(err) }, { status: 500 });
  }
}
