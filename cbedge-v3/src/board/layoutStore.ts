import {
  BOARD_COLS,
  BOARD_MIN_H,
  BOARD_MIN_W,
  compactBoard,
  resolveBoard,
  type BoardItem,
} from '@/design/primitives/Board'
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
 * DEFAULT ON — the key is opt-OUT ('0'), not opt-in. "The card goes where I put
 * it" is what dragging is supposed to mean, and shipping that behind a switch
 * meant the board still fought the first person who tried to move a card and
 * never told them there was another mode. Auto-arrange is still one click away
 * for anyone who wants the board tidied for them.
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
// The board has gone 12 columns / 32px rows -> 24 / 16 -> 48 / 8 (see
// BOARD_COLS). Every number in a stored layout is in grid units, so a board
// saved under an older grid is a FRACTION of its size under the new one — the
// cards shrink and the right side of the board empties. Scaling x/y/w/h by
// BOARD_COLS / (the grid it was written under) reproduces it exactly, because
// each step halved the unit. The factor is 2 from 24, 4 from 12.
//
// Which layouts need it is recorded, not guessed. The tempting heuristic — "no
// card reaches past column 12, so it must be an old board" — is also true of a
// perfectly good new board whose cards all sit on the left, and it would scale
// that board on every reload until it stopped fitting. So: a key holding the
// grid width the browser was last written under.
//
// ── THE BUG THIS SHAPE FIXES (2026-09-07) ────────────────────────────────────
// The first version only STAMPED the key at module load and scaled on read. The
// stored blob was left in old units, on the assumption that the autosave would
// rewrite it. It does not: BoardPage's autosave deliberately skips its first run
// and only fires on an actual gesture. So opening the board and NOT dragging
// anything left `cb-v3-board-layout` in old units with the key claiming the new
// grid — and on the very next reload SCALE was 1, the old blob was taken at face
// value, and every card came back at HALF SIZE crammed into the left half of the
// board. Which is exactly what it looked like: not a broken layout, a correct
// layout in the wrong units. It had shipped twice (12→24, then 24→48), which is
// why it was "not the first time I've seen this".
//
// So the migration now REWRITES THE STORED DATA and only then stamps the key.
// The data and the flag can never disagree, and the fix does not depend on the
// user happening to drag something before their next reload.
const GRID_KEY = 'cb-v3-board-grid'

function storedGrid(): number {
  try {
    // No stamp AND no board of any kind = a browser that has never opened this
    // app. It has nothing in old units, so nothing to scale — anything it reads
    // later (the account's copy) is already current. Without this check a fresh
    // browser would be treated as a 12-column veteran and would QUADRUPLE the
    // first server layout it loaded.
    const stamp = localStorage.getItem(GRID_KEY)
    if (stamp) return Number(stamp) || BOARD_COLS
    const seen = localStorage.getItem(LAYOUT_KEY) ?? localStorage.getItem(SYNCED_KEY)
    return seen ? 12 : BOARD_COLS
  } catch {
    return BOARD_COLS
  }
}

/** Multiply every stored number by this to get current grid units. */
const SCALE = BOARD_COLS / storedGrid()

/**
 * Rewrite a stored blob in place, in the raw {id,x,y,w,h} shape it is kept in —
 * deliberately NOT through sanitizeLayout, which would drop unknown cards and,
 * worse, apply the scale a second time.
 */
function rescaleStored(key: string, scale: number): void {
  const raw = localStorage.getItem(key)
  if (!raw) return
  const arr = JSON.parse(raw) as unknown
  if (!Array.isArray(arr)) return
  const out = arr
    .filter((i): i is BoardItem => !!i && typeof i === 'object')
    .map((i) => ({ id: i.id, x: i.x * scale, y: i.y * scale, w: i.w * scale, h: i.h * scale }))
  localStorage.setItem(key, JSON.stringify(out))
}

if (SCALE !== 1) {
  try {
    rescaleStored(LAYOUT_KEY, SCALE)
    // The SYNCED copy is DROPPED rather than rescaled, and that is load-bearing.
    // It records the layout as the SERVER last saw it, and the server's copy is
    // still in old units — this build cannot change that without the user
    // pressing Save. Rescaling it would make local === synced, which is
    // BoardPage's signal that the account copy may safely replace what is on
    // screen; the next load would then adopt the account's old-unit board and
    // put every card back at half size. Removing it makes them differ, so the
    // migrated local board wins and the header honestly says "Unsaved layout"
    // until the account copy is brought up to date.
    localStorage.removeItem(SYNCED_KEY)
  } catch {
    /* best-effort — the read-time scale below still rescues this session */
  }
}

// ── THE STAMP IS UNCONDITIONAL ───────────────────────────────────────────────
//
// It used to be written INSIDE the `SCALE !== 1` block above, on the reasonable-
// sounding grounds that there is nothing to record when nothing was rescaled.
// That was the 2026-09-08 "my board came back enormous" bug, and it fired for
// every NEW browser:
//
//   load 1  no stamp, no layout  -> storedGrid() = BOARD_COLS, SCALE = 1
//                                -> the block is skipped, so NOTHING IS STAMPED
//           ...the user arranges a board; the autosave writes cb-v3-board-layout
//   load 2  no stamp, but a layout EXISTS -> storedGrid() reads that as "a
//           browser from the 12-column era" -> SCALE = 4 -> every card, and the
//           account copy arriving through serverToCurrentGrid, multiplied by 4.
//   load 3  stamped 48 now, so SCALE = 1 and the quadrupled board is permanent.
//
// A card 96 columns wide on a 48-column grid is twice the width of the board, so
// the symptom is one card filling the screen and nothing else visible — and
// "the tables won't sit side by side", because at that width no two can.
//
// The stamp records the grid THIS BUILD writes in. That is true whether or not a
// rescale happened, so it is written on every load: the "no stamp" state has to
// mean "a browser from before the stamp existed" and nothing else.
try {
  localStorage.setItem(GRID_KEY, String(BOARD_COLS))
} catch {
  /* best-effort */
}

// ── A BOARD WIDER THAN THE BOARD ─────────────────────────────────────────────
//
// Unlike every heuristic below, this one needs no guessing: `w` is clamped to
// the grid on every gesture, so a card whose right edge is past BOARD_COLS
// cannot have been put there by a user. It is a scale that has been applied to a
// board that did not need it — the bug above, or any future repeat of it.
//
// Safe to run on EVERY load rather than behind a one-shot key: a correct board
// never trips it, so there is no "runs again and again" failure mode of the kind
// that made the half-size heuristic below dangerous.
//
// ── HOW FAR DOWN, THOUGH ─────────────────────────────────────────────────────
// "Halve until it fits" is the obvious inverse and it UNDER-CORRECTS. A board
// quadrupled from cards spanning only half the grid comes back at right = 96;
// one halving puts it at 48 and the loop stops, leaving every card twice the
// size it should be — on the grid, adjustable, and still wrong.
//
// The catalog knows better. Each card has a `defaultSize`, and a card the user
// has never resized still holds exactly that size times whatever scale was
// wrongly applied. So if EVERY card on the board is the same clean power-of-two
// multiple (>= 2x) of its own catalog default, that multiple IS the scale, and
// dividing by it restores the board exactly rather than approximately.
//
// Every card, not most: one resized card makes the ratios noise, and a wrong
// guess here is the bug rather than the fix. When the evidence is not unanimous
// this falls back to halving until it fits, which is at least always reachable.
function catalogOverscale(items: BoardItem[]): number {
  let smallest = Infinity
  let seen = 0
  for (const i of items) {
    const def = CARD_BY_ID.get(cardTypeOf(migrateCardId(i.id)))
    if (!def) continue // a card this build does not have says nothing either way
    const r = i.w / def.defaultSize.w
    // A clean power of two, 2x or more. Anything else — a resized card, a card
    // at its default — and the board is not uniformly over-scaled.
    if (!Number.isInteger(r) || r < 2 || (r & (r - 1)) !== 0) return 1
    smallest = Math.min(smallest, r)
    seen++
  }
  return seen > 0 && Number.isFinite(smallest) ? smallest : 1
}

function repairOverscaledBoard(): void {
  const raw = localStorage.getItem(LAYOUT_KEY)
  if (!raw) return
  const arr = JSON.parse(raw) as unknown
  if (!Array.isArray(arr)) return
  const items = arr.filter(
    (i): i is BoardItem => !!i && typeof i === 'object' && typeof (i as BoardItem).x === 'number',
  )
  if (!items.length) return
  const right = items.reduce((m, i) => Math.max(m, i.x + i.w), 0)
  if (!(right > BOARD_COLS)) return

  let factor = 1 / catalogOverscale(items)
  // Whatever the catalog said (including "no idea", which is 1), the board has
  // to end up on the grid. Keep halving until it does.
  let fitted = right * factor
  while (fitted > BOARD_COLS) {
    factor /= 2
    fitted /= 2
  }
  rescaleStored(LAYOUT_KEY, factor)
  // Same reasoning as the migration: the account's copy is untouched by this, so
  // the synced marker has to go or the next load adopts it over the repair.
  localStorage.removeItem(SYNCED_KEY)
}

try {
  repairOverscaledBoard()
} catch {
  /* best-effort — a board that cannot be repaired can still be dragged back */
}

// ── ONE-TIME REPAIR FOR BOARDS THE OLD MIGRATION ALREADY BROKE ───────────────
//
// The fix above stops it happening again, and does nothing for the browsers it
// has already happened to: they carry a stamp saying 48 over a blob still in 24
// units, so SCALE is 1 and the migration correctly declines to run. Their board
// stays at half size forever. It needs repairing once, from the data itself.
//
// The evidence is unambiguous enough for one pass: the board's whole purpose is
// to fill its width, and a layout in half-size units CANNOT have anything past
// the halfway column, because it was authored on a grid only that wide. So a
// stamped-current board whose rightmost edge does not reach the halfway mark was
// written under the previous grid.
//
// The heuristic that was rejected earlier — "it fits in the left half, so it
// must be old" — is exactly this one. What made it unsafe was running it on
// every load, where a genuine left-half board would be doubled again and again.
// Behind a one-shot key it runs once in a browser's life.
//
// ── ITS WORST CASE IS WORSE THAN IT WAS WRITTEN DOWN AS (2026-09-08) ─────────
// The note here used to say the worst case was "a deliberately left-half board
// becoming a full-width one, which still fits and is still a board." That is
// only true of the horizontal half. It doubles `h` as well — which is CORRECT
// for a genuinely old board, because the row unit halved at the same time the
// column unit did (32px -> 16 -> 8) — so a false positive does not get a wider
// board, it gets a board twice as tall, with every card at double height. A
// 19-row card becomes 38 rows: 304px of chart becomes 608px, and one card fills
// the viewport. That is the same symptom as the bug above, and it is not "still
// a board".
//
// So the trigger now needs the board to look old in the way an old board
// actually is: an old board FILLS the grid it was authored on — that premise is
// the whole basis for reading a short right edge as evidence — so a board that
// does not even reach the middle of that old grid is not evidence of anything,
// it is just a small board. Requiring `right` to land in the upper half of the
// OLD grid (BOARD_COLS/4 .. BOARD_COLS/2) keeps every board the old migration
// actually broke and drops the small, deliberately-narrow ones, which are
// exactly the false positives where doubling the height hurts most.
const REPAIR_KEY = 'cb-v3-board-grid-repair'

function repairHalfSizeBoard(): void {
  const raw = localStorage.getItem(LAYOUT_KEY)
  if (!raw) return
  const arr = JSON.parse(raw) as unknown
  if (!Array.isArray(arr) || !arr.length) return
  const items = arr.filter(
    (i): i is BoardItem => !!i && typeof i === 'object' && typeof (i as BoardItem).x === 'number',
  )
  if (!items.length) return
  const right = items.reduce((m, i) => Math.max(m, i.x + i.w), 0)
  if (right > BOARD_COLS / 2) return // already in current units — leave it alone
  // ...and a board that does not fill even the OLD grid is a small board, not an
  // old one. See the note above: the cost of getting this wrong is a board at
  // double height, not merely double width.
  if (right <= BOARD_COLS / 4) return
  rescaleStored(LAYOUT_KEY, 2)
  // Same reasoning as the migration: the account's copy is still in old units,
  // so the synced marker has to go or the next load adopts it over the repair.
  localStorage.removeItem(SYNCED_KEY)
}

try {
  if (!localStorage.getItem(REPAIR_KEY)) {
    if (SCALE === 1) repairHalfSizeBoard()
    localStorage.setItem(REPAIR_KEY, '1')
  }
} catch {
  /* best-effort — a board that cannot be repaired can still be dragged back */
}

/**
 * The SERVER copy only. Local blobs were rewritten on disk above, so scaling
 * them again here would double-apply; the account's copy is still in whatever
 * units it was saved under, and is corrected on the way in until the user next
 * presses Save layout.
 */
function serverToCurrentGrid(i: BoardItem): BoardItem {
  if (SCALE === 1) return i
  return { id: i.id, x: i.x * SCALE, y: i.y * SCALE, w: i.w * SCALE, h: i.h * SCALE }
}

// ── NO CARD MAY BE UNREACHABLE ───────────────────────────────────────────────
//
// Every repair above reasons about what a board PROBABLY was. This one does not
// reason at all — it is the floor under all of them.
//
// The board's scroll port is `overflow-y-auto`: vertical only. So a card wider
// than the grid extends past the right edge with no way to scroll to it, and its
// resize handle — bottom-RIGHT corner — is off-screen. The card cannot be made
// smaller, cannot be moved, cannot be removed by any gesture aimed at it. That
// is the "the cards are super big and they can't be adjusted" report, and it is
// what makes an over-scaled board a dead end rather than an annoyance: the state
// removes the very controls that would undo it.
//
// So geometry is clamped into the grid on the way IN, on every read, from every
// source — localStorage, the synced copy, the account's copy off the wire. A
// correct board passes through untouched (these are no-ops on legal values), and
// no stored blob, however corrupt and whatever produced it, can put a card
// somewhere the user cannot reach. Repairs get to be approximate because this is
// not.
//
// HEIGHT is capped too, generously. A tall card is at least scrollable-to, so
// this is not the same emergency; but a card several screens deep has its resize
// handle several screens down, which is unreachable in every sense that matters.
// 300 rows is 2400px — taller than any card anyone laid out on purpose.
const BOARD_MAX_H = 300

function fitToGrid(i: BoardItem): BoardItem {
  const w = Math.max(BOARD_MIN_W, Math.min(Math.round(i.w), BOARD_COLS))
  const h = Math.max(BOARD_MIN_H, Math.min(Math.round(i.h), BOARD_MAX_H))
  return {
    id: i.id,
    x: Math.max(0, Math.min(Math.round(i.x), BOARD_COLS - w)),
    y: Math.max(0, Math.round(i.y)),
    w,
    h,
  }
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
 *
 * `regrid` converts stored numbers into current grid units. It is the IDENTITY
 * for local reads, because the migration above already rewrote those blobs on
 * disk; only the server copy still arrives in whatever units it was saved under.
 */
export function sanitizeLayout(
  raw: unknown,
  compact = !readFreeMode(),
  regrid: (i: BoardItem) => BoardItem = (i) => i,
): BoardItem[] | null {
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
    // fitToGrid LAST: regrid may scale the server's copy up into current units,
    // and it is the result of that — what will actually be rendered — that has
    // to be reachable.
    kept.push(
      fitToGrid(
        regrid({
          id,
          x: item.x as number,
          y: item.y as number,
          w: item.w as number,
          h: item.h as number,
        }),
      ),
    )
  }
  if (!kept.length) return null
  // Free mode still needs the OVERLAP rule enforced on a blob that may be
  // corrupt or written by an older build — resolveBoard is that rule without
  // the gravity.
  return compact ? compactBoard(kept) : resolveBoard(kept)
}

/**
 * AN EMPTY BOARD IS A BOARD.
 *
 * sanitizeLayout answers null for an empty array so the caller "can tell 'no
 * saved layout' from 'an empty one'" — and this function then threw that
 * distinction away, because null is also what a missing key returns. It did not
 * matter until "Clear all" existed: BoardPage falls back to `defaultLayout()`
 * on null, so a board the user had deliberately emptied came back as the three
 * starter cards on the next load, which reads as the clear not having worked.
 *
 * So the two cases are separated HERE, where the difference is actually known:
 * no key at all -> null (never opened this board, give them the starter set);
 * a key holding `[]` -> `[]` (they cleared it on purpose, and it stays cleared).
 * Anything else goes through sanitizeLayout unchanged.
 */
function readKey(key: string): BoardItem[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed) && parsed.length === 0) return []
    return sanitizeLayout(parsed)
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
  // Same distinction readKey makes, for the same reason: a user who cleared
  // their board and pressed Save layout has an account copy that is legitimately
  // `[]`, and folding that into null would hand every OTHER machine they sign in
  // on the starter three instead of the empty board they saved.
  const layout =
    Array.isArray(pick.layout) && pick.layout.length === 0
      ? []
      : sanitizeLayout(pick.layout, undefined, serverToCurrentGrid)
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
