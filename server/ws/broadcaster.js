/**
 * GEX WebSocket broadcaster.
 *
 * Clients connect to /ws/gex and immediately receive the current state.
 * Every time market-state updates, all connected clients get a GEX_UPDATE push.
 * Clients can send { type: 'SET_EXPIRY', expiry: 'YYYY-MM-DD' } to switch expirations.
 *
 * This replaces the per-request /api/gex polling model entirely.
 */
'use strict';

const WebSocket = require('ws');
const marketState = require('../state/market-state');
const gexLoop = require('../loops/gex-loop');

let wss = null;

/**
 * Send a message to a single client safely.
 */
function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(msg)); } catch (e) {}
  }
}

/**
 * Broadcast to all connected clients.
 */
function broadcast(msg) {
  if (!wss) return;
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(payload); } catch (e) {}
    }
  }
}

/**
 * Attach the GEX broadcaster to an existing HTTP server.
 * Listens for upgrades on /ws/gex path.
 *
 * @param {http.Server} server
 */
function createGexBroadcaster(server) {
  wss = new WebSocket.Server({ noServer: true });

  // Handle upgrades for /ws/gex only
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname !== '/ws/gex') return; // let other handlers deal with it

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);

      // On connect: send current state immediately
      const current = marketState.getState();
      if (current.gexRows.length) {
        send(ws, {
          type:        'GEX_UPDATE',
          gexRows:     current.gexRows,
          spot:        current.spot,
          expiry:      current.expiry,
          expirations: current.expirations,
          callWall:    current.callWall,
          putWall:     current.putWall,
          gexFlip:     current.gexFlip,
          totalNetGex: current.totalNetGex,
          updatedAt:   current.updatedAt,
        });
      }

      // If no data yet, send expirations so the client can show the toolbar
      if (current.expirations.length) {
        send(ws, {
          type:        'EXPIRATIONS',
          expirations: current.expirations,
          expiry:      current.expiry,
        });
      }

      // Handle messages from client
      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw);

          if (msg.type === 'SET_EXPIRY' && msg.expiry) {
            console.log(`[broadcaster] Client requested expiry: ${msg.expiry}`);
            await gexLoop.setExpiry(msg.expiry);
          }

          if (msg.type === 'PING') {
            send(ws, { type: 'PONG', ts: Date.now() });
          }
        } catch (e) {
          // ignore malformed messages
        }
      });

      ws.on('error', () => {});
      ws.on('close', () => {});
    });
  });

  // Subscribe to state changes → broadcast to all clients
  marketState.onChange((newState) => {
    if (!newState.gexRows.length) return;
    broadcast({
      type:        'GEX_UPDATE',
      gexRows:     newState.gexRows,
      spot:        newState.spot,
      expiry:      newState.expiry,
      expirations: newState.expirations,
      callWall:    newState.callWall,
      putWall:     newState.putWall,
      gexFlip:     newState.gexFlip,
      totalNetGex: newState.totalNetGex,
      updatedAt:   newState.updatedAt,
    });
  });

  console.log('[broadcaster] GEX broadcaster attached to /ws/gex');
  return wss;
}

module.exports = { createGexBroadcaster };
