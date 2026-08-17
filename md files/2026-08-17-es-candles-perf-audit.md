# ES Candles — Lag Audit

**Date:** 2026-08-17
**Files audited:** `app/es-candles/page.tsx`, `components/dashboard/es-candles/*` (EsChartCard.tsx 5,212 lines / 304 KB), `hooks/useEsCandles.ts`, `hooks/useEtfCandles.ts`, `lib/gexSocket.ts`, `lib/snapdb.ts`, `lib/sharedCache.ts`, `app-vite/src/App.tsx`

---

## Headline

**You do not need to cut features to make this page fast.** Roughly 90% of the CPU
this page burns is *redundant* — the same work recomputed every frame from data that
did not change. The feature set is not the cost; the wiring is.

Three structural faults account for almost all of it:

1. **The candle array gets a new JS identity 4–8× per second.** Everything downstream —
   20 memos, a 1,409-line effect, a full `setData()`, a ResizeObserver, 5 subscriptions —
   rebuilds at that rate.
2. **15 call sites call `draw()` synchronously**, bypassing the rAF coalescer that exists
   10 lines away. A websocket burst = a full canvas repaint per frame received.
3. **`draw()` recomputes viewport-independent data every frame** — the basis model, the
   flip-cross series, per-column sorts, and ~200,000 `priceToCoordinate()` calls.

---

## Tier 1 — the actual lag (fix these and the page transforms)

### 1.1 `rows` identity churn → the 1,409-line effect tears down 4×/sec
`EsChartCard.tsx:3040-4449`, dep array at `:4449`

```
}, [showHeatmap, showGexBubbles, bubbleMins, bubbleLevels, bubbleIntensity, bubbleSize,
    intensity, gexMetric, rows, interval, showProfile, profile, showTpo, tpoProfiles,
    showLevels, showFlipCross, mvcHistory, showCb, bb, weeklyEm]);
```

`rows`, `profile`, `tpoProfiles`, `bb` all get new identities together on every candle
batch. `useEsCandles.ts:176` coalesces at 250 ms, **and publishes with two separate timers**
(`:295-310`), so it is 4–8 renders/sec. Each one: `ro.disconnect()`, remove 3 DOM listeners,
unsubscribe the time scale, rebuild a `ResizeObserver` (which fires a synchronous callback
on `observe()`), re-subscribe, `draw()`. Twelve times a second on a 3-card row.

**Fix:** split it. A `[]`-dep effect owns the rAF loop, ResizeObserver, and the wheel/
pointermove/pointerup listeners. The draw closure goes in `drawOverlayRef` (which already
exists, `:608`). A narrow effect on the data values just calls `drawOverlayRef.current()`.
Also merge the two publish timers in `useEsCandles` into one — that alone halves render count.

### 1.2 Every WS frame drives a synchronous full repaint
`EsChartCard.tsx:1746` and 14 other sites vs. the coalescer at `:4405-4408`

The rAF `schedule()` is correct and properly guarded. It is wired to exactly 5 triggers.
Everything else — `:1370, 1746, 2040, 2044, 2194, 2474, 2489, 2563, 2638, 2744, 2846, 2869,
2928` — calls `drawOverlayRef.current()` directly. A `spot` frame at 5–10 Hz = 5–10 full
overlay repaints per second, each of which also re-runs the bubble prep because
`minuteColsVerRef.current++` fired at `:1733`.

**Fix:** put `schedule` (not `draw`) in the ref. Every call site becomes coalesced. One-file change.

### 1.3 Two independent rAF loops that don't coalesce with each other
`:4405-4408` (overlay effect) and `:4458-4471` (5 s backstop)

The backstop subscribes `repaint` to `subscribeVisibleTimeRangeChange` while the overlay
subscribes `schedule` to `subscribeVisibleLogicalRangeChange`. **Both fire on the same pan.**
Separate `raf` handles, so a drag schedules two rAF callbacks per frame — and the backstop's
also does a rail draw and a React render (`setLiveSpx`) on top.

**Fix:** delete the `subscribeVisibleTimeRangeChange` subscription; route `repaint` through
the same `schedule`. Make the 5 s tick a no-op when a cheap signature is unchanged.

### 1.4 Mouse move = full React reconciliation of a 5,212-line component
`:2495-2501` (`setCrossSpx`), `:2569-2586` (`setLiveSpx`)

Both allocate a fresh `{y, spx}` object every call, so React can never bail out.
`setCrossSpx` fires on every crosshair event (~60 Hz). `setLiveSpx` is wired to
`subscribeVisibleLogicalRangeChange`, so every pan frame re-renders the whole card —
which rebuilds `dock` (56 elements), `statsLine`, `replayBar`, `SidePanel` and `ChainRail`,
none of which are memoized. **This is the "slow crosshair."**

Their only consumers are two absolutely-positioned labels at `:5092-5115` and `:5144-5161`.

**Fix:** take them out of React entirely — write `style.top` / `textContent` on ref'd nodes
from the same rAF that runs `draw()`. Or at minimum bail on unchanged values, the pattern
already used correctly at `:2895`.

### 1.5 `draw()` recomputes viewport-independent data every frame

| Line | Work redone per frame | Depends on |
|---|---|---|
| `:3141-3224` | `buildBasisAt()` — walks all of `mvcHistory`, binary-searches `rows` per point, builds 2 Maps, sorts, medians per day | `mvcHistory`, `rows` — **not the viewport** |
| `:4285`, `:4295` | Flip-cross: spreads + sorts up to 2,000 columns, then copies-and-sorts **every column's cell array** (2,000 sorts of 200-400 elements) | `minuteColsVerRef` |
| `:4006-4008` | Bubble `drawOrder` — filter + sort per bucket × ~400 buckets = ~100k predicate calls, 400 allocs, 400 sorts | already in the `bubblePrepRef` memo signature |
| `:3531-3534` | Per-column: 4 array allocs + 2 sorts + `Math.max(...spread)` of 200-400 args. Historical columns *never change* | `col.cells`, `metric` |

**Fix:** `bubblePrepRef` at `:3620-3757` is the correct pattern and the file's own comment
(`:3606-3618`) says *"that was the lag."* Extend it to all four. Cache derived values on the
column object; historical columns compute once per session.

### 1.6 ~200,000 `priceToCoordinate()` calls per frame
`:3546-3547`

```js
const pTop = series.priceToCoordinate(nextStrike + colBasis);
const pBot = series.priceToCoordinate(cell.strike + colBasis);
```

Two per cell. With `showHeatmap` on, `needsFullLadder` (`:1990`) disables `?top` truncation,
so columns carry the full ~200-400 strike ladder. Hundreds of visible columns → 50k-250k calls.
**Half are redundant by construction:** `pTop` of cell *i* IS `pBot` of cell *i+1*.

Same shape at `:3331-3337` / `:3510` / `:3519` — `slotX()` does 4 `timeToCoordinate` + 4 binary
searches per column and column *i+1*'s value is thrown away and recomputed next iteration
(~6,000 calls/frame).

**Fix:** one `ys` array per column (1 call per strike boundary), one `xs` array per frame.
Then hoist further — `colBasis` is a per-ET-day constant and the strike grid is identical
across columns, so a `Map<basisKey, Map<strike, y>>` built once per frame collapses it to ~1,000 calls.

### 1.7 `ctx.filter = "blur(2.5px)"` over the full viewport, every frame
`:3559-3567`

Full-viewport Gaussian blur + a second full-viewport composite, on every repaint — including
repaints where only the crosshair moved. Typically **4-12 ms by itself** on a 1600×700 plot.
`ctx.filter` and `shadowBlur` are the two most expensive canvas primitives.

**Fix:** cache the blurred output in a second offscreen canvas keyed on
`(w, h, visibleRangeSig, dataVersion)`. Cheapest interim: skip the blur while a pan/zoom
gesture is in flight, do one blurred frame on settle.

### 1.8 One-line free win: `Intl.DateTimeFormat` constructed per call
`chartMath.ts:207-214`, called per MVC point per frame at `EsChartCard.tsx:4219`

`etMinutes()` builds a **new** `Intl.DateTimeFormat` on every call. Every sibling helper in
that file uses a module-level cached formatter (`ET_DAY_FMT:44`, `ET_HM_FMT:49`) — this one
was missed. ~10-40 µs each, called over hundreds of MVC rows, every frame. Several ms/frame
from one missing hoist.

Same bug at `EsChartCard.tsx:1465` and `:1509` (`dayKey` builds a formatter inside a per-row loop).

---

## Tier 2 — pure waste (delete, no feature loss)

### 2.1 `useEsCandles` computes a result the page throws away
`useEsCandles.ts:362-372`

`candles` is an unconditional `useMemo` running **two full `buildSlotAverages` passes** over
the entire historical array plus a sort and a map, deps `[todayRows, historical]` — republished
at 4 Hz. `EsChartCard.tsx:341` destructures `{ sessionCandles, historical, connected, refresh }`
and **never takes `candles`.**

Two O(n) scans of ~2,600 rows (~10,000 at 1m) × 4/sec × 3 cards, discarded 100% of the time.
Everything feeding it (`liveMapRef`, `todayRows`, `rowsTimerRef`) exists only for this.

### 2.2 `useEsCandles` runs at full cost on SPY/QQQ cards
`EsChartCard.tsx:341` — called unconditionally, `enabled` hardcoded true. A SPY card still
pulls today + 9-day **ES** candle history and still subscribes to `esCandles`/`es1mCandles`.
`historical` (`:350`) and `rows5` (`:435`) discard it when `!isEs`.

### 2.3 The dock is built on cards that never render it
`:4506` — `const dock = (…)` constructs 56 elements every render of every card, but is only
used at `:5032` (`dockMode === "full"`) and `:5036` (`"shared"`). In a 3-up row, cards 1 and 2
build the whole tree — `FitScale`, `Dock`, 5 `DockButton`s, 2 `SegGroup`s, `SymbolListDropdown`,
`BoxSnapBtn`, `BoxDiscordBtn` — and throw it away.

### 2.4 Wire topics wider than any consumer
`gexSocket.ts` itself is well built — one refcounted socket, one `JSON.parse` per frame for all
subscribers. The consumers are the problem:

- **`es1mCandles` is received and discarded whenever the chart is on 5m** (the default).
  `useEsCandles.ts:324-326` ingests only the stream it wants; the other is parsed, fanned out
  to 6 subscribers, and dropped by all of them.
- **`status` is requested (`:36`) but never handled.** `onGexFrame:1752-1758` branches only on
  `snapshot|gex|GEX_UPDATE|spot|aux`. The comment justifying it says the card reads `expiry`
  off "whatever frame it gets" — but that read is inside `applyGexFrame`, which `status` never reaches.
- **`gex` is requested unconditionally, even on a pure SPY/QQQ row.** `ES_CHART_TOPICS` is a
  module constant, not derived from `isEs`. On an ETF card `ingestLive` refuses it (`:1672-1674`).
  The heaviest frame type on the feed, delivered and discarded.

### 2.5 Four dead hooks
`useGexBubbleHistory`, `useStrikeGexHistory`, `useStrikeGexRate`, `useEmLookup` — imported by
nothing in this bundle. `useGexBubbleHistory` is a near-duplicate of the inline backfill at
`:2066` with its own 60 s interval and a URL that differs only in `&top=`, so it would *not*
share the `dedupeFetch` entry if it ever got mounted.

### 2.6 `useWsLifecycle` instantiated 6× on a 3-card page
6 passive window listeners each = **36 listeners**. Every `mousemove` fires `onActivity`
→ `clearTimeout` + `setTimeout`, **6× per event, unthrottled** (`useWsLifecycle.ts:52-56`).

---

## Tier 3 — load time

### 3.1 The `settingsLoaded` gate delays every request by a full React commit
`:386, :1165, :1891, :2219, :2608` all early-return until the localStorage restore effect
(`:1283-1302`) runs. So: mount → effect → setState → re-render → *then* the ~107 KB-1.6 MB
backfill starts.

The comment justifies the gate by **Next SSR hydration mismatch** — but this route is served
by the Vite SPA (`app-vite/src/App.tsx` is a pure `BrowserRouter` client app). There is no SSR
here. Read the slot blob in a lazy `useState` initializer instead.

### 3.2 `/api/eod-gex` is needlessly serialized behind the candle load
`:2673` — deps `[historical, isEs]`, derives `esDate` from loaded candles *before* calling
`:2702`. But `/api/eod-gex?symbol=$SPX&limit=30` needs nothing from the candles (the date match
at `:2712` falls back to `spxRows[0]`). Free parallelization.

### 3.3 Two `/api/levels` requests on ES
`:393` asks `ticker=ES`, `:1180` asks `ticker=SPX`. Different URLs → different `cachedJson`
entries → 2 requests. The comment claims they share the cache entry; that's true on SPY/QQQ
and never on ES.

### 3.4 `/api/snapshots/etf-candles` never got `lite=1`
`useEtfCandles.ts:61-64` — verbose JSON, `cache:"no-store"`, no dedupe, no shared cache.
~100-350 KB, **polled every 30 s**, for a table written once a minute. 3 SPY cards = 3 copies.
Every other candle endpoint got the `lite=1` treatment (`snapdb.ts:388-392`).

### 3.5 Polls that are ~always identical

| Endpoint | Period | Actually changes |
|---|---|---|
| `/api/levels` (`:413`) | 300 s | **weekly** |
| `/api/eod-gex` (`:2750`) | 300 s | once a day at 16:00 ET |
| `/proxy/es-spx-basis` (`:2648`) | 1800 s | ~a point a day |
| `/api/snapshots/mvc` (`:2292`) | 60 s | 1 new row out of 1,000 (~99.9% redundant bytes) |
| `/api/expirations` (`ChainRail:157`) | 1800 s | once a day |

Steady-state 3-card ES/SPY/QQQ row: **~2.1 MB/min of HTTP on top of the websocket.**

### 3.6 Full-resolution fetch, immediately downsampled
The backfill returns **1-minute** columns; the heatmap floors them to the 5-minute grid at
`:2153` and keeps only the newest per bucket at `:2167`. **~80% of the response is discarded
on arrival.** Off-session the window widens to 4 days (`:1927-1931`), so ~75% of *that* is
fetched purely to be thrown away. A server-side `&bucket=5m` would cut the page's largest
response 4-5× with zero visual change.

### 3.7 Bundle
`page.tsx:56` imports `EsChartCard` statically — 304 KB of source (~2,740 code lines after
comment strip) plus `lightweight-charts`. The route *is* lazy-split in `App.tsx:25`, but
`App.tsx:8-9` imports `TradersDashboard` and `Analytics` **eagerly** — if either transitively
pulls `lightweight-charts` or `html2canvas` (likely via `components/shared/DataBox`, imported
at `EsChartCard.tsx:51` for `BoxSnapBtn`/`BoxDiscordBtn`), both land in the entry chunk and
the split buys nothing. Worth a `vite-bundle-visualizer` run.

---

## Tier 4 — smaller, cheap

| Location | Cost | Fix |
|---|---|---|
| `:3537, 3542-3544` | `gexColor()` builds an `rgba()` string + a **regex replace with a closure** + `parseFloat` + 2× `toFixed(3)` **per cell per frame**, then `fillStyle=` CSS-parses it | Return numeric rgba; quantise alpha to 64 buckets into a prebuilt `string[]`; batch cells by color |
| `:3229-3231` | `new URLSearchParams(location.search)` allocated **every frame** to test a debug flag | Read once into a ref at mount |
| `:3509` | `basisAt()` (→ `etDayKey` → `Intl.format` + binary search) runs **before** the visibility cull at `:3529` | Move 20 lines down |
| `:1732, 1743` | `Math.min(...map.keys())` spreading up to 10,000 args per WS frame — O(n) *and* a stack-overflow risk | `map.delete(map.keys().next().value)` — O(1) |
| `:2529-2537` | `rows.map()` → 7k objects → full `candleSeries.setData()` at 4 Hz; lightweight-charts rebuilds the entire series | `.update(lastBar)` when only the tail changed |
| `:3480-3488` | `hmBufRef` reuse is **correct**, but `buf.getContext("2d")` is called every frame before the size check | Cache the context alongside the ref |
| `:3942-3972` | `glowSprite` allocates a canvas + `shadowBlur` ellipse inside the per-cell loop; during zoom the 0.5 px quantisation misses every frame, and `glowCache.clear()` wipes all 96 entries at once | Coarser size quantisation during interaction; LRU-evict one entry instead of clearing |
| `:4157-4159` | One `fillRect` per TPO box per bin × 4 profiles = thousands of rects/frame | One `fillRect` per row when `boxW+gap < ~2px`; or pre-render each profile offscreen |
| `ChainRail.tsx:305,310` | `ctx.font` assigned **twice per row** (~400 font-string parses/frame); `textAlign` flips twice per row | Two passes: set font once, draw all strikes; set once, draw all values |
| `ChainRail.tsx:240-273` | sort + map + filter + second sort + map over all rows on **every overlay frame** | Cache on the cells version; only `toY` needs per-frame |
| `page.tsx:344-357` | `getBoundingClientRect()` on every `resize` **and every capture-phase `scroll`**, unthrottled, then a setState that re-renders all 3 cards | rAF-throttle; drop `capture: true` |
| `:2510-2519` | `init` is `async` with **no `await`** — `cleanup = fn` lands in a microtask while the returned cleanup runs synchronously. Under StrictMode the first cleanup runs before assignment → **orphaned ResizeObserver firing `applyOptions` for the life of the page** | Drop `async`/`.then()`, return the cleanup directly |
| `slotStore.ts:246,316` | `writeSlot` is read-modify-write (`JSON.parse` + `stringify` + synchronous `setItem`) and it's wired to slider `onChange` (`:1326-1338`) — one full cycle **per pointer event** while dragging | Debounce the write; keep the in-memory value hot |
| `:1637-1658` | `setLevels` unconditionally returns a new object literal → full render on **every** `spot`/`aux` frame. `setRailRows` (`:1689`) maps the whole ladder to a fresh array per `gex` frame | Bail on equality (pattern already at `:2895`); move rail rows to a ref + `railDrawRef` |
| `:1055` | 1 Hz `setCountdownNow(Date.now())` re-renders the entire card to update one text node at `:5140` | `<BarCountdown/>` leaf, or `textContent` via ref |
| `:1457` | 60 s `setClockTick` invalidates `sessionLevels`, `ibLevels`, `tpoProfiles` — three full 7k-row rescans, 1,440×/day, for values that change ~4×/day | Derive from `Date.now()` inside the memos |
| `:908-919` | `replayGex` computed **in the render body** (not a memo) — iterates up to 10,000 columns on every render while replay is on, including the 8 Hz `setReplayIdx` loop. Its consumer memo at `:940` can therefore never hit | `useMemo` on `[replayOn, replayTs, isEs, minuteColsVer]` |

### Not problems (checked, they're fine)
- `lib/gexSocket.ts` — one refcounted socket, one parse per frame, exponential capped backoff, widen/narrow debouncing. Well built.
- `lib/snapdb.ts` — **no IndexedDB despite the name**; it's all `fetch()`. The one real cost is `_expandCandles` (`:394-409`) allocating ~10,000 objects synchronously at 1m/7d, ~20-60 ms.
- `hmBufRef` allocation logic (`:3480-3488`) — correctly reused.
- `subscribeCrosshairMove` does **not** trigger a canvas redraw; the `pointermove` handler is correctly gated on `e.buttons !== 0`.
- The rAF coalescer at `:4405-4408` is itself correct. The bug is that 15 sites bypass it.
- No `useEffect` is missing a dep array (a grep suggests one at `:3040`; that's a false positive from the regex literal at `:3544`).
- No true O(n²). The columns × strikes cost is inherent — but ~90% of it is currently redundant.

---

## Recommended order

**Phase 1 — one afternoon, no behaviour change, biggest win**
1. Hoist the `Intl.DateTimeFormat` in `chartMath.ts:208` (and `:1465`, `:1509`). *One line each.*
2. Move `basisAt` below the cull (`:3509` → after `:3529`). *One line.*
3. Route all 15 `draw()` call sites through `schedule`. *Removes duplicate draws per tick.*
4. Merge the two publish timers in `useEsCandles.ts:295-310`. *Halves render count instantly.*
5. Delete the unused `candles` memo (§2.1) and gate `useEsCandles` on `isEs` (§2.2).
6. Identity-guard `setLevels`, `setEmWeekly`, `setPrevCloses`, `setMvcHistory`.

**Phase 2 — the structural fix**
7. Split the 1,409-line effect: wiring in a `[]`-dep effect, draw closure in the ref.
8. Take `liveSpx` / `crossSpx` / `countdown` out of React (imperative DOM in the rAF).
9. Extend the `bubblePrepRef` memo pattern to `buildBasisAt`, `flipPts`, `drawOrder`, per-column derived values.
10. `memo()` on `EsChartCard`, `SidePanel`, `ChainRail`; memoize `toolbarButtons` in `page.tsx`.

**Phase 3 — the canvas hot loop**
11. Per-column `ys`/`xs` arrays; then the `Map<basis, Map<strike, y>>` hoist (§1.6).
12. Numeric color + quantised alpha palette; batch `fillRect` by color (§4).
13. Cache or gate the blur pass (§1.7). *Highest visual-regression risk — validate last.*

**Phase 4 — network**
14. Drop the `settingsLoaded` gate; parallelize `/api/eod-gex`; merge the two `/api/levels`.
15. `lite=1` on etf-candles; slow the always-identical polls; server-side `&bucket=5m`.
16. Delete the four dead hooks; singleton `useWsLifecycle`.
17. Verify the eager bundle doesn't pull `lightweight-charts`/`html2canvas` into the entry chunk.

---

## On "just candlesticks and bubbles"

That is available as a lever, but based on this audit it is **not** what stands between you
and a fast page. Concretely, if you deleted the heatmap, TPO, volume profile, flip-cross, CB
line, EMAs, Bollinger, RSI and the side panels today and changed nothing else, you would
still have:

- 4-8 whole-component React renders per second from `rows` identity churn
- a full React reconciliation on every mouse move
- an uncoalesced repaint per websocket frame
- the ResizeObserver teardown/rebuild loop
- two rAF loops fighting each other
- the whole Tier 3 network profile

You would have removed maybe half the per-frame canvas cost and none of the jank.

Conversely, Phase 1 + 2 above keeps **every feature** and removes the great majority of the
lag — because the work being eliminated is work that produces no pixels.

The one place where cutting genuinely helps is the heatmap's **full strike ladder**
(`needsFullLadder`, `:1990`): turning it off is what shrinks columns from ~400 strikes to
~30, and it is the single largest input to both the 1.6 MB backfill and the per-cell loop.
That is a targeted cut worth considering on its own merits — it does not require abandoning
volume profile, TPO or the studies.

**Recommendation:** run Phase 1 first (low risk, measurable in an afternoon), measure, then
decide whether anything still needs to go.
