// "CB Edge isn't stopping" + the VOLTICK75 lifetime code — subscriber broadcast.
//
// Goes to the Subscribers audience from the owner composer at owner.cbedge.net
// (Emails page). MARKETING broadcast, so it keeps the tokenized unsubscribe
// footer and the {{UNSUBSCRIBE_URL}} placeholder. Do not remove it.
//
// THE MESSAGE, in order:
//   1. CB Edge is NOT stopping. Brandon still builds it and uses it every day
//      for his own trading. The only change is that it cannot take NEW customers.
//   2. For anyone who wants more: Voltick, code voltick75 = 75% off the monthly
//      subscription FOR LIFE. $22/mo for an $89/mo service that is going up.
//   3. Join through voltick.io/bzila (the referral link, never a bare domain).
//
// Palette follows voltick-merger.ts: CB Edge shell (bg #05060A · panel #0D1119 ·
// cyan #219EBC · accent #8ECAE6 · body #d4dde6), Voltick block inside it (ink
// #0a0d10 · Volt Blue #2f6bff · accent #6aa0ff · paper #e7ece9 · quiet #c0c5c3).
// Voltick rule: NO EM-DASHES anywhere a reader sees (code comments exempt).
//
// The code is printed exactly as Brandon gave it ("voltick75"). Change it in
// VOLTICK_CODE only, so the HTML and text versions cannot drift.

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";
import { brandLogoUrl } from "@/lib/brand";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = brandLogoUrl(SITE_URL);

const VOLTICK_JOIN_URL = "https://voltick.io/bzila";
const VOLTICK_JOIN_LABEL = "voltick.io/bzila";
const VOLTICK_CODE = "voltick75";
const PRICE_FULL = "$89";
const PRICE_WITH_CODE = "$22";

export const VOLTICK75_SUBSCRIBERS_SUBJECT = "CB Edge isn't stopping (plus 75% off Voltick for life)";

export interface Voltick75SubscribersOpts {
  /** Recipient email. When set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** The CB Edge status, in one place so HTML and text cannot drift. */
const CBEDGE_FACTS: { title: string; note: string }[] = [
  { title: "CB Edge is not stopping.", note: "It stays up and keeps running." },
  { title: "I use it every day.", note: "It is still my own daily trading tool, and I am still building it." },
  { title: "New customers are closed.", note: "That is the only thing that changed. I just can't take on new members." },
];

/** What the code gets, in one place so HTML and text cannot drift. */
const OFFER_FACTS: { stat: string; note: string }[] = [
  { stat: "75% off", note: "the monthly subscription" },
  { stat: "Lifetime", note: "locked for as long as you stay" },
  { stat: PRICE_WITH_CODE + "/mo", note: `instead of ${PRICE_FULL}/mo` },
];

/** Plain-text fallback. */
export function voltick75SubscribersText(opts: Voltick75SubscribersOpts = {}): string {
  return [
    "CB EDGE",
    "",
    "CB EDGE ISN'T STOPPING",
    "",
    "Quick note so there's no confusion.",
    "",
    ...CBEDGE_FACTS.flatMap((f) => [`  ${f.title}`, `    ${f.note}`]),
    "",
    "I'm still in it every morning, still fixing things, still adding things.",
    "I just can't open the doors to new customers right now.",
    "",
    "WANT MORE? VOLTICK, 75% OFF FOR LIFE",
    "",
    ...OFFER_FACTS.map((f) => `  ${f.stat}  ${f.note}`),
    "",
    `Code: ${VOLTICK_CODE}`,
    `Join: ${VOLTICK_JOIN_URL}`,
    "",
    `That is ${PRICE_WITH_CODE} a month for an ${PRICE_FULL} service, and the price is going up.`,
    "The discount is locked in for life, so the earlier you lock it, the better.",
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

/** Branded HTML broadcast. */
export function voltick75SubscribersEmail(opts: Voltick75SubscribersOpts = {}): string {
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;
  const joinUrl = escapeHtml(VOLTICK_JOIN_URL);
  const code = escapeHtml(VOLTICK_CODE);

  const sans = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
  const mono = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

  const factRows = CBEDGE_FACTS.map(
    (f) => `
                <tr>
                  <td valign="top" width="26" style="font:700 15px/1.6 ${sans};color:#8ECAE6;">&bull;</td>
                  <td valign="top" style="font:400 14px/1.7 ${sans};color:#d4dde6;padding-bottom:12px;">
                    <strong style="color:#ffffff;">${escapeHtml(f.title)}</strong> ${escapeHtml(f.note)}
                  </td>
                </tr>`
  ).join("");

  const offerCells = OFFER_FACTS.map(
    (f) => `
                  <td width="33%" valign="top" style="padding:0 4px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #1e2630;border-radius:10px;background:rgba(47,107,255,0.08);">
                      <tr>
                        <td align="center" style="padding:14px 6px;">
                          <div style="font:900 20px/1 ${sans};color:#6aa0ff;">${escapeHtml(f.stat)}</div>
                          <div style="padding-top:7px;font:400 11px/1.45 ${sans};color:#c0c5c3;">${escapeHtml(f.note)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(VOLTICK75_SUBSCRIBERS_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">CB Edge is still running and I use it every day. New customers are closed. Code ${code} gets you 75% off Voltick for life, ${PRICE_WITH_CODE} a month.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <tr><td style="height:3px;background:linear-gradient(90deg,#219EBC 0%,#4d8cff 55%,#2f6bff 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- logo -->
          <tr>
            <td align="center" style="padding:28px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="260" style="display:block;width:260px;max-width:60%;height:auto;border:0;">
            </td>
          </tr>

          <!-- PILL -->
          <tr>
            <td align="center" style="padding:22px 28px 0 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.45);border-radius:999px;background:rgba(33,158,188,0.12);">
                <tr>
                  <td style="padding:9px 20px;font:800 12px/1 ${sans};letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;">
                    For subscribers
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td align="center" style="padding:18px 28px 0 28px;">
              <div style="font:900 32px/1.14 ${sans};color:#ffffff;letter-spacing:-0.01em;">CB Edge isn't <span style="color:#8ECAE6;">stopping</span>.</div>
              <div style="font:400 15px/1.7 ${sans};color:#d4dde6;margin-top:14px;">
                Quick note so there's no confusion.
              </div>
            </td>
          </tr>

          <!-- STATUS -->
          <tr>
            <td style="padding:24px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${factRows}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:6px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid #8ECAE6;background:rgba(255,255,255,0.03);border-radius:0 12px 12px 0;">
                <tr>
                  <td style="padding:16px 18px;font:400 14px/1.75 ${sans};color:#d4dde6;">
                    I'm still in it <strong style="color:#ffffff;">every morning</strong>, still fixing things,
                    still adding things. I just can't open the doors to new customers right now.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- VOLTICK OFFER (Voltick palette) -->
          <tr>
            <td style="padding:28px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #1e2630;border-radius:14px;background:#0a0d10;overflow:hidden;">
                <tr><td style="height:2px;background:linear-gradient(90deg,rgba(47,107,255,0) 0%,#2f6bff 50%,rgba(47,107,255,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td style="padding:22px 20px 0 20px;" align="center">
                    <div style="font:800 13px/1 ${mono};letter-spacing:0.22em;color:#6aa0ff;">VOLTICK</div>
                    <div style="padding-top:10px;font:900 22px/1.25 ${sans};color:#e7ece9;">75% off. For life.</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 16px 0 16px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>${offerCells}
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 20px 0 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #2f6bff;border-radius:12px;background:rgba(47,107,255,0.10);">
                      <tr>
                        <td align="center" style="padding:20px 18px;">
                          <div style="font:700 11px/1 ${sans};letter-spacing:0.16em;text-transform:uppercase;color:#6aa0ff;">Your code</div>
                          <div style="padding-top:12px;font:900 26px/1 ${mono};letter-spacing:0.10em;color:#e7ece9;">${code}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px 22px 20px;">
                    <div style="font:400 13px/1.75 ${sans};color:#e7ece9;">
                      That is <strong style="color:#6aa0ff;">${PRICE_WITH_CODE} a month</strong> for an ${PRICE_FULL} service,
                      and the price is going up. The discount stays locked for life, so the earlier you lock it, the better.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:22px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:12px;background:#2f6bff;">
                    <a href="${joinUrl}" style="display:block;padding:17px 24px;font:900 16px/1 ${sans};letter-spacing:0.04em;text-transform:uppercase;color:#e7ece9;text-decoration:none;border-radius:12px;">Join Voltick</a>
                  </td>
                </tr>
              </table>
              <div style="font:400 12px/1.6 ${sans};color:#6b7d8f;padding-top:10px;word-break:break-all;">
                <a href="${joinUrl}" style="color:#8ECAE6;text-decoration:underline;">${escapeHtml(VOLTICK_JOIN_LABEL)}</a>
                &nbsp;&middot;&nbsp; use code <span style="font-family:${mono};color:#ffffff;">${code}</span>
              </div>
            </td>
          </tr>

          <!-- SIGN-OFF -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:18px;font:400 14px/1.75 ${sans};color:#d4dde6;">
                Questions? Hit reply. I read every one.
              </div>
              <div style="padding-top:12px;text-align:center;font:400 14px/1.7 ${sans};color:#8ECAE6;font-weight:600;">
                Bzila, founder of CB Edge
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
