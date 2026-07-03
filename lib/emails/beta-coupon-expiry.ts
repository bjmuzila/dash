// Last-chance email: the 50%-off beta coupon (CB-BETA) expires midnight Mon
// Jul 6. A 15%-off launch sale runs next. 50% won't return; prices likely rise
// in April with CB Edge v2. Email-client-safe HTML (table layout, inline
// styles), same brand shell as lib/emails/welcome.ts.
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const SIGN_UP_URL = `${SITE_URL}/sign-up`;

export interface BetaCouponExpiryOpts {
  /** Recipient's first name, if known. Falls back to a generic greeting. */
  firstName?: string | null;
  /** Override the CTA URL (defaults to sign-up). */
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

export const BETA_COUPON_EXPIRY_SUBJECT = "Last chance: 50% off ends midnight Monday";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** Plain-text fallback. */
export function betaCouponExpiryText(opts: BetaCouponExpiryOpts = {}): string {
  const name = opts.firstName?.trim();
  const hi = name ? `Hi ${name},` : "Hi there,";
  const cta = opts.ctaUrl || SIGN_UP_URL;
  return [
    hi,
    "",
    "This is your last call on the beta launch price.",
    "",
    "The 50% off code CB-BETA expires MIDNIGHT this Monday, July 6.",
    "",
    "After that it's gone for good — 50% off will never be offered again. A 15% off launch sale runs next, and that will be the best deal available going forward.",
    "",
    "Heads up: with CB Edge v2 landing in April, prices will most likely increase. Locking in now at 50% is the lowest this will ever be.",
    "",
    `Get in while you can: ${cta}`,
    "Use code CB-BETA at checkout for 50% off.",
    "",
    "— Bzila, founder of CB Edge",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML last-chance email. */
export function betaCouponExpiryEmail(opts: BetaCouponExpiryOpts = {}): string {
  const name = opts.firstName?.trim();
  const hi = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
  const cta = escapeHtml(opts.ctaUrl || SIGN_UP_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(BETA_COUPON_EXPIRY_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Code CB-BETA (50% off) expires midnight Monday, July 6. It won't come back.</div>
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
              <div style="font:800 23px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">Last chance — 50% off</div>
              <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8ECAE6;margin-top:6px;">Ends midnight Monday, July 6.</div>
            </td>
          </tr>

          <!-- body copy -->
          <tr>
            <td style="padding:20px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:600 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">${hi}</p>
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                This is your last call on the <strong style="color:#219EBC;">beta launch price</strong>. The 50% off code <strong style="color:#8ECAE6;">CB-BETA</strong> expires <strong style="color:#ffffff;">midnight this Monday, July 6</strong>.
              </p>
            </td>
          </tr>

          <!-- coupon callout -->
          <tr>
            <td style="padding:6px 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <tr>
                  <td align="center" style="padding:18px 20px;">
                    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:#8ECAE6;">50% off — expires Mon Jul 6, midnight</div>
                    <div style="font:800 24px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:10px;letter-spacing:0.04em;">
                      <span style="display:inline-block;border:1px dashed rgba(33,158,188,0.6);border-radius:8px;padding:8px 18px;background:rgba(33,158,188,0.08);color:#219EBC;">CB-BETA</span>
                    </div>
                    <div style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#aeb9c4;margin-top:10px;">Apply <strong style="color:#8ECAE6;">CB-BETA</strong> at checkout for <strong style="color:#ffffff;">50% off</strong>.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- why it matters -->
          <tr>
            <td style="padding:14px 32px 4px 32px;">
              <p style="margin:0 0 6px 0;font:400 14px/1.8 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#aeb9c4;">
                <span style="color:#8ECAE6;">›</span> After Monday, <strong style="color:#ffffff;">50% off will never be offered again.</strong><br>
                <span style="color:#8ECAE6;">›</span> A <strong style="color:#ffffff;">15% off launch sale</strong> runs next — the best deal from then on.<br>
                <span style="color:#8ECAE6;">›</span> With <strong style="color:#ffffff;">CB Edge v2</strong> arriving in April, prices will most likely increase.
              </p>
              <p style="margin:14px 0 0 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                Locking in now is the <strong style="color:#8ECAE6;">lowest this will ever be</strong>. Get in while you can.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:20px 32px 28px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:10px;background:#219EBC;">
                    <a href="${cta}" style="display:inline-block;padding:13px 30px;font:700 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:10px;">Claim 50% off →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- sign-off -->
          <tr>
            <td style="padding:0 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:18px;font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                Thanks for being here from the start.<br><br>
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
                CB Edge · You're receiving this because you signed up for the beta.<br>
                <a href="${unsubHref}" style="color:#8ECAE6;text-decoration:underline;">Unsubscribe</a>
                &nbsp;·&nbsp;
                <a href="${SITE_URL}" style="color:#6b7d8f;text-decoration:underline;">cbedge.net</a>
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
