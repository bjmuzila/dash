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

// ---------------------------------------------------------------------------
// Dispatcher — return true if handled (skip Next), false to fall through.
// ---------------------------------------------------------------------------

async function handleApiRoute(req, res, ctx) {
  let pathname;
  try { ({ pathname } = new URL(req.url || '/', 'http://localhost')); }
  catch { return false; }
  if (!pathname || !pathname.startsWith('/api/')) return false;

  const def = ROUTES.get(pathname);
  if (!def) return false; // not ported yet → let Next handle it

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

  try {
    await def.handler(req, res, ctx, verdict);
  } catch (err) {
    ctx.sendJson(res, 500, { error: String(err?.message || err) }, req);
  }
  return true;
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
}

module.exports = { handleApiRoute, register, _routes: ROUTES };
