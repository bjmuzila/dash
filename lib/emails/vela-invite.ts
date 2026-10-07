// Vela beta-tester invite email: "you're in the Vela beta, pick a password".
//
// Sent by app/api/admin/vela-beta when the owner adds a beta tester. A twin of
// voltick-invite.ts (read that file's header for why it goes out through
// sendAuthEmail and carries no unsubscribe footer). Differences:
//   - It points at vela.cbedge.net, the ONLY thing a beta grant opens.
//   - The set-password link carries ?next=https://vela.cbedge.net/ so the
//     reset page hands them to sign-in, and sign-in hands them to Vela, instead
//     of dropping them on cbedge.net where they have no access.
//
// Voltick palette, no grey text, no em-dashes in anything a reader sees.

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const VELA_URL = "https://vela.cbedge.net";

export const VELA_INVITE_SUBJECT = "You are in the Vela charts beta";

export interface VelaInviteOpts {
  /** Tokenized /auth/reset-password link, or null when the account already has
   *  a password and only needs telling that Vela is open to them. */
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

export function velaInviteText(opts: VelaInviteOpts): string {
  const days = opts.expiresInDays ?? 7;
  const until = fmtExpiry(opts.accessExpiresAt);
  const lines = [
    "You are in the Vela charts beta",
    "",
    "You have been added as a beta tester for Vela charts at",
    VELA_URL,
    "",
  ];
  if (opts.setPasswordUrl) {
    lines.push(
      `An account has been created for you. Set your password to get in (this link expires in ${days} days):`,
      "",
      opts.setPasswordUrl,
      "",
      "Once your password is set, sign in and you will be taken straight to Vela. Your login works on vela.cbedge.net only.",
      "",
      "If the link has expired, go to cbedge.net/sign-in and use “Forgot password?” with this email address. It does the same thing.",
    );
  } else {
    lines.push(
      "Sign in with your existing account at cbedge.net, then open the Vela link above.",
    );
  }
  lines.push("", until ? `Your access runs through ${until}.` : "Your access has no expiry date.", "", "Voltick");
  return lines.join("\n");
}

export function velaInviteEmail(opts: VelaInviteOpts): string {
  const days = opts.expiresInDays ?? 7;
  const url = opts.setPasswordUrl ? escapeHtml(opts.setPasswordUrl) : null;
  const until = fmtExpiry(opts.accessExpiresAt);

  const body = url
    ? `You have been added to the <strong style="color:#6aa0ff;">Vela charts</strong> beta. An account has been made for you; pick a password below and you will land on Vela. This link expires in <strong style="color:#6aa0ff;">${days} days</strong>.`
    : `Your existing account now opens the <strong style="color:#6aa0ff;">Vela charts</strong> beta. Sign in as usual, then follow the link below.`;

  const cta = url
    ? { href: url, label: "Set your password →" }
    : { href: VELA_URL, label: "Open Vela →" };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(VELA_INVITE_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#0a0d10;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">You are in the Vela charts beta.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0d10;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#0e1216;border:1px solid #1e2630;border-radius:16px;overflow:hidden;">
          <tr><td style="height:3px;background:linear-gradient(90deg,rgba(47,107,255,0) 0%,#2f6bff 50%,rgba(47,107,255,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <tr>
            <td align="center" style="padding:28px 24px 0 24px;">
              <div style="font:800 13px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:0.18em;color:#6aa0ff;">VOLTICK &middot; VELA BETA</div>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:20px 32px 4px 32px;">
              <div style="font:800 22px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d6ddd8;">Welcome to the Vela beta</div>
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
                Vela lives at <a href="${VELA_URL}" style="color:#6aa0ff;text-decoration:none;">vela.cbedge.net</a>. Your login opens Vela only.${
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
