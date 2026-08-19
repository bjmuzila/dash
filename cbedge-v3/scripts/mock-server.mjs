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

const server = createServer((req, res) => {
  let path = (req.url || '/').split('?')[0]

  // Introspection endpoint used by scripts/ws-scope-check.mjs. Lets a test
  // assert what scope the app actually asked for, rather than guessing.
  if (path === '/__connections') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(connectionLog))
  }

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

// ── Synthetic data ───────────────────────────────────────────────────────────

let spot = 6400
setInterval(() => {
  spot += (Math.random() - 0.5) * 1.4
  broadcast({ type: 'spot', ts: Date.now(), symbol: 'SPX', last: Number(spot.toFixed(2)) })
}, 250)

setInterval(() => {
  broadcast({ type: 'aux', ts: Date.now(), vix: Number((14 + Math.random()).toFixed(2)) })
}, 2000)

setInterval(() => {
  broadcast({ type: 'status', ts: Date.now(), session: 'RTH', feed: 'mock' })
}, 5000)

server.listen(PORT, () => {
  console.log(`\n  mock backend  →  http://localhost:${PORT}/v3/`)
  console.log(`  ws            →  ws://localhost:${PORT}/ws/gex\n`)
})
