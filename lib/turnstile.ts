// Cloudflare Turnstile server-side verification.
//
// Enforcement is gated on TURNSTILE_SECRET_KEY: if it's unset, verification is
// SKIPPED (returns ok) so login keeps working before the keys are added. Once
// the secret is set in the VPS env, every login/signup must carry a valid token.
//
// Set:
//   TURNSTILE_SECRET_KEY            (server, from Cloudflare → Turnstile → your site)
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY  (client, baked at build time, used in AuthForm)

const SECRET = (process.env.TURNSTILE_SECRET_KEY || "").trim();
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** True when Turnstile is configured and therefore enforced. */
export function turnstileEnforced(): boolean {
  return !!SECRET;
}

/**
 * Verify a Turnstile token against Cloudflare. Returns { ok } — ok=true when the
 * token is valid, OR when Turnstile isn't configured yet (fail-open only while
 * unconfigured, so a half-set-up deploy doesn't lock everyone out).
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!SECRET) return { ok: true }; // not configured → skip
  if (!token) return { ok: false, error: "captcha-missing" };

  try {
    const body = new URLSearchParams({ secret: SECRET, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);

    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    const data = (await res.json()) as { success?: boolean; ["error-codes"]?: string[] };
    if (data.success) return { ok: true };
    return { ok: false, error: (data["error-codes"] || []).join(",") || "captcha-failed" };
  } catch {
    // Cloudflare unreachable — fail CLOSED on the auth path (deny), since this
    // only runs when Turnstile is deliberately enabled.
    return { ok: false, error: "captcha-unreachable" };
  }
}
