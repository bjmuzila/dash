# Page — `/economic-calendar`

| | |
|---|---|
| **Route** | `/economic-calendar` (served at `/v3/economic-calendar` — `base: '/v3/'`, `<BrowserRouter basename="/v3">`) |
| **Query string** | `?tab=earnings` selects the second tab; absent means Calendar |
| **Rail label / icon** | `Econ Cal` · 📅 (`src/shell/Shell.tsx`, the `NAV` array) |
| **Page title bar** | `Economic Calendar` |
| **Component** | `EconomicCalendar`, **default export**, `lazy()`-loaded in `src/App.tsx` |
| **Primary sources** | `src/pages/EconomicCalendar.tsx`, `src/pages/economicCalendar/board.ts`, `src/pages/economicCalendar/ChipLogo.tsx` |
| **Shared feed module** | `src/data/econCalendar.ts` |
| **Spec** | `docs/parity/economic-calendar.md` — 176 rows, one per rendered value |

---

## What it is, in one paragraph

Two tabs over one feed. The **Calendar** tab is the day-by-day stream of timed economic
events — ForexFactory's prints plus the presidential-schedule items — with the day's
earnings **woven into** the sequence rather than listed under it: the premarket block
sits directly under the day separator, the after-hours block is spliced in immediately
before the first event later than 16:00 ET, and the time-unconfirmed block always
closes the day. Events more than thirty minutes past their start are not removed; they
drop into a **dimmed second stream** below the live one, with no earnings woven into
it. The **Earnings** tab is a five-column week board, one column per trading day, each
a date strip and up to three session blocks of logo chips, sized and washed so the week
lands in one screen and can be pasted into a chat as a self-contained picture. The tab
lives in the query string, so `/v3/economic-calendar?tab=earnings` is a real link;
everything else — the impact filters, the week and breadth toggles, the market-cap
floor, the two independent search boxes — is in-memory state that resets on reload.

The page is a 1:1 port of v2's `/app/economic-calendar` (1,303 lines) against a
176-row checklist: *"The thresholds, the label wording, the insertion order of the
woven earnings blocks and the exact set of fields are TRANSCRIBED from v2; only the
palette and the render layer are new."*

---

## File map

| File | Lines | What it owns |
|---|---:|---|
| `src/pages/EconomicCalendar.tsx` | 1288 | The page. Endpoint constants, `VIEW_OPTS`, `MCAP_OPTS`, `EARN_KIND`, the tab/week/view/cap/search state, every derivation, the two CopyShot targets, the top bar, the quote band, the owner feed-health banners, and the components: `Loading`, `PillButton`, `Seg`, `MenuRow`, `DayStream`, `EventRow`, `EarnRowBlock`, `EarningsBoard`, `DayColumn`, `SessionBlock`, `EarnChip`. |
| `src/pages/economicCalendar/board.ts` | 93 | The week board's surfaces (`BOARD`: card / cardToday / header / head / headToday / tile / edge / edgeToday / rule) and its geometry (`CHIP_W`, `CHIP_GAP`, `CHIP_LOGO`, `CHIP_MIN`), plus the two day-label formatters `dayFull` and `dayDate`. |
| `src/pages/economicCalendar/ChipLogo.tsx` | 174 | The company-mark ladder: `LOGO_REV`, `localLogoUrl`, `proxyLogoUrl`, `classParent`, the exported `tickerLogoUrls`, and the `ChipLogo` component with its per-symbol fallback index. |
| `src/data/econCalendar.ts` | 532 | The shared feed module — types, ET helpers, the 30-minute `isStale`, `FILTER_OPTS` / `passes`, the anticipated-earnings machinery, `groupEarningsByDate`, `bucketCount`, and the `useEconCalendar` hook (**which this page does not use**). |
| `src/App.tsx` | 249 | Route registration and the four-edit rule. |
| `src/shell/Shell.tsx` | 739 | The nav rail entry, and why this route carries no prefetch. |
| `src/mobile/pages/MEcon.tsx` | 26 | `/m/econ` — the phone's calendar screen, which mounts the **board card** instead of this page. |

---

## How the route is registered, and how it is reached

### `src/App.tsx`

`const EconomicCalendar = lazy(() => import('@/pages/EconomicCalendar'))`, mounted as
`<Route path="/economic-calendar" element={<EconomicCalendar />} />`.

The import carries its own summary: *"two tabs over one feed … A 1:1 port of v2's
`/app/economic-calendar` against the 176-row checklist in
`docs/parity/economic-calendar.md`. REST-only: three feeds fired in parallel at entry,
no socket, no canvas. The tab lives in the query string, so
`/v3/economic-calendar?tab=earnings` is a shareable link."*

Two routing rules govern it: every route is `lazy()` except the landing route, and
there is **no catch-all redirect** — an unregistered route renders `NotFound`, because
*"v2 fell through to `/traders-dashboard` whenever a route was missing, which meant a
page that was never registered looked like it 'sort of worked' instead of failing
loudly."* A new route costs four edits: this line, a `NAV` entry in `Shell.tsx`, the
page, and `app/v3/<name>/route.ts` in the v2 repo — *"Miss #4 and the page works
in-app but 404s on a hard refresh."* The path matches v2's exactly, *"so a bookmark, a
doc link or a habit transfers by swapping one path segment."*

### `src/shell/Shell.tsx` — the rail

`{ to: '/economic-calendar', label: 'Econ Cal', icon: '📅' }` — no `prefetch` array.
It sits directly after `/em` (Estimated Moves), and the comment says why:

> Next to Est. Moves on purpose — both are pre-open prep, read once before the bell
> rather than watched. No prefetch: the page's three feeds go out through a raw
> `fetch(…, { cache: 'no-store' })` in `data/econCalendar.ts`, not through `api.ts`,
> so a warmed `api` cache would never be read back — an unused request on every
> hover. Give it one the day that hook moves onto `api.ts`.

**That day has come and the comment has not been updated.** The page now reads all
three feeds through `useQuery` (see below), so a rail prefetch of `/api/calendar`
*would* be read back today. The raw-fetch description remains accurate for
`useEconCalendar`, still used by `src/pages/Premarket.tsx` and
`src/pages/analysis/cards/EconCalendar.tsx`. Rail icons are drag-reorderable, order
saved per browser; the route is unguarded — no `paidOnly`, unlike `/seasonality`.

### On a phone

`/economic-calendar` is **not** a key in `DESKTOP_TO_MOBILE` (`src/mobile/mobileNav.ts`),
so a phone opening it is **not** redirected — *"Only routes in `DESKTOP_TO_MOBILE`
redirect. A desktop page with no phone counterpart keeps rendering its desktop layout
— a cramped real page beats a redirect to an unrelated one."* The phone's calendar
screen is `/m/econ`, which mounts the **board card**. See "Phone behaviour" below.

---

## The data path

### Three reads, fired in parallel at entry

```ts
const URL_CAL = '/api/calendar', URL_QUOTE = '/api/calendar-quote'
const URL_EARN = '/proxy/earnings-week?week=both'
/** The server caches for 30 minutes; asking more often than half that is waste. */
const FEED_STALE_MS = 600_000
const CLOCK_MS = 60_000
const cal   = useQuery<CalendarResponse>(URL_CAL,  { staleMs: FEED_STALE_MS })
const quote = useQuery<QuoteResponse>(URL_QUOTE,   { staleMs: FEED_STALE_MS })
const earn  = useQuery<EarningsResponse>(URL_EARN, { staleMs: FEED_STALE_MS })
```

| | `/api/calendar` | `/api/calendar-quote` | `/proxy/earnings-week` |
|---|---|---|---|
| Query params | none | none | `week=both` — **both weeks in one request** |
| `staleMs` / `pollMs` | 600_000 / none | 600_000 / none | 600_000 / none |
| Response shape | `{ events?; source?; warning?; error? }` | `{ quote? }` | `{ ok?; rows? }` |
| Read here | `events`, `source`, `warning`, `error` | `quote` | `rows` |

> Both weeks in ONE request: the board's week toggle is a filter over rows in hand,
> so flipping it costs nothing and the camera captures whatever shows.

`useQuery` sends `credentials: 'same-origin'`, dedupes by URL string, and returns a
cached value synchronously on first render so a remount does not flash a loading state.
In dev `/api/*` and `/proxy/*` proxy to `VITE_BACKEND_ORIGIN`; in prod, same-origin.

### Nothing polls; only `now` ticks

One bare `setInterval(() => setNow(Date.now()), CLOCK_MS)`. *"Moves rows from active →
stale. NOT a refetch: the calendar is a weekly file and re-pulling it every minute
would be a lot of bytes for no events."* And from the file header:

> NO SOCKET. Three REST reads, fired in PARALLEL at entry through `useQuery`, so
> non-negotiables 2, 3, 4, 5 and 6 have nothing to bite on. The feeds do not poll:
> economic events are scheduled days ahead and the server caches for 30 minutes. What
> ticks is `now`, once a minute, purely so the 30-minute staleness cutoff re-evaluates
> and events fade as they pass.

This interval is **not** gated on tab visibility, unlike the board card's.

### The manual refresh

The `↻ Now` button re-queries all three URLs at `staleMs: 0`, then calls the three
`refetch()`s and stamps `lastRefresh`, with `refreshing` held in a `try/finally`.

> `refetch()` alone honours the stale window, and the whole point of pressing a
> refresh button is to go and ask again — so the three URLs are re-queried at
> `staleMs 0` first and the hooks then read the fresh cache. Dedupe still applies, so
> the board card sharing `/api/calendar` makes no second request.

`lastRefresh` is a **locale time string** (`toLocaleTimeString()`, device locale and
device timezone), unlike everything else on the page, which is ET.

### Why `useQuery` and not `useEconCalendar`

> `useQuery` rather than the `useEconCalendar` hook in `@/data/econCalendar`. That
> hook narrows ONCE, and this page needs TWO different narrowings out of one feed —
> the calendar tab is always the ~14/day anticipated set, while the board honours the
> Anticipated/All toggle. Reading the raw rows here also means the rail's prefetch
> actually primes what the page reads, and that the board card already holding
> `/api/calendar` pays for it once.

The hook's own path is three raw fetches with `cache: 'no-store'`, which bypass the
api.ts cache entirely — invisible to `peek()`, to dedupe and to `refreshAll()`. That
is the reason the rail entry carries no prefetch, and the half of the situation that
has not changed.

### Shared cache with the board card

`/api/calendar` is spelled identically here and in the board card, so a session with
both open makes **one** request for it. `/proxy/earnings-week` is **not** shared: the
card asks for it bare, this page with `?week=both`, and `query()` keys on the URL.

### Failure semantics

> `/api/calendar` answers HTTP 200 with an empty events array when the upstream is
> down, so an ok response tells you nothing. The real signal is `source`
> ("forexfactory" | "cache" | "saved" | "unavailable") plus `warning`. Both are
> owner-only chrome — they name upstream hosts, HTTP status codes and cache
> timestamps.

The page reads all three — `feedSource = cal.data?.source`, `feedWarning =
cal.data?.warning`, and `feedError = cal.error?.message ?? cal.data?.error`, so a
transport failure and a 200-with-`error` land in the same place.

| Failure | Owner sees | Customer sees |
|---|---|---|
| `/api/calendar` non-2xx, network failure, or 200 with `{ error }` | `⚠ <error>` in a red bordered block, replacing the stream | the ordinary `No events match.` line |
| `warning` present, no error | an amber banner: `⚠ <warning>` | nothing |
| `source === 'unavailable'`, no warning, no error | `⚠ Economic feed source: unavailable.` | nothing |
| `/api/calendar-quote` fails | quote band simply absent | same |
| `/proxy/earnings-week` fails | the board's `No earnings loaded.` | same |

This is **Q5 of the parity spec**, listed in the header as one of four v2 defects
fixed rather than transcribed:

> Q5 `source` was fetched and never read. A feed serving "unavailable" is now named
> in the owner banner.

The owner gate is `useIsOwner()` from `@/data/auth` — *"`isOwner` is false while
loading, so nothing flashes for a customer. Same fail-closed rule as v2's: the claim
OR an explicit id match, never a bare 'is signed in'."*

---

## Event taxonomy

### Types, from the shared module

`CalEvent` — `date` (`YYYY-MM-DD` ET), `time` (`HH:MM` 24h ET, **the sort/compare
key**), `time_formatted` (`h:MM AM/PM` ET, **the display key**), `title`, `country`,
`impact`, `forecast`, `previous`, `actual`. `EarnRow` — `date`, `symbol`, `company`,
`session` (`'pre' | 'after' | 'unknown'`, **narrow here**, unlike the card's widened
copy), `market_cap`, `eps_est`. `EarnBucket` — `{ pre; after; tbd }`.

### Impact tiers

Five, resolved through `impactColor()` in `src/data/econCalendar.ts`:

| `impact` | Token | Value |
|---|---|---|
| `High` | `--color-impact-high` | `#ff6b7a` |
| `Medium` | `--color-impact-medium` | `#ffd166` |
| `Low` | `--color-impact-low` | `color-mix(in srgb, #2f6bff 45%, #0a0d10)` |
| `Holiday` | `--color-impact-holiday` | `#c0c5c3` |
| `President` | `--color-impact-president` | `#b48cff` |

`impactColor(i)` falls back to `CAL.low` for anything unrecognised. The ramp is declared as
token references rather than hex — *"v2 typed these five values here, which is exactly
the kind of second palette v3's no-literal rule exists to prevent. The values are
unchanged."* A **stale** row is repainted in `CAL.faded` (`--color-impact-faded`,
`color-mix(in srgb, #1e2630 70%, #0a0d10)`) for its border, impact word, country,
title *and* A/F/P values.

### Classification: the shared `passes()`

This page imports `passes` from `@/data/econCalendar` — the shared one, not the board
card's variant:

Ten independent `if`s, in order: `all` → true; then `trump`+President, `all-usd`+USD,
`high-usd`, `high`, `medium-usd`, `medium`, `low-usd`, `low`; else false. Every clause
is an OR, so `trump` does **not** short-circuit and a `President` row with
`country === 'USD'` also passes under `all-usd`. `Holiday` has no clause of its own
and is reachable only via `all`, or via `all-usd` when it is USD.

### The ten filters, and why all ten ship

`FILTER_OPTS` from the shared module, each carrying its swatch colour:

| `value` | Label | Colour |
|---|---|---|
| `all-usd` | `All·USD` | `CAL.accent` `#6aa0ff` |
| `high-usd` | `High·USD` | `CAL.high` `#ff6b7a` |
| `high` | `High` | `CAL.high` |
| `medium-usd` | `Medium·USD` | `CAL.medium` `#ffd166` |
| `medium` | `Medium` | `CAL.medium` |
| `low-usd` | `Low·USD` | `CAL.low` |
| `low` | `Low` | `CAL.low` |
| `trump` | `TRUMP` | `CAL.president` `#b48cff` |
| `earnings` | `Earnings` | `CAL.accent` |
| `all` | `All` | `T.text` `#e7ece9` |

> **ALL TEN FILTERS SHIP.** v2's page declared its own 8-key `FILTER_OPTS`, dropping
> `all-usd` and `earnings` from the shared list. … `earnings` is the only control that
> can isolate the woven blocks, and this page had no other one.

### The earnings weave

`showEarnings = activeFilters.has('all') || activeFilters.has('earnings')`.

> Earnings are woven into the calendar tab when "All" or "Earnings" is on. Selecting
> only "Earnings" isolates them — no econ event passes.

The insertion order is transcribed, and flagged:

> INSERTION ORDER, transcribed exactly — this is the part of the page that a
> rebuild-from-description loses:
>   1. PRE block, immediately after the day separator, before every event.
>   2. AFTER block, immediately BEFORE the first event later than 16:00 ET.
>   3. If no event is past 16:00, the AFTER block goes at the end of the day.
>   4. TBD block always LAST — an unconfirmed time has no position in the day's
>      sequence, so anchoring it anywhere earlier would imply one.

Mechanically: `afterIdx = evs.findIndex((e) => (e.time || '00:00') > '16:00')`, the
AFTER block emitted at `k === afterIdx` during the forEach or appended when
`afterIdx < 0`, then TBD. A blank `time` is coerced to `'00:00'` for the comparison
only. **The stale stream never carries earnings**: `DayStream` takes
`earnByDate={null}` on that pass and `bucket` is forced to `null` when `faded`.

### The session kinds

| kind | `top` / `sub` | `title` (calendar tab) | `board` (week board) | colour |
|---|---|---|---|---|
| `pre` | `PRE` / `MARKET` | `Premarket earnings` | `Premarket` | `CAL.accent` |
| `after` | `AFTER` / `HOURS` | `After-hours earnings` | `After hours` | `V2.orange` |
| `tbd` | `TIME` / `TBD` | `Time unconfirmed` | `Time unconfirmed` | `T.text` |

> `board` is the week-board's session label — shorter than `title` because it sits in
> a ~200px column. Coloured per session so PRE and AFTER are distinguishable at a
> glance; they used to share one accent. … [tbd is] Deliberately desaturated: guessing
> a session would put a name on the wrong side of the close, which is worse than
> saying the time is unconfirmed.

Note the two label sets differ between this page and the board card: `PRE/MARKET`
here versus `PRE/MKT` on the card, `AFTER/HOURS` versus `AFTER/HRS`.

### Anticipated names — two narrowings out of one feed

The shared rule, from `src/data/econCalendar.ts`:

`MEGA_CAP = 25e9`; `ANTICIPATED_PER_DAY = 14`; `ANTICIPATED_SYMBOLS`, a maintained set
of ~700 tickers across eleven commented sections; `isAnticipated(r)` →
`market_cap >= MEGA_CAP || ANTICIPATED_SYMBOLS.has(symbol)`; and
`pickAnticipated(rows, perDay)`, which keeps everything anticipated then **tops each
day up** with the largest remaining caps to `perDay`, market cap descending
(`perDay <= 0` returns everything).

> The recorder now stores EVERY name Nasdaq lists … ~400–500 rows a day, which no
> board can render, so the narrowing lives here instead: one shared definition of "the
> names that matter", used by the week board, the home panel and the phone view alike.
> … CRDO, GTLB, PATH, CIEN, FIVE, OLLI, DLTH, DAKT, KNOP are all "most anticipated"
> board regulars and all far under $25B. **Size is not interest.**
>
> Maintaining the list: add a ticker when it shows up on a most-anticipated board and
> is under $25B. Removing one is never urgent.

The page applies it **twice, differently** — the stated reason it skips the hook:

```ts
// CALENDAR tab — always the anticipated set
groupEarningsByDate(capped(pickAnticipated(earnings)))
// EARNINGS tab — week-filtered, and honours the view toggle
groupEarningsByDate(capped(pickAnticipated(inWeek, earnView === 'all' ? 0 : ANTICIPATED_PER_DAY)))
```

> `pickAnticipated` is not optional here. The feed is the whole Nasdaq calendar (~500
> names a day) and a 400-chip block wedged between two timed events is not a calendar.

### The market-cap floor

`capped(rows)` is `mcapMin > 0 ? rows.filter((r) => r.market_cap >= mcapMin) : rows`.

> The cap floor. Applied BEFORE bucketing, so a day left with no qualifying names
> drops out of the Map entirely and its separator stops rendering — rather than
> showing an empty PRE/AFTER strip.
>
> [and on the default] A pure client-side narrowing of rows already in hand — changing
> it never refetches. 0 = show whatever the feed returned, which is the honest default:
> a hardcoded floor here would silently re-hide the names the recorder was widened to
> include when its own floor came out.

### The TBD bucket

`groupEarningsByDate` puts anything that is neither `pre` nor `after` into `tbd`:

> `tbd` did not used to exist: any row whose session was neither "pre" nor "after"
> was DROPPED here and never rendered on any surface. That is not a rare edge —
> Nasdaq marks the large majority of its calendar "time-not-supplied" (on a typical
> day ~380 of ~490 rows) … The recorder's daily 06:30 ET re-sweep is what drains this
> bucket as Nasdaq confirms times through the week.

---

## Time handling

Everything is Eastern, through `Intl` with `timeZone: 'America/New_York'` — *"A trader
in London must see the same 'TODAY' and the same 30-minute staleness cutoff as one in
New York, so every date and clock value round-trips through Intl … rather than reading
the device's local time."*

### The ET helpers this page uses

| Helper | Returns | Notes |
|---|---|---|
| `etToday()` | `YYYY-MM-DD` ET | `Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })` |
| `etNowParts(ms)` | `{ date, minutes }` | `en-CA` for the date, `en-GB` `hour12:false` for `HH:MM`, minutes since ET midnight |
| `isStale(ev, nowMs)` | boolean | earlier date → true; later date → false; blank time → false; else `nowMin − evMin > 30` |
| `fullDayLabelLong(d, today)` | `TODAY` or e.g. `MONDAY SEPTEMBER 1` | the page's day separator |
| `etMonFri(offsetWeeks)` | 5 `YYYY-MM-DD` strings | the week board's columns |
| `dayFull(d)` / `dayDate(d)` | `MONDAY` / `SEP 1` | `board.ts`, for the column date strip |

### The 30-minute stale window, and dimming rather than dropping

`filtered` is partitioned into `activeEvents` and `staleEvents` by `isStale(e, now)`.

Both render: the live stream, then — if anything is stale — a 1px `V2W.border` rule
(only when `activeEvents.length > 0`), then the same `DayStream` with `faded`. That is
the opposite policy to the board card, which uses its own 60-minute `isStale` and
**removes** the row (*"the print lands within the hour and after that the row is
occupying a card that is about what is still coming"*). The page has the room, so it
keeps the history at 32% opacity.

### The long day label

`fullDayLabelLong` returns `TODAY`, else `toLocaleDateString('en-US', { weekday:
'long', month: 'long', day: 'numeric' })` upper-cased. The module carries three
day-label formatters and is explicit that this is not drift:

> v2 had BOTH forms and they disagreed: the shared helper above (transcribed from the
> home panel) abbreviates the month, while the standalone `/economic-calendar` page
> declared its own with `month: "long"`. That is a genuine difference rather than
> drift to be flattened — the panel is a narrow sidebar strip and the page is full
> width — so both ship, named apart.
>
> **DECIDED 2026-09-03 (Brandon): the PAGE uses the long form.** Spec:
> `docs/parity/economic-calendar.md` Part H.

Also decision 3 in the page header: *"LONG DAY LABEL. 'MONDAY SEPTEMBER 1', v2's page
wording, not the shared module's 'MONDAY SEP 1'."* Note the `T12:00:00` is **local**
noon, not UTC noon, and `toLocaleDateString` is called without a `timeZone`; `dayFull`
and `dayDate` in `board.ts` do the same.

### Weekends, and the week board's Monday

`etMonFri` reads the ET day-of-week off `` new Date(`${today}T12:00:00Z`).getUTCDay() ``,
offsets to Monday with `dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow`, then walks five days.

> Weekends roll FORWARD, matching `server-v2/earnings-calendar-recorder.js`'s
> `weekMonFri`: on a Saturday "this week" is the week that starts on Monday, not the
> one that just ended. **The two must agree or the board asks the server for a week
> it did not store.**

`addDaysYmd` anchors at `T12:00:00Z` and returns `toISOString().slice(0,10)`, which
keeps the arithmetic DST-safe. The page repeats the warning at the call site.

### Holidays

Not special-cased. A `Holiday`-impact row renders as an ordinary event in
`--color-impact-holiday` and passes only under `all` (or `all-usd` when USD). A market
holiday inside a board week is simply a column with no qualifying names, which —
because `capped()` runs before bucketing — drops out of the Map and out of the grid
entirely: a four-column week.

---

## Tabs and controls

### The tab

| | |
|---|---|
| Values | `calendar` (default) \| `earnings` |
| State | **query string**, via `useSearchParams()` |
| Read | `params.get('tab') === 'earnings' ? 'earnings' : 'calendar'` — anything other than the exact string `earnings` is Calendar |
| Write | `setTab` deletes the param for Calendar, sets it for Earnings, and calls `setParams(next, { replace: true })` — no history entry per tab click |
| Control | a `Seg` pill group in the top bar, labels `Calendar` / `Earnings` |

This is **Q9** of the four transcribed-defect fixes:

> Q9 the tab was not in the URL, so every shared link opened on Calendar.
> `?tab=earnings`, the shape `/v3/scanner` already uses.

### Every control, and where its state lives

| Control | Tab | Default | State |
|---|---|---|---|
| Tab `Seg` | both | `calendar` | **query string** `?tab=` |
| Impact filter dropdown | Calendar | `new Set(['all'])` | in-memory |
| Week `Seg` — `This wk` / `Next wk` | Earnings | `0` (this week) | in-memory |
| View `Seg` — `Anticipated` / `All` | Earnings | `anticipated` | in-memory |
| MCAP dropdown | **both** | `0` (`All caps`) | in-memory |
| Search input | one per tab | `''` | two strings, `calSearch` / `earnSearch` |
| `↻ Now` | both | — | `refreshing` flag + `lastRefresh` string |

**Nothing on this page uses `localStorage`.** The board card persists its filter set
under `cb-v3-econ-filters`; this page does not, and the two never share a selection.

### The impact filter

Multi-select, and the menu stays open. `toggleFilter`: picking `all` clears everything
else; picking anything else drops `all`; unticking the last active key snaps back to
`all`, so the set is never empty. The trigger's label is `ALL` when `all` is active,
otherwise the active labels joined with ` + ` — e.g. `High·USD + TRUMP`. Rows use
`MenuRow` (a 3.5×3.5 **square** checkbox, `rounded-[3px]`, 2px border in the option's
colour, `V2.badgeInk` `#071026` tick); selected rows get a vertical accent gradient and
a 30%-accent border, hover a flat 10% accent tint.

### The week and view toggles

*"Week + breadth — earnings tab only. Both are filters over rows already in hand: no
refetch, no spinner."* Each `Seg` option carries a `title`: the week buttons get
`weekRangeLabel(0|1)` = `rangeLabel(etMonFri(n), ' – ')`, e.g. `SEP 1 – SEP 5`, spaces
around the dash *"as v2 has it"* (the board header uses the tight `–`). The view
buttons get `VIEW_OPTS[].hint`:

| `value` | Label | Hint |
|---|---|---|
| `anticipated` | `Anticipated` | `Most-watched names, ~14 per day` |
| `all` | `All` | `Every name on the Nasdaq calendar` |

> "All" is every name Nasdaq lists for the week: several hundred a day, which is a
> legitimate thing to want and a terrible default. This exists at ALL because the
> recorder used to do the narrowing server-side with a hard $25B cut, so "all" was
> never reachable from the UI — the missing names had never been stored.

### The MCAP floor

Six options, a `title` of `Minimum market cap for earnings names`, and a **live
count** of what is renderable at the current floor:

| `value` | Label |
|---|---|
| `0` | `All caps` |
| `1e9` | `≥ $1B` |
| `10e9` | `≥ $10B` |
| `25e9` | `≥ $25B` |
| `100e9` | `≥ $100B` |
| `1e12` | `≥ $1T` |

The button reads `MCAP` (accent, extra-bold) + the label + `earnShown` (mono, in
`CAL.low`) + `▾`. The count is per-tab: *"Counted off the bucketed Map for the tab IN
VIEW, not off the raw feed, so the number matches what is on screen."* Picking an
option **closes** the menu, unlike the impact menu. It is on both tabs on purpose:
*"the calendar tab weaves the same rows between events, so the floor has to be
reachable there too or the chips can only be thinned from a tab you are not on."*

### The two searches

One `<input>` renders, but it is bound to a different string per tab:

| Tab | Value | Placeholder | `aria-label` | Matches (case-insensitive `includes`) |
|---|---|---|---|---|
| Calendar | `calSearch` | `Search…` | `Search events` | `ev.title`, `ev.country` |
| Earnings | `earnSearch` | `Search ticker…` | `Search ticker` | `r.symbol`, `r.company` |

This is **Q6**: *"one `search` string was shared across both tabs, so a calendar query
silently filtered the earnings board. One query per tab."* The earnings search is
applied **after** bucketing, inside `earningsSections`; a day whose three buckets all
filter to empty is dropped from the board entirely.

### The refresh button

`↻ Now`, becoming `…` while `refreshing`. It carries `hideFromCapture`, which sets
`data-capture-hide`: *"Kept out of the PNG. v2 spelled this `data-noshot` … Only
matters for the whole-page (calendar tab) shot — the board capture excludes the
toolbar outright."*

### The date chip

```tsx
{today}{lastRefresh ? ` · ${lastRefresh}` : ''}
```

**Q4**, and the comment is blunt about the original: *"the date chip was gated on
`lastRefresh` but rendered `today`, so it was invisible until the first load and then
never changed. It now shows the ET date unconditionally and the refresh time beside
it."*

---

## Rendering

### Page skeleton

```
<Page fill> › <div ref={pageRef} style={{ background: V2.bg }}>
  ├─ TOP BAR   (shrink-0, flex-wrap, border-b, backdropFilter: blur(16px))
  │    left:  /cb-edge-logo.png · "Economic Calendar" · date chip · tab Seg
  │    right: [impact filter | week Seg + view Seg] · MCAP · search · ↻ Now
  ├─ QUOTE BAND   calendar tab only, and only when quote.data.quote is truthy
  ├─ FEED BANNER  calendar tab, owner only, !feedError && (warning || source==='unavailable')
  └─ BODY  (min-h-0 flex-1 overflow-y-auto)
       ├─ tab==='earnings' → loadingEarn ? <Loading/> : <EarningsBoard boardRef=… />
       └─ tab==='calendar' → feedError&&isOwner ? error block
                           : loadingCal        ? <Loading/>
                           : filtered.length===0 ? "No events match."
                           : <DayStream active/> [ + rule + <DayStream stale faded/> ]
```

The top bar and the quote band both use `V2W.panelBgStrong` with a 16px backdrop blur
and a `V2W.border` bottom edge. The logo is `/cb-edge-logo.png`, `h-5 w-auto`, served
*"from the v2 public/ root, which is the same origin."*

### Calendar tab — the day separator

`flex items-center gap-2 border-t px-4 py-1.5`, `background: isToday ? V2W.todayRow :
V2W.panelBg`, `borderTopColor: V2W.border`. The label is `text-xs font-extrabold
tracking-[0.1em] text-fg` — **white on every day**: *"the accent pill and the tinted
row already mark today, and a dimmed label made every other date read as disabled."*
Today additionally gets a solid pill (`rounded-sm px-1.5 py-px text-2xs font-black`,
`background: CAL.accent`, `color: V2.badgeInk`).

### Calendar tab — `EventRow`

| Property | Value |
|---|---|
| Grid / min height | `gridTemplateColumns: '80px 1fr'`, `min-h-[52px]` |
| Transition / opacity | `transition-opacity duration-[400ms]`, `faded ? 0.32 : 1` |
| Left border | `3px solid` impact colour (or `CAL.faded`) |
| Background | live: `linear-gradient(90deg, alpha(col,0.06) 0%, transparent 35%), V2.bg`; faded: flat `V2.bg` |
| Time cell | `border-r` in `V2W.border`, `px-3 py-2`, plus `boxShadow: inset -1px 0 8px alpha(col, 0.09)` when live |
| Time text | `tabular font-mono text-sm`, `ev.time_formatted \|\| ev.time \|\| 'TBD'` |
| Impact word / country | `text-2xs font-extrabold uppercase tracking-[0.1em]` in `col`; `text-xs font-semibold` in the body colour |
| Title | `text-sm leading-tight`, `font-bold` for High, `font-medium` otherwise |
| `A:` / `F:` / `P:` | `CAL.actual` `#3ddc8e` (value in `<strong>`) / `CAL.forecast` `#ffd166` / **the body colour**, i.e. white |

The `P:` choice: *"WHITE, not grey. A/F/P is already colour-coded green/amber and a
grey 'previous' was the one body value that read as disabled rather than as data."*

### Calendar tab — `EarnRowBlock`

Same 80px/1fr grid and `min-h-[52px]`, so a woven block reads as a row of the same
table. Left border and the two gutter lines take `EARN_KIND[kind].color`; the `sub`
line is `CAL.low`. The body prints `k.title` as a `text-2xs font-extrabold uppercase`
heading, then the chips: `flex flex-wrap` with `gap: CHIP_GAP` (10px), each chip a
`width: CHIP_W` (46px) column of a 34px `ChipLogo` (radius 8) over a truncated
`font-mono text-2xs font-bold` ticker.

Chip link: `https://finance.yahoo.com/quote/<sym>`, `target="_blank" rel="noreferrer"`,
`title` = `` `${company || symbol} · ${fmtMcap(market_cap)}${eps_est ? ` · est ${eps_est}` : ''}` ``
— *"Cap and EPS estimate, one hover away."* `fmtMcap` here is the **shared** one:
`$X.XXT` / `$XB` / `$XM`, `"n/a"` for zero.

### Earnings tab — the week board

`<div ref={boardRef} className="p-3" style={{ background: V2.bg }}>` wraps a branded
header, a `grid items-start gap-2.5` of `DayColumn`s at
`repeat(auto-fit, minmax(210px, 1fr))`, and a footer pairing the deep link (left) with
`/cbedge3.0.png` at `h-14` (right) on one `items-end` baseline.

The layout decision:

> The old v2 layout was the calendar's own row grid … A week with four names on Tuesday
> spent a 2000px-wide row on four 46px chips, so the tab was mostly empty background
> down the right-hand side … Columns fix both halves: the width is divided between the
> days instead of being handed to one row, and the whole week lands in one screen —
> which is also what makes the tab worth pasting into a chat as a single image.
>
> `auto-fit`, not `repeat(5)`: the feed decides how many days come back.

**The board header** is inside `boardRef` so the pasted picture carries it: `EARNINGS
THIS WEEK` / `EARNINGS NEXT WEEK` in `CAL.accent`, with the range under it built from
the **first and last rendered dates**, not `boardDays[0]`/`[4]` — *"a week whose Monday
has no qualifying names reads 'SEP 2 – SEP 5'."*

The title is accent, not white: *"Everything else on this board is white or near it …
so a white title was one more white thing rather than the thing you read first."* On
the right, `cbedge.net` at `text-xl font-extrabold` — *"At 11px it was a footnote in the
corner; this is the size a watermark has to be to survive a screenshot of a
screenshot."* The header used to carry three more pills and they came out: *"each day
column prints its own count, and the columns themselves ARE the view. A signature does
not need a legend."*

**The footer** is a deep link on the left (`cbedge.net/v3/economic-calendar`, mono,
`CAL.accent`) and the mark on the right (`/cbedge3.0.png`, `h-14`). *"cbedge3.0.png is
a 3.4:1 banner with a TRANSPARENT ground … the .jpg carried a baked-in black plate, and
the board's ground is near-black but not black, so the plate showed as a faintly
different rectangle."* `items-end` rather than `items-center`, *"so centring them
floated the text in the middle of the mark's height."*

### Earnings tab — `DayColumn`

A rounded-xl card, `border: 1px solid BOARD.edge` (or `edgeToday`), filled with
`BOARD.card` / `BOARD.cardToday`. Its date strip is a **three-column grid**, not a
flex row:

> THREE-COLUMN GRID, not a flex row, because the date has to sit in the MIDDLE of the
> strip. … a column showing "11" put its date a few px left of one showing "1". Equal
> 1fr outer tracks make the middle track's centre the strip's centre whatever either
> side holds.
>
> ONE SIZE AND ONE FAMILY for every run in the strip. They used to be 10px mono and
> 13px sans, which the live page reconciles with `align-items:center` and a capture
> does not.

Contents: `dayFull(date)` (`MONDAY`) in `CAL.accent`, `dayDate(date)` (`SEP 1`) in
white, a `TODAY` pill when it is today, and the day's total `n` at `opacity-60`.

### Earnings tab — `SessionBlock` and `EarnChip`

`SessionBlock` is `px-2.5 pb-2.5 pt-2` with a `1px solid BOARD.rule` top border, a
per-session label and its count at `opacity-60`. The dot lives **inside** the label
span: *"As a flex sibling it centred on the ROW … so a 6px dot sat on the line's middle
while the 9px all-caps label's cap band sits above that."* The chip grid is
`repeat(auto-fill, minmax(${CHIP_MIN}px, 1fr))` with `gap-2`.

`EarnChip` is logo-then-ticker and nothing else: *"The market-cap line is gone … it
cost a third line on every tile, which is what made a nine-name Wednesday taller than
the fold."* `width:100%` + `text-center` is what actually centres the label —
*"`align-items` only centres the SPAN, not the text inside a span that stretches."*

`lazy={false}` on the board's logos is load-bearing: *"this board is the capture
target, and any capture engine clones the DOM as it stands — a chip the browser has
not fetched yet captures empty."*

### `ChipLogo` — the four-stage resolution ladder

`src/pages/economicCalendar/ChipLogo.tsx`, `LOGO_REV = 4`:

1. `/logos/<SYM>.png?v=4` — mirrored, same-origin, immutably cached. Preferred
   *"because stage 2 costs TWO round trips per chip: a PG lookup, a HEAD to GitHub and
   up to two Wikidata calls before it answers."*
2. `/proxy/ticker-logo?raw=1&sym=…&name=…` — the live resolver. **`raw=1` is
   load-bearing:** *"it makes the proxy STREAM the bytes rather than 302 to a
   third-party host. A redirected image taints a capture canvas and `toBlob` then
   throws, which used to kill the whole earnings board PNG over one 16px image."*
3. The **parent ticker's** mirrored PNG, share classes only — `LEN.B` borrows
   Lennar's. Matcher `/^([A-Z]{1,5})[.-][A-Z]$/`, *"deliberately narrow … A loose rule
   here does not degrade, it MISLABELS: strip more and `BRK.B` stops being Berkshire's
   B share and starts being whatever `BRK` happens to be."*
4. A ticker-text square: `sym.slice(0, 4)` on a 10%-accent plate,
   `fontSize: max(9, round(size / 3))`.

Stages 1–3 are the exported `tickerLogoUrls(sym, company)`, walked by both the chip
**and** `shell/snapshot.ts`'s caption badge — *"ONE list, one order, one place to change
it … a stage added here did not reach the caption badge, and a shot of a card quietly
carried a worse mark than the card did."*

The `?v=` query is not decoration: *"v2's `next.config.js` serves `/logos/:path*`
with `Cache-Control: immutable, max-age=1y` and applies it to the PATH, with no idea
whether the file exists — so a 404 for an unmirrored ticker was cached as immutable
and the browser refused to ask again for a YEAR."* Hence the explicit warning:
**⚠ BUMP `LOGO_REV` IN STEP WITH v2's `components/shared/ChipLogo.tsx`** whenever
files are added to `public/logos` — *"Two apps read one mirror."*

The component keeps `{ sym, i }` in state rather than a bare index, *"because these
chips are rendered from a list and React reuses the instance: a row that scrolls from
a dead ticker to a live one would otherwise inherit an exhausted index and print as
text forever."* `key={src}` on the `<img>` forces a remount per rung *"so the browser
actually re-requests."*

### Colour tokens, with the values from `src/design/tokens.css`

| Used as | Token | Value |
|---|---|---|
| `V2.bg` — page + row ground | `--color-v2-bg` | `#0a0d10` |
| `V2.panel` — the plate every board wash mixes over | `--color-v2-panel` | `#0e1216` |
| `V2.cyan` — v2's card title hue, base of `todayRow` | `--color-v2-cyan` | `#6aa0ff` |
| `V2.orange` — the AFTER session | `--color-v2-orange` | `#ffd166` |
| `V2.badgeInk` — ink on every solid accent fill | `--color-v2-badge-ink` | `#071026` |
| `CAL.accent` — page accent, PRE session, TODAY pills, board title | `--color-cal-accent` | `#6aa0ff` |
| `CAL.high` / `.medium` / `.low` | `--color-impact-*` | `#ff6b7a` / `#ffd166` / `color-mix(in srgb, #2f6bff 45%, #0a0d10)` |
| `CAL.holiday` / `.president` / `.faded` | `--color-impact-*` | `#c0c5c3` / `#b48cff` / `color-mix(in srgb, #1e2630 70%, #0a0d10)` |
| `CAL.actual` / `.forecast` | `--color-cal-*` | `#3ddc8e` / `#ffd166` |
| `T.text` — body copy, the TBD session | `--color-fg` | `#e7ece9` |
| `SHADOW` — the search input's fill base | `--color-shadow` | `#000000` |

The derived washes, all built with `alpha()` (which is `color-mix(in srgb, <c> N%,
transparent)`, never an `rgba()` literal):

| Name | Definition |
|---|---|
| `V2W.border` | `alpha(--color-fg, 0.10)` — v2's white hairline, not v3's slate line |
| `V2W.panelBg` / `.panelBgStrong` | `alpha(--color-v2-panel, 0.45)` (day separator) / `0.72` (top bar, quote band) |
| `V2W.todayRow` | `alpha(--color-v2-cyan, 0.06)` — *"The econ calendar's TODAY day-separator plate."* |
| `BOARD.card` | `linear-gradient(180deg, alpha(fg,.075), alpha(fg,.045)), PLATE` |
| `BOARD.cardToday` | `linear-gradient(180deg, alpha(accent,.16) 0%, alpha(fg,.05) 55%), PLATE` |
| `BOARD.header` | `linear-gradient(180deg, alpha(accent,.18) 0%, alpha(fg,.05) 75%), PLATE` |
| `BOARD.head` / `.headToday` / `.tile` | `alpha(fg,.06)` / `alpha(accent,.14)` / `alpha(fg,.035)` |
| `BOARD.edge` / `.edgeToday` / `.rule` | `alpha(fg,.16)` / `alpha(accent,.55)` / `alpha(fg,.09)` |

`PLATE = alpha(V2.panel, 0.45)`. `board.ts` argues the whole approach:

> v2's `HT.panelBg` is a dark panel at 45% over a near-black page. On a surface that
> is MOSTLY card … that lands almost on the background and the whole tab reads as one
> flat black rectangle: the cards were there, they just had no luminance to separate
> them. So the board's cards are lifted with a WHITE alpha over the plate rather than
> by picking a lighter value.
>
> Three rungs … CARD — a day column, the lightest thing on the page. HEAD — its date
> strip, one rung UP so the date has a plate. TILE — a ticker chip, one rung DOWN so
> the chips read as objects sitting ON the column rather than holes cut into it.

### Layout constants

| Constant | Value | Where |
|---|---|---|
| `CHIP_W` / `CHIP_GAP` | `46` / `10` | chip column width and gap in the calendar tab's woven block |
| `CHIP_LOGO` / `CHIP_MIN` | `42` / `52` | board logo size; grid track minimum for the board's chip grid |
| Board column min | `210px` | `repeat(auto-fit, minmax(210px, 1fr))`, `gap-2.5` |
| Event row | `80px 1fr`, `min-h-[52px]` | both `EventRow` and `EarnRowBlock` |
| Woven-block logo | `34`, radius `8` | calendar tab only |
| Menu / input widths | `180px` filter, `170px` MCAP, `140px` search | |
| Impact bar / faded opacity | `3px` / `0.32` | `borderLeft`; 400ms transition |
| `FEED_STALE_MS` / `CLOCK_MS` | `600_000` / `60_000` | all three reads; the tick |
| After-hours split | `'16:00'` | string compare against `ev.time` |

`CHIP_LOGO` and `CHIP_MIN` carry an explicit coupling warning: *"42px is the largest
logo that still clears the tile's 3px side padding at the SAME four-across track — the
chips get bigger without the grid reflowing to three per row, which would have made a
nine-name Wednesday taller, not denser. **KEEP THESE TWO IN STEP:** `CHIP_LOGO` + 6px
of padding must stay under the track width `CHIP_MIN` resolves to, or the logo drives
the column width instead of the other way round."*

### Type sizes

v3's scale is 9 / 10 / 11 / 13 / 15 / 18 (`text-3xs` … `text-lg`); v2's 12 and 14 are
not on it. Decision 1 of the port: *"TYPE SIZES COLLAPSE DOWN … 12 → `text-xs` (11),
14 → `text-sm` (13). Down rather than up so the size ORDER survives everywhere —
rounding 14 up to 15 would have made an event title larger than the board header's own
title."*

### Local chrome components

- `PillButton` — v2's `homeButtonStyle` as one component *"so no call site re-derives
  it"*: 25%-accent border, a 12%→4% accent gradient, `disabled:opacity-45`.
- `Seg` — the segmented pill group behind all three toggles. Deliberately **not**
  `Controls`'s `SegGroup`: *"this page's active state is a SOLID accent fill with dark
  ink, which is v2's language on this surface and is what the board's TODAY pill
  matches."*
- `MenuRow` (hover tint only when unselected), `Loading` (`mt-16 text-center text-sm`).

---

## The camera

Two CopyShot targets, chosen by tab, published through `useCopyShotTargets`:

| Condition | `id` | Label | Target | Extras |
|---|---|---|---|---|
| `tab === 'earnings'` **and** `earningsSections.length > 0` | `econ-calendar:board` | `Earnings week board` 📅 | `boardRef` | `bare: true`, file `earnings-{this\|next}-week-{today}` |
| `tab === 'calendar'` | `econ-calendar:page` | `Economic Calendar` 📅 | `pageRef` | `meta: today`, file `econ-calendar-{today}` |
| otherwise | — | — | `NO_TARGETS` | |

> v2 carried its own "⧉ Copy" button and switched what it photographed by tab: the
> earnings tab captured the BOARD ALONE (it carries its own header and signature, so
> the pasted image is a self-contained card rather than a screenshot of an app) and
> the calendar tab captured the whole page. … v3 captures through `<foreignObject>`,
> so v2's html2canvas workarounds — `data-cap-center`, `data-cap-swatch`, the concrete
> mono fallback stack, the scroll-box expand/restore dance — do not come across. What
> DOES come across is `lazy={false}` on the board's logos.

`bare: true` on the board target: *"NO CAPTION, AND SO NO `meta`. The board is the
poster … The caption was adding a SECOND CB Edge mark and a line ('This week · N
names') saying what the header and the per-column counts already say."* An earnings
tab with **no** sections publishes `NO_TARGETS`, so the row disappears from the camera
menu rather than offering an empty board.

---

## Phone behaviour

`/economic-calendar` renders its desktop layout on a phone; it is not in
`DESKTOP_TO_MOBILE` and is not redirected. The phone's own calendar screen is a
different surface:

`src/mobile/pages/MEcon.tsx` (26 lines) `lazy()`-imports `EconCalendarCard` and mounts
it inside `<MobileShell title="Calendar & Earnings" fill>` with a blank Suspense
fallback. That is the whole screen.

> It IS the home board's `econ-calendar` card. `fill` because the card scrolls INSIDE
> itself … so an outer scroll would give the screen two scrollbars and detach that row
> from the rows it filters.
>
> No ticker control: the calendar is not a per-symbol surface, and a picker that
> changed nothing on screen would be a control that lies.

So on a phone you get the **today-only, drop-after-an-hour** card with its
`localStorage` filter set — not the two-tab page, not the week board, not the quote
band, not the owner banners. `DESKTOP_TO_MOBILE['/m/econ'] → '/'` sends a long-press
escape to the card gallery, not here. The tab in `src/mobile/mobileNav.ts` is labelled
`Cal`, titled `Economic Calendar`.

---

## Status and empty-state messages

Verbatim, with the exact condition for each.
| Message | Where | Condition |
|---|---|---|
| `Loading…` | `<Loading/>`, centred, `mt-16 text-sm text-fg` | Calendar: `cal.loading && events.length === 0`. Earnings: `earn.loading && earnings.length === 0`. Both gated on **an empty list**, not on `data`. |
| `No events match.` | `p-5 text-sm text-fg` | Calendar tab, not loading, no owner error, and `filtered.length === 0` — i.e. the filter + search combination matched nothing, **or** the feed returned nothing. The two are indistinguishable to a customer. |
| `No earnings loaded.` | `p-5 text-sm text-fg` | Earnings tab, `sections.length === 0` **and** `allRows.length === 0` — the feed itself is empty. |
| `Nothing stored for SEP 1–SEP 5 yet.` | same | Earnings tab, feed non-empty, but no row falls inside `boardDays`. The range is `rangeLabel(boardDays)`, tight `–`. |
| `No earnings ≥ $25B this week — try a lower cap.` | same | Earnings tab, rows exist in the week, `mcapMin > 0` and `earnShown === 0`. The label is the selected `MCAP_OPTS` label. |
| `No earnings match.` | same | Earnings tab, everything else — in practice the search box excluded everything. |
| `⚠ <warning>` or `⚠ Economic feed source: <source>.` | amber banner under the top bar, `CAL.medium` on a 6% tint with a 25% border | Calendar tab, `isOwner`, no `feedError`, and (`feedWarning` present **or** `feedSource === 'unavailable'`). |
| `⚠ <error>` | red block, `m-4 rounded border p-4 text-sm`, `CAL.high` on a 5% tint | Calendar tab, `isOwner`, `feedError` truthy. Replaces the whole stream. |

The four board messages exist because one generic line was not enough: *"NAME THE
REASON. 'No earnings match.' reads as an empty feed, but the usual cause is a cap floor
set two clicks ago and forgotten — or a week the recorder has not swept yet."* The
banners are owner-gated because they *"name upstream hosts, HTTP status codes and cache
timestamps: diagnostics, not customer copy"*, and the error block likewise —
*"Customers fall through to the neutral empty line below rather than seeing upstream
status text."*

Other fixed strings: `Economic Calendar`, `Calendar` / `Earnings`, `This wk` / `Next
wk`, `Anticipated` / `All`, `MCAP`, `All caps`, `≥ $1B`, `≥ $10B`, `≥ $25B`, `≥ $100B`,
`≥ $1T`, `Search…` / `Search ticker…`, `↻ Now`, `…`, `Minimum market cap for earnings
names`, `TODAY`, `Premarket earnings`, `After-hours earnings`, `Time unconfirmed`,
`Premarket` / `After hours` / `Time unconfirmed` (board), `EARNINGS THIS WEEK` /
`EARNINGS NEXT WEEK`, `cbedge.net`, `cbedge.net/v3/economic-calendar`.

---

## Performance notes

**Network.** Three GETs at entry, in parallel, none polled, all with a ten-minute TTL
and all deduped app-wide by URL; `/api/calendar` is shared with the board card. Steady
state is **zero** network traffic. The only additional requests are logo fetches,
same-origin and immutably cached under `?v=LOGO_REV`. *"The RULE: a route fires
everything it needs in parallel, at entry. Fetching inside a child that only mounts
after a parent's fetch resolves is a waterfall, and waterfalls are the reason
dashboards feel slow."*

**Both weeks in one request.** `?week=both` makes the week toggle a pure client filter
— no refetch, no spinner, and the camera captures whatever is showing.

**The clock.** One 60-second `setInterval` setting `now`, **not** visibility-gated (the
board card's is), so a backgrounded tab re-renders the stream once a minute. Each tick
re-runs `isStale` over `filtered`; `events`, `earnings`, `earnByDate`, `boardByDate`,
`earnShown` and `earningsSections` are `useMemo`'d on inputs that exclude `now`, so a
tick never rebuilds the earnings buckets.

**Sorting is load-bearing, not defensive:** *"The server sorts too, but the fallback
paths (cache, saved `events.json`) merge two sources and the page renders in row
order."*

**Cap before bucket.** `capped()` is applied to `pickAnticipated`'s output before
`groupEarningsByDate`, so an excluded day never enters the Map and never renders a
separator or an empty strip.

**Chunking.** `lazy()` puts the page — plus `board.ts` and `ChipLogo.tsx` — in its own
route chunk, measured by `scripts/check-budgets.mjs` against `budgets.json`'s `route`
ceiling of **59,100 brotli bytes** (entry 38,900, CSS 8,500, `totalInitial` 108,400).
`scripts/check-theme.mjs` runs on every build over this file.

**No socket, no canvas** — *"REST-only: three feeds fired in parallel at entry, no
socket, no canvas."* `perf-check.mjs`'s repaint budgets apply to `data-cb-layer`
canvases and there are none here. **`lazy={false}` on board logos** trades eager
loading for a capturable board — on an `All`-view week, several hundred `<img>` at once.

---

## Gotchas
1. **The `Shell.tsx` prefetch comment is stale.** It says this page's feeds go out
   through a raw `no-store` fetch in `data/econCalendar.ts`. The page moved to
   `useQuery`; the hook did not. The rail still carries no prefetch, so hovering
   "Econ Cal" warms nothing — even though it now could.
2. **The page does not use `useEconCalendar`, and the module does not know it.** The
   module header still describes two desktop implementations to be migrated onto it.
   The live consumers of the hook are `src/pages/Premarket.tsx` and
   `src/pages/analysis/cards/EconCalendar.tsx`.
3. **`/proxy/earnings-week` is fetched twice per session** when the card and this page
   are both open — bare versus `?week=both`, two cache keys. `/api/calendar` *is*
   shared.
4. **Two `isStale` windows, two policies.** This page: 30 minutes, dim and keep. The
   board card: 60 minutes, remove. Separate functions in separate files.
5. **The filter set is not shared with the card and is not persisted.** The card writes
   `cb-v3-econ-filters` to `localStorage` and defaults to `['all-usd','trump','earnings']`;
   this page holds a `Set` in component state and defaults to `['all']`. A reload resets
   the filters, the week, the view, the cap floor and both searches. Only the tab
   survives, in the URL.
6. **`?tab=` accepts exactly one non-default value.** `?tab=Earnings` or anything else
   silently opens Calendar, and `setTab` uses `replace: true`, so Back does not step
   between tabs.
7. **The two `DayStream` passes can emit duplicate event keys.** The separator key is
   namespaced (`sep-a-…` / `sep-s-…`), but the event key is `` `${ev.date}-${ev.time}-${i++}` ``
   with `i` local to each call, so both streams start at 0.
8. **`DayStream` iterates insertion order, not sorted order.** It builds `byDate` by
   walking the already-sorted list, so day order follows the feed's sort.
   `earningsSections` sorts its keys explicitly; `DayStream` does not. The shared
   module's note about a drifted duplicate whose *"day-separator renderer omits the
   panel's `.sort()`"* describes the v2 original of this code.
9. **A day with earnings but no passing econ event shows nothing on the calendar tab.**
   `DayStream` builds `byDate` from **events only**. The board card explicitly
   backfills that case (*"otherwise the earnings silently vanish on a quiet macro
   day"*); this page does not.
10. **`lastRefresh` is device-local time next to an ET date.** The chip reads
    `2026-09-20 · 3:41:07 PM`, ET date and viewer-local clock.
11. **Weekend roll-forward is a contract with the server.** `etMonFri` must keep
    agreeing with the recorder's `weekMonFri` — *"or the board asks the server for a
    week it did not store."* On a Saturday, "This wk" is the week that has not started.
12. **Day labels use local noon, not UTC noon.** `fullDayLabelLong`, `dayFull` and
    `dayDate` build `` new Date(`${d}T12:00:00`) `` and format with no `timeZone`. The
    board card's own `fullDayLabel` uses `T12:00:00Z` instead, *"so the date cannot
    slide a day either way when re-read in ET."*
13. **MCAP is on both tabs and its count follows the tab you are on.** A floor set on
    the earnings tab also thins the chips woven into the calendar tab, and the number
    on the button changes when you switch tabs without touching the control.
14. **An unrecognised `impact` renders in `CAL.low`.** `impactColor()` has no
    normalisation; the lookup is exact and case-sensitive.
15. **`LOGO_REV` is a cross-repo coupling.** Bumping it here without bumping v2's
    `components/shared/ChipLogo.tsx` leaves two apps reading different generations of
    one mirror.
16. **`raw=1` must stay on the proxy URL in `tickerLogoUrls`.** Without it the proxy
    302s to a third-party host, the image taints the capture canvas and `toBlob`
    throws — losing the whole board PNG over one chip.
17. **`bare: true` and `meta` are mutually exclusive.** `CopyShotTarget.bare` documents
    that `meta` *"is ignored alongside it: there is no caption left for it to land
    in."* The board target sets `bare`; the page target sets `meta`.
18. **The board's range label comes from rendered dates, not the week.** A Monday with
    no qualifying names produces `SEP 2 – SEP 5` on a week whose `boardDays[0]` is
    `SEP 1`. The week toggle's tooltips use `etMonFri` directly and always show all five.
19. **`EarningsBoard` returns early before computing `first`/`last`.** On an empty week
    only the "name the reason" line renders — no header, no signature — which is also
    why the camera publishes `NO_TARGETS` there.
20. **The quote band is calendar-tab only and unclamped.** `quote.data?.quote` renders
    as text inside typographic quotes with no length limit, so a long quote grows the
    band and pushes the stream down.
21. **`CHIP_LOGO` and `CHIP_MIN` are coupled and the file says so.** `CHIP_LOGO + 6px`
    of padding must stay under the track width `CHIP_MIN` resolves to, *"or the logo
    drives the column width instead of the other way round."*
