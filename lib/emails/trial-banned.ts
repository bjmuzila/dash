// "The free trial is no longer available on this account" notice.
//
// Sent when a trial checkout is refused by an OWNER-ISSUED BAN
// (lib/db.ts -> trial_bans), either automatically the first time the banned
// email/IP tries again (app/api/stripe/checkout) or on demand from the Sales
// page's Trial Abuse panel (app/api/admin/trial-bans).
//
// It is NOT sent for the ordinary one-trial-per-email rule. That case is a
// returning customer who simply buys the plan, and telling them "you have used
// the trial numerous times" would be both wrong and insulting. Only a deliberate
// ban reaches this template.
//
// TONE: factual, short, and it does NOT close the door on the sale. The point of
// the message is "no more free trials", not "go away" — the subscribe link is
// right there, because a trial farmer who gives up and pays is a win.
//
// SENT VIA sendAuthEmail(), not sendTransactional(): this is an account-policy
// notice about an action the recipient just took, so it must not carry the
// marketing unsubscribe footer or the List-Unsubscribe (bulk) headers. Someone
// cannot opt out of being told why their checkout behaved differently, and
// declaring it bulk would pool it with the promo blasts. See lib/emails/send.ts.
//
// Brand palette mirrors components/shared/homeTheme.ts:
//   bg #05060A · panel #0D1119 · cyan #219EBC · accent text #8ECAE6

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const PRICING_URL = `${SITE_URL}/pricing`;
const SUPPORT_EMAIL = (process.env.SUPPORT_EMAIL || "hello@cbedge.net").trim();

export const TRIAL_BANNED_SUBJECT = "About the free trial on your CB Edge account";

export interface TrialBannedOpts {
  /** How many times the trial has already been started/claimed, when known.
   *  Omitted or < 2 falls back to wording that doesn't quote a number. */
  attempts?: number | null;
  /**
   * Owner's note, printed VERBATIM to the recipient.
   *
   * Only ever populated when the admin panel's "quote reason" box is ticked,
   * because the reason field is an INTERNAL note by default and most of them
   * read like one ("serial abuser, 6 addresses"). Tick that box only for a
   * sentence written for the customer to read, in whole words — whatever is in
   * here lands in their inbox exactly as typed, over the CB Edge name.
   */
  note?: string | null;
}

/** "used it more than once" without inventing a count we don't actually have. */
function usageLine(attempts: number | null | undefined): string {
  return attempts && attempts >= 2
    ? `Our records show the 2-day free trial has been started ${attempts} times from this account.`
    : "Our records show the 2-day free trial has already been used more than once from this account.";
}

export function trialBannedText(opts: TrialBannedOpts = {}): string {
  // Blank strings here are real blank lines. An optional block is a SPREAD, not
  // a "" the array is filtered for afterwards — filtering empties out is how the
  // first version of this silently collapsed every paragraph break in the
  // plain-text part, which is the half spam filters read most closely.
  return [
    "About the free trial on your CB Edge account",
    "",
    usageLine(opts.attempts),
    "",
    "The free trial is a one-time offer, so it is no longer available on this account.",
    "",
    "Nothing else changes: you can still sign in, and you can subscribe at any time —",
    "checkout will simply start billing right away instead of after two free days.",
    "",
    PRICING_URL,
    "",
    ...(opts.note ? [`Note: ${opts.note}`, ""] : []),
    `If you think this is a mistake, reply to this email or write to ${SUPPORT_EMAIL} and we'll take a look.`,
    "",
    "— CB Edge",
  ].join("\n");
}

export function trialBannedEmail(opts: TrialBannedOpts = {}): string {
  const usage = escapeHtml(usageLine(opts.attempts));
  const note = opts.note ? escapeHtml(opts.note) : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(TRIAL_BANNED_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">The free trial is a one-time offer and is no longer available on this account.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <tr><td style="height:3px;background:linear-gradient(90deg,rgba(251,133,1,0) 0%,#FB8501 50%,rgba(251,133,1,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <tr>
            <td align="center" style="padding:28px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="220" style="display:block;width:220px;max-width:80%;height:auto;border:0;">
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:22px 32px 4px 32px;">
              <div style="font:800 22px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">About your free trial</div>
            </td>
          </tr>

          <tr>
            <td style="padding:14px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                ${usage}
              </p>
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                The trial is a <strong style="color:#FFB703;">one-time offer</strong>, so it is no longer available on this account.
              </p>
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                Nothing else changes. You can still sign in, and you can subscribe whenever you like — checkout will simply start billing right away instead of after two free days.
              </p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:14px 32px 24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:10px;background:#219EBC;">
                    <a href="${PRICING_URL}" style="display:inline-block;padding:13px 30px;font:700 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:10px;">See plans &rarr;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
${note ? `
          <tr>
            <td style="padding:0 32px 8px 32px;">
              <div style="font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px 14px;">
                ${note}
              </div>
            </td>
          </tr>
` : ""}
          <tr>
            <td style="padding:16px 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                Think this is a mistake? Reply to this email or write to <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:#8ECAE6;text-decoration:none;">${escapeHtml(SUPPORT_EMAIL)}</a> and we'll take a look.
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
