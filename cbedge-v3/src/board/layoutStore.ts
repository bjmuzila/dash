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

// ── AN OVER-SCALED BOARD THAT STILL FITS (2026-09-14) ────────────────────────
//
// The `right > BOARD_COLS` trigger below only sees a board that has been pushed
// off the grid HORIZONTALLY. It cannot see the case customers actually report as
// "the cards are huge and I can't see anything": a board doubled in BOTH
// dimensions that still fits across.
//
// That is a reachable state, not a hypothesis. repairHalfSizeBoard() doubles w
// AND h on any board whose right edge lands between BOARD_COLS/4 and
// BOARD_COLS/2 — a perfectly current board with a few cards on the left half
// matches that description. After the doubling its right edge is between
// BOARD_COLS/2 and BOARD_COLS, so it FITS, so the trigger below never fires;
// and because that repair is behind a one-shot key it never runs again either.
// Every card is twice as wide and twice as tall, permanently. A 19-row card
// becomes 38 rows — 304px of chart becomes 608px, and one card fills the screen.
//
// The catalog already knows how to prove this: catalogOverscale() returns a
// clean power-of-two only when EVERY card on the board is that same multiple of
// its own default size, which is true of a uniformly scaled board and false the
// moment anyone has resized anything. So the evidence is the same evidence the
// off-grid repair already trusts — it was simply never consulted unless the
// board had also fallen off the right edge.
//
// Safe on every load for the same reason the off-grid check is: a correct board
// has cards at (or near) their defaults, the ratio is 1, unanimity fails on the
// first card, and nothing happens. A user who deliberately set EVERY card to
// exactly 2x its default and nothing else is the false positive, and they are
// one drag from undoing it — as against a board that cannot be read at all.
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
  const over = catalogOverscale(items)
  // Two independent reasons to act. Off the grid is proof on its own; unanimous
  // catalog evidence is proof even when the board still fits.
  const offGrid = right > BOARD_COLS
  if (!offGrid && over < 2) return

  let factor = 1 / over
  // Whatever the catalog said (including "no idea", which is 1), a board that is
  // off the grid has to end up back on it. Keep halving until it does. A board
  // that already fits is corrected by the catalog factor alone — halving it to
  // "fit" would shrink a board that was never too wide.
  if (offGrid) {
    let fitted = right * factor
    while (fitted > BOARD_COLS) {
      factor /= 2
      fitted /= 2
    }
  }
  if (factor === 1) return
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

// ─────────────────────────────────────────────────────────────────────────────
// NAMED LAYOUTS ("presets")
//
// One board was never enough: a pre-market board, a 0DTE board, a board for
// reviewing the day. So a board can be SAVED UNDER A NAME and any saved name
// loaded back onto the screen.
//
// ── Where they live, and why it is split ─────────────────────────────────────
// For everyone: the BROWSER. localStorage, one key holding the whole library.
// It is free, synchronous, works signed out, and a layout library is a working
// preference rather than account data — the same tier the card settings and the
// free-placement flag already use.
//
// For the OWNER, additionally: POSTGRES, through the same /api/dashboard-layout
// route the single-board save already uses. That route has always been able to
// hold up to 12 NAMED templates per page (`dashboard_layouts`, keyed
// (clerk_user_id, page, name)) — v3's home board simply only ever wrote one of
// them, `Default`. Nothing on the server changes for this; the client stopped
// pretending the table had one row.
//
// The two are not a sync engine. Local is written first and is what the board
// reads on open, so a failed or slow request never costs the owner a save; the
// account's copy is merged OVER the local one when it arrives (mergePresets),
// because the account is the copy that saw the other machine.
//
// ── The named library is NOT the autoloaded board ────────────────────────────
// `cb-v3-board-layout` (the working board) and the account's `Default` template
// are untouched by any of this: opening the page still restores exactly what
// was on screen last time, saved or not. Loading a preset is an EDIT — it
// replaces the working board, autosaves locally like any other gesture, and
// leaves the header saying "Unsaved layout" until Save layout is pressed. A
// preset the user merely looked at is not a board they committed to.
// ─────────────────────────────────────────────────────────────────────────────

/** The browser's whole layout library. */
export const PRESETS_KEY = 'cb-v3-board-presets'
/** Which named layout is on screen, for the button's label. Cosmetic. */
export const ACTIVE_KEY = 'cb-v3-board-preset'
/** The server's own per-page cap (LAYOUT_MAX_TEMPLATES in api-router.js). */
export const MAX_PRESETS = 12

export interface NamedLayout {
  name: string
  layout: BoardItem[]
  updatedAt: string | null
  /** Server rows only — the template the account auto-loads. */
  isDefault?: boolean
}

/**
 * The server's cleanLayoutName, reproduced exactly. A name that round-trips
 * differently locally and remotely would give the owner two rows for one
 * layout, one of which they can never overwrite.
 */
export function cleanPresetName(v: string): string {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 40)
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * The library, reconciled against this build's catalog on the way out — a
 * preset saved before a card was retired is still a usable board without it.
 *
 * An EMPTY preset survives, for the same reason readKey keeps an empty working
 * board: "a board with nothing on it" is something a user can save on purpose.
 */
export function readPresets(): NamedLayout[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: NamedLayout[] = []
    for (const p of parsed) {
      if (!p || typeof p !== 'object') continue
      const row = p as Record<string, unknown>
      const name = cleanPresetName(String(row.name ?? ''))
      if (!name || out.some((o) => sameName(o.name, name))) continue
      const layout =
        Array.isArray(row.layout) && row.layout.length === 0 ? [] : sanitizeLayout(row.layout)
      if (!layout) continue
      out.push({
        name,
        layout,
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
      })
    }
    return sortPresets(out)
  } catch {
    return []
  }
}

export function writePresets(list: NamedLayout[]): void {
  try {
    localStorage.setItem(
      PRESETS_KEY,
      JSON.stringify(
        list.slice(0, MAX_PRESETS).map((p) => ({
          name: p.name,
          layout: p.layout.map(gridOnly),
          updatedAt: p.updatedAt,
        })),
      ),
    )
  } catch {
    /* best-effort — the in-memory library still works for this session */
  }
}

/** Alphabetical, case-insensitive: the list is read, not scrolled by recency. */
function sortPresets(list: NamedLayout[]): NamedLayout[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/**
 * Save under a name, replacing any layout already under it. Matching is
 * case-INSENSITIVE so "Premarket" and "premarket" cannot both exist — two rows
 * a user reads as one name is how you lose a layout you thought you overwrote.
 * The name the user just typed wins, so re-saving can also fix its casing.
 */
export function upsertPreset(list: NamedLayout[], name: string, layout: BoardItem[]): NamedLayout[] {
  const clean = cleanPresetName(name)
  if (!clean) return list
  const kept = list.filter((p) => !sameName(p.name, clean))
  return sortPresets([
    ...kept,
    { name: clean, layout: layout.map(gridOnly), updatedAt: new Date().toISOString() },
  ]).slice(0, MAX_PRESETS)
}

export function removePreset(list: NamedLayout[], name: string): NamedLayout[] {
  return list.filter((p) => !sameName(p.name, name))
}

export function readActivePreset(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY) || null
  } catch {
    return null
  }
}

export function writeActivePreset(name: string | null): void {
  try {
    if (name) localStorage.setItem(ACTIVE_KEY, name)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    /* best-effort */
  }
}

/**
 * The account's library laid over the browser's. The SERVER wins a name
 * collision: it is the copy that has seen every machine, and a browser that
 * merely holds an older blob under the same name has nothing to add.
 *
 * Names only in the browser are KEPT rather than dropped. A local-only preset
 * is either one saved before the account answered or one from a machine that
 * never pushed; discarding it on the strength of "the server did not mention
 * it" would delete layouts the user can see, which is the one outcome worth
 * avoiding here.
 */
export function mergePresets(local: NamedLayout[], server: NamedLayout[]): NamedLayout[] {
  const localOnly = local.filter((l) => !server.some((s) => sameName(s.name, l.name)))
  return sortPresets([
    ...localOnly,
    ...server.map((s) => ({ name: s.name, layout: s.layout, updatedAt: s.updatedAt })),
  ]).slice(0, MAX_PRESETS)
}

// ── THE WIRE ────────────────────────────────────────────────────────────────

async function postLayout(body: Record<string, unknown>): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page: BOARD_PAGE, ...body }),
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error || `${res.status} ${res.statusText}`)
  }
}

/**
 * EVERY template the account holds for this page.
 *
 * A 401/403 answers `[]` rather than throwing: not signed in is not a failure,
 * there is simply nothing to load. A row this build cannot render at all falls
 * out; a row holding an empty board is kept, per readPresets.
 */
export async function fetchServerLayouts(signal?: AbortSignal): Promise<NamedLayout[]> {
  const res = await fetch(`${ENDPOINT}?page=${encodeURIComponent(BOARD_PAGE)}`, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal,
  })
  if (res.status === 401 || res.status === 403) return []
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const data = (await res.json()) as { templates?: unknown }
  const templates = Array.isArray(data?.templates) ? data.templates : []
  const out: NamedLayout[] = []
  for (const row of templates) {
    if (!row || typeof row !== 'object') continue
    const t = row as Record<string, unknown>
    // Same distinction readKey makes, for the same reason: a user who cleared
    // their board and saved it has an account copy that is legitimately `[]`,
    // and folding that into null would hand every OTHER machine they sign in
    // on the starter three instead of the empty board they saved.
    const layout =
      Array.isArray(t.layout) && t.layout.length === 0
        ? []
        : sanitizeLayout(t.layout, undefined, serverToCurrentGrid)
    if (!layout) continue
    out.push({
      name: typeof t.name === 'string' ? t.name : BOARD_TEMPLATE,
      layout,
      updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : null,
      isDefault: t.isDefault === true,
    })
  }
  return out
}

/**
 * The account's AUTOLOADING board — the row flagged default, or the only row
 * there is. This is what replaces the screen on open, so it deliberately does
 * not care how many named templates sit beside it.
 */
export async function fetchServerLayout(signal?: AbortSignal): Promise<ServerLayout | null> {
  const all = await fetchServerLayouts(signal)
  const pick = all.find((t) => t.isDefault) ?? all[0]
  if (!pick) return null
  return { name: pick.name, layout: pick.layout, updatedAt: pick.updatedAt }
}

/**
 * Write a board to the account under a name.
 *
 * `makeDefault` defaults to TRUE because the caller that has always existed —
 * "Save layout" — means the board that comes back on open. Saving a NAMED
 * preset passes false: adding "Premarket" to the library must not silently
 * change which board the next machine opens with. (The route makes the first
 * template for a page the default regardless, which is correct: the library's
 * only entry is the only thing it could load.)
 */
export async function saveServerLayout(
  layout: BoardItem[],
  name = BOARD_TEMPLATE,
  makeDefault = true,
): Promise<void> {
  await postLayout({ name, layout: layout.map(gridOnly), makeDefault })
}

/** Drop one named template from the account. */
export async function deleteServerLayout(name: string): Promise<void> {
  await postLayout({ name, action: 'delete' })
}

/** Pick the template the account auto-loads. */
export async function setDefaultServerLayout(name: string): Promise<void> {
  await postLayout({ name, action: 'set-default' })
}
