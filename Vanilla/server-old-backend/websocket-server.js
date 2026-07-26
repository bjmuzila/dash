const WebSocket = require('ws');

function createDxLinkWsBridge({ server, targetUrl, log = console }) {
  const wsProxyServer = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname !== '/ws/dxlink') {
      return; // let other upgrade handlers (e.g. /ws/gex broadcaster) handle it
    }

    wsProxyServer.handleUpgrade(request, socket, head, (clientSocket) => {
      wsProxyServer.emit('connection', clientSocket, request);
      const upstream = new WebSocket(targetUrl);

      const closeBoth = () => {
        if (clientSocket.readyState === WebSocket.OPEN || clientSocket.readyState === WebSocket.CONNECTING) {
          clientSocket.close();
        }
        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
          upstream.close();
        }
      };

      upstream.on('open', () => {
        clientSocket.on('message', (message, isBinary) => {
          if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(message, { binary: isBinary });
          }
        });

        upstream.on('message', (message, isBinary) => {
          if (clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.send(message, { binary: isBinary });
          }
        });
      });

      upstream.on('error', (err) => {
        log.error?.('[WS PROXY] Upstream error:', err.message);
        closeBoth();
      });

      clientSocket.on('error', (err) => {
        log.error?.('[WS PROXY] Client error:', err.message);
        closeBoth();
      });

      upstream.on('close', closeBoth);
      clientSocket.on('close', closeBoth);
    });
  });

  return wsProxyServer;
}

module.exports = {
  createDxLinkWsBridge
};
