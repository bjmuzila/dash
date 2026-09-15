import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { alpha } from '@/design/theme'
import type { AlertItem } from '@/shell/alertTypes'
import { TYPE_BY_ID } from '@/shell/alertTypes'

// ─────────────────────────────────────────────────────────────────────────────
// THE ALERTS PILL — the newest signal, in the toolbar, all the time.
//
// A bell with a number tells you SOMETHING happened. This tells you WHAT: the
// type's colour, its keyword, the headline, and how long ago. That is the whole
// argument for spending toolbar width on it — you can decide whether to look
// without clicking, which is the decision you make thirty times a session.
//
// Click it and the rest open underneath, scrollable, with one row of filter
// chips. There is no settings tab: whether a kind fires at all is the signals
// engine's own switchboard on the owner site, and it is owner-only at the
// server. See AlertsPanel.tsx.
//
// WHY THE PANEL IS LAZY: Shell.tsx is the ENTRY chunk, capped at 37.1KB brotli
// by budgets.json. The pill has to be in it — it is toolbar chrome and it draws
// on first paint. The panel (list, chips, settings switches) is several KB that
// only matters once someone clicks. Same split, same reason, as BzilaAlerts /
// BzilaPanel, BotAlert / BotAlertPanel and NotesDock.
//
// ── WHAT IS LIVE AND WHAT IS NOT (2026-09-15) ───────────────────────────────
// The SWITCHBOARD is wired: the Settings tab reads the signals engine's own
// per-kind master state from GET /proxy/signal-alerts, and a kind the owner has
// turned off is drawn locked. See alertTypes.ts.
//
// The FEED ROWS are still placeholder — `useAlertsFeed` returns AlertsPanel's
// SAMPLE. Wiring them means replacing the body of this hook with a read of
// /proxy/signals; the components already take the shape they will get.
// ─────────────────────────────────────────────────────────────────────────────

const AlertsPanel = lazy(() => import('@/shell/AlertsPanel'))

/** Placeholder feed. Replace the body when the signals engine is wired. */
export function useAlertsFeed(): AlertItem[] {
  const [items, setItems] = useState<AlertItem[]>([])
  useEffect(() => {
    let alive = true
    // Imported lazily for the same reason the panel is: the entry chunk should
    // not carry a list of demo strings.
    void import('@/shell/AlertsPanel').then((m) => {
      if (alive) setItems(m.SAMPLE)
    })
    return () => {
      alive = false
    }
  }, [])
  return items
}

/** "18s", "4m", "2h" — the pill has room for three characters, not a clock. */
function age(at: string): string {
  const [h, m] = at.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return ''
  const now = new Date()
  let mins = now.getHours() * 60 + now.getMinutes() - (h * 60 + m)
  if (mins < 0) mins += 24 * 60
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h`
}

export function AlertsPill() {
  const items = useAlertsFeed()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // pointerdown rather than click so a drag that starts outside closes too —
  // matching BzilaAlerts and BotAlert.
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

  const latest = items[0]
  const type = latest ? TYPE_BY_ID[latest.kind] : null
  const rest = Math.max(0, items.length - 1)

  // Fresh = drawn in the type's colour with a pulsing dot. Older than an hour
  // and the pill goes quiet: a bar that is permanently lit stops meaning
  // anything, which is the failure mode of every notification badge.
  const fresh = useMemo(() => !!latest && !age(latest.at).endsWith('h'), [latest])

  return (
    <div ref={wrapRef} className="relative min-w-0 shrink">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={latest ? `${TYPE_BY_ID[latest.kind].name} — ${latest.text}` : 'Signal alerts'}
        className={[
          // NO BOX. The coloured tag is the only edge in here: a bordered pill
          // beside the wordmark read as a second button competing with the
          // brand, and the tag already says what kind of alert this is. Hover
          // is the only affordance it needs — the row is still a button.
          'flex h-6 max-w-[22rem] items-center gap-1.5 overflow-hidden rounded-sm px-1.5 transition-colors',
          open ? 'bg-raised' : 'hover:bg-raised',
          fresh ? '' : 'opacity-80',
        ].join(' ')}
      >
        {latest && type ? (
          <>
            {/* The dot. It is the only moving thing in the toolbar, and only
                while the newest alert is still recent. */}
            {fresh && (
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: type.color, boxShadow: `0 0 6px ${alpha(type.color, 0.7)}` }}
              />
            )}
            <span
              className="shrink-0 rounded-[2px] border px-1 text-3xs font-bold uppercase leading-[13px] tracking-wide"
              style={{ borderColor: type.color, color: type.color }}
            >
              {type.tag}
            </span>
            <span className="truncate text-2xs text-fg opacity-95">{latest.text}</span>
            <span className="shrink-0 text-3xs tabular-nums opacity-70">{age(latest.at)}</span>
            {rest > 0 && (
              <span className="ml-0.5 shrink-0 pl-1 text-3xs font-bold text-warn">+{rest}</span>
            )}
          </>
        ) : (
          <>
            <span className="shrink-0 text-3xs font-bold uppercase leading-[13px] tracking-wide text-fg opacity-80">
              Alerts
            </span>
            <span className="truncate text-2xs text-fg opacity-75">No signals yet</span>
          </>
        )}
        <span aria-hidden className="shrink-0 text-3xs opacity-70">
          {open ? '▲' : '▾'}
        </span>
      </button>

      {open && (
        <Suspense fallback={null}>
          <AlertsPanel items={items} close={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}

export default AlertsPill
