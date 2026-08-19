// ─────────────────────────────────────────────────────────────────────────────
// THE SOCKET.
//
// Exactly one connection for the whole app. It is opened by the inline script
// in index.html — NOT here — so that frames start arriving while the bundle is
// still downloading. This module takes over that already-open socket, drains
// whatever buffered, and owns it from then on.
//
// Topic scoping is DERIVED, never declared. The set of frame types anything is
// subscribed to comes straight out of the store, so a panel cannot go silently
// stale because someone forgot to add its type to a hand-written topics array.
// That was the single most expensive recurring bug in v2.
//
// The connection starts UNSCOPED on purpose. Reconnecting at boot to add a
// ?topics= param would throw away the early-boot head start, which is worth
// far more than the bandwidth. Scoping is applied once the route has settled.
// ─────────────────────────────────────────────────────────────────────────────

import { boot } from '@/boot/types'
import { BROADCAST_ONLY, isFrame } from '@/contract/frames'
import { onActiveTypesChange, seed, write } from './store'
import { persist, restore } from './cache'

const WIDEN_MS = 250 // consumers on one route mount in a cascade; land on ONE connection
const NARROW_MS = 1200 // narrowing is never urgent — never thrash the connection for it
const SETTLE_MS = 1200 // leave the boot connection unscoped until the first route settles

let ws: WebSocket | null = null
let currentTopics: Set<string> | null = null // null = unscoped firehose
let pendingScope: ReturnType<typeof setTimeout> | null = null
let desired: string[] = []
let reconnectAttempt = 0
let started = false
let disposed = false

/** Called once from main.tsx, before the first render. */
export function startSocket(): void {
  if (started) return
  started = true

  const b = boot()

  // 1. Take over the socket the inline script opened.
  if (b.ws && (b.ws.readyState === WebSocket.OPEN || b.ws.readyState === WebSocket.CONNECTING)) {
    adopt(b.ws)
    b.status = 'handoff'
    b.sink = ingest
    const buffered = b.frames.splice(0, b.frames.length)
    for (const raw of buffered) ingest(raw)
  } else {
    connect(null)
  }

  // 2. Paint last-known state underneath whatever is live. seed() never
  //    overwrites a value that already arrived, so this is order-independent.
  void restore().then((cached) => {
    for (const [type, value] of Object.entries(cached)) seed(type, value)
  })

  // 3. React to what the app is actually subscribed to.
  onActiveTypesChange((types) => {
    desired = types.filter((t) => !BROADCAST_ONLY.has(t))
    scheduleScope()
  })

  // Do not scope anything until the first route has finished mounting.
  setTimeout(scheduleScope, SETTLE_MS)
}

function adopt(sock: WebSocket): void {
  ws = sock
  sock.onmessage = (ev) => ingest(ev.data)
  sock.onclose = handleClose
  sock.onerror = () => {}
  sock.onopen = () => {
    reconnectAttempt = 0
  }
}

function ingest(raw: unknown): void {
  // Keep stamping the first-frame time after handoff. The inline script stops
  // seeing messages the moment we adopt the socket, so if this is missing the
  // single most important metric in the app silently reads null.
  const b = boot()
  if (b.firstFrameAt === null) b.firstFrameAt = performance.now()

  if (typeof raw !== 'string') return
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return // a malformed frame is not worth a thrown error in the hot path
  }
  if (!isFrame(parsed)) return
  write(parsed.type, parsed)
  persist(parsed.type, parsed)
}

// ── Scope management ─────────────────────────────────────────────────────────

function scheduleScope(): void {
  if (disposed) return
  const next = new Set(desired)

  if (next.size === 0) return // nothing mounted — stay on the firehose
  if (currentTopics && sameSet(next, currentTopics)) return

  // Widening (we need frames we are not receiving) is urgent. Narrowing is a
  // pure bandwidth optimisation and can wait.
  const widening = currentTopics === null ? false : !isSubset(next, currentTopics)
  const delay = widening ? WIDEN_MS : NARROW_MS

  if (pendingScope) clearTimeout(pendingScope)
  pendingScope = setTimeout(() => {
    pendingScope = null
    applyScope(new Set(desired.filter((t) => !BROADCAST_ONLY.has(t))))
  }, delay)
}

function applyScope(topics: Set<string>): void {
  if (topics.size === 0) return
  if (currentTopics && sameSet(topics, currentTopics)) return
  currentTopics = topics
  connect(topics)
}

// ── Connection ───────────────────────────────────────────────────────────────

function socketUrl(topics: Set<string> | null): string {
  // Same-origin, always — matching the inline boot script in index.html. The
  // dev proxy forwards /ws to VITE_BACKEND_ORIGIN, so there is never a reason
  // to hardcode a host here.
  const base = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/gex`
  if (!topics || topics.size === 0) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}topics=${encodeURIComponent(Array.from(topics).sort().join(','))}`
}

function connect(topics: Set<string> | null): void {
  if (disposed) return
  const next = new WebSocket(socketUrl(topics))
  const old = ws
  next.onopen = () => {
    reconnectAttempt = 0
    // Swap only once the replacement is actually open, so there is no window
    // with no connection at all.
    if (old && old !== next) {
      old.onclose = null
      old.onmessage = null
      try {
        old.close()
      } catch {
        /* already gone */
      }
    }
    adopt(next)
  }
  next.onmessage = (ev) => ingest(ev.data)
  next.onclose = () => {
    if (ws === next || ws === null) handleClose()
  }
  next.onerror = () => {}
}

function handleClose(): void {
  if (disposed) return
  ws = null
  reconnectAttempt++
  // 500ms, 1s, 2s, 4s, capped at 10s. Jittered so a server restart does not
  // bring every open tab back in the same millisecond.
  const backoff = Math.min(10_000, 500 * 2 ** Math.min(reconnectAttempt - 1, 4))
  const jitter = backoff * 0.25 * Math.random()
  setTimeout(() => connect(currentTopics), backoff + jitter)
}

export function socketState(): { ready: number; topics: string[] | null; attempts: number } {
  return {
    ready: ws ? ws.readyState : WebSocket.CLOSED,
    topics: currentTopics ? Array.from(currentTopics).sort() : null,
    attempts: reconnectAttempt,
  }
}

export function stopSocket(): void {
  disposed = true
  if (pendingScope) clearTimeout(pendingScope)
  try {
    ws?.close()
  } catch {
    /* already gone */
  }
  ws = null
}

// ── set helpers ──────────────────────────────────────────────────────────────

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (!b.has(v)) return false
  return true
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && isSubset(a, b)
}
