// Password-reset email — branded to match founder-thankyou.ts / the dashboard
// theme (table layout, inline styles, dark palette) instead of the bare-bones
// plain HTML the forgot-password route used at first.
//
// Brand palette mirrors components/shared/homeTheme.ts:
//   bg #05060A · panel #0D1119 · cyan #219EBC · accent text #8ECAE6

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;

export const RESET_PASSWORD_SUBJECT = "Reset your CB Edge password";

export interface ResetPasswordOpts {
  resetUrl: string;
  /** Minutes until the link expires (matches app/api/auth/forgot-password's RESET_TTL_MS). */
  expiresInMinutes?: number;
  /** Overrides the rendered expiry phrase, for TTLs that read badly in minutes
   *  (a 7-day admin link is "7 days", not "10080 minutes"). */
  expiresLabel?: string;
  /** Sent by the owner from the Sales page rather than requested by the
   *  customer. Two lines have to change: the customer didn't ask for this, and
   *  — unlike a self-service reset — their old password has ALREADY been
   *  cleared, so "ignore this and nothing changes" would be a lie. */
  adminInitiated?: boolean;
}

function expiryPhrase(opts: ResetPasswordOpts): string {
  if (opts.expiresLabel) return opts.expiresLabel;
  return `${opts.expiresInMinutes ?? 60} minutes`;
}

export function resetPasswordText(opts: ResetPasswordOpts): string {
  const expires = expiryPhrase(opts);
  const intro = opts.adminInitiated
    ? `We've reset the password on your CB Edge account so you can get back in. Set a new one here — this link expires in ${expires}:`
    : `We received a request to reset your password. This link expires in ${expires}:`;
  const footer = opts.adminInitiated
    ? "Your old password no longer works. If this link expires before you use it, click “Forgot password?” on the sign-in page and we'll send a fresh one."
    : "If you didn't request this, you can safely ignore this email — your password won't change.";
  return [
    "Reset your CB Edge password",
    "",
    intro,
    "",
    opts.resetUrl,
    "",
    footer,
    "",
    "— CB Edge",
  ].join("\n");
}

export function resetPasswordEmail(opts: ResetPasswordOpts): string {
  const expires = escapeHtml(expiryPhrase(opts));
  const url = escapeHtml(opts.resetUrl);

  const intro = opts.adminInitiated
    ? `We've reset the password on your <strong style="color:#219EBC;">CB Edge</strong> account so you can get back in. Click below to choose a new one — this link expires in <strong style="color:#8ECAE6;">${expires}</strong>.`
    : `We received a request to reset the password on your <strong style="color:#219EBC;">CB Edge</strong> account. Click below to choose a new one — this link expires in <strong style="color:#8ECAE6;">${expires}</strong>.`;

  const footer = opts.adminInitiated
    ? `Your old password no longer works. If this link expires before you use it, click &ldquo;Forgot password?&rdquo; on the sign-in page and we&rsquo;ll send a fresh one.`
    : `If you didn't request this, you can safely ignore this email — your password won't change.`;

  const preheader = opts.adminInitiated
    ? `Set a new CB Edge password — this link expires in ${expires}.`
    : `Reset your CB Edge password — this link expires in ${expires}.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(RESET_PASSWORD_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
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
              <div style="font:800 22px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">${opts.adminInitiated ? "Set a new password" : "Reset your password"}</div>
            </td>
          </tr>

          <tr>
            <td style="padding:14px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">
                ${intro}
              </p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:14px 32px 24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:10px;background:#219EBC;">
                    <a href="${url}" style="display:inline-block;padding:13px 30px;font:700 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#05060A;text-decoration:none;border-radius:10px;">Set a new password →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 28px 32px;">
              <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">
                ${footer}
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
