# Board card — `econ-calendar`

| | |
|---|---|
| **Catalog id** | `econ-calendar` |
| **Label** | Economic Calendar & Earnings |
| **Icon** | 🗓️ |
| **Default size** | `{ w: 24, h: 48 }` — half the 48-column board, 384px tall (`BOARD_ROW_H` is 8) |
| **Registered in** | `src/board/catalog.tsx` (entry at line 340, `lazy()` import at line 29) |
| **Component** | `EconCalendarCard` (named export, not default) |
| **Primary sources** | `src/board/econCalendar/EconCalendarCard.tsx`, `src/board/econCalendar/econTemplate.ts` |
| **Shared feed module** | `src/data/econCalendar.ts` |
| **Also mounted at** | `/m/econ` (phone), `/cards/econ-calendar` (card gallery) |

---

## What it is, in one paragraph

A single-column strip of **everything still coming today**, Eastern time, sorted by
clock: the economic prints ForexFactory schedules, the presidential-schedule feed,
and the day's earnings woven in between them rather than listed underneath. Every
row is a 62px time gutter and a body, with a 3px left border in the event's impact
colour. It is deliberately **today only** — it was a rolling seven days with a
dimmed tail and that was the wrong answer to the only question a card this size
gets asked — and an event **more than an hour past its start is removed**, not
dimmed, because the print lands inside that hour and after it the row is occupying
a card that is about what is left. A filter menu in the card header picks which
impact tiers and countries show, and the selection survives reloads in
`localStorage`. Behind it all sits a second, invisible feature: the card publishes
a CopyShot target that composes v2's 1280×672 Discord poster out of the same two
feeds and photographs *that*, a picture that never appears on screen.

---

## File map

| File | Lines | What it owns |
|---|---:|---|
| `src/board/econCalendar/EconCalendarCard.tsx` | 536 | The card. Its own `CalEvent`/`EarnRow` interfaces, the impact→CSS-variable map, the ten filter options, the localStorage filter store, the ET date/minute helpers, `DROP_AFTER_MIN`, `isStale`, `EventRow`, `EarningsBlock`, the day-header + earnings-weaving pass, the 60s visibility-gated clock, and the poster CopyShot registration. |
| `src/board/econCalendar/econTemplate.ts` | 696 | The poster. Canvas geometry, lane widths, the density curves, the headline-priority table, the impact badge ramp, the earnings chip solver, the escaped HTML/CSS builder, art inlining, off-screen mount and capture, and `fetchQuote()`. |
| `src/data/econCalendar.ts` | 532 | The shared feed module: `CalEvent` / `EarnRow` / `EarnBucket` types, the impact colour ramp, ET helpers (`etToday`, `etWeekDays`, `etMonFri`, `etNowParts`), the **30-minute** `isStale`, three day-label formatters, `FilterKey` + `FILTER_OPTS` + `passes`, the anticipated-earnings machinery (`MEGA_CAP`, `ANTICIPATED_PER_DAY`, `ANTICIPATED_SYMBOLS`, `isAnticipated`, `pickAnticipated`), `groupEarningsByDate`, and the `useEconCalendar` hook. |
| `src/board/catalog.tsx` | 456 | Registration only: the `lazy()` import, the catalog entry, the `<Deferred>` Suspense wrapper. |
| `src/mobile/pages/MEcon.tsx` | 26 | The `/m/econ` screen. Mounts this card inside `MobileShell` with `fill`. |
| `src/data/api.ts` | 239 | `useQuery` / `query` / `preload` — the dedupe + stale-window cache the card's two reads go through. |

---

## The data path

### The two reads

Both fire on mount, in parallel, through `useQuery` from `@/data/api`:

```
useQuery<CalendarResponse>('/api/calendar',        { staleMs: 600_000 })
useQuery<EarningsResponse>('/proxy/earnings-week', { staleMs: 600_000 })
```

| | `/api/calendar` | `/proxy/earnings-week` |
|---|---|---|
| Query params | none | **none, as the card calls it** |
| `staleMs` | 600_000 (10 min) | 600_000 (10 min) |
| `pollMs` | not set | not set |
| Credentials | `same-origin` (set by `query()`) | `same-origin` |
| Response the card declares | `{ events?: CalEvent[]; source?: string }` | `{ ok?: boolean; rows?: EarnRow[] }` |
| Fields the card actually reads | `events` | `rows` |

The card's own header states the intent plainly:

> Two fetches, once, on mount:
>   `/api/calendar`        `{ events, source }`   ForexFactory + the President feed
>   `/proxy/earnings-week` `{ ok, rows }`         this week, ≥ the recorder's mcap floor
>
> Neither is polled. A 60-second tick expires released rows off the card without
> touching the network, which is the only thing that actually changes minute to
> minute; the underlying calendar is a weekly file.

### `staleMs` is a TTL, not a refresh interval

This matters more here than almost anywhere else in the app, because there is no
poll at all. From `src/data/api.ts`:

> It is a cache TTL: it says how long a cached value may be served WITHOUT a
> refetch, and nothing about when a refetch happens. A card that mounts once
> and never remounts will sit on its first response forever no matter how small
> `staleMs` is. That distinction cost real confusion — a chart with
> `staleMs 25_000` looked like it was refreshing every 25 seconds and was in fact
> frozen at the value it loaded with.

So: **this card loads twice-ever data.** It refetches when it remounts after ten
minutes (dragged off and back on the board, a route change and return, the phone
screen re-entered), or when someone presses the toolbar's refresh, which calls
`refreshAll()` → clears the cache → broadcasts to every mounted `useQuery`. Nothing
else brings new rows in. The minute clock moves rows out; it never brings them in.

### The raw-fetch path, and why the rail has no prefetch

The **shared hook** `useEconCalendar` in `src/data/econCalendar.ts` does *not* go
through `data/api.ts`. It fires three raw fetches in parallel:

```
fetch('/api/calendar',                    { cache: 'no-store' })
fetch('/api/calendar-quote',              { cache: 'no-store' })   // when withQuote
fetch(`/proxy/earnings-week?week=${week}`,{ cache: 'no-store' })
```

`cache: 'no-store'` bypasses the HTTP cache *and* sidesteps the api.ts entry
entirely, so nothing that hook fetches is ever visible to `peek()`, `query()`'s
dedupe, or `refreshAll()`. That is why `/economic-calendar` carries **no prefetch**
in the rail. `src/shell/Shell.tsx`:

> No prefetch: the page's three feeds go out through a raw `fetch(…, { cache:
> 'no-store' })` in `data/econCalendar.ts`, not through `api.ts`, so a warmed api
> cache would never be read back — an unused request on every hover. Give it one
> the day that hook moves onto api.ts.

Two things follow. First, hovering "Econ Cal" in the rail warms nothing, by design.
Second — see Gotchas — the page has since moved to `useQuery` and that rail comment
is now describing a state of affairs that no longer holds for the page, though it
still holds for `useEconCalendar`'s other consumers (`src/pages/Premarket.tsx`,
`src/pages/analysis/cards/EconCalendar.tsx`).

### Failure semantics

`src/data/econCalendar.ts` spells out the trap:

> `/api/calendar` answers HTTP 200 with an empty events array when the upstream is
> down, so `res.ok` tells you nothing. The real signal is `source` ("forexfactory" |
> "cache" | "saved" | "unavailable") and `warning`.

**The board card reads neither.** `CalendarResponse` declares `source?: string` and
never touches it; `warning` is not even in the interface. The card also never reads
`cal.error` or `earn.error`. So:

| Failure | How it presents on the card |
|---|---|
| `/api/calendar` 200 with `events: []` (upstream down) | "Nothing left today." |
| `/api/calendar` non-2xx | `query()` throws `"<status> <statusText> — /api/calendar"`, `useQuery` stores it in `error`, the card ignores it → "Nothing left today." |
| Network failure / abort | same as above → "Nothing left today." |
| Malformed JSON | `query()` rejects on `res.json()` → same |
| `/proxy/earnings-week` fails | `earn.data` is `undefined`, `earn.data?.rows ?? []` is empty, the day simply carries no earnings blocks. No message. |
| `source: "unavailable"` | Indistinguishable from a quiet day. |

There is no error state, no warning banner and no "feed is stale" line anywhere on
the card. The full-page surface at `/economic-calendar` is where `source` and
`warning` are surfaced, and even there they are owner-only.

---

## Event taxonomy

### The `CalEvent` shape

From `src/data/econCalendar.ts` (the card re-declares an identical local copy):

| Field | Form | Role |
|---|---|---|
| `date` | `YYYY-MM-DD`, ET | Day bucket and sort key |
| `time` | `HH:MM` 24h, ET | **The sort/compare key.** Also what the 16:00 earnings split compares against. |
| `time_formatted` | `h:MM AM/PM`, ET | **The display key.** |
| `title` | string | Event name as the provider titles it |
| `country` | string | `"USD"` and the rest |
| `impact` | string | `High` \| `Medium` \| `Low` \| `Holiday` \| `President` |
| `forecast` / `previous` / `actual` | string | Printed as `F:` / `P:` / `A:` when non-empty |

### Impact tiers, and the colour each maps to

The card maps impact to a **CSS custom property name**, never a value:

```ts
const IMPACT_VAR: Record<string, string> = {
  High:      '--color-impact-high',
  Medium:    '--color-impact-medium',
  Low:       '--color-impact-low',
  Holiday:   '--color-impact-holiday',
  President: '--color-impact-president',
}
const FADED_VAR = '--color-impact-faded'
const EARN_VAR  = '--color-cal-accent'
function impactVar(impact: string) { return IMPACT_VAR[impact] ?? '--color-impact-low' }
```

> Mapped to token names, never to values — the card reads the resolved colour
> through a CSS variable so `tokens.css` stays the only place a hex lives.

An unrecognised impact string falls through to `--color-impact-low`. There is no
normalisation: the lookup is **exact and case-sensitive**, so a provider that ever
sent `"HIGH"` would render in Low blue. (The poster's `impactBadge` does the
opposite and matches on a lowercased leading word, precisely because "A High print
rendering in Medium amber is the one mistake on this poster that actively
misleads." The card carries no such guard.)

### Classification: the filter predicate

The card ships **its own** `passes()`, and it is not the one in the shared module:

```ts
function passes(ev: CalEvent, active: Set<string>): boolean {
  if (active.has('all')) return true
  const usd = ev.country === 'USD'
  if (ev.impact === 'President') return active.has('trump')
  if (active.has('all-usd') && usd) return true
  const i = ev.impact.toLowerCase()
  if (active.has(i)) return true
  if (usd && active.has(`${i}-usd`)) return true
  return false
}
```

Read it carefully, because three behaviours fall out of it:

1. **President is an early return.** A presidential item passes *only* when `trump`
   is ticked, and fails every other filter including `all-usd` — no matter what
   `country` it carries. The shared module's `passes()` does not do this: there,
   `trump` is checked and the function *continues*, so a `President` row with
   `country === 'USD'` also passes `all-usd`.
2. **The tier match is derived from the string.** `ev.impact.toLowerCase()` is
   looked up directly in the active set, so the filter keys `high`/`medium`/`low`
   work without a table. It also means an impact of `Holiday` computes the key
   `holiday`, which no filter option offers — a Holiday row is therefore reachable
   only via `all`, or via `all-usd` if its country is `USD`.
3. **`-usd` is composed, not enumerated.** `` `${i}-usd` `` builds `high-usd`,
   `medium-usd`, `low-usd` from the same lowercased string.

### The ten filter options

`FILTER_OPTS` in the card, each carrying the token name its checkbox is painted in:

| `value` | Label (card) | Label (shared module) | Swatch token |
|---|---|---|---|
| `all-usd` | `All · USD` | `All·USD` | `--color-cal-accent` |
| `high-usd` | `High · USD` | `High·USD` | `--color-impact-high` |
| `high` | `High` | `High` | `--color-impact-high` |
| `medium-usd` | `Medium · USD` | `Medium·USD` | `--color-impact-medium` |
| `medium` | `Medium` | `Medium` | `--color-impact-medium` |
| `low-usd` | `Low · USD` | `Low·USD` | `--color-impact-low` |
| `low` | `Low` | `Low` | `--color-impact-low` |
| `trump` | `TRUMP` | `TRUMP` | `--color-impact-president` |
| `earnings` | `Earnings` | `Earnings` | `--color-cal-accent` |
| `all` | `All` | `All` | `--color-fg` |

The card spells the labels with spaces around the middle dot; the shared list does
not. Same ten keys, same order, two spellings.

### Earnings: the `EarnRow` shape and the weave

| Field | Form |
|---|---|
| `date` | `YYYY-MM-DD`, ET |
| `symbol` | ticker |
| `company` | display name, used in the hover title |
| `session` | `'pre' \| 'after' \| 'unknown'` — **widened to `\| string` in the card's local copy**, "because the feed has been known to invent one" |
| `market_cap` | number |
| `eps_est` | `string \| null` |

Three session blocks, named constants rather than an indexed array — *"Under
`noUncheckedIndexedAccess` an index read is `T | undefined` … Three constants have
no index to check."*

```ts
const EARN_PRE   = { head: 'PRE',   sub: 'MKT', title: 'Premarket earnings' }
const EARN_AFTER = { head: 'AFTER', sub: 'HRS', title: 'After-hours earnings' }
const EARN_TBD   = { head: 'TIME',  sub: 'TBD', title: 'Time unconfirmed' }
```

Bucketing is done inline against the widened session type:

```ts
const bySession = (s: EarnRow['session']) =>
  dayEarn.filter((r) => (s === 'unknown' ? r.session !== 'pre' && r.session !== 'after' : r.session === s))
```

— i.e. `unknown` is "anything that is not the two known values", which is what makes
the widened `string` type safe here.

**Insertion order inside a day:**

1. Day header (sticky).
2. `PRE MKT` block, if any rows — immediately after the header, before every event.
3. Walking the day's events in time order: the first event whose `ev.time > '16:00'`
   gets the `AFTER HRS` block inserted **before** it.
4. If no event is past 16:00, the `AFTER HRS` block goes at the **end** of the day.
5. `TIME TBD` block always **last**.

The `afterPlaced` flag starts as `after.length === 0`, so a day with no after-hours
names never triggers either branch.

### Why the TBD bucket exists at all

From `src/data/econCalendar.ts`:

> `tbd` did not used to exist: any row whose session was neither "pre" nor "after"
> was DROPPED here and never rendered on any surface. That is not a rare edge —
> Nasdaq marks the large majority of its calendar "time-not-supplied" (on a typical
> day ~380 of ~490 rows), and that includes real large caps.
>
> The bucket is kept SEPARATE rather than folded into pre/after on purpose: guessing
> a session would put names on the wrong side of the close, which is worse than
> saying the time is unconfirmed. The recorder's daily 06:30 ET re-sweep is what
> drains this bucket as Nasdaq confirms times through the week.

### The anticipated-names machinery — which the card does **not** use

`src/data/econCalendar.ts` carries the narrowing rule the rest of the app shares:

- `MEGA_CAP = 25e9` — "anything at or above $25B is anticipated by definition. This
  is the old server floor, kept as a display rule where it belongs."
- `ANTICIPATED_PER_DAY = 14` — "roughly a full board column."
- `ANTICIPATED_SYMBOLS` — a maintained set of ~700 tickers across eleven commented
  sections (semis, software/SaaS, internet/media, EV/auto, crypto/fintech, retail,
  restaurants/travel, staples, health/biotech, industrials/defense, energy,
  financials). The rationale: "CRDO, GTLB, PATH, CIEN, FIVE, OLLI, DLTH, DAKT, KNOP
  are all 'most anticipated' board regulars and all far under $25B. Size is not
  interest."
- `isAnticipated(r)` — `market_cap >= MEGA_CAP || ANTICIPATED_SYMBOLS.has(symbol)`.
- `pickAnticipated(rows, perDay = 14)` — keeps every anticipated row, then **tops
  each day up** with the largest remaining caps to `perDay`, market cap descending.
  `perDay <= 0` returns everything.

The board card imports **none** of this. It takes `earn.data?.rows ?? []`, filters
to today's date, and renders every one. See Gotchas.

---

## Time handling

Everything is Eastern, derived through `Intl`, never from the device clock. The
shared module states the reason:

> A trader in London must see the same "TODAY" and the same 30-minute staleness
> cutoff as one in New York, so every date and clock value round-trips through Intl
> with `timeZone: America/New_York` rather than reading the device's local time.

### The card's two formatters

```ts
const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
})
const ET_HM = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
})
```

`en-CA` formats as `YYYY-MM-DD`, which string-compares correctly against the feed's
`date`. `etMinutes()` reads `formatToParts()` rather than splitting a string and
applies `Number(p.value) % 24` to the hour — which keeps midnight correct where an
`hour12:false` formatter renders `24`.

### The day window

```ts
function etWeekDays(now: number): string[] { return [etDate(now)] }
```

One entry. The name is a fossil and the comment explains why it kept the shape:

> **TODAY ONLY, ET.** Was today → today+6. A seven-day window on a board card is a
> week's worth of scrolling to answer "what is left today", which is the only
> question a card this size is being asked. The weekly view still exists on the full
> page.
>
> Kept as a function returning a list so the day-header and earnings-weaving code
> below is unchanged — it groups by date either way, and a one-day list is the
> degenerate case of a seven-day one.

### The "more than an hour past" rule

```ts
const DROP_AFTER_MIN = 60

function isStale(ev: CalEvent, now: number): boolean {
  const today = etDate(now)
  if (ev.date < today) return true
  if (ev.date > today) return false
  return minutesOf(ev.time) + DROP_AFTER_MIN < etMinutes(now)
}
```

> An hour, and then the row is REMOVED rather than dimmed. Thirty minutes and a
> dimmed tail was the old behaviour: the print is what matters and it lands within
> the hour, after which the row is just occupying a card that is now about today
> alone.

Note the strictness: `start + 60 < now`, so an event is dropped when it is *more*
than sixty minutes past. At exactly sixty it is still on the card.

`minutesOf` guards a malformed `time` with `Number.isFinite` on both halves and falls
back to `0`, so a blank-time row is treated as **midnight** and drops after 01:00 ET.

**This is not the shared `isStale`.** `src/data/econCalendar.ts` exports one with a
30-minute window (`nowMin - evMin > 30`) and it is what `/economic-calendar`, the
Premarket page and the Analysis card all use — and there a stale event is *dimmed
and kept*, not removed. Two rules, two windows, deliberately different surfaces.

### Day boundaries, weekends, holidays

- The ET date rolls at ET midnight. Because `now` only ticks once a minute (and not
  at all in a hidden tab), a card left open across midnight shows yesterday for up
  to a minute after the roll, then re-derives `today` and empties.
- The only day in `daySet` is today, so earnings for tomorrow are filtered out at
  `earnByDate` construction. The backfill loop `if (!byDate.has(d) && d >= today)` is
  therefore always a no-op-or-today.
- **Weekends and holidays are not special-cased anywhere in the card.** A Saturday
  renders whatever the feeds carry for that ET date, which is normally nothing, and
  shows "Nothing left today." A market holiday with a `Holiday` impact row renders
  as an ordinary event in `--color-impact-holiday` — and, per the filter predicate
  above, only when `all` is ticked or it is a USD row under `all-usd`.
- `fullDayLabel(date, today)` builds its non-today label from `new Date(
  \`${date}T12:00:00Z\`)` — **noon UTC**, with the comment: *"so the date cannot slide
  a day either way when re-read in ET."* On the card this branch is unreachable
  (the only date is today), but it is the correct form and the shared module's own
  `fullDayLabel` uses bare `T12:00:00` local instead.

---

## Controls

There are exactly two pieces of interactive chrome, both in the card header via
`CardToolbar` (a portal into the `Card`'s header — the card body renders it wherever
it likes and it lands in the header when the body mounts).

> One toolbar per card: the window caption and the filter go in the Card's header,
> not in a second bar underneath it.

### 1. The caption

`Today · ET` — static text, `text-2xs uppercase tracking-[0.1em] text-muted opacity-60`.
Not a control; it is the card telling you its scope.

### 2. The filter button and menu

| | |
|---|---|
| Trigger label | `Filter (N)` where N is `filters.length` |
| Menu | `Popover` from `../gexCandles/controls` (re-exported from `@/design/primitives/Controls`) |
| Menu width | `w-40` (160px) |
| Behaviour | **Multi-select; the menu stays open.** Clicking a row toggles that key and nothing closes. |
| Row | a 12×12 checkbox (`h-3 w-3`, `rounded-[2px]`) with a 2px border in the option's token colour, filled with that colour and a `✓` in `--color-bg` when on |
| Label state | on → `font-semibold text-fg`; off → `text-muted opacity-50` |
| Closing | click-outside (pointerdown) or `Escape`, both handled by `Popover` |

**Where the state lives:** `localStorage`, under the key **`cb-v3-econ-filters`**, as
a JSON array of strings. There is no query string on this surface and no server
persistence.

```ts
const DEFAULT_FILTERS = ['all-usd', 'trump', 'earnings']
const FILTER_KEY = 'cb-v3-econ-filters'

function loadFilters(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null')
    return Array.isArray(parsed) && parsed.length ? parsed.map(String) : DEFAULT_FILTERS
  } catch { return DEFAULT_FILTERS }
}
```

- **Default:** `['all-usd', 'trump', 'earnings']` — every USD event, every
  presidential item, and earnings. The same triple the Analysis page's econ card
  hardcodes as `FILTERS`, where it is *"v2's default set, with no way to change it
  here."*
- **Read:** once, lazily, in the `useState` initialiser.
- **Write:** inside the `setFilters` updater, wrapped in `try/catch` marked
  `/* best-effort */` — a private window or blocked storage loses persistence and
  changes nothing else.
- Both read and write are non-throwing by construction; a corrupt value parses to
  something non-array and falls back to the defaults.

### The `earnings` key is a gate, not a filter

```ts
const showEarnings = active.has('all') || active.has('earnings')
```

It is read in two places: whether earnings blocks are emitted at all, and whether a
day with earnings but no passing econ event still gets a header —

> A day with earnings but no passing econ event still deserves a header — otherwise
> the earnings silently vanish on a quiet macro day.

### There is no refresh control on the card

Refresh is the board toolbar's global `refreshAll()`. There is no per-card refresh,
no week toggle, no market-cap floor, no search — all of those live on
`/economic-calendar`.

---

## Rendering

### DOM structure

```
<div class="flex min-h-0 flex-1 flex-col">
  ├─ <CardToolbar>                       → portalled into the Card header
  │    ├─ <span>Today · ET</span>
  │    └─ <div class="relative">
  │         ├─ <button>Filter (N)</button>
  │         └─ <Popover>  → portalled to <body>, 10 × <button> rows
  └─ <div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-line">
       ├─ [Loading…]          when cal.loading && !cal.data
       ├─ [Nothing left today.] when nothing
       ├─ withSeparators(ahead, false)
       │    ├─ day header  (sticky top-0 z-10)
       │    ├─ EarningsBlock  PRE MKT      (optional)
       │    ├─ EventRow …                   ← AFTER HRS spliced in before the first > 16:00
       │    ├─ EarningsBlock  AFTER HRS    (optional, at the end if no event past 16:00)
       │    └─ EarningsBlock  TIME TBD     (optional, always last)
       ├─ [<div class="border-t border-line" />]   ← only when past.length > 0, i.e. never
       └─ withSeparators(past, true)               ← always empty
```

The scroll container carries `overflow-y-auto` and its own border, which is what lets
the phone screen mount the card `fill` and get one scrollbar instead of two.

### `EventRow`

| Property | Value |
|---|---|
| Grid | `gridTemplateColumns: '62px 1fr'` |
| Minimum height | `min-h-[44px]` |
| Top border | `border-t border-line` |
| Left border | `3px solid var(<impact token>)`, or `var(--color-impact-faded)` when faded |
| Opacity | `faded ? 0.32 : 1`, with `transition: 'opacity 400ms'` |
| Time cell | `tabular … border-r border-line px-1 font-mono text-sm text-fg`, centred |
| Time text | `ev.time_formatted \|\| ev.time \|\| 'TBD'` |
| Impact chip | `text-2xs font-extrabold uppercase tracking-[0.1em]`, coloured `col` |
| Country | `text-xs font-semibold text-fg opacity-80` |
| Title | `text-sm leading-tight text-fg`, plus `font-bold` when `impact === 'High'` |
| Values row | rendered only when `actual \|\| forecast \|\| previous`; `tabular flex flex-wrap gap-2.5 font-mono text-xs` |
| `A:` | `var(--color-cal-actual)`, value wrapped in `<strong>` |
| `F:` | `var(--color-cal-forecast)` |
| `P:` | `var(--color-cal-previous)` |

### `EarningsBlock`

| Property | Value |
|---|---|
| Grid | `gridTemplateColumns: '62px 1fr'`, `min-h-[44px]`, `border-t border-line` |
| Left border | `3px solid var(--color-cal-accent)` |
| `title` attribute | `kind.title` — "Premarket earnings" / "After-hours earnings" / "Time unconfirmed" |
| Gutter | two stacked `font-mono text-2xs font-bold leading-tight` lines: `PRE`/`MKT`, `AFTER`/`HRS`, `TIME`/`TBD`, in the accent |
| Body | `flex flex-wrap items-center gap-2 px-2 py-1.5` |
| Chip | `<a>` to `https://finance.yahoo.com/quote/<encodeURIComponent(symbol)>`, `target="_blank" rel="noreferrer"` |
| Chip style | `rounded-sm border border-line bg-surface2 px-1.5 py-0.5 font-mono text-2xs font-bold text-fg hover:bg-raised` |
| Chip hover title | `` `${company}${mcap ? ` · ${mcap}` : ''}${eps_est ? ` · est ${eps_est}` : ''}` `` |
| React key | `` `${r.date}-${r.symbol}` `` |

These are **text chips, not logos** — the board card has no `ChipLogo`. Logos appear
on the `/economic-calendar` page and on the poster.

The card's own `fmtMcap` is not the shared one:

```ts
function fmtMcap(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return ''
  return v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : `$${Math.round(v / 1e9)}B`
}
```

It has **no millions branch** (the shared `fmtMcap` has `$…M` and returns `"n/a"` for
zero), so a sub-billion name renders `$0B` in its hover title.

### The day header

```
sticky top-0 z-10 flex items-center gap-1.5 border-t border-line px-2.5 py-1
background: date === today ? var(--color-surface2) : var(--color-surface)
```

Inside: a `text-xs font-extrabold tracking-[0.1em]` label in
`var(--color-cal-accent)` when it is today and `var(--color-impact-low)` otherwise,
followed — when it is today — by a solid pill:
`rounded-sm px-1 py-px text-2xs font-black tracking-[0.1em]`,
`background: var(--color-cal-accent)`, `color: var(--color-bg)`.

### Colour tokens, with the values from `src/design/tokens.css`

| Token | Value | Where the card uses it |
|---|---|---|
| `--color-impact-high` | `#ff6b7a` | High rows: left border, impact chip; filter swatch |
| `--color-impact-medium` | `#ffd166` | Medium rows; filter swatch |
| `--color-impact-low` | `color-mix(in srgb, #2f6bff 45%, #0a0d10)` | Low rows; the fallback for an unknown impact; non-today header label |
| `--color-impact-holiday` | `#c0c5c3` | Holiday rows |
| `--color-impact-president` | `#b48cff` | Presidential rows; the TRUMP swatch |
| `--color-impact-faded` | `color-mix(in srgb, #1e2630 70%, #0a0d10)` | The faded pass (dead on this card) |
| `--color-cal-accent` | `#6aa0ff` | Earnings blocks' left border and gutter, today's header label, the TODAY pill, the `All·USD` and `Earnings` swatches |
| `--color-cal-actual` | `#3ddc8e` | `A:` |
| `--color-cal-forecast` | `#ffd166` | `F:` |
| `--color-cal-previous` | `#c0c5c3` | `P:` |
| `--color-fg` | `#e7ece9` | Body text (`text-fg`), the `All` filter swatch |
| `--color-muted` | `#e7ece9` | The caption and the filter button (`text-muted`) — same white today, separate token |
| `--color-bg` | `#0a0d10` | Ink on the solid TODAY pill and on a ticked checkbox |
| `--color-surface` | `#0e1216` | A non-today day header's plate |
| `--color-surface2` | `#141a21` | Today's day-header plate; `bg-surface2` on a ticker chip |
| `--color-raised` | `color-mix(in srgb, #141a21 92%, #e7ece9)` | Chip and button hover (`hover:bg-raised`) |
| `--color-line` | `#1e2630` | Every hairline: `border-t`, `border-r`, the chip and button borders, the scroll container |

Type sizes come off the scale in `tokens.css`: `text-3xs` 9px (the checkbox tick),
`text-2xs` 10px (impact chip, ticker chip, gutter, TODAY pill), `text-xs` 11px
(country, day label, menu rows), `text-sm` 13px (time, title).

### Layout constants, in one place

| Constant | Value | Meaning |
|---|---|---|
| Time gutter | `62px` | First grid track on both row kinds |
| Row minimum height | `44px` | `min-h-[44px]` on `EventRow` and `EarningsBlock` |
| Impact bar | `3px` | `borderLeft` width |
| Faded opacity | `0.32` | with a 400ms transition |
| `DROP_AFTER_MIN` | `60` | minutes past start before removal |
| Clock interval | `60_000` ms | |
| `staleMs` | `600_000` ms | both reads |
| Filter menu width | `w-40` = 160px | |
| After-hours split | `'16:00'` | string compare against `ev.time` |
| Default card size | `w: 24, h: 48` | 24/48 columns wide, 384px tall |

---

## The poster (`econTemplate.ts`)

The card publishes a **second** CopyShot target beside the plain card screenshot the
board already offers:

```ts
{
  id: 'econ-poster',
  icon: '🖼️',
  label: 'Economic Calendar — poster',
  group: 'Home board',
  file: 'econ-calendar',
  capture: async () => { … },
}
```

Registered through `useCopyShotTargets(posterTargets)`; returns `NO_TARGETS` (the
shared empty array, so "nothing right now" is a constant rather than a new `[]` every
render) while `loading` is true.

> A SECOND camera row for this card, beside the plain shot of the card that BoardPage
> publishes. This one does not photograph anything on screen: it composes v2's
> 1280×720 Discord card — three lanes, the quote of the day, the CB Edge mark — from
> the same two feeds this card is already holding, and photographs that.

`./econTemplate` is behind a **dynamic import inside `capture`**, so its ~700 lines
never enter the card's chunk: *"it is a poster nobody but the owner will ever build,
and it has no business in the chunk that draws the card."*

### What the capture hands the template

```ts
const mod = await import('./econTemplate')
const quote = await mod.fetchQuote()          // best-effort
const today = etToday()
const earnings = (earn.data?.rows ?? [])
  .filter((r) => r.date === today)
  .sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0))
  .map<PosterEarnRow>((r) => ({
    ...r,
    session: r.session === 'pre' || r.session === 'after' ? r.session : 'unknown',
  }))
return mod.captureEconPoster({ events: (cal.data?.events ?? []) as PosterEvent[], earnings, quote })
```

> v2's shaping, kept: the week's feed narrowed to today, biggest name first, because
> the lane holds twelve per session and the twelve that matter are the twelve people
> have heard of.

and on the session narrowing:

> The card's own row type widens `session` to string because the feed has been known
> to invent one. The poster's three groups are closed, so anything else lands in
> Time TBD.

Note the events are handed over **unfiltered** — the whole `cal.data.events` array,
not the card's `ahead` list. The template does its own filtering.

### Canvas and lanes

| Constant | Value | Note |
|---|---|---|
| `CANVAS_W` | `1280` | |
| `CANVAS_H` | `672` | v2's `.snapshot`, not v2's `<body>` (which was 720 with 24px padding). "Here the poster IS the captured element, so the padding would be 48px of lane width quietly removed from the arithmetic below. There is no wrapper." |
| `LANE_PRES` | `1.75` fr | Presidential Schedule |
| `LANE_ECON` | `3.15` fr | Economic Calendar |
| `LANE_ERN` | `1.4` fr | Earnings |
| `GRID_W` | `1280 − 2 − 60 − 36` | canvas − border − poster padding − grid gaps |
| `laneW(fr)` | `round(GRID_W × fr / LANE_TOTAL)` | |

> Change them HERE and nowhere else: the `.grid` rule and the truncation maths (which
> needs each panel's pixel width) both read them through `laneW()`. v2 had them
> hardcoded in the CSS plus two open-coded fractions further down, which is exactly
> the setup where a lane gets widened and the titles keep truncating to the old width.

### The five fixed chrome sizes

`BADGE_SIZE 24`, `DATE_PILL_SIZE 17`, `QUOTE_SIZE 30`, `PANEL_HEAD_SIZE 14`,
`EMPTY_PANEL_SIZE 14` — and the file argues at length for why these are raw pixels
on a surface where the repo otherwise bans them:

> This is a 1280×672 composition, not a UI: nothing here reflows, the height is
> locked ("anything that overflows shrinks, it never grows"), and the asset has been
> going into the same Discord channel for months. `--text-*` is a rem ladder, so a
> viewer with a non-16px root would rescale the badge and nothing else on a canvas
> where every other number is absolute — and the two nearest scale steps (17→18,
> 30→32) would push the quote's `max-width:1120px` block toward a second line on a
> long quote, on a poster that cannot grow.
>
> Change one and you change a published brand asset. Re-run `board/econCalendar`
> through a real capture before you do.

### Selection and ranking

- `includeEvent(ev)` → `impact === 'President' || (country === 'USD' && impact !== 'Holiday')`.
  *"Match the board card's default all-USD scope. Quiet days … used to render an
  empty panel even though the card was showing the events."*
- `HEADLINE_PRIORITY` — twenty regexes, rank 1 first, tested against
  `` `${title} ${country} ${impact}`.toLowerCase() ``. Unmatched sorts to
  `Number.MAX_SAFE_INTEGER`. Sort is `priorityOf(a) - priorityOf(b) || a.time.localeCompare(b.time)`.
  The first entry carries a bug fix that is called out explicitly:

  > "non-farm" and "employment change" are here and are NOT in v2's copy of this
  > table. ForexFactory titles the print "Non-Farm Employment Change", and v2 only
  > ever matched "nonfarm payrolls", so THE payroll number fell to unranked and
  > sorted below Crude Oil Inventories on jobs Friday. Faithful to v2 everywhere
  > else; this one is a bug, not a decision.

- Lane slices: econ takes the first **8** non-President rows, presidential takes the
  first **6** President rows re-sorted by time, earnings take **12 per session**.
- `stripPresidentSubject()` drops the leading "The President …" / "President Trump …"
  — but deliberately **not** when the subject is compound: the regex carries a
  `(?!and\b)` lookahead, *"that would leave a dangling 'and …'."*

### Density and fit

- `densityScale(n) = clamp(1 + (6 − n) × 0.07, 0.85, 1.25)` — six rows is neutral.
- `presDensityScale(n)` is a hand-written ladder: `≤1 → 1.8`, `2 → 1.5`, `3 → 1.3`,
  `4 → 1.15`, else `1`. *"a one-event day should be BIG."*
- `earnLayout(groupSizes, availW, bodyH)` walks `perRow` from 2 to 6 and takes the
  first layout whose rows fit `bodyH`; fewer per row means bigger chips. `gap 12`,
  per-group `overhead 52`, `logo = min(58, round(chipW × 0.78))`,
  `sym = clamp(round(logo × 0.33), 10, 18)`. Nothing fits → the tightest candidate.
- `ERN_BODY_H = 413` and `PRES_BODY_H = 400` are measured off a real render, and the
  `−2` in `laneW(LANE_ERN) - 2 - 32` is the panel's 1px border on each side:
  *"the difference between three chips fitting a row and wrapping to two with a dead
  gutter."*

### Capture mechanics

- All text goes through `esc()` — *"Text is data. It goes into an HTML string, so it
  gets escaped."* JS truncation (`clip`) is kept even though `<foreignObject>` would
  not need it: *"the measurements are tuned, the result is deterministic, and matching
  v2's line breaks is the point of the exercise."* `PILL_NUDGE_EM` did **not** come
  across — html2canvas's baseline bug is not v3's renderer's bug, and carrying the
  nudge would push every pill's text visibly low.
- The poster mounts **off-screen in the live document**, `position:fixed; left:-99999px`,
  never `display:none` (*"a hidden element has no layout and there would be nothing
  to measure"*), never an iframe. Every rule is scoped under `.cbx-econ-poster`,
  which also puts it at specificity (0,1,0), above Tailwind's preflight at (0,0,0) —
  otherwise preflight's `border:0 solid currentColor` fights the poster's own reset.
- Two `requestAnimationFrame`s then `document.fonts.ready` before the shot: *"text
  measured against a fallback face and re-laid out a tick later would photograph
  mid-swap."*
- `bare: true` and `filename: 'econ-calendar.png'` — the poster carries its own title
  bar, date and mark, so the caption band would say all of it a second time.
- `loadArt()` inlines `/cb-edge-square.png` and one `/proxy/ticker-logo?sym=…&name=…`
  per earnings symbol as data URIs, because *"The capture engine drops any image it
  cannot re-encode … and it drops it SILENTLY."*
- `finally { host.remove(); style.remove() }` — the mount is always cleaned up, even
  on a throw.

### Poster copy, verbatim

| Slot | Text |
|---|---|
| Title badge | `Economic Calendar` |
| Date pills | the ET long date (`weekday, month, day, year`, `en-US`, `America/New_York`) and `Today` |
| Panel titles | `Presidential Schedule`, `Economic Calendar`, `Earnings` |
| Econ table head | `Time` / `Event` / `Impact` |
| Earnings group labels | `Premarket`, `After hours`, `Time TBD` |
| Empty presidential lane | `No political events today` |
| Empty econ lane | `No economic events today` |
| Empty earnings lane | `No earnings today` |

---

## Phone behaviour — `/m/econ`

`src/mobile/pages/MEcon.tsx`, 26 lines, is the whole screen:

```tsx
const EconCalendarCard = lazy(() =>
  import('@/board/econCalendar/EconCalendarCard').then((m) => ({ default: m.EconCalendarCard })),
)

export default function MEcon() {
  return (
    <MobileShell title="Calendar & Earnings" fill>
      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <EconCalendarCard />
      </Suspense>
    </MobileShell>
  )
}
```

> It IS the home board's `econ-calendar` card. `fill` because the card scrolls INSIDE
> itself — it is built to sit in a board slot of a fixed height and keep its own
> filter row pinned — so an outer scroll would give the screen two scrollbars and
> detach that row from the rows it filters.
>
> No ticker control: the calendar is not a per-symbol surface, and a picker that
> changed nothing on screen would be a control that lies.

Registration:

- Tab entry in `src/mobile/mobileNav.ts`:
  `{ id: 'econ', path: '/m/econ', label: 'Cal', title: 'Economic Calendar', icon: '📅' }`
  — the `MobileShell` title above (`Calendar & Earnings`) is the screen's own.
- Route in `src/App.tsx`: `<Route path="/m/econ" element={<MEcon />} />`. A hard
  refresh on `/v3/m/econ` is answered by `app/v3/m/[tab]/route.ts` in the v2 repo.
- `DESKTOP_TO_MOBILE['/m/econ']` → `'/'` is the **reverse** map (long-press a tab to
  escape to the desktop; here that is the card gallery, not `/economic-calendar`).
- `/economic-calendar` is **not** a key in `DESKTOP_TO_MOBILE`, so a phone opening
  the full page is *not* redirected here — *"a cramped real page beats a redirect to
  an unrelated one."*

Because the phone screen mounts the card itself and not a copy, everything above —
the today-only window, the 60-minute drop, `cb-v3-econ-filters`, the filter popover
(which `Popover` can render as a bottom sheet), the poster target — applies
unchanged. The phone and the board card cannot drift, which is the stated product
decision: *"v2 shipped six bespoke phone pages under `components/mobile/` and they
drifted from the desktop inside a week — this is the same product decision made the
other way."*

---

## Status and empty-state messages

There are exactly two, both `px-2.5 py-3 text-xs text-muted opacity-60`.

| Text (verbatim) | Condition |
|---|---|
| `Loading…` | `cal.loading && !cal.data` — i.e. the econ feed has no cached value yet. Note it is gated on `/api/calendar` alone; the earnings read can still be in flight while the card renders rows. |
| `Nothing left today.` | `!loading && ahead.length === 0 && past.length === 0 && earnByDate.size === 0`. Since `past` is always empty, this reduces to "no passing, non-stale event today **and** no earnings today". |

They are sibling conditionals, not a switch, but `nothing` requires `!loading`, so in
practice they are exclusive. What is **not** here, and is on the page instead: any
feed-source banner, any `warning` text, any error text, any "no events match"
distinct from "nothing left". A filter set that excludes everything and a feed that
returned nothing produce the same line.

The `EarningsBlock` hover titles are the card's other user-facing strings:
`Premarket earnings`, `After-hours earnings`, `Time unconfirmed`.

---

## Performance notes

**Network.** Two GETs on mount, neither polled, both with a ten-minute TTL and both
deduped app-wide by URL. On a board where this card and another surface both read
`/api/calendar`, one request serves both. Steady-state network cost of the card is
**zero**.

**The clock, and the bug it fixed.** The 60-second tick is gated on tab visibility:

```ts
const fire = () => { if (document.visibilityState !== 'hidden') setNow(Date.now()) }
const id = setInterval(fire, 60_000)
const onVisible = () => { if (document.visibilityState === 'visible') setNow(Date.now()) }
document.addEventListener('visibilitychange', onVisible)
```

> A hidden tab does not need the clock: `now` only moves rows from ahead to past, and
> nobody is reading them. Left ungated it re-rendered this card — the week's calendar
> plus the earnings table — once a minute forever in a background tab. The
> visibilitychange handler snaps it current the moment the tab comes back, so nothing
> is ever stale on screen.

The interval still *runs* while hidden; it is the `setNow` that is suppressed, so
React does no work. The listener is removed on unmount alongside the interval.

**Chunking.** The card is `lazy()` in `src/board/catalog.tsx` — *"a card's code
arrives when the card does"*, with a blank fill rather than a spinner for the
Suspense fallback (*"a spinner inside a frame reads as an error"*). `econTemplate.ts`
and `@/shell/snapshot` are both behind `await import()` inside the capture callback,
so neither reaches the card chunk. `budgets.json` caps a route chunk at 59,100
brotli bytes and the entry chunk at 38,900.

**Memoisation and render volume.** `active`, `days`, `daySet`, `events` and
`earnByDate` are `useMemo`'d; `days`/`daySet` depend on `now`, so a minute tick
invalidates the chain — the deliberate cost of the drop rule. `withSeparators`
builds one flat `ReactNode[]` rather than nesting, with keys composed to survive a
tick: `` `${date}-${ev.time}-${i}-${faded ? 'p' : 'a'}` `` and `` `${r.date}-${r.symbol}` ``.

**No canvas.** The card paints no `data-cb-layer`, so `scripts/perf-check.mjs`'s
repaint budgets (`idleRepaintsPerFrame 0.15`, `offscreenRepaints 0`) do not apply.

---

## Gotchas

1. **The card's `isStale` is 60 minutes and removes; the shared one is 30 minutes and
   dims.** `EconCalendarCard.tsx` defines its own `isStale` and `DROP_AFTER_MIN = 60`;
   `src/data/econCalendar.ts` exports an `isStale` with `nowMin - evMin > 30` that the
   page, Premarket and the Analysis card use. If you "unify" them you change what the
   card is for.

2. **The card's `passes()` is not the shared `passes()`.** Presidential events are an
   early return gated solely on `trump`, so `all-usd` will not show them even when
   `country === 'USD'`. The shared version lets both paths pass. Same filter keys,
   different truth table.

3. **`Holiday` has no filter option.** The predicate derives the key from
   `impact.toLowerCase()`, which yields `holiday`, and `FILTER_OPTS` has no such
   entry. A Holiday row shows only under `all`, or under `all-usd` if it is USD.

4. **The card does no `pickAnticipated` narrowing.** It renders **every** row
   `/proxy/earnings-week` returns for today. The card's header still says the feed is
   *"this week, ≥ the recorder's mcap floor"*, but `src/data/econCalendar.ts` records
   that the floor was removed server-side: *"The recorder now stores EVERY name Nasdaq
   lists … That is ~400–500 rows a day, which no board can render, so the narrowing
   lives here instead."* On a heavy earnings day the card's chip block can be several
   hundred tickers long. Everything else that renders earnings — the page, the
   Analysis card, the Premarket page — narrows first.

5. **Two different earnings URLs, two cache entries.** The card asks
   `/proxy/earnings-week`; the page asks `/proxy/earnings-week?week=both`. `query()`
   keys on the URL string, so they never share a response. `/api/calendar` *is* shared.

6. **`source` and `warning` are fetched and thrown away.** `CalendarResponse` declares
   `source` and never reads it; `warning` is not declared at all. A feed serving
   `"unavailable"` renders identically to a quiet day. This is exactly the defect
   (Q5) the page fixed for itself — the card still has it.

7. **`cal.error` is never read.** Any HTTP or network failure produces "Nothing left
   today."

8. **The day header says TODAY twice.** `fullDayLabel(date, today)` returns the string
   `'TODAY'` for today, and the pill beside it also reads `TODAY`. Since the card's
   window is today only, the header always renders `TODAY` followed by a `TODAY` pill.
   The label function's other branch is unreachable here.

9. **`past` is permanently empty.** `const past: CalEvent[] = []` is declared and never
   filled. That keeps `withSeparators(past, true)`, the faded `EventRow` branch and the
   `past.length > 0` divider all alive as dead code — deliberately, *"so the 'nothing
   today' check and the render below read the same as before."*

10. **Deselecting every filter silently restores the defaults on next load.**
    `loadFilters()` treats an empty array as falsy (`Array.isArray(parsed) && parsed.length`),
    so `[]` in `cb-v3-econ-filters` reads back as `['all-usd','trump','earnings']`.
    In the same session, though, an empty set shows nothing at all.

11. **The card's `fmtMcap` has no millions branch.** Anything under $1B rounds to
    `$0B` in the chip's hover title. The shared `fmtMcap` in `src/data/econCalendar.ts`
    handles `M` and returns `"n/a"` for zero — the card does not import it.

12. **Impact lookup is exact and case-sensitive.** `IMPACT_VAR[impact]` with no
    normalisation; anything unexpected falls to `--color-impact-low`. The poster
    deliberately does the opposite (`key.startsWith('high')`).

13. **A blank `ev.time` sorts as midnight.** `minutesOf('')` is `0`, so such a row
    sorts first and, after 01:00 ET, is dropped as stale — even though it displays as
    `TBD`.

14. **`etWeekDays` is a one-element array with a plural name.** It is not the shared
    `etWeekDays` (which really does return seven days). Grep carefully.

15. **The card declares its own `CalEvent` / `EarnRow` interfaces** rather than
    importing them, and only pulls `etToday` plus the two type aliases from
    `@/data/econCalendar`. The local `EarnRow.session` is widened to
    `'pre' | 'after' | 'unknown' | string`, which is why the poster re-narrows it at
    the capture boundary.

16. **No prefetch, and the reason in `Shell.tsx` is now half true.** The comment says
    the page's feeds go out through a raw `no-store` fetch in `data/econCalendar.ts`.
    That is still true of `useEconCalendar` and its consumers, but
    `src/pages/EconomicCalendar.tsx` has since moved to `useQuery` — so a rail prefetch
    of `/api/calendar` *would* now be read back by the page. The rail entry still has
    none.

17. **`econTemplate`'s `loadArt` calls the logo proxy without `raw=1`.** The chip
    resolver in `src/pages/economicCalendar/ChipLogo.tsx` documents `raw=1` as
    load-bearing (it streams bytes rather than 302-ing to a third-party host, which
    would taint a capture canvas). The poster's inliner requests
    `/proxy/ticker-logo?sym=…&name=…` and converts the blob to a data URI, catching
    any failure and returning `''` — a missing logo falls back to the ticker text.

18. **The poster never reads what is on screen.** It re-filters `cal.data.events` from
    scratch through `includeEvent`, so the filter menu, the 60-minute drop and the
    poster's contents are independent. A card showing "Nothing left today." can still
    produce a full poster.

19. **The poster's target disappears while `loading`.** `posterTargets` returns
    `NO_TARGETS` until the econ feed has data, so the camera row is absent on a cold
    load — and its `useMemo` deps are `[loading, cal.data, earn.data]`, so it
    republishes whenever either feed lands.

