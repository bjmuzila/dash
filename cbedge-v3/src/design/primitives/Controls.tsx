import type { ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
  options: Array<{
    label: string
    value: T
    title?: string
    /**
     * Inert and dimmed — the option is REAL but the data behind it is not
     * there right now (a basis the current rows cannot support, say).
     *
     * Deliberately not "hidden": a control whose buttons come and go is a
     * control you cannot learn, and the option vanishing gives no reason. A
     * greyed button with a `title` saying why is the honest version.
     *
     * A disabled option that is also the SELECTED one stays highlighted and
     * stays readable. That combination is legal on purpose — a stored choice
     * must not be silently rewritten just because this ticker cannot serve it,
     * and the other options are still one click away, so nobody is stranded.
     */
    disabled?: boolean
  }>
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
          disabled={o.disabled}
          // Guarded as well as `disabled`, because a disabled button still
          // fires nothing but a future refactor to a div would.
          onClick={() => {
            if (!o.disabled) onChange(o.value)
          }}
          title={o.title}
          className={[
            'px-1.5 py-0.5 text-[10px] font-semibold tracking-wide transition-colors first:rounded-l-sm last:rounded-r-sm',
            o.value === value ? 'bg-raised text-fg' : 'text-muted',
            // Four states, and the selected-but-disabled one is why this is a
            // table rather than one ternary: it must still read as SELECTED
            // (that is what the chart is showing) while reading as unavailable.
            o.disabled
              ? o.value === value
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-not-allowed opacity-25'
              : o.value === value
                ? ''
                : 'opacity-60 hover:opacity-100',
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

/** Kept clear of the viewport edge so a popover is never half off-screen. */
const POP_EDGE = 8
/** Gap between the trigger and the panel. */
const POP_GAP = 4
/**
 * Above every board tile and above the Multi Greek cell card (200).
 *
 * Board.tsx gives each tile `zIndex: 1`, which makes the tile its own stacking
 * context — a z-index set INSIDE a tile can never beat a later sibling tile,
 * however large. That is why the panel is portalled to <body>: only at the root
 * does this number mean anything.
 */
const POP_Z = 250

interface PopPos {
  left: number
  top: number
  maxH: number
}

/**
 * A click-outside-to-close popover anchored under its trigger.
 *
 * Portalled to <body> and positioned in viewport coordinates. It used to be an
 * `absolute` child of the trigger's wrapper, which meant a wide panel on a
 * narrow card was clipped twice over: by the Card's `overflow-hidden`, and by
 * the board tile's stacking context. On a three-column Multi Greek the cog
 * panel lost its whole left edge — the section labels and the first half of
 * every control.
 *
 * Positioning rules: aligned to the trigger's wrapper (`align` picks which
 * edge), clamped to the viewport horizontally, and flipped above the trigger
 * when there is more room up than down. Whatever height is left is handed to
 * the panel as a max-height with its own scroll, so a tall panel on a short
 * window is scrollable rather than cut off.
 */
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
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const [pos, setPos] = useState<PopPos | null>(null)

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

  const place = useCallback(() => {
    const el = ref.current
    const anchor = anchorRef.current
    if (!el || !anchor) return
    // The trigger's wrapper — the `relative` div every call site puts the
    // button and this popover in. Its box is the thing to align to; the
    // zero-size anchor span alone would only give the wrapper's BOTTOM edge,
    // which is not enough to flip the panel above the trigger.
    const host = (anchor.offsetParent as HTMLElement | null) ?? anchor
    const a = host.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = el.offsetWidth
    const h = el.offsetHeight

    let left = align === 'right' ? a.right - w : a.left
    left = Math.min(Math.max(POP_EDGE, left), Math.max(POP_EDGE, vw - w - POP_EDGE))

    const below = vh - (a.bottom + POP_GAP) - POP_EDGE
    const above = a.top - POP_GAP - POP_EDGE
    // Only flip when it does not fit below AND there is genuinely more room up.
    const flip = h > below && above > below
    const maxH = Math.max(120, flip ? above : below)
    const top = flip ? Math.max(POP_EDGE, a.top - POP_GAP - Math.min(h, maxH)) : a.bottom + POP_GAP

    setPos((prev) =>
      prev && prev.left === left && prev.top === top && prev.maxH === maxH ? prev : { left, top, maxH },
    )
  }, [align])

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    place()
    window.addEventListener('resize', place)
    // Capture phase: the board and the ladders scroll in their own containers,
    // and those scrolls do not bubble to window.
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  if (!open || typeof document === 'undefined') return null

  return (
    <>
      {/*
        Stays in the DOM where the popover used to be, so `offsetParent` still
        resolves to the trigger's wrapper after the panel itself has left for
        <body>. Zero-size and inert — it draws nothing and catches nothing.
      */}
      <span ref={anchorRef} aria-hidden className="pointer-events-none absolute left-0 top-0 block h-0 w-0" />
      {createPortal(
        <div
          ref={ref}
          style={{
            position: 'fixed',
            left: pos?.left ?? 0,
            top: pos?.top ?? 0,
            zIndex: POP_Z,
            maxHeight: pos?.maxH,
            // Hidden for the one frame between mounting (needed to measure the
            // panel) and having somewhere to put it.
            visibility: pos ? 'visible' : 'hidden',
          }}
          className="overflow-y-auto rounded-md border border-line bg-surface p-2 shadow-lg"
        >
          {children}
        </div>,
        document.body,
      )}
    </>
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
