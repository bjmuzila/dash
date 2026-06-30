/**
 * ws-auth.js — connection gate for the /ws/gex broadcaster (Supabase Auth).
 *
 * PURPOSE
 *   The WebSocket carries the paid product (live SPX GEX). Without this gate,
 *   anyone who knows the URL can stream it for free. This module verifies, at
 *   upgrade time, that the connecting user is (a) a real signed-in Supabase user
 *   and (b) either the owner or an active/trialing subscriber — the SAME rule
 *   the pages enforce via lib/subscription.getAccessForUser.
 *
 * HOW IT AUTHENTICATES (cookie-based — no client changes)
 *   The browser automatically sends the Supabase auth cookie with the WS upgrade
 *   request (same-origin). @supabase/ssr stores the session as a cookie named
 *   `sb-<ref>-auth-token` whose value is `base64-<base64(json)>`, possibly split
 *   into `.0`, `.1` … chunks. We reassemble it, pull out the `access_token`
 *   (a JWT), and verify it by calling supabase.auth.getUser(token) — which
 *   revalidates against the auth server and returns the user id.
 *
 * SAFETY
 *   - Controlled by env WS_AUTH_REQUIRED (checked by the caller). Never self-enables.
 *   - Fail-closed when enabled: anything it can't positively verify → ok:false.
 *     The owner is allowed even if the subscription DB lookup fails, so a billing
 *     hiccup can't lock the owner out.
 *   - Keep PAID_STATUSES in sync with lib/db.ts.
 */

'use strict';

const PAID_STATUSES = new Set(['active', 'trialing']); // sync with lib/db.ts
const OWNER_USER_ID = (process.env.OWNER_USER_ID || '').trim();

// ── Supabase client (anon key; used only to verify tokens) ───────────────────
let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const { createClient } = require('@supabase/supabase-js');
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  _supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supabase;
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
  // Column kept as `clerk_user_id` for schema continuity; it now holds the
  // Supabase auth.users UUID (fresh-start migration — no rename needed).
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

// ── Cookie → Supabase access token ───────────────────────────────────────────
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
 * Reassemble and decode the @supabase/ssr auth cookie into its session object,
 * then return the access_token (JWT). Returns null if not present/parseable.
 */
function accessTokenFromCookies(cookies) {
  // Find the base cookie name: sb-<ref>-auth-token (chunks add .0, .1, …).
  const names = Object.keys(cookies);
  const base = names.find((n) => /^sb-.*-auth-token$/.test(n));
  if (!base) {
    // Chunked-only case: sb-<ref>-auth-token.0 etc. with no bare base name.
    const chunkBase = names
      .map((n) => n.match(/^(sb-.*-auth-token)\.\d+$/))
      .find(Boolean);
    if (!chunkBase) return null;
    return reassemble(cookies, chunkBase[1]);
  }
  // A bare base cookie may itself be the whole value, OR chunks may also exist.
  if (names.some((n) => n.startsWith(base + '.'))) {
    return reassemble(cookies, base);
  }
  return decodeSession(cookies[base]);
}

function reassemble(cookies, baseName) {
  let raw = '';
  for (let i = 0; ; i++) {
    const chunk = cookies[`${baseName}.${i}`];
    if (chunk == null) break;
    raw += chunk;
  }
  return raw ? decodeSession(raw) : null;
}

function decodeSession(raw) {
  if (!raw) return null;
  try {
    let json = raw;
    if (raw.startsWith('base64-')) {
      json = Buffer.from(raw.slice('base64-'.length), 'base64').toString('utf8');
    }
    const session = JSON.parse(json);
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Verify a WS upgrade request via the Supabase session cookie.
 * Returns { ok, userId?, reason }. Only call when WS_AUTH_REQUIRED === "1".
 */
async function verifyWsRequest(upgradeReq) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error('[ws-auth] Supabase env missing — rejecting (auth required)');
    return { ok: false, reason: 'server-misconfig' };
  }

  let userId;
  try {
    const cookies = parseCookies(upgradeReq.headers && upgradeReq.headers.cookie);
    const token = accessTokenFromCookies(cookies);
    if (!token) return { ok: false, reason: 'no-token' };

    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return { ok: false, reason: error?.message || 'invalid-token' };
    }
    userId = data.user.id;
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
