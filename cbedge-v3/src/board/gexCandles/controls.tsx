import { useEffect, useMemo, useState } from 'react'
import { Popover } from '@/design/primitives/Controls'
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
// carries a literal.
//
// SegGroup, Chip, Popover and PanelSection USED to live here, under a note
// saying they should move to src/design/primitives the moment a second card
// wanted one. The GEX Chart card is that second card, so they moved — they are
// now in src/design/primitives/Controls.tsx and re-exported below, so every
// existing `from './controls'` import still resolves.
//
// What is left is the pieces only this card uses.
// ─────────────────────────────────────────────────────────────────────────────

export { SegGroup, SegMenu, Chip, Popover, PanelSection } from '@/design/primitives/Controls'

export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  title,
  disabled = false,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  title?: string
  /**
   * Dim and inert — the row still SHOWS its value, it just cannot be moved.
   *
   * For a setting something else is currently deciding (an Auto mode). Hiding
   * it instead would be worse: the number it holds is the number that comes
   * back the moment Auto is turned off.
   */
  disabled?: boolean
}) {
  return (
    <label
      className={[
        'flex items-center gap-2 text-2xs text-muted',
        disabled ? 'pointer-events-none opacity-40' : '',
      ].join(' ')}
      title={title}
    >
      <span className="w-14 shrink-0 opacity-70">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-0 flex-1 accent-[var(--color-accent)]"
      />
      <span className="tabular w-10 shrink-0 text-right">{format(value)}</span>
    </label>
  )
}

/**
 * A compact value picker: a button showing the current choice, a list under it.
 *
 * Not a native <select>. A styled one is unreliable across browsers for the
 * option list itself — the popup is drawn by the OS and ignores the app's dark
 * palette — and this list needs two lines per row (the label and its date).
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  title,
  empty = 'none',
}: {
  value: T
  options: Array<{ label: string; sub?: string; value: T }>
  onChange: (v: T) => void
  title?: string
  empty?: string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={title}
        disabled={options.length === 0}
        className="flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-2xs font-semibold tracking-wide text-muted hover:bg-raised hover:text-fg disabled:opacity-40"
      >
        {current?.label ?? empty}
        <span className="text-3xs opacity-50">▾</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <div className="flex max-h-64 w-36 flex-col overflow-y-auto">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={[
                'flex items-baseline justify-between gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-raised',
                o.value === value ? 'text-fg' : 'text-muted',
              ].join(' ')}
            >
              <span className="text-xs font-semibold">{o.label}</span>
              {o.sub && <span className="tabular font-mono text-3xs opacity-60">{o.sub}</span>}
            </button>
          ))}
        </div>
      </Popover>
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
        <span className="text-3xs opacity-50">▾</span>
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
