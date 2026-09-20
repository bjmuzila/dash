# `/legacy` — the v2 door

**Route:** `/legacy` inside the SPA, `https://voltick.cbedge.net/v3/legacy` on the wire
(`BrowserRouter basename="/v3"`, `src/App.tsx`).
**Mounted by:** `const Legacy = lazy(() => import('@/pages/Legacy'))` →
`<Route path="/legacy" element={<Legacy />} />` in `src/App.tsx`.
**Reached from:** the last icon in the left rail — `{ to: '/legacy', label: 'v2 Legacy', icon: '🗄️' }`
in `NAV`, `src/shell/Shell.tsx`.

**Sources**

| Path | Role |
|---|---|
| `src/pages/Legacy.tsx` | the whole page — the three lists, the row, the copy |
| `src/App.tsx` | the `lazy()` route, and the authoritative list of what v3 *does* answer |
| `src/shell/Shell.tsx` | `NAV` — the rail entry, and the icon set this page is the honest replacement for |
| `src/design/primitives/Page.tsx` | the page frame (`title`, scroll column) |
| `src/design/primitives/Card.tsx` | the three section plates |
| `src/design/tokens.css` | every colour on the page |

---

## What it is, in one paragraph

v3 is served at `/v3/*` and v2 at `/app/*`, both running at once, and `AGENTS.md`
is explicit that **"there is no cutover day."** That leaves a gap nobody had a
page for: a surface that exists in v2 and has no v3 route yet is, from inside
v3, completely invisible. The rail cannot carry it — an icon that leaves the SPA
is not a rail item — and `App.tsx`'s no-catch-all rule means a link to an unbuilt
v3 route lands on `NotFound` rather than on anything useful. `/legacy` is the one
page that answers the question: a static, three-section list of every v2
destination v3 does not have a route for, each entry a real `<a href="/app/…">`
out of the SPA into the v2 app. It is not a "coming soon" list — **every link on
it works today**, one path segment away. It fetches nothing, opens no socket,
mounts no canvas, and shrinks by one row every time a page lands in v3.

---

## File map

Line counts are `wc -l` as the tree stands.

| File | Lines | What it owns |
|---|---:|---|
| `src/pages/Legacy.tsx` | 182 | `V2_BASE`, the `LegacyLink` shape, the three arrays (`NOT_IN_V3`, `PARTIAL`, `PHONE_ONLY`), `LinkRow`, `LinkList`, the default export `Legacy` |
| `src/App.tsx` | 249 | the `lazy()` binding, the `<Route>`, and the header comment recording why the page exists at all |
| `src/shell/Shell.tsx` | 739 | `NAV` (the rail), the `NavItem` shape including `comingSoon` / `paidOnly`, the drag-to-reorder store under `cb-v3-rail-order` |
| `src/design/primitives/Page.tsx` | 38 | `<main>` + the `h1` header row; `fill` is *not* used here so the page scrolls |
| `src/design/primitives/Card.tsx` | 238 | the 32px card header, `expandable`, the `data-card` marker every Card carries |
| `src/design/tokens.css` | 716 | `--color-line`, `--color-surface2`, `--color-raised`, `--color-fg`, `--color-muted`, `--color-faint`, `--color-accent`, and the type scale |

Nothing else is imported. `Legacy.tsx` pulls exactly two modules:

```ts
import { Card } from '@/design/primitives/Card'
import { Page } from '@/design/primitives/Page'
```

That is the whole dependency graph of the route.

---

## The rule the page exists to enforce

From the file's own header comment, and it is the part to read before editing
anything:

> **WHAT GOES IN THIS FILE**
> Only routes that are in `app-vite/src/App.tsx` and NOT in `cbedge-v3/src/App.tsx`.
> When a page lands in v3, delete its entry here the same day: an entry that
> sends someone to v2 for something v3 now does is worse than no entry, because
> it reads as authoritative.

There are therefore exactly two things that can put a row on this page, and one
that must take it off:

1. **Add a row** when a v2 route has no v3 counterpart at all (`NOT_IN_V3`), or
   when v3 has the route but only part of the surface (`PARTIAL`), or when v2's
   phone build has a tab v3's does not (`PHONE_ONLY`).
2. **Delete a row** the day the v3 route lands. Same day. Not "next sprint."
3. **Never** add a row for a v2 path that *redirects* to v3. See the
   `lib/v3Routes.ts` note below — a link that looks like a door and behaves like
   a wall is worse than a missing link.

### Why `<a href>` and never `<NavLink to>`

Also from the header:

> The links are plain `<a href>`, deliberately — `NavLink`/`to` route inside the
> `BrowserRouter`'s `basename="/v3"` and would produce `/v3/app/…`. Leaving v3 is
> a document navigation, and it should be: the two apps do not share a bundle,
> a socket or a store.

This is the same trap `src/shell/UserMenu.tsx` carries its own three paragraphs
about. The basename silently prefixes anything routed, so the failure is not a
crash — it is a link to `/v3/app/levels`, which is an unregistered route, which
renders `NotFound`. A full document load is correct here: v2 is a separate
bundle with its own socket and its own store.

---

## What v3 actually has — the other half of the cross-check

You cannot maintain this page without the list it is the complement of. These
are every route registered in `src/App.tsx`:

| Path | Component | Notes from `App.tsx` |
|---|---|---|
| `/` | `CardGallery` | **home is the cards** — the tile grid is the landing |
| `/board` | `Home` | the inherited grid board, a page like any other now |
| `/single` | `VoltBoard` | the Voltmap. Deliberately *not* `/board` — renaming `/board` would break every link to it |
| `/traders-dashboard` | `TradersDashboard` | |
| `/premarket` | `Premarket` | |
| `/options-chain` | `OptionsChain` | the GEX **matrix** |
| `/chain` | `Chain` | the **book** — bid/ask/mark, volume, OI, IV, greeks. A different question from `/options-chain`, hence a separate route |
| `/analytics` | `Analysis` | |
| `/flow` | `Flow` | |
| `/em` | `Em` | 1:1 port of v2's `/app/em`; REST-only, no socket, no canvas |
| `/replay` | `Replay` | four tabs, three of which lazy into the chunks `/options-chain` and `/analytics` already load |
| `/scanner` | `Scanner` | seven tabs over one route; **un-retired 2026-09-02** |
| `/economic-calendar` | `EconomicCalendar` | two tabs, REST-only, three feeds in parallel at entry |
| `/level-log` | `LevelLog` | **partial** — see `PARTIAL` below |
| `/seasonality` | `Seasonality` | the almanac; `paidOnly` in the rail, re-checked in the page |
| `/whales` | `Whales` | the $1M+ print archive |
| `/legacy` | `Legacy` | **this page** |
| `/feedback` | `Feedback` | support tickets; deliberately *not* in the rail |
| `/cards`, `/cards/:cardId` | `CardGallery` | the merger review — every catalog card, one at a time |
| `/m`, `/m/gex`, `/m/heat`, `/m/spx`, `/m/em`, `/m/econ`, `/m/alerts` | the phone build | `/m` is a `<Navigate replace>` to `MOBILE_DEFAULT_PATH` |
| `*` | `NotFound` | **no silent catch-all redirect** — non-negotiable 9 |

And the rail, in declaration order (`NAV`, `src/shell/Shell.tsx`) — note that
the *rendered* order is whatever the browser has saved under
`cb-v3-rail-order`, with unknown entries dropped and new entries appended:

`/` Home 🏠 · `/single` Single ★ · `/traders-dashboard` Traders Dash 📊 ·
`/premarket` Premarket 🌅 · `/whales` Whales 🐋 · `/options-chain` Options Chain ⛓️ ·
`/chain` Chain 🧾 · `/em` Est. Moves ↔️ · `/economic-calendar` Econ Cal 📅 ·
`/analytics` Analysis 📈 · `/replay` Replay ⏱️ · `/flow` Flow 🌊 ·
`/scanner` Scanner 🔭 · `/level-log` Level Log 🧱 · `/seasonality` Almanac 📜 *(paidOnly)* ·
`/legacy` **v2 Legacy** 🗄️

`v2 Legacy` is deliberately last:

> Last in the rail on purpose — it is the way OUT of v3, not a place to work.
> […] It is the honest version of the dimmed "coming soon" icons that came out
> of this list on 2026-08-30: those said a page was coming, this says where the
> page actually is today. **Shrinks as v3 fills in; delete it when it is empty.**

It carries **no** `prefetch` (there is nothing to fetch) and **no** `paidOnly`.

---

## The data shape

One interface, five fields, all of them strings. There is no fetch anywhere on
this route.

```ts
interface LegacyLink {
  /** v2 route, without the /app basename. */
  path: string
  label: string
  /** Rail-language glyph, matching v2's toolbar emoji where it had one. */
  icon: string
  /** What it is, and — where it matters — why v3 does not have it. */
  note: string
}

const V2_BASE = '/app'
```

The rendered href is `` `${V2_BASE}${item.path}` `` — so `/test` becomes
`/app/test`. `path` is also the React `key`, which means **two entries with the
same path in the same list will collide**; nothing in the file guards against it.

---

## Section 1 — `NOT_IN_V3` (4 entries)

Card title: `` `Not in v3 (${NOT_IN_V3.length})` `` → renders as **"Not in v3 (4)"**.
This is the only section whose count is in its title.

| Icon | Label | Href | Note, verbatim |
|---|---|---|---|
| ⚗️ | Test Lab | `/app/test` | "Eleven bench tabs — Squeeze, Dealer Gamma, GEX Map, GEX Scanner, GEX%, Market Quality, Stat Prompter, Condition Rail, Flow Inventory, Prem Diff, Seasonality. Built in v3, then retired 2026-08-30." |
| 🧱 | Levels | `/app/levels` | "CB / call wall / put wall for the whole scanner universe — 169 tickers of the three numbers Multi Greek shows for four." |
| 🕘 | Strike History | `/app/strike-history` | "Per-strike history over the session. Lives under the Test Lab strip in v2." |
| 📐 | Confidence Score | `/app/confidence-score` | "The confidence model, scored and broken out by component." |

### The 2026-09-06 deletions, and why each one went

The comment above this array is the page's institutional memory. Two separate
reasons, both worth keeping straight:

**Ported to v3 as cards — MULTI GREEK, BOARD, ES CANDLES.**

> All three are v3 CARDS on the home board now, and `/app/mult-greek`,
> `/app/board` and `/app/es-candles` redirect to `/v3` (`lib/v3Routes.ts`,
> PORTED). The trade was made knowingly: a card is single-symbol and lives on a
> board you arrange, where the v2 pages were fixed multi-panel layouts. **Linking
> to a path that redirects would be worse than not listing it — the link would
> look like a door and behave like a wall.**

**Retired outright — ICT, JOURNAL, FAILS, GUIDE.**

> They are RETIRED, not ported. There is no v3 version and there is not going to
> be one, so `/app/ict`, `/app/trading`, `/app/fails` and `/app/guide` redirect
> to `/v3` and their toolbar icons are gone from v2 as well. (The NEXT route at
> `/guide` is untouched — only the SPA copy went.) A list of doors into a wing
> that is closing has to lose an entry the day the room does.

That last parenthesis matters: `/guide` still exists as a **Next** page and is
still linked from the account menu (`INFO_LINKS` in `src/shell/UserMenu.tsx`,
`{ href: '/guide', label: 'Site Guide' }`). What died is the v2 **SPA** copy at
`/app/guide`. Do not "fix" the account menu on the strength of this page's note.

### Note the Test Lab entry contradicts itself on purpose

"Built in v3, then retired 2026-08-30" — the tabs existed in v3 and were
removed, which is why the row points at v2 rather than at nothing. `App.tsx`
says the same thing from the other side:

> STILL RETIRED 2026-08-30 — Test Lab (`/test`) and Journal (`/trading`) are
> gone from v3, along with the ICT, ES Candles, Board and Multi Greek rail slots
> (they never had pages here, only "coming soon" icons). The BOARD CARDS of the
> same names — Multi Greek, GEX Candles, Key Levels — are deliberately
> untouched.

Journal (`/app/trading`) is *not* on this page, because it redirects to `/v3`.
Test Lab is, because `/app/test` still answers. That asymmetry is the rule
working, not a bug.

---

## Section 2 — `PARTIAL` (1 entry)

Card title: **"Ported in part — the rest is still in v2"**. No count in the title.

> A v3 route exists, so it is not in the list above — but the v2 page still
> holds surfaces the port has not reached. These entries exist so "v3 has it"
> never gets read as "v3 has all of it".

| Icon | Label | Href | Note, verbatim |
|---|---|---|---|
| 🧱 | Level Log | `/app/level-log` | "v3 has the wall-migration chart and the range switch. The ticker rail, the log card, the capture rail, the churn strip and the timeline are still v2 only." |

Cross-check against `App.tsx`'s own note on `/level-log`, which names the spec
rows: "the 283-row checklist in `docs/parity/level-log.md`. What is here is the
WALL MIGRATION chart (Part H) and the range switch that made v2's popout worth
opening (Part I)". The two notes agree; when Part J lands, both change.

The 🧱 glyph is shared with **Levels** in `NOT_IN_V3`. That is intentional —
`icon` is described as "Rail-language glyph, matching v2's toolbar emoji where
it had one," and both pages were 🧱 in v2's toolbar. It is also why `path`, not
`icon`, is the React key.

---

## Section 3 — `PHONE_ONLY` (2 entries)

Card title: **"Phone build"**. No count.

> v2 ships seven phone tabs, v3 five. Two of v2's have no v3 equivalent.

| Icon | Label | Href | Note, verbatim |
|---|---|---|---|
| ⛓️ | Option Chain (phone) | `/app/m/chain` | "Removed from the v3 tab bar 2026-09-03, the day after it landed — a strike ladder read ACROSS a dozen numeric columns does not survive 390px. v2's phone chain is still here." |
| 🌅 | Premarket Prep (phone) | `/app/m/prep` | "The pre-open prep board, phone build. No v3 phone counterpart yet." |

The chain entry is the same decision `src/mobile/mobileNav.ts` records from the
other side, in the gap where the tab used to be:

> NO CHAIN TAB (2026-09-03, removed the day after it landed). The v3 options
> chain is a strike ladder with up to a dozen numeric columns read ACROSS; at
> 390px it is a horizontal scroll over a table you cannot see two columns of at
> once, which is not the page, it is a picture of the page. It stays a desktop
> screen until there is a phone DESIGN for it rather than the desktop one made
> narrow. `/v3/options-chain` is untouched.

**The arithmetic in the comment is stale.** `MOBILE_TABS` in
`src/mobile/mobileNav.ts` ships **six** tabs — gex, heat, spx, em, econ,
alerts — not five. The comment predates the `/m/alerts` tab. The *entries* are
still correct (v2 has `/m/chain` and `/m/prep`, v3 has neither); only the count
is wrong. See Gotchas.

---

## Rendering

### DOM

```
<main class="flex min-h-0 flex-1 flex-col overflow-y-auto">      ← Page, fill=false
  <header class="flex h-… shrink-0 items-center justify-between gap-4 px-4 py-3">
    <h1 class="text-lg font-medium text-fg">v2 Legacy</h1>
  </header>
  <div class="flex flex-col gap-3 p-4">
    <p class="max-w-3xl text-xs leading-relaxed text-muted">…intro…</p>
    <section data-card class="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
      <header class="flex h-8 shrink-0 items-center gap-3 border-b border-line px-3">
        <h2 class="min-w-0 shrink truncate text-sm font-medium text-muted">Not in v3 (4)</h2>
        <div class="cb-bar flex min-w-0 flex-1 items-center justify-end gap-1.5"></div>
      </header>
      <div class="…card body…">
        <div class="grid grid-cols-1 gap-2 lg:grid-cols-2">
          <a href="/app/test" class="group flex items-start gap-3 rounded-md
                                     border border-line bg-surface2 px-3 py-2.5
                                     transition-colors hover:bg-raised"> … </a>
          …
        </div>
      </div>
    </section>
    … two more Cards …
    <p class="text-2xs leading-relaxed text-faint">…footer…</p>
  </div>
</main>
```

All three Cards pass `expandable={false}`. From `CardProps`:

> Draw the expand control. ON BY DEFAULT […] Pass false only for a card that is
> already the whole page, where expanding is a no-op that still costs a button.

The Card header is `h-8` (32px) and never wraps — `cb-bar` in `tokens.css` is
`flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none`. On this page the
toolbar slot is empty, so it is purely the spacer that keeps nothing on the
right.

### One row — `LinkRow`

```
<a  href="/app/levels"
    class="group flex items-start gap-3 rounded-md border border-line
           bg-surface2 px-3 py-2.5 transition-colors hover:bg-raised">
  <span aria-hidden class="mt-0.5 shrink-0 text-base leading-none">🧱</span>
  <span class="flex min-w-0 flex-1 flex-col gap-1">
    <span class="flex items-baseline gap-2">
      <span class="truncate text-sm font-semibold text-fg">Levels</span>
      <span class="tabular truncate text-2xs text-faint">/app/levels</span>
    </span>
    <span class="text-xs leading-snug text-muted">CB / call wall / put wall …</span>
  </span>
  <span aria-hidden class="mt-0.5 shrink-0 text-xs text-faint
                            transition-colors group-hover:text-accent">↗</span>
</a>
```

Three things worth naming:

- The **icon is `aria-hidden`**, as is the `↗`. A screen reader gets the label,
  the path and the note, in that order, and no emoji noise.
- The **path is drawn beside the label**, in `tabular` at `text-2xs`. The row is
  a link *and* a piece of documentation: you can read where it is going without
  hovering for a status bar.
- The `↗` turns `text-accent` on `group-hover`, which is the only state change
  besides the plate lift to `bg-raised`.

### Tokens and hex

Every colour is a utility class; not one literal appears in the file
(non-negotiable 1). Resolved against `src/design/tokens.css`:

| Class | Token | Hex |
|---|---|---|
| `bg-surface` (Card plate) | `--color-surface` | `#0e1216` |
| `bg-surface2` (row plate) | `--color-surface2` | `#141a21` |
| `hover:bg-raised` | `--color-raised` | `color-mix(in srgb, #141a21 92%, #e7ece9)` |
| `border-line` | `--color-line` | `#1e2630` |
| `text-fg` (label) | `--color-fg` | `#e7ece9` |
| `text-muted` (note, intro, card title) | `--color-muted` | `#e7ece9` |
| `text-faint` (path, ↗, footer) | `--color-faint` | `#c0c5c3` |
| `group-hover:text-accent` (↗) | `--color-accent` | `#2f6bff` |
| page canvas (`bg-bg` on the Shell) | `--color-bg` | `#0a0d10` |

Type scale, from the `@theme` block in `tokens.css`:

| Class | Value | Used for |
|---|---|---|
| `text-2xs` | `0.625rem` / 10px | the `/app/…` path, the footer line |
| `text-xs` | `0.6875rem` / 11px | the note, the intro paragraph, the `↗` |
| `text-sm` | `0.8125rem` / 13px | the row label, the Card title |
| `text-base` | `0.9375rem` / 15px | the emoji glyph |
| `text-lg` | `1.125rem` / 18px | the `Page` `h1` |

`text-muted` and `text-fg` are the **same hex today** (`#e7ece9`). That is not
an accident — `AGENTS.md`: "the app's own utilities have no shade number:
`text-fg` / `text-muted` / `text-faint` (all white today)". Weight and size do
the hierarchy here, not colour.

### Layout constants

- Row grid: `grid-cols-1` below `lg`, `lg:grid-cols-2` above. Tailwind's `lg` is
  1024px. There is **no phone branch** — the page has never been in
  `DESKTOP_TO_MOBILE`, so a phone that types the URL gets the desktop layout at
  one column, which is the correct answer for a list of links.
- Row gap `gap-2` (8px); card gap `gap-3` (12px) from `Page`'s body div; page
  padding `p-4` (16px).
- Row padding `px-3 py-2.5` → 12px / 10px. With a 13px label and an 11px note
  the row lands at roughly 56–70px tall depending on how the note wraps, which
  clears a 44px tap target comfortably even though this page was not designed
  for touch.
- Intro paragraph is capped at `max-w-3xl` (48rem / 768px) so the copy does not
  run the full width of a wide monitor. The footer is not capped — it is one
  short line.

---

## Copy, verbatim

There are no loading, error or empty states on this route: the arrays are
module constants, so the page renders complete on first paint. The only strings
are these.

**Page title** (the `h1`):

> v2 Legacy

**Intro paragraph**, `text-xs text-muted`, above the first card:

> v2 still runs at `/app` and answers everything it always did. These are the
> destinations v3 does not have a route for — every link below leaves v3 and
> opens the v2 app. An entry disappears from this page the day its v3 route
> lands.

(`/app` inside it is wrapped in `<span class="tabular text-fg">`.)

**Card titles:**

> Not in v3 (4)
> Ported in part — the rest is still in v2
> Phone build

**Footer paragraph**, `text-2xs text-faint`:

> Same account, same backend — `server-v2/` serves both apps. Nothing here is a
> second copy of your data.

(`server-v2/` is wrapped in `<span class="tabular">`.)

That footer is doing real work. The most common worry about a page full of
links into "the old app" is that the old app is a stale mirror. It is not:
`AGENTS.md` — "**The backend is unchanged.** `server-v2/` in the v2 repo stays
exactly where it is and keeps doing everything it does […] v3 talks to it over
HTTP and one WebSocket and nothing else."

### What happens if a list is emptied

Nothing guards against it. `LinkList` maps an empty array to an empty grid, so
the Card renders with its header and a blank body. If `NOT_IN_V3` is emptied its
title reads **"Not in v3 (0)"**. There is no "nothing left" message, because the
intended end state is that the whole *page* goes — `NAV`'s own comment says
"delete it when it is empty."

---

## The data path

There isn't one. Stated explicitly in `App.tsx` at the `lazy()` binding:

> `/legacy` — the v2 door. One page listing every v2 destination v3 has no route
> for, each one a real `<a href="/app/…">` out of the SPA. […] **Static list, no
> fetch, no socket.** Delete an entry there the day its v3 route lands.

Consequences worth spelling out:

- **No endpoints.** Zero requests, zero polls, zero stale windows, zero query
  params. `useQuery`, `useFrame`, `useField` and `watchFrame` are all absent.
- **No failure behaviour**, because there is nothing to fail. The page cannot be
  empty, cannot be stale, and cannot show an error.
- **No socket scope contribution.** `npm run check:ws` derives topic scope from
  what is actually subscribed; this route subscribes to nothing, so landing on
  it narrows the socket to whatever the Shell itself holds.
- **No visibility contract.** Non-negotiables 4, 5 and 6 (imperative charts,
  `ChartFrame` visibility, `data-cb-layer`) have nothing to bite on — there is
  no canvas on this route.
- **The one network effect is indirect:** `PageVisitBeacon` (mounted once in
  `App.tsx`, `src/data/pageVisit.ts`) posts a `page_visits` row to
  `/api/page-status` on arrival, like every other route. Its label comes from
  `labelFor()`, which searches `NAV` first — so this route logs as **"v2
  Legacy"**, not as `/legacy`.

### Controls

None. There is no state on this page — no query string, no `localStorage`, no
server value. Every pixel is derived from the three module-scope arrays.

The nearest thing to a control is the **rail icon's drag handle**, which belongs
to `Shell.tsx`, not to this page: every rail item is `draggable`, the order is
persisted per browser under `localStorage['cb-v3-rail-order']` as a JSON array
of `to` strings, and `loadOrder()` filters out anything not in `NAV` then
appends anything missing. So moving `v2 Legacy` off the bottom of the rail
survives a reload, and deleting the `NAV` entry later drops it from every saved
order automatically.

---

## Performance and bundle

- **Its own lazy chunk.** `const Legacy = lazy(() => import('@/pages/Legacy'))`.
  `vite.config.ts` does no manual chunking for it — "Manual chunking is
  deliberately minimal. React lands in its own chunk so it stays cached across
  every deploy; everything else code-splits by route via `lazy()`. Do NOT add
  vendor grouping 'for tidiness'."
- **The chunk name falls out of the file name**, which is the point: "The chunk
  names fall out of the file names, which is what makes an over-budget route
  legible in `check-budgets.mjs` output."
- **Budget:** `route` in `budgets.json` — `"route": 59100` brotli bytes. This
  page is 182 lines of markup and three string arrays with no imports beyond
  `Card` and `Page`, so it is nowhere near the line; it is the *cheapest* route
  in the app by a wide margin. The other relevant lines:

  ```json
  "entry": 38900,
  "react": 55000,
  "route": 59100,
  "data": 78000,
  "css": 8500,
  "html": 2600,
  "totalInitial": 108400,
  ```

  and the ratchet block:

  ```json
  "ratchet": { "slack": 0.15, "enforce": false }
  ```

  A budget carrying more than 15% headroom is reported as SLACK on every run.
  `enforce: false` means it does not fail the build — pull it back down with
  `npm run budgets:ratchet` instead. Per `budgets.json`'s own comment: "Raising
  a number is a deliberate decision that shows up in a diff […] LOWERING one
  matters just as much and is far easier to forget."
- **No prefetch.** The `NAV` entry carries no `prefetch` array, so hovering the
  rail icon warms nothing. Correct: there is nothing to warm. (Compare
  `/traders-dashboard`, which hovers `/api/traders-dashboard/overview`.)
- **`npm run perf`** measures repaints per animation frame on canvases tagged
  `data-cb-layer`. This page owns none, so it contributes nothing to
  `idleRepaintsPerFrame` (0.15), `offscreenRepaints` (0) or
  `interactionRepaints` (10).

---

## Deploying a change to this page

Editing the arrays is a one-file change and needs no new route. But the route
itself only exists on a hard refresh because of step 4 of "Adding a page" in
`AGENTS.md`:

> 4. **`app/v3/<name>/route.ts` in the v2 repo**, three lines calling
>    `serveSpaShell("v3")`.
>
> Miss step 4 and the page works when you click to it in-app but 404s on a hard
> refresh or a shared link […] Deliberately not solved with a catch-all route: a
> catch-all would swallow `/v3/assets/*.js` and hand back HTML.

So `app/v3/legacy/route.ts` must exist in the v2 repo for
`https://voltick.cbedge.net/v3/legacy` to survive a refresh or a pasted link.
Since the page's whole purpose is to be *linked to* when someone asks "where did
X go?", that handler is load-bearing.

Also: `npm run check:theme` runs on `npm run build` **and in the Dockerfile
before `build:fast`**, and it carries `theme-baseline.json` with per-file
grandfathered violation counts. `Legacy.tsx` names no colour, so it should sit
at zero and, per the baseline rules, "a file that reaches zero is dropped and
can never regress." Do not introduce a hex here to make a row stand out — use an
existing token utility.

---

## Gotchas

1. **The `PHONE_ONLY` comment's count is wrong.** It says "v2 ships seven phone
   tabs, v3 five." `MOBILE_TABS` in `src/mobile/mobileNav.ts` has **six**:
   `gex`, `heat`, `spx`, `em`, `econ`, `alerts`. The comment predates the
   `/m/alerts` tab. The two *entries* are still correct; only the sentence is
   stale.

2. **`AGENTS.md`'s phone table still lists `/m/chain`** (and `/m/em` under it),
   i.e. seven rows under the words "Six screens." `mobileNav.ts` is the
   registry and it has no chain tab — 2026-09-03 removed it. When these
   disagree, believe `mobileNav.ts`; it is the thing `App.tsx` and
   `MobileTabBar` actually read.

3. **Only the first Card shows a count.** `Not in v3 (4)` is a template
   literal; "Ported in part…" and "Phone build" are plain strings. Adding a
   fifth row to `NOT_IN_V3` updates its title automatically; adding a second
   `PARTIAL` row changes nothing visible in the header.

4. **`path` is the React key.** Two entries with the same `path` inside one list
   produce a duplicate-key warning and unstable rendering. `icon` is *not*
   unique — 🧱 appears twice (Levels, Level Log) and that is deliberate.

5. **A `PARTIAL` row is easy to forget.** The deletion rule fires on "the v3
   route lands," but a `PARTIAL` row exists *because* the route already landed.
   Its trigger is different: delete it when the last named surface (ticker rail,
   log card, capture rail, churn strip, timeline) crosses. Nothing enforces that.

6. **Never list a redirecting path.** `/app/mult-greek`, `/app/board`,
   `/app/es-candles`, `/app/ict`, `/app/trading`, `/app/fails` and `/app/guide`
   all redirect to `/v3` via `lib/v3Routes.ts`. A row for any of them is a link
   that "looks like a door and behaves like a wall."

7. **`/guide` the Next page is alive.** The `/app/guide` SPA copy is gone. The
   account menu's "Site Guide" row (`INFO_LINKS`, `UserMenu.tsx`) still points at
   the Next route and is correct.

8. **`NavLink` here is a silent bug, not a loud one.** Routing instead of
   href-ing produces `/v3/app/levels` → unregistered → `NotFound`, which looks
   like a broken page rather than a broken link. `App.tsx`: "v2 fell through to
   `/traders-dashboard` whenever a route was missing, which meant a page that was
   never registered looked like it 'sort of worked' instead of failing loudly."

9. **The `pageVisit.ts` comment is slightly out of date about this route.** It
   says "(/feedback is deliberately out of the rail; /legacy moves around) falls
   back to its own path." `/legacy` *is* in `NAV`, so `labelFor('/legacy')`
   returns `"v2 Legacy"` and never reaches the fallback. `/feedback` genuinely
   does fall back to `"/feedback"`.

10. **This page has no phone build and should not get one.** It is not in
    `DESKTOP_TO_MOBILE`, so `MobileRedirect` leaves it alone —
    "a desktop page with no phone counterpart keeps rendering its desktop
    layout." At one column it already reads fine on a handset.

11. **The end state is deletion, not an empty page.** When `NOT_IN_V3`,
    `PARTIAL` and `PHONE_ONLY` are all empty, remove the route from `App.tsx`,
    the `NAV` entry from `Shell.tsx`, `app/v3/legacy/route.ts` from the v2 repo,
    and the file. An empty "v2 Legacy" card is the same lie the dimmed
    "coming soon" icons were.
