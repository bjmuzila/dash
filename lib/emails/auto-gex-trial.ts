// Top-of-funnel feature-pitch email: auto-plotted GEX levels (call wall, put
// wall, flip) on the live chart — "you don't have to think about it" — with
// a big 2-day free trial CTA. Embeds a REAL screenshot of the live SPX GEX
// chart (public/717.png — ES 5m candles + Call Wall/Put Wall/Flip/CB levels),
// not a stylized recreation.
//
// IMPORTANT — before sending: the "2 days free" claim only holds if
// trial_period_days is actually set on the live Stripe Price(s). Checkout
// (app/api/stripe/checkout/route.ts) intentionally does NOT set a trial in
// code — it's applied automatically from whatever the Price has configured
// in the Stripe dashboard. Confirm that's set to 2 days before this goes out,
// or the CTA promises something checkout won't deliver.
//
// No personal name — signed generically. Email-client-safe HTML (table
// layout, inline styles), same brand shell as the other emails.
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6 ·
// gain-blue #38BDF8 · loss-red #EF4444

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";
import { brandLogoUrl } from "@/lib/brand";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = brandLogoUrl(SITE_URL);
const PRICING_URL = `${SITE_URL}/pricing`;
const CHART_SHOT_URL = `${SITE_URL}/717.png`;

export interface AutoGexTrialOpts {
  /** Override the CTA URL (defaults to /pricing). */
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

export const AUTO_GEX_TRIAL_SUBJECT = "Auto GEX. Zero setup. 2 days free.";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** Plain-text fallback. */
export function autoGexTrialText(opts: AutoGexTrialOpts = {}): string {
  const cta = opts.ctaUrl || PRICING_URL;
  return [
    "AUTO GEX. ON EVERY CHART. ZERO SETUP.",
    "",
    "Call wall, put wall, gamma flip, and GEX by strike — plotted live, automatically. No indicators to configure, no levels to draw by hand. You don't have to think about it, just trade the lines.",
    "",
    "CALL WALL 7,539.31  ·  FLIP 7,499.31  ·  PUT WALL 7,499.00",
    "",
    "• Call wall, put wall & flip plotted live on every chart, no setup",
    "• GEX by strike, recalculated every candle",
    "• Works on SPX, ES, and every major ticker on the platform",
    "• Nothing to configure — open a chart and the levels are already there",
    "",
    "TRY IT FREE FOR 2 DAYS. No commitment. Cancel anytime.",
    "",
    `Start your free trial: ${cta}`,
    "",
    "— The CB Edge Team",
    "",
    "cbedge.net · not financial advice",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML feature-pitch + trial email. */
export function autoGexTrialEmail(opts: AutoGexTrialOpts = {}): string {
  const cta = escapeHtml(opts.ctaUrl || PRICING_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(AUTO_GEX_TRIAL_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Call wall, put wall, flip, and GEX by strike — plotted automatically on every chart. Try it free for 2 days.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <!-- accent bar -->
          <tr><td style="height:4px;background:linear-gradient(90deg,rgba(56,189,248,0) 0%,#38BDF8 50%,rgba(56,189,248,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- logo -->
          <tr>
            <td align="center" style="padding:30px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="260" style="display:block;width:260px;max-width:88%;height:auto;border:0;">
            </td>
          </tr>

          <!-- headline -->
          <tr>
            <td align="center" style="padding:22px 28px 0 28px;">
              <div style="font:800 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.20em;text-transform:uppercase;color:#8ECAE6;">Auto gex · every chart · zero setup</div>
              <div style="font:900 32px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:12px;letter-spacing:-0.01em;">The levels are already <span style="color:#38BDF8;">on the chart.</span></div>
              <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:12px;max-width:460px;">
                Call wall, put wall, gamma flip, and GEX by strike — plotted live, automatically. No indicators to configure, nothing to draw by hand. You don't have to think about it, just trade the lines.
              </div>
            </td>
          </tr>

          <!-- real product screenshot -->
          <tr>
            <td style="padding:24px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(255,255,255,0.10);border-radius:14px;background:#000000;overflow:hidden;">
                <tr>
                  <td style="padding:0;line-height:0;font-size:0;">
                    <img src="${CHART_SHOT_URL}" alt="CB Edge SPX GEX chart — Call Wall, Put Wall and Flip plotted live on ES 5m candles" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:0;">
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- feature bullets -->
          <tr>
            <td style="padding:22px 32px 4px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="padding:0 0 10px 0;"><span style="color:#38BDF8;">●</span>&nbsp;&nbsp;<span style="font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">Call wall, put wall &amp; gamma flip plotted live on every chart — no setup</span></td></tr>
                <tr><td style="padding:0 0 10px 0;"><span style="color:#38BDF8;">●</span>&nbsp;&nbsp;<span style="font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">GEX by strike, recalculated every candle</span></td></tr>
                <tr><td style="padding:0 0 10px 0;"><span style="color:#38BDF8;">●</span>&nbsp;&nbsp;<span style="font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">Works on SPX, ES, and every major ticker on the platform</span></td></tr>
                <tr><td style="padding:0 0 4px 0;"><span style="color:#38BDF8;">●</span>&nbsp;&nbsp;<span style="font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">Nothing to configure — open a chart and the levels are already there</span></td></tr>
              </table>
            </td>
          </tr>

          <!-- BIG TRIAL CTA -->
          <tr>
            <td align="center" style="padding:26px 28px 8px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(56,189,248,0.35);border-radius:16px;background:radial-gradient(circle at 50% 0%,rgba(56,189,248,0.16) 0%,transparent 70%),rgba(56,189,248,0.04);">
                <tr>
                  <td align="center" style="padding:28px 20px;">
                    <div style="font:700 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;">Try it yourself</div>
                    <div style="font:900 40px/1.05 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:12px;letter-spacing:-0.02em;">2 days free</div>
                    <div style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;margin-top:8px;">No commitment. Cancel anytime.</div>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;"><tr>
                      <td align="center" style="border-radius:12px;background:#219EBC;">
                        <a href="${cta}" style="display:inline-block;padding:16px 44px;font:800 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:12px;">Start my free trial →</a>
                      </td>
                    </tr></table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- sign-off -->
          <tr>
            <td align="center" style="padding:18px 28px 30px 28px;">
              <div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;">— The CB Edge Team</div>
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
