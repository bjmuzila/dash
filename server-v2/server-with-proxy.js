'use strict';
/**
 * server-v2/server-with-proxy.js
 *
 * Main entry point for the from-scratch proxy. Brings up everything in-process
 * (no child proxy process):
 *
 *   - Loads .env.local then .env.
 *   - Prepares Next.js and an http.Server.
 *   - Mounts REST snapshot endpoints under /proxy/*.
 *   - Attaches the /ws/gex WebSocket broadcaster.
 *   - Starts the Tastytrade + dxLink feed (writes into market-state).
 *   - Routes client {type:'setExpiry'} WS commands to the live proxy.
 *
 * Run standalone:   node server-v2/server-with-proxy.js
 *
 * NOTE: This is the NEW stack and is intentionally NOT referenced by
 * package.json yet. Wiring is left to the operator.
 */

const { createServer } = require('http');
// WHATWG URL is used instead of the deprecated url.parse().
const path = require('path');
const dotenv = require('dotenv');

const ROOT_DIR = path.resolve(__dirname, '..');
// .env.local is the single source of truth. Load it with override:true so its
// values win over any leftover shell environment variables (e.g. a stray
// SYMBOL=NVDA that would otherwise hijack the SPX home-page feed). The legacy
// .env is intentionally NOT loaded — it held stale tokens/PORT that conflicted.
dotenv.config({ path: path.join(ROOT_DIR, '.env.local'), override: true });

const next = require('next');
const marketState = require('./state/market-state');
const { buildSnapshot, createGexWsServer, getWsBandwidth } = require('./websocket-server');
const { TastytradeProxy, probeRest, fetchChainFull, fetchExpirations, fetchOptionMarks, fetchUnderlyingQuotes, fetchDailyHistory } = require('./proxy-tastytrade');
const { startEodGexRecorder } = require('./eod-gex-recorder');
const { startGreeksTsWriter } = require('./greeks-ts-writer');
const { startStrikeGrowthRecorder } = require('./strike-growth-recorder');
const { startGreekScannerRecorder, runSnapshot: runGreekSnapshot, ensureSchema: greekEnsureSchema, getPool: greekGetPool } = require('./greek-scanner-recorder');
const { startVolPinRecorder, runSweep: runVolPinSweep, ensureSchema: volPinEnsureSchema, getPool: volPinGetPool } = require('./vol-pin-recorder');
const { checkProxyAccess } = require('./proxy-auth');
const { initObservability, captureError } = require('./observability');

const PORT = parseInt(process.env.PORT || '3001', 10);
const DEV = process.env.NODE_ENV !== 'production';

// Maintenance mode: when ON, the Next middleware serves /maintenance to every
// non-owner request. Toggled at runtime from the owner dashboard; defaults from
// MAINTENANCE_MODE env at boot (resets to that default on restart/redeploy).
let maintenanceMode = process.env.MAINTENANCE_MODE === '1' || process.env.MAINTENANCE_MODE === 'true';

// ---------------------------------------------------------------------------
// REST snapshot router (/proxy/*)
// ---------------------------------------------------------------------------

// Security headers applied to EVERY response (Next pages + proxy routes).
// Set before any routing/writeHead so they ride along on all responses.
function applySecurityHeaders(req, res) {
  // Only assert HSTS on HTTPS (behind the TLS-terminating proxy: x-forwarded-proto).
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (proto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // CSP. 'unsafe-eval' removed — no first-party code needs eval()/new Function();
  // it only widened the XSS blast radius. 'unsafe-inline' is retained for now
  // because Next 15's inline bootstrap/hydration scripts require either a
  // per-request nonce (needs HTML-stream interception in this custom server —
  // tracked as a P1 follow-up) or 'unsafe-inline'. If a dependency breaks
  // without eval, prefer fixing/replacing that dependency over re-adding it.
  // CSP_REPORT_ONLY=1 emits the header in report-only mode for safe rollout.
  const cspHeader = process.env.CSP_REPORT_ONLY === '1'
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';
  res.setHeader(
    cspHeader,
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob: https:; " +
      "font-src 'self' data:; " +
      "connect-src 'self' https: wss:; " +
      "frame-ancestors 'self'; " +
      "base-uri 'self'; " +
      "form-action 'self'; " +
      "object-src 'none'"
  );
  // Don't advertise the stack.
  res.removeHeader('X-Powered-By');
}

// Optional comma-separated allowlist (e.g. "https://cbedge.net,https://www.cbedge.net").
// The /proxy surface is same-origin (browser → same host) and now auth-gated, so
// no CORS header is needed by default. We ONLY emit Access-Control-Allow-Origin
// when the request's Origin is explicitly allowlisted — never the "*" wildcard,
// which both leaks data cross-site and is invalid alongside cookie auth.
const CORS_ALLOWLIST = new Set(
  (process.env.PROXY_CORS_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
);

function sendJson(res, code, obj, req) {
  const body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
  const origin = req?.headers?.origin;
  if (origin && CORS_ALLOWLIST.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  res.writeHead(code, headers);
  res.end(body);
}

/**
 * Handle a /proxy/* request. Returns true if handled.
 * @returns {boolean}
 */
function handleProxyRest(req, res) {
  const { pathname } = new URL(req.url || '/', 'http://localhost');
  if (!pathname || !pathname.startsWith('/proxy/')) return false;

  const state = marketState.getState();

  switch (pathname) {
    case '/proxy/snapshot':
      sendJson(res, 200, buildSnapshot(state));
      return true;
    case '/proxy/gex':
      sendJson(res, 200, {
        symbol: state.symbol,
        spot: state.spot,
        prevClose: state.prevClose,
        prevCloseDate: state.prevCloseDate,
        expiry: state.expiry,
        expirations: state.expirations,
        gexRows: state.gexRows,
        totals: state.totals,
        callWall: state.callWall,
        putWall: state.putWall,
        gexFlip: state.gexFlip,
        totalNetGex: state.totalNetGex,
        updatedAt: state.updatedAt,
      });
      return true;
    case '/proxy/flow':
      sendJson(res, 200, state.flow || {});
      return true;
    case '/proxy/expirations':
      sendJson(res, 200, { expiry: state.expiry, expirations: state.expirations });
      return true;
    case '/proxy/status':
      sendJson(res, 200, { ...state.status, updatedAt: state.updatedAt });
      return true;
    case '/proxy/health':
      sendJson(res, 200, { ok: true, ts: Date.now() });
      return true;
    case '/proxy/self-metrics': {
      // The app's own footprint, reported from inside the container. Hetzner's
      // cloud API exposes CPU + network but NOT memory, so the owner dashboard's
      // memory box reads this instead. rss = resident set size (real RAM held).
      const mu = process.memoryUsage();
      sendJson(res, 200, {
        rss: mu.rss,
        heapUsed: mu.heapUsed,
        heapTotal: mu.heapTotal,
        external: mu.external,
        uptimeSec: Math.round(process.uptime()),
        // Live /ws/gex outbound bandwidth: bytes/min split by frame type (gex vs
        // flow vs snapshot…) + cumulative totals. null until the WS server attaches.
        wsBandwidth: getWsBandwidth(),
        ts: Date.now(),
      });
      return true;
    }
    default:
      // Async routes are handled below (return false so they fall through).
      break;
  }

  // /proxy/gex-history?expiry=YYYY-MM-DD&ages=5,15,30
  // Returns per-strike net GEX baselines as of N minutes ago, shaped for
  // useStrikeGexHistory: { mode:"point", ages:[...], baselines:{ strike:{ "5":x,... } } }.
  if (pathname === '/proxy/gex-history') {
    handleGexHistory(req, res).catch((e) => {
      sendJson(res, 500, { error: 'gex-history failed', detail: String(e?.message || e) });
    });
    return true;
  }

  // /proxy/flow-history?date=YYYY-MM-DD&limit=2000
  // Returns today's persisted flow tape as FlowOrder[] (oldest-first).
  if (pathname === '/proxy/flow-history') {
    handleFlowHistory(req, res).catch((e) => {
      sendJson(res, 500, { error: 'flow-history failed', detail: String(e?.message || e) });
    });
    return true;
  }

  sendJson(res, 404, { error: 'unknown proxy route', path: pathname });
  return true;
}

// ── /proxy/gex-history ─────────────────────────────────────────────────────
let _histPool = null;
let _histPoolDown = false;
function getHistPool() {
  if (_histPoolDown) return null;
  if (_histPool) return _histPool;
  if (!process.env.DATABASE_URL) { _histPoolDown = true; return null; }
  try {
    const { Pool } = require('pg');
    _histPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
      max: 2,
      keepAlive: true,
    });
    _histPool.on('error', (e) => {
      console.warn('[gex-history-read] pool error (will reconnect):', e.message);
      try { _histPool?.end().catch(() => {}); } catch {}
      _histPool = null;
    });
    return _histPool;
  } catch (e) {
    console.error('[gex-history-read] pg unavailable:', e.message);
    _histPoolDown = true;
    return null;
  }
}

function todayYmdET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function handleGexHistory(req, res) {
  const { searchParams } = new URL(req.url || '/', 'http://localhost');
  const expiry = searchParams.get('expiry') || '';
  const ages = (searchParams.get('ages') || '5,15,30')
    .split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);

  if (!expiry || !ages.length) {
    return sendJson(res, 200, { mode: 'point', ages, baselines: {} });
  }
  const pool = getHistPool();
  if (!pool) {
    return sendJson(res, 200, { mode: 'point', ages, baselines: {} });
  }

  const date = todayYmdET();
  const now = Date.now();
  const baselines = {};

  // For each age, pick — per strike — the row whose timestamp is closest to
  // (now − age minutes). DISTINCT ON keeps one row per strike, ordered by
  // proximity to the target time.
  for (const age of ages) {
    const target = now - age * 60_000;
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (strike) strike, net_gex
         FROM option_strike_gex_history
        WHERE date = $1 AND expiry = $2 AND timestamp <= $3
        ORDER BY strike, ABS(timestamp - $4) ASC`,
      [date, expiry, target, target]
    );
    for (const r of rows) {
      const strike = Number(r.strike);
      const v = Number(r.net_gex);
      if (!Number.isFinite(strike) || !Number.isFinite(v)) continue;
      (baselines[strike] ||= {})[String(age)] = v;
    }
  }

  sendJson(res, 200, { mode: 'point', ages, baselines });
}

// ── /proxy/flow-history ────────────────────────────────────────────────────
// Returns persisted flow prints for a date (default today ET), shaped as the
// client FlowOrder[] so the /flow page can seed before the live WS takes over.
async function handleFlowHistory(req, res) {
  const { searchParams } = new URL(req.url || '/', 'http://localhost');
  const date = searchParams.get('date') || todayYmdET();
  let limit = Number(searchParams.get('limit') || 5000);
  if (!Number.isFinite(limit) || limit <= 0) limit = 5000;
  limit = Math.min(limit, 20000);

  const pool = getHistPool();
  if (!pool) return sendJson(res, 200, { date, tape: [] });

  // Newest `limit` rows, then re-sorted oldest-first to match the live tape.
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT ts, symbol, underlying, expiration, strike, type, side, action,
              bucket, price, size, premium, is_otm
         FROM flow_prints
        WHERE date = $1
        ORDER BY ts DESC
        LIMIT $2
     ) t ORDER BY ts ASC`,
    [date, limit]
  );

  const tape = rows.map((r) => ({
    ts: Number(r.ts),
    symbol: r.symbol,
    underlying: r.underlying ?? undefined,
    expiration: r.expiration ?? undefined,
    strike: Number(r.strike),
    type: r.type,
    side: r.side,
    action: r.action,
    bucket: r.bucket,
    price: Number(r.price),
    size: Number(r.size),
    premium: Number(r.premium),
    isOtm: r.is_otm === true,
  }));

  sendJson(res, 200, { date, tape });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  // Error monitoring + crash guards first, so anything during boot is captured.
  initObservability();

  const app = next({ dev: DEV, dir: ROOT_DIR });
  const handle = app.getRequestHandler();
  await app.prepare();

  // Forward-declared so the request handler can reference the live proxy.
  let proxy = null;

  const server = createServer(async (req, res) => {
    applySecurityHeaders(req, res);
    try {
      // Idle control (POST /proxy/idle { idle: true|false }) — toggles the feed.
      const { pathname } = new URL(req.url || '/', 'http://localhost');

      // ── /proxy/* access gate ────────────────────────────────────────────────
      // middleware.ts excludes /proxy from the Next matcher, so this is the ONLY
      // place these routes get authenticated. Reads → subscriber, writes → owner,
      // a tiny allowlist → public, cron → x-internal-token. No-op unless
      // PROXY_AUTH_REQUIRED=1. Must run before any /proxy/* handling below.
      if (pathname.startsWith('/proxy/')) {
        const verdict = await checkProxyAccess(req, pathname, req.method || 'GET');
        if (!verdict.ok) {
          sendJson(res, verdict.code, { error: verdict.reason });
          return;
        }
      }
      if (pathname === '/proxy/idle' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          let idle = true;
          try { idle = !!JSON.parse(body || '{}').idle; } catch {}
          proxy?.setIdle(idle);
          sendJson(res, 200, { ok: true, idle: marketState.getState().status.idle });
        });
        return;
      }
      if (pathname === '/proxy/idle' && req.method === 'GET') {
        sendJson(res, 200, { idle: marketState.getState().status.idle });
        return;
      }
      // Maintenance mode read/toggle. The Next middleware polls the GET to decide
      // whether to serve /maintenance to non-owner requests.
      //   GET  /proxy/maintenance            → { maintenance }
      //   POST /proxy/maintenance { on: bool } → { maintenance }
      if (pathname === '/proxy/maintenance' && req.method === 'GET') {
        sendJson(res, 200, { maintenance: maintenanceMode });
        return;
      }
      if (pathname === '/proxy/maintenance' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          try { maintenanceMode = !!JSON.parse(body || '{}').on; } catch {}
          console.log(`[SERVER-V2] maintenance mode → ${maintenanceMode ? 'ON' : 'OFF'}`);
          sendJson(res, 200, { maintenance: maintenanceMode });
        });
        return;
      }
      // Manual weekly-levels publish. The auto-publisher only fires Saturday, so
      // this lets you (re)publish on demand — e.g. after editing the ticker list
      // or for the first load — without overwriting on every restart.
      //   POST /proxy/levels-publish   body: { confirm: "PUBLISH" }   // REQUIRED
      //
      // SERVER-SIDE GATE: a full-roster publish overwrites the frozen weekly
      // snapshot the customer /em page reads, so it must NOT be triggerable by a
      // bare POST (deploy hook, curl, an interrupted boot-time run, etc.). The
      // two browser confirm() pop-ups guard the UI; this token guards the wire.
      // Only the gated "Publish Now" buttons send { confirm: "PUBLISH" }.
      if (pathname === '/proxy/levels-publish' && req.method === 'POST') {
        const { publishOnce, isPublishing } = require('./levels-auto-publish');
        if (isPublishing()) { sendJson(res, 200, { started: false, running: true }); return; }
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
        req.on('end', () => {
          let confirm = '';
          try { confirm = String(JSON.parse(raw || '{}').confirm || ''); } catch {}
          if (confirm !== 'PUBLISH') {
            console.log('[levels-pub] manual publish REJECTED — missing/!= confirm token');
            sendJson(res, 400, { started: false, error: 'confirm token required' });
            return;
          }
          // Fire-and-forget: a full-roster publish takes minutes. Kick it off and
          // return immediately; the owner page polls /proxy/levels-status for the
          // result. Errors are captured into lastRun by publishOnce itself.
          publishOnce(`http://localhost:${PORT}`, 'manual').catch((e) => {
            console.log('[levels-pub] manual run error:', e && e.message);
          });
          sendJson(res, 200, { started: true, running: true });
        });
        return;
      }
      // Retry ONLY the not-found tickers from the last run (no full re-publish).
      // Recomputes just lastRun.failedEm; merges the result so names that now
      // price drop off the list. POST /proxy/levels-retry-failed
      if (pathname === '/proxy/levels-retry-failed' && req.method === 'POST') {
        const { publishOnce, isPublishing, getLastRun } = require('./levels-auto-publish');
        if (isPublishing()) { sendJson(res, 200, { started: false, running: true }); return; }
        const lr = getLastRun();
        const only = Array.isArray(lr?.failedEm)
          ? lr.failedEm.map((f) => (typeof f === 'string' ? f : f && f.ticker)).filter(Boolean)
          : [];
        if (!only.length) { sendJson(res, 200, { started: false, running: false, reason: 'nothing to retry' }); return; }
        publishOnce(`http://localhost:${PORT}`, 'retry', { only }).catch((e) => {
          console.log('[levels-pub] retry run error:', e && e.message);
        });
        sendJson(res, 200, { started: true, running: true, count: only.length });
        return;
      }
      // Last publish-run summary + whether a run is in progress (for the owner
      // page; survives a page refresh, resets on server restart).
      //   GET /proxy/levels-status
      if (pathname === '/proxy/levels-status' && req.method === 'GET') {
        const { getLastRun, isPublishing } = require('./levels-auto-publish');
        sendJson(res, 200, { lastRun: getLastRun() || null, running: isPublishing() });
        return;
      }
      // Reconnect the live TT/dxLink feed in place (stop + start). Recovers from a
      // dropped dxLink socket or expired TT auth without a Render restart.
      //   POST /proxy/reconnect
      if (pathname === '/proxy/reconnect' && req.method === 'POST') {
        if (!proxy || typeof proxy.reconnect !== 'function') {
          sendJson(res, 503, { ok: false, error: 'proxy not ready' });
          return;
        }
        proxy.reconnect()
          .then(() => sendJson(res, 200, { ok: true }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // Manually fire the EOD GEX recorder (the 3:55–4:05 ET window may have been
      // missed, e.g. server was idle/asleep). POST /proxy/eod-gex-run
      if (pathname === '/proxy/eod-gex-run' && req.method === 'POST') {
        const { collectEodGex } = require('./eod-gex-recorder');
        collectEodGex(`http://localhost:${PORT}`, { force: true })
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // ── Strike-growth tracker ────────────────────────────────────────────
      // Ranked latest snapshot: which strikes grew most vs today's open.
      //   GET /proxy/strike-growth?min=0&type=all&symbol=NVDA&limit=200
      if (pathname === '/proxy/strike-growth' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            const side = (u.searchParams.get('type') || 'all').toLowerCase(); // all|call|put
            const minAbs = Number(u.searchParams.get('min') || 0);
            const limit = Math.min(1000, Number(u.searchParams.get('limit') || 200));
            // Latest ts per (date,symbol) today; rank by |delta_abs| desc.
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
            const params = [today];
            // Qualify with sg.* — the LATERAL joins below add tables that also
            // have symbol/strike/spot, so unqualified refs are ambiguous (502).
            let sideFilter = '';
            if (side === 'call') sideFilter = 'AND sg.strike >= sg.spot';
            else if (side === 'put') sideFilter = 'AND sg.strike < sg.spot';
            let symFilter = '';
            if (symbol) { params.push(symbol); symFilter = `AND sg.symbol = $${params.length}`; }
            params.push(minAbs); const minIdx = params.length;
            params.push(limit); const limIdx = params.length;
            // chg15/30/60 = Δ in volume-only Now GEX over the trailing window.
            // For each latest strike row we find the snapshot for that same
            // (symbol,strike) whose ts is closest to (latest.ts − N min) and
            // subtract its gex_now. LATERAL keeps it per-row and indexed.
            const lookback = (mins, alias) => `
              LEFT JOIN LATERAL (
                SELECT h.gex_now FROM strike_growth h
                WHERE h.date = $1 AND h.symbol = sg.symbol AND h.strike = sg.strike
                  AND h.ts <= sg.ts - INTERVAL '${mins} minutes'
                ORDER BY h.ts DESC LIMIT 1
              ) ${alias} ON TRUE`;
            const sql = `
              WITH latest AS (
                SELECT symbol, MAX(ts) AS ts FROM strike_growth
                WHERE date = $1 GROUP BY symbol
              )
              SELECT sg.symbol, sg.strike, sg.expiry, sg.gex_now, sg.gex_open,
                     sg.delta_abs, sg.delta_pct, sg.spot, sg.ts,
                     (sg.gex_now - b15.gex_now) AS chg15,
                     (sg.gex_now - b30.gex_now) AS chg30,
                     (sg.gex_now - b60.gex_now) AS chg60
              FROM strike_growth sg
              JOIN latest l ON l.symbol = sg.symbol AND l.ts = sg.ts
              ${lookback(15, 'b15')}
              ${lookback(30, 'b30')}
              ${lookback(60, 'b60')}
              WHERE sg.date = $1 ${symFilter} ${sideFilter}
                AND ABS(sg.delta_abs) >= $${minIdx}
              ORDER BY ABS(sg.delta_abs) DESC
              LIMIT $${limIdx}`;
            const { rows } = await p.query(sql, params);
            sendJson(res, 200, { ok: true, date: today, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Intraday series for one strike (sparkline).
      //   GET /proxy/strike-growth/series?symbol=NVDA&strike=180
      if (pathname === '/proxy/strike-growth/series' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            const strike = Number(u.searchParams.get('strike') || 0);
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
            const { rows } = await p.query(
              `SELECT ts, gex_now, delta_abs FROM strike_growth
               WHERE date = $1 AND symbol = $2 AND strike = $3 ORDER BY ts ASC`,
              [today, symbol, strike]
            );
            sendJson(res, 200, { ok: true, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // All-expiry change map for the options-chain change-mode overlay.
      //   GET /proxy/strike-growth/by-expiry?symbol=NVDA
      // Returns latest snapshot per (expiry,strike) with chg15/30/60 (volume-GEX
      // Δ over the trailing window). Lets the chain color every expiry column.
      if (pathname === '/proxy/strike-growth/by-expiry' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const symbol = (u.searchParams.get('symbol') || '').toUpperCase().trim();
            if (!symbol) { sendJson(res, 400, { ok: false, error: 'symbol required' }); return; }
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
            // Latest ts per (symbol,expiry) today, then per-strike chg lookbacks.
            const lookback = (mins, alias) => `
              LEFT JOIN LATERAL (
                SELECT h.gex_now FROM strike_growth h
                WHERE h.date = $1 AND h.symbol = sg.symbol AND h.expiry = sg.expiry
                  AND h.strike = sg.strike AND h.ts <= sg.ts - INTERVAL '${mins} minutes'
                ORDER BY h.ts DESC LIMIT 1
              ) ${alias} ON TRUE`;
            const sql = `
              WITH latest AS (
                SELECT symbol, expiry, MAX(ts) AS ts FROM strike_growth
                WHERE date = $1 AND symbol = $2 GROUP BY symbol, expiry
              )
              SELECT sg.expiry, sg.strike, sg.gex_now, sg.delta_abs,
                     (sg.gex_now - b15.gex_now) AS chg15,
                     (sg.gex_now - b30.gex_now) AS chg30,
                     (sg.gex_now - b60.gex_now) AS chg60
              FROM strike_growth sg
              JOIN latest l ON l.symbol = sg.symbol AND l.expiry = sg.expiry AND l.ts = sg.ts
              ${lookback(15, 'b15')}
              ${lookback(30, 'b30')}
              ${lookback(60, 'b60')}
              WHERE sg.date = $1 AND sg.symbol = $2`;
            const { rows } = await p.query(sql, [today, symbol]);
            sendJson(res, 200, { ok: true, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Cross-ticker SCANNER: top movers by Δ over a window, stocks-only, with a
      // vs-today z-score so abnormally-large moves surface (not just big numbers).
      //   GET /proxy/strike-growth/scanner?window=15&limit=10&sort=z&minZ=0
      //   window=15|30|60  sort=z|abs  (z = anomaly rank, abs = raw size)
      if (pathname === '/proxy/strike-growth/scanner' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const win = [15, 30, 60].includes(Number(u.searchParams.get('window'))) ? Number(u.searchParams.get('window')) : 15;
            const limit = Math.min(100, Number(u.searchParams.get('limit') || 10));
            const sort = (u.searchParams.get('sort') || 'z').toLowerCase(); // z | abs
            const minZ = Number(u.searchParams.get('minZ') || 0);
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
            // Indices/ETFs excluded — stocks only.
            const EXCLUDE = ['SPX','NDX','VIX','RUT','XSP','SPY','QQQ','IWM','DIA'];
            // changes: every snapshot's Δ-vs-(window)-min-ago, per symbol/expiry/strike.
            // Then per strike: latest Δ + mean/stddev of today's Δ series → z-score.
            const orderCol = sort === 'abs' ? 'ABS(latest_chg)' : 'ABS(z_score)';
            const sql = `
              WITH changes AS (
                SELECT sg.symbol, sg.expiry, sg.strike, sg.ts,
                       (sg.gex_now - b.gex_now) AS chg
                FROM strike_growth sg
                JOIN LATERAL (
                  SELECT gex_now FROM strike_growth h
                  WHERE h.date = sg.date AND h.symbol = sg.symbol AND h.expiry = sg.expiry
                    AND h.strike = sg.strike AND h.ts <= sg.ts - INTERVAL '${win} minutes'
                  ORDER BY h.ts DESC LIMIT 1
                ) b ON TRUE
                WHERE sg.date = $1 AND sg.symbol <> ALL($2)
              ),
              stats AS (
                SELECT symbol, expiry, strike,
                       avg(chg) AS mean_chg, stddev_pop(chg) AS sd_chg,
                       count(*) AS n,
                       (array_agg(chg ORDER BY ts DESC))[1] AS latest_chg,
                       (array_agg(ts  ORDER BY ts DESC))[1] AS latest_ts
                FROM changes GROUP BY symbol, expiry, strike
              ),
              scored AS (
                SELECT s.symbol, s.expiry, s.strike, s.latest_chg, s.mean_chg, s.sd_chg, s.n,
                       CASE WHEN s.sd_chg > 0 THEN (s.latest_chg - s.mean_chg) / s.sd_chg ELSE NULL END AS z_score
                FROM stats s
                WHERE s.n >= 3 AND s.latest_chg IS NOT NULL
                  AND (CASE WHEN s.sd_chg > 0 THEN ABS((s.latest_chg - s.mean_chg)/s.sd_chg) ELSE 0 END) >= $3
              )
              SELECT * FROM scored
              ORDER BY ${orderCol} DESC NULLS LAST
              LIMIT $4`;
            const { rows } = await p.query(sql, [today, EXCLUDE, minZ, limit]);
            sendJson(res, 200, { ok: true, window: win, sort, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Watchlist read.  GET /proxy/strike-growth/watchlist
      if (pathname === '/proxy/strike-growth/watchlist' && req.method === 'GET') {
        (async () => {
          try {
            const { ensureSchema, getPool } = require('./strike-growth-recorder');
            if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = getPool();
            const { rows } = await p.query(
              `SELECT symbol, active, sort_idx FROM strike_growth_watchlist
               ORDER BY active DESC, sort_idx ASC, symbol ASC`
            );
            sendJson(res, 200, { ok: true, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Watchlist edit.  POST /proxy/strike-growth/watchlist
      //   { symbol:"NVDA", active:true }            → toggle/add
      //   { symbol:"NVDA", remove:true }            → delete row
      if (pathname === '/proxy/strike-growth/watchlist' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          (async () => {
            try {
              const { ensureSchema, getPool } = require('./strike-growth-recorder');
              if (!(await ensureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
              const p = getPool();
              const j = JSON.parse(body || '{}');
              const symbol = String(j.symbol || '').toUpperCase().trim();
              if (!symbol) { sendJson(res, 400, { ok: false, error: 'symbol required' }); return; }
              if (j.remove) {
                await p.query(`DELETE FROM strike_growth_watchlist WHERE symbol = $1`, [symbol]);
              } else {
                const active = j.active !== false;
                await p.query(
                  `INSERT INTO strike_growth_watchlist (symbol, active, sort_idx)
                   VALUES ($1, $2, 0) ON CONFLICT (symbol) DO UPDATE SET active = EXCLUDED.active`,
                  [symbol, active]
                );
              }
              sendJson(res, 200, { ok: true });
            } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
          })();
        });
        return;
      }
      // Manually fire a watchlist sweep now (ignores RTH gate).
      //   POST /proxy/strike-growth-run
      if (pathname === '/proxy/strike-growth-run' && req.method === 'POST') {
        const { runSweep } = require('./strike-growth-recorder');
        runSweep({ force: true })
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // Manually fire a greeks_ts write now (ignores RTH gate). Feeds the
      // Analytics "Net Greeks" card. POST /proxy/greeks-ts-run
      if (pathname === '/proxy/greeks-ts-run' && req.method === 'POST') {
        const { collectGreeksTs } = require('./greeks-ts-writer');
        collectGreeksTs(`http://localhost:${PORT}`, { force: true })
          .then(() => sendJson(res, 200, { ok: true }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // ── Greek Sensitivity Scanner ─────────────────────────────────────────
      // GET /proxy/greek-scanner?mode=charm|vanna|gamma|tg&window=15|30|60&limit=25
      //   mode: charm = charm exposure shifts (delta decay)
      //         vanna = vanna exposure shifts (delta↔IV sensitivity)
      //         gamma = gamma momentum / acceleration
      //         tg    = theta-gamma imbalance (|charm| × |gamma| composite)
      if (pathname === '/proxy/greek-scanner' && req.method === 'GET') {
        (async () => {
          try {
            if (!(await greekEnsureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = greekGetPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const win   = [15, 30, 60].includes(Number(u.searchParams.get('window'))) ? Number(u.searchParams.get('window')) : 15;
            const limit = Math.min(100, Number(u.searchParams.get('limit') || 25));
            const mode  = ['charm','vanna','gamma','tg'].includes(u.searchParams.get('mode')) ? u.searchParams.get('mode') : 'charm';
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

            // Pick the metric column for change-tracking.
            const metricCol = mode === 'vanna' ? 'vanna_net'
                            : mode === 'gamma' ? 'gamma_net'
                            : 'charm_net';   // charm + tg both start with charm

            const sql = `
              WITH changes AS (
                SELECT gs.symbol, gs.expiry, gs.strike, gs.ts, gs.spot,
                       gs.charm_net, gs.vanna_net, gs.gamma_net, gs.delta_net,
                       (gs.${metricCol} - b.${metricCol}) AS metric_chg
                FROM greek_snapshots gs
                JOIN LATERAL (
                  SELECT ${metricCol} FROM greek_snapshots h
                  WHERE h.date = gs.date AND h.symbol = gs.symbol AND h.strike = gs.strike
                    AND h.ts <= gs.ts - INTERVAL '${win} minutes'
                  ORDER BY h.ts DESC LIMIT 1
                ) b ON TRUE
                WHERE gs.date = $1
              ),
              stats AS (
                SELECT symbol, expiry, strike,
                       AVG(metric_chg) AS mean_chg, STDDEV_POP(metric_chg) AS sd_chg,
                       COUNT(*) AS n,
                       (ARRAY_AGG(metric_chg  ORDER BY ts DESC))[1] AS latest_chg,
                       (ARRAY_AGG(charm_net   ORDER BY ts DESC))[1] AS charm_now,
                       (ARRAY_AGG(vanna_net   ORDER BY ts DESC))[1] AS vanna_now,
                       (ARRAY_AGG(gamma_net   ORDER BY ts DESC))[1] AS gamma_now,
                       (ARRAY_AGG(delta_net   ORDER BY ts DESC))[1] AS delta_now,
                       (ARRAY_AGG(spot        ORDER BY ts DESC))[1] AS spot_now
                FROM changes
                GROUP BY symbol, expiry, strike
              ),
              scored AS (
                SELECT *,
                  CASE WHEN sd_chg > 0 THEN (latest_chg - mean_chg) / sd_chg ELSE NULL END AS z_score,
                  ABS(charm_now) * ABS(gamma_now) / GREATEST(ABS(delta_now), 1e6) AS tg_score
                FROM stats
                WHERE n >= 2 AND latest_chg IS NOT NULL
              )
              SELECT symbol, expiry, strike, latest_chg, mean_chg, sd_chg, n, z_score,
                     charm_now, vanna_now, gamma_now, delta_now, spot_now, tg_score
              FROM scored
              ORDER BY ${mode === 'tg' ? 'tg_score' : 'ABS(latest_chg)'} DESC NULLS LAST
              LIMIT $2`;

            const { rows } = await p.query(sql, [today, limit]);
            sendJson(res, 200, { ok: true, window: win, mode, rows });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Manual snapshot fire: POST /proxy/greek-scanner-run
      if (pathname === '/proxy/greek-scanner-run' && req.method === 'POST') {
        runGreekSnapshot(`http://localhost:${PORT}`, { force: true })
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }

      // ── Volatility Pinning Scanner ────────────────────────────────────────
      // GET /proxy/vol-pin-scanner?limit=25&minSnapshots=3
      //
      // Returns ranked pin candidates with:
      //   spread_trend   — is IV-RV spread contracting? (negative = shrinking)
      //   range_trend    — is price range contracting? (negative = tightening)
      //   pin_dist_pct   — |spot - pin_strike| / spot
      //   pin_score      — composite: higher = more likely to pin
      if (pathname === '/proxy/vol-pin-scanner' && req.method === 'GET') {
        (async () => {
          try {
            if (!(await volPinEnsureSchema())) { sendJson(res, 503, { ok: false, error: 'no DB' }); return; }
            const p = volPinGetPool();
            const u = new URL(req.url, `http://localhost:${PORT}`);
            const limit       = Math.min(100, Number(u.searchParams.get('limit') || 25));
            const minSnaps    = Math.max(2,   Number(u.searchParams.get('minSnapshots') || 3));
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

            // For each symbol: latest snapshot + trend of last 4 snapshots.
            const sql = `
              WITH latest AS (
                SELECT DISTINCT ON (symbol)
                  symbol, expiry, ts, spot, atm_strike, atm_iv, atm_call_iv, atm_put_iv,
                  pin_strike, pin_strike_oi, day_hi, day_lo, range_pct, rv_ann, iv_rv_spread
                FROM vol_pin_snapshots
                WHERE date = $1 AND atm_iv > 0
                ORDER BY symbol, ts DESC
              ),
              trend AS (
                SELECT symbol,
                  COUNT(*) AS n_snaps,
                  -- spread trend: slope approx = last_spread - first_spread over last 4 snaps
                  (ARRAY_AGG(iv_rv_spread ORDER BY ts DESC))[1]
                    - (ARRAY_AGG(iv_rv_spread ORDER BY ts ASC))[1] AS spread_delta,
                  (ARRAY_AGG(range_pct ORDER BY ts DESC))[1]
                    - (ARRAY_AGG(range_pct ORDER BY ts ASC))[1] AS range_delta
                FROM (
                  SELECT symbol, ts, iv_rv_spread, range_pct
                  FROM vol_pin_snapshots
                  WHERE date = $1 AND iv_rv_spread IS NOT NULL
                  ORDER BY symbol, ts DESC
                ) sub
                GROUP BY symbol
              )
              SELECT l.*,
                t.n_snaps, t.spread_delta, t.range_delta,
                CASE WHEN l.pin_strike > 0 AND l.spot > 0
                     THEN ABS(l.spot - l.pin_strike) / l.spot ELSE NULL END AS pin_dist_pct,
                -- Pin score: higher = more attractive pin candidate.
                -- Components: spread contraction (negative spread_delta good),
                --             range contraction (negative range_delta good),
                --             proximity to pin strike.
                CASE WHEN l.pin_strike > 0 AND l.spot > 0 AND l.atm_iv > 0 AND t.n_snaps >= $2 THEN
                  (CASE WHEN t.spread_delta < 0 THEN -t.spread_delta * 3 ELSE 0 END)
                  + (CASE WHEN t.range_delta < 0 THEN -t.range_delta * 100 ELSE 0 END)
                  + GREATEST(0, 0.05 - ABS(l.spot - l.pin_strike)/l.spot) * 40
                ELSE 0 END AS pin_score
              FROM latest l
              LEFT JOIN trend t ON t.symbol = l.symbol
              WHERE t.n_snaps >= $2
              ORDER BY pin_score DESC NULLS LAST
              LIMIT $3`;

            const { rows } = await p.query(sql, [today, minSnaps, limit]);
            sendJson(res, 200, { ok: true, rows, asOf: new Date().toISOString() });
          } catch (e) { sendJson(res, 502, { ok: false, error: String(e?.message || e) }); }
        })();
        return;
      }
      // Manual sweep fire: POST /proxy/vol-pin-run
      if (pathname === '/proxy/vol-pin-run' && req.method === 'POST') {
        runVolPinSweep({ force: true })
          .then((r) => sendJson(res, 200, { ok: true, result: r ?? null }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }

      // Fire a single MVC snapshot now (ignores the auto on/off switch, still
      // requires RTH + a live chain). POST /proxy/mvc-snapshot
      if (pathname === '/proxy/mvc-snapshot' && req.method === 'POST') {
        const { collectOnce } = require('./mvc-auto-snapshot');
        // ?force=1 (manual owner button) overrides the outside-RTH guard.
        const force = /[?&]force=1\b/.test(req.url || '');
        const base = `http://localhost:${PORT}`;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        (async () => {
          let r = await collectOnce(base, { manual: true, force });
          // On force, an empty chain usually means the feed isn't subscribed
          // (outside RTH). Reconnect to rebuild the chain, wait, then retry once.
          if (force && r && r.ok === false && r.error === 'empty chain'
              && proxy && typeof proxy.reconnect === 'function') {
            console.log('[mvc-snapshot] empty chain on force — reconnecting feed and retrying');
            try { await proxy.reconnect(); } catch (e) { console.log('[mvc-snapshot] reconnect failed:', e?.message || e); }
            // Give the feed time to resubscribe + the chain to populate.
            for (let i = 0; i < 8; i++) {
              await sleep(2000);
              r = await collectOnce(base, { manual: true, force });
              if (!r || r.ok !== false || r.error !== 'empty chain') break;
            }
          }
          sendJson(res, 200, r ?? { ok: false, error: 'no result' });
        })().catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // Generate the pre-market AI summary now (ignores the 8am schedule).
      // POST /proxy/premarket-summary-run
      if (pathname === '/proxy/premarket-summary-run' && req.method === 'POST') {
        const { generate } = require('./premarket-summary-generator');
        generate(`http://localhost:${PORT}`)
          .then(() => sendJson(res, 200, { ok: true }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // Generate the daily AI strategy now (ignores the 08:20 schedule).
      // POST /proxy/strategy-run
      if (pathname === '/proxy/strategy-run' && req.method === 'POST') {
        const { generate } = require('./strategy-generator');
        generate(`http://localhost:${PORT}`)
          .then(() => sendJson(res, 200, { ok: true }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
        return;
      }
      // Toggle the MVC auto-collector on/off at runtime, or read its state.
      //   GET  /proxy/mvc-auto            → { enabled }
      //   POST /proxy/mvc-auto { on: bool } → { enabled }
      if (pathname === '/proxy/mvc-auto' && req.method === 'GET') {
        const { isMvcAutoEnabled } = require('./mvc-auto-snapshot');
        sendJson(res, 200, { enabled: isMvcAutoEnabled() });
        return;
      }
      if (pathname === '/proxy/mvc-auto' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => {
          const { setMvcAutoEnabled, isMvcAutoEnabled } = require('./mvc-auto-snapshot');
          let on = true;
          try { on = !!JSON.parse(body || '{}').on; } catch {}
          setMvcAutoEnabled(on);
          sendJson(res, 200, { enabled: isMvcAutoEnabled() });
        });
        return;
      }
      // Dev probe: raw feed data for a single built symbol from the live maps
      // (same source as the GEX chart). GET /proxy/probe?symbol=...&feed=Greeks
      if (pathname === '/proxy/probe' && req.method === 'GET') {
        const url = new URL(req.url || '/', 'http://localhost');
        const symbol = url.searchParams.get('symbol') || '';
        const feed = url.searchParams.get('feed') || 'Greeks';
        const t0 = Date.now();
        if (!proxy || typeof proxy.probeSymbol !== 'function') {
          sendJson(res, 503, { error: 'proxy not ready', symbol, feed, elapsedMs: Date.now() - t0 });
          return;
        }
        const probe = await proxy.probeSymbol(symbol, feed);
        sendJson(res, 200, { ...probe, symbol, elapsedMs: Date.now() - t0 });
        return;
      }
      // REST probe for ANY ticker (the live feed only covers one SYMBOL).
      // GET /proxy/probe-rest?ticker=AAPL&expiry=2026-06-22&type=P&strike=190
      if (pathname === '/proxy/probe-rest' && req.method === 'GET') {
        const url = new URL(req.url || '/', 'http://localhost');
        const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
        const expiry = url.searchParams.get('expiry') || '';
        const type = (url.searchParams.get('type') || 'P').toUpperCase() === 'C' ? 'C' : 'P';
        const strike = Number(url.searchParams.get('strike'));
        const t0 = Date.now();
        if (!ticker || !expiry) {
          sendJson(res, 400, { error: 'ticker and expiry required', ticker, expiry, elapsedMs: Date.now() - t0 });
          return;
        }
        try {
          const probe = await probeRest({ ticker, expiry, type, strike });
          sendJson(res, 200, { ...probe, ticker, expiry, elapsedMs: Date.now() - t0 });
        } catch (e) {
          sendJson(res, 502, { error: String(e?.message || e), ticker, expiry, source: 'rest', elapsedMs: Date.now() - t0 });
        }
        return;
      }
      // Underlying watchlist quotes (broker, after-hours aware) for the toolbar
      // dropdown. GET /proxy/quotes?symbols=AAPL,SPX,/NQU26
      // Returns { items: [{ symbol, last, mark, close, prevClose }] } — mark/last
      // update in pre/post market; close = today's 4pm regular close.
      if (pathname === '/proxy/quotes' && req.method === 'GET') {
        const url = new URL(req.url || '/', 'http://localhost');
        const symbols = (url.searchParams.get('symbols') || '')
          .split(',').map((s) => s.trim()).filter(Boolean);
        try {
          const map = await fetchUnderlyingQuotes(symbols);
          const items = symbols.map((sym) => {
            const q = map.get(sym) || {};
            return { symbol: sym, last: q.last || 0, mark: q.mark || 0, close: q.close || 0, prevClose: q.prevClose || 0 };
          });
          sendJson(res, 200, { data: { items } });
        } catch (e) {
          sendJson(res, 502, { error: String(e?.message || e) });
        }
        return;
      }
      // ── Legacy nested chain adapters ─────────────────────────────────────
      // The options-chain / mult-greek / insights pages fetch /api/chains and
      // /api/expirations, which forward here as /proxy/api/tt/chains/:ticker and
      // /proxy/api/tt/expirations/:ticker. server-v2 didn't implement these
      // (only the single-symbol live feed routes), so both pages got a 404 and
      // showed no data / an empty expiry dropdown. These adapters rebuild the
      // legacy nested payload from REST for ANY ticker, after-hours included.
      {
        const expMatch = pathname.match(/^\/proxy\/api\/tt\/expirations\/(.+)$/);
        if (req.method === 'GET' && expMatch) {
          const ticker = decodeURIComponent(expMatch[1]).split('?')[0];
          try {
            const data = await fetchExpirations(ticker);
            sendJson(res, 200, { data });
          } catch (e) {
            sendJson(res, 502, { error: String(e?.message || e), ticker });
          }
          return;
        }
        // Market-data history: /proxy/api/tt/market-data/history/:symbol
        // Backs /api/dxlink/candles (the zones tab). fetchDailyHistory() returns
        // WEEKLY OHLC bars (from Yahoo) ready for the client's zone math.
        const histMatch = pathname.match(/^\/proxy\/api\/tt\/market-data\/history\/(.+)$/);
        if (req.method === 'GET' && histMatch) {
          const symbol = decodeURIComponent(histMatch[1]).split('?')[0];
          try {
            sendJson(res, 200, await fetchDailyHistory(symbol));
          } catch (e) {
            sendJson(res, 502, { error: String(e?.message || e), symbol });
          }
          return;
        }
        // On-demand zones: /proxy/api/tt/em-zones?ticker=AAPL
        // Buy/Sell zones from last week's weekly candle for ANY ticker (the
        // long-tail names the weekly publisher doesn't pre-compute). Static for
        // the week; the Next /api/em-zones route caches the result.
        if (req.method === 'GET' && pathname === '/proxy/api/tt/em-zones') {
          const url = new URL(req.url || '/', 'http://localhost');
          const ticker = (url.searchParams.get('ticker') || '').trim().toUpperCase();
          if (!ticker) { sendJson(res, 400, { error: 'ticker required' }); return; }
          try {
            const { computeZonesPayload } = require('./levels-engine');
            const data = await computeZonesPayload(`http://localhost:${PORT}`, ticker);
            sendJson(res, 200, { data });
          } catch (e) {
            sendJson(res, 502, { error: String(e?.message || e), ticker });
          }
          return;
        }
        // Option marks: /proxy/api/tt/option-marks?symbols=OCC1,OCC2
        // Backs /api/em/option-marks — the EstimatedMoves IV=0 straddle fallback.
        // Without this adapter every per-strike call 404'd (log spam) and the
        // fallback got no marks. Index OCC symbols are routed to index-option[].
        if (req.method === 'GET' && pathname === '/proxy/api/tt/option-marks') {
          const url = new URL(req.url || '/', 'http://localhost');
          const symbols = (url.searchParams.get('symbols') || '')
            .split(',').map((s) => s.trim()).filter(Boolean);
          try {
            // Serve from the live subscriber when it fully covers the request
            // (no upstream pull); fall back to REST otherwise.
            const live = proxy?.serveOptionMarksFromLive?.(symbols) || null;
            const data = live || await fetchOptionMarks(symbols);
            sendJson(res, 200, { data, source: live ? 'live' : 'rest' });
          } catch (e) {
            sendJson(res, 502, { error: String(e?.message || e) });
          }
          return;
        }
        const chainMatch = pathname.match(/^\/proxy\/api\/tt\/chains\/(.+)$/);
        if (req.method === 'GET' && chainMatch) {
          const url = new URL(req.url || '/', 'http://localhost');
          const ticker = decodeURIComponent(chainMatch[1]).split('?')[0];
          const expiration = url.searchParams.get('expiration') || '';
          try {
            // Serve from the live subscriber when it fully covers the request
            // (active SPX expiry, in-window strikes) — no upstream REST pull.
            // Returns null when not fully covered → fall back to REST unchanged.
            const live = proxy?.serveChainFromLive?.(ticker, expiration) || null;
            const data = live || await fetchChainFull(ticker, expiration);
            sendJson(res, 200, { data, context: live ? 'live' : 'rest' });
          } catch (e) {
            sendJson(res, 502, { error: String(e?.message || e), ticker });
          }
          return;
        }
      }

      if (handleProxyRest(req, res)) return;
    } catch (err) {
      captureError(err, { route: req.url, method: req.method });
      sendJson(res, 500, { error: String(err?.message || err) });
      return;
    }
    // Next's handler parses the URL itself when not provided one.
    handle(req, res);
  });

  // Attach WS broadcaster (/ws/gex).
  const { wss } = createGexWsServer(server, { log: console });

  // Start the live feed — UNLESS idle was left ON. Idle is now a true bandwidth
  // kill-switch, so a restart while idle must stay paused (no dxLink, no quotes,
  // no broadcasts) until the owner toggles it back on from the dashboard.
  proxy = new TastytradeProxy();

  // Start the feed with bounded retry. Theta (sibling container) may not be
  // ready at boot even with compose `depends_on: service_healthy` — the v3 jar
  // download + auth handshake can lag the healthcheck. Without retry, a single
  // "fetch failed" left the feed dead (spot:0 / cold first load) until a manual
  // restart. We now re-attempt with backoff until it starts, then a watchdog
  // (below) keeps it warm. Respects the idle kill-switch: if the owner left idle
  // ON, we never start — that's a deliberate pause, not a failure.
  async function startFeedWithRetry() {
    if (proxy.idle || TastytradeProxy.idlePersisted()) {
      proxy.idle = true;
      marketState.setStatus({ idle: true });
      console.log('[SERVER-V2] idle persisted ON — feed left paused (toggle off to start)');
      return;
    }
    let attempt = 0;
    // backoff: 2s, 4s, 8s … capped at 30s, retry forever (Theta will come up)
    for (;;) {
      try {
        await proxy.start();
        console.log(`[SERVER-V2] Tastytrade/dxLink feed started${attempt ? ` (after ${attempt} retr${attempt === 1 ? 'y' : 'ies'})` : ''}`);
        marketState.setError(null);
        return;
      } catch (err) {
        attempt++;
        const waitMs = Math.min(2000 * 2 ** (attempt - 1), 30000);
        console.error(`[SERVER-V2] Feed failed to start (attempt ${attempt}): ${err.message} — retrying in ${waitMs / 1000}s`);
        marketState.setError(`feed: ${err.message} (retrying)`);
        if (proxy.idle) { console.log('[SERVER-V2] idle toggled ON during retry — stopping feed start'); return; }
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
  await startFeedWithRetry();

  // Keep-warm watchdog: every 30s, if the feed is NOT idle-paused but has gone
  // unhealthy (Theta blip, dropped dxLink, no recent frames), kick it back to
  // life so the dashboard is always warm — no cold load waiting for the next
  // page visit. Idle stays sacred: when the owner pauses, we leave it paused.
  const FEED_WARM_INTERVAL_MS = 30000;
  setInterval(async () => {
    if (!proxy || proxy.idle) return;            // paused on purpose — don't touch
    let healthy = false;
    try {
      // Prefer an explicit health signal if the proxy exposes one; otherwise
      // fall back to "do we have a live spot". spot:0 == feed is cold.
      if (typeof proxy.isHealthy === 'function') healthy = !!proxy.isHealthy();
      else healthy = ((proxy.spot || marketState.getSpot?.() || 0) > 0);
    } catch { healthy = false; }
    if (healthy) return;
    console.warn('[SERVER-V2] keep-warm: feed looks cold (no live spot) — restarting feed');
    try {
      if (typeof proxy.stop === 'function') { try { await proxy.stop(); } catch {} }
      await startFeedWithRetry();
    } catch (err) {
      console.error('[SERVER-V2] keep-warm restart failed:', err.message);
    }
  }, FEED_WARM_INTERVAL_MS).unref();

  // Route client commands (e.g. expiry switch) to the live proxy.
  // Dashboard sends { type:'SET_EXPIRY', expiry }; also accept 'setExpiry'.
  wss.on('client-message', ({ parsed }) => {
    const t = parsed?.type;
    if ((t === 'SET_EXPIRY' || t === 'setExpiry') && proxy) {
      proxy.setExpiry(parsed.expiry);
    }
    if ((t === 'SET_IDLE' || t === 'setIdle') && proxy) {
      proxy.setIdle(!!parsed.idle);
    }
  });

  server.listen(PORT, () => {
    console.log(`[SERVER-V2] listening on http://localhost:${PORT}  (ws ${PORT}/ws/gex, rest /proxy/*)`);
    // In-process MVC auto-collector: writes a snapshot every 5m during RTH.
    require('./mvc-auto-snapshot').startMvcAutoSnapshot(PORT);
    // EOD GEX recorder: upserts one row per ($SPX/SPY/QQQ) at 3:55–4:05 ET.
    startEodGexRecorder(PORT);
    // Per-strike GEX growth recorder: sweeps the watchlist every 30m during RTH
    // and stores delta-vs-open per strike (feeds /strike-growth tracker page).
    startStrikeGrowthRecorder(PORT);
    // Per-strike Greek snapshots: records gamma/delta/vanna/charm per strike
    // every 5m for the Greek Sensitivity Scanner (/scanner Greeks tab).
    startGreekScannerRecorder(PORT);
    // Vol-pin snapshots: ATM IV, RV, pin strike, range per equity ticker every 5m.
    startVolPinRecorder();
    // Net greeks time-series: writes $SPX net GEX/DEX/CHEX/VEX every 5m during
    // RTH into greeks_ts (feeds the Analytics "Net Greeks" card).
    startGreeksTsWriter(PORT);
    // In-process weekly publisher for the customer /em page: computes EM + zones
    // server-side and POSTs each ticker to /api/levels (Sat ~09:00 ET, then
    // auto-retries unpriced tickers on a backoff). No startup publish by design.
    require('./levels-auto-publish').startLevelsAutoPublish(PORT);
    // In-process weekly EM Tracker evaluator: every Sat ~09:00 ET scores last
    // week's close vs the EM band (win = closed inside) and POSTs to /api/em-tracker.
    require('./em-tracker-auto-eval').startEmTrackerAutoEval(PORT);
    // Overnight ES gap tracker: DISABLED — CPU cost not worth it (5-min RTH cron).
    // Re-enable by uncommenting: require('./es-gap-tracker').startEsGapTracker(PORT);
    // In-process ICT setup recorder: every 5m during RTH detects every live ICT
    // setup (same analyzeICT the /ict page renders), records new ones, and grades
    // pending ones by follow-through → /api/ict-setups.
    require('./ict-setup-tracker').startIctSetupTracker(PORT);

    // Traders Dashboard overnight overview: at ~07:00 ET (weekdays) Claude
    // web-searches what moved markets overnight and writes td_overview.
    require('./overview-generator').startOverviewGenerator(PORT);

    // Analytics Premarket card: at ~08:00 ET (weekdays) Claude turns the global
    // overnight tape + SPX gap/fair-value into a 5-bullet read → premarket_summary.
    require('./premarket-summary-generator').startPremarketSummaryGenerator(PORT);

    // Analytics strategy-builder card: at ~08:20 ET (weekdays) Claude turns the
    // morning positioning/levels/calendar snapshot into a full daily SPX/ES
    // strategy → daily_strategy.
    require('./strategy-generator').startStrategyGenerator(PORT);
  });

  const shutdown = () => {
    console.log('[SERVER-V2] shutting down...');
    proxy?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[SERVER-V2] fatal:', err);
  try { captureError(err, { kind: 'boot-fatal' }); } catch {}
  process.exit(1);
});
