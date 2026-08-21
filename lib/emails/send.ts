// Shared transactional email sender (single recipient, via Resend).
//
// Mirrors the per-recipient send logic in /api/admin/send-email (tokenized
// unsubscribe footer + RFC 8058 one-click List-Unsubscribe headers), but for
// one-off transactional sends fired from server code (e.g. the Stripe webhook's
// new-paid-signup welcome) rather than an owner-triggered broadcast.

import { unsubscribeApiUrl, applyUnsubscribeHtml, applyUnsubscribeText } from "@/lib/unsubscribe";
import { campaignSlug, tagEmailLinksHtml, tagEmailLinksText } from "@/lib/emails/utm";
import { getUserById } from "@/lib/db";

const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const FROM_EMAIL = (process.env.EMAIL_FROM || "CB Edge <hello@cbedge.net>").trim();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SendResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

/**
 * Resolve a user's email from our own users table. firstName is always null —
 * unlike the old Supabase Auth version, our users table doesn't capture a
 * display name (email/password + Google sign-in only stamp email + a stable
 * google_sub). Callers already treat firstName as optional personalization.
 */
export async function lookupUser(
  userId: string
): Promise<{ email: string; firstName: string | null } | null> {
  try {
    const user = await getUserById(userId);
    if (!user?.email) return null;
    return { email: user.email, firstName: null };
  } catch (err) {
    console.error("[emails/send] lookupUser failed:", err);
    return null;
  }
}

/**
 * Send one transactional email via Resend. Injects the recipient's tokenized
 * unsubscribe link into the body and sets the one-click List-Unsubscribe
 * headers. Never throws — returns { ok:false } on any failure so callers (e.g.
 * a webhook) aren't broken by a mail hiccup.
 */
export async function sendTransactional(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /**
   * Campaign tag for the links in this email. Defaults to the template's own
   * name if the caller passes one, otherwise a slug of the subject — an
   * untagged automatic email is one whose clicks report as "Direct", which is
   * indistinguishable from someone typing the URL. See lib/emails/utm.ts.
   */
  campaign?: string;
  /** utm_source. "email" unless a caller has a reason to distinguish itself. */
  source?: string;
}): Promise<SendResult> {
  const to = opts.to.trim().toLowerCase();
  if (!RESEND_API_KEY) return { ok: false, skipped: true, reason: "RESEND_API_KEY not set" };
  if (!EMAIL_RE.test(to)) return { ok: false, skipped: true, reason: "invalid recipient" };

  // Tag BEFORE the unsubscribe swap so the {{UNSUBSCRIBE_URL}} placeholder is
  // still a placeholder and cannot be rewritten. utm.ts refuses to touch it
  // either way; the ordering is the belt to that pair of braces.
  const utm = {
    source: campaignSlug(opts.source ?? "email", "email"),
    medium: "email",
    campaign: campaignSlug(opts.campaign ?? "", "") || campaignSlug(opts.subject, "transactional"),
  };
  const html = tagEmailLinksHtml(opts.html, utm);
  const text = opts.text ? tagEmailLinksText(opts.text, utm) : undefined;

  const unsubUrl = unsubscribeApiUrl(to);
  const payload: Record<string, unknown> = {
    from: FROM_EMAIL,
    to: [to],
    subject: opts.subject,
    html: applyUnsubscribeHtml(html, to),
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
  if (text) payload.text = applyUnsubscribeText(text, to);

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => `HTTP ${r.status}`);
      console.error("[emails/send] Resend rejected:", detail.slice(0, 300));
      return { ok: false, reason: `resend ${r.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error("[emails/send] send failed:", err);
    return { ok: false, reason: String(err) };
  }
}
