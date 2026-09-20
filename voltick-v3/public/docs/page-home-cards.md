# The home board — `/` (and `/cards`, `/cards/:cardId`)

**Route paths:** `/`, `/cards`, `/cards/:cardId` — three `<Route>` lines in
`src/App.tsx`, all three mounting the same component.
**What mounts it:** `const CardGallery = lazy(() => import('@/pages/CardGallery'))`
in `src/App.tsx`, rendered inside `<Shell>` → `<Suspense fallback={null}>`.
**Full URL in production:** `voltick.cbedge.net/v3/`, `…/v3/cards`,
`…/v3/cards/<card-id>` (Vite `base: '/v3/'`, router `basename="/v3"`).

**Sources this document is written from:**

| Path | Lines |
|---|---|
| `src/pages/CardGallery.tsx` | 315 |
| `src/board/catalog.tsx` | 444 |
| `src/design/primitives/Board.tsx` | 1149 (only `BOARD_ROW_H` is read here) |
| `src/App.tsx` | 249 |

Supporting files quoted where they bite: `src/shell/Shell.tsx` (739),
`src/design/primitives/Card.tsx` (238), `src/design/primitives/Expand.tsx` (106),
`src/design/tokens.css` (716), `src/mobile/mobileNav.ts` (141),
`src/data/pageVisit.ts` (253), `src/data/api.ts` (239), `AGENTS.md`, `README.md`,
`budgets.json`.

---

## What it is, in one paragraph

`/` is a showroom. It draws every entry in `CARD_CATALOG` as a tile — an emoji,
the card's label, one plain-English sentence about what the card does, and the
card's catalog id in mono at the bottom — followed by a second, plainer list of
the app's full pages. Click a tile and you land on `/cards/<id>`, where that one
card is rendered **for real**, at full page width, with live data, in a pane you
can drag taller by its bottom edge. It is explicitly *not* a rebuild of the
cards: the open card is produced by calling `CardDef.render()` from
`src/board/catalog.tsx`, which is the identical call the grid board at `/board`
makes, so "the real card, with its real controls and its real bugs" (the file's
own words). Adding a card to the catalog puts a tile here with **no edit to this
file at all**. The README states the product intent bluntly: *"Home is the
cards. `/v3` is every card in `src/board/catalog.tsx` as a tile. … `/v3/cards/multi-greek`
is a real link, so one card can be sent to someone."*

---

## File map

| File | Lines | What it owns |
|---|---|---|
| `src/pages/CardGallery.tsx` | 315 | The whole page. Router param read, tile grid, the `PAGES` link list, the one-card view, the resizable pane + its localStorage, the `Missing` state, and the `NOTES` descriptions. |
| `src/board/catalog.tsx` | 444 | `CARD_CATALOG` (the array the tiles are generated from), `CARD_BY_ID`, `CardDef` (incl. `icon`, `label`, `defaultSize`, `render`, optional `Title`), the `lazy()` wrappers + `Deferred` Suspense boundary, the static `QuickLinksCard`, `cardTypeOf` / `migrateCardId` / `newInstanceId` / `placeNewCard`. |
| `src/design/primitives/Board.tsx` | 1149 | Exports `BOARD_ROW_H = 8` (and `BOARD_COLS = 48`). This page imports **only** `BOARD_ROW_H`, to convert a card's `defaultSize.h` into pixels. None of the grid engine runs here. |
| `src/App.tsx` | 249 | The three route registrations, the `lazy()` chunk boundary, `NotFound`, `MobileRedirect`, `PageVisitBeacon`, and the header comment that explains why `/` is the cards and `/board` is the grid. |

### What is deliberately *not* in this page

- No fetch. No `useQuery`, no `query()`, no `preload()`.
- No socket subscription. `CardGallery.tsx` imports nothing from `src/data/`.
- No canvas. The page itself never calls `getContext`, so non-negotiable 6
  (`data-cb-layer`) has nothing to tag at this level.
- No `useCopyShotTargets`. The camera's menu is empty on this route unless an
  opened card registers a target itself; `BoardPage` is what publishes the
  `'Home board'` group, and `BoardPage` is not mounted here.
- No `ChartFrame`. Visibility gating is the *card's* job once it is open.

---

## The data path

**The page has none.** That is the whole shape of it, and it is worth stating
plainly because it is the reason this route is cheap: the tiles are rendered
from a static in-memory array (`CARD_CATALOG`), and `NOTES` and `PAGES` are
module-level object/array literals in `CardGallery.tsx`.

Everything with a network cost belongs to whatever card you open.

### Endpoints reached *because of* this page

| Source | URL | When | Cadence |
|---|---|---|---|
| `src/data/pageVisit.ts` → `PageVisitBeacon` in `App.tsx` | `POST /api/page-status` | On every route landing, including `/` and each `/cards/<id>` | Once per route, deferred to idle, deduped for `DEDUPE_MS = 1500` on the same path |
| `src/data/auth.tsx` → `AuthProvider` in `Shell` | `GET /api/auth/me` | Once per session, above the router | Once |
| `index.html` early boot + `src/data/socket.ts` | `wss://<host>/ws/gex` | Opened before the bundle is fetched | Persistent; scoping applied `SETTLE_MS = 1200`ms after the first route settles |
| Whatever card is open | its own | — | its own |

The visit beacon's payload for this route is
`{ pageKey: 'v3:/', pageLabel: 'Home', path: '/v3/', isLoaded: true, lastLoadedAt, isEntry, referrer, query }`.
`pageLabel` comes from `labelFor()`, which looks the route up in `NAV`
(`src/shell/Shell.tsx`) — `{ to: '/', label: 'Home', icon: '🏠' }` — so `/` logs
as **Home**. `/cards` and `/cards/:cardId` are in neither `NAV` nor
`MOBILE_TABS`, so `labelFor()` falls through to returning the path itself; the
log reads `/cards` and `/cards/multi-greek`. `pageVisit.ts` says of that
fallback: *"which is ugly in the log but never wrong."* Note that `path` is
`window.location.pathname` (so `/v3/cards/multi-greek`, with the basename), not
the router's stripped pathname, *"a row logged as `/traders-dashboard` is
indistinguishable from the v2 page of the same name, which is exactly the
confusion this whole beacon exists to end."*

### Prefetch wired in `src/shell/Shell.tsx` NAV

The rail's Home entry carries **no `prefetch`**:

```ts
export const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: '🏠' },
  // …
]
```

That is correct and not an omission: `prefetch` is described in `NavItem` as
*"URLs to start fetching when the user shows intent (hover/touch)"*, fired from
`onPointerEnter={() => item.prefetch?.forEach((u) => preload(u))}` in the rail.
There is nothing to warm for a page that fetches nothing. Contrast the entry
directly beneath it, `/single`, which prefetches
`/api/expirations?ticker=SPX` because that *is* the Voltmap's entry request.

There is no `prefetch` for `/cards/<id>` either, and no route-module `preload()`
at the top of `CardGallery.tsx`. Opening a card therefore costs one lazy chunk
fetch plus that card's own first request; the page does not pre-warm the
catalog's chunks on hover over a tile.

### Failure behaviour

- **Unknown card id.** `/cards/does-not-exist` renders `<Missing id="does-not-exist" />`,
  not `NotFound`. See "Status and empty-state messages" below. This is a
  deliberate second tier under AGENTS.md non-negotiable 9: the *route* exists
  and is registered, so it must not 404; the *card* does not, so it says so.
- **Unknown route.** `/cards/a/b` matches no `<Route>` and falls through to
  `<Route path="*" element={<NotFound />} />`. AGENTS.md non-negotiable 9:
  *"An unregistered route renders NotFound. v2 fell through to
  `/traders-dashboard`, which made missing pages look like they half-worked."*
- **Hard refresh / shared link.** A hard refresh on `/v3/cards/multi-greek` is
  served by a Next `route.ts` in the v2 repo calling `serveSpaShell("v3")` —
  step 4 of AGENTS.md's four-step "Adding a page". Miss it and *"the page works
  when you click to it in-app but 404s on a hard refresh or a shared link."*
  Since `/cards/:cardId` is a dynamic segment, the Next handler for it has to be
  a bounded dynamic route in the same shape as `app/v3/m/[tab]/route.ts` —
  never a catch-all under `/v3`, *"which would swallow `/v3/assets/*.js` and
  hand back HTML."*
- **`localStorage` throws.** Every read and write of the pane height goes
  through try/catch and degrades to the default. The comment: *"a browser with
  no storage (private mode, blocked) just gets the default every time — the
  feature degrades to what it replaced."*
- **A card's lazy chunk fails to load.** Not handled here. There is no error
  boundary in `CardGallery.tsx`; the `Deferred` wrapper in `catalog.tsx` is a
  `Suspense` (loading), not an error boundary.

---

## Every derived number

There are exactly three computations on this page, and two of them are the same
one.

### 1. `paneHeight(rows)` — grid rows → pixels

```ts
function paneHeight(rows: number): number {
  return Math.max(360, rows * BOARD_ROW_H)
}
```

- **Units:** input is grid rows (`CardDef.defaultSize.h`); output is CSS pixels.
- **`BOARD_ROW_H`** is `8` (px), exported from `src/design/primitives/Board.tsx`.
- **Floor:** 360px, *"so nothing collapses"*.
- This is the *only* import from the board primitive. The header explains the
  reasoning: *"A card is written to fill a grid cell, not a page: several
  stretch to their container and would grow forever inside a plain `<div>`. The
  open card gets an explicit height from its OWN `defaultSize.h` in board rows —
  the height the grid would have given it."*

Worked examples, straight off `CARD_CATALOG`:

| Card id | `defaultSize` (w × h, grid units) | `paneHeight` |
|---|---|---|
| `gex-candles` | 24 × 48 | 384px |
| `gex-chart` | 24 × 48 | 384px |
| `gauge-rail` | 48 × 20 | **360px** (floor bites; 20 × 8 = 160) |
| `multi-greek` | 48 × 56 | 448px |
| `vol-gex-flow` | 24 × 56 | 448px |
| `oi-by-expiry` | 24 × 40 | 320 → **360px** (floor bites) |
| `net-premium` | 24 × 48 | 384px |
| `flow-tape` | 48 × 48 | 384px |
| `top-flow` | 48 × 48 | 384px |
| `quick-links` | 16 × 24 | 192 → **360px** (floor bites) |
| `key-levels` | 48 × 24 | 192 → **360px** (floor bites) |
| `econ-calendar` | 24 × 48 | 384px |

Five of the twelve cards hit the 360px floor. The `w` half of `defaultSize` is
**never used for layout on this page** — the pane is always the page's full
width — it is only *printed*, in the header, as `{w}×{h} on the grid`.

### 2. The drag-detection threshold

In the `ResizeObserver` callback:

```ts
const h = el.getBoundingClientRect().height
if (!h || Math.abs(h - last) < 2) return
```

- **Units:** CSS pixels. A change smaller than **2px** is discarded.
- Purpose stated in the comment: *"Native `resize` fires no event of its own, so
  the pane is watched instead. This also catches the window getting narrower,
  which is not a drag and must not be saved as one — hence the comparison
  against what we last stored."*

### 3. The "reset height" visibility test

```ts
{Math.round(height) !== fallback && ( <button …>reset height</button> )}
```

- `height` is the state value (px); `fallback` is `paneHeight(card.defaultSize.h)`.
- Rounded because the observer stores `Math.round(px)` and the state may hold a
  subpixel `getBoundingClientRect()` value.
- The comment: *"Only offered once the pane is not the default, so it is never a
  button that does nothing."*

No other number on the page is computed. The tile grid's column count is a CSS
`repeat(auto-fill, minmax(240px, 1fr))`, i.e. the browser's arithmetic, not the
page's.

---

## Every control

There are four interactive things on this page, plus the three navigations.

### Tile → open card

- **What:** a `react-router` `<Link to={`/cards/${c.id}`}>` wrapping the whole
  tile.
- **State:** the URL. `/cards/:cardId` is the entire state of "which card is
  open". Nothing is persisted, because the URL *is* the persistence — that is
  the point of the route existing at all.
- **Default:** no card open (`/` or `/cards` both render `<Tiles />`).

### Page link → a full route

- **What:** `<Link to={p.path}>` for each entry in the module-level `PAGES` array.
- **State:** the URL.
- The comment above the list: *"The full pages are not cards and are not opened
  in a pane: each is a route of its own, so the honest thing is a link to the
  page."*

`PAGES`, verbatim and in order (`path`, `label`, `icon`):

```
/board               The grid board           🧩
/traders-dashboard   Trader's Dashboard       📊
/premarket           Premarket                🌅
/options-chain       Options Chain            ⛓️
/chain               Chain                    🔗
/analytics           Analysis                 🔬
/flow                Flow                     🌊
/em                  Estimated Move           📐
/replay              Replay                   ⏪
/scanner             Scanner                  🔎
/economic-calendar   Economic Calendar        📅
/level-log           Level Log                🪵
/seasonality         Seasonality              🗓️
/whales              Whales                   🐋
```

Two things about this list that will bite a maintainer:

1. **It is a third copy of the route table.** `App.tsx` has the routes, `NAV` in
   `Shell.tsx` has the rail, and this has the page list. Nothing keeps them in
   sync. `/single` (the Voltmap) is in `App.tsx` and in `NAV` and is **not** in
   `PAGES` — so the Voltmap is not linked from the home page. `/feedback`,
   `/legacy` and the `/m/*` tabs are likewise absent.
2. **The icons disagree with `NAV`.** `PAGES` gives Analysis 🔬 and Replay ⏪;
   `NAV` gives them 📈 and ⏱️. Same destinations, two glyph vocabularies.

### "← Cards" back link

- **What:** `<Link to="/cards">`. Note the target: `/cards`, **not** `/`. Both
  render the same tiles, but the back link normalises onto `/cards`, so a user
  who arrived at `/` and opened a card lands on `/cards` when they go back.
- Appears twice: in the one-card header, and in `<Missing>`.

### The pane resize handle (the only stateful control)

- **What:** the browser's own bottom-edge resize grip, via
  `style={{ height, resize: 'vertical', minHeight: MIN_PANE, maxHeight: MAX_PANE }}`.
- **Why native:** *"`resize: vertical` is the browser's own handle — no drag
  maths, no pointer capture, no ghost element, and it keeps working inside the
  iframe voltick frames this app in. It needs a non-visible overflow to appear
  at all, which the card already has."*
- **Width is not resizable, on purpose:** *"the pane is already the full width
  of the page, and letting it exceed that would put a card's own horizontal
  scrollbar inside the page's."*
- **Bounds:** `MIN_PANE = 220`, `MAX_PANE = 4000` (px). These are enforced three
  ways — as CSS `minHeight`/`maxHeight`, and again in `loadHeight()`'s validity
  test, so a corrupt stored value outside the range is rejected rather than
  clamped.
- **Default:** `paneHeight(card.defaultSize.h)` — see the table above.
- **Where the state lives:** `localStorage`.

#### The storage key

```ts
const HEIGHT_KEY = 'voltick-card-height:'
```

- **Full key:** `voltick-card-height:` + the **catalog** card id, e.g.
  `voltick-card-height:multi-greek`.
- **Value shape:** a bare decimal string of the rounded pixel height —
  `String(Math.round(px))`. Not JSON, not an object.
- **Version field:** none. There is no schema to version; validity is decided at
  read time by `Number.isFinite(n) && n >= MIN_PANE && n <= MAX_PANE`.
- **Scope:** per card, per browser. The comment: *"Per card id, so Multi Greek
  being tall does not make Key Levels tall. Keyed under this app's own prefix
  and never read by anything else."*
- **Note the prefix.** Every other persisted key in this app is `cb-v3-…`
  (`cb-v3-board-layout`, `cb-v3-rail-order`, `cb-v3-quick-links`, …) or `vb-…`
  for the Voltmap. This one is `voltick-card-height:` — the only `voltick-`
  prefixed key in `src/`.

#### The three functions

| Function | Behaviour on throw |
|---|---|
| `loadHeight(cardId, fallback)` | returns `fallback` |
| `saveHeight(cardId, px)` | swallowed — *"best effort: a pane that will not persist still resizes"* |
| `forgetHeight(cardId)` | swallowed |

#### The two effects behind it, and why they are shaped that way

```ts
useEffect(() => setHeight(loadHeight(card.id, fallback)), [card.id, fallback])
```
*"Re-read when the card changes: this component is remounted per card (see the
`key` below), but the state initialiser only runs on mount, and a future
refactor that drops the key would otherwise carry one card's height to the next
one silently."* — i.e. belt and braces against a refactor that has not happened.

```ts
useEffect(() => { /* ResizeObserver */ }, [card.id])
// eslint-disable-next-line react-hooks/exhaustive-deps
```
`height` is read once inside to seed `last` and is deliberately *not* a
dependency: *"re-subscribing on every pixel of a drag would tear the observer
down mid-gesture."* The `eslint-disable` is load-bearing, not laziness.

### "reset height"

- **What:** a text button in the one-card header's right-hand meta cluster.
- **Does:** `forgetHeight(card.id)` → `setHeight(fallback)` → clears the DOM
  node's inline `style.height` (necessary, because the native resize handle
  writes `height` directly onto the element's style attribute, which would
  otherwise outrank the React-controlled value).
- **Visible only when** `Math.round(height) !== fallback`.
- **Hidden below the `sm` breakpoint** — it lives inside
  `className="ml-auto hidden … sm:flex"`, along with the `{w}×{h} on the grid`
  readout.

### Not on this page but sitting on top of it

Everything in `src/shell/Shell.tsx`'s toolbar is above this route and stays:
the Bzila wordmark, the alerts pill, the SPX chip and `TickerPicker`, the offer
pill, the ET clock, `↻` (`RefreshButton`), `📸` (`CopyShotMenu`, owner-only and
drawing nothing when no target is published), `✎` (notes dock), and `UserMenu`.

The **`ToolbarSlotHost`** is rendered here too — but `CardGallery.tsx` never
renders a `<ToolbarSlot>`, so the slot is empty on this route. That is
`ToolbarSlot.tsx`'s stated design: *"'ONLY ON THE HOME PAGE' needs no condition
anywhere: the slot draws whatever the MOUNTED route puts into it, and every
other route puts nothing."* (The "home page" it means is `/board`, which is what
that file was written for — see the board document.)

---

## Rendering

**Pure DOM.** No canvas, no SVG, no chart library. Everything is Tailwind v4
utilities resolving to `tokens.css` custom properties.

### Layout constants

| Thing | Value | Where |
|---|---|---|
| Page padding | `p-3` (12px), `sm:p-4` (16px) | both `<Tiles>` and `<OneCard>` roots |
| Tile grid | `grid-cols-1`, `sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]` | `<Tiles>` |
| Tile gap | `gap-3` (12px) | `<Tiles>` |
| Pages grid | `grid-cols-1`, `sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]`, `gap-2` (8px) | `<Tiles>` |
| Pages heading offset | `mt-8 mb-3` (32px / 12px) | `<Tiles>` |
| Header prose max width | `max-w-2xl` on the tiles blurb, `max-w-3xl` on the one-card note | both |
| Pane min / max height | 220px / 4000px | `MIN_PANE` / `MAX_PANE` |
| Pane corner | `rounded-md` → `--radius-md: 10px` | `<OneCard>` |
| Tile corner | `rounded-md` → 10px | `<Tiles>` |

### Colours, as tokens (with today's hex from `tokens.css`)

Nothing on this page names a colour directly. Every class below is one of the
app's own no-shade-number utilities, which AGENTS.md non-negotiable 1 makes
mandatory (*"Also banned: Tailwind's default palette… it is exactly what made
v2's text come out grey"*).

| Utility used | Token | Hex today |
|---|---|---|
| `bg-surface` (tile plate, pane plate) | `--color-surface` | `#0e1216` |
| `hover:bg-surface2` (tile hover) | `--color-surface2` | `#141a21` |
| `border-line` (tile edge, pane edge) | `--color-line` | `#1e2630` |
| `text-fg` (headings, labels, the id in `<Missing>`) | `--color-fg` | `#e7ece9` |
| `text-muted` (blurbs, descriptions, the mono id, back link) | `--color-muted` | `#e7ece9` |
| `text-accent` (`reset height`, the `<Missing>` back link) | `--color-accent` | `#2f6bff` |
| page background (inherited from `Shell`'s `bg-bg`) | `--color-bg` | `#0a0d10` |

Note that `--color-muted` and `--color-fg` are the **same value today**
(`#e7ece9`). `tokens.css` says why: *"All white per Brandon 2026-08-27 — the
grey secondary/faint tones read too dim against the dark-slate surfaces.
`muted`/`faint` stay as separate tokens … in case a step-down grey comes back
later; today all three resolve to the same white."* So the visual hierarchy on
this page comes from **size and weight**, not from colour — which is why the
tile's label is `text-sm font-bold` and its note is `text-xs leading-relaxed`.

### Type sizes

All from the scale in `tokens.css`; AGENTS.md non-negotiable 1 bans `text-[10px]`
and friends.

| Class | Token | px | Used for |
|---|---|---|---|
| `text-2xs` | `--text-2xs` | 10 | the mono catalog id on a tile, the `↗` on a page row, the `{w}×{h} on the grid` readout, `reset height`, the pane hint line |
| `text-xs` | `--text-xs` | 11 | a tile's description line |
| `text-sm` | `--text-sm` | 13 | tile labels, page-row labels, the tiles blurb, the one-card description, the back link, `<Missing>` copy |
| `text-lg` | `--text-lg` | 18 | `Cards`, `Pages`, and the open card's `<h1>` |
| `text-2xl` | `--text-2xl` | 32 | the tile's emoji |

### The one-card pane, and the two things that make it correct

```tsx
<div
  key={card.id}
  ref={pane}
  className="flex min-h-0 flex-col overflow-hidden rounded-md border border-line bg-surface"
  style={{ height, resize: 'vertical', minHeight: MIN_PANE, maxHeight: MAX_PANE }}
>
  {card.render(card.id)}
</div>
```

1. **`key={card.id}`** forces a remount when you navigate from one card to
   another. The comment is the whole justification: *"opening a different card
   REMOUNTS rather than reusing the last one's tree: these hold sockets,
   canvases and chart instances, and handing a live one to a different card is
   how a chart ends up drawing someone else's data."*
2. **`flex min-h-0 flex-col`** is the same requirement `Board.tsx` documents for
   its tiles: *"Must be a flex column, not just a sized box: Card (and every
   card body under it) fills its space via `flex-1`/`min-h-0`, which only takes
   effect inside a flex parent."* Without it the card would collapse to its
   header height.

### `card.render(card.id)` — the plain id, not an instance id

`CardDef.render` takes an `instanceId` (see the INSTANCE IDS block in
`catalog.tsx`). This page passes the **bare catalog id**, and says why:

> `render()` takes an instance id and gets the plain type id here: there is only
> ever one copy open, so its settings are the first copy's settings.

Consequence: a card opened at `/cards/gex-candles` shares its per-instance state
(GEX Candles' own ticker, Top Flow's cogwheel settings) with **instance #1 on
the grid board**. There is no `#2` anywhere on this route.

### The `Deferred` Suspense boundary

Every heavy card in the catalog is wrapped:

```tsx
function Deferred({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="min-h-0 flex-1" />}>{children}</Suspense>
}
```

*"The Suspense fallback is a blank fill, not a spinner: the card frame is
already drawn around it, and a spinner inside a frame reads as an error."*
On this page the "frame" is the bordered pane, which is drawn before the chunk
arrives — so the visible state while a card loads is an empty bordered box at
the pane's height, with the header and description already readable above it.

### Per-frame / perf machinery

None at this level. The page renders on route change and on the two state
updates (`height`, and the remount). There is no `requestAnimationFrame`, no
interval, no observer other than the single `ResizeObserver` on the pane —
which is itself `card.id`-scoped, so exactly one exists at a time and only in
the one-card view.

---

## Phone behaviour

### The redirect map exempts `/`, deliberately, and the comment is the record

`DESKTOP_TO_MOBILE` in `src/mobile/mobileNav.ts`:

```ts
export const DESKTOP_TO_MOBILE: Record<string, string> = {
  // NOT '/': on voltick the landing page is the CARD TILES, and they are the
  // point of the site on a phone as much as on a laptop. Redirecting '/' — which
  // is what v3 does, because '/' there is the grid board — meant a phone opening
  // voltick.cbedge.net/v3 never saw the cards at all. It was bounced straight to
  // the GEX screen, which reads as somebody else's app.
  //
  // The grid board keeps its redirect under its new path: a drag-and-drop grid
  // really is unusable on a handset.
  '/board': '/m/gex',
  '/traders-dashboard': '/m/gex',
  '/em': '/m/em',
}
```

So: **a phone on `/` stays on `/`.** It gets the desktop shell (rail + toolbar),
not `MobileShell`, because `Shell.tsx` branches on `isMobilePath(pathname)` and
`/` is not under `/m/`. `/cards` and `/cards/:cardId` are likewise not in the
map and not under `/m/`, so they stay too.

Three of the six phone tabs in `MOBILE_TO_DESKTOP` point their "Desktop site"
action back at `/` — `/m/heat`, `/m/spx`, `/m/econ`, plus `/m/alerts` whose
comment reads *"No desktop page of its own — the feed lives in the toolbar,
which is on every desktop route, so the board is the honest landing."* So this
page is the phone build's designated way out.

### What actually adapts

- **Tiles:** `grid-cols-1` below the `sm` breakpoint (Tailwind's `sm` = 640px),
  `repeat(auto-fill, minmax(240px, 1fr))` above it. So one tile per row on a
  phone, in `CARD_CATALOG` order.
- **Pages list:** same shape, `minmax(200px, 1fr)` above `sm`.
- **Padding:** `p-3` → `sm:p-4`.
- **One-card header:** the right-hand cluster (`{w}×{h} on the grid` and
  `reset height`) is `hidden … sm:flex` — gone on a phone. The `<h1>` row itself
  is `flex-wrap`, so the title, the id and the back link stack rather than
  overflow.
- **The pane:** `resize: 'vertical'` is a desktop affordance and is essentially
  unusable by thumb. The height persists per card either way, so a height set on
  a laptop does **not** carry to a phone (different `localStorage`).
- **`useIsPhone()` is never called here.** The page uses CSS breakpoints only.
  That matters: `useIsPhone()` is `(max-width: 820px) AND (pointer: coarse OR
  hover: none)`, while Tailwind's `sm` is a pure 640px width query. A narrow
  desktop window gets the one-column tile layout but is not a phone to anything
  else in the app.

### Scrolled out of view — AGENTS.md non-negotiable 5

> *"A card nobody can see does not paint. `ChartFrame` reports its own
> visibility three ways — `handle.visible()` for a per-frame loop,
> `onVisibility` for an on-demand renderer, `data-visible` on the element. Use
> one."*

**This page has nothing to gate.** There is no canvas and no per-frame loop in
`CardGallery.tsx`, so the rule has no target at this level. The gating that
matters happens one layer down and is unchanged by being on this route:

- The *open* card, if it paints, mounts through `ChartFrame`
  (`src/design/primitives/ChartFrame.tsx`), which tracks its own visibility with
  an `IntersectionObserver` plus the tab's `visibilitychange`, with
  `rootMargin` extending the viewport by **200px** (*"so a card is painted just
  before it is scrolled into view rather than a frame after"*). That works
  identically inside this page's pane, because the observer watches the frame
  element against the viewport, not against a board.
- **Both views of this page scroll.** `<Tiles>` is
  `min-h-0 flex-1 overflow-y-auto`; `<OneCard>` is
  `flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto`. So on a short window an
  open card's pane genuinely can be scrolled partly or wholly out of view, and
  the card's own gate is what stops it painting.
- `ChartFrame`'s own caveat applies here as everywhere: *"this frame does not
  (and cannot) stop a renderer painting. It only reports."*
- The *tab* going to the background is handled the same way: `ChartFrame` folds
  `document.visibilityState` into its signal, and `api.ts`'s `pollMs` stops
  while the tab is hidden by default (*"a background tab refetching a chain
  every 15s is pure egress nobody is looking at"*).

One thing this page does **not** do that the board does: it does not gate on
being expanded-out-of-tile, because there is no expand stage participation here
beyond what `Card` does itself (see below).

### Expand, on this page

`Shell.tsx` wraps the page column in `<ExpandStageHost>`, so a `Card` rendered
inside an open card's tree still draws its `⤢` control and can fill the page
column. `Expand.tsx`'s rule holds: *"Outside an ExpandStageHost — the phone
build, a preview, a test — the context is null and Card simply draws no expand
control."* On `/m/*` there is no stage (the mobile branch of `Shell` does not
wrap in `ExpandStageHost`), but this page is never on `/m/*`, so the control is
there. Escape collapses it (`ExpandStageHost`'s window `keydown` handler).

---

## Status and empty-state messages, verbatim

There are five pieces of fixed copy on this page. All five are always-on prose
rather than conditional status, except `<Missing>`.

**1. The tiles header blurb** — always, on `/` and `/cards`:

> Cards

> Every card in the catalog, with a line on what each one is. Open one and it is
> the only thing on the screen, with live data. Each card has its own link, so
> one can be sent on its own.

**2. The pages heading** — always, under the tiles:

> Pages

**3. The pane hint** — always, under the open card:

> Drag the bottom edge to resize. Kept per card.

**4. The reset control** — only when `Math.round(height) !== fallback`, and only
at `sm` and above:

> reset height

**5. `<Missing>`** — when `cardId` is present in the URL and
`CARD_BY_ID.get(cardId)` is `undefined`:

> No card with the id `<id>` in the catalog.

> ← Cards

(`<id>` renders in `font-mono text-fg`; the rest is `text-sm text-muted`; the
link is `text-sm text-accent`.)

**And `NotFound`, from `App.tsx`,** for a path that matches no route at all:

> No such page

> `<pathname>`

There is **no** loading state, **no** error state, and **no** "empty catalog"
state. An empty `CARD_CATALOG` would render an empty `<ul>` under the heading.

### The `NOTES` map — the tile descriptions

`NOTES` is a `Record<string, string>` keyed by catalog id. Its docblock sets
three rules that matter more than the strings:

> This page is a showroom: a link to it goes to someone outside CB Edge who has
> no idea what a Core is or why a card called Gauge Rail has five tick meters on
> it.

> Every line below is taken from that card's OWN header comment rather than
> invented here, so a description cannot quietly become wrong about what the
> card does.

> Keyed by catalog id: a card with no entry simply shows no note, so adding a
> card never breaks this page and never blocks it either.

And an invitation, for the merger review this page was built for:

> These describe WHAT A CARD IS. If you want to say what you are PROPOSING with
> one — why it should exist in the merged product, what you would change — that
> is a different sentence and it belongs here too. Write it in your own words
> and put it after the description.

**Coverage today: 12 of 12.** Every entry in `CARD_CATALOG` has a `NOTES` line.
The notes, verbatim:

| id | note |
|---|---|
| `gex-candles` | Price candles with the option book drawn on them: every strike that matters as a bubble, sized by gamma, the biggest wall in each bucket picked out. |
| `gex-chart` | Net gamma per strike as bars on their own axis, with the net-delta line across them and ten stat tiles above. |
| `gauge-rail` | Five readings as tick meters: net gamma, net delta, the call share of volume gamma, and net GEX per minute and over the last fifteen. Each carries its own 15-minute change. |
| `multi-greek` | Up to four tickers side by side, each a strike ladder read down and expiries read across. The point is the across-read: the same strike on several symbols at the same DTE. |
| `vol-gex-flow` | Net volume-gamma flow through the session, as a baseline chart. |
| `oi-by-expiry` | Call and put open interest per expiration date, sharing one column and one scale, so "how does call OI compare to put OI at this date" is one look. |
| `net-premium` | Cumulative net call premium against cumulative net put premium, one point a minute, with the minute's contract volume underneath and the underlying's own path behind it. |
| `flow-tape` | The live print table, one ticker at a time, with a minimum-premium floor pushed into the query so raising it keeps the biggest prints of the session rather than the most recent. |
| `top-flow` | The whole market's biggest prints, ranked by dollar premium, from one cached vault sweep. Not the Flow Tape: that is one ticker recorded live, this is where the size went today. |
| `key-levels` | Every level on one horizontal price axis — put wall, gamma flip, max pain, core, spot, call wall — each with its distance from spot, and nothing else. |
| `econ-calendar` | Today only, in ET, sorted by time, with earnings woven in. An event more than an hour past its start is removed rather than dimmed. |
| `quick-links` | A short list of links you keep, saved in this browser. |

The same note is repeated in the one-card view, and the comment says why:

> A deep link lands here, not on the tiles, so the description has to be on this
> screen too — otherwise the one view an outsider is most likely to be sent is
> the one that explains itself least.

---

## The catalog, as this page reads it

`CARD_CATALOG` order **is** tile order. Today:

| # | id | icon | label | `defaultSize` | Chunk |
|---|---|---|---|---|---|
| 1 | `gex-candles` | 🕯️ | GEX Candles | 24 × 48 | `lazy()` |
| 2 | `gex-chart` | 📊 | GEX Chart | 24 × 48 | `lazy()` |
| 3 | `gauge-rail` | 🎚️ | Gauge Rail | 48 × 20 | `lazy()` |
| 4 | `multi-greek` | 🧮 | Multi Greek | 48 × 56 | `lazy()` |
| 5 | `vol-gex-flow` | 🌀 | Net Vol GEX Flow (Today) | 24 × 56 | `lazy()` |
| 6 | `oi-by-expiry` | 📅 | OI by Expiration | 24 × 40 | `lazy()` |
| 7 | `net-premium` | 💵 | Net Premium | 24 × 48 | `lazy()` |
| 8 | `flow-tape` | 🌊 | Flow Tape | 48 × 48 | `lazy()` |
| 9 | `top-flow` | 🐋 | Top Flow | 48 × 48 | `lazy()` |
| 10 | `quick-links` | 🔗 | Quick Links | 16 × 24 | **static** |
| 11 | `key-levels` | 📏 | Key Levels | 48 × 24 | `lazy()` (+ `Title`) |
| 12 | `econ-calendar` | 🗓️ | Economic Calendar & Earnings | 24 × 48 | `lazy()` |

`CardDef.icon`'s docblock explains the glyph vocabulary: *"One emoji, in the
rail's language (see NAV in shell/Shell.tsx). It is what the '+ Add card' menu
and the camera's menu are scanned by — at a glance you are looking for the
shape, not reading eight labels."* The tiles inherit that for free and render
each icon `aria-hidden` at `text-2xl` (32px).

### `CardDef.Title` is ignored here

Only `key-levels` has one (`KeyLevelsHeading`). The one-card header prints
`card.label` — **"Key Levels"** — not the live `AMZN - Key Levels - 8-31-26`
heading that `BoardPage` renders through `CardDef.Title`. That live heading is
built by `CardHeading` in `src/board/cardTitle.tsx` (50 lines), and the reason
it exists is worth knowing even though this page skips it: *"a levels board with
no expiry on it is a board you cannot check against a chain, and 'which expiry
is this' is the first question asked of every gamma number in the product."*
On `/cards/key-levels` that information is inside the card's own body only.

### Why `quick-links` stays static

> Quick Links stays static — it is a few lines and a chunk boundary would cost
> more than it saves.

It is defined inline in `catalog.tsx` as `QuickLinksCard`, and persists to
`localStorage` under **`cb-v3-quick-links`**, shape
`Array<{ id: string; label: string; url: string }>`, no version field, `id`
generated as `` `${Date.now()}-${prev.length}` ``. `loadLinks()` returns `[]` on
any throw or on a non-array parse. Its own empty state, verbatim:

> No links yet — add one below.

That is the one piece of card-level copy this page can surface with no network
at all, which makes `/cards/quick-links` the page's smoke test.

---

## Performance and bundle notes

### Chunking

- The page is `lazy()`, per `App.tsx` rule 1: *"Every route is lazy() EXCEPT the
  landing route. A route that is in the entry chunk is a route every user
  downloads whether they visit it or not."* Note the irony worth flagging:
  `CardGallery` **is** the landing route here, and it is still `lazy()`.
  `Home.tsx` (10 lines, `/board`) is the one statically imported page, a
  leftover from when `/` was the grid board. So a cold load of `/` fetches the
  entry chunk *and* the `CardGallery` chunk *and* carries `BoardPage`'s tree in
  the entry chunk without rendering it.
- The page's own chunk is tiny: 315 lines of JSX plus two literal tables. Its
  real weight is what it *imports*: `catalog.tsx`, which pulls in twelve
  `lazy()` factories (cheap — a factory is a closure, not the module) plus the
  static `QuickLinksCard`. `AGENTS.md`: *"Big cards go behind `lazy()`; a card
  that is a few lines stays static, because a chunk boundary costs more than it
  saves."*
- `vite.config.ts` does almost no manual chunking, on purpose: *"Manual chunking
  is deliberately minimal. React lands in its own chunk so it stays cached
  across every deploy; everything else code-splits by route via lazy(). Do NOT
  add vendor grouping 'for tidiness' — a shared vendor chunk means one
  dependency change invalidates the cache for all of them."* The only two rules
  are `node_modules/(react|react-dom|scheduler)/` → `react`, and the seasonality
  data tables → `data-seasonality`.

### `budgets.json` lines that apply

```json
"entry": 38900,
"react": 55000,
"route": 59100,
"data": 78000,
"css": 8500,
"html": 2600,
"totalInitial": 108400,
```

(brotli-compressed bytes, per the file's `$comment`.) The `CardGallery` chunk is
measured as kind **`route`** against **59100**. The file's own justification for
tight numbers: *"These are set close to current reality on purpose — a budget
with 4x headroom enforces nothing."* And AGENTS.md non-negotiable 7: *"Budgets
are hard limits, and they ratchet… Raise a number in `budgets.json`
deliberately, in a diff someone can see — never work around it."*

The ratchet block:

```json
"ratchet": { "slack": 0.15, "enforce": false }
```

15% headroom triggers a SLACK report; `enforce: false` means a shrinking bundle
never blocks a commit, and you re-tighten with `npm run budgets:ratchet`.

### `perf` limits — and why they do not apply to this page

```json
"perf": {
  "idleRepaintsPerFrame": 0.15,
  "offscreenRepaints": 0,
  "interactionRepaints": 10
}
```

`scripts/perf-check.mjs` *"counts REPAINTS PER ANIMATION FRAME on every canvas
v3 owns (the ones tagged `data-cb-layer`), attributed per board card"*, and
attributes a canvas to a card by walking up to `data-card-id` — which
`Board.tsx` puts on each **grid tile**. This page draws no `data-card-id`, so an
open card here is invisible to the per-card attribution even though it is very
much painting. The perf harness *"adds every card in the catalog to a board and
measures your new one automatically"* — a *board*, not this gallery. **If you
are perf-testing a card, test it on `/board`.**

### Bundle caveats specific to this repo

- `README.md` for voltick: *"`build` here is `tsc --noEmit && vite build`. It
  deliberately does not run `check-theme.mjs` or `check-budgets.mjs`, which
  measure this app against v3's theme baseline and byte budgets — a different
  palette can only fail those."* And `package.json` confirms:
  `"build": "tsc --noEmit && vite build"`, with `budgets` / `check:theme` as
  separate scripts. So the budgets above are inherited numbers that this repo's
  build does **not** currently enforce. `theme-baseline.json` lists zero files
  under `src/pages/CardGallery.tsx` or `src/board/catalog.tsx`, so both are
  clean and, per the baseline's own README, *"a file at zero is removed and can
  never regress."*
- Source maps off by default (non-negotiable 8) — `CB_SOURCEMAPS=1` for a local
  debug build.

---

## Gotchas

1. **`/` and `/cards` are the same screen, and the back link normalises to
   `/cards`.** Two URLs for one view. The `/` route is what `NAV` links to and
   what the visit beacon labels `Home`; `/cards` is what the in-page back link
   goes to and what the beacon logs as `/cards`. Analytics on "how many people
   looked at the tiles" has to add two rows.

2. **`PAGES` is a hand-maintained third copy of the route table, and it is
   already out of date with itself.** `/single` (the Voltmap) is in `App.tsx`
   and in `NAV` but not in `PAGES`, so the flagship board is unreachable from
   the home page. `/feedback` and `/legacy` are missing too. The icons for
   Analysis and Replay disagree with `NAV`'s. Nothing enforces any of this.

3. **The pane height key is `voltick-card-height:<id>` — the only `voltick-`
   prefixed storage key in `src/`.** Everything else is `cb-v3-…` or `vb-…`.
   A "clear this app's storage" routine written against the `cb-v3-` prefix will
   silently miss it.

4. **Height is keyed by catalog id, and so is every card's own settings key.**
   `card.render(card.id)` passes the bare id, so opening `/cards/gex-candles`
   drives **instance #1's** settings — the same storage the first GEX Candles on
   `/board` uses. Change the ticker here and you have changed it there. The
   board's own header names this as known and deliberate: *"a card's own
   settings are stored per card TYPE … not per instance."*

5. **`defaultSize.w` is printed but never used.** The pane is always full width.
   The `24×48 on the grid` readout describes a layout this page does not
   produce, which is honest but easy to misread as "this pane is 24 columns
   wide".

6. **Five of twelve cards hit the 360px floor, and three of those are the ones
   most likely to look wrong.** `gauge-rail` (20 rows → 160px, floored to 360),
   `key-levels` (24 rows → 192px), `quick-links` (24 rows → 192px). The floor
   makes them *taller* than the grid would; `oi-by-expiry` (40 rows → 320px)
   likewise. So the "same height the grid would have given it" claim in the
   header comment is only true above 45 rows.

7. **`resize: vertical` needs a non-`visible` overflow to render a grip at
   all.** The pane has `overflow-hidden`, which satisfies it. Change that class
   and the handle disappears with no error and no visual clue — and the hint
   line *"Drag the bottom edge to resize"* stays on screen pointing at nothing.

8. **The native resize writes inline `style.height` directly.** That is why
   `reset()` has to do `pane.current.style.height = ''` in addition to
   `setHeight(fallback)`: React's controlled `style={{ height }}` and the
   browser's own write land in the same place, and the browser's wins until it
   is cleared.

9. **The `ResizeObserver` effect's `eslint-disable` is load-bearing.** `height`
   is read to seed `last` but must not be a dependency. "Fixing" the lint
   warning tears the observer down mid-drag, and the symptom is a height that
   sometimes saves and sometimes does not.

10. **A window resize can be recorded as a drag.** The 2px guard catches noise,
    but a genuine window-narrowing that changes the pane's height by more than
    2px *will* be written to `localStorage` as if you had dragged it. The
    comment acknowledges the class of problem ("which is not a drag and must not
    be saved as one") and the guard is the whole mitigation.

11. **An unknown card id renders `Missing`, not `NotFound`.** Both are
    dead-ends, but only `NotFound` is the one AGENTS.md non-negotiable 9 is
    about. If you are auditing "does every bad URL fail loudly", remember there
    are two different loud failures here with different copy.

12. **This route is `lazy()` even though it is the landing page.** `App.tsx`'s
    own rule 1 exempts the landing route, and the exemption is currently spent
    on `Home` (`/board`, 10 lines) rather than on `CardGallery`. Net effect: the
    entry chunk carries `BoardPage`'s import graph for a page most users will
    not open, and the actual landing page costs an extra round trip.

13. **A phone on `/` gets the full desktop shell.** No `MobileShell`, no bottom
    tab bar, rail and toolbar both drawn. That is the intended behaviour
    (`DESKTOP_TO_MOBILE` deliberately omits `/`), but it means the 64px rail
    that `Shell.tsx` calls *"a quarter of a 390px screen"* is present on the
    landing page and absent on every `/m/*` tab.

14. **The `📸` camera menu is empty on this route.** `BoardPage` is what
    publishes the `'Home board'` group of `CopyShotTarget`s; this page publishes
    none. `CopyShot.tsx` draws *"nothing at all until some surface on the
    current page has published itself as worth photographing"* — so on `/cards`
    and `/cards/<id>` the owner sees no camera unless the open card registers a
    target itself.

15. **No error boundary anywhere on the path.** `Deferred` is a `Suspense`, not
    an `ErrorBoundary`. A card whose lazy chunk 404s (a stale `index.html`
    pointing at a hashed filename that was replaced by a deploy) throws through
    the page. `UpdateToast` / `data/appVersion.ts` exists for the general "new
    version" case, but there is no local catch here.

16. **`embed=1` changes what is around this page, and it is sticky per tab.**
    `Shell.tsx` reads `?embed=1` and stores `cb-embed` in `sessionStorage`,
    dropping the rail, the toolbar and the notes dock — *"voltick.cbedge.net
    frames this app inside its OWN chrome, and two sets of bars around one board
    is not a layout, it is two products arguing."* Critically, *"the moment
    someone clicks a card inside the frame the URL becomes `/cards/<id>` with no
    query and the bars would come straight back"* — which is precisely this
    page's main interaction, and is why the flag is remembered rather than read
    per-navigation. `?embed=0` clears it.

17. **`NOTES` promises to be transcribed, and nothing checks that it is.** The
    docblock says each line is *"taken from that card's OWN header comment
    rather than invented here, so a description cannot quietly become wrong."*
    That is a convention enforced by whoever edits it. A card whose header
    comment changes leaves its note stale with no signal.

18. **Adding a card to the catalog adds a tile with no note.** By design (*"a
    card with no entry simply shows no note, so adding a card never breaks this
    page"*), but the tile then reads as an icon, a label and an id — which is
    exactly the state the `NOTES` docblock describes as useless to an outsider:
    *"A tile that only says 'Gauge Rail' tells them nothing."*
