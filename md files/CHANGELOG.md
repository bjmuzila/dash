# Changelog

## 2026-08-11 - Fix: restore buildTpoProfile, which the Vite build died on

`components/dashboard/es-candles/chartMath.ts`.

The Docker deploy failed at `app-vite` build:

    "buildTpoProfile" is not exported by "components/dashboard/es-candles/chartMath.ts",
    imported by "components/dashboard/es-candles/EsChartCard.tsx"

The function had gone missing from chartMath.ts while its `TPO_PERIOD_MS`,
`TpoBin` and `TpoProfile` declarations and its whole section comment stayed
behind - so `tsc` and `check-routes.mjs` both passed (the module path resolves;
only the NAMED export was gone) and Rollup was the first thing to notice.

- **Restored `buildTpoProfile(candles, binSize, periodMs = TPO_PERIOD_MS)`** to
  the signature and return shape `EsChartCard` already calls it with: bins a
  price ladder of TPO touch counts, `maxCount`, `poc`, `vah`/`val`, `mid`, and
  `startTs`/`endTs` left null for the caller to anchor per session.
- A bin counts ONCE per period that traded there regardless of how many candles
  inside that period touched it (deduped by a `Set` per period) - that is what
  makes it a TIME profile rather than a second volume profile.
- Value area is the same contiguous-70%-around-the-POC expansion
  `buildVolumeProfile` uses, fed touch counts, so VAH/VAL mean the same thing on
  both profiles. `mid` is the session RANGE midpoint, not the POC.
- Verified every one of the 30 names `EsChartCard` imports from `chartMath` (and
  its `slotStore` imports) now resolves, so this was the only hole.

## 2026-08-11 - Analytics Ticker Lookup: the ex-0DTE board now comes from the CHAIN, plus a refresh button and the Options Chain ticker menu

`components/pages/Analytics.tsx` only. No proxy or server change.

- **The right pane no longer reads `/proxy/gex-by-strike-multi`.** Its numbers
  did not match the Options Chain page. That sweep is ThetaData-sourced
  (`fetchGreeksTheta` / `fetchOpenInterestTheta` in `eod-gex-recorder`); for SPX
  it is fine, for single names it comes back sparse. NVDA at 217.99 spot printed
  three-figure GEX at the money, every near-spot bar red, Core 335, call wall
  340, gamma flip 59.77 - while the Options Chain's Total column for the same
  name and session was strongly positive. Two surfaces, one label, two answers.
- **It now builds the board the way the Options Chain builds its columns:**
  the real listing from `/api/expirations`, then ONE `/api/chains?...&range=all`
  call per expiration, each run through the SAME `accumulateChainGreeks()` the
  left pane uses and summed per strike across expiries. Same TastyTrade chain
  the rest of the app prices off, so the two pages now agree by construction.
  Gamma flip is computed by `tlLevelsFrom` for both panes (the server flip went
  with the sweep), so the flip can't describe a different ladder than the rows.
- **No cap - ALL expirations.** "All expirations" has to mean all of them; a
  quarterly 300 days out is exactly where a wall the front weeklies never show
  can park. SPX lists 40+ and all 40+ are fetched. The cost is paid by a slow
  poll (120s) plus the manual button, not by dropping expiries;
  `TL_BOARD_CONCURRENCY` = 6 is the only throttle. The header prints the number
  of expiries whose chain ACTUALLY came back, and when that is short of the
  listing it names the reason ("of M listed - N chain call(s) failed") instead
  of implying a complete sweep. A ticker switch mid-sweep is fenced by a
  monotonic token, so the old symbol's chains can never land in the new
  symbol's ladder.
- **Refresh button** (`useRefreshButton`, the shared idle/refreshing/refreshed
  control) re-fetches the base chain, the listing and the board sweep together.
- **Ticker dropdown** replaces the free-text input + Look up button: the card
  now uses `TickerLevelsPicker`, the same searchable star-to-favorite menu the
  Ticker Levels card uses and the one modelled on the Options Chain page's
  TICKERS dropdown. Universe = live scanner list + the quick row + recents, so a
  name the scanner doesn't carry stays reachable; free text is the menu's own
  search box ("+ Add"), and recents can be removed from it.
- Still ALWAYS ex-0DTE, at every hour (yesterday's change); 0DTE remains one
  click away on the left pane's expiry pills.

## 2026-08-11 - Analytics Ticker Lookup: the "All expirations" pane is now always ex-0DTE

`components/pages/Analytics.tsx` only. No proxy or server change - the sweep
already returned both ladders.

- **The right pane reads `ex0dte`, not `all`.**
  `/proxy/gex-by-strike-multi` (eod-gex-recorder `computeLiveGexRowsMulti`)
  returns the per-strike board TWICE: `all` = every listed expiration, `ex0dte`
  = the same board split on `expiration !== sessionDate`. The card was drawing
  `all`. Same-day gamma dwarfs the rest of the board and decays to nothing by
  the close, so the walls that pane printed were often just today's pin rather
  than the structural board it exists to show. It now draws `ex0dte` at every
  hour - not a post-4pm rule. `gexFlip` comes from the same half, so the flip
  can no longer describe a different ladder than the rows above it.
- **The fallback obeys the same rule.** When the sweep errors or comes back
  thin, the pane falls back to the front expirations `/api/chains` already
  returned - now with today's dropped, summed per strike ACROSS those expiries
  (the maps from `accumulateChainGreeks`, one expiry at a time, merged in the
  component; no second copy of the OI+Vol formula).
- **The header no longer over-claims.** Title reads `All expirations - ex-0DTE`;
  the count subtracts today's expiry from the sweep's echoed list, because
  `expiryCount` counts 0DTE and this ladder does not. Empty state says
  "nothing listed past 0DTE" so a board that IS only 0DTE reads as such instead
  of looking broken.
- **0DTE is still one click away** on the left pane's expiry pills, which are
  unchanged.


## 2026-08-10 - SPX flow: TimeAndSale now covers the whole active expiry, and a stall degrades instead of blacking out

`server-v2/proxy-tastytrade.js`.

The SPX option tape had long dead stretches on every flow-driven surface
(/flow Net Drift sat flat for half-hours; per-strike Flow GEX was a step
function). Two causes in the dxLink TimeAndSale path.

- **The tape was narrowed TWICE, and the two guards fought each other.**
  `_syncTimeSaleWindow` applied `FLOW_TS_WINDOW_PCT` (±2%) INSIDE
  `_activeContracts()`'s own `STRIKE_WINDOW_PCT` (±8%) window. At SPX 7752 that
  inner band is ±155pts ≈ 62 strikes ≈ **124 contracts against a 120 cap**, so
  `.slice()` clipped the edge and strikes flapped in and out of the
  subscription as spot drifted. Every flap is a hole in the tape.
  Measured, same spot: **old = 120 contracts, 7605-7900. New = 498 contracts,
  7130-8370.**
- **The band is now opt-in** (`FLOW_TS_WINDOW_PCT` defaults to 0 = "no band
  beyond `_activeContracts()`"), and `FLOW_TS_MAX` goes 120 -> 600 as a runaway
  guard rather than the everyday limiter. It now logs when it bites instead of
  silently clipping. Set `FLOW_TS_WINDOW_PCT=0.02` to restore the old behavior
  live, no deploy.
- **Widening is cheap**, contrary to the "1-vCPU" note that comment carried:
  dxLink ALREADY streams Quote/Greeks/Summary/Trade for every contract in the
  ±8% band, so this adds an event type to symbols already on the wire, not a
  new tier of symbols. A subscription only costs CPU when the strike PRINTS,
  and far-OTM 0DTE strikes barely trade.
- **A TimeAndSale stall no longer silences the fallback too.** The Trade branch
  suppressed the conflated event for anything in `_tsSubs` - but that set means
  "a SUBSCRIBE went out", not "prints are arriving". dxLink's worst failure mode
  is the socket staying open while the feed goes quiet (no close/error, so no
  reconnect), and that combination produced ZERO prints from either path for the
  near-spot strikes. New `_tsLastPrintAt` map gates the suppression on actual
  delivery within `FLOW_TS_HEALTHY_MS` (60s); seeded at subscribe time for a
  grace period, cleared on `_resubscribe()` with `_tsSubs`. Deliberate tradeoff:
  when TimeAndSale resumes, one print can land on both paths and be
  double-counted - bounded at one per symbol per stall, versus an unbounded
  silent undercount.

### Not fixed - needs a decision (see FLOW_TAPE_FLOOR below)

`bucket()` returns `tape: this.tape.filter(o => o.premium >= tapeFloorPremium)`
with `FLOW_TAPE_FLOOR` defaulting to **$5,000**, and BOTH
`flowGexAccumulator.ingestTape(bucket.tape)` and `writeFlowTape(bucket.tape)`
read that filtered tape. So every Flow GEX number - live bars and reconstructed
history - is built from >=$5k-premium coalesced orders ONLY. On 0DTE SPX at
$0.50-$2.00 that is 25-100 contracts inside a 5s window; a large share of real
flow never counts. This is the likeliest cause of the step-function shape on the
per-strike panel, and of the standing "[flow] reads as ~0" note at the debug
tick. Left at $5,000 pending a call on disk (flow_prints was 3.6GB in the 2026-07
exhaustion incident).

## 2026-08-10 - Flow GEX panel now uses the EXISTING endpoint; my api-router change is reverted

`components/pages/StrikeHistory.tsx`. **`server-v2/api-router.js` is back to its
original content** - the `/api/strike-gex-series` handler is untouched again.

The two entries below describe a per-strike Flow GEX reconstruction I added to
`/api/strike-gex-series`, then patched twice when the panel came up empty. That
was the wrong call from the start: `state/flow-gex-history.js` already does this
exact reconstruction, is already wired up at `/proxy/flow-gex-history`, and is
already proven in prod by the contract-flow popup - including a `strike=` single
-strike fast path added precisely because the full window query was too slow.
I wrote a second implementation of the same formula and then debugged the copy.

- **The panel now fetches `/proxy/flow-gex-history?strike=&expiration=&date=`**
  in parallel with the existing series call, and merges client-side. Everything
  the reverted server code was trying to get right - the overnight two-day date
  window, the SPX/SPXW root split, NULL `underlying_norm`, the `bucket <>
  'neutral'` guard - that module already handled.
- **Step-aligned, not joined.** Flow points are per-MINUTE with `ts` in SECONDS;
  GEX snapshots are a 30s grid with `t` in MILLISECONDS. Each snapshot takes the
  most recent flow point at or before it (that is what "inventory as of now"
  means); snapshots before the first print stay null. An equality join would
  have matched almost nothing - and would have looked like "no data" again.
- **Empty state now points at the endpoint** with the exact URL to try, since a
  blank panel here is now a routing/server question rather than a data one.

Net effect: one implementation of γ × dealer inventory × spot², not two.

## 2026-08-10 - /strike-history: an empty Flow GEX panel now says WHICH empty it is

`server-v2/api-router.js` (`/api/strike-gex-series`), `components/pages/StrikeHistory.tsx`.

Follow-up to the panel below. Four different conditions were all rendering as
"No tape recorded for this session", including the most common one by far -
the SPA shipped ahead of the server.

- **Old server build is now named as such.** An `api-router.js` that predates
  Flow GEX omits the keys entirely, so `r.flowGex` reads back `undefined` -
  indistinguishable from "no tape" unless you test for the KEY. Client now
  checks `'flowGexAvailable' in json` (`in`, not truthiness - `false` is a
  valid value) and says "deploy server-v2" instead of blaming the tape.
- **Two-day date window.** `flow_prints.date` is the ET CALENDAR date of a
  print, not the session it belongs to, and SPX/SPXW trade Cboe Global Trading
  Hours from ~6-8pm ET the evening before. Querying one date silently dropped
  every pre-midnight print. Mirrors `state/flow-gex-history.js`'s `dateWindow`.
- **NULL `underlying_norm` no longer excludes a row.** The column is written at
  insert now, but it was added to an already-live table, so pre-backfill rows
  hold NULL. `expiration` + `strike` already pin this to one contract, so
  admitting NULL roots can't pull in another underlying.
- **`flowGexReason` distinguishes the remaining cases**: `no-tape-for-session`
  (inventory unknown -> null, blank panel) vs `no-prints-for-strike` (tape ran,
  this contract never traded -> a REAL flat zero, drawn) vs `error: …`, which
  now surfaces the message instead of silently looking like a quiet session.
- **Hotfix in the same session: `ReferenceError: flowRoots is not defined`.** The
  edit that introduced `rootWhere` replaced the block that declared `flowRoots`
  and didn't carry the declaration over, so every request to this route threw.
  `node --check` passes on an undeclared identifier - it's a runtime error, not a
  parse error - so the route is now covered by a stub-driven smoke test that
  actually invokes the handler and asserts the emitted SQL params and the
  computed flowGex, instead of only checking that the file parses.
- **`flowGexPartial` warns on back-sessions.** Small prints age out of
  flow_prints after ~1 day and big ones after ~5
  (`state/retention-cleanup.js:38-40`), so any prior session rebuilds from
  >=$500k prints ALONE and understates - while still drawing a confident line.
  The panel now says so above the chart.

### Known duplication

`state/flow-gex-history.js` (`/proxy/flow-gex-history`) already implements this
same reconstruction for a window of strikes. It uses each print's own spot with
the most-recent-known gamma; this one uses the snapshot's own gamma and spot at
that timestamp, which is more accurate on gamma. Two implementations of one
formula - worth collapsing.

## 2026-08-10 - /strike-history: Flow GEX replaces the Spot panel

`server-v2/api-router.js` (`/api/strike-gex-series` handler only),
`components/pages/StrikeHistory.tsx`.

- **The 4th panel is now per-strike Flow GEX, not Spot.** It's the only
  dealer-SIGNED series on the page: `net_gex` is the OI book and `net_vol_gex`
  is the volume book, and both assume every contract is dealer-long-call /
  short-put. This one asks the tape who actually lifted the offer. Zero line as
  the reference, `+` = dealers long gamma at that strike.
- **Spot didn't lose anything.** It was the one panel not about the selected
  strike, and it still reads out in the "Spot range" stat tile and the hover
  strip. `strikeNum` went with it - it existed only to draw that panel's
  reference line.
- **Rebuilt server-side from `flow_prints`, no schema change.**
  `option_strike_gex_history` already stores `call_gamma` / `put_gamma` / `spot`
  per snapshot for precisely this (`gex-history-writer.js:177`), so the only
  missing piece was inventory: a running sum over the tape, mirrored to the
  dealer (taker SELL -> dealer bought `+`, taker BUY -> dealer sold `-`), with
  the same `bucket <> 'neutral'` guard `computation/flow-gex.js:58` uses so
  unclassifiable prints can't bias it short. Then
  `flowGex = call_gamma*callNet*S^2 + put_gamma*putNet*S^2` - both legs
  `+gamma`, matching `gex-calculator.js:121-123`.
- **Summed in JS, not as a LATERAL join.** One strike on one expiry is a small
  print set, and a two-pointer merge over two already-ts-sorted lists beats
  re-scanning the tape once per snapshot. Covered by
  `flow_prints_date_norm_ts_idx`; the route is fetch-on-load, so it's one query
  per page load rather than per tick.
- **`underlying_norm IN ('SPX','SPXW')`, not `= symbol`.** The history table
  stores the normalized symbol but the tape records the traded root, and SPX
  weeklies print as SPXW - a bare equality would have silently dropped most of
  the SPX tape. A local `FLOW_TICKER_ROOTS` mirrors the one in
  `server-with-proxy.js`; keep the two in step.
- **A session with no tape returns null, not zero.** New `flowGexAvailable` flag
  on the response. Zero is a legitimate reading (a strike nobody traded), so a
  back-session with no `flow_prints` rows must not render as a flat zero that
  reads as "dealers held nothing" - the panel says so in words instead. Note
  `option_strike_gex_history` retention prunes to ~2 days, so lookback is short
  either way. A `flow_prints` failure is caught and logged, not fatal: the other
  three panels don't depend on it.
- **Hover strip and a new "Flow GEX now" tile carry the dealer position itself**
  (`+20c / -659p`), since flow GEX is that number times gamma times spot - when
  the line moves, that's what moved.

## 2026-08-10 - GEX chart: the hover readout shows BOTH bases, not just OI+Vol

`components/dashboard/GexChart.tsx`, `lib/calculations/calculations.ts`.

- **The hover tooltip disagreed with the bars in Flow GEX mode.** It computed
  `netGEXOf(r, tMode, spotPrice)` with `tMode` branching on `"vol-only"` alone,
  so `dataMode === "flow"` fell through to `"net"` and printed the OI+Vol net.
  On a strike where today's tape had dealers accumulating long gamma over a
  short-gamma resting book, the bar drew strongly POSITIVE while the readout
  above it printed a large NEGATIVE number.
- **Fixed by showing both legs rather than picking one.** The readout is now
  `Strike | <active basis> | <other basis>` - active first (that's what the
  bars are drawn on), the context leg dimmed to 0.55 opacity on both its label
  and its value so the pair can't be misread as the primary. Labels are
  `OI+VOL` / `VOL` / `FLOW` per the toolbar. These are two different measures -
  standing book vs today's dealer accumulation - so the answer was never to
  choose between them.
- **`ChainRow.flowGEX` is now declared.** `GexChart` had been reading `r.flowGEX`
  off a type that didn't carry the field. Documented as its own basis: both legs
  use +gamma because `inv.callNet`/`inv.putNet` are already the dealer's own
  signed position (no put-side flip), it's populated only server-side by
  `computeGexRows()`, and it's absent on client-built rows and on any
  multi-expiry merge.

## 2026-08-10 - watchlists: the ticker rosters are editable from the owner page (+ RBLX)

`server-v2/roster-store.js` (new), `server-v2/scanner-tickers.js`,
`server-v2/em-tickers.js`, `server-v2/far-cb-tickers.js`,
`server-v2/scanner-recorder.js`, `server-v2/oi-daily-recorder.js`,
`server-v2/strike-growth-recorder.js`, `server-v2/multi-flow.js`,
`server-v2/server-with-proxy.js`, `owner-vite/src/pages/Watchlists.tsx`,
`owner-vite/src/pages/watchlists/data.ts`, `lib/scannerTickers.ts`.

- **RBLX is back in the scanner universe, SHARES bucket.** It was in the
  2026-07-28 illiquid prune; this reverses that one name. Baseline 168 -> 169.
- **`/owner/watchlists` is now the home of the CB Edge rosters, not a snapshot
  of them.** Scanner, EM and Far-CB render live from `GET /proxy/rosters` and
  can be edited in place: add a ticker per bucket, click a chip to move it to
  another bucket or remove it, and one button to reset a list back to the file.
- **New `roster_overrides` table is the mechanism.** One row per
  `(list, symbol)`: `add` (with a target bucket, which doubles as MOVE) or
  `remove`. The files in `server-v2/` stay the BASELINE - the thing you get with
  an empty DB, and still the right place for a permanent reviewed change - and
  the table is a thin diff on top. Adding clears a prior remove and vice versa,
  so the table can never hold a contradiction.
- **Edits land on the next sweep, not the next deploy.** Every consumer used to
  destructure `SCANNER_TICKERS` at module load, which froze the roster for the
  life of the process. `scanner-recorder` and `oi-daily-recorder` now resolve
  per sweep; `strike-growth-recorder`'s watchlist reconcile moved out of
  `ensureSchema()` into `reconcileWatchlist()`, fired on the store's `change`
  event (coalesced 1s) plus a 10-minute safety pass; `multi-flow` re-syncs its
  roots on the same event and on its window-refresh tick, subscribing adds and
  dropping removals from the firehose keep-list.
- **This closes a silent UI/backend split.** `/proxy/scanner-tickers` re-read
  `process.env` per request while the recorders did not, so a runtime
  `SCANNER_TICKERS` made the ticker dropdowns advertise roots nothing was
  actually sweeping - pick one and get an empty chart. Both sides now resolve
  through the same store.
- **Fail-soft everywhere.** No `DATABASE_URL`, dead pool or bad query and every
  path falls back to the static file; the page shows `● BASELINE (no DB)` and
  disables editing rather than rendering an empty roster. Writes are OWNER-only
  (existing `proxy-auth` gate on every non-GET `/proxy/*`), and symbols are
  validated against a ticker-root pattern before they reach SQL.
- **Precedence, unchanged where it mattered:** an explicit `SCANNER_TICKERS` /
  `OI_DAILY_SYMBOLS` env still wins over both the DB and the file, so an
  ops-level "sweep only these three" keeps working. `far_cb_custom_tickers`
  (customer adds) still stacks on top of the far-CB roster and is not editable
  from this page.
- **Routes added:** `GET /proxy/rosters[?list=]`, `POST /proxy/roster`
  `{list, action, symbol, bucket?}`, `POST /proxy/roster-reset` `{list, symbol?}`.
  The tastytrade tabs are untouched - still a static export snapshot.

## 2026-08-10 - es candles: GEX bubbles size exponentially, new Curve slider

`components/dashboard/es-candles/EsChartCard.tsx`,
`components/dashboard/es-candles/slotStore.ts`.

- **Bubble radius is no longer `√ratio`.** The draw now uses
  `r = min + ratio^curve * (max - min)`, with `curve` a new persisted
  `BubbleCfg` key. `√` (curve 0.5) lifted every mid-sized strike close to the
  top wall - a strike at 25% of the session max drew at HALF the biggest
  bubble's radius, so the ladder read flat and the real walls never stood out.
- **Default curve 2.2.** That same 25% strike now lands at ~3% of the size span,
  so only the top-of-session GEX levels approach max and everything else
  collapses toward min. Set curve to 0.5 to get the old √ behavior back exactly.
- **New "curve" slider** under Bubble size (range 0.5-5, step 0.1) next to
  min/max/bright, so the response can be tuned live.
- **Default `maxSize` 4 -> 9, slider ceiling 7 -> 20.** With an exponent above 1
  only a handful of bubbles ever REACH max, so the extra headroom is what makes
  the top walls read as dominant instead of just making everything bigger.
  Saved presets keep their own maxSize; raise it there to see the effect.
- **Missing-key guard.** A slot blob saved before this change has no `curve`;
  the draw falls back to the default rather than letting `Math.pow(r, undefined)`
  turn every radius into NaN and silently blank the whole bubble layer.

## 2026-08-10 - gex change top: screenshots stopped double-exposing, plus Flip all

`components/scanner/GexChangeTop.tsx`, `lib/snapshot.ts`.

- **The "both sides on one image" bug is fixed in the shared capture engine.**
  html2canvas has no 3D pipeline: it ignores `transform-style: preserve-3d` and
  `backface-visibility: hidden`, but it DOES keep the 2D part of the matrix. So
  the back face parked at `rotateY(180deg)` was painted as a horizontal MIRROR
  image stacked on top of the front face - front text and reversed back text in
  the same PNG. It hit any card whose back had ever been mounted, flipped or not.
- **Opt-in contract: `data-flip3d="front" | "back"` on the rotating element and
  `data-face="front" | "back"` on each face.** `applyUniversalCloneFixes()` in
  `lib/snapshot.ts` now switches the hidden face off, flattens the visible one,
  drops the rotation and kills the tile's `perspective`. The DOM alone cannot say
  which face is showing (the rotation lives on the parent and may be
  mid-transition), so the component declares it.
- **Style-only, as that function requires.** The hidden face is `display:none`,
  never removed - the live-to-clone `<canvas>` pairing downstream matches by
  index and any structural edit there desyncs it.
- **Any page can opt in.** The fix lives in the shared engine, not in the scanner,
  so the next flip card gets it for free by adding the two attributes.
- **The page screenshot no longer slams every card face-up first.** `capture()`
  used to `setFlipped(null)` purely to dodge this bug; the PNG now matches what is
  on screen, flipped cards included.
- **New "Flip all" toolbar button** turns every auto-probed card over at once and
  back again. Flip state moved from a single card id to a SET, so single-card
  clicks still toggle only their own card.
- **The histories are fetched in waves of 6, de-duped by watch id, and only for
  ids with nothing cached** - not a ~65-request burst. A second Flip all after a
  flip-back costs zero requests.
- **Auto-refresh backs off above 8 open cards.** Re-polling ~65 charts a minute
  for panels nobody is reading is not worth it; the hand-opened case (a handful)
  still refreshes on the 60s tick, and Refresh always re-pulls.
- **The back face got its own camera button** next to the close X. With the whole
  board face-down the front-face camera is unreachable, so the chart side needed
  one; it saves as `<SYM>-<strike>-<slot>-chart.png`.

## 2026-08-10 - gex map: screenshot button on the Tape Field card

`app/test/GexMapTab.tsx`.

- **`CopySnapButton` in the Tape Field header** copies a PNG of the whole card
  to the clipboard, with a file download as the fallback when the clipboard is
  unavailable. Reuses `components/shared/CopySnapButton.tsx` -> `lib/snapshot.ts`,
  which is the repo's single `html2canvas()` call site; `scripts/audit-ui.mjs
  --strict` fails the build on a second one, so no new capture path was added.
- **The ref sits on a wrapper OUTSIDE `<Card>`**, so the PNG keeps the card's own
  border and background instead of a chart floating on a transparent edge.
- **`[data-capture-hide]` on the button and the zoom hint** - live-page chrome
  that should not photograph itself. The field switcher and intensity slider stay
  in the shot: they say which rendering the picture is of.
- Placed last in the header row, so nothing existing moved.
- What is on screen is what lands in the PNG - heatmap or terrain, zoomed or
  full - because the capture reads the live DOM.

## 2026-08-10 - prem diff: scroll-to-zoom / drag-to-pan on both charts

`app/test/PremDiffTab.tsx`.

- **`useZoomPan()`** gives both the daily and the intraday chart the ES Candles
  controls: wheel zooms about the cursor, drag pans, double-click resets. A
  "showing a zoomed range - reset" link appears next to the hint whenever the
  view is not full.
- **The window is an INDEX RANGE, not a pixel transform.** Scaling a transform
  would blow up the candle bodies and the axis text along with the data; here
  only the index-to-x mapping changes, so bars keep their width and labels stay
  legible at every zoom level.
- **The wheel listener is attached manually with `{ passive: false }`.** React
  registers `onWheel` passively and a passive listener cannot `preventDefault()`,
  so the page would scroll underneath the chart on every notch. This is the one
  place a raw `addEventListener` is the right tool.
- **Both scales follow the visible window.** Zooming into a quiet fortnight has
  to open that fortnight up; with a fixed scale you would just magnify the x-axis
  and leave every bar a hairline against the year's biggest day. Same for the
  intraday panel against an 11:29 spike.
- **Marks are clipped, not filtered.** Everything renders and a `clipPath` over
  the plot rect cuts what falls outside - simpler than slicing arrays in four
  places, and it keeps the absolute index available for hover and keys.
- **Intraday gridlines step down 30 -> 15 -> 5 -> 1 minute as the window
  tightens**, so a zoomed chart gains axis detail instead of showing two labels.
- Panning suppresses the crosshair for the duration - a drag that also moved the
  hover readout fought itself.
- The window auto-resets when the underlying series shrinks (symbol or lookback
  change), so a stale range cannot leave the chart scrolled past the end.

## 2026-08-10 - prem diff: SPX removed (its monthly is 1.4% of near-money SPX volume)

`app/test/PremDiffTab.tsx`, `server-v2/atm-prem-recorder.js`,
`server-v2/atm-prem-intraday-recorder.js`,
`server-v2/atm-prem-intraday-backfill.js`.

- **Measured, not assumed.** Live chain, 2026-08-10, within ±2% of spot:

  | expiry | root | call vol | put vol | premium |
  |---|---|---|---|---|
  | 2026-08-21 (front monthly) | SPX | 6,025 | 1,749 | ~$43M |
  | 2026-08-14 (this Friday) | SPXW | 15,763 | 10,651 | ~$62M |
  | 2026-08-10 (0DTE) | SPXW | 564,751 | 499,020 | ~$434M |

  The front monthly is about 1.4% of near-money SPX volume. The 0DTE weekly
  carries ~137x its contract count.
- **The panel was not broken - its definition does not fit SPX.** Prem Diff is
  built on the front and back MONTHLY, which is the right frame for SPY, QQQ and
  NVDA, where monthlies genuinely carry hedging and overwriting flow. SPX's
  liquidity lives in SPXW dailies, so the panel was faithfully charting a
  contract almost nobody trades - a few $M a minute against the ~$434M/day going
  through 0DTE.
- **SPX removed from both symbol lists and both recorder defaults** rather than
  papered over. Halves the intraday recorder's chain-fetch load as a side effect
  (4 requests a minute instead of 6).
- The removal is commented at each site with the measurement, because "add SPX
  back" is a decision about what "front month" should mean for a root whose
  liquidity is in dailies - not a matter of re-adding a string.
- `AM_SETTLED_ROOTS` stays. It is correct, it still covers XSP/NDX/RUT, and it
  applies again the moment SPX returns under a different slot definition.
- Existing `atm_prem_diff` / `atm_prem_intraday` rows for SPX are left in place;
  they are simply no longer read. Delete with
  `DELETE FROM atm_prem_diff WHERE symbol='SPX'` if you want the space back.

## 2026-08-10 - prem diff intraday: fixed 09:30-16:00 axis

`app/test/PremDiffTab.tsx`.

- **The intraday x-axis is now always the whole session**, 390 minutes, whether
  it is 09:35 or after the close. Previously it spanned only the minutes that had
  data, so at 10:00 twenty minutes were stretched across the full width and the
  whole chart re-scaled every 60 seconds - no sense of where you were in the day,
  and a quiet open looked like a full session of nothing happening.
- **Minutes with no data are simply not drawn.** Empty space is the honest
  rendering of "the day has not got there yet"; a zero bar would claim the
  recorder measured a minute of no flow.
- **The cumulative line stops at the last minute that has data** rather than
  being carried flat to 16:00, which would draw a session that finished quiet
  when it has not finished at all.
- **Gridlines and labels are on the half hour**, not every Nth sample. A fixed
  session axis should read like a clock; they fall back to hourly when the panel
  is too narrow for 14 labels. The rules span both panes so a time can be carried
  from price down to premium by eye.
- **Session start is computed by PROBING the zone, not by hardcoding -4/-5.**
  `sessionStartMs()` formats 12:00 UTC on the session date in America/New_York
  and derives the offset from what comes back. US DST transitions happen at 02:00
  local, so noon UTC is always on the same side of the switch as that day's
  09:30 ET. A chart that silently shifts an hour every March is worse than one
  that never worked.
- Falls back to anchoring on the first bucket when the API could not name a
  session date, so the chart still draws.

## 2026-08-10 - prem diff: intraday session backfill from 1-minute option candles

New: `server-v2/atm-prem-intraday-backfill.js`. Edited:
`server-v2/atm-prem-intraday-recorder.js` (adds `src`), `app/test/PremDiffTab.tsx`.

- **Simpler arithmetic than the live path.** The recorder has to DIFFERENCE a
  cumulative counter because the chain only reports volume-so-far. A 1-minute
  candle already carries the volume traded IN that minute, so a backfilled bucket
  is just `close x volume x 100` - no previous-snapshot state, no clamping of
  negative deltas, no baseline row.
- **A backfilled session is internally consistent** in a way a restarted live one
  cannot be: one pricing basis throughout and a cumulative that genuinely starts
  at the open.
- **Where it is worse:** priced at each bar's CLOSE (last trade in that minute),
  not the mark, so an illiquid wing can sit at bid or ask rather than between.
  Rows carry `src='dxlink'` and the panel says so.
- **Retention is the real limit.** 1-minute history is much shorter than daily
  and is not announced - candle-history's own header notes ~7 days for the ES 1m
  stream regardless of what fromTime asks for. Expect today plus a handful of
  sessions. The run prints the span it actually recovered rather than implying
  more.
- **Overwrites the whole session by default.** Mixing mark-priced live minutes
  with close-priced backfilled ones puts a seam in the cumulative line, and half
  a session of each is worse than either. `--keep-live` fills only the holes for
  the case where the recorder covered most of the day.
- **The resolver is seeded with the underlying's DAILY sessions, not just the one
  date.** One extra subscription, and it is what makes the holiday snap work: a
  resolver that only knows about `day` has no calendar to check the third Friday
  against, so a Juneteenth-style month would resolve to a Friday the market was
  shut and every symbol would return empty - the exact failure the daily backfill
  already hit once.
- **Every RTH minute gets a row**, even when nothing traded near the money, so
  the cumulative line stays continuous and a quiet stretch reads as flat rather
  than as a gap.
- `atm_prem_intraday` gains `src` (CREATE + idempotent ALTER, so a deployment
  that already created the table does not need a hand-run migration).

## 2026-08-10 - build fix: EconomicCalendar screenshot routed through lib/snapshot.ts

`components/pages/EconomicCalendar.tsx`, `lib/snapshot.ts`. NOT part of the Prem
Diff work - this was blocking `npm run build` for everyone.

- **What broke the deploy.** `scripts/audit-ui.mjs --strict` runs as `prebuild`
  and fails the build if any file outside `lib/snapshot.ts` reaches html2canvas.
  The Economic Calendar's new screenshot button stood up a second engine at
  `EconomicCalendar.tsx:197`. Nothing to do with the Prem Diff changes; the
  build would have failed on any push.
- **Why the rule exists, and why the port matters.** The engine owns a pile of
  workarounds a hand-rolled call site silently does without: gradient headings
  render INVISIBLE and have to be flattened in the clone; `backdrop-filter` is
  unimplemented so frosted panels come out washed; live `<canvas>` bitmaps do
  not survive the clone and are redrawn by hand; cloned `<script>` tags 404 from
  `about:blank`. The calendar's own capture was missing all of them.
- **`allowTaint` added to `SnapOptions`, defaulting to TRUE** so every existing
  caller is byte-identical. The calendar passes FALSE, preserving the behaviour
  its comment already documented: `/proxy/ticker-logo` 302s to third-party hosts,
  and drawing one of those TAINTS the canvas, after which `toBlob()` throws
  SecurityError and the whole screenshot dies over a 16px image. With
  allowTaint:false html2canvas skips the unreadable image - a missing logo, not
  a missing screenshot.
- **`windowWidth`/`windowHeight` dropped in favour of `height`.** Those two
  REFLOW the cloned document at a virtual viewport (gotcha 4 in the engine's
  header) - they are for media-query fidelity, not cropping. The scroll
  container is already expanded to its natural height before the capture, so
  `height: el.scrollHeight` is a pure output crop that gets the full list with no
  re-layout. **Worth eyeballing once**: this is the only behavioural change in
  the port, and it is the bit that decides whether the whole list lands in the
  PNG.
- Blob handling now uses the engine's `downloadBlob` instead of a hand-built
  object URL and anchor.

## 2026-08-10 - prem diff: 1-minute intraday mode for SPX / SPY / QQQ

New: `server-v2/atm-prem-intraday-recorder.js`. Edited: `server-v2/api-router.js`
(one new read-only route), `server-v2/atm-prem-recorder.js` (starts the intraday
recorder), `app/test/PremDiffTab.tsx` (Daily/Intraday + Per-minute/Cumulative
toggles). NO proxy file was touched.

- **Per-minute premium is a DIFFERENCE, not a product.** The chain reports
  cumulative day volume, so reading it once a minute and multiplying by the mark
  would re-count the whole session every minute. Each bucket is
  `(volume_now - volume_prev) x mark_now x 100`, and the delta is taken PER
  STRIKE before summing - aggregating volume to the band first and differencing
  that would price every contract at one blended number, which on a chain where
  a 2-delta wing and the ATM straddle differ by two orders of magnitude is a
  different quantity, not an approximation.
- **Side effect worth knowing:** summing the minute buckets gives a BETTER day
  total than the EOD recorder's single snapshot, which prices the whole session's
  volume at the 16:05 mark. They will not agree; the EOD number is the cruder
  one. Stored in separate tables, neither overwrites the other.
- **Restarts are recorded, not smoothed over.** The per-strike previous-volume
  map is in memory, so the first tick after a restart has nothing to difference
  against. It writes a BASELINE row (zero interval premium) instead of dumping
  the whole gap into one enormous fake bar. The panel says so when a session
  contains one, including that the cumulative line then starts from the restart
  rather than the open.
- **Band membership is recomputed every minute** against that minute's spot. A
  fixed strike list chosen at the open would be measuring something else by
  lunch. New strikes contribute nothing on the minute they first appear - their
  cumulative volume is history, not that minute's flow.
- **9:29 start, not 9:30.** The pre-bell tick establishes the day's baseline off
  pre-open volume, so the 09:30 bucket is the opening minute's flow rather than
  the opening minute plus everything that printed pre-market.
- **New table `atm_prem_intraday`**, PK
  `(date, symbol, slot, band_pct, minute)`, 45-day retention, ~7k rows/session at
  3 symbols x 2 slots x 3 bands x 390 minutes.
- **Started from `startAtmPremRecorder()`**, not a second hook in
  `server-with-proxy.js`. One boot call owns ATM premium capture at both
  resolutions; splitting the wiring means touching the proxy server file again
  for no reason.
- **Price pane uses real 1m candles** from candle-history, not the stored
  per-minute spot - one sample a minute gives open=high=low=close and renders as
  a row of dashes. A candle failure degrades to spot, it does not fail the
  request.
- Intraday auto-refreshes every 60s; the symbol picker narrows to SPX/SPY/QQQ so
  it cannot offer a name with no recorder behind it.

## 2026-08-10 - edge-check: the discriminating test (does the tilt beat "we just went down"?)

`server-v2/atm-prem-edge-check.js`.

- **Why it was needed.** The ±5% and ±2% runs both showed the `1 < z ≤ 2` bucket
  (moderate put-premium dominance) beating baseline in every symbol at every
  horizon - 32 of 32 cells across both bands. That survived the adjacent-band
  check, so the next question is not "is it consistent" but "is it the tilt at
  all". Tilt correlates about -0.5 with the SAME day's return, so a put-heavy
  session is largely a proxy for a session that just fell - and in a year the
  index rose, "buy after a down day" makes money on its own.
- **PARTIAL CORRELATION** of forward return with tilt, holding the trailing
  3-session return fixed. If the raw correlation is 0.13 and the partial is 0.02,
  the tilt was riding the recent move and adds nothing of its own.
- **DOUBLE SORT**: prior-3d-move tercile x tilt tercile, mean forward return per
  cell. Read ACROSS a row - the tilt earns its keep only if put-tilt beats
  call-tilt INSIDE a recent-move row. If the whole effect is the "fell most" row
  sitting high, that is dip-buying in a costume.
- Both are printed for h=3 and h=5, above the bucket tables, because the bucket
  tables cannot answer this and reading them first is how you talk yourself into
  a signal.
- Note on the bucket tables generally: the middle bucket holds ~47% of sessions,
  so "middle underperforms" and "both tails outperform" are ONE fact, not two -
  the weighted average is forced to equal the baseline. The put-side-vs-call-side
  comparison is the informative one.

## 2026-08-10 - prem diff: edge-check script (does a premium spike lead price, or follow it?)

New: `server-v2/atm-prem-edge-check.js`. Read-only, SELECTs on `atm_prem_diff`
and writes nothing.

- **Conditions forward returns on the premium tilt** and reports 1/3/5/10-session
  close-to-close returns bucketed by z-score, against an all-sessions baseline.
- **Scores the RATIO, not the dollars.** `(put-call)/(put+call)` is comparable
  across vol regimes and price levels; a $200M tilt in a quiet month and in a
  panic month are not the same event, but the share is. Dollars are still shown
  alongside for reference.
- **Trailing z-score, not full-sample.** A full-sample mean and sd use the whole
  year to score a bar from month two - the number could not have existed on the
  day it is being used to trade. That one detail is the difference between a
  backtest and a story.
- **The control that usually kills it: same-day correlation.** Premium follows
  price mechanically - a hard down day prints put volume because people trade
  puts on down days. If same-day correlation is strong and forward correlation is
  ~0, the panel is an accurate rear-view mirror and not a signal. That line
  prints ABOVE the bucket tables on purpose.
- **Prints its own caveats.** ~250 sessions means a |z|>2 bucket holds 5-12 days;
  forward windows overlap so the t column is inflated and is an ordering device,
  not a p-value; 4 symbols x 3 bands x 4 horizons is 48 tests, where two or three
  "significant" cells is what noise looks like. The footer says so every run.
- Also lists the top-N tilt extremes with their forward returns, because a table
  of means hides whether one September afternoon is carrying the whole result.

## 2026-08-10 - prem diff: recorder wired into boot; real candlesticks in the ES Candles colors

`server-v2/server-with-proxy.js`, `app/test/PremDiffTab.tsx`,
`components/shared/homeTheme.ts`, `components/dashboard/es-candles/EsChartCard.tsx`.

- **PROXY SERVER CHANGE (approved before applying).** `server-with-proxy.js`
  gains a defensive `require` beside the other recorder loads and one
  `startAtmPremRecorder()` call beside `startOiDailyRecorder()`. No proxy route,
  feed, socket or existing behaviour is touched. This is the only thing that
  grows the series FORWARD - the backfill can rebuild the past from dxLink
  candles, but today's tape has to be captured today, at 16:05 ET once day
  volume is final.
- **The price pane is now real candlesticks**, not OHLC bars: wick from high to
  low, body from open to close. The body floors at 1px so a doji does not round
  to a zero-height rect and disappear. A row with no recorded open (an older row,
  or a session whose daily bar was unavailable) is drawn flat rather than being
  assigned a direction it does not have.
- **`ES_CANDLE_UP` / `ES_CANDLE_DOWN` hoisted into `homeTheme.ts`.** These were
  literals inside EsChartCard's `addSeries(CandlestickSeries, ...)` options,
  repeated six times (fill, wick, border per direction). Both surfaces now import
  the pair, so the Prem Diff candles match ES Candles by construction instead of
  by a hex someone copied. EsChartCard's six literals were swapped for the
  constants in the same pass - hoisting a value and leaving the original copy in
  place just creates the drift the hoist was meant to prevent.
- Deliberately NOT `HOME_THEME.green` / `HOME_THEME.red`: those are the status
  palette (a light blue and a flat alert red). Candles want the saturated trading
  pair, and up-bars in the same light blue the cards accent with read as
  decoration rather than direction.
- The histogram keeps its own palette (cyan = calls dominant below zero, red =
  puts dominant above, purple = back month). It is not price and should not
  borrow price's colors.

## 2026-08-10 - prem diff: AM-settled roots roll a session early (SPX's 12 missing front legs)

`server-v2/atm-prem-recorder.js`, `server-v2/atm-prem-backfill.js`.

- **Holiday fix confirmed.** The re-run resolved June to `2026-06-18` and got
  193 of 350 contracts back. SPY front-month leg: 250 of 250 sessions, up from
  227. QQQ and NVDA also 250 of 250.
- **SPX came back 238 of 250** while the three ETF-style roots were perfect, and
  the 12 missing days were exactly the 12 monthly expirations in the window.
  That is not a data gap - **SPX's standard monthly is AM-SETTLED.** The
  settlement value is struck from Friday's open and the contract does not trade
  that day at all, so asking for its tape returns nothing. SPY/QQQ/NVDA
  monthlies are PM-settled and trade through the Friday close, which is why only
  SPX showed it.
- **`AM_SETTLED_ROOTS`** (`SPX`, `XSP`, `NDX`, `RUT`, `VIX`, `DJX`) now drives a
  `spent` test in `monthlyTarget()`: PM-settled rolls when the third Friday is
  BEHIND the session, AM-settled rolls when it is behind OR EQUAL. So on an
  AM-settled expiration day the front month is already next month, which is what
  the tape actually shows.
- **Both paths changed together, deliberately.** `makeMonthlyResolver()` in the
  backfill mirrors the same `spent` test. If only one moved, a live row and a
  backfilled row for the same date would carry different expiries and the series
  would quietly disagree with itself at the seam.
- Verified on a synthetic calendar: for 2026-05-15 (May expiration Friday) the
  PM resolver still says front = 2026-05-15 while the AM resolver says
  2026-06-18; the holiday-shifted 2026-06-18 behaves the same way.
- **Re-run SPX to pick this up** - upsert is on `(date, symbol, slot, band_pct)`,
  so it overwrites those 12 sessions in place. SPY/QQQ/NVDA are unaffected.

## 2026-08-10 - prem diff backfill: holiday-aware expiry resolution (the 2026-06-19 hole)

`server-v2/atm-prem-backfill.js`.

- **The dead expiry was not a feed failure. 2026-06-19 was Juneteenth.** It fell
  on the third Friday, the market was shut, and the June monthly actually
  expired THURSDAY 2026-06-18. Every one of the 350 `.SPY260619...` symbols the
  pull asked for was fictional, which is why 0 came back while neighbouring
  months returned 113-241 - and why ~23 sessions had no front-month leg.
- **Fixed at the source: `makeMonthlyResolver()`.** The third-Friday target is
  now snapped back to the previous session using the UNDERLYING'S OWN daily
  candle dates as the calendar. A session the underlying did not trade cannot be
  an expiry, so this covers every holiday, past and future, with no holiday
  table to maintain or keep current. Targets outside the pulled window are
  returned untouched - there is no calendar out there to consult, and walking
  backwards from one would invent an expiry.
- **`activeMonthlies()` now returns `byDate` as well as `byExpiry`,** and the
  row-flattening step reads the resolved expiry from it instead of calling the
  holiday-blind `monthlyTarget()` a second time. Two code paths computing the
  same expiry independently is how the labels drift apart.
- **The retry from the previous entry stays, with its rationale corrected.** It
  is a backstop for a dropped connection, not for this - retrying a fictional
  symbol just asks for the same fiction again.
- Verified against a synthetic session list with Juneteenth removed: front month
  for 2026-06-10 resolves to 2026-06-18, back month to 2026-07-17, and the roll
  to July happens after the 18th rather than the 19th.

## 2026-08-10 - prem diff: full-year backfill verified; one-shot retry for a dead expiry

`server-v2/atm-prem-backfill.js`.

- **Full-year SPY pull confirmed working.** 14 monthlies, ~4,400 contract
  subscriptions, 2,460 returned history -> 1,371 rows over 250 sessions
  (2025-08-11 -> 2026-08-07) in 107 seconds. Front-month leg present on 227 of
  the 250 sessions.
- **One expiry came back completely dead: 2026-06-19, 0 of 350 contracts**,
  while every neighbouring monthly returned 113-241. That is the 23-session gap
  in the front-leg count. An expiry that empty next to healthy neighbours is a
  dropped connection or a stalled replay far more often than a real hole.
- **So: ONE retry when an expiry returns zero.** The per-expiry pull is now a
  local function and is re-run once if `got === 0`. The `=== 0` test is
  load-bearing and must not be loosened to a threshold: a retry is only safe
  because zero contracts means nothing was accumulated into `perDate` on the
  first pass. Retrying a PARTIAL failure would add the bars that did land a
  second time and silently double that expiry's premium.
- **Expiries still empty after the retry are named in the summary and returned
  as `emptyExpiries`.** The failure mode is a HOLE in the middle of the series -
  the sessions that expiry was front month for get no bar at all - which is much
  easier to misread as a genuinely quiet stretch than a short series is.

## 2026-08-10 - prem diff: probe says expired contracts DO replay - full-year pull is back on

`server-v2/atm-prem-backfill.js`, `app/test/PremDiffTab.tsx`. Reverses the
entry below, which assumed delisted contracts were unreachable.

- **Measured, not assumed.** `--probe` on the prod box returned 42 daily bars,
  all carrying volume, for `.SPY260717C743` - a monthly that had ALREADY
  EXPIRED. Underlying replay went back 275 sessions (2025-07-07 -> 2026-08-07).
  So dxFeed is not dropping delisted option symbols on this token.
- **Defaults flipped back.** `--days` 120 -> 365, and every monthly in the
  window is attempted rather than only still-listed ones. `--listed-only` is now
  the restrictive mode, kept for the case where the entitlement changes and dead
  symbols start timing out. `--include-expired` still parses, as a no-op alias,
  so the command printed in the previous entry does what it claims.
- **The real limit is per-contract retention, and it is not announced.** That
  July contract's bars started 2026-05-18, ~2 months before expiry; a contract
  also only produces a bar on a session it actually traded. So the deep past
  thins on its own. The script does not guess where the wall is - it prints the
  recovered SPAN per symbol, and `strikes` per row shows how many strikes
  returned data for that session, so a thin month is visible.
- **Panel wording corrected.** The short-series footer no longer claims history
  "cannot be extended backwards" (that was written against the wrong premise).
  It now says the series starts where the replay ran dry and that re-running
  will not reach much further.
- **Note on running it at all:** `/opt/dashboard` on the VPS has the source but
  no `node_modules` - deps live inside the image (`WORKDIR /app`). Run scripts
  with `docker compose run --rm --no-deps dashboard node server-v2/...`, which
  picks up `env_file: .env.local` for the quote token.

## 2026-08-10 - prem diff: backfill scoped to still-listed expiries (expired contracts return nothing)

`server-v2/atm-prem-backfill.js`, `app/test/PremDiffTab.tsx`. Revises the entry
below - the 1-year backfill it describes is not achievable and the script no
longer pretends otherwise.

- **The ceiling.** dxFeed drops delisted option symbols on this quote token, so
  an EXPIRED contract returns zero candles. The panel's series is "premium in
  whatever was the front month ON THAT DAY", and for any session more than about
  a month back that day's front month has since expired. Its bars are gone and
  no amount of re-running brings them back.
- **What is actually recoverable** is the window where a STILL-LISTED monthly
  was already front or back month: the current front month covers roughly the
  sessions since the previous monthly expired (~3-4 weeks), the current back
  month about twice that. So the pull fills the trailing few weeks and stops.
- **The script now attempts only listed expiries.** `listedExpiries()` reads
  `fetchExpirations` and intersects it with the monthly targets in the window.
  Expired targets are named in the log and skipped, rather than costing a few
  hundred subscriptions and a 90s hard-timeout each to discover they are empty.
  `--include-expired` forces the old behaviour if the entitlement ever changes.
- **`--days` default dropped 365 -> 120.** A wider window buys no extra rows
  now, only a longer run.
- **It reports the recovered SPAN, not just a row count.** "412 rows" reads like
  success; "18 sessions, 2026-07-21 -> 2026-08-08" is the number that says how
  much of the chart is real and where the EOD recorder takes over.
- **`--probe` verdicts rewritten** around the known answer: the live-contract
  control is what confirms candle replay works at all, and the expected verdict
  now describes the 3-8 week ceiling instead of promising a full pull.
- **The panel says so too.** When the returned series is materially shorter than
  the selected lookback, the footer names the first available session and
  explains that it cannot be extended backwards - so a short chart reads as the
  data's limit, not a loading failure.

## 2026-08-10 - test lab: new "Prem Diff" tab - ATM premium traded, calls vs puts

New: `server-v2/atm-prem-recorder.js`, `server-v2/atm-prem-backfill.js`,
`app/test/PremDiffTab.tsx`. Edited: `server-v2/api-router.js` (one new read-only
route), `components/shared/sectionNav.ts`, `components/pages/TestLab.tsx`.
NO proxy file was changed - both new server modules only *require* exports that
already existed in `proxy-tastytrade.js`.

- **What it plots.** Underlying daily bars on top; underneath, a histogram of
  `put premium traded - call premium traded`, where premium is
  `price x day volume x 100` summed across the strikes within +/-band% of that
  session's close. Front monthly is the solid bar (blue below zero = call
  premium dominated, red above = put premium dominated); back monthly is the
  wide purple bar behind it. Live at `/app/test?tab=premdiff`.
- **Why a recorder and not a query.** Nothing in the database stored option
  VOLUME or PRICE. `oi_daily` is settled open interest,
  `option_strike_gex_history` is gammas and the GEX products, `eod_dte_gamma` is
  bucketed OI + net gamma. Premium traded cannot be reconstructed from any of
  them - the price leg is simply not there. Hence a new table.
- **New table `atm_prem_diff`**, PK `(date, symbol, slot, band_pct)`, upsert, so
  a re-run overwrites a day cleanly. `slot` is `'front'`/`'back'`, `src` is
  `'live'` (EOD recorder) or `'dxlink'` (backfill).
- **Front month = the third Friday, computed, not read off the chain.**
  TastyTrade tags SPY's third Friday as "Weekly" - every SPY expiry in the
  current listing comes back "Weekly" - so filtering on `expiration-type`
  returns everything or nothing depending on the root. `thirdFriday()` computes
  it, and `resolveMonthlies()` snaps to the closest LISTED expiry within 2 days
  so a holiday shift to Thursday still resolves.
- **Three bands written every sweep (+/-1%, +/-2%, +/-5%).** "ATM" is the single
  knob that most changes what the histogram looks like, so it is a STORED
  dimension rather than a baked-in constant - the UI switches band with another
  row of the same index scan, no upstream recompute.
- **EOD recorder fires 16:05 ET, weekdays.** Day volume on the chain is final by
  then and the 16:00 print is in. Sourced from `fetchExpirations` /
  `fetchChainFull`, the same REST pair `oi-daily-recorder.js` already uses.
  Disable with `ATM_PREM_RECORDER=0`.
- **Prices at the MARK, not last.** A strike whose only print of the day was a
  stale 09:31 fill would otherwise price the whole day's volume off it.
- **Backfill via dxLink daily candles.** TastyTrade REST has no historical
  option endpoint at all, but a dxLink `Candle` subscription with `fromTime`
  replays a bar snapshot, and that works for option symbols
  (`.SPY260821C773{=1d}`). `atm-prem-backfill.js` synthesises the contract
  symbols per expiry, batches them over ONE throwaway connection (its own, like
  `candle-history.js` - it cannot disturb the live feed) and sums the replayed
  bars. Strike range is computed per expiry from the underlying's travel while
  that expiry was in play, which is what keeps the symbol count in the low
  thousands instead of tens of thousands.
- **RUN `--probe` FIRST.** (Superseded by the entry above: expired contracts
  return nothing on this token.) dxFeed retention for delisted option
  contracts is an entitlement question, not a code question. `node server-v2/atm-prem-backfill.js
  --probe` asks for one expired ATM contract and one live one and prints a
  verdict in ~10s: if expired contracts come back empty, the backfill is not
  possible on this token and the forward-only recorder is the available path.
  Then `--dry` to see the numbers before writing.
- **Backfilled bars are labelled.** They are priced at the daily CLOSE, not the
  16:05 mark, so wing strikes sit at last trade rather than mid. The panel
  footer says so whenever any `src='dxlink'` rows are in the window.
- **Honest about what it is not.** Premium traded is flow, not position; it is
  unsigned (nothing here knows which side lifted); it is not gamma-weighted. The
  panel says all three, and the sigma tile is there because a single bar only
  means something against the series' own history.
- **Still to wire:** `startAtmPremRecorder()` in `server-with-proxy.js` (2 lines,
  held back pending confirmation since that is the proxy server file).

## 2026-08-10 - analytics: Ticker Lookup split into two panes, right = whole board

`components/pages/Analytics.tsx` (client only - no proxy, server or API file was
edited; the right pane calls an endpoint that already existed).

- **The card is now two panes on one ticker.** LEFT = one expiration, picked
  from the front-of-board pills. RIGHT = every listed expiration. Same symbol,
  same spot, same ladder shape, so the two read side by side.
- **The right pane is the WHOLE board, not the front 3.** It reads
  `/proxy/gex-by-strike-multi?symbol=&spot=&date=` - the server's existing
  full-board sweep (`eod-gex-recorder.computeLiveGexRowsMulti`), which returns
  slim `{ strike, netGEX, netVolGEX }` rows summed per strike ACROSS every
  expiration. `netGEX + netVolGEX` is the same OI+Vol basis the left pane uses.
  One request; the server caches it 60s per (symbol, session), so a 40-expiry
  chain is one sweep a minute instead of forty browser fetches. Polled at 120s.
- **Spot is passed through, not defaulted.** That endpoint's own default spot is
  the SPX live feed, which is wrong for every other name, so the right pane
  holds its fetch until `/api/chains` has given us the ticker's underlying
  price, then passes it. Both panes are priced off that one number.
- **Honest fallback.** If the sweep errors or returns nothing (no Theta cover
  for the name, cold cache), the right pane falls back to the front expirations
  chains already returned and its subheader says `N front expirations - full
  board unavailable` in orange. It never prints three expiries under an "all
  expirations" label.
- **The regime chip, "The read" line and the shared +/- Move / ATM IV** now come
  off the whole board (regime) and the picked expiry (ATM), which is the pairing
  that actually matches how each number is defined.
- Ladder rendering and the level chips were extracted into `TlLadder` /
  `TlLevelChip` so both panes render from one component - two copies would
  drift. The CB/Call-wall collision rule and the 10-above/10-below window apply
  per pane, off that pane's own full ladder.

## 2026-08-10 - analytics: CB/Call-wall collision rule + white chip ink

`components/pages/Analytics.tsx`.

- **Call wall steps down when Core owns the strike.** Core (CB) is the highest
  |GEX| strike on the board, so whenever that strike is call-side it is ALSO
  the highest +GEX strike - Core and Call wall printed the same number and the
  card showed one level twice. `tlLevelsFrom()` now tracks the top TWO +GEX
  strikes and, when Core and Call wall collide, promotes the second-highest
  +GEX strike to Call wall: the next real ceiling above the magnet. Put wall is
  untouched - a call-side core can never collide with it.
- **Level chip text is white.** The distance line and the note line under each
  chip were `HOME_THEME.muted` at 0.55 / 0.45 opacity, which rendered gray. Both
  are now `HOME_THEME.text` at full opacity.

## 2026-08-10 - analytics: Ticker Lookup restyled to the page theme

`components/pages/Analytics.tsx`.

- **Colors are the page's own now.** The card was using `REFRESH_GREEN` /
  `SOFT_RED` from homeTheme; both imports are gone. Positive/negative anywhere
  on the card - the ladder bars, the value column, the Net GEX stat, the
  gamma-regime chip - now use `POS_GREEN` / `HOME_THEME.red`, the same pair
  `signColor()` uses everywhere else on this page. Level chips keep
  `LEVEL_COLORS` (cb gold / cw blue / pw red), the app-wide wall colors.
- **Ladder is 10 strikes above and 10 below spot** (21 rows) instead of the 15
  nearest. Sliced off the strike INDEX, not a point distance, so a $2.50-wide
  chain and a $5-wide chain both give ten rungs a side.
- **Call wall / Put wall / Core words removed from the strike column.** The
  marks are now 7px colored dots in the level color; the strike column reads as
  a column of numbers again. The chips under the ladder still name each level.
- **No left accent bar.** "The read" callout dropped its 3px colored
  `borderLeft` for a plain hairline border like every other card surface, and
  its label is now theme cyan.

## 2026-08-10 - analytics: Contract Lookup removed, Ticker Lookup GEX card added

`components/pages/Analytics.tsx`.

- **Contract Lookup card deleted.** The saved-contract grid (the `/api/watch`
  Owner-Watch clone: add ticker/expiry/strike/side, click a card for greeks)
  and every helper that existed only for it - `WatchSnapshot`, `WatchRow`,
  `wFmt`/`wFmtInt`/`wFmtMoney`/`wDayChgPct`/`wTimeAgo`, `WATCH_REFRESH_MS` -
  are gone. The now-unused `ThemedDatePicker` import went with them. `/api/watch`
  itself is untouched; nothing on this page calls it any more.
- **New full-width Ticker Lookup card at the bottom of the grid.** Type any
  optionable symbol (or hit a quick pill: SPX / SPY / QQQ / NVDA / TSLA, plus
  the last 8 looked up, persisted in `localStorage` under
  `analytics.tickerLookup.recent`) and the card renders that name's live GEX
  ladder: a centered bar rail with +GEX right and -GEX left, the 15 strikes
  nearest spot, the spot row outlined and tagged, and Call wall / Put wall /
  Core marks inline on their strikes.
- **Headline row** carries spot, a Positive/Negative gamma chip off the net,
  the ATM straddle as +/- Move, Net GEX and ATM IV. Below the ladder: a plain
  language "The read" line, then Core (CB) / Call wall / Put wall / Gamma flip
  chips, each with its distance from spot.
- **One GEX formula, not two.** The card reads `accumulateChainGreeks()` - the
  same OI+Vol function the Multi Greek card at the top of the page uses, off the
  same `/api/chains` payload. That function took an optional `expiry` argument
  so the ladder can narrow to one expiration; a private copy of the formula is
  how two cards on one page end up printing different numbers for the same
  ticker.
- **Walls and the flip are computed on the FULL ladder**, not the drawn window,
  so cropping to 15 rows can never invent a nearer wall. Call wall = highest
  +GEX strike, Put wall = most -GEX strike, Core = highest |GEX|, Gamma flip =
  the interpolated zero crossing of cumulative GEX from the low strike up.
- **Expiry pills are honest about scope.** `/api/chains` with no `?expiration`
  returns the front THREE expirations, so "All" says `3 front expirations`
  rather than implying the whole board; each pill shows its date + DTE.
- No proxy, server or API change - this is a client page edit only.

## 2026-08-09 - test lab: DEX/Charm pill removed + toolbar dropdowns above the sub-strip

`components/shared/sectionNav.ts`, `components/shared/GlobalToolbar.tsx`,
`components/shared/SectionSubStrip.tsx`.

- **DEX / Charm pill deleted from the Test Lab strip.** `app/test/DexCharmTab.tsx`
  was removed earlier and TestLab's `TestTab` union dropped `"dexcharm"` with it,
  but the pill stayed in the `sectionNav` registry — so the button was still
  rendered, navigated to `/test?tab=dexcharm`, and fell through to the default
  tab. Removed from both `tabs` and the `gamma` group. A saved custom pill order
  containing the old key is safe: `renderItem` returns null for an id the section
  no longer declares.
- **Toolbar dropdowns no longer paint under the sub-strip.** On Scanner and Test
  Lab — the only two routes with a `SectionSubStrip` — opening the user/account
  menu (or NavMenu, or the ticker list) put it *behind* the strip. Cause: the
  toolbar pill sets `backdrop-filter`, which creates a stacking context, so those
  dropdowns' inner `z-index: 100 / 1` are capped at the pill's own level (0), and
  the strip — also level 0, later in the DOM — won the tie. Fix: the pill's
  gradient-border frame is now `position: relative; z-index: 2`, above the strip's
  0. Nothing else moves; the band stays at 50 over page content.


## 2026-08-09 - chain + multi-greek: EM tag beside the strike, no EM row lines

`components/pages/OptionsChain.tsx`, `app/mult-greek/MultGreekClient.tsx`.

- **The EM marker lines are gone.** Options Chain drew a dotted `borderTop`
  across the whole row (strike cell, every expiry cell, and the ⅀ Total cell)
  for the 1x/2x band strikes; Multi Greek drew a solid/dashed `borderTop` on the
  row. Both removed - the row now reads like any other.
- **EM now labels the strike.** Options Chain tags the band rows `EM +1s` /
  `EM -1s` / `EM +2s` / `EM -2s` in the existing tag slot next to the strike
  (was bare `+1s`/`-1s`). Multi Greek's `EM` / `2x EM` badge moved out of its
  absolute top-left corner position and now sits inline, immediately left of the
  strike number in the strike cell.
- **CLOSE marker removed** from Options Chain - the band-center row no longer
  gets a line, a `CLOSE` tag, or a tooltip. The `emStrikes.close` value is still
  computed (it anchors the band math) but nothing renders from it.
- ATM styling on both pages is unchanged.

## 2026-08-09 - landing: full-width pitch + receipts/hero locked to one pair

`components/landing/LandingClient.tsx` (CSS only for the two child components —
`ReceiptsStrip` and `HeroVideo` are untouched and still natural-sized elsewhere).

- **Pitch paragraph runs the full card width**, centered under the masthead. It
  was inside the left column at `maxWidth: 520`, so it wrapped at half width
  while the logo above it spanned everything.
- **Receipts strip and the live-dashboard shot are now the same size and start
  on the same line.** `topGrid` went `alignItems: start` → `stretch`; each
  column is a flex column; the trial CTA and the Bzila card are pinned to one
  fixed 78px header height so the two cards below them share a top edge; both
  cards take `flex: 1` so they share a bottom edge. The hero's 16:9 padding
  spacer is collapsed to `position: absolute` on desktop — left alone it drives
  its own height and the match breaks.
- Under 900px the columns stack, so all of the above reverts: natural heights,
  hero gets its 56.25% aspect box back.

## 2026-08-09 - landing: centered masthead logo + free "Bzila" card

`components/landing/LandingClient.tsx`.

- **Logo is the masthead.** It was inside the left column of `landing-top`, so
  its width was capped at half the card. Moved above the grid, centered
  (`margin: 0 auto`), `min(620px, 100%)` wide, max-height 132 → 210. The mobile
  overrides on `.landing-logo` still clamp it on small viewports.
- **New "Bzila" card**, right column, directly above `HeroVideo` — a `Free`
  pill, the name, one line of copy, `Open →`. Links to `/bzila`. Styled off
  `HOME_THEME` (cyan accent, no new hex) and deliberately quieter than the
  trial CTA so it reads as a second destination, not a second offer.
- `/bzila` page itself is not built yet — the link is a placeholder pending the
  page spec.


## 2026-08-09 - budget-vite: home-screen icon was blurry

Assets only — no markup change. The first version dilated the stroke AFTER
downscaling to 180, which does not draw a thicker line, it smears a 1px line
into a 3px grey band. That is what read as blur on the home screen.

Rebuilt pipeline, in `budget-vite/public/`:

- **Autocontrast the alpha first.** `heart.png`'s line peaks at 255 but averages
  11 — most of its width is partial coverage. Fine at 816px, a grey wash once it
  is one pixel wide.
- **Thicken at 1024, then downsample once.** The stroke is ~5px at source, i.e.
  ~1.1px at 180 — too thin to survive. Dilating at the master resolution and
  resampling once gives a solid line instead of a soft one. `MaxFilter(5)`:
  enough to read, not enough to close the counters in the script lettering
  (7 starts filling in "Brandon").
- **Unsharp after the resample**, which is where the softness actually comes
  from.
- The 32px favicon gets a much heavier dilation (11) and no corner glow — the
  names are illegible at that size regardless, so it is weighted to read as a
  heart mark rather than a smudge.

180 is the exact tile size on a 3x iPhone, so no size change was needed —
nothing was being upscaled, the source was just soft.

**iOS caches home-screen icons hard.** Remove the tile and re-add it after
deploying, or it will keep showing the old one.


## 2026-08-09 - budget-vite: status strip is two tiles, side by side

### `src/pages/Today.tsx`

- **"Month elapsed" removed** — from both layouts, not just the phone. It was a
  progress bar for the passage of time, a fact the date line above it already
  states, and on a phone it pushed the calendar a third of a screen down.
- The one figure it carried that isn't derivable — **projected end of month** —
  moved onto the Money card, directly under the balance. That is the only number
  it means anything against, and it was on the status strip a full screen away
  from it. Shown alongside the balance, never instead of it.
- **Time and weather now sit side by side at every width**, phone included.
  Stacked, those two tiles were ~200px of chrome above the first thing you came
  to read.
- Half a phone width is ~160px, so the tiles shed what doesn't fit rather than
  wrapping: clock 38→30px, the timezone city drops off the date line, and the
  place name moves from beside the word "Weather" to under the temperature,
  where there is room for it.
- The strip collapses to ONE column when no ZIP is set. A half-width tile with
  dead space beside it reads as something having failed to load. `StatStrip`
  now owns that decision and only mounts `WeatherTile` when there is a ZIP, so
  the tile no longer has to render-nothing on its own.

Typechecks clean.


## 2026-08-09 - budget-vite: home-screen icon

Adding budget.cbedge.net to a home screen produced a screenshot of the page,
because `index.html` declared no icon and no manifest at all.

### New files in `budget-vite/public/`

- `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png`, `favicon-32.png`, `manifest.json`.
- All generated from the existing `public/heart.png` — the same Brandon+Heather
  line-art already on the Welcome screen — composited over `#05060A` with the
  app's own cyan corner wash, so the icon and the first screen are visibly the
  same product.
- **Opaque, not transparent.** `heart.png` is white strokes on alpha; installed
  as-is iOS composites it onto black-on-black and you get a blank tile.
- The stroke is dilated before the downscale. It is a fine pencil line at 816px
  and straight resampling to 180 leaves a grey whisper.
- The maskable variant is inset to the middle ~62%. Android crops icons to a
  circle and would have taken the top of the heart off.

### `budget-vite/index.html`

- `apple-touch-icon`, `icon` and `manifest` links added. iOS ignores manifest
  icons entirely and uses the apple-touch-icon, which is why both exist.
- **`theme-color` corrected from `#F7F4ED` to `#05060A`.** It was still the
  cream value from before the app went dark, so the installed app flashed white
  on every cold start.
- `apple-mobile-web-app-status-bar-style` `default` → `black-translucent`. The
  shell already pads with `env(safe-area-inset-top)` and the viewport is
  `viewport-fit=cover`, so the page now runs under the status bar instead of
  leaving a white band above it.
- Manifest is `.json`, not `.webmanifest`: nginx:alpine's bundled `mime.types`
  has no entry for that extension and would serve it as
  `application/octet-stream`. `application/json` is accepted for a manifest and
  needs no nginx change.

Icons are static assets in `public/` — Vite copies them to the dist root and
nginx's `try_files` already serves them. No build or config change.


## 2026-08-09 - budget-vite: habits grid fits a phone, weather ZIP default

### `src/pages/Today.tsx`

The habits table overflowed its card at 390px. Auto table-layout sizes columns
to their content and will not shrink below it, so one long habit title pushed
the whole table past the card edge and the last day columns were clipped.

- **`tableLayout: 'fixed'`**. Day columns get exactly the width they ask for and
  the habit-name column takes the remainder, so it wraps instead of the table
  growing.
- The grid gets narrower on a phone, not the card wider: cells 30→26px and marks
  21→18px below 860px, name column 14→13px, `overflowWrap: 'anywhere'` on the
  title.
- `Mark` takes a `size` and scales its radius and glyph with it, rather than
  having a second hardcoded copy for the phone.

### `server-v2/_lib-household.cjs`

- `DEFAULT_SETTINGS.weatherZip` is **27591** (Wendell) instead of empty — home
  for both people on this instance, so neither has to type it in and no DB write
  was needed to seed it. Still per-user underneath: either can override it in
  Settings without touching the other, and clearing it to `''` turns the tile off
  for that person only.
- Settings copy updated to say so.

Typechecks clean; `node --check` passes on both `.cjs`.


## 2026-08-09 - budget-vite: Today paired down, weather tile, Journal tab

### Layout — `src/pages/Today.tsx`

Removed: **In brief**, **Top 3**, **Goals**, **Slipping**, **Active projects**.
What is left is five rows, each a question answered from two sides:

    strip     time · weather · month pace
    calendar  full width
    todo      | habits     what you have to do  | what you keep doing
    journal   | lists      what you're thinking | what the house needs
    money     | bills      what you have        | what's leaving

- The calendar is full width again. Halved, the seven-day strip was the
  narrowest element on the screen.
- **Todo now lists ALL open tasks.** It previously excluded the starred ones
  because Top 3 rendered them above; with Top 3 gone that filter would have made
  starring a task hide it. Stars still show on the row.
- Nothing was deleted server-side. `top3`, `slipping` and `counts` are still on
  `/api/hh/today`; Todo and Projects still render the same data on their own
  screens. This is a home-screen edit only.

### Weather — `server-v2/household-routes.cjs`, `_lib-household.cjs`

- **New `GET /api/hh/weather?zip=NNNNN`** (auth `household`). This is a second
  copy of the logic in `api-router.js`'s `/api/weather`, NOT a call through to
  it: that route is registered `auth: 'subscriber'` and resolves an active
  trading-app session, which an `hh_session` cookie can never satisfy — from
  budget.cbedge.net it would 401 forever. Upstreams are keyless (zippopotam →
  Nominatim fallback → open-meteo), so there is no secret to share and no env
  var to set. **If the WMO table or the provider changes, both copies need it.**
- Ten-minute in-process cache keyed by ZIP. Today mounts this on every return to
  the home tab; without it a phone left open all day is a few hundred calls to
  somebody else's free API.
- `weatherZip` added to `DEFAULT_SETTINGS` and accepted by `POST
  /api/hh/settings`. **Per person, not per household** — two people who live
  together can still be in two places. Empty is a valid saved value: that is how
  you turn the tile off, so it is not rejected as invalid.
- The tile renders **nothing at all** with no ZIP set. An empty weather tile is
  worse than no tile — a permanent hole on the home screen advertising a setting
  you chose not to fill in. Settings is the only place that mentions it.
- `useWeather` is `enabled`-gated on a valid ZIP (zero requests when unset),
  `staleTime` 10min to match the server cache, and `retry: false` — a bad ZIP or
  a down upstream does not improve on a second attempt, and the tile says so.

### Journal — new tab

- **`src/pages/Journal.tsx`** (new), routed at `/journal`, sixth bottom tab.
  Entries grouped by day, newest first, with Today/Yesterday labels; the year
  only appears once it isn't this one.
- Grouping keys on the **local** date, not the ISO string's UTC date — an entry
  written at 9pm ET otherwise files itself under tomorrow.
- Defaults to `kind = 'journal'` with a toggle for the older saved-notes kinds,
  so a years-old quote pool doesn't bury this week.
- Delete needs a second tap. This is the one screen whose content is
  unrecoverable — a task can be retyped, a thought from a Tuesday in March
  cannot.
- Today's Journal card is now capture-only and links here.

### `src/components/Shell.tsx`

- Six tabs. At 390px that is 65px each, and "JOURNAL" at 0.12em tracking wraps
  and drags the bar taller — tracking drops to 0.04em and the size to 9.5px,
  with `nowrap`. The tracking gives, not the label: the word is what makes the
  tab findable.

Client typechecks clean; both `.cjs` files pass `node --check`.


## 2026-08-09 - budget-vite: Today rebuilt as the Life OS dashboard

Reference layout: status strip, two columns, project lanes, three-across footer.
**No new tables and no new endpoints** — every block reads something that already
existed and was only being rendered somewhere else, or not at all:

| Block   | Source                                                        |
|---------|---------------------------------------------------------------|
| Goals   | `projects` → `progress` (milestones done/total, server-side)   |
| Habits  | `routines[].history` — the array the streak is already derived from |
| Journal | `notes` with `kind: 'journal'` — the column always accepted it, nothing wrote it |
| Money   | the `money` block already on `/api/hh/today`                   |
| Lists   | the `lists` block already on `/api/hh/today`                   |

### `src/pages/Today.tsx`

- **Two columns above 860px, one below**, in the same order either way — DO on
  the left (calendar, Top 3, Todo, Slipping), TRACK on the right (goals, habits,
  journal). The split is a width affordance, not a second information
  architecture, so nothing is reachable on one and hidden on the other.
- `useWide()` uses `matchMedia`, not a CSS breakpoint: this app is inline-styled
  from `theme.ts` and has no stylesheet to hang a media query on. Putting half a
  layout in `index.css` would hide it where nobody looks.
- **Status strip** — clock, next event, month pace.
  - The clock re-arms on the top of the minute (`60000 - Date.now() % 60000`),
    not on a blind 60s interval, which shows the wrong minute for 59 seconds if
    it happens to mount at :59.
  - Next-up is silent when no calendar is connected. `CalendarCard` right below
    already explains why; two "connect Google" prompts on one screen is nagging.
  - The pace bar is the CALENDAR month, not spend — it is the denominator you
    read the projection against, and a spend bar beside a projection figure
    invites reading one as the other.
- **Habits grid** looks each day up in `routine.history` by date key rather than
  slicing the last seven entries. The array's length and direction are the
  server's business; a slice shifts the whole grid by a day if either changes.
  Future days render as a dashed square, not a cross — a day that hasn't
  happened is not a missed day, and drawing it as one makes every Monday a wall
  of failure.
- **Goals** skip projects with `progress: null`. Null means no milestones, i.e.
  unknown, not zero — a 0% bar would be a claim the data does not make.
- **Project lanes** map to the existing `status` values (`someday` / `active` /
  `done`), read-only; the board with drag stays on `/projects`.
- Footer split into Money / Bills / Lists. Bills were previously buried at the
  bottom of the money block.

### `src/hooks.ts`

- `useCreateNote` takes an optional `kind`, defaulting to `'note'`. Settings'
  saved-notes box is unchanged.

### `src/components/Shell.tsx`

- Content capped at 1040px and centred, header included. Without it the two
  columns keep widening on a monitor until a task title floats alone in a metre
  of card. Below the cap the wrapper does nothing, so the phone layout is byte
  for byte what it was.

**Cost:** the home screen now fetches projects and routines alongside today +
calendar. Four queries where there were two. All are react-query cached and the
two `useProjects()` callers on the page share one request.

Typechecks clean.


## 2026-08-09 - budget-vite: Today reordered around the calendar

Follow-up to the card conversion below. Order on `/today` is now Calendar, Top 3,
Todo, Slipping, Money.

### `src/pages/Today.tsx`

- **"In brief" removed.** It opened the page with one sentence counting what the
  cards underneath already spell out — first thing read, least informative thing
  on the screen. `counts` is untouched on the payload and still used elsewhere;
  this is a render change only, nothing server-side.
- **Calendar is the first card.** It is the only block on the page you cannot
  change — the day is already committed — so it sets the frame the task lists are
  read against.
- **"Open tasks" renamed "Todo"**, matching the tab it mirrors.
- **`QuickAdd` moved out of the top of the page and into the bottom of the Todo
  card**, under a hairline. You read the list, find the thing isn't on it, and
  the box is already at the end of it under your thumb — rather than scrolling
  back up past the calendar to an add box that floated above everything.

Typechecks clean.


## 2026-08-09 - budget-vite: every page container is a card

The phone build was drawn entirely with hairline rules — a section was a 1px top
border and 26px of whitespace. On a 390px screen that reads as one continuous
column: nothing bounds a section, so where "Top 3" ends and "Calendar" begins is
inferred from the gap size, and the gap sizes were not consistent (Today 26,
Todo 22, Lists 20, Budget 14). Every section is now a bounded surface.

### `src/theme.ts`

- **`section()` is now the card**, not a rule: the dashboard's surface (a faint
  cyan wash from the top edge over `rgba(13,17,25,0.55)`), a hairline border, an
  18px radius, 15px padding. This is the whole change — `section()` is the only
  page-container helper in the app, so redefining it converted all 34 call sites
  across Today, Todo, Lists, Money, Projects, Routines and Settings at once. No
  page-level restyling was needed and none was done.
- Radius 18, where `card()` stays 16: these are full-bleed containers and the
  softer corner keeps them from reading as buttons. `card()` is unchanged and
  still used for the small dense surfaces inside Money, which now nest inside a
  `section()`.
- Rule 2 in the file header rewritten — it said "hairline rules, not cards" and
  would otherwise have contradicted the helper directly beneath it.
- Added the constraint that follows from this: **never nest `section()` inside
  `section()`** — two borders and two washes read as a rendering bug.

### `src/components/CalendarCard.tsx`

Rebuilt to the reference layout. Every existing failure-mode branch is untouched
(not-configured, not-connected, revoked, none-selected, partial failures) — this
is layout only.

- **Serif date line** — "Saturday, *August 9*", weekday plain and date italic.
- **Seven-day strip**, Monday-first, today filled solid `T.ink`. Read-only: it
  orients you in the week without implying a day is tappable, which this app has
  no screen for.
- Both are derived from the `date` prop, **not** from the Google response, so
  they still render when the calendar is unreachable. On a screen whose job is
  "what is today", the date should never depend on a network call.
- `parseDay()` builds the bare `YYYY-MM-DD` **locally**. `new Date('2026-08-09')`
  parses as UTC and renders as the 8th anywhere west of Greenwich, which would
  have printed the wrong weekday on the card every day.
- Sunday walks back six days, not zero (`(getDay() + 6) % 7`) — the naive version
  renders a week ahead every Sunday.
- All-day event band bleeds to −15 to track the new `section()` padding.

### Spacing

- Column gaps normalised to 14 (Today 26, Routines 26, Todo 22, Lists 20). The
  gap used to be the only separator; the cards do that now and the extra space
  cost most of a screenful of scroll.
- `Shell.tsx` main padding 20px → 13px each side. Cards carry their own 15px
  inset, so the old value put content 35px from the edge of a 390px screen and
  squeezed the seven-day strip.
- Today's "In brief" block was a bare `<div>` and is now a `section()`, so it is
  no longer the one unboxed thing on the page.

### `src/components/BudgetOverview.tsx`

- The "Uncategorised" footer used `section()` from **inside** a Collapsible card.
  That is the one nested call site in the app and it would have become a
  card-in-a-card; replaced with a plain ruled div.

Typechecks clean (`tsc --noEmit`, `noUnusedLocals` on). Palette untouched — this
is structure only, still the CB Edge dark set.


## 2026-08-07 - Options flow: the /flow tape was persisting ~3% of SPX 0DTE

Diagnosed from production: `flow_prints` was taking ~3 rows/min for SPX while the
server's own `[FLOW_DEBUG]` counter showed the tape creating ~170 above-floor
orders/min. The chart's long flat stretches and vertical cliffs were both
downstream of that.

### The mechanism

`FlowProcessor` coalesces fills into one order for `FLOW_COALESCE_MS` (5s) and
keeps the order's `ts` at its **first** fill. `bucket()` only exposes an order
once its accumulated premium clears `FLOW_TAPE_FLOOR`. Ordinary SPX 0DTE orders
open small and grow — so the writer first *sees* them seconds after their `ts`.

`writeFlowTape`'s cutoff was `newest written ts − 500ms`. Every late-crossing
order was therefore already below the cutoff the first time it was visible, and
was silently skipped forever. Only prints big enough to clear the floor on their
**first** fill were persisted.

That is why the burst minutes looked like flow and weren't: a chain-wide dxLink
`Trade` snapshot (one synthetic print per strike, 2600–9800 at spot 7736, ~261
strikes sharing ~15 millisecond timestamps) is a set of single large prints, each
born above the floor — so those sailed through while the real order flow didn't.

Simulated against the real module over 60 ticks of a 500ms loop:

    born-above-floor persisted : 60/60   (both versions)
    late-crossing    persisted : 0/54    before  ->  54/54 after

### `server-v2/state/flow-history-writer.js`

- **Flush cursor keys off `lastFillAt`, not `ts`.** New field on each tape entry,
  stamped from the local clock on create and on every coalesced fill, so it is
  monotonic in ARRIVAL order regardless of what the print timestamps do.
- **Look-back widened from 500ms to a full coalescing window** (`FLOW_COALESCE_MS`
  + 1s margin), so an order still merging fills is re-upserted until it settles.
- **The INSERT is chunked at 500 rows.** Postgres rejects any query over 65535
  bind parameters; at 16 params/row a single statement caps out at 4095 rows.
  Above-floor tape entries are never evicted while under `FLOW_TAPE_CAP`, so any
  flush from a cold cursor — first tick after a restart, or any tick after a
  failed write left the cursor un-advanced — hands in the whole session. Verified
  against the deployed file, which fails outright:

      [flow-history] write failed (will retry next tick): bind message supplies
      144000 parameters, but prepared statement requires 65535

  The catch swallows it as "will retry next tick", the cursor never advances, and
  every later tick rebuilds the same oversized statement. Permanent, silent.
  Production `bucketTape` was 4153 when this was found — already past the line.
  `backfillFlowRows()` directly below has always chunked at 500.

### `server-v2/computation/flow-processor.js`

- New `lastFillAt` on every tape entry (see above).
- `@param time` is now the print's exchange timestamp when the feed supplies one.
- Coalescing window is `Math.abs(time - anchorTs) <= coalesceMs`. With exchange
  timestamps a replayed batch can hand us a print marginally older than the open
  order's anchor; the old `time - anchorTs` went negative and passed the test by
  accident.

### `server-v2/proxy-tastytrade.js` — prints carry their exchange time

`FEED_SETUP` has always requested `TimeAndSale.time` and `_handleFeedData` parsed
it into `ev.time`, but the handler dropped it and let `addPrint` default to
`Date.now()`. Fine for live prints; wrong for a replayed batch, where every print
gets the same ingest stamp and an hour of tape collapses into one 1-minute bin —
the vertical cliffs on the Net Drift chart. Production confirms it: the first
minute of each burst held 265 rows across just **15** distinct `ts`.

- **New `stampFlowTime()`** — takes the exchange time when it is finite, positive,
  ≤ `FLOW_TS_MAX_SKEW_MS` (60s) ahead and ≤ `FLOW_TS_MAX_AGE_MS` (24h) old; falls
  back to the ingest clock otherwise. The age bound is a full trading day on
  purpose: genuinely old replays must be kept, the bound only stops an epoch-0 or
  garbage value stretching the chart axis back to 1970.
- Both `addPrint` calls in the `TimeAndSale` branch pass `time`. `Trade`-fed
  prints are unchanged — that event carries no `time` field.

### `server-v2/proxy-tastytrade.js` — TimeAndSale subs survive the pre-open window

`DxLinkClient.subscribeTimeSales()` returned silently when `channelOpen` was
false, unlike `subscribe()`, which queues. `start()` fires `_startTtMultiFlow()`
right after `client.connect()`, and `_subscribeTtFlowRoot()` recorded symbols in
`ttFlowContracts` regardless — so the request was dropped, the map claimed
"subscribed", and the 5-minute refresh found nothing fresh and never retried.
Those roots streamed nothing for the life of the process.

- `subscribeTimeSales()` / `unsubscribeTimeSales()` queue into `this.pending`
  (marked `__ts`) and return a boolean: true = sent, false = queued.
  `CHANNEL_OPENED` flushes them as `TimeAndSale`, kept distinct from the regular
  Quote/Greeks/Summary/Trade fan-out and from `__candle`. A queued unsubscribe
  cancels its matching queued add rather than pairing with it.
- `ttFlowContracts` is written **after** the subscribe, only for symbols that
  went out. Queued ones stay out of the map and are retried.
- `_subscribeTtFlowRoot()` bails while the channel is closed and
  `_startTtMultiFlow()` awaits the new **`_awaitChannelOpen()`** (250ms poll, 30s
  cap). A symbol subscribed via the queue but missing from `ttFlowContracts`
  would fall through to the SPX branch of `_onEvent` and be tagged with SPX's
  spot, corrupting `isOtm` for the whole root.
- `_syncTimeSaleWindow()` only records `_tsSubs` when the call returns true.

### Late bins are actually re-read — `server-v2/server-with-proxy.js` + `components/pages/Flow.tsx`

`/proxy/flow-netprem`'s incremental refresh re-scanned 3 bins back from the last
populated bin. Late rows land minutes behind that and the bin cache is otherwise
append-only, so they stayed invisible until eviction.

- New `NETPREM_LATE_MS` (default 15 min, env-overridable); `sinceMs` is now
  `min(3-bin overlap, now − NETPREM_LATE_MS)`. Still an index-only scan on
  `flow_prints_netprem_covering_idx`.
- `Flow.tsx` gains a matching `NET_LATE_SEC = 15 * 60` on its own `?since=`.
  Required, not cosmetic: the endpoint filters its response to `sec >= since`, so
  a narrow client `since` discards exactly the bins the server just re-read. Keep
  the two constants in step.

### Verification — `server-v2/flow-print-time.selftest.js` (NEW)

`node server-v2/flow-print-time.selftest.js` — 32 assertions, no network and no
database (the writer runs against a stub `pg`; `DxLinkClient` and
`stampFlowTime` are lifted out of `proxy-tastytrade.js` by name and driven with a
fake socket, since requiring that module dials out). Each was confirmed
**failing** against the deployed files first:

- Floor-crossing simulation over 60 ticks — 0/54 before, 54/54 after.
- 9000-row cold flush is chunked, not rejected at 65535 params.
- 60 prints delivered in one burst with exchange times a minute apart land in 60
  distinct minutes (before: 1 — the reported bug).
- `stampFlowTime` bounds; coalescing, out-of-order merge, window boundary,
  `lastFillAt`.
- An hour-old replayed batch is written; a still-merging order is re-upserted; a
  settled row is not re-written every tick; cursors stay independent.
- Pre-open TimeAndSale subs queue and flush on `CHANNEL_OPENED`; queues stay
  separated; 500-symbol chunking intact.

Reading `stampFlowTime` and `DxLinkClient` out of the source by name means
renaming or inlining either fails the test loudly rather than checking a stale
copy.

### Still open

- **Chain-wide `Trade` snapshots are ingested as flow prints.** Every strike from
  2600 to 9800 lands in the tape as a "print" whenever the chain is subscribed.
  These are last-trade snapshots, not trades, and they inflate the tape and the
  premium split. The `Trade` branch of `_onEvent` needs to ignore snapshot events
  (or the flow tape needs to be TimeAndSale-only).
- **`sessionCallPremium` / `sessionPutPremium` are permanently 0** on
  `DATA_SOURCE=tt`. They are only incremented inside the Theta `onTrade` handler,
  so whatever card reads them is dead in the current mode.


## 2026-08-07 - ICT: inducement no longer draws a play

Inducement fires several times a session and is a *context* read — the liquidity
the real setup is going to raid — not an entry. Every one of them was taking a
position box and an entry dot, crowding out the models that are actually
tradeable.

### `lib/calculations/ictPlays.ts`
- `inducement` dropped from `PlayKind`, from `PLAY_META`, and from the
  `signalGroups` loop that turns point-in-time detectors into live plays.
- Detection is **untouched** — `analyzeICT().inducement` still runs, still feeds
  the glossary "fresh" dots and the `/api/ict-setups` recorder, so the concept
  keeps accumulating a leaderboard record. It just never draws a box.

### `components/pages/Ict.tsx`
- Empty-state copy no longer lists Inducement among the setups that open a play.

## 2026-08-07 - ICT: Today's Plays popout next to the Leaderboard

The Concept Leaderboard answers "which concepts work"; nothing answered "what
actually fired today". A second toolbar button opens the same modal shell with
the raw recorded rows for the current ET session.

### `components/pages/Ict.tsx`
- **New `TodaysPlaysModal`** — same chrome, sizing, backdrop and Esc-to-close as
  `ConceptLeaderboardModal`, amber top border instead of blue so the two read as
  a pair without looking identical.
- Reads **`GET /api/ict-setups` with no query string** — the router already
  defaults `date` to today's ET date and returns the raw `setups` rows, so this
  needs no new endpoint and no new DB call. Re-polls every 60s (the server-side
  tracker scans on a 5m boundary).
- One row per recorded setup, newest first: ET trigger time, concept label,
  direction, entry, stop (`invalidation`), outcome badge, R multiple, MFE, note.
  Header carries the W / L / chop / open tally for the day.
- `pending` renders as **open** — "pending" reads like a bug to a subscriber
  looking at a setup that simply hasn't resolved yet.
- Toolbar button `📋 Today's Plays` sits immediately after `🏆 Leaderboard`.

## 2026-08-07 - Multi Greek: one-click CB/CW/PW level snapshot to the clipboard

There was no way to get the four tickers' walls out of the page except a full
screenshot of the whole dashboard. The toolbar now has a **TABLE / LADDERS**
toggle and a snapshot button that renders just the levels — ticker, spot,
expiration, DTE, CB, CW, PW — and puts the PNG on the clipboard.

### `components/dashboard/MultiGreekLevelSnapshot.tsx` — NEW
- **Two renders, picked by the toolbar toggle** and remembered per browser
  (`mg_snapshot_view` in localStorage):
  - `TABLE` (820×300) — one row per ticker. Dense; lines up against a previous
    snapshot for diffing, and a 5th/6th ticker is just another row.
  - `LADDERS` (1240×426) — per ticker, the three walls positioned by value with
    a spot marker between them and a `spot vs CB` delta in the tile footer.
    Carries the positioning a number list loses.
- **Drawn to `<canvas>`, not rasterized from the DOM.** html2canvas is
  unreliable on these inline-styled panels — the same failure mode that forced
  the EM badges to become inline SVG bitmaps (see `emBadgeDataUri`). A canvas
  render is deterministic, fixed at 2x, and free of the surrounding page.
- **Spot's value plate is centred in the ladder track.** The tags own the left
  edge and the wall values own the right, so a spot sitting cents off a wall —
  SPY 771.42 under a 772 call wall, QQQ pinned to its CW — was landing its label
  on top of that wall's number. Centring gives it a horizontal band of its own
  that cannot collide whatever the prices do.
- **The font stack is read off `<body>` at draw time.** `next/font` emits a
  hashed family behind `--font-inter`; a literal `"Inter"` in the canvas font
  string silently falls through to Arial. Also awaits `document.fonts.ready`, so
  the first click on a cold page doesn't measure against the fallback.
- Clipboard write needs a secure context — on plain http it throws, so the
  button **falls back to a download** (`multigreek-<view>-<YYYYMMDD-HHMM>.png`)
  rather than being a silent no-op. Button flashes ✓ green for 1.4s either way.

### `components/shared/homeTheme.ts`
- **New `LEVEL_COLORS` export** — `cb` / `cw` / `pw`, their faint cell `tint`s,
  and `onSolid` (the ink for a solid fill of those colours). These three hexes
  were hardcoded in three separate places inside `MultGreekClient.tsx`; the page
  and the snapshot renderer now read one source and cannot drift apart.

### `app/mult-greek/MultGreekClient.tsx`
- Toolbar gains `<MultiGreekSnapshotBtn>` next to the existing 📷 / Discord
  buttons. Unrelated to `BoxSnapBtn`, which rasterizes the whole page.
- **New `getSnapshotRows()`** — front-expiry walls for every ticker, derived at
  *click* time through the same `computeRows` → `computeWalls` path the panels
  use, from the untrimmed rows. So the image can never disagree with what the
  page is showing, and screenshot mode's `captureWindow` (which trims what is
  drawn, not what is computed) has no effect on it.
- All three hardcoded `#ffd600` / `#29b6f6` / `#ff4757` sites — the header
  readout, the front-column badges, the toolbar toggles — now read
  `LEVEL_COLORS`.
- **Greyed-out text is white.** The header readout's level values (`#e2e8f0`),
  the spot row (`#94a3b8`), the no-spot `--` (`#475569`) and the inactive
  CB/CW/PW toggle labels (`HT.muted` at 0.65 opacity) all move to `HT.text`;
  the inactive toggles sit at 0.8 opacity instead of 0.65.

## 2026-08-07 - Analysis · Ticker Levels renders today's recorder output only

The card printed yesterday's CORE pre-open. At 9:26 AM ET the walls slot grid
(first slot 09:29) had nothing for today, so the card fell back a session and
showed `core 7,700 · core from 2026-08-06` under a live-looking 9:26:47 AM
stamp. A prior-session level dressed as a current one is worse than no level.

### `components/pages/Analytics.tsx` — `TickerLevelsCard`
- **Removed the prior-session walls fallback** — `prevSessionISO()`, the second
  `/proxy/walls?date=<prev>` fetch, `wallsPrev` and `coreStale` are all gone.
  `wallRows` is now today's `/proxy/walls` response or empty.
- **Stale scanner rows are dropped, not displayed.** `/proxy/scanner?any=1`
  returns each symbol's most recent row regardless of date and flags carried-over
  rows `stale`; `bySymbol` now `continue`s past them. The map therefore holds
  today's rows only, so an empty map with both fetches settled means the sweep
  genuinely hasn't landed — which is what the card now says.
- `TickerLevelRow.stale` and the "walls from the last scanner sweep" note were
  removed with it — nothing stale reaches the row anymore.
- **New `corePending` / `coreWaiting`:** when today's walls are empty, CORE shows
  `—` with the orange footnote `core pending — first walls run 9:29 AM ET`,
  instead of a number from another day.
- **New `knownSymbols` set** (built from raw scan + wall rows, stale included) so
  the empty-row note still distinguishes `not in the scanner universe` from
  `waiting on today's scanner sweep`. Same split for futures: ESU with no SPX row
  yet reads `waiting on today's SPX sweep`, distinct from `waiting on ES−SPX basis`.
- Empty state reworded to `Waiting on today's first recorder run.`

Futures spot still comes live from `/api/tt-quotes`, so ESU/NQU keep showing a
price pre-open — only the recorded levels wait.

## 2026-08-07 - Owner budget: category colours are editable after creation

The colour was pick-once — set it in the add-category composer or live with it.
Now the dot on each category tile in the **Categories** tab is the editor.

### `owner-vite/src/pages/Budget.tsx`
- New `ColorEditor` component (file-local). Closed it renders as the same dot the
  tile always had; clicking it opens a popover with the six `CATEGORY_COLORS`
  swatches plus a native `<input type="color">` for anything outside the palette.
  Picking commits immediately and closes.
- The tile's own `onClick` opens the transactions modal, so the dot's handler
  calls `stopPropagation()`; a fixed-inset click-away layer closes the popover.
- `updateCategoryColor()` re-posts `action: "category"` with the category's
  existing name and amount and the new colour. `upsertBudgetCategory` conflicts
  on `UNIQUE(profile_id, name)` and updates in place, so **no server or schema
  change was needed** — no new action, no migration.
- Native `<input type="color">` only parses 6-digit hex, so the picker is seeded
  with a fallback when the stored colour isn't in that form.
- `CategoriesPanel` takes a new `onColor` prop; single-popover state
  (`editColorId`) lives on the panel.


## 2026-08-07 - Build fix: TestLab still imported the deleted DexCharmTab (v8.6.23 / v8.7.1 deploys)

Both deploys died at the same step, after the full Next build had already run:

    [vite:load-fallback] Could not load /app/app/test/DexCharmTab
      (imported by ../components/pages/TestLab.tsx)

`app/test/DexCharmTab.tsx` was `git rm`'d, and its tab entry was removed from
`app/test/page.tsx` — but `components/pages/TestLab.tsx` is a SECOND host for the same
tabs, and it still imported and rendered it.

### `components/pages/TestLab.tsx`
- Dropped the `DexCharmTab` import and its render branch.
- Removed `"dexcharm"` from the `TestTab` union. This matters as much as the branch:
  `setTab(id as TestTab)` casts a string straight out of a `TESTLAB_TAB_EVENT`, so a
  stale `#dex-charm` link would otherwise still select a tab that renders nothing.
- Checked the other two files deleted in v8.6.23 — `components/pages/Premarket.tsx` and
  `app/app/premarket/route.ts`. No references remain in `app-vite/src/App.tsx`,
  `components/scanner/scannerNav.ts` or `TestLab.tsx`.

### Why the guard didn't catch it — `app-vite/scripts/check-routes.mjs`

The route check passed ("OK Vite route check passed") on both failed deploys, because
check 1 only looked at `App.tsx`'s OWN imports, one level deep. The dangling import was
four hops down the graph. So a 2-minute Docker build was the first thing to notice.

Added **check 3: every module reachable from `App.tsx` must resolve every local import.**

- BFS from `App.tsx` following static imports, `export … from`, and string-literal
  dynamic `import()`. Resolves `@/…` against the repo root and `./…` relatively, trying
  the same extensions Vite does. Non-source leaves (`.css`, `.json`, images) resolve and
  stop.
- Only unambiguously local specs (`@/…`, `./…`) are ever reported — bare specifiers are
  node_modules or the three `next/*` shims aliased in `vite.config.ts`.
- **Comments are stripped first**, quote-aware, so a commented-out
  `// lazy(() => import('./Old'))`, a JSDoc block quoting an import, a `"https://…"`
  string and a `"// import Fake"` literal can't produce a phantom failure. Template-literal
  dynamic imports are skipped — a computed path isn't statically checkable and guessing is
  worse than not looking.
- One deliberate difference from Rollup: `import type { X } from './gone'` IS flagged,
  even though esbuild erases it. The file still doesn't exist, and `next build` runs with
  type validation skipped, so it would otherwise ship silently.
- `node app-vite/scripts/check-routes.mjs --dry` prints the walk and the module count
  without failing anything.

Validated against a fixture reproducing the repo's real import shapes: it passes clean
code (JSDoc-quoted imports, commented-out lazy routes, `//` inside strings, css, type-only
imports, `export … from`, extensionless `@/` specs) and fails on the actual DexCharmTab
import, on a deletion four hops down, and on a toolbar item with no route.

## 2026-08-07 - budget.cbedge.net Money page: the bottom cards collapse

Everything from "Due within 10 days" down was reference material — bills you already know
about, category budgets, the month's register — and expanded it turned one screen of "can
I spend anything today" into six screens of scrolling to reach the two things the page is
actually writable for.

### `budget-vite/src/components/Collapsible.tsx` (new)

A card whose header is the control. Two rules it follows:

- **A closed card still carries its number.** The header keeps a summary on the right —
  `Past due · 2 · $640` — so nothing is hidden, only the detail. A collapsed header with
  just a title would be strictly worse than the list it replaced. The summary shrinks and
  ellipsises before the title does, so a long one can't wrap the header or push the
  chevron off the card.
- **Closed on every page LOAD, not remembered.** The default is the briefing; a card left
  open three weeks ago shouldn't quietly become the default forever. Within a session the
  state *does* survive month navigation, since `<Budget>` keeps it mounted — paging
  Jul→Aug with the Register open leaves it open, which is what you want while comparing.

Children aren't rendered while closed, so the register's full month costs nothing until
it's asked for. `variant` picks the card surface or the hairline-rule section, matching
whichever container the card already used. Chevron rotates; `aria-expanded` /
`aria-controls` are set.

### Collapsed by default, with these headers

| card | closed header shows |
|---|---|
| Due within 10 days | count · total · *N* late (red when any are) |
| Categories | spent of budgeted · *N* over |
| Past due | count · total, in orange |
| Coming up | count · total |
| Register | count · +in / −out for the month |

Everything above — the briefing, the six tiles, safe-to-spend, spend pace, the category
donut, the balance check and the cash-flow chart — is unchanged and still open. "+ Add
entry" was already collapsed and is left alone.

- `budget-vite/src/components/BudgetOverview.tsx` — `UpcomingPay` and `CategoryBudgets`
  wrapped. The outer over-budget count is named `overCount` so it can't shadow the
  per-category `over` inside the map.
- `budget-vite/src/pages/Budget.tsx` — `Bills` (Past due / Coming up) and `Register`
  wrapped, each now computing the totals its closed header needs.

## 2026-08-07 - budget.cbedge.net: "Bank balance" was the month's PROJECTION, not the bank

Today's Money strip read −$1,500 with money actually in the account, and the briefing
called a covered month short.

### The bug

Two different figures had been quietly swapped in `_lib-household-budget.cjs`:

| figure | what it is |
|---|---|
| cash on hand | the last hand-logged daily balance (the desktop's `bankNow`), falling back to the month's beginning balances |
| `totals.endingBalance` | the register's running total after EVERY line in the month — including synthetic occurrences for bills not yet paid and pay not yet landed |

`getMonth()` was passing the second one everywhere the first was meant. The desktop
(`app/owner/budget/page.tsx`, `bankNow` at line 534) and the 8am email
(`budget-email.js`, `allBanks` from `d.dailyBalance`) both use the balance snapshot — this
file claims to be a verbatim port of both and wasn't.

It compounded four ways, all in the same direction:

- **"Bank balance" on Today** showed where the month ENDS UP. Any month with rent still
  outstanding read as an overdraft on the 1st and recovered on payday.
- **`available = inBank + coming`** double-counted every unlanded paycheque — those
  occurrences were already summed into the projection.
- **`after = available − owed`** double-SUBTRACTED every unpaid bill, for the same reason.
- **`overview.safe = allBanks − billsLeft`** subtracted the remaining bills a third time.

On the test month the old code reported "Short by $180" for a month that is actually
covered with $1,300 spare.

### The fix

- `server-v2/_lib-household-budget.cjs` — `getMonth()` now computes `bankNow` / `inBank` /
  `bankAsOf` exactly as `/owner/budget` does, and feeds THAT to `buildBriefing()` and
  `buildOverview()`. `buildOverview` takes `bankNow` instead of the register's `balances`,
  so `tiles.allBanks`, `safe` and `reconcile.actual` are all cash on hand.
- The projection is not lost — it is still `totals.endingBalance`, and `summary()` now
  returns it as `projectedEom` alongside `total`. The two answer different questions and
  are now named that way.
- `summary()` — `total` is cash on hand, `balances` is per-bank cash, plus `asOf`.

### Guardrails, because this is invisible when it's wrong

- `server-v2/_lib-household-budget.selftest.js` (new) — 11 checks over a stubbed DB, no
  database needed: `node server-v2/_lib-household-budget.selftest.js`. Covers the
  projection-vs-bank split, no double-counting of `coming`/`owed`, safe-to-spend
  subtracting bills exactly once, the beginning-balance fallback, a materialised bill
  leaving `owed` without appearing twice, and reconcile drift ignoring unpaid bills.
- The bank figure now always says WHEN. Today's strip shows `as of 8/5` under the balance
  and `… projected end of month` beneath it; the briefing's "In the bank" row carries the
  same. When nothing has been logged, both say so in orange — a hand-entered balance
  nobody has updated in three weeks is otherwise indistinguishable from a current one.

## 2026-08-07 - budget.cbedge.net Lists: real timestamps, and meals named on the grocery list

### Every list row says the day AND the time

`when()` printed a bare "2:14 PM" for today and a bare "Jul 3" for anything over a week
old — so the two things you actually want to know ("how long has this been sitting here",
"was that before or after the last shop") were each missing exactly when they mattered.

- `budget-vite/src/pages/Lists.tsx` — `when()` now always returns a day and a time:
  `Today 2:14 PM` · `Yesterday 11:41 PM` · `Tue 8:41 AM` · `Jul 3, 4:20 PM` ·
  `Dec 24, 2025, 9:05 AM` (the year appears only when it isn't this one).
- Today/Yesterday are compared as CALENDAR days, not as a 24-hour difference — something
  added at 11pm last night reads "Yesterday", not "9 hours ago".
- The full unabbreviated timestamp is on the row's `title`, for when the short form isn't
  enough.

### "from a meal" now names the meal and its day, and links to it

- `server-v2/_lib-household-lists.cjs` — `getWeek()` returns a new `mealRefs` index
  (`{id, day, title}`) covering every meal any visible item points at, **including meals
  outside the week on screen**. The existing `days[].meals` only spans the seven days
  being viewed, so an ingredient for next Tuesday's dinner had nothing to name it with.
- `budget-vite/src/api.ts` — new `MealRef` type; `ListsPayload.mealRefs`.
- `budget-vite/src/pages/Lists.tsx` — the plain list's meta line now reads
  `Produce · Taco night · Tue Aug 12 › · added Today 2:14 PM`. Tapping the meal moves the
  week board to that meal's week, expands it, and switches to the Week view.
  - `openMeal` was lifted out of `<Week>` into `<Lists>` so the plain list can say which
    meal to expand — the board would otherwise mount fully collapsed.
  - `MealBlock` scrolls itself into view on open, but ONLY when it is actually off-screen,
    so expanding one by hand doesn't yank the page around.
  - A deleted meal (its items deliberately survive — `ON DELETE SET NULL`) falls back to a
    plain, unlinked "from a meal" rather than linking nowhere.

## 2026-08-07 - budget.cbedge.net: everything is shared, calendar last-synced, Today trimmed

### Everything is shared — the private/shared switch is gone

Two people who live together were being asked, at capture time, whether a grocery item
was private. Nobody wants to make that decision while standing in a kitchen, and the
failure mode is the one the app exists to prevent: a task only one of you can see.

- `server-v2/_lib-household.cjs` — `ensureSchema()` now flips `visibility` DEFAULT to
  `'shared'` on `hh_tasks`, `hh_notes`, `hh_routines`, `hh_meals`, `hh_list_items`,
  `hh_projects`, and converts every existing private row ONCE. Idempotent, wrapped
  per-table so a missing table can't take the boot down.
- `server-v2/household-routes.cjs` — `vis()` is now `() => 'shared'`. Kept as a function,
  not deleted, so reverting the policy is one line.
- `_lib-household-lists.cjs` / `-projects.cjs` / `-routines.cjs` — same, via a `SHARED`
  constant. The incoming `visibility` argument is accepted and ignored rather than removed
  from the signatures.
- The `VISIBLE` predicate `(owner_id = $1 OR visibility = 'shared')` STAYS in every query.
  It is now always true, but it is the safety net if a row ever ends up private again.
- Client: removed the Shared/Private toggle from Today's quick-add, Todo's quick-add,
  the TaskRow expanded actions, Routines (row badge, row toggle, add form), Projects (card
  badge, detail toggle, new-project form), Settings > Saved notes (toggle + SHARED badge),
  and the `· private` suffix on Lists items.
- `TaskRow` meta line: the "Shared" chip is gone — the word carries no information when
  everything is shared. Another person's NAME still shows, because who added it does.

### Google Calendar: last synced

`hh_google_tokens.updated_at` moves on every silent access-token refresh, so it would read
"synced 30 seconds ago" for a calendar that has been failing all day. A separate stamp
tracks the thing actually being asked about.

- `server-v2/_lib-household.cjs` — `ALTER TABLE hh_google_tokens ADD COLUMN IF NOT EXISTS
  last_synced_at TIMESTAMPTZ`.
- `server-v2/_lib-google-calendar.cjs` — `touchSync()` stamps it on a successful
  `eventsForDay()` fetch (fire-and-forget; a failed write must not break a good read, and
  the 60s events cache caps it at one write per minute per connection). `status()` returns
  `lastSyncedAt` from the connection that actually SERVES this user, so on a shared
  household calendar you see the other person's pull — the feed you are reading — not your
  own null. `eventsForDay` also returns `syncedAt`.
- `budget-vite/src/pages/Settings.tsx` — new `LastSynced` component under Google Calendar
  in the More tab. Relative ("Last synced 4 minutes ago"), absolute time in the tooltip,
  orange past 24h, and "Not synced yet" before the first fetch.

### Urgent: one alarm, not three

- `budget-vite/src/pages/Todo.tsx` — dropped `borderColor: T.bad` from the Urgent
  section's `section()`. That tinted the section's top hairline, drawing a full-width red
  bar above the word "Urgent" on top of the red heading and the red left rule on each row.
  The per-row left bar (the useful one) is untouched.

### Today: Habits and Resurfacing off the home page

- `budget-vite/src/pages/Today.tsx` — removed the Habits progress block and the
  Resurfacing quote block. Both screens are still live and unchanged — Habits at
  `/routines` via More, notes in More > Saved notes — they were just pushing the open task
  list below the fold. Today is what you have to DO; a habit ring and a rotating quote are
  things you look at.

## 2026-08-07 - budget.cbedge.net: 4-digit PIN quick sign-in

Signing in on the phone meant typing a 10+ character password into a screen you reach
several times a day. Quick sign-in adds a 4-digit PIN as a shortcut back into an account
you have ALREADY proved with a password.

A 4-digit secret is only 10,000 guesses, so it is never the whole credential. Two secrets
are required, and the weak one is useless without the strong one:

  1. `hh_device` — 32 random bytes in a second HttpOnly, host-only cookie (400 days),
     issued when the PIN is set. The same PIN typed on any other device authenticates
     nothing.
  2. The PIN itself, scrypt-hashed against that device's row.

Five wrong PINs DELETES the device row outright — not a timed lockout, which with only
10,000 possibilities is an invitation. The device drops back to email + password, which
is also the only way to re-arm it. An attacker holding an unlocked phone gets five guesses
out of 10,000, once, ever.

### `server-v2/_lib-household.cjs`
- New table `hh_device_pins` (device_hash PK, user_id, pin_hash, fails, user_agent,
  timestamps), created by the same `CREATE TABLE IF NOT EXISTS` bootstrap as the rest —
  nothing to run on deploy. The PK is the SHA-256 of the device token, never the token,
  same reasoning as `hh_sessions`.
- `pinProblem()` — exactly 4 digits; rejects 1111-style repeats and 1234-style runs, and
  nothing else.
- `deviceCookie()` / `clearDeviceCookie()` / `deviceToken()` — same flags as the session
  cookie (HttpOnly, Secure, SameSite=Lax, and deliberately NO `Domain`, so it can never
  reach cbedge.net).
- `setPin()` (requires a live session), `pinLogin()`, `pinStatus()`, `removePin()`,
  `deviceHasPin()`, `countPinDevices()`.
- On a shared browser already claimed by the other household user, `setPin` mints a fresh
  device token rather than overwriting their quick sign-in.
- Sign-out leaves `hh_device` alone on purpose — signing out is the thing quick sign-in
  exists to recover from. Only "forget this device" or five bad guesses clear it.

### `server-v2/household-routes.cjs`
- `GET  /api/hh/auth/pin-status` (public) — should the login screen draw the pad? Answered
  from the device cookie, so a stranger with no cookie gets `{ hasPin:false }` and learns
  nothing about who uses the app.
- `POST /api/hh/auth/pin-login` (public) — `{ pin }` → sets `hh_session`. A response with
  `forget:true` also clears `hh_device`.
- `GET/POST /api/hh/auth/pin` (household) — read arm state / set a PIN.
- `POST /api/hh/auth/pin/remove` (household) — `{ allDevices? }`.
- `authHeaders()` now accepts an array, so PIN sign-in can set `hh_session` and re-issue
  `hh_device` in one response.
- `/me` and `/login` now return `user.pinOnThisDevice`, so the SPA knows on first paint
  whether to offer setup. No extra round-trip.
- No change to `api-router.js` — these register through the existing
  `registerHouseholdRoutes` hook.

### `budget-vite/src/components/PinPad.tsx` (new)
- On-screen 3x4 keypad with dots, shake-on-wrong, and physical-keyboard support. Not an
  `<input inputMode="numeric">`: that pulls up the full iOS keyboard, shoves the layout,
  and offers to autofill a password into a 4-digit field. Nothing is ever in a form field,
  so no password manager and no autocomplete history for a device-scoped secret.
- Auto-submits on the fourth digit — a confirm tap for a fixed-length secret is ceremony.

### `budget-vite/src/pages/Login.tsx`
- Split into `PinSignIn` and `PasswordSignIn` behind one frame. Which one renders is
  decided by the SERVER via `/api/hh/auth/pin-status`, not by anything in localStorage.
- Renders nothing for the one local round-trip rather than flashing the password form and
  swapping it for a keypad.
- "Use password instead" / "Use PIN instead" both ways. Five bad guesses shows why, then
  falls through to the password form.

### `budget-vite/src/pages/SetPin.tsx` (new)
- Choose-then-confirm, offered once per device after the welcome splash. An offer, not a
  gate: "Not now" is remembered permanently (`localStorage` UI flag only — no credential
  is ever stored client-side) and Settings always has the card.

### `budget-vite/src/pages/Settings.tsx`
- New "Quick sign-in" section: set / change PIN, "Forget this device", and "Forget
  everywhere" when other devices are armed.

### `budget-vite/src/App.tsx` / `auth.tsx` / `api.ts`
- `signInWithPin()` on the auth context; `HouseholdUser.pinOnThisDevice`; `ApiError` now
  carries the parsed body so the PIN screen can read `forget` / `attemptsLeft`.
- Gate offers `SetPin` after the welcome splash, never in front of it, and never on a
  device that already has one.

## 2026-08-07 - Nav cleanup: Premarket off the Scanner strip, DEX/Charm off Test Lab

### `components/scanner/scannerNav.ts`
- Removed the `/premarket` entry from `SCANNER_ROUTES` and from the `more` cluster in
  `SCANNER_GROUPS`, so it no longer appears in the Scanner sub-strip.
- The `/premarket` route itself is untouched (still lazy-loaded in `app-vite/src/App.tsx`)
  — this only removes it from the Scanner section's navigation.

### `app/test/page.tsx`
- Removed the "DEX / Charm" tab: dropped the `DexCharmTab` import, the `dexcharm` member of
  the `TestTab` union, its `TABS` entry (`#dex-charm`), and its render branch.
- Test Lab now shows GEX Map / Dealer Gamma / Squeeze.
- `app/test/DexCharmTab.tsx` is left on disk but is no longer imported by anything.


## 2026-08-06 - /level-log PNG: keep the reaction legend out of the capture

The snapshot came back with the REJECT / BREAK / PINNED / STALLED NEAR legend row printed
ON TOP of the 12:00 timeline entry.

### `components/pages/LevelLog.tsx`
- Added `data-capture-hide` to the reaction-legend footer.
- Not just cosmetic de-cluttering: framed mode in `lib/snapshot.ts` measures the scroll
  body by `scrollHeight` and expands it, but the siblings BELOW it are not reflowed, so a
  footer keeps its live-page Y and lands in the middle of the now-taller log. Anything
  rendered after the scroll body in that card has to be hidden from the capture or moved
  above it.
- The legend is a hover-to-learn key for the badges anyway — the badges themselves are in
  the image, so nothing is lost.


## 2026-08-06 - Build fix: owner-vite Results.tsx JSX comment before the root element

The v8.6.17 VPS deploy failed on the `owners` target:

    /app/src/pages/Results.tsx:389:15: ERROR: Expected ")" but found "className"

### `owner-vite/src/pages/Results.tsx`
- A `{/* ... */}` comment sat between `return (` and `<PageShell className="wall-scroll">`.
  `{...}` only means "JSX expression container" INSIDE JSX; as the first token after
  `return (` esbuild reads it as an object literal, so the parse died on the next tag's
  first attribute. Moved the note above the `return` as ordinary `//` lines.
- Pre-existing — not introduced by the Level Log work in the same version. The `owners`
  image is built before `dashboard`, so it took the whole deploy down first.
- Swept every `.ts`/`.tsx` under `owner-vite/src` through esbuild: this was the only one.


## 2026-08-06 - Level Log split out of owner Results > Walls into /level-log (Scanner section)

The level log lived inside the owner-only Results -> Walls tab, sharing a page with the
universe table, reach rank and alert feed. It is now its own customer-facing page under
Scanner, scoped by a WALLS / CORE switch, and its PNG button takes a REAL screenshot of
the card instead of re-rendering the text.

### `components/pages/LevelLog.tsx` (new)
- Port of the level-log panel from `owner-vite/src/pages/Results.tsx` (WallsView /
  WallCaptureRail / WallTimeline / buildLogText). Same data, same reading: `GET
  /proxy/walls[?date=&symbol=]`, fetch-on-load + explicit refresh, no polling.
- **WALLS / CORE tab switcher.** One `view` state filters the ticker rail columns, the
  capture rail, the timeline, the copy text and the PNG **through the same two memos**
  (`log` / `events`), so the pills can never disagree with what gets exported. WALLS =
  `call_wall` + `put_wall`; CORE = `cb`.
- Theme comes from `homeTheme` / `PageCard` only. The owner page's `gold` has no
  counterpart in `HOME_THEME`, so it maps to `HOME_THEME.orange`; CORE keeps `LIGHT_BLUE`.
- Main grid is written as `minmax(0, 1fr) minmax(0, 2.6fr)` **on purpose** — that exact
  signature is what the GLOBAL GRID COLLAPSE block in `app/globals.css` matches, so the
  two columns stack on a phone. A `340px` first track looks identical on a desktop and
  squeezes the log to nothing on mobile.

### PNG snapshot — real screenshot, not a text re-render
- The owner version deliberately drew `buildLogText()` into a throwaway off-screen node,
  because a naive `html2canvas()` of the card captured only the slice of the 560px scroll
  window that happened to be in view, and flattened the frosted styling.
- The new page calls **`captureAndCopy()` from `lib/snapshot.ts`** with `framed: true`.
  Framed mode measures each direct child by `scrollHeight` and expands the clone past the
  scroll container, and the shared clone pass swaps `backdrop-filter` panels for their
  solid color — so the capture is the whole card, styled, badges and colors included.
- Header buttons carry `data-capture-hide` so page chrome stays out of the image.
- Going through `lib/snapshot.ts` is mandatory, not stylistic: `scripts/audit-ui.mjs
  --strict` (the root `prebuild`) fails the build on a second `html2canvas` import.

### `components/scanner/scannerNav.ts`
- Added `/level-log` ("Level Log" / "Log") to `SCANNER_ROUTES` and to the `more` cluster
  in `SCANNER_GROUPS`, so it shows as a pill in the Scanner sub-strip.

### `app-vite/src/App.tsx`
- `lazy()` import + `<Route path="/level-log">`. Step 2 of the two-step rule — without it
  the page would fall through the SPA catch-all to `/traders-dashboard`.

### `app/app/level-log/route.ts` (new)
- `serveSpaShell("app")`, matching the other `/app/*` shells, so a hard refresh on
  `/app/level-log` does not 404.

### `app/globals.css`
- Ported the `.wall-scroll` themed-scrollbar rules from `owner-vite/src/index.css` (they
  only existed in the owner app; the class was inert in the customer bundle).

### Not touched
- The owner Results -> Walls tab is unchanged — this is a duplicate, not a move out of the
  owner app.


## 2026-08-06 (o) - budget.cbedge.net: read-only Budget overview ported from /owner/budget

The Money tab was a register with a balance on top. It now leads with the full read-only
overview — every card and graph from the desktop `/owner/budget` page — with the writing
moved behind a second tab, because all the real editing happens on the owner dashboard.

### `server-v2/_lib-household-budget.cjs`
- Added **`buildOverview()`**, returned as `overview` on `GET /api/hh/budget`. Every
  formula is a VERBATIM port of the `intel` / `categoryStats` / `billsDue` / `reconcile`
  memos in `app/owner/budget/page.tsx`, not a re-implementation. The phone is a second
  VIEW of that page, so a figure that disagrees is a bug by definition.
- Returns `daysInMonth, todayDay, daysLeft, allBanks, billsLeft, safe, safePerDay,
  budgetTotal, paceNow, spentMtd, cum, week, wkOut, prevWkOut, slices, upcomingPay,
  reconcile, days, series, cashflow`.
- **Bug fixed — `daily_balance.day` DATE to Date.** `pg` hydrates a Postgres `DATE` into
  a JS `Date`, and `String(thatDate).slice(0,10)` is `"Sat Aug 01"`. The reconcile window
  compared that as a string, matched nothing, and `moneyIn`/`moneyOut` both read **zero**
  with no error at all. Added `isoDay()`, which normalises both shapes the driver can
  hand over. This is the THIRD place this exact trap has bitten (`due_date`,
  `target_date`, now `daily_balance.day`) — coerce a DATE at the boundary, always.
- **Bug fixed — one optional card could 500 the whole month request.** A missing
  `libDb.getDailyBalanceBefore` export throws SYNCHRONOUSLY at the call site, so a
  `.catch()` on the returned promise never runs. Now `typeof`-guarded: the balance check
  degrades to hidden instead of taking the page down.

### `budget-vite/src/components/BudgetOverview.tsx` (new)
Read-only, phone-first, hand-rolled SVG (no charting dependency):
Safe-to-spend · six-stat strip · spend pace vs a straight-line budget · 7-day pulse ·
category donut · balance check · weekly cash flow · month heat calendar · projected
balance · bills due within 10 days · category budgets.
- **Nothing is computed in this file.** Every figure arrives from `overview`. A chart
  that does its own arithmetic is a second source of truth, and the two drift.
- Dates stay STRINGS (`'2026-08-14'.split('-')`), never `new Date(iso)`.

### `budget-vite/src/pages/Budget.tsx`
- Split into **Overview** / **Register** tabs. Register keeps the only two things worth
  doing on a phone: log what you just spent, tick a bill paid.

### `budget-vite/src/api.ts`
- Added the `BudgetOverview` type; `BudgetMonth` now carries `overview`.

### Tests
442 assertions green across 8 suites (budget 86, gcal-routes 79, lists 60, projects 58,
routes 57, routines 51, gcal 32, recurrence parity 19). Rendered at 390px under Playwright
against a stubbed API, which is what caught zero-value cash-flow bars reading as small
real amounts.


## 2026-08-06 (n) - Owner · Results · Contracts: the page scrolls again

`owner-vite/src/pages/Results.tsx`.

PageShell's `<main>` is a **column flexbox with `overflow: auto`** — it is the scroll
container for every Results tab. Flex items default to `flex-shrink: 1`, so on a short
monitor the Contracts table card was *squeezed* to fit the viewport instead of running
past it. Its own `overflow: hidden` then clipped the rows, and because nothing
overflowed `<main>`, no scrollbar ever appeared: the table just ended mid-list.

Fix is `flexShrink: 0` on each direct child of the Contracts view (header row, Run
now / Diagnose controls, the 9:45 / 10:30 / 12:00 roll-up grid, the table card, and the
loading / empty / error states) plus the tab strip. Content now overflows `<main>`,
which scrolls it.

`PageShell` also gets `className="wall-scroll"` so the page's bar uses the dashboard's
themed scrollbar (cyan thumb, inset track — `owner-vite/src/index.css`) rather than the
neutral white default.

No data, query, or layout changes — only shrink behaviour. Other tabs are untouched
apart from the shared tab strip.

## 2026-08-06 (m) - budget.cbedge.net: Todo, Lists, calendar colours + Upcoming

Tab bar is now **Today · Todo · Lists · Money · More**. Habits and Projects kept their
routes and all their data — they gave up tab slots and are reached from More.
Nothing on cbedge.net changed.

### Todo (was Habits)
`hh_tasks.urgent` added via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

**Urgent is a separate field from `starred`.** Starred means "one of my Top 3 on
Today"; urgent means "this can't wait". One flag for both would make pinning something
to Today silently mark it an emergency.

Chosen design: urgent is a toggle on the input, decided at capture. It costs one tap,
but it's visible and works the same for both people — unlike a typed marker, which is
faster but is a rule somebody has to be told about. Urgent sorts to the top
(`ORDER BY urgent DESC, …`) and carries a left rule rather than a badge, so it marks
the row without adding another thing to read. The toggle resets after each add; the
date doesn't — three things due Friday is common, three emergencies in a row isn't.

### Lists — three views, two tables
`hh_meals` and `hh_list_items`. Week / Shop / List are **views, not copies**: ticking
"tortillas" in Shop marks the same row nested under Tuesday on Week. Any design that
generates shopping rows separately ends with the two disagreeing about what you bought.

- **Week** — Monday-start board, meals per day, ingredients nested. Monday not Sunday:
  a Sunday start puts tonight's dinner at the far right every Sunday evening.
- **Shop** — a MODE, not a screen. Aisles in **store-walk order** (produce → … →
  other), empty aisles dropped, 26px targets and 16px rows because this is tapped
  one-handed in a shop holding something else. Ticked items drop to "in the cart".
- **List** — the plain list with aisle labels and where each item came from.

Decisions worth keeping:
- **Aisle is guessed** from the item name (~60 keywords) and deliberately conservative:
  a wrong guess is worse than `other`, because a misfiled item is one you walk past.
- **Lists default to `shared`**, unlike tasks. A private grocery list in a two-person
  house is the wrong default — you are both shopping from it.
- **Deleting a meal keeps its items** (`ON DELETE SET NULL`). Removing "Taco night"
  must not silently take the tortillas off your list.
- **"Done shopping" deletes** the bought items rather than un-ticking them — otherwise
  next week starts with last week's shopping already crossed off. Items still attached
  to a meal are kept so the week board doesn't lose its plan.
- Ticking is optimistic and moves the item between sections instantly, updating the
  week board's counts in the same pass. This is the one interaction that happens on bad
  signal; a checkbox that waits gets tapped twice, and the second tap un-ticks it.

### Today's calendar
- **All-day events get a tinted band.** They have no time to anchor them, so without it
  they read as a midnight event sitting above everything else.
- **Event titles are tinted by their CALENDAR's colour** — so the family calendar
  separates from a work one at a glance, with no legend. Per-EVENT `colorId` is
  deliberately ignored: it would make two events on the same calendar look unrelated.
- **Upcoming** — the next 5 events over the following three weeks, under today's list.
  In Upcoming the leading column is the DAY, not the time: "All day" with no date tells
  you an anniversary is coming but not when. Today's list is the opposite.

One real bug fixed: colour lookup failed for the DEFAULT calendar, because we read it
as the literal id `primary` while `calendarList` returns it under the account's email.
Every event on the default calendar — the case for anyone who never opens the picker —
came back colourless. `calendarList` now aliases the primary entry.

### Verification — 428 assertions across 9 suites, 0 failures
**60 new list tests** (week maths incl. Sunday belonging to the week that just ended,
month/year/leap boundaries; aisle guessing; the same-row-two-views property; meal
deletion keeping items; clear-checked keeping meal ingredients; both directions of
visibility) and **6 new calendar tests** (per-event colour, calendar name, the
look-ahead window, ordering, and that it excludes the requested day).

**No proxy change.**


## 2026-08-06 (l) - budget.cbedge.net: landing screen

The pencil heart drawing as a landing screen — on sign-in, and once per app open
before Today. Visual only; no route, endpoint, query or schema changed.

### The image is the real drawing
`budget-vite/public/heart.png` is the actual scan, not a redrawn approximation.
Processed to sit on the dark background:
- Inverted, then used as the ALPHA channel — white strokes on transparency, so there
  is no paper rectangle behind it and it works on any surface.
- `autocontrast(cutoff=(10,0))` drives the paper's warm, unevenly-lit gradient to zero
  alpha. Without it a faint grey panel shows against near-black.
- Gamma lift (0.72, ×1.25) on the mask: pencil is thin, and a faithful alpha ramp
  renders as a barely-visible grey scribble at 300px on a phone.
- Connected-component filter drops every blob under ~400px — 71 components in, 7 out.
  That removes paper grain and a scan smudge in the bottom-right corner without
  touching a single pencil line.
- 816×867, 105KB, served as a static file rather than inlined so it stays out of the
  JS bundle.

### Behaviour
- Shows on sign-in AND once per page load; **not** on navigation between tabs.
  Tracked by a module-scope flag, because React state re-initialises on remount and a
  ref resets with it.
- Holds 5s, then fades. **Tapping anywhere dismisses instantly** — five seconds is a
  long time when you opened the app to tick one thing off, so the target is the whole
  screen rather than a small "skip" control.
- Rendered OVER the app, not instead of it, so Today is already mounted and painted
  behind it — dismissing early lands on a finished screen, never a spinner.
- The fade-out and the unmount are separate timers rather than a `transitionend`
  handler: backgrounding the tab mid-transition never fires that event, and the splash
  would still be sitting there on return.
- Never shown in front of the forced password change.
- `prefers-reduced-motion` disables the rise-in and the fade.

**No proxy change. No API change. No schema change.**


## 2026-08-06 (k) - budget.cbedge.net: CB Edge palette on the editorial layout

Same editorial structure shipped in (j), now on the dashboard's dark palette. Because
(j) rebuilt the styling as a token set plus helpers, this was almost entirely a swap of
values in `budget-vite/src/theme.ts` — no page had to be restructured.

**Visual layer only.** No route, endpoint, query or schema changed. Nothing on
cbedge.net was touched.

### Palette
Values mirror `components/shared/homeTheme.ts` and the deeper surface set
`app/owner/budget` uses locally — but the files are deliberately NOT shared, because
budget-vite builds standalone (see its vite.config.js).

- Surfaces `#05060A` / `#0D1119`, plus the dashboard's radial shell glow behind the page
- Accent is **`#8ECAE6`**, not `#219EBC`: the darker cyan is not legible as 10px mono
  on near-black, and nearly every label in this design is 10px mono
- **`warn` (`#FB8501`) is a separate token from `accent`.** Overdue, slipping, past-due
  and over-budget mean "act on this" — colouring them with the interactive accent makes
  them read as links, and colouring links orange makes the whole page look alarmed

### The naming inversion, on purpose
Tokens keep their light-theme names: **`ink` means FOREGROUND, `paper` means
BACKGROUND**, so on dark `ink` is white. Every helper reads correctly under the
inversion without a branch — a completed checkbox is still "filled `ink`, tick in
`paper`", which is now white-with-a-dark-tick instead of black-with-a-light-one. The
alternative (renaming to fg/bg) would have touched every file for no behavioural gain.

### Two adjustments the dark version needed
- **Display weight 600 → 500.** Light-on-dark blooms optically; the weight that looked
  right on cream reads chunky here.
- **Disabled primary buttons became ghost outlines.** A dimmed white fill on black is a
  grey slab that reads as enabled-but-broken. The outline reads as "not yet".

### Verified by rendering, not by reading
The real build was screenshotted at 390px against a stubbed `/api/hh/*` and inspected
across Today, Habits, Work and Money.

**No proxy change. No API change. No schema change.**


## 2026-08-06 (j) - budget.cbedge.net: "warm paper" redesign

Replaced the CB Edge dark theme on budget.cbedge.net with a light, editorial design
modelled on the reference app Brandon supplied (jeradhill.com life-management app).
**Visual layer only** — no route, endpoint, query or schema changed, and nothing on
cbedge.net was touched. The trading app keeps `homeTheme.ts`; the two products no
longer share tokens.

### The system — `budget-vite/src/theme.ts`
Rewritten from scratch as a token set plus style helpers. Four rules it enforces:

1. **ONE accent colour.** Burnt orange `#C2410C`, only for things that are live —
   links, overdue, streaks, the current tab. Nothing decorative is coloured. A second
   accent is what turns this back into a dashboard.
2. **Hairline rules, not cards.** Sections are a 1px top rule and whitespace. Borders,
   fills and shadows are the exception (compose box, active segment), never the
   default container. `card()` is gone.
3. **Serif for VALUES, mono for LABELS.** A number you read is Newsreader and large;
   the word describing it is 10px JetBrains Mono, uppercase, letterspaced, muted.
   Swapping those two is what makes a layout look like generic admin.
4. **No bold-for-emphasis.** Hierarchy comes from size, case and colour.

Palette: warm cream surfaces (`#F7F4ED` / `#FBF9F5` / `#F1EDE4`), warm near-black ink
(`#1C1917` — never pure black, too hard against cream), three muted greys.

### Applied across every screen
- **Shell** — mono date line ("Thu, Aug 6 · Week 32"), serif page title, bottom tab bar
  marked by a 2px accent rule instead of icons or fills. Tabs renamed to fit five on a
  390px phone: Today · Habits · Work · Money · More.
- **Today** — opens with one plain-English brief line ("6 open · 2 overdue · 1 due
  today") rather than a stat grid, which is how the reference does it.
- **Habits** — hero percentage, a 30-day completion trace, per-row square-block history
  and streak count.
- **Money** — the balance as an oversized serif number, banks as a mono row beneath.
- **Work** — serif project names, hairline progress rules, terse mono meta lines.
- Checkboxes are squares (a circle reads as a radio); done = solid ink fill, paper tick,
  strikethrough.

### Two fixes found by rendering it, not by reading it
The build was screenshotted at 390px against a stubbed API and inspected:
- **The 30-day trace was full-height black bars** — it dominated a screen where the
  number beside it is the point. Redrawn as a thin SVG polyline that dips on missed
  days, matching the reference.
- **Primary actions were full-width filled blocks.** In this language the default
  action is TEXT — `+ New project` right-aligned in mono caps. The filled button is now
  reserved for the single primary action on a screen (sign in, save).

### Fonts
Newsreader (serif), JetBrains Mono (labels), Inter (body), via Google Fonts in
`index.html`. `index.css` sets `color-scheme: light` on native inputs so date pickers
and checkboxes don't render dark against the paper.

**No proxy change. No API change. No schema change.**


## 2026-08-06 (i) - budget.cbedge.net phase 2: routines & habits, projects & milestones

Two new modules on budget.cbedge.net. Tab bar is now Today · Routines · Projects ·
Budget · Settings. **Nothing on cbedge.net changed** — no trading route, socket topic,
page, proxy or existing schema was touched.

### Routines & habits — `server-v2/_lib-household-routines.cjs`

**Deliberately NOT tasks.** A routine is a recurring intention that never completes; a
task is done once and gone. Mixing them leaves your to-do list permanently full of
things you do every day, or makes habits vanish the moment you tick them. Separate
tables, separate screen: `hh_routines` (one row per habit) + `hh_routine_log` (one row
per routine per day).

**The streak rule.** A streak counts consecutive days backwards from today — but
**today is not counted against you until it's over**. At 7am, before you've done your
morning routine, the walk starts from yesterday. A streak that resets at midnight and
only recovers once you've performed is punishing and factually wrong: you haven't
broken anything at 7am.

Other decisions:
- `PRIMARY KEY (routine_id, day)` makes ticking idempotent, and means a shared routine
  ticked by either person is simply done for the household. `done_by` records who.
- `day` is always resolved in the user's timezone before it reaches SQL. Never
  `now()::date`, which rolls over at 8pm Eastern and would tick the wrong day for the
  entire evening block.
- **Removing archives, it doesn't delete.** The log rows would cascade away with the
  routine, and losing a 90-day streak because you tidied your list is how people stop
  using an app. A real delete stays available for one you never wanted.
- Ticking is optimistic *including the streak number* — that number is the whole point
  of the gesture, and one that lags a second reads as "it didn't count".
- Morning / afternoon / evening blocks; new items sort to the BOTTOM of their block,
  because a routine list is a sequence you work through, not a feed.

### Projects & milestones — `server-v2/_lib-household-projects.cjs`

**Progress is measured from MILESTONES, never from task counts.** A project with 40
small chores and 3 real milestones reads as 80% complete once you've cleared the easy
chores — precisely the lie a progress bar exists to prevent. Milestones are the few
things that mean progress; tasks are listed and counted separately. Asserted directly
in the tests: 7 of 8 tasks done, progress stays at 25%.

A project with no milestones reports **null** progress and renders no bar at all —
"not measured yet" is honest, and a 0% bar on a project you've barely defined reads as
failure.

Other decisions:
- Milestones and time entries inherit permission from the PROJECT, resolved by joining
  — never by trusting an id from the client. Tested from both sides.
- Time is stored in whole minutes and **capped at 24h per entry**: anything larger is
  an extra zero on "90", and one bad row silently ruins every total downstream.
  Negative entries are allowed as corrections.
- Only whoever logged an hour can delete it. Archive/delete of a project stay
  owner-only even when shared, because they take milestones and logged hours with them.
- Deleting a project cascades to its milestones and time, but a task pointing at it
  survives (`ON DELETE SET NULL`) — losing the task would be losing unrelated work.
- List and detail are one screen with a selected id, not two routes: on a phone you
  bounce in and out constantly, and a route change loses scroll position every time.
- `hh_tasks.project_id` added via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — the
  table already exists on the deployed box, so `CREATE TABLE IF NOT EXISTS` would have
  skipped it silently. The old free-text `project` column is left alone.

### New routes
`GET/POST /api/hh/routines` · `GET/POST /api/hh/projects` (create, update, archive,
delete, addMilestone, toggleMilestone, updateMilestone, deleteMilestone, logTime,
deleteTime). Today's payload gains a `routines` progress line.

### Verification — 362 assertions across 8 suites, 0 failures
- **51 routine tests**: the streak rule in isolation (including across month, year,
  leap-day and DST boundaries), idempotent ticking, shared ticking by either person,
  archive-keeps-history, backfilling a past day, and both directions of the visibility
  rule.
- **58 project tests**: milestone-driven progress, the explicit "tasks do not move the
  bar" case, permission-by-join from both sides, time validation and caps, cascade
  behaviour on delete, archive round-trip.
- 73 calendar route, 57 household, 53 budget, 32 crypto/timezone, 19 recurrence parity
  (16,389 comparisons), 19 date-label.
- `tsc --noEmit` clean, `vite build` clean, `node --check` on all server files.

**No proxy change** — `proxy-tastytrade.js` and `proxy-thetadata.js` untouched.


## 2026-08-06 (h) - budget.cbedge.net step 6: the budget, on the phone

Phase 1 step 6 of 7. Balances, month totals, bills due, register and category spend
on a phone — reading the SAME tables as `/owner/budget`. Both placeholders on Today
are now live. `/owner/budget` is untouched and stays live.

**There is no second budget.** No copy, no sync, no import. One register, two views:
a payment entered on the phone appears on the desktop page immediately, and a bill
marked paid on either cannot be paid again on the other.

### How, with no migration
The budget tables were already multi-profile — every row is scoped by `profile_id`
and `/api/budget` has always resolved it via `getOrCreateBudgetProfile('owner')`.
`hh_users.budget_profile_key` defaults to `'owner'`, so both household accounts land
on the existing profile and see the existing register. Point someone at another key
and they get a private budget instead. No `ALTER TABLE`, no backfill, nothing to undo.

### New: `server-v2/_lib-household-budget.cjs`

**The part that must not drift.** Recurring bills are not rows — they are rules,
expanded into occurrences at read time. An occurrence becomes a real row only when
someone marks it paid, "materialising" it under

    __recur__:<ruleId>:<YYYY-MM-DD>

`occurrencesInMonth()` and that tag are ported **verbatim** from
`app/owner/budget/page.tsx`. If the two ever disagree, a bill paid on the phone still
shows unpaid on the desktop and gets paid twice — or a projection sits alongside its
own materialised row and double-counts against the balance.

Monthly rules clamp the anchor's day-of-month to the month length (a rule anchored on
the 31st fires on the 30th in April, the 28th in February, the 29th in Feb 2028).
Weekly/biweekly walk back from the anchor to before the month, then step forward.

Other decisions:
- **The sign is decided server-side.** The phone sends a positive amount plus
  "pay" or "income"; a fumbled minus can't turn a payment into a deposit.
- **markBillPaid is idempotent by tag** — a double-tap on a slow connection can't pay
  the same bill twice.
- Projected bills carry negative ids and cannot be edited or deleted (there is no row
  behind them). The UI says so rather than offering a button that would 400.
- Projected bills count against the running balance but NOT against category spend —
  they haven't been spent yet, and counting them would overstate every category.
- Errors throw human-readable text ("Pick a date.", "Give it a name.") surfaced as
  400s so the phone shows them verbatim.

### New route: `/api/hh/budget`
GET a month; POST `addRow | markBillPaid | updateRow | deleteRow | setDailyBalance |
setCategory`. Scoped by the caller's `budget_profile_key`.

### Today's Money card is live
`/api/hh/today` now carries a `money` summary — total balance, per-bank split, past-due
count and the next three bills — wrapped so a budget hiccup degrades one card instead
of the screen. Read-only by design: Today is for noticing, the Budget tab is for doing.

### `budget-vite/src/pages/Budget.tsx`
Month switcher, balance hero with per-bank split, in/out/net, Past due and Coming up
with one-tap Paid, add-entry form, newest-first register with running balance, and
category bars. Dates are sliced from the `YYYY-MM-DD` string, never parsed — same
rule as everywhere else in this app.

### Verification — 253 assertions, 0 failures
- **Parity: 16,389 comparisons** of `occurrencesInMonth` and `addDays` against the
  desktop implementation *extracted from the shipped `page.tsx` at test time*, across
  every day-of-month anchor x 3 frequencies x 17 months, plus 7,209 `addDays` cases
  over DST and leap boundaries. Identical output in every case. The tag format is
  asserted against the literal template in the desktop source.
- **53 budget integration tests** against real PostgreSQL: running balances, projection
  vs materialisation, the double-count trap, mark-paid idempotency, server-side sign,
  validation, categories, month boundaries, leap February, empty profile. Includes a
  direct assertion that the desktop's own skip rule and the phone's produce the
  identical bill set from the same live rows.
- 73 calendar route, 57 household integration, 32 crypto/timezone, 19 date-label.
- `tsc --noEmit` clean, `vite build` clean, `node --check` on all server files.

**No proxy change** — `proxy-tastytrade.js` and `proxy-thetadata.js` untouched.


## 2026-08-06 (g) - budget.cbedge.net: shared household calendar + calendar picker

Follow-up to (f), fixing a design flaw found in real use: a **shared family calendar
would never have appeared at all**, and the other person had to do the whole Google
flow to see anything.

### The bug: `primary` is not "all your calendars"
The events read hit `/calendars/primary/events`. `primary` is only the account's own
default calendar — a calendar shared with you is a SEPARATE entry in the calendar list,
so not one of its events would ever have shown, for either person. Now reads
`users/me/calendarList` and merges events across the calendars you pick.

### One connection can serve the whole household
`hh_google_tokens` gains `share_with_household` and `selected_calendars`. Added as
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, deliberately NOT folded into the CREATE —
the table already exists on the deployed box and `CREATE TABLE IF NOT EXISTS` would
skip new columns silently.

`resolveSource(userId)` picks the user's own connection first, else any connection
flagged `share_with_household`. So one person links the family calendar and the other
just sees it, having touched Google never. Defaults to sharing ON for a new connection
— it shares only the SELECTED calendars, and selection starts at primary-only, so this
can never expose a calendar that wasn't ticked.

### The picker IS the privacy control
`GET /api/hh/calendar/calendars` lists everything the account can see (personal,
shared, subscribed, holidays) with colour and access role; `POST /api/hh/calendar/select`
saves the ticked ids and the sharing flag. `selected_calendars` distinguishes three
states that matter: **NULL** = never chosen → primary only; **[]** = deliberately none
→ the card says "no calendars selected" rather than showing a misleadingly empty day;
**[ids]** = exactly those.

### A regression the tests caught
Per-calendar failures are tolerated so one deleted calendar can't blank the others —
but that first pass meant a TOTAL Google outage returned `events: []` with no error,
rendering as "nothing on today". That is the exact lie the card is built never to tell.
Now: all calendars failed → `error`; some failed → events plus a `partialFailures`
count and a "this may not be everything" line.

### Other fixes in this pass
- **Event ids are calendar-qualified** (`<calendarId>:<eventId>`). The same invite on
  two selected calendars shares a bare event id, and React would silently drop one copy.
- Events sort all-day first, then chronologically, merged across calendars.
- Per-calendar fetches run in parallel — sequential would stack latency per calendar.
- Cache is cleared on any selection change, not just the editing user's slice, because
  a shared connection's selection changes what the OTHER person sees.
- Settings distinguishes "you have your own connection" from "you're being fed by the
  shared one", so the second case reads as working rather than as broken.

### Verification — 181 assertions, 0 failures
Calendar route tests grew to **73**, adding: shared-connection resolution, the picker,
merge across calendars, holidays excluded when unticked, turning sharing off cutting
the other person off immediately, empty-selection vs never-selected, and partial
failure. Plus 57 household integration, 32 crypto/state/timezone, 19 date-label.
`tsc --noEmit` clean, `vite build` clean, `node --check` on all server files.

**No proxy change** — `proxy-tastytrade.js` and `proxy-thetadata.js` untouched.


## 2026-08-06 (f) - budget.cbedge.net step 5: Google Calendar (read-only, per person)

Phase 1 step 5 of 7. Each household member links their OWN Google account; today's
events render in the Today calendar card. Read-only — the app cannot create, change
or delete an event. Money card is the last placeholder (step 6).

**Nothing on cbedge.net changed.** No trading route, socket topic, page, proxy or
existing schema was touched.

### New: `server-v2/_lib-google-calendar.cjs`
Four rules the implementation is built around:

1. **The browser never sees a Google token.** No client-side Google SDK, nothing in
   localStorage. The SPA calls our endpoint; we call Google server-side and return
   plain event JSON.
2. **Refresh tokens are encrypted at rest** (AES-256-GCM, scrypt-derived key from
   `HH_TOKEN_KEY`). A refresh token is a permanent read key to someone's calendar; it
   does not sit in a table in plaintext. A rotated key decrypts to null → "reconnect",
   never a 500.
3. **Scope is `calendar.readonly`** and `prompt=consent` + `access_type=offline`, which
   is what actually returns a refresh_token on RE-authorisation. Without
   `prompt=consent` Google omits it every time after the first, leaving a connection
   that works for an hour and then silently dies.
4. **Google being slow, down, or revoked must never break Today.** Every read path
   returns `{ events, error? }` and always 200s. The card renders its own state.

### OAuth state is signed AND user-bound
`state` is an HMAC-signed, 10-minute payload carrying the user id. The callback
requires a valid signature **and** `state.uid === signed-in user`. Signature alone
would let someone paste their own callback URL into the other person's browser and
bind THEIR calendar to that account. Tested explicitly.

### `/connect` and `/callback` are `auth:'public'` on purpose
They are browser navigations, not fetches. A navigation that 401s with JSON dumps raw
text on the screen, so both do their own session check and always end in a redirect a
person can read. This is safe because the hh_session cookie is `SameSite=Lax`, which
permits top-level GET navigations — do **not** switch to a POST callback, the cookie
would not survive it.

### Events are fetched SEPARATELY from `/api/hh/today`
A call out to Google can take half a second. Folding it into Today would hold the
whole screen hostage to a third party. Today reports only `calendar: {configured,
connected}` from our own database and paints immediately; `/api/hh/calendar/events`
fills the card in when it fills in. 60s per-user cache server-side (a phone re-checks
on every foreground) and a matching `staleTime` client-side.

### Per-day timezone offset, not "now"
The events window is built from the offset that timezone is at **on that specific
calendar day**, not the current one. Using today's offset for a day on the other side
of a DST change shifts the window an hour and drops the first or last event. Both
boundaries are covered by tests.

Other handling: recurring events expanded via `singleEvents=true` (otherwise a weekly
standup returns as one master row and never shows), `cancelled` filtered out, all-day
vs timed distinguished by `date` vs `dateTime`, untitled events labelled.

### `budget-vite`
- `src/components/CalendarCard.tsx` — every failure mode gets its own honest message.
  The one thing it must never do is render an empty list when it doesn't know:
  "nothing on today" and "we can't reach your calendar" look identical but mean
  opposite things, and one of them makes you miss something.
- `src/pages/Settings.tsx` — connect/disconnect, shows the linked Google address,
  reads the `?calendar=` result from the callback and strips it so a refresh doesn't
  replay the message.
- Connect is a real `<a href>`, never a fetch — the browser has to follow the redirect
  out to Google.

### New env (`.env.local` on the VPS — mounted at runtime, never baked into the image)
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `HH_TOKEN_KEY` (`openssl rand -hex 32`),
optional `HH_BASE_URL` (default `https://budget.cbedge.net`). Missing config is not a
crash: `configured()` returns false and the card says "not set up" instead of offering
a Connect button that dead-ends.

Authorised redirect URI in Google Cloud Console must be EXACTLY
`https://budget.cbedge.net/api/hh/calendar/callback`.

### Verification — 156 assertions total, 0 failures
- **48/48** calendar route tests with Google stubbed at the `fetch` boundary: full
  connect flow, CSRF (forged state, expired state, another user's valid state replayed
  in your session), token encryption at rest, access-token refresh on expiry, key
  rotation, revoked access, Google 503, cache hit, disconnect + revoke, and the
  missing-refresh_token trap.
- **32/32** crypto/state/URL/timezone unit tests, including both DST boundaries.
- **57/57** household integration tests still green against real PostgreSQL 16.
- **19/19** date-label tests.
- `tsc --noEmit` clean, `vite build` clean, `node --check` on all server files.

**No proxy change** — `proxy-tastytrade.js` and `proxy-thetadata.js` untouched.


## 2026-08-06 (e) - budget.cbedge.net step 4: tasks, Today screen, per-person sharing

Phase 1 step 4 of 7. The Today screen is real now — capture, Top 3, open tasks,
Slipping, Resurfacing — backed by `hh_tasks` / `hh_notes` with the per-person
opt-in-sharing rule enforced in SQL. Calendar and Money remain labelled placeholders
(steps 5 and 6).

**Nothing on cbedge.net changed.** No trading route, socket topic, page, proxy or
existing schema was touched.

### `server-v2/household-routes.cjs` — 4 new routes (9 total)
- `GET/POST /api/hh/tasks` — list + create/update/toggleDone/toggleStar/touch/delete.
- `GET/POST /api/hh/notes` — the Resurfacing pool.
- `GET/POST /api/hh/settings` — per-user `slippingDays` (default 7, clamped 1-365).
- `GET /api/hh/today` — the whole screen in ONE round trip (top3 + open + slipping +
  counts + resurfacing + people). Composed server-side so the phone paints once
  instead of in five stages over cellular.

### The visibility rule, defined once
`VISIBLE = (owner_id = $1 OR visibility = 'shared')` is a single constant reused by
every query. Read and write both use it; **delete is deliberately stricter** — you can
complete or edit a shared task, but only its owner can destroy it, because deletion is
the one action with no undo. A query that forgets this clause leaks the other person's
private rows, so it is never hand-rolled per route.

### `due_date` is cast to TEXT — do not "simplify" this back
`due_date` is a Postgres DATE (a calendar day), but `pg` hydrates it into a JS Date at
UTC midnight, which serialises as `"2026-08-10T00:00:00.000Z"`. In Eastern that renders
as **Aug 9** — every due date one day early, and "due today" showing as overdue.
`to_char(due_date,'YYYY-MM-DD')` kills the class of bug at the source, and matches what
`<input type="date">` expects. The client compares dates as STRINGS throughout
(lexicographic on that format is chronological) and never calls `new Date()` on one.

### Slipping
Open, unstarred, `touched_at` older than the user's threshold. Starred items are excluded
— they're already at the top of the screen, so flagging them again is noise, not a nudge.
`touch` ("Still on it") resets the clock without pretending the task changed.

### `budget-vite` — Today screen + optimistic updates
- `src/hooks.ts` — TanStack Query. Every task mutation is optimistic with snapshot
  rollback on failure; a checkbox that waits 400ms on cellular feels broken and gets
  tapped twice. `patchToday()` updates a task across ALL of top3/open/slipping at once,
  because the same task lives in several arrays and patching one leaves a row ticked in
  the top section and unticked twenty pixels below.
- Star is deliberately NOT re-bucketed client-side: top3 membership is a server decision
  (starred + ordered + capped at 3), so guessing locally makes rows jump and jump back.
- `src/components/TaskRow.tsx` — 24px complete button with its own hit area, star,
  expandable row for due date / share toggle / still-on-it / delete.
- `src/pages/Today.tsx` — quick-add first (thumb reach), counts, Top 3, calendar
  placeholder, open tasks, Slipping, Resurfacing, money placeholder.
- `src/pages/Settings.tsx` — slipping threshold, saved-notes manager, password change.

### Verification
- **56/56 integration tests** against a real PostgreSQL 16, driving the actual route
  handlers: schema idempotency, login + lockout, session hashing + expiry, task CRUD,
  ordering (`NULLS LAST`, so undated tasks don't bury dated ones), settings clamping,
  Slipping, Resurfacing stability, empty-state.
  Both directions of the visibility rule are asserted explicitly: neither person can
  read, edit, complete or delete the other's private rows.
- **19/19 date-label tests** including both DST boundaries, month/year rollover, leap day
  and Feb 29 → Mar 1.
- `tsc --noEmit` clean, `vite build` clean, `node --check` on all server files.

**No proxy change** — `proxy-tastytrade.js` and `proxy-thetadata.js` untouched.


## 2026-08-06 (d) - budget.cbedge.net: household life-OS subdomain (auth + shell)

New standalone SPA at **budget.cbedge.net** — a personal life OS shared with one other
person, with budget as one tab. Phase 1 steps 1-3 of 7: its own auth system and a
deployable phone-first shell. Today/Budget screens are labelled placeholders until
steps 4-6.

**Nothing on cbedge.net changed behaviour.** `/owner/budget` is untouched and still
owner-gated. No trading route, socket topic, page or schema was modified.

### New: `budget-vite/` — the SPA
- Vite + React + TS + TanStack Query, phone-first (390px), CB Edge dark palette.
- Mirrors the `owner-vite/` pattern exactly: node build stage → nginx, `docker compose
  build budget` reproduces it, no host npm.
- **Standalone on purpose** — no `@/app/...` alias into the Next app (unlike `app-vite`).
  It builds and deploys without the trading component tree, `GlobalToolbar` or
  `gexSocket`. `src/theme.ts` COPIES the `homeTheme.ts` tokens rather than importing them.
- `nginx.conf` listens on **8083** and proxies **only `/api`** — deliberately narrower
  than owner-vite, which also forwards `/ws` and `/proxy`. This app has no reason to
  reach the market-data stack, so it cannot.
- Login screen names no product and exposes no signup or password-reset route.

### New: `server-v2/_lib-household.cjs` — auth, separate from CB Edge
- Tables self-bootstrap via `CREATE TABLE IF NOT EXISTS` (same pattern as `day_posts`
  and `cb-contract-track`): `hh_users`, `hh_sessions`, `hh_login_attempts`, `hh_tasks`,
  `hh_notes`, `hh_settings`, `hh_google_tokens`. No migration runner.
- **A cbedge.net session grants nothing here, and vice versa.** Different cookie name
  (`hh_session`), and the Set-Cookie carries **no `Domain=` attribute** so the browser
  scopes it host-only to budget.cbedge.net. Never add `Domain=.cbedge.net` there.
- scrypt via `node:crypto` — no new dependency, no native build. The DB stores only the
  SHA-256 of the session token, so a dump yields no live sessions.
- 5 failures per email per 15 min locks out. Unknown-email and wrong-password return the
  same message and burn the same CPU, so neither response nor timing reveals which of the
  two addresses is real.

### New: `server-v2/household-routes.cjs` — `/api/hh/*`
- `login`, `logout`, `me`, `change-password`, `health`. **No signup route by design.**
- `me` is `auth:'public'` returning 401 rather than `auth:'household'`, so a signed-out
  visitor gets clean JSON the SPA can render a form for instead of an HTML redirect.

### New: `server-v2/scripts/hh-user.js`
- `list | add | passwd | profile | sessions-clear`. Accounts are created on the box.

### `server-v2/api-router.js` — two surgical edits
- `enforceAuth()`: new `'household'` branch, placed **before** the `verifyWsRequest` call.
  A household user carries no `cbe_session` and would otherwise be rejected as a
  signed-out visitor. Returns `userId: 'hh:<id>'` so a household id can never be confused
  with a `users.id` downstream.
- Bottom of file: loads `household-routes.cjs` inside a try/catch, exactly like the
  `_lib-*` bundles. If it or `_lib-db.cjs` is missing, `/api/hh/*` is simply never
  registered and boot is unaffected.

### `docker-compose.yml`
- New `budget` service → `budget-web:latest`, bound to `127.0.0.1:8083` (loopback only,
  Cloudflare Tunnel reaches it).

### Budget data — no migration needed
The budget tables were **already multi-profile**: `/api/budget` calls
`getOrCreateBudgetProfile('owner')` and every row is scoped by `profile_id`. So
per-person budget = per-profile. `hh_users.budget_profile_key` defaults to `'owner'`, so
both accounts read the existing register with **zero `ALTER TABLE`, zero backfill**, and
`/owner/budget` keeps working unchanged. The planned ownership-column migration was
dropped as unnecessary.

### Deploy
Needs one manual step outside the repo — add to `/etc/cloudflared/config.yml` above the
catch-all 404: `- hostname: budget.cbedge.net` / `service: http://127.0.0.1:8083`, then
`cloudflared tunnel route dns <tunnel> budget.cbedge.net` and restart cloudflared.

**No proxy change** — `proxy-tastytrade.js` and `proxy-thetadata.js` untouched.


## 2026-08-06 (c) - GEX sign parity: OI-only mode on Multi Greek, abs() on two recorder paths

Chased a report that 0DTE QQQ 720 read strongly POSITIVE on our board while two other
platforms read negative. Not a bug in the arithmetic — a difference in what "net GEX"
means here — plus one genuine latent sign bug found alongside it.

### `app/mult-greek/MultGreekClient.tsx`
- Added a third **`OI`** option to the contract-basis toggle (was `OI+VOL` / `VOL` only).
  Default is unchanged (`oivol`).
- **Why.** Every other GEX vendor publishes OI-ONLY net GEX. This page had no OI-only
  mode, so its numbers were never comparable to theirs — and on 0DTE they can carry the
  OPPOSITE SIGN. 0DTE open interest is yesterday's close (often ~0 at a strike that only
  came into play this morning) while today's volume is 10-50x larger, so `OI+VOL` is
  effectively pure VOLUME GEX at those strikes. Volume GEX is signed with the OI
  convention — ALL call volume treated as dealer-long, ALL put volume as dealer-short,
  with no buy/sell classification of the tape — which pins any heavily-traded call strike
  strongly positive even when the OI book there is net short gamma. That is exactly the
  QQQ 720 case.
- `strikeGex()`'s 4th arg went from `volOnly: boolean` to `mode: ContractMode`
  (`"oivol" | "vol" | "oi"`); the same value now threads through `computeRows()`, the
  panel prop, and the delta-stamp history effect, so the 15m/30m/open change stamps are
  computed on whichever basis is displayed rather than always on the OI+Vol one.

### `server-v2/etf-gex-recorder.js` — sign bug
- `Math.abs()` on both gammas before the netGEX / netVolGEX reduction.
- Gamma is positive for calls AND puts; the put leg's short-gamma polarity is carried by
  the MINUS sign in the formula, not by the greek. A signed (negative) put gamma from
  upstream made `- pGamma * pOI` ADDITIVE, silently flipping that strike POSITIVE in the
  recorded SPY/QQQ history. `computation/gex-calculator.js` and the client both abs their
  gammas; these two paths were the only places in the repo that did not.

### `server-v2/state/ticker-wall-recorder.js` — same sign bug
- Same `Math.abs()` fix. Here the failure mode is a put wall being recorded as a call
  wall.

**No proxy/server-with-proxy change. No API, schema, socket-topic or route change.**

## 2026-08-06 (b) - Home rail: CPG Ratio → Net GEX Rate, + per-strike GEX rate

Replaced the CPG (call/put gamma) ratio tile on the /home gauge rail with a Net GEX
RATE tile, and added a matching per-strike rate mode to the heatmap. The ratio described
the SHAPE of the book; the rate describes how fast it is being built or pulled.

### `components/dashboard/HomeGaugeRail.tsx`
- `CPG RATIO` tile → **`NET GEX RATE / MIN`**: $B of gamma-per-1%-move added (+) or
  pulled (−) per minute. Signed meter, self-scaling to today's fastest observed move
  (floored at 0.1 so a quiet tape doesn't swing the needle on noise).
- Derived inside the component from the GEX history the rail already keeps — no new
  prop, no new socket topic, no extra fetch.
- Δ is measured against the newest sample ≥30s old and ≤180s old, then normalised to
  per-minute by the ACTUAL elapsed span. Samples are 15s-bucketed and feed cadence
  drifts, so a raw last-minus-reference would silently scale with how stale the
  reference happened to be. Spans under 30s are rejected rather than divided through —
  dividing a small Δ by a few seconds manufactures a huge rate out of feed jitter.
- Removed now-unused `cpg` prop, `fmtRatio` / `fmtAbsRatio`.

### `hooks/useStrikeGexRate.ts` (new)
- Per-strike net GEX rate ($ per 1% move, per minute) sampled client-side from the live
  heatmap rows (15s cadence, ~2min ring), same span guards as the tile.
- **Deliberately not another `useStrikeGexHistory` age bucket.** The stored per-strike
  series is written by `gex-history-writer.js` on a ~60s cadence AND each row is an
  average of the ~12 recomputes in that window, so a "1 minute ago" baseline from it is
  0–120s old and pre-smoothed — neither 1-minute nor a rate. **No proxy/server change.**

### `app/home/HomeClient.tsx`
- Heatmap Δ selector gained a **`rate`** option (`Δ off | rate | 5m | 15m | 30m`);
  `deltaWindow` type widened to `0 | 1 | 5 | 15 | 30`.
- In rate mode the NET GEX column header reads `NET GEX +Δ/MIN` and the ranked-strike
  stamps show per-minute rate with a `/m` suffix; tooltip reads "Building/Decaying
  …/m · #N fastest mover (X.X%/min)".
- Noise floor is 0.25%/min in rate mode (vs 1% for the cumulative windows) — a rate is a
  smaller number than a 5/15/30m cumulative move, so the 1% cut would have blanked most
  of the board.
- Rate mode is served entirely by the new hook, so it no longer keeps `/proxy/gex-history`
  warm (`deltaWindow > 1` now gates that poll instead of `!== 0`).
- Dropped the CPG dollar-gamma sums from `gaugeMetrics`; it now computes `gammaPctVol` only.

### Notes
- Sign convention is unchanged from the existing 5/15/30m stamps (`d = live − past`), so
  on a PUT wall (negative net GEX) a shrinking wall reads positive/green. Consistent with
  what the other windows already show rather than a second convention.
- Verified: all three files compile (esbuild); rate math unit-tested for clean 60s span,
  normalisation across a 90s span, the <30s jitter guard, the >180s stale guard, decay,
  and flat. Declaration order checked — `heatmapRows` (L1187) precedes the hook call
  (L1370), so no TDZ.

## 2026-08-06 - GEX chart expiry picker: wrong DTE labels & failed switching

Home GEX chart showed Wed/Thu in the expiry picker on a Thursday (should have been
Thu/Fri = 0DTE/1DTE), the bars kept changing on their own, and switching between the
two entries didn't stick. Server restarts didn't help. Other heatmaps were unaffected.

### Root cause
Two independent defects compounding:

1. `server-v2/proxy-tastytrade.js:2284` published the **unfiltered** chain expiration
   list to `marketState`, including already-expired dates. The REST route
   `fetchExpirations()` (line ~1577) has always filtered `>= today` — which is exactly
   why every OTHER heatmap looked right and only the WS-fed home GEX chart was wrong.
2. `buildExpiryOptions()` in `app/home/HomeClient.tsx` labelled the picker by **array
   position** (`${index}DTE`), not by date. So one stale leading entry shifted every
   label by one: Wed→"0DTE", Thu→"1DTE".

`setExpirations()` was also only ever called once at feed startup, so after a date
change the picker kept serving the previous day's array while `this.expiry` had already
auto-rolled. Selecting the stale entry was reverted by the auto-roll block on the very
next `_recompute()` tick — that fight is what made the bars appear to change on their
own and made switching back and forth fail.

### `server-v2/proxy-tastytrade.js`
- Feed startup now filters expirations to today-forward before `setExpirations()`;
  falls back to the raw list if the filter empties it. Default expiry derives from the
  filtered list.
- Auto-roll block (`_recompute`) now re-publishes the today-forward list via
  `setExpirations()` **before** rolling, so the picker no longer goes stale across a
  date change. `next` is chosen from the filtered list.
- Startup log now reports today-forward count alongside the raw count.

### `app/home/HomeClient.tsx`
- `buildExpiryOptions()` rewritten to label by **real calendar DTE** instead of array
  index. Added `etYmdToday()` (ET via `Intl.DateTimeFormat`, matching the server's
  `todayYmd()`) and `daysBetweenYmd()` (parses at UTC midnight so DST can't round the
  difference wrong). Negative-DTE entries are dropped rather than shifting labels.
- Self-correcting: even if a stale date reaches the client, labels stay right.

### Notes
- Labels are now true calendar DTE, so Monday reads `3DTE`/`4DTE` from a Thu/Fri rather
  than `2DTE` — this matches the other heatmaps and the REST-fed pages.
- Verified: both files compile (`node --check`, `esbuild`); label logic unit-tested
  against the reported Wed/Thu case plus weekend-gap and DST-boundary inputs.
- No proxy request/routing behavior changed — only which expiration dates are published.

## 2026-06-18 (session 30) - Heatmap/Snapshot UI, Vol-GEX Fix & Dev Symbol Probe

### `app/home/page.tsx`
- GEX heatmap intensity slider min lowered `0.2` → `0.1` (range now .1–3.0)
- Removed the duplicate 📸 record-snapshot button from the heatmap header (kept the camera screenshot button)
- `GEX + VEX` column replaced with `Net VEX` (vanna only)
- Top toolbar: added visible `│` spacers between quotes (VIX/ESU/SPX) and between NET GEX / CALL WALL / PUT WALL / FLIP
- ATM heatmap row now framed with a light white border across all columns (heatmap only, not snapshot)
- **MVC bug fix:** header MVC now respects the active `dataMode` (Vol-Only uses `netVolGEX`, OI+Vol uses the composite) instead of always using OI-based `netGEX`

### `components/dashboard/SnapshotPanel.tsx`
- Top metrics grid and Option Flow Tops grid changed from 2-across to 4-across to fit one screen

### `components/dashboard/FlowTape.tsx`
- Added a `Side` column showing explicit `BUY` (ask/aggressive buyer, green) / `SELL` (bid/aggressive seller, red) with rule-of-thumb sentiment tooltips

### Vol-GEX volume source fix — `server-v2/proxy-tastytrade.js`
- Root cause of false MVC (7475 ranked #1 vol-GEX with ~0 live volume): per-strike volume fell back to the REST `volume` field, which carries stale prior-session cumulative volume
- Now stores live `dayVolume` even when 0 (presence = authoritative), and only falls back to REST volume when the stream has never delivered a print

### Dev symbol probe (rebuilt) — `app/dev/page.tsx`, `server-v2/proxy-tastytrade.js`, `server-v2/server-with-proxy.js`
- Rebuilt `/dev` (was `return null`): pick Side/Strike/Expiry/Feed → builds `.SPXW…` symbol → `GET /proxy/probe` returns raw feed data + timing
- Reads the same live proxy maps the GEX chart uses (greeks/quotes/volumes/summaries)
- On-demand subscribe for uncached symbols: subscribes, page polls until data arrives, reports server-measured `waitedMs`, auto-unsubscribes after 15 min (`DxLinkClient.unsubscribe`, `probeSubs` TTL map)

### Version
- `package.json` bumped `2026.6.18-v50` → `v52` across the session

## 2026-06-18 (session 29) - Proxy Removal & Vanilla Archive

### Objective
Remove all proxy-dependent code in preparation for a full proxy rebuild from scratch. Archive the Vanilla JS dashboard so it is not touched by AI tooling.

### Proxy Calls Removed / Stubbed
All proxy fetch calls removed or replaced with no-ops across:
- `Vanilla/pages/overview/overview.js` — quotes-batch, debug-summary, prev-closes, auto-connect, greeks-intraday, db/insert, db/query, backup/buy-sell-scores, es-stats, chains, discord-webhook, twitter, levels
- `Vanilla/shared/overview.js` — token exchange, logout, proxyGet, fetchGEX chain, lazy DTE chain, all quotes-batch blocks, auto-connect, compare GEX, buy-sell score backup/restore, SPY/QQQ chain, equity ticker chain, schwabAdapt chain
- `Vanilla/pages/mult-greek/mult-greek.js` — `/proxy/dxlink/subscribe`
- `Vanilla/pages/insights/options-chain/options-chain.js` — `/proxy/dxlink/subscribe`
- `Vanilla/shared/spx-flow.js` — `/proxy/dxlink/subscribe`
- `Vanilla/futures_flow.js` — quotes-batch
- `Vanilla/live-signals-vanilla.js` — `/proxy/api/levels`
- `Vanilla/flow-recorder.js` — quotes-batch
- `Vanilla/updateDailyEM_replacement.js` — early throw before all chain/quotes fetches

### Archive Created
- `archive-vanilla.ps1` script executed — moved `Vanilla/` folder and all `proxy*.js` root files into `_ARCHIVED_DO_NOT_EDIT/`
- `_ARCHIVED_DO_NOT_EDIT/README.md` written to prevent AI tools from reading or modifying archived content

### Folder Cleanup (identified, script ready)
- Identified stale root files: log files, `.bat` scripts, duplicate `.md` files, `tastytrade_token.json`, corrupted DB, empty `bzila-dashboard/` folder
- Cleanup PowerShell script provided; awaiting user confirmation on 3 files (`build_spx_ohlc_5m.mjs`, `estimated-moves.*`, `gex_levels.csv`)

### Version
- `package.json` bumped to `2026.6.18-v39` and pushed to GitHub

## 2026-06-17 (session 28) - Sidebar Page Shortcuts Moved Into Grid Menu

### `components/shared/Sidebar.tsx`
- Moved the page shortcut list into the 4-box grid button popout
- Removed the separate shortcuts block from the sidebar rail so the left column stays compact
- The grid button now highlights when the page menu is open or when one of the listed pages is active

## 2026-06-17 (session 27) - Dashboard Route Removed from Navigation

### `app/dashboard/page.tsx`
- Replaced the dashboard page with a redirect to `/home` so the old proxy-control route no longer serves a separate screen

### `components/shared/Sidebar.tsx`
- Removed the dashboard shortcut from the persistent sidebar so the page is no longer exposed in the left rail

### Intent
- The shared sidebar now points users at the home page and other working sections only, keeping the dashboard control surface out of sight

## 2026-06-17 (session 26) - Global Sidebar Replaced with Home-Style Rail

### `components/shared/Sidebar.tsx`
- Replaced the old expanded sidebar with the compact home-style rail so the same left navigation now appears on every page
- Kept the home icon, page shortcuts, live quotes stack, settings cog, and logo circle in the new layout
- Wired the cog button to the existing idle proxy action so the idle control stays available from every route

### `components/shared/LayoutShell.tsx`
- Continues to mount the shared sidebar globally through the app shell, so the updated rail is now the persistent left sidebar site-wide

## 2026-06-17 (session 25) - Proxy Live Data Wiring + Initial Server Modularization

### Live Proxy Subscription Wiring
- `lib/proxy/liveSubscription.ts` - added shared helpers to normalize proxy feed payloads and guarantee live proxy subscriptions through `/api/proxy/subscription-ready` and `/api/proxy/dxlink-subscribe`
- `app/home/page.tsx` - rewired `/home` to follow the same proxy-first live data flow as `/dev`: fetch chain data, prepare option symbols, ensure proxy subscriptions, consume `/ws/dxlink`, and build the GEX chart + options heatmap from shared live Greeks, summary, quote, and trade updates
- `app/mult-greek/page.tsx` - wired multi-greek into the same proxy subscription readiness flow and re-subscribe behavior on websocket open/reconnect
- `app/options-chain/page.tsx` - wired options chain into the same proxy subscription readiness flow and re-subscribe behavior on websocket open/reconnect
- `app/insights/page.tsx` - switched insights live feed setup to the shared proxy subscription helper and shared feed normalization path

### WebSocket Stability Fix
- `app/home/page.tsx` - fixed a websocket reconnect storm that was repeatedly opening `/ws/dxlink` connections and flooding the browser with `Insufficient resources` errors
- Root cause: the socket connect callback was being recreated from live quote state changes, which caused repeated reconnects and overlapping sockets
- Fix: added stable refs for quote snapshots, reconnect timers, and unmount state so `/home` now keeps a single connection and reconnects in a controlled way

### Initial Server Refactor
- `server/websocket-server.js` - extracted the reusable `/ws/dxlink` websocket bridge used by the custom Next.js server
- `server/computation/utils.js` - extracted shared numeric and symbol/date helpers for proxy computations
- `server/computation/flow-processor.js` - extracted buy/sell snapshot helper logic used by derived metrics
- `server/computation/vex-chex.js` - extracted shared exposure accumulation logic for DEX, VEX, and CHEX-style calculations
- `server/computation/gex-calculator.js` - extracted reusable intraday snapshot and GEX level calculation helpers
- `server/server-with-proxy.js` - updated to use the extracted websocket bridge module
- `server/proxy-tastytrade.js` - began routing intraday snapshot logic through the shared computation module path as the first step of breaking up the monolithic proxy

### Verification
- `npm run build` completed successfully after the live data wiring and server extraction changes

## 2026-06-16 (session 24) — Discord Bot with Slash Commands

### New Files
- `discord-bot.js` — Discord bot using discord.js + Puppeteer; screenshots Next.js pages at `https://dash-1fa2.onrender.com` and posts them to Discord. Commands: `/screenshot <page>`, `/gex`, `/snapshot`
- `register-commands.js` — one-time script to register slash commands globally via Discord REST API

### Modified Files
- `package.json` — added `discord.js`, `puppeteer` dependencies; added `bot` and `bot:register` npm scripts
- `.env.local` — added `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_GUILD_ID`, `DASHBOARD_URL`

### Page Map (slash command choices → Next.js routes)
- GEX Chart, Heatmap, Snapshot Flow, SPX Flow, MVC → `/home`
- Exposure Stack → `/insights`
- Multi Greek → `/mult-greek`

### Notes
- Bot runs locally via `npm run bot`; for 24/7 uptime deploy as Render Background Worker
- Global command registration used (guild registration failed due to missing `applications.commands` scope on initial invite)
- Puppeteer wait times set to 3s per page; `deferReply` wrapped in try/catch to handle stale interactions

## 2026-06-16 (session 23) — Heatmap Height Fix + Overview Redirect

### `app/overview/page.tsx`
- Replaced full overview page with a simple `redirect("/home")` — `/overview` route now permanently redirects to `/home`

### `components/dashboard/GexHeatmap.tsx`
- Root `app/page.tsx` already redirects to `/home`; confirmed no change needed

### `app/overview/page.tsx` (heatmap body wrapper)
- Added `display: "flex", flexDirection: "column"` to heatmap body wrapper div so `GexHeatmap`'s `height: 100%` resolves correctly — fixes only 3 strikes showing in the live GEX heatmap panel

### Version
- Bumped to `2026.6.16-v48`

---


## 2026-06-16 (session 22) — Task #7 Steps 1-2: GEX Toolbar Live Data Wiring

### `components/dashboard/GexToolbar.tsx`
- Added toolbar state management: `selectedExpiry` (0DTE/1DTE) and `chartMode` (net-gex, call-gex, put-gex, call-put, oi-vol, bid-ask-vol)
- Refactored DTE button group + chart mode selector from static UI to interactive state
- DTE buttons now toggle `selectedExpiry` state and highlight active selection (cyan when selected, muted otherwise)
- Chart mode dropdown wired to `chartMode` state with visual feedback
- Prop interface updated: `onExpiryChange` and `onChartModeChange` callbacks passed from parent
- All button clicks now trigger state updates (ready for heatmap/chart filtering in next steps)

### `app/page.tsx`
- Added `selectedExpiry` and `chartMode` state to Overview page root
- Passed states + callbacks down to `GexToolbar` for toolbar button wiring
- Prepared data pipe for downstream components (heatmap row filtering, GEX chart bar rendering)

### Task Progress
✅ Step 1: Add toolbar state to manage DTE selection and chart mode
✅ Step 2: Make DTE and chart mode buttons clickable with state updates
⏳ Step 3-6: Filter heatmap rows, render GEX bars, update labels, wire chart updates (next session)

### Version
- Bumped to `2026.6.16-v73`

---

## 2026-06-16 (session 21) — Heatmap Vol Fallback + Proxy dxLink Throttle Fix (v47)

### `app/home/page.tsx`
- **Heatmap OI=0 fallback**: When proxy returns `netGEX=0` due to missing OI (dxLink throttling), display falls back to `netVolGEX` (volume-based GEX) for NET GEX column and `volNetDEX` for NET DEX column — options with volume but no OI now show real values instead of `$0`
- **VEX fallback**: Also falls back to `netVolVanna` when `netVanna=0`
- **Rank badges**: `effGex()` helper uses vol-fallback when ranking top pos/neg strikes, so badges appear even when OI=0
- **`nonEmpty` filter**: Extended to include rows where `volOnly !== "$0"` — previously hid valid strikes that had volume data but zero OI

### `Vanilla/proxy-tastytrade.js`
- **Cache-hit path**: SPX/SPY/QQQ flagged as pre-warmed symbols — cache hits for these skip all re-subscription (prewarm at startup already handles their dxLink subscriptions), eliminating thousands of duplicate subscription requests per chain fetch
- **Fresh-fetch path**: SPX/SPY/QQQ also skip subscribing on fresh fetches (prewarm handles it); all other on-demand symbols capped at 200 streamer symbols per request
- **Root cause fixed**: Was flooding dxLink with 6700+ subscription requests on every `/proxy/api/tt/chains/SPX?range=all` hit, causing `BAD_ACTION "Your subscription rate is too high"` errors and stalling REST monitors for SPX/VIX/ES feeds

## 2026-06-16 (session 21) — Quotes Panel WS Refactor + by-type Batch API

### `Vanilla/shared/quotes-manager.js`
- Replaced per-symbol equity REST loop with single `GET /proxy/api/tt/market-data/by-type?equity=...` batch call
- Populates `state.prevCloses` inline from `prev-close` field in batch response — eliminates separate prevclose fetch for equities
- Updated auto-init symbol list: removed `SRM`, added `SPY`, `TSLA`, `SMH`, `SPCX`

### `proxy-tastytrade.js`
- Added all 14 equity quote symbols (`SPY`, `QQQ`, `AAPL`, `AMD`, `AMZN`, `GOOGL`, `META`, `MSFT`, `NVDA`, `SPCX`, `TSLA`, `SMH`) to `CORE_LIVE_SUBSCRIPTIONS` — now subscribed at boot via DXLink regardless of page state

### `Vanilla/pages/quotes/quotes.html`
- Rewrote `QuotesPanel` to read from `QuotesManager.getQuote()` / `getChange()` (DXLink cache) instead of polling `quotes-batch` REST
- Removed separate `loadPrevCloses`, `fetchQuotes`, and `subscribeSymbols` methods
- Re-renders every 5 seconds from WS cache — no more 30s REST poll

## 2026-06-15 (session 20) — Bzila Home Page + Greeks Fix + Keepalive Infrastructure

### `app/home/page.tsx` *(new)*
- New personal trading dashboard landing page at `/home`
- Greeting header (Good Morning/Afternoon/Evening, Bzila) with live SPX sparkline
- Date/time card with ET clock, market open/closed badge, live SPX price + % change, ES futures price
- Performance ring (win rate donut, trade counts)
- Session timer with dual-arc ring counting down to 16:00 ET
- Market bias card pulling net GEX from `/api/gex` with sparkline decoration
- Today's Focus interactive checklist (click to toggle done/pending)
- Weekly P&L bar chart with day labels
- Trading Tools 2×3 grid linking to existing pages (Heatmap, Opt Flow, Ladder, Quotes, Levels, Snapshot)
- All in existing dark theme (`#05080d`, `#00e5ff`, `#0a0e14`)

### `app/options-chain/page.tsx`
- Added `normalizeSide()` to map hyphenated TT REST field names (`implied-volatility`, `open-interest`) to normalized JS names (`iv`, `oi`, `delta`, `gamma`, `theta`, `vega`)
- Fixed `buildStrikes()` to store normalized `LiveEntry` as `callTT`/`putTT` — Greeks were blank before because raw TT objects had wrong field names
- Added keepalive ping on mount + every 8 min to `/api/keepalive`
- Added `silentRestRefresh` — re-baselines Greeks from REST every 5 min for symbols without live WS data (`!d._ws`)

### `app/api/keepalive/route.ts` *(new)*
- Lightweight GET that pings `${PROXY}/proxy/api/health` to prevent Render cold starts

### `vercel.json` *(new)*
- Vercel cron every 10 min hitting `/api/keepalive` for server-side keepalive

### `Vanilla/proxy-tastytrade.js`
- Added `subscriptionLastSeen` Map + `touchSubscription()` + `pruneIdleSubscriptions()` — prunes option symbols idle >30 min every 10 min
- Added `GET /proxy/api/health` endpoint returning dxLink state, authorization status, subscription count, browser client count
- `touchSubscription(sym)` called in `POST /proxy/dxlink/subscribe` handler

### TypeScript Fix (`app/home/page.tsx`)
- Added `accent?: string` to `Ring` component prop signature to resolve build error

### Version
- Bumped through `2026.6.15-v70` → `v71` → `v72`

---


## 2026-06-15 (session 19) — TypeScript Type Fix: StrikeRow LiveEntry

### `app/options-chain/page.tsx`
- **Fixed TypeScript build error**: `StrikeRow` interface was typed `callTT`/`putTT` as `Record<string, unknown> | null`, but `normalizeSide()` returns `LiveEntry`
- Changed both fields to `LiveEntry | null` to match the actual return type
- Build now succeeds without errors

### Version
- Bumped to `2026.6.15-v72`

---

## 2026-06-15 (session 18) — Migrate sql.js → PostgreSQL (Render)

### Database (`lib/db.ts`)
- Replaced sql.js (WASM/SQLite) with `pg` Pool connecting via `DATABASE_URL`
- Rewrote `getDb()` to return a pg Pool instead of a sql.js Database instance
- Rewrote all table creation as a single `ensureAllTables()` using Postgres DDL (`SERIAL PRIMARY KEY`, `BIGINT`, `TIMESTAMPTZ`, `GREATEST`/`LEAST`)
- Rewrote `queryAll()` to convert `?` placeholders to `$1,$2,...` for pg
- Rewrote all insert/upsert functions to use `pool.query()` with `RETURNING id` instead of `last_insert_rowid()`
- `persistDb()` is now a no-op (pg writes are immediate)
- SSL configured to skip cert verification for non-localhost connections

### API Routes
- `app/api/es-stats/route.ts` — replaced `db.run()`/`db.exec()` with `pool.query()`
- `app/api/snapshots/route.ts` — replaced sql.js exec pattern with pg queries
- `app/api/snapshots/[id]/route.ts` — replaced sql.js exec pattern with pg queries
- `app/api/debug/route.ts` — rewrote to use pg; lists tables via `pg_tables`
- `app/api/debug/write-test/route.ts` — rewrote to use pg
- `app/api/db/route.ts` — replaced `ORDER BY rowid DESC` with `ORDER BY id DESC` (rowid is SQLite-only)

### Config
- `next.config.ts` — removed `serverExternalPackages: ["sql.js"]`
- `package.json` — replaced `sql.js@^1.12.0` + `@types/sql.js` with `pg@^8.11.3` + `@types/pg`
- `.env.local` — replaced `DB_PATH` with `DATABASE_URL` (Render internal Postgres URL)

### Version
- Bumped through `2026.6.15-v67` → `v68` → `v69`

---

## 2026-06-15 (session 17) — Database Page Fixes + Options Chain Auto-Load

### Database Page (`app/database/page.tsx`)
- Fixed `dateFilter` state initialization: was passing function reference `todayET` instead of calling it `todayET()` — caused undefined state

### Options Chain Page (`app/options-chain/page.tsx`)
- Moved `loadChain` callback before `fetchExpirations` to resolve dependency order issue
- Updated `fetchExpirations` to auto-load chain when expirations are fetched and default expiry is selected
- Added `loadChain` to `fetchExpirations` dependency array
- Fixed useEffect hook to properly pass `fetchExpirations` dependency

### SQL.js WASM Initialization (`lib/db.ts`)
- Simplified `initSqlJs()` initialization with memoized `_SQLPromise` to prevent multiple concurrent initializations
- Added error handling wrapper around sql.js init with console logging
- Attempted fixes: wasmBinary buffer slicing, locateFile callback, direct initSqlJs() call
- Current state: still experiencing "Cannot set properties of undefined (setting 'exports')" — likely a module loading or WASM file access issue

### Version
- Bumped to `2026.6.15-v62`

---

## 2026-06-15 (session 16) — Dashboard Consolidation + Performance Optimization

### Performance & Architecture
- **Unified server deployment**: Consolidated proxy server into single Node.js instance via `server-with-proxy.js` (spawns proxy as child process on port 3001, Next.js on 3002)
- **Deferred API calls**: Removed blocking API calls from page initialization across `estimated-moves.js`, `options-chain.js`, `mult-greek.js`, `quotes.html` — all data now loads on user interaction
- **Load time impact**: Pages now render immediately without waiting for batch API calls

### API Route Fixes
- **`app/api/[...proxy]/route.ts`**: Fixed TypeScript `response` type errors by explicitly typing as `Response` and renaming to `proxyResponse` to avoid type union issues in Promise.race
- **GET/POST/DELETE handlers**: Consistent variable naming and proper error handling with fallback to remote proxy if local unavailable
- **Timeout handling**: Added 3s timeout for local proxy calls before attempting remote fallback

### Server & Configuration
- **`server-with-proxy.js`**: Custom Node.js server that spawns vanilla proxy as child process; graceful error handling and logging; skips proxy startup on Render production (API routes handle routing instead)
- **`lib/proxy/auth.ts`**: Token refresh logic with file persistence; TastyTrade API calls use in-process tokens
- **`lib/proxy/config.ts`**: Configuration management for token state and refresh token environment variables

### Package Updates
- Updated `package.json` scripts: `start` now runs `node server-with-proxy.js` for unified deployment
- Version bumped to `2026.6.15-v49`

### User-Facing Changes
- ✅ Dashboard loads instantly without initial API delays
- ✅ Faster page transitions and interaction response
- ✅ Maintained real-time WebSocket data streams (GEX, quotes, snapshots)

---

## 2026-06-15 (session 15) — GEX Chart Zero Line + Countdown Timer + Page Cleanup

### `components/dashboard/GexChart.tsx`
- **Zero line restored**: re-enabled zero-crossing line and shading that was previously removed
- **GEX flip line auto-compute**: if `flipPoint` prop or `gexProfile.flipPoint` is null, now computes from zero-crossing position to display "GEX FLIP" marker automatically

### `components/shared/QuotesPanel.tsx`
- **30-second countdown timer**: added `countdown` state tracking next Greeks/price update
- **Display**: shows time + countdown (e.g., "12:14:07 30s") in quotes header
- **Color coding**: countdown turns orange at 5s, red at 0s
- **Auto-reset**: timer resets every 30s even if no data arrives, maintains continuous countdown

### `app/insights/page.tsx`
- **Fixed page loading hang**: moved `mountedRef` declaration to component level (was being declared twice, causing initialization order issues)
- **WebSocket cleanup**: added `mountedRef` checks in WS onopen/onmessage/onerror to prevent updates after unmount
- **Greeks throttling**: ensured 30-second fetch interval (no change to existing logic, just cleanup)

### `components/shared/TopBar.tsx`
- **Navigation cleanup**: removed "Dashboard", "ES Candles", and "Bzila Flow" from NAV_ITEMS
- Removed href: `/dashboard`, `/es-candles`, `/bzila`

### Cleanup
- Pages to manually delete:
  - `app/dashboard/page.tsx`
  - `app/es-candles/page.tsx`
  - `app/bzila/page.tsx`

### Version
- Bumped to `2026.6.15-v44`

---

## 2026-06-15 (session 14) — TopBar SPX Price Fix + ES Front Month Rollover

### `components/shared/TopBar.tsx`
- **SPX showing `—`**: on-connect WS cache replay was sending compact array format `['Quote',[sym,...]]` which TopBar's object-format parser couldn't read. Fixed proxy to send proper object format.
- **Added `"$SPX"` to WS symbol check** — dxFeed sometimes returns `eventSymbol: '$SPX'` instead of `'SPX'`; both now handled.
- **After-hours SPX = ES bug**: spread formula was using `esPrev` as `esClose` fallback, making spread ≈ 0 → SPX displayed same as ES. Fixed to only apply spread when today's 4pm closes (`C.es`, `C.spx`) are available.
- **Weekend close seed**: `loadTodayCloses` now accepts Friday's closes on weekends (checks `lastTradingDayStr()` not just today). On cold weekend load, fetches `savedDailyCloses` from proxy (`/api/prev-closes`) to populate `closesRef` so ES→SPX spread works.
- **`saveTodayCloses`** accepts optional `date` param so server-sourced Friday closes are stored with the correct date.
- **`__gexAppState.spotPrice`** write/read ordering fixed — fallback now reads before writing.

### `Vanilla/proxy-tastytrade.js`
- **ES front-month rollover (June → September)**: added `/ESU26` and `/NQU26` to `CORE_LIVE_SUBSCRIPTIONS` so proxy subscribes the active September contract directly.
- **`getDxCacheAliases`**: added `/ESU26` and `/NQU26` as aliases so any event arriving under either symbol populates the shared cache key.
- **`dxFallbackMap`** in quotes-batch: `/ES:XCME` now falls back to `/ESU26`, `/NQ:XCME` to `/NQU26` when continuous-contract cache is empty.
- **On-connect cache replay**: Quote/Trade now sent as object format (with `eventType`/`eventSymbol`); added `$SPX`/`/ESU26`/`/NQU26` alias lookups.

### `app/api/prev-closes/route.ts` *(new)*
- Proxies `GET /proxy/api/tt/prev-closes` — exposes proxy's disk-persisted `savedDailyCloses` (ES/SPX/VIX 4pm closes) to the Next.js client.

### `app/page.tsx`
- Polls `window.__gexAppState.spotPrice` (written by TopBar) as fallback for GexChart `spotPrice` when page WS hasn't received an SPX tick yet.

### Version
- Bumped to `2026.6.15-v24`

---

## 2026-06-15 (session 13) — Multi Greek Page: GO Button Fix + Proxy Speed

### `app/mult-greek/page.tsx`
- **GO button was a no-op**: `loadAll` had `strikes` and `spots` in its `useCallback` dep array — stale closure caused every call after initial load to silently use an outdated function. Fixed by removing state deps; functional updater pattern (`setStrikes(prev => ...)`) used instead.
- **`activeExpiryRef`**: added ref to track active expiry without closure staleness; `doRefresh` now reads from ref instead of state.
- **Error visibility**: when all 3 ticker fetches fail, status now shows `PROXY ERR 502` instead of silently reverting to CLOSED.
- **Partial success**: if only some tickers succeed, status shows `PARTIAL (N/3)` and existing data is preserved for failed tickers.
- **Cache busting on manual refresh**: Refresh Now button sends `noCache=1` to bypass proxy chain cache (prevents stale 3-4 strike results from a poisoned cache entry).

### `Vanilla/proxy-tastytrade.js`
- **`noCache` param**: chains handler now respects `?noCache=1` — bypasses both in-memory and SQLite chain cache for fresh fetch.
- **Fast path when expiration is explicit**: skip the `/option-chains/:sym/nested` round-trip (known root symbols hardcoded: `SPX→SPXW`, `SPY→SPY`, `QQQ→QQQ`). Eliminates one serial TT API call per ticker.
- **Parallel fetch**: `fetchUnderlyingLast` and chain data now run in `Promise.all` instead of sequentially. Total latency for explicit-expiry chain fetch: 1 parallel round-trip instead of 3 serial ones — prevents Render 30s timeout 502s.

---

## 2026-06-14 (session 12) — Exposure Stack 24/7 Sessions + Expiry Dropdown Fix

### `Vanilla/pages/insights/exposure/exposure.js`
- **`drawRelativeVolumeSparkline`**: replaced hardcoded `SESSION_START/END/SPAN` with `getActiveSession()` — all RVOL samples now remapped to session-relative offsets (0 = session open), correctly handling night session (17:00→09:30 ET) that wraps midnight
- **x-axis labels**: dynamically computed from active session instead of hardcoded; night session shows 17:00 / 00:45 / 09:30 ET

### `Vanilla/pages/insights/exposure/exposure.html`
- Added IDs `rvol-xlabel-left`, `rvol-xlabel-mid`, `rvol-xlabel-right` to x-axis label spans so JS can update them per session

### `Vanilla/proxy-tastytrade.js`
- **`/proxy/api/greeks-intraday`**: when today has no records (weekend/market closed), falls back to the most recent date with data in SQLite — exposure stack now shows Friday's session on weekends instead of blank
- **Intraday Greeks broadcast (30s interval)**: removed Saturday/Sunday gate and 9:00–16:00 time window; now runs 24/7 as long as a spot price is available from dxLink (ES futures `/ESU26` added as fallback); old hardcoded `/ESM6` replaced with `/ESU26`
- **`/proxy/api/tt/expirations/:symbol`**: added cache fallback — if TT nested API call fails (auth/network), derives expiration dates from `chains_cache` SQLite table so dropdown still populates from cached data

### Version
- Bumped to `2026.6.14-v31`

---

## 2026-06-14 (session 11) — Options Chain Fixes + MD File Consolidation

### `app/options-chain/page.tsx`
- **Range % filter now works**: added `hasData()` check inside the range filter — empty dense-fill rows (no callTT/putTT/live data) are excluded, so ±3%/5%/10%/etc. now properly narrows the visible strikes
- **Net greek columns show `--` instead of `+$0.00M`** for rows with no data: added `hasAnyData` guard; empty rows render `--` with transparent background instead of zeroed-out colored cells
- Both fixes apply to the `filtered` useMemo and the row render in `ChainTable`

### MD File Consolidation (`Vanilla/md files/`)
- Moved `Vanilla/QUOTES_PANEL_README.md` → `Vanilla/md files/QUOTES_PANEL_README.md`
- Moved `Vanilla/assets/ES_FUTURES_CANDLESTICK_MAP_HOWTO.md` → `Vanilla/md files/ES_FUTURES_CANDLESTICK_MAP_HOWTO.md`
- Moved `COMPLETION_REPORT.md` (repo root) → `Vanilla/md files/COMPLETION_REPORT.md`

## 2026-06-14 (session 10) — ES Stats Ladder: Remove Google Sheets, Wire SQLite

### `EsStatsLadder.tsx` (`components/dashboard/EsStatsLadder.tsx`)
- **Removed Google Sheets dependency entirely** — no more `SHEET_ID`/`SHEET_URL`
- **Removed VAH, VPOC, VAL rows** from the ladder
- **Added MID row** (sourced from No Short No Long Zones tab: `(HIGH + LOW) / 2`)
- Now fetches from `/api/es-stats` (Next.js SQLite route) instead of Google Sheets
- Rows sort dynamically by price (descending); current ES spot (`ES NOW`) inserted inline
- `valueKey` fields changed to snake_case matching SQLite column names (`no_long`, `up`, `mid`, `down`, `no_short`)

### `app/api/es-stats/route.ts` (existing — verified correct)
- GET returns latest row from `es_stats` SQLite table
- POST does partial upsert: `ON CONFLICT(expiration) DO UPDATE SET ... CASE WHEN excluded.x IS NOT NULL`
- Allows Est. Moves tab and Zones tab to write independently without clobbering each other

### `EstimatedMoves.tsx` (`components/dashboard/EstimatedMoves.tsx`) (existing — verified correct)
- After running Est. Moves: POSTs `{ expiration, up, down }` to `/api/es-stats`
- After running Zones tab: POSTs `{ expiration, no_long, no_short, mid }` to `/api/es-stats`
- Mid = `(esm.high + esm.low) / 2` from ESM6 zone levels

### Root cause identified
- `EsStatsLadder.tsx` was the blocker — it was still calling Google Sheets on every load, never touching SQLite
- Now all reads and writes go through the same `/api/es-stats` Next.js route backed by sql.js (WASM) on Render persistent disk

## 2026-06-14 (session 9) — Economic Calendar Overhaul + Nav Restore

### Economic Calendar Full Page (`app/economic-calendar/page.tsx`)
- Complete rewrite to match target layout: left column (day label + time), right column (impact·country badge, bold title, A/F/P values)
- Multi-select filter dropdown — checkboxes for High·USD, High, Medium, Low, All (can combine e.g. High·USD + Medium simultaneously)
- Google Sheets daily quote fetched from `/api/calendar-quote` and displayed italic below header
- All blue/muted text replaced with white
- Larger fonts throughout (title 15px, time 13px, date headers 14px, impact 11px)
- Date section headers with TODAY badge for current day
- Removed all Trump calendar references — FF data only

### EconCalendarPanel (`components/dashboard/EconCalendarPanel.tsx`)
- Full rewrite to match same layout as full page (left time/day column, right content column)
- Multi-select filter dropdown (same High·USD + High + Medium + Low + All)
- Google Sheets daily quote block below header
- Stale events (>30 min past) faded to 32% opacity, pushed below divider
- 60s interval tick for live stale detection
- Removed dead `/api/trump-calendar` fetch — FF-only data
- White text throughout, bigger fonts (title 12px, time 11px)

### New API Route (`app/api/calendar-quote/route.ts`)
- Proxies `/proxy/api/quote-of-day` from Vanilla through Next.js
- 1hr revalidation cache

### TopBar Nav (`components/shared/TopBar.tsx`)
- Restored "Econ Calendar" → `/economic-calendar` at top of NAV_ITEMS (had been removed in session 8)

### Version
- Bumped to `2026.6.14-v13`

## 2026-06-14 (session 8) — Bug Fixes, Calendar Enhancements, Quotes Panel

### Options Chain (`app/options-chain/page.tsx`)
- Fixed % range dropdown not filtering — `filtered` useMemo now depends on `renderTick` instead of `liveData` ref (which never changes identity)
- Added `useEffect` to bump `renderTick` on `rangePercent` change so filter applies immediately

### Multi-Greek (`app/mult-greek/page.tsx`)
- Auto-loads on mount when expirations are ready — no need to click GO manually

### Econ Calendar Page (`app/economic-calendar/page.tsx`)
- Fixed background color to `#05080d` (was using CSS vars that rendered as pure black in some contexts)
- Events now show next 7 days (rolling window from today) instead of Mon–Fri current week only

### EconCalendarPanel (`components/dashboard/EconCalendarPanel.tsx`)
- Same 7-day rolling window fix applied to Overview panel
- Added "POTUS" option to impact filter dropdown
- Added "President" purple (`#a855f7`) impact color

### Trump Calendar (`app/api/trump-calendar/route.ts`) — NEW
- New API route fetching `https://media-cdn.factba.se/rss/json/trump/calendar-full.json`
- Filters out "executive time", "pool call", "in-town pool" noise events
- 30-min in-memory cache
- Events tagged with `impact: "President"` and rendered in purple

### Calendar Merge (both Econ Calendar page + EconCalendarPanel)
- Both now fetch ForexFactory + Trump calendar in parallel and merge/sort by date+time

### Quotes Panel (`components/shared/QuotesPanel.tsx`)
- Expanded to fill full sidebar height via flex layout
- Row height slider at bottom (16–56px) for adjustable density
- Font size scales with row height

### Sidebar (`components/shared/Sidebar.tsx`)
- Wrapper div changed from `overflowY: auto` to `display: flex, flexDirection: column` so QuotesPanel can fill available space

### Nav Cleanup (`components/shared/TopBar.tsx`)
- Removed "Quotes", "GEX Ladder", "Econ Calendar" from NAV_ITEMS
- `app/quotes/page.tsx` — redirects to `/`
- `app/gex/page.tsx` — redirects to `/`
- `app/top10/page.tsx` — redirects to `/`

### push-to-github skill (`skills/push-to-github/SKILL.md`)
- Updated to auto-read package.json, compute version, bump it, and output ready-to-paste PowerShell block

### Version
- Bumped to `2026.6.14-v11`

## 2026-06-14 (session 6) — UI Polish: Chevron Buttons, Sidebar, TopBar, Heatmap

### Sidebar (`components/shared/Sidebar.tsx`)
- Replaced scrolling ticker with static sorted list (highest % → lowest, nulls last), live via WS + REST seed
- Background fixed to `#05080d` on both collapsed and expanded states to match the GEX chart
- QuotesPanel + DailyEmPanel now fill the sidebar from the top (no empty spacer gap)
- Collapse/expand buttons replaced with bare chevron SVG (no border box)

### TopBar (`components/shared/TopBar.tsx`)
- Removed empty ROW 2 strip — only renders when Peak GEX data is present
- Page selector dropdown temporarily removed then restored (with `useRouter`/`usePathname`/`NAV_ITEMS`)

### GEX Toolbar (`components/dashboard/GexToolbar.tsx`)
- Replaced +/− expand/collapse buttons with a single chevron button (rotates 180° on toggle)
- Collapse now hides only the toolbar controls — chart stays visible at full height
- New props: `chartOpen: boolean`, `onToggleChart: () => void`
- Removed unused `useCallback` import

### Overview Page (`app/page.tsx`)
- Added `gexToolbarOpen` state wired to GexToolbar chevron
- Removed thick 16px heatmap divider — heatmap has no left border
- Heatmap collapse/expand chevrons use same bare-chevron style with 180° rotation
- Collapsed heatmap shows slim 20px re-open tab

### Version
- Bumped to `2026.6.14-v15`

## 2026-06-14 (session 5) — Sidebar Collapse Rail + Toolbar Cleanup

### GEX Heatmap Column Layout
- `components/dashboard/GexHeatmap.tsx` — narrowed strike column `80px → 68px`; changed column headers and data cells from `textAlign: right` to `center`

### Sidebar Version Number
- `components/shared/Sidebar.tsx` — added version footer pulled dynamically from `package.json` via `resolveJsonModule` import; displays at bottom of sidebar

### Sidebar Nav Removal
- `components/shared/Sidebar.tsx` — removed all page nav links (superseded by TopBar dropdown); sidebar now contains only QuotesPanel, DailyEmPanel, and version footer

### Sidebar Collapse Rail
- `components/shared/Sidebar.tsx` — full rewrite: collapsed state renders a 36px rail with `▶` expand button, live vertical auto-scrolling price ticker (`CollapsedTicker`), and tiny version label; `onOpen` prop added
- `components/shared/LayoutShell.tsx` — sidebar always mounted on desktop; passes `collapsed={!sidebarOpen}` and `onOpen` instead of hiding with `display: none`; mobile behavior unchanged

### TopBar Cleanup
- `components/shared/TopBar.tsx` — removed "Current MVC" and "GEX Flip" from Row 2; Row 2 now shows Peak GEX only; moved `SnapButton mode="share"` to Row 1 (before Save Snap and logo)

### GEX Chart Expand/Collapse Buttons
- `components/dashboard/GexToolbar.tsx` — added `onExpandChart` / `onCollapseChart` props; rendered as `+` / `−` icon buttons (inline SVG, cyan accent, `#0a1628` bg, hover state) right of toolbar
- `app/page.tsx` — wired `onExpandChart` (+10% splitPct, max 85%) and `onCollapseChart` (−10%, min 15%) to toolbar

## 2026-06-14 (session 4) — Mobile + UI Polish

### Mobile Responsive Layout
- `app/layout.tsx` — added viewport meta tag; swapped sidebar+main for `<LayoutShell>`
- `components/shared/LayoutShell.tsx` (new) — client wrapper: sidebar is a fixed overlay on mobile with backdrop, floating `☰` FAB when closed; sidebar collapses on all screen sizes via `◀` button inside sidebar header
- `components/shared/Sidebar.tsx` — accepts `onClose`/`isMobile` props; always shows `◀` collapse button at top; nav links close sidebar on mobile tap; removed duplicate "Econ Calendar" nav entry
- `components/shared/TopBar.tsx` — Row 1 uses `flexWrap: wrap`; Row 2 gets `topbar-row2` class (hidden on mobile via CSS)
- `app/globals.css` — `@media (max-width: 767px)` breakpoint: hides Row 2, stacks overview page vertically, makes main scrollable, hides resize handle
- `app/page.tsx` — adds `overview-root` class for CSS targeting

### Heatmap Panel Collapse Tab
- `app/page.tsx` — replaced 4px resize divider with 16px border strip containing a centered `▶/◀` tab button; heatmap panel animates open/closed (`width` transition); arrows only visible on hover via CSS

### Heatmap Toolbar Collapse
- `app/page.tsx` — intensity slider toolbar now collapsible via `▲/▼` toggle; collapsed state shows slim 22px bar with label + current intensity value; arrow only visible on hover

### Vertical Drag Resize — Chart vs Bottom Panels
- `app/page.tsx` — replaced hardcoded `flex: "0 0 50%"` with `splitPct` state (default 50%); 5px drag handle with grip dots between GEX chart and bottom panels (Calendar / ES Stats / Snapshot); draggable 15%–85% range

### TT LIVE Dropdown Button
- `components/shared/TopBar.tsx` — merged `● TT LIVE` badge and `⋮` button into single clickable button; amber when connected, muted when disconnected; opens existing status dropdown

### Page Nav Dropdown in TopBar
- `components/shared/TopBar.tsx` — added `<select>` page navigator in Row 1; auto-selects current page via `usePathname`; navigates on change via `useRouter`

## 2026-06-13 (session 3)

### ES Stats Ladder — Current Price Row in Timeline
- `components/dashboard/EsStatsLadder.tsx` — added "ES NOW" row sourced from `esSpot` prop (same `spotPrice` state already passed from `app/page.tsx`)
- All rows (5 levels + spot) are now sorted descending by value so the current price appears at its correct position in the ladder
- Spot row renders with a filled cyan dot, cyan label/value, and subtle cyan background tint — visually distinct from level rows
- Data wiring unchanged: `esSpot` prop is already fed by the same WebSocket-backed `spotPrice` used by the GEX toolbar

## 2026-06-13 (session 2)

### Built Dynamic Economic Calendar via Next.js API
- Created `app/api/econ-calendar/events.json` — persistent data file, source of truth for all pages
- Created `app/api/econ-calendar/route.ts` — GET serves events.json; POST writes new events to disk
- Updated `Vanilla/pages/overview/overview.js` — `ECON_EVENTS` now fetched from `/api/econ-calendar` on load instead of hardcoded
- Updated `Vanilla/economic-calendar-importer.js` — after parsing JSON or OCR screenshot, POSTs events to API to persist permanently; falls back gracefully if server write fails

### Updated Economic Calendar (overview.js)
- Replaced week of June 8–12 events with June 15–19 week
- **Mon Jun 15:** Empire State Mfg Survey, Industrial Production, Capacity Utilization, NAHB Housing Index
- **Tue Jun 16:** Housing Starts, Import Prices
- **Wed Jun 17:** Retail Sales, Mfg & Trade Inventories, Pending Home Sales, U.S. Interest Rate Decision
- **Thu Jun 18:** Weekly Jobless Claims, Philly Fed Business Outlook, Leading Indicators
- **Fri Jun 19:** No events scheduled
