// ─────────────────────────────────────────────────────────────────────────────
// The ONLY way component code touches live data.
//
// Pages never see a WebSocket, never declare a topic list, never manage a
// subscription lifecycle. They ask for a value; the plumbing figures out the
// rest — including telling the server which topics to send.
//
//   const spot = useFrame<SpotFrame>('spot')
//   const last = useField<SpotFrame, number>('spot', f => f?.last ?? 0)
//
// Prefer useField. useFrame re-renders on every message for that type;
// useField re-renders only when the value you actually read changes, which for
// a 10Hz feed rendering a price to 2dp is a large difference.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useRef, useSyncExternalStore } from 'react'
import { read, subscribe } from './store'

/** Subscribe to a whole frame. Re-renders on every message of that type. */
export function useFrame<T>(type: string): T | undefined {
  const sub = useCallback((fn: () => void) => subscribe(type, fn), [type])
  const get = useCallback(() => read(type) as T | undefined, [type])
  return useSyncExternalStore(sub, get, get)
}

/**
 * Subscribe to a derived value. Re-renders only when the derived value
 * changes by `isEqual` (Object.is by default).
 */
export function useField<T, R>(
  type: string,
  select: (frame: T | undefined) => R,
  isEqual: (a: R, b: R) => boolean = Object.is,
): R {
  const cache = useRef<{ src: unknown; out: R } | null>(null)
  // `select` is usually an inline arrow, so it is a new function every render.
  // That is fine: the ref cache below is what provides snapshot stability,
  // not the identity of the callbacks.
  const selectRef = useRef(select)
  selectRef.current = select
  const eqRef = useRef(isEqual)
  eqRef.current = isEqual

  const sub = useCallback((fn: () => void) => subscribe(type, fn), [type])

  const get = useCallback(() => {
    const src = read(type)
    const prev = cache.current
    if (prev && prev.src === src) return prev.out
    const next = selectRef.current(src as T | undefined)
    if (prev && eqRef.current(prev.out, next)) {
      // Value is unchanged — keep the OLD reference so React bails out.
      cache.current = { src, out: prev.out }
      return prev.out
    }
    cache.current = { src, out: next }
    return next
  }, [type])

  return useSyncExternalStore(sub, get, get)
}

/**
 * Imperative access for charts and canvases that must NOT go through React
 * state. Returns an unsubscribe fn. Call your chart's .update() inside `fn`.
 *
 * This is the correct tool for lightweight-charts, not useFrame — pushing
 * every tick through React to then hand it to an imperative chart API is pure
 * overhead.
 */
export function watchFrame<T>(type: string, fn: (frame: T | undefined) => void): () => void {
  const unsub = subscribe(type, () => fn(read(type) as T | undefined))
  fn(read(type) as T | undefined)
  return unsub
}
