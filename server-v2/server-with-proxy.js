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
const { parse } = require('url');
const path = require('path');
const dotenv = require('dotenv');

const ROOT_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT_DIR, '.env.local'), override: false });
dotenv.config({ path: path.join(ROOT_DIR, '.env'), override: false });

const next = require('next');
const marketState = require('./state/market-state');
const { buildSnapshot, createGexWsServer } = require('./websocket-server');
const { TastytradeProxy } = require('./proxy-tastytrade');

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
  const { pathname } = parse(req.url, true);
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

  const server = createServer((req, res) => {
    try {
      if (handleProxyRest(req, res)) return;
    } catch (err) {
      sendJson(res, 500, { error: String(err?.message || err) });
      return;
    }
    handle(req, res, parse(req.url, true));
  });

  // Attach WS broadcaster (/ws/gex).
  const { wss } = createGexWsServer(server, { log: console });

  // Start the live feed.
  let proxy = null;
  try {
    proxy = await new TastytradeProxy().start();
    console.log('[SERVER-V2] Tastytrade/dxLink feed started');
  } catch (err) {
    console.error('[SERVER-V2] Feed failed to start:', err.message);
    marketState.setError(`feed: ${err.message}`);
  }

  // Route client commands (e.g. expiry switch) to the live proxy.
  wss.on('client-message', ({ parsed }) => {
    if (parsed?.type === 'setExpiry' && proxy) proxy.setExpiry(parsed.expiry);
  });

  server.listen(PORT, () => {
    console.log(`[SERVER-V2] listening on http://localhost:${PORT}  (ws ${PORT}/ws/gex, rest /proxy/*)`);
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
