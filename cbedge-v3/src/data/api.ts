// ─────────────────────────────────────────────────────────────────────────────
// THE REST SIDE.
//
// Small on purpose. It does three things, all of which exist to kill request
// waterfalls:
//
//  1. DEDUPE. Two panels asking for the same URL in the same tick make one
//     request.
//  2. CACHE with a stale window. A remount inside staleTime does not refetch.
//  3. PRELOAD. `preload(url)` can be called from a link's onPointerEnter or
//     from a route's module scope, so the request is already in flight before
//     the component that needs it exists.
//
// THE RULE: a route fires everything it needs in parallel, at entry. Fetching
// inside a child that only mounts after a parent's fetch resolves is a
// waterfall, and waterfalls are the reason dashboards feel slow. If you catch
// yourself writing one, hoist it.
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
  const staleMs = opts.staleMs
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

  return { ...stateRef.current, refetch: run }
}

export function clearQueryCache(): void {
  cache.clear()
}
