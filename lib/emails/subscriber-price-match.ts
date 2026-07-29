// Subscriber notice: current monthly subscribers are being moved to the
// lowest available monthly price ($45/mo) so every monthly subscriber pays
// the same rate. Personal founder tone (matches reorg-beta-notice.ts /
// maintenance.ts), signed "— Bzila".
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const SIGN_IN_URL = `${SITE_URL}/home`;

export interface SubscriberPriceMatchOpts {
  /** Recipient's first name, if known. Falls back to a generic greeting. */
  firstName?: string | null;
  /** Override the CTA URL (defaults to the dashboard home). */
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
  /** New monthly price. Defaults to 45. */
  newPrice?: number;
}

export const SUBSCRIBER_PRICE_MATCH_SUBJECT = "Your CB Edge price is dropping to $45/mo";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** Plain-text fallback. */
export function subscriberPriceMatchText(opts: SubscriberPriceMatchOpts = {}): string {
  const name = opts.firstName?.trim();
  const hi = name ? `Hi ${name},` : "Hi there,";
  const cta = opts.ctaUrl || SIGN_IN_URL;
  const price = opts.newPrice ?? 45;
  return [
    hi,
    "",
    `Quick update on your CB Edge subscription: starting with your next billing cycle, your monthly price is moving to $${price}/mo.`,
    "",
    "This isn't a price increase — it's the opposite. We're bringing every current monthly subscriber down to match the lowest monthly price we offer, so no one on a monthly plan pays more than anyone else.",
    "",
    "What this means for you:",
    "- No action needed on your end.",
    `- Your next charge (and every charge after) will be $${price}/mo.`,
    "- Your plan, features, and access stay exactly the same.",
    "",
    `Check out what's live now: ${cta}`,
    "",
    "Thanks for being a subscriber.",
    "",
    "— Bzila, founder of CB Edge",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML subscriber price-match email. */
export function subscriberPriceMatchEmail(opts: SubscriberPriceMatchOpts = {}): string {
  const name = opts.firstName?.trim();
  const hi = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
  const cta = escapeHtml(opts.ctaUrl || SIGN_IN_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;
  const price = opts.newPrice ?? 45;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(SUBSCRIBER_PRICE_MATCH_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your monthly price is dropping to match our lowest available rate — no action needed.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <!-- accent bar -->
          <tr><td style="height:3px;background:linear-gradient(90deg,rgba(33,158,188,0) 0%,#219EBC 50%,rgba(33,158,188,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- logo -->
          <tr>
            <td align="center" style="padding:28px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="260" style="display:block;width:260px;max-width:88%;height:auto;border:0;">
            </td>
          </tr>

          <!-- heading -->
          <tr>
            <td align="center" style="padding:0 32px 4px 32px;">
              <div style="font:800 22px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">Your price is dropping to $${price}/mo</div>
              <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8ECAE6;margin-top:6px;">Matching our lowest available monthly rate.</div>
            </td>
          </tr>

          <!-- body copy -->
          <tr>
            <td style="padding:20px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:600 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">${hi}</p>
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                Quick update on your CB Edge subscription: starting with your next billing cycle, your monthly price is moving to <strong style="color:#8ECAE6;">$${price}/mo</strong>.
              </p>
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                This isn't a price increase — it's the opposite. We're bringing every current monthly subscriber down to match the <strong style="color:#ffffff;">lowest monthly price</strong> we offer, so no one on a monthly plan pays more than anyone else.
              </p>
            </td>
          </tr>

          <!-- what changes callout -->
          <tr>
            <td style="padding:6px 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:#8ECAE6;">What this means for you</div>
                    <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:8px;">
                      No action needed on your end. Your next charge (and every charge after) will be <strong style="color:#ffffff;">$${price}/mo</strong> — your plan, features, and access stay exactly the same.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:20px 32px 28px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:10px;background:#219EBC;">
                    <a href="${cta}" style="display:inline-block;padding:13px 30px;font:700 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:10px;">Open the dashboard →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- sign-off -->
          <tr>
            <td style="padding:0 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:18px;font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                Thanks for being a subscriber.<br><br>
                <span style="color:#8ECAE6;font-weight:600;">— Bzila, founder of CB Edge</span>
              </div>
            </td>
          </tr>
        </table>

        <!-- footer -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td align="center" style="padding:18px 32px;">
              <div style="font:400 11px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;">
                <a href="${unsubHref}" style="color:#8ECAE6;text-decoration:underline;font-size:14px;">Unsubscribe</a>
                &nbsp;·&nbsp;
                <a href="${SITE_URL}" style="color:#6b7d8f;text-decoration:underline;font-size:14px;">cbedge.net</a>
                <br>
                <span style="color:#5a6b7d;">Market analytics, not financial advice.</span>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
