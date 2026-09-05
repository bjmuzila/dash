// Social-proof / marketing email showcasing a real trade the CB Edge scanner
// flagged (e.g. the PLTR 140C sweep). Built from a screenshot of the actual
// scanner card + option chart. Generic scanner-catch template — pass a new
// `opts.trade` object to reuse this for a different flagged trade later.
//
// No personal name — signed generically. Email-client-safe HTML (table
// layout, inline styles), same brand shell as the other emails.
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6 ·
// gain-green #1FD8A0 (scanner's positive-stat color, distinct from the brand's
// blue "green" alias in homeTheme.ts)

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";
import { brandLogoUrl } from "@/lib/brand";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = brandLogoUrl(SITE_URL);
const PRICING_URL = `${SITE_URL}/pricing`;

export interface ScannerTrade {
  ticker: string;
  contract: string; // e.g. "140C"
  gainPct: string; // e.g. "+129.6%"
  entry: string; // e.g. "$1.35"
  now: string; // e.g. "$3.10"
  perContract: string; // e.g. "+$175"
  sweepSize: string; // e.g. "$3.2M sweep"
  otm: string; // e.g. "8.2% OTM"
  vsOpen: string; // e.g. "+101% vs open"
  scannerScore: string; // e.g. "Scanner score 60 — flagged \"Very strong\""
  expiryNote: string; // e.g. "Jul 24 expiry · spot 129.37 at the print"
}

export interface ScannerCatchOpts {
  trade?: ScannerTrade;
  /** Override the CTA URL (defaults to /pricing). */
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

const DEFAULT_TRADE: ScannerTrade = {
  ticker: "PLTR",
  contract: "140C",
  gainPct: "+129.6%",
  entry: "$1.35",
  now: "$3.10",
  perContract: "+$175",
  sweepSize: "$3.2M sweep",
  otm: "8.2% OTM",
  vsOpen: "+101% vs open",
  scannerScore: 'Scanner score 60 — flagged "Very strong"',
  expiryNote: "Jul 24 expiry · spot 129.37 at the print",
};

export const SCANNER_CATCH_SUBJECT = "The scanner caught this before it moved 129%";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** Plain-text fallback. */
export function scannerCatchText(opts: ScannerCatchOpts = {}): string {
  const t = opts.trade || DEFAULT_TRADE;
  const cta = opts.ctaUrl || PRICING_URL;
  return [
    "THE SCANNER FLAGGED IT.",
    "",
    `${t.ticker} ${t.contract}  ${t.gainPct}`,
    "",
    `Entry ${t.entry}  →  Now ${t.now}  ·  Per contract ${t.perContract}`,
    "",
    `• ${t.sweepSize} · ${t.otm} · ${t.vsOpen}`,
    `• ${t.scannerScore}`,
    `• ${t.expiryNote}`,
    "",
    "This is the CB Edge scanner working exactly as designed — flagging unusual options flow before the move, not after. There's nothing else like it.",
    "",
    `See what it's flagging right now: ${cta}`,
    "",
    "— The CB Edge Team",
    "",
    "cbedge.net · not financial advice",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML scanner-catch email. */
export function scannerCatchEmail(opts: ScannerCatchOpts = {}): string {
  const t = opts.trade || DEFAULT_TRADE;
  const cta = escapeHtml(opts.ctaUrl || PRICING_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(SCANNER_CATCH_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${t.ticker} ${t.contract} ${t.gainPct} — flagged by the CB Edge scanner. One of a kind.</div>
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
              <div style="font:800 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.20em;text-transform:uppercase;color:#8ECAE6;">The scanner flagged it.</div>
            </td>
          </tr>

          <!-- headline -->
          <tr>
            <td align="center" style="padding:12px 28px 0 28px;">
              <div style="font:900 34px/1.15 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:-0.01em;">${t.ticker} ${t.contract} <span style="color:#1FD8A0;">${t.gainPct}</span></div>
            </td>
          </tr>

          <!-- entry/now/per-contract strip -->
          <tr>
            <td style="padding:22px 28px 4px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(255,255,255,0.10);border-radius:14px;background:rgba(255,255,255,0.02);">
                <tr><td style="padding:18px 20px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td width="33%" style="vertical-align:top;">
                      <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.10em;text-transform:uppercase;color:#8ECAE6;">Entry</div>
                      <div style="font:800 24px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:6px;">${t.entry}</div>
                    </td>
                    <td width="33%" style="vertical-align:top;">
                      <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.10em;text-transform:uppercase;color:#8ECAE6;">Now</div>
                      <div style="font:800 24px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1FD8A0;margin-top:6px;">${t.now}</div>
                    </td>
                    <td width="33%" style="vertical-align:top;">
                      <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.10em;text-transform:uppercase;color:#8ECAE6;">Per contract</div>
                      <div style="font:800 24px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1FD8A0;margin-top:6px;">${t.perContract}</div>
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
                <tr><td style="padding:0 0 10px 0;"><span style="color:#1FD8A0;">●</span>&nbsp;&nbsp;<span style="font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">${t.sweepSize} · ${t.otm} · ${t.vsOpen}</span></td></tr>
                <tr><td style="padding:0 0 10px 0;"><span style="color:#1FD8A0;">●</span>&nbsp;&nbsp;<span style="font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">${t.scannerScore}</span></td></tr>
                <tr><td style="padding:0 0 4px 0;"><span style="color:#1FD8A0;">●</span>&nbsp;&nbsp;<span style="font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">${t.expiryNote}</span></td></tr>
              </table>
            </td>
          </tr>

          <!-- one-of-a-kind callout -->
          <tr>
            <td style="padding:18px 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:#8ECAE6;">One of a kind</div>
                    <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:8px;">
                      This is the <strong style="color:#ffffff;">CB Edge scanner</strong> working exactly as designed — flagging unusual options flow <strong style="color:#8ECAE6;">before</strong> the move, not after. There's nothing else on the market built quite like it.
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
                    <a href="${cta}" style="display:inline-block;padding:15px 38px;font:800 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:12px;">See what it's flagging now →</a>
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
