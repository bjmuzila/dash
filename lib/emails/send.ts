// Shared transactional email sender (single recipient, via Resend).
//
// Mirrors the per-recipient send logic in /api/admin/send-email (tokenized
// unsubscribe footer + RFC 8058 one-click List-Unsubscribe headers), but for
// one-off transactional sends fired from server code (e.g. the Stripe webhook's
// new-paid-signup welcome) rather than an owner-triggered broadcast.

import { createClient } from "@supabase/supabase-js";
import { unsubscribeApiUrl, applyUnsubscribeHtml, applyUnsubscribeText } from "@/lib/unsubscribe";

const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const FROM_EMAIL = (process.env.EMAIL_FROM || "CB Edge <hello@cbedge.net>").trim();
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SendResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

/**
 * Resolve a user's email + first name from Supabase Auth via the service-role
 * admin API (server-only). Returns null if not configured or not found.
 */
export async function lookupUser(
  userId: string
): Promise<{ email: string; firstName: string | null } | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) return null;
    const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
    const firstName =
      (typeof meta.first_name === "string" && meta.first_name) ||
      (typeof meta.full_name === "string" && meta.full_name.split(" ")[0]) ||
      (typeof meta.name === "string" && meta.name.split(" ")[0]) ||
      null;
    return { email: data.user.email, firstName: firstName || null };
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
}): Promise<SendResult> {
  const to = opts.to.trim().toLowerCase();
  if (!RESEND_API_KEY) return { ok: false, skipped: true, reason: "RESEND_API_KEY not set" };
  if (!EMAIL_RE.test(to)) return { ok: false, skipped: true, reason: "invalid recipient" };

  const unsubUrl = unsubscribeApiUrl(to);
  const payload: Record<string, unknown> = {
    from: FROM_EMAIL,
    to: [to],
    subject: opts.subject,
    html: applyUnsubscribeHtml(opts.html, to),
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
  if (opts.text) payload.text = applyUnsubscribeText(opts.text, to);

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
