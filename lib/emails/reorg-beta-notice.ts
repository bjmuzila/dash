// Expectation-setting email to current subscribers: a lot of reorganization
// is coming, and that's normal — new pages exist first to start tracking data,
// then get tuned once real data comes in. Everything in Scanner/Test is beta
// by definition. Personal founder tone (matches maintenance.ts /
// founder-thankyou.ts), signed "— Bzila".
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const SIGN_IN_URL = `${SITE_URL}/home`;

export interface ReorgBetaNoticeOpts {
  /** Recipient's first name, if known. Falls back to a generic greeting. */
  firstName?: string | null;
  /** Override the CTA URL (defaults to the dashboard home). */
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

export const REORG_BETA_NOTICE_SUBJECT = "Heads up: expect a lot of reorganization";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** Plain-text fallback. */
export function reorgBetaNoticeText(opts: ReorgBetaNoticeOpts = {}): string {
  const name = opts.firstName?.trim();
  const hi = name ? `Hi ${name},` : "Hi there,";
  const cta = opts.ctaUrl || SIGN_IN_URL;
  return [
    hi,
    "",
    "Quick heads up — you're going to see a lot of reorganization on the dashboard over the coming weeks. Wanted to explain why, so it doesn't look like the platform can't sit still.",
    "",
    "Here's how I actually build this thing: when I add a new page, the main reason is to start tracking and recording whatever data it needs. The page itself isn't the finished product — it's the data collector. Once enough real data comes in, I go back and adjust it based on what the data actually shows.",
    "",
    "So anything you see in Scanner or Test is exactly that: beta, on purpose, and always getting reworked as more data arrives. It's not instability for its own sake — it's the only honest way to tune something against real market behavior instead of guessing up front.",
    "",
    "One direct note while I'm at it: data collection was actually down for a stretch overnight because of a feed error on our end. It's fixed and fully back up now — flagging it directly rather than letting a gap in the data pass unmentioned.",
    "",
    "Long term this means the platform gets sharper the longer you use it. Short term it means some pages will look different next week than they do today.",
    "",
    `Check out what's live now: ${cta}`,
    "",
    "Thanks for being along for this.",
    "",
    "— Bzila, founder of CB Edge",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML reorg/beta-notice email. */
export function reorgBetaNoticeEmail(opts: ReorgBetaNoticeOpts = {}): string {
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
<title>${escapeHtml(REORG_BETA_NOTICE_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Why Scanner and Test keep changing — and why that's the plan, not a problem.</div>
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
              <div style="font:800 22px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">Expect a lot of reorganization</div>
              <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8ECAE6;margin-top:6px;">It's the plan, not a problem.</div>
            </td>
          </tr>

          <!-- body copy -->
          <tr>
            <td style="padding:20px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:600 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">${hi}</p>
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                Quick heads up — you're going to see a lot of reorganization on the dashboard over the coming weeks. Wanted to explain why, so it doesn't look like the platform can't sit still.
              </p>
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                Here's how I actually build this: when I add a new page, the main reason is to <strong style="color:#8ECAE6;">start tracking and recording</strong> whatever data it needs. The page itself isn't the finished product — it's the data collector. Once enough real data comes in, I go back and adjust it based on what the data actually shows.
              </p>
            </td>
          </tr>

          <!-- beta callout -->
          <tr>
            <td style="padding:6px 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:#8ECAE6;">Scanner &amp; Test = beta, always</div>
                    <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:8px;">
                      Anything you see in <strong style="color:#ffffff;">Scanner</strong> or <strong style="color:#ffffff;">Test</strong> is exactly that: beta on purpose, always getting reworked as more data arrives. Not instability for its own sake — it's the only honest way to tune something against real market behavior instead of guessing up front.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- incident note -->
          <tr>
            <td style="padding:6px 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(251,133,1,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(251,133,1,0.10),rgba(251,133,1,0.02));">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:#FB8501;">One direct note</div>
                    <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:8px;">
                      Data collection was actually down for a stretch overnight because of a feed error on our end. It's <strong style="color:#ffffff;">fixed and fully back up</strong> now — flagging it directly rather than letting a gap in the data pass unmentioned.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- payoff line -->
          <tr>
            <td style="padding:14px 32px 4px 32px;">
              <p style="margin:0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                Long term, this means the platform gets sharper the longer you use it. Short term, it means some pages will look different next week than they do today.
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

          <!-- sign-off -->
          <tr>
            <td style="padding:0 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:18px;font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                Thanks for being along for this.<br><br>
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
