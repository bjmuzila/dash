// "Why pay extra for the same data?" pricing-comparison promo email.
//
// Marketing layout mirroring the cb-edge-pricing-post.svg card: $99/$199/$699
// (others) struck through vs CB Edge $45/mo (code MONTH) or $500/yr (code YEAR),
// full feature grid, "Built by a trader, for traders." No personal name — signed
// generically. Email-client-safe HTML (table layout, inline styles), same brand
// shell as the other emails.
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6 · orange #FB8501

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const PRICING_URL = `${SITE_URL}/pricing`;

export interface PricingComparisonOpts {
  /** Override the CTA URL (defaults to /pricing). */
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

export const PRICING_COMPARISON_SUBJECT = "Why pay extra for the same data?";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

const FEATURES = [
  "Live GEX & Options Flow",
  "Live Chat / Notes",
  "ICT Setup Tracker",
  "AI-Gen Strategies",
  "HMM Regime Engine",
  "GEX Heatmap",
  "Estimated Moves (EM)",
  "Scanner & Alerts",
  "Trader Journal",
];

/** Plain-text fallback. */
export function pricingComparisonText(opts: PricingComparisonOpts = {}): string {
  const cta = opts.ctaUrl || PRICING_URL;
  return [
    "WHY PAY EXTRA FOR THE SAME DATA?",
    "",
    "Not trying to overcharge. Here for the trader, not to profit off them.",
    "",
    "Others charge $99, $199, or $699 a month for this kind of data.",
    "",
    "CB Edge starts at $45/month.",
    "",
    "What's included:",
    ...FEATURES.map((f) => `  • ${f}`),
    "",
    "CB Edge — Monthly: $45/month — code MONTH",
    "CB Edge — Annual (best value): $500/year — code YEAR",
    "",
    `See the plans: ${cta}`,
    "",
    "Built by a trader, for traders.",
    "",
    "— The CB Edge Team",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML pricing-comparison email. */
export function pricingComparisonEmail(opts: PricingComparisonOpts = {}): string {
  const cta = escapeHtml(opts.ctaUrl || PRICING_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  const featureCell = (label: string) => `
      <td width="50%" style="padding:0 8px 12px 0;vertical-align:top;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="8" valign="top" style="padding-top:6px;"><div style="width:6px;height:6px;border-radius:50%;background:#219EBC;"></div></td>
          <td style="padding-left:10px;font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">${label}</td>
        </tr></table>
      </td>`;
  const featureRow = (a: string, b?: string) => `
    <tr>
      ${featureCell(a)}
      ${b ? featureCell(b) : `<td width="50%" style="padding:0 0 12px 8px;">&nbsp;</td>`}
    </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(PRICING_COMPARISON_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Others charge $99–$699/mo for this data. CB Edge is $45/mo or $500/yr. Built by a trader, for traders.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <!-- accent bar -->
          <tr><td style="height:4px;background:linear-gradient(90deg,rgba(33,158,188,0) 0%,#219EBC 50%,rgba(33,158,188,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- logo -->
          <tr>
            <td align="center" style="padding:30px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="260" style="display:block;width:260px;max-width:88%;height:auto;border:0;">
            </td>
          </tr>

          <!-- HEADLINE -->
          <tr>
            <td align="center" style="padding:22px 28px 0 28px;">
              <div style="font:800 30px/1.25 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">Why pay extra<br><span style="color:#8ECAE6;">for the same data?</span></div>
              <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:12px;max-width:440px;">
                Not trying to overcharge. Here for the trader, not to profit off them.
              </div>
            </td>
          </tr>

          <!-- OTHERS CHARGE -->
          <tr>
            <td align="center" style="padding:24px 28px 0 28px;">
              <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:#FB8501;margin-bottom:12px;">Others charge / month</div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="padding:0 8px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(239,68,68,0.30);border-radius:10px;background:rgba(239,68,68,0.06);">
                    <tr><td align="center" style="padding:14px 22px;"><span style="font:700 24px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#EF4444;text-decoration:line-through;">$99</span></td></tr>
                  </table>
                </td>
                <td style="padding:0 8px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(239,68,68,0.30);border-radius:10px;background:rgba(239,68,68,0.06);">
                    <tr><td align="center" style="padding:14px 22px;"><span style="font:700 24px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#EF4444;text-decoration:line-through;">$199</span></td></tr>
                  </table>
                </td>
                <td style="padding:0 8px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(239,68,68,0.30);border-radius:10px;background:rgba(239,68,68,0.06);">
                    <tr><td align="center" style="padding:14px 22px;"><span style="font:700 24px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#EF4444;text-decoration:line-through;">$699</span></td></tr>
                  </table>
                </td>
              </tr></table>
            </td>
          </tr>

          <!-- punchline -->
          <tr>
            <td align="center" style="padding:20px 28px 4px 28px;">
              <div style="font:800 19px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">CB Edge starts at <span style="color:#219EBC;">$45/month.</span></div>
            </td>
          </tr>

          <!-- divider -->
          <tr><td style="padding:22px 32px 0 32px;"><div style="border-top:1px solid rgba(255,255,255,0.08);"></div></td></tr>

          <!-- WHAT'S INCLUDED -->
          <tr>
            <td style="padding:20px 32px 6px 32px;">
              <div style="font:800 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;margin-bottom:14px;">What's included</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${featureRow(FEATURES[0], FEATURES[1])}
                ${featureRow(FEATURES[2], FEATURES[3])}
                ${featureRow(FEATURES[4], FEATURES[5])}
                ${featureRow(FEATURES[6], FEATURES[7])}
                ${featureRow(FEATURES[8], "")}
              </table>
            </td>
          </tr>

          <!-- divider -->
          <tr><td style="padding:6px 32px 0 32px;"><div style="border-top:1px solid rgba(255,255,255,0.08);"></div></td></tr>

          <!-- PRICING CARDS -->
          <tr>
            <td style="padding:22px 24px 6px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td width="50%" style="padding:0 6px 0 8px;vertical-align:top;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(255,255,255,0.12);border-radius:12px;background:rgba(255,255,255,0.02);">
                    <tr><td style="padding:16px 16px 14px 16px;">
                      <div style="font:800 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.10em;text-transform:uppercase;color:#ffffff;">CB Edge · Monthly</div>
                      <div style="font:800 34px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:10px;">$45</div>
                      <div style="font:400 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;margin-top:2px;">per month</div>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr>
                        <td style="border:1px solid rgba(33,158,188,0.45);border-radius:8px;background:rgba(33,158,188,0.10);padding:8px 16px;">
                          <div style="font:700 10px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.12em;color:#219EBC;">CODE</div>
                          <div style="font:800 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.08em;color:#ffffff;margin-top:4px;">MONTH</div>
                        </td>
                      </tr></table>
                    </td></tr>
                  </table>
                </td>
                <td width="50%" style="padding:0 8px 0 6px;vertical-align:top;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.40);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                    <tr><td style="padding:16px 16px 14px 16px;">
                      <div style="font:800 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.10em;text-transform:uppercase;color:#ffffff;">CB Edge · Annual · Best value</div>
                      <div style="font:800 34px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:10px;">$500</div>
                      <div style="font:400 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;margin-top:2px;">per year</div>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr>
                        <td style="border:1px solid rgba(142,202,230,0.45);border-radius:8px;background:rgba(142,202,230,0.10);padding:8px 16px;">
                          <div style="font:700 10px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.12em;color:#8ECAE6;">CODE</div>
                          <div style="font:800 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.08em;color:#ffffff;margin-top:4px;">YEAR</div>
                        </td>
                      </tr></table>
                    </td></tr>
                  </table>
                </td>
              </tr></table>
            </td>
          </tr>

          <!-- tagline -->
          <tr>
            <td align="center" style="padding:18px 28px 4px 28px;">
              <div style="font:600 14px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#FB8501;">Built by a trader, for traders.</div>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:20px 28px 30px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:12px;background:#219EBC;">
                    <a href="${cta}" style="display:inline-block;padding:15px 38px;font:800 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:12px;">See the plans →</a>
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
