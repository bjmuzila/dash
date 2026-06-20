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
const { buildSnapshot, createGexWsServer } = require('./websocket-server');
const { TastytradeProxy, probeRest, fetchChainFull, fetchExpirations, fetchOptionMarks, fetchDailyHistory } = require('./proxy-tastytrade');
const { startEsSeed } = require('./es-seed-loader');
const { startEodGexRecorder } = require('./eod-gex-recorder');

const PORT = parseInt(process.env.PORT || '3001', 10);
const DEV = process.env.NODE_ENV !== 'production';

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
    default:
      sendJson(res, 404, { error: 'unknown proxy route', path: pathname });
      return true;
  }
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
      // Manual weekly-levels publish. The auto-publisher only fires Saturday, so
      // this lets you (re)publish on demand — e.g. after editing the ticker list
      // or for the first load — without overwriting on every restart.
      //   POST /proxy/levels-publish
      if (pathname === '/proxy/levels-publish' && req.method === 'POST') {
        const { publishOnce, isPublishing } = require('./levels-auto-publish');
        if (isPublishing()) { sendJson(res, 200, { started: false, running: true }); return; }
        // Fire-and-forget: a full-roster publish takes minutes. Kick it off and
        // return immediately; the owner page polls /proxy/levels-status for the
        // result. Errors are captured into lastRun by publishOnce itself.
        publishOnce(`http://localhost:${PORT}`, 'manual').catch((e) => {
          console.log('[levels-pub] manual run error:', e && e.message);
        });
        sendJson(res, 200, { started: true, running: true });
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
            const data = await fetchOptionMarks(symbols);
            sendJson(res, 200, { data });
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
            const data = await fetchChainFull(ticker, expiration);
            sendJson(res, 200, { data, context: 'rest' });
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

  // Start the live feed.
  try {
    proxy = await new TastytradeProxy().start();
    console.log('[SERVER-V2] Tastytrade/dxLink feed started');
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
    // In-process MVC auto-collector: writes a snapshot every 30m during RTH.
    require('./mvc-auto-snapshot').startMvcAutoSnapshot(PORT);
    // EOD GEX recorder: upserts one row per ($SPX/SPY/QQQ) at 3:55–4:05 ET.
    startEodGexRecorder(PORT);
    // In-process weekly publisher for the customer /em page: computes EM + zones
    // server-side and POSTs each ticker to /api/levels (Mon ~09:35 ET + startup).
    require('./levels-auto-publish').startLevelsAutoPublish(PORT);
    // In-process weekly EM Tracker evaluator: every Sat ~09:00 ET scores last
    // week's close vs the EM band (win = closed inside) and POSTs to /api/em-tracker.
    require('./em-tracker-auto-eval').startEmTrackerAutoEval(PORT);
    // Optional: seed the Footprint page from a transcribed ES T&S file when the
    // live ES feed is quiet (after hours). Enabled with ES_SEED=1.
    startEsSeed({ log: console });
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
