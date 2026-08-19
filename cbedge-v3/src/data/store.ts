// ─────────────────────────────────────────────────────────────────────────────
// THE STORE.
//
// One flat map of frameType -> last frame, plus per-type subscriptions.
//
// Three properties matter, all of them for speed:
//
//  1. LAST-VALUE-WINS. These are snapshots, not events. A panel that mounts
//     late gets the current value immediately — no waiting for the next tick.
//
//  2. rAF COALESCING. Twenty frames arriving inside one 16ms window notify
//     subscribers ONCE. Without this a busy open produces a render storm and
//     the whole app feels sticky.
//
//  3. PER-TYPE SUBSCRIPTIONS. A spot tick wakes only the components reading
//     spot. There is deliberately no "whole store" subscription — if you find
//     yourself wanting one, you want a selector instead.
//
// Component code should not import from here directly; use the hooks in
// src/data/hooks.ts.
// ─────────────────────────────────────────────────────────────────────────────

type Listener = () => void

const state = new Map<string, unknown>()
const listeners = new Map<string, Set<Listener>>()
const dirty = new Set<string>()

let flushHandle: number | null = null
let activeTypesListener: ((types: string[]) => void) | null = null

/** Read the current value for a frame type. Stable reference until replaced. */
export function read(type: string): unknown {
  return state.get(type)
}

/** Subscribe to one frame type. Returns an unsubscribe fn. */
export function subscribe(type: string, fn: Listener): () => void {
  let set = listeners.get(type)
  if (!set) {
    set = new Set()
    listeners.set(type, set)
    notifyActiveTypes()
  }
  set.add(fn)
  return () => {
    set.delete(fn)
    if (set.size === 0) {
      listeners.delete(type)
      notifyActiveTypes()
    }
  }
}

/**
 * Write a frame. Safe to call at any rate — subscribers are notified at most
 * once per animation frame.
 */
export function write(type: string, value: unknown): void {
  state.set(type, value)
  dirty.add(type)
  schedule()
}

/**
 * Seed a value only if nothing live has arrived for that type yet. Used to
 * paint cached state without ever clobbering a fresher live frame.
 */
export function seed(type: string, value: unknown): boolean {
  if (state.has(type)) return false
  write(type, value)
  return true
}

function schedule(): void {
  if (flushHandle !== null) return
  flushHandle = requestAnimationFrame(flush)
}

function flush(): void {
  flushHandle = null
  if (dirty.size === 0) return
  // Snapshot first: a listener may subscribe/unsubscribe during notification.
  const types = Array.from(dirty)
  dirty.clear()
  for (const t of types) {
    const set = listeners.get(t)
    if (!set) continue
    for (const fn of Array.from(set)) fn()
  }
  renderTick()
}

// ── Topic derivation ─────────────────────────────────────────────────────────
// The set of frame types anything is currently subscribed to. src/data/socket.ts
// turns this into the server's ?topics= scope. Nothing is hand-maintained, so
// the v2 failure mode — a panel silently going stale because someone forgot to
// add its type to a topics array — cannot happen here.

export function activeTypes(): string[] {
  return Array.from(listeners.keys())
}

export function onActiveTypesChange(fn: (types: string[]) => void): void {
  activeTypesListener = fn
}

function notifyActiveTypes(): void {
  activeTypesListener?.(activeTypes())
}

// ── Render accounting (dev overlay only) ─────────────────────────────────────

let ticks = 0
let ticksWindowStart = performance.now()
let ticksPerSec = 0

function renderTick(): void {
  ticks++
  const now = performance.now()
  if (now - ticksWindowStart >= 1000) {
    ticksPerSec = (ticks * 1000) / (now - ticksWindowStart)
    ticks = 0
    ticksWindowStart = now
  }
}

export function stats() {
  return {
    types: state.size,
    subscribedTypes: listeners.size,
    flushesPerSec: ticksPerSec,
  }
}

/** Test/debug only. */
export function _reset(): void {
  state.clear()
  listeners.clear()
  dirty.clear()
}
