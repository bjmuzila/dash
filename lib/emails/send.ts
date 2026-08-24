// Shared transactional email sender (single recipient, via Resend).
//
// TWO senders live here and they are NOT interchangeable. Pick by what the
// message IS, not by which import was already in the file:
//
//   sendTransactional() — LIST / BULK mail. Broadcasts, lifecycle nudges,
//     promos, anything a recipient could reasonably want to stop receiving.
//     Injects the tokenized unsubscribe footer, sets the RFC 8058 one-click
//     List-Unsubscribe headers, and UTM-tags every link so clicks attribute.
//
//   sendAuthEmail() — AUTH / SECURITY mail. Password reset, email
//     verification, anything the user just asked for and cannot opt out of.
//     Does NONE of the above, deliberately:
//       · No unsubscribe footer. A password reset carrying "you signed up for
//         CB Edge launch updates" is a content/intent mismatch a filter reads
//         as forged marketing.
//       · No List-Unsubscribe headers. Those DECLARE the message bulk, which
//         pools it into the same Gmail reputation bucket as the promo blasts —
//         so one complaint on a promo can bury everyone's password resets.
//       · No UTM tagging. A security link rewritten to
//         `?token=…&utm_campaign=reset-your-password` is a classic phishing
//         tell, and the tracking params are noise on a one-shot token anyway.
//       · Its own From address (EMAIL_AUTH_FROM), so auth mail builds and
//         spends reputation separately from marketing.
//
// Keep marketing and auth on separate verified domains/subdomains in Resend to
// finish the separation the two From addresses start.

import { unsubscribeApiUrl, applyUnsubscribeHtml, applyUnsubscribeText } from "@/lib/unsubscribe";
import { campaignSlug, tagEmailLinksHtml, tagEmailLinksText } from "@/lib/emails/utm";
import { getUserById } from "@/lib/db";
import { randomUUID } from "crypto";

const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const FROM_EMAIL = (process.env.EMAIL_FROM || "CB Edge <hello@cbedge.net>").trim();
// Auth/security mail sends from its own identity. Falls back to no-reply@ on
// the same domain rather than to FROM_EMAIL — sharing the marketing address is
// the thing this split exists to undo.
const AUTH_FROM_EMAIL = (process.env.EMAIL_AUTH_FROM || "CB Edge <no-reply@cbedge.net>").trim();

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
 * POST a fully-built payload to Resend. Never throws — returns { ok:false } on
 * any failure so callers (e.g. a webhook, an auth route) aren't broken by a
 * mail hiccup. Shared by both senders so the error/logging shape stays one
 * thing.
 */
async function postToResend(payload: Record<string, unknown>, tag: string): Promise<SendResult> {
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
      console.error(`[emails/${tag}] Resend rejected:`, detail.slice(0, 300));
      return { ok: false, reason: `resend ${r.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[emails/${tag}] send failed:`, err);
    return { ok: false, reason: String(err) };
  }
}

/**
 * Send one BULK/LIST email via Resend. Injects the recipient's tokenized
 * unsubscribe link into the body and sets the one-click List-Unsubscribe
 * headers.
 *
 * Do NOT use this for password resets, email verification, or any other
 * security mail — see sendAuthEmail() below and the header comment.
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

  return postToResend(payload, "send");
}

/**
 * Send one AUTH/SECURITY email via Resend — password reset, email
 * verification, sign-in code. The body goes out exactly as the template built
 * it: no unsubscribe footer, no List-Unsubscribe headers, no UTM rewriting of
 * the links. See the header comment for why each of those is actively harmful
 * on a security message.
 *
 * Never throws — returns { ok:false } on failure. Callers must keep returning
 * their generic response either way (don't leak whether mail went out).
 */
export async function sendAuthEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendResult> {
  const to = opts.to.trim().toLowerCase();
  if (!RESEND_API_KEY) return { ok: false, skipped: true, reason: "RESEND_API_KEY not set" };
  if (!EMAIL_RE.test(to)) return { ok: false, skipped: true, reason: "invalid recipient" };

  const payload: Record<string, unknown> = {
    from: AUTH_FROM_EMAIL,
    to: [to],
    subject: opts.subject,
    html: opts.html,
    headers: {
      // Gmail collapses byte-identical messages into one thread. Two reset
      // requests ten minutes apart would look like one email, and the user
      // would click the expired link. A unique ref keeps them distinct.
      "X-Entity-Ref-ID": randomUUID(),
      // System-generated: keeps vacation autoresponders from replying to it.
      "Auto-Submitted": "auto-generated",
    },
  };
  if (opts.text) payload.text = opts.text;

  return postToResend(payload, "sendAuthEmail");
}
