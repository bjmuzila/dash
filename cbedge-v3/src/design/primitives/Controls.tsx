import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// The small controls a card's toolbar and settings popover are built from.
//
// These four lived in board/gexCandles/controls.tsx, whose header said they
// belonged here "the moment a second card wants one, and not before." The GEX
// Chart is that second card: it needs a segmented basis switch, toggle chips, a
// cog popover and section headings, and copying four twenty-line components
// into a second file is how two cards start drifting apart visually.
//
// gexCandles/controls.tsx re-exports them, so nothing that imported them from
// there had to change; what stays in that file is the pieces only the candles
// card uses (Slider, Dropdown, SymbolPicker).
//
// Structural only — every colour comes from a token utility, nothing here
// carries a literal.
// ─────────────────────────────────────────────────────────────────────────────

export function SegGroup<T extends string>({
  options,
  value,
  onChange,
  title,
}: {
  options: Array<{ label: string; value: T; title?: string }>
  value: T
  onChange: (v: T) => void
  title?: string
}) {
  return (
    <div className="flex shrink-0 items-center rounded-sm border border-line" title={title}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          title={o.title}
          className={[
            'px-1.5 py-0.5 text-[10px] font-semibold tracking-wide transition-colors first:rounded-l-sm last:rounded-r-sm',
            o.value === value ? 'bg-raised text-fg' : 'text-muted opacity-60 hover:opacity-100',
          ].join(' ')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chip({
  label,
  on,
  onClick,
  title,
}: {
  label: string
  on: boolean
  onClick: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        'rounded-sm border px-2 py-0.5 text-[10px] font-semibold tracking-wide transition-colors',
        on ? 'border-accent bg-raised text-fg' : 'border-line text-muted opacity-60 hover:opacity-100',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

/** A click-outside-to-close popover anchored under its trigger. */
export function Popover({
  open,
  onClose,
  children,
  align = 'right',
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  align?: 'left' | 'right'
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      ref={ref}
      className={[
        'absolute top-full z-30 mt-1 rounded-md border border-line bg-surface p-2 shadow-lg',
        align === 'right' ? 'right-0' : 'left-0',
      ].join(' ')}
    >
      {children}
    </div>
  )
}

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2 first:border-t-0 first:pt-0">
      <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-faint opacity-60">{title}</span>
      {children}
    </div>
  )
}
