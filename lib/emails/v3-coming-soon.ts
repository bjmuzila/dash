// "Version 3 of CB Edge is coming soon" — teaser announcement for the v3 build.
//
// Same dark shell / cyan accent / table layout as seasonality-free.ts and the
// rest of lib/emails. Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC ·
// accent #8ECAE6 · body #d4dde6.
//
// The hero screenshot lives at public/v3-preview-es-candles.png so it is served
// from the site itself (email clients need an absolute, publicly reachable URL —
// never a data: URI, Gmail strips those).

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";
import { brandLogoUrl } from "@/lib/brand";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = brandLogoUrl(SITE_URL);
const PREVIEW_IMG = `${SITE_URL}/v3-preview-es-candles.png`;
const SITE_CTA = `${SITE_URL}/whats-new`;

export interface V3ComingSoonOpts {
  /** Override the CTA (defaults to the What's New page). */
  ctaUrl?: string;
  /** Override the hero screenshot. */
  imageUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

export const V3_COMING_SOON_SUBJECT = "Version 3 of CB Edge is coming soon…";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** The feature list, in one place so the HTML and text bodies cannot drift. */
const FEATURES: { icon: string; title: string; note: string }[] = [
  {
    icon: "⚡",
    title: "Faster charts",
    note: "Rebuilt rendering pipeline — levels, gamma and candles paint the moment the data lands.",
  },
  {
    icon: "🧩",
    title: "Customize layouts",
    note: "Drag, resize and save your own panel arrangement. Your screen, your order.",
  },
  {
    icon: "🔔",
    title: "State of the art alerts",
    note: "Level, gamma and flow triggers that fire where you watch — not twenty minutes later.",
  },
  {
    icon: "🧭",
    title: "Easy navigation",
    note: "One toolbar, everything one click deep. No more hunting for the page you want.",
  },
  {
    icon: "⏪",
    title: "Replays",
    note: "Scrub back through any session and watch the tape rebuild itself bar by bar.",
  },
];

/** Plain-text fallback. */
export function v3ComingSoonText(opts: V3ComingSoonOpts = {}): string {
  const cta = opts.ctaUrl || SITE_CTA;
  return [
    "CB EDGE · REAL EDGE. REAL ORDERFLOW.",
    "",
    "COMING SOON",
    "",
    "Version 3 of cbedge.net is coming soon....",
    "",
    "A full rebuild of the dashboard — faster, cleaner, and yours to arrange.",
    "Here is what is landing:",
    "",
    ...FEATURES.flatMap((f) => [`${f.title}`, `  ${f.note}`, ""]),
    "No action needed. Version 3 arrives in your existing account.",
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
export function v3ComingSoonEmail(opts: V3ComingSoonOpts = {}): string {
  const cta = escapeHtml(opts.ctaUrl || SITE_CTA);
  const img = escapeHtml(opts.imageUrl || PREVIEW_IMG);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  const sans = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

  const featureRows = FEATURES.map(
    (f, i) => `
                <tr>
                  <td style="padding:${i === 0 ? "0" : "14px"} 0 0 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="34" valign="top" style="font:400 20px/1.2 ${sans};color:#8ECAE6;">${f.icon}</td>
                        <td valign="top">
                          <div style="font:800 15px/1.3 ${sans};color:#ffffff;">${escapeHtml(f.title)}</div>
                          <div style="padding-top:5px;font:400 13px/1.65 ${sans};color:#9fb3c8;">${escapeHtml(f.note)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ${i < FEATURES.length - 1 ? `<tr><td style="padding-top:14px;"><div style="border-top:1px solid rgba(255,255,255,0.08);"></div></td></tr>` : ""}`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(V3_COMING_SOON_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Faster charts, custom layouts, state of the art alerts, easy navigation and full session replays.</div>
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

          <!-- COMING SOON PILL -->
          <tr>
            <td align="center" style="padding:20px 28px 0 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.45);border-radius:999px;background:rgba(33,158,188,0.12);">
                <tr>
                  <td style="padding:9px 20px;font:800 12px/1 ${sans};letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;">
                    Coming soon
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td align="center" style="padding:18px 28px 0 28px;">
              <div style="font:900 32px/1.12 ${sans};color:#ffffff;letter-spacing:-0.01em;">Version <span style="color:#219EBC;">3</span> of cbedge.net<br>is coming soon<span style="color:#219EBC;">....</span></div>
              <div style="font:400 15px/1.65 ${sans};color:#d4dde6;margin-top:14px;">
                A full rebuild of the dashboard — <strong style="color:#ffffff;">faster</strong>, cleaner,
                and finally yours to arrange. Same account, same login, nothing for you to do.
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
                      <img src="${img}" alt="CB Edge v3 — ES candles with live GEX levels" width="504" style="display:block;width:100%;max-width:504px;height:auto;border:0;">
                    </a>
                  </td>
                </tr>
              </table>
              <div style="font:400 12px/1.6 ${sans};color:#6b7d8f;padding-top:10px;">A first look — ES candles with live gamma levels overlaid.</div>
            </td>
          </tr>

          <!-- FEATURES -->
          <tr>
            <td style="padding:26px 28px 0 28px;">
              <div style="font:700 11px/1 ${sans};letter-spacing:0.14em;text-transform:uppercase;color:#8ECAE6;padding-bottom:14px;">What&rsquo;s landing</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${featureRows}
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:26px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:12px;background:#219EBC;">
                    <a href="${cta}" style="display:block;padding:17px 24px;font:900 16px/1 ${sans};letter-spacing:0.04em;text-transform:uppercase;color:#05060A;text-decoration:none;border-radius:12px;">See what&rsquo;s coming 👉</a>
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
                Version 3 arrives in your existing account. No migration, no re-signup.<br>
                <span style="color:#8ECAE6;font-weight:600;">— Bzila, founder of CB Edge</span>
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
