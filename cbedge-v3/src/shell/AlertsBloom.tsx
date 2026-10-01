import type { CSSProperties } from 'react'
import { useEffect, useRef, useState } from 'react'
import { T } from '@/design/theme'
import type { AlertItem } from '@/shell/alertTypes'
import { TYPE_BY_ID } from '@/shell/alertTypes'
import '@/shell/alertsBloom.css'

// ─────────────────────────────────────────────────────────────────────────────
// THE BLOOM — a new signal, grown out of the toolbar pill.
//
// The pill (AlertsFeed.tsx) is deliberately small and quiet, which is right for
// the thirty glances a session — and wrong for the one moment a signal lands
// while you are watching a chart. It used to get a 1px ring, three beats in
// 2.4s, and that was easy to miss. So for BLOOM_MS the pill grows in place into
// a two-line chip: tag, ticker, headline, then the detector's sentence and its
// meta line, tinted and glowing in the type's colour with a light sweep across
// it. Then it shrinks back into the pill, and the pill's unread badge carries
// the news until the list is opened.
//
// It is the SAME object getting bigger, not a new surface somewhere else, so
// the eye learns where alerts come from. It never takes layout space: it is
// `absolute` over the pill and hangs ~40px over the board while it is open.
//
//   hover / focus  holds it open; leaving gives it HOLD_AFTER_HOVER_MS more
//   click          opens the alert list (the parent closes the bloom)
//   a newer alert  remounts it (keyed by id in the parent) so it blooms again
//
// LAZY on purpose: AlertsFeed.tsx is in the ENTRY chunk (Shell.tsx), and this
// is markup plus a stylesheet that only matters when an alert lands. The
// parent preloads the chunk after the feed's first load, so the first bloom of
// the day is not waiting on a fetch.
// ─────────────────────────────────────────────────────────────────────────────

const BLOOM_MS = 6000
const HOLD_AFTER_HOVER_MS = 2000
/** Backstop for `transitionend`, which a reduced-motion or hidden tab may never fire. */
const LEAVE_FALLBACK_MS = 900

export default function AlertsBloom({
  item,
  onOpen,
  onDone,
}: {
  item: AlertItem
  onOpen: () => void
  onDone: () => void
}) {
  const t = TYPE_BY_ID[item.kind]
  const [isOpen, setIsOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const openedRef = useRef(false)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  const closeIn = (ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setIsOpen(false), ms)
  }
  const hold = () => {
    window.clearTimeout(timer.current)
    setIsOpen(true) // also catches it mid-shrink
  }

  // Open on the frame AFTER mount: mounting already-open would skip the grow,
  // because a transition needs a "from" state the browser has painted.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setIsOpen(true))
    timer.current = window.setTimeout(() => setIsOpen(false), BLOOM_MS)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer.current)
    }
  }, [])

  // Closing: the parent unmounts us once the shrink has played. `transitionend`
  // on opacity is the normal signal; the timeout is the backstop.
  useEffect(() => {
    if (isOpen) {
      openedRef.current = true
      return
    }
    if (!openedRef.current) return
    const fallback = window.setTimeout(() => doneRef.current(), LEAVE_FALLBACK_MS)
    return () => window.clearTimeout(fallback)
  }, [isOpen])

  // Whale prints carry a side; the arrow and the ticker take its colour, the
  // same rule the alert list uses (AlertsPanel.tsx).
  const biasColor = item.bias ? (item.bias === 'bullish' ? T.green : T.red) : undefined
  const why = [item.text, item.meta].filter(Boolean).join(' · ')

  return (
    <button
      type="button"
      aria-label={`New ${t.name}: ${item.ticker} ${item.title}. ${item.text}. Open alerts.`}
      data-open={isOpen ? 'true' : 'false'}
      onClick={onOpen}
      onMouseEnter={hold}
      onMouseLeave={() => closeIn(HOLD_AFTER_HOVER_MS)}
      onFocus={hold}
      onBlur={() => closeIn(HOLD_AFTER_HOVER_MS)}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'opacity' && !isOpen && openedRef.current) onDone()
      }}
      style={{ '--alert-bloom': t.color } as CSSProperties}
      className="alert-bloom absolute -left-1 -top-0.5 z-40 max-w-[calc(100vw-16rem)] cursor-pointer overflow-hidden rounded-md px-3 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <span aria-hidden className="alert-bloom-sweep" />
      <span className="alert-bloom-body relative block">
        <span className="flex items-center gap-2">
          <span
            className="shrink-0 rounded-[2px] border px-1 text-2xs font-bold uppercase leading-[15px] tracking-wide"
            style={{ borderColor: t.color, color: t.color }}
          >
            {t.tag}
          </span>
          {item.bias && (
            <span aria-hidden className="shrink-0 text-xs font-bold leading-none" style={{ color: biasColor }}>
              {item.bias === 'bullish' ? '▲' : '▼'}
            </span>
          )}
          <span className="shrink-0 text-base font-bold leading-tight tracking-tight" style={{ color: biasColor ?? t.color }}>
            {item.ticker}
          </span>
          <span className="min-w-0 truncate text-sm font-bold leading-tight text-fg">{item.title}</span>
          <span className="ml-auto shrink-0 text-3xs font-bold uppercase tracking-wide" style={{ color: t.color }}>
            New
          </span>
        </span>
        <span className="mt-1 block truncate text-xs leading-snug text-fg opacity-90">{why}</span>
      </span>
    </button>
  )
}
