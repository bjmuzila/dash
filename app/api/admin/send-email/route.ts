import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSubscription, PAID_STATUSES, listWaitlist } from "@/lib/db";
import { unsubscribeApiUrl, applyUnsubscribeHtml, applyUnsubscribeText } from "@/lib/unsubscribe";

// Owner-only email sender. POST composes + sends a broadcast via Resend; GET
// returns the resolvable recipient lists (all signed-up users / paid subscribers
// only) so the admin page can preview who'll receive a send.
//
// SECURITY: gated to OWNER_USER_ID (same pattern as /api/feedback, /dev/*). If
// OWNER_USER_ID isn't set yet, any signed-in user passes so the owner can't lock
// themselves out — signed-out requests are always rejected.
export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
// Verified Cloudflare domain sender. Override per-deploy via env if desired.
const FROM_EMAIL = (process.env.EMAIL_FROM || "CB Edge <hello@cbedge.net>").trim();

async function ownerGate(): Promise<{ ok: true } | { ok: false; status: number }> {
  const { userId } = await auth();
  if (!userId) return { ok: false, status: 401 };
  if (OWNER_USER_ID && userId !== OWNER_USER_ID) return { ok: false, status: 403 };
  return { ok: true };
}

// getUserList may return { data: User[] } (v5+) or a bare User[] (older). Normalize.
function userArray(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = res as { data?: unknown[] };
  return Array.isArray(r?.data) ? (r.data as Record<string, unknown>[]) : [];
}

// Best-effort primary email for a Clerk user object across SDK shapes.
function primaryEmail(u: Record<string, unknown>): string | null {
  const addrs = (u.emailAddresses ?? u.email_addresses) as
    | Array<{ id?: string; emailAddress?: string; email_address?: string }>
    | undefined;
  if (!Array.isArray(addrs) || addrs.length === 0) return null;
  const primaryId = (u.primaryEmailAddressId ?? u.primary_email_address_id) as string | undefined;
  const primary = primaryId ? addrs.find((a) => a.id === primaryId) : undefined;
  const pick = primary ?? addrs[0];
  return pick?.emailAddress ?? pick?.email_address ?? null;
}

interface Recipient { userId: string; email: string; paid: boolean }

// Page through every Clerk user and resolve {email, paid} for each. paid is
// derived from the subscriptions table (active/trialing). Capped to avoid a
// runaway loop on very large instances.
async function listRecipients(): Promise<Recipient[]> {
  const client = await clerkClient();
  const out: Recipient[] = [];
  const PAGE = 100;
  for (let offset = 0; offset < 5000; offset += PAGE) {
    const res = await client.users.getUserList({ orderBy: "-created_at", limit: PAGE, offset });
    const batch = userArray(res);
    if (batch.length === 0) break;
    for (const u of batch) {
      const email = primaryEmail(u);
      if (!email) continue;
      const id = String(u.id ?? "");
      let paid = false;
      try {
        const sub = id ? await getSubscription(id) : undefined;
        paid = !!sub?.status && PAID_STATUSES.has(sub.status);
      } catch { /* treat lookup failure as unpaid */ }
      out.push({ userId: id, email, paid });
    }
    if (batch.length < PAGE) break;
  }
  return out;
}

// Landing-page waitlist emails (the /api/waitlist signups), excluding anyone who
// already unsubscribed. Separate from Clerk users — these people never created
// an account.
async function listWaitlistEmails(): Promise<string[]> {
  const rows = await listWaitlist(5000);
  return rows
    .filter((r) => !r.unsubscribed_at && r.email)
    .map((r) => r.email.trim().toLowerCase());
}

// GET — owner only. Returns recipient lists for the compose UI preview.
export async function GET() {
  try {
    const gate = await ownerGate();
    if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });

    const recipients = await listRecipients();
    const all = recipients.map((r) => r.email);
    const subscribers = recipients.filter((r) => r.paid).map((r) => r.email);
    let waitlist: string[] = [];
    try { waitlist = await listWaitlistEmails(); } catch { /* table optional */ }
    return NextResponse.json({
      ok: true,
      configured: !!RESEND_API_KEY,
      from: FROM_EMAIL,
      counts: { all: all.length, subscribers: subscribers.length, waitlist: waitlist.length },
      recipients: { all, subscribers, waitlist },
    });
  } catch (err) {
    return NextResponse.json({ error: "Recipient load failed", detail: String(err) }, { status: 500 });
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST — owner only. Sends an email broadcast via Resend.
// Body: { subject, html?, text?, audience?: "all"|"subscribers"|"custom", to?: string[] }
export async function POST(req: NextRequest) {
  try {
    const gate = await ownerGate();
    if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });

    if (!RESEND_API_KEY) {
      return NextResponse.json(
        { error: "RESEND_API_KEY not configured on the server." },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const subject = String(body?.subject ?? "").trim();
    const html = body?.html != null ? String(body.html) : "";
    const text = body?.text != null ? String(body.text) : "";
    const audience = String(body?.audience ?? "custom");

    if (!subject) return NextResponse.json({ error: "Subject is required" }, { status: 400 });
    if (!html && !text) return NextResponse.json({ error: "Message body is required" }, { status: 400 });

    // Resolve recipients.
    let to: string[] = [];
    if (audience === "all" || audience === "subscribers") {
      const recipients = await listRecipients();
      to = (audience === "subscribers" ? recipients.filter((r) => r.paid) : recipients).map((r) => r.email);
    } else if (audience === "waitlist") {
      to = await listWaitlistEmails();
    } else {
      to = Array.isArray(body?.to) ? body.to.map((x: unknown) => String(x).trim()) : [];
    }

    // De-dupe + validate.
    to = Array.from(new Set(to.filter((e) => EMAIL_RE.test(e))));
    if (to.length === 0) return NextResponse.json({ error: "No valid recipients" }, { status: 400 });

    // Send PER RECIPIENT so each email carries its own tokenized unsubscribe
    // link + one-click List-Unsubscribe header (CAN-SPAM / Gmail bulk-sender
    // requirement). Slower than BCC batching, but correct and keeps addresses
    // private. Fine for current list sizes.
    const sent: string[] = [];
    const failed: Array<{ batch: string[]; error: string }> = [];
    for (const recipient of to) {
      const unsubUrl = unsubscribeApiUrl(recipient);
      const payload: Record<string, unknown> = {
        from: FROM_EMAIL,
        to: [recipient],
        subject,
        // RFC 8058 one-click unsubscribe — surfaced as the native "Unsubscribe"
        // link by Gmail/Apple Mail. POSTs to our endpoint via List-Unsubscribe-Post.
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
      // Swap the template's {{UNSUBSCRIBE_URL}} placeholder for this recipient's
      // real tokenized URL (or append a footer if the body has no placeholder).
      // Guarantees exactly one working unsubscribe link in every email.
      if (html) payload.html = applyUnsubscribeHtml(html, recipient);
      if (text) payload.text = applyUnsubscribeText(text, recipient);

      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        sent.push(recipient);
      } else {
        const detail = await r.text().catch(() => `HTTP ${r.status}`);
        failed.push({ batch: [recipient], error: detail.slice(0, 500) });
      }
    }

    return NextResponse.json({
      ok: failed.length === 0,
      sentCount: sent.length,
      failedCount: to.length - sent.length,
      failed: failed.length ? failed : undefined,
    });
  } catch (err) {
    return NextResponse.json({ error: "Send failed", detail: String(err) }, { status: 500 });
  }
}
