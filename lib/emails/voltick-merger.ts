// "CB Edge is joining Voltick" — the merger announcement broadcast.
//
// Goes to the whole list from the owner composer at /owner/admin/emails. It is
// a MARKETING broadcast, not a credential mail, so it keeps the tokenized
// unsubscribe footer and the {{UNSUBSCRIBE_URL}} placeholder. Do not remove it.
//
// PALETTE IS DELIBERATELY TWO-TONE. The shell is CB Edge (bg #05060A · panel
// #0D1119 · cyan #219EBC · accent #8ECAE6 · body #d4dde6) because the mail
// comes from CB Edge and lands in a CB Edge subscriber's inbox. Everything
// inside the handoff block is Voltick (ink #0a0d10 · Volt Blue #2f6bff ·
// accent text #6aa0ff · paper #e7ece9 · quiet #c0c5c3) because that is the
// thing being handed to. The colour change IS the message. See
// `md files/VOLTICK-DESIGN-SYSTEM.md`.
//
// TWO VOLTICK RULES BIND THIS FILE: no grey text in the Voltick block, and NO
// EM-DASHES anywhere a reader sees. Use a middle dot, comma, colon or
// parentheses. (Code comments are exempt.)
//
// THE TRANSFER OFFER IS A SLOT, not a hardcoded coupon. Pass `transferCode` /
// `transferUrl` / `transferNote` once the Voltick side confirms the plan. With
// nothing passed, the block renders an obvious TODO so a half-filled email
// cannot quietly go out looking finished.

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";
import { brandLogoUrl } from "@/lib/brand";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = brandLogoUrl(SITE_URL);
// The sandbox host is the only Voltick URL this repo can prove exists (see
// lib/emails/voltick-invite.ts). If Voltick has a public marketing domain by
// send time, pass it as transferUrl rather than editing this default.
const VOLTICK_URL = "https://voltick.cbedge.net";

export const VOLTICK_MERGER_SUBJECT = "CB Edge is joining Voltick";

export interface VoltickMergerOpts {
  /** Coupon code Voltick honours for transferring CB Edge members. */
  transferCode?: string | null;
  /** Where the transfer link points. Defaults to the Voltick site. */
  transferUrl?: string | null;
  /** One line under the code: what the code actually gets them. */
  transferNote?: string | null;
  /** Recipient email. When set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** What Voltick brings, in one place so HTML and text cannot drift. */
const VOLTICK_FACTS: { stat: string; note: string }[] = [
  { stat: "200+", note: "traders already on the platform" },
  { stat: "1,000+", note: "tickers covered, not just the index" },
  { stat: "Fastest", note: "growing GEX platform in the space" },
];

/** Plain-text fallback. */
export function voltickMergerText(opts: VoltickMergerOpts = {}): string {
  const url = opts.transferUrl || VOLTICK_URL;
  const code = (opts.transferCode || "").trim();
  const note = (opts.transferNote || "").trim();

  return [
    "CB EDGE",
    "",
    "CB EDGE IS JOINING VOLTICK",
    "",
    "This was a tough call, and I want to give it to you straight.",
    "",
    "CB Edge is merging with Voltick.",
    "",
    "Building CB Edge has been one of the best things I have done. But at some",
    "point you have to be honest about what actually serves the people paying",
    "you, and going head to head with a long time trading buddy in the GEX",
    "world stopped making sense for either of us. Two smaller platforms",
    "splitting the same effort helps nobody. One bigger one helps everybody.",
    "",
    "WHO VOLTICK IS",
    "",
    ...VOLTICK_FACTS.map((f) => `  ${f.stat}  ${f.note}`),
    "",
    "Run by Gnotz, who is a genuine beast at this. Voltick maps dealer",
    "positioning across more than a thousand tickers and names the levels",
    "market makers are forced to hedge. If you liked what CB Edge did for SPX,",
    "this does it for the whole board.",
    "",
    "WHAT HAPPENS TO YOUR SUBSCRIPTION",
    "",
    "  CB Edge stays live. Nothing shuts off tomorrow.",
    "  Monthly: your subscription runs to the end of your current period,",
    "    then ends. You will not be re-billed.",
    "  Yearly: same. Your term runs out in full, then ends.",
    "  Nothing renews. There are no surprise charges.",
    "",
    "MOVING OVER TO VOLTICK",
    "",
    code
      ? [`Use code ${code} at ${url}`, note ? `  ${note}` : ""].filter(Boolean).join("\n")
      : "[ TRANSFER OFFER GOES HERE: code, plan and link ]",
    "",
    "Take it. The ticker coverage alone is a serious step up from what CB Edge",
    "gave you, and you will be on a platform that is actively growing instead",
    "of one splitting my attention.",
    "",
    "THANK YOU",
    "",
    "Seriously. You backed a small platform built by one guy who trades the",
    "same tape you do. That is not nothing and I do not take it lightly. Hit",
    "reply with any question about your billing, your remaining term or the",
    "move. I will answer every one.",
    "",
    "See you on the other side.",
    "",
    "— Bzila, founder of CB Edge",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
    "Market analytics, not financial advice.",
  ].join("\n");
}

/** Branded HTML announcement. */
export function voltickMergerEmail(opts: VoltickMergerOpts = {}): string {
  const url = escapeHtml(opts.transferUrl || VOLTICK_URL);
  const code = escapeHtml((opts.transferCode || "").trim());
  const note = escapeHtml((opts.transferNote || "").trim());
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  const sans = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
  const mono = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

  const factCells = VOLTICK_FACTS.map(
    (f) => `
                  <td width="33%" valign="top" style="padding:0 4px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #1e2630;border-radius:10px;background:rgba(47,107,255,0.08);">
                      <tr>
                        <td align="center" style="padding:14px 6px;">
                          <div style="font:900 22px/1 ${sans};color:#6aa0ff;">${escapeHtml(f.stat)}</div>
                          <div style="padding-top:7px;font:400 11px/1.45 ${sans};color:#c0c5c3;">${escapeHtml(f.note)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>`
  ).join("");

  // Filled = the real offer. Empty = a loud TODO the owner cannot miss in the
  // composer preview, so a placeholder email can never look send-ready.
  const offerBlock = code
    ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #2f6bff;border-radius:12px;background:rgba(47,107,255,0.10);">
                <tr>
                  <td align="center" style="padding:20px 18px;">
                    <div style="font:700 11px/1 ${sans};letter-spacing:0.16em;text-transform:uppercase;color:#6aa0ff;">Your transfer code</div>
                    <div style="padding-top:12px;font:900 26px/1 ${mono};letter-spacing:0.10em;color:#e7ece9;">${code}</div>
                    ${note ? `<div style="padding-top:12px;font:400 13px/1.65 ${sans};color:#c0c5c3;">${note}</div>` : ""}
                  </td>
                </tr>
              </table>`
    : `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px dashed #ffd166;border-radius:12px;background:rgba(255,209,102,0.10);">
                <tr>
                  <td align="center" style="padding:22px 18px;">
                    <div style="font:900 13px/1.5 ${mono};letter-spacing:0.08em;color:#ffd166;">
                      TRANSFER OFFER GOES HERE<br>
                      <span style="font-weight:400;">code &middot; plan &middot; link</span>
                    </div>
                    <div style="padding-top:10px;font:400 12px/1.6 ${sans};color:#c0c5c3;">
                      Pass transferCode, transferUrl and transferNote before sending.
                    </div>
                  </td>
                </tr>
              </table>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(VOLTICK_MERGER_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">CB Edge is merging with Voltick. Your subscription runs out its term and never renews. Here is what it means and how to move over.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <!-- accent bar: cyan handing off to volt blue -->
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
                    An announcement
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td align="center" style="padding:18px 28px 0 28px;">
              <div style="font:900 32px/1.14 ${sans};color:#ffffff;letter-spacing:-0.01em;">CB Edge is joining <span style="color:#6aa0ff;">Voltick</span><span style="color:#2f6bff;">.</span></div>
              <div style="font:400 15px/1.7 ${sans};color:#d4dde6;margin-top:14px;">
                This was a tough call, and I want to give it to you straight.
              </div>
            </td>
          </tr>

          <!-- WHY -->
          <tr>
            <td style="padding:24px 28px 0 28px;">
              <div style="font:400 14px/1.75 ${sans};color:#d4dde6;">
                Building CB Edge has been one of the best things I have done. But at some point you have to be
                honest about what actually serves the people paying you, and going head to head with a
                <strong style="color:#ffffff;">long time trading buddy</strong> in the GEX world stopped making
                sense for either of us. Two smaller platforms splitting the same effort helps nobody.
                One bigger one helps everybody.
              </div>
            </td>
          </tr>

          <!-- VOLTICK HANDOFF BLOCK (Voltick palette) -->
          <tr>
            <td style="padding:26px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #1e2630;border-radius:14px;background:#0a0d10;overflow:hidden;">
                <tr><td style="height:2px;background:linear-gradient(90deg,rgba(47,107,255,0) 0%,#2f6bff 50%,rgba(47,107,255,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td style="padding:22px 20px 0 20px;" align="center">
                    <div style="font:800 13px/1 ${mono};letter-spacing:0.22em;color:#6aa0ff;">VOLTICK</div>
                    <div style="padding-top:8px;font:400 12px/1 ${sans};color:#c0c5c3;">Know your levels.</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px 16px 0 16px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>${factCells}
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 20px 22px 20px;">
                    <div style="font:400 13px/1.75 ${sans};color:#e7ece9;">
                      Run by <strong style="color:#6aa0ff;">Gnotz</strong>, who is a genuine beast at this.
                      Voltick maps dealer positioning across more than a thousand tickers and names the levels
                      market makers are forced to hedge. If you liked what CB Edge did for SPX, this does it
                      for the whole board.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- WHAT HAPPENS TO YOUR SUB -->
          <tr>
            <td style="padding:28px 28px 0 28px;">
              <div style="font:700 11px/1 ${sans};letter-spacing:0.14em;text-transform:uppercase;color:#8ECAE6;padding-bottom:14px;">What happens to your subscription</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="top" width="26" style="font:700 15px/1.6 ${sans};color:#8ECAE6;">&bull;</td>
                  <td valign="top" style="font:400 14px/1.7 ${sans};color:#d4dde6;padding-bottom:12px;">
                    <strong style="color:#ffffff;">CB Edge stays live.</strong> Nothing shuts off tomorrow.
                  </td>
                </tr>
                <tr>
                  <td valign="top" width="26" style="font:700 15px/1.6 ${sans};color:#8ECAE6;">&bull;</td>
                  <td valign="top" style="font:400 14px/1.7 ${sans};color:#d4dde6;padding-bottom:12px;">
                    <strong style="color:#ffffff;">Monthly:</strong> your subscription runs to the end of your
                    current billing period, then ends. You will not be re-billed.
                  </td>
                </tr>
                <tr>
                  <td valign="top" width="26" style="font:700 15px/1.6 ${sans};color:#8ECAE6;">&bull;</td>
                  <td valign="top" style="font:400 14px/1.7 ${sans};color:#d4dde6;padding-bottom:12px;">
                    <strong style="color:#ffffff;">Yearly:</strong> same. Your term runs out in full, then ends.
                  </td>
                </tr>
                <tr>
                  <td valign="top" width="26" style="font:700 15px/1.6 ${sans};color:#8ECAE6;">&bull;</td>
                  <td valign="top" style="font:400 14px/1.7 ${sans};color:#d4dde6;">
                    <strong style="color:#ffffff;">Nothing renews.</strong> There are no surprise charges.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TRANSFER OFFER -->
          <tr>
            <td style="padding:28px 28px 0 28px;">
              <div style="font:700 11px/1 ${sans};letter-spacing:0.14em;text-transform:uppercase;color:#6aa0ff;padding-bottom:14px;">Moving over to Voltick</div>
              ${offerBlock}
              <div style="padding-top:14px;font:400 14px/1.7 ${sans};color:#d4dde6;">
                Take it. The ticker coverage alone is a serious step up from what CB Edge gave you, and you will
                be on a platform that is actively growing instead of one splitting my attention.
              </div>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:22px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:12px;background:#2f6bff;">
                    <a href="${url}" style="display:block;padding:17px 24px;font:900 16px/1 ${sans};letter-spacing:0.04em;text-transform:uppercase;color:#e7ece9;text-decoration:none;border-radius:12px;">Go to Voltick</a>
                  </td>
                </tr>
              </table>
              <div style="font:400 12px/1.6 ${sans};color:#6b7d8f;padding-top:10px;word-break:break-all;">${url}</div>
            </td>
          </tr>

          <!-- THANK YOU -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:18px;font:400 14px/1.75 ${sans};color:#d4dde6;">
                Seriously, thank you. You backed a small platform built by one guy who trades the same tape you
                do. That is not nothing and I do not take it lightly. Hit reply with any question about your
                billing, your remaining term or the move. I will answer every one.
              </div>
              <div style="padding-top:16px;text-align:center;font:400 14px/1.7 ${sans};color:#d4dde6;">
                See you on the other side.<br>
                <span style="color:#8ECAE6;font-weight:600;">&mdash; Bzila, founder of CB Edge</span>
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
