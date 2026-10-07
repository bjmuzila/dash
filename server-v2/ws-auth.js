/**
 * ws-auth.js — connection gate for the /ws/gex broadcaster (custom auth).
 *
 * PURPOSE
 *   The WebSocket carries the paid product (live SPX GEX). Without this gate,
 *   anyone who knows the URL can stream it for free. This module verifies, at
 *   upgrade time, that the connecting user has a valid session cookie and is
 *   either the owner, an active/trialing subscriber, the holder of a live
 *   comp_access grant, or the holder of a live voltick_access grant (since
 *   2026-10-04, see below) — the SAME rule the pages enforce via
 *   lib/db.ts's getSessionWithUser().
 *
 * VOLTICK GRANTS COUNT AS PAID (2026-10-04, Brandon's call)
 *   A live voltick_access row (the voltick.cbedge.net / vela.cbedge.net list,
 *   owner console → Admin → Voltick Access) now unlocks everything a paying
 *   customer sees, exactly like a comp. Before this the grant opened the
 *   sandbox door and nothing else, so a granted partner saw the Vela page with
 *   empty charts: every data route behind it is 'subscriber'. Revoking the
 *   grant takes both away. It is joined the same way comp_access is, in all
 *   three queries below, and reported as 'comped' in `reason`.
 *
 * KEEP THE PAID DEFINITION IN SYNC WITH lib/db.ts (2026-08-31)
 *   is_paid here MUST match getSessionWithUser()'s is_paid exactly, because the
 *   two gates sit on opposite sides of the same page load: middleware decides
 *   whether the document renders, this file decides whether its data loads.
 *   When they disagree the page draws and then every API call 401s — which is
 *   what happened when comp_access was added to lib/db.ts and not here: comped
 *   users (beta testers, friends, support cases) passed middleware, then got a
 *   permanent 401 on every /api/* call, no /proxy/*, and no WebSocket. If you
 *   ever add another source of "paid", add it to BOTH queries below and to
 *   getSessionWithUser().
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
    // is_paid = a live Stripe subscription OR a live comp_access grant OR a live
    // voltick_access grant. Mirrors lib/db.ts's getSessionWithUser() clause for
    // clause — see the sync note in the file header. The grant joins are written
    // so an expired or revoked row simply doesn't match, and both grant tables
    // are keyed on the LOWERCASED email because a grant can exist before the
    // person has an account.
    r = await pool.query(
      `SELECT s.user_id, u.is_owner,
              (COALESCE(sub.status IN ('active','trialing'), FALSE)
                OR ca.email IS NOT NULL
                OR va.email IS NOT NULL)                     AS is_paid,
              (ca.email IS NOT NULL OR va.email IS NOT NULL) AS is_comped
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN subscriptions sub ON sub.clerk_user_id = s.user_id
         LEFT JOIN comp_access ca
                ON ca.email = LOWER(u.email)
               AND ca.revoked_at IS NULL
               AND (ca.expires_at IS NULL OR ca.expires_at > NOW())
         LEFT JOIN voltick_access va
                ON va.email = LOWER(u.email)
               AND va.revoked_at IS NULL
               AND (va.expires_at IS NULL OR va.expires_at > NOW())
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
    ? {
        userId: row.user_id,
        isOwner: !!row.is_owner,
        isPaid: !!row.is_paid,
        // Informational only (logging / admin views). The gate reads isPaid.
        isComped: !!row.is_comped,
      }
    : null;
  _cacheSet(tokenHash, value);
  return value;
}

// ── Vela beta testers (2026-10-07) ─────────────────────────────────────────
//
// A beta tester (owner console → Admin → Vela Beta Testers, table
// vela_beta_access) gets Vela's data ONLY when the request arrives through
// vela.cbedge.net. Through cbedge.net they are an ordinary unpaid account:
// no pages (Next middleware never heard of this table), no /api, no /proxy,
// no socket.
//
// WHY BY HOST, NOT A PAID FLAG: comp_access and voltick_access are joined
// into is_paid, which unlocks the whole site. That is exactly what a beta
// tester must NOT get. So this is NOT in getSessionForToken / is_paid and NOT
// in lib/db.ts getSessionWithUser(). It is a second, narrow check that only
// runs for a session that has ALREADY been refused AND came in on the Vela
// host, so paying customers never pay for the extra query.
//
// Host comes from the request's Host header. deploy/vela/nginx.conf sets
// `Host $host` on every /api /proxy /ws hop, and a browser cannot forge Host
// on a request to cbedge.net (Cloudflare routes by it). VELA_HOSTS overrides
// the list for dev.
const VELA_HOSTS = new Set(
  String(process.env.VELA_HOSTS || 'vela.cbedge.net')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
);
function requestHost(req) {
  const raw = req && req.headers && req.headers.host;
  return String(raw || '').split(':')[0].trim().toLowerCase();
}
function isVelaHost(host) {
  return VELA_HOSTS.has(String(host || '').split(':')[0].trim().toLowerCase());
}

// WHICH DATA. A beta grant is not "everything a subscriber can fetch on this
// host" — nginx proxies ALL of /api and /proxy, so without this list a tester
// could call /api/gex, /api/flow, … from the console and walk off with the
// whole paid product minus its HTML. This is every endpoint the Vela build
// (cbedge-v3 src/vela/main.tsx and everything it imports) calls, taken from
// its import graph on 2026-10-07. Exact pathnames, query string ignored.
//
// WHEN VELA STARTS CALLING A NEW ENDPOINT, ADD IT HERE or it will be empty for
// beta testers only (owner, Voltick list and paying customers are unaffected).
// The refusal is logged once per path as "[ws-auth] vela-beta refused <path>"
// so the gap shows up in `docker compose logs dashboard`. For a hotfix without
// a rebuild, VELA_BETA_EXTRA_PATHS takes a comma list of extra pathnames.
// Owner-only routes Vela calls (/api/lse/candles, /api/lse/resolve) are left
// off on purpose: the owner gate would refuse them anyway.
const VELA_BETA_PATHS = new Set([
  // the door + who-am-I
  '/api/vela/verify',
  '/api/auth/me',
  // chart data
  '/api/calendar',
  '/api/chains',
  '/api/daily-em',
  '/api/dxlink/candles',
  '/api/em-tracker',
  '/api/es-candles/tickers',
  '/api/ib-results',
  '/api/journal/trades',
  '/api/levels',
  '/api/lse/whales',
  '/api/page-preset',
  '/api/pinescript',
  '/api/public-earnings',
  '/api/quotes-batch',
  '/api/ref-levels',
  '/api/snapshots/candles',
  '/api/snapshots/etf-candles',
  '/api/snapshots/etf-candles/live',
  '/api/snapshots/etf-candles/live/stream',
  '/api/snapshots/option-strike-gex-history',
  '/api/ticker-event',
  '/api/vela/history',
  '/api/walls-range',
  '/proxy/candles-intraday',
  '/proxy/earnings-week',
  '/proxy/es-spx-basis',
  '/proxy/flow-netprem',
  '/proxy/gex-vol-flow',
  '/proxy/nq-ndx-basis',
  '/proxy/signal-alerts',
  '/proxy/signals',
  '/proxy/ticker-logo',
  '/proxy/walls',
  // live socket (ES / NQ tail)
  '/ws/gex',
  ...String(process.env.VELA_BETA_EXTRA_PATHS || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean),
]);
function requestPath(req) {
  try {
    return new URL((req && req.url) || '/', 'http://x').pathname.replace(/\/+$/, '') || '/';
  } catch {
    return '';
  }
}
const _velaBetaRefusedLogged = new Set();
function isVelaBetaPath(pathname) {
  if (VELA_BETA_PATHS.has(pathname)) return true;
  if (!_velaBetaRefusedLogged.has(pathname) && _velaBetaRefusedLogged.size < 500) {
    _velaBetaRefusedLogged.add(pathname);
    console.warn(`[ws-auth] vela-beta refused ${pathname} (not in VELA_BETA_PATHS)`);
  }
  return false;
}

const _velaBetaCache = new Map(); // userId -> { at, value }

/** Does this account hold a live vela_beta_access grant? Same 8s cache as
 *  sessions. A missing table (first boot before ensureAllTables ran) means
 *  "nobody is a beta tester", never an outage for anyone else. Any other DB
 *  failure is transient (503, retry), not a denial. */
async function isVelaBetaUser(userId) {
  if (!userId) return false;
  const hit = _velaBetaCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const pool = getAuthPool();
  if (!pool) throw new TransientAuthError('auth pool unavailable');

  let value;
  try {
    const r = await pool.query(
      `SELECT 1
         FROM users u
         JOIN vela_beta_access vb
           ON vb.email = LOWER(u.email)
          AND vb.revoked_at IS NULL
          AND (vb.expires_at IS NULL OR vb.expires_at > NOW())
        WHERE u.id = $1
        LIMIT 1`,
      [userId]
    );
    value = (r.rows?.length ?? 0) > 0;
  } catch (e) {
    if (e && e.code === '42P01') value = false; // undefined_table
    else throw new TransientAuthError(e?.message || 'vela beta lookup failed');
  }

  _velaBetaCache.set(userId, { at: Date.now(), value });
  if (_velaBetaCache.size > CACHE_MAX) {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [k, v] of _velaBetaCache) if (v.at < cutoff) _velaBetaCache.delete(k);
  }
  return value;
}

/** Same decision as lib/subscription.getAccessForUser, JS side. */
function getAccessFor(session) {
  if (OWNER_USER_ID && session.userId === OWNER_USER_ID) return { ok: true, reason: 'owner' };
  if (session.isOwner) return { ok: true, reason: 'owner' };
  // isPaid already folds in comp_access; `reason` just distinguishes the two in
  // logs. A comp unlocks exactly what a subscription unlocks and nothing more.
  if (session.isPaid) return { ok: true, reason: session.isComped ? 'comped' : 'subscribed' };
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

  let access = getAccessFor(session);

  // Vela beta: refused as a customer, but on the Vela host with a live beta
  // grant → let Vela's own endpoints through (VELA_BETA_PATHS), nothing else.
  // See the block above isVelaBetaUser().
  if (!access.ok && isVelaHost(requestHost(upgradeReq))) {
    try {
      if (await isVelaBetaUser(session.userId) && isVelaBetaPath(requestPath(upgradeReq))) {
        access = { ok: true, reason: 'vela-beta' };
      }
    } catch (e) {
      return { ok: false, userId: session.userId, reason: 'verify-error', detail: e?.message, transient: true };
    }
  }

  // tokenHash rides along on SUCCESS only, so the socket can be re-checked
  // later without holding the raw cookie value in memory for the life of the
  // connection. See sessionStillLive() below and the revalidation sweep in
  // websocket-server.js.
  const tokenHash = (() => {
    try {
      const cookies = parseCookies(upgradeReq.headers && upgradeReq.headers.cookie);
      const raw = cookies[SESSION_COOKIE];
      return raw ? crypto.createHash('sha256').update(raw).digest('hex') : null;
    } catch { return null; }
  })();
  return access.ok
    ? { ok: true, userId: session.userId, reason: access.reason, tokenHash }
    : { ok: false, userId: session.userId, reason: access.reason };
}

/**
 * Is this session STILL live and still entitled? Keyed on the token hash, and
 * deliberately CACHE-BYPASSING: the 8s cache exists to spare the DB on the
 * connect path, but this runs once a minute per socket and its whole job is to
 * notice a row that has gone away.
 *
 * Added 2026-09-14 with one-device-per-account. The upgrade handler is the only
 * gate a /ws/gex connection ever passed, so a socket opened before a sign-out,
 * a device kick or a Stripe cancellation kept streaming live GEX for as long as
 * it stayed connected — hours, in practice, since the client has no reason to
 * reconnect.
 *
 * Returns true on a transient failure. A DB blip must not disconnect every
 * paying customer at once; the sweep runs again in a minute.
 */
async function sessionStillLive(tokenHash, opts = {}) {
  if (!tokenHash) return true; // nothing to check against — leave it alone
  const pool = getAuthPool();
  if (!pool) return true;
  try {
    const r = await pool.query(
      `SELECT s.user_id, u.is_owner,
              (COALESCE(sub.status IN ('active','trialing'), FALSE)
                OR ca.email IS NOT NULL
                OR va.email IS NOT NULL)                     AS is_paid,
              (ca.email IS NOT NULL OR va.email IS NOT NULL) AS is_comped
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN subscriptions sub ON sub.clerk_user_id = s.user_id
         LEFT JOIN comp_access ca
                ON ca.email = LOWER(u.email)
               AND ca.revoked_at IS NULL
               AND (ca.expires_at IS NULL OR ca.expires_at > NOW())
         LEFT JOIN voltick_access va
                ON va.email = LOWER(u.email)
               AND va.revoked_at IS NULL
               AND (va.expires_at IS NULL OR va.expires_at > NOW())
        WHERE s.token_hash = $1 AND s.expires_at > NOW()
        LIMIT 1`,
      [tokenHash]
    );
    const row = r.rows?.[0];
    if (!row) return false; // session row is gone — signed out, or kicked
    const ok = getAccessFor({
      userId: row.user_id,
      isOwner: !!row.is_owner,
      isPaid: !!row.is_paid,
      isComped: !!row.is_comped,
    }).ok;
    if (ok) return true;
    // A beta tester's socket stays up only while it is a Vela-host socket with
    // a live grant. opts.host is the upgrade request's Host, pinned on the
    // socket by websocket-server.js.
    if (opts.host && isVelaHost(opts.host)) return await isVelaBetaUser(row.user_id);
    return false;
  } catch (e) {
    console.warn('[ws-auth] revalidate failed (keeping socket):', e?.message || e);
    return true;
  }
}

/** Same decision, keyed directly on a userId (no session token) — exported
 *  for unit testing, mirrors lib/subscription.ts's getAccessForUser. */
async function getAccessForUser(userId) {
  if (OWNER_USER_ID && userId === OWNER_USER_ID) return { ok: true, reason: 'owner' };
  const pool = getAuthPool();
  if (!pool) return { ok: false, reason: 'no-subscription' };
  // Same comp_access + voltick_access joins as getSessionForToken above — see
  // the sync note in the file header. Without them this function calls a
  // comped (or Voltick-granted) user 'inactive'.
  const r = await pool.query(
    `SELECT u.is_owner, sub.status,
            (ca.email IS NOT NULL OR va.email IS NOT NULL) AS is_comped
       FROM users u
       LEFT JOIN subscriptions sub ON sub.clerk_user_id = u.id
       LEFT JOIN comp_access ca
              ON ca.email = LOWER(u.email)
             AND ca.revoked_at IS NULL
             AND (ca.expires_at IS NULL OR ca.expires_at > NOW())
       LEFT JOIN voltick_access va
              ON va.email = LOWER(u.email)
             AND va.revoked_at IS NULL
             AND (va.expires_at IS NULL OR va.expires_at > NOW())
      WHERE u.id = $1 LIMIT 1`,
    [userId]
  );
  const row = r.rows?.[0];
  if (row?.is_owner) return { ok: true, reason: 'owner' };
  // A live comp is paid access regardless of what the subscriptions row says —
  // checked BEFORE status so a comped user with an old 'canceled' Stripe row
  // (churned, then comped) still passes.
  if (row?.is_comped) return { ok: true, reason: 'comped' };
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
  sessionStillLive,
  getAccessForUser,
  invalidateSessionCache,
  isTransientAuthFailure,
  isVelaHost,
  TRANSIENT_REASONS,
  TransientAuthError,
  PAID_STATUSES,
};
