/**
 * End-to-end check for the shared socket's ?topics= scoping. DEV/QA ONLY.
 *
 * Stands up a miniature /ws/gex that mirrors the real server's contract —
 * parseTopics + scopeSnapshot + per-frame topic filtering (see
 * server-v2/websocket-server.js) — serves the built SPA next to it, then drives
 * a real browser through the cases that can silently break live data:
 *
 *   1. a phone route connects SCOPED (not the full firehose)
 *   2. every frame type the mounted consumers read still arrives
 *   3. a route change that WIDENS the scope reconnects immediately, and the
 *      newly-mounted consumer gets un-stripped data (the replay-cache trap)
 *   4. a route change that NARROWS does not thrash the connection
 *
 *   npm i --no-save playwright ws
 *   node scripts/ws-scope-check.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "app-vite", "dist");
const PORT = 4321;

const SPOT = 6152.5;
const CHAIN = Array.from({ length: 81 }, (_, i) => {
  const strike = Math.round((SPOT - 200 + i * 5) / 5) * 5;
  const d = (strike - SPOT) / 100;
  const bell = Math.exp(-(d * d) * 8);
  const gamma = bell * 0.0009;
  return {
    strike, spotPrice: SPOT,
    callOI: Math.round(bell * 42000), putOI: Math.round(bell * 38000),
    callVolume: Math.round(bell * 17000), putVolume: Math.round(bell * 14000),
    callGamma: gamma, putGamma: gamma * 0.96,
    callDelta: 0.5 - d * 0.8, putDelta: -0.5 - d * 0.8,
    netGEX: bell * 1e9, netVolGEX: bell * 3e8, netDEX: bell * 2e9,
    callIV: 0.11, putIV: 0.12, dte: 0,
  };
});
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const EXPIRIES = [TODAY, "2099-01-02", "2099-01-03"];

// ── the server contract, mirrored ────────────────────────────────────────────
function parseTopics(url) {
  const q = new URL(url || "/", "http://x").searchParams.get("topics");
  if (!q) return null;
  const set = new Set(q.split(",").map((s) => s.trim()).filter(Boolean));
  return set.size ? set : null;
}
function buildSnapshot() {
  return {
    symbol: "$SPX", spot: SPOT, spotDisplay: SPOT, prevClose: 6127.8,
    vix: 14.2, esFut: SPOT + 22, basis: 22,
    expiry: EXPIRIES[0], expirations: EXPIRIES,
    gexRows: CHAIN, totals: { netGex: 1.84e9, netDex: 2.1e9 },
    callWall: 6200, putWall: 6050, gexFlip: 6120, totalNetGex: 1.84e9,
    flow: { tape: Array.from({ length: 200 }, (_, i) => ({ i, sym: "SPX" })) },
    esCandles: Array.from({ length: 300 }, (_, i) => ({ slotKey: `s${i}`, timestamp: Date.now() - i * 3e5, date: TODAY, open: 6180, high: 6185, low: 6175, close: 6182, volume: 100 })),
    es1mCandles: Array.from({ length: 300 }, (_, i) => ({ slotKey: `m${i}`, timestamp: Date.now() - i * 6e4, date: TODAY, open: 6180, high: 6185, low: 6175, close: 6182, volume: 20 })),
    nqCandles: [],
    updatedAt: Date.now(), status: { chartReady: true },
  };
}
function scopeSnapshot(snap, topics) {
  if (!topics) return snap;
  const out = { ...snap };
  if (!topics.has("gex")) { out.gexRows = undefined; out.totals = undefined; }
  if (!topics.has("flow")) out.flow = undefined;
  if (!topics.has("esCandles")) out.esCandles = undefined;
  if (!topics.has("nqCandles")) out.nqCandles = undefined;
  if (!topics.has("es1mCandles")) out.es1mCandles = undefined;
  return out;
}
const msg = (type, data) => JSON.stringify({ type, symbol: "$SPX", data, ts: Date.now() });

// Every connection the browser opened, in order — the actual evidence.
const connections = [];

const MIME = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const json = (res, body) => { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };

const server = createServer(async (req, res) => {
  const p = new URL(req.url, `http://localhost:${PORT}`).pathname;
  if (p === "/api/auth/me") return json(res, { user: { id: "u" }, isSignedIn: true, isPaid: true, isOwnerClaim: false });
  if (p === "/api/gex") return json(res, { chain: [], spotPrice: 0 }); // force the WS to be the only source
  if (p.startsWith("/api/") || p.startsWith("/proxy/")) return json(res, {});
  if (p.startsWith("/app")) {
    const rel = p.replace(/^\/app\/?/, "");
    const file = path.join(DIST, rel);
    if (rel && existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      return res.end(await readFile(file));
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(await readFile(path.join(DIST, "index.html")));
  }
  res.writeHead(404); res.end("nf");
});

const wss = new WebSocketServer({ server, path: "/ws/gex" });
wss.on("connection", (ws, req) => {
  const topics = parseTopics(req.url);
  const rec = { url: req.url, topics: topics ? [...topics].sort() : null, at: Date.now() };
  connections.push(rec);
  ws.topics = topics;
  ws.send(msg("snapshot", scopeSnapshot(buildSnapshot(), topics)));
});

// Push one of each filtered frame type every second.
setInterval(() => {
  const frames = [
    ["gex", { gexRows: CHAIN, totals: { netGex: 1.84e9 }, callWall: 6200, putWall: 6050, gexFlip: 6120, totalNetGex: 1.84e9, expiry: EXPIRIES[0] }],
    ["spot", { spot: SPOT, prevClose: 6127.8, basis: 22 }],
    ["aux", { vix: 14.2, esFut: SPOT + 22, basis: 22, spotDisplay: SPOT }],
    ["status", { chartReady: true, expirations: EXPIRIES, expiry: EXPIRIES[0] }],
    ["flow", { tape: [{ i: 1 }] }],
    ["esCandles", [{ slotKey: "live", timestamp: Date.now(), date: TODAY, open: 6180, high: 6186, low: 6179, close: 6184, volume: 9 }]],
  ];
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    for (const [t, d] of frames) {
      if (client.topics && !client.topics.has(t)) continue;
      client.send(msg(t, d));
    }
  }
}, 1000);

await new Promise((r) => server.listen(PORT, r));

// ── drive a browser ──────────────────────────────────────────────────────────
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); };

// Case 1+2 — a phone GEX route: scoped, and still painting real data.
await page.goto(`http://localhost:${PORT}/app/m/gex`, { waitUntil: "networkidle" });
await page.waitForTimeout(4000);
const first = connections[0];
check("1. connects scoped (not the firehose)", first?.topics !== null, JSON.stringify(first?.topics));
// The settle window should mean the toolbar and the route's hooks land on ONE
// connection rather than the toolbar claiming a narrow scope and being widened.
check("1b. one connection for the whole page, at the full union",
  connections.length === 1 && JSON.stringify(first?.topics) === JSON.stringify(["aux", "gex", "spot", "status"]),
  `${connections.length} conn(s), scope ${JSON.stringify(first?.topics)}`);
check("2. flow + candles NOT requested (the whole point)",
  !first?.topics?.includes("flow") && !first?.topics?.includes("esCandles"),
  JSON.stringify(first?.topics));
const gexPainted = await page.locator("text=6,152.50").first().isVisible().catch(() => false);
check("2b. GEX page still has live data under the narrow scope", gexPainted, `spot visible: ${gexPainted}`);

// Case 3 — navigate to ES candles: needs esCandles/es1mCandles → must WIDEN.
const beforeWiden = connections.length;
await page.getByRole("link", { name: /ES Candles/ }).click();
await page.waitForTimeout(5000);
const widened = connections[connections.length - 1];
check("3. widening opened exactly one new connection", connections.length === beforeWiden + 1, `${beforeWiden} → ${connections.length}`);
check("3b. new scope includes the candle topics",
  !!widened?.topics?.includes("esCandles") && !!widened?.topics?.includes("es1mCandles"),
  JSON.stringify(widened?.topics));
const esPainted = await page.locator("text=/6,1\\d\\d\\.\\d\\d/").first().isVisible().catch(() => false);
check("3c. ES page painted after the re-scope (replay cache not stale)", esPainted, `price visible: ${esPainted}`);

// Case 4 — back to GEX: scope NARROWS; should be debounced, not thrashed.
const beforeNarrow = connections.length;
await page.getByRole("link", { name: /Gamma Exposure/ }).click();
await page.waitForTimeout(600);
const during = connections.length;
check("4. narrowing is debounced (no instant reconnect)", during === beforeNarrow, `${beforeNarrow} → ${during} within 600ms`);
await page.waitForTimeout(3500);
const afterNarrow = connections[connections.length - 1];
check("4b. narrowed after the debounce", !afterNarrow?.topics?.includes("esCandles"), JSON.stringify(afterNarrow?.topics));
check("4c. exactly one reconnect for the round trip", connections.length - beforeNarrow <= 1, `+${connections.length - beforeNarrow}`);

console.log("\n" + results.map((r) => `${r.pass ? "PASS" : "FAIL"}  ${r.name}\n        ${r.detail}`).join("\n"));
console.log("\nconnections opened:", JSON.stringify(connections.map((c) => c.topics)));
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `\n${failed} FAILED` : "\nall passed");

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
