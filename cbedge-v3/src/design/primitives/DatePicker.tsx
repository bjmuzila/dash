import { useEffect, useRef, useState } from 'react'

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
  return x ? { y: +x[1], m: +x[2] - 1, d: +x[3] } : null
}

export function DatePicker({
  value,
  onChange,
  className = '',
  title,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const parsed = parse(value)
  const today = new Date()
  // The grid opens on the selected month, or this month when nothing is set.
  const [view, setView] = useState(() => ({
    y: parsed?.y ?? today.getFullYear(),
    m: parsed?.m ?? today.getMonth(),
  }))

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

  const step = (by: number) => {
    const m = view.m + by
    setView({ y: view.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 })
  }

  const label = parsed ? `${MONTHS[parsed.m]} ${parsed.d}` : 'Date'
  const lead = new Date(view.y, view.m, 1).getDay()
  const count = daysInMonth(view.y, view.m)
  const todayStr = toStr(today.getFullYear(), today.getMonth(), today.getDate())

  return (
    <div ref={wrapRef} className={['relative', className].join(' ')}>
      <button
        type="button"
        onClick={() => {
          if (!open && parsed) setView({ y: parsed.y, m: parsed.m })
          setOpen((v) => !v)
        }}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={[
          'w-full rounded-sm border px-2 py-1.5 text-left text-sm transition-colors',
          open ? 'border-accent bg-raised text-fg' : 'border-line bg-bg text-fg hover:border-accent',
        ].join(' ')}
      >
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute left-0 top-full z-[60] mt-1 w-56 rounded-md border border-line bg-surface p-2 shadow-lg"
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
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    onChange(s)
                    setOpen(false)
                  }}
                  className={[
                    'rounded-sm py-1 text-center text-xs tabular transition-colors',
                    selected
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
            onClick={() => {
              onChange(todayStr)
              setOpen(false)
            }}
            className="mt-1.5 w-full rounded-sm border border-line py-1 text-2xs font-bold uppercase tracking-wide text-faint hover:text-fg"
          >
            Today · 0DTE
          </button>
        </div>
      )}
    </div>
  )
}

export default DatePicker
