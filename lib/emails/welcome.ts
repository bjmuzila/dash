// Beta welcome email for new CB Edge signups.
//
// Returns email-client-safe HTML (table layout, all styles inline, no external
// CSS) matching the dashboard brand. Use from /admin/emails (paste the HTML) or
// later from a Clerk user.created webhook by calling welcomeEmail({ ... }).
//
// Brand palette mirrors components/shared/homeTheme.ts:
//   bg #05060A · panel #0D1119 · cyan #219EBC · accent text #8ECAE6

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const SIGN_IN_URL = `${SITE_URL}/home`;

export interface WelcomeEmailOpts {
  /** Recipient's first name, if known. Falls back to a generic greeting. */
  firstName?: string | null;
  /** Override the sign-in/CTA URL (defaults to the dashboard home). */
  ctaUrl?: string;
  /**
   * Recipient email. When provided (webhook path), the footer renders a real
   * tokenized unsubscribe link. When sent via /admin/emails, leave this unset —
   * the send route appends its own per-recipient tokenized footer.
   */
  email?: string | null;
}

export const WELCOME_SUBJECT = "Welcome to the CB Edge beta 🎉";

/** Plain-text fallback for clients that don't render HTML. */
export function welcomeEmailText(opts: WelcomeEmailOpts = {}): string {
  const name = opts.firstName?.trim();
  const hi = name ? `Hi ${name},` : "Hi there,";
  const cta = opts.ctaUrl || SIGN_IN_URL;
  return [
    hi,
    "",
    "Welcome to the CB Edge beta — you're in.",
    "",
    "CB Edge is a real-time options & gamma-exposure dashboard for index traders. Inside you'll find:",
    "  • Live GEX surfaces, call/put walls, and flip levels",
    "  • Estimated Moves and weekly customer levels",
    "  • ES candle heatmaps and net-premium flow",
    "  • A morning Traders Dashboard with AI market overview",
    "",
    `Jump in: ${cta}`,
    "",
    "We're still in beta, so things move fast and your feedback shapes what we build next — there's a Feedback page right in the app.",
    "",
    "— The CB Edge team",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML welcome email. */
export function welcomeEmail(opts: WelcomeEmailOpts = {}): string {
  const name = opts.firstName?.trim();
  const hi = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
  const cta = escapeHtml(opts.ctaUrl || SIGN_IN_URL);
  // Always render an unsubscribe link. Real tokenized URL when the recipient is
  // known (webhook path); otherwise the {{UNSUBSCRIBE_URL}} placeholder, which
  // the send route swaps per recipient. Guarantees one link, never zero.
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  const feature = (title: string, desc: string) => `
    <tr>
      <td style="padding:0 0 14px 0;">
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
<title>${escapeHtml(WELCOME_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">You're in. Your live options &amp; gamma dashboard is ready.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <!-- accent bar -->
          <tr><td style="height:3px;background:linear-gradient(90deg,rgba(33,158,188,0) 0%,#219EBC 50%,rgba(33,158,188,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- logo (larger; tight to heading via negative-feel small bottom pad) -->
          <tr>
            <td align="center" style="padding:28px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="260" style="display:block;width:260px;max-width:88%;height:auto;border:0;">
            </td>
          </tr>

          <!-- heading -->
          <tr>
            <td align="center" style="padding:0 32px 4px 32px;">
              <div style="font:800 23px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">Welcome to the beta 🎉</div>
              <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8ECAE6;margin-top:6px;">You're in — your edge starts here.</div>
            </td>
          </tr>

          <!-- body copy -->
          <tr>
            <td style="padding:20px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:600 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">${hi}</p>
              <p style="margin:0 0 18px 0;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                Thanks for joining the <strong style="color:#219EBC;">CB Edge</strong> beta. It's a <strong style="color:#8ECAE6;">real-time options &amp; gamma-exposure</strong> dashboard built for index traders. Here's what's waiting inside:
              </p>
            </td>
          </tr>

          <!-- features -->
          <tr>
            <td style="padding:0 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${feature("Live GEX &amp; levels", "Gamma-exposure surfaces, call/put walls, and flip levels updating in real time.")}
                ${feature("Estimated Moves", "Weekly customer levels and expected-move zones across the major indices.")}
                ${feature("ES candles &amp; flow", "5-minute ES heatmaps with net-premium flow and live order tape.")}
                ${feature("Morning briefing", "A Traders Dashboard with futures, key drivers, and a 7am AI market overview.")}
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:16px 32px 28px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:10px;background:#219EBC;">
                    <a href="${cta}" style="display:inline-block;padding:13px 30px;font:700 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:10px;">Open the dashboard →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- feedback note -->
          <tr>
            <td style="padding:0 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:18px;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                We're still in beta — things move fast, and your feedback shapes what we build next. There's a <strong style="color:#8ECAE6;">Feedback</strong> page right inside the app. We read every note.
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
