// Big promotional email for the CB Edge 20%-off launch sale.
//
// High-impact marketing layout: bold hero, feature grid, coupon block, CTA.
// No personal name — signed off generically as "The CB Edge Team". Email-client-
// safe HTML (table layout, inline styles), same brand shell as the other emails.
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";
import { brandLogoUrl } from "@/lib/brand";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = brandLogoUrl(SITE_URL);
const SIGN_UP_URL = `${SITE_URL}/sign-up`;

export interface LaunchPromoOpts {
  /** Override the CTA URL (defaults to sign-up). */
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

export const LAUNCH_PROMO_SUBJECT = "🚀 CB Edge is LIVE — 20% off everything with code LAUNCH";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** Plain-text fallback. */
export function launchPromoText(opts: LaunchPromoOpts = {}): string {
  const cta = opts.ctaUrl || SIGN_UP_URL;
  return [
    "CB EDGE IS LIVE.",
    "",
    "The real-time options & gamma-exposure dashboard built for index traders is officially launched — and to celebrate, everything is 20% off.",
    "",
    "USE CODE: LAUNCH  →  20% OFF your subscription",
    "",
    "What you get inside:",
    "  • Live GEX surfaces, call/put walls & flip levels",
    "  • Estimated Moves & weekly customer levels",
    "  • ES candle heatmaps & net-premium flow",
    "  • Fully automatic ICT chart, tracker & alerts — LIVE",
    "  • A morning Traders Dashboard with AI market overview",
    "",
    `Claim 20% off: ${cta}`,
    "Apply code LAUNCH at checkout.",
    "",
    "— The CB Edge Team",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML promotional email. */
export function launchPromoEmail(opts: LaunchPromoOpts = {}): string {
  const cta = escapeHtml(opts.ctaUrl || SIGN_UP_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  const feature = (title: string, desc: string) => `
    <tr>
      <td style="padding:0 0 12px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="8" valign="top" style="padding-top:6px;">
              <div style="width:6px;height:6px;border-radius:50%;background:#219EBC;"></div>
            </td>
            <td style="padding-left:12px;">
              <div style="font:700 14px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8ECAE6;">${title}</div>
              <div style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#aeb9c4;margin-top:2px;">${desc}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(LAUNCH_PROMO_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">CB Edge is live. 20% off everything with code LAUNCH — claim your edge.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <!-- accent bar -->
          <tr><td style="height:4px;background:linear-gradient(90deg,rgba(33,158,188,0) 0%,#219EBC 50%,rgba(33,158,188,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- logo -->
          <tr>
            <td align="center" style="padding:30px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="280" style="display:block;width:280px;max-width:90%;height:auto;border:0;">
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td align="center" style="padding:22px 28px 0 28px;">
              <div style="font:800 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.22em;text-transform:uppercase;color:#8ECAE6;">The wait is over</div>
              <div style="font:900 40px/1.05 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:12px;letter-spacing:-0.01em;">CB Edge is <span style="color:#219EBC;">LIVE</span></div>
              <div style="font:600 16px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:14px;max-width:440px;">
                The real-time <strong style="color:#8ECAE6;">options &amp; gamma-exposure</strong> dashboard built for index traders — and everything is <strong style="color:#ffffff;">20% off</strong>.
              </div>
            </td>
          </tr>

          <!-- BIG COUPON BLOCK -->
          <tr>
            <td align="center" style="padding:24px 28px 8px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.35);border-radius:16px;background:radial-gradient(circle at 50% 0%,rgba(33,158,188,0.16) 0%,transparent 70%),rgba(33,158,188,0.04);">
                <tr>
                  <td align="center" style="padding:26px 20px;">
                    <div style="font:900 46px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:-0.02em;">20% OFF</div>
                    <div style="font:700 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;margin-top:12px;">Use code at checkout</div>
                    <div style="margin-top:12px;">
                      <span style="display:inline-block;border:2px dashed rgba(33,158,188,0.7);border-radius:10px;padding:12px 28px;background:rgba(33,158,188,0.10);font:900 26px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#219EBC;letter-spacing:0.08em;">LAUNCH</span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- PRIMARY CTA -->
          <tr>
            <td align="center" style="padding:18px 28px 6px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:12px;background:#219EBC;">
                    <a href="${cta}" style="display:inline-block;padding:16px 40px;font:800 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:12px;">Claim 20% off →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- divider -->
          <tr><td style="padding:22px 32px 0 32px;"><div style="border-top:1px solid rgba(255,255,255,0.08);"></div></td></tr>

          <!-- FEATURES -->
          <tr>
            <td style="padding:20px 32px 6px 32px;">
              <div style="font:800 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;margin-bottom:16px;">Everything inside</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${feature("Live GEX &amp; levels", "Gamma-exposure surfaces, call/put walls, and flip levels updating in real time.")}
                ${feature("Estimated Moves", "Weekly customer levels and expected-move zones across the major indices.")}
                ${feature("ES candles &amp; flow", "5-minute ES heatmaps with net-premium flow and live order tape.")}
                ${feature("Fully automatic ICT — LIVE", "Automated ICT chart, tracker, and alerts working for you around the clock.")}
                ${feature("Morning briefing", "A Traders Dashboard with futures, key drivers, and an AI market overview.")}
              </table>
            </td>
          </tr>

          <!-- SECONDARY CTA -->
          <tr>
            <td align="center" style="padding:14px 28px 30px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:12px;background:#219EBC;">
                    <a href="${cta}" style="display:inline-block;padding:15px 38px;font:800 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:12px;">Get started with code LAUNCH →</a>
                  </td>
                </tr>
              </table>
              <div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;margin-top:14px;">— The CB Edge Team</div>
            </td>
          </tr>
        </table>

        <!-- footer -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
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
