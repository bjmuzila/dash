/**
 * Custom Next.js server combining proxy + app
 * Run with: node server.js
 */
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3002', 10);
const app = next({ dev: process.env.NODE_ENV !== 'production' });
const handle = app.getRequestHandler();

// Import proxy logic (minimal - just the key endpoints)
// Full proxy logic stays in proxy-tastytrade.js for now
const proxyTastytrade = require('./proxy-tastytrade.js');

app.prepare().then(() => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    const { pathname, query } = parsedUrl;

    // Route proxy requests to the standalone server
    // (or integrate proxy logic here directly)
    if (pathname.startsWith('/proxy/') || pathname.startsWith('/ws/')) {
      // These are handled by proxy-tastytrade.js on 3001
      // Or can be integrated here directly
      return handle(req, res, parsedUrl);
    }

    // All other requests go to Next.js
    return handle(req, res, parsedUrl);
  }).listen(PORT, (err) => {
    if (err) throw err;
    console.log(`> Server ready on http://localhost:${PORT}`);
  });
});
