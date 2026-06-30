'use strict';
/**
 * proxy-auth.js — access gate for the /proxy/* REST surface.
 *
 * WHY THIS EXISTS
 *   middleware.ts deliberately excludes `/proxy` and `/ws` from the Next
 *   matcher, so NOTHING in the Next layer authenticates these routes. Before
 *   this module, every /proxy/* route was world-readable AND several mutating
 *   POSTs (maintenance, idle, *-run, reconnect, watchlist) were world-writable.
 *   This restores parity with the page/WS gates:
 *
 *     - read routes (GET data)      → any active/trialing subscriber (or owner)
 *     - mutating routes (POST etc.) → OWNER only
 *     - a tiny PUBLIC allowlist     → no auth (health, maintenance GET, …)
 *     - in-process cron callers     → x-internal-token shared secret bypass
 *
 *   Auth itself reuses ws-auth.verifyWsRequest, which reads the Supabase
 *   session cookie off the upgrade/request headers and revalidates the JWT
 *   against the auth server (getUser), then checks the subscriptions table.
 *
 * FAIL-CLOSED
 *   Anything we can't positively verify → denied. The owner is allowed on a
 *   billing-lookup hiccup (verifyWsRequest already encodes that).
 *
 * KILL SWITCH
 *   PROXY_AUTH_REQUIRED must be "1" to enforce. Left unset/0 the gate is a
 *   no-op (logs once) so a misconfigured rollout can't lock the site out
 *   before the env is in place. Flip to "1" in prod .env.local to enforce.
 */

const { verifyWsRequest } = require('./ws-auth');

const OWNER_USER_ID = (process.env.OWNER_USER_ID || '').trim();

// Routes reachable with no session at all. Keep this minimal.
//   - /proxy/health         : liveness probe (Docker/uptime monitor)
//   - /proxy/maintenance GET : the Next middleware polls this every request to
//                              decide whether to serve /maintenance; it runs
//                              server-to-server without a user cookie.
const PUBLIC_GET = new Set(['/proxy/health', '/proxy/maintenance']);

function isEnforced() {
  return process.env.PROXY_AUTH_REQUIRED === '1';
}

let _warned = false;
function warnOnceDisabled() {
  if (_warned) return;
  _warned = true;
  console.warn(
    '[proxy-auth] PROXY_AUTH_REQUIRED!=1 — /proxy/* is UNAUTHENTICATED. ' +
    'Set PROXY_AUTH_REQUIRED=1 in .env.local to enforce subscriber/owner gating.'
  );
}

/**
 * Decide whether a /proxy/* request may proceed.
 * @returns {Promise<{ok:true, who:string} | {ok:false, code:number, reason:string}>}
 */
async function checkProxyAccess(req, pathname, method) {
  if (!isEnforced()) { warnOnceDisabled(); return { ok: true, who: 'gate-disabled' }; }

  // 1) Internal server-to-server (cron jobs hitting http://localhost:PORT).
  const token = req.headers['x-internal-token'];
  if (token && process.env.INTERNAL_API_TOKEN &&
      token === process.env.INTERNAL_API_TOKEN) {
    return { ok: true, who: 'internal' };
  }

  // 2) Public allowlist (GET only).
  if (method === 'GET' && PUBLIC_GET.has(pathname)) {
    return { ok: true, who: 'public' };
  }

  // 3) Everything else needs a verified Supabase session.
  let access;
  try {
    access = await verifyWsRequest(req); // { ok, userId?, reason }
  } catch (e) {
    return { ok: false, code: 401, reason: 'verify-error' };
  }
  if (!access.ok) {
    return { ok: false, code: 401, reason: access.reason || 'unauthorized' };
  }

  // 4) Mutating routes are OWNER-only. A subscriber must not be able to flip
  //    maintenance, kill the feed, edit the watchlist, or trigger jobs.
  const isWrite = method !== 'GET' && method !== 'HEAD';
  if (isWrite) {
    if (!OWNER_USER_ID || access.userId !== OWNER_USER_ID) {
      return { ok: false, code: 403, reason: 'owner-only' };
    }
    return { ok: true, who: 'owner' };
  }

  // 5) Read routes: any active subscriber (verifyWsRequest already required an
  //    active/trialing status or owner).
  return { ok: true, who: access.reason || 'subscriber' };
}

module.exports = { checkProxyAccess, isProxyAuthEnforced: isEnforced };
