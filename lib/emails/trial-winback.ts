// Trial win-back email — "your trial ended; here's your first month at $30".
//
// Sent by app/api/stripe/webhook when a free trial reaches a dead status
// without a dollar ever being collected (see lib/winback.ts for every reason it
// decides NOT to send — abusers, banned addresses, and anyone who has actually
// paid us are all excluded before this template is ever built).
//
// The offer is one month at the offer price, then the normal monthly price —
// that is a Stripe coupon with duration:"once", so "returns to normal pricing"
// is Stripe's own behaviour and not a job anyone has to remember to run.
//
// SENT VIA sendTransactional(), NOT sendAuthEmail(): this is a promotional
// lifecycle nudge and the recipient is entitled to stop receiving them, so it
// carries the unsubscribe footer, the one-click List-Unsubscribe headers and
// UTM tagging. That is the opposite call from lib/emails/trial-banned.ts, which
// is an account-policy notice about something they just did. See
// lib/emails/send.ts for why the two must not share a sender.
//
// THE CODE IS INFORMATIONAL. The promotion code is minted restricted to their
// Stripe customer and pre-applied by the checkout route, so the discount lands
// whether or not they ever click this email. Printing it just lets a human see
// what they were given — never make the copy imply they must type it.
//
// Brand palette mirrors components/shared/homeTheme.ts:
//   bg #05060A · panel #0D1119 · cyan #219EBC · accent text #8ECAE6 · gold #FFB703

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;

export const TRIAL_WINBACK_SUBJECT = "Your trial ended — take a full month for $30";

export interface TrialWinbackOpts {
  /** First-month price, in cents. */
  offerCents: number;
  /** Normal monthly price, in cents — what it renews at. */
  listCents: number;
  /** The single-use code, for the record. Not required to redeem. */
  code: string;
  /** ISO date the offer stops working. */
  expiresAt: string;
  /** Optional first name. Our users table doesn't capture one; kept for later. */
  firstName?: string | null;
}

function money(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

function fmtExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function trialWinbackText(o: TrialWinbackOpts): string {
  // Blank strings are real blank lines; optional blocks are spreads. See the
  // note in trial-banned.ts — filtering empties out collapses every paragraph
  // break in the plain-text part.
  const offer = money(o.offerCents);
  const list = money(o.listCents);
  const until = fmtExpiry(o.expiresAt);
  const saved = money(o.listCents - o.offerCents);

  return [
    `Your trial ended — take a full month for ${offer}`,
    "",
    "Two days is not long enough to judge a tool you'd be trading with, so here is a real one:",
    "",
    `  Your first month: ${offer} (normally ${list} — you save ${saved})`,
    `  After that: ${list}/month, cancel any time`,
    "",
    "It is already attached to your account. Start the monthly plan and the price",
    "is applied at checkout — there is nothing to type.",
    "",
    `${SITE_URL}/pricing`,
    "",
    ...(until ? [`The offer runs out on ${until}.`] : []),
    `Your code, for the record: ${o.code}`,
    "",
    "What a month actually gets you:",
    "  - Live GEX, dealer gamma and the walls that move price, all session",
    "  - Estimated moves and the daily levels, published before the open",
    "  - The options chain, flow and scanner, on the same live feed",
    "  - Everything on the phone build too",
    "",
    "— CB Edge",
  ].join("\n");
}

export function trialWinbackEmail(o: TrialWinbackOpts): string {
  const offer = escapeHtml(money(o.offerCents));
  const list = escapeHtml(money(o.listCents));
  const saved = escapeHtml(money(o.listCents - o.offerCents));
  const until = escapeHtml(fmtExpiry(o.expiresAt));
  const code = escapeHtml(o.code);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(TRIAL_WINBACK_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Two days wasn't long enough. Take a full month for ${offer}, then ${list}/mo — cancel any time.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <tr><td style="height:3px;background:linear-gradient(90deg,rgba(33,158,188,0) 0%,#219EBC 50%,rgba(33,158,188,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <tr>
            <td align="center" style="padding:28px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="220" style="display:block;width:220px;max-width:80%;height:auto;border:0;">
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:22px 32px 4px 32px;">
              <div style="font:800 22px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">Two days wasn't long enough</div>
            </td>
          </tr>

          <tr>
            <td style="padding:14px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                Your free trial has ended. Two sessions is not enough time to judge a tool you'd actually be trading with — so here is a real one, at a price that makes it easy to say yes to.
              </p>
            </td>
          </tr>

          <!-- The offer -->
          <tr>
            <td style="padding:6px 32px 4px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,183,3,0.06);border:1px solid rgba(255,183,3,0.30);border-radius:12px;">
                <tr>
                  <td align="center" style="padding:20px 20px 8px 20px;">
                    <div style="font:400 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;letter-spacing:0.08em;text-transform:uppercase;">Your first month</div>
                    <div style="padding-top:8px;font:800 40px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#FFB703;">${offer}</div>
                    <div style="padding-top:8px;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                      normally <span style="text-decoration:line-through;">${list}</span> — you save ${saved}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:4px 20px 18px 20px;">
                    <div style="font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                      then <strong style="color:#8ECAE6;">${list}/month</strong> — cancel any time
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 32px 0 32px;">
              <p style="margin:0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                It's already attached to your account. Start the monthly plan and the price is applied at checkout — <strong style="color:#8ECAE6;">nothing to type</strong>.
              </p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:18px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:10px;background:#219EBC;">
                    <a href="${SITE_URL}/pricing" style="display:inline-block;padding:13px 30px;font:700 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:10px;">Claim ${offer} for a month &rarr;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:0 32px 18px 32px;">
              <div style="font:400 12px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                ${until ? `Offer runs out on <strong style="color:#8ECAE6;">${until}</strong>. ` : ""}Code <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#8ECAE6;">${code}</span>, for the record.
              </div>
            </td>
          </tr>

          <!-- What a month gets you -->
          <tr>
            <td style="padding:0 32px 8px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;font:700 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">What a month actually gets you</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;">
                ${[
                  "Live GEX, dealer gamma and the walls that move price — all session",
                  "Estimated moves and the daily levels, published before the open",
                  "The options chain, flow and the scanner, on the same live feed",
                  "The phone build, so it's all there when you're not at the desk",
                ]
                  .map(
                    (line) => `<tr>
                  <td width="18" valign="top" style="padding:0 0 8px 0;font:700 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#219EBC;">&bull;</td>
                  <td style="padding:0 0 8px 0;font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">${escapeHtml(line)}</td>
                </tr>`
                  )
                  .join("\n                ")}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                Not for you? No hard feelings — the trial cost you nothing and this email is the last you'll hear about it.
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}
