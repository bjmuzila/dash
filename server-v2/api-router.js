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

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function enforceAuth(level, req, ctx) {
  // Internal server-to-server bypass — mirrors middleware.ts (hasInternalToken →
  // next()) and proxy-auth. Cron/internal callers carry the shared secret and
  // must reach every /api/* route without a user session, exactly as before.
  const tok = req.headers['x-internal-token'];
  if (tok && ctx.internalToken && tok === ctx.internalToken) {
    return { ok: true, who: 'internal' };
  }
  if (level === 'public') return { ok: true };
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

// /api/calendar-quote — deterministic daily trading quote (no deps).
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
function pickCalQuote() {
  const dayNum = Math.floor(Date.parse(etDateStr() + 'T00:00:00Z') / 86_400_000);
  return CAL_QUOTES[((dayNum % CAL_QUOTES.length) + CAL_QUOTES.length) % CAL_QUOTES.length];
}
register('/api/calendar-quote', {
  auth: 'subscriber', methods: ['GET', 'POST'],
  async handler(req, res) { send(res, 200, { quote: pickCalQuote() }); },
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

  const verdict = await enforceAuth(def.auth, req, ctx);
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
  auth: 'subscriber', methods: ['GET'],
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
    async handler(req, res) {
      try {
        const limit = Math.min(Number(new URL(req.url || '/', 'http://localhost').searchParams.get('limit') ?? 100), 5000);
        const rows = await libDb.getRecentPageVisits(limit);
        const visits = rows.map((r) => ({
          id: r.id, pageKey: r.page_key ?? null, pageLabel: r.page_label ?? null,
          path: r.path ?? null, userId: r.user_id ?? null, ip: r.ip ?? null, createdAt: r.created_at ?? null,
        }));
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
  register('/api/page-status', {
    auth: 'subscriber', methods: ['GET', 'POST'],
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
              await libDb.insertPageVisit({
                page_key: String(body.pageKey ?? body.page_key ?? ''),
                page_label: body.pageLabel == null ? null : String(body.pageLabel),
                path: body.path == null ? null : String(body.path),
                user_id: access.userId ?? null,
                ip: clientIp(req),
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
  register('/api/far-cb-tickers', {
    auth: 'subscriber', methods: ['GET', 'POST'],
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
        send(res, 200, { rows: await libDb.getMvcSnapshots(sp.get('date') ?? undefined, Math.min(Number(sp.get('limit') ?? 200), 1000), since) });
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
        send(res, 200, { rows });
      } catch (err) { send(res, 500, { error: String(err) }); }
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
            })).filter((row) => row.expiry && row.strike > 0 && Number.isFinite(row.net_gex));
            await libDb.insertOptionStrikeGexRows(normalized);
            send(res, 200, { ok: true, count: normalized.length });
          } catch (err) { send(res, 200, { error: String(err) }); }
          return;
        }
        try {
          const sp = new URL(req.url || '/', 'http://localhost').searchParams;
          const date = sp.get('date') ?? todayET();
          const expiry = sp.get('expiry') ?? '';
          const mode = sp.get('mode') ?? 'rolling';
          if (!expiry) { send(res, 200, { error: 'expiry is required', rows: [] }); return; }

          if (mode === 'heatmap') {
            const winParam = sp.get('minutes');
            const winMin = winParam == null ? 1440 : Math.max(0, Math.min(2880, Number(winParam)));
            const anyExpiry = sp.get('anyExpiry') === '1';
            const cacheKey = `${winMin}|${anyExpiry ? 'any' : expiry}|${anyExpiry ? '' : date}`;
            const cached = heatmapCache.get(cacheKey);
            if (cached && Date.now() - cached.at < HEATMAP_TTL_MS) { send(res, 200, cached.payload); return; }
            const slots = winMin > 0
              ? anyExpiry
                ? await libDb.getOptionStrikeGexSlotsWindowAny(Date.now() - winMin * 60 * 1000)
                : await libDb.getOptionStrikeGexSlotsWindow(Date.now() - winMin * 60 * 1000, expiry)
              : await libDb.getOptionStrikeGexSlots(date, expiry);
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
              const absVals = cells.map((c) => Math.abs(c.net)).filter((v) => v > 0);
              const max = absVals.length ? Math.max(...absVals) : 1;
              const top3 = [...absVals].sort((a, b) => b - a).slice(0, 3);
              return { slotTs, cells, max, top3, spot: spotBySlot.get(slotTs) ?? 0 };
            });
            const payload = { mode: 'heatmap', columns };
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
              libDb.getOptionStrikeNetGexAtOpen(date, expiry),
              ...ages.map((m) => asOf(date, expiry, now - m * 60 * 1000)),
            ]);
            const baselines = {};
            const put = (strike, key, v) => { (baselines[strike] ??= {})[key] = v; };
            const oiVol = (r) => r.net_gex + (Number.isFinite(r.net_vol_gex) ? r.net_vol_gex : 0);
            for (const r of openRows) put(r.strike, 'open', oiVol(r));
            ages.forEach((m, i) => { for (const r of ageRowSets[i]) put(r.strike, String(m), oiVol(r)); });
            send(res, 200, { mode: 'point', ages, baselines });
            return;
          }

          const minutes = Math.max(1, Math.min(240, Number(sp.get('minutes') ?? 30)));
          const sinceTimestamp = Date.now() - minutes * 60 * 1000;
          const rows = await libDb.getOptionStrikeRollingNetGex(date, expiry, sinceTimestamp);
          send(res, 200, { rows, minutes });
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
  // with alias resolution; POST NULL-aware upsert with the Saturday-9am-ET em
  // freeze (trusted internal token may always rewrite). Ported verbatim from
  // app/api/levels/route.ts.
  {
    let levelsEnsured = false;
    const lastSaturday9amET = (now = new Date()) => {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
      const get = (t) => parts.find((p) => p.type === t)?.value;
      const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const dow = dowMap[get('weekday') || 'Sun'];
      const hour = Number(get('hour')), minute = Number(get('minute'));
      const minsSinceSat9 = ((dow - 6) * 24 * 60) + hour * 60 + minute - 9 * 60;
      const offsetMin = minsSinceSat9 >= 0 ? minsSinceSat9 : minsSinceSat9 + 7 * 24 * 60;
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
            const weekStart = lastSaturday9amET();
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
    auth: 'subscriber', methods: ['GET'],
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
    auth: 'subscriber', methods: ['GET'],
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
}

module.exports = { handleApiRoute, register, _routes: ROUTES };
