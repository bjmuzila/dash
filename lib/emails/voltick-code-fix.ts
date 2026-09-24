// "Our mistake, here is the right code" — the correction/apology follow-up to
// the Voltick merger broadcast (lib/emails/voltick-merger.ts).
//
// WHY THIS EXISTS: the subscriber broadcast (lib/emails/voltick75-subscribers.ts)
// printed the code as "voltick75", which is not a code Voltick honours. This
// mail owns that, apologizes once without groveling, names the dead code so a
// reader knows which email is being corrected, and puts the WORKING offer in
// the biggest type on the page:
//
//     TICK75  ·  https://voltick.io/bzila  ·  75% off
//
// `OFFER` is the single source for those three values. Edit there, never
// inline, and never in two places. If any of them ever changes again, this
// template is the one that has to be right.
//
// House rules carried over from the merger mail: NO EM-DASHES anywhere a
// reader sees (code comments exempt), and no grey body text inside the Voltick
// block. Marketing-list mail, so the tokenized unsubscribe footer and the
// {{UNSUBSCRIBE_URL}} placeholder stay. Do not remove them.
//
// Two-tone palette, same reasoning as voltick-merger.ts: CB Edge shell
// (bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6 · body #d4dde6),
// Voltick offer card (ink #0a0d10 · Volt Blue #2f6bff · accent #6aa0ff ·
// paper #e7ece9 · quiet #c0c5c3). See `md files/VOLTICK-DESIGN-SYSTEM.md`.

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";
import { brandLogoUrl } from "@/lib/brand";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = brandLogoUrl(SITE_URL);
const SUPPORT_EMAIL = "hello@cbedge.net";

/** THE WORKING OFFER. One place, so HTML and text cannot drift. */
/** The code that WENT OUT and does not work. Named in the mail on purpose:
 *  a correction that does not say which code was wrong makes people re-try it. */
const WRONG_CODE = "voltick75";

const OFFER = {
  code: "TICK75",
  url: "https://voltick.io/bzila",
  /** How the URL reads to a human (no scheme). */
  urlLabel: "voltick.io/bzila",
  discount: "75% off for life",
  note: "$22/mo instead of $89/mo, locked for as long as you stay.",
};

export const VOLTICK_CODE_FIX_SUBJECT = "Our mistake: the working code is TICK75";

export interface VoltickCodeFixOpts {
  /** The dead code from the last email. Pass "" to leave it unnamed. */
  wrongCode?: string | null;
  /** Coupon that actually works. Defaults to TICK75. */
  code?: string | null;
  /** Where the code is redeemed. Defaults to voltick.io/bzila. */
  url?: string | null;
  /** One line under the code: what it gets them. */
  note?: string | null;
  /** Recipient email. When set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

function resolve(opts: VoltickCodeFixOpts) {
  const code = (opts.code ?? OFFER.code).trim() || OFFER.code;
  const url = (opts.url ?? OFFER.url).trim() || OFFER.url;
  const note = (opts.note ?? OFFER.note).trim();
  const urlLabel = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const wrongCode = (opts.wrongCode ?? WRONG_CODE).trim();
  return { code, url, note, urlLabel, wrongCode };
}

/** Plain-text fallback. */
export function voltickCodeFixText(opts: VoltickCodeFixOpts = {}): string {
  const { code, url, note, urlLabel, wrongCode } = resolve(opts);
  return [
    "Hi there,",
    "",
    wrongCode
      ? `Short version: the code in our last email (${wrongCode}) was wrong. That is on us, and I am sorry for the wasted click.`
      : "Short version: the code in our last email was wrong. That is on us, and I am sorry for the wasted click.",
    "",
    "Here is the one that works:",
    "",
    `  Code: ${code}`,
    `  Where: ${url}`,
    `  What: ${OFFER.discount}`,
    ...(note ? ["", `  ${note}`] : []),
    "",
    `Go to ${urlLabel}, enter ${code} at checkout, and the discount applies. If it does not, tell me and I will fix it myself rather than sending you another code.`,
    "",
    "Nothing else changed. CB Edge is not stopping, it stays up and I still use it every day, and the only change remains that it can't take new customers. Your access and your billing are exactly as the last email described.",
    "",
    `Anything off? Reply to this email or write to ${SUPPORT_EMAIL}.`,
    "",
    "Thanks for the patience.",
    "",
    "Bzila",
    "CB Edge",
    "",
    "--",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML correction email. */
export function voltickCodeFixEmail(opts: VoltickCodeFixOpts = {}): string {
  const r = resolve(opts);
  const code = escapeHtml(r.code);
  const url = escapeHtml(r.url);
  const urlLabel = escapeHtml(r.urlLabel);
  const note = escapeHtml(r.note);
  const wrongCode = escapeHtml(r.wrongCode);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;
  const sans = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
  const mono = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(VOLTICK_CODE_FIX_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${wrongCode ? wrongCode + " does not work." : "The code in our last email was wrong."} ${code} at ${urlLabel} is the one that does, ${escapeHtml(OFFER.discount)}.</div>
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

          <!-- correction pill -->
          <tr>
            <td align="center" style="padding:18px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border:1px solid rgba(255,209,102,0.45);border-radius:999px;background:rgba(255,209,102,0.10);padding:6px 14px;font:700 11px/1 ${sans};letter-spacing:0.14em;text-transform:uppercase;color:#ffd166;">
                    Correction to our last email
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- heading -->
          <tr>
            <td align="center" style="padding:16px 32px 4px 32px;">
              <div style="font:800 25px/1.28 ${sans};color:#ffffff;">That code was wrong.<br>Sorry about that.</div>
              <div style="font:600 14px/1.5 ${sans};color:#8ECAE6;margin-top:8px;">Here is the one that actually works.</div>
            </td>
          </tr>

          <!-- body copy -->
          <tr>
            <td style="padding:22px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:600 15px/1.6 ${sans};color:#ffffff;">Hi there,</p>
              <p style="margin:0;font:400 14px/1.7 ${sans};color:#d4dde6;">
                The code in our last email${wrongCode ? `, <span style="color:#9fb3c8;text-decoration:line-through;">${wrongCode}</span>,` : ""} did not work. That was our error, not yours, and I am sorry for the wasted click. No excuses, just the fix.
              </p>
            </td>
          </tr>

          <!-- the working offer (Voltick block) -->
          <tr>
            <td style="padding:18px 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(47,107,255,0.55);border-radius:14px;background:#0a0d10;">
                <tr>
                  <td align="center" style="padding:22px 22px 4px 22px;">
                    <div style="font:800 13px/1 ${mono};letter-spacing:0.22em;color:#6aa0ff;">VOLTICK</div>
                    <div style="padding-top:7px;font:400 12px/1 ${sans};color:#c0c5c3;">Know your levels.</div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:18px 22px 0 22px;">
                    <div style="font:700 11px/1 ${sans};letter-spacing:0.16em;text-transform:uppercase;color:#6aa0ff;">Your working code</div>
                    <div style="padding-top:12px;font:900 30px/1 ${mono};letter-spacing:0.10em;color:#e7ece9;">${code}</div>
                    <div style="padding-top:12px;font:900 15px/1.4 ${sans};color:#6aa0ff;">${escapeHtml(OFFER.discount)}</div>
                    ${note ? `<div style="padding-top:10px;font:400 13px/1.65 ${sans};color:#c0c5c3;">${note}</div>` : ""}
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:20px 22px 8px 22px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" style="border-radius:10px;background:#2f6bff;">
                          <a href="${url}" style="display:inline-block;padding:13px 30px;font:800 14px/1 ${sans};color:#ffffff;text-decoration:none;border-radius:10px;">Redeem ${code} at ${urlLabel} &rarr;</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:0 22px 22px 22px;">
                    <div style="font:400 12px/1.6 ${sans};color:#c0c5c3;word-break:break-all;">${url}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- how to use it -->
          <tr>
            <td style="padding:16px 32px 4px 32px;">
              <p style="margin:0;font:400 14px/1.7 ${sans};color:#d4dde6;">
                Open <strong style="color:#ffffff;">${urlLabel}</strong>, enter <strong style="color:#8ECAE6;">${code}</strong> at checkout, and the ${escapeHtml(OFFER.discount)} applies. If it does not, tell me and I will sort it out myself instead of sending you another code.
              </p>
            </td>
          </tr>

          <!-- nothing else changed -->
          <tr>
            <td style="padding:16px 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font:700 11px/1 ${sans};letter-spacing:0.12em;text-transform:uppercase;color:#8ECAE6;">Nothing else changed</div>
                    <div style="padding-top:10px;font:400 14px/1.7 ${sans};color:#d4dde6;">
                      CB Edge is not stopping. It stays up, I still use it every day, and the only change remains that it can't take new customers. Your access and your billing are exactly as the last email described. This email only corrects the code.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- questions -->
          <tr>
            <td style="padding:16px 32px 8px 32px;">
              <p style="margin:0;font:400 13px/1.7 ${sans};color:#9fb3c8;">
                Anything still off? Reply to this email or write to
                <a href="mailto:${SUPPORT_EMAIL}" style="color:#8ECAE6;text-decoration:underline;">${SUPPORT_EMAIL}</a>.
              </p>
            </td>
          </tr>

          <!-- sign-off -->
          <tr>
            <td style="padding:14px 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:18px;font:400 13px/1.7 ${sans};color:#9fb3c8;">
                Thanks for the patience.<br><br>
                <span style="color:#8ECAE6;font-weight:600;">Bzila</span><br>
                <span style="color:#6b7d8f;">CB Edge</span>
              </div>
            </td>
          </tr>
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
