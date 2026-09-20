# The grid board — `/board`

**Route:** `<Route path="/board" element={<Home />} />` in `src/App.tsx`. **Mounted by** `src/pages/Home.tsx` (10 lines), which is nothing but `export default function Home() { return <BoardPage /> }` — and which is the **one statically-imported page in the app**. **Production URL:** `voltick.cbedge.net/v3/board`.

**Sources:** `src/pages/Home.tsx` (10), `src/board/BoardPage.tsx` (831), `src/board/layoutStore.ts` (817), `src/board/catalog.tsx` (444), `src/design/primitives/Board.tsx` (1149), `src/design/primitives/Card.tsx` (238), `src/design/primitives/Expand.tsx` (106), `src/shell/ToolbarSlot.tsx` (54). Supporting: `src/shell/CopyShot.tsx` (556), `src/shell/Shell.tsx` (739), `src/board/cardTitle.tsx` (50), `src/design/tokens.css` (716), `src/design/useIsPhone.ts` (56), `src/mobile/mobileNav.ts` (141), `src/data/auth.tsx` (130), `src/design/primitives/Page.tsx` (38), `AGENTS.md`, `budgets.json`, `vite.config.ts`.

---

## What it is, in one paragraph

`/board` is the inherited terminal: a customisable grid of cards on a 48-column lattice with 8px rows. You add cards from a catalog dropdown, drag them by their title bar, resize them from a corner grip, remove them with an ✕, and the arrangement autosaves to `localStorage` on every gesture and can be pushed to your account with **Save layout**, or saved under a name into a library of up to twelve. A row holds one, two or three cards and nothing else, so widths are always the whole board, a half or a third; dropping a card into a full row re-splits it rather than evicting anyone. The default placement mode is **free** — cards stay where you drop them and a deliberate gap stays a gap — with auto-arrange (gravity) one click away. Every card is a `Card` primitive, so every card can be expanded onto a stage filling the page column. The board's controls do not live on the page: they portal up into the shell toolbar through `ToolbarSlot`, which is why this page starts at the very top of the page column with no header row.

`App.tsx` is explicit that this is no longer the landing page — *"HOME IS THE CARDS. This app is a place to open one card and work on it, so the tile grid is the landing and the old grid board is a page like any other, at `/board`"* — and, on the neighbouring route, *"`/single` is the Voltmap, NOT `/board` — `/board` is the inherited card grid and renaming it would break every link to it."*

---

## File map

| File | Lines | Owns |
|---|---|---|
| `src/pages/Home.tsx` | 10 | The default export, nothing else. *"Home is the terminal: a customizable card board."* |
| `src/board/BoardPage.tsx` | 831 | All page state (layout, synced copy, lock, free, menus, presets, remote status, Clear-all arming), the entire `ToolbarSlot` contents, the `arrange()` placement funnel, CopyShot publication, and the `render()` callback that wraps each item in a `Card`. |
| `src/board/layoutStore.ts` | 817 | Every storage key and its shape. The grid migration + three repair passes. `sanitizeLayout`/`readKey`/`writeKey`/`fitToGrid`/`sameLayout`. The named-layout library. The `/api/dashboard-layout` wire. |
| `src/board/catalog.tsx` | 444 | `CARD_CATALOG`, `CARD_BY_ID`, the `CardDef` contract, the `lazy()` wrappers + `Deferred`, `QuickLinksCard`, the `RENAMED` map, and `cardTypeOf`/`migrateCardId`/`newInstanceId`/`placeNewCard`. |
| `src/design/primitives/Board.tsx` | 1149 | The geometry engine: grid constants, the lane rule, `compactBoard`/`resolveBoard`/`settleBoard`/`snapBoard`/`laneSnap`, `squeezeAside`, `stepAside`, `fillGaps`, `spreadRow`, `joinRow`, the pointer gestures, the landing slot, the measurement machinery, the phone branch, `data-card-id`. |
| `src/design/primitives/Card.tsx` | 238 | The one panel in the app: the 32px single-row header, the `CardToolbar` portal slot, `data-card`/`data-card-instance`/`data-card-expanded`, the expand button, the `v3`/`v2` plate switch, `stale`. |
| `src/design/primitives/Expand.tsx` | 106 | `ExpandStageHost` + `useExpandStage`: the `absolute inset-0` stage inside the page column, one expanded card at a time, Escape to leave. |
| `src/shell/ToolbarSlot.tsx` | 54 | `ToolbarSlotProvider`/`ToolbarSlotHost`/`ToolbarSlot` — a DOM portal from the mounted route into the toolbar. |

---

## The grid, and the lane rule

### Constants

```ts
export const BOARD_COLS = 48
export const BOARD_ROW_H = 8      // px
export const BOARD_MIN_W = 4      // grid units
export const BOARD_MIN_H = 6      // grid units
const MATCH_SNAP = 2              // grid units — neighbour-size snap tolerance
```

Plus `Board` props with defaults: `cols = BOARD_COLS`, `rowH = BOARD_ROW_H`, `gutter = 8` (px), `minW`, `minH`, `locked = false`, `free = false`. `BoardPage` passes only `locked` and `free`.

### Why 48

> It started at 12 columns and 32px rows, and that was the real reason "put the cards where I want" kept failing. Twelve columns means one column is 8% of the board and an edge can only land on one of thirteen places. Two charts beside a 5-wide panel is 3 + 3 + 5 = 11: there is a spare column and NO arrangement spends it — make the charts equal and a hole is left, close the hole and the charts are different widths. Never a snapping bug; the grid was too coarse to express the layout being asked for.
>
> 24 fixed that particular board and still felt like slots. At 48 an edge lands within ~2% of the board of wherever the pointer is, and at that resolution the grid stops being something you can feel — which is the whole point, and also why the position magnet that used to live in this file is gone.

Provenance is recorded, not guessed: *"Chosen by driving the real engine in `generated/2026-09-06-board-lab.html` against these presets… 48 columns, 8px rows, no position snapping, squeeze on, gap-closing on."*

### One, two or three across

> A row holds one card, two, or three. Nothing else. So a card's width is the whole board, a half of it or a third of it, and its left edge sits on a boundary of its OWN width: halves at 0 and 24, thirds at 0, 16 and 32.

```ts
export function laneWidths(cols = BOARD_COLS) { return [Math.round(cols/3), Math.round(cols/2), cols] }  // [16, 24, 48]
export function snapLaneW(w, cols)   // nearest legal width; a tie goes to the WIDER one
export function snapLaneX(x, w, cols) // lanes = max(1, round(cols/w)); clamp(round(x/w), 0, lanes-1) * w
```

So `w=16` may sit at x 0/16/32, `w=24` at 0/24, `w=48` only at 0. Why the rule: *"Two cards sharing a row come out the same size without anyone aiming for it, three come out exact thirds, and a fourth cannot wedge itself into a sliver at the end of a row. Everything below still runs — the drag, the squeeze, the gap-closing — but its result is put back on a lane before it is committed, so none of them can invent a width the rule does not allow."* And: *"48 divides by both 2 and 3, which is why the lane sizes are whole units and three thirds add up to the board exactly."*

`laneSnap()` applies it (changing only `x`, `w`, flooring `y` at 0 and `h` at `BOARD_MIN_H`). `snapBoard()` lane-snaps then settles overlaps **downward only**, because *"a card never changes lane to get out of the way, because changing lane is the one thing that would break the rule it was just snapped into."* The pinned card is placed first so it keeps the lane the pointer chose.

### Geometry

```ts
const colW       = cols > 0 && width > 0 ? (width + gutter) / cols : 0
const maxRows    = active.reduce((m, i) => Math.max(m, i.y + i.h), 0)
const gridRows   = Math.max(maxRows + 4, 12)
const containerH = gridRows * rowH + (gridRows - 1) * gutter

const pxBox = (it) => ({
  left: it.x * colW, top: it.y * (rowH + gutter),
  width:  Math.max(0, it.w * colW - gutter),
  height: Math.max(0, it.h * (rowH + gutter) - gutter),
})
```

`colW` is `(width + gutter) / cols`, not `width / cols` — the gutter is subtracted back out per tile. One grid row costs **16px** of travel; a card of height `h` is `h × 16 − 8` px tall (a 48-row card = 760px, a 20-row card = 312px). `gridRows` keeps *"two spare rows of slack under the tallest card, in a unit half the size it used to be — hence 4, not 2. Same slack, finer grid"*, minimum 12 rows → an empty board is 184px. Tiles are `position: absolute` in a `relative` wrapper.

### Measuring the board

One number decides everything, and getting it wrong is invisible: *"the board just comes up as a scale model of itself, every card proportionally correct inside a container half the width it should be, with the text in each card wrapped into a column. That is the bug this replaces: a board rendering at ~640px inside a ~1290px pane, on load, intermittently."*

The old version measured once and trusted a `ResizeObserver`. Both halves can fail — the first read can land before the shell's flex layout settles, and *"Its callback here changes the board's HEIGHT, which can add or remove the scroll port's scrollbar, which changes the width, which calls the callback: the classic 'ResizeObserver loop completed with undelivered notifications'. After that the width is frozen at whatever it was, forever."*

So, **never trust a single source**: (1) `measure()` is idempotent, setting state only on a >0.5px change; (2) `useLayoutEffect(measure)` with **no dependency array** runs after every commit — *"a wrong width cannot survive a re-render, so the board self-heals on the next state change even if every listener has failed"*; (3) the observer watches the wrapper **and its parent**, joined by `window.resize`, `visibilitychange` and `document.fonts.ready`; (4) every callback goes through a `requestAnimationFrame`, *"the documented fix for the delivery loop above."* `getBoundingClientRect().width` over `clientWidth` because *"it is the box the tiles are actually positioned in, and it is subpixel."*

---

## Instance ids and the `#n` suffix

```ts
const INSTANCE_SEP = '#'
export function cardTypeOf(instanceId: string): string   // 'gex-chart#2' → 'gex-chart'
```

> A grid item's `id` is an INSTANCE id, not a catalog id. The first copy of a card keeps the bare catalog id (`gex-chart`); every copy after it gets a `#n` suffix (`gex-chart#2`). Two consequences, both deliberate: Every layout ever saved is still valid, and still means what it meant. No migration pass, no version field. Anything keyed on the bare id — a saved board from last week, the `data-card-id` selectors perf-check drives — keeps working, because the first instance is still spelled exactly the way it always was.
>
> The suffix is a SUFFIX, not a rename: the catalog is looked up through `cardTypeOf()`, which strips it.

`newInstanceId(cardId, takenIds)` returns the bare id if free, else counts up from 2 — *"Counts up rather than reusing the lowest free number, so removing card #2 and adding another does not resurrect the old name."* Remove `#2` from `#1,#2,#3` and the next add is `#4`.

### A second copy is the size of the first

```ts
const sibling = [...existing].reverse().find((i) => cardTypeOf(i.id) === cardId)
const { w, h } = sibling ?? def?.defaultSize ?? { w: 16, h: 24 }
const y = existing.reduce((m, i) => Math.max(m, i.y + i.h), 0)
return { id: newInstanceId(cardId, existing.map((i) => i.id)), x: 0, y, w, h }
```

> The catalog's `defaultSize` is the right answer for the first one and the wrong one for every copy after it: the card on the board has been resized to fit this user's arrangement, and a second GEX Candles that arrives at the factory size has to be dragged back to match before the pair can be read as a pair.
>
> The LAST one placed, not the first: if there are already three and they were resized over time, the most recent is the size currently being worked to.

New cards always land at `x: 0`, at the bottom, then go through `arrange()`.

### Renames

```ts
const RENAMED = { 'es-candles': 'gex-candles', 'multi-chart': 'multi-greek' }
export function migrateCardId(id: string): string   // renames the TYPE, the #n rides along
```

> A saved board is a list of ids, and BoardPage drops any id the catalog does not know — which is right for a card that was deleted and wrong for one that was merely renamed: the user would open the board to find their chart gone and have to re-add and re-place it.

`es-candles → gex-candles` because *"the futures were dropped, so the card is no longer about ES"*; `multi-chart → multi-greek` because *"the ES-vs-NQ overlay was replaced outright by the Multi Greek ladder."* Renames run **before** the catalog membership test in `sanitizeLayout`, and `catalogOverscale()` also migrates ids before looking up `defaultSize`.

### The number on a card's header

`BoardPage` memoises `countByType` (type → count) and `ordinalById` (instance id → 1-based number within its type), and renders the ordinal only when there is more than one: *"two cards with identical titles is a board you cannot talk about, and a '1' on a card that has no sibling is noise."* The same rule drives the `+ Add card` `×N` badge and the CopyShot label.

---

## Layout persistence — three tiers

### The keys

| Constant | Key | Shape | Written by |
|---|---|---|---|
| `LAYOUT_KEY` | `cb-v3-board-layout` | `BoardItem[]` = `[{id,x,y,w,h},…]`, JSON | every gesture (autosave) |
| `SYNCED_KEY` | `cb-v3-board-synced` | same | only `saveLayout()` and the server-load path |
| `FREE_KEY` | `cb-v3-board-free` | `'1'` / `'0'` | the placement toggle |
| `GRID_KEY` | `cb-v3-board-grid` | `'48'` — the grid width this build writes in | **unconditionally, every module load** |
| `REPAIR_KEY` | `cb-v3-board-grid-repair` | `'1'` | once per browser |
| `PRESETS_KEY` | `cb-v3-board-presets` | `[{name, layout, updatedAt},…]`, max 12 | the layout library |
| `ACTIVE_KEY` | `cb-v3-board-preset` | the active preset's name, bare string | loading/saving a preset |

**No version field on any of them.** The `#n` design exists so there is nothing to version; validity is decided at read time by `sanitizeLayout`. `writeKey` runs every item through `gridOnly()` — *"Strip anything a card put on the item; the wire contract is `{id,x,y,w,h}`."*

### Tier 1 — localStorage autosave

```ts
useEffect(() => {
  if (!savedOnceRef.current) { savedOnceRef.current = true; return }
  writeLocalLayout(layout); setFlash(true)
  const t = setTimeout(() => setFlash(false), 1200); return () => clearTimeout(t)
}, [layout])
```

*"There's nothing to debounce against: it's a local write, not a network round trip."* The first run is skipped so mounting does not claim a save — load-bearing, and the mechanism behind the 2026-09-07 bug below.

### Tier 2 — the account

> "SAVE LAYOUT" (edit mode) writes the same array to Postgres through v2's `/api/dashboard-layout`, per account… The autosave is deliberately NOT the thing that hits the network. A drag emits a layout per animation frame; posting those would be a request storm, and it would make every accidental nudge permanent across every device the user owns. Saving to the account is an act, not a side effect.

Backend named precisely: *"`server-v2/api-router.js` (`register('/api/dashboard-layout')`) and the table is `dashboard_layouts` in `_lib-db.cjs` — keyed (clerk_user_id, page, name), one row flagged `is_default`, the layout column stored opaquely."*

```ts
export const BOARD_PAGE = 'v3-home'        // must match /^[a-z0-9][a-z0-9_-]{0,39}$/
export const BOARD_TEMPLATE = 'Default'
export const MAX_PRESETS = 12              // the server's LAYOUT_MAX_TEMPLATES
const ENDPOINT = '/api/dashboard-layout'
```

The page key is still `v3-home`, not `v3-board` — the route moved, the key did not, which is what keeps every saved board loading.

### Tier 3 — `cb-v3-board-synced`, the arbiter

> A copy of the layout as the server last saw it. It exists to answer one question on load: does this browser hold edits the account has never been told about? If local === synced, the server copy is adopted (it may be newer, from another machine). If they differ, the local edits stay on screen and the header says the layout is unsaved. Without it, opening the board on a laptop would silently throw away whatever was rearranged there but not saved.

`BoardPage` captures both at mount — `const [boot] = useState(() => ({ local: readLocalLayout(), synced: readSyncedLayout() }))` — because *"the autosave effect below overwrites the local key on the first change, so it has to be captured at mount."* The adoption test is `localUnsaved = boot.local != null && !sameLayout(boot.local, boot.synced)`; if not unsaved, `setLayoutState(arrangeRef.current(tpl.layout, false))`. Otherwise the local board stays, *"because silently discarding it is the one outcome that loses work."*

`sameLayout` compares by id → `${x},${y},${w},${h}`, **order-insensitively**: *"the array order is an artifact of how cards were added… This decides whether 'Save layout' has anything to do, so it has to answer about what the user can SEE."*

### The wire

```
GET  /api/dashboard-layout?page=v3-home     credentials: same-origin, accept: application/json
POST /api/dashboard-layout                  { page: 'v3-home', name, layout, makeDefault }
POST /api/dashboard-layout                  { page: 'v3-home', name, action: 'delete' }
POST /api/dashboard-layout                  { page: 'v3-home', name, action: 'set-default' }
```

- `fetchServerLayouts(signal)` — **401/403 → `[]`, not a throw**: *"not signed in is not a failure, there is simply nothing to load."* Other non-ok → `throw new Error('<status> <statusText>')`. Reads `{ templates?: unknown }`; a non-array → `[]`. A row this build cannot render falls out; a row holding `[]` is kept.
- `fetchServerLayout(signal)` — `all.find(t => t.isDefault) ?? all[0] ?? null`. *"This is what replaces the screen on open, so it deliberately does not care how many named templates sit beside it."*
- `saveServerLayout(layout, name='Default', makeDefault=true)` — *"`makeDefault` defaults to TRUE because the caller that has always existed — 'Save layout' — means the board that comes back on open."* A named preset passes `false`.
- `deleteServerLayout(name)`, `setDefaultServerLayout(name)` — the latter is exported and **never called**.
- `postLayout()` surfaces the server's own message: `throw new Error(detail?.error || `${res.status} ${res.statusText}`)`.

These are raw `fetch`, **not** `src/data/api.ts`'s `query()`. So there is no `staleMs`, no `pollMs`, no dedupe, and the toolbar's `↻` (`refreshAll()`, which revalidates registered `useQuery` consumers) does not reach them. The account board is read exactly once per mount of `BoardPage`.

### Empty is a board

```ts
function readKey(key) {
  const raw = localStorage.getItem(key); if (!raw) return null
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed) && parsed.length === 0) return []
  return sanitizeLayout(parsed)
}
```

> `sanitizeLayout` answers null for an empty array so the caller "can tell 'no saved layout' from 'an empty one'" — and this function then threw that distinction away… It did not matter until "Clear all" existed: BoardPage falls back to `defaultLayout()` on null, so a board the user had deliberately emptied came back as the three starter cards on the next load, which reads as the clear not having worked.
>
> no key at all -> null (never opened this board, give them the starter set); a key holding `[]` -> `[]` (they cleared it on purpose, and it stays cleared).

The same distinction is repeated in `fetchServerLayouts` (*"a user who cleared their board and saved it has an account copy that is legitimately `[]`, and folding that into null would hand every OTHER machine they sign in on the starter three"*) and in `readPresets`.

### `sanitizeLayout` — the one read path

```ts
export function sanitizeLayout(raw, compact = !readFreeMode(), regrid = (i) => i): BoardItem[] | null
```

Rejects a non-array or empty array (`null`); per item requires a string `id` and four numeric `x/y/w/h`; applies `migrateCardId`; drops ids whose type is not in `CARD_BY_ID`; dedupes **on the instance id** (*"two GEX Charts is a board the user built on purpose, while the same instance id twice is a corrupt blob that would collide in the grid"*); then `fitToGrid(regrid(item))` — regrid first, clamp last, *"because it is the result of that — what will actually be rendered — that has to be reachable."* Finishes with `compact ? compactBoard(kept) : resolveBoard(kept)`.

The `compact` default is the free-mode preference, and that default is the point: *"this function is what every read path goes through, so leaving it hard-coded to compactBoard would flatten a deliberately spaced board back to the top-left on every reload — the arrangement would survive the gesture and die on refresh, which is worse than never having saved it."*

### `fitToGrid` — no card may be unreachable

```ts
const BOARD_MAX_H = 300   // rows → 2400px
const w = Math.max(BOARD_MIN_W, Math.min(Math.round(i.w), BOARD_COLS))
const h = Math.max(BOARD_MIN_H, Math.min(Math.round(i.h), BOARD_MAX_H))
x = Math.max(0, Math.min(Math.round(i.x), BOARD_COLS - w));  y = Math.max(0, Math.round(i.y))
```

> Every repair above reasons about what a board PROBABLY was. This one does not reason at all — it is the floor under all of them.
>
> The board's scroll port is `overflow-y-auto`: vertical only. So a card wider than the grid extends past the right edge with no way to scroll to it, and its resize handle — bottom-RIGHT corner — is off-screen. The card cannot be made smaller, cannot be moved, cannot be removed by any gesture aimed at it. That is the "the cards are super big and they can't be adjusted" report… the state removes the very controls that would undo it.
>
> Repairs get to be approximate because this is not.

Height is capped *"generously… 300 rows is 2400px — taller than any card anyone laid out on purpose."*

---

## The grid migrations and repairs

Four module-scope passes run **on import**, in this order. Every one carries a dated post-mortem.

### 0. `storedGrid()` and `SCALE`

```ts
function storedGrid() {
  const stamp = localStorage.getItem(GRID_KEY); if (stamp) return Number(stamp) || BOARD_COLS
  const seen = localStorage.getItem(LAYOUT_KEY) ?? localStorage.getItem(SYNCED_KEY)
  return seen ? 12 : BOARD_COLS
}
const SCALE = BOARD_COLS / storedGrid()
```

The board went **12 cols / 32px rows → 24 / 16 → 48 / 8**; each step halved the unit, so the factor is 2 from 24 and 4 from 12. The "no stamp and no board at all" branch matters: *"Without this check a fresh browser would be treated as a 12-column veteran and would QUADRUPLE the first server layout it loaded."*

### 1. The rescale, and the 2026-09-07 bug

> The first version only STAMPED the key at module load and scaled on read. The stored blob was left in old units, on the assumption that the autosave would rewrite it. It does not: BoardPage's autosave deliberately skips its first run and only fires on an actual gesture. So opening the board and NOT dragging anything left `cb-v3-board-layout` in old units with the key claiming the new grid — and on the very next reload SCALE was 1, the old blob was taken at face value, and every card came back at HALF SIZE crammed into the left half of the board. Which is exactly what it looked like: not a broken layout, a correct layout in the wrong units. It had shipped twice (12→24, then 24→48), which is why it was "not the first time I've seen this".

So `rescaleStored()` now **rewrites the stored blob** and only then stamps. It works in the raw `{id,x,y,w,h}` shape *"deliberately NOT through sanitizeLayout, which would drop unknown cards and, worse, apply the scale a second time."* The synced copy is **dropped, not rescaled**: *"Rescaling it would make local === synced, which is BoardPage's signal that the account copy may safely replace what is on screen; the next load would then adopt the account's old-unit board and put every card back at half size. Removing it makes them differ, so the migrated local board wins and the header honestly says 'Unsaved layout'."*

### 2. The stamp is unconditional — the 2026-09-08 "board came back enormous" bug

The stamp used to live inside the `SCALE !== 1` block:

> ```
> load 1  no stamp, no layout  -> storedGrid() = BOARD_COLS, SCALE = 1
>                              -> the block is skipped, so NOTHING IS STAMPED
>         ...the user arranges a board; the autosave writes cb-v3-board-layout
> load 2  no stamp, but a layout EXISTS -> storedGrid() reads that as "a
>         browser from the 12-column era" -> SCALE = 4 -> every card, and the
>         account copy arriving through serverToCurrentGrid, multiplied by 4.
> load 3  stamped 48 now, so SCALE = 1 and the quadrupled board is permanent.
> ```
>
> A card 96 columns wide on a 48-column grid is twice the width of the board, so the symptom is one card filling the screen and nothing else visible — and "the tables won't sit side by side", because at that width no two can.
>
> The stamp records the grid THIS BUILD writes in. That is true whether or not a rescale happened, so it is written on every load: the "no stamp" state has to mean "a browser from before the stamp existed" and nothing else.

### 3. `repairOverscaledBoard()` — every load, added 2026-09-14

Two independent triggers: `offGrid = right > BOARD_COLS`, or unanimous catalog evidence from `catalogOverscale()`:

> Each card has a `defaultSize`, and a card the user has never resized still holds exactly that size times whatever scale was wrongly applied. So if EVERY card on the board is the same clean power-of-two multiple (>= 2x) of its own catalog default, that multiple IS the scale, and dividing by it restores the board exactly rather than approximately.
>
> Every card, not most: one resized card makes the ratios noise, and a wrong guess here is the bug rather than the fix.

The 2026-09-14 addition covers the board that still fits:

> a board doubled in BOTH dimensions that still fits across. That is a reachable state, not a hypothesis. `repairHalfSizeBoard()` doubles w AND h on any board whose right edge lands between `BOARD_COLS/4` and `BOARD_COLS/2` — a perfectly current board with a few cards on the left half matches that description. After the doubling its right edge is between `BOARD_COLS/2` and `BOARD_COLS`, so it FITS, so the trigger below never fires; and because that repair is behind a one-shot key it never runs again either. Every card is twice as wide and twice as tall, permanently. A 19-row card becomes 38 rows — 304px of chart becomes 608px, and one card fills the screen.

On why "halve until it fits" under-corrects: *"A board quadrupled from cards spanning only half the grid comes back at right = 96; one halving puts it at 48 and the loop stops, leaving every card twice the size it should be — on the grid, adjustable, and still wrong."* The false positive is acknowledged: *"A user who deliberately set EVERY card to exactly 2x its default… is one drag from undoing it — as against a board that cannot be read at all."*

### 4. `repairHalfSizeBoard()` — once per browser, behind `cb-v3-board-grid-repair`

For browsers the old migration already broke: *"they carry a stamp saying 48 over a blob still in 24 units, so SCALE is 1 and the migration correctly declines to run. Their board stays at half size forever."* The trigger is a **band**:

```ts
if (right > BOARD_COLS / 2) return   // already current units
if (right <= BOARD_COLS / 4) return  // a small board, not an old one
rescaleStored(LAYOUT_KEY, 2); localStorage.removeItem(SYNCED_KEY)
```

> The heuristic that was rejected earlier — "it fits in the left half, so it must be old" — is exactly this one. What made it unsafe was running it on every load, where a genuine left-half board would be doubled again and again. Behind a one-shot key it runs once in a browser's life.

And the 2026-09-08 correction to its own note: *"It doubles `h` as well — which is CORRECT for a genuinely old board, because the row unit halved at the same time the column unit did (32px -> 16 -> 8) — so a false positive does not get a wider board, it gets a board twice as tall… That is the same symptom as the bug above, and it is not 'still a board'."* Hence the lower bound.

`serverToCurrentGrid(i)` is the read-time scale for the **server copy only**: *"Local blobs were rewritten on disk above, so scaling them again here would double-apply."*

---

## Edit / lock / free mode

**Lock** (`useState(true)`) — the board opens **locked**: no drag listeners, no resize grips, no ✕, `touchAction: undefined`. *"locked=true renders statically: no handles, no listeners."* The button reads **Edit layout** / **Done**.

**Free placement** — key `cb-v3-board-free`, and it is **opt-out**: `localStorage.getItem(FREE_KEY) !== '0'`, with `true` on throw.

> DEFAULT ON — the key is opt-OUT ('0'), not opt-in. "The card goes where I put it" is what dragging is supposed to mean, and shipping that behind a switch meant the board still fought the first person who tried to move a card and never told them there was another mode.

It is a preference, not part of the layout: *"the wire contract for `dashboard_layouts` is an array of {id,x,y,w,h} that this file does not get to extend. Per browser, like the rest of the v3 card settings."*

Flipping it turns gravity off with no visible change, and turning it **off** compacts immediately — *"because a board that tidies itself on a gesture the user has not made yet reads as a glitch."*

### The `arrange()` funnel

```ts
const arrange = useCallback(
  (items, tidy = true) => (free ? (tidy ? settleBoard(items) : resolveBoard(items)) : compactBoard(items)),
  [free],
)
```

> Every path that changes the layout outside a gesture — add, remove, adopting the server copy — goes through it, so none of them can quietly re-compact a free board.
>
> `tidy` says whether the dead space gets closed as well… ON for the user's own edits — adding or removing a card is a change to the arrangement and the board should come back looking finished. OFF when merely LOADING a saved board: opening the page is not an edit, and a layout that quietly rewrites itself on open would show "Unsaved layout" for a change the user never made.

`arrangeRef` keeps the server-load effect off the mode: *"flipping free placement does not re-run the fetch and hand the board back whatever the server holds mid-edit."*

### The two engines

**`compactBoard(items, pinnedId?)`** — gravity. Lane-snap first (*"gravity only ever changes y, so a card that arrives off-lane… would stay off-lane forever"*), order by `y` then `x` with the pinned card first, float each up while clear, then push down past what it hits.

**`resolveBoard(items, pinnedId?, cols)`** — gravity removed, nothing else changed:

> "I can't move the chart to fill that space without kicking off the heatmap." That is gravity, not collision. compactBoard floats EVERY card up to the first free row on every gesture, so the board has no such thing as an empty row… Nothing is wrong with the arithmetic — the board is simply doing a thing the user did not ask for.
>
> It is a separate function rather than a `gravity` flag inside compactBoard on purpose: compactBoard is called from layoutStore's sanitizer and from every add/remove path, and a boolean that silently changes what those do is exactly how a saved free layout comes back compacted.

Its collision answer is `squeezeAside(it, placed) ?? stepAside(it, placed, cols)` — **squeeze first, move second**.

**`squeezeAside`** — from the complaint *"When moving the bottom GEX Candles into the empty space, I want the ones around it to get smaller to fit it in. Instead the things on the right go down a row. I don't want that."*

> Every version of this board so far has had exactly one answer to a collision: somebody MOVES. That is the wrong first answer… eviction is destructive in a way shrinking is not, because the evicted card leaves the screen area you were looking at and takes its row with it. Shrinking costs a neighbour some width. Moving costs you your layout.

Four candidates (trim right, push left edge in, trim bottom, push top down), cheapest first, always keeping the opposite edge nailed down — *"neither reads as the card moving, because the edge you were not pushing on does not move."* Two floors: `floorW = max(BOARD_MIN_W, floor(w/2))`, `floorH = max(BOARD_MIN_H, floor(h/2))` — *"Past that it is not making room, it is being crushed, and being sent to the next row is the kinder outcome. This is the line between 'the ones around it get smaller' and 'the ones around it get destroyed'."* Returns `null` when no legal squeeze exists.

**`stepAside`** — offers, for every placed card, four positions (below/right/left/above), keeps the on-board collision-free ones, takes the shortest Manhattan move. *"A search, not a loop, and that is the point. The obvious version — 'push, then look again, then push again' — ping-pongs: pushed left out of A it lands in B, pushed right out of B it lands back in A, and after the guard trips it gets dumped at the bottom anyway, which is the behaviour this was meant to remove."* The below-everything fallback *"is reached only when the board genuinely has no room in any row the card overlaps — a very wide card in a full band. It always terminates."*

Both are then lane-snapped again: *"Both are useful and neither respects the one/two/three rule."*

**`fillGaps` / `settleBoard`** — from *"Let it be free will on where the edges go, but try to limit the empty space. Those pull against each other and both are right."* The tidying is decoupled from the placing: *"You choose the edges; on release each card reaches into the dead space immediately beside and below it and takes it. Nothing moves — only widths and heights change."*

- **`maxGap` = `Math.max(2, Math.round(cols / 4))` = 12 units.** *"Unbounded, every card would stretch to the far side of the board and the board would be a stretch of cards. At a quarter of the width it swallows slivers, margins and the hole a removed card leaves, and it leaves a DELIBERATE hole alone. That is the 'best guess': a small space beside a card was an accident, a large one was a decision."*
- **Left and up are not filled**, except the board's own left edge and (width only) its right: *"A gap on a card's left is the same gap as the one on its neighbour's right, and both cards growing into it is how you get a fight."*
- **Interior gaps close completely and are shared** — left card grows right, right card grows *left*, splitting `floor(gap/2)`. *"Splitting is what makes the squeeze reversible. Drag a card out from between two neighbours it had squeezed and they take back what they gave up, evenly, instead of the left one swallowing the whole hole."* Edge gaps stay bounded by `maxGap` because *"space at the end of a row can be deliberate."*
- **The pinned card is frozen — position AND size.** *"Position was always exempt. SIZE was not, and that was a bug you could not work around: 'the gauge card I want to make smaller but not able to'. Drag its bottom edge up, and the shrink opens a gap between it and the card below — which is a gap adjacent to the card, which is precisely what this function closes, so it grew straight back to the size it started at. The board silently undid the only thing the gesture was for. A resize is the user stating a size. Nothing here gets to overrule it."*
- **Run to a fixed point**, ≤4 passes, bailing on `JSON.stringify` equality: *"Repeating until nothing changes makes settling IDEMPOTENT: settle(settle(x)) === settle(x), which is the property that makes it safe to run on every release. It converges in one or two passes; the cap is a bound, not a plan."*

`settleBoard = snapBoard(fillGaps(resolveBoard(…)), …)` — *"the lane snap has the last word here too."*

**`joinRow` / `spreadRow`** — from *"If it's 1 and 1 and I try to move the card beside the upper one, it should force it to 2 per row."*

> the row a card is dropped into is re-split among everyone now in it, and the row it LEFT is re-split among whoever is still there. Drag the second card up and both become halves; drag it away again and the first goes back to full width. The two directions are the same function, which is why neither can drift out of step with the other.

Capped at three. `joinRow` takes the drag's **unclamped** `dropX` because *"a full-width card cannot be moved right (there is nowhere for its right edge to go), so its own x cannot say which side of the row it wants and the pointer has to. Ties go left."* The release also enforces *"ALONE ON A ROW IS FULL WIDTH"*, but only when the card's band touches nothing — *"a card dropped alongside a neighbour whose row top does not match exactly must not balloon over it."*

### The gesture loop

- Drag starts from `data-board-handle` — `BoardPage` puts it on the `<span>` inside the `Card`'s `title`, so the whole title bar is the handle. Anything inside `a, button, input, select, textarea` is excluded, so a header control never starts a drag.
- Resize starts from the grip `Board` renders bottom-right: `h-4 w-4`, `cursor-nwse-resize`, a 135° `linear-gradient` in `var(--color-accent)` at 0.6 opacity, `title="Drag to resize"`.
- Quantisation: `dxCols = round((clientX - startX) / colW)`, `dyRows = round((clientY - startY) / (rowH + gutter))`.
- **Position never snaps.** *"A magnet that pulled a dragged card onto its neighbours' edges was tried and removed: at this grid resolution the card can already be put within ~2% of the board of wherever the pointer is, so the magnet was not closing a gap you could not close yourself — it was overriding a placement you had just made. Closing the leftover happens on RELEASE, where it cannot fight the hand."*
- **Size snaps to a neighbour's exact size** within `MATCH_SNAP = 2` units — from *"Two GEX Candles side by side should be the same size, and I can't make them the same size with edit layout."* A neighbour is a card whose **row band** overlaps, *"not every card on the board… snapping to it would make every size on a busy board sticky for no reason."* Today it applies to **height only**: *"Width is a lane, so the drag picks the nearest lane rather than a column… two cards in a row are the same width by construction now."*
- **Three refs carry the raw gesture:** `rawRef` (everyone at pointer-down plus the dragged card where the pointer is, nothing settled), `dropXRef`, `fromYRef`. The release maths runs on `rawRef`, not the draft: *"The draft has already had the collision rules applied to it, which is what pushes the card you are dragging TOWARD out of your way — so by the time you let go, the row you were aiming at is not in the draft any more and joinRow would find nothing to join. Settling is a view of the gesture, not the gesture."*
- **The release maths runs every frame during a move and IS the draft.** From *"When I place it to the right of 2 cards, those should move left and show the ability to put in the 3rd."* — *"The two halves narrow to thirds and slide left as you come over the row, the empty third opens on the right, and letting go changes nothing that was not already on screen."* The card in the hand keeps the pointer's position but takes the width it is about to land at.
- On release: `onLayoutChange(release(raw, gesture))`. Auto-arrange commits with a **second** compaction — *"the first one holds the pinned card, the second lets it float like everything else."* Free mode instead closes dead space, **on release only**: *"cards resizing themselves under a moving pointer is the board arguing with the hand, which is the thing all of this exists to stop."*
- **Only a MOVE re-splits rows.** *"A resize is the user stating a width, and a rule that immediately restated it would make the gesture pointless."*

### The landing slot and the guides

**Landing slot** — drawn only when the preview differs from the pinned box in `x`, `y`, `w` **or** `h` (*"a card about to become a half is not in its landing slot just because the slot starts at the same corner"*). `2px dashed color-mix(in srgb, var(--color-accent) 55%, transparent)` over `color-mix(… 7%, transparent)`, `rounded-md`, `zIndex: 0`, 90ms eased. *"Drawn UNDER the tiles (z-0) so it reads as a hole in the board the card is about to drop into, not as a second card."* It is computed by the same `release()` the drop runs, so *"the outline cannot disagree with where the card lands, because it is computed by the code that lands it."* In free mode it is usually absent, *"correctly, since there is no jump to warn about"* — but it does draw when the drop joins a row.

**Guides** — only while `!locked && gesture && colW > 0`. *"A grid drawn the whole time is wallpaper; a grid that appears under the hand is a ruler."* Three `repeating-linear-gradient`s: thirds at 14% accent, halves at 10%, and — free mode only — rows at 9% every `rowH + gutter` px. *"The lanes, not the 48 raw columns: a hairline every column was a ruler for a grid you could land anywhere on."* Row guides are free-only because *"Under gravity the row a card is dropped on is a suggestion — it floats — so drawing rows would be a lie."*

**The lifted card** — `opacity: 0.92`, `filter: drop-shadow(0 8px 18px color-mix(in srgb, var(--color-app) 65%, transparent))`, `zIndex: 50`, `transition: none`. Non-dragging tiles transition `left/top/width/height 120ms ease`.

---

## Adding and removing cards

**`+ Add card`** → `setLayoutState((prev) => arrange([...prev, placeNewCard(id, prev)]))`. The menu lists **every** catalog entry every time, with a `×N` count: *"nothing is removed from this list once it is on the board. The count on the right is what says 'you already have one of these', which is information; a missing row was only ever a refusal."* Titles: `Add another <label> — <n> on the board`, else `Add <label>`. Closed by an outside `pointerdown` on a `window` listener.

`AGENTS.md`: *"`src/board/catalog.tsx` — one entry in `CARD_CATALOG`, and the '+ Add card' dropdown, `BoardPage` and `Board` all pick it up."* Then: *"Anything that paints must go through `ChartFrame` and honour ONE of its visibility signals (non-negotiable 5), and tag its canvas `data-cb-layer` (non-negotiable 6). Run `npm run perf`."*

**Remove (✕)** → `arrange(prev.filter(i => i.id !== id))`. *"In free mode a removal leaves a HOLE rather than pulling the board up. That is the mode's whole promise: the cards the user did not touch do not move."* Because `tidy` defaults true, the neighbours still absorb adjacent slack within `maxGap` — `settleBoard`'s docblock: *"a card removed from the middle of a board should leave its neighbours a little wider, not a hole."* The ✕ draws only when `!locked`, as the `Card`'s `actions`, `text-xs text-faint hover:text-down`, `title="Remove card"`.

**Clear all** — armed, `ARM_MS = 4000`. First click → the label becomes **`Clear all?`** with `border-down bg-raised text-down`; a second within 4s empties the board. Disarmed on `onBlur`, on leaving edit mode, and on unmount.

> Removing cards one ✕ at a time… is the wrong shape of work for "I don't want any of this" — the board a user most wants to abandon is the one with the most cards on it. It is also the escape hatch when a board has ended up in a state they cannot drag their way out of, which is exactly what the grid-scale bug produced.
>
> It empties the board; it does NOT reset to the starter three. "Clear" that silently leaves three cards behind is not clear, and + Add card is right there.
>
> Deliberately LOCAL only… clearing is undoable by reloading the page, and permanent only when they say so. ARMED, not dialogged… A modal for a reversible local action is more ceremony than the action deserves, and a bare one-click wipe of a board someone spent time on is not defensible.

It bypasses `arrange()` — *"running the empty array through compactBoard/settleBoard would only be ceremony."*

**The starter board** — `DEFAULT_IDS = ['gex-candles', 'key-levels', 'quick-links']`, placed one at a time through `placeNewCard` then `compactBoard` (not `arrange`). Used only when `readLocalLayout()` returns `null`, i.e. no key at all.

---

## The layout library (named presets)

> One board was never enough: a pre-market board, a 0DTE board, a board for reviewing the day.

**Storage split:** *"For everyone: the BROWSER… For the OWNER, additionally: POSTGRES, through the same `/api/dashboard-layout` route the single-board save already uses. That route has always been able to hold up to 12 NAMED templates per page… v3's home board simply only ever wrote one of them, `Default`. Nothing on the server changes for this; the client stopped pretending the table had one row."*

> The two are not a sync engine. Local is written first and is what the board reads on open, so a failed or slow request never costs the owner a save; the account's copy is merged OVER the local one when it arrives.

**Loading a preset is an edit:** *"`cb-v3-board-layout` (the working board) and the account's `Default` template are untouched by any of this… Loading a preset is an EDIT — it replaces the working board, autosaves locally like any other gesture, and leaves the header saying 'Unsaved layout' until Save layout is pressed. A preset the user merely looked at is not a board they committed to."*

**Names:** `cleanPresetName` is `String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)` — *"The server's cleanLayoutName, reproduced exactly. A name that round-trips differently locally and remotely would give the owner two rows for one layout, one of which they can never overwrite."* Matching is case-**insensitive**: *"'Premarket' and 'premarket' cannot both exist — two rows a user reads as one name is how you lose a layout you thought you overwrote. The name the user just typed wins, so re-saving can also fix its casing."* Sorted alphabetically, case-insensitively — *"the list is read, not scrolled by recency."* Capped at 12 on write, upsert and merge.

**`mergePresets(local, server)`:** *"The SERVER wins a name collision: it is the copy that has seen every machine… Names only in the browser are KEPT rather than dropped. A local-only preset is either one saved before the account answered or one from a machine that never pushed; discarding it on the strength of 'the server did not mention it' would delete layouts the user can see."*

| Action | Local | Server | Error surface |
|---|---|---|---|
| **Save** | `upsertPreset` + `writePresets` + `writeActivePreset` + flash | owner only: `saveServerLayout(snapshot, name, false)` | `Account copy failed — <message>` |
| **Load** | `arrangeRef.current(p.layout, false)`, sets active name, closes menu | none | none |
| **Delete** | `removePreset` + `writePresets`; clears the active name if it matched | owner only: `deleteServerLayout(name)` | `Account copy failed — <message>` |

`makeDefault: false` on a named save because *"adding 'Premarket' to the library must not change which board the next machine opens with. That is what Save layout is for."* Delete has **no arming click**: *"this removes a SAVED COPY and leaves the board on screen untouched, so the worst case is re-saving a layout that is still right there."* The owner's library fetch fails **silently**: *"the local library is already on screen and is the one the board reads… It is the save that reports, because that is the one they are waiting on."* `readPresets()` reconciles each stored layout against the current catalog — *"a preset saved before a card was retired is still a usable board without it"* — and keeps an empty preset.

---

## The toolbar slot

The page draws **no header row**: *"This page used to open with a header row: the word 'Terminal' on the left and the board's controls on the right, a whole band of chrome under a toolbar that was mostly empty. The word is gone — the home page does not need to announce itself to the person who navigated to it — and the controls moved UP into the toolbar through ToolbarSlot, which is a portal, so they are still owned by this component and still hold the board's state."*

Three pieces: **`ToolbarSlotProvider`** (in `Shell`, above both the toolbar and the page; holds the host in **state, not a ref** — *"the page renders `null` until the host exists, and it has to be told when it does. The extra render happens once, at mount"*); **`ToolbarSlotHost`** (rendered once by `Toolbar`, between `BotAlertButton` and the SPX chip, default class `flex items-center gap-2`); **`ToolbarSlot`** (`createPortal(children, el)`).

> The board's edit mode, its dirty flag and its add-card menu stay inside BoardPage where the layout lives; the toolbar never learns what a card is. Any page can use the slot and nothing has to be registered for it.
>
> "ONLY ON THE HOME PAGE" needs no condition anywhere: the slot draws whatever the MOUNTED route puts into it, and every other route puts nothing. Delete a page and its toolbar controls leave with it.
>
> One slot, one filler. Two pages mounted at once would fight over it — v3 mounts exactly one route at a time, and that is the assumption here.

### What `/board` puts in it, left to right

| Control | Shown when | Notes |
|---|---|---|
| status text | `status != null` | one line, priority-ordered (below) |
| **Free placement** / **Auto-arrange** | `!locked` | label *is* the mode. `border-accent bg-raised text-fg` when free |
| **Save layout** | `!locked` | disabled unless `isSignedIn && remote !== 'saving' && dirty` |
| **Clear all** / **Clear all?** | `!locked && layout.length > 0` | armed state goes `text-down` |
| **Layouts** / **Layouts · `<name>`** | always | `max-w-[14rem] truncate`; opens a `w-72` dropdown |
| **Edit layout** / **Done** | always | `bg-raised text-fg` while editing |
| **+ Add card** | always | `bg-accent text-bg`; opens a `w-60` dropdown |

Save layout's title explains *why* it is disabled, four ways: `Checking your account…` (`!isLoaded`) / `Sign in to save this layout to your account` / `This layout is already saved to your account` / `Save this layout to your account, for every browser you sign in on`. The placement toggle's titles: `Free placement — cards stay where you drop them and gaps are kept. Click for auto-arrange.` and `Auto-arrange — cards float up to close gaps. Click for free placement.`

**Layouts** is deliberately outside edit mode: *"Those are counterparts to gestures; LOADING a saved board is not an edit the user is in the middle of making, it is how they get to the board they want — and making them press 'Edit layout' first to reach it would be ceremony in front of the common case. The button wears the loaded layout's name, so the board on screen can always say which one it is."*

---

## The expand stage

`ExpandStageHost` wraps the page column in `Shell.tsx`, under a warning that has been earned:

> ── ExpandStageHost — DO NOT DROP THIS WRAPPER ── It is what makes every Card's expand control exist: outside a stage the context is null and Card draws no button at all, so removing this line does not break loudly, it silently deletes the feature from the whole app. (It has been lost to a Shell rewrite once already — 2026-09-03.)

**What the stage is:** *"NOT the browser's Fullscreen API and not `position: fixed` over the viewport: both of those take the RAIL and the TOOLBAR with them, and those two are how you leave the card you just expanded. A chart you cannot navigate away from without pressing Escape first is a worse chart. So the stage is an `absolute inset-0` layer inside the PAGE COLUMN… the rail stays clickable, the toolbar keeps its ticker and clock, and the replay dock (which is a later sibling, in flow) still holds the bottom edge."*

**Why a portal:** *"A board tile is absolutely positioned inside a 12-column grid whose parent clips it. Nothing a tile's own child can set gets it out of that box — and re-mounting the card at the top level instead would throw away everything it holds: the chart instance, the fetched chain, the scroll position, the replay cursor."* (That comment still says "12-column"; the grid is 48. The mechanism is unchanged.)

The stage element is **always rendered** so its ref is committed before anything portals in — *"a stage that mounted with the first expand would paint the card in its tile for one frame first"* — carries `data-cb-stage`, and is `absolute inset-0 z-40 flex min-h-0 flex-col overflow-hidden bg-bg p-2` when active, `hidden` when idle. One card at a time. **Escape** closes, bound on `window` *"because the focus may well be inside a chart canvas that never took it."*

`BoardPage` passes `expandId={id}` — the **instance** id — *"so the expand state survives a re-render mid gesture and so a shot target can find the card while it is expanded and living outside its tile."* The tile stays: *"The tile it came from keeps its place in the grid and is simply empty for the duration, so collapsing puts the card back exactly where it was."* `Card` registers a cleanup collapsing its own key, because *"A card that unmounts while expanded — removed from the board, or navigated away from — must not leave the stage holding a key nothing will ever render."*

Button: `⤢` / `⤡`, `text-xs text-faint`, `aria-pressed`, titles `Fill the page with this card — the rail and toolbar stay put` / `Back to the board (Esc)`.

### The `Card` header it shares

> ── THE HEADER IS EXACTLY ONE ROW, ALWAYS ── It used to be `flex-wrap`, which meant a card narrower than its own controls grew a SECOND header row. The chart below lost 30px, the card's proportions changed with its width, and two cards of the same size could hold different amounts of chart depending on how many buttons their body happened to register. A control bar that changes the geometry of the thing it sits on is worse than one you have to scroll.

`h-8` (32px), `nowrap`, and the body's toolbar scrolls sideways via `.cb-bar` (`overflow-x: auto`, `scrollbar-width: none`, `overscroll-behavior-x: contain`) — *"a visible bar would eat a quarter of a 32px header."* The title is `min-w-0 shrink truncate` so *"the NAME gives way first: it is repeated in the copy-shot menu and in the card body, and the controls are repeated nowhere."*

`CardToolbar` is a portal into that header rather than a `toolbar` prop on `CardDef`, because *"the cards that have controls are the lazy() ones: the catalog cannot hand BoardPage a toolbar out of a module it has not imported yet… a portal moves the DOM, not the React tree."* It distinguishes "not inside a Card at all" (context `null` → draw inline) from "inside a Card whose header has not committed yet" (host `null` → draw nothing): *"telling them apart is what stops the toolbar painting one frame inline before it jumps into the header."*

### `CardDef.Title`

```ts
Title?: ComponentType
```

> A COMPONENT, never a render function: it holds hooks of its own, and a function called inline from BoardPage's render would make them BoardPage's hooks — conditionally, which is the rules-of-hooks violation that only shows up when a card is added or removed.

Only `key-levels` has one. It falls back to the plain label while its chunk loads — *"the header is the only thing on a card that is readable before the body arrives, and a title that appears a beat after the card does is the board looking broken for a beat."* The heading it builds (`CardHeading`, `src/board/cardTitle.tsx`) is `AMZN - Key Levels - 8-31-26`: *"Three parts and a fixed order: the symbol the board is on, what the card is, and the expiration the numbers were computed from. The date is the part that earns this file — a levels board with no expiry on it is a board you cannot check against a chain, and 'which expiry is this' is the first question asked of every gamma number in the product."* `fmtContractDate('2026-08-31')` → `8-31-26`; a non-ISO string passes through *"rather than reformatted into a guess."*

---

## CopyShot targets

`useCopyShotTargets(shotTargets)` publishes the whole board to the toolbar camera in one memo.

> Registered from HERE rather than card by card, and that is the whole point: a card does not have to know the feature exists to be photographable. The board already knows every card's name, its copy number and where its tile is in the DOM — `data-card-id`, which Board.tsx puts on each tile for the perf check — so one publisher covers the catalog, including cards added after this was written.

| Target | `id` | `label` | `group` | `file` | `icon` |
|---|---|---|---|---|---|
| Whole board | `board:all` | `Whole board` | `Home board` | `board` | 🗂️ |
| Each card | `board:<instanceId>` | `<card label>[ <n>]` | `Home board` | `<instanceId>` | `CardDef.icon` |

Cards are sorted into **reading order** (`a.y - b.y || a.x - b.x`) — *"Reading order, not layout order, so the menu matches the eye."* The ordinal appears only when `countByType > 1`.

```ts
resolve: () =>
  boardRef.current?.querySelector(`[data-card-id="${CSS.escape(it.id)}"] section`) ??
  document.querySelector(`[data-cb-stage] section[data-card-instance="${CSS.escape(it.id)}"]`) ?? null
```

Three deliberate details: **the `<section>`, not the tile wrapper** (*"the tile wrapper also carries the resize grab-handle, which is chrome and does not belong in a shot"*); **tile first, stage second** (*"An EXPANDED card is not in its tile… the shot you get is the card at the size you are looking at it, which is the one you wanted a picture of"*); **resolved at click time** (*"a board card is re-created on every drag and a popped-out overlay is portalled in and out, so a ref captured at publish time is stale about as often as it is right"*).

`board:all` resolves to `boardRef.current?.firstElementChild` — the grid, not the scroll port: *"the board is taller than the window as often as not, and a shot of the scroll port is a shot of the part that happened to be showing. Cards below the fold have not painted (non-negotiable 5), so their charts come out blank; that is the visibility gate doing its job, not the capture failing."*

Registry rules that bite: `GROUP_ORDER = ['This page', 'Home board']`, so board rows sort after page-scoped rows; target ids double as saved-order keys and *"have to be stable across sessions — `board:gex-chart#2`, not an index"*; and *"MEMOISE THE ARRAY. The list identity is the effect's dependency; a fresh array literal every render republishes on every render."* The camera is owner-gated chrome only — *"the capture runs entirely in the browser against pixels the viewer can already see, so there is nothing here for a gate to protect. It is hidden because it is a tool for one person."*

---

## The data path

The page makes exactly three kinds of call, all raw `fetch` to `/api/dashboard-layout`:

| Call | Trigger | Abort | Poll | Failure |
|---|---|---|---|---|
| `GET …?page=v3-home` (the account board) | effect on `[isSignedIn, boot]` | `AbortController` + an `alive` flag; `AbortError` swallowed | none | `setRemote('error')` + `remoteErr` → status line |
| `GET …` (owner library) | effect on `[isOwner]` | same | none | **silent** |
| `POST …` | Save layout / Save preset / Delete preset | none | — | status line / `presetErr` |

Auth is `useAuth()` (`src/data/auth.tsx`): one `GET /api/auth/me` for the whole session, shape `{ user: { id, email, isOwner, isPaid } | null }`, with `isLoaded` *"false until `/api/auth/me` answers. Tells 'not the owner' from 'don't know yet'."* Everything else on screen is a card's own data path — twelve of them. The socket is opened by `index.html` before the bundle and adopted by `src/data/socket.ts`; scoping is derived from what the store is subscribed to and applied `SETTLE_MS = 1200`ms after the first route settles (non-negotiable 2: *"Pages never touch the socket… scoping is derived from what is actually subscribed"*).

**Prefetch in `NAV`: there is none, because `/board` is not in `NAV` at all.** The rail holds `/`, `/single`, `/traders-dashboard`, `/premarket`, `/whales`, `/options-chain`, `/chain`, `/em`, `/economic-calendar`, `/analytics`, `/replay`, `/flow`, `/scanner`, `/level-log`, `/seasonality`, `/legacy`. You reach the grid board from the home page's `PAGES` list (`🧩 The grid board`), a bookmark, or `MOBILE_TO_DESKTOP['/m/gex'] = '/board'`. A knock-on: `labelFor()` in `src/data/pageVisit.ts` cannot find it, so the visit beacon logs the bare path `/board`.

**No waterfall** (non-negotiable 3): the two GETs are independent and fire from two effects; each card fires its own at entry.

---

## Rendering

```tsx
<Page fill>
  <ToolbarSlot>…every control…</ToolbarSlot>
  <div ref={boardRef} className="min-h-0 flex-1 overflow-y-auto">
    {layout.length === 0 && <div className="px-4 py-10 text-center text-sm text-faint">…</div>}
    <Board layout={layout} onLayoutChange={setLayoutState} locked={locked} free={free} render={…} />
  </div>
</Page>
```

`<Page fill>` is `flex min-h-0 flex-1 flex-col overflow-hidden` — *"true = the page owns the viewport and does not scroll (chart pages)"*. The scroll port is `boardRef`'s div, **vertical only**, which is the premise `fitToGrid` is built on. The empty-board line sits **outside** `<Board>` *"so it cannot be mistaken for a tile or become a drop target."*

Each tile's inner wrapper is `relative flex h-full w-full flex-col overflow-hidden`, and the reason is spelled out: *"Must be a flex column, not just a sized box: Card (and every card body under it) fills its space via `flex-1`/`min-h-0`, which only takes effect inside a flex parent. Without `flex flex-col` here, Card has no layout instruction to obey and shrinks to its header's content height instead of the pixel height this tile was just given — the card LOOKS unsized even though `box.height` above is correct."*

### Colours, as tokens (hex from `tokens.css`)

| Utility / value | Token | Hex |
|---|---|---|
| `bg-surface` (buttons, dropdowns, card plate) | `--color-surface` | `#0e1216` |
| `bg-raised` (active, hover) | `--color-raised` | `color-mix(in srgb, #141a21 92%, #e7ece9)` |
| `bg-bg` (expand stage fill, toolbar band) | `--color-bg` | `#0a0d10` |
| `border-line` | `--color-line` | `#1e2630` |
| `bg-accent` / `border-accent` / `var(--color-accent)` (+ Add card, guides, landing slot, resize grip, focus) | `--color-accent` | `#2f6bff` |
| `text-bg` (ink on the accent button) | `--color-bg` | `#0a0d10` |
| `text-fg` | `--color-fg` | `#e7ece9` |
| `text-muted` | `--color-muted` | `#e7ece9` |
| `text-faint` (ordinal, ✕, counts, empty line) | `--color-faint` | `#c0c5c3` |
| `text-down` / `border-down` (armed Clear all, error status, ✕ hover) | `--color-down` | `#ff6b7a` |
| `var(--color-app)` (drag shadow) | `--color-app` | `#0a0d10` |
| `rounded-sm` / `rounded-md` | `--radius-sm` / `--radius-md` | 6px / 10px |

Non-negotiable 1 is fully honoured: `Board.tsx` says *"No colour literals here — every visual comes from the caller's own Card/tokens; this file only computes geometry"*, and `theme-baseline.json` lists none of this page's files, so all sit at zero and, per that file, *"a file at zero is removed and can never regress."*

Type sizes, all off the scale: `text-3xs` 9 / `text-2xs` 10 (preset counts, the error line, the library footnote) / `text-xs` 11 (every toolbar button, the ✕, the count badge, the status line) / `text-sm` 13 (card titles, preset rows, the empty-board line).

### Per-frame / perf machinery

One `ResizeObserver` per `Board` watching the wrapper *and* its parent, every callback deferred through `requestAnimationFrame`. `useLayoutEffect(measure)` with no deps. Pointer listeners live on `window` and exist only while a gesture is live. Tile motion is CSS (`120ms ease`), disabled on the dragged card. The draft (`draft`) is React state during a gesture; `const active = draft ?? layout` is the one render path. **There is no `rAF` render loop** — the board never animates by script.

---

## Phone behaviour

`/board` **redirects a phone away**:

```ts
export const DESKTOP_TO_MOBILE = { '/board': '/m/gex', '/traders-dashboard': '/m/gex', '/em': '/m/em' }
```

*"The grid board keeps its redirect under its new path: a drag-and-drop grid really is unusable on a handset."* `MobileRedirect` is mounted once in `App.tsx`, above `Shell`, with `replace` *"so Back does not land on the route it just left"*; only mapped routes redirect, *"so the phone build can be opened on a laptop by typing the URL."* A long-press on a tab sets `cb-v3-force-desktop` in **sessionStorage** — *"an escape hatch for one look at the full board, not a setting"* — and brings you back here.

If you do arrive on a phone, `Board` calls `useIsPhone()` — `(max-width: 820px) AND ((pointer: coarse) OR (hover: none))`, as two `MediaQueryList`s rather than one string because *"boolean `or` inside a media query is Media Queries 4 and not old enough to rely on here, and it fails CLOSED — an unparseable query never matches, so the phone layout would simply never appear and nothing would say why"* — and takes a separate branch:

> The grid above is 12 columns of absolutely-positioned pixels. On a 390px screen a 4-column card is 97px wide, and there is no arrangement of twelve of those that is worth looking at — the board does not need to be responsive so much as it needs to STOP on a phone.
>
> So: the same cards, in reading order, full width, stacked. Drag and resize are not wired up at all — they are a pointer gesture the phone would have to steal from the chart's own pan, and a saved arrangement made by a thumb is one the desktop then has to live with.

```tsx
style={{ height: `min(${Math.max(280, it.h * (rowH + gutter) - gutter)}px, 78vh)` }}
```

Floor **280px**, cap **78vh**: *"floored at something a chart can actually be read in and capped at 78vh so one card never fills the screen with no hint that another follows. The cap is CSS `min()` rather than a measured innerHeight: the browser then re-evaluates it on rotation and on the URL bar collapsing, neither of which fires anything React would hear."* The phone tile still carries `data-card-id`: *"a phone layout that dropped it would make the card invisible to the perf budget rather than exempt from it."*

On `/m/*` there is no `ExpandStageHost`, so `Card` draws no expand button — *"That is the fallback, not an error: the phone build has no page column to expand into."*

### Scrolled out of view — non-negotiable 5

This is the page the rule was written for:

> A card nobody can see does not paint. `ChartFrame` reports its own visibility three ways — `handle.visible()` for a per-frame loop, `onVisibility` for an on-demand renderer, `data-visible` on the element. Use one. **The board is N cards on ONE main thread sharing ONE animation frame, and the cards below the fold are most of that budget if nothing stops them — nothing in the browser stops them for you.**

`ChartFrame.tsx` supplies the mechanism: an `IntersectionObserver` plus the tab's own `visibilitychange`, with `rootMargin` extending the viewport by **200px** — *"so a card is painted just before it is scrolled into view rather than a frame after. The gate exists to skip work nobody will see, not to save the last hundred pixels of scroll."* The premise: *"an offscreen `<canvas>` accepts draw calls exactly as fast as an onscreen one."* And the caveat: *"this frame does not (and cannot) stop a renderer painting. It only reports. A renderer that ignores all three signals is not gated, and `scripts/perf-check.mjs` is what says so out loud."*

The board's own contribution is `data-card-id` on every tile, desktop and phone, *"without it a paint is just 'something on the page drew', and a per-card redraw budget is not possible at all."* Non-negotiable 6 (`data-cb-layer` on every canvas) has no target in `Board.tsx`, which creates none.

Two board-specific consequences: a `board:all` CopyShot of a tall board comes out with blank charts below the fold (documented, and correct); and an expanded card is portaled out of its tile but the stage is `absolute inset-0` over the page column, so it is on screen by definition.

---

## Status and empty-state messages, verbatim

```ts
const status =
  remote === 'saving'  ? { text: 'Saving…', tone: 'muted' }
: remote === 'error'   ? { text: remoteErr ? `Save failed — ${remoteErr}` : 'Save failed', tone: 'down' }
: remote === 'loading' ? { text: 'Loading layout…', tone: 'faint' }
: (!locked && isSignedIn && dirty) ? { text: 'Unsaved layout', tone: 'muted' }
: flash ? { text: 'Saved', tone: 'faint' }
: null
```

> One status line, in priority order: what the network is doing, then what is outstanding, then the local-autosave flash. Never two at once — a header that says "Saved" and "Unsaved layout" side by side is worse than silent.

| Message | When | Tone → token |
|---|---|---|
| `Saving…` | a `saveServerLayout` is in flight | `text-muted` |
| `Save failed — <server message>` | POST rejected with a message | `text-down` `#ff6b7a` |
| `Save failed` | POST rejected with none | `text-down` |
| `Loading layout…` | the account GET is in flight | `text-faint` `#c0c5c3` |
| `Unsaved layout` | **in edit mode**, signed in, `!sameLayout(layout, synced)` | `text-muted` |
| `Saved` | 1200ms after any local autosave, or a successful account/preset save | `text-faint` |

`Unsaved layout` is gated on `!locked` because outside edit mode *"there is nothing the user could have changed"*, and on `isSignedIn` because a signed-out user has no account copy to be out of step with.

**Empty board** (`layout.length === 0`), `px-4 py-10 text-center text-sm text-faint`, with `+ Add card` in `text-muted`:

> Empty board — add a card from **+ Add card** to start building.

**Empty layout library:** `No saved layouts yet — name this board above and press Save.`
**Unnamed preset save:** `Name this layout first`
**Preset account write failure:** `Account copy failed — <message>`
**The library footnote**, which changes by account — *"Say where these actually went. The two tiers are invisible otherwise, and 'saved' meaning two different things to two people is exactly the kind of thing to state plainly"*:

> Saved to your account — on every browser you sign in on.  *(owner)*
> Saved in this browser.  *(everyone else)*

**Clear all, armed:** `Clear all?` — titles `Remove every card and start from an empty board. Your saved account layout is untouched until you press Save layout.` / `Click again to remove all <N> cards`.
**Preset rows:** `Load "<name>" — <N> card`/`cards`, `Delete "<name>"`, and the save button's `Replace "<name>" with the board on screen` / `Save the board on screen under this name`.
**Layouts button:** `Save this board under a name, or load one you saved earlier`.
**Resize grip:** `Drag to resize`.
**Quick Links' own empty state** (`catalog.tsx`): `No links yet — add one below.`

---

## Performance and bundle notes

**`Home.tsx` is the one statically-imported route.** `App.tsx`'s rule 1: *"Every route is lazy() EXCEPT the landing route. A route that is in the entry chunk is a route every user downloads whether they visit it or not."* `import Home from '@/pages/Home'` is the only static page import — a holdover from when `/board` was `/`. So the **entry chunk carries `BoardPage` → `layoutStore` → `catalog` → `Board` → `Card`** for everyone, including a visitor who only opens `/cards/quick-links`.

What it does *not* carry: the twelve card bodies.

> GEX Candles, Multi Greek, Key Levels, the Economic Calendar, the GEX Chart, Net Premium, Net Vol GEX Flow, the Flow Tape and the Gauge Rail are each a real feature with its own module tree — GEX Candles, Net Premium and Net Vol GEX Flow each pull lightweight-charts, the Flow Tape pulls the whole print table and its contract drawer. Static imports would put all of them in the board's route chunk and every user would pay for the cards they do not have on their board. lazy() means a card's code arrives when the card does.

Only `quick-links` is static: *"it is a few lines and a chunk boundary would cost more than it saves."* The `Deferred` fallback is a blank fill, not a spinner — *"the card frame is already drawn around it, and a spinner inside a frame reads as an error."*

**`budgets.json`** (brotli bytes): `entry 38900`, `react 55000`, `route 59100`, `data 78000`, `css 8500`, `html 2600`, `totalInitial 108400`, `ratchet { slack: 0.15, enforce: false }`. Because `Home`/`BoardPage` are static, this page's weight lands against **`entry`**, not `route`; each card's chunk is measured as a `route`-kind chunk of its own. Non-negotiable 7: *"Raise a number in `budgets.json` deliberately, in a diff someone can see — never work around it. When a chunk gets SMALLER, pull the number back down with `npm run budgets:ratchet`: a budget carrying 40% headroom has stopped enforcing anything."*

**The `perf` block is written about this page:**

```json
"perf": { "idleRepaintsPerFrame": 0.15, "offscreenRepaints": 0, "interactionRepaints": 10 }
```

> …counts REPAINTS PER ANIMATION FRAME on every canvas v3 owns (the ones tagged `data-cb-layer`), attributed per board card. `idleRepaintsPerFrame` is measured with the card on screen and nothing happening — not zero, because a live spot legitimately moves the price mapping and the pane autoscales with it. `offscreenRepaints` is a hard zero: a card scrolled out of view must not paint at all. `interactionRepaints` is the other half of the guard — a gate that suppressed everything would pass every other line here.

AGENTS.md: *"It adds every card in the catalog to a board and measures your new one automatically — there is no list to update. It is the only thing standing between the fifteenth card and a board that runs at 15fps for a reason nobody can point at."*

**Caveat for this repo:** `package.json`'s `build` is `tsc --noEmit && vite build`, and the voltick README states *"It deliberately does not run `check-theme.mjs` or `check-budgets.mjs`… a different palette can only fail those."* So the budgets above are inherited numbers enforced only by running `npm run budgets` by hand. `vite.config.ts` manual chunking stays minimal (*"Do NOT add vendor grouping 'for tidiness' — a shared vendor chunk means one dependency change invalidates the cache for all of them"*), and source maps are off (non-negotiable 8; `CB_SOURCEMAPS=1` for a local debug build).

---

## Gotchas

1. **`/board` is not in `NAV`.** No rail icon, no hover prefetch, and the visit beacon logs the bare path instead of a label. The only in-app doors are the home page's `PAGES` list, a bookmark, and the phone tab bar's "Desktop site" action from `/m/gex`.
2. **`Home.tsx` is still statically imported.** The landing-route exemption is spent on a page that is no longer the landing route, so the entry chunk carries the board's whole frame for everyone.
3. **The storage page key is `v3-home`, not `v3-board`.** Correct — renaming would orphan every saved layout — but grepping the server's `dashboard_layouts` for "board" finds nothing.
4. **Per-card settings are keyed by TYPE, not instance.** Stated as known: *"Two copies can be set differently for the session, but on reload both come back on whichever was written last. Fixing that means threading the instance id into every card's storage key, which is a change to every card and not to this file."* It is also why Save layout saves only the arrangement.
5. **A card opened at `/cards/<id>` shares instance #1's settings.** The gallery passes the bare catalog id to `render()`.
6. **Free mode is opt-out (`'0'`), not opt-in.** Any read other than the literal `'0'` — including a throw — means free. Do not "fix" it to `=== '1'`.
7. **`SCALE` is computed at module import, once.** Everything downstream of `storedGrid()` is frozen for the page's lifetime; a second tab running the repairs will not be noticed.
8. **Three of the four migration passes run on every load.** They are safe *"because a correct board never trips it"* — an argument about the current catalog's `defaultSize` values. **Change a card's `defaultSize` and you change what `catalogOverscale()` calls a clean multiple**: halving a default makes every existing board look uniformly 2× for that card.
9. **Every repair drops `cb-v3-board-synced`.** Deliberate — it forces the local board to win and makes the header honest — but a user who never presses Save layout afterwards is told their layout is unsaved forever.
10. **`repairOverscaledBoard` can fire on a deliberately 2×-scaled board.** Acknowledged in the source; the consolation (*"one drag from undoing it"*) holds only because `fitToGrid` guarantees the board stays reachable.
11. **The layout wire is `{id,x,y,w,h}` and `writeKey` enforces it.** Anything a card stashes on a `BoardItem` is stripped. Do not plan to extend it — the free-mode flag became a separate key for exactly this reason.
12. **`sameLayout` ignores array order.** A pure reorder is not dirty and not savable. Intentional (*"it has to answer about what the user can SEE"*), but surprising.
13. **The account board is fetched once and never polled.** No `pollMs`, no `staleMs`, and `refreshAll()` (the toolbar's `↻`) does not reach it. Change your board on another machine and this tab will not notice until `BoardPage` remounts.
14. **`setDefaultServerLayout` is exported and never called.** There is no UI for choosing which named template the account auto-loads; `fetchServerLayout` takes `isDefault` or the first row.
15. **Clear all is hard to undo.** The autosave writes `[]`, `readKey` honours `[]` as a real board, so a reload does *not* restore the starter three — and the account copy only comes back when `boot.local === boot.synced`, which the clear has just broken. Save a named preset before clearing.
16. **The library cap of 12 bites silently.** `writePresets` and `upsertPreset` both `.slice(0, MAX_PRESETS)` after sorting **alphabetically**, so overflowing drops whichever name sorts last, with no message.
17. **Preset names collide case-insensitively and the input does not say so.** Typing `premarket` over `Premarket` overwrites and re-cases it; the Save button's tooltip is the only warning.
18. **Only the owner's library reaches the account**, while Save layout works for any signed-in account. Two storage rules on one dropdown, disclosed only by the footnote.
19. **The `Expand.tsx` comment still says "12-column grid".** It is 48. Do not read it as evidence of the current constant.
20. **`ExpandStageHost` has been deleted by accident once (2026-09-03) and fails silently.** No stage → null context → no `⤢`. Nothing throws.
21. **The `⤢` button needs a header.** `canExpand = expandable && !!header && expandCtx != null`. A `Card` with neither `title` nor `actions` loses expand — and `CardToolbar` then falls back to drawing inline, since there is no header to portal into.
22. **`data-card-instance` is set only when `expandId` is passed.** CopyShot's stage fallback selector depends on it; `BoardPage` always supplies it, but a `Card` rendered elsewhere without one is unfindable while expanded.
23. **The drag handle excludes `a, button, input, select, textarea`.** A `CardToolbar` control built as a `<div role="button">` will start a drag instead of firing. Use a real `<button>`.
24. **`fillGaps` compares passes with `JSON.stringify`, so key order matters.** Items are cloned with `{...i}` today; a refactor that rebuilds them field-by-field in a different order would make the fixed-point test never converge and always run all four passes.
25. **Ordinals are positional, not parsed from `#n`.** A hand-edited blob with `gex-chart#2` and no `gex-chart` loads fine, shows a card labelled "1", and the next add takes the bare id.
26. **`defaultLayout()` uses `compactBoard`, not `arrange`.** A first-time user with free mode on (the default) still gets a compacted starter board. It is the one place the mode is not consulted.
