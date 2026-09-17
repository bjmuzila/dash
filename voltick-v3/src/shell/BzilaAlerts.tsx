import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/data/auth'
import { CbWordmark } from '@/shell/Brand'

// ─────────────────────────────────────────────────────────────────────────────
// BZILA ALERTS — the CB Edge logo IS the button.
//
// Ported from v2's components/shared/BzilaAlerts.tsx, which handed the
// GlobalToolbar a `renderTrigger` so the wordmark could be the thing that lights
// up. v3 does not need that indirection: there is exactly one toolbar and
// exactly one logo, so the logo and the alert state live in the same component.
//
// ── What it does ────────────────────────────────────────────────────────────
//   · Polls /api/bzila-alerts every 45s for paid accounts and the owner.
//   · The wordmark PULSES (a warn-coloured ring + a dot) whenever the newest
//     alert id is above the last one this browser acknowledged. Opening the
//     dropdown acknowledges them.
//   · Click → the panel: latest alerts, each with 👍 / 👎.
//   · OWNER ONLY: a compose box at the top of that same panel — type and Send —
//     plus Edit / Delete per alert. This is the ONE place an alert is written
//     from inside the customer app.
//
// ── The thumbs are permanent, and that is the point ─────────────────────────
// /api/bzila-alerts/react writes TWO things: the live reaction row (one per
// alert+user, toggleable) and an append-only row in bzila_alert_reaction_log
// that snapshots the alert's title and body at the moment of the tap. Deleting
// an alert wipes the former and leaves the latter, which is why
// owner.cbedge.net → Bzila Alerts can still show who reacted to a broadcast
// that no longer exists. Nothing in this file has to do anything for that to
// hold — it is a property of the endpoint — but changing the endpoint would
// break it silently, so it is written down here too.
//
// ── Chrome, not a gate ──────────────────────────────────────────────────────
// `isOwner` decides what is DRAWN (the compose box, Edit/Delete). The API route
// is the real gate: writes are rejected server-side for anyone but the owner
// id. Same rule as data/auth.tsx.
//
// ── Why the panel is lazy ───────────────────────────────────────────────────
// This file is reached from Shell.tsx, the ENTRY chunk, capped at 37.1KB brotli
// by budgets.json. The trigger has to be there from the first paint — it is the
// logo — but the panel (list, compose, edit, thumbs) is ~6KB that only matters
// once someone clicks. Same split, same reason, as NotesDock.
// ─────────────────────────────────────────────────────────────────────────────

const BzilaPanel = lazy(() => import('@/shell/BzilaPanel'))

/** Shared with v2 on purpose: same person, same browser, one "seen" mark. */
const SEEN_KEY = 'bzila:alerts:seen'
const POLL_MS = 45_000

export type Reaction = 'up' | 'down' | ''

export interface BzilaAlert {
  id: number
  title: string
  body: string
  created_at: string
  updated_at: string
  up?: number
  down?: number
  mine?: Reaction
}

function readSeen(): number {
  try {
    const v = Number(window.localStorage.getItem(SEEN_KEY))
    return Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

function writeSeen(id: number) {
  try {
    window.localStorage.setItem(SEEN_KEY, String(id))
  } catch {
    /* private mode — the pulse just repeats next session */
  }
}

export function BzilaLogo() {
  const { isPaid, isOwner } = useAuth()
  const canSee = isPaid || isOwner

  const [alerts, setAlerts] = useState<BzilaAlert[]>([])
  const [open, setOpen] = useState(false)
  const [hasNew, setHasNew] = useState(false)

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const openRef = useRef(false)
  const seededRef = useRef(false)

  useEffect(() => {
    openRef.current = open
  }, [open])

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/bzila-alerts', { cache: 'no-store', credentials: 'same-origin' })
      if (!r.ok) return
      const d = (await r.json()) as { alerts?: BzilaAlert[] }
      const list = Array.isArray(d?.alerts) ? d.alerts : []
      setAlerts(list)

      const latest = list[0]?.id ?? 0
      // Panel open = the user is looking at them. Nothing to announce.
      if (openRef.current) {
        if (latest) writeSeen(latest)
        setHasNew(false)
        return
      }
      if (!latest) return

      const seen = readSeen()
      if (!seededRef.current && seen === 0) {
        // First load on a browser that has never seen this: acknowledge the
        // existing history silently, so the logo only lights for alerts that
        // land AFTER this point rather than for the whole archive.
        seededRef.current = true
        writeSeen(latest)
        setHasNew(false)
        return
      }
      setHasNew(latest > seen)
    } catch {
      /* offline / transient — keep whatever was on screen */
    }
  }, [])

  useEffect(() => {
    if (!canSee) return
    void load()
    // A background tab is nobody watching a logo. Skip the poll and catch up on
    // the way back, so a parked dashboard is not a request a minute forever.
    const tick = () => {
      if (!document.hidden) void load()
    }
    const id = window.setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [canSee, load])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Free and signed-out accounts still get the logo — it is the brand, it has to
  // be in the toolbar for everyone. It is simply not a button for them.
  if (!canSee) return <CbWordmark className="h-6 w-auto shrink-0" />

  const toggle = () => {
    setOpen((v) => {
      const next = !v
      if (next) {
        const latest = alerts[0]?.id ?? 0
        if (latest) writeSeen(latest)
        setHasNew(false)
      }
      return next
    })
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title={hasNew ? 'New alert from Bzila' : 'Bzila alerts'}
        className={[
          'flex items-center rounded-sm border px-1.5 py-0.5 transition-colors',
          open || hasNew ? 'border-warn bg-raised' : 'border-transparent hover:bg-raised',
          hasNew ? 'bzila-lit' : '',
        ].join(' ')}
      >
        <CbWordmark className="h-6 w-auto shrink-0" />
      </button>

      {/* The dot. The ring says "something happened"; the dot survives
          prefers-reduced-motion, which turns the ring off. */}
      {hasNew && (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-warn"
        />
      )}

      {open && (
        <Suspense fallback={null}>
          <BzilaPanel
            alerts={alerts}
            setAlerts={setAlerts}
            isOwner={isOwner}
            reload={load}
            close={() => setOpen(false)}
          />
        </Suspense>
      )}
    </div>
  )
}

export default BzilaLogo
