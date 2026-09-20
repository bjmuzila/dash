# Top Flow — board card reference

| | |
|---|---|
| **Catalog id** | `top-flow` |
| **Label** | `Top Flow` |
| **Icon** | 🐋 |
| **Default grid size** | `{ w: 48, h: 48 }` — the **whole** board width. The catalog comment is explicit: *"Full board width: twelve columns (through Vol and OI) do not fit in half of one, and a card that ships needing a resize ships broken."* |
| **Source folder** | `src/board/topFlow/` |
| **Loaded** | `lazy()` from `src/board/catalog.tsx` |
| **Instance-aware** | **Yes.** `render: (instanceId) => <TopFlowCard instanceId={instanceId} />`. Every cogwheel setting, including the column order, is keyed per copy — "0DTE whales beside the month's biggest is the normal reason to add a second one, and two identical lists is not." |
| **Gallery blurb** | "The whole market's biggest prints, ranked by dollar premium, from one cached vault sweep. Not the Flow Tape: that is one ticker recorded live, this is where the size went today." |

---

## What it is, in one paragraph

Top Flow is the whole options market's biggest prints, pulled from the LSE vault, ranked by dollar
premium and served from **one cached server-side sweep** that the whole site shares. It is
emphatically not a second Flow Tape: the Flow Tape is our own recorder, one ticker at a time,
riding the WebSocket; this is every underlying the vault sees, and the two answer different
questions ("what is SPX doing" versus "where did the size go today"). Twelve columns — time,
ticker, contract, C/P, where the fill sat against the quote, what that means directionally, DTE,
size, price, premium, and the contract's own live volume and open interest — all of which can be
dragged into any order, which is saved per copy of the card. Clicking a row opens the **Contract
Probe** beside the table: what that exact contract did after it printed, drawn from whichever of
two archives actually holds its bars. The card's header carries no LIVE badge, because the vault's
lag behind its own live edge is undocumented; it carries two facts instead — when the server last
swept, and how old the newest print is — and draws no conclusion from them.

---

## File map

Real line counts, `wc -l`, from `voltick-v3/`:

| File | Lines | What it owns |
|---|---:|---|
| `src/board/topFlow/TopFlowCard.tsx` | 917 | The card. The twelve-column table and its drag-to-reorder, the cogwheel popover, the OTM/ALL toolbar switch, the settings blob and its per-field validation, the `/api/lse/top-flow` URL, the VAULT/STALE/ERROR badge, the totals + flow-skew line, the narrow-card probe takeover, and the exported `TopFlowRow`, `FlowSide`, `Bias`, `biasOf`, `biasTitle`. |
| `src/board/topFlow/ContractProbe.tsx` | 830 | The row drawer. Source picking (`probeUrls`, `loadProbeBars`), the two-archive fallback, the range tabs, the pop-out portal, and `ProbeChart` — a hand-written responsive SVG with an ice line over a fading wash, three price rungs, an entry marker, a right-hand price rail, a volume pane and a hover readout. |
| `src/pages/whales/alertsStore.ts` | 292 | The **related page's** tracked-contracts store. `useWhaleAlerts()`, `alertToRow()`, `contractKey()`, and the `/api/whale-alerts` CRUD. Imports `loadProbeBars` and `TopFlowRow` from this card's files — the card's types are the page's types. |
| `src/pages/Whales.tsx` | 1064 | The **related page**, `/whales`: the $1M+ permanent archive. Range presets, SQL roll-ups, session and ticker leaderboards, repeat-strike detection, the contract lookup, and the tracked-contracts card. Mounts the same `ContractProbe` and imports `biasOf` / `biasTitle` from `TopFlowCard.tsx`. |
| `src/data/api.ts` | 239 | `useQuery` — the dedupe + cache + poll layer the card fetches through. **This card is one of the few flow surfaces that does use it**, so it also participates in the toolbar's `refreshAll()`. |
| `src/data/flowData.ts` | 618 | Only `useTick` is used here — the slow clock that keeps the age line counting when the feed stops. |
| `src/data/flowMath.ts` | 703 | `fmtPremium`, `fmtStrike`, `roundStrike`, `fmtTime`, `fmtAgo`, `STALE_AFTER_SEC`. |
| `src/design/primitives/Controls.tsx` | 647 | `SegGroup`, `Chip`, `PanelSection`, `Popover` — the cogwheel is built entirely out of these. |

---

## The data path

### `/api/lse/top-flow` — one cached sweep, filtered per request

```ts
const q = useQuery<TopFlowResponse>(url, { staleMs: 10_000, pollMs: POLL_MS })
const POLL_MS = 20_000   // "Matches the server's cache window — polling faster only re-serves the cache."
```

**The URL.** Built in a `useMemo` that deliberately excludes `s.order`:

```ts
const sp = new URLSearchParams({
  min_premium: String(s.minPremium),
  sort: s.sort,             // 'premium' | 'time'
  limit: String(s.rows),    // 25 | 50 | 100
})
if (s.maxDte !== null)        sp.set('max_dte', String(s.maxDte))
if (s.showUnreadable)         sp.set('sides', 'all')
if (s.moneyness === 'otm')    sp.set('moneyness', 'otm')
return `/api/lse/top-flow?${sp.toString()}`
```

e.g. `/api/lse/top-flow?min_premium=250000&sort=premium&limit=50&max_dte=7&moneyness=otm`

> Column order is presentation only — it must **not** rebuild the URL and refetch the session
> every time a heading is dragged.

**Why every setting is free.** The route holds **one** cached vault sweep for the whole site and
filters it per request (see the block in `server-v2/api-router.js`). Changing Min Premium or Max
DTE re-filters the same cached session rather than firing a vault call. The server's own floor is
the lowest stop this card offers (`$50K` ↔ `TF_BASE_MIN_PREMIUM`), so a setting below it cannot
exist and cannot silently return a short list.

**`staleMs` is not a refresh interval.** `api.ts` is blunt about this: it is a cache TTL — how
long a cached value may be served *without* a refetch, and nothing about when a refetch happens.
`pollMs: 20_000` is what keeps the data arriving. `pollMs` skips a hidden tab (`background` is not
set), and catches up immediately on `visibilitychange` back to visible rather than waiting out the
remainder of a suppressed interval.

**Response shape.**

```ts
interface TopFlowResponse {
  rows: TopFlowRow[]
  count: number
  matched: number                       // how many the filters matched, before `limit`
  sessionDate: string | null            // YYYY-MM-DD, ET
  asOf: string | null                   // when the server last swept
  newestTs: number | null               // epoch ms of the newest print in the session
  baseMinPremium: number                // the server's own floor
  refreshMs: number                     // the server's cache window
  sideAvailable: boolean
  sides: 'directional' | 'all'
  moneyness: 'otm' | 'all'
  excluded: { mid: number; pending: number; stale: number; other: number; itm: number }
  classifyMaxAgeMs: number
  error: string | null                  // ⚠ a 200 can carry this
  statsError: string | null             // ⚠ so can this
}
```

`count`, `asOf`, `baseMinPremium`, `refreshMs`, `sideAvailable`, `sides`, `moneyness` and
`classifyMaxAgeMs` are on the wire and **not read** by the card today. The card reads `rows`,
`matched`, `sessionDate`, `newestTs`, `excluded`, `error` and `statsError`.

**`TopFlowRow` — almost every field is nullable:**

```ts
interface TopFlowRow {
  id: string
  ts: number                  // epoch ms
  osi: string | null          // the vault's own contract key
  underlying: string | null
  type: 'C' | 'P' | null
  strike: number | null
  expiry: string | null       // YYYY-MM-DD
  dte: number | null
  size: number | null
  price: number | null
  premium: number             // the ONE non-nullable number
  spot: number | null
  side: FlowSide | null       // 'above_ask' | 'ask' | 'mid' | 'bid' | 'below_bid'
  action: 'BUY' | 'SELL' | null
  sideReason: string | null   // 'pending' | 'stale' | 'no-price' | 'locked' | 'no-quote' | 'source'
  bid: number | null; ask: number | null
  quoteAgeMs: number | null   // ms between the print and the quote it was judged against
  vol: number | null; oi: number | null    // the contract's LIVE day volume and open interest
}
```

**HTTP-200-on-failure behaviour — this endpoint has two flavours of it, and the card handles them
differently:**

```ts
const failed = Boolean(q.error) || Boolean(q.data?.error)
```

1. **`q.error`** — `useQuery` throws on any non-2xx (`${res.status} ${res.statusText} — ${url}`)
   or on a JSON parse failure. A failed **poll** keeps the last good value on screen and does not
   even set `error`: *"Blanking a chart because one refresh in the middle of the day 502'd is
   worse than showing a number that is thirty seconds old."*
2. **`q.data.error`** — a **200 with an error string in the body**. The vault sweep failed
   server-side and the route answered anyway. This is folded into `failed` and drives the `ERROR`
   badge exactly like a transport failure, with the server's own message on hover.
3. **`q.data.statsError`** — a 200 where the *sweep* worked but the live quote/volume/OI join did
   not. This is **not** `failed`: the rest of the card is fine in that state, so it gets its own
   quiet `no quotes` chip rather than reading as a card error. When it is set, Side, Bias, Vol and
   OI are all blank.

### Side, Buy/Sell, and why they are *captured* rather than looked up

> The vault sends no aggressor and no quote, and its chain endpoint is a live snapshot — so a
> print's side **cannot be looked up after the fact at any price**. The server classifies each
> print against the bid/ask **while it is fresh** and freezes the verdict.

Three consequences, and the card has to show all three rather than collapse them into a blank
cell:

| `sideReason` | Meaning | Cell |
|---|---|---|
| `pending` | The print arrived seconds ago and its quote has not landed yet. It fills in on the next refresh. | `…` |
| `stale` | It arrived while the server was not looking and is now too old to judge. **A side is never guessed against a quote taken minutes later.** | `—` |
| `no-quote` | The contract had no two-sided market when the quote was pulled. | `—` |
| `no-price` | The print carried no readable fill price. | `—` |
| `locked` | The quote was locked or crossed (ask at or below bid) — every price is at-bid and at-ask at once, so there is no read. | `—` |
| `source` | The side came from the data source itself, not inferred from a quote. | `—` |

And `mid` is a **real answer, not a missing one**: it filled between the bid and the ask. Buy/Sell
is `n/a`, deliberately — "calling a mid print a buy because it is a cent above the midpoint is
noise dressed as signal."

Hovering any Side cell gives the bid/ask it was judged against and how many seconds after the
print that quote was taken — the one number that says how much to trust the row:

```
Filled at 12.80. Quote when judged: 12.55 × 12.85 · taken 3s after the print
```

### `/proxy/option-history` and `/api/lse/contract-candles` — the probe's two archives

`probeUrls(row, startMs)` returns **both** candidate routes, best bet first:

```ts
proxy = `/proxy/option-history?ticker=…&expiry=…&strike=…&type=…&start=…&end=…`
vault = `/api/lse/contract-candles?ticker=<osi>&start=…&end=…`
      | `/api/lse/contract-candles?underlying=…&strike=…&expiry=…&type=call|put&start=…&end=…`

// Today's print reads dxLink first; anything older goes to the vault first.
return ymd(row.ts) === ymd(Date.now()) ? [proxy, vault] : [vault, proxy]
```

- `start` is `ymd(row.ts - span.days * 86_400_000)`; `end` is `ymd(Date.now())` for the proxy and
  `ymd(Date.now() + 86_400_000)` for the vault (one day forward, because the vault's range is
  exclusive at the top).
- `strike` goes through **`roundStrike`**, never the raw float: the vault matches on the exact
  string and `504.99999999999994` finds nothing.
- The `osi` form is preferred when the row has one; the four-part form is the fallback.

**Why the choice is made client-side.** This component knows the print's timestamp, and the server
would have to be told it anyway. Both routes answer the same
`{ time, open, high, low, close, volume }` shape, so nothing downstream cares which replied.

**Why it falls back either way — and this is not belt-and-braces:**

> A contract that expired inside the vault's ~120-day window is gone from dxLink long before it is
> gone from the vault, and a 0DTE that printed an hour ago is in dxLink before the vault has it.
> Whichever we ask first, the other one is sometimes the one holding the bars.

The fallback trigger is an **empty answer, not an error**:

```ts
useEffect(() => {
  if (attempt === 0 && q.data && bars.length === 0 && urls[1]) setAttempt(1)
}, [attempt, q.data, bars.length, urls])
```

`attempt` resets to `0` on every `row.id` and every `range` change, or a fallback taken for one
contract sticks to the next.

`bars` is filtered to `b.close > 0` on the way in — a zero close is a hole, not a price.

**Probe fetch options:** `useQuery<BarsResponse>(url, { staleMs: 30_000 })` — **no `pollMs`**. The
probe is a snapshot; it refreshes when you change range or row, not on a clock.

### Endpoint summary

| Endpoint | Cadence | Stale window | Hidden tab | Failure |
|---|---|---|---|---|
| `/api/lse/top-flow` | `pollMs` 20 000 ms | `staleMs` 10 000 ms | skipped, caught up on return | `q.error` **or** `data.error` → `ERROR` badge, last good rows held |
| `/proxy/option-history` (probe) | on demand | 30 000 ms | n/a | empty → try the other route; both empty → an explanatory message |
| `/api/lse/contract-candles` (probe) | on demand | 30 000 ms | n/a | same |
| `/api/whale-alerts` (**page only**) | once per `nonce` | none | n/a | 401/403/404 → card hides itself; other → `error` |
| `/api/lse/whales` (**page only**) | `pollMs` 60 000 ms | `staleMs` 30 000 ms | skipped | last good value held |

---

## Every derived number

### Bias — the read, not the verb

```ts
export function biasOf(r: TopFlowRow): Bias | null {
  if (!r.action || !r.type) return null
  if (r.type === 'C') return r.action === 'BUY' ? 'bullish' : 'bearish'
  return r.action === 'BUY' ? 'bearish' : 'bullish'
}
```

> BUY and SELL are what happened to the **contract**; they are not what the trade says about the
> **underlying**, and reading the raw verb as direction gets two of the four cases backwards.
> A sold put is bullish. A sold call is bearish.

| | |
|---|---|
| BUY CALL | **BULLISH** — long upside optionality |
| SELL CALL | **BEARISH** — short upside; wants flat or lower |
| BUY PUT | **BEARISH** — long downside |
| SELL PUT | **BULLISH** — short downside; wants flat or higher |

The price the print filled at (ask-side vs bid-side) does **not** flip the bias — it only says how
aggressive the participant was. That is why the Side column stays inked by *where the fill sat*
while the Bias column is inked by *what it means*.

`isAggressiveFill(side) = side === 'ask' || side === 'above_ask'` feeds `biasTitle(r, b)`, which
renders one of eight sentences, e.g.

```
Bought calls at or above the ask — BULLISH. Paying up for upside optionality;
profits when the underlying rallies sharply.
```

The Bias cell keeps the raw verb too, faint: `▲ BULLISH BC` — *"the bias is the read, but you
still need to see WHICH of the four trades produced it."*

### Totals and flow skew — over what is **on screen**

```ts
totalPrem = Σ r.premium                                       // dollars, all rows
flowSkew.bull = Σ r.premium where biasOf(r) === 'bullish'     // dollars
flowSkew.bear = Σ r.premium where biasOf(r) === 'bearish'     // dollars
```

> Bucketed by **BIAS, not by the raw verb**: summing BUY against SELL puts every sold put on the
> bearish side of the ledger and every sold call on the bullish one, which is the opposite of what
> they mean. Mid and unreadable prints are in **neither** bucket, by design.

So `bull + bear ≤ totalPrem` always, and the gap is exactly the unreadable and mid premium.

### The hidden count

```ts
const ex = q.data?.excluded
const hiddenCount = ex ? ex.mid + ex.pending + ex.stale + ex.other + ex.itm : 0
```

Only used in the empty state, to tell "the filters ate everything" apart from "there is nothing
there".

### Freshness

```ts
ageSec      = q.data.newestTs ? max(0, (Date.now() - newestTs) / 1000) : null
todayEt     = Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', … }).format(new Date())
liveSession = Boolean(sessionDate) && sessionDate === todayEt
stale       = liveSession && ageSec !== null && ageSec >= STALE_AFTER_SEC     // 180
```

> Staleness only **means** anything while the vault's session is today's. Outside market hours the
> newest print is hours old by definition, and colouring that warn every evening would train the
> eye to ignore the one signal on the card that matters during the day.

`todayEt` is recomputed on `useTick()` rather than once per mount, so the card rolls over at
midnight ET without a remount. `useTick` is also what keeps `ageSec` counting when the feed goes
quiet — nothing else re-renders this card then.

**Why there is no LIVE badge.** The vault serves the trailing week of prints and how far behind
its live edge runs is **not documented** (`md files/LSE-DATA-LIMITS.md`). So the header states two
facts and draws no conclusion: when the server last swept, and how old the newest print is.

### Probe arithmetic (`ContractProbe`)

| Value | Formula | Units |
|---|---|---|
| `entry` | `row.price` | option price |
| `last` | `bars.at(-1).close` | option price |
| `pct` | `((last - entry) / entry) * 100` when `entry > 0` | percent |
| `perCt` | `(last - entry) * 100` | dollars per contract |
| hover `POSITION` | `hp.close * size * 100` | dollars — what the print is worth at that minute |
| hover `OPEN P/L` | `(hp.close - entry) * size * 100` | dollars |
| hover `VS ENTRY` | `(hp.close - entry) * 100` | dollars per contract |
| hover header % | `((hp.close - entry) / entry) * 100` | percent |

Every hover row is conditional on the input it needs — a lookup has no entry and no size, so the
box shrinks to time + mark + volume rather than printing four dashes.

**Where the entry marker goes.** The print timestamp is matched to the **nearest bar open**, not
the first bar at or after it, so a fill a few seconds either side of a boundary lands on the bar
it belongs to:

```ts
slack = max(60_000, (lastT - first) / max(1, n - 1))
if (entryTs < first - slack || entryTs > lastT + slack) return null   // no marker at all
// else argmin |bars[i].time - entryTs|
```

Out of range (an entry before a 3D/1W/1M window starts) draws **no marker** — pinning it to bar 0
would put the dot on a minute it was not printed in.

The dot sits **on the line** (`y(bars[entryI].close)`), not on the dashed rung:

> The fill price and the bar's mark are two different numbers — a print that crossed the spread
> filled at 11.50 while the mark sat at 12.80 — and a dot floating in open space below the line
> reads as a bug. The dashed rung already says WHAT was paid; the dot says WHEN.

**Which volume bars get a number.** A bar qualifies on **both** counts — at least 3× the day's
average bar *and* at least a third of the tallest — capped at four, biggest first, with collision
suppression, and skipped entirely when `n < 6`:
`floor = max(vAvg * 3, vMax * 0.33)`; drop any candidate whose `x` is within `minGap`
(30, or 30 × 1.75 when wide) of one already kept. *"The average alone labels a dead contract's
every twitch; the fraction alone labels nothing on a session with one enormous print."*

**The two archive edges**, both permanent facts and not failed requests:

```ts
const VAULT_FLOOR_MS = Date.parse('2026-01-02T00:00:00Z')
const VAULT_EXPIRY_GRACE_DAYS = 120
beforeArchive = row.ts < VAULT_FLOOR_MS
expiredOut    = Date.now() - Date.parse(`${row.expiry}T00:00:00Z`) > 120 * 86_400_000
```

---

## Controls

### The toolbar: OTM / ALL

A `SegGroup<Moneyness>` — **moneyness at the moment the print hit the tape**, not now.

| | |
|---|---|
| Options | `OTM` — "Only strikes that were out of the money when they printed — calls above spot, puts below it"; `ALL` — "Every strike, in and out of the money" |
| Default | `'all'` |
| Wire | `moneyness=otm` is sent only for `'otm'`; `'all'` sends nothing |
| Stored | inside the settings blob (below) |

> In the **toolbar** rather than the cog: this is the one filter that gets flipped mid-session
> while you are reading the tape, and a control you reach for that often does not belong two
> clicks deep.

### The cogwheel

A `Popover` (`w-56`) of five `PanelSection`s, opened from a 12×12 SVG gear button.

| Section | Control | Options | Default | Wire |
|---|---|---|---|---|
| **Sort** | `SegGroup<SortKey>` | `BIGGEST` (`premium`) — "The session's largest prints by dollar premium — a leaderboard, so rows move as bigger trades land"; `NEWEST` (`time`) — "Most recent first — a tape, newest at the top" | `premium` | `sort=` |
| **Min premium** | `SegGroup<string>` | `$50K` `$100K` `$250K` `$500K` `$1M` | `250_000` | `min_premium=` |
| **Max DTE** | `SegGroup<string>` | `0` (same-day only) · `≤7` (this week) · `≤30` (within a month) · `≤90` (within a quarter) · `ANY` (`null`, no limit) | `null` | `max_dte=`, omitted when null |
| **Rows** | `SegGroup<string>` | `25` `50` `100` | `50` | `limit=` |
| **Prints** | `Chip` `SHOW UNREADABLE` | on/off | `false` | `sides=all` when on |
| **Columns** | drag hint + conditional `RESET ORDER` button | — | `DEFAULT_ORDER` | never sent |

Two standing notes render inside the panel, verbatim:

> `$50K is the floor the server sweeps at — nothing smaller is collected, so no lower setting
> exists.`

> `Filtered on the SERVER, before the row limit — so 50 rows means 50 readable prints, not 50
> minus the mids.`

> `Drag a column heading sideways to move it. The order is saved for this card.`

The `SHOW UNREADABLE` chip's own tooltip: *"Include prints whose side could not be read — mid
fills, and ones that arrived unclassified. Off by default: if you cannot tell which side it was,
it is not a row you can trade off."*

`RESET ORDER` only renders when `orderChanged` — *"a Reset that resets to what you are already
looking at is a dead control."*

### The settings blob

```ts
const settingsKey = (instanceId: string) => `cb-v3-board-topflow:${instanceId}`
```

so `cb-v3-board-topflow:top-flow`, `cb-v3-board-topflow:top-flow#2`, and so on. **Per copy of the
card, not per card type.**

```ts
const DEFAULTS: Settings = {
  minPremium: 250_000,
  maxDte: null,
  sort: 'premium',
  rows: 50,
  order: DEFAULT_ORDER,          // ['time','ticker','contract','cp','side','bs','dte','size','price','premium','vol','oi']
  showUnreadable: false,
  moneyness: 'all',
}
```

Stored as `JSON.stringify(s)` on every change (`useEffect` on `[instanceId, s]`), `try/catch`
swallowed. **There is no version field** — the migration strategy is per-field validation on read.

**How an old stored value coerces.** Each field is validated **on its own**, so *"a stored value
from an older stop list must fall back to the default, not poison the whole object"*:

| Field | Test | Falls back to |
|---|---|---|
| `minPremium` | `PREMIUM_STOPS.some(s => s.value === j.minPremium)` | `250_000` |
| `maxDte` | `DTE_STOPS.some(s => s.value === (j.maxDte ?? null))` — note the `?? null`, so a **missing** key legitimately matches the `ANY` stop | `null` |
| `sort` | `=== 'time' \|\| === 'premium'` | `'premium'` |
| `rows` | `ROW_STOPS.includes(j.rows)` | `50` |
| `order` | `repairOrder(j.order)` — see below | `DEFAULT_ORDER` |
| `showUnreadable` | `j.showUnreadable === true` — a strict identity test, so `"true"`, `1` and `"1"` all read as **off** | `false` |
| `moneyness` | `j.moneyness === 'otm' ? 'otm' : 'all'` | `'all'` |

A missing key, a corrupt JSON body, or storage that throws (private mode, blocked site data) all
land on `DEFAULTS` whole.

### Column drag-to-reorder

```ts
function repairOrder(saved: unknown): string[] {
  // drop ids the catalog no longer has, dedupe, then APPEND any default id that is missing
}
```

Two failure modes, both of which heal silently rather than throw the layout away:

- an id that no longer exists (a column was removed) is **dropped**, not left to render
  `undefined`;
- an id that is **missing** (a column was added since this order was saved) is **appended**.
  Without this, every existing user's card would simply never show a new column — *"a bug report
  nobody can diagnose from the UI."*

> `id` is PERSISTED in the saved order, so renaming one silently resets that user's layout to
> default. Change `label` freely; **leave `id` alone.** (This is why the Bias column's id is still
> `bs` — it was once labelled Buy/Sell.)

**HTML5 drag-and-drop, not pointer events**, and the reason is specific:

> This card lives on a board whose tiles are themselves dragged with pointer events. A
> pointer-based reorder here would be racing the board's own drag for the same gesture.
> `draggable` runs on a different event channel entirely, and the `pointerdown` guard below stops
> the board ever seeing the press that starts a column drag.

```jsx
onPointerDown={(e) => e.stopPropagation()}
onMouseDown={(e) => e.stopPropagation()}
```

`onDragStart` sets `e.dataTransfer.setData('text/plain', c.id)` inside a `try` — *"Firefox refuses
to start a drag with no payload set."* `onDragOver` must call `preventDefault()` — that is what
makes a cell a valid drop target at all.

**Drop semantics** match every spreadsheet: dropping on a column to the **right** of where you
started lands **after** it; to the left, **before** it.

```ts
next.splice(fromIdx < toIdx ? at + 1 : at, 0, from)
```

The drop indicator is a **2px inset box-shadow**, not a border:

> A border would change the cell's width mid-drag and shuffle every heading sideways under the
> pointer.

```
insertAfter ? 'shadow-[inset_-2px_0_0_0_var(--color-accent)]'
            : 'shadow-[inset_2px_0_0_0_var(--color-accent)]'
```

### Row click → the Contract Probe

```ts
const [selectedId, setSelectedId] = useState<string | null>(null)
const selected = selectedId ? rows.find(r => r.id === selectedId) ?? null : null
```

> The **selected id** is held, not the row object: the list re-polls every 20s and a held object
> would freeze the drawer's Vol/OI at whatever they were when it opened, while the row behind it
> kept updating.

And it closes itself when the print filters out from under it:

```ts
useEffect(() => {
  if (selectedId && q.data && !rows.some(r => r.id === selectedId)) setSelectedId(null)
}, [selectedId, rows, q.data])
```

The probe is keyed on the print id (`<ContractProbe key={selected.id} …>`) so switching rows
**remounts** it — otherwise the range tabs and the fallback-source state carry over from the last
contract.

Clicking the same row again toggles it closed.

### The probe's own controls

| Control | Options | Default |
|---|---|---|
| Range tabs | `1D` (0 days back), `3D` (2), `1W` (6), `1M` (29) — measured back from `row.ts`, not from now | `1d` |
| `⤢` / `⤡` | Pops the same panel out over the page, portalled to `<body>` | collapsed |
| `✕` | Closes the probe (or, when expanded, collapses to the column) | — |

Neither is persisted. The pop-out sets `document.body.style.overflow = 'hidden'` while open,
restores the previous value on close, listens for `Escape`, and closes on a click on the scrim.

---

## Rendering

### DOM, with one hand-written SVG

The table is a real `<table className="w-full border-collapse text-2xs">` with a
`sticky top-0 z-[1] bg-bg` `<thead>`. The probe's chart is **inline SVG**, written by hand — no
chart library on this card.

### Colour tokens, with hex from `src/design/tokens.css`

| Token | Hex | Where |
|---|---|---|
| `--color-fg` | `#e7ece9` | ticker, strike, every probe label, the volume bars at 28% |
| `--color-muted` | `#e7ece9` | contract, DTE, size, price, Vol, OI, the `MID` side cell |
| `--color-faint` | `#c0c5c3` | time, header row, the un-sided `…`/`—`, the settings hints |
| `--color-line` | `#1e2630` | row borders, the probe's three price rungs, the volume baseline, the hover box edge, the probe column's left border |
| `--color-raised` | `color-mix(in srgb, #141a21 92%, #e7ece9)` | row hover, the selected row, the badge plate, the hover box header band |
| `--color-bg` | `#0a0d10` | the sticky header's plate, the pill's ink, the hover dot's fill, the pop-out scrim at 90% |
| `--color-surface2` | `#141a21` | the pop-out panel, the hover readout box |
| `--color-up` | `#3ddc8e` | `ASK` / `> ASK` side, a call's C/P and Premium, `▲ BULLISH`, the Bullish total, the probe's `H` marker, positive P/L |
| `--color-down` | `#ff6b7a` | `BID` / `< BID`, a put's C/P and Premium, `▼ BEARISH`, the Bearish total, the probe's `L` marker, negative P/L |
| `--color-accent` | `#2f6bff` | the `VAULT` badge, the cog's open border, the drop indicator, the probe's price line, its wash gradient, the print's own volume bar, the hover marker ring |
| `--color-warn` | `#ffd166` | the `ERROR` / `STALE` badge, the `no quotes` chip, the probe's strike tag, the hover `POSITION` row |

The card carries **no colour literals**. The probe passes colours through `style`, never through
presentation attributes:

> A `var()` in `stroke=""` does not resolve and the chart falls back to black.

And every probe label is `--color-fg`, not a white alpha:

> Chart type sits over a wash and a line, and an alpha that reads fine on a flat card turns to mud
> over the gradient.

### Layout constants

| Constant | Value | Meaning |
|---|---|---|
| Probe column width | `330px` (`w-[330px] border-l border-line`) | Normal, side-by-side mode. |
| Narrow threshold | `720px` (card content width, via `ResizeObserver`) | Below it the probe **takes over** the card: `w-full`, and the table is `display: none`. |
| Table hidden, not unmounted | `style={narrow && selected ? { display: 'none' } : undefined}` | The table's scroll position survives closing the panel. |
| Pop-out panel | `width: min(1100px, 94vw)`, `maxHeight: 92vh`, `zIndex: 9999`, `padding: 24` | Portalled to `document.body`. |
| Cog popover | `w-56` | |
| Badge / chip | `w-[54px]` / `w-[46px]` | Fixed widths so the toolbar does not reflow. |
| Cell padding | `px-1.5 py-1` | Both header and body. |

**The probe SVG is measured, not fixed:**

```ts
W = round(clamp(cw ?? (wide ? 1000 : 320), wide ? 560 : 260, 1600))
H = wide ? round(clamp(W * 0.42, 300, 520)) : round(clamp(W * 0.78, 190, 320))
S = wide ? clamp(1.15 + (W - 560) / 1600, 1.15, 1.45)
         : clamp(1 + (W - 320) / 1600, 1,    1.35)
```

> The svg is `width: 100%`, so a fixed viewBox means the whole picture is scaled by whatever box
> it lands in — and every size in here is in USER units. A 320-unit viewBox in the ~990px pane of
> the tracked-alerts two-up drew the 9px labels at nearly thirty, which is the same bug as the
> board column drawing them at six, just the other way round.

Measuring the container and setting the viewBox width to it keeps one user unit at one CSS pixel.
The fallbacks are the old fixed widths, so the first paint before the observer fires is the chart
it always was rather than a collapsed one. Height is **capped**: a wide pane should get a wider
chart, not a taller page.

Padding is keyed off the type scale (`PS = wide ? 1.3 : 1`) rather than a wide/narrow flag, so the
price rail always has exactly the room its own labels need:
`PADL = 6 + 4*PS`, `PADR = 42 + 14*PS` (*"wide enough for the last-mark pill (38×S) plus its
2-unit offset"*), `PADT = 12 + 6*PS`, `PADB = 18 + 8*PS`, `GAP = 7 + 5*PS`,
`volH = (H - PADT - PADB - GAP) * 0.24`, `priceH` = the rest.

### Why the pop-out is portalled, with inline styles

> Portalled onto `<body>` because every ancestor — the probe column, the card, the board tile —
> clips or stacks, and an overlay drawn inside any of them is trimmed to that box. The four
> properties that decide whether it is visible at all are inline rather than utilities, for the
> same reason the notes clip lightbox does it: this node lives outside the app root, where a
> purged or shadowed class would leave it a 0×0 transparent box and the button would read dead.

### Chart decisions worth naming

- **Three rungs only — high, entry, low.** *"Five lines over a wash is fence, not scale."* With no
  entry the middle rung falls back to `(hi + lo) / 2`.
- **The entry line is part of the domain**, not an annotation: `dom = [...closes, entry]`, then
  13% padding either side. A domain that excludes it draws it off-canvas.
- **H/L labels anchor to the edge** when the extreme is the first or last bar — a centred label
  there hangs half off the canvas and `"H 15.23"` renders as `"15.23"` with the `H` clipped.
- **A tall volume bar's number goes *inside* it**, in white: *"the bar it sits on is the accent
  blue, and dark-on-accent was unreadable at 8.5px (2026-09-14)."*
- **The hover box is clamped on both ends**: `min(W - PADR - BOXW - 2, max(PADL, x + 10))`.
  *"A readout sliding under the rail labels is worse than one that stops moving."*

---

## Performance machinery

- **One cached server sweep.** Every cog setting re-filters it; nothing but a `limit`/`sort`/floor
  change even produces a different URL, and `useQuery`'s dedupe means two Top Flow cards with
  identical settings make **one** request.

- **`pollMs` 20 000 matches the server's cache window.** Polling faster only re-serves the cache.

- **The URL memo excludes `s.order`.** Dragging a heading is presentation only and must not
  refetch.

- **`display: none`, not unmount**, when the probe takes over a narrow card — the table's scroll
  position survives.

- **`useTick()`** is the only unconditional timer, and it drives both the age and the ET-midnight
  rollover.

- **The probe has no poll.** `staleMs: 30_000`, no `pollMs`. A contract chart that re-fetched
  every twenty seconds would be four extra requests per open row for a picture that barely moves.

- **`ResizeObserver` twice**: once on the card wrapper (the 720px narrow threshold) and once
  inside `ProbeChart` (the viewBox width). Both guard `typeof ResizeObserver === 'undefined'`.

- **`volLabels` is a `useMemo`** keyed on `[vols, vAvg, vMax, n, W, PADL, PADR, wide]` — the
  collision pass is O(4 × kept) but it runs on every hover otherwise.

- **`hover` is React state**, deliberately: the readout box is SVG text that has to re-render, and
  at one `mousemove` per frame over ≤ a few hundred bars that is affordable. Contrast the Net
  Premium tooltip, which positions imperatively because its content is a list.

- **Perf budget** (`budgets.json` → `perf`): `offscreenRepaints` is a hard 0. This card owns no
  `<canvas>` at all, so it contributes nothing to the per-frame repaint count — the SVG is DOM and
  is measured by the browser's own compositor, not by `scripts/perf-check.mjs`.

---

## The related page — `/whales`

`src/pages/Whales.tsx` (1064 lines) is the **$1M+ archive**, and it shares this card's types,
its `biasOf` / `biasTitle`, and its `ContractProbe`.

> Where the Top Flow card is "what is printing right now", this is the record: months of it,
> filterable, and the only surface that can answer "has anyone been building this strike".

**It is not a second table.** A whale is a row in `lse_top_flow_prints` with a big enough premium,
and the only thing that makes it permanent is the retention sweep **skipping** it (the "WHALES ARE
NEVER SWEPT" note in `api-router.js`). A second copy of the same print would be a second thing to
keep in step, and the two would disagree the first time a side landed on one and not the other.

**Endpoint.** `/api/lse/whales?from&to&min_premium&sort&limit=300[&ticker][&type][&action][&moneyness=otm][&sides=all][&max_dte]`,
`useQuery(url, { staleMs: 30_000, pollMs: 60_000 })`.

**Its totals are not the table's totals.** Every roll-up is computed in SQL over the **whole**
filtered range; the table renders at most `rowCap` (300). Same split `/proxy/flow-premsplit` makes
for the flow page: *"a total that only counts what fitted on screen is a number that lies
quietly."* So the tiles can legitimately say $8.42B while the table shows 200 rows.

**"Of readable premium."** Bought and Sold only count prints that carry a side; mid and
unclassified prints are in the TOTAL and in neither bucket. The percentage denominator is
`bull + bear`, not `total` — the tiles say so rather than letting the two numbers look like they
should add up to the third.

**The floor clamp.** The page offers `≥$500K` even though the API clamps `min_premium` **up** to
its own floor (`TF_WHALE_FLOOR`, from `LSE_WHALE_FLOOR`, $1M by default): below that line the
table keeps only the last seven days, so a lower ask would hand back a week dressed as an archive.
Rather than let the control look broken, the header says so, reading the floor off the response —
*"lowering `LSE_WHALE_FLOOR` on the VPS retires this note with no code change."*

**Saved filters.** `cb-v3-whales:filters`, per browser, same per-field validation pattern as the
card. Two things deliberately **not** saved: `day` (the session drill-down — scoped to a range you
may not be on next time, so restoring it would open an empty table with no visible cause) and
`selectedId` (the print may not even be in the filtered set next visit). The ticker field is
capped, uppercased and trimmed on read *"so a hand-edited localStorage cannot put a 400-character
ticker in the query."*

### Tracked contracts — `src/pages/whales/alertsStore.ts`

A **tracked contract is a contract you flagged, not a notification.** Nothing fires, nothing
emails: the row sits in a card at the bottom of `/whales` with your note on it, and opening it
draws the same probe the table draws. *"That is the whole promise, and it is worth being exact
about because 'alert' reads like a trigger and this deliberately is not one."*

| | |
|---|---|
| Endpoint | `/api/whale-alerts` — `GET` list, `POST` track, `PATCH /:id` (note or snapshot), `DELETE /:id` |
| Storage | **Postgres, keyed on the login** — not localStorage. Every other remembered thing on the page is per browser and that is right for a question you re-ask each morning; a flagged contract is not that. You flag it on the desktop at 9:44 and you want it on the laptop at lunch. |
| Hidden when | `401` / `403` (not signed in) or `404` (server predates the feature) → `unavailable`, and the card takes itself off the page. Neither is worth a red box on a page that works without it. |
| Expiry | The **server** deletes expired rows on read, so the list is self-cleaning and no client is responsible for pruning. Past its expiry a tracked contract is a dead symbol whose bars the vault will drop anyway. |
| Marks | Lazy, **four concurrent workers**, once per alert, never re-fetched while the page is up. An alert that answers with no bars is recorded as `null` and not asked again — retrying a contract the vault does not have fails the same way every time. A row with no mark prints a dash, not a zero. |
| Snapshot | `loadProbeBars(…, days = 2)` is called **before** the POST and sent with it, so the picture stored is the one that was on screen when you pressed the button. Taking it afterwards would be a second round-trip and a different minute. A contract with no bars still tracks — the note is the point. |
| Optimistic delete | The row goes now and comes back if the server refuses. *"A delete that sits there for 300ms reads as a dead button."* |
| Dedupe key | `contractKey(a) = `${underlying}\|${strike}\|${optType}\|${expiry}`` — the same four fields the table is unique on |

`alertToRow(a)` dresses a tracked row as a `TopFlowRow` so `ContractProbe` can draw it unchanged.
`ts` is `a.printTs ?? Date.now()` — **the probe measures its 1D/3D/1W/1M windows back from this**,
so a tracked print anchors to the print and a tracked lookup anchors to now.

`loadProbeBars` is exported from `ContractProbe.tsx` precisely so the tracked-contracts card does
not grow a second copy of the source-picking logic:

> Two copies of "which route holds this contract" is two things to keep in step, and the copy that
> drifts is the one that quietly stops finding anything.

---

## Phone, expanded and replay behaviour

**Phone.** No phone variant. `useIsPhone()` routes to `src/mobile/`, which has no flow surface.
The card's controls are all `ControlSize` `'sm'`. Twelve columns and a 330px drawer are a desktop
proposition; the `narrow` path (< 720px) exists for a *mis-sized board tile*, not for a phone.

**Expanded.** `Card`'s `⤢` portals the card into the page column's stage. Because a portal moves
the DOM and leaves the React tree where it is, the open probe, the scroll position, the drag state
and the fetched bars all survive. The `ResizeObserver` fires, `narrow` flips back to `false`, and
the probe returns to its 330px column beside a full-width table. Esc collapses. Note the **two
independent expansions**: `Card`'s (the tile fills the page column) and the probe's own `⤢` (a
`position: fixed` portal at `zIndex: 9999` over everything, including the rail and the toolbar).
They compose.

**Replay.** None. The card is always the vault's current session; the archive is `/whales`, which
has range presets rather than a replay transport. The probe's range tabs are the nearest thing,
and they are measured back from the **print's** timestamp, not from now.

---

## Status and empty-state messages, verbatim

### The badge

`tabular w-[54px] rounded-sm bg-raised px-2 py-0.5 text-center text-3xs`, precedence top to
bottom:

| Text | When | Ink |
|---|---|---|
| `ERROR` | `failed` = `q.error \|\| q.data.error` | `text-warn` `#ffd166` |
| `STALE` | `liveSession && ageSec >= 180` | `text-warn` `#ffd166` |
| `VAULT` | `q.data` present | `text-accent` `#2f6bff` |
| `WAITING` | nothing has arrived yet | `text-down` `#ff6b7a` |

Its `title`, in the same precedence:

```
The last sweep failed — showing the last data that arrived. {server message}
Newest print {HH:MM:SS AM} — {ago} ago. This is the feed's live edge, not this card's refresh.
Session {YYYY-MM-DD}, closed. Newest print {HH:MM:SS AM}.
When the server last swept the vault
```

### `no quotes`

`w-[46px] text-2xs text-warn`, only when `q.data.statsError` is set. Title:

```
Live quotes / volume / OI are unavailable, so Side, Buy-Sell, Vol and OI are blank. {message}
```

### The summary line

```
42 of 318 prints   Total $1.24B   Bullish $812.0M · Bearish $431.2M   ≥$250K · ≤7 DTE · OTM
```

- `{rows.length} prints`, with ` of {matched}` in `text-faint` only when `matched > rows.length`
- `Total {fmtPremium(totalPrem)}`
- `Bullish … · Bearish …`, tooltip: *"Premium positioned for a move UP (calls bought, puts sold)
  vs positioned for a move DOWN (calls sold, puts bought), across the rows on screen. Mid and
  unreadable prints are in neither."*
- the active-filters echo: `≥{fmtPremium(minPremium)}`, ` · ≤{maxDte} DTE` when capped,
  ` · OTM` when OTM

### The four empty states

`px-1.5 py-3 text-xs text-faint`. *"An empty list has three causes and they are not the same
problem."* (Four, counting loading.)

| Text | When |
|---|---|
| `The vault sweep failed — nothing to show yet.` | `failed` |
| `Loading…` | `q.loading \|\| !q.data` |
| `Nothing left after filtering — {n} prints hidden. Try ALL in the toolbar, or SHOW UNREADABLE in the cog.` | `hiddenCount > 0`. With ` (the quote feed is down, so nothing can be classified)` appended after `hidden` when `statsError` is set. |
| `No prints match these filters yet.` | everything else |

### Side-cell reason tooltips (`REASON_TITLE`)

```
pending   Just printed — the quote it will be judged against has not landed yet. It fills in on the next refresh.
stale     This print arrived while the server was not watching, and is now too old to judge. A side is never guessed against a quote taken minutes later.
no-quote  The contract had no two-sided market when the quote was pulled.
no-price  The print carried no readable fill price.
locked    The quote was locked or crossed (ask at or below bid) — every price is at-bid and at-ask at once, so there is no read.
source    The side came from the data source itself, not inferred from a quote.
```

An unknown reason string is rendered as itself (`REASON_TITLE[reason] ?? reason`).

The Bias cell's fallback tooltip when there is no bias:

```
Filled between the bid and the ask — genuinely ambiguous, so no direction is called
```

### Header tooltips

| Column | Tooltip (suffixed with ` — drag to reorder`, or just `Drag to reorder` when there is none) |
|---|---|
| `Side` | `Where the fill sat against the bid/ask at print time` |
| `Bias` | `What the print says about the UNDERLYING, not the contract. Buying calls or selling puts is bullish; selling calls or buying puts is bearish. Mid is not a read` |
| `Vol` | `The contract's own volume so far today` |
| `OI` | `The contract's open interest` |

Row tooltip: `Open the contract's chart`.

### The probe's messages

| Text | When |
|---|---|
| `Loading…` | `q.loading` and fewer than 2 bars |
| `This print is older than the contract archive, which begins 2026-01-02. There are no bars for it and there will not be.` | `row.ts < VAULT_FLOOR_MS` |
| `This contract expired more than ~120 days ago and has aged out of the archive. Nothing to draw.` | `expiredOut` |
| `Could not load bars — {message}` | `q.error` |
| `No bars for this contract in the window.` | everything else |

The source chip beside the range tabs reads `loading…`, then `vault` when
`q.data.source === 'lse'`, then `live`, then nothing.

The probe footer:

```
Option price (mark) · contract volume · entry @ {price} · printed {HH:MM AM}
```

with ` · click outside or press Esc to close` appended when popped out.

### The CopyShot caption

```jsx
data-capture-meta={`whole market · ${s.sort === 'premium' ? 'biggest' : 'newest'} · ≥${fmtPremium(s.minPremium)}${s.maxDte === null ? '' : ` · ≤${s.maxDte} DTE`}`}
```

e.g. `whole market · biggest · ≥$250.0K · ≤7 DTE`.

---

## Gotchas

- **A 200 can be a failure, twice over.** `q.data.error` means the vault sweep failed and the
  route answered anyway; `q.data.statsError` means the *quote join* failed while the sweep
  succeeded. The first is folded into `failed`; the second deliberately is **not**, because the
  rest of the card is fine and a card-level error badge would be a lie.

- **`sideReason` is not a failure code.** `mid` is a real answer with no `sideReason` at all, and
  `source` means the side is *more* trustworthy than usual, not less.

- **Never sum BUY against SELL for direction.** `biasOf` exists for exactly this. Every sold put
  is bullish and every sold call is bearish, so a naive buy/sell ledger is 50% backwards.

- **`bull + bear` does not equal `totalPrem`**, and is not supposed to. Mid and unreadable prints
  are in neither bucket.

- **`showUnreadable` filters on the SERVER, before the row limit.** 50 rows means 50 readable
  prints, not 50 minus the mids. Anyone reimplementing the filter client-side will silently
  shorten every page.

- **Column `id`s are persisted.** Renaming `bs` to `bias` would reset every existing user's column
  order to default, silently. Change `label`, never `id`.

- **The URL memo must not include `s.order`.** Including it refetches the whole session on every
  drag frame.

- **The board tile steals the drag without `stopPropagation`.** `onPointerDown` **and**
  `onMouseDown` on each `<th>` — both, because the board's own drag listens on one and some
  browsers still synthesise the other.

- **`roundStrike` before any `?strike=`.** Strikes arrive as floats and a 505 call arrives as
  `504.99999999999994`. The vault matches on the exact string and finds nothing. `fmtStrike` is
  the display form; `roundStrike` is the number you send.

- **An empty probe answer is not an error — it is the other archive's turn.** `attempt` must reset
  on both `row.id` and `range`, or a fallback taken for one contract sticks to the next.

- **`<ContractProbe key={selected.id}>` is load-bearing.** Without the key, switching rows leaves
  the previous contract's range tab and fallback-source state in place.

- **Hold the selected *id*, not the row.** The list re-polls every 20 seconds; a held object
  freezes Vol/OI while the row behind it keeps updating.

- **`row.vol === null && row.oi === null` means "no now for this contract"**, not "a value is
  missing". The probe omits the pair entirely rather than printing two permanent dashes: *"A dash
  means 'this should have a value and does not'; on that surface they never will, which is a
  different statement."*

- **The probe SVG's viewBox must track its container.** A fixed viewBox scales every user unit,
  so 9px labels render at 30px in a wide pane and at 6px in a board column. Both bugs shipped.

- **`entryAt` is tri-state.** `undefined` → use `row.ts` (the normal case); `null` → draw the
  entry as a rung with **no marker** (a hand-typed cost basis with no moment behind it);
  a number → use that. Passing `0` would put the dot on the epoch.

- **Two copies have separate settings and separate URLs** — which is the point — but they still
  share `useQuery`'s cache by URL. Configured identically they make one request; configured
  differently, two. Every setting is validated by **membership in its option list**
  (`PREMIUM_STOPS.some(…)`, `ROW_STOPS.includes(…)`), so retiring a stop silently resets that one
  field and nothing else.
