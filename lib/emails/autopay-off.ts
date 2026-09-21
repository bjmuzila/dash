// "Your automatic payment has been turned off" — broadcast to every paying
// subscriber, sent from the owner composer at owner.cbedge.net (Emails page).
//
// Context: sales and renewals are switched off as part of the Voltick merger
// (see voltick-merger.ts). This mail is the plain billing notice that follows:
// nobody gets charged again, and nobody loses a day they already paid for.
//
// THE LOAD-BEARING MESSAGE: auto-renew is OFF, there are NO further charges,
// and access stays ON through the end of the term they already paid for.
// `BILLING_FACTS` is the single source for it so HTML and text cannot drift.
//
// House rules kept from the merger mail: no em-dashes anywhere a reader sees
// (code comments exempt). Marketing-list mail, so the tokenized unsubscribe
// footer and the {{UNSUBSCRIBE_URL}} placeholder stay. Do not remove them.
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6 · body #d4dde6

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";
import { brandLogoUrl } from "@/lib/brand";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = brandLogoUrl(SITE_URL);
const DASHBOARD_URL = `${SITE_URL}/home`;
const SUPPORT_EMAIL = "hello@cbedge.net";

export const AUTOPAY_OFF_SUBJECT = "Your CB Edge automatic payment has been turned off";

export interface AutopayOffOpts {
  /** Override the CTA URL (defaults to the dashboard home). */
  ctaUrl?: string | null;
  /** Optional access end date shown in the callout, e.g. "October 14, 2026".
   *  Leave blank on a broadcast: the copy falls back to "the end of your
   *  current billing period", which is true for every recipient. */
  accessUntil?: string | null;
  /** Recipient email. When set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** The three facts every recipient needs. Edit here, never inline. */
function billingFacts(accessUntil?: string | null): { title: string; note: string }[] {
  const until = accessUntil?.trim()
    ? `through ${accessUntil.trim()}`
    : "through the end of your current billing period";
  return [
    {
      title: "Automatic payment is off.",
      note: "Your subscription will not renew. We turned this off on our side, so there is nothing you need to cancel.",
    },
    {
      title: "You will not be charged again.",
      note: "No renewal, no surprise charge, no card on file being billed. Your last payment was your final one.",
    },
    {
      title: "Your access stays on.",
      note: `You keep full CB Edge access ${until}. Every day you paid for is yours.`,
    },
  ];
}

/** Plain-text fallback. */
export function autopayOffText(opts: AutopayOffOpts = {}): string {
  const cta = opts.ctaUrl || DASHBOARD_URL;
  const facts = billingFacts(opts.accessUntil);
  return [
    "Hi there,",
    "",
    "A quick billing heads-up: the automatic payment on your CB Edge subscription has been turned off.",
    "",
    ...facts.flatMap((f) => [`* ${f.title} ${f.note}`, ""]),
    "You do not need to do anything. No action, no cancellation, no login required.",
    "",
    `Keep using the dashboard: ${cta}`,
    "",
    `Questions about a charge or your access? Reply to this email or write to ${SUPPORT_EMAIL}.`,
    "",
    "Thank you for trading with us.",
    "",
    "Bzila",
    "CB Edge",
    "",
    "--",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML autopay-off notice. */
export function autopayOffEmail(opts: AutopayOffOpts = {}): string {
  const cta = escapeHtml(opts.ctaUrl || DASHBOARD_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;
  const facts = billingFacts(opts.accessUntil);
  const sans = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

  const factRows = facts
    .map(
      (f, i) => `
                <tr>
                  <td valign="top" width="34" style="padding:${i === 0 ? 0 : 14}px 0 0 0;">
                    <div style="width:24px;height:24px;border-radius:12px;background:rgba(33,158,188,0.16);border:1px solid rgba(33,158,188,0.45);text-align:center;font:800 12px/24px ${sans};color:#8ECAE6;">${i + 1}</div>
                  </td>
                  <td valign="top" style="padding:${i === 0 ? 0 : 14}px 0 0 0;">
                    <div style="font:700 15px/1.4 ${sans};color:#ffffff;">${escapeHtml(f.title)}</div>
                    <div style="padding-top:4px;font:400 14px/1.6 ${sans};color:#d4dde6;">${escapeHtml(f.note)}</div>
                  </td>
                </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(AUTOPAY_OFF_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">No more charges. Your access stays on through the end of the period you already paid for. Nothing for you to do.</div>
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

          <!-- status pill -->
          <tr>
            <td align="center" style="padding:18px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border:1px solid rgba(33,158,188,0.45);border-radius:999px;background:rgba(33,158,188,0.10);padding:6px 14px;font:700 11px/1 ${sans};letter-spacing:0.14em;text-transform:uppercase;color:#8ECAE6;">
                    Billing update &middot; Auto-renew off
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- heading -->
          <tr>
            <td align="center" style="padding:16px 32px 4px 32px;">
              <div style="font:800 24px/1.3 ${sans};color:#ffffff;">Your automatic payment<br>has been turned off</div>
              <div style="font:600 14px/1.5 ${sans};color:#8ECAE6;margin-top:8px;">No more charges. Your access stays on.</div>
            </td>
          </tr>

          <!-- body copy -->
          <tr>
            <td style="padding:22px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:600 15px/1.6 ${sans};color:#ffffff;">Hi there,</p>
              <p style="margin:0 0 6px 0;font:400 14px/1.7 ${sans};color:#d4dde6;">
                A quick billing heads-up: the <strong style="color:#8ECAE6;">automatic payment</strong> on your <strong style="color:#219EBC;">CB Edge</strong> subscription has been turned off. Here is exactly what that means for you.
              </p>
            </td>
          </tr>

          <!-- facts callout -->
          <tr>
            <td style="padding:14px 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <tr>
                  <td style="padding:20px 20px;">
                    <div style="font:700 11px/1 ${sans};letter-spacing:0.12em;text-transform:uppercase;color:#8ECAE6;padding-bottom:16px;">What changes</div>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${factRows}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- no action needed -->
          <tr>
            <td style="padding:16px 32px 4px 32px;">
              <p style="margin:0;font:400 14px/1.7 ${sans};color:#d4dde6;">
                <strong style="color:#ffffff;">You do not need to do anything.</strong> No cancellation, no form, no login required. Keep using the dashboard exactly as you do today.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:22px 32px 26px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:10px;background:#219EBC;">
                    <a href="${cta}" style="display:inline-block;padding:13px 30px;font:700 14px/1 ${sans};color:#05060A;text-decoration:none;border-radius:10px;">Open the dashboard &rarr;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- questions -->
          <tr>
            <td style="padding:0 32px 8px 32px;">
              <p style="margin:0;font:400 13px/1.7 ${sans};color:#9fb3c8;">
                Questions about a charge or your access? Just reply to this email or write to
                <a href="mailto:${SUPPORT_EMAIL}" style="color:#8ECAE6;text-decoration:underline;">${SUPPORT_EMAIL}</a>.
              </p>
            </td>
          </tr>

          <!-- sign-off -->
          <tr>
            <td style="padding:14px 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:18px;font:400 13px/1.7 ${sans};color:#9fb3c8;">
                Thank you for trading with us.<br><br>
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
