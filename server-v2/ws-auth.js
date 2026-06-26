/**
 * ws-auth.js — connection gate for the /ws/gex broadcaster.
 *
 * PURPOSE
 *   The WebSocket carries the paid product (live SPX GEX). Without this gate,
 *   anyone who knows the URL can stream it for free. This module verifies, at
 *   upgrade time, that the connecting user is (a) a real signed-in Clerk user
 *   and (b) either the owner or an active/trialing subscriber — the SAME rule
 *   the pages enforce via lib/subscription.getAccessForUser.
 *
 * HOW IT AUTHENTICATES (cookie-based — no client changes)
 *   The browser automatically sends the Clerk session cookie with the WS upgrade
 *   request (same-origin). We hand the upgrade request to Clerk's backend
 *   authenticateRequest(), which validates that cookie and returns the signed-in
 *   userId. No token needs to be threaded through the 7+ client call sites.
 *
 *   NOTE: cookie auth is reliable on a PRODUCTION Clerk instance (first-party
 *   cookie on your domain). On a dev instance (*.accounts.dev) the handshake
 *   cookie is less reliable for non-navigational requests, so enable
 *   WS_AUTH_REQUIRED only once you're on production Clerk.
 *
 * SAFETY
 *   - Controlled by env WS_AUTH_REQUIRED (checked by the caller). This module
 *     never enables itself.
 *   - Fail-closed when enabled: anything it can't positively verify → ok:false.
 *     The owner is allowed even if the subscription DB lookup fails, so a billing
 *     hiccup can't lock the owner out.
 *   - Keep PAID_STATUSES in sync with lib/db.ts.
 */

'use strict';

const PAID_STATUSES = new Set(['active', 'trialing']); // sync with lib/db.ts
const OWNER_USER_ID = (process.env.OWNER_USER_ID || '').trim();

// ── Clerk backend client ─────────────────────────────────────────────────────
let _clerk = null;
function getClerk() {
  if (_clerk) return _clerk;
  const { createClerkClient } = require('@clerk/backend');
  _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  return _clerk;
}

// ── Subscription lookup (own small pool, mirrors server-with-proxy style) ────
let _authPool = null;
let _authPoolDown = false;
function getAuthPool() {
  if (_authPoolDown) return null;
  if (_authPool) return _authPool;
  if (!process.env.DATABASE_URL) { _authPoolDown = true; return null; }
  try {
    const { Pool } = require('pg');
    _authPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    _authPool.on('error', (e) => {
      console.warn('[ws-auth] pool error (will reconnect):', e.message);
      try { _authPool?.end().catch(() => {}); } catch {}
      _authPool = null;
    });
    return _authPool;
  } catch {
    _authPoolDown = true;
    return null;
  }
}

async function getStatusForUser(userId) {
  const pool = getAuthPool();
  if (!pool) return null;
  const r = await pool.query(
    'SELECT status FROM subscriptions WHERE clerk_user_id = $1 LIMIT 1',
    [userId]
  );
  return r.rows?.[0]?.status ?? null;
}

/** Same decision as lib/subscription.getAccessForUser, JS side. */
async function getAccessForUser(userId) {
  if (OWNER_USER_ID && userId === OWNER_USER_ID) return { ok: true, reason: 'owner' };
  const status = await getStatusForUser(userId);
  if (status == null) return { ok: false, reason: 'no-subscription' };
  if (PAID_STATUSES.has(status)) return { ok: true, reason: 'subscribed', status };
  return { ok: false, reason: 'inactive', status };
}

/**
 * Build a minimal Fetch-API Request that mirrors the WS upgrade request, so
 * Clerk's authenticateRequest() can read the cookie/headers from it. We only
 * need headers (cookie, authorization, origin, host) — there's no body.
 */
function toFetchRequest(upgradeReq) {
  const host = upgradeReq.headers.host || 'localhost';
  // Scheme doesn't matter for cookie reading; use https so Clerk treats it as secure.
  const url = `https://${host}${upgradeReq.url || '/'}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(upgradeReq.headers || {})) {
    if (Array.isArray(v)) headers.set(k, v.join(', '));
    else if (v != null) headers.set(k, String(v));
  }
  return new Request(url, { method: 'GET', headers });
}

/**
 * Verify a WS upgrade request via the Clerk session cookie.
 * Returns { ok, userId?, reason }. Only call when WS_AUTH_REQUIRED === "1".
 */
async function verifyWsRequest(upgradeReq) {
  if (!process.env.CLERK_SECRET_KEY) {
    console.error('[ws-auth] CLERK_SECRET_KEY missing — rejecting (auth required)');
    return { ok: false, reason: 'server-misconfig' };
  }

  let userId;
  try {
    const clerk = getClerk();
    const req = toFetchRequest(upgradeReq);
    // authorizedParties guards against cookies minted for other origins; include
    // your production origin(s). Falls back to permissive if env unset.
    const authorizedParties = (process.env.CLERK_AUTHORIZED_PARTIES || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const requestState = await clerk.authenticateRequest(req, {
      ...(authorizedParties.length ? { authorizedParties } : {}),
    });
    if (!requestState.isSignedIn) {
      return { ok: false, reason: requestState.reason || 'not-signed-in' };
    }
    const authData = requestState.toAuth();
    userId = authData?.userId;
  } catch (e) {
    return { ok: false, reason: 'verify-error', detail: e?.message };
  }
  if (!userId) return { ok: false, reason: 'no-user' };

  try {
    const access = await getAccessForUser(userId);
    return access.ok
      ? { ok: true, userId, reason: access.reason }
      : { ok: false, userId, reason: access.reason };
  } catch (e) {
    console.error('[ws-auth] access lookup failed:', e?.message);
    return { ok: false, userId, reason: 'access-error' };
  }
}

module.exports = {
  verifyWsRequest,
  getAccessForUser, // exported for unit testing
  PAID_STATUSES,
};
