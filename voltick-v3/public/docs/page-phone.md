# The phone build — `/v3/m/*`

**Routes:** `/m` (a `<Navigate replace>` to `/m/gex`), `/m/gex`, `/m/heat`, `/m/spx`, `/m/em`,
`/m/econ`, `/m/alerts` — under `BrowserRouter basename="/v3"`, so
`https://voltick.cbedge.net/v3/m/gex` on the wire. **Mounted by:** six `lazy()` bindings and seven
`<Route>` lines in `src/App.tsx`, inside the same `<Shell>` every desktop route uses. **Hard refresh
answered by:** `app/v3/m/[tab]/route.ts` in the v2 repo — **one dynamic segment**, deliberately not a
catch-all.

**Sources:** all of `src/mobile/*`, plus `src/design/useIsPhone.ts`, `src/shell/Shell.tsx`,
`src/shell/AlertsFeed.tsx` + `alertTypes.ts`, four board cards, `src/pages/Em.tsx` + `em/emData.ts`,
and `src/App.tsx` — line counts and ownership in the file map below.

---

## What it is, in one paragraph

Six screens, and **five of them are not a phone-only implementation of anything**: each is a v3
home-board **card**, or a v3 **page**, rendered full-bleed inside `MobileShell`. The Heat tab *is*
`MultiGreekCard`; the GEX tab *is* `GexChartCard`; the Moves tab *is* `pages/Em`. A fix to a card is a
fix to the phone, because there is exactly one renderer for every number on screen. The sixth,
`/m/alerts`, is the single exception, and it exists because the signal feed has no card — on the
desktop it is toolbar chrome, and `Shell.tsx` drops the alerts pill on `/m/*`, so without a tab the
feed would not be cramped, it would be unreachable. Even there only the *layout* is phone-side: the
poll, the catalogue and the filter state are all imported from the desktop modules. v2 shipped six
bespoke phone pages under `components/mobile/` and they drifted from the desktop inside a week; this
is the same product decision made the other way.

---

## File map

| File | Lines | What it owns |
|---|---:|---|
| `src/mobile/mobileNav.ts` | 141 | `MobileTab`, `MOBILE_TABS`, `MOBILE_ROOT`, `MOBILE_DEFAULT_PATH`, `DESKTOP_TO_MOBILE`, `MOBILE_TO_DESKTOP`, `isMobilePath`, `tabForPath`, `FORCE_DESKTOP_KEY`, `isDesktopForced`, `setDesktopForced` |
| `src/mobile/MobileShell.tsx` | 119 | `MobileShellProps` (`title`/`right`/`sticky`/`fill`/`chrome`), the Card-header collapse, the body scroll switch |
| `src/mobile/MobileTabBar.tsx` | 102 | `LONG_PRESS_MS`, six `NavLink`s, hold-to-desktop, the safe-area pad |
| `src/mobile/MobileRedirect.tsx` | 45 | the three redirect rules |
| `src/mobile/pages/MGex.tsx` · `MHeat.tsx` · `MSpx.tsx` · `MEm.tsx` · `MEcon.tsx` | 28 · 39 · 34 · 21 · 26 | the five wrappers — one import and one JSX element each, plus the header comment explaining the props |
| `src/mobile/pages/MAlerts.tsx` | 195 | the one phone-side layout: chips, rows, footer |
| `src/design/useIsPhone.ts` | 56 | `PHONE_MAX_WIDTH`, `isPhoneViewport`, `useIsPhone` |
| `src/shell/Shell.tsx` | 739 | the `isMobilePath` branch, `Toolbar({ mobile })`, the providers |
| `src/shell/AlertsFeed.tsx` | 443 | `useAlertsFeed`, `FEED_POLL_MS`, `FEED_LIMIT`, `toItem`, `tidy`, `AlertsPill` |
| `src/shell/alertTypes.ts` | 226 | `ALERT_TYPES`, `TYPE_BY_ID`, `readShown`/`writeShown`, `fetchMasterEnabled` |
| `src/App.tsx` | 249 | six `lazy()` bindings, seven routes, `MobileRedirect` + `PageVisitBeacon` mounts |
| `src/board/gexChart/GexChartCard.tsx` | 741 | the `simple` prop and the GEX profile |
| `src/board/multiGreek/MultiGreekCard.tsx` | 1289 | `singleColumn`, `pinnedFirst`, the ladder |
| `src/board/gexCandles/GexCandlesCard.tsx` | 2056 | `spxOnly`; the only card that calls `useIsPhone()` |
| `src/board/econCalendar/EconCalendarCard.tsx` | 536 | calendar + earnings week |
| `src/pages/Em.tsx` · `src/pages/em/emData.ts` | 504 · 333 | the moves page and its data layer |

---

## The design rule, and the one exception

`mobileNav.ts`, at the top: "**WHAT THE PHONE BUILD IS.** Six screens, each one a v3 HOME-BOARD CARD
or a v3 page rendered at full width inside `MobileShell` — not a phone-only rewrite of the same
numbers. […] Here the Heat tab IS `MultiGreekCard`, the GEX tab IS `GexChartCard`; a fix to the card
is a fix to the phone."

`AGENTS.md` adds the prohibition — "**Never add a mobile-only fetch, or a second component, for
something a card already computes** — make the card handle the width instead, as `GexCandlesCard` does
with `useIsPhone()`" — and on the exception: "`/m/alerts` is the one exception, and it is not a
loophole. […] on a phone the feed is not cramped, it is unreachable. A tab is the only door. […] If
you find yourself adding a second exception, check first whether the surface could be a card instead."

### Why there is no phone-only implementation of any number

Three mechanisms make it hold rather than being a good intention:

1. **The screens are three-line wrappers.** `MGex.tsx` is a `lazy()` import and one JSX element —
   nowhere to put a second calculation.
2. **The variation is a PROP, not a fork.** `simple`, `singleColumn`, `pinnedFirst` and `spxOnly` are
   declared and documented on the card, and change only what is *drawn* — never what is computed, and
   (with one noted exception) never what is stored.
3. **Width is not the trigger.** From `MultiGreekCardProps.singleColumn`: "Deliberately NOT
   `useIsPhone()` inside this component: the board can be looked at on a narrow desktop window, and a
   card that silently dropped two columns when someone resized their browser would be a bug nobody
   could describe. **The phone ROUTE asks for it; the width never does.**" `GexCandlesCard` is the
   exception and calls `useIsPhone()` — for the *hand*, not the screen: "a phone fork of a 700-line
   chart card is a second thing to fix every time."

---

## The registry — `mobileNav.ts`

A plain data module: "No React, no imports out of `src/design` or `src/data`. The tab bar, the route
table in `src/App.tsx` and the desktop→mobile redirect all read it, and none of them should drag a
page component into its bundle to do so."

`MobileTab` is `{ id, path, label, title, icon }` — `id` is "Stable id, and the last URL segment",
`label` "has ~58px — keep it to 5 characters", `title` "The longer name, used as the page's card
title".

| `id` | `path` | `label` | `title` | `icon` | Is |
|---|---|---|---|---|---|
| `gex` | `/m/gex` | GEX | Gamma Exposure | 📊 | `gexChart/GexChartCard` + `simple` |
| `heat` | `/m/heat` | Heat | Multi Greek | 🔥 | `multiGreek/MultiGreekCard` + `singleColumn` + `pinnedFirst="SPX"` |
| `spx` | `/m/spx` | SPX | SPX Candles | 🕯️ | `gexCandles/GexCandlesCard` + `spxOnly` |
| `em` | `/m/em` | Moves | Estimated Moves | ↔️ | `pages/Em`, unchanged |
| `econ` | `/m/econ` | Cal | Economic Calendar | 📅 | `econCalendar/EconCalendarCard` |
| `alerts` | `/m/alerts` | Alert | Signal Alerts | 🔔 | **the exception** — `mobile/pages/MAlerts.tsx` |

Also exported: `MOBILE_ROOT = '/m'`, `MOBILE_DEFAULT_PATH = '/m/gex'`, `tabForPath(p)` (exported,
used by nothing — the tab bar does its own comparison) and `isMobilePath(p)`, which is
`p === '/m' || p.startsWith('/m/')` and is what `Shell.tsx` branches on.

**Adding a tab is two edits** — append to `MOBILE_TABS`, add a `lazy()` `<Route path="/m/<id>">` in
`App.tsx`. The Next handler already covers it: "It is a ONE-segment dynamic route on purpose: a
catch-all under `/v3` would swallow `/v3/assets/*.js` and hand back HTML." Same trap as `AGENTS.md`'s
"Adding a page — FOUR steps, not three": miss the handler and the page works in-app but 404s on a hard
refresh or a shared link.

### The chain tab that was removed

There is a gap between `spx` and `em` filled with a comment rather than a tab:

> **NO CHAIN TAB (2026-09-03, removed the day after it landed).** The v3 options chain is a strike
> ladder with up to a dozen numeric columns read ACROSS; at 390px it is a horizontal scroll over a
> table you cannot see two columns of at once, which is not the page, it is a picture of the page. It
> stays a desktop screen until there is a phone DESIGN for it rather than the desktop one made narrow.
> `/v3/options-chain` is untouched.

v2's phone chain still answers, and `src/pages/Legacy.tsx` lists it under "Phone build" as
`/app/m/chain` with the same reasoning.

---

## The redirect rules — `MobileRedirect.tsx`

Mounted **once**, in `App.tsx`, inside `BrowserRouter` and above `<Shell>`: "Above the Shell because
it needs the router and nothing else, and `replace` so Back does not land on the route it just left."
Three rules, all of them v2's, "because the two builds have to behave the same way on the same
handset":

> 1. **Only routes in `DESKTOP_TO_MOBILE` redirect.** A desktop page with no phone counterpart keeps
> rendering its desktop layout — a cramped real page beats a redirect to an unrelated one. 2.
> **Desktop browsers are NEVER redirected away from `/m/*`**, so the phone build can be opened and
> tested on a laptop by typing the URL. 3. **`replace`, not `push`.** A redirect in the history stack
> means Back lands on the desktop route, which immediately redirects again — the classic
> trapped-Back-button bug.

Effect order: bail if not a phone → if the session opt-out is set → if already on `/m/*` → if the path
is not a key of `DESKTOP_TO_MOBILE`; otherwise `navigate(target + search, {replace:true})`, the query
string riding along because "it carries real state on some routes (`/em?ticker=…`)".

### `DESKTOP_TO_MOBILE` — three entries, one deliberate omission

`'/board' → '/m/gex'`, `'/traders-dashboard' → '/m/gex'`, `'/em' → '/m/em'`.

> **NOT `'/'`:** on voltick the landing page is the CARD TILES, and they are the point of the site on
> a phone as much as on a laptop. Redirecting `'/'` — which is what v3 does, because `'/'` there is
> the grid board — meant a phone opening `voltick.cbedge.net/v3` never saw the cards at all. It was
> bounced straight to the GEX screen, which reads as somebody else's app. The grid board keeps its
> redirect under its new path: a drag-and-drop grid really is unusable on a handset.

So Analysis, Flow, Replay, Scanner, Premarket, Whales, Chain, Options Chain, Level Log, Seasonality,
Legacy, Feedback, `/single` and the card gallery at `/` all render their **desktop** layout on a phone
— the rule, not an oversight.

**`MOBILE_TO_DESKTOP`** — where a long-press lands you: `/m/gex → /board`; `/m/heat`, `/m/spx`,
`/m/econ`, `/m/alerts` → `/`; `/m/em → /em`. On `/m/alerts`: "No desktop page of its own — the feed
lives in the toolbar, which is on every desktop route, so the board is the honest landing."
`MobileTabBar` falls back to `'/'` for a tab missing from the map.

### The session opt-out

`FORCE_DESKTOP_KEY = 'cb-v3-force-desktop'`, **sessionStorage**, value `'1'`, read by
`isDesktopForced()` and written by `setDesktopForced(on)`: "sessionStorage, not local: it is an escape
hatch for one look at the full board, not a setting. Private mode throws on both ends, and both ends
treat a throw as 'off', so the redirect simply stays on rather than the app failing to route." There
is **no UI to turn it back off** — it clears when the tab closes.

---

## Is this a phone? — `useIsPhone.ts`

```ts
export const PHONE_MAX_WIDTH = 820
const NARROW = `(max-width: 820px)`, COARSE = '(pointer: coarse)', NO_HOVER = '(hover: none)'
isPhoneViewport() = NARROW.matches && (COARSE.matches || NO_HOVER.matches)
```

> This is the one place that decides, so a card asks `useIsPhone()` rather than inventing its own
> width check — three cards with three different breakpoints is how a layout ends up half-converted.
> The test is v2's, deliberately: the two builds must agree about what a phone is or a device can be a
> phone to one app and a desktop to the other on the same screen. width alone → misclassifies a narrow
> desktop window · `pointer:coarse` alone → misclassifies a touchscreen laptop · width AND (coarse OR
> no-hover) → gets iPhone/Android right and leaves a resized browser alone.

Three separate `MediaQueryList`s rather than one `(A) and ((B) or (C))` string:

> boolean `or` inside a media query is Media Queries 4 and not old enough to rely on here, and **it
> fails CLOSED** — an unparseable query never matches, so the phone layout would simply never appear
> and nothing would say why.

The hook listens to `change` on all three — "a rotation changes the width match, and a phone plugged
into a mouse changes the pointer match without the width moving at all." SSR-safe.

---

## What the Shell keeps and what it drops

`Shell.tsx` branches on `isMobilePath(pathname)` once. The mobile branch is a `cb-viewport flex
flex-col overflow-hidden bg-bg text-fg` column holding `<Toolbar mobile />` and
`<ReplayDockHost>{children}</ReplayDockHost>`; the desktop branch is a `cb-viewport flex` row holding
`<Rail />`, a page column of `<Toolbar />` +
`<ReplayDockHost><ExpandStageHost>{children}</ExpandStageHost></ReplayDockHost>`, and `<NotesDockSlot
/>`.

> **`/m/*` keeps the TOOLBAR and drops the RAIL.** The rail is 64px of a 390px screen — a quarter of
> it, spent on a nav the bottom tab bar already is. The toolbar stays, and it is the SAME component
> the desktop draws […] The three providers below stay exactly where they are either way, which is the
> whole reason this is a branch inside `Shell` rather than a second shell component: the socket, the
> store, the page symbol and the auth read are **one instance for the session**, and a phone that
> mounted its own would open a second WebSocket the moment someone long-pressed back to the desktop.

Providers, outermost first: `AuthProvider` → `PageSymbolProvider` → `CopyShotProvider` →
`ToolbarSlotProvider` → `NotesPanelProvider`, with `<UpdateToast />` and `<NoteClipSlot />` above both
branches.

### The toolbar, item by item

One component with a `mobile` flag; `h-11` (44px), `border-b border-line bg-bg px-3 gap-3`.

| Item | On `/m/*`? | Why |
|---|---|---|
| `BzilaLogo` | kept | the brand, and the Bzila alert list |
| `AlertsPill` | **dropped** (`!mobile`) | "390px has no room for a headline" — the reason `/m/alerts` exists |
| `ToolbarSlotHost` | kept | empty on every phone route today |
| `BotAlertButton` | **dropped** (`!mobile`) | owner-only composer |
| `Chip` "SPX" + `TickerPicker` | **dropped** (`!mobile`) | see below |
| `OfferPill` | kept | draws nothing without an unredeemed offer |
| `EtClock` | kept | 1s tick, `America/New_York`, `hour12: false` |
| `RefreshButton` ↻ | **kept, deliberately** | "a stale panel is MORE likely there, where the tab has been backgrounded and hidden-tab polling is suppressed" |
| `CopyShotMenu` 📸 | kept | owner-only, and only once a surface publishes itself |
| `NotesButton` ✎ | **drops itself** | `if (!isSignedIn \|\| isPhone) return null` — by width, not by route |
| `UserMenu` | kept | the account dropdown, and the only door to `/v3/feedback` |

The ticker drop is the interesting one, and the comment is dated:

> **NOT ON THE PHONE BUILD (2026-09-03).** These two set the BOARD's symbol, and on `/m/*` nothing
> reads it: the GEX chart, the Multi Greek ladder and the candles are each pinned to SPX for now (see
> the `simple` / `pinnedFirst` / `spxOnly` props on those cards). **A picker that moves a value no
> visible card follows is a control that lies**, which is the one thing this toolbar was rebuilt to
> stop being. Everything else here — the mark, the clock, the camera, the account menu — is the same
> bar the desktop draws, which is the point: the phone is v3, not a second app. When a phone screen
> follows a ticker again, delete the guard.

### Also dropped on `/m/*`, structurally

- **`ExpandStageHost`** is not in the mobile branch, so no card on a phone draws an expand button.
  Intended — `CardProps.expandable`: "The control draws nothing outside an `ExpandStageHost`, so the
  phone build, previews and tests need no opt-out." (On the desktop branch, dropping that wrapper is
  the bug that cost a Shell rewrite on 2026-09-03: "removing this line does not break loudly, it
  silently deletes the feature from the whole app.")
- **`NotesDockSlot`** — desktop branch only, so its `lazy()` chunk is never fetched on a phone.
  `NoteClipSlot` is mounted for both but renders nothing on a phone. **`ReplayDockHost` stays**, so a
  rewound surface still holds the bottom edge.
- **`?embed=1` is a third branch above both**, sticky per browsing context via
  `sessionStorage['cb-embed']` (`?embed=0` clears it): it drops the rail **and** the toolbar, so an
  embedded phone gets neither toolbar nor tab bar.

---

## The frame — `MobileShell.tsx`

Top to bottom: **header** ("ONE bar. Never two."), an optional **sticky** row ("chips or filters that
stay put while the body scrolls"), the **body** ("a scroll region (lists, forms) or a fixed fill
(charts)") and **`MobileTabBar`**, "fixed to the bottom edge, safe-area aware".

| Prop | Default | Meaning |
|---|---|---|
| `title` | — | with `chrome="card"` this *is* the Card's title |
| `right` | — | right-aligned header content (only `/m/alerts` uses it) |
| `sticky` | — | pinned under the header; `shrink-0 border-b border-line px-3 py-2` |
| `fill` | `false` | `true` = the body is exactly the remaining height and does not scroll |
| `chrome` | `'card'` | `card` wraps the body in a `Card`; `bare` renders it directly |

**Why the header is a Card header:**

> A board card publishes its controls through `<CardToolbar>`, which portals into the header of the
> `Card` it is mounted in — so if this shell drew its own title bar AND wrapped the card, the phone
> would show **two stacked bars**, one carrying a name and one carrying the buttons, and the chart
> underneath would lose ~60px of the ~600px it has. […] This header is the CARD's, not the app's, and
> nothing that belongs to the app (the brand, the clock, the account menu, the board's ticker) goes in
> it.

**The full-bleed override** is `<Card … fill flush style={{ borderRadius: 0, borderWidth: 0 }}>`:

> Every edge of the plate would be drawing a line something else already draws — the app toolbar's
> bottom border above it, the tab bar's top border below, the screen itself at the sides […] **Inline
> rather than an override class:** `Card` composes its own `rounded-md border` and the winner between
> two utilities of the same property is decided by stylesheet order, not by which class is written
> last, so a `rounded-none` here would work or not depending on how Tailwind happened to sort them
> that build.

**`fill`:** "A chart page must NOT scroll: a canvas that owns drag inside a scrollable column means
the user can neither pan the chart nor scroll the page reliably. Those pages take the exact remaining
height. List and form pages scroll normally." → `flex min-h-0 flex-1 flex-col overflow-hidden` vs
`overflow-y-auto`.

`/m/gex`, `/m/heat`, `/m/spx` and `/m/econ` are `chrome="card"` + `fill`; `/m/alerts` is `card`
without `fill`; `/m/em` is `bare` without `fill`.

And: "The ticker control is NOT here. It lives in the app toolbar above this shell […] One place
decides that; a second copy in this header would be a second place to forget."

---

## The bottom bar — `MobileTabBar.tsx`

Drawn by `MobileShell`, not by the app shell, "because a `fill` page has to know the bar's height to
take the exact remaining space — having the bar inside the same flex column is what makes that
arithmetic unnecessary."

A `<nav aria-label="Sections" class="shrink-0 border-t border-line bg-rail">` with `padding-bottom:
env(safe-area-inset-bottom, 0px)`, holding six `NavLink`s each `flex min-h-[52px] flex-1 flex-col
items-center justify-center gap-0.5 rounded-md px-0.5 py-1` — an `aria-hidden` glyph at `text-base`
over a `text-3xs font-semibold truncate` label.

- **`min-h-[52px]`** — "52px of height plus the safe-area pad clears the 44px tap target floor with
  room for the label under the glyph." Each tab is `flex-1`, so ~64px wide on a 390px screen.
- **The safe-area pad is not optional:** "The home indicator on a modern iPhone sits UNDER the
  viewport's bottom edge; without this the last row of tap targets is half-covered by it."
- **Active tint `text-accent`** — "the same accent the desktop rail uses for its active item, so the
  two builds light up the same way." Inactive: `text-muted opacity-60`. "Every colour here is a token
  class. No literal appears in this file."
- `touchAction: 'manipulation'` kills the double-tap-zoom delay; `WebkitTapHighlightColor:
  transparent` kills the grey flash.

**Long-press = Desktop site**, `LONG_PRESS_MS = 550`:

> There is no room for a seventh item and no appetite for a menu, so the escape hatch is a gesture:
> hold any tab for ~550ms and the phone build stands down for the session (sessionStorage) and you
> land on the desktop page that tab stands in for. A plain tap is unaffected — the timer is cleared on
> pointerup and the `NavLink`'s own click still fires.

`onPointerDown` arms it; `onPointerUp` / `onPointerLeave` / `onPointerCancel` clear it. On fire:
`setDesktopForced(true)` then `navigate(MOBILE_TO_DESKTOP[p] ?? '/', { replace: true })`.
`onContextMenu` is prevented so Android's long-press menu does not appear over the gesture, and
`onClick` swallows the click the same pointer sequence produces — "or we would land on the desktop
page and immediately be pulled back to the tab." Every tab's `title` is `` `${tab.title} — hold for
the desktop page` ``, which is the gesture's only discoverability, and a phone never shows a title
attribute.

---

## Screen 1 — `/m/gex`, Gamma Exposure

`<MobileShell title="Gamma Exposure" fill>` around `<GexChartCard simple />`, behind a `Suspense`
whose fallback is `<div className="min-h-0 flex-1" />`.

> It IS the home board's `gex-chart` card, mounted full-bleed. Not a phone-only copy of it: the card
> already measures its own container, backs its canvas at `devicePixelRatio` and reports visibility
> through `ChartFrame`, and a second renderer for the same numbers is the thing that made v2's phone
> build drift from its desktop within a week.

**`simple`** — "SPX only, OI+VOL / VOL only, one net bar, no DEX line and no stat row." Why each goes:

> · **FLOW** is a third basis whose answer is a different question, and the two that are left are
> the two anyone switches between. · **C/P** doubles the bar count in a plot ~380px wide; the
> split is a desktop read. · **DEX** is a second series on a second scale over that same plot. ·
> **CARDS** is ten tiles sharing the width of a phone — three characters each, and the chart loses
> the height they take.
>
> **The stored settings are NOT rewritten.** The same browser profile opens this card on a
> desktop and must find its basis, split, DEX and cards exactly as it left them; this only
> changes what is DRAWN, the way `railOn` already does on the candles card.

Render-time overrides: `symbol = SOCKET_SYMBOL` (`'SPX'`), `basis = stored.basis === 'flow' ? 'oi-vol'
: stored.basis`, `series = 'gamma-0dte'`, `split = 'net'`, `showDex = false`, `cardsOn = false`. On
the symbol: "Pinned, not defaulted: SPX is the only symbol the socket streams, and the phone screen is
meant to be the live one rather than a 15s chain poll." On the basis: "A stored FLOW does not survive
here — there is no third button to show it on, and a selected value with no control is the thing the
card's own comment calls a control that lies."

**Data path.** Because the symbol is pinned to the socket symbol this screen is always on the socket
and never on the chain poll.

| Source | What | Cadence |
|---|---|---|
| WS frame `gex` | `watchFrame<GexFrame>` → `{ gexRows, expiry }` | pushed; `server-v2` dedupes, so "no news" is silence, not a repeat |
| WS frame `spot` | `watchFrame<SpotFrame>` → `spot` | every tick, straight to the chart |
| `GET /api/chains?ticker=<T>&range=all&live=0` | off-socket fallback | `staleMs: 15_000, pollMs: 15_000` — **unreachable** while `simple` |

`TILE_SPOT_MS = 1000` throttles the stat tiles ("Chart every tick, tiles at most once a second") —
moot here, since `cardsOn` is false and `StatCards` (with its `/api/em-tracker?ticker=…` and
flow-history queries) never mounts. And because the off-socket early return "is what UNSUBSCRIBES,
which is also what narrows the socket's derived topic scope", `/m/gex` always contributes `gex` +
`spot` to the scope `npm run check:ws` derives.

**Storage:** `localStorage['cb-v3-gexchart:gex-chart']`, a JSON blob carrying `v: 1`. `simple`
overrides in memory only; `patch()` still writes `stored`, so nothing the phone does can corrupt the
desktop card's saved state.

**Status line**, `pointer-events-none absolute left-1 top-1 text-2xs text-muted opacity-50`:
**"Waiting for the feed…"** — the on-socket case, the only case here. The other strings in that
ternary (`Sweeping the board…`, `` `Loading ${symbol}'s chain…` ``, `Board sweep failed — <err>`, `Net
delta is zero at every strike — server-v2 predates the netDEX legs on this endpoint`) belong to series
and symbols `simple` cannot select.

---

## Screen 2 — `/m/heat`, Multi Greek

`<MobileShell title="Multi Greek" fill>` around `<MultiGreekCard singleColumn pinnedFirst="SPX" />`.

**`singleColumn`** — one expiry column, the front one, which on SPX is 0DTE; no ex-0DTE total; and the
Columns section of the cog hidden with it, "because a control that cannot move the thing it names is
worse than no control."

> The card's reason to exist is the ACROSS read — the same strike on several symbols at the same DTE —
> and at 390px three expiry columns per panel is three unreadable columns and no across read at all.
> One column plus the ＋ button is the same question asked in the width that is actually there. **It
> does not write to storage.** A phone visit must not come back as a one-column board on the desktop
> next time.

Implementation: `colCount = singleColumn ? 1 : storedCols`, `showEx0 = singleColumn ? false :
storedEx0`. `MAX_EXP_COLS = 3` (`mgMath.ts`), and a stored value is clamped to `[1,3]` on read — "A
blob written before the split stored 4 here; it clamps to 3, which is the same number of expiry
columns that setting ever actually drew."

**`pinnedFirst="SPX"`** — panel one is that symbol, always, and its ticker is not typeable:

> On the board, panel one IS the page symbol and typing in it moves the whole board […] On the phone
> build nothing else is reading it, and the header's picker is hidden there for that reason, so **a
> typeable panel one would be the last surviving way to move a value with no other visible
> consequence.** Pinned to SPX instead; the ＋ button is the only way symbols come in, which is the one
> that adds rather than replaces.

Three landing points: `pageSymbol = pinnedFirst.toUpperCase()` (so the dedupe, the ＋ refusal and the
panel list all agree), `commitTicker(0, …)` returns `false` immediately, and `editable={!(i === 0 &&
pinnedFirst)}`. **Panels:** 1–4 — panel one plus `MAX_EXTRA_PANELS = 3`; "the panel row scrolls
sideways once there are more than two", and a duplicate is refused because "the same ticker twice does
not add a comparison — it removes one, silently."

**Data path**, all `useQuery`:

| Request | Per | Options |
|---|---|---|
| `GET /api/chains?ticker=<T>&range=all&live=0` | **each panel** | `staleMs: 15_000, pollMs: 15_000` |
| `GET /api/chains?ticker=SPX&range=all&live=0` | the card, as the strike anchor | `staleMs: 15_000`, no poll |
| `GET /api/mult-greek-gex-change?ticker=&expiry=&strike=` | the tapped-cell card only | `staleMs: 30_000, pollMs: 60_000` — "A minute, matching the recorder's own cadence" |

`live=0` is load-bearing, and it costs SPX the socket:

> The chain adapter serves the subscribed underlying from the live socket subscriber, which streams a
> single expiration and its panel was stuck at one column no matter what the board was set to, while
> SPY/QQQ/NDX fell through to REST and got three. The flag opts this caller out of that fast path […]
> It costs SPX the live path, which is the right trade here: the panel polls on a 15s cadence anyway
> and the REST response is the only one with the columns.

So `/m/heat` is **REST-only** and opens no socket topics at all. Four panels is four requests every
15s, visibility-gated by `useQuery`'s default: "Polling stops while the tab is hidden — a background
tab refetching a chain every 15s is pure egress nobody is looking at."

**Storage keys** (all `localStorage`): `cb-v3-mg-extra-tickers` (JSON array), `cb-v3-mg-tickers`
(legacy, read for migration), `cb-v3-mg-col-count`, `cb-v3-mg-ex0`, `cb-v3-mg-basis`
(`"oivol"`/`"vol"`), `cb-v3-mg-near-core`, `cb-v3-mg-near-core-pct`. `singleColumn` overrides the
col-count and ex0 values for this mount only and writes nothing back.

**Empty states**, `px-1 py-3 text-xs text-muted opacity-50`, one of four: `Chain unavailable` ·
`Waiting for the chain…` · `` `No ${ticker} price — GEX needs the spot` `` · `No strikes`.

---

## Screen 3 — `/m/spx`, SPX Candles

`<MobileShell title="Candles" fill>` around `<GexCandlesCard spxOnly />`. Note the shell title is
**"Candles"** while the tab's `title` is **"SPX Candles"** — the tooltip and the visit beacon use the
latter.

**`spxOnly`** pins to `SPX_ONLY_SYMBOL = 'SPX'`, "The one root with both a cash tape and a future."
Two things, and they are the same thing:

> · The card stops following the board's ticker and charts SPX. The SPX/ES switch is `esCapable`,
> which is true only on SPX, so pinning the symbol is what makes that switch the **ONLY symbol control
> on the screen** […] it is also the only pair the phone has a live feed for. · **SESSION STOPS BEING
> A SETTING.** ES trades nearly around the clock, so it is ETH; SPX cash does not exist outside
> 09:30–16:00 ET, so RTH on it is not a filter, it is the whole tape — an SPX chart on "ETH" and the
> same chart on "RTH" are the same picture, and a button that changes nothing is a button that teaches
> you it does nothing. The stored `session` is left alone, like `railOn`.

Derived: `session = spxOnly ? (useEs ? 'eth' : 'rth') : settings.session`. `MSpx.tsx` adds: "The tab
is called SPX rather than ES because the cash index is what it opens on; the future is the switch."

**The phone layout the card does for itself** — three differences, "all of them about the hand rather
than the screen size":

> · The toolbar becomes ONE button and everything moves into a bottom sheet. The desktop toolbar is
> five controls at 10px; on a 390px card it wraps to three rows of ~18px targets, eats a third of the
> chart's height to do it, and still cannot be hit reliably. · The GEX rail is off — a fixed-width
> column beside the chart, affordable at 900px, a quarter of the plot at 390. · The overlays move in
> off the rail's old gutter and grow to a real tap target.

`railOn = settings.railOn && !phone` — read-only, "a phone must not REWRITE it". Controls become
`size="touch"` (`min-h-[34px] px-3 py-1.5 text-sm`); the replay brand insets move to `right: 44 /
bottom: 26` from `68 / 30`; the reset-zoom button becomes `h-9 w-9` at `bottom-6 right-3` instead of
`h-7 w-7` ("28px is a mouse target"). The **tape switch stays in the header on a phone** (`{phone ?
tapePicker : tapeMenu}`) while interval and session fold into the sheet — and with `spxOnly` the
session section is not rendered at all.

**Data path**, five requests:

| Request | When | Options |
|---|---|---|
| `GET /api/snapshots/etf-candles?symbol=<key>&days=<n>&interval=<i>` | SPX cash tape | `staleMs: 25_000, pollMs: 30_000, background: isOwner` |
| `GET /api/snapshots/candles?daysBack=<n>&limit=20000&interval=<i>&lite=1` | ES tape | same |
| `GET /proxy/es-spx-basis` | **ES only** (`useQuery(null)` otherwise) | `staleMs: 300_000, pollMs: 1_800_000` |
| `GET /api/expirations?ticker=<chainTicker>` | always | `staleMs: 300_000` |
| `GET /api/snapshots/option-strike-gex-history?mode=heatmap&minutes=720&expiry=<e>&symbol=<s>&top=30` | bubbles, rail **or** level labels on, and an expiry known | `staleMs: 30_000, pollMs: 60_000, background: isOwner` |

Constants: `HISTORY_DAYS = 5`, `REPLAY_CANDLE_DAYS = 7`, `GEX_HISTORY_MINUTES = 720`,
`BUBBLE_LADDER_REQUEST = 30`. On the gex-history cadence: "The recorder writes a column a minute, so
asking more often than that returns the same ladder twice — and it is the heaviest request the card
makes."

`background: isOwner` is the one sanctioned hidden-tab poll: "a chart nobody is looking at is egress
for nothing. It is wrong for the owner, whose chart is the SESSION'S RECORD — a bubble that did not
form because another tab was up for ten minutes is a ten-minute hole in it, and the catch-up poll on
return does not fill a hole, it only draws the newest column."

**The live price never goes through React** — `watchFrame<SpotFrame>('spot')` pushes into the chart
handle, which is non-negotiable 4. On a symbol with no futures tape (`httpLive = !esCapable &&
!replayOn`) the card opens an `EventSource` with an HTTP probe under it that fires only after
`LIVE_QUIET_MS = 8_000` of silence, and deliberately has no `onerror` that closes it ("closing it here
would turn one dropped connection into a permanent downgrade to polling"). On `/m/spx` `esCapable` is
always true, so that path never opens.

**Storage:** `localStorage['cb-v3-gex-candles:gex-candles']`, blob version `v: 7`. `session` and
`railOn` are overridden in memory; `esCandles` — the tape switch — **is** written, so flipping to ES
on the phone flips the board's card. Intent, per `mobileNav.ts`: "the switch is the card's own
`settings.esCandles`, so the phone and the board agree."

**Status lines:** `Loading…` while loading and empty; `` `No candles recorded for ${tapeLabel} yet.`
`` when loaded and empty; the candles query's error message in `text-down`; and, in `text-warn`,
`ES−SPX basis unavailable (<reason>) — GEX levels are drawn at SPX cash strikes.` — because "An
unshifted ES layer looks exactly like a shifted one until you notice every wall is 50 points under
where price is reacting. Say it." `<reason>` is the query's error message or the literal `route has no
usable basis, no live pair yet`, and the line is gated on `basisQ.error != null || basisQ.data !==
undefined`: "the moment before the first response would otherwise flash the warning on every switch to
ES."

---

## Screen 4 — `/m/em`, Estimated Moves

The shortest screen (21 lines) and the only `chrome="bare"` one: `<MobileShell chrome="bare">` around
a `Suspense`-wrapped `<Em />`.

> The v3 page, unchanged. It is already a single 720px-max column that scrolls, which is a phone
> layout that happens to also work on a desktop, and it carries its OWN ticker box — so the shell adds
> no header and no symbol control here. Both would be a second way to set the same thing.

With `chrome="bare"` and no `title`/`right`, `MobileShell`'s `{(title || actions) && …}` guard is
false and **no header renders at all**: the screen is app toolbar → page → tab bar. `fill` is false,
so the page scrolls; the page's own column is `mx-auto flex w-full max-w-[720px] flex-col gap-4
pb-12`.

**Data path** (`pages/em/emData.ts`) — REST-only: "This page opens no socket and mounts no canvas: it
is REST-only, so non-negotiables 4, 5 and 6 have nothing to bite on here."

| Request | Stale window |
|---|---|
| `GET /api/levels?ticker=<T>` | `LEVELS_STALE_MS = 10_000` |
| `GET /api/em-zones?ticker=<T>` | `LEVELS_STALE_MS` — the zones fallback |
| `GET /api/em-tracker?ticker=<alias>` (once per alias) | `ENRICH_STALE_MS = 60_000` |
| `GET /api/em/ticker-em-stats?ticker=<T>` | `ENRICH_STALE_MS` |
| `GET /api/em-tracker` | `ENRICH_STALE_MS` |
| `GET /api/em-tracker/history` | `ENRICH_STALE_MS` |
| `POST /api/ticker-event` | `sendBeacon`, `{ ticker, event: 'click', source: 'em' }`, fire-and-forget |

**The one deliberate departure from v2** is non-negotiable 3 being enforced:

> v2 awaits `/api/levels` and only THEN fires the four enrichment requests, even though not one of
> them needs anything from the levels row — every URL is built from the symbol, which is known on the
> first line. That is a two-stage waterfall, and v3's non-negotiable 3 forbids it. Here the enrichment
> wave is started BEFORE the levels read is awaited. **Same requests, same results, one round trip
> less.**

A second, smaller one: v2 reads `/api/levels` with `cache: "no-store"`; v3 goes through `query()` with
a 10s stale window "so the rail's `preload('/api/levels?ticker=SPX')` on hover actually pays for
itself."

Four business rules a rewrite would lose, all transcribed from v2 rather than re-derived: the ESU/ESM
+ NQU/NQM alias fan-out; the win-rate merge of the static verified history with the live `em_tracker`
table (`total` vs `evaluated`); the zones fallback chain; and — the one that bites — **EM values
arrive as comma-formatted strings**, so `parseFloat("7,711.76")` is `7`. And one removal that must
stay removed: `/api/confidence` and its "CB Confidence" tile, because the route returns an object
where the reader expected a scalar, so the tile "never rendered on any surface, ever" while costing "a
120-session server-side scan per lookup". Full detail in `page-em.md`.

**Controls:** the page's own ticker box plus `POPULAR` chips — `SPX NDX ESU NQU SPY QQQ AAPL NVDA TSLA
MSFT`. State is the **query string** (`?ticker=`) via `useSearchParams`, which is why `MobileRedirect`
carries `search` across the `/em` → `/m/em` hop. There is no per-page screenshot button — "there is
one camera in this app and it lives in the toolbar", and the toolbar is drawn on `/m/*`, so the
owner's 📸 still works; the page publishes its result block to that menu once a lookup has happened.

---

## Screen 5 — `/m/econ`, Calendar & Earnings

`<MobileShell title="Calendar & Earnings" fill>` around `<EconCalendarCard />` — the only screen that
passes **no props at all**.

> `fill` because the card scrolls INSIDE itself — it is built to sit in a board slot of a fixed height
> and keep its own filter row pinned — so an outer scroll would give the screen two scrollbars and
> detach that row from the rows it filters. No ticker control: the calendar is not a per-symbol
> surface, and **a picker that changed nothing on screen would be a control that lies.**

Again the shell title (`Calendar & Earnings`) differs from the tab `title` (`Economic Calendar`) and
`label` (`Cal`). **Data path:** `GET /api/calendar` and `GET /proxy/earnings-week`, both `staleMs:
600_000` (10 min) with **no poll**, plus a raw `fetch('/api/calendar-quote', { cache: 'no-store' })`
in `econTemplate.ts`. Instead of polling there is a **one-minute clock**, visibility-gated:

> Moves rows from ahead → past. Not a refetch: the calendar is a weekly file and re-pulling it every
> minute would be a lot of bytes for no new events. […] Left ungated it re-rendered this card — the
> week's calendar plus the earnings table — **once a minute forever in a background tab.** The
> `visibilitychange` handler snaps it current the moment the tab comes back, so nothing is ever stale
> on screen.

On a phone that matters more than on a desktop: backgrounded is the normal state of a phone browser.
**Controls and storage:** the filter menu, persisted at `localStorage['cb-v3-econ-filters']` as a JSON
array of strings, defaulting to `['all-usd', 'trump', 'earnings']`; a non-array or empty value falls
back to the default. **Status lines**, `px-2.5 py-3 text-xs text-muted opacity-60`: `Loading…` and
`Nothing left today.`

---

## Screen 6 — `/m/alerts`, Signal Alerts — the exception

`<MobileShell title="Signal Alerts" right={count} sticky={chips}>` — **not** `fill`: "this is a list,
it owns no drag gesture, and it scrolls." The only screen that uses `right` and `sticky`.

> **NOTHING IS RE-IMPLEMENTED.** The three things that could drift are all imported: the **POLL**
> (`useAlertsFeed`), the **CATALOGUE** (`ALERT_TYPES` / `TYPE_BY_ID`, "so a new detector added to
> `alertTypes.ts` appears here the same build it appears there") and the **STATE**
> (`readShown`/`writeShown` and `fetchMasterEnabled`, "so a filter set on the desktop is the filter
> this screen opens with"). What is local is **LAYOUT ONLY**: a dropdown anchored to a toolbar button
> cannot be a full-height screen, and a 390px column wants bigger rows than a menu.

All three imports are already in the **entry chunk**, so `App.tsx` notes: "this route's own chunk is
layout and nothing else."

**The catalogue** — `ALERT_TYPES`, seven entries of `{ id, short, name, hint, tag, color, serverKey
}`:

| id | chip | name | tag | colour token | `serverKey` |
|---|---|---|---|---|---|
| `flip` | Flip | GEX Flip Cross | FLIP | `VIOLET` → `--color-violet` `#b48cff` | `flip_cross` |
| `coreChange` | Core ± | Core level change | CORE ± | `T.cyan` → `--color-accent` `#2f6bff` | `core_change` |
| `coreTouch` | Core | Core level touch | CORE | `LEVEL_COLORS.cb` → `--color-level-cb` `#ffd166` | `core_touch` |
| `ibFormed` | IB | Initial Balance Formed | IB | `LIGHT_BLUE` → `--color-series-5` `#7fb0ff` | `ib_formed` |
| `ibBreak` | IB Brk | Initial Balance Break | IB BRK | `T.orange` → `--color-warn` `#ffd166` | `ib_break` |
| `whale` | Whale | Whale Option Prints | WHALE | `LEVEL_COLORS.pw` → `--color-level-pw` `#ff5fa2` | `whale_print` |
| `gexChangeTop` | GEX | Top GEX Change | GEX CHG | `T.green` → `--color-up` `#3ddc8e` | `gex_change_top` |

"COLOUR IS THE CATALOGUE'S JOB, and it is borrowed rather than invented: GEX A takes the call-wall
blue and GEX B the put-wall red, so an alert in the feed is the same colour as the line on the chart
that fired it." `short` is tight on purpose — "all eight chips plus 'All' have to sit on one row of a
28rem panel without the last one being clipped, so this is the field to shorten if a ninth type is
ever added." `whale`'s hint, `≥ $1M premium, OTM, under 90 DTE`, is not just a definition: the engine
reads `/v3/whales`'s own endpoint with those filters, "so an alert can always be found on that page."

**The poll:** `FEED_POLL_MS = 20_000`, `FEED_LIMIT = 50` → `GET /proxy/signals?limit=50`, `cache:
'no-store'`, `credentials: 'same-origin'`, response `{ rows: SignalRow[] }` already newest-first.
`toItem` maps each row and **drops any whose `kind` is not in `ALERT_TYPES`** — "a new detector
shipping server-side shows up here the moment its type is added to `alertTypes.ts`, and never as a
colourless row nobody can filter." Visibility-gated: "a parked dashboard should not be a request every
twenty seconds all night." The identity guard `sig = "<length>:<newest id>"` returns early on an
unchanged signature, because "A poll that found nothing new must not hand React a new array — a new
array is a new render of the pill and the open panel every 20 seconds, which is the other half of the
flashing." On failure it keeps what is on screen: "an empty toolbar is a worse lie than a slightly
stale one."

**The master switchboard:** `GET /proxy/signal-alerts` → `{ alerts: [{ key, label, group, enabled }]
}`, asked **once per mount**, no poll. "Readable by any paid account […] the matching POST is
owner-only, which is why nothing in the dashboard ever writes to it. A kind missing from the response
is treated as ARMED." `master` is `null` until it answers, and `isLive = (id) =>
master?.[TYPE_BY_ID[id].serverKey] ?? true` — "null means 'assume armed' — a dropped connection must
never read as 'CB Edge turned everything off'."

**The filter chips** sit in the `sticky` row, scrolling sideways with the bar hidden (`overflow-x-auto
[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`). `CHIP` is `shrink-0 cursor-pointer select-none
whitespace-nowrap rounded-full border px-2 py-[3px] text-3xs font-bold uppercase tracking-wide
outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent
disabled:cursor-not-allowed` — "28px tall, which clears the 44px tap floor once the row's padding is
counted, and the row scrolls sideways because eight chips will not fit 390px — unlike the desktop
panel, where the one-row-fits-all sizing is the whole point." (The desktop panel's chip is `px-1.5
py-[2px]`; that is the only visual divergence between the two chip rows, and it is intentional.)

**All** toggles everything — `allShown` is computed over *live* types only, but `setAll` writes
`ALERT_TYPES.map(t => t.id)`, all seven. **Per type**, on: border and ink `t.color`, background
`alpha(t.color, 0.11)`; off: `borderColor: T.border`, `color: T.text`, `line-through`, plus `opacity:
0.5` when not live, `disabled`, and `title="Switched off by CB Edge"`.

State is `localStorage['alerts:shown']`, a JSON array of `AlertKind` ids filtered on read against
`TYPE_BY_ID`; absent means **all ids**. "There is no 'armed' set any more — arming is the owner's
switchboard, not a browser preference. (`alerts:armed` may still be sitting in older browsers; it is
simply never read.)"

**The header count** (`right`) renders only when something is visible: `rounded-full bg-warn px-1.5
text-3xs font-bold leading-[15px] text-bg` — `#ffd166` with `#0a0d10` ink.

**A row** is `<li class="flex gap-2.5 border-b border-line px-3 py-2.5">` with `style="box-shadow:
inset 2px 0 0 0 <type colour>"`: a baseline line of the ticker (`text-base font-bold tracking-tight`,
in the type's colour), the title (`truncate text-base font-semibold text-fg`) and the ET clock pushed
right (`ml-auto text-3xs tabular-nums text-fg opacity-80`); then `{text}` at `text-xs leading-snug
text-fg opacity-90` and an optional `{meta}` at `text-2xs tabular-nums text-fg opacity-70`.

> A phone row is read, not hovered. More vertical padding than the desktop menu gets, and the type's
> colour carried on a **left edge rather than a 6px dot** — at arm's length the bar is the thing you
> sort the list by. […] Same order as the desktop panel: ticker first, title biggest, the detector's
> sentence underneath it.

The strings are entirely `toItem`'s work in `AlertsFeed.tsx`, and the phone inherits four fixes
verbatim: **`tidy()`** rebuilds the detector's concatenated text segment-by-segment around `·`, so `"A
·  · B"` becomes `"A · B"` rather than losing the separator ("a single regex pass over the whole
string cannot tell a dangling dot from a valid one, because both are `" · "`"); **the ticker is
stripped from the title** so `"QQQ · Whale put buy — QQQ 690P"` never prints the symbol twice, and
`whale` also loses its leading "Whale "; **the level is never printed twice** — `level_name` is often
already `"MU 1005"` and appending `level_spx` produced `"MU 1005 1005"`, and a zero or missing value
is dropped rather than printed as `"0"`; and **`row.score` is deliberately not drawn** — "on no scale
the reader has been given — 'score 5' answers nothing you can act on, and a number with no units
beside a real price reads as if it were one."

**Empty states — three, and naming which is the job.** `items.length === 0` → **"No signals yet
today."**; else `liveTypes.length === 0` → **"Every signal is switched off by CB Edge right now."**;
else **"Nothing matches those filters."** Drawn as `px-4 py-10 text-center text-xs text-fg
opacity-80`. "Three different empty screens, and saying WHICH is the whole job of the line."

**The footer**, `mt-auto flex items-center border-t border-line bg-surface2 px-3 py-2 text-3xs
uppercase tracking-wide text-fg opacity-80`: **"Polls every 20s"** on the left; on the right **"Synced
with CB Edge"** when `master` is non-null, else **"Saved in this browser"**. "Same footer line the
desktop panel carries […] it says whether the filter row is a local preference or the engine's own
state talking."

---

## Rendering — tokens, hex and layout constants

Every colour on every phone screen is a token (non-negotiable 1), resolved from
`src/design/tokens.css`:

| Class / `T.*` | Token | Hex |
|---|---|---|
| `bg-bg` (Shell, toolbar) · `bg-rail` (tab bar) | `--color-bg` · `--color-rail` | `#0a0d10` |
| `bg-surface` (Card plate) | `--color-surface` | `#0e1216` |
| `bg-surface2` (alerts footer) | `--color-surface2` | `#141a21` |
| `bg-raised` | `--color-raised` | `color-mix(in srgb, #141a21 92%, #e7ece9)` |
| `border-line` · `T.border` | `--color-line` | `#1e2630` |
| `text-fg` / `text-muted` · `T.text` | `--color-fg` / `--color-muted` | `#e7ece9` |
| `text-faint` | `--color-faint` | `#c0c5c3` |
| `text-accent` (active tab) | `--color-accent` | `#2f6bff` |
| `bg-warn` / `text-warn` | `--color-warn` | `#ffd166` |
| `text-down` | `--color-down` | `#ff6b7a` |

Type scale: `text-3xs` 9px (tab labels, chips, timestamps, footer), `text-2xs` 10px (a row's meta
line), `text-xs` 11px (a row's sentence, empty notes, card status lines), `text-sm` 13px (card titles,
`touch` controls), `text-base` 15px (tab glyphs, the ticker and title in an alert row). `bg-rail` and
`bg-bg` are the **same hex today** — the tab bar reads as separate because of `border-t border-line`,
not because of its fill.

| Thing | Value | Source |
|---|---|---|
| Phone test | `max-width: 820px` **and** (`pointer: coarse` or `hover: none`) | `useIsPhone.ts` |
| Viewport height | `height: 100vh; height: 100dvh` (`.cb-viewport`) | `tokens.css` |
| App toolbar | `h-11` = 44px | `Shell.tsx` |
| Card header | `h-8` = 32px, `nowrap`, `cb-bar` scrolls sideways | `Card.tsx` |
| Tab target | `min-h-[52px]` + `env(safe-area-inset-bottom, 0px)` | `MobileTabBar.tsx` |
| Tab label budget | "~58px — keep it to 5 characters" | `MobileTab.label` |
| `touch` control | `min-h-[34px] px-3 py-1.5 text-sm` | `Controls.tsx` |
| Long press | `LONG_PRESS_MS = 550` | `MobileTabBar.tsx` |
| Alerts chip / row | `px-2 py-[3px]` ≈ 28px · `px-3 py-2.5` + 2px inset bar | `MAlerts.tsx` |
| Em column | `max-w-[720px]`, `pb-12` | `Em.tsx` |
| Reference width | 390px is the number every comment reasons against | throughout |

Height arithmetic on a `fill` screen: `100dvh` − 44px toolbar − 32px card header − (52px + safe area)
tab bar ≈ the chart's box — which is why the "two stacked bars" problem `MobileShell` solves was worth
~60px of ~600px.

---

## Performance and bundle

- **Every screen is `lazy()`**: "each one is a thin wrapper whose real weight is the chunk the card
  already has, so a phone downloads the card it is looking at and nothing else." Each also
  re-`lazy()`s the card inside itself, with a `.then` remap because cards are named, not default,
  exports; the board's catalog splits the same chunks, so a user who already opened the card there
  pays nothing. **`/m/alerts` is the cheap one** — `useAlertsFeed`, `ALERT_TYPES`, `readShown` and
  `fetchMasterEnabled` are already in the entry chunk — and **`mobileNav.ts` is deliberately
  import-free**, so pulling the tab list into `Shell.tsx`, `App.tsx` and `pageVisit.ts` drags no page
  component along.
- **Budgets** (`budgets.json`, brotli bytes): `entry` **38900**, `react` **55000**, `route` **59100**,
  `data` **78000**, `css` **8500**, `html` **2600**, `totalInitial` **108400** — the last is what
  matters most on a handset, being what a phone on a cell connection downloads before anything paints.
  The `data` line covers `data-seasonality` only; no phone route touches it. `"ratchet": { "slack":
  0.15, "enforce": false }` reports a budget more than 15% under as SLACK; pull it down with `npm run
  budgets:ratchet` rather than leaving headroom that enforces nothing.
- **`npm run perf`** limits: `idleRepaintsPerFrame` **0.15**, `offscreenRepaints` **0** ("a card
  scrolled out of view must not paint at all"), `interactionRepaints` **10** ("a gate that suppressed
  everything would pass every other line here"). All three chart screens inherit the board card's
  `ChartFrame` visibility handling and its `data-cb-layer` tag, so the phone build needs no separate
  perf story.
- **The phone is more sensitive to a background poll than anything else**, which is why every gate
  matters here most: `useQuery`'s default (`background: false`), `useAlertsFeed`'s `if
  (!document.hidden)` and `EconCalendarCard`'s clock gate are all doing the same job.
- **The visit beacon covers the phone** — `PageVisitBeacon`, mounted once in `App.tsx`, "covers every
  route including the phone build at `/v3/m/*`", which matters because before it existed "in the 30
  days to 2026-09-14 that was 5,254 visit rows and exactly ONE `/v3/*` row." `labelFor()` falls back
  to `MOBILE_TABS`, so `/m/heat` logs as "Multi Greek", not a path.

---

## Gotchas

1. **`AGENTS.md`'s phone table is stale** — it says "Six screens" and then lists **seven** rows,
   including `/m/chain` → `pages/OptionsChain`. `MOBILE_TABS` has no chain tab; it went on 2026-09-03.
   The registry is the truth.

2. **`Legacy.tsx` says "v3 five" phone tabs.** It ships six; the comment predates `/m/alerts`. Its two
   entries (`/app/m/chain`, `/app/m/prep`) are still correct.

3. **Three stale comments around the alerts feed.** `alertTypes.ts` still says "The feed ROWS are
   still placeholder (`SAMPLE` in `AlertsPanel.tsx`)" and `Shell.tsx` still says the pill is "NOT
   WIRED to any feed yet (placeholder rows)" — both fossils; `AlertsPanel.tsx` says "THE ROWS ARE REAL
   […] The placeholder SAMPLE list that used to live in this file is gone" and `AlertsFeed.tsx` dates
   it, "THE FEED IS LIVE (2026-09-15)". And `AlertsFeed.tsx` still describes "the Settings tab", which
   `AlertsPanel.tsx` removed: "ONE TAB, deliberately […] **It is gone.**" `MAlerts.tsx` never had one.

4. **No expand button on any phone card** — the mobile branch of `Shell` omits `ExpandStageHost`.
   Intended; if you ever want one, the wrapper is what to add.

5. **Three screens show a header title that differs from their tab's `title`:** `/m/spx` shows
   "Candles" (tab: "SPX Candles"), `/m/econ` "Calendar & Earnings" (tab: "Economic Calendar"), `/m/em`
   nothing at all. The tab `title` is what the tooltip and the visit beacon use.

6. **`/` is deliberately not redirected** — a phone opening `voltick.cbedge.net/v3` gets the card
   tiles, not `/m/gex`. Re-adding `'/'` to `DESKTOP_TO_MOBILE` reintroduces the bug the comment
   describes.

7. **The session opt-out has no off switch.** `cb-v3-force-desktop` clears only when the tab closes;
   "close the tab and reopen it" is the whole remedy.

8. **`setAll` on the alerts chips writes every id, including dead ones**, so a type CB Edge later
   re-arms comes back already shown.

9. **`/m/heat` is REST-only even on SPX.** `live=0` opts out of the socket-backed fast path
   deliberately — that path streams a single expiration, and the ladder is read across expiries. Four
   panels = four requests every 15s.

10. **`/m/spx` writes `esCandles` to shared storage.** Unlike `session` and `railOn`, the tape switch
    is a real saved setting under `cb-v3-gex-candles:gex-candles`, so flipping to ES on a phone flips
    the desktop board card. Documented intent.

11. **The `MAlerts` chip comment's arithmetic is loose** — the chip alone is under 44px; only the
    row's `py` gets it there. Do not shrink the sticky row's padding without re-reading that sentence.

12. **`MobileShell` renders the tab bar**, so anything that bypasses the shell loses navigation
    entirely. `?embed=1` does exactly that, deliberately.

13. **`useIsPhone` is one definition and must stay one.** `PHONE_MAX_WIDTH = 820` is shared with v2's
    test on purpose: "the two builds must agree about what a phone is or a device can be a phone to
    one app and a desktop to the other on the same screen." A second breakpoint anywhere is a
    half-converted layout.

14. **Never add a mobile-only fetch.** If a phone screen needs a number a card already computes, make
    the card handle the width — `GexCandlesCard` is the worked example. The prop is the seam; a second
    component is not.

15. **A catch-all Next route under `/v3` is never the fix for a 404.** It would swallow
    `/v3/assets/*.js` and hand back HTML. `app/v3/m/[tab]/route.ts` is one bounded dynamic segment,
    which is exactly why it is safe.
