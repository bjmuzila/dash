import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Page } from '@/design/primitives/Page'
import { Card } from '@/design/primitives/Card'
import { Board, compactBoard, type BoardItem } from '@/design/primitives/Board'
import { useAuth } from '@/data/auth'
import { CARD_CATALOG, CARD_BY_ID, cardTypeOf, placeNewCard } from './catalog'
import {
  fetchServerLayout,
  readLocalLayout,
  readSyncedLayout,
  sameLayout,
  saveServerLayout,
  writeLocalLayout,
  writeSyncedLayout,
} from './layoutStore'

// ─────────────────────────────────────────────────────────────────────────────
// The terminal home: a customizable card board. Add cards from the catalog,
// drag/resize them, remove the ones you don't want — the arrangement autosaves
// as you go and reloads next visit.
//
// ── Two tiers of persistence, and why ────────────────────────────────────────
// AUTOSAVE is localStorage, on every gesture: free, synchronous, per browser.
// "SAVE LAYOUT" (edit mode) writes the same array to Postgres through v2's
// /api/dashboard-layout, per account, so the board follows the user to another
// machine. See src/board/layoutStore.ts for the wire and for cb-v3-board-synced,
// the third key that decides which copy wins on load.
//
// The autosave is deliberately NOT the thing that hits the network. A drag emits
// a layout per animation frame; posting those would be a request storm, and it
// would make every accidental nudge permanent across every device the user owns.
// Saving to the account is an act, not a side effect.
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
// storage key, which is a change to every card and not to this file. It is also
// why "Save layout" saves the ARRANGEMENT and not the settings: the server would
// be storing a per-type key it cannot attribute to a card.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_IDS = ['gex-candles', 'key-levels', 'quick-links']

function defaultLayout(): BoardItem[] {
  let items: BoardItem[] = []
  for (const id of DEFAULT_IDS) items = [...items, placeNewCard(id, items)]
  return compactBoard(items)
}

type Remote = 'idle' | 'loading' | 'saving' | 'error'

export default function BoardPage() {
  const { isSignedIn, isLoaded } = useAuth()

  // Read both keys ONCE, before anything can rewrite them. `boot.local` vs
  // `boot.synced` is the whole basis for deciding whether the server copy may
  // replace what is on screen, and the autosave effect below overwrites the
  // local key on the first change — so it has to be captured at mount.
  const [boot] = useState(() => ({ local: readLocalLayout(), synced: readSyncedLayout() }))

  const [layout, setLayoutState] = useState<BoardItem[]>(() => boot.local ?? defaultLayout())
  const [synced, setSynced] = useState<BoardItem[] | null>(() => boot.synced)
  const [locked, setLocked] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [flash, setFlash] = useState(false)
  const [remote, setRemote] = useState<Remote>('idle')
  const [remoteErr, setRemoteErr] = useState<string | null>(null)
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
    writeLocalLayout(layout)
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 1200)
    return () => clearTimeout(t)
  }, [layout])

  // Load the account's saved board once auth answers.
  //
  // It replaces what is on screen ONLY when this browser holds nothing the
  // server hasn't seen — local === synced, or a first visit with no local key
  // at all. Otherwise the local arrangement stays and the header says it is
  // unsaved, because silently discarding it is the one outcome that loses work.
  useEffect(() => {
    if (!isSignedIn) return
    const ac = new AbortController()
    let alive = true
    setRemote('loading')
    setRemoteErr(null)
    fetchServerLayout(ac.signal)
      .then((tpl) => {
        if (!alive) return
        setRemote('idle')
        if (!tpl) return
        setSynced(tpl.layout)
        writeSyncedLayout(tpl.layout)
        const localUnsaved = boot.local != null && !sameLayout(boot.local, boot.synced)
        if (!localUnsaved) setLayoutState(compactBoard(tpl.layout))
      })
      .catch((err: Error) => {
        if (!alive || err.name === 'AbortError') return
        setRemote('error')
        setRemoteErr(err.message)
      })
    return () => {
      alive = false
      ac.abort()
    }
  }, [isSignedIn, boot])

  const dirty = !sameLayout(layout, synced)

  const saveLayout = useCallback(async () => {
    const snapshot = layout
    setRemote('saving')
    setRemoteErr(null)
    try {
      await saveServerLayout(snapshot)
      setSynced(snapshot)
      writeSyncedLayout(snapshot)
      setRemote('idle')
      setFlash(true)
      setTimeout(() => setFlash(false), 1200)
    } catch (err) {
      setRemote('error')
      setRemoteErr((err as Error).message)
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

  // One status line, in priority order: what the network is doing, then what is
  // outstanding, then the local-autosave flash. Never two at once — a header
  // that says "Saved" and "Unsaved layout" side by side is worse than silent.
  const status: { text: string; tone: 'faint' | 'muted' | 'down' } | null =
    remote === 'saving'
      ? { text: 'Saving…', tone: 'muted' }
      : remote === 'error'
        ? { text: remoteErr ? `Save failed — ${remoteErr}` : 'Save failed', tone: 'down' }
        : remote === 'loading'
          ? { text: 'Loading layout…', tone: 'faint' }
          : !locked && isSignedIn && dirty
            ? { text: 'Unsaved layout', tone: 'muted' }
            : flash
              ? { text: 'Saved', tone: 'faint' }
              : null

  const toneClass =
    status?.tone === 'down' ? 'text-down' : status?.tone === 'muted' ? 'text-muted' : 'text-faint'

  return (
    <Page
      title="Terminal"
      fill
      actions={
        <div className="flex items-center gap-2">
          {status && <span className={`text-xs ${toneClass}`}>{status.text}</span>}
          {/* Save layout belongs to edit mode: it is the counterpart of the
              gestures that made the board dirty, and out of edit mode there is
              nothing the user could have changed. */}
          {!locked && (
            <button
              onClick={() => void saveLayout()}
              disabled={!isSignedIn || remote === 'saving' || !dirty}
              title={
                !isLoaded
                  ? 'Checking your account…'
                  : !isSignedIn
                    ? 'Sign in to save this layout to your account'
                    : !dirty
                      ? 'This layout is already saved to your account'
                      : 'Save this layout to your account, for every browser you sign in on'
              }
              className="rounded-sm border border-line bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-raised disabled:cursor-default disabled:opacity-40 disabled:hover:bg-surface"
            >
              Save layout
            </button>
          )}
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
