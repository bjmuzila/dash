# Net Premium — board card reference

| | |
|---|---|
| **Catalog id** | `net-premium` |
| **Label** | `Net Premium` |
| **Icon** | 💵 |
| **Default grid size** | `{ w: 24, h: 48 }` — half the board's 48 columns, 48 rows of `BOARD_ROW_H` (8px) |
| **Source folder** | `src/board/netPremium/` |
| **Loaded** | `lazy()` from `src/board/catalog.tsx`; Suspense fallback is `<div className="min-h-0 flex-1" />` — a blank fill, never a spinner |
| **Instance-aware** | No. `render: () => <NetPremiumCard />` — the catalog does not thread `instanceId` through, so two copies of this card are identical twins sharing one browser-level span preference |

---

## What it is, in one paragraph

Net Premium is the `/flow` page's Net Drift chart, shrunk into a board tile. It draws cumulative
net CALL premium against cumulative net PUT premium for the board's current ticker, one point per
minute, across a fixed session grid; underneath the lines it docks the minute's contract volume as
a histogram tinted by which side led that minute; and behind everything it draws the underlying's
own price path as a thin washed-out overlay on a hidden price scale, so the positioning and the
tape it happened against can be read together. It is narrower than the page version in two
deliberate ways — it is always the **closest expiration** and always **OTM only, both sides** —
because a board card is a glance and a drift line that sums every expiry on the board answers a
question nobody asked it, while ITM premium is mostly intrinsic value changing hands and swamps
the line it is drawn next to. The one control is an RTH/ETH span toggle. The chart component and
the server aggregate are shared with the page (`pages/flow/NetDriftChart.tsx`,
`/proxy/flow-netprem`), so the card and the page can never disagree about what a minute's net
premium was.

---

## File map

Real line counts, `wc -l`, from `voltick-v3/`:

| File | Lines | What it owns |
|---|---:|---|
| `src/board/netPremium/NetPremiumCard.tsx` | 321 | The card itself: ticker resolution, the RTH/ETH toggle and its storage, the closest-expiration pick, the `FlowFilters` it hands down, the legend row, the staleness read, every status string, and the `data-capture-meta` caption. |
| `src/pages/flow/NetDriftChart.tsx` | 417 | The actual renderer. Dynamic `import('lightweight-charts')`, four series (call line, put line, volume histogram, spot overlay), the axis pin, the crosshair tooltip and its imperative positioning. Shared with `/flow`. |
| `src/data/flowData.ts` | 618 | The REST hooks. `useFlowHistory` (two-stage backfill + 45s merge poll), `useNetPremBins` (sessionStorage warm start + incremental `?since`), `useTick` (the slow clock). Also `useCombinedHistory`, `usePremSplit`, `useContractStats`, `useLiveSpots`, `useMinuteBars`, which this card does **not** use. |
| `src/data/flowMath.ts` | 703 | Every constant, threshold, formatter and pure transform. `buildNetSeries`, `buildSpotSeries`, `mergeTape`, `normTicker`, `todayYmdET`, the ET session maths, `fmtPremium` / `fmtSpot` / `fmtAgo` / `fmtEtHm`. Transcribed 1:1 from v2's `components/pages/Flow.tsx`; the spec of record is `docs/parity/flow.md`. |
| `src/data/symbol.tsx` | 111 | The page symbol — the one ticker the whole board follows. `PageSymbolProvider`, `usePageSymbol`, `PAGE_TICKER_RE`, `SOCKET_SYMBOL`, and the `ticker_events` analytics beacon. |
| `src/board/chart-render.ts` | 301 | **Not used by this card.** The board's minimal imperative canvas kit — `useCanvasRenderer`, `sizeCanvas`, `drawCandles`, `drawDivergingBars`, `drawLines`. Net Premium renders through lightweight-charts instead. It is listed because it is the *other* way a board card can paint, and the rules it enforces (visibility gating, `data-cb-layer`, colours read from CSS custom properties at draw time) are the ones `NetDriftChart` follows by hand. |
| `src/design/primitives/ChartFrame.tsx` | 211 | The container every chart mounts into. Measures, debounces resize (80ms), tracks visibility (IntersectionObserver, `rootMargin: '200px'`, plus tab visibility), publishes `data-visible="1"|"0"`. |
| `src/design/theme.ts` | 471 | `NET_DRIFT_CALL` / `NET_DRIFT_PUT`, `tokenHex()`, `tokenHexAlpha()`, `alpha()`, `T.*`. The only sanctioned way to get a token as a JS string or a resolved canvas colour. |
| `src/board/cardTitle.tsx` | 50 | `fmtContractDate('2026-08-31') → '8-31-26'`, used in the toolbar and the capture caption. |
| `src/design/tokens.css` | 716 | Every colour. No hex may appear in `src/` outside this file (non-negotiable 1). |

---

## The ticker

The card follows the **board page symbol** — `usePageSymbol()` from `src/data/symbol.tsx`, stored
per browser under `cb-v3-page-symbol`, default `SPX`, validated against
`PAGE_TICKER_RE = /^[A-Z][A-Z.]{0,5}$/` on both read and write. The symbol is normalised through
`normTicker()` before anything else:

```
ROOT_TO_TICKER = { SPXW: 'SPX', NDXP: 'NDX', RUTW: 'RUT', XSPW: 'XSP' }
normTicker(u) = ROOT_TO_TICKER[u.toUpperCase()] ?? u.toUpperCase()
```

Streamer roots carry suffixes a chip does not — SPX streams as `SPXW` — so the same normalisation
is applied to every print's `underlying` before it is compared against `active`.

Unlike the Flow Tape's socket leg, Net Premium is **not SPX-only**: flow is recorded per ticker
(`/proxy/flow-history?underlying=…`, `/proxy/flow-netprem?underlying=…`), so the whole card works
for AMZN or TSLA. What is SPX-only is the *live* socket merge — see below. A ticker the recorder
has never seen gets an honest "not available" rather than an empty grid that would read as a quiet
day.

---

## The data path

### 1. `/proxy/flow-history` — the raw tape (`useFlowHistory`)

The card calls:

```ts
useFlowHistory(active, date, CHART_MIN_PREMIUM, /* enabled */ true)
```

`date` is `todayYmdET()` — the card is hardwired to today; there is no date picker, and every
downstream call is made with `isToday = true`.

**Query.** The shared base is built by `qs({ underlying, date, minPremium })`, with `minPremium`
omitted when it is not `> 0`:

```
/proxy/flow-history?underlying=SPX&date=2026-09-20&minPremium=1000&limit=1000
/proxy/flow-history?underlying=SPX&date=2026-09-20&minPremium=1000&limit=20000
```

`credentials: 'same-origin'` on every request.

**Why the floor is 1 000 and not the tape's slider.** `CHART_MIN_PREMIUM = 1_000` is the chart's
own noise floor, deliberately decoupled from the `/flow` page's Min Premium slider
(`DEFAULT_MIN_PREMIUM = 15_000`, ceiling `PREMIUM_MAX = 1_000_000`). The drift line tracks full
directional positioning — the whole hundreds-of-millions of OTM flow in a day — so cranking a
whale slider must not flatline it. This card has no slider at all, and passes 1 000 flat.

`minPremium` is pushed into SQL so the server's 20 000-row cap keeps the **biggest** prints across
the whole session rather than the most recent slice.

**Two-stage.** `limit=1000` newest-first paints immediately; `limit=20000` lands behind it and
*replaces* the slice. A `full` flag guards the ordering: if the big pull wins the race, the small
one is stale and is discarded rather than allowed to clobber it.

**Timing.**

| | |
|---|---|
| First run after mount | `setTimeout(run, 0)` — immediate. The 400ms debounce exists for slider drags and paying it on mount just delays first paint. |
| Every later run (ticker / date / floor change) | `setTimeout(run, 400)` |
| Refresh poll | `setInterval(refresh, HISTORY_POLL_MS)`, `HISTORY_POLL_MS = 45_000` |
| Refresh while `document.visibilityState === 'hidden'` | skipped entirely |

**Why it polls at all.** This used to fetch exactly once per (ticker, date, floor) and then rely
entirely on the socket's `flow` frame. That is fine right up until the socket goes quiet — and
then the tape freezes at the moment the page opened with nothing on screen saying so. A market
that has genuinely stopped printing and a feed that has stopped arriving look identical, which is
the worst property a live panel can have.

**The refresh merge.** The poll re-asks only for `limit=1000` and merges into what is held, keyed
on `printIdentity(o) = ${o.ts}|${o.symbol}|${o.side}` — the same identity `flow_prints` uses as
its PRIMARY KEY — with the **persisted** version winning (it is the coalesced one), then sorted
ascending by `ts`. A failed refresh keeps what is on screen; one bad poll must not blank a tape.

**Response shape.**

```ts
interface FlowHistoryResponse { date: string; tape: FlowTapePrint[] }
```

`FlowTapePrint` (from `src/contract/frames.ts`, transcribed field-for-field from
`server-v2/computation/flow-processor.js`):

```ts
{
  ts: number            // order start = its FIRST fill, EXCHANGE epoch ms
  symbol: string        // dxFeed streamer symbol, ".SPXW260731P6300"
  underlying: string    // display root post-displayUnderlying() — "SPXW", not "SPX"
  expiration: string    // YYYY-MM-DD
  strike: number
  type: 'C' | 'P'       // NOT 'call'/'put'
  side: 'buy' | 'sell'  // mid/unknown forced to 'buy'
  action: string        // BUY CALL | SELL CALL | BUY PUT | SELL PUT | FLOW
  bucket: string        // 'bull' | 'bear' | 'neutral'
  price: number         // size-weighted average fill across coalesced prints
  size: number
  premium: number
  isOtm: boolean | null // ⚠ TRI-STATE
  fills?: number        // sweep counter; 1 when unmerged
  spot?: number         // underlying at print time; absent when spot was 0
  iv?: number; oi?: number; volume?: number
  anchorTs?: number; lastFillAt?: number   // server bookkeeping, do not read as print times
}
```

> ⚠ **`isOtm` is tri-state, not a boolean.** `flow-processor.js` writes `null` — never `false` —
> when the underlying spot is unknown, because `false` is a *claim* ("this print was in the
> money") and there is nothing to make it from. On **2026-08-14** a stuck spot wrote
> `is_otm=false` for a whole midday SPX session and an OTM-only filter deleted the day. A `null`
> is correctly excluded by an OTM filter (`!o.isOtm` rejects it) but must stay distinguishable
> from a real ITM print.

**HTTP-200-on-failure behaviour.** `useFlowHistory` does `r.ok ? r.json() : null` and then tests
`j && Array.isArray(j.tape)`. So:

- a non-2xx sets `error = true` and leaves the held tape alone;
- a 200 whose body is not `{ tape: [...] }` — an HTML error page, a proxy's JSON `{error: …}`,
  a truncated body — *also* sets `error = true` rather than replacing the tape with nothing.
  This is the guard that matters: a proxy in front of this stack can and does answer 200 with a
  body the client cannot use.

**`switching` is seeded from `enabled`, not `false`.** The effect only sets it a tick later, so a
`false` seed made the very first render say "loaded, and empty" — the one frame in which this
card's "not available" empty state would flash on every mount.

### 2. The socket `flow` frame

```ts
const flowFrame = useFrame<FlowFrame>('flow')
const liveTape = flowFrame?.data.tape ?? []
const merged  = mergeTape(history, liveTape, /* isToday */ true)
const own     = merged.filter((o) => normTicker(o.underlying) === active)
```

`useFrame` is from `src/data/hooks.ts` — the only sanctioned way component code touches live data
(non-negotiable 2: pages never touch the socket). It re-renders on **every** message of that type.

The socket streams exactly **one** underlying: `SOCKET_SYMBOL = 'SPX'`. For any other board
symbol the `normTicker(o.underlying) === active` gate drops every live print and the card runs off
the REST tape alone, refreshed every 45s. This is not a degradation the card announces, because
the REST path is the real source for those tickers anyway.

`mergeTape(history, live, isToday)` — persisted ∪ live, deduped by `printIdentity`, **live
winning**, ascending by `ts`. Live is only merged when `isToday`; on a historical date the socket
is still pushing the current session and must not bleed into it. This card always passes `true`.

The `flow` frame's envelope is `{ type, symbol, ts, data }` (`msg()` in
`server-v2/websocket-server.js`); `data` is `FlowData` and carries `tape`, `netPremium`, `buyPct`,
`prints`, the four vol legs, `windowMs` and `asOf`. This card reads **only** `data.tape`.

### 3. `/proxy/flow-netprem` — the per-minute aggregate (`useNetPremBins`)

This is the chart's real data source. `useFlowHistory`'s raw tape only exists here to answer two
questions the aggregate cannot: *which expirations does this ticker have* (so the closest one can
be picked), and *what actually printed in the minute under the cursor* (the hover list).

**The one place a waterfall is unavoidable.** Non-negotiable 3 says a route fires everything in
parallel at entry. This card cannot: "the closest expiration" is not knowable until something has
said which expirations this ticker *has*. The tape is that something, and the card needs it anyway,
so it is one hop, not a waterfall of convenience. `useNetPremBins` is passed
`enabled = expiry != null`, so the bins request stays disabled until the expiry is known rather
than firing an unscoped one that would have to be thrown away.

**Query.** Built by `qs()` into a stable `key`, which doubles as the cache key:

```
/proxy/flow-netprem?underlying=SPX&bin=60&date=2026-09-20&minPremium=1000&expiry=2026-09-20&otmOnly=1
```

with `&since=<utcSec>` appended on every poll after the first for a key that already has bins.

`filterParams(f)` is the shared filter half used by both `/proxy/flow-netprem` and
`/proxy/flow-premsplit`, so the chart, the split and the tape cannot drift apart about what a
filter means (the server has one `buildFlowPrintsWhere()` for the same reason). It emits only
non-default values:

| Filter field | Param | Emitted when |
|---|---|---|
| `side` | `side` | `!== 'all'` |
| `optType` | `type` | `!== 'all'` |
| `expiry` | `expiry` | `!== 'all'` |
| `dteMin` | `dteMin` | `> 0` |
| `dteMax` | `dteMax` | not null |
| `otmOnly` | `otmOnly=1` | truthy |

The card's `FlowFilters` are fixed except for `expiry`:

```ts
{ side: 'all', optType: 'all', minPremium: 0, minSize: 0,
  expiry: expiry ?? 'all', dteMin: 0, dteMax: null, otmOnly: true }
```

so only `expiry` and `otmOnly=1` ever appear. `minPremium` in the URL is **not** the filter
object's `minPremium` (0) — it is `CHART_MIN_PREMIUM` written into the key directly.

**Cadence.** `load()` fires immediately on every key change, then `setInterval(load, 5000)` while
`isToday` (always true here). There is no visibility guard on this one — the interval runs while
the tab is hidden.

**Response shape.**

```ts
interface NetPremResponse { date: string; binSec: number; partial: boolean; bins: NetBin[] }

interface NetBin {
  sec: number      // UTC seconds, bin start, always a multiple of BIN_SEC
  callNet: number  // dollars of net call premium in this minute (signed)
  putNet: number   // dollars of net put premium in this minute (signed)
  callVol: number  // contracts
  putVol: number   // contracts
  spot?: number    // mean of `spot` over the bin's prints; absent when none carried one
}
```

`binSec` and `partial` are on the wire and are **not read** by this card.

**The warm start.** `sessionStorage` key `cb-v3-flow-netbins`, value `JSON.stringify({ key, bins })`
where `key` is the *exact* filter querystring. A revisit paints instantly from stale bins while
the fetch refreshes behind it. Stale-by-hours is fine: the first poll pulls everything from the
cached edge forward. Keyed on the querystring so a different ticker, date or filter can never show
the wrong session. A quota failure on write is swallowed — a lost warm start costs one paint, not
correctness.

**The incremental poll.** Once a key has bins:

```
since = min(last.sec - 2 * BIN_SEC, nowSec - NET_LATE_SEC)
      = min(last.sec - 120, nowSec - 900)
```

and the merge is `[...prev.filter(b => b.sec < since), ...j.bins]`.

`NET_LATE_SEC = 15 * 60 = 900` mirrors `NETPREM_LATE_MS` in
`server-v2/server-with-proxy.js`. The server re-scans that window for prints that arrived late (a
replayed batch carries older EXCHANGE timestamps) and then filters its response to `sec >= since`
— so the client's overlap has to be at least as wide, or it throws away exactly the bins the
server just went and fetched. **Keep the two in step.**

**HTTP-200-on-failure behaviour.** Same shape as the history hook: `r.ok ? r.json() : null`, then
`j && Array.isArray(j.bins)`. Anything else sets `error = true` and leaves `bins` untouched. The
header comment on the `error` state is explicit about why it exists:

> A poll that comes back wrong used to be swallowed whole: the chart kept the bins it had and
> drew a flat line to the horizon, which is EXACTLY what a quiet market looks like. A dead
> endpoint must not be indistinguishable from no prints.

### Endpoint summary

| Endpoint | Cadence | Stale window | Hidden tab | Failure |
|---|---|---|---|---|
| `/proxy/flow-history` `limit=1000` | 45 000 ms | none (raw `fetch`) | skipped | `error = true`, tape held |
| `/proxy/flow-history` `limit=20000` | once per (ticker, date, floor) | none | n/a | `error = true`, tape held |
| `/proxy/flow-netprem` | 5 000 ms | `sessionStorage` warm start, unbounded age | **runs anyway** | `error = true`, bins held |
| socket `flow` | push | n/a | n/a | frame stops; the age line is what says so |

Neither flow hook goes through `src/data/api.ts`'s `useQuery`, so neither participates in the
toolbar's `refreshAll()` broadcast — pressing ↻ does not force this card to refetch.

---

## Every derived number

### The closest expiration

```ts
const set = new Set(own.map(o => o.expiration).filter(Boolean))
const opts = [...set].sort()                       // ISO dates sort lexically = chronologically
expiry = opts.find(x => x >= date) ?? opts.at(-1) ?? null
```

Today's if this ticker printed one, else the soonest future one, else — for a tape entirely in the
past — the last one there is. Same rule as the `/flow` page's 0DTE button. Rendered in the toolbar
as `fmtContractDate(expiry)`, i.e. `2026-09-20` → `9-20-26`.

### Cumulative net drift — `buildNetSeries(bins, { isToday, date, chartSpan })`

**The grid.** Fixed `BIN_SEC = 60` second bins across `[openSec, closeSec]`, giving a proportional
axis that spans the whole session *before* the data fills it. Letting the chart fit its content
instead would re-scale the axis on every poll and float the day's shape to the right.

**RTH bounds** (`chartSpan === 'rth'`, the default) — the classic hardcoded grid:

```
openSec  = etWallToUtcSec(y, m, d, 9, 30)
closeSec = etWallToUtcSec(y, m, d, 16, 0)
```

`etWallToUtcSec` corrects a UTC guess against the ET offset rather than assuming one, which is
what makes it survive both DST transitions without a table.

**ETH / 24H bounds** (`chartSpan === '24h'`) — widened to the extent of the bins the server
actually returned, clamped to the ET calendar day, then snapped to the bin grid:

```
day = etDayBoundsForYmd(ymd)                  // 00:00 → 24:00 ET, as UTC seconds
lo  = min(rth.openSec,  every b.sec >= day.startSec)
hi  = max(rth.closeSec, every b.sec <= day.endSec)
openSec  = floor(lo / 60) * 60
closeSec = ceil (hi / 60) * 60
```

The clamp is why one mis-stamped `ts` cannot stretch the axis across a week. The snap is
load-bearing: the walk steps by `BIN_SEC` from `openSec`, and an unaligned start would miss every
bin by a constant offset. RTH always stays inside the window, so the familiar 9:30–4:00 shape is
still there.

**The cumulative walk.** Units are **dollars of premium**, running total from `openSec`:

```
for t = openSec .. closeSec step 60:
    b = byBin.get(t)
    if b: call += b.callNet ; put += b.putNet
    if b or t <= horizon:
        callPts.push({ time: t, value: call })
        putPts .push({ time: t, value: put  })
        volPts .push({ time: t, value: (b?.callVol ?? 0) + (b?.putVol ?? 0),
                       lean: (b?.callVol ?? 0) >= (b?.putVol ?? 0) ? 'up' : 'down' })
    else:
        callPts.push({ time: t })   // whitespace
        putPts .push({ time: t })
        volPts .push({ time: t })
```

Note `lean` counts a tie as `'up'`.

**The fill horizon** — this is v2's recurring "gaps in the chart" bug, fixed properly:

```
lastDataSec = max(b.sec) over bins
horizon     = max(nowSec + BIN_SEC, lastDataSec)
```

Whitespace exists for exactly one reason: to hold the axis open across the part of the session
that has not happened yet. It must never open a hole in the *middle* of a line, and `nowSec` on
its own is not a safe edge for that. Two causes, both of which put real bins past "now":

- **Clock skew.** `nowSec` is the *browser's* clock. A machine a few minutes behind the server
  turned every bin in that window into whitespace — a break in the line that opened and closed as
  the clock drifted, which is the "ever so often" part of the original bug report.
- **The late-print re-scan.** The server re-stamps late prints back into their own minute
  (`NET_LATE_SEC`), so a poll can legitimately return a bin stamped ahead of where the client
  thinks the session edge is.

A bin holding data is also never whitespaced regardless — that is the `if (b || …)` test.

**Outputs read by the card:** `lastCall`, `lastPut` (final cumulative totals, dollars),
`openSec`, `closeSec`, `hasData` (`netBins.length > 0`), `byBin` (the crosshair's lookup).

### The legend

```
Calls  fmtPremium(series.lastCall)
Puts   fmtPremium(series.lastPut)
Net    fmtPremium(series.lastCall + series.lastPut)
SPX    fmtSpot(spotSeries.last)      // only when spotSeries.last > 0
```

`fmtPremium(v)` — `$1.23M` at ≥ 1e6 (2 dp), `$45.6K` at ≥ 1e3 (1 dp), `$789` below (0 dp).
Negatives get a leading `-`; positives get **no** `+`.

`fmtSpot(spot)` — `toLocaleString` with exactly 2 fraction digits. `0` and `undefined` both read
as `—`.

### The spot overlay — `buildSpotSeries(bins, { openSec, closeSec })`

Reads `NetBin.spot`: the **same aggregate, over the same rows**, that `buildNetSeries` walks into
the call and put lines. That is the whole point of it living in `flowMath.ts` rather than in a
second fetch.

> It used to be derived from the raw tape (`/proxy/flow-history`), and that tape is capped at the
> newest 20 000 rows. On a busy ticker the cap lands mid-morning, so the overlay began at 10:50
> while the drift lines — fed by the uncapped aggregate — began at 9:30: two lines on one x-axis
> covering different spans.

**Pass 1 — on the grid.** Keep bins whose `spot` is finite and `> 0`, snapped to
`floor(b.sec / 60) * 60`, inside `[openSec, closeSec]`. Empty → `{ pts: [], last: 0 }`.

**Pass 2 — the robust band.** `spot` is not clean: `flow-processor.js` writes whatever the
underlying quote said at coalesce time, and a stuck quote has already mislabelled a whole midday
SPX session once. The server's per-bin mean handles one bad print inside a minute; it does nothing
about a minute that is wholly wrong, and because the overlay is autoscaled **one 2× outlier
flattens the real intraday range into a straight line and draws the rest as square-wave spikes.**

```
med = median(values)
mad = median(|v - med|)                     // median absolute deviation
tol = min(med * SPOT_BAND_MAX,
          max(mad * SPOT_MAD_K, med * SPOT_BAND_MIN))
drop every bin with |v - med| > tol
```

| Constant | Value | Why |
|---|---:|---|
| `SPOT_MAD_K` | `8` | Half-width of the keep band, in MADs. MAD rather than a fixed percent because it **adapts** — a wide-range day widens the band on its own, so a real selloff is not clipped. |
| `SPOT_BAND_MIN` | `0.015` | Floor, as a fraction of the median. A dead-flat session cannot collapse the band to nothing. |
| `SPOT_BAND_MAX` | `0.12` | Ceiling. Nothing legitimate is ±12% intraday on an index; an outlier-heavy session cannot blow the band wide open. |

A rejected minute is **dropped, not replaced with a guess**.

**Pass 3 — the same walk.** Identical `openSec → closeSec` step-`BIN_SEC` loop with the same
horizon rule. A minute with no surviving level **carries the last known level forward** — the
level did not stop existing because nobody traded, and a held value keeps the line on the grid
instead of letting the series interpolate a straight diagonal across the gap. Nothing is held
*backward*: before the first bin that carried a spot there is whitespace, not a flat lead-in
inventing an opening level.

`last` is the newest surviving level in the window, `0` when none.

### The hover index — `ordersByMin`

```
for o in own:
    if !o.isOtm            : skip      // tri-state; null is correctly rejected
    if expiry && o.expiration !== expiry : skip
    minSec = floor(o.ts / 1000 / 60) * 60
    push into idx[minSec]
then sort each bucket by (b.premium || 0) descending
```

Narrowed to the same prints the line is drawn from, so the tooltip explains the chart rather than
sitting beside it. Note `o.ts` is **milliseconds** (exchange epoch) while `NetBin.sec` is
**seconds** — hence the `/1000`.

### The staleness read

```
lastBinSec = bins.at(-1)?.sec ?? null
binAgeSec  = lastBinSec == null ? null : max(0, Date.now()/1000 - lastBinSec)
stale      = binAgeSec != null && binAgeSec >= STALE_AFTER_SEC     // 180 s
feedError  = binsError || historyError
```

`STALE_AFTER_SEC = 180`. Three minutes — **not an error**: a genuinely quiet name goes minutes
between prints and that is information too. It is the line past which "nothing is happening" and
"nothing is arriving" stop being distinguishable by looking.

`useTick()` (default 15 000 ms) is what keeps this honest. The line runs flat from the newest bin
to the current minute, which is the right picture for a market that has stopped printing and an
*identical* one for a feed that has stopped arriving — and when the feed dies nothing else
re-renders the card, so an age computed only on new data would freeze at whatever it said when the
data stopped. `tick` is in the `useMemo` dep array as a **trigger, not an input**
(`eslint-disable-next-line react-hooks/exhaustive-deps` marks it).

`fmtAgo(sec)` — `12s` below a minute, `5m` below an hour, `1h 4m` above. Coarse on purpose: the
question a live panel has to answer is "is this feed still arriving", and to-the-second is noise
for that.

`fmtEtHm(utcSec)` — `08:58`, 24-hour ET via `en-GB`. Deliberately a different locale from
`fmtTime`: this is an axis extent, not a print time.

---

## Controls

### The RTH / ETH span toggle

The card's only control. A `SegGroup<ChartSpan>` in the `CardToolbar`.

| | |
|---|---|
| Component | `SegGroup` from `src/design/primitives/Controls.tsx`, `size` defaults to `'sm'` (`px-1.5 py-0.5 text-2xs`) |
| Options | `{ label: 'RTH', value: 'rth', title: 'Regular trading hours only (9:30–4:00 ET)' }`, `{ label: 'ETH', value: '24h', title: 'Extended hours — pre-open, RTH and the overnight global session' }` |
| Default | `'rth'` |
| Storage | `localStorage`, key `cb-v3-np-span`, raw string, no JSON, no version field |
| Read | `localStorage.getItem(SPAN_KEY) === '24h' ? '24h' : 'rth'` |
| Write | `useEffect` on every change, `try/catch` swallowed |
| Coercion of an old/unknown value | **Anything that is not the exact string `'24h'` coerces to `'rth'`.** A missing key, `null`, `'rth'`, `'RTH'`, `'eth'`, `'true'`, a hand-edited value — all become `'rth'`. There is no migration and none is needed. |
| Storage blocked | `readStoredSpan()` is wrapped in `try/catch` because storage **throws outright** in a locked-down browser (not just returns null). On throw it returns `'rth'`. The write is likewise wrapped: the session still works, it just will not persist. |

The state is read **lazily** (`useState(readStoredSpan)`), not seeded to `'rth'` and corrected in
an effect — seeding and correcting would redraw the whole grid one frame in.

**Why the choice is per browser, not per board.** It is a reading habit, and a trader who works
the overnight session should not re-pick it every session. It is also not part of the layout
blob: `layoutStore.ts`'s wire contract for `dashboard_layouts` is an array of `{id,x,y,w,h}` that
card settings do not get to extend.

**The fetch is untouched by the toggle.** `/proxy/flow-netprem` is not span-scoped, so flipping
RTH↔ETH is a re-render of bins already in hand, not a reload. `useNetPremBins`'s `key` does not
contain `chartSpan`.

**Why ETH exists at all.** The card used to be RTH with no toggle, on the reasoning that the
page's span switch is a lookback tool. That was wrong for the same reason the page grew the
switch: SPX prints nearly around the clock now, and on the fixed 9:30–4:00 grid an overnight
session draws as a flat zero line — the prints are not summarised, they are **discarded**, and the
card gives no sign it did it. A pre-open glance at this card was blank whether the tape was empty
or busy.

**Why it is labelled "ETH" and not "24H".** The page calls the span `24h` internally and the value
stored is still `'24h'`, but the label says ETH because that is what the GEX Candles card's
identical switch says, and one board should not have two names for one window.

### Everything that is *not* a control

There is no ticker box (the board's page symbol owns that — four cards each with a dropdown is
four places to change the same thing), no date picker (always `todayYmdET()`), no premium slider
(`CHART_MIN_PREMIUM`, fixed), no expiry picker (closest, computed), no side/type filters, no OTM
toggle (always on), no DTE window. The only other control is the expand button (`⤢` / `⤡`) that
`Card` draws in the header whenever an `ExpandStageHost` is present.

---

## Rendering

### Canvas, not DOM

The chart is **lightweight-charts** drawing into its own canvases, mounted imperatively inside
`ChartFrame`. The library is imported **dynamically**:

```ts
const { ColorType, CrosshairMode, HistogramSeries, LineSeries, createChart } =
  await import('lightweight-charts')
```

It is the single heaviest thing this route touches and the route chunk has a 59 100-byte brotli
budget (`budgets.json` → `route`); a static import would spend most of it before the page has
drawn a row.

The DOM parts are: the `CardToolbar` portal contents, the legend row, the optional ETH window
caption, the optional empty-state paragraph, the staleness paragraph, and the crosshair tooltip
(a positioned `<div>`, not drawn into the canvas).

### The four series

| Series | Type | Price scale | Colour token | Resolved hex |
|---|---|---|---|---|
| Calls | `LineSeries`, `lineWidth: 2`, `lastValueVisible: true`, `priceLineVisible: false` | `right` | `--color-netdrift-call` | `#3ddc8e` |
| Puts | `LineSeries`, same options | `right` | `--color-netdrift-put` | `#ff6b7a` |
| Volume | `HistogramSeries`, `priceFormat: { type: 'volume' }`, `lastValueVisible: false` | `vol` | per-bar: `tokenHexAlpha('--color-netdrift-call', 0.55)` when `lean === 'up'`, else `tokenHexAlpha('--color-netdrift-put', 0.55)` | `#3ddc8e8c` / `#ff6b7a8c` |
| Spot | `LineSeries`, `lineWidth: 1`, `crosshairMarkerVisible: false`, `priceFormat: { type: 'price', precision: 2, minMove: 0.01 }` | `spot` (hidden overlay) | `tokenHexAlpha('--color-fg', 0.38)` | `#e7ece961` |

The histogram's 55% alpha is v2's `rgba(34,197,94,.55)` / `rgba(239,68,68,.55)`, carried across
through the tokens.

> **`--color-netdrift-call` / `--color-netdrift-put` are their own tokens on purpose.** `T.green`
> / `T.red` (`--color-up` `#3ddc8e`, `--color-down` `#ff6b7a`) are v3's *provisional* directional
> pair, and this chart is one of the surfaces where matching v2 value-for-value is the
> requirement. They happen to carry the same values today; they stay separate names so one can
> move without the other. The same reasoning keeps `--color-candle-up` / `--color-candle-down`
> their own tokens.

The spot overlay gets **its own scale id**, which in lightweight-charts means an *overlay* price
scale — not rendered. The visible right axis is premium in dollars, and putting an index level on
it would make both meaningless. Shape is the point; the level is read off the crosshair and the
legend.

### Colour tokens used, with hex

From `src/design/tokens.css`:

| Token | Hex | Where |
|---|---|---|
| `--color-netdrift-call` | `#3ddc8e` | call line, legend dot, up-lean histogram bar |
| `--color-netdrift-put` | `#ff6b7a` | put line, legend dot, down-lean histogram bar |
| `--color-fg` | `#e7ece9` | spot overlay at 38%; tooltip primary text |
| `--color-muted` | `#e7ece9` | chart `textColor`, legend "Net", axis ticks, empty-state copy |
| `--color-faint` | `#c0c5c3` | the non-stale staleness line |
| `--color-line` | `#1e2630` | axis borders at 55% (`#1e26308c`), grid at 35% (`#1e263059`), tooltip border |
| `--color-warn` | `#ffd166` | the staleness line when `feedError || stale` |
| `--color-accent` | `#2f6bff` | the toolbar's `{ticker} · {expiry}` chip |
| `--color-surface` | `#0e1216` | tooltip plate |
| `--color-up` | `#3ddc8e` | tooltip row: bullish arrow, side, premium, left border |
| `--color-down` | `#ff6b7a` | tooltip row: bearish, same |
| `--color-raised` | `color-mix(in srgb, #141a21 92%, #e7ece9)` | card header hover states |

Canvas colours go through `tokenHex(name)` / `tokenHexAlpha(name, a)` from `design/theme.ts`.
This is the **only** sanctioned way to colour a canvas: `ctx.fillStyle = 'var(--color-up)'` does
not throw, it silently leaves the previous fill in place, and `color-mix()` is not a canvas colour
either. Both helpers resolve the custom property at call time behind a cache
(`rgbCache`), returning `'transparent'` before the stylesheet is live — a chart that paints
nothing for one frame is recoverable, one that paints an invented colour is not.

> A hex fallback typed into a chart file is **not** sanctioned — that is what put
> `src/board/chart-render.ts`, `gexCandles/bubbles.ts`, `gexCandles/chart.ts` and
> `gexChart/gexChartRender.ts` into `theme-baseline.json` between them.

### Layout constants

| Constant | Value | Meaning |
|---|---|---|
| `chart.priceScale('vol').scaleMargins` | `{ top: 0.86, bottom: 0 }` | The volume histogram is docked in the bottom 14% band. |
| `chart.priceScale('right').scaleMargins` | `{ top: 0.04, bottom: 0.16 }` | The drift lines get everything above it. **Keep the two bands adjacent** — every point of gap between `vol.top` and `1 - right.bottom` is vertical range the lines pay for and nothing draws in. (0.86 vs 0.84: 2 points of overlap, deliberate.) |
| `chart.priceScale('spot').scaleMargins` | `{ top: 0.08, bottom: 0.20 }`, `visible: false` | Same band as the drift lines so the two read against each other, inset a little so a flat spot day does not sit exactly on a drift line. |
| `TIP_MAX_ROWS` | `8` | Rows in the hover tooltip before `+N more…`. |
| Tooltip box | `min-w-[230px]`, `rounded-md`, `border-line`, `bg-surface`, `z-20`, `shadow-lg` | |
| Tooltip offset | `x + 16`, flipped to `x - tipW - 16` when it would overflow the host; `y - 10`; both clamped to `≥ 4` | |
| `ChartFrame` debounce | `80 ms` | Resize debounce. A chart library re-laying-out on every pixel of a drag is one of the most expensive things a dashboard can do. |
| `ChartFrame` rootMargin | `'200px'` | Visibility is deliberately generous — a card is painted just before it is scrolled into view rather than a frame after. |
| `defaultSize` | `{ w: 24, h: 48 }` | 24 of 48 columns = half the board; 48 × `BOARD_ROW_H` (8px) = 384px of grid height. Widths snap to a third (16), a half (24) or the whole board (48) — anything else is snapped on the way in (`design/primitives/Board.tsx`). |

### The axis pin

```ts
chart.timeScale().setVisibleRange({ from: s.openSec, to: s.closeSec })
```

**Deliberately not `fitContent()`**, which trims the trailing whitespace and re-scrolls — floating
the day's shape to the right and re-scaling it on every poll. The call is wrapped in `try/catch`:
an empty or single-point range throws, and the next poll fixes it.

### Axis and crosshair formatting

Both `timeScale.tickMarkFormatter` **and** `localization.timeFormatter` are set, to
`toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })`.
Both are needed: `localization.timeFormatter` alone only reaches the crosshair label, not the axis
ticks. `localization.priceFormatter` is `fmtPremium`, so the right axis reads `$1.23M`, not
`1230000`.

`timeVisible: true`, `secondsVisible: false`, `crosshair.mode: CrosshairMode.Normal`,
`layout.background: { type: ColorType.Solid, color: 'transparent' }` (the Card's plate shows
through), `layout.fontFamily: 'inherit'`, `leftPriceScale.visible: false`.

### The wrapper that must be a flex column

```jsx
<div className="flex min-h-0 flex-1 flex-col">
  <NetDriftChart … />
</div>
```

> MUST be a flex column: `NetDriftChart`'s root is `flex-1 min-h-0`, and so is the `ChartFrame`
> element lightweight-charts `autoSize`s to. In a plain block wrapper both resolve to auto height,
> the canvas collapses to a sliver and the drift lines render as a flat smear across the top of
> the card.

### The tooltip

Opens on `subscribeCrosshairMove`. It shows **nothing** and sets `tip = null` when any of:

- the pointer left the pane (`!param.point`),
- `param.time` is not a number,
- there is no `NetBin` at that minute,
- the bin has `callVol === 0 && putVol === 0`,
- `ordersByMin` has no prints for that minute.

Header: the ET minute, the overlay's spot at that minute (only when `> 0`), and
`OTM · N print(s)`. Body: up to 8 rows, each `▲/▼  BUY/SELL  <strike><type> ×<size>  <premium>`,
inked by `isBullish(side, type)` = `(buy && call) || (!buy && !call)`. Row background is
`alpha(bull ? T.green : T.red, 0.08)` — the 8% wash has no token of its own because it is this one
row's tint, not a surface, so it comes through `alpha()`, which is still the token underneath
(`color-mix(in srgb, var(--color-up) 8%, transparent)`).

**Position is set imperatively**, on the DOM node, not through React state — the pointer moves far
more often than the minute under it changes, and re-rendering a list on every mousemove to move it
sixteen pixels is the kind of thing that makes a page feel heavy for no visible reason. The
`setTip` call early-returns the previous object when `prev.timeSec === t`, so React bails out too.

---

## Performance machinery

1. **Visibility gating (non-negotiable 5).** `ChartFrame` reports three ways —
   `handle.visible()`, the `onVisibility(visible)` edge callback, and `data-visible="1"|"0"` on
   the element. `NetDriftChart` uses the edge callback. While hidden, `apply(series)` and
   `applySpot(pts)` are **not called**; the latest series is stashed in `pendingRef` /
   `pendingSpotRef` and flushed on the way back in. Nothing is lost, because only the last push
   matters — every push replaces the whole series.

   `ChartFrame` starts optimistic (`onScreen = true`) because the observer's first callback is
   asynchronous, and a first paint that is thrown away costs far less than a card that renders
   blank for a frame on every mount. It also tracks `document.hidden`, so a background tab counts
   as invisible. **`ChartFrame` cannot stop a renderer painting — it only reports.**
   `scripts/perf-check.mjs` is what says so out loud.

2. **Canvas tagging (non-negotiable 6).** After `createChart`, every canvas the library created
   inside `handle.el` that has no `dataset.cbLayer` gets `data-cb-layer="netdrift"`. These are the
   library's canvases, but they paint on this card's behalf, and an untagged canvas is measured as
   **nothing at all** by the perf check.

3. **Imperative updates (non-negotiable 4).** Every data push goes through
   `series.setData(...)`, never through React state on its way to the canvas. The crosshair
   handler is created **once** and reads `seriesRef` / `ordersRef` / `spotDataRef` / `spotByMinRef`
   so it can never close over a stale render's props.

4. **`spotByMinRef`** is a `Map<minute, spot>` rebuilt only inside `applySpot` — the tooltip must
   not walk an array on every mousemove.

5. **`useTick(15_000)`** is the only unconditional timer the card runs. It exists specifically so
   the age line keeps counting when everything else has stopped.

6. **Perf budget** (`budgets.json` → `perf`): `idleRepaintsPerFrame` 0.15, `offscreenRepaints`
   **0** (hard zero — a card scrolled out of view must not paint at all), `interactionRepaints`
   10. `npm run perf` adds every card in the catalog to a board and measures automatically; there
   is no list to update.

---

## Phone, expanded and replay behaviour

**Phone.** The board is a desktop surface. `useIsPhone()` (`src/design/useIsPhone.ts`) gates the
phone build: `(max-width: 820px)` **and** (`pointer: coarse` **or** `hover: none`) — width alone
misclassifies a narrow desktop window, `pointer: coarse` alone misclassifies a touchscreen laptop.
The phone shell (`src/mobile/`) has its own pages — `MGex`, `MEm`, `MSpx`, `MEcon`, `MHeat`,
`MAlerts` — and **Net Premium is not one of them**. The card ships no `touch`-size controls; its
`SegGroup` uses the default `'sm'`, which is the board's own density and is explicitly wrong the
instant a thumb is the pointer.

**Expanded.** `Card` draws an expand control (`⤢`) whenever an `ExpandStageHost` is on the page.
Expanding portals the **same React element** into the page column's `absolute inset-0` stage — not
the Fullscreen API and not `position: fixed` over the viewport, both of which would take the rail
and the toolbar with them. The chart instance, the fetched bins and the tooltip state all survive,
because a portal moves the DOM and leaves the React tree where it is. The tile keeps its place in
the grid and is empty for the duration, so collapsing puts the card back exactly where it was.
`ChartFrame`'s `ResizeObserver` fires, `autoSize: true` re-lays the chart out, and the 80ms
debounce absorbs the transition. Esc collapses. Outside an `ExpandStageHost` the context is null
and no button is drawn.

**Replay.** Net Premium has **no replay path**. It is hardwired to `todayYmdET()` and
`isToday = true` in all three places it matters (`useFlowHistory`, `useNetPremBins`,
`buildNetSeries`). The replay surfaces in this app (`src/pages/Replay.tsx`,
`src/pages/replay/mgReplay.ts`, `MultiGreekReplay`) are Multi Greek's, not this card's. The `/flow`
page is where a historical session is read; there the same hooks take a real date and
`isToday = false`, which stops `useNetPremBins` polling at all (past sessions are immutable).

---

## Status and empty-state messages, verbatim

Ordered by precedence.

### 1. `{active} — not available. Coming soon.`

```jsx
<p className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-muted">
```

Shown when `unavailable = !historySwitching && own.length === 0` — the tape has been asked and
came back with nothing for this ticker, and only once it has **settled**. `useFlowHistory` reports
`switching` from its very first render (seeded from `enabled`), so this cannot flash on the way in.
When it shows, it **replaces the entire card body** — no legend, no chart, no staleness line.

### 2. `{fmtEtHm(openSec)}–{fmtEtHm(closeSec)} ET`

e.g. `04:00–20:00 ET`. Shown only when `chartSpan === '24h' && series.hasData`.

> On ETH the axis is whatever the bins reached, so the window has to be stated — otherwise there
> is no way to tell an overnight session that started at 18:00 from one that started at 03:00.
> RTH needs no caption: its grid is always 9:30–4:00.

Same line the `/flow` page prints under its own span switch.

### 3. `No {active} OTM flow yet for {fmtContractDate(expiry)}.`

e.g. `No SPX OTM flow yet for 9-20-26.` Shown under the chart when `!series.hasData` **and** an
expiry has been picked. `text-xs text-muted`.

### 4. `Waiting for the first print…`

Shown under the chart when `!series.hasData` **and** `expiry == null` — i.e. the tape has rows but
none of them carried an `expiration`, or the tape has not settled yet. Note the ellipsis is the
single character `…`, not three dots.

### 5. `Feed error — showing the last data that arrived.`

Shown when `feedError = binsError || historyError`. Takes precedence over the age line. Rendered
`text-warn` (`#ffd166`).

### 6. `Last print {HH:MM} ET · {ago} ago`

e.g. `Last print 15:42 ET · 3m ago`. Shown whenever `lastBinSec != null` and there is no feed
error — **always**, once there is a bin, because the age is the number that tells a quiet tape
from a dead one. `text-faint` (`#c0c5c3`) normally, `text-warn` (`#ffd166`) once
`binAgeSec >= 180`.

### 7. The `.stale` wash

The whole body carries the `stale` class while `historySwitching || binsSwitching`:

```css
.stale { opacity: 0.55; transition: opacity 120ms ease-out; }
```

> Intentionally subtle: the point is that the screen is never empty, not that the user is warned.

### 8. The toolbar chips

- `OTM` — `text-2xs font-bold uppercase tracking-[0.08em] text-muted`, always present.
  It was previously `OTM · closest expiry`; the second half was saying twice what the next span
  already says, and the RTH/ETH toggle needed the room more than the repetition did.
- `{active}{expiry ? ` · ${fmtContractDate(expiry)}` : ''}` — `tabular text-2xs font-semibold
  text-accent`, e.g. `SPX · 9-20-26`.

### 9. The CopyShot caption

```jsx
data-capture-meta={`${active}${expiry ? ` · ${fmtContractDate(expiry)}` : ''} · OTM · ${
  chartSpan === '24h' ? 'ETH' : 'RTH'
}`}
```

e.g. `SPX · 9-20-26 · OTM · RTH`. The caption strip under a CopyShot reads
`Net Premium · <time> · <this>`. See `shell/snapshot.ts` (`META_ATTR = 'data-capture-meta'`).

> The ticker and the contract date are what make a shared PNG of this card still mean something a
> week later, and this card is the only thing that knows them. The span rides along because RTH
> and ETH of the same minute are different pictures, and a shared PNG that does not say which one
> it is invites exactly the misread the toggle exists to prevent.

---

## Gotchas

- **`chart-render.ts` is not this card's renderer.** It is the board's generic 2D-canvas kit
  (`useCanvasRenderer`, `drawCandles`, `drawDivergingBars`, `drawLines`). Net Premium draws with
  lightweight-charts via `NetDriftChart`. `chart-render.ts` also carries hardcoded hex fallbacks
  (`'#23272e'`, `'#5b8cff'`, `'#e0645f'`) and is grandfathered in `theme-baseline.json` for
  exactly that — do not copy that pattern into a new chart file.

- **The card is today-only, and hardcodes it three times.** `date = todayYmdET()`,
  `useNetPremBins(active, date, /* isToday */ true, …)`, `buildNetSeries(bins, { isToday: true, … })`.
  Any change to give this card a date picker must touch all three or the grid will be built for one
  day and the bins fetched for another.

- **`minPremium` means two different things in this card.** The `FlowFilters` object carries
  `minPremium: 0` (so `filterParams` emits nothing), while the URLs both carry
  `minPremium=CHART_MIN_PREMIUM` (1 000) — written directly into the netprem key and passed as the
  third argument to `useFlowHistory`. Reading `filters.minPremium` to learn the card's floor gives
  the wrong answer.

- **`o.ts` is milliseconds, `NetBin.sec` is seconds.** Every conversion in the card is explicit
  (`Math.floor(o.ts / 1000 / BIN_SEC) * BIN_SEC`, `Date.now() / 1000 - lastBinSec`). Mixing them
  puts the hover index 1 000× off the grid, silently, and the tooltip simply never opens.

- **`isOtm` is tri-state.** `!o.isOtm` in `ordersByMin` (and `passesFilters`) rejects `null`, which
  is correct — an unknown moneyness is not an OTM print — but it means the hover list can be
  legitimately shorter than the bin's print count when the spot feed was down.

- **`NET_LATE_SEC` must stay ≥ the server's `NETPREM_LATE_MS`.** They are in two repos. If the
  server's re-scan window widens and this constant does not, the client will discard bins the
  server just refetched and the chart will develop holes that look like clock skew.

- **`--color-netdrift-call` is a green that is currently identical to `--color-up`.** They are
  separate tokens and must stay so. Painting the legend from `T.green` instead of `NET_DRIFT_CALL`
  would work today and silently desync the day either token moves.

- **`setVisibleRange` throws on an empty or single-point range.** The `try/catch` is not
  defensive noise — it is hit on the very first paint of a ticker with one bin, and the next poll
  fixes it.

- **The wrapper `<div>` around `NetDriftChart` must be `flex min-h-0 flex-1 flex-col`.** A plain
  block wrapper collapses the canvas to a sliver. This has been re-broken before; the comment in
  the JSX is there for that reason.

- **The 5-second netprem poll does not check tab visibility.** `useFlowHistory`'s 45-second
  refresh does (`document.visibilityState === 'hidden'` → return), and `useQuery`'s `pollMs` does.
  `useNetPremBins` does not. A backgrounded board with this card on it keeps asking every 5s,
  subject only to the browser's own hidden-tab timer throttling.

- **Neither flow hook is a `useQuery`.** `refreshAll()` (the toolbar's ↻, `data/api.ts`) empties
  the query cache and calls every mounted `useQuery`'s revalidator. This card registers nothing
  there, so ↻ does not touch it. `reconnectSocket()` does affect the live leg for SPX.

- **The warm start is `sessionStorage`, not `localStorage`.** `cb-v3-flow-netbins` holds exactly
  one payload — the *last* key — so switching ticker and switching back does not warm-start the
  first one. That is by design: the key check (`j.key === key`) is what stops it ever showing the
  wrong session.

- **Two copies of this card share `cb-v3-np-span`.** The catalog does not pass `instanceId` to
  `NetPremiumCard`, and the span key has no instance suffix. Adding `net-premium#2` to a board
  gives you two cards on the same ticker, same expiry and same span — which is why the catalog
  comment for `top-flow` calls out that *it* threads `instanceId` and this one does not.

- **`Number(null)` is `0`.** Not a bug in this card (the span reads a string), but it is the exact
  trap the Flow Tape card's `loadStop()` documents, and any future numeric setting added here must
  test for "nothing stored" *before* converting.

- **The staleness line says "last print" but measures the last *bin*.** On a minute where the
  aggregate is ahead of the raw tape (the late-print re-scan) the two can differ by up to
  `NET_LATE_SEC`.
