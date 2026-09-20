# GEX Candles — the complete reference

**Card:** `gex-candles` · **Label:** `🕯️ GEX Candles` · **Home board (v3), default size `w 24 / h 48`**
**Source:** `cbedge-v3/src/board/gexCandles/`
**Status:** live customer card, v3 only. Written 2026-09-20 from the source as it stands.

---

## 0. What it is, in one paragraph

A candlestick chart with the option-gamma ladder drawn *on top of it*, as bubbles. Each bubble is one
reading of one strike's net GEX at one moment in the session; its **size** is that strike's share of
the day's biggest wall, its **colour** is the sign of the gamma, and the **gold** one in each time
bucket is the biggest wall in that bucket. Beside the chart sits the **GEX rail** — the same ladder as
a live magnitude bar chart, with every row pinned to the exact pixel height of its strike on the
price axis. Over the pane are the three named levels (**CORE / CW / PW**) and the day's **expected-move
band (EM± )**. It can be rewound and scrubbed through a recorded session.

It is v2's `EsChartCard` (~376 KB of source) rebuilt for v3 scoped to **GEX bubbles only** — the whole
v3 route chunk carries an 80 kB brotli ceiling in `budgets.json`, and "only GEX bubbles" is what makes
those two facts compatible.

---

## 1. File map

| File | Lines | What it owns |
|---|---|---|
| `GexCandlesCard.tsx` | 2106 | The React card: state, every fetch, replay, the toolbar, the settings panel, the status line |
| `chart.ts` | 1819 | The lightweight-charts mount, the overlay canvas, the rAF draw loop, CORE/CW/PW + EM painting, the imperative `EsChartHandle` |
| `bubbles.ts` | 1043 | The bubble layer — selection/magnitude model (`buildBubbleModel`) and the pixel pass (`drawBubbles`) |
| `settings.ts` | 778 | Persisted `ChartSettings`, the frozen `BUBBLES` constant block, `localStorage` versioning |
| `candles.ts` | 338 | Candle fetch/parse/sanitize, roll-up, session filter, live-price URLs and constants |
| `GexRail.tsx` | 277 | The strike ladder column, `buildRail`, the per-frame `RailSink` positioner |
| `controls.tsx` | 261 | `Slider`, `Dropdown`, `SymbolPicker` (legacy); re-exports the shared primitives |
| `gexHistory.ts` | 179 | The GEX history URLs, parse, `etDay`, `latestSession` |
| `symbols.ts` | 152 | The symbol universe, retired symbols, the server roster, favourites |
| `basis.ts` | 91 | The ES−SPX basis model and `shiftColumns` |

Registered in `cbedge-v3/src/board/catalog.tsx`. Mounted three ways:

- **Board** — `<GexCandlesCard instanceId={…} />`, no replay.
- **Replay hub**, "GEX candles" tab — `<GexCandlesCard replay />`, opens already rewound.
- **Phone**, `/v3/m/spx` — `<GexCandlesCard spxOnly />`.

`catalog.tsx` also carries the rename `es-candles → gex-candles` (the futures were dropped, so the card
is no longer about ES), so a board saved before that still loads with the chart in place.

---

## 2. The data path

Five routes. Everything is fired from this card's own effects — never by a child mounting after a
parent resolved, which is the waterfall shape AGENTS.md rule 3 bans.

| Layer | Route | Poll |
|---|---|---|
| Candles (cash/ETF) | `/api/snapshots/etf-candles?symbol=&days=&interval=` | 30 s (`staleMs` 25 s) |
| Candles (ES futures) | `/api/snapshots/candles?daysBack=&limit=20000&interval=&lite=1` | 30 s |
| Live price (non-SPX) | `/api/snapshots/etf-candles/live/stream` (SSE) + `/live` probe | stream ≈1 s; probe 3 s, only after 8 s of silence |
| Live price (SPX / ES) | WebSocket frames `spot` / `esCandles` / `es1mCandles` | push |
| Expiry | `/api/expirations?ticker=` | `staleMs` 300 s |
| GEX ladder | `/api/snapshots/option-strike-gex-history?mode=heatmap&…` | 60 s |
| ES−SPX basis | `/proxy/es-spx-basis` | `staleMs` 300 s, poll 30 min |
| Daily EM band | `/api/daily-em?ticker=&date=` | 300 s |

**The one unavoidable waterfall** is the expiry: the history handler *requires* an `expiry` parameter,
and the expiry is not knowable without the first call. It is front-loaded and cached — and on a trading
day the card doesn't even wait for it (see §5).

**Every one of these routes returns HTTP 200 on failure** with an `error` key and no rows. Nothing in
this module may branch on `res.ok` alone; every parser checks for the array it expects.

### Field-name trap

A heatmap **cell** is `net` / `netVol`. The `/api/gex` route and the WebSocket `gex` frame spell the
same quantities `netGEX` / `netVolGEX`. The rename is done once, in `gexHistory.ts`, and nowhere else.

```
net    = net_gex + net_vol_gex   (open interest + today's volume)
netVol = net_vol_gex             (volume only)
```

---

## 3. Candles (`candles.ts`)

```ts
interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }  // t = epoch ms of the bar's OPEN
export const HISTORY_DAYS = 5     // route clamps 1..30; replay and 2D/3D ask for 7
```

**`sanitize()` — a bar with a zero in it is not a bar.** The recorder's hot lane and the dxlink live
fallback can both hand over a bar still being assembled: close set, low or open still 0. Drawn as-is
that is one candle running from price to zero, which autoscales the pane to 0–9000 and flattens the
session to a line. *"Click SPX, get one long candle"* was exactly this. So:

- every field must be a real positive price;
- high/low are clamped around open/close so a stale extreme cannot survive;
- a wick wider than **25 % of the close** is a data fault, not a print → the bar is **dropped, never
  clamped**. The poll republishes the finished bar 30 s later.

**`nativeInterval()`** — the route only buckets to 1 m or 5 m. Anything above 5 asks for 5 m bars; a
1 h chart built from 1 m rows is twelve times the payload for an identical picture.

**`rollup()`** — 15/30/60 are aggregated client-side, **anchored to 09:30 ET**, not to the hour. An
hourly chart whose buckets start at 09:00 puts the cash open in the middle of a bar, which is the one
boundary that has to be a boundary. Uses `Math.floor` on the offset, not a truncating divide — pre-market
offsets are negative and truncation would fold 09:25 and 09:35 into one bucket.

**`filterSession()`** — RTH is a pure client-side row filter (09:30 ≤ m < 16:00 ET). lightweight-charts'
scale is index-based, so the 16:00 → 09:30 gap closes by itself; no session shading, no timeScale
surgery. Falls back to the full series rather than to an empty chart.

**`parseEsCandles()`** — the futures route is `SELECT *` out of Postgres, so BIGINT and REAL columns
arrive as **quoted strings** unless `lite=1` asks for the columnar tuple form. The card only ever asks
lite; the verbose branch is kept so a client deployed ahead of a backend that ignores `lite` still draws.

### The live price — push, with the poll demoted to a safety net

Polling has a floor: what reaches the chart is late by the interval **plus** the round trip, and halving
the interval doubles the requests to buy back half of one term. The SSE stream removes the interval from
that sum. Constants:

```ts
LIVE_FALLBACK_MS = 3_000   // poll cadence — only reached while the stream is silent
LIVE_QUIET_MS    = 8_000   // how long the stream may be quiet before the poll takes over
```

The route sends `retry: 3000`, so 8 s is comfortably past a healthy reconnect. Nothing detects whether
SSE "works": if frames arrive the poll never runs; if they stop it resumes on its own. **There is
deliberately no `onerror` that closes the stream** — closing it would turn one dropped connection into a
permanent downgrade to polling.

**Asking is subscribing.** `/live` registers interest in the symbol as a side effect and the hub drops it
~20 s after the last request, so an unmounted card stops costing a subscription upstream. Nothing has to
unsubscribe.

**Zero is a normal answer.** Outside 04:00–20:00 ET the hub never connects, and the first request after a
fresh subscribe lands before any bar has streamed. Callers must treat 0 as "nothing to push".

Three live-price transports, and the gates between them:

| Condition | Source |
|---|---|
| SPX, cash tape, not rewound | socket `spot` frame |
| SPX, ES tape, not rewound | socket `esCandles` (5 m) / `es1mCandles` (1 m), newest bar's close |
| `!esCapable` (any other ticker), not rewound | SSE stream + HTTP probe |
| Rewound | **none** — pushing a 15:59 print onto a 10:04 tape |

`!esCapable` is the gate on the HTTP path, **not** `!useEs`: on SPX the socket already does this, better,
and running both would paint two sources onto one bar.

---

## 4. The GEX history (`gexHistory.ts`)

```ts
interface GexCell   { strike: number; net: number; netVol: number }
interface GexColumn { slotTs: number; cells: GexCell[]; spot: number }   // slotTs = minute-floored epoch ms
```

Two URL shapes, and which one is used is decided by whether a **session has been chosen** — which only
replay does:

```
live     &minutes=<reach>&expiry=<front>                            (rolling window)
rewound  &minutes=0&date=<day>&expiry=<front>&expiryFallback=1      (one recorded session, by date)
```

**Why rewound cannot use the window branch.** The window branch filters on the expiry it is *given*
(`getOptionStrikeGexSlotsWindow`), and the recorder only ever writes the **front** expiry
(`gex-history-writer.js`). Yesterday's columns therefore sit under *yesterday's* expiry, so a window
request carrying today's front expiry came back empty for every session but today: the candles drew, the
bubbles and the rail did not, and a fully recorded session reported itself as *"no GEX history in view"*.
The date branch resolves the session's own expiry by **cash-session row count** (SPX's front expiry rolls
at the close, so post-close columns alone must not win the pick). `expiryFallback=1` is honoured **only**
when `minutes=0`, which is why replay needs a second URL rather than one more parameter.

`anyExpiry=1` is **gone**. It merged every recorded expiry's ladder into one column per minute — not what
this card is about, the bubbles are the gamma of the expiry being traded — and it made the server walk
every expiry's rows for the whole window on every poll.

**`latestSession()`** — the columns belonging to the newest ET calendar day in the payload. Semantic, not
"today", for two reasons: the newest session is **Friday** when the card is opened on a Saturday, and the
recorder **re-publishes the last cash book once a minute all weekend**, so a Monday request still comes
back holding Sunday rows — real rows, and a picture of nothing happening, drawn wider than the session
that did happen.

**Reach constants:**

```ts
GEX_HISTORY_MINUTES      = 720    // one session + pre-market, live
REPLAY_HISTORY_MINUTES   = 5760   // 4 days — the route's own clamp, i.e. "everything there is"
BUBBLE_LADDER_REQUEST    = 30     // strikes asked per column
```

`BUBBLE_LADDER_REQUEST` is deliberately a constant and **not** derived from `BUBBLES.levels`: asking for
exactly what is drawn would mean the ranking could never see a strike it did not already pick. Ask wide,
rank locally.

On a **weekend** the reach has to clear the weekend — 12 h back from a Sunday evening lands nowhere near
Friday. The card computes the distance to that Friday's 04:00 ET pre-open plus an hour instead.

---

## 5. Which expiry the bubbles draw

**The expiry is not a choice** (2026-09-04). There is no expiry picker. The card draws the **nearest
expiration, always**. `settings.expiry` survives in the type and in storage only so an existing saved
blob parses; nothing writes a pin and nothing honours one. That matters for anyone who *had* pinned a
date — with the control removed, a still-honoured pin would be a card stuck on a stale expiration with no
way back.

Three sources, in order:

1. **Weekend** — `/api/expirations` lists what is *tradeable*, so on a Saturday its first entry is Monday.
   Ask the history route for Monday and it answers honestly with nothing, and the card draws an empty
   layer all weekend — exactly when there is most time to look at it. So on Sat/Sun the expiry defaults to
   **the previous Friday's date**. That date is not in the expirations list (it has expired) and does not
   need to be: the history route takes `expiry` as a plain parameter and the rows are still in the table.
2. **`expiries[0]`** — the first date the real list comes back with; on a trading day that is 0DTE.
3. **Provisional guess** — while the list is genuinely unknown and it is not a weekend, the card guesses
   **today's ET date** and fires the history request immediately, rather than sitting behind a second
   round trip. *"Switching tickers doesn't load the bubbles"* was those two serial hops. On a trading day
   the guess IS `expiries[0]`, so the URL does not change and nothing refetches. On a holiday it is wrong
   once and corrected a moment later — the same blank the card would have shown anyway.

---

## 6. The ES−SPX basis (`basis.ts`)

An ES chart plots **futures** prices while its strikes are **SPX cash**, and the two sit 40–60 points
apart. Every strike must be pushed up by the basis before a bubble, a rail row or an EM rail can be placed
at it — otherwise every level lands one basis below the price it belongs to. *This is the bug v2 spent a
fortnight on in July 2026.*

**One source, deliberately:** `/proxy/es-spx-basis`.

- **ES** ← our own `es_candles` 16:00 ET close — the very contract the chart plots, so it is roll-correct
  by construction.
- **SPX** ← Yahoo `^GSPC` daily close — independent of the broker feed.

**Not** the socket's `spot.basis` / `aux.basis`: the broker's "SPX" quote really tracks ES, so that value
collapses toward zero and then freezes on the expired contract across a quarterly roll. v2 built a
four-tier fallback ladder around that fact; this card keeps only the tier that was ever right. The basis
decays about a point a day, so a daily anchor is not a compromise — a live one was the mistake.

```ts
{ basis, days: Map<'YYYY-MM-DD', number> }
isPlausibleBasis(b) => Number.isFinite(b) && b > 0 && b < 250
```

ES carries a **positive** basis to SPX (rates − dividends). Anything else is a data fault, and a wrong
basis silently bends every level — so it is **rejected, never clamped**. `basis` is the newest session's
and drives the live rail; `days` is one value per ET session and is what each *history* column is shifted
by, so a Friday bubble converts with Friday's basis.

`shiftColumns()` moves strikes and spot; **the GEX values are untouched** — the gamma is the gamma, only
where it sits on the axis changes. With no usable basis it returns the input unchanged, so the "no basis"
state is an *unshifted* layer rather than a missing one, and the status line says so.

**The live fallback.** When the proxy route answers `{ basis: null }` (no 16:00 ES bar yet on a fresh
table, Yahoo refusing, no `DATABASE_URL` on a dev box), the card samples **newest ES bar close − live SPX
spot** off the socket once a minute, rounded to the quarter point, and only during **cash hours** — `spot`
freezes at 16:00 while ES keeps trading, so overnight the difference is not a basis, it is the overnight
move. Refs plus a once-a-minute sample, never state per tick: the shift re-buckets the whole history and
the basis moves about a point a *day*.

When neither works the card prints, under the toolbar:

> `ES−SPX basis unavailable (…) — GEX levels are drawn at SPX cash strikes.`

A level quietly drawn one basis low is worse than a chart that admits it.

---

## 7. The bubble layer

### 7.1 The seven rules

From the `BUBBLES` block in `settings.ts`, in order:

| Rule | How |
|---|---|
| **1 bubble per bucket** | The trail is a *sample*, not a line. Bucket to 1 m or 5 m by the **bar interval**; last print in the bucket wins; the zoom strides what is drawn |
| **4 strikes, ≥1 a side** | Rank by \|netGex\|, **force** one above spot and one below, then fill from the ranking |
| **Grow with net GEX** | `r = floor + (\|gex\| / windowMax) ** 0.75 × (cap − floor)` |
| **Peers carry the sign** | Saturated blue `#29b6f6` for positive gamma, red `#ff4757` for negative |
| **The top strike stands out** | The bucket's largest is the one **gold** mark — white-cored gold gradient — plus a size boost, and a ring and glow in its own sign colour, which is where its sign comes from |
| **Old dots survive** | Never below `minPx` (1.2 px); age only fades opacity a little (`ageKeep` 0.75) |
| **No overlap if possible** | Same-bucket neighbours shrink toward the floor, then take a few px of X jitter; a second global pass holds every mark to `maxOverlap` |
| **History stays the day** | Nothing is ever spliced |

**Deliberately absent, so nobody adds them back:** a share cutoff (with four rows the fourth-strongest
strike is worth drawing by definition, so a second gate could only ever delete a row you asked for), an
auto row count (four plus a surprise is not simpler than four), and the **six sliders and Auto mode this
replaced**. A setting is a question you have to keep re-answering, and the chart has one right answer at a
time.

### 7.2 Why it is stamped and not stroked

Two earlier versions drew each row as a continuous stroke and both came out as **solid bars**, for the
same reason: they took their cadence from the *data*. One stroke per snapshot at a session's zoom is a
thousand strokes across fifteen hundred pixels, so whatever the radius they merge — and a bar is a
different **claim** than a trail. It says the level was one thing for the whole stretch, where the dots
say it was sampled, repeatedly, and here is what it read each time. Capping stroke length instead broke
rows into dashes the moment the gap exceeded the radius: the same failure from the other side.

### 7.3 The bucket, and why the interval picker moves it

The bucket used to be a consequence of the **zoom** (the smallest rung whose dots landed far enough
apart). That made the interval picker inert on this layer: 1 m → 5 m moved nothing, and 5 m → 1 m only
came back after zooming most of the way in.

Now the bucket **is the bar interval**, clamped into `bucketRungsMin: [1, 5]` — capped at 5 m, so 15/30/60
bars all draw a 5 m bucket. Past 5 m the answer is not a coarser *bucket* (which throws away the prints)
but the **stride** (which keeps the bucketing honest and draws every Nth).

Reported from the chart (`reportBucket()`), on the click, not on the next frame, de-duped to the value.

### 7.4 The stride

There is a hard physical limit here: **975 samples across 1,500 pixels is 1.5 px each**, and you cannot
draw 975 distinguishable circles in that. Shrinking them does not help — two 1.2 px dots 1.5 px apart still
touch. So when they cannot all fit, only every Nth bucket is drawn. Nothing is faked; each drawn dot is
still one real bucket, last print and all. Zoom in and the stride falls back to 1 and every bucket is
there again.

```ts
bucketPxPerDot = 11    // the legible spacing drawn dots are thinned to
pinnedPxPerDot = 2.5   // only for an explicit 1m/5m PIN
minLegiblePx   = 3.5
```

**Why 11 and not smaller.** `capOfSpacing` sizes every mark off the *effective* spacing and `minPx` is the
hard floor underneath. Below ~4.3 px per drawn dot the cap has fallen to the floor and every row of the
bucket draws at 1.2 px: four levels, one size, no ranking. Measured on a 770 px plot — at a 2.5 px target a
1 m bucket gives top 1.95 px / 4th 1.26 px on a 2.5 h window; at 11 px the same window gives 5.85 / 1.99.
The spread survives.

**Do not apply `pinnedPxPerDot` to the interval-driven default.** It was, for a few hours on 2026-08-31, on
the reasoning that an interval-driven bucket is a chosen cadence too — and it is, but the loosened stride is
a **size** decision, not a cadence one. The result was every mark on the floor past a ~2 h window, the size
channel dead, and that morning's `sizeCurve` / `floorOfCap` tuning completely inert.

`pxPerDot` is measured **locally** — two instants one bucket apart near the middle of the plot — not off the
data's whole span. The span version reported the plot's own width for a whole day of snapshots no matter how
far in you were, so the bucket looked a fraction of a pixel wide and the stride threw away almost everything.
Anchors are tried in order (pane midpoint → middle snapshot → last → first) and the first that yields a real
gap wins, so a pane whose middle sits in whitespace still gets a spacing.

### 7.5 Size, per rung

```
t  = (1 − rankMix) × (|gex| / windowMax) ** sizeCurve  +  rankMix × rank
rx = floorPx  + t × (capPx  − floorPx),   × topBoost, capped at topCapPx
ry = floorYPx + t × (capYPx − floorYPx),  × topBoost, capped at topCapYPx
```

| Rung | capPx | floorPx | topBoost | ringPx | aspect | rankMix |
|---|---|---|---|---|---|---|
| 1 m | 9 | 1.6 | 1.60 | 1.1 | **1.15** | **0.4** |
| 5 m | 13 | 2.5 | 1.55 | 1.4 | 1 | 0 |
| 15 m | 16 | 3.0 | 1.50 | 1.6 | 1 | 0 |
| 30 m | 18 | 3.5 | 1.46 | 1.8 | 1 | 0 |
| 60 m | 20 | 4.0 | 1.42 | 2.0 | 1 | 0 |

**The numbers are per bucket size because they have to be.** A 13 px cap is right at 5 m and absurd at 1 m:
five times the dots in the same width, so marks that clear each other at 5 m fuse into ribbons at 1 m. That
is not a tuning failure, it is the same number being asked two different questions — and the fix is not one
cleverer number, it is one per rung. Rungs between the listed ones take the nearest profile **below**.

**`aspect` and `rankMix` are 1m-only, deliberately.** At 5 m and coarser the profile cap binds first, the
four rows already rank by eye, and the marks are round — that picture is right and is not to be touched. Both
1 m rescues live in the profile, and every coarser rung carries the identity values (`aspect: 1`,
`rankMix: 0`), which make the arithmetic the exact expression it was before they existed.

- **`aspect` 1.15** (was 2.4). 2.4 was answering a ~3.4 px spacing the stride no longer lets happen, and it
  drew a column of **tall tick marks** — 6 px wide, 15 px high on a 2.5 h window. At 1.15 a mark is a bubble
  with a hint of height: round enough to read as one sample, still taller than wide so a crowded bucket has
  somewhere to give.
- **`rankMix` 0.4.** `sizeCurve` alone says nothing when a bucket's four strikes are within a few percent of
  each other, or when the whole bucket is quiet and every row lands near the floor — both common at 1 m, both
  drawing as four identical specks. 0.4 and not more: past about half the budget a mark stops reporting
  magnitude and starts reporting only its position in a list. The blend is **monotone in the rank** and the
  marks are already sorted by \|netGex\|, so the ORDER never changes.

**The shared constants and their history:**

```ts
sizeCurve    = 0.75   // 0.5 → 0.62 → 0.72 → 0.75. ON the ceiling on purpose. Past ~0.75 the law is
                      // effectively linear again and everything below the leader collapses to the floor.
floorOfCap   = 0.14   // 0.45 → 0.25 → 0.14. At 0.45 a wide zoom left 2.5px between smallest and largest.
capOfSpacing = 0.46   // 0.28 → 0.46. PEERS only. At 0.46 a peer's diameter is 0.92 of the spacing.
topOfSpacing = 0.56   // 0.44 → 0.56. PAST the geometric limit (0.5) ON PURPOSE — consecutive leaders
                      // overlap by ~a tenth of their width. That was the ask: bubbles rather than ovals.
minPx        = 1.2    // absolute floor
```

`capOfSpacing` bounds the **peers only**. It used to be divided by `topBoost` so the boosted leader fit
inside it too — which meant one dot per bucket dictated the size of all the others, and the whole ladder paid
a 30–40 % tax for a mark that already has a ring and a glow. The leader gets `topOfSpacing` instead: larger,
and still a bound. Let it off the leash and at a tight zoom it draws at cap × boost — 14 px of radius into
15 px of room — and the top row fuses into **one continuous sausage**.

If the overlap ever needs to go further, the honest lever is the **stride**, which buys room rather than
spending room that is not there.

### 7.6 windowMax — one denominator for everything on screen

`ratio` = \|value\| / windowMax, and that ratio is the radius. Per-bucket normalisation would renormalise
every quiet minute back up to full size, which is what made the trail bulge and pinch instead of tapering.

**Under replay it is overridden.** The card clips columns to the cursor, so the default denominator would be
"the biggest wall revealed *so far*" — and the moment the cursor steps onto a bucket carrying a bigger one,
every dot already on the pane shrinks. At 1× that reads as the trail breathing; at 8×, with a frame every
~90 ms, it is visible jitter, and it lands exactly where the session's running maximum steps up rather than
evenly across the day. So the replay path passes `bubbleWindowMax(sessionColumns, …)` — the max over the
**whole** session — and a dot's size means "this bucket's share of the day", which is the reading it was
always supposed to have and the one it only actually had at the close.

### 7.7 Placement — a bucket sits on its candle

This is the alignment contract and the whole reason the layer works. Four bubbles over four candles have to
sit **on** those four candles, not between them.

`geo.xOfTime(ms)`: binary-search the **real bar array** (`barTimes`) for the bar containing `ms`, ask
lightweight-charts for that bar's coordinate (which is the bar's **centre**), then add the sub-bar fraction ×
`barSpacing`.

**Two things it replaced, both bugs:**

1. `timeToCoordinate(ms)` directly — answers only for timestamps literally *in* the series; it does not
   interpolate. The GEX history is per minute and the candles are 5 m or coarser, so a bucket almost never
   lands on a bar and the layer vanished intermittently on nothing more than whether it did.
2. A binary search over `coordinateToTime()` — that is a **step function** (nearest bar's time), so a search
   on `t < ms` converges on the step, which sits at the **midpoint between two bar centres**. Every bucket was
   stamped on the seam between its candle and the one before it: **off by half a bar, every mark, always.**

`barTimes` must be the real array, not arithmetic off `intervalMs`: 15 m and coarser anchor to 09:30 ET, the
RTH close forces a short bar at 15:30, and any feed gap leaves a hole. A computed timestamp under any of those
is not a bar, `timeToCoordinate()` answers null for it, and a whole overlay disappears with no error anywhere.

`barAt()` gives **two bars of slack** past the end rather than clamping — a GEX minute can legitimately arrive
before the candle feed has printed the bar it belongs to, and culling the newest column every time the candles
lag is a worse bug. Further out gets no pixel, which is what stops a stale morning of GEX stacking onto the
closing bar.

### 7.8 The global overlap fit

`placeBucket` only ever fitted marks against the other strikes in **their own bucket**. Nothing looked across
buckets — fine once the day is wide, wrong at the open, where the pane is already scaled for a session and the
first ten minutes land in a handful of pixels. Four rows × ten buckets in one column is a blob, and it is not a
sizing bug: every one of those marks is real.

So `drawBubbles` runs a second, **global** pass over every mark on the pane:

> penetration between two marks may not exceed `2 × maxOverlap × min(ra, rb)` along the line between their
> centres.

`maxOverlap = 0.5` — "no mark is covered more than half way": the edge of one may reach the centre of the other
and no further. 0 would read as a sparse grid at the open; 1 is no limit at all.

Greedy **by priority**: the bucket's leader first, then by area. Whatever is already accepted keeps its size and
the candidate yields — shrinking to fit, or **dropped** when even a speck would be more than half covered (which
is exactly when its centre is already under a mark that got there first). Leaders going first is the point: at
the open the column is mostly peers, and what survives should be the walls.

Binned by x at 48 px so it stays linear-ish — without that, a day of 1 m buckets is ~1,600 marks in a pairwise
pass inside the chart's rAF, **every frame**.

Both this and `placeBucket` need the radius of an **ellipse along a direction**, not its axes: two marks an
equal number of pixels apart overlap differently depending on whether the line between them runs up the price
axis or across the time axis. `dirRadius()` is the exact ellipse radius along the unit vector.

Within-bucket fit constants: `gapPx 0.8`, `fitPasses 6`, `jitterPx 3`. The fit is **vertical** and spends `ry`
— shrinking `rx` would give back width that was never the problem, and cost the size read twice over. After the
fit, `rx = min(rx, ry)`: a mark is never wider than it is tall.

### 7.9 Colour

| Token | Hex | Role |
|---|---|---|
| `--color-gex-pos` | `#29b6f6` | Positive gamma — peer fill, leader's ring + glow |
| `--color-gex-neg` | `#ff4757` | Negative gamma — same |
| `--color-gex-lead` | `#ffb300` | Leader's gradient rim |
| `--color-gex-lead-hi` | `#ffd76a` | Leader's gradient mid-stop |
| `--color-fg` | — | The gradient's innermost specular highlight (a token, not a literal white, so a light theme moves it) |

**Peers carry the sign; the leader is gold.** Gold because gold already means "the wall" on this card — the CB
tag on the rail, the amber half of the GEX bars. One hue, one idea, and a glance finds the biggest wall without
reading anything.

**Two things were tried and are not to be repeated**, both for the same reason — the small end, where rows 2–4
draw at 2–4 px:

- gold on **every** mark with a sign ring (mocked 2026-09-03) — a fill plus a sub-pixel ring is one olive smudge
  and the sign is gone;
- pale sign tints on every mark (2026-08-31, reverted the same day) — the tints desaturate toward the background
  and a pale pink 2 px dot is not distinguishable from a pale blue one.

The leader's own pale tint (`--color-gex-pos-hot` / `-neg-hot`) went with the gold change: both tints were
near-white and near-identical, so the core said "leader" but never said *which way*, and the ring was already
carrying the sign alone.

**The ring is a proportion of its mark**, not a fixed width: `ringOfRadius 0.13` × the mark's half-width,
clamped into `[ringMinPx 0.45, the rung's ringPx]` — so `ringPx` in `profiles` is a **ceiling**. It used to be
the width outright, and `profiles` is keyed by rung, so it did not move when the **zoom** did: 1.4 px on a 40 px
mark is a fine gold-coin edge; the same 1.4 px on a 5 px mark is a third of the diameter, the gold core is a
speck, and the trail reads as a row of red and blue beads. The mark shrank; the border did not.

It is also drawn **inset by half its width**, so it sits inside the mark's edge instead of straddling it —
straddling both ate the outer band of gold and grew the mark past the radius the size law gave it.

**The glow** (`glowFactor 0.6`, `glowMaxPx 7`, `glowAlpha 0.6`) is a **ceiling, not an amount**: the blur drawn
is also held to the room left beside the mark once its own radius is taken out of the spacing, and at a tight
zoom that room is zero and the glow simply does not draw. A 7 px halo painted across a 2 px gap is what turned
the leader's row into one continuous sausage — the marks were clearing, the blur was not. `glowAlpha` is
multiplied by age; at the old un-named 0.95, under a core the age fade had made translucent, the halo showed
*through* the mark, which is how the negative leader came to look like a red dot with a white outline.

The gradient is built in the **mark's own space** (`translate`, `scale(1, ry/rx)`, `arc`, then restore) — painted
in canvas coordinates it stays circular while the mark is an oval, so at 1 m the rim colour lands at the top and
bottom of a tall mark and never reaches its sides.

**`strikeMode`** (`'per-bar'`, the resting value): each bucket keeps the strikes *it* chose, so a wall that ran
the 11:00 high keeps its dots up at the high where it happened. `'latest'` locks the Y set to the current
bucket's picks and plots those strikes backward through the session. Neither ever splices a snapshot. There is
**no dwell, no hysteresis, no smoothing** — every one of those was a patch for the continuous renderer, where a
strike dropping out for a print left a hole in a line. A dot that is not there for one bucket is just a gap in a
chain of dots, which is what a sample looks like.

---

## 8. The GEX rail (`GexRail.tsx`)

A 96 px column to the right of the chart. **Shape:** the level tag on the left, then a single left-anchored bar
that always grows **right**, one strike per line. The strike price and the dollar value are deliberately absent
— the chart's own price axis already labels the height and the bar's length already says the size, so printing
either again is noise in a 96 px column. Sign survives in the bar's colour. The exact figure is one **hover**
away (`title`, formatted `+1.2B`).

**One direction.** Every bar is anchored to the same left edge, positive or negative — the centre hairline is
gone, so the full width is spent on magnitude and the eye compares lengths off one baseline instead of two.

**Named tags, not anonymous dots.** Three dot colours is a legend to memorise; "CB" is not. The tag is the
**only** thing that marks a level — no row wash, no bar outline. A strike can be two levels at once and each gets
its own tag. The tag column keeps its width whether or not a strike is tagged, so every bar starts on the same x.

### 8.1 The three levels

```
CB  Core Bullseye — the biggest |GEX| strike on the ladder       --color-level-cb  #ffd600
CW  Call wall     — biggest +GEX above spot, CB excluded          --color-level-cw  #29b6f6
PW  Put wall      — most −GEX below spot, CB excluded             --color-level-pw  #ff4757
```

**CB is excluded before the walls are picked** — the same rule the Multi Greek ladder follows. The biggest node
on the board is frequently also the biggest on one side of spot, and without this the core and the wall land on
one strike, losing the level price actually has to get through *after* it.

Legacy history rows carry `spot: 0`; the recorder centres the ladder on spot, so the **middle of the ladder** is
the honest fallback — the same one the bubble model makes for the same reason.

### 8.2 Why the rows are absolutely positioned

A rail beside a chart is only worth anything if a strike's row sits at the **same height** as that strike on the
chart. A flowing list cannot do that: its rows are evenly spaced and the chart's are not — the scale autoscales,
the user pans and zooms, and the gap between two strikes in pixels changes constantly.

So every row is `position: absolute` and its `top` comes from the chart's own `priceToCoordinate`, delivered once
per animation frame through the **`RailSink`** the chart already runs its bubble layer from. Same mapping, same
frame — the rail cannot drift from the bubbles or the candles because it is reading the number they were drawn
with.

That positioning is **imperative, straight onto the DOM node** (AGENTS.md rule 4: a tick never travels through
React state on its way to a chart, and a pan gesture is sixty ticks a second). Writes are compared against the
value already on the node — a write per row per frame is sixty style invalidations a second for a rail that mostly
is not moving — and `y` is rounded so text does not land on a half pixel and blur.

The height handed to the sink is the **plot's** (`plotH`), not the container's: the time axis owns the bottom
~26 px and there is no price down there.

### 8.3 Thinning

The ladder holds ~30 strikes. Zoomed out they can land within a pixel of each other, and a rail of overlapping
text is worse than no rail. Rows are placed in **priority order** — the three named levels first, then by \|value\|
— and any row that would land within `ROW_H` (15 px) of one already placed is hidden. Rows within `EDGE_PX` (2)
of the pane's top or bottom are dropped. So what survives a squeeze is always the part worth reading, and every
row you can *see* is exactly level with its strike.

Rows start `visibility: hidden` with no transform until the first frame positions them, otherwise every row paints
stacked at the top of the rail for one frame on mount. Rows that leave the ladder are deleted from the node map, or
the sink keeps positioning a detached node forever.

---

## 9. On-pane levels: CORE / CW / PW and EM±

Both are drawn on the overlay canvas, **above** the bubble early-return, so they survive the bubbles being switched
off or having no history yet — a card with bubbles off is exactly the card that still wants to know where the walls
are. Both clip to `(plotW, plotH)`.

### 9.1 CORE / CW / PW tags

`railModel.levels`, not a second calculation — the tags on the chart and the tags on the rail are the same three
strikes off the same newest column, and on ES they are already through the basis because `columns` is shifted
upstream of both consumers.

**A tag only, no line.** Left edge, not right: the price scale is on the right and the rail after it, so a tag over
there would sit on the axis labels beside a rail row saying the same thing. The dashed hairline that used to run with
each tag is gone — three horizontals across a pane already carrying candles, bubbles and a heatmap competed with the
price action, and none said anything the tag does not: **the tag sits AT the level, so the height IS the line.** What
the line carried and the tag did not was the *number* — so the price now rides in the tag, formatted with the same 2
decimals the price scale uses, and the tag and the axis cannot read as two different numbers.

Chips are drawn at `y − 6`, 12 px tall, `700 9px` sans. Half-pixel y (`Math.round(y) + 0.5`) so a 1 px line is one
crisp row rather than two grey ones.

### 9.2 The daily expected-move rails (EM+ / EM−)

`--color-level-em` `#b07be0`. **One token for both edges**, because they are the two edges of *one symmetric band* —
painting them up-green and down-red would read as direction where there is none by construction. Violet is the one
family this pane is not already spending: the walls own blue and red, the core gold, the candles green and red.

**This is NOT the GEX Chart's ±1σ tiles.** Those read `/api/em-tracker`: the **weekly** band. This is the **daily**
one — the front expiry's ATM straddle, anchored to the **previous session's close** — from `/api/daily-em`
(`server-v2/daily-em.js`). Two different questions, two different numbers.

**Read, never derived.** The band is computed and **frozen server-side**: the first read of an ET session writes the
row, every read after is served from it. A band recomputed client-side would drift all session as the straddle
decays, so two traders looking at the same chart at 10:00 and 14:00 would be looking at two different lines, and the
earlier one could never be referred back to. *"Price rejected the EM high"* has to mean something an hour later. The
client also **cannot** fall back to computing its own: neither the socket's GEX rows nor the candles carry an IV or a
mark, so there is no straddle here to price. No row, no rails — the honest answer, not a degraded one.

The 5-minute poll is **not about staleness** (the row does not change once written). It exists so the *first read of
the day* — which is what writes it — actually happens on a board left open overnight, rather than the chart sitting
rail-less until somebody reloads.

**⚠ The basis is the caller's job.** The band is quoted in SPX cash; an ES pane plots futures 40–60 points above it.
The walls get their shift upstream in `columns`; this band arrives from its own route and is shifted in `emDrawn`
with **today's** basis (a band is one session's, so there is only ever one session to convert).

**Chip collision.** Both families live on the left edge, so an EM chip that would land within `CHIP_H` (12 px) of a
wall chip **slides right**, past the far edge of whatever is already there. It never moves **vertically** — the
height is the price, and a tag nudged off its level is a tag that lies. A chip pushed clean off the pane falls back
to the margin and overlaps, because a coloured stub carrying no number is worse. This collision is *not rare on
purpose*: the call wall sitting on the EM high **is** the day's setup, and it is the one moment this layer must not
turn into one chip drawn over another.

**`emLines` is its own switch, under `emLevels`.** The tag says *where* the boundary is; the line is what lets you
watch price travel toward it, stall under it, or go through it. On a busy pane the line is the half you may not
want, and losing it should not cost you the level. Off, the EM marks are drawn exactly like CORE/CW/PW. The line
starts **after** the chip rather than running under it — a dashed rule crossing its own label is the one place this
layer could look like a rendering fault. Dash `[3, 4]`, alpha 0.45.

A rewound session that predates the table answers with **no band** and the rails simply do not draw. Hanging today's
band over a rewound Tuesday would be a level that is plainly false, and false is worse than absent.

---

## 10. The chart shell (`chart.ts`)

Loaded through a **dynamic import** so lightweight-charts lands in its own route chunk and the entry bundle every
other card pays for on first paint never sees it.

### 10.1 Colour rule

Colours are read out of `tokens.css` at mount with `getComputedStyle`. `cssVar()` carries **no literal fallback**,
deliberately: every token read is declared on `:root`, so a hex second argument could only fire if the stylesheet
failed to load — at which point a correct GEX-bubble blue is not the problem. What the fallbacks *did* do was
duplicate the palette in a second place nothing keeps in sync; a theme edit once moved the token and left thirteen
stale hexes behind it. An empty return is a real bug and warns to console. `hexToRgb` keeps its numeric fallback
because the bubble layer needs three numbers to build a per-mark alpha with, and an `[r,g,b]` triple is arithmetic,
not a colour literal.

Canvas alphas are written as **8-digit hex** (`shade()`, `tokenHexAlpha()`), because `rgba()` / `hsla()` are banned
from `src/` by `scripts/check-theme.mjs` (non-negotiable #1) and the hex form is accepted by every canvas fill,
stroke, shadow and gradient stop.

### 10.2 Chart options worth knowing

- **No grid.** The bubble layer is the thing being read against price, and a ruled background competes with it — a
  horizontal line through a column of marks reads as a level, which is exactly the signal the bubbles carry. The axis
  **borders** stay: they frame the plot, they do not cross it.
- **`attributionLogo: false`.** lightweight-charts draws its TradingView mark *inside* the pane, bottom left — over
  the candles, over the bubbles, and in every CopyShot. It is re-rendered in the **card header** by `<TvAttribution>`
  instead. It must stay somewhere and visible — that is the library's licence, not a style choice. **Do not delete
  that line without deleting the header link, or the chart quietly ends up with no attribution at all.**
- **Time axis is ET** via `tickMarkFormatter`, because the session boundaries this chart is read against are ET. A
  browser-local axis would put 09:30 at a different number for every user.
- **Prices format to 2 dp**, and the on-pane chips use the same, so they cannot disagree.

### 10.3 Volume

An **overlay** histogram on its own price scale (`priceScaleId: 'vol'` — any id that is not `right`/`left` makes it
an overlay), **not a second pane**. A pane would take height from the candles and — the real problem — put the
bubble overlay's single canvas across two panes with two coordinate systems, so every mark would be placed against
whichever one `yOfPrice` happened to read. One pane, one scale, one set of coordinates.

`VOL_TOP 0.8` (the strip owns the bottom fifth), `VOL_CANDLE_BOTTOM 0.24` (what the candle scale gives up while it
is showing), `CANDLE_TOP 0.08`, `VOL_ALPHA 0.34`. Colours are the same candle tokens washed back — a volume bar can
never disagree with the candle above it, and is coloured by **that bar's own direction**, not by the previous close.

Volume is deliberately **not** updated by `setLivePrice`: the live probe carries a price, not a size, so an invented
forming bar has no volume and the strip has a gap there until the poll publishes one. A made-up size would be worse.

### 10.4 The last mile — `saneBar`

`candles.ts`'s `sanitize` already refuses a bar with a zero in it, and every live-price producer refuses a
non-positive one — and the pane **still** autoscaled 0–8000 with one wick running to the floor, repeatedly. So the
guard was in the wrong *place*: at the parse boundary, with the failure downstream of it.

There are **three doors** into the series — `setData` for the history and two `series.update` calls for the forming
bar — and each used to hand its object straight to the library. One bad datum out of any of them puts zero in the
autoscale: the pane is ~600 px, the range becomes 0–8000, and a 60-point day is seven pixels of that. **The cost of
one bad bar is the whole chart.**

Now every door takes the same check (`close/open/high/low > 0`, finite, high ≥ max(o,c), low ≤ min(o,c),
`high − low ≤ close × 0.25`) and anything failing is **dropped, not clamped**. A bar we cannot vouch for is one the
next poll will publish correctly seconds later; drawing a repaired guess is how a fault becomes invisible instead of
fixed. `warnOnce` names the offending bar in console **once per chart per door** — silent to the user is by design,
silent to the developer is how this survived three fixes at the parse boundary.

### 10.5 The forming bar, and `synth`

The candle feed only ever hands over **closed** bars, so `live` is the last *finished* bar and `openMs + intervalMs`
is already in the past when it arrives. The old guard returned on that, which meant on a 1 m chart **every live tick
was dropped** and the price only moved when the 30 s poll landed.

So `setLivePrice` **opens the next bar** instead of going quiet, stepping **one interval from the last bar's own
open** — which keeps the new bar on the feed's grid whatever that grid is anchored to (09:30 ET for 15 m and
coarser). Strictly one bar ahead: past that there is a gap (an overnight, a halt, a sleeping tab) and the poll owns
it.

**The new bar's open is the previous close, not the first tick this tab saw.** Seeding `o = h = l = c` from the
arriving price makes the bar a function of *when this tab started watching*: reload mid-minute and the forming candle
begins again from whatever was printing at that instant, and two tabs opened seconds apart disagree about a bar they
can both see. The previous bar's close is a function of the **data**, so every tab reconstructs the same bar from the
same closed history however late it arrives.

**`synth`** holds the forming bar *this chart invented*, separately from `live`. Without it, every candle refresh
dropped the forming bar's accumulated high/low: `setData` rebuilds `live` from the newest closed bar the poll
returned — the one *before* the bar being drawn — and the next tick started the minute over. `setBars` hands the
invention back if the clock is still inside it, and retires it the moment a real bar covers that open.

**`reframe` kills `synth`.** Carried across a symbol switch it gets handed straight back — the new tape's newest
closed bar can sit exactly one interval behind the invented one — so an SPX-priced candle is appended to a SOXL
series, the pane autoscales 0–9000, and the last-value label reads the old symbol's price for half a minute.
*"Switch SPX → SOXL, chart stays on the SPX price"* was exactly this.

**Sanity on the tick itself:** `price > 0` was the whole test, and "positive" is a much weaker claim than "belongs
here". A live print is an *extension* of the bar it lands on, so it must be within `SANE_RANGE` (25 %) of that bar's
close. Dropped, never clamped.

**No `version++` on an ordinary tick.** The bubble band and the rail are drawn from `snaps` and the price scale —
never from the forming bar — so a tick is not a reason to repaint them. If the tick *does* move the scale (a new high
autoscales the pane), `viewSignature()` sees that on its own. Bumping here forced a full-band redraw on every quote,
several times a second, forever.

### 10.6 Framing — the pane is today's session

The window is always **one RTH session wide** (390 minutes of bars) positioned so today's 09:30 sits on the left edge
and 16:00 on the right. The day therefore fills the pane at every hour, and earlier in the day the remaining
whitespace is the part of the session that has not happened yet — the correct amount of room to leave, not a gap to
close.

**Early in the day the live candle is centred.** Anchoring at 09:30 from the first bar would open on one candle
jammed against the left with six blank hours beside it. So:

```
from = min(sessionStartIdx, newestIdx − span/2)
```

At 09:35 the second term wins and the live candle sits mid-pane with yesterday's tail behind it. As the day fills the
term rises until it passes 09:30 (a little after midday) and the window pins to the session. It slides continuously —
the two expressions are equal at the crossover, so there is no jump.

A floor of **30 bars** covers the coarse intervals: 390 minutes is six bars at 1 h.

**What this replaced:** `from = barCount − n`, a window measured backward from the newest bar. It ignored the session,
so the pane was always "the last 390 minutes of trading" and on a fresh morning that is most of yesterday afternoon
with today squeezed into the last inch — *"the chart keeps opening up small"*. And before that, `fitContent()` fitted
the whole five-day pull: ~1,950 bars at 1 m in ~900 px, half a pixel each, with the bubble layer strided down to
nothing.

**`ensureLatestVisible()`** — the newest bar must survive a timeframe change. `frameRecent` sets the range
synchronously after `setData`, but lightweight-charts re-lays the time scale on its own next frame, and when the bar
count has just changed by an order of magnitude (1 m → 15 m is ~1,950 → ~130) the range it settles on can be derived
from the **old** base index. *Switch timeframe, lose the live candle.* So the frame is checked at rAF, at 150 ms and
again at **600 ms** (a tab that becomes visible can lay out well after 150 ms), and re-applied if it did not take.
Idempotent.

**"The newest bar is on screen" is not enough** — that was the whole test, and it passed on the exact view people were
complaining about: a card that mounts in a hidden board tab (`clientWidth 0`) gets its range applied against a scale
with no width, and what comes back is a pane of whitespace with the whole session crushed into the last inch. So it is
also wrong if the pane is **mostly empty** (`visibleDataFraction < 0.4`) or the zoom is **nothing like a session wide**
(`> span × 1.6`). This runs **only** from the reframe branch, never on the 30 s poll, so it can never fight a chosen
zoom.

**`reanchorIfStranded(prevCount)`** — the *"come back to the tab and there is a huge gap"* bug. Whitespace on both
sides with candles squeezed in the middle is not a drawing fault: it is the visible **logical range** surviving a
`setData` that gave the series a different number of bars. Nothing in lightweight-charts re-anchors it. It takes the
bubbles down with it — the layer measures `pxPerDot` off the current zoom, so a range stretched past the data reports
almost no room per bucket and throws most of the dots away. Deliberately narrow, because `setBars` runs every 30 s:
re-anchor only when **nothing at all** is on screen, or when the series **shrank** and under 30 % of the pane is
candles. A deliberate scroll into whitespace beside a stable series matches neither.

**`recoverView()`** — the same repair on the *activation* path: `visibilitychange` back to visible, or a
`ResizeObserver` seeing the container go from no box at all to a real one (a board page you were not on, a collapsed
panel). `reanchorIfStranded` alone was not enough because it only runs inside `setBars`, so a stranded view stays
stranded until the next poll happens to change the bar count in the one way it tests for. Looser threshold (< 30 %) and
deferred a frame — while the tab was hidden rAF was stopped, so asking the time scale where it is before the browser
has re-laid out gets an answer from before the resize.

### 10.7 The draw loop

A steady rAF loop rather than chasing every event that can move the price axis — pan, zoom, autoscale and resize all
qualify, and enumerating them one at a time is how an overlay ends up half a pixel behind its chart.

**But the loop must not WORK every frame.** It used to: sixty times a second it read `getBoundingClientRect()` and
`ts.height()` (two forced layouts), positioned every rail row, and redrew the whole band. Chrome logged it as a **52 ms
rAF handler and a 47 ms forced reflow, on a chart that was sitting still.** Three changes:

1. Size comes from a `ResizeObserver`, not a per-frame layout read.
2. `ts.height()` is cached and refreshed with it.
3. **Nothing is drawn unless the view actually moved.** `viewSignature()` probes both scales at fixed reference points
   — pure scale arithmetic, no layout — and the frame is skipped when the signature matches.

The signature is `version | boxW | boxH | plotW | rangeFrom | rangeTo | y0 | y1`.

- The **time** half uses the visible **logical range**, not `timeToCoordinate()` on two timestamps. That was the first
  attempt and it was silently broken: `timeToCoordinate` answers only for times *in* the series, and the probe times
  came from the per-minute GEX history while the candles are 5 m or coarser. Both probes returned null on nearly every
  load, so the horizontal half was the constant `"n|n"` and **a pure sideways pan never redrew the layer.**
- The **price** half probes two distinct prices, not one: a zoom anchored on a point leaves that point where it was, so
  a single probe cannot see it.
- `version` is bumped by every **setter**, so a data change always redraws even when the view has not moved a pixel.
- Mid-teardown the probe throws and returns a value that cannot match, so the frame draws and the next one finds the
  loop cancelled.

**Visibility (non-negotiable 5).** The loop keeps being *scheduled* — cancelling it would mean re-arming from the
visibility edge, and rAF is already stopped outright by a hidden tab — but it must not **work**. `isVisible()` is
`ChartFrame`'s `handle.visible`, checked before `readPlotW()`, so a hidden card costs one boolean per frame. On the
first frame back in view, `missedWhileHidden` clears `lastSig` and forces one repaint, because the view almost
certainly moved while away and the new signature could still match the last one *drawn*.

**`plotW` / `plotH`.** The overlay spans the whole card and the plot does not, and `coordinateToTime()` keeps answering
for an x already underneath the price scale — it is index arithmetic, not a hit test. Without these the newest buckets
were stamped **straight over the price labels**. `plotW` is re-read every frame (cached model state, not a layout read)
because the scale widens on its own when the price gains a digit. The bubble draw also **clips** to the plot rect, so an
edge dot is cut off by the axis the way it is in every other chart instead of vanishing a bucket early.

**`data-cb-layer="bubbles"`** on the overlay canvas (non-negotiable 6). Without the tag `scripts/perf-check.mjs` skipped
it entirely, and because its interaction assertions sum repaints for the `gex-candles` card, they summed over **nothing**:
*"panning still redraws (0)"* and *"zooming still redraws (0)"* failed on every run and **could not have passed**. A guard
that reports zero because it is measuring an untagged canvas is worse than no guard.

### 10.8 Axis lock

The replay transport's 🔒 button. Two things drift while a rewound chart is scrubbed:

- **Price.** Replay hands `setBars` a list clipped to the cursor, so autoscale re-derives the window from however much
  of the day has been revealed — one candle's range at 09:35, the whole day by 15:00. A level that has not moved appears
  to slide, which on a screen recording reads as the market moving rather than the frame.
- **Time.** A `setData` with a different bar count can leave the visible logical range somewhere else.

**The price half is a RANGE, not a freeze.** The obvious implementation is `autoScale: false`, and it is wrong: it pins
whatever window happened to be showing, which for a replay that opens at 09:30 is the first bar's few points, and the
rest of the session runs straight off the pane. So the card hands over the range of the **whole session being replayed**
(`replayPriceRange`, min/max over the *unclipped* `dayBars`) and `autoscaleInfoProvider` returns it every frame.
Autoscale stays **on** — the provider is only consulted while it is — and `scaleMargins` still apply on top, so the day's
high and low get the same breathing room. The provider is installed once at mount and reads two mutable values, so
nothing has to re-apply options as the lock goes on and off. Autoscale is re-asserted on every `setAxisLock` because a
manual drag of the price axis turns it off **permanently**.

**The time half: stop the shift, do not undo it.** lightweight-charts scrolls the visible range by one bar whenever a
bar is appended (`shiftVisibleRangeOnNewBar`, on by default) — right for a live tape, wrong for a rewound one where
every cursor step appends a bar. The first version left that alone and put the range back afterwards in `setBars`, and
**those two writes per frame are what the bubbles were jittering between**: the overlay is painted from our own rAF and
can sample the time scale before the correction lands, so the marks pick one of two positions a **bar** apart — ~19 px
at 5 m, a shimmer at 1 m. The candles looked fine because the library draws them inside its own commit, after the
argument is settled. Now the option is turned **off at the source** while locked, and the `setBars` restore is a guarded
backstop that only writes when the range actually moved.

> Note (2026-09-09): the replay jitter was briefly "fixed" by having the caller pass its own bucket into `drawBubbles`
> instead of the median-of-diffs estimate. That was a guess and it was the wrong one — the jitter was this axis fight —
> so the estimate is back. Do not re-do it without a measurement showing the median actually moves.

---

## 11. Settings

Stored at `localStorage['cb-v3-gex-candles:' + cardId]`, **one blob per card instance**. v2 keeps these in a "slot"
blob so three charts can share a toolbar; v3's chart is a board **card** and the board already gives each card its
identity — same idea, one less level of indirection, no shared/own mirror to keep in sync.

| Key | Default | Meaning |
|---|---|---|
| `symbol` | `SPX` | Only read on copies (`#2`, `#3`, …) |
| `session` | `eth` | `rth` = 09:30–16:00 ET; `eth` adds the overnight |
| `interval` | `5` | 1 / 5 / 15 / 30 / 60 minutes |
| `tapeDays` | `1` | 1D / 2D / 3D of candles |
| `bubblesOn` | `true` | Master switch for the bubble layer |
| `gexMetric` | `voloi` | `voloi` = OI + today's volume; `vol` = volume only |
| `countdown` | `true` | Forming-bar countdown, top right |
| `volume` | `true` | Volume histogram strip |
| `spotLine` | `true` | Dashed last-price line |
| `railOn` | `true` | The strike ladder column |
| `levelLabels` | `true` | CORE / CW / PW tags on the pane |
| `emLevels` | `true` | EM± chips |
| `emLines` | `true` | …and their dashed hairlines |
| `bubbleBucket` | `auto` | `auto` follows the bar interval; `1` / `5` pin the rung |
| `bubbleScale` | `1` | 0.5 – 2.5, step 0.1 |
| `esCandles` | `false` | ES futures tape under SPX gamma |
| `expiry` | `''` | **DEAD** — kept so old blobs parse |

**Why each default is what it is:**

- `volume` on — a candle chart without volume under it is missing the second half of every bar's story.
- `railOn` on — the rail is the numbers behind the bubbles, and a bubble layer with no way to read the figure it is
  drawn from is half a feature.
- `levelLabels` on — three tags on the pane are the fastest read of where the session's magnet and its two walls are,
  and unlike the rail they take **no width** from the chart. That is what makes them the layer that stays on when a
  card gets narrow enough to lose the rail.
- `emLevels` / `emLines` on — two hairlines at the edges of the day's range, and **a band nobody switched on is a band
  nobody knows exists**.
- `tapeDays` 1 — the board's job is the session that is happening. Capped at 3: gamma retention is three sessions, the
  ETF route's ceiling is 7 calendar days, and three sessions is already the most that reads as *context* rather than as
  a different chart. **Only the newest session carries bubbles and a rail** (the gamma request reaches one session), so
  2D/3D widen the candles and leave the ladder where it was.

### Versioning

`SETTINGS_V = 7`. An older blob simply hands back `undefined` for an upgraded key and the fallbacks take the new
default, so most bumps need no migration.

- **v7** (2026-09-02) `esCandles` added → falls back to `false`, the cash chart those blobs already drew.
- **v6** (2026-08-31) `bubbleScale` added → `clampScale` falls back to 1, the size those blobs already drew.
- **v5** (2026-08-31) `prevDay` and `bubbleDay` removed with the 48 h testing reach and the Sun/Mon/Both picker; both
  are in `STALE_ON_UPGRADE` so the dead keys drop from the blob on first load.
- **v4** (2026-08-29) `bubbleBucket` added → `'auto'`, the behaviour those blobs already had.
- **v3** (2026-08-29) the bubble knobs left `ChartSettings` entirely.

`normalizeSymbol` also retires `ES`/`NQ` onto `SPX`/`NDX`, so a blob saved before the futures were dropped reopens on a
symbol that still has candles rather than on a dead one with an empty chart.

`v` rides along **in the blob**, not in `ChartSettings`: it is a storage concern and nothing that reads settings should
have to know about it.

---

## 12. Symbols

```ts
SPX($SPX) SPY QQQ NDX VIX AAPL AMD AMZN GOOGL META MSFT NVDA SPCX TSLA
```

Only SPX differs from its own ticker: gamma is stored under `$SPX` while the candle feed knows `SPX`.
`chainTicker()` strips the `$` for the options-chain routes.

**ES and NQ are not symbols here** (2026-08-27). Dropping the futures from the symbol list is what lets this module
tree be simple: one candle endpoint serves every symbol, and every symbol charts against its **own** strikes, so a
bubble goes at the strike price — nothing to convert, nothing to fetch, no "basis unavailable" state to design around.

**ES came back as a candle SOURCE, not a symbol** (2026-09-02) — v2's original pairing (SPX gamma on ES futures
candles) expressed as the card's SPX/ES switch, shown only while the page symbol is SPX. Typing "ES" into the toolbar
still lands on SPX, where the switch is one click away, and **none of the other cards on the board has to learn what a
futures contract is.**

```ts
RETIRED = { ES: 'SPX', '/ES': 'SPX', NQ: 'NDX', '/NQ': 'NDX' }
```

Three tiers of symbol, as in v2: the curated list (always present, always first), the server roster from
`/api/es-candles/tickers` (fetched **once, lazily, on the first picker open** — never on mount; a failure yields an
empty list and is **never retried**, because the curated list plus freeform entry is a complete fallback and a retry
loop behind a dropdown is the kind of thing nobody notices until it is hammering the backend), and anything the user
types matching `/^[A-Z][A-Z0-9.\-]{0,9}$/`.

**Favourites**: `symbols.ts` keeps v2's exact `localStorage` key `es-candles-fav-symbols-v1`, so a user's stars survive
the move between `/app/es-candles` and `/v3`. **This is the one storage key v3 shares**; everything else it invented is
namespaced `cb-v3-`. In practice the card's own `SymbolPicker` is now unused on copies — those mount the app toolbar's
`TickerPicker`, which shares the browser-wide `cb-v3-fav-tickers` list, so a ticker starred in the toolbar is already at
the top here and vice versa. Two lists for one habit was the thing being fixed.

---

## 13. Card instances, the phone and copies

**Instance ids.** A grid item's id is an *instance* id. The first copy keeps the bare catalog id (`gex-candles`); every
copy after gets `#n`. The suffix is a suffix, not a rename — the catalog is looked up through `cardTypeOf()`, which
strips it. Consequence: every layout ever saved is still valid, and anything keyed on the bare id (a board from last
week, the `data-card-id` selectors perf-check drives) keeps working.

**Instance 1 follows the board ticker** and has **no** symbol picker — the app toolbar's search is the one place its
ticker is set, and a picker on the card would be a second control over one value.

**Every copy after the first gets one** (2026-09-04). The whole point of adding a second GEX Candles card is to watch a
second ticker; two cards locked to the board symbol draw the same chart twice. `settings.symbol` was already in the
stored blob, unread since the picker was removed — this is what reads it again.

**`spxOnly` (the phone build, `/v3/m/spx`)** pins SPX and makes **session stop being a setting**. ES trades nearly
around the clock so it is ETH; SPX cash does not exist outside 09:30–16:00 ET, so RTH on it is not a filter, it is the
whole tape — an SPX chart on "ETH" and the same chart on "RTH" are the same picture, and **a button that changes nothing
is a button that teaches you it does nothing.** The stored `session` is left untouched, because the same browser profile
opens this card on a desktop and must find it as it left it. `spxOnly` is **not** a copy however it is mounted.

**Phone differences** — one card, three changes, all about the hand rather than the screen size:

1. The toolbar becomes **one button** and everything moves into a bottom sheet. The desktop toolbar is five controls at
   10 px; on a 390 px card it wraps to three rows of ~18 px targets, eats a third of the chart's height doing it, and
   still cannot be hit reliably. That one button carries the current interval / days / session, because otherwise the
   two settings you change most are invisible until you open the sheet.
2. **The GEX rail is off** — a fixed-width column, affordable at 900 px, a quarter of the plot at 390. `railOn` is
   suppressed for the render and the stored value is left alone, and because the rest of the card reads the suppressed
   value, a phone does not pull the heaviest request on the card for a ladder it will never draw.
3. The overlays move in off the rail's old gutter and grow to a real tap target (the jump-to-now button goes 28 px →
   36 px, clear of the axis and up off the bottom where a swipe-up gesture starts).

Everything else is the same card. Deliberately **not** a second component: a phone fork of a 2,000-line chart card is a
second thing to fix every time.

**The tape switch stays in the header on a phone too.** SPX-vs-ES is the one control you reach for mid-session — it is
the difference between a chart that stops at 16:00 and one that has the overnight — and burying it behind ⚙ made the
phone build's candle screen answer a different question from the board's.

---

## 14. The toolbar, folded

Each of the three segmented controls is built **twice** from one set of options and one handler: open (`SegGroup`) for
the phone sheet, folded (`SegMenu` — the current value, with the full group one click under it) for the desktop header.

**Why fold.** Spelled out, the header read `SPX|ES · 0DTE · 1m|5m|15m|30m|1h · RTH|ETH · ⚙ Layers` — **eleven buttons,
ten of them saying what the chart is NOT set to.** Two candle cards side by side on a 12-column board is the normal
arrangement, and at that width the row wrapped and the ⚙ fell off the end. Folded, the same row is the width of
`SPX 0DTE 5m ETH ⚙`, which fits on a quarter-width card. Nothing is hidden — the options are one click away, in the
identical control they used to be shown in.

**Header (desktop):** TradingView credit · [⏱ Replay] · [symbol picker, copies only] · SPX|ES menu · interval menu ·
session menu · ⚙ Layers.

**⚙ Layers panel:** Days (every width) · Layer chips (Bubbles, GEX rail, Levels, EM, EM line, Volume, Spot line,
Countdown) · GEX basis (Vol+OI / Vol) · Bubble bucket (Auto / 1m / 5m) · Bubble size slider. Phone adds Interval and
Session sections.

**Days lives in the cog at every width.** The header is the one row that has to survive a quarter-width card, and days
is a set-once control — you pick 2D to look at yesterday's shape and leave it. The interval is the one you reach for
mid-session, so it keeps the slot.

**The session follows the tape.** Switching to ES sets `session: 'eth'`; switching back to SPX sets `'rth'` — ES on RTH
throws away the overnight that is the only reason to be on it, and SPX on ETH leaves an empty overnight gap on the left
of every column. Here it is a **default, not a lock**: the Session picker is still live, so a deliberate ES-on-RTH is
one click away and survives until the tape is switched again.

**`EM line` is disabled rather than dropped when EM is off** — a toolbar whose buttons come and go is a toolbar you
cannot learn. Same for the `Bubble size` slider with the bubbles off: the value it holds is the value that comes back
when you turn it on.

---

## 15. Replay

Opt-in via the `replay` prop, **and the board does not pass it**. `<GexCandlesCard />` on the board is byte-for-byte the
live card it has always been: no transport, no toolbar change, no extra request, and every replay hook sits inert behind
one `replayOn` flag.

**It costs nothing to fetch**, which is the reason it could be added at all. The card already holds a whole session of
candles **and** a whole session of per-minute GEX ladders in memory — that is what the bubbles *are*. So replay is not a
second data path: it is **one cursor timestamp**, and both series are clipped to it, upstream of the bubble model and the
rail, so the candles, the bubbles and the rail can never disagree about what time it is.

**The cursor is a TIMESTAMP, not a bar index.** Switching 1 m → 5 m rebuilds the timeline with a fifth of the entries; an
index would land somewhere unrelated while a time stays the same time. `replayIdx` is *derived* from it, never stored.

**Rewound, the live feeds are off** — pushing a live print onto a rewound chart would put a 15:59 candle on a 10:04 tape.
Gating at the effect rather than inside the callback also drops the subscription, which takes `spot` / `esCandles` back
**out of the socket's derived topic scope**. The forming-bar countdown goes with them: there is no bar forming in a
session that already closed.

**Transport:** session picker · "N sessions recorded" · ET clock · `bar i/n` · ◀ ⏯ ▶ · scrubber · speed
(0.5/1/2/4/8×, `REPLAY_BASE_MS = 700` per bar at 1×) · 🔒 Axis · Live. Rendered in this card's tree because this card
owns the state, but `ReplayDock` **portals** the DOM to the bottom of the page column **in flow**, so it shrinks the chart
rather than covering the last inch of it.

**Constants and why:**

```ts
REPLAY_HISTORY_MINUTES = 5760   // the route's own clamp on `minutes` — "everything there is"
REPLAY_CANDLE_DAYS     = 7      // dxFeed's practical 1m ceiling, which the ETF route clamps to anyway
REPLAY_SESSION_CHOICES = 5      // GEX_HISTORY_KEEP_SESSIONS — the server's own retention
```

*Everything there is* is not much: `option_strike_gex_history` is pruned to `GEX_HISTORY_KEEP_SESSIONS` by
`pruneOptionStrikeGexHistory` in `server-v2/_lib-db.cjs`. **That is a retention decision, not a client one** — raising
that env var is what buys more days. So the picker never guesses: it lists the ET days the payload actually came back
holding, and says how many that was, because a dropdown with three entries and no explanation reads as a bug rather than
a limit.

**Replay pulls a wider tape** because the session picker can only offer a day the *gamma* has, and a day with gamma and no
candles is an empty chart with a populated dropdown over it — worse than not offering the day. Three sessions can straddle
a weekend plus a holiday, so 5 calendar days is not always enough. **The 2D/3D day picker widens it for the same reason.**

**Rewound, the tape names the sessions.** The ladder request is one session at a time now, so the gamma payload can only
name the day already selected — it cannot enumerate the others. The tape can: it is pulled 7 days deep for exactly this,
and a day with candles is a day that traded.

**A settled session does not poll.** The date path answers with a day that has already closed, so a 60 s poll is one
request a minute for a byte-for-byte identical payload. Today still polls, because the replay tab opens on the newest
session and that one is still being written.

**A picked day can age out.** Retention drops the oldest session every morning, so a tab left open overnight can hold a
`replayDay` the server no longer has — and a `<select>` whose value is not one of its own options renders **empty**, over
a chart with no ladder. Falls back to the newest.

**Axis lock defaults ON here**, unlike the other four replay tabs. On a ladder the unlocked behaviour is merely busy;
here it is the thing everyone hits first. It is **re-armed**, not merely set once, whenever the subject changes (entering
replay, picking another session, pressing Live) — the default is the default every time.

**The replay stamp** draws the ticker, expiry, session and cursor clock **into the pane**, with the CB Edge wordmark in
the opposite corner. These surfaces get screen-recorded, and a recording is a crop: a caption in the page chrome above
the chart is one crop away from being gone, and **a clip of a rewound chart that does not say so is a clip of a lie.**
`data-capture-meta` carries the same for CopyShot captions, and includes `REPLAY <day> <HH:MM> ET` while rewound.

---

## 16. Status messages on the card

| Message | When |
|---|---|
| `Loading…` | No bars yet and the candle query is in flight |
| `No candles recorded for <tape> yet.` | No bars and not loading |
| `ES−SPX basis unavailable (…) — GEX levels are drawn at SPX cash strikes.` | ES tape, route answered, no usable basis and no live pair |
| `no GEX history in view` | The bubble layer **has** data but none of it falls in the visible window |
| `No ladder yet` (in the rail) | The rail model is empty |
| *(the candle query's own error)* | `candlesQ.error` |

`no GEX history in view` exists because an empty bubble layer that *has* data is indistinguishable from a broken one, and
that ambiguity cost real debugging time. It is driven by `drawBubbles`' return value through `onBubblesOutOfRange`, which
fires **only on a change** — so it is safe to hold in React state and the draw loop itself never sets state.

`empty` is computed from `allBars`, not `bars`: rewound to the open, `bars` is legitimately one candle long and on the
very first frame can be zero. That is a cursor at the start of the session, not a card with no candles, and saying "No
candles recorded" over a chart that is about to play is a lie.

---

## 17. Performance notes

- **The heaviest request on the card is the GEX history**, and its cost is linear in `minutes` — the route returns **one
  column per minute** and there is no server-side sampling to ask for. That is why the 48 h `Prev day` reach and
  `anyExpiry=1` were both removed rather than optimised.
- **Poll cadences match what is behind them.** The recorder writes a column a minute, so a 60 s poll is the floor; the
  candle recorder writes once a minute, so 30 s is generous.
- **The owner's polls run in a hidden tab** (`background: isOwner`). `useQuery` stops polling while the tab is hidden,
  which is right for every customer — a chart nobody is looking at is egress for nothing — and wrong for the owner, whose
  chart is the **session's record**: a bubble that did not form because another tab was up for ten minutes is a ten-minute
  hole in it, and the catch-up poll on return does not fill a hole, it only draws the newest column. The browser throttles
  hidden timers to about once a minute, which is the recorder's own cadence, so nothing is lost to the throttle either.
  The SSE stream follows the same rule, and dropping the connection is also what lets the server release the symbol.
- **The countdown is written straight to the DOM node** on a 1 s interval, never through React state: a once-a-second
  re-render of this card would re-run every memo above it and hand the chart a new bar array sixty times a minute.
- **Effect ordering is the mechanism, not a comment about one.** `setIntervalMs` and `setAxisLock` sit *above* the
  `setBars` effect in source order — effects flush in source order, so the interval is in force before the reframe (which
  sizes the window in bars and picks the bubble bucket), and the lock is in force before the clipped bars arrive.
- **`viewKey`** = `symbol | ES/IDX | interval | session | tapeDaysD | R/L`. Anything in it changes the **scale** of the
  series, so the view is re-framed when it does. It is latched only once real bars arrive — on a symbol change the cache
  misses and `bars` is briefly empty, and latching on that empty set would spend the reframe on nothing. `replayOn` is in
  the key so entering/leaving replay reframes **once**; the cursor moving is not a scale change and reframing on every
  scrub tick would fight the pan and the zoom.
- **`gexUrl` being null is a gate, not just an absence.** `useQuery(null)` cannot fetch, so it returns the last value its
  ref happened to be holding — and on a symbol switch the URL *is* null for a moment while `/api/expirations` answers.
  Without the gate the card kept drawing the **old symbol's bubbles**: real columns, at the old symbol's strikes, over the
  new symbol's candles. On SPX → AMZN the strikes are off-scale and it reads as "the bubbles did not load"; between two
  similarly-priced tickers it would read as a live chart showing another instrument's gamma without saying so.
- **No `bars` in the bubble model's deps.** A candle *poll* is not a reason to re-bucket the GEX history. `bucketMs` is
  how the interval gets in, so a timeframe change rebuilds the model exactly once, through the one value that changed.

---

## 18. What was deliberately left out of v3

From v2's `EsChartCard`: the gamma **heatmap**, EMAs, Bollinger bands, RSI, the profile/TPO overlays, the multi-chart dock
and the screenshot pipeline. Also, from this card's own history: the six bubble sliders and Auto mode, the expiry dropdown,
the `Prev day` 48 h reach, the Sun/Mon/Both day picker, and `anyExpiry=1`.

---

## 19. Gotchas, in one list

1. A heatmap cell is `net` / `netVol`, **not** `netGEX` / `netVolGEX`.
2. Every route here returns **HTTP 200 on failure**. Never branch on `res.ok`.
3. `timeToCoordinate()` does not interpolate; `coordinateToTime()` is a step function. Neither may place a mark.
4. `barTimes` must be the **real** bar array, never arithmetic off the interval.
5. `latestSession` is semantic, not "today" — Saturdays, and the recorder's weekend republish.
6. Past sessions are stored under **their own** front expiry; only `minutes=0` + `expiryFallback=1` finds them.
7. The ES basis is per **session day** for history columns, and today's for the EM band.
8. A wrong basis is **rejected**, never clamped, and the card says so on screen.
9. Zero from the live route is a normal answer; feeding it to the chart autoscales the pane to zero.
10. `synth` must die on a reframe or the previous symbol's price is appended to the new series.
11. The bubble stride target is 11 px, and lowering it kills the size channel — the marks are capped at a fraction of the
    spacing they are strided to.
12. `topOfSpacing` is past the geometric limit on purpose; `capOfSpacing` is deliberately under it.
13. The overlay canvas **must** carry `data-cb-layer`, or the perf check silently measures nothing.
14. `attributionLogo: false` is only legal because `<TvAttribution>` renders in the header.
15. No colour literals anywhere in `src/` — `cssVar` with no fallback, 8-digit hex for canvas alpha.
16. Nothing may push a tick through React state on its way to the chart.
