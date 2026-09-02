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
/**
 * How long a connection has to SURVIVE before its predecessors are forgiven.
 *
 * The backoff used to reset in `onopen`, which sounds right and is not: a
 * successful handshake says nothing about whether the connection is usable. A
 * socket that is accepted and then dies a hundred milliseconds later reset the
 * counter every single time, so the "exponential" backoff never advanced past
 * its first step and the app reopened /ws/gex roughly every 700ms — forty-five
 * connections inside thirty-four seconds, which is what sent us looking. A
 * connection now has to stay open this long before it counts as good.
 */
const STABLE_MS = 5000

let ws: WebSocket | null = null
let currentTopics: Set<string> | null = null // null = unscoped firehose
let pendingScope: ReturnType<typeof setTimeout> | null = null
let desired: string[] = []
let reconnectAttempt = 0
let started = false
let disposed = false

/**
 * Which connection attempt is the CURRENT one.
 *
 * Every `connect()` takes the next number, and every handler it installs closes
 * over that number — so a socket can ask "am I still the one?" instead of
 * inferring it by comparing against `ws`, which is a moving target between the
 * moment `connect()` runs and the moment the handshake completes.
 *
 * That inference is what multiplied the connections. `connect()` captured
 * `const old = ws` at CALL time and closed it in `onopen`; if `ws` had moved on
 * in between — a scope change racing a server-side close — the socket that was
 * actually live never got closed. It stayed open, still wearing `handleClose`,
 * and fired a fresh reconnect when it eventually died, while a good connection
 * was already running. Every orphan bred another orphan.
 *
 * With an epoch there is no inference: a superseded socket closes itself and is
 * ignored, and exactly one connection can ever be adopted.
 */
let epoch = 0
/** Reset the moment the live socket changes — see STABLE_MS. */
let stableTimer: ReturnType<typeof setTimeout> | null = null
/** The connection being opened, if any. At most one is ever in flight. */
let pendingWs: WebSocket | null = null

/** Called once from main.tsx, before the first render. */
export function startSocket(): void {
  if (started) return
  started = true

  const b = boot()

  // 1. Take over the socket the inline script opened.
  if (b.ws && (b.ws.readyState === WebSocket.OPEN || b.ws.readyState === WebSocket.CONNECTING)) {
    adopt(b.ws, ++epoch)
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

/**
 * Take ownership of a socket: this one, and only this one, is now THE
 * connection. `myEpoch` is what the close handler checks — a socket that has
 * been superseded must not drag the app into a reconnect on its way out.
 */
function adopt(sock: WebSocket, myEpoch: number): void {
  ws = sock
  if (pendingWs === sock) pendingWs = null
  sock.onmessage = (ev) => ingest(ev.data)
  sock.onclose = () => {
    if (myEpoch !== epoch) return
    handleClose()
  }
  sock.onerror = () => {}
  sock.onopen = () => flushSend()
  markStable()
  // The handshake may already have completed (this is the normal path out of
  // connect()), in which case the onopen above will never fire. Flush anyway.
  flushSend()
}

/**
 * Start the clock on "this connection is actually working".
 *
 * Only a connection that survives STABLE_MS clears the backoff. See the comment
 * on that constant: resetting on `onopen` is what turned a flapping server into
 * a connection every 700ms for as long as the tab was open.
 */
function markStable(): void {
  if (stableTimer) clearTimeout(stableTimer)
  stableTimer = setTimeout(() => {
    stableTimer = null
    reconnectAttempt = 0
  }, STABLE_MS)
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
  if (parsed.type === 'snapshot') fanOutSnapshot(parsed)
  write(parsed.type, parsed)
  persist(parsed.type, parsed)
}

/**
 * The connect SNAPSHOT is every frame at once, sent as one message the moment a
 * client connects — and until this existed, nothing in v3 read it.
 *
 * That is not a missed optimisation, it is the difference between a panel
 * working and not. server-v2 DEDUPES AND THROTTLES the `gex` frame: an
 * unchanged chain — overnight, a quiet tape, any pause between recomputes —
 * broadcasts nothing at all, by design (it is ~100KB a go). A card that listens
 * only for `gex` then sits on "Waiting for the feed…" indefinitely while the
 * socket has already handed it the whole ladder in the snapshot.
 *
 * Every reconnect replays the snapshot, so this is also what refills a panel
 * after the topic scope changes and the replay cache is dropped.
 *
 * A scoped snapshot has its heavy arrays stripped (gexRows becomes undefined),
 * which is why every field is checked before it is fanned out rather than
 * written through blindly — the shapes below are transcribed from
 * buildSnapshot() and the msg() calls in server-v2/websocket-server.js.
 */
function fanOutSnapshot(frame: { symbol?: string; ts?: number; data?: unknown }): void {
  const d = frame.data as Record<string, unknown> | undefined
  if (!d || typeof d !== 'object') return

  const put = (type: string, data: unknown) => {
    const synthetic = { type, symbol: frame.symbol, ts: frame.ts, data }
    write(type, synthetic)
    persist(type, synthetic)
  }

  if (Array.isArray(d.gexRows) && d.gexRows.length) {
    put('gex', {
      gexRows: d.gexRows,
      totals: d.totals,
      callWall: d.callWall,
      putWall: d.putWall,
      gexFlip: d.gexFlip,
      totalNetGex: d.totalNetGex,
      expiry: d.expiry,
      updatedAt: d.updatedAt,
    })
  }
  if (typeof d.spot === 'number' && d.spot > 0) {
    put('spot', { spot: d.spot, prevClose: d.prevClose, basis: d.basis })
  }
  if (typeof d.vix === 'number' || typeof d.esFut === 'number') {
    put('aux', {
      vix: d.vix,
      esFut: d.esFut,
      basis: d.basis,
      vixPrevClose: d.vixPrevClose,
      esFutPrevClose: d.esFutPrevClose,
      spotDisplay: d.spotDisplay,
    })
  }
  if (d.status && typeof d.status === 'object') {
    put('status', { ...(d.status as Record<string, unknown>), expirations: d.expirations, expiry: d.expiry })
  }
  if (d.flow && typeof d.flow === 'object') put('flow', d.flow)
  // The futures tapes (2026-09-02). Between deltas — a quiet minute, or the
  // reconnect a scope change causes — the snapshot is the only copy of the
  // forming ES bar, and the GEX Candles card on ES reads its close as the live
  // print. Without this the card had no ES price until the next tick moved a
  // bar, which is what "no live pair yet" was on a slow tape.
  if (Array.isArray(d.esCandles) && d.esCandles.length) put('esCandles', d.esCandles)
  if (Array.isArray(d.es1mCandles) && d.es1mCandles.length) put('es1mCandles', d.es1mCandles)
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

/** Detach every handler and close a socket we no longer want to hear from. */
function discard(sock: WebSocket): void {
  sock.onopen = null
  sock.onclose = null
  sock.onmessage = null
  sock.onerror = null
  try {
    sock.close()
  } catch {
    /* already gone */
  }
}

function connect(topics: Set<string> | null): void {
  if (disposed) return
  const myEpoch = ++epoch

  // Anything still handshaking has just been superseded. Drop it here rather
  // than letting it open into a world that has moved on — an attempt allowed to
  // complete late is exactly how a second live socket used to appear.
  if (pendingWs) {
    const stale = pendingWs
    pendingWs = null
    discard(stale)
  }

  let next: WebSocket
  try {
    next = new WebSocket(socketUrl(topics))
  } catch {
    scheduleReconnect() // the constructor can throw on a malformed URL
    return
  }
  pendingWs = next

  next.onmessage = (ev) => ingest(ev.data)
  next.onerror = () => {}

  next.onopen = () => {
    // Superseded while we were handshaking: close quietly and let the current
    // attempt do its job. This is the check the old code tried to make by
    // comparing against `ws`, which cannot distinguish the two cases.
    if (myEpoch !== epoch) {
      if (pendingWs === next) pendingWs = null
      discard(next)
      return
    }
    // Swap only once the replacement is actually open, so there is never a
    // window with no connection at all. `ws` is read HERE, not at call time —
    // whatever is live right now is what gets retired.
    const old = ws
    if (old && old !== next) discard(old)
    adopt(next, myEpoch)
  }

  next.onclose = () => {
    // Died before it could be adopted.
    if (myEpoch !== epoch) return // a newer attempt owns the retry
    if (pendingWs === next) pendingWs = null
    // NOTE: `ws` is deliberately left alone. If a previous connection is still
    // live it stays live and keeps feeding the app — only the attempt failed,
    // and scheduleReconnect() will try the scope again.
    scheduleReconnect()
  }
}

/** The live connection went away. */
function handleClose(): void {
  if (disposed) return
  ws = null
  if (stableTimer) {
    clearTimeout(stableTimer)
    stableTimer = null
  }
  scheduleReconnect()
}

let reconnectTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Back off, then try again — at most one retry in flight.
 *
 * The single-timer guard matters as much as the backoff: a server restart can
 * close the live socket and a pending attempt in the same tick, and two
 * independent timers meant two connections a moment later, both of which then
 * bred their own retries.
 */
function scheduleReconnect(): void {
  if (disposed || reconnectTimer) return
  reconnectAttempt++
  // 500ms, 1s, 2s, 4s, capped at 10s. Jittered so a server restart does not
  // bring every open tab back in the same millisecond.
  const backoff = Math.min(10_000, 500 * 2 ** Math.min(reconnectAttempt - 1, 4))
  const jitter = backoff * 0.25 * Math.random()
  reconnectTimer = setTimeout(
    () => {
      reconnectTimer = null
      connect(currentTopics)
    },
    backoff + jitter,
  )
}

/**
 * Send a control message UP the socket.
 *
 * The only thing v3 sends is `{ type: "SET_EXPIRY", expiry }` — server-v2
 * tracks the chosen expiry PER CONNECTION, so a page that needs today's 0DTE
 * rather than the feed's front expiry has to ask for it, and has to ask again
 * after every reconnect (including the ones the topic-scope logic above makes).
 *
 * Queued while the socket is not open, and replayed on the next `onopen`. A
 * page must not have to know whether the connection has finished handshaking
 * to state which expiry it wants, and dropping the request silently is how a
 * board ends up quietly showing the wrong contract.
 *
 * The queue is deliberately keyed by message `type`, keeping only the LAST of
 * each: three expiry changes made during a reconnect should replay as the one
 * the user actually landed on, not as three.
 */
export function send(msg: { type: string; [k: string]: unknown }): void {
  pendingSend.set(msg.type, msg)
  flushSend()
}

const pendingSend = new Map<string, { type: string; [k: string]: unknown }>()

function flushSend(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  for (const msg of pendingSend.values()) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      return // still not writable — keep the queue for the next open
    }
  }
  pendingSend.clear()
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
  epoch++ // every handler still out there is now stale by definition
  if (pendingScope) clearTimeout(pendingScope)
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (stableTimer) clearTimeout(stableTimer)
  pendingScope = null
  reconnectTimer = null
  stableTimer = null
  if (pendingWs) discard(pendingWs)
  if (ws) discard(ws)
  pendingWs = null
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
