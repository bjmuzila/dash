# `multi-greek` — **Multi Greek** · 🧮 · default grid `w 48 × h 56` · `src/board/multiGreek/`

| | |
|---|---|
| **Catalog id** | `multi-greek` (`src/board/catalog.tsx`) |
| **Label** | `Multi Greek` |
| **Icon** | 🧮 |
| **Default size** | `{ w: 48, h: 56 }` — the full board width (`BOARD_COLS` is 48) and 56 grid rows of `BOARD_ROW_H` 8px |
| **Source folder** | `src/board/multiGreek/` |
| **Loaded** | `lazy()` in the catalog, wrapped in `<Deferred>` whose Suspense fallback is `<div className="min-h-0 flex-1" />` — a blank fill, never a spinner ("the card frame is already drawn around it, and a spinner inside a frame reads as an error") |
| **Renamed from** | `multi-chart` — `RENAMED` in the catalog maps it, because "the ES-vs-NQ overlay was replaced outright by the Multi Greek ladder, which is what that slot is for now" |
| **Other mounts** | `/v3/m/heat` (`src/mobile/pages/MHeat.tsx`) with `singleColumn pinnedFirst="SPX"` |

---

## What it is, in one paragraph

Multi Greek is up to four option-chain **strike ladders**, side by side. Each ladder is one ticker. You read a ladder **down** — strikes, highest at the top — and you read it **across** — one column per upcoming expiry, nearest first. The number in a cell is that strike's **net gamma exposure (GEX)** at that expiry, in dollars: a positive blue number means dealers are long gamma there and the strike pins; a negative pink number means they are short and the strike accelerates. The whole reason the card exists is the *across* read — the same strike, at the same days-to-expiry, on SPX and SPY and QQQ at once — which is why the column count is one setting for the whole card and not one per panel: "four panels on different counts stop lining up, and a board that does not line up cannot answer the question it exists to answer." The first panel is always the **board's** ticker; typing in it moves the whole board. The other panels are ones the user added, up to three, each removable with its own ✕. Three marks sit on top of the numbers: a white ring around the at-the-money row, a gold wash on the **Core Bullseye** (the biggest |GEX| in that column), and ringed CB / CW / PW badges on the front expiry. Clicking any dated cell opens a small card with that strike's call and put volume, open interest, traded premium, and how its net GEX has moved over the last 5 / 15 / 30 minutes and since the open.

---

## File map

| File | Lines | What it owns |
|---|---:|---|
| `src/board/multiGreek/MultiGreekCard.tsx` | 1289 | The card and the `TickerPanel`. Panel list & dedupe, localStorage for every persisted control, the cog popover, the ＋ add-panel popover, the ladder DOM, the ATM ring, the CB wash, near-core gating, scroll centring + the user-scroll latch, grab-and-drag panning, the cell click → `CellCard` hand-off. |
| `src/board/multiGreek/mgMath.ts` | 368 | All arithmetic, kept out of the component. Chain parse, `strikeGex()`, column pick, ex-0DTE total, `columnStats()` (CB/CW/PW/top3/netTotal/posPct), `fmtGex()`, `cellAlpha()`, `isNearCore()`, `NEAR_CORE_PCTS`, `MAX_EXP_COLS`/`MAX_COLS`, ET date helpers. |
| `src/board/multiGreek/CellCard.tsx` | 251 | The click-through card. Portalled to `<body>`, positioned in viewport coordinates, one extra request (`/api/mult-greek-gex-change`), the four Δ rows and their three states. |
| `src/pages/replay/mgReplay.ts` | 251 | The recorder side of the *separate* Multi Greek replay page. Frame parse, minute-bucket shared clock, step-hold frame pick, replay columns, replay values. **Not imported by the card.** |
| `src/data/liveGex.ts` | 186 | The SPX WebSocket GEX layer. **Not imported by this card** — see "Why this card is REST-only". |
| `src/data/symbol.tsx` | 111 | `usePageSymbol()`, `PAGE_TICKER_RE`, `SOCKET_SYMBOL`, the `cb-v3-page-symbol` store and the `/api/ticker-event` analytics beacon. |
| `src/design/primitives/ChartFrame.tsx` | 211 | The visibility-gated chart container. **Not used by this card** — there is no canvas here. |
| `src/design/tokens.css` | 716 | Every colour, and `@keyframes cb-glow` / `.mg-cb-glow`. |

> Line counts are `wc -l` against the tree at `voltick-v3/`.

---

## The data path

### 1. The chain, once per panel

```
GET /api/chains?ticker=<TICKER>&range=all&live=0
```

Built by `chainsUrl()` in `MultiGreekCard.tsx`. Read through `useQuery`:

```ts
const q = useQuery<unknown>(ticker ? chainsUrl(ticker) : null, { staleMs: 15_000, pollMs: 15_000 })
```

| Property | Value | Why |
|---|---|---|
| Poll cadence | `pollMs: 15_000` | "15s, matching v2's auto-refresh." |
| Stale window | `staleMs: 15_000` | A remount inside 15s serves the cached body. |
| Background polling | **off** (`background` not set) | `useQuery` skips a tick while `document.visibilityState === 'hidden'` and fires one immediately on `visibilitychange` back to visible. |
| Params | `range=all`, `live=0` | See below. |
| Dedupe | by URL, in `data/api.ts`'s `cache` map | Two panels on the same ticker, or the SPX panel and the anchor query, make **one** request. |

**`staleMs` is a TTL, not an interval.** `src/data/api.ts` spells this out at the top of the file: "a chart with staleMs 25_000 looked like it was refreshing every 25 seconds and was in fact frozen at the value it loaded with." Both are set here on purpose — the `pollMs` is what keeps the ladder moving.

#### `live=0` is load-bearing, and only for SPX

From the source comment:

> Without it the chain adapter serves the subscribed underlying from the live WebSocket subscriber, which streams exactly ONE expiry — so SPX came back with a single expiration and its panel was stuck at one column no matter what the board was set to, while SPY/QQQ/NDX fell through to REST and got three. The flag opts this caller out of that fast path; the ladder is read ACROSS expiries, so a one-expiry chain is not a chain it can use.
>
> It costs SPX the live path, which is the right trade here: the panel polls on a 15s cadence anyway and the REST response is the only one with the columns.

`src/board/chainGex.ts` passes the same flag for one-rule-per-route consistency, even though it only ever reads the front expiry.

#### Response shape, exactly as parsed

`parseChain()` in `mgMath.ts` reads this and nothing else:

```jsonc
{
  "data": {
    "underlyingPrice": 6412.34,          // number → ParsedChain.underlying
    "items": [
      {
        "expiration-date": "2026-09-19", // string; falsy ⇒ the whole item is skipped
        "strikes": [
          {
            "strike-price": "6400",      // A STRING on the wire — it is a Map key upstream
            "call": {
              "gamma": 0.00042,
              "delta": 0.51,
              "open-interest": 12045,    // hyphenated
              "volume": 3011,
              "mark": 18.35,
              "bid": 18.20,
              "ask": 18.50
            },
            "put": { /* same shape */ }
          }
        ]
      }
    ]
  }
}
```

Parsing rules, all in `mgMath.ts`:

- `num()` coerces anything non-finite to `0`. There is no NaN anywhere downstream.
- A strike whose `strike-price` coerces to `0` (or is absent) is **dropped**.
- An expiry with zero usable strikes is **dropped**; it never becomes a column.
- `expiries.sort((a, b) => a.expiration.localeCompare(b.expiration))` — lexicographic on `YYYY-MM-DD`, which is chronological for that format.
- `leg()`: `mark = num(raw.mark) || (bid > 0 && ask > 0 ? (bid + ask) / 2 : 0)`. The comment is explicit that the midpoint is the *fallback*, not the primary: "`mark` is what the upstream considers the leg worth, and it survives a one-sided book that would make a `(bid+ask)/2` meaningless."
- `Leg.delta` is parsed and carried but **the ladder never reads it** — it is there for the GEX Chart's DEX line. `Leg.mark` likewise: only `CellCard` uses it.

#### The anchor request

```ts
const spxQ = useQuery<unknown>(chainsUrl('SPX'), { staleMs: 15_000 })
```

No `pollMs`. This exists so every panel's column pick is anchored to **SPX's front expiry** rather than each ticker's own first date. Because it is the identical URL the SPX panel polls, `query()`'s dedupe means "this costs nothing extra" — *when an SPX panel is on screen*. With the board off SPX and no SPX panel added, this is a real extra request that never refreshes itself (`staleMs` is a TTL; no poll).

### 2. The cell card's history

```
GET /api/mult-greek-gex-change?ticker=<T>&expiry=<YYYY-MM-DD>&strike=<number>
```

```ts
useQuery<{ data?: GexChange | null }>(url, { staleMs: 30_000, pollMs: 60_000 })
```

"A minute, matching the recorder's own cadence — asking faster returns the same row twice."

```ts
interface GexChange {
  vNow: number | null
  v5: number | null
  v15: number | null
  v30: number | null
  vOpen: number | null
}
```

`vNow` is on the type and **is never read** — the card diffs against its own live cell value (`netGex`), exactly as v2 does. `change = q.data?.data ?? null`.

The strike goes into the query string **unencoded** (`&strike=${strike}`) because it is a number; the other two are `encodeURIComponent`'d.

### HTTP-200-on-failure

`query()` in `src/data/api.ts` throws on `!res.ok` and only then. **Any endpoint that answers a failure with a 200 and a JSON body will be treated as success by this card.** Multi Greek has no `ok:false` handling at all — `parseChain()` simply sees no `data.items`, produces zero expiries and zero strikes, and the ladder renders "No strikes". That is the card's entire failure surface for a soft-failed 200. (Compare `/proxy/gex-vol-flow`, which *does* answer `ok:false` with a 200 and whose card branches on it; see `card-vol-gex-flow.md`.)

A **failed poll keeps the last good value on screen** — `useQuery`'s poll `.catch()` is deliberately empty: "Blanking a chart because one refresh in the middle of the day 502'd is worse than showing a number that is thirty seconds old." The same is true of the toolbar's global refresh (`refreshAll()`), whose revalidators never set `loading`.

### Why this card is REST-only

`src/data/symbol.tsx` names Multi Greek as one of the two deliberate exceptions to the one-page-symbol rule:

> Multi Greek is the other exception, deliberately: four independently typeable slots is the entire point of that card, and one page ticker applied to all four would leave it comparing a symbol with itself.

`src/data/liveGex.ts` carries the other half of the reason: "The socket carries ONE underlying." A ladder read across four tickers cannot be served by it, so this card never touches `useFrame`, `useField` or `watchFrame`.

### Replay is a different page, not a mode

There is **no replay path inside this card**. `src/pages/replay/MultiGreekReplay.tsx` is a separate build that reaches into `mgMath.ts` for the shared definitions and into `src/pages/replay/mgReplay.ts` for the recorder side:

```
GET /proxy/strike-growth/replay-meta?symbol=<T>
GET /proxy/strike-growth/frames-by-expiry?symbol=<T>&date=<YYYY-MM-DD>
```

`frames-by-expiry` returns `{ ok, error?, expiries: string[], frames: [{ ts, spot, cells }] }` where `cells` is **positional** — `[expiryIndex, strike, net, vol]` against the response's own `expiries` index table, "which is what keeps a full session inside a few hundred KB." `parseMgSession()` returns `null` for `ok !== true` or for zero usable frames, "so the caller can tell 'this ticker was never recorded' from 'this ticker recorded nothing yet'."

Two rules from `mgReplay.ts` worth carrying here because they explain the live card by contrast:

- The timeline is **minute buckets across every loaded session**, and each panel answers "what was your last sweep at or before the end of this minute?" — a **step-hold, never a nearest-match**. "A nearest-match would let one panel show a reading from thirty seconds in the future of the panel beside it, which is precisely the comparison this page exists to make honest."
- A strike the sweep did not record renders `--`, **not 0**: "'no gamma here' and 'not recorded at this moment' are different claims."

The replay page's own note also records that v3 deliberately departs from v2 twice, and both come straight from `mgMath.ts` so there is one definition: CW must be **above** spot and PW **below** it (v2 had no spot filter and could print a "call wall" under the money), and `MAX_EXP_COLS` is 3 (v2's 4 made its "4" option silently identical to "3").

---

## Every derived number

### `strikeGex(row, spot, basis)` — the number in a cell

```
(|γcall| · contractsCall − |γput| · contractsPut) · spot² · 0.01 · 100
```

| Term | Meaning | Unit |
|---|---|---|
| `γcall`, `γput` | per-contract gamma, **absolute value taken** | Δ per $1 |
| `contractsCall` | `oi` and/or `vol`, per the basis switch | contracts |
| `spot²` | underlying price squared | $² |
| `0.01` | a 1% move | — |
| `100` | contract multiplier | shares/contract |
| **result** | **net dollar gamma at that strike for a 1% move** | **$** |

Guards: returns `0` when the row is missing **or** `!(spot > 0)`.

Basis selection:

```ts
const useOi  = basis !== 'vol'
const useVol = basis !== 'oi'
```

| Basis | `useOi` | `useVol` | Label |
|---|---|---|---|
| `'oivol'` | ✓ | ✓ | `OI+VOL` |
| `'vol'` | — | ✓ | `VOL` |
| `'oi'` | ✓ | — | `OI` — **type only, not offered by the control** |

Two deliberate decisions carried verbatim from v2:

> The `0.01 · 100` pair is a 1%-move-times-multiplier convention and is exactly what v2 uses; keep it, or this board stops agreeing with every other GEX number in the product.

> Absolute gammas with an explicit sign on each side, rather than signed gammas: the sign convention on a put's gamma differs between feeds, and hard-coding "calls add, puts subtract" is the only version that survives one of them changing its mind.

`chainGex.ts` relies on the linearity of this: `strikeGex('oi') + strikeGex('vol') === strikeGex('oivol')`.

### Column values

For each displayed column, `valuesByCol` builds a `Map<strike, number>`:

- A **dated** column sums exactly one expiry's rows.
- The **ex-0DTE total** column (`key === EX0_KEY === 'ALL_EX_0DTE'`) sums `ex0Source` — *every* available expiry whose `daysTo !== 0`, "including expiries that have no column of their own."

### `columnStats(values, spot)` — per column

| Field | Formula | Unit |
|---|---|---|
| `maxAbs` | `max(|v|)` over the column | $ |
| `cb` | the strike that set `maxAbs` — the **Core Bullseye / magnet** | strike |
| `cw` | largest **positive** `v` at a strike **strictly above** spot, **skipping `cb`** | strike |
| `pw` | most **negative** `v` at a strike **strictly below** spot, **skipping `cb`** | strike |
| `top3` | the three strikes with the largest `|v|`, in order | strikes |
| `netTotal` | `Σ(v ≥ 0 ? v : 0) − Σ(v < 0 ? −v : 0)`, i.e. `pos − neg` | $ |
| `posPct` | `denom > 0 ? (pos / denom) × 100 : 0`, `denom = pos + neg` | % |

Why CB is excluded before the walls are picked:

> The biggest node on the board is frequently also the biggest node on one side of spot, so without this the CB and the wall land on the same strike and a levels view draws one line where there should be two — losing the level price actually has to get through after the core.

Note `top3` is computed by `entries.sort(...)` — **`entries` is sorted in place**, after `cb`/`cw`/`pw` have already been read off it. Correct today; a reordering of this function would break silently.

### `cellAlpha(value, maxAbs, rank, intensity)` — the heat wash

```ts
const RANK_ALPHA = [0.9, 0.45, 0.25]
const RAMP = { base: 0.04, span: 0.55, max: 0.62, ease: 1.6 }

if (!value) return 0
if (rank >= 0) return RANK_ALPHA[rank]          // ranks 1-3 are FIXED at every intensity
if (maxAbs <= 0) return 0
ratio = |value| / maxAbs
return min(0.62, 0.04 + (ratio · max(intensity, 1))^1.6 · 0.55)
```

`intensity` is clamped up to 1 inside the formula, so the slider's 0.5–1.0 range moves nothing for un-ranked cells; it still reads "flat" at ≤ 0.51 in the label. "Ranks 1-3 in a column take fixed steps so the top of the ladder is legible at any intensity."

The resulting fill is `color-mix(in srgb, <hue> <alpha×100>%, transparent)` with the hue picked by the sign of the value.

### `isNearCore(value, maxAbs, threshold)`

```
|value| / maxAbs >= threshold
```

`false` when `value` is 0/non-finite or `maxAbs <= 0`. **Sign-blind**, deliberately: "a put wall at 60% of a call-side core is exactly the strike the question is about." `maxAbs` *is* the core's magnitude, so this is literally "a share of the column's core."

The threshold reaching it is clamped once, at the panel:

```ts
const nearCoreThreshold = Math.min(Math.max((nearCorePct || 0) / 100, 0), 0.99)
```

> Clamped here rather than at every cell: the control cannot emit anything out of range, but a stored value from an older build can.

### Columns and dates

```ts
const ET_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
todayEt()  // "2026-09-20" — en-CA purely for ISO ordering
daysBetween(from, to)  // Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
```

Noon UTC on both sides so no timezone can shift a whole day. `daysBetween` returns `0` if either parse fails.

`pickColumns(expiries, anchor)`:

```ts
expiries.filter(e => e >= anchor).slice(0, MAX_EXP_COLS).map(...)
```

- `label` = `` `${Math.max(0, daysTo)}DTE` ``
- `subLabel` = `` `GEX · ${expiration.slice(5)}` `` → `GEX · 09-19`
- Returns **every** usable expiry (up to 3), not the user's slice, "because the ex-0DTE total below has to sum expiries the user has chosen not to give a column to."

Why anchor at all:

> Tickers do not share a calendar (SPX is daily, most equities are weekly), so forcing one date list on all four produces empty columns; anchoring instead keeps the columns comparable without pretending the calendars match.

`withEx0Column(all, count, showEx0)`:

- `display = all.slice(0, clamp(count, 1, 3))`
- If `showEx0`, `ex0Source = all.filter(c => c.daysTo !== 0)`; if that is empty, **the total column is suppressed** ("an empty sum column is just a column of dashes").
- The total column is `{ key: 'ALL_EX_0DTE', expiration: '', daysTo: -1, label: 'ALL', subLabel: 'EX-0DTE' }`.
- The two settings are **independent**: "'everything except today' is a different question from 'the next two expiries', and answering it should not cost a column you were reading."

`MAX_EXP_COLS = 3` — "three is all the backend has: `fetchChainFull()` in `proxy-tastytrade.js` returns the nearest expiration plus up to two more, and nothing downstream can invent a fourth. This used to be 4, which made the '4' option silently identical to '3'." `MAX_COLS = 4`.

### ATM

```ts
rows.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best), rows[0])
```

Strict `<`, so on an exact tie the **first** (highest) strike wins — `rows` is sorted descending.

### `fmtGex(v)` — the cell's text

Returns `{ sign, text }` so the sign can be coloured separately from the magnitude.

| Condition | `sign` | `text` |
|---|---|---|
| `null` / non-finite / **exactly 0** | `''` | `'--'` |
| `|v| ≥ 1e9` | `+` / `−` (U+2212) | `$1.23B` |
| `|v| ≥ 1e6` | `+` / `−` | `$1.23M` |
| `|v| ≥ 1e3` | `+` / `−` | `$123K` — **0 dp** |
| otherwise | `+` / `−` | `$123` — 0 dp |

Note this is a **different formatter** from the scanner's `fmtGex` in `pages/scanner/gexLevels.ts` (which has a T tier, takes a `digits` argument and returns one string). Both exist and both ship; see the "TWO MAGNITUDE FORMATTERS, KEPT" note in that file.

### `CellCard`'s own numbers

| Number | Formula | Unit |
|---|---|---|
| `Net Prem` per leg | `vol × mark × 100`, `null` when `!(mark > 0)` | $ |
| `Net Prem (C−P)` | `(callPrem ?? 0) − (putPrem ?? 0)`, `null` only when **both** legs are null | $ |
| `Net GEX` | the live cell value, passed in | $ |
| `Δ 5 / 15 / 30 min`, `Δ Open` | `netGex − past` where `past` is `v5` / `v15` / `v30` / `vOpen` | $ |
| Expiry label | `new Date(\`${expiry}T12:00:00Z\`)` formatted `America/New_York`, `month: 'short', day: 'numeric'` → `Sep 19` | — |
| DTE label | `` `${Math.max(0, daysTo)}DTE` `` | days |

`fmtInt` = `Math.round(v).toLocaleString('en-US')`, `'—'` on null/non-finite. `fmtMoney` wraps `fmtGex` and returns `'—'` at exactly 0.

### The card's position

```ts
const CARD_W = 264, CARD_H = 340, EDGE = 8, CARD_Z = 200
left = clamp(x + 14, EDGE, vw - CARD_W - EDGE)
top  = clamp(y + 14, EDGE, max(EDGE, vh - CARD_H - EDGE))
```

SSR fallbacks are `vw = 1200`, `vh = 800`.

---

## Every control

### In the card header (`CardToolbar`, portalled into the board tile's drag handle)

| Control | What it does | Default | Stored | Old value coerces to |
|---|---|---|---|---|
| **＋ `n/4`** | Opens the add-panel popover. Disabled once `extras.length >= 3`. The count is `extras.length + 1` / `MAX_EXTRA_PANELS + 1` and counts what is **stored**, not what is drawn — "a panel hidden because the board sits on its symbol still holds its seat." | — | — | — |
| **Add panel** input | 6 chars max, uppercased on change, `Enter` adds, `Escape` closes. Rejected silently unless `PAGE_TICKER_RE` (`/^[A-Z][A-Z.]{0,5}$/`) matches; also refused (draft cleared, popover left open) if it equals the page symbol or an existing extra. | empty | writes `cb-v3-mg-extra-tickers` | — |
| **⚙** | Opens the settings popover. `title` is `` `Board settings — ${BASIS_LABEL[basis]} · ${colCount + (showEx0 ? 1 : 0)} of ${MAX_COLS} col` `` | closed | — | — |

### In the cog popover

| Section | Control | Options | Default | localStorage key | Old / bad value coerces to |
|---|---|---|---|---|---|
| **Columns** *(hidden when `singleColumn`)* | `SegGroup` | `1` `2` `3` | `3` (`MAX_EXP_COLS`) | `cb-v3-mg-col-count` | `Math.min(3, Math.max(1, Math.round(n)))`; non-finite → `3`. **A pre-split blob storing `4` clamps to `3`** — "which is the same number of expiry columns that setting ever actually drew." |
| **Columns** | `Chip` **ALL ex-0DTE** | on/off | **on** | `cb-v3-mg-ex0` (`'1'`/`'0'`) | anything that is not the string `'0'` → **on** |
| **Basis** | `SegGroup` | `OI+VOL` (`oivol`) · `VOL` (`vol`) | `oivol` | `cb-v3-mg-basis` | `=== 'vol' ? 'vol' : 'oivol'`. **A stored `'oi'` becomes `'oivol'`** — "a selected value the control cannot show is a control that lies about what is on screen." |
| **Heat** | `Slider` **intensity** | min 0.5, max 3, step 0.05; formatted `flat` at ≤ 0.51 else `1.75×` | `1.75` | **not stored** — in-memory per mount | resets to 1.75 on reload |
| **Heat** | `Chip` **NEAR CORE** | on/off | **off** | `cb-v3-mg-near-core` (`'1'`/`'0'`) | anything not `'1'` → off |
| **Heat** | `Dropdown` **≥ N% of core** | `NEAR_CORE_PCTS = [25, 33, 40, 50, 60, 75, 90]` | `50` | `cb-v3-mg-near-core-pct` | `Number.isFinite(n) && n > 0 && n < 100 ? n : 50`; then clamped to `[0, 0.99]` as a fraction at render |
| **Heat** | `Chip` **CB / CW / PW** | on/off | **on** | **not stored** — in-memory per mount | resets to on |

Two persistence details:

- `NEAR CORE` and its percentage are written by **effect**, not only inside the commit callbacks: "so the store can never disagree with what is on screen — including after a hot reload, which re-runs the lazy initialisers below against whatever the store last held."
- Moving the threshold **switches the filter on**: `commitNearCorePct` calls `setNearCore(true)`. "Moving the threshold is itself the statement that you want the filter, so it switches on rather than quietly changing a number nothing is reading."
- `NEAR CORE` is remembered where the option chain's HIDE is not, because "this is a way of reading the ladder rather than a state some click just put the board into, so coming back to a board that is still filtered is the board you left."

### In each panel header

| Control | Behaviour |
|---|---|
| **Ticker** | Bare text until clicked, then an `<input>` (6 chars, autoCapitalize, `Enter` commits + blurs, `Escape` reverts + blurs, blur commits). "A symbol is read a hundred times for every time it is changed, so the reading state is the one to optimise: bare text, its own width, no chrome." Underline, not a box, because "the field is only on screen while it is focused." Panel one is `text-accent` and its tooltip says the whole board moves; added panels are `text-fg`. |
| **Ticker (read-only)** | When `pinnedFirst` is set, panel one renders a `<span>`, not a disabled button — "a control that cannot be used should not look like one." Title: `` `${ticker} — this panel is fixed. Add another with ＋.` `` |
| **Spot** | `spot.toLocaleString('en-US', { maximumFractionDigits: 2 })`, or `…` while loading, or `—`. |
| **✕** | Only on added panels. Removes that extras index and closes an open `CellCard` belonging to it. Title/aria: `` `Remove the ${ticker} panel` ``. |

### Storage keys, complete

| Key | Owner | Shape |
|---|---|---|
| `cb-v3-mg-extra-tickers` | this card | JSON `string[]`, uppercased, `PAGE_TICKER_RE`-filtered on read, deduped, truncated to 3 |
| `cb-v3-mg-tickers` | **legacy**, read-only | the pre-split four-fixed-slots blob; slot 1 is discarded, slots 2-4 become the extras |
| `cb-v3-mg-col-count` | this card | stringified int |
| `cb-v3-mg-ex0` | this card | `'1'` / `'0'` |
| `cb-v3-mg-basis` | this card | `'oivol'` / `'vol'` |
| `cb-v3-mg-near-core` | this card | `'1'` / `'0'` |
| `cb-v3-mg-near-core-pct` | this card | stringified int |
| `cb-v3-page-symbol` | `data/symbol.tsx` | the board's ticker, validated against `PAGE_TICKER_RE` on read; anything else → `SPX` |

There is **no version field and no migration pass**. The legacy read is the only migration, and it is a read, not a rewrite.

### The panel list, and the bug it is shaped around

```ts
const DEFAULT_EXTRAS = ['SPY', 'QQQ']
```

Seeded on **read, never written**:

> a card that has only ever shown the defaults still counts as "nothing chosen", so a later build can change this list and every untouched board picks the new one up. The moment the customer adds or removes a panel the list becomes theirs and is stored.

`loadExtras()` returns `[...DEFAULT_EXTRAS]` only when **both** `cb-v3-mg-extra-tickers` and `cb-v3-mg-tickers` are absent/empty strings.

The page symbol is **not** filtered out of the stored list:

> This list is the STORED one; a stored ticker that happens to equal the board's current symbol is hidden at render time instead. Dropping it here meant moving the board onto SPY deleted the SPY panel from storage for good, and moving the board back left a hole the customer had to re-add — which is what "Multi Greek isn't saving" looked like.

`panels` is therefore `[{ ticker: pageSymbol, slot: -1 }, ...extras.map((t, i) => ({ ticker: t, slot: i })).filter(p => p.ticker !== head)]`.

`commitTicker(slot, next)` refuses and returns `false` (so the input snaps back) when:

- `!PAGE_TICKER_RE.test(next)`
- slot 0 and `pinnedFirst` is set
- slot 0 and the symbol is already an extra
- a non-zero slot whose value would equal the page symbol
- a non-zero slot whose value would duplicate another extra

> A symbol already on the board is refused. The panels are read ACROSS, so the same ticker twice does not add a comparison — it removes one, silently.

`newInstanceId()` (catalog) counts up rather than reusing the lowest free number, "so removing card #2 and adding another does not resurrect the old name."

---

## Rendering

**This card is 100% DOM.** There is no `<canvas>`, no `ChartFrame`, no `data-cb-layer` and therefore **no coverage from `scripts/perf-check.mjs`** (which measures only canvases tagged `data-cb-layer`). It is a CSS grid of spans and divs.

### Layout constants

| Constant | Value | Notes |
|---|---|---|
| `RAIL_PX` | `76` | the strike rail's width, "matching v2 so the two boards read at the same rhythm" |
| `gridCols` | `` `${RAIL_PX}px repeat(${Math.max(1, display.length)}, minmax(0, 1fr))` `` | one template, used by both the header block and every row |
| `MAX_EXTRA_PANELS` | `3` | four panels total is the board's width |
| `RECENTRE_QUIET_MS` | `10_000` | see below |
| `CARD_W` / `CARD_H` / `EDGE` / `CARD_Z` | `264` / `340` / `8` / `200` | the CellCard |
| Pan threshold | `4px` | below this a press is still a click |
| Programmatic-scroll window | `150ms` | a `scroll` event inside this window is the centring effect hearing itself |

### Colour tokens

| Where | Token | Hex in `tokens.css` |
|---|---|---|
| Positive GEX text / heat hue | `--color-gex-pos` | `#4d8cff` |
| Negative GEX text / heat hue | `--color-gex-neg` | `#ff5fa2` |
| Core Bullseye wash + badge ring | `--color-level-cb` | `#ffd166` |
| Call Wall badge ring | `--color-level-cw` | `#4d8cff` |
| Put Wall badge ring | `--color-level-pw` | `#ff5fa2` |
| `+` sign glyph | `--color-up` | `#3ddc8e` |
| `−` sign glyph | `--color-down` | `#ff6b7a` |
| Zero / flat net | `--color-flat` | `#c0c5c3` |
| ATM ring, `text-fg`, `textShadow` base | `--color-fg` | `#e7ece9` |
| Strike rail, labels | `--color-muted` | `#e7ece9` (all three text tones are white today) |
| `✕` and disabled chrome | `--color-faint` | `#c0c5c3` |
| Panel-one ticker, column labels, add-input | `--color-accent` | `#2f6bff` |
| Panel plate | `--color-surface2` | `#141a21` |
| Column-header band | `--color-surface` | `#0e1216` |
| Hover | `--color-raised` | `color-mix(in srgb, #141a21 92%, #e7ece9)` |
| Borders | `--color-line` | `#1e2630` |
| ★ glyph and badge plates | `--color-app` / `bg-app` | `#0a0d10` |

### The Core Bullseye wash

```ts
const CB_WASH_ANGLE = '112deg'
const CB_GOLD = 'var(--color-level-cb)'
const CB_FILL = 'color-mix(in srgb, var(--color-level-cb) 85%, transparent)'
const CB_FADE = 'color-mix(in srgb, var(--color-level-cb) 0%, transparent)'
const CB_WASH = `linear-gradient(112deg, ${CB_GOLD} 0%, ${CB_FILL} 55%, ${CB_FADE} 82%)`
```

Applied as `background: ${CB_WASH}, ${heat}` — the gradient **layered over** the heat fill in one property, which the comment notes is "the only way to composite a translucent layer over another without knowing what the layer underneath resolved to — the same trick v2's `levelFillBg()` uses."

Why a wash and not a flat fill:

> Flat was the bug, and it is the same one the chain matrix had: a Core below spot is negative, and at 85% the gold buried the red. Two cells that meant opposite things looked identical. The wash keeps gold where the eye looks for the marker — the ★ / badge end of the cell — and is gone before the figure, which sits on the ordinary heat and reads red or blue again.

Why 55/82 and not the chain's 26/66:

> The ladder is scanned across four panels at once and the core has to be findable in peripheral vision, so gold holds through the figure and hands over in the last quarter — enough tail, between the fade and the CB badge, to say which way the gamma points without the cell stopping being the gold one.

`CB_FADE` fades to **gold at zero alpha**, never to `transparent`: "a ramp through grey reads dirty."

The constant is **copied, not imported**, from `pages/optionsChain/heatSkins.ts`: "that module owns a SKIN (ramp, rank floors, cell geometry) and this ladder wears none of it — only the one colour decision is shared, so only the one value is copied." The replay page copies it a third time, byte for byte.

A CB cell also gets `textShadow: '0 1px 2px color-mix(in srgb, var(--color-app) 85%, transparent)'` and the class `mg-cb-glow`.

### `.mg-cb-glow`

In `tokens.css`, because "`@keyframes` cannot be scoped to a component without a CSS module":

```css
@keyframes cb-glow {
  0%, 100% { box-shadow: 0 0 3px  color-mix(in srgb, var(--color-fg) 35%, transparent); }
  50%      { box-shadow: 0 0 10px color-mix(in srgb, var(--color-fg) 85%, transparent); }
}
.mg-cb-glow { animation: cb-glow 2.4s ease-in-out infinite; }
```

> A slow white pulse rather than a static ring: the CB moves strike during the session, and a mark that breathes is findable in peripheral vision on a board of four ladders in a way a fixed outline is not.

There is a `prefers-reduced-motion` rule in the same file that kills the animation.

### The ATM ring

```ts
boxShadow: 'inset 0 2px 0 var(--color-fg), inset 0 -2px 0 var(--color-fg), inset 2px 0 0 var(--color-fg), inset -2px 0 0 var(--color-fg)',
zIndex: 1
```

> An inset ring rather than a real border: a 2px border adds 4px of row height and makes the whole ladder jump as spot crosses a strike. v2 learned this the same way.

There is deliberately **no ATM chip** in the rail: "The row's white ring already says which strike is at the money, and a badge in the rail cost the strike number half its width on four ladders at once."

### The rank-1 outline

```ts
outline: painted && rank === 0 && v !== 0 ? `1px solid ${hue}` : undefined,
outlineOffset: -1
```

Only on non-CB cells (the CB branch sets `background` and `textShadow` and no outline).

### Badges

| Mark | When | How it is drawn |
|---|---|---|
| **CB / CW / PW** text badge | `showLevels && level && isFront` | absolutely positioned right-0.5, vertically centred, `bg-app` plate, `boxShadow: inset 0 0 0 1px var(--color-level-${level})`, `text-3xs font-black`, `title` = `Core Bullseye` / `Call Wall` / `Put Wall` |
| **★** | `showLevels && isCb && !isFront` | absolutely positioned left-0.5 top-px, `color: var(--color-app)`, `title="Core Bullseye"` |

The ★ is drawn in the **app ground, not gold**: "the corner it sits in is where `CB_WASH` holds FULL gold, and a gold star on gold is an invisible star. No halo either — solid gold is already its ground, and the glow only softened the glyph's edge."

**The `CB / CW / PW` switch turns off the labels only.** From the header comment:

> The core's gold is colour, not a label: it is the thing that makes the core findable at a glance, and clearing the text is not a reason to lose it.

The `level` lookup in the cell is explicitly *not* gated on `showLevels`, and the code carries a comment saying so.

### Near-core gating

```ts
const painted = !nearCore || level != null || (s ? isNearCore(v, s.maxAbs, nearCoreThreshold) : false)
const alpha = painted && s ? cellAlpha(v, s.maxAbs, rank, intensity) : 0
```

> NEAR CORE. A filter on WHICH cells get the wash — never a second kind of wash. A strike that clears the threshold is painted exactly as it would have been with the filter off, on the same ramp at the same Intensity; one under it is left bare.
>
> A level is exempt whatever the dial says: a CW badge sitting on an unpainted cell reads as a bug, and the threshold has no business deciding where the walls are.

### Column header block

Headers and totals are **one grid, one border, three lines per column** — the expiry label, its date, and its net:

> They were two grids with their own padding and their own bottom border — four rows of chrome above the ladder on a card that only has room for twelve strikes. One block, one border, three lines per column: the expiry, its date, and its net. Nothing was dropped.

The net line is `text-gex-pos` / `text-gex-neg` / `text-flat` by sign, followed by `Math.round(s.posPct)%` in `text-up` when `posPct >= 50` else `text-down`, suppressed entirely when `netTotal === 0`.

### The ladder body

- `relative` — load-bearing. `offsetTop` is measured from the nearest **positioned** ancestor. "v2 does not [carry `relative`], so its ATM row lands a constant offset (panel header + column header + totals row) below true centre. Fixed here rather than reproduced."
- Scrollbar hidden three ways, because no one API covers all engines: `[&::-webkit-scrollbar]:hidden` for WebKit, and inline `scrollbarWidth: 'none'` + `msOverflowStyle: 'none'` for Firefox and old Edge — "properties Tailwind cannot spell as a utility (the leading dash reads as a negative value)."
- `cursor-grab` / `active:cursor-grabbing`.

### CopyShot

The card root carries `data-capture-meta={tickers.join(' · ')}` — every panel on screen. From the comment: "The expiry is per-column and stays in the column headers, which are content rather than the card chrome the shot drops." `src/shell/snapshot.ts` drops every card's own header from every shot, so this attribute is how the symbols survive into the caption.

---

## Scrolling: centring, the latch, and the pan

This is the most fought-over part of the card. Three mechanisms, in this order.

### 1. Re-anchor detection

```ts
const anchorKey = `${atm ?? 0}|${rows.length}|${rows[0] ?? 0}`
```

An effect watches this. If the ladder genuinely changed **and** the user has scrolled:

- ≥ 10s since the last user scroll → clear the latch immediately.
- < 10s → schedule the clear for when the window closes, and bump `recentreTick` to force a render.

> Centring on the money is right on arrival and wrong the moment you have gone looking at a wall four screens up: the latch below stops it fighting a live gesture, but the latch used to clear the instant the ATM strike moved — and on a 15s poll in a fast tape that is a few seconds later. You scroll, you read two rows, the ladder yanks back.

### 2. The centring effect — deliberately no dependency array

```ts
const target = Math.max(0, Math.round(row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2))
if (Math.abs(el.scrollTop - target) < 1) return   // don't write; a write fires a scroll event
programmaticRef.current = Date.now()
el.scrollTop = target
```

> No dependency array, matching v2: the ladder can be re-laid-out by a resize or a column change that no single value here captures, and re-centring is idempotent. The latch is what stops it fighting the user, and `recentreTick` is read here only so the closing of the quiet period gets a render to act in — it is a trigger, not a value.

The "already there, don't write" guard exists because "this effect runs on EVERY render, so the listener below would see a steady drip of scrolls it has to tell apart from yours."

The two effects are declared in this order on purpose — "effects run in declaration order, so a ladder that has genuinely changed clears the user-scroll latch in the same commit that the centring effect below then acts on."

### 3. The latch — one `scroll` listener, not `wheel` + `touchmove`

> Those two catch a mouse wheel and a finger and nothing else — not a trackpad's momentum tail, not Page Up, not an arrow key, not a drag of a scrollbar. Every one of those moved the ladder without arming the latch, so the very next re-anchor pulled it straight back to the money and the panel was unreadable while the tape moved. `scroll` fires for all of them.
>
> The price of `scroll` is that it also fires for the centring effect's own write. That is what `programmaticRef` is for: the effect stamps the clock immediately before it writes, and an event arriving within a frame or two of that stamp is the effect hearing itself, not you. Anything else is you.

`{ passive: true }`.

### 4. Grab-and-drag

Three details, all named in the source:

- **4px threshold**, "so a click that wobbles is still a click";
- **pointer capture taken only once the threshold is crossed**, "so the press that turns out to be a click never leaves the element";
- **a suppress flag consumed in the CLICK CAPTURE phase**, "because click fires after pointerup and that is the last moment it can be stopped."

Crossing the threshold also arms the latch directly: "a deliberate pan is exactly the gesture the re-centring latch exists for."

Only `e.button === 0`. The ticker input and the ✕ both `stopPropagation` on `onMouseDown` so a header interaction never starts a pan or a board drag.

---

## Phone / expanded / replay behaviour

### Phone — `/v3/m/heat`

`MHeat.tsx` mounts `<MultiGreekCard singleColumn pinnedFirst="SPX" />` inside `<MobileShell title="Multi Greek" fill>`.

| Prop | Effect |
|---|---|
| `singleColumn` | `colCount = 1`, `showEx0 = false`, and the **Columns section of the cog is hidden** — "a control that cannot move the thing it names is worse than no control." |
| `pinnedFirst="SPX"` | Panel one is SPX, rendered as read-only text; `commitTicker(0, …)` returns `false`; `editable={false}`. |

Both are per-mount overrides that **never write to storage**: "A phone visit must not come back as a one-column board on the desktop next time."

Why one column:

> The card's reason to exist is the ACROSS read — the same strike on several symbols at the same DTE — and at 390px three expiry columns per panel is three unreadable columns and no across read at all. One column plus the ＋ button is the same question asked in the width that is actually there.

Why the prop and not a width check:

> Deliberately NOT `useIsPhone()` inside this component: the board can be looked at on a narrow desktop window, and a card that silently dropped two columns when someone resized their browser would be a bug nobody could describe. The phone ROUTE asks for it; the width never does.

Why panel one is pinned on the phone:

> On the phone build nothing else is reading it, and the header's picker is hidden there for that reason, so a typeable panel one would be the last surviving way to move a value with no other visible consequence. Pinned to SPX instead; the ＋ button is the only way symbols come in, which is the one that adds rather than replaces.

The ＋ button is untouched — "1–4 tickers still works exactly as it does on the board — the panel row scrolls sideways once there are more than two."

### Expanded / resized

Nothing special. The panel row is `flex min-h-0 flex-1 gap-2 overflow-x-auto`; panels share the width evenly and the row scrolls sideways when they do not fit. The ladder scrolls inside itself vertically. `singleColumn` is the **only** width-dependent behaviour and it is route-driven, not measured.

### Replay

Not in this card. `/replay`'s Multi Greek tab is `src/pages/replay/MultiGreekReplay.tsx`, "the only tab of the four with no v3 component behind it: `board/multiGreek/MultiGreekCard.tsx` is the LIVE ladder and has no replay path, so this is a build rather than a mount." It shares `mgMath.ts` — one definition of a wall in v3 — and uses its own storage keys (`cb-v3-replay-mg-tickers`, `cb-v3-replay-mg-col-count`, `cb-v3-replay-mg-ex0`, `cb-v3-replay-mg-basis`) and four fixed slots seeded `['SPX','SPY','QQQ','NDX']`.

It also opens **none** of the live loops:

> v2 keeps every live loop running while rewound and throws the output away: a 15s chain poll per ticker, an ES/SPX basis poll, the socket, an EM lookup, a 35-minute GEX ring. None of it reaches the screen. This page opens NONE of them — it is REST-only, two recorder endpoints, no socket, and nothing polls. That is a departure, and it is recorded as one in the spec rather than being quietly better.

---

## Status and empty-state messages, verbatim

### In the ladder body, when `rows.length === 0`

Rendered as `<div className="px-1 py-3 text-xs text-muted opacity-50">`, in this precedence:

| Condition | Text |
|---|---|
| `q.error` | `Chain unavailable` |
| `q.loading` | `Waiting for the chain…` |
| `noSpot` | `` `No ${ticker} price — GEX needs the spot` `` |
| otherwise | `No strikes` |

`noSpot` is `!q.loading && !q.error && chain.expiries.length > 0 && !(spot > 0)` — the chain arrived with strikes and greeks and `underlyingPrice` came back 0 or missing. The comment behind it is the whole reason the ladder is dropped rather than drawn full of dashes:

> GEX is `γ · contracts · spot² · …`, so with no spot `strikeGex()` returns 0 for every row and `fmtGex(0)` is `'--'`. That renders a FULL, correctly shaped ladder with every number replaced by a dash and no error anywhere on the card — which is exactly what "all the numbers in the multi-Greeks tables have disappeared" looks like from the other side. A missing input has to read as a missing input, not as a ladder of flat strikes.

And, at `rows`:

> Drop the ladder rather than draw a wall of dashes: the empty state below says WHY, and a column of `'--'` says nothing at all.

### Elsewhere in the panel

| Slot | Text |
|---|---|
| Spot, loading | `…` |
| Spot, no value and not loading | `—` (em dash) |
| Empty ticker | `TICKER` (the button's fallback label and the input's placeholder) |
| Any cell with value 0 / non-finite | `--` (from `fmtGex`) |

### Tooltips (`title=`), verbatim

| Element | Text |
|---|---|
| ＋ when full | `Four panels is the most this card draws — remove one with its ✕ first` |
| ＋ otherwise | `Add another ticker panel` |
| ⚙ | `` `Board settings — ${BASIS_LABEL[basis]} · ${colCount + (showEx0 ? 1 : 0)} of ${MAX_COLS} col` `` |
| Panel-one ticker | `This panel follows the board's ticker — click to type a symbol and the whole board moves` |
| Added-panel ticker | `This panel's ticker — click to type another symbol` |
| Pinned ticker | `` `${ticker} — this panel is fixed. Add another with ＋.` `` |
| ✕ | `` `Remove the ${ticker} panel` `` |
| Columns SegGroup | `How many EXPIRY columns each panel draws, nearest first. Three is every expiry the chain route returns.` |
| ALL ex-0DTE chip | `Append a total column summing every available expiry except 0DTE — including expiries that have no column of their own. Four columns maximum.` |
| Basis SegGroup | `OI+VOL is open interest plus today's volume; VOL is today's volume alone` |
| intensity slider | `How hard the wash ramps. The top three strikes in a column keep their fixed steps at every setting.` |
| NEAR CORE chip | `Paint only the strikes carrying this share or more of their column's core. Everything under the threshold is left bare; CB / CW / PW always keep theirs.` |
| Near-core dropdown | `The share of the column's core a strike has to carry to be painted` |
| CB / CW / PW chip | `Name the Core Bullseye, Call Wall and Put Wall — the front expiry's badges and the ★ on later expiries. The core's gold stays either way.` |
| CB badge / ★ | `Core Bullseye` |
| CW badge | `Call Wall` |
| PW badge | `Put Wall` |

### `CellCard`

| Row | State | Text |
|---|---|---|
| Δ row | `q.loading && change == null` | `…` |
| Δ row | `change == null` (settled) | `no baseline` |
| Δ row | `past == null` | `building` |
| Δ row | `d === 0` | `—` |
| Δ row | otherwise | `` `${sign}${text}` `` from `fmtGex` |
| Volume / OI | null leg or non-finite | `—` |
| Net Prem / Net Prem (C−P) / Net GEX | null or exactly 0 | `—` |
| Close button | — | `title`/`aria-label` `Close` |

The three Δ states are the point of the card:

> a number — the recorder has a reading that far back; building… — the recorder is up but has not reached that far back yet; no baseline — the recorder is not running (no `DATABASE_URL`, or this ticker/expiry is outside the set it records). v2 collapses the last two into "building…", which reads as "wait a bit" on a board that is never going to fill in.

(The header comment writes "building…"; the rendered string is `building`, no ellipsis.)

---

## Performance notes

- **No canvas, no `ChartFrame`, no `data-cb-layer`.** `scripts/perf-check.mjs` measures repaints per animation frame on tagged canvases only, so this card contributes **nothing** to `budgets.json`'s `perf` numbers (`idleRepaintsPerFrame` 0.15, `offscreenRepaints` 0, `interactionRepaints` 10) — and gets **no automatic offscreen protection either**. Non-negotiable 5 ("a card nobody can see does not paint") is satisfied trivially: the card only re-renders when React state or a poll response changes.
- **The 15s poll is per URL, not per panel.** Four panels on four tickers is four requests every 15s; four panels where two share a ticker is three, because `query()` dedupes by URL. The SPX anchor query is free whenever an SPX panel exists.
- **Hidden tabs do not poll.** `useQuery`'s tick returns early on `document.visibilityState === 'hidden'` and catches up on `visibilitychange`. `background: true` is not set.
- **Everything heavy is memoised** off `q.data`: `parseChain`, `display`/`ex0Source`, `byExp`, `valuesByCol`, `stats`, `rows`, `atm`. A re-render caused by a hover or a cog toggle recomputes none of it.
- **The centring effect runs on every render**, which is by design, but it is cheap: a `querySelector` on one `data-strike` attribute and a bail-out when `|scrollTop − target| < 1`.
- **The ladder is not virtualised.** Every strike in every displayed expiry is a DOM row with `1 + display.length` children. On an SPX chain with `range=all` that is hundreds of rows per panel, times up to four panels. This is the card's real cost and there is nothing in the source that mitigates it.
- **`lazy()` chunking.** The card is its own chunk: "lazy() means a card's code arrives when the card does." `budgets.json` enforces a `route` ceiling of 59,100 brotli bytes.
- **The `CellCard` is portalled** to `<body>` rather than rendered in place, which also keeps it out of the board tile's layout.

---

## Gotchas

1. **`staleMs` is a cache TTL, not a refresh interval.** Both `staleMs` and `pollMs` are set here; drop the `pollMs` and the ladder freezes at whatever it loaded with, silently and forever. `data/api.ts` has a whole paragraph about the confusion this already caused once.
2. **`live=0` must stay on the chains URL.** Remove it and SPX collapses to a single expiry — one column, no across read, no error anywhere — while SPY/QQQ/NDX keep three.
3. **`MAX_EXP_COLS` is 3 because the backend returns 3.** It used to be 4, which made the "4" button silently identical to "3". Do not raise it without changing `fetchChainFull()` upstream.
4. **`'oi'` is a real `Basis` value with no button.** A board that stored `oi` from an older build falls back to `oivol`. `strikeGex` still implements it; `BASIS_LABEL` still names it; nothing selects it.
5. **A missing spot must not be drawn as a ladder of dashes.** `noSpot` and the `rows` bail exist because that exact regression shipped once and read as "all the numbers disappeared."
6. **The page symbol is *not* removed from the stored extras list.** It is hidden at render. Filtering it out at load was the "Multi Greek isn't saving" bug — moving the board onto SPY deleted the SPY panel permanently.
7. **`intensity` and `CB / CW / PW` are the only two controls that are not persisted.** Every other setting survives a reload; those two reset to `1.75` and `on`.
8. **Moving the near-core threshold turns the filter on.** It is not a silent setting.
9. **The `CB / CW / PW` switch does not clear the gold.** `level` is computed regardless of `showLevels`; only the text badge and the ★ are gated. This is deliberate and commented in two places.
10. **The CB wash is `background: gradient, heat` in one property.** Splitting it into `backgroundImage` + `backgroundColor`, or flattening the gradient, reintroduces the bug where a negative core looked identical to a positive one.
11. **`CB_WASH` is duplicated in three files** (`MultiGreekCard.tsx`, `MultiGreekReplay.tsx`, and in spirit `pages/optionsChain/heatSkins.ts`). Changing one does not change the others, and the comments say the duplication is on purpose.
12. **The ATM mark must stay an inset `box-shadow`.** A real border adds 4px of row height and makes the whole ladder jump each time spot crosses a strike.
13. **The scroll container needs `relative`.** Without it `row.offsetTop` is measured from a further ancestor and the ATM row lands a constant offset below centre — which is exactly v2's bug.
14. **The latch listens to `scroll`, not `wheel`/`touchmove`.** Swapping back loses trackpad momentum, Page Up, arrow keys and scrollbar drags, and the ladder yanks back mid-read.
15. **The centring effect has no dependency array on purpose.** Adding one looks like a tidy-up and breaks re-centring after a resize or a column change.
16. **`columnStats` sorts `entries` in place** to build `top3`, after `cb`/`cw`/`pw` have been read. Reordering that function is a silent correctness change.
17. **`fmtGex` returns `'--'` at exactly zero**, with an empty sign — so a genuinely flat strike and a missing strike look the same in a cell. That is why the *column* can be dropped but a cell cannot say more.
18. **There are two `fmtGex` functions in this repo.** `mgMath.ts`'s (`{sign, text}`, no T tier, `$` prefix) and `pages/scanner/gexLevels.ts`'s (one string, T/B/M/K, `digits` argument, no `$`). Both ship; see that file's note 6.
19. **The anchor request is not free when the board is off SPX.** With no SPX panel on screen, `chainsUrl('SPX')` is a real extra fetch that has no poll and will sit on its first response.
20. **The ex-0DTE total column is inert.** `clickable = c.key !== EX0_KEY` — "there is no chain row to open and no baseline to diff — it stays inert rather than opening a card that could only say '—'."
21. **`CellCard` must stay portalled to `<body>`.** `Board.tsx` gives each tile `zIndex: 1`, making every tile its own stacking context, so a z-index set inside a tile can never beat a later sibling tile. Rendered in place the card sat at z-index 60 inside a tile painted at 1 and the GEX chart below covered its bottom half.
22. **`CellCard`'s outside-click listener is bubble phase, not capture.** Capture would close the card before a click inside it reached its own handler, and the close button would stop working.
23. **`GexChange.vNow` is never read.** The deltas are measured from the *live* cell value the ladder is showing, not from the recorder's own "now".
24. **This card has no `ok:false` handling.** An endpoint that answers a soft failure with HTTP 200 will render as "No strikes", not as an error.
25. **The ladder is not virtualised** and four panels of a full SPX chain is a lot of DOM. Nothing in the card guards against it.
26. **The `#n` instance suffix is stripped by `cardTypeOf()`.** A second copy of this card gets `multi-greek#2` — but **every copy reads the same localStorage keys**, so two Multi Greek cards on one board share their panels and settings. Nothing in the card is keyed on `instanceId`; the catalog does not even pass it.
