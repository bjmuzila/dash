'use strict';
/**
 * server-v2/mcp-oauth.js — the OAuth 2.1 authorization server behind the
 * ChatGPT / MCP connector ("Connect CB Edge" inside ChatGPT).
 *
 * ── What this is ─────────────────────────────────────────────────────────────
 * ChatGPT connects to a remote MCP server (server-v2/mcp-server.js, served at
 * /mcp) and needs a bearer token for the person using it. This file is the
 * piece that mints that token, and it does it on CB EDGE'S OWN LOGIN — the
 * same `cbe_session` cookie, `sessions` table and paid check every dashboard
 * page uses (ws-auth.js). There is no second account, no Supabase, no Clerk:
 * the customer signs in to cbedge.net exactly as they always do, clicks Allow,
 * and ChatGPT gets a token tied to their users.id.
 *
 *   ChatGPT ──POST /mcp ────────────────────────► 401 + WWW-Authenticate
 *           ──GET /.well-known/oauth-protected-resource/mcp
 *           ──GET /.well-known/oauth-authorization-server
 *           ──POST /oauth/register  (Dynamic Client Registration, RFC 7591)
 *   browser ──GET /oauth/authorize ─► not signed in? → /sign-in?next=…  (back here)
 *                                  ─► signed in, unpaid? → "membership required"
 *                                  ─► signed in + paid → consent page [Allow]
 *           ──POST /oauth/authorize ─► 303 → ChatGPT's redirect_uri?code=…&state=…&iss=…
 *   ChatGPT ──POST /oauth/token (code + PKCE verifier) ─► access + refresh token
 *           ──POST /mcp  Authorization: Bearer cbe_mcp_at_…
 *
 * ── Rules this file keeps ────────────────────────────────────────────────────
 *  - Who may connect is decided by ws-auth.js and nothing else: owner, active /
 *    trialing subscriber, or a live comp_access grant. Checked at consent, at
 *    every token grant, and (via checkEntitlement) on every tool call, so a
 *    Stripe cancellation cuts ChatGPT off within a minute, not at token expiry.
 *  - Tokens are opaque random strings; only their sha256 is stored. Same
 *    reasoning as lib/auth/session.ts — revocable, and a DB leak leaks nothing
 *    usable.
 *  - PKCE S256 is mandatory (OAuth 2.1, and ChatGPT refuses servers that do
 *    not advertise it). Authorization codes are single-use; replaying one
 *    revokes every token it produced.
 *  - Nothing is consumed until the grant is certain to succeed. A code is
 *    burned, or a refresh token rotated, in the SAME statement that inserts the
 *    new tokens — so a DB blip or a transient entitlement failure leaves the
 *    client holding a code/refresh token it can simply retry.
 *  - Refresh tokens rotate. A retry of an already-rotated refresh token within
 *    REFRESH_REUSE_GRACE_SEC (the client lost our response) supersedes the pair
 *    the first rotation minted and answers again; the same token presented after
 *    the grace window means two parties hold it, and the whole grant is revoked.
 *  - At most MCP_MAX_GRANTS live connections per member (default 2: e.g. ChatGPT
 *    and Claude). A new approval past the cap revokes the least recently used
 *    one, so a membership cannot be fanned out to a group of friends' ChatGPTs.
 *  - Redirect URIs are restricted to https on an exact allowlisted AI-client
 *    host (MCP_REDIRECT_HOSTS — no subdomains), so a stranger cannot register a
 *    "client" that ships a customer's code to their own server. Gemini is the
 *    one path-restricted entry: see GEMINI_RELAY below.
 *  - It never writes the `sessions` table. A ChatGPT connection is not a device:
 *    it does not count toward the session cap in lib/db.ts and cannot kick
 *    anyone's browser.
 *
 * ── Tables (created on first use, owned here — same pattern as daily-em.js) ──
 *   mcp_oauth_clients   one row per Dynamic Client Registration
 *   mcp_oauth_codes     authorization codes, 5-minute life, single use
 *   mcp_oauth_tokens    access (1h) + refresh (30d) tokens, grouped by family_id
 *                       (one family = one approval = one "connection")
 *   mcp_tool_calls      one row per tools/call (owner tracker, kept 90 days)
 *   mcp_oauth_events    approvals, refusals, revocations (owner tracker, 90 days)
 *   The last two only feed owner.cbedge.net → AI Connections (mcp-admin.js).
 *   Codes and tokens cascade on users(id): deleting an account deletes its
 *   ChatGPT grants with it.
 *
 * ── Env (all optional) ───────────────────────────────────────────────────────
 *   MCP_PUBLIC_ORIGIN   pin the issuer, e.g. https://cbedge.net. Unset → the
 *                       request's Host, but only if it is in MCP_ALLOWED_HOSTS.
 *   MCP_ALLOWED_HOSTS   default "cbedge.net,www.cbedge.net".
 *   MCP_REDIRECT_HOSTS  default "chatgpt.com,claude.ai,claude.com".
 *   MCP_ALLOW_GEMINI    "0" refuses Gemini's custom-app callback (default on).
 *   MCP_ALLOW_LOOPBACK  "1" accepts http://localhost redirect URIs in production
 *                       (MCP Inspector testing). Always on off-production.
 *   MCP_MAX_GRANTS      live connections per member, default 2.
 *   MCP_OAUTH_SECRET    HMAC key for the consent form's CSRF token. Falls back
 *                       to INTERNAL_API_TOKEN, then to a per-boot random key.
 */

const crypto = require('crypto');
const { verifyWsRequest, getAccessForUser, isTransientAuthFailure } = require('./ws-auth');

let libDb = null;
try { libDb = require('./_lib-db.cjs'); }
catch (e) { console.warn('[mcp-oauth] _lib-db.cjs not loaded — ChatGPT connector cannot issue tokens:', e.message); }

// ── Constants ───────────────────────────────────────────────────────────────

const SCOPE = 'cbedge.read';
const SCOPES_SUPPORTED = [SCOPE];

const CODE_TTL_SEC = 5 * 60;
const ACCESS_TTL_SEC = 60 * 60;
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;
const REFRESH_REUSE_GRACE_SEC = 60;
const CSRF_TTL_MS = 15 * 60 * 1000;
const maxGrants = () => Math.max(1, Number(process.env.MCP_MAX_GRANTS) || 2);

const PREFIX = { client: 'cbe_mcp_cl_', secret: 'cbe_mcp_cs_', code: 'cbe_mcp_ac_', access: 'cbe_mcp_at_', refresh: 'cbe_mcp_rt_' };
// Every credential is PREFIX + base64url(32 random bytes) = 43 chars. Anything
// else is rejected before it costs a database round trip.
const shapeOf = (prefix) => new RegExp(`^${prefix}[A-Za-z0-9_-]{43}$`);
const SHAPE = Object.fromEntries(Object.entries(PREFIX).map(([k, p]) => [k, shapeOf(p)]));

const PROD = process.env.NODE_ENV === 'production';
const ALLOW_LOOPBACK = !PROD || process.env.MCP_ALLOW_LOOPBACK === '1';

const csvList = (raw, fallback) =>
  String(raw || fallback).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ALLOWED_HOSTS = new Set(csvList(process.env.MCP_ALLOWED_HOSTS, 'cbedge.net,www.cbedge.net'));
const REDIRECT_HOSTS = new Set(csvList(process.env.MCP_REDIRECT_HOSTS, 'chatgpt.com,claude.ai,claude.com'));

const CSRF_KEY = (process.env.MCP_OAUTH_SECRET || process.env.INTERNAL_API_TOKEN || '').trim()
  || crypto.randomBytes(32).toString('hex');

// ── Small helpers ───────────────────────────────────────────────────────────

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = (prefix) => prefix + crypto.randomBytes(32).toString('base64url');
const b64urlSha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * The public origin this request reached us on — the OAuth issuer and the base
 * of every advertised URL. Pinned by MCP_PUBLIC_ORIGIN when set; otherwise the
 * Host header (Cloudflare sets it to the zone hostname the visitor asked for),
 * but ONLY if it is one of ours. X-Forwarded-Host is ignored on purpose: it is
 * a client-supplied header and the issuer must not be steerable by a caller.
 */
function publicOrigin(req) {
  const pinned = (process.env.MCP_PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
  if (pinned) return pinned;
  const host = String(req.headers.host || '').trim().toLowerCase();
  const bare = host.replace(/:\d+$/, '');
  if (ALLOWED_HOSTS.has(bare)) return `https://${bare}`;
  if (!PROD && (bare === 'localhost' || bare === '127.0.0.1')) return `http://${host}`;
  return 'https://cbedge.net';
}

const resourceUrl = (origin) => `${origin}/mcp`;
const prmUrl = (origin) => `${origin}/.well-known/oauth-protected-resource/mcp`;
const normResource = (r) => String(r || '').replace(/\/+$/, '');

/** A `resource` parameter we will mint for: the MCP endpoint, or the bare origin. */
function resourceOk(resource, origin) {
  if (!resource) return true;
  const r = normResource(resource);
  return r === resourceUrl(origin) || r === origin;
}

// ── GEMINI (gemini.google.com → Settings → Connected Apps → Add a custom app)
// Gemini registers by DCR like ChatGPT, but its callback is Google's shared
// OAuth relay, not a gemini.google.com URL:
//
//   https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-<id>-<our host, dots → _>
//   e.g. …/r/user_bound_custom-mcp-116109532806053202916-www_cbedge_net
//
// One DCR request carries SIX of these, spread over Google's relay hosts
// (oauth-redirect, oauth-redirect-sandbox, … — all oauth-redirect*.google
// usercontent.com), and Gemini gives up on the whole connection — "The Google
// redirect URL was rejected by the server" — if the registration is refused.
// So every oauth-redirect*.googleusercontent.com host is accepted rather than
// a hand-picked list, and handleRegister keeps the callbacks it accepts
// instead of failing the lot over one it does not.
//
// That relay serves EVERY Google Cloud project at /r/<project-id>, so allowing
// the host alone would let any project on Earth register as a "client" and
// collect a customer's code. The PATH is what makes it Gemini's: a Cloud
// project id cannot contain an underscore, so no project can own
// /r/user_bound_… . Every relay host is held to that same path rule.
const GEMINI_RELAY_HOST = /^oauth-redirect(?:-[a-z0-9]+)*\.googleusercontent\.com$/;
const GEMINI_RELAY_PATH = /^\/r\/user_bound_[A-Za-z0-9._~-]+$/;
const isGeminiRelay = (u) => process.env.MCP_ALLOW_GEMINI !== '0'
  && u.protocol === 'https:' && !u.port && GEMINI_RELAY_HOST.test(u.hostname.toLowerCase())
  && GEMINI_RELAY_PATH.test(u.pathname);

/** Registered redirect URIs: https on an EXACT allowlisted AI-client host
 *  (ChatGPT: /connector_platform_oauth_redirect or /connector/oauth/{id};
 *  Claude: /api/mcp/auth_callback), Gemini's relay path, or loopback where allowed. */
function redirectAllowed(uri) {
  let u;
  try { u = new URL(String(uri)); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (u.protocol === 'http:') return ALLOW_LOOPBACK && (h === 'localhost' || h === '127.0.0.1' || h === '[::1]');
  if (isGeminiRelay(u)) return true;
  return u.protocol === 'https:' && REDIRECT_HOSTS.has(h);
}

/** What the consent page says the code is going back to. `client_name` is
 *  whatever the registering client typed; this is read off the redirect URI,
 *  which the allowlist above has already vouched for. */
function destinationLabel(uri) {
  const u = new URL(uri);
  const h = u.hostname.toLowerCase();
  if (isGeminiRelay(u)) return 'Google Gemini';
  if (h === 'chatgpt.com') return 'ChatGPT · chatgpt.com';
  if (h === 'claude.ai' || h === 'claude.com') return `Claude · ${h}`;
  return u.host;
}

/** Which AI app a client is, read off its (allowlisted) redirect URIs — for
 *  the owner tracker. The client_name is whatever the app chose to send. */
function appOf(uris) {
  for (const uri of Array.isArray(uris) ? uris : [uris]) {
    let u;
    try { u = new URL(String(uri)); } catch { continue; }
    const h = u.hostname.toLowerCase();
    if (isGeminiRelay(u)) return 'gemini';
    if (h === 'chatgpt.com') return 'chatgpt';
    if (h === 'claude.ai' || h === 'claude.com') return 'claude';
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return 'local';
  }
  return 'other';
}

/** Caller's IP for rate limits. Behind Cloudflare that is cf-connecting-ip;
 *  IPv6 is keyed by /64 so one host cannot rotate its way past a limit. */
function clientKey(req) {
  const ip = String(req.headers['cf-connecting-ip'] || req.socket?.remoteAddress || 'unknown').trim();
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
}

/** Sliding-window counter with a hard cap on tracked keys. */
function makeLimiter(limit, windowMs, maxKeys = 20000) {
  const hits = new Map();
  const live = (k, now) => (hits.get(k) || []).filter((t) => now - t < windowMs);
  return {
    blocked(key) { return live(key, Date.now()).length >= limit; },
    hit(key) {
      const now = Date.now();
      const arr = live(key, now);
      if (arr.length >= limit) { hits.set(key, arr); return false; }
      arr.push(now);
      hits.delete(key);
      hits.set(key, arr);
      if (hits.size > maxKeys) hits.delete(hits.keys().next().value);
      return true;
    },
    reset() { hits.clear(); },
  };
}

// Registration is open (RFC 7591), so it is limited per caller AND globally.
const regPerIp = makeLimiter(20, 60 * 60 * 1000);
const regGlobal = makeLimiter(500, 60 * 60 * 1000);
// Failed credentials (bad bearer, unknown client) per caller. Once tripped, the
// caller is answered 429 without a database query — that is the whole point.
const authFailures = makeLimiter(120, 60 * 1000);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version');
  res.setHeader('Access-Control-Max-Age', '600');
}

function sendJson(res, status, body, extra = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

const oauthError = (res, status, error, description, extra) => {
  // Remembered on the response so handleToken can log the refusal it sent.
  res._oauthError = { status, error, description: description || null };
  return sendJson(res, status, description ? { error, error_description: description } : { error }, extra);
};

function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Form or JSON body → plain object. Token/revoke/consent accept both. */
async function readParams(req) {
  const raw = await readBody(req);
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) {
    let j = {};
    try { j = raw ? JSON.parse(raw) : {}; } catch { j = {}; }
    return (j && typeof j === 'object' && !Array.isArray(j)) ? j : {};
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

/** A DB error must never surface as a raw 500 with a pg message in it. */
function jsonGuard(fn) {
  return async (req, res, ctx) => {
    try { await fn(req, res, ctx); }
    catch (e) {
      console.warn(`[mcp-oauth] ${req.method} ${String(req.url).split('?')[0]} failed:`, e?.message || e);
      if (!res.headersSent) oauthError(res, 503, 'temporarily_unavailable', undefined, { 'Retry-After': '5' });
      else res.end();
    }
  };
}

// ── Storage ─────────────────────────────────────────────────────────────────

let _query = (sql, params) => {
  if (!libDb) throw new Error('database unavailable');
  return libDb.pgQuery(sql, params);
};

let ensured = null;
function ensureTables() {
  if (!ensured) {
    ensured = (async () => {
      await _query(`
        CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
          client_id                  TEXT PRIMARY KEY,
          client_secret_hash         TEXT,
          client_name                TEXT,
          redirect_uris              JSONB NOT NULL,
          token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
          created_ip                 TEXT,
          created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          first_used_at              TIMESTAMPTZ
        )`, []);
      await _query(`
        CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
          code_hash      TEXT PRIMARY KEY,
          client_id      TEXT NOT NULL,
          user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          redirect_uri   TEXT NOT NULL,
          code_challenge TEXT NOT NULL,
          scope          TEXT,
          resource       TEXT,
          family_id      TEXT NOT NULL,
          expires_at     TIMESTAMPTZ NOT NULL,
          used_at        TIMESTAMPTZ,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`, []);
      await _query(`
        CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
          token_hash     TEXT PRIMARY KEY,
          kind           TEXT NOT NULL,
          client_id      TEXT NOT NULL,
          user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          scope          TEXT,
          resource       TEXT,
          family_id      TEXT NOT NULL,
          rotated_from   TEXT,
          expires_at     TIMESTAMPTZ NOT NULL,
          revoked_at     TIMESTAMPTZ,
          revoked_reason TEXT,
          last_used_at   TIMESTAMPTZ,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`, []);
      await _query('CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_family_idx ON mcp_oauth_tokens (family_id)', []);
      await _query('CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_user_idx ON mcp_oauth_tokens (user_id)', []);
      await _query('CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_parent_idx ON mcp_oauth_tokens (rotated_from)', []);
      // The owner tracker's history (owner.cbedge.net → AI Connections, read by
      // server-v2/mcp-admin.js). Written fire-and-forget: a failed log line
      // never fails the request it describes.
      //   mcp_tool_calls    one row per tools/call, with how it ended
      //   mcp_oauth_events  the connection story: approvals, refusals, revocations
      await _query(`
        CREATE TABLE IF NOT EXISTS mcp_tool_calls (
          id         BIGSERIAL PRIMARY KEY,
          at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          client_id  TEXT,
          family_id  TEXT,
          tool       TEXT NOT NULL,
          outcome    TEXT NOT NULL,
          ms         INTEGER
        )`, []);
      await _query('CREATE INDEX IF NOT EXISTS mcp_tool_calls_at_idx ON mcp_tool_calls (at)', []);
      await _query('CREATE INDEX IF NOT EXISTS mcp_tool_calls_family_idx ON mcp_tool_calls (family_id)', []);
      await _query(`
        CREATE TABLE IF NOT EXISTS mcp_oauth_events (
          id         BIGSERIAL PRIMARY KEY,
          at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          kind       TEXT NOT NULL,
          client_id  TEXT,
          user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
          ip         TEXT,
          detail     JSONB
        )`, []);
      await _query('CREATE INDEX IF NOT EXISTS mcp_oauth_events_at_idx ON mcp_oauth_events (at)', []);
    })().catch((err) => { ensured = null; throw err; });
  }
  return ensured;
}

async function q(sql, params = []) {
  await ensureTables();
  return _query(sql, params);
}

// Expired rows are dead weight; prune at most hourly, piggy-backed on a grant.
// A client is pruned only if it was registered a week ago and never used —
// a client ChatGPT is still holding must keep working after its tokens lapse.
let _lastPrune = 0;
function maybePrune() {
  if (Date.now() - _lastPrune < 60 * 60 * 1000) return;
  _lastPrune = Date.now();
  Promise.all([
    q(`DELETE FROM mcp_oauth_codes WHERE expires_at < NOW() - INTERVAL '1 day'`),
    q(`DELETE FROM mcp_oauth_tokens WHERE expires_at < NOW() - INTERVAL '7 days'`),
    q(`DELETE FROM mcp_oauth_clients WHERE first_used_at IS NULL AND created_at < NOW() - INTERVAL '7 days'`),
    q(`DELETE FROM mcp_tool_calls WHERE at < NOW() - INTERVAL '90 days'`),
    q(`DELETE FROM mcp_oauth_events WHERE at < NOW() - INTERVAL '90 days'`),
  ]).catch((e) => console.warn('[mcp-oauth] prune failed:', e.message));
}

// ── Tracker log (owner.cbedge.net → AI Connections) ─────────────────────────
// Both writers are fire-and-forget and never throw. Events can be triggered by
// anyone on the internet (a refused registration, a bad authorize link), so
// they are capped globally; past the cap the console line is the record.
const eventLimit = makeLimiter(600, 60 * 60 * 1000, 10);

/** kind: approved | consent_denied | no_membership | revoked |
 *        register_refused | authorize_refused | token_refused */
function recordEvent(kind, { clientId = null, userId = null, ip = null, detail = null } = {}) {
  if (!eventLimit.hit('all')) return;
  let json = detail == null ? null : JSON.stringify(detail);
  if (json && json.length > 8000) json = JSON.stringify({ truncated: true, head: json.slice(0, 4000) });
  q(`INSERT INTO mcp_oauth_events (kind, client_id, user_id, ip, detail) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [kind, clientId ? String(clientId).slice(0, 100) : null, userId, ip, json])
    .catch((e) => console.warn('[mcp-oauth] event log failed:', e.message));
}

/** outcome: ok | error | rate_limited | no_membership */
function recordToolCall({ userId, clientId, familyId, tool, outcome, ms }) {
  q(`INSERT INTO mcp_tool_calls (user_id, client_id, family_id, tool, outcome, ms) VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, clientId || null, familyId || null, String(tool).slice(0, 60), outcome, Number.isFinite(ms) ? Math.round(ms) : null])
    .catch((e) => console.warn('[mcp] call log failed:', e.message));
}

// ── Caches ──────────────────────────────────────────────────────────────────

/** Bounded Map: oldest entry evicted past `max`. Only positive results go in. */
function boundedSet(map, key, value, max) {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value);
}

const CLIENT_CACHE_MS = 5 * 60 * 1000;
const _clientCache = new Map(); // client_id -> { at, value }

const TOKEN_CACHE_MS = 30_000;
const _tokenCache = new Map(); // tokenHash -> { at, value }

const ENT_CACHE_MS = 60_000;
const _entCache = new Map(); // userId -> { at, value }
const _entInFlight = new Map(); // userId -> Promise

function forgetFamily(familyId) {
  for (const [k, v] of _tokenCache) if (v.value?.familyId === familyId) _tokenCache.delete(k);
}

// ── Clients (Dynamic Client Registration) ───────────────────────────────────

async function getClient(clientId) {
  if (typeof clientId !== 'string' || !SHAPE.client.test(clientId)) return null;
  const hit = _clientCache.get(clientId);
  if (hit && Date.now() - hit.at < CLIENT_CACHE_MS) return hit.value;
  const r = await q('SELECT * FROM mcp_oauth_clients WHERE client_id = $1 LIMIT 1', [clientId]);
  const row = r.rows[0];
  if (!row) return null;
  const uris = Array.isArray(row.redirect_uris) ? row.redirect_uris : JSON.parse(row.redirect_uris || '[]');
  const value = { ...row, redirect_uris: uris };
  boundedSet(_clientCache, clientId, { at: Date.now(), value }, 2000);
  return value;
}

/** Client authentication at /oauth/token and /oauth/revoke. Public clients
 *  (token_endpoint_auth_method 'none') authenticate by PKCE alone. */
async function authenticateClient(req, body) {
  let clientId = body.client_id || null;
  let secret = body.client_secret || null;
  const authz = String(req.headers.authorization || '');
  if (/^basic\s+/i.test(authz)) {
    try {
      const dec = Buffer.from(authz.replace(/^basic\s+/i, ''), 'base64').toString('utf8');
      const i = dec.indexOf(':');
      if (i > 0) {
        clientId = decodeURIComponent(dec.slice(0, i));
        secret = decodeURIComponent(dec.slice(i + 1));
      }
    } catch { /* fall through to body credentials */ }
  }
  const client = await getClient(clientId);
  if (!client) return null;
  if (client.token_endpoint_auth_method !== 'none') {
    if (!secret || !client.client_secret_hash || !safeEqual(sha256(secret), client.client_secret_hash)) return null;
  }
  return client;
}

/** What a registration asked for, for the refusal log: the standard fields
 *  verbatim, anything else (software statements, jwks, …) by key name only. */
const SHAPE_FIELDS = ['redirect_uris', 'token_endpoint_auth_method', 'grant_types', 'response_types', 'scope', 'application_type'];
function registrationShape(body) {
  const out = {};
  for (const k of SHAPE_FIELDS) if (k in body) out[k] = body[k];
  const other = Object.keys(body).filter((k) => !SHAPE_FIELDS.includes(k) && k !== 'client_name');
  if (other.length) out.other_keys = other.slice(0, 30);
  return out;
}

async function handleRegister(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  const key = clientKey(req);
  if (regPerIp.blocked(key) || !regGlobal.hit('all') || !regPerIp.hit(key)) {
    return oauthError(res, 429, 'invalid_request', 'Too many registrations. Try again later.', { 'Retry-After': '3600' });
  }
  let body;
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return oauthError(res, 400, 'invalid_client_metadata', 'Body must be a JSON object.');
  }

  const name = String(body.client_name || '').replace(/[\u0000-\u001f]/g, '').slice(0, 100) || null;
  // Every refusal is logged with what the client actually sent, so the next
  // "the server rejected it" from some AI app is one `docker logs` away from a
  // fix. Redirect URIs and metadata are not secrets; nothing else is logged.
  const reject = (code, message) => {
    const shape = registrationShape(body);
    console.warn(`[mcp-oauth] registration refused (${code}: ${message}) client="${name || '(unnamed)'}" ip=${key}`
      + ` meta=${JSON.stringify(shape).slice(0, 4000)}`);
    recordEvent('register_refused', { ip: key, detail: { error: code, message, client_name: name, ...shape } });
    return oauthError(res, 400, code, message);
  };

  const sent = body.redirect_uris;
  if (!Array.isArray(sent) || !sent.length || sent.length > 20 || !sent.every((u) => typeof u === 'string' && u.length <= 500)) {
    return reject('invalid_redirect_uri', 'redirect_uris must be a non-empty array of URLs.');
  }
  // RFC 7591 §2 lets the server trim what a client asks for. A client that
  // registers several callbacks gets the ones on the allowlist; any it
  // listed that are not, it simply cannot use. Only a request with no
  // acceptable callback at all is refused.
  const uris = [...new Set(sent.filter((u) => redirectAllowed(u)))];
  const dropped = sent.filter((u) => !redirectAllowed(u));
  if (!uris.length) return reject('invalid_redirect_uri', `Redirect URI not allowed: ${String(sent[0]).slice(0, 200)}`);

  // RFC 7591's default is client_secret_basic, but MCP clients are public PKCE
  // clients and nearly always send 'none' explicitly. Omitted → 'none', and the
  // response says so, so the client knows not to expect a secret. Gemini sends
  // client_secret_basic and gets a secret.
  const method = body.token_endpoint_auth_method || 'none';
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) {
    return reject('invalid_client_metadata', 'Unsupported token_endpoint_auth_method.');
  }
  // Grant and response types are likewise trimmed to what this server does,
  // as long as the authorization-code flow is among what was asked for.
  const gt = body.grant_types;
  if (gt != null && (!Array.isArray(gt) || !gt.includes('authorization_code'))) {
    return reject('invalid_client_metadata', 'The authorization_code grant is required.');
  }
  const rt = body.response_types;
  if (rt != null && (!Array.isArray(rt) || !rt.includes('code'))) {
    return reject('invalid_client_metadata', 'The "code" response type is required.');
  }

  const clientId = randomToken(PREFIX.client);
  const secret = method === 'none' ? null : randomToken(PREFIX.secret);
  await q(
    `INSERT INTO mcp_oauth_clients
       (client_id, client_secret_hash, client_name, redirect_uris, token_endpoint_auth_method, created_ip)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [clientId, secret ? sha256(secret) : null, name, JSON.stringify(uris), method, key],
  );
  console.log(`[mcp-oauth] registered client "${name || '(unnamed)'}" (${method}) → ${uris.map((u) => u.slice(0, 200)).join(' , ')}`
    + (dropped.length ? ` | dropped: ${dropped.map((u) => String(u).slice(0, 200)).join(' , ')}` : ''));

  const out = {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: method,
    scope: SCOPE,
  };
  if (name) out.client_name = name;
  if (secret) { out.client_secret = secret; out.client_secret_expires_at = 0; }
  sendJson(res, 201, out);
}

// ── Discovery ───────────────────────────────────────────────────────────────

function asMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: SCOPES_SUPPORTED,
    authorization_response_iss_parameter_supported: true,
    service_documentation: origin,
  };
}

function prMetadata(origin) {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: SCOPES_SUPPORTED,
    bearer_methods_supported: ['header'],
    resource_name: 'CB Edge',
    resource_documentation: origin,
  };
}

// no-store (sendJson's default): the body depends on Host, and a cached copy
// served under the other hostname would fail every client's issuer check.
function metadataHandler(build) {
  return async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    sendJson(res, 200, build(publicOrigin(req)));
  };
}

const handleAsMetadata = metadataHandler(asMetadata);
const handlePrMetadata = metadataHandler(prMetadata);

// ── Authorize (browser) ─────────────────────────────────────────────────────

const AUTH_PARAMS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge',
  'code_challenge_method', 'state', 'scope', 'resource'];

const PKCE_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/; // base64url(sha256) — always 43 chars

function csrfFor(sessionHash, p, ts = Date.now()) {
  const mac = crypto.createHmac('sha256', CSRF_KEY)
    .update([sessionHash, p.client_id, p.redirect_uri, p.code_challenge, p.state || '', ts].join('\n'))
    .digest('base64url');
  return `${ts}.${mac}`;
}
function csrfOk(token, sessionHash, p) {
  const [tsRaw] = String(token || '').split('.');
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || Date.now() - ts > CSRF_TTL_MS || ts > Date.now() + 60_000) return false;
  return safeEqual(token, csrfFor(sessionHash, p, ts));
}

/** The client's redirect_uri with the response parameters and `iss` on it. */
function clientReturnUrl(redirectUri, params, origin) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  u.searchParams.set('iss', origin);
  return u.toString();
}

/** Redirect back to the client (only once client_id + redirect_uri are trusted). */
function redirectWith(res, redirectUri, params, origin) {
  res.statusCode = 303;
  res.setHeader('Location', clientReturnUrl(redirectUri, params, origin));
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

/**
 * The answer to the consent FORM: a page of ours that sends the browser on,
 * rather than a 303. A redirect that follows a form POST is checked against the
 * consent page's CSP `form-action` at EVERY hop, and the client's callback is
 * rarely the last hop — Gemini's goes to Google's OAuth relay and then on into
 * Google. A meta refresh is an ordinary navigation, outside `form-action`, so
 * the whole chain belongs to the client from here. The link is the fallback
 * for a browser that ignores refresh.
 */
function handBack(res, redirectUri, params, origin, appName, approved) {
  const to = clientReturnUrl(redirectUri, params, origin);
  renderPage(res, 200, {
    title: approved ? 'Connected' : 'Cancelled',
    refreshTo: to,
    body: `<h1>${approved ? 'Connected' : 'Not connected'}</h1>
<p>Taking you back to ${escapeHtml(appName)}…</p>
<div class="row"><a class="btn primary" href="${escapeHtml(to)}">Continue</a></div>`,
  });
}

// The page mirrors the v3 landing palette (components/landing/v3Theme.ts V3.*).
// This is a plain CommonJS server file and cannot import that TS module, so the
// handful of values it needs are restated here — keep them in step with it.
const C = { bg: '#07080b', surface: '#0f1117', raised: '#191b22', line: '#23272e', fg: '#ffffff', cyan: '#219ebc', warn: '#e0a44a' };

function renderPage(res, status, { title, body, refreshTo = null }) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  // Replaces the site-wide CSP for this one response. form-action stays 'self':
  // the consent form posts here and is answered with handBack()'s page, never
  // with a cross-origin redirect.
  res.removeHeader('Content-Security-Policy-Report-Only');
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'");
  res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">${refreshTo ? `
<meta http-equiv="refresh" content="0;url=${escapeHtml(refreshTo)}">` : ''}
<title>${escapeHtml(title)} · CB Edge</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;
    background:${C.bg};color:${C.fg};font:15px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
  .card{width:100%;max-width:440px;background:${C.surface};border:1px solid ${C.line};border-radius:14px;padding:28px}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:18px;font-weight:700;letter-spacing:.02em}
  .mark{width:28px;height:28px;background:url(/cbedge-mark.svg) center/contain no-repeat}
  h1{font-size:20px;margin:0 0 10px}
  p{margin:0 0 12px}
  ul{margin:0 0 16px;padding-left:20px} li{margin:4px 0}
  .who{font-size:13px;border-top:1px solid ${C.line};padding-top:12px;margin-top:4px}
  .warn{color:${C.warn};font-weight:600}
  .row{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}
  button,a.btn{flex:1;min-width:120px;display:inline-flex;align-items:center;justify-content:center;padding:12px 16px;border-radius:10px;
    font:inherit;font-weight:700;cursor:pointer;text-decoration:none;white-space:nowrap}
  .primary{background:${C.cyan};border:1px solid ${C.cyan};color:${C.bg}}
  .ghost{background:${C.raised};border:1px solid ${C.line};color:${C.fg};font-weight:600}
</style></head>
<body><main class="card">
<div class="brand"><span class="mark" aria-hidden="true"></span>CB Edge</div>
${body}
</main></body></html>`);
}

function renderError(res, status, message) {
  renderPage(res, status, {
    title: 'Connection problem',
    body: `<h1>Can't connect this app</h1><p>${escapeHtml(message)}</p>
<p>Go back to the app you were using and try connecting CB Edge again.</p>`,
  });
}

/** Resolve the session cookie through ws-auth (the same gate as /api/*). */
async function sessionFor(req) {
  let access;
  try { access = await verifyWsRequest(req); }
  catch { return { transient: true }; }
  if (!access.ok && isTransientAuthFailure(access)) return { transient: true };
  return access; // { ok, userId?, reason, tokenHash? }
}

function sessionHashFromCookie(req) {
  const raw = String(req.headers.cookie || '').split(';')
    .map((s) => s.trim()).find((s) => s.startsWith('cbe_session='));
  return raw ? sha256(decodeURIComponent(raw.slice('cbe_session='.length))) : '';
}

async function emailFor(userId) {
  try {
    const r = await _query('SELECT email FROM users WHERE id = $1 LIMIT 1', [userId]);
    return r.rows[0]?.email || null;
  } catch { return null; }
}

async function handleAuthorize(req, res) {
  const origin = publicOrigin(req);
  const isPost = req.method === 'POST';
  let src;
  if (isPost) {
    try { src = await readParams(req); }
    catch { return renderError(res, 400, 'The request was too large.'); }
  } else {
    src = Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);
  }
  const p = {};
  // 4096: Gemini's `state` alone runs ~1.4k characters, and a dropped state
  // fails the client's own CSRF check after the user has already approved.
  for (const k of AUTH_PARAMS) if (typeof src[k] === 'string' && src[k] !== '' && src[k].length <= 4096) p[k] = src[k];

  // 1) Client + redirect_uri. Until these check out, errors render here and
  //    are NEVER redirected — a bad redirect_uri is exactly the thing an
  //    attacker would want us to send the user to.
  const client = await getClient(p.client_id);
  const refused = (why, extra = {}) => recordEvent('authorize_refused', {
    clientId: client ? client.client_id : null,
    ip: clientKey(req),
    detail: { why, host: String(req.headers.host || '').slice(0, 100), ...extra },
  });
  if (!client) {
    refused('unknown client_id', { client_id: String(p.client_id || '').slice(0, 100) || null });
    return renderError(res, 400, 'This app is not registered with CB Edge (unknown client_id).');
  }
  if (!p.redirect_uri && client.redirect_uris.length === 1) p.redirect_uri = client.redirect_uris[0];
  if (!p.redirect_uri || !client.redirect_uris.includes(p.redirect_uri)) {
    refused('redirect_uri mismatch', { redirect_uri: String(p.redirect_uri || '').slice(0, 300) || null });
    return renderError(res, 400, 'The app sent a return address CB Edge does not recognise (redirect_uri mismatch).');
  }
  const back = (params) => {
    refused(params.error, { description: params.error_description || null });
    return redirectWith(res, p.redirect_uri, { ...params, state: p.state }, origin);
  };

  // 2) Protocol checks — from here on, errors go back to the client.
  if (p.response_type !== 'code') return back({ error: 'unsupported_response_type' });
  if (!p.code_challenge || p.code_challenge_method !== 'S256' || !CHALLENGE_RE.test(p.code_challenge)) {
    return back({ error: 'invalid_request', error_description: 'PKCE with code_challenge_method=S256 is required.' });
  }
  if (!resourceOk(p.resource, origin)) {
    return back({ error: 'invalid_target', error_description: `This server only issues tokens for ${resourceUrl(origin)}.` });
  }

  // 3) Who is at the keyboard — CB Edge's own login.
  const sess = await sessionFor(req);
  if (sess.transient) return renderError(res, 503, 'CB Edge could not check your sign-in just now. Please try again in a minute.');
  if (!sess.userId) {
    // Not signed in (or the session expired). Send them through the normal
    // sign-in page; AuthForm's safeNext() accepts this same-origin path and
    // lands them straight back here with every parameter intact.
    const qs = new URLSearchParams(p).toString();
    res.statusCode = 302;
    res.setHeader('Location', `/sign-in?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
    res.setHeader('Cache-Control', 'no-store');
    res.end();
    return;
  }

  const appName = client.client_name || 'An AI app';
  const appHost = destinationLabel(p.redirect_uri);
  const email = await emailFor(sess.userId);
  // email_off: Cloudflare's email obfuscation would otherwise swap the address
  // for "[email protected]" and this page's CSP blocks the script that decodes it.
  const whoLine = `<p class="who">Signed in to CB Edge as <strong><!--email_off-->${escapeHtml(email || 'your account')}<!--/email_off--></strong>.</p>`;

  if (!sess.ok) {
    // Valid login, no live membership. Nothing to authorize.
    if (!isPost) recordEvent('no_membership', { clientId: client.client_id, userId: sess.userId });
    const denyUrl = new URL(p.redirect_uri);
    denyUrl.searchParams.set('error', 'access_denied');
    denyUrl.searchParams.set('error_description', 'CB Edge membership is not active');
    if (p.state) denyUrl.searchParams.set('state', p.state);
    denyUrl.searchParams.set('iss', origin);
    return renderPage(res, 403, {
      title: 'Membership required',
      body: `<h1>Membership required</h1>
<p><span class="warn">Your CB Edge membership isn't active.</span> Connecting ${escapeHtml(appName)} needs an active membership.</p>
${whoLine}
<div class="row"><a class="btn primary" href="/pricing">See plans</a>
<a class="btn ghost" href="${escapeHtml(denyUrl.toString())}">Cancel</a></div>`,
    });
  }

  // CSRF is bound to the exact session that saw the consent page.
  const sessionHash = sess.tokenHash || sessionHashFromCookie(req);

  if (!isPost) {
    const hidden = Object.entries(p)
      .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('\n');
    return renderPage(res, 200, {
      title: 'Connect',
      body: `<h1>Connect ${escapeHtml(appName)} to CB Edge?</h1>
<p><strong>${escapeHtml(appName)}</strong> <span style="font-size:13px">(${escapeHtml(appHost)})</span> is asking to read your CB Edge market data:</p>
<ul><li>Live SPX gamma levels — walls, gamma flip, strike ladder</li>
<li>Expected moves and weekly levels</li>
<li>Economic calendar and today's earnings</li></ul>
<p>Read-only. It can't change your account, billing or settings. You can disconnect any time from the app's connector settings.</p>
${whoLine}
<form method="post" action="/oauth/authorize">
${hidden}
<input type="hidden" name="csrf" value="${escapeHtml(csrfFor(sessionHash, p))}">
<div class="row"><button class="ghost" type="submit" name="decision" value="deny">Cancel</button>
<button class="primary" type="submit" name="decision" value="allow">Allow</button></div>
</form>`,
    });
  }

  // 4) POST — the consent decision.
  if (!csrfOk(src.csrf, sessionHash, p)) {
    return renderError(res, 400, 'This approval page expired. Go back to the app and connect again.');
  }
  if (src.decision !== 'allow') {
    recordEvent('consent_denied', { clientId: client.client_id, userId: sess.userId });
    return handBack(res, p.redirect_uri, { error: 'access_denied', state: p.state }, origin, appName, false);
  }

  const code = randomToken(PREFIX.code);
  await q(
    `INSERT INTO mcp_oauth_codes
       (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, family_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + $9::int * INTERVAL '1 second')`,
    [sha256(code), client.client_id, sess.userId, p.redirect_uri, p.code_challenge, SCOPE,
      p.resource ? normResource(p.resource) : resourceUrl(origin), crypto.randomUUID(), CODE_TTL_SEC],
  );
  console.log(`[mcp-oauth] user ${sess.userId} approved "${appName}" (${appHost})`);
  recordEvent('approved', { clientId: client.client_id, userId: sess.userId });
  return handBack(res, p.redirect_uri, { code, state: p.state }, origin, appName, true);
}

const handleAuthorizeGuarded = async (req, res, ctx) => {
  try { await handleAuthorize(req, res, ctx); }
  catch (e) {
    console.warn('[mcp-oauth] authorize failed:', e?.message || e);
    if (!res.headersSent) renderError(res, 503, 'CB Edge is having trouble right now. Please try again in a minute.');
    else res.end();
  }
};

// ── Token endpoint ──────────────────────────────────────────────────────────

const tokenBody = (access, refresh, scope) => ({
  access_token: access,
  token_type: 'Bearer',
  expires_in: ACCESS_TTL_SEC,
  refresh_token: refresh,
  scope: scope || SCOPE,
});

// One statement: consume the source credential AND insert the new pair, so
// either both happen or neither does. `$1` names the source row; the INSERT
// copies identity columns off whatever the CTE returned.
const INSERT_PAIR_FROM = (cte) => `
  ${cte}
  INSERT INTO mcp_oauth_tokens
    (token_hash, kind, client_id, user_id, scope, resource, family_id, rotated_from, expires_at)
  SELECT $2, 'access', client_id, user_id, scope, resource, family_id, $6, NOW() + $4::int * INTERVAL '1 second' FROM src
  UNION ALL
  SELECT $3, 'refresh', client_id, user_id, scope, resource, family_id, $6, NOW() + $5::int * INTERVAL '1 second' FROM src
  RETURNING kind`;

const SQL_REDEEM_CODE = INSERT_PAIR_FROM(`
  WITH src AS (
    UPDATE mcp_oauth_codes SET used_at = NOW()
     WHERE code_hash = $1 AND used_at IS NULL AND expires_at > NOW()
     RETURNING client_id, user_id, scope, resource, family_id
  )`);

const SQL_ROTATE = INSERT_PAIR_FROM(`
  WITH src AS (
    UPDATE mcp_oauth_tokens SET revoked_at = NOW(), revoked_reason = 'rotated', last_used_at = NOW()
     WHERE token_hash = $1 AND kind = 'refresh' AND revoked_at IS NULL AND expires_at > NOW()
     RETURNING client_id, user_id, scope, resource, family_id
  )`);

// Grace-window retry: supersede whatever the first rotation of $1 minted, and
// mint again from the same (already rotated, not family-revoked) parent.
const SQL_REISSUE = INSERT_PAIR_FROM(`
  WITH parent AS (
    SELECT client_id, user_id, scope, resource, family_id FROM mcp_oauth_tokens
     WHERE token_hash = $1 AND kind = 'refresh' AND revoked_reason = 'rotated'
       AND revoked_at > NOW() - $7::int * INTERVAL '1 second' AND expires_at > NOW()
  ), gone AS (
    UPDATE mcp_oauth_tokens SET revoked_at = NOW(), revoked_reason = 'superseded'
     WHERE rotated_from = $1 AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM parent)
     RETURNING 1
  ), src AS (SELECT * FROM parent)`);

async function insertPair(sql, sourceHash, extra = []) {
  const access = randomToken(PREFIX.access);
  const refresh = randomToken(PREFIX.refresh);
  // rotated_from: the refresh token this pair replaced (NULL for a fresh grant).
  const parent = sql === SQL_REDEEM_CODE ? null : sourceHash;
  const r = await q(sql, [sourceHash, sha256(access), sha256(refresh), ACCESS_TTL_SEC, REFRESH_TTL_SEC, parent, ...extra]);
  return r.rows.length === 2 ? { access, refresh } : null;
}

async function revokeFamily(familyId, why) {
  // Overwrites revoked_reason on EVERY row of the family, including rows that
  // merely rotated — that is what stops the grace-window path from resurrecting
  // a grant that was killed on purpose.
  const r = await q(
    `UPDATE mcp_oauth_tokens SET revoked_at = COALESCE(revoked_at, NOW()), revoked_reason = $2
      WHERE family_id = $1
      RETURNING user_id, client_id`,
    [familyId, String(why).slice(0, 60)],
  );
  forgetFamily(familyId);
  console.warn(`[mcp-oauth] revoked grant ${familyId}: ${why}`);
  const row = r.rows[0];
  if (row) recordEvent('revoked', { clientId: row.client_id, userId: row.user_id, detail: { family_id: familyId, reason: String(why).slice(0, 60) } });
  return r.rows.length;
}

/** Keep the member's maxGrants() most recently active connections; revoke the rest. */
async function enforceGrantCap(userId) {
  const cap = maxGrants();
  const r = await q(
    `SELECT family_id FROM mcp_oauth_tokens
      WHERE user_id = $1 AND kind = 'refresh' AND revoked_at IS NULL AND expires_at > NOW()
      GROUP BY family_id ORDER BY MAX(created_at) DESC OFFSET $2`,
    [userId, cap],
  );
  for (const { family_id: fam } of r.rows) await revokeFamily(fam, `over the ${cap}-connection limit`);
}

const membershipError = (res, ent) => (ent.transient
  ? oauthError(res, 503, 'temporarily_unavailable', undefined, { 'Retry-After': '5' })
  : oauthError(res, 400, 'invalid_grant', 'CB Edge membership is not active.'));

async function grantFromCode(res, client, body, origin) {
  const { code, code_verifier: verifier } = body;
  if (!code || !verifier) return oauthError(res, 400, 'invalid_request', 'code and code_verifier are required.');
  if (!SHAPE.code.test(code)) return oauthError(res, 400, 'invalid_grant', 'Authorization code is invalid.');
  const codeHash = sha256(code);
  const found = await q('SELECT *, (expires_at > NOW()) AS live FROM mcp_oauth_codes WHERE code_hash = $1', [codeHash]);
  const row = found.rows[0];
  if (!row) return oauthError(res, 400, 'invalid_grant', 'Authorization code is invalid.');
  if (row.used_at) {
    // Replayed code → kill whatever it already produced (OAuth 2.1 §4.1.3).
    await revokeFamily(row.family_id, 'authorization code replayed');
    return oauthError(res, 400, 'invalid_grant', 'Authorization code was already used.');
  }
  if (!row.live) return oauthError(res, 400, 'invalid_grant', 'Authorization code expired.');
  if (row.client_id !== client.client_id) return oauthError(res, 400, 'invalid_grant', 'Code was issued to another client.');
  if (body.redirect_uri && body.redirect_uri !== row.redirect_uri) {
    return oauthError(res, 400, 'invalid_grant', 'redirect_uri does not match the authorization request.');
  }
  if (!PKCE_RE.test(verifier) || !safeEqual(b64urlSha256(verifier), row.code_challenge)) {
    // A wrong verifier burns the code: whoever is guessing gets one try.
    await q('UPDATE mcp_oauth_codes SET used_at = NOW() WHERE code_hash = $1 AND used_at IS NULL', [codeHash]);
    return oauthError(res, 400, 'invalid_grant', 'PKCE verification failed.');
  }
  if (body.resource && normResource(body.resource) !== row.resource && !resourceOk(body.resource, origin)) {
    return oauthError(res, 400, 'invalid_target');
  }
  // Entitlement BEFORE the code is consumed: a transient failure leaves it retryable.
  const ent = await checkEntitlement(row.user_id, { fresh: true });
  if (!ent.ok) return membershipError(res, ent);

  const pair = await insertPair(SQL_REDEEM_CODE, codeHash);
  if (!pair) return oauthError(res, 400, 'invalid_grant', 'Authorization code was already used.');
  await q('UPDATE mcp_oauth_clients SET first_used_at = COALESCE(first_used_at, NOW()) WHERE client_id = $1', [client.client_id]);
  await enforceGrantCap(row.user_id);
  maybePrune();
  console.log(`[mcp-oauth] tokens issued to user ${row.user_id} (client ${client.client_name || client.client_id.slice(0, 16)})`);
  return sendJson(res, 200, tokenBody(pair.access, pair.refresh, row.scope));
}

async function grantFromRefresh(res, client, body) {
  const presented = body.refresh_token;
  if (!presented) return oauthError(res, 400, 'invalid_request', 'refresh_token is required.');
  if (!SHAPE.refresh.test(presented)) return oauthError(res, 400, 'invalid_grant', 'Refresh token is invalid.');
  const h = sha256(presented);

  for (let attempt = 0; attempt < 2; attempt++) {
    const found = await q(
      `SELECT *, (expires_at > NOW()) AS live,
              (revoked_at > NOW() - $2::int * INTERVAL '1 second') AS in_grace
         FROM mcp_oauth_tokens WHERE token_hash = $1 AND kind = 'refresh'`,
      [h, REFRESH_REUSE_GRACE_SEC],
    );
    const row = found.rows[0];
    if (!row || !row.live) return oauthError(res, 400, 'invalid_grant', 'Refresh token is invalid or expired.');
    if (row.client_id !== client.client_id) {
      await revokeFamily(row.family_id, 'refresh token presented by another client');
      return oauthError(res, 400, 'invalid_grant');
    }
    if (row.revoked_at && row.revoked_reason !== 'rotated') {
      return oauthError(res, 400, 'invalid_grant', 'This connection was revoked. Reconnect CB Edge.');
    }
    if (row.revoked_at && !row.in_grace) {
      // Rotated a while ago and presented again: two parties hold this token.
      await revokeFamily(row.family_id, 'rotated refresh token reused');
      return oauthError(res, 400, 'invalid_grant', 'Refresh token was already used.');
    }

    // Entitlement BEFORE anything rotates: a transient failure stays retryable.
    const ent = await checkEntitlement(row.user_id, { fresh: true });
    if (!ent.ok) {
      if (!ent.transient) await revokeFamily(row.family_id, 'membership inactive');
      return membershipError(res, ent);
    }

    const pair = row.revoked_at
      ? await insertPair(SQL_REISSUE, h, [REFRESH_REUSE_GRACE_SEC]) // lost-response retry
      : await insertPair(SQL_ROTATE, h);
    if (pair) {
      if (row.revoked_at) forgetFamily(row.family_id); // the superseded access token may be cached
      return sendJson(res, 200, tokenBody(pair.access, pair.refresh, row.scope));
    }
    // Lost a race with a concurrent refresh of the same token; re-read once.
  }
  return oauthError(res, 400, 'invalid_grant', 'Refresh token was already used.');
}

async function handleToken(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  const key = clientKey(req);
  if (authFailures.blocked(key)) return oauthError(res, 429, 'slow_down', undefined, { 'Retry-After': '60' });
  let body;
  try { body = await readParams(req); }
  catch { return oauthError(res, 400, 'invalid_request', 'Body too large.'); }

  const client = await authenticateClient(req, body);
  if (!client) {
    authFailures.hit(key);
    recordEvent('token_refused', {
      ip: key,
      detail: {
        error: 'invalid_client',
        client_id: typeof body.client_id === 'string' ? body.client_id.slice(0, 100) : null,
        basic_auth: /^Basic\s/i.test(String(req.headers.authorization || '')),
        grant_type: String(body.grant_type || '').slice(0, 40) || null,
      },
    });
    return oauthError(res, 401, 'invalid_client', 'Unknown client or bad client credentials.',
      { 'WWW-Authenticate': 'Basic realm="cbedge"' });
  }
  if (body.grant_type === 'authorization_code') await grantFromCode(res, client, body, publicOrigin(req));
  else if (body.grant_type === 'refresh_token') await grantFromRefresh(res, client, body);
  else oauthError(res, 400, 'unsupported_grant_type');
  const err = res._oauthError;
  if (err && err.error !== 'temporarily_unavailable') {
    recordEvent('token_refused', {
      clientId: client.client_id,
      ip: key,
      detail: { grant_type: String(body.grant_type || '').slice(0, 40) || null, error: err.error, description: err.description },
    });
  }
}

// RFC 7009. 200 whether or not the token existed.
async function handleRevoke(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  const key = clientKey(req);
  if (authFailures.blocked(key)) return oauthError(res, 429, 'slow_down', undefined, { 'Retry-After': '60' });
  let body;
  try { body = await readParams(req); } catch { return oauthError(res, 400, 'invalid_request'); }
  const client = await authenticateClient(req, body);
  if (!client) { authFailures.hit(key); return oauthError(res, 401, 'invalid_client'); }
  const tok = typeof body.token === 'string' ? body.token : '';
  if (SHAPE.access.test(tok) || SHAPE.refresh.test(tok)) {
    const r = await q('SELECT family_id, client_id FROM mcp_oauth_tokens WHERE token_hash = $1', [sha256(tok)]);
    const row = r.rows[0];
    if (row && row.client_id === client.client_id) await revokeFamily(row.family_id, 'revoked by client');
  }
  sendJson(res, 200, {});
}

// ── Resource-server side: bearer validation + entitlement ───────────────────

/**
 * Bearer → { userId, clientId, scope, resource, familyId } | null. Throws on DB
 * failure. Same short-cache idea as ws-auth.js: one DB read per token per 30s,
 * so a revocation lands within that window (revokeFamily clears it at once).
 * Misses are NOT cached — a stream of random tokens is the authFailures
 * limiter's job, and caching them would just grow the map.
 */
async function validateAccessToken(raw) {
  if (typeof raw !== 'string' || !SHAPE.access.test(raw)) return null;
  const h = sha256(raw);
  const hit = _tokenCache.get(h);
  if (hit && Date.now() - hit.at < TOKEN_CACHE_MS) return hit.value;
  const r = await q(
    `UPDATE mcp_oauth_tokens SET last_used_at = NOW()
      WHERE token_hash = $1 AND kind = 'access' AND revoked_at IS NULL AND expires_at > NOW()
      RETURNING user_id, client_id, scope, resource, family_id`,
    [h],
  );
  const row = r.rows[0];
  if (!row) { _tokenCache.delete(h); return null; }
  const value = { userId: row.user_id, clientId: row.client_id, scope: row.scope, resource: row.resource, familyId: row.family_id };
  boundedSet(_tokenCache, h, { at: Date.now(), value }, 5000);
  return value;
}

/**
 * Is this user still allowed in? The same decision ws-auth makes for the
 * dashboard (owner / subscribed / comped). One lookup in flight per user, so a
 * burst of tool calls costs one query. `{ fresh: true }` skips the cache — used
 * at token grant time, where a stale "yes" would mint a new token.
 */
async function checkEntitlement(userId, { fresh = false } = {}) {
  const hit = _entCache.get(userId);
  if (!fresh && hit && Date.now() - hit.at < ENT_CACHE_MS) return hit.value;
  if (!fresh && _entInFlight.has(userId)) return _entInFlight.get(userId);
  const p = (async () => {
    try {
      const a = await getAccessForUser(userId);
      const value = { ok: !!a.ok, reason: a.reason };
      boundedSet(_entCache, userId, { at: Date.now(), value }, 5000);
      return value;
    } catch {
      return { ok: false, transient: true, reason: 'verify-error' }; // never cached
    }
  })();
  if (!fresh) {
    _entInFlight.set(userId, p);
    p.finally(() => _entInFlight.delete(userId));
  }
  return p;
}

/** The 401 challenge the MCP spec requires: points the client at our metadata. */
function challengeHeader(origin, error) {
  const parts = [`resource_metadata="${prmUrl(origin)}"`, `scope="${SCOPE}"`];
  if (error) parts.push(`error="${error}"`);
  return `Bearer ${parts.join(', ')}`;
}

module.exports = {
  SCOPE,
  publicOrigin,
  resourceUrl,
  setCors,
  challengeHeader,
  clientKey,
  authFailures,
  validateAccessToken,
  checkEntitlement,
  handleAsMetadata,
  handlePrMetadata,
  handleRegister: jsonGuard(handleRegister),
  handleAuthorize: handleAuthorizeGuarded,
  handleToken: jsonGuard(handleToken),
  handleRevoke: jsonGuard(handleRevoke),
  recordToolCall,
  /** For server-v2/mcp-admin.js (the owner tracker) only. */
  admin: { query: q, revokeFamily, appOf },
  /** Selftest hooks only. */
  _test: {
    setQuery(fn) { _query = fn; ensured = null; },
    reset() {
      _tokenCache.clear(); _entCache.clear(); _entInFlight.clear(); _clientCache.clear();
      regPerIp.reset(); regGlobal.reset(); authFailures.reset(); eventLimit.reset();
    },
    redirectAllowed,
    csrfFor,
  },
};
