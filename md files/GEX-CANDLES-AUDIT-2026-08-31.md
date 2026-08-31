# GEX Candles — full audit, 2026-08-31

Scope: `cbedge-v3/src/board/gexCandles/*` (card, chart, bubbles, rail, settings,
symbols, candles, gexHistory), the client data layer it rides
(`src/data/{api,cache,dedupeFetch,socket,store,liveGex,esCandles,symbol}.ts`),
and the three `server-v2` routes behind it plus the websocket `spot` frame.

Verification: `tsc --noEmit` under the repo's real `tsconfig.json` (strict,
`noUnusedLocals`, `noUncheckedIndexedAccess`) over the whole audited subtree —
**0 errors**, before and after the fix applied below. The bubble size/stride
numbers in P0-1 are from running the real `sizeFor` / stride arithmetic, not
estimated.

One defect was introduced by this morning's interval-bucket change; it is fixed
in this pass. Everything else is reported, not changed.

---

## Fixed in this pass

### P0-1 · The stride change killed the bubble size signal past a ~2h window
`chart.ts:674` (this morning) passed `pinned = true` to `drawBubbles`
unconditionally, on the reasoning that an interval-driven bucket is a chosen
cadence like an explicit pin. It is — but the pin's loosened stride target
(`pinnedPxPerDot`, 2.5px) is a **size** decision, not a cadence one. Marks are
capped at `capOfSpacing` (0.28) of the spacing they are strided to, with `minPx`
(1.2) underneath, so below ~4.3px per drawn dot the cap has already fallen to the
floor and every row of a bucket draws the same size.

Measured on a 770px plot, 1m bars, four rows of a bucket (radius px):

| window | stride target | top | #2 | #3 | #4 | top ÷ #4 |
|---|---|---|---|---|---|---|
| 2.5 h | **2.5 (shipped)** | 1.95 | 1.34 | 1.30 | 1.26 | 1.55 |
| 6.5 h | **2.5 (shipped)** | 1.50 | 1.20 | 1.20 | 1.20 | 1.25 |
| 13 h  | **2.5 (shipped)** | 1.20 | 1.20 | 1.20 | 1.20 | **1.00** |
| 2.5 h | 11 (fixed) | 5.85 | 3.09 | 2.51 | 1.99 | 2.93 |
| 6.5 h | 11 (fixed) | 4.50 | 2.49 | 2.09 | 1.74 | 2.59 |
| 13 h  | 11 (fixed) | 4.50 | 2.49 | 2.09 | 1.74 | 2.59 |

At 13h every mark on the chart was the same 1.2px dot — the layer's entire signal
is size, and it was gone. This is also why the `sizeCurve` 0.62→0.72 and
`floorOfCap` 0.25→0.18 tuning that shipped the same morning appeared to do
nothing: with the spacing bound holding the cap at ~1.4px against a 1.2px floor,
the curve had 0.2px to work with.

**Fix:** `drawBubbles(..., drawOpts.bucketMin != null)` — the pin's loose stride
goes back to being the pin's, and the interval-driven default strides against the
legible 11px. The interval picker still moves the bubbles, because what the
interval changes is the **bucket**: at a 2.5h window 1m now draws every 3rd
minute at 5.85px and 5m every 5th at 9.75px — different dots, visibly different
sizes, both legible. Comments in `settings.ts`, `bubbles.ts` and `chart.ts`
corrected to say this.

### P0-1b · `ChartDrawOpts.bucketMin` still documented the removed rule
`chart.ts:43-52` described `null` as "let the pane choose" and explained the
pixel measurement that no longer exists. Corrected.

---

## P0 — the card shows data that is silently WRONG

### 1. `useQuery` has no sequence guard: a superseded response overwrites the current one
`src/data/api.ts:120-136`. `run()` fires `query(url)` and its `.then` writes into
`stateRef` with no check that `url` is still the one it started for.
`useEtfCandles` (`esCandles.ts:324`) has a `seqRef` for exactly this; `useQuery`
does not.

Failure: switch SPX → SPY while the SPX candles request is in flight (cold,
~800ms). SPY is warm and lands at 150ms; SPX lands at 800ms and overwrites. The
card holds SPX bars under the SPY heading, with SPY's expiry, bubbles and rail,
until the 30s poll happens to correct it. Same on the interval picker: click 1m
then 5m quickly, the 1m payload lands last, and `rollup(raw, 5)` returns it
untouched (the `interval <= 5` short-circuit) — 1m candles drawn and labelled 5m,
with 5m bubble buckets over them. Also hits `gexQ`.

### 2. The one reframe a symbol switch gets is spent on the OLD symbol's bars
`src/data/api.ts:111-118` (the `stateRef` initializer runs once, ever, and
nothing resets it during render) + `GexCandlesCard.tsx:416-420`.

On the commit where `symbol` changes, `useQuery` still returns the previous URL's
value, so `setBars(oldBars, reframe=true)` runs and `framedRef.current` is
latched to the NEW `viewKey`. Consequences: (a) the reframe re-fits the price
scale to SPX's bars, and when SPY's bars arrive `reframe` is false, so
`frameRecent()` and the `autoScale: true` re-enable never run for SPY; (b) on the
next render `bars` is `[]` and, `reframe` now being false, the guard at
`chart.ts:694` keeps SPX's candles drawn — defeating the escape hatch written at
`chart.ts:689-693` for precisely this. Meanwhile the rail and bubbles have
already switched. Two instruments on one chart with nothing saying so.

The same mechanism makes the "NOT THE PREVIOUS TICKER'S LADDER" gate at
`GexCandlesCard.tsx:351-360` incomplete: `gexUrl ? … : []` covers `gexUrl ===
null`, but when `gexUrl` merely *changes*, `gexQ.data` is still the old symbol's
payload for that commit and `parseGexHistory` parses it.

### 3. The invented forming bar is not cleared on a symbol or interval change
`chart.ts:723-730`. `synth` is built by `setLivePrice` and the chart handle lives
for the card's lifetime; nothing resets it. The re-apply condition
`synth.openMs === live.openMs + intervalMs` is not a coincidence — it is exactly
how `synth` was constructed, and both symbols sit on the same minute grid, so the
normal case after a switch satisfies it.

Failure: 1m SPX at 14:31:20, spot ticks, `synth` opens the 14:31 bar at ~6800.
Switch to SPY at 14:31:40 whose newest closed bar is 14:30 → `series.update()`
puts a 6800-priced candle on the SPY series, and with `autoScale: true` re-applied
the whole SPY series collapses to a flat line. Self-heals on the next 30s poll.

Related, same object: `setLivePrice`'s roll-forward re-arms itself (each invented
bar becomes `live`), so during a candle-feed outage with a live socket the chart
invents an unbounded run of synthetic candles that look published. Bounded only
by the next *successful* poll — and an empty poll early-returns at `chart.ts:694`
without touching `live`.

### 4. `weekendExpiry` is computed once at mount and never re-evaluated
`GexCandlesCard.tsx:267` — `useMemo(() => etWeekendSessionDay(), [])` reads the
wall clock with `[]` deps, and `historyMinutes` is frozen with it. This is a
dashboard people leave open.

Failure A: opened Sunday 20:00 ET, still open Monday 09:35. `weekendExpiry` is
still Friday's date, so `columns = allColumns.filter(c => etDay(c.slotTs) ===
weekendExpiry)` drops every Monday column and the layer draws **Friday's gamma
over Monday's live candles**, all session, with no warning — and
`bubblesOutOfRange` does not fire, because there genuinely is data.
Failure B: opened Friday 15:00, still open Saturday → `weekendExpiry` is `''`, the
card takes `expiries[0]` (Monday), the route has no rows for it, and the layer is
empty all weekend — the exact case the comment block at lines 97-115 exists to fix.

### 5. `liveGex` reads the status frame one level too high
`src/data/liveGex.ts:103-108` reads `status.expirations` / `status.expiry`, but
`socket.ts:124-128` wraps every frame as `{ type, symbol, ts, data }` — the
correct reads are `status.data.*`. `StatusFrame` is `[k: string]: unknown`
(`contract/frames.ts:224-227`) so TypeScript cannot catch it.

Failure: `expirations` is always `[]` → `wantToday` is always false → the
`SET_EXPIRY` message is never sent, on a server that tracks the chosen expiry
**per connection**. Every `useLiveGex` consumer silently shows the feed's default
front expiry instead of today's 0DTE, and `isZeroDte` is permanently false.

### 6. RTH + 1h admits half an hour of post-close prints
`candles.ts:130-153` buckets on `Math.floor((etMinutesOfDay - RTH_OPEN) /
interval)`, and `rollup` runs *before* `filterSession`
(`GexCandlesCard.tsx:330`) on the full ETH series. 390 / 60 = 6.5, so the last 1h
bucket spans **15:30–16:29 ET**; `filterSession` tests the rolled-up bar's open
minute (930), which passes.

Failure: SPY, 1h, RTH, a 16:05 post-close spike — the final "15:30" candle
silently absorbs 16:00–16:29. Wrong high/low, wrong close, extra volume, on a
chart the user selected RTH specifically to exclude. 15m and 30m divide 390
exactly and are unaffected.

---

## P1 — a failure that reads as "no data"

### 7. Every server-side failure returns HTTP 200 with an empty body
`etf-candle-recorder.js:652-655` (catch → `return []`),
`api-router.js:5728-5741` (empty result is indistinguishable from a DB error →
falls to `liveRows`; if that throws, `source = 'none'`), `api-router.js:5743`
(`send(res, 200, { rows: [], error: String(err) })`), and `api-router.js:6444`
for the history route.

Failure: Postgres pool exhausted mid-session → `200 {source:'none', rows:[]}` →
`res.ok` is true so `useQuery` never throws → `candlesQ.error` stays undefined →
the card prints **"No candles recorded for SPX yet."** A total backend outage
renders as a first-run empty state on the flagship ticker. `source` is the only
signal and the client never reads it.

### 8. `gexQ.error` is never rendered
`GexCandlesCard.tsx:486` takes `const error = candlesQ.error`; `gexQ` has no
error branch anywhere in the file, though `useQuery` does throw on non-2xx.
Failure: a subscription lapses mid-session, `enforceAuth` returns 402 for both
routes, candles shows a status line and the bubbles + rail simply vanish.

### 9. `minutes` and `mode` are unvalidated and silently switch which query runs
`api-router.js:6318` — `Math.max(0, Math.min(5760, Number(winParam)))` turns
`?minutes=abc` into `NaN` and `?minutes=` into 0, so `winMin > 0` fails and the
route drops from the rolling-window query to a single-ET-day query on
`date = todayET()`. On a Saturday that date has no rows by construction
(`gex-history-writer.js:75`) and the answer is a valid-looking empty heatmap.
`mode` is likewise unchecked (`6302`), so `mode=heatMap` falls through to the
rolling branch, which returns `{rows, minutes, symbol}` with **no `columns`
key** — `parseGexHistory` returns `[]` and the layer is blank with no error.

---

## P1 — resource and stability

### 10. `heatmapCache` is unbounded and its key rolls over daily
`api-router.js:6263`. Declared, `get`, `set` — nothing deletes or prunes. The key
includes `date` (default `todayET()`), so the whole key space turns over every ET
midnight and yesterday's entries are retained for the process lifetime. ~14
symbols × ~20 expiries ≈ 280 new keys/day, each ~1MB at `minutes=720, top=30`.
A week of uptime is ~2GB of dead payloads for dates the table no longer holds
(retention is 3 sessions). Node OOMs the API + WS process.

### 11. The client query cache is never evicted
`src/data/api.ts:39` — `const cache = new Map<string, Entry>()`, add-only.
`clearQueryCache()` is exported and called nowhere. One full parsed history
payload accumulates per `(symbol, expiry, minutes, top)` combination for the life
of the tab.

### 12. The heatmap window query has no supporting index and no LIMIT
`_lib-db.cjs:4430-4445` filters `timestamp >= $1 AND expiry = $2 AND symbol = $3`.
The composite index `idx_osgh_lookup` leads with `date`, which this query does not
filter on, and **no index mentions `symbol` at all**. The `DISTINCT ON` over a
computed expression forces a full sort of the matched set on every cache miss —
~237k rows for `minutes=720` on a liquid 0DTE.

### 13. The route computes four fields per column that the card discards
`api-router.js:6349-6405` builds `max`, `top3` (a full sort per column) and runs
`flipOn()` twice per column. `parseGexHistory` keeps `{slotTs, cells, spot}` and
nothing else; neither `bubbles.ts` nor `GexRail.tsx` reads any of them. ~475k
discarded `flipOn` iterations plus 720 sorts per cache miss, with no opt-out
parameter.

### 14. A re-scope connection that never opens is never retried
`src/data/socket.ts:201-228`. `next.onclose` only calls `handleClose()` when
`ws === next || ws === null`, but `ws` is reassigned inside `adopt()`, which runs
in `onopen`. A replacement socket that fails before opening leaves `ws` pointing
at the old one, so neither branch matches and the only retry path never runs —
and `currentTopics` was already advanced, so `scheduleScope`'s `sameSet`
early-return means the scope is never re-attempted either. Failure: this card
mounts, `spot` widens the scope, the backend 502s that connection; the live price
never ticks between 30s polls while `socketState().ready` reports OPEN.

---

## P2

15. **`/api/expirations` defaults a missing/garbage ticker to SPX**
    (`api-router.js:537`) — no allowlist. A symbol typed into the toolbar search
    that `SYMBOLS` does not know (`symbols.ts:69-71` returns a passthrough def)
    gets SPX's expiry dates in its dropdown, and the card then asks for GEX
    history at `symbol=<that>&expiry=<an SPX date>`.
16. **…and stamps `public, max-age=30` on error responses** (`api-router.js:538-540`)
    — `r.status` and the body are forwarded unchanged but the header is applied
    unconditionally, so a 5-second upstream 502 is publicly cacheable for 30s.
    `public` is also the wrong directive on a subscriber-gated route; compare
    `/api/mult-greek-gex-grid` at 562, which uses `NO_STORE`.
17. **`todayET()` is only correct when the process TZ is UTC**
    (`api-router.js:339-342`) — it formats to an ET wall-clock string, re-parses
    that in the process's local zone, then reads the day back in UTC; the two do
    not cancel. Under `TZ=America/New_York` it returns *tomorrow* after 20:00 ET.
    The correct helper `etDateStr()` is ten lines above it.
18. **Schema drift**: `option_strike_gex_history` is created by `_lib-db.cjs:463-478`
    without `symbol`, `net_dex` or `net_vol_dex`; those are added only by
    `gex-history-writer.js:200-205`, which no-ops when `DATABASE_URL` is unset.
    Every read helper references them. A fresh deploy or DR restore where the
    writer has not run makes every GET throw `column "symbol" does not exist`,
    which #7 converts into a permanently empty bubble layer. PLAUSIBLE.
19. **NULL `net_vol_gex` becomes numeric 0** (`_lib-db.cjs:4450`,
    `api-router.js:6344`), so legacy rows draw the **Vol** basis as a flat zero
    ladder — present but invisible — and silently degrade Vol+OI to OI-only.
20. **The countdown counts down a bar that closed hours ago**
    (`GexCandlesCard.tsx:461-484`) — `ms - (elapsed % ms)` cycles forever, so at
    18:30 on a 5m RTH chart the readout still loops 4:59 → 0:00, asserting a
    forming candle that does not exist. Same all weekend.
21. **`useEsCandles.load` has no sequence guard** (`esCandles.ts:185-209`), unlike
    `useEtfCandles` directly below it. Flipping the interval mid-flight merges 1m
    and 5m records into one `slotKey` space and computes the volume baselines
    across two bar sizes.
22. **`dedupeFetch`'s key ignores `init`** (`dedupeFetch.ts:46-49`), so
    `fetchCandles`' `{cache:'no-store'}, 5_000` means a user-triggered refresh
    within 5s silently returns the buffered old body.
23. **`useEsChart`'s pending queue is dropped on remount**
    (`GexCandlesCard.tsx:168-173`) — `apply` and `onMount` are both `useCallback([])`,
    so after a remount none of the buffering effects re-run and the fresh chart
    has no bars, snapshots, interval or draw opts until the next poll changes
    `bars`. Reachable in dev StrictMode; ~30s of blank in the worst case.
24. **Documented clamps that do not match the code**: retention is documented as
    "2 SESSIONS" (`api-router.js:6313-6316`) against a default of 3
    (`_lib-db.cjs:4310`); `days` is clamped to 30 on the DB path and re-clamped to
    7 on the live fallback (`api-router.js:5664`), so it means two different things
    depending on which source answered.

---

## Checked and clear

`slotTs` is epoch ms on both sides (`FLOOR(timestamp/60000)*60000` →
`new Date(ts)`) — no seconds/ms mismatch anywhere in this path. All candle
numerics are explicitly `Number()`-coerced on both the DB and live paths, so the
BIGINT-as-string hazard the client comment warns about does not apply. All SQL is
parameterised. `top=30` is inside the route's 500 cap. The websocket `spot` frame
is sound end to end: the frame name, its `{spot, prevClose, basis}` payload, the
`SpotFrame` type and the card's `f?.data.spot` all agree; topic scoping cannot
drop it (`spot` is in the derived set, is not `BROADCAST_ONLY`, and the connect
gap is covered by the unscoped snapshot plus `fanOutSnapshot`'s synthesised
frame). `rollup`'s negative-offset `Math.floor`, `latestSession`'s day compare,
`parseGexHistory`'s `net`/`netVol` naming, the `spot === 0` midpoint fallback,
`GexRail`'s sink teardown, `ChartFrame`'s observer cleanup, and `chart.ts`'s
`destroy()` (rAF, ResizeObserver, `visibilitychange`, logical-range subscription
all released) are all correct.

---

## Appendix — why the negative leader reads as "white outline, red inside"

`bubbles.ts:579-594`. The top mark of each bucket is drawn in three passes, and
the peers in one:

1. fill with the **hot tint** — `--color-gex-neg-hot` `#ffcdd2`, a pale pink — at
   `alpha = 1 × age`, where `age` is 0.75…1.0 by position in the trail;
2. under it, a glow whose `shadowColor` is the **saturated** base,
   `--color-gex-neg` `#ff4757`, at 0.95;
3. over it, a white ring, `rgba(255,255,255,0.85 × age)`, `lineWidth = ringPx`,
   stroked *on* the radius so it eats the outer ~1.4px.

So the "white outline" is (3) and the "red inside" is (2) reading through a
translucent (1) — canvas paints the blurred shadow first and the fill on top, and
at these radii the few interior pixels are mostly glow. The construction is
symmetric but the *result* is not: on the positive side `--color-gex-pos-hot`
`#c8f5ff` is already near-white and its glow is cyan, so the leader reads as a
plain white dot and loses its sign; on the negative side the pale pink never wins
against the red glow, so the leader keeps its sign and gains an outline. That
asymmetry is a palette consequence, not a code path — if the two sides should
read alike, the lever is `--color-gex-pos-hot` / `--color-gex-neg-hot` in
`tokens.css`, not `drawBubbles`.
