// Social-proof / marketing email built from TWO real CB Edge calls on the same
// session (Jul 30):
//   1. the EDGE scanner flagging the AMD 505C at 9:50 AM ET ($2.35 → $9.00)
//   2. the GEX heatmap showing MSFT positioning stacked bullish into earnings
//
// Sibling of lib/emails/scanner-catch.ts — same intent and shell, but the strip
// reads Flagged / High / Per contract because this is a capture-to-session-high
// recap rather than a live mark, and a second proof block carries the heatmap
// screenshot. Data-driven via opts.trade / opts.heatmap so the layout gets
// reused for the next pair of catches without edits.
//
// No personal name — signed generically. Email-client-safe HTML (table
// layout, inline styles), same brand shell as the other emails.
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6 ·
// body text #d4dde6 · gain-green #1FD8A0

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const PRICING_URL = `${SITE_URL}/pricing`;

export interface EdgeCatchTrade {
  ticker: string; // e.g. "AMD"
  contract: string; // e.g. "505C"
  gainPct: string; // e.g. "+283%"
  captureNote: string; // e.g. "The EDGE flagged it Jul 30 · 9:50 AM ET · spot 470.16 at the print"
  flagged: string; // e.g. "$2.35"
  high: string; // e.g. "$9.00"
  perContract: string; // e.g. "+$665"
  sweepSize: string; // e.g. "$4.3M premium"
  otm: string; // e.g. "7.4% OTM"
  vsOpen: string; // e.g. "+860% vs open"
  scannerScore: string; // e.g. 'Scanner score 58 — flagged "Very strong"'
  expiryNote: string; // e.g. "Jul 31 expiry · one day of life left …"
}

export interface EdgeCatchHeatmap {
  ticker: string; // e.g. "MSFT"
  gainPct: string; // e.g. "+17.4%"
  /** Time the heatmap post went out, e.g. "4:00 PM ET · Jul 28". */
  postedAt: string;
  postedNote: string; // e.g. "before the print. Earnings blew the doors off."
  netGex: string; // e.g. "+$259.92M"
  wallsNote: string; // e.g. "400 through 435"
  wallsDetail: string; // e.g. "$24.5M at 400, $21.8M at 430, $19.6M at 410"
  spotNote: string; // e.g. "Spot sitting at 392.50 with the flip just underneath …"
  /** Absolute URL of the heatmap screenshot (must be publicly reachable). */
  imageUrl: string;
  /** Link the screenshot + caption point at (the X post). */
  postUrl: string;
}

export interface EdgeCatchOpts {
  trade?: EdgeCatchTrade;
  heatmap?: EdgeCatchHeatmap;
  /** Override the CTA URL (defaults to /pricing). */
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

const DEFAULT_TRADE: EdgeCatchTrade = {
  ticker: "AMD",
  contract: "505C",
  gainPct: "+283%",
  captureNote: "The EDGE flagged it Jul 30 · 9:50 AM ET · spot 470.16 at the print",
  flagged: "$2.35",
  high: "$9.00",
  perContract: "+$665",
  sweepSize: "$4.3M premium",
  otm: "7.4% OTM",
  vsOpen: "+860% vs open",
  scannerScore: 'Scanner score 58 — flagged "Very strong"',
  expiryNote: "Jul 31 expiry · one day of life left, 7.4% out of the money — pure directional size",
};

const DEFAULT_HEATMAP: EdgeCatchHeatmap = {
  ticker: "MSFT",
  gainPct: "+17.4%",
  postedAt: "4:00 PM ET · Jul 28",
  postedNote: "ahead of the print. Earnings blew the doors off.",
  netGex: "+$259.92M",
  wallsNote: "400 through 435",
  wallsDetail: "$24.5M at 400, $21.8M at 430, $19.6M at 410",
  spotNote: "Spot sitting at 392.50 with the flip just underneath — every wall above it was a call wall",
  imageUrl: `${SITE_URL}/msft-heatmap-jul30.jpg`,
  postUrl: "https://x.com/bzilatrades/status/2082194348049879285",
};

export const EDGE_CATCH_AMD_SUBJECT = "AMD 505C +283% and MSFT +17.4% — both flagged before the move";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** Plain-text fallback. */
export function edgeCatchAmdText(opts: EdgeCatchOpts = {}): string {
  const t = opts.trade || DEFAULT_TRADE;
  const h = opts.heatmap || DEFAULT_HEATMAP;
  const cta = opts.ctaUrl || PRICING_URL;
  return [
    "TWO CALLS. ONE SESSION.",
    "",
    `${t.ticker} ${t.contract}  ${t.gainPct}`,
    t.captureNote,
    "",
    `Flagged ${t.flagged}  →  High ${t.high}  ·  Per contract ${t.perContract}`,
    "",
    `• ${t.sweepSize} · ${t.otm} · ${t.vsOpen}`,
    `• ${t.scannerScore}`,
    `• ${t.expiryNote}`,
    "",
    "—",
    "",
    `AND THE HEATMAP HAD ${h.ticker}.`,
    "",
    `${h.ticker}  ${h.gainPct}`,
    `Posted ${h.postedAt} — ${h.postedNote}`,
    "",
    `• Total net GEX ${h.netGex} — positioning leaning one way, and it wasn't down`,
    `• Positive gamma stacked ${h.wallsNote} — ${h.wallsDetail}`,
    `• ${h.spotNote}`,
    "",
    `See the heatmap post: ${h.postUrl}`,
    "",
    "The EDGE surfaces unusual options flow and ranks it while the tape is still forming. The GEX heatmap shows you where dealer positioning is stacked before the catalyst hits. Both put it in front of you before the move, not after.",
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

/** Branded HTML EDGE-catch email. */
export function edgeCatchAmdEmail(opts: EdgeCatchOpts = {}): string {
  const t = opts.trade || DEFAULT_TRADE;
  const h = opts.heatmap || DEFAULT_HEATMAP;
  const cta = escapeHtml(opts.ctaUrl || PRICING_URL);
  const postUrl = escapeHtml(h.postUrl);
  const imageUrl = escapeHtml(h.imageUrl);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(EDGE_CATCH_AMD_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">One day on CB Edge — the EDGE caught ${t.ticker} ${t.flagged} to ${t.high}, and the GEX heatmap had ${h.ticker} bullish into earnings.</div>
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
              <div style="font:800 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.20em;text-transform:uppercase;color:#8ECAE6;">Two calls. One session.</div>
            </td>
          </tr>

          <!-- ══════════════ BLOCK 1 — the EDGE scanner ══════════════ -->
          <tr>
            <td align="center" style="padding:12px 28px 0 28px;">
              <div style="font:900 34px/1.15 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:-0.01em;">${t.ticker} ${t.contract} <span style="color:#1FD8A0;">${t.gainPct}</span></div>
              <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8ECAE6;margin-top:8px;">${t.captureNote}</div>
            </td>
          </tr>

          <!-- flagged/high/per-contract strip -->
          <tr>
            <td style="padding:22px 28px 4px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(255,255,255,0.10);border-radius:14px;background:rgba(255,255,255,0.02);">
                <tr><td style="padding:18px 20px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td width="33%" style="vertical-align:top;">
                      <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.10em;text-transform:uppercase;color:#8ECAE6;">Flagged</div>
                      <div style="font:800 24px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:6px;">${t.flagged}</div>
                    </td>
                    <td width="33%" style="vertical-align:top;">
                      <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.10em;text-transform:uppercase;color:#8ECAE6;">High</div>
                      <div style="font:800 24px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1FD8A0;margin-top:6px;">${t.high}</div>
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

          <!-- divider -->
          <tr>
            <td style="padding:26px 32px 0 32px;">
              <div style="height:1px;background:rgba(255,255,255,0.10);font-size:0;line-height:0;">&nbsp;</div>
            </td>
          </tr>

          <!-- ══════════════ BLOCK 2 — the GEX heatmap ══════════════ -->
          <tr>
            <td align="center" style="padding:24px 28px 0 28px;">
              <div style="font:800 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.20em;text-transform:uppercase;color:#8ECAE6;">And the heatmap had ${h.ticker}.</div>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:12px 28px 0 28px;">
              <div style="font:900 34px/1.15 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:-0.01em;">${h.ticker} <span style="color:#1FD8A0;">${h.gainPct}</span></div>
              <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8ECAE6;margin-top:8px;">Posted ${h.postedAt} — ${h.postedNote}</div>
            </td>
          </tr>

          <!-- bullets -->
          <tr>
            <td style="padding:20px 32px 4px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="padding:0 0 10px 0;"><span style="color:#1FD8A0;">●</span>&nbsp;&nbsp;<span style="font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">Total net GEX <strong style="color:#ffffff;">${h.netGex}</strong> — positioning leaning one way, and it wasn't down</span></td></tr>
                <tr><td style="padding:0 0 10px 0;"><span style="color:#1FD8A0;">●</span>&nbsp;&nbsp;<span style="font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">Positive gamma stacked <strong style="color:#ffffff;">${h.wallsNote}</strong> — ${h.wallsDetail}</span></td></tr>
                <tr><td style="padding:0 0 4px 0;"><span style="color:#1FD8A0;">●</span>&nbsp;&nbsp;<span style="font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">${h.spotNote}</span></td></tr>
              </table>
            </td>
          </tr>

          <!-- heatmap screenshot -->
          <tr>
            <td align="center" style="padding:18px 32px 0 32px;">
              <a href="${postUrl}" style="text-decoration:none;">
                <img src="${imageUrl}" alt="CB Edge GEX heatmap — ${h.ticker}, total net GEX ${h.netGex}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:1px solid rgba(255,255,255,0.10);border-radius:12px;">
              </a>
              <div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;margin-top:10px;">
                The CB Edge GEX heatmap, posted ${h.postedAt} · <a href="${postUrl}" style="color:#8ECAE6;text-decoration:underline;">see the post</a>
              </div>
            </td>
          </tr>

          <!-- one-of-a-kind callout -->
          <tr>
            <td style="padding:24px 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:#8ECAE6;">Two tools, one session</div>
                    <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:8px;">
                      <strong style="color:#ffffff;">The EDGE</strong> surfaces unusual options flow and ranks it while the tape is still forming. <strong style="color:#ffffff;">The GEX heatmap</strong> shows you where dealer positioning is stacked before the catalyst hits. Both put it in front of you <strong style="color:#8ECAE6;">before</strong> the move, not after. There's nothing else on the market built quite like it.
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
