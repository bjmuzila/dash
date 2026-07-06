/**
 * ws-auth.js — connection gate for the /ws/gex broadcaster (custom auth).
 *
 * PURPOSE
 *   The WebSocket carries the paid product (live SPX GEX). Without this gate,
 *   anyone who knows the URL can stream it for free. This module verifies, at
 *   upgrade time, that the connecting user has a valid session cookie and is
 *   either the owner or an active/trialing subscriber — the SAME rule the
 *   pages enforce via lib/subscription.getAccessForUser.
 *
 * HOW IT AUTHENTICATES (cookie-based — no client changes)
 *   The browser automatically sends our session cookie (`cbe_session`, an
 *   opaque random token — see lib/auth/session.ts) with the WS upgrade request
 *   (same-origin). We sha256-hash it and look up the (session, user,
 *   subscription) row directly in Postgres — the same join
 *   lib/db.ts's getSessionWithUser() runs, duplicated here in raw SQL since
 *   this file is plain CommonJS (server-v2 isn't part of the Next/TS build).
 *
 * SAFETY
 *   - Controlled by env WS_AUTH_REQUIRED (checked by the caller). Never self-enables.
 *   - Fail-closed when enabled: anything it can't positively verify → ok:false.
 *     The owner is allowed even if the subscription DB lookup fails, so a billing
 *     hiccup can't lock the owner out.
 *   - Keep PAID_STATUSES / SESSION_COOKIE in sync with lib/db.ts / lib/auth/session.ts.
 */

'use strict';

const crypto = require('crypto');

const PAID_STATUSES = new Set(['active', 'trialing']); // sync with lib/db.ts
const OWNER_USER_ID = (process.env.OWNER_USER_ID || '').trim();
const SESSION_COOKIE = 'cbe_session'; // sync with lib/auth/session.ts

// ── DB pool (own small pool, mirrors server-with-proxy style) ───────────────
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

/** Session -> { userId, isOwner, isPaid } or null. Mirrors
 *  lib/db.ts's getSessionWithUser() (sessions JOIN users LEFT JOIN subscriptions). */
async function getSessionForToken(rawToken) {
  const pool = getAuthPool();
  if (!pool) return null;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const r = await pool.query(
    `SELECT s.user_id, u.is_owner,
            COALESCE(sub.status IN ('active','trialing'), FALSE) AS is_paid
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN subscriptions sub ON sub.clerk_user_id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()
      LIMIT 1`,
    [tokenHash]
  );
  const row = r.rows?.[0];
  if (!row) return null;
  return { userId: row.user_id, isOwner: !!row.is_owner, isPaid: !!row.is_paid };
}

/** Same decision as lib/subscription.getAccessForUser, JS side. */
function getAccessFor(session) {
  if (OWNER_USER_ID && session.userId === OWNER_USER_ID) return { ok: true, reason: 'owner' };
  if (session.isOwner) return { ok: true, reason: 'owner' };
  if (session.isPaid) return { ok: true, reason: 'subscribed' };
  return { ok: false, reason: 'inactive' };
}

// ── Cookie parsing ────────────────────────────────────────────────────────
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * Verify a WS upgrade request via the session cookie.
 * Returns { ok, userId?, reason }. Only call when WS_AUTH_REQUIRED === "1".
 */
async function verifyWsRequest(upgradeReq) {
  if (!process.env.DATABASE_URL) {
    console.error('[ws-auth] DATABASE_URL missing — rejecting (auth required)');
    return { ok: false, reason: 'server-misconfig' };
  }

  let session;
  try {
    const cookies = parseCookies(upgradeReq.headers && upgradeReq.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (!token) return { ok: false, reason: 'no-token' };

    session = await getSessionForToken(token);
    if (!session) return { ok: false, reason: 'invalid-or-expired-session' };
  } catch (e) {
    return { ok: false, reason: 'verify-error', detail: e?.message };
  }

  const access = getAccessFor(session);
  return access.ok
    ? { ok: true, userId: session.userId, reason: access.reason }
    : { ok: false, userId: session.userId, reason: access.reason };
}

/** Same decision, keyed directly on a userId (no session token) — exported
 *  for unit testing, mirrors lib/subscription.ts's getAccessForUser. */
async function getAccessForUser(userId) {
  if (OWNER_USER_ID && userId === OWNER_USER_ID) return { ok: true, reason: 'owner' };
  const pool = getAuthPool();
  if (!pool) return { ok: false, reason: 'no-subscription' };
  const r = await pool.query(
    `SELECT u.is_owner, sub.status
       FROM users u
       LEFT JOIN subscriptions sub ON sub.clerk_user_id = u.id
      WHERE u.id = $1 LIMIT 1`,
    [userId]
  );
  const row = r.rows?.[0];
  if (row?.is_owner) return { ok: true, reason: 'owner' };
  const status = row?.status ?? null;
  if (status == null) return { ok: false, reason: 'no-subscription' };
  if (PAID_STATUSES.has(status)) return { ok: true, reason: 'subscribed', status };
  return { ok: false, reason: 'inactive', status };
}

module.exports = {
  verifyWsRequest,
  getAccessForUser,
  PAID_STATUSES,
};
