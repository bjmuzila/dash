'use strict';
/**
 * server-v2/mcp-server.js — CB Edge as a ChatGPT connector (remote MCP server).
 *
 * ── What it does ─────────────────────────────────────────────────────────────
 * Serves the Model Context Protocol at https://www.cbedge.net/mcp so a CB Edge
 * member can add CB Edge to an AI app and ask things like "where are the SPX
 * walls?" or "what's on the calendar today?":
 *
 *   ChatGPT  Settings → Developer mode on → Apps → create, URL
 *            https://www.cbedge.net/mcp, auth OAuth (Pro, or Business/Enterprise)
 *   Gemini   gemini.google.com → Settings → Connected Apps → Add a custom app,
 *            URL https://www.cbedge.net/mcp, Advanced settings left blank
 *            (personal Google account, US, 18+, Keep Activity on)
 *
 * Use the www URL. Cloudflare redirects cbedge.net → www.cbedge.net, the issuer
 * is www, and an app that starts on the bare domain ends up holding metadata
 * for one host and a client registered on the other ("unknown client_id").
 *
 * Either one signs the member in with their normal cbedge.net login — see
 * server-v2/mcp-oauth.js for that half.
 *
 * Every tool is READ-ONLY and is a thin adapter over data the dashboard already
 * serves. Nothing here computes a level of its own:
 *
 *   spx_gamma_levels    /proxy/gex (the live 0DTE board) + today's daily_em row
 *   spx_gex_by_strike   /proxy/gex, strike ladder around spot
 *   expected_move       daily_em rows (READ only — see note below)
 *   weekly_levels       /api/levels?ticker=
 *   economic_calendar   /api/calendar
 *   earnings_today      /api/earnings-today
 *
 * Reads go through ctx.internalFetch (loopback + x-internal-token), the same
 * hop every ported api-router route uses, so the numbers are byte-for-byte the
 * ones on the board.
 *
 * expected_move deliberately does NOT call /api/daily-em: that route RECORDS
 * the session's band on its first read, and a band recorded by a chat at 2pm
 * is priced off a half-decayed straddle (see the caveat in daily-em.js). The
 * board's morning read stays the one that defines the day; this only reads.
 *
 * ── Transport ────────────────────────────────────────────────────────────────
 * Streamable HTTP, stateless: every JSON-RPC request is a POST answered with a
 * single application/json body. No SSE stream (GET → 405, which the spec
 * allows) and no Mcp-Session-Id. No SDK dependency — the surface is six
 * methods, hand-rolled below, and adding a package means a new Docker layer.
 *
 * ── Auth ─────────────────────────────────────────────────────────────────────
 * Every /mcp request needs `Authorization: Bearer cbe_mcp_at_…`. Missing or bad
 * → 401 with the WWW-Authenticate challenge that starts ChatGPT's OAuth flow.
 * Each tools/call then re-checks the member's entitlement (owner / subscribed /
 * comped, 60s cache), so a cancelled membership stops answering within a minute.
 *
 * ── Kill switch ──────────────────────────────────────────────────────────────
 * MCP_CONNECTOR=0 in .env.local → none of these routes are registered and every
 * path here falls through to Next (404), exactly as before this file existed.
 * Mounted from api-router.js, so it also needs API_ROUTER=1 (already on in prod).
 *
 * Educational market analytics, not investment advice — the server
 * `instructions` say so to the model, the same line the site carries.
 */

const oauth = require('./mcp-oauth');

let libDb = null;
try { libDb = require('./_lib-db.cjs'); }
catch (e) { console.warn('[mcp] _lib-db.cjs not loaded — expected_move unavailable:', e.message); }

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'cbedge', title: 'CB Edge', version: '1.0.0' };

const INSTRUCTIONS = [
  'CB Edge is an options-analytics platform focused on SPX 0DTE dealer gamma exposure (GEX).',
  'Use spx_gamma_levels first for any question about SPX levels, walls, the gamma flip or the gamma regime;',
  'spx_gex_by_strike for the strike-by-strike ladder; expected_move and weekly_levels for EM bands and weekly zones;',
  'economic_calendar and earnings_today for scheduled events.',
  'All times are US/Eastern. GEX values are dealer gamma exposure as shown on the CB Edge board (calls +, puts −).',
  'Data is for educational market analysis only and is not investment advice; say so if the user asks what to trade.',
].join(' ');

const UPSTREAM_TIMEOUT_MS = 15_000;
const TOOL_CALLS_PER_MIN = 60;

// ── Helpers ─────────────────────────────────────────────────────────────────

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const round = (v, dp = 2) => { const x = num(v); if (x == null) return null; const f = 10 ** dp; return Math.round(x * f) / f; };

function etDate(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).filter((x) => x.type !== 'literal')
    .reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}`;
}

function etStamp(ms) {
  const n = num(ms);
  if (!n || n <= 0) return null;
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(n));
  return `${s} ET`;
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function cleanTicker(raw, fallback) {
  const t = String(raw ?? fallback ?? '').trim().toUpperCase().replace(/^\$/, '');
  return /^[A-Z0-9./^-]{1,12}$/.test(t) ? t : null;
}

class ToolError extends Error {}

async function fetchJson(ctx, path) {
  let r;
  try {
    r = await ctx.internalFetch(path, { cache: 'no-store', signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (e) {
    throw new ToolError(`CB Edge data service did not answer (${e?.name === 'TimeoutError' ? 'timeout' : e?.message || e}).`);
  }
  if (!r.ok) throw new ToolError(`CB Edge data service returned HTTP ${r.status} for ${path.split('?')[0]}.`);
  try { return await r.json(); }
  catch { throw new ToolError(`CB Edge data service sent an unreadable response for ${path.split('?')[0]}.`); }
}

// Small TTL cache for upstreams that cost a third-party request (Yahoo,
// ForexFactory) so a chatty conversation cannot run up their rate limits.
const _cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  _cache.set(key, { at: Date.now(), value });
  if (_cache.size > 200) for (const [k, v] of _cache) if (Date.now() - v.at >= ttlMs) _cache.delete(k);
  return value;
}

// ── Data readers ────────────────────────────────────────────────────────────

const oiNet = (r) => num(r.netGEX) ?? 0;
const volNet = (r) => num(r.netVolGEX) ?? 0;
const oiVolNet = (r) => oiNet(r) + volNet(r); // same as gex-calculator.js oiVolNet()

async function readBoard(ctx) {
  const g = await fetchJson(ctx, '/proxy/gex');
  const rows = Array.isArray(g.gexRows) ? g.gexRows.filter((r) => num(r?.strike) != null) : [];
  return { g, rows, spot: num(g.spot) };
}

/**
 * The frozen daily expected-move row (written by daily-em.js), never computed
 * here. Falls back to the most recent earlier session so a 6am question still
 * gets yesterday's band, labelled as such.
 */
async function readDailyEm(ticker, date) {
  if (!libDb) return null;
  try {
    const r = await libDb.pgQuery(
      `SELECT * FROM daily_em WHERE ticker = $1 AND session_date <= $2
        ORDER BY session_date DESC LIMIT 1`,
      [ticker, date],
    );
    const row = r.rows?.[0];
    if (!row) return null;
    return {
      sessionDate: row.session_date,
      referenceClose: round(row.ref_close),
      expectedMove: round(row.em),
      upper: round(row.up),
      lower: round(row.down),
      expiry: row.expiry ?? null,
      method: row.method ?? null,
      recordedAt: etStamp(row.recorded_at),
    };
  } catch (e) {
    // No table yet (daily-em never ran on this box) reads as "not recorded".
    if (!/does not exist/i.test(e?.message || '')) console.warn('[mcp] daily_em read failed:', e.message);
    return null;
  }
}

// ── Tools ───────────────────────────────────────────────────────────────────

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const SECURITY = [{ type: 'oauth2', scopes: [oauth.SCOPE] }];

const TOOLS = [
  {
    name: 'spx_gamma_levels',
    title: 'SPX gamma levels (live)',
    description:
      'Live SPX 0DTE dealer gamma levels from the CB Edge board: spot, call wall, put wall, gamma flip, '
      + 'net GEX, gamma regime, the biggest positive/negative GEX strikes near spot, and today\'s daily '
      + 'expected-move band. Use this for any question about SPX levels, walls, the flip, or whether '
      + 'dealers are long or short gamma.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(ctx) {
      const { g, rows, spot } = await readBoard(ctx);
      const em = await readDailyEm('SPX', etDate());
      if (!rows.length || !(spot > 0)) {
        return {
          available: false,
          note: 'The live SPX board has not published yet (feed warming up, or the market is closed and the board has not loaded).',
          spot: round(spot),
          dailyExpectedMove: em,
        };
      }
      const netOiVol = num(g.totalNetGex) ?? rows.reduce((s, r) => s + oiVolNet(r), 0);
      const netOi = rows.reduce((s, r) => s + oiNet(r), 0);
      const flip = num(g.gexFlip);
      const callWall = num(g.callWall);
      const putWall = num(g.putWall);
      const regime = flip != null ? (spot >= flip ? 'positive' : 'negative') : (netOiVol >= 0 ? 'positive' : 'negative');
      const near = rows.filter((r) => Math.abs(num(r.strike) - spot) <= spot * 0.03);
      const pick = (sign) => near
        .filter((r) => Math.sign(oiVolNet(r)) === sign)
        .sort((a, b) => Math.abs(oiVolNet(b)) - Math.abs(oiVolNet(a)))
        .slice(0, 5)
        .map((r) => ({ strike: num(r.strike), netGexMillions: round(oiVolNet(r) / 1e6, 1) }));
      const prev = num(g.prevClose);
      return {
        available: true,
        symbol: g.symbol || 'SPX',
        expiry: g.expiry ?? null,
        spot: round(spot),
        prevClose: round(prev),
        change: prev ? round(spot - prev) : null,
        changePct: prev ? round(((spot - prev) / prev) * 100) : null,
        callWall,
        putWall,
        gammaFlip: round(flip),
        distanceFromSpot: {
          callWall: callWall != null ? round(callWall - spot) : null,
          putWall: putWall != null ? round(putWall - spot) : null,
          gammaFlip: flip != null ? round(flip - spot) : null,
        },
        gammaRegime: regime,
        regimeNote: regime === 'positive'
          ? 'Positive gamma: dealer hedging tends to dampen moves (more mean-reverting, pinning toward big strikes).'
          : 'Negative gamma: dealer hedging tends to amplify moves (wider ranges, faster trends).',
        netGexBillions: { openInterestPlusVolume: round(netOiVol / 1e9, 3), openInterestOnly: round(netOi / 1e9, 3) },
        largestPositiveStrikes: pick(1),
        largestNegativeStrikes: pick(-1),
        dailyExpectedMove: em,
        updatedAt: etStamp(g.updatedAt),
        dataAgeSeconds: num(g.updatedAt) ? Math.max(0, Math.round((Date.now() - num(g.updatedAt)) / 1000)) : null,
      };
    },
  },
  {
    name: 'spx_gex_by_strike',
    title: 'SPX GEX by strike',
    description:
      'The live SPX 0DTE gamma-exposure ladder strike by strike around spot, with call/put open interest '
      + 'and volume. Use for "what does GEX look like between 6800 and 6900" or "how big is the 6850 strike".',
    inputSchema: {
      type: 'object',
      properties: {
        range_points: { type: 'number', minimum: 5, maximum: 400, default: 50, description: 'Strikes within ± this many SPX points of spot.' },
        basis: {
          type: 'string', enum: ['oi_volume', 'open_interest', 'volume'], default: 'oi_volume',
          description: 'Which GEX to rank by: open interest + today\'s volume (the board default), open interest only, or volume only.',
        },
      },
      additionalProperties: false,
    },
    async run(ctx, args) {
      const range = Math.min(400, Math.max(5, num(args.range_points) ?? 50));
      const basis = ['oi_volume', 'open_interest', 'volume'].includes(args.basis) ? args.basis : 'oi_volume';
      const pickNet = basis === 'open_interest' ? oiNet : basis === 'volume' ? volNet : oiVolNet;
      const { g, rows, spot } = await readBoard(ctx);
      if (!rows.length || !(spot > 0)) {
        return { available: false, note: 'The live SPX board has not published yet.' };
      }
      const callWall = num(g.callWall);
      const putWall = num(g.putWall);
      const flip = num(g.gexFlip);
      const ladder = rows
        .filter((r) => Math.abs(num(r.strike) - spot) <= range)
        .slice(0, 160)
        .map((r) => {
          const k = num(r.strike);
          const tags = [];
          if (k === callWall) tags.push('call_wall');
          if (k === putWall) tags.push('put_wall');
          return {
            strike: k,
            netGexMillions: round(pickNet(r) / 1e6, 2),
            callOI: num(r.callOI),
            putOI: num(r.putOI),
            callVolume: num(r.callVolume),
            putVolume: num(r.putVolume),
            ...(tags.length ? { tags } : {}),
          };
        });
      return {
        available: true,
        symbol: g.symbol || 'SPX',
        expiry: g.expiry ?? null,
        spot: round(spot),
        basis,
        rangePoints: range,
        callWall,
        putWall,
        gammaFlip: round(flip),
        strikes: ladder,
        updatedAt: etStamp(g.updatedAt),
      };
    },
  },
  {
    name: 'expected_move',
    title: 'Daily expected move',
    description:
      'The CB Edge daily expected-move band for a ticker: previous close ± the front-expiry ATM straddle, '
      + 'recorded once each morning and frozen for the session. Defaults to SPX.',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', default: 'SPX', description: 'Ticker symbol, e.g. SPX, SPY, QQQ.' },
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Session date (YYYY-MM-DD, ET). Defaults to today.' },
      },
      additionalProperties: false,
    },
    async run(ctx, args) {
      const ticker = cleanTicker(args.ticker, 'SPX');
      if (!ticker) throw new ToolError('That ticker does not look valid.');
      const today = etDate();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(args.date || '')) ? args.date : today;
      const band = await readDailyEm(ticker, date);
      if (!band) {
        return { ticker, date, available: false, note: `No daily expected move has been recorded for ${ticker} on or before ${date}.` };
      }
      return {
        ticker,
        requestedDate: date,
        available: true,
        isRequestedSession: band.sessionDate === date,
        ...band,
        note: band.sessionDate === date
          ? 'Previous close ± the front-expiry ATM straddle, frozen at the first read of the session.'
          : `Nothing recorded for ${date} yet; this is the most recent earlier session (${band.sessionDate}).`,
      };
    },
  },
  {
    name: 'weekly_levels',
    title: 'Weekly levels',
    description:
      'CB Edge weekly levels for a ticker: the weekly expected-move band (close ± EM for the week\'s '
      + 'expiration) plus the weekly zones (buy zone near/far, sell zone near/far, pivot) from weekly candles. '
      + 'Covers SPX, the index ETFs, ES/NQ futures and the CB Edge watchlist.',
    inputSchema: {
      type: 'object',
      properties: { ticker: { type: 'string', description: 'Ticker symbol, e.g. SPX, QQQ, NVDA, ES.' } },
      required: ['ticker'],
      additionalProperties: false,
    },
    async run(ctx, args) {
      const ticker = cleanTicker(args.ticker);
      if (!ticker) throw new ToolError('Give a ticker symbol, e.g. SPX or NVDA.');
      const row = await fetchJson(ctx, `/api/levels?ticker=${encodeURIComponent(ticker)}`);
      if (!row || typeof row !== 'object' || row.error) {
        return { ticker, available: false, note: `CB Edge has no weekly levels for ${ticker}.` };
      }
      return {
        ticker: row.ticker || ticker,
        available: true,
        label: row.label ?? null,
        weekExpiration: row.exp_label ?? null,
        close: num(row.close),
        expectedMove: num(row.em),
        upper: num(row.up),
        lower: num(row.down),
        buyZoneNear: num(row.buy_near),
        buyZoneFar: num(row.buy_far),
        sellZoneNear: num(row.sell_near),
        sellZoneFar: num(row.sell_far),
        pivot: num(row.pivot),
        updatedAt: row.updated_at ?? null,
        expectedMoveUpdatedAt: row.em_updated_at ?? null,
      };
    },
  },
  {
    name: 'economic_calendar',
    title: 'Economic calendar',
    description:
      'Scheduled economic releases (CPI, FOMC, jobs, etc.) from the CB Edge calendar, in US/Eastern time, '
      + 'with forecast / previous / actual. Use for "what\'s on the calendar today/this week".',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 7, default: 1, description: 'How many days ahead, starting today (1 = today only).' },
        impact: {
          type: 'string', enum: ['high', 'medium', 'all'], default: 'high',
          description: 'high = high-impact only; medium = medium and high; all = everything incl. low impact and presidential schedule.',
        },
        country: { type: 'string', default: 'USD', description: 'Currency/country code (USD, EUR, GBP, JPY…) or "all".' },
      },
      additionalProperties: false,
    },
    async run(ctx, args) {
      const days = Math.min(7, Math.max(1, Math.round(num(args.days) ?? 1)));
      const impact = ['high', 'medium', 'all'].includes(args.impact) ? args.impact : 'high';
      const country = String(args.country || 'USD').trim().toUpperCase();
      const data = await cached('calendar', 5 * 60_000, () => fetchJson(ctx, '/api/calendar'));
      const from = etDate();
      const to = addDays(from, days - 1);
      const allowImpact = impact === 'all' ? null
        : impact === 'medium' ? new Set(['high', 'medium']) : new Set(['high']);
      const events = (Array.isArray(data?.events) ? data.events : [])
        .filter((e) => e && e.date >= from && e.date <= to)
        .filter((e) => {
          const imp = String(e.impact || '').toLowerCase();
          if (imp === 'president') return impact === 'all';
          return !allowImpact || allowImpact.has(imp);
        })
        .filter((e) => {
          if (country === 'ALL') return true;
          const c = String(e.country || '').toUpperCase();
          return c === country || (country === 'USD' && c === 'US') || (country === 'US' && c === 'USD');
        })
        .slice(0, 150)
        .map((e) => ({
          date: e.date,
          time: e.time_formatted || e.time || null,
          title: e.title,
          country: e.country,
          impact: e.impact,
          forecast: e.forecast || null,
          previous: e.previous || null,
          actual: e.actual || null,
        }));
      return {
        from, to, impact, country,
        count: events.length,
        events,
        ...(data?.warning ? { warning: data.warning } : {}),
      };
    },
  },
  {
    name: 'earnings_today',
    title: "Today's earnings",
    description: "US companies reporting earnings today, largest market cap first, with before-open / after-close timing.",
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 25, description: 'How many companies to return.' } },
      additionalProperties: false,
    },
    async run(ctx, args) {
      const limit = Math.min(100, Math.max(1, Math.round(num(args.limit) ?? 25)));
      const data = await cached(`earnings:${etDate()}`, 15 * 60_000, () => fetchJson(ctx, '/api/earnings-today'));
      const timing = { BMO: 'before open', AMC: 'after close', TAS: 'during session', TNS: 'time not supplied' };
      const rows = (Array.isArray(data?.earnings) ? data.earnings : []).slice(0, limit).map((r) => ({
        symbol: r.symbol,
        company: r.company,
        timing: timing[String(r.callTime || '').toUpperCase()] || (r.callTime || null),
        marketCapBillions: num(r.marketCap) ? round(num(r.marketCap) / 1e9, 1) : null,
      }));
      return {
        date: data?.date || etDate(),
        totalReporting: num(data?.count) ?? rows.length,
        earnings: rows,
        ...(data?.error ? { warning: `Earnings feed problem: ${data.error}` } : {}),
      };
    },
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

function toolListing() {
  return TOOLS.map(({ name, title, description, inputSchema }) => ({
    name,
    title,
    description,
    inputSchema,
    annotations: { title, ...READ_ONLY },
    securitySchemes: SECURITY,
    _meta: {
      securitySchemes: SECURITY,
      'openai/toolInvocation/invoking': 'Reading CB Edge…',
      'openai/toolInvocation/invoked': 'Read CB Edge',
    },
  }));
}

// ── Per-user rate limit ─────────────────────────────────────────────────────

const _calls = new Map(); // userId -> [timestamps]
function rateOk(userId) {
  const now = Date.now();
  const hits = (_calls.get(userId) || []).filter((t) => now - t < 60_000);
  if (hits.length >= TOOL_CALLS_PER_MIN) { _calls.set(userId, hits); return false; }
  hits.push(now);
  _calls.set(userId, hits);
  return true;
}

// ── JSON-RPC ────────────────────────────────────────────────────────────────

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const textResult = (obj, isError = false) => ({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
  ...(typeof obj === 'object' && obj && !isError ? { structuredContent: obj } : {}),
  isError,
});

async function callTool(params, ctx, who) {
  const name = params?.name;
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return { error: [-32602, `Unknown tool: ${name}`] };
  const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};

  const log = (outcome, ms) => oauth.recordToolCall({
    userId: who.userId, clientId: who.clientId, familyId: who.familyId, tool: name, outcome, ms,
  });
  const ent = await oauth.checkEntitlement(who.userId);
  if (!ent.ok) {
    if (!ent.transient) log('no_membership', 0);
    return {
      result: textResult(ent.transient
        ? 'CB Edge could not verify your membership just now. Try again in a minute.'
        : 'Your CB Edge membership is not active, so CB Edge data is unavailable. Renew at cbedge.net/pricing, then reconnect.', true),
    };
  }
  if (!rateOk(who.userId)) {
    log('rate_limited', 0);
    return { result: textResult('Too many CB Edge requests in the last minute. Wait a moment and try again.', true) };
  }

  const t0 = Date.now();
  try {
    const out = await tool.run(ctx, args);
    console.log(`[mcp] ${name} user=${who.userId} ${Date.now() - t0}ms`);
    log('ok', Date.now() - t0);
    return { result: textResult(out) };
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : 'CB Edge hit an internal error reading that data.';
    console.warn(`[mcp] ${name} user=${who.userId} failed after ${Date.now() - t0}ms:`, e?.message || e);
    log('error', Date.now() - t0);
    return { result: textResult(msg, true) };
  }
}

async function dispatch(msg, ctx, who) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    // A response object from the client (no method) is acknowledged silently.
    if (msg && typeof msg === 'object' && msg.jsonrpc === '2.0' && !('method' in msg)) return null;
    return rpcError(msg?.id, -32600, 'Invalid Request');
  }
  const isNotification = !('id' in msg);
  if (isNotification) return null; // notifications/initialized, notifications/cancelled, …
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: toolListing() });
    case 'tools/call': {
      const out = await callTool(params, ctx, who);
      return out.error ? rpcError(id, out.error[0], out.error[1]) : rpcResult(id, out.result);
    }
    case 'resources/list':
      return rpcResult(id, { resources: [] });
    case 'resources/templates/list':
      return rpcResult(id, { resourceTemplates: [] });
    case 'prompts/list':
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

function readBody(req, maxBytes = 1_000_000) {
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

function writeJson(res, status, body, extra = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(body == null ? '' : JSON.stringify(body));
}

const MAX_BATCH = 10;

async function handleMcp(req, res, ctx) {
  oauth.setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  const origin = oauth.publicOrigin(req);

  // Bearer first, for every method — the 401 is what tells ChatGPT to start OAuth.
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(req.headers.authorization || ''));
  if (!m) {
    return writeJson(res, 401, { error: 'unauthorized', error_description: 'Sign in with CB Edge to use this connector.' },
      { 'WWW-Authenticate': oauth.challengeHeader(origin) });
  }
  // A caller that keeps presenting bad tokens is cut off before the DB is asked.
  const ipKey = oauth.clientKey(req);
  if (oauth.authFailures.blocked(ipKey)) {
    return writeJson(res, 429, { error: 'slow_down' }, { 'Retry-After': '60' });
  }
  let who;
  try { who = await oauth.validateAccessToken(m[1]); }
  catch (e) {
    console.warn('[mcp] token check failed:', e?.message || e);
    return writeJson(res, 503, { error: 'temporarily_unavailable' }, { 'Retry-After': '5' });
  }
  if (!who || (who.resource && who.resource !== oauth.resourceUrl(origin) && who.resource !== origin)) {
    oauth.authFailures.hit(ipKey);
    return writeJson(res, 401, { error: 'invalid_token', error_description: 'Token is invalid or expired.' },
      { 'WWW-Authenticate': oauth.challengeHeader(origin, 'invalid_token') });
  }

  if (req.method !== 'POST') {
    // No server-initiated SSE stream and no sessions to DELETE.
    return writeJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST, OPTIONS' });
  }

  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw);
  } catch {
    return writeJson(res, 400, rpcError(null, -32700, 'Parse error'));
  }

  if (Array.isArray(payload)) {
    // JSON-RPC batch (2025-03-26 clients). Later protocol versions dropped it,
    // but answering one costs nothing.
    if (!payload.length || payload.length > MAX_BATCH) {
      return writeJson(res, 400, rpcError(null, -32600, `Batch must hold 1–${MAX_BATCH} messages`));
    }
    const out = (await Promise.all(payload.map((msg) => dispatch(msg, ctx, who)))).filter(Boolean);
    return out.length ? writeJson(res, 200, out) : writeJson(res, 202, null);
  }
  const reply = await dispatch(payload, ctx, who);
  return reply ? writeJson(res, 200, reply) : writeJson(res, 202, null);
}

async function guardedMcp(req, res, ctx) {
  try { await handleMcp(req, res, ctx); }
  catch (e) {
    console.warn('[mcp] request failed:', e?.message || e);
    if (!res.headersSent) writeJson(res, 500, rpcError(null, -32603, 'Internal error'));
    else res.end();
  }
}

// ── Mount ───────────────────────────────────────────────────────────────────

/**
 * Called once by api-router.js with its `register`. Every connector route is
 * 'public' to the router — each handler does its own auth (cookie for
 * /oauth/authorize, bearer for /mcp, client credentials for /oauth/token). The
 * two /api/admin/mcp-connections routes are 'owner', enforced by the router.
 */
function registerRoutes(register) {
  // The owner tracker (owner.cbedge.net → AI Connections) mounts even with the
  // connector switched off, so the history and the switch's effect stay visible.
  try { require('./mcp-admin').registerAdminRoutes(register); }
  catch (e) { console.warn('[mcp] owner tracker routes not loaded:', e?.message || e); }
  if (process.env.MCP_CONNECTOR === '0') {
    console.log('[mcp] ChatGPT connector disabled (MCP_CONNECTOR=0)');
    return false;
  }
  const meta = ['GET', 'OPTIONS'];
  register('/.well-known/oauth-authorization-server', { auth: 'public', methods: meta, handler: oauth.handleAsMetadata });
  register('/.well-known/oauth-protected-resource', { auth: 'public', methods: meta, handler: oauth.handlePrMetadata });
  register('/.well-known/oauth-protected-resource/mcp', { auth: 'public', methods: meta, handler: oauth.handlePrMetadata });
  register('/oauth/register', { auth: 'public', methods: ['POST', 'OPTIONS'], handler: oauth.handleRegister });
  register('/oauth/authorize', { auth: 'public', methods: ['GET', 'POST'], handler: oauth.handleAuthorize });
  register('/oauth/token', { auth: 'public', methods: ['POST', 'OPTIONS'], handler: oauth.handleToken });
  register('/oauth/revoke', { auth: 'public', methods: ['POST', 'OPTIONS'], handler: oauth.handleRevoke });
  const mcpRoute = { auth: 'public', methods: ['GET', 'POST', 'DELETE', 'OPTIONS'], handler: guardedMcp };
  register('/mcp', mcpRoute);
  register('/mcp/', mcpRoute); // a pasted URL with a trailing slash must still get the 401 challenge
  return true;
}

module.exports = {
  registerRoutes,
  handleMcp: guardedMcp,
  TOOLS,
  /** Selftest hooks only. */
  _test: { dispatch, reset() { _calls.clear(); _cache.clear(); } },
};
