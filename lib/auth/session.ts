// Opaque DB-backed session tokens for the custom auth system.
//
// Why opaque + DB-backed instead of a JWT: is_paid must reflect a Stripe
// cancellation almost immediately (the paywall gate depends on it), and the
// owner flag must be instantly revocable. A JWT would either go stale for its
// whole lifetime or require the same DB hit anyway to check for revocation --
// so there's no real perf win over just looking the session up directly. A
// short in-memory cache below bounds the DB load per session to ~1 query per
// CACHE_TTL_MS, the same pattern middleware.ts already uses for the
// maintenance flag.

import { randomBytes, createHash } from "crypto";
import { insertSession, getSessionWithUser, deleteSession, type SessionWithUser } from "@/lib/db";

export const SESSION_COOKIE = "cbe_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Optional parent-domain for the session cookie. Set SESSION_COOKIE_DOMAIN=.cbedge.net
// in PRODUCTION so a single sign-in is shared across cbedge.net and its subdomains
// (e.g. owner.cbedge.net, which serves the standalone owner-vite app). Leave it
// UNSET in local dev — browsers reject a dotted domain on localhost and would
// silently drop the cookie, logging you out. Empty string → undefined → host-only.
const SESSION_COOKIE_DOMAIN = (process.env.SESSION_COOKIE_DOMAIN || "").trim() || undefined;

// Canonical attributes for the cbe_session cookie. Centralized so every SET and
// CLEAR (login / signup / google-callback / logout) uses the SAME name+domain+path
// — a cookie can only be overwritten or cleared by a Set-Cookie that matches how
// it was created. Call with the max-age to set; pass 0 (with value "") to clear.
export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    domain: SESSION_COOKIE_DOMAIN,
    maxAge,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a session row and returns the raw token to set as the cookie value.
 *  The raw token is never persisted -- only its hash. */
export async function createSession(
  userId: string,
  meta?: { userAgent?: string | null; ip?: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await insertSession({
    token_hash: hashToken(token),
    user_id: userId,
    expires_at: expiresAt,
    user_agent: meta?.userAgent ?? null,
    ip: meta?.ip ?? null,
  });
  return { token, expiresAt };
}

export async function destroySessionByToken(token: string): Promise<void> {
  await deleteSession(hashToken(token));
}

// ── Short-lived validation cache ─────────────────────────────────────────────
// Keyed on token hash (never the raw token). Bounds DB load under heavy
// traffic (this runs in middleware, on every gated request) while keeping paid
// / owner revocation effectively near-instant.
const CACHE_TTL_MS = 8000;
const cache = new Map<string, { at: number; value: SessionWithUser | null }>();

export interface ResolvedSession {
  userId: string;
  email: string;
  isOwner: boolean;
  isPaid: boolean;
}

export async function validateSessionToken(token: string | undefined | null): Promise<ResolvedSession | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);

  const cached = cache.get(tokenHash);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value ? toResolved(cached.value) : null;
  }

  let row: SessionWithUser | undefined;
  try {
    row = await getSessionWithUser(tokenHash);
  } catch (err) {
    // A transient DB hiccup should fail CLOSED (signed-out), never open.
    console.error("[auth/session] validate failed:", err);
    return null;
  }
  cache.set(tokenHash, { at: Date.now(), value: row ?? null });
  // Cap cache growth -- this process never restarts on its own under normal ops.
  if (cache.size > 5000) {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
  }
  return row ? toResolved(row) : null;
}

function toResolved(row: SessionWithUser): ResolvedSession {
  return { userId: row.user_id, email: row.email, isOwner: !!row.is_owner, isPaid: !!row.is_paid };
}

/** Call after any action that changes a session's user's owner/paid state
 *  (rare) or after logout, so a stale cache entry can't outlive the DB row by
 *  more than CACHE_TTL_MS. Not required for the common cases (Stripe webhook
 *  changes are picked up within CACHE_TTL_MS automatically). */
export function invalidateSessionCache(token: string): void {
  cache.delete(hashToken(token));
}

export const SESSION_COOKIE_MAX_AGE_SEC = Math.floor(SESSION_TTL_MS / 1000);
