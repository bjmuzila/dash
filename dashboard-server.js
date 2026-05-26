const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = __dirname;
const PORT = 8080;
const PROXY_PORT = 3001;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,Accept",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
    ...headers
  });
  res.end(body);
}

function proxyToTastytrade(req, res) {
  const pathName = req.url;
  const forwarded = http.request(
    {
      hostname: "localhost",
      port: PROXY_PORT,
      path: pathName,
      method: req.method,
      headers: req.headers
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, {
        ...proxyRes.headers,
        "Access-Control-Allow-Origin": "*"
      });
      proxyRes.pipe(res);
    }
  );

  forwarded.on("error", (error) => {
    send(res, 502, JSON.stringify({ error: "Proxy unavailable", detail: error.message }), {
      "Content-Type": "application/json; charset=utf-8"
    });
  });

  req.pipe(forwarded);
}

function serveFile(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(ROOT, `.${requested}`);

  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  const body = fs.readFileSync(filePath);

  send(res, 200, body, {
    "Content-Type": TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream"
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

  if (req.url.startsWith("/proxy/") || req.url.startsWith("/api/")) {
    proxyToTastytrade(req, res);
    return;
  }

  serveFile(req, res);
});

server.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/proxy/")) {
    socket.destroy();
    return;
  }

  const forwarded = http.request({
    hostname: "localhost",
    port: PROXY_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers
  });

  forwarded.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/${proxyRes.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n` +
      Object.entries(proxyRes.headers).map(([key, value]) => `${key}: ${value}`).join("\r\n") +
      "\r\n\r\n"
    );
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
    if (proxyHead && proxyHead.length) socket.write(proxyHead);
    if (head && head.length) proxySocket.write(head);
  });

  forwarded.on("error", () => socket.destroy());
  forwarded.end();
});

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}/`);
  console.log(`Forwarding /proxy/* to http://localhost:${PROXY_PORT}/proxy/*`);
});
;(() => {
  if (typeof document === 'undefined') return;

  const removeServedPrompts = () => {
    document.querySelectorAll('body *').forEach((element) => {
      if (/^served by\s+/i.test((element.textContent || '').trim())) {
        element.remove();
      }
    });
  };

  removeServedPrompts();
  window.addEventListener('load', removeServedPrompts);
  new MutationObserver(removeServedPrompts).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
