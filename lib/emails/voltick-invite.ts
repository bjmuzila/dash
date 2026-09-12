// Voltick sandbox invite email — "your account is ready, pick a password".
//
// Sent by app/api/admin/voltick-access when the owner grants sandbox access. The
// grant creates the CB Edge account row with NO password, so this mail carries
// the same one-shot token the forgot-password flow uses
// (app/api/auth/reset-password consumes it): the recipient sets a password on
// cbedge.net and that same session opens voltick.cbedge.net. There is no
// sign-up step and no second account.
//
// Goes out via sendAuthEmail(), NOT sendTransactional(): it is a tokenized
// credential link, so it must not carry the marketing unsubscribe footer, the
// List-Unsubscribe headers, or UTM params welded onto the token URL. All three
// push it to spam. See lib/emails/send.ts and the twin in comp-invite.ts.
//
// Palette is VOLTICK's, not CB Edge's, because the thing being granted is the
// Voltick sandbox: ink #0a0d10 · panel #0e1216 · Volt Blue #2f6bff · accent
// text #6aa0ff · paper #e7ece9 · quiet #c0c5c3. See
// `md files/VOLTICK-DESIGN-SYSTEM.md`. Two of its rules bind this file: no grey
// text, and NO EM-DASHES in anything a reader sees.

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const VOLTICK_URL = "https://voltick.cbedge.net";

export const VOLTICK_INVITE_SUBJECT = "Your Voltick sandbox access is ready";

export interface VoltickInviteOpts {
  /** Tokenized /auth/reset-password link, or null when the account already has
   *  a password and only needs telling that the sandbox is open to them. */
  setPasswordUrl: string | null;
  /** Days until the link expires (matches the invite TTL in the admin route). */
  expiresInDays?: number;
  /** ISO expiry of the grant itself, if it is time-limited. */
  accessExpiresAt?: string | null;
}

function fmtExpiry(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function voltickInviteText(opts: VoltickInviteOpts): string {
  const days = opts.expiresInDays ?? 7;
  const until = fmtExpiry(opts.accessExpiresAt);
  const lines = [
    "Your Voltick sandbox access is ready",
    "",
    "You have been given access to the Voltick and CB Edge merger sandbox at",
    VOLTICK_URL,
    "",
  ];
  if (opts.setPasswordUrl) {
    lines.push(
      `An account has been created for you. Set your password to get in (this link expires in ${days} days):`,
      "",
      opts.setPasswordUrl,
      "",
      "Once your password is set, sign in at cbedge.net and open the sandbox link above.",
      "",
      "If the link has expired, go to cbedge.net/sign-in and use “Forgot password?” with this email address. It does the same thing.",
    );
  } else {
    lines.push(
      "Sign in with your existing CB Edge account at cbedge.net, then open the sandbox link above.",
    );
  }
  lines.push("", until ? `Your access runs through ${until}.` : "Your access has no expiry date.", "", "— CB Edge");
  return lines.join("\n");
}

export function voltickInviteEmail(opts: VoltickInviteOpts): string {
  const days = opts.expiresInDays ?? 7;
  const url = opts.setPasswordUrl ? escapeHtml(opts.setPasswordUrl) : null;
  const until = fmtExpiry(opts.accessExpiresAt);

  const body = url
    ? `An account has been created for you on <strong style="color:#6aa0ff;">CB Edge</strong>, and it opens the Voltick sandbox. Pick a password below and you are in. This link expires in <strong style="color:#6aa0ff;">${days} days</strong>.`
    : `Your existing <strong style="color:#6aa0ff;">CB Edge</strong> account now opens the Voltick sandbox. Sign in as usual, then follow the link below.`;

  const cta = url
    ? { href: url, label: "Set your password →" }
    : { href: VOLTICK_URL, label: "Open the sandbox →" };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(VOLTICK_INVITE_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#0a0d10;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your access to the Voltick sandbox is ready.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0d10;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0e1216;border:1px solid #1e2630;border-radius:16px;overflow:hidden;">
          <tr><td style="height:3px;background:linear-gradient(90deg,rgba(47,107,255,0) 0%,#2f6bff 50%,rgba(47,107,255,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <tr>
            <td align="center" style="padding:28px 24px 0 24px;">
              <div style="font:800 13px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:0.18em;color:#6aa0ff;">VOLTICK &middot; CB EDGE</div>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:20px 32px 4px 32px;">
              <div style="font:800 22px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d6ddd8;">Your sandbox access is ready</div>
            </td>
          </tr>

          <tr>
            <td style="padding:14px 32px 4px 32px;">
              <p style="margin:0 0 14px 0;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e7ece9;">${body}</p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:14px 32px 24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:10px;background:#2f6bff;">
                    <a href="${cta.href}" style="display:inline-block;padding:13px 30px;font:700 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e7ece9;text-decoration:none;border-radius:10px;">${cta.label}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 8px 32px;">
              <div style="font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#c0c5c3;">
                The sandbox lives at <a href="${VOLTICK_URL}" style="color:#6aa0ff;text-decoration:none;">voltick.cbedge.net</a>.${
                  until ? ` Your access runs through <strong style="color:#6aa0ff;">${escapeHtml(until)}</strong>.` : ""
                }
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 28px 32px;">
              <div style="border-top:1px solid #1e2630;padding-top:16px;font:400 13px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#c0c5c3;">
                ${
                  url
                    ? `Link expired? Go to <a href="${SITE_URL}/sign-in" style="color:#6aa0ff;text-decoration:none;">cbedge.net/sign-in</a> and use &ldquo;Forgot password?&rdquo; with this email address. It does the same thing.`
                    : `Trouble signing in? Use &ldquo;Forgot password?&rdquo; at <a href="${SITE_URL}/sign-in" style="color:#6aa0ff;text-decoration:none;">cbedge.net/sign-in</a> with this email address.`
                }
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
