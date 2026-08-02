'use strict';
/**
 * server-v2/api-router.js — in-process replacement for app/api/* Next routes.
 *
 * WHY THIS EXISTS
 *   server-with-proxy.js is already a plain Node http server that handles
 *   /proxy/* and /ws itself and only delegates the *fallthrough* (pages + every
 *   app/api/* route) to an embedded Next handler. This module lets us move
 *   app/api/* handlers OUT of Next and into that same Node server, one route at
 *   a time, deleting each app/api/<route>/route.ts only after its in-process
 *   version is verified live. Until a route is registered here, it keeps being
 *   served by Next exactly as before — so this file is safe to ship inert.
 *
 * AUTH — READ THIS BEFORE ADDING A ROUTE
 *   Today app/api/* is gated by middleware.ts, which runs ONLY when a request
 *   reaches the Next handler. A route handled here returns BEFORE that
 *   fallthrough, so middleware never runs for it. Therefore every route MUST
 *   declare an `auth` level and this router enforces it via the SAME session
 *   check middleware/proxy-auth use (ws-auth.verifyWsRequest). Levels:
 *     'public'     — no session required (mirror a middleware PUBLIC_PATTERN)
 *     'subscriber' — active/trialing subscriber OR owner (the paywall)
 *     'owner'      — owner only (OWNER_USER_ID)
 *   Omitting `auth` is a hard error — we never default-open a paywalled route.
 *
 * MOUNTING (done later, in server-with-proxy.js, guarded by a kill-switch):
 *   const { handleApiRoute } = require('./api-router');
 *   // ...inside createServer callback, immediately BEFORE `handle(req, res)`:
 *   if (process.env.API_ROUTER === '1' &&
 *       await handleApiRoute(req, res, apiCtx)) return;
 *   handle(req, res);
 *   // apiCtx injects the server's own helpers (see REQUIRED CTX below) so this
 *   // module stays decoupled from the 161KB entrypoint and independently testable.
 *
 * REQUIRED CTX (injected at mount time):
 *   ctx.sendJson(res, code, obj, req?, opts?)  — server's JSON responder
 *   ctx.verifyWsRequest(req)                   — from ./ws-auth
 *   ctx.ownerUserId                            — (process.env.OWNER_USER_ID||'').trim()
 *   ctx.port                                   — server PORT (for internal /proxy hops)
 *   ctx.internalToken                          — process.env.INTERNAL_API_TOKEN
 *   ctx.internalFetch(pathname, init?)         — fetch against http://127.0.0.1:PORT
 *                                                with x-internal-token attached
 */

// ---------------------------------------------------------------------------
// Bundled DB layer (lib/db.ts → server-v2/_lib-db.cjs, esbuild --format=cjs).
// lib/db.ts imports only `pg`, so it bundles to a self-contained CommonJS file
// server-v2 can require directly — reusing every query verbatim (no rewrites,
// no drift). Loaded DEFENSIVELY: if the bundle is absent (local dev, or a build
// that didn't produce it) libDb stays null, the DB routes below are simply not
// registered, and they FALL THROUGH to Next unchanged. A missing bundle can
// never crash boot. Regenerate after editing lib/db.ts:
//   esbuild lib/db.ts --bundle --platform=node --format=cjs --external:pg \
//     --outfile=server-v2/_lib-db.cjs
const fs = require('fs');
const nodePath = require('path');
const nodeCrypto = require('crypto');

let libDb = null;
try { libDb = require('./_lib-db.cjs'); }
catch (e) { console.warn('[api-router] _lib-db.cjs not loaded — DB routes stay on Next:', e.message); }

// Additional pure (Next-free) compute libs, bundled the same way:
//   esbuild lib/confidenceScore.ts --bundle --platform=node --format=cjs --outfile=server-v2/_lib-confidence.cjs
//   esbuild lib/ibDaily.ts        --bundle --platform=node --format=cjs --outfile=server-v2/_lib-ibdaily.cjs
// Each loaded defensively; routes needing them only register when present.
let libConf = null;
try { libConf = require('./_lib-confidence.cjs'); }
catch (e) { console.warn('[api-router] _lib-confidence.cjs not loaded:', e.message); }
let libIb = null;
try { libIb = require('./_lib-ibdaily.cjs'); }
catch (e) { console.warn('[api-router] _lib-ibdaily.cjs not loaded:', e.message); }
// Full confidence model, extracted to a bundleable module (lib/confidence-compute.ts):
//   esbuild lib/confidence-compute.ts --bundle --platform=node --format=cjs --external:pg --outfile=server-v2/_lib-confidence-route.cjs
let libConfRoute = null;
try { libConfRoute = require('./_lib-confidence-route.cjs'); }
catch (e) { console.warn('[api-router] _lib-confidence-route.cjs not loaded:', e.message); }
// CB contract trade tracker — probes the CB-strike 0DTE contract on TastyTrade
// at 9:45/10:30/12:00, walks toward the money to the first strike over $1.00,
// then auto-sells inside the 5-10 pt band of the CB. Plain server-v2 module
// (no esbuild step); it owns its own tables via libDb.getPool(). Loaded
// defensively: without it the /api/cb-trades route below is simply never
// registered and nothing else in this file changes behaviour.
let cbTrack = null;
try { cbTrack = require('./cb-contract-track'); }
catch (e) { console.warn('[api-router] cb-contract-track not loaded — contract tracking off:', e.message); }
// Pure broker-CSV parser/matcher (lib/journal/csv.ts — zero imports):
//   esbuild lib/journal/csv.ts --bundle --platform=node --format=cjs --outfile=server-v2/_lib-journal-csv.cjs
let libJournalCsv = null;
try { libJournalCsv = require('./_lib-journal-csv.cjs'); }
catch (e) { console.warn('[api-router] _lib-journal-csv.cjs not loaded:', e.message); }
// TPO k-NN forecaster, extracted to lib/tpo-forecast-compute.ts (pulls lib/tpo +
// balanceImbalance + valueArea; useEsCandles is type-only → erased):
//   esbuild lib/tpo-forecast-compute.ts --bundle --platform=node --format=cjs --external:pg --outfile=server-v2/_lib-tpo-forecast.cjs
let libTpoForecast = null;
try { libTpoForecast = require('./_lib-tpo-forecast.cjs'); }
catch (e) { console.warn('[api-router] _lib-tpo-forecast.cjs not loaded:', e.message); }
// Order-book tenor-split read, extracted to lib/obook-compute.ts (self-contained;
// forwardGet replaced with a direct /proxy fetch): esbuild → server-v2/_lib-obook.cjs
let libObook = null;
try { libObook = require('./_lib-obook.cjs'); }
catch (e) { console.warn('[api-router] _lib-obook.cjs not loaded:', e.message); }
// ICT concept detectors (analyzeICT), pure lib/calculations/ictConcepts.ts (no
// imports): esbuild lib/calculations/ictConcepts.ts --bundle --platform=node \
//   --format=cjs --outfile=server-v2/_lib-ict.cjs
let libIct = null;
try { libIct = require('./_lib-ict.cjs'); }
catch (e) { console.warn('[api-router] _lib-ict.cjs not loaded — ict-setups stays on Next:', e.message); }
// Referrer / UTM / user-agent parsing for the visit log (lib/visitorAttribution.ts —
// pure, zero imports):
//   esbuild lib/visitorAttribution.ts --bundle --platform=node --format=cjs --outfile=server-v2/_lib-attribution.cjs
// Optional by design: if it fails to load, /api/page-status still logs every
// visit, just with null acquisition columns. Visit logging never depends on it.
let libAttribution = null;
try { libAttribution = require('./_lib-attribution.cjs'); }
catch (e) { console.warn('[api-router] _lib-attribution.cjs not loaded — visits log without referrer/UTM:', e.message); }
// server-v2 levels-engine (CommonJS, already on disk) — required directly for
// the em-tracker routes' evaluate/commit paths.
let levelsEngine = null;
try { levelsEngine = require('./levels-engine.js'); }
catch (e) { console.warn('[api-router] levels-engine.js not loaded:', e.message); }

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function enforceAuth(level, req, ctx, identify = false) {
  // Internal server-to-server bypass — mirrors middleware.ts (hasInternalToken →
  // next()) and proxy-auth. Cron/internal callers carry the shared secret and
  // must reach every /api/* route without a user session, exactly as before.
  const tok = req.headers['x-internal-token'];
  if (tok && ctx.internalToken && tok === ctx.internalToken) {
    return { ok: true, who: 'internal' };
  }
  if (level === 'public') {
    // "Public" means never REJECTED — it does not have to mean never IDENTIFIED.
    // Routes that opt in with `identify: true` still get access.userId when the
    // caller has a session. This is why the page-load beacon logged user_id as
    // NULL for everyone, owner included: the beacon is public, so this branch
    // returned before any session lookup and the visit row had nobody attached.
    // Opt-in rather than always-on because every other public route is a hot
    // read path that would otherwise pay for a session query it never uses.
    // Guests carry no cbe_session cookie, so verifyWsRequest returns before
    // touching the DB — only signed-in requests cost a lookup. userId is
    // populated even when access is DENIED (unpaid session → ok:false with a
    // userId), so unpaid members get attributed too.
    if (!identify) return { ok: true };
    let access = null;
    try { access = await ctx.verifyWsRequest(req); } catch { /* treat as guest */ }
    return { ok: true, userId: access?.userId ?? null };
  }
  let access;
  try {
    access = await ctx.verifyWsRequest(req); // { ok, userId?, reason }
  } catch {
    return { ok: false, code: 401, reason: 'verify-error' };
  }
  // 'user' = any valid session (paid OR unpaid). verifyWsRequest returns a userId
  // for a valid session even when it's unpaid (ok:false, reason 'inactive'); only
  // a missing/invalid cookie yields no userId. Mirrors middleware PAID_EXEMPT.
  if (level === 'user') {
    if (!access.userId) return { ok: false, code: 401, reason: access.reason || 'no-session' };
    return { ok: true, userId: access.userId };
  }
  if (!access.ok) return { ok: false, code: 401, reason: access.reason || 'unauthorized' };
  if (level === 'owner') {
    if (!ctx.ownerUserId || access.userId !== ctx.ownerUserId) {
      return { ok: false, code: 403, reason: 'owner-only' };
    }
  }
  // 'subscriber' — verifyWsRequest already required active/trialing or owner.
  return { ok: true, userId: access.userId };
}

// ---------------------------------------------------------------------------
// Route registry — add one entry per ported app/api/* route.
// Key = exact pathname. Value = { auth, methods?, handler }.
// handler(req, res, ctx, access) — must send a response; return value ignored.
// ---------------------------------------------------------------------------

const ROUTES = new Map();

function register(pathname, def) {
  if (!def || !def.auth || !def.handler) {
    throw new Error(`api-router: route ${pathname} needs { auth, handler }`);
  }
  ROUTES.set(pathname, def);
}

// Dynamic-segment routes (e.g. /api/snapshots/[id]). The dispatcher tries exact
// ROUTES first, then these patterns; a match injects ctx.params.<key>. Patterns
// use ':key' for a single path segment. Kept separate so the common exact-match
// path stays a plain Map.get and never scans regexes.
const DYNAMIC_ROUTES = [];
function registerDynamic(pattern, def) {
  if (!def || !def.auth || !def.handler) {
    throw new Error(`api-router: dynamic route ${pattern} needs { auth, handler }`);
  }
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => {
    keys.push(m.slice(1));
    return '([^/]+)';
  }) + '$');
  DYNAMIC_ROUTES.push({ rx, keys, def });
}
function matchDynamic(pathname) {
  for (const { rx, keys, def } of DYNAMIC_ROUTES) {
    const m = rx.exec(pathname);
    if (m) {
      const params = {};
      keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { def, params };
    }
  }
  return null;
}

// Minimal responder — mirrors what the old NextResponse.json routes emitted
// (Content-Type: application/json + whatever Cache-Control the route set). It
// intentionally does NOT add CORS (the Next /api/* routes didn't either; these
// are same-origin). Security headers were already applied on `res` upstream in
// server-with-proxy.js, and setHeader here preserves them.
function send(res, status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.statusCode = status;
  res.end(text);
}
// Read + JSON-parse a request body (bounded). Mirrors `await req.json()` in the
// old Next POST handlers. Rejects on oversize / invalid JSON.
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

// POST write-gate for cron-facing routes — mirrors the per-route tokenOk() in
// the Next handlers: the shared INTERNAL_API_TOKEN header. No token configured
// (dev) → allow. Used for routes whose GET is subscriber but POST is cron-only.
function tokenOk(req, ctx) {
  const expected = ctx.internalToken;
  if (!expected) return true;
  return req.headers['x-internal-token'] === expected;
}

// Faithful port of lib/proxyForward.ts forwardGet(): in-process GET to a
// /proxy/* path (internal token attached by ctx.internalFetch), JSON-parse the
// body (non-JSON → { raw }), re-emit with no-store; fetch failure → 502.
async function forwardGet(ctx, proxyPath) {
  try {
    const r = await ctx.internalFetch(proxyPath, { cache: 'no-store' });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: r.status, body };
  } catch (err) {
    return { status: 502, body: { error: String(err?.message || err) } };
  }
}

// Cache-Control presets, matching lib/cacheHeaders.ts exactly.
const CACHE_30 = 'public, max-age=30';                                   // quotes/gex/chains TTL
const NO_STORE = 'no-store, no-cache, must-revalidate, max-age=0';

// ET date helpers — mirror the per-route helpers in the original Next routes.
function etDateStr(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((x) => x.type !== 'literal')
    .reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}`;
}
function todayET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString().slice(0, 10);
}
function mondayOf(ds) {
  const d = new Date(`${ds}T12:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}
function etHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', hour12: false,
  }).format(d));
}
// Client IP from proxy headers (Cloudflare / VPS). Node lowercases header keys.
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) { const first = String(xff).split(',')[0]?.trim(); if (first) return first; }
  return req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || null;
}

// Visitor geo from Cloudflare's "Add visitor location headers" managed
// transform (Rules → Transform Rules → Managed Transforms). Mirrors
// app/api/page-status/route.ts's clientGeo() — that Next route handler is
// bypassed in production (API_ROUTER=1 routes /api/page-status through this
// file instead), so this in-process copy is what actually needs the geo read.
// Everything here stays null until the transform is on, and for anything that
// never crossed the Cloudflare edge (local dev, health checks) — best-effort.
function clientGeoTrim(v, max) {
  if (!v) return null;
  const s = String(v).trim().slice(0, max);
  return s.length ? s : null;
}
function clientGeoFloat(v) {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clientGeo(req) {
  const country = clientGeoTrim(req.headers['cf-ipcountry'], 2);
  return {
    country: country ? country.toUpperCase() : null,
    region: clientGeoTrim(req.headers['cf-region'], 80),
    city: clientGeoTrim(req.headers['cf-ipcity'], 80),
    lat: clientGeoFloat(req.headers['cf-iplatitude']),
    lon: clientGeoFloat(req.headers['cf-iplongitude']),
  };
}

// Acquisition + device for a /api/page-status beacon.
//
// The referrer and query string come from the BODY (document.referrer and
// window.location.search, sent by lib/pageStatus.ts) — never from
// req.headers.referer, which on a beacon points at the page that fired it and
// would attribute every visit to ourselves.
//
// Only the first beacon of a browser session carries attribution (body.isEntry);
// every other row gets nulls. Device info comes from the User-Agent header and
// is filled on every row. See lib/visitorAttribution.ts for the reasoning.
const EMPTY_ATTRIBUTION = {
  is_entry: false, referrer: null, referrer_host: null,
  utm_source: null, utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null,
  channel: null, browser: null, os: null, device_type: null, is_bot: false,
};
function visitAttribution(req, body) {
  if (!libAttribution) return { ...EMPTY_ATTRIBUTION };
  try {
    const isEntry = Boolean(body && (body.isEntry ?? body.is_entry));
    // Treat the host this request arrived on as "us" too, so previews, staging
    // hostnames and the bare IP don't show up as external referrers.
    const selfHosts = new Set(libAttribution.SELF_HOSTS);
    const host = String(req.headers['host'] || '').split(':')[0].toLowerCase().replace(/^www\./, '');
    if (host) selfHosts.add(host);

    const a = libAttribution.buildAttribution({
      referrer: isEntry ? body?.referrer : null,
      query: isEntry ? body?.query : null,
      userAgent: req.headers['user-agent'],
      selfHosts,
    });
    return {
      is_entry: isEntry,
      referrer: a.referrer,
      referrer_host: a.referrerHost,
      utm_source: a.utmSource,
      utm_medium: a.utmMedium,
      utm_campaign: a.utmCampaign,
      utm_term: a.utmTerm,
      utm_content: a.utmContent,
      // Channel is only meaningful for an arrival; a mid-session row would
      // always read "direct" and drag every report toward it.
      channel: isEntry ? a.channel : null,
      browser: a.browser,
      os: a.os,
      device_type: a.deviceType,
      is_bot: a.isBot,
    };
  } catch {
    // A malformed referrer must never cost us the visit row.
    return { ...EMPTY_ATTRIBUTION };
  }
}

// ── PROOF-OF-PATTERN: /api/insights/gex ──────────────────────────────────────
// Ports app/api/insights/gex/route.ts verbatim in behavior: forward to the
// in-process /proxy/gex, reshape to the Exposure-tab payload. Subscriber-gated
// (its data source /proxy/gex is subscriber-gated; middleware paywalled it too).
// Still does the internal /proxy hop for a zero-behavior-change first cut; the
// hop can be dropped later by calling the builder directly. Next is out of THIS
// route's path once registered + its route.ts deleted.
register('/api/insights/gex', {
  auth: 'subscriber',
  methods: ['GET'],
  async handler(req, res, ctx) {
    try {
      const r = await ctx.internalFetch('/proxy/gex', { cache: 'no-store' });
      if (!r.ok) return ctx.sendJson(res, r.status, { error: `proxy ${r.status}` }, req);
      const p = await r.json();
      const totals = p?.totals ?? null;
      const callGexB = totals ? Number(totals.totalGEX ?? 0) / 1e9 : null;
      const data = {
        spot: p?.spot ?? null,
        totals,
        updatedAt: p?.updatedAt ?? Date.now(),
        net_gex_billions: totals ? Number(totals.totalGEX ?? 0) / 1e9 : null,
        net_gex_oivol_billions: totals ? Number(totals.totalGEXOiVol ?? totals.totalGEX ?? 0) / 1e9 : null,
        call_gex_billions: callGexB,
        put_gex_billions: null,
        call_wall_spx: p?.callWall ?? null,
        put_wall_spx: p?.putWall ?? null,
        gamma_flip_spx: p?.gexFlip ?? null,
        spx_spot: p?.spot ?? null,
      };
      ctx.sendJson(res, 200, { data }, req, {
        cacheControl: 'no-store, no-cache, must-revalidate, max-age=0',
      });
    } catch (err) {
      ctx.sendJson(res, 502, { error: String(err?.message || err) }, req);
    }
  },
});

// ── THIN /proxy forwarders (batch 1) ─────────────────────────────────────────
// Each mirrors its app/api/*/route.ts 1:1 — same proxy path, same reshape, same
// Cache-Control, subscriber-gated (none are in middleware's PAID_EXEMPT list).
// Pass-through routes forward the proxy's raw body + status unchanged.

// /api/chains?ticker=SPX&expiration=YYYY-MM-DD → /proxy/api/tt/chains/:ticker
register('/api/chains', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res, ctx) {
    const sp = new URL(req.url || '/', 'http://localhost').searchParams;
    const ticker = (sp.get('ticker') || 'SPX').trim();
    sp.delete('ticker');
    const qs = sp.toString();
    const r = await ctx.internalFetch(
      `/proxy/api/tt/chains/${encodeURIComponent(ticker)}${qs ? `?${qs}` : ''}`,
      { cache: 'no-store' }
    );
    send(res, r.status, await r.text(), { 'Cache-Control': CACHE_30 });
  },
});

// /api/expirations?ticker=SPX → /proxy/api/tt/expirations/:ticker
register('/api/expirations', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res, ctx) {
    const ticker = (new URL(req.url || '/', 'http://localhost').searchParams.get('ticker') || 'SPX').trim();
    const r = await ctx.internalFetch(
      `/proxy/api/tt/expirations/${encodeURIComponent(ticker)}`, { cache: 'no-store' });
    send(res, r.status, await r.text(), { 'Cache-Control': CACHE_30 });
  },
});

// /api/tt-quotes?symbols=A,B,C → /proxy/quotes?symbols=
register('/api/tt-quotes', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res, ctx) {
    const symbols = (new URL(req.url || '/', 'http://localhost').searchParams.get('symbols') || '').trim();
    const r = await ctx.internalFetch(
      `/proxy/quotes?symbols=${encodeURIComponent(symbols)}`, { cache: 'no-store' });
    send(res, r.status, await r.text(), { 'Cache-Control': CACHE_30 });
  },
});

// /api/mult-greek-gex-grid?... -> /proxy/mult-greek-gex-grid (pass-through, no-store)
register('/api/mult-greek-gex-grid', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res, ctx) {
    const qs = new URL(req.url || '/', 'http://localhost').searchParams.toString();
    const r = await ctx.internalFetch(
      `/proxy/mult-greek-gex-grid${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
    send(res, r.status, await r.text(), { 'Cache-Control': NO_STORE });
  },
});

// /api/mult-greek-gex-change?... → /proxy/mult-greek-gex-change (pass-through, no-store)
register('/api/mult-greek-gex-change', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res, ctx) {
    const qs = new URL(req.url || '/', 'http://localhost').searchParams.toString();
    const r = await ctx.internalFetch(
      `/proxy/mult-greek-gex-change${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
    send(res, r.status, await r.text(), { 'Cache-Control': NO_STORE });
  },
});

// /api/gex/expirations → /proxy/expirations, reshaped to { expiry, expirations }
register('/api/gex/expirations', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res, ctx) {
    try {
      const r = await ctx.internalFetch('/proxy/expirations', { cache: 'no-store' });
      if (!r.ok) return send(res, 502, { error: `proxy returned ${r.status}`, expirations: [] });
      const v2 = await r.json();
      send(res, 200, {
        expiry: v2.expiry ?? null,
        expirations: Array.isArray(v2.expirations) ? v2.expirations : [],
      });
    } catch (err) {
      send(res, 502, { error: String(err?.message || err), expirations: [] });
    }
  },
});

// /api/calendar-quote — quote of the day, sourced from a Google Sheet.
//
// The sheet has a date column and a quote column (order auto-detected); the tab
// is taken from CALENDAR_QUOTE_SHEET_RANGE ("Quote!A:B" → tab "Quote"). Read via
// the gviz CSV export, so it needs no service account — the sheet just has to be
// link-shared as "anyone with the link can view".
//
//   CALENDAR_QUOTE_SHEET_ID      spreadsheet id from the sheet URL
//   CALENDAR_QUOTE_SHEET_RANGE   optional, defaults to "Sheet1!A:B"
//
// Falls back to the built-in list below when unconfigured or unreachable.
const CAL_QUOTES = [
  "The market can stay irrational longer than you can stay solvent. — John Maynard Keynes",
  "Risk comes from not knowing what you're doing. — Warren Buffett",
  "In investing, what is comfortable is rarely profitable. — Robert Arnott",
  "The four most dangerous words in investing are: this time it's different. — John Templeton",
  "Be fearful when others are greedy and greedy when others are fearful. — Warren Buffett",
  "The trend is your friend until the end when it bends. — Ed Seykota",
  "Markets are never wrong, opinions often are. — Jesse Livermore",
  "It's not whether you're right or wrong, but how much you make when right and lose when wrong. — Stanley Druckenmiller",
  "The goal of a successful trader is to make the best trades. Money is secondary. — Alexander Elder",
  "Amateurs think about how much money they can make. Professionals think about how much they could lose. — Jack Schwager",
  "Do not anticipate and move without market confirmation — being a little late is your insurance. — Richard Wyckoff",
  "Plan the trade and trade the plan. — Trading maxim",
  "Cut your losses short and let your winners run. — David Ricardo",
  "The stock market is a device for transferring money from the impatient to the patient. — Warren Buffett",
  "Patience is the key. Wait for the trade to come to you. — Linda Raschke",
  "Every battle is won before it is fought. — Sun Tzu",
  "Losses are part of the game. The market doesn't owe you anything. — Trading maxim",
  "Know what you own, and know why you own it. — Peter Lynch",
  "The elements of good trading are: cutting losses, cutting losses, and cutting losses. — Ed Seykota",
  "Bulls make money, bears make money, pigs get slaughtered. — Wall Street adage",
  "Time in the market beats timing the market. — Investing adage",
  "The market is a pendulum that forever swings between unsustainable optimism and unjustified pessimism. — Benjamin Graham",
  "Don't fight the tape. — Wall Street adage",
  "Discipline is the bridge between goals and accomplishment. — Jim Rohn",
  "An investment in knowledge pays the best interest. — Benjamin Franklin",
];

const CAL_SHEET_ID = String(process.env.CALENDAR_QUOTE_SHEET_ID || '').trim();
const CAL_SHEET_TAB = String(process.env.CALENDAR_QUOTE_SHEET_RANGE || 'Sheet1!A:B')
  .split('!')[0].trim() || 'Sheet1';
const CAL_TTL_MS = 5 * 60_000;
// How stale a dated row may be and still show (covers weekends + holidays).
const CAL_MAX_STALE_DAYS = 3;

let _calCache = null;      // { at, rows }
let _calLastError = null;

/** Minimal RFC4180 CSV parser — handles quoted fields, commas, escaped quotes. */
function calParseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const calPad = (n) => String(n).padStart(2, '0');

/** Tolerant date parse → "YYYY-MM-DD", or null when the cell isn't a date. */
function calDateKey(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${calPad(m[2])}-${calPad(m[3])}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);          // US M/D/Y
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${calPad(m[1])}-${calPad(m[2])}`;
  }
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {                               // Sheets serial
    const n = Number(s);
    if (n > 20_000 && n < 80_000) {
      return new Date(Math.round((n - 25_569) * 86_400_000)).toISOString().slice(0, 10);
    }
  }
  const p = Date.parse(`${s} 00:00:00 GMT`);                       // "Jul 31, 2026"
  if (Number.isFinite(p)) return new Date(p).toISOString().slice(0, 10);
  return null;
}

const CAL_HEADER_WORDS = /^(date|day|when|quote|quotes|text|saying|message|author|by|note)\b/i;

/**
 * The panel wraps the text in curly quotes already, so strip quote marks the
 * sheet carries:  "Saying." — Author  →  Saying. — Author
 */
function calNormalizeQuote(raw) {
  let s = String(raw == null ? '' : raw).trim();
  const m = /^["“]([\s\S]+?)["”]\s*([—–-]\s*[\s\S]+)$/.exec(s);
  if (m) return `${m[1].trim()} ${m[2].trim()}`;
  if (/^["“][\s\S]*["”]$/.test(s)) s = s.slice(1, -1).trim();
  return s;
}

/** Fetch + normalise the sheet rows. Never throws; [] means "use fallback". */
async function calFetchRows(force) {
  if (!CAL_SHEET_ID) return [];
  if (!force && _calCache && Date.now() - _calCache.at < CAL_TTL_MS) return _calCache.rows;

  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(CAL_SHEET_ID)}`
    + `/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(CAL_SHEET_TAB)}`;

  let values;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const r = await fetch(url, { signal: ac.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (/^\s*</.test(text)) throw new Error('got HTML — sheet not link-shared?');
    values = calParseCsv(text);
  } catch (err) {
    _calLastError = String((err && err.message) || err);
    console.warn('[calendar-quote] sheet fetch failed:', _calLastError);
    return _calCache ? _calCache.rows : [];      // serve stale rather than nothing
  }
  _calLastError = null;

  // Which column holds the dates? Sample the first 20 rows.
  let hitsA = 0, hitsB = 0;
  for (const r of values.slice(0, 20)) {
    if (calDateKey(r && r[0])) hitsA++;
    if (calDateKey(r && r[1])) hitsB++;
  }
  const dateCol = hitsB > hitsA ? 1 : 0;
  const quoteCol = dateCol === 0 ? 1 : 0;

  const rows = [];
  values.forEach((r, i) => {
    const date = calDateKey(r && r[dateCol]);
    const rawQuote = String((r && r[quoteCol]) || '').trim();
    if (!rawQuote) return;
    if (i === 0 && !date) {                       // header row
      const d = String((r && r[dateCol]) || '').trim();
      const headerish = (s) => s.length > 0 && s.length <= 30 && CAL_HEADER_WORDS.test(s);
      if (headerish(d) || headerish(rawQuote)) return;
    }
    const quote = calNormalizeQuote(rawQuote);
    if (quote) rows.push({ date, quote });
  });

  _calCache = { at: Date.now(), rows };
  return rows;
}

const calDayNum = (key) => Math.floor(Date.parse(`${key}T00:00:00Z`) / 86_400_000);
function calPickForDay(list, key) {
  const n = calDayNum(key);
  return list[((n % list.length) + list.length) % list.length];
}

function calResolve(rows, today) {
  const exact = rows.find((r) => r.date === today);
  if (exact) return { quote: exact.quote, source: 'sheet:date', matchedDate: exact.date };

  const todayNum = calDayNum(today);
  const past = rows.filter((r) => r.date && calDayNum(r.date) <= todayNum)
    .sort((a, b) => calDayNum(b.date) - calDayNum(a.date));
  if (past.length && todayNum - calDayNum(past[0].date) <= CAL_MAX_STALE_DAYS) {
    return { quote: past[0].quote, source: 'sheet:recent', matchedDate: past[0].date };
  }

  const undated = rows.filter((r) => !r.date);
  if (undated.length) {
    return { quote: calPickForDay(undated, today).quote, source: 'sheet:undated', matchedDate: null };
  }
  if (rows.length) {
    return { quote: calPickForDay(rows, today).quote, source: 'sheet:rotate', matchedDate: null };
  }
  return { quote: calPickForDay(CAL_QUOTES, today), source: 'fallback', matchedDate: null };
}

register('/api/calendar-quote', {
  auth: 'subscriber', methods: ['GET', 'POST'],
  async handler(req, res) {
    let debug = false, force = false;
    try {
      const q = new URL(req.url, 'http://localhost').searchParams;
      debug = q.get('debug') === '1';
      force = q.get('refresh') === '1';
    } catch { /* ignore */ }
    if (force) _calCache = null;

    const today = etDateStr();
    const rows = await calFetchRows(force);
    const r = calResolve(rows, today);

    if (debug) {
      send(res, 200, {
        quote: r.quote,
        source: r.source,
        today,
        matchedDate: r.matchedDate,
        sheetId: CAL_SHEET_ID ? `${CAL_SHEET_ID.slice(0, 6)}…` : null,
        tab: CAL_SHEET_TAB,
        configured: Boolean(CAL_SHEET_ID),
        rowCount: rows.length,
        datedRows: rows.filter((x) => x.date).length,
        firstDate: (rows.find((x) => x.date) || {}).date || null,
        lastDate: (rows.slice().reverse().find((x) => x.date) || {}).date || null,
        lastError: _calLastError,
        sample: rows.slice(0, 3),
      }, { 'Cache-Control': NO_STORE });
      return;
    }
    send(res, 200, { quote: r.quote }, { 'Cache-Control': NO_STORE });
  },
});

// /api/flow — legacy static empty flow payload (unchanged behavior).
register('/api/flow', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res) {
    send(res, 200, {
      timestamp: Date.now(), entries: [],
      summary: { totalCallPremium: 0, totalPutPremium: 0, ratio: 1, dominantSide: 'neutral' },
    });
  },
});

// ── Self-contained routes (no libDb): external-API fetches + /proxy compute ──

// /api/semi-strength — Semiconductor Strength Index (from /proxy/semi-quotes).
register('/api/semi-strength', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res, ctx) {
    const SEMIS = [
      { sym: 'NVDA', weight: 20.70 }, { sym: 'TSM', weight: 9.09 }, { sym: 'AVGO', weight: 6.12 },
      { sym: 'AMD', weight: 5.71 }, { sym: 'AMAT', weight: 5.12 }, { sym: 'ASML', weight: 5.11 },
      { sym: 'MU', weight: 4.95 }, { sym: 'TXN', weight: 4.69 }, { sym: 'KLAC', weight: 4.62 }, { sym: 'LRCX', weight: 4.58 },
    ];
    const BENCH = ['SMH', 'SOXL', 'SPY', 'QQQ'];
    const SCALE = 1.5;
    const toSSI = (c) => Math.round((50 + 50 * Math.tanh(c / SCALE)) * 10) / 10;
    const ssiLabel = (ssi) => ssi >= 70 ? 'STRONG' : ssi >= 57 ? 'FIRM' : ssi > 43 ? 'NEUTRAL' : ssi > 30 ? 'SOFT' : 'WEAK';
    const r2 = (n) => Math.round(n * 100) / 100;
    const getJson = async (path) => { try { const r = await ctx.internalFetch(path); return r.ok ? await r.json() : null; } catch { return null; } };
    const symbols = [...SEMIS.map((s) => s.sym), ...BENCH].join(',');
    const q = await getJson(`/proxy/semi-quotes?symbols=${encodeURIComponent(symbols)}`);
    const quotes = q?.data?.items ?? [];
    const qBy = new Map(quotes.map((x) => [String(x.symbol).toUpperCase(), x]));
    const priceOf = (sym) => { const x = qBy.get(sym); if (!x) return null; if (x.last && x.last > 0) return x.last; if (x.mark && x.mark > 0) return x.mark; return null; };
    const posOr = (v) => (v && v > 0 ? v : null);
    const merge = (sym, weight) => ({ sym, weight, price: priceOf(sym), prevClose: posOr(qBy.get(sym)?.prevClose), open: posOr(qBy.get(sym)?.open) });
    const semiRows = SEMIS.map((s) => merge(s.sym, s.weight));
    const benchRows = new Map(BENCH.map((b) => [b, merge(b, 0)]));
    const baseVal = (m, basis) => (basis === 'prevClose' ? m.prevClose : m.open);
    const pct = (m, basis) => { const b = baseVal(m, basis); return m.price != null && b != null ? ((m.price - b) / b) * 100 : null; };
    function buildView(basis) {
      const rows = semiRows.map((m) => { const p = pct(m, basis); return { symbol: m.sym, weight: m.weight, price: m.price, baseline: baseVal(m, basis), pct: p, up: p == null ? null : p > 0 }; });
      const valid = rows.filter((r) => r.pct != null);
      const wSum = valid.reduce((a, r) => a + r.weight, 0);
      const compositePct = wSum > 0 ? valid.reduce((a, r) => a + (r.weight / wSum) * r.pct, 0) : 0;
      const names = rows.map((r) => ({ ...r, pct: r.pct == null ? null : r2(r.pct), contribution: r.pct == null || wSum <= 0 ? null : r2((r.weight / wSum) * r.pct) })).sort((a, b) => (b.contribution ?? -Infinity) - (a.contribution ?? -Infinity));
      const ssi = toSSI(compositePct);
      const breadthTotal = valid.length;
      const breadthUp = valid.filter((r) => r.pct > 0).length;
      const breadthPct = breadthTotal > 0 ? Math.round((breadthUp / breadthTotal) * 100) : null;
      const smhPct = pct(benchRows.get('SMH'), basis), soxlPct = pct(benchRows.get('SOXL'), basis), spyPct = pct(benchRows.get('SPY'), basis), qqqPct = pct(benchRows.get('QQQ'), basis);
      const rsSpx = smhPct != null && spyPct != null ? r2(smhPct - spyPct) : null;
      const rsNq = smhPct != null && qqqPct != null ? r2(smhPct - qqqPct) : null;
      let soxlConfirm = null;
      if (smhPct != null && soxlPct != null) { const expected = r2(smhPct * 3); const ratio = Math.abs(expected) > 0.05 ? r2(soxlPct / expected) : null; const status = ratio == null ? 'flat' : ratio >= 0.9 ? 'confirming' : ratio >= 0.6 ? 'soft' : 'lagging'; soxlConfirm = { expected, actual: r2(soxlPct), ratio, status }; }
      const divergence = compositePct > 0.1 && breadthPct != null && breadthPct < 50 ? 'narrow-up' : compositePct < -0.1 && breadthPct != null && breadthPct > 50 ? 'narrow-down' : 'aligned';
      return { available: breadthTotal > 0, ssi, ssiLabel: ssiLabel(ssi), compositePct: r2(compositePct), breadthUp, breadthTotal, breadthPct, divergence, smhPct: smhPct == null ? null : r2(smhPct), soxlPct: soxlPct == null ? null : r2(soxlPct), spyPct: spyPct == null ? null : r2(spyPct), qqqPct: qqqPct == null ? null : r2(qqqPct), rsSpx, rsNq, soxlConfirm, names };
    }
    const rthOpen = buildView('open');
    const rthOpenAvailable = benchRows.get('SMH').open != null && rthOpen.breadthTotal > 0;
    send(res, 200, { source: 'thetadata', updatedAt: new Date().toISOString(), rthOpenAvailable, prevClose: buildView('prevClose'), rthOpen }, { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' });
  },
});

// /api/weather — ZIP → open-meteo (subscriber).
const WMO = {
  0:"Clear",1:"Mainly Clear",2:"Partly Cloudy",3:"Overcast",
  45:"Fog",48:"Rime Fog",51:"Light Drizzle",53:"Drizzle",55:"Heavy Drizzle",
  61:"Light Rain",63:"Rain",65:"Heavy Rain",66:"Freezing Rain",67:"Freezing Rain",
  71:"Light Snow",73:"Snow",75:"Heavy Snow",77:"Snow Grains",
  80:"Rain Showers",81:"Rain Showers",82:"Violent Showers",
  85:"Snow Showers",86:"Snow Showers",95:"Thunderstorm",96:"Thunderstorm",99:"Thunderstorm",
};
register('/api/weather', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res) {
    const sp = new URL(req.url || '/', 'http://localhost').searchParams;
    const zip = (sp.get('zip') || '').trim();
    if (!/^\d{5}$/.test(zip)) return send(res, 400, { error: 'Valid 5-digit US ZIP required' });
    try {
      let loc = null;
      try {
        const g = await fetch(`https://api.zippopotam.us/us/${zip}`, { cache: 'no-store' });
        if (g.ok) { const geo = await g.json(); const p = geo?.places?.[0];
          if (p) loc = { latitude: p.latitude, longitude: p.longitude, name: p['place name'], admin1: p['state abbreviation'] }; }
      } catch {}
      if (!loc) {
        const n = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=US&format=json&addressdetails=1&limit=1`,
          { cache: 'no-store', headers: { 'User-Agent': 'cbedge-traders-dashboard/1.0' } });
        if (n.ok) { const arr = await n.json(); const x = Array.isArray(arr) ? arr[0] : null;
          if (x) loc = { latitude: x.lat, longitude: x.lon, name: x.address?.town || x.address?.city || x.address?.village || x.display_name?.split(',')[0] || zip, admin1: x.address?.['ISO3166-2-lvl4']?.split('-')[1] || '' }; }
      }
      if (!loc) return send(res, 404, { error: 'ZIP not found' });
      const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=auto`, { cache: 'no-store' });
      const w = await wRes.json(); const cur = w?.current;
      if (!cur) return send(res, 502, { error: 'Weather unavailable' });
      send(res, 200, { tempF: Math.round(cur.temperature_2m), condition: WMO[cur.weather_code] ?? '—', code: cur.weather_code, place: `${loc.name}${loc.admin1 ? ', ' + loc.admin1 : ''}` });
    } catch (err) { send(res, 500, { error: 'Weather fetch failed', detail: String(err) }); }
  },
});

// /api/yahoo-quotes — Yahoo chart per symbol (subscriber).
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json', 'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache', 'Pragma': 'no-cache',
  'Origin': 'https://finance.yahoo.com', 'Referer': 'https://finance.yahoo.com/',
};
register('/api/yahoo-quotes', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res) {
    try {
      const sp = new URL(req.url || '/', 'http://localhost').searchParams;
      const symbols = sp.get('symbols') || '';
      if (!symbols) return send(res, 400, { error: 'symbols required' });
      const syms = symbols.split(',').map(s => s.trim()).filter(Boolean);
      async function fetchOne(sym) {
        try {
          const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d&includePrePost=true&_=${Date.now()}`;
          const r = await fetch(url, { headers: YAHOO_HEADERS, cache: 'no-store' });
          if (!r.ok) return { price: null, change: null, pct: null, time: null };
          const data = await r.json(); const result = data?.chart?.result?.[0]; const meta = result?.meta;
          if (!meta) return { price: null, change: null, pct: null, time: null };
          const closes = result?.indicators?.quote?.[0]?.close;
          const lastClose = Array.isArray(closes) ? [...closes].reverse().find(v => typeof v === 'number' && Number.isFinite(v)) : null;
          const ts = result?.timestamp;
          const lastTime = Array.isArray(ts) ? [...ts].reverse().find(v => typeof v === 'number' && Number.isFinite(v)) : null;
          const price = meta.regularMarketPrice ?? lastClose ?? null;
          const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
          const change = price != null && prevClose != null ? price - prevClose : null;
          const pct = change != null && prevClose ? (change / prevClose) * 100 : null;
          const time = meta.regularMarketTime ?? lastTime ?? null;
          return { price, change, pct, time };
        } catch { return { price: null, change: null, pct: null, time: null }; }
      }
      const results = await Promise.all(syms.map(sym => fetchOne(sym).then(q => ({ sym, q }))));
      const quotes = {}; results.forEach(({ sym, q }) => { quotes[sym] = q; });
      send(res, 200, quotes, { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' });
    } catch (err) { send(res, 500, { error: String(err) }); }
  },
});

// /api/insights/vix — Yahoo VIX/VIX1D/GSPC (subscriber).
register('/api/insights/vix', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res) {
    try {
      const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9', Origin: 'https://finance.yahoo.com', Referer: 'https://finance.yahoo.com/' };
      async function fetchSeries(sym, range = '1y') {
        const empty = { closes: [], last: null };
        try {
          const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}&includePrePost=false&_=${Date.now()}`;
          const r = await fetch(url, { headers: H, cache: 'no-store' });
          if (!r.ok) return empty;
          const data = await r.json(); const result = data?.chart?.result?.[0]; const meta = result?.meta;
          if (!meta) return empty;
          const raw = result?.indicators?.quote?.[0]?.close;
          const closes = Array.isArray(raw) ? raw.filter(v => typeof v === 'number' && Number.isFinite(v)) : [];
          const last = meta.regularMarketPrice ?? (closes.length ? closes[closes.length - 1] : null);
          return { closes, last };
        } catch { return empty; }
      }
      function realizedVol(values, period = 10) {
        if (values.length < period + 1) return null;
        const slice = values.slice(-(period + 1)); const rets = [];
        for (let i = 1; i < slice.length; i++) rets.push(Math.log(slice[i] / slice[i - 1]));
        const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
        const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
        return Math.sqrt(variance) * Math.sqrt(252) * 100;
      }
      const [vix, vix1d, spx] = await Promise.all([fetchSeries('^VIX', '1y'), fetchSeries('^VIX1D', '1mo'), fetchSeries('^GSPC', '1mo')]);
      const vixSpot = vix.last; const vix1dVal = vix1d.last ?? vixSpot; const realized10d = realizedVol(spx.closes, 10);
      let ivRank = null, ivPercentile = null;
      if (vixSpot != null && vix.closes.length > 20) {
        const hist = vix.closes; const min = Math.min(...hist); const max = Math.max(...hist);
        if (max > min) ivRank = ((vixSpot - min) / (max - min)) * 100;
        ivPercentile = (hist.filter(v => v < vixSpot).length / hist.length) * 100;
      }
      const round = (v, d = 2) => v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;
      send(res, 200, { data: { vix_spot: round(vixSpot), vix_1d: round(vix1dVal), realized_10d: round(realized10d), iv_rank: round(ivRank, 1), iv_percentile: round(ivPercentile, 1), source: 'yahoo' } }, { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' });
    } catch (err) { send(res, 500, { error: String(err) }); }
  },
});

// /api/earnings-today — Yahoo visualization + quote caps (subscriber; 200 on failure).
register('/api/earnings-today', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res) {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    try {
      const body = { sortType: 'ASC', entityIdType: 'earnings', sortField: 'companyshortname',
        includeFields: ['ticker', 'companyshortname', 'startdatetimetype'],
        query: { operator: 'and', operands: [
          { operator: 'gte', operands: ['startdatetime', `${day}T00:00:00.000Z`] },
          { operator: 'lt', operands: ['startdatetime', `${day}T23:59:59.999Z`] },
          { operator: 'eq', operands: ['region', 'us'] } ] }, offset: 0, size: 100 };
      const er = await fetch('https://query1.finance.yahoo.com/v1/finance/visualization?lang=en-US&region=US',
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, body: JSON.stringify(body), cache: 'no-store' });
      if (!er.ok) throw new Error(`Yahoo HTTP ${er.status}`);
      const json = await er.json(); const result = json?.finance?.result?.[0];
      const cols = (result?.documents?.[0]?.columns ?? []).map(c => c.id);
      const rowsRaw = result?.documents?.[0]?.rows ?? []; const ix = id => cols.indexOf(id);
      const rows = rowsRaw.map(r => ({ symbol: String(r[ix('ticker')] ?? '').toUpperCase(), company: String(r[ix('companyshortname')] ?? ''), callTime: String(r[ix('startdatetimetype')] ?? ''), marketCap: 0 })).filter(r => r.symbol);
      const symbols = rows.map(r => r.symbol); const capBySym = new Map();
      for (let i = 0; i < symbols.length; i += 50) {
        const chunk = symbols.slice(i, i + 50);
        try {
          const qr = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, cache: 'no-store' });
          if (!qr.ok) continue;
          const j = await qr.json();
          for (const q of j?.quoteResponse?.result ?? []) if (q?.symbol) capBySym.set(String(q.symbol).toUpperCase(), Number(q.marketCap) || 0);
        } catch {}
      }
      for (const r of rows) r.marketCap = capBySym.get(r.symbol) ?? 0;
      rows.sort((a, b) => b.marketCap - a.marketCap);
      send(res, 200, { date: day, count: rows.length, earnings: rows }, { 'Cache-Control': 'no-store' });
    } catch (e) {
      send(res, 200, { date: day, count: 0, earnings: [], error: e?.message ?? 'fetch failed' });
    }
  },
});

// /api/trump-calendar — factba.se feed, 30-min in-memory cache (subscriber).
const TC_EXCLUDE = ['executive time', 'pool call', 'in-town pool'];
const TC_CACHE_TTL = 30 * 60 * 1000;
let _tcCache = { body: [], ts: 0 };
register('/api/trump-calendar', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res) {
    if (_tcCache.body.length && Date.now() - _tcCache.ts < TC_CACHE_TTL)
      return send(res, 200, { events: _tcCache.body }, { 'X-Cache': 'HIT' });
    try {
      const r = await fetch('https://media-cdn.factba.se/rss/json/trump/calendar-full.json', { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
      if (!r.ok) return send(res, 502, { events: [], error: `Upstream ${r.status}` });
      const raw = await r.json();
      const items = Array.isArray(raw) ? raw : (raw?.events ?? []);
      const d = new Date(); const cutoff = d.toISOString().slice(0, 10);
      const events = items
        .filter(ev => (ev.date ?? '') >= cutoff)
        .filter(ev => { const name = String(ev.details || ev.type || ev.daily_text || '').toLowerCase(); return !TC_EXCLUDE.some(x => name.includes(x)); })
        .map(ev => {
          const title = ev.details || ev.type || ev.daily_text || 'President Event';
          const date = ev.date ?? ''; const rawTime = ev.time ?? '';
          let time_formatted = rawTime ? rawTime : 'TBD';
          if (rawTime && rawTime.includes(':')) { const [h, m] = rawTime.split(':').map(Number); const ampm = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12; time_formatted = `${h12}:${String(m).padStart(2, '0')} ${ampm}`; }
          return { date, time: rawTime, time_formatted, title, country: 'US', impact: 'President', forecast: '', previous: '', actual: '' };
        })
        .filter(ev => ev.date);
      _tcCache = { body: events, ts: Date.now() };
      send(res, 200, { events });
    } catch (err) { send(res, 500, { events: [], error: err instanceof Error ? err.message : String(err) }); }
  },
});

// /api/cloudflare-metrics — owner card (env creds).
register('/api/cloudflare-metrics', {
  auth: 'owner', methods: ['GET'],
  async handler(req, res) {
    try {
      const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? ''; const ZONE_ID = process.env.CLOUDFLARE_ZONE_ID ?? '';
      const GQL = 'https://api.cloudflare.com/client/v4/graphql';
      const WINDOWS = { live: 3_600_000 * 24, weekly: 7 * 86_400_000, monthly: 30 * 86_400_000 };
      const sp = new URL(req.url || '/', 'http://localhost').searchParams;
      const win = sp.get('window') ?? 'live';
      const downsample = (vals, max = 40) => { if (vals.length <= max) return vals; const bucket = vals.length / max; const out = []; for (let i = 0; i < max; i++) { const slice = vals.slice(Math.floor(i * bucket), Math.floor((i + 1) * bucket)); if (slice.length) out.push(slice.reduce((a, b) => a + b, 0)); } return out; };
      if (!TOKEN || !ZONE_ID)
        return send(res, 200, { ok: false, window: win, egress: { value: null, unit: 'MB', window: win, spark: [] }, fetchedAt: new Date().toISOString(), unconfigured: true });
      const planFor = w => w === 'live' ? { dataset: 'httpRequestsAdaptiveGroups', dim: 'datetimeHour' } : w === 'weekly' ? { dataset: 'httpRequests1hGroups', dim: 'datetimeHour' } : { dataset: 'httpRequests1dGroups', dim: 'date' };
      const ms = WINDOWS[win] ?? WINDOWS.live; const now = new Date(); const end = now.toISOString(); const start = new Date(now.getTime() - ms).toISOString();
      const { dataset, dim } = planFor(win);
      const query = `query Egress($zone: String!, $start: Time!, $end: Time!) { viewer { zones(filter: { zoneTag: $zone }) { ${dataset}(limit: 5000 filter: { datetime_geq: $start, datetime_leq: $end } orderBy: [${dim}_ASC]) { sum { edgeResponseBytes } dimensions { ${dim} } } } } }`;
      async function fetchCf(qq, variables) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await fetch(GQL, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: qq, variables }), cache: 'no-store' });
            if (r.ok) { const j = await r.json(); if (j.errors?.length) return null; return j; }
            if (r.status >= 400 && r.status < 500 && r.status !== 429) return null;
          } catch {}
          if (attempt < 2) await new Promise(rs => setTimeout(rs, 250 * (attempt + 1)));
        }
        return null;
      }
      const resp = await fetchCf(query, { zone: ZONE_ID, start, end });
      const groups = resp?.data?.viewer?.zones?.[0]?.[dataset] ?? [];
      const perBucketBytes = groups.map(g => Number(g.sum?.edgeResponseBytes ?? 0)).filter(n => !Number.isNaN(n));
      const totalBytes = perBucketBytes.reduce((a, b) => a + b, 0);
      const egressMb = perBucketBytes.length ? totalBytes / (1024 * 1024) : null;
      const sparkMb = downsample(perBucketBytes.map(b => b / (1024 * 1024)));
      send(res, 200, { ok: perBucketBytes.length > 0, window: win, egress: { value: egressMb, unit: 'MB', window: win, spark: sparkMb }, fetchedAt: end });
    } catch (err) { send(res, 500, { error: String(err) }); }
  },
});

// /api/hetzner-metrics — owner card (env creds + /proxy/self-metrics).
register('/api/hetzner-metrics', {
  auth: 'owner', methods: ['GET'],
  async handler(req, res, ctx) {
    try {
      const TOKEN = process.env.HETZNER_API_TOKEN ?? ''; const SERVER_ID = process.env.HETZNER_SERVER_ID ?? '';
      const BASE = 'https://api.hetzner.cloud/v1';
      const WINDOWS = { live: 3_600_000, weekly: 7 * 86_400_000, monthly: 30 * 86_400_000 };
      const stepFor = w => w === 'live' ? 60 : w === 'weekly' ? 3600 : 21600;
      const seriesValues = (resp, key) => { const s = resp?.metrics?.time_series?.[key]; if (!s?.values?.length) return []; return s.values.map(([, v]) => Number(v)).filter(n => !Number.isNaN(n)); };
      const latest = v => v.length ? v[v.length - 1] : null;
      const avg = v => v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      const downsample = (vals, max = 40) => { if (vals.length <= max) return vals; const bucket = vals.length / max; const out = []; for (let i = 0; i < max; i++) { const slice = vals.slice(Math.floor(i * bucket), Math.floor((i + 1) * bucket)); if (slice.length) out.push(slice.reduce((a, b) => a + b, 0) / slice.length); } return out; };
      const sp = new URL(req.url || '/', 'http://localhost').searchParams;
      const win = sp.get('window') ?? 'live';
      let memBytes = null;
      try { const mr = await ctx.internalFetch('/proxy/self-metrics'); if (mr.ok) memBytes = Number((await mr.json())?.rss ?? 0) || null; } catch {}
      if (!TOKEN || !SERVER_ID)
        return send(res, 200, { ok: false, window: win, bandwidth: { value: null, unit: 'MB', window: win, spark: [] }, memory: { value: memBytes, unit: 'bytes', window: win, spark: [] }, cpu: { value: null, unit: 'cpu', window: win, spark: [] }, fetchedAt: new Date().toISOString(), unconfigured: !memBytes });
      const ms = WINDOWS[win] ?? WINDOWS.live; const now = new Date(); const end = now.toISOString(); const start = new Date(now.getTime() - ms).toISOString(); const step = stepFor(win);
      async function fetchMetrics(types, s, e, st) {
        const url = `${BASE}/servers/${SERVER_ID}/metrics?type=${types}&start=${encodeURIComponent(s)}&end=${encodeURIComponent(e)}&step=${st}`;
        for (let attempt = 0; attempt < 3; attempt++) {
          try { const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` }, cache: 'no-store' }); if (r.ok) return await r.json(); if (r.status >= 400 && r.status < 500 && r.status !== 429) return null; } catch {}
          if (attempt < 2) await new Promise(rs => setTimeout(rs, 250 * (attempt + 1)));
        }
        return null;
      }
      const resp = await fetchMetrics('cpu,network', start, end, step);
      const cpuVals = seriesValues(resp, 'cpu');
      const netIn = seriesValues(resp, 'network.0.bandwidth.in'); const netOut = seriesValues(resp, 'network.0.bandwidth.out');
      const netLen = Math.max(netIn.length, netOut.length); const netVals = [];
      for (let i = 0; i < netLen; i++) netVals.push((netIn[i] ?? 0) + (netOut[i] ?? 0));
      const cpuFn = win === 'live' ? latest : avg;
      const cpuValRaw = cpuFn(cpuVals); const cpuFraction = cpuValRaw != null ? cpuValRaw / 100 : null;
      const bytesTransferred = netVals.reduce((acc, bps) => acc + bps * step, 0);
      const bandwidthMb = netVals.length ? bytesTransferred / (1024 * 1024) : null;
      const bwSparkMb = downsample(netVals.map(bps => (bps * step) / (1024 * 1024)));
      const ok = cpuVals.length > 0 || netVals.length > 0;
      send(res, 200, { ok, window: win, cpu: { value: cpuFraction, unit: 'cpu', window: win, spark: downsample(cpuVals.map(v => v / 100)) }, bandwidth: { value: bandwidthMb, unit: 'MB', window: win, spark: bwSparkMb }, memory: { value: memBytes, unit: 'bytes', window: win, spark: [] }, fetchedAt: end });
    } catch (err) { send(res, 500, { error: String(err) }); }
  },
});

// /api/keepalive — liveness probe (public).
register('/api/keepalive', {
  auth: 'public', methods: ['GET'],
  async handler(req, res, ctx) {
    try {
      const r = await ctx.internalFetch('/health');
      send(res, 200, { ok: r.status < 500 });
    } catch { send(res, 200, { ok: false }); }
  },
});

// ---------------------------------------------------------------------------
// Dispatcher — return true if handled (skip Next), false to fall through.
// ---------------------------------------------------------------------------

async function handleApiRoute(req, res, ctx) {
  let pathname;
  try { ({ pathname } = new URL(req.url || '/', 'http://localhost')); }
  catch { return false; }
  if (!pathname || !pathname.startsWith('/api/')) return false;

  let def = ROUTES.get(pathname);
  let params = null;
  if (!def) {
    const dyn = matchDynamic(pathname);
    if (!dyn) return false; // not ported yet → let Next handle it
    def = dyn.def;
    params = dyn.params;
  }

  const method = req.method || 'GET';
  if (def.methods && !def.methods.includes(method)) {
    ctx.sendJson(res, 405, { error: 'method-not-allowed' }, req);
    return true;
  }

  const verdict = await enforceAuth(def.auth, req, ctx, def.identify);
  if (!verdict.ok) {
    ctx.sendJson(res, verdict.code, { error: verdict.reason }, req);
    return true;
  }

  // Per-request ctx with params for dynamic routes (never mutate the shared ctx).
  const reqCtx = params ? Object.assign(Object.create(ctx), { params }) : ctx;

  try {
    await def.handler(req, res, reqCtx, verdict);
  } catch (err) {
    ctx.sendJson(res, 500, { error: String(err?.message || err) }, req);
  }
  return true;
}

// /api/market-scanner — multi-ticker regime/scoring scan (Yahoo series + live
// SPX GEX via in-process /proxy/gex). Pure compute, no DB. Ported verbatim from
// app/api/market-scanner/route.ts.
register('/api/market-scanner', {
  auth: 'owner', methods: ['GET'],
  async handler(req, res, ctx) {
    const YAHOO_HEADERS = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9',
      Origin: 'https://finance.yahoo.com', Referer: 'https://finance.yahoo.com/',
    };
    const emptySeries = () => ({ closes: [], timestamps: [], last: null, prevClose: null, change: null, pct: null });
    async function fetchYahoo(sym, range = '1y') {
      try {
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}&includePrePost=false`;
        const r = await fetch(url, { headers: YAHOO_HEADERS, cache: 'no-store' });
        if (!r.ok) return emptySeries();
        const data = await r.json();
        const result = data?.chart?.result?.[0];
        if (!result) return emptySeries();
        const meta = result.meta ?? {};
        const raw = result.indicators?.quote?.[0]?.close ?? [];
        const closes = raw.filter((v) => typeof v === 'number' && isFinite(v));
        const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
        const last = meta.regularMarketPrice ?? (closes.length ? closes[closes.length - 1] : null);
        const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? (closes.length > 1 ? closes[closes.length - 2] : null);
        const change = last != null && prevClose != null ? last - prevClose : null;
        const pct = change != null && prevClose ? (change / prevClose) * 100 : null;
        return { closes, timestamps, last, prevClose, change, pct };
      } catch { return emptySeries(); }
    }
    const ivRank = (current, series) => {
      if (!series.length || current == null) return null;
      const lo = Math.min(...series), hi = Math.max(...series);
      if (hi === lo) return 50;
      return Math.round(((current - lo) / (hi - lo)) * 100);
    };
    const realizedVol = (closes, period = 20) => {
      if (closes.length < period + 1) return null;
      const slice = closes.slice(-(period + 1)); const rets = [];
      for (let i = 1; i < slice.length; i++) rets.push(Math.log(slice[i] / slice[i - 1]));
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
      return Math.round(Math.sqrt(variance * 252) * 100 * 10) / 10;
    };
    const trendSlope = (closes, period = 20) => {
      if (closes.length < 2) return 0;
      const s = closes.slice(-period); const n = s.length;
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      for (let i = 0; i < n; i++) { sumX += i; sumY += s[i]; sumXY += i * s[i]; sumX2 += i * i; }
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      return (slope / (s[0] || 1)) * 100;
    };
    const momentum = (closes) => {
      if (closes.length < 20) return 'neutral';
      const avg5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
      const avg20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const slope = trendSlope(closes, 20); const diff = (avg5 - avg20) / avg20;
      if (Math.abs(slope) > 0.1 && Math.abs(diff) > 0.005) return 'strong';
      if (Math.abs(diff) < 0.002 && Math.abs(slope) < 0.05) return 'weakening';
      return 'neutral';
    };
    const extensionLevel = (closes) => {
      if (closes.length < 20) return 'neutral';
      const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const last = closes[closes.length - 1]; const pct = (last - ma20) / ma20;
      if (Math.abs(pct) > 0.04) return 'extended';
      if (Math.abs(pct) < 0.01) return 'contracted';
      return 'neutral';
    };
    const pcrLookup = (ivr, trend) => {
      const base = 1.0 + (ivr - 50) * 0.005;
      if (trend === 'up') return Math.round((base - 0.1) * 100) / 100;
      if (trend === 'down') return Math.round((base + 0.1) * 100) / 100;
      return Math.round(base * 100) / 100;
    };
    const emptyGex = {
      gexFlip: null, gexPer1pct: null, maxGexStrike: null, gexExpiringPct: null, gexExpiringDate: null,
      callWall: null, putWall: null, callsOI: null, putsOI: null, pcrOI: null, callSpec: null,
    };
    async function fetchGexSnap() {
      try {
        const r = await ctx.internalFetch('/proxy/gex', { cache: 'no-store' });
        if (!r.ok) return emptyGex;
        const v = await r.json();
        const chain = v.gexRows ?? [];
        let callsOI = 0, putsOI = 0, callsVol = 0, putsVol = 0;
        chain.forEach((row) => {
          callsOI += row.callOI ?? 0; putsOI += row.putOI ?? 0;
          callsVol += row.callVolume ?? 0; putsVol += row.putVolume ?? 0;
        });
        const totalOI = callsOI + putsOI, totalVol = callsVol + putsVol;
        const pcrOI = putsOI > 0 && callsOI > 0 ? Math.round((putsOI / callsOI) * 100) / 100 : null;
        const callSpec = totalVol > 0 ? Math.round((callsVol / totalVol) * 100) : totalOI > 0 ? Math.round((callsOI / totalOI) * 100) : null;
        let maxGexStrike = null, maxGex = -Infinity;
        chain.forEach((row) => { const g = Math.abs(row.netGEX ?? 0); if (g > maxGex) { maxGex = g; maxGexStrike = row.strike; } });
        const spot = v.spot ?? null;
        const gexPer1pct = v.totalNetGex != null && spot && spot > 0 ? Math.round((v.totalNetGex / (spot * 0.01)) / 1e9 * 100) / 100 : null;
        return {
          gexFlip: v.gexFlip ?? null, gexPer1pct, maxGexStrike, gexExpiringPct: null,
          gexExpiringDate: v.expiry ?? null, callWall: v.callWall ?? null, putWall: v.putWall ?? null,
          callsOI: callsOI || null, putsOI: putsOI || null, pcrOI, callSpec,
        };
      } catch { return emptyGex; }
    }
    function computeAnalytics(sym, spot, closes, ivr, rv20, iv1dChange, gex) {
      const slope = trendSlope(closes, 20), mom = momentum(closes), ext = extensionLevel(closes);
      const ivrN = ivr ?? 50;
      const trend = slope > 0.08 ? 'up' : slope < -0.08 ? 'down' : 'sideways';
      let alignment = 'neutral';
      if (gex.gexFlip != null) {
        const aboveFlip = spot > gex.gexFlip;
        if (trend === 'up' && aboveFlip) alignment = 'aligned';
        else if (trend === 'down' && !aboveFlip) alignment = 'aligned';
        else if (trend !== 'sideways') alignment = 'conflicting';
      }
      let regime;
      if (trend === 'sideways') regime = 'RANGE BOUND';
      else if (ivrN > 60) regime = 'TRENDING HIGH VOL';
      else regime = 'TRENDING LOW VOL';
      let marketStructure;
      if (ext === 'extended' && alignment === 'conflicting') marketStructure = 'MEAN REVERSION FAVORED';
      else if (ivrN > 65 && mom === 'strong') marketStructure = 'VOLATILITY EXPANSION RISK';
      else if (trend !== 'sideways' && alignment === 'aligned') marketStructure = 'TREND CONTINUATION LIKELY';
      else marketStructure = 'MIXED / WATCH';
      let direction;
      if (ext === 'extended' && mom === 'weakening') direction = 'NEUTRAL';
      else if (trend === 'up') direction = 'LONG';
      else if (trend === 'down') direction = 'SHORT';
      else direction = 'NEUTRAL';
      let strategy;
      if (ivrN > 55 && alignment === 'conflicting') strategy = 'VOL PREMIUM';
      else if (ext === 'extended' && mom === 'weakening') strategy = 'MEAN REVERSION';
      else if (trend !== 'sideways' && mom === 'strong' && ivrN < 50) strategy = 'DIRECTIONAL';
      else if (trend === 'sideways' && ivrN < 35) strategy = 'PASS';
      else strategy = 'MEAN REVERSION';
      if (sym === 'VIX') {
        direction = 'NEUTRAL';
        strategy = ivrN > 50 ? 'VOL PREMIUM' : 'PASS';
        if (trend === 'up') regime = 'VOLATILITY EXPANSION';
        else if (trend === 'down') regime = 'VOL COMPRESSION';
      }
      const THESIS = {
        'VOL PREMIUM': 'Sell premium, fade extensions, collect decay',
        'MEAN REVERSION': 'Fade extensions, target MA mean reversion',
        'DIRECTIONAL': 'Long breakouts, buy dips to MA',
        'PASS': 'Long with defined risk, reduced size; tighten stops',
      };
      const thesis = THESIS[strategy] ?? 'Monitor; conflicting signals';
      let score = 5;
      if (trend !== 'sideways') score += 1;
      if (mom === 'strong') score += 1;
      if (alignment === 'aligned') score += 1;
      if (alignment === 'conflicting') score -= 1;
      if (ext === 'extended') score -= 1;
      if (ivrN > 60) score += 1;
      if (strategy === 'PASS') score = Math.min(score, 2);
      if (sym === 'VIX') score = Math.round(ivrN / 10);
      score = Math.max(0, Math.min(10, score));
      const rating = strategy === 'PASS' ? 'PASS' : score >= 6 ? 'HIGH' : 'LOW';
      const approxIV = ivrN * 0.8 + 10;
      const em1d = spot ? Math.round((spot * (approxIV / 100) * Math.sqrt(1 / 365)) * 10) / 10 : null;
      const em1w = spot ? Math.round((spot * (approxIV / 100) * Math.sqrt(7 / 365)) * 10) / 10 : null;
      const em30d = spot ? Math.round((spot * (approxIV / 100) * Math.sqrt(30 / 365)) * 10) / 10 : null;
      const pcIvRatio = pcrLookup(ivrN, trend);
      const pcIvSpread = Math.round((pcIvRatio - 1) * 100) / 1000;
      const pcrVol = pcrLookup(ivrN, trend) * (trend === 'up' ? 0.85 : 1.1);
      return {
        score, rating, direction, strategy, thesis, regime, marketStructure,
        em1d, em1w, em30d, trend, momentum: mom, extension: ext, alignment,
        pcIvRatio, pcIvSpread, pcrVol: Math.round(pcrVol * 100) / 100, pcrDelta30d: null,
      };
    }
    function buildTicker(sym, series, ivr, rv20, iv1dChange, gex, now) {
      const spot = series.last;
      if (!spot || series.closes.length < 5) {
        return {
          symbol: sym, spot, change1d: series.change, pct1d: series.pct,
          score: 0, rating: 'PASS', direction: 'NEUTRAL', strategy: 'PASS', thesis: 'Data unavailable',
          regime: 'UNKNOWN', marketStructure: 'UNKNOWN', ivRank: ivr, iv1dChange, callSpec: gex.callSpec,
          em1d: null, em1w: null, em30d: null, trend: 'sideways', momentum: 'neutral', extension: 'neutral',
          realizedVol20d: rv20, alignment: 'neutral', gexFlip: gex.gexFlip, gexPer1pct: gex.gexPer1pct,
          maxGexStrike: gex.maxGexStrike, gexExpiringPct: gex.gexExpiringPct, gexExpiringDate: gex.gexExpiringDate,
          pcIvRatio: null, pcIvSpread: null, callsOI: gex.callsOI, putsOI: gex.putsOI,
          pcrOI: gex.pcrOI, pcrVol: null, pcrDelta30d: null, updatedAt: now,
        };
      }
      const computed = computeAnalytics(sym, spot, series.closes, ivr, rv20, iv1dChange, gex);
      return {
        symbol: sym, spot, change1d: series.change, pct1d: series.pct, ivRank: ivr, iv1dChange,
        realizedVol20d: rv20, callSpec: gex.callSpec, gexFlip: gex.gexFlip, gexPer1pct: gex.gexPer1pct,
        maxGexStrike: gex.maxGexStrike, gexExpiringPct: gex.gexExpiringPct, gexExpiringDate: gex.gexExpiringDate,
        callsOI: gex.callsOI, putsOI: gex.putsOI, pcrOI: gex.pcrOI, ...computed, updatedAt: now,
      };
    }
    try {
      const [spxS, spyS, qqqS, vixS, vxnS, vvixS] = await Promise.all([
        fetchYahoo('^GSPC'), fetchYahoo('SPY'), fetchYahoo('QQQ'), fetchYahoo('^VIX'),
        fetchYahoo('^VXN').catch(() => emptySeries()), fetchYahoo('^VVIX').catch(() => emptySeries()),
      ]);
      const gexSnap = await fetchGexSnap();
      const vixCurrent = vixS.last ?? 20, vxnCurrent = vxnS.last ?? vixCurrent, vvixCurrent = vvixS.last ?? 80;
      const spxIvr = ivRank(vixCurrent, vixS.closes);
      const spyIvr = ivRank(vixCurrent, vixS.closes);
      const qqqIvr = ivRank(vxnCurrent, vxnS.closes.length > 50 ? vxnS.closes : vixS.closes);
      const vixIvr = ivRank(vvixCurrent, vvixS.closes.length > 50 ? vvixS.closes : vixS.closes);
      const spxRv = realizedVol(spxS.closes), spyRv = realizedVol(spyS.closes), qqqRv = realizedVol(qqqS.closes), vixRv = realizedVol(vixS.closes);
      const now = new Date().toISOString();
      const results = [
        buildTicker('SPX', spxS, spxIvr, spxRv, vixS.change, gexSnap, now),
        buildTicker('SPY', spyS, spyIvr, spyRv, vixS.change, emptyGex, now),
        buildTicker('QQQ', qqqS, qqqIvr, qqqRv, vxnS.change, emptyGex, now),
        buildTicker('VIX', vixS, vixIvr, vixRv, vvixS.change, emptyGex, now),
      ];
      send(res, 200, { tickers: results, updatedAt: now }, { 'Cache-Control': NO_STORE });
    } catch (err) { send(res, 500, { error: String(err?.message || err) }); }
  },
});

// /api/prev-closes, /api/gex-top3, /api/estimated-move — legacy 501 stubs
// (GET+POST "not implemented"), ported verbatim. Kept subscriber to match the
// original /api/* paywall.
for (const p of ['/api/prev-closes', '/api/gex-top3', '/api/estimated-move']) {
  register(p, {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res) { send(res, 501, { error: 'not implemented' }); },
  });
}

// /api/render-metrics — 410 tombstone (hosting moved to VPS → /api/hetzner-metrics).
// Public so any stale client gets the clear 410 rather than a 401.
register('/api/render-metrics', {
  auth: 'public', methods: ['GET'],
  async handler(req, res) {
    send(res, 410, { ok: false, error: 'render-metrics removed — use /api/hetzner-metrics' });
  },
});

// /api/gex — thin adapter over in-process /proxy/gex, reshaped to the dashboard
// chain payload. Ported verbatim from app/api/gex/route.ts.
register('/api/gex', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res, ctx) {
    const expiry = new URL(req.url || '/', 'http://localhost').searchParams.get('expiry') || '';
    try {
      const r = await ctx.internalFetch('/proxy/gex', { cache: 'no-store' });
      if (!r.ok) { send(res, 502, { error: `proxy /proxy/gex returned ${r.status}`, chain: [] }); return; }
      const v2 = await r.json();
      send(res, 200, {
        chain: Array.isArray(v2.gexRows) ? v2.gexRows : [],
        spotPrice: Number(v2.spot ?? 0),
        expiration: v2.expiry ?? expiry ?? null,
        expirations: v2.expirations ?? undefined,
        callWall: v2.callWall ?? null,
        putWall: v2.putWall ?? null,
        gexFlip: v2.gexFlip ?? null,
        totalNetGex: v2.totalNetGex ?? null,
        totals: v2.totals ?? null,
        prevClose: v2.prevClose ?? null,
        prevCloseDate: v2.prevCloseDate ?? null,
        updatedAt: v2.updatedAt ?? null,
        symbol: v2.symbol ?? null,
      }, { 'Cache-Control': CACHE_30 });
    } catch (err) { send(res, 502, { error: String(err?.message || err), chain: [] }); }
  },
});

// /api/calendar — economic calendar (ForexFactory + factba Trump events, with a
// saved-events.json fallback). GET-only, subscriber. Ported verbatim from
// app/api/calendar/route.ts (module-level Trump cache preserved).
{
  // VERIFIED 2026-07-27: thisweek is the ONLY file faireconomy publishes here.
  // ff_calendar_nextweek.json, ff_calendar_lastweek.json and
  // ff_calendar_thismonth.json all return 404 — do not add them back.
  //
  // That file is Sun–Sat, but EconCalendarPanel renders a ROLLING today→today+6
  // window, so the tail is data upstream hasn't published yet. Since it can't be
  // fetched, the cache ACCUMULATES instead: each successful fetch is merged into
  // the stored set rather than replacing it, so after a Sunday rollover the cache
  // holds both the outgoing and incoming week and the window stays populated.
  const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  // How much history the accumulating cache keeps. Two weeks covers a rollover
  // plus the panel's dimmed "already happened" section, and bounds the file.
  const CACHE_RETAIN_DAYS = 14;
  const SAVED_EVENTS_PATH = nodePath.join(process.cwd(), 'app/api/econ-calendar/events.json');
  // Last-good upstream response. state/ is the ONLY bind-mounted dir in
  // docker-compose (./state:/app/state) — anywhere else is ephemeral and the
  // cache would reset on every redeploy, defeating its whole purpose.
  const CACHE_PATH = nodePath.join(process.cwd(), 'state', 'econ-calendar-cache.json');
  const FF_TIMEOUT_MS = 10_000;
  // OBSERVED FAILURE (2026-07-27): faireconomy returned `429 Rate Limited` HTML,
  // so this route fell through to a saved events.json last touched in June and
  // the panel rendered "No events this week." The rate limit was self-inflicted —
  // server-v2/econ-alert-recorder.js polls /api/calendar every 20s and NOTHING
  // between that and the CDN was cached, so one VPS IP was issuing thousands of
  // upstream requests a day against a feed that publishes a few times an hour.
  // getEconEvents() below is the actual fix; the disk cache, window-aware
  // fallback and surfaced warning are damage limitation for real outages.
  const ECON_TTL_MS = 30 * 60 * 1000;      // faireconomy's own guidance is ~30 min
  const ECON_BACKOFF_MS = 15 * 60 * 1000;  // after a hard failure, stop hammering
  let econCache = null;                    // { events, ts, savedAt }
  let econBackoffUntil = 0;
  const TRUMP_EXCLUDE = ['executive time', 'pool call', 'in-town pool'];
  const TRUMP_CACHE_TTL = 30 * 60 * 1000;
  let trumpCache = { body: [], ts: 0 };
  // Upstream answers rate limits with a full HTML error page. Dumping 200 chars
  // of that into the error string put "<!DOCTYPE html> <html> <head>..." in the
  // user-facing warning banner. Keep the <title> ("Rate Limited") and drop the
  // markup; pass plain-text bodies through truncated.
  const briefDetail = (text) => {
    const t = String(text || '').trim();
    if (!t) return '';
    if (/^<(!doctype|html)/i.test(t)) {
      const title = t.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
      return title ? `: ${title}` : ': HTML error page';
    }
    return `: ${t.slice(0, 120)}`;
  };
  const fetchFFWeek = async (url) => {
    // No "Referer: forexfactory.com" header. Spoofing a cross-origin Referer onto
    // the faireconomy CDN is pointless and is one of the signals that gets an IP
    // classified as a scraper — exactly what we do not want while climbing out of
    // a 429. A complete, honest UA is enough.
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
      },
      signal: AbortSignal.timeout(FF_TIMEOUT_MS),
    });
    const name = url.split('/').pop();
    if (!res.ok) {
      const detail = await res.text().then(briefDetail).catch(() => '');
      throw new Error(`${name} ${res.status}${detail}`);
    }
    const raw = await res.json();
    if (!Array.isArray(raw)) throw new Error(`${name}: non-array payload`);
    return raw;
  };
  const fetchForexFactoryEvents = async () => {
    const events = await fetchFFWeek(FF_URL);
    if (!events.length) throw new Error('ForexFactory returned no events');
    return events;
  };
  const eventKey = (ev) => `${ev.date}|${ev.country}|${ev.title}`;
  // Merge a freshly fetched week into what we already hold. Incoming rows WIN on
  // a key collision so forecast/actual values revise in place as the week plays
  // out; anything older than CACHE_RETAIN_DAYS is dropped.
  const mergeEvents = (existing, incoming) => {
    const cutoff = Date.now() - CACHE_RETAIN_DAYS * 86_400_000;
    const byKey = new Map();
    for (const ev of existing) byKey.set(eventKey(ev), ev);
    for (const ev of incoming) byKey.set(eventKey(ev), ev);
    return [...byKey.values()]
      .filter((ev) => { const t = Date.parse(ev.date); return !Number.isFinite(t) || t >= cutoff; })
      .sort((a, b) => a.date.localeCompare(b.date));
  };
  // savedAt is passed in rather than stamped here so the disk copy and the
  // in-process copy carry the SAME timestamp — the TTL check compares against it
  // after a restart, and two independently-taken clocks would make the seeded
  // cache look older (or newer) than it is.
  const writeCache = (events, savedAt) => {
    try {
      fs.mkdirSync(nodePath.dirname(CACHE_PATH), { recursive: true });
      fs.writeFileSync(CACHE_PATH, JSON.stringify({ savedAt, events }));
    } catch (err) { console.warn(`[calendar] cache write failed: ${err.message}`); }
  };
  const readCache = () => {
    try {
      const j = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
      if (!Array.isArray(j?.events) || !j.events.length) return null;
      return { events: j.events, savedAt: String(j.savedAt ?? 'unknown') };
    } catch { return null; }
  };
  // The single gate in front of the upstream CDN. Every caller — page loads, the
  // 20s alert recorder, the Discord snapshot — goes through here, so upstream
  // sees at most one request per ECON_TTL_MS regardless of local traffic.
  const getEconEvents = async () => {
    const now = Date.now();

    if (econCache && now - econCache.ts < ECON_TTL_MS) return { ...econCache, fresh: true };

    // Seed from disk on the first call after a restart so a redeploy doesn't send
    // a fetch upstream before the TTL has had a chance to apply.
    if (!econCache) {
      const disk = readCache();
      if (disk) {
        const diskTs = Date.parse(disk.savedAt);
        econCache = { events: disk.events, ts: Number.isFinite(diskTs) ? diskTs : 0, savedAt: disk.savedAt };
        if (now - econCache.ts < ECON_TTL_MS) return { ...econCache, fresh: true };
      }
    }

    if (now < econBackoffUntil) {
      const mins = Math.ceil((econBackoffUntil - now) / 60_000);
      if (econCache) return { ...econCache, fresh: false };
      throw new Error(`upstream in backoff after a failed fetch; retrying in ~${mins}m`);
    }

    try {
      const fetched = await fetchForexFactoryEvents();
      // Accumulate rather than replace — see the FF_URL comment. Without this the
      // Sunday rollover would silently drop the outgoing week from the cache.
      const events = mergeEvents(econCache?.events ?? [], fetched);
      const savedAt = new Date(now).toISOString();
      econCache = { events, ts: now, savedAt };
      writeCache(events, savedAt);
      econBackoffUntil = 0;
      return { ...econCache, fresh: true };
    } catch (err) {
      econBackoffUntil = now + ECON_BACKOFF_MS;
      // A stale cache beats no calendar. Flagged not-fresh so the caller warns
      // instead of silently presenting old data as live.
      if (econCache) return { ...econCache, fresh: false };
      throw err;
    }
  };
  // Solve a New-York wall-clock date+time to a real UTC instant. The old code
  // hardcoded '-04:00', shifting every saved event an hour outside DST.
  const etWallClockToISO = (dateStr, timeStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
    const target = Date.UTC(y, m - 1, d, hh, mm);
    let utc = target;
    for (let i = 0; i < 2; i++) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date(utc));
      const g = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
      const diff = target - Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
      if (!diff) break;
      utc += diff;
    }
    return new Date(utc).toISOString();
  };
  const fetchSavedEvents = () => {
    const raw = JSON.parse(fs.readFileSync(SAVED_EVENTS_PATH, 'utf-8'));
    if (!Array.isArray(raw)) return [];
    return raw.map((ev) => ({
      title: ev.title ?? ev.name ?? '', country: ev.country ?? 'USD',
      date: etWallClockToISO(ev.date, ev.time), impact: ev.impact ?? 'High',
      forecast: ev.forecast ?? '', previous: ev.previous ?? ev.period ?? '', actual: ev.actual ?? '',
    }));
  };
  // The rolling ET window the panel renders. Date-only UTC arithmetic so a DST
  // boundary inside the window can't skip or repeat a day.
  const etWindowDays = (days = 7) => {
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    const [y, m, d] = todayStr.split('-').map(Number);
    const base = Date.UTC(y, m - 1, d);
    return Array.from({ length: days }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  };
  const toET = (iso) => {
    const d = new Date(iso);
    const etDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
    const etTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
    const et24 = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    return { date: etDate, time: et24, time_formatted: etTime };
  };
  const fetchTrumpEvents = async () => {
    if (trumpCache.body.length && Date.now() - trumpCache.ts < TRUMP_CACHE_TTL) return trumpCache.body;
    try {
      const res = await fetch('https://media-cdn.factba.se/rss/json/trump/calendar-full.json', { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
      if (!res.ok) return [];
      const raw = await res.json();
      const items = Array.isArray(raw) ? raw : (raw.events ?? []);
      const mapped = [];
      const seenDateHour = new Set();
      for (const ev of items) {
        const name = String(ev.details || ev.type || ev.daily_text || '').toLowerCase();
        if (!ev.date || TRUMP_EXCLUDE.some((x) => name.includes(x))) continue;
        const rawTime = ev.time ?? '';
        if (!rawTime) continue;
        const title = ev.details || ev.type || ev.daily_text || 'President Event';
        const date = ev.date;
        const hour = rawTime.split(':')[0];
        const hourKey = `${date}-${hour}`;
        if (seenDateHour.has(hourKey)) continue;
        seenDateHour.add(hourKey);
        let time_formatted = rawTime;
        if (rawTime.includes(':')) {
          const [h, m] = rawTime.split(':').map(Number);
          const ampm = h >= 12 ? 'PM' : 'AM';
          const h12 = h % 12 || 12;
          time_formatted = `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
        }
        mapped.push({ date, time: rawTime, time_formatted, title, country: 'USD', impact: 'President', forecast: '', previous: '', actual: '' });
      }
      trumpCache = { body: mapped, ts: Date.now() };
      return mapped;
    } catch { return []; }
  };
  register('/api/calendar', {
    auth: 'subscriber', methods: ['GET'],
    async handler(req, res) {
      try {
        const [econResult, trumpEvents] = await Promise.allSettled([getEconEvents(), fetchTrumpEvents()]);
        const normalize = (list) => list.map((ev) => {
          const { date, time, time_formatted } = toET(ev.date);
          return { date, time, time_formatted, title: ev.title, country: ev.country, impact: ev.impact, forecast: ev.forecast, previous: ev.previous, actual: ev.actual ?? '' };
        });
        const window = new Set(etWindowDays(7));
        const coversWindow = (list) => list.some((e) => window.has(e.date));

        let econEvents = [], source = 'forexfactory', warning;
        if (econResult.status === 'fulfilled') {
          econEvents = normalize(econResult.value.events);
          source = econResult.value.fresh ? 'forexfactory' : 'cache';
          if (!econResult.value.fresh) warning = `Live economic feed unavailable — showing cached data from ${econResult.value.savedAt}.`;
        } else {
          const upstreamErr = econResult.reason?.message || String(econResult.reason);
          // Fall back ONLY to something that actually covers the window the panel
          // renders. The old code fell back unconditionally, so a months-old
          // events.json got served as source:"saved" with every row filtered out —
          // indistinguishable from a genuinely quiet week.
          const candidates = [];
          const cached = readCache();
          if (cached) candidates.push({ src: 'cache', list: normalize(cached.events), note: `cached feed from ${cached.savedAt}` });
          try { candidates.push({ src: 'saved', list: normalize(fetchSavedEvents()), note: 'manually saved events.json' }); }
          catch (e) { console.warn(`[calendar] saved fallback unreadable: ${e.message}`); }
          const hit = candidates.find((c) => coversWindow(c.list));
          if (hit) {
            econEvents = hit.list; source = hit.src;
            warning = `Live economic feed unavailable (${upstreamErr}) — showing ${hit.note}.`;
          } else {
            source = 'unavailable';
            warning = `Economic calendar feed unavailable (${upstreamErr}). No cached or saved events cover the current week.`;
          }
        }

        const events = [...econEvents, ...(trumpEvents.status === 'fulfilled' ? trumpEvents.value : [])]
          .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time)));
        const inWindow = econEvents.filter((e) => window.has(e.date)).length;
        console.log(`[calendar] ${econEvents.length} econ events (${inWindow} in the next 7d) from ${source} + ${trumpEvents.status === 'fulfilled' ? trumpEvents.value.length : 0} Trump events${warning ? ` — ${warning}` : ''}`);
        send(res, 200, { events, source, warning }, { 'Cache-Control': 's-maxage=1800, stale-while-revalidate=3600' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[calendar] error: ${msg}`);
        // Also send `warning` + source:"unavailable". This response is HTTP 200, so
        // clients checking res.ok see success — without a warning here a hard
        // failure renders as an ordinary empty week, which is how this broke
        // unnoticed for six weeks.
        send(res, 200, { error: msg, warning: `Economic calendar failed to load: ${msg}`, source: 'unavailable', events: [] });
      }
    },
  });
}

// /api/econ-calendar — GET reads the saved events.json, POST overwrites it.
// Subscriber (matches the original /api/* paywall; POST also reachable via the
// internal-token bypass). Ported verbatim from app/api/econ-calendar/route.ts.
{
  const EVENTS_PATH = nodePath.join(process.cwd(), 'app/api/econ-calendar/events.json');
  const readEvents = () => { try { return JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf-8')); } catch { return []; } };
  register('/api/econ-calendar', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res) {
      if (req.method === 'GET') { send(res, 200, readEvents(), { 'Cache-Control': 'no-store' }); return; }
      try {
        const body = await readJson(req);
        const events = Array.isArray(body) ? body : body.events;
        if (!Array.isArray(events)) { send(res, 400, { error: 'Expected array or { events: [] }' }); return; }
        fs.writeFileSync(EVENTS_PATH, JSON.stringify(events, null, 2), 'utf-8');
        send(res, 200, { ok: true, count: events.length });
      } catch (err) { send(res, 500, { error: err instanceof Error ? err.message : String(err) }); }
    },
  });
}

// /api/whats-new — owner-only DELETE to strike one bullet from
// CUSTOMER_CHANGELOG.md. Ported verbatim from app/api/whats-new/route.ts;
// ownerGate replaced by enforceAuth 'owner'.
{
  const CHANGELOG_PATH = nodePath.join(process.cwd(), 'CUSTOMER_CHANGELOG.md');
  register('/api/whats-new', {
    auth: 'owner', methods: ['DELETE'],
    async handler(req, res) {
      try {
        const { date, item } = await readJson(req);
        if (!date || !item) { send(res, 400, { error: 'date and item are required' }); return; }
        const raw = (await fs.promises.readFile(CHANGELOG_PATH, 'utf8')).replace(/^﻿/, '').replace(/\r\n/g, '\n');
        const lines = raw.split('\n');
        let inSection = false, removed = false;
        const out = [];
        for (const line of lines) {
          const trimmed = line.trim();
          const headingMatch = trimmed.match(/^##\s+(.*)$/);
          if (headingMatch) { inSection = headingMatch[1].trim() === date; out.push(line); continue; }
          const itemMatch = trimmed.match(/^[-*]\s+(.*)$/);
          if (inSection && !removed && itemMatch && itemMatch[1].trim() === item.trim()) { removed = true; continue; }
          out.push(line);
        }
        if (!removed) { send(res, 404, { error: 'Item not found' }); return; }
        await fs.promises.writeFile(CHANGELOG_PATH, out.join('\n'), 'utf8');
        send(res, 200, { ok: true });
      } catch (err) { send(res, 500, { error: 'Delete failed', detail: String(err) }); }
    },
  });
}

// /api/discord-share — owner-only push to the Discord webhook. Accepts JSON
// { content } or a raw multipart body (forwarded as-is). Ported verbatim from
// app/api/discord-share/route.ts; getServerUserId gate → 'user' + in-handler
// owner check (preserves the "any signed-in when OWNER_USER_ID unset" fallback).
register('/api/discord-share', {
  auth: 'user', methods: ['POST'],
  async handler(req, res, ctx, verdict) {
    try {
      const id = (verdict?.userId || '').trim();
      const allowed = id !== '' && (ctx.ownerUserId ? id === ctx.ownerUserId : true);
      if (!allowed) { send(res, 403, { ok: false, error: 'Forbidden' }); return; }
      const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
      if (!webhookUrl) { send(res, 500, { ok: false, error: 'DISCORD_WEBHOOK_URL is not configured' }); return; }
      const ct = req.headers['content-type'] || '';
      let body, headers = {};
      if (ct.includes('application/json')) {
        const json = await readJson(req).catch(() => ({}));
        const content = typeof json?.content === 'string' ? json.content : '';
        if (!content.trim()) { send(res, 400, { ok: false, error: 'Empty content' }); return; }
        body = JSON.stringify({ content: content.slice(0, 1990) });
        headers['content-type'] = 'application/json';
      } else {
        // Forward the raw multipart body untouched, preserving the content-type.
        body = await new Promise((resolve, reject) => {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => resolve(Buffer.concat(chunks)));
          req.on('error', reject);
        });
        if (ct) headers['content-type'] = ct;
      }
      const r = await fetch(webhookUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
      if (!r.ok) { const detail = await r.text().then((t) => t.slice(0, 500)).catch(() => ''); throw new Error(`Discord webhook returned ${r.status}${detail ? `: ${detail}` : ''}`); }
      send(res, 200, { ok: true });
    } catch (err) { console.error('[discord-share] failed:', err); send(res, 500, { ok: false, error: String(err) }); }
  },
});

// /api/tastytrade — TT OAuth → dxfeed streamer creds (module-cached session).
// GET health / POST returns tokens. Subscriber. Ported verbatim from
// app/api/tastytrade/route.ts.
{
  const TT_BASE = process.env.TT_BASE_URL ?? 'https://api.tastytrade.com';
  let cachedSession = null;
  const getSession = async () => {
    if (cachedSession && Date.now() < cachedSession.expiresAt) return cachedSession;
    const clientSecret = process.env.TT_CLIENT_SECRET;
    const refreshToken = process.env.TT_REFRESH_TOKEN;
    if (!clientSecret || !refreshToken) throw new Error('TT_CLIENT_SECRET or TT_REFRESH_TOKEN not configured');
    const tokenRes = await fetch(`${TT_BASE}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, client_secret: clientSecret }),
    });
    if (!tokenRes.ok) { const text = await tokenRes.text(); throw new Error(`TT OAuth failed (${tokenRes.status}): ${text}`); }
    const tokenData = await tokenRes.json();
    const sessionToken = tokenData?.['session-token'] ?? tokenData?.data?.['session-token'] ?? tokenData?.access_token;
    if (!sessionToken) throw new Error(`No session token in response: ${JSON.stringify(tokenData)}`);
    const streamerRes = await fetch(`${TT_BASE}/quote-streamer-tokens`, { headers: { Authorization: sessionToken } });
    if (!streamerRes.ok) throw new Error(`Failed to fetch streamer token (${streamerRes.status})`);
    const streamerData = await streamerRes.json();
    const streamerToken = streamerData?.data?.token;
    const dxfeedUrl = streamerData?.data?.['websocket-url'] ?? process.env.DXFEED_WS_URL;
    cachedSession = { sessionToken, streamerToken, dxfeedUrl, expiresAt: Date.now() + 50 * 60 * 1000 };
    return cachedSession;
  };
  register('/api/tastytrade', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res) {
      try {
        const session = await getSession();
        if (req.method === 'POST') { send(res, 200, { session_token: session.sessionToken, streamer_token: session.streamerToken, dxfeed_url: session.dxfeedUrl }); return; }
        send(res, 200, { status: 'ok', base: TT_BASE, dxfeed_url: session.dxfeedUrl, expires_in_ms: session.expiresAt - Date.now() });
      } catch (err) {
        if (req.method === 'GET') { send(res, 500, { status: 'error', error: String(err) }); return; }
        send(res, 500, { error: String(err) });
      }
    },
  });
}

// /api/social-media/daily-input — bundled pre-market read (spot/walls/flip/net
// GEX from /proxy/gex, EM from ATM straddle, ES overnight from candles). GET,
// subscriber. Ported verbatim from app/api/social-media/daily-input/route.ts;
// proxyBase fetches → ctx.internalFetch (internal token auto-attached).
register('/api/social-media/daily-input', {
  auth: 'owner', methods: ['GET'],
  async handler(req, res, ctx) {
    const GEX_LADDER_HALF = 20;
    const rowNetGex = (o, basis) => {
      const oi = Number(o.netGEX ?? o.netGex ?? 0);
      const vol = Number(o.netVolGEX ?? o.netVolGex ?? 0);
      if (basis === 'vol') return Number.isFinite(vol) ? vol : 0;
      return (Number.isFinite(oi) ? oi : 0) + (Number.isFinite(vol) ? vol : 0);
    };
    const flipFromGexRows = (gexRows, spot, basis = 'oivol') => {
      if (!Array.isArray(gexRows)) return null;
      const sorted = gexRows.map((r) => { const o = r ?? {}; return { strike: Number(o.strike ?? 0), netGEX: rowNetGex(o, basis) }; }).filter((r) => r.strike > 0 && Number.isFinite(r.netGEX)).sort((a, b) => a.strike - b.strike);
      if (!sorted.length) return null;
      const crossings = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i].netGEX, b = sorted[i + 1].netGEX;
        if (a === 0) { crossings.push(sorted[i].strike); continue; }
        if (b === 0) { crossings.push(sorted[i + 1].strike); continue; }
        if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
          const sA = sorted[i].strike, sB = sorted[i + 1].strike;
          const zero = sA + (sB - sA) * (Math.abs(a) / (Math.abs(a) + Math.abs(b)));
          if (Number.isFinite(zero)) crossings.push(Math.round(zero * 10) / 10);
        }
      }
      if (!crossings.length) return null;
      const best = spot > 0 ? crossings.reduce((bst, c) => (Math.abs(c - spot) < Math.abs(bst - spot) ? c : bst)) : crossings[0];
      return Number.isFinite(best) && best > 0 ? best : null;
    };
    const buildGexLadder = (gexRows, spot, basis = 'oivol') => {
      if (!Array.isArray(gexRows) || !(spot > 0)) return [];
      const rows = gexRows.map((r) => { const o = r ?? {}; return { strike: Number(o.strike ?? 0), netGEX: rowNetGex(o, basis) }; }).filter((r) => r.strike > 0 && Number.isFinite(r.netGEX));
      if (!rows.length) return [];
      rows.sort((a, b) => a.strike - b.strike);
      let atm = 0;
      for (let i = 1; i < rows.length; i++) if (Math.abs(rows[i].strike - spot) < Math.abs(rows[atm].strike - spot)) atm = i;
      const start = Math.max(0, atm - GEX_LADDER_HALF);
      const end = Math.min(rows.length, atm + GEX_LADDER_HALF + 1);
      return rows.slice(start, end).sort((a, b) => b.strike - a.strike).map((r) => ({ strike: r.strike, netGex: r.netGEX / 1e6 }));
    };
    const daysTo = (exp) => Math.ceil((new Date(exp + 'T16:00:00').getTime() - Date.now()) / 86_400_000);
    const legMid = (o) => { if (o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2; if (o.mark > 0) return o.mark; if (o.last > 0) return o.last; return 0; };
    const flattenChain = (json) => {
      const root = json ?? {};
      const data = root.data ?? root;
      const items = Array.isArray(data.items) ? data.items : [];
      const legs = [];
      for (const grp of items) {
        const expiration = String(grp['expiration-date'] ?? grp.expirationDate ?? grp.expiration ?? '');
        const strikes = Array.isArray(grp.strikes) ? grp.strikes : [];
        for (const row of strikes) {
          const strike = Number(row['strike-price'] ?? row.strikePrice ?? row.strike ?? 0);
          if (!(strike > 0)) continue;
          for (const side of ['call', 'put']) {
            const leg = row[side];
            if (!leg) continue;
            legs.push({
              strike, type: side.toUpperCase(),
              bid: Number(leg.bid ?? leg['bid-price'] ?? 0), ask: Number(leg.ask ?? leg['ask-price'] ?? 0),
              mark: Number(leg.mark ?? leg['mark-price'] ?? leg['mid-price'] ?? 0), last: Number(leg.last ?? leg['last-price'] ?? 0),
              iv: Number(leg.iv ?? leg['implied-volatility'] ?? leg.volatility ?? 0),
              dte: Number(leg.dte ?? leg.daysToExpiration ?? (expiration ? daysTo(expiration) : 0)),
              gamma: Math.abs(Number(leg.gamma ?? 0)), oi: Number(leg['open-interest'] ?? leg.openInterest ?? leg.oi ?? 0),
              volume: Number(leg.volume ?? 0), expiration,
            });
          }
        }
      }
      const underlying = Number(data.underlyingPrice ?? data.underlying_price ?? root.underlyingPrice ?? 0);
      return { legs, underlying };
    };
    const computeExpiryGex = (legs, spot, basis = 'oivol') => {
      if (!legs.length || !(spot > 0)) return null;
      const byStrike = new Map();
      for (const l of legs) { if (!(l.strike > 0)) continue; const e = byStrike.get(l.strike) ?? {}; if (l.type === 'CALL') e.call = l; else e.put = l; byStrike.set(l.strike, e); }
      const wt = (leg) => basis === 'vol' ? (leg?.volume ?? 0) : (leg?.oi ?? 0) + (leg?.volume ?? 0);
      const rows = [];
      for (const [strike, s] of byStrike) {
        const callGEX = Math.abs(s.call?.gamma ?? 0) * wt(s.call) * spot * spot;
        const putGEX = -(Math.abs(s.put?.gamma ?? 0) * wt(s.put) * spot * spot);
        rows.push({ strike, netGEX: callGEX + putGEX });
      }
      if (!rows.length) return null;
      rows.sort((a, b) => a.strike - b.strike);
      let cum = 0, prevCum = 0, prevStrike = null, flip = null;
      for (const r of rows) {
        prevCum = cum; cum += r.netGEX;
        if (prevStrike !== null && prevCum < 0 && cum >= 0) { const range = cum - prevCum; flip = Math.abs(range) > 0 ? prevStrike + (r.strike - prevStrike) * (-prevCum / range) : r.strike; break; }
        prevStrike = r.strike;
      }
      const above = rows.filter((r) => r.strike > spot && r.netGEX > 0);
      const below = rows.filter((r) => r.strike < spot && r.netGEX < 0);
      const callWall = above.length ? above.reduce((b, r) => (r.netGEX > b.netGEX ? r : b)).strike : null;
      const putWall = below.length ? below.reduce((b, r) => (r.netGEX < b.netGEX ? r : b)).strike : null;
      const total = rows.reduce((s, r) => s + r.netGEX, 0);
      let atm = 0;
      for (let i = 1; i < rows.length; i++) if (Math.abs(rows[i].strike - spot) < Math.abs(rows[atm].strike - spot)) atm = i;
      const ladder = rows.slice(Math.max(0, atm - GEX_LADDER_HALF), Math.min(rows.length, atm + GEX_LADDER_HALF + 1)).sort((a, b) => b.strike - a.strike).map((r) => ({ strike: r.strike, netGex: r.netGEX / 1e6 }));
      return { ladder, callWall, putWall, gammaFlip: flip, netGex: Number.isFinite(total) && total !== 0 ? total / 1e9 : null };
    };
    const dteToDateLabel = (dte) => { const d = new Date(); d.setDate(d.getDate() + Math.max(0, dte)); return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }); };
    const resolveExpiry = async (dte) => {
      try {
        const r = await ctx.internalFetch(`/proxy/api/tt/expirations/SPX`, { cache: 'no-store' });
        if (!r.ok) return '';
        const json = await r.json();
        const data = json?.data ?? json;
        const raw = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
        const dates = raw.map((d) => { const o = d ?? {}; return String(o['expiration-date'] ?? o.expirationDate ?? o.expiration ?? o.date ?? (typeof d === 'string' ? d : '') ?? ''); }).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)).sort();
        if (!dates.length) return '';
        return dte === 0 ? dates[0] : (dates[1] ?? dates[0]);
      } catch { return ''; }
    };
    const fetchExpiryChain = async (expiration) => {
      try {
        const q = expiration ? `?expiration=${encodeURIComponent(expiration)}` : '';
        const r = await ctx.internalFetch(`/proxy/api/tt/chains/SPX${q}`, { cache: 'no-store' });
        if (!r.ok) return { legs: [], underlying: 0 };
        const { legs, underlying } = flattenChain(await r.json());
        const filtered = expiration ? legs.filter((l) => l.expiration === expiration) : legs;
        return { legs: filtered.length ? filtered : legs, underlying };
      } catch { return { legs: [], underlying: 0 }; }
    };
    const computeExpectedMove = async (spot) => {
      try {
        const r = await ctx.internalFetch(`/proxy/api/tt/chains/SPX`, { cache: 'no-store' });
        if (!r.ok) return { em: null, expiry: null };
        const { legs, underlying } = flattenChain(await r.json());
        if (!legs.length) return { em: null, expiry: null };
        const center = underlying > 0 ? underlying : spot;
        if (!(center > 0)) return { em: null, expiry: null };
        const byDte = new Map();
        for (const l of legs) { const d = Math.max(0, l.dte); if (!byDte.has(d)) byDte.set(d, []); byDte.get(d).push(l); }
        const dtes = [...byDte.keys()].sort((a, b) => a - b);
        if (!dtes.length) return { em: null, expiry: null };
        for (const dte of dtes) {
          const pool = byDte.get(dte);
          const strikes = [...new Set(pool.map((l) => l.strike))].sort((a, b) => Math.abs(a - center) - Math.abs(b - center)).slice(0, 8);
          for (const k of strikes) {
            const c = pool.find((l) => l.strike === k && l.type === 'CALL');
            const p = pool.find((l) => l.strike === k && l.type === 'PUT');
            if (!c || !p) continue;
            const avgIV = (Number(c.iv || 0) + Number(p.iv || 0)) / 2;
            const effDte = c.dte || p.dte || dte;
            let em = 0;
            if (avgIV > 0 && effDte > 0) em = 0.84 * avgIV * center * Math.sqrt(effDte / 365);
            else { const cMid = legMid(c), pMid = legMid(p); if (cMid > 0 && pMid > 0) em = (cMid + pMid) * 0.85; }
            if (Number.isFinite(em) && em > 0) { const emPct = em / center; if (emPct < 0.002 || emPct > 0.25) continue; return { em, expiry: dteToDateLabel(dte) }; }
          }
        }
        return { em: null, expiry: null };
      } catch { return { em: null, expiry: null }; }
    };
    const computeEsOvernight = async () => {
      try {
        const r = await ctx.internalFetch(`/api/snapshots/candles?daysBack=2&limit=2000`, { cache: 'no-store' });
        if (!r.ok) return { high: null, low: null };
        const json = await r.json();
        const rows = Array.isArray(json.rows) ? json.rows : [];
        if (!rows.length) return { high: null, low: null };
        const overnight = rows.filter((row) => { const slot = String(row.slotKey ?? ''); const hhmm = slot.slice(11, 16); if (!hhmm) return false; return hhmm >= '16:00' || hhmm < '09:30'; });
        const pool = overnight.length ? overnight : rows;
        const highs = [], lows = [];
        for (const row of pool) { const hi = Number(row.high), lo = Number(row.low); if (Number.isFinite(hi) && hi > 0) highs.push(hi); if (Number.isFinite(lo) && lo > 0) lows.push(lo); }
        if (!highs.length || !lows.length) return { high: null, low: null };
        return { high: Math.max(...highs), low: Math.min(...lows) };
      } catch { return { high: null, low: null }; }
    };

    const params = new URL(req.url || '/', 'http://localhost').searchParams;
    const dte = params.get('dte') === '1' ? 1 : 0;
    const basis = params.get('gexBasis') === 'vol' ? 'vol' : 'oivol';
    const out = { spxSpot: null, gammaFlip: null, callWall: null, putWall: null, expectedMove: null, expectedMoveExpiry: null, netGex: null, esOvernightHigh: null, esOvernightLow: null, spxPrevClose: null, emUpper: null, emLower: null, gexLadder: [], updatedAt: Date.now() };
    let spotForEm = 0;
    try {
      const r = await ctx.internalFetch(`/proxy/gex`, { cache: 'no-store' });
      if (r.ok) {
        const p = await r.json();
        const spot = Number(p.spot ?? 0);
        out.spxSpot = spot > 0 ? spot : null;
        spotForEm = spot;
        const prevClose = Number(p.prevClose ?? 0);
        out.spxPrevClose = prevClose > 0 ? prevClose : null;
        out.callWall = p.callWall != null ? Number(p.callWall) || null : null;
        out.putWall = p.putWall != null ? Number(p.putWall) || null : null;
        out.gammaFlip = flipFromGexRows(p.gexRows, spot, basis) ?? (p.gexFlip != null ? Number(p.gexFlip) || null : null);
        let totalGex;
        if (basis === 'vol' && Array.isArray(p.gexRows)) totalGex = p.gexRows.reduce((s, r) => s + rowNetGex(r ?? {}, 'vol'), 0);
        else { const totals = p.totals; totalGex = totals ? Number(totals.totalGEXOiVol ?? totals.totalGEX ?? 0) : Number(p.totalNetGex ?? 0); }
        out.netGex = Number.isFinite(totalGex) && totalGex !== 0 ? totalGex / 1e9 : null;
        out.gexLadder = buildGexLadder(p.gexRows, spot, basis);
        if (basis === 'vol' && Array.isArray(p.gexRows) && spot > 0) {
          const vrows = p.gexRows.map((r) => ({ strike: Number(r.strike ?? 0), netGEX: rowNetGex(r, 'vol') })).filter((r) => r.strike > 0 && Number.isFinite(r.netGEX));
          const above = vrows.filter((r) => r.strike > spot && r.netGEX > 0);
          const below = vrows.filter((r) => r.strike < spot && r.netGEX < 0);
          out.callWall = above.length ? above.reduce((b, r) => (r.netGEX > b.netGEX ? r : b)).strike : out.callWall;
          out.putWall = below.length ? below.reduce((b, r) => (r.netGEX < b.netGEX ? r : b)).strike : out.putWall;
        }
      }
    } catch { /* leave nulls */ }
    if (dte === 1) {
      try {
        const expiry = await resolveExpiry(1);
        if (expiry) {
          const { legs, underlying } = await fetchExpiryChain(expiry);
          const spotForGex = out.spxSpot ?? (underlying > 0 ? underlying : spotForEm);
          const gx = computeExpiryGex(legs, spotForGex, basis);
          if (gx) {
            out.gexLadder = gx.ladder;
            if (gx.callWall != null) out.callWall = gx.callWall;
            if (gx.putWall != null) out.putWall = gx.putWall;
            if (gx.gammaFlip != null) out.gammaFlip = gx.gammaFlip;
            if (gx.netGex != null) out.netGex = gx.netGex;
          }
        }
      } catch { /* keep front-expiry values */ }
    }
    const [em, es] = await Promise.all([computeExpectedMove(spotForEm), computeEsOvernight()]);
    out.expectedMove = em.em;
    out.expectedMoveExpiry = em.expiry;
    out.esOvernightHigh = es.high;
    out.esOvernightLow = es.low;
    if (out.spxPrevClose != null && out.expectedMove != null) { out.emUpper = out.spxPrevClose + out.expectedMove; out.emLower = out.spxPrevClose - out.expectedMove; }
    send(res, 200, { data: out }, { 'Cache-Control': NO_STORE });
  },
});

// /api/social-media/trigger-map — bull/base/bear trigger map via Anthropic.
// POST, subscriber. Ported verbatim from app/api/social-media/trigger-map.
register('/api/social-media/trigger-map', {
  auth: 'owner', methods: ['POST'],
  async handler(req, res) {
    const MODEL = 'claude-sonnet-4-6';
    const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
    const SYSTEM_PROMPT = `You are the desk analyst for CB Edge, an SPX gamma-exposure (GEX) and options-flow desk. From a pre-market dealer-positioning read you produce a "trigger map": three scenarios for the session — a bull case, a base case, and a bear case — that a trader can react to off the levels.

VOICE & RULES
- Sharp, trader-to-trader. The reader knows gamma, dealer hedging, call/put walls, gamma flip and expected move. Do not explain basics.
- Concrete and level-driven. Each case must reference the actual numbers given (spot, flip, walls, EM range) and describe a TRIGGER condition (e.g. "accepts above the flip on volume", "loses the put wall on two 5-min closes") plus what dealer positioning implies if it happens.
- Conditional, never promissory. No certainties, no explicit buy/sell advice, no price targets stated as facts.
- The three odds percentages must be whole numbers that sum to exactly 100, and should reflect the regime and where spot sits relative to the flip/walls.
- Keep each description to 1-2 sentences, under ~200 characters.

OUTPUT FORMAT
Return ONLY a single JSON object — no markdown, no code fences, no commentary — with exactly these keys:
{
  "bull": { "odds": number, "desc": string },
  "base": { "odds": number, "desc": string },
  "bear": { "odds": number, "desc": string }
}

Output a SINGLE object with bull/base/bear as keys. Do NOT wrap them in an array and do NOT separate them with "},{". There is exactly one top-level object and one closing brace.`;
    const num = (v, digits = 2) => { if (v == null || !Number.isFinite(v)) return 'n/a'; return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits }); };
    const formatUserMessage = (d) => [
      `CB Edge — SPX pre-market GEX read${d.date ? ` for ${d.date}` : ''}.`, ``,
      `SPX spot: ${num(d.spxSpot)}`, `Gamma flip: ${num(d.gammaFlip)}`, `Call wall (resistance): ${num(d.callWall)}`,
      `Put wall (support): ${num(d.putWall)}`, `Control node (peak gamma magnet): ${num(d.controlNode)}`,
      `Expected move: ±${num(d.expectedMove)}`, `Expected-move range: ${num(d.emLower)} (lower) to ${num(d.emUpper)} (upper)`,
      `Net GEX: ${d.netGex == null ? 'n/a' : `${d.netGex >= 0 ? '+' : ''}${num(d.netGex, 2)}B`}`,
      `Gamma regime: ${d.gammaRegime || 'n/a'}`, `Bias: ${d.bias || 'neutral'}`, ``,
      `Produce the bull / base / bear trigger map from this read. Return the JSON object only.`,
    ].join('\n');
    const clampCase = (o) => { if (!o || typeof o !== 'object') return null; const odds = Number(o.odds); const desc = typeof o.desc === 'string' ? o.desc : ''; if (!desc) return null; return { odds: Number.isFinite(odds) ? Math.round(odds) : 0, desc }; };
    const balancedObjectAt = (text, from) => {
      let depth = 0, inStr = false, esc = false;
      for (let i = from; i < text.length; i++) {
        const ch = text[i];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}' && --depth === 0) return text.slice(from, i + 1);
      }
      return null;
    };
    const recoverByKey = (text) => {
      const out = {};
      for (const key of ['bull', 'base', 'bear']) {
        const k = text.indexOf(`"${key}"`);
        if (k === -1) return null;
        const brace = text.indexOf('{', k);
        if (brace === -1) return null;
        const objStr = balancedObjectAt(text, brace);
        if (!objStr) return null;
        try { const c = clampCase(JSON.parse(objStr)); if (!c) return null; out[key] = c; } catch { return null; }
      }
      const { bull, base, bear } = out;
      if (!bull || !base || !bear) return null;
      const sum = bull.odds + base.odds + bear.odds;
      if (sum > 0 && sum !== 100) { bull.odds = Math.round((bull.odds / sum) * 100); base.odds = Math.round((base.odds / sum) * 100); bear.odds = 100 - bull.odds - base.odds; }
      return { bull, base, bear };
    };
    const extractJson = (raw) => {
      let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const start = text.indexOf('{');
      if (start === -1) return null;
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          if (--depth === 0) {
            try {
              const obj = JSON.parse(text.slice(start, i + 1));
              const bull = clampCase(obj.bull), base = clampCase(obj.base), bear = clampCase(obj.bear);
              if (!bull || !base || !bear) return recoverByKey(text);
              const sum = bull.odds + base.odds + bear.odds;
              if (sum > 0 && sum !== 100) { bull.odds = Math.round((bull.odds / sum) * 100); base.odds = Math.round((base.odds / sum) * 100); bear.odds = 100 - bull.odds - base.odds; }
              return { bull, base, bear };
            } catch { return recoverByKey(text); }
          }
        }
      }
      return null;
    };
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { send(res, 503, { error: 'ANTHROPIC_API_KEY not configured' }); return; }
    let input;
    try { input = await readJson(req); } catch { send(res, 400, { error: 'invalid JSON body' }); return; }
    let r;
    try {
      r = await fetch(ANTHROPIC_URL, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 800, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: formatUserMessage(input) }] }), cache: 'no-store', signal: AbortSignal.timeout(25000),
      });
    } catch (err) { send(res, 502, { error: `anthropic request failed: ${String(err?.message || err)}` }); return; }
    if (!r.ok) { const detail = await r.text().catch(() => ''); send(res, 502, { error: `anthropic ${r.status}`, detail: detail.slice(0, 500) }); return; }
    const payload = await r.json();
    const text = (payload.content ?? []).filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim();
    const parsed = extractJson(text);
    if (!parsed) { send(res, 502, { error: 'model returned unparseable output', raw: text.slice(0, 800) }); return; }
    send(res, 200, { data: parsed }, { 'Cache-Control': NO_STORE });
  },
});

// /api/social-media/day-post — slot-aware X post generator (premarket/midday/
// eod/custom + optional trade idea). POST, subscriber. Ported verbatim.
register('/api/social-media/day-post', {
  auth: 'owner', methods: ['POST'],
  async handler(req, res) {
    const MODEL = 'claude-sonnet-4-6';
    const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
    const SYSTEM_PROMPT = `You are the social-media voice of CB Edge (cbedge.net), an SPX gamma-exposure (GEX) and options-flow desk. You write single X posts at different points of the trading day that turn the live dealer-positioning read into tight, useful market commentary while promoting CB Edge.

VOICE
- Sharp and trader-to-trader. The audience already knows gamma, dealer hedging, call/put walls and expected move. Do not explain basics.
- No hype. No "🚀 to the moon", no clickbait, no emoji spam. At most one tasteful emoji, usually zero.
- Concrete and level-driven. Quote the actual numbers provided (spot, flip, walls, EM, net GEX). Frame them as structure, not predictions.
- Confident but never promissory. Describe what positioning implies, not what WILL happen.
- The attached image (if noted) is from the live CB Edge dashboard — it is fine to reference it ("chart below", "flow tape below") and to note this data streams live on cbedge.net.

POST TYPES
- premarket: the morning read — structure into the open, key levels, regime, what to watch.
- midday: how the session is actually trading vs the morning levels — holds, breaks, pins.
- eod: wrap the session — what the levels did, how the regime played out, tee up tomorrow.
- custom: follow the user's notes for angle and content.

TRADE IDEA (when provided)
- Fold the contract (e.g. $TSLA 420C 7/17) into the post as a LEVELS-BASED watch — "on the radar", "watching", conditional on the structure. NEVER say buy/sell/enter, no targets-as-promises, no PT guarantees.
- When a contract price is given, include it in the post (e.g. "$TSLA 420C 7/17 @ $3.10").

HARD RULES
- Output ONE tweet only, at or under 280 characters INCLUDING cashtags, hashtags, link, and newlines. Be ruthless about length.
- Do NOT write one solid paragraph. Break the tweet into 2-4 short lines with "\\n" (blank line between thoughts is fine): lead line, level/positioning line(s), then hashtags + link on the final line.
- Lead with the primary cashtag ($SPX, or the trade-idea ticker when one is given).
- Include 1-3 relevant hashtags (#SPX #0DTE #gamma #options #trading) where natural — do not stuff.
- End the tweet with the link: https://www.cbedge.net/
- Do NOT include any disclaimer. No "not financial advice", no "educational only", no "idea, not advice".
- Use the provided bias as the directional lean, kept conditional on the levels.

OUTPUT FORMAT
Return ONLY a single JSON object, no markdown, no code fences, no commentary:
{
  "xPost": string
}`;
    const SLOT_LABEL = { premarket: 'PREMARKET ANALYSIS', midday: 'MIDDAY UPDATE', eod: 'END-OF-DAY SUMMARY', custom: 'CUSTOM POST' };
    const VISUAL_LABEL = {
      gex: 'live NET GEX profile chart', flow: 'live options-flow tape', chain: 'live options chain',
      greeks: 'multi-expiry greeks dashboard',
      candles: 'ES 5-minute candle chart with the GEX levels overlaid — good for walking through how the session traded the levels',
    };
    const num = (v, digits = 2) => { if (v == null || !Number.isFinite(v)) return 'n/a'; return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits }); };
    const formatUserMessage = (d) => {
      const slot = d.slot && d.slot in SLOT_LABEL ? d.slot : 'premarket';
      const lines = [
        `Post type: ${SLOT_LABEL[slot]}`,
        d.visual && VISUAL_LABEL[d.visual] ? `Attached image: a ${VISUAL_LABEL[d.visual]} screenshot from the CB Edge dashboard.` : `Attached image: none.`, ``,
        `SPX spot: ${num(d.spxSpot)}`, `SPX prior-day close: ${num(d.spxPrevClose)}`, `Gamma flip: ${num(d.gammaFlip)}`,
        `Call wall: ${num(d.callWall)}`, `Put wall: ${num(d.putWall)}`, `Expected move: ±${num(d.expectedMove)}`,
        `EM range (off prior close): ${num(d.emLower)} to ${num(d.emUpper)}`,
        `Net GEX: ${d.netGex == null ? 'n/a' : `${d.netGex >= 0 ? '+' : ''}${num(d.netGex, 2)}B`}`,
        `Gamma regime: ${d.gammaRegime || 'n/a'}`, `Bias: ${d.bias || 'neutral'}`,
      ];
      const t = d.tradeIdea;
      if (t && (t.ticker || t.strike)) {
        const right = (t.right || 'C').toUpperCase() === 'P' ? 'P' : 'C';
        lines.push(``, `TRADE IDEA to fold in: $${(t.ticker || 'SPX').toUpperCase()} ${t.strike || '?'}${right}${t.expiration ? ` exp ${t.expiration}` : ''}${t.price ? ` @ $${t.price}` : ''}${t.note ? ` — ${t.note}` : ''}`);
      }
      if (d.notes) lines.push(``, `User notes / angle: ${d.notes}`);
      lines.push(``, `Write the single ${SLOT_LABEL[slot].toLowerCase()} tweet from this. Return the JSON object only.`);
      return lines.join('\n');
    };
    const extractJson = (raw) => {
      let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const start = text.indexOf('{');
      if (start === -1) return null;
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { try { const obj = JSON.parse(text.slice(start, i + 1)); const xPost = typeof obj.xPost === 'string' ? obj.xPost : ''; return xPost ? { xPost } : null; } catch { return null; } } }
      }
      return null;
    };
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { send(res, 503, { error: 'ANTHROPIC_API_KEY not configured' }); return; }
    let input;
    try { input = await readJson(req); } catch { send(res, 400, { error: 'invalid JSON body' }); return; }
    let r;
    try {
      r = await fetch(ANTHROPIC_URL, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 800, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: formatUserMessage(input) }] }), cache: 'no-store',
      });
    } catch (err) { send(res, 502, { error: `anthropic request failed: ${String(err?.message || err)}` }); return; }
    if (!r.ok) { const detail = await r.text().catch(() => ''); send(res, 502, { error: `anthropic ${r.status}`, detail: detail.slice(0, 500) }); return; }
    const payload = await r.json();
    const text = (payload.content ?? []).filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim();
    const parsed = extractJson(text);
    if (!parsed) { send(res, 502, { error: 'model returned unparseable output', raw: text.slice(0, 800) }); return; }
    send(res, 200, { data: parsed }, { 'Cache-Control': NO_STORE });
  },
});

// /api/social-media/generate — pre-market GEX read → single tweet via Anthropic.
// POST, subscriber. Ported verbatim from app/api/social-media/generate/route.ts.
register('/api/social-media/generate', {
  auth: 'owner', methods: ['POST'],
  async handler(req, res) {
    const MODEL = 'claude-sonnet-4-6';
    const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
    const SYSTEM_PROMPT = `You are the social-media voice of CB Edge, an SPX gamma-exposure (GEX) and options-flow desk. You write a single pre-market tweet that turns the morning dealer-positioning read into tight, useful market commentary.

VOICE
- Sharp and trader-to-trader. You are talking to people who already know what gamma, dealer hedging, call/put walls and expected move are. Do not explain the basics.
- No hype. No "🚀 to the moon", no clickbait, no emoji spam. At most one tasteful emoji, and usually zero.
- Concrete and level-driven. Reference the actual numbers you are given (spot, flip, walls, expected move, net GEX). Frame them as structure, not predictions.
- Confident but never promissory. Describe what the positioning implies, not what WILL happen.

HARD RULES
- Output ONE tweet only, at or under 280 characters INCLUDING the ticker, hashtags, and link. Be ruthless about length.
- Lead with the $SPX cashtag.
- Include 1-3 relevant hashtags (e.g. #SPX #0DTE #gamma #options #trading) where they fit naturally — do not stuff.
- End the tweet with the link: https://www.cbedge.net/
- Do NOT include any disclaimer line. No "not financial advice", no "educational only".
- Use the bias provided as the directional lean, but keep it conditional on the levels.

OUTPUT FORMAT
Return ONLY a single JSON object, no markdown, no code fences, no commentary, with exactly this key:
{
  "xPost": string   // one standalone tweet, <=280 chars total, leads with $SPX, includes hashtags and ends with https://www.cbedge.net/
}`;
    const num = (v, digits = 2) => { if (v == null || !Number.isFinite(v)) return 'n/a'; return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits }); };
    const formatUserMessage = (d) => [
      `CB Edge — SPX pre-market GEX read${d.date ? ` for ${d.date}` : ''}.`, ``,
      `SPX spot: ${num(d.spxSpot)}`, `SPX prior-day close: ${num(d.spxPrevClose)}`,
      `Gamma flip: ${num(d.gammaFlip)}`, `Call wall: ${num(d.callWall)}`, `Put wall: ${num(d.putWall)}`,
      `Expected move (ATM straddle): ±${num(d.expectedMove)}${d.expectedMoveExpiry ? ` (exp ${d.expectedMoveExpiry})` : ''}`,
      `Expected-move range (off the prior close): ${num(d.emLower)} (lower) to ${num(d.emUpper)} (upper) — these are the EM levels; cite them as the expected range, anchored to the ${num(d.spxPrevClose)} prior close.`,
      `Net GEX: ${d.netGex == null ? 'n/a' : `${d.netGex >= 0 ? '+' : ''}${num(d.netGex, 2)}B`}`,
      `ES overnight high: ${num(d.esOvernightHigh)}`, `ES overnight low: ${num(d.esOvernightLow)}`,
      `Gamma regime: ${d.gammaRegime || 'n/a'}`, `Bias: ${d.bias || 'neutral'}`, ``,
      `Write the single pre-market tweet from this read. Return the JSON object only.`,
    ].join('\n');
    const extractJson = (raw) => {
      let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const start = text.indexOf('{');
      if (start === -1) return null;
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              const obj = JSON.parse(text.slice(start, i + 1));
              const xPost = typeof obj.xPost === 'string' ? obj.xPost : '';
              const discordDrop = typeof obj.discordDrop === 'string' ? obj.discordDrop : '';
              const xThread = Array.isArray(obj.xThread) ? obj.xThread.filter((t) => typeof t === 'string') : [];
              if (!xPost && !discordDrop && !xThread.length) return null;
              return { xPost, xThread, discordDrop };
            } catch { return null; }
          }
        }
      }
      return null;
    };
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { send(res, 503, { error: 'ANTHROPIC_API_KEY not configured' }); return; }
    let input;
    try { input = await readJson(req); } catch { send(res, 400, { error: 'invalid JSON body' }); return; }
    const userMessage = formatUserMessage(input);
    let r;
    try {
      r = await fetch(ANTHROPIC_URL, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userMessage }] }), cache: 'no-store',
      });
    } catch (err) { send(res, 502, { error: `anthropic request failed: ${String(err?.message || err)}` }); return; }
    if (!r.ok) { const detail = await r.text().catch(() => ''); send(res, 502, { error: `anthropic ${r.status}`, detail: detail.slice(0, 500) }); return; }
    const payload = await r.json();
    const text = (payload.content ?? []).filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim();
    const parsed = extractJson(text);
    if (!parsed) { send(res, 502, { error: 'model returned unparseable output', raw: text.slice(0, 800) }); return; }
    send(res, 200, { data: parsed }, { 'Cache-Control': NO_STORE });
  },
});

// /api/tpo-extract — read TPO/Market-Profile levels off a chart screenshot via
// Claude vision. POST, subscriber. Ported verbatim from app/api/tpo-extract.
register('/api/tpo-extract', {
  auth: 'owner', methods: ['POST'],
  async handler(req, res) {
    const MODEL = 'claude-sonnet-4-6';
    const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
    const SYSTEM_PROMPT = `You extract price levels from a futures TPO / Market Profile chart screenshot. Each vertical letter/volume profile is one trading session, laid out left-to-right, with its date on the x-axis below it.

Each profile is labeled with some of these markers next to horizontal price levels:
- H = session high
- L = session low
- P = POC / point of control (usually orange, with a horizontal ray)
- M = profile mid
- VAH / VAL = value-area high / low, when drawn
Prices are futures quotes with .00/.25/.50/.75 tick precision.

RULES
- Read EVERY distinct profile in the image, in left-to-right order — one output row each.
- For each, report only the values you can actually read. If a marker is not present or is unreadable, use null — never guess a digit.
- date: read the x-axis tick nearest that profile. Return it exactly as shown (e.g. "07/09"). If you truly cannot tell, use null.
- Do not invent VAH/VAL if the chart doesn't draw them.
- If two labels overlap and you are unsure which profile a value belongs to, put your best read and add a short note.

OUTPUT
Return ONLY a JSON object, no markdown, no code fences, exactly:
{ "rows": [ { "date": string|null, "high": number|null, "low": number|null, "poc": number|null, "vah": number|null, "val": number|null, "mid": number|null, "note": string|null } ] }`;
    const parseDataUrl = (dataUrl) => {
      const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
      if (!m) return null;
      const mediaType = m[1] === 'image/jpg' ? 'image/jpeg' : m[1];
      return { mediaType, data: m[3] };
    };
    const extractJson = (text) => {
      const start = text.indexOf('{');
      if (start < 0) return null;
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              const obj = JSON.parse(text.slice(start, i + 1));
              if (!Array.isArray(obj.rows)) return null;
              const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
              const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
              const rows = obj.rows.map((r) => { const o = r ?? {}; return { date: str(o.date), high: num(o.high), low: num(o.low), poc: num(o.poc), vah: num(o.vah), val: num(o.val), mid: num(o.mid), note: str(o.note) }; });
              return { rows };
            } catch { return null; }
          }
        }
      }
      return null;
    };
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { send(res, 503, { error: 'ANTHROPIC_API_KEY not configured' }); return; }
    let body;
    try { body = await readJson(req); } catch { send(res, 400, { error: 'invalid JSON body' }); return; }
    const img = typeof body.image === 'string' ? parseDataUrl(body.image) : null;
    if (!img) { send(res, 400, { error: 'body.image must be a base64 data URL (png/jpeg/webp)' }); return; }
    const hint = `Extract the TPO levels from this chart.` + (body.symbol ? ` Instrument: ${body.symbol}.` : '') + (body.year ? ` If a date shows only MM/DD, assume year ${body.year}.` : '');
    let r;
    try {
      r = await fetch(ANTHROPIC_URL, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 4000, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } }, { type: 'text', text: hint }] }] }),
        cache: 'no-store',
      });
    } catch (err) { send(res, 502, { error: `anthropic request failed: ${String(err?.message || err)}` }); return; }
    if (!r.ok) { const detail = await r.text().catch(() => ''); send(res, 502, { error: `anthropic ${r.status}`, detail: detail.slice(0, 500) }); return; }
    const payload = await r.json();
    const text = (payload.content ?? []).filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim();
    const parsed = extractJson(text);
    if (!parsed) { send(res, 502, { error: 'model returned unparseable output', raw: text.slice(0, 800) }); return; }
    send(res, 200, { rows: parsed.rows }, { 'Cache-Control': NO_STORE });
  },
});

// /api/budget/parse-screenshot — owner-only transaction OCR via Claude vision.
// Ported verbatim from app/api/budget/parse-screenshot/route.ts (getServerUserId
// gate → enforceAuth 'owner').
register('/api/budget/parse-screenshot', {
  auth: 'owner', methods: ['POST'],
  async handler(req, res) {
    const MODEL = 'claude-haiku-4-5-20251001';
    const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
    const SYSTEM = `You extract bank or credit-card transactions from a screenshot image.
Return ONLY a JSON array, no prose, no code fences. Each element:
{"date":"YYYY-MM-DD","description":string,"amount":number,"direction":"in"|"out"}
Rules:
- amount is ALWAYS a positive number: no sign, no currency symbol, no thousands separators.
- direction is "out" for purchases, payments, debits, withdrawals, fees; "in" for deposits, credits, payroll, refunds, transfers received.
- If a row shows no year, assume ${new Date().getFullYear()}.
- Keep description short and human (merchant or payee); strip long reference/auth numbers.
- Skip running-balance columns, section headers, and totals. If you can read no transactions, return [].`;
    const extractRows = (text) => {
      if (!text) return [];
      const start = text.indexOf('[');
      const end = text.lastIndexOf(']');
      if (start === -1 || end === -1 || end < start) return [];
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (!Array.isArray(parsed)) return [];
        return parsed.map((r) => ({ date: String(r?.date ?? '').slice(0, 10), description: String(r?.description ?? '').slice(0, 80), amount: Math.abs(Number(r?.amount ?? 0)), direction: r?.direction === 'in' ? 'in' : 'out' }))
          .filter((r) => r.date && r.description && Number.isFinite(r.amount) && r.amount > 0);
      } catch { return []; }
    };
    try {
      if (!process.env.ANTHROPIC_API_KEY) { send(res, 500, { error: "Screenshot import isn't configured (missing ANTHROPIC_API_KEY)." }); return; }
      const { imageBase64, mediaType } = await readJson(req);
      if (!imageBase64) { send(res, 400, { error: 'No image provided.' }); return; }
      const r = await fetch(ANTHROPIC_URL, {
        method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 2000, system: SYSTEM, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: String(mediaType || 'image/png'), data: String(imageBase64) } }, { type: 'text', text: 'Extract every transaction you can read from this screenshot. Return only the JSON array.' }] }] }),
      });
      if (!r.ok) { const detail = await r.text(); send(res, 502, { error: 'Vision request failed', detail }); return; }
      const data = await r.json();
      const text = data?.content?.[0]?.text ?? '';
      send(res, 200, { rows: extractRows(text) });
    } catch (err) { send(res, 500, { error: 'Parse failed', detail: String(err) }); }
  },
});

// /api/strike-summary — 1-2 sentence GEX blurb per strike via Anthropic (Haiku).
// POST, subscriber. Ported verbatim from app/api/strike-summary/route.ts.
register('/api/strike-summary', {
  auth: 'subscriber', methods: ['POST'],
  async handler(req, res) {
    const MODEL = 'claude-haiku-4-5-20251001';
    const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
    const SYSTEM = `You are CB Edge, an SPX GEX desk. Write exactly 1-2 sentences about this strike level. Format: "[strike] is a [CB/support/resistance/flip] level. [What price should do here based on net GEX — reach/pivot/pin/amplify]." Be blunt and specific. Use the actual numbers. No disclaimers, no fluff. Example tone: "7540 CB level here. Market should reach or pivot if net GEX stays positive."`;
    try {
      const { strike, spotPrice, oiVolGex, volGex, otmSide, otmPrice } = await readJson(req);
      const user = `Strike: ${strike} | SPX Spot: ${spotPrice}\nOI+Vol GEX: ${oiVolGex} | Vol GEX: ${volGex}\nOTM ${otmSide} contract: ${otmPrice ?? 'N/A'}`;
      const r = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 120, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
      });
      if (!r.ok) { send(res, 200, { summary: null }); return; }
      const data = await r.json();
      const summary = data?.content?.[0]?.text?.trim() ?? null;
      send(res, 200, { summary });
    } catch { send(res, 200, { summary: null }); }
  },
});

// /api/premarket-movers — top-5 up/down across the trading watchlist via
// in-process /proxy/quotes (extended-hours aware). Ported verbatim from
// app/api/premarket-movers/route.ts.
register('/api/premarket-movers', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res, ctx) {
    const WATCHLIST = [
      'AAPL', 'AMD', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'SPCX', 'TSLA',
      'AAPU', 'ASTS', 'AVGO', 'BYND', 'CMG', 'COIN', 'CWVX', 'ETHA', 'FBL', 'FIG',
      'GME', 'HIMZ', 'HOOD', 'IBIT', 'LLYX', 'MSFU', 'NFLX', 'NOK', 'NVDX', 'OSCR',
      'PLTR', 'PONY', 'QBTS', 'QUBT', 'RGTI', 'RIVN', 'SLV', 'SMCI', 'SOFI', 'SOUN',
      'SOXL', 'TQQQ', 'TSLL', 'UUUU',
      'ABNB', 'AFRM', 'ARM', 'BA', 'BABA', 'CCJ', 'CHWY', 'COST', 'CRCL', 'CRM',
      'CRWD', 'CRWV', 'DJT', 'FDX', 'GS', 'HIMS', 'INTC', 'IREN', 'IWM', 'LAC',
      'LLY', 'MA', 'MARA', 'MCD', 'MRK', 'MRNA', 'MU', 'NIO', 'NKE', 'NNE',
      'NXE', 'OKLO', 'OPEN', 'OXY', 'PDD', 'PFE', 'PTON', 'RBLX', 'RIOT', 'RKLB',
      'ROKU', 'SE', 'SMH', 'SNDK', 'SNOW', 'TGT', 'TSM', 'TTD', 'U', 'UNH',
      'UPS', 'UPST', 'V', 'XPEV', 'XYZ',
    ];
    const isExtendedHours = () => {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
      const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
      const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
      const mins = h * 60 + m;
      return mins < 570 || mins >= 960;
    };
    try {
      const r = await ctx.internalFetch(`/proxy/quotes?symbols=${encodeURIComponent(WATCHLIST.join(','))}`, { cache: 'no-store' });
      if (!r.ok) { send(res, 502, { error: `quotes proxy returned ${r.status}` }); return; }
      const j = await r.json();
      const items = j?.data?.items ?? [];
      const extended = isExtendedHours();
      const ranked = items.map((q) => {
        const current = q.mark || q.last || 0;
        const base = q.prevClose || q.close || 0;
        if (!current || !base) return null;
        const change = current - base;
        const pct = (change / base) * 100;
        return { symbol: q.symbol, name: q.symbol, price: current, change, pct, preMarketPrice: extended ? current : null, preMarketPct: extended ? pct : null, volume: null };
      }).filter((m) => m !== null).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
      const up = ranked.slice(0, 5);
      const down = ranked.slice(-5).reverse();
      const seen = new Set();
      const movers = [...up, ...down].filter((m) => (seen.has(m.symbol) ? false : seen.add(m.symbol)));
      send(res, 200, { movers, up, down, updatedAt: Date.now() }, { 'Cache-Control': NO_STORE });
    } catch (err) { send(res, 500, { error: 'Fetch failed', detail: String(err) }); }
  },
});

// /api/owner/theta-stats — owner-only theta-terminal container metrics via the
// docker-socket-proxy sidecar. Ported verbatim from app/api/owner/theta-stats/
// route.ts; enforceAuth 'owner' replaces the getServerUserId/OWNER_USER_ID gate
// (still fails closed).
register('/api/owner/theta-stats', {
  auth: 'owner', methods: ['GET'],
  async handler(req, res) {
    const DOCKER_PROXY_URL = (process.env.DOCKER_PROXY_URL || 'http://docker-proxy:2375').trim();
    const CONTAINER = 'theta-terminal';
    const cpuPercent = (s) => {
      const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
      const sysDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
      const cpus = s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1;
      if (sysDelta <= 0 || cpuDelta < 0) return null;
      return (cpuDelta / sysDelta) * cpus * 100;
    };
    try {
      const [statsRes, inspectRes] = await Promise.all([
        fetch(`${DOCKER_PROXY_URL}/containers/${CONTAINER}/stats?stream=false`, { cache: 'no-store' }),
        fetch(`${DOCKER_PROXY_URL}/containers/${CONTAINER}/json`, { cache: 'no-store' }),
      ]);
      if (!statsRes.ok || !inspectRes.ok) { send(res, 502, { ok: false, error: `docker-proxy returned ${statsRes.status}/${inspectRes.status}` }); return; }
      const stats = await statsRes.json();
      const inspect = await inspectRes.json();
      const memUsageRaw = stats.memory_stats.usage ?? 0;
      const cache = stats.memory_stats.stats?.cache ?? stats.memory_stats.stats?.inactive_file ?? 0;
      const memUsage = Math.max(memUsageRaw - cache, 0);
      const memLimit = stats.memory_stats.limit ?? 0;
      send(res, 200, {
        ok: true, container: CONTAINER, cpuPercent: cpuPercent(stats),
        memUsageBytes: memUsage, memLimitBytes: memLimit,
        memPercent: memLimit > 0 ? (memUsage / memLimit) * 100 : null,
        pids: stats.pids_stats?.current ?? null,
        status: inspect.State?.Status ?? 'unknown',
        health: inspect.State?.Health?.Status ?? null,
        restarting: inspect.State?.Restarting ?? false,
        oomKilled: inspect.State?.OOMKilled ?? false,
        startedAt: inspect.State?.StartedAt ?? null,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) { send(res, 500, { ok: false, error: 'theta-stats fetch failed', detail: String(err) }); }
  },
});

// /api/debug-gex — legacy 501 stub (GET+POST). Ported verbatim.
register('/api/debug-gex', {
  auth: 'subscriber', methods: ['GET', 'POST'],
  async handler(req, res) { send(res, 501, { error: 'not implemented' }); },
});

// /api/dxlink/candles?symbol&interval — weekly OHLC forwarder to the proxy's
// TT history endpoint. Ported verbatim from app/api/dxlink/candles/route.ts.
register('/api/dxlink/candles', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res, ctx) {
    const sp = new URL(req.url || '/', 'http://localhost').searchParams;
    const symbol = (sp.get('symbol') || '').trim();
    if (!symbol) {
      const r = await forwardGet(ctx, '/proxy/api/tt/market-data/history/');
      send(res, r.status, r.body, { 'Cache-Control': NO_STORE });
      return;
    }
    const interval = sp.get('interval') || '1Week';
    const r = await forwardGet(ctx, `/proxy/api/tt/market-data/history/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}`);
    send(res, r.status, r.body, { 'Cache-Control': NO_STORE });
  },
});

// /api/quotes-batch — batch day-change quotes + optional sparkline (Yahoo v8).
// Pure fetch, no DB. Ported verbatim from app/api/quotes-batch/route.ts.
register('/api/quotes-batch', {
  auth: 'subscriber', methods: ['GET'],
  async handler(req, res) {
    const toYahoo = (sym) => {
      const s = sym.trim().toUpperCase();
      if (s === 'SPX' || s === '$SPX') return '^GSPC';
      if (s === 'VIX') return '^VIX';
      if (s === 'NDX') return '^NDX';
      if (s === 'RUT') return '^RUT';
      if (s.startsWith('/ES')) return 'ES=F';
      if (s.startsWith('/NQ')) return 'NQ=F';
      if (s.startsWith('/')) return s.slice(1) + '=F';
      return s;
    };
    const nyOffsetMinutes = (d) => {
      const s = d.toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' });
      const m = s.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
      if (!m) return -300;
      const h = parseInt(m[1], 10); const mm = m[2] ? parseInt(m[2], 10) : 0;
      return h * 60 + (h < 0 ? -mm : mm);
    };
    const YH_HEADERS = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9',
      Origin: 'https://finance.yahoo.com', Referer: 'https://finance.yahoo.com/',
    };
    async function fetchSpark(yahooSym) {
      const now = new Date(); const off = nyOffsetMinutes(now);
      const etMs = now.getTime() + off * 60_000; const etDate = new Date(etMs);
      const etMin = etDate.getUTCHours() * 60 + etDate.getUTCMinutes();
      const OPEN = 9 * 60 + 30, CLOSE = 16 * 60;
      const session = etMin >= OPEN && etMin < CLOSE ? 'REG' : 'EXT';
      const etMidnightUtcMs = Date.UTC(etDate.getUTCFullYear(), etDate.getUTCMonth(), etDate.getUTCDate()) - off * 60_000;
      const at = (mins) => Math.floor((etMidnightUtcMs + mins * 60_000) / 1000);
      const preStart = at(20 * 60) - 86_400; const rthStart = at(OPEN);
      try {
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=5m&range=2d&includePrePost=true`;
        const r = await fetch(url, { headers: YH_HEADERS, cache: 'no-store' });
        if (!r.ok) return { sparkPre: [], sparkRth: [], session };
        const data = await r.json();
        const result = data?.chart?.result?.[0];
        const ts = result?.timestamp ?? [];
        const closes = result?.indicators?.quote?.[0]?.close ?? [];
        const sparkPre = [], sparkRth = [];
        for (let i = 0; i < closes.length; i++) {
          const c = closes[i], t = ts[i];
          if (typeof c !== 'number' || !Number.isFinite(c) || typeof t !== 'number') continue;
          if (t >= preStart && t < rthStart) sparkPre.push(c);
          else if (t >= rthStart) sparkRth.push(c);
        }
        const ds = (arr, max = 24) => {
          if (arr.length <= max) return arr;
          const step = arr.length / max; const out = [];
          for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
          out.push(arr[arr.length - 1]); return out;
        };
        return { sparkPre: ds(sparkPre), sparkRth: ds(sparkRth), session };
      } catch { return { sparkPre: [], sparkRth: [], session }; }
    }
    async function fetchOne(yahooSym, withSpark = false) {
      try {
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=5d&includePrePost=true`;
        const r = await fetch(url, { headers: YH_HEADERS, cache: 'no-store' });
        if (!r.ok) return { price: null, prevClose: null, change: null, pct: null };
        const data = await r.json();
        const result = data?.chart?.result?.[0];
        const meta = result?.meta;
        if (!meta) return { price: null, prevClose: null, change: null, pct: null };
        const closes = result?.indicators?.quote?.[0]?.close;
        const validCloses = Array.isArray(closes) ? closes.filter((v) => typeof v === 'number' && Number.isFinite(v)) : [];
        const lastClose = validCloses.length ? validCloses[validCloses.length - 1] : null;
        const seriesPrevClose = validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null;
        const price =
          (meta.marketState === 'PRE' && typeof meta.preMarketPrice === 'number' ? meta.preMarketPrice : null) ??
          ((meta.marketState === 'POST' || meta.marketState === 'POSTPOST') && typeof meta.postMarketPrice === 'number' ? meta.postMarketPrice : null) ??
          meta.regularMarketPrice ?? lastClose ?? null;
        const prevClose = seriesPrevClose ?? meta.regularMarketPreviousClose ?? meta.previousClose ?? meta.chartPreviousClose ?? null;
        const change = price != null && prevClose != null ? price - prevClose : null;
        const pct = change != null && prevClose ? (change / prevClose) * 100 : null;
        const sp = withSpark ? await fetchSpark(yahooSym) : undefined;
        return { price, prevClose, change, pct, sparkPre: sp?.sparkPre, sparkRth: sp?.sparkRth, session: sp?.session };
      } catch { return { price: null, prevClose: null, change: null, pct: null }; }
    }
    const url0 = new URL(req.url || '/', 'http://localhost');
    const symbols = url0.searchParams.get('symbols') || '';
    const withSpark = url0.searchParams.get('spark') === '1';
    if (!symbols) { send(res, 200, { data: { items: [] } }); return; }
    const syms = symbols.split(',').map((s) => s.trim()).filter(Boolean);
    const pairs = syms.map((sym) => ({ sym, yahoo: toYahoo(sym) }));
    const uniqueYahoo = [...new Set(pairs.map((p) => p.yahoo))];
    const fetched = await Promise.all(uniqueYahoo.map((y) => fetchOne(y, withSpark).then((q) => [y, q])));
    const byYahoo = new Map(fetched);
    const items = pairs.map(({ sym, yahoo }) => {
      const q = byYahoo.get(yahoo) ?? { price: null, prevClose: null, change: null, pct: null };
      return {
        symbol: sym, last: q.price, 'prev-close': q.prevClose, change: q.change, 'percent-change': q.pct,
        ...(withSpark ? { sparkPre: q.sparkPre ?? [], sparkRth: q.sparkRth ?? [], session: q.session ?? 'REG' } : {}),
      };
    });
    send(res, 200, { data: { items } }, { 'Cache-Control': NO_STORE });
  },
});

// /api/scanner/market-quality — Market Quality Terminal (5-pillar global score
// from Yahoo daily closes). Pure compute, GET-only, subscriber. Ported verbatim
// from app/api/scanner/market-quality/route.ts.
{
  const SECTORS = ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLC', 'XLU', 'XLRE', 'XLY', 'XLB', 'XLP'];
  const SECTOR_NAMES = {
    XLK: 'Technology', XLF: 'Financials', XLE: 'Energy', XLV: 'Health Care',
    XLI: 'Industrials', XLC: 'Comm Services', XLU: 'Utilities', XLRE: 'Real Estate',
    XLY: 'Cons. Discretionary', XLB: 'Materials', XLP: 'Cons. Staples',
  };
  const FOMC_DATES_2026 = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09'];
  const FED_STANCE = { stance: 'Hold', range: '3.50-3.75%' };
  const GEOPOLITICAL = null;
  const yahooUrl = (sym, range) => `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}&includePrePost=false`;
  const fetchSeries = async (sym, range = '1y') => {
    const empty = { closes: [], last: null };
    try {
      const res = await fetch(yahooUrl(sym, range), { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9', Origin: 'https://finance.yahoo.com', Referer: 'https://finance.yahoo.com/' }, cache: 'no-store' });
      if (!res.ok) return empty;
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      const meta = result?.meta;
      if (!meta) return empty;
      const raw = result?.indicators?.quote?.[0]?.close;
      const closes = Array.isArray(raw) ? raw.filter((v) => typeof v === 'number' && Number.isFinite(v)) : [];
      const last = meta.regularMarketPrice ?? (closes.length ? closes[closes.length - 1] : null);
      return { closes, last };
    } catch { return empty; }
  };
  const sma = (closes, period) => { if (closes.length < period) return null; const slice = closes.slice(-period); return slice.reduce((a, b) => a + b, 0) / slice.length; };
  const pctChangeN = (closes, n) => { if (closes.length < n + 1) return null; const then = closes[closes.length - 1 - n]; const now = closes[closes.length - 1]; if (!then) return null; return ((now - then) / then) * 100; };
  const rsi14 = (closes) => {
    const period = 14;
    if (closes.length < period + 1) return null;
    const slice = closes.slice(-(period + 1));
    let gains = 0, losses = 0;
    for (let i = 1; i < slice.length; i++) { const diff = slice[i] - slice[i - 1]; if (diff >= 0) gains += diff; else losses -= diff; }
    const avgGain = gains / period, avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round1 = (v) => Math.round(v * 10) / 10;
  const round2 = (v) => Math.round(v * 100) / 100;
  const etDateStr2 = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  register('/api/scanner/market-quality', {
    auth: 'subscriber', methods: ['GET'],
    async handler(req, res) {
      const symbols = ['SPY', 'QQQ', '^VIX', 'TLT', 'UUP', '^TNX', 'DX-Y.NYB', ...SECTORS];
      const seriesList = await Promise.all(symbols.map((s) => fetchSeries(s, '1y')));
      const bySym = {};
      symbols.forEach((s, i) => { bySym[s] = seriesList[i]; });
      const spy = bySym['SPY'], qqq = bySym['QQQ'], vix = bySym['^VIX'], tlt = bySym['TLT'], uup = bySym['UUP'];
      const tnx = bySym['^TNX'], dxy = bySym['DX-Y.NYB'];
      const haveCore = spy.last != null && vix.last != null;
      if (!haveCore) { send(res, 503, { error: 'quote fetch failed' }); return; }
      const vixSpot = vix.last;
      const vix5dChg = pctChangeN(vix.closes, 5) ?? 0;
      let ivPercentile = null;
      if (vix.closes.length > 20) { const hist = vix.closes; const below = hist.filter((v) => v < vixSpot).length; ivPercentile = (below / hist.length) * 100; }
      const levelScore = clamp(100 - (vixSpot - 10) * 4, 0, 100);
      const trendScoreVix = clamp(50 - vix5dChg * 3, 0, 100);
      const pctileScore = clamp(100 - (ivPercentile ?? 50), 0, 100);
      const volatilityScore = Math.round(0.4 * levelScore + 0.3 * trendScoreVix + 0.3 * pctileScore);
      const vixTrendLabel = vix5dChg > 3 ? 'Rising' : vix5dChg < -3 ? 'Falling' : vix5dChg < -0.5 ? 'Cooling' : 'Flat';
      const vixLevelLabel = vixSpot >= 30 ? 'Very High' : vixSpot >= 22 ? 'High' : vixSpot >= 15 ? 'Normal' : 'Low';
      const iv1yLabel = ivPercentile == null ? '—' : ivPercentile >= 75 ? 'Elevated' : ivPercentile >= 40 ? 'Normal' : 'Low';
      const putCallProxy = round2(clamp(0.65 + (vixSpot - 14) * 0.024, 0.5, 1.6));
      const putCallLabel = putCallProxy >= 1.1 ? 'Fear elevated' : putCallProxy >= 0.85 ? 'Neutral' : 'Complacent';
      const spySma20 = sma(spy.closes, 20), spySma50 = sma(spy.closes, 50), spySma200 = sma(spy.closes, 200);
      const qqqSma50 = sma(qqq.closes, 50);
      const spyLast = spy.last;
      const qqqLast = qqq.last;
      const spy20Pts = spySma20 != null ? (spyLast > spySma20 ? 10 : -10) : 0;
      const spy50Pts = spySma50 != null ? (spyLast > spySma50 ? 15 : -15) : 0;
      const spy200Pts = spySma200 != null ? (spyLast > spySma200 ? 20 : -20) : 0;
      const qqq50Pts = qqqSma50 != null && qqqLast != null ? (qqqLast > qqqSma50 ? 15 : -15) : 0;
      const rsi = rsi14(spy.closes);
      const rsiPts = rsi != null ? clamp((rsi - 50) * 1.0, -20, 20) : 0;
      const trendScore = Math.round(clamp(50 + spy20Pts + spy50Pts + spy200Pts + qqq50Pts + rsiPts, 0, 100));
      const spyBull50 = spySma50 != null && spyLast > spySma50;
      const spyBull200 = spySma200 != null && spyLast > spySma200;
      const trendRegime = spyBull200 && spyBull50 ? 'Bullish' : !spyBull200 && !spyBull50 ? 'Bearish' : 'Mixed';
      const sectorSeries = SECTORS.map((sym) => ({ sym, s: bySym[sym] }));
      const sectorBreadth = sectorSeries.map(({ sym, s }) => { const sma50 = sma(s.closes, 50); const above = sma50 != null && s.last != null ? s.last > sma50 : null; return { sym, above }; });
      const validBreadth = sectorBreadth.filter((r) => r.above != null);
      const aboveCount = validBreadth.filter((r) => r.above).length;
      const breadthScore = validBreadth.length ? Math.round((aboveCount / validBreadth.length) * 100) : 50;
      const participationLabel = validBreadth.length === 0 ? 'N/A' : aboveCount >= validBreadth.length * 0.75 ? 'Broad' : aboveCount <= validBreadth.length * 0.25 ? 'Narrow' : 'Mixed';
      const above200 = sectorSeries.map(({ s }) => { const sma200s = sma(s.closes, 200); return sma200s != null && s.last != null ? s.last > sma200s : null; }).filter((v) => v != null);
      const above20 = sectorSeries.map(({ s }) => { const sma20s = sma(s.closes, 20); return sma20s != null && s.last != null ? s.last > sma20s : null; }).filter((v) => v != null);
      const pct200 = above200.length ? Math.round((above200.filter(Boolean).length / above200.length) * 100) : null;
      const pct20 = above20.length ? Math.round((above20.filter(Boolean).length / above20.length) * 100) : null;
      const sector1d = sectorSeries.map(({ s }) => pctChangeN(s.closes, 1)).filter((v) => v != null);
      const advancers = sector1d.filter((v) => v > 0).length;
      const decliners = sector1d.filter((v) => v < 0).length;
      const adRatio = decliners > 0 ? round1(advancers / decliners) : advancers > 0 ? Infinity : null;
      const adLabel = adRatio == null ? '—' : adRatio >= 1.5 ? 'Positive' : adRatio >= 0.8 ? 'Mixed' : 'Negative';
      const adDisplay = adRatio == null ? '—' : adRatio === Infinity ? `${advancers}:0` : `${advancers}:${decliners}`;
      const sector5d = sectorSeries.map(({ sym, s }) => ({ sym, chg5d: pctChangeN(s.closes, 5) }));
      const validMom = sector5d.filter((r) => r.chg5d != null);
      const positiveCount = validMom.filter((r) => r.chg5d > 0).length;
      const ratioScore = validMom.length ? (positiveCount / validMom.length) * 100 : 50;
      const spy5dChg = pctChangeN(spy.closes, 5) ?? 0;
      const spy5dScore = clamp(50 + spy5dChg * 10, 0, 100);
      const momentumScore = Math.round(0.5 * ratioScore + 0.5 * spy5dScore);
      const sortedMom = [...validMom].sort((a, b) => b.chg5d - a.chg5d);
      const leader = sortedMom[0] ?? null;
      const laggard = sortedMom[sortedMom.length - 1] ?? null;
      const spread = leader && laggard ? leader.chg5d - laggard.chg5d : null;
      const rotationLabel = spread == null ? 'N/A' : spread < 1.5 ? 'Uniform' : spread < 4 ? 'Rotating' : 'Sharp Rotation';
      const tlt20d = pctChangeN(tlt.closes, 20) ?? 0;
      const uup20d = pctChangeN(uup.closes, 20) ?? 0;
      const uup5d = pctChangeN(uup.closes, 5);
      const macroScore = Math.round(clamp(50 + tlt20d * 5 - uup20d * 5, 0, 100));
      const bondTrendLabel = tlt20d > 0.5 ? 'Rising' : tlt20d < -0.5 ? 'Falling' : 'Flat';
      const dollarTrendLabel = uup20d > 0.5 ? 'Strengthening' : uup20d < -0.5 ? 'Weakening' : 'Flat';
      const tenYieldVal = tnx.last != null ? round2(tnx.last / 10) : null;
      const tenYield5dChg = pctChangeN(tnx.closes, 5);
      const tenYieldTrend = tenYield5dChg == null ? 'Flat' : tenYield5dChg > 1 ? 'Rising' : tenYield5dChg < -1 ? 'Falling' : 'Flat';
      const dxyVal = dxy.last != null ? round2(dxy.last) : null;
      const dxy20dChg = pctChangeN(dxy.closes, 20);
      const dxyTrend = dxy20dChg == null ? 'Flat' : dxy20dChg > 0.5 ? 'Strengthening' : dxy20dChg < -0.5 ? 'Weakening' : 'Flat';
      const todayEt = etDateStr2();
      const isFomcToday = FOMC_DATES_2026.includes(todayEt);
      const nextFomc = FOMC_DATES_2026.find((d) => d >= todayEt) ?? null;
      const daysToFomc = nextFomc ? Math.round((new Date(`${nextFomc}T00:00:00`).getTime() - new Date(`${todayEt}T00:00:00`).getTime()) / 86_400_000) : null;
      const fomcBannerLabel = isFomcToday ? 'FOMC DECISION TODAY' : daysToFomc != null && daysToFomc <= 3 ? `FOMC DECISION IN ${daysToFomc}D` : null;
      const spyCloses = spy.closes;
      const spyPrior20 = spyCloses.slice(-21, -1);
      const priorHigh = spyPrior20.length ? Math.max(...spyPrior20) : null;
      const breakoutsWorking = priorHigh != null && spyLast != null ? spyLast > priorHigh : null;
      const leaderStillLeading = leader ? leader.chg5d > 0 : null;
      const laggardStillLagging = laggard ? laggard.chg5d < 0 : null;
      const leadersHolding = leaderStillLeading != null && laggardStillLagging != null ? leaderStillLeading && laggardStillLagging : null;
      const nSpy = spyCloses.length;
      const pullbacksBought = nSpy >= 3 ? (spyCloses[nSpy - 3] > spyCloses[nSpy - 2] && spyCloses[nSpy - 1] > spyCloses[nSpy - 2]) : null;
      const execYesCount = [breakoutsWorking, leadersHolding, pullbacksBought].filter((v) => v === true).length;
      const execNoCount = [breakoutsWorking, leadersHolding, pullbacksBought].filter((v) => v === false).length;
      const execTotal = execYesCount + execNoCount;
      const executionScore = execTotal ? Math.round((execYesCount / execTotal) * 100) : 50;
      const followThroughLabel = executionScore >= 66 ? 'Strong' : executionScore >= 33 ? 'Weak' : 'None';
      const followThroughSub = executionScore >= 66 ? 'Confirmed' : executionScore >= 33 ? 'Low conviction' : 'Failing';
      const executionWindow = {
        score: executionScore,
        items: [
          { label: 'Breakouts working?', value: breakoutsWorking == null ? '—' : breakoutsWorking ? 'Yes' : 'No', sub: breakoutsWorking == null ? '' : breakoutsWorking ? 'Confirming' : 'Failing', tone: breakoutsWorking },
          { label: 'Leaders holding?', value: leadersHolding == null ? '—' : leadersHolding ? 'Yes' : 'No', sub: leadersHolding == null ? '' : leadersHolding ? 'Holding' : 'Fading', tone: leadersHolding },
          { label: 'Pullbacks bought?', value: pullbacksBought == null ? '—' : pullbacksBought ? 'Yes' : 'No', sub: pullbacksBought == null ? '' : pullbacksBought ? 'Support' : 'No bounce', tone: pullbacksBought },
          { label: 'Follow-through?', value: followThroughLabel, sub: followThroughSub, tone: executionScore >= 66 ? true : executionScore >= 33 ? null : false },
        ],
      };
      const weights = { volatility: 0.25, trend: 0.20, breadth: 0.20, momentum: 0.25, macro: 0.10 };
      const weighted = {
        volatility: volatilityScore * weights.volatility, trend: trendScore * weights.trend, breadth: breadthScore * weights.breadth,
        momentum: momentumScore * weights.momentum, macro: macroScore * weights.macro,
      };
      const globalScoreRaw = weighted.volatility + weighted.trend + weighted.breadth + weighted.momentum + weighted.macro;
      const globalScore = Math.round(globalScoreRaw);
      let banner;
      if (globalScore >= 75) banner = { label: 'FAVORABLE', tone: 'green', sizing: 'Full position sizing', sizeLabel: 'FULL', sizeNote: 'Press risk' };
      else if (globalScore >= 60) banner = { label: 'CONSTRUCTIVE', tone: 'cyan', sizing: 'Normal position sizing', sizeLabel: 'NORMAL', sizeNote: 'Standard sizing' };
      else if (globalScore >= 40) banner = { label: 'CAUTION', tone: 'orange', sizing: 'Half position sizing', sizeLabel: 'HALF', sizeNote: 'Selective, reduced size' };
      else if (globalScore >= 25) banner = { label: 'DEFENSIVE', tone: 'orange', sizing: 'Quarter position sizing', sizeLabel: 'QUARTER', sizeNote: 'Defensive only' };
      else banner = { label: 'RISK OFF', tone: 'red', sizing: 'Minimal / no new sizing', sizeLabel: 'MINIMAL', sizeNote: 'Preserve capital' };
      const decision = globalScore >= 60 ? 'YES' : globalScore >= 40 ? 'CAUTION' : 'NO';
      const sectorBars = sector5d.map((r) => ({ symbol: r.sym, name: SECTOR_NAMES[r.sym], chg5d: r.chg5d != null ? round1(r.chg5d) : null })).filter((r) => r.chg5d != null).sort((a, b) => b.chg5d - a.chg5d);
      const headline = decision === 'YES' ? 'FAVORABLE FOR TRADING.' : decision === 'CAUTION' ? 'TRADE SELECTIVELY.' : 'AVOID TRADING.';
      const body = [
        `The current environment scores ${globalScore}/100${globalScore >= 35 && globalScore < 45 ? ', near the 40-point threshold for active sizing' : ''}.`,
        `VIX at ${round1(vixSpot)}${ivPercentile != null ? ` (${Math.round(ivPercentile)}th percentile — ${vixTrendLabel.toLowerCase()})` : ''}, ${volatilityScore >= 60 ? 'constructive' : volatilityScore >= 40 ? 'mixed' : 'concerning'}.`,
        `Market regime: ${trendRegime}.`,
        `Breadth is ${participationLabel.toLowerCase()} with ${aboveCount}/${validBreadth.length} sectors above their 50d SMA${pct200 != null ? ` (${pct200}% above 200d, ${pct20 != null ? pct20 : '—'}% above 20d)` : ''}.`,
        rsi != null ? `RSI-14 at ${round1(rsi)} signals ${rsi >= 70 ? 'overbought momentum' : rsi <= 30 ? 'oversold conditions' : 'moderate momentum'}.` : '',
        leader && laggard ? `Sector rotation is ${rotationLabel} with ${leader.sym} +${round1(leader.chg5d)}% leading and ${laggard.sym} ${round1(laggard.chg5d)}% lagging.` : '',
        `Bonds ${bondTrendLabel.toLowerCase()}, Dollar ${dollarTrendLabel.toLowerCase()}${uup5d != null ? ` (${uup5d >= 0 ? '+' : ''}${round1(uup5d)}% 5D)` : ''}.`,
        fomcBannerLabel ? `FOMC rate decision ${isFomcToday ? 'is today' : `in ${daysToFomc}d`} — Fed stance: ${FED_STANCE.stance} at ${FED_STANCE.range}, injecting event risk.` : '',
      ].filter(Boolean).join(' ');
      const suggestedAction = decision === 'YES'
        ? `Suggested action: Conditions support ${banner.sizing.toLowerCase()}. Standard risk management still applies.`
        : decision === 'CAUTION'
        ? `Suggested action: Be selective — favor high-conviction setups only, ${banner.sizing.toLowerCase()}, tighten stops into any event risk.`
        : `Suggested action: Sit on hands. Wait for breadth to improve above 50% on the 50-day MA, VIX to settle, and a confirmed regime shift before re-engaging. Capital preservation is the priority.`;
      const assessment = `${headline} ${body} ${suggestedAction}`;
      send(res, 200, {
        data: {
          asOf: new Date().toISOString(), globalScore, decision, banner,
          event: { fomc: { isToday: isFomcToday, label: fomcBannerLabel, nextDate: nextFomc, daysAway: daysToFomc }, fedStance: FED_STANCE, geopolitical: GEOPOLITICAL },
          pillars: {
            volatility: { score: volatilityScore, weight: weights.volatility, weighted: round1(weighted.volatility), vixLevel: round1(vixSpot), vixLevelLabel, vixTrend: vixTrendLabel, ivPercentile: ivPercentile != null ? Math.round(ivPercentile) : null, iv1yLabel, putCall: putCallProxy, putCallLabel },
            trend: { score: trendScore, weight: weights.trend, weighted: round1(weighted.trend), regime: trendRegime, spyVs20: spySma20 != null ? spyLast > spySma20 : null, spyVs50: spySma50 != null ? spyLast > spySma50 : null, spyVs200: spySma200 != null ? spyLast > spySma200 : null, qqqVs50: qqqSma50 != null && qqqLast != null ? qqqLast > qqqSma50 : null, rsi14: rsi != null ? round1(rsi) : null },
            breadth: { score: breadthScore, weight: weights.breadth, weighted: round1(weighted.breadth), aboveCount, total: validBreadth.length, pct200, pct20, participation: participationLabel, nyseAd: { display: adDisplay, label: adLabel }, sectors: sectorBreadth.map((r) => ({ symbol: r.sym, above: r.above })) },
            momentum: { score: momentumScore, weight: weights.momentum, weighted: round1(weighted.momentum), positiveCount, total: validMom.length, spread: spread != null ? round1(spread) : null, leader: leader ? { symbol: leader.sym, chg5d: round1(leader.chg5d) } : null, laggard: laggard ? { symbol: laggard.sym, chg5d: round1(laggard.chg5d) } : null, rotation: rotationLabel },
            macro: { score: macroScore, weight: weights.macro, weighted: round1(weighted.macro), tltLast: tlt.last != null ? round1(tlt.last) : null, tltTrend: bondTrendLabel, uupTrend: dollarTrendLabel, uup5d: uup5d != null ? round1(uup5d) : null, tenYield: tenYieldVal, tenYieldTrend, dxy: dxyVal, dxyTrend },
          },
          executionWindow, sectorBars, headline, body, suggestedAction, assessment, source: 'yahoo',
        },
      }, { 'Cache-Control': NO_STORE });
    },
  });
}

// ── REAL-DB routes (batch 2) — only registered when the bundle loaded ────────
// Each calls the bundled lib/db.ts function exactly as its route.ts did. If
// libDb is null these blocks are skipped → the routes fall through to Next.
if (libDb) {
  // /api/eod-gex?date&symbol&limit → getEodGex → { count, rows }
  register('/api/eod-gex', {
    auth: 'subscriber', methods: ['GET'],
    async handler(req, res) {
      try {
        const sp = new URL(req.url || '/', 'http://localhost').searchParams;
        const date = sp.get('date') ?? '';
        const symbol = sp.get('symbol') ?? '';
        const limit = Math.min(Number(sp.get('limit') ?? 200), 1000);
        const rows = await libDb.getEodGex({
          date: date || undefined,
          symbol: symbol || undefined,
          limit,
        });
        send(res, 200, { count: rows.length, rows });
      } catch (err) {
        send(res, 500, { error: 'Database error', detail: String(err) });
      }
    },
  });

  // /api/momentum-bias?date|since|all|limit → { date, since, signals, summary }
  register('/api/momentum-bias', {
    auth: 'subscriber', methods: ['GET'],
    async handler(req, res) {
      const sp = new URL(req.url || '/', 'http://localhost').searchParams;
      const since = sp.get('since') || undefined;
      const all = sp.get('all') === '1';
      const limit = Math.min(1000, Math.max(1, Number(sp.get('limit')) || 200));
      const date = all || since ? undefined : (sp.get('date') || etDateStr());
      try {
        const [signals, summary] = await Promise.all([
          libDb.getMomentumBiasSignals({ date, sinceDate: since, limit }),
          libDb.getMomentumBiasSummary({ date, sinceDate: since }),
        ]);
        send(res, 200, { date: date ?? null, since: since ?? null, signals, summary },
          { 'Cache-Control': 'no-store' });
      } catch (e) {
        send(res, 500, { error: e.message, signals: [], summary: [] });
      }
    },
  });

  // /api/ref-levels?symbol=ES → PDH/PDL (day) + PWH/PWL (week) from ref_levels
  register('/api/ref-levels', {
    auth: 'subscriber', methods: ['GET'],
    async handler(req, res) {
      try {
        const symbol = (new URL(req.url || '/', 'http://localhost').searchParams.get('symbol') || 'ES').toUpperCase();
        const today = todayET();
        const thisMon = mondayOf(today);
        const day = await libDb.queryOne(
          `SELECT high, low, key FROM ref_levels WHERE symbol = ? AND kind = 'day' AND key < ? ORDER BY key DESC LIMIT 1`,
          [symbol, today]
        );
        const week = await libDb.queryOne(
          `SELECT high, low, key FROM ref_levels WHERE symbol = ? AND kind = 'week' AND key < ? ORDER BY key DESC LIMIT 1`,
          [symbol, thisMon]
        );
        send(res, 200, {
          symbol,
          pdh: day?.high ?? null, pdl: day?.low ?? null, pdDate: day?.key ?? null,
          pwh: week?.high ?? null, pwl: week?.low ?? null, pwWeek: week?.key ?? null,
        }, { 'Cache-Control': 'no-store' });
      } catch (err) {
        send(res, 500, { error: String(err) });
      }
    },
  });

  // ── User-scoped prefs (GET load / POST save), keyed on the AUTHED userId ─────
  // The old routes read the userId from @/lib/supabase/server getServerUserId();
  // here we use access.userId (verifyWsRequest already resolved + gated it), so
  // the supabase import is dropped. All subscriber-gated (middleware already
  // required a paid session for these — none are in PAID_EXEMPT).

  // /api/positioning-tickers — /test Positioning tab, exactly 4 tickers.
  register('/api/positioning-tickers', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res, ctx, access) {
      const userId = access.userId;
      if (!userId) return send(res, 401, { error: 'Unauthorized' });
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          const seen = new Set(), tickers = [];
          for (const it of (Array.isArray(body?.tickers) ? body.tickers : [])) {
            const sym = String(it ?? '').trim().toUpperCase().slice(0, 12);
            if (!sym || seen.has(sym) || !/^[A-Z0-9/.^-]+$/.test(sym)) continue;
            seen.add(sym); tickers.push(sym);
            if (tickers.length >= 4) break;
          }
          if (tickers.length !== 4) return send(res, 400, { error: 'Exactly 4 distinct tickers required' });
          await libDb.upsertPositioningTickers(userId, tickers);
          return send(res, 200, { ok: true, tickers });
        } catch (err) { return send(res, 500, { error: 'Save failed', detail: String(err) }); }
      }
      try {
        const tickers = await libDb.getPositioningTickers(userId);
        send(res, 200, { tickers }, { 'Cache-Control': 'private, max-age=30' });
      } catch (err) { send(res, 500, { error: 'Load failed', detail: String(err) }); }
    },
  });

  // /api/quote-symbols — toolbar Quotes dropdown, up to 40 { sym, label }.
  register('/api/quote-symbols', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res, ctx, access) {
      const userId = access.userId;
      if (!userId) return send(res, 401, { error: 'Unauthorized' });
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          const seen = new Set(), symbols = [];
          for (const it of (Array.isArray(body?.symbols) ? body.symbols : [])) {
            if (!it || typeof it !== 'object') continue;
            const sym = String(it.sym ?? '').trim().toUpperCase().slice(0, 12);
            if (!sym || seen.has(sym) || !/^[A-Z0-9/.^-]+$/.test(sym)) continue;
            seen.add(sym);
            const label = String(it.label ?? sym).trim().slice(0, 12);
            symbols.push({ sym, label: label || sym });
            if (symbols.length >= 40) break;
          }
          await libDb.upsertQuoteSymbols(userId, symbols);
          return send(res, 200, { ok: true, symbols });
        } catch (err) { return send(res, 500, { error: 'Save failed', detail: String(err) }); }
      }
      try {
        const symbols = await libDb.getQuoteSymbols(userId);
        send(res, 200, { symbols }, { 'Cache-Control': 'private, max-age=30' });
      } catch (err) { send(res, 500, { error: 'Load failed', detail: String(err) }); }
    },
  });

  // /api/ict-prefs — per-user /ict glossary hidden-card ids.
  register('/api/ict-prefs', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res, ctx, access) {
      const userId = access.userId;
      if (!userId) return send(res, 401, { error: 'Unauthorized' });
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          const hiddenCards = Array.isArray(body.hiddenCards)
            ? body.hiddenCards.map((x) => String(x)).slice(0, 200) : [];
          await libDb.upsertIctCardPrefs(userId, hiddenCards);
          return send(res, 200, { ok: true });
        } catch (err) { return send(res, 500, { error: 'Save failed', detail: String(err) }); }
      }
      try {
        const hiddenCards = await libDb.getIctCardPrefs(userId);
        send(res, 200, { hiddenCards });
      } catch (err) { send(res, 500, { error: 'Load failed', detail: String(err) }); }
    },
  });

  // /api/dashboard-layout — saved card layouts ("templates") for a dashboard
  // page's drag/resize grid, per user PER PAGE.
  //
  //   GET  ?page=options                     → { templates: [{ name, layout, isDefault, updatedAt }] }
  //   POST { page, name, layout, makeDefault } → save/overwrite one template
  //   POST { page, name, action: 'delete' }    → drop one
  //   POST { page, name, action: 'set-default' } → pick the auto-loaded one
  //
  // The layout array is stored opaquely — the PAGE owns its card ids and
  // reconciles them on load, so shipping a new card never invalidates a saved
  // template. Server-side we only bound it (item count, key types, coordinate
  // ranges) so a bad client can't write junk that breaks the grid for everyone
  // on that account.
  const LAYOUT_MAX_TEMPLATES = 12;   // per user, per page
  const LAYOUT_MAX_ITEMS = 60;       // cards in one layout
  const LAYOUT_MAX_COORD = 500;      // grid units; the pages use 12 cols

  function cleanLayoutPage(v) {
    const s = String(v ?? '').trim().toLowerCase();
    return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(s) ? s : null;
  }
  function cleanLayoutName(v) {
    const s = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return s || null;
  }
  function cleanLayoutItems(v) {
    if (!Array.isArray(v)) return null;
    const seen = new Set();
    const out = [];
    for (const raw of v) {
      if (!raw || typeof raw !== 'object') continue;
      const id = String(raw.id ?? '').trim().slice(0, 64);
      if (!id || seen.has(id)) continue;
      const num = (n, lo, hi) => {
        const x = Math.round(Number(n));
        return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : null;
      };
      const x = num(raw.x, 0, LAYOUT_MAX_COORD);
      const y = num(raw.y, 0, LAYOUT_MAX_COORD);
      const w = num(raw.w, 1, LAYOUT_MAX_COORD);
      const h = num(raw.h, 1, LAYOUT_MAX_COORD);
      if (x === null || y === null || w === null || h === null) continue;
      seen.add(id);
      const item = { id, x, y, w, h };
      // Optional fields for user-added cards (mirrors lib/layoutStore GridItem).
      if (raw.type === 'iframe') {
        item.type = 'iframe';
        if (raw.src) item.src = String(raw.src).slice(0, 500);
        if (raw.title) item.title = String(raw.title).slice(0, 80);
      }
      out.push(item);
      if (out.length >= LAYOUT_MAX_ITEMS) break;
    }
    return out;
  }

  register('/api/dashboard-layout', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res, ctx, access) {
      const userId = access.userId;
      if (!userId) return send(res, 401, { error: 'Unauthorized' });

      if (req.method === 'POST') {
        let body;
        try { body = await readJson(req, 200_000); }
        catch { return send(res, 400, { error: 'Bad JSON' }); }

        const page = cleanLayoutPage(body?.page);
        const name = cleanLayoutName(body?.name);
        if (!page) return send(res, 400, { error: 'Bad page' });
        if (!name) return send(res, 400, { error: 'Name required' });

        const action = String(body?.action ?? 'save');
        try {
          if (action === 'delete') {
            await libDb.deleteDashboardLayout(userId, page, name);
            return send(res, 200, { ok: true });
          }
          if (action === 'set-default') {
            const ok = await libDb.setDefaultDashboardLayout(userId, page, name);
            return ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'No such template' });
          }
          const layout = cleanLayoutItems(body?.layout);
          if (!layout) return send(res, 400, { error: 'layout must be an array' });
          // Cap only on CREATE — overwriting an existing name is always allowed,
          // so a user at the cap can still autosave the template they're on.
          const existing = await libDb.getDashboardLayouts(userId, page);
          const isNew = !existing.some((t) => t.name === name);
          if (isNew && existing.length >= LAYOUT_MAX_TEMPLATES) {
            return send(res, 409, { error: `Template limit reached (${LAYOUT_MAX_TEMPLATES})` });
          }
          // First template a user saves for a page becomes their default —
          // otherwise saving one and reloading would silently do nothing.
          const makeDefault = body?.makeDefault === true || existing.length === 0;
          await libDb.upsertDashboardLayout(userId, page, name, layout, makeDefault);
          return send(res, 200, { ok: true, name, isDefault: makeDefault });
        } catch (err) {
          return send(res, 500, { error: 'Save failed', detail: String(err) });
        }
      }

      const sp = new URL(req.url || '/', 'http://localhost').searchParams;
      const page = cleanLayoutPage(sp.get('page'));
      if (!page) return send(res, 400, { error: 'Bad page' });
      try {
        const templates = await libDb.getDashboardLayouts(userId, page);
        send(res, 200, { templates }, { 'Cache-Control': 'private, no-store' });
      } catch (err) {
        send(res, 500, { error: 'Load failed', detail: String(err) });
      }
    },
  });

  // /api/traders-dashboard — per-user schedule/tasks/links/weather-zip.
  register('/api/traders-dashboard', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res, ctx, access) {
      const userId = access.userId;
      if (!userId) return send(res, 401, { error: 'Unauthorized' });
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          const fields = {};
          if ('zip' in body) fields.zip = body.zip ? String(body.zip).trim().slice(0, 10) : null;
          if (Array.isArray(body.schedule)) fields.schedule = body.schedule;
          if (Array.isArray(body.tasks)) fields.tasks = body.tasks;
          if (Array.isArray(body.links)) fields.links = body.links;
          await libDb.upsertTdPrefs(userId, fields);
          return send(res, 200, { ok: true });
        } catch (err) { return send(res, 500, { error: 'Save failed', detail: String(err) }); }
      }
      try {
        const prefs = await libDb.getTdPrefs(userId);
        send(res, 200, {
          zip: prefs?.zip ?? null,
          schedule: prefs?.schedule ?? [],
          tasks: prefs?.tasks ?? [],
          links: prefs?.links ?? [],
        });
      } catch (err) { send(res, 500, { error: 'Load failed', detail: String(err) }); }
    },
  });

  // ── Cron-facing reader/writer pairs: GET=subscriber, POST=internal-token ─────

  // /api/es-gap — ES overnight gap row. GET reads; POST post/fill from cron.
  register('/api/es-gap', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res, ctx) {
      if (req.method === 'POST') {
        try {
          if (!tokenOk(req, ctx)) return send(res, 401, { error: 'unauthorized' });
          const body = await readJson(req);
          const action = String(body.action || '');
          if (action === 'post') {
            const date = String(body.date || '');
            const prior_close = Number(body.prior_close);
            const open_0930 = Number(body.open_0930);
            if (!date || !isFinite(prior_close) || !isFinite(open_0930))
              return send(res, 400, { error: 'missing date/prior_close/open_0930' });
            const gap_pts = open_0930 - prior_close;
            const gap_dir = gap_pts > 0 ? 'up' : gap_pts < 0 ? 'down' : 'flat';
            await libDb.postEsGap({
              date, symbol: body.symbol ? String(body.symbol) : '/ES',
              prior_close, open_0930, gap_pts, gap_dir,
              open_ts: Number(body.open_ts) || Date.now(),
            });
            const row = await libDb.getEsGap(date);
            return send(res, 201, { ok: true, gap: row });
          }
          if (action === 'fill') {
            const date = String(body.date || '');
            if (!date) return send(res, 400, { error: 'missing date' });
            await libDb.updateEsGapFill({
              date,
              pct_filled: Number(body.pct_filled) || 0,
              extreme_after: Number(body.extreme_after),
              filled: !!body.filled,
              fill_ts: body.fill_ts != null ? Number(body.fill_ts) : null,
            });
            const row = await libDb.getEsGap(date);
            return send(res, 200, { ok: true, gap: row });
          }
          return send(res, 400, { error: `unknown action '${action}'` });
        } catch (err) { return send(res, 500, { error: String(err) }); }
      }
      try {
        const date = new URL(req.url || '/', 'http://localhost').searchParams.get('date') || etDateStr();
        const row = await libDb.getEsGap(date);
        send(res, 200, { date, gap: row });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // /api/premarket-summary — Analytics Premarket card. GET latest; POST cron.
  register('/api/premarket-summary', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res, ctx) {
      if (req.method === 'POST') {
        try {
          if (!tokenOk(req, ctx)) return send(res, 403, { error: 'Forbidden' });
          const body = await readJson(req);
          const date = String(body?.date || etDateStr());
          const bullets = Array.isArray(body?.bullets)
            ? body.bullets.filter((b) => typeof b === 'string').slice(0, 5) : [];
          if (!bullets.length) return send(res, 400, { error: 'bullets required' });
          await libDb.upsertPremarketSummary(date, bullets);
          return send(res, 200, { ok: true });
        } catch (err) { return send(res, 500, { error: 'Save failed', detail: String(err) }); }
      }
      try {
        const date = new URL(req.url || '/', 'http://localhost').searchParams.get('date');
        const row = date ? await libDb.getPremarketSummary(date) : await libDb.getLatestPremarketSummary();
        send(res, 200, { summary: row || null });
      } catch (err) { send(res, 500, { error: 'Load failed', detail: String(err) }); }
    },
  });

  // /api/traders-dashboard/overview — shared daily overview. GET latest; POST cron.
  register('/api/traders-dashboard/overview', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res, ctx) {
      if (req.method === 'POST') {
        try {
          if (!tokenOk(req, ctx)) return send(res, 403, { error: 'Forbidden' });
          const body = await readJson(req);
          const date = String(body?.date || etDateStr());
          const summary = String(body?.summary || '').trim();
          const drivers = Array.isArray(body?.drivers) ? body.drivers : [];
          const movers = Array.isArray(body?.movers) ? body.movers : [];
          if (!summary) return send(res, 400, { error: 'summary required' });
          await libDb.upsertTdOverview(date, summary, drivers, movers);
          return send(res, 200, { ok: true });
        } catch (err) { return send(res, 500, { error: 'Save failed', detail: String(err) }); }
      }
      try {
        const date = new URL(req.url || '/', 'http://localhost').searchParams.get('date');
        const row = date ? await libDb.getTdOverview(date) : await libDb.getLatestTdOverview();
        send(res, 200, { overview: row || null });
      } catch (err) { send(res, 500, { error: 'Load failed', detail: String(err) }); }
    },
  });

  // /api/ticker-event — analytics. GET aggregated counts; POST logs click/render
  // (subscriber both ways; user_id optional, best-effort — never breaks the UI).
  register('/api/ticker-event', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res, ctx, access) {
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          const source = body.source == null ? null : String(body.source);
          const raw = Array.isArray(body.events) ? body.events : [{ ticker: body.ticker, event: body.event }];
          const VALID = new Set(['click', 'render']);
          const seen = new Set(), events = [];
          for (const e of raw) {
            const ticker = e.ticker == null ? '' : String(e.ticker).trim().toUpperCase();
            const event = e.event == null ? '' : String(e.event);
            if (!ticker || !VALID.has(event)) continue;
            const k = `${ticker}|${event}`;
            if (seen.has(k)) continue;
            seen.add(k); events.push({ ticker, event });
          }
          if (!events.length) return send(res, 200, { ok: true, logged: 0 });
          const userId = access.userId ?? null;
          await Promise.all(events.map((e) =>
            libDb.insertTickerEvent({ ticker: e.ticker, event: e.event, source, user_id: userId }).catch(() => {})));
          return send(res, 200, { ok: true, logged: events.length });
        } catch (err) { return send(res, 500, { error: String(err) }); }
      }
      try {
        const sp = new URL(req.url || '/', 'http://localhost').searchParams;
        const sinceDays = Number(sp.get('sinceDays') ?? 0) || undefined;
        const source = sp.get('source') || undefined;
        const rows = await libDb.getTickerEventCounts(sinceDays, source);
        send(res, 200, { rows });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // ── Delayed-mode snapshots (PAID_EXEMPT → 'user'), GET read / POST cron ──────

  // /api/home-snapshot — frozen /home feed for unpaid signed-in users.
  register('/api/home-snapshot', {
    auth: 'user', methods: ['GET', 'POST'],
    async handler(req, res, ctx) {
      if (req.method === 'POST') {
        if (!tokenOk(req, ctx)) return send(res, 403, { error: 'forbidden' });
        try {
          const body = await readJson(req);
          const ts = Number(body.ts) || Date.now();
          await libDb.insertHomeStaticSnapshot(body.snapshot ?? body, ts);
          return send(res, 200, { ok: true });
        } catch (err) { return send(res, 500, { error: String(err) }); }
      }
      try {
        const row = await libDb.getLatestHomeStaticSnapshot();
        send(res, 200, { ts: row?.ts ?? null, snapshot: row?.payload ?? null });
      } catch (err) { send(res, 500, { error: 'Database error', detail: String(err) }); }
    },
  });

  // /api/mult-greek-snapshot — frozen /mult-greek feed for unpaid signed-in users.
  register('/api/mult-greek-snapshot', {
    auth: 'user', methods: ['GET', 'POST'],
    async handler(req, res, ctx) {
      if (req.method === 'POST') {
        if (!tokenOk(req, ctx)) return send(res, 403, { error: 'forbidden' });
        try {
          const body = await readJson(req);
          const ts = Number(body.ts) || Date.now();
          await libDb.insertMultGreekStaticSnapshot(body.snapshot ?? body, ts);
          return send(res, 200, { ok: true });
        } catch (err) { return send(res, 500, { error: String(err) }); }
      }
      try {
        const row = await libDb.getLatestMultGreekStaticSnapshot();
        send(res, 200, { ts: row?.ts ?? null, snapshot: row?.payload ?? null });
      } catch (err) { send(res, 500, { error: 'Database error', detail: String(err) }); }
    },
  });

  // /api/db/health — Postgres SELECT 1 probe (subscriber; 503 on failure).
  register('/api/db/health', {
    auth: 'subscriber', methods: ['GET'],
    async handler(req, res) {
      const t0 = Date.now();
      try {
        await libDb.pgQuery('SELECT 1');
        send(res, 200, { ok: true, latencyMs: Date.now() - t0, ts: Date.now() });
      } catch (err) {
        send(res, 503, { ok: false, latencyMs: Date.now() - t0, error: String(err?.message ?? err), ts: Date.now() });
      }
    },
  });

  // /api/page-visits — owner-only visit log (exposes client IPs / PII).
  register('/api/page-visits', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res, ctx) {
      try {
        const limit = Math.min(Number(new URL(req.url || '/', 'http://localhost').searchParams.get('limit') ?? 100), 5000);
        const rows = await libDb.getRecentPageVisits(limit);
        // Batch-resolve the account behind each distinct signed-in user_id in
        // this page, so the owner map can show WHO was on the page — identity
        // (email / discord), how long they've had an account, and when they
        // last signed in. One query for the whole batch. Inline rather than via
        // getUsersByIds() because that helper only returns email + discord.
        // last_login_at: sessions rows are only ever created at login (see
        // lib/auth/session.ts createSession), so MAX(created_at) is the login.
        const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
        const userMap = new Map();
        if (ids.length) {
          try {
            const accounts = await libDb.queryAll(
              `SELECT u.id, u.email, u.discord_username, u.created_at, u.is_owner,
                      s.last_login_at
                 FROM users u
                 LEFT JOIN (
                   SELECT user_id, MAX(created_at) AS last_login_at
                     FROM sessions GROUP BY user_id
                 ) s ON s.user_id = u.id
                WHERE u.id = ANY(?::text[])`,
              [ids]
            );
            for (const a of accounts) userMap.set(a.id, a);
          } catch (e) {
            // Identity is an enrichment, not the payload — a failure here must
            // degrade to "everyone is anonymous", never 500 the visit log.
            console.warn('[api-router] page-visits account lookup failed:', e?.message || e);
          }
        }
        const visits = rows.map((r) => {
          const u = r.user_id ? userMap.get(r.user_id) : undefined;
          return {
            id: r.id, pageKey: r.page_key ?? null, pageLabel: r.page_label ?? null,
            path: r.path ?? null, userId: r.user_id ?? null, ip: r.ip ?? null,
            userEmail: u?.email ?? null, userName: u?.discord_username ?? null,
            userCreatedAt: u?.created_at ?? null,
            userLastLoginAt: u?.last_login_at ?? null,
            isOwner: Boolean(u?.is_owner) || Boolean(ctx?.ownerUserId && r.user_id === ctx.ownerUserId),
            // Cloudflare geo. Null on rows logged before the managed transform was
            // enabled, and on anything that reached the origin without crossing the edge.
            country: r.country ?? null, region: r.region ?? null, city: r.city ?? null,
            lat: r.lat ?? null, lon: r.lon ?? null,
            // Acquisition. Non-null only on entry rows (the first beacon of a
            // browser session) — see lib/visitorAttribution.ts. Count sessions
            // with isEntry, then group those by channel / referrerHost / utmSource.
            isEntry: Boolean(r.is_entry),
            referrer: r.referrer ?? null,
            referrerHost: r.referrer_host ?? null,
            utmSource: r.utm_source ?? null,
            utmMedium: r.utm_medium ?? null,
            utmCampaign: r.utm_campaign ?? null,
            utmTerm: r.utm_term ?? null,
            utmContent: r.utm_content ?? null,
            channel: r.channel ?? null,
            // Device is filled on every row (it comes from the UA header).
            browser: r.browser ?? null,
            os: r.os ?? null,
            deviceType: r.device_type ?? null,
            isBot: Boolean(r.is_bot),
            createdAt: r.created_at ?? null,
          };
        });
        send(res, 200, { visits });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // /api/strategy — Analytics StrategyBuilder. GET latest/history; POST cron.
  register('/api/strategy', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res, ctx) {
      const sp = new URL(req.url || '/', 'http://localhost').searchParams;
      if (req.method === 'POST') {
        try {
          if (!tokenOk(req, ctx)) return send(res, 403, { error: 'Forbidden' });
          const body = await readJson(req);
          const date = String(body?.date || etDateStr());
          const plan = body?.plan;
          if (!plan || typeof plan !== 'object') return send(res, 400, { error: 'plan object required' });
          const hour = Number.isFinite(Number(body?.hour)) && body?.hour != null ? Number(body.hour) : etHour();
          await libDb.upsertDailyStrategy(date, plan);
          await libDb.insertDailyStrategyHistory(date, hour, plan);
          return send(res, 200, { ok: true, date, hour });
        } catch (err) { return send(res, 500, { error: 'Save failed', detail: String(err) }); }
      }
      try {
        const date = sp.get('date');
        if (sp.get('history') === '1') {
          const rows = await libDb.getDailyStrategyHistory(date || etDateStr());
          return send(res, 200, { history: rows.map((r) => ({ ...r, plan: typeof r.plan === 'string' ? JSON.parse(r.plan) : r.plan })) });
        }
        const row = date ? await libDb.getDailyStrategy(date) : await libDb.getLatestDailyStrategy();
        if (!row) return send(res, 200, { strategy: null });
        const plan = typeof row.plan === 'string' ? JSON.parse(row.plan) : row.plan;
        send(res, 200, { strategy: { ...row, plan } });
      } catch (err) { send(res, 500, { error: 'Load failed', detail: String(err) }); }
    },
  });

  // /api/page-status — page-load beacon. POST upsert + visit log; GET status list.
  // PUBLIC: the beacon fires on every page load incl. guests/unpaid (source route
  // was ungated — "guests are fine"); gating it dropped page-load/visit logging
  // for all non-subscribers. (audit 2026-07-25)
  register('/api/page-status', {
    // identify: log WHO when a session is present. Without it every visit row
    // is anonymous — see enforceAuth's 'public' branch. Still never rejects.
    auth: 'public', identify: true, methods: ['GET', 'POST'],
    async handler(req, res, ctx, access) {
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          const isLoaded = Boolean(body.isLoaded ?? body.is_loaded);
          await libDb.upsertPageLoadStatus({
            page_key: String(body.pageKey ?? body.page_key ?? ''),
            page_label: body.pageLabel == null ? null : String(body.pageLabel),
            path: body.path == null ? null : String(body.path),
            is_loaded: isLoaded,
            last_loaded_at: body.lastLoadedAt == null ? null : String(body.lastLoadedAt),
            last_unloaded_at: body.lastUnloadedAt == null ? null : String(body.lastUnloadedAt),
          });
          if (isLoaded) {
            try {
              const geo = clientGeo(req);
              await libDb.insertPageVisit({
                page_key: String(body.pageKey ?? body.page_key ?? ''),
                page_label: body.pageLabel == null ? null : String(body.pageLabel),
                path: body.path == null ? null : String(body.path),
                user_id: access.userId ?? null,
                ip: clientIp(req),
                country: geo.country,
                region: geo.region,
                city: geo.city,
                lat: geo.lat,
                lon: geo.lon,
                // Referrer / UTM (entry rows only) + browser/OS/device (every row).
                ...visitAttribution(req, body),
              });
            } catch { /* non-fatal */ }
          }
          return send(res, 200, { ok: true });
        } catch (err) { return send(res, 500, { error: String(err) }); }
      }
      try {
        const limit = Math.min(Number(new URL(req.url || '/', 'http://localhost').searchParams.get('limit') ?? 200), 1000);
        const rows = await libDb.getPageLoadStatus(limit);
        send(res, 200, { rows });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // /api/bzila-note — Traders Dashboard note. GET any signed-in; POST/DELETE owner.
  register('/api/bzila-note', {
    auth: 'user', methods: ['GET', 'POST', 'DELETE'],
    async handler(req, res, ctx, access) {
      if (req.method === 'GET') {
        try {
          const row = await libDb.getBzilaNote();
          send(res, 200, { content: row?.content ?? '', updated_at: row?.updated_at ?? null });
        } catch (err) { send(res, 500, { error: 'Load failed', detail: String(err) }); }
        return;
      }
      if (!ctx.ownerUserId || access.userId !== ctx.ownerUserId) return send(res, 403, { error: 'Forbidden' });
      if (req.method === 'DELETE') {
        try { await libDb.upsertBzilaNote(''); send(res, 200, { ok: true }); }
        catch (err) { send(res, 500, { error: 'Delete failed', detail: String(err) }); }
        return;
      }
      try {
        const body = await readJson(req);
        await libDb.upsertBzilaNote(String(body?.content ?? '').slice(0, 8000));
        send(res, 200, { ok: true });
      } catch (err) { send(res, 500, { error: 'Save failed', detail: String(err) }); }
    },
  });

  // /api/far-cb-tickers — Far CB Watch roster. GET list; POST add (needs email).
  // 'user': source gated on sign-in only (getServerUserId, no paid check) —
  // "any signed-in user may add a ticker"; 'subscriber' wrongly blocked signed-in
  // non-paying users. (audit 2026-07-25)
  register('/api/far-cb-tickers', {
    auth: 'user', methods: ['GET', 'POST'],
    async handler(req, res, ctx, access) {
      const userId = access.userId;
      if (req.method === 'POST') {
        try {
          if (!userId) return send(res, 401, { error: 'Sign in to add a ticker' });
          const body = await readJson(req);
          const symbol = String(body?.symbol ?? '').trim();
          if (!symbol) return send(res, 400, { error: 'Ticker is required' });
          let email = null;
          try { const u = await libDb.getUserById(userId); email = u?.email ?? null; } catch { /* email optional */ }
          const result = await libDb.addFarCbTicker({ symbol, added_by_id: userId, added_by_email: email });
          if (!result.ok) return send(res, 400, { error: result.error });
          return send(res, 200, { ok: true, ticker: result.row });
        } catch (err) { return send(res, 500, { error: 'Add ticker failed', detail: String(err) }); }
      }
      try {
        if (!userId) return send(res, 401, { error: 'Sign in required' });
        const rows = await libDb.listFarCbTickers();
        send(res, 200, { ok: true, rows });
      } catch (err) { send(res, 500, { error: 'Load failed', detail: String(err) }); }
    },
  });

  // /api/journal — per-user trading journal CRUD ('user' — signed-in, own data).
  register('/api/journal', {
    auth: 'user', methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    async handler(req, res, ctx, access) {
      const userId = access.userId;
      const parse = (body) => {
        const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
        const date = String(body.date ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
        return {
          date,
          net_pnl: num(body.netPnl ?? body.net_pnl),
          trades: Math.max(0, num(body.trades)),
          win_rate: Math.min(100, Math.max(0, num(body.winRate ?? body.win_rate))),
          avg_win: num(body.avgWin ?? body.avg_win),
          avg_loss: num(body.avgLoss ?? body.avg_loss),
          profit_factor: num(body.profitFactor ?? body.profit_factor),
          commissions: num(body.commissions),
          notes: body.notes ? String(body.notes).slice(0, 4000) : null,
          kind: String(body.kind ?? 'manual') === 'verified' ? 'verified' : 'manual',
        };
      };
      try {
        if (req.method === 'POST') {
          const entry = parse(await readJson(req).catch(() => ({})));
          if (!entry) return send(res, 400, { error: 'valid date (YYYY-MM-DD) required' });
          return send(res, 200, { ok: true, row: await libDb.insertTradingJournal(userId, entry) });
        }
        if (req.method === 'PATCH') {
          const body = await readJson(req).catch(() => ({}));
          const id = Number(body.id);
          if (!Number.isFinite(id)) return send(res, 400, { error: 'id required' });
          const entry = parse(body);
          if (!entry) return send(res, 400, { error: 'valid date (YYYY-MM-DD) required' });
          const row = await libDb.updateTradingJournal(userId, id, entry);
          if (!row) return send(res, 404, { error: 'not found' });
          return send(res, 200, { ok: true, row });
        }
        if (req.method === 'DELETE') {
          const id = Number(new URL(req.url || '/', 'http://localhost').searchParams.get('id'));
          if (!Number.isFinite(id)) return send(res, 400, { error: 'id required' });
          await libDb.deleteTradingJournal(userId, id);
          return send(res, 200, { ok: true });
        }
        send(res, 200, { rows: await libDb.getTradingJournals(userId) });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // /api/budget/year — owner-only register rows for a calendar year.
  register('/api/budget/year', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res) {
      try {
        const year = Number(new URL(req.url || '/', 'http://localhost').searchParams.get('year')) || new Date().getFullYear();
        await libDb.adoptDefaultBudgetProfile('owner');
        const profile = await libDb.getOrCreateBudgetProfile('owner');
        const rows = await libDb.listRegister(profile.id, `${year}-01-01`, `${year}-12-31`);
        send(res, 200, { year, rows });
      } catch (err) { send(res, 500, { error: 'Year load failed', detail: String(err) }); }
    },
  });

  // /api/auth-status — owner-only user/session stats card.
  register('/api/auth-status', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res) {
      let userCount = null, activeSessions = null, recent = [], statsError = null;
      try {
        userCount = await libDb.countUsers();
        activeSessions = await libDb.countActiveSessions();
        const rows = await libDb.listRecentUsers(5);
        recent = rows.map((u) => ({ id: u.id, email: u.email ?? null, name: null, createdAt: u.created_at ? new Date(u.created_at).getTime() : null }));
      } catch (err) { statsError = String(err?.message ?? err); }
      send(res, 200, { configured: true, provider: 'custom', environment: 'live', mismatch: false, stats: { userCount, activeSessions, recent }, statsError });
    },
  });

  // /api/db/tables — list public tables (+ optional today-row counts).
  register('/api/db/tables', {
    auth: 'subscriber', methods: ['GET'],
    async handler(req, res) {
      const DATE_COL_PRIORITY = ['date', 'day', 'entry_date', 'work_date'];
      try {
        const date = new URL(req.url || '/', 'http://localhost').searchParams.get('today') ?? '';
        const rows = await libDb.queryAll(
          `SELECT t.table_name AS name, COALESCE(s.n_live_tup, 0)::int AS approx_rows
             FROM information_schema.tables t
             LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name AND s.schemaname = 'public'
            WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
            ORDER BY t.table_name ASC`);
        if (!date) return send(res, 200, { tables: rows });
        const colRows = await libDb.queryAll(
          `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
        const byTable = new Map();
        for (const r of colRows) { const l = byTable.get(r.table_name) ?? []; l.push(r.column_name); byTable.set(r.table_name, l); }
        const counts = {};
        await Promise.all([...byTable.entries()].map(async ([table, cols]) => {
          let expr;
          if (table === 'trades') expr = `date(timestamp)`;
          else {
            const dc = DATE_COL_PRIORITY.find((c) => cols.includes(c));
            if (dc) expr = `"${dc}"`;
            else if (cols.includes('created_at')) expr = `created_at::date`;
            else if (cols.includes('timestamp')) expr = `date(timestamp)`;
          }
          if (!expr) { counts[table] = null; return; }
          try {
            const row = await libDb.queryOne(`SELECT COUNT(*) AS c FROM "${table}" WHERE ${expr} = ?`, [date]);
            counts[table] = Number(row?.c ?? 0);
          } catch { counts[table] = null; }
        }));
        send(res, 200, { tables: rows.map((r) => ({ ...r, today_rows: counts[r.name] ?? null })) });
      } catch (err) { send(res, 500, { error: 'Database error', detail: String(err) }); }
    },
  });

  // /api/em/ticker-em-stats — per-ticker EM recent/mid averages.
  register('/api/em/ticker-em-stats', {
    auth: 'subscriber', methods: ['GET'],
    async handler(req, res) {
      try {
        const ticker = (new URL(req.url || '/', 'http://localhost').searchParams.get('ticker') || '').trim().toUpperCase();
        if (!ticker) return send(res, 400, { error: 'ticker required' });
        const rows = await libDb.queryAll(
          `SELECT em, week_start FROM em_tracker WHERE ticker = $1 AND em IS NOT NULL AND em > 0
           ORDER BY week_start DESC NULLS LAST LIMIT 12`, [ticker]);
        if (!rows.length) return send(res, 200, { ticker, recentAvg: null, midAvg: null, sampleSize: 0 });
        const ems = rows.map((r) => Number(r.em)).filter((n) => Number.isFinite(n) && n > 0);
        const recentSlice = ems.slice(0, 4);
        const avg = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
        send(res, 200, { ticker, recentAvg: recentSlice.length ? avg(recentSlice) : null, midAvg: ems.length ? avg(ems) : null, sampleSize: ems.length });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // /api/ib-results — EOD IB results. GET reads; POST records ES+NQ (cron).
  if (libIb) {
    register('/api/ib-results', {
      auth: 'subscriber', methods: ['GET', 'POST'],
      async handler(req, res, ctx) {
        const toRthBars = (rows) => rows.map((r) => {
          const [h, m] = String(r.time || '').split(':').map(Number);
          return {
            min: (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0),
            o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close), v: Number(r.volume ?? 0),
          };
        }).filter((b) => b.min >= 570 && b.min < 960 && Number.isFinite(b.c) && b.h >= b.l)
          .sort((a, b) => a.min - b.min);
        const b01 = (v) => (v == null ? null : v ? 1 : 0);
        const SYMBOLS = [
          { symbol: 'ES', table: 'es_candles', get: libDb.getEsCandles },
          { symbol: 'NQ', table: 'nq_candles', get: libDb.getNqCandles },
        ];
        const recordSymbol = async (symbol, table, get, date) => {
          const bars = toRthBars(await get(date, undefined, 2000));
          if (bars.length < 3) return false;
          const trailing = await libDb.getIbTrailingStats(table, date, 70);
          const priorDate = trailing.length ? trailing[trailing.length - 1].date : null;
          let priorRth = null;
          if (priorDate) {
            const prior = toRthBars(await get(priorDate, undefined, 2000));
            if (prior.length) priorRth = { high: Math.max(...prior.map((b) => b.h)), low: Math.min(...prior.map((b) => b.l)) };
          }
          const ibBars = bars.filter((b) => b.min < 630);
          const width = ibBars.length ? Math.max(...ibBars.map((b) => b.h)) - Math.min(...ibBars.map((b) => b.l)) : 0;
          const rec = libIb.computeIbDaily(bars, priorRth, libIb.classifyWidth(width, trailing));
          if (!rec) return false;
          await libDb.upsertIbDailyResult({
            date, symbol,
            ib_high: rec.ibHigh, ib_low: rec.ibLow, ib_mid: rec.ibMid, ib_width: rec.ibWidth,
            width_bucket: rec.widthBucket, bias: rec.bias, first_formed: rec.first,
            close_zone: rec.closeZone, open_type: rec.openType, orb_dir: rec.orbDir, fvg: rec.fvg,
            break_side: rec.breakSide, break_min: rec.breakMin,
            failed: b01(rec.failed), retest: b01(rec.retest), retest_cont: b01(rec.retestCont),
            vol_surge: b01(rec.volSurge),
            single_break: b01(rec.singleBreak), both_broke: b01(rec.bothBroke), neither_broke: b01(rec.neitherBroke),
            contained_at2: b01(rec.containedAt2), contained_broke_late: b01(rec.containedBrokeLate),
            ext_05: b01(rec.ext05), ext_10: b01(rec.ext10), ext_15: b01(rec.ext15), ext_20: b01(rec.ext20),
            first_touch_side: rec.firstTouchSide, first_touch_min: rec.firstTouchMin,
            day_high: rec.dayHigh, day_low: rec.dayLow, day_close: rec.dayClose,
            rules: rec.rules, computed_at: Date.now(),
          });
          return true;
        };
        if (req.method === 'POST') {
          if (!tokenOk(req, ctx)) return send(res, 401, { error: 'unauthorized' });
          try {
            const body = await readJson(req).catch(() => ({}));
            if (body?.action !== 'record') return send(res, 400, { error: 'unknown action' });
            const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : etDateStr();
            const saved = [];
            for (const { symbol, table, get } of SYMBOLS) {
              try { if (await recordSymbol(symbol, table, get, date)) saved.push(symbol); }
              catch (e) { console.warn(`[ib-results] ${symbol} ${date} —`, e?.message || e); }
            }
            return send(res, 200, { date, saved });
          } catch (e) { return send(res, 500, { error: String(e?.message || e) }); }
        }
        try {
          const u = new URL(req.url || '/', 'http://localhost');
          const symbol = (u.searchParams.get('symbol') || 'ES').toUpperCase() === 'NQ' ? 'NQ' : 'ES';
          const limit = Math.min(365, Math.max(1, Number(u.searchParams.get('limit') || 90)));
          send(res, 200, { symbol, rows: await libDb.getIbDailyResults(symbol, limit) });
        } catch (e) { send(res, 500, { error: String(e?.message || e) }); }
      },
    });
  }

  // /api/confidence/calibration — reliability tables from the graded confidence log.
  if (libConf) {
    register('/api/confidence/calibration', {
      auth: 'subscriber', methods: ['GET'],
      async handler(req, res) {
        const HIT_PTS = 8, PIVOT_PTS = 10, CHOP_BAND = 15, MAX_DAYS = 250;
        const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
        const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
        const pickLevel = (r) => {
          const level = num(r.strikeOIVol) ?? num(r.strikeVolOnly) ?? num(r.spxPrice) ?? 0;
          const strikeGex = num(r.mvcValueOIVol) ?? num(r.mvcValueVolOnly) ?? num(r.totalNetGEX_OI) ?? 0;
          const netTotal = num(r.totalNetGEX_OI) ?? num(r.totalNetGEX_Vol) ?? 0;
          const netDex = num(r.totalNetDEX_OI) ?? num(r.totalNetDEX_Vol) ?? num(r.netDEXStrike) ?? 0;
          const storedAbs = num(r.totalAbsNetGEX);
          const totalAbsNetGEX = storedAbs != null && storedAbs > Math.abs(strikeGex) * 1.0001 ? storedAbs : Math.abs(netTotal);
          return {
            level, netGex: strikeGex, netDex,
            spx: (() => { const v = num(r.spxPrice); return v != null && v > 1000 ? v : level; })(),
            totalAbsNetGEX, gexFlip: num(r.gexFlip),
          };
        };
        const classifyDay = (level, spx) => {
          if (!spx.length || !Number.isFinite(level)) return { outcome: 'miss', touched: false };
          let ti = -1;
          for (let i = 0; i < spx.length; i++) { if (Math.abs(spx[i] - level) <= HIT_PTS) { ti = i; break; } }
          if (ti === -1) return { outcome: 'miss', touched: false };
          const fromBelow = spx[ti] <= level;
          let maxAway = 0, maxBand = 0;
          for (let i = ti; i < spx.length; i++) {
            const d = spx[i] - level;
            maxBand = Math.max(maxBand, Math.abs(d));
            maxAway = Math.max(maxAway, fromBelow ? level - spx[i] : spx[i] - level);
          }
          let outcome = 'hit';
          if (maxAway >= PIVOT_PTS) outcome = 'pivot';
          else if (maxBand <= CHOP_BAND) outcome = 'chop';
          return { outcome, touched: true };
        };
        const brier = (p, actual) => (p - actual) ** 2;
        const bucketOf = (p) => (p < 0.2 ? '0–20%' : p < 0.4 ? '20–40%' : p < 0.6 ? '40–60%' : p < 0.8 ? '60–80%' : '80–100%');
        const reliability = (pairs) => {
          const order = ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'];
          const map = new Map();
          for (const b of order) map.set(b, { bucket: b, n: 0, predSum: 0, actualSum: 0 });
          let brierSum = 0;
          for (const { p, actual } of pairs) {
            const b = map.get(bucketOf(p));
            b.n++; b.predSum += p; b.actualSum += actual;
            brierSum += brier(p, actual);
          }
          const rows = order.map((b) => map.get(b)).filter((b) => b.n > 0).map((b) => ({
            bucket: b.bucket, n: b.n,
            predicted: Math.round((b.predSum / b.n) * 100),
            actual: Math.round((b.actualSum / b.n) * 100),
          }));
          return { rows, sample: pairs.length, brier: pairs.length ? Math.round((brierSum / pairs.length) * 1000) / 1000 : null };
        };
        try {
          const refresh = new URL(req.url || '/', 'http://localhost').searchParams.get('refresh') === '1';
          if (refresh) {
            const days = await libDb.queryAll(`SELECT DISTINCT date FROM mvc_snapshots WHERE date < ? ORDER BY date DESC LIMIT ?`, [todayET(), MAX_DAYS]);
            for (const { date } of days) {
              const rows = await libDb.queryAll(`SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp ASC LIMIT 2000`, [date]);
              if (!rows.length) continue;
              const last = rows[rows.length - 1];
              const cur = pickLevel(last);
              const spx = rows.map((r) => num(r.spxPrice)).filter((v) => v != null && v > 1000);
              const refPrice = cur.spx || spx[spx.length - 1] || cur.level || 0;
              const intradayRange = spx.length > 1 ? (Math.max(...spx) - Math.min(...spx)) / 2 : 0;
              const proxScale = Math.max(intradayRange, refPrice * 0.003);
              const emSize = Math.max(intradayRange > 0 ? intradayRange : refPrice * 0.004, refPrice * 0.006);
              const ctx = {
                level: cur.level, price: cur.spx, emSize, intradayRange: proxScale,
                totalAbsNetGEX: cur.totalAbsNetGEX, netGexAtLevel: cur.netGex, netDexAtLevel: cur.netDex,
                gexFlip: cur.gexFlip, sessionProgress: 1,
              };
              const score = libConf.scoreConfidence(ctx, null);
              const { outcome, touched } = classifyDay(cur.level, spx);
              const held = touched ? (outcome === 'pivot' || outcome === 'chop' ? 1 : 0) : null;
              const broke = touched ? (outcome === 'hit' ? 1 : 0) : null;
              await libDb.upsertConfidenceLog({
                date, level: cur.level, regime: score.factors.gammaRegime,
                reach: score.hit, pivot: score.pivot, chop: score.chop, break: score.break,
                netWallBias: score.netWallBias, scored_at: Date.now(),
                touched: touched ? 1 : 0, actual_outcome: outcome, held, broke, graded_at: Date.now(),
              });
            }
          }
          const log = await libDb.getGradedConfidenceLog();
          const reachPairs = log.filter((r) => r.touched != null).map((r) => ({ p: clamp(r.reach / 100, 0, 1), actual: r.touched }));
          const touched = log.filter((r) => r.touched === 1);
          const rejectPairs = touched.filter((r) => r.held != null).map((r) => ({ p: clamp(r.pivot / 100, 0, 1), actual: r.held }));
          const breakPairs = touched.filter((r) => r.broke != null).map((r) => ({ p: clamp(r.break / 100, 0, 1), actual: r.broke }));
          const reach = reliability(reachPairs);
          const reject = reliability(rejectPairs);
          const brk = reliability(breakPairs);
          let biasRight = 0, biasN = 0;
          for (const r of touched) {
            if (r.held == null || r.netWallBias == null) continue;
            if (Math.abs(r.netWallBias) < 1) continue;
            biasN++;
            const predHold = r.netWallBias > 0;
            if ((predHold && r.held === 1) || (!predHold && r.held === 0)) biasRight++;
          }
          send(res, 200, {
            gradedDays: log.length, touchedDays: touched.length,
            reach, reject, break: brk,
            netWallBias: { sample: biasN, accuracy: biasN ? Math.round((biasRight / biasN) * 100) : null },
            thresholds: { hitPts: HIT_PTS, pivotPts: PIVOT_PTS, chopBand: CHOP_BAND },
            heldRule: 'held = pivot OR chop; broke = clean break-through',
            note: log.length < 20
              ? 'Low sample — treat as indicative only. Reliability stabilizes past ~30–50 graded days.'
              : 'Compare predicted vs actual per bucket: close = well-calibrated. Brier < 0.25 beats a coin flip.',
          });
        } catch (err) {
          send(res, 500, { error: 'Calibration error', detail: String(err) });
        }
      },
    });
  }

  // /api/confidence — full confidence model. Logic lives in lib/confidence-compute.ts
  // (extracted verbatim from the route) → bundled to _lib-confidence-route.cjs.
  if (libConfRoute) {
    register('/api/confidence', {
      auth: 'subscriber', methods: ['GET'],
      async handler(req, res) {
        try {
          const sp = new URL(req.url || '/', 'http://localhost').searchParams;
          const r = await libConfRoute.computeConfidence(sp);
          send(res, r.status ?? 200, r.body, { 'Cache-Control': 'no-store', ...(r.headers || {}) });
        } catch (err) { send(res, 500, { error: String(err?.message || err) }); }
      },
    });
  }

  // ── Snapshot recorder/reader pairs (subscriber; recorders POST via internal token) ──

  // /api/snapshots/greeks
  register('/api/snapshots/greeks', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res) {
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          const now = new Date();
          const gexB = Number(body.gex ?? 0), dexB = Number(body.dex ?? 0), chexM = Number(body.chex ?? 0), vexM = Number(body.vex ?? 0);
          await libDb.insertGreeksTs({
            timestamp: body.timestamp ?? now.getTime(), date: body.date ?? etDateStr(now),
            time: body.time ?? now.toTimeString().split(' ')[0], ticker: body.ticker ?? 'SPXW',
            price: Number(body.price ?? 0),
            gexRaw: gexB * 1e9, dexRaw: dexB * 1e9, chexRaw: chexM * 1e6, vexRaw: vexM * 1e6,
            gex: gexB, dex: dexB, chex: chexM, vex: vexM,
            buyScore: Number(body.buyScore ?? 0), sellScore: Number(body.sellScore ?? 0),
          });
          return send(res, 200, { ok: true });
        } catch (err) { return send(res, 500, { error: String(err) }); }
      }
      try {
        const sp = new URL(req.url || '/', 'http://localhost').searchParams;
        send(res, 200, { rows: await libDb.getGreeksTs(sp.get('date') ?? undefined, Math.min(Number(sp.get('limit') ?? 1000), 5000)) });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // /api/snapshots/premium
  register('/api/snapshots/premium', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res) {
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          const now = new Date();
          await libDb.insertPremiumFlow({
            timestamp: body.timestamp ?? now.getTime(), date: body.date ?? etDateStr(now),
            time: body.time ?? now.toTimeString().split(' ')[0],
            callPremium: body.callPremium ?? 0, putPremium: body.putPremium ?? 0,
            netPremium: body.netPremium ?? 0, spxPrice: body.spxPrice ?? 0,
          });
          return send(res, 200, { ok: true });
        } catch (err) { return send(res, 500, { error: String(err) }); }
      }
      try {
        const sp = new URL(req.url || '/', 'http://localhost').searchParams;
        send(res, 200, { rows: await libDb.getPremiumFlow(sp.get('date') ?? undefined, Math.min(Number(sp.get('limit') ?? 500), 2000)) });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // /api/snapshots/ib
  register('/api/snapshots/ib', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res) {
      if (req.method === 'POST') {
        try {
          const b = await readJson(req);
          if (!b?.date) return send(res, 400, { error: 'date required' });
          await libDb.upsertIbLevels({
            date: String(b.date), symbol: String(b.symbol ?? '/ES'), timestamp: Number(b.timestamp ?? Date.now()),
            locked: Number(b.locked ?? 0), high: Number(b.high ?? 0), low: Number(b.low ?? 0), mid: Number(b.mid ?? 0),
            range: Number(b.range ?? 0), rangePct: Number(b.rangePct ?? 0), openPrice: Number(b.openPrice ?? 0),
            lowFirst: b.lowFirst == null ? null : Number(b.lowFirst), barCount: Number(b.barCount ?? 0),
          });
          const row = await libDb.getIbLevels(String(b.date));
          return send(res, 200, { ok: true, locked: row?.locked ?? 0, row });
        } catch (err) { return send(res, 500, { error: String(err) }); }
      }
      try {
        const date = new URL(req.url || '/', 'http://localhost').searchParams.get('date') ?? '';
        if (!date) return send(res, 200, { row: null });
        send(res, 200, { row: await libDb.getIbLevels(date) });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // /api/snapshots/bzila
  register('/api/snapshots/bzila', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res) {
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          const now = new Date();
          const id = await libDb.insertBzilaSnapshot({
            timestamp: body.timestamp ?? now.getTime(), date: body.date ?? etDateStr(now),
            time: body.time ?? now.toTimeString().split(' ')[0], ticker: body.ticker ?? 'SPX',
            session: body.session ?? 'rth', orders: Array.isArray(body.orders) ? body.orders : [], stats: body.stats ?? {},
          });
          return send(res, 200, { ok: true, id });
        } catch (err) { return send(res, 500, { error: String(err) }); }
      }
      try {
        const sp = new URL(req.url || '/', 'http://localhost').searchParams;
        const date = sp.get('date') ?? undefined, session = sp.get('session') ?? undefined;
        if (sp.get('latest') === '1') return send(res, 200, { snap: await libDb.getLatestBzilaSnapshot(date, session) });
        const rows = await libDb.getBzilaSnapshots(date, Math.min(Number(sp.get('limit') ?? 200), 1000));
        const parsed = rows.map((r) => ({
          ...r,
          orders: typeof r.orders === 'string' ? JSON.parse(r.orders) : r.orders,
          stats: typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats,
        }));
        send(res, 200, { rows: parsed });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // /api/snapshots/mvc
  register('/api/snapshots/mvc', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res) {
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          const now = new Date();
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const id = await libDb.insertMvcSnapshot({
            timestamp: body.timestamp ?? now.getTime(), date: body.date ?? etDateStr(now),
            day: body.day ?? days[now.getDay()], time: body.time ?? now.toTimeString().split(' ')[0],
            strikeOIVol: body.strikeOIVol ?? null, mvcValueOIVol: body.mvcValueOIVol ?? 0, pctOI_Vol: body.pctOI_Vol ?? null,
            volumeOIVol: body.volumeOIVol ?? 0, totalNetGEX_OI: body.totalNetGEX_OI ?? 0,
            strikeVolOnly: body.strikeVolOnly ?? null, mvcValueVolOnly: body.mvcValueVolOnly ?? 0, pctVol_Only: body.pctVol_Only ?? null,
            volumeVolOnly: body.volumeVolOnly ?? 0, totalNetGEX_Vol: body.totalNetGEX_Vol ?? 0,
            spxPrice: body.spxPrice ?? 0, esPrice: body.esPrice ?? 0,
            netDEXStrike: body.netDEXStrike ?? null, totalNetDEX_OI: body.totalNetDEX_OI ?? null, totalNetDEX_Vol: body.totalNetDEX_Vol ?? null,
            totalAbsNetGEX: body.totalAbsNetGEX ?? 0, gexFlip: body.gexFlip ?? null,
            triggerType: body.triggerType ?? 'manual', expiration: body.expiration ?? '—',
          });
          return send(res, 200, { ok: true, id });
        } catch (err) { return send(res, 500, { error: String(err) }); }
      }
      try {
        const sp = new URL(req.url || '/', 'http://localhost').searchParams;
        const days = Number(sp.get('days') ?? 0);
        const since = days > 0 ? Date.now() - days * 86_400_000 : undefined;
        const limit = Math.min(Number(sp.get('limit') ?? 200), 1000);
        // ?lite=1 — the FOUR columns the ES-candles CB line actually reads,
        // tuple-encoded. mvc_snapshots has ~22 columns; the default read is a
        // `SELECT *` (see getMvcSnapshots), so `?limit=1000` was shipping ~94KB
        // to plot one step line and derive a basis. Narrow projection + tuples
        // takes that to a few KB. Opt-in; the default path is unchanged.
        if (sp.get('lite') === '1') {
          const date = sp.get('date') ?? undefined;
          const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
          // Projection matches the `sinceMs` branch of getMvcSnapshots. Done
          // here with queryAll rather than as a new bundle export, so
          // _lib-db.cjs needs no further hand-patching.
          const lrows = date
            ? await libDb.queryAll(
                'SELECT timestamp, "strikeOIVol", "spxPrice", "esPrice" FROM mvc_snapshots WHERE date = ? ORDER BY timestamp DESC LIMIT ?',
                [date, limit])
            : since
              ? await libDb.queryAll(
                  'SELECT timestamp, "strikeOIVol", "spxPrice", "esPrice" FROM mvc_snapshots WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?',
                  [since, limit])
              : await libDb.queryAll(
                  'SELECT timestamp, "strikeOIVol", "spxPrice", "esPrice" FROM mvc_snapshots ORDER BY timestamp DESC LIMIT ?',
                  [limit]);
          send(res, 200, {
            lite: 1,
            cols: ['timestamp', 'strikeOIVol', 'spxPrice', 'esPrice'],
            rows: lrows.map((r) => [num(r.timestamp), num(r.strikeOIVol), num(r.spxPrice), num(r.esPrice)]),
          });
          return;
        }
        send(res, 200, { rows: await libDb.getMvcSnapshots(sp.get('date') ?? undefined, limit, since) });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // /api/snapshots/candles
  register('/api/snapshots/candles', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res) {
      const isNq = (sym) => !!sym && /nq/i.test(sym);
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          const candles = Array.isArray(body) ? body : [body];
          for (const c of candles) {
            const upsert = isNq(c.symbol) ? libDb.upsertNqCandle : libDb.upsertEsCandle;
            await upsert({
              timestamp: Number(c.timestamp), date: String(c.date), slotKey: String(c.slotKey),
              time: String(c.time ?? ''), symbol: String(c.symbol ?? '/ES'),
              intervalMinutes: Number(c.intervalMinutes ?? 5), source: String(c.source ?? 'dxlink'),
              open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
              volume: Number(c.volume), avgVolume: Number(c.avgVolume ?? 0),
            });
          }
          return send(res, 200, { ok: true, count: candles.length });
        } catch (err) { return send(res, 500, { error: String(err) }); }
      }
      try {
        const sp = new URL(req.url || '/', 'http://localhost').searchParams;
        const date = sp.get('date') ?? undefined;
        const daysBack = sp.get('daysBack') ? Number(sp.get('daysBack')) : undefined;
        const limit = Math.min(Number(sp.get('limit') ?? 2000), 50000);
        const interval = Number(sp.get('interval') ?? 5) === 1 ? 1 : 5;
        const rows = isNq(sp.get('symbol'))
          ? await libDb.getNqCandles(date, daysBack, limit)
          : await libDb.getEsCandles(date, daysBack, limit, interval);
        // ?lite=1 — columnar/tuple encoding. Same rows, ~8-10x fewer bytes.
        //
        // The verbose form repeats every key on every bar ("timestamp":,"open":,
        // "high":,"low":,"close":,"volume":,"slotKey":,…) AND ships pg BIGINT /
        // REAL columns as QUOTED STRINGS (see normalizeCandle in lib/snapdb.ts).
        // A 20-day 5m pull was ~114KB of which the overwhelming majority was key
        // names and quotes. Tuples in a fixed column order carry the same
        // information with none of that.
        //
        // Opt-in: without ?lite=1 the response is byte-for-byte what it always
        // was, so every other caller is untouched.
        if (sp.get('lite') === '1') {
          const cols = ['timestamp', 'date', 'slotKey', 'time', 'symbol', 'intervalMinutes', 'open', 'high', 'low', 'close', 'volume', 'avgVolume'];
          // Numbers emitted as numbers, not strings — the client's per-row
          // Number() coercion becomes unnecessary on the lite path.
          const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
          send(res, 200, {
            lite: 1,
            cols,
            rows: rows.map((r) => [
              num(r.timestamp), String(r.date ?? ''), String(r.slotKey ?? ''), String(r.time ?? ''),
              String(r.symbol ?? ''), num(r.intervalMinutes), num(r.open), num(r.high),
              num(r.low), num(r.close), num(r.volume), num(r.avgVolume),
            ]),
          });
          return;
        }
        send(res, 200, { rows });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // /api/snapshots/etf-candles — SPY / QQQ OHLC history out of the etf_candles
  // table (written by server-v2/etf-candle-recorder.js).
  //
  // Deliberately SEPARATE from /api/snapshots/candles: that route serves the
  // ES/NQ futures tables via lib/db, keyed by contract with its own slotKey
  // space and a 20-day window. ETFs are a different instrument with a different
  // recorder and only 1m storage, so folding them in would mean a symbol switch
  // inside every branch of that handler. Same ROW SHAPE though — the client can
  // feed either into the same chart.
  //
  // ?symbol=SPY  ?days=5  ?interval=1|5  ?limit=5000
  register('/api/snapshots/etf-candles', {
    auth: 'subscriber', methods: ['GET'],
    async handler(req, res) {
      try {
        const sp = new URL(req.url || '/', 'http://localhost').searchParams;
        const symbol = String(sp.get('symbol') ?? '').trim().toUpperCase();
        if (!symbol) { send(res, 200, { rows: [], error: 'symbol is required' }); return; }
        const days = Math.max(1, Math.min(30, Number(sp.get('days') ?? 5)));
        const interval = Number(sp.get('interval') ?? 5) === 1 ? 1 : 5;
        const limit = Math.max(1, Math.min(50_000, Number(sp.get('limit') ?? 5000)));
        const { getEtfCandleHistory } = require('./etf-candle-recorder');
        const rows = await getEtfCandleHistory(symbol, days, interval, limit);
        send(res, 200, { symbol, interval, days, rows });
      } catch (err) { send(res, 200, { rows: [], error: String(err) }); }
    },
  });

  // /api/snapshots/playbook
  register('/api/snapshots/playbook', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res) {
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          const now = new Date();
          const id = await libDb.insertPlaybookFeed({
            timestamp: Number(body.timestamp ?? now.getTime()), date: body.date ?? etDateStr(now),
            time: body.time ?? now.toTimeString().split(' ')[0], text: String(body.text ?? ''),
            color: body.color ? String(body.color) : null, source: body.source ? String(body.source) : 'insights-exposure',
            expiry: body.expiry ? String(body.expiry) : null, regime_key: body.regimeKey ? String(body.regimeKey) : null,
            spot: body.spot == null ? null : Number(body.spot), gex: body.gex == null ? null : Number(body.gex),
            dex: body.dex == null ? null : Number(body.dex), chex: body.chex == null ? null : Number(body.chex),
            vex: body.vex == null ? null : Number(body.vex),
          });
          return send(res, 200, { ok: true, id });
        } catch (err) { return send(res, 500, { error: String(err) }); }
      }
      try {
        const sp = new URL(req.url || '/', 'http://localhost').searchParams;
        send(res, 200, { rows: await libDb.getPlaybookFeed(sp.get('date') ?? undefined, Math.min(Number(sp.get('limit') ?? 200), 2000)) });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // /api/cache/expirations
  register('/api/cache/expirations', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res) {
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          const expirations = Array.isArray(body.expirations) ? body.expirations : [];
          await libDb.upsertExpirationCache(body.ticker ?? 'SPX', expirations, body.raw ?? body);
          return send(res, 200, { ok: true });
        } catch (err) { return send(res, 500, { error: String(err) }); }
      }
      try {
        const ticker = new URL(req.url || '/', 'http://localhost').searchParams.get('ticker') ?? 'SPX';
        const data = await libDb.getCachedExpirations(ticker);
        send(res, 200, { data, hit: data !== null });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // /api/waitlist/count — public signup count (no emails exposed).
  register('/api/waitlist/count', {
    auth: 'public', methods: ['GET'],
    async handler(req, res) {
      try { send(res, 200, { ok: true, count: await libDb.countWaitlist() }); }
      catch (err) { send(res, 500, { ok: false, error: 'Server error.' }); }
    },
  });

  // /api/feedback — POST any signed-in user; GET/PATCH owner-only.
  register('/api/feedback', {
    auth: 'user', methods: ['GET', 'POST', 'PATCH'],
    async handler(req, res, ctx, access) {
      const userId = access.userId;
      if (req.method === 'POST') {
        try {
          if (!userId) return send(res, 401, { error: 'Sign in to send feedback' });
          const body = await readJson(req);
          const message = String(body?.message ?? '').trim();
          if (!message) return send(res, 400, { error: 'Message is required' });
          if (message.length > 5000) return send(res, 400, { error: 'Message too long' });
          let email = null;
          try { const u = await libDb.getUserById(userId); email = u?.email ?? null; } catch { /* email optional */ }
          const row = await libDb.addFeedback({
            clerk_user_id: userId, email,
            category: body?.category ? String(body.category) : 'note',
            message, page: body?.page ? String(body.page) : null,
          });
          return send(res, 200, { ok: true, feedback: row });
        } catch (err) { return send(res, 500, { error: 'Feedback save failed', detail: String(err) }); }
      }
      // GET / PATCH — owner only (mirrors the route's ownerGate).
      if (!ctx.ownerUserId || userId !== ctx.ownerUserId) return send(res, 403, { error: 'Forbidden' });
      if (req.method === 'PATCH') {
        try {
          const body = await readJson(req);
          const id = Number(body?.id ?? 0);
          const status = body?.status === 'open' ? 'open' : 'resolved';
          if (!id) return send(res, 400, { error: 'id required' });
          await libDb.setFeedbackStatus(id, status);
          return send(res, 200, { ok: true });
        } catch (err) { return send(res, 500, { error: 'Feedback update failed', detail: String(err) }); }
      }
      try {
        const status = new URL(req.url || '/', 'http://localhost').searchParams.get('status') || undefined;
        const items = await libDb.listFeedback({ status });
        const openCount = (await libDb.listFeedback({ status: 'open', limit: 1000 })).length;
        send(res, 200, { items, openCount });
      } catch (err) { send(res, 500, { error: 'Feedback load failed', detail: String(err) }); }
    },
  });

  // ── Journal /trading (per-user; needs the bundled CSV parser) ────────────────
  if (libJournalCsv) {
    const loadTrades = async (uid) => {
      const key = (o, c) => `${o}|${c}`;
      const fills = await libDb.getTradingFills(uid);
      const derived = libJournalCsv.matchRoundTrips(fills);
      const overrides = await libDb.getTradeOverrides(uid);
      if (!overrides.size) return derived;
      const out = [];
      for (const t of derived) {
        const o = overrides.get(key(t.open_ext_id, t.close_ext_id));
        if (!o) { out.push(t); continue; }
        if (o.deleted) continue;
        out.push({
          symbol: o.symbol, underlying: o.underlying, asset_type: o.asset_type,
          direction: o.direction, open_ts: o.open_ts, close_ts: o.close_ts,
          date: o.date, qty: o.qty, entry: o.entry, exit: o.exit, fees: o.fees, pnl: o.pnl,
          account: o.account, open_ext_id: t.open_ext_id, close_ext_id: t.close_ext_id,
        });
      }
      return out.sort((a, b) => a.close_ts - b.close_ts);
    };

    // /api/journal/trades — GET derived trades; PATCH edit; DELETE hide (override rows).
    register('/api/journal/trades', {
      auth: 'user', methods: ['GET', 'PATCH', 'DELETE'],
      async handler(req, res, ctx, access) {
        const userId = access.userId;
        if (req.method === 'PATCH') {
          try {
            if (!userId) return send(res, 401, { error: 'unauthorized' });
            const body = await readJson(req).catch(() => ({}));
            const openExtId = String(body.openExtId ?? '').trim();
            const closeExtId = String(body.closeExtId ?? '').trim();
            if (!openExtId || !closeExtId) return send(res, 400, { error: 'openExtId and closeExtId are required' });
            const trades = await loadTrades(userId);
            const match = trades.find((t) => t.open_ext_id === openExtId && t.close_ext_id === closeExtId);
            if (!match) return send(res, 404, { error: 'trade not found' });
            const symbol = String(body.symbol ?? match.symbol).trim().toUpperCase() || match.symbol;
            const account = String(body.account ?? match.account ?? '').trim();
            const direction = body.direction === 'short' ? 'short' : body.direction === 'long' ? 'long' : match.direction;
            const openTs = Number.isFinite(Number(body.openTs)) ? Number(body.openTs) : match.open_ts;
            const closeTs = Number.isFinite(Number(body.closeTs)) ? Number(body.closeTs) : match.close_ts;
            const qty = Number.isFinite(Number(body.qty)) && Number(body.qty) > 0 ? Number(body.qty) : match.qty;
            const entry = Number.isFinite(Number(body.entry)) ? Number(body.entry) : match.entry;
            const exit = Number.isFinite(Number(body.exit)) ? Number(body.exit) : match.exit;
            const fees = Number.isFinite(Number(body.fees)) ? Number(body.fees) : match.fees;
            const cls = libJournalCsv.classify(symbol);
            const gross = (direction === 'long' ? exit - entry : entry - exit) * qty * cls.multiplier;
            const pnl = gross - fees;
            const override = {
              open_ext_id: openExtId, close_ext_id: closeExtId,
              symbol, underlying: cls.underlying, asset_type: cls.asset_type, direction,
              open_ts: openTs, close_ts: closeTs, date: libJournalCsv.sessionDate(closeTs),
              qty, entry, exit, fees, pnl, account, deleted: false,
            };
            await libDb.upsertTradeOverride(userId, override);
            return send(res, 200, { ok: true, trade: { ...override, open_ext_id: openExtId, close_ext_id: closeExtId } });
          } catch (err) { return send(res, 500, { error: String(err) }); }
        }
        if (req.method === 'DELETE') {
          try {
            if (!userId) return send(res, 401, { error: 'unauthorized' });
            const sp = new URL(req.url || '/', 'http://localhost').searchParams;
            const openExtId = String(sp.get('openExtId') ?? '').trim();
            const closeExtId = String(sp.get('closeExtId') ?? '').trim();
            if (!openExtId || !closeExtId) return send(res, 400, { error: 'openExtId and closeExtId are required' });
            const trades = await loadTrades(userId);
            const match = trades.find((t) => t.open_ext_id === openExtId && t.close_ext_id === closeExtId);
            if (!match) return send(res, 404, { error: 'trade not found' });
            await libDb.upsertTradeOverride(userId, {
              open_ext_id: openExtId, close_ext_id: closeExtId,
              symbol: match.symbol, underlying: match.underlying, asset_type: match.asset_type,
              direction: match.direction, open_ts: match.open_ts, close_ts: match.close_ts, date: match.date,
              qty: match.qty, entry: match.entry, exit: match.exit, fees: match.fees, pnl: match.pnl,
              account: match.account, deleted: true,
            });
            return send(res, 200, { ok: true });
          } catch (err) { return send(res, 500, { error: String(err) }); }
        }
        try {
          if (!userId) return send(res, 401, { trades: [], accounts: [] });
          const trades = await loadTrades(userId);
          send(res, 200, { trades, accounts: libJournalCsv.deriveAccountStats(trades) });
        } catch (err) { send(res, 500, { error: String(err) }); }
      },
    });

    // /api/journal/import — broker CSV preview/commit for /trading.
    register('/api/journal/import', {
      auth: 'user', methods: ['POST'],
      async handler(req, res, ctx, access) {
        const userId = access.userId;
        const MAX_CSV_BYTES = 8 * 1024 * 1024;
        const crossSourceWarning = (existingFills, dates, incomingSource) => {
          const touched = new Set(dates);
          const otherSources = new Set();
          for (const f of existingFills) {
            if (touched.has(f.date) && f.source && f.source !== incomingSource) otherSources.add(f.source);
          }
          if (!otherSources.size) return [];
          return [
            `${dates.length === 1 ? 'This date' : 'Some of these dates'} already ha${dates.length === 1 ? 's' : 've'} fills imported from a different source ` +
            `(${[...otherSources].join(', ')}). If that's the SAME trading activity re-exported from a different tool ` +
            `(e.g. a raw fills export vs. an already-matched trades export), importing both will double-count every trade. ` +
            `Only proceed if this file covers different trades or a different account than what's already there.`,
          ];
        };
        const warningsFor = (unknownRoots, skipped, fills) => {
          const w = [];
          if (unknownRoots.length) {
            w.push(`Unknown futures contract${unknownRoots.length > 1 ? 's' : ''}: ${unknownRoots.join(', ')}. ` +
              `No point value on file, so P&L for these is computed at 1×/point and will be wrong. ` +
              `Add the root to FUTURES_MULT in lib/journal/csv.ts before relying on it.`);
          }
          if (skipped) w.push(`${skipped} row${skipped > 1 ? 's' : ''} skipped (summary lines, cash movements, or missing price/qty/time).`);
          if (fills.every((f) => f.fees === 0)) w.push('No commission column found — commissions will read $0 and net P&L is gross.');
          return w;
        };
        try {
          if (!userId) return send(res, 401, { error: 'unauthorized' });
          const body = await readJson(req).catch(() => ({}));
          const csv = String(body.csv ?? '');
          if (!csv.trim()) return send(res, 400, { error: 'csv required' });
          if (csv.length > MAX_CSV_BYTES) return send(res, 413, { error: 'file too large (max 8MB)' });
          const broker = body.broker ? String(body.broker) : undefined;
          const map = body.map ?? undefined;
          const commit = body.commit === true;
          const parsed = libJournalCsv.importCsv(csv, broker, map);
          if (!parsed.fills.length) {
            return send(res, 422, { error: 'No executions found in that file.', broker: parsed.broker, header: parsed.header, skipped: parsed.skipped });
          }
          if (!commit) {
            const existingFills = await libDb.getTradingFills(userId);
            const crossSource = crossSourceWarning(existingFills, parsed.days.map((d) => d.date), parsed.broker);
            return send(res, 200, {
              ok: true, preview: true, broker: parsed.broker, header: parsed.header,
              counts: { fills: parsed.fills.length, trades: parsed.trades.length, days: parsed.days.length },
              days: parsed.days, trades: parsed.trades.slice(0, 50), skipped: parsed.skipped,
              warnings: [...warningsFor(parsed.unknownRoots, parsed.skipped, parsed.fills), ...crossSource],
            });
          }
          const inserted = await libDb.insertTradingFills(userId, parsed.fills);
          const all = await libDb.getTradingFills(userId);
          const trades = libJournalCsv.matchRoundTrips(all);
          const days = libJournalCsv.deriveDays(trades);
          const touched = new Set(parsed.days.map((d) => d.date));
          const affected = days.filter((d) => touched.has(d.date));
          const rows = [];
          for (const d of affected) { const row = await libDb.upsertTradingJournalDay(userId, d); if (row) rows.push(row); }
          return send(res, 200, {
            ok: true, preview: false, broker: parsed.broker,
            inserted, duplicates: parsed.fills.length - inserted, days: rows,
            warnings: warningsFor(parsed.unknownRoots, parsed.skipped, parsed.fills),
          });
        } catch (err) { return send(res, 500, { error: String(err) }); }
      },
    });
  }

  // /api/tpo-forecast — k-NN TPO day forecast (bundled from lib/tpo-forecast-compute.ts).
  if (libTpoForecast) {
    register('/api/tpo-forecast', {
      auth: 'subscriber', methods: ['GET'],
      async handler(req, res) {
        try {
          const sp = new URL(req.url || '/', 'http://localhost').searchParams;
          const r = await libTpoForecast.computeTpoForecast(sp);
          send(res, r.status ?? 200, r.body, { 'Cache-Control': 'no-store' });
        } catch (err) { send(res, 500, { error: String(err?.message || err) }); }
      },
    });
  }

  // /api/obook — order-book tenor-split read (bundled from lib/obook-compute.ts).
  if (libObook) {
    register('/api/obook', {
      auth: 'subscriber', methods: ['GET'],
      async handler(req, res) {
        try {
          const sp = new URL(req.url || '/', 'http://localhost').searchParams;
          const r = await libObook.computeObook(sp);
          send(res, r.status ?? 200, r.body, r.headers || {});
        } catch (err) { send(res, 500, { error: String(err?.message || err) }); }
      },
    });
  }

  // /api/snapshots/option-strike-gex-history — heatmap/point/rolling reads of the
  // append-only option_strike_gex_history table + POST recorder. Ported verbatim
  // from app/api/snapshots/option-strike-gex-history/route.ts (module-level 30s
  // heatmap cache preserved). GET is subscriber; POST recorder uses internal token
  // (enforceAuth 'subscriber' honors the x-internal-token bypass first).
  {
    const HEATMAP_TTL_MS = 30_000;
    const heatmapCache = new Map(); // module-level within this route's closure
    register('/api/snapshots/option-strike-gex-history', {
      auth: 'subscriber', methods: ['GET', 'POST'],
      async handler(req, res) {
        if (req.method === 'POST') {
          try {
            const body = await readJson(req);
            const rows = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : [body];
            const normalized = rows.map((row) => ({
              timestamp: Number(row.timestamp ?? Date.now()),
              date: String(row.date ?? todayET()),
              expiry: String(row.expiry ?? ''),
              spot: Number(row.spot ?? 0),
              strike: Number(row.strike ?? 0),
              net_gex: Number(row.net_gex ?? 0),
              net_vol_gex: row.net_vol_gex == null ? undefined : Number(row.net_vol_gex),
              // Underlying. Omitted → '$SPX', which is what every row written
              // before this column existed is.
              symbol: libDb.normGexSymbol(row.symbol ?? body?.symbol),
            })).filter((row) => row.expiry && row.strike > 0 && Number.isFinite(row.net_gex));
            await libDb.insertOptionStrikeGexRows(normalized);
            send(res, 200, { ok: true, count: normalized.length });
          } catch (err) {
            // LOG IT. This used to fail into a 200 with an `error` key and no
            // console output at all — a bad recorder POST was invisible.
            console.error('[option-strike-gex-history] POST failed:', err);
            send(res, 200, { error: String(err) });
          }
          return;
        }
        try {
          const sp = new URL(req.url || '/', 'http://localhost').searchParams;
          const date = sp.get('date') ?? todayET();
          const expiry = sp.get('expiry') ?? '';
          const mode = sp.get('mode') ?? 'rolling';
          // Underlying selector. Absent → '$SPX', so every existing caller
          // (the SPX heatmap, the strike popup) is byte-for-byte
          // unchanged. The ES-Candles page passes SPY / QQQ here.
          const symbol = libDb.normGexSymbol(sp.get('symbol'));
          if (!expiry) { send(res, 200, { error: 'expiry is required', rows: [] }); return; }

          if (mode === 'heatmap') {
            const winParam = sp.get('minutes');
            // 5760 = 4 days. Was 2880 (48h), which matched the OLD wall-clock
            // retention. Retention now keeps 2 SESSIONS (see
            // pruneOptionStrikeGexHistory in _lib-db.cjs) and two sessions can
            // straddle a weekend — Friday's open is ~78h behind Monday's close
            // — so a 48h clamp silently truncated the request to less than the
            // data that exists. Retention still bounds the RESPONSE size; this
            // clamp only bounds how far back a caller may look.
            const winMin = winParam == null ? 1440 : Math.max(0, Math.min(5760, Number(winParam)));
            const anyExpiry = sp.get('anyExpiry') === '1';
            // ?top=N — return only the N strongest strikes per column instead of
            // the whole ladder. The bubble trail draws exactly this (cfg.topStrikes,
            // default 10, max 30), so shipping every strike for every minute of a
            // 24h window and discarding ~90% of it in the browser is pure waste.
            //
            // 0 / absent = no truncation. The CLIENT decides, because the heatmap
            // band genuinely needs the full ladder — see the crossing note below.
            const topN = Math.max(0, Math.min(500, Number(sp.get('top') ?? 0)));
            // top is part of the cache key or a bubbles-only request would serve
            // its truncated columns to a heatmap request for the next 30s.
            const cacheKey = `${symbol}|${winMin}|${anyExpiry ? 'any' : expiry}|${anyExpiry ? '' : date}|t${topN}`;
            const cached = heatmapCache.get(cacheKey);
            if (cached && Date.now() - cached.at < HEATMAP_TTL_MS) { send(res, 200, cached.payload); return; }
            const slots = winMin > 0
              ? anyExpiry
                ? await libDb.getOptionStrikeGexSlotsWindowAny(Date.now() - winMin * 60 * 1000, symbol)
                : await libDb.getOptionStrikeGexSlotsWindow(Date.now() - winMin * 60 * 1000, expiry, symbol)
              : await libDb.getOptionStrikeGexSlots(date, expiry, symbol);
            const bySlot = new Map();
            const spotBySlot = new Map();
            for (const r of slots) {
              if (!(r.strike > 0) || !Number.isFinite(r.net_gex)) continue;
              let arr = bySlot.get(r.slot_ts);
              if (!arr) { arr = []; bySlot.set(r.slot_ts, arr); }
              const netVol = Number(r.net_vol_gex ?? 0);
              arr.push({ strike: r.strike, net: r.net_gex + (Number.isFinite(netVol) ? netVol : 0), netVol });
              const spot = Number(r.spot ?? 0);
              if (spot > 0 && !spotBySlot.has(r.slot_ts)) spotBySlot.set(r.slot_ts, spot);
            }
            const columns = [...bySlot.entries()].sort((a, b) => a[0] - b[0]).map(([slotTs, cells]) => {
              // max / top3 are computed from the FULL ladder, BEFORE any
              // truncation, so the client's color ramp and radius scale are
              // identical whether or not ?top was used.
              const absVals = cells.map((c) => Math.abs(c.net)).filter((v) => v > 0);
              const max = absVals.length ? Math.max(...absVals) : 1;
              const top3 = [...absVals].sort((a, b) => b - a).slice(0, 3);
              // ── Gamma flip, computed HERE on the FULL ladder ────────────────
              // Shipped as one number per column so no client ever has to
              // reconstruct it from the cells.
              //
              // This replaces an earlier attempt that truncated the cells but
              // kept every sign-change bracket to protect the flip. Two things
              // were wrong with that. It barely truncated in practice (measured
              // on live data: 330 strikes/column with 13.5 sign changes, so the
              // brackets re-admitted ~27 strikes on top of the top-N), and more
              // importantly it was UNSOUND — dropping intermediate strikes
              // changes which strikes are adjacent, so a truncated ladder can
              // manufacture sign changes that do not exist in the full profile.
              // Any "truncate, then rebuild the flip from the survivors" scheme
              // has that hole. Computing it before truncation closes it, and
              // lets the Flip X overlay stop demanding the whole ladder.
              //
              // Rule is byte-for-byte the client's: interpolate each sign
              // change, then pick the crossing NEAREST this column's spot
              // (falling back to the lowest crossing when spot is missing, as
              // legacy rows have no spot).
              const spot = spotBySlot.get(slotTs) ?? 0;
              const byStrike = [...cells].sort((a, b) => a.strike - b.strike);
              const flipOn = (valOf) => {
                const crossings = [];
                for (let i = 0; i < byStrike.length - 1; i++) {
                  const a = valOf(byStrike[i]);
                  const b = valOf(byStrike[i + 1]);
                  if (a === 0) { crossings.push(byStrike[i].strike); continue; }
                  if (b === 0) { crossings.push(byStrike[i + 1].strike); continue; }
                  if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
                    const sA = byStrike[i].strike, sB = byStrike[i + 1].strike;
                    const z = sA + (sB - sA) * (Math.abs(a) / (Math.abs(a) + Math.abs(b)));
                    if (Number.isFinite(z)) crossings.push(Math.round(z * 10) / 10);
                  }
                }
                if (!crossings.length) return null;
                if (!(spot > 0)) return crossings[0];
                return crossings.reduce((best, c) => (Math.abs(c - spot) < Math.abs(best - spot) ? c : best));
              };
              // Both metrics: the client's Vol+OI / Vol-only toggle picks which
              // series the flip is read off, and it must not trigger a refetch.
              const flip = flipOn((c) => c.net);
              const flipVol = flipOn((c) => c.netVol);

              // Truncation is now purely a bubble-rendering concern — nothing
              // downstream reads the ladder's shape, only its peaks.
              const out = topN > 0 && cells.length > topN
                ? [...cells].sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, topN).sort((a, b) => a.strike - b.strike)
                : cells;
              return { slotTs, cells: out, max, top3, spot, flip, flipVol };
            });
            const payload = { mode: 'heatmap', symbol, columns };
            heatmapCache.set(cacheKey, { at: Date.now(), payload });
            send(res, 200, payload);
            return;
          }

          if (mode === 'point') {
            const ages = (sp.get('ages') ?? '5,15,30').split(',')
              .map((a) => Math.max(1, Math.min(240, Number(a.trim())))).filter((a) => Number.isFinite(a));
            const now = Date.now();
            const tolerant = sp.get('tolerant') === '1';
            const asOf = tolerant ? libDb.getOptionStrikeNetGexAsOfOrNearest : libDb.getOptionStrikeNetGexAsOf;
            const [openRows, ...ageRowSets] = await Promise.all([
              libDb.getOptionStrikeNetGexAtOpen(date, expiry, symbol),
              ...ages.map((m) => asOf(date, expiry, now - m * 60 * 1000, symbol)),
            ]);
            const baselines = {};
            const put = (strike, key, v) => { (baselines[strike] ??= {})[key] = v; };
            const oiVol = (r) => r.net_gex + (Number.isFinite(r.net_vol_gex) ? r.net_vol_gex : 0);
            for (const r of openRows) put(r.strike, 'open', oiVol(r));
            ages.forEach((m, i) => { for (const r of ageRowSets[i]) put(r.strike, String(m), oiVol(r)); });
            send(res, 200, { mode: 'point', symbol, ages, baselines });
            return;
          }

          const minutes = Math.max(1, Math.min(240, Number(sp.get('minutes') ?? 30)));
          const sinceTimestamp = Date.now() - minutes * 60 * 1000;
          const rows = await libDb.getOptionStrikeRollingNetGex(date, expiry, sinceTimestamp, symbol);
          send(res, 200, { rows, minutes, symbol });
        } catch (err) {
          // LOG IT. Returning 200 with an `error` key and NO server-side log is
          // how `libDb.normGexSymbol is not a function` stayed hidden: the
          // client's `if (!res.ok) return` never fired, the missing `columns`
          // key was treated as "no data yet", and the heatmap + bubble backfill
          // silently returned nothing for days. The 200 is kept (callers depend
          // on it) — but it is never again silent.
          console.error('[option-strike-gex-history] GET failed:', req.url, err);
          send(res, 200, { error: String(err), rows: [] });
        }
      },
    });
  }

  // /api/strike-gex-series — ONE strike, every recorded snapshot. Powers the
  // /strike-history page: pick a session + expiry + strike and get the net GEX
  // path over time instead of the per-strike ladder the heatmap route returns.
  //
  // Uses libDb.queryAll (raw SQL) on purpose rather than adding helpers to
  // lib/db.ts: the checked-in lib/db.ts is BEHIND server-v2/_lib-db.cjs — the
  // bundle exports normGexSymbol() and takes a `symbol` arg on every
  // option_strike_gex_history query, the TypeScript source does neither. Adding
  // a helper to the source would mean regenerating the bundle, which would drop
  // symbol support and break SPY/QQQ. Nothing here needs that regeneration.
  if (libDb) {
    register('/api/strike-gex-series', {
      auth: 'subscriber', methods: ['GET'],
      async handler(req, res) {
        try {
          const sp = new URL(req.url || '/', 'http://localhost').searchParams;
          const symbol = libDb.normGexSymbol(sp.get('symbol'));
          const mode = sp.get('mode') ?? 'series';

          // Which (date, expiry) sessions actually have rows. Retention in
          // insertOptionStrikeGexRows prunes to ~2 days, so this list is short
          // by design — do NOT present it as a full history picker.
          if (mode === 'meta') {
            const metaRows = await libDb.queryAll(
              `SELECT date, expiry, COUNT(*)::int AS snaps
                 FROM option_strike_gex_history
                WHERE symbol = ?
                GROUP BY date, expiry
                ORDER BY date DESC, expiry ASC`,
              [symbol]
            );
            send(res, 200, {
              mode: 'meta', symbol,
              days: metaRows.map((r) => ({
                date: String(r.date), expiry: String(r.expiry), snaps: Number(r.snaps ?? 0),
              })),
            });
            return;
          }

          const date = sp.get('date') ?? todayET();
          const expiry = sp.get('expiry') ?? '';
          if (!expiry) { send(res, 200, { error: 'expiry is required', rows: [] }); return; }

          if (mode === 'strikes') {
            const strikeRows = await libDb.queryAll(
              `SELECT strike, COUNT(*)::int AS snaps, AVG(net_gex) AS avg_net_gex
                 FROM option_strike_gex_history
                WHERE symbol = ? AND date = ? AND expiry = ?
                GROUP BY strike
                ORDER BY strike ASC`,
              [symbol, date, expiry]
            );
            send(res, 200, {
              mode: 'strikes', symbol, date, expiry,
              strikes: strikeRows.map((r) => ({
                strike: Number(r.strike),
                snaps: Number(r.snaps ?? 0),
                avgNetGex: Number(r.avg_net_gex ?? 0),
              })),
            });
            return;
          }

          const strike = Number(sp.get('strike'));
          if (!Number.isFinite(strike) || strike <= 0) {
            send(res, 200, { error: 'strike is required', rows: [] });
            return;
          }
          // IV skew needs an ATM reference AT EACH SNAPSHOT, not one for the
          // session: spot moves, so the strike nearest spot changes during the
          // day, and pinning ATM to a single strike would smear that drift into
          // the skew line. The CTE picks, per timestamp, the strike with the
          // smallest |strike − spot| — the chosen ATM definition — and takes
          // the call/put average IV there as the reference.
          //
          // Main select is covered by idx_osgh_symbol_lookup
          // (symbol, date, expiry, strike, timestamp DESC).
          const seriesRows = await libDb.queryAll(
            `WITH atm AS (
               SELECT DISTINCT ON (timestamp)
                      timestamp,
                      strike AS atm_strike,
                      COALESCE((call_iv + put_iv) / 2.0, call_iv, put_iv) AS atm_iv
                 FROM option_strike_gex_history
                WHERE symbol = ? AND date = ? AND expiry = ?
                  AND spot IS NOT NULL AND spot > 0
                  AND (call_iv IS NOT NULL OR put_iv IS NOT NULL)
                ORDER BY timestamp, ABS(strike - spot) ASC
             )
             SELECT h.timestamp, h.spot, h.net_gex, h.net_vol_gex,
                    h.call_gamma, h.put_gamma, h.call_iv, h.put_iv,
                    a.atm_strike, a.atm_iv
               FROM option_strike_gex_history h
               LEFT JOIN atm a ON a.timestamp = h.timestamp
              WHERE h.symbol = ? AND h.date = ? AND h.expiry = ? AND h.strike = ?
              ORDER BY h.timestamp ASC`,
            [symbol, date, expiry, symbol, date, expiry, strike]
          );
          const num = (v) => (v == null ? null : Number(v));
          send(res, 200, {
            mode: 'series', symbol, date, expiry, strike,
            // ATM reference is the strike nearest spot at each snapshot; IV at
            // both K and ATM is the call/put average, so the subtraction is
            // like-for-like rather than call-IV minus a blended reference.
            atmRule: 'nearest-strike-to-spot',
            rows: seriesRows.map((r) => {
              const callIv = num(r.call_iv);
              const putIv = num(r.put_iv);
              const ivK = callIv != null && putIv != null ? (callIv + putIv) / 2 : (callIv ?? putIv);
              const atmIv = num(r.atm_iv);
              // Skew is null unless BOTH legs of the subtraction exist — a
              // missing ATM reading must not silently render as "zero skew".
              const skew = ivK != null && atmIv != null ? ivK - atmIv : null;
              return {
                t: Number(r.timestamp),
                spot: num(r.spot),
                netGex: Number(r.net_gex ?? 0),
                netVolGex: num(r.net_vol_gex),
                callGamma: num(r.call_gamma),
                putGamma: num(r.put_gamma),
                callIv, putIv, ivK,
                atmStrike: num(r.atm_strike),
                atmIv,
                skew,
                skewPct: skew != null && atmIv ? skew / atmIv : null,
              };
            }),
          });
        } catch (err) { send(res, 200, { error: String(err), rows: [] }); }
      },
    });
  }


  // /api/public-stats — UNGATED landing-page graded-performance strip. Ported
  // verbatim from app/api/public-stats/route.ts. ISR (revalidate=86400) replaced
  // by a module-level 24h TTL cache so anonymous traffic never hits PG per view;
  // never 500s (empty strip on error).
  {
    const PS_TTL_MS = 86_400_000;
    let psCache = null; // { at, payload }
    const MIN_N = 30, MIN_PERIODS = 30, MIN_EM_WEEKS = 4, MIN_EM_TICKERS = 30;
    const emZones = async () => {
      const pool = await libDb.getDb();
      const { rows } = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE result = 'hit')::int            AS hits,
          COUNT(*) FILTER (WHERE result IN ('hit','miss'))::int  AS evaluated,
          COUNT(DISTINCT week_start) FILTER (WHERE result IN ('hit','miss'))::int AS weeks,
          COUNT(DISTINCT ticker) FILTER (WHERE result IN ('hit','miss'))::int     AS tickers,
          MIN(week_start) FILTER (WHERE result IN ('hit','miss')) AS since
        FROM em_tracker`);
      const r = rows[0];
      const n = Number(r?.evaluated ?? 0);
      if (n < MIN_N || Number(r?.weeks ?? 0) < MIN_EM_WEEKS || Number(r?.tickers ?? 0) < MIN_EM_TICKERS) return null;
      return {
        key: 'em', label: 'Weekly EM bands contained price',
        sublabel: `${Number(r.tickers)} tickers over ${Number(r.weeks)} weeks — a 1-SD band should land near 68%`,
        pct: Math.round((Number(r.hits) / n) * 1000) / 10, n, since: r?.since ?? null,
      };
    };
    const ictSetups = async () => {
      const pool = await libDb.getDb();
      const { rows } = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE outcome = 'win')::int             AS wins,
          COUNT(*) FILTER (WHERE outcome IN ('win','loss'))::int   AS graded,
          COUNT(DISTINCT date) FILTER (WHERE outcome IN ('win','loss'))::int AS sessions,
          MIN(date) FILTER (WHERE outcome IN ('win','loss'))       AS since
        FROM ict_setups`);
      const r = rows[0];
      const n = Number(r?.graded ?? 0);
      if (n < MIN_N || Number(r?.sessions ?? 0) < MIN_PERIODS) return null;
      return {
        key: 'ict', label: 'ICT setups resolved in-direction',
        sublabel: `Auto-graded on follow-through, ${Number(r.sessions ?? 0)} sessions — chop excluded`,
        pct: Math.round((Number(r.wins) / n) * 1000) / 10, n, since: r?.since ?? null,
      };
    };
    const cbReach = async () => {
      const pool = await libDb.getDb();
      const { rows } = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE touched = 1)::int AS touched,
          COUNT(*)::int                            AS graded,
          MIN(date)                                AS since
        FROM confidence_log
        WHERE graded_at IS NOT NULL AND touched IS NOT NULL`);
      const r = rows[0];
      const n = Number(r?.graded ?? 0);
      if (n < MIN_N) return null;
      return {
        key: 'cb', label: 'CB levels reached intraday',
        sublabel: "Called pre-close, graded on the next session's actual print",
        pct: Math.round((Number(r.touched) / n) * 1000) / 10, n, since: r?.since ?? null,
      };
    };
    register('/api/public-stats', {
      auth: 'public', methods: ['GET'],
      async handler(req, res) {
        if (psCache && Date.now() - psCache.at < PS_TTL_MS) { send(res, 200, psCache.payload); return; }
        try {
          const settled = await Promise.allSettled([emZones(), ictSetups(), cbReach()]);
          const stats = settled.map((s) => (s.status === 'fulfilled' ? s.value : null)).filter((s) => s != null).sort((a, b) => b.n - a.n);
          const payload = { stats, computedAt: new Date().toISOString() };
          psCache = { at: Date.now(), payload };
          send(res, 200, payload);
        } catch { send(res, 200, { stats: [], computedAt: new Date().toISOString() }); }
      },
    });
  }

  // /api/levels — per-ticker weekly levels (ticker_levels). GET subscriber read
  // with alias resolution; POST NULL-aware upsert with the publish-window em
  // freeze (trusted internal token may always rewrite). Ported from
  // app/api/levels/route.ts.
  {
    let levelsEnsured = false;
    // Start of the current publish window = the most recent Friday 16:00 ET.
    // Must track levels-auto-publish.js's PUBLISH_DOW/PUBLISH_HOUR: an untrusted
    // POST may only rewrite an em that predates the window. When the publish ran
    // Saturday 09:00 this was lastSaturday9amET(); moving the run to Friday's
    // close without moving this boundary would have made every Friday-evening
    // publish a no-op for rows already written earlier in the same week.
    const publishWindowStartET = (now = new Date()) => {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
      const get = (t) => parts.find((p) => p.type === t)?.value;
      const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const dow = dowMap[get('weekday') || 'Sun'];
      const hour = Number(get('hour')), minute = Number(get('minute'));
      const minsSinceWindow = ((dow - 5) * 24 * 60) + hour * 60 + minute - 16 * 60;
      const offsetMin = minsSinceWindow >= 0 ? minsSinceWindow : minsSinceWindow + 7 * 24 * 60;
      return new Date(now.getTime() - offsetMin * 60 * 1000);
    };
    const ensureLevels = async (pool) => {
      if (levelsEnsured) return;
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ticker_levels (
          id SERIAL PRIMARY KEY, ticker TEXT NOT NULL UNIQUE, label TEXT, close TEXT,
          em TEXT, up TEXT, down TEXT, buy_near TEXT, buy_far TEXT, sell_near TEXT,
          sell_far TEXT, pivot TEXT, exp_label TEXT,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, em_updated_at TIMESTAMPTZ
        )`);
      await pool.query(`ALTER TABLE ticker_levels ADD COLUMN IF NOT EXISTS em_updated_at TIMESTAMPTZ`);
      levelsEnsured = true;
    };
    register('/api/levels', {
      auth: 'subscriber', methods: ['GET', 'POST'],
      async handler(req, res, ctx) {
        try {
          const pool = await libDb.getDb();
          await ensureLevels(pool);
          if (req.method === 'POST') {
            const body = await readJson(req);
            const ticker = String(body.ticker || '').trim().toUpperCase();
            if (!ticker) { send(res, 400, { error: 'Missing ticker' }); return; }
            const token = req.headers['x-internal-token'] || '';
            const trusted = !!ctx.internalToken && token === ctx.internalToken;
            const weekStart = publishWindowStartET();
            await pool.query(
              `INSERT INTO ticker_levels
                (ticker, label, close, em, up, down, buy_near, buy_far, sell_near, sell_far, pivot, exp_label, em_updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                       CASE WHEN $4::text IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END)
               ON CONFLICT(ticker) DO UPDATE SET
                 label     = CASE WHEN EXCLUDED.label     IS NOT NULL THEN EXCLUDED.label     ELSE ticker_levels.label     END,
                 buy_near  = CASE WHEN EXCLUDED.buy_near  IS NOT NULL THEN EXCLUDED.buy_near  ELSE ticker_levels.buy_near  END,
                 buy_far   = CASE WHEN EXCLUDED.buy_far   IS NOT NULL THEN EXCLUDED.buy_far   ELSE ticker_levels.buy_far   END,
                 sell_near = CASE WHEN EXCLUDED.sell_near IS NOT NULL THEN EXCLUDED.sell_near ELSE ticker_levels.sell_near END,
                 sell_far  = CASE WHEN EXCLUDED.sell_far  IS NOT NULL THEN EXCLUDED.sell_far  ELSE ticker_levels.sell_far  END,
                 pivot     = CASE WHEN EXCLUDED.pivot     IS NOT NULL THEN EXCLUDED.pivot     ELSE ticker_levels.pivot     END,
                 exp_label = CASE WHEN EXCLUDED.exp_label IS NOT NULL THEN EXCLUDED.exp_label ELSE ticker_levels.exp_label END,
                 updated_at = CURRENT_TIMESTAMP,
                 em = CASE WHEN EXCLUDED.em IS NOT NULL
                             AND ($13 OR ticker_levels.em IS NULL OR ticker_levels.em_updated_at IS NULL OR ticker_levels.em_updated_at < $14::timestamptz)
                           THEN EXCLUDED.em ELSE ticker_levels.em END,
                 close = CASE WHEN EXCLUDED.close IS NOT NULL
                             AND ($13 OR ticker_levels.em IS NULL OR ticker_levels.em_updated_at IS NULL OR ticker_levels.em_updated_at < $14::timestamptz)
                           THEN EXCLUDED.close ELSE ticker_levels.close END,
                 up = CASE WHEN EXCLUDED.up IS NOT NULL
                             AND ($13 OR ticker_levels.em IS NULL OR ticker_levels.em_updated_at IS NULL OR ticker_levels.em_updated_at < $14::timestamptz)
                           THEN EXCLUDED.up ELSE ticker_levels.up END,
                 down = CASE WHEN EXCLUDED.down IS NOT NULL
                             AND ($13 OR ticker_levels.em IS NULL OR ticker_levels.em_updated_at IS NULL OR ticker_levels.em_updated_at < $14::timestamptz)
                           THEN EXCLUDED.down ELSE ticker_levels.down END,
                 em_updated_at = CASE WHEN EXCLUDED.em IS NOT NULL
                             AND ($13 OR ticker_levels.em IS NULL OR ticker_levels.em_updated_at IS NULL OR ticker_levels.em_updated_at < $14::timestamptz)
                           THEN CURRENT_TIMESTAMP ELSE ticker_levels.em_updated_at END`,
              [ticker, body.label ?? null, body.close ?? null, body.em ?? null, body.up ?? null, body.down ?? null,
               body.buy_near ?? null, body.buy_far ?? null, body.sell_near ?? null, body.sell_far ?? null,
               body.pivot ?? null, body.exp_label ?? null, trusted, weekStart]
            );
            send(res, 200, { ok: true, ticker });
            return;
          }
          const raw = (new URL(req.url || '/', 'http://localhost').searchParams.get('ticker') || '').trim().toUpperCase();
          if (!raw) {
            const all = await pool.query('SELECT * FROM ticker_levels ORDER BY ticker ASC');
            send(res, 200, all.rows);
            return;
          }
          const cleaned = raw.replace(/[$]/g, '').replace(/^\//, '');
          const ALIAS = {
            ES: 'ESU', ESM: 'ESU', ESU6: 'ESU', ESU26: 'ESU', '/ES': 'ESU',
            NQ: 'NQU', NQM: 'NQU', NQU6: 'NQU', NQU26: 'NQU', '/NQ': 'NQU',
          };
          const candidates = [ALIAS[raw], ALIAS[cleaned], raw, cleaned].filter(Boolean);
          const result = await pool.query('SELECT * FROM ticker_levels WHERE ticker = ANY($1) LIMIT 1', [candidates]);
          if (!result.rows.length) { send(res, 200, null); return; }
          send(res, 200, result.rows[0]);
        } catch (err) { send(res, 500, { error: String(err) }); }
      },
    });

    // /api/levels/expire-stale — blank the EM band on every row NOT carrying the
    // current week's expiration.
    //
    // The upsert above is NULL-aware ("null means keep"), which is right for a
    // partial publish but means a ticker that fails to price simply keeps
    // whatever it had. In practice that shipped last week's 7/24 band — and for
    // 156 rows a 27-DTE 8/21 MONTHLY straddle — to /em as "this week's expected
    // move": a number roughly twice too wide, with nothing marking it stale.
    // The publisher calls this at the end of every run with the week it computed
    // for. Zones (buy/sell/pivot) are deliberately left alone: they come from
    // weekly candles, not the straddle, and stay valid.
    register('/api/levels/expire-stale', {
      auth: 'owner', methods: ['POST'],
      async handler(req, res, ctx) {
        try {
          if (!tokenOk(req, ctx)) { send(res, 401, { error: 'unauthorized' }); return; }
          const body = await readJson(req);
          const expLabel = String(body.exp_label || '').trim();
          if (!expLabel) { send(res, 400, { error: 'Missing exp_label' }); return; }
          const pool = await libDb.getDb();
          await ensureLevels(pool);
          const r = await pool.query(
            `UPDATE ticker_levels
                SET em = NULL, up = NULL, down = NULL, exp_label = NULL
              WHERE em IS NOT NULL
                AND exp_label IS DISTINCT FROM $1
              RETURNING ticker`,
            [expLabel]
          );
          const tickers = r.rows.map((x) => x.ticker);
          if (tickers.length) {
            console.log(`[levels] expired ${tickers.length} row(s) not on ${expLabel}: ${tickers.slice(0, 20).join(', ')}${tickers.length > 20 ? '…' : ''}`);
          }
          send(res, 200, { ok: true, exp_label: expLabel, expired: tickers.length, tickers });
        } catch (err) { send(res, 500, { error: String(err) }); }
      },
    });

    // /api/levels/prune — delete rows for tickers no longer on the publish roster.
    //
    // ticker_levels is an upsert-only table, so a name removed from
    // em-tickers.js keeps its row forever: never republished, never updated,
    // permanently "stale". After the 2026-07-26 roster prune that left 168 dead
    // rows behind — the publish itself was 234/234 with zero failures, but the
    // owner page still rendered a wall of orange chips for tickers that are no
    // longer published at all. Those rows also still answer GET /api/levels
    // per-ticker, so /em could serve a band for a name the publisher dropped.
    //
    // Called by the publisher after a FULL run only — never after a subset
    // retry, whose payload is just the not-yet-priced stragglers and would wipe
    // almost the whole table.
    register('/api/levels/prune', {
      auth: 'owner', methods: ['POST'],
      async handler(req, res, ctx) {
        try {
          if (!tokenOk(req, ctx)) { send(res, 401, { error: 'unauthorized' }); return; }
          const body = await readJson(req);
          const keep = Array.isArray(body.tickers)
            ? [...new Set(body.tickers.map((t) => String(t || '').trim().toUpperCase()).filter(Boolean))]
            : [];
          // A short list means a bad/partial caller, not an empty roster. Refuse
          // rather than empty the table.
          if (keep.length < 50) { send(res, 400, { error: `refusing to prune against only ${keep.length} ticker(s)` }); return; }
          const pool = await libDb.getDb();
          await ensureLevels(pool);
          const r = await pool.query(
            'DELETE FROM ticker_levels WHERE ticker <> ALL($1) RETURNING ticker',
            [keep]
          );
          const removed = r.rows.map((x) => x.ticker);
          if (removed.length) {
            console.log(`[levels] pruned ${removed.length} off-roster row(s): ${removed.slice(0, 30).join(', ')}${removed.length > 30 ? '…' : ''}`);
          }
          send(res, 200, { ok: true, kept: keep.length, pruned: removed.length, tickers: removed });
        } catch (err) { send(res, 500, { error: String(err) }); }
      },
    });
  }

  // /api/backtests?test=... — owner-only research panels (read-only SELECTs +
  // one live-chain fetch). Ported verbatim from app/api/backtests/route.ts:
  // queryAll->libDb.queryAll, getServerUserId gate->enforceAuth 'owner',
  // proxyBase chain fetch->ctx.internalFetch.
  {
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
    const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
    const round = (v, d = 1) => { const p = 10 ** d; return Math.round(v * p) / p; };

    const cbSize = async (tol) => {
      const rows = await libDb.queryAll(
        `SELECT c.date, c.level, MAX(ABS(m."mvcValueOIVol")) AS raw_size, MAX(m."pctOI_Vol") AS pct,
                c.touched, c.held, c.broke
         FROM confidence_log c
         JOIN mvc_snapshots m ON m.date = c.date AND ABS(m."strikeOIVol" - c.level) <= ?
         WHERE c.graded_at IS NOT NULL AND c.level > 0
         GROUP BY c.date, c.level, c.touched, c.held, c.broke
         ORDER BY c.date`, [tol]);
      const toB = (v) => (Math.abs(v) > 1e5 ? Math.abs(v) / 1e9 : Math.abs(v));
      const data = rows.map((r) => ({
        date: r.date, level: Math.round(num(r.level)), size: round(toB(num(r.raw_size)), 1),
        pct: r.pct == null ? null : Math.round(num(r.pct)),
        touched: !!r.touched, held: !!r.held, broke: !!r.broke,
        outcome: r.touched ? (r.held ? 'held' : r.broke ? 'broke' : '-') : '-',
      }));
      const detail = data.map((d) => ({ date: d.date, level: d.level, 'size $B': d.size, 'pct %': d.pct ?? '-', touched: d.touched ? 'yes' : 'no', outcome: d.outcome }));
      const buckets = [];
      if (data.length >= 3) {
        const sorted = [...data].sort((a, b) => a.size - b.size);
        const t1 = sorted[Math.floor(sorted.length / 3)].size;
        const t2 = sorted[Math.floor((2 * sorted.length) / 3)].size;
        const grp = (d) => (d.size <= t1 ? 0 : d.size <= t2 ? 1 : 2);
        const labels = [`small (≤${round(t1, 1)}B)`, 'mid', `large (>${round(t2, 1)}B)`];
        for (let b = 0; b < 3; b++) {
          const g = data.filter((d) => grp(d) === b);
          const tt = g.filter((d) => d.touched);
          buckets.push({ bucket: labels[b], n: g.length, 'touched %': pct(tt.length, g.length), 'held % (of touched)': tt.length ? pct(tt.filter((d) => d.held).length, tt.length) : '-' });
        }
      }
      const touched = data.filter((d) => d.touched), missed = data.filter((d) => !d.touched);
      return { detail, buckets, note: `${data.length} levels · avg size touched ${round(mean(touched.map((d) => d.size)), 1)}B vs missed ${round(mean(missed.map((d) => d.size)), 1)}B. Bigger CB ⇒ more likely reached; hold stays high regardless of size.` };
    };

    const confidence = async () => {
      const rows = await libDb.queryAll(
        `SELECT date, level, regime, reach, pivot, chop, "break" AS brk,
                touched, held, broke, actual_outcome
         FROM confidence_log WHERE graded_at IS NOT NULL ORDER BY date`);
      const scale = Math.max(...rows.map((r) => num(r.reach)), 0) > 1.5 ? 100 : 1;
      const P = (v) => num(v) / scale;
      const detail = rows.map((r) => ({
        date: r.date, level: Math.round(num(r.level)), regime: r.regime ?? '-',
        'reach %': Math.round(100 * P(r.reach)), touched: r.touched ? 'yes' : 'no',
        'hold pred %': Math.round(100 * (P(r.pivot) + P(r.chop))),
        result: r.touched ? (r.held ? 'held' : 'broke') : '-', outcome: r.actual_outcome ?? '-',
      }));
      const touched = rows.filter((r) => r.touched);
      const cal = [{ metric: 'REACH (all days)', 'predicted %': Math.round(100 * mean(rows.map((r) => P(r.reach)))), 'actual %': pct(touched.length, rows.length) }];
      if (touched.length) {
        cal.push({ metric: 'HOLD (of touched)', 'predicted %': Math.round(100 * mean(touched.map((r) => P(r.pivot) + P(r.chop)))), 'actual %': pct(touched.filter((r) => r.held).length, touched.length) });
        cal.push({ metric: 'BREAK (of touched)', 'predicted %': Math.round(100 * mean(touched.map((r) => P(r.brk)))), 'actual %': pct(touched.filter((r) => r.broke).length, touched.length) });
      }
      const rb = [[0, 0.4, 'low <40%'], [0.4, 0.7, 'mid 40-70%'], [0.7, 1.01, 'high >70%']];
      const reachBuckets = rb.map(([lo, hi, lbl]) => {
        const g = rows.filter((r) => P(r.reach) >= lo && P(r.reach) < hi);
        return { bucket: lbl, n: g.length, 'actual reached %': g.length ? pct(g.filter((r) => r.touched).length, g.length) : '-' };
      });
      return { detail, calibration: cal, reachBuckets, note: `${rows.length} graded days, ${touched.length} touched. Reach score discriminates well; hold is under-predicted (walls hold more than scored), break is over-predicted.` };
    };

    const dexPreflip = async (greek, hitAbs, lookMin, minPRange, edges) => {
      const col = greek === 'gex' ? 'gex' : 'dex';
      const rows = await libDb.queryAll(
        `SELECT date, timestamp AS ts, ${col} AS val FROM greeks_ts
         WHERE ticker='SPXW' AND ${col} IS NOT NULL AND "time" >= '09:30' AND "time" < '16:00'
         ORDER BY date, timestamp ASC`);
      const BUCKET_MS = 5 * 60_000;
      const rng = (a) => Math.max(...a) - Math.min(...a);
      const byDate = new Map();
      for (const r of rows) { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push({ ts: Number(r.ts), val: num(r.val) }); }
      const etMins = (ms) => { const s = new Date(ms).toLocaleString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }); return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)); };
      const etHour = (ms) => Math.floor(etMins(ms) / 60);
      const inEdges = (ms) => { const m = etMins(ms); return (m >= 570 && m < 690) || (m >= 840 && m < 960); };
      const bucketsFor = (day) => {
        const m = new Map();
        for (const r of day) { const k = Math.floor(r.ts / BUCKET_MS); if (!m.has(k)) m.set(k, []); m.get(k).push(r.val); }
        return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ ts: k * BUCKET_MS, avg: mean(v), range: rng(v), lo: Math.min(...v), hi: Math.max(...v) }));
      };
      const alertsFor = (bk, mult) => {
        const out = [];
        for (let i = 3; i < bk.length; i++) {
          const b = bk[i], prior = bk.slice(i - 3, i);
          const priAvgRange = mean(prior.map((p) => p.range)) || 1e-9;
          const priWinRange = rng(prior.flatMap((p) => [p.lo, p.hi])) || 1e-9;
          const priWinAvg = mean(prior.map((p) => p.avg));
          if (priAvgRange < minPRange) continue;
          if (!(b.range >= mult * priAvgRange && Math.abs(b.avg - priWinAvg) < priWinRange)) continue;
          const fwd = bk.filter((x) => x.ts > b.ts && x.ts <= b.ts + lookMin * 60_000);
          let hit = false, flip = false;
          for (const f of fwd) {
            if (Math.abs(f.avg - b.avg) >= hitAbs) hit = true;
            if (Math.sign(f.avg) && Math.sign(b.avg) && Math.sign(f.avg) !== Math.sign(b.avg)) flip = true;
          }
          out.push({ ts: b.ts, hit: hit || flip, flip });
        }
        return out;
      };
      const summary = [], hourly = [];
      for (const mult of [2, 3]) {
        let total = 0, hits = 0, flips = 0;
        const byHour = new Map();
        for (const day of byDate.values()) {
          let a = alertsFor(bucketsFor(day), mult);
          if (edges) a = a.filter((x) => inEdges(x.ts));
          total += a.length; hits += a.filter((x) => x.hit).length; flips += a.filter((x) => x.flip).length;
          for (const x of a) { const hr = etHour(x.ts); const e = byHour.get(hr) ?? { n: 0, h: 0 }; e.n++; if (x.hit) e.h++; byHour.set(hr, e); }
        }
        summary.push({ threshold: `${mult}×`, alerts: total, hits, 'hit %': pct(hits, total), flips });
        for (const hr of [...byHour.keys()].sort((a, b) => a - b)) {
          const e = byHour.get(hr);
          hourly.push({ threshold: `${mult}×`, 'ET hour': `${String(hr).padStart(2, '0')}:00`, alerts: e.n, hits: e.h, 'hit %': pct(e.h, e.n) });
        }
      }
      return { summary, hourly, note: `${greek.toUpperCase()} · ${byDate.size} RTH days · hit = |Δ| ≥ $${hitAbs}B or flip within ${lookMin}m${edges ? ' · edges only (open/close)' : ''}.` };
    };

    const gammaWall = async (tol, near, minRange) => {
      const rows = await libDb.queryAll(
        `WITH front AS (
           -- Front expiry per session. option_strike_gex_history now carries more
           -- than one expiry per date, and blending ladders invents walls that
           -- exist on neither.
           SELECT date, MIN(expiry) AS expiry FROM option_strike_gex_history
           WHERE symbol = ? AND expiry >= date GROUP BY date
         ),
         snap AS (
           -- symbol filter is load-bearing as of 2026-07-27: SPY and QQQ started
           -- writing to this table that day, and without it their strikes get
           -- summed into the SPX ladder.
           SELECT h.date, h.timestamp AS ts, h.spot, h.strike, h.net_gex
           FROM option_strike_gex_history h
           JOIN front f ON f.date = h.date AND f.expiry = h.expiry
           WHERE h.symbol = ? AND h.spot > 0 AND h.net_gex IS NOT NULL
             AND EXTRACT(DOW FROM h.date::date) BETWEEN 1 AND 5
             -- RTH only. MIN(ts)/MAX(ts) below are "open" and "close", and
             -- unbounded they pick up premarket and post-close snapshots. The
             -- post-close drift is material: 2026-07-24 sums to -21.3B at the
             -- last pre-16:00 snapshot and -8.9B at the last row of the day.
             AND to_timestamp(h.timestamp / 1000) AT TIME ZONE 'America/New_York'
                 >= (h.date::date + time '09:30')
             AND to_timestamp(h.timestamp / 1000) AT TIME ZONE 'America/New_York'
                 <  (h.date::date + time '16:00')
         ),
         spots AS (SELECT DISTINCT date, ts, spot FROM snap),
         day AS (SELECT date, MIN(ts) open_ts, MAX(ts) close_ts, MIN(spot) lo, MAX(spot) hi FROM spots GROUP BY date),
         open_spot  AS (SELECT s.date, MIN(s.spot) spot FROM spots s JOIN day d ON s.date=d.date AND s.ts=d.open_ts  GROUP BY s.date),
         close_spot AS (SELECT s.date, MIN(s.spot) spot FROM spots s JOIN day d ON s.date=d.date AND s.ts=d.close_ts GROUP BY s.date),
         open_strikes AS (
           SELECT sn.date, sn.strike, SUM(sn.net_gex) g FROM snap sn
           JOIN day d ON sn.date=d.date AND sn.ts=d.open_ts JOIN open_spot o ON o.date=sn.date
           WHERE ABS(sn.strike - o.spot) <= ? GROUP BY sn.date, sn.strike
         ),
         wall AS (SELECT DISTINCT ON (date) date, strike wall FROM open_strikes ORDER BY date, g DESC)
         SELECT d.date, w.wall, o.spot open_spot, c.spot close_spot, d.lo, d.hi
         FROM day d JOIN wall w ON w.date=d.date JOIN open_spot o ON o.date=d.date JOIN close_spot c ON c.date=d.date
         WHERE d.open_ts < d.close_ts AND (d.hi - d.lo) >= ? ORDER BY d.date`, ['$SPX', '$SPX', near, minRange]);
      let days = 0, pulled = 0, sumO = 0, sumC = 0, approached = 0, rejected = 0;
      const detail = rows.map((r) => {
        const wall = num(r.wall), sO = num(r.open_spot), sC = num(r.close_spot), hi = num(r.hi), lo = num(r.lo);
        const openD = Math.abs(sO - wall), closeD = Math.abs(sC - wall);
        if (closeD < openD) pulled++;
        days++; sumO += openD; sumC += closeD;
        let side = 'at-spot', app = false, rej = false;
        if (wall > sO + tol) { side = 'resist'; app = hi >= wall - tol; if (app) rej = sC <= wall + tol; }
        else if (wall < sO - tol) { side = 'support'; app = lo <= wall + tol; if (app) rej = sC >= wall - tol; }
        if (app) { approached++; if (rej) rejected++; }
        return { date: r.date, wall: Math.round(wall), open: Math.round(sO), close: Math.round(sC), 'openΔ': Math.round(openD), 'closeΔ': Math.round(closeD), side, approached: app ? 'yes' : '-', result: app ? (rej ? 'REJECT' : 'broke') : '-' };
      });
      return {
        detail,
        summary: [
          { metric: 'Avg dist to wall — open', value: `${round(sumO / (days || 1), 1)} pt` },
          { metric: 'Avg dist to wall — close', value: `${round(sumC / (days || 1), 1)} pt` },
          { metric: 'Pulled toward wall by close', value: `${pulled}/${days} (${pct(pulled, days)}%)` },
          { metric: 'Approached wall', value: `${approached}/${days}` },
          { metric: 'Rejected (of approached)', value: approached ? `${rejected}/${approached} (${pct(rejected, approached)}%)` : '-' },
        ],
        note: `${days} sessions · $SPX front expiry · RTH only (09:30–16:00 ET). Pin holds only if close-distance < open-distance and pulled% > 50. Wall = largest positive net-GEX strike near spot at open.`,
      };
    };

    const normalizedGex = async (ctx, ticker, expiration) => {
      const r0 = await ctx.internalFetch(`/proxy/api/tt/chains/${encodeURIComponent(ticker)}?expiration=${encodeURIComponent(expiration)}&range=all`, { cache: 'no-store' });
      if (!r0.ok) throw new Error(`chain fetch failed: HTTP ${r0.status}`);
      const json = await r0.json();
      const data = json?.data ?? {};
      const spot = num(data.underlyingPrice);
      if (!spot) throw new Error(`no live spot for ${ticker} — check ticker`);
      const allGroups = data.items ?? [];
      const groups = allGroups.filter((g) => String(g['expiration-date'] ?? '').slice(0, 10) === expiration.slice(0, 10));
      const target = groups.length ? groups : allGroups;
      if (!target.length) throw new Error(`no chain data for ${ticker} ${expiration} — check the expiration date`);
      const S = spot;
      const rows = [];
      for (const g of target) {
        for (const item of (g.strikes ?? [])) {
          const strike = num(item['strike-price']);
          if (!strike) continue;
          const c = item.call, p = item.put;
          const cnt = (o) => (o ? (num(o['open-interest'] ?? o.openInterest) + num(o.volume)) : 0);
          const cc = cnt(c), pc = cnt(p);
          if (!cc && !pc) continue;
          const gex = (num(c?.gamma) * cc - num(p?.gamma) * pc) * S * S * 0.01 * 100;
          rows.push({ strike, gex });
        }
      }
      if (!rows.length) throw new Error(`no strikes with OI/volume for ${ticker} ${expiration}`);
      const totalAbs = rows.reduce((s, r) => s + Math.abs(r.gex), 0);
      const detail = rows.map((r) => ({ strike: r.strike, 'net GEX': Math.round(r.gex), 'normalized %': totalAbs > 0 ? round((Math.abs(r.gex) / totalAbs) * 100, 2) : 0 })).sort((a, b) => b.strike - a.strike);
      return { detail, note: `${ticker.toUpperCase()} · ${expiration} · spot ${round(spot, 2)} · ${detail.length} strikes. Normalized GEX (%) = |strike net GEX| / Σ|net GEX| × 100.` };
    };

    const gexDexCross = async (horizonMin, hit, band, days, gapMin) => {
      const cut = Date.now() - days * 86_400_000;
      const Hm = horizonMin * 60_000, GAP = gapMin * 60_000, TOL = 180_000;
      const etd = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const et = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' });
      const pxRows = await libDb.queryAll(
        `SELECT timestamp AS t, MAX(spot) spot FROM option_strike_gex_history
         WHERE spot IS NOT NULL AND timestamp > ? GROUP BY timestamp ORDER BY timestamp`, [cut]);
      const P = pxRows.map((r) => ({ t: Number(r.t), spot: num(r.spot) }));
      if (P.length < 2) throw new Error('no SPX price path in window');
      const flipFrom = (rows, spot) => {
        if (rows.length < 40) return null;
        if (!(rows[0].strike < spot && rows[rows.length - 1].strike > spot)) return null;
        let cum = 0, best = null, bd = 1e9, pS = null, pC = 0;
        for (const r of rows) {
          const nc = cum + r.v;
          if (pS != null && ((pC <= 0 && nc > 0) || (pC >= 0 && nc < 0)) && nc - pC !== 0) {
            const k = pS + (r.strike - pS) * (0 - pC) / (nc - pC);
            const d = Math.abs(k - spot);
            if (d < bd && d <= band) { bd = d; best = k; }
          }
          pS = r.strike; pC = nc; cum = nc;
        }
        return best;
      };
      const nearestSpot = (t) => {
        let lo = 0, hi = P.length - 1;
        if (t < P[0].t - TOL || t > P[hi].t + TOL) return null;
        while (lo < hi) { const m = (lo + hi) >> 1; if (P[m].t < t) lo = m + 1; else hi = m; }
        let best = P[lo];
        for (const j of [lo - 1, lo]) if (j >= 0 && j < P.length && Math.abs(P[j].t - t) < Math.abs(best.t - t)) best = P[j];
        return Math.abs(best.t - t) <= TOL ? best.spot : null;
      };
      const exc = (t0, spot0, dir) => {
        const st = P.findIndex((p) => p.t > t0);
        if (st < 0) return null;
        let mu = 0, md = 0, cnt = 0;
        for (let i = st; i < P.length; i++) { const p = P[i]; if (p.t > t0 + Hm) break; const dd = p.spot - spot0; if (dd > mu) mu = dd; if (dd < md) md = dd; cnt++; }
        if (!cnt) return null;
        return { mfe: dir > 0 ? mu : -md, mae: dir > 0 ? -md : mu };
      };
      const crossesOf = (series) => {
        const byD = new Map();
        for (const r of series) { const d = etd(r.t); if (!byD.has(d)) byD.set(d, []); byD.get(d).push(r); }
        const out = [];
        for (const rows of byD.values()) {
          rows.sort((a, b) => a.t - b.t);
          let lt = -1e15, ld = 0;
          for (let i = 1; i < rows.length; i++) {
            const a = rows[i - 1], b = rows[i];
            if (a.spot === b.spot) continue;
            const pa = a.spot - a.flip, pb = b.spot - b.flip;
            if (!pa || !pb) continue;
            if ((pa < 0 && pb > 0) || (pa > 0 && pb < 0)) {
              const dir = pb > 0 ? 1 : -1;
              if (dir === ld && b.t - lt < GAP) continue;
              lt = b.t; ld = dir;
              const e = exc(b.t, b.spot, dir);
              if (!e) continue;
              out.push({ d: etd(b.t), time: et(b.t), dir, spot0: round(b.spot, 2), flip: round(b.flip, 2), mfe: round(e.mfe, 1), mae: round(e.mae, 1) });
            }
          }
        }
        return out;
      };
      const buildSeries = async (sql, reSourceSpot) => {
        const rows = await libDb.queryAll(sql, [cut]);
        const map = new Map();
        for (const r of rows) { const k = Math.round(Number(r.t)); if (!map.has(k)) map.set(k, { spot: num(r.spot), rows: [] }); map.get(k).rows.push({ strike: num(r.strike), v: num(r.v) }); }
        const ser = [];
        for (const [k, o] of map) {
          const f = flipFrom(o.rows, o.spot);
          if (f == null) continue;
          const sp = reSourceSpot ? nearestSpot(k) : o.spot;
          if (sp == null) continue;
          ser.push({ t: k, spot: sp, flip: f });
        }
        return ser.sort((a, b) => a.t - b.t);
      };
      const gexCr = crossesOf(await buildSeries(
        `SELECT timestamp AS t, strike, SUM(net_gex) v, MAX(spot) spot FROM option_strike_gex_history
         WHERE timestamp > ? GROUP BY timestamp, strike ORDER BY timestamp, strike`, false));
      const dexCr = crossesOf(await buildSeries(
        `SELECT EXTRACT(EPOCH FROM ts) * 1000 AS t, strike, SUM(delta_net) v, MAX(spot) spot FROM greek_snapshots
         WHERE symbol='SPX' AND expiry = date AND delta_net IS NOT NULL AND EXTRACT(EPOCH FROM ts) * 1000 > ?
         GROUP BY ts, strike ORDER BY ts, strike`, true));
      const stat = (label, cr) => {
        const up = cr.filter((x) => x.dir > 0), dn = cr.filter((x) => x.dir < 0);
        const hc = (g) => (g.length ? pct(g.filter((x) => x.mfe >= hit).length, g.length) : 0);
        const hf = (g) => (g.length ? pct(g.filter((x) => x.mae >= hit).length, g.length) : 0);
        return {
          signal: label, n: cr.length,
          'cont hit %': hc(cr), 'cont MFE': round(mean(cr.map((x) => x.mfe)), 2), 'cont MAE': round(mean(cr.map((x) => x.mae)), 2),
          'fade hit %': hf(cr), 'fade MFE': round(mean(cr.map((x) => x.mae)), 2), 'fade MAE': round(mean(cr.map((x) => x.mfe)), 2),
          'up hit %': hc(up), 'dn hit %': hc(dn),
        };
      };
      const detail = [...gexCr.map((x) => ({ signal: 'GEX', ...x })), ...dexCr.map((x) => ({ signal: 'DEX', ...x }))]
        .sort((a, b) => (a.d === b.d ? (a.time < b.time ? -1 : 1) : a.d < b.d ? -1 : 1))
        .map((x) => ({ signal: x.signal, date: x.d, time: x.time, dir: x.dir > 0 ? 'UP' : 'DN', spot: x.spot0, flip: x.flip, MFE: x.mfe, MAE: x.mae }));
      const from = etd(P[0].t), to = etd(P[P.length - 1].t);
      return {
        summary: [stat('GEX flip (0γ)', gexCr), stat('DEX flip (0Δ)', dexCr)],
        detail,
        note: `${from}→${to} · GEX ${gexCr.length} crosses, DEX ${dexCr.length} · horizon ${horizonMin}m · "hit" = favorable ≥ ${hit}pt · flip band ±${band}pt. "cont" = trade the cross (continuation), "fade" = reverse (MFE/MAE swap). Small sample — directional only.`,
      };
    };

    // Consolidates gex_change_top (top-N very-strong strikes per 30m slot) from
    // slot/strike rows into one row per ticker for a session. NOTE:
    // gex_change_top.date is TEXT ('YYYY-MM-DD'), not a date column — never
    // compare it to CURRENT_DATE (strike_growth.date IS a real date; the two
    // tables do not share a predicate).
    const gexChangeSummary = async (dateArg) => {
      let date = String(dateArg || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const [r] = await libDb.queryAll('SELECT max(date) AS d FROM gex_change_top');
        date = r?.d || '';
      }
      if (!date) return { by_ticker: [], detail: [], note: 'gex_change_top is empty.' };

      const rows = await libDb.queryAll(
        `WITH src AS (SELECT * FROM gex_change_top WHERE date = ?),
         strikes AS (
           SELECT symbol, count(*) AS n_strikes,
                  string_agg(lbl, ', ' ORDER BY strike) AS strike_list
           FROM (SELECT DISTINCT symbol, strike,
                        to_char(strike, 'FM999990.##') AS lbl FROM src) x
           GROUP BY symbol
         )
         SELECT s.symbol,
                count(*)                                  AS hits,
                count(DISTINCT s.slot)                    AS slots,
                min(s.slot)                               AS first_slot,
                max(s.slot)                               AS last_slot,
                min(s.rank)                               AS best_rank,
                max(s.score)                              AS best_score,
                sum(s.latest_chg)                         AS net_chg,
                sum(abs(s.latest_chg))                    AS abs_chg,
                count(*) FILTER (WHERE s.strike > s.spot) AS above_spot,
                count(*) FILTER (WHERE s.strike < s.spot) AS below_spot,
                count(DISTINCT s.expiry)                  AS n_expiries,
                min(s.expiry)                             AS near_expiry,
                k.n_strikes, k.strike_list,
                max(s.spot)                               AS spot
         FROM src s JOIN strikes k ON k.symbol = s.symbol
         GROUP BY s.symbol, k.n_strikes, k.strike_list
         ORDER BY abs_chg DESC`, [date]);

      const detailRows = await libDb.queryAll(
        `SELECT symbol, strike, expiry,
                count(*)             AS hits,
                count(DISTINCT slot) AS slots,
                min(slot)            AS first_slot,
                max(slot)            AS last_slot,
                sum(latest_chg)      AS net_chg,
                sum(abs(latest_chg)) AS abs_chg,
                max(abs(latest_chg)) AS biggest_hit,
                min(rank)            AS best_rank
         FROM gex_change_top WHERE date = ?
         GROUP BY symbol, strike, expiry
         ORDER BY abs_chg DESC`, [date]);

      const [slotStats] = await libDb.queryAll(
        `SELECT count(*) AS n, COALESCE(max(cnt), 0) AS cap FROM (
           SELECT slot, count(*) AS cnt FROM gex_change_top WHERE date = ? GROUP BY slot
         ) s`, [date]);

      const M = (v) => round(num(v) / 1e6, 2);

      const by_ticker = rows.map((r) => {
        const abs = num(r.abs_chg), net = num(r.net_chg);
        const callShare = abs > 0 ? Math.round((100 * ((abs + net) / 2)) / abs) : 0;
        return {
          symbol: r.symbol,
          '$M abs': M(r.abs_chg),
          '$M net': M(r.net_chg),
          'call %': callShare,
          side: callShare >= 70 ? 'call/resist' : callShare <= 30 ? 'put/support' : 'two-sided',
          hits: num(r.hits),
          slots: num(r.slots),
          window: `${r.first_slot}–${r.last_slot}`,
          'best rank': num(r.best_rank),
          above: num(r.above_spot),
          below: num(r.below_spot),
          strikes: r.strike_list,
          expiries: num(r.n_expiries),
          'near exp': r.near_expiry,
          spot: round(num(r.spot), 2),
        };
      });

      const detail = detailRows.map((r) => {
        const abs = num(r.abs_chg);
        return {
          symbol: r.symbol,
          strike: num(r.strike),
          expiry: r.expiry,
          '$M abs': M(r.abs_chg),
          '$M net': M(r.net_chg),
          'biggest hit $M': M(r.biggest_hit),
          'concentration %': abs > 0 ? Math.round((100 * num(r.biggest_hit)) / abs) : 0,
          hits: num(r.hits),
          slots: num(r.slots),
          window: `${r.first_slot}–${r.last_slot}`,
          'best rank': num(r.best_rank),
        };
      });

      const totalAbs = by_ticker.reduce((s, r) => s + num(r['$M abs']), 0);
      const totalHits = by_ticker.reduce((s, r) => s + num(r.hits), 0);
      const nSlots = num(slotStats?.n), cap = num(slotStats?.cap);
      const saturated = nSlots > 0 && cap > 0 && totalHits >= nSlots * cap;

      return {
        by_ticker, detail,
        note: `${date} · ${by_ticker.length} tickers · ${totalHits} hits across ${nSlots} slots · $${round(totalAbs, 1)}M flagged.`
          + (saturated
            ? ` ⚠ Board saturated — every slot filled the top-${cap} cap, so real activity exceeds what is shown here. Raise GEX_CHANGE_TOP_N to widen coverage.`
            : '')
          + ` "call %" = share of |Δ| on the call / above-spot side. "$M net" is call-build minus put-build, not the ticker's net day GEX change.`,
      };
    };

    register('/api/backtests', {
      auth: 'owner', methods: ['GET'],
      async handler(req, res, ctx) {
        const q = new URL(req.url || '/', 'http://localhost').searchParams;
        const test = q.get('test');
        const n = (k, d) => { const v = Number(q.get(k)); return Number.isFinite(v) ? v : d; };
        try {
          let body;
          if (test === 'cb-size') body = await cbSize(n('tol', 10));
          else if (test === 'confidence') body = await confidence();
          else if (test === 'dex-preflip') body = await dexPreflip((q.get('greek') === 'gex' ? 'gex' : 'dex'), n('hitAbs', 50), n('lookMin', 20), n('minPRange', 5), q.get('edges') === '1');
          else if (test === 'gamma-wall') body = await gammaWall(n('tol', 5), n('near', 150), n('minRange', 5));
          else if (test === 'normalized-gex') body = await normalizedGex(ctx, (q.get('ticker') || 'SPX').trim().toUpperCase(), (q.get('expiration') || '').trim());
          else if (test === 'gex-dex-cross') body = await gexDexCross(n('horizon', 30), n('hit', 5), n('band', 60), n('days', 30), n('gap', 5));
          else if (test === 'gex-change-summary') body = await gexChangeSummary(q.get('date') || '');
          else { send(res, 400, { error: 'unknown test' }); return; }
          send(res, 200, { ok: true, test, ...body });
        } catch (e) { send(res, 500, { ok: false, error: e.message }); }
      },
    });
  }

  // /api/budget — owner-only budget/register/recurring/amazon/prop manager.
  // GET loads a month; POST dispatches ~18 actions. Ported verbatim from
  // app/api/budget/route.ts; ownerGate replaced by enforceAuth 'owner'. All data
  // under the single stable "owner" profile.
  {
    const BUDGET_PROFILE_KEY = 'owner';
    const monthRange = (month) => {
      const [y, m] = month.split('-').map(Number);
      const pad = (n) => String(n).padStart(2, '0');
      const last = new Date(y, m, 0).getDate();
      return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
    };
    const currentMonth = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; };
    const normBank = (v) => (v === 'coastal' || v === 'truist' ? v : 'secu');
    const normFreq = (v) => (v === 'weekly' || v === 'biweekly' ? v : 'monthly');
    register('/api/budget', {
      auth: 'owner', methods: ['GET', 'POST'],
      async handler(req, res) {
        try {
          const D = libDb;
          if (req.method === 'GET') {
            const month = new URL(req.url || '/', 'http://localhost').searchParams.get('month') || currentMonth();
            const { from, to } = monthRange(month);
            const year = month.slice(0, 4);
            await D.adoptDefaultBudgetProfile(BUDGET_PROFILE_KEY);
            const profile = await D.getOrCreateBudgetProfile(BUDGET_PROFILE_KEY);
            const [categories, entries, register2, recurring, amazonRows, propRows, dailyBalance] = await Promise.all([
              D.listBudgetCategories(profile.id),
              D.listBudgetEntries(profile.id, 500),
              D.listRegister(profile.id, from, to),
              D.listRecurring(profile.id),
              D.listAmazonRows(profile.id, from, to),
              D.listPropRows(profile.id, `${year}-01-01`, `${year}-12-31`),
              D.getLatestDailyBalance(profile.id),
            ]);
            const prevDailyBalance = dailyBalance ? await D.getDailyBalanceBefore(profile.id, dailyBalance.day) : null;
            send(res, 200, { profile, categories, entries, month, register: register2, recurring, amazonRows, propRows, dailyBalance, prevDailyBalance });
            return;
          }
          const body = await readJson(req);
          const action = String(body?.action ?? '');
          await D.adoptDefaultBudgetProfile(BUDGET_PROFILE_KEY);
          const profile = await D.getOrCreateBudgetProfile(BUDGET_PROFILE_KEY);
          if (action === 'category') {
            const category = await D.upsertBudgetCategory({
              profile_id: profile.id, name: String(body?.name ?? '').trim(), amount: Number(body?.amount ?? 0),
              period: String(body?.period ?? 'monthly'), color: body?.color ? String(body.color) : null,
            });
            send(res, 200, { ok: true, category }); return;
          }
          if (action === 'categoryDelete') { await D.deleteBudgetCategory(profile.id, Number(body?.id ?? 0)); send(res, 200, { ok: true }); return; }
          if (action === 'dailyBalance') {
            const row = await D.upsertDailyBalance({
              profile_id: profile.id, day: String(body?.day ?? '').trim() || currentMonth() + '-01',
              coastal: Number(body?.coastal ?? 0), truist: Number(body?.truist ?? 0), secu: Number(body?.secu ?? 0),
            });
            send(res, 200, { ok: true, dailyBalance: row }); return;
          }
          if (action === 'assignCategory') {
            const catId = body?.categoryId == null ? null : Number(body.categoryId);
            await D.setRegisterCategory(profile.id, Number(body?.id ?? 0), catId);
            send(res, 200, { ok: true }); return;
          }
          if (action === 'entry') {
            const entry = await D.insertBudgetEntry({
              profile_id: profile.id, category_id: body?.categoryId ? Number(body.categoryId) : null,
              type: body?.type === 'income' ? 'income' : 'expense', amount: Number(body?.amount ?? 0),
              title: String(body?.title ?? '').trim(), notes: body?.notes ? String(body.notes) : null,
              occurred_at: String(body?.occurredAt ?? new Date().toISOString()),
            });
            send(res, 200, { ok: true, entry }); return;
          }
          if (action === 'registerRow') {
            const row = await D.insertRegisterRow({
              profile_id: profile.id, entry_date: String(body?.date ?? '').trim(),
              sort_order: Number(body?.sortOrder ?? Date.now() % 100000), label: String(body?.label ?? '').trim(),
              bank: normBank(body?.bank), amount: Number(body?.amount ?? 0),
              recurring_tag: body?.recurringTag ? String(body.recurringTag) : null,
            });
            send(res, 200, { ok: true, row }); return;
          }
          if (action === 'registerRowsBulk') {
            const rows = Array.isArray(body?.rows) ? body.rows : [];
            let inserted = 0;
            for (const r of rows) {
              const entry_date = String(r?.date ?? '').trim();
              const label = String(r?.label ?? '').trim();
              const amount = Number(r?.amount ?? 0);
              if (!entry_date || !label || !Number.isFinite(amount) || amount === 0) continue;
              await D.insertRegisterRow({ profile_id: profile.id, entry_date, sort_order: (Date.now() % 100000) + inserted, label, bank: normBank(r?.bank), amount });
              inserted++;
            }
            send(res, 200, { ok: true, inserted }); return;
          }
          if (action === 'updateRow') {
            await D.updateRegisterRow(profile.id, Number(body?.id ?? 0), {
              entry_date: body?.date != null ? String(body.date) : undefined,
              label: body?.label != null ? String(body.label) : undefined,
              bank: body?.bank != null ? normBank(body.bank) : undefined,
              amount: body?.amount != null ? Number(body.amount) : undefined,
            });
            send(res, 200, { ok: true }); return;
          }
          if (action === 'deleteRow') { await D.deleteRegisterRow(profile.id, Number(body?.id ?? 0)); send(res, 200, { ok: true }); return; }
          if (action === 'setBeginning') {
            const month = String(body?.month ?? currentMonth());
            const { from, to } = monthRange(month);
            await D.deleteRegisterByTag(profile.id, from, to, '__beginning__');
            const balances = body?.balances ?? {};
            for (const bank of ['coastal', 'truist', 'secu']) {
              await D.insertRegisterRow({ profile_id: profile.id, entry_date: from, sort_order: -1, label: 'BEGINNING', bank, amount: Number(balances[bank] ?? 0), is_beginning: 1, recurring_tag: '__beginning__' });
            }
            send(res, 200, { ok: true }); return;
          }
          if (action === 'recurringAdd') {
            const row = await D.insertRecurring({
              profile_id: profile.id, label: String(body?.label ?? '').trim().toUpperCase(), bank: normBank(body?.bank),
              amount: Number(body?.amount ?? 0), frequency: normFreq(body?.frequency), anchor_date: String(body?.anchorDate ?? '').trim(),
            });
            send(res, 200, { ok: true, row }); return;
          }
          if (action === 'recurringUpdate') {
            await D.updateRecurring(profile.id, Number(body?.id ?? 0), {
              label: body?.label != null ? String(body.label).toUpperCase() : undefined,
              bank: body?.bank != null ? normBank(body.bank) : undefined,
              amount: body?.amount != null ? Number(body.amount) : undefined,
              frequency: body?.frequency != null ? normFreq(body.frequency) : undefined,
              anchor_date: body?.anchorDate != null ? String(body.anchorDate) : undefined,
              active: body?.active != null ? (body.active ? 1 : 0) : undefined,
            });
            send(res, 200, { ok: true }); return;
          }
          if (action === 'recurringDelete') { await D.deleteRecurring(profile.id, Number(body?.id ?? 0)); send(res, 200, { ok: true }); return; }
          if (action === 'amazon') {
            const row = await D.insertAmazonRow({ profile_id: profile.id, work_date: String(body?.date ?? '').trim(), pay: Number(body?.pay ?? 0), gas: Number(body?.gas ?? 0) });
            send(res, 200, { ok: true, amazon: row }); return;
          }
          if (action === 'deleteAmazon') { await D.deleteAmazonRow(profile.id, Number(body?.id ?? 0)); send(res, 200, { ok: true }); return; }
          if (action === 'propAdd') {
            const row = await D.insertPropRow({
              profile_id: profile.id, entry_date: String(body?.date ?? '').trim(), source: body?.source ? String(body.source) : 'prop',
              firm: body?.firm ? String(body.firm) : 'TPT', accounts: Number(body?.accounts ?? 0), cost: Number(body?.cost ?? 0),
              payout: Number(body?.payout ?? 0), note: body?.note ? String(body.note) : null,
            });
            send(res, 200, { ok: true, prop: row }); return;
          }
          if (action === 'propUpdate') {
            await D.updatePropRow(profile.id, Number(body?.id ?? 0), {
              entry_date: body?.date != null ? String(body.date) : undefined,
              source: body?.source != null ? String(body.source) : undefined,
              firm: body?.firm != null ? String(body.firm) : undefined,
              accounts: body?.accounts != null ? Number(body.accounts) : undefined,
              cost: body?.cost != null ? Number(body.cost) : undefined,
              payout: body?.payout != null ? Number(body.payout) : undefined,
              note: body?.note !== undefined ? (body.note ? String(body.note) : null) : undefined,
            });
            send(res, 200, { ok: true }); return;
          }
          if (action === 'propDelete') { await D.deletePropRow(profile.id, Number(body?.id ?? 0)); send(res, 200, { ok: true }); return; }
          send(res, 400, { error: 'Unknown action' });
        } catch (err) { send(res, 500, { error: req.method === 'GET' ? 'Budget load failed' : 'Budget save failed', detail: String(err) }); }
      },
    });
  }

  // /api/watch — owner options-watchlist tracker. GET (list / ?history=id /
  // ?quote=...) + POST {action: add|remove|refresh}. Live data via in-process
  // /proxy/probe-rest. Ported verbatim from app/api/watch/route.ts. Owner-only.
  {
    const RANGE_MS = { '1d': 24 * 3600_000, '3d': 3 * 24 * 3600_000, '1w': 7 * 24 * 3600_000, '1m': 30 * 24 * 3600_000 };
    const num = (v) => { const n = Number(v); return Number.isFinite(n) && n !== 0 ? n : null; };
    const fetchProbe = async (ctx, ticker, expiry, side, strike) => {
      const path = `/proxy/probe-rest?ticker=${encodeURIComponent(ticker)}&expiry=${encodeURIComponent(expiry)}&type=${side}&strike=${encodeURIComponent(strike)}`;
      try { const r = await ctx.internalFetch(path, { cache: 'no-store' }); return await r.json(); }
      catch { return null; }
    };
    const sideExposure = (j) => {
      if (!j?.found || !j.result) return { gamma: null, pos: 0, spot: null };
      const g = j.result.feeds?.Greeks ?? {};
      const su = j.result.feeds?.Summary ?? {};
      const tr = j.result.feeds?.Trade ?? {};
      const ex = j.result.exposures ?? {};
      const oi = num(su.openInterest) ?? num(ex.oi) ?? 0;
      const vol = num(tr.volume) ?? num(ex.volume) ?? 0;
      return { gamma: num(g.bsGamma), pos: oi + vol, spot: num(ex.spot) };
    };
    const probe = async (ctx, row) => {
      const oppSide = row.side === 'C' ? 'P' : 'C';
      const [j, oppJ] = await Promise.all([
        fetchProbe(ctx, row.ticker, row.expiration, row.side, row.strike),
        fetchProbe(ctx, row.ticker, row.expiration, oppSide, row.strike),
      ]);
      if (!j?.found || !j.result) return null;
      const q = j.result.feeds?.Quote ?? {};
      const tr = j.result.feeds?.Trade ?? {};
      const su = j.result.feeds?.Summary ?? {};
      const g = j.result.feeds?.Greeks ?? {};
      const ex = j.result.exposures ?? {};
      const mark = num(q.mark) ?? num(q.mid);
      const volume = num(tr.volume) ?? num(ex.volume);
      const netPrem = mark != null && volume != null ? mark * volume * 100 : null;
      const watched = sideExposure(j);
      const opp = sideExposure(oppJ);
      const call = row.side === 'C' ? watched : opp;
      const put = row.side === 'C' ? opp : watched;
      const spot = watched.spot ?? opp.spot;
      let netGex = null;
      if (spot != null && spot > 0) {
        const callGex = Math.abs(call.gamma ?? 0) * call.pos * spot * spot;
        const putGex = -Math.abs(put.gamma ?? 0) * put.pos * spot * spot;
        netGex = callGex + putGex;
      }
      return {
        watch_id: row.id, ts: Date.now(), spot: num(ex.spot), bid: num(q.bid), ask: num(q.ask), mark,
        last: num(tr.last), iv: num(g.bsIv) ?? num(g.iv), delta: num(g.bsDelta), gamma: num(g.bsGamma),
        theta: num(g.bsTheta), vega: num(g.bsVega), open_interest: num(su.openInterest) ?? num(ex.oi),
        volume, net_prem: netPrem, prev_close: num(su.prevClose), net_gex: netGex,
      };
    };
    register('/api/watch', {
      auth: 'owner', methods: ['GET', 'POST'],
      async handler(req, res, ctx) {
        const sp = new URL(req.url || '/', 'http://localhost').searchParams;
        if (req.method === 'GET') {
          try {
            const quoteTicker = sp.get('quote');
            if (quoteTicker) {
              const expiry = String(sp.get('expiry') || '').trim();
              const side = String(sp.get('side') || 'C').toUpperCase() === 'P' ? 'P' : 'C';
              const strike = Number(sp.get('strike'));
              if (!expiry || !Number.isFinite(strike)) { send(res, 400, { error: 'expiry and strike required' }); return; }
              const j = await fetchProbe(ctx, quoteTicker.trim().toUpperCase(), expiry, side, strike);
              if (!j?.found || !j.result) { send(res, 200, { found: false }); return; }
              const q = j.result.feeds?.Quote ?? {};
              const tr = j.result.feeds?.Trade ?? {};
              send(res, 200, { found: true, bid: num(q.bid), ask: num(q.ask), mark: num(q.mark) ?? num(q.mid), last: num(tr.last) });
              return;
            }
            const historyId = sp.get('history');
            if (historyId) {
              const range = sp.get('range') || '';
              const windowMs = RANGE_MS[range];
              const history = windowMs
                ? await libDb.getWatchHistorySince(Number(historyId), Date.now() - windowMs)
                : await libDb.getWatchHistory(Number(historyId));
              send(res, 200, { history });
              return;
            }
            const [options, latest] = await Promise.all([libDb.getWatchOptions(), libDb.getLatestWatchSnapshots()]);
            const byId = new Map(latest.map((s) => [s.watch_id, s]));
            // Auto-probed rows (watch_options.source, currently only
            // 'gex-change-top') are pipeline plumbing for the scanner card flip,
            // not things the owner chose to track — keep them out of the list so
            // /owner/probe stays the manual watchlist. They ARE still snapshotted
            // by the refresh action below; only the listing hides them.
            const rows = options.filter((o) => !o.source).map((o) => ({ ...o, snapshot: byId.get(o.id) ?? null }));
            send(res, 200, { rows });
          } catch (err) { send(res, 500, { error: String(err) }); }
          return;
        }
        // POST
        try {
          const body = await readJson(req).catch(() => ({}));
          const action = String(body.action || '');
          if (action === 'add') {
            const ticker = String(body.ticker || '').trim().toUpperCase();
            const expiration = String(body.expiry || body.expiration || '').trim();
            const strike = Number(body.strike);
            const side = String(body.side || '').trim().toUpperCase() === 'C' ? 'C' : 'P';
            const note = body.note ? String(body.note).slice(0, 240) : null;
            const entryPrice = Number(body.addedPrice ?? body.entryPrice);
            const hasEntry = Number.isFinite(entryPrice) && entryPrice > 0;
            if (!ticker || !expiration || !Number.isFinite(strike)) { send(res, 400, { error: 'ticker, expiry and strike required' }); return; }
            const created = await libDb.insertWatchOption({ ticker, expiration, strike, side, note });
            if (created) {
              if (hasEntry) { await libDb.setWatchAddedPrice(created.id, entryPrice); created.added_price = entryPrice; }
              const snap = await probe(ctx, created);
              if (snap) {
                await libDb.insertWatchSnapshot(snap);
                if (snap.mark != null && !hasEntry) { await libDb.setWatchAddedPrice(created.id, snap.mark); created.added_price = snap.mark; }
              }
            }
            send(res, 200, { ok: true, created });
            return;
          }
          if (action === 'remove') {
            const id = Number(body.id);
            if (!Number.isFinite(id)) { send(res, 400, { error: 'id required' }); return; }
            await libDb.deleteWatchOption(id);
            send(res, 200, { ok: true });
            return;
          }
          if (action === 'refresh') {
            const options = await libDb.getWatchOptions();
            let recorded = 0;
            await Promise.all(options.map(async (o) => { const snap = await probe(ctx, o); if (snap) { await libDb.insertWatchSnapshot(snap); recorded++; } }));
            const latest = await libDb.getLatestWatchSnapshots();
            const byId = new Map(latest.map((s) => [s.watch_id, s]));
            // Every contract gets refreshed (auto-probed ones included — that's
            // what fills the scanner card's chart); only the response hides them.
            const rows = options.filter((o) => !o.source).map((o) => ({ ...o, snapshot: byId.get(o.id) ?? null }));
            send(res, 200, { ok: true, recorded, rows });
            return;
          }
          send(res, 400, { error: 'unknown action' });
        } catch (err) { send(res, 500, { error: String(err) }); }
      },
    });
  }

  // /api/social-media/day-list — auto-generated Day Posts copy list (day_posts
  // table, written by the day-post-writer cron). GET. Subscriber. Ported verbatim.
  register('/api/social-media/day-list', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res) {
      const todayET2 = () => {
        const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
        const m = {}; p.forEach((x) => { m[x.type] = x.value; });
        return `${m.year}-${m.month}-${m.day}`;
      };
      try {
        const pool = libDb.getPool();
        await pool.query(`
          CREATE TABLE IF NOT EXISTS day_posts (
            date TEXT NOT NULL, slot TEXT NOT NULL, tweet TEXT NOT NULL, data JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (date, slot)
          )`);
        const date = new URL(req.url || '/', 'http://localhost').searchParams.get('date') || todayET2();
        const { rows } = await pool.query(
          `SELECT date, slot, tweet, created_at FROM day_posts WHERE date=$1
           ORDER BY CASE slot WHEN 'premarket' THEN 0 WHEN 'midday' THEN 1 WHEN 'eod' THEN 2 ELSE 3 END`, [date]);
        send(res, 200, { date, rows }, { 'Cache-Control': NO_STORE });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // ── Owner admin routes (all fail-closed owner-gated in the originals via
  // getServerUserId+OWNER_USER_ID → enforceAuth 'owner'). All libDb-backed. ──

  // /api/admin/customer-activity — engagement feed (page_visits ⋈ users/subs).
  register('/api/admin/customer-activity', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res) {
      try {
        const [activity, authRows] = await Promise.all([libDb.getCustomerActivity(), libDb.listUsersWithLastLogin()]);
        const authUsers = new Map(authRows.map((r) => [r.id, r]));
        const rows = await Promise.all(activity.map(async (a) => {
          const au = authUsers.get(a.user_id);
          let paid = false;
          try { const sub = await libDb.getSubscription(a.user_id); paid = !!sub?.status && libDb.PAID_STATUSES.has(sub.status); } catch { /* unpaid */ }
          return { userId: a.user_id, email: au?.email ?? null, lastLogin: au?.last_login_at ?? null, lastSeen: a.last_seen, firstSeen: a.first_seen, totalLoads: a.total_loads, distinctPages: a.distinct_pages, sessionCount: a.session_count, approxActiveSec: Math.round(a.approx_active_sec), topPath: a.top_path, paid };
        }));
        send(res, 200, { ok: true, rows: rows.filter((r) => r.email) });
      } catch (err) { send(res, 500, { error: 'Activity load failed', detail: String(err) }); }
    },
  });

  // /api/admin/far-cb-tickers — who added which Far CB Watch tickers.
  register('/api/admin/far-cb-tickers', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res) {
      try { const rows = await libDb.listFarCbTickers(); send(res, 200, { ok: true, rows }); }
      catch (err) { send(res, 500, { error: 'Load failed', detail: String(err) }); }
    },
  });

  // /api/admin/sales-expenses — business expense CRUD.
  {
    const CADENCES = new Set(['monthly', 'yearly', 'once']);
    register('/api/admin/sales-expenses', {
      auth: 'owner', methods: ['GET', 'POST', 'DELETE'],
      async handler(req, res) {
        try {
          if (req.method === 'GET') { const rows = await libDb.listSalesExpenses(); send(res, 200, { ok: true, count: rows.length, expenses: rows }); return; }
          if (req.method === 'DELETE') {
            const id = Number(new URL(req.url || '/', 'http://localhost').searchParams.get('id'));
            if (!Number.isFinite(id)) { send(res, 400, { error: 'id query param required' }); return; }
            const { removed } = await libDb.removeSalesExpense(id);
            send(res, 200, { ok: true, removed, id });
            return;
          }
          const body = await readJson(req).catch(() => ({}));
          const name = String(body?.name ?? '').trim();
          const category = String(body?.category ?? 'other').trim() || 'other';
          const amountCents = Math.round(Number(body?.amountCents));
          const cadence = String(body?.cadence ?? 'monthly').trim();
          if (!name) { send(res, 400, { error: 'name required' }); return; }
          if (!Number.isFinite(amountCents) || amountCents <= 0) { send(res, 400, { error: 'amountCents must be a positive number' }); return; }
          if (!CADENCES.has(cadence)) { send(res, 400, { error: 'cadence must be monthly, yearly, or once' }); return; }
          const expense = await libDb.addSalesExpense(name, category, amountCents, cadence);
          send(res, 200, { ok: true, expense });
        } catch (err) { send(res, 500, { error: 'Save failed', detail: String(err) }); }
      },
    });
  }

  // /api/admin/unsubscribes — global suppression-list CRUD.
  {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    register('/api/admin/unsubscribes', {
      auth: 'owner', methods: ['GET', 'POST', 'DELETE'],
      async handler(req, res) {
        try {
          if (req.method === 'GET') { const rows = await libDb.listUnsubscribes(); send(res, 200, { ok: true, count: rows.length, unsubscribes: rows }); return; }
          if (req.method === 'DELETE') {
            const email = (new URL(req.url || '/', 'http://localhost').searchParams.get('email') || '').trim().toLowerCase();
            if (!email) { send(res, 400, { error: 'email query param required' }); return; }
            const { removed } = await libDb.removeUnsubscribe(email);
            send(res, 200, { ok: true, removed, email });
            return;
          }
          const body = await readJson(req).catch(() => ({}));
          const email = String(body?.email ?? '').trim().toLowerCase();
          if (!EMAIL_RE.test(email)) { send(res, 400, { error: 'Valid email required' }); return; }
          const { added } = await libDb.addUnsubscribe(email, 'manual');
          send(res, 200, { ok: true, added, email });
        } catch (err) { send(res, 500, { error: 'Save failed', detail: String(err) }); }
      },
    });
  }

  // /api/admin/discord-connections — linked-Discord accounts. discordAvatarUrl
  // inlined from lib/discord.ts.
  {
    const discordAvatarUrl = (discordId, avatar) => {
      if (!avatar) return null;
      const ext = avatar.startsWith('a_') ? 'gif' : 'png';
      return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.${ext}?size=64`;
    };
    register('/api/admin/discord-connections', {
      auth: 'owner', methods: ['GET'],
      async handler(req, res) {
        try {
          const rows = await libDb.listDiscordConnections();
          send(res, 200, { ok: true, rows: rows.map((r) => ({ email: r.email, discord_username: r.discord_username, avatar_url: discordAvatarUrl(r.discord_id, r.discord_avatar), connected_at: r.discord_connected_at, is_owner: r.is_owner })) });
        } catch (err) { send(res, 500, { error: 'Load failed', detail: String(err) }); }
      },
    });
  }

  // /api/unsubscribe — public RFC-8058 one-click / confirmation-page unsubscribe.
  // verifyUnsubscribe (HMAC) inlined from lib/unsubscribe.ts. Ported verbatim.
  {
    const SECRET = (process.env.UNSUBSCRIBE_SECRET || process.env.WAITLIST_ADMIN_SECRET || '').trim();
    const norm = (email) => email.trim().toLowerCase();
    const unsubscribeToken = (email) => { if (!SECRET) return ''; return nodeCrypto.createHmac('sha256', SECRET).update(norm(email)).digest('hex').slice(0, 32); };
    const verifyUnsubscribe = (email, token) => {
      if (!SECRET || !token) return false;
      const expected = unsubscribeToken(email);
      if (expected.length !== token.length) return false;
      return nodeCrypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
    };
    register('/api/unsubscribe', {
      auth: 'public', methods: ['POST'],
      async handler(req, res) {
        try {
          const sp = new URL(req.url || '/', 'http://localhost').searchParams;
          let email = (sp.get('e') || '').trim().toLowerCase();
          let token = (sp.get('t') || '').trim();
          if (!email || !token) {
            const body = await readJson(req).catch(() => ({}));
            email = String(body?.email ?? email).trim().toLowerCase();
            token = String(body?.token ?? token).trim();
          }
          if (!email || !token) { send(res, 400, { ok: false, error: 'Missing email or token.' }); return; }
          if (!verifyUnsubscribe(email, token)) { send(res, 403, { ok: false, error: 'Invalid or expired link.' }); return; }
          await libDb.addUnsubscribe(email, 'link');
          await libDb.unsubscribeWaitlistEmail(email);
          send(res, 200, { ok: true, message: "You've been unsubscribed." });
        } catch (err) { send(res, 500, { ok: false, error: 'Server error.' }); }
      },
    });
  }

  // /api/waitlist — public launch-notify signups (POST) + secret-gated admin
  // export (GET ?secret=). Google-Sheets mirror inlined via require('googleapis')
  // (best-effort no-op when unconfigured/unavailable). Ported verbatim.
  {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const DISPOSABLE_DOMAINS = new Set([
      'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org',
      'throwawaymail.com', 'yopmail.com', 'trashmail.com', 'getnada.com', 'sharklasers.com',
      'dispostable.com', 'maildrop.cc', 'fakeinbox.com', 'mintemail.com', 'mohmal.com', 'emailondeck.com',
    ]);
    const normalizeEmail = (raw) => {
      const e = raw.trim().toLowerCase();
      const [local, domain] = e.split('@');
      if (!domain) return e;
      if (domain === 'gmail.com' || domain === 'googlemail.com') { const base = local.split('+')[0].replace(/\./g, ''); return `${base}@gmail.com`; }
      return `${local.split('+')[0]}@${domain}`;
    };
    // Inlined lib/google-sheets.ts appendWaitlistRowToSheet (best-effort).
    const SHEET_ID = process.env.WAITLIST_SHEET_ID;
    const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const SA_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const SHEET_RANGE = process.env.WAITLIST_SHEET_RANGE || 'Sheet1!A:E';
    let _sheets = null, _headerEnsured = false;
    const sheetsConfigured = () => Boolean(SHEET_ID && SA_EMAIL && SA_KEY);
    const getSheets = () => {
      if (_sheets) return _sheets;
      const { google } = require('googleapis');
      const auth = new google.auth.JWT({ email: SA_EMAIL, key: SA_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
      _sheets = google.sheets({ version: 'v4', auth });
      return _sheets;
    };
    const ensureHeader = async (sheets) => {
      if (_headerEnsured) return;
      _headerEnsured = true;
      try {
        const tab = SHEET_RANGE.split('!')[0];
        const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!A1:E1` });
        const hasHeader = (r.data.values?.[0]?.length ?? 0) > 0;
        if (!hasHeader) await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${tab}!A1:E1`, valueInputOption: 'RAW', requestBody: { values: [['Email', 'Source', 'Referrer', 'User Agent', 'Signed Up']] } });
      } catch { /* best-effort */ }
    };
    const appendWaitlistRowToSheet = async (row) => {
      if (!sheetsConfigured()) { console.warn('[sheets] Google Sheets export not configured — skipping.'); return; }
      const sheets = getSheets();
      await ensureHeader(sheets);
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID, range: SHEET_RANGE, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [[row.email, row.source ?? 'landing', row.referrer ?? '', row.user_agent ?? '', new Date().toISOString()]] },
      });
    };
    register('/api/waitlist', {
      auth: 'public', methods: ['GET', 'POST'],
      async handler(req, res) {
        if (req.method === 'GET') {
          const secret = new URL(req.url || '/', 'http://localhost').searchParams.get('secret');
          if (!process.env.WAITLIST_ADMIN_SECRET || secret !== process.env.WAITLIST_ADMIN_SECRET) { send(res, 401, { ok: false, error: 'Unauthorized.' }); return; }
          try { const rows = await libDb.listWaitlist(); send(res, 200, { ok: true, count: rows.length, rows }); }
          catch (err) { send(res, 500, { ok: false, error: 'Server error.' }); }
          return;
        }
        try {
          const body = await readJson(req).catch(() => ({}));
          const rawEmail = String(body?.email ?? '').trim().toLowerCase();
          const email = normalizeEmail(rawEmail);
          if (!email || !EMAIL_RE.test(email) || email.length > 254) { send(res, 400, { ok: false, error: 'Invalid email.' }); return; }
          const domain = email.split('@')[1];
          if (DISPOSABLE_DOMAINS.has(domain)) { send(res, 400, { ok: false, error: 'Please use a permanent email address.' }); return; }
          const source = typeof body?.source === 'string' ? body.source : 'landing';
          const referrer = req.headers['referer'] || null;
          const user_agent = req.headers['user-agent'] || null;
          const { added } = await libDb.addWaitlistEmail({ email, source, referrer, user_agent });
          if (added) appendWaitlistRowToSheet({ email, source, referrer, user_agent }).catch((err) => console.error('[waitlist] sheet append failed:', err?.message || err));
          send(res, 200, { ok: true, added, message: added ? "You're on the list." : "You're already on the list." });
        } catch (err) { send(res, 500, { ok: false, error: 'Server error.' }); }
      },
    });
  }

  // /api/em-tracker family — per-ticker weekly EM hit/miss record. No explicit
  // auth in the originals (middleware /api/* = subscriber), so all gate
  // 'subscriber' (cron writes pass via the internal-token bypass). computeResult
  // inlined from lib/em-tracker/computeResult.ts; evaluate/commit-history use the
  // CJS server-v2 levels-engine (required at module top). Ported verbatim.
  {
    const computeResult = (r) => {
      const em = Number(r.em);
      if (!Number.isFinite(em) || em <= 0) return null;
      const ref = r.ref_close != null ? Number(r.ref_close) : null;
      const up = r.up != null ? Number(r.up) : (ref != null ? ref + em : null);
      const down = r.down != null ? Number(r.down) : (ref != null ? ref - em : null);
      if (up == null || down == null) return null;
      const h = r.h != null ? Number(r.h) : null;
      const l = r.l != null ? Number(r.l) : null;
      if (h == null || l == null) return null;
      return h <= up && l >= down ? 'hit' : 'miss';
    };
    register('/api/em-tracker', {
      auth: 'owner', methods: ['GET', 'POST', 'DELETE'],
      async handler(req, res) {
        try {
          await libDb.getDb();
          const sp = new URL(req.url || '/', 'http://localhost').searchParams;
          if (req.method === 'GET') {
            const view = sp.get('view');
            const ticker = (sp.get('ticker') || '').trim().toUpperCase();
            const weekStart = (sp.get('week_start') || '').trim();
            const status = (sp.get('status') || '').trim();
            if (weekStart && status === 'pending') { send(res, 200, { rows: await libDb.getEmTrackerPendingForWeek(weekStart) }); return; }
            if (view === 'summary') { send(res, 200, { summary: await libDb.getEmTrackerSummary() }); return; }
            if (ticker) { send(res, 200, { rows: await libDb.getEmTrackerRows(ticker) }); return; }
            const [summary, rows] = await Promise.all([libDb.getEmTrackerSummary(), libDb.getEmTrackerRows()]);
            send(res, 200, { summary, rows });
            return;
          }
          if (req.method === 'DELETE') {
            const all = sp.get('all');
            const source = sp.get('source');
            if (all === '1' || source) { const removed = await libDb.clearEmTracker(source || undefined); send(res, 200, { ok: true, removed }); return; }
            const id = Number(sp.get('id'));
            if (!id) { send(res, 400, { error: 'Missing id (or pass ?all=1 / ?source=)' }); return; }
            await libDb.deleteEmTrackerRow(id);
            send(res, 200, { ok: true });
            return;
          }
          // POST
          const body = await readJson(req);
          if (body.id != null && (body.result === 'hit' || body.result === 'miss')) {
            await libDb.setEmTrackerResult(Number(body.id), body.result, 'manual');
            send(res, 200, { ok: true });
            return;
          }
          const incoming = Array.isArray(body.rows) ? body.rows : body.ticker ? [body] : [];
          if (!incoming.length) { send(res, 400, { error: 'Nothing to save' }); return; }
          let saved = 0;
          for (const raw of incoming) {
            if (!raw.ticker || !raw.week_label || raw.em == null) continue;
            const row = { ...raw, ticker: String(raw.ticker).toUpperCase(), em: Number(raw.em), result_source: raw.result_source ?? (Array.isArray(body.rows) ? 'import' : 'manual') };
            if (row.result == null) { const computed = computeResult(row); if (computed) row.result = computed; }
            await libDb.upsertEmTrackerRow(row);
            saved++;
          }
          send(res, 200, { ok: true, saved });
        } catch (err) { send(res, 500, { error: String(err) }); }
      },
    });

    // evaluate + commit-history need the CJS levels-engine — only register when
    // it loaded (else fall through to Next).
    if (levelsEngine) {
      register('/api/em-tracker/evaluate', {
        auth: 'owner', methods: ['POST'],
        async handler(req, res, ctx) {
          try {
            await libDb.getDb();
            let ohlc = [];
            try { const body = await readJson(req); if (Array.isArray(body?.ohlc)) ohlc = body.ohlc; } catch { /* no body */ }
            if (ohlc.length) {
              for (const k of ohlc) { if (!k.ticker || !k.week_label) continue; await libDb.updateEmTrackerOhlc(k.ticker, k.week_label, { o: k.o, h: k.h, l: k.l, c: k.c }); }
              const pending = await libDb.getEmTrackerUnevaluated();
              let hits = 0, misses = 0;
              for (const row of pending) { const result = computeResult(row); if (!result) continue; await libDb.setEmTrackerResult(row.id, result, 'auto'); if (result === 'hit') hits++; else misses++; }
              send(res, 200, { ok: true, evaluated: hits + misses, hits, misses, mode: 'ohlc-backfill' });
              return;
            }
            const base = `http://localhost:${ctx.port || process.env.PORT || 3001}`;
            const out = await levelsEngine.evaluateCompletedWeek(base);
            send(res, 200, { ok: true, ...out, mode: 'weekly' });
          } catch (err) { send(res, 500, { error: String(err) }); }
        },
      });

      register('/api/em-tracker/commit-history', {
        auth: 'owner', methods: ['POST'],
        async handler(req, res, ctx) {
          try {
            const body = await readJson(req);
            const weeks = Array.isArray(body?.weeks) ? body.weeks : [];
            if (!weeks.length) { send(res, 400, { error: 'No weeks supplied' }); return; }
            await libDb.getDb();
            const bands = weeks.flatMap((w) => (w.rows || [])
              .filter((r) => r.ticker && Number.isFinite(Number(r.up)) && Number.isFinite(Number(r.down)))
              .map((r) => ({ ticker: String(r.ticker).toUpperCase(), week_start: w.week_start, week_label: w.week_label, up: Number(r.up), down: Number(r.down), em: r.em != null ? Number(r.em) : undefined, ref_close: r.ref_close != null ? Number(r.ref_close) : undefined })));
            if (!bands.length) { send(res, 400, { error: 'No valid bands' }); return; }
            const base = `http://localhost:${ctx.port || process.env.PORT || 3000}`;
            const out = await levelsEngine.evaluateHistoricalWeeks(base, bands);
            send(res, 200, { ok: true, weeks: weeks.length, bands: bands.length, ...out });
          } catch (err) { send(res, 500, { error: String(err) }); }
        },
      });
    }

    // em-tracker/history + discord-preview — read-only fs reference data.
    register('/api/em-tracker/history', {
      auth: 'owner', methods: ['GET'],
      async handler(req, res) {
        try {
          const file = nodePath.join(process.cwd(), 'data', 'em-tracker-history.json');
          const json = JSON.parse(await fs.promises.readFile(file, 'utf8'));
          send(res, 200, json);
        } catch { send(res, 200, { tallies: {}, total_weeks: 0 }); }
      },
    });
    register('/api/em-tracker/discord-preview', {
      auth: 'owner', methods: ['GET'],
      async handler(req, res) {
        try {
          const file = nodePath.join(process.cwd(), 'data', 'em-discord-preview.json');
          const json = JSON.parse(await fs.promises.readFile(file, 'utf8'));
          send(res, 200, json);
        } catch { send(res, 200, { weeks: [], note: 'No preview yet — run scripts/import-em-from-discord.mjs' }); }
      },
    });
    // em-tracker/import-sheet — retired 410 stub.
    register('/api/em-tracker/import-sheet', {
      auth: 'owner', methods: ['POST'],
      async handler(req, res) { send(res, 410, { error: 'Endpoint retired — use /api/em-tracker/evaluate' }); },
    });
  }

  // /api/ict-setups — ICT setup recorder. GET recap (subscriber), POST scan/grade
  // (token-gated inside, cron-driven). analyzeICT via the _lib-ict.cjs bundle;
  // db reads/writes via libDb. Ported verbatim from app/api/ict-setups/route.ts.
  if (libIct) {
    const etDateStr2 = (d = new Date()) => {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).filter((p) => p.type !== 'literal').reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
      return `${parts.year}-${parts.month}-${parts.day}`;
    };
    const fetchCandles = async (date) => {
      const rows = await libDb.getEsCandles(date, undefined, 2000);
      return rows.map((c) => ({ timestamp: Number(c.timestamp), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume ?? 0), date: String(c.date ?? date) }))
        .filter((c) => Number.isFinite(c.timestamp) && c.high >= c.low)
        .sort((a, b) => a.timestamp - b.timestamp);
    };
    const round2 = (n) => Math.round(n * 100) / 100;
    const keyFor = (d) => `${d.kind}:${d.dir}:${d.trigger_ts}:${Math.round(d.price)}`;
    const extractSetups = (candles) => {
      const a = libIct.analyzeICT(candles);
      const out = [];
      const lastClose = candles.length ? candles[candles.length - 1].close : 0;
      const byTs = new Map(candles.map((c) => [c.timestamp, c]));
      const atr = (() => {
        const n = Math.min(14, candles.length - 1);
        if (n <= 0) return 2;
        let sum = 0;
        for (let i = candles.length - n; i < candles.length; i++) { const c = candles[i], p = candles[i - 1]; sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)); }
        return Math.max(1, sum / n);
      })();
      const buf = Math.max(1, atr * 0.15);
      const structuralStop = (dir, entry, ts) => {
        if (dir === 'bull') { const lows = a.pivots.filter((p) => p.type === 'low' && p.confirmTs <= ts && p.price < entry).map((p) => p.price); const lvl = lows.length ? Math.max(...lows) : entry - atr; return lvl - buf; }
        const highs = a.pivots.filter((p) => p.type === 'high' && p.confirmTs <= ts && p.price > entry).map((p) => p.price); const lvl = highs.length ? Math.min(...highs) : entry + atr; return lvl + buf;
      };
      const pushEvent = (kind, label, dir, ts, level, note) => {
        const bar = byTs.get(ts);
        const entry = bar ? bar.close : level;
        const invalidation = structuralStop(dir, entry, ts);
        const inval = dir === 'bull' ? Math.min(invalidation, entry - buf) : Math.max(invalidation, entry + buf);
        out.push({ kind, label, dir, trigger_ts: ts, price: round2(entry), note, target: null, invalidation: inval });
      };
      for (const s of a.structure) pushEvent(s.kind.toLowerCase(), s.kind, s.dir, s.ts, s.price, `${s.kind} ${s.dir} @ ${round2(s.price)}`);
      for (const d of a.displacement) pushEvent('displacement', 'Displacement', d.dir, d.endTs, d.endPrice, `displacement ${d.dir} ×${round2(d.bodyRatio)} ATR`);
      for (const p of a.liquidity) {
        if (!p.swept) continue;
        const sweepBar = candles.find((c) => c.timestamp > p.confirmTs && (p.side === 'BSL' ? c.high > p.price : c.low < p.price));
        if (!sweepBar) continue;
        const dir = p.side === 'BSL' ? 'bear' : 'bull';
        const kind = p.count >= 2 ? 'eqhl' : 'liquidity';
        const label = p.count >= 2 ? `EQ${p.side === 'BSL' ? 'H' : 'L'} swept` : `${p.side} swept`;
        pushEvent(kind, label, dir, sweepBar.timestamp, p.price, `${p.side}${p.count > 1 ? ` ×${p.count}` : ''} swept @ ${round2(p.price)}`);
      }
      const signalGroups = [
        { sigs: a.inducement, label: 'Inducement' }, { sigs: a.turtleSoup, label: 'Turtle Soup' }, { sigs: a.judas, label: 'Judas Swing' },
        { sigs: a.breakers, label: 'Breaker' }, { sigs: a.cisd, label: 'CISD' }, { sigs: a.model2022, label: '2022 Model' },
      ];
      for (const { sigs, label } of signalGroups) for (const s of sigs) pushEvent(s.kind, label, s.dir, s.ts, s.price, s.note ?? `${label} ${s.dir}`);
      for (const f of a.fvgs) {
        const ts = f.inverted && f.invertedTs ? f.invertedTs : f.ts;
        const mid = (f.top + f.bottom) / 2;
        pushEvent(f.inverted ? 'ifvg' : 'fvg', f.inverted ? 'IFVG' : 'FVG', f.activeDir, ts, mid, `${f.inverted ? 'IFVG' : 'FVG'} ${f.activeDir} ${round2(f.bottom)}–${round2(f.top)}`);
      }
      for (const o of a.orderBlocks) {
        if (!o.valid) continue;
        const retest = candles.find((c) => c.timestamp > o.confirmTs && c.low <= o.top && c.high >= o.bottom);
        if (!retest) continue;
        const edge = o.dir === 'bull' ? o.bottom : o.top;
        pushEvent('ob', 'Order Block', o.dir, retest.timestamp, edge, `OB ${o.dir} ${round2(o.bottom)}–${round2(o.top)} (retest)`);
      }
      if (a.range) {
        const lo = Math.min(a.range.ote.from, a.range.ote.to);
        const hi = Math.max(a.range.ote.from, a.range.ote.to);
        const entry = candles.find((c) => c.low <= hi && c.high >= lo);
        if (entry) pushEvent('ote', 'OTE entry', a.range.dir, entry.timestamp, (lo + hi) / 2, `OTE ${round2(lo)}–${round2(hi)} (${a.range.dir})`);
      }
      void lastClose;
      const seen = new Set();
      return out.filter((d) => {
        if (!Number.isFinite(d.price) || !Number.isFinite(d.trigger_ts)) return false;
        const k = keyFor(d);
        return seen.has(k) ? false : (seen.add(k), true);
      });
    };
    const gradeSetup = (row, candles, sessionClosed) => {
      const dir = row.dir;
      const after = candles.filter((c) => c.timestamp > row.trigger_ts);
      const entry = row.price ?? 0;
      const inval = row.invalidation;
      if (dir === 'neutral' || inval == null || !after.length) return { outcome: 'pending', mfe: row.mfe, mae: row.mae, r_multiple: row.r_multiple ?? null, resolved_ts: null, resolved_price: null };
      const risk = Math.abs(entry - inval) || 1;
      let mfe = 0, mae = 0;
      for (const c of after) {
        const fav = dir === 'bull' ? c.high - entry : entry - c.low;
        const adv = dir === 'bull' ? entry - c.low : c.high - entry;
        if (fav > mfe) mfe = fav;
        if (adv > mae) mae = adv;
        const hitStop = dir === 'bull' ? c.low <= inval : c.high >= inval;
        if (hitStop) { const maxR = round2(mfe / risk); return { outcome: maxR >= 1 ? 'win' : 'loss', mfe, mae, r_multiple: maxR, resolved_ts: c.timestamp, resolved_price: inval }; }
      }
      const maxR = round2(mfe / risk);
      if (sessionClosed) return { outcome: maxR >= 1 ? 'win' : 'chop', mfe, mae, r_multiple: maxR, resolved_ts: after[after.length - 1].timestamp, resolved_price: after[after.length - 1].close };
      return { outcome: 'pending', mfe, mae, r_multiple: maxR, resolved_ts: null, resolved_price: null };
    };
    register('/api/ict-setups', {
      auth: 'subscriber', methods: ['GET', 'POST'],
      async handler(req, res, ctx) {
        if (req.method === 'GET') {
          try {
            const sp = new URL(req.url || '/', 'http://localhost').searchParams;
            const date = sp.get('date') || etDateStr2();
            const all = sp.get('all') === '1';
            const sinceDays = sp.get('since') ? Number(sp.get('since')) : null;
            const sinceDate = sinceDays && sinceDays > 0 ? etDateStr2(new Date(Date.now() - sinceDays * 86_400_000)) : null;
            const summaryOpts = all ? (sinceDate ? { sinceDate } : {}) : { date };
            const [setups, summary] = await Promise.all([
              libDb.getIctSetups({ date: all ? undefined : date, sinceDate: all ? sinceDate ?? undefined : undefined, limit: 2000 }),
              libDb.getIctSetupSummary(summaryOpts),
            ]);
            send(res, 200, { date, sinceDate, setups, summary });
          } catch (err) { send(res, 500, { error: String(err) }); }
          return;
        }
        // POST — token-gated (cron), mirrors the original tokenOk check.
        try {
          if (!tokenOk(req, ctx)) { send(res, 401, { error: 'unauthorized' }); return; }
          const body = await readJson(req).catch(() => ({}));
          const action = String(body.action || 'scan');
          const date = String(body.date || etDateStr2());
          const candles = await fetchCandles(date);
          if (!candles.length) { send(res, 200, { ok: true, date, detected: 0, recorded: 0, graded: 0, note: 'no candles' }); return; }
          const lastSlot = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(candles[candles.length - 1].timestamp));
          const sessionClosed = lastSlot >= '15:55';
          let recorded = 0, detected = 0;
          if (action === 'scan') {
            const setups = extractSetups(candles);
            detected = setups.length;
            for (const d of setups) {
              const { inserted } = await libDb.insertIctSetup({
                setup_key: keyFor(d), date, kind: d.kind, label: d.label, dir: d.dir, trigger_ts: d.trigger_ts,
                price: round2(d.price), note: d.note, target: d.target != null ? round2(d.target) : null,
                invalidation: d.invalidation != null ? round2(d.invalidation) : null,
              });
              if (inserted) recorded++;
            }
          }
          const pending = await libDb.getPendingIctSetups(date);
          let graded = 0;
          for (const row of pending) {
            const g = gradeSetup(row, candles, sessionClosed);
            await libDb.updateIctSetupGrade({ setup_key: row.setup_key, outcome: g.outcome, mfe: round2(g.mfe), mae: round2(g.mae), r_multiple: g.r_multiple, resolved_ts: g.resolved_ts, resolved_price: g.resolved_price });
            if (g.outcome !== 'pending') graded++;
          }
          send(res, 200, { ok: true, date, detected, recorded, graded, sessionClosed });
        } catch (err) { send(res, 500, { error: String(err) }); }
      },
    });
  }

  // /api/confidence/checkpoints — per-day MVC (CB) checkpoint tracking. Owner
  // results board. Inlined from lib/confidenceCheckpoints.ts (checkpointDates +
  // computeCheckpointData; the unstable_cache path there is unused by this route)
  // using libDb.queryAll. Ported verbatim from app/api/confidence/checkpoints.
  {
    const HIT_PTS = 8;
    const TIERS = [5, 10, 15];
    const CHECKPOINTS = [
      { key: '0945', label: '9:45', min: 9 * 60 + 45 },
      { key: '1030', label: '10:30', min: 10 * 60 + 30 },
      { key: '1200', label: '12:00', min: 12 * 60 },
    ];
    const MATCH_WINDOW = 20;
    const cnum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    const strikeOf = (r) => cnum(r.strikeOIVol) ?? cnum(r.strikeVolOnly) ?? null;
    const rowMinutesET = (r) => {
      const t = String(r.time ?? '');
      const mm = /^(\d{1,2}):(\d{2})/.exec(t);
      if (mm) return Number(mm[1]) * 60 + Number(mm[2]);
      const ms = Number(r.timestamp) || 0;
      if (!ms) return null;
      const hhmm = new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' });
      const p = /^(\d{1,2}):(\d{2})/.exec(hhmm);
      return p ? Number(p[1]) * 60 + Number(p[2]) : null;
    };
    const computeCheckpointData = async (dates) => {
      const days = [];
      for (const date of dates) {
        const rows = await libDb.queryAll(`SELECT * FROM mvc_snapshots WHERE date = ? ORDER BY timestamp ASC LIMIT 2000`, [date]);
        const timed = rows.map((r) => { const rawSpx = cnum(r.spxPrice); const spx = rawSpx != null && rawSpx > 1000 ? rawSpx : null; return { min: rowMinutesET(r), strike: strikeOf(r), spx }; }).filter((x) => x.min != null);
        if (!timed.length) continue;
        if (!timed.some((t) => t.spx != null)) continue;
        const resolved = CHECKPOINTS.map((cp) => {
          let best = null, bestGap = Infinity, bestSpx = null, bestSpxGap = Infinity;
          for (const t of timed) {
            const gap = Math.abs(t.min - cp.min);
            if (gap < bestGap) { bestGap = gap; best = t; }
            if (t.spx != null && gap < bestSpxGap) { bestSpxGap = gap; bestSpx = t; }
          }
          const matched = best != null && bestGap <= MATCH_WINDOW;
          const spxMatched = bestSpx != null && bestSpxGap <= MATCH_WINDOW;
          return { cp, matched, strike: matched ? best.strike : null, spxAt: spxMatched ? bestSpx.spx : (matched ? best.spx : null) };
        });
        const checkpoints = resolved.map((r, idx) => {
          const { cp, matched, strike, spxAt } = r;
          const distAt = strike != null && spxAt != null ? Math.abs(spxAt - strike) : null;
          let changed = false;
          for (let j = idx + 1; j < resolved.length; j++) { const nxt = resolved[j]; if (nxt.matched && nxt.strike != null && strike != null && nxt.strike !== strike) { changed = true; break; } }
          let closest = null;
          if (strike != null) { for (const t of timed) { if (t.min < cp.min - MATCH_WINDOW) continue; if (t.spx == null || t.spx <= 0) continue; const d = Math.abs(t.spx - strike); if (closest == null || d < closest) closest = d; } }
          if (closest != null && strike != null && closest > strike * 0.5) closest = null;
          const tiers = {};
          for (const t of TIERS) tiers[t] = closest != null ? closest <= t : null;
          return { key: cp.key, label: cp.label, strike, spxAt, distAt, closest, hit: closest != null && closest <= HIT_PTS, matched, tiers, changed };
        });
        days.push({ date, checkpoints });
      }
      const summary = CHECKPOINTS.map((cp) => {
        const cells = days.map((d) => d.checkpoints.find((c) => c.key === cp.key)).filter((c) => !!c && c.matched && c.strike != null);
        const hits = cells.filter((c) => c.hit).length;
        const dists = cells.map((c) => c.closest).filter((v) => v != null);
        const avgClosest = dists.length ? dists.reduce((s, v) => s + v, 0) / dists.length : null;
        const tierStats = {};
        for (const t of TIERS) { const h = cells.filter((c) => c.tiers?.[t]).length; tierStats[t] = { hits: h, rate: cells.length ? h / cells.length : null }; }
        return { key: cp.key, label: cp.label, samples: cells.length, hits, hitRate: cells.length ? hits / cells.length : null, avgClosest, tiers: tierStats };
      });
      return { days, summary, hitPts: HIT_PTS, tiers: [...TIERS] };
    };
    const checkpointDates = async (limit) => {
      const rows = await libDb.queryAll(`SELECT DISTINCT date FROM mvc_snapshots ORDER BY date DESC LIMIT ?`, [limit]);
      return rows.map((d) => d.date);
    };
    register('/api/confidence/checkpoints', {
      auth: 'owner', methods: ['GET'],
      async handler(req, res) {
        try {
          const sp = new URL(req.url || '/', 'http://localhost').searchParams;
          const all = sp.get('all') === '1';
          const since = Number(sp.get('since')) || 20;
          const dates = await checkpointDates(all ? 365 : since);
          const data = await computeCheckpointData(dates);
          send(res, 200, data);
        } catch (e) { send(res, 500, { error: String(e) }); }
      },
    });
  }

  // /api/cb-trades — the CB contract trade log behind the owner Results →
  // Confidence → Trades tab. Every row is one checkpoint of one session: the
  // probed CB-strike 0DTE contract, whether the <= $1.00 rule bought it, and if
  // so what the 5-10 pt auto-sell did with it.
  //
  // GET   ?since=20 | ?all=1 | ?date=YYYY-MM-DD   → { trades, summary, config }
  //       ?ticks=<tradeId>                        → { ticks } (the poll curve)
  // POST  { action: 'tick' | 'checkpoint' | 'poll' | 'settle' }
  //       'tick' is what server-v2/cb-trade-recorder.js calls once a minute and
  //       does the whole job; the other three exist so a session can be repaired
  //       or replayed by hand without waiting on the clock.
  //
  // Owner-gated, with the standard x-internal-token bypass (enforceAuth) so the
  // in-process recorder can post without a session. Writes are the ONLY way rows
  // appear — TastyTrade has no per-contract history, so nothing here can be
  // backfilled after the fact.
  if (cbTrack) {
    register('/api/cb-trades', {
      auth: 'owner', methods: ['GET', 'POST'],
      async handler(req, res, ctx) {
        const sp = new URL(req.url || '/', 'http://localhost').searchParams;
        if (req.method === 'GET') {
          try {
            const ticksFor = sp.get('ticks');
            if (ticksFor) { send(res, 200, { ticks: await cbTrack.listTicks(ticksFor) }, { 'Cache-Control': NO_STORE }); return; }
            // ?diag=1 mirrors POST {action:'diagnose'} so it can be opened
            // straight from the browser address bar while signed in as owner.
            if (sp.get('diag') === '1') {
              send(res, 200, await cbTrack.diagnose(ctx, { date: sp.get('date') || undefined }), { 'Cache-Control': NO_STORE });
              return;
            }
            const date = sp.get('date') || undefined;
            const all = sp.get('all') === '1';
            const since = Number(sp.get('since')) || 20;
            const trades = await cbTrack.listTrades({ date, all, since });
            send(res, 200, {
              trades,
              summary: cbTrack.summarize(trades),
              config: cbTrack.CONFIG,
              checkpoints: cbTrack.CHECKPOINTS,
            }, { 'Cache-Control': NO_STORE });
          } catch (err) { send(res, 500, { error: String(err) }); }
          return;
        }
        try {
          const body = await readJson(req).catch(() => ({}));
          const action = String(body.action || 'tick');
          const date = body.date ? String(body.date) : undefined;
          if (action === 'tick') { send(res, 200, await cbTrack.tick(ctx)); return; }
          if (action === 'poll') { send(res, 200, await cbTrack.pollOpen(ctx, { date })); return; }
          if (action === 'settle') { send(res, 200, await cbTrack.settle(ctx, { date })); return; }
          // Read-only "why is nothing updating?" — recorder liveness, the CB each
          // checkpoint resolves to, a LIVE probe of the current one with its raw
          // status, and per-row tick counts. Records nothing.
          if (action === 'diagnose') { send(res, 200, await cbTrack.diagnose(ctx, { date })); return; }
          if (action === 'checkpoint') {
            const checkpoint = String(body.checkpoint || '');
            const d = date || cbTrack.etParts().date;
            send(res, 200, await cbTrack.runCheckpoint(ctx, { date: d, checkpoint }));
            return;
          }
          send(res, 400, { error: 'unknown action' });
        } catch (err) { send(res, 500, { error: String(err) }); }
      },
    });
  }

  // /api/bzila-alerts — owner-authored toolbar broadcasts. GET (paid/owner see
  // latest 5; others empty), POST/PATCH/DELETE owner-only. Ported verbatim from
  // app/api/bzila-alerts/route.ts; getServerSession replaced by ctx.verifyWsRequest
  // (GET auth 'public' then in-handler paid/owner check to match empty-list-for-all).
  register('/api/bzila-alerts', {
    auth: 'public', methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    async handler(req, res, ctx) {
      if (req.method === 'GET') {
        let access = { ok: false };
        try { access = await ctx.verifyWsRequest(req); } catch { access = { ok: false }; }
        if (!access.ok || !access.userId) { send(res, 200, { alerts: [] }); return; }
        try {
          const [alerts, counts, mine] = await Promise.all([
            libDb.getBzilaAlerts(5), libDb.getBzilaAlertCounts(), libDb.getUserBzilaReactions(access.userId),
          ]);
          const countMap = new Map(counts.map((c) => [c.alert_id, c]));
          const merged = alerts.map((a) => ({ ...a, up: countMap.get(a.id)?.up ?? 0, down: countMap.get(a.id)?.down ?? 0, mine: mine[a.id] ?? '' }));
          send(res, 200, { alerts: merged });
        } catch (err) { send(res, 500, { error: 'Load failed', detail: String(err) }); }
        return;
      }
      // Writes are owner-only — verify here since the route is auth:'public'.
      let access = { ok: false };
      try { access = await ctx.verifyWsRequest(req); } catch { access = { ok: false }; }
      const internal = req.headers['x-internal-token'] && ctx.internalToken && req.headers['x-internal-token'] === ctx.internalToken;
      const isOwner = internal || (access.userId && ctx.ownerUserId && access.userId === ctx.ownerUserId);
      if (!isOwner) { send(res, 403, { error: 'Forbidden' }); return; }
      try {
        if (req.method === 'POST') {
          const b = await readJson(req);
          const title = String(b?.title ?? '').slice(0, 120);
          const body = String(b?.body ?? '').trim().slice(0, 2000);
          if (!body) { send(res, 400, { error: 'Empty body' }); return; }
          const id = await libDb.insertBzilaAlert(title, body);
          send(res, 200, { ok: true, id });
          return;
        }
        if (req.method === 'PATCH') {
          const b = await readJson(req);
          const id = Number(b?.id);
          const title = String(b?.title ?? '').slice(0, 120);
          const body = String(b?.body ?? '').trim().slice(0, 2000);
          if (!id || !body) { send(res, 400, { error: 'Bad request' }); return; }
          await libDb.updateBzilaAlert(id, title, body);
          send(res, 200, { ok: true });
          return;
        }
        // DELETE
        const url = new URL(req.url || '/', 'http://localhost');
        let id = Number(url.searchParams.get('id'));
        if (!id) { const b = await readJson(req).catch(() => ({})); id = Number(b?.id); }
        if (!id) { send(res, 400, { error: 'Bad request' }); return; }
        await libDb.deleteBzilaAlert(id);
        send(res, 200, { ok: true });
      } catch (err) { send(res, 500, { error: 'Write failed', detail: String(err) }); }
    },
  });

  // /api/bzila-alerts/react — toggle 👍/👎 (paid/owner). Ported verbatim; email
  // sourced via getUserById since verifyWsRequest doesn't return it.
  register('/api/bzila-alerts/react', {
    auth: 'subscriber', methods: ['POST'],
    async handler(req, res, ctx, verdict) {
      try {
        const b = await readJson(req);
        const alertId = Number(b?.alertId);
        const reaction = b?.reaction === 'up' ? 'up' : b?.reaction === 'down' ? 'down' : null;
        if (!alertId || !reaction) { send(res, 400, { error: 'Bad request' }); return; }
        const userId = verdict?.userId;
        const user = userId ? await libDb.getUserById(userId) : null;
        const email = user?.email ?? null;
        const mine = await libDb.reactBzilaAlert(alertId, userId, email, reaction);
        const counts = await libDb.getBzilaAlertCounts();
        const c = counts.find((x) => x.alert_id === alertId);
        send(res, 200, { ok: true, mine, up: c?.up ?? 0, down: c?.down ?? 0 });
      } catch (err) { send(res, 500, { error: 'React failed', detail: String(err) }); }
    },
  });

  // /api/bzila-alerts/report — owner-only reaction analytics. Ported verbatim.
  register('/api/bzila-alerts/report', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res) {
      try { const alerts = await libDb.getBzilaAlertReport(50); send(res, 200, { alerts }); }
      catch (err) { send(res, 500, { error: 'Load failed', detail: String(err) }); }
    },
  });

  // /api/pinescript?ticker[&all=1][&symbols=...][&format=json] — generate a
  // ready-to-paste Pine v6 indicator from the latest ticker_levels row(s).
  // GET-only, subscriber. Ported verbatim from app/api/pinescript/route.ts.
  {
    const PS_ALIAS = {
      ES: 'ESU', ESM: 'ESU', ESU6: 'ESU', ESU26: 'ESU', '/ES': 'ESU',
      NQ: 'NQU', NQM: 'NQU', NQU6: 'NQU', NQU26: 'NQU', '/NQ': 'NQU',
    };
    const PS_CORE = ['SPX', 'NDX', 'ESU', 'NQU', 'SPY', 'QQQ', 'IWM'];
    const parseWatchlist = (raw) => {
      const out = new Set();
      for (const tok of raw.split(/[,\s]+/)) {
        let s = tok.trim().toUpperCase();
        if (!s || s.startsWith('#')) continue;
        if (s.includes(':')) s = s.split(':')[1];
        s = s.replace(/[$]/g, '').replace(/^\//, '');
        if (/^ES/.test(s) || s === 'ES1!') s = 'ESU';
        else if (/^NQ/.test(s) || s === 'NQ1!') s = 'NQU';
        else s = PS_ALIAS[s] || s;
        if (s) out.add(s);
      }
      return out;
    };
    const num = (v) => {
      if (v == null) return NaN;
      const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
      return Number.isFinite(n) ? n : NaN;
    };
    const pineNum = (v) => { const n = num(v); return Number.isFinite(n) ? String(n) : 'na'; };
    const buildPine = (row) => {
      const sym = (row.label || row.ticker || 'TICKER').toUpperCase();
      const stamp = row.em_updated_at
        ? new Date(row.em_updated_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
        : new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
      const exp = row.exp_label ? ` (${row.exp_label})` : '';
      return `//@version=6
// ${sym} Estimated Moves & Levels${exp}
// Auto-generated ${stamp} — values frozen; regenerate after a fresh EM publish.
indicator("${sym} EM & Levels", overlay=true, max_lines_count=100, max_labels_count=100)

// ── Baked-in values (plain constants — hidden from the Inputs panel) ──
emUp     = ${pineNum(row.up)}
emDown   = ${pineNum(row.down)}
emClose  = ${pineNum(row.close)}
pivot    = ${pineNum(row.pivot)}
buyNear  = ${pineNum(row.buy_near)}
buyFar   = ${pineNum(row.buy_far)}
sellNear = ${pineNum(row.sell_near)}
sellFar  = ${pineNum(row.sell_far)}

// ── Display options ──────────────────────────────────────────────
showClose = input.bool(true,  "Show reference close", group="Display")
showZones = input.bool(true,  "Show buy/sell zones",  group="Display")
showLabel = input.bool(true,  "Show price labels",    group="Display")
labelOff  = input.int(20, "Label offset (bars)", minval=0, maxval=200, group="Display", tooltip="Pushes price labels right toward the price axis.")
extend    = input.string("Both", "Line extension", options=["Right","Both","None"], group="Display")

ext = extend == "Both" ? extend.both : extend == "None" ? extend.none : extend.right

// ── Colors ───────────────────────────────────────────────────────
cUp    = color.new(#2962ff, 0)   // EM blue
cDown  = color.new(#2962ff, 0)   // EM blue
cClose = color.new(#b0b0b0, 0)   // light grey
cPivot = color.new(#b0b0b0, 0)   // light grey
cBuy   = color.new(#b0b0b0, 0)   // light grey
cSell  = color.new(#b0b0b0, 0)   // light grey

// ── Draw once per chart (on the last bar) ────────────────────────
// Helpers take a show flag and always return a typed line/label (na when
// hidden) — so call-site assignments are never bare untyped na.
f_line(bool show, float price, color col, string style) =>
    line out = na
    if show and not na(price)
        out := line.new(bar_index - 1, price, bar_index, price, xloc=xloc.bar_index, extend=ext, color=col, style=line.style_solid, width=2)
    out

f_tag(bool show, float price, string txt, color col) =>
    label out = na
    if show and showLabel and not na(price)
        out := label.new(bar_index + labelOff, price, txt + "  " + str.tostring(price, format.mintick), xloc=xloc.bar_index, style=label.style_label_left, color=color.new(col, 100), textcolor=col, size=size.small, textalign=text.align_right)
    out

// A shaded zone box spanning two prices, extending right from the last bar.
f_box(bool show, float a, float b, color col) =>
    box out = na
    if show and not na(a) and not na(b)
        out := box.new(bar_index, math.max(a, b), bar_index + 30, math.min(a, b), border_color=color.new(col, 100), bgcolor=color.new(col, 82), extend=ext == extend.none ? extend.none : extend.right)
    out

var line lUp = na
var line lDown = na
var line lClose = na
var line lPivot = na
var box bBuy = na
var box bSell = na
var label tUp = na
var label tDown = na
var label tClose = na
var label tPivot = na

if barstate.islast
    line.delete(lUp),  line.delete(lDown), line.delete(lClose), line.delete(lPivot)
    box.delete(bBuy),  box.delete(bSell)
    label.delete(tUp), label.delete(tDown),label.delete(tClose),label.delete(tPivot)

    lUp    := f_line(true,      emUp,     cUp,    line.style_solid)
    lDown  := f_line(true,      emDown,   cDown,  line.style_solid)
    lClose := f_line(showClose, emClose,  cClose, line.style_solid)
    lPivot := f_line(showZones, pivot,    cPivot, line.style_solid)
    bBuy   := f_box(showZones,  buyNear,  buyFar,  cBuy)
    bSell  := f_box(showZones,  sellNear, sellFar, cSell)

    tUp    := f_tag(true,      emUp,    "EM Up",   cUp)
    tDown  := f_tag(true,      emDown,  "EM Down", cDown)
    tClose := f_tag(showClose, emClose, "Close",   cClose)
    tPivot := f_tag(showZones, pivot,   "Pivot",   cPivot)

`;
    };
    const buildPineAll = (rows, filter) => {
      const byTicker = new Map(rows.map((r) => [String(r.label || r.ticker).toUpperCase(), r]));
      const keys = filter ? [...byTicker.keys()].filter((t) => filter.has(t)) : [...byTicker.keys()];
      const rest = keys.filter((t) => !PS_CORE.includes(t)).sort();
      const order = [...PS_CORE.filter((t) => byTicker.has(t) && (!filter || filter.has(t))), ...rest];
      if (!order.length) return '// no matching levels found';
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
      const pushes = [];
      order.forEach((t, i) => {
        const r = byTicker.get(t);
        pushes.push([
          `array.set(NAMES,${i},"${t}")`,
          `array.set(UP,${i},${pineNum(r.up)})`,
          `array.set(DN,${i},${pineNum(r.down)})`,
          `array.set(CL,${i},${pineNum(r.close)})`,
          `array.set(PV,${i},${pineNum(r.pivot)})`,
          `array.set(BN,${i},${pineNum(r.buy_near)})`,
          `array.set(BF,${i},${pineNum(r.buy_far)})`,
          `array.set(SN,${i},${pineNum(r.sell_near)})`,
          `array.set(SF,${i},${pineNum(r.sell_far)})`,
        ].join('\n    '));
      });
      const n = order.length;
      const dropdownOpts = ['Auto', ...order].map((o) => `"${o}"`).join(', ');
      return `//@version=6
// Core EM & Levels (combined) — ${order.join(', ')}
// Auto-generated ${stamp} — values frozen; regenerate after a fresh EM publish.
// "Show ticker"=Auto draws the set whose name matches the chart symbol.
indicator("Core EM & Levels", overlay=true, max_lines_count=60, max_labels_count=60)

sel       = input.string("Auto", "Show ticker", options=[${dropdownOpts}], group="Display")
showClose = input.bool(true,  "Show reference close",group="Display")
showZones = input.bool(true,  "Show buy/sell zones", group="Display")
showLabel = input.bool(true,  "Show price labels",   group="Display")
labelOff  = input.int(20, "Label offset (bars)", minval=0, maxval=200, group="Display", tooltip="Pushes price labels right toward the price axis.")
extOpt    = input.string("Both", "Line extension", options=["Right","Both","None"], group="Display")
ext = extOpt == "Both" ? extend.both : extOpt == "None" ? extend.none : extend.right

// ── Per-ticker levels packed into arrays (values hidden from Inputs) ──
var NAMES = array.new_string(${n})
var UP = array.new_float(${n})
var DN = array.new_float(${n})
var CL = array.new_float(${n})
var PV = array.new_float(${n})
var BN = array.new_float(${n})
var BF = array.new_float(${n})
var SN = array.new_float(${n})
var SF = array.new_float(${n})
if barstate.isfirst
    ${pushes.join('\n    ')}

// Resolve index: explicit dropdown, else Auto-match the chart symbol.
f_idx() =>
    int idx = -1
    sym = str.upper(syminfo.ticker)
    if sel != "Auto"
        for i = 0 to ${n - 1}
            if array.get(NAMES, i) == sel
                idx := i
    else
        // Exact match first (chart symbol == ticker name).
        for i = 0 to ${n - 1}
            if idx < 0 and array.get(NAMES, i) == sym
                idx := i
        // Fallback: prefer the LONGEST name contained in the symbol, so e.g.
        // an NVDA chart can't get hijacked by short names like "V" or "MA".
        if idx < 0
            int best = -1
            for i = 0 to ${n - 1}
                nm = array.get(NAMES, i)
                if str.contains(sym, nm) and str.length(nm) > best
                    best := str.length(nm)
                    idx := i
    idx
idx = f_idx()

emUp    = idx >= 0 ? array.get(UP, idx) : na
emDown  = idx >= 0 ? array.get(DN, idx) : na
emClose = idx >= 0 ? array.get(CL, idx) : na
pivot   = idx >= 0 ? array.get(PV, idx) : na
buyNear = idx >= 0 ? array.get(BN, idx) : na
buyFar  = idx >= 0 ? array.get(BF, idx) : na
sellNear= idx >= 0 ? array.get(SN, idx) : na
sellFar = idx >= 0 ? array.get(SF, idx) : na

// ── Colors ───────────────────────────────────────────────────────
cUp=color.new(#2962ff,0), cDown=color.new(#2962ff,0), cClose=color.new(#b0b0b0,0)
cPivot=color.new(#b0b0b0,0), cBuy=color.new(#b0b0b0,0), cSell=color.new(#b0b0b0,0)

f_line(bool show, float p, color col, string style) =>
    line out = na
    if show and not na(p)
        out := line.new(bar_index-1, p, bar_index, p, xloc=xloc.bar_index, extend=ext, color=col, style=line.style_solid, width=2)
    out
f_tag(bool show, float p, string txt, color col) =>
    label out = na
    if show and showLabel and not na(p)
        out := label.new(bar_index + labelOff, p, txt+"  "+str.tostring(p,format.mintick), xloc=xloc.bar_index, style=label.style_label_left, color=color.new(col,100), textcolor=col, size=size.small, textalign=text.align_right)
    out
f_box(bool show, float a, float b, color col) =>
    box out = na
    if show and not na(a) and not na(b)
        out := box.new(bar_index, math.max(a,b), bar_index+30, math.min(a,b), border_color=color.new(col,100), bgcolor=color.new(col,82), extend=ext == extend.none ? extend.none : extend.right)
    out

var line lUp = na
var line lDown = na
var line lClose = na
var line lPivot = na
var box bBuy = na
var box bSell = na
var label tUp = na
var label tDown = na
var label tClose = na
var label tPivot = na

if barstate.islast
    line.delete(lUp),line.delete(lDown),line.delete(lClose),line.delete(lPivot)
    box.delete(bBuy),box.delete(bSell)
    label.delete(tUp),label.delete(tDown),label.delete(tClose),label.delete(tPivot)

    lUp    := f_line(true,      emUp,     cUp,    line.style_solid)
    lDown  := f_line(true,      emDown,   cDown,  line.style_solid)
    lClose := f_line(showClose, emClose,  cClose, line.style_solid)
    lPivot := f_line(showZones, pivot,    cPivot, line.style_solid)
    bBuy   := f_box(showZones,  buyNear,  buyFar,  cBuy)
    bSell  := f_box(showZones,  sellNear, sellFar, cSell)

    tUp    := f_tag(true,      emUp,    "EM Up",   cUp)
    tDown  := f_tag(true,      emDown,  "EM Down", cDown)
    tClose := f_tag(showClose, emClose, "Close",   cClose)
    tPivot := f_tag(showZones, pivot,   "Pivot",   cPivot)

`;
    };
    register('/api/pinescript', {
      auth: 'subscriber', methods: ['GET'],
      async handler(req, res) {
        try {
          const sp = new URL(req.url || '/', 'http://localhost').searchParams;
          const raw = (sp.get('ticker') || '').trim().toUpperCase();
          const wantAll = sp.get('all') === '1' || raw === 'ALL';
          const asJson = sp.get('format') === 'json';
          const pool = await libDb.getDb();
          if (wantAll) {
            const result = await pool.query('SELECT * FROM ticker_levels ORDER BY ticker ASC');
            if (!result.rows.length) { send(res, 404, { error: 'no levels found' }); return; }
            const symbolsRaw = sp.get('symbols') || '';
            const filter = symbolsRaw.trim() ? parseWatchlist(symbolsRaw) : undefined;
            const pine = buildPineAll(result.rows, filter);
            if (asJson) { send(res, 200, { ticker: 'ALL', pine }); return; }
            send(res, 200, pine, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'inline; filename="core-em-levels.pine"', 'Cache-Control': 'no-store' });
            return;
          }
          if (!raw) { send(res, 400, { error: 'ticker required' }); return; }
          const cleaned = raw.replace(/[$]/g, '').replace(/^\//, '');
          const candidates = [PS_ALIAS[raw], PS_ALIAS[cleaned], raw, cleaned].filter(Boolean);
          const result = await pool.query('SELECT * FROM ticker_levels WHERE ticker = ANY($1) LIMIT 1', [candidates]);
          if (!result.rows.length) { send(res, 404, { error: `no levels found for ${raw}` }); return; }
          const pine = buildPine(result.rows[0]);
          if (asJson) { send(res, 200, { ticker: raw, pine }); return; }
          send(res, 200, pine, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `inline; filename="${raw}-em-levels.pine"`, 'Cache-Control': 'no-store' });
        } catch (err) { send(res, 500, { error: String(err) }); }
      },
    });
  }

  // /api/em-zones?ticker — on-demand Buy/Sell zones via the proxy engine, cached
  // into ticker_levels (NULL-aware upsert). Ported verbatim from
  // app/api/em-zones/route.ts. Subscriber.
  register('/api/em-zones', {
    auth: 'subscriber', methods: ['GET'],
    async handler(req, res, ctx) {
      const ticker = (new URL(req.url || '/', 'http://localhost').searchParams.get('ticker') || '').trim().toUpperCase();
      if (!ticker) { send(res, 400, { error: 'ticker required' }); return; }
      let zone = null;
      try {
        const r = await ctx.internalFetch(`/proxy/api/tt/em-zones?ticker=${encodeURIComponent(ticker)}`, { cache: 'no-store' });
        const json = await r.json();
        if (!r.ok || !json?.data) { send(res, 502, { error: json?.error || 'zone compute failed' }); return; }
        zone = json.data;
      } catch (err) { send(res, 502, { error: String(err?.message || err) }); return; }
      try {
        const pool = await libDb.getDb();
        const t = (zone.ticker || ticker).toUpperCase();
        await pool.query(
          `INSERT INTO ticker_levels (ticker, label, pivot, buy_near, buy_far, sell_near, sell_far)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT(ticker) DO UPDATE SET
             label     = CASE WHEN EXCLUDED.label     IS NOT NULL THEN EXCLUDED.label     ELSE ticker_levels.label     END,
             pivot     = CASE WHEN EXCLUDED.pivot     IS NOT NULL THEN EXCLUDED.pivot     ELSE ticker_levels.pivot     END,
             buy_near  = CASE WHEN EXCLUDED.buy_near  IS NOT NULL THEN EXCLUDED.buy_near  ELSE ticker_levels.buy_near  END,
             buy_far   = CASE WHEN EXCLUDED.buy_far   IS NOT NULL THEN EXCLUDED.buy_far   ELSE ticker_levels.buy_far   END,
             sell_near = CASE WHEN EXCLUDED.sell_near IS NOT NULL THEN EXCLUDED.sell_near ELSE ticker_levels.sell_near END,
             sell_far  = CASE WHEN EXCLUDED.sell_far  IS NOT NULL THEN EXCLUDED.sell_far  ELSE ticker_levels.sell_far  END,
             updated_at = CURRENT_TIMESTAMP`,
          [t, zone.label ?? t, zone.pivot ?? null, zone.buy_near ?? null, zone.buy_far ?? null, zone.sell_near ?? null, zone.sell_far ?? null]
        );
      } catch (err) { /* best-effort cache */ }
      send(res, 200, zone);
    },
  });

  // /api/flow/calls — options-flow recorder + reader. POST inserts, GET reads by
  // date. Ported verbatim from app/api/flow/calls/route.ts. Subscriber (POST via
  // token bypass).
  register('/api/flow/calls', {
    auth: 'subscriber', methods: ['GET', 'POST'],
    async handler(req, res) {
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          const calls = Array.isArray(body) ? body : [body];
          await libDb.insertFlowCalls(calls);
          send(res, 200, { ok: true, count: calls.length });
        } catch (e) { send(res, 500, { error: String(e) }); }
        return;
      }
      try {
        const sp = new URL(req.url || '/', 'http://localhost').searchParams;
        const date = sp.get('date') ?? new Date().toISOString().slice(0, 10);
        const limit = Number(sp.get('limit') ?? 500);
        const rows = await libDb.getFlowCalls(date, limit);
        send(res, 200, rows);
      } catch (e) { send(res, 500, { error: String(e) }); }
    },
  });

  // /api/db — generic table browser (information_schema validated). Ported
  // verbatim from app/api/db/route.ts. Subscriber to match middleware's /api/*
  // paywall (the /database PAGE is owner-gated separately). AUDIT: consider
  // tightening to owner since it can read any table.
  register('/api/db', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res) {
      const ORDER_COL_PRIORITY = ['id', 'created_at', 'ts', 'timestamp', 'updated_at'];
      const DATE_COL_PRIORITY = ['date', 'day', 'entry_date', 'work_date'];
      const tableExists = async (table) => {
        const row = await libDb.queryOne(
          `SELECT true AS ok FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = ?`, [table]);
        return !!row?.ok;
      };
      const getColumns = async (table) => {
        const rows = await libDb.queryAll(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ? ORDER BY ordinal_position`, [table]);
        return rows.map((r) => r.column_name);
      };
      try {
        const sp = new URL(req.url || '/', 'http://localhost').searchParams;
        const table = sp.get('table') ?? 'mvc_snapshots';
        const limit = Math.min(Number(sp.get('limit') ?? 200), 1000);
        const date = sp.get('date') ?? '';
        const countOnly = sp.get('countOnly') === 'true';
        if (!(await tableExists(table))) { send(res, 400, { error: 'Table not allowed' }); return; }
        if (table === 'trades') {
          if (countOnly) {
            const row = date
              ? await libDb.queryOne(`SELECT COUNT(*) AS c FROM trades WHERE date(timestamp) = ?`, [date])
              : await libDb.queryOne(`SELECT COUNT(*) AS c FROM trades`);
            send(res, 200, { table, count: Number(row?.c ?? 0) }); return;
          }
          const rows = date
            ? await libDb.queryAll(`SELECT * FROM trades WHERE date(timestamp) = ? ORDER BY timestamp DESC LIMIT ?`, [date, limit])
            : await libDb.getRecentTrades(limit);
          send(res, 200, { table, count: rows.length, rows }); return;
        }
        const cols = await getColumns(table);
        const orderCol = ORDER_COL_PRIORITY.find((c) => cols.includes(c));
        const dateCol = DATE_COL_PRIORITY.find((c) => cols.includes(c))
          ?? (cols.includes('created_at') ? 'created_at::date' : undefined);
        if (countOnly) {
          let row;
          if (date && dateCol) row = await libDb.queryOne(`SELECT COUNT(*) AS c FROM "${table}" WHERE ${dateCol} = ?`, [date]);
          else row = await libDb.queryOne(`SELECT COUNT(*) AS c FROM "${table}"`);
          send(res, 200, { table, count: Number(row?.c ?? 0) }); return;
        }
        const orderSql = orderCol ? ` ORDER BY "${orderCol}" DESC` : '';
        let rows;
        if (date && dateCol) rows = await libDb.queryAll(`SELECT * FROM "${table}" WHERE ${dateCol} = ?${orderSql} LIMIT ?`, [date, limit]);
        else rows = await libDb.queryAll(`SELECT * FROM "${table}"${orderSql} LIMIT ?`, [limit]);
        if (table === 'flow_calls') {
          rows = rows.filter((r) => {
            const size = typeof r === 'object' && r !== null && 'size' in r ? r.size : 0;
            return typeof size === 'number' && size >= 100;
          });
        }
        send(res, 200, { table, count: rows.length, rows });
      } catch (err) { send(res, 500, { error: 'Database error', detail: String(err) }); }
    },
  });

  // /api/debug — DB health dump (tables + row counts + latest snapshots). Ported
  // verbatim from app/api/debug/route.ts. Subscriber to match /api/* paywall.
  register('/api/debug', {
    auth: 'owner', methods: ['GET'],
    async handler(req, res) {
      try {
        const pool = await libDb.getDb();
        await pool.query('CREATE TABLE IF NOT EXISTS _debug_ping (ts BIGINT)');
        await pool.query('INSERT INTO _debug_ping (ts) VALUES ($1)', [Date.now()]);
        const tablesResult = await pool.query(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
        const tableNames = tablesResult.rows.map((r) => r.name);
        const counts = {};
        for (const t of tableNames) {
          try { const r = await pool.query(`SELECT COUNT(*) FROM "${t}"`); counts[t] = Number(r.rows[0]?.count ?? 0); }
          catch { counts[t] = -1; }
        }
        let latestBzila = null;
        try { const r = await pool.query(`SELECT id, timestamp, date, time, session FROM bzila_snapshots ORDER BY timestamp DESC LIMIT 1`); if (r.rows[0]) latestBzila = r.rows[0]; }
        catch (e) { latestBzila = { error: String(e) }; }
        let latestGreeks = null;
        try { const r = await pool.query(`SELECT id, timestamp, date, time FROM greeks_ts ORDER BY timestamp DESC LIMIT 1`); if (r.rows[0]) latestGreeks = r.rows[0]; }
        catch (e) { latestGreeks = { error: String(e) }; }
        send(res, 200, { database: 'postgresql', tables: tableNames, counts, latestBzila, latestGreeks });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // /api/es-stats — ES per-expiration stat card (raw pg, ensureTable in GET).
  // Ported verbatim from app/api/es-stats/route.ts. GET subscriber; POST recorder
  // (token bypass). ensureTable guarded by a module-level flag inside the closure.
  {
    let esStatsEnsured = false;
    register('/api/es-stats', {
      auth: 'subscriber', methods: ['GET', 'POST'],
      async handler(req, res) {
        try {
          const pool = await libDb.getDb();
          if (req.method === 'POST') {
            const body = await readJson(req);
            const { expiration } = body;
            if (!expiration) { send(res, 400, { error: 'Missing expiration' }); return; }
            await pool.query(
              `INSERT INTO es_stats (expiration, no_long, up, mid, down, no_short)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT(expiration) DO UPDATE SET
                 no_long  = CASE WHEN EXCLUDED.no_long  IS NOT NULL THEN EXCLUDED.no_long  ELSE es_stats.no_long  END,
                 up       = CASE WHEN EXCLUDED.up        IS NOT NULL THEN EXCLUDED.up       ELSE es_stats.up       END,
                 mid      = CASE WHEN EXCLUDED.mid       IS NOT NULL THEN EXCLUDED.mid      ELSE es_stats.mid      END,
                 down     = CASE WHEN EXCLUDED.down      IS NOT NULL THEN EXCLUDED.down     ELSE es_stats.down     END,
                 no_short = CASE WHEN EXCLUDED.no_short  IS NOT NULL THEN EXCLUDED.no_short ELSE es_stats.no_short END,
                 updated_at = CURRENT_TIMESTAMP`,
              [expiration, body.no_long ?? null, body.up ?? null, body.mid ?? null, body.down ?? null, body.no_short ?? null]
            );
            send(res, 200, { ok: true, expiration });
            return;
          }
          if (!esStatsEnsured) {
            await pool.query(`
              CREATE TABLE IF NOT EXISTS es_stats (
                id SERIAL PRIMARY KEY, expiration TEXT NOT NULL UNIQUE,
                no_long TEXT, up TEXT, mid TEXT, down TEXT, no_short TEXT,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
              )
            `);
            esStatsEnsured = true;
          }
          let result = await pool.query("SELECT * FROM es_stats WHERE expiration = 'WEEKLY' LIMIT 1");
          if (!result.rows.length) result = await pool.query('SELECT * FROM es_stats ORDER BY id DESC LIMIT 1');
          if (!result.rows.length) { send(res, 200, null); return; }
          send(res, 200, result.rows[0]);
        } catch (err) { send(res, 500, { error: String(err) }); }
      },
    });
  }

  // /api/snapshots — EM/Zones snapshots (em_snapshots JSONB). GET/POST/DELETE,
  // subscriber. Ported verbatim from app/api/snapshots/route.ts.
  {
    let snapsEnsured = false;
    const ensureSnaps = async (pool) => {
      if (snapsEnsured) return;
      await pool.query(`
        CREATE TABLE IF NOT EXISTS em_snapshots (
          id SERIAL PRIMARY KEY,
          view TEXT NOT NULL DEFAULT 'estimated',
          period TEXT, ts BIGINT NOT NULL, date TEXT, time TEXT,
          target_date_label TEXT, payload JSONB NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_em_snapshots_view_ts ON em_snapshots(view, ts DESC)`);
      snapsEnsured = true;
    };
    const rowToSnapshot = (r) => {
      const payload = r.payload || {};
      return {
        id: r.id, timestamp: Number(r.ts), date: r.date, time: r.time, period: r.period,
        view: r.view, targetDateLabel: r.target_date_label ?? undefined, ...payload,
      };
    };
    register('/api/snapshots', {
      auth: 'subscriber', methods: ['GET', 'POST', 'DELETE'],
      async handler(req, res) {
        try {
          const pool = await libDb.getDb();
          await ensureSnaps(pool);
          const sp = new URL(req.url || '/', 'http://localhost').searchParams;
          if (req.method === 'GET') {
            const view = (sp.get('view') || '').trim();
            const period = (sp.get('period') || '').trim();
            let r;
            if (view) r = await pool.query('SELECT * FROM em_snapshots WHERE view = $1 ORDER BY ts DESC', [view]);
            else if (period) r = await pool.query('SELECT * FROM em_snapshots WHERE period = $1 ORDER BY ts DESC', [period]);
            else r = await pool.query('SELECT * FROM em_snapshots ORDER BY ts DESC');
            send(res, 200, r.rows.map(rowToSnapshot), { 'Cache-Control': 'public, max-age=60' });
            return;
          }
          if (req.method === 'DELETE') {
            const id = Number(sp.get('id'));
            if (!Number.isFinite(id)) { send(res, 400, { error: 'Missing id' }); return; }
            await pool.query('DELETE FROM em_snapshots WHERE id = $1', [id]);
            send(res, 200, { ok: true, id });
            return;
          }
          // POST
          const body = await readJson(req);
          const view = String(body.view || 'estimated');
          const now = new Date();
          const ts = Number(body.timestamp) || now.getTime();
          const date = body.date || now.toLocaleDateString('en-US');
          const time = body.time || now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const period = body.period ?? null;
          const targetDateLabel = body.targetDateLabel ?? null;
          const rest = { ...body };
          for (const k of ['id', 'timestamp', 'date', 'time', 'period', 'view', 'targetDateLabel']) delete rest[k];
          const payload = { period, targetDateLabel, ...rest };
          const r = await pool.query(
            `INSERT INTO em_snapshots (view, period, ts, date, time, target_date_label, payload)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [view, period, ts, date, time, targetDateLabel, JSON.stringify(payload)]
          );
          send(res, 201, rowToSnapshot(r.rows[0]));
        } catch (err) { send(res, 500, { error: String(err) }); }
      },
    });
  }

  // /api/clerk-status — deprecated alias of /api/auth-status (owner). Reuses the
  // exact registered auth-status handler so behavior can never drift.
  {
    const asDef = ROUTES.get('/api/auth-status');
    if (asDef) register('/api/clerk-status', asDef);
  }

  // /api/snapshots/[id] — single snapshot read + delete. Dynamic segment via
  // registerDynamic; ctx.params.id holds the id. Ported from
  // app/api/snapshots/[id]/route.ts (getDb → raw pg, $1 placeholders).
  registerDynamic('/api/snapshots/:id', {
    auth: 'subscriber', methods: ['GET', 'DELETE'],
    async handler(req, res, ctx) {
      const id = ctx.params?.id ?? '';
      try {
        const pool = await libDb.getDb();
        if (req.method === 'DELETE') {
          const nid = parseInt(id, 10);
          const tryDelete = async (table) => {
            try { const r = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [nid]); return r.rowCount ?? 0; }
            catch { return 0; }
          };
          const deleted = (await tryDelete('em_snapshots')) || (await tryDelete('snapshots'));
          if (!deleted) { send(res, 404, { error: 'Not found' }); return; }
          send(res, 200, { id, message: 'Deleted' });
          return;
        }
        const result = await pool.query('SELECT * FROM snapshots WHERE id = $1', [parseInt(id, 10)]);
        if (!result.rows.length) { send(res, 404, { error: 'Not found' }); return; }
        const row = result.rows[0];
        send(res, 200, { ...row, expirations: row.expirations ? JSON.parse(row.expirations) : [] });
      } catch (err) { send(res, 500, { error: String(err) }); }
    },
  });

  // ───────────────────────────────────────────────────────────────────────────
  // /api/gex-map — ONE payload for the Test Lab "GEX Map" tab (the four unified
  // GEX/DEX map readouts: Tape Field, Polar Reticle, Spine, Gamma Terrain).
  //
  // ONE expiry per response — never a blend. The caller picks which one; it
  // cannot ask for "all". Every layer on these maps (the walls, the flip, the
  // bubbles riding spot) is defined on a SINGLE ladder, and summing two
  // expiries into one ladder invents walls that exist on neither, so an
  // all-expiries mode would be a chart of a book nobody holds.
  //
  // Default is 0DTE (expiry = date) because that is the ladder these maps were
  // built to read; it falls back to the nearest dated expiry that actually has
  // rows when a session has no same-day series.
  //
  // What ships:
  //   strikes[]     the union ladder, sorted — every column's `v` is aligned to
  //                 THIS array, so the client never index-matches by strike
  //   columns[]     one per time slot: { t, spot, flip, v[] } of net GEX on the
  //                 OI+Vol basis (net_gex + net_vol_gex, the same basis
  //                 /gex2 and the Squeeze board use)
  //   dexByStrike[] net DEX ladder at the session's last snapshot
  //   dexSeries[]   net DEX summed across strikes, per snapshot
  //   levels        call wall / put wall / magnet / flip / spot / net gamma /
  //                 net dex, all read off the LAST column
  //   sessions[]    which (date, expiry) pairs still have rows, newest first
  //   expiries[]    the expiries available for the CHOSEN date, with DTE
  //
  // Two deliberate shapes:
  //
  //   1. Retention on option_strike_gex_history prunes to ~2 sessions, so
  //      `sessions` is short BY DESIGN. It is a "what can still be drawn" list,
  //      not a history picker. Asking for a date that has aged out returns
  //      empty columns plus an explicit note in `notes.gex` — never a silently
  //      blank chart, which is exactly how the heatmap backfill hid a broken
  //      query for days.
  //
  //   2. greek_snapshots is queried inside its own try/catch. The DEX layers
  //      are additive to these maps; if that table is missing, renamed, or has
  //      no rows for the session, the gamma side must still draw. A failure
  //      there degrades to `dex: []` + `notes.dex`, it does not 500 the tab.
  // ───────────────────────────────────────────────────────────────────────────
  if (libDb) {
    const GEX_MAP_TTL_MS = 60_000;
    const gexMapCache = new Map(); // key → { at, payload }

    // net_dex / net_vol_dex are added by server-v2/gex-history-writer.js at
    // first write. A server that has not written since the upgrade — or a DB
    // restored from an older dump — will not have them, and SELECTing a missing
    // column is a hard 42703, not an empty result. Probe once, then fall back to
    // greek_snapshots for sessions recorded before the columns existed.
    //
    // A POSITIVE result is cached forever — columns do not disappear. A NEGATIVE
    // one is re-probed every 60s, because the columns are added by
    // gex-history-writer.js on its FIRST WRITE, which normally happens minutes
    // AFTER this process boots. Caching `false` permanently would pin the map to
    // the greek_snapshots fallback until the next restart, on the very day the
    // upgrade shipped.
    let dexColsPresent = false;
    let dexProbedAt = 0;
    const DEX_PROBE_TTL_MS = 60_000;
    const hasDexCols = async () => {
      if (dexColsPresent) return true;
      if (Date.now() - dexProbedAt < DEX_PROBE_TTL_MS) return false;
      dexProbedAt = Date.now();
      try {
        const r = await libDb.queryAll(
          `SELECT column_name FROM information_schema.columns
            WHERE table_name = 'option_strike_gex_history'
              AND column_name IN ('net_dex', 'net_vol_dex')`
        );
        dexColsPresent = r.length === 2;
      } catch {
        dexColsPresent = false;
      }
      return dexColsPresent;
    };

    // `date` / `expiry` come back as text on this table, but a pg DATE column
    // would arrive as a JS Date. Normalize both so the cache key, the SQL
    // parameter and the JSON all agree on 'YYYY-MM-DD'.
    const dstr = (v) => {
      if (v == null) return '';
      if (v instanceof Date) {
        const y = v.getUTCFullYear(), m = String(v.getUTCMonth() + 1).padStart(2, '0');
        return `${y}-${m}-${String(v.getUTCDate()).padStart(2, '0')}`;
      }
      return String(v).slice(0, 10);
    };

    register('/api/gex-map', {
      auth: 'subscriber', methods: ['GET'],
      async handler(req, res) {
        try {
          const sp = new URL(req.url || '/', 'http://localhost').searchParams;
          const symbol = libDb.normGexSymbol(sp.get('symbol'));
          // greek_snapshots stores the bare root ('SPX'); option_strike_gex_history
          // stores the '$'-prefixed form. Same underlying, two conventions.
          const bareSymbol = symbol.replace(/^\$/, '');
          // Request-scoped, deliberately NOT part of the cached payload.
          let notesExpiry = null;
          const slotMin = Math.max(1, Math.min(30, Number(sp.get('slot') ?? 5)));
          const slotMs = slotMin * 60_000;
          // Strike padding around the session's spot range. The full SPX ladder
          // is ~330 strikes and the far wings are pure noise on a map; ±window
          // points keeps the payload honest without cropping the walls.
          const windowPts = Math.max(20, Math.min(600, Number(sp.get('window') ?? 130)));

          // Every (date, expiry) pair still in the window — no 0DTE filter here,
          // or the expiry chooser would only ever be able to offer one option.
          const sessionRows = await libDb.queryAll(
            `SELECT date, expiry, COUNT(DISTINCT timestamp)::int AS snaps
               FROM option_strike_gex_history
              WHERE symbol = ?
              GROUP BY date, expiry
              ORDER BY date DESC, expiry ASC
              LIMIT 200`,
            [symbol]
          );
          const sessions = sessionRows.map((r) => ({
            date: dstr(r.date), expiry: dstr(r.expiry), snaps: Number(r.snaps ?? 0),
          }));

          const askedDate = sp.get('date');
          const dates = [...new Set(sessions.map((s) => s.date))];
          const date = askedDate && askedDate !== 'latest' ? dstr(askedDate) : (dates[0] ?? todayET());

          const dteOf = (exp) => Math.round(
            (Date.parse(`${exp}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000
          );
          const expiries = sessions
            .filter((s) => s.date === date)
            .map((s) => ({ expiry: s.expiry, snaps: s.snaps, dte: dteOf(s.expiry) }))
            .sort((a, b) => a.dte - b.dte);

          const askedExpiry = sp.get('expiry');
          const wantedExpiry = askedExpiry && askedExpiry !== 'front' ? dstr(askedExpiry) : null;
          const expiry =
            (wantedExpiry && expiries.some((e) => e.expiry === wantedExpiry) && wantedExpiry) ||
            // 0DTE if it exists, otherwise the nearest expiry forward, otherwise
            // whatever is closest — never a silent empty ladder.
            (expiries.find((e) => e.dte === 0)?.expiry) ||
            (expiries.find((e) => e.dte > 0)?.expiry) ||
            (expiries[0]?.expiry) ||
            date;
          if (wantedExpiry && wantedExpiry !== expiry) {
            notesExpiry = `expiry ${wantedExpiry} has no rows for ${date} — showing ${expiry} instead`;
          }

          const cacheKey = `${symbol}|${date}|${expiry}|${slotMin}|${windowPts}`;
          // notesExpiry describes what THIS caller asked for, so it is merged on
          // the way out rather than stored. Baking it into the cached payload
          // made the next caller — who asked for a perfectly valid expiry —
          // read "your expiry has no rows", about somebody else's request.
          const withNote = (pl) => (notesExpiry
            ? { ...pl, notes: { ...pl.notes, expiry: notesExpiry } }
            : pl);

          const cached = gexMapCache.get(cacheKey);
          if (cached && Date.now() - cached.at < GEX_MAP_TTL_MS) {
            send(res, 200, withNote(cached.payload));
            return;
          }

          const notes = {};

          // Spot range first, so the strike filter below is anchored to where
          // price actually traded rather than to a fixed band around the last
          // print. A session that trended 60 points would lose one end of its
          // own ladder otherwise.
          const spotRow = (await libDb.queryAll(
            `SELECT MIN(spot) AS lo, MAX(spot) AS hi
               FROM option_strike_gex_history
              WHERE symbol = ? AND date = ? AND expiry = ? AND spot > 0`,
            [symbol, date, expiry]
          ))[0];
          const spotLo = Number(spotRow?.lo ?? 0);
          const spotHi = Number(spotRow?.hi ?? 0);
          const kLo = spotLo > 0 ? spotLo - windowPts : 0;
          const kHi = spotHi > 0 ? spotHi + windowPts : 1e9;

          // One row per (slot, strike), taking the LAST snapshot inside each
          // slot rather than averaging: these are stock quantities, not flows,
          // and an average of two ladders is a ladder that never existed.
          //
          // DEX rides along in the SAME row when the columns exist. That is the
          // whole point of persisting it next to gamma: one writer, one clock,
          // so the DEX ladder is the ladder that was live at that exact slot
          // rather than the nearest row from a second table on its own cadence.
          const withDex = await hasDexCols();
          const dexSel = withDex
            ? ', COALESCE(net_dex, 0) AS net_dex, COALESCE(net_vol_dex, 0) AS net_vol_dex'
            : '';
          const dexAgg = withDex ? ', SUM(s.net_dex + s.net_vol_dex) AS d' : '';
          const cells = await libDb.queryAll(
            `WITH slotted AS (
               SELECT (timestamp / ?)::bigint AS slot, timestamp, strike,
                      net_gex, COALESCE(net_vol_gex, 0) AS net_vol_gex, spot${dexSel}
                 FROM option_strike_gex_history
                WHERE symbol = ? AND date = ? AND expiry = ?
                  AND strike BETWEEN ? AND ?
                  AND net_gex IS NOT NULL
             ),
             pick AS (
               SELECT DISTINCT ON (slot) slot, timestamp
                 FROM slotted ORDER BY slot, timestamp DESC
             )
             SELECT s.slot, s.timestamp AS t, s.strike,
                    SUM(s.net_gex + s.net_vol_gex) AS v,
                    SUM(s.net_vol_gex) AS vv,
                    MAX(s.spot) AS spot${dexAgg}
               FROM slotted s
               JOIN pick p ON p.slot = s.slot AND p.timestamp = s.timestamp
              GROUP BY s.slot, s.timestamp, s.strike
              ORDER BY s.slot ASC, s.strike ASC`,
            [slotMs, symbol, date, expiry, kLo, kHi]
          );

          if (!cells.length) {
            notes.gex = sessions.some((s) => s.date === date && s.expiry === expiry)
              ? `no rows for ${symbol} ${date} inside the spot window`
              : `${date} / ${expiry} has aged out of option_strike_gex_history (retention ~2 sessions) — available: ${dates.join(', ') || 'none'}`;
          }

          // Union ladder. Every column aligns to this, so the client can treat
          // a column as a plain number[] instead of a Map lookup per cell.
          const strikeSet = new Set();
          for (const c of cells) strikeSet.add(Number(c.strike));
          const strikes = [...strikeSet].sort((a, b) => a - b);
          const idxOf = new Map(strikes.map((k, i) => [k, i]));

          const bySlot = new Map();
          let dexCellCount = 0;
          for (const c of cells) {
            const slot = Number(c.slot);
            let col = bySlot.get(slot);
            if (!col) {
              col = {
                t: Number(c.t), spot: 0, vol: 0,
                v: new Array(strikes.length).fill(0),
                d: withDex ? new Array(strikes.length).fill(0) : null,
              };
              bySlot.set(slot, col);
            }
            const si = idxOf.get(Number(c.strike));
            col.v[si] = Number(c.v ?? 0);
            // Volume-only GEX, kept apart from the OI+Vol composite so the map
            // can draw the same NET VOL GEX series the home page's Vol GEX Flow
            // panel draws, rather than a differently-derived lookalike.
            col.vol += Number(c.vv ?? 0);
            if (withDex && c.d != null) {
              const dv = Number(c.d);
              col.d[si] = dv;
              // Count only NON-ZERO cells. A session written before the columns
              // existed backfills as all-zero, which is a flat book — exactly
              // the reading this route refuses to fake.
              if (dv !== 0) dexCellCount++;
            }
            const spot = Number(c.spot ?? 0);
            if (spot > 0 && !(col.spot > 0)) col.spot = spot;
          }

          // Gamma flip per column: interpolate every sign change on the ladder,
          // then take the crossing NEAREST that column's spot. Same rule the
          // heatmap route uses — kept byte-identical on purpose so the two
          // features can never disagree about where the flip was.
          const flipOf = (v, spot) => {
            const crossings = [];
            for (let i = 0; i < strikes.length - 1; i++) {
              const a = v[i], b = v[i + 1];
              if (a === 0) { crossings.push(strikes[i]); continue; }
              if (b === 0) { crossings.push(strikes[i + 1]); continue; }
              if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
                const z = strikes[i] + (strikes[i + 1] - strikes[i]) * (Math.abs(a) / (Math.abs(a) + Math.abs(b)));
                if (Number.isFinite(z)) crossings.push(Math.round(z * 10) / 10);
              }
            }
            if (!crossings.length) return null;
            if (!(spot > 0)) return crossings[0];
            return crossings.reduce((best, c) => (Math.abs(c - spot) < Math.abs(best - spot) ? c : best));
          };

          const ordered = [...bySlot.entries()].sort((a, b) => a[0] - b[0]).map(([, col]) => col);
          const columns = ordered.map((col) => ({ t: col.t, spot: col.spot, flip: flipOf(col.v, col.spot), v: col.v }));
          const volSeries = ordered.map((col) => ({ t: col.t, vol: col.vol }));

          // ── DEX ──────────────────────────────────────────────────────────
          // Preferred source is the ladder recorded in the same row as gamma.
          // greek_snapshots stays as the fallback for sessions written before
          // net_dex existed — it is a different writer on a different cadence,
          // so it can only ever supply a last-snapshot ladder and a net series,
          // never a slot-aligned strike×time surface.
          let dexByStrike = [];
          let dexSeries = [];
          let dexColumns = [];
          let dexSource = 'none';

          if (withDex && dexCellCount > 0) {
            dexSource = 'option_strike_gex_history';
            dexColumns = ordered.map((col) => ({ t: col.t, d: col.d }));
            const lastD = ordered[ordered.length - 1].d;
            dexByStrike = strikes
              .map((k, i) => ({ strike: k, dex: lastD[i] }))
              .filter((r) => r.dex !== 0);
            dexSeries = ordered.map((col) => ({
              t: col.t, dex: col.d.reduce((a, b) => a + b, 0),
            }));
          }

          if (dexSource === 'none') try {
            const series = await libDb.queryAll(
              `SELECT EXTRACT(EPOCH FROM ts) * 1000 AS t, SUM(delta_net) AS v
                 FROM greek_snapshots
                WHERE symbol = ? AND date = ? AND expiry = ? AND delta_net IS NOT NULL
                GROUP BY ts ORDER BY ts ASC`,
              [bareSymbol, date, expiry]
            );
            dexSeries = series.map((r) => ({ t: Number(r.t), dex: Number(r.v ?? 0) }));

            const ladder = await libDb.queryAll(
              `SELECT strike, SUM(delta_net) AS v
                 FROM greek_snapshots
                WHERE symbol = ? AND date = ? AND expiry = ? AND delta_net IS NOT NULL
                  AND ts = (SELECT MAX(ts) FROM greek_snapshots
                             WHERE symbol = ? AND date = ? AND expiry = ? AND delta_net IS NOT NULL)
                GROUP BY strike ORDER BY strike ASC`,
              [bareSymbol, date, expiry, bareSymbol, date, expiry]
            );
            dexByStrike = ladder
              .map((r) => ({ strike: Number(r.strike), dex: Number(r.v ?? 0) }))
              .filter((r) => r.strike >= kLo && r.strike <= kHi);

            if (dexSeries.length || dexByStrike.length) {
              dexSource = 'greek_snapshots';
              notes.dex = withDex
                ? `session predates per-strike DEX recording — falling back to greek_snapshots (last-snapshot ladder only, no strike×time surface)`
                : `net_dex column not present yet — falling back to greek_snapshots. It appears once server-v2 writes one GEX snapshot after the upgrade.`;
            } else {
              notes.dex = `no DEX for ${bareSymbol} ${date} 0DTE in either option_strike_gex_history or greek_snapshots — DEX layers will render empty`;
            }
          } catch (err) {
            // LOUD. A silently empty DEX ring is indistinguishable from a
            // genuinely flat book, which is the worst possible failure mode on
            // a positioning map.
            console.error('[gex-map] DEX fallback read failed:', req.url, err);
            notes.dex = `DEX unavailable: ${String(err && err.message ? err.message : err)}`;
          }

          // ── Levels, read off the LAST column ─────────────────────────────
          const last = columns[columns.length - 1] ?? null;
          const levels = {
            spot: last?.spot ?? 0,
            flip: last?.flip ?? null,
            callWall: null, putWall: null, magnet: null,
            netGex: 0, netDex: 0,
            asOf: last?.t ?? null,
          };
          if (last) {
            let bestCall = -Infinity, bestPut = Infinity, bestAbs = -1;
            for (let i = 0; i < strikes.length; i++) {
              const k = strikes[i], v = last.v[i];
              levels.netGex += v;
              // Walls are the extreme gamma nodes on the correct SIDE of spot.
              // Taking "max positive anywhere" would hand back a call wall
              // below spot on a put-heavy morning, which reads as support.
              if (last.spot > 0 ? k >= last.spot : true) {
                if (v > bestCall) { bestCall = v; levels.callWall = k; }
              }
              if (last.spot > 0 ? k <= last.spot : true) {
                if (v < bestPut) { bestPut = v; levels.putWall = k; }
              }
              if (Math.abs(v) > bestAbs) { bestAbs = Math.abs(v); levels.magnet = k; }
            }
            if (!(bestCall > 0)) levels.callWall = null;
            if (!(bestPut < 0)) levels.putWall = null;
          }
          levels.netDex = dexSeries.length ? dexSeries[dexSeries.length - 1].dex : 0;

          const payload = {
            symbol, date, expiry, slotMin,
            strikes, columns, volSeries, dexByStrike, dexSeries, dexColumns, dexSource,
            levels, sessions, expiries, notes,
          };
          gexMapCache.set(cacheKey, { at: Date.now(), payload });
          send(res, 200, withNote(payload));
        } catch (err) {
          console.error('[gex-map] GET failed:', req.url, err);
          send(res, 500, { error: String(err && err.message ? err.message : err) });
        }
      },
    });
  }
}

module.exports = { handleApiRoute, register, _routes: ROUTES };
