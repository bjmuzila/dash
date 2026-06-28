import crypto from "crypto";

// Stateless unsubscribe tokens. We HMAC the (normalized) email with a server
// secret so the /unsubscribe link can't be forged and we don't need to store a
// per-recipient token. Falls back to WAITLIST_ADMIN_SECRET if a dedicated
// UNSUBSCRIBE_SECRET isn't set.
const SECRET =
  (process.env.UNSUBSCRIBE_SECRET || process.env.WAITLIST_ADMIN_SECRET || "").trim();

function norm(email: string): string {
  return email.trim().toLowerCase();
}

export function unsubscribeToken(email: string): string {
  if (!SECRET) return "";
  return crypto.createHmac("sha256", SECRET).update(norm(email)).digest("hex").slice(0, 32);
}

export function verifyUnsubscribe(email: string, token: string): boolean {
  if (!SECRET || !token) return false;
  const expected = unsubscribeToken(email);
  if (expected.length !== token.length) return false;
  // constant-time compare
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

function origin(baseUrl?: string): string {
  return (baseUrl || process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
}

// Human-facing confirmation page (footer link). GET → shows a confirm button.
export function unsubscribeUrl(email: string, baseUrl?: string): string {
  const e = encodeURIComponent(norm(email));
  const t = unsubscribeToken(email);
  return `${origin(baseUrl)}/unsubscribe?e=${e}&t=${t}`;
}

// Machine one-click endpoint for the List-Unsubscribe header (RFC 8058).
// Gmail/Apple POST here directly with no UI.
export function unsubscribeApiUrl(email: string, baseUrl?: string): string {
  const e = encodeURIComponent(norm(email));
  const t = unsubscribeToken(email);
  return `${origin(baseUrl)}/api/unsubscribe?e=${e}&t=${t}`;
}

// Standard email footer (HTML) with the unsubscribe link. Append to every
// marketing/broadcast email body.
export function unsubscribeFooterHtml(email: string, baseUrl?: string): string {
  const url = unsubscribeUrl(email, baseUrl);
  return `
  <div style="margin-top:28px;padding-top:16px;border-top:1px solid #1c2230;color:#6b7280;font-size:12px;line-height:1.6;font-family:Inter,Arial,sans-serif">
    You're receiving this because you signed up for CB Edge launch updates.<br/>
    <a href="${url}" style="color:#219EBC;text-decoration:underline">Unsubscribe</a> · CB Edge — market analytics, not financial advice.
  </div>`.trim();
}

export function unsubscribeFooterText(email: string, baseUrl?: string): string {
  return `\n\n—\nYou're receiving this because you signed up for CB Edge launch updates.\nUnsubscribe: ${unsubscribeUrl(email, baseUrl)}`;
}
