// Social-proof / marketing email showcasing a real whale print from the CB
// Edge /flow tape (e.g. the AMD 550P 0DTE sweep). Companion to
// lib/emails/scanner-catch.ts — same intent (real trade, real numbers, "look
// what we caught"), different source feature. Data-driven via opts.trade so
// this gets reused for the next flow catch without touching the layout.
//
// No personal name — signed generically. Email-client-safe HTML (table
// layout, inline styles), same brand shell as the other emails.
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6 ·
// gain-green #1FD8A0 · loss-red #EF4444

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const PRICING_URL = `${SITE_URL}/pricing`;

export interface FlowTrade {
  ticker: string;
  contract: string; // e.g. "550P"
  direction: "BEAR" | "BULL";
  dteLabel: string; // e.g. "0DTE"
  moveNote: string; // e.g. "AMD opened lower and kept falling — down as much as 7% intraday"
  fillTime: string; // e.g. "9:30:50 AM"
  fillPrice: string; // e.g. "$6.50"
  peakPrice: string; // e.g. "$31.71"
  peakPct: string; // e.g. "+387.8%"
  troughPrice: string; // e.g. "$3.75"
  troughPct: string; // e.g. "-42.3%"
  nowPrice: string; // e.g. "$20.65"
  sinceFillPct: string; // e.g. "+217.7%"
  premium: string; // e.g. "$650.0K"
  contracts: string; // e.g. "1,000"
  volume: string; // e.g. "4,088"
  openInterest: string; // e.g. "2,343"
  volOiRatio: string; // e.g. "1.74"
  statusNote: string; // e.g. "now ITM"
}

export interface FlowCatchOpts {
  trade?: FlowTrade;
  /** Override the CTA URL (defaults to /pricing). */
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

const DEFAULT_TRADE: FlowTrade = {
  ticker: "AMD",
  contract: "550P",
  direction: "BEAR",
  dteLabel: "0DTE",
  moveNote: "AMD opened lower and kept falling — down as much as 7% intraday.",
  fillTime: "9:30:50 AM",
  fillPrice: "$6.50",
  peakPrice: "$31.71",
  peakPct: "+387.8%",
  troughPrice: "$3.75",
  troughPct: "-42.3%",
  nowPrice: "$20.65",
  sinceFillPct: "+217.7%",
  premium: "$650.0K",
  contracts: "1,000",
  volume: "4,088",
  openInterest: "2,343",
  volOiRatio: "1.74",
  statusNote: "now ITM",
};

export const FLOW_CATCH_SUBJECT = "AMD puts slammed at the open — +217.7% since fill";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** Plain-text fallback. */
export function flowCatchText(opts: FlowCatchOpts = {}): string {
  const t = opts.trade || DEFAULT_TRADE;
  const cta = opts.ctaUrl || PRICING_URL;
  return [
    `${t.ticker} PUTS SLAMMED AT THE OPEN.`,
    "",
    `${t.ticker} ${t.contract} · ${t.dteLabel} · ${t.direction}`,
    "",
    t.moveNote,
    "",
    `Filled ${t.fillTime} at ${t.fillPrice}  →  Now ${t.nowPrice}  (${t.sinceFillPct} since fill)`,
    `Peak ${t.peakPrice} (${t.peakPct})  ·  Trough ${t.troughPrice} (${t.troughPct})`,
    "",
    `• ${t.premium} premium · ${t.contracts} contracts bought right at the open`,
    `• ${t.volume} vol vs ${t.openInterest} OI (${t.volOiRatio}x) — real size, not noise`,
    `• ${t.statusNote} as ${t.ticker} keeps sliding`,
    "",
    "This is the CB Edge flow tape — every whale print tracked live from fill to now, with peak/trough marked automatically. Not a delayed recap.",
    "",
    `See today's flow live: ${cta}`,
    "",
    "— The CB Edge Team",
    "",
    "cbedge.net · not financial advice",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML flow-catch email. */
export function flowCatchEmail(opts: FlowCatchOpts = {}): string {
  const t = opts.trade || DEFAULT_TRADE;
  const cta = escapeHtml(opts.ctaUrl || PRICING_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;
  const dirColor = t.direction === "BEAR" ? "#EF4444" : "#1FD8A0";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(FLOW_CATCH_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${t.ticker} ${t.contract} ${t.sinceFillPct} since fill, peak ${t.peakPct} — caught live on the CB Edge flow tape.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <!-- accent bar -->
          <tr><td style="height:4px;background:linear-gradient(90deg,rgba(31,216,160,0) 0%,#1FD8A0 50%,rgba(31,216,160,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- logo -->
          <tr>
            <td align="center" style="padding:30px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="260" style="display:block;width:260px;max-width:88%;height:auto;border:0;">
            </td>
          </tr>

          <!-- tag -->
          <tr>
            <td align="center" style="padding:22px 28px 0 28px;">
              <div style="font:800 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.20em;text-transform:uppercase;color:#8ECAE6;">${t.ticker} puts slammed at the open.</div>
            </td>
          </tr>

          <!-- headline -->
          <tr>
            <td align="center" style="padding:12px 28px 0 28px;">
              <div style="font:900 32px/1.15 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:-0.01em;">
                ${t.ticker} ${t.contract}
                <span style="display:inline-block;margin-left:8px;padding:3px 10px;border-radius:6px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);font:800 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${dirColor};vertical-align:middle;">▼ ${t.direction}</span>
              </div>
              <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8ECAE6;margin-top:8px;">${t.dteLabel} · filled ${t.fillTime}</div>
            </td>
          </tr>

          <!-- move note -->
          <tr>
            <td style="padding:16px 32px 0 32px;">
              <p style="margin:0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">${t.moveNote}</p>
            </td>
          </tr>

          <!-- fill/peak/now strip -->
          <tr>
            <td style="padding:20px 28px 4px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(255,255,255,0.10);border-radius:14px;background:rgba(255,255,255,0.02);">
                <tr><td style="padding:18px 20px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td width="33%" style="vertical-align:top;">
                      <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.10em;text-transform:uppercase;color:#8ECAE6;">Filled</div>
                      <div style="font:800 22px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:6px;">${t.fillPrice}</div>
                    </td>
                    <td width="33%" style="vertical-align:top;">
                      <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.10em;text-transform:uppercase;color:#8ECAE6;">Peak</div>
                      <div style="font:800 22px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1FD8A0;margin-top:6px;">${t.peakPrice} <span style="font:700 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1FD8A0;">(${t.peakPct})</span></div>
                    </td>
                    <td width="33%" style="vertical-align:top;">
                      <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.10em;text-transform:uppercase;color:#8ECAE6;">Now</div>
                      <div style="font:800 22px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1FD8A0;margin-top:6px;">${t.nowPrice} <span style="font:700 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1FD8A0;">(${t.sinceFillPct})</span></div>
                    </td>
                  </tr></table>
                </td></tr>
              </table>
            </td>
          </tr>

          <!-- bullets -->
          <tr>
            <td style="padding:18px 32px 4px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="padding:0 0 10px 0;"><span style="color:#1FD8A0;">●</span>&nbsp;&nbsp;<span style="font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">${t.premium} premium · ${t.contracts} contracts bought right at the open</span></td></tr>
                <tr><td style="padding:0 0 10px 0;"><span style="color:#1FD8A0;">●</span>&nbsp;&nbsp;<span style="font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">${t.volume} vol vs ${t.openInterest} OI (${t.volOiRatio}x) — real size, not noise</span></td></tr>
                <tr><td style="padding:0 0 4px 0;"><span style="color:#1FD8A0;">●</span>&nbsp;&nbsp;<span style="font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">Trough ${t.troughPrice} (${t.troughPct}) along the way · ${t.statusNote} as ${t.ticker} keeps sliding</span></td></tr>
              </table>
            </td>
          </tr>

          <!-- one-of-a-kind callout -->
          <tr>
            <td style="padding:18px 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:#8ECAE6;">Live, not a recap</div>
                    <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:8px;">
                      This is the <strong style="color:#ffffff;">CB Edge flow tape</strong> — every whale print tracked from fill to now, with peak and trough marked automatically. You see it as it happens, not after.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:20px 32px 30px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:12px;background:#219EBC;">
                    <a href="${cta}" style="display:inline-block;padding:15px 38px;font:800 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:12px;">See today's flow live →</a>
                  </td>
                </tr>
              </table>
              <div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;margin-top:14px;">— The CB Edge Team</div>
            </td>
          </tr>
        </table>

        <!-- footer -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
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
