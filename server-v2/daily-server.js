'use strict';
/**
 * server-v2/daily-server.js — the backend for daily.cbedge.net, on its own.
 *
 * Serves /api/daily/* from a SEPARATE Node process to both the trading
 * dashboard and the private household app, on its own port, in its own
 * container.
 *
 * ── WHY THIS EXISTS, AGAIN ─────────────────────────────────────────────────
 *
 * household-server.js already made this argument once: routes that share a
 * process with the TastyTrade feed share its deploy cycle and its heap, so a
 * one-line fix to a shopping list took the GEX feed down mid-session. The same
 * reasoning applies here and then some, because this app has something the
 * other two do not — PAYING STRANGERS.
 *
 *   * A public signup form is an attack surface. Anyone on the internet can
 *     POST to it as often as they like. That traffic must not land in the
 *     process recording market data.
 *   * A Stripe webhook must answer in seconds, every time, or Stripe starts
 *     retrying and eventually disables the endpoint. It cannot be queued behind
 *     a slow ThetaData call.
 *   * Uptime expectations are different in both directions. The trading app can
 *     be restarted at 4pm and nobody minds; this one is somebody's grocery list
 *     on a Saturday morning. Separately, a bug here must never be able to take
 *     the trading stack down, because a customer's card details are nowhere
 *     near it and it should stay that way.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
 *
 * SHARE AN IDENTITY WITH ANYTHING ELSE. There is no code path from a cbedge.net
 * session, or a budget.cbedge.net hh_session, into daily data — not because a
 * check refuses it, but because the code to follow it does not exist in this
 * binary. This process knows one cookie name, dy_session, and one user table,
 * daily_users.
 *
 * SPLIT THE DATABASE. It connects to the same Postgres, like household-server
 * does, because the Markets tab reads the `earnings_calendar` table the trading
 * recorder maintains and there is no sense running a second database to hold a
 * copy of it. Every daily_* table is tenant-scoped by household_id; see the
 * long comment at the top of _lib-daily.cjs.
 *
 * ── AUTH LEVELS ────────────────────────────────────────────────────────────
 *
 * Three, resolved here so no handler has to think about them:
 *
 *   public   no session required.
 *   user     a valid dy_session. Signed in, NOT necessarily paying — this is
 *            what billing, settings and onboarding routes ask for, so somebody
 *            who has signed up but not yet checked out can still reach the
 *            checkout button and their own account page.
 *   member   signed in AND entitled. daily.subscriptionProblem() decides, and a
 *            failure answers 402 with a machine-readable reason so the SPA can
 *            route to /pricing instead of showing a generic error.
 *
 * Env: DATABASE_URL (required), DAILY_PORT (default 3011), plus whatever the
 * route modules read — STRIPE_*, GOOGLE_*, DAILY_TOKEN_KEY, RESEND_API_KEY.
 * All from the same .env.local via compose's env_file.
 */

const http = require('http');
const path = require('path');

// Optional: in the container the environment comes from compose's env_file, and
// .env.local is not copied into the image (see .dockerignore). This is for
// running the process directly on the laptop or the VPS host.
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), override: true });
} catch { /* no dotenv, or no file — env is already set */ }

const PORT = Number(process.env.DAILY_PORT || 3011);

// ---------------------------------------------------------------------------
// Route registry
// ---------------------------------------------------------------------------
//
// The same three primitives api-router.js hands its route modules, copied
// rather than imported for the reason household-server.js gives: importing
// api-router.js would pull in eight thousand lines of trading routes and every
// _lib-* bundle behind them, which is the exact coupling this process exists to
// remove. `readRaw` is the fourth, and it is new — see the note on it.

const ROUTES = new Map();

function register(pathname, def) {
  if (!def || !def.auth || !def.handler) {
    throw new Error(`daily-server: route ${pathname} needs { auth, handler }`);
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

/**
 * The exact bytes of the request body, as a Buffer.
 *
 * This exists for one caller: the Stripe webhook. Stripe signs the raw body, so
 * verifying a signature against `JSON.stringify(JSON.parse(body))` fails
 * essentially at random — key order and number formatting are not guaranteed to
 * survive the round trip. Read the bytes, verify, and only then parse.
 *
 * A body cannot be read twice, so a handler picks one of readJson or readRaw
 * and lives with it.
 */
function readRaw(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { req.destroy(); reject(new Error('body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

let daily = null;
try { daily = require('./_lib-daily.cjs'); }
catch (e) { console.error('[daily] FATAL: _lib-daily.cjs not loaded:', e.message); }

async function enforceAuth(level, req) {
  if (level === 'public') return { ok: true, user: null };
  if (!daily) return { ok: false, code: 503, reason: 'daily-unavailable' };

  const user = await daily.userFromRequest(req);
  if (!user) return { ok: false, code: 401, reason: 'no-session' };

  if (level === 'user') return { ok: true, user };

  if (level === 'member') {
    const problem = daily.subscriptionProblem(user);
    // 402 Payment Required, with the reason in the body. The SPA reads it and
    // routes to /pricing; a bare 401 would send it to the sign-in screen and
    // sign the person out of an account they are already correctly signed in to.
    if (problem) return { ok: false, code: problem.code, reason: problem.reason };
    return { ok: true, user };
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
  const { registerDailyRoutes } = require('./daily-routes.cjs');
  registered = registerDailyRoutes({ register, send, readJson, readRaw });
} catch (e) {
  console.error('[daily] FATAL: daily-routes.cjs not loaded:', e.message);
}

const server = http.createServer(async (req, res) => {
  // Same-origin only — the daily-web nginx is the sole caller and it is on the
  // compose network. No CORS headers on purpose: adding them would let any page
  // on the internet make credentialed calls to this API, and this API can move
  // money.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  let pathname;
  try { ({ pathname } = new URL(req.url || '/', 'http://localhost')); }
  catch { send(res, 400, { error: 'bad-request' }); return; }

  // Container healthcheck. Deliberately NOT /api/daily/health — that one is a
  // route in the module and would go away with it; this one answers as long as
  // the process is alive, which is what a healthcheck is for.
  if (pathname === '/health') {
    send(res, 200, { ok: true, routes: registered, db: !!daily }, { 'Cache-Control': 'no-store' });
    return;
  }

  const def = ROUTES.get(pathname);
  if (!def) { send(res, 404, { error: 'not-found' }, { 'Cache-Control': 'no-store' }); return; }

  const method = req.method || 'GET';
  if (def.methods && !def.methods.includes(method)) {
    send(res, 405, { error: 'method-not-allowed' }, { 'Cache-Control': 'no-store' });
    return;
  }

  const verdict = await enforceAuth(def.auth, req)
    .catch((e) => {
      console.error(`[daily] auth error on ${pathname}:`, e?.message || e);
      return { ok: false, code: 500, reason: 'auth-error' };
    });
  if (!verdict.ok) { send(res, verdict.code, { error: verdict.reason }, { 'Cache-Control': 'no-store' }); return; }

  try {
    // ctx is {} — daily-routes.cjs uses none of it. Passed anyway so the handler
    // signature stays identical to the api-router mount, which is what would let
    // the module be mounted there in an emergency without a shim.
    await def.handler(req, res, {}, verdict);
  } catch (err) {
    console.error(`[daily] ${method} ${pathname} threw:`, err?.message || err);
    // The message is deliberately NOT forwarded. A thrown pg error can carry a
    // connection string or a query containing user data, and this endpoint
    // answers the open internet.
    if (!res.headersSent) send(res, 500, { error: 'server-error' }, { 'Cache-Control': 'no-store' });
    else res.end();
  }
});

// Google's token endpoint and Stripe are both external round trips inside a
// request. 60s is generous for either and still well inside Cloudflare's own
// 100s edge timeout, so a hung upstream surfaces as our error rather than a
// Cloudflare 524 page nobody can debug.
server.requestTimeout = 60_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 65_000;

// The whole reason this process exists is to be restartable without touching
// anything else — so it must actually shut down cleanly instead of being
// SIGKILLed after docker's 10s grace period. An in-flight checkout POST that
// gets killed mid-Stripe-call is a customer who was charged and has no account
// state to show for it.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[daily] ${sig} — closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}

// A crash here takes down daily.cbedge.net and nothing else, which is the
// point. It must still be loud — silently continuing in an unknown state is how
// you get a container that answers 200 and writes garbage into somebody's
// budget.
process.on('unhandledRejection', (e) => { console.error('[daily] unhandledRejection:', e); });
process.on('uncaughtException', (e) => { console.error('[daily] uncaughtException:', e); process.exit(1); });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[daily] listening on ${PORT} — ${registered} routes, db ${daily ? 'up' : 'MISSING'}`);
  if (!process.env.DATABASE_URL) console.warn('[daily] WARNING: DATABASE_URL is not set');

  // Say out loud which optional integrations this deployment can actually do.
  // Every one of them degrades to a clean "not set up" rather than a crash, so
  // without this line a missing STRIPE key looks exactly like a working one
  // until the first customer tries to pay.
  const report = (name, mod) => {
    try {
      const m = require(mod);
      if (typeof m.configured !== 'function') return;
      if (m.configured()) console.log(`[daily] ${name}: configured`);
      else console.warn(`[daily] ${name}: NOT configured — missing ${(m.missingConfig?.() || []).join(', ') || 'config'}`);
    } catch (e) { console.warn(`[daily] ${name}: unavailable (${e.message})`); }
  };
  report('stripe', './_lib-daily-billing.cjs');
  report('google', './_lib-daily-google.cjs');
  report('mail', './_lib-daily-mail.cjs');

  // Build the schema now rather than on the first request. A cold container
  // whose first visitor is a Stripe webhook would otherwise pay for ~20 CREATE
  // TABLE round trips inside the few seconds Stripe waits before deciding the
  // endpoint failed.
  if (daily) {
    daily.ensureSchema()
      .then(() => console.log('[daily] schema ready'))
      .catch((e) => console.error('[daily] schema bootstrap failed:', e?.message || e));
    try {
      require('./_lib-daily-budget.cjs').ensureSchema()
        .catch((e) => console.error('[daily] budget schema failed:', e?.message || e));
    } catch { /* module reports its own unavailability through the routes */ }
  }
});
