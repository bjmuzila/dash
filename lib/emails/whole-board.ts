// "The Whole Board" — one-screen dashboard announcement.
//
// Same dark shell / cyan accent / table layout as v3-coming-soon.ts and the
// rest of lib/emails. Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC ·
// accent #8ECAE6 · body #d4dde6.
//
// The hero screenshot lives at public/whole-board-preview.png so it is served
// from the site itself (email clients need an absolute, publicly reachable URL —
// never a data: URI, Gmail strips those).

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";
import { brandLogoUrl } from "@/lib/brand";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = brandLogoUrl(SITE_URL);
const PREVIEW_IMG = `${SITE_URL}/whole-board-preview.png`;
const SITE_CTA = `${SITE_URL}/app/board`;

export interface WholeBoardOpts {
  /** Override the CTA (defaults to the Board page). */
  ctaUrl?: string;
  /** Override the hero screenshot. */
  imageUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

export const WHOLE_BOARD_SUBJECT = "One screen. The whole board.";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** What is actually on the board, in one place so HTML and text cannot drift. */
const PANELS: { icon: string; title: string; note: string }[] = [
  {
    icon: "🎯",
    title: "Key levels rail",
    note: "Put wall, gamma flip, max pain, call wall and the weekly EM band — the whole map across the top.",
  },
  {
    icon: "📊",
    title: "Gauge rail",
    note: "Net GEX, dealer delta, gamma's share of volume, net GEX rate and 0DTE GEX — live, at a glance.",
  },
  {
    icon: "🕯️",
    title: "ES candles + Multi Greek",
    note: "Futures with your levels painted on, next to SPX/SPY/NVDA/MSFT strike ladders.",
  },
  {
    icon: "💵",
    title: "Net premium + GEX chart",
    note: "Calls vs puts premium through the session, and the strike-by-strike gamma profile underneath it.",
  },
  {
    icon: "📅",
    title: "Econ calendar + flow tape",
    note: "Today's releases and the live block prints, side by side. Past events gray out on their own.",
  },
];

/** Plain-text fallback. */
export function wholeBoardText(opts: WholeBoardOpts = {}): string {
  const cta = opts.ctaUrl || SITE_CTA;
  return [
    "CB EDGE · REAL EDGE. REAL ORDERFLOW.",
    "",
    "THE WHOLE BOARD",
    "",
    "Nine panels. One screen. No tab hopping.",
    "",
    "The Board puts every read you use in a session on a single page —",
    "and lets you drag, resize and save the arrangement so it opens the",
    "way you left it.",
    "",
    ...PANELS.flatMap((p) => [`${p.title}`, `  ${p.note}`, ""]),
    "Drag any card, resize it, drop the ones you don't use. The layout",
    "saves to your account.",
    "",
    cta,
    "",
    "— Bzila, founder of CB Edge",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
    "Market analytics, not financial advice.",
  ].join("\n");
}

/** Branded HTML announcement. */
export function wholeBoardEmail(opts: WholeBoardOpts = {}): string {
  const cta = escapeHtml(opts.ctaUrl || SITE_CTA);
  const img = escapeHtml(opts.imageUrl || PREVIEW_IMG);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  const sans = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

  const panelRows = PANELS.map(
    (p, i) => `
                <tr>
                  <td style="padding:${i === 0 ? "0" : "14px"} 0 0 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="34" valign="top" style="font:400 20px/1.2 ${sans};color:#8ECAE6;">${p.icon}</td>
                        <td valign="top">
                          <div style="font:800 15px/1.3 ${sans};color:#ffffff;">${escapeHtml(p.title)}</div>
                          <div style="padding-top:5px;font:400 13px/1.65 ${sans};color:#9fb3c8;">${escapeHtml(p.note)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ${i < PANELS.length - 1 ? `<tr><td style="padding-top:14px;"><div style="border-top:1px solid rgba(255,255,255,0.08);"></div></td></tr>` : ""}`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(WHOLE_BOARD_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Levels, gauges, candles, ladders, premium, gamma, econ and flow — all on one page you can rearrange.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <!-- accent bar -->
          <tr><td style="height:3px;background:linear-gradient(90deg,rgba(33,158,188,0) 0%,#219EBC 50%,rgba(33,158,188,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- logo -->
          <tr>
            <td align="center" style="padding:28px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="260" style="display:block;width:260px;max-width:60%;height:auto;border:0;">
            </td>
          </tr>

          <!-- PILL -->
          <tr>
            <td align="center" style="padding:20px 28px 0 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.45);border-radius:999px;background:rgba(33,158,188,0.12);">
                <tr>
                  <td style="padding:9px 20px;font:800 12px/1 ${sans};letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;">
                    The Board
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td align="center" style="padding:18px 28px 0 28px;">
              <div style="font:900 32px/1.12 ${sans};color:#ffffff;letter-spacing:-0.01em;">One screen.<br>The <span style="color:#219EBC;">whole</span> board<span style="color:#219EBC;">.</span></div>
              <div style="font:400 15px/1.65 ${sans};color:#d4dde6;margin-top:14px;">
                Every read you actually use in a session, on <strong style="color:#ffffff;">one page</strong> —
                and yours to drag, resize and save. No tab hopping, no re-loading the same data nine times.
              </div>
            </td>
          </tr>

          <!-- PREVIEW IMAGE -->
          <tr>
            <td align="center" style="padding:24px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;overflow:hidden;background:#05060A;">
                <tr>
                  <td style="font-size:0;line-height:0;">
                    <a href="${cta}" style="text-decoration:none;">
                      <img src="${img}" alt="CB Edge — the whole board on one screen" width="504" style="display:block;width:100%;max-width:504px;height:auto;border:0;">
                    </a>
                  </td>
                </tr>
              </table>
              <div style="font:400 12px/1.6 ${sans};color:#6b7d8f;padding-top:10px;">The board at Tuesday&rsquo;s close &mdash; levels, gauges, candles, ladders, premium, gamma, econ and flow.</div>
            </td>
          </tr>

          <!-- PANELS -->
          <tr>
            <td style="padding:26px 28px 0 28px;">
              <div style="font:700 11px/1 ${sans};letter-spacing:0.14em;text-transform:uppercase;color:#8ECAE6;padding-bottom:14px;">What&rsquo;s on it</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${panelRows}
              </table>
            </td>
          </tr>

          <!-- CALLOUT -->
          <tr>
            <td style="padding:24px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:rgba(33,158,188,0.08);">
                <tr>
                  <td style="padding:16px 18px;font:400 13px/1.7 ${sans};color:#d4dde6;">
                    <strong style="color:#8ECAE6;">It&rsquo;s your layout.</strong> Drag a card anywhere, resize it,
                    remove the ones you don&rsquo;t use. The arrangement saves to your account and the board opens
                    the way you left it.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:26px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:12px;background:#219EBC;">
                    <a href="${cta}" style="display:block;padding:17px 24px;font:900 16px/1 ${sans};letter-spacing:0.04em;text-transform:uppercase;color:#05060A;text-decoration:none;border-radius:12px;">Open the board 👉</a>
                  </td>
                </tr>
              </table>
              <div style="font:400 12px/1.6 ${sans};color:#6b7d8f;padding-top:10px;word-break:break-all;">${cta}</div>
            </td>
          </tr>

          <!-- sign-off -->
          <tr>
            <td style="padding:22px 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;text-align:center;font:400 13px/1.7 ${sans};color:#9fb3c8;">
                Already in your account &mdash; nothing to install, nothing to set up.<br>
                <span style="color:#8ECAE6;font-weight:600;">&mdash; Bzila, founder of CB Edge</span>
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
