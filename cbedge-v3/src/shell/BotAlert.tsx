import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/data/auth'

// ─────────────────────────────────────────────────────────────────────────────
// BOT — the trade-alert composer, in the toolbar.
//
// The same composer as owner.cbedge.net → BOT, reachable without leaving the
// board. That is the whole point: an alert is written while looking at the
// chart that justified it, and a trip to another origin is long enough that it
// gets written later, from memory, or not at all.
//
// OWNER ONLY, TWICE. This file renders NOTHING for anyone else — no button, no
// chunk fetched, nothing in the DOM to find. But that is chrome. The real gate
// is /api/bot-alert, which checks the owner id server-side and 403s everyone
// else; if this component were somehow rendered for a subscriber, every button
// in it would fail at the server. Same rule as BzilaAlerts.
//
// WHY THE PANEL IS LAZY: Shell.tsx is the ENTRY chunk, capped at 37.1KB brotli
// by budgets.json. The trigger has to be in it (it is toolbar chrome); the
// composer — form state, image paste, destination fetch — is several KB that
// only matters once it is opened, and only ever for one account. Same split,
// same reason, as BzilaAlerts/BzilaPanel and NotesDock.
// ─────────────────────────────────────────────────────────────────────────────

const BotAlertPanel = lazy(() => import('@/shell/BotAlertPanel'))

/** Broadcast tower — reads as "send", and is not a bell (that is Bzila's). */
function TowerIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 20 12 4l7 16" />
      <path d="M8.5 13h7" />
      <path d="M3.5 8.5a8 8 0 0 1 0-5M20.5 8.5a8 8 0 0 0 0-5" />
    </svg>
  )
}

export function BotAlertButton() {
  const { isOwner } = useAuth()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Outside-click / Escape. `pointerdown` rather than `click` so a drag that
  // starts outside closes too, matching BzilaAlerts.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
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

  // Not "render an inert button": a non-owner gets no trace of this at all.
  if (!isOwner) return null

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Broadcast a trade alert"
        className={[
          'flex items-center gap-1.5 rounded-sm border px-2 py-1 text-2xs font-bold uppercase tracking-wide transition-colors',
          open ? 'border-accent bg-raised text-accent' : 'border-line text-faint hover:bg-raised hover:text-fg',
        ].join(' ')}
      >
        <TowerIcon />
        BOT
      </button>

      {open && (
        <Suspense fallback={null}>
          <BotAlertPanel close={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}

export default BotAlertButton
