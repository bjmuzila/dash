import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/supabase/server";
import {
  listTrialBans,
  addTrialBan,
  liftTrialBan,
  getTrialBanById,
  getTrialHistoryReuses,
  getTrialIpClusters,
  type TrialBanKind,
} from "@/lib/db";
import { sendTrialBanNotice } from "@/lib/trialBanNotice";

/**
 * Owner-only CRUD for TRIAL BANS — the "this email / this IP does not get the
 * free trial any more" switch behind the Sales page's Trial Abuse card.
 *
 * WHAT A BAN DOES: app/api/stripe/checkout asks lib/trialEligibility before it
 * creates the Checkout session, and a live ban means `trial_period_days` is
 * simply never sent. lib/trialGuard re-checks it in the webhook, so a trial that
 * arrived from the Stripe dashboard or the API gets ended too.
 *
 * WHAT IT DOES NOT DO: it does not block sign-up, sign-in, or purchase. A banned
 * address can still subscribe — they just pay from day one. Locking someone out
 * of buying to punish trial farming costs money to make a point, and the two
 * automatic axes (one trial per email, one per card) already handle the
 * ordinary cases without an owner deciding anything.
 *
 * GET    -> { bans, reuses, ipClusters }
 * POST   { kind, value, reason?, notify?, notifyEmail?, includeReason? }
 *                                       ban an email or IP (optionally mail them)
 * PUT    { id, email?, includeReason? } send / re-send the notice for a ban
 * DELETE ?id=...                        lift the ban (stamped, not deleted)
 *
 * SECURITY: fails CLOSED — unset/mismatched OWNER_USER_ID → 403. Same posture as
 * the sibling /api/admin/* routes, and deliberately NOT wired to the
 * INTERNAL_API_TOKEN bypass: nothing automated should be issuing bans.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Deliberately loose: IPv4, IPv6, and the ::ffff: mapped forms Cloudflare can
// send. A stricter regex would reject a real address the owner is looking at in
// the panel, which is worse than accepting a typo they can lift in one click.
const IP_RE = /^[0-9a-fA-F:.]{3,45}$/;

async function requireOwner(): Promise<{ id: string; email: string } | NextResponse> {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!OWNER_USER_ID || user.id !== OWNER_USER_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return user;
}

export async function GET() {
  const gate = await requireOwner();
  if (gate instanceof NextResponse) return gate;
  try {
    // Three independent reads, in parallel — the panel renders all three
    // sections at once and a serial chain would show it stitching itself
    // together. Each is small (bans and clusters are capped in the query,
    // reuses at 200).
    const [bans, reuses, ipClusters] = await Promise.all([
      listTrialBans(),
      getTrialHistoryReuses(200),
      getTrialIpClusters(2, 100),
    ]);
    return NextResponse.json({ ok: true, bans, reuses, ipClusters });
  } catch (err) {
    return NextResponse.json({ error: "Load failed", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireOwner();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind ?? "").trim().toLowerCase() as TrialBanKind;
    const value = String(body?.value ?? "").trim();

    if (kind !== "email" && kind !== "ip") {
      return NextResponse.json({ error: "kind must be 'email' or 'ip'" }, { status: 400 });
    }
    if (kind === "email" && !EMAIL_RE.test(value)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }
    if (kind === "ip" && !IP_RE.test(value)) {
      return NextResponse.json({ error: "That doesn't look like an IP address" }, { status: 400 });
    }

    const reason = String(body?.reason ?? "").trim().slice(0, 300) || null;
    const ban = await addTrialBan({ kind, value, reason, createdBy: gate.email });
    if (!ban) return NextResponse.json({ error: "Ban failed" }, { status: 500 });

    // Mailing is OPT-IN on the ban call. An IP ban has no obvious recipient, and
    // even on an email ban the owner may want to add the address quietly and
    // send the notice after they've looked at the account. `notifyEmail` lets an
    // IP ban still mail a specific person.
    let notice: { sent: boolean; reason?: string } | null = null;
    if (body?.notify) {
      const to = String(body?.notifyEmail ?? (kind === "email" ? value : "")).trim();
      if (!EMAIL_RE.test(to)) {
        return NextResponse.json({
          ok: true,
          ban,
          noticeSent: false,
          noticeError: "No recipient — an IP ban needs notifyEmail to mail anyone.",
        });
      }
      // The reason is an INTERNAL note by default. It only reaches the customer
      // when the owner ticks the box, because "serial abuser, 6 addresses" is
      // not a sentence to forward to them.
      notice = await sendTrialBanNotice({
        to,
        ban,
        note: body?.includeReason ? reason : null,
      });
    }

    return NextResponse.json({
      ok: true,
      ban,
      noticeSent: notice?.sent ?? false,
      noticeError: notice && !notice.sent ? notice.reason : undefined,
    });
  } catch (err) {
    return NextResponse.json({ error: "Ban failed", detail: String(err) }, { status: 500 });
  }
}

/** Send (or re-send) the "no more free trials" notice for an existing ban. */
export async function PUT(req: NextRequest) {
  const gate = await requireOwner();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await req.json().catch(() => ({}));
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Numeric ban id required" }, { status: 400 });
    }

    const ban = await getTrialBanById(id);
    if (!ban) return NextResponse.json({ error: "No such ban" }, { status: 404 });

    // An email ban mails the banned address by default; an IP ban has no
    // recipient of its own, so the caller has to name one.
    const to = String(body?.email ?? (ban.kind === "email" ? ban.value : "")).trim();
    if (!EMAIL_RE.test(to)) {
      return NextResponse.json(
        { error: "This ban has no email to notify — pass one." },
        { status: 400 },
      );
    }

    const notice = await sendTrialBanNotice({
      to,
      ban,
      note: body?.includeReason ? ban.reason : null,
    });
    if (!notice.sent) {
      return NextResponse.json({ error: "Notice failed", detail: notice.reason }, { status: 502 });
    }
    return NextResponse.json({ ok: true, noticeSent: true, to });
  } catch (err) {
    return NextResponse.json({ error: "Notice failed", detail: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireOwner();
  if (gate instanceof NextResponse) return gate;
  try {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "id query param required" }, { status: 400 });
    }
    const { lifted } = await liftTrialBan(id, gate.email);
    return NextResponse.json({ ok: true, lifted, id });
  } catch (err) {
    return NextResponse.json({ error: "Lift failed", detail: String(err) }, { status: 500 });
  }
}
