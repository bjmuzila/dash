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
 *
 * WHY THERE IS A CACHE HERE (2026-08-31)
 *   This module started as the WS upgrade gate — one call per connection. It is
 *   now ALSO the gate for every /api/* route (api-router.js enforceAuth) and the
 *   whole /proxy/* surface (proxy-auth.js), and in production api-router
 *   intercepts /api/* BEFORE Next middleware runs — so lib/auth/session.ts's 8s
 *   cache never covers those requests. Uncached, a page like /app/ict that fires
 *   ~10 gated requests on mount plus two interval pollers meant ~10 Postgres
 *   round trips per load, per user, through a pool capped at 2 connections.
 *   Under contention the pool errors, verifyWsRequest fails closed, and the user
 *   sees sporadic 401s on whatever happened to be in flight (usually the two
 *   pollers, /api/tt-quotes and /api/quotes-batch). Hence: same 8s TTL cache as
 *   lib/auth/session.ts, and a realistically sized pool.
 *
 * TRANSIENT vs. DENIED
 *   A DB hiccup is not "unauthorized". Infrastructure failures now surface as
 *   reason 'verify-error' / 'server-misconfig', which callers map to 503 so the
 *   client retries instead of rendering a permanent auth error. Access is still
 *   DENIED in that case — fail-closed is unchanged; only the status code is.
 *   Transient failures are never cached.
 */

'use strict';

const crypto = require('crypto');

const PAID_STATUSES = new Set(['active', 'trialing']); // sync with lib/db.ts
const OWNER_USER_ID = (process.env.OWNER_USER_ID || '').trim();
const SESSION_COOKIE = 'cbe_session'; // sync with lib/auth/session.ts

// ── DB pool ────────────────────────────────────────────────────────────────
// max was 2 while this file only gated WS upgrades (one query per connection).
// It now fronts every /api/* and /proxy/* request, so 2 is a hard bottleneck
// shared across ALL concurrent users — pg queues past it and eventually errors,
// which fails closed as a 401. AUTH_POOL_MAX overrides for tuning without a
// code change; the default is sized for the ~10 parallel gated requests a
// dashboard page mounts with, not for one socket.
const AUTH_POOL_MAX = Math.max(2, Number(process.env.AUTH_POOL_MAX) || 16);

/** Marks an infrastructure failure (no pool, query error) as distinct from a
 *  session that is genuinely absent/expired. Callers map this to 503, not 401. */
class TransientAuthError extends Error {
  constructor(message) { super(message); this.name = 'TransientAuthError'; this.transient = true; }
}

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
      max: AUTH_POOL_MAX,
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

// ── Short-lived validation cache ───────────────────────────────────────────
// Same shape and TTL as lib/auth/session.ts's cache, for the same reason: bound
// DB load per session to ~1 query per CACHE_TTL_MS while keeping paid/owner
// revocation effectively near-instant. Keyed on the token HASH, never the raw
// token. Only definitive answers are cached (a resolved session, or null for a
// token that does not resolve) — a TransientAuthError is never cached, so a DB
// blip can't pin a user to "denied" for the next 8 seconds.
const CACHE_TTL_MS = 8000;
const CACHE_MAX = 5000;
const _sessionCache = new Map(); // tokenHash -> { at, value }

function _cacheGet(tokenHash) {
  const hit = _sessionCache.get(tokenHash);
  if (!hit) return undefined;
  if (Date.now() - hit.at >= CACHE_TTL_MS) { _sessionCache.delete(tokenHash); return undefined; }
  return hit.value;
}

function _cacheSet(tokenHash, value) {
  _sessionCache.set(tokenHash, { at: Date.now(), value });
  if (_sessionCache.size > CACHE_MAX) {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [k, v] of _sessionCache) if (v.at < cutoff) _sessionCache.delete(k);
  }
}

/** Drop a cached decision immediately (logout, plan change). No-op if absent. */
function invalidateSessionCache(rawToken) {
  if (!rawToken) return;
  _sessionCache.delete(crypto.createHash('sha256').update(rawToken).digest('hex'));
}

/** Session -> { userId, isOwner, isPaid } or null. Mirrors
 *  lib/db.ts's getSessionWithUser() (sessions JOIN users LEFT JOIN subscriptions).
 *  Throws TransientAuthError when the lookup could not be performed at all. */
async function getSessionForToken(rawToken) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const cached = _cacheGet(tokenHash);
  if (cached !== undefined) return cached;

  const pool = getAuthPool();
  // No pool = misconfiguration or a failed `require('pg')`, NOT a bad session.
  if (!pool) throw new TransientAuthError('auth pool unavailable');

  let r;
  try {
    r = await pool.query(
      `SELECT s.user_id, u.is_owner,
              COALESCE(sub.status IN ('active','trialing'), FALSE) AS is_paid
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN subscriptions sub ON sub.clerk_user_id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > NOW()
        LIMIT 1`,
      [tokenHash]
    );
  } catch (e) {
    // Pool exhaustion, connection reset, timeout — retryable, not a denial.
    throw new TransientAuthError(e?.message || 'session lookup failed');
  }

  const row = r.rows?.[0];
  const value = row
    ? { userId: row.user_id, isOwner: !!row.is_owner, isPaid: !!row.is_paid }
    : null;
  _cacheSet(tokenHash, value);
  return value;
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
    return { ok: false, reason: 'server-misconfig', transient: true };
  }

  let session;
  try {
    const cookies = parseCookies(upgradeReq.headers && upgradeReq.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (!token) return { ok: false, reason: 'no-token' };

    session = await getSessionForToken(token);
    if (!session) return { ok: false, reason: 'invalid-or-expired-session' };
  } catch (e) {
    // `transient` distinguishes "we could not check" from "we checked and said
    // no". Callers turn it into a 503 so the client retries; access is still
    // denied either way (fail-closed).
    return { ok: false, reason: 'verify-error', detail: e?.message, transient: !!e?.transient };
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

/** Reasons that mean "the check could not be performed", not "denied". Callers
 *  (api-router enforceAuth, proxy-auth checkProxyAccess) map these to 503. */
const TRANSIENT_REASONS = new Set(['verify-error', 'server-misconfig']);
const isTransientAuthFailure = (access) =>
  !!access && (access.transient === true || TRANSIENT_REASONS.has(access.reason));

module.exports = {
  verifyWsRequest,
  getAccessForUser,
  invalidateSessionCache,
  isTransientAuthFailure,
  TRANSIENT_REASONS,
  TransientAuthError,
  PAID_STATUSES,
};
