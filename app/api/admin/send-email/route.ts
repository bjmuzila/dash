import { NextRequest, NextResponse } from "next/server";
import { getServerUserId } from "@/lib/supabase/server";
import { listAllUsersForBroadcast, listWaitlist, addEmailSend, listEmailSends, getUnsubscribedSet } from "@/lib/db";
import { unsubscribeApiUrl, applyUnsubscribeHtml, applyUnsubscribeText } from "@/lib/unsubscribe";
import { applyPromoCodesHtml, applyPromoCodesText, hasPromoCodePlaceholder } from "@/lib/promoCodes";
import { loadLegacyEmails } from "@/lib/emails/legacyEmails";
import { campaignSlug, tagEmailLinksHtml, tagEmailLinksText } from "@/lib/emails/utm";

// Owner-only email sender. POST composes + sends a broadcast via Resend; GET
// returns the resolvable recipient lists (all signed-up users / paid subscribers
// only) so the admin page can preview who'll receive a send.
//
// SECURITY: gated to OWNER_USER_ID (same pattern as /api/feedback, /dev/*).
// Fails CLOSED — if OWNER_USER_ID is unset/misconfigured, all requests are
// rejected (403) rather than opened to any signed-in user.
export const dynamic = "force-dynamic";

const OWNER_USER_ID = (process.env.OWNER_USER_ID || "").trim();
const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
// Verified Cloudflare domain sender. Override per-deploy via env if desired.
const FROM_EMAIL = (process.env.EMAIL_FROM || "CB Edge <hello@cbedge.net>").trim();

async function ownerGate(): Promise<{ ok: true } | { ok: false; status: number }> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, status: 401 };
  if (!OWNER_USER_ID || userId !== OWNER_USER_ID) return { ok: false, status: 403 };
  return { ok: true };
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

// "All users" combined list: signed-up accounts, then waitlist, then the two
// legacy CSV lists — in that order, deduped. JS Set preserves first-seen
// insertion order, so this both (a) removes duplicates across sources and
// (b) keeps the old/legacy addresses at the tail of the array, which is what
// the per-recipient send loop below walks in order. That means if a send run
// ever gets interrupted partway, it's the stale legacy addresses that don't
// go out yet — not live users/subscribers.
function allUsersList(lists: {
  signedUp: string[]; waitlist: string[]; oldEmails: string[]; oldEmails2: string[];
}): string[] {
  const seen = new Set<string>();
  for (const email of [...lists.signedUp, ...lists.waitlist, ...lists.oldEmails, ...lists.oldEmails2]) {
    const key = email.trim().toLowerCase();
    if (key) seen.add(key);
  }
  return Array.from(seen);
}

// GET — owner only.
//   ?history=1 → returns the broadcast send history (summary rows).
//   (default)  → returns recipient lists/counts for the compose UI preview.
export async function GET(req: NextRequest) {
  try {
    const gate = await ownerGate();
    if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: gate.status });

    if (req.nextUrl.searchParams.get("history")) {
      const history = await listEmailSends(100);
      return NextResponse.json({ ok: true, history });
    }

    const suppressed = await getUnsubscribedSet().catch(() => new Set<string>());
    const recipients = (await listAllUsersForBroadcast()).filter(
      (r) => !suppressed.has(r.email.trim().toLowerCase())
    );
    const signedUp = recipients.map((r) => r.email);
    const subscribers = recipients.filter((r) => r.paid).map((r) => r.email);
    // Signed up (has an account) but never converted to a paid plan.
    const notPaying = recipients.filter((r) => !r.paid).map((r) => r.email);
    let waitlist: string[] = [];
    try { waitlist = await listWaitlistEmails(); } catch { /* table optional */ }
    const legacy = loadLegacyEmails();
    const oldEmails = legacy.oldEmails.filter((e) => !suppressed.has(e.trim().toLowerCase()));
    const oldEmails2 = legacy.oldEmails2.filter((e) => !suppressed.has(e.trim().toLowerCase()));
    // "All users" = every address we have on file, deduped. Built in send
    // priority order — signed-up accounts (subscribers + not-paying) first,
    // then the waitlist, then the legacy CSV lists LAST — so if a name shows
    // up in more than one source it's counted/sent under the more current
    // list, and the old/stale addresses are always the last to go out.
    const all = allUsersList({ signedUp, waitlist, oldEmails, oldEmails2 });
    return NextResponse.json({
      ok: true,
      configured: !!RESEND_API_KEY,
      from: FROM_EMAIL,
      counts: {
        all: all.length, subscribers: subscribers.length, notPaying: notPaying.length,
        waitlist: waitlist.length, oldEmails: oldEmails.length, oldEmails2: oldEmails2.length,
      },
      recipients: { all, subscribers, notPaying, waitlist, oldEmails, oldEmails2 },
    });
  } catch (err) {
    return NextResponse.json({ error: "Recipient load failed", detail: String(err) }, { status: 500 });
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Resend's rate limit is 10 req/sec. Sending per-recipient in a tight loop
// blows past that on any list bigger than ~10, coming back as 429
// rate_limit_exceeded. sendViaResend retries 429s (honoring Retry-After when
// present) and the caller paces every send with a fixed delay so normal
// traffic never even hits the limit.
async function sendViaResend(
  payload: Record<string, unknown>
): Promise<{ ok: boolean; detail?: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (r.ok) return { ok: true };
    if (r.status === 429) {
      const retryAfterSec = Number(r.headers.get("retry-after")) || 1;
      await sleep(retryAfterSec * 1000 + attempt * 250);
      continue;
    }
    const detail = await r.text().catch(() => `HTTP ${r.status}`);
    return { ok: false, detail: detail.slice(0, 500) };
  }
  return { ok: false, detail: "rate_limit_exceeded: gave up after 5 retries" };
}

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

    // ── Campaign tagging ──────────────────────────────────────────────────────
    // Every cbedge.net link in the body gets utm_source/medium/campaign so the
    // clicks land on the owner Acquisition panel as this send rather than as
    // "Direct". Defaults are chosen so a send with no campaign fields at all
    // (an old client, a curl) is still attributed: source "email", campaign
    // slugged from the subject line.
    //
    // Done ONCE here, before the per-recipient loop, because the tags are the
    // same for everyone — and critically BEFORE applyUnsubscribeHtml/-Text and
    // the promo-code swap, so `{{UNSUBSCRIBE_URL}}` and `{{PROMO_CODE}}` are
    // still placeholders and cannot be mangled. See lib/emails/utm.ts.
    const utm = {
      source: campaignSlug(String(body?.utmSource ?? "email"), "email"),
      medium: "email",
      campaign: campaignSlug(String(body?.utmCampaign ?? "") || subject, "broadcast"),
    };
    const taggedHtml = html ? tagEmailLinksHtml(html, utm) : "";
    const taggedText = text ? tagEmailLinksText(text, utm) : "";

    // Resolve recipients.
    let to: string[] = [];
    if (audience === "all") {
      // Every address we have — signed-up accounts, waitlist, and the legacy
      // lists — deduped, legacy addresses sent last. See allUsersList().
      const recipients = await listAllUsersForBroadcast();
      const signedUp = recipients.map((r) => r.email);
      const waitlist = await listWaitlistEmails().catch(() => []);
      const { oldEmails, oldEmails2 } = loadLegacyEmails();
      to = allUsersList({ signedUp, waitlist, oldEmails, oldEmails2 });
    } else if (audience === "subscribers" || audience === "not_paying") {
      const recipients = await listAllUsersForBroadcast();
      const picked = audience === "subscribers" ? recipients.filter((r) => r.paid) : recipients.filter((r) => !r.paid);
      to = picked.map((r) => r.email);
    } else if (audience === "waitlist") {
      to = await listWaitlistEmails();
    } else if (audience === "old_emails" || audience === "old_emails2") {
      const { oldEmails, oldEmails2 } = loadLegacyEmails();
      to = audience === "old_emails2" ? oldEmails2 : oldEmails;
    } else {
      to = Array.isArray(body?.to) ? body.to.map((x: unknown) => String(x).trim()) : [];
    }

    // De-dupe + validate.
    to = Array.from(new Set(to.filter((e) => EMAIL_RE.test(e))));

    // Honor the global suppression list for EVERY audience — never email anyone
    // who unsubscribed (or was manually suppressed by the owner).
    let suppressedCount = 0;
    try {
      const suppressed = await getUnsubscribedSet();
      const before = to.length;
      to = to.filter((e) => !suppressed.has(e.trim().toLowerCase()));
      suppressedCount = before - to.length;
    } catch (e) {
      console.error("[send-email] suppression load failed:", e);
    }

    if (to.length === 0) return NextResponse.json({ error: "No valid recipients" }, { status: 400 });

    // Send PER RECIPIENT so each email carries its own tokenized unsubscribe
    // link + one-click List-Unsubscribe header (CAN-SPAM / Gmail bulk-sender
    // requirement). Slower than BCC batching, but correct and keeps addresses
    // private. Fine for current list sizes.
    const sent: string[] = [];
    const failed: Array<{ batch: string[]; error: string }> = [];
    const needsPromoCode = hasPromoCodePlaceholder(taggedHtml) || hasPromoCodePlaceholder(taggedText);
    for (const recipient of to) {
      // Mint (or reuse) this recipient's own single-use Stripe promo code if
      // the template references one. Each person gets a code that only works
      // once — never a shared code the whole list races to redeem. A mint
      // failure (e.g. missing coupon env var) fails just this recipient
      // rather than the whole batch.
      let recipientHtml = taggedHtml;
      let recipientText = taggedText;
      if (needsPromoCode) {
        try {
          if (taggedHtml) recipientHtml = await applyPromoCodesHtml(taggedHtml, recipient);
          if (taggedText) recipientText = await applyPromoCodesText(taggedText, recipient);
        } catch (e) {
          failed.push({ batch: [recipient], error: `promo code: ${String(e)}` });
          continue;
        }
      }

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
      if (recipientHtml) payload.html = applyUnsubscribeHtml(recipientHtml, recipient);
      if (recipientText) payload.text = applyUnsubscribeText(recipientText, recipient);

      const result = await sendViaResend(payload);
      if (result.ok) {
        sent.push(recipient);
      } else {
        failed.push({ batch: [recipient], error: result.detail || "send failed" });
      }

      // Pace requests to stay comfortably under Resend's 10 req/sec cap.
      await sleep(120);
    }

    // Record the send in the history log (summary only). Non-fatal — a logging
    // failure must not fail the send response.
    try {
      const userId = await getServerUserId();
      await addEmailSend({
        subject,
        audience,
        sent_count: sent.length,
        failed_count: to.length - sent.length,
        recipients: sent,
        sent_by: userId ?? null,
      });
    } catch (e) {
      console.error("[send-email] history log failed:", e);
    }

    return NextResponse.json({
      ok: failed.length === 0,
      sentCount: sent.length,
      failedCount: to.length - sent.length,
      suppressedCount,
      failed: failed.length ? failed : undefined,
      // Echoed so the compose page can confirm what the clicks will report as,
      // rather than the owner having to guess at what the subject slugged to.
      campaign: `${utm.source} / ${utm.medium} / ${utm.campaign}`,
    });
  } catch (err) {
    return NextResponse.json({ error: "Send failed", detail: String(err) }, { status: 500 });
  }
}
