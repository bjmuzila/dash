// ─────────────────────────────────────────────────────────────────────────────
// LAST-KNOWN-STATE CACHE.
//
// Why this exists: a cold load with an empty screen "feels" slow even when the
// network is fast, because the user is looking at nothing while the first
// frame is in flight. Painting yesterday's numbers instantly and replacing
// them ~200ms later reads as instant. Painting a spinner for 200ms does not.
//
// The read is kicked off by the inline script in index.html, before React
// exists, so by the time anything asks for it the promise is usually already
// resolved.
//
// Writes are throttled and pushed to an idle callback. Persisting must never
// compete with rendering.
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'cbedge-v3'
const STORE = 'frames'
const FLUSH_MS = 3000

let dbPromise: Promise<IDBDatabase | null> | null = null
const pending = new Map<string, unknown>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

/**
 * Last-known state, as read by the inline boot script. Falls back to reading
 * it here if the boot script could not (private mode, storage disabled).
 */
export async function restore(): Promise<Record<string, unknown>> {
  const fromBoot = window.__CB_BOOT__?.cache
  if (fromBoot) return fromBoot
  const db = await openDb()
  if (!db) return {}
  return new Promise((resolve) => {
    const out: Record<string, unknown> = {}
    try {
      const cur = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor()
      cur.onsuccess = () => {
        const c = cur.result
        if (!c) return resolve(out)
        out[String(c.key)] = c.value
        c.continue()
      }
      cur.onerror = () => resolve(out)
    } catch {
      resolve(out)
    }
  })
}

/** Queue a frame for persistence. Cheap — the actual write is batched. */
export function persist(type: string, value: unknown): void {
  pending.set(type, value)
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    whenIdle(flushNow)
  }, FLUSH_MS)
}

async function flushNow(): Promise<void> {
  if (pending.size === 0) return
  const db = await openDb()
  if (!db) {
    pending.clear()
    return
  }
  const batch = Array.from(pending.entries())
  pending.clear()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const os = tx.objectStore(STORE)
    for (const [k, v] of batch) {
      try {
        os.put(v, k)
      } catch {
        // Structured-clone failure on one frame must not lose the rest.
      }
    }
  } catch {
    /* storage full or blocked — dropping the cache is always survivable */
  }
}

export async function clearCache(): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).clear()
  } catch {
    /* nothing to do */
  }
}

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
}

function whenIdle(fn: () => void): void {
  const ric = (window as IdleWindow).requestIdleCallback
  if (typeof ric === 'function') ric(fn, { timeout: 2000 })
  else setTimeout(fn, 0)
}
