#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Offline preview. Serves dist/ at /v3, answers the REST endpoints the board's
// cards call, and pushes synthetic frames on /ws/gex — so the built app can be
// opened and profiled with no backend, no VPN, no VPS.
//
//   npm run build:fast && node scripts/mock-server.mjs 4310
//
// It also mirrors server-v2's topic filtering (?topics=a,b) — including the
// part that trips people up: scalar frames like `spot` are dropped too unless
// they are named. If v3's topic derivation ever regresses, this catches it
// locally instead of on the live site.
//
// ── KEEP THIS IN SYNC WITH src/board/catalog.tsx ────────────────────────────
// Every endpoint a card fetches needs a case in `api()` below. An endpoint that
// is missing does NOT fail loudly: the request falls through to the static
// handler, gets index.html back, and the card's `res.json()` throws a parse
// error into a caught promise. The card renders empty and nothing says why.
// That is exactly what happened when the cards were rebuilt on 2026-08-27 and
// this file still described the previous three endpoints. The unknown-route
// 404 at the bottom of api() exists so the next drift is visible in devtools
// instead of silent.
//
// Zero dependencies: raw http + a minimal RFC6455 server.
// ─────────────────────────────────────────────────────────────────────────────

import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = join(ROOT, 'dist')
const PORT = Number(process.argv[2] || 4310)

if (!existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build:fast` first')
  process.exit(1)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
}

/** Every socket connection this process has seen, in order, with its scope. */
const connectionLog = []

// ── Synthetic market ─────────────────────────────────────────────────────────
// One price universe shared by the candles, the chain and the GEX history, so
// the bubbles land on the candles instead of a thousand points above them —
// which is the whole thing the overlay is being previewed for.

const UNIVERSE = {
  SPX: { price: 6800, step: 5 },
  SPY: { price: 680, step: 1 },
  QQQ: { price: 600, step: 1 },
  NDX: { price: 25000, step: 25 },
  VIX: { price: 15, step: 0.5 },
  AAPL: { price: 232, step: 2.5 },
  AMD: { price: 168, step: 2.5 },
  AMZN: { price: 214, step: 2.5 },
  GOOGL: { price: 196, step: 2.5 },
  META: { price: 612, step: 5 },
  MSFT: { price: 428, step: 5 },
  NVDA: { price: 142, step: 1 },
  SPCX: { price: 32, step: 1 },
  TSLA: { price: 348, step: 5 },
  IWM: { price: 232, step: 1 },
}

/** `$SPX` and `SPX` are the same underlying to everything below. */
function universe(symbol) {
  const key = String(symbol || 'SPX').replace(/^[$/]/, '').toUpperCase()
  return UNIVERSE[key] ?? { price: 200, step: 1 }
}

const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const ET_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const ET_TIME_12 = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

const etDate = (ms) => ET_DATE.format(new Date(ms))
const etTime = (ms) => ET_TIME.format(new Date(ms))

function json(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

// ── REST ─────────────────────────────────────────────────────────────────────

/** /api/snapshots/etf-candles — the ONLY candle route v3 uses. */
function mockCandles(symbol, days, interval) {
  const { price: base } = universe(symbol)
  const stepMs = interval * 60_000
  const bars = Math.min(2000, Math.round((days * 6.5 * 60) / interval))
  const now = Math.floor(Date.now() / stepMs) * stepMs
  let price = base
  const rows = []
  for (let i = bars - 1; i >= 0; i--) {
    const t = now - i * stepMs
    const o = price
    const c = o + (Math.random() - 0.5) * (base * 0.0009)
    const h = Math.max(o, c) + Math.random() * (base * 0.0004)
    const l = Math.min(o, c) - Math.random() * (base * 0.0004)
    rows.push({
      timestamp: t,
      date: etDate(t),
      slotKey: `${etDate(t)}T${etTime(t)}`,
      time: `${etTime(t)}:00`,
      symbol,
      intervalMinutes: interval,
      source: 'mock',
      open: Number(o.toFixed(2)),
      high: Number(h.toFixed(2)),
      low: Number(l.toFixed(2)),
      close: Number(c.toFixed(2)),
      volume: Math.round(500 + Math.random() * 2000),
    })
    price = c
  }
  return { symbol, interval, days, source: 'mock', rows }
}

/** /api/expirations — note the `{ data: { items } }` envelope and hyphenated keys. */
function mockExpirations(ticker) {
  const day = 86_400_000
  const now = Date.now()
  const items = [0, 1, 2, 4, 7].map((d) => ({
    'expiration-date': etDate(now + d * day),
    'expiration-type': 'Weekly',
    'root-symbol': ticker,
  }))
  return { data: { items, symbol: ticker, rootSymbol: ticker } }
}

/** A GEX ladder centred on spot, stable across a session so walls hold still. */
function ladder(symbol, spot, count = 24) {
  const { step } = universe(symbol)
  const mid = Math.round(spot / step) * step
  const half = Math.floor(count / 2)
  return Array.from({ length: count }, (_, i) => {
    const strike = mid + (i - half) * step
    // A rough skew: puts heavy below spot, calls heavy above, biggest node a
    // little out of the money on each side.
    const dist = (strike - mid) / (step * half)
    const shape = Math.exp(-Math.pow(Math.abs(dist) - 0.45, 2) * 6)
    const sign = strike >= mid ? 1 : -1
    return { strike, value: sign * shape * 2e9 * (0.75 + Math.random() * 0.5) }
  })
}

/** /api/snapshots/option-strike-gex-history?mode=heatmap — the bubble source. */
function mockGexHistory(symbol, minutes) {
  const spot = universe(symbol).price
  const now = Math.floor(Date.now() / 60_000) * 60_000
  const span = Math.min(minutes, 480)
  const columns = []
  // One column a minute is what the real recorder writes; sample every 5 so a
  // preview does not build 480 columns it will never draw distinctly.
  for (let m = span; m >= 0; m -= 5) {
    const slotTs = now - m * 60_000
    const rows = ladder(symbol, spot)
    const cells = rows.map((r) => ({
      strike: r.strike,
      net: Math.round(r.value),
      netVol: Math.round(r.value * 0.4),
    }))
    const abs = cells.map((c) => Math.abs(c.net)).sort((a, b) => b - a)
    columns.push({
      slotTs,
      cells,
      max: abs[0] ?? 0,
      top3: abs.slice(0, 3),
      spot,
      flip: Math.round(spot / universe(symbol).step) * universe(symbol).step,
      flipVol: null,
    })
  }
  return { mode: 'heatmap', symbol, columns }
}

/** /api/chains — Multi Greek's source. Hyphenated keys, strike-price a STRING. */
function mockChain(ticker) {
  const { price: spot, step } = universe(ticker)
  const day = 86_400_000
  const now = Date.now()
  const items = [0, 1, 2, 4].map((d) => {
    // 81 rungs so the chain-derived GEX ladder (chainGex.ts, which every
    // non-SPX card reads) is wide enough to pan and zoom, same reason as the
    // socket ladder below.
    const rows = ladder(ticker, spot, 81)
    return {
      'expiration-date': etDate(now + d * day),
      strikes: rows.map((r) => {
        const leg = (bias) => ({
          symbol: `${ticker}${r.strike}`,
          'streamer-symbol': `.${ticker}${r.strike}`,
          'open-interest': Math.round(Math.random() * 30000 * bias),
          volume: Math.round(Math.random() * 20000 * bias),
          delta: 0.5,
          gamma: Number((0.0002 + Math.random() * 0.002).toFixed(6)),
          theta: -1,
          vega: 0.4,
          'implied-volatility': 0.13,
          bid: 1,
          ask: 1.2,
          mark: 1.1,
        })
        return {
          'strike-price': String(r.strike),
          call: leg(r.strike >= spot ? 1.4 : 0.6),
          put: leg(r.strike <= spot ? 1.4 : 0.6),
        }
      }),
    }
  })
  return { context: 'mock', data: { items, underlyingPrice: spot, rootSymbol: ticker, symbol: ticker } }
}

/**
 * /api/mult-greek-gex-change — the click card's Δ 5/15/30m and Δ Open.
 *
 * The real route reads the recorder's ring buffer; the client diffs its LIVE
 * value against these, so the mock returns values a little OFF the live one and
 * leaves `vOpen` null — that is the shape the card's "building…" branch has to
 * handle, and a mock where every field is populated never exercises it.
 */
function mockGexChange(ticker, strike) {
  const { price: spot } = universe(ticker === 'SPX' ? '$SPX' : ticker)
  const base = ladder(ticker === 'SPX' ? '$SPX' : ticker, spot, 24).find((r) => Math.abs(r.strike - strike) < 0.001)
  const now = base ? base.value : 0
  return {
    data: {
      vNow: Math.round(now),
      v5: Math.round(now * 0.97),
      v15: Math.round(now * 0.92),
      v30: Math.round(now * 0.8),
      vOpen: null,
    },
  }
}

/**
 * /api/em-tracker — this week's estimated-move band, for the Key Levels axis.
 *
 * The real route is Postgres and owner-gated; the shape is what matters here:
 * newest week first, `up` / `down` as PRICES. Struck deliberately INSIDE the
 * gamma levels so the card's "too far away, do not draw it" branch is not the
 * one that always runs in the mock.
 */
function mockEmTracker(ticker) {
  const { price: spot } = universe(ticker === 'SPX' ? '$SPX' : ticker)
  // 0.4%: with the mock ladder that puts the LOW inside the gamma levels and the
  // HIGH outside, so both sides of the card's "too far away" test get exercised
  // every time the mock is opened rather than only when the numbers happen to
  // line up.
  const em = spot * 0.004
  const monday = etDate(Date.now() - 86_400_000 * 3)
  return {
    rows: [
      {
        ticker,
        week_label: monday.slice(5),
        week_start: monday,
        em: Number(em.toFixed(2)),
        ref_close: Number(spot.toFixed(2)),
        up: Number((spot + em).toFixed(2)),
        down: Number((spot - em).toFixed(2)),
        result: null,
      },
    ],
  }
}

/** /api/premarket-baseline — the Key Levels "was → now" lines. */
function mockBaseline(symbol, expiry) {
  const { price: spot, step } = universe(symbol)
  const byStrike = {}
  for (const r of ladder(symbol, spot, 24)) byStrike[String(r.strike)] = Math.round(r.value * 0.85)
  const strikes = Object.keys(byStrike).map(Number)
  return {
    ok: true,
    date: etDate(Date.now() - 86_400_000),
    expiry,
    basis: 'oi',
    spot: Number((spot * 0.997).toFixed(2)),
    netGex: Object.values(byStrike).reduce((s, v) => s + v, 0),
    flip: Math.round((spot * 0.998) / step) * step,
    callWall: Math.round((spot * 1.01) / step) * step,
    putWall: Math.round((spot * 0.99) / step) * step,
    strikes,
    byStrike,
  }
}

/** /api/calendar — ForexFactory-shaped. */
function mockCalendar() {
  const now = Date.now()
  const mk = (dayOffset, time, title, impact, country = 'USD') => {
    const at = now + dayOffset * 86_400_000
    return {
      date: etDate(at),
      time,
      time_formatted: ET_TIME_12.format(new Date(`${etDate(at)}T${time}:00`)),
      title,
      country,
      impact,
      forecast: impact === 'High' ? '0.3%' : '',
      previous: impact === 'High' ? '0.2%' : '',
      actual: '',
    }
  }
  return {
    source: 'mock',
    events: [
      mk(0, '08:30', 'CPI m/m (mock)', 'High'),
      mk(0, '10:00', 'Fed speak (mock)', 'Medium'),
      mk(0, '14:00', 'FOMC minutes (mock)', 'High'),
      mk(1, '08:30', 'Initial jobless claims (mock)', 'Medium'),
      mk(2, '10:00', 'Consumer sentiment (mock)', 'Low'),
      mk(1, '11:00', 'President remarks (mock)', 'President'),
    ],
  }
}

/** /proxy/earnings-week */
function mockEarnings() {
  const now = Date.now()
  return {
    ok: true,
    minMcap: 25e9,
    rows: [
      { date: etDate(now), symbol: 'NVDA', company: 'NVIDIA Corp (mock)', session: 'after', market_cap: 3.4e12, eps_est: '0.81' },
      { date: etDate(now), symbol: 'CRM', company: 'Salesforce Inc (mock)', session: 'after', market_cap: 2.6e11, eps_est: '2.44' },
      { date: etDate(now + 86_400_000), symbol: 'COST', company: 'Costco (mock)', session: 'pre', market_cap: 4.1e11, eps_est: '3.79' },
    ],
  }
}

/**
 * Returns true when it handled the request. Unknown /api/* and /proxy/* paths
 * get an explicit 404 JSON rather than falling through to index.html — see the
 * note at the top of this file about why a silent HTML fallback is worse than
 * an error.
 */
function api(req, res, path, params) {
  if (path === '/__connections') return json(res, connectionLog), true

  if (path === '/api/snapshots/etf-candles') {
    const symbol = (params.get('symbol') || 'SPX').toUpperCase()
    const days = Math.min(30, Math.max(1, Number(params.get('days') || 5)))
    const interval = params.get('interval') === '1' ? 1 : 5
    return json(res, mockCandles(symbol, days, interval)), true
  }
  if (path === '/api/snapshots/option-strike-gex-history') {
    const symbol = params.get('symbol') || '$SPX'
    const minutes = Math.max(0, Number(params.get('minutes') || 720))
    return json(res, mockGexHistory(symbol, minutes)), true
  }
  if (path === '/api/expirations') {
    return json(res, mockExpirations((params.get('ticker') || 'SPX').toUpperCase())), true
  }
  if (path === '/api/chains') {
    return json(res, mockChain((params.get('ticker') || 'SPX').toUpperCase())), true
  }
  if (path === '/api/mult-greek-gex-change') {
    return json(res, mockGexChange((params.get('ticker') || 'SPX').toUpperCase(), Number(params.get('strike')))), true
  }
  if (path === '/api/em-tracker') {
    return json(res, mockEmTracker((params.get('ticker') || 'SPX').toUpperCase())), true
  }
  if (path === '/api/premarket-baseline') {
    return json(res, mockBaseline(params.get('symbol') || '$SPX', params.get('expiry') || '')), true
  }
  if (path === '/api/calendar') return json(res, mockCalendar()), true
  if (path === '/proxy/earnings-week') return json(res, mockEarnings()), true
  if (path === '/api/es-candles/tickers') {
    const tickers = Object.keys(UNIVERSE)
    return json(res, { ok: true, count: tickers.length, source: 'mock', tickers }), true
  }

  if (path.startsWith('/api/') || path.startsWith('/proxy/')) {
    console.log(`  404 ${path}   ← no mock for this endpoint (see the header note)`)
    return json(res, { error: 'no mock for this endpoint', path }, 404), true
  }
  return false
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://x')
    let path = url.pathname

    if (api(req, res, path, url.searchParams)) return

    if (path.startsWith('/v3')) path = path.slice(3) || '/'

    let file = join(DIST, path === '/' ? 'index.html' : path.replace(/^\//, ''))
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')

    const ext = extname(file)
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      // Mirror what production should send: hashed assets immutable, html never.
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
    res.end(readFileSync(file))
  } catch (err) {
    // A throw in here would otherwise take the whole process down mid-run, and
    // scripts/ws-scope-check.mjs would report it as an unexplained ECONNREFUSED
    // several seconds later rather than as the request that actually failed.
    console.error(`  500 ${req.url} — ${err?.message ?? err}`)
    try {
      json(res, { error: String(err?.message ?? err) }, 500)
    } catch {
      /* response already sent */
    }
  }
})

// A malformed request (or a client that vanishes mid-handshake) emits
// 'clientError' on the SERVER, not on any request — unhandled, it is fatal.
server.on('clientError', (_err, socket) => {
  try {
    socket.destroy()
  } catch {
    /* already gone */
  }
})

// ── Minimal WebSocket ────────────────────────────────────────────────────────

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const clients = new Set()

server.on('upgrade', (req, socket) => {
  socket.on('error', () => {
    for (const c of clients) if (c.socket === socket) clients.delete(c)
  })

  const key = req.headers['sec-websocket-key']
  if (!key) return socket.destroy()

  const accept = createHash('sha1').update(key + GUID).digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )

  const url = new URL(req.url || '/', 'http://x')
  const raw = url.searchParams.get('topics')
  // null = unscoped firehose, exactly like the real server.
  const topics = raw ? new Set(raw.split(',').filter(Boolean)) : null
  const client = { socket, topics }
  clients.add(client)
  connectionLog.push({ at: Date.now(), topics: topics ? [...topics].sort() : null })

  console.log(`  ws connect  topics=${topics ? [...topics].join(',') : 'ALL'}`)

  socket.on('close', () => clients.delete(client))
  // We never read from the client; drain so the socket does not stall.
  socket.on('data', () => {})
})

function encode(str) {
  const payload = Buffer.from(str)
  const len = payload.length
  let header
  if (len < 126) {
    header = Buffer.alloc(2)
    header[1] = len
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  header[0] = 0x81 // FIN + text
  return Buffer.concat([header, payload])
}

function broadcast(frame) {
  const buf = encode(JSON.stringify(frame))
  for (const c of clients) {
    // The bit people forget: scalar frames are dropped by scope too.
    if (c.topics && !c.topics.has(frame.type)) continue
    try {
      c.socket.write(buf)
    } catch {
      clients.delete(c)
    }
  }
}

// ── Synthetic data — WS frame shapes match the real envelope msg() builds in
// server-v2/websocket-server.js: { type, symbol, ts, data }. See
// src/contract/frames.ts for the transcribed field lists. ──────────────────

let spot = UNIVERSE.SPX.price
const prevClose = spot
const expiry = etDate(Date.now())

setInterval(() => {
  spot += (Math.random() - 0.5) * 1.4
  broadcast({
    type: 'spot',
    symbol: 'SPX',
    ts: Date.now(),
    data: { spot: Number(spot.toFixed(2)), prevClose, basis: Number((spot - prevClose).toFixed(2)) },
  })
}, 250)

setInterval(() => {
  broadcast({
    type: 'aux',
    ts: Date.now(),
    data: {
      vix: Number((14 + Math.random()).toFixed(2)),
      esFut: Number((spot + 45).toFixed(2)),
      basis: 45,
      vixPrevClose: 14.5,
      esFutPrevClose: prevClose + 45,
      spotDisplay: Number(spot.toFixed(2)),
    },
  })
}, 2000)

setInterval(() => {
  broadcast({ type: 'status', ts: Date.now(), session: 'RTH', feed: 'mock' })
}, 5000)

// gex — a ladder around spot, shaped like a real skew so the walls hold still
// instead of jumping to a different strike every second.
//
// 121 strikes, not the 24 the default gives: the GEX Chart card opens on a
// ~$200 window and will not zoom below MIN_COUNT=30, so a 24-rung ladder pins
// its viewport and makes pan and zoom untestable against the mock — which is
// the one thing the mock exists to prevent (see the header note).
setInterval(() => {
  const rows = ladder('SPX', spot, 121)
  const gexRows = rows.map((r) => ({
    strike: r.strike,
    netGEX: Math.round(r.value),
    netVolGEX: Math.round(r.value * 0.4),
    callGEX: Math.round(Math.max(0, r.value)),
    putGEX: Math.round(Math.min(0, r.value)),
    callOI: Math.round(Math.random() * 40000),
    putOI: Math.round(Math.random() * 40000),
    callVolume: Math.round(Math.random() * 20000),
    putVolume: Math.round(Math.random() * 20000),
    callGamma: 0.0012,
    putGamma: 0.0011,
    dte: 0,
  }))
  const byAbs = [...gexRows].sort((a, b) => Math.abs(b.netGEX) - Math.abs(a.netGEX))
  broadcast({
    type: 'gex',
    symbol: 'SPX',
    ts: Date.now(),
    data: {
      gexRows,
      callWall: byAbs.find((r) => r.netGEX > 0)?.strike ?? null,
      putWall: byAbs.find((r) => r.netGEX < 0)?.strike ?? null,
      gexFlip: Math.round(spot / UNIVERSE.SPX.step) * UNIVERSE.SPX.step,
      totalNetGex: gexRows.reduce((s, r) => s + r.netGEX, 0),
      totals: {},
      expiry,
      updatedAt: Date.now(),
    },
  })
}, 1000)

// flow — a rolling net-premium tape, mock sweeps/blocks.
setInterval(() => {
  const callBuyVol = Math.round(Math.random() * 5000)
  const callSellVol = Math.round(Math.random() * 5000)
  const putBuyVol = Math.round(Math.random() * 5000)
  const putSellVol = Math.round(Math.random() * 5000)
  const netPremium = Math.round((Math.random() - 0.45) * 3_000_000)
  const tape = Array.from({ length: 5 }, (_, i) => ({
    ts: Date.now() - i * 4000,
    underlying: 'SPX',
    expiration: '0DTE',
    strike: Math.round(spot / 5) * 5 + (Math.random() > 0.5 ? 25 : -25),
    type: Math.random() > 0.5 ? 'call' : 'put',
    side: Math.random() > 0.5 ? 'ask' : 'bid',
    action: 'sweep',
    bucket: '0DTE',
    price: Number((Math.random() * 5 + 1).toFixed(2)),
    size: Math.round(50 + Math.random() * 500),
    premium: Math.round(50_000 + Math.random() * 2_000_000),
    isOtm: true,
  }))
  broadcast({
    type: 'flow',
    symbol: 'SPX',
    ts: Date.now(),
    data: {
      symbol: 'SPX',
      windowMs: 300_000,
      asOf: Date.now(),
      callBuyVol,
      callSellVol,
      putBuyVol,
      putSellVol,
      netPremium,
      buyPct: (callBuyVol + putBuyVol) / Math.max(1, callBuyVol + callSellVol + putBuyVol + putSellVol),
      prints: tape.length,
      tape,
    },
  })
}, 3000)

// A crash here is what surfaces downstream as an unexplained ECONNREFUSED in
// scripts/ws-scope-check.mjs, several seconds after the fact. Log and stay up.
process.on('uncaughtException', (err) => {
  console.error(`  mock server uncaught: ${err?.stack ?? err}`)
})
process.on('unhandledRejection', (err) => {
  console.error(`  mock server unhandled rejection: ${err}`)
})

server.listen(PORT, () => {
  console.log(`\n  mock backend  →  http://localhost:${PORT}/v3/`)
  console.log(`  ws            →  ws://localhost:${PORT}/ws/gex\n`)
})
