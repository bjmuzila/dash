'use strict';
/**
 * server-v2/household-routes.cjs — every /api/hh/* route for budget.cbedge.net.
 *
 * Kept OUT of api-router.js on purpose: that file is already 473KB, and the
 * household app is a separate product with a separate auth system. api-router
 * touches this in exactly two places (see api-router.patch.md):
 *   1. an `auth: 'household'` branch in enforceAuth()
 *   2. one require + one call, right before the dispatcher
 *
 * Registered here in phase 1 (steps 1-3):
 *   POST /api/hh/auth/login            public  — sets hh_session
 *   POST /api/hh/auth/logout           public  — clears it
 *   GET  /api/hh/auth/me               public  — 200 {user} or 401, never redirects
 *   POST /api/hh/auth/change-password  household
 *   GET  /api/hh/health                public  — is the household stack alive
 *
 * There is deliberately NO signup route. Accounts are created with
 * server-v2/scripts/hh-user.js. Two people, forever.
 */

const hh = require('./_lib-household.cjs');

/**
 * @param {object} deps
 * @param {(path:string, def:object)=>void} deps.register  api-router's register()
 * @param {(res:any, status:number, body:any, headers?:object)=>void} deps.send
 * @param {(req:any, max?:number)=>Promise<any>} deps.readJson
 */
function registerHouseholdRoutes({ register, send, readJson }) {
  if (!hh.available()) {
    console.warn('[household] no DB layer — /api/hh/* not registered');
    return 0;
  }

  const NO_STORE = 'no-store, must-revalidate';

  // Auth responses must never be cached by the browser or Cloudflare. A cached
  // /me is how you end up looking signed in after signing out.
  const authHeaders = (cookie) => {
    const h = { 'Cache-Control': NO_STORE };
    if (cookie) h['Set-Cookie'] = cookie;
    return h;
  };

  const publicUser = (u) => ({
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    budgetProfileKey: u.budget_profile_key,
    tz: u.tz,
    mustChangePassword: !!u.must_change_password,
  });

  // ── POST /api/hh/auth/login ───────────────────────────────────────────────
  register('/api/hh/auth/login', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      try {
        const body = await readJson(req, 8192);
        const result = await hh.login({
          email: body?.email, password: body?.password, req,
        });
        if (!result.ok) { send(res, result.code, { error: result.error }, { 'Cache-Control': NO_STORE }); return; }
        send(res, 200, { ok: true, user: publicUser(result.user) }, authHeaders(result.cookie));
      } catch (err) {
        send(res, 500, { error: String(err?.message || err) }, { 'Cache-Control': NO_STORE });
      }
    },
  });

  // ── POST /api/hh/auth/logout ──────────────────────────────────────────────
  // Public so a stale/invalid cookie can still be cleared instead of 401ing
  // into a state where you can't sign out.
  register('/api/hh/auth/logout', {
    auth: 'public', methods: ['POST'],
    async handler(req, res) {
      try { await hh.destroySession(req); } catch { /* clear the cookie regardless */ }
      send(res, 200, { ok: true }, authHeaders(hh.clearCookie()));
    },
  });

  // ── GET /api/hh/auth/me ───────────────────────────────────────────────────
  // Public + 401 rather than auth:'household', so a signed-out visitor gets a
  // clean JSON 401 the SPA can render a login form for — no redirect, no HTML.
  register('/api/hh/auth/me', {
    auth: 'public', methods: ['GET'],
    async handler(req, res) {
      const u = await hh.userFromRequest(req);
      if (!u) { send(res, 401, { error: 'no-session' }, { 'Cache-Control': NO_STORE }); return; }
      // Sliding window: a daily user never gets logged out mid-month.
      let cookie = null;
      if (hh.shouldSlide(u)) {
        try {
          const r = await hh.refreshSession(req);
          if (r) cookie = hh.sessionCookie(r.token, hh.SESSION_DAYS * 24 * 60 * 60);
        } catch { /* keep the existing cookie */ }
      }
      send(res, 200, { user: publicUser(u) }, authHeaders(cookie));
    },
  });

  // ── POST /api/hh/auth/change-password ─────────────────────────────────────
  register('/api/hh/auth/change-password', {
    auth: 'household', methods: ['POST'],
    async handler(req, res, _ctx, access) {
      try {
        const body = await readJson(req, 8192);
        const result = await hh.changePassword({
          userId: access.hhUser.id,
          currentPassword: body?.currentPassword,
          newPassword: body?.newPassword,
          req,
        });
        if (!result.ok) { send(res, result.code, { error: result.error }, { 'Cache-Control': NO_STORE }); return; }
        send(res, 200, { ok: true }, authHeaders(result.cookie));
      } catch (err) {
        send(res, 500, { error: String(err?.message || err) }, { 'Cache-Control': NO_STORE });
      }
    },
  });

  // ── GET /api/hh/health ────────────────────────────────────────────────────
  // Deploy smoke test. Reports whether the schema is reachable and how many
  // accounts exist — never any user detail.
  register('/api/hh/health', {
    auth: 'public', methods: ['GET'],
    async handler(req, res) {
      try {
        const users = await hh.listUsers();
        send(res, 200, { ok: true, users: users.length }, { 'Cache-Control': NO_STORE });
      } catch (err) {
        send(res, 500, { ok: false, error: String(err?.message || err) }, { 'Cache-Control': NO_STORE });
      }
    },
  });

  return 5;
}

module.exports = { registerHouseholdRoutes };
