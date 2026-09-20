# `/chain` — the option BOOK

**Route:** `/chain` (served at `voltick.cbedge.net/v3/chain`; the router `basename` is `/v3`). **Mounted by:** `src/App.tsx` — `const Chain = lazy(()
=> import('@/pages/Chain'))`, `<Route path="/chain" element={<Chain />} />`. Nothing else mounts it: it is not a `/replay` tab, it is not a board
card, and it has no phone tab. **Rail entry:** `NAV` in `src/shell/Shell.tsx`:

```ts
{
  to: '/chain',
  label: 'Chain',
  icon: '🧾',
  prefetch: ['/api/chains?ticker=SPX&range=all', '/api/expirations?ticker=SPX'],
}
```

placed immediately after `/options-chain` — *"Next to the matrix on purpose — same feed, opposite question."*

**Sources**

| File | Lines | What it owns |
|---|---:|---|
| `src/pages/Chain.tsx` | 613 | The page shell: toolbar, the column/preset popover (`OrderList`, `ArrowBtn`, `AddRow`), the five localStorage keys, the spot-centring scroll effect, `useSecond`/`ago` |
| `src/pages/chain/ChainGrid.tsx` | 629 | The table: one `<table>`, one `<tbody>` per expiry, mirrored wings, the centre spine, the spot row, the ITM/zebra washes, and the per-row Black-Scholes substitution |
| `src/pages/chain/chainColumns.ts` | 475 | The two column registries (18 wing, 8 centre), the five presets, every formatter, tone rule and width, plus `sanitize*` / `resolve*` / `moveKey` |
| `src/pages/chain/chainBook.ts` | 338 | The wire shape of `/api/chains` → `ChainRow[]`, `expiryMeta`, ATM straddle IV, the three URL builders and the three fetches |
| `src/pages/chain/blackScholes.ts` | 215 | `bsGreeks`, `impliedVol` (bisection), `yearsToExpiry` (Intl-resolved ET offset), and the two named model constants |
| `src/pages/chain/useChainBook.ts` | 211 | The data layer: parallel seed + expirations at entry, load-on-expand, the 20 s poll, the generation guard |

Supporting: `src/data/api.ts` (239), `src/data/symbol.tsx` (111), `src/design/primitives/Controls.tsx` (647), `src/design/theme.ts` (471),
`src/design/tokens.css` (716), and `src/pages/optionsChain/format.ts` (169) + `src/pages/optionsChain/marketSession.ts` (142), which this page imports
from the matrix rather than re-spelling.

---

## What it is, in one paragraph

This is the option chain in the sense **thinkorswim and tastytrade** mean it: calls on the left, puts on the right, strikes down the middle,
expirations as collapsible accordion groups, and the quotes themselves in the cells. Each expiry row expands into a strike ladder whose wing columns
are **mirrored** — the same user-chosen list, rendered backwards on the call side — so bid sits against bid and a strike reads across in one movement.
The centre block is the spine: the strike plus whichever **net** columns are switched on (net GEX, net DEX, net OI, net premium…), because a net has
no side and cannot live in a wing. Eighteen wing fields and eight centre fields are individually addable, removable and reorderable, with five presets
to start from, and every bit of that layout persists to `localStorage` — *"because a chain layout is a habit, not a preference you re-set daily."*
Greeks come from the feed by default, or from a one-model Black-Scholes recomputation that also solves IV off the mark wherever the feed sent none,
and that toggle carries the net exposure columns with it. REST plus a 20 s poll; no socket, no canvas.

---

## Why this is a SEPARATE route from `/options-chain`

The `Chain.tsx` header states it directly:

> `/v3/options-chain` is not this. It is a **GEX MATRIX** — one column per expiration across a shared strike axis, every cell a derived exposure
> painted by a heat skin. It answers **"where is the gamma"**. This page answers the other question a chain is opened for: **"what is this contract
> quoted at, how liquid is it, and what are its greeks"**. One surface cannot do both without one of them becoming a mode of the other, and **a mode is
> where a page goes to be half of two things**. They share the FEED (`/api/chains`) and nothing else — and where they both compute a net exposure, this
> page uses the matrix's formulas verbatim so one strike cannot read two numbers on two pages.

`App.tsx` repeats the same claim beside the `lazy()`:

> `/chain` — THE OPTION CHAIN, in the thinkorswim / tastytrade sense: calls and puts either side of a strike column, expirations as collapsible groups,
> and the QUOTES in the cells. Deliberately a separate route from `/options-chain`, which is the GEX matrix and answers a different question.

and `Shell.tsx` again, beside the rail entry:

> Next to the matrix on purpose — same feed, opposite question. `/options-chain` is the GEX heat grid; this is the BOOK (bid/ask/mark, volume, OI, IV
> and the greeks, calls and puts either side of the strike).

`chainBook.ts` makes the *data-layer* half of the split explicit:

> This is NOT the GEX matrix's data layer. `pages/optionsChain/useChainData.ts` collapses a chain down to ONE number per strike per expiry (a greek)
> because that page is a heat grid. This page is the BOOK: every quote field the feed carries, per side, per strike — because a trader reading an option
> chain is reading the quotes, not a derived exposure.

### What they share, and what they do not

| | `/options-chain` | `/chain` |
|---|---|---|
| Question | where is the gamma | what is this contract quoted at |
| Feed | `/api/chains`, `/api/expirations` | **the same two** |
| Shape | one column per expiry, shared strike axis, heat-painted cells | calls \| strike · net \| puts, one accordion `<tbody>` per expiry |
| Per strike | ONE derived number (the active greek) | every quote field the feed carries, per side |
| Expiry picker | a fixed window of 14 sequential expiries | the **accordion is the picker** — several open at once |
| Colour | heat skins across the whole grid | none; tone is per-cell and semantic only |
| Greeks | the feed's, always | feed **or** Black-Scholes, a labelled toggle |
| Replay | yes — the whole grid rewinds | **no** |
| Poll | 60 s, all columns | 20 s, **expanded expiries only** |
| Net exposures | the ⅀ Total column and the heat scale | the centre block, using **the matrix's formulas verbatim** |

The net-exposure formulas are transcribed rather than re-derived precisely so the two pages cannot disagree — see **The centre columns** below.

---

## The six decisions (from the page header)

1. **The layout is the user's — which columns, and IN WHAT ORDER.** Eighteen wing fields and eight centre (net) fields, five presets to start from,
   and every list is reorderable. *"It all persists, because a chain layout is a habit, not a preference you re-set daily."*
2. **The strike window is bounded by default.** *"SPX lists hundreds of strikes per expiry and a chain that renders all of them on open is a page that
   takes a second to paint before you have asked it anything. 40 around ATM opens; 'All' is one click and is an explicit choice."*
3. **The accordion IS the expiration picker.** There is no dropdown: expiries are rows, several can be open at once, and each loads when it is opened.
   *"That is the ToS/tasty behaviour and it is also the only shape that lets two expiries be compared without leaving the page."*
4. **Greeks have a source, and it is visible.** Feed by default; Black-Scholes recomputes every greek — *and every net exposure built on them* — from
   one model, solving IV off the mark wherever the feed sent none. *"It is a labelled toggle, never a silent substitution."*
5. **Every number says when it was collected.** One clock in the toolbar for the page, and one on EACH open expiry row, *"because only expanded
   expiries poll — a single stamp would claim a freshness the collapsed rows do not have."*
6. **It follows the board symbol.** Like every other v3 page — the toolbar owns the ticker (`data/symbol.tsx`) and this page carries no ticker box.

*"REST + a 20s poll, no socket, no canvas: non-negotiables 2, 4, 5 and 6 have nothing to bite on here. The entry load is two parallel requests (#3)."*

---

## The data path

### Endpoints

| Endpoint | Built by | Params | Stale window | When |
|---|---|---|---|---|
| `/api/chains?ticker={SYM}&range=all` | `seedUrl(symbol)` | no `expiration` — the proxy answers with the **nearest three** expirations in one payload | **`SEED_STALE_MS = 15_000`** | Once at entry, in parallel with the expirations list |
| `/api/chains?ticker={SYM}&expiration={ISO}&range=all` | `expiryUrl(symbol, exp)` | + `&noCache=1` when busting | `0` (the `get` default) | When an expiry is expanded, on each 20 s poll of an open expiry, and on `↻ Now` |
| `/api/expirations?ticker={SYM}` | `expirationsUrl(symbol)` | — | **`30_000`** | Once at entry, in parallel with the seed |

`get()` is the same shape the matrix uses — *"Every one answers null rather than throwing: a chain that fails to load shows its own message in the row
it belongs to, and one bad expiry must not take the page down with it."*

### Why the seed carries a stale window

```ts
/**
 * The seed carries a STALE WINDOW rather than staleMs 0, because the rail
 * prefetches this exact URL on hover (NAV.prefetch in shell/Shell.tsx). With no
 * window the page's own call would bypass the warmed entry and the prefetch
 * would be a request nobody reads. Refreshing goes through `bust`, which is a
 * different URL and therefore a different cache key.
 */
const SEED_STALE_MS = 15_000
```

That is the entire contract between `NAV.prefetch` and this page. The rail hovers, `preload('/api/chains?ticker=SPX&range=all')` fires, the entry
lands in `api.ts`'s `cache` Map, and 15 seconds later the click still reads it back instead of re-requesting. `Shell.tsx` says the same thing from its
side: *"Both prefetches are the page's ACTUAL entry pair, and the seed carries a stale window so the warmed entry is read back rather than stepped
over."*

### Entry: two requests, no waterfall

```ts
const [seed, list] = await Promise.all([fetchSeed(ticker), fetchExpirations(ticker)])
```

* **No waterfall at entry (v3 non-negotiable #3).** *"The seed — `/api/chains` with no `expiration` — carries the nearest three expiries in one
  payload, so the front expiry is on screen off the first response and the expiration list only decides what the ACCORDION offers, not what is
  drawn."*
* Merge order: *"The listing is authoritative for WHAT the symbol trades; the seed is authoritative for what is already loaded. A seed expiry missing
  from the listing still gets a row rather than being dropped."*
* The front expiry (`seed.books[0]?.expiration ?? ordered[0]?.value`) is opened immediately. *"A front expiry the seed did not carry (a symbol whose
  nearest listing the no-expiration call skipped) is fetched rather than opened empty."*

### Response shape

```
{ data: { underlyingPrice, rootSymbol, items: [
    { "expiration-date": "2026-09-11", strikes: [
        { "strike-price": "6500", call: {…}, put: {…} } ] } ] } }
```

and each side carries exactly:

```
symbol · streamer-symbol · open-interest / openInterest · volume ·
delta · gamma · theta · vega · implied-volatility · bid · ask · mark · last
```

`last` **landed 2026-09-08 (Brandon)** — *"the one field this page needed that the proxy was not already mapping."* `server-v2/proxy-tastytrade.js`'s
`fetchOptionMarketData` maps TastyTrade's `last` and `fetchChainFull` writes it onto each call/put.

> There is still **no previous close** on the wire, so there is **NO Net Change column**: *"it would have to be measured against `mark` under a
> different heading, and two columns showing the same number under two names is worse than one honest column."*

### Parsing (`parseChainPayload`)

* One `ChainBook` per expiration group in the payload. **Groups with no parseable strike are dropped** — *"an empty column is a lie the accordion
  would show as 'loaded, no strikes'."*
* `fetchedAt = Date.now()` is taken **once per payload**, not per book — *"they came off one response, and stamping each book as it is built would
  spread them by a millisecond or two for no reason."*
* `toQuote` fills `mark` from the feed, then falls back to `(bid + ask) / 2`. *"Same ladder the matrix uses… A one-sided quote still yields half the
  spread rather than a zero, which is what a book with no bid actually means."*
* `last` reads `o['last'] || o['last-price']`.
* `oi` reads `open-interest` then `openInterest`; both `volume` and `oi` are `Math.round`ed.
* `iv` is a **decimal** — `0.124` is 12.4%.
* A missing side yields `EMPTY_QUOTE` with `live: false`; every wing column reads `q.live` first, so an absent side renders `·` rather than zeros.
* Rows are sorted ascending by strike; books sorted ascending by expiration.
* Per-book aggregates: `callOi`, `putOi`, `callVol`, `putVol`, and `atmIv`.

### `atmIv` — the header's straddle IV

`atmIvOf(rows, spot)`: find the row with the smallest `|strike − spot|`, take `[call.iv, put.iv]`, drop any `≤ 0`, and average what is left. 0 when
unquoted. *"The straddle IV at the nearest strike — the number a chain header quotes."*

### `expiryMeta(value)`

```
label   = "Fri Sep 11"     (WEEKDAYS[dow] + MONTHS[m] + dom, read at NOON UTC)
dte     = max(0, round((expiry − todayET) / 86_400_000))   — CALENDAR days
monthly = dow === 5 && dom >= 15 && dom <= 21              — the third Friday
```

*"Both dates are read at NOON UTC deliberately. '2026-07-01' parsed as local midnight in a negative offset is Jun 30, and an expiry row headed with
the wrong weekday is the single most confusing thing a chain can print."* "Today" comes from `etDateKey(etToday())` — imported from the matrix's
`marketSession.ts`, not re-spelled.

### The poll

```ts
const POLL_MS = 20_000
setInterval(() => {
  if (document.visibilityState === 'hidden') return
  const live = ticker === 'SPX' ? isSpxFeedLive() : isSessionLive()
  if (!live) return
  for (const exp of openRef.current) void load(exp, false)
}, POLL_MS)
```

* **20 s**, chosen against the server: *"Quotes drift all session; 20s sits inside the server's own 30s chain cache, so repeats across clients are
  absorbed there rather than hitting the feed."*
* **Only expanded expiries poll.** That is the whole reason for the per-expiry clock (decision 5).
* Hidden tabs are skipped, *"for the same reason `api.ts` skips them."*
* SPX rides `isSpxFeedLive()` (Sunday 20:00 ET → Friday 16:00 ET, minus the daily 16:00–18:00 ET maintenance break, Saturday closed); everything else
  rides `isSessionLive()` (09:30–16:00 ET on a trading day). *"After the bell the book is frozen and re-asking is pure egress."*

### Failure behaviour

* `error` is set **only when there is nothing on screen** — `"No chain returned for {TICKER}."`, set when the seed carried no books AND the listing
  was empty. It renders as a thin banner under the toolbar, `background: alpha(T.red, 0.1)`, `color: T.red`, `text-2xs`.
* **The old book stays on screen.** *"A poll that fails, or a refetch in flight, never blanks a loaded expiry — it repaints when the new one lands.
  Same rule `data/api.ts` applies to a failed poll, for the same reason."* `load()` only writes when `book` is truthy, and clears `error` on success.
* An open expiry that came back with nothing renders its own row message (see **Status messages**).
* `fetchExpiry` falls back: `parsed.books.find(b => b.expiration === expiration) ?? parsed.books[0] ?? null`. *"The proxy echoes the requested date,
  but a payload that omits it still parses — take whatever single group came back rather than dropping it."*

### The generation guard

```ts
const genRef = useRef(0)
```

Bumped on every ticker change; every async result checks it before writing state. *"A response for the PREVIOUS ticker can never paint under the new
one — the book map is keyed by expiration alone, with no symbol in the key, which is exactly the shape that goes wrong silently. (The GEX matrix
carries the same guard on its ΔOI snapshot, for the same reason.)"*

`openRef` and `booksRef` mirror the state because `toggle` and the poll *"must not branch on state it closed over — and must not put a fetch inside a
state updater, which React may run twice."*

---

## Panel by panel

### 1. The toolbar

A single flex-wrap row: `flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-bg px-2.5 py-1.5`.

| Element | Content | Notes |
|---|---|---|
| Symbol | `{symbol}` | `text-sm font-bold tracking-wide text-fg` |
| Spot | `spot.toFixed(2)` or `—` | `tabular text-sm font-semibold`, `T.cyan` |
| Page name | `Option chain` | `text-3xs uppercase tracking-[0.16em] text-fg` |
| Divider | 1px × 16px | `background: T.border` |
| `Strikes` | `SegGroup` over `WINDOWS` | see **controls** |
| `Expiries` | `SegGroup` over `EXPIRY_COUNTS` | |
| `Greeks` | `SegGroup` over `GREEK_SOURCES` | `Feed` / `B-S` |
| Columns button | `{preset label}` or `{n} cols` | opens the layout `Popover` |
| Clock (`ml-auto`) | `⟳ {HH:MM:SS} ET · {n}s ago` | only when `updatedAt > 0` |
| `↻ Now` | `↻ …` while refreshing | disabled when refreshing **or when no expiry is open** |

The clock's title: `Collected at {HH:MM:SS} ET · polls every 20s while the session is live`. `↻ Now`'s title: `Re-fetch every expanded expiry,
bypassing the server cache`.

`ago(ms, now)` renders `{n}s ago` under a minute, `{n}m ago` under an hour, `{n}h ago` beyond. It ticks off `useSecond(c.updatedAt > 0)` — a 1 s
interval that **skips its work while the tab is hidden**: *"a background tab counting seconds nobody can see is a wakeup a minute for no reason."*

**Every glyph on this page is FULL WHITE (Brandon, 2026-09-08)** — `const INK = T.text`, in both `Chain.tsx` and `ChainGrid.tsx`. *"No opacity
step-down on a label, a clock or a list index. Hierarchy is carried by size and weight off the type scale instead."*

### 2. The layout popover (`Popover`, `align="left"`, `w-64`)

Four `PanelSection`s.

* **`Preset`** — a `Chip` per entry in `CHAIN_PRESETS`. `activePreset` is computed by joining both key lists and comparing, so the button label shows
  a preset name only while the layout matches it exactly; otherwise it shows `{n} cols`.
* **`Wing columns · top = nearest the strike`** — an `OrderList` plus an `AddRow` of the remaining fields.
* **`Centre columns · net, per strike`** — same pair, with `empty="None — the middle is just the strike."`
* **`Display`** — three `Chip`s: `Zebra`, `ITM shade`, `Grid lines`.

The editor is deliberately **two different controls**:

> ORDER is a list with arrows, because order is a sequence and a grid of chips cannot show one. MEMBERSHIP is a chip row, because it is a set. A single
> drag-and-drop widget would do both and would also be the one control on this page that does not work from a keyboard.

`OrderList` rows show a 1-based index, the label (title = the column's tooltip), then `▲` *Move nearer the strike*, `▼` *Move further out*, `✕`
*Remove this column*. `moveKey` returns **the same array reference** when nothing moved — *"so a click on a disabled arrow cannot cause a re-render of
the whole grid."*

Two membership rules:

* **The last wing column may not be removed.** *"A chain with no wing columns is a list of strikes, and there is no cell left to click back from."*
  (`if (has && columnKeys.length === 1) return`.)
* **Centre columns have no such floor — empty is their default** (`DEFAULT_CENTER = []`).

A newly added wing column is **appended**, so *"a new column lands on the OUTSIDE of both wings and the columns already being read do not move under
the cursor."*

### 3. The grid — the shape

One `<table className="border-collapse tabular text-xs">` with `tableLayout: 'fixed'`, `width: '100%'`, `minWidth: totalWidth` where

```
totalWidth = Σ(wing widths) × 2 + STRIKE_W + Σ(centre widths)      // STRIKE_W = 84
```

and a `<colgroup>` emitting, in order: reversed wing columns, the strike col, the centre cols, the forward wing columns.

Five properties that are load-bearing, from the header:

* **MIRRORED.** *"The selected wing columns run outward from the strike on BOTH sides, so bid sits against bid and the eye reads a strike across in
  one movement. The call side renders the list reversed."* `callColumns = useMemo(() => [...columns].reverse(), [columns])` — computed once, not per
  group.
* **THE CENTRE BLOCK IS THE SPINE.** *"Strike, plus whichever NET columns are on… It carries its own plate and a rule down each edge, so the eye can
  find the middle of a fifteen-column table without counting. A net has no side, which is why it cannot live in a wing."*
* **ITM IS SHADED, not coloured, and the shade is TRANSLUCENT** so the zebra and the row hover still read through it. *"A saturated fill would fight
  the tone colours the columns already use."*
* **THE SPOT LINE IS A ROW.** *"It is drawn BETWEEN the two strikes that bracket the underlying rather than on the nearest one, because that is where
  the price actually is; the nearest strike is separately marked ATM."*
* **ONE TABLE, MANY BODIES.** *"Every expiration is a `<tbody>` in the SAME table, which is what keeps the columns aligned across groups — the thing a
  stack of per-expiry tables cannot do."*

### 4. The header rows (both sticky)

Row 1 — three spanning cells, `height: 22`, `sticky top-0 z-20 bg-surface2`, `text-3xs font-bold uppercase tracking-[0.18em]`:

* `Calls` over `colSpan={wingCols}`, `text-muted`
* `Strike` or **`Strike · Net`** (when centre columns are on) over `colSpan={1 + center.length}`, in `T.cyan`, with `SPINE` on both edges
* `Puts` over `colSpan={wingCols}`, `text-muted`

Row 2 — the column labels, `sticky top: 22`, `height: 24`, `bg-surface` for the wings and `T.panel` for the strike/centre cells, each carrying the
column's `title` as its tooltip. The strike header cell is a deliberate `&nbsp;`.

`SPINE = 1px solid T.border` runs down both edges of the centre block; the last centre column carries the right-hand spine.

### 5. The expiry row (`ExpiryHeaderRow`, `memo`'d)

*"A button, not a div with a click handler: it is the page's primary control and it has to be reachable from the keyboard."* `aria-expanded={open}`,
`height: 26`, `bg-surface2 hover:bg-raised`, spanning `totalCols`.

Left to right:

| Element | Content |
|---|---|
| Caret | `▾` open / `▸` closed, `T.cyan`, `width: 10` |
| Label | `exp.label` — `Fri Sep 11` |
| DTE | `0DTE` when `dte === 0`, else `{dte}d` |
| Monthly badge | `M` on an orange chip (`alpha(T.orange, 0.18)` / `T.orange`), title `Standard monthly — third Friday` |
| Loading | `loading…` in `T.cyan` while the expiry has a request in flight |
| **(right, `ml-auto`, only when the book is loaded)** | |
| ATM IV | `IV {(atmIv*100).toFixed(1)}%` — omitted when 0 |
| OI split | `OI {compact(callOi)}c / {compact(putOi)}p` |
| P/C ratio | `P/C {(putOi / callOi).toFixed(2)}` — omitted when `callOi === 0`; title `Put/call open-interest ratio for this expiry` |
| Volume | `Vol {compact(callVol + putVol)}` |
| **Per-expiry clock** | `⟳ {HH:MM:SS}` in ET, title `This expiry's data was collected at {…} ET` |

`compact(v)` → `{x.x}M` ≥ 1e6, `{x}K` ≥ 1e3 (zero decimals), else the rounded integer.

The per-expiry clock is decision 5 made concrete: *"Per-expiry rather than one page clock: only the expanded rows poll, so a single stamp would claim
a freshness the others do not have."*

`etClock(ms)` is `toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour/minute/second: '2-digit', hour12: false })` — *"the session's own
timezone, not the reader's."* It returns `—` for 0 and for a throw.

### 6. The strike rows

`StrikeRows` does four things:

1. `windowRows(book.rows, spot, strikeWindow)` — the N strikes closest to spot, **in strike order**. It finds the nearest index, takes `half =
   floor(count/2)` below it, clamps `start` to `[0, rows.length - count]`, and slices. `count === 0` → every row.
2. `locateSpot(rows, spot)` → `{ atmStrike, spotIndex }`. `atmStrike` is the smallest `|strike − spot|`; `spotIndex` is the index of the **first row
   whose strike is above spot**, defaulting to `rows.length`. Both derived from the **windowed** rows *"so a scrolled-away spot does not leave a
   marker pointing at nothing."*
3. `tYears` — `yearsToExpiry(book.expiration)` when the source is `bs`, else 0. Its dep array is `[book.expiration, book.fetchedAt, greekSource]`:
   *"Re-measured whenever the book reloads, so theta on a 0DTE contract keeps shortening through the session instead of freezing at the value it
   opened on."*
4. Emits the rows, inserting `<SpotRow>` at `spotIndex` (or appending it when `spotIndex >= rows.length`, i.e. spot is above every windowed strike).

Each `StrikeRow` (also `memo`'d):

* `hover:bg-raised`; zebra applies to **odd indices** of the windowed list (`display.zebra && i % 2 === 1`), `ZEBRA_BG`.
* `callItm = display.itm && spot > 0 && row.strike < spot`; `putItm = … row.strike > spot`.
* The strike cell: `px-1 text-center text-xs font-bold`, `borderLeft: SPINE`, ink `T.cyan` and background `alpha(T.cyan, 0.14)` when ATM, otherwise
  ink `INK` and background `STRIKE_BG`. Integers print bare, fractions to 2dp.
* Wing cells come from `Cell`, which builds a `CellCtx = { strike, spot, side }`, calls `col.read(q, ctx)`, and renders `·` when the result is `null`
  or non-finite. Ink is `col.tone?.(v, ctx) ?? INK`; `ITM_BG` when the wing is in the money; `COL_LINE` on the left edge when `Grid lines` is on
  (never on the first column of a wing).
* Centre cells call `c.read(eff, spot)`, render `·` when null/non-finite, and take `CENTER_BG` plus the spine on the last one.

### 7. The spot row (`SpotRow`)

An `aria-hidden` `<tr>` whose single `<td colSpan={totalCols}>` carries **`data-cb-spot=""`** — the hook the page's centring effect looks for. It is a
12px-tall flex row: a 1px cyan rule (`alpha(T.cyan, 0.55)`), the price on a `alpha(T.cyan, 0.16)` chip in `T.cyan` (`text-3xs font-bold tabular`),
then another rule.

### 8. Centring on spot

```ts
const key = `${symbol}|${c.open.join(',')}`
if (centredFor.current === key) return
requestAnimationFrame(() => {
  const marker = box.querySelector('[data-cb-spot]')
  const delta = marker.getBoundingClientRect().top - box.getBoundingClientRect().top
  box.scrollTop = Math.max(0, box.scrollTop + delta - box.clientHeight / 2)
})
```

*"The scroll container opens at the top, which on a 40-strike window is 20 strikes above the money. The spot row is tagged in the grid; this finds it
after the first book lands and centres it, and does not fight the user afterwards."*

**Measured, not `offsetTop`:** *"the scroll container is not a positioned ancestor, so `offsetTop` would be relative to something further up the tree
and the page would jump to the wrong place."*

---

## Every wing column

Eighteen, in registry order. Each reads ONE side of a strike. `read` returns `null` for "nothing to show" and the grid draws `·` rather than a 0. All
of them gate on `q.live` first, so an absent side is blank everywhere.

| Key | Head | Width | Formula | Format | Tone |
|---|---|---:|---|---|---|
| `bid` | `Bid` | 58 | `q.bid` | 2dp | — |
| `ask` | `Ask` | 58 | `q.ask` | 2dp | — |
| `mark` | `Mark` | 58 | `q.mark` (feed mark, else the bid/ask mid) | 2dp | — |
| `last` | `Last` | 58 | `q.last > 0 ? q.last : null` | 2dp | `T.cyan` **always** |
| `spread` | `Sprd` | 52 | `ask − bid`, only when both `> 0` | 2dp | — |
| `spreadPct` | `Sprd%` | 54 | `((ask − bid) / mark) × 100` | 1dp + `%` | `T.orange` when `≥ 10` |
| `iv` | `IV` | 58 | `q.iv × 100`, only when `iv > 0` | 1dp + `%` | — |
| `delta` | `Δ` | 56 | `q.delta` — **the feed sign, so puts read negative** | 3dp | green `>0` / red `<0` |
| `gamma` | `Γ` | 60 | `q.gamma` — per $1 of underlying | 4dp | — |
| `theta` | `Θ` | 56 | `q.theta` — decay per day, per contract | 2dp | green/red |
| `vega` | `ν` | 54 | `q.vega` — dollars per 1 point of IV | 2dp | — |
| `volume` | `Vol` | 62 | `q.volume` | integer, `en-US` grouped | — |
| `oi` | `OI` | 66 | `q.oi` — settled, as of the prior close | integer, grouped | — |
| `volOi` | `V/OI` | 52 | `volume / oi`, only when `oi > 0` | 2dp | `T.cyan` when `≥ 1` |
| `premium` | `Prem` | 66 | `mark × volume × 100`, only when both `> 0` | `fmtMoney` with the leading `+` stripped | — |
| `extrinsic` | `Extr` | 58 | `max(0, mark − intrinsic)` | 2dp | — |
| `itm` | `ITM%` | 54 | `\|delta\| × 100`, only when `delta ≠ 0` | 0dp + `%` | — |
| `breakeven` | `B/E` | 72 | call: `strike + mark`; put: `strike − mark` | integers bare, else 2dp | — |

where

```ts
intrinsic(ctx) = side === 'call' ? max(0, spot − strike) : max(0, strike − spot)
```

Column tooltips carry the reasoning, verbatim:

* `Last` — *"Last traded price — an actual print, not a quote. Blank means the contract has not traded today, which on a wing strike is normal."*
  `read` returns `null` at 0 rather than falling back to mark: *"0 is 'no print', not 'printed at zero' — the placeholder is the honest rendering."*
  Its tone is unconditional cyan, *"to say 'this is a trade, not a quote'."*
* `Sprd%` — *"Spread as a percentage of the mark — the liquidity read."* The `≥ 10` flag: *"Above 10% of the mark the round trip costs more than most
  edges. Flagged rather than hidden: a wide market is information, not an error."*
* `IV` — *"With the greek source on Black-Scholes this is the SOLVED vol wherever the feed sent none."*
* `Vol` — *"Contracts traded today. Zeroed before 09:30 ET — the feed's running total is still yesterday's until the bell."*
* `V/OI` — *"Above 1 means more contracts traded than were open — new positioning, not a churn of the existing book."*
* `Extr` — *"Extrinsic (time) value = mark − intrinsic. This is what decays."*
* `ITM%` — *"Rough probability of finishing in the money — |delta| × 100, the desk shorthand."*
* `B/E` — *"Breakeven at expiry for a long single: strike ± mark."*

### Why the quote formatters are local

`chainColumns.ts` defines `price`, `int` and `pct1` locally rather than importing them:

> `optionsChain/format.ts` writes GEX dollars — always signed, always compact — which is the opposite of what a QUOTE column wants: a bid of 1.35 must
> read "1.35", not "+$1". The centre columns ARE exposure dollars, so those import `fmtMoney`/`fmtCount` from that file rather than growing a second
> spelling of the same number.

---

## Every centre column

Eight. Each reads the **whole strike** (`ChainRow`) plus the live `spot`.

```ts
const contracts = (q: OptionQuote): number => q.oi + q.volume
```

| Key | Head | Width | Formula | Format | Tone |
|---|---|---:|---|---|---|
| `netGex` | `Net GEX` | 82 | `(γc·cc − γp·pc) · S² · 0.01 · 100` | `fmtMoney` | green/red |
| `netDex` | `Net DEX` | 82 | `(\|Δc\|·cc − \|Δp\|·pc) · S · 100` | `fmtMoney` | green/red |
| `netChex` | `Net CHEX` | 82 | `(−θc·cc + θp·pc) · S · 100` | `fmtMoney` | green/red |
| `netVex` | `Net VEX` | 82 | `(νc·cc − νp·pc) · S · 100` | `fmtMoney` | green/red |
| `netOi` | `Net OI` | 70 | `callOI − putOI`, null when both sides are 0 | `fmtCount`, with a `+` prefixed when positive | green/red |
| `netVol` | `Net Vol` | 70 | `callVol − putVol`, null when both are 0 | same | green/red |
| `netPrem` | `Net Prem` | 82 | `(markC·volC − markP·volP) × 100`, null when both legs are 0 | `fmtMoney` | green/red |
| `totPrem` | `Tot Prem` | 82 | `(markC·volC + markP·volP) × 100`, null when `≤ 0` | `fmtMoney` with the `+` stripped | — |

All four exposure columns return `null` when `spot <= 0`. `signTone(v)` is `T.green` above 0, `T.red` below, `undefined` at 0 (so a zero keeps `INK`).

**The four exposure formulas are transcribed from `pages/optionsChain/chainMath.ts` VERBATIM, contract basis included:**

> …so a strike reads the SAME net GEX on this page as it does on the matrix. Re-deriving them "the same way" is exactly how one strike ends up carrying
> two numbers on two pages.

with one difference that is the whole point of the greek toggle:

> With the greek source set to Black-Scholes the grid hands these MODEL greeks instead of the feed's, so the net columns follow the toggle too — the
> whole point of having one.

Note the contract basis here is **`OI + volume` only**. `/chain` has no Vol-Only / OI-Only switch; that lives on the matrix.

---

## Black-Scholes: when it runs, and what it changes

### The toggle

`Greeks` → `Feed` (default) or `B-S`. With the source on Feed, **nothing in `blackScholes.ts` runs at all**. The `B-S` chip's tooltip is built from
the constants:

```
Black-Scholes, recomputed against the live spot at r 4.0% / q 1.2%. Solves IV off the
mark where the feed sent none, and the net exposures follow.
```

### The three cases it exists for

From the file header:

* *"a strike the market-data batch came back empty for, so every greek is 0 but the contract is real and quoted;"*
* *"after hours, where the greeks freeze at the close while the underlying has moved — a model re-priced against the CURRENT spot is the more honest
  number;"*
* *"anything where you want one consistent model across every strike rather than a vendor's, which is the point of a 'Black-Scholes' toggle at all."*

*"It is a CHOICE on the page, never a silent substitution."*

### The two assumptions

```ts
/** Risk-free rate, continuously compounded. Change it here. */
export const BS_RATE = 0.04
/** Continuous dividend yield. 1.2% is the S&P's; change it here. */
export const BS_DIV_YIELD = 0.012
```

> A model needs a discount rate and a carry, and neither is on the wire. They are named constants right here, and **CHANGING THEM IS A ONE-LINE EDIT
> IN THIS FILE** — deliberately not scattered through call sites, and **deliberately not buried in a settings panel where a stale value would go
> unnoticed for months.**

*"European exercise, cash settlement, continuous dividend yield: SPX/NDX/RUT to the letter, and close enough on an American equity option that the
greeks read correctly (early exercise moves deep-ITM puts, mostly)."*

### Where the substitution happens

**Once per ROW**, in `StrikeRow`:

```ts
const eff = useMemo<ChainRow>(() => {
  if (greekSource !== 'bs' || !(spot > 0) || !(tYears > 0)) return row
  return {
    strike: row.strike,
    call: modelQuote(row.call, 'call', spot, row.strike, tYears),
    put:  modelQuote(row.put,  'put',  spot, row.strike, tYears),
  }
}, [row, greekSource, spot, tYears])
```

> Applied at the ROW, once, so the wing cells and the centre block's net exposures are computed from the same greeks. **A column that quietly used the
> feed's gamma while the net GEX beside it used the model's would be the worst of both.**

`modelQuote` bails out three ways, each leaving the feed quote untouched:

```ts
if (!q.live) return q
const iv = q.iv > 0 ? q.iv : impliedVol(side, S, K, T, q.mark)   // ← the solve
if (!(iv > 0)) return q
const g = bsGreeks(side, S, K, T, iv)
if (!g.gamma && !g.delta) return q
return { ...q, iv, delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega }
```

The solve is the case the toggle exists for: *"a strike the market-data batch missed has zeroes for every greek AND for IV, and without this it would
stay blank under Black-Scholes too."* Note it **overwrites `iv` as well**, which is why the `IV` column's tooltip says it becomes the solved vol.

`bid`, `ask`, `mark`, `last`, `volume` and `oi` are **never** touched — they are quotes, not model output.

### The model

| Quantity | Formula | Unit |
|---|---|---|
| `d1` | `(ln(S/K) + (r − q + σ²/2)·T) / (σ√T)` | — |
| `d2` | `d1 − σ√T` | — |
| `gamma` | `e^(−qT)·φ(d1) / (S·σ·√T)` | per $1 of S, both sides |
| `vega` | `S·e^(−qT)·φ(d1)·√T / 100` | **per 1 vol point**, matching the feed |
| `decay` | `−(S·e^(−qT)·φ(d1)·σ) / (2√T)` | shared term |
| call `delta` | `e^(−qT)·N(d1)` | |
| call `theta` | `(decay − r·K·e^(−rT)·N(d2) + q·S·e^(−qT)·N(d1)) / 365` | **per day**, matching the feed |
| call `price` | `S·e^(−qT)·N(d1) − K·e^(−rT)·N(d2)` | |
| put `delta` | `−e^(−qT)·N(−d1)` | |
| put `theta` | `(decay + r·K·e^(−rT)·N(−d2) − q·S·e^(−qT)·N(−d1)) / 365` | per day |
| put `price` | `K·e^(−rT)·N(−d2) − S·e^(−qT)·N(−d1)` | |

Guard: `if (!(S>0) || !(K>0) || !(T>0) || !(iv>0)) return ZERO`.

`N(x) = 0.5 · (1 + erf(x / √2))`, with `erf` from **Abramowitz & Stegun 7.1.26** — *"max error 1.5e-7, which is four more digits than any of these
columns prints."* `phi(x) = e^(−x²/2) / √(2π)`.

### `impliedVol` — bisection, not Newton

```
lo = 0.001, hi = 5     → 60 halvings
if price(hi) < price → 0      // above what the model can produce
if price(lo) > price → 0      // below it
```

> BISECTION, not Newton. **Newton is faster and diverges exactly where this is needed most** — a deep wing where vega is nearly zero, which is precisely
> the strike whose feed IV came back empty. Bisection over [0.1%, 500%] cannot diverge, and 60 halvings of that range land inside 1e-16, so the "slow"
> method costs about sixty `exp()` calls on the handful of strikes that need it.

It returns **0** when the price is outside what the model can produce at any vol — *"an arbitrage-violating quote, or a stale mark — rather than a
made-up number."*

### `yearsToExpiry`

```ts
const YEAR_MS = 365 * 86_400_000
const MIN_T   = 1 / (365 * 24 * 60)    // one minute, in years
```

Years from now to **16:00 ET on the expiry date**, floored at `MIN_T` — *"A 0DTE contract at 15:59 still needs a positive T."*

The ET offset is resolved through `Intl.DateTimeFormat` (`etOffsetMinutes`) rather than assumed:

> "2026-09-11T20:00Z" is 16:00 in September and 15:00 in December, and **a T that is an hour wrong on a 0DTE contract is a theta that is wrong by a
> fifth.**

`etOffsetMinutes` also normalises `hour % 24` — *"Intl emits hour 24 for midnight under `hour12: false` in some engines."*

---

## Every control

| Control | Options | Default | Where the state lives |
|---|---|---|---|
| Board ticker (app toolbar) | any `PAGE_TICKER_RE` symbol | `SPX` | `localStorage` `cb-v3-page-symbol` (`data/symbol.tsx`) |
| `Strikes` | `20` / `40` / `80` / `All` (value `0`) | **`40`** | `localStorage` **`cb-v3-chain-window`** — the raw string; only applied on load if it matches a known option |
| `Expiries` | `6` / `12` / `30` / `All` (value `0`) | **`12`** | React state only — **not persisted** |
| `Greeks` | `Feed` / `B-S` | **`feed`** | `localStorage` **`cb-v3-chain-greeks`** — `'feed'` or `'bs'` |
| Wing columns (membership + order) | 18 keys | `CHAIN_PRESETS[0].columns` = `['bid','ask','mark','last','iv','delta','volume','oi']` | `localStorage` **`cb-v3-chain-columns`** — a JSON array of keys |
| Centre columns (membership + order) | 8 keys | `[]` | `localStorage` **`cb-v3-chain-center`** — a JSON array of keys |
| `Zebra` / `ITM shade` / `Grid lines` | booleans | `{ zebra: true, itm: true, lines: false }` | `localStorage` **`cb-v3-chain-display`** — `{"zebra":bool,"itm":bool,"lines":bool}` |
| Preset chips | `Standard` / `Greeks` / `Liquidity` / `Exposure` / `Analysis` | — | writes both column keys at once |
| Expiry row | expand / collapse | the front expiry is open at entry | React state (`open`), mirrored in `openRef` |
| `↻ Now` | re-fetch every open expiry with `&noCache=1` | — | transient `refreshing` state |

Nothing on this page lives in the query string, and nothing is stored server-side.

### The storage contract

```ts
function readStored(key, fallback)  // try/catch → fallback
function writeStored(key, value)    // try/catch → "private mode — the choice still holds for this session"
function readJson(key, parse, fallback)
```

`readJson` swallows a parse error because *"A corrupt layout falls back to the default rather than blanking the page."* Both sanitizers drop unknown
keys and duplicates — *"a stored layout from an older build must not be able to crash the grid with a column that no longer exists"* — and
`sanitizeColumns` additionally refuses to return an empty list, where `sanitizeCenter` allows one.

**The first render always uses the defaults**, with the stored layout applied in an effect — *"so the markup cannot mismatch on hydration — the same
rule the GEX matrix applies to its saved heat skin."*

### The presets

*"Five layouts that answer five different questions, rather than one default nobody can change."*

| Key | Label | Wing columns | Centre | Title |
|---|---|---|---|---|
| `standard` | `Standard` | bid, ask, mark, last, iv, delta, volume, oi | — | *The default read — quotes, the last print, IV, delta and the book* |
| `greeks` | `Greeks` | mark, iv, delta, gamma, theta, vega | — | *All four greeks against the mark and IV* |
| `liquidity` | `Liquidity` | bid, ask, spread, spreadPct, last, volume, oi, volOi | — | *What it costs to get in and out* |
| `exposure` | `Exposure` | mark, iv, delta, gamma, volume, oi | netGex, netDex, netOi, netPrem | *The net book at each strike — GEX, DEX and net premium down the middle* |
| `analysis` | `Analysis` | mark, extrinsic, breakeven, itm, iv, delta, oi | — | *Time value, breakeven and the odds* |

`standard` is *"the ToS/tasty default read: what it costs, how volatile, how directional, how much is there."*

### The expiry-count rule

```ts
if (!n || c.expiries.length <= n) return c.expiries
const head  = c.expiries.slice(0, n)
const extra = c.expiries.filter(e => !shown.has(e.value) && c.open.includes(e.value))
return [...head, ...extra].sort(byValue)
```

*"An expiry that is OPEN is always offered, whatever the count — collapsing the ladder must not make a chain you are reading disappear."*

---

## Rendering, layout constants and tokens

### DOM, no canvas

There is **no** `<canvas>`, no `ChartFrame`, no `data-cb-layer`. *"Nothing here paints to a canvas, so non-negotiables 4-6 have nothing to bite on."*

### Virtualisation

There is none, and that is stated as a decision:

> Row count is bounded by the strike window in `Chain.tsx`; **that is what stands in for virtualisation**, and it is why "All" is an explicit choice.

The `All` option's own tooltip says `Every listed strike — slow on SPX`.

### Layout constants

| Constant | Value | Where |
|---|---|---|
| `STRIKE_W` | `84` | `ChainGrid.tsx` |
| Group header height | `22` | header row 1 |
| Column header height | `24` | header row 2, `top: 22` |
| Expiry row height | `26` | `ExpiryHeaderRow` |
| Spot row height | `12` | `SpotRow` |
| Wing column widths | 52–72 | per column in `CHAIN_COLUMNS` |
| Centre column widths | 70–82 | per column in `CENTER_COLUMNS` |
| Popover width | `w-64` (16rem) | the layout editor |
| `POLL_MS` | `20_000` | `useChainBook.ts` |
| `SEED_STALE_MS` | `15_000` | `chainBook.ts` |
| Expirations stale | `30_000` | `fetchExpirations` |

### Plates and rules

All translucent, *"so zebra and hover survive underneath"*:

```ts
const STRIKE_BG = alpha(T.text, 0.075)
const CENTER_BG = alpha(T.text, 0.038)
const ZEBRA_BG  = alpha(T.text, 0.028)
const ITM_BG    = alpha(T.text, 0.05)
const ROW_LINE  = alpha(T.border, 0.6)
const COL_LINE  = alpha(T.border, 0.45)
const SPINE     = `1px solid ${T.border}`
```

*"The centre block is a lighter grey than the rows and the net columns a lighter grey again, so the spine reads as one object with the strike at its
head."*

### INK — the 2026-09-08 rule

```ts
const INK = T.text
```

declared in **both** files, with the reasoning in `ChainGrid.tsx`:

> Every glyph on this grid is FULL WHITE (Brandon, 2026-09-08). No opacity step-down, and **no `--color-flat` grey on the empty-cell placeholder
> either**: on the dark-slate plate a dimmed label reads as smudged rather than as secondary, and a value you have to lean in for is not a faster read.
>
> Hierarchy comes from SIZE and WEIGHT instead — 9/10/11px off the type scale, and semibold on a head — which is the separation that survives at 11px.
> **`design/theme.ts`'s `CHAIN.*` ramp is deliberately NOT imported here**: it is the GEX matrix's ink ladder, tuned for text sitting on a saturated
> heat fill, and these cells have no heat fill under them.

That is the sharpest visual difference between the two chain pages, and it is deliberate.

### Tokens used

| Used as | theme export | Token | Hex in `tokens.css` |
|---|---|---|---|
| Every glyph (`INK`), strike ink, empty `·` | `T.text` | `--color-fg` | `#e7ece9` |
| Accent: spot, spine header, ATM strike, carets, `Last`, `V/OI ≥ 1` | `T.cyan` | `--color-accent` | `#2f6bff` |
| Positive net / delta / theta | `T.green` | `--color-up` | `#3ddc8e` |
| Negative net / delta / theta, the error banner | `T.red` | `--color-down` | `#ff6b7a` |
| Wide-spread flag, the `M` monthly badge | `T.orange` | `--color-warn` | `#ffd166` |
| Header plates | `bg-surface` / `bg-surface2` | `--color-surface` / `--color-surface2` | `#0e1216` / `#141a21` |
| Row hover | `hover:bg-raised` | `--color-raised` | `color-mix(in srgb, #141a21 92%, #e7ece9)` |
| Rules, spine, borders | `T.border` | `--color-line` | `#1e2630` |
| Page canvas | `bg-bg` | `--color-bg` | `#0a0d10` |
| Column-head labels | `text-muted` | `--color-muted` | `#e7ece9` (white today) |

Type sizes are all from the scale: `text-3xs` 9px, `text-2xs` 10px, `text-xs` 11px, `text-sm` 13px. The table root is `text-xs` + `tabular`.

### Per-frame / perf machinery

There is no animation frame loop on this page at all. What there is:

* `ExpiryHeaderRow` and `StrikeRow` are both `memo`'d.
* `callColumns` is memoised once at the grid root rather than per group.
* `windowRows`, `locateSpot` and `tYears` are memoised per expiry body.
* `eff` (the BS substitution) is memoised per row — which is what keeps a 20 s poll from re-solving IV on every strike when nothing about a row
  changed.
* `moveKey` returns the same array reference on a no-op move.
* `useSecond` stops doing work when `document.visibilityState === 'hidden'`.
* `useChainBook` returns a single `useMemo`'d object, so a consumer's identity checks hold.

### Replay

**There is none.** `/chain` has no replay transport, no `ReplayDock` mount, no `ReplayStamp`, and no `/replay` tab. The recorder (`strike_growth`)
stores net GEX per strike, not quotes, so there is nothing to rewind a book from. Replay lives on `/options-chain`.

### CopyShot

This page publishes **no** `CopyShotTarget`s and carries no `data-capture-*` attributes. The toolbar camera therefore offers only its global entries
while `/chain` is open.

---

## Phone behaviour

There is **no `/m/chain` tab**, and no phone build of this page at all.

* `MOBILE_TABS` in `src/mobile/mobileNav.ts` lists six tabs: `gex`, `heat`, `spx`, `em`, `econ`, `alerts`. None of them is a chain.
* The note in that file is about the **matrix**, and applies with at least as much force here: *"The v3 options chain is a strike ladder with up to a
  dozen numeric columns read ACROSS; at 390px it is a horizontal scroll over a table you cannot see two columns of at once, which is not the page, it
  is a picture of the page."* A fifteen-column mirrored book is strictly worse at that width.
* `DESKTOP_TO_MOBILE` has no `/chain` key, so a phone opening `/v3/chain` **is not redirected** — it gets the desktop page. *"Everything else keeps
  rendering its desktop layout, because there is no phone build of it and a cramped real page beats a redirect to an unrelated one."*
* `Chain.tsx` and `ChainGrid.tsx` never call `useIsPhone()`. The page's only narrow-width affordances are the toolbar's `flex-wrap` and the table's
  `minWidth: totalWidth` inside an `overflow-auto` scroller — i.e. it scrolls horizontally.
* `Shell.tsx` still draws the rail and the toolbar here, since this is not an `/m/*` route.

---

## Status and empty-state messages, verbatim

### Page level

| When | Message | Where |
|---|---|---|
| `c.booting` | `Loading {SYMBOL} chain…` | centred, `p-6 text-center text-sm text-fg` |
| `expiries.length === 0` after boot | `No listed expirations for {SYMBOL}.` | same |
| `c.error` set (nothing on screen at all) | `No chain returned for {TICKER}.` | a banner under the toolbar, `alpha(T.red, 0.1)` / `T.red`, `text-2xs` |

### Expiry row level

| When | Message |
|---|---|
| open, no book, request in flight | `Loading chain…` |
| open, no book, nothing in flight | `No chain returned for this expiry.` |
| open, book loaded, window empty | `No strikes in the current window.` |
| a request is in flight for this expiry | `loading…` in the row header, in `T.cyan` |

### In the grid

* `·` — every empty cell, wing or centre, in `INK` (full white, **not** a grey).
* `—` — `etClock(0)` or an unparseable timestamp.
* `0DTE` — an expiry with `dte === 0`; every other expiry shows `{dte}d`.
* `M` — the third-Friday monthly badge.
* `Strike` / `Strike · Net` — the centre group header, depending on whether any centre column is on.
* `Calls` / `Puts` — the two wing group headers.

### Toolbar

* Spot: `{n.nn}` or `—`.
* Clock: `⟳ {HH:MM:SS} ET · {n}s ago` (then `{n}m ago`, `{n}h ago`).
* Refresh: `↻ Now` / `↻ …`.
* Columns button: the active preset's label, or `{n} cols`.

### Layout editor

* `None — the middle is just the strike.` — the centre `OrderList` with nothing selected.
* `None.` — `OrderList`'s generic empty (unreachable for the wings, which have a floor of 1).
* Arrow tooltips: `Move nearer the strike` / `Move further out` / `Remove this column` / `The last wing column cannot be removed`.

---

## Performance and bundle

* **The route is `lazy()`** in `App.tsx` (rule 1: *"A route that is in the entry chunk is a route every user downloads whether they visit it or
  not."*). Its chunk carries `Chain.tsx` + `chain/*` and nothing else — no chart library, no canvas code.
* It **shares no chunk with `/options-chain`**, despite the two importing `format.ts` and `marketSession.ts` in common; those modules end up wherever
  Rollup places the shared dependency, and neither route pulls the other's components.
* `budgets.json` (brotli bytes) — this route is measured against **`route: 59100`**:

  ```json
  "entry":        38900,
  "react":        55000,
  "route":        59100,
  "data":         78000,
  "css":           8500,
  "html":          2600,
  "totalInitial": 108400,
  "ratchet": { "slack": 0.15, "enforce": false }
  ```

  *"These are set close to current reality on purpose — a budget with 4x headroom enforces nothing."* `npm run budgets:ratchet` pulls them back down;
  a budget carrying more than 15% headroom is reported as SLACK, but `enforce: false` keeps that from failing a build.
* `budgets.json`'s `perf` block (`idleRepaintsPerFrame 0.15`, `offscreenRepaints 0`, `interactionRepaints 10`) counts repaints on canvases tagged
  `data-cb-layer`. **This page owns none**, so the guard is silent here by construction.
* **`theme-baseline.json` does NOT list any file under `src/pages/chain/` or `src/pages/Chain.tsx`.** Every one of the six source files is at **zero**
  recorded violations of non-negotiable #1 and *"can never regress"* — no colour literals, no Tailwind palette shades, no off-scale type sizes. This
  is the cleanest page in the tree by that measure, and the Tailwind-utility-first styling (`text-2xs`, `text-fg`, `bg-surface2`, `border-line`) is
  why.
* The real cost centre is **row count × column count**, not bytes: at `All` strikes on SPX with 18 columns on, one expiry is several hundred rows × 37
  cells. That is what the default 40-strike window exists to cap, and it is why the `All` chip says *"slow on SPX"* on its face.

---

## Gotchas

1. **`SEED_STALE_MS = 15_000` is load-bearing.** Drop it to 0 and `NAV.prefetch`'s `/api/chains?ticker=SPX&range=all` becomes *"a request nobody
   reads."* Refreshing dodges the window by changing the URL (`&noCache=1`), not by changing `staleMs`.
2. **The seed URL has no `expiration`.** That is what makes the proxy return the nearest three expirations in one payload, and it is the whole basis
   of the no-waterfall entry. Adding an `expiration` to `seedUrl` would silently reintroduce the round trip.
3. **The book map is keyed by expiration alone — no symbol.** Without `genRef`, a slow response for the previous ticker paints under the new one. Same
   failure shape as the matrix's ΔOI snapshot.
4. **`toggle` must not fetch inside a state updater.** `openRef`/`booksRef` exist precisely because *"React may run [an updater] twice."*
5. **Only expanded expiries poll — so there are two clocks, not one.** Merging them would have the toolbar stamp claim a freshness the collapsed rows
   do not have.
6. **A failed poll must never blank a loaded expiry.** `load()` writes only on a truthy `book`; `error` is only set when there is nothing on screen.
7. **`last === 0` means "no print", not "printed at zero".** Do not add a `?? mark` fallback to the `Last` column; the `·` is the honest rendering.
8. **There is no Net Change column, and that is deliberate.** The wire carries no previous close; measuring against `mark` under a different heading
   would be *"two columns showing the same number under two names."*
9. **The wing list is written in PUT order** — left to right starting at the strike — and the call side renders it reversed. *"Get that backwards and
   the two halves read as two tables that happen to share a strike column."*
10. **A net cannot live in a wing.** `netGex`, `netOi`, `netPrem` etc. read the whole strike; putting one in `CHAIN_COLUMNS` would print it twice,
    once per side. That is exactly the confusion the two registries exist to prevent.
11. **The exposure formulas must stay byte-identical to `chainMath.ts`.** Contract basis included (`OI + volume`). If the matrix's formulas change,
    change both in the same commit or one strike will read two numbers on two pages.
12. **The BS substitution happens once per ROW, never per cell.** A per-cell substitution would let a wing column use the feed's gamma while the net
    GEX beside it used the model's.
13. **Black-Scholes also rewrites `iv`.** When the feed sent none, the `IV` column shows the *solved* vol under the `B-S` source. Its tooltip says so;
    do not "fix" the column to hide it.
14. **`impliedVol` returns 0 rather than guessing.** A price outside the model's reachable range gets no number at all. Do not substitute a default.
15. **Do not replace bisection with Newton.** *"Newton is faster and diverges exactly where this is needed most."*
16. **`yearsToExpiry` must resolve the ET offset through `Intl`.** A hard-coded `-0400` is an hour wrong for four months of the year, *"and a T that
    is an hour wrong on a 0DTE contract is a theta that is wrong by a fifth."*
17. **`tYears` depends on `book.fetchedAt`.** Remove it and 0DTE theta freezes at the value the page opened on.
18. **The last wing column cannot be removed; centre columns can all be removed.** `sanitizeColumns` enforces the floor on load as well as the UI
    enforcing it on click.
19. **A stored layout from an older build must never crash the grid.** `clean()` drops unknown keys and duplicates; `readJson` falls back on a parse
    error.
20. **Stored layout is applied in an effect, not in `useState`'s initialiser** — so the first render always matches the server markup.
21. **An OPEN expiry is always offered regardless of the `Expiries` count.** Collapsing the ladder must not make a chain you are reading disappear.
22. **The spot row is drawn BETWEEN the bracketing strikes, not on the nearest one.** The nearest strike is separately marked ATM; conflating them
    loses the distinction between "the price" and "the strike nearest the price".
23. **Centring uses `getBoundingClientRect`, not `offsetTop`.** The scroll container is not a positioned ancestor.
24. **`data-cb-spot` is the contract between `ChainGrid` and `Chain.tsx`.** Rename it in one file and the page stops centring — silently.
25. **Do not import `CHAIN.*` from `design/theme.ts` into this grid.** That ink ramp is tuned for text on a saturated heat fill; these cells have
    none. Everything here is `INK` = `T.text`.
26. **There is no virtualisation.** The strike window IS the bound. `All` is an explicit, labelled choice, and the label warns about SPX.
27. **Step 4 of "Adding a page" applies to this route.** `app/v3/chain/route.ts` must exist in the v2 repo calling `serveSpaShell("v3")`, or
    `/v3/chain` works when clicked in-app and **404s on a hard refresh or a shared link**.
