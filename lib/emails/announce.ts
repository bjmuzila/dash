// Announcement emails for CB Edge: "beta coming soon" (teaser) and "beta is now
// live — join". Email-client-safe HTML (table layout, inline styles), same brand
// shell as lib/emails/welcome.ts.
//
// Audience is chosen at send time in /admin/emails (All / Subscribers / Custom) —
// these templates don't target a list. Unsubscribe: the send route appends a
// per-recipient tokenized footer, so we only render our own link on the webhook
// path (opts.email set) to avoid duplicates.
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const SIGN_UP_URL = `${SITE_URL}/sign-up`;

export interface AnnounceOpts {
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
  /** Override the CTA URL. */
  ctaUrl?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

function footer(email?: string | null): string {
  // Always render an unsubscribe link. Use the recipient's real URL when known
  // (webhook path); otherwise emit the placeholder, which the send route swaps
  // for the per-recipient tokenized URL. Either way, never zero links.
  const unsubHref = email ? escapeHtml(unsubscribeUrl(email)) : UNSUB_URL_PLACEHOLDER;
  return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td align="center" style="padding:18px 32px;">
              <div style="font:400 11px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;">
                CB Edge · You're receiving this because you signed up for updates.<br>
                <a href="${unsubHref}" style="color:#8ECAE6;text-decoration:underline;">Unsubscribe</a>
                &nbsp;·&nbsp;
                <a href="${SITE_URL}" style="color:#6b7d8f;text-decoration:underline;">cbedge.net</a><br>
                <span style="color:#5a6b7d;">Market analytics, not financial advice.</span>
              </div>
            </td>
          </tr>
        </table>`;
}

// Shared dark-brand shell. `inner` is the card's inner rows; `cta` (optional) is
// the button row HTML; `preheader` is the hidden inbox-preview line.
function shell(opts: {
  title: string;
  preheader: string;
  heading: string;
  subheading: string;
  bodyRows: string;
  ctaRow?: string;
  email?: string | null;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <tr><td style="height:3px;background:linear-gradient(90deg,rgba(33,158,188,0) 0%,#219EBC 50%,rgba(33,158,188,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <tr>
            <td align="center" style="padding:28px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="260" style="display:block;width:260px;max-width:88%;height:auto;border:0;">
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:0 32px 4px 32px;">
              <div style="font:800 23px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">${opts.heading}</div>
              <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8ECAE6;margin-top:6px;">${opts.subheading}</div>
            </td>
          </tr>

          ${opts.bodyRows}
          ${opts.ctaRow || ""}
        </table>
${footer(opts.email)}
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function bodyRow(html: string): string {
  return `
          <tr>
            <td style="padding:20px 32px 4px 32px;">
              ${html}
            </td>
          </tr>`;
}

function ctaRow(label: string, href: string): string {
  return `
          <tr>
            <td align="center" style="padding:18px 32px 30px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:10px;background:#219EBC;">
                    <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 32px;font:700 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:10px;">${label}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

/* ───────────────────── Coming soon (teaser, no CTA) ───────────────────── */

export const COMING_SOON_SUBJECT = "Something's coming to CB Edge 👀";

export function comingSoonEmail(opts: AnnounceOpts = {}): string {
  const body = bodyRow(`
              <p style="margin:0 0 14px 0;font:600 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">The beta is almost here.</p>
              <p style="margin:0 0 14px 0;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                We've been building <strong style="color:#219EBC;">CB Edge</strong> — a <strong style="color:#8ECAE6;">real-time options &amp; gamma-exposure</strong> dashboard for index traders. Live GEX, walls and flip levels, Estimated Moves, ES heatmaps, net-premium flow, and a morning briefing, all in one place.
              </p>
              <p style="margin:0 0 6px 0;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                Beta signups open <strong style="color:#8ECAE6;">soon</strong>. You're on the list — we'll email you the moment the doors open. Stay tuned. 🛠️
              </p>`);
  return shell({
    title: COMING_SOON_SUBJECT,
    preheader: "The CB Edge beta is almost here — signups open soon.",
    heading: "Beta signups — coming soon",
    subheading: "Your edge is almost ready.",
    bodyRows: body,
    email: opts.email,
  });
}

export function comingSoonText(opts: AnnounceOpts = {}): string {
  return [
    "The CB Edge beta is almost here.",
    "",
    "CB Edge is a real-time options & gamma-exposure dashboard for index traders — live GEX, walls and flip levels, Estimated Moves, ES heatmaps, net-premium flow, and a morning briefing.",
    "",
    "Beta signups open soon. You're on the list — we'll email you the moment the doors open. Stay tuned.",
    "",
    "— The CB Edge team",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/* ───────────────────── Beta is now live (join CTA) ───────────────────── */

export const BETA_LIVE_SUBJECT = "Beta signups are LIVE — join CB Edge 🚀";

export function betaLiveEmail(opts: AnnounceOpts = {}): string {
  const cta = opts.ctaUrl || SIGN_UP_URL;
  const body = bodyRow(`
              <p style="margin:0 0 14px 0;font:600 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">The wait is over — the doors are open.</p>
              <p style="margin:0 0 14px 0;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                Beta signups for <strong style="color:#219EBC;">CB Edge</strong> are officially <strong style="color:#8ECAE6;">live</strong>. Create your account and get instant access to:
              </p>
              <p style="margin:0 0 6px 0;font:400 14px/1.8 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#aeb9c4;">
                <span style="color:#8ECAE6;">›</span> Live GEX surfaces, call/put walls &amp; flip levels<br>
                <span style="color:#8ECAE6;">›</span> Estimated Moves &amp; weekly customer levels<br>
                <span style="color:#8ECAE6;">›</span> ES candle heatmaps &amp; net-premium flow<br>
                <span style="color:#8ECAE6;">›</span> A morning Traders Dashboard with AI overview
              </p>`);
  return shell({
    title: BETA_LIVE_SUBJECT,
    preheader: "Beta signups are live — create your account and get in.",
    heading: "Beta signups are LIVE 🚀",
    subheading: "Your seat is ready — claim it.",
    bodyRows: body,
    ctaRow: ctaRow("Join the beta →", cta),
    email: opts.email,
  });
}

export function betaLiveText(opts: AnnounceOpts = {}): string {
  const cta = opts.ctaUrl || SIGN_UP_URL;
  return [
    "Beta signups for CB Edge are officially LIVE.",
    "",
    "Create your account and get instant access to:",
    "  • Live GEX surfaces, call/put walls, and flip levels",
    "  • Estimated Moves and weekly customer levels",
    "  • ES candle heatmaps and net-premium flow",
    "  • A morning Traders Dashboard with AI overview",
    "",
    `Join the beta: ${cta}`,
    "",
    "— The CB Edge team",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}
