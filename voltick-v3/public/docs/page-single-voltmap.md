# The Voltmap — `/single`

**Route:** `<Route path="/single" element={<VoltBoard />} />` in `src/App.tsx`, with the comment *"`/single` is the Voltmap, NOT `/board` — `/board` is the inherited card grid and renaming it would break every link to it."*
**Mounted by:** `const VoltBoard = lazy(() => import('@/voltboard/VoltBoard'))`, described in `App.tsx` as *"THE SINGLE BOARD — Voltick's Voltmap. The strike x expiration heat grid, its level tiles and the Session Read, all off one derived bundle (`src/voltboard/derive.ts`). Its own chunk: the matrix builder and the grid are dead weight on every other route."*
**Rail entry:** `{ to: '/single', label: 'Single', icon: '★', prefetch: ['/api/expirations?ticker=SPX'] }`, second in `NAV`, directly under Home.
**Production URL:** `voltick.cbedge.net/v3/single`.

**Sources:**

| File | Lines |
|---|---|
| `src/voltboard/VoltBoard.tsx` | 271 |
| `src/voltboard/Voltmap.tsx` | 282 |
| `src/voltboard/derive.ts` | 468 |
| `src/voltboard/board.ts` | 278 |
| `src/voltboard/BoardToolbar.tsx` | 234 |
| `src/voltboard/StatBand.tsx` | 215 |
| `src/voltboard/NodeCard.tsx` | 148 |
| `src/voltboard/SessionRead.tsx` | 117 |
| `src/voltboard/IbStrip.tsx` | 116 |
| `src/voltboard/types.ts` | 107 |
| `src/voltboard/heat.ts` | 85 |
| `src/voltboard/Legend.tsx` | 51 |

Supporting: `src/pages/optionsChain/chainMath.ts` (558, `parseExpiration`), `src/data/api.ts` (239, `query`/`preload`), `src/data/hooks.ts` (75, `useField`), `src/contract/frames.ts` (258, `SpotFrame`), `src/design/theme.ts` (471), `src/design/tokens.css` (716), `src/design/primitives/Page.tsx` (38), `src/shell/Shell.tsx` (739), `AGENTS.md`, `budgets.json`.

**On parity checklists:** `App.tsx` and `AGENTS.md` cite `docs/parity/*.md` for six ported routes (scanner 1,525 rows, economic-calendar 176, level-log 283, em, replay, chain). **The Voltmap has none, and should not** — it is not a port of a v2 page. Its lineage is Voltick's own `board-derive.jsx`, `heatscale.js` and `meterscale.js`, each named in the file headers, and those headers are the spec.

---

## What it is, in one paragraph

`/single` is a strike × expiration heat grid for one symbol. Rows are strikes (high at the top, like a board), columns are the ticker's next fourteen listed expirations, and each cell is that strike's net gamma (or vega) for that date, coloured green for positive and red for negative, brighter for bigger. Down the right of every row is a signed bar — a second, independent reading of the same number. Above the grid sit a symbol box, a live price, a positive/negative-gamma pill, a freshness dot and two jump buttons; below it a band of level tiles (Net, Call Wall, Put Wall, Volt, Surge, Gamma Flip, Reversal) and a legend; between them an optional **Session Read** that says the same thing in English sentences. Everything is scoped by a **dates** control — front/0DTE, this week, all — and every tile, sentence and header repeats the scope tag so the numbers can never be read against the wrong dates. Clicking a row opens a modal for that one strike. The whole page runs off **one** derived bundle: `useBoardDerived` is called once in `VoltBoard.tsx` and its result is handed to every child, which is the rule the folder exists to keep.

---

## File map

| File | Lines | Owns |
|---|---|---|
| `VoltBoard.tsx` | 271 | The page. All state (symbol, mode, source, scope, strike count, quiet, read-open, open strike, the board, loading), the localStorage preference layer, the rebuild timer + generation guard, the live-spot `useField`, the header (symbol box, price, gamma pill, freshness dot, jump pills), and the `jump()` scroller. |
| `board.ts` | 278 | Building the matrix in the browser. `MAX_COLUMNS`, `REFRESH_MS`, `nyToday`/`dteOf`/`fmtDate`/`isTodayExp`, `fetchExpirations`, `fetchColumn`, `buildBoard`, `kingOf`, `flipOf`. |
| `derive.ts` | 468 | **The single definition of every derived value.** `colsInScope`, `scopeTagOf`, `aggregate`, `flipWalk`, `marksOf`, `MARK_GLYPH`/`MARK_COLOR`/`MARK_WORD`, `cellStyle`, `fmtVal`, `fmtStrike`, `useBoardDerived`, `oiCells`, `flipSideOf`, `distText`. |
| `heat.ts` | 85 | The size→brightness law and the bar length: `HEAT_FLOOR`, `HEAT_KNEE`, `heatT`, `heatRef`, `METER_H`, `meterPct`. |
| `types.ts` | 107 | `BoardMode`, `BoardSource`, `BoardCell`, `BoardCol`, `BoardMap`, `Scope`, `MarkKind`, `Agg`. One file *"so the builder, the deriver and the grid cannot drift into three opinions about what a board is."* |
| `Voltmap.tsx` | 282 | The `<table>`: sticky head, per-expiration headers with that column's own ★ and ⚡︎, the sticky strike column with its marks, the heat cells, the Net profile column, `NetBar`, `Mark`, `nearestTo`. |
| `StatBand.tsx` | 215 | The level tiles (auto-fit grid) plus the legend. `Tile`, `onItsSide`. |
| `SessionRead.tsx` | 117 | The English paragraph block, one line per fact, plus the disclaimer. |
| `BoardToolbar.tsx` | 234 | `Chip`, `Seg`, `BoardToolbar` (GEX/VEX, oi/volume, ⚡ 0DTE, Week, Σ all, the Dates tag, ◹ Quiet) and `ContextBar` (Session Read toggle + `IbStrip` + optional tour chip). |
| `NodeCard.tsx` | 148 | The one-strike modal: roles, net, the book (call/put OI and volume), and a per-expiration breakdown scoped to the columns in view. |
| `IbStrip.tsx` | 116 | The 9:30–10:30 Initial Balance strip and its own 30s poll. |
| `Legend.tsx` | 51 | Eight mark glyphs with labels, plus the three colour-language words. |

### What the page deliberately is not

- **Not a `Card`.** `VoltBoard` renders `<Page fill>` with plain `<div>`s. So there is **no expand button** (`Card` is what draws it), no `CardToolbar`, no `data-card`/`data-card-instance`, and no `stale` class.
- **Not on the board.** It is a route, not a catalog entry, so it has no `data-card-id` and is invisible to `scripts/perf-check.mjs`'s per-card attribution.
- **No canvas.** The grid is a `<table>`. Non-negotiable 6 (`data-cb-layer`) has nothing to tag; `ChartFrame` is not used.
- **No CopyShot target.** `useCopyShotTargets` is never called, so the toolbar's 📸 draws nothing on this route.
- **Does not read the page symbol.** It carries its own `<input>` and its own `vb-sym` key, ignoring `usePageSymbol()` and the toolbar's `TickerPicker`/SPX chip entirely.

---

## The data path

### Endpoints

| URL | Called by | Shape read | Cadence |
|---|---|---|---|
| `/api/expirations?ticker=<T>` | `fetchExpirations` in `board.ts` | `data.items[]` → `expiration-date` (see below) | once per rebuild |
| `/api/chains?ticker=<T>&expiration=<ISO>&range=all` | `fetchColumn`, **one per column, in parallel** | `data.items[]`, `data.underlyingPrice` | once per rebuild, ×N columns |
| `/api/snapshots/ib?date=<YYYY-MM-DD>` | `IbStrip` | `{ row?: IbRow }` | its own 30s interval |
| `wss://<host>/ws/gex` frame `spot` | `useField<SpotFrame, number>('spot', f => f?.data?.spot ?? 0)` | `SpotData.spot` | live, ~10Hz upstream |

All three REST calls go through `query()` from `src/data/api.ts`, so they get dedupe + a cache with a **default `staleMs` of 30 000 ms**. None of them passes `pollMs`; the cadences are the page's own `setInterval`s.

### Why the matrix is assembled in the browser

> The socket's `gex` frame carries ONE expiry (`GexData.expiry`, one row per strike). The Voltmap needs every column at once, so the board is assembled here from the same two endpoints the Options Chain page already uses.

> AND IT REUSES `parseExpiration` RATHER THAN RE-DOING THE MATHS. That is the whole point: the chain page and this board then cannot disagree about what a strike's GEX is, because there is one function and it lives in `chainMath.ts`. A second copy of the dealer convention here would be a second thing to keep correct, and the first symptom would be the board and the chain quoting different walls for the same ticker.

> The columns are fetched in PARALLEL, not in sequence — fourteen serial round-trips is a visible pause on a cold board and it is a waterfall, which this app does not do (AGENTS.md rule 3).

That parallelism is `await Promise.all(exps.map((e) => fetchColumn(ticker, e)))`. Strictly, the page does have **one** sequential step — the expirations list must resolve before the columns can be requested — and that is exactly the waterfall the rail's prefetch warms away: the `NAV` comment reads *"Prefetch is the board's ACTUAL entry pair — the expirations list, then the front column, which is the waterfall this warms away."* (Only the expirations URL is actually listed; the front column's URL cannot be known until the list comes back.)

### `/api/expirations` — the payload shape, and the bug it caused

```ts
interface ExpirationsPayload {
  data?: { items?: Array<Record<string, unknown>>; expirations?: unknown[] }
  items?: Array<Record<string, unknown>>
  expirations?: unknown[]
}
```

> `/api/expirations` is a PASS-THROUGH of the TastyTrade proxy, so the shape is TastyTrade's, not ours: `data.items[]`, each carrying `expiration-date`, and the SAME date appears many times (once per strike listing). The first cut of this file guessed `{ expirations: [...] }` and got an empty board with a live price above it — the one failure mode worth naming here, because the page looked like a rendering bug and was a parsing one.

> The other shapes below are tolerated, not expected. The proxy is the source of truth and it can change; an unrecognised payload must say so rather than present as "this ticker has no options".

Resolution order: `j?.data?.items ?? j?.items ?? j?.data?.expirations ?? j?.expirations ?? []`. Each row may be a string or an object; the value is `r['expiration-date'] ?? r.expiration ?? r.value`. Then: `slice(0, 10)`, reject anything not `/^\d{4}-\d{2}-\d{2}$/`, reject `dteOf(iso) < 0` (*"already expired — the feed still lists it on roll day"*), dedupe through a `Set` (*"`items` lists a date once per strike, so SPX comes back with thousands of rows over a few dozen real dates"*), sort ascending, **`slice(0, MAX_COLUMNS)`** = 14.

`MAX_COLUMNS = 14` — *"How many expirations the board draws. Voltick's own board sits around 14."*

Returns `[]` rather than throwing: *"an empty board renders its own empty state, which is more useful than an error boundary swallowing the page."*

### `/api/chains` — one column

```ts
const j = await query<ChainPayload>(`/api/chains?ticker=${enc(ticker)}&expiration=${enc(exp.value)}&range=all`)
const items = (j?.data?.items as unknown[]) ?? []
const underlying = parseFloat(String(j?.data?.underlyingPrice ?? 0)) || 0
return { exp: exp.value, underlying, cells: parseExpiration(items, exp.value, underlying, 'oi-vol') }
```

**Never throws** — *"a column that fails comes back empty and the grid draws it blank."* The `catch` returns `{ exp, underlying: 0, cells: new Map() }`.

The basis is fixed at `'oi-vol'`:

> `'oi-vol'` is the chain page's default basis and the honest one for a map: the settled book plus today's tape. The board's OI / VOLUME switch picks which LEG it draws out of the cell, below — it does not re-fetch.

So flipping **oi ↔ volume** is free of network cost, because both legs are already on every cell.

### The refresh cadence

```ts
export const REFRESH_MS = 60_000   // "Open interest moves once a day; volume and spot do not."
```

```ts
useEffect(() => { void rebuild(); const t = setInterval(() => void rebuild(), REFRESH_MS); return () => clearInterval(t) }, [rebuild])
```

`rebuild` is a `useCallback` keyed on `[symbol, mode, source]`, so changing any of those tears the interval down and rebuilds immediately.

### The generation guard

```ts
const gen = useRef(0)
const rebuild = useCallback(async () => {
  const mine = ++gen.current
  setLoading(true)
  try {
    const next = await buildBoard(symbol, mode, source, liveSpotRef.current)
    if (mine !== gen.current) return
    setBoard(next)
  } finally { if (mine === gen.current) setLoading(false) }
}, [symbol, mode, source])
```

> One effect, one timer. `gen` guards against an out-of-order response landing after a newer one — switching symbol twice quickly is enough to reproduce that, and the symptom is one ticker's grid under another's name.

### Two clocks, on purpose

> THE SPOT COMES OFF THE SOCKET, THE MATRIX COMES OFF REST, and they are deliberately not the same clock. The chain endpoints are a snapshot taken when the board was built; the `spot` frame is live. So the header's price ticks while the grid holds still, and the grid is rebuilt on a timer rather than on every tick — rebuilding a fourteen-column matrix at 10Hz would be absurd, and open interest only moves once a day anyway.

The live price is read at build time through a ref so it is not a dependency:

```ts
const liveSpotRef = useRef(liveSpot); liveSpotRef.current = liveSpot
// "The live price is read at build time but must not be a dependency — it
//  ticks constantly, and a rebuild per tick is the waterfall this app bans."
```

and merged back over the built board for display:

```ts
const spot = liveSpot > 0 ? liveSpot : (board?.spot ?? 0)
const shown: BoardMap | null = board ? { ...board, spot } : null
```

`useField` rather than `useFrame` — *"this re-renders only when the rounded price actually changes, which on a 10Hz feed is a large difference."* (`useField` keeps the previous reference when `Object.is` says the derived value is unchanged, so React bails out.) The socket itself is never touched by this page, per non-negotiable 2: *"Pages never touch the socket. They call `useFrame` / `useField` / `watchFrame` from `src/data/hooks.ts`… scoping is derived from what is actually subscribed."* Subscribing to `spot` here is what puts `spot` in the socket's `?topics=` set.

### A rebuild never blanks the board

> A REBUILD NEVER BLANKS THE BOARD. The previous matrix stays on screen while the next one loads, because a grid that empties every minute reads as broken even when it is working perfectly.

Mechanically: `setBoard(next)` only ever replaces, and `setLoading(true)` changes only the freshness dot's colour and the fallback copy. The grid renders whenever `shown && d && d.rows.length > 0`.

### The IB poll

```ts
const POLL_MS = 30_000
void query<{ row?: IbRow }>(`/api/snapshots/ib?date=${nyToday()}`)
```

Its own interval, its own `dead` flag, and a `catch` that sets `false` (= hide). Not wired to the board's rebuild at all.

### Failure behaviour, end to end

| Failure | Result |
|---|---|
| `/api/expirations` returns nothing readable | `buildBoard` returns a `BoardMap` with `strikes: []`, `cols: []` and a `warning` — see "Status messages" |
| One column's `/api/chains` fails | that column comes back with an empty `cells` map; its cells render `·` and its header shows `★ —` / `⚡︎ none` |
| Every column empty | `warning: 'No live chain payload returned for <T>.'` |
| `/api/snapshots/ib` fails, or `row.high` ≤ 0 | the whole strip renders `null` — *"An empty strip in a header is worse than no strip: it reads as a thing that is broken rather than a thing that has not happened yet."* |
| `localStorage` throws | `pref()` returns the fallback, `setPref()` swallows — *"localStorage is a convenience, never load-bearing — a throw must not kill the board."* |
| The socket is down | `liveSpot` is 0, so `spot` falls back to `board.spot` (the underlying price off the chain payload) |

There is **no error boundary and no error message** for a rejected `query()` beyond the warning strings: `fetchExpirations` lets a throw from `query()` propagate out of `buildBoard`, and `rebuild()`'s `try/finally` has no `catch`, so the rejection surfaces as an unhandled promise rejection while the page keeps showing the previous board.

---

## Every derived number

Every formula below lives in exactly one place, and that is the folder's stated rule:

> THE RULE, and it is the whole point of this file: `agg`, `marks`, `roleOf` and `cellStyle` have exactly ONE definition, and it is here. The page calls `useBoardDerived` once and feeds the same returned object to the ribbon, the stat tiles, the grid and the node card. Nothing recomputes them locally.
>
> The failure this prevents is not hypothetical: two copies of `agg` means the tiles and the grid can quote different Volts for the same ticker, and it looks right on both surfaces while it does it.

### The cell value, from `chainMath.ts`

Contract counts per side are `OI + volume` (the `'oi-vol'` basis), and then, with `S` = the underlying price:

```
GEX  = (γc·cc − γp·pc) · S² · 0.01 · 100        dollars of gamma per 1% move
VEX  = (νc·cc − νp·pc) · S · 100                dollars of vega
volGex = (γc·cVol − γp·pVol) · S² · 0.01 · 100  same, from RAW volume only
```

*"VERBATIM from v2. The contract-count basis, the S² scaling, the 0.01 and the ×100 multiplier are all load-bearing."* `volGex` is computed from raw call/put volume **regardless of the basis**, *"so the OI+Vol view can still flag the biggest pure-volume gamma peak."* Each side's count is 0 if the leg is missing; if both are 0 (`live === false`) the greeks come out 0.

### `BoardCell` — what `board.ts` stores per cell

```ts
const oiNet  = mode === 'GEX' ? g.gex    : g.vex
const volNet = mode === 'GEX' ? g.volGex : g.vex
cells.set(strike, { v: source === 'volume' ? volNet : oiNet, oiNet, volNet, callOI, putOI, callVol, putVol })
```

> VEX has no volume leg of its own on this feed, so a volume map falls back to the vega it does carry rather than drawing an empty column.

So in VEX mode `oiNet === volNet === g.vex`, and the oi/volume switch is a no-op on the map (it still changes the Net column's header word and the cell tooltips).

Both legs are always kept because *"the stat tiles are ALWAYS open interest even when the map above them is weighted by volume. That split is Voltick's and it is deliberate — the VOLUME switch stays lit while the tiles keep quoting the book, and the legend says so."*

### Scope → columns (`colsInScope`)

| `Scope` | Columns |
|---|---|
| `-1` | every column |
| `number` | that index alone (falls back to all if out of range) |
| `number[]` | those indexes, filtered to range |
| `'WEEK'` | walk from index 0; include a column when `dte <= 6` **and** its UTC day-of-week is 1–5 (Mon–Fri); `break` once `dte > 6`. Falls back to `all.slice(0, 1)` if empty. *"Today through Friday. Friday itself is in; next Monday is not."* |
| `'MONTH'` | every column whose `exp.slice(0, 7)` equals `cols[0].exp.slice(0, 7)` |

`scopeTagOf` names it: `all dates` / `this week` / `this month` / `MM/DD` / `N dates` / `0DTE` (when the single column's date is today). The toolbar, every tile label, the Net column header, the Session Read and the node card all print this same string.

> `inScope` is a plain closure, deliberately not memoized. It closes over the current scope and must be rebuilt every render. Memoize it and the columns freeze on a stale expiration scope — the board still looks right while summing the wrong dates, which is the worst kind of wrong.

### `aggregate(board, scope)` — one walk, every level

`byStrike` is built by summing `cell.v` across the scoped columns; `netTotal` is the sum of `byStrike`'s values. Units: dollars (same as a cell).

*"Ported from Voltick's `aggregateFromCells`, including the parts that look arbitrary and are not — the reversal's shelf weighting, the 0.5× gate for a coil, the 8% floor for air. Those thresholds are the product."*

| Level | Formula | Units |
|---|---|---|
| **callWall** | the strike with the **most positive** `byStrike` value | strike price |
| **putWall** | the strike with the **most negative** value | strike price |
| **king (★ Volt)** | the strike with the largest `\|value\|`; `kingAbs` is that magnitude, `kingSign = Math.sign(val(king))` | strike price |
| **step** | the smallest positive gap between consecutive strikes, × **2.5** — *"The neighbourhood a 'shelf' is measured over"* | strike-price units |
| **reversal (↘)** | among strikes whose sign is `−kingSign` and whose `\|v\| ≥ 0.05 × kingAbs`: `cluster` = how many strikes within `±step` share that sign with `\|v2\| ≥ 0.4 × \|v\|`; `score = \|v\| × (1 + 0.18 × min(cluster, 3))`; take the max score | strike price |
| **coils (◆)** | strikes ≠ king, ≠ reversal with `\|v\| ≥ 0.5 × kingAbs`, sorted by `\|v\|` desc, **top 5** | strike prices |
| **air (≋)** | runs of **≥3 consecutive** strikes with `\|v\| < 0.08 × kingAbs` | strike prices |
| **surge (↯)** | in the **front column only** (`board.cols[0]`), the strike with the largest `\|volNet\|`. `null` if `best === 0` | strike price |
| **surgeWall** | in the same column, the strike with the largest `\|volNet\|` of the **opposite sign** to `surge`'s | strike price |
| **flip (⚡︎), flipCrossings, oneSided** | `flipWalk(strikes, val, spot)` — below | strike price / count / `'sticky'\|'slippery'\|null` |

`aggregate` is run **twice** when the source is `volume`, once normally and once over an OI-substituted copy of the columns:

```ts
const aggOi = source === 'volume'
  ? aggregate({ ...board, cols: board.cols.map((c) => ({ ...c, cells: oiCells(c.cells) })) }, scope)
  : agg
```

> `aggOi` is not a duplicate. The stat cards have ALWAYS been the open-interest board, and in VOLUME they keep being it: the map above is weighted by today's volume while the tiles keep quoting the positions on the book. The VOLUME switch stays lit, every tile is titled, and the legend says so. Collapsing the two is how a ★ Volt gets quoted off the wrong basis, which is the one mistake here that travels — a shared screenshot cannot scroll to the switch.

`StatBand`, `SessionRead` read **`d.aggOi`**. `Voltmap` and `NodeCard` read **`d.agg`**.

### The flip walk

```ts
run = 0; prevK = strikes[0]; prevRun = 0
for (const k of strikes) {
  const next = run + val(k)
  if (run !== 0 && next !== 0 && Math.sign(next) !== Math.sign(run)) {
    const t = Math.abs(prevRun) / (Math.abs(prevRun) + Math.abs(next) || 1)
    hits.push(prevK + (k - prevK) * t)
  }
  prevK = k; prevRun = run; run = next
}
```

A cumulative sum walked from the **lowest strike up**. When the running total changes sign, a crossing is recorded, **linearly interpolated between the two straddling strikes** by the ratio `|prevRun| / (|prevRun| + |next|)`. Output units: strike price, fractional.

**The crossing pick:** `spot > 0 ? hits.reduce((a, b) => Math.abs(b - spot) < Math.abs(a - spot) ? b : a) : hits[0]` — **the crossing nearest price**, not the first. `crossings = hits.length` is kept because *"more than one crossing changes what the tile says"*: both the tile and the Session Read append *"These dates cross more than once; this is the crossing nearest price."*

**No flip is an answer:**

```ts
if (anyPos && !anyNeg) return { flip: null, crossings: 0, oneSided: 'sticky' }
if (anyNeg && !anyPos) return { flip: null, crossings: 0, oneSided: 'slippery' }
return { flip: null, crossings: 0, oneSided: run >= 0 ? 'sticky' : 'slippery' }
```

> A single date, or a short week, often holds one mood clean across every strike it carries. That comes back as `flip: null` with `oneSided` set, and the tile prints "none" rather than going blank — a blank number reads as one that failed to load.

`flipOf()` in `board.ts` is the **per-column** version, used for the `⚡︎` in each column header. Same algorithm, same nearest-to-spot pick, and it *"Returns null when the column never crosses — which is an answer, not a failure, and the header prints `⚡︎ none` for it rather than going blank."* Note it lacks `flipWalk`'s `next !== 0` guard placement nuance and has no `oneSided` output; the two are separate functions over the same idea.

### The heat scale

```ts
export const HEAT_FLOOR = 0.35            // the reference's floor, as a fraction of the largest cell
export const HEAT_KNEE  = 0.84            // where the reference lands on the 0..1 ramp
const OVER = Math.log(1 / HEAT_FLOOR)     // ≈ 1.0498 — the widest ratio the reference can be handed

export function heatRef(values: number[]): number {
  const abs = values.map(Math.abs).filter(a => a > 0).sort((a, b) => a - b)
  if (!abs.length) return 0
  const p90 = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.9))] ?? 0
  const max = abs[abs.length - 1] ?? 0
  return Math.max(p90, max * HEAT_FLOOR)
}

export function heatT(v: number, ref: number): number {
  if (!ref || !Number.isFinite(ref) || ref <= 0) return 0
  const r = Math.abs(Number(v) || 0) / ref
  if (!Number.isFinite(r)) return 0
  if (r <= 1) return Math.sqrt(r) * HEAT_KNEE
  return Math.min(1, HEAT_KNEE + (1 - HEAT_KNEE) * (Math.log(r) / OVER))
}
```

**`heatRef` = max(p90 of the non-zero absolute values in the drawn window, 0.35 × the largest).** *"Anchoring straight to the largest cell lets one monster strike wash the field out, which is what the percentile is for."* Note the p90 index is `floor(n × 0.9)` clamped to `n − 1`, not an interpolated percentile.

**`heatT` is sqrt below the reference and log above**, meeting at `t = HEAT_KNEE = 0.84`:

> THE KNEE, and why the clamp is gone. The obvious version — `Math.sqrt(Math.min(|v| / ref, 1))` — flattens everything at or above the reference onto one colour, and the top decile of a board is precisely the walls, the Volt and the Surge. Growth through them was invisible. Below the reference this curve is that one; above it, the remaining headroom is spent on a log, so a wall that doubles still moves.

The floor and the ceiling are the same constant by construction: `OVER = ln(1/HEAT_FLOOR)`, so at `r = 1/HEAT_FLOOR` (the largest ratio the floored reference can ever produce) `heatT` reaches exactly 1.0. *"the brightest colour stays exactly reachable and the two cannot drift apart the way two copies would."*

**Two functions, not one:**

> `heatT()` how BRIGHT, on a compressed curve… `meterPct()` how LONG, straight-line in |v| / maxAbs. The compression is exactly why the bar exists. It makes neighbouring values look alike by design, so two mid-greens on a dense grid are a genuine guess. A bar run through the same curve would agree with the fill it was added to disambiguate. Length is the second, independent encoding.

```ts
export const METER_H = 3     // px — the bar's height unit
const METER_MIN = 2          // % — the smallest bar a NON-ZERO cell may draw
export function meterPct(v, maxAbs) { … Math.max(METER_MIN, Math.min(100, (|v| / maxAbs) * 100)) }
```

> `maxAbs`, NOT the heat reference. The reference is floored, so measuring bars against it would peg every heavy cell to full width and say nothing. A non-zero cell always shows something: "too small to draw" and "nothing here" are different facts, and the grid already prints $0 for the second.

### `cellStyle`

```ts
export function cellStyle(v, ref, marked, quiet): CellStyle {
  if (!v) return { background: 'transparent', color: T.faint }
  const t = heatT(v, ref)
  const dim = quiet && !marked ? 0.35 : 1
  const hue = v >= 0 ? T.green : T.red
  return {
    background: alpha(hue, Math.max(0.04, t * 0.42 * dim)),
    color: t > 0.55 ? T.text : alpha(T.text, 0.62 + 0.3 * t),
  }
}
```

Fill alpha runs 4%…42% (×0.35 when quiet-dimmed). Text goes fully opaque above `t = 0.55`, otherwise `0.62 + 0.3·t` (62%…78%). *"Green = positive gamma, red = negative, brighter = bigger — which is the legend, and the legend is a promise."*

### The drawn window

```ts
// centre = the index of the strike nearest spot (or the middle of the list if spot is 0)
const half = Math.floor(strikeCount / 2)
const lo   = Math.max(0, Math.min(centre - half, all.length - strikeCount))
const rows = all.slice(Math.max(0, lo), Math.max(0, lo) + strikeCount)
const shown = rows.map(k => agg.byStrike.get(k) ?? 0)
const ref    = heatRef(shown)
const maxAbs = shown.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
return { …, rows: [...rows].reverse() }   // "high strikes at the top, like the board"
```

**`ref` and `maxAbs` are computed over the drawn window only**, not the whole board — so changing the strike count re-scales the colours and the bars.

### Formatters

```ts
fmtVal:   $1.98B / $238.1M / $91.0K / $<n>, with a U+2212 MINUS for negatives; 0 → '$0'
fmtStrike: 7650, 7650.5, 212.25 — Number.isInteger ? String(n) : String(Number(n.toFixed(2)))
distText: `$<|k−spot|.toFixed(2)> above|below · <|pct|.toFixed(2)>%` where pct = (k−spot)/spot × 100
flipSideOf: spot >= flip ? 'above' : 'below'
```

---

## Every control

Scope state (`scope`) is **in-memory only** — it is *not* persisted and *not* in the URL. Everything else that is remembered lives in `localStorage` under the `vb-` prefix.

```ts
const LS = { strikes: 'vb-strikes', mode: 'vb-mode', source: 'vb-source', quiet: 'vb-quiet', read: 'vb-read' } as const
// plus 'vb-sym', used inline rather than through LS
```

| Control | Where | Values | Default | Storage key | Stored shape |
|---|---|---|---|---|---|
| **Symbol box** | header | `[A-Z.]{0,6}`, forced uppercase, non-matching characters stripped on input | `SPX` | `vb-sym` | bare string |
| **GEX / VEX** | toolbar `Seg` | `'GEX' \| 'VEX'` | `GEX` | `vb-mode` | bare string |
| **oi / volume** | toolbar `Seg` | `'oi' \| 'volume'` | `oi` | `vb-source` | bare string |
| **⚡ 0DTE / ⚡ Front** | toolbar `Chip` | toggles `scope` between `0` and `-1` | — | none | — |
| **Week** | toolbar `Chip` | toggles `scope` between `'WEEK'` and `-1` | — | none | — |
| **Σ all** | toolbar `Chip` | sets `scope = -1` | `-1` | none | — |
| **Dates · `<tag>`** | toolbar | **read-only tag**, not a button | — | — | — |
| **◹ Quiet** | toolbar `Chip` | boolean | off | `vb-quiet` | `'1'` / `'0'` |
| **▾/▸ Session Read** | context bar `Chip` | boolean | **on** | `vb-read` | `'1'` / `'0'` |
| **30 / 50 / 100 / 150** | inside the grid's Strike header | one of `[30, 50, 100, 150]` | `50` | `vb-strikes` | the number as a string |
| **Column header click** | grid `<th>` | toggles `scope` between that index and `-1` | — | none | — |
| **Row click** | grid `<tr>` | sets `openStrike` → opens `NodeCard` | `null` | none | — |
| **★ Volt / ↯ Surge / ◉ Spot pills** | header | scroll the grid | — | none | — |
| **Tile click** | StatBand | `onJump(strike)` | — | none | — |

**No version field on any key.** Validation is per-read: `strikeCount` checks `[30,50,100,150].includes(n)` and falls back to 50; `quiet`/`read` compare against `'1'`; `mode`/`source`/`symbol` are cast with no validation at all (see Gotchas).

```ts
function pref<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) || fallback } catch { return fallback }
}
```

with the note on the call site: *"pref() infers its literal fallback, so pref(k, '0') returns the TYPE '0' and `=== '1'` is a comparison TS can prove never holds. Widen at the call."* — hence `pref<string>(LS.quiet, '0') === '1'`.

### The dates control, in the toolbar's own words

> THE DATES PICKER IS THE BOARD'S MOST IMPORTANT CONTROL and it is the one people miss, so it says what it is doing in words rather than only in state: the chip carries the scope's own tag, and every tile and every ribbon line downstream repeats that tag. Changing the dates changes every number on the page, and the page has to make that obvious or the numbers look wrong.

> ⚡ 0DTE is a shortcut, not a fourth mode: it scopes to the nearest expiration, and tapping it again goes back to Σ all. Same control, two taps.

The 0DTE chip's **label** changes to `⚡ Front` when the front column is not today's expiration, and its title says so explicitly: `Jump to the nearest expiration. This name has no same-day contract today. Tap again for all dates.`

All three scope chips are `disabled` when `!board?.cols.length`.

### Control tooltips, verbatim

| Control | Title |
|---|---|
| GEX | `Gamma exposure — how hard dealers lean against a move.` |
| VEX | `Vega exposure — how the book reacts to a change in implied vol.` |
| oi | `Open interest — the positions carried on the book. Updates once a day.` |
| volume | `Today's volume — contracts traded so far. The level cards stay on open interest.` |
| ⚡ 0DTE (front is today) | `Jump to the nearest expiration, which today is a same-day contract. Tap again for all dates.` |
| ⚡ Front (front is not today) | `Jump to the nearest expiration. This name has no same-day contract today. Tap again for all dates.` |
| Week | `This week's expirations together: today through Friday. One combined Volt, call wall and put wall for the week.` |
| Σ all | `Every expiration the board carries, added together.` |
| Dates tag | `Every level, tile and ribbon line on this page is scoped to these dates.` |
| ◹ Quiet | `Quiet map: push back every cell with no mark, so the Volt, the Reversal and the Surge come forward.` |
| Session Read (open) | `Hide the Session Read — you can bring it back any time` |
| Session Read (closed) | `Show the Session Read of the board` |
| Strike-window buttons | `Show <n> strikes, centred on price` |
| Column header | `<ISO exp> · expires today \| <n>d. Click to scope the board to this date.` |
| Cell | `<strike> · <MM/DD> · <$value> <GEX\|VEX> on <open interest\|volume>` |
| Jump pills | `Scroll the grid to this level` |
| Freshness dot (built) | `Board built <n>s ago. Rebuilds every 60s.` |
| Freshness dot (building) | `Building the board…` |
| Gamma pill (positive) | `Positive gamma across the dates in view — dealers lean against moves, so ranges tend to hold.` |
| Gamma pill (negative) | `Negative gamma across the dates in view — dealers move with price, so moves tend to stretch further.` |

### The jump mechanics

```ts
const jump = useCallback((strike: number) => {
  const rows = document.querySelectorAll<HTMLElement>('#board-grid tbody tr')
  for (const r of rows) {
    if (r.textContent?.startsWith(fmtStrike(strike))) { r.scrollIntoView({ block: 'center', behavior: 'smooth' }); return }
  }
}, [])
```

A **text-prefix scan** over the rendered rows. `◉ Spot` instead uses `document.getElementById('spot-row')`. `Voltmap` emits those ids only when `ids` is true:

> `ids` — when false, emit no `#spot-row` / `#volt-row`. Two mounted Voltmaps means two of each, and the jump buttons use getElementById, which takes the FIRST match in the DOM. The symptom of forgetting this is that the jumps "sometimes do nothing", and it cannot reproduce in a one-pane test.

Two other props exist for the same "second pane" reason: `onStrikeCount` (*"absent hides the 30/50/100/150 control. A pane pins to 30 rather than carrying a second layout control in a small box"*) and `netWidth` (default **280**px — *"A narrow pane asks for less"*). `VoltBoard` passes neither `ids` nor `netWidth`, taking the defaults.

---

## Rendering

**DOM only — one `<table>`, no canvas, no SVG, no chart library.**

### Page structure

```
<Page fill>
  header  (symbol, price, gamma pill, freshness dot, spacer, ★ Volt / ↯ Surge / ◉ Spot pills)
  <BoardToolbar>   GEX|VEX · oi|volume · ⚡0DTE · Week · Σ all · Dates tag · spacer · ◹ Quiet
  <ContextBar>     [▶ Show me around] · ▾ Session Read · <IbStrip>
  {readOpen && <SessionRead>}
  <Voltmap> | fallback message
  <StatBand>  →  tiles grid + <Legend>
  {openStrike != null && <NodeCard>}
</Page>
```

`<Page fill>` is `flex min-h-0 flex-1 flex-col overflow-hidden`. The header, toolbar, context bar, Session Read and StatBand are all `shrink-0`; the `Voltmap` is `flex min-h-0 flex-1 overflow-auto` and is the only thing that scrolls. Because the stat band is pinned below the grid, **the level tiles and the legend are always on screen** — a deliberate contrast with the grid, which scrolls.

### The grid

- `<table className="w-full border-separate border-spacing-0 text-2xs tabular">` — `border-separate` with zero spacing is what lets the sticky cells keep their own borders.
- `<thead className="sticky top-0 z-20">`; the Strike `<th>` is `sticky left-0 z-30`; each body row's strike `<td>` is `sticky left-0 z-10`.
- Column headers stack four lines: `MM/DD` (`text-2xs text-fg`), `★ <king>` or `★ —` (`text-3xs`, `MARK_COLOR.volt`), `⚡︎ <flip>` or `⚡︎ none` (`text-3xs`, `VIOLET`), and `0DTE` (`text-3xs`, `T.cyan`) when `isTodayExp`.
- **Out-of-scope columns are dimmed, not hidden:** headers get `opacity: lit ? 1 : 0.4`, cells `opacity: lit ? 1 : 0.35`, where `lit = d.cols.includes(i)`.
- Cells print `fmtVal(v)` or `·` when zero, right-aligned, with a `1px solid alpha(T.border, 0.5)` bottom rule.
- The spot row takes `background: V2W.spotRow` and its strike cell goes `color: T.cyan` with a `◄ Spot` tag.
- The flip glyph is drawn on `nearestTo(d.agg.flip, d.rows)` — *"The drawn row a continuous level lands on"* — since the flip is a fractional price.
- The Net profile column is `width/minWidth: netWidth` (280px) and is **not** sticky.

### `NetBar`

```tsx
<div className="relative h-3 flex-1" style={{ direction: v >= 0 ? 'ltr' : 'rtl' }}>
  <div style={{ width: `${pct}%`, height: METER_H * 2, marginTop: 2, background: alpha(hue, 0.85), borderRadius: 2 }} />
</div>
```

A **6px** bar (`METER_H * 2`) inside a 12px (`h-3`) track, growing left for negatives via `direction: rtl`. Beside it, the first of `volt`/`reversal`/`surge` found on that strike as a coloured glyph, then `fmtVal(v)` in the sign's colour at `minWidth: 56, textAlign: 'right'`.

### Colours

Everything is a token through `T`, `V2W`, `LEVEL_COLORS` and `VIOLET` from `src/design/theme.ts` — no literal appears in `src/voltboard/*`, and `theme-baseline.json` lists none of these files, so all twelve sit at zero grandfathered violations (non-negotiable 1).

| Used as | `theme.ts` name | Token | Hex today |
|---|---|---|---|
| positive gamma, BROKE HIGH, positive figures | `T.green` | `--color-up` | `#3ddc8e` |
| negative gamma, BROKE LOW, negative figures | `T.red` | `--color-down` | `#ff6b7a` |
| Surge, Coil, 0DTE tag, IB label, spot row text, active `Seg`/`Chip` | `T.cyan` | `--color-accent` | `#2f6bff` |
| Reversal | `T.purple` | `--color-dex` | `#6aa0ff` |
| loading dot | `T.orange` | `--color-warn` | `#ffd166` |
| ★ Volt | `LEVEL_COLORS.cb` | `--color-level-cb` | `#ffd166` |
| ▲ Call Wall | `LEVEL_COLORS.cw` | `--color-level-cw` | `#4d8cff` |
| ▼ Put Wall | `LEVEL_COLORS.pw` | `--color-level-pw` | `#ff5fa2` |
| ⚡︎ Flip | `VIOLET` | `--color-violet` | `#b48cff` |
| ≋ Air, hints | `T.faint` | `--color-faint` | `#c0c5c3` |
| labels | `T.muted` | `--color-muted` | `#e7ece9` |
| body text, cell ink | `T.text` | `--color-fg` | `#e7ece9` |
| every hairline | `T.border` | `--color-line` | `#1e2630` |
| modal scrim | `alpha(T.bg, 0.6)` | `--color-bg` | `#0a0d10` |

`V2W` values used here, all `color-mix` over `--color-v2-panel` `#0e1216`, `--color-v2-cyan` `#6aa0ff` or `--color-v2-chip` `#7fb0ff`:

| Name | Definition | Used for |
|---|---|---|
| `V2W.panelBg` | `alpha(V2.panel, 0.45)` | the page header band, the Session Read block, the StatBand band |
| `V2W.panelBgStrong` | `alpha(V2.panel, 0.72)` | a non-spot row's sticky strike cell |
| `V2W.panelSolid` | `alpha(V2.panel, 0.97)` | every `<th>`, the spot row's strike cell, the NodeCard plate |
| `V2W.tilePlate` | `alpha(V2.panel, 0.35)` | a level tile's plate |
| `V2W.chipBg` | `alpha(V2.chip, 0.1)` | the symbol input, every `Chip`, every `Seg`, the jump pills |
| `V2W.chipEdge` | `alpha(V2.chip, 0.28)` | the same, as a border |
| `V2W.spotRow` | `alpha(V2.cyan, 0.08)` | the spot row's background |

The `tokens.css` header explains why the wall palette lines up: *"Voltick's reserved colours were written for a gamma board: VOLT is the strongest level on it, SURGE is a wall, REVERSAL is where price turns, FLIP is the gamma flip. So the Core Bullseye is VOLT, the call wall is SURGE, the put wall is REVERSAL, and the flip is FLIP."*

### Type sizes

`text-3xs` 9 (mark glyphs, the column ★/⚡︎ lines, tile labels and hints, legend, NetBar values, IB strip, the disclaimer), `text-2xs` 10 (the table default, chips, the gamma pill, jump pills, per-expiration rows), `text-xs` 11 (strike numbers, the Session Read sentences, the NodeCard close button), `text-sm` 13 (the symbol input, the fallback message), `text-base` 15 (tile values, the NodeCard's net), `text-lg` 18 (the header price), `text-xl` 24 (the NodeCard's strike). All from the scale (non-negotiable 1: *"No `text-[10px]`, no `font-size:11.5px`, no `fontSize: 12`"*).

### Per-frame / perf machinery

There is **none**. No `requestAnimationFrame`, no `ResizeObserver`, no `IntersectionObserver`, no imperative draw loop. The whole page re-renders on:

1. a `spot` field change (a changed rounded price, through `useField`'s `Object.is` bail-out),
2. `setBoard` / `setLoading` every 60s,
3. any control change.

`useBoardDerived` is a `useMemo` keyed on `[board, scope, strikeCount, quiet, source]`, so a spot tick alone does **not** re-run `aggregate` — but it *does* change `shown` (`{ ...board, spot }` is a new object every render), which **does** invalidate the memo. See Gotchas.

`quiet` is in the dep list deliberately even though `cellStyle` reads it downstream: *"it is in the dep list so a flip of the switch repaints rather than waiting for data."*

---

## The Session Read

> This is the product's differentiator and it has one hard rule: it DESCRIBES and it never advises. No buy, no sell, no signal, no "watch for a long here". Every sentence is a statement about where the levels are and what that arrangement usually means, and every one of them is derived from the same `agg` the tiles and the grid read — so the ribbon can never describe a board that is not the one on screen.

> Each line is also allowed to be ABSENT. A board with no flip gets no flip sentence rather than a sentence explaining its absence, because the tile beside it already says "none" and saying it twice is how a ribbon turns into a wall of text nobody reads.

It reads `d.aggOi` (the open-interest aggregate) and emits up to six lines, in this order:

| Mark | Condition | Text (verbatim, with substitutions) |
|---|---|---|
| ● green | `netTotal >= 0` | `Positive gamma across <tag> (<$net>). Dealers lean against moves, so ranges tend to hold and pushes tend to grind rather than run.` |
| ● red | `netTotal < 0` | `Negative gamma across <tag> (<$net>). Dealers move with price, so a push tends to stretch further than the size behind it suggests.` |
| ★ | `king != null` | `The Volt is $<king> — the price with the most option activity stacked on it[, <|king−spot|> above\|below where price is now]. Levels that size tend to pull price toward them into expiration.` |
| ⚡︎ | `flip != null && side` | `The gamma flip is $<flip> and price is <above\|below> it. On this side moves usually grind.\|On this side moves usually stretch further.[ These dates cross more than once; this is the crossing nearest price.]` |
| ▲▼ | both walls non-null | `The heaviest strikes sit at $<putWall> and $<callWall>. Between them is where most of the book is, and where price has spent most of its time.` |
| ↯ | `surge != null` | `Today's flow is concentrated at $<surge>[, with the heaviest opposite lean at $<surgeWall>]. This one moves through the session — it is today's tape, not the settled book.` |
| ≋ | `air.length >= 3` | `Thin between $<min air> and $<max air> — very little is stacked there, so price tends to travel through that stretch quickly rather than pause in it.` |

Footer, always:

> Market analytics for educational purposes. Nothing here is investment advice.

(`text-3xs`, `alpha(T.text, 0.45)`.) The same line closes `NodeCard`.

---

## The level tiles (`StatBand`)

> A TILE WITH NOTHING TO SAY DOES NOT APPEAR. Twin levels share one card, and a box only shows up when it has a number — so the Volt tile absorbs the call wall when they are the same strike rather than printing it twice.

Three rules the file calls out as *"looking arbitrary and… not"*:

> 1. The tiles read `aggOi` — they are ALWAYS the open-interest board, even when the map above is weighted by today's volume. Every tile is titled with its basis, and the VOLUME switch stays lit, because a ★ Volt quoted off the wrong basis is the one mistake here that travels: someone reading a shared screenshot cannot scroll up to the switch.
> 2. `Gamma Flip` prints the word "none" rather than going blank when the scope is one-sided. A blank number reads as one that failed to load.
> 3. Whether a wall is a CEILING is checked against price, not assumed from its name. The heaviest call strike can sit below price, and then it is not a ceiling from here — the tooltip has to say so.

Layout: `grid` with `gridTemplateColumns: repeat(auto-fit, minmax(150px, 1fr))`, `gap-2.5`. Each tile is `rounded-lg` (`--radius-lg` 12px) on `V2W.tilePlate` with a `1px solid alpha(T.border, 0.8)` edge, three lines: label (`text-3xs text-muted`), value (`tabular text-base font-medium`, coloured), hint (`text-3xs text-faint`). A tile with `onClick` gets `cursor-pointer` and calls `onJump(strike)`.

| Tile | Shown when | Value | Hint | Colour |
|---|---|---|---|---|
| `Net <GEX\|VEX> · <tag>` | always | `fmtVal(netTotal)` | `Positive Gamma` / `Negative Gamma` | green/red |
| `Call Wall · <tag>` | `callWall != null && king !== callWall` | `$<strike>` | `distText` or `Strongest Ceiling` | `LEVEL_COLORS.cw` |
| `Put Wall · <tag>` | `putWall != null && king !== putWall` | `$<strike>` | `distText` or `Strongest Floor` | `LEVEL_COLORS.pw` |
| `Volt ★ · <tag>` | `king != null` | `$<strike>` | `distText` or `biggest level` | `LEVEL_COLORS.cb` |
| `Surge ↯ · today` | `surge != null` | `$<strike>` | `distText` or `today's hot spot` | `T.cyan` |
| `Gamma Flip · <tag>` | `flip != null` | `$<flip>` | `distText` or `Positive ↑ · Negative ↓` | `VIOLET` |
| `Gamma Flip · <tag>` | `flip == null && oneSided` | **`none`** | `positive gamma the whole way` / `negative gamma the whole way` | `VIOLET` |
| `Reversal ↘ · <tag>` | `reversal != null` | `$<strike>` | `distText` or `the far wall` | `T.purple` |
| `± Move` | `board.em != null` | `±<em>` | `today · one standard deviation` | `T.text` |
| `ATM IV · <front label>` | `board.atmIv != null` | `<iv×100>%` | — | `T.muted` |

The Net tile's title switches on scope: `Only the <tag> expirations, added together` vs `Every expiration on the board added together`, then *"across the full strike range. Change the dates and this number changes with it. Positive means moves tend to grind; negative means they stretch further."*

The wall tiles' titles switch on `onItsSide(k, ceiling)` — e.g. the call wall reads either `The strongest ceiling: rallies most often stall around here.` or `The heaviest call strike on the board — but it is sitting below price, so it is not a ceiling from here.` The Volt tile appends a sentence when it is *also* a wall, again in two versions depending on which side of price it is.

The one-sided flip tile's title ends with a route out: *"Pick more dates, or Σ all, to see the whole book's line."*

**`board.em` and `board.atmIv` are hard-coded to `null` in `buildBoard`.** Both tiles are therefore dead code today — see Gotchas.

---

## The IB strip

The 9:30–10:30 Initial Balance, inline in the context bar.

> IT HIDES ITSELF. No session yet, no row, nothing to say → it renders nothing at all, rather than a row of dashes. An empty strip in a header is worse than no strip: it reads as a thing that is broken rather than a thing that has not happened yet.

> ONE LINE, AND IT REFUSES TO WRAP. This cluster rides the context bar's own sideways scroll. Left to wrap internally it folds to four stacked lines and stretches a 44px bar to ~150px, leaving the chips on its left floating in a gap. `flex-shrink-0` + `whitespace-nowrap` hands the overflow to the scroll every other chip on that row already uses.

> Descriptive only: it states where the range was and whether price left it. It never says what to do about that.

State is `IbRow | null | false` — *"null = loading, false = hide"*. It hides when the fetch fails or when `Number(row.high) <= 0`.

Rendered: `◷ IB · 9:30-10:30` (cyan, `text-3xs font-semibold`), a `FORMING` pill while `Number(ib.locked) !== 1`, then `H <high> M <mid> L <low>` (`tabular text-3xs`, values `f2 = v > 0 ? v.toFixed(2) : '·'`), then the break pill. `mid` falls back to `(high + low) / 2` when the row omits it.

The break pill is `null` until the hour is locked **and** `spot > 0`; then:

| Condition | Word | Colour |
|---|---|---|
| `spot > high` | `BROKE HIGH` | `T.green` |
| `spot < low` | `BROKE LOW` | `T.red` |
| otherwise | `INSIDE` | `T.muted` |

with the title `Price is <word lowercased> relative to the 9:30–10:30 range. Descriptive only.`

An optional `onOpen` prop renders a `Full read →` link — *"opens wherever the long form lives. Omit to hide the link."* `ContextBar` does not pass it, so the link never appears today. Likewise `ContextBar`'s `onTour` (`▶ Show me around`) is optional and `VoltBoard` does not pass it.

---

## The legend

> It is not decoration. "Brighter = bigger" is a rule the grid's colour curve exists to keep, and this row is where anyone learns it. The three words on the right are the whole colour language of the map in eleven characters.

Eight glyph+label pairs on the left, each `title`d with its `MARK_WORD`, and three statements on the right:

| Glyph | Role | Label | Colour | `MARK_WORD` tooltip |
|---|---|---|---|---|
| ★ | `volt` | Volt | `LEVEL_COLORS.cb` | `the biggest level — price is pulled toward it` |
| ↯ | `surge` | Surge | `T.cyan` | `today's hot spot, where new money is going now` |
| ↘ | `reversal` | Reversal | `T.purple` | `the far wall a move tends to turn at` |
| ◆ | `coil` | Coil | `T.cyan` | `a big cluster — green slows price, red speeds it through` |
| ⚡︎ | `flip` | Flip | `VIOLET` | `above it moves grind, below it they stretch` |
| ≋ | `air` | Air | `T.faint` | `open road — price travels through` |
| ▲ | `callWall` | Call Wall | `LEVEL_COLORS.cw` | `the strongest ceiling` |
| ▼ | `putWall` | Put Wall | `LEVEL_COLORS.pw` | `the strongest floor` |

Right-hand trio: `Green = Positive gamma` (green), `Red = Negative gamma` (red), `Brighter = Bigger` (faint). Separated from the tiles by a `1px solid alpha(T.border, 0.7)` top rule.

`MARK_GLYPH`, `MARK_COLOR` and `MARK_WORD` are exported from `derive.ts` and shared by the legend, the grid's row marks and the node card — *"The glyph for a role, and its colour. The locked colour language."*

---

## The node card

> It answers the question the grid cannot: what IS this level, across the dates in view, and what is sitting on it.

> IT QUOTES THE SCOPE IT WAS OPENED UNDER. The card is built from the same `agg` the tiles read, so a row opened while the board is scoped to one date describes that date, and one opened on Σ all describes the whole book. The bug this avoids is a red 0DTE row opening a card that calls the level "sticky" because it quietly quoted the all-dates total instead.

Contents: the strike (`text-xl`), `<symbol> · <scopeTag>[ · <|dist|> above|below price]`, then each `MarkKind` on that strike with its glyph and `MARK_WORD`, then `Net <mode>` coloured by sign with `positive gamma` / `negative gamma` beside it, then a four-column `Fig` grid (Call OI, Put OI, Call Vol, Put Vol — summed across the in-scope columns, `toLocaleString()`, `·` when zero), then a per-expiration list (`<MM/DD> · today|<n>d` + `fmtVal`) filtered to `cell && cell.v !== 0`, then the disclaimer.

A TypeScript note worth keeping: *"Narrow ONCE, in the map, rather than trusting `.filter` to narrow the type — it does not, and `r.col` stays possibly-undefined all the way down."*

Shell: `fixed inset-0 z-50` with an `alpha(T.bg, 0.6)` scrim, closing on a scrim click; the panel is `max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl` on `V2W.panelSolid` with `stopPropagation`. Empty per-expiration list prints `Nothing on this strike for these dates.`

---

## Phone behaviour

**`/single` is not in `DESKTOP_TO_MOBILE`.** That map holds only `'/board' → '/m/gex'`, `'/traders-dashboard' → '/m/gex'` and `'/em' → '/m/em'`, and `MobileRedirect` only redirects routes it lists. So a phone opening `/v3/single` **stays on it**, inside the full desktop `Shell` — rail, toolbar, notes dock — because `Shell` branches on `isMobilePath(pathname)` and `/single` is not under `/m/`. There is no `/m/*` counterpart for the Voltmap, and it is not one of the six `MOBILE_TABS`.

**The page calls `useIsPhone()` nowhere**, and has no `sm:` breakpoint classes anywhere in `src/voltboard/*`. What it does have:

- The header (`flex-wrap`), the toolbar (`flex-wrap`) and the StatBand grid (`auto-fit, minmax(150px, 1fr)`) all reflow to narrow widths.
- The context bar is `overflow-x-auto` and `IbStrip` is `shrink-0 whitespace-nowrap`, so that row scrolls sideways instead of stacking — the one place a width decision was made deliberately, and it is documented in `IbStrip`'s header.
- The grid is `overflow-auto` in **both** axes with a sticky strike column, so on a narrow screen it is a two-dimensional scroll over a fourteen-column table.

That last point is exactly the shape `mobileNav.ts` rejected for the options chain — *"at 390px it is a horizontal scroll over a table you cannot see two columns of at once, which is not the page, it is a picture of the page. It stays a desktop screen until there is a phone DESIGN for it rather than the desktop one made narrow."* The same reasoning applies here and no tab was built; the difference is that the chain at least redirects nothing, and neither does this.

`NodeCard` is `fixed inset-0 z-50`, so on a phone it covers the whole viewport including the toolbar — and on a desktop too. That is a departure from `Expand.tsx`'s stated philosophy (*"NOT the browser's Fullscreen API and not `position: fixed` over the viewport: both of those take the RAIL and the TOOLBAR with them, and those two are how you leave the card you just expanded"*), though the node card is a modal with an explicit ✕ and a scrim-click close, not a working surface.

### Scrolled out of view — AGENTS.md non-negotiable 5

> A card nobody can see does not paint. `ChartFrame` reports its own visibility three ways — `handle.visible()` for a per-frame loop, `onVisibility` for an on-demand renderer, `data-visible` on the element. Use one. The board is N cards on ONE main thread sharing ONE animation frame, and the cards below the fold are most of that budget if nothing stops them.

**This page has no per-frame renderer to gate.** It is a `<table>` with browser-managed paint: rows scrolled out of the grid's own scroll port cost nothing beyond layout, there is no canvas, no `rAF` loop, and `scripts/perf-check.mjs` — which *"counts REPAINTS PER ANIMATION FRAME on every canvas v3 owns (the ones tagged `data-cb-layer`), attributed per board card"* — has nothing here to measure, because the Voltmap owns no canvas and is not a board card. Non-negotiable 5's `offscreenRepaints: 0` is satisfied vacuously.

What is **not** gated is the page's *work*, and this is worth naming:

- **The 60s rebuild keeps running while the tab is hidden.** `setInterval` is not paused, and `buildBoard` is called through `query()` directly rather than through `useQuery` — which is the thing that stops polling on a hidden tab (*"Polling stops while the tab is hidden — a background tab refetching a chain every 15s is pure egress nobody is looking at"*). Browsers throttle background timers to roughly once a minute, which happens to be this page's cadence, so a hidden tab keeps issuing up to fifteen requests a minute.
- **The 30s IB poll likewise.**
- **The `spot` subscription stays live**, so `spot` stays in the socket's `?topics=` set for as long as the route is mounted — which is correct, since the route unmounts on navigation and the scope narrows `NARROW_MS = 1200`ms later.
- **Navigating away unmounts everything.** `VoltBoard` is a lazy route with no cache of its own, so leaving `/single` clears both intervals, drops the `spot` subscription and discards the board. Coming back re-runs `buildBoard` from scratch — though the `query()` cache (30s TTL) will serve the expirations list and any column fetched within the last 30 seconds.

---

## Status and empty-state messages, verbatim

### The grid fallback

Rendered in place of the whole grid when `!(shown && d && d.rows.length > 0)`, in a `flex flex-1 items-center justify-center p-8` with `text-sm text-muted`:

```
{loading ? `Building the ${symbol} board…` : (board?.warning ?? `No board for ${symbol}.`)}
```

So three possible strings:

> Building the SPX board…

> No board for SPX.

…or `board.warning`, of which there are exactly two, both from `buildBoard`:

**No listed expirations came back** — the long one, and it names the likely cause:

> No listed expirations came back for `<T>`. `/api/expirations` returned nothing this page could read — check it is answering (it needs a subscriber session) and that its payload still carries `data.items[].expiration-date`.

**Expirations came back but every column was empty:**

> No live chain payload returned for `<T>`.

### Elsewhere

**The gamma pill** (only when `d` exists), with `● ` prefixed and the scope tag appended:

> ● Positive Gamma · all dates
> ● Negative Gamma · this week

**The freshness dot** has no text, only a colour and a title. *"The feed dot. It reports the BOARD's freshness, not the socket's — a live spot over an hour-old matrix is the state worth showing."*

| Colour | State |
|---|---|
| `T.orange` `#ffd166` | `loading` |
| `T.green` `#3ddc8e` | a board exists and is not loading |
| `T.red` `#ff6b7a` | no board at all |

Titles: `Board built <n>s ago. Rebuilds every 60s.` / `Building the board…`

**The price** renders `—` when `spot <= 0`.

**Column headers** print `★ —` when a column has no king and `⚡︎ none` when it never crosses.

**Cells** print `·` when the value is 0.

**IB values** print `·` when not positive.

**NodeCard, empty breakdown:** `Nothing on this strike for these dates.`

**The disclaimer**, on both `SessionRead` and `NodeCard`:

> Market analytics for educational purposes. Nothing here is investment advice.

---

## Performance and bundle notes

### Chunking

`/single` is `lazy()` like every route but the landing one, with its own justification: *"Its own chunk: the matrix builder and the grid are dead weight on every other route."* Measured as kind **`route`** against `budgets.json`'s `"route": 59100` (brotli bytes).

What rides along in that chunk: the twelve `voltboard` files (2,412 lines total) **plus `src/pages/optionsChain/chainMath.ts`** (558 lines), imported for `parseExpiration`, `Expiration` and `GreekCell`. That import is the deliberate cost of the no-second-copy rule — and `chainMath.ts` is also in `/options-chain`'s and `/chain`'s graphs, so Rollup may hoist it into a shared chunk rather than duplicating it.

`vite.config.ts` does no manual chunking for this route: only `node_modules/(react|react-dom|scheduler)/` → `react` and the seasonality data tables → `data-seasonality` are hand-split, because *"a shared vendor chunk means one dependency change invalidates the cache for all of them."*

### `budgets.json`, in full

```json
"entry": 38900, "react": 55000, "route": 59100, "data": 78000,
"css": 8500, "html": 2600, "totalInitial": 108400,
"ratchet": { "slack": 0.15, "enforce": false },
"perf": { "idleRepaintsPerFrame": 0.15, "offscreenRepaints": 0, "interactionRepaints": 10 }
```

Non-negotiable 7: *"Budgets are hard limits, and they ratchet. `npm run build` fails if a chunk is over. Raise a number in `budgets.json` deliberately, in a diff someone can see — never work around it."* The `perf` block does not bind this page (no `data-cb-layer` canvas, no `data-card-id`). The voltick README notes that this repo's `build` (`tsc --noEmit && vite build`) *"deliberately does not run `check-theme.mjs` or `check-budgets.mjs`"*, so both are hand-run here.

### Runtime cost per rebuild

Per 60s cycle: **1 + N requests**, N = up to `MAX_COLUMNS` = 14. On SPX that is fifteen requests a minute, each `?range=all`, which is the widest chain payload the proxy serves. `query()`'s 30s cache does not help at a 60s cadence — every rebuild is past the TTL — so nothing is deduped across cycles. Within a cycle, dedupe does bite: `/api/expirations?ticker=SPX` is the exact URL the rail prefetches, so a hover-then-click lands on a cached list.

Per render, `useBoardDerived` runs `aggregate` once (twice in volume mode) over `strikes × scopedColumns` cells, plus `heatRef`'s sort over at most `strikeCount` (≤150) values. The reversal search is **O(strikes²)** — for each candidate it scans every strike for cluster members — which on an SPX board of several hundred strikes is tens of thousands of comparisons per aggregate. That is cheap at 60s, and it is on the critical path of every spot tick (see Gotchas).

Source maps are off (non-negotiable 8).

---

## Gotchas

1. **`board.em` and `board.atmIv` are always `null`.** `buildBoard` sets both literally, with no computation anywhere in the folder. The `± Move` and `ATM IV` tiles in `StatBand` therefore never render, and their tooltips (*"How far the options market expects price to move today — one standard deviation, so it holds about 2 days in 3"*) are unreachable. `BoardMap` types them as `number | null` and documents them as real fields.

2. **`board.prevClose` is always 0.** Same shape: typed on `BoardMap`, set to `0` in both `buildBoard` return paths, read by nothing.

3. **`shown = { ...board, spot }` is a new object on every render**, so `useBoardDerived`'s `useMemo` — keyed on `[board, scope, strikeCount, quiet, source]` where the first entry is `shown` — is invalidated by **every spot tick**. The whole aggregate, including the O(strikes²) reversal search, re-runs on each price change that survives `useField`'s equality check. The comment claiming the grid "holds still" while the header ticks is true visually (the *cells* are unchanged) but not computationally.

4. **`pref()` casts without validating**, for `vb-mode`, `vb-source` and `vb-sym`. A hand-edited `localStorage.setItem('vb-mode', 'XYZ')` makes `mode` the string `'XYZ'`; `buildBoard`'s `mode === 'GEX' ? g.gex : g.vex` then silently draws VEX, and the `Seg` lights neither option. `vb-strikes` is the only key with a whitelist.

5. **The symbol box has no debounce and no validation beyond the character filter.** Every keystroke calls `setSymbol`, which changes `rebuild`'s identity, which tears down and restarts the interval and **fires a full rebuild** — up to 15 requests per character typed. Typing `AAPL` issues four rebuilds. The `gen` guard keeps the *display* correct; it does not prevent the traffic.

6. **`scope` is not persisted and not in the URL.** Every other control survives a reload; the dates do not, and always come back as `Σ all`. It is also not shareable — unlike `/scanner?tab=`, `/feedback?tab=`, `/level-log?ticker=&date=` and `/economic-calendar?tab=`, all of which `App.tsx` calls out as deliberately query-string-backed *"shareable link[s]"*.

7. **The page ignores the board symbol entirely.** `usePageSymbol()` is never called, so the toolbar's `TickerPicker` and the SPX chip — *"THE ticker control for the whole board. Every card that can follow a symbol follows this one"* — move a value nothing on this page reads. That is precisely the failure the toolbar comment names: *"A picker that moves a value no visible card follows is a control that lies, which is the one thing this toolbar was rebuilt to stop being."*

8. **`jump()` matches by text prefix.** `r.textContent?.startsWith(fmtStrike(strike))` — so jumping to strike `765` will match a row for `7650` if `7650` comes first in the DOM. Strikes are drawn high-to-low, so the longer number usually *is* first. Jumping to `5000` on a board that also carries `50000` is the reproducible case.

9. **`#volt-row` is emitted and never used.** `Voltmap` sets it on the first row holding the `volt` mark, but the ★ Volt pill goes through `jump()` (the text scan) and only `◉ Spot` uses `getElementById`. The id is dead unless something else adopts it.

10. **The VOLUME switch is a no-op on the map in VEX mode.** `volNet` falls back to `g.vex`, so `cell.v` is identical either way. The header still prints `Net VEX · volume · <tag>` and the cell tooltip still says `on volume`, both of which describe a leg that does not exist on this feed.

11. **The tiles and the grid can disagree on purpose, and only a tooltip says so.** In volume mode `StatBand`/`SessionRead` quote `aggOi` while `Voltmap`/`NodeCard` quote `agg`. The design note is explicit about why (*"a ★ Volt quoted off the wrong basis is the one mistake here that travels"*), but the on-screen disclosure is the per-tile `title` and the oi/volume tooltip — nothing in the tile's visible text names the basis.

12. **`surge` is the front column only, whatever the scope.** Its tile is labelled `Surge ↯ · today` rather than `· <tag>`, which is honest, but it means the Surge tile ignores the dates control while every tile beside it obeys it. If the front column is not today's expiration (the `⚡ Front` case), `Surge · today` is naming a date that is not today.

13. **`flipOf` (per column) and `flipWalk` (per scope) are two implementations of one idea.** Both interpolate and both pick the crossing nearest spot, but they are separate functions in separate files, and only `flipWalk` reports `oneSided` and a crossing count. A change to the crossing rule has to be made twice — exactly the shape of duplication `derive.ts`'s header rule exists to prevent.

14. **`heatRef` and `maxAbs` cover the drawn window, not the board.** Switching 50 → 150 strikes changes every colour and every bar length without a single number changing. The legend's promise (*"Brighter = Bigger"*) holds within a window, not across windows.

15. **The heat scale is driven by `agg.byStrike` (the scoped row totals), but the cells it colours are per-column values.** `useBoardDerived` computes `ref` from `shown = rows.map(k => agg.byStrike.get(k))`, while `Voltmap` calls `cellStyle(cell.v, d.ref, …)` on a single date's value. On an all-dates board every cell is therefore compared against a reference roughly `N` columns larger than itself, which flattens the grid; on a single-date scope the two agree. The Net bar does not have this problem — it uses `agg.byStrike` for the value too.

16. **A rejected `query()` inside `fetchExpirations` propagates unhandled.** `fetchColumn` catches; `fetchExpirations` does not, and `rebuild()` has a `finally` with no `catch`. A 500 on `/api/expirations` leaves the previous board on screen with the dot stuck green and an unhandled rejection in the console — no user-visible message.

17. **`setLoading(false)` is skipped when a stale generation resolves.** `finally { if (mine === gen.current) setLoading(false) }` is correct for the stale case, but if the *newest* request rejects before the guard, the `finally` still runs, so the dot recovers. The case that does not recover: two rapid symbol changes where the second's `buildBoard` never settles.

18. **Both intervals run in a hidden tab.** Neither uses `useQuery`'s visibility suppression, so a backgrounded `/single` keeps rebuilding (throttled by the browser to roughly its own cadence) and keeps polling IB. `api.ts` is explicit that the default is the other way: *"a background tab refetching a chain every 15s is pure egress nobody is looking at."*

19. **`query()`'s 30s default TTL and the IB poll's 30s interval are the same number.** `query` serves from cache when `now - hit.at < staleMs`, so an IB poll landing a hair under 30s after the last one gets the cached row and the strip goes stale for a cycle. Harmless, but the two constants are set independently in two files and happen to collide.

20. **No `Card`, so no expand and no camera.** The Voltmap cannot be expanded (`Card` draws that button) and publishes no `CopyShotTarget`, so the owner's 📸 menu is empty on this route — *"nothing at all until some surface on the current page has published itself as worth photographing."* A screenshot of the Voltmap has to come from the OS.

21. **`Legend` gives Surge and Coil the same colour** (`T.cyan` for both, per `MARK_COLOR`), so the two are distinguished by glyph alone (↯ vs ◆). Everything else in the legend has a unique hue.

22. **`T.purple` is `--color-dex` `#6aa0ff` and `VIOLET` is `--color-violet` `#b48cff`.** The Reversal (purple) and the Flip (violet) are two different tokens whose names both read as "purple"; `LEVEL_COLORS.cw` `#4d8cff` is a third blue on the same board. Check the token, not the name.

23. **`MAX_COLUMNS = 14` is applied after sorting ascending**, so the board always shows the *nearest* fourteen expirations. A ticker with monthly-only listings therefore spans a year; a ticker with dailies spans three weeks. The `Week` and `Month` scopes are computed over whatever those fourteen happen to be, and `'MONTH'` keys off `cols[0]`'s month — so on the last day of a month, `this month` is a single column.

24. **`ContextBar`'s `onTour` and `IbStrip`'s `onOpen` are wired but never passed.** `▶ Show me around` and `Full read →` are unreachable today. Both are single-prop additions away from appearing.

25. **The Voltmap has no parity checklist, and that is correct.** `AGENTS.md` and `App.tsx` cite `docs/parity/*.md` for the six routes that ARE v2 ports; this is not one. Its spec is the lineage named in its own file headers — Voltick's `board-derive.jsx`, `heatscale.js` and `meterscale.js`. Do not go looking for a checklist that was never meant to exist.

26. **The 0DTE chip is `scope === frontIdx` where `frontIdx = 0`, always.** Clicking a *column header* for index 0 sets the same scope, so the chip lights up from a header click too — which is correct and worth knowing when reading the toolbar's state.
