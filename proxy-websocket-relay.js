/**
 * WebSocket Relay for dxLink FEED_DATA → Browsers
 * 
 * Add this code to your proxy-tastytrade.js server
 * Enables:
 *   - /ws/dxlink → relay dxLink events to connected browsers
 *   - /proxy/api/webhooks/:id/:token → forward Discord webhooks
 */

// ─── Add to top of proxy-tastytrade.js (after existing WebSocket imports) ────

const wss = new WebSocket.Server({ noServer: true });
const browserClients = new Set();

// ─── In your HTTP server creation, add upgrade handler ────────────────────

// PLACE THIS in your server.on('upgrade', ...) section:
// If you don't have an upgrade handler yet, add this:

server.on('upgrade', (req, socket, head) => {
  const p = new URL(req.url, `http://${req.headers.host}`).pathname;

  // ─── /ws/dxlink: Relay dxLink FEED_DATA to browser clients ─────────────
  if (p === '/ws/dxlink') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      log('[/ws/dxlink] Browser connected');
      browserClients.add(ws);

      // Handle incoming messages from browser
      ws.on('message', (msg) => {
        try {
          const data = JSON.parse(msg);
          
          // Browser requesting symbol subscriptions
          if (data.type === 'subscribe' && Array.isArray(data.symbols)) {
            log('[/ws/dxlink] Browser subscribe request:', data.symbols.join(', '));
            
            // Subscribe to these symbols on dxLink
            data.symbols.forEach(sym => {
              addAutoSubscription(sym, ['Quote', 'Trade', 'TradeETH', 'Greeks', 'Summary']);
            });
          }
        } catch (e) {
          log('[/ws/dxlink] Parse error:', e.message);
        }
      });

      // Handle client disconnect
      ws.on('close', () => {
        log('[/ws/dxlink] Browser disconnected');
        browserClients.delete(ws);
      });

      ws.on('error', (err) => {
        log('[/ws/dxlink] WebSocket error:', err.message);
        browserClients.delete(ws);
      });
    });
    return;
  }

  // ─── Default: close non-upgrade connections ───────────────────────────
  socket.destroy();
});

// ─── Relay dxLink FEED_DATA to all browser clients ─────────────────────────

// PLACE THIS near your dxSocket event handlers:
// This intercepts dxLink messages and broadcasts to browsers

// Hook into your existing dxSocket message handler
// Replace or supplement your current dxSocket.on('message') with this:

const dxSocketMessageHandler = (msg) => {
  try {
    // Your existing dxLink parsing logic here...
    // (keep your current cache updates and GEX calculations)

    // NEW: After processing, relay FEED_DATA to browsers
    if (msg.type === 'FEED_DATA' && browserClients.size > 0) {
      const feedEvent = {
        type: 'FEED_DATA',
        eventSymbol: msg.eventSymbol,
        price: msg.price,
        last: msg.last,
        bid: msg.bid,
        ask: msg.ask,
        bidSize: msg.bidSize,
        askSize: msg.askSize,
        volume: msg.dayVolume,
        dayVolume: msg.dayVolume,
        dayHigh: msg.dayHigh,
        dayLow: msg.dayLow,
        openInterest: msg.openInterest,
        timestamp: Date.now()
      };

      const payload = JSON.stringify(feedEvent);
      
      // Send to all connected browsers
      browserClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      });
    }
  } catch (e) {
    log('[dxLink relay] Error:', e.message);
  }
};

// ─── Discord Webhook Proxy Endpoint ───────────────────────────────────────

// PLACE THIS in your HTTP request handler (e.g., in your main request routing):

const handleDiscordWebhook = (req, res, webhookId, webhookToken) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const discordUrl = `https://discord.com/api/webhooks/${webhookId}/${webhookToken}`;
  const contentType = req.headers['content-type'] || 'application/json';

  let bodyChunks = [];
  req.on('data', chunk => {
    bodyChunks.push(chunk);
    if (Buffer.concat(bodyChunks).length > 25 * 1024 * 1024) {
      req.destroy();
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload too large' }));
    }
  });

  req.on('end', () => {
    const body = Buffer.concat(bodyChunks);

    const discordReq = https.request(new URL(discordUrl), {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': body.length
      }
    }, (discordRes) => {
      let discordBody = '';
      discordRes.on('data', chunk => { discordBody += chunk; });
      discordRes.on('end', () => {
        res.writeHead(discordRes.statusCode, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(discordBody);
        log('[Discord] Webhook forwarded, status:', discordRes.statusCode);
      });
    });

    discordReq.on('error', (err) => {
      log('[Discord] Webhook error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Discord webhook failed' }));
    });

    discordReq.write(body);
    discordReq.end();
  });

  req.on('error', (err) => {
    log('[Discord] Request error:', err.message);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad request' }));
  });
};

// ─── HTTP Request Handler Routing ──────────────────────────────────────────

// PLACE THIS in your main request handler (inside your server.on('request') handler):

// Example routing (adjust path structure to match your existing code):
const handleRequest = (req, res) => {
  const p = new URL(req.url, `http://${req.headers.host}`).pathname;

  // Discord webhook proxy
  const webhookMatch = p.match(/^\/proxy\/api\/webhooks\/([^/]+)\/([^/]+)$/);
  if (webhookMatch) {
    const [, webhookId, webhookToken] = webhookMatch;
    handleDiscordWebhook(req, res, webhookId, webhookToken);
    return;
  }

  // ... rest of your routing ...
};

// ─── Integration Checklist ────────────────────────────────────────────────

/*

STEPS TO INTEGRATE:

1. Copy the WebSocket server creation code:
   const wss = new WebSocket.Server({ noServer: true });
   const browserClients = new Set();

2. Add the server.on('upgrade') handler with /ws/dxlink route

3. In your existing dxSocket.on('message') handler, add:
   - Relay FEED_DATA to browserClients using the code above
   - This broadcasts every quote/trade to connected browsers

4. Add handleDiscordWebhook function (provided above)

5. In your main HTTP request handler, add routing for:
   POST /proxy/api/webhooks/:id/:token

6. Test:
   - Open browser DevTools → Network tab
   - Click "Connect Webhook" in Live Signals tab
   - Should see WebSocket connection to /ws/dxlink
   - Subscribe message should appear in console
   - dxLink FEED_DATA should flow to browser as signals

7. Test Discord:
   - Click DISCORD button on a signal
   - Should POST to /proxy/api/webhooks/...
   - Should relay to Discord webhook
   - Image should appear in Discord channel

NOTES:
- Keep dxSocket relay logic separate from existing handlers
- Don't break existing GEX calculations or cache updates
- Monitor browserClients set size (memory usage with many clients)
- Add logging/monitoring for webhook failures

*/

// ─── Example Complete Message Handler ──────────────────────────────────────

/*
If you need a complete example of how to integrate this with your existing
dxSocket message handler, here's the pattern:

// In your existing dxSocket.on('message') handler:

dxSocket.on('message', (msg) => {
  try {
    // Parse dxLink message (your existing code)
    const feedMsg = JSON.parse(msg);

    // Update your existing caches
    if (feedMsg.type === 'FEED_DATA') {
      const symbol = feedMsg.eventSymbol;
      
      // Your existing GEX/Greeks cache updates:
      if (feedMsg.Greeks) {
        dxGreeksCache[symbol] = feedMsg.Greeks;
      }
      // ... etc ...

      // NEW: Relay to browser clients
      if (browserClients.size > 0) {
        const feedEvent = {
          type: 'FEED_DATA',
          eventSymbol: feedMsg.eventSymbol,
          price: feedMsg.price || feedMsg.last || feedMsg.mark,
          bid: feedMsg.bid,
          ask: feedMsg.ask,
          volume: feedMsg.dayVolume,
          timestamp: Date.now()
        };
        
        browserClients.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(feedEvent));
          }
        });
      }
    }
  } catch (e) {
    log('dxSocket message parse error:', e);
  }
});
*/

// ─── Logging Utility (if not already present) ──────────────────────────────

function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

// ─── End of WebSocket Relay Configuration ──────────────────────────────────
