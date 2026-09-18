import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Page } from '@/design/primitives/Page'
import { Card } from '@/design/primitives/Card'
import { Board, compactBoard, resolveBoard, settleBoard, type BoardItem } from '@/design/primitives/Board'
import { useAuth } from '@/data/auth'
import { type CopyShotTarget, useCopyShotTargets } from '@/shell/CopyShot'
import { ToolbarSlot } from '@/shell/ToolbarSlot'
import { CARD_CATALOG, CARD_BY_ID, cardTypeOf, placeNewCard } from './catalog'
import {
  type NamedLayout,
  cleanPresetName,
  deleteServerLayout,
  fetchServerLayout,
  fetchServerLayouts,
  mergePresets,
  readActivePreset,
  readFreeMode,
  readLocalLayout,
  readPresets,
  readSyncedLayout,
  removePreset,
  sameLayout,
  saveServerLayout,
  upsertPreset,
  writeActivePreset,
  writeFreeMode,
  writeLocalLayout,
  writePresets,
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

// ── Named layouts ────────────────────────────────────────────────────────────
// A third thing, beside those two: a LIBRARY. The board can be saved under a
// name and any saved name loaded back — a pre-market board, a 0DTE board, a
// board for the review. The library is per BROWSER (localStorage) for everyone,
// and for the owner it is mirrored into Postgres through the same route, which
// has always held up to 12 named templates per page. See the block at the foot
// of layoutStore.ts.
//
// Loading a preset is an EDIT, not a load: it replaces the working board, the
// local autosave takes it like any gesture, and the header says "Unsaved
// layout" until Save layout is pressed. A board the user was only looking at is
// not one they committed to their account.
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
//
// ── Auto-arrange vs Free placement ───────────────────────────────────────────
// The board shipped with gravity: every gesture floats every card to the first
// free row. That is right for a board you want tidied for you and wrong for one
// you are composing — widening a chart to fill a gap pushed the card beside it
// out of the row and re-floated it somewhere else, so the gap could not be
// filled without losing the neighbour.
//
// "Free placement" — now the DEFAULT — turns the gravity off and keeps the
// no-overlap rule: a card stays where it is dropped, only cards it actually
// overlaps move, and they move by the shortest distance that clears rather than
// being thrown to the bottom of the board. An empty patch of board stays empty.
//
// The other half is the MAGNET (design/primitives/Board.tsx): a dragged card's
// edges are attracted to its neighbours' edges, so "put it anywhere" still ends
// up with the cards touching instead of one column apart. Free placement without
// it would just move the problem — gravity was at least closing the seams.
//
// Switching BACK to auto-arrange compacts once, on the spot, so the two modes
// never disagree about what is on screen. The flag is a per-browser preference,
// not part of the saved layout — see FREE_KEY in layoutStore.ts.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_IDS = ['gex-candles', 'key-levels', 'quick-links']

function defaultLayout(): BoardItem[] {
  let items: BoardItem[] = []
  for (const id of DEFAULT_IDS) items = [...items, placeNewCard(id, items)]
  return compactBoard(items)
}

type Remote = 'idle' | 'loading' | 'saving' | 'error'

export default function BoardPage() {
  const { isSignedIn, isLoaded, isOwner } = useAuth()

  // Read both keys ONCE, before anything can rewrite them. `boot.local` vs
  // `boot.synced` is the whole basis for deciding whether the server copy may
  // replace what is on screen, and the autosave effect below overwrites the
  // local key on the first change — so it has to be captured at mount.
  const [boot] = useState(() => ({ local: readLocalLayout(), synced: readSyncedLayout() }))

  const [layout, setLayoutState] = useState<BoardItem[]>(() => boot.local ?? defaultLayout())
  const [synced, setSynced] = useState<BoardItem[] | null>(() => boot.synced)
  const [locked, setLocked] = useState(true)
  const [free, setFree] = useState(() => readFreeMode())
  const [menuOpen, setMenuOpen] = useState(false)
  const [flash, setFlash] = useState(false)
  const [remote, setRemote] = useState<Remote>('idle')
  const [remoteErr, setRemoteErr] = useState<string | null>(null)
  const savedOnceRef = useRef(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // ── The named-layout library ───────────────────────────────────────────────
  // Read from localStorage at mount for everyone; the owner's account copy is
  // merged over it when the fetch below answers.
  const [presets, setPresets] = useState<NamedLayout[]>(() => readPresets())
  const [activeName, setActiveName] = useState<string | null>(() => readActivePreset())
  const [nameDraft, setNameDraft] = useState(() => readActivePreset() ?? '')
  const [layoutsOpen, setLayoutsOpen] = useState(false)
  const [presetBusy, setPresetBusy] = useState(false)
  const [presetErr, setPresetErr] = useState<string | null>(null)
  const layoutsRef = useRef<HTMLDivElement | null>(null)
  /** The board's scroll port. Its only child is the grid — see shotTargets. */
  const boardRef = useRef<HTMLDivElement | null>(null)

  /**
   * The board's placement rule, in one place. Every path that changes the layout
   * outside a gesture — add, remove, adopting the server copy — goes through it,
   * so none of them can quietly re-compact a free board.
   *
   * `tidy` says whether the dead space gets closed as well (settleBaord vs a
   * bare resolve). ON for the user's own edits — adding or removing a card is a
   * change to the arrangement and the board should come back looking finished.
   * OFF when merely LOADING a saved board: opening the page is not an edit, and
   * a layout that quietly rewrites itself on open would show "Unsaved layout"
   * for a change the user never made.
   */
  const arrange = useCallback(
    (items: BoardItem[], tidy = true) =>
      free ? (tidy ? settleBoard(items) : resolveBoard(items)) : compactBoard(items),
    [free],
  )
  const arrangeRef = useRef(arrange)
  arrangeRef.current = arrange

  /**
   * Flip the mode. Turning free ON changes nothing on screen — the current
   * arrangement is already legal without gravity. Turning it OFF compacts
   * immediately rather than waiting for the next drag, because a board that
   * tidies itself on a gesture the user has not made yet reads as a glitch.
   */
  const toggleFree = useCallback(() => {
    setFree((prev) => {
      const next = !prev
      writeFreeMode(next)
      if (!next) setLayoutState((items) => compactBoard(items))
      return next
    })
  }, [])

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
        if (!localUnsaved) setLayoutState(arrangeRef.current(tpl.layout, false))
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
    // NOT keyed on the placement mode: `arrange` is read through a ref so that
    // flipping free placement does not re-run the fetch and hand the board back
    // whatever the server holds mid-edit.
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

  // ── The owner's library, off the account ───────────────────────────────────
  //
  // Owner only, and that is the whole storage rule: everyone's library is the
  // browser's, the owner's is also the account's. A failure here is SILENT —
  // the local library is already on screen and is the one the board reads, so
  // a request that did not land costs nothing the user can see. It is the save
  // that reports, because that is the one they are waiting on.
  useEffect(() => {
    if (!isOwner) return
    const ac = new AbortController()
    let alive = true
    fetchServerLayouts(ac.signal)
      .then((rows) => {
        if (!alive || rows.length === 0) return
        setPresets((prev) => {
          const merged = mergePresets(prev, rows)
          writePresets(merged)
          return merged
        })
      })
      .catch(() => {
        /* the browser's library still stands */
      })
    return () => {
      alive = false
      ac.abort()
    }
  }, [isOwner])

  /**
   * Save the board on screen under the typed name. Local FIRST and always, so
   * the library is never waiting on a network round trip; the account write is
   * an extra the owner gets, and the only part that can report a failure.
   *
   * `makeDefault: false` — adding "Premarket" to the library must not change
   * which board the next machine opens with. That is what Save layout is for.
   */
  const savePreset = useCallback(async () => {
    const name = cleanPresetName(nameDraft)
    if (!name) {
      setPresetErr('Name this layout first')
      return
    }
    const snapshot = layout
    const next = upsertPreset(presets, name, snapshot)
    setPresets(next)
    writePresets(next)
    setActiveName(name)
    writeActivePreset(name)
    setNameDraft(name)
    setPresetErr(null)
    setFlash(true)
    setTimeout(() => setFlash(false), 1200)
    if (!isOwner) return
    setPresetBusy(true)
    try {
      await saveServerLayout(snapshot, name, false)
    } catch (err) {
      setPresetErr(`Account copy failed — ${(err as Error).message}`)
    } finally {
      setPresetBusy(false)
    }
  }, [nameDraft, presets, layout, isOwner])

  /**
   * Put a saved layout on the board. Through `arrange` with tidy OFF, exactly
   * like adopting the account's board: loading is not the user rearranging
   * anything, so a free-placement board must come back with its gaps intact.
   */
  const loadPreset = useCallback((p: NamedLayout) => {
    setLayoutState(arrangeRef.current(p.layout, false))
    setActiveName(p.name)
    writeActivePreset(p.name)
    setNameDraft(p.name)
    setPresetErr(null)
    setLayoutsOpen(false)
  }, [])

  /**
   * Drop one from the library. Local immediately — the row the user clicked ✕
   * on has to go — and off the account too when the owner is the one deleting.
   *
   * No arming click, unlike Clear all: this removes a SAVED COPY and leaves the
   * board on screen untouched, so the worst case is re-saving a layout that is
   * still right there, rather than losing the arrangement you were looking at.
   */
  const deletePreset = useCallback(
    async (p: NamedLayout) => {
      const next = removePreset(presets, p.name)
      setPresets(next)
      writePresets(next)
      if (activeName && activeName.toLowerCase() === p.name.toLowerCase()) {
        setActiveName(null)
        writeActivePreset(null)
      }
      if (!isOwner) return
      try {
        await deleteServerLayout(p.name)
      } catch (err) {
        setPresetErr(`Account copy failed — ${(err as Error).message}`)
      }
    },
    [presets, activeName, isOwner],
  )

  // Close the layout library on an outside click, like the add-card menu.
  useEffect(() => {
    if (!layoutsOpen) return
    const onDown = (e: PointerEvent) => {
      if (layoutsRef.current && !layoutsRef.current.contains(e.target as Node)) setLayoutsOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [layoutsOpen])

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

  // ── 📸 Every card on the board, offered to the toolbar's camera ────────────
  //
  // Registered from HERE rather than card by card, and that is the whole point:
  // a card does not have to know the feature exists to be photographable. The
  // board already knows every card's name, its copy number and where its tile
  // is in the DOM — `data-card-id`, which Board.tsx puts on each tile for the
  // perf check — so one publisher covers the catalog, including cards added
  // after this was written.
  //
  // The element handed over is the tile's `<section>`, i.e. the Card itself:
  // the tile wrapper also carries the resize grab-handle, which is chrome and
  // does not belong in a shot. Resolved at click time because a drag rebuilds
  // the tile. Reading order, not layout order, so the menu matches the eye.
  const shotTargets = useMemo<CopyShotTarget[]>(() => {
    const inReadingOrder = [...layout].sort((a, b) => a.y - b.y || a.x - b.x)
    const cards = inReadingOrder.map<CopyShotTarget>((it) => {
      const type = cardTypeOf(it.id)
      const def = CARD_BY_ID.get(type)
      const nth = (countByType.get(type) ?? 0) > 1 ? ordinalById.get(it.id) : undefined
      return {
        id: `board:${it.id}`,
        icon: def?.icon,
        label: `${def?.label ?? type}${nth != null ? ` ${nth}` : ''}`,
        group: 'Home board',
        file: it.id,
        // An EXPANDED card is not in its tile — it is portaled onto the page
        // column's stage (design/primitives/Expand.tsx) and its tile is empty.
        // So the tile is looked up first and the stage is the fallback, which
        // also means the shot you get is the card at the size you are looking
        // at it, which is the one you wanted a picture of.
        resolve: () =>
          boardRef.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(it.id)}"] section`) ??
          document.querySelector<HTMLElement>(
            `[data-cb-stage] section[data-card-instance="${CSS.escape(it.id)}"]`,
          ) ??
          null,
      }
    })
    return [
      {
        id: 'board:all',
        icon: '🗂️',
        label: 'Whole board',
        group: 'Home board',
        file: 'board',
        // The grid itself, not the scroll port around it — the board is taller
        // than the window as often as not, and a shot of the scroll port is a
        // shot of the part that happened to be showing. Cards below the fold
        // have not painted (non-negotiable 5), so their charts come out blank;
        // that is the visibility gate doing its job, not the capture failing.
        resolve: () => (boardRef.current?.firstElementChild as HTMLElement | undefined) ?? null,
      },
      ...cards,
    ]
  }, [layout, countByType, ordinalById])

  useCopyShotTargets(shotTargets)

  const addCard = (id: string) => {
    setLayoutState((prev) => arrange([...prev, placeNewCard(id, prev)]))
    setMenuOpen(false)
  }
  // In free mode a removal leaves a HOLE rather than pulling the board up. That
  // is the mode's whole promise: the cards the user did not touch do not move.
  const removeCard = (id: string) => {
    setLayoutState((prev) => arrange(prev.filter((i) => i.id !== id)))
  }

  // ── CLEAR ALL ──────────────────────────────────────────────────────────────
  //
  // Removing cards one ✕ at a time is the only way to start over today, and it
  // is the wrong shape of work for "I don't want any of this" — the board a
  // user most wants to abandon is the one with the most cards on it. It is also
  // the escape hatch when a board has ended up in a state they cannot drag
  // their way out of, which is exactly what the grid-scale bug produced.
  //
  // It empties the board; it does NOT reset to the starter three. "Clear" that
  // silently leaves three cards behind is not clear, and + Add card is right
  // there. readKey now keeps an empty board across reloads (see layoutStore) so
  // this survives, rather than the starter set reappearing on the next load.
  //
  // Deliberately LOCAL only. The account copy is untouched until the user
  // presses Save layout — the header will say "Unsaved layout" the moment the
  // board is cleared, so clearing is undoable by reloading the page, and
  // permanent only when they say so. A one-click control that reached across
  // every device the user owns would need a real confirmation dialog; this one
  // needs the arming click below and nothing more.
  //
  // ARMED, not dialogged. First click arms the button and it says "Clear all?";
  // a second click within ARM_MS does it. A modal for a reversible local action
  // is more ceremony than the action deserves, and a bare one-click wipe of a
  // board someone spent time on is not defensible.
  const ARM_MS = 4000
  const [clearArmed, setClearArmed] = useState(false)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const disarmClear = useCallback(() => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    clearTimerRef.current = null
    setClearArmed(false)
  }, [])

  // Anything that takes the board out of the state the user was looking at when
  // they armed it disarms: leaving edit mode, and unmounting.
  useEffect(() => {
    if (locked) disarmClear()
  }, [locked, disarmClear])
  useEffect(() => disarmClear, [disarmClear])

  const clearAll = () => {
    if (!clearArmed) {
      setClearArmed(true)
      clearTimerRef.current = setTimeout(() => setClearArmed(false), ARM_MS)
      return
    }
    disarmClear()
    // Not through `arrange`: there is nothing to arrange, and running the empty
    // array through compactBoard/settleBoard would only be ceremony.
    setLayoutState([])
    setMenuOpen(false)
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

  // ── NO PAGE HEADER ──────────────────────────────────────────────────────────
  // This page used to open with a header row: the word "Terminal" on the left
  // and the board's controls on the right, a whole band of chrome under a
  // toolbar that was mostly empty. The word is gone — the home page does not
  // need to announce itself to the person who navigated to it — and the
  // controls moved UP into the toolbar through ToolbarSlot, which is a portal,
  // so they are still owned by this component and still hold the board's state.
  // They appear only while this page is mounted; see shell/ToolbarSlot.tsx.
  return (
    <Page fill>
      <ToolbarSlot>
        <div className="flex items-center gap-2">
          {status && <span className={`text-xs ${toneClass}`}>{status.text}</span>}
          {/* Save layout belongs to edit mode: it is the counterpart of the
              gestures that made the board dirty, and out of edit mode there is
              nothing the user could have changed. */}
          {/* The placement rule, next to the gestures it governs. Edit mode
              only: out of edit mode there is no gesture for it to change, and a
              permanent switch would just be a setting on a page that has none. */}
          {!locked && (
            <button
              onClick={toggleFree}
              title={
                free
                  ? 'Free placement — cards stay where you drop them and gaps are kept. Click for auto-arrange.'
                  : 'Auto-arrange — cards float up to close gaps. Click for free placement.'
              }
              className={[
                'rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors',
                free
                  ? 'border-accent bg-raised text-fg'
                  : 'border-line bg-surface text-muted hover:bg-raised hover:text-fg',
              ].join(' ')}
            >
              {free ? 'Free placement' : 'Auto-arrange'}
            </button>
          )}
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
          {/* Edit mode only, and only when there is something to clear — a
              "Clear all" on an empty board is a button that cannot do anything.
              Armed, it goes red: the colour is the warning, so the label does
              not have to carry one. */}
          {!locked && layout.length > 0 && (
            <button
              onClick={clearAll}
              onBlur={disarmClear}
              title={
                clearArmed
                  ? `Click again to remove all ${layout.length} cards`
                  : 'Remove every card and start from an empty board. Your saved account layout is untouched until you press Save layout.'
              }
              className={[
                'rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors',
                clearArmed
                  ? 'border-down bg-raised text-down'
                  : 'border-line bg-surface text-muted hover:bg-raised hover:text-fg',
              ].join(' ')}
            >
              {clearArmed ? 'Clear all?' : 'Clear all'}
            </button>
          )}
          {/* ── THE LAYOUT LIBRARY ──────────────────────────────────────
              Outside edit mode on purpose, unlike Save layout and Clear all.
              Those are counterparts to gestures; LOADING a saved board is not
              an edit the user is in the middle of making, it is how they get
              to the board they want — and making them press "Edit layout"
              first to reach it would be ceremony in front of the common case.
              The button wears the loaded layout's name, so the board on screen
              can always say which one it is. */}
          <div className="relative" ref={layoutsRef}>
            <button
              onClick={() => setLayoutsOpen((v) => !v)}
              title="Save this board under a name, or load one you saved earlier"
              className={[
                'max-w-[14rem] truncate rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors',
                layoutsOpen
                  ? 'border-accent bg-raised text-fg'
                  : 'border-line bg-surface text-muted hover:bg-raised hover:text-fg',
              ].join(' ')}
            >
              {activeName ? `Layouts · ${activeName}` : 'Layouts'}
            </button>
            {layoutsOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-line bg-surface p-2 shadow-lg">
                <div className="flex items-center gap-1.5">
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void savePreset()
                    }}
                    placeholder="Layout name"
                    maxLength={40}
                    autoFocus
                    className="min-w-0 flex-1 rounded-sm border border-line bg-bg px-2 py-1 text-xs text-fg outline-none placeholder:text-faint placeholder:opacity-40 focus:border-accent"
                  />
                  <button
                    onClick={() => void savePreset()}
                    disabled={!cleanPresetName(nameDraft) || presetBusy}
                    title={
                      presets.some(
                        (p) => p.name.toLowerCase() === cleanPresetName(nameDraft).toLowerCase(),
                      )
                        ? `Replace "${cleanPresetName(nameDraft)}" with the board on screen`
                        : 'Save the board on screen under this name'
                    }
                    className="shrink-0 rounded-sm bg-accent px-2.5 py-1 text-xs font-medium text-bg transition-opacity disabled:cursor-default disabled:opacity-40"
                  >
                    {presetBusy ? 'Saving…' : 'Save'}
                  </button>
                </div>
                {presetErr && <p className="mt-1 text-2xs text-down">{presetErr}</p>}
                <div className="mt-2 max-h-64 overflow-y-auto">
                  {presets.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-faint">
                      No saved layouts yet — name this board above and press Save.
                    </p>
                  ) : (
                    presets.map((p) => {
                      const on = !!activeName && activeName.toLowerCase() === p.name.toLowerCase()
                      return (
                        <div
                          key={p.name}
                          className={[
                            'flex items-center gap-1 rounded-sm px-1',
                            on ? 'bg-raised' : 'hover:bg-raised',
                          ].join(' ')}
                        >
                          <button
                            onClick={() => loadPreset(p)}
                            title={`Load "${p.name}" — ${p.layout.length} card${p.layout.length === 1 ? '' : 's'}`}
                            className={[
                              'min-w-0 flex-1 truncate py-1.5 text-left text-sm',
                              on ? 'text-fg' : 'text-muted hover:text-fg',
                            ].join(' ')}
                          >
                            {p.name}
                          </button>
                          <span className="shrink-0 text-2xs text-faint">{p.layout.length}</span>
                          <button
                            onClick={() => void deletePreset(p)}
                            title={`Delete "${p.name}"`}
                            className="shrink-0 px-1 text-xs text-faint hover:text-down"
                          >
                            ✕
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>
                {/* Say where these actually went. The two tiers are invisible
                    otherwise, and "saved" meaning two different things to two
                    people is exactly the kind of thing to state plainly. */}
                <p className="mt-2 border-t border-line pt-1.5 text-2xs text-faint">
                  {isOwner
                    ? 'Saved to your account — on every browser you sign in on.'
                    : 'Saved in this browser.'}
                </p>
              </div>
            )}
          </div>
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
                      <span aria-hidden className="w-4 shrink-0 text-center leading-none">
                        {c.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {n > 0 && <span className="shrink-0 text-xs text-faint">×{n}</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </ToolbarSlot>
      <div ref={boardRef} className="min-h-0 flex-1 overflow-y-auto">
        {/* An empty board is otherwise an empty page, which reads as broken
            rather than as cleared — and the way back is a button in a toolbar
            the eye is not on at that moment. One line, pointing at it. It sits
            OUTSIDE <Board> so it cannot be mistaken for a tile or become a drop
            target. */}
        {layout.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-faint">
            Empty board — add a card from <span className="text-muted">+ Add card</span> to start
            building.
          </div>
        )}
        <Board
          layout={layout}
          onLayoutChange={setLayoutState}
          locked={locked}
          free={free}
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
                // The INSTANCE id, so the expand state survives a re-render mid
                // gesture and so a shot target can find the card while it is
                // expanded and living outside its tile. See Card's expandId.
                expandId={id}
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
                {/* The INSTANCE id, not the catalog id: a card that keeps
                    per-copy state — GEX Candles keeps a ticker — keys it on
                    this. Cards that do not care simply ignore the argument. */}
                {def.render(id)}
              </Card>
            )
          }}
        />
      </div>
    </Page>
  )
}

