import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useIsOwner } from '@/data/auth'
import { Popover } from '@/design/primitives/Controls'
import {
  ATLAS_BY_ID,
  DEFAULT_GROUP,
  GROUP_ORDER,
  SHOT_ATLAS,
  type AtlasShot,
} from '@/shell/shotAtlas'
// Type-only: erased at build, so the engine stays out of the entry chunk. The
// value side arrives through the dynamic import in `useShot` below.
import type { ShotResult } from '@/shell/snapshot'

// ─────────────────────────────────────────────────────────────────────────────
// COPYSHOT — one camera in the toolbar, and a menu of everything worth
// photographing.
//
// v2 solved this by putting a 📸 on every panel that wanted one. Twelve buttons,
// twelve slightly different implementations, and a row of chrome on every card
// that is only ever used by one person. v3 inverts it: the BUTTON is in one
// place (owner-gated, in the toolbar) and the TARGETS come to it.
//
// A surface that can be photographed publishes itself:
//
//   const targets = useMemo(() => ready ? [{ … }] : NO_TARGETS, [ready])
//   useCopyShotTargets(targets)
//
// MEMOISE THE ARRAY. The list identity is the effect's dependency; a fresh
// array literal every render republishes on every render. `NO_TARGETS` is
// exported so "nothing right now" is a constant rather than a new `[]`.
//
// ── THE MENU IS FIXED; THE PUBLICATIONS ARE NOT (2026-09-17) ─────────────────
// Publishing alone made the MENU depend on where you were standing: rows came
// and went with the route and with whichever cards happened to be on the board,
// so the shot you reach for by muscle memory — Key Levels, and the Stats text
// under it — was simply absent from every page but one. Ordering the menu was
// pointless for the same reason.
//
// So the menu is now drawn from src/shell/shotAtlas.ts, in full, on every page.
// A row whose surface is live behaves exactly as it always did. A row whose
// surface is not gets MADE ready on the click: the menu navigates to the route,
// asks the home board for the card (and gives it back afterwards — the saved
// layout is untouched), signals any surface that has to arrange itself, waits
// for the real target to publish, and only then shoots it.
//
// The clipboard survives that detour because the write is CLAIMED on the click
// and filled when the pixels exist — see claimClipboard, which is the same
// mechanism that already carried slow full-board captures.
//
// ── Owner-gated, and that is chrome ──────────────────────────────────────────
// `useIsOwner` decides what is DRAWN, exactly as everywhere else in v3 (see
// data/auth.tsx). It is not a permission: the capture runs entirely in the
// browser against pixels the viewer can already see, so there is nothing here
// for a gate to protect. It is hidden because it is a tool for one person.
// ─────────────────────────────────────────────────────────────────────────────

export interface CopyShotTarget {
  /**
   * Unique for as long as it is published. Doubles as the menu row key, as the
   * key the saved order is stored under, AND as the id the atlas merges on — so
   * it has to be stable across sessions: `board:gex-chart#2`, not an index.
   */
  id: string
  /** One emoji, matching the card's own (see CardDef.icon in board/catalog). */
  icon?: string
  /**
   * The row's tooltip, for a target the default wording would misdescribe. The
   * default says "Copy a PNG of …", which is true of every row but the Stats
   * one — that copies characters, and a row that claims to be a picture is a row
   * nobody clicks when they wanted text.
   */
  hint?: string
  /** The menu row, and the name that leads the PNG's caption. */
  label: string
  /**
   * Caption tail for a surface that has no `data-capture-meta` of its own —
   * a page whose registration knows the ticker the DOM does not spell out. A
   * board card leaves this alone: the card publishes its own, and the attribute
   * wins where both exist.
   */
  meta?: string
  /**
   * The ticker's company logo, for the head of the PNG's caption. One URL or a
   * list tried in order — `tickerLogoUrls(symbol)` from
   * pages/economicCalendar/ChipLogo builds the mirror-then-proxy pair.
   *
   * Worth it on a TICKER-SCOPED surface and nowhere else: every shot drops the
   * card's own header, which on those pages is where the symbol was, so without
   * this the picture never says which ticker it is of. Same-origin only — see
   * ShotOptions.badge.
   */
  badge?: string | string[]
  /**
   * NO CAPTION BAND AND NO MARK — for a target that IS the poster rather than a
   * card photographed out of the page.
   *
   * The earnings week board is the case: it carries its own title, its own week
   * range, its own cbedge.net and its own 56px mark INSIDE the capture element.
   * Framed, the picture came out wearing the CB Edge mark twice — the board's at
   * the bottom right and the caption's at the caption's right — and the caption
   * spent its line repeating a week the header had already named.
   *
   * Forwards to ShotOptions.bare. `meta` is ignored alongside it: there is no
   * caption left for it to land in.
   */
  bare?: boolean
  /** Menu heading. See GROUP_ORDER in shotAtlas.ts. */
  group?: string
  /** Download name stem, used only when the clipboard write is refused. */
  file?: string
  /**
   * The element to photograph, resolved AT CLICK TIME rather than held as a
   * ref: a board card is re-created on every drag and a popped-out overlay is
   * portalled in and out, so a ref captured at publish time is stale about as
   * often as it is right.
   *
   * Optional only because a target may supply `capture` instead.
   */
  resolve?: () => HTMLElement | null
  /**
   * Take the whole shot yourself, for a target that has no element on screen to
   * point at.
   *
   * The Economic Calendar template is the case: it is COMPOSED on demand — data
   * fetched, a 1280×720 poster built, mounted off-screen, photographed, torn
   * down — so there is nothing for `resolve` to return until the moment the row
   * is clicked. The menu, the icon, the ordering and the button's own feedback
   * are all unchanged; only the middle is different.
   */
  capture?: () => Promise<ShotResult>
}

/** The stable empty list. See the note about memoising, above. */
export const NO_TARGETS: CopyShotTarget[] = []

const rankOf = (g: string) => {
  const i = GROUP_ORDER.indexOf(g)
  return i === -1 ? GROUP_ORDER.length : i
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ORDER OF THE MENU, saved per browser.
//
// The atlas order is the default and it is somebody's opinion, which is fine
// for a default and useless after a week: you take the same two shots twenty
// times a day. So the rows are draggable, the same way the rail's icons are
// (see Shell.tsx and `cb-v3-rail-order`), and the arrangement is remembered.
//
// Stored as a flat list of TARGET IDS across every group. A row whose id is not
// in the list sorts after the ones that are, keeping its default order — so a
// card added to the catalog tomorrow appears at the bottom of its group rather
// than in an arbitrary place, and nothing has to be migrated when the atlas
// grows. Dragging is confined to a group: "Whole board" belongs above the cards
// and dropping a page's surface into the middle of the board's list would only
// ever be a mis-drop.
//
// Now that every row is present on every page, an arrangement made once holds
// everywhere — which is the thing the publish-only menu could never offer.
// ─────────────────────────────────────────────────────────────────────────────
const ORDER_KEY = 'cb-v3-copyshot-order'

function loadOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveOrder(ids: string[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(ids))
  } catch {
    /* best-effort, exactly like the rail's */
  }
}

interface CopyShotApi {
  targets: CopyShotTarget[]
  publish: (key: string, list: CopyShotTarget[]) => void
  /**
   * Resolve once `id` is published AND has something to photograph, or null if
   * it never turns up. Polled rather than subscribed: the thing being waited on
   * is a DOM element appearing, which no React signal covers anyway.
   */
  waitFor: (id: string, ms: number) => Promise<CopyShotTarget | null>
}

const Ctx = createContext<CopyShotApi | null>(null)

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function CopyShotProvider({ children }: { children: ReactNode }) {
  const [byKey, setByKey] = useState<Record<string, CopyShotTarget[]>>({})

  const publish = useCallback((key: string, list: CopyShotTarget[]) => {
    setByKey((prev) => {
      const had = prev[key]
      if (!list.length) {
        if (!had) return prev
        const next = { ...prev }
        delete next[key]
        return next
      }
      if (had === list) return prev
      return { ...prev, [key]: list }
    })
  }, [])

  const targets = useMemo(() => {
    // Object key order is publisher insertion order, which is the order the
    // page mounted its surfaces in — a sane secondary sort, and the reason the
    // group sort below has to be STABLE.
    const flat = Object.values(byKey).flat()
    return flat
      .map((t, i) => ({ t, i }))
      .sort((a, b) => rankOf(a.t.group ?? DEFAULT_GROUP) - rankOf(b.t.group ?? DEFAULT_GROUP) || a.i - b.i)
      .map(({ t }) => t)
  }, [byKey])

  // The waiter reads a ref, not the state it closes over: it is started inside
  // a click handler and has to see publications that happen after that render.
  const live = useRef<CopyShotTarget[]>(targets)
  live.current = targets

  const waitFor = useCallback(async (id: string, ms: number) => {
    const until = Date.now() + ms
    for (;;) {
      const t = live.current.find((x) => x.id === id)
      // Published is not the same as ready: a lazy card publishes the moment it
      // mounts and its <section> lands a frame or two later.
      if (t && (t.capture || t.resolve?.())) return t
      if (Date.now() >= until) return null
      await wait(120)
    }
  }, [])

  const value = useMemo<CopyShotApi>(() => ({ targets, publish, waitFor }), [targets, publish, waitFor])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Offer `list` to the toolbar's camera menu for as long as this component is
 * mounted and the array is non-empty. MEMOISE `list`.
 */
export function useCopyShotTargets(list: CopyShotTarget[]): void {
  const key = useId()
  const api = useContext(Ctx)
  const publish = api?.publish
  useEffect(() => {
    if (!publish) return
    publish(key, list)
    return () => publish(key, NO_TARGETS)
  }, [key, publish, list])
}

// ── Making an absent surface ready ───────────────────────────────────────────
//
// Two bridges, both module-level rather than context, because the thing that
// has to answer is on the page the click is navigating TO — it is not mounted
// when the click happens and so cannot be under a provider the click can read.

/** Add `cardId` to the home board if it is missing. Resolves to an undo. */
type BoardCardEnsurer = (cardId: string) => Promise<() => void>

let boardEnsurer: BoardCardEnsurer | null = null

/** BoardPage calls this while it is mounted. See board/BoardPage.tsx. */
export function registerBoardCardEnsurer(fn: BoardCardEnsurer | null): void {
  boardEnsurer = fn
}

async function ensureBoardCard(cardId: string, ms: number): Promise<(() => void) | null> {
  const until = Date.now() + ms
  // The board's chunk is lazy and the route was very likely just navigated to,
  // so the ensurer may be a few hundred milliseconds behind the click.
  while (!boardEnsurer) {
    if (Date.now() >= until) return null
    await wait(80)
  }
  return boardEnsurer(cardId)
}

// ── The prepare signal ───────────────────────────────────────────────────────
//
// For a surface that exists only once it has been ARRANGED — the sector wheel
// is not in the DOM at all until it is popped out. The menu announces the id it
// is about to shoot; whoever owns that id sets itself up and hands back an undo
// which runs after the shot.

type PrepareUndo = void | (() => void)
const PREPARE_EVENT = 'cb:copyshot-prepare'

let preparingId: string | null = null
let prepareUndos: Array<() => void> = []
/**
 * Bumped once per prepare, never per announcement. The signal is sent TWICE —
 * once on the click and once after the navigate, for a surface that did not
 * exist to hear the first — so the listeners need something to tell "again" from
 * "a new one" by, or the wheel pops out twice and closes once.
 */
let prepareToken = 0

function beginPrepare(id: string): void {
  if (preparingId !== id) {
    // A prepare that was never finished is finished now, undos and all.
    if (preparingId) endPrepare()
    preparingId = id
    prepareToken++
  }
  try {
    window.dispatchEvent(new CustomEvent(PREPARE_EVENT, { detail: id }))
  } catch {
    /* no CustomEvent, no arranging — the wait below just times out */
  }
}

function endPrepare(): void {
  preparingId = null
  const undos = prepareUndos
  prepareUndos = []
  for (const u of undos) {
    try {
      u()
    } catch {
      /* an undo that throws must not take the next one with it */
    }
  }
}

/**
 * Set this surface up when the camera is about to shoot `id`, and undo it
 * afterwards. `arrange` may return a cleanup; it runs once the shot is done.
 *
 * Fires on the event AND on mount, because the surface that has to arrange
 * itself is usually the one the menu has just navigated to — it did not exist
 * when the announcement went out.
 */
export function usePrepareShot(id: string, arrange: () => PrepareUndo): void {
  const fn = useRef(arrange)
  fn.current = arrange
  const ran = useRef(-1)
  useEffect(() => {
    const run = () => {
      if (ran.current === prepareToken) return
      ran.current = prepareToken
      const undo = fn.current()
      if (typeof undo === 'function') prepareUndos.push(undo)
    }
    if (preparingId === id) run()
    const onEvent = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) run()
    }
    window.addEventListener(PREPARE_EVENT, onEvent)
    return () => window.removeEventListener(PREPARE_EVENT, onEvent)
  }, [id])
}

// ── Taking the shot ──────────────────────────────────────────────────────────

type ShotState = 'idle' | 'working' | 'copied' | 'saved' | 'err' | 'wait'

const GLYPH: Record<ShotState, string> = {
  idle: '📸',
  working: '⏳',
  copied: '✓',
  saved: '⬇',
  err: '✕',
  wait: '↗',
}

const TONE: Record<ShotState, string> = {
  idle: 'text-muted',
  working: 'text-muted',
  copied: 'text-up',
  saved: 'text-up',
  err: 'text-down',
  wait: 'text-muted',
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'snapshot'
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAIMING THE CLIPBOARD BEFORE THE PICTURE EXISTS.
//
// Chrome only lets a page write to the clipboard while the click that asked for
// it is still warm. A shot of one small card beat that window; a shot of a
// multi-chart card or the whole board does not — the engine is a dynamic
// import, the clone is thousands of nodes, the SVG has to decode and the PNG
// has to encode, and by the time `clipboard.write` was finally called the
// activation was long gone. It rejected, the capture fell out of the bottom of
// snapshot.ts into a download, and "Copy" quietly became a file in ~/Downloads.
// Shrinking never helped, because size was never what was wrong.
//
// So the write is registered FIRST, synchronously, in the click handler, with a
// PROMISE of the blob in the ClipboardItem — which is exactly what promised
// clipboard items are for. Chrome parks the write against the live activation
// and waits for the pixels, however long they take. That is also what lets a
// row navigate to another route, wait for a card to mount and STILL copy.
//
// Returns null where promised items are not supported; the caller then takes
// the old path, which still copies and still falls back to a download.
// ─────────────────────────────────────────────────────────────────────────────
type ClipboardClaim = {
  /** The pixels arrived — hand them over and let the parked write complete. */
  fill: (blob: Blob) => void
  /** The capture died. Settle the parked write so it is not left hanging. */
  drop: () => void
  /** True once the bitmap is actually on the clipboard. Never rejects. */
  ok: Promise<boolean>
}

function claimClipboard(): ClipboardClaim | null {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return null
  let fill!: (blob: Blob) => void
  let drop!: () => void
  const pixels = new Promise<Blob>((resolve, reject) => {
    fill = resolve
    drop = () => reject(new Error('capture abandoned'))
  })
  // Nobody awaits `pixels` itself, so an abandoned capture would surface as an
  // unhandled rejection. The write below is its only real consumer.
  pixels.catch(() => {})
  try {
    const ok = navigator.clipboard
      .write([new ClipboardItem({ 'image/png': pixels })])
      .then(() => true)
      .catch(() => false)
    return { fill, drop, ok }
  } catch {
    // Older engines reject a non-Blob ClipboardItem value synchronously.
    drop()
    return null
  }
}

/** What a deferred row hands back: the target, and how to put things back. */
type Prepared = { target: CopyShotTarget; done?: () => void }

/** The capture itself, plus the two seconds of feedback that follow it. */
function useShot() {
  const [state, setState] = useState<ShotState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  /**
   * `find` resolves the thing to photograph — immediately for a live row, after
   * a navigate/mount/arrange for one that was not on screen. Null means the
   * surface never turned up, which is a "we took you there", not an error.
   *
   * `claim` is made by the CALLER, synchronously inside the click handler. See
   * claimClipboard: made here it would already be too late.
   */
  const run = useCallback(async (find: () => Promise<Prepared | null>, claim: ClipboardClaim | null) => {
    if (timer.current) clearTimeout(timer.current)
    setState('working')
    let done: (() => void) | undefined
    try {
      const prepared = await find()
      if (!prepared) {
        claim?.drop()
        setState('wait')
        timer.current = setTimeout(() => setState('idle'), 3200)
        return
      }
      const { target } = prepared
      done = prepared.done
      // A target that composes its own picture. See CopyShotTarget.capture.
      if (target.capture) {
        claim?.drop()
        setState(await target.capture())
        timer.current = setTimeout(() => setState('idle'), 2200)
        return
      }
      const el = target.resolve?.() ?? null
      if (!el) throw new Error(`nothing on screen for "${target.label}"`)
      // The engine arrives with the first click, not with the app. This module
      // is in the ENTRY chunk (the toolbar mounts it on every route) and the
      // capture is a few hundred lines nobody who is not the owner will ever
      // run — see budgets.json, where `entry` is the tightest number there is.
      const { captureCanvas, deliverCanvas, encodeShot } = await import('@/shell/snapshot')
      const filename = `${slug(target.file ?? target.label)}.png`
      const canvas = await captureCanvas(el, {
        title: target.label,
        meta: target.meta,
        badge: target.badge,
        bare: target.bare,
        filename,
      })
      if (claim) {
        claim.fill(await encodeShot(canvas))
        if (await claim.ok) {
          setState('copied')
          timer.current = setTimeout(() => setState('idle'), 2200)
          return
        }
        // Refused for a reason the claim could not fix — almost always the
        // bitmap. deliverCanvas shrinks and tries again before it downloads.
      }
      setState(await deliverCanvas(canvas, filename))
    } catch (e) {
      claim?.drop()
      console.error('[copyshot]', e)
      setState('err')
    } finally {
      // Put the board and any arranged surface back, shot or no shot.
      try {
        done?.()
      } catch (e) {
        console.error('[copyshot] restore', e)
      }
    }
    timer.current = setTimeout(() => setState('idle'), 2200)
  }, [])

  const take = useCallback(
    (target: CopyShotTarget, claim: ClipboardClaim | null) => run(async () => ({ target }), claim),
    [run],
  )

  return { state, run, take }
}

// ── The toolbar menu ─────────────────────────────────────────────────────────

/** How long to wait for a navigated-to surface to publish something shootable. */
const READY_MS = 12_000
/** How long to wait for BoardPage to register itself after a navigate. */
const BOARD_MS = 8_000
/**
 * A beat after a freshly mounted card resolves, for its first data and its
 * first paint. A live row waits for nothing — it is already on screen.
 */
const SETTLE_MS = 1400

/** One menu row: the atlas entry, the live target, or (usually) both. */
interface Row {
  id: string
  icon?: string
  label: string
  hint?: string
  group: string
  live: CopyShotTarget | null
  atlas: AtlasShot | null
}

/** Is `route` (path, maybe with a query) where we already are? */
function onRoute(route: string, pathname: string, search: string): boolean {
  const [path, query] = route.split('?')
  if (path !== pathname) return false
  if (!query) return true
  const want = new URLSearchParams(query)
  const have = new URLSearchParams(search)
  for (const [k, v] of want) if (have.get(k) !== v) return false
  return true
}

export function CopyShotMenu() {
  const { isOwner } = useIsOwner()
  const api = useContext(Ctx)
  const { state, run, take } = useShot()
  const [open, setOpen] = useState(false)
  const [order, setOrder] = useState<string[]>(() => loadOrder())
  const [dragging, setDragging] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)
  const navigate = useNavigate()
  const { pathname, search } = useLocation()

  const targets = api?.targets ?? NO_TARGETS
  const waitFor = api?.waitFor
  const close = useCallback(() => setOpen(false), [])

  // EVERY row in the atlas, every time, plus whatever is live and not in it —
  // second copies of a card (`board:gex-chart#2`) and anything published by a
  // surface written after the atlas. A live row wins on icon, label and group,
  // so being on a page still lifts its shots into "This page" at the top.
  const rows = useMemo<Row[]>(() => {
    const liveById = new Map(targets.map((t) => [t.id, t]))
    const out: Row[] = SHOT_ATLAS.map((a) => {
      const live = liveById.get(a.id) ?? null
      return {
        id: a.id,
        icon: live?.icon ?? a.icon,
        label: live?.label ?? a.label,
        hint: live?.hint ?? a.hint,
        group: live?.group ?? a.group,
        live,
        atlas: a,
      }
    })
    for (const t of targets) {
      if (ATLAS_BY_ID.has(t.id)) continue
      out.push({
        id: t.id,
        icon: t.icon,
        label: t.label,
        hint: t.hint,
        group: t.group ?? DEFAULT_GROUP,
        live: t,
        atlas: null,
      })
    }
    return out
  }, [targets])

  // Grouped for rendering, each group in the saved order. `rank` is Infinity for
  // an id nobody has dragged yet, so those keep their atlas order and sit after
  // the ones that were arranged.
  const groups = useMemo(() => {
    const rank = new Map(order.map((id, i) => [id, i]))
    const byName = new Map<string, Row[]>()
    for (const r of rows) {
      const list = byName.get(r.group)
      if (list) list.push(r)
      else byName.set(r.group, [r])
    }
    return [...byName.entries()]
      .map(([name, list], i) => ({ name, i, rows: list }))
      .sort((a, b) => rankOf(a.name) - rankOf(b.name) || a.i - b.i)
      .map((g) => ({
        name: g.name,
        rows: g.rows
          .map((t, i) => ({ t, i, r: rank.get(t.id) ?? Infinity }))
          .sort((a, b) => a.r - b.r || a.i - b.i)
          .map((x) => x.t),
      }))
  }, [rows, order])

  /**
   * Commit a drop. The saved list is rewritten from the group's rows AFTER the
   * move, with every other group's saved ids carried through untouched — so
   * arranging the board's list cannot disturb an arrangement made in another
   * group.
   */
  const dropOn = useCallback(
    (groupName: string, targetId: string) => {
      const src = dragId.current
      setDragging(null)
      dragId.current = null
      if (!src || src === targetId) return
      const group = groups.find((g) => g.name === groupName)
      if (!group) return
      const ids = group.rows.map((r) => r.id)
      const from = ids.indexOf(src)
      const to = ids.indexOf(targetId)
      if (from < 0 || to < 0) return
      ids.splice(to, 0, ...ids.splice(from, 1))
      setOrder((prev) => {
        const mine = new Set(ids)
        const next = [...prev.filter((id) => !mine.has(id)), ...ids]
        saveOrder(next)
        return next
      })
    },
    [groups],
  )

  /**
   * Make an absent surface exist, then hand back its real target.
   *
   * Order matters: route first (the card and the arranging both live on the
   * page being navigated to), then the board card, then the prepare signal,
   * then wait for the publication. Everything undone in `done`, which `run`
   * calls whatever happens — a board that keeps a card it was only lent is the
   * one failure mode here that the user would have to clean up by hand.
   */
  const prepare = useCallback(
    async (a: AtlasShot): Promise<Prepared | null> => {
      const undos: Array<() => void> = []
      const done = () => {
        endPrepare()
        for (const u of undos.splice(0).reverse()) {
          try {
            u()
          } catch (e) {
            console.error('[copyshot] restore', e)
          }
        }
      }
      try {
        beginPrepare(a.id)
        if (a.route && !onRoute(a.route, pathname, search)) {
          navigate(a.route)
          await wait(60)
        }
        if (a.card) {
          const undo = await ensureBoardCard(a.card, BOARD_MS)
          if (undo) undos.push(undo)
        }
        // Again, for a surface that only just mounted and so missed the first.
        beginPrepare(a.id)
        const target = (await waitFor?.(a.id, READY_MS)) ?? null
        if (!target) {
          done()
          return null
        }
        await wait(a.card || a.route ? SETTLE_MS : 0)
        return { target, done }
      } catch (e) {
        done()
        throw e
      }
    },
    [navigate, pathname, search, waitFor],
  )

  if (!isOwner) return null

  const pick = (row: Row) => {
    // Close FIRST. The panel is portalled over the page, and a full-page shot
    // taken with it open would photograph the menu on top of its own subject.
    setOpen(false)
    // Synchronously, inside the click, or the clipboard is lost. A composed row
    // delivers its own bytes (a poster, or text) and must not be claimed for.
    const composed = row.live ? !!row.live.capture : !!row.atlas?.composed
    const claim = composed ? null : claimClipboard()
    if (row.live) {
      void take(row.live, claim)
      return
    }
    if (!row.atlas) {
      claim?.drop()
      return
    }
    const a = row.atlas
    void run(() => prepare(a), claim)
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          state === 'err'
            ? 'Capture failed — see the console'
            : state === 'wait'
              ? 'Opened the page — set the surface up and shoot it again'
              : state === 'saved'
                ? 'Clipboard refused it — downloaded instead'
                : state === 'copied'
                  ? 'Copied to the clipboard'
                  : 'Copy a PNG of a card to the clipboard'
        }
        className={[
          'rounded-sm border border-line px-2 py-0.5 text-sm leading-none transition-colors',
          open ? 'bg-raised' : '',
          TONE[state],
          state === 'working' ? 'opacity-60' : 'hover:text-fg',
        ].join(' ')}
      >
        {GLYPH[state]}
      </button>
      <Popover open={open} onClose={close}>
        <div className="flex w-64 flex-col gap-2">
          {groups.map((g) => (
            <div key={g.name} className="flex flex-col gap-0.5 border-t border-line pt-2 first:border-t-0 first:pt-0">
              <span className="px-1 text-3xs font-bold uppercase tracking-[0.12em] text-faint opacity-60">
                {g.name}
              </span>
              {g.rows.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pick(t)}
                  title={[
                    t.hint ?? `Copy a PNG of ${t.label}`,
                    t.live
                      ? null
                      : t.atlas?.needs
                        ? `not open — takes you there (${t.atlas.needs})`
                        : t.atlas?.card
                          ? 'not on the board — it is added for the shot and taken off again'
                          : 'not open — takes you there and shoots it',
                    'drag to reorder',
                  ]
                    .filter(Boolean)
                    .join(' — ')}
                  draggable
                  onDragStart={(e) => {
                    dragId.current = t.id
                    setDragging(t.id)
                    e.dataTransfer.effectAllowed = 'move'
                    try {
                      e.dataTransfer.setData('text/plain', t.id)
                    } catch {
                      /* ignore — some browsers refuse a custom type here */
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    dropOn(g.name, t.id)
                  }}
                  onDragEnd={() => {
                    setDragging(null)
                    dragId.current = null
                  }}
                  className={[
                    'flex w-full cursor-grab items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-raised',
                    // An absent row is dimmed, not hidden and not disabled: it
                    // works, it just has further to go. Dimming is the only
                    // honest way to say "this one costs a second".
                    t.live ? 'text-fg' : 'text-muted',
                    dragging === t.id ? 'opacity-40' : '',
                  ].join(' ')}
                >
                  <span aria-hidden className="w-4 shrink-0 text-center leading-none">
                    {t.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </Popover>
    </div>
  )
}

// ── The in-place camera ──────────────────────────────────────────────────────

/**
 * A single-target camera for a surface the TOOLBAR CANNOT BE REACHED FROM.
 *
 * There is exactly one of those today and it is not an exception worth
 * regretting: the sector wheel's pop-out is a `fixed inset-0` overlay above
 * everything, so while it is open the toolbar is behind it and its camera
 * cannot be clicked at all. The wheel publishes itself to the menu anyway (for
 * the case where it is not the thing covering the screen) and carries this
 * button in its own header for the case where it is.
 *
 * Wear `data-capture-hide` on this button — it must not appear in its own PNG.
 */
export function CopyShotButton({
  target,
  className = '',
  label,
}: {
  target: CopyShotTarget
  className?: string
  /** Text beside the glyph. Omit for the bare camera. */
  label?: string
}) {
  const { isOwner } = useIsOwner()
  const { state, take } = useShot()
  if (!isOwner) return null
  return (
    <button
      type="button"
      data-capture-hide
      onClick={() => void take(target, target.capture ? null : claimClipboard())}
      title="Copy a PNG of this to the clipboard"
      className={[className, TONE[state], state === 'working' ? 'opacity-60' : ''].join(' ')}
    >
      {GLYPH[state]}
      {label ? ` ${label}` : ''}
    </button>
  )
}
