// FOMC half-off: a full year of CB Edge at $250 instead of $500, capped at two
// seats and closing at the end of the Fed meeting.
//
// Layout is the edge3-annual.ts band order — logo → hero → WHY NOW → WHAT YOU
// GET → THE OFFER → CTA → sign-off — with one deliberate swap: edge3 is
// evergreen and leads its offer card with a promo CODE, this one has no code and
// leads with the SEAT COUNT, because the scarcity is the whole argument. The
// price is stated once per band (hero, invoice, button) rather than repeated
// inside a band.
//
// THE CODE IS FOMC, live in Stripe as of 2026-09-15 (Brandon). The chip in the
// offer card sends people looking for it at checkout, so if the coupon is ever
// retired the chip goes with it. The seat count sits beside the code rather
// than instead of it: the code is how you pay $250, the two seats are why you
// pay it today.
//
// Brand palette: bg #05060A · panel #0D1119 · nested card #080B11 ·
// cyan #219EBC · accent #8ECAE6 · body #d4dde6 · muted #9fb3c8 · dim #6b7d8f ·
// amber #F2A65A (the FOMC mark, and the only warm colour in the email)

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";
import { brandLogoUrl } from "@/lib/brand";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = brandLogoUrl(SITE_URL);
const SIGN_UP_URL = `${SITE_URL}/pricing`;

export interface FomcHalfOffOpts {
  /** Override the CTA URL (defaults to the pricing page). */
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
  /** Promo price. Defaults to 250. */
  price?: number;
  /** List price the promo discounts from. Defaults to 500. */
  listPrice?: number;
  /** How many seats are left at this price. Defaults to 2. */
  spots?: number;
  /** Promo code. Defaults to FOMC. */
  code?: string;
  /** The window the offer closes with. Defaults to "the end of FOMC". */
  deadline?: string;
}

/** What the year buys. One line each — this is a scan, not a spec sheet. */
const INCLUDED: string[] = [
  "Live GEX — chart, heatmap, walls, levels",
  "Real orderflow tape and the flow scanner",
  "Estimated moves, option chain, multi-greek",
  "The phone build — same data, built for a phone",
  "Every page that ships during your year",
];

export const FOMC_HALF_OFF_SUBJECT =
  "Half off the year — $250 instead of $500, two spots (code FOMC)";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

const SANS = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

/** Small uppercase band label — the only thing separating one section from the next. */
function eyebrow(text: string): string {
  return `<div style="text-align:center;font:700 11px/1 ${SANS};letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;">${text}</div>`;
}

/** Plain-text fallback. Same band order as the HTML. */
export function fomcHalfOffText(opts: FomcHalfOffOpts = {}): string {
  const cta = opts.ctaUrl || SIGN_UP_URL;
  const price = opts.price ?? 250;
  const listPrice = opts.listPrice ?? 500;
  const spots = opts.spots ?? 2;
  const deadline = opts.deadline || "the end of FOMC";
  const code = opts.code || "FOMC";
  const off = listPrice - price;
  const pct = Math.round((off / listPrice) * 100);
  const perMonth = Math.round(price / 12);

  return [
    `A FULL YEAR OF CB EDGE FOR $${price}.`,
    "",
    `Normally $${listPrice.toLocaleString("en-US")} — about $${perMonth}/month for every page on the site.`,
    `${pct}% off the annual plan with code ${code}. ${spots} spots, closing at ${deadline}.`,
    "",
    "————————————————————————",
    "WHY NOW",
    "————————————————————————",
    "",
    "CB Edge wants you to have an edge up on the FOMC decision and the data",
    "around it, so we are losing money on this sale. Live gamma, the walls and",
    "the flip, through the print and the minutes after it.",
    "",
    "————————————————————————",
    "WHAT THE YEAR INCLUDES",
    "————————————————————————",
    "",
    ...INCLUDED.map((line) => `  - ${line}`),
    "",
    "————————————————————————",
    "THE OFFER",
    "————————————————————————",
    "",
    `USE CODE: ${code}`,
    "",
    `${spots} SEATS LEFT — closes at ${deadline}, or when they are taken.`,
    "",
    // Right-align the amounts so the plain-text invoice still reads as an
    // invoice in a monospaced client instead of a ragged three lines.
    ...([
      ["CB Edge Access (billed annually)", `$${listPrice.toLocaleString("en-US")}.00`],
      [`Discount · ${code}`, `-$${off.toLocaleString("en-US")}.00`],
      ["Total due today", `$${price}.00`],
    ] as [string, string][]).map(
      ([label, amount]) => label + " ".repeat(Math.max(2, 48 - label.length - amount.length)) + amount
    ),
    "",
    `Get the year: ${cta}`,
    "",
    `Apply ${code} at checkout. Held for twelve months — when the ${spots} are gone it is back to $${listPrice.toLocaleString("en-US")}.`,
    "",
    "— Bzila, founder of CB Edge",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML FOMC half-off email. */
export function fomcHalfOffEmail(opts: FomcHalfOffOpts = {}): string {
  const cta = escapeHtml(opts.ctaUrl || SIGN_UP_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;
  const price = opts.price ?? 250;
  const listPrice = opts.listPrice ?? 500;
  const spots = opts.spots ?? 2;
  const deadline = escapeHtml(opts.deadline || "the end of FOMC");
  const code = escapeHtml(opts.code || "FOMC");
  const off = listPrice - price;
  const pct = Math.round((off / listPrice) * 100);
  const perMonth = Math.round(price / 12);
  const money = (n: number) => `$${n.toLocaleString("en-US")}.00`;

  const included = INCLUDED.map(
    (line) =>
      `<tr>
                  <td width="18" valign="top" style="font:800 14px/1.9 ${SANS};color:#219EBC;">&#8250;</td>
                  <td style="font:400 14px/1.9 ${SANS};color:#d4dde6;">${escapeHtml(line)}</td>
                </tr>`
  ).join("\n                ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(FOMC_HALF_OFF_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">A full year of CB Edge for $${price} instead of $${listPrice.toLocaleString("en-US")} with code ${code}. ${spots} spots, and they close at ${deadline}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">

          <!-- ── accent bar ─────────────────────────────────── -->
          <tr><td style="height:3px;background:linear-gradient(90deg,rgba(33,158,188,0) 0%,#219EBC 50%,rgba(33,158,188,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- ── 1. LOGO ────────────────────────────────────── -->
          <tr>
            <td align="center" style="padding:30px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="260" style="display:block;width:260px;max-width:60%;height:auto;border:0;">
            </td>
          </tr>

          <!-- ── 2. HERO — the offer, stated once ───────────── -->
          <tr>
            <td align="center" style="padding:22px 30px 0 30px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.45);border-radius:999px;background:rgba(33,158,188,0.12);">
                <tr>
                  <td style="padding:8px 18px;font:800 11px/1 ${SANS};letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;">${pct}% off the annual plan &middot; code ${code}</td>
                </tr>
              </table>
              <div style="font:900 34px/1.15 ${SANS};color:#ffffff;letter-spacing:-0.015em;padding-top:18px;">
                A full year of CB Edge<br><span style="color:#219EBC;">for $${price}.</span>
              </div>
              <div style="font:600 14px/1.65 ${SANS};color:#9fb3c8;padding-top:12px;">
                Normally $${listPrice.toLocaleString("en-US")} &mdash; about <span style="color:#d4dde6;">$${perMonth}/month</span> for every page on the site.
              </div>
            </td>
          </tr>

          <!-- ── 3. WHY NOW — the Fed, and the honest reason ── -->
          <tr><td style="padding:26px 30px 0 30px;"><div style="border-top:1px solid rgba(255,255,255,0.08);"></div></td></tr>
          <tr>
            <td style="padding:22px 30px 0 30px;">
              ${eyebrow("Why now")}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;border:1px solid rgba(255,255,255,0.10);border-radius:12px;background:#080B11;">
                <tr>
                  <td style="padding:18px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="86" valign="middle" align="center">
                          <div style="font:900 26px/1 ${SANS};color:#F2A65A;">FOMC</div>
                          <div style="font:700 10px/1 ${SANS};letter-spacing:0.14em;text-transform:uppercase;color:#6b7d8f;padding-top:7px;">This week</div>
                        </td>
                        <td width="1" style="background:rgba(255,255,255,0.10);font-size:0;line-height:0;">&nbsp;</td>
                        <td valign="middle" style="padding-left:18px;">
                          <div style="font:800 16px/1.4 ${SANS};color:#ffffff;">CB Edge wants you to have an edge up on the decision.</div>
                          <div style="font:400 13px/1.7 ${SANS};color:#9fb3c8;padding-top:6px;">Live gamma, the walls and the flip, through the print and the minutes after it. We are losing money on this sale.</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── 4. WHAT YOU GET ────────────────────────────── -->
          <tr><td style="padding:26px 30px 0 30px;"><div style="border-top:1px solid rgba(255,255,255,0.08);"></div></td></tr>
          <tr>
            <td style="padding:22px 30px 0 30px;">
              ${eyebrow("What the year includes")}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding-top:6px;">
                ${included}
              </table>
            </td>
          </tr>

          <!-- ── 5. THE OFFER — seats + invoice in one card ─── -->
          <tr><td style="padding:26px 30px 0 30px;"><div style="border-top:1px solid rgba(255,255,255,0.08);"></div></td></tr>
          <tr>
            <td style="padding:22px 30px 0 30px;">
              ${eyebrow("The offer")}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <!-- code + seats -->
                <tr>
                  <td align="center" style="padding:20px 20px 16px 20px;">
                    <div style="font:700 10px/1 ${SANS};letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;">Use at checkout</div>
                    <div style="padding-top:10px;">
                      <span style="display:inline-block;border:2px dashed rgba(33,158,188,0.7);border-radius:10px;padding:10px 24px;background:rgba(33,158,188,0.10);font:900 24px/1 ${SANS};color:#219EBC;letter-spacing:0.10em;">${code}</span>
                    </div>
                    <div style="font:700 12px/1.7 ${SANS};color:#ffffff;padding-top:12px;">${spots} seats at this price</div>
                    <div style="font:400 12px/1.7 ${SANS};color:#6b7d8f;">Closes at ${deadline}, or when they are taken.</div>
                  </td>
                </tr>
                <tr><td style="padding:0 20px;"><div style="border-top:1px solid rgba(255,255,255,0.10);"></div></td></tr>
                <!-- invoice -->
                <tr>
                  <td style="padding:16px 20px 10px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font:600 14px/1.5 ${SANS};color:#ffffff;">CB Edge Access (billed annually)</td>
                        <td align="right" style="font:400 14px/1.5 ${SANS};color:#6b7d8f;text-decoration:line-through;white-space:nowrap;">${money(listPrice)}</td>
                      </tr>
                      <tr>
                        <td style="padding-top:10px;font:400 13px/1.5 ${SANS};color:#9fb3c8;">Discount &middot; ${code}</td>
                        <td align="right" style="padding-top:10px;font:700 14px/1.5 ${SANS};color:#219EBC;white-space:nowrap;">-${money(off)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="padding:0 20px;"><div style="border-top:1px solid rgba(255,255,255,0.10);"></div></td></tr>
                <tr>
                  <td style="padding:14px 20px 18px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font:800 15px/1.4 ${SANS};color:#ffffff;">Total due today</td>
                        <td align="right" style="font:900 26px/1 ${SANS};color:#ffffff;white-space:nowrap;">$${price}.00</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── 6. CTA ─────────────────────────────────────── -->
          <tr>
            <td align="center" style="padding:20px 30px 0 30px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:12px;background:#219EBC;">
                    <a href="${cta}" style="display:block;padding:17px 24px;font:900 16px/1 ${SANS};letter-spacing:0.04em;text-transform:uppercase;color:#05060A;text-decoration:none;border-radius:12px;">Get the year for $${price}</a>
                  </td>
                </tr>
              </table>
              <div style="font:400 12px/1.7 ${SANS};color:#6b7d8f;padding-top:12px;">
                Apply <span style="color:#8ECAE6;font-weight:700;">${code}</span> at checkout. Held for twelve months &mdash; when the ${spots} are gone it is back to $${listPrice.toLocaleString("en-US")}.
              </div>
            </td>
          </tr>

          <!-- ── 7. SIGN-OFF ────────────────────────────────── -->
          <tr>
            <td style="padding:20px 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;text-align:center;font:400 13px/1.7 ${SANS};color:#9fb3c8;">
                <span style="color:#8ECAE6;font-weight:600;">&mdash; Bzila, founder of CB Edge</span>
              </div>
            </td>
          </tr>
        </table>

        <!-- ── footer ───────────────────────────────────────── -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td align="center" style="padding:18px 32px;">
              <div style="font:400 11px/1.6 ${SANS};color:#6b7d8f;">
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
