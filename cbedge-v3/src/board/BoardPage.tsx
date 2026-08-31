import { useEffect, useMemo, useRef, useState } from 'react'
import { Page } from '@/design/primitives/Page'
import { Card } from '@/design/primitives/Card'
import { Board, compactBoard, type BoardItem } from '@/design/primitives/Board'
import { CARD_CATALOG, CARD_BY_ID, cardTypeOf, migrateCardId, placeNewCard } from './catalog'

// ─────────────────────────────────────────────────────────────────────────────
// The terminal home: a customizable card board. Add cards from the catalog,
// drag/resize them, remove the ones you don't want — the arrangement autosaves
// as you go and reloads next visit.
//
// Persistence is localStorage for now (per-browser). The shape is the same
// BoardItem[] a server-backed template would round-trip, so swapping this for
// a REST-backed save (through src/data/api.ts, once that endpoint exists) is a
// change to loadLayout/persist only — nothing above this file needs to know.
//
// ── The same card, more than once ────────────────────────────────────────────
// Every catalog entry can be added as many times as the user wants: two GEX
// Charts on different bases, three ladders, a second calendar. A grid item's id
// is therefore an INSTANCE id (`gex-chart`, `gex-chart#2`, …) and the catalog is
// looked up through `cardTypeOf()`. See the block in catalog.tsx for why the
// first instance keeps the bare id.
//
// KNOWN, and deliberate for now: a card's own settings are stored per card TYPE
// (`cb-v3-mg-basis`, and friends), not per instance. Two copies can be set
// differently for the session, but on reload both come back on whichever was
// written last. Fixing that means threading the instance id into every card's
// storage key, which is a change to every card and not to this file.
// ─────────────────────────────────────────────────────────────────────────────

const LAYOUT_KEY = 'cb-v3-board-layout'
const DEFAULT_IDS = ['gex-candles', 'key-levels', 'quick-links']

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
    const kept: BoardItem[] = []
    const seen = new Set<string>()
    for (const i of parsed) {
      if (!i || typeof i.id !== 'string') continue
      if (![i.x, i.y, i.w, i.h].every((n: unknown) => typeof n === 'number')) continue
      // Rename BEFORE the catalog check. A renamed card is still the user's
      // card — dropping it because its id changed would silently empty their
      // board on an upgrade. A card that was genuinely deleted still falls out
      // here, which is what should happen.
      //
      // The dedupe is on the INSTANCE id, not the card type: two GEX Charts is
      // a board the user built on purpose, while the same instance id twice is
      // a corrupt blob that would collide in the grid.
      const id = migrateCardId(i.id)
      if (!CARD_BY_ID.has(cardTypeOf(id)) || seen.has(id)) continue
      seen.add(id)
      kept.push({ id, x: i.x, y: i.y, w: i.w, h: i.h })
    }
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

  /**
   * How many of each card type are on the board. The menu no longer REMOVES an
   * entry once it is used — every card can be added again — so the count is what
   * tells the user a second copy is what they are about to get.
   */
  const countByType = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of layout) {
      const t = cardTypeOf(i.id)
      m.set(t, (m.get(t) ?? 0) + 1)
    }
    return m
  }, [layout])

  /**
   * A card's number within its own type, by instance id — `2` for the second GEX
   * Chart. Only used when there IS more than one: a lone card is just its name.
   */
  const ordinalById = useMemo(() => {
    const nth = new Map<string, number>()
    const out = new Map<string, number>()
    for (const i of layout) {
      const t = cardTypeOf(i.id)
      const n = (nth.get(t) ?? 0) + 1
      nth.set(t, n)
      out.set(i.id, n)
    }
    return out
  }, [layout])

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
              className="rounded-sm bg-accent px-2.5 py-1 text-xs font-medium text-bg"
            >
              + Add card
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-60 rounded-md border border-line bg-surface py-1 shadow-lg">
                {/* Every card, every time — nothing is removed from this list
                    once it is on the board. The count on the right is what says
                    "you already have one of these", which is information; a
                    missing row was only ever a refusal. */}
                {CARD_CATALOG.map((c) => {
                  const n = countByType.get(c.id) ?? 0
                  return (
                    <button
                      key={c.id}
                      onClick={() => addCard(c.id)}
                      title={n > 0 ? `Add another ${c.label} — ${n} on the board` : `Add ${c.label}`}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-fg hover:bg-raised"
                    >
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {n > 0 && <span className="shrink-0 text-xs text-faint">×{n}</span>}
                    </button>
                  )
                })}
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
            const def = CARD_BY_ID.get(cardTypeOf(id))
            if (!def) return null
            // Copies are numbered in the header, and only when there is more
            // than one — two cards with identical titles is a board you cannot
            // talk about, and a "1" on a card that has no sibling is noise.
            const nth = (countByType.get(cardTypeOf(id)) ?? 0) > 1 ? ordinalById.get(id) : undefined
            // A card may supply a LIVE header (the page ticker, the contract
            // date its numbers came from) in place of the static label — see
            // CardDef.Title. Rendered as an element, never called: it holds
            // hooks of its own and calling it here would make them this
            // component's, conditionally.
            const Title = def.Title
            return (
              <Card
                title={
                  <span data-board-handle className={locked ? 'block' : 'block cursor-grab select-none'}>
                    {Title ? <Title /> : def.label}
                    {nth != null && <span className="ml-1.5 text-faint">{nth}</span>}
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
