// ─────────────────────────────────────────────────────────────────────────────
// THE TICKER PICKER — searchable dropdown over the scanner universe, with
// star-to-favourite. Favourites float to the top and persist per browser.
//
// It started life inside the option chain (v2 had one there, because v2 had no
// board-wide symbol). It is a primitive now because the APP TOOLBAR owns it:
// one control, at the top of the frame, setting the symbol every page follows.
// The chain no longer carries its own — two places to change the same thing is
// how you end up looking at three symbols at once and not notice.
//
// The replay ladder is the one other consumer, and deliberately so: it picks
// from whatever the RECORDER has, which is a different and usually shorter list
// than the board's, so it passes its own `universe`.
//
// The scanner list is fetched on FIRST OPEN, not on mount. This control renders
// on every route, so an unconditional fetch here is a request on the critical
// path of every page load for a list nobody has asked to see — and the static
// fallback already draws the menu correctly. See data/scannerUniverse.ts.
//
// Portalled to <body> and re-anchored on scroll in the CAPTURE phase — the pages
// under this scroll in their own containers, and those scrolls do not bubble to
// window.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { alpha, LEVEL_COLORS, SHADOW, T } from '@/design/theme'
import { useScannerUniverse } from '@/data/scannerUniverse'

/** Above every other layer the app can raise, including a page's own popovers. */
const MENU_Z = 100010

/**
 * Board-wide, not page-scoped: the picker is app chrome now, so a ticker you
 * starred is starred everywhere. (v2's key was `options-chain-fav-tickers-v1`
 * and was per-page; v3 starts this list fresh rather than inheriting a name
 * that no longer describes what it is.)
 */
const FAV_TICKERS_KEY = 'cb-v3-fav-tickers'

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

export function TickerPicker({
  activeTicker,
  universe,
  onSelect,
  triggerLabel,
  title,
}: {
  activeTicker: string
  /** Omit to use the scanner universe, fetched on first open. The replay ladder
   *  passes its own, because a session can only be replayed for a root the
   *  RECORDER actually swept — a shorter list than the board's. */
  universe?: string[]
  onSelect: (t: string) => void
  /** Defaults to the active ticker itself — in the app toolbar the control IS
   *  the readout, so a static word there would waste the one slot that can say
   *  which symbol the board is on. */
  triggerLabel?: string
  title?: string
}) {
  const [open, setOpen] = useState(false)
  // Sticky: once the menu has been opened the list stays live, so reopening it
  // is instant rather than re-deciding whether to fetch.
  const [everOpened, setEverOpened] = useState(false)
  const scanner = useScannerUniverse(everOpened && !universe)
  const list = universe ?? scanner
  const [queryText, setQueryText] = useState('')
  const [favs, setFavs] = useState<string[]>([])
  const hostRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    setFavs(loadFavTickers())
  }, [])

  useEffect(() => {
    if (!open) return
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) setRect({ left: r.left, top: r.bottom + 3 })
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
    function h(e: MouseEvent) {
      const t = e.target as Node
      if (hostRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    function k(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', k)
    }
  }, [])

  // The search box starts EMPTY every time the menu opens. Keeping the last
  // query is only ever right if the next search is a prefix of the last one;
  // every other time — and the common case is picking a ticker, coming back, and
  // wanting a DIFFERENT one — the list reopens pre-filtered to something stale
  // and the first thing you have to do is clear a box you did not fill in.
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
  const matches = list.filter((t) => !q || t.includes(q))
  const favList = matches.filter((t) => favSet.has(t)).sort()
  const rest = matches.filter((t) => !favSet.has(t)).sort()
  const rows: Array<{ t: string; fav: boolean; divider?: boolean }> = [
    ...favList.map((t) => ({ t, fav: true })),
    // Only when BOTH groups have something — a divider above an empty list is a
    // rule that separates nothing.
    ...(favList.length && rest.length ? [{ t: '__divider__', fav: false, divider: true }] : []),
    ...rest.map((t) => ({ t, fav: false })),
  ]

  return (
    <div ref={hostRef} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={() => {
          setEverOpened(true)
          setOpen((o) => !o)
        }}
        title={title}
        aria-label="Ticker"
        className="text-xs"
        style={{
          fontWeight: 800,
          padding: '4px 10px',
          border: `1px solid ${open ? alpha(T.cyan, 0.55) : T.border}`,
          borderRadius: 999,
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
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {triggerLabel ?? activeTicker}
        <span className="text-2xs" style={{ opacity: 0.7 }}>
          ▾
        </span>
      </button>
      {open &&
        rect &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              left: rect.left,
              top: rect.top,
              zIndex: MENU_Z,
              width: 200,
              background: T.panel,
              border: `1px solid ${T.border}`,
              borderTop: `2px solid ${alpha(T.cyan, 0.5)}`,
              borderRadius: 6,
              boxShadow: `0 8px 32px ${alpha(SHADOW, 0.7)}`,
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: 6, borderBottom: `1px solid ${T.border}` }}>
              <input
                autoFocus
                value={queryText}
                onChange={(e) => setQueryText(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  // Enter takes the first row — the whole point of typing three
                  // letters is not to then have to aim at the result.
                  if (e.key !== 'Enter') return
                  const firstReal = rows.find((r) => !r.divider)
                  if (!firstReal) return
                  onSelect(firstReal.t)
                  setOpen(false)
                }}
                placeholder="Search…"
                spellCheck={false}
                autoComplete="off"
                className="text-xs"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
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
                <div className="text-2xs" style={{ padding: '8px 12px', color: T.muted }}>
                  No match
                </div>
              )}
              {rows.map((row) => {
                if (row.divider) {
                  return <div key="div" style={{ height: 1, background: T.border, margin: '3px 8px' }} />
                }
                const active = row.t === activeTicker.toUpperCase()
                return (
                  <div
                    key={row.t}
                    className="text-xs"
                    onClick={() => {
                      onSelect(row.t)
                      setOpen(false)
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '5px 10px',
                      fontWeight: active ? 800 : 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      color: active ? T.cyan : T.text,
                      background: active ? alpha(T.cyan, 0.1) : 'transparent',
                      letterSpacing: '0.04em',
                    }}
                  >
                    <span
                      onClick={(e) => {
                        // Starring must not also select — they are the two
                        // things you can do to a row and they are 12px apart.
                        e.stopPropagation()
                        toggleFav(row.t)
                      }}
                      title={row.fav ? 'Unfavorite' : 'Favorite'}
                      className="text-sm"
                      style={{
                        cursor: 'pointer',
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
