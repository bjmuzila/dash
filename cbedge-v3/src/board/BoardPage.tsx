import { useEffect, useMemo, useRef, useState } from 'react'
import { Page } from '@/design/primitives/Page'
import { Card } from '@/design/primitives/Card'
import { Board, compactBoard, type BoardItem } from '@/design/primitives/Board'
import { CARD_CATALOG, CARD_BY_ID, placeNewCard } from './catalog'

// ─────────────────────────────────────────────────────────────────────────────
// The terminal home: a customizable card board. Add cards from the catalog,
// drag/resize them, remove the ones you don't want — the arrangement autosaves
// as you go and reloads next visit.
//
// Persistence is localStorage for now (per-browser). The shape is the same
// BoardItem[] a server-backed template would round-trip, so swapping this for
// a REST-backed save (through src/data/api.ts, once that endpoint exists) is a
// change to loadLayout/persist only — nothing above this file needs to know.
// ─────────────────────────────────────────────────────────────────────────────

const LAYOUT_KEY = 'cb-v3-board-layout'
const DEFAULT_IDS = ['es-candles', 'key-levels', 'quick-links']

function defaultLayout(): BoardItem[] {
  let items: BoardItem[] = []
  for (const id of DEFAULT_IDS) items = [...items, placeNewCard(id, items)]
  return compactBoard(items)
}

function loadLayout(): BoardItem[] {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultLayout()
    // Drop any card id the catalog no longer has, so a shipped catalog change
    // never leaves a dead tile on someone's saved board.
    const kept = parsed.filter(
      (i): i is BoardItem =>
        i && typeof i.id === 'string' && CARD_BY_ID.has(i.id) &&
        [i.x, i.y, i.w, i.h].every((n) => typeof n === 'number'),
    )
    return kept.length ? compactBoard(kept) : defaultLayout()
  } catch {
    return defaultLayout()
  }
}

type SaveState = 'idle' | 'saved'

export default function BoardPage() {
  const [layout, setLayoutState] = useState<BoardItem[]>(() => loadLayout())
  const [locked, setLocked] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const savedOnceRef = useRef(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Autosave — every layout change (drag, resize, add, remove) persists
  // immediately. There's nothing to debounce against: it's a local write, not
  // a network round trip.
  useEffect(() => {
    if (!savedOnceRef.current) {
      savedOnceRef.current = true
      return
    }
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
      setSaveState('saved')
      const t = setTimeout(() => setSaveState('idle'), 1200)
      return () => clearTimeout(t)
    } catch {
      /* best-effort — the in-memory layout still works for this session */
    }
  }, [layout])

  // Close the add-card menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  const presentIds = useMemo(() => new Set(layout.map((i) => i.id)), [layout])
  const available = CARD_CATALOG.filter((c) => !presentIds.has(c.id))

  const addCard = (id: string) => {
    setLayoutState((prev) => compactBoard([...prev, placeNewCard(id, prev)]))
    setMenuOpen(false)
  }
  const removeCard = (id: string) => {
    setLayoutState((prev) => compactBoard(prev.filter((i) => i.id !== id)))
  }

  return (
    <Page
      title="Terminal"
      fill
      actions={
        <div className="flex items-center gap-2">
          {saveState === 'saved' && <span className="text-xs text-faint">Saved</span>}
          <button
            onClick={() => setLocked((v) => !v)}
            className={[
              'rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
              locked ? 'text-muted hover:text-fg' : 'bg-raised text-fg',
            ].join(' ')}
          >
            {locked ? 'Edit layout' : 'Done'}
          </button>
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              disabled={available.length === 0}
              className="rounded-sm bg-accent px-2.5 py-1 text-xs font-medium text-bg disabled:opacity-40"
            >
              + Add card
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-line bg-surface py-1 shadow-lg">
                {available.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-faint">All cards are on the board</div>
                ) : (
                  available.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => addCard(c.id)}
                      className="block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-raised"
                    >
                      {c.label}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Board
          layout={layout}
          onLayoutChange={setLayoutState}
          locked={locked}
          render={(id) => {
            const def = CARD_BY_ID.get(id)
            if (!def) return null
            return (
              <Card
                title={
                  <span data-board-handle className={locked ? 'block' : 'block cursor-grab select-none'}>
                    {def.label}
                  </span>
                }
                actions={
                  !locked && (
                    <button
                      onClick={() => removeCard(id)}
                      title="Remove card"
                      className="text-xs text-faint hover:text-down"
                    >
                      ✕
                    </button>
                  )
                }
                fill
              >
                {def.render()}
              </Card>
            )
          }}
        />
      </div>
    </Page>
  )
}
