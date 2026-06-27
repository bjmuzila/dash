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

const PORT = parseInt(process.env.PORT || '3001', 10);
const DEV = process.env.NODE_ENV !== 'production';

// Maintenance mode: when ON, the Next middleware serves /maintenance to every
// non-owner request. Toggled at runtime from the owner dashboard; defaults from
// MAINTENANCE_MODE env at boot (resets to that default on restart/redeploy).
let maintenanceMode = process.env.MAINTENANCE_MODE === '1' || process.env.MAINTENANCE_MODE === 'true';

// ---------------------------------------------------------------------------
// REST snapshot router (/proxy/*)
// ---------------------------------------------------------------------------

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
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

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  const app = next({ dev: DEV, dir: ROOT_DIR });
  const handle = app.getRequestHandler();
  await app.prepare();

  // Forward-declared so the request handler can reference the live proxy.
  let proxy = null;

  const server = createServer(async (req, res) => {
    try {
      // Idle control (POST /proxy/idle { idle: true|false }) — toggles the feed.
      const { pathname } = new URL(req.url || '/', 'http://localhost');
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
      // Fire a single MVC snapshot now (ignores the auto on/off switch, still
      // requires RTH + a live chain). POST /proxy/mvc-snapshot
      if (pathname === '/proxy/mvc-snapshot' && req.method === 'POST') {
        const { collectOnce } = require('./mvc-auto-snapshot');
        collectOnce(`http://localhost:${PORT}`, { manual: true })
          .then((r) => sendJson(res, 200, r ?? { ok: false, error: 'no result' }))
          .catch((e) => sendJson(res, 502, { ok: false, error: String(e?.message || e) }));
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
  try {
    proxy = new TastytradeProxy();
    if (TastytradeProxy.idlePersisted()) {
      proxy.idle = true;
      marketState.setStatus({ idle: true });
      console.log('[SERVER-V2] idle persisted ON — feed left paused (toggle off to start)');
    } else {
      await proxy.start();
      console.log('[SERVER-V2] Tastytrade/dxLink feed started');
    }
  } catch (err) {
    console.error('[SERVER-V2] Feed failed to start:', err.message);
    marketState.setError(`feed: ${err.message}`);
  }

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
    // In-process weekly publisher for the customer /em page: computes EM + zones
    // server-side and POSTs each ticker to /api/levels (Sat ~09:00 ET, then
    // auto-retries unpriced tickers on a backoff). No startup publish by design.
    require('./levels-auto-publish').startLevelsAutoPublish(PORT);
    // In-process weekly EM Tracker evaluator: every Sat ~09:00 ET scores last
    // week's close vs the EM band (win = closed inside) and POSTs to /api/em-tracker.
    require('./em-tracker-auto-eval').startEmTrackerAutoEval(PORT);
    // Overnight ES gap tracker: posts the 9:30 gap (vs prior 16:00 print) once the
    // 09:30 candle lands, then updates fill % every 5m during RTH → /api/es-gap.
    require('./es-gap-tracker').startEsGapTracker(PORT);
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
  process.exit(1);
});
