// "You made an account and never came back" — the discounted nudge.
//
// The sibling of lib/emails/trial-winback.ts, and deliberately a different
// letter. A lapsed trialer has SEEN the product and decided; this person has
// only ever seen the sign-up form, so the job here is to show them what is
// behind it, not to re-argue a decision they never made. Same offer, different
// argument.
//
// Sent by the nightly sweep (app/api/internal/lifecycle-emails) to accounts
// with no subscription, no trial, and no other offer — see
// getSignupNoPurchaseCandidates() for everyone it excludes.
//
// sendTransactional(), like the win-back: this is promotional, so it carries
// the unsubscribe footer and the one-click List-Unsubscribe headers. It is the
// email the sign-up page's "adds you to our email list" line is warning about,
// and that line and this footer are the two halves of the same promise.
//
// ONE PER PERSON, EVER — the trial_winback primary key. If they later start a
// trial and lapse, they do NOT also get the win-back; they already had their
// discount.
//
// Brand palette mirrors components/shared/homeTheme.ts:
//   bg #05060A · panel #0D1119 · cyan #219EBC · accent text #8ECAE6 · gold #FFB703

import { brandLogoUrl } from "@/lib/brand";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = brandLogoUrl(SITE_URL);

export const SIGNUP_NUDGE_SUBJECT = "You never did take a look — here's your first month for $30";

export interface SignupNudgeOpts {
  /** First-month price, in cents. */
  offerCents: number;
  /** Normal monthly price, in cents — what it renews at. */
  listCents: number;
  /** The single-use code, for the record. Not required to redeem. */
  code: string;
  /** ISO date the offer stops working. */
  expiresAt: string;
}

function money(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

function fmtExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** What they'd actually open it for, in the order a trader would care. */
const WHAT_IT_DOES: [string, string][] = [
  ["Where the market is pinned", "Live SPX gamma exposure, the flip level and the call/put walls — updated all session, not a nightly PDF."],
  ["What today's range should be", "Estimated moves and the daily levels, published before the open and graded after the close."],
  ["What the flow is doing", "Net premium, the options tape and the scanner, on the same live feed as everything else."],
  ["On the phone too", "The whole thing is built for a phone screen, not shrunk down to one."],
];

export function signupNudgeText(o: SignupNudgeOpts): string {
  const offer = money(o.offerCents);
  const list = money(o.listCents);
  const saved = money(o.listCents - o.offerCents);
  const until = fmtExpiry(o.expiresAt);

  return [
    `You made a CB Edge account — here's your first month for ${offer}`,
    "",
    "You signed up and never got as far as looking around. Fair enough — here is a",
    "reason to, at a price that makes it an easy call:",
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
    "What you'd actually be opening every morning:",
    ...WHAT_IT_DOES.map(([t, b]) => `  - ${t} — ${b}`),
    "",
    "— CB Edge",
  ].join("\n");
}

export function signupNudgeEmail(o: SignupNudgeOpts): string {
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
<title>${escapeHtml(SIGNUP_NUDGE_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">You made an account and never looked around. First month ${offer}, then ${list}/mo — cancel any time.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <tr><td style="height:3px;background:linear-gradient(90deg,rgba(33,158,188,0) 0%,#219EBC 50%,rgba(33,158,188,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <tr>
            <td align="center" style="padding:28px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="300" style="display:block;width:300px;max-width:88%;height:auto;border:0;">
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:22px 32px 4px 32px;">
              <div style="font:800 22px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">You never did take a look</div>
            </td>
          </tr>

          <tr>
            <td style="padding:14px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                You made a CB Edge account and never got as far as looking around. Fair enough — here's a reason to, at a price that makes it an easy call.
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
                    <a href="${SITE_URL}/pricing" style="display:inline-block;padding:13px 30px;font:700 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:10px;">Get a month for ${offer} &rarr;</a>
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

          <!-- What it actually does — this reader has never seen the product -->
          <tr>
            <td style="padding:0 32px 8px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;font:700 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">What you'd be opening every morning</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
                ${WHAT_IT_DOES.map(
                  ([title, body]) => `<tr>
                  <td style="padding:0 0 12px 0;">
                    <div style="font:700 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8ECAE6;">${escapeHtml(title)}</div>
                    <div style="padding-top:3px;font:400 13px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">${escapeHtml(body)}</div>
                  </td>
                </tr>`
                ).join("\n                ")}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                You're getting this because you made an account at cbedge.net. If it isn't for you, the unsubscribe link below stops these for good.
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
