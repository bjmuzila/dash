// Social-proof / feature email for the /test Confidence tab — CB (Core
// Bullseye) hit-rate track record at the three daily checkpoints (9:45,
// 10:30, 12:00). Companion to scanner-catch.ts / flow-catch.ts — same
// "here's the real number" intent, sourced from the Confidence tracker
// instead of a single trade. Data-driven via opts.windows so this gets
// reused for next week's numbers without touching the layout.
//
// No personal name — signed generically. Email-client-safe HTML (table
// layout, inline styles), same brand shell as the other emails.
//
// IMPORTANT — before sending: this ends in a big "2 days free" trial push.
// That claim only holds if trial_period_days is actually set on the live
// Stripe Price(s). Checkout (app/api/stripe/checkout/route.ts) intentionally
// does NOT set a trial in code — it's applied automatically from whatever
// the Price has configured in the Stripe dashboard. Confirm that's set to 2
// days before this goes out.
//
// Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6 ·
// gain-blue #38BDF8 · orange #FB8501

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const PRICING_URL = `${SITE_URL}/pricing`;

export interface CbWindow {
  time: string; // e.g. "9:45"
  days: string; // e.g. "7 DAYS"
  hitRatePct: string; // e.g. "71%"
  hitFraction: string; // e.g. "5/7"
  avgClosest: string; // e.g. "8.6 pt"
}

export interface CbConfidenceOpts {
  windows?: CbWindow[];
  /** Override the CTA URL (defaults to /pricing). */
  ctaUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

const DEFAULT_WINDOWS: CbWindow[] = [
  { time: "9:45", days: "7 DAYS", hitRatePct: "71%", hitFraction: "5/7", avgClosest: "8.6 pt" },
  { time: "10:30", days: "7 DAYS", hitRatePct: "86%", hitFraction: "6/7", avgClosest: "4.7 pt" },
  { time: "12:00", days: "7 DAYS", hitRatePct: "86%", hitFraction: "6/7", avgClosest: "8.4 pt" },
];

export const CB_CONFIDENCE_SUBJECT = "The CB level hit up to 86% of the time this week";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** Plain-text fallback. */
export function cbConfidenceText(opts: CbConfidenceOpts = {}): string {
  const w = opts.windows || DEFAULT_WINDOWS;
  const cta = opts.ctaUrl || PRICING_URL;
  return [
    "THE CB LEVEL HAS BEEN HITTING ALL WEEK.",
    "",
    "CB — Core Bullseye at 9:45 / 10:30 / 12:00 · how close SPX got · hit = within 8 pts",
    "",
    ...w.map((x) => `${x.time} (${x.days}) — ${x.hitRatePct} hit rate (${x.hitFraction}) · avg closest ${x.avgClosest}`),
    "",
    "The CB level updates live all session — not a backfit. The tracker grades every hit automatically, every day.",
    "",
    "TRY IT FREE FOR 2 DAYS. No commitment. Cancel anytime.",
    "",
    `Start my free trial: ${cta}`,
    "",
    "— The CB Edge Team",
    "",
    "cbedge.net · not financial advice",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML CB-confidence email. */
export function cbConfidenceEmail(opts: CbConfidenceOpts = {}): string {
  const w = opts.windows || DEFAULT_WINDOWS;
  const cta = escapeHtml(opts.ctaUrl || PRICING_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  const card = (x: CbWindow) => `
                <td width="33%" valign="top" style="padding:0 6px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(255,255,255,0.10);border-radius:12px;background:rgba(255,255,255,0.02);">
                    <tr><td style="padding:16px 14px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                        <td style="font:800 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">${x.time}</td>
                        <td align="right" style="font:700 10px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.08em;color:#6b7d8f;">${x.days}</td>
                      </tr></table>
                      <div style="font:800 26px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#38BDF8;margin-top:10px;">${x.hitRatePct} <span style="font:700 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;">(${x.hitFraction})</span></div>
                      <div style="font:600 11px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;margin-top:8px;">avg closest <span style="color:#FB8501;font-weight:800;">${x.avgClosest}</span></div>
                    </td></tr>
                  </table>
                </td>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(CB_CONFIDENCE_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">CB Core Bullseye: 71-86% hit rate across 9:45, 10:30 and 12:00 this week — graded automatically, every day.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <!-- accent bar -->
          <tr><td style="height:4px;background:linear-gradient(90deg,rgba(56,189,248,0) 0%,#38BDF8 50%,rgba(56,189,248,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- logo -->
          <tr>
            <td align="center" style="padding:30px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="260" style="display:block;width:260px;max-width:88%;height:auto;border:0;">
            </td>
          </tr>

          <!-- tag -->
          <tr>
            <td align="center" style="padding:22px 28px 0 28px;">
              <div style="font:800 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.20em;text-transform:uppercase;color:#8ECAE6;">Confidence tracker</div>
            </td>
          </tr>

          <!-- headline -->
          <tr>
            <td align="center" style="padding:12px 28px 0 28px;">
              <div style="font:900 30px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:-0.01em;">The CB level has been <span style="color:#38BDF8;">hitting all week.</span></div>
              <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:12px;max-width:480px;">
                <strong style="color:#8ECAE6;">CB — Core Bullseye</strong> at 9:45, 10:30 &amp; 12:00 · how close SPX got · a hit is within 8 pts.
              </div>
            </td>
          </tr>

          <!-- stat cards -->
          <tr>
            <td style="padding:22px 22px 4px 22px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                ${w.map(card).join("")}
              </tr></table>
            </td>
          </tr>

          <!-- credibility callout -->
          <tr>
            <td style="padding:22px 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:#8ECAE6;">Not a backfit</div>
                    <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:8px;">
                      The CB level updates <strong style="color:#ffffff;">live</strong> all session, and the tracker grades every hit automatically — every day, no cherry-picking after the fact.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- BIG TRIAL CTA -->
          <tr>
            <td align="center" style="padding:26px 28px 8px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(56,189,248,0.35);border-radius:16px;background:radial-gradient(circle at 50% 0%,rgba(56,189,248,0.16) 0%,transparent 70%),rgba(56,189,248,0.04);">
                <tr>
                  <td align="center" style="padding:28px 20px;">
                    <div style="font:700 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;">Trade this level yourself</div>
                    <div style="font:900 40px/1.05 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:12px;letter-spacing:-0.02em;">2 days free</div>
                    <div style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;margin-top:8px;">No commitment. Cancel anytime.</div>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;"><tr>
                      <td align="center" style="border-radius:12px;background:#219EBC;">
                        <a href="${cta}" style="display:inline-block;padding:16px 44px;font:800 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:12px;">Start my free trial →</a>
                      </td>
                    </tr></table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- sign-off -->
          <tr>
            <td align="center" style="padding:18px 28px 30px 28px;">
              <div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;">— The CB Edge Team</div>
            </td>
          </tr>
        </table>

        <!-- footer -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;">
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
