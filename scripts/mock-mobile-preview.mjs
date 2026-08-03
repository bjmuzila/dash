/**
 * Local preview server for the phone build — DEV/QA ONLY, never deployed.
 *
 * Serves app-vite/dist at /app/* with a SPA fallback and answers the handful of
 * endpoints the six mobile pages call with plausible synthetic SPX data. Lets
 * you (or a headless browser) look at /app/m/* at a real iPhone viewport
 * without a backend, a database, or market hours.
 *
 *   node scripts/mock-mobile-preview.mjs [port]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "app-vite", "dist");
const PORT = Number(process.argv[2] || 4310);

const SPOT = 6152.5;
const PREV = 6127.8;

function buildChain() {
  const rows = [];
  for (let k = SPOT - 200; k <= SPOT + 200; k += 5) {
    const strike = Math.round(k / 5) * 5;
    const d = (strike - SPOT) / 100;
    const bell = Math.exp(-(d * d) * 8);
    const round = strike % 50 === 0 ? 2.2 : strike % 25 === 0 ? 1.4 : 1;
    const callOI = Math.round(bell * 42000 * round * (strike > SPOT ? 1.35 : 0.7));
    const putOI = Math.round(bell * 42000 * round * (strike < SPOT ? 1.45 : 0.65));
    const callVolume = Math.round(callOI * 0.42);
    const putVolume = Math.round(putOI * 0.38);
    const gamma = (bell * 0.0009) / round;
    rows.push({
      strike,
      spotPrice: SPOT,
      callOI,
      putOI,
      callVolume,
      putVolume,
      callGamma: gamma,
      putGamma: gamma * 0.96,
      callDelta: 0.5 - d * 0.8,
      putDelta: -0.5 - d * 0.8,
      netGEX: (gamma * callOI - gamma * 0.96 * putOI) * SPOT * SPOT * 0.01 * 100,
      netVolGEX: (gamma * callVolume - gamma * 0.96 * putVolume) * SPOT * SPOT * 0.01 * 100,
      netDEX: ((0.5 - d * 0.8) * callOI - Math.abs(-0.5 - d * 0.8) * putOI) * SPOT * 100,
      netVanna: bell * 4.2e6 * (strike > SPOT ? 1 : -1),
      callIV: 0.11 + Math.abs(d) * 0.06,
      putIV: 0.12 + Math.abs(d) * 0.07,
      callMark: Math.max(0.05, (SPOT - strike) * 0.5 + 12 * bell),
      putMark: Math.max(0.05, (strike - SPOT) * 0.5 + 12 * bell),
      dte: 0,
    });
  }
  return rows;
}

const CHAIN = buildChain();
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

function nextDays(n) {
  const out = [];
  const base = new Date(TODAY + "T12:00:00Z");
  for (let i = 0; out.length < n; i += 1) {
    const d = new Date(base.getTime() + i * 86400000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
const EXPIRIES = nextDays(10);

function ttChain(expiration) {
  return {
    data: {
      symbol: "SPX",
      rootSymbol: "SPX",
      underlyingPrice: SPOT,
      items: [
        {
          "expiration-date": expiration,
          strikes: CHAIN.map((r) => ({
            "strike-price": String(r.strike),
            call: {
              "open-interest": r.callOI,
              volume: r.callVolume,
              gamma: r.callGamma,
              delta: r.callDelta,
              theta: -0.42,
              vega: 0.31,
              mark: r.callMark,
              bid: r.callMark - 0.2,
              ask: r.callMark + 0.2,
              "implied-volatility": r.callIV,
            },
            put: {
              "open-interest": r.putOI,
              volume: r.putVolume,
              gamma: r.putGamma,
              delta: r.putDelta,
              theta: -0.4,
              vega: 0.3,
              mark: r.putMark,
              bid: r.putMark - 0.2,
              ask: r.putMark + 0.2,
              "implied-volatility": r.putIV,
            },
          })),
        },
      ],
    },
    context: "rest",
  };
}

function candles() {
  const rows = [];
  const now = Date.now();
  let px = 6180;
  for (let i = 260; i >= 0; i -= 1) {
    const ts = now - i * 5 * 60_000;
    const drift = Math.sin(i / 14) * 3.5 + Math.cos(i / 5) * 1.4;
    const open = px;
    const close = px + drift;
    const high = Math.max(open, close) + Math.abs(drift) * 0.5 + 0.5;
    const low = Math.min(open, close) - Math.abs(drift) * 0.5 - 0.5;
    px = close;
    const d = new Date(ts);
    rows.push({
      timestamp: ts,
      date: d.toISOString().slice(0, 10),
      slotKey: d.toISOString().slice(0, 16),
      symbol: "ESU",
      intervalMinutes: 5,
      open,
      high,
      low,
      close,
      volume: 900 + Math.round(Math.random() * 2400),
    });
  }
  return rows;
}

function calEvents() {
  const days = [TODAY, ...nextDays(4).slice(1)];
  const seed = [
    ["08:30", "8:30 AM", "Core PCE Price Index m/m", "High", "0.3%", "0.2%", "0.3%"],
    ["10:00", "10:00 AM", "ISM Services PMI", "High", "52.4", "51.8", ""],
    ["11:00", "11:00 AM", "Crude Oil Inventories", "Medium", "-1.4M", "2.1M", ""],
    ["14:00", "2:00 PM", "FOMC Meeting Minutes", "High", "", "", ""],
    ["09:15", "9:15 AM", "President delivers remarks on trade", "President", "", "", ""],
    ["16:30", "4:30 PM", "Fed Balance Sheet", "Low", "", "7.1T", ""],
  ];
  const out = [];
  days.forEach((date, di) => {
    seed.slice(0, di === 0 ? 6 : 3).forEach(([time, tf, title, impact, forecast, previous, actual]) => {
      out.push({
        date,
        time,
        time_formatted: tf,
        title,
        country: impact === "President" ? "USD" : "USD",
        impact,
        forecast,
        previous,
        actual: di === 0 ? actual : "",
      });
    });
  });
  return out;
}

const EARNINGS = [
  { date: TODAY, symbol: "AAPL", company: "Apple Inc.", session: "after", market_cap: 3.4e12, eps_est: "2.11" },
  { date: TODAY, symbol: "AMZN", company: "Amazon.com Inc.", session: "after", market_cap: 2.1e12, eps_est: "1.48" },
  { date: TODAY, symbol: "PFE", company: "Pfizer Inc.", session: "pre", market_cap: 1.6e11, eps_est: "0.62" },
  { date: EXPIRIES[1], symbol: "NVDA", company: "NVIDIA Corp.", session: "after", market_cap: 3.9e12, eps_est: "0.94" },
];

const LEVELS = {
  ticker: "SPX",
  label: "S&P 500 Index",
  close: "6,127.80",
  em: "72.40",
  up: "6,200.20",
  down: "6,055.40",
  buy_near: "6,088.00",
  buy_far: "6,055.40",
  sell_near: "6,171.00",
  sell_far: "6,200.20",
  pivot: "6,127.80",
  exp_label: "Aug 8",
  updated_at: new Date().toISOString(),
};

const MIME = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

function json(res, body, status = 200) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(s);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === "/api/auth/me") {
    return json(res, {
      user: { id: "preview-user", email: "preview@local" },
      isSignedIn: true,
      isPaid: true,
      isOwnerClaim: false,
    });
  }
  if (p === "/api/gex") {
    return json(res, {
      chain: CHAIN,
      spotPrice: SPOT,
      prevClose: PREV,
      expiration: EXPIRIES[0],
      expirations: EXPIRIES,
      callWall: 6200,
      putWall: 6050,
      gexFlip: 6120,
      totalNetGex: 1.84e9,
      updatedAt: Date.now(),
      symbol: "$SPX",
    });
  }
  if (p === "/api/gex/expirations") return json(res, { expiry: EXPIRIES[0], expirations: EXPIRIES });
  if (p === "/api/expirations") {
    return json(res, {
      data: {
        symbol: "SPX",
        rootSymbol: "SPX",
        items: EXPIRIES.map((d) => ({ "expiration-date": d, "expiration-type": "Weekly", "root-symbol": "SPX" })),
      },
    });
  }
  if (p === "/api/chains") return json(res, ttChain(url.searchParams.get("expiration") || EXPIRIES[0]));
  if (p === "/api/snapshots/candles") return json(res, { rows: candles() });
  if (p === "/api/levels") return json(res, LEVELS);
  if (p === "/api/em-zones") return json(res, LEVELS);
  if (p === "/api/em/ticker-em-stats") return json(res, { recentAvg: 66.2, midAvg: 61.4, sampleSize: 12 });
  if (p === "/api/em-tracker" && url.searchParams.get("ticker")) {
    return json(res, {
      rows: [
        { week_label: "Jul 28", week_start: "2026-07-28", result: "hit" },
        { week_label: "Jul 21", week_start: "2026-07-21", result: "hit" },
        { week_label: "Jul 14", week_start: "2026-07-14", result: "miss" },
        { week_label: "Jul 7", week_start: "2026-07-07", result: "hit" },
        { week_label: "Jun 30", week_start: "2026-06-30", result: "hit" },
      ],
    });
  }
  if (p === "/api/em-tracker") return json(res, { summary: [{ ticker: "SPX", hits: 21, evaluated: 26 }], rows: [] });
  if (p === "/api/em-tracker/history") return json(res, { tallies: { SPX: { hits: 24, total: 31 } } });
  if (p === "/api/confidence") return json(res, { score: {} });
  if (p === "/api/calendar") return json(res, { events: calEvents(), source: "forexfactory", warning: null });
  if (p === "/api/calendar-quote") return json(res, { quote: null });
  if (p === "/proxy/earnings-week") return json(res, { ok: true, minMcap: 1e11, rows: EARNINGS });
  if (p === "/api/ticker-event") {
    res.writeHead(204);
    return res.end();
  }
  if (p.startsWith("/api/") || p.startsWith("/proxy/")) return json(res, {});

  // Static assets + SPA fallback under /app
  if (p.startsWith("/app")) {
    const rel = p.replace(/^\/app\/?/, "");
    const file = path.join(DIST, rel);
    if (rel && existsSync(file) && statSync(file).isFile()) {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      return res.end(body);
    }
    const html = await readFile(path.join(DIST, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(html);
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => console.log(`mobile preview on http://localhost:${PORT}/app/m/gex`));
