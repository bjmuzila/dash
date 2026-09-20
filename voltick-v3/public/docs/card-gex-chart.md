# `gex-chart` — GEX Chart · 📊 · default 24 × 48 · `src/board/gexChart/`

> Catalog entry: `src/board/catalog.tsx:202-211`. `id: 'gex-chart'`, `icon: '📊'`,
> `label: 'GEX Chart'`, `defaultSize: { w: 24, h: 48 }`, rendered through
> `lazy(() => import('./gexChart/GexChartCard'))` inside a `<Deferred>` whose
> Suspense fallback is `<div className="min-h-0 flex-1" />` — a blank fill, not a
> spinner, because "the card frame is already drawn around it, and a spinner
> inside a frame reads as an error."
>
> No `Title` component: the header is the plain catalog label. The card's own
> live subject (symbol · series · scope · basis) lives in `data-capture-meta`
> instead, for the CopyShot caption.

---

## What it is, in one paragraph

The GEX Chart is a strike ladder. Every listed strike on one expiry gets a bar,
and the bar's height is the dealer's gamma (or delta) exposure at that strike in
dollars — positive above the zero line, negative below it. Price is drawn as a
dashed vertical so you can see where spot is sitting inside the book, the strike
carrying the most gamma is boxed and labelled `CB`, and above the canvas sits a
row of ten stat tiles naming the call wall, the put wall, the flip, the core, max
pain, this week's ±1σ band, the positive-gamma share and the tape's bull/bear
premium split. It is v2's home-page chart, re-housed as a board card: v2 drove
`mode`, `dataMode`, `showDex`, the expiry label and the stat row through props
from the home page's own toolbar, and v3 has no home page to hang those on, so
the card owns them. The chart itself — pan, zoom, y-scale, recentre, the bar
gradients, the DEX line, the core badge — is an imperative canvas that never
touches React, because "a pan is sixty pointer events a second; none of them
reach React."

---

## File map

| File | Lines | What it owns |
|---|---:|---|
| `src/board/gexChart/GexChartCard.tsx` | 741 | The React shell: toolbar, the five controls, both data sources (socket + chain), the ex-0DTE sweep, the tile-sync throttle, the visibility gate, the four status lines, the `simple` phone variant. |
| `src/board/gexChart/gexChartRender.ts` | 979 | The canvas. Viewport, densify, spot-follow, bars, gradients, DEX overlay, flip line, spot line, CB badge, X labels, series line, hover readout, wheel/drag/dblclick listeners. |
| `src/board/gexChart/StatCards.tsx` | 387 | `StatCards` (the ten gamma tiles) and `DeltaStatCards` (the seven delta tiles). Owns the two extra fetches: `/api/em-tracker` and `/proxy/flow-history`. |
| `src/board/gexChart/values.ts` | 324 | *One* definition of "what is the number at this strike": the leg accessors, the basis resolution, the support tests, the level derivation hand-off, the formatters and every label map. |
| `src/board/gexChart/settings.ts` | 154 | The persisted settings blob — types, defaults, coercion, `localStorage` read/write. |
| `src/board/gexChart/dailyEm.ts` | 15 | **Empty.** A tombstone: `export {}` plus a note saying the daily EM band moved to `src/data/dailyEm.ts` (it belongs on GEX Candles, which has a price axis). "Nothing imports this path any more." |

Supporting modules this card reads:

| File | Lines | Why it matters here |
|---|---:|---|
| `src/board/catalog.tsx` | 444 | The catalog entry, the instance-id scheme, `placeNewCard`'s "a second copy is the size of the first" rule. |
| `src/board/chainGex.ts` | 129 | The non-SPX path: `/api/chains` → the identical `GexRow` shape. |
| `src/data/levels.ts` | 286 | `deriveLevels` — the one definition of a wall, a core and a flip. |
| `src/contract/frames.ts` | 258 | The wire contract for `gex` and `spot`, and the optional exposure legs. |
| `src/data/api.ts` | 239 | `useQuery` — dedupe, cache TTL, poll, hidden-tab pause, `refreshAll`. |
| `src/data/hooks.ts` | 75 | `watchFrame` — imperative frame access that never goes through React. |
| `src/data/symbol.tsx` | 111 | `usePageSymbol`, `SOCKET_SYMBOL = 'SPX'`, `isSocketSymbol`. |
| `src/data/dailyEm.ts` | 132 | Where the daily EM band went. **Not read by this card.** |
| `src/pages/scanner/gexLevels.ts` | 2632 | `GEX_MULTI_POLL_MS`, `scopeNoteEx0dte`, `multiDeltaAllZero`, `GexMultiLadder`. |
| `src/pages/scanner/gexLevelsData.ts` | 1078 | `loadGexByStrikeMulti` and its error-shape recovery. |

---

## The data path

### Three sources, one row shape

Everything the chart draws is a `GexRow[]` (`src/contract/frames.ts:53-109`).
Three producers fill it, and the card branches on the page symbol:

```
page symbol === 'SPX'  ──┬── series scope '0dte'   → WebSocket `gex` frame
                         └── series scope 'ex0dte' → GET /proxy/gex-by-strike-multi
page symbol  ≠  'SPX'  ───── GET /api/chains (board/chainGex.ts)
```

Spot follows the same split: the `spot` frame for SPX (the live print — the `gex`
frame does not carry one), the chain's own `underlyingPrice` otherwise, and the
sweep's own `spot` only until a live tick arrives.

### 1. The socket — `gex` and `spot`

Subscribed through `watchFrame` (`src/data/hooks.ts:329`), never `useFrame`:
AGENTS.md rule 4, "never push a tick through React state on its way to a chart."

```ts
watchFrame<GexFrame>('gex', (frame) => {
  const d: GexData | undefined = frame?.data
  if (!d) return
  socketRef.current = { rows: d.gexRows ?? [], expiry: d.expiry ?? '' }
  if (wantMultiRef.current) return      // ex-0DTE selected: keep the sub, skip the push
  push(socketRef.current.rows, spotRef.current, symbol, socketRef.current.expiry)
})
```

`GexData` shape actually read: `gexRows`, `expiry`. (`callWall`, `putWall`,
`gexFlip`, `totalNetGex`, `totals`, `updatedAt` ride along and this card reads
none of them — the walls and the flip are re-derived from the rows against the
spot on screen. See `src/data/levels.ts:24-31` for why.)

**The subscription stays live on an ex-0DTE series.** Unsubscribing would narrow
the socket's derived topic scope, and switching back would then sit on an empty
chart until the next ladder *change* — "server-v2 dedupes the `gex` frame, so
'no news' is silence, not a repeat," and on a quiet book that can be minutes.

Returning early when off-socket is what **unsubscribes**, which is also what
narrows the derived topic scope: "the card stops asking for `gex` the moment it
stops reading it."

`spot` is a ~10 Hz topic. Its watcher:

```ts
const rows = wantMultiRef.current ? multiRowsRef.current : socketRef.current.rows
if (!rows.length) return
const now = Date.now()
const syncTiles = now - tileSyncRef.current >= TILE_SPOT_MS   // 1000 ms
if (syncTiles) tileSyncRef.current = now
push(rows, px, symbol, wantMultiRef.current ? '' : socketRef.current.expiry, syncTiles)
```

`wantMultiRef` is a **ref, not a dependency**, precisely so the spot watcher never
tears down and re-subscribes on a series change — "resubscribing a 10Hz topic to
change which array it reads is work for nothing."

### 2. `/api/chains` — every non-SPX ticker

```ts
const chainQ = useQuery<unknown>(onSocket ? null : chainGexUrl(symbol),
                                 { staleMs: 15_000, pollMs: 15_000 })
```

URL (`src/board/chainGex.ts:206-208`):

```
/api/chains?ticker=<SYM>&range=all&live=0
```

`live=0` because "the chain adapter serves the subscribed underlying from the
live socket subscriber, which streams a single expiry" — harmless here (this only
reads the front expiry anyway), but it "keeps one rule for one route."

A **null URL is what stops the request from firing at all**, rather than firing
and being ignored. `staleMs` alone would never refetch — it is a cache TTL, not
an interval (`src/data/api.ts:20-27`); the `pollMs` is what keeps it arriving.
The poll skips a tick while `document.visibilityState === 'hidden'` and fires one
immediately on `visibilitychange` back to visible.

`chainToGex` takes `expiries[0]` — the FRONT expiry only. Per-strike arithmetic
is `mgMath.strikeGex()`:

```
netGEX    = (|callγ|·callOI  − |putγ|·putOI ) · spot² · 0.01 · 100
netVolGEX = (|callγ|·callVol − |putγ|·putVol) · spot² · 0.01 · 100
callGEX   =  |callγ|·callOI  · spot² · 0.01 · 100
putGEX    = −|putγ| ·putOI   · spot² · 0.01 · 100
netDEX    =  callΔ·callOI ·spot·100 − |putΔ|·putOI ·spot·100
volNetDEX =  callΔ·callVol·spot·100 − |putΔ|·putVol·spot·100
```

`flowGEX` is **deliberately absent rather than 0** on this path: "there is no
classified tape for a non-socket ticker, so the honest answer is 'not
available', and a column of zeroes would look like a flat flow book instead."
That absence is exactly what `flowSupported()` tests.

### 3. `/proxy/gex-by-strike-multi` — the ex-0DTE sweep

URL (`gexLevelsData.ts:273`), symbol defaulted to `EOD_GEX_SYMBOL = '$SPX'` but
passed `SOCKET_SYMBOL` from this card:

```
/proxy/gex-by-strike-multi?symbol=SPX
```

Cadence: `GEX_MULTI_POLL_MS = 60_000` (`gexLevels.ts:1440`), with
`staleMs: NO_STORE_STALE_MS = 10_000` on the underlying `query()`. Sixty seconds
because "`/proxy/gex-by-strike-multi` is one upstream fetch PER EXPIRATION and
the server caches the body ~60s, so polling it faster buys a cached body."

Fetched **only while an ex-0DTE series is selected** — "a board sweep every minute
for a series nobody has picked is the cost this gate exists for" — and the effect
fires immediately on the way in, "so picking the series is not a 60-second wait."
Hidden tabs are skipped; `visibilitychange` back to visible fires one immediately.

Response shape parsed (`gexLevelsData.ts:440-570`):

```jsonc
{
  "ok": true,               // false → throw String(json.error || "HTTP 200")
  "spot": 7642.3,
  "sessionDate": "2026-09-14",
  "expiryCount": 12,        // INCLUDES 0DTE
  "all":   { "rows": [...], "totalNetGex": n, "gexFlip": n, "callWall": n, "putWall": n },
  "ex0dte":{ "rows": [...], "totalNetGex": n, "gexFlip": n, "callWall": n, "putWall": n },
  "updatedAt": 1789...,
  "cached": true
}
```

Each row is slim — five real fields:
`{ strike, netGEX, netVolGEX, netDEX, volNetDEX }`. `parseMultiLadder` drops any
row whose `strike > 0` is not strictly true, and the four scalars are
`== null ? null : Number(v)` so a server-v2 predating the walls change parses
them as `null` rather than `0`.

`widenMultiRows()` in the card zero-fills the rest of `GexRow`:
`callVolume`, `putVolume`, `callGamma`, `putGamma`, `dte` all become `0`.
**That is not a loss** — "the split, the flow basis and the CB badge all test the
rows for the legs they need and refuse rather than drawing zeros, so a zero here
can never be mistaken for a measurement."

`sessionDate`, `updatedAt` and `cached` are parsed and rendered **nowhere** —
spec item B213, "Do not port" 9: "the three cards carry no freshness stamp at all
despite reading a body the server caches for ~60s."

### HTTP-200-on-failure

Two distinct 200-that-is-a-failure cases on the multi route, both recovered by
`multiErrorText` (`gexLevelsData.ts:522-528`):

| Shape | What `query()` does | Message the card prints |
|---|---|---|
| **200 carrying HTML** (un-redeployed server-v2 falls through to Next's HTML 404) | `res.json()` throws a `SyntaxError` | `endpoint /proxy/gex-by-strike-multi not found — server-v2 needs a restart/redeploy to pick up the route` |
| **200 with `{ ok: false }` and no `error`** | resolves normally | `HTTP 200` — "a body that says ok:false and then declines to say why" |
| Real 404 | `query()` throws `"404 Not Found — /proxy/…"` | the same `MULTI_ROUTE_MISSING` sentence |
| Any other non-2xx | `query()` throws `"<status> …"` | `unexpected empty response (HTTP <status>)` |

This is documented as a **loss** relative to v2: v2 inspected
`res.headers.get("content-type")` *before* parsing; `query()` hides the
`Response`, so v3 matches error *shapes* instead. "A heuristic where v2 had a
header; if `query()` ever grows a way to surface the response, this should use
it."

### The two extra fetches, in `StatCards.tsx`

| URL | staleMs | pollMs | Parsed |
|---|---:|---:|---|
| `/api/em-tracker?ticker=<SYM>` | 600_000 | — | `{ rows: [{ em, ref_close, up, down }] }`, newest week first, `[0]` only |
| `/proxy/flow-history?underlying=<SYM>&limit=20000` | 25_000 | 30_000 | `{ tape: [{ premium, type, side }] }` |

EM: ten minutes of cache and **no poll** — "weekly data." `up`/`down` are prices;
`ref_close ± em` is the fallback "for a row imported before the bounds were
stored"; a non-positive result coerces to `null`.

Flow history: the URL is `null` off the socket symbol, "which is what stops the
request from firing at all rather than firing and being ignored." There is no
per-ticker tape anywhere in server-v2, so this one tile cannot follow the board's
symbol, and it says so rather than showing SPX's split under another heading.

---

## Every derived number

### The leg accessors — `values.ts`

The file's own header states the rule: **net is READ, the sides are RECOMPUTED.**
`netGEX` / `netVolGEX` come off the wire already summed and every other v3 surface
reads exactly those two fields, "so the net bar reads them too, because a GEX
Chart that recomputed its own net would be the one card able to disagree with the
rest of the board about where the core is." There is no `callVolGEX` on the wire,
so the split must be computed from the legs.

```ts
rowSpot(r, spot)      = r.spotPrice > 0 ? r.spotPrice : spot
contractsOf(oi,vol,b) = b === 'vol-only' ? vol : oi + vol

callGexOf(r, spot, b, flowActive) =
  flowActive ? r.flowCallGEX
             : |r.callGamma| · contractsOf(r.callOI, r.callVolume, b) · s²      // s = rowSpot

putGexOf(r, spot, b, flowActive) =
  flowActive ? r.flowPutGEX
             : −( |r.putGamma| · contractsOf(r.putOI, r.putVolume, b) · s² )

netGexOf(r, b, flowActive) =
  flowActive ? r.flowGEX
             : b === 'vol-only' ? r.netVolGEX
                                : r.netGEX + r.netVolGEX

dexOf(r, b) = b === 'vol-only' ? r.volNetDEX : r.netDEX + r.volNetDEX
```

Units: all GEX figures are **dollars of gamma per 1% move** (the server's own
denomination); DEX figures are **dollars of delta**.

**Why `rowSpot` uses the row's own `spotPrice`:** "the two agree to the last cent
because the recompute uses the row's OWN `spotPrice`, the spot the server priced
`netGEX` at, rather than the live spot that has moved since the frame arrived.
Pricing them at different spots is the whole way `call + put ≠ net` happens."

**Why `flowActive` is a parameter and not `basis === 'flow'`:** so the caller
resolves *once* whether the rows can support flow and every call site agrees.
Without it the leg accessors read `basis` as "vol-only, or not", so FLOW fell into
the OI+VOL branch — "the net bar drew flow while the CALL/PUT split drew open
interest, under a `CALL/PUT · FLOW` label."

⚠ **Sign convention differs by basis.** Off flow, `callGexOf` is positive by
construction and `putGexOf` negative by construction. **On flow both are signed
both ways** — dealer long positive, dealer short negative. `flowCallGEX` /
`flowPutGEX` are "NOT the 'call always +, put always −' pair `callGEX`/`putGEX`
are, so never abs() them into that shape" (`contract/frames.ts:89-98`).

### Support tests — all on the RAW rows

"Tested on the RAW rows, never on the densified ones: densify's gap fillers carry
no optional field at all, so a ladder tested after densifying would report 'no
flow' the moment it had a gap in it."

| Test | True when | Consequence of false |
|---|---|---|
| `flowSupported(rows)` | any `r.flowGEX != null` | FLOW button disabled; a stored FLOW falls back to net and the pane says so |
| `flowSplitSupported(rows)` | any `r.flowCallGEX != null \|\| r.flowPutGEX != null` | split refused on flow; net flow drawn with a line saying why |
| `sideLegsSupported(rows)` | any `r.callGamma !== 0 \|\| r.putGamma !== 0` | split refused on a server-summed ladder |
| `dexSupported(rows, basis)` | any `dexOf(r, basis) !== 0` | DEX overlay suppressed |

`flowSplitSupported` is tested **separately** from `flowSupported` "because the
two arrived at different times: `flowGEX` has always been on the wire,
`flowCallGEX`/`flowPutGEX` were added 2026-09. A server that has not been
redeployed sends the first and not the other two, and the honest answer there is
'flow has no split to show' — NOT a silent fall back to the OI+VOL legs, which is
the bug this whole change is fixing."

`dexSupported` exists because "a flat line pinned to the zero axis reads as
'delta is perfectly balanced' rather than 'there is no delta here'."

### Totals and ratios

```
totalNet(rows, basis, flowActive) = Σ netGexOf(r, basis, flowActive)      // $
totalDex(rows, basis)             = Σ dexOf(r, basis)                     // $
posGexPct(rows, basis, flowActive)= 100 · ( Σ max(v,0) / Σ |v| )          // %, null when Σ|v| = 0
```

`totalDex` is client-side **on purpose**: "the multi-expiry payload's
`totalNetGex` is a GAMMA total and there is no server-side delta total to borrow,
so summing the ladder being drawn is the only way the header number and the bars
stay in lockstep."

### The four levels — delegated, not computed here

```ts
levelBasisOf(basis)  = basis === 'vol-only' ? 'vol-only' : 'oi-vol'   // FLOW → 'oi-vol'
levelValueOf(basis)  = levelBasisOf(basis) === 'vol-only' ? volNet : oiVolNet
levelsOf(rows, spot, basis) = deriveLevels(rows, spot, { value: levelValueOf(basis) })
coreStrike(rows, basis)     = findCore(rows, levelValueOf(basis))?.strike ?? null
```

`data/levels.ts` definitions:

```
oiVolNet(r) = r.netGEX + r.netVolGEX
volNet(r)   = r.netVolGEX

findCore      : the strike with the largest |value(r)| on the WHOLE ladder
findCallWall  : largest POSITIVE value strictly ABOVE spot, core excluded
findPutWall   : most NEGATIVE value strictly BELOW spot, core excluded
flip          : profileFlip ?? (first neg→pos cumulative crossing, interpolated)
                            ?? crossing nearest spot ?? serverFlip ?? null
```

The flip interpolation, at the bracketing pair:

```
x = prevStrike + (strike − prevStrike) · ( −prevCum / (cum − prevCum) )
```

**This is a change of behaviour and the file says so.** These three used to be
pinned to VOLUME ONLY here, with their own finders, while Key Levels derived the
same three on OI+VOL — "so the GEX Chart could report CALL WALL 7,720 beside a
Key Levels axis marking 7,690 and neither number was wrong, they were answers to
different questions." Two consequences worth knowing:

* **On the OI+VOL tab the tiles are IDENTICAL to Key Levels by construction** —
  same finders, same rows, same spot, same core-exclusion rule.
* **The flip has a fallback chain now.** `flipOf`'s first-crossing walk returned
  null on any positive-gamma board — the running total never dips below zero —
  "which is why the tile spent most of a long-gamma day showing '—'." One rung is
  still out of reach: Key Levels on SPX prefers the Black-Scholes spot-sweep zero,
  which needs the chain's IVs and a 60-level re-price "that this card has no
  reason to run a second time. When that rung answers, the two can differ by a
  point or so."

**FLOW is never a level basis.** "A wall is a place the standing or traded book
has put gamma; the dealer's signed tape inventory is a different quantity that
happens to share a unit, and a 'CALL WALL' derived from it is not the level
anyone means by those words."

### Max pain — `levelsMath.computeMaxPain`

Pure open interest, no gamma. Needs ≥ 5 rows carrying OI or it returns `null`
("under five rows carrying OI the answer is noise").

```
for each candidate strike k:
  total(k) = Σ_r [ callOI(r)·(k − strike(r))  when k > strike(r) ]
           + Σ_r [ putOI(r) ·(strike(r) − k)  when k < strike(r) ]
answer = argmin_k total(k)
```

It "does not move with the basis switch."

### Bull/Bear — v2's calculation, transcribed

Premium-weighted, "rather than contract count so one big trade counts for what it
cost":

```
bull = Σ premium where (side === 'buy' && type !== 'P') || (side !== 'buy' && type === 'P')
bear = Σ premium otherwise
bullPct = round(100 · bull / (bull + bear))   // null when the total is 0
```

Displayed as `"{bullPct} / {100 − bullPct}"`.

### The delta row's numbers — `DeltaStatCards`

One pass over rows sorted ascending by strike ("sorted here anyway because the
ZERO CROSSING is the one figure that would be silently wrong on an unsorted
ladder rather than merely unordered"):

```
total  = Σ dexOf(r, basis)
long   = Σ dexOf where > 0
short  = Σ −dexOf where < 0        // printed as −short
peak   = argmax |dexOf(r, basis)|
zero   = the LOWEST strike at which sign(dexOf) changes  (first sign flip)
strikes= sorted.length
```

### Formatting

```ts
fmtGexShort(v):  ±$X.XXB / ±$X.XXM / ±$X.XXK / ±$X.XX
```

The minus is **U+2212**, "so a signed column does not jitter." `fmtPx(v, dp)`
returns the em dash `—` for `null`, non-finite or `v <= 0`. `strikeDp` derives
decimals from the ladder's own smallest step: `< 0.5 → 2`, `< 1 → 1`, else `0`;
with no step at all, `spot >= 1000 ? 0 : 2`.

---

## Every control

All five live in one `<CardToolbar>`, which **portals into the Card header** —
"a card gets one bar of controls and it is the header it already has"
(`design/primitives/Card.tsx`).

| Control | Widget | Values | Default | Effect |
|---|---|---|---|---|
| SERIES | `SegMenu` (folded to current value) | `gamma-0dte` · `gamma-ex0dte` · `delta-0dte` · `delta-ex0dte` | `gamma-0dte` | Which ladder the bars are |
| BASIS | `SegGroup` | `oi-vol` · `vol-only` · `flow` | `oi-vol` | Which contracts the bars are priced on |
| SPLIT | `SegGroup` | `net` · `call-put` | `net` | One net bar, or the two legs |
| DEX | `Chip` | on/off | `false` | Net-delta overlay line |
| CARDS | `Chip` | on/off | `true` | The stat row — all ten, or none |

### Storage

```ts
const CARD_ID = 'gex-chart'
const KEY_PREFIX = 'cb-v3-gexchart:'      // → localStorage key 'cb-v3-gexchart:gex-chart'
const SETTINGS_V = 1                      // "Bump when a stored field changes MEANING."
```

`v` rides along inside the JSON blob rather than in `GexChartSettings`: "it is a
storage concern and nothing that reads settings should know about it." Both read
and write are wrapped in `try/catch`; a failed write is best-effort — "the
in-memory settings still drive this session."

**One blob for the card TYPE, not per placed instance.** Two GEX Charts on one
board therefore share a basis. "That is the same choice GEX Candles made, and for
the same reason: the id a board item carries is a catalog id, and there is no
per-instance key to hang a second blob on without inventing one." (Note the
contrast with `gex-candles` and `top-flow`, which *are* threaded an `instanceId`.)

### What an old stored value coerces to

```ts
series:  isSeries(p.series) ? p.series : 'gamma-0dte'
basis:   isBasis(p.basis)   ? p.basis  : 'oi-vol'
split:   isSplit(p.split)   ? p.split  : 'net'
showDex: p.showDex === true                 // absent → false
cardsOn: p.cardsOn !== false                // absent → TRUE
```

* A blob written **before the series switch existed** has no `series`, "and was
  showing the live gamma ladder, which is what the default is."
* `cardsOn` uses `!== false`, not `=== true`, on purpose: "a blob written before
  the row had a switch at all should come back with the row ON, which is what it
  was showing."
* A stale `cards: Record<StatKey, boolean>` map alongside it is **simply
  dropped** — an unknown key in the blob is ignored, and re-saving writes it out.
  That map was ten individual per-tile switches behind a cog; it went because
  "the row shares its width evenly, so hiding one tile only made the other nine
  wider, and a stored subset meant no two boards showed the same row."
* Any parse failure at all → `{ ...DEFAULT_SETTINGS }`.

### When a control is disabled — and what is NOT rewritten

The repo's rule (`design/primitives/Controls.tsx`): "a control whose buttons come
and go is a control you cannot learn." So options are **dimmed with a `title`
saying why**, never hidden — and "a disabled option that is also the SELECTED one
stays highlighted and stays readable… a stored choice must not be silently
rewritten just because this ticker cannot serve it."

| Condition | What dims | Title shown |
|---|---|---|
| `!onSocket` | the three added series | `<label> is SPX-only — the board sweep and the delta legs exist for the symbol the socket streams, not for <SYM>` |
| `flowOff` (`view.rows.length > 0 && !flowSupported`) | FLOW | `No classified options tape for <SYM> — flow GEX only exists for the symbol the socket streams` |
| `barsAreDex` | SPLIT | `The call/put split is gamma only — netDEX is already net of both sides, and there is no per-side delta on the wire` |
| `wantMulti` | SPLIT | `The board sweep ships one net figure per strike — there are no call/put legs on it to split` |
| `barsAreDex` | DEX chip and FLOW option are not rendered at all | — |

`flowOff` is gated on `view.rows.length > 0` on purpose: "`flowSupported([])` is
false, and an empty ladder is the state this card is in for the first second of
every load — so testing without the length check would report 'no flow' before
any data existed, grey the button out on arrival, and un-grey it a beat later.
Until a ladder has actually arrived the answer is not 'no', it is 'not yet'."

Off the socket symbol the *stored* series is kept — "it comes back intact the
moment the board is back on SPX" — but the card draws `gamma-0dte`.

### Two header readouts (not controls)

* **The expiry / scope pill.** `scopeNote || '—'`. On the live ladder it is the
  socket's own `expiry`; on an ex-0DTE series it is
  `scopeNoteEx0dte(expiryCount)` = `` `${Math.max(0, expiryCount − 1)} expirations, 0DTE excluded` ``
  (the server "does not report an ex-0DTE count", so one is subtracted and
  floored). "Without this the chart is a ladder with no date on it."
* **`chain`**, shown only off the socket: "what the toolbar cannot otherwise say
  is that these bars are a polled chain rather than the live socket."
* **The total**, right-aligned: `fmtGexShort(total)` in `text-gexbar-pos` when
  `>= 0`, `text-gexbar-neg` otherwise, `text-muted opacity-50` when `null`.

---

## Rendering

### Canvas, not DOM

`mountGexChart(container)` creates one `<canvas>`, tagged
`canvas.dataset.cbLayer = 'gex-chart'` — AGENTS.md non-negotiable 6, "every
canvas v3 owns carries `data-cb-layer`… it is what makes a per-card redraw
number possible at all." The container gets `touchAction: 'none'` and
`cursor: 'crosshair'`, and `position: relative` if it was `static`.

Backed at `devicePixelRatio` every draw:

```ts
canvas.width  = Math.round(W * dpr);  canvas.style.width  = `${W}px`
canvas.height = Math.round(H * dpr);  canvas.style.height = `${H}px`
ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
```

`draw()` bails when `W < 10 || H < 10`.

### Layout constants — v2's, "transcribed, not reinvented"

| Constant | Value | Meaning |
|---|---:|---|
| `PAD_T` | 20 | top pad — the series line sits at `PAD_T − 8` |
| `PAD_B` | 6 | bottom pad |
| `PAD_L` / `PAD_R` | 16 / 16 | side pads |
| `MIN_COUNT` | 30 | never zoom in past this many strikes (v2's `MIN_COUNT`) |
| `TARGET_RANGE` | 200 | the opening window in price points (v2's `targetRange`) |
| `YSCALE_GUTTER` | `PAD_L + 18` = 34 | a drag starting left of this scales Y instead of panning |
| zoom factors | 1.16 out / 0.86 in | per wheel tick |
| y-scale factor | `1.003^dy` | clamped to `[0.1, 12]` |
| y headroom | `× 1.25` | "keeps the tallest bar at ~80% of the half-height so it never touches the frame" |
| bar width | `max(2, gap · 0.82)` | `gap = cW / data.length` |
| DEX scale | `0.6 ·(cH/2)` | its own normalised scale |
| gradient lift | `0.28 · min(|v|/netMax, 1)` | toward white |
| max densified rows | 4000 | "a malformed step against a wide chain must not spin here" |

Derived per draw:

```
cW = W − PAD_L − PAD_R
cH = H − PAD_T − PAD_B
yZero = PAD_T + cH/2
xAt(i) = PAD_L + (i + 0.5)·gap
maxG   = (netMax · 1.25) / yScale
yFor(v)= yZero − (v / maxG)·(cH/2)
```

**In the split, the scale is set by the taller of the two LEGS, not by their net**
— "otherwise a strike whose call and put nearly cancel would draw two bars off
the top of a pane scaled to a net of almost nothing."

### Fonts (canvas cannot use a class, so it reads the same scale)

| Element | Font |
|---|---|
| gridline labels, X strike labels | `bold 11px ui-monospace, monospace` |
| CB badge, hover readout | `bold 10px` |
| spot label, flip label, split/flow notices, series line | `bold 9px` |
| `+NET DEX` marker | `bold 8px` |
| the hint | `bold 8px` |

### Colours — tokens read at draw time

`readPalette(el)` reads eight custom properties via `getComputedStyle`. Canvas
cannot resolve `var()` or `color-mix()`, so `withAlpha(triple, a)` is the canvas
equivalent of `design/theme.ts`'s `alpha()` — "named `withAlpha`, not `rgba`, so
a call site reads as 'this token at 55%' and not as a hand-typed colour."

| Palette key | Token | Hex in `tokens.css` | Hard-coded fallback in `readPalette` |
|---|---|---|---|
| `pos` | `--color-gexbar-pos` | `#4d8cff` | `[41,182,246]` = `#29b6f6` |
| `neg` | `--color-gexbar-neg` | `#ffd166` | `[255,179,0]` = `#ffb300` |
| `fg` | `--color-fg` | `#e7ece9` | `[255,255,255]` |
| `line` | `--color-line` | `#1e2630` | `[35,39,46]` = `#23272e` |
| `dex` | `--color-dex` | `#6aa0ff` | `[31,141,173]` = `#1f8dad` |
| `core` | `--color-level-cb` | `#ffd166` | `[255,214,0]` = `#ffd600` |
| `surface` | `--color-surface` | `#0e1216` | `[15,17,23]` = `#0f1117` |
| `warn` | `--color-warn` | `#ffd166` | `[251,133,1]` = `#fb8501` |

Tokens used by the DOM half:

| Where | Token | Hex |
|---|---|---|
| header total, delta tiles | `--color-gexbar-pos` / `--color-gexbar-neg` | `#4d8cff` / `#ffd166` |
| Net GEX, +1σ, +GEX% ≥ 50, Bull ≥ 50 | `--color-up` | `#3ddc8e` |
| the negative half of those | `--color-down` | `#ff6b7a` |
| Call Wall | `--color-level-cw` | `#4d8cff` |
| Put Wall | `--color-level-pw` | `#ff5fa2` |
| Flip, Δ Zero | `--color-warn` | `#ffd166` |
| CB | `--color-level-cb` | `#ffd166` |
| Max Pain, Peak \|Δ\| | `--color-series-5` | `#7fb0ff` |
| a null value, Strikes, Scope | `--color-flat` (`MUTED`) | `#c0c5c3` |
| tile plate / border | `bg-raised` / `border-line` | `color-mix(#141a21 92%, #e7ece9)` / `#1e2630` |

`--color-gexbar-*` is deliberately a **second** positive/negative pair, separate
from the bubble pair: "v2 draws its bubbles blue/RED and its home-page GEX chart
bars blue/AMBER, and the chart is the one being matched value-for-value." The DEX
line is a **third** hue: "the line is not a bar and does not share the bars' sign
convention, so borrowing either gexbar colour would read as 'same series,
different shape'."

`gexChartRender.ts` carries exactly **one** grandfathered theme violation in
`theme-baseline.json` — the `rgba(...)` string inside `withAlpha`.

### Draw order

1. Clear, read palette, densify.
2. Resolve `barsAreDex` → `flowActive` → `flowMissing` → `dexActive` →
   `splitAsked` → `flowSplitOff` / `sideLegsOff` → `splitting` → `signedSplit`.
   "Resolved ONCE, from the raw rows, and passed down. A basis that half applies
   — flow in the bars, OI+VOL in the core badge — is the exact bug this single
   resolution exists to make impossible."
3. Viewport (`dynCount = max(MIN_COUNT, round(TARGET_RANGE/step) + 1)`), slice.
4. Zero line — `line @ 0.9`, `lineWidth 0.8`.
5. Horizontal gridlines at `niceStep(maxG)` — `line @ 0.55`, `lineWidth 0.5`.
   Labels right-aligned at `PAD_L + cW − 3`, drawn only when
   `PAD_T + 8 <= y <= PAD_T + cH − 24`: "the LINE may run to the frame edge; its
   LABEL may not."
6. `ctx.save()` + clip to the plot rect.
7. **Bars.** v2's gradient, value for value; the lit end lightens toward white by
   `0.28 · t`. Hovered bar: white top at `0.98`, base at `0.72`, plus a 12px
   shadow blur in the base colour.
8. **DEX line** (if `dexActive`), quadratic-smoothed, `lineWidth 2`, 10px glow,
   labelled `+NET DEX` at `PAD_L + 3`.
9. **Flip line** (if `model.flip != null && !barsAreDex && finite && > 0`) — one
   dashed vertical `[6,5]`, `warn @ 0.85`, `lineWidth 1.3`, label
   `FLIP 7,640` clamped to `[PAD_L + 40, PAD_L + cW − 40]`.
10. **Spot line** — dashed `[5,5]`, `fg @ 0.55`, label `SPX 7642.31` at
    `PAD_T + 10`, clamped to `[PAD_L + 34, PAD_L + cW − 34]`. Interpolated between
    the two strikes that bracket it.
11. `ctx.restore()`.
12. **CB badge** (gamma only) — a 15px-tall box, fill `core @ 0.12`, stroke and
    ink in the bar's sign colour at `0.95` / `0.98`, text
    `CB·OI+VOL 7,650`. Pinned to the **whole-ladder** core, "not just the visible
    window, so panning away from it hides the badge instead of quietly
    relabelling whatever is on screen."
13. **X labels**, inside the plot at `PAD_T + cH − 18`, at a nice step over the
    VISIBLE range.
14. **Series line**, top-left at `PAD_L + 2, PAD_T − 8`, `fg @ 0.55`:
    `NET GEX · OI+VOL · 2026-09-19` (or `CALL/PUT · FLOW`, etc.).
15. Any one of the three refusal notices, centred at `PAD_T + 24`.
16. **The hint**, bottom-right, `fg @ 0.22`.
17. **Hover readout** — a `surface`-filled box at `globalAlpha 0.95`, stroked in
    the sign colour at `0.6`.

### `densify()` — why the bars sit on an even grid

"A chain is not evenly spaced — SPX is 5 points near the money and wider out — and
drawing one bar per ROW would put the same pixel gap between strikes that are 5
apart and strikes that are 25 apart, which makes the ladder lie about where price
is relative to it."

1. Sort ascending, index by strike.
2. Detect the step from the **middle 60%** (`[0.2n, 0.8n)`) — "the ends are where
   the odd spacings live".
3. Take the **most common** gap in `(0, 25]`, not the smallest.
4. Snap to the nearest of `[0.5, 1, 2.5, 5, 10, 25]`; default `5`.
5. Fill from `first.strike` to `last.strike + step·0.5`, at most 4000 rows,
   looking up `byStrike.get(key)` then `byStrike.get(round(key))` then `blankRow`.

`blankRow` sets every required field to 0 and carries **no optional field at
all** — which is exactly why every support test runs on `model.rows`, not on the
densified array.

The densify cache key is `` `${rows.length}:${first.strike}:${last.strike}` ``.
A key change re-densifies **and** resets `vp.start = null; followSpot = true`:
"a new ladder invalidates a viewport measured against the old one — and any
framing the user had made of it, which was aimed at strikes that are not on this
chart."

### Interaction

| Gesture | Effect |
|---|---|
| wheel | zoom. `factor = deltaY > 0 ? 1.16 : 0.86`, clamped to `[MIN_COUNT, rows.length]` |
| drag (x > `YSCALE_GUTTER`) | pan; `shift = round(−dx / pxPerStrike)` |
| drag starting in the left gutter | y-scale; `yScale = startYScale · 1.003^(startY − clientY)`, clamped `[0.1, 12]` |
| double-click | recentre on ATM, `vp.count` back to `max(MIN_COUNT, round(TARGET_RANGE/step)+1)`, `followSpot = true`, `yScale = 1` |
| hover | readout for the bar under the pointer; the bar is highlighted |
| pointerleave | clears hover and redraws |

The wheel listener is attached **natively with `{ passive: false }`**: "React's
`onWheel` prop is passive, so `preventDefault()` there is ignored and the whole
page scrolls instead."

### `followSpot` — the fix, in full

`vp.start` used to be set once, on the first draw that had rows, and never again.

> "Two things went wrong with that. The first draw usually lands before the spot
> frame does, so the window was centred on a spot of 0, which clamps to the far
> left of the ladder and stays there; and even when spot did arrive first, price
> walks all day while the window it was centred on at 09:30 does not, so by the
> afternoon the spot line sat wherever it had wandered to."

So the window re-centres on spot on every draw while `followSpot` is true and
`model.spot > 0`. **A pan turns it off** — "dragging the ladder somewhere is a
statement about where you want to be looking, and having it snap back a second
later is the chart fighting you" — and only on an *actual* shift, "so a click that
happens to wobble a pixel does not silently unlock it." A double-click and a new
ladder turn it back on.

**Zoom deliberately does NOT turn it off.** While following, the fixed point of a
zoom is the centre, which is spot; anchoring on the cursor there "would walk the
window off spot a notch per wheel tick and quietly undo the follow without the
user ever panning." Once you have panned, the zoom becomes cursor-anchored:

```ts
frac   = clamp((clientX − rect.left) / rect.width, 0, 1)
anchor = vp.start + frac · vp.count
vp.start = clamp(round(anchor − frac · next), 0, rows.length − next)
```

The hint states which mode you are in, "because 'why did it stop following price'
and 'why did it snap back' are the same question asked from either side of one
silent flag":

```
spot centred · scroll=zoom · drag=pan          (followSpot === true)
scroll=zoom · drag=pan · dbl=recenter          (followSpot === false)
```

### The flow split's geometry

On flow **both legs are signed**, "so neither one has a fixed side of the zero
line to sit on. Two full-width bars drawn from zero would then hide one behind the
other whenever the signs agree, so the flow split draws them half-width, side by
side." Off flow the signs are opposite by construction and "the original stacked
geometry is kept exactly as it was."

```ts
if (signedSplit) { hw = max(1, barW/2); drawBar(x − hw/2, getCall(r), hl, hw)
                                        drawBar(x + hw/2, getPut(r),  hl, hw) }
else if (splitting) { drawBar(x,  |getCall(r)|, hl)
                      drawBar(x, −|getPut(r)| , hl) }
else                  drawBar(x,  getNet(r),    hl)
```

The hover readout mirrors it: on flow the legs print as they are, because
"abs()-ing them here would put a '+' in front of a dealer SHORT leg."

### Deliberately NOT ported from v2

* The OI area overlays.
* The BS flip curve. (Only the *number* is drawn, as one dashed line — "v2's
  chart derives its flip from a 401-point Black-Scholes spot sweep that needs
  per-strike IV; the multi-expiry ladder is slimmed to the net figures and
  carries none.")
* The 5/15/30 prior-state ghost layers.
* The MVC touch-tracking overlay.

"Each is a real feature with its own data dependency (a baselines history, a
401-point spot sweep, a session-scoped latch), not a toggle over rows this card
already has."

### Two deliberate deviations from v2

1. **X labels use a nice step derived from the VISIBLE strike range.** "v2
   hardcodes 'multiples of 50', which is right for SPX and puts zero labels on an
   AMZN chart whose whole range is 40 points wide. v3's chart follows the page
   ticker, so it cannot hardcode a strike grid."
2. **No opaque plot background.** "v2 fills `#05080d` because it sits in its own
   panel; here the chart is inside a v3 Card and painting a different dark over
   the card's surface reads as a hole cut in it."

---

## Phone / expanded / replay

### Phone — `GexChartCard simple`

`/v3/m/gex` mounts **this exact card** (`src/mobile/pages/MGex.tsx`), not a
phone-only copy: "the card already measures its own container, backs its canvas
at devicePixelRatio and reports visibility through ChartFrame, and a second
renderer for the same numbers is the thing that made v2's phone build drift from
its desktop within a week." `MobileShell` gets `fill` because "the chart owns its
drag gesture, so nothing on this screen scrolls."

`simple` (2026-09-03) overrides the *render-time* settings:

```ts
symbol  = SOCKET_SYMBOL          // pinned, not defaulted
basis   = stored.basis === 'flow' ? 'oi-vol' : stored.basis
series  = 'gamma-0dte'
split   = 'net'
showDex = false
cardsOn = false
```

Why each one goes, verbatim:

* **FLOW** "is a third basis whose answer is a different question, and the two
  that are left are the two anyone switches between."
* **C/P** "doubles the bar count in a plot ~380px wide. The split is a desktop
  read."
* **DEX** "is a second series on a second scale over that same plot."
* **CARDS** "is ten tiles sharing the width of a phone — three characters each,
  and the chart loses the height they take."

**The stored settings are NOT rewritten.** "The same browser profile opens this
card on a desktop and must find its basis, split, DEX and cards exactly as it left
them; this only changes what is DRAWN, the way `railOn` already does on the
candles card." A stored FLOW likewise "does not survive here — there is no third
button to show it on, and a selected value with no control is the thing the
card's own comment calls a control that lies."

The symbol is **pinned**, not defaulted: "SPX is the only symbol the socket
streams, and the phone screen is meant to be the live one rather than a 15s chain
poll."

### Expanded

Nothing card-specific. Every card in the app can be blown up to fill the page
area (`design/primitives/Expand.tsx`), one at a time, Escape to collapse. The
chart re-measures through `ChartFrame`'s debounced `ResizeObserver`
(`debounceMs = 80`) and `onResize` calls `handle.redraw()`.

### Replay

**None.** This card has no replay dock, no date parameter and no rewind. The only
occurrence of the word in its source is a comment about replaying the last model
into a freshly-mounted canvas:

```ts
// Replay whatever arrived before the frame mounted, so the first paint is
// never an empty chart that fills in a beat later.
created.setModel(modelRef.current)
```

(The `date` parameter on `/api/daily-em` exists for replay — but that module is
GEX Candles', not this card's. See `src/board/gexChart/dailyEm.ts`, which is a
tombstone.)

---

## Status and empty-state messages, verbatim

### The four overlay lines (DOM, absolutely positioned over the canvas)

They are mutually exclusive, in this precedence. "The sweep's error wins over
'loading' — a failed request that goes on saying 'sweeping the board' is the state
worth naming out loud."

| # | Text | When | Class |
|---|---|---|---|
| 1 | `Board sweep failed — {multi.err}` | `multi.err && wantMulti` | `text-2xs text-down opacity-80`, truncated |
| 2 | `Net delta is zero at every strike — server-v2 predates the netDEX legs on this endpoint` | `wantMulti && barsAreDex && multiDeltaAllZero(multi.ladder)` | same |
| 3a | `Sweeping the board…` | `total == null && wantMulti` | `text-2xs text-muted opacity-50` |
| 3b | `Waiting for the feed…` | `total == null && onSocket` | same |
| 3c | `Loading {symbol}'s chain…` | `total == null` otherwise | same |

`total == null` exactly when `view.rows.length === 0`.

`multi.err` itself is one of:

* `endpoint /proxy/gex-by-strike-multi not found — server-v2 needs a restart/redeploy to pick up the route`
* `unexpected empty response (HTTP <status>)`
* `HTTP 200`
* whatever string the body's `error` field carried

### The three canvas refusal notices

All centred at `W/2, PAD_T + 24`, `fg @ 0.45`, `bold 9px ui-monospace`:

| Text | When |
|---|---|
| `No classified flow for this symbol — showing OI+VOL` | basis is `flow`, bars are gamma, and `flowSupported(rows)` is false |
| `Flow carries no call/put split on this feed — showing net flow` | flow is active, split asked, and `flowSplitSupported(rows)` is false |
| `This ladder is summed per strike — no call/put legs to split` | split asked off flow, and `sideLegsSupported(rows)` is false |

Every one of these is "said out loud rather than drawn as a silent fallback: the
bars in front of you are OI+VOL, and a user who is not told that will read them as
a flow book." Falling back to the OI+VOL legs under a FLOW label "is exactly the
bug this note replaced."

A **delta ladder never shows the flow notice**: "a delta ladder has no tape leg to
draw, so FLOW there is not 'missing' — it does not apply. Saying 'no classified
flow' over delta bars would be answering a question nobody asked."

### Em dashes

* Expiry pill with no source answer: `—`
* Header total with `total == null`: `—`
* Any level tile with a null price: `—` (from `fmtPx`)
* `DeltaStatCards` uses a single explicit `EM_DASH = '—'` (U+2014) constant —
  "one spelling, so a missing figure looks the same in both rows."

---

## Performance notes

### The React/canvas split

"The rows themselves never go through state — they are a ref the renderer reads.
But the ten tiles are React, and they need the ladder." So the card keeps exactly
one piece of state for them (`view`), set from the same `push()` the chart is fed
from.

That is a re-render **per ladder**, which is once every few seconds. If a spot
tick refreshed the tiles, "ten strike-comparisons × ten tiles would run sixty
times for every one time the numbers actually changed."

### `TILE_SPOT_MS = 1000` — the "not updating" fix

The block that documents this calls out its own previous claim as wrong:

> "MOSTLY, not entirely — and that word is a fix, not a hedge. The claim this
> block used to make was that a gex frame is 'the only cadence at which a wall can
> actually move', and it is not: BOTH walls are defined strictly above and
> strictly below SPOT, so price crossing a strike relocates one of them with no
> new ladder involved at all. server-v2 dedupes the `gex` frame — an unchanged
> chain broadcasts nothing — so on a quiet ladder the tiles could sit for minutes
> with a call wall that price had already traded through, which is the 'not
> updating' this card was reported for."

So a spot tick *does* sync the tiles, at most once a second: "one re-render a
second against sixty, and it is bounded by wall clock rather than by how chatty
the feed happens to be."

### The visibility gate

```ts
const paint = useCallback(() => {
  const handle = handleRef.current
  if (!handle) return
  if (!visibleRef.current) { missedRef.current = true; return }
  missedRef.current = false
  handle.setModel(modelRef.current)
}, [])
```

"`spot` is a 10Hz topic and every tick re-pushes the ladder, so an unguarded copy
of this card repaints its canvas ten times a second for as long as it is on the
board — including while it is scrolled a thousand pixels below the fold. The model
is kept up to date either way (it is a ref assignment); only the PAINT is
deferred, and only the last one is owed, because `setModel` redraws the whole
chart from the current model."

`onResize` is gated the same way. `onVisibility(true)` replays the owed paint.

Note the one deliberate exception: `setView` is **ungated** — "the tiles must be
right the instant the card is scrolled back into view, and React bails out on an
unchanged value anyway."

`ChartFrame`'s `IntersectionObserver` uses `rootMargin: '200px'` and starts
optimistic (`onScreen = true`) because "the observer's first callback is
asynchronous, and a first paint that is thrown away costs far less than a card
that renders blank for a frame on every single mount." It also folds in the tab's
own `document.hidden`.

Budgets (`budgets.json`, enforced by `scripts/perf-check.mjs`):
`idleRepaintsPerFrame` 0.15, `offscreenRepaints` **0** (a hard zero),
`interactionRepaints` 10.

### Reference stability

* `EMPTY_ROWS` is **one** module-level array. "`view` bails out of a re-render by
  reference-comparing its rows, and a new `[]` on every empty push would defeat
  that on exactly the path where it matters most — a symbol with no data yet,
  being polled."
* `multiRows` is memoised on `multi.ladder`, **not** on `multi` — "a poll that
  returns an unchanged body still produces a new state object, and `push` bails
  out of a re-render by reference-comparing the rows it is handed."
* `drawOpts` is one memoised object "so `push` takes a stable dependency rather
  than three", mirrored into `drawOptsRef` so the socket watchers can read it
  without re-subscribing.
* `push` compares `prev.rows === safe && prev.spot === spot && prev.expiry === expiry`
  before calling `setView`.

### Lazy loading

The card is `lazy()`-imported. "Static imports would put all of them in the
board's route chunk and every user would pay for the cards they do not have on
their board."

### `useQuery` dedupe

`KeyLevelsCard` and `ChainTitle` both read `chainGexUrl(symbol)` — "`useQuery`
dedupes to ONE request." The same is true if a GEX Chart and a Key Levels card are
on one board with the same non-SPX symbol.

---

## Gotchas

1. **`netGEX` alone is NOT the OI+VOL number.** It is the OI leg; `netVolGEX` is
   the volume leg; OI+VOL is their SUM. `chainGex.ts` calls this "the single
   easiest thing to get wrong about this shape."

2. **Two GEX Charts on one board share one settings blob.** `CARD_ID` is the
   catalog id, not the instance id. Change the basis on one and the other follows
   on its next render.

3. **`staleMs` is not a refresh interval.** It is a cache TTL. A card that mounts
   once with `staleMs: 25_000` and no `pollMs` "will sit on its first response
   forever." That distinction "cost real confusion."

4. **FLOW does not move the level tiles.** On the FLOW tab the bars draw the
   dealer's signed tape inventory while Call Wall / Put Wall / Flip / CB stay on
   OI+VOL. The CB badge's tag says `CB·OI+VOL`, and the badge basis and the bar
   basis are "deliberately allowed to differ (only on the FLOW tab, where they
   must)."

5. **The ex-0DTE ladder is SPX-only and disabled, not hidden, elsewhere.** So are
   both delta series. Off SPX the stored choice is retained but the card draws
   `gamma-0dte`.

6. **The ex-0DTE sweep is never cleared on the way out.** "Coming back to the
   series should show the last good book under the refreshing state rather than
   an empty pane, and a stale minute on a standing book is not a stale minute on
   a tick." So a `multi.err` from an hour ago can still be showing under a stale
   ladder.

7. **`expiryCount` includes 0DTE.** `scopeNoteEx0dte` subtracts one and floors at
   zero, because "the server does not report an ex-0DTE count."

8. **A delta ex-0DTE ladder can be a convincing flat line.** A server-v2 predating
   the `slimRows` delta change ships `netDEX`/`volNetDEX` as 0 at every strike.
   `multiDeltaAllZero` catches it and the card says so. "A convincing flat line is
   the failure mode worth naming."

9. **Flow legs are signed on BOTH sides.** Never `abs()` `flowCallGEX` /
   `flowPutGEX` into the `callGEX`-positive / `putGEX`-negative shape.

10. **`flowSplitSupported` is a separate test from `flowSupported`.** A server
    that shipped `flowGEX` but not the 2026-09 legs passes the first and fails the
    second, and the honest answer is "flow has no split to show."

11. **Support tests run on `model.rows`, never on the densified array.**
    `blankRow` carries no optional field at all, "so a ladder with one gap would
    report 'no legs' for the whole board."

12. **The CB badge tracks the WHOLE ladder, not the visible window.** Pan away
    from the core and the badge disappears rather than relabelling whatever is on
    screen.

13. **The wheel listener must stay native with `{ passive: false }`.** Moving it to
    React's `onWheel` makes `preventDefault()` a no-op and the page scrolls.

14. **Do not anchor the zoom on the cursor while `followSpot` is true.** That was
    tried; it "would walk the window off spot a notch per wheel tick and quietly
    undo the follow without the user ever panning."

15. **`src/board/gexChart/dailyEm.ts` is empty and safe to delete.** The module
    was rehoused at `src/data/dailyEm.ts` (an API reader belongs there per
    AGENTS.md) because "±EM is a PRICE level for the session, and the candles card
    is the one with a price axis to hang it on. The GEX Chart's x axis is
    strikes." Nothing imports the old path.

16. **±1σ on this card is the WEEKLY band** (`/api/em-tracker`), not the daily one
    (`/api/daily-em`). "Two different questions, two different numbers."

17. **Bull/Bear does not follow the board ticker.** There is no per-ticker tape in
    server-v2; off SPX the tile shows `—` and its tooltip says why.

18. **Max Pain does not move with the basis switch.** It is pure open interest.
    Fewer than five rows carrying OI and it is `null`.

19. **`readPalette`'s hex fallbacks are v2's values, not v3's tokens.** If
    `getComputedStyle` comes back empty (jsdom, a test renderer, the first tick
    before styles apply) the bars draw `#29b6f6` / `#ffb300` rather than
    `#4d8cff` / `#ffd166`.

20. **`readPalette` runs inside `draw()`, per frame.** `design/theme.ts` says
    "call them at MOUNT, not per frame… a chart resolving its palette inside its
    draw loop is doing layout work sixty times a second for a value that never
    changes." This renderer does not use the cached `tokenHex`/`tokenRgb` family
    and reads `getComputedStyle` on every draw.

21. **Don't remove `data-cb-layer`.** `scripts/perf-check.mjs` measures only the
    canvases that carry it; without it this card's repaint count vanishes from the
    perf budget rather than passing it.

22. **`data-capture-meta`** carries `symbol · SERIES_LABEL · scopeNote · BASIS_LABEL`
    because "the shot drops this card's header, and those two are the whole
    difference between one ladder and another that looks identical."

23. **The DEX line has no gridlines, on purpose.** It is normalised to its own
    max at 60% of the half-height, "because delta exposure is orders of magnitude
    away from gamma exposure in dollars." It answers "which way is delta leaning,
    and where does it turn" — not "how many dollars."

24. **`netOf(r)` in `gexChartRender.ts` is a legacy export.** It hard-codes
    OI+VOL. "New code should call `values.ts`'s `netGexOf(row, basis, flowActive)`
    so it follows the basis switch."

25. **The per-tile cog is gone and should not come back.** Ten switches to hide
    tiles that share the row evenly "is a setting nobody was reaching for, and a
    stored subset made the row a different shape on every board."
