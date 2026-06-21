'use strict';
/**
 * server-v2/websocket-server.js
 *
 * WebSocket fan-out for the computed market state.
 *
 *   - Attaches to an existing http.Server via the 'upgrade' event, path /ws/gex.
 *   - On connect: sends one full 'snapshot' message.
 *   - On every market-state 'change': broadcasts targeted messages
 *     ('gex' | 'flow' | 'spot' | 'status') to all open clients.
 *   - Periodic 'ping' keepalive; drops dead sockets.
 *
 * Reads exclusively from ./state/market-state — it never mutates state and is
 * not wired into the app until the entry point calls createGexWsServer().
 */

const WebSocket = require('ws');
const marketState = require('./state/market-state');

const WS_PATH = process.env.GEX_WS_PATH || '/ws/gex';

// Captured once at module load = process start. Used to report server uptime
// (seconds) in the snapshot status so the owner dashboard can render it.
const PROCESS_START_MS = Date.now();

function buildSnapshot(state) {
  return {
    symbol: state.symbol,
    spot: state.spot,
    prevClose: state.prevClose,
    vix: state.vix,
    esFut: state.esFut,
    vixPrevClose: state.vixPrevClose,
    esFutPrevClose: state.esFutPrevClose,
    expiry: state.expiry,
    expirations: state.expirations,
    updatedAt: state.updatedAt,
    gexRows: state.gexRows,
    totals: state.totals,
    callWall: state.callWall,
    putWall: state.putWall,
    gexFlip: state.gexFlip,
    totalNetGex: state.totalNetGex,
    flow: state.flow,
    esCandles: state.esCandles,
    esBigTrades: state.esBigTrades,
    status: {
      ...state.status,
      // Server uptime in seconds (process lifetime).
      uptime: Math.round((Date.now() - PROCESS_START_MS) / 1000),
      // If the feed has produced data at all, treat the last state update as the
      // freshest feed time so the dashboard's "Last Feed" doesn't go stale while
      // snapshots are still flowing.
      lastFeedAt: state.status.lastFeedAt ?? (state.updatedAt || null),
    },
  };
}

function msg(type, data, symbol) {
  return JSON.stringify({ type, symbol, data, ts: Date.now() });
}

/**
 * Create the GEX broadcaster and attach it to an http server.
 * @param {import('http').Server} server
 * @param {object} [opts]
 * @param {string} [opts.path] ws path (default /ws/gex)
 * @param {object} [opts.log]
 * @returns {{ wss: WebSocket.Server, close: () => void }}
 */
function createGexWsServer(server, { path = WS_PATH, log = console } = {}) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url || '/', 'http://localhost').pathname;
    } catch {
      return;
    }
    if (pathname !== path) return; // let other upgrade handlers take it
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    // Initial full snapshot.
    safeSend(ws, msg('snapshot', buildSnapshot(marketState.getState()), 'SPX'));

    ws.on('message', (raw) => {
      // Optional client commands, e.g. { type:'setExpiry', expiry:'2025-06-20' }.
      // Handled by the entry point if it registers onClientMessage; ignored here.
      try {
        const parsed = JSON.parse(raw.toString());
        wss.emit('client-message', { ws, parsed });
      } catch {
        /* ignore */
      }
    });

    ws.on('error', () => {});
  });

  // Broadcast on state changes.
  const unsubscribe = marketState.onChange(({ state, changedKeys }) => {
    if (!wss.clients.size) return;
    const out = [];
    const changed = new Set(changedKeys);

    if (changed.has('gexRows') || changed.has('totals') || changed.has('callWall') ||
        changed.has('putWall') || changed.has('gexFlip') || changed.has('totalNetGex')) {
      out.push(msg('gex', {
        gexRows: state.gexRows,
        totals: state.totals,
        callWall: state.callWall,
        putWall: state.putWall,
        gexFlip: state.gexFlip,
        totalNetGex: state.totalNetGex,
        expiry: state.expiry,
        updatedAt: state.updatedAt,
      }, state.symbol));
    }
    if (changed.has('flow')) out.push(msg('flow', state.flow, state.symbol));
    // Full esCandles array goes out only in the connect-time snapshot (written via
    // setStateSilent, so it never lands in changedKeys here). Live updates arrive
    // as a small esCandlesDelta — re-typed as 'esCandles' so the client's existing
    // slotKey merge ingests it unchanged, carrying only the bars that moved.
    if (changed.has('esCandles')) out.push(msg('esCandles', state.esCandles, state.symbol));
    if (changed.has('esCandlesDelta')) out.push(msg('esCandles', state.esCandlesDelta, state.symbol));
    if (changed.has('esBigTrades')) out.push(msg('esBigTrades', state.esBigTrades, state.symbol));
    if (changed.has('spot') || changed.has('prevClose')) {
      out.push(msg('spot', { spot: state.spot, prevClose: state.prevClose }, state.symbol));
    }
    if (changed.has('vix') || changed.has('esFut') ||
        changed.has('vixPrevClose') || changed.has('esFutPrevClose')) {
      out.push(msg('aux', {
        vix: state.vix,
        esFut: state.esFut,
        vixPrevClose: state.vixPrevClose,
        esFutPrevClose: state.esFutPrevClose,
      }, state.symbol));
    }
    if (changed.has('status')) out.push(msg('status', state.status, state.symbol));
    if (changed.has('expirations') || changed.has('expiry')) {
      out.push(msg('status', { ...state.status, expirations: state.expirations, expiry: state.expiry }, state.symbol));
    }

    if (!out.length) return;
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      for (const m of out) safeSend(client, m);
    }
  });

  // Keepalive ping / dead-socket reaping.
  const pinger = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* noop */
      }
    }
  }, 30000);

  log.log?.(`[WS] GEX broadcaster attached on ${path}`);

  function close() {
    clearInterval(pinger);
    unsubscribe();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  }

  return { wss, close };
}

function safeSend(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(data);
    } catch {
      /* noop */
    }
  }
}

module.exports = { createGexWsServer, buildSnapshot };
