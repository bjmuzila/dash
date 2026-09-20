# Flow Tape — board card reference

| | |
|---|---|
| **Catalog id** | `flow-tape` |
| **Label** | `Flow Tape` |
| **Icon** | 🌊 |
| **Default grid size** | `{ w: 48, h: 48 }` — the **whole** board width (48 of 48 columns), 48 rows × `BOARD_ROW_H` (8px) |
| **Source folder** | `src/board/flowTape/` |
| **Loaded** | `lazy()` from `src/board/catalog.tsx`. The catalog header calls this one out by name: *"the Flow Tape pulls the whole print table and its contract drawer"* — a static import would put all of that in the board's route chunk and every user would pay for a card they do not have. |
| **Instance-aware** | No. `render: () => <FlowTapeCard />`. Two copies share one localStorage key and show the same thing. |
| **Gallery blurb** | "The live print table, one ticker at a time, with a minimum-premium floor pushed into the query so raising it keeps the biggest prints of the session rather than the most recent." |

---

## What it is, in one paragraph

Flow Tape is the `/flow` page's fifteen-column print table, mounted as a board card. It is **the
same table, not a smaller one**: `src/pages/flow/FlowTape.tsx` exports one `Tape` component and
both the page and the card import it, so every column, every header tooltip, every whale
expansion and the contract drawer hanging off it are identical in both places. The card's job is
to supply the inputs — it follows the board's page symbol, always reads today's ET session,
merges the socket's live `flow` frame into a REST backfill of the same session, applies one fixed
filter set (both sides, both types, **OTM only**, every expiry, no DTE window) and one control (a
six-stop Min Premium slider), caps the render at 250 rows, and prints a totals line plus a
staleness read above the table. Everything else — the filter panel, the Combined/All-tickers view,
the date picker, the net-drift chart — belongs to the page. The card is a glance at what is
printing; the page is where a filter chain belongs.

---

## File map

Real line counts, `wc -l`, from `voltick-v3/`:

| File | Lines | What it owns |
|---|---:|---|
| `src/board/flowTape/FlowTapeCard.tsx` | 320 | The card. The six-stop slider and its draft/commit machinery, the localStorage key, the fixed `FlowFilters`, the merge and the ticker gate, the 250-row cap, the totals line, the staleness read, the LIVE/WAITING/ERROR chip, and the `data-capture-meta` caption. |
| `src/pages/flow/FlowTape.tsx` | 273 | **The shared table.** Exports `Tape` (the grid, the header row, the "showing newest N of M" footer, the three empty states) and `TapeRow` (one print, its fifteen cells, the whale click target and the lazy `ContractDrawer` mount), plus the `Row` type. Imported by the board card *and* by the `/flow` page. |
| `src/pages/flow/ContractDrawer.tsx` | 538 | The in-place whale expansion, `lazy()`-imported from inside `Tape`. A pan/zoomable contract chart off `/proxy/option-history`, since-fill peak/trough tracking, and Vol/OI + IV/%OTM tiles. |
| `src/data/flowData.ts` | 618 | `useFlowHistory` (two-stage backfill + 45s merge poll), `useContractStats` (grouped Vol/OI/IV), `useLiveSpots` (two-source spot, for the live %OTM column), `useTick` (the slow clock). |
| `src/data/flowMath.ts` | 703 | `passesFilters`, `mergeTape`, `printIdentity`, `sumTotals`, `normTicker`, `dteOf`, `isBullish`, `WHALE_FLOOR`, `MAX_TAPE_ROWS`, `STALE_AFTER_SEC`, and every formatter the table prints with. Transcribed 1:1 from v2's `components/pages/Flow.tsx`; the spec of record is `docs/parity/flow.md`. |
| `src/contract/frames.ts` | 258 | The wire contract. `FlowTapePrint`, `FlowData`, `FlowFrame`, transcribed field-for-field from `server-v2/computation/flow-processor.js`. **Nothing in `src/` may reach for a field that is not in this file.** |
| `src/data/symbol.tsx` | 111 | The page symbol the card follows, and the note explaining why Flow Tape is the exception with no per-ticker socket path. |
| `src/design/primitives/Card.tsx` | 238 | The `CardToolbar` portal the card's controls land in, and the one-row `h-8` header they must fit inside. |

---

## The card vs the page — what actually differs

Both mount the identical `Tape`. Everything that differs is a prop or a hook argument.

| | Board card (`FlowTapeCard`) | `/flow` page |
|---|---|---|
| Table component | `Tape` from `pages/flow/FlowTape.tsx` | the same `Tape` |
| `view` prop | `'ticker'` — 15 columns, `minWidth: 1116` | `'ticker'` or `'combined'`; combined prepends a 64px Ticker column, `minWidth: 1180` |
| `cap` prop | `CARD_MAX_ROWS = 250` | `MAX_TAPE_ROWS = 800` |
| Date | `todayYmdET()`, always; `isToday` hardcoded `true` | a date picker; `isToday` computed |
| Min Premium | six detents `[0, 50K, 100K, 250K, 500K, 1M]`, default index 2 | continuous slider, `0 … PREMIUM_MAX (1M)` step `PREMIUM_STEP (10K)`; Combined view widens to `PREMIUM_MAX_COMBINED (5M)` step `PREMIUM_STEP_COMBINED (50K)`; default `DEFAULT_MIN_PREMIUM = 15_000` |
| Side / type / size / expiry / DTE | fixed: `all` / `all` / `0` / `all` / none | a full filter panel |
| `otmOnly` | `true`, fixed | toggleable |
| Totals | `sumTotals(filtered)` — summed client-side over the filtered rows | prefers `/proxy/flow-premsplit`, aggregated in SQL over the **whole** filtered session |
| Net-drift chart | none (that is the separate Net Premium card) | `NetDriftChart`, fed by `useNetPremBins` |
| Recent tickers | none | `cb-v3-flow-recent-tickers`, `RECENT_TICKERS_MAX = 7` |

> The card's totals are the one place it is deliberately *less* correct than the page. `sumTotals`
> runs over `filtered` — every row that passed the filter, **before** the 250-row render cap — so
> the header counts the whole filtered session for this ticker and not just what is on screen. But
> `filtered` itself comes off the REST backfill, which is capped server-side at 20 000 rows. The
> page's SQL split has no such cap. On a busy ticker the two can disagree, and the page is right.

---

## The data path

### 1. `/proxy/flow-history` — the session backfill (`useFlowHistory`)

```ts
const { tape: history, switching, error } = useFlowHistory(active, date, minPremium, true)
```

Note the third argument: this card passes the **slider's** current stop, not a fixed noise floor.
That is the whole point of the slider — the floor is pushed into SQL, so raising it makes the
server's 20 000-row cap keep the **biggest** prints of the session rather than the most recent
slice.

**Query.**

```
/proxy/flow-history?underlying=SPX&date=2026-09-20&minPremium=100000&limit=1000
/proxy/flow-history?underlying=SPX&date=2026-09-20&minPremium=100000&limit=20000
```

`minPremium` is omitted entirely when the stop is `0` ("Any") — `qs()` drops any value that is
`undefined`, `null` or `''`, and the hook only passes it when `minPremium > 0`.
`credentials: 'same-origin'` on both.

**Per-ticker, not a bare newest-N.** With the full roster recording, an unfiltered cap drops a
single ticker's early prints — it looks like "history starts at 11am", with no error.

**Two-stage.** `limit=1000` newest-first paints the tape immediately; `limit=20000` lands behind
it and **replaces** the slice. A `full` flag guards the ordering — if the big pull wins the race,
the small one is stale and must not clobber it.

**Timing.**

| | |
|---|---|
| First run after mount | `setTimeout(run, 0)` — immediate. The 400ms debounce exists for slider drags; paying it on mount just delays first paint for nothing. |
| Every later run (ticker or floor change) | `setTimeout(run, 400)` |
| Refresh poll | `setInterval(refresh, HISTORY_POLL_MS)`, `HISTORY_POLL_MS = 45_000` |
| Refresh while the tab is hidden | skipped (`document.visibilityState === 'hidden'` → return) |

**Why it polls at all** — the header comment is explicit, and it is the single most important
sentence in this file:

> This used to fetch exactly once per (ticker, date, floor) and then rely entirely on the socket's
> `flow` frame for everything after page load. That is fine right up until the socket goes quiet —
> and then the tape freezes at the moment the page opened and there is NOTHING on screen that says
> so. A market that has genuinely stopped printing and a feed that has stopped arriving look
> identical, which is the worst property a live panel can have.

**The refresh merge.** The poll asks for `limit=1000` only and merges into what is held, keyed on
`printIdentity(o) = ${o.ts}|${o.symbol}|${o.side}` — the same identity `flow_prints` uses as its
PRIMARY KEY — with the **persisted** version winning (it is the coalesced one), sorted ascending
by `ts`. The expensive 20k pull still only happens on a real change of ticker, date or floor.

**Response shape.**

```ts
interface FlowHistoryResponse { date: string; tape: FlowTapePrint[] }
```

**HTTP-200-on-failure behaviour.** `r.ok ? r.json() : null`, then `j && Array.isArray(j.tape)`.
A non-2xx, **or** a 200 whose body is not `{ tape: [...] }`, sets `error = true` and leaves the
held tape alone. A failed refresh keeps what is on screen — one failed refresh must not blank a
tape. `error` is what drives the toolbar's `ERROR` chip, so a caller can say "the feed is down"
instead of drawing a flat line.

### 2. The socket `flow` frame

```ts
const flowFrame = useFrame<FlowFrame>('flow')
const liveTape  = flowFrame?.data.tape ?? []
const status: 'LIVE' | 'WAITING' = flowFrame ? 'LIVE' : 'WAITING'
const merged    = mergeTape(history, liveTape, true)
```

`useFrame` re-renders on **every** message of that type. The envelope is `{ type, symbol, ts, data }`
(`msg()` in `server-v2/websocket-server.js`); `data` is `FlowData`:

```ts
interface FlowData {
  symbol: string; windowMs: number; asOf: number
  callBuyVol: number; callSellVol: number; putBuyVol: number; putSellVol: number
  netPremium: number; buyPct: number; prints: number
  tape: FlowTapePrint[]
}
```

The card reads **only** `data.tape`. The aggregate scalars (`netPremium`, `buyPct`, `prints`) are
on the wire and deliberately ignored — the card's own totals come from `sumTotals` over the merged
rows, which is the number that matches the table underneath it.

`bucket()` in `flow-processor.js` ships `this.tape` filtered to `premium >= tapeFloorPremium` and
nothing else, so what arrives is exactly `FlowTapePrint[]`.

> **The socket streams exactly one underlying: `SOCKET_SYMBOL = 'SPX'`.** `src/data/symbol.tsx`
> names Flow Tape as *the* exception with no second path: "the `flow` frame is SPX prints and
> there is no per-ticker source for them." That is true of the *live* leg only — the REST backfill
> *is* per-ticker — so on an AMZN board the `normTicker(o.underlying) === active` gate drops every
> live print and the card runs off the 45-second REST poll. The `LIVE` chip still says LIVE,
> because the socket is connected and delivering; it is not claiming those prints are AMZN's.

`mergeTape(history, live, isToday)` — persisted ∪ live, deduped by `printIdentity`, **live
winning**, ascending by `ts`. Live is only merged when `isToday`; this card always passes `true`.

### 3. `/proxy/contract-stats` — the Vol / OI / IV columns (`useContractStats`)

A tape print carries only what was true at **print time**. "What is this contract doing right now"
needs a live chain lookup, and doing that per row would be hundreds of calls.

```
/proxy/contract-stats?groups=SPX%3A2026-09-20%2CSPY%3A2026-09-22
```

**Grouping.** One `(ticker, expiry)` pair per distinct expiry **on screen**, built from
`visibleRows` (the 250 the card renders), not from the whole filtered set. Most tapes collapse to
a handful of groups.

**Ranking and the cap.** Groups are ranked by **how many rows want each one**, then sliced to
`MAX_GROUPS = 16`, then sorted alphabetically and joined with `,` to make a stable key. Ranking
first means the cap drops the long tail of one-off expiries rather than an arbitrary slice.
`MAX_GROUPS` mirrors `CONTRACT_STATS_MAX_GROUPS` server-side; asking for more is truncated there
anyway.

**Cadence.** `setTimeout(load, 200)` on key change, then `setInterval(load, STATS_POLL_MS)`,
`STATS_POLL_MS = 20_000`. No visibility guard.

**Response shape.**

```ts
{ stats: { "<TICKER>|<YYYY-MM-DD>": { "<strike>|<C|P>": ContractStat } } }

interface ContractStat {
  vol: number | null
  oi: number | null
  iv: number | null    // DECIMAL from the API (0.184) — callers own the ×100
  mark: number | null  // present on the wire, not read by the tape
}
```

Note the group key is built with a colon (`${root}:${expiration}`) for the **query**, and read
back with a pipe (`stats[`${root}|${expiration}`]`) from the **response**. That asymmetry is the
server's, and it is easy to break by "tidying" one side.

**Merged, never replaced.** `setStats(prev => ({ ...prev, ...j.stats }))`. A group that scrolls off
keeps its last-known values, so scrolling back does not flash an em dash. A failed poll (`!r.ok`
→ silent return, or a thrown fetch → empty catch) leaves prior stats in place for the same reason.

### 4. `/proxy/quotes` → `/api/quotes-batch` — the live % OTM column (`useLiveSpots`)

A print's own `spot` is frozen at print time, so a strike that has since gone ITM would still read
as OTM without this.

```
/proxy/quotes?symbols=SPX%2CSPY%2CQQQ            ← Theta, tried first
/api/quotes-batch?symbols=SPX%2CSPY%2CQQQ        ← Yahoo-backed, fallback
```

The key is `[...new Set(tickers.filter(Boolean))].sort().join(',')` over `visibleTickers` — only
tickers actually on screen are fetched. On this card that is almost always exactly one.

**Cadence.** `setTimeout(load, 200)` then `setInterval(load, 15_000)`.

**Parsing.** Both routes answer the same shape; the parser reads `d?.data?.items ?? []` and keeps
`{ [symbol.toUpperCase()]: Number(last) }` for every item where `last > 0`.

**Fallback chain.** `/proxy/quotes` non-ok → **throw** → try `/api/quotes-batch`. That second one
non-ok → silent return. Both failing → `/* keep prior spots */`. Merged, never replaced
(`setSpots(prev => ({ ...prev, ...map }))`), and only when the parsed map is non-empty.

### 5. `/proxy/option-history` — the whale drawer (`ContractDrawer`)

Fired only when a row whose `premium >= WHALE_FLOOR (500_000)` is clicked.

```
/proxy/option-history?ticker=SPX&expiry=2026-09-20&strike=6300&type=P
  &start=<fill date>&end=<fill date | today>&symbol=.SPXW260920P6300
```

`symbol` is the row's own dxFeed streamer symbol and is **load-bearing**: server-side
reconstruction can only *guess* at the root — SPX monthlies stream under `SPX`, weeklies under
`SPXW`. That is one of the three reasons `FlowTapePrint.symbol` exists at all (the others being
the dedupe key and the expansion key).

Two timeframes, both anchored to the print and both intraday: **Today** (the print's own session)
and **All** (its session → now). When `fillDate === todayEt` the two are identical, so **All is
not offered**. There is deliberately no 30D/90D: history from *before* the order printed says
nothing about how the order did, and it drags the price axis until the interesting part is a flat
line.

**HTTP-200-on-failure.** The drawer is the one place that reads the body on failure:
`const j = await r.json().catch(() => null); if (!r.ok) throw new Error(j?.error ? String(j.error).slice(0,160) : `HTTP ${r.status}`)`.
The route puts the upstream message in `error` on a 502, and surfacing it beats a bare "HTTP 502"
that says nothing about what broke. A 200 with no `bars` array yields `[]`, which renders as the
drawer's own empty state rather than an error.

### Endpoint summary

| Endpoint | Cadence | Hidden tab | Failure |
|---|---|---|---|
| `/proxy/flow-history` `limit=1000` | 45 000 ms | skipped | `error = true`, tape held, chip reads `ERROR` |
| `/proxy/flow-history` `limit=20000` | once per (ticker, date, floor) | n/a | same |
| socket `flow` | push | n/a | frame stops; the `last … ago` line is what says so |
| `/proxy/contract-stats` | 20 000 ms, +200ms kick | runs anyway | silent; prior stats held |
| `/proxy/quotes` → `/api/quotes-batch` | 15 000 ms, +200ms kick | runs anyway | silent; prior spots held |
| `/proxy/option-history` | once per (row, timeframe) | n/a | message rendered in the drawer |

None of these go through `src/data/api.ts`'s `useQuery`, except the drawer's chart (which uses a
raw `fetch` too). So the toolbar's ↻ `refreshAll()` broadcast does **not** reach this card.

---

## Every derived number

### The premium floor

```ts
const PREMIUM_STOPS = [0, 50_000, 100_000, 250_000, 500_000, 1_000_000] as const
const minPremium    = PREMIUM_STOPS[stop]  ?? 0    // what the data reads
const draftPremium  = PREMIUM_STOPS[draft] ?? 0    // what the thumb shows
```

Units: dollars of order premium (`price × size × 100`, computed server-side).

### The ticker gate and the two derived sets

```ts
own      = merged.filter(o => normTicker(o.underlying) === active)
filtered = merged.filter(o => normTicker(o.underlying) === active
                           && passesFilters(o, filters, date)).reverse()
```

`own` is **every print for this ticker, before the premium floor**. It exists only to drive the
staleness read — "when did anything last print" must not move when the slider does, or raising the
floor would look like the feed dying.

`filtered` is newest-first, which is the order a tape is read in. Note `.reverse()` on the
ascending-by-`ts` merge, not a comparator — `mergeTape` already sorted.

### `passesFilters(o, f, sessionYmd)`

Order is v2's, and it matters only for cost, not for the answer:

```
side     : f.side !== 'all' && o.side !== f.side           → reject
type     : f.optType !== 'all' && o.type !== f.optType     → reject
otm      : f.otmOnly && !o.isOtm                           → reject
premium  : Number(o.premium || 0) < f.minPremium           → reject
size     : Number(o.size || 0) < f.minSize                 → reject
expiry   : f.expiry !== 'all' && o.expiration !== f.expiry → reject
dte      : if f.dteMin > 0 || f.dteMax != null:
             d = dteOf(o.expiration, sessionYmd)
             d == null        → reject      (an undated print cannot satisfy "0 to 7 days")
             d < f.dteMin     → reject
             f.dteMax != null && d > f.dteMax → reject
```

On this card only the **OTM** and **premium** clauses can ever reject: the other five are set to
their pass-everything values.

> **`!o.isOtm` correctly rejects `null`.** `isOtm` is tri-state on the wire —
> `flow-processor.js` writes `null`, never `false`, when the underlying spot is unknown, because
> `false` is a *claim* ("this print was in the money") and there is nothing to make it from. On
> **2026-08-14** a stuck spot wrote `is_otm=false` for a whole midday SPX session and an OTM-only
> filter deleted the day. An unknown moneyness is not an OTM print — but it must stay
> distinguishable from a real ITM one.

### `dteOf(expiration, sessionYmd)`

```
dte = round((Date.parse(`${expiration}T00:00:00Z`) - Date.parse(`${sessionYmd}T00:00:00Z`)) / 86_400_000)
```

**Relative to the session date being viewed, not to "today".** Measuring from today's midnight
made every past session's 0DTE flow go negative on lookback (a 7/29 expiry viewed on 7/30 scored
−1), so any active DTE filter — including the 0–7DTE ≥$500K preset, whose `dteMin` of 0 rejects
anything negative — silently dropped the whole 0DTE tape for that day. It looked correct live and
wrong the moment the date rolled over. Both sides parse as UTC midnight so the subtraction is a
clean whole-day count with no DST drift. Must stay in step with `buildFlowPrintsWhere()`'s
`dteMin`/`dteMax` SQL in `server-v2/server-with-proxy.js`.

### `sumTotals(rows)` — the header line

One pass over `filtered`, in **dollars**:

```
prem     = Σ premium
callPrem = Σ premium where type === 'C'
putPrem  = Σ premium where type === 'P'
buyCall  = Σ premium where type === 'C' && side === 'buy'
sellCall = Σ premium where type === 'C' && side !== 'buy'
buyPut   = Σ premium where type === 'P' && side === 'buy'
sellPut  = Σ premium where type === 'P' && side !== 'buy'
count    = rows.length
```

The card prints `count`, `prem`, `callPrem`, `putPrem`. The four buy/sell legs are computed and
unused here — the `/flow` page's four split cards are what consume them.

### Per-row derived values (in `TapeRow`)

| Value | Formula | Units |
|---|---|---|
| `identity` | `${o.ts}\|${o.symbol}\|${o.side}` | the expansion key **and** the dedupe key |
| `whale` | `Number(o.premium \|\| 0) >= WHALE_FLOOR` (`500_000`) | boolean — bold premium, `▸` prefix, `cursor-pointer`, expandable |
| `bull` | `isBullish(side, type)` = `(buy && call) \|\| (!buy && !call)` | boolean — buy calls / sell puts is bullish |
| `d` (DTE) | `dteOf(o.expiration, date)` | calendar days |
| `liveSpot` | `spotByTicker[o.tickerNorm] ?? o.spot ?? 0` | price — live first, print-time second, 0 = unknown |
| `otmPct` | `((type === 'C' ? strike - liveSpot : liveSpot - strike) / liveSpot) * 100` when `liveSpot > 0 && strike`, else `null` | percent; **+ = still OTM, − = has gone ITM since the print** |
| Cost/Ctr | `fmtContractCost(o.price)` = `price * 100` | dollars — the cost of **one** contract, distinct from the order's total Premium (`price × size × 100`) |
| IV cell | `stat.iv * 100`, one decimal | percent — the API sends a decimal (`0.184`) and callers own the ×100 |

### The staleness read

```ts
lastTs = max(o.ts) over `own`   // every print, at any premium
ageSec = lastTs == null ? null : max(0, (Date.now() - lastTs) / 1000)
stale  = ageSec != null && ageSec >= STALE_AFTER_SEC     // 180
```

`STALE_AFTER_SEC = 180`. Three minutes — **not an error**: a genuinely quiet name goes minutes
between prints and that is information too. It is the line past which "nothing is happening" and
"nothing is arriving" stop being distinguishable by looking.

`useTick()` (15 000 ms default) drives it. Once the feed stops there is nothing else to re-render
this card, so an age that only recomputed on new data would freeze at whatever it last said.
`tick` sits in the `useMemo` dep array as a **trigger, not an input**, with an explicit
`eslint-disable-next-line react-hooks/exhaustive-deps`.

### Formatters

| Function | Output | Notes |
|---|---|---|
| `fmtPremium(v)` | `$1.23M` / `$45.6K` / `$789` | negatives get `-`; positives get **no** `+` |
| `fmtStat(v)` | `1.2M` / `45.6K` / `1,234` / `—` | threshold is **10K**, not 1K, so four-digit volumes stay readable in full. `null` renders `—`, never `0` — the chain snapshot has not produced this contract yet (pre-open, or a strike outside the snapshot), and `0` would read as a real "no interest here" |
| `fmtContractCost(p)` | `$1.23M` / `$45.6K` / `$7.89` | `p * 100` |
| `fmtSpot(s)` | `6,301.25` / `—` | 2 fraction digits; `0` and `undefined` both read as unknown |
| `fmtTime(ts)` | `09:31:04 AM` | ET, `en-US`, 2-digit h/m/s |
| `fmtAgo(sec)` | `12s` / `5m` / `1h 4m` / `—` | coarse on purpose |

---

## Controls

### The Min Premium slider — the card's only control

Six detents rather than the page's continuous 0…$1M range:

```ts
const PREMIUM_STOPS = [0, 50_000, 100_000, 250_000, 500_000, 1_000_000] as const
const DEFAULT_STOP  = 2   // $100K
```

> On a board the slider is 110 pixels wide and a continuous range at that size is a guessing game;
> six labelled detents land on the number you meant every time.

$100K is the default because it is high enough that the card is a list of prints worth reading at
a glance, and low enough that a normal SPX session still fills it. (The page's default is
`DEFAULT_MIN_PREMIUM = 15_000`, kept deliberately low because the server coalesces fills in a
short window and real SPX 0DTE flow is mostly many sub-$50K orders.)

**Storage.**

| | |
|---|---|
| Key | `cb-v3-board-flowtape-stop` |
| Value | the **index**, as a decimal string: `"0"`…`"5"`. Not the dollar amount. |
| Written | `useEffect` on every change of `stop` (the committed value), `try/catch` swallowed |
| Read | `loadStop()`, lazily, in `useState(() => loadStop())` |

**How an old or bad stored value coerces:**

```ts
function loadStop(): number {
  try {
    const raw = localStorage.getItem(STOP_KEY)
    // `Number(null)` and `Number('')` are both 0 — a perfectly valid index —
    // so a first visit silently came up on "Any" instead of the default. Test
    // for "nothing stored" BEFORE converting.
    if (raw == null || raw === '') return DEFAULT_STOP
    const n = Number(raw)
    return Number.isInteger(n) && n >= 0 && n < PREMIUM_STOPS.length ? n : DEFAULT_STOP
  } catch {
    return DEFAULT_STOP
  }
}
```

So: nothing stored → `2`. `"3"` → `3`. `"7"` (a stop list that has since shrunk) → `2`. `"2.5"`,
`"abc"`, `"-1"` → `2`. Storage throws (locked-down browser, blocked site data) → `2`. There is no
version field and no migration; the index is re-validated against the current list on every read,
which is the same pattern Top Flow and the Whales page use per-field.

**The draft / commit split.** Two pieces of state:

```ts
const [stop, setStop]   = useState(() => loadStop())   // what the DATA reads
const [draft, setDraft] = useState(stop)               // what the THUMB shows
const draftRef = useRef(draft); draftRef.current = draft
```

`onChange` sets `draft` only — **visual**. `stop` is committed on `onPointerUp`, `onKeyUp` and
`onBlur`. Two separate things used to make the control squirm out from under the pointer, and both
are fixed here rather than papered over with a debounce:

1. **It commits on release, not on every tick.** A range input fires `onChange` for every
   intermediate value, and each one re-queried the session and re-rendered the whole tape.
   Dragging across six stops meant six fetches nobody asked for.
2. **The header holds its shape.** The toolbar is right-aligned, so anything that appears or
   disappears to the **right** of the slider pushes it sideways mid-drag — which is exactly what
   the "loading…" chip did, on and off, once per fetch. The slider is now **last** in the row
   (with `justify-end` that pins its right edge), the chip holds its width whether or not it has
   anything to say, and the value label is a fixed-width box so `Any` and `$1.00M` do not shift
   the track between them.

**The window backstop.** A pointer released *outside* the input never fires `pointerup` on it, and
without this the tape would sit on the old floor until the next interaction — the control would
look broken rather than slow. So while `draft !== stop`:

```ts
window.addEventListener('pointerup',     () => setStop(draftRef.current))
window.addEventListener('pointercancel', …)
window.addEventListener('keyup',         …)
```

**Markup.**

```jsx
<input type="range" min={0} max={PREMIUM_STOPS.length - 1} step={1} value={draft}
       list="cb-flowtape-stops" className="w-28 accent-[var(--color-accent)]" />
<datalist id="cb-flowtape-stops">{PREMIUM_STOPS.map((_, i) => <option key={i} value={i} />)}</datalist>
```

The `<datalist>` makes the browser draw the six ticks and snap the thumb to them **visibly**
rather than only numerically. `accent-[var(--color-accent)]` is the one arbitrary-value class in
the card and it is a `var()` reference, not a literal, so it still tracks the token.

**The label follows the thumb, not the data:**

```ts
const stopLabel = draftPremium === 0 ? 'Any' : fmtPremium(draftPremium)
```

A drag has to read back the value under your finger, not the one the tape is still showing.

### Everything that is *not* a control

No ticker box (the board's page symbol owns that), no date picker, no side/type/size/expiry/DTE
filters, no OTM toggle, no view switch. The expanded-row state (`expandedKey`) is React state
only — it is **not** persisted, deliberately: a drawer restored on load would be pointing at a
print from a session that may no longer be in the tape.

---

## Rendering

### DOM, not canvas

The tape is a **CSS grid of `<div>`s**, not a `<table>` and not a canvas:

> It is a grid rather than the `Table` primitive: a row here can EXPAND into a contract drawer,
> and a `<tbody>` that grows a full-width panel between two rows is a colspan trick that fights
> every other thing `Table` does well.

The only canvas on this card is the one lightweight-charts creates *inside* an expanded whale
drawer.

### The grid template

```ts
// Ticker Time Side Strike Spot Type Size Cost/Ctr Premium | Vol OI IV %OTM DTE | Expiry Bias
const GRID = '78px 56px 84px 72px 46px 74px 88px 96px 74px 68px 58px 66px 44px 88px 74px'
const GRID_COMBINED = `64px ${GRID}`
```

Fifteen fixed pixel columns summing to **1 052px**, plus 14 × `gap-2` (8px) = 112px and
`px-4` (32px) → the declared `minWidth: 1116`. Combined adds the 64px Ticker column and one more
gap → `minWidth: 1180`. Both live inside `<div className="overflow-x-auto">`, so a card narrower
than 1116px scrolls sideways rather than reflowing.

**This is why the card's `defaultSize.w` is 48 — the whole board.** A half-width card on a 1440px
board is ~700px and the table is immediately in horizontal scroll.

### Colour tokens, with hex from `src/design/tokens.css`

| Token | Hex | Where |
|---|---|---|
| `--color-fg` | `#e7ece9` | strike, size, cost, Vol, totals values |
| `--color-muted` | `#e7ece9` | time, spot, OI, DTE, expiry, header labels, empty-state copy |
| `--color-faint` | `#c0c5c3` | the non-stale `last … ago` line |
| `--color-line` | `#1e2630` | every row divider (`border-b border-line`) and the header rule |
| `--color-raised` | `color-mix(in srgb, #141a21 92%, #e7ece9)` | row hover (`hover:bg-raised`), the status chip's plate |
| `--color-up` | `#3ddc8e` | `BUY` side, `C` type, `▲ BULL`, Calls total |
| `--color-down` | `#ff6b7a` | `SELL` side, `P` type, `▼ BEAR`, Puts total, a negative `% OTM` |
| `--color-accent` | `#2f6bff` | the `LIVE` chip, the slider accent, the Min-prem value label, a positive `% OTM`, and the expanded row's wash + outline |
| `--color-warn` | `#ffd166` | the `ERROR` chip and the `last … ago` line once stale |

The expanded row's highlight is the one inline colour in the table, and it goes through `alpha()`:

```jsx
style={open ? { background: alpha(T.cyan, 0.1), outline: `1px solid ${alpha(T.cyan, 0.4)}` } : {}}
```

`T.cyan` is `var(--color-accent)` and `alpha()` is `color-mix(in srgb, … N%, transparent)` — still
the token underneath, so it keeps tracking if the palette moves. (`T.cyan` is v2's name for the
accent; the mapping is documented in `design/theme.ts`.)

### Fixed-width toolbar boxes

| Element | Width | Why |
|---|---|---|
| Status chip | `w-[54px]` | `LIVE` / `WAITING` / `ERROR` must not change the row's width |
| `loading…` chip | `w-[46px]`, `visibility: hidden` when idle | **`visibility` rather than a conditional** — the box is reserved either way, so the slider's right edge cannot move mid-drag |
| Slider track | `w-28` (112px) | |
| Value label | `w-[52px] text-right` | `Any` and `$1.00M` must not move the track between them |

All of this sits inside `Card`'s header, which is **exactly one row, always**: `h-8`, `nowrap`,
and `cb-bar` (in `tokens.css`) gives it `overflow-x: auto` with the scrollbar hidden. It used to
be `flex-wrap`, which meant a card narrower than its own controls grew a **second** header row —
the chart below lost 30px, the card's proportions changed with its width, and two cards of the
same size could hold different amounts of table depending on how many buttons their body happened
to register.

### Type scale

Every size comes from the app's scale (non-negotiable 1): `text-3xs` 9, `text-2xs` 10, `text-xs`
11, `text-sm` 13. The tape rows are `text-xs tabular`; the header row is
`text-2xs font-bold uppercase tracking-[0.06em]`; the toolbar chips are `text-3xs`. A whale's
premium steps up to `text-sm font-black` — the one column you scan down.

`.tabular` (`font-variant-numeric: tabular-nums`) is on every row and on the totals line: numbers
must not jitter as they tick.

### Row keys

```jsx
key={`${o.ts}-${o.symbol}-${i}`}          // the rendered list
const identity = printIdentity(o)          // the EXPANSION key
```

The expansion key is the print's **identity, never its index**: the tape re-sorts on every
refresh, and an index-keyed drawer would silently re-point at whatever print landed in that slot.

---

## Performance machinery

- **`lazy()` at two levels.** The card itself is lazy from the catalog; `ContractDrawer` is lazy
  from inside `Tape`. A board with Flow Tape on it but no whale row expanded never downloads the
  drawer or lightweight-charts.

- **The render cap.** `CARD_MAX_ROWS = 250`, well under the page's `MAX_TAPE_ROWS = 800` — "this
  is a tile, not a page." Totals still span the full filtered set.

- **Live lookups are driven by `visibleRows`, not `filtered`.** Both `useContractStats` and
  `useLiveSpots` take the 250 rendered rows. The stats lookups group by `(ticker, expiry)`, so
  that is a couple of calls however many prints are on screen.

- **`useContractStats` keys on a derived string**, not on the row array. `groupKey` is a
  `useMemo` over `rows` that collapses to something like `"SPX:2026-09-20"`; the fetch effect
  depends on that string, so a tape that re-sorts without changing its expiries does not refetch.

- **Every merge is a `useMemo`.** `liveTape`, `merged`, `own`, `filtered`, `visibleRows`,
  `visibleTickers`, `totals`, `lastTs`, `ageSec` — the socket frame arrives several times a
  second and only the memo chain stands between that and a full re-filter of 20 000 rows.

- **`useFrame`, not `useField`.** `hooks.ts` prefers `useField` (re-render only when the derived
  value changes) but the card needs the whole `tape` array, which is a new reference on every
  frame anyway, so `useFrame` is the honest choice.

- **The 45s backfill poll skips a hidden tab.** The 20s stats poll and the 15s spot poll do not.

- **`useTick(15_000)`** is the card's only unconditional timer, and it exists specifically so the
  age keeps counting when everything else has stopped.

- **Perf budget** (`budgets.json` → `perf`): `offscreenRepaints` is a hard **0**. Flow Tape owns
  no canvas of its own, so it contributes nothing to that number unless a drawer is open — which
  is the expanded row's lightweight-charts instance, gated through `ChartFrame` like every other.

---

## Phone, expanded and replay behaviour

**Phone.** No phone variant. `useIsPhone()` (`(max-width: 820px)` **and** `pointer: coarse` or
`hover: none`) routes to `src/mobile/`, whose pages are `MGex`, `MEm`, `MSpx`, `MEcon`, `MHeat`,
`MAlerts` — no tape among them. The card's controls use `ControlSize` `'sm'`, which
`Controls.tsx` describes as "the board's own density… and wrong the instant a thumb is the
pointer." A 1116px-minimum grid inside a 390px viewport is horizontal scroll from the first pixel.

**Expanded.** `Card`'s `⤢` portals the same React element into the page column's stage
(`design/primitives/Expand.tsx`). Because a portal moves the DOM and leaves the React tree where
it is, the scroll position, the open drawer, the slider draft and every fetched stat survive the
transition. This is the card that benefits most from expanding: 1116px of grid finally fits, and
250 rows finally have somewhere to go. Esc collapses. Outside an `ExpandStageHost` no button is
drawn.

**Replay.** None. `date = todayYmdET()` and `isToday` is the literal `true` passed to `Tape`. The
`!isToday` branch of `Tape`'s empty state (`No {label} flow recorded for {date}.`) is therefore
**unreachable from this card** — it exists for the `/flow` page's date picker. The replay surfaces
in this app belong to Multi Greek (`pages/Replay.tsx`, `pages/replay/mgReplay.ts`).

---

## Status and empty-state messages, verbatim

### The toolbar chip

`tabular w-[54px] rounded-sm bg-raised px-2 py-0.5 text-center text-3xs`

| Text | When | Ink | `title` |
|---|---|---|---|
| `ERROR` | `error` (the last backfill request failed or returned an unusable body) | `text-warn` `#ffd166` | `The last backfill request failed — showing the last data that arrived` |
| `LIVE` | `flowFrame` is present | `text-accent` `#2f6bff` | none |
| `WAITING` | no `flow` frame has arrived yet | `text-down` `#ff6b7a` | none |

`ERROR` outranks both. Note: `LIVE` means *the socket has delivered a `flow` frame*, not *these
rows are live* — on a non-SPX board every one of those prints is filtered out.

### `loading…`

`w-[46px] text-2xs text-muted`, `aria-hidden={!switching}`, `visibility: switching ? 'visible' :
'hidden'`. Shown while `useFlowHistory` reports `switching` — i.e. a ticker or floor change is in
flight. Always occupies its box.

### The totals line

```
SPX   1,284 orders   Total $412.6M   Calls $221.4M   Puts $191.2M   last 03:41:07 PM · 12s ago
```

- `{active}` — `font-bold uppercase tracking-[0.08em] text-fg`
- `{count.toLocaleString()} orders`
- `Total {fmtPremium(totals.prem)}`
- `Calls {fmtPremium(totals.callPrem)}` — `text-up`
- `Puts {fmtPremium(totals.putPrem)}` — `text-down`
- `last {fmtTime(lastTs)} · {fmtAgo(ageSec)} ago` — only when `lastTs != null`, pushed right with
  `ml-auto`, `text-faint` normally and `text-warn` once `ageSec >= 180`.
  `title="When this ticker last printed, at any premium"`.

### `Tape`'s three empty states

All rendered `<p className="p-6 text-xs text-muted">`, chosen when `totalRows === 0`:

| Text | When |
|---|---|
| `No {label} flow recorded for {date}.` | `!isToday` — **unreachable from the board card** |
| `No {label} flow matches the current filters.` | `isToday && status === 'LIVE'` |
| `Connecting to feed…` | `isToday && status !== 'LIVE'` (i.e. `WAITING` or `ERROR`) |

`{label}` is the card's `active` ticker; `{date}` is the ISO session date.

### The footer

```
Showing newest 250 of 1,284 — tighten filters to narrow.
```

`px-4 py-2.5 text-center text-xs text-muted`, shown only when `totalRows > cap`. Both numbers go
through `toLocaleString()`.

### The drawer's Suspense fallback

```
Loading contract detail…
```

`border-b border-line px-4 py-3 text-xs text-muted`. Shown while the lazy `ContractDrawer` chunk
is in flight.

### Header tooltips (`title` on the column headings)

| Column | Tooltip |
|---|---|
| `Cost/Ctr` | `Cost of one contract (price × 100)` |
| `Vol` | `Contract's traded volume TODAY (live, not at print time)` |
| `OI` | `Contract's current open interest` |
| `IV` | `Current implied volatility` |
| `% OTM` | `Strike vs LIVE underlying spot. + = OTM, − = now ITM` |
| `DTE` | `Calendar days to expiration` |

### Per-row tooltips

- Size cell, when `o.fills > 1`: `{fills} fills aggregated`
- Whale row: `Click to expand contract detail`
- `% OTM` cell with a live spot:
  `Strike {strike} vs live spot {liveSpot.toFixed(2)} — now ITM` / `… — OTM`
- `% OTM` cell without one: `No live spot yet`

### The CopyShot caption

```jsx
data-capture-meta={`${active} · all expiries`}
```

e.g. `SPX · all expiries`. Every expiry and every DTE goes into this tape by design, so the ticker
is the whole of what a shared PNG needs told. See `shell/snapshot.ts` (`META_ATTR`).

---

## Gotchas

- **`src/pages/flow/FlowTape.tsx` is not "the page version".** It is *the* table — a pure
  presentation component that both the page and this card mount. There is exactly one
  implementation. Two copies of a table with this many columns, this many tooltips and a drawer
  hanging off every whale row is two places for a column to go wrong, "and the board card is
  exactly where nobody would notice."

- **`LIVE` does not mean the rows are live.** The socket streams SPX only. On any other board
  symbol the chip still reads `LIVE` while every live print is being dropped by the ticker gate,
  and the tape is running entirely off a 45-second REST poll. The `last … ago` line is the honest
  number.

- **`own` and `filtered` are different sets on purpose.** `own` ignores the premium floor. If you
  "simplify" the staleness read to use `filtered`, raising the slider will look exactly like the
  feed dying.

- **`Number(null)` and `Number('')` are both `0`, which is a valid stop index.** `loadStop()` must
  test for "nothing stored" **before** converting — this exact bug shipped once and made every
  first visit come up on "Any" instead of $100K.

- **The slider's `onChange` is visual only.** Anything wired to `draft` instead of `stop` will
  fire a session refetch per intermediate value — six fetches per drag.

- **Order in the toolbar is load-bearing.** The bar is `justify-end`, so only the *last* item's
  right edge is stable. The slider must stay last and the two status widgets must keep their
  fixed widths, or the track walks out from under the pointer mid-drag.

- **The expansion key is `printIdentity`, not the array index.** The tape re-sorts on every
  refresh. An index key silently re-points the open drawer at a different print.

- **The `contract-stats` group key changes separator between request and response** — `:` going
  out, `|` coming back. `useContractStats` builds `${root}:${expiration}` for `?groups=` and reads
  `stats[`${root}|${expiration}`]`. Do not "fix" one side.

- **`ContractStat.iv` is a decimal.** The tape does the `×100`. A second consumer that forgets
  will render `0.2%` for a 20-vol contract.

- **`fmtStat(null)` is `—`, not `0`.** `null` means the chain snapshot has not produced this
  contract yet; `0` would be a claim that nobody is trading it.

- **`--color-up` and `--color-down` here are the *UI's* directional pair**, `#3ddc8e` / `#ff6b7a`.
  They are separate tokens from `--color-netdrift-call` / `--color-netdrift-put` (the Net Premium
  card's lines) and from `--color-candle-up` / `--color-candle-down`, even though all three pairs
  currently carry the same two values. Do not collapse them.

- **The 15-column grid has a hard 1116px minimum.** A half-width card is in horizontal scroll from
  the moment it is placed, which is why `defaultSize.w` is 48. `placeNewCard()` in `catalog.tsx`
  makes a *second* copy the size of the newest existing one, so shrinking the first one and adding
  a second gives you two broken tapes.

- **Neither flow hook participates in `refreshAll()`.** The toolbar's ↻ empties the `useQuery`
  cache and re-runs every mounted query; this card registers nothing there. Its own 45s / 20s /
  15s clocks are the only things that refresh it.

- **Two copies of this card share `cb-v3-board-flowtape-stop`.** The catalog does not thread
  `instanceId` into `FlowTapeCard` (contrast `top-flow` and `gex-candles`, which do), so
  `flow-tape#2` is not a second question — it is the same tape twice.
