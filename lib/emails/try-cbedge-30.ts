// "Created an account but never subscribed" nudge email. Targets the notPaying
// audience — signed up, has a login, never converted. Offers first month for
// $30 to get them to try the full dashboard.
//
// The code shown is a SINGLE-USE, PER-RECIPIENT Stripe promotion code, not a
// shared coupon string. The template embeds a {{PROMO_CODE:try30}} placeholder
// (see lib/promoCodes.ts); the send route mints/reuses one real code per
// recipient (e.g. "TRY30-K4M9XZ", max_redemptions:1) and swaps it in right
// before sending — mirrors how {{UNSUBSCRIBE_URL}} is swapped per recipient.
//
// Requires STRIPE_TRY30_COUPON_ID (base Stripe Coupon, $90 off — regular
// price is $120/mo, this drops the first month to $30 — duration "once")
// to exist before this campaign is sent.
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";
import { promoCodePlaceholder } from "@/lib/promoCodes";

const PROMO_CODE_PLACEHOLDER = promoCodePlaceholder("try30");

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const PRICING_URL = `${SITE_URL}/pricing`;

export interface TryCbEdge30Opts {
  /** Override the CTA URL (defaults to /pricing). */
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

export const TRY_CBEDGE_30_SUBJECT = "Your account's ready — first month for $30";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** Plain-text fallback. */
export function tryCbEdge30Text(opts: TryCbEdge30Opts = {}): string {
  const cta = opts.ctaUrl || PRICING_URL;
  return [
    "Hi there,",
    "",
    "You created a CB Edge account but never subscribed — so you haven't seen the dashboard actually running yet: live GEX and options flow, the ICT tracker, the regime engine, estimated moves, scanner and alerts, all of it.",
    "",
    "To make it an easy call, your first month is $30 instead of $120.",
    "",
    `USE CODE: ${PROMO_CODE_PLACEHOLDER} at checkout (this code is yours alone — one-time use)`,
    "",
    `Get started: ${cta}`,
    "",
    "— The CB Edge Team",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML nudge email. */
export function tryCbEdge30Email(opts: TryCbEdge30Opts = {}): string {
  const cta = escapeHtml(opts.ctaUrl || PRICING_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(TRY_CBEDGE_30_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your CB Edge account is ready. First month is $30 with your one-time code.</div>
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
              <div style="font:800 23px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">Your account's ready</div>
              <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8ECAE6;margin-top:6px;">You just haven't seen it running yet.</div>
            </td>
          </tr>

          <!-- body copy -->
          <tr>
            <td style="padding:20px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:600 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">Hi there,</p>
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                You created a <strong style="color:#219EBC;">CB Edge</strong> account but never subscribed — so you haven't actually seen the dashboard running: live GEX &amp; options flow, the ICT tracker, the regime engine, estimated moves, scanner and alerts.
              </p>
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                To make it an easy call, your <strong style="color:#8ECAE6;">first month is $30</strong> instead of $120.
              </p>
            </td>
          </tr>

          <!-- coupon callout -->
          <tr>
            <td align="center" style="padding:6px 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.35);border-radius:14px;background:radial-gradient(circle at 50% 0%,rgba(33,158,188,0.14) 0%,transparent 70%),rgba(33,158,188,0.04);">
                <tr>
                  <td align="center" style="padding:22px 20px;">
                    <div style="font:400 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#EF4444;text-decoration:line-through;margin-bottom:4px;">$120</div>
                    <div style="font:900 34px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:-0.02em;">$30 <span style="font:400 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">first month</span></div>
                    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#8ECAE6;margin-top:12px;">Your one-time code</div>
                    <div style="margin-top:10px;">
                      <span style="display:inline-block;border:2px dashed rgba(33,158,188,0.7);border-radius:10px;padding:10px 24px;background:rgba(33,158,188,0.10);font:900 22px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#219EBC;letter-spacing:0.08em;">${PROMO_CODE_PLACEHOLDER}</span>
                    </div>
                    <div style="font:400 11px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;margin-top:10px;">Yours alone — works once.</div>
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
                    <a href="${cta}" style="display:inline-block;padding:13px 30px;font:700 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:10px;">Get started for $30 →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- sign-off -->
          <tr>
            <td style="padding:0 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:18px;font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                — <span style="color:#8ECAE6;font-weight:600;">The CB Edge Team</span>
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
