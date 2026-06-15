/**
 * Custom Next.js server that spawns proxy as child process
 * This allows a single server to handle both Next.js and proxy logic
 *
 * Usage: node server-with-proxy.js
 */
const { spawn } = require('child_process');
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3002', 10);
const app = next({ dev: process.env.NODE_ENV !== 'production' });
const handle = app.getRequestHandler();

// Spawn proxy server as child process on port 3001
let proxyProcess = null;

function startProxy() {
  console.log('[SERVER] Starting proxy server on port 3001...');
  proxyProcess = spawn('node', [path.join(__dirname, 'proxy-tastytrade.js')], {
    stdio: 'inherit',
    env: { ...process.env, PORT: '3001' }
  });

  proxyProcess.on('error', (err) => {
    console.error('[SERVER] Proxy error:', err);
  });

  proxyProcess.on('exit', (code) => {
    console.warn(`[SERVER] Proxy exited with code ${code}`);
  });
}

app.prepare().then(() => {
  startProxy();

  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(PORT, (err) => {
    if (err) throw err;
    console.log(`[SERVER] Next.js ready on http://localhost:${PORT}`);
    console.log(`[SERVER] Proxy running on http://localhost:3001`);
  });
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
