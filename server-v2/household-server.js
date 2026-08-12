'use strict';
/**
 * server-v2/household-server.js — the household backend, on its own.
 *
 * Serves /api/hh/* for budget.cbedge.net and recipe.cbedge.net from a SEPARATE
 * Node process to the trading dashboard, on its own port, in its own container.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * These routes used to be registered inside api-router.js, which meant they ran
 * in the same process as the TastyTrade/dxLink feed, the WebSocket server and
 * every in-process recorder. Two things followed from that, and both were bad:
 *
 *   1. DEPLOY COUPLING. server-v2 is baked into the dashboard image, so a
 *      one-line fix to a recipe parser meant `docker compose build dashboard`
 *      — a full `next build` — and a restart that drops /ws/gex and makes Theta
 *      reconnect. Shipping a cookbook tweak at 10:30am took the GEX feed down
 *      mid-session. That is an absurd price for a change no customer can see.
 *   2. SHARED FATE. An unhandled rejection, or a leak — the recipe photo path
 *      buffers image blobs in memory — degraded the process recording market
 *      data. nginx already stopped these apps reaching /ws and /proxy at the
 *      network level; nothing stopped them sharing a heap.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
 *
 * SPLIT THE DATABASE. This process connects to the SAME Postgres. That is the
 * entire point: "Add all" on a recipe writes real hh_list_items rows that
 * budget.cbedge.net reads, and both apps share one hh_users identity. Separate
 * the data and you have built an API between two of your own apps, plus a
 * second password to remember. The process boundary buys isolation; a data
 * boundary would only buy work. (A clean household-vs-trading DB split isn't
 * available anyway — the budget screens read the same tables /owner/budget
 * writes.)
 *
 * ── HOW IT WORKS ───────────────────────────────────────────────────────────
 *
 * household-routes.cjs was already written as a mountable router taking
 * { register, send, readJson }, and uses no `ctx` at all — so this file is just
 * a tiny host for it: the same three primitives copied from api-router.js, the
 * 'household' branch of enforceAuth, and an http server. There is no second
 * implementation of any route.
 *
 * The whole household stack requires only `pg` (plus node builtins), which is
 * why the image is a few dozen MB and builds in seconds instead of minutes.
 *
 * Env: DATABASE_URL (required), HH_PORT (default 3010), plus whatever the
 * routes themselves read — ANTHROPIC_API_KEY for recipe AI import, GOOGLE_* for
 * the calendar. All from the same .env.local via compose's env_file.
 */

const http = require('http');
const path = require('path');

// Optional: in the container the environment comes from compose's env_file, and
// .env.local is not copied into the image (see .dockerignore). This is for
// running the process directly on the laptop or the VPS host.
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), override: true });
} catch { /* no dotenv, or no file — env is already set */ }

const PORT = Number(process.env.HH_PORT || 3010);

// ---------------------------------------------------------------------------
// Route registry — the same three primitives api-router.js hands the module.
// Copied verbatim rather than imported: importing api-router.js would pull in
// eight thousand lines of trading routes and every _lib-* bundle behind them,
// which is the exact coupling this process exists to remove.
// ---------------------------------------------------------------------------

const ROUTES = new Map();

function register(pathname, def) {
  if (!def || !def.auth || !def.handler) {
    throw new Error(`household-server: route ${pathname} needs { auth, handler }`);
  }
  ROUTES.set(pathname, def);
}

function send(res, status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.statusCode = status;
  res.end(text);
}

function readJson(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > maxBytes) { req.destroy(); reject(new Error('body too large')); }
    });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
//
// Only two levels exist here, and that is a feature: this process has no
// concept of a CB Edge session, no OWNER_USER_ID, no subscription check. There
// is no code path from a cbedge.net login into household data because the code
// to follow it does not exist in this binary.

let hh = null;
try { hh = require('./_lib-household.cjs'); }
catch (e) { console.error('[household] FATAL: _lib-household.cjs not loaded:', e.message); }

async function enforceAuth(level, req) {
  if (level === 'public') return { ok: true };
  if (level === 'household') {
    if (!hh) return { ok: false, code: 503, reason: 'household-unavailable' };
    const hhUser = await hh.userFromRequest(req);
    if (!hhUser) return { ok: false, code: 401, reason: 'no-household-session' };
    return { ok: true, hhUser, userId: `hh:${hhUser.id}` };
  }
  // A route asking for 'owner' or 'subscriber' would be a trading route that
  // ended up in the wrong module. Refuse rather than guess.
  return { ok: false, code: 500, reason: `unsupported-auth-level:${level}` };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

let registered = 0;
try {
  const { registerHouseholdRoutes } = require('./household-routes.cjs');
  registered = registerHouseholdRoutes({ register, send, readJson });
} catch (e) {
  console.error('[household] FATAL: household-routes.cjs not loaded:', e.message);
}

const server = http.createServer(async (req, res) => {
  // Same-origin only — nginx (budget-web / recipe-web) is the sole caller and
  // it is on the compose network. No CORS headers on purpose: adding them would
  // let any page on the internet make credentialed calls to this API.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  let pathname;
  try { ({ pathname } = new URL(req.url || '/', 'http://localhost')); }
  catch { send(res, 400, { error: 'bad-request' }); return; }

  // Container healthcheck. Deliberately NOT /api/hh/health — that one is a
  // route in the module and would go away with it; this one answers as long as
  // the process is alive, which is what a healthcheck is for.
  if (pathname === '/health') {
    send(res, 200, { ok: true, routes: registered, db: !!hh }, { 'Cache-Control': 'no-store' });
    return;
  }

  const def = ROUTES.get(pathname);
  if (!def) { send(res, 404, { error: 'not-found' }, { 'Cache-Control': 'no-store' }); return; }

  const method = req.method || 'GET';
  if (def.methods && !def.methods.includes(method)) {
    send(res, 405, { error: 'method-not-allowed' }, { 'Cache-Control': 'no-store' });
    return;
  }

  const verdict = await enforceAuth(def.auth, req).catch(() => ({ ok: false, code: 500, reason: 'auth-error' }));
  if (!verdict.ok) { send(res, verdict.code, { error: verdict.reason }, { 'Cache-Control': 'no-store' }); return; }

  try {
    // ctx is {} — household-routes.cjs uses none of it. Passed anyway so the
    // handler signature stays identical to the api-router mount, which is what
    // lets the module keep working in both places without a shim.
    await def.handler(req, res, {}, verdict);
  } catch (err) {
    console.error(`[household] ${method} ${pathname} threw:`, err?.message || err);
    if (!res.headersSent) send(res, 500, { error: String(err?.message || err) }, { 'Cache-Control': 'no-store' });
    else res.end();
  }
});

// A recipe import fetches someone else's blog and may then run the page through
// Claude. Node's 2-minute default would cut that off right as the answer lands.
server.requestTimeout = 300_000;
server.headersTimeout = 305_000;
server.keepAliveTimeout = 65_000;

// The whole reason this process exists is to be restartable without touching
// the trading app — so it must actually shut down cleanly instead of being
// SIGKILLed after docker's 10s grace period.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[household] ${sig} — closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

// A crash here takes down the cookbook and the budget app. It must never take
// anything else with it, and it must be loud — silently continuing in an
// unknown state is how you get a container that answers 200 and writes garbage.
process.on('unhandledRejection', (e) => { console.error('[household] unhandledRejection:', e); });
process.on('uncaughtException', (e) => { console.error('[household] uncaughtException:', e); process.exit(1); });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[household] listening on ${PORT} — ${registered} routes, db ${hh ? 'up' : 'MISSING'}`);
  if (!process.env.DATABASE_URL) console.warn('[household] WARNING: DATABASE_URL is not set');

  // Pick up any bulk recipe import that was mid-flight when this process last
  // died. Deliberately HERE and not in the module: the api-router fallback mount
  // shares a process with the trading feed, and import work — page fetches, AI
  // calls, image buffers — has no business running there.
  //
  // Delayed a moment so the first /health lands before a batch starts competing
  // for the connection pool, and swallowed on failure: a resume that can't run
  // must not stop the server that just came up.
  setTimeout(() => {
    try {
      const recipes = require('./_lib-household-recipes.cjs');
      if (recipes.available && recipes.available()) {
        recipes.resumeImportJobs()
          .then((n) => { if (n) console.log(`[household] resumed ${n} import job(s)`); })
          .catch((e) => console.warn('[household] resume failed:', e?.message || e));
      }
    } catch (e) { console.warn('[household] recipes lib unavailable for resume:', e?.message || e); }
  }, 3000).unref();
});
