// Annual promo: full CB Edge annual access at $400/yr instead of $1,000/yr
// with code EDGE3. No deadline, no spot cap — an evergreen offer email that
// can be re-sent to any audience.
//
// Layout is a straight top-to-bottom argument, one idea per band:
//   logo → hero (the offer) → PROOF (the scanner catch) → WHAT YOU GET →
//   THE OFFER (code + invoice in ONE card) → CTA → fine print → sign-off.
// Deliberately NOT the nopants-promo.ts / midnight-300.ts shape: those repeat
// the price four times (hero, big price block, invoice, button) because the
// scarcity framing needs the drumbeat. This one has a proof card to carry, so
// the standalone price block is gone and the code chip was folded into the top
// of the invoice card — the number is stated once per band instead of twice.
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const SIGN_UP_URL = `${SITE_URL}/pricing`;

export interface Edge3AnnualOpts {
  /** Override the CTA URL (defaults to the pricing page). */
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
  /** Promo price. Defaults to 400. */
  price?: number;
  /** List price the promo discounts from. Defaults to 1000. */
  listPrice?: number;
  /** Promo code. Defaults to EDGE3. */
  code?: string;
  /** Scanner proof card. Defaults to the MRNA catch below. */
  proof?: Partial<ScannerProof>;
}

/**
 * The scanner-card "proof" block. Mirrors the card the scanner page renders:
 * rank + ticker, premium, expiry + spot, capture stamp, then the OTM / vs-open
 * / score row and the strength flag.
 */
export interface ScannerProof {
  /** Rank badge shown before the ticker, e.g. "2". */
  rank: string;
  ticker: string;
  /** Premium on the sweep, as rendered on the card, e.g. "0.6M". */
  premium: string;
  /** Right-hand number on the card header, e.g. "68". */
  headline: string;
  /** Contract expiry, e.g. "2026-08-21". */
  expiry: string;
  /** Spot at capture, e.g. "63.52". */
  spot: string;
  /** When the scanner flagged it, e.g. "Aug 14 · 2:00 PM ET". */
  captured: string;
  /** How far out of the money, e.g. "7.1%". */
  otm: string;
  /** Move vs the open, as rendered, e.g. "+11142%". */
  vsOpen: string;
  /** Scanner score, e.g. "44". */
  score: string;
  /** Strength flag, e.g. "Very strong". */
  strength: string;
  /** The realized move headline under the card. */
  resultFrom: string;
  resultTo: string;
  resultPct: string;
}

const DEFAULT_PROOF: ScannerProof = {
  rank: "2",
  ticker: "MRNA",
  premium: "0.6M",
  headline: "68",
  expiry: "2026-08-21",
  spot: "63.52",
  captured: "Aug 14 · 2:00 PM ET",
  otm: "7.1%",
  vsOpen: "+11142%",
  score: "44",
  strength: "Very strong",
  resultFrom: "$0.75",
  resultTo: "$95.00",
  resultPct: "+12,567%",
};

/** What the year buys. One line each — this is a scan, not a spec sheet. */
const INCLUDED: string[] = [
  "Live GEX — chart, heatmap, walls, levels",
  "Real orderflow tape and the flow scanner",
  "Estimated moves, option chain, multi-greek",
  "The phone build — same data, built for a phone",
  "Every page that ships during your year",
];

export const EDGE3_ANNUAL_SUBJECT = "Full year of CB Edge — $400 instead of $1,000 (code EDGE3)";

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
export function edge3AnnualText(opts: Edge3AnnualOpts = {}): string {
  const cta = opts.ctaUrl || SIGN_UP_URL;
  const price = opts.price ?? 400;
  const listPrice = opts.listPrice ?? 1000;
  const code = opts.code || "EDGE3";
  const off = listPrice - price;
  const pct = Math.round((off / listPrice) * 100);
  const perMonth = Math.round(price / 12);
  const p: ScannerProof = { ...DEFAULT_PROOF, ...(opts.proof || {}) };

  return [
    "CB EDGE — REAL EDGE. REAL ORDERFLOW.",
    "",
    `A FULL YEAR OF CB EDGE FOR $${price}`,
    "",
    `The annual plan is $${listPrice.toLocaleString("en-US")}. Code ${code} takes it to $${price} —`,
    `${pct}% off, about $${perMonth}/month for the whole site.`,
    "",
    "————————————————————————",
    "WHAT THE SCANNER CAUGHT",
    "————————————————————————",
    "",
    `${p.ticker} — ${p.resultFrom} -> ${p.resultTo} = ${p.resultPct}`,
    "",
    `  #${p.rank} ${p.ticker}${" ".repeat(6)}${p.headline}`,
    `  ${p.premium}`,
    `  ${p.expiry} · spot ${p.spot}`,
    `  captured ${p.captured}`,
    `  OTM ${p.otm} · ${p.vsOpen} vs open · score ${p.score}`,
    `  * ${p.strength}`,
    "",
    "That card came off the scanner in real time — not a backtest, not a",
    "screenshot after the fact.",
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
    `No countdown, no spot cap. Apply ${code} at checkout whenever you're ready.`,
    "",
    "— Bzila, founder of CB Edge",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML annual-promo email. */
export function edge3AnnualEmail(opts: Edge3AnnualOpts = {}): string {
  const cta = escapeHtml(opts.ctaUrl || SIGN_UP_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;
  const price = opts.price ?? 400;
  const listPrice = opts.listPrice ?? 1000;
  const code = escapeHtml(opts.code || "EDGE3");
  const off = listPrice - price;
  const pct = Math.round((off / listPrice) * 100);
  const perMonth = Math.round(price / 12);
  const money = (n: number) => `$${n.toLocaleString("en-US")}.00`;

  const raw: ScannerProof = { ...DEFAULT_PROOF, ...(opts.proof || {}) };
  // Every proof field is interpolated into the card below, so escape once here
  // rather than at each of the dozen call sites.
  const p = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, escapeHtml(String(v))])
  ) as unknown as ScannerProof;

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
<title>${escapeHtml(EDGE3_ANNUAL_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${p.ticker} ${p.resultFrom} &rarr; ${p.resultTo}. A full year of CB Edge for $${price} instead of $${listPrice.toLocaleString("en-US")} — code ${code}, no deadline.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">

          <!-- ── accent bar ─────────────────────────────────── -->
          <tr><td style="height:3px;background:linear-gradient(90deg,rgba(33,158,188,0) 0%,#219EBC 50%,rgba(33,158,188,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- ── 1. LOGO ────────────────────────────────────── -->
          <tr>
            <td align="center" style="padding:30px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="180" style="display:block;width:180px;max-width:60%;height:auto;border:0;">
            </td>
          </tr>

          <!-- ── 2. HERO — the offer, stated once ───────────── -->
          <tr>
            <td align="center" style="padding:22px 30px 0 30px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.45);border-radius:999px;background:rgba(33,158,188,0.12);">
                <tr>
                  <td style="padding:8px 18px;font:800 11px/1 ${SANS};letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;">${pct}% off the annual plan</td>
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

          <!-- ── 3. PROOF — what the scanner caught ─────────── -->
          <tr><td style="padding:26px 30px 0 30px;"><div style="border-top:1px solid rgba(255,255,255,0.08);"></div></td></tr>
          <tr>
            <td style="padding:22px 30px 0 30px;">
              ${eyebrow("What the scanner caught")}
              <div style="text-align:center;font:800 20px/1.35 ${SANS};color:#ffffff;padding-top:12px;">
                ${p.ticker} &nbsp;${p.resultFrom} <span style="color:#6b7d8f;">&rarr;</span> ${p.resultTo}
              </div>
              <div style="text-align:center;font:900 30px/1.1 ${SANS};color:#219EBC;letter-spacing:-0.01em;padding-top:6px;">${p.resultPct}</div>

              <!-- the live scanner card, reproduced -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;border:1px solid rgba(255,255,255,0.10);border-radius:12px;background:#080B11;">
                <tr>
                  <td style="padding:16px 18px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font:800 14px/1.2 ${SANS};color:#ffffff;">
                          <span style="color:#6b7d8f;font-weight:700;">${p.rank}</span>&nbsp;&nbsp;${p.ticker}
                        </td>
                        <td align="right" style="font:600 13px/1.2 ${SANS};color:#6b7d8f;">${p.headline}</td>
                      </tr>
                    </table>
                    <div style="font:900 22px/1.2 ${SANS};color:#219EBC;padding-top:8px;">${p.premium}</div>
                    <div style="font:400 12px/1.6 ${SANS};color:#9fb3c8;padding-top:6px;">${p.expiry} &middot; spot ${p.spot}</div>
                    <div style="font:400 12px/1.6 ${SANS};color:#6b7d8f;">captured ${p.captured}</div>
                    <div style="font:600 12px/1.6 ${SANS};padding-top:10px;">
                      <span style="color:#F2A65A;">OTM ${p.otm}</span>
                      <span style="color:#8ECAE6;padding-left:10px;">${p.vsOpen} vs open</span>
                      <span style="color:#6b7d8f;padding-left:10px;">score ${p.score}</span>
                    </div>
                    <div style="font:800 12px/1.6 ${SANS};color:#F2A65A;padding-top:8px;">&#9733; ${p.strength}</div>
                  </td>
                </tr>
              </table>

              <div style="text-align:center;font:400 12px/1.7 ${SANS};color:#6b7d8f;padding-top:12px;">
                Off the scanner in real time &mdash; not a backtest, not a screenshot after the fact.
              </div>
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

          <!-- ── 5. THE OFFER — code + invoice in one card ──── -->
          <tr><td style="padding:26px 30px 0 30px;"><div style="border-top:1px solid rgba(255,255,255,0.08);"></div></td></tr>
          <tr>
            <td style="padding:22px 30px 0 30px;">
              ${eyebrow("The offer")}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <!-- code -->
                <tr>
                  <td align="center" style="padding:20px 20px 16px 20px;">
                    <div style="font:700 10px/1 ${SANS};letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;">Use at checkout</div>
                    <div style="padding-top:10px;">
                      <span style="display:inline-block;border:2px dashed rgba(33,158,188,0.7);border-radius:10px;padding:10px 24px;background:rgba(33,158,188,0.10);font:900 24px/1 ${SANS};color:#219EBC;letter-spacing:0.10em;">${code}</span>
                    </div>
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
                No countdown, no spot cap. Apply <span style="color:#8ECAE6;font-weight:700;">${code}</span> whenever you're ready.
              </div>
            </td>
          </tr>

          <!-- ── 7. SIGN-OFF ────────────────────────────────── -->
          <tr>
            <td style="padding:20px 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;text-align:center;font:400 13px/1.7 ${SANS};color:#9fb3c8;">
                <span style="color:#8ECAE6;font-weight:600;">— Bzila, founder of CB Edge</span>
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
