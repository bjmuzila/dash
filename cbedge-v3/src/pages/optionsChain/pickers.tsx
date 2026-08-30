// ─────────────────────────────────────────────────────────────────────────────
// The chain's two portal'd menus.
//
// Not design/primitives/Controls.tsx's Popover, deliberately: that one is a
// panel anchored to a card's cog and clamped to the viewport. These two anchor
// to a toolbar button, re-anchor on scroll (capture phase — the grid scrolls in
// its own container) and are a LIST, which is a different job. If a third page
// wants either of them they move to primitives, and not before.
//
// Spec: docs/parity/options-chain.md — Part C1 / C2.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { alpha, LEVEL_COLORS, SHADOW, T } from '@/design/theme'

/** Above every other layer this page can raise. */
const MENU_Z = 100010

const FAV_TICKERS_KEY = 'options-chain-fav-tickers-v1'

function loadFavTickers(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(FAV_TICKERS_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function saveFavTickers(list: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(FAV_TICKERS_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

/** Keeps a portal'd menu under its trigger through scrolls and resizes. */
function useAnchor(open: boolean, btnRef: React.RefObject<HTMLButtonElement | null>) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null)
  useEffect(() => {
    if (!open) return
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) setRect({ left: r.left, top: r.bottom + 3, width: r.width })
    }
    update()
    // Capture phase: the grid scrolls in its own container, and that scroll does
    // not bubble to window.
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, btnRef])
  return rect
}

/** Outside pointer-down closes. The trigger and the portal'd panel both count as inside. */
function useDismiss(hostRef: React.RefObject<HTMLElement | null>, menuRef: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    function h(e: MouseEvent) {
      const t = e.target as Node
      if (hostRef.current?.contains(t) || menuRef.current?.contains(t)) return
      close()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [hostRef, menuRef, close])
}

const menuPanelStyle = (extra: React.CSSProperties): React.CSSProperties => ({
  position: 'fixed',
  zIndex: MENU_Z,
  background: T.panel,
  border: `1px solid ${T.border}`,
  borderTop: `2px solid ${alpha(T.cyan, 0.5)}`,
  borderRadius: 6,
  boxShadow: `0 8px 32px ${alpha(SHADOW, 0.7)}`,
  ...extra,
})

const rowStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  fontSize: 10,
  fontWeight: active ? 800 : 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  color: active ? T.cyan : T.text,
  background: active ? alpha(T.cyan, 0.1) : 'transparent',
  letterSpacing: '0.04em',
})

// ── A plain value dropdown ───────────────────────────────────────────────────

export function ChainDropdown<TValue extends string | number>({
  value,
  options,
  onChange,
  formatLabel,
  triggerLabel,
  accent = true,
}: {
  value: TValue
  options: readonly TValue[]
  onChange: (v: TValue) => void
  formatLabel?: (v: TValue) => string
  triggerLabel?: string
  accent?: boolean
}) {
  const [open, setOpen] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const rect = useAnchor(open, btnRef)
  useDismiss(hostRef, menuRef, () => setOpen(false))

  const label = triggerLabel ?? (formatLabel ? formatLabel(value) : String(value))

  return (
    <div ref={hostRef} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        style={{
          fontSize: 10,
          fontWeight: 700,
          padding: '5px 10px',
          border: `1px solid ${accent ? alpha(T.cyan, 0.25) : T.border}`,
          borderRadius: 6,
          background: accent
            ? `linear-gradient(180deg,${alpha(T.cyan, 0.12)},${alpha(T.cyan, 0.04)})`
            : alpha(T.text, 0.04),
          color: accent ? T.cyan : T.text,
          cursor: 'pointer',
          outline: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          whiteSpace: 'nowrap',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {label}
        <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {open &&
        rect &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={menuPanelStyle({
              left: rect.left,
              top: rect.top,
              minWidth: rect.width,
              padding: '3px 0',
              maxHeight: 320,
              overflowY: 'auto',
            })}
          >
            {options.map((opt) => {
              const active = opt === value
              return (
                <div
                  key={String(opt)}
                  onClick={() => {
                    onChange(opt)
                    setOpen(false)
                  }}
                  style={rowStyle(active)}
                >
                  {formatLabel ? formatLabel(opt) : String(opt)}
                </div>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}

// ── The ticker picker ────────────────────────────────────────────────────────

export function TickerListDropdown({
  activeTicker,
  universe,
  onSelect,
}: {
  activeTicker: string
  universe: string[]
  onSelect: (t: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [queryText, setQueryText] = useState('')
  const [favs, setFavs] = useState<string[]>([])
  const hostRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const rect = useAnchor(open, btnRef)
  useDismiss(hostRef, menuRef, () => setOpen(false))

  useEffect(() => {
    setFavs(loadFavTickers())
  }, [])

  // The search box starts EMPTY every time the menu opens. Keeping the last
  // query is only ever right if the next search is a prefix of the last one;
  // every other time the list reopens pre-filtered to something stale and the
  // first thing you have to do is clear a box you did not fill in.
  //
  // Cleared on CLOSE rather than on open, so the menu never renders one frame of
  // stale filtering on the way in.
  useEffect(() => {
    if (!open) setQueryText('')
  }, [open])

  const toggleFav = (t: string) =>
    setFavs((prev) => {
      const next = prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
      saveFavTickers(next)
      return next
    })

  const favSet = new Set(favs)
  const q = queryText.trim().toUpperCase()
  const matches = universe.filter((t) => !q || t.includes(q))
  const favList = matches.filter((t) => favSet.has(t)).sort()
  const rest = matches.filter((t) => !favSet.has(t)).sort()
  const rows: Array<{ t: string; fav: boolean; divider?: boolean }> = [
    ...favList.map((t) => ({ t, fav: true })),
    ...(favList.length && rest.length ? [{ t: '__divider__', fav: false, divider: true }] : []),
    ...rest.map((t) => ({ t, fav: false })),
  ]

  return (
    <div ref={hostRef} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        style={{
          fontSize: 10,
          fontWeight: 700,
          padding: '5px 10px',
          border: `1px solid ${T.border}`,
          borderRadius: 6,
          background: alpha(T.text, 0.04),
          color: T.text,
          cursor: 'pointer',
          outline: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          whiteSpace: 'nowrap',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        Tickers
        <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {open &&
        rect &&
        typeof document !== 'undefined' &&
        createPortal(
          <div ref={menuRef} style={menuPanelStyle({ left: rect.left, top: rect.top, width: 200, overflow: 'hidden' })}>
            <div style={{ padding: 6, borderBottom: `1px solid ${T.border}` }}>
              <input
                autoFocus
                value={queryText}
                onChange={(e) => setQueryText(e.target.value.toUpperCase())}
                placeholder="Search…"
                spellCheck={false}
                autoComplete="off"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '5px 8px',
                  border: `1px solid ${T.border}`,
                  borderRadius: 5,
                  background: alpha(T.text, 0.04),
                  color: T.text,
                  outline: 'none',
                  letterSpacing: '0.06em',
                }}
              />
            </div>
            <div style={{ maxHeight: 300, overflowY: 'auto', padding: '3px 0' }}>
              {rows.length === 0 && (
                <div style={{ padding: '8px 12px', fontSize: 10, color: T.muted }}>No match</div>
              )}
              {rows.map((row) => {
                if (row.divider) {
                  return <div key="div" style={{ height: 1, background: T.border, margin: '3px 8px' }} />
                }
                const active = row.t === activeTicker.toUpperCase()
                return (
                  <div
                    key={row.t}
                    onClick={() => {
                      onSelect(row.t)
                      setOpen(false)
                    }}
                    style={{ ...rowStyle(active), display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', fontSize: 11 }}
                  >
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFav(row.t)
                      }}
                      title={row.fav ? 'Unfavorite' : 'Favorite'}
                      style={{
                        cursor: 'pointer',
                        fontSize: 12,
                        lineHeight: 1,
                        color: row.fav ? LEVEL_COLORS.cb : alpha(T.text, 0.28),
                      }}
                    >
                      {row.fav ? '★' : '☆'}
                    </span>
                    <span>{row.t}</span>
                  </div>
                )
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
