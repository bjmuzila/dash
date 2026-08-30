// Part P — the searchable symbol picker, shared by Ticker Levels and Ticker
// Lookup so this page has ONE ticker menu rather than two that drift.
//
// Modelled on the Options Chain page's TICKERS dropdown: a bordered trigger, a
// portal'd frosted panel with a 2px cyan top accent, a search field,
// star-to-favourite with favourites floated to the top, click-outside and Esc
// to close.
//
// ONE THING IT DOES THAT THE CHAIN'S PICKER DOES NOT: a query matching no listed
// symbol offers to ADD it. The scanner universe is not everything the walls
// tables know about — NDX, for instance — so a free-text path has to exist, and
// folding it into the search box is what let v2 delete the separate input and
// "Look up" button that used to sit under the card.
//
// PORTAL'D because both host cards clip their overflow. A menu rendered in flow
// would be cut off by the card that owns it.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LEVEL_COLORS, V2, V2W, alpha, SHADOW } from '@/design/theme'
import { FS } from './kit'

/** localStorage helpers. Private mode and bad JSON both fall back to defaults. */
export function loadList(key: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(key)
    const arr: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function saveList(key: string, list: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

export const FAV_KEY = 'analytics.tickerLevels.favs'

/** Normalise anything typed or pasted into a symbol. */
export function cleanSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9.]/g, '')
}

export function TickerPicker({
  value,
  options,
  custom,
  onSelect,
  onAdd,
  onRemove,
}: {
  value: string
  options: readonly string[]
  /** Symbols that carry an × — the ones this card added, not the universe. */
  custom: readonly string[]
  onSelect: (t: string) => void
  onAdd: (t: string) => void
  onRemove: (t: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [favs, setFavs] = useState<string[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null)

  useEffect(() => {
    setFavs(loadList(FAV_KEY))
  }, [])

  // The panel is position:fixed, so it has to be re-placed on any scroll or
  // resize or it detaches from its trigger. `true` for capture — the scroll that
  // moves the trigger is usually an ancestor's, not the window's.
  useEffect(() => {
    if (!open) return
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) setRect({ left: r.left, top: r.bottom + 3, width: r.width })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  // The search box starts EMPTY every time the menu opens. Choosing or adding
  // already cleared it, but closing any OTHER way — outside click, Escape,
  // re-clicking the trigger — left the query behind, so reopening showed a list
  // pre-filtered by a search you did not make and the first thing you had to do
  // was clear a box you did not fill in.
  //
  // Cleared on CLOSE, not on open, so the menu never renders one frame of stale
  // filtering on the way in.
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const toggleFav = (t: string) =>
    setFavs((prev) => {
      const next = prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
      saveList(FAV_KEY, next)
      return next
    })

  const favSet = new Set(favs)
  const customSet = new Set(custom)
  const q = cleanSymbol(query)
  const matches = options.filter((t) => !q || t.includes(q))
  const favList = matches.filter((t) => favSet.has(t)).sort()
  const rest = matches.filter((t) => !favSet.has(t)).sort()
  const exact = options.some((t) => t === q)
  const rows: Array<{ t: string; fav: boolean; divider?: boolean }> = [
    ...favList.map((t) => ({ t, fav: true })),
    ...(favList.length && rest.length ? [{ t: '__divider__', fav: false, divider: true }] : []),
    ...rest.map((t) => ({ t, fav: false })),
  ]

  const choose = (t: string) => {
    onSelect(t)
    setQuery('')
    setOpen(false)
  }
  const add = () => {
    if (q && !exact) {
      onAdd(q)
      setQuery('')
      setOpen(false)
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="Select ticker"
        style={{
          width: '100%',
          fontSize: FS.row,
          fontWeight: 800,
          padding: '7px 11px',
          border: `1px solid ${V2W.border}`,
          borderRadius: 6,
          background: V2W.wash04,
          color: V2.cyan,
          cursor: 'pointer',
          outline: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          whiteSpace: 'nowrap',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        <span>{value}</span>
        <span style={{ fontSize: FS.micro, opacity: 0.7, color: V2.muted }}>▾</span>
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              left: rect.left,
              top: rect.top,
              zIndex: 9999,
              width: Math.max(rect.width, 200),
              background: V2W.panelSolid,
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: `1px solid ${V2W.border}`,
              borderTop: `2px solid ${V2.cyan}`,
              borderRadius: 6,
              boxShadow: `0 8px 32px ${alpha(SHADOW, 0.7)}`,
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: 6, borderBottom: `1px solid ${V2W.border}` }}>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  const first = rows[0]
                  if (exact) choose(q)
                  else if (first && !first.divider) choose(first.t)
                  else add()
                }}
                placeholder="Search or add…"
                spellCheck={false}
                autoComplete="off"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  fontSize: FS.small,
                  fontWeight: 700,
                  padding: '5px 8px',
                  border: `1px solid ${V2W.border}`,
                  borderRadius: 5,
                  background: V2W.wash04,
                  color: V2.text,
                  outline: 'none',
                  letterSpacing: '0.06em',
                }}
              />
            </div>

            <div style={{ maxHeight: 300, overflowY: 'auto', padding: '3px 0' }}>
              {q && !exact ? (
                <div
                  onClick={add}
                  style={{
                    padding: '6px 10px',
                    fontSize: FS.small,
                    fontWeight: 700,
                    cursor: 'pointer',
                    color: V2.cyan,
                    letterSpacing: '0.04em',
                    borderBottom: rows.length ? `1px solid ${V2W.border}` : undefined,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = V2W.wash05)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  + Add “{q}”
                </div>
              ) : null}

              {rows.length === 0 && !q ? (
                <div style={{ padding: '8px 12px', fontSize: FS.micro, color: V2.muted }}>No tickers</div>
              ) : null}

              {rows.map((row) => {
                if (row.divider) {
                  return (
                    <div
                      key="div"
                      style={{ height: 1, background: V2W.border, margin: '3px 8px' }}
                    />
                  )
                }
                const active = row.t === value.toUpperCase()
                return (
                  <div
                    key={row.t}
                    onClick={() => choose(row.t)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '5px 10px',
                      fontSize: FS.small,
                      fontWeight: active ? 800 : 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      color: active ? V2.cyan : V2.text,
                      background: active ? V2W.pickRow : 'transparent',
                      letterSpacing: '0.04em',
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = active ? V2W.pickRowHover : V2W.wash05)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = active ? V2W.pickRow : 'transparent')
                    }
                  >
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFav(row.t)
                      }}
                      title={row.fav ? 'Unfavorite' : 'Favorite'}
                      style={{
                        cursor: 'pointer',
                        fontSize: FS.caption,
                        lineHeight: 1,
                        // The favourited star is the CB yellow — the same value
                        // v2 types here, already a token because the ladder's CB
                        // tag needs it.
                        color: row.fav ? LEVEL_COLORS.cb : V2W.star,
                      }}
                    >
                      {row.fav ? '★' : '☆'}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>{row.t}</span>
                    {customSet.has(row.t) ? (
                      <span
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemove(row.t)
                        }}
                        title={`Remove ${row.t}`}
                        style={{ cursor: 'pointer', fontSize: FS.caption, lineHeight: 1, color: V2.muted, opacity: 0.7 }}
                      >
                        ×
                      </span>
                    ) : null}
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
