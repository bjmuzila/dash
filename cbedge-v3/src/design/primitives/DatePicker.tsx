import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// ─────────────────────────────────────────────────────────────────────────────
// DatePicker — the themed replacement for <input type="date">.
//
// A native date input renders the OPERATING SYSTEM's calendar: Chrome's white
// popup on Windows, a different one on macOS, a wheel on iOS. Inside a dark
// toolbar dropdown that reads as a bug, and no amount of `color-scheme` makes it
// match — the widget is not ours to style. So this is the whole control: a
// trigger that shows the value, and a month grid drawn from the same tokens as
// everything else.
//
// Value and onChange use the "YYYY-MM-DD" string a native date input emits, so
// it is a drop-in swap.
//
// THE GRID IS PORTALED, position:fixed, anchored off the trigger's DOMRect —
// not `position:absolute` inside this component. An absolutely-positioned popup
// is clipped by any scrolling ancestor, and the place this control is used most
// (the BOT composer dropdown) is exactly that: a panel with `overflow-y-auto`.
// The first cut of this rendered the calendar INSIDE that scroll box, where it
// was cut off at the panel's edge and slid under the Broadcast button. Portaling
// to the body escapes both the clip and the stacking context in one move.
//
// No colour literals: every surface here is a token class (see
// cbedge-v3/AGENTS.md non-negotiable #1).
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const pad2 = (n: number) => String(n).padStart(2, '0')
const toStr = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate()

/** "2026-09-09" -> "Sep 9". Invalid/empty -> null. */
function parse(v: string): { y: number; m: number; d: number } | null {
  const x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '')
  if (!x) return null
  // Three capture groups that MATCHED are three strings — but an index into a
  // match array is `string | undefined` under noUncheckedIndexedAccess, so they
  // are read out first and the whole parse fails together if any is missing.
  const [, y, m, d] = x
  if (y === undefined || m === undefined || d === undefined) return null
  return { y: +y, m: +m - 1, d: +d }
}

/** Trigger density. `md` is the composer's full-width field; `sm` is a toolbar chip. */
const TRIGGER_SIZE = {
  md: 'w-full px-2 py-1.5 text-left text-sm',
  sm: 'px-1.5 py-0.5 text-2xs font-semibold tracking-wide',
} as const

export function DatePicker({
  value,
  onChange,
  className = '',
  title,
  size = 'md',
  min,
  max,
  label: labelOf,
  placeholder = 'Date',
  disabled = false,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  title?: string
  /**
   * `md` (default) is the original full-width field — the BOT composer's. `sm`
   * is the toolbar density every card row uses, so a session picker sits level
   * with the SegGroups beside it instead of towering over them.
   */
  size?: 'md' | 'sm'
  /**
   * Bounds, as the same "YYYY-MM-DD" strings a native input's min/max take.
   * Out-of-range days render inert rather than disappearing: a greyed 11th says
   * "not that one", a missing 11th says the calendar is broken.
   */
  min?: string
  max?: string
  /** Override the trigger text. Default is "Sep 9". */
  label?: (v: string) => string
  /** Trigger text when `value` is empty or unparseable. */
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)

  const parsed = parse(value)
  const today = new Date()
  // The grid opens on the selected month, or this month when nothing is set.
  const [view, setView] = useState(() => ({
    y: parsed?.y ?? today.getFullYear(),
    m: parsed?.m ?? today.getMonth(),
  }))

  useEffect(() => {
    if (!open) return
    // The grid lives outside this subtree now, so "outside" has to mean outside
    // BOTH the trigger and the portaled panel.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // A fixed popup does not follow its anchor, and the anchor lives in a
    // scrolling panel — so close rather than let it drift off the trigger.
    const onScroll = () => setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const step = (by: number) => {
    const m = view.m + by
    setView({ y: view.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 })
  }

  const label = parsed ? (labelOf ? labelOf(value) : `${MONTHS[parsed.m]} ${parsed.d}`) : placeholder
  const lead = new Date(view.y, view.m, 1).getDay()
  const count = daysInMonth(view.y, view.m)
  const todayStr = toStr(today.getFullYear(), today.getMonth(), today.getDate())
  // String compare is correct for zero-padded ISO dates and needs no Date objects.
  const outOfRange = (s: string) => (min ? s < min : false) || (max ? s > max : false)

  return (
    <div ref={wrapRef} className={['relative', className].join(' ')}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (disabled) return
          if (!open && parsed) setView({ y: parsed.y, m: parsed.m })
          if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect())
          setOpen((v) => !v)
        }}
        disabled={disabled}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={[
          'tabular rounded-sm border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
          TRIGGER_SIZE[size],
          open ? 'border-accent bg-raised text-fg' : 'border-line bg-bg text-fg hover:border-accent',
        ].join(' ')}
      >
        {label}
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            style={{
              position: 'fixed',
              top: rect ? Math.min(rect.bottom + 6, window.innerHeight - 300) : 80,
              left: rect ? Math.max(8, Math.min(rect.left, window.innerWidth - 232)) : 12,
              zIndex: 100000,
            }}
            className="w-56 rounded-md border border-line bg-surface p-2 shadow-lg"
          >
          <div className="mb-1.5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous month"
              className="rounded-sm border border-line px-2 py-0.5 text-xs text-faint hover:text-fg"
            >
              ‹
            </button>
            <span className="text-xs font-bold tracking-wide text-fg">
              {MONTHS[view.m]} {view.y}
            </span>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next month"
              className="rounded-sm border border-line px-2 py-0.5 text-xs text-faint hover:text-fg"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((w, i) => (
              <span key={i} className="py-0.5 text-center text-2xs font-bold text-faint">
                {w}
              </span>
            ))}
            {Array.from({ length: lead }).map((_, i) => (
              <span key={`p${i}`} />
            ))}
            {Array.from({ length: count }).map((_, i) => {
              const d = i + 1
              const s = toStr(view.y, view.m, d)
              const selected = s === value
              const isToday = s === todayStr
              const blocked = outOfRange(s)
              return (
                <button
                  key={d}
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    if (blocked) return
                    onChange(s)
                    setOpen(false)
                  }}
                  className={[
                    'rounded-sm py-1 text-center text-xs tabular transition-colors',
                    blocked
                      ? 'cursor-not-allowed text-faint opacity-25'
                      : selected
                        ? 'bg-raised font-bold text-accent ring-1 ring-inset ring-accent'
                        : isToday
                          ? 'text-accent hover:bg-raised'
                          : 'text-fg hover:bg-raised',
                  ].join(' ')}
                >
                  {d}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            disabled={outOfRange(todayStr)}
            onClick={() => {
              if (outOfRange(todayStr)) return
              onChange(todayStr)
              setOpen(false)
            }}
            className="mt-1.5 w-full rounded-sm border border-line py-1 text-2xs font-bold uppercase tracking-wide text-faint hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
          >
            Today · 0DTE
          </button>
          </div>,
          document.body,
        )}
    </div>
  )
}

export default DatePicker
