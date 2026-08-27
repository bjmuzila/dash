#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Offline preview. Serves dist/ at /v3 and pushes synthetic frames on /ws/gex,
// so the built app can be opened and profiled with no backend, no VPN, no VPS.
//
//   npm run build:fast && node scripts/mock-server.mjs 4310
//
// It also mirrors server-v2's topic filtering (?topics=a,b) — including the
// part that trips people up: scalar frames like `spot` are dropped too unless
// they are named. If v3's topic derivation ever regresses, this catches it
// locally instead of on the live site.
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

// ── Synthetic REST — the three endpoints the board's cards actually call
// (src/board/catalog.tsx). Shapes are transcribed from the real server-v2 /
// Next.js routes (see src/contract/frames.ts's header comment for where), not
// guessed, so `npm run mock` exercises the same code paths a real backend
// would. ──
function json(res, body) {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const CANDLE_BASE = { ES: 5820, NQ: 20400 }

function mockCandles(symbol) {
  const base = CANDLE_BASE[symbol] ?? 5000
  const n = 78 // one RTH session at 5m bars
  const now = Date.now()
  let price = base
  const rows = []
  for (let i = n - 1; i >= 0; i--) {
    const o = price
    const c = o + (Math.random() - 0.5) * (base * 0.0009)
    const h = Math.max(o, c) + Math.random() * (base * 0.0004)
    const l = Math.min(o, c) - Math.random() * (base * 0.0004)
    rows.push({ timestamp: now - i * 5 * 60_000, open: o, high: h, low: l, close: c, volume: Math.round(500 + Math.random() * 2000) })
    price = c
  }
  return { rows }
}

function mockCalendar() {
  return {
    events: [
      { time: '08:30', title: 'CPI m/m (mock)', impact: 'High' },
      { time: '10:00', title: 'Fed speak (mock)', impact: 'Med' },
      { time: '14:00', title: 'FOMC minutes (mock)', impact: 'High' },
    ],
  }
}

function mockEarnings() {
  return {
    earnings: [
      { symbol: 'NVDA', company: 'NVIDIA Corp (mock)', callTime: '16:05' },
      { symbol: 'CRM', company: 'Salesforce Inc (mock)', callTime: '16:10' },
    ],
  }
}

const server = createServer((req, res) => {
  let path = (req.url || '/').split('?')[0]

  // Introspection endpoint used by scripts/ws-scope-check.mjs. Lets a test
  // assert what scope the app actually asked for, rather than guessing.
  if (path === '/__connections') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(connectionLog))
  }

  if (path === '/api/snapshots/candles') {
    const symbol = new URL(req.url, 'http://x').searchParams.get('symbol') || 'ES'
    return json(res, mockCandles(symbol))
  }
  if (path === '/api/calendar') return json(res, mockCalendar())
  if (path === '/api/earnings-today') return json(res, mockEarnings())

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
})

// ── Minimal WebSocket ────────────────────────────────────────────────────────

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const clients = new Set()

server.on('upgrade', (req, socket) => {
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
  socket.on('error', () => clients.delete(client))
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

let spot = 5820
const prevClose = spot
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
  broadcast({ type: 'aux', ts: Date.now(), vix: Number((14 + Math.random()).toFixed(2)) })
}, 2000)

setInterval(() => {
  broadcast({ type: 'status', ts: Date.now(), session: 'RTH', feed: 'mock' })
}, 5000)

// gex — 20 strikes around spot, net GEX alternating sign like a real skew.
setInterval(() => {
  const strikes = Array.from({ length: 20 }, (_, i) => Math.round((spot - 190 + i * 20) / 5) * 5)
  const gexRows = strikes.map((strike) => ({
    strike,
    netGEX: Math.round((Math.random() - 0.5) * 2 * 1e9),
    callGEX: Math.round(Math.random() * 1e9),
    putGEX: Math.round(-Math.random() * 1e9),
    callOI: Math.round(Math.random() * 40000),
    putOI: Math.round(Math.random() * 40000),
    dte: 0,
  }))
  const byAbs = [...gexRows].sort((a, b) => Math.abs(b.netGEX) - Math.abs(a.netGEX))
  const callWall = byAbs.find((r) => r.netGEX > 0)?.strike ?? null
  const putWall = byAbs.find((r) => r.netGEX < 0)?.strike ?? null
  broadcast({
    type: 'gex',
    symbol: 'SPX',
    ts: Date.now(),
    data: {
      gexRows,
      callWall,
      putWall,
      gexFlip: strikes[Math.floor(strikes.length / 2)],
      totalNetGex: gexRows.reduce((s, r) => s + r.netGEX, 0),
      totals: {},
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

server.listen(PORT, () => {
  console.log(`\n  mock backend  →  http://localhost:${PORT}/v3/`)
  console.log(`  ws            →  ws://localhost:${PORT}/ws/gex\n`)
})
