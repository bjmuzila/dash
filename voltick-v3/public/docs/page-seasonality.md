# `/seasonality` — the Almanac

**Route:** `/seasonality` (served at `voltick.cbedge.net/v3/seasonality`)
**Mounted by:** `src/App.tsx:200` — `<Route path="/seasonality" element={<Seasonality />} />`, behind `const Seasonality = lazy(() => import('@/pages/Seasonality'))` (`src/App.tsx:106`).
**Rail entry:** `src/shell/Shell.tsx:156` — `{ to: '/seasonality', label: 'Almanac', icon: '📜', paidOnly: true }`. **No `prefetch`.**
**Server shell:** `app/v3/seasonality/route.ts` in the v2 repo.
**Ported from:** v2's `/explore/seasonality`, on **2026-09-07**. That page stays public, stays free and stays where it is.

**Source files**

```

---

## What it is, in one paragraph

`/seasonality` is the in-app door to the almanac: 98 years of S&P 500 daily closes (^GSPC back to 1927-12-30, price return only, cash index) laid on a fixed 365-day calendar axis, plus every study that can be built on that one record. The page is a section rail down the left and **one section mounted at a time** on the right — the default section is the overlay chart, which draws the seasonal average path and the live year on one axis in two units so the headline number is the **spread** between them, not either level. Behind the rail sit seventeen more sections: the monthly matrix, the two half-years, shape by decade, turn of the month, opex week, month-end, day of week, volatility by month, the presidential and decennial cycles, early-year barometers, "where the calendar stands", the VIX-spike study, and four **scheduled-event** studies — FOMC decisions (269 announced, back to 1994), Jackson Hole (every symposium since 1990, anchored on the Friday keynote), earnings reactions across sixteen names, and every Apple product keynote. Almost all of it is precomputed at build time into `seasonalityData.ts` and renders instantly with the backend down; only three things fetch — a freshness call that extends the current year past its build cutoff, AAPL's split-adjusted daily history, and the earnings calendar. The page is **paid-only**, twice: the rail hides the icon and the route repeats the check so a typed URL does not walk around it — and both are chrome, because the numbers ship in the route chunk and the free page serves most of them to anyone.

---

## File map

| File | Lines | What it owns |
|---|---:|---|
| `src/pages/Seasonality.tsx` | 71 | The paid gate (both branches), the scroll container, `SEA.app` ground, `padding: 12` |
| `src/pages/seasonality/SeasonalityView.tsx` | 1190 | The rail + pane shell, `SHELL_CSS`, section routing, the overlay chart, the five stat tiles, the compare picker |
| `src/pages/seasonality/SeasonalityAlmanac.tsx` | 2722 | Eighteen section bodies, the six chart primitives, `DataTable` / `HeatTable` / `Collapse` / `Tile`, the three fetching studies |
| `src/pages/seasonality/sections.ts` | 110 | `SectionKey`, `SECTION_GROUPS`, `SECTIONS`, `DEFAULT_SECTION`, `sectionForHash`, `hashForSection` |
| `src/pages/seasonality/calendar.ts` | 206 | `MONTH_START`, `calIndex`, `parseISO`, `fmtUSDate`/`fmtLongDate`/`fmtSpan`, `nyTodayISO`, `dowOf`, `easter`, `isMarketHoliday`, `lastTradingDayOfMonth`, `isLastTradingDayOfMonth` |
| `src/pages/seasonality/eventDates.ts` | 580 | `JACKSON_HOLE`, `APPLE_EVENTS` + `APPLE_EVENT_KINDS`, `FOMC_ROWS` → `fomcDecisions()`, `FOMC_UPCOMING`, `EARNINGS_TICKERS` |
| `src/pages/seasonality/useLiveYear.ts` | 169 | `/api/public-seasonality`, the forward-filled extension, `LiveVixEvent` |
| `src/pages/seasonality/seaTheme.ts` | 41 | `SEA` — six surfaces by role, plus `line` / `lineSoft` |
| `src/pages/seasonality/homeTheme.ts` | 70 | `HOME_THEME` (the v2 name bridge), the candle pair re-export, `classicCardStyle`, `classicCardAccentStyle` |
| `src/pages/seasonality/Watermark.tsx` | 136 | `Watermark`, the folder-private `Card`, `SeaCard` |
| `src/pages/seasonality/seasonalityData.ts` | ~283KB | **THE STATIC TABLE** — 98 years of SPX daily closes. Split into its own `data-seasonality-*` chunk by `vite.config.ts` and measured against the `data` line in `budgets.json`, never the route one |

---

## ⚠ `seasonalityData.ts` is absent


### What imports it, and what shape each name must have

| Import | Imported by | Shape, from its use |
|---|---|---|
| `ALMANAC` | Almanac | The whole precomputed table: `.meta {symbol, start, end}`, `.months`, `.monthTables[era]`, `.dow[era]`, `.sixMonth {index[], …}`, `.matrix.years[]`, `.now {as_of, trading_day_of_year, rest_of_year[], window[]}`, `.presidential {index[], n}`, and the rest of the section payloads |
| `EXTRAS` | Almanac | `.vix {meta {start,end,sessions}, baseline, buckets[{threshold, n, low_to_next_high{avg,median}, next_open_close{avg,pos_pct}, same_open_close{avg}}], events[]}`, `.eom`, `.opex` |
| `ERA_KEYS` | Almanac | A non-empty `string[]` of era labels; `ERA_KEYS[0]!` is the default for both era pills |
| `Stat` (type) | Almanac | The `{avg, median, pos_pct, n, worst, …}` shape the tables read |
| `yearCurve(y)` | both | `number[] \| null` — one year's 365-point cumulative % curve |
| `YEAR_META` | View | Per-year metadata for the compare picker |
| `YTD_LAST_DATE` | all three | ISO string; the static year's last session. `LIVE_YEAR = Number(slice(0,4))` |
| `YTD_BASE_PX` | View, `useLiveYear` | The prior year-end close the whole axis is re-based to |
| `YTD_2026_PCT` / `YTD_2026_PX` | `useLiveYear` | The current year's two arrays |
| `SEASONAL_BASELINES` | View | `[{key, curve, …}]` — the selectable windows. Module-level and non-empty (`[0]!` is asserted) |
| `DEFAULT_BASELINE` | View | The key the picker starts on |
| `OVERLAY_YEARS` | View | Every year available as an overlay |
| `SEASONAL_YEAR_RETURNS` | View | Per-year full-year returns |

### The axis contract every one of them is laid on

From `calendar.ts`'s header, and it is the single most important fact about the data file:

> Every curve in `seasonalityData.ts` (`SEASONAL_BASELINES`, `YEAR_CURVES`, `YTD_2026_*`) is laid on a **365-slot calendar axis with 29-Feb DROPPED and weekends/holidays forward-filled**. So the index of a date is its NON-LEAP day-of-year minus one, in every year, leap or not — which is why `calIndex()` uses a fixed month-offset table and never asks the Date object for a day-of-year. **Get this wrong in a leap year and every event study silently shifts a day.**

`calIndex('2026-08-28')` is `MONTH_START[7] + 27` = `212 + 27` = 239. 29-Feb maps to the same slot as 28-Feb (index 58), "which is exactly what the data generator does when it drops the leap day: the two dates cannot both exist on a 365-slot axis, and the forward-fill makes the collision harmless."

### How it is chunked, and against which budget

`vite.config.ts`:

```js
if (/[\\/]src[\\/]pages[\\/]seasonality[\\/](seasonalityData|eventDates)\.ts$/.test(id)) {
  return 'data-seasonality'
}
```

Note the matcher takes **both** `seasonalityData.ts` and `eventDates.ts` — the 580-line hand-maintained calendar rides in the same chunk.

The reasoning, verbatim:

> The almanac ships ~283KB of precomputed source: 98 years of encoded year curves, the monthly matrix, the event date tables. It is DATA, not code — it changes when the year does, not when the page does — and lumping it into the route chunk would mean either a route budget raised to fit it (which stops enforcing anything for every other page) or no budget on it at all.
>
> So it gets a chunk of its own, and `check-budgets.mjs` classifies any `data-*` chunk as kind `data` with its own line in `budgets.json`. Splitting it also means the table is cached across deploys that only touch the components.
>
> **The name is matched by prefix on both sides — keep them in step.**

`budgets.json` (brotli bytes):

```
entry         38900
react         55000
route         59100     ← the COMPONENT half of this page is measured here
data          78000     ← data-seasonality-*.js is measured here
css            8500
html           2600
totalInitial 108400
ratchet { slack: 0.15, enforce: false }
```

And the `$comment` on that `data` line:

> `data` covers any `data-*` manualChunk — a STATIC TABLE rather than a page (today: data-seasonality, the almanac's encoded year curves and event date tables). It is separate from `route` on purpose: folding a 300KB table into the page budget would mean raising `route` to ~130kb, and a route budget with that much headroom stops enforcing anything for the twelve pages that carry no table at all. **Its 78000 is a FIRST number, taken from the brotli weight of the SOURCES before the chunk had ever been built — ratchet it after the first real build.**

`App.tsx:100–105` states the same split from the route's side:

> The COMPONENT half stays in the ordinary route chunk and is still measured against the route budget — one table does not get to raise the ceiling for every page.

---

## The paid gate — two places, both chrome

### In the rail

`NavItem.paidOnly` is documented at its declaration:

> Drawn only for a paying account. CHROME, not a gate — same rule as `data/auth.tsx`: hiding an icon is one devtools poke from undone, so the page behind it repeats the check (see `pages/Seasonality.tsx`) and anything that must actually be paid-only is gated server-side. It also stays out of the saved rail order for a free account, which is why the filter below runs AFTER the order is applied rather than on NAV itself: a subscription that lapses and comes back finds the icon where it was left.

That ordering detail matters: `loadOrder()` reads `cb-v3-rail-order` from localStorage and reconciles it against `NAV`; the `isPaid` filter runs downstream of that, so an unsubscribed month does not silently drop `/seasonality` out of a user's saved arrangement.

The rail comment also explains the missing prefetch:

> No prefetch: the page's one runtime fetch (`/api/public-seasonality`) is fired by `useLiveYear` after mount and does not read the api.ts cache, so warming it on hover would be a wasted request.

### In the page

```tsx
const { isPaid, isLoaded, isSignedIn } = useAuth()
if (!isLoaded) return null
```

> Nothing until `/api/auth/me` answers — otherwise a subscriber sees the upsell flash for a beat on every load, which reads as a billing problem.

The upsell, verbatim:

- **`The almanac is part of a subscription`** (`text-lg text-fg`)
- **`98 years of S&P 500 seasonality, the FOMC and opex studies, and every Apple keynote since 2007 — month by month, day of week, turn of the month, with the sample size printed on every table.`** (`max-w-prose text-sm text-faint`)
- Two links: **`See plans`** → `/pricing` when signed in, **`Sign in`** → `/sign-in` when not; and **`Or read the free version`** → `/explore/seasonality` in `text-faint`.

The whole block sits on `background: SEA.app`, centred, `min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center`.

And the gate's own honesty note:

> `isPaid` here decides what is DRAWN, exactly as `data/auth.tsx` says: it is chrome, not a gate. The same flag hides the rail icon, and this check is what stops a typed URL rendering the page anyway. Neither is a security boundary — **the almanac's own numbers ship in the route chunk, and the free page at `/explore/seasonality` serves most of them to anyone.** If any of this ever becomes genuinely paid-only data, it moves behind an API the server gates, not behind this boolean.

### Why it is not wrapped in `<Page />`

```tsx
<main className="min-h-0 flex-1 overflow-y-auto" style={{ background: SEA.app, padding: 12 }}>
  <SeasonalityView />
</main>
```

> The view is a self-contained grid block — a sticky section rail down the left, cards down the right — that expects to sit on a page ground it does not paint, on its own palette (`seaTheme`: six surfaces, darker and flatter than the app's cards, deliberately not promoted into `design/tokens.css` because it would restyle every route as a side effect). So the scroll container and the gutter belong here, in `SEA.app`, rather than in `Page`'s padded column, whose gutter is sized for board cards.

### The public page it was ported from

`SeasonalityView.tsx` is mounted in **two** places and has to keep working in both:

> • Test Lab → Seasonality (`/app/test#seasonality`), signed in.
> • `/explore/seasonality`, the PUBLIC free-tool page, signed OUT.
>
> That is why it lives in `components/` and not in `app/test/`, and why it reads no session, no cookie and nothing from the API — **a component that quietly needs an auth context renders empty for exactly the visitors the public page exists to convert**, and nothing in the signed-in view would ever show it.

`SeasonalityAlmanac.tsx` carries the same statement: "Rendered both signed in (Test Lab) and signed OUT (the public `/explore/seasonality` page)."

So the paid check lives entirely in `/v3/pages/Seasonality.tsx` and the two ported components have no idea it exists.

---

## The section registry — `sections.ts`

**Single source of truth.** `SeasonalityView` builds the rail from it and `SeasonalityAlmanac` keys its section map off the same union:

> so a section cannot exist in the nav without a body or the other way round — that mismatch is a blank pane, and a blank pane looks like a broken page rather than a missing case.

`hash` is what lands in the URL. **"Keep those stable once they are public: they are what people paste into a DM."**

### The five groups, in rail order

**The calendar year**

| key | Rail label | hash |
|---|---|---|
| `season` | Seasonal vs this year | `seasonal` |
| `month` | Month by month | `months` |
| `six` | The two half-years | `half-years` |
| `decade` | Shape by decade | `decades` |
| `matrix` | Every month, every year | `matrix` |

**Inside the month**

| key | Rail label | hash |
|---|---|---|
| `tdom` | Turn of the month | `turn-of-month` |
| `opex` | Opex week | `opex` |
| `eom` | Last day of the month | `month-end` |
| `dow` | Day of week | `day-of-week` |

**Event triggers**

| key | Rail label | hash |
|---|---|---|
| `vix` | After a VIX spike | `vix-spike` |
| `now` | Where the calendar stands | `now` |
| `baro` | Early-year barometers | `barometers` |

**Scheduled events** — and the group carries its own reason for existing:

> Dated events, not calendar shapes. Everything above answers "what does the market do at THIS TIME OF YEAR"; everything here answers "what does it do around THIS EVENT". They are studies of the same kind — an anchor date, a window before, a window after — so they share a group and a vocabulary, and they are kept out of "Event triggers" because that group is about market-generated conditions rather than scheduled dates.

| key | Rail label | hash |
|---|---|---|
| `fomc` | FOMC decisions | `fomc` |
| `jh` | Jackson Hole | `jackson-hole` |
| `earn` | Earnings reactions | `earnings` |
| `aapl` | Apple events | `apple-events` |

**Long cycles**

| key | Rail label | hash |
|---|---|---|
| `cycles` | Presidential & decennial | `cycles` |
| `vol` | Volatility by month | `volatility` |

`SECTIONS = SECTION_GROUPS.flatMap(g => g.items)` — eighteen in all.

### `DEFAULT_SECTION = "season"` — a constant, never the URL

> First paint always starts here — a CONSTANT, never the URL hash or localStorage. **Seeding client-only state is how the server renders one section and the client another (React #418).** The hash is applied in an effect, after hydration.

`sectionForHash(h)` strips a leading `#` and finds the match, returning `null` for an unknown fragment (so an unrecognised hash leaves the default section mounted). `hashForSection(k)` returns `""` for an unknown key.

`label` is short on purpose: "the rail is 225px."

---

## The shell — rail plus one pane

> This used to be one very long scroll of fourteen cards. It is now a rail on the left and ONE section in the pane, because the studies here answer different questions and stacking them made every one of them harder to find. The rail doubles as a table of contents — you can see the whole shape of the tool without scrolling it.

**ONE SECTION IS MOUNTED AT A TIME. Unmounted, not hidden:**

> a display toggle would keep every chart's SVG and ResizeObserver alive for a reader looking at one of them.

And the consequence that is easy to get wrong:

> That is also why the width hooks here and in the almanac use **CALLBACK refs**. A `useEffect([])` would attach to the first node only, and every chart after the first navigation would render blank at width 0.

`SeasonalityView`'s `wrapRef` is exactly that: it disconnects any previous `ResizeObserver`, returns early on a null node, observes the new one, and seeds `setWidth(node.clientWidth)` immediately. A second effect disconnects on unmount.

### Section routing

```tsx
const [active, setActive] = useState<SectionKey>(DEFAULT_SECTION)
useEffect(() => {
  const apply = () => { const k = sectionForHash(window.location.hash); if (k) setActive(k) }
  apply()
  window.addEventListener("hashchange", apply)
  return () => window.removeEventListener("hashchange", apply)
}, [])
```

`go(k)` sets the state, writes the hash with **`replaceState`** and scrolls the pane into view:

> `replaceState`, not `location.hash =` — the latter pushes a history entry per rail click, so Back walks the rail instead of leaving the page.

`document.getElementById("sea-pane")?.scrollIntoView({ block: "nearest", behavior: "smooth" })`.

### `SHELL_CSS`

Injected as a `<style>` string rather than living in `globals.css`:

> The rail needs a media query (it becomes a horizontal strip on a phone) and `:hover` / `:focus-visible` states, none of which inline styles can express. The alternative was reaching into the shared `globals.css` for a component only two routes mount — that file is already carrying a "GLOBAL GRID COLLAPSE" block added for one page's benefit, and this would be the next one. Prefixed `sea-` so it cannot collide with anything.

Layout constants:

| Selector | Rule |
|---|---|
| `.sea-shell` | `grid-template-columns: 225px minmax(0,1fr)`, `gap 16`, `background SEA.shell`, `1px SEA.lineSoft`, `radius 16`, `padding 12` |
| `.sea-pane` | one column, `gap 16` |
| `.sea-rail` | `position: sticky; top: 12`, `radius 12`, `background SEA.rail`, `padding 8`, `max-height: calc(100vh - 40px)`, `overflow: auto` |
| `.sea-railgrp` | `text-3xs`, weight 800, `letter-spacing .14em`, uppercase, `HOME_THEME.green` |
| `.sea-railitem` | full-width left-aligned button, `7px 10px`, `radius 8`, `text-xs`, weight 600, `line-height 1.3` |
| `.sea-railitem:hover` | `background SEA.cardHi` |
| `.sea-railitem:focus-visible` | `2px solid HOME_THEME.cyan`, `outline-offset 2` |
| `.sea-railitem[aria-current="true"]` | weight 800, `HOME_THEME.cyan`, border `alpha(cyan,.4)`, background `linear-gradient(90deg, alpha(cyan,.26), alpha(cyan,.04))` |
| `.sea-compare` | the picker disclosure — border `alpha(cyan,.4)`, `linear-gradient(180deg, alpha(cyan,.12), SEA.card2)` |
| `.sea-caret` / `.sea-compare[open] .sea-caret` | rotates 90° |
| `.sea-comparecta` | a pill in `HOME_THEME.cyan` with `var(--color-sea-on-accent)` ink; **hidden when the disclosure is open** |
| `.sea-disccaret` / `.sea-disc[open] > summary .sea-disccaret` | the almanac's own `Collapse` caret — "it lives here, not there, because that component ships no stylesheet and a `:not-open` selector cannot be expressed inline" |

**The phone breakpoint, `max-width: 860px`:**

```css
.sea-shell { grid-template-columns: minmax(0,1fr) }
.sea-rail  { position: static; max-height: none; display: flex; gap: 6px;
             overflow-x: auto; padding: 8px; scrollbar-width: thin }
.sea-rail > div { display: flex; gap: 6px; align-items: center; flex: none }
.sea-railgrp    { padding: 0 4px 0 8px; white-space: nowrap; align-self: center }
.sea-railitem   { width: auto; white-space: nowrap; border: 1px solid SEA.line }
```

> Rail becomes a horizontally scrollable strip above the pane. It stays a single `<nav>` of the same buttons — **no duplicate markup, so there is no second copy to keep in sync and nothing hidden from a screen reader.**

---

## The overlay chart (section `season`)

### What it draws

Two lines on one calendar-day axis:

- the average cumulative % path of the S&P 500 across a selectable window (10 / 20 / 50 years, or the whole 1928–2025 record) — the "seasonal" curve, **same construction as the published EquityClock chart**;
- the live year so far, re-based to the same prior year-end close.

> The point of putting them on one axis is the SPREAD: how far ahead of, or behind, its own seasonal script this year is running. **That number is the headline tile, not the two levels.**

### The basis, and why it changed

> Everything here is the **SPX CASH INDEX (Yahoo ^GSPC), price return only.** It used to be a back-adjusted ES continuous series over eight years, which meant the seasonal curve and the price axis were on a contract that does not exist as a level — and back-adjustment damps the percentage swings of older years. Cash removes both problems and buys 90 more years of sample. It also means the right-hand price axis is now a real index level you can compare to a quote.

### Two axes, one scale

> The left axis and the right axis are the SAME axis in two units — `right = YTD_BASE_PX × (1 + left/100)`. Both are drawn off the same tick positions, so the index level on the right is always the literal level that corresponds to the % on the left. **That is the only honest way to overlay this year's LEVEL on a seasonal % curve: an independently auto-scaled second axis would let the two lines cross wherever the scaling happened to put them and the crossings would mean nothing.**
>
> The mode toggle only picks which unit is primary… The lines do not move between modes; only the labels swap.

`pctToPx(p) = YTD_BASE_PX × (1 + p/100)` and `pxToPct(v) = v / YTD_BASE_PX − 1`, both exported as one-liners so the two directions cannot drift.

### Geometry

```ts
PAD = { top: 18, right: 82, bottom: 30, left: 62 }
RIGHT_GUTTER_WIDE = 132      // when any overlay is on
YEAR_LABEL_DX     = 56
CHART_H           = 430
N                 = 365
```

> the right gutter holds the second-unit axis labels. Overlay year labels need a second column out there or they land on top of the price ticks, so the gutter widens when any overlay is on.

`x(i) = PAD.left + innerW·i/(N−1)`; `y(v)` inverts into `innerH`. The y domain pads by **8%** (`(hi−lo)*0.08 || 1`) and, in `pct` mode only, is forced to contain 0.

`niceTicks(min, max, count=6)` steps on a 1 / 2 / 2.5 / 5 × 10ⁿ ladder and snaps a near-zero tick to exactly 0.

`y(v)` takes `number | undefined` on purpose:

> every caller reads it out of a series by index, and under `noUncheckedIndexedAccess` that is what an index gives you. A missing sample maps to NaN, and **an SVG element with a NaN coordinate is simply not drawn** — which is the honest picture of "there is no point here". The alternative was a non-null assertion at each of the fifteen call sites, which is the same claim made fifteen times and unchecked every time.

`fmtPct(v)` → `+3.41%` / `—`; `fmtPx(v)` → `6,412.35` / `—`. Both print an em dash for `undefined` or non-finite, "which is the readout saying 'no reading' instead of saying a number that is not one."

### There is no module-level `LIVE` constant any more

> The number of days of the current year we have is no longer fixed at build time — `useLiveYear` extends it after mount — so it is read per render from the hook. **A module const here was the bug: the chart's "not reached yet" shading, the hover cutoff and the headline tiles all pinned themselves to the build date and the orange line stopped moving until somebody regenerated the data.**

### Colours

```ts
SEASON_COLOR = HOME_THEME.green    // the average, the backdrop
YEAR_COLOR   = HOME_THEME.orange   // this year, the subject
INK          = HOME_THEME.text     // the only text colour here
```

Every wash is `alpha()` over a token, named once:

| Const | Value | Use |
|---|---|---|
| `GRID` | `alpha(T.text, 0.07)` | gridlines, month rules |
| `GRID_ZERO` | `alpha(T.text, 0.28)` | the zero line, in % mode |
| `CROSSHAIR` | `alpha(T.text, 0.35)` | the hover rule |
| `FUTURE_WASH` | `alpha(T.text, 0.025)` | the part of the year not reached yet |
| `WASH_03` | `alpha(T.text, 0.03)` | stat tile plate |
| `WASH_04` | `alpha(T.text, 0.04)` | an unselected chip |
| `WASH_06` | `alpha(T.text, 0.06)` | the Clear button |

> Every one is `alpha()` over a token rather than a typed rgba(): the value keeps tracking `--color-fg`, and `check-theme.mjs` bans the literal outright (non-negotiable #1). The two GRID values are the chart's zero line and its ordinary gridlines — a two-step contrast that says which line is the axis.

**The SVG rule, stated in three separate files:**

> These are CSS strings, so on an SVG element they go through `style`, **NEVER through a `stroke=` / `fill=` presentation attribute**: those are parsed as a `<paint>` and do not resolve `var()` or `color-mix()`, so the shape would render with no paint at all and nothing would warn.

### The five stat tiles

All measured at `last = LIVE − 1`, the last session we have:

| Label | Value |
|---|---|
| `2026 YTD` | `live.pct[last]` |
| `Seasonal to date` | `SEASONAL_AVG[last]` |
| *(the spread)* | `ytdPct − seasonToDate` — the headline |
| `Seasonal left in year` | `SEASONAL_AVG[364] − seasonToDate` |
| `Base` | `YTD_BASE_PX` |

Each read is `?? NaN` rather than asserted:

> `last` and `N − 1` are in range on a full year, but **the live series is EXTENDED as sessions arrive and is the one array here whose length is not a constant.** NaN flows into the formatters above, which print an em dash for it.

`StatTile` is `flex: 1 1 150px`, `minWidth 140`, `12px 14px`, `radius 10`, `1px HOME_THEME.border`, `background WASH_03`; label `text-2xs` weight 800 `letter-spacing .12em` uppercase, value `text-xl` weight 800 tabular, sub `text-xs`.

### The compare picker — four overlays and not one more

```ts
OVERLAY_SLOTS = [
  { color: "var(--color-sea-overlay-1)", dash: "" },
  { color: "var(--color-sea-overlay-2)", dash: "7 4" },
  { color: "var(--color-sea-overlay-3)", dash: "2 4" },
  { color: "var(--color-sea-overlay-4)", dash: "11 4 2 4" },
]
MAX_OVERLAYS = 4
```

> With the seasonal average and the live year already on the chart, six lines is the ceiling at which hues stay separable — **the palette validator's normal-vision floor fails past that, and that check is not one you can buy your way out of with a legend.** So each overlay carries THREE encodings, not one: its hue, its dash pattern, and a year label printed at the end of its own line. A colorblind reader, a greyscale print and a screenshot all still resolve which line is which.
>
> **If you ever want a fifth: facet the chart, don't add a hue.**

`tokens.css` declares the four hues in the same spirit — `--color-sea-overlay-1..4` = `#b48cff`, `#3ddc8e`, `#ff5fa2`, `#7fb0ff` — and says why they are not the series ramp:

> NOT `--color-series-1..6`: that ramp is tuned for categorical bars on a surface plate, and these are 1.8px lines over a near-black ground with two fixed hues (v2-green, v2-orange) already spoken for. overlay-1 is also the almanac's third bar hue, for the one chart that needs three (FOMC: before / during / after) — same series, same value, one token.

Overlays are held as **ids, not years**, in one ordered list:

> an overlay is either a single year ("2008") or one of the four election-cycle averages ("cycle:2"). One ordered list, because slot colors are assigned by position — two parallel lists would let a year and a cycle claim the same hue.

`overlays` starts **EMPTY, from a constant** — never seeded from the URL or localStorage, for the React #418 reason. `toggle(id)` refuses to add past `MAX_OVERLAYS`.

Quick picks: `[2022, 2020, 2018, 2008, 1987]`. `DECADES` is derived at module scope.

### The election-cycle averages

An overlay is normally ONE year; these four are averages across every year in the same slot of the four-year political cycle — "the thing people actually mean when they ask 'what does a midterm year look like'."

> The cycle slot is `year % 4`, and the mapping is **off by one from what you'd guess**: the election happens in the year divisible by 4 (1928, 2024), and the FIRST year of the resulting term is the year after it. So mod 1 is post-election, mod 2 is midterm, mod 3 is pre-election, mod 0 is the election year itself. **Sanity check: the group sizes this produces (25/24/24/25) match `ALMANAC.presidential.n` exactly — if a future data regen breaks that, this mapping is what to look at first.**

Display order is **not** the cycle's own order:

> midterm and election are what people came for, so they lead.

| id | Chip label | End-of-line label | mod | `ALMANAC.presidential` row |
|---|---|---|---:|---:|
| `cycle:2` | Midterm years | Midterm | 2 | 1 |
| `cycle:0` | Election years | Election | 0 | 3 |
| `cycle:1` | Post-election years | Post-elec | 1 | 0 |
| `cycle:3` | Pre-election years | Pre-elec | 3 | 2 |

`row` indexes `ALMANAC.presidential.index` — `["1 Post-election","2 Midterm","3 Pre-election","4 Election"]` — and the full-year averages in the chip tooltips are **READ from there rather than retyped**, "so a data regen can never leave the tooltip disagreeing with the Presidential Cycle card."

`cycleYears(mod)` keeps only full 365-point curves and **excludes the live year**:

> The live year is a PARTIAL curve (it stops at today). Averaging it in would drag the tail of the average toward zero for no reason and quietly change the shape of the very line the visitor is comparing against.

`cycleCurve(mod)` is computed once each on first use and cached in a module-level `Map`.

### Hover and the "not reached yet" wash

`onMove` maps the pointer to a day index; `dayLabel(idx)` builds a UTC date in 2026 and formats `Mon D` — 2026 is not a leap year, "so this doubles as the calendar map for the live series." `MONTHS` carries the same twelve non-leap day-of-year offsets as `calendar.ts`'s `MONTH_START`.

Everything past `LIVE` is washed with `FUTURE_WASH` and the hover is cut off there.


---

## The almanac half — `SeasonalityAlmanac.tsx`

### Its own contract

> All of it is precomputed at build time into `ALMANAC` / `EXTRAS` from the ^GSPC daily closes back to **1927-12-30**, plus **^VIX + ^GSPC daily OHLC from 1990** for the volatility-spike study — no fetch, no API route, no socket subscription. Pure static data plus SVG, which is why it renders instantly, works with the backend down, and can prerender for a cold visitor off a social link.

Four standing rules:

**Every table is collapsed by default, as a native `<details>`.**

> Native, not React state, for three reasons: it needs no client state to seed (so it cannot desync between the server and the first client paint), it is keyboard- and screen-reader-correct for free, and **Ctrl+F still finds text inside a closed `<details>` in current Chrome.** The charts and the stat tiles stay open — those are the scan layer; the tables are the drill-down.

**Every table prints its sample size.**

> A monthly mean built from 98 observations carries a standard error near 0.6pp, so most month-to-month differences on this page are not distinguishable from each other. **The `n` column is the honest part of a seasonality table and it is never optional.**

**Colour.**

> Return sign uses the app's candle pair (`ES_CANDLE_UP` / `ES_CANDLE_DOWN`), not `HOME_THEME.green`/`red` — those are the UI status palette. Every bar is drawn from a zero baseline, so direction carries the sign as well as the hue; **no reading here depends on telling green from red.**

**Text is white.**

> Hierarchy comes from size, weight and letter-spacing, never from dimming the ink. Translucency is reserved for chrome — gridlines, hairline borders, card fills.

Series hues: `A1 = HOME_THEME.cyan` ("all history"), `A2 = HOME_THEME.orange` ("modern era"), and a third for the one chart that needs three:

> `A3 = "var(--color-sea-overlay-1)"` — deliberately outside `HOME_THEME`, which carries no third categorical colour — its remaining slots are the up/down status pair and reusing either would put a sign meaning on a bar that has none. Same argument, and the same exception, as the overlay slots in `SeasonalityView`.

Washes: `GRID alpha(fg,.08)` · `GRID_ZERO alpha(fg,.32)` · `WASH_04` an unselected pill · `WASH_05` a hovered row / a bar track · `WASH_06` a table row rule. `HEAT_BASE = "var(--color-sea-heat-base)"` (`#141a21`) — and `tokens.css` says why it sits between `--color-surface2` and `--color-raised`:

> the neutral a heatmap cell starts from before it is mixed toward the up/down hue, so a zero cell reads as "no signal" rather than as a washed-out direction.

### Formatters

| Fn | Output |
|---|---|
| `pct(v, d=2)` | `+3.41%` / `−1.02%` — **U+2212 for negatives**, em dash for null |
| `pctp(v, d=1)` | `62.4%` — a share, unsigned |
| `bp(v, d=1)` | `+12.4 bp` — U+2212 for negatives |
| `n0(v)` | `12,438` |
| `signColor(v)` | null → `INK`, `>= 0` → `UP`, else `DOWN` |
| `fmtUS(iso)` | `M/D/YYYY`, parsed as **numbers**, "so a `YYYY-MM-DD` string never slips a day westward" |

### The chart primitives

| Component | Height | PAD | Notes |
|---|---:|---|---|
| `DivBars` | 240 | `{20,10,28,58}` | one diverging series from a zero baseline |
| `PairBars` | 260 | `{18,10,28,58}` | two series, `labelEvery` to thin the axis |
| `MultiBars` | 280 | `{22,10,28,62}` | N series; domain is `min(0,…)` to `max(0,…)` so zero is always in frame |
| `HBars` | `maxHeight 520`, `rowH 20` | — | two horizontal panels; `aColor`/`bColor` optional — omit to colour by sign |
| `HeatTable` | `maxHeight` optional | — | `width:100%` + `tableLayout:fixed` |
| `DataTable` | — | — | `Cell = { t, c?, bar? }` or a bare string/number |

`useMeasuredWidth()` is the callback-ref ResizeObserver, identical in spirit to the View's: disconnect, bail on null, observe, store.

`niceTicks(min, max, count=5)` — the same 1/2/2.5/5 ladder as the View's, with a tighter `1e-9` epsilon.

`barPath(x, w, yTop, h, up)` rounds **only the data end**:

> `up` decides which pair of corners is rounded — that is the whole point of hand-rolling this instead of using `<rect rx>`: **a rounded bottom on a positive bar detaches it from the axis it is measured against.**

Minimum bar height is `0.6`; the corner radius is `min(4, w/2, hh)`.

`heatFill(to, t) = mix(to, HEAT_BASE, t)`. `HeatTable`'s `newestFirst` reverses **labels and data together**:

> doing it at the call site means two reverses that can silently drift out of sync and mislabel every row, which is a bug nobody spots by eye.

And the width note:

> `width:100%` with `tableLayout:fixed` so the twelve month columns divide the FULL card width instead of sitting in a narrow 42px-per-cell block with dead space beside it. `minWidth` on the wrapper keeps it readable when the card itself is narrow (phone) — **it scrolls there instead of crushing.**

`Tile`: `flex 1 1 160px`, `minWidth 148`, `12px 14px`, `radius 10`, `1px HOME_THEME.border`, `background SEA.card2`; label `capLabel` (`text-2xs`, weight 800, `letter-spacing .14em`, uppercase), value `text-xl` weight 800 tabular. `TILES` is a wrapping flex row at `gap 12`.

`pillBtn(on)`: `5px 12px`, `radius 8`, border `HOME_THEME.cyan` when on else `HOME_THEME.border`, background a `linear-gradient(180deg, alpha(cyan,.2), alpha(cyan,.05))` when on else `WASH_04`, `text-xs` weight 800.

> Same visual language as `<Pills>`, but not that component: `Pills` owns a whole labelled row and one value, and these sections need several independent toggles sitting on ONE row (count, measure, ticker, event kind). **Sharing the style and not the layout is the smaller duplication.**

`STAT_HEAD = ["", "n", "Mean", "Median", "Positive", "Best", "Worst"]` — the seven columns every `Stat` renders as, with Best inked `UP` and Worst inked `DOWN` unconditionally.

### `Collapse` — `open` vs `autoOpen`

Two props that look interchangeable and are not:

> **`open`** — Start expanded. For a card whose ONLY content is this disclosure — it would otherwise render as a title and a closed bar with nothing under it. **A literal, never client state**: `open` derived at runtime would hydrate differently on the server and the client.
>
> **`autoOpen`** — Open AFTER mount, from something only the client can know — today's date, a fetched result. This is deliberately NOT `open`. `open` is baked into the server-rendered markup and must therefore be a literal; anything clock-dependent renders closed on the server (which built the page hours or days ago) and open on the client, which is **React #418** and a hydration mismatch on a page that prerenders. So the element ships CLOSED in the HTML and is opened by an effect.

The month-end section is the one that uses `autoOpen`, from `isLastTradingDayOfMonth(nyTodayISO())`.

---

## The three studies that fetch

Everything else on this page is static and cannot fail. These three can, and the page says which of the two it is.

### `useLiveYear()` — `/api/public-seasonality`

**The bug it exists to fix**, verbatim:

> Everything on `/explore/seasonality` is compiled into `seasonalityData.ts` at build time, including the orange "this year" line. That was fine for the 98 years of history and wrong for the current one: the line stopped at `YTD_LAST_DATE` and only moved when somebody regenerated the data file, so the headline "ahead of / behind season" number could be a week or a month old while the page looked live. **A visitor has no way to tell.**

So the static arrays became a **FLOOR, not the answer**.

```
GET /api/public-seasonality?since={YTD_LAST_DATE}
Accept: application/json
```

Response: `{ spx?: [string, number][], vix?: LiveVixEvent[] }`.

**Hydration:** the returned arrays are the STATIC ones on the first render, on both sides. The fetch runs in an effect and the extension lands in a state update afterwards — "never seeded during render, which is how this page would otherwise render one line on the server and another on the client."

**Failure is silent and correct:**

> No endpoint, no network, an error, a bad payload — the hook keeps the static arrays and `live` stays false. The page then behaves exactly as it did before this file existed. **A public page whose whole job is to render for an anonymous visitor must never show an error because an optional freshness call did not land.**

`extend(rows)` forward-fills exactly the way the generator does:

> a Monday close occupies Saturday and Sunday too — so the extended tail is drawn on the same axis as the 98 years behind it and a hover on a weekend reads the last close rather than a gap.

Three guards on every row: the date must be a string and the close must pass `okClose` (finite, `> 0`); `date <= lastDate` is skipped; and the axis is protected —

> a bad date must never write past slot 364 or backwards into a session already recorded

via `if (!Number.isFinite(idx) || idx < px.length - 1 || idx > 364) continue`.

The value written is `(close / YTD_BASE_PX − 1) * 100`. `added` counts real writes; **zero additions returns null**, so `live` stays false and `lastDate` does not move.

`LiveYear` is `{ pct, px, lastDate, live, extraVixEvents }`. `live` is true "once the extension landed AND it actually added a session."

**It is mounted TWICE and each mount fires its own request:**

> Mounted by BOTH `SeasonalityView` (the overlay chart) and `SeasonalityAlmanac` (the Jackson Hole row for the current year), and each mount fires its own request. That is one extra call on one route, against a response the server caches for ten minutes — **cheaper than threading the state through a context for two consumers, and it keeps either component mountable on its own.**

The same response also carries VIX spikes after the static cutoff, "so the 'After a VIX Spike' event list picks up a spike that happened this week off the same request rather than a second one." They are filtered client-side to `e.date > YTD_LAST_DATE`.

### `useDailySeries(symbol)` — `/api/public-daily`

Fired **only when the Apple section is active** (`useDailySeries(active === "aapl" ? "AAPL" : null)`). States: `idle` → `loading` → `ready` | `error`. Rows are validated per element — `Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'number' && Number.isFinite(x[1]) && x[1] > 0` — and an **empty result is treated as an error** (`throw new Error("empty")`). `AbortError` is swallowed.

### `useEarnings(enabled)` — `/api/public-earnings`

Fired only when the earnings section is active. One cached call returning `{ tickers: Record<string, EarningsMove[]> }`; an empty object is an error.

`EarningsMove` is `{ date, session, when, day, gap, oc }`:

- `date` — the report date as Yahoo carries it
- `session` — **the session the market reacted on** — the same day for a BMO print, the next for an AMC one
- `when` — `"BMO" | "AMC" | ""`
- `day` — reaction session close vs the prior close
- `gap` — reaction session open vs the prior close, "the gap the print produced"
- `oc` — reaction session open to close, "what was left to trade after the gap"

### `DataState` — the one place a section may say "no numbers"

> Every other card on this page renders from static data and therefore cannot fail. The three event studies fetch, so they can — and **a blank card is indistinguishable from a broken page. This says which of the two it is.**

Rendered as a dashed-border block on `SEA.card2`, `26px 16px`, `radius 12`, centred, `text-sm`:

- loading/idle: `` `Loading {what}…` ``
- error: `` `{what} could not be loaded right now. Everything else on this page is static and unaffected — reload to try again.` ``

Call sites: `the earnings calendar`, `` `${earnTicker}'s earnings history` `` (when the fetch is ready but that ticker has no rows), and `AAPL price history`.

---

## The section bodies

Every one is a `SeaCard` — which means every one carries the watermark.

### `now` — Where the Calendar Stands

Subtitle: `` `Last close ${now.as_of} · session ${now.trading_day_of_year} of the trading year` ``

Four tiles: `Rest of year · mean` (`since 1985 · {n} years`) · `Rest of year · positive` (`{k} of {n} years`) · `{win.window}` (`all history · {p} positive`) · `Worst rest-of-year` (`all history · {n} years`, inked `DOWN` unconditionally). Then a `Rest-of-year detail` collapse, hinted `by sample window`.

### `vix` — After a VIX Spike

Subtitle: `` `VIX prior close → high ≥ +20% · ${vix.meta.start} – ${vix.meta.end} · ${n0(sessions)} sessions` ``

The `+20%` bucket is found by `threshold === 0.2`. Four tiles:

| Label | Value | Sub |
|---|---|---|
| `Spike sessions` | `n0(v20.n)` | `{pct}% of all sessions since 1990` |
| `SPX low → next high` | `pct(avg)` | `median {…} · baseline {…}` |
| `Next day open → close` | `pct(avg)` | `{p} positive · baseline {…} / {…}` |
| `Spike day open → close` | `pct(avg)` | `what it took to get the spike` |

Then the event chart, and the reason it exists:

> The tiles above are averages over 284 events, which is the right number and the wrong picture: an average of +0.35% hides that the distribution runs from −6% to +7%. This draws the last N events individually, the pop beside the session it produced, so **the dispersion is the first thing you see and the mean is something you read INTO it rather than instead of it.**

Controls: `Last` `20` / `50` (`vixCount`, default 20) and a measure toggle `oc` / `lnh` (`vixMeasure`, default `oc`). Rows are `{ label: fmtUS(date), sub: 'VIX {open} → {high}', a: vix_pop, b: next_open_close | low_to_next_high }`.

**The live merge is list-only:**

> The TILES and the LADDER above the list stay static: those are aggregates over 9,000 sessions and a handful of new events cannot move them by a figure this page prints. The LIST is different — **a reader who came here the week after a spike is looking for that spike, and a list that stops three weeks ago reads as a broken page rather than a stale one.**

Extras are de-duplicated against `vix.events` by date, sorted newest-first and prepended.

### `fomc` — FOMC Decisions

Subtitle: `` `${n0(fomcRows.length)} announced decisions since ${earliestYear} · SPX around the statement` ``

**The windows**, calendar-week offsets on the forward-filled 365-day axis:

```
into  = D−5 → D−1   the two sessions before the statement
day   = D−1 → D     the statement session itself
after = D   → D+2   the two sessions after
```

> For a WEDNESDAY decision those are exactly Mon+Tue, the Wednesday, and Thu+Fri, **which is why the default sample is Wednesdays only.** Widen the sample and the windows are still right — they are just no longer those weekdays, so **the column headers change with the toggle rather than lying.**

```ts
L_INTO  = fomcWedOnly ? "Mon–Tue"  : "Two sessions before"
L_DAY   = fomcWedOnly ? "Wednesday": "Decision day"
L_AFTER = fomcWedOnly ? "Thu–Fri"  : "Two sessions after"
```

Sample pills (`FomcSample`, default `"wed"`):

| key | Label | Tile sub |
|---|---|---|
| `wed` | `Wednesday decisions` | `statement landed on a Wednesday` |
| `scheduled` | `All scheduled meetings` | `scheduled meetings only` |
| `all` | `Incl. emergency cuts` | `every announced decision` |

And the default's justification:

> "wed" is the default because it is the only sample where the Mon-Tue / Wednesday / Thu-Fri framing is literally true. The other two are there so a reader can see what the restriction costs — **and it costs a lot of the 1990s.**

Rows are built from `fomcDecisions()`, each gaining `dow` (derived by `dowOf`), `action` (`bps > 0` Hike / `< 0` Cut / else Hold) and the three windows, then `.reverse()`d — "Newest first, to match every other event list on this page."

Two roll-ups: **by action** (`Hike` / `Hold` / `Cut`, with `n`, the three means, and hit rates for `day` and `after`) and **by size** — `Hike 50bp or more` (`>= 50`) · `Hike 25bp` (`> 0 && < 50`) · `Hold` (`=== 0`) · `Cut 25bp` (`< 0 && > -50`) · `Cut 50bp or more` (`<= -50`) — asking "Does the SIZE of the move matter, or only its direction?"

`fomcNext` is the first `FOMC_UPCOMING` entry with `date > todayISO`; `fomcLast = fomcRows[0]` gives the current target, "read from the last decision, never typed in."

### `jh` — Jackson Hole

Subtitle: `` `Kansas City Fed symposium · ${oldest}–${newest} · SPX around the Friday keynote` ``

Computed here, not baked into the data file:

> because the only input that is not already in the bundle is the CALENDAR — the price data is the same `YEAR_CURVES` the overlay picker reads. Anchoring on the Friday keynote (the Chair's speech), the three windows are:
> `into` = the week ENDING the session before the speech (T−8 → T−1) · `day` = the speech session itself (T−1 → T) · `after` = the week from the speech (T → T+7).
> All three are calendar-week offsets on the forward-filled 365-day axis, **so T−8 and T+7 are the same weekday as T and land on real closes.**

The current year's row reads `live.pct` rather than `yearCurve(year)`, which is why the almanac mounts `useLiveYear` at all — the symposium "sits days past the static data's cutoff every August."

Four tiles: `Week into it` · `Keynote session` (sub `{p} positive · median day ±1%`) · `Week after` · `Next symposium` (value `fmtSpan(start, end)`, sub `` `{year} · keynote {fmtLongDate(keynote)}` ``). Then an `HBars` of keynote session vs week after, per year.

### `earn` — Earnings Reactions

Subtitle: `` `Last ${earnRows.length || 20} prints per name · the session that absorbed the report` ``

Ticker pills from `EARNINGS_TICKERS`, default the first. Four tiles: `Prints` · `Average move` (**absolute**, reaction session close-to-close) · `Up on the print` (`{k} of {n}`) · `Biggest / worst` (two spans, `UP` and `DOWN`, separated by ` / `).

Two `DataState` branches: the calendar itself failed, or the calendar is ready and this ticker has no rows.

### `aapl` — Apple Product Events

Subtitle: `` `${APPLE_EVENTS.length} keynotes, ${oldest}–${newest} · AAPL, split-adjusted` ``

Controls: event-kind pills (`All events` / `September / iPhone` / `WWDC` / `Spring` / `Fall Mac / iPad` / `Other`) and a chart count (`last 20` / `last 50`).

**`sessionFor(iso)`** binary-searches the daily series for the session the market first reacts on:

> Exact hit = the keynote fell on a session, which is the normal case (Apple runs these at 10:00 PT, mid-session). Otherwise the reaction is the NEXT session, not the previous one.

Five windows per event, in **sessions**, not calendar days:

```
into  = ret(i − 6, i − 1)   the five sessions before the keynote
day   = ret(i − 1, i)       the keynote session
next  = ret(i,     i + 1)   the morning after
week  = ret(i,     i + 5)   the week from the keynote
month = ret(i,     i + 21)  ~one month from the keynote
```

`ret(a, b)` returns null for out-of-range indexes and `?? NaN` otherwise — "a NaN ratio is caught by the caller's own `Number.isFinite` guard exactly as an out-of-range read was."

Four tiles: `Events` · `Week into it` · `Day of the event` · `Week after` (sub carries `month after {…}`), all at **one** decimal. Plus `appleByKind` — the per-kind summary "the table is too long to give".

### The calendar-shape sections

| key | Title | Subtitle |
|---|---|---|
| `month` | `Month by Month` | `` `${symbol} monthly returns · ${startYear}–${endYear}` `` |
| `six` | `The Two Half-Years` | `Nov–Apr against May–Oct, compounded within each season` |
| `tdom` | `Turn of the Month` | `Mean session return by trading day of month` |
| `dow` | `Day of Week` | `Mean session return by weekday` |
| `opex` | `Opex Week & the Week After` | `Third-Friday expiration, monthly and quarterly` |
| `cycles` | `Presidential & Decennial Cycles` | `Mean calendar-year return, price only` |
| `vol` | `Volatility by Month` | `Annualized standard deviation of daily returns` |
| `decade` | `Has the Seasonal Shape Moved?` | `Mean monthly return by decade, % · newest first` |
| `matrix` | `Every Month, Every Year` | `` `${years.length} years of monthly returns, % · newest first` `` |
| `baro` | `Early-Year Barometers` | `What the full year did after each signal window` |
| `eom` | *(month-end)* | uses `autoOpen` from `isLastTradingDayOfMonth` |

`month` and `dow` each carry an **era** pill row (`ERA_KEYS`, default `ERA_KEYS[0]`), and the two eras are independent state (`era` and `dowEra`). `sixMonth` reorders to put `Nov-Apr` before `May-Oct` by looking the two labels up in `sm.index` and filtering out anything missing.

`decade` and `matrix` are `HeatTable`s with `newestFirst`.

### The asserted reads

```ts
const [era, setEra] = useState<string>(ERA_KEYS[0]!)
```

> `ERA_KEYS`, `EARNINGS_TICKERS`, `ALMANAC`'s tables and `EXTRAS.vix` are module-level literals with entries — `[0]` exists. Under `noUncheckedIndexedAccess` an index still says `T | undefined`, so **the assertion is made ONCE here, at the declaration, rather than at each of the sixty places these are read. If one of those constants is ever emptied, this line is where it will break.**

### The clock, read in an effect

```ts
const [isMonthEnd, setIsMonthEnd] = useState(false)
const [todayISO, setTodayISO]     = useState("")
useEffect(() => { try { const t = nyTodayISO(); setTodayISO(t); setIsMonthEnd(isLastTradingDayOfMonth(t)) } catch {} }, [])
```

`todayISO` starting empty is **the correct server value**:

> `FOMC_UPCOMING` holds only future meetings, so "the first one after ''" is the first one, which is what the server should render anyway. The effect only narrows it.

The `catch` is for an environment with no `Intl` — "leave the section as it was."

---

## `calendar.ts` — two jobs, kept separate

> 1. **Mapping a date onto the 365-day seasonal axis** … 2. **Answering "is today the last trading day of the month"**. Used to decide whether the month-end section opens itself. Must be evaluated in **America/New_York — the market's clock, not the visitor's** — or a reader in Sydney gets tomorrow's answer and a reader in Los Angeles gets the right one only after 9pm.

And the standing prohibition:

> **NOTHING HERE MAY BE CALLED DURING RENDER TO SEED STATE.** Both jobs depend on the wall clock, and the server and the client do not run at the same instant. Call these inside an effect.

| Export | Contract |
|---|---|
| `MONTH_START` | `[0,31,59,90,120,151,181,212,243,273,304,334]` — non-leap day-of-year of the 1st |
| `MONTH_ABBR` | `Jan`…`Dec` |
| `parseISO(iso)` | `[y, m, d]` as numbers, **no Date object**. A malformed string lands on NaN, "which is what `[y, m, d]` produced before as well" |
| `calIndex(iso)` | `MONTH_START[m−1] + (d−1)`, `?? NaN` on an out-of-range month |
| `fmtUSDate` | `M/D/YYYY` |
| `fmtLongDate` | `Mon D, YYYY` |
| `fmtSpan(a, b)` | `Aug 27–29` when the months match, `Aug 30 – Sep 1` when they do not, `Aug 27` when the days match too |
| `nyTodayISO()` | `en-CA` in `America/New_York` — "the locale trick that yields ISO order directly". **EFFECT ONLY** |
| `dowOf(iso)` | `Mon`…`Sun`, **derived, never stored** |
| `isMarketHoliday(y,m,d)` | weekends plus ten US market holidays |
| `lastTradingDayOfMonth(y,m)` | walks back from the last calendar day |
| `isLastTradingDayOfMonth(iso)` | `lastTradingDayOfMonth(y,m) === iso` |

`dowOf`'s note is a small lesson in normalisation:

> DERIVED, never stored alongside the date in a data file. A weekday written down next to a date is a second copy of the same fact, and the two drift the first time somebody corrects the date and not the label — **which on the FOMC table would silently move a decision in or out of the Wednesday sample.**

`isMarketHoliday` covers New Year's Day (observed), MLK (3rd Mon Jan), Washington's Birthday (3rd Mon Feb), **Good Friday** (Easter minus 2, via the anonymous Gregorian algorithm), Memorial Day (last Mon May), **Juneteenth from 2022**, Independence Day (observed), Labor Day (1st Mon Sep), Thanksgiving (4th Thu Nov), Christmas (observed). Observed rules move a Saturday holiday to the Friday and a Sunday one to the Monday.

The scope note is explicit about both the over-coverage and the gap:

> The full list is here rather than only the two holidays that can actually land on a month's last weekday (Good Friday, Memorial Day), because a reader of this function should not have to re-derive that argument to trust it, and the extra branches cost nothing. **Ad-hoc closures — a funeral, Sandy — are NOT modelled; the cost of missing one is that the month-end section opens itself a day early once in a decade.**

`isLastTradingDayOfMonth` is false on a weekend **by construction**:

> the last session already passed — which is the honest answer: the study is about a session, and there isn't one.

---

## `eventDates.ts` — the hand-maintained calendars

> HAND-MAINTAINED, not auto-generated — unlike `seasonalityData.ts`, which is recomputed from price history. These are CALENDARS: the dates the world put on a schedule. There is no feed for them, so they are typed in once, sourced, and appended to once a year.
>
> Every date below was confirmed against a primary source. **Do NOT add a row you have not confirmed — the whole value of an event study is that the anchor date is right, and a wrong anchor silently produces a plausible-looking wrong number rather than an error.**
>
> The RETURNS around these dates are NOT stored here. They are computed at render time… **That keeps this file a calendar and nothing else, so appending next year's date is a one-line change with no data regeneration.**

### `JACKSON_HOLE`

`{ year, start, end, keynote, theme, note? }`, newest first, **1990 to 2026**.

> Thursday–Saturday in late August, and the **FRIDAY** is the one that matters: that is when the Chair speaks. `keynote` is the anchor every number in the UI is measured from.

Sources named: Kansas City Fed press releases and the symposium proceedings archive, the RePEc/Fed-in-Print proceedings series, and the Federal Reserve Board speech archive.

**Two years break the pattern, and both are marked in `note`:**

- **2020** — virtual, TWO days, and **the keynote was on the THURSDAY** (`2020-08-27`).
- **2021** — planned in-person Aug 26–28, then moved online and compressed to ONE day, Friday Aug 27. "Recorded as held, not as scheduled."

Two more carry a `note` for a different reason: **2015** and **2013** — "No Chair keynote — Yellen/Bernanke did not attend."

**Four years spill into September:** 1995, 2001, 2007, 2012.

1990 is the floor "because that is where the VIX study's data starts and it is already far more history than the event has signal."

### `APPLE_EVENTS` / `APPLE_EVENT_KINDS`

`{ date, name, kind, headline }`, **newest first — the table renders in this order.** `date` is the keynote day, **US Pacific**.

| kind | Covers |
|---|---|
| `wwdc` | the WWDC opening keynote (software, developers) |
| `september` | the annual fall iPhone keynote, **even the years it slipped to October** (2011 "Let's Talk iPhone", 2020 "Hi, Speed") |
| `spring` | a spring / March–May event |
| `october` | a fall Mac & iPad event, **including 2020's November "One More Thing"** |
| `other` | Macworld keynotes and one-off announcement events |

Filter pills, in order: `All events` · `September / iPhone` · `WWDC` · `Spring` · `Fall Mac / iPad` · `Other`.

Sources: Apple's own newsroom and event pages, MacRumors' event guide, and the appleinvites.com invitation archive.

### `FOMC_ROWS` → `fomcDecisions()`

Stored as a **tuple**, `[announcement date, meeting start ("" when same day), bps change, target after, 1 = scheduled]`:

> kept as a tuple because 269 objects is a wall of repeated keys

`fomcDecisions()` decodes once on first use into `{ date, start, bps, level, scheduled }`, **oldest first**, with `start: start || date`. `level` is the target after the decision, **the upper bound of the range from 2008-12-16**. `scheduled: false` marks an intermeeting action — a conference call, not a scheduled meeting. Coverage begins **1994-02-04**.

### `FOMC_UPCOMING`

`{ start, date, sep }` — `date` is the day the decision lands, i.e. the second day of the meeting.

> Hand-maintained from the Fed's published calendar. Rows that have happened move into `FOMC_ROWS` with their outcome; **this list only ever holds the future, so a stale entry here shows as a date in the past and is obvious on sight.**

### `EARNINGS_TICKERS`

Sixteen names: `AAPL MSFT NVDA AMZN GOOGL META TSLA AMD AVGO NFLX MU PLTR COIN SMCI HOOD MSTR`.

> Deliberately SHORT: every ticker here costs the server one Yahoo earnings-calendar query plus one price history fetch, and the point of the study is the handful of names whose prints move the index, not breadth.
>
> It is NOT `lib/scannerTickers.ts`. That list is the scanner's sweep universe (169 symbols including indices and ETFs, which do not report earnings) and **pointing this at it would turn one cached response into 130 upstream calls.**

---

## Theme, surfaces and the watermark

### `seaTheme.ts` — six surfaces by ROLE

```
app     the page ground, behind everything      --color-app     #0a0d10
rail    the section nav, one step up             --color-rail    #0a0d10
shell   the pane the cards sit on                --color-bg      #0a0d10
card    a card's own fill                        --color-surface #0e1216
card2   a tile or an open disclosure INSIDE a card --color-surface2 #141a21
cardHi  a hovered or selected surface            --color-raised  color-mix(#141a21 92%, #e7ece9)
line    alpha(T.text, 0.14)   lineSoft  alpha(T.text, 0.07)
```

> The six steps below are v3's OWN surface ladder, read out of `tokens.css` rather than typed here. **The file survives as a NAME layer:** `SEA.card2` says "a tile inside a card" where `var(--color-surface2)` says only which step it is.

Why they are TS strings and not classes:

> Cards are painted through `SeaCard`'s inline style because the shared `Card` sets its background inline, and **an inline style cannot be overridden by a class.**

`line` is lighter than `HOME_THEME.border` on purpose: "these grounds are much darker, so the app's 10% white edge disappears against them."

And the canvas caveat:

> EVERY value here is a CSS string. Nothing in this folder paints a canvas, so `var()`/`color-mix()` is safe throughout; if that ever changes, resolve through `tokenHex()` from `design/theme.ts` rather than typing a hex back in here.

### `homeTheme.ts` — a name bridge, nothing more

> This file used to satisfy that by carrying v2's hexes verbatim — a second copy of a palette v3 already holds, which is exactly the drift `check-theme` exists to stop (**53 literals**, non-negotiable #1). So it is now a NAME BRIDGE and nothing else.

`HOME_THEME` maps `bg / panel / cyan / purple / orange / green / red / muted / text / border / panelBg / panelBgStrong` onto `V2.*`, `V2W.*` and `T.*`. `green` carries the standing warning: **"v2's `green` is a LIGHT BLUE (#8ECAE6), not a positive/up colour."**

It was **trimmed deliberately**:

> v2's `homeTheme` carried the whole app's card system, dock theme, level colours and refresh button. Nothing in this folder imported any of it, and **a dead copy of a palette is the thing that drifts first.**

`ES_CANDLE_UP` / `ES_CANDLE_DOWN` are re-exported from `design/theme` with their own justification:

> Deliberately NOT `HOME_THEME.green` / `.red`: those are the UI's status palette (a light blue and a flat alert red). **Bars want the saturated trading pair.**

`classicCardStyle`: `background panelBg`, `backdrop-filter blur(16px)` (+ `-webkit-`), `radius 18`, `1px border`, `box-shadow 0 18px 40px alpha(SHADOW, .22)`. `classicCardAccentStyle` is the same with the background restated — "solid frosted panel, no radial highlight."

### `Watermark.tsx`

Ported from v2 with exactly two imports replaced, both explained:

> `@/components/shared/PageCard` → the local `Card` below. v2's `Card` carries a `.card-hover` class that only exists in v2's `globals.css` and a variant switch this page never uses; `SeaCard` overrides the fill and the edge anyway, so **what survives the override is a padded box with a title row.** That is what is reproduced here, inline, rather than dragging a shared primitive across the wall for one caller.
>
> `@/lib/brand` → `BRAND_LOGO_SRC`. Same string, same asset: v3 is served from the same origin as v2, so `/cbedge3.0.png` resolves from v2's `public/`. **Deliberately NOT `src/assets/cbedge-mark.svg` — that is the square badge, and this corner wants the horizontal 3.0 lockup.**

The mark: `position absolute`, `top/right = inset` (default **14**), `zIndex 4`, `lineHeight 0`, `pointerEvents: none`, `aria-hidden`, `<img>` at `width 104`, `height auto`, `opacity 0.34`, `userSelect none`, `display block`.

> ONE MARK PER CARD, top right, so exactly one appears in a screenshot. The lockup is white artwork on a transparent ground and only reads on the dark card underneath, which is the only place this is ever mounted. `pointerEvents: none` keeps it out of every hover target; `aria-hidden` keeps it out of the accessibility tree, **because it is branding, not content.**

The private `Card`: `padding` default **24**, title `text-sm` weight 800 `letter-spacing .12em` uppercase in `HOME_THEME.text`, subtitle `text-xs` in `HOME_THEME.green`, `marginBottom 16` on the header block.

`SeaCard` wraps it at `padding` default **20**, forcing `position: relative`, `background: SEA.card`, `border: 1px solid SEA.line`, `boxShadow: 'none'`, and mounting the `Watermark`:

> Every seasonality card goes through this rather than `Card` directly, **so no card can ship unmarked and the mark's position is defined once.**

`--color-sea-on-accent` (`#071026`) is the ink on a solid v2-cyan fill (the "Click to open" pill), and `tokens.css` insists:

> Solid, never a white at an opacity — a translucent label lets the fill read through it and stops being legible.

---

## Rendering, performance and phone

**DOM/canvas:** everything on this page is **hand-rolled inline SVG and HTML tables. There is no canvas anywhere**, no `ChartFrame`, no `data-cb-layer`, no chart library, and no rAF loop. Non-negotiables 5, 6 and 7 have nothing to bite on.

**Per-frame machinery:** none. Redraws are React renders triggered by a hover index, a pill click, a ResizeObserver callback or the one state update from `useLiveYear`. The only continuous work is `pointermove` on the overlay chart and on the six almanac chart primitives, each setting a single `hover` index.

**The one real perf lever is mounting one section at a time**, and it is stated twice — once in each component — as an explicit rejection of a display toggle. Everything else's ResizeObserver, SVG tree and hover handler is genuinely unmounted.

**Hydration discipline** is the recurring theme. Four separate mechanisms:

1. Chart width starts at **0 on both sides** and is filled by a ResizeObserver after mount.
2. The active section starts from a **constant**, and the hash is applied in an effect.
3. Overlay years and the baseline key start from constants, never from storage or the URL.
4. `Collapse` separates `open` (a literal, server-rendered) from `autoOpen` (an effect).

All four cite React #418 by number.

**Bundle:** the component half is measured against `route` (59 100 brotli bytes); `data-seasonality-*` — `seasonalityData.ts` **and** `eventDates.ts` — against `data` (78 000, a first number awaiting a ratchet). The route is `lazy()`, so nothing here is in the entry chunk. There is no `prefetch` on the rail entry.

**Theme compliance.** No file under `src/pages/seasonality/` appears in `theme-baseline.json`, and neither does `src/pages/Seasonality.tsx` — all ten are at zero colour literals. That is the whole point of `homeTheme.ts` having become a name bridge: the file's own header records that carrying v2's hexes verbatim cost **53 literals**, and `check:theme` now fails the build on the first one that comes back.

**Phone:**

- `/seasonality` is **not** in `DESKTOP_TO_MOBILE` in `src/mobile/mobileNav.ts`, so a phone renders the desktop route inside the desktop shell. There is no `/m/*` equivalent.
- The page's own breakpoint is **`max-width: 860px`** in `SHELL_CSS`: the 225px rail collapses to a horizontally scrollable strip above the pane, the grid becomes one column, and rail items gain a `SEA.line` border and `white-space: nowrap`. It stays **one `<nav>` of the same buttons** — no duplicate markup.
- `useIsPhone()` (`PHONE_MAX_WIDTH = 820`) is **not called by any file in this folder**; 860 is the page's own number and does not match it.
- `HeatTable`'s wrapper carries a `minWidth`, so the matrix and decade heatmaps **scroll rather than crush** on a narrow card.
- Stat tiles are `flex: 1 1 150px` / `1 1 160px` with `minWidth` 140 / 148, so they reflow to one or two per row.
- Hover readouts drive the charts' detail, and `pointermove` on a touch device fires only during a drag — so the crosshair readouts are effectively desktop-only.

---

## Status and empty-state messages, verbatim

| String | When |
|---|---|
| `The almanac is part of a subscription` | `isLoaded && !isPaid` |
| `98 years of S&P 500 seasonality, the FOMC and opex studies, and every Apple keynote since 2007 — month by month, day of week, turn of the month, with the sample size printed on every table.` | the same block |
| `See plans` / `Sign in` | signed in / signed out |
| `Or read the free version` | always, in the upsell |
| *(nothing at all)* | `!isLoaded` — the route returns `null` |
| `Loading the earnings calendar…` | the earnings fetch is in flight |
| `the earnings calendar could not be loaded right now. Everything else on this page is static and unaffected — reload to try again.` | the earnings fetch failed |
| `{TICKER}'s earnings history could not be loaded right now. …` | ready, but that ticker has no rows |
| `Loading AAPL price history…` / `AAPL price history could not be loaded right now. …` | the Apple section's fetch |
| `—` | any null figure, from `pct` / `pctp` / `bp` / `n0` / `fmtPct` / `fmtPx` |

There is **no error state for `useLiveYear`** — by design. There is no global loading state for the page: the static half renders on the first frame.

---

## Gotchas


2. **The `manualChunks` matcher takes `eventDates.ts` too**, so the 580-line hand-maintained calendar is measured against the `data` budget, not `route`. The chunk name "is matched by prefix on both sides — keep them in step": change the regex without changing `check-budgets.mjs`'s `data-*` classifier and the chunk silently starts being measured against `route`.

3. **`budgets.json`'s `data: 78000` is explicitly a guess** — "taken from the brotli weight of the SOURCES before the chunk had ever been built — ratchet it after the first real build." Ratchet it with `npm run budgets:ratchet` after a real build; a budget carrying that much headroom has stopped enforcing anything.

4. **The paid gate is chrome twice over, and the file says so:** the almanac's numbers ship in the route chunk, and the free page serves most of them to anyone. Nothing here is a security boundary.

5. **The overlay chart's two axes are one axis.** Anyone "fixing" the right-hand scale to auto-fit independently breaks the only thing that makes the two lines comparable.

6. **The 365-slot axis drops 29 February.** Any new study that computes an index from a `Date` object rather than `calIndex` will be a day out in every leap year, silently.

7. **`useLiveYear` is mounted twice and fires two requests** — deliberately, against a ten-minute server cache.

8. **`useLiveYear` fails completely silently.** A dead `/api/public-seasonality` is indistinguishable from a fresh data regen: the orange line simply stops where the static file stopped.

9. **`useLiveYear` extends `px`/`pct` in place, so `LIVE` is no longer a build-time constant.** A module-level `LIVE` was the original bug; the file carries a standing note not to reintroduce one.

10. **Cycle averages exclude the live year on purpose.** Including it drags the tail of the average toward zero and changes the shape of the very line being compared against.

11. **The cycle→`row` mapping is off by one from intuition**, and the only check on it is that the group sizes match `ALMANAC.presidential.n` — a data regen that changes those counts silently invalidates four tooltips.

12. **Four overlays is a hard ceiling with a hue budget behind it**, not an arbitrary limit. The file's instruction if a fifth is wanted: facet, don't add a hue.

13. **SVG colours must go through `style`, never `fill=` / `stroke=`.** A `var()` in a presentation attribute renders unpainted with nothing to warn you. Stated in `SeasonalityView.tsx`, `SeasonalityAlmanac.tsx`, `seaTheme.ts` and `homeTheme.ts`.

14. **`Collapse`'s `open` must be a literal.** Deriving it at runtime is React #418. `autoOpen` exists for exactly that case and ships the element closed in the HTML.

15. **`nyTodayISO()` / `isLastTradingDayOfMonth()` must never be called during render.** `calendar.ts` says so at the top; both depend on the wall clock.

16. **`isMarketHoliday` does not model ad-hoc closures** (a funeral, Sandy) — "the cost of missing one is that the month-end section opens itself a day early once in a decade."

17. **Jackson Hole 2020's keynote was a Thursday and 2021 was a single day.** Both are `note`d rows; anything that assumes Thursday→Saturday with a Friday keynote will mis-anchor them.

18. **Two Jackson Hole years had no Chair keynote at all** (2013, 2015) and are still in the sample with their windows computed.

19. **`FOMC_UPCOMING` is hand-maintained and holds only the future.** A stale entry shows as a past date in the "Next meeting" tile.

20. **The FOMC column headers change with the sample toggle** — that is the fix, not a bug. Widening past `wed` makes "Mon–Tue / Wednesday / Thu–Fri" false, so the labels become generic.

21. **Apple event windows are in SESSIONS, not calendar days**, and `sessionFor` resolves a non-session keynote to the **next** session, never the previous one.

22. **The VIX section's tiles and ladder stay static while its list merges live events.** A spike from this week appears in the list and moves none of the aggregates.

23. **`ERA_KEYS[0]!` and friends are asserted once at the declaration.** Emptying any of those constants breaks there, not at one of sixty read sites.

24. **The page's phone breakpoint is 860px and `useIsPhone()`'s is 820px, and this folder never calls `useIsPhone()`.** The two numbers are independent by construction.

25. **`SeasonalityView` and `SeasonalityAlmanac` read no session, no cookie and nothing auth-shaped**, because the same components render on the public page for signed-out visitors. Adding an auth read to either would blank the page for exactly the audience it exists to convert.

26. **The watermark is `<img src="/cbedge3.0.png">` from v2's `public/`** — a cross-wing asset dependency, correct only while v3 is served from the same origin as v2.

27. **Every hash in `sections.ts` is a public URL.** Renaming one breaks links people have already pasted.

28. **`sectionForHash` returns `null` for an unknown fragment**, which leaves the default section mounted and the URL untouched — so a mistyped hash looks like it worked.
