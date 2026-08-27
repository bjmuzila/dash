import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SYMBOLS,
  TICKER_RE,
  loadFavSymbols,
  loadRoster,
  normalizeSymbol,
  saveFavSymbols,
  symbolDef,
} from './symbols'

// ─────────────────────────────────────────────────────────────────────────────
// The small controls the chart's toolbar and settings panel are built from.
//
// Structural only — every colour comes from a token utility, nothing here
// carries a literal. They live together in one file because they are all
// four-to-twenty-line pieces that only this card uses; promoting them to
// src/design/primitives is the right move the moment a second card wants one,
// and not before.
// ─────────────────────────────────────────────────────────────────────────────

export function SegGroup<T extends string>({
  options,
  value,
  onChange,
  title,
}: {
  options: Array<{ label: string; value: T }>
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

export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  title,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  title?: string
}) {
  return (
    <label className="flex items-center gap-2 text-[10px] text-muted" title={title}>
      <span className="w-14 shrink-0 opacity-70">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-0 flex-1 accent-[var(--color-accent)]"
      />
      <span className="tabular w-10 shrink-0 text-right">{format(value)}</span>
    </label>
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

// ── Symbol picker ────────────────────────────────────────────────────────────
// Curated list, then the server roster, then whatever the user types. Stars
// float a symbol to the top and are shared with v2 through the same
// localStorage key, so a user's favourites survive the move between the two.

export function SymbolPicker({ active, onSelect }: { active: string; onSelect: (s: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [roster, setRoster] = useState<string[]>([])
  const [favs, setFavs] = useState<string[]>(() => loadFavSymbols())

  // Lazily, on first open — never on mount. A dropdown nobody opens should
  // cost nothing.
  useEffect(() => {
    if (!open) return
    let alive = true
    void loadRoster().then((list) => {
      if (alive) setRoster(list)
    })
    return () => {
      alive = false
    }
  }, [open])

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase()
    const curated = SYMBOLS.map((s) => s.key)
    const curatedSet = new Set(curated)
    const merged = [...curated, ...roster.filter((r) => !curatedSet.has(r))]
    const matched = q ? merged.filter((k) => k.includes(q)) : merged
    const favSet = new Set(favs)
    const fav = matched.filter((k) => favSet.has(k))
    const rest = matched.filter((k) => !favSet.has(k))
    return { fav, rest, freeform: q && !merged.includes(q) && TICKER_RE.test(q) ? q : null }
  }, [query, roster, favs])

  const pick = (key: string) => {
    onSelect(normalizeSymbol(key))
    setOpen(false)
    setQuery('')
  }

  const toggleFav = (key: string) => {
    setFavs((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      saveFavSymbols(next)
      return next
    })
  }

  const row = (key: string) => (
    <div key={key} className="flex items-center gap-1 rounded-sm px-1 hover:bg-raised">
      <button type="button" onClick={() => pick(key)} className="flex-1 truncate py-1 text-left text-xs text-fg">
        {key}
      </button>
      <button
        type="button"
        onClick={() => toggleFav(key)}
        title={favs.includes(key) ? 'Unstar' : 'Star'}
        className={['px-1 text-xs', favs.includes(key) ? 'text-warn' : 'text-faint opacity-40 hover:opacity-80'].join(' ')}
      >
        {favs.includes(key) ? '★' : '☆'}
      </button>
    </div>
  )

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Chart symbol"
        className="flex items-center gap-1 rounded-sm border border-line px-2 py-0.5 text-xs font-bold tracking-wide text-fg hover:bg-raised"
      >
        {symbolDef(active).label}
        <span className="text-[9px] opacity-50">▾</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="left">
        <div className="w-44">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && rows.freeform) pick(rows.freeform)
            }}
            placeholder="Search tickers…"
            className="mb-1 w-full rounded-sm border border-line bg-bg px-2 py-1 text-xs text-fg outline-none focus:border-accent"
          />
          <div className="max-h-64 overflow-y-auto">
            {rows.freeform && (
              <button
                type="button"
                onClick={() => pick(rows.freeform!)}
                className="mb-1 block w-full rounded-sm bg-raised px-2 py-1 text-left text-xs text-fg"
              >
                Chart {rows.freeform}
              </button>
            )}
            {rows.fav.map(row)}
            {rows.fav.length > 0 && rows.rest.length > 0 && <div className="my-1 border-t border-line" />}
            {rows.rest.map(row)}
            {rows.fav.length === 0 && rows.rest.length === 0 && !rows.freeform && (
              <div className="px-2 py-2 text-xs text-faint opacity-60">No match</div>
            )}
          </div>
        </div>
      </Popover>
    </div>
  )
}
