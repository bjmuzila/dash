/**
 * Custom Next.js server that optionally spawns proxy as child process
 * Falls back to Next.js-only if proxy fails to start
 *
 * Usage: node server/server-with-proxy.js
 */
const { spawn } = require('child_process');
const { createServer } = require('http');
const net = require('net');
const { parse } = require('url');
const next = require('next');
const path = require('path');
const dotenv = require('dotenv');
const { createDxLinkWsBridge } = require('./websocket-server');
const { createGexBroadcaster } = require('./ws/broadcaster');
const gexLoop = require('./loops/gex-loop');
const { Pool } = require('pg');

const ROOT_DIR = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env.local'), override: false });
dotenv.config({ path: path.join(ROOT_DIR, '.env'), override: false });

const PORT = parseInt(process.env.PORT || '3002', 10);
const PROXY_PORT = 3001;
const app = next({ dev: process.env.NODE_ENV !== 'production', dir: ROOT_DIR });
const handle = app.getRequestHandler();
const localProxyTarget = process.env.PROXY_URL || `http://127.0.0.1:${PROXY_PORT}`;
const shouldManageLocalProxy =
  /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?/i.test(localProxyTarget);

// Spawn proxy server as child process on port 3001
let proxyProcess = null;
let proxyReady = false;
let proxyRestartTimer = null;

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1200, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function clearProxyRestartTimer() {
  if (!proxyRestartTimer) return;
  clearTimeout(proxyRestartTimer);
  proxyRestartTimer = null;
}

function scheduleProxyRestart() {
  if (!shouldManageLocalProxy || proxyRestartTimer) return;
  proxyRestartTimer = setTimeout(() => {
    proxyRestartTimer = null;
    void startProxy();
  }, 1500);
}

async function startProxy() {
  if (!shouldManageLocalProxy) {
    proxyReady = true;
    return;
  }
  if (proxyProcess && !proxyProcess.killed) return;
  if (await isPortOpen(PROXY_PORT)) {
    proxyReady = true;
    console.log(`[SERVER] Using existing proxy on port ${PROXY_PORT}`);
    return;
  }

  clearProxyRestartTimer();
  console.log(`[SERVER] Starting proxy server on port ${PROXY_PORT}...`);

  try {
    proxyProcess = spawn('node', [path.join(__dirname, 'proxy-tastytrade.js')], {
      stdio: 'pipe',
      cwd: ROOT_DIR,
      env: { ...process.env, PORT: String(PROXY_PORT) }
    });

    let stdoutData = '';
    proxyProcess.stdout?.on('data', (data) => {
      stdoutData += data.toString();
      console.log('[PROXY]', data.toString().trim());
      if (stdoutData.includes('listening') || stdoutData.includes('ready')) {
        proxyReady = true;
      }
    });

    proxyProcess.stderr?.on('data', (data) => {
      console.error('[PROXY ERR]', data.toString().trim());
    });

    proxyProcess.on('error', (err) => {
      console.error('[SERVER] Proxy spawn error:', err);
    });

    proxyProcess.on('exit', (code, signal) => {
      console.warn(`[SERVER] Proxy exited with code ${code}, signal ${signal}`);
      proxyProcess = null;
      proxyReady = false;
      scheduleProxyRestart();
    });
  } catch (err) {
    console.error('[SERVER] Failed to start proxy:', err);
    proxyProcess = null;
    proxyReady = false;
    scheduleProxyRestart();
  }
}

// Postgres pool for GEX loop writes
const pgPool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? undefined : { rejectUnauthorized: false },
      max: 3,
    })
  : null;

app.prepare().then(async () => {
  void startProxy();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // Existing dxLink WS bridge (keep for live Greeks streaming)
  createDxLinkWsBridge({
    server,
    targetUrl: `ws://127.0.0.1:${PROXY_PORT}/ws/dxlink`,
    log: console
  });

  // New: GEX push broadcaster on /ws/gex
  createGexBroadcaster(server);

  server.listen(PORT, (err) => {
    if (err) throw err;
    console.log(`[SERVER] Next.js ready on http://localhost:${PORT}`);
  });

  // Start GEX computation loop (runs independently of any client requests)
  await gexLoop.start({ pool: pgPool });
  console.log('[SERVER] GEX loop started');

}).catch((err) => {
  console.error('[SERVER] Failed to start:', err);
  process.exit(1);
});

// Cleanup on exit
process.on('SIGTERM', () => {
  if (proxyProcess) proxyProcess.kill();
  process.exit(0);
});

process.on('SIGINT', () => {
  if (proxyProcess) proxyProcess.kill();
  process.exit(0);
});
