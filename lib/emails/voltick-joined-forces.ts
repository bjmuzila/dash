// "CB Edge has joined forces with Voltick" — short partnership broadcast.
//
// Sent from the owner composer at owner.cbedge.net (Emails page). MARKETING
// broadcast, so it keeps the tokenized unsubscribe footer and the
// {{UNSUBSCRIBE_URL}} placeholder. Do not remove it.
//
// Palette: CB Edge shell (bg #05060A · panel #0D1119 · cyan #219EBC · accent
// #8ECAE6 · body #d4dde6) with a Voltick block inside (ink #0a0d10 · Volt Blue
// #2f6bff · accent #6aa0ff · paper #e7ece9). Voltick rules: no grey text in the
// Voltick block and NO EM-DASHES anywhere a reader sees (comments exempt).
//
// The only call to action is Brandon's referral link, voltick.io/bzila.

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";
import { brandLogoUrl } from "@/lib/brand";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = brandLogoUrl(SITE_URL);
// Always the /bzila path. Override per-run with joinUrl rather than editing this.
const VOLTICK_URL = "https://voltick.io/bzila";
const VOLTICK_URL_LABEL = "voltick.io/bzila";

export const VOLTICK_JOINED_FORCES_SUBJECT = "CB Edge has joined forces with Voltick.io";

export interface VoltickJoinedForcesOpts {
  /** Where the join button points. Defaults to https://voltick.io/bzila. */
  joinUrl?: string | null;
  /** Recipient email. When set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** What joining gets you, in one place so HTML and text cannot drift. */
const VOLTICK_POINTS: { title: string; note: string }[] = [
  { title: "1,000+ tickers.", note: "Dealer positioning across the whole board, not just SPX." },
  { title: "The levels that matter.", note: "Where market makers are forced to hedge, named and mapped." },
  { title: "Built by traders.", note: "Two platforms, one team, one bigger push forward." },
];

/** Plain-text fallback. */
export function voltickJoinedForcesText(opts: VoltickJoinedForcesOpts = {}): string {
  const url = opts.joinUrl || VOLTICK_URL;
  return [
    "CB EDGE",
    "",
    "CB EDGE HAS JOINED FORCES WITH VOLTICK.IO",
    "",
    "Big news: CB Edge and Voltick are teaming up.",
    "",
    "Instead of two platforms splitting the same effort, we are putting it all",
    "into one. Everything I would have built next is going into Voltick, and",
    "you get the benefit of both.",
    "",
    "WHAT YOU GET",
    "",
    ...VOLTICK_POINTS.flatMap((p) => [`  ${p.title}`, `    ${p.note}`]),
    "",
    "JOIN HERE",
    "",
    `  ${url}`,
    "",
    "Use that link (voltick.io/bzila) so you come in as part of the CB Edge crew.",
    "",
    "Questions? Hit reply. I read every one.",
    "",
    "Bzila, founder of CB Edge",
    "",
    "--",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
    "Market analytics, not financial advice.",
  ].join("\n");
}

/** Branded HTML announcement. */
export function voltickJoinedForcesEmail(opts: VoltickJoinedForcesOpts = {}): string {
  const url = escapeHtml(opts.joinUrl || VOLTICK_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  const sans = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
  const mono = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

  const pointRows = VOLTICK_POINTS.map(
    (p) => `
                      <tr>
                        <td valign="top" width="24" style="font:700 15px/1.6 ${sans};color:#6aa0ff;">&bull;</td>
                        <td valign="top" style="font:400 14px/1.7 ${sans};color:#e7ece9;padding-bottom:10px;">
                          <strong style="color:#ffffff;">${escapeHtml(p.title)}</strong> ${escapeHtml(p.note)}
                        </td>
                      </tr>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(VOLTICK_JOINED_FORCES_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">CB Edge and Voltick are teaming up. Join at voltick.io/bzila.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <!-- accent bar: cyan into volt blue -->
          <tr><td style="height:3px;background:linear-gradient(90deg,#219EBC 0%,#4d8cff 55%,#2f6bff 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- logo -->
          <tr>
            <td align="center" style="padding:28px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="240" style="display:block;width:240px;max-width:60%;height:auto;border:0;">
            </td>
          </tr>

          <!-- PILL -->
          <tr>
            <td align="center" style="padding:22px 28px 0 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(47,107,255,0.55);border-radius:999px;background:rgba(47,107,255,0.12);">
                <tr>
                  <td style="padding:9px 20px;font:800 12px/1 ${sans};letter-spacing:0.16em;text-transform:uppercase;color:#6aa0ff;">
                    CB Edge &times; Voltick
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td align="center" style="padding:18px 28px 0 28px;">
              <div style="font:900 30px/1.16 ${sans};color:#ffffff;letter-spacing:-0.01em;">CB Edge has joined forces with <span style="color:#6aa0ff;">Voltick.io</span><span style="color:#2f6bff;">.</span></div>
              <div style="font:400 15px/1.7 ${sans};color:#d4dde6;margin-top:14px;">
                Instead of two platforms splitting the same effort, we are putting it all into one.
                Everything I would have built next is going into Voltick, and you get the benefit of both.
              </div>
            </td>
          </tr>

          <!-- VOLTICK BLOCK (Voltick palette) -->
          <tr>
            <td style="padding:26px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #1e2630;border-radius:14px;background:#0a0d10;overflow:hidden;">
                <tr><td style="height:2px;background:linear-gradient(90deg,rgba(47,107,255,0) 0%,#2f6bff 50%,rgba(47,107,255,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td style="padding:22px 20px 0 20px;" align="center">
                    <div style="font:800 13px/1 ${mono};letter-spacing:0.22em;color:#6aa0ff;">VOLTICK</div>
                    <div style="padding-top:8px;font:400 12px/1 ${sans};color:#e7ece9;">Know your levels.</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px 20px 12px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${pointRows}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:28px 28px 0 28px;">
              <div style="font:700 11px/1 ${sans};letter-spacing:0.14em;text-transform:uppercase;color:#6aa0ff;padding-bottom:14px;">Join the CB Edge crew on Voltick</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:12px;background:#2f6bff;">
                    <a href="${url}" style="display:block;padding:17px 24px;font:900 16px/1 ${sans};letter-spacing:0.04em;text-transform:uppercase;color:#e7ece9;text-decoration:none;border-radius:12px;">Join at ${VOLTICK_URL_LABEL}</a>
                  </td>
                </tr>
              </table>
              <div style="font:400 13px/1.6 ${sans};color:#d4dde6;padding-top:12px;">
                Use <a href="${url}" style="color:#6aa0ff;font-weight:700;text-decoration:none;">${VOLTICK_URL_LABEL}</a> so you come in as part of the CB Edge crew.
              </div>
            </td>
          </tr>

          <!-- SIGN-OFF -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:18px;font:400 14px/1.75 ${sans};color:#d4dde6;text-align:center;">
                Questions? Hit reply. I read every one.<br>
                <span style="color:#8ECAE6;font-weight:600;">Bzila, founder of CB Edge</span>
              </div>
            </td>
          </tr>

          <tr><td style="height:28px;font-size:0;line-height:0;">&nbsp;</td></tr>
        </table>

        <!-- footer -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td align="center" style="padding:18px 32px;">
              <div style="font:400 11px/1.6 ${sans};color:#6b7d8f;">
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
