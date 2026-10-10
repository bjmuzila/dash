// Custom Google Sign-In (OAuth2 authorization-code flow), replacing Supabase's
// signInWithOAuth. No Supabase, no third-party auth SDK -- just the standard
// Google endpoints + Node's built-in crypto for id_token verification.
//
// Flow: browser -> GET /api/auth/google/start (redirects to Google) -> user
// approves -> Google redirects to /auth/callback?code=... -> exchange code for
// tokens -> verify id_token -> find-or-create user -> create our own session.

import { createHash, createVerify, createPublicKey, randomBytes } from "crypto";

const CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || "").trim();

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export function googleConfigured(): boolean {
  return !!CLIENT_ID && !!CLIENT_SECRET;
}

/** Random anti-CSRF value the caller stores in a short-lived cookie and
 *  compares against the `state` Google echoes back on /auth/callback. */
export function newOAuthState(): string {
  return randomBytes(16).toString("base64url");
}

export function buildGoogleAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

interface TokenResponse {
  id_token: string;
  access_token: string;
  expires_in: number;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed (${res.status}): ${detail}`);
  }
  return res.json();
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

// ── JWKS (Google's RS256 public keys), cached with the endpoint's own max-age.
interface Jwk { kid: string; n: string; e: string; kty: string }
let jwksCache: { at: number; ttlMs: number; keys: Jwk[] } | null = null;

async function getGoogleJwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < jwksCache.ttlMs) return jwksCache.keys;
  const res = await fetch(JWKS_ENDPOINT);
  if (!res.ok) throw new Error(`Failed to fetch Google JWKS (${res.status})`);
  const cacheControl = res.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const ttlMs = maxAgeMatch ? Math.max(60_000, Number(maxAgeMatch[1]) * 1000) : 3600_000;
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache = { at: Date.now(), ttlMs, keys: body.keys };
  return body.keys;
}

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Verifies signature, issuer, audience, and expiry on a Google id_token (JWT).
 *  Throws with a descriptive message on any failure -- callers should treat any
 *  throw as "reject the sign-in", never fall back to trusting the token. */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed id_token");
  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(b64urlToBuffer(headerB64).toString("utf8")) as { kid: string; alg: string };
  if (header.alg !== "RS256") throw new Error(`Unexpected id_token alg: ${header.alg}`);

  const payload = JSON.parse(b64urlToBuffer(payloadB64).toString("utf8")) as Record<string, unknown>;

  const keys = await getGoogleJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("No matching Google JWKS key (kid not found)");

  const publicKey = createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  const signature = b64urlToBuffer(sigB64);
  if (!verifier.verify(publicKey, signature)) throw new Error("id_token signature verification failed");

  const iss = String(payload.iss || "");
  if (!ISSUERS.has(iss)) throw new Error(`Unexpected id_token issuer: ${iss}`);
  const aud = String(payload.aud || "");
  if (aud !== CLIENT_ID) throw new Error("id_token audience mismatch");
  const exp = Number(payload.exp || 0);
  if (!exp || exp * 1000 < Date.now()) throw new Error("id_token expired");

  const sub = String(payload.sub || "");
  const email = String(payload.email || "").trim().toLowerCase();
  if (!sub || !email) throw new Error("id_token missing sub/email");

  return {
    sub,
    email,
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    name: typeof payload.name === "string" ? payload.name : undefined,
  };
}

/** Stable per-state hash for the anti-CSRF cookie, so the cookie itself never
 *  needs to be the plaintext state value (defense in depth, cheap to add). */
export function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}
