# `/traders-dashboard` — Traders Dashboard

**Route.** `/v3/traders-dashboard`. Registered in `src/App.tsx:189` as `<Route path="/traders-dashboard" element={<TradersDashboard />} />`, behind `const TradersDashboard = lazy(() => import('@/pages/TradersDashboard'))` (`src/App.tsx:28`). Rail entry in `src/shell/Shell.tsx:102–107`:

```
{
  to: '/traders-dashboard',
  label: 'Traders Dash',
  icon: '📊',
  prefetch: ['/api/traders-dashboard/overview'],
}
```

A hard refresh is answered by `app/v3/traders-dashboard/route.ts` in the v2 repo — step 4 of AGENTS.md's four-step "Adding a page". Miss it and the page works in-app but 404s on a shared link.

**Sources.**

| Path | Role |
|---|---|
| `src/pages/TradersDashboard.tsx` | the page — countdown, overview, widgets, prefs I/O, `ALL_PAGES` / `LIVE_ROUTES` |
| `src/pages/tradersDashboard/SectorWheelCard.tsx` | the wheel's render layer, interaction state and pop-out |
| `src/pages/tradersDashboard/wheelMath.ts` | the wheel's geometry, hierarchy, palette and callout placer |

**Companions it must move with.** `src/App.tsx` (the `<Route>` table) and `src/shell/Shell.tsx` (`NAV`). See "The three lists that move together" below.

---

## What it is, in one paragraph

Traders Dashboard is the pre-market cockpit: the screen a trader opens before the bell and leaves up while they get ready. The left column is a giant countdown to the next open (or to the close while the tape is live) and the Overnight Market Overview — an AI sentiment paragraph written at 07:00 ET, the three overnight index futures, a single-ranked Trending Now list, and the day's key macro drivers. The right column is the personal half: a Morning Schedule, a Pre-Market Tasks checklist with a progress bar, the S&P Sector Wheel (a sector → industry → ticker sunburst with a pop-out and a fullscreen mode), and Quick Links to other v3 pages. Everything personal lives in one Postgres row keyed to the account, so it follows the trader between browsers, and there is deliberately **no localStorage mirror**. It is a port of v2's `/app/traders-dashboard` plus `components/dashboard/ SectorSunburst.tsx` against `docs/parity/traders-dashboard.md`, 168 rows — one per rendered value. The page header says it plainly: *"Change a threshold, a label or a sort here and change it there too; that file is what the next person diffs against, not this one."*

---

## File map

| File | Lines | What it owns |
|---|---|---|
| `src/pages/TradersDashboard.tsx` | 1150 | `MARKET_HOLIDAYS`, `FUTURES`, `DEFAULT_SCHEDULE/TASKS/LINKS`, `ALL_PAGES`, `LIVE_ROUTES`, `DRIVER_COLORS`, the prefs load/save/flush machinery, `useCountdown`, `CountdownCard`, `OverviewCard`, `ScheduleCard`, `TasksCard`, `QuickLinksCard`, `WeatherWidget`, `HeaderLink`, `WheelFallback`, and the two-column page |
| `src/pages/tradersDashboard/SectorWheelCard.tsx` | 824 | `useInView`, the memoised `WheelSvg`, `MoverList`, the card / pop-out / fullscreen shell, the tooltip, the CopyShot registration |
| `src/pages/tradersDashboard/wheelMath.ts` | 394 | `WheelRow`/`WheelPayload`, `VB`/`R`/`R0`/`AMP`/`CLAMP`/`CAPS`/`R_CALL`/`RING_*`, `SECTOR_SHORT`, `arcPath`/`pt`/`px`/`py`/`angOverlap`/`textW`, `buildHierarchy`, `wheelPalette`, `buildCallouts`, `sectorRank`, `fmtWheelPct` |

---

## The three lists that move together

This is the page's one cross-file invariant and it is called out in three separate headers.

`src/shell/Shell.tsx:89–91`, above `NAV`:

> The BOARD CARDS named Multi Greek / GEX Candles / Key Levels are a different thing and they stay — see `src/board/catalog.tsx`. This list, `App.tsx`'s routes and `ALL_PAGES`/`LIVE_ROUTES` in `pages/TradersDashboard.tsx` move together.

`TradersDashboard.tsx`, above `ALL_PAGES`:

> v3's own destination catalog, not v2's — the two apps do not share routes. Everything except `LIVE_ROUTES` below is a page this dashboard can point at once it exists; until then a configured link renders dimmed, the same way `Shell.tsx`'s rail marks an unbuilt icon "coming soon" rather than 404ing.

…and above `LIVE_ROUTES`:

> Which of the above actually have a `<Route>` in `App.tsx` today. The rest are real future destinations, not dead links, so they stay in the picker and render inert until they land — `App.tsx`'s no-catch-all rule means a link to an unregistered route would hit `NotFound`, which is a worse lie than a tile that plainly says "coming soon". Keep this in step with `App.tsx` and with `NAV` in `shell/Shell.tsx`; those three lists move together.

### `ALL_PAGES` — the Quick Links picker's catalogue, in order

| Label | href | Live today? |
|---|---|---|
| Home | `/` | ✅ |
| Multi Greek | `/mult-greek` | ❌ (note the spelling — `mult`, not `multi`) |
| Traders Dashboard | `/traders-dashboard` | ✅ |
| Premarket Prep | `/premarket` | ✅ |
| Board | `/board` | ❌ **not in `LIVE_ROUTES`** although `App.tsx:177` registers it — see Gotchas |
| Options Chain | `/options-chain` | ✅ |
| Chain | `/chain` | ✅ |
| Est. Moves | `/em` | ✅ |
| Economic Calendar | `/economic-calendar` | ✅ |
| Analysis | `/analytics` | ✅ |
| Replay | `/replay` | ✅ |
| Flow | `/flow` | ✅ |
| ES Candles | `/es-candles` | ❌ |
| Scanner | `/scanner` | ✅ |
| Level Log | `/level-log` | ✅ |
| ICT | `/ict` | ❌ |
| Test Lab | `/test` | ⚠ in `LIVE_ROUTES` but **no `<Route>` in `App.tsx`** — see Gotchas |
| Journal | `/trading` | ⚠ same |
| Almanac | `/seasonality` | ✅ (subscriber-only in the rail) |
| v2 Legacy | `/legacy` | ✅ |

Almanac carries its own comment: it is `NAV.paidOnly` in the rail but is **left in this picker for everyone on purpose** — *"the page shows a plan pitch rather than a dead end, so a free account that saved the link before its trial ended lands on the offer instead of a broken tile."*

v2 Legacy is not a dashboard page at all — it is the v2 door (`src/pages/Legacy.tsx`) — and it gets a slot *"for anyone whose day still runs through a page v3 has not ported."*

### `LIVE_ROUTES`, verbatim

```
'/', '/traders-dashboard', '/premarket', '/options-chain', '/chain',
'/analytics', '/flow', '/em', '/economic-calendar', '/replay', '/scanner',
'/level-log', '/seasonality', '/legacy', '/trading', '/test'
```

A Quick Link whose `href` is in this set renders as a real `<Link>` with a cyan `→` and hover states (`hover:border-accent hover:bg-raised`). One that is not renders as a `<span>` with `cursor-not-allowed`, `text-faint opacity-50` and `title="{label} — coming soon"`. The arrow loses its colour too.

### What came out of `NAV`, and why it matters here

`Shell.tsx:78–88` records the 2026-08-30 cull: Scanner, Test Lab and Journal (built, then retired) and Multi Greek, Board, ES Candles and ICT (never more than a dimmed "coming soon" icon) all left the rail, because *"an icon for a page nobody is going to build is the same lie `comingSoon` exists to avoid."* Scanner came back 2026-09-02, ported against the 1,525-row checklist. Test Lab and Journal are still out of the rail but are still in `LIVE_ROUTES` here — that mismatch is real and is in the Gotchas.

---

## Deliberate departures from v2

Recorded at the top of `TradersDashboard.tsx`, all five in the parity file's build log:

1. **Trending Now is sorted highest → lowest.** v2 rendered the API's `[...top5, ...bottom5.reverse()]` array as-is, so the list ran best-first and then worst-first — *"two descents with a cliff in the middle."* Brandon, 2026-08-30: one ranking, positives down to negatives.
2. **Up is blue, down is red** (same call). v2's `HOME_THEME.green` is in fact a light blue; it comes across as `--color-move-up` rather than being recoloured to v3's green `--color-up`.
3. **Prefs are server-backed and nowhere else** — Postgres `td_user_prefs`, one row per user, via `/api/traders-dashboard`. No localStorage copy.
4. **No snapshot button** for the page as a whole. v2's `CopySnapButton` needs a DOM-to-canvas renderer v3 does not ship. **Still open.** (The wheel's pop-out has its own camera through `shell/CopyShot.tsx`; the page does not.)
5. **Both header buttons are real links.** The Economic Calendar one was inert until `/economic-calendar` landed in `App.tsx` (and `app/v3/economic-calendar/route.ts` for the hard refresh); it is now a `<Link>` like Premarket Prep.

---

## The data path

Every request the page needs is fired **in parallel at the top of the component** — AGENTS.md non-negotiable 3, "no request waterfalls". No card below waits on another card's request to resolve.

| Hook | URL | Options | Effective cadence |
|---|---|---|---|
| `quotesQ` | `/api/yahoo-quotes?symbols=ES%3DF%2CNQ%3DF%2CYM%3DF` | `{ pollMs: 60_000 }` | 60 s while visible |
| `calendarQ` | `/api/calendar` | `{ staleMs: 5 * 60_000 }` | once per mount, cached 5 min |
| `overviewQ` | `/api/traders-dashboard/overview` | `{ staleMs: 5 * 60_000 }` | once per mount, cached 5 min. **Prefetched on rail hover** |
| `moversQ` | `/api/premarket-movers` | `{ pollMs: 5 * 60_000 }` | 5 min |
| `weatherQ` | `/api/weather?zip={zip}` | default (`staleMs` 30 s) | once, and only when a 5-digit ZIP is set — the url is `null` otherwise |
| `wheelQ` | `/api/spx-sunburst` | `{ pollMs: WHEEL_POLL_MS }` | 5 min |
| prefs | `/api/traders-dashboard` | raw `fetch`, not `useQuery` | GET once at mount, POST debounced |

**`preload('/api/spx-sunburst')` runs at module scope** (`TradersDashboard.tsx:53`), not in an effect:

> Nav intent is not the only place `preload()` earns its keep: this runs when the route's chunk is parsed, which is before the component has mounted.

So the wheel's request is in flight before React has rendered a thing, and `useQuery`'s dedupe means the component's own call joins that same promise.

### `staleMs` is not a refresh interval

`src/data/api.ts:20–27` is blunt about it, and it explains why `calendarQ` and `overviewQ` behave differently from `quotesQ`:

> It is a cache TTL: it says how long a cached value may be served WITHOUT a refetch, and nothing about when a refetch happens. A card that mounts once and never remounts will sit on its first response forever no matter how small `staleMs` is. That distinction cost real confusion — a chart with `staleMs 25_000` looked like it was refreshing every 25 seconds and was in fact frozen at the value it loaded with. If data needs to keep arriving, it needs `pollMs`, or a WebSocket frame.

So the overview and the calendar are read **once per visit** on this page. That is correct for both: the overview is generated at 07:00 ET, the calendar is a day's schedule.

### Poll semantics inherited from `useQuery`

- **Polling stops while the tab is hidden** (`background` defaults to `false`) — *"a background tab refetching a chain every 15s is pure egress nobody is looking at."* On `visibilitychange` back to visible the page **catches up immediately** rather than waiting out the remainder of a suppressed interval.
- A poll uses `staleMs: 0`, deliberately bypassing the cache window — *"the whole point of a poll is to go and ask again."* Dedupe still applies.
- **A failed poll keeps the last good value on screen.** *"Blanking a chart because one refresh in the middle of the day 502'd is worse than showing a number that is thirty seconds old."* The same rule answers the toolbar's global refresh: it refetches underneath what is already drawn rather than flashing every card's loading state.

### Failure and staleness surfacing

The page turns `useQuery`'s three fields into three distinct visual states:

| Prop | Expression | Effect |
|---|---|---|
| `quotesStale` | `quotesQ.loading && quotesQ.data === undefined` | `.stale` class on the futures row — `opacity: 0.55` with a `120ms ease-out` transition (`tokens.css:581`) |
| `moversStale` | `moversQ.loading && moversQ.data === undefined` | same, on the Trending Now list |
| `quotesFailed` | `!!quotesQ.error` | the red line `Live quotes unavailable — showing last known values.` |
| wheel `failed` | `!!wheelQ.error` | the dashed box `Sector feed unavailable. Retrying every 5 minutes.` |

---

## Prefs: Postgres, per user, and nowhere else

`PREFS_URL = '/api/traders-dashboard'`. The chain is `server-v2/api-router.js` (`auth: 'subscriber'`) → `lib/db.ts`'s `getTdPrefs` / `upsertTdPrefs` → Postgres `td_user_prefs`, **one row per `clerk_user_id`**, upserted with `::jsonb` + `ON CONFLICT`. The ZIP, the schedule, the tasks and the quick links all live in that row and travel with the account.

**There is no local copy, deliberately.** The header records the experiment and the two ways it failed:

> An earlier cut of this page mirrored all four into localStorage so the first paint showed the saved widgets rather than the sample ones. That is a per-BROWSER store wearing a per-user store's clothes, and it fails in the two ways that matter: • a second person signing in on this browser sees the first one's ZIP and routine for as long as the GET takes; • a value cleared on the server (`zip: null`) is silently resurrected from the mirror, so the page shows a ZIP that is not in the database.

So the row is the only truth. The page renders the defaults for the few hundred ms the GET takes, exactly as v2 did.

### Load

One `fetch(PREFS_URL, { cache: 'no-store', credentials: 'same-origin' })` in an effect at mount. Every field is validated before it is accepted:

```
isScheduleItem  { id: string, time: string, label: string }
isTaskItem      { id: string, label: string, done: boolean }
isLinkItem      { id: string, label: string, href: string }
isScheduleArr / isTaskArr / isLinkArr  = Array.isArray(v) && v.length > 0 && v.every(…)
zip             accepted only when /^\d{5}$/ matches the trimmed string, else ''
```

The **non-empty** requirement is v2's and is kept as a data decision, not a port decision: *"an empty saved array falls back to the DEFAULT rather than rendering an empty card, so 'delete every task' does not persist."*

The row is authoritative for every field, **including an absent one**: a ZIP cleared on the server has to clear here too, *"which is exactly what a local mirror used to prevent."*

On 401, offline or a dead route the sample widgets stay on screen and `loadedRef` still flips true in the `finally`, so nothing overwrites the real row.

### Save

`SAVE_DEBOUNCE_MS = 400` — *"Long enough that typing a task label is one request, short enough to feel instant."*

> Debounced for real. v2's helper was captioned "(debounced)" and was not, so every keystroke in an edit field was its own POST.

`savePrefs(patch)` refuses to run before `loadedRef.current` is true — *"Nothing is POSTed before the GET has answered, or the load overwrites the save."* Patches accumulate into `pending.current` and one timer fires `flush(false)`.

`flush(keepalive)` POSTs whatever is queued immediately:

> `keepalive` is the point: this also runs from `pagehide`, where a normal fetch is cancelled the moment the document goes away and the last edit is simply lost. keepalive hands the request to the browser to finish on its own. (64KB cap — a schedule and a task list are nowhere near it.)

Both exits are covered — a `pagehide` listener and the effect's own cleanup:

> A debounce that drops its last write on unmount is a debounce that eats edits: set a ZIP and click away inside 400ms and v2 would have saved it, this would not have.

A failed POST has nothing to fall back on **by design** — the row is the only store.

### State summary — every control on the page

| Control | Default | Where the state lives |
|---|---|---|
| Morning Schedule items | `DEFAULT_SCHEDULE` (4 rows) | `td_user_prefs.schedule` (jsonb), debounced 400 ms |
| Schedule Edit toggle | off | component `useState`, not persisted |
| Pre-Market Tasks | `DEFAULT_TASKS` (4 rows) | `td_user_prefs.tasks` |
| Task checkbox | `done: false` | same row — ticking a box is a save |
| Tasks Edit toggle | off | component `useState` |
| Quick Links | `DEFAULT_LINKS` (4 rows) | `td_user_prefs.links` |
| Quick Links Edit toggle | off | component `useState` |
| ZIP | `''` (no weather) | `td_user_prefs.zip`; `zipInput` is separate local state so typing does not fetch |
| Wheel scale `cap` | `3` (%) | component `useState` in `SectorWheelCard` — **not persisted anywhere** |
| Wheel `focus` sector | `null` | component `useState` |
| Wheel `expanded` pop-out | `false` | component `useState` |
| Wheel `isFs` fullscreen | `false` | mirrors `document.fullscreenElement` |

Nothing on this page is in the query string.

### Defaults, verbatim

```
DEFAULT_SCHEDULE
  s1  08:00 AM  Coffee & Market Review
  s2  08:30 AM  Daily Planning
  s3  09:00 AM  Pre-Market Analysis
  s4  09:30 AM  Market Open

DEFAULT_TASKS
  t1  Review portfolio allocations
  t2  Prepare presentation slides for the 2 PM meeting
  t3  Quick workout (15 mins)
  t4  Check pre-market volume on watch list

DEFAULT_LINKS
  l1  Premarket Prep   /premarket
  l2  Home             /
  l3  Multi Greek      /mult-greek     ← NOT live; renders dimmed
  l4  Analysis         /analytics
```

`DEFAULT_LINKS` *"applies only to an account with no saved Quick Links yet. Everyone else keeps the set they arranged — which is why Premarket also gets a header button."*

New rows get `id: uid()` where `uid = () => Math.random().toString(36).slice(2, 9)`.

---

## The page frame

`<Page title={…} actions={…}>` (`src/design/primitives/Page.tsx`), which supplies `flex min-h-0 flex-1 flex-col overflow-y-auto`, a `px-4 py-3` header row and a `flex flex-col gap-3 p-4` body. *"It exists now so that no route ever renders a bare `<div>` with its own padding, which is how v2 ended up with twelve different page gutters."*

**Title.** `Traders Dashboard` over the date, `text-xs font-normal text-muted`. The date is **browser-local**, as v2 — *"this is the visitor's date, not the session's"* — formatted `weekday: long, month: long, day: numeric, year: numeric`.

**Actions row.** `flex flex-wrap items-center justify-end gap-3.5`, holding the two header links and the weather widget.

**The grid.**

```
grid grid-cols-1 gap-5 lg:grid-cols-[17fr_10fr]
```

> 17:10 is v2's `minmax(0,1.7fr) minmax(0,1fr)`, to the decimal.

Left column: Countdown, Overnight Market Overview. Right column: Morning Schedule, Pre-Market Tasks, S&P Sector Wheel, Quick Links. Both columns are `flex min-w-0 flex-col gap-5`.

### Header links

`HEADER_BTN` = `inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3.5 py-2 text-sm font-bold tracking-[0.04em] no-underline transition-colors`.

The resting fill is a gradient set **inline**, and the hover is done with mouse handlers rather than a `:hover` class — *"v2 had it that way and a `:hover` class cannot beat an inline style."*

| Button | Accent | Resting | Hover |
|---|---|---|---|
| 🌅 Premarket Prep → `/premarket` | `T.orange` = `--color-warn` `#ffd166` | `linear-gradient(180deg, alpha(orange,.20), alpha(orange,.06))`, border `alpha(orange,.55)` | border solid orange, bg `alpha(orange,.28)` |
| 🗓 Economic Calendar → `/economic-calendar` | `T.cyan` = `--color-accent` `#2f6bff` | same recipe in cyan | same |

Premarket Prep is *"the page you want BEFORE this one, so it sits in the header rather than down in Quick Links."*

### Weather widget

Two states in one slot.

- **No ZIP:** a `<form>` with a 5-char `input` (`placeholder="ZIP"`, `maxLength={5}`, `w-20`, `focus:border-accent`) and a `Set` button.
- **Weather loaded:** right-aligned, `☀ {tempF}°F` at `text-xl font-bold` in `MOVE_UP` (`--color-move-up` `#4d8cff`), then `{condition}, {place}` at `text-xs text-muted`, then a `Change ZIP` `Chip`.

`submitZip` validates `/^\d{5}$/` and **fails silently** on anything else — *"v2 fails silently here too."* `clearZip` posts `{ zip: null }`, which is what makes the server the only truth.

---

## Card: Countdown

`useCountdown()` ticks a `new Date()` into state **every 1000 ms**, starting from `null` so the first render is deterministic (`'--:--:--'`, `'9:30 AM EST'`, phase `open`, empty date).

**Time-of-day is computed in ET seconds regardless of the browser's zone**, via `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, … })`. `hh === 24` is folded to `0` — *"some ICU builds emit 24 for midnight."*

```
OPEN  = 9*3600 + 30*60  = 34_200 s   (09:30 ET)
CLOSE = 16*3600         = 57_600 s   (16:00 ET)
isOpen = isTradingDay(now) && nowSec >= OPEN && nowSec < CLOSE
```

| Case | `deltaSec` | Label | Phase |
|---|---|---|---|
| market open | `CLOSE − nowSec` | `Target: 4:00 PM EST` | `close` |
| trading day, before 09:30 | `OPEN − nowSec` | `Target: 9:30 AM EST` | `open` |
| otherwise | `(86400 − nowSec) + (addedDays − 1)·86400 + OPEN` | `Target: {Weekday} 9:30 AM EST` | `open` |

The "otherwise" branch walks a day cursor forward until `isTradingDay` is true, with a **14-iteration cap** so a broken holiday table cannot spin.

Formatting: `HH:MM:SS` zero-padded, prefixed `{days}d ` when the gap crosses a day.

### `MARKET_HOLIDAYS`

US equity-market **full-day** closures (NYSE/Cboe) as ET date strings, *"Keep in sync with server-v2"*:

```
2026: 01-01, 01-19, 02-16, 04-03, 05-25, 06-19, 07-03, 09-07, 11-26, 12-25
2027: 01-01, 01-18, 02-15, 03-26, 05-31, 06-18, 07-05, 09-06, 11-25, 12-24
```

> Full-day only — a 13:00 early close still counts down to 16:00, which is v2's behaviour and deliberately kept (Brandon, 2026-08-30: the tape is not moving either way).

`isTradingDay(d)` = ET weekday is not `Sat`/`Sun` **and** the ET date is not in the set.

### Render

A plain `Card` (no title, so no header row and no expand control) with `px-5 py-7 text-center`:

- heading `Countdown to Market Close` / `Countdown to Market Open`, `text-lg font-semibold text-fg`
- the clock itself: `class="tabular font-extrabold text-fg"`, `fontSize: clamp(48px, 8vw, 84px)`, `letterSpacing: 2`, `lineHeight: 1.05`
- the target label, `text-sm text-muted`

`tabular` is the tokens.css utility that puts numbers on the tabular font so the digits do not jitter as they count.

---

## Card: Overnight Market Overview

Title `📈 Overnight Market Overview`. `actions` carries `Generated {HH:MM} ET` at `text-2xs text-muted` when `overview.generated_at > 0`, formatted in `America/New_York`.

### Sentiment block

`border-l-[3px] pl-3.5 text-sm leading-relaxed text-muted` with `borderColor: T.cyan`. With an overview: **`Sentiment:`** in `text-fg` followed by `overview.summary`. Without one, `text-faint`:

> `Today's overview is generated automatically at 7:00 AM ET. Check back shortly.`

### Overnight Futures (Live)

Section head style is `SECTION_LABEL` = `mb-2.5 text-xs font-bold uppercase tracking-[0.12em] text-muted`, prefixed `📉 Overnight Futures (Live)`.

`FUTURES` is the fixed triple `ES → ES=F`, `NQ → NQ=F`, `YM → YM=F`, joined and URL-encoded into one `/api/yahoo-quotes?symbols=` call. Each renders as a `flex-1 rounded-md border border-line bg-surface2 px-1.5 py-2.5 text-center` tile: the symbol at `text-xs font-bold text-muted`, the percent at `tabular text-sm font-bold` in `moveColor(pct)`.

`fmtPct(n)` → `"+1.23%"` / `"-1.23%"`, two decimals, `—` for null or NaN.

`moveColor(n)`: null/NaN → `T.muted` (`--color-muted` `#e7ece9`); otherwise `n >= 0 ? MOVE_UP : MOVE_DOWN`.

> Note `0` reads as UP — v2's `(pct ?? 0) >= 0`, kept so a flat future prints "+0.00%" in blue and not in a third colour that means nothing.

`MOVE_UP` = `--color-move-up` `#4d8cff`; `MOVE_DOWN` = `--color-move-down` `#ff6b7a`. `tokens.css:118–127` keeps these as separate names from `--color-up`/`--color-down` on purpose — the move pair is what a % change, a wheel wedge or a dashboard stat is painted with.

When `quotesFailed`, a `mb-2 text-xs` line in `MOVE_DOWN`:

> `Live quotes unavailable — showing last known values.`

### Trending Now

Head: `🔥 Trending Now`. Source is `moversQ.data.movers` when it has rows, else `overview.movers`.

**One ranking, highest positive down to lowest negative** — the departure recorded above. The sort key is `preMarketPct ?? pct`, and a row with neither is parked at the bottom rather than letting `NaN` scramble the comparator:

```
if (x == null && y == null) return 0
if (x == null) return 1
if (y == null) return -1
return y - x
```

Each row: symbol at `text-xs font-bold` in `T.cyan`, then the name **truncated at 18 characters** with an ellipsis, then the percent in `moveColor(displayPct)` and a `PM` suffix at `text-2xs text-muted` when `preMarketPct` is the one being shown.

The truncation carries a caveat worth knowing before filing a bug:

> v2 truncates at 18 characters. `/api/premarket-movers` sets `name = symbol`, so a live row prints the ticker twice; only the 07:00 overview payload carries a real company name. Kept as v2 had it — see the parity file's build log.

Empty state, in a dashed box (`rounded-md border border-dashed border-line bg-surface2 px-3 py-3.5 text-center text-xs text-muted`):

> `Available after 7 AM ET overview generates.`

### Key Drivers Today

Head: `🗓 Key Drivers Today`. Source is `overview.drivers.slice(0, 4)` when the AI overview has generated; otherwise the card **falls back to the calendar** so the column is never empty:

```
events
  .filter(e => e.date === {ET today} && e.country === 'USD' && /high/i.test(e.impact))
  .slice(0, 4)
  .map(e => ({ when: e.time_formatted || 'Today', title: e.title,
               body: `High-impact USD event · ${e.country}` }))
```

Each driver is `border-l-[3px] py-2 pl-3` with the border and the `when` line in `driverColor(i)`; the title is `font-bold text-fg`; the body is `text-xs leading-snug text-muted`.

`DRIVER_COLORS = [T.cyan, T.orange, T.red, T.purple]`, cycling past four — v2's ramp through the token bridge:

| Slot | Token | Custom property | Hex |
|---|---|---|---|
| 0 | `T.cyan` | `--color-accent` | `#2f6bff` |
| 1 | `T.orange` | `--color-warn` | `#ffd166` |
| 2 | `T.red` | `--color-down` | `#ff6b7a` |
| 3 | `T.purple` | `--color-dex` | `#6aa0ff` |

> `T.purple` is `--color-dex`, which is the closest thing v3 has to v2's dark-teal "purple".

Empty state: `No major USD events scheduled today.` at `text-xs text-muted`.

### Calendar payload ambiguity

`/api/calendar` returns *"a bare array on some deployments and `{events:[…]}` on others — the same ambiguity v2 defended against."* `hasEventsField()` handles both and anything else yields `[]`.

---

## Card: Morning Schedule

Title `🕐 Morning Schedule` in `T.red`. Action: a `Chip` toggling `Edit` / `Done`.

A standing caption above the list:

> `These are sample times — tap Edit to swap in your own routine.`

(with **Edit** bold in `T.cyan`).

**Read mode.** Each row is `flex items-center gap-3` — the time is `shrink-0 whitespace-nowrap font-mono text-xs font-bold text-muted` and the label is `font-medium text-fg`, except the **last** row, which is `font-bold`: *"The last row is the one that matters — 'Market Open'."*

The time column deliberately has **no fixed width**: *"Mono and nowrap, no fixed width — v2's rule. A width would clip a longer time string rather than pushing the label."*

**Edit mode.** Two inputs per row (`EDIT_INPUT` = `min-w-0 rounded-sm border border-line bg-surface2 px-2 py-1 text-sm text-fg outline-none focus:border-accent`), the time at `w-[90px]` and the label at `flex-1`, plus an `✕` remove button in `MOVE_DOWN` with `title="Remove"`. A `+ Add` button (`ADD_BTN`, `T.cyan`) appends `{ id: uid(), time: '09:00 AM', label: 'New item' }`.

Every change calls `updSchedule`, which sets state **and** queues the debounced save.

---

## Card: Pre-Market Tasks

Title `✅ Pre-Market Tasks` in `MOVE_UP`. Action: the same Edit/Done `Chip`.

Caption: `Sample tasks — tap Edit to make them your own.` (**Edit** bold in `MOVE_UP`).

**Read mode.** Each task is a `<label>` wrapping a checkbox (`h-4 w-4`, `accentColor: MOVE_UP`) and the label text; a done task is `text-sm text-muted line-through`, otherwise `text-sm text-fg`. Toggling a box is a persisted write.

**Progress bar** — shown only when **not** editing:

```
completed = tasks.filter(t => t.done).length
progress  = tasks.length ? Math.round(completed / tasks.length * 100) : 0    // %
```

Rendered as `Task Progress` / `{progress}%` at `text-xs text-muted`, over a `h-1 rounded-full bg-surface2` track with a fill of `width: {progress}%` and `background: linear-gradient(90deg, T.cyan, MOVE_UP)` = `#2f6bff → #4d8cff`, transitioning `width` over 300 ms.

**Edit mode.** One `flex-1` input per task plus the `✕`, and `+ Add` appending `{ id: uid(), label: 'New task', done: false }`.

---

## Card: S&P Sector Wheel

Title `S&P Sector Wheel`. Lazy-loaded: `const SectorWheel = lazy(() => import('./tradersDashboard/SectorWheelCard'))`.

> The wheel is the heaviest thing on the page and it sits third in the right column, below the fold on most windows. Its request is fired here at route entry (no waterfall — AGENTS.md non-negotiable 3); only its rendering waits.

The `Suspense` fallback is `WheelFallback` — a `Card title="S&P Sector Wheel"` with `Loading sector data…` at `px-3 py-12 text-center text-xs text-muted opacity-60`.

**The `SectorWheelCard` / `wheelMath` naming is load-bearing**, and this is a Windows-only build failure written down so it is not undone:

> NAMED `wheelMath.ts`, and that is not cosmetic. A `sectorWheel.ts` beside a `SectorWheel.tsx` differs only in casing, so on Windows the resolver turns `import('./SectorWheel')` into `SectorWheel.ts`, the filesystem hands back THIS file, and tsc fails with TS1149 plus "Property 'default' is missing" on the `lazy()` import. It builds clean on a case-sensitive filesystem, which is precisely how it got committed once already. Keep the two basenames distinct.

The page imports `WheelPayload` **type-only** for the same class of reason: *"a value import here would pull `wheelMath.ts` into the route chunk."* `WHEEL_POLL_MS = 5 * 60_000` is duplicated as a literal in the page rather than imported, *"so that module stays out of this chunk."*

### Wire shape

```
WheelRow   { t: ticker, s: GICS sector, i: industry,
             w: approximate market cap in $B (arc width only),
             c: percent change vs the prior regular close }
WheelPayload { rows, updatedAt, covered, universe, stale? }
```

`covered` / `universe` = how many of the universe returned a usable quote. `stale: true` means the upstream sweep failed and this is a previously cached body.

A payload is only trusted when it **actually has rows**, matching v2: *"a 502 or an empty body leaves whatever is already on screen alone."*

### Geometry constants

| Constant | Value | Meaning |
|---|---|---|
| `VB` | `440` | viewBox edge. The SVG scales to its column via `width:100%` |
| `R` | `208` | outer radius |
| `R0` | `R * 0.54` = `112.32` | the **zero ring** — every bar's foot |
| `AMP` | `R * 0.33` = `68.64` | bar length at the full-scale move |
| `CLAMP` | `1.06` | a bar may overshoot full scale by 6% and no more |
| `CAPS` | `[2, 3, 5]` | selectable full-scale % |
| `R_CALL` | `R * 0.955` = `198.64` | the callout ring |
| `RING_ALL` | `{ holeOut: 0.30, secOut: 0.44, indOut: 0.52 }` | ×`R`: hub 62.4, sector band to 91.5, industry band to 108.2 |
| `RING_FOCUS` | `{ holeOut: 0.30, secOut: 0.325, indOut: 0.52 }` | zoomed: the sector ring collapses to a thin accent band |
| `TAU` | `2π` | — |

`RING_FOCUS` exists because *"Zoomed in there is only one sector and the hub already names it, so the sector ring collapses to a thin accent band and the industry ring takes the space — which is also what makes industry labels fit at this size."*

And the invariant carried from v2: *"every bar grows OUTWARD from the zero ring. Nothing grows inward, which is what keeps the hub free for the index number and the click-to-zoom-out target."*

### The hierarchy

`buildHierarchy(all, focus)` — **angle is market cap**:

```
total   = Σ w over the (optionally focused) rows
sectors    sorted by Σw desc;   span = Σw(sector)   / total × 2π
industries sorted by Σw desc;   span = Σw(industry) / total × 2π
leaves     sorted by w desc;    span = w            / total × 2π
chg(group) = wavg = Σ(c·w) / Σw      ← cap-weighted average change, in %
net = wavg(rows); up = count(c > 0); down = count(c < 0)
```

*"biggest first, so the wheel's shape stays stable between refreshes."* `focus` filters to one sector and the total is **re-taken over what is left**, so a zoomed sector spans the full 360°.

`arcPath` has a special case for exactly that: *"A single sector zoomed in spans the whole circle; one arc command cannot close a 360° sweep, so draw it as two half-circles."*

### The palette

Built once per `cap` by `wheelPalette(cap)`. **Colour by DIRECTION, length by MAGNITUDE — a bar's hue only ever says up or down, its length says how much.**

v2 typed its own hex helpers over `HOME_THEME`; v3 forbids a literal outside `tokens.css`, so the palette reads token values **numerically** through `design/theme.ts`'s `tokenRgb()` and does the same arithmetic on those.

| Function | Formula | Notes |
|---|---|---|
| `barLen(v)` | `max(min(\|v\|/cap, 1.06) · 68.64, 1.5)` | viewBox units. Floor 1.5 so a flat name still shows a sliver |
| `fillFor(v)` | `mixRgb(mid, v>=0 ? up : down, clamp(\|v\|/cap, 0.24, 1))` | ticker bar fill |
| `ringFill(v, strength)` | `mixRgb(panel, v>=0 ? up : down, (0.34 + 0.66·min(1, \|v\|/cap)) · strength)` | `strength` is `0.62` for sectors, `0.90` for industries |
| `mid` | `mixRgb(panel, text, 0.16)` | neutral midpoint of the diverging scale — the panel, lifted toward the ink |
| `inkOn(hex)` | `isLightRgb(c) ? bg : text` | Rec. 709 luma > 0.6 picks the dark ground |
| `dir(v)` | `v >= 0 ? up : down` | directional colour for text and strokes |

Tokens read: `--color-surface` `#0e1216`, `--color-fg` `#e7ece9`, `--color-bg` `#0a0d10`, `--color-move-up` `#4d8cff`, `--color-move-down` `#ff6b7a`.

The `0.34` floor on `ringFill` has a reason: *"Sector and industry averages are small by construction — they wash out — so the ring ramp starts well above zero. Without the 0.34 floor every inner arc comes out panel-coloured."*

**Failure mode.** When the stylesheet is not readable (a test renderer, a first tick before `tokens.css` is live) `wheelPalette` returns the flat token strings: *"the wheel then paints the right hues with no magnitude ramp for that frame, which is a far better failure than an SVG full of `undefined` fills."*

### Labels and the fit tests

Type is sized in **viewBox units**, so a fit test is identical at any render size — *"popped out we can afford smaller units (they land bigger on screen), which is what lets more names show."*

| Layer | fontSize (card / popped out) | Fits when |
|---|---|---|
| sector | `9` / `7` | band thickness ≥ `fs+3`, `textW ≤ arcLen`, and `hypot(rr, w/2) + fs·0.45 ≤ ro` (the straight chord must not bulge past the ring's outer edge) |
| industry | `8` / `6.5` | same two tests, no short forms |
| ticker inside a bar | `7.5` / `5.6` | `textW ≤ barLen − 7` **and** `fs·1.35 ≤ (a1−a0)·R0` (wide enough as well as long enough), and it is not already on the rim |
| callout | `9.5` / `7.5` | placed greedily — see below |

`textW(s, fs) = s.length · fs · 0.6` — *"Rough text width — good enough to decide whether a label fits at this size."*

Sector labels try **progressively shorter forms** until one fits (`SECTOR_SHORT`):

```
Information Technology → Technology → Tech
Communication Services → Communications → Comms
Consumer Discretionary → Cons. Disc. → Disc.
Consumer Staples → Staples
Health Care → Health
Financials → Fins       Industrials → Indus.     Real Estate → REITs
Materials → Matls       Utilities → Utils        Energy → Enrgy
```

`shortestForm(n)` returns the last form — *"what fits in a ~100-unit hub."*

Every label flips 180° when `Math.cos(mid) < 0` so it never reads upside down, and `dy="0.34em"` centres it on the band.

### Callouts

`buildCallouts(leaves, count, fs, barLen)` names the extremes **right on the wheel** — the biggest winners and losers of whatever is currently on screen, so zooming a sector re-picks them. `count` is `3` in the card and `5` popped out.

Placement is **greedy, biggest absolute move first**; a label whose angular span would collide with one already placed is simply skipped:

> if a label would collide with one already down, the smaller mover simply goes unnamed rather than the two overprinting. The Top/Bottom list under the wheel still has every name.

Angular half-width is `(textW(text, fs)/2 + 5) / R_CALL`. Overlap is tested at `−2π, 0, +2π` *"so the seam at 12 o'clock counts."*

The label text is `{ticker} {+|−}{|chg|.toFixed(1)}%`, drawn on `R_CALL` with a 0.9-wide tick line at `alpha(dir, 0.5)` back to the bar's tip (`R0 + barLen`). The bars stop short of the rim on purpose:

> the band outside them is where the biggest winners and losers get named. Callout labels sit on this radius and follow the circle, so they cost one line of radial room rather than the horizontal run a straight leader-line callout would need.

A bar that has a callout **skips its inner ticker label** (`calledOut` set).

### The hub

Three stacked `<text>` nodes, all `pointerEvents: none`:

- `y=-26`, `fontSize 10.5`, weight 800, `letterSpacing .1em`, `T.muted` @ 0.55 — `hubLabel`, which is `S&P 500` or the zoomed sector's **shortest form**, uppercased (*"the hub is only ~100 units across"*)
- `y=-3`, `fontSize 22`, weight 800, `dir(net)` — `fmtWheelPct(net)`
- `y=12`, `fontSize 9.5`, `T.muted` @ 0.7 — `{up} up · {down} down`

Zoomed in, a fourth line `← all sectors` at `y=30` in `T.cyan`, plus a transparent circle of `R·holeOut − 3` that is the click target back out. *"the hub names what the number covers, so the reading is unambiguous both zoomed out and zoomed in."*

`fmtWheelPct(v)` = `"+1.23%"` / `"−1.23%"` — **and the negative sign is U+2212 MINUS SIGN, not a hyphen**: *"v2's choice, and it is what makes the callouts line up."* (The page's own `fmtPct` uses a plain hyphen. Two formatters, two conventions, both intentional.)

### Scale rings and the zero ring

Two faint `T.border` circles at `R0 + 0.5·AMP` and `R0 + 1·AMP` mark half and full scale. The zero ring itself is drawn **above the feet of the bars** at `alpha(T.text, 0.28)`, 1.4 wide.

### Controls

| Control | Default | Behaviour |
|---|---|---|
| `SegGroup` `2% / 3% / 5%` | `3` | sets `cap`. Title: `Scale — what counts as a full-length bar`; each option's title: `Full-scale move: a name at ±{c}% paints a full-length bar` |
| `⤢ Expand` | — | opens the pop-out |
| `⛶ Full screen` / `⤡ Exit full screen` | windowed | real Fullscreen API on the overlay element |
| `✕ Close` | — | exits fullscreen if needed, clears the tooltip, closes |
| `CopyShotButton` | — | **owner-only, pop-out only** |
| click a sector arc | `focus = null` | zooms; ignored while already focused |
| click the hub | — | clears focus (only rendered while focused) |
| click a leaderboard row | — | toggles focus on that sector |
| `Esc` | — | closes the pop-out, unless the browser ate it to exit fullscreen |
| click the backdrop | — | closes (only when the event target is the backdrop itself) |

None of this is persisted. Zoom level, cap and the loaded payload all live in `SectorWheelCard`'s own state, *"so they all survive the move in either direction"* between card, pop-out and fullscreen.

### Caption

Above the wheel, `text-xs text-muted opacity-65`:

- zoomed out: `Bar length = size of move, color = direction. Click a sector to zoom.`
- zoomed in: `Showing {sector} — click the middle to go back.`

The zoomed-in variant *"is a way back OUT, not a caption — there is no other affordance for it."*

### Movers, leaderboard, footer

`MoverList` renders `Top` / `Bottom` — **always the full universe**, sorted by `c` descending, `3` names each in the card and `8` in the pop-out. *"the wheel is too small for callouts to name them all, so name them here."*

The sector leaderboard is **pop-out only** (*"only the pop-out has the room for it"*) and uses `sectorRank(rows)`, which is *"Always the FULL universe, never the zoomed view — otherwise the pop-out's rail collapses to one row the moment the wheel is zoomed into a sector."* Rows are `grid grid-cols-[1fr_56px]` buttons; the focused one takes `border-accent bg-raised`.

Footer, `text-2xs text-muted opacity-50`: `{covered}/{universe} names[ · cached]` on the left, `as of {HH:MM} ET` on the right (from `updatedAt`, formatted in `America/New_York`).

### Tooltip

Absolutely positioned inside `boxRef`, `pointer-events-none`, `z-[5]`, `min-w-[120px] rounded-md border border-line bg-raised px-2.5 py-2`. Position is `left: clamp(0, tip.x + 12, boxWidth − 150)`, `top: tip.y + 12`. Contents: title (`text-xs font-bold text-fg`), sub (`text-2xs text-muted opacity-60`) and the percent at `text-base font-bold` in `palette.dir(val)`.

Sub-lines: `{n} names · cap-weighted` for a sector or industry arc, and `{sector} › {industry}` for a ticker bar.

### Rendering and performance

**DOM/SVG, not canvas.** The `<svg>` carries `data-cb-layer="sector-wheel"` (AGENTS.md non-negotiable 6) with its own note:

> Tagged for the same reason a canvas is (non-negotiable 6): so the perf tooling and a human in devtools can both tell a layer v3 drew from one a library made for itself. `perf-check.mjs` counts canvas repaints and will not see this one — the visibility gate above is what stands in.

Three machinery decisions, all in the file's header:

1. **The SVG is memoised and the tooltip is not.**
> v2 kept hover position in the same component as the wheel, so every mousemove over any of ~200 arcs re-rendered all of them. Here `<WheelSvg>` is `memo()`'d on props that do not include the hover, so a mousemove repaints one absolutely-positioned div. **Keep the props it receives referentially stable or that goes away silently.**

Which is why `sectors`/`industries`/`leaves`, `palette`, `callouts`, `movers` and `ranks` are all `useMemo`'d and `onTip`/`onLeave`/`onSector`/`onClearFocus` are all `useCallback`'d.

2. **It does not paint when it cannot be seen** (non-negotiable 5).
> This is a declarative SVG, not an imperative canvas, so it cannot mount through `ChartFrame` — that primitive hands you a bare element to build into. It carries the same contract by hand instead: an `IntersectionObserver` with the same generous 200px `rootMargin`, publishing `data-visible` on the wrapper exactly as `ChartFrame` does, and the arcs are not rendered at all while it reads "0". The wrapper keeps its height so nothing jumps.

`useInView` **starts optimistic** (`true`), *"for ChartFrame's reason: the observer's first callback is asynchronous, and one thrown-away paint costs less than a card that renders blank for a frame on every mount."* It also folds in `document.hidden` via `visibilitychange`, so a background tab stops painting too. The gate element renders **unconditionally**:
> an earlier cut hung the observer off a node inside `{data && …}`, which meant the ref was null on the only pass the effect ever ran and the gate silently never engaged.

`paint = inView || expanded` — *"The pop-out is a fixed overlay over the viewport — it is on screen by definition, whatever the card behind it is doing."* The wheel's box keeps `aspectRatio: '1 / 1'` whether or not it is painting, *"so scrolling past a gated card does not make the page jump."*

3. **The snapshot button is only in the pop-out, and only for the owner.**
> v3 has one camera and it is in the toolbar (`shell/CopyShot.tsx`) — but this pop-out is a `fixed inset-0` overlay above everything, so while it is open that toolbar is behind it and unclickable. The wheel publishes itself to the menu anyway and carries a second button here for the case where it is the thing covering the screen. … The registration is what keeps the menu honest; the button is what the hand can actually reach.

Target: `{ id: 'sector-wheel', icon: '🥧', label: 'S&P Sector Wheel', group: 'This page', file: 'sector-wheel', meta: 'S&P 500[ · {focus}] · ±{cap}% full scale', resolve: () => panelRef.current }`. Registered only while `expanded`; `NO_TARGETS` otherwise. In the card *"it is a 300px circle nobody wants a PNG of; popped out it is the whole S&P on one plate, with the mover lists and the sector leaderboard beside it, which is the thing that gets shared."*

### The pop-out

`createPortal` to `document.body` — *"portalled to `<body>` so the page's overflow cannot clip it."* The backdrop is `fixed inset-0 z-[4000] flex items-center justify-center backdrop-blur-md` with `background: alpha(T.bg, 0.82)` (or solid `T.bg` in fullscreen) and `padding: clamp(10px, 2.5vw, 32px)` (0 in fullscreen). The panel is `max-h-full w-full overflow-auto rounded-lg border border-line bg-surface shadow-2xl`, `maxWidth: 1320`, `padding: clamp(16px, 2vw, 28px)`. `document.body.style.overflow` is set to `hidden` while open and restored on close.

Layout switches from a column stack to `flex flex-row flex-wrap items-start gap-7`, with the wheel at `flex: 1 1 460px` and capped at `maxWidth: min(100%, calc(100vh - 200px))`, and the rail at `flex: 0 1 280px`, `min-w-[220px]`.

The panel's header is a real `<header>`, and that is load-bearing:

> a CopyShot drops the captured surface's own `:scope > header` and shortens the picture to match, so the name and the controls live in the caption under the shot instead of being printed twice. See `shell/snapshot.ts`.

Esc handling notes the browser's behaviour rather than fighting it: *"The browser eats the first Esc when we are in real fullscreen, which just drops back to the windowed overlay — that is fine."*

---

## Card: Quick Links

Title `🔗 Quick Links` in `T.cyan`. Action: the Edit/Done `Chip`.

**Read mode.** Live routes render as `<Link>`: `flex items-center justify-between rounded-md border border-line bg-surface2 px-3.5 py-2.5 text-sm font-semibold text-fg no-underline transition-colors hover:border-accent hover:bg-raised`, with a `T.cyan` `→`. Not-live routes render as a `<span>` with `cursor-not-allowed text-faint opacity-50` and `title="{label} — coming soon"`.

**Edit mode.** Each row becomes a `<select>` over **every** `ALL_PAGES` entry; picking one rewrites both `href` **and** `label` from the catalogue, so a tile can never carry a name that does not match its destination. `+ Add` appends the first `ALL_PAGES` entry not already present (falling back to `ALL_PAGES[0]`).

---

## Phone behaviour

`/traders-dashboard` **is** in `DESKTOP_TO_MOBILE` (`src/mobile/mobileNav.ts:91`):

```
'/board': '/m/gex',
'/traders-dashboard': '/m/gex',
'/em': '/m/em',
```

So a phone opening this route is **replaced** (not pushed — `replace` so Back does not land on the route it just left) to `/m/gex`, which is `board/gexChart/GexChartCard` full-bleed inside `MobileShell`. There is no phone build of this page and there is deliberately not going to be one: AGENTS.md's phone section says a tab must be a board card or an existing page, and *"Never add a mobile-only fetch, or a second component, for something a card already computes."*

Two escape hatches remain:

- **`MOBILE_TO_DESKTOP['/m/gex'] = '/board'`**, so the tab bar's long-press "Desktop site" action from the GEX tab lands on the grid board, not back here.
- The redirect only fires for phones and only for listed routes, so **a desktop browser typing a `/m/*` URL is never pushed off it**, and a phone that sets the session opt-out (`sessionStorage['cb-v3-force-desktop'] = '1'`, set by a long-press) gets the real desktop page including this one.

Note the deliberate asymmetry: `'/'` is **not** redirected on voltick, because the landing page is the card tiles. `'/board'` keeps its redirect — *"a drag-and-drop grid really is unusable on a handset."*

Within the desktop layout, the page's own responsive step is the single `lg:grid-cols-[17fr_10fr]` breakpoint: below `lg` the two columns stack to `grid-cols-1`, so the countdown, the overview, the three widgets and the wheel become one long scroll. The wheel's pop-out still works there and its padding clamps down to 10px.

---

## Status and empty-state messages, verbatim

| Message | Where | When |
|---|---|---|
| `Today's overview is generated automatically at 7:00 AM ET. Check back shortly.` | sentiment block, `text-faint` | `overviewQ` has no `overview` |
| `Live quotes unavailable — showing last known values.` | under the futures tiles, `MOVE_DOWN` | `quotesQ.error` is set |
| `Available after 7 AM ET overview generates.` | Trending Now, dashed box | no movers from either source |
| `No major USD events scheduled today.` | Key Drivers, `text-xs text-muted` | no AI drivers and no high-impact USD calendar rows for today |
| `Loading sector data…` | `WheelFallback`, and inside the card | the wheel chunk is in flight; or the payload has not landed and has not errored |
| `Sector feed unavailable. Retrying every 5 minutes.` | wheel, dashed box | `wheelQ.error` and no usable payload |
| `These are sample times — tap Edit to swap in your own routine.` | Morning Schedule | always |
| `Sample tasks — tap Edit to make them your own.` | Pre-Market Tasks | always |
| `Bar length = size of move, color = direction. Click a sector to zoom.` | wheel caption | not focused |
| `Showing {sector} — click the middle to go back.` | wheel caption | focused |
| `← all sectors` | wheel hub | focused |
| `{label} — coming soon` | Quick Links tile `title` | `href` not in `LIVE_ROUTES` |
| `{label} — coming soon` | rail icon `title` in `Shell.tsx` | `NavItem.comingSoon` |
| `--:--:--` / `9:30 AM EST` | Countdown | the first render, before `now` is set |

---

## Performance and bundle notes

- **Two lazy chunks, not one.** The route chunk (`TradersDashboard`) and the wheel chunk (`SectorWheelCard` + `wheelMath`) are separate, and the page goes to some trouble to keep them separate: a **type-only** import of `WheelPayload` and a **duplicated** `WHEEL_POLL_MS` literal. A value import of either would pull `wheelMath.ts` into the route chunk and every visitor would pay for the wheel whether they scrolled to it or not.
- **Budget.** `budgets.json:5` `"route": 59100` brotli bytes applies to both chunks. Neighbouring lines: `"entry": 38900`, `"react": 55000`, `"data": 78000`, `"css": 8500`, `"html": 2600`, `"totalInitial": 108400`. The file's `$comment`: *"a budget with 4x headroom enforces nothing. Raising a number is a deliberate decision that shows up in a diff."* `ratchet.slack` is `0.15` and `ratchet.enforce` is `false`, so a chunk that shrinks reports SLACK on every run but never fails the build; pull it back with `npm run budgets:ratchet`.
- **Theme baseline.** `theme-baseline.json` lists **no file under `src/pages/` for this route** — neither `TradersDashboard.tsx` nor either wheel file appears. Both are at zero and, per that file's README, *"a file at zero is removed and can never regress."*
- **`perf` block.** `budgets.json:15–20`: `idleRepaintsPerFrame: 0.15`, `offscreenRepaints: 0` (a hard zero), `interactionRepaints: 10`. `perf-check.mjs` counts repaints on canvases tagged `data-cb-layer`, attributed per board card. The wheel carries the tag but is an SVG, so the checker will not see it — the hand-rolled `IntersectionObserver` gate is what enforces non-negotiable 5 here.
- **Timers on this page.** One 1 s `setInterval` for the countdown, a 60 s poll for quotes, two 5 min polls (movers, wheel), and one 400 ms debounce timer that only exists between an edit and its POST. Every poll suspends on a hidden tab.
- **`preload()` at module scope** means the wheel's request is issued at chunk parse time, which is earlier than any effect can manage.

---

## Gotchas

1. **`ALL_PAGES` / `LIVE_ROUTES` / `App.tsx` routes / `Shell.tsx` `NAV` are four lists that drift.** Three of them are explicitly coupled by comments. Today's drift is real and worth knowing:
   - `'/board'` **is** a registered route (`App.tsx:177`) and **is** in `ALL_PAGES`, but is **not** in `LIVE_ROUTES` — so a Quick Link to the grid board renders dimmed and unclickable even though the page exists.
   - `'/test'` and `'/trading'` **are** in `LIVE_ROUTES` but have **no `<Route>`** in `App.tsx` — Test Lab and Journal were retired 2026-08-30. A Quick Link to either renders as a live link and lands on `NotFound`, which is exactly the lie `LIVE_ROUTES` exists to prevent.
   - `'/single'` (the Voltmap), `'/whales'`, `'/cards'` and the `/m/*` tabs are registered routes and in `NAV` but are **not** in `ALL_PAGES`, so they cannot be chosen as a Quick Link at all.

2. **`'/mult-greek'` is spelled with one `i`.** It is not a live route either way, but it is in `ALL_PAGES` *and* in `DEFAULT_LINKS`, so a fresh account's third Quick Link tile is dimmed out of the box.

3. **`staleMs` does not refresh anything.** The overview and the calendar are read once per mount. If you want them to keep arriving, they need `pollMs`.

4. **A zero percent change is blue, not neutral.** `moveColor`'s test is `n >= 0`, v2's `(pct ?? 0) >= 0`. A flat future prints `+0.00%` in `MOVE_UP`.

5. **Trending Now often prints the ticker twice.** `/api/premarket-movers` sets `name = symbol`; only the 07:00 overview payload carries a real company name. The 18-character truncation is v2's and is kept.

6. **There is no localStorage anywhere on this page, and adding one breaks it.** Two specific failures are recorded: a second account on the same browser seeing the first one's ZIP, and a server-cleared `zip: null` being resurrected from the mirror.

7. **Deleting every schedule item / task / link does not persist.** The `isXArr` guards require `length > 0`, so an empty saved array falls back to the DEFAULT on the next load. v2's behaviour, kept because changing it is a data decision.

8. **A bad ZIP fails silently.** `submitZip` just returns if `/^\d{5}$/` does not match. No message, no shake.

9. **`wheelMath.ts` must not be renamed to `sectorWheel.ts`.** It builds clean on a case-sensitive filesystem and fails on Windows with TS1149 plus "Property 'default' is missing". It has been committed that way once already.

10. **Never value-import from `wheelMath.ts` in `TradersDashboard.tsx`.** The `import type` and the duplicated `WHEEL_POLL_MS` literal are what keep the wheel out of the route chunk.

11. **`WheelSvg`'s props must stay referentially stable.** It is `memo()`'d on props that exclude the hover, and a prop that changes identity every render silently restores v2's ~200-arc repaint on every mousemove. Nothing warns you.

12. **The visibility gate's element must render unconditionally.** Hanging the `IntersectionObserver` off a node inside `{data && …}` is how the gate was silently never engaged once.

13. **The wheel has `data-cb-layer` but `npm run perf` cannot measure it** — that checker counts canvas repaints. The SVG's own observer gate is the whole of its compliance with non-negotiable 5.

14. **Two different minus signs.** `fmtWheelPct` uses U+2212 MINUS SIGN (so callout labels line up); the page's `fmtPct` uses a plain hyphen. Both are intentional.

15. **Early closes are not modelled.** `MARKET_HOLIDAYS` is full-day only; a 13:00 close still counts down to 16:00. Deliberate (Brandon, 2026-08-30).

16. **The holiday table is hardcoded and ends in 2027.** Keep it in sync with server-v2. After the last entry, `isTradingDay` treats every weekday as a trading day.

17. **The date under the page title is browser-local, but the countdown is ET.** They can disagree by a day for a user in Asia. v2's behaviour.

18. **There is still no page-level snapshot.** Departure 4: v2's `CopySnapButton` needs a DOM-to-canvas renderer v3 does not ship. The wheel's pop-out camera is the only one on this page, and it is owner-only.

19. **The wheel's `cap`, `focus` and pop-out state are not persisted.** Every reload is back to ±3%, all sectors, in-card.

20. **`preload('/api/spx-sunburst')` fires at module scope** — i.e. on *any* import of this route's chunk, including a nav-intent prefetch of the route itself. That is intended; just do not expect it to be tied to mounting.
