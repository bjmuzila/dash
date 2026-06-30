// Beta launch-update email for CB Edge.
//
// Returns email-client-safe HTML (table layout, all styles inline, no external
// CSS) matching the dashboard brand. Use from /admin/emails (paste the HTML).
//
// Brand palette mirrors components/shared/homeTheme.ts:
//   bg #05060A · panel #0D1119 · cyan #219EBC · accent text #8ECAE6

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const SIGN_IN_URL = `${SITE_URL}/home`;

export interface BetaLaunchEmailOpts {
  /** Recipient's first name, if known. Falls back to a generic greeting. */
  firstName?: string | null;
  /** Override the sign-in/CTA URL (defaults to the dashboard home). */
  ctaUrl?: string;
  /**
   * Recipient email. When provided, the footer renders a real tokenized
   * unsubscribe link. When sent via /admin/emails, leave this unset — the send
   * route appends its own per-recipient tokenized footer.
   */
  email?: string | null;
}

export const BETA_LAUNCH_SUBJECT = "CB Edge beta is live July 1, 9:30 AM ET";

/** Plain-text fallback for clients that don't render HTML. */
export function betaLaunchEmailText(opts: BetaLaunchEmailOpts = {}): string {
  const name = opts.firstName?.trim();
  const hi = name ? `Hi ${name},` : "Hi there,";
  const cta = opts.ctaUrl || SIGN_IN_URL;
  return [
    hi,
    "",
    "Quick update on the CB Edge beta.",
    "",
    "We hit a few hiccups in the final stretch, so we held the launch back to get it right. The biggest one: page load speed wasn't where I wanted it. CB Edge is a real-time dashboard, and if it doesn't feel instant, it isn't doing its job. I wasn't willing to ship it below my own standard.",
    "",
    "That's fixed, and we're going live:",
    "",
    "  Launch: Wednesday, July 1 at 9:30 AM ET (market open)",
    "",
    `Be ready at the open: ${cta}`,
    "",
    "Thanks for your patience — it's going to be worth it.",
    "",
    "— Bzila, CB Edge",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML beta-launch email. */
export function betaLaunchEmail(opts: BetaLaunchEmailOpts = {}): string {
  const name = opts.firstName?.trim();
  const hi = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
  const cta = escapeHtml(opts.ctaUrl || SIGN_IN_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(BETA_LAUNCH_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">We held the launch to fix load speed. CB Edge goes live July 1 at 9:30 AM ET.</div>
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
              <div style="font:800 23px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">A quick launch update</div>
              <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8ECAE6;margin-top:6px;">Worth the small wait.</div>
            </td>
          </tr>

          <!-- body copy -->
          <tr>
            <td style="padding:20px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:600 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">${hi}</p>
              <p style="margin:0 0 14px 0;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                I want to be straight with you. We hit a few <strong style="color:#8ECAE6;">hiccups</strong> in the final stretch, so I held the launch back to get it right.
              </p>
              <p style="margin:0 0 18px 0;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                The biggest one: <strong style="color:#219EBC;">page load speed</strong> wasn't where I wanted it. CB Edge is a real-time dashboard — if it doesn't feel instant, it isn't doing its job. I wasn't willing to ship it below my own standard. That's now fixed.
              </p>
            </td>
          </tr>

          <!-- launch callout -->
          <tr>
            <td style="padding:0 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:#8ECAE6;">Beta goes live</div>
                    <div style="font:800 21px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:6px;">Wednesday, July 1 — 9:30 AM ET</div>
                    <div style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#aeb9c4;margin-top:4px;">Right at the market open. Be ready.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:18px 32px 28px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:10px;background:#219EBC;">
                    <a href="${cta}" style="display:inline-block;padding:13px 30px;font:700 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:10px;">Open the dashboard →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- sign-off note -->
          <tr>
            <td style="padding:0 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:18px;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                Thanks for your patience while we got this right — it's going to be worth it. See you at the open.<br><br>
                <span style="color:#8ECAE6;font-weight:600;">— Bzila, CB Edge</span>
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}
