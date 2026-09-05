// "We gave away the seasonality almanac" — announces the free, no-signup page at
// /explore/seasonality and uses the calendar window we are actually standing in
// (late Aug into Sep) as the hook.
//
// Same dark shell / cyan accent / table layout as midnight-300.ts and the rest
// of lib/emails. Brand palette: bg #05060A · panel #0D1119 · cyan #219EBC ·
// accent #8ECAE6 · body #d4dde6.
//
// ── ON THE NUMBERS ──────────────────────────────────────────────────────────
// Every figure below is a SNAPSHOT of components/seasonality/seasonalityData.ts
// as generated 2026-08-21 (SPX daily closes 1928-01-03 → 2026-08-21, 24,777
// sessions; the VIX study 1990-01-02 → 2026-08-21, 9,227 joined sessions).
//
// They are hardcoded ON PURPOSE rather than imported from that module: an email
// is a point-in-time artifact, and importing a 280KB auto-generated data blob
// into the email layer to render four numbers is the wrong trade. The cost is
// that these go stale — so if this template is ever re-sent in a different part
// of the calendar, re-pull the four stats AND rewrite the "right now" card,
// which is dated language, not a constant.
//
// The seasonal window quoted ("Aug 24 → Sep 30") is ALMANAC.now.window; the
// rest-of-year counterweight is ALMANAC.now.rest_of_year. Both are deliberately
// shown together — the seasonal soft patch alone is a half-truth, and this list
// has seen enough one-sided stat emails.

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";
import { brandLogoUrl } from "@/lib/brand";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = brandLogoUrl(SITE_URL);
const ALMANAC_URL = `${SITE_URL}/explore/seasonality`;
const TRIAL_URL = `${SITE_URL}/pricing`;

export interface SeasonalityFreeOpts {
  /** Override the primary CTA (defaults to the free almanac page). */
  ctaUrl?: string;
  /** Override the secondary CTA (defaults to the pricing/trial page). */
  trialUrl?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

export const SEASONALITY_FREE_SUBJECT =
  "Free: 98 years of S&P 500 seasonality. No signup, no paywall";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** The four headline stats, in one place so the HTML and text bodies cannot drift. */
const STATS: { label: string; value: string; note: string }[] = [
  {
    label: "Worst month on record",
    value: "−1.12%",
    note: "September, the only month negative across the whole 98-year record. 44.9% positive, n=98.",
  },
  {
    label: "Turn of the month",
    value: "+8.9 bp/day",
    note: "T−4…T+3 averages +8.9 bp a session against +0.3 bp for the rest of the month. 25% annualized vs 0.8%.",
  },
  {
    label: "After VIX +20%",
    value: "+0.26%",
    note: "Prev close → high. Next session open→close, 59.9% positive, n=284. Baseline: +0.03% / 53.5%.",
  },
  {
    label: "Highest volatility month",
    value: "October",
    note: "25.2% annualized. Survives every sample window and every decade in the file.",
  },
];

/** Plain-text fallback. */
export function seasonalityFreeText(opts: SeasonalityFreeOpts = {}): string {
  const cta = opts.ctaUrl || ALMANAC_URL;
  const trial = opts.trialUrl || TRIAL_URL;
  return [
    "CB EDGE · REAL EDGE. REAL ORDERFLOW.",
    "",
    "FREE · NO ACCOUNT NEEDED",
    "",
    "98 years of S&P 500 seasonality, recomputed.",
    "",
    "I pulled every SPX daily close back to 1928, all 24,777 sessions, and rebuilt the",
    "seasonal almanac from the raw data instead of copying someone else's table.",
    "It is free, it is not gated, and there is nothing to sign up for.",
    "",
    cta,
    "",
    "WHERE WE ARE RIGHT NOW",
    "",
    "Aug 24 -> Sep 30, all 98 years:  -1.01% average, 46.9% positive.",
    "Since 1985 (41 years):           -0.88% average, 51.2% positive.",
    "The back half of September is the weak part: -0.91% vs -0.24% for Sep 1-15.",
    "",
    "The other side of it, because one number on its own is a half-truth:",
    "from this trading day to year-end, the average year is +2.16% and 70.4% of",
    "years finish higher. Weak stretch inside a strong stretch.",
    "",
    "FOUR THINGS IN THE FILE",
    "",
    ...STATS.flatMap((s) => [`${s.label}: ${s.value}`, `  ${s.note}`, ""]),
    "ALSO IN THERE",
    "",
    "Month by month · every year x every month heatmap · turn of the month ·",
    "day of week · monthly and quarterly opex week and the week after ·",
    "last day of the month and quarter · VIX spike study · the two half-years ·",
    "presidential and decennial cycles · volatility by month · year overlays",
    "(pick any years and lay them against 2026).",
    "",
    "Every table prints its sample size. Where the evidence gets thin, you can see it.",
    "",
    cta,
    "",
    "---",
    "",
    "Seasonality tells you the weather. It does not tell you the day.",
    "A 98-year average is a weak prior about a distribution. Where price actually",
    "goes tomorrow needs the order flow. That part is the dashboard: live SPX gamma,",
    "flip levels, options flow. 2 days free, then $45/month, one tier, cancel anytime.",
    "",
    `Start a trial: ${trial}`,
    "",
    "— Bzila, founder of CB Edge",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
    "Market analytics, not financial advice.",
  ].join("\n");
}

/** Branded HTML announcement. */
export function seasonalityFreeEmail(opts: SeasonalityFreeOpts = {}): string {
  const cta = escapeHtml(opts.ctaUrl || ALMANAC_URL);
  const trial = escapeHtml(opts.trialUrl || TRIAL_URL);
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  const sans = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

  const statRows = STATS.map(
    (s, i) => `
                <tr>
                  <td style="padding:${i === 0 ? "0" : "14px"} 0 0 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font:700 11px/1 ${sans};letter-spacing:0.14em;text-transform:uppercase;color:#8ECAE6;">${escapeHtml(s.label)}</td>
                        <td align="right" style="font:900 22px/1 ${sans};color:#ffffff;white-space:nowrap;">${escapeHtml(s.value)}</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top:6px;font:400 13px/1.6 ${sans};color:#9fb3c8;">${escapeHtml(s.note)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ${i < STATS.length - 1 ? `<tr><td style="padding-top:14px;"><div style="border-top:1px solid rgba(255,255,255,0.08);"></div></td></tr>` : ""}`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(SEASONALITY_FREE_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">24,777 SPX sessions back to 1928, rebuilt from the raw closes. Free, ungated, nothing to sign up for.</div>
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

          <!-- FREE PILL -->
          <tr>
            <td align="center" style="padding:20px 28px 0 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.45);border-radius:999px;background:rgba(33,158,188,0.12);">
                <tr>
                  <td style="padding:9px 20px;font:800 12px/1 ${sans};letter-spacing:0.16em;text-transform:uppercase;color:#8ECAE6;">
                    Free &middot; no account needed
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td align="center" style="padding:18px 28px 0 28px;">
              <div style="font:900 32px/1.12 ${sans};color:#ffffff;letter-spacing:-0.01em;">98 years of S&amp;P 500<br><span style="color:#219EBC;">seasonality</span>, recomputed.</div>
              <div style="font:400 15px/1.65 ${sans};color:#d4dde6;margin-top:14px;">
                I pulled every SPX daily close back to 1928, all <strong style="color:#ffffff;">24,777 sessions</strong>, and rebuilt the
                seasonal almanac from the raw data instead of copying someone else's table.
                It is free, it is not gated, and there is nothing to sign up for.
              </div>
            </td>
          </tr>

          <!-- PRIMARY CTA -->
          <tr>
            <td align="center" style="padding:24px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:12px;background:#219EBC;">
                    <a href="${cta}" style="display:block;padding:17px 24px;font:900 16px/1 ${sans};letter-spacing:0.04em;text-transform:uppercase;color:#05060A;text-decoration:none;border-radius:12px;">Open the free almanac 👉</a>
                  </td>
                </tr>
              </table>
              <div style="font:400 12px/1.6 ${sans};color:#6b7d8f;padding-top:10px;word-break:break-all;">${cta}</div>
            </td>
          </tr>

          <!-- WHERE WE ARE RIGHT NOW -->
          <tr>
            <td style="padding:26px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(33,158,188,0.30);border-radius:12px;background:linear-gradient(180deg,rgba(33,158,188,0.10),rgba(33,158,188,0.02));">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font:700 11px/1 ${sans};letter-spacing:0.14em;text-transform:uppercase;color:#8ECAE6;">Where we are right now</div>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
                      <tr>
                        <td style="font:600 14px/1.5 ${sans};color:#ffffff;">Aug 24 → Sep 30 · all 98 years</td>
                        <td align="right" style="font:900 18px/1 ${sans};color:#ff5b5b;white-space:nowrap;">−1.01%</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top:4px;font:400 13px/1.5 ${sans};color:#9fb3c8;">46.9% of years positive · n=98</td>
                      </tr>
                      <tr>
                        <td style="padding-top:12px;font:600 14px/1.5 ${sans};color:#ffffff;">Same window, since 1985</td>
                        <td align="right" style="padding-top:12px;font:900 18px/1 ${sans};color:#ff5b5b;white-space:nowrap;">−0.88%</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top:4px;font:400 13px/1.5 ${sans};color:#9fb3c8;">51.2% positive · n=41 · the back half of September is the weak part (−0.91% vs −0.24%)</td>
                      </tr>
                    </table>

                    <div style="border-top:1px solid rgba(255,255,255,0.10);margin:16px 0 0 0;"></div>

                    <div style="font:400 13px/1.65 ${sans};color:#d4dde6;padding-top:14px;">
                      And the other side of it, because one number on its own is a half-truth:
                      from this trading day to year-end the average year is
                      <strong style="color:#30d158;">+2.16%</strong> and
                      <strong style="color:#30d158;">70.4%</strong> of years finish higher.
                      A weak stretch sitting inside a strong one.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- FOUR STATS -->
          <tr>
            <td style="padding:26px 28px 0 28px;">
              <div style="font:700 11px/1 ${sans};letter-spacing:0.14em;text-transform:uppercase;color:#8ECAE6;padding-bottom:14px;">Four things in the file</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${statRows}
              </table>
            </td>
          </tr>

          <!-- WHAT ELSE -->
          <tr>
            <td style="padding:26px 28px 0 28px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:18px;">
                <div style="font:700 11px/1 ${sans};letter-spacing:0.14em;text-transform:uppercase;color:#8ECAE6;">Also in there</div>
                <div style="font:400 14px/1.75 ${sans};color:#d4dde6;padding-top:10px;">
                  Month by month &middot; every year &times; every month heatmap &middot; turn of the month &middot;
                  day of week &middot; monthly and quarterly opex week and the week after &middot;
                  last day of the month and quarter &middot; the VIX spike study &middot; the two half-years &middot;
                  presidential and decennial cycles &middot; volatility by month &middot;
                  and a year overlay: pick any years and lay them against 2026.
                </div>
                <div style="font:400 13px/1.65 ${sans};color:#9fb3c8;padding-top:12px;">
                  Every table prints its sample size. Where the evidence gets thin, you can see it getting thin.
                </div>
              </div>
            </td>
          </tr>

          <!-- SECONDARY: the paid thing -->
          <tr>
            <td style="padding:26px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(255,255,255,0.10);border-radius:12px;background:rgba(255,255,255,0.03);">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font:800 15px/1.4 ${sans};color:#ffffff;">Seasonality tells you the weather. It doesn't tell you the day.</div>
                    <div style="font:400 13px/1.65 ${sans};color:#9fb3c8;padding-top:8px;">
                      A 98-year average is a weak prior about a distribution. Where price actually goes tomorrow
                      needs the order flow: live SPX gamma, flip levels, options flow. That part is the dashboard:
                      <strong style="color:#8ECAE6;">2 days free</strong>, then $45/month, one tier, cancel anytime.
                    </div>
                    <div style="padding-top:14px;">
                      <a href="${trial}" style="display:inline-block;padding:11px 20px;border-radius:10px;border:1px solid rgba(33,158,188,0.55);background:rgba(33,158,188,0.12);font:800 14px/1 ${sans};color:#8ECAE6;text-decoration:none;">Start a 2-day free trial →</a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- sign-off -->
          <tr>
            <td style="padding:22px 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;text-align:center;font:400 13px/1.7 ${sans};color:#9fb3c8;">
                Send it to whoever you want. No login wall on the other end.<br>
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
