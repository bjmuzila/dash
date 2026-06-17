/**
 * Custom Next.js server that optionally spawns proxy as child process
 * Falls back to Next.js-only if proxy fails to start
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
let proxyReady = false;

function startProxy() {
  console.log('[SERVER] Starting proxy server on port 3001...');
  try {
    proxyProcess = spawn('node', [path.join(__dirname, 'proxy-tastytrade.js')], {
      stdio: 'pipe',
      env: { ...process.env, PORT: '3001' }
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
    });
  } catch (err) {
    console.error('[SERVER] Failed to start proxy:', err);
  }
}

app.prepare().then(() => {
  // On Render (production), start proxy. Local dev, run separately.
  if (process.env.RENDER || process.env.NODE_ENV === 'production') {
    console.log('[SERVER] Starting proxy for Render/production...');
    startProxy();
  } else {
    console.log('[SERVER] Local dev: proxy must run in separate terminal');
    console.log('[SERVER] Start with: node proxy-tastytrade.js');
  }

  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(PORT, (err) => {
    if (err) throw err;
    console.log(`[SERVER] Next.js ready on http://localhost:${PORT}`);
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
