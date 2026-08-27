// ─────────────────────────────────────────────────────────────────────────────
// THE REST SIDE.
//
// Small on purpose. It does four things, all of which exist to kill request
// waterfalls or stale screens:
//
//  1. DEDUPE. Two panels asking for the same URL in the same tick make one
//     request.
//  2. CACHE with a stale window. A remount inside staleTime does not refetch.
//  3. PRELOAD. `preload(url)` can be called from a link's onPointerEnter or
//     from a route's module scope, so the request is already in flight before
//     the component that needs it exists.
//  4. POLL. `pollMs` refetches on a cadence for data that has no push channel.
//
// THE RULE: a route fires everything it needs in parallel, at entry. Fetching
// inside a child that only mounts after a parent's fetch resolves is a
// waterfall, and waterfalls are the reason dashboards feel slow. If you catch
// yourself writing one, hoist it.
//
// ── staleMs is NOT a refresh interval ────────────────────────────────────────
// It is a cache TTL: it says how long a cached value may be served WITHOUT a
// refetch, and nothing about when a refetch happens. A card that mounts once
// and never remounts will sit on its first response forever no matter how small
// staleMs is. That distinction cost real confusion — a chart with staleMs 25_000
// looked like it was refreshing every 25 seconds and was in fact frozen at the
// value it loaded with. If data needs to keep arriving, it needs `pollMs`, or a
// WebSocket frame.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'

interface Entry {
  at: number
  value: unknown
  inflight: Promise<unknown> | null
  error: Error | null
}

const cache = new Map<string, Entry>()
const DEFAULT_STALE_MS = 30_000

export interface QueryOpts {
  /** How long a cached value is served without refetching. Default 30s. */
  staleMs?: number
  /**
   * Refetch every N ms while the component is mounted AND the tab is visible.
   * Omit for data that never changes on its own, or that arrives over the
   * socket instead. Polling stops while the tab is hidden — a background tab
   * refetching a chain every 15s is pure egress nobody is looking at.
   */
  pollMs?: number
  signal?: AbortSignal
}

/** Fetch JSON with dedupe + cache. Safe to call from anywhere, any number of times. */
export function query<T>(url: string, opts: QueryOpts = {}): Promise<T> {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS
  const hit = cache.get(url)
  const now = Date.now()

  if (hit) {
    if (hit.inflight) return hit.inflight as Promise<T>
    if (hit.error === null && now - hit.at < staleMs) return Promise.resolve(hit.value as T)
  }

  const inflight = fetch(url, { signal: opts.signal, credentials: 'same-origin' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
      return (await res.json()) as T
    })
    .then((value) => {
      cache.set(url, { at: Date.now(), value, inflight: null, error: null })
      return value
    })
    .catch((err: Error) => {
      cache.set(url, { at: Date.now(), value: undefined, inflight: null, error: err })
      throw err
    })

  cache.set(url, { at: now, value: hit?.value, inflight, error: null })
  return inflight as Promise<T>
}

/**
 * Start a request without caring about the result. Call from a nav link's
 * onPointerEnter, or at route-module scope. This is the cheapest large win
 * available: by the time the user's click registers the data is already back.
 */
export function preload(url: string, opts?: QueryOpts): void {
  void query(url, opts).catch(() => {
    /* preload failures are silent by design; the real call will surface them */
  })
}

/** Synchronously read a cached value, if there is one. Never triggers a fetch. */
export function peek<T>(url: string): T | undefined {
  return cache.get(url)?.value as T | undefined
}

export interface QueryResult<T> {
  data: T | undefined
  error: Error | null
  loading: boolean
  refetch: () => void
}

/**
 * Component-level read. Returns cached data synchronously on first render when
 * it is available, so a remount does not flash a loading state.
 */
export function useQuery<T>(url: string | null, opts: QueryOpts = {}): QueryResult<T> {
  const { staleMs, pollMs } = opts
  const [, forceRender] = useState(0)
  const stateRef = useRef<{ data: T | undefined; error: Error | null; loading: boolean }>({
    data: url ? peek<T>(url) : undefined,
    error: null,
    loading: false,
  })

  const run = useCallback(() => {
    if (!url) return
    const cached = peek<T>(url)
    stateRef.current = { data: cached, error: null, loading: cached === undefined }
    forceRender((n) => n + 1)
    query<T>(url, { staleMs })
      .then((data) => {
        stateRef.current = { data, error: null, loading: false }
        forceRender((n) => n + 1)
      })
      .catch((error: Error) => {
        stateRef.current = { data: stateRef.current.data, error, loading: false }
        forceRender((n) => n + 1)
      })
  }, [url, staleMs])

  useEffect(run, [run])

  useEffect(() => {
    if (!url || !pollMs) return
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      // staleMs 0 deliberately bypasses the cache window — the whole point of a
      // poll is to go and ask again. Dedupe still applies, so two cards polling
      // the same URL still make one request.
      query<T>(url, { staleMs: 0 })
        .then((data) => {
          stateRef.current = { data, error: null, loading: false }
          forceRender((n) => n + 1)
        })
        .catch(() => {
          // A failed POLL keeps the last good value on screen. Blanking a chart
          // because one refresh in the middle of the day 502'd is worse than
          // showing a number that is thirty seconds old.
        })
    }
    const id = setInterval(tick, pollMs)
    // Catch up immediately on returning to the tab rather than waiting out the
    // remainder of an interval that was suppressed while hidden.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [url, pollMs])

  return { ...stateRef.current, refetch: run }
}

export function clearQueryCache(): void {
  cache.clear()
}
