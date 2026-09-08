import { useCallback, useEffect, useRef, useState } from 'react'
import { refreshAll } from '@/data/api'
import { reconnectSocket } from '@/data/socket'

// ─────────────────────────────────────────────────────────────────────────────
// ↻ REFRESH — the toolbar's "I think this is stuck" button.
//
// Two things are on screen at any moment and they go stale in different ways:
//
//   THE SOCKET   /ws/gex. Self-healing, and the snapshot replays the whole
//                ladder on every (re)connect — so a stale panel here is
//                normally a connection that died quietly and is mid-backoff,
//                which can be up to ten seconds away from trying again.
//   THE REST     everything through data/api.ts. `staleMs` is a cache TTL and
//                NOT an interval (the block at the top of that file exists
//                because that distinction bit us), so any card without a
//                `pollMs` sits on the response it mounted with, forever. That
//                is the real "stuck" case and nothing on the board could clear
//                it short of a page reload.
//
// So the button does both: `refreshAll()` empties the REST cache and refetches
// everything currently mounted, `reconnectSocket()` drops the live socket and
// opens a new one at the same topic scope.
//
// WHY THIS IS NOT F5. A page reload throws away the board's own state — an
// expanded card, a half-typed note, the layout you were in the middle of
// editing, the pan and zoom on every chart — to solve a problem that is
// entirely about data. This refetches the data and leaves the app alone.
//
// NOTHING BLANKS. The revalidation callbacks in api.ts never set a loading
// state and a failed refetch keeps the last good value, so the worst case is
// that the numbers on screen do not change. A refresh that can empty a working
// board is worse than no refresh.
//
// The spin is 600ms of feedback on an action whose whole point is that you
// cannot otherwise tell it happened — a refresh that returns identical numbers
// is the COMMON case, and without the animation it reads as a dead button.
// ─────────────────────────────────────────────────────────────────────────────

/** How long the icon spins. Purely feedback — nothing waits on it. */
const SPIN_MS = 600

/**
 * Ignore repeat clicks for this long. Not a rate limit on the user so much as
 * on the socket: `reconnectSocket` resets the backoff, so a person clicking
 * this eight times in two seconds would be opening eight connections with the
 * flap protection deliberately turned off.
 */
const COOLDOWN_MS = 1500

export function RefreshButton() {
  const [spinning, setSpinning] = useState(false)
  const lastRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const onClick = useCallback(() => {
    const now = Date.now()
    if (now - lastRef.current < COOLDOWN_MS) return
    lastRef.current = now

    setSpinning(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setSpinning(false)
    }, SPIN_MS)

    reconnectSocket()
    refreshAll()
  }, [])

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Refresh"
      title="Refetch every panel and reopen the live feed. Use it when something looks stale or stuck — it reloads the DATA only, so your layout, expanded cards and chart zoom are all kept"
      className="flex shrink-0 items-center rounded-sm border border-line px-2 py-1 leading-none text-muted transition-colors hover:text-fg"
    >
      <svg
        aria-hidden
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        // Inline rather than a Tailwind `animate-spin` class: the utility spins
        // at 1s/turn forever and this needs one bounded turn, so the duration
        // and the iteration count both have to be stated. `cb-spin` is defined
        // in design/tokens.css.
        style={spinning ? { animation: `cb-spin ${SPIN_MS}ms linear` } : undefined}
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  )
}
