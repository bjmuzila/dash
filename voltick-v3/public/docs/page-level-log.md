# Level Log — `/level-log`

**Route:** `<Route path="/level-log" element={<LevelLog />} />` in `src/App.tsx`.
**Mounted by:** `const LevelLog = lazy(() => import('@/pages/LevelLog'))`. App.tsx's comment:

> `/level-log` — v2's `/app/level-log`, being ported a surface at a time against the 283-row checklist in `docs/parity/level-log.md`. What is here is the WALL MIGRATION chart (Part H) and the range switch that made v2's popout worth opening (Part I); the ticker rail, the log card, the capture rail, the churn strip and the timeline are still v2-only. The ticker and the date live in the query string, so `/v3/level-log?ticker=SPX&date=2026-09-02` is a shareable link — which is why `app/v3/level-log/route.ts` had to be added with it.

**Rail entry:** `{ to: '/level-log', label: 'Level Log', icon: '🧱' }` in `NAV` (`src/shell/Shell.tsx`):

> Landed 2026-09-03 with the wall-migration chart — the first surface of v2's `/app/level-log` to come across. **No prefetch:** the page's fetch is keyed on a ticker AND a date, and warming SPX-on-today would be wrong for anyone whose last link named something else.

**Production URL:** `voltick.cbedge.net/v3/level-log?date=YYYY-MM-DD`. A hard refresh is answered by `app/v3/level-log/route.ts` in the v2 repo (step 4 of AGENTS.md's four-step rule).

**Sources:**

| File | Lines |
|---|---|
| `src/pages/levelLog/WallMigrationChart.tsx` | 807 |
| `src/pages/levelLog/wallData.ts` | 575 |
| `src/pages/levelLog/railStore.ts` | 530 |
| `src/pages/LevelLog.tsx` | 375 |
| `src/pages/levelLog/TickerRail.tsx` | 305 |

Supporting, read but not owned: `src/data/symbol.tsx`, `src/data/auth.tsx`, `src/shell/CopyShot.tsx`, `src/shell/snapshot.ts`, `src/pages/economicCalendar/ChipLogo.tsx` (`tickerLogoUrls`), `src/design/primitives/{Page,Card,Controls,DatePicker,TickerPicker}.tsx`, `src/design/theme.ts` (471), `src/design/tokens.css` (716), `src/shell/Shell.tsx` (739), `AGENTS.md`, `budgets.json`.

---

## What it is, in one paragraph

`/level-log` answers one question: **did the level hold while price travelled?** The server's walls recorder writes a row every time a call wall, put wall or CORE level sets or rolls — at 09:29 for the open baseline and then every fifteen minutes to 16:00 — and this page draws those rows as steps against the actual tape underneath them. A level that never rolls is a flat line all day; a level that rolls at 11:15 is a step at 11:15; price is a separate line that wanders across all of it. Above the chart is a **rail of small cards**, one per watched ticker, each drawing the same chart at a third the size under its symbol, its spot and its three levels — and clicking one sets the page symbol, so the card that is lit is the log drawn underneath. Five switches drive both: the **date**, the **view** (Walls / Core / All), the **scope** (0DTE / Non-0DTE), the **basis** (OI+Vol / Vol only), and the **range** (Today / 5 sessions / Monthly / All time). On today, in the single-session view, the whole page re-reads the recorder once a minute. Everything is SVG; there is no socket, no canvas and — except for that one live tick — no poll.

---

## What has been ported, and what is still v2-only

This is the part the source headers are most insistent about, and also the part where they **disagree with each other**.

### What `LevelLog.tsx`'s header says

> FIRST SLICE OF THE PORT: the WALL MIGRATION chart and nothing else.
>
> v2's `/app/level-log` is **2,608 lines and thirteen surfaces**; the spec for all of it is `docs/parity/level-log.md` (**283 checklist rows, Parts A–Q**). What has come across here is **Part H** (`WallMigrationChart`), **Part I's RANGE behaviour**, and the slice of **Part P** those two need. Still to come, in the parity doc's order: the ticker rail (E), the log card head (F), the capture rail and chips (G), the churn strip (J), the timeline (L), the reaction legend (M) and `buildLogText` (Q). **Nothing below is a placeholder for them — they are simply not built yet, and this page says what it shows.**

`wallData.ts` repeats it:

> This module is the FIRST slice of that port: only what the migration chart reads. The ticker rail, the log card, the capture rail, the churn strip, the timeline and `buildLogText` are still to come — see the parity doc, which is the checklist.

### ⚠ Part E has since landed, and those two lists were not updated

`TickerRail.tsx` opens with *"LEVEL LOG — THE TICKER CARD RAIL (parity **Part E**, as cards)"*, `railStore.ts` opens with *"v2's **Part E** was a TABLE"*, and `LevelLog.tsx` itself — thirty lines below the list that calls Part E "still to come" — says:

> THE RAIL SETS THAT SAME SYMBOL. The card strip above the log (**Part E, as cards** — see `levelLog/TickerRail.tsx`) is a SELECTOR, not a second picker…

And it is mounted, unconditionally, as the first child of the page. So the honest state of the port is:

| Part | Surface | Status |
|---|---|---|
| **E** | Ticker rail | **Ported, reshaped** — v2's six-column table of the whole scanner universe became a grid of chosen cards. `LevelLog.tsx`'s and `wallData.ts`'s "still to come" lists are stale. |
| **H** | `WallMigrationChart` | **Ported**, model transcribed row for row |
| **I** | The popout's range behaviour | **Ported and reworked** — a control, not a mode; and extended from v2's one option to four |
| **P** | Data layer | **Partially ported** — the slice the chart and the rail need |
| **N** | Formatters | **Ported** — `wallNum`, `wallStrike`, `dowName`, `mdShort` |
| **O** | The reads | **Ported and rewritten** — `/api/walls-range` replaces v2's fan-out |
| F | The log card head | **v2-only** |
| G | The capture rail and chips | **v2-only** |
| J | The churn strip | **v2-only** |
| L | The timeline | **v2-only** |
| M | The reaction legend | **v2-only** |
| Q | `buildLogText` | **v2-only** |
| S | The popout's modal chrome | **Deliberately not ported** — see below |
| A–D, K, R | not named in any header in `src/pages/levelLog/` | check `docs/parity/level-log.md` in the v2 repo |

### What is deliberately *not* v2's

From `LevelLog.tsx`:

> · **Part I's popout.** v2 drew the week view in a portalled modal with its own scrim, Escape handler and close button, which **Part S lists as v2-only chrome**. v3 already has ONE way to make a card full size — the expand control every Card carries (`design/primitives/Expand.tsx`) — and the range switch that made the popout worth opening lives in the toolbar, where it works at either size. So the range is a **control, not a mode** — and it now runs TODAY / 5 SESSIONS / MONTHLY / ALL TIME, which a modal could not.
>
> · **v2 defaulted the popout to 5 sessions** because opening it was an explicit act. Here the range is always on screen, so it opens on TODAY: **up to thirteen requests must not be the cost of landing on the page.**

From `WallMigrationChart.tsx`, four more:

> · No `data-cap-center` / `data-cap-swatch` and no absolutely-positioned swatch. Those exist to work around html2canvas drawing every text run at its own probed baseline; v3's `shell/snapshot.ts` has no html2canvas, so a plain inline-flex chip is centred in the PNG because it is centred on the page. **The workaround came out with the library it was for.**
> · No watermark prop. v2 stamped `/cb-edge-logo.png` over the popout's plot so it rode into the screenshot; v3's snapshot bakes its own titled band.
> · No `reverse` param on `stepRun` — v2 carried one and never passed it true.
> · Every array read is bound and guarded rather than indexed twice. v3 compiles under `noUncheckedIndexedAccess`, so `arr[s]` is `T | undefined` however sure the loop bound made us; the binding is what narrows it.

From `railStore.ts`, on why Part E is cards and not a table:

> v2's Part E was a TABLE — six columns, one row per ticker in the whole scanner universe, 620px of scroller. This is the same information as a strip of small cards above the log, for the reason the parity doc's **E14** records about the table: **it had no hover affordance and no sort UI, so the only thing anyone ever did with those hundred-odd rows was find their four or five symbols and click one. A rail you CHOOSE is that act, done once.**

### And two things that are v3's alone

* **MONTHLY and ALL TIME.** *"they exist because the question the week view answers — did this wall hold its strike across sessions — is a better question the further back it is asked: a CORE that has sat on the same strike for six weeks is a different object from one that rolled on Tuesday."*
* **The two-tier rail store** — localStorage for everyone, Postgres for the owner. No v2 equivalent.

### ⚠ The route comment's `?ticker=` does not exist

App.tsx advertises `/v3/level-log?ticker=SPX&date=2026-09-02`. The page reads **only `date`** out of the query string. The ticker comes from `usePageSymbol()`, and `LevelLog.tsx` says why:

> THE TICKER IS THE TOOLBAR'S. This page carries no ticker box of its own — it reads `usePageSymbol()`, the one symbol the app toolbar sets, for exactly the reason `src/data/symbol.tsx` gives: a second picker for the same thing is a second way to end up looking at two symbols at once and not notice. **Only the DATE lives in the query string.**

A link carrying `?ticker=` opens on the recipient's own saved symbol.

---

## File map

| File | Lines | What it owns |
|---|---|---|
| `src/pages/LevelLog.tsx` | 375 | The page. The five switches and their option tables, `RANGE_SESSIONS` / `RANGE_TAG` / `RANGE_FILE`, `CARD_MIN_H`, `CARD_ID`, the `?date=` read/write, the live gate, the CopyShot registration, the on-screen variant line and the three empty states. |
| `src/pages/levelLog/wallData.ts` | 575 | The data layer. The wire types, the slot grid (`WALL_SLOTS`, `slotClock`, `slotAtMins`), the ET maths, the Part-N formatters, `fetchWallsRange` / `fetchLog` / `fetchTape`, `rangeDayToSlice`, `useMinuteTick`, `useWallDays`. |
| `src/pages/levelLog/WallMigrationChart.tsx` | 807 | The chart. The whole model (forward fill, the CORE-sign two-role rule, the shared y range, the legend eligibility test), the SVG, the legend chips, the clock rail and the date rail, plus `compact` and `fill`. |
| `src/pages/levelLog/railStore.ts` | 530 | The rail's list (`useRailTickers`, `normalizeRail`, the two tiers) and its numbers (`useWallUniverse`, `useRailDays`, `fetchRailRange`, `fetchRailDay`). |
| `src/pages/levelLog/TickerRail.tsx` | 305 | The rail's layout: `RailCard`, `Delta`, the header row with `+ Add` and `Reset`. |

---

## Page shape

```tsx
<Page fill>
  <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    <TickerRail … />
    <Card title="Level Log" expandId={CARD_ID} fill style={{ minHeight: CARD_MIN_H }} actions={↻}>
      <CardToolbar> … </CardToolbar>
      <div data-capture-hide> … the variant line … </div>
      {days.length ? <WallMigrationChart … fill /> : <div>…empty state…</div>}
    </Card>
  </div>
</Page>
```

`Page fill` with the column supplying its own gutter:

> `fill` — the page owns the viewport and the log card takes what the rail leaves, rather than both sitting at the top of a mostly empty scroll page. The column supplies its own gutter, which is what Page's fill variant expects of a route (see `Replay.tsx`, same shape), and it keeps `overflow-y-auto` so a short window scrolls instead of crushing the plot below `CARD_MIN_H`.

`CARD_MIN_H = MIG_H + 132` = **382px**, and it is a floor, not a height:

> The plot at its designed 250 plus the header, the toolbar row, the variant line, the legend and the axis stamps. The card used to be pinned to exactly this, which left the bottom two thirds of the page empty below it — **on a 1440p monitor the chart this page exists for got 250px and the wallpaper got 700.** It now FILLS what the rail leaves, and this number is only what it may not shrink below when the viewport is short (or the rail is three rows deep), at which point the column scrolls instead of squeezing the plot into a strip.

`CARD_ID = 'level-log-wall-migration'` is both the `expandId` and the `data-card-instance`:

> A constant because the two have to agree, and an expanded card is portalled out of its tile, so a query is the only lookup that still finds it.

---

## The toolbar

Everything lives in a `<CardToolbar>`, which portals into the `Card`'s own header — one bar per card, per `Card.tsx`'s rule (*"A card gets one bar of controls and it is the header it already has"*).

### The symbol chip

```tsx
<span title="The ticker this log is drawn from — set on the app toolbar, or by picking a card above">
  {symbol}
</span>
```
`tabular … font-mono text-2xs font-semibold uppercase` on `bg-surface2` with a `border-line` edge. Read-only — it is a label, not a control:

> WHICH TICKER, said out loud. The app toolbar owns the symbol and the rail above is a SELECTOR, so nothing between them and the plot named it — **the chart read as a set of levels with no ticker on it, expanded most of all, where the rail is off screen.**

### The date picker

`<DatePicker size="sm" value={date} max={todayETStr()} onChange={setDate} label={(v) => v} />`, title `Session date, ET`.

> The OS date field is the wrong control in a row of SegGroups — mm/dd/yyyy in the platform's own font, opening the platform's own calendar. Same "YYYY-MM-DD" value, same today cap, drawn from our tokens.

`setDate` writes to the query string with `{ replace: true }` — so stepping through dates does not fill the back stack. An empty value falls back to `todayETStr()`.

### The four `SegGroup`s

| Switch | Options | Default | Tooltip on the group |
|---|---|---|---|
| **View** | `Walls` / `Core` / `All` | `all` | `Which levels` |
| **Scope** | `0DTE` / `Non-0DTE` | `0dte` | `Which contracts` |
| **Basis** | `OI + Vol` / `Vol only` | `oivol` | `Which GEX` |
| **Range** | `Today` / `5 sessions` / `Monthly` / `All time` | `1` (Today) | `One session, or the last five, twenty-one, or every recorded one` |

Per-option tooltips, verbatim:

* `Call wall + put wall only` · `CORE level only` · `Walls + CORE on one timeline`
* `Nearest listed contract only — chain.expirations[0]` · `Every OTHER listed expiration, summed per strike`
* `netGEX + netVolGEX — open interest and today's volume` · `netVolGEX alone — today's volume, no open interest`
* `Just the selected date` · `The last 5 recorded sessions ending on the selected date` · `The last 21 recorded sessions — a trading month — ending on the selected date` · `Every session the recorder has for this symbol, up to the selected date`

**Why `All` and `All time` are different words:**
> "All time" rather than "All", because the view switch two chips to the left already owns that word for a different question — a row reading `All … All` is two answers to two questions and looks like one.

**Why `All` is not "no filter":**
> ALL is not "no filter" by accident — CORE is frequently ALSO one of the walls (whichever is carrying more gamma), so a tag scored on the call wall and the CORE tag at the same strike are the same event told twice.

**Why scope and basis are a re-fetch, not a re-computation:**
> Both are recorded server-side four ways and pulled through `/proxy/walls?scope=&basis=`, so switching either one is a re-fetch of an already-recorded log — never a re-computation, and never an interpolation of the variant you are not looking at.

### The ↻ Refresh action

The `Card`'s `actions` slot: a bare `↻` at `text-xs text-faint`, title `Re-read the recorder for this date`. It bumps `nonce`:

> It is a dep of the fetch effect and nothing else — the requests are `no-store`, so a bump is a genuine re-read of the recorder.

The same `nonce + tick` goes to the rail, so a refresh re-reads both.

### The on-screen variant line

```
0DTE · OI+vol GEX · level view · 09:29 open + every 15m to 16:00 ET, change-only
```
plus `live · 1m` when live, plus `loading…` **only when there is nothing on screen yet**.

It carries `data-capture-hide`, and the comment is the clearest statement of what that attribute is for:

> ON THE PAGE, NOT IN THE PICTURE.
>
> Every one of these words is already in the shot's caption — the variant is `metaOf` (see the registration above), and `live · 1m` is a fact about a tab that is open, which a PNG pasted into Discord tomorrow is not. Left in, it printed a second, longer caption directly above the real one, in a smaller font, saying the same thing plus the recorder's cadence.
>
> It stays on screen because on screen it is answering a question you can still act on: which variant am I looking at, and is this live.

And on the `loading…` pip:
> Only while there is nothing on screen. A pip that blinks on every minute tick is noise about a refresh nobody asked to watch.

---

## The ticker rail

A `<section>` with a header row and a `grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5`.

> FIVE COLUMNS, not a scroller. A horizontal strip meant the cards past the fourth were off screen, and a chart you have to scroll to is a chart nobody looks at. It steps down to three and then two on narrow windows rather than squeezing five 40px plots onto a laptop.

**Header row:** `Tickers — <date>` at `text-2xs font-semibold uppercase tracking-wide text-muted`, the count in `font-mono text-2xs text-faint`, then right-aligned: a `TickerPicker` labelled `+ Add` (or the text `rail full` once at 24) and a `Reset` button.

The picker is the app's own, deliberately:
> The universe picker, not a free text box: it is the same control the app toolbar uses, **so a symbol starred here is starred there**. It still accepts an off-universe symbol (`allowCustom`) for the same reason the toolbar does — the scanner list is the server's watchlist, not the set of symbols the app can price.

### A card

Every tile is a real `Card` — `flush` and `expandable={false}`:

> WHAT IS A CARD AND WHAT IS NOT. Every tile is a real `Card` — the rule is that anything with a border and a background is one, and a grid of hand-rolled bordered divs is exactly the drift that rule exists to stop. They are `flush` (their own padding) and `expandable={false}`: the expand control belongs to the log card, which is the full-size version of what these are.

Selected cards take `borderColor: alpha(T.cyan, 0.55)` and `background: alpha(T.cyan, 0.1)` — `T.cyan` is `--color-accent`, `#2f6bff`.

**Contents, top to bottom:**

1. **Head** — the symbol at `text-xs font-semibold tracking-wide text-fg`, the spot right-aligned in `font-mono text-xs` via `wallNum` (2 dp), and the change count as `<n>×` at `text-3xs text-faint` when `changes > 0`, title `Level changes recorded today`.
2. **The plot** — `<WallMigrationChart days={days} view={view} height={124} compact />`, or the fallback text.
3. **The levels row** — one entry per level in the view, in **price order**, each `LABEL  strike  Δ`.

**The chart is the same component, on purpose:**
> A card showing only the closing levels answers "where did it end" and hides the one thing this page exists for — whether the level HELD while price travelled. Drawing it with `WallMigrationChart compact` rather than a mini re-implementation is deliberate: **the forward fill, the CORE-sign role rule and the y range are the parts that must never drift between the big chart and the small one.**

**`MINI_H = 124`,** doubled from 62 on 2026-09-04:
> at 62px a 1-minute tape put a minute on a third of a pixel, which is why the rail deliberately drew the log's own sparse spot captures instead. At 124px a minute is worth drawing, so the rail now pairs each log with the real tape and this height is what makes that readable rather than a thicker smudge.

**Level order is price order, not view order:**
```ts
const LEVEL_ORDER: WallLevel[] = ['put_wall', 'call_wall', 'cb']
```
> parity **E11**'s reasoning: switching to ALL should ADD a line, not reshuffle the two already on the card.

Labels are `PUT` / `CALL` / `CORE`, each in its own wall token (`LEVEL_COLORS.pw` / `.cw` / `.cb`) — note the rail uses `LEVEL_COLORS.cw` (blue) while the **chart** deliberately does not (see below).

**The `Delta` chip** — parity **E13**, *"including its deliberate asymmetry":*
> UP is green, DOWN is **AMBER, not red**. Red on this page means "put wall", and a red delta next to a green call wall reads as a level type rather than a direction.

It renders **nothing** when the level has not moved: *"which is the common case and the one where a chip saying '0' is pure noise."* Title: `<open strike> at the 09:29 open`.

**The × is a sibling, not a child:**
> The card body is one button (select) and the remove control is a sibling positioned over it, because **a button inside a button is invalid HTML and Firefox drops the inner one.** SPX / SPY / QQQ get no × at all rather than a disabled one — a control that is always dead is a control you have to learn to ignore.

### Where the list lives — two tiers

```ts
export const RAIL_PINNED  = ['SPX', 'SPY', 'QQQ']
export const RAIL_DEFAULT = ['SPX','SPY','QQQ','AAPL','AMZN','GOOGL','META','MSFT','NVDA','TSLA']
export const RAIL_MAX     = 24
const RAIL_KEY            = 'cb-v3-level-log-rail'
const RAIL_ENDPOINT       = '/api/level-log-tickers'
const SAVE_DEBOUNCE_MS    = 400
export const RAIL_TICKER_RE = /^[A-Z][A-Z.]{0,5}$/
```

> THREE ARE PINNED. SPX, SPY and QQQ are the board's reference set — the index, its ETF and the tech proxy — and every level on this page is read relative to them, so they carry no × and `normalizeRail` puts them back at the front of any list that arrives without them. Everything else is the user's.

> The rail a browser that has never been here gets. The three pinned, then the mega-caps the recorder sweeps every slot anyway — so a first visit shows a full rail of real numbers rather than nine empty cards inviting a search.

> Ceiling on the rail. Not a storage limit — it is the point past which a horizontal strip stops being scannable and becomes a second table, which is the thing this replaced.

**The two tiers:**
> · **PER BROWSER, for everyone:** localStorage. It is a view preference, it is tiny, and it must survive a reload without a round trip or a session.
> · **PER ACCOUNT, for the OWNER:** `/api/level-log-tickers`, Postgres behind it. The owner reads this page off three machines; a rail that only exists in one browser profile is a rail he rebuilds twice.
>
> localStorage is written on EVERY edit regardless, so **the server copy is a mirror, never the source of truth for a page that has already painted**: the rail is on screen from the first frame with the local list, and the server's answer only replaces it if a row actually exists (`stored: true`). A 401, a dead DB or a signed-out session all leave the local rail exactly as it was.

`normalizeRail` is total — *"it never throws and never returns an empty list, so a corrupted localStorage value degrades to 'the three pinned' rather than to a page that will not render."*

`readLocalRail` distinguishes two kinds of empty:
> No key at all is a first visit — the defaults. An **EMPTY stored list is a deliberate act** (everything but the pinned removed) and is honoured.

`lastSaved` is a ref of the last-persisted JSON — *"which is what stops the mount — and the adoption of the server's own list — from writing straight back out. A ref rather than state because changing it must not re-render."*

The owner read waits on auth:
> Runs once `/api/auth/me` has answered, so a signed-in owner never has this decided off `isOwner === false` while the claim is still in flight.

---

## The data path

### Endpoints

| URL | Called by | Returns | Cadence | Failure |
|---|---|---|---|---|
| `/api/walls-range?symbol=<T>&days=<N>&end=<YMD>&scope=&basis=` | `fetchWallsRange` — the multi-session range, **and** the single-session tape fallback | `{ ok, days: [{ date, log, spot: [[mins, px], …] }] }` | once per (symbol, date, count, variant, nonce) | returns `null` → caller falls back |
| `/api/walls-range?symbols=<A,B,C>&days=1&end=<YMD>&scope=&basis=` | `fetchRailRange` — **the whole rail in one request** | `{ ok, bySymbol: { SYM: [day] } }` | once per (rail, date, variant, nonce) | `null` → per-symbol waves |
| `/proxy/walls?date=<YMD>&symbol=<T>&scope=&basis=` | `fetchLog`, `fetchRailDay` | `{ ok, log: WallLogRow[], events: WallEventRow[] }` | once per (symbol, date, variant, nonce) | `null` |
| `/proxy/walls?date=<YMD>&scope=&basis=` *(no symbol)* | `useWallUniverse` — the **day summary**, every ticker | `{ ok, tickers: WallTickerRow[] }` | once per (date, variant, nonce) | cards stay on their dashes |
| `/proxy/candles-intraday?symbol=<T>&interval=1m&fromMs=<ms>` | `fetchTape` | `{ candles: [{ time, close }] }` | once per (symbol, date) | `[]`, best-effort |
| `/api/level-log-tickers` | `useRailTickers` (owner only) | `{ stored, tickers }` GET / POST | on auth, and 400 ms after each edit | local rail stands |

All of them use `cache: 'no-store'` and `credentials: 'same-origin'`.

### Why `api.ts` is bypassed

> NOT `api.ts`'s `query()`: the reads are `cache: 'no-store'` + a nonce. A **30s stale window would make the refresh button — and the one-minute live tick below — sometimes do nothing**, which is worse than an extra request nobody asked for.

That is also why there is no rail prefetch: nothing here would read the cache back.

### No waterfall

> NO WATERFALL (non-negotiable 3): for the single session the log and the tape are fired TOGETHER — the date is known at entry, so there is nothing to wait on. The week view keeps v2's two waves on purpose: the candidate logs decide WHICH days exist, and a bank holiday must not cost a 1-minute candle fetch.

And the rail and the chart go out on the same render:
> Same `no-store` + nonce contract as `useWallDays`, and fired from the same render, so the rail and the chart go out together rather than in sequence.

`TickerRail.tsx`'s own note: *"Both reads fire from this one render — the summary that fills the heads and the per-symbol logs the plots draw. Neither waits on the other."*

### The live tick

```ts
export const LIVE_POLL_MS = 60_000
const live = isToday && range === '1'
const tick = useMinuteTick(live)
```

Gated **three ways**:

> The price line IS `/proxy/candles-intraday` at `interval=1m`, so a minute is the granularity of the underlying data: polling faster asks the proxy for a bar that does not exist yet (it caches ~60s anyway), and polling slower leaves the spot line short of the clock on a page whose whole subject is where price went while the levels held.
>
> Gated three ways … because v2's page has no poll at all and the reason it gives — **"so an open tab never hammers the recorder"** — is still right for every case except the live one: the session has to BE today (a past date cannot change), the tab has to be visible, and it is the single-session view only. A multi-session range would re-read every session on it once a minute to move the last of five — or of 260 — slices.

Returning to a hidden tab **steps the tick immediately**:
> the first thing someone does on returning is read the number, and a stale one for up to a minute is the whole failure this is meant to fix. Browsers throttle hidden-tab timers anyway, so leaving the interval running would not be a substitute.

`LevelLog.tsx` states the same rule in one line: *"A past session cannot change, so a tab left on one costs nothing at all."*

### `/api/walls-range` — why it exists

The longest justification in the data layer:

> The week view used to be `count + 3` log requests to find which days exist, then one 1-minute candle request per day that did — **thirteen round trips for five slices**. And the tape half kept coming back empty: dxFeed's 1m window is about seven days and `/proxy/candles-intraday` is best-effort, so four of the five sessions routinely fell through to the log's own spot column. That column is CHANGE-ONLY — a dozen points a day — which is what drew price as a staircase beside levels that are genuinely steps, **on the one chart whose subject is telling those two apart**.
>
> `/api/walls-range` answers both halves in one query: the newest N sessions this symbol actually recorded, each carrying `scanner_snapshots.spot` at 5 minutes — the same sweep the walls themselves were sampled from, so it needs no dxFeed window and **cannot be missing for a day the levels exist on**. ~78 points a session against a dozen.
>
> WHAT IT COSTS: 5 minutes instead of 1, and **no `events`**. Both are right for this view — five sessions across one card is ~380px per session, where a minute is a third of a pixel; and the events layer is a per-session reading (Part L's timeline, the reaction badges), not something the week view draws. TODAY still takes the 1-minute path below, where a minute IS worth a pixel and the tape is live.

`rangeDayToSlice` returns `{ …, events: [] }` — *"An empty array, not a missing key, so every consumer keeps reading `day.events` unconditionally."*

And `expectDate` guards an off-by-one-day trap:
> `days=1` returns the newest session ON OR BEFORE `end`, so a date with no recorded session comes back as the PREVIOUS one. A caller that asked about a specific day says so, and gets nothing rather than **yesterday under today's heading**.

### The thin-tape fallback

```ts
export const DENSE_MIN_SAMPLES = 20
```

> How many price samples a day needs before the chart calls it a TAPE rather than a handful of captures. Below this the line is drawn from the log's own change-only spot column and reads as price moving in half-hour steps, so it is also the threshold at which the single-session view goes looking for a better series.

The fallback, with a dated example:

> `/proxy/candles-intraday` is a short-lived dxLink candle subscription, and it is reliable for SPX and thin-to-empty for plenty of single names — **AAPL on 2026-09-05 came back with nothing while its rail card, which reads the 5-minute series, drew a full session.** The old behaviour then fell all the way through to `walls_log.spot`: 14 change-only captures drawn as a staircase, on the big card, for a symbol whose thumbnail two inches above it looked correct.
>
> So a thin tape now asks `/api/walls-range` for the SAME 5-minute `scanner_snapshots.spot` series the rail and the week view use. It cannot be missing for a day the levels exist on, because it is the sweep the levels were sampled from.
>
> **SEQUENTIAL ON PURPOSE**, and not a waterfall in the sense non-negotiable 3 means: this is not something the view needs at entry, it is what it needs when the first answer was empty. Firing it unconditionally would put a third request on every SPX load — the case that already works — to save a round trip in the case that does not.

It only wins if it is actually better: `if (same && same.price.length > price.length) price = same.price`.

### The legacy fallback, and its ceiling

```ts
const LEGACY_FALLBACK_MAX = 5
```

> That path is ONE request per candidate weekday plus one tape request per day that had rows — thirteen for five sessions, and it has always been that. The month and all-time ranges are only affordable because `/api/walls-range` answers them in a single query; **fanning 260 sessions out over the old path would be eight hundred requests to draw a chart**, so a server that lacks the route serves the short ranges and returns nothing for the long ones.

The candidate list is `lastWeekdays(end, count + 3)`:
> Weekends only — **market holidays are not enumerated here on purpose.** A holiday simply has no rows, and the fetch below drops empty days, which handles a half-day, an unscheduled close and a ticker that was not in the scanner universe yet with the same rule and no calendar to keep in sync.

The fallback also paints in two stages — `setState({ days: kept.map(…price: []), loading: true })` and then again with the tapes — so the steps are on screen before the price line lands.

### The rail's two paths

`fetchRailRange` first — one request for every card:

> `/api/walls-range?symbols=…&days=1` returns every listed symbol's log for the date AND a 5-minute price line for each … The per-symbol path below is two requests each (log + 1-minute candles), so a ten-card rail was twenty round trips and a twenty-four-card rail was forty-eight; **this is one**.
>
> 5-minute rather than 1-minute is the trade, and at `MINI_H` it is not a trade at all: a card is a couple of hundred pixels wide for a 390-minute session, so a 1-minute tape was drawing five points per pixel. What it buys back is **the line EXISTING**.

The "old server" detector is the response key itself:
> `bySymbol` is the multi-symbol key and nothing else returns it, so **its absence IS the "this server does not support it" signal**.

The fallback runs in waves of `RAIL_FETCH_CONC = 4`:
> Waves of `CONC`, because the alternative shapes are both wrong: all at once is 24 parallel proxy reads off one page load, and one at a time is a rail that fills in over several seconds. **HALVED from 6 with the tape added** — each symbol is now two requests, so a wave of 4 puts the same 8 reads in flight that a wave of 6 used to.

And it paints per wave:
> the first five cards are the ones on screen, and holding them back until the twenty-fourth lands is a blank rail for no reason.

`fetchTape` is **imported** by `railStore.ts` rather than re-implemented:
> One implementation on purpose: the ET window this reads, the `mins` origin it emits and the best-effort empty return are all things the two surfaces have to agree on, and **the version that drifts is the one nobody is looking at**.

### The wire shapes

```ts
type WallLevel = 'call_wall' | 'put_wall' | 'cb'

type WallLogRow = {
  slot: number; at: string; ts: string
  level_type: WallLevel
  strike: number
  prev_strike: number | null
  delta: number | null
  spot: number
  reason: 'open' | 'change'
  level_gex: number | null
}

type WallEventRow = {
  hit_slot: number; at: string; hit_ts: string
  level_type: WallLevel
  strike: number
  spot_at_hit: number
  kind: 'touch' | 'approach'
}

type SpotSample = { mins: number; px: number }   // ET minutes since midnight
type DaySlice   = { date: string; log: WallLogRow[]; events: WallEventRow[]; price: SpotSample[] }

interface WallTickerRow {
  symbol: string
  spot: number | null
  call_wall: number | null; put_wall: number | null; cb: number | null
  open: Partial<Record<WallLevel, number>>
  changes: number
  hits: number
}
```

`DaySlice` is deliberately an array everywhere:
> The chart takes an ARRAY of these — one entry is the inline single-session chart, five entries is the week view — **so both are the same drawing code and cannot drift.**

And `open` is what makes the rail's delta free:
> `open` is the 09:29 baseline per level, which is what makes the session delta a **subtraction rather than a second request**.

`/proxy/walls` serves a log one symbol at a time by design:
> the comment on the endpoint spells out why: every symbol's full day would be a several-thousand-row response.

---

## Every derived number

### The slot grid

```ts
export const WALL_SLOTS = 27            // slot 0 = 09:29, slots 1…26 = 09:45 … 16:00
const OPEN_SLOT_MINS  = 9*60 + 29       // 569
const GRID_START_MINS = 9*60 + 45       // 585

slotClock(slot) = slot <= 0 ? '09:29' : HH:MM of (585 + (slot-1) * 15)

slotAtMins(m) =
  m <= 569 ? 0
  : m <= 585 ? (m - 569) / 16
  : 1 + (m - 585) / 15
```

Units: `slot` is a fractional index; `mins` is ET minutes since midnight.

> ET minutes → FRACTIONAL slot. The inverse of the recorder's `slotMins()`, so a 1-minute price sample lands on the same x as the 15-minute level step it happened under. **Slot 0 sits 16 minutes before slot 1, not 15**, because the open capture is at 09:29 — that first gap is its own scale.

### The ET conversions

`etOffsetMinutes(d)` parses `timeZoneName: 'shortOffset'` out of an `en-US` format and falls back to **−300** (EST) on any parse failure. `etMsOn(date, hh, mm)` parses the naive UTC instant and subtracts the offset.

`fetchTape` emits `mins = 570 + (t - from) / 60_000` where `from` is 09:30 ET — *"No DST change lands inside a session, so minutes off the open is exact."*

`todayETStr()` formats `en-CA` parts in `America/New_York`.

### Forward fill

```
at slot s, a level is whatever it was last written as
```

> `walls_log` is CHANGE-ONLY, so each series is forward-filled from its last written row. **That is exactly what the level did — a wall holds its strike until it rolls** — which is why every level is a STEP and never a slope. A diagonal between two captures would draw the level at prices it never occupied, which is precisely the reading this panel exists for.

The fill runs `s = 0 … lastSlot`, advancing an index into the sorted rows; slots past `lastSlot` stay `null`.

### How far the day draws

```ts
lastWrite = max slot over log rows and event hit_slots
tapeEnd   = max slotAtMins(p.mins) over the tape
lastSlot  = min(26, max(lastWrite, ceil(tapeEnd)))
```

> The x axis used to end at the last row `walls_log` wrote, and `walls_log` is change-only. So a ticker whose walls stopped rolling at 10:00 drew a half-hour chart and threw away the six hours of tape already in hand — **exactly backwards, because "the level sat while price travelled all day" is the single most tradeable thing this panel can show.**
>
> So the extent is the TAPE. Mid-session it ends at the last closed minute, so the chart ends at now; on a past date it ends at 16:00. With no tape `tapeEnd` is 0 and the extent falls back to the log.

### The CORE-sign rule, as two roles

The longest piece of reasoning in the chart:

> CORE is the single largest |net GEX| node on the chain, so it IS one of the walls: positive gamma at that node makes it the call wall, negative makes it the put wall. Drawing the matching wall beside it is the same strike twice in two colours.
>
> Masking the matching wall out per slot was right about the rule and **wrong about the drawing** — green and red kept blinking out mid-session, so the eye read a level that had vanished rather than a role that had swapped. **TWO ROLES, NOT THREE LEVELS:** CORE is the heavier wall, OTHER is the lighter one, both run the whole session, and when dominance flips the lines swap. OTHER carries the colour of the wall it currently IS.

Resolving which wall CORE is, in order:

```
1. c === callWall[s]           → coreSide = 'call'
2. c === putWall[s]            → coreSide = 'put'
3. coreG[s] !== 0              → coreSide = coreG[s] > 0 ? 'call' : 'put'   // recorded level_gex, forward-filled
4. both walls present          → whichever strike is nearer
5. otherwise                   → whichever wall exists
```

> WHICH WALL THE CORE IS. The strike itself answers it whenever CORE is sitting on one — which is most slots. Failing that the recorded gamma sign answers it. Failing that (a day whose `cb` rows predate `level_gex`) the nearer wall does, which is never wrong by much and is at least stable from slot to slot — **a role that flickers is the thing this model exists to stop.**

Roles only exist where `cb` **and** at least one wall are both in play: *"The WALLS view (no cb) and the CORE view (no walls) have nothing to resolve and fall through to the plain per-level drawing."*

And turning CORE off drops the whole model:
> SWITCHING CORE OFF DROPS THE ROLE MODEL WITH IT. The whole reason CORE suppresses a wall is that it IS that wall. With CORE hidden there is no double, so there is nothing left to suppress: both walls go back to their own recorded series and each runs the full span.

### Spot

The chart builds two things and picks one per day:

```
spotPts   = one point per slot that carried a spot (log rows, then events OVERWRITING them)
tapeAll   = every price sample mapped through slotAtMins, bounded to [0, 26]
dense     = tape.length >= 20
spotDrawn = dense ? tape : spotPts
```

> Events are written second so a tag's `spot_at_hit` wins over the level row at the same slot — **the tag is the more precise reading of where price actually was.**

> WHICH PRICE GETS DRAWN. The 1-minute tape when it arrived, the log's own captures when it did not — **never the two spliced together**, which would put a smooth stretch next to a stepped one and read as the tape going quiet rather than the data running out. **Decided PER DAY**, so one session missing its tape does not downgrade the other four.

### The shared y range

```
vals = every non-null level value + every drawn spot point, ACROSS ALL DAYS
lo, hi = min, max
if (!(hi > lo)) { lo = c * 0.999; hi = c * 1.001 }     // c = lo or 1
padY = (hi - lo) * 0.08 ; lo -= padY ; hi += padY
```

> ONE y range across every day drawn. Per-day scaling would make a week of levels look flat by rescaling each session to its own range — **the whole point of the week view is seeing a wall hold its strike ACROSS days.**

Fewer than two values → the whole component returns `null`.

### The x mapping

```ts
segW = 100 / N                                   // viewBox is 100 wide
x(i, s) = i * segW + (s / max(1, segs[i].lastSlot)) * segW
```

> Index across what was recorded, edge to edge. Each day owns an equal SLICE of the 100-wide viewBox and its own slots run edge to edge inside it. **Equal width per day, not equal minutes:** the comparison the week view exists for is "where did the levels sit each day", not "how long was each day".

### The y mapping

```ts
plotPad = min(8, height * 0.08)
y(v) = plotPad + (1 - (v - lo) / (hi - lo)) * (height - plotPad * 2)
```

> 8px of breathing room at 250, proportionally less on the rail's 62px tiles — a fixed 8 top and bottom there would spend a quarter of the plot on margin and flatten the very thing the mini chart is for.

*(The comment still says 62; `MINI_H` is 124 today. At 124 the pad resolves to 8 anyway, since `124 × 0.08 = 9.9`.)*

### The step path

`stepRun(i, arr, a, b)` emits, for each change of value, the **held** value at the new x and then the **new** value at the same x — a vertical edge, never a diagonal. It walks **one day only**:
> never across a day boundary, which would draw a diagonal through an overnight the level did not travel.

`stepRuns` splits a day into **one polyline per contiguous run**:
> One polyline for the whole day was fine while the only gap was before the first capture — but the CORE-sign rule punches holes mid-day, and a single polyline would bridge one with a diagonal through strikes the wall never held while it was suppressed.

Under the role model, consecutive OTHER runs are joined at the swap:
> Carry the run to the next slot's value, so consecutive runs meet at the vertical edge instead of leaving a slot-wide hole between them.

Stroke widths: **CORE 2.2**, walls **1.8**, spot **1.5**. Draw order: `put_wall`, `call_wall`, `cb` — then spot last, *"so it reads on top of the levels it is compared with."*

### The legend eligibility test

> What the LEGEND may offer. Under the role model **a wall earns its chip by being the OTHER line somewhere** — a wall that is the CORE all session is already on screen in gold and must not also take a chip that toggles nothing.

```ts
kept = levels.filter((lt) =>
  !roled ? segs.some(seg => seg.series.has(lt))
  : lt === 'cb' ? true
  : segs.some(seg => seg.roles?.side.some(v => v === (lt === 'call_wall' ? 'call' : 'put'))))
```

Empty → the component returns `null`.

The levels list itself is a **union across days**:
> a level that only exists on three of five sessions should draw on those three, not be dropped from the week.

### The cadence readout

```ts
a = pts[floor(len/2)] ; b = pts[floor(len/2)+1]
cadenceMin = round((b.s - a.s) * 15)        // valid only in [1, 60]
```

> HOW OFTEN THE TAPE SAMPLES, in minutes, read off the data rather than assumed. The caption used to print the point count as "N min of price", which was true only while every tape was the dxFeed 1-minute one. The week view now takes its price from `/api/walls-range` — `scanner_snapshots.spot` at 5 minutes — so **a 78-point session would have read as 78 minutes of a 390-minute day**.
>
> `s` is a FRACTIONAL SLOT and slots 1…26 are 15 minutes apart, so a gap in slots × 15 is the gap in minutes. Measured across the middle of the first dense day, past the 09:29→09:45 slot 0 seam, which is its own 16-minute scale and would otherwise be the number that got measured.

### The rail's stamp density

```ts
stampEvery    = max(1, ceil(N / 10))
isStamped(i)  = (N - 1 - i) % stampEvery === 0     // anchored on the LAST session
showDow       = N <= 6
thinDividers  = N > 40
```

> The rail printed a weekday and a date under EVERY slice, which is right for five and unreadable for twenty-one — at 260 each slice is under three pixels and the "MONDAY" over it is forty. So the rail stamps about ten sessions however many are drawn, **anchored on the LAST one: the newest session is the one being read against the others and it must always carry its own date.** The weekday name comes off as soon as the slices are too narrow to hold it; the m/d stamp is what survives.
>
> The session dividers thin with the stamps once they would out-number the data — **260 hairlines a pixel apart is a grey wash, not a set of edges** — so past that point a line is drawn only where a date is printed, and the two read as one rail.

### The formatters (parity Part N)

| Function | Rule | Example |
|---|---|---|
| `wallNum(n, dp = 2)` | exactly 2 dp, comma-grouped; `—` for null/non-finite | `6,301.44` |
| `wallStrike(n)` | no forced decimals, max 2 | `6890`, `6890.5` |
| `dowName(date)` | uppercase weekday, **parsed at noon UTC, read back in UTC** | `MONDAY` |
| `mdShort(date)` | `m/d`, no zero pad | `8/21` |
| `variantTag(scope, basis)` | `0DTE \| non-0DTE` · `OI+vol GEX \| vol-only GEX` | `0DTE · OI+vol GEX` |

> "MONDAY" from "2026-08-24". Parsed at NOON UTC and read back in UTC, so the name never slips a day on a browser west of Greenwich — **the date string is a calendar date, not an instant, and midnight-parsing it is how "Monday" turns into "Sunday" for anyone in America.**

### The range table

```ts
const RANGE_SESSIONS: Record<RangeKey, number> = { '1': 1, '5': 5, '21': 21, all: 260 }
const RANGE_TAG:  Record<RangeKey, string> = { '1': '', '5': '5 sessions', '21': '21 sessions', all: 'all recorded sessions' }
const RANGE_FILE: Record<RangeKey, string> = { '1': '', '5': '-5d', '21': '-1m', all: '-all' }
```

> They cost ONE request each, not one per session … **MONTHLY is 21 sessions — a trading month, not 30 calendar days** — and ALL TIME asks for the route's own ceiling, so it is "everything the recorder has" without the page having to know how much that is.

`all` = **260**, *"/api/walls-range's cap"*.

---

## Controls and where state lives

| Control | Default | Storage |
|---|---|---|
| Session date | `todayETStr()` | **query string `?date=`**, written with `replace: true` |
| Ticker | `SPX` | **`localStorage` `cb-v3-page-symbol`**, via `usePageSymbol` — shared with the whole app |
| View | `all` | React state |
| Scope | `0dte` | React state |
| Basis | `oivol` | React state |
| Range | `1` (Today) | React state |
| Refresh nonce | 0 | React state |
| Rail list | `RAIL_DEFAULT` (10) | **`localStorage` `cb-v3-level-log-rail`** (JSON `string[]`), plus **Postgres via `/api/level-log-tickers`** for the owner |
| Legend switches (per chart) | all on | React state, a `Set<MigKey>` of what is **off** |
| Rail icon order | `NAV` order | `localStorage` `cb-v3-rail-order` (Shell's) |

**Only the date is shareable.** The view, scope, basis and range all reset on a reload — as does the ticker for anyone but the person whose browser saved it.

The legend keeps the **off** set, not the on set:
> Kept as the set of what is OFF so a level that only appears later (a week fetch landing, the view switching) arrives visible.

---

## Rendering

### SVG, not canvas

> PAINT TARGET: SVG, not canvas — `<line>` and `<polyline>` only, **no `<text>` and no `<circle>` inside it**, every stroke `vectorEffect="non-scaling-stroke"` so the horizontal squash never thickens a line. Non-negotiables 5 and 6 (visibility guard, `data-cb-layer`) are about canvases on the animation frame; **this draws once per model change and has nothing to gate.**

And:
> `preserveAspectRatio="none"` — the x axis is slots, the y axis is price, **and the two have no business sharing a scale.**

The viewBox is `0 0 100 <height>`. With `fill`, `height` is left off the element and the style is `width: 100%; height: 100%` — *"The viewBox is unchanged and `preserveAspectRatio` is already 'none', so this is a pure vertical scale."*

### The three layers, in order

1. **Session dividers** — solid, `alpha(T.text, 0.22)`, `strokeWidth 1`, full height, one per boundary (thinned past 40 sessions). *"Solid, unlike the dashed 'log stopped writing' mark, because they are a different kind of edge: one is a gap in the clock, the other a gap in the rows."*
2. **The held-from mark** — dashed `3 3`, `alpha(T.text, 0.16)`, at the last written slot **only when the day runs past it**. *"Everything right of it is the forward fill — the levels held, which is why there are no rows — and the reader is entitled to see which half is captures and which is hold."*
3. **The level polylines**, then the spot polylines.

### Colours

`LEVEL_COLOR` in the chart is **not** the same mapping as `LEVEL_TOKEN` on the rail:

```ts
const LEVEL_COLOR = {
  call_wall: ES_CANDLE_UP,      // var(--color-candle-up)  #3ddc8e
  put_wall:  LEVEL_COLORS.pw,   // var(--color-level-pw)   #ff5fa2
  cb:        LEVEL_COLORS.cb,   // var(--color-level-cb)   #ffd166
}
```

> Deliberately NOT `LEVEL_COLORS.cw` for the call wall. **That token is blue, and blue beside a red put wall does not read as the up side** — v2 made the same call for the same reason and reached for the candle up colour. Gold CORE, green call wall, red put wall.

The rail's head chips *do* use `LEVEL_COLORS.cw` (`#4d8cff`), so **the call-wall number on a card and the call-wall line inside it are two different colours.** That is what the source says in each place.

| Token | Hex | Where |
|---|---|---|
| `--color-candle-up` | `#3ddc8e` | the call-wall line |
| `--color-level-pw` | `#ff5fa2` | the put-wall line, the rail's PUT chip |
| `--color-level-cb` | `#ffd166` | the CORE line, the rail's CORE chip |
| `--color-level-cw` | `#4d8cff` | the rail's CALL chip **only** |
| `--color-fg` | `#e7ece9` | the spot line (`T.text`), dividers at 22%, the held mark at 16% |
| `--color-accent` | `#2f6bff` | the selected rail card's border (55%) and wash (10%) |
| `--color-up` | `#3ddc8e` | the rail's ▲ delta chip (`T.green`) |
| `--color-warn` | `#ffd166` | the rail's ▼ delta chip (`T.orange`) |
| `--color-surface` | `#0e1216` | every `Card` |
| `--color-surface2` | `#141a21` | the symbol chip |
| `--color-raised` | `color-mix(#141a21 92%, #e7ece9)` | hovers |
| `--color-line` | `#1e2630` | every border |
| `--color-muted` / `--color-faint` | `#e7ece9` / `#c0c5c3` | labels / dashes and `loading…` |

### Layout constants

| Constant | Value | Where |
|---|---|---|
| `MIG_H` | **250** | the big plot |
| `MIG_PAD` | 8 | plot padding, capped at `height × 0.08` |
| `MINI_H` | **124** | the rail's plot |
| `CARD_MIN_H` | `250 + 132` = **382** | the log card's floor |
| `LEGEND_SWATCH` | 11 | legend chip square, border-box |
| `WALL_SLOTS` | 27 | the x domain |
| y padding | 8% of `(hi − lo)` each side | the price domain |
| Rail grid | `grid-cols-2` → `md:grid-cols-3` → `lg:grid-cols-5` | `TickerRail` |
| Page column | `gap-3 p-4`, `overflow-y-auto` | `LevelLog` |

**`MIG_H = 250` is taller than what it was ported from:**
> The body is taller than the post-market recap's 190 it was ported from, because this chart draws a whole session of steps against a 1-minute tape and at 190 the walls sat within a few pixels of price all day.

### The legend

Each chip is a **switch**:
> A small square swatch, the level in sentence case, and the strike it currently sits on. Each chip is also the series' SWITCH — three levels and a price line inside 250px is a lot of ink for one question, and the question is usually about one of them. **Off reads as off: the swatch hollows out and the whole chip dims, rather than the row looking identical to a chart that simply had no data.**

On: `text-fg`, swatch filled. Off: `text-muted opacity-40 hover:opacity-70`, swatch `background: transparent` with the colour kept on the border. `aria-pressed` is set; the title is `Hide <label>` / `Show <label>`. The strike shown is `lastOf(lt)` — *"Last written value of a level across the whole span"*, searched newest day backwards.

The spot chip only appears when there is a last point, and is labelled `spot` in `T.text` with `wallNum` (2 dp).

> Its own legend, under the head and above the plot. The card title says nothing about these series — **which is exactly how a CORE line reads as an unexplained squiggle.**

### The head line

```
Wall migration    5 sessions · recorded levels · 1,560 × 5m price
```
or, with no dense tape, `… · 14 spot captures`.

### The x rail

* **N === 1** — three clock stamps: `slotClock(0)` / `slotClock(round(lastSlot/2))` / `slotClock(lastSlot)`, `justify-between`, `font-mono text-2xs`.
* **N > 1** — one flex cell per session at `flex: 0 0 <segW>%`, stamped per `isStamped`, weekday above `m/d` when `N <= 6`.

> One clock rail for a single session; date stamps across the slices for anything longer, because 09:29/12:45/16:00 repeated five — or two hundred — times says nothing.

### No caption

> No caption under the plot. The legend names every series and the page head carries the scope, and **a paragraph under a 250px plot was taller than half the plot.**

### `compact` and `fill`

`compact` strips the head, the legend and the x rail, leaving the plot alone. It is a prop, not a second component:
> the model in the memo above (the forward fill, the CORE-sign role rule, the shared y range) is the part that must never drift, and a "just a sparkline" copy of it is exactly how two charts of the same data start disagreeing.
>
> The legend is what the compact card gives up, so **the card's own header has to carry the symbol and the numbers**.

`fill` swaps the root and the plot wrapper for `flex min-h-0 flex-1 flex-col` / `relative min-h-0 flex-1` — *"what the card uses when it is expanded to the page stage."*

`onExpand` is *"an escape hatch for a host that wants its own full-size control"* and renders a `⤢ Expand` button. **Nothing in this tree passes it** — the log card uses `Card`'s own expand control instead.

### The snapshot

The page publishes **the card, not the plot**, to the toolbar camera:

> SNAPSHOT is the toolbar camera's, not a button of this page's own. The page publishes the CARD — not the plot — to `useCopyShotTargets`, because **a PNG of the lines alone is a picture of some lines with no idea what they are of**; the card carries the ticker, the date, the variant and the legend. It resolves through `[data-card-instance]` at click time rather than a ref, so the shot still finds the card while it is expanded and living outside its tile.

```ts
{
  id: 'level-log:wall-migration',
  icon: '🧱',
  label: 'Wall migration',
  group: 'This page',
  meta: `${symbol} · ${RANGE_TAG[range] ? `${RANGE_TAG[range]} to ${date}` : date} · ${variantTag(scope, basis)}`,
  badge: tickerLogoUrls(symbol),
  file: `${symbol.toLowerCase()}-wall-migration-${view}-${scope}-${basis}-${date}${RANGE_FILE[range]}`,
  resolve: () => document.querySelector(`[data-card-instance="${CARD_ID}"]`),
}
```

It is published **only once a session has landed** (`days.length ? [...] : NO_TARGETS`):
> so the menu never offers a shot of the empty state, and named the way v2's `SnapLogButton` named its file.

And the `badge`:
> The company mark at the head of the caption. The card's header is dropped from every shot (`shell/snapshot.ts`) and the header is where the symbol chip lives, so **without this the PNG says AAPL in small grey type and nowhere else.**

The camera itself is owner-gated chrome, per `CopyShot.tsx` — *"It is not a permission: the capture runs entirely in the browser against pixels the viewer can already see."*

---

## Phone behaviour

**`/level-log` is not in `DESKTOP_TO_MOBILE`**, and there is no `/m/level-log` tab. A phone opening `/v3/level-log` gets the desktop page inside the full `Shell`, per `mobileNav.ts`'s rule: *"a cramped real page beats a redirect to an unrelated one."*

What that means concretely:

* **The rail reflows to two columns** (`grid-cols-2`, stepping to 3 at `md` and 5 at `lg`) — so a ten-card rail is five rows of two, each 124px of plot plus its head and levels. That is a lot of vertical scroll before the log card starts.
* **The chart survives.** It is a `viewBox`-based SVG at `width: 100%` with `preserveAspectRatio="none"`, so it squashes horizontally without clipping and `vectorEffect="non-scaling-stroke"` keeps every line 1–2.2px. This is the one chart on the page and it is the one thing that genuinely works at 390px.
* **The toolbar does not.** Five `SegGroup`s plus a `DatePicker` plus a symbol chip in one `CardToolbar` row wraps into several lines at phone width, and every one of them is at the board's `sm` density (10px ink, `px-1.5 py-0.5`) — **no control on this page passes `size="touch"`.**
* **`CARD_MIN_H = 382`** guarantees the log card cannot be squeezed; the column scrolls instead.
* **`data-capture-hide` and the snapshot** are irrelevant on a phone — the camera is owner-gated toolbar chrome and `Shell.tsx` drops the toolbar on `/m/*` (which this route is not, so the toolbar is actually still there).

There is no `useIsPhone()` call anywhere in these five files.

---

## Status and empty-state messages, verbatim

| String | Where | When |
|---|---|---|
| `Loading sessions…` | in place of the chart | `loading` and `days.length === 0` |
| `No recorded levels for <SYM> on <date> — <variant>.` | in place of the chart | range `1`, no days |
| `No recorded sessions for <SYM> in the <N> sessions ending <date> on <variant>.` | in place of the chart | range `5` or `21`, no days |
| `No recorded sessions for <SYM> at all on <variant>.` | in place of the chart | range `all`, no days |
| `loading…` (`text-2xs text-faint`) | the variant line | `loading && !days.length` |
| `live · 1m` | the variant line | `isToday && range === '1'` |
| `<variant> · <view> view · 09:29 open + every 15m to 16:00 ET, change-only` | the variant line | always |
| `loading…` (`text-3xs text-faint`) | inside a rail card | that card's read has not landed |
| `no session recorded` | inside a rail card | `loaded` and no slice for that symbol |
| `rail full` | the rail header | `tickers.length >= 24` |
| `Tickers — <date>` | the rail header | always |
| *(nothing at all)* | the chart | `model === null` — no levels in view with rows, or fewer than two values, or no eligible legend entries |

Tooltips worth having on record:

* `The ticker this log is drawn from — set on the app toolbar, or by picking a card above`
* `Re-read the recorder for this date`
* `Re-reads the recorder and the 1-minute tape every minute while this tab is open` (on `live · 1m`)
* `Session date, ET`
* `Show <SYM>'s level log` (a rail card)
* `Take <SYM> off the rail` / `Remove <SYM>` (the ×)
* `Level changes recorded today` (the `N×` counter)
* `<strike> at the 09:29 open` (a delta chip)
* `Add a ticker card to the rail` · `Back to the default rail` · `The rail holds 24 cards`
* `Hide <label>` / `Show <label>` (a legend chip)
* `Open this chart full size` (the unused `⤢ Expand`)

> Nothing is filled in. A level with no rows for the day is simply not drawn, and **the whole panel returns null rather than render an empty frame.**

---

## Performance and bundle notes

**Chunking.** `LevelLog-*.js` is `LevelLog.tsx` + `TickerRail.tsx` + `WallMigrationChart.tsx` + `wallData.ts` + `railStore.ts` — five files, 2 592 lines, **no chart library at all**. Everything paints as SVG elements React already knows how to render, so this route never touches `lightweight-charts` and never pays for a dynamic import. It is measured against:

```json
"entry": 38900,
"react": 55000,
"route": 59100,
"css": 8500,
"html": 2600,
"totalInitial": 108400
```

`budgets.json`'s framing applies — *"a budget with 4x headroom enforces nothing"* — and `npm run build` fails on an over-budget chunk while `build:fast` (the deploy) does not.

**Perf-check accounting.** `budgets.json`'s `perf` block counts repaints on canvases tagged `data-cb-layer`:

```json
"idleRepaintsPerFrame": 0.15,
"offscreenRepaints": 0,
"interactionRepaints": 10
```

**This page has no canvas**, so `scripts/perf-check.mjs` measures nothing here. The chart's own header says so directly: *"Non-negotiables 5 and 6 … are about canvases on the animation frame; this draws once per model change and has nothing to gate."*

**Where the real cost is.** The `useMemo` in `WallMigrationChart` rebuilds the whole model — forward fill, role resolution, spot merge, y range, legend test — whenever `days` or `view` changes, and that memo runs **once per chart on the page**. With a ten-card rail plus the log card that is **eleven models per change**, and on the live path it re-runs once a minute because `nonce + tick` changes the `days` identity for all of them.

Below the memo, the render cost is polyline count: at `range='all'` the big chart is up to **260 segments × (2 role lines + a spot line)**, each split into one `<polyline>` per contiguous run. `thinDividers` and `stampEvery` exist to keep the *chrome* from outnumbering the data at that scale; nothing thins the paths themselves.

**Network cost, steady state, today + Today range + a ten-card rail:**

* At mount: 1 × `/api/walls-range?symbols=…` (the rail), 1 × `/proxy/walls?date=` (the day summary), 1 × `/proxy/walls?symbol=` (the log), 1 × `/proxy/candles-intraday` (the tape), plus 1 × `/api/walls-range?symbol=…&days=1` **only if the tape came back thin**. Four or five requests.
* Every 60 s while visible: all of the above again, `no-store`.
* On an old server without `/api/walls-range`: the rail alone becomes `2 × 10 = 20` requests in waves of 4, and a 5-session range becomes 13.

---

## Gotchas

1. **`?ticker=` is advertised and not implemented.** App.tsx's route comment names it; `LevelLog.tsx` reads only `date`. The ticker is `usePageSymbol()`, which is `localStorage`-backed and app-wide.

2. **Two "still to come" lists name a surface that has shipped.** `LevelLog.tsx` and `wallData.ts` both list the ticker rail (Part E) as unbuilt, thirty lines above the code that mounts it. Trust `TickerRail.tsx`'s and `railStore.ts`'s headers, which claim Part E explicitly.

3. **The call wall is two different colours on one page.** The chart draws it `--color-candle-up` (`#3ddc8e`, green); the rail's head chip draws it `--color-level-cw` (`#4d8cff`, blue). Both are deliberate and documented in their own files, and neither knows about the other.

4. **Switching CORE off changes the model, not just the visibility.** The role model only runs while `cb` is on; turning it off returns both walls to their own recorded series over the full span. The plot can therefore *gain* line where you expected it to lose some.

5. **A wall that is the CORE all session gets no legend chip.** By design — it is already on screen in gold. Its chip would toggle nothing.

6. **`fmtGex`-style ambiguity does not apply here, but `wallStrike` returns `—` for both null and non-finite.** A genuinely missing level and a garbled one look the same in the rail's head.

7. **A minute is not always a minute.** The price line is 1-minute on the single-session view and **5-minute** on every multi-session range and on every rail card. The head line's `× Nm price` is read off the data for exactly this reason — do not assume the point count is a minute count.

8. **The tape and the log spot are never spliced.** `dense` is decided per day, and below 20 samples the whole day falls back to change-only captures. A week can legitimately show four smooth sessions and one staircase.

9. **`days=1` returns the newest session on or before the date.** Without `expectDate`, a Saturday or a holiday silently returns Friday under Saturday's heading. `fetchRailRange` passes it; `fetchWallsRange`'s multi-day call does not (it does not need to — it is asking for a window, not a day).

10. **A long range on an old server draws nothing, on purpose.** `LEGACY_FALLBACK_MAX = 5`, and *"eight hundred requests to draw a chart"* is the reason. The empty state then reads as "no recorded sessions", which is not strictly what happened.

11. **`no-store` everywhere means the Refresh button and the minute tick actually work** — and also that nothing on this page is ever served from `api.ts`'s cache, which is why the rail has no prefetch.

12. **The live tick is off on every multi-session range**, including 5 sessions on today. Only `range === '1'` polls.

13. **Market holidays are not enumerated.** `lastWeekdays` skips weekends only; a holiday just has no rows and is dropped. That is why the fallback asks for `count + 3` candidates.

14. **The rail's `events` are always empty on the fast path.** `/api/walls-range` does not carry them, and `rangeDayToSlice` returns `events: []`. So on any multi-session range — and on any rail card served by `fetchRailRange` — the spot series loses the `spot_at_hit` precision that touch and approach tags would have added.

15. **An empty stored rail is honoured.** Removing everything but the three pinned persists; only a *missing* key falls back to `RAIL_DEFAULT`.

16. **The owner's server copy can overwrite the local one on load,** but only when the response says `stored: true`. A 401, an offline browser or a dead DB all leave the local rail alone — and `lastSaved` is updated first so adopting the server's list does not immediately write it back.

17. **`onExpand` is dead code in this tree.** Nothing passes it, so the `⤢ Expand` button never renders; the log card uses `Card`'s own expand control (`expandId={CARD_ID}`) instead.

18. **`ES_CANDLE_UP` is imported for a wall.** It is `var(--color-candle-up)`, a token whose own comment says it exists so candles match v2 pixel-for-pixel. Moving it for the candles moves the call wall on this page too.

19. **The `plotPad` comment still says 62px.** `MINI_H` was doubled to 124 on 2026-09-04 and that comment was not updated. The arithmetic is unaffected (`124 × 0.08 = 9.92`, so the cap at 8 still binds).

20. **`etOffsetMinutes` falls back to −300 (EST) silently.** If the browser's `shortOffset` format ever changes shape, every session boundary shifts an hour during EDT with no error anywhere.

