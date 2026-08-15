// Subscriber ask: the phone build (/app/m/*) is getting heavy traffic, but the
// owner doesn't trade from a phone - so the roadmap for it has to come from the
// people who do. Asks for two things: which pages to add, and what to adjust.
// Personal founder tone, signed "- Bzila".
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const MOBILE_URL = `${SITE_URL}/app/m/gex`;
const REPLY_TO = "hello@cbedge.net";

export interface MobileFeedbackOpts {
  /** Recipient's first name, if known. Falls back to a generic greeting. */
  firstName?: string | null;
  /** Override the CTA URL (defaults to the phone build's GEX tab). */
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

export const MOBILE_FEEDBACK_SUBJECT = "The mobile site — tell me what to add";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** The six pages that already exist on the phone build. */
const LIVE_TABS = [
  "Gamma Exposure",
  "GEX Heatmap",
  "ES Candles",
  "Option Chain",
  "Estimated Moves",
  "Economic Calendar",
];

/** Desktop pages with no phone build yet — the obvious things to vote for. */
const CANDIDATES = ["Options Flow", "Scanner", "ICT", "Multi Greek", "Traders Dashboard"];

/** Plain-text fallback. */
export function mobileFeedbackText(opts: MobileFeedbackOpts = {}): string {
  const name = opts.firstName?.trim();
  const hi = name ? `Hi ${name},` : "Hi there,";
  const cta = opts.ctaUrl || MOBILE_URL;
  return [
    hi,
    "",
    "Short one, and it's a favor.",
    "",
    "A lot of you are on CB Edge from your phone. The traffic numbers on the mobile build are higher than anything I expected - it is genuinely one of the most visited parts of the site.",
    "",
    "Here's my problem: I don't trade from my phone. I'm on three monitors all day. So I can build the mobile side, but I can't tell you what's missing from it, because I'm never the one standing in line somewhere trying to check gamma on a 6-inch screen. You are.",
    "",
    "ON THE PHONE TODAY",
    LIVE_TABS.map((t) => `  - ${t}`).join("\n"),
    "",
    "NOT ON THE PHONE YET",
    CANDIDATES.map((t) => `  - ${t}`).join("\n"),
    "",
    "TWO QUESTIONS",
    "",
    "1. What page do you want added next? Pick from the list above, or name something that isn't on it.",
    "2. What's annoying about the pages that are already there? Text too small, chart too short, a number you have to pinch-zoom to read, a tab you never use taking up space - that level of detail is exactly what I need.",
    "",
    `Just hit reply. It comes straight to me (${REPLY_TO}). One sentence is plenty - I'd rather have fifty one-liners than five essays.`,
    "",
    `The mobile build: ${cta}`,
    "",
    "I'll work through whatever comes back and start building. Thanks for helping me point it in the right direction.",
    "",
    "— Bzila, founder of CB Edge",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML subscriber feedback request. */
export function mobileFeedbackEmail(opts: MobileFeedbackOpts = {}): string {
  const name = opts.firstName?.trim();
  const hi = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
  const cta = escapeHtml(opts.ctaUrl || MOBILE_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  const pill = (label: string, live: boolean) => `
    <span style="display:inline-block;margin:0 6px 8px 0;padding:7px 13px;border-radius:999px;font:700 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;${
      live
        ? "background:rgba(33,158,188,0.14);border:1px solid rgba(33,158,188,0.45);color:#8ECAE6;"
        : "background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.22);color:#9fb3c8;"
    }">${escapeHtml(label)}</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(MOBILE_FEEDBACK_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">The phone build is one of the most visited parts of the site — and I don't trade from a phone. Tell me what to add and what to fix.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <!-- accent bar -->
          <tr><td style="height:3px;background:linear-gradient(90deg,rgba(33,158,188,0) 0%,#219EBC 50%,rgba(33,158,188,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- logo -->
          <tr>
            <td align="center" style="padding:28px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="220" style="display:block;width:220px;max-width:70%;height:auto;border:0;">
            </td>
          </tr>

          <!-- heading -->
          <tr>
            <td align="center" style="padding:18px 32px 0 32px;">
              <div style="font:800 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.18em;text-transform:uppercase;color:#8ECAE6;">Your call</div>
              <div style="font:900 30px/1.15 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:12px;">The mobile site — <span style="color:#219EBC;">tell me what to add</span></div>
            </td>
          </tr>

          <!-- body copy -->
          <tr>
            <td style="padding:22px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:600 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">${hi}</p>
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                Short one, and it's a favor. A lot of you are on CB Edge from your phone — the traffic on the mobile build is <strong style="color:#8ECAE6;">higher than anything I expected</strong>, and it's now one of the most visited parts of the site.
              </p>
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                Here's my problem: I don't trade from my phone. I'm on three monitors all day. So I can keep building the mobile side — but I can't tell you what's missing from it, because I'm never the one checking gamma on a six-inch screen between meetings. You are.
              </p>
            </td>
          </tr>

          <!-- PAGES CARD -->
          <tr>
            <td style="padding:10px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <tr>
                  <td style="padding:16px 20px;">
                    <div style="font:800 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#8ECAE6;padding-bottom:12px;">On the phone today</div>
                    <div>${LIVE_TABS.map((t) => pill(t, true)).join("")}</div>
                    <div style="border-top:1px solid rgba(255,255,255,0.08);margin:8px 0 14px 0;"></div>
                    <div style="font:800 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#9fb3c8;padding-bottom:12px;">Not on the phone yet</div>
                    <div>${CANDIDATES.map((t) => pill(t, false)).join("")}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- the two questions -->
          <tr>
            <td style="padding:22px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="30" valign="top" style="font:900 16px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#219EBC;">1.</td>
                  <td style="font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;padding-bottom:12px;">
                    <strong style="color:#ffffff;">What page should I add next?</strong> Pick one off the list above, or name something that isn't on it at all.
                  </td>
                </tr>
                <tr>
                  <td width="30" valign="top" style="font:900 16px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#219EBC;">2.</td>
                  <td style="font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                    <strong style="color:#ffffff;">What's annoying about the pages already there?</strong> Text too small, chart too short, a number you have to pinch-zoom to read, a tab you never touch eating space — that level of detail is exactly what I need.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- reply nudge -->
          <tr>
            <td style="padding:18px 32px 0 32px;">
              <p style="margin:0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                Just hit reply — it comes straight to me. <strong style="color:#8ECAE6;">One sentence is plenty.</strong> I'd rather have fifty one-liners than five essays.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:22px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:10px;background:#219EBC;">
                    <a href="mailto:${REPLY_TO}?subject=${encodeURIComponent("Mobile site feedback")}" style="display:inline-block;padding:14px 32px;font:800 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:10px;">Send me your two answers →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 24px 32px;">
              <a href="${cta}" style="font:600 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8ECAE6;text-decoration:underline;">Open the mobile build on your phone</a>
            </td>
          </tr>

          <!-- sign-off -->
          <tr>
            <td style="padding:0 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:18px;font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                I'll work through everything that comes back and start building. Thanks for pointing it in the right direction.<br><br>
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
                &nbsp;&middot;&nbsp;
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
