// Founder thank-you welcome email for new CB Edge signups.
//
// A warm, personal note from Bzila sent automatically when someone joins.
// Returns email-client-safe HTML (table layout, all styles inline, no external
// CSS) matching the dashboard brand.
//
// Brand palette mirrors components/shared/homeTheme.ts:
//   bg #05060A · panel #0D1119 · cyan #219EBC · accent text #8ECAE6

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const SIGN_IN_URL = `${SITE_URL}/home`;

export interface FounderThankYouOpts {
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

export const FOUNDER_THANKYOU_SUBJECT = "Thank you — this is a dream come true";

/** Plain-text fallback for clients that don't render HTML. */
export function founderThankYouText(opts: FounderThankYouOpts = {}): string {
  const name = opts.firstName?.trim();
  const hi = name ? `Hi ${name},` : "Hi there,";
  const cta = opts.ctaUrl || SIGN_IN_URL;
  return [
    hi,
    "",
    "I wanted to thank you personally for joining CB Edge — it genuinely means the world to me.",
    "",
    "I built this against all the odds. There were plenty of nights it would have been easier to walk away, and plenty of reasons to. But seeing real traders sign up makes every one of those late nights worth it. This is, honestly, a dream come true.",
    "",
    "If you're wondering where the name comes from: CB is for my two sons, Conor and Brennan. They're the reason I kept going, and their initials are baked into everything I'm building here.",
    "",
    "CB Edge is a real-time options and gamma-exposure dashboard built for index traders — live GEX surfaces, call/put walls, Estimated Moves, ES candle heatmaps, net-premium flow, and a morning briefing with an AI market overview. It's all in there waiting for you.",
    "",
    `Jump in whenever you're ready: ${cta}`,
    "",
    "We're still in beta, so things move fast and your feedback genuinely shapes what gets built next — there's a Feedback page right inside the app, and I read every single note.",
    "",
    "Thank you for being here. Let's get you an edge.",
    "",
    "— Bzila, founder of CB Edge",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML founder thank-you email. */
export function founderThankYouEmail(opts: FounderThankYouOpts = {}): string {
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
<title>${escapeHtml(FOUNDER_THANKYOU_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">A personal thank-you for joining CB Edge — built against the odds, named for my two sons.</div>
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
              <div style="font:800 23px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">Thank you for being here</div>
              <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8ECAE6;margin-top:6px;">A note from me to you.</div>
            </td>
          </tr>

          <!-- body copy -->
          <tr>
            <td style="padding:20px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:600 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">${hi}</p>
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                I wanted to thank you <strong style="color:#8ECAE6;">personally</strong> for joining <strong style="color:#219EBC;">CB Edge</strong>. It genuinely means the world to me.
              </p>
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                I built this <strong style="color:#8ECAE6;">against all the odds</strong>. There were plenty of nights it would've been easier to walk away — and plenty of reasons to. But seeing real traders sign up makes every one of those late nights worth it. This is, honestly, a <strong style="color:#8ECAE6;">dream come true</strong>.
              </p>
            </td>
          </tr>

          <!-- name origin callout -->
          <tr>
            <td style="padding:6px 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:#8ECAE6;">Where the name comes from</div>
                    <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:8px;">
                      The <strong style="color:#219EBC;">CB</strong> is for my two sons, <strong style="color:#ffffff;">Conor</strong> and <strong style="color:#ffffff;">Brennan</strong>. They're the reason I kept going — and their initials are baked into everything I'm building here.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- what's inside -->
          <tr>
            <td style="padding:14px 32px 4px 32px;">
              <p style="margin:0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                CB Edge is a <strong style="color:#8ECAE6;">real-time options &amp; gamma-exposure</strong> dashboard for index traders — live GEX surfaces, call/put walls and flip levels, Estimated Moves, ES candle heatmaps, net-premium flow, and a morning briefing with an AI market overview. It's all in there, waiting for you.
              </p>
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

          <!-- feedback + sign-off -->
          <tr>
            <td style="padding:0 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:18px;font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                We're still in beta — things move fast, and your feedback genuinely shapes what gets built next. There's a <strong style="color:#8ECAE6;">Feedback</strong> page right inside the app, and I read every single note.<br><br>
                Thank you for being here. Let's get you an edge.<br><br>
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}
