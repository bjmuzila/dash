// Final-call promo: 2 spots at $300/yr for full annual CB Edge access,
// expiring tonight at midnight.
//
// Same invoice-style layout and dashboard theme as nopants-promo.ts /
// nopants-extension.ts, with a hard "ENDS TONIGHT AT MIDNIGHT" deadline banner
// and a 2-spot scarcity framing.
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const SIGN_UP_URL = `${SITE_URL}/pricing`;

export interface Midnight300Opts {
  /** Override the CTA URL (defaults to the pricing page). */
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
  /** Promo price. Defaults to 300. */
  price?: number;
  /** List price the promo discounts from. Defaults to 1000. */
  listPrice?: number;
  /** How many codes are available in this drop. Defaults to 2. */
  spots?: number;
  /** Promo code. Defaults to EDGE. */
  code?: string;
  /** Deadline wording under the CTA. */
  deadline?: string;
}

export const MIDNIGHT_300_SUBJECT = "2 spots left at $300/yr — ends tonight at midnight";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** Plain-text fallback. */
export function midnight300Text(opts: Midnight300Opts = {}): string {
  const cta = opts.ctaUrl || SIGN_UP_URL;
  const price = opts.price ?? 300;
  const listPrice = opts.listPrice ?? 1000;
  const spots = opts.spots ?? 2;
  const code = opts.code || "EDGE";
  const deadline = opts.deadline || "Ends tonight at midnight.";
  return [
    "CB EDGE — REAL EDGE. REAL ORDERFLOW.",
    "",
    `ENDS TONIGHT AT MIDNIGHT · ${spots} SPOTS`,
    "",
    `$${price}/yr — full annual access to cbedge.net`,
    "",
    `${spots} codes left at $${price}. When the clock hits midnight the code stops working — no extension this time.`,
    "",
    `USE CODE: ${code}`,
    "",
    `CB Edge Access (billed annually)   $${listPrice.toLocaleString("en-US")}.00`,
    `Today (${code})                    -$${(listPrice - price).toLocaleString("en-US")}.00`,
    `Total due today                    $${price}.00`,
    "",
    `Claim a spot: ${cta}`,
    "",
    `${deadline} Max ${spots} redemptions — whichever comes first.`,
    "",
    "— Bzila, founder of CB Edge",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML final-call email. */
export function midnight300Email(opts: Midnight300Opts = {}): string {
  const cta = escapeHtml(opts.ctaUrl || SIGN_UP_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;
  const price = opts.price ?? 300;
  const listPrice = opts.listPrice ?? 1000;
  const spots = opts.spots ?? 2;
  const code = escapeHtml(opts.code || "EDGE");
  const deadline = escapeHtml(opts.deadline || "Ends tonight at midnight.");
  const off = listPrice - price;
  const money = (n: number) => `$${n.toLocaleString("en-US")}.00`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(MIDNIGHT_300_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${spots} spots left at $${price}/yr for full annual access — the code dies at midnight.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <!-- accent bar -->
          <tr><td style="height:3px;background:linear-gradient(90deg,rgba(33,158,188,0) 0%,#219EBC 50%,rgba(33,158,188,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- logo -->
          <tr>
            <td align="center" style="padding:28px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="180" style="display:block;width:180px;max-width:60%;height:auto;border:0;">
            </td>
          </tr>

          <!-- DEADLINE BANNER -->
          <tr>
            <td align="center" style="padding:20px 28px 0 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.45);border-radius:999px;background:rgba(33,158,188,0.12);">
                <tr>
                  <td style="padding:9px 20px;font:800 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;">
                    ⏳ Ends tonight at midnight
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td align="center" style="padding:18px 28px 0 28px;">
              <div style="font:900 32px/1.1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:-0.01em;">${spots} spots left. <span style="color:#219EBC;">Then the code dies.</span></div>
              <div style="font:600 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:12px;">
                <strong style="color:#8ECAE6;">${spots} codes</strong> left for full annual access at $${price}. At midnight the code stops working — no extension this time.
              </div>
            </td>
          </tr>

          <!-- PRICE -->
          <tr>
            <td align="center" style="padding:18px 28px 0 28px;">
              <div style="font:900 46px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#219EBC;letter-spacing:-0.02em;">$${price}<span style="font-size:20px;color:#8ECAE6;font-weight:800;">/yr</span></div>
              <div style="font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:10px;">
                Full Annual Access to <a href="${SITE_URL}" style="color:#8ECAE6;text-decoration:none;font-weight:700;">cbedge.net</a> 🚨
              </div>
            </td>
          </tr>

          <!-- CODE -->
          <tr>
            <td align="center" style="padding:20px 28px 0 28px;">
              <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;">Use code at checkout</div>
              <div style="margin-top:10px;">
                <span style="display:inline-block;border:2px dashed rgba(33,158,188,0.7);border-radius:10px;padding:11px 26px;background:rgba(33,158,188,0.10);font:900 24px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#219EBC;letter-spacing:0.10em;">${code}</span>
              </div>
            </td>
          </tr>

          <!-- INVOICE CARD -->
          <tr>
            <td style="padding:22px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <tr>
                  <td style="padding:18px 20px 10px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">CB Edge Access (Billed annually)</td>
                        <td align="right" style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;text-decoration:line-through;white-space:nowrap;">${money(listPrice)}</td>
                      </tr>
                      <tr>
                        <td style="padding-top:10px;">
                          <span style="display:inline-block;border:1px solid rgba(33,158,188,0.55);border-radius:7px;padding:4px 9px;font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:#8ECAE6;background:rgba(33,158,188,0.12);">🏷 Today</span>
                          <span style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;padding-left:8px;">${money(off)} off &middot; ${code}</span>
                        </td>
                        <td align="right" style="padding-top:10px;font:700 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#219EBC;white-space:nowrap;">-${money(off)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="padding:0 20px;"><div style="border-top:1px solid rgba(255,255,255,0.10);"></div></td></tr>
                <tr>
                  <td style="padding:14px 20px 18px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font:800 15px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">Total due today:</td>
                        <td align="right" style="font:900 26px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;white-space:nowrap;">$${price}.00</td>
                      </tr>
                    </table>
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
                  <td align="center" style="border-radius:12px;background:#219EBC;">
                    <a href="${cta}" style="display:block;padding:17px 24px;font:900 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.04em;text-transform:uppercase;color:#05060A;text-decoration:none;border-radius:12px;">Claim 1 of ${spots} spots now 👉</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- FINE PRINT -->
          <tr>
            <td align="center" style="padding:14px 34px 8px 34px;">
              <div style="font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;">
                ${deadline} Max ${spots} redemptions.<br>Whichever runs out first — the clock or the codes.
              </div>
            </td>
          </tr>

          <!-- sign-off -->
          <tr>
            <td style="padding:14px 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;text-align:center;font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
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
