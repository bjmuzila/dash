import { BOARD_COLS, compactBoard, resolveBoard, type BoardItem } from '@/design/primitives/Board'
import { CARD_BY_ID, cardTypeOf, migrateCardId } from './catalog'

// ─────────────────────────────────────────────────────────────────────────────
// WHERE THE BOARD ARRANGEMENT LIVES.
//
// Two tiers, on purpose:
//
//  1. localStorage — written on EVERY gesture (drag, resize, add, remove). Free,
//     synchronous, works signed out and offline. Per browser.
//  2. Postgres, through v2's `/api/dashboard-layout` — written only when the
//     user presses "Save layout". Per ACCOUNT, so the board follows them to
//     another machine.
//
// The server route is `server-v2/api-router.js` (`register('/api/dashboard-layout')`)
// and the table is `dashboard_layouts` in `_lib-db.cjs` — keyed
// (clerk_user_id, page, name), one row flagged `is_default`, the layout column
// stored opaquely. That route pre-dates v3 and is untouched by this file: v3
// talks to the v2 backend over HTTP and nothing else (see cbedge-v3/AGENTS.md).
//
// ── The third key: cb-v3-board-synced ────────────────────────────────────────
// A copy of the layout as the server last saw it. It exists to answer one
// question on load: does this browser hold edits the account has never been
// told about? If local === synced, the server copy is adopted (it may be newer,
// from another machine). If they differ, the local edits stay on screen and the
// header says the layout is unsaved. Without it, opening the board on a laptop
// would silently throw away whatever was rearranged there but not saved.
// ─────────────────────────────────────────────────────────────────────────────

/** Working layout — rewritten on every gesture. */
export const LAYOUT_KEY = 'cb-v3-board-layout'
/** The layout as the server last saw it. Never written by a gesture. */
export const SYNCED_KEY = 'cb-v3-board-synced'
/**
 * Free placement on/off. A PREFERENCE, not part of the layout: it changes how
 * gestures behave, and the wire contract for `dashboard_layouts` is an array of
 * {id,x,y,w,h} that this file does not get to extend. Per browser, like the rest
 * of the v3 card settings.
 *
 * DEFAULT ON — the key is opt-OUT ('0'), not opt-in. Free placement plus the
 * magnet is what "drag a card where you want it" is supposed to feel like, and
 * shipping it behind a switch meant the board still fought the first person who
 * tried to move a card and never told them there was another mode. Auto-arrange
 * is still one click away for anyone who wants the board tidied for them.
 */
export const FREE_KEY = 'cb-v3-board-free'

export function readFreeMode(): boolean {
  try {
    return localStorage.getItem(FREE_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeFreeMode(on: boolean): void {
  try {
    localStorage.setItem(FREE_KEY, on ? '1' : '0')
  } catch {
    /* best-effort — the in-memory flag still works for this session */
  }
}

// ── MIGRATING A BOARD ACROSS A GRID CHANGE ───────────────────────────────────
//
// The board went from 12 columns / 32px rows to 24 / 16 (see BOARD_COLS). Every
// number in a stored layout is in grid units, so a board saved under the old
// grid is HALF SIZE under the new one — every card shrinks to a quarter of its
// area and the right half of the board empties. Doubling x/y/w/h reproduces the
// old board exactly, because the new unit is exactly half the old one.
//
// Which layouts need it is recorded, not guessed. The tempting heuristic — "no
// card reaches past column 12, so it must be an old board" — is also true of a
// perfectly good new board whose cards all sit on the left, and it would double
// that board on every reload until it stopped fitting. So: a key holding the
// grid width the browser was last written under, read ONCE at module load.
const GRID_KEY = 'cb-v3-board-grid'

function storedGrid(): number {
  try {
    return Number(localStorage.getItem(GRID_KEY)) || 12
  } catch {
    return BOARD_COLS
  }
}

/**
 * Captured at import, before anything can read or write a layout — the flag has
 * to answer "was this browser's data written under the old grid", and the answer
 * stops being true the moment the key is updated below.
 */
const SCALE = BOARD_COLS / storedGrid()

if (SCALE !== 1) {
  try {
    localStorage.setItem(GRID_KEY, String(BOARD_COLS))
  } catch {
    /* best-effort — SCALE still applies for this session */
  }
}

/**
 * Every read goes through this, so the SERVER copy is rescaled too. A board
 * saved from an older build on another machine arrives in old units and would
 * otherwise land as a quarter-size board; it is corrected on the first session
 * after this build, and written back in new units the next time the user presses
 * Save layout.
 */
function toCurrentGrid(i: BoardItem): BoardItem {
  if (SCALE === 1) return i
  return { id: i.id, x: i.x * SCALE, y: i.y * SCALE, w: i.w * SCALE, h: i.h * SCALE }
}

/** Route key in `dashboard_layouts`. Must match /^[a-z0-9][a-z0-9_-]{0,39}$/. */
export const BOARD_PAGE = 'v3-home'
/** v3's home board keeps ONE named template; the route allows up to 12. */
export const BOARD_TEMPLATE = 'Default'

const ENDPOINT = '/api/dashboard-layout'

export interface ServerLayout {
  name: string
  layout: BoardItem[]
  updatedAt: string | null
}

/**
 * Reconcile a stored blob into a board this build can actually render.
 *
 * Renames run BEFORE the catalog check — a renamed card is still the user's
 * card, and dropping it because its id changed would silently empty their board
 * on an upgrade. A card that was genuinely deleted still falls out, which is
 * what should happen.
 *
 * The dedupe is on the INSTANCE id, not the card type: two GEX Charts is a board
 * the user built on purpose, while the same instance id twice is a corrupt blob
 * that would collide in the grid.
 *
 * Returns null when nothing usable survives, so the caller can tell "no saved
 * layout" from "an empty one".
 *
 * `compact` defaults to the free-placement preference, and that default is the
 * point: this function is what every read path goes through, so leaving it
 * hard-coded to compactBoard would flatten a deliberately spaced board back to
 * the top-left on every reload — the arrangement would survive the gesture and
 * die on refresh, which is worse than never having saved it.
 */
export function sanitizeLayout(raw: unknown, compact = !readFreeMode()): BoardItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const kept: BoardItem[] = []
  const seen = new Set<string>()
  for (const i of raw) {
    if (!i || typeof i !== 'object') continue
    const item = i as Partial<BoardItem>
    if (typeof item.id !== 'string') continue
    if (![item.x, item.y, item.w, item.h].every((n) => typeof n === 'number')) continue
    const id = migrateCardId(item.id)
    if (!CARD_BY_ID.has(cardTypeOf(id)) || seen.has(id)) continue
    seen.add(id)
    kept.push(
      toCurrentGrid({
        id,
        x: item.x as number,
        y: item.y as number,
        w: item.w as number,
        h: item.h as number,
      }),
    )
  }
  if (!kept.length) return null
  // Free mode still needs the OVERLAP rule enforced on a blob that may be
  // corrupt or written by an older build — resolveBoard is that rule without
  // the gravity.
  return compact ? compactBoard(kept) : resolveBoard(kept)
}

function readKey(key: string): BoardItem[] | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? sanitizeLayout(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function writeKey(key: string, layout: BoardItem[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(layout.map(gridOnly)))
  } catch {
    /* best-effort — the in-memory layout still works for this session */
  }
}

/** Strip anything a card put on the item; the wire contract is {id,x,y,w,h}. */
function gridOnly(i: BoardItem): BoardItem {
  return { id: i.id, x: i.x, y: i.y, w: i.w, h: i.h }
}

export const readLocalLayout = (): BoardItem[] | null => readKey(LAYOUT_KEY)
export const writeLocalLayout = (layout: BoardItem[]): void => writeKey(LAYOUT_KEY, layout)
export const readSyncedLayout = (): BoardItem[] | null => readKey(SYNCED_KEY)
export const writeSyncedLayout = (layout: BoardItem[]): void => writeKey(SYNCED_KEY, layout)

/**
 * Same board? Compared by id → geometry, order-insensitively: the array order
 * is an artifact of how cards were added and two identical boards can hold it
 * differently. This decides whether "Save layout" has anything to do, so it has
 * to answer about what the user can SEE.
 */
export function sameLayout(a: BoardItem[] | null, b: BoardItem[] | null): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  const key = (i: BoardItem) => `${i.x},${i.y},${i.w},${i.h}`
  const m = new Map(a.map((i) => [i.id, key(i)]))
  for (const i of b) if (m.get(i.id) !== key(i)) return false
  return true
}

/**
 * The account's saved board, or null when there isn't one. A 401/403 is also
 * null rather than a throw: not signed in is not a failure, it just means there
 * is nothing to load.
 */
export async function fetchServerLayout(signal?: AbortSignal): Promise<ServerLayout | null> {
  const res = await fetch(`${ENDPOINT}?page=${encodeURIComponent(BOARD_PAGE)}`, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal,
  })
  if (res.status === 401 || res.status === 403) return null
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const data = (await res.json()) as { templates?: unknown }
  const templates = Array.isArray(data?.templates) ? data.templates : []
  const rows = templates.filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
  const pick = rows.find((t) => t.isDefault === true) ?? rows[0]
  if (!pick) return null
  const layout = sanitizeLayout(pick.layout)
  if (!layout) return null
  return {
    name: typeof pick.name === 'string' ? pick.name : BOARD_TEMPLATE,
    layout,
    updatedAt: typeof pick.updatedAt === 'string' ? pick.updatedAt : null,
  }
}

/**
 * Write the board to the account. `makeDefault` is always true: this board keeps
 * one template, and the route's own rule is that the first template saved for a
 * page becomes the default anyway — being explicit means a board saved before
 * some other template existed still comes back on the next load.
 */
export async function saveServerLayout(layout: BoardItem[], name = BOARD_TEMPLATE): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page: BOARD_PAGE, name, layout: layout.map(gridOnly), makeDefault: true }),
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error || `${res.status} ${res.statusText}`)
  }
}
