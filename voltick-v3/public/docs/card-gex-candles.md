# GEX Candles — board card reference

| | |
|---|---|
| **Catalog id** | `gex-candles` |
| **Label** | `GEX Candles` |
| **Icon** | 🕯️ |
| **Default grid size** | `{ w: 24, h: 48 }` — half the 48-column board (`BOARD_COLS` 48), 48 rows × `BOARD_ROW_H` (8px) = 384px |
| **Source folder** | `src/board/gexCandles/` (10 files, 6,793 lines) |
| **Component** | `GexCandlesCard` — named export, `lazy()`-loaded from `src/board/catalog.tsx:24`, catalog entry at `src/board/catalog.tsx:188` |
| **Instance-aware** | **Yes.** `render: (instanceId) => <GexCandlesCard instanceId={instanceId} />` |
| **Renamed from** | `es-candles` → `gex-candles`, via `RENAMED` in `catalog.tsx` — "the futures were dropped, so the card is no longer about ES" |

Mounted in **three** places, and each one passes a different prop:

| Where | Mount | What the props do |
|---|---|---|
| **The board** | `src/board/catalog.tsx:197` — `<GexCandlesCard instanceId={instanceId} />` inside `<Deferred>` | No `replay`, no `spxOnly`. Instance 1 follows the board ticker; `#2`, `#3`, … each carry their own `TickerPicker`. |
| **The Replay hub** | `src/pages/Replay.tsx:251` — `<GexCandles replay />` (tab `gex-candles`, label "GEX candles", framed, `chart: true`) | Opens already rewound to the session's open, with the transport docked. `instanceId` defaults to the bare `gex-candles`, so it reads the board card's settings blob. |
| **The phone** | `src/mobile/pages/MSpx.tsx:30` — `<GexCandlesCard spxOnly />` inside `MobileShell title="Candles" fill` (route `/v3/m/spx`) | Pins SPX, derives session from the tape, drops the rail, folds the toolbar into a bottom sheet. |

The Replay tab's blurb, verbatim: *"The candles with the GEX bubbles and the rail over them, scrubbed through the session on one cursor — the ladder as it stood at each bar, not as it stands now."*

---

## What it is, in one paragraph

A candlestick chart with the option market's gamma ladder stamped over it as a trail of coloured dots. Each dot is one **bucket** of time — a minute, or five, matched to the bar interval — and inside a bucket the four strikes carrying the most net GEX are drawn at their own price levels, sized by how much gamma they hold against the biggest wall of the day. Blue means positive gamma, red negative, and the single biggest wall in each bucket is drawn in gold with a ring in its own sign colour. Read left to right, the trail is the session's gamma history: where the walls were at 10:00, where they moved to by lunch, and whether price bounced off them. Down the right-hand edge an optional **rail** lists the ladder as it stands *right now*, every row absolutely positioned so it sits at exactly the same height as its strike on the chart. Three named levels — CORE, CW and PW — are tagged on the pane itself, and two more mark the day's frozen expected-move band. The card charts SPX, SPY, QQQ, NVDA and anything else the server prices; on SPX only, a switch swaps the cash tape for ES futures and pushes every strike through the ES−SPX basis first. Everything the card holds — a whole session of candles and a whole session of per-minute GEX ladders — is already in memory, which is why the Replay hub can scrub it on one cursor without a single extra request.

---

## File map

Line counts are `wc -l` on this tree.

| File | Lines | What it owns |
|---|---:|---|
| `src/board/gexCandles/GexCandlesCard.tsx` | 2056 | The card. Every fetch, every effect, the replay state machine and transport bar, the folded toolbar, the ⚙ Layers panel, the countdown, the status lines, the jump-to-now button, `data-capture-meta`, `SPX_ONLY_SYMBOL`, `REPLAY_BASE_MS` / `REPLAY_SPEEDS` / `REPLAY_HISTORY_MINUTES` / `REPLAY_CANDLE_DAYS`, the four ET formatters, `etWeekendSessionDay`, `newestClose`, `TransportButton`, `useEsChart`. |
| `src/board/gexCandles/chart.ts` | 1819 | `mountEsChart()` — lightweight-charts behind a dynamic import, the overlay canvas, the rAF draw loop, `viewSignature`, `saneBar` + the three doors, the forming bar and `synth`, `barAt` / `xOfTime`, `frameRecent` / `ensureLatestVisible` / `reanchorIfStranded` / `recoverView`, the CORE/CW/PW chips, the EM rails and their collision pass, the volume overlay, the axis lock, `EsChartHandle`. |
| `src/board/gexCandles/bubbles.ts` | 900 | `buildBubbleModel()` (selection and magnitude, pure), `bubbleWindowMax()`, `bucketColumns()`, `sizeFor()` / `SizeProfile`, `placeBucket()` (the size law and the fit), `drawBubbles()` (the stride, the clip, the gold leader, the peers), `shade()`, `BubblePalette`, `BubbleGeometry`. |
| `src/board/gexCandles/settings.ts` | 751 | `ChartSettings`, `DEFAULT_SETTINGS`, the frozen `BUBBLES` block, `INTERVALS`, `TAPE_DAYS`, `BubbleBucket` + `isAutoBucket`, `BUBBLE_SCALE_*` + `clampScale`, `BUBBLE_LADDER_REQUEST`, `GEX_HISTORY_MINUTES`, the `cb-v3-gex-candles:` storage key, `SETTINGS_V`, `STALE_ON_UPGRADE`, `coerce` / `loadSettings` / `saveSettings`. |
| `src/board/gexCandles/candles.ts` | 338 | `Bar`, `HISTORY_DAYS`, the ET helpers (`etMinutesOfDay`, `etDateKey`, `RTH_OPEN_MIN`, `RTH_CLOSE_MIN`), `sanitize`, `nativeInterval`, `candlesUrl` / `parseCandles`, `liveCandleUrl` / `liveStreamUrl` / `parseLiveClose`, `LIVE_FALLBACK_MS` / `LIVE_QUIET_MS`, `esCandlesUrl` / `parseEsCandles`, `rollup`, `filterSession`, `fmtCountdown`. |
| `src/board/gexCandles/GexRail.tsx` | 277 | `buildRail()` (the rows, CB/CW/PW, spot fallback, `maxAbs`), `fmtRail()`, the `TAGS` table, `<GexRail>` — the 96px column, `ROW_H` 15, `EDGE_PX` 2, the `RailSink` registration and the thinning pass. |
| `src/board/gexCandles/controls.tsx` | 261 | `Slider`, `Dropdown`, `SymbolPicker`, plus the re-export shim for `SegGroup` / `SegMenu` / `Chip` / `Popover` / `PanelSection`, which moved to `@/design/primitives/Controls` when the GEX Chart card became the second consumer. |
| `src/board/gexCandles/symbols.ts` | 152 | `SymbolDef`, the 14-symbol curated `SYMBOLS` list, `TICKER_RE`, `RETIRED`, `normalizeSymbol`, `symbolDef`, `chainTicker`, the `/api/es-candles/tickers` roster cache, `loadFavSymbols` / `saveFavSymbols` under the shared v2 key. |
| `src/board/gexCandles/gexHistory.ts` | 148 | `GexCell` / `GexColumn`, `gexHistoryUrl`, `parseGexHistory`, `valueOf`, `etDay`, `latestSession`. |
| `src/board/gexCandles/basis.ts` | 91 | `BASIS_URL`, `BasisModel`, `NO_BASIS`, `isPlausibleBasis`, `parseBasis`, `basisFor`, `shiftColumns`. |

Supporting files this card leans on:

| File | Lines | Why it matters here |
|---|---:|---|
| `src/data/dailyEm.ts` | 132 | `useDailyEm()` / `dailyEmUrl()` / `parseDailyEm()` — the frozen daily expected-move band. |
| `src/design/primitives/ChartFrame.tsx` | 211 | The mount container, the visibility predicate `handle.visible()`, and `<TvAttribution>`. |
| `src/board/catalog.tsx` | 444 | Registration, the `es-candles → gex-candles` rename, the `#n` instance-id scheme. |
| `src/design/primitives/Controls.tsx` | 647 | `SegGroup`, `SegMenu`, `Chip`, `Popover`, `PanelSection`, `Select`. |
| `src/design/primitives/ReplayDock.tsx` | 212 | The orange transport plate, portalled to the bottom of the page column *in flow*. |
| `src/design/primitives/ReplayStamp.tsx` | 178 | The in-pane replay stamp and the CB Edge wordmark. |
| `src/design/primitives/TickerPicker.tsx` | 355 | The app toolbar's own picker, reused by copies. Favourites key `cb-v3-fav-tickers`. |

### What deliberately did not come across from v2

From the header of `GexCandlesCard.tsx`: the gamma **heatmap**, EMAs, Bollinger, RSI, the profile/TPO overlays, the multi-chart dock and the screenshot pipeline. v2's `EsChartCard` is ~376KB of source; this card's whole route chunk sits under the `route` budget of **59,100 brotli bytes** in `budgets.json`. *"Only GEX bubbles is what makes the two facts compatible."*

What **did** come across: the candle colours (the same two values, now tokens), the RTH/ETH switch, the interval picker, the full bubble settings panel, the forming-bar countdown top-right, and the jump-to-current-candle button bottom-right.

---

## The data path

Everything is fired from this card's **own effect**, never by a child mounting after a parent resolved — the waterfall shape non-negotiable 3 bans. There is exactly one genuine dependency in the set (the bubble history needs an expiry), and the card guesses that parameter rather than waiting for it. See *"Don't wait on /api/expirations"* below.

### Candles — cash / ETF

```
/api/snapshots/etf-candles?symbol=<key>&days=<days>&interval=<1|5>
  → { symbol, interval, days, source, rows: [{ timestamp, open, high, low, close, volume }] }
```

* `candlesUrl(def, interval, days)` in `candles.ts`. `days` defaults to `HISTORY_DAYS` = **5**; the route clamps 1..30.
* `nativeInterval()` asks for **1 or 5 only** — 15/30/60 are rolled up client-side by `rollup()`. *"A 1h chart built from 1m rows is twelve times the payload for an identical picture."*
* Poll: `{ staleMs: 25_000, pollMs: 30_000, background: isOwner }`.
* One endpoint serves **every symbol on the board**, including SPX cash — those are recorded by `server-v2/etf-candle-recorder.js`'s hot lane (added 2026-08-27) with a dxlink-live fallback while the table fills.

### Candles — ES futures, lite

```
/api/snapshots/candles?daysBack=<days>&limit=20000&interval=<1|5>&lite=1
  → { lite: 1, cols: [...], rows: [[timestamp, date, slotKey, …], …] }
```

* `esCandlesUrl(interval, days)`. `limit` is hard-coded 20000; the route caps `limit` at 50000. `daysBack` is **inclusive of today** (`date >= cutoff`), so one request covers the window.
* **`lite=1` is not optional.** The futures route is `SELECT *` out of Postgres, so its BIGINT and REAL columns arrive as **quoted strings** unless the columnar tuple form is asked for, where the handler emits real numbers. This card only ever asks lite. `parseEsCandles` still handles the verbose row form "so a client deployed ahead of a backend that ignores `lite` still draws".
* `interval` picks the **1m or the 5m table** — they share a slotKey space and an unfiltered read returns them interleaved.
* Same `staleMs` / `pollMs` / cache contract as the ETF route, so *"the chart below cannot tell which tape it is on — which is the point."*

### `days` is widened in two cases

`const candleDays = replayOn || settings.tapeDays > 1 ? REPLAY_CANDLE_DAYS : undefined`

`REPLAY_CANDLE_DAYS` is **7** — dxFeed's practical 1m ceiling, which the etf-candles route clamps to regardless. It is simultaneously "enough to cover the oldest retained gamma session across a weekend" and "the most that can be answered". Both the replay path and the 2D/3D tape picker need it: three sessions straddling a Monday holiday reach back to a Thursday, which the default 5 calendar days does not cover. At 1D live, nothing changes.

### The live price — three transports, by symbol

**(a) SPX cash — the socket's `spot` frame.** `watchFrame<SpotFrame>('spot', …)`, gated `esCapable && !useEs && !replayOn`. Straight into `h.setLivePrice(px)`; no React state on the tick path (non-negotiable 4). The guard is `typeof px === 'number' && px > 0` — a note records that this was the one of three live-price call sites that let `0` and `NaN` through, and that it now matches the other two. Subscribing here is also what puts `spot` into the socket's derived topic scope while the card is mounted.

**(b) ES — the socket's `esCandles` / `es1mCandles` frames.** `const type = settings.interval === 1 ? 'es1mCandles' : 'esCandles'`. The payload is the candle array itself, or `{ candles: [...] }` on older emitters; a **delta frame carries only the bars that changed**, so `newestClose()` picks by **timestamp, not position**. **Never `spot` on ES** — that is the cash index, one basis below the futures, and painting it onto an ES forming bar would step the last candle down 50 points on every tick.

Deliberately **not** `useEsCandles` from `src/data/esCandles.ts`: that hook re-renders its consumer on every `esCandles` frame, and a chart re-ingesting ~7,000 1m bars per socket message is exactly the React-in-the-tick-path rule 4 bans.

**(c) Everything else — SSE, with a poll asleep underneath it.**

```
/api/snapshots/etf-candles/live/stream?symbol=<key>&interval=1&bars=1
  → text/event-stream, one `data:` frame per candle event

/api/snapshots/etf-candles/live?symbol=<key>&interval=1&bars=1
  → { interval, rows: { QQQ: [ { …, close } ] } }
```

Gated `!esCapable && !replayOn`. Note the gate is `!esCapable`, **not** `!useEs`: on SPX the socket already does this, better, and running both would paint two sources onto one bar.

* The `EventSource` is the real path. Lag is the network and nothing else; in practice ~1 update a second, which is the dxLink channel's own aggregation period (`acceptAggregationPeriod: 1` in `DxLinkClient`).
* The probe only fires after `LIVE_QUIET_MS` = **8,000ms** of silence, at `LIVE_FALLBACK_MS` = **3,000ms**. Comfortably longer than the feed's ~1s cadence *and* than EventSource's own reconnect delay (the route sends `retry: 3000`), so a healthy stream never triggers a redundant request.
* **Deliberately no `onerror` that closes the stream.** EventSource reconnects on its own; closing it here would turn one dropped connection into a permanent downgrade to polling. The poll covers the gap.
* Nothing detects whether SSE "works": if frames arrive the poll never runs; if they stop it resumes by itself.
* `visibilitychange` halts both while hidden — *"a stream's hold does not expire on its own"* — except for the owner.
* **Asking is subscribing.** The `/live` route registers interest in the symbol as a side effect and the hub drops it ~20s after the last request, so nothing needs to unsubscribe.
* `parseLiveClose(json, def.key)` returns **0 as a normal answer**, not an error: outside 04:00–20:00 ET the hub never connects, and the first request after a fresh subscribe lands before any bar has streamed. `push()` refuses it — *"setLivePrice would drag the forming bar to zero and autoscale the whole pane with it."*

### Expirations

```
/api/expirations?ticker=<chainTicker(def)>
  → { data: { items: [ { 'expiration-date': 'YYYY-MM-DD' }, … ] } }
```

`{ staleMs: 300_000 }`, no poll. **Read for its first entry only.** There is no expiry picker on this card (removed 2026-09-04); it draws the nearest expiration, always. `chainTicker()` strips the `$` — the chain routes never carry it.

### GEX history — the bubbles and the rail

```
/api/snapshots/option-strike-gex-history?mode=heatmap
  &minutes=<n>&expiry=<YYYY-MM-DD>&symbol=<gexSymbol>&top=30
  → { columns: [ { slotTs, cells: [{ strike, net, netVol }], spot, flip } ] }
```

* `{ staleMs: 30_000, pollMs: 60_000, background: isOwner }` — *"the recorder writes a column a minute, so asking more often than that returns the same ladder twice — and it is the heaviest request the card makes."*
* **The field names differ from every other GEX route.** A heatmap cell is `net` / `netVol`, **not** the `netGEX` / `netVolGEX` spelling `/api/gex` and the WebSocket `gex` frame use. Same quantities, different route. The rename is done once, in `gexHistory.ts`:
* `net` = `net_gex + net_vol_gex` (OI + today's volume)
* `netVol` = `net_vol_gex` (volume only)
* `top` = `BUBBLE_LADDER_REQUEST` = **30**. Deliberately a constant and not derived from `BUBBLES.levels`: *"asking for exactly what is drawn would mean the ranking could never see a strike it did not already pick. Ask wide, rank locally."*
* `anyExpiry=1` is **gone**. It merged every recorded expiry's ladder into each column and made the server walk all of them for the whole window on every poll.

**Two URL shapes for `minutes`.** `historyMinutes` is a memo with three branches:

| Condition | `minutes` | Why |
|---|---|---|
| `replayOn` | `REPLAY_HISTORY_MINUTES` = **5760** | The route's own clamp — asking for more is silently the same request, so this is "everything there is". The session picker can only offer days that are *in* the payload. Paid **only** on the replay tab. |
| Weekday, live | `GEX_HISTORY_MINUTES` = **720** | One full session + pre-open. |
| Sat/Sun, live | `min(5760, max(720, ceil((now − FriPreOpen)/60_000) + 60))` | 12h back from a Sunday evening lands nowhere near Friday's session. `weekendExpiry` is parsed as `T08:00:00Z` = 04:00 ET, before any session column, plus an hour of slack. |

Retention behind all of this: `option_strike_gex_history` is pruned to `GEX_HISTORY_KEEP_SESSIONS` — **three** trading sessions, env-overridable — by `pruneOptionStrikeGexHistory` in `server-v2/_lib-db.cjs`. So the replay session picker offers at most three days whatever `minutes` says, and on a Monday two of them may be Thursday and Friday. *"That is a retention decision, not a client one."*

**The URL is null'd when nothing needs it.** `gexUrl` is built only when `(settings.bubblesOn || railOn || settings.levelLabels) && expiry`. Three consumers keep it alive, and the level tags are the cheapest reason to: they read the same newest column the rail does, so a card with bubbles *and* rail off but CORE/CW/PW on still needs this request. Without that clause that combination silently drew nothing.

### The ES−SPX basis

```
/proxy/es-spx-basis
  → { basis, esClose, spxClose, date, days: { 'YYYY-MM-DD': basis, … } }
```

* `{ staleMs: 300_000, pollMs: 1_800_000 }` (5 min / 30 min), and the URL is `null` off ES — `useQuery(null)` neither fetches nor polls, so the request exists only while there is a futures chart to shift.
* **ES** ← our own `es_candles` 16:00 ET close, the very contract the chart plots, so it is roll-correct by construction. **SPX** ← Yahoo `^GSPC` daily close, independent of the broker feed.
* **Not the socket's `spot.basis` / `aux.basis`.** `src/contract/frames.ts` says why: the broker's "SPX" quote really tracks ES, so that value collapses toward zero and then freezes on the expired contract across a quarterly roll. v2 built a four-tier fallback ladder around that fact; this card keeps only the tier that was ever right. The basis decays about a point a day, so a daily anchor is not a compromise — *"a live one was the mistake."*
* `basis` is the newest session's; `days` is one value per ET session, and each **history column** is shifted by *its own* session's basis (`basisFor`), so a Friday bubble converts with Friday's number rather than today's.
* `isPlausibleBasis(b)` = `Number.isFinite(b) && b > 0 && b < 250`. ES carries a **positive** basis to SPX (rates − dividends); anything else is a data fault and is **rejected, never clamped**, because a wrong basis silently bends every level.
* `shiftColumns` moves `strike` and `spot` and leaves `net` / `netVol` untouched — *"the gamma is the gamma, only where it sits on the axis changes."* It returns the input untouched with no usable basis, so the card's "no basis" state is an **unshifted layer**, not a missing one.

**The live fallback.** When the route answers `{ basis: null }` — no 16:00 ES bar yet on a fresh table, Yahoo refusing, no `DATABASE_URL` on a dev box — the card falls back to v2's first tier: newest ES bar's close minus the live SPX spot, both off the socket, sampled together. Kept in **refs** with a once-a-minute sample (`setTimeout(sample, 1500)` then `setInterval(…, 60_000)`), not state per tick, because the shift re-buckets the whole history and the basis moves about a point a *day*. Rounded to a quarter point (`Math.round(b * 4) / 4`), and only written when it moves ≥ 0.5.

**Cash open only.** `spot` freezes at 16:00 while ES keeps trading, so overnight the difference is not a basis — it is the overnight move. The sampler returns early outside `[RTH_OPEN_MIN, RTH_CLOSE_MIN)` or on a weekend, holding whatever the last open-hours sample was.

### Daily expected move

```
/api/daily-em?ticker=<symbol>[&date=YYYY-MM-DD]
  → { ticker, date, band: { date, refClose, em, up, down, expiry, method, recordedAt } }
```

* `useDailyEm(symbol, settings.emLevels, activeDay || undefined)` — `{ staleMs: 300_000, pollMs: 300_000 }`. The chip **gates the request**, not just the layer: `enabled` false passes a null URL.
* ±1σ off the **previous session's close**, decided once this morning from the front expiry's ATM straddle and **frozen server-side** for the rest of the day (`server-v2/daily-em.js`). Read, never derived — the candles and the GEX columns carry no IV and no marks, so there is no straddle here to price, and a band recomputed client-side would slide all session as that straddle decays.
* The five-minute poll is **not about staleness** — the row never changes once written. It exists so the *first read of the day*, which is what writes the row, actually happens on a board left open overnight.
* `date` asks for a past session, read-only by construction. A replayed session that predates the table answers with no band and the rails simply do not draw. *"Hanging today's band over a rewound session would be a level that is plainly false, and false is worse than absent."*
* `parseDailyEm` requires **all three** prices (`refClose`, `em`, `up`, `down`) — *"half a level is worse than none, because it still looks like a level."*
* **Not** the GEX Chart card's `+1σ (EM)` tiles, which are the **weekly** published band off `/api/em-tracker`.

### HTTP 200 on failure

Three of these routes return **HTTP 200 with an error key and no rows** when they fail, so **nothing may branch on `res.ok` alone**:

* `/api/snapshots/etf-candles` and `/api/snapshots/candles` — stated in `candles.ts`'s header; `parseCandles` / `parseEsCandles` check for the array.
* `/api/snapshots/option-strike-gex-history` — *"EVERY failure of this route is an HTTP 200 with `{ error, rows: [] }` and no `columns` key"*; `parseGexHistory` checks `Array.isArray(cols)` and never `res.ok`.

Every parser here also treats `undefined` as **"no answer"**, not an error: `useQuery` holds `undefined` on the first render and after a failed fetch, and the card is meant to render its frame, toolbar and empty message while the data is in the air.

### The owner's chart keeps running in a background tab

`useQuery` stops polling while the tab is hidden, which is right for every customer — *"a chart nobody is looking at is egress for nothing."* It is wrong for the owner, whose chart is the **session's record**: a bubble that did not form because another tab was up for ten minutes is a ten-minute hole in it, and the catch-up poll on return does not fill a hole, it only draws the newest column. So `background: isOwner` on both polls. The browser throttles hidden timers to about once a minute, which is the recorder's own cadence, so nothing is lost to the throttle either.

---

## The bubble layer, in full

### The seven rules

From the `BUBBLES` block header in `settings.ts`:

| Rule | What it means |
|---|---|
| 1 bubble per bucket | The trail is a **sample**, not a line. Bucket to 1m or 5m by the **bar interval**; last print in the bucket wins; the zoom strides what is drawn. |
| 4–10 strikes, 1 a side | Rank by `abs(netGex)`, **force** one above spot and one below, then fill from the ranking. |
| grow with net GEX | `r = floor + sqrt(abs(gex) / windowMax) × (cap − floor)` |
| peers carry the sign | Saturated blue for positive gamma, red for negative — the ladder's first statement. |
| the top strike stands out | The bucket's largest is the one **gold** mark — a white-cored gold gradient — plus the size boost, and a ring and glow in its **own sign colour**, which is where its sign comes from. |
| old dots survive | Never below `minPx`, and age only fades opacity a little. |
| no overlap if possible | Same-bucket neighbours shrink toward the floor, then take a few px of X jitter. |
| history stays the day | Nothing is ever spliced. |

What is deliberately **not** there, so nobody adds it back: a share cutoff (with four rows the fourth-strongest strike is worth drawing by definition, so a second gate could only ever delete a row you asked for), an auto row count ("four plus a surprise is not simpler than four"), and the six sliders and Auto mode this replaced — *"a setting is a question you have to keep re-answering, and the chart has one right answer at a time."*

### Why it is stamped and not stroked

Two earlier versions drew each row as a continuous stroke and both came out as **solid bars**, for the same reason: they took their cadence from the **data**. One stroke per snapshot at a session's zoom is a thousand strokes across fifteen hundred pixels, so whatever the radius they merge — *"and a bar is a different claim than a trail. It says the level was one thing for the whole stretch, where the dots say it was sampled, repeatedly, and here is what it read each time."* Capping stroke length instead broke rows into dashes the moment the gap exceeded the radius: the same failure from the other side.

The bucket is the cadence now. The caller takes it from the **bar interval**, so the timeframe picker moves the bubbles, which is what anyone clicking it expects. The zoom decides only how many of those buckets fit, via the stride.

There is a hard physical limit stated plainly in `drawBubbles`: *"975 samples across 1,500 pixels is 1.5px each, and you cannot draw 975 distinguishable circles in that. Shrinking them does not help — two 1.2px dots 1.5px apart still touch, which is the ribbon. Neither does any size number, because the problem is not the size."*

### The bucket / stride split

These are two separate decisions and conflating them is the bug this design exists to prevent.

**The bucket** = how often a reading is taken. Owned by `reportBucket()` in `chart.ts`:

```
rung = drawOpts.bucketMin ?? (BUBBLES.bucketRungsMin.find(m => m >= barMin)
                              ?? bucketRungsMin[last])
```

`bucketRungsMin` is `[1, 5]` — **capped at 5m**, so 15m/30m/1h bars all draw a 5m bucket. *"15m and coarser buckets give a scatter of lonely dots with the session's shape missing — technically legible, useless to read."* Past 5m the answer is not a coarser bucket (which throws away prints) but the **stride** (which keeps the bucketing honest and draws every Nth). The 15/30/60 entries in `profiles` stay — a strided 5m trail is *sized* by its effective spacing, so those rungs are still reached as **sizes, never as buckets**.

`reportBucket` is called from `setIntervalMs` / `setDrawOpts`, **not from the draw loop** — the model rebuilds on the click instead of on the next frame that happens to move — and is de-duped to the value, so a no-op click costs nothing.

It used to be picked from the visible **span** and the zoom was the only thing that could move it. That made the interval picker inert: 1m → 5m left the bubbles exactly where they were, and 5m → 1m only came back once you had zoomed most of the way in, because that is when the span rule finally allowed the finer rung.

**The stride** = how many of those buckets are drawn, measured in `drawBubbles`:

```
strideTarget = pinned ? BUBBLES.pinnedPxPerDot (2.5) : BUBBLES.bucketPxPerDot (11)
stride       = pxPerDot > 0 ? max(1, ceil(strideTarget / pxPerDot)) : 1
size         = sizeFor(bucketMs * stride, pxPerDot * stride, scale)
```

`bucketMs` is the **median** of the snapshot diffs, not the mean — *"a gap in the recording (a feed outage, a weekend) is one huge diff that would otherwise claim there is far more room than there is."*

`pxPerDot` is measured **locally**, from two instants one bucket apart near the middle of the plot. The earlier span-based version was wrong in a way that only showed up zoomed in: it reported the plot's own width for a whole day of snapshots no matter how far in you were, the bucket looked a fraction of a pixel wide, and the stride threw away almost everything. Anchors are tried in order — `timeAtX(pw/2)`, then the middle snapshot, the last, the first — and the first that yields a real gap wins, so a pane whose middle is in whitespace still gets a spacing instead of falling back to stride 1.

`timeAtX` is used **only as an anchor** here; both ends of the measurement then go through `xOfTime`, the bar-anchored one the marks are placed with. Measuring with anything else would size the trail against a spacing it is not drawn at.

Nothing is faked: each drawn dot is one real bucket, last print and all. Zoom in and the stride falls back to 1 and every bucket is there again.

**`pinnedPxPerDot` must not be applied to the interval-driven default.** It was, for a few hours on 2026-08-31, on the reasoning that an interval-driven bucket is a chosen cadence too — *"and it is, but the loosened stride is a size decision, not a cadence one."* The result: every mark on the floor past a ~2h window, the size channel dead, and the `sizeCurve` / `floorOfCap` tuning that shipped the same morning completely inert because the spacing bound was what was binding.

Measured across a 770px plot: at a 2.5px target a 1m bucket gives top 1.95px / 4th 1.26px on a 2.5h window and 1.20px / 1.20px on a session. At 11px the same window gives 5.85 / 1.99 and a session 4.50 / 1.74. The spread survives.

### Per-rung size profiles

`BUBBLES.profiles`, keyed by bucket minutes. Rungs between the listed ones take the **nearest profile at or below** — *"so an unlisted bucket is never sized by a profile meant for a coarser one."*

| Rung | `capPx` | `floorPx` | `topBoost` | `ringPx` (ceiling) | `aspect` | `rankMix` |
|---:|---:|---:|---:|---:|---:|---:|
| 1m | 9 | 1.6 | 1.6 | 1.1 | **1.15** | **0.4** |
| 5m | 13 | 2.5 | 1.55 | 1.4 | 1 | 0 |
| 15m | 16 | 3 | 1.5 | 1.6 | 1 | 0 |
| 30m | 18 | 3.5 | 1.46 | 1.8 | 1 | 0 |
| 60m | 20 | 4 | 1.42 | 2 | 1 | 0 |

**`aspect` and `rankMix` are 1m-only, deliberately.** At 5m and coarser the profile cap binds first, the four rows already rank by eye, and the marks are round — *"that picture is right and is not to be touched."* Every coarser rung carries the identity values (`aspect: 1`, `rankMix: 0`), which collapse `sizeFor`/`placeBucket` back to the exact expression they were before those fields existed: a circle of radius `floorPx + ratio ** sizeCurve × (capPx − floorPx)`.

The global constants, with their tuning history:

| Constant | Value | Notes |
|---|---:|---|
| `bucketRungsMin` | `[1, 5]` | The bucket ladder. Capped at 5m. |
| `bucketPxPerDot` | **11** | The stride target. Set from the *smallest legible mark*: `2 × minLegiblePx × a typical topBoost`, plus the hairline. Below ~4.3px per drawn dot the cap has fallen to the floor and all four rows draw at 1.2px. |
| `pinnedPxPerDot` | **2.5** | Pinned buckets only. A spacing *floor*, not a legibility target. |
| `minLegiblePx` | 3.5 | The smallest radius that still reads as a mark. |
| `levels` | **4** | Rows per bucket. Design range 4–10; four is the resting value. |
| `minPerSide` | 1 | Forced above and below spot, **before** the ranking fills the rest. |
| `strikeMode` | `'per-bar'` | `'per-bar'` keeps each bucket's own picks; `'latest'` locks the Y set to the newest bucket's picks and plots those backward. |
| `sizeCurve` | **0.75** | Was 0.5 (plain sqrt), then 0.62, then 0.72 (2026-08-31), then 0.75 the same day. At 0.5 a 5%-of-max strike drew at 22% of the range and a 30% one at 55% — most of the ladder bunched in the top half. At 0.62 the 4th row drew at ~48% of cap against the top's 100%, *"and on screen that is two sizes, not four."* At 0.72 the 4th is ~39%. **0.75 is deliberately on the ceiling; do not go past it** — beyond ~0.75 the law is effectively linear again and everything below the leader collapses onto the floor. |
| `floorOfCap` | **0.14** | Was 0.45, then 0.25. At 0.45 on a wide zoom (cap ~4.6px) there was a 2.5px range between smallest and largest — under a hairline of separation once the ring is on. 0.14 (2026-08-31) is the other half of the `sizeCurve` bump. `minPx` is the hard bottom underneath. |
| `capOfSpacing` | **0.46** | The **peers'** bound on the measured gap. Was 0.28 → 0.46 on 2026-09-14. 0.28 left 44% of the spacing as empty gutter (a peer drew 0.56 of the gap), and at 1m that gutter was the whole reason marks had to be stretched vertically. At 0.46 a peer's diameter is 0.92 of the spacing — still a hairline. Geometric limit is 0.5; this is deliberately under it. Bounds the peers **only**. |
| `topOfSpacing` | **0.56** | The **leader's** share. Was 0.44 (2026-08-31), raised because the leader is the row the spacing clips first and the boost was being thrown away — at 0.44 the ratio to `capOfSpacing` is 1.57, finally matching the profiles' own `topBoost`. **0.56 (2026-09-14) is past the geometric limit on purpose**: a leader's diameter is ~1.12 of the spacing, so consecutive leaders overlap by about a tenth of their width. That was the ask — bubbles rather than ovals, a little overlap acceptable — and it is the leader **row only**, four marks' worth of gold. The ratio to `capOfSpacing` stays 1.22 so `topBoost` still lands. |
| `minPx` | 1.2 | Absolute floor. Old dots never shrink past this, whatever the fit does. |
| `gapPx` | 0.8 | Hairline kept between two marks in the same bucket. |
| `fitPasses` | 6 | Passes of the pairwise vertical shrink before jitter. |
| `jitterPx` | 3 | Max horizontal nudge for a pair that still does not fit. |
| `ringOfRadius` | **0.13** | The leader's ring width is this × the mark's half-width, clamped into `[ringMinPx, profile.ringPx]`. `ringPx` is therefore the **ceiling, not the width**. |
| `ringMinPx` | 0.45 | *"Under about a third of a pixel a stroke stops being a line and becomes a grey blur along the edge, and the sign — which on the leader lives ONLY in this ring — goes with it."* |
| `fade` | 0.45 | The weakest mark fades to `1 − fade`. |
| `ageKeep` | 0.75 | The oldest bucket keeps this much of its opacity. *"A trail that fades to nothing is a trail you cannot read the morning off, and the morning is half of why it is drawn."* |
| `glowFactor` | 0.6 | Ceiling: blur ≤ `rx × glowFactor`. |
| `glowMaxPx` | 7 | Ceiling. |
| `glowAlpha` | 0.6 | Was an un-named 0.95 in the draw call. At 0.95, under a core the age fade had made translucent, the halo showed **through** the mark — *"which is how the negative leader came to look like a red dot with a white outline."* Also multiplied by age now. |

`aspect` history, in its own words: it was **2.4**, reduced to **1.15** on 2026-09-14. *"2.4 was answering a spacing of ~3.4px that the STRIDE no longer lets happen … What it drew was a column of tall tick marks — 6px wide and 15px high on a 2.5h window — which is the vertical-BARS failure the paragraph above warns about, reached from the other side."*

`rankMix` is **0.4 and not more**: *"past about half the budget a mark stops reporting magnitude and starts reporting only its position in a list."* The marks are sorted by net GEX magnitude first and the blend is monotone in the rank, so the **order never changes**.

### The size law and the fit

```
t  = (1 − rankMix) × (abs(gex) / windowMax) ** sizeCurve  +  rankMix × rank
rx = floorPx  + t × (capPx  − floorPx),   × boost, capped at topCapPx
ry = floorYPx + t × (capYPx − floorYPx),  × boost, capped at topCapYPx
```

where `rank = 1 − i/n` for the bucket's i-th row (marks arrive biggest-first, so the index **is** the rank: 1st..4th → 1, .75, .5, .25).

`rx` and `ry` come off the **same `t`** and differ only in their budgets. One `t` for both keeps a mark's shape constant as it grows — *"the alternative, sizing each axis from its own curve, makes the small marks a different SHAPE from the big ones and the ladder stops reading as one family of marks."*

**Two budgets, because only one axis is crowded.** `capPx`/`floorPx`/`topCapPx` are the **horizontal half-width**, and the bucket spacing is the only thing a mark can fuse across. `capYPx`/`floorYPx`/`topCapYPx` are the vertical half-height, which the spacing has nothing to say about: two strikes in a bucket are tens of pixels apart on the price axis, and `placeBucket`'s fit pass already guarantees the ones that are not clear each other.

`sizeFor()` in four steps:

1. The rung's own **profile** (a 13px cap is right at 5m and absurd at 1m).
2. Shrunk to the room that actually exists: `room = capOfSpacing × pxPerDot × scale`, `capPx = max(minPx, min(profile.capPx × scale, room))`. It only ever shrinks — inert at the intended zoom, and at 1m across a whole session it turns fused ribbons into a fine dotted trail.
3. **The user's multiplier** (`scale`, the Bubble size slider) multiplies **both sides of the min** — the profile cap *and* the share of the spacing — rather than the finished radius. *"Scaling the answer would let the spacing bound silently eat the whole adjustment at a tight zoom, so the slider would do nothing exactly where someone reaches for it."* Inert at 1 by construction.
4. The vertical budget, unshrunk, capped only against the horizontal one by the rung's `aspect`.

The **glow gets what is left over, which is often nothing**: `spare = pxPerDot/2 − topCapPx`. *"This was the real reason the leader's row looked like one continuous sausage rather than a row of dots: the marks themselves were clearing each other by a pixel or two, and then a 7px gaussian halo painted straight across the gap. Blur is not free real estate."* At `topOfSpacing: 0.56` that spare is zero — *"the marks get the room, not the halo."*

**The fit**, in `placeBucket`, after sizing:

1. Sort rows by `y`.
2. `fitPasses` (6) passes of pairwise **vertical** shrink: for each adjacent pair, `room = b.y − a.y − gapPx`; if `a.ry + b.ry > room`, scale both by `room/sum`, floored at `minPx`. Break early when nothing tightened. Deliberately spends `ry` only — *"shrinking rx here would give back width that was never the problem."*
3. `row.rx = min(row.rx, row.ry)` — a mark is never wider than it is tall. A hard vertical squeeze can push `ry` under `rx`, *"and a wide flat dot is the shape this whole change is getting away from."*
4. Anything still colliding at the floor takes `±jitterPx` (3) of X, in alternating directions.

Nothing is ever dropped and nothing goes below `minPx`. *"Better a dot nudged off its minute than two levels drawn as one blob, and at this cadence a 3px nudge is well inside the bucket it belongs to."*

**No dwell, no hysteresis, no smoothing.** Every one of those was a patch for the continuous renderer, where a strike dropping out for a print left a visible hole in a line. *"A dot that is not there for one bucket is just a gap in a chain of dots, which is what a sample looks like — and `strikeMode` is the real answer to 'keep the level on the axis'."*

### `windowMax` and why replay overrides it

`ratio` = mark magnitude over `windowMax`, clamped 0..1, and it is what sets the radius. **One denominator for every mark on screen.** Per bucket it would renormalise every quiet minute back up to full size, *"which is what made the trail bulge and pinch instead of tapering."*

`bubbleWindowMax(columns, opts)` takes the max magnitude over the **bucketed** set — the same set the model will draw — rather than over the raw columns, *"a denominator taken over the raw columns instead would count a print the dedup is about to discard, and the two would disagree by a hair on exactly the busiest minute."*

Live, the columns **are** the window and the model's own pass is right.

Under **replay** they are not. The card clips its columns to the cursor, so the default denominator would be "the biggest wall revealed **so far**" — and the moment the cursor steps onto a bucket carrying a bigger one, **every dot already on the pane shrinks in that frame**. At 1× that reads as the trail breathing; at 8×, with a frame every ~90ms, it is the reported jitter, and it lands exactly where the session's running maximum steps up rather than evenly across the day.

So the card computes it over the **whole session being replayed** and passes it in:

```ts
const bubbleDenominator = useMemo(
  () => replayOn && sessionColumns.length
    ? bubbleWindowMax(sessionColumns, { metric: settings.gexMetric, bucketMs })
    : null,
  [replayOn, sessionColumns, settings.gexMetric, bucketMs],
)
```

`sessionColumns` is the session **whole**; `columns` is that clipped to the cursor. Everything that *draws* reads the clipped one — a rewound chart must never leak the future — and the one thing that must not be clipped is the denominator, *"which is a property of the day rather than of the cursor."* The result: a dot's size means "this bucket's share of the day", *"which is the reading it was always supposed to have and the one it only actually had at the close."*

Null / 0 / absent = derive from `columns`, which is the live path.

### Bar-anchored placement, and the two bugs it replaced

`BubbleGeometry.xOfTime(ms)` is **the alignment contract**. A bucket's x must be the x of its **candle**: four bubbles over four candles have to sit on those four candles, not between them.

```ts
xOfTime: (ms) => {
  const start = barAt(ms)                       // the bar CONTAINING ms
  if (start == null) return null
  const c0 = ts.timeToCoordinate(start/1000)    // that bar's CENTRE
  if (c0 == null) return null
  const frac = clamp((ms - start) / intervalMs, 0, 1)
  return c0 + frac * barSpacing
}
```

**Bug 1 — the binary search, off by half a bar, every mark, always.** There used to be a `timeWindow()` + `xAtTime()` pair in `bubbles.ts`: probe the plot for the x-range where `timeAtX()` answers, then binary-search that range for the x whose time is the bucket's. `timeAtX()` is `coordinateToTime()`, and that is a **step function** — it reports the *nearest* bar's time, so it holds one value across a whole bar and jumps at the boundary. A binary search on `t < ms` cannot land in the middle of a step; it converges on the step itself, **which sits at the midpoint between two bar centres**. Every bucket was stamped on the seam between its candle and the one before it.

**Bug 2 — plain `timeToCoordinate(ms)`.** It answers only for timestamps that are literally *in* the series; it does not interpolate. The GEX history is per **minute** while the candles are 5m or coarser, so a bucket almost never lands on a bar and **the layer vanished intermittently** on nothing more than whether it did. *"Do not 'simplify' this back to `timeToCoordinate(ms)`."*

`barAt(ms)` is a binary search over `barTimes` — the **real** array the series was given, plus the forming bar, never arithmetic off `intervalMs`, because 15m and coarser anchor to 09:30 ET, the RTH close forces a short bar at 15:30, and any gap in the feed leaves a hole. *"A computed timestamp under any of those is not a bar, and `timeToCoordinate()` answers null for it — which is how a whole overlay disappears with no error anywhere."*

**Past the end is not "the last bar."** `barAt` returns null before the first bar and beyond `barTimes[n-1] + 2 × intervalMs`. **Two bars of slack, not zero** — a GEX minute can legitimately arrive before the candle feed has printed the bar it belongs to, *"and culling the newest column every time the candles lag is a worse bug than the one this prevents."* Without the upper bound every later bucket would clamp onto the closing bar and draw as a real print.

Null off the ends means **not drawn** — that is what stops a stale morning of GEX being stacked onto the closing bar, or a column of bubbles floating in the whitespace right of the newest candle. Null is **not** returned merely for being scrolled off screen: the coordinate is real and negative (or past the width), and the draw culls it at `x < -40 || x > pw + 40`, which keeps a panned-away bucket from being pinned to an edge.

### The global overlap fit, and the clip

Marks are **clipped to the plot**, not to the canvas:

```
pw = max(1, min(geo.plotWidth,  w))
ph = max(1, min(geo.plotHeight, h))
ctx.save(); ctx.beginPath(); ctx.rect(0,0,pw,ph); ctx.clip()
```

The overlay spans the whole card and the plot does not — the price scale owns the right ~60px and the time axis the bottom ~26px — and `coordinateToTime()` keeps answering for an x already underneath the price scale, because *"it is index arithmetic, not a hit test."* Probing the canvas width put the window's right edge out in the axis gutter and **the newest buckets were stamped straight over the price labels**. Clipping rather than dropping, *"so the edge dot is cut off by the axis the way it is in every other chart, instead of vanishing a bucket early."*

Vertical cull: `if (y < -20 || y > ph + 20) continue`.

Age fade: `age = ageKeep + (1 − ageKeep) × ((snap.ts − first.ts) / span)`. Peer alpha: `(minOpacity + ratio × (1 − minOpacity)) × age`, where `minOpacity = 1 − fade`. Leader alpha: `1 × age`.

### The colour rules

`shade(c, a)` emits **8-digit hex** `#rrggbbaa`, never `rgba()`/`hsla()` — those are banned from `src/` by `scripts/check-theme.mjs` (non-negotiable 1), and the hex form is accepted by every canvas fill, stroke, shadow and gradient stop. Same reasoning and same output as `tokenHexAlpha()` in `src/design/theme.ts`; this one takes the channels the palette already carries rather than re-reading a token per mark, *"because it runs inside the chart's rAF for every bubble on screen."*

The palette is read once at mount by `hexToRgb(cssVar(container, …), fallback)`:

| Palette slot | Token | Value **in this tree's `tokens.css`** | Role |
|---|---|---|---|
| `pos` | `--color-gex-pos` | `#4d8cff` | Peers' fill when `value >= 0`; the leader's **ring** and **glow** when positive. |
| `neg` | `--color-gex-neg` | `#ff5fa2` | Peers' fill when negative; the leader's ring and glow when negative. |
| `lead` | `--color-gex-lead` | `#ffd166` | The leader's gradient **rim**. |
| `leadHi` | `--color-gex-lead-hi` | `color-mix(in srgb, #ffd166 65%, #e7ece9)` | The gradient's **mid-stop**. |
| `highlight` | `--color-fg` | `#e7ece9` | The gradient's **innermost** stop — the specular highlight. A token, not a hardcoded white, *"so a light theme can move it with everything else."* |

> **Note on the source comments.** The block comment above `BubblePalette` in
> `bubbles.ts` and the `hexToRgb` fallbacks in `chart.ts` quote `#29b6f6` /
> `#ff4757` / `#ffb300` / `#ffd76a`. Those are the **numeric fallbacks and a
> stale comment**, not what renders. `tokens.css` in this tree declares
> `--color-gex-pos: #4d8cff`, `--color-gex-neg: #ff5fa2`,
> `--color-gex-lead: #ffd166`. The fallbacks only fire if the stylesheet failed
> to load. The tokens are the truth; `cssVar()` carries no *string* fallback at
> all (see the chart-shell section).

**Peers carry the sign.** Flat, saturated, at full strength. Blue is positive gamma, red is negative, *"and that is the first thing the ladder has to say."*

**The leader is gold.** A radial gradient built in the **mark's own space**: `translate(cx,y)`, `scale(1, ry/rx)`, arc of radius `rx`, gradient from `(-rx*0.24, -rx*0.3, rx*0.05)` to `(0, 0, rx)`, stops at 0 / 0.5 / 1 = `highlight` / `leadHi` / `lead`. *"Painting it in canvas coordinates makes it circular while the mark is an oval, so at 1m the rim colour lands at the top and bottom of a tall mark and never reaches its sides."* The path survives `restore()`, so the ring below strokes at a uniform width instead of being squashed with it.

Gold because gold already means "the wall" everywhere else on this card — the CB tag on the rail (`--color-level-cb: #ffd166`, the same value), the amber half of the GEX bars (`--color-gexbar-neg: #ffd166`). One hue, one idea.

**The ring is the sign, and it is a proportion.** The core carries no sign now, so the ring is the only thing saying whether the biggest wall is positive or negative gamma — which is why it is the saturated colour at `0.95 × age` and not a tint.

```
ring = clamp(rx * BUBBLES.ringOfRadius, BUBBLES.ringMinPx, size.ringPx)
```

`ringPx` used to be the width outright, and `profiles` is keyed by **rung**, so it did not move when the **zoom** did. Zoomed in, 1.4px on a 40px mark is the fine gold-coin edge this was tuned for. Zoomed out, the same 1.4px sits on a 5px mark: the ring is a third of the diameter, the gold core is a speck, *"and the whole trail reads as a row of red and blue beads. The mark shrank and the border did not."*

**Drawn inset by half its width.** A stroke straddles its path, so stroking the fill's own outline both ate the outer band of gold *and* grew the mark by half the ring width. The ellipse is drawn at `rx − ring/2`, `ry − ring/2` (floored at 0.3) so the mark keeps the exact radius the size law gave it.

**The glow** is the sign colour at `glowAlpha × age`, blur `min(size.glowPx, rx × glowFactor)`, measured off the **width**: *"the room it has to spread into is the gap to the next bucket, which is the bound `rx` already carries. Sizing it off the taller axis would put the halo back across that gap, which is what fused the leader's row into a sausage."*

**Two things were tried and are not to be repeated**, both failing at the small end where rows 2–4 draw at 2–4px:

* **Gold on every mark with a sign ring** (mocked 2026-09-03) — a gold fill with a 0.7px sign ring is *"an olive smudge at that size — the sign is simply gone."*
* **The pale sign tints on every mark** (2026-08-31, reverted the same day) — the tints desaturate toward the background and *"a pale pink 2px dot is not distinguishable from a pale blue one."*

The leader's own pale tint (`--color-gex-pos-hot` / `-neg-hot`, `#c8f5ff` / `#ffcdd2`, deleted 2026-09-03) went with the gold change, along with the `topTint` that pushed it whiter. Both tints were near-white and near-identical to each other at 3px, *"so the core said 'leader' but never said which way — the ring was already doing that work alone. Do not go back to it."*

### Strike selection

`pick(col)` forces the two sides **first**, not by swapping in afterwards:

```
ranked = cells.map(strike, valueOf(cell, metric)).filter(v !== 0)
               .sort(by magnitude desc)
for i in 0..minPerSide-1:
   take first unspent ranked strike with strike >= spot
   take first unspent ranked strike with strike <  spot
then fill from `ranked` until out.length === levels
```

*"Gamma is routinely lopsided enough that every top strike sits on one side of price, and a chart of only the resistance overhead is half a picture — so the two sides are taken before the ranking gets to spend the remaining slots, which it does purely on net-GEX magnitude and without caring which side they land on."*

`spotOf(col)` falls back to the midpoint of the strike range when `col.spot` is 0 (legacy rows) — the recorder centres the ladder on spot, so the middle of it is the honest fallback. The rail makes the same fallback for the same reason.

`bucketColumns()` keeps **one column per bucket, last print wins** — not a mean. *"The bucket is a SAMPLE of the board — 'this is what it read at 10:35' — and averaging five minutes of a wall being built smears exactly the move the dot exists to show."*

`isTop` is tagged once per bucket, so a tie does not paint two gold marks.

---

## The GEX rail

### Shape

A 96px column (`w-[96px] shrink-0 overflow-hidden border-l border-line pl-1.5`) sitting as a **sibling** of the chart inside one flex row. Each row is: a fixed 22px tag slot, then a single **left-anchored bar that always grows right**, one strike per line.

The strike price and the dollar value are **deliberately absent** — *"the chart's own price axis already labels the height, and the bar's length already says the size, so printing either again is noise in a 96px column."* Sign survives in the bar's colour (`--color-gex-pos` / `--color-gex-neg`). The exact figure is the row's hover `title`, formatted by `fmtRail()` as `+1.2B` / `−340M` / `—`.

**One direction.** Every bar is anchored to the same left edge and grows right, positive or negative — the centre hairline is gone, *"so the full width is spent on magnitude and the eye compares lengths off one baseline instead of two."* Width is `max(2, magnitude/maxAbs × 100)%`.

**The tag is the only thing that marks a level** — no row wash, no bar outline, no glow. A strike can be two levels at once and each gets its own tag.

### The three levels

`buildRail(columns, metric)` reads the **newest column** of the same history the bubbles are built from — one fetch, two views of it. *"The bubbles say how the ladder got here over the session; the rail says where it stands right now."*

| Tag | Name | How it is picked | Token |
|---|---|---|---|
| `CB` | Core Bullseye — *"Core — biggest magnet"* | The strike with the largest magnitude on the ladder. | `--color-level-cb` `#ffd166` |
| `CW` | Call wall — *"Call wall — ceiling"* | Largest **positive** value among strikes `> spot`, **CB excluded**. | `--color-level-cw` `#4d8cff` |
| `PW` | Put wall — *"Put wall — floor"* | Most **negative** value among strikes `< spot`, **CB excluded**. | `--color-level-pw` `#ff5fa2` |

**CB is excluded before the walls are picked** — the same rule the Multi Greek ladder follows: *"the biggest node on the board is frequently also the biggest on one side of spot, and without this the core and the wall land on one strike — losing the level price actually has to get through after it."*

Tag ink is `var(--color-level-<key>)` as background with `var(--color-app)` (`#0a0d10`) as text, so the tag reads as a **filled label** rather than as coloured text on a chart. Named tags, not anonymous dots: *"three dot colours is a legend to memorise; 'CB' is not."* The 22px slot keeps its width whether or not the strike is tagged, so every bar starts on the same x.

### Why the rows are absolutely positioned

*"A rail beside a chart is only worth anything if a strike's row sits at the same height as that strike on the chart. A normal flowing list cannot do that: its rows are evenly spaced and the chart's are not — the price scale autoscales, the user pans and zooms, and the gap between two strikes in pixels changes constantly."*

So every row is `position: absolute`, and its `top` comes from the chart's own `priceToCoordinate`, delivered **once per animation frame** through the same `RailSink` the chart runs its bubble layer from. Same mapping, same frame — *"the rail cannot drift from the bubbles or the candles because it is reading the number they were drawn with."*

That positioning is **imperative, straight onto the DOM node**. Rule 4: a tick never travels through React state on its way to a chart, and a pan gesture is sixty ticks a second.

The chart/rail pairing is **one flex row** in the card, so the rail is a sibling with the same top and the same height: *"a rail nested inside the chart's own box would be under the crosshair and the pan handler, and one offset a padding change away from lying about every strike."*

### The RailSink

```ts
export type RailSink = (yOfPrice: (price: number) => number | null, height: number) => void
```

Registered with `applyChart(h => h.setRailSink(sink))` and cleared with `setRailSink(null)` on unmount. **Called before the bubble early-returns** in `draw()` — the rail is a separate layer with its own switch and *"must keep tracking the price scale on a chart whose bubbles are off, or have no history yet."*

The height handed over is the **plot's** (`plotH`), not the container's: the time axis owns the bottom ~26px and there is no price down there. *"Passing the container height would let the rail park a strike below the lowest candle, level with the clock — which is exactly the kind of 'close enough' alignment the rail exists to not do."* The bubble canvas below still uses the full container height, because it draws inside the chart's own box and lightweight-charts clips it.

A sink **must not set React state** — it runs 60 times a second.

Two write-elision guards, because *"a write per row per frame is sixty style invalidations a second for a rail that mostly is not moving"*:

* `transform` is `translateY(Math.round(y − ROW_H/2)px)`, **rounded** so text does not land on a half pixel and blur, and compared against the value already on the node before writing.
* `visibility` likewise.

Rows start at `visibility: hidden` with no transform *"otherwise every row paints stacked at the top of the rail for one frame on mount."* `willChange: transform`.

A second effect prunes `nodes.current` of strikes that left the ladder — *"or the sink keeps positioning a detached node forever."*

### The thinning pass

The ladder holds ~30 strikes (`BUBBLE_LADDER_REQUEST`). Zoomed out they can land within a pixel of each other, *"and a rail of overlapping text is worse than no rail."*

Rows are placed in **priority order**, held in `orderRef` and rebuilt by a memo:

1. The three named levels (CB, CW, PW), in that order — *"so a squeeze can never be what hides the core."*
2. Everything else, biggest magnitude first.

Then for each strike in order:

* `y = yOfPrice(strike)`; drop if null, or within `EDGE_PX` (2) of the pane's top or bottom.
* Drop if the vertical distance to **any** already-placed row is under `ROW_H` (15).
* Otherwise place it and push its `y`.

*"So what survives a squeeze is always the part worth reading, and it is still the case that every row you can see is exactly level with its strike."*

Empty state: `No ladder yet` — a `text-2xs text-muted opacity-50` span at the top of the column when `rows.length === 0`.

---

## On-pane levels

### CORE / CW / PW tags

`h.setLevels(settings.levelLabels ? railModel.levels : null)`. **`railModel.levels`, not a second calculation** — the tags on the chart and the tags on the rail are the same three strikes off the same newest column, *"so they cannot disagree — and on ES they are already through the basis, because `columns` is shifted upstream of both consumers."*

Drawn **above** the bubble early-return in `draw()`, so they survive the bubbles being switched off. *"The card that has turned the bubbles off is exactly the one that still wants the three levels."*

A **tag only — no line**. Left edge, not right: *"the price scale is on the right and the rail after it, so a tag over there would sit on the axis labels and beside a rail row saying the same thing."*

The label is `CORE` (not `CB`), `CW`, `PW`, and the chip text is `` `${label} ${price.toFixed(2)}` `` — **the same 2dp the price scale uses**, so the tag and the axis cannot read as two different numbers. Font `700 9px ui-sans-serif, system-ui, sans-serif`; chip is `fillRect(2, y−6, tw+6, 12)` in the level ink with `--color-app` text at `(5, y+0.5)`.

`y = Math.round(yRaw) + 0.5` — half-pixel, *"so a 1px line is one crisp row rather than two grey ones."* Clipped to `rect(0, 0, plotW, plotH)`: *"below plotH is the time axis, where a level line would be drawing across the clock."*

**The dashed hairline that used to run with each tag is gone.** Three of them across a pane already carrying candles, bubbles and a heatmap was three more horizontals competing with the price action, *"and none of them said anything the tag does not: the tag sits AT the level, so the height is the line."* What the line did carry, and the tag did not, was the **number** — so the price rides in the tag now and the line is not needed to connect them.

A level the ladder does not currently have is `null` and **draws nothing**; it never draws at 0. Levels at or below zero are skipped.

### The daily expected-move rails

`h.setEmBand(settings.emLevels ? emDrawn : null, settings.emLines)`.

Labels `EM+` and `EM−`, same chip shape, same font, same 2dp, same left margin, *"so the pane has ONE column of labels to read rather than two facing each other across it. Colour is what separates the families."*

Ink is `--color-level-em` = `color-mix(in srgb, #b48cff 72%, #e7ece9)` — **one token for both rails on purpose**: *"they are the two edges of ONE symmetric band, and painting them up-green and down-red would read as direction where there is none by construction."* Violet is the one family this pane is not already spending — the walls own blue and red, the core gold, the candles green and red.

**The basis, applied here and nowhere else.** The band is quoted in SPX **cash** and an ES pane plots futures 40–60 points above it:

```ts
const emDrawn = useMemo(() => {
  if (!emBand) return null
  const shift = useEs && isPlausibleBasis(basis.basis) ? basis.basis : 0
  return { up: emBand.up + shift, down: emBand.down + shift, date: emBand.date }
}, [emBand, useEs, basis])
```

*"The same bug `shiftColumns` exists to prevent for strikes, and the one v2 lost a fortnight to in July 2026."* The walls get their shift upstream in `columns`; this band arrives from its own route and has to be shifted here. **Today's basis**, not a per-day lookup — the band is one session's, so there is only ever one session to convert. The chart itself cannot do it: *"it does not know the basis."*

### Chip collision handling

Both families live on the **left** edge, so the EM block has to know where the wall chips landed. Every chip the CORE/CW/PW pass draws records `{ y, right }` into `chipRows`; the EM block reads it:

```ts
let chipX = 2
for (const r of chipRows) {
  if (Math.abs(r.y - y) < CHIP_H /* 12 */) chipX = Math.max(chipX, r.right + 3)
}
if (chipX + chipW > plotW - 2) chipX = 2
```

*"That is not rare on purpose: the call wall sitting on the EM high IS the day's setup, and it is the one moment this layer must not turn into one chip drawn over another. So a chip that would overlap slides right, past the far edge of whatever is already there, and stays on its own line."*

**It never moves vertically:** *"the height is the price, and a tag nudged off its level is a tag that lies."*

The EM pass pushes its own chips into `chipRows` too, for the zoom level where the two rails are a few pixels apart.

A chip pushed clean off the pane falls **back to the margin and overlaps**, because *"it clips to a coloured stub carrying no number"* otherwise.

**The line is optional and the walls' never come back.** An EM rail is a **boundary**, and the use of one is watching price travel toward it, stall under it or go through it — *"a reading that wants the line carried across the session. There are two of them, at the extremes of the day rather than in the thick of it, at a third of the ink."* That is an argument for **offering** the line, not for forcing it, hence `emLines`.

When on: `setLineDash([3, 4])`, `globalAlpha 0.45`, `lineWidth 1`, from `chipX + chipW + 4` to `plotW`. The line **starts after the chip** — *"a dashed rule crossing its own label is the one place this layer could look like a rendering fault."* Off, the EM marks are drawn exactly like CORE/CW/PW.

---

## The chart shell

`mountEsChart(container, mountOpts)` — one async function, `lightweight-charts` behind a **dynamic import** *"so the library lands in its own route chunk and the entry bundle every other card pays for on first paint never sees it."*

### The colour rule, and `cssVar` with no fallback

Colours are read out of `tokens.css` at mount time with `getComputedStyle`. The "no colour literals in `src/`" rule applies here as much as anywhere; it is just enforced at runtime instead of by Tailwind, *"because a charting library takes colour STRINGS, not classNames."*

```ts
function cssVar(el: HTMLElement, name: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  if (!v) console.warn(`[gexCandles] design token ${name} resolved empty — declare it in src/design/tokens.css`)
  return v
}
```

**No literal fallback, deliberately.** Every token read here is declared on `:root`, so a hex second argument could only ever fire if the stylesheet failed to load — *"at which point the whole app is unstyled and a correct GEX-bubble blue is not the problem."* What the fallbacks **did** do was duplicate the palette in a second place that nothing keeps in sync: *"a theme edit moved the token and left thirteen stale hexes behind it, which is exactly the drift Non-negotiable #1 exists to prevent."*

An empty return is a real bug, not a supported mode, so it warns. Canvas ignores an invalid `fillStyle`/`strokeStyle` and lightweight-charts falls back to its own default, so nothing throws while the warning is on screen.

`hexToRgb` keeps its numeric fallback **because an `[r,g,b]` triple is not a colour literal, it is the arithmetic the canvas API takes** — the bubble layer needs three numbers to build a per-mark alpha with and cannot use an empty string at all.

Tokens read at mount: `--color-line`, `--color-muted`, `--color-candle-up` (`#3ddc8e`), `--color-candle-down` (`#ff6b7a`), the five bubble-palette tokens, `--color-level-cb` / `-cw` / `-pw`, `--color-level-em`, `--color-app`.

Volume ink comes through `tokenHexAlpha('--color-candle-up', 0.34)` — *"not a hand-written functional colour notation: that notation is banned from src/ by scripts/check-theme.mjs."*

### Chart options

| Option | Value | Why |
|---|---|---|
| `layout.background` | `Solid, 'transparent'` | The card's own surface shows through. |
| `layout.textColor` | `--color-muted` | |
| `layout.fontSize` | `11` | Off the type scale (`text-xs`). |
| `layout.attributionLogo` | **`false`** | The library draws its TradingView mark **inside** the pane, bottom left — over the candles, over the bubble layer, and in every CopyShot. Turned off here and re-rendered in the **card header** by `<TvAttribution>`. **It must stay somewhere and visible — that is the library's licence, not a style choice.** *"Do not delete this line without deleting the header link too, or the chart quietly ends up with no attribution at all."* |
| `grid` | both `visible: false` | *"The bubble layer is the thing being read against price, and a ruled background competes with it — a horizontal line through a column of marks reads as a level, which is exactly the signal the bubbles carry."* The axis borders stay: they frame the plot, they do not cross it. |
| `rightPriceScale` | `visible: true, borderColor: line` | |
| `leftPriceScale` | `visible: false` | |
| `timeScale.timeVisible` | `true`, `secondsVisible: false` | |
| `timeScale.tickMarkFormatter` | ET | *"The session boundaries this chart is read against are ET. A browser-local axis would put 09:30 at a different number for every user."* `tickMarkType <= 2` → `MMM d`, else `HH:mm` 24h. |
| `crosshair.mode` | `CrosshairMode.Normal` | |
| `localization.priceFormatter` | `price.toFixed(2)` | The 2dp the level chips match. |
| `localization.timeFormatter` | ET `hh:mm` | |
| `autoSize` | `true` | |

Candle series: `upColor`/`downColor`/`borderUpColor`/`borderDownColor`/ `wickUpColor`/`wickDownColor` all off the two candle tokens (carried across from v2 **verbatim** — *"the exact same candle colour was the requirement"*), `borderVisible: true`, `baseLineVisible: false`, `priceLineVisible: false` at mount (see `setSpotLine`).

### The volume overlay

An **overlay histogram on its own price scale**, `priceScaleId: VOL_SCALE` (`'vol'`) — *"any id that is not 'right' or 'left' makes lightweight-charts treat the series as an overlay with an independent scale — which is the whole trick: the candles keep their axis untouched."*

**Not a second pane.** A pane would take height from the candles and — the real problem — *"put the bubble overlay's single canvas across two panes with two coordinate systems, so every mark would be placed against whichever one `yOfPrice` happened to read. One pane, one scale, one set of coordinates."*

| Constant | Value | Role |
|---|---:|---|
| `VOL_SCALE` | `'vol'` | The overlay scale id. |
| `VOL_TOP` | `0.8` | The vol scale's top margin — the strip is the bottom fifth. |
| `VOL_CANDLE_BOTTOM` | `0.24` | Bottom margin the **candle** scale takes while the strip shows. |
| `VOL_ALPHA` | `0.34` | *"Volume bars sit UNDER the price action, so they are washed well back."* |
| `CANDLE_TOP` | `0.08` | The candle scale's top margin, and its bottom margin when volume is off. |

`visible: false` at mount, because *"the card calls `setVolume()` with the stored setting on the same tick it calls `setBars`, so starting hidden avoids a frame of full-height bars before the margin below is applied."*

Volume rides the **same filtered list** the series gets, so a bar the poll dropped leaves no orphan histogram bar. Coloured by the bar's **own direction** (`b.c >= b.o`), not by the previous close — *"this is the candle's volume, and it should agree with the candle drawn above it."*

**Deliberately not updated by `setLivePrice`**: the live probe carries a price, not a size, so an invented forming bar has no volume and the strip simply has no bar there until the poll publishes one. *"A made up size would be worse than a gap."*

`setVolume` takes **no `version++`** — both series are the library's own and the bubble canvas re-reads the price scale every frame, so it follows the new margin without being told.

### `saneBar` and the three doors

```
const SANE_RANGE = 0.25

function saneBar({open, high, low, close}) {
  if (!(close > 0) || !(open > 0) || !(high > 0) || !(low > 0)) return false
  if (!Number.isFinite(open + high + low + close)) return false
  if (high < Math.max(open, close) || low > Math.min(open, close)) return false
  return high - low <= close * SANE_RANGE
}
```

`candles.ts`'s `sanitize` already refuses a bar with a zero in it, and every producer of a live price already refuses a non-positive one — *"and the pane STILL autoscaled 0–8000 with one wick running from price to the floor, on a symbol switch, repeatedly. So the guard is in the wrong PLACE: it is at the parse boundary, and the failure is downstream of it."*

There are **three ways into the series**, and each one takes the check:

1. **`setBars` → the history.** `const drawn = bars.filter(b => saneBar(…))`. ONE filtered list, and *everything* below is built from it — the series, the volume strip, `barTimes`, `barCount` and `live`. Filtering into a local rather than at each use is the point: *"the bubble layer places every bucket by index against `barTimes`, so a list that disagreed with the series by even one bar would put every mark after it on the wrong candle."*
2. **`pushLive`**, the only way the forming bar reaches the series. Both `series.update` call sites go through it.
3. **`setLivePrice`'s own proximity test**, before it touches `live` at all: `if (Math.abs(price - live.close) > live.close * SANE_RANGE) return`. *"`price > 0` was the whole test, and 'positive' is a much weaker claim than 'belongs here'."* The prints that get through are the ones that are positive and **wrong** — a quote for the symbol that was on screen a moment ago, a stale frame after a switch, a feed emitting a fraction of a price.

Anything failing is **dropped, not clamped**: *"a bar we cannot vouch for is one the next poll will publish correctly a few seconds later, and drawing a repaired guess is how a fault becomes invisible instead of fixed."* The cost of one bad bar is the whole chart — *"the pane is ~600px, the range becomes 0–8000, and a 60-point day is seven pixels of that."*

`warnOnce(state, where, bar)` — **once per chart per door**, with the offending bar. Separate states for `barWarn` and `liveWarn` *"so a bad history bar does not silence the live path, which is the one more likely to be the culprit."* Once only: *"if a feed is emitting junk it emits it every tick, and a warning per tick is its own outage."*

`candles.ts`'s `sanitize` also clamps `high`/`low` around `open`/`close` and rejects a wick wider than a quarter of the price. Its own note: *"'Click SPX, get one long candle' was exactly this."*

### The forming bar and `synth`

`live: FormingBar | null` is the bar being drawn; `synth: FormingBar | null` is the forming bar **when this chart invented it**. They are the same object while the invention is current, but `synth` is held separately *"so a poll can hand it back."*

Without it, every candle refresh dropped the forming bar's accumulated high/low on the floor: `setBars` rebuilds `live` from the newest **closed** bar the poll returned — the one *before* the bar being drawn — and the next tick started the minute over from scratch. Reloading the page did the same thing for the same reason. *"The bar arrived on time and its OHLC restarted, which is exactly what it looked like."*

Hand-back, in `setBars`:

```ts
if (synth && live && synth.openMs <= live.openMs) synth = null
if (synth && Date.now() < synth.openMs + intervalMs
          && live && synth.openMs === live.openMs + intervalMs) {
  live = synth; barCount++; pushLive(synth, 'the re-added forming bar')
} else if (synth) { synth = null }
```

Retired the moment the feed catches up — *"once a real bar covers that open (or a later one), the published bar is the truth and the invention has nothing left to say."*

**`synth = null` on `reframe`.** A reframe means the previous context is gone, and the invented bar has to die with the symbol that produced it. Carried across a switch it gets handed straight back: *"the new tape's newest CLOSED bar can easily sit exactly one interval behind the invented one (the ETF route publishes a symbol's bar a beat later than the socket's SPX print), which is precisely the `synth.openMs === live.openMs + intervalMs` case — so an SPX-priced candle is appended to a SOXL series. The pane then autoscales 0–9000 … 'Switch SPX → SOXL, chart stays on the SPX price for half a minute' was exactly this."* Only on reframe — a plain poll must still hand the invented bar back.

**The roll-forward.** The candle feed hands over closed bars only, so `live` is the last *finished* bar and `openMs + intervalMs` is usually already in the past. The old guard returned on that, *"which meant that on a 1m chart every live tick was dropped and the price only ever moved when the 30s poll landed — the whole point of this method, silently inert on the timeframe it matters most on."*

So it **opens the next bar** instead, stepping **one interval from the last bar's own open**, which keeps the new bar on the feed's grid whatever that grid is anchored to (09:30 ET for 15m and coarser). **Strictly the next bar, never a later one:** past that there is a gap — an overnight, a halt, a tab asleep — *"and the honest answer is to wait for the poll rather than paint a bar over it."*

**The open is the previous close**, not the first tick this tab happened to see. *"Seeding o=h=l=c from the arriving price makes the bar a function of WHEN THIS TAB STARTED WATCHING: reload the page mid-minute and the forming candle begins again from whatever price was printing at that instant, and two tabs open a few seconds apart disagree about a bar they can both see. That is the refresh symptom."* The previous bar's close is a function of the **data**, so every tab reconstructs the same bar from the same closed history however late it arrives. The high and low then take the ticks this tab **has** seen, so a late loader gets a narrower range rather than a wrong one.

**Version bumps on the live path:** a bump **only on the roll-forward** — once an interval, not once a tick, because a new bar moves the time axis and the bubble band is positioned against it. A plain extension takes **no bump**: the band and the rail are drawn from `snaps` and the price scale, never from the forming bar. If the tick *does* move the scale, `viewSignature()` sees that on its own. *"Bumping here instead forced a full-band redraw on every quote, several times a second, forever."*

`syncLiveBarTime()` keeps `barTimes` covering whatever `live` is drawing, so the bubble layer can place a bucket against the invented bar.

### Framing and reframing

**`sessionSpanBars()`** = `max(30, round(390 / intervalMinutes))`. The floor of 30 is for the coarse intervals: 390 minutes is six bars at 1h, *"so a 1h chart opens on several days rather than on six candles."*

**`sessionStartIndex()`** walks **back** from the end (the answer is always within one session of the newest bar, and `barTimes` can hold five days), breaking on the first bar of a different ET day or before `RTH_OPEN_MIN`. Returns -1 when there is no such bar.

**`frameRecent()`** — the pane is **one RTH session wide**, positioned so today's 09:30 sits on the left edge and 16:00 on the right:

```
from = min(sessionStartIdx, newest − span/2)
ts.setVisibleLogicalRange({ from, to: from + span })
```

Early in the day the second term wins and the **live candle is centred**, with yesterday's tail behind it for context. As the day fills, the term rises until it passes 09:30 (a little after midday) and the window pins to the session. *"It slides continuously — there is no jump at the crossover, because the two expressions are equal there."*

What it replaced: `from = barCount − n` — a window measured **backward** from the newest bar with 3% of slack. It ignored the session, so the pane was always "the last 390 minutes of trading", and on a fresh morning that is most of yesterday afternoon with today squeezed into the last inch — *"which is what 'the chart keeps opening up small' was."* And before **that**, `fitContent()` fitted the whole five-day pull: *"~1,950 bars at 1m in ~900px, half a pixel each, with the bubble layer strided down to nothing because it sizes and strides off the room per bucket."*

**`ensureLatestVisible()`** — the frame is checked **three times**: `requestAnimationFrame(check)`, `setTimeout(check, 150)` and `setTimeout(check, 600)`. lightweight-charts re-lays the time scale on its own next frame, and when the bar count has just changed by an order of magnitude (1m → 15m is ~1,950 → ~130) the range it settles on can be the one derived from the **old** base index. *"Switch timeframe, lose the live candle — that was the report."*

*"'The newest bar is on screen' is not enough."* That was the whole test, and it passed on the exact view people were complaining about: a card mounting in a hidden board tab (`clientWidth 0`) gets its range applied against a scale with no width, and what comes back once shown is a pane of whitespace with the session crushed into the last inch. So the check is now three predicates — `lost` (`r.to < barCount − 1 || r.from > barCount − 1`), `tooWide` (`r.to − r.from > span × 1.6`) and `tooEmpty` (`visibleDataFraction() < 0.4`). The 600ms timer is there because *"a tab that becomes visible can lay out well after the 150ms one."*

Runs **only from the reframe branch** of `setBars`, never on the 30s poll, *"so it can never fight a zoom the user chose."*

**`reanchorIfStranded(prevCount)`** — the "come back to the tab and there is a huge gap" bug. Whitespace on both sides with the candles squeezed into the middle is not a drawing fault: it is the visible **logical range** surviving a `setData` that gave the series a different number of bars. Nothing in lightweight-charts re-anchors it. *"It takes the bubbles down with it, which is why they went thin at the same time: the layer measures `pxPerDot` off the CURRENT zoom and strides the trail to fit."*

Deliberately narrow, because `setBars` runs every 30 seconds:

* nothing at all on screen — **always** re-anchor. *"A pane showing no candles is not a view anyone chose."*
* the series **shrank** and most of the pane is now empty (`shown < 0.3`). *"Growth cannot strand a range; only losing bars out from under it can."*

A deliberate scroll into the whitespace beside a stable series matches neither and is left alone.

**`recoverView()`** — the activation path. Same repair, run when the chart comes **back**: the tab is shown again, or the card is laid out after having had no size at all. *"`reanchorIfStranded` alone was not enough … Come back to the tab and you are looking at the gap until something else moves."* Looser than the `setBars` rule on purpose (`< 0.3` with no shrink requirement) because *"if under 30% of it is candles, that is not a view anyone chose to come back to."* Deferred a frame: while hidden, rAF was stopped, *"and asking the time scale where it is before the browser has re-laid the chart out gets an answer from before the resize."*

Triggered from two places: a `visibilitychange` listener, and a `ResizeObserver` that watches for `hadBox` going false → true.

**An empty payload is "no answer", not "no bars."** `if (!bars.length && barCount > 0 && !reframe) return`. `useQuery`'s catch writes `value: undefined` over the good one it was holding; passing that straight through wiped the series and repopulated it a moment later with a different bar count — *"which is precisely how a visible range ends up stranded."* Unless `reframe` is set: there an empty payload means "the new thing has not answered yet", and holding the old bars *"would draw one ticker's candles under another ticker's heading, which is worse than a blank pane for a few hundred ms."*

### The rAF draw loop and its view signature

*"A steady rAF loop rather than chasing every event that can move the price axis — pan, zoom, autoscale and resize all qualify, and enumerating them one at a time is how an overlay ends up half a pixel behind its chart."*

**But the loop must not work every frame.** It used to: sixty times a second it read `getBoundingClientRect()` and `ts.height()` (two forced layouts), positioned every rail row, and redrew the whole bubble band — *"up to 320 segments × six marks, each with its own `priceToCoordinate()` and `stroke()`. Chrome logged it as a 52ms rAF handler and a 47ms forced reflow, on a chart that was sitting still."*

Three changes, in order of what they cost:

1. The size comes from a **ResizeObserver**, not a per-frame layout read.
2. `ts.height()` is cached and refreshed with it.
3. **Nothing is drawn unless the view actually moved.**

```
viewSignature() = `${version}|${boxW}|${boxH}|${plotW}|${from}|${to}|${px(y0)}|${px(y1)}`
```

* `version` is bumped by **every setter** — `setBars`, `setSnapshots`, `setDrawOpts`, `setRailSink`, `setLevels`, `setEmBand`, and the roll-forward — *"so a DATA change always redraws even when the view has not moved a pixel."*
* The **time axis** is probed with `ts.getVisibleLogicalRange()`, **not** with `timeToCoordinate()` on a pair of timestamps. That was the first attempt and it was silently broken: `timeToCoordinate()` answers only for times that are *in* the series, and the probe times came from the per-**minute** GEX history while the candles are 5m or coarser. *"Both probes returned null on nearly every load, so the horizontal half of the signature was the constant 'n|n' and a pure sideways pan never redrew the layer."* The logical range is always defined, is pure scale state (no layout), and moves on both pan and zoom.
* The **price axis** is probed with `series.priceToCoordinate()` on **two** prices, not one — *"a zoom anchored on a point leaves that point where it was, so a single probe cannot see it."* `pickProbes()` takes them from the newest ladder's first and last mark, falling back to `live.low`/`live.high`, and is re-run by `setBars` and `setSnapshots` because *"the signature is computed against strikes that are no longer on the chart and can stop changing when the view does"* otherwise.
* Mid-teardown the whole thing is wrapped: the catch returns `` `${version}:torn:${Math.random()}` `` — a value that will not match, *"so the frame draws and the next one finds the loop cancelled."*

`plotW` is re-read **every frame** via `ts.width()` — cached model state, not a layout read — *"because the scale widens on its own when the price gains a digit."* `barSpacing` is read once per frame from `ts.options()` for the same reason.

### Visibility — non-negotiable 5

```ts
if (!isVisible()) { missedWhileHidden = true; return }
if (missedWhileHidden) { missedWhileHidden = false; lastSig = '' }
```

`isVisible` is `mountOpts.visible ?? (() => true)`, and `mountOpts.visible` is `frame.visible` straight off `ChartFrame`'s handle. The card's mount comment is explicit: *"NON-NEGOTIABLE 5, and this is the card it matters most on: the chart's overlay runs a steady rAF loop, so it takes `handle.visible` — the per-frame predicate — rather than the `onVisibility` edge. The frame was already handing us this and we were dropping it on the floor, so the bubble layer redrew the whole band for a card scrolled out of view."*

**The loop keeps being scheduled**, deliberately: *"cancelling it would mean re-arming it from the visibility edge, and rAF is already stopped outright by a hidden TAB. What it must not do is WORK."* The gate is checked **before** `readPlotW()`, so a hidden card costs one boolean per frame and nothing else.

`missedWhileHidden` forces one repaint on the first frame back in view: *"the view almost certainly moved while we were away (live bars kept arriving), and the signature we are about to compute could still match the last one we DREW."*

**The canvas is tagged**, non-negotiable 6: `overlay.dataset.cbLayer = 'bubbles'`. The note is worth reading in full — without the tag `scripts/perf-check.mjs` skipped it entirely, and because its interaction assertions sum repaints for the `gex-candles` card, *"they summed over nothing: 'panning still redraws (0)' and 'zooming still redraws (0)' failed on every run and COULD NOT have passed. A guard that reports zero because it is measuring an untagged canvas is worse than no guard."*

The overlay is a transparent `<canvas>` at `position: absolute; inset: 0; pointer-events: none`, appended to the container (which is forced to `position: relative` if it computed `static`).

### The axis lock

The replay transport's 🔒 button, and it stops **two independent drifts**:

**The price axis.** Replay hands `setBars` a list clipped to the cursor, so autoscale re-derives the window from however much of the day has been revealed — *"at 09:35 that is one candle's worth of range, by 15:00 it is the whole day, and every step in between rescales the pane. A level that has not moved appears to slide, which on a screen recording reads as the market moving rather than the frame."*

**It is a range, not a freeze.** The obvious implementation is `autoScale: false`, *"and it is wrong: it pins whatever window happened to be showing when the button went on, which for a replay that opens rewound to 09:30 is the first bar's few points."* So the card hands over the price span of the **whole session** (off `dayBars`, the unclipped tape) and an `autoscaleInfoProvider` returns it for every frame:

```ts
autoscaleInfoProvider: (original) =>
  axisLocked && lockedPriceRange
    ? { priceRange: { minValue: lockedPriceRange.min, maxValue: lockedPriceRange.max } }
    : original(),
```

Autoscale stays **on** — the provider is only consulted while it is — and is re-asserted on every `setAxisLock`, *"because a manual drag of the price axis turns it off permanently, so a chart the user had dragged before pressing the button would ignore the lock entirely."* Re-asserting also re-derives immediately on **release**, so letting go snaps to the current cursor's range instead of waiting for the next poll. `scaleMargins` still apply on top.

The card refuses a **zero-width** range (`max <= min`) — *"a session with one flat bar would hand over a zero-width price range, and a zero-width price range is a pane the library cannot lay out."*

**The time axis: stop the shift, do not undo it.**

```ts
ts.applyOptions({ shiftVisibleRangeOnNewBar: !on })
```

lightweight-charts scrolls the visible range by one bar whenever a bar is appended — right for a live tape, wrong for a rewound one where **every step of the cursor appends a bar**. The first version of this lock left that alone and put the range back afterwards in `setBars`, *"and the two writes per frame are what the bubbles were jittering between: the overlay is painted from our own rAF and can sample the time scale before the correction lands, so the marks pick one of two positions a BAR apart. At 5m that bar is ~19px wide."* Off at the source instead, *"so there is nothing to correct and nothing to race."*

The `heldRange` restore in `setBars` stays as a **guarded backstop** for the cases that can still move a range (a resize landing in the same tick, a library-side clamp when the bar count drops). It reads the range **before** `setData` and only writes when it actually moved (`> 0.01` on either edge). *"Writing unconditionally is what made the bubbles jitter."*

The locked path deliberately does **not** fall through to `reanchorIfStranded`: *"'the series shrank and the pane went empty' is the NORMAL state of a rewound chart scrubbed back toward the open, and re-anchoring on it is the jump the lock exists to stop."*

`setAxisLock` early-returns when nothing changed (`axisLocked === on` and the range endpoints match), so the per-frame re-application from the card's effect is free.

**On by default on this surface only.** The other four replay tabs open unlocked, *"because on a ladder the unlocked behaviour is merely busy. Here it is the thing everyone hits first."* It is **re-armed**, not merely left alone, when the subject changes: entering replay, leaving it, and picking another session all set `axisLock` back to `true`.

### `setBars` ordering

Three effects run **in source order** before the one that hands over the bars, and the ordering is the mechanism rather than a comment about one:

1. `setIntervalMs` — *"the interval is what the chart re-frames against (frameRecent sizes the window in bars) and what it picks the bubble bucket from, so handing it over after the reframe would spend one frame on the previous timeframe's numbers."*
2. `setAxisLock` — *"the lock has to be in force on the chart by the time the clipped bars arrive, or the first scrub after pressing it still rescales once."*
3. `setBars(bars, reframe)`.

### `viewKey` — what earns a reframe

```
viewKey = `${symbol}|${useEs ? 'ES' : 'IDX'}|${settings.interval}|${session}|${settings.tapeDays}D|${replayOn ? 'R' : 'L'}`
```

Everything in the key changes the **scale** of the series:

* **symbol** above all — SPX at ~6,800 and SPY at ~645 share no price window at all, and the old one would leave the new candles off the pane entirely.
* **ES** — the futures sit a basis above cash, and while that is inside SPX's window a switch still deserves the reframe: *"the tape's overnight range is not the index's."*
* **replayOn** — so entering or leaving replay reframes **once**. *"It is the only replay state that belongs here: the cursor moving is not a scale change, and reframing on every scrub tick would fight the pan and the zoom."*
* **tapeDays** — it changes how many bars are on the pane by a factor of three, and `frameRecent` sizes the window in **bars**. Without the reframe, 1D → 3D leaves the two older sessions off the left edge *"and looks exactly like the picker did nothing."*

The key is **latched only once real bars arrive** (`if (bars.length) framedRef.current = viewKey`). On a symbol change the query cache misses and `bars` is briefly empty; *"latching on that empty set would spend the reframe on nothing and leave the actual data unframed."*

### `checkOffscreen`

`ts.subscribeVisibleLogicalRangeChange(checkOffscreen)`, and `off = r != null && barCount > 0 && r.to < barCount - 1.5`. **1.5 bars of slack** because *"the logical range edges are fractional, so an exact comparison flickers the button on and off while the last bar forms."*

---

## Settings

Every key on `ChartSettings`, its default, and what it means.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `symbol` | `string` | `'SPX'` | **Copies only.** Instance 1 follows the board ticker and never reads this. Run through `normalizeSymbol` on load, which also retires ES/NQ onto SPX/NDX *"so a blob saved before the futures were dropped reopens on a symbol that still has candles rather than on a dead one with an empty chart."* |
| `session` | `'rth' \| 'eth'` | `'eth'` | RTH is 09:30–16:00 ET cash; ETH adds the overnight. Derived from the tape when `spxOnly`. Coerced as `p.session === 'rth' ? 'rth' : 'eth'`. |
| `interval` | `1 \| 5 \| 15 \| 30 \| 60` | `5` | Bar interval, minutes. Labels `1m`/`5m`/`15m`/`30m`/`1h`. Also the bubble bucket's input. |
| `tapeDays` | `1 \| 2 \| 3` | `1` | How many **sessions** of bars the live card draws. Ignored in replay. Capped at 3 on purpose — gamma retention is three sessions, the ETF route's ceiling is 7 calendar days, *"and three sessions is already the most that reads as context rather than as a different chart."* **Only the newest session carries bubbles and a rail**, so 2D/3D widen the candles and leave the ladder where it was. |
| `bubblesOn` | `boolean` | `true` | Master on/off for the bubble layer. |
| `gexMetric` | `'voloi' \| 'vol'` | `'voloi'` | Which GEX quantity a bubble is sized by, **and** what the rail lists. `voloi` = `net` (OI + today's volume); `vol` = `netVol` (volume only). |
| `countdown` | `boolean` | `true` | The forming-bar countdown, top-right. |
| `volume` | `boolean` | `true` | The volume histogram strip. On by default *"a candle chart without volume under it is missing the second half of every bar's story."* |
| `spotLine` | `boolean` | `true` | A light dashed line at the last price, full width. lightweight-charts draws this itself. *"It was hardcoded OFF when this chart was built, for a reason that has not changed — it is a full-width rule over the bubble layer — so it is a toggle rather than a fixture, and the axis label still carries the price for anyone who turns it off."* |
| `railOn` | `boolean` | `true` | The strike ladder down the right side. Suppressed (not rewritten) on a phone. |
| `levelLabels` | `boolean` | `true` | CORE / CW / PW tags on the price pane. **Separate from `railOn` deliberately**: *"the rail costs 96px of chart width and these cost nothing."* |
| `emLevels` | `boolean` | `true` | The ±1σ daily expected-move rails. Separate from `levelLabels` because *"CORE / CW / PW come off the newest GEX column and move with the book. The EM band … does not move, which is the only reason it is worth marking."* Also **gates the request**. |
| `emLines` | `boolean` | `true` | Dashed hairline with each EM tag, or the tag alone. Under `emLevels`, not beside it. |
| `expiry` | `string` | `''` | **DEAD (2026-09-04).** The old expiry pin. Nothing reads it and nothing writes it. Kept in the type and in `coerce` so an existing blob still parses without a version bump. *"Do not start honouring it again without also bringing back a control to clear it — a pin with no UI is a card stuck on a stale expiration."* |
| `bubbleBucket` | `1 \| 5 \| 'auto'` | `'auto'` | `'auto'` follows the bar interval, clamped into `bucketRungsMin`. `1`/`5` pin the rung **and** loosen the stride. v2's `slotStore` carries a legacy `'bar'` spelling for `'auto'`; *"v3 has no blobs old enough to hold it, so it is not accepted here."* |
| `bubbleScale` | `number` | `1` | The Bubble size slider, `BUBBLE_SCALE_MIN` 0.5 → `BUBBLE_SCALE_MAX` 2.5, step 0.1. A **multiplier**, not a pixel size: *"the numbers in BUBBLES are a system … handing one of them out to be set absolutely breaks every relationship the layer was tuned around."* Coerced by `clampScale`; anything unusable is 1. |
| `esCandles` | `boolean` | `false` | ES futures candles under SPX gamma. Only meaningful while the symbol is SPX (`def.gexSymbol === '$SPX'`). On any other symbol *"the flag is simply not read, so a board that was on ES and moves to AMZN draws AMZN's own candles, and comes back to ES when it returns to SPX."* |

### Storage

**Key:** `cb-v3-gex-candles:` + the **instance id**. Instance 1's key is the bare `gex-candles` it always was, *"so no saved board changes meaning."*

**Version:** `SETTINGS_V = 7`, written into the blob as `v` rather than onto `ChartSettings` — *"it is a storage concern, and nothing that reads settings should have to know about it."*

`STALE_ON_UPGRADE = ['prevDay', 'bubbleDay']`; on any version mismatch those keys are deleted from the parsed object before coercion, *"so the dead keys are dropped from the blob on first load rather than riding along forever — nothing reads them either way, this just keeps the blob honest."*

| Version | Date | Change |
|---:|---|---|
| **v7** | 2026-09-02 | `esCandles` added. An older blob has no such key; `coerce` falls back to `false`, which is the cash-index chart those blobs already drew. |
| **v6** | 2026-08-31 | `bubbleScale` added. `clampScale` falls back to 1, *"and 1 is the size those blobs already drew."* |
| **v5** | 2026-08-31 | `prevDay` and `bubbleDay` **removed** with the 48h testing reach and the Sun/Mon/Both day picker. Both listed in `STALE_ON_UPGRADE`. |
| **v4** | 2026-08-29 | `bubbleBucket` added — *"the one bubble setting there is."* Falls back to `'auto'`, which is what those blobs already did. |
| **v3** | 2026-08-29 | The bubble knobs left `ChartSettings` entirely. *"Kept because the next default that needs pushing will need this, and re-deriving the mechanism is worse than leaving it inert."* |

Both `loadSettings` and `saveSettings` are `try`/`catch` — a failed write is best-effort and *"the in-memory settings still drive this session."*

The default coercion idiom throughout is `p.key !== false`, so **a key that has never been written comes back ON**. That is deliberate for `bubblesOn`, `countdown`, `volume`, `spotLine`, `railOn`, `levelLabels`, `emLevels` and `emLines`: *"a blob written before the rails existed should come back with them ON, which is what a card created today shows."* `esCandles` is the one that reads `p.esCandles === true`, because off is the safe default there.

---

## Symbols

### The universe

Fourteen curated symbols, in `SYMBOLS`:

`SPX`, `SPY`, `QQQ`, `NDX`, `VIX`, `AAPL`, `AMD`, `AMZN`, `GOOGL`, `META`, `MSFT`, `NVDA`, `SPCX`, `TSLA`.

Each is a `SymbolDef { key, label, gexSymbol }`. **Only SPX differs from its own ticker** — gamma is stored under `$SPX` while the candle feed knows `SPX`. `chainTicker(def)` strips the `$` for the options-chain routes.

`symbolDef(key)` never returns null: an unknown key becomes `{ key, label: key, gexSymbol: key }`. `TICKER_RE` is `/^[A-Z][A-Z0-9.\-]{0,9}$/`.

### Retired symbols

```ts
const RETIRED: Record<string, string> = { ES: 'SPX', '/ES': 'SPX', NQ: 'NDX', '/NQ': 'NDX' }
```

**ES and NQ are not symbols here (2026-08-27).** Dropping the futures from the symbol list is what lets this module tree be simple:

* **One candle endpoint.** `/api/snapshots/etf-candles` serves every symbol here. The futures route only ever looked at the symbol to choose between the ES and NQ tables — *"asking it for SPY silently returned ES bars."*
* **No basis, for a symbol.** Every symbol below charts against its **own** strikes, so a bubble goes at the strike price: *"nothing to convert, nothing to fetch, and no 'basis unavailable' state to design around."*

**ES is back as a candle source, not a symbol (2026-09-02):** v2's original pairing — SPX gamma on ES futures candles — expressed as the card's SPX/ES switch (`settings.esCandles`), shown only while the symbol is SPX. Typing `ES` into the toolbar still lands on SPX, *"where the switch is one click away, and none of the other cards on the board has to learn what a futures contract is."*

### The server roster

```
/api/es-candles/tickers → { tickers: [...] }
```

Three tiers of symbol, as in v2: (1) the curated list, always present, always first; (2) the server roster, fetched **once, lazily, on the first time a picker opens** — never on mount; (3) anything the user types that looks like a ticker.

`loadRoster()` memoises both the result (`rosterCache`) and the in-flight promise (`rosterInflight`). Entries are normalised, `TICKER_RE`-tested and de-duped. **A failure yields an empty list and is never retried** — *"the curated list plus freeform entry is a complete fallback, and a retry loop behind a dropdown is the kind of thing nobody notices until it is hammering the backend."*

### Favourites, and two keys

| Key | Owner | Used by |
|---|---|---|
| `es-candles-fav-symbols-v1` | `symbols.ts` (`loadFavSymbols` / `saveFavSymbols`) | This card's **local** `SymbolPicker` in `controls.tsx`. **Deliberately the same key v2 uses**, so a user's stars survive the move between `/app/es-candles` and `/v3`. It holds a plain string array and v3 only ever reads and rewrites that shape, so neither app can corrupt it for the other. *"This is the one storage key v3 shares; everything else it invented is namespaced `cb-v3-`."* |
| `cb-v3-fav-tickers` | `src/design/primitives/TickerPicker.tsx` | The **app toolbar's** picker — and therefore what **copies of this card** now use. |

That split is why copies mount `TickerPicker` rather than `SymbolPicker`: *"the SAME STARS: favourites live in one browser-wide list, so a ticker starred in the toolbar is already at the top here, and starring one here puts it at the top of the toolbar. The card's local `SymbolPicker` kept a second favourites list under v2's key, which is two lists for one habit."*

`SymbolPicker` is still present and exported in `controls.tsx`.

---

## Card instances, copies, and `spxOnly`

### Instance ids

A grid item's `id` is an **instance** id, not a catalog id. The first copy keeps the bare catalog id (`gex-candles`); every copy after it gets a `#n` suffix (`gex-candles#2`). Two consequences, both deliberate: every layout ever saved is still valid and still means what it meant (no migration pass, no version field), and anything keyed on the bare id — a saved board, the `data-card-id` selectors `perf-check` drives — keeps working. `cardTypeOf()` strips the suffix for the catalog lookup; `migrateCardId()` applies renames to the **type** and lets the suffix ride along.

### What a copy is

```ts
const cardKey = instanceId || CARD_ID
const isCopy  = !spxOnly && cardKey !== CARD_ID
const symbol  = spxOnly ? SPX_ONLY_SYMBOL : isCopy ? settings.symbol : boardSymbol
```

**Instance 1 has no picker.** The board has one ticker and the toolbar search sets it; *"a picker on that card would be a second place to change the same thing."*

**Every copy after the first gets one (2026-09-04).** *"The whole point of adding a second GEX Candles card is to watch a second ticker — two cards locked to the board symbol draw the same chart twice."* `settings.symbol` was already in the stored blob, unread since the picker was removed; this is what reads it again. `usePageSymbol()` is still called on both — hooks are unconditional — and a copy simply ignores what it returns.

Settings are keyed by **instance id**, so a copy's symbol, interval and bubble settings are its own.

The copy's picker is `<TickerPicker>` with `allowCustom={PAGE_TICKER_RE}` (`/^[A-Z][A-Z.]{0,5}$/`), matching the toolbar: *"the universe is the server's watchlist, not everything the app can price, so a valid symbol off that list is still offered as a 'USE' row."* It is placed **first on the row**, on a phone too: *"on a copy this is what the card IS. Everything to its right is a setting on the chart; this is the chart's subject."* It renders `null` (not hidden) on instance 1 so the header keeps no empty slot.

### `spxOnly` — the phone build

`SPX_ONLY_SYMBOL = 'SPX'` — *"the one root with both a cash tape and a future."*

Two things, *"and they are the same thing"*:

* **The card stops following the board's ticker and charts SPX.** The SPX/ES switch is `esCapable`, true only on SPX, so pinning the symbol is what makes that switch **the only symbol control on the screen** — which is what was asked for, *"and it is also the only pair the phone has a live feed for."*
* **Session stops being a setting.** `session = spxOnly ? (useEs ? 'eth' : 'rth') : settings.session`. ES trades nearly around the clock, so it is ETH; SPX cash does not exist outside 09:30–16:00 ET, so RTH on it is not a filter, it is the whole tape. *"An SPX chart on 'ETH' and the same chart on 'RTH' are the same picture, and a button that changes nothing is a button that teaches you it does nothing."*

The stored `session` is **left alone**, like `railOn`: *"the same browser profile opens this card on a desktop and must find it as it left it."*

**`spxOnly` is deliberately not a copy**, however it was mounted.

### The three phone differences

All three are about the hand rather than the screen size:

* **The toolbar becomes one button** and everything moves into a bottom sheet. *"The desktop toolbar is five controls at 10px; on a 390px card it wraps to three rows of ~18px targets, eats a third of the chart's height to do it, and still cannot be hit reliably."*
* **The GEX rail is off** — `railOn = settings.railOn && !phone`. *"A fixed-width column beside the chart — affordable at 900px, a quarter of the plot at 390."* It is what the **rest of the card reads**, including the history fetch, *"so a phone does not pull the heaviest request on the card for a ladder it will never draw."* The GEX rail chip is off the sheet entirely: *"a toggle that changes nothing you can see is worse than no toggle."*
* **The overlays move in off the rail's old gutter** and grow to a real tap target. The countdown goes `right-2` instead of `right-16`; the jump button goes 36px (`h-9 w-9`) at `bottom-6 right-3` instead of 28px at `bottom-8 right-16`; `ReplayBrand` insets to `right 44 / bottom 26` instead of `68 / 30`.

*"Everything else — the chart, the data path, the settings and their storage key — is the same card. This is deliberately not a second component: a phone fork of a 700-line chart card is a second thing to fix every time."*

---

## The folded toolbar and the ⚙ Layers panel

The card's toolbar is **portalled into the Card's header** via `<CardToolbar>`. *"This card used to draw its own row right under that header, so the board showed two bars stacked and the chart lost the height of both."*

### Why the header is folded

Spelled out, the header read `SPX|ES · 0DTE · 1m|5m|15m|30m|1h · RTH|ETH · ⚙ Layers` — **eleven buttons, ten of them saying what the chart is NOT set to.** Two candle cards side by side on a 12-column board is the normal arrangement here, *"and at that width the row wrapped and the ⚙ fell off the end. Folded, the same row is the width of the words 'SPX 0DTE 5m ETH ⚙', which fits on a quarter-width card."*

Nothing is hidden: the options are one click away, in the identical control they used to be shown in. Each of the three segmented controls is built **twice from one set of options and one handler** — `SegGroup` (open) for the phone sheet, `SegMenu` (folded) for the desktop header. *"One instance each, so there is no chance of the two rows drifting apart."* In the sheet there is room and nothing to gain from a second tap, so it stays open.

### The header row, in order

| Control | Where | Notes |
|---|---|---|
| `<TvAttribution>` | always, first | *"First in the row, so on a `justify-end` toolbar it sits at the LEFT edge of the control cluster — beside the card's name, away from the buttons, and off the chart entirely."* |
| `⏱ Replay` chip | only when `replay` was passed | Toggles replay. Resets playing, day, cursor and re-arms the axis lock. The board never passes the prop, *"so this button does not exist there and the toolbar is unchanged."* |
| Symbol picker | copies only | See above. |
| SPX / ES | `esCapable` only | **Open on a phone, folded on the desktop.** *"The phone header carries ONLY this control … and it is the width of the word 'ES' — the fold would cost a tap and save nothing."* It stays in the header on a phone (2026-09-03) because *"SPX-vs-ES is the one control you reach for mid-session — it is the difference between a chart that stops at 16:00 ET and one that has the overnight — and burying it behind ⚙ made the phone build's candle screen answer a different question from the board's."* |
| Interval | desktop only (folded) | `1m 5m 15m 30m 1h`. On a phone it moves into the sheet. |
| Session | desktop only (folded), and not when `spxOnly` | `RTH ETH`. |
| ⚙ | always, last | On desktop it reads `⚙ Layers`. **On a phone the button IS the toolbar**, so it says what the chart is set to: `5m · 2D · ETH ⚙` — *"otherwise the two settings you change most are invisible until you open the sheet."* The `2D`/`3D` segment is omitted at the resting 1D and while rewound. |

**The session follows the tape.** `onTape` writes **both** keys:

```ts
const onTape = (v) => patch({ esCandles: v === 'es', session: v === 'es' ? 'eth' : 'rth' })
```

*"ES trades nearly around the clock, so an ES tape on RTH throws away the overnight that is the only reason to be on it; SPX cash does not exist outside 09:30-16:00 ET, so coming back to it on ETH leaves an empty overnight gap on the left of every column."* Here it is a **default, not a lock**: the Session picker is still live, *"so a deliberate ES-on-RTH is one click away and survives until the tape is switched again."*

**There is no expiry picker** anywhere — header or sheet. The card draws the nearest expiration on every width.

### The ⚙ Layers panel

`<Popover open sheet={phone}>`, `w-64` on desktop, full-width column on a phone. Sections, in order:

**Interval** — phone only. The desktop keeps it folded in the header.

**Days** — `1D 2D 3D`, **every width**. Not in the header beside the interval, where it started: *"the header is the one row that has to survive a quarter-width card and this is a set-once control: you pick 2D to look at yesterday's shape and leave it there. The interval is the one you reach for mid-session, so it keeps the slot."* Open (`SegGroup`) rather than folded — *"inside the panel there is room, and three two-character segments cost less than a click."* **Suppressed while rewound**: *"replay is one picked session and the day dropdown on the transport is the control for which — a second day picker there would be two controls disagreeing about one thing."*

**Session** — phone only, and not when `spxOnly`.

**Layer** — eight chips in a wrap:

| Chip | Key | Tooltip, verbatim |
|---|---|---|
| `Bubbles` | `bubblesOn` | "Draw the GEX ladder over the candles" |
| `GEX rail` | `railOn` | "The strike ladder down the right-hand side. Every row sits at the same height as its strike on the chart — it reads the chart's own price scale, so it stays level through a pan, a zoom and an autoscale" — **desktop only** |
| `Levels` | `levelLabels` | "CORE, CW and PW drawn on the chart itself — a tag at the left edge of each, name and price, no line. Same three levels the rail tags: CORE is the biggest gamma strike on the ladder, CW the call wall above spot, PW the put wall below" |
| `EM` | `emLevels` | With a band: "Today's expected move: ±`em` off the `refClose` prior close — `down` to `up`. A chip at the left edge for each, beside CORE/CW/PW. Read once this morning from `expiry`'s ATM straddle and frozen, so the two levels do not move all session". Without: "No expected-move band recorded for `SYMBOL` on `DAY` / today — it is written on the session's first read of the option chain, and a past session that predates it has none to draw" |
| `EM line` | `emLines` | `disabled={!settings.emLevels}` — **dimmed rather than dropped**: *"a toolbar whose buttons come and go is a toolbar you cannot learn."* On: "Carry a dashed hairline across the chart from each EM chip…". Off: "Turn EM on first — this decides whether those two levels carry a line across the chart or are tags only" |
| `Volume` | `volume` | "Volume histogram in a strip along the bottom of the chart, coloured by each bar's own direction. Takes a quarter of the pane's height from the candles while it is on" |
| `Spot line` | `spotLine` | "A light dashed line across the chart at the last price. It follows the live print, not just the last poll" |
| `Countdown` | `countdown` | "Time left in the forming bar" |

**GEX basis** — `Vol+OI` / `Vol`. *"Vol+OI is open interest plus today's volume; Vol drops the open interest term."* Deliberately **outside** the bubble gate, because the rail reads it too — *"hiding it with the bubbles would leave the rail's basis unreachable."*

**Bubble bucket** — `Auto` / `1m` / `5m`. *"How much time one bubble covers. Auto follows the bar interval — one bubble per candle, capped at 5m — so switching 1m/5m up in the header moves the bubbles with it. 1m and 5m pin the bucket instead, which is for reading sub-bar detail under coarser candles. Either way the zoom only thins what is drawn: at a wide zoom a 1m bucket still draws every Nth."* **"Six sliders came out of this panel and this is what replaced them."**

**Bubble size** — one `Slider`, 0.5×–2.5× step 0.1, formatted `1.0x`. `disabled={!settings.bubblesOn}` — **disabled rather than hidden** with the layer off, *"the value it holds is the value that comes back when you turn it on."* Tooltip: *"Scales every mark together — cap, floor, the top mark's boost and its ring — against the room the zoom leaves them. 1.0 is the tuned default. Above it the marks can start to touch at a wide zoom, which is the same trade the manual 1m/5m bucket offers: you asked for detail and accepted the crowding to get it."*

### `data-capture-meta`

Everything the toolbar carries, for the caption under a CopyShot — *"the shot drops this card's header, so what is not published here is not in the picture"* (see `shell/snapshot.ts`, `META_ATTR`). Joined with ` · `:

`ES or symbol` · `expiry` · `<interval>m` · `2D/3D` (only when not the resting 1D and not rewound — *"a caption that says '1D' on every shot is a word the reader has to skip past on every shot"*) · `SESSION` · `REPLAY <day> <HH:MM> ET` when rewound — *"a shot of a rewound chart that does not say so is a shot of a lie."*

---

## Replay

**Opt-in, via the `replay` prop, and the board does not pass it.** `<GexCandlesCard />` on the board is byte-for-byte the live card it has always been: no transport, no toolbar change, no extra request, *"and every replay hook sits inert behind one `replayOn` flag."*

**It costs nothing to fetch, which is the reason it could be added at all.** The card already holds a whole session of candles **and** a whole session of per-minute GEX ladders in memory — *"that is what the bubbles ARE."* So the replay is not a second data path: *"it is ONE cursor timestamp, and both series are clipped to it."*

### The cursor

**The cursor is a timestamp, not a bar index.** *"Switching 1m → 5m rebuilds the timeline with a fifth of the entries; an index would land somewhere unrelated while a time stays the same time."*

```
replayTimeline = dayBars.map(b => b.t)        // ONE session's bars, not five
replayIdx      = derived:  last index whose t <= replayMs
cursor         = replayOn ? (replayTimeline[replayIdx] ?? 0) : 0
bars           = cursor ? dayBars.filter(b => b.t <= cursor) : dayBars
columns        = cursor ? sessionColumns.filter(c => c.slotTs <= cursor) : sessionColumns
```

The timeline is the **bars**, not the GEX columns: *"the candles are always there and the ladder may be switched off, and a transport whose scrubber empties when you turn off a layer is a broken transport."*

**One session's bars, not five.** *"The tape is pulled HISTORY_DAYS deep, and a scrubber spanning all of it would put four sessions the picker has already excluded under one handle — 09:30 would be four different mornings."*

**The clip lands upstream of both consumers.** `columns` is what the bubble model *and* the rail read, so a rewound chart cannot show 10:04 gamma under a 10:04 tape beside a 16:00 rail.

**Seeded at the session's open.** *"Landing on the last bar would be a rewound chart that looks exactly like the live one, which is the worst possible opening state for a replay tab."*

**Stops at the right edge rather than looping.** A poll that adds a bar while paused at the end leaves the cursor where it was — *"it does not chase the live edge, because 'I stopped here' is a position, not a follow."*

### The transport

Rendered in this card's own tree, because this card owns the state it drives; `ReplayDock` **portals the DOM** to the bottom of the page column, **in flow**, so it shrinks the chart rather than covering the last inch of it.

| Constant | Value | Notes |
|---|---:|---|
| `REPLAY_BASE_MS` | **700** | ms per **bar** at 1×. |
| `REPLAY_SPEEDS` | `[0.5, 1, 2, 4, 8]` | |

Both are *"the same numbers and the same key layout as every other v3 transport — `mgReplay.ts`'s `MG_REPLAY_BASE_MS` / `MG_REPLAY_SPEEDS` and the Ticker Lookup bar. Not imported from either: those constants belong to modules this card has no other reason to pull in, and the two values are the whole of the shared decision."*

The bar, left to right:

1. **`Replay`** in `T.orange`, black uppercase, tracking `0.1em`.
2. **The session `<Select>`** — which day is rewound. Options are `sessionDays`, the ET days the **payload actually came back holding**, never a computed range. *"A dropdown that offers a day with no ladder behind it is a dropdown that renders an empty chart and blames the user for picking wrong."* With both gamma layers off it falls back to the tape's days so the picker stays usable for scrubbing candles alone. Labels are `dayLabel()` — `Fri 09-05` — with the raw `YYYY-MM-DD` as the `sub` line. Switching one clears the cursor, stops playback, and **re-arms** the axis lock.
3. **`N sessions recorded`** — *"three sessions is the server's retention, and a dropdown with three entries and no explanation reads as a bug rather than a limit."* Singular at 1. Title: "Sessions currently held in `option_strike_gex_history`. Server-side retention (`GEX_HISTORY_KEEP_SESSIONS`) decides this, not the chart."
4. **The clock** — `HH:MM ET`, or `--:--`. *"The one place the cursor is stated as a TIME rather than as a slider position."*
5. **`bar N/M`**, or `no bars`.
6. **`◀ ▶/❚❚ ▶`** — the same three keys, in the same order, as the Ticker Lookup and Multi Greek bars. Playing from the end rewinds to the open first, *"which reads as broken"* otherwise. Buttons are **dimmed rather than hidden** at the ends: *"a key that disappears at the end of the tape moves every key beside it."*
7. **The scrubber** — `<input type="range">` over the **derived** bar index, so a 1m → 5m switch moves the handle to wherever that same instant now sits. Accent `var(--color-warn)` — the dock's own orange, *"so the handle matches the plate it sits on."*
8. **`Speed`** — five `TransportButton`s.
9. **`ReplayLock`** — 🔒 Axis. **Pressed by default here, unlike the other four replay tabs.** Rendered anyway rather than hidden: *"the default is a default, and the one thing worse than a chart that rescales is a chart that will not."*
10. **`Live`** — leaves replay. Also drops the picked session, *"or coming back into replay reopens on a day that may no longer be the one on screen."*

`TransportButton` is local rather than a `Chip` because *"the dock draws the orange plate, so these have to sit ON it — a Chip's own surface reads as a second plate inside the bar."*

### What is off while rewound

* **The live feeds.** `spot`, `esCandles`/`es1mCandles` and the SSE stream are all gated `&& !replayOn`. *"Pushing a live print onto a rewound chart would put a 15:59 candle on a 10:04 tape."* Gating at the subscription rather than inside the callback also takes those types **out of the socket's derived topic scope** while rewound.
* **The forming-bar countdown.** *"There is no bar forming in a session that already closed, and `Date.now() - last` against a rewound cursor counts the wrong thing anyway."*
* **The Days picker.**

### Retention constants

| Constant | Value | Notes |
|---|---:|---|
| `REPLAY_HISTORY_MINUTES` | **5760** | 4 days, and the route's own clamp on `minutes`. *"Asking for more is silently the same request, so this is 'everything there is'. Everything there is, is not much."* |
| `GEX_HISTORY_KEEP_SESSIONS` | **3** (server-side, env-overridable) | `pruneOptionStrikeGexHistory` in `server-v2/_lib-db.cjs`. *"On a Monday two of them may be Thursday and Friday."* Raising it is what buys more days. |
| `REPLAY_CANDLE_DAYS` | **7** | dxFeed's practical 1m ceiling, which the etf-candles route clamps to regardless. |

**A picked day can age out.** Retention drops the oldest session every morning, so a tab left open overnight can hold a `replayDay` the server no longer has — *"and a select whose value is not one of its own options renders empty, over a chart with no ladder on it."* An effect watches for that and falls back to the newest.

### The stamp

Drawn **into the pane**, not in the page chrome: *"these surfaces get screen-recorded, and a recording is a crop: a caption in the page chrome above the chart is one crop away from being gone, and a clip of a rewound chart that does not say so is a clip of a lie."*

`<ReplayStamp>` carries the ticker (`tapeLabel` — `ES` or the symbol's label), the expiry as `Sep 9` (`expiryLabel`), a `zeroDte` flag when `expiry === activeDay`, the session day as `Fri 09-05`, and the cursor's own wall clock as `10:04 ET`. Positioned `left: 8, top: 4` — *"clear of the countdown badge, which owns the top-right."*

`<ReplayBrand>` is the CB Edge wordmark in the opposite corner, inset **past the price axis and the rail gutter**: *"sitting the mark ON the axis labels is worse than not drawing it — the price is the one thing a recording must stay readable."*

### Live session scoping — what replay does not touch

Live, the card pins itself to `latestSession(allColumns)` — *"a board card that could sit on Tuesday's gamma without the whole page saying so is the bug this picker exists to avoid creating."*

`latestSession()` is semantic rather than "today", for two reasons: on a weekend the newest session is Friday's, *"and anything anchored to the wall clock draws an empty layer all weekend"*; and on a Monday the recorder's **weekend republish** — the last cash book, re-emitted once a minute all weekend — is still inside the reach, so taking only the newest ET day drops it, *"where 'both' used to draw it as a flat rail running across Saturday and Sunday."*

`sessionColumns` resolves its session in strict precedence: `activeDay` (the picked replay day) → `weekendExpiry` (the Sat/Sun pin) → `latestSession`. *"Rewound, the picked session outranks both the weekend pin and 'newest', which are the two rules for choosing a session when nobody has chosen one."*

`dayBars` does the same for the candles, and the mechanism is worth stating: it counts in **sessions the tape actually has** (`barDays`), never in calendar days and never against the wall clock. *"That is the whole mechanism, and it is what the first version of this got wrong: it anchored on 'today's ET date once it is past 09:30', so on a Saturday — or a holiday, or the first minutes after the open before the recorder has written a bar — today was not in `barDays`, the filter matched nothing, and the fallback handed back the WHOLE seven-day tape. 2D drew four days."* Anchoring at `barDays[0]` cannot miss: the tape has no future days in it. **1D is therefore exactly one session — the current one — at every hour of the day, including pre-market and over a weekend.** There is no ticker any more either: *"the scope moves when the poll brings the first bar of the new session, which is the same moment and costs nothing to detect."*

### The weekend, and the provisional expiry

**The weekend.** `/api/expirations` lists what is **tradeable**, so on a Saturday its first entry is Monday. *"Ask the history route for Monday's expiry and it answers honestly with nothing — Monday has not happened — and the card draws an empty layer all weekend, which is exactly when there is most time to look at it."* What you want to see on a Saturday is **Friday**. `etWeekendSessionDay()` steps back 1 day on Sat, 2 on Sun, from **noon UTC**, *"which neither the ET offset nor a DST edge can move onto the wrong date."* That date is not in the expirations list — it has expired — and it does not need to be: the history route takes `expiry` as a plain parameter and the rows are still in the table. It is only a **default**; weekday behaviour is untouched.

**The provisional expiry.** The bubble history is keyed by expiry, so it used to sit behind the expirations request: *"switch ticker, wait a round trip for the list, THEN start the request that actually draws the layer. Two serial hops, and the card was blank for both of them — which is what 'switching tickers doesn't load the bubbles' was."* On a trading day the answer is already known without asking anyone: 0DTE is today's ET date, and today is the first entry the list comes back with. So it guesses and fires immediately:

```ts
const provisionalExpiry = !expiries.length && !weekendExpiry ? ET_DATE.format(new Date()) : ''
const expiry = weekendExpiry || expiries[0] || provisionalExpiry
```

*"The moment the real list lands, `expiries[0]` takes over — and on a trading day it IS this date, so the URL does not change, nothing refetches, and the guess cost nothing."* On a holiday the guess is wrong once: the route answers with no rows and the real list corrects it a moment later, *"which is the same blank the card would have shown anyway while waiting."*

### The date-parsing rule

Every `YYYY-MM-DD` this card turns into a `Date` is parsed at **noon UTC**, never midnight: `new Date('2026-09-05')` is midnight UTC, *"which is the 4th in New York, and the dropdown would name every session as the day before itself."* That applies to `dayLabel`, `expiryLabel` and `etWeekendSessionDay`.

---

## Status and empty-state messages

Verbatim, and exactly when each appears.

| Message | Where | Condition |
|---|---|---|
| `{error.message}` | Status line under the toolbar, `text-xs text-down` | `candlesQ.error != null`. |
| `Loading…` | Status line, `text-xs text-muted opacity-70` | `empty && candlesQ.loading`, where `empty = !error && allBars.length === 0`. |
| `No candles recorded for {tapeLabel} yet.` | Same span | `empty && !loading`. `tapeLabel` is `ES` on the futures tape, otherwise `def.label`. **Tested on `allBars`, not `bars`**: *"rewound to the open, `bars` is legitimately one candle long and on the very first frame it can be zero. That is a cursor at the start of the session, not a card with no candles, and saying 'No candles recorded' over a chart that is about to play is a lie."* |
| `ES−SPX basis unavailable ({reason}) — GEX levels are drawn at SPX cash strikes.` | Status line, `text-xs text-warn opacity-80` | `basisMissing && settings.bubblesOn`. `reason` is `basisQ.error.message` or the literal `route has no usable basis, no live pair yet`. `basisMissing` requires the route to have **answered or failed**, *"the moment before the first response would otherwise flash the warning on every switch to ES."* *"An unshifted ES layer looks exactly like a shifted one until you notice every wall is 50 points under where price is reacting. Say it."* |
| `no GEX history in view` | In-pane, `absolute left-2 z-10 text-2xs text-muted opacity-55` | `bubblesOutOfRange && settings.bubblesOn`. Set from `onBubblesOutOfRange`, which fires **only on a change**, so it is safe in React state. It means the layer **has data** but none of it falls in the visible window — panned into candles older than the first bucket, or newer than the last. *"An empty bubble layer that HAS data is indistinguishable from a broken one, and that ambiguity cost real debugging time."* Positioned `top-14` under the replay stamp when rewound, `top-1.5` otherwise — *"stacked is legible where overlapped is not."* Not reported when the layer is **off** or still loading: *"the note exists to explain an EMPTY layer that has data."* |
| `No ladder yet` | In the rail, `absolute inset-x-1.5 top-1 text-2xs text-muted opacity-50` | `railModel.rows.length === 0`. |
| `[gexCandles] design token {name} resolved empty — declare it in src/design/tokens.css` | `console.warn` | A token read by `cssVar` came back empty. |
| `[gex-candles] dropped an implausible bar from {where}` | `console.warn`, **once per chart per door** | `where` is one of `the candle history`, `the extended forming bar`, `the rolled-forward forming bar`, `the re-added forming bar`, or `` `a live price ${price} against a bar closing ${live.close}` ``. |

The **countdown** is written straight to `countdownRef.current.textContent` on a 1s interval, formatted by `fmtCountdown(ms − (elapsed % ms))` as `mm:ss` or `h:mm:ss`. It is cleared to `''` when off, rewound, or there is no last bar, and when `elapsed < 0`.

The **jump-to-now** button appears when `latestOffscreen && bars.length > 0`, titled "Jump to the current candle — keeps your zoom", `aria-label` "Scroll to the latest candle".

---

## Performance notes

**The only React state the tick path touches is none.** Rule 4 is enforced three ways here: `watchFrame` instead of `useField` for the socket price, the SSE handler pushing straight through `apply(h => h.setLivePrice(px))`, and the rail positioning DOM nodes imperatively from the draw loop.

**The countdown never goes through React.** *"A once-a-second re-render of this card would re-run every memo above it and hand the chart a new bar array sixty times a minute."*

**The draw loop does nothing unless the view moved.** See `viewSignature`. The measured cost of the version that did not: *"a 52ms rAF handler and a 47ms forced reflow, on a chart that was sitting still."*

**The rail elides its own writes.** Transform and visibility are compared against what is already on the node — *"a write per row per frame is sixty style invalidations a second for a rail that mostly is not moving."*

**The heavy request is the GEX history, and it is linear in `minutes`.** The route returns **one column per minute** and there is no server-side sampling to ask for. From the card's header, the two levers in the order they matter:

1. The **reach**. The 48h `Prev day` testing switch is gone — *"4× the columns, 4× the payload and 4× the parse"* — and the live weekday reach is 720 minutes.
2. The **expiry**. `anyExpiry=1` merged every recorded expiry's ladder into each column *"and made the server walk all of them for the whole window on every poll."* It now asks for the one nearest expiry.

**The bubble model does not rebuild on a candle poll.** `snapshots` depends on `columns`, `gexMetric`, `bucketMs` and `bubbleDenominator` — **no bars**. *"A candle POLL is not a reason to re-bucket the GEX history. `bucketMs` is how the interval gets in … so a timeframe change rebuilds the model exactly once, through the one value that actually changed."*

**The rail costs no second request.** *"Same history, second view."*

**The library is behind a dynamic import**, so it lands in the route chunk rather than the entry bundle. `budgets.json`: `entry` 38,900, `route` 59,100, `totalInitial` 108,400 brotli bytes.

**The perf guard's numbers** (`budgets.json → perf`): `idleRepaintsPerFrame` 0.15, `offscreenRepaints` **0** (a hard zero), `interactionRepaints` 10. *"A gate that suppressed everything would pass every other line here."*

**The chart is mounted once.** `useEsChart` holds the handle in a ref and buffers setters into `pending` until the dynamic import resolves, *"so the first paint is never a blank chart that fills in later."* All three callbacks (`onLatestOffscreen`, `onBubblesOutOfRange`, `onBucketMs`) go through refs, *"the chart is mounted once and the callbacks it closes over must never be a reason to re-mount it."* A mount cancelled mid-import destroys whatever the promise delivers.

**`bucketMs` is seeded at the coarsest rung** the ladder has (`bucketRungsMin[last] × 60_000` = 5m), *"so the first frame — drawn before `setIntervalMs` has reached the chart — errs toward too few dots rather than a 1m firehose that is replaced a frame later."*

**The ET formatters are built once**, at module scope. *"Constructing an `Intl.DateTimeFormat` per bar is startlingly expensive and this runs over thousands of them."*

**`rollup` and `filterSession` are pure row passes.** RTH is a client-side row filter *"exactly as v2 does it: lightweight-charts' scale is index-based, so the 16:00 → 09:30 gap closes by itself and no session shading or timeScale surgery is needed."* `rollup` anchors buckets to **09:30 ET**, not the hour — *"an hourly chart whose buckets start at 09:00 puts the cash open in the middle of a bar, which is the one boundary that has to be a boundary"* — with `Math.floor`, not a truncating divide, because *"pre-market offsets are negative and truncation would fold 09:25 and 09:35 into one bucket."*

**`parseCandles` sorts an already-sorted array** on purpose: *"cheap and removes a whole class of 'the chart drew backwards' bug if the route's ordering ever changes."*

**Both `filterSession` and `dayBars` fall back to the unscoped series** rather than to an empty chart. *"An empty chart is a worse answer than an unscoped one."* The `dayBars` fallback is unreachable while `barDays` is derived from `allBars`, and is kept so it stays unreachable if that ever changes.

---

## Gotchas

1. **`cssVar()` has no string fallback, and that is load-bearing.** Adding one duplicates the palette in a place nothing keeps in sync. An empty read is a bug and warns. `hexToRgb`'s numeric triple is the only exception, and it is arithmetic, not a colour literal.

2. **The palette hexes quoted in `bubbles.ts`'s comments and `chart.ts`'s `hexToRgb` fallbacks are stale relative to this tree's `tokens.css`.** The comments say `#29b6f6` / `#ff4757` / `#ffb300` / `#ffd76a`; the tokens declare `#4d8cff` / `#ff5fa2` / `#ffd166` / `color-mix(…#ffd166 65%…)`. The tokens are what renders.

3. **Never branch on `res.ok` for the candle, futures or GEX-history routes.** All three return HTTP 200 with an error key and no rows on failure.

4. **The GEX history's cell fields are `net` / `netVol`, not `netGEX` / `netVolGEX`.** Same quantities, different route. The rename happens once, in `gexHistory.ts`.

5. **Do not re-introduce a binary search for a bucket's x.** `coordinateToTime()` is a step function; a search on it converges on the midpoint between two bar centres, which is half a bar off, every mark, always.

6. **Do not "simplify" `xOfTime` back to `timeToCoordinate(ms)`.** It does not interpolate, and a per-minute bucket almost never lands on a 5m bar, so the layer vanishes intermittently.

7. **Do not apply `pinnedPxPerDot` (2.5) to the interval-driven bucket.** It was, for a few hours on 2026-08-31. The spacing bound then crushes every mark onto `minPx` past a ~2h window and the size channel dies.

8. **Do not push `sizeCurve` past 0.75.** Beyond it the law is effectively linear again and everything below the leader collapses onto the floor.

9. **Do not go back to pale sign tints, and do not make every mark gold.** Both were tried, both reverted, both for the same reason — the small end where rows 2–4 draw at 2–4px.

10. **`drawBubbles` measures its own bucket from the snapshot median. Do not pass it in.** That was tried on 2026-09-09 as a guess at the replay jitter; the jitter was the axis lock fighting the time scale. *"Do not re-do it without a measurement showing the median actually moves."*

11. **The axis lock must turn `shiftVisibleRangeOnNewBar` off at the source, not correct it afterwards.** Two writes per frame is what the bubbles jitter between — a full bar of disagreement, ~19px at 5m.

12. **`settings.expiry` is dead and must stay dead** unless a control to clear it comes back. *"A pin with no UI is a card stuck on a stale expiration."*

13. **`settings.railOn` must never be rewritten by the phone.** `railOn` is `settings.railOn && !phone` for the render only; the stored value is untouched, because the same browser profile opens this card on a desktop.

14. **`gexUrl` must stay alive for the level tags.** With bubbles and rail both off but `levelLabels` on, dropping the request silently draws nothing. That was a real bug.

15. **`useQuery(null)` returns the last value its ref was holding.** On a symbol switch the URL *is* null for a moment (the new ticker's expiry has not arrived), so `allColumns` is gated on `gexUrl` being non-null. Without it the card kept drawing the **old symbol's** bubbles over the new symbol's candles — *"which is a live chart showing another instrument's gamma without saying so."*

16. **`synth` must be cleared on `reframe`.** Otherwise the invented bar is handed back onto the *new* symbol's series and the pane autoscales to zero for half a minute.

17. **Do not use `src/data/esCandles.ts`'s `useEsCandles` here.** It re-renders on every frame; a chart re-ingesting ~7,000 bars per socket message is the exact rule-4 violation.

18. **`!esCapable` gates the SSE path, not `!useEs`.** On SPX the socket already does this better, and running both paints two sources onto one bar.

19. **Never push `spot` onto an ES forming bar.** That is cash, one basis below the futures.

20. **The EM band's basis shift happens in the card, not the chart.** The chart does not know the basis; the walls get theirs upstream in `columns`.

21. **A zero-width `replayPriceRange` is refused.** The library cannot lay out a zero-width price range.

22. **Every `YYYY-MM-DD` → `Date` is parsed at `T12:00:00Z`.** Midnight UTC is the previous day in New York.

23. **`layout.attributionLogo: false` and `<TvAttribution>` are one decision.** Deleting either without the other leaves the chart with no attribution at all, which is a licence condition, not a style choice.

24. **`overlay.dataset.cbLayer = 'bubbles'` is the only thing making the perf guard real for this card.** Without it `perf-check` sums over nothing and its interaction assertions cannot pass.

25. **`barAt` gives two bars of slack past the end, not zero and not infinity.** Zero culls the newest column whenever the candle feed lags; infinity stacks a stale morning onto the closing bar.

26. **The bubble denominator must be computed over `sessionColumns`, not `columns`, while rewound.** Otherwise every dot on the pane shrinks whenever the cursor reveals a bigger wall.

27. **The live-basis sampler only runs during the cash session.** `spot` freezes at 16:00 while ES keeps trading; outside those hours the difference is the overnight move, not a basis.

28. **`parseLiveClose` returning 0 is normal, not an error.** Feeding it to the chart autoscales the pane to zero.

29. **Do not add an `onerror` that closes the SSE stream.** EventSource reconnects on its own; closing it turns one dropped connection into a permanent downgrade to polling.

30. **`background: isOwner` is deliberate on both polls.** The owner's chart is the session's record and a hole in it cannot be filled by a catch-up poll.

31. **Only the newest session ever carries bubbles and a rail.** `tapeDays` 2D and 3D widen the candles only — the gamma request reaches one session.

32. **`Dropdown` in `controls.tsx` needs `POPOVER_SAFE_ATTR`.** Its menu is portalled, so to an outer `Popover` the click lands outside its own ref; that panel closes on **pointerdown**, which unmounts the menu before the option's `onClick` can fire and the pick silently does not take.
