// Comped-access invite email — "your account is ready, pick a password".
//
// Sent by app/api/admin/comp-access when the owner grants a comp. The grant
// creates the account row with NO password, so this mail carries the same kind
// of one-shot token the forgot-password flow uses (app/api/auth/reset-password
// consumes it) — the recipient sets a password and is straight into a full
// paid-tier account. There is no sign-up step for them at all.
//
// It goes out via sendAuthEmail(), NOT sendTransactional(): it is a tokenized
// credential link the recipient must be able to click, so it must not carry the
// marketing unsubscribe footer, the List-Unsubscribe (bulk) headers, or UTM
// params welded onto the token URL. All three push it to spam. See
// lib/emails/send.ts.
//
// Brand palette mirrors components/shared/homeTheme.ts:
//   bg #05060A · panel #0D1119 · cyan #219EBC · accent text #8ECAE6

import { brandLogoUrl } from "@/lib/brand";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = brandLogoUrl(SITE_URL);

export const COMP_INVITE_SUBJECT = "Your CB Edge access is ready — set your password";

export interface CompInviteOpts {
  /** Tokenized /auth/reset-password link. */
  setPasswordUrl: string;
  /** Days until the link expires (matches the invite TTL in the admin route). */
  expiresInDays?: number;
  /** ISO expiry of the comp itself, if it is time-limited. */
  compExpiresAt?: string | null;
}

function fmtCompExpiry(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function compInviteText(opts: CompInviteOpts): string {
  const days = opts.expiresInDays ?? 7;
  const until = fmtCompExpiry(opts.compExpiresAt);
  return [
    "Your CB Edge access is ready",
    "",
    "An account has been created for you with full CB Edge access — no card, no subscription.",
    "",
    `Set your password to get in (this link expires in ${days} days):`,
    "",
    opts.setPasswordUrl,
    "",
    until ? `Your access runs through ${until}.` : "Your access has no expiry date.",
    "",
    "If the link has expired, go to cbedge.net/sign-in and use “Forgot password?” with this email address — it does the same thing.",
    "",
    "— CB Edge",
  ].join("\n");
}

export function compInviteEmail(opts: CompInviteOpts): string {
  const days = opts.expiresInDays ?? 7;
  const url = escapeHtml(opts.setPasswordUrl);
  const until = fmtCompExpiry(opts.compExpiresAt);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(COMP_INVITE_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your CB Edge account is ready — set a password to sign in.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <tr><td style="height:3px;background:linear-gradient(90deg,rgba(33,158,188,0) 0%,#219EBC 50%,rgba(33,158,188,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <tr>
            <td align="center" style="padding:28px 24px 0 24px;">
              <img src="${LOGO_URL}" alt="CB Edge" width="260" style="display:block;width:260px;max-width:80%;height:auto;border:0;">
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:22px 32px 4px 32px;">
              <div style="font:800 22px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">Your access is ready</div>
            </td>
          </tr>

          <tr>
            <td style="padding:14px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                An account has been created for you on <strong style="color:#219EBC;">CB Edge</strong> with full access — no card, no subscription. Pick a password below and you're in. This link expires in <strong style="color:#8ECAE6;">${days} days</strong>.
              </p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:14px 32px 24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:10px;background:#219EBC;">
                    <a href="${url}" style="display:inline-block;padding:13px 30px;font:700 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:10px;">Set your password →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
${until ? `
          <tr>
            <td style="padding:0 32px 8px 32px;">
              <div style="font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                Your access runs through <strong style="color:#8ECAE6;">${escapeHtml(until)}</strong>.
              </div>
            </td>
          </tr>
` : ""}
          <tr>
            <td style="padding:0 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                Link expired? Go to <a href="${SITE_URL}/sign-in" style="color:#8ECAE6;text-decoration:none;">cbedge.net/sign-in</a> and use “Forgot password?” with this email address — it does the same thing.
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
