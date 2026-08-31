# Changelog

## 2026-08-31 - fix: phone candles crashed on render (black screen)

Edited: `components/mobile/pages/MobileEsCandles.tsx`.

`/app/m/es` was a black screen on the live site. It was not the feed, the data
or the layout - the component threw on every render:

    ReferenceError: levelLines is not defined
        at MobileEsCandles-C3jrEs5u.js:1:13210

Mine, from the SPX change. Rewriting `overlayCount` to drop the basis gate, I
referred to the level-lines memo as `levelLines`; it is called `levels`. A
ReferenceError in a component body takes the whole subtree down, and this page
IS the subtree, so the route rendered nothing at all. Desktop was untouched
because nothing outside the phone build imports this file. One word:

    (showLevels && levelLines.length > 0 ? 1 : 0)   ->   levels.length

**Why it shipped.** esbuild was the only check run on these edits, and esbuild
does not resolve identifiers - it parses and emits. An undefined name is
invisible to it. Every file touched in this session has now been run through
`tsc --noEmit --noResolve` (which type-checks local scope without needing the
project's node_modules, unavailable in this environment) and that check is what
found this. Result: this one error, nothing else, across the phone page, the
bubble hook, `useEsCandles`, `gexSocket`, `mobileNav` and all four v3 files.

## 2026-08-31 - LSE Data: London Strategic Edge vault on the owner dashboard

Ported `futures_data_downloader.py` (the interactive LSE CLI) into the Node
stack so the pulls run from `owner.cbedge.net` instead of a laptop terminal.
No Python was added to the image: the `lse-data` SDK is a thin wrapper over a
plain HTTP API, so we speak that API directly.

**Backend - `server-v2/_lib-lse.cjs` (new).** Vault client, read straight out of
`lse/client.py` + `lse/vault.py` so rows match the Python call-for-call.
Base `https://api.londonstrategicedge.com/vault`, `x-api-key` header, and an
explicit User-Agent (the CDN in front of the vault 403s the default one - do
not remove it). Covers `/catalog`, `/meta`, `/candles`, `/options/chain`,
`/options/flow`, `/options/candles`, plus the SDK's name resolution
("apple" -> AAPL, prefix match first then shortest name) and OSI contract
assembly.

- **The 5,000-row cap is the whole design.** Every vault call is capped, so
  "download all the history" is a walk, not a request. `pageCandles()` /
  `pageOptionsFlow()` are async generators that page on the time cursor and
  dedupe the seam row (`start` is inclusive), yielding page by page so the
  route can STREAM CSV instead of buffering a decade of 1m bars in the heap.
- `maxRows` is a seatbelt, not a feature - without it a fat-fingered
  "1s since 2003" walks for hours. The response says when it trips.

**Backend - `server-v2/api-router.js`.** Eight owner-gated routes appended as a
new top-level block (the module is `require`d defensively like every other
`_lib-*.cjs`; no module = no routes, rest of the router untouched):

| Route | What |
|---|---|
| `/api/lse/status` | key present + vault reachable |
| `/api/lse/catalog` | symbols, datasets, history spans (`?datasets=1` for the picker) |
| `/api/lse/candles` | OHLCV; `start=MAX` reads first_tick from the catalog |
| `/api/lse/options-chain` | IV, greeks, day volume/premium |
| `/api/lse/options-flow` | the print tape |
| `/api/lse/option-candles` | 1m bars for one contract (OSI or by parts) |
| `/api/lse/resolve` | name -> ticker |
| `/api/lse/timeframes` | the resolution list |

`format=csv` on any of them returns a download; `all=1` on candles/flow walks
the whole range. No proxy file was touched - `server-with-proxy.js`,
`proxy-tastytrade.js` and `proxy-thetadata.js` are unchanged.

**Frontend - `owner-vite/src/pages/LseData.tsx` (new), at `/owner/lse-data`.**
The CLI's menu became a tab strip (Catalog / Candles / Options Chain /
Options Flow / Contract Candles), its `input()` prompts became fields, and
`save_to_csv()` became a Download CSV button that navigates to the same URL
with `format=csv` - so the browser streams the file to disk and a big pull
never enters the tab's memory. Preview caps at 300 rows. All colors and
surfaces come from `owner-vite/src/lib/theme.ts`; nothing is hardcoded.

**Filter bar alignment (same day).** The first pass sized each control to its
content and aligned the row on `flex-end`, so a field with a hint sat lower
than one without and the labels staggered across the row. Now one
`CONTROL_H` (40px) for every input, select, checkbox and button, a
fixed-height label block, and the row aligned to the TOP - labels share a
line, inputs share a line, and a hint can wrap to two lines without moving
anything above it. The two "walk the whole range" checkboxes became a
`CheckField` that fills one control slot and turns cyan when checked, and
the buttons ride the same label+control grid instead of the bottom of
whichever field happened to be tallest.

**Dropdowns and text contrast (same day).** A native `<select>` draws its
popup with the OS widget, so on Windows the open list was a light-grey menu
hanging off a dark control. `color-scheme: dark` on the select is what
Chrome honours there (it repaints the popup, its scrollbar and the
highlight row), with explicit per-`<option>` colors as the fallback, and
`appearance: none` plus an inline SVG caret so the arrow is themed rather
than a grey OS triangle. Every translucent-white text color on the page
(labels, hints, table headers, result counts) is now full `OWNER_THEME.text`
- the theme already declares `textMuted`/`textSecondary` as `#FFFFFF`, so
this page was the odd one out. Input placeholders keep the browser's grey,
deliberately: a placeholder that matches typed text reads as a value.

**Symbol picker + OSI builder (same day).** Two things the CLI made you guess.

- **`SymbolPicker`** - a type-ahead over `/api/lse/catalog` on the Symbol
  and Underlying fields. Guessing between `ES`, `ESU6`, `ESU26`, `ES=F` and
  `ESc1` is exactly the 404 the Python printed a four-line hint about, and
  futures are only 69 rows - so the fix is not a better hint, it is showing
  the list. Each row is symbol, name and the `first -> last` history span,
  and picking one writes the exact catalog string. Scoped by dataset:
  Candles follows the Dataset picker, the option tabs are pinned to
  `options` so an economics series can't shadow a company. Debounced 220ms
  (the filter runs server-side over 22k rows).
- **The OSI ticker is now built, not typed.** Contract Candles leads with
  Ticker / Expiry / Strike / Type and renders the assembled OSI live
  underneath with a Copy button - root, `YYMMDD`, `C`/`P`, strike in
  thousandths padded to eight. `AAPL` + `2026-06-12` + `205` + call ->
  `AAPL260612C00205000`. The paste box now runs the transform BACKWARDS:
  drop an OSI in and it splits into the four fields and empties itself, so
  the parts stay the single source of truth. The request still sends the
  PARTS, not the rendered OSI - the server is the side that can resolve a
  company name to its ticker before assembling the contract.
- A zero-row result now says what to do about it ("the vault matches the
  symbol literally - use the exact string the Catalog lists") instead of
  falling back to the generic "set the filters" copy as if nothing had run.

**Themed calendar + an honest status banner (same day).**

- **`DateField`** replaces every date input (Candles start/end, chain
  expiry, flow start/end, contract expiry). `<input type="date">` was the
  first cut, but its popup belongs to the browser - `color-scheme: dark` is
  the entire extent of the control you get over it, so it never matched the
  surfaces around it. This draws the month from the theme's own tokens:
  same panel, same border, same cyan, with Today / Max history / Clear in
  the footer. The text input stays editable because Candles' start accepts
  the literal `MAX`, which no calendar can express.
  Dates format via a local-time `ymd()`, never `toISOString()` - the latter
  shifts to UTC and returns YESTERDAY for anyone west of Greenwich after 7pm.
  Click-away is a fixed backdrop, not the input's blur: the calendar's own
  buttons are focusable and blur would close it out from under the click.
- **The status banner no longer lies.** It reported "LSE_API_KEY is not
  set" for ANY failure of `/api/lse/status`, including the case where the
  request never reached the route and the SPA fallback answered with HTML -
  which sent you to the VPS to fix an env var that was already correct.
  `StatusState` is now a union and the four cases read differently:
  missing key, vault unreachable, owner gate refused (401/403), and
  "the running build does not have these routes yet" (non-JSON body) -
  the last one saying in as many words that it is a deploy, not a key.

**Dropdowns were painting UNDER the card below them (same day).** Not a
missing z-index on the popup - `classicCardStyle` carries
`backdrop-filter: blur(16px)`, and a backdrop-filter creates a STACKING
CONTEXT. That makes each card an atomic layer, so the popup's z-index only
ordered it against its siblings INSIDE the filter card, while the results
card below - a later sibling with its own stacking context - still painted
over the whole thing. Raising the popup further would never have worked.
The fix is at the layer that actually competes: the filter card is now
`position: relative; z-index: 30` and the cards after it sit at 1, so
everything the filter card contains outranks them.

- `owner-vite/src/lib/nav.ts` - "LSE Data" added to the **Market** group.
- `owner-vite/src/pages/registry.ts` - lazy route registered.

**Setup.** The key lives in `LSE_API_KEY` in `.env.local` (git-ignored, mounted
at runtime, never baked into the image or shipped to the browser). It must be
added on the VPS too - `.env.local` does not travel through GitHub. Until it
is, the page shows a red banner saying exactly that instead of five identical
503s. The key that was hardcoded in the original .py should be rotated.

## 2026-08-31 - v3 board: Key Levels heading, new Net Premium card, real Flow Tape

Three board changes, all in `cbedge-v3`.

**1. Key Levels now says which ticker and which contract.** The card header
reads `AMZN - Key Levels - 8-31-26` instead of a bare "Key Levels".

- `cbedge-v3/src/board/cardTitle.tsx` (new) - `fmtContractDate()` (ISO ->
  `M-D-YY`) and `<CardHeading>`, so every card that grows a contract date
  spells it the same way.
- `cbedge-v3/src/board/catalog.tsx` - `CardDef` gains an optional `Title`
  COMPONENT (not a render function - it holds hooks, and calling it inline from
  BoardPage would make them BoardPage's hooks, conditionally).
- `cbedge-v3/src/board/BoardPage.tsx` - renders `def.Title` in place of
  `def.label` inside the drag handle when a card supplies one.
- `cbedge-v3/src/board/keyLevels/KeyLevelsCard.tsx` - exports `KeyLevelsTitle`,
  split the same way the card is: SPX reads the socket's `gex.data.expiry`,
  every other ticker reads the front expiry of the same `/api/chains` URL the
  ladder was built from (deduped by useQuery, so it is one request). It can
  never name an expiry the axis was not built from.

**2. Net Premium - new card.** The /flow page's Net Drift chart, on the board.

- `cbedge-v3/src/board/netPremium/NetPremiumCard.tsx` (new) - same
  `NetDriftChart` component and same `/proxy/flow-netprem` aggregate the page
  uses, so the two cannot disagree. Follows the board's page ticker.
  Narrowed on purpose: **closest expiration only**, **OTM calls and puts only**,
  RTH span with no 24H toggle.
  A ticker the flow recorder has never seen gets an honest
  `<TICKER> - not available. Coming soon.` rather than an empty grid that reads
  as a quiet day.
- The one accepted hop: "the closest expiration" is not knowable until the tape
  says which expirations exist, so the bins request stays disabled until the
  expiry is known instead of firing an unscoped one that would be thrown away.
- `cbedge-v3/src/data/flowData.ts` - `useFlowHistory` seeds `switching` from
  `enabled` instead of `false`. With a `false` seed the very first render said
  "loaded, and empty", which flashed the not-available message on every mount.

**3. Flow Tape - the real one, with a min-premium slider.**

- `cbedge-v3/src/pages/flow/FlowTape.tsx` (new) - the fifteen-column print
  table lifted out of `pages/Flow.tsx` unchanged, so the page and the board card
  render the SAME table (all columns, tooltips, whale rows and the contract
  drawer). Two copies of a table this wide is two places for a column to go
  wrong.
- `cbedge-v3/src/pages/Flow.tsx` - imports it; ~215 lines and eight now-unused
  imports removed. No behaviour change.
- `cbedge-v3/src/board/flowTape/FlowTapeCard.tsx` (new) - replaces the old
  "Flow Tape (Net Premium)" sparkline card. Follows the page ticker (flow IS
  recorded per ticker via `/proxy/flow-history?underlying=`), merges live
  socket prints for the index, and exposes ONE control: a **Min Premium slider
  with six detents - Any / $50K / $100K / $250K / $500K / $1M**, defaulting to
  $100K and remembered per browser. The floor is pushed into SQL, so raising it
  makes the server's 20k-row cap keep the biggest prints of the session rather
  than the most recent slice. Everything else stays the page's default: both
  sides, both types, OTM only, every expiry. Card caps at 250 rendered rows.
- `cbedge-v3/src/board/catalog.tsx` - `flow-tape` keeps its id (saved boards
  survive), relabelled "Flow Tape" and resized to 12x12; `net-premium` added at
  8x12. Both are `lazy()` - the tape pulls the drawer, Net Premium pulls
  lightweight-charts, and neither belongs in the board's route chunk.

`tsc --noEmit` and `check:theme` clean. Run `npm run check` before pushing -
`perf` and `check:ws` are the two that catch what looks fine on screen.

## 2026-08-30 - v3: store subscribe hardened, ws-scope-check no longer crashes

`npm run check` failed at `check:ws` with `scope includes our subscribed types
(got ["gex","spot"])` - the test subscribes to `spot` AND `aux`, and `aux` was
missing from the derived scope - then the script died outright with an uncaught
`TypeError: fetch failed / ECONNRESET` before it could report.

- `cbedge-v3/src/data/store.ts` - `subscribe()` had a stale-generation bug in
  exactly the mechanism that derives `?topics=`. The returned unsubscribe closure
  captured a Set; if that Set emptied, the type was deleted from `listeners` and
  a later `subscribe()` for the same type installed a BRAND NEW Set. A stale
  closure from the first generation firing after that ran
  `listeners.delete(type)` and retired a type that had live listeners in the new
  Set - so the type left `activeTypes()`, left `desired`, and after NARROW_MS the
  socket reconnected without it. Nothing throws; the frames just stop. That is
  the v2 silent-stale-panel failure this whole system exists to prevent.
  The closure now compares identity (`listeners.get(type) === owned`) before
  retiring the type, which also makes a double-unsubscribe harmless.
  `notifyActiveTypes()` also moved to AFTER `set.add(fn)` so the type is never
  announced while its Set is still empty.
- `cbedge-v3/scripts/ws-scope-check.mjs` - `connections()` no longer throws. A
  mock server that exits mid-run is recorded as a normal failure with its errno
  instead of taking the script down with a stack trace and losing every
  assertion result. The scope assertion now names which topics are MISSING and
  prints the full scope history (`ALL -> gex -> aux,gex,spot -> gex,spot`),
  because "requested then narrowed away" and "never derived at all" are
  different bugs and the final scope alone cannot tell them apart.

Not yet re-run end to end here - `npm run check` on the laptop is the verdict.
If `check:ws` still fails, the printed scope history says which of the two it is.

## 2026-08-30 - v3: Journal retired too

Follow-on to the six-page removal below. `/v3/trading` is gone the same way:

- `cbedge-v3/src/App.tsx` - `lazy()` import and `<Route path="/trading">` removed.
- `cbedge-v3/src/shell/Shell.tsx` - `NAV` drops the Journal slot. The rail is
  now Home, Traders Dash, Premarket, Options Chain, Est. Moves, Analysis,
  Replay, Flow.
- `cbedge-v3/src/pages/TradersDashboard.tsx` - Journal out of `ALL_PAGES`,
  `/trading` out of `LIVE_ROUTES`.
- `cbedge-v3/src/pages/Journal.tsx` - emptied to a tombstone (`export {}`);
  `git rm` it.
- `app/v3/trading/route.ts` - 404 instead of the SPA shell; `git rm -r` the folder.

Backend untouched: `/api/journal` and `/api/journal/trades` still serve v2's
`components/pages/Trading.tsx` at `/app/trading`.

## 2026-08-30 - v3: six pages retired (Scanner, Test Lab, ICT, ES Candles, Board, Multi Greek)

Pages only. The Home board and every card in `cbedge-v3/src/board/catalog.tsx` -
including the Multi Greek, GEX Candles and Key Levels cards - are untouched.

Two of the six were real, built v3 pages and are gone:

- `cbedge-v3/src/App.tsx` - dropped the `lazy()` imports and the `<Route>`s for
  `/scanner` and `/test`.
- `cbedge-v3/src/pages/Scanner.tsx` and `.../TestLab.tsx` - emptied to a
  tombstone comment (`export {}`); nothing imports them. `git rm` both.
- `app/v3/scanner/route.ts` and `app/v3/test/route.ts` - the SPA shell handlers
  now answer 404 instead of serving a shell that would only render NotFound.
  Both folders are `git rm -r`-able.

The other four never had a v3 page - only a dimmed `comingSoon` rail icon and a
row in the destination picker. Those are gone too, so nothing advertises a page
that is not coming:

- `cbedge-v3/src/shell/Shell.tsx` - `NAV` drops `/mult-greek`, `/board`,
  `/es-candles`, `/scanner`, `/ict`, `/test`. The rail is now Home, Traders
  Dash, Premarket, Options Chain, Est. Moves, Analysis, Replay, Flow, Journal.
  A saved rail order containing a removed slot drops it silently - `loadOrder()`
  already filters against `NAV`.
- `cbedge-v3/src/pages/TradersDashboard.tsx` - same six out of `ALL_PAGES`,
  `/scanner` and `/test` out of `LIVE_ROUTES`, and the default Quick Link
  "Multi Greek" swapped for "Options Chain" (the default set has to point at
  routes that exist).

Not touched, deliberately: `src/data/scannerTickers.ts` (shared ticker universe,
read by Premarket and the board cards), the `'es-candles' -> 'gex-candles'` card-id
migration in `catalog.tsx`, and all of v2 - `components/pages/Scanner.tsx`,
`components/pages/TestLab.tsx`, `components/scanner/*`, `app/test/*` and the
`/app/*` routes are a separate app and still live.

Caveat: the local shell on this machine was down for this session, so the four
files above could not actually be deleted from disk - they were emptied or
turned into 404 handlers instead, each with a `git rm` line in its header.

## 2026-08-30 - v3 Analysis: parity inventory written (step 1 of the port, no code yet)

`cbedge-v3/docs/parity/analysis.md` (new, 359 checklist rows). The spec for
porting v2's `/app/analytics` to v3's `/v3/analytics`, written BEFORE any v3
code so the port is construction rather than re-deciding what the page contains.

Scope: `components/pages/Analytics.tsx` (3,445 lines) plus everything it
composes - `EconCalendarPanel` (mounted `todayOnly hideToolbar`), `computeAmt`
from `lib/failLevels`, `useEsCandles`, `useScannerTickers`, `useRefreshButton`,
`PageCard`, `homeTheme` and the `.analytics-grid` / global-collapse CSS.

Eighteen parts, one row per rendered value: page frame + embed mode, the shared
primitives (`Label`/`Value`/`Stat`/`fmtBig`/`useLiveData`/`CardState`/
`UpdatedStamp`), then all ten cards. Ticker Lookup takes six parts (~126 rows) -
controls, replay transport, identity line, both ladder panes, `TlLadder` itself,
the chips/read/disclaimer, and a maths part transcribing
`accumulateChainGreeks`, `tlLevelsFrom` (incl. the CB-collision rule and the
flip port of `findGexFlip`), `tlAtm`, `tlWindow` and `useTlAnchor` 1:1.

Things the inventory pinned that a rebuild would have lost:

- `POS_GREEN #22C55E` is page-local because `HOME_THEME.green` is a light blue.
  `T.green` is used exactly ONCE on the page - the "Confirmation triggers"
  section title.
- `useLiveData(null)` never clears `loading` (the guard returns before the
  `finally`), so every card that passes null gates on something else.
- The Delta 1D column stays OFF until a second EOD session lands - a column of
  zeros reads as "the board didn't move", not "we don't know yet".
- Unrecorded replay strikes render an em dash, never 0.
- Three comment-vs-code conflicts, code wins: MVC checkpoints are 9:45 (not the
  commented 9:35), `TL_CHIP_MIN_H` is 106 (comment computes 92), and the file
  header's "MOCK data" claim is stale.

Also recorded: the v3 starting point. `src/pages/Analysis.tsx` already ports
Estimated Move, Premarket, Confidence, Net Greeks and Strategy Builder; Ticker
Lookup, Multi Greek, Econ Calendar and Initial Balance are stubs, and Ticker
Levels regressed from v2's searchable/favourite/add-your-own picker to a fixed
four-pill row. That regression is the exact failure this document exists to
catch.

Next: review the inventory, then port the logic verbatim into `cbedge-v3/src/`
(step 2) - no v2 JSX, no `@/app/...` alias, no colour literals.

## 2026-08-30 - Weekly Edge: Estimated Move for Aug 24-28 (82.4%)

`lib/emails/weekly-edge.ts`. Real numbers replace the EM placeholder.

- Tile: 82.4%, sub "192-41 - 233 of 404 tickers scored".
- Tile colour back to green `#00E676` (it was red `#FF4757` for last issue's 41%).
  The colour tracks the week, not the metric.
- Core Board (17-3, 85.0%, 20 of 22 tickers) goes in the NOTE, not a third tile -
  the tile row stays a clean two-up and the second number reads better as prose
  next to the first.

THE POINT OF THE NOTE - 41.0% one week, 82.4% the next, on a VIX that stayed low
BOTH weeks. So "low vol" does not explain either number, and the letter should
not pretend it does. What changed is the RANGE:

- Week of 8/21: vol crush narrowed the bands while the tape kept covering the
  same distance -> price walked out of them early -> breaches -> 41.0%.
- Week of 8/28: SPX sat between the call and put walls all week -> the bands
  mostly held -> 82.4%.

Same model, different range behaviour. The note says so and points at the
wall-migration chart directly BELOW it, which is that story as a picture. If the
wall-chart section is ever reordered, the copy says "the chart below" and will
need fixing - there is a comment in `withDefaults()` flagging it.

The note also states outright that the prior week printed 41.0% and went in the
letter the same way. Keep that. The scorecard is only worth something if the bad
week and the good week get the same treatment, and naming the 41% in the middle
of an 82% week is the cheapest possible proof that they do.

Preview regenerated: `generated/2026-08-30-weekly-edge-preview.html` / `.jpg`.

REMAINING PLACEHOLDER: Core Bullseye tile, the confidence table, and
`resultsNote` are still bracketed - plus the scanner catch.

## 2026-08-30 - v3 Flow: parity inventory written (step 1 of the port, no code yet)

`cbedge-v3/docs/parity/flow.md` (new, 214 checklist rows). The spec for porting
v2's `/app/flow` to `/v3/flow`, written BEFORE any v3 code, in the same shape as
`parity/premarket.md` and `parity/traders-dashboard.md`: one row per rendered
value with its label, source endpoint + field, number format, threshold/colour
rule, sort order and empty/loading state.

- Scope: `components/pages/Flow.tsx` (1534 lines) plus everything it renders -
  `ContractDrawer.tsx` (515), `useContractStats.ts`, `lib/dislocationVelocity.ts`,
  `ThemedDatePicker`, and the `@media (max-width:899px)` block in `globals.css`
  that `.flow-root` / `.flow-topbar` / `.flow-filter-grid` opt into.
- 15 parts: page frame + URL params (`?chartonly`, `?ticker`, `?dteMax`), top bar,
  filters card, filter grid, Net Drift chart chrome, chart series/scales, the
  crosshair tooltip, Premium Split, Dislocation Velocity, Combined split, tape
  header, 16 tape columns, tape rows, ContractDrawer, and data plumbing.
- Every constant, formatter and threshold transcribed verbatim (WHALE_FLOOR 500K,
  CHART_MIN_PREMIUM 1K decoupled from the tape slider, BIN_SEC 60, NET_LATE_SEC
  900, MAX_TAPE_ROWS 800, the GRID track widths, fmtPremium/fmtStat/fmtContractCost/
  fmtSpot/fmtEtHm rules, the RTH vs 24H axis-bound maths).
- Appendix 1 records 10 v2 behaviours that are bugs, so the port makes a decision
  instead of silently reproducing or silently fixing them. Two are server-side:
  `parseFlowFilters()` in `server-v2/server-with-proxy.js` hardcodes `exIdx:false`
  and defaults `underlying` to SPX, so the Combined view's Premium Split and its
  tape-header totals are SPX-only numbers under an "All Tickers" heading.
- Appendix 2 records the v3 contract gaps that cost the last attempt its columns:
  `FlowTapePrint` carries no `symbol`, no `fills`, no `spot`, and types as
  `'call'|'put'` not `'C'|'P'`; there is no `useContractStats` equivalent, so
  Vol/OI/IV/%OTM and two drawer tiles have no source yet.
- The existing `cbedge-v3/src/pages/Flow.tsx` (30.5KB) is a prior port that
  resolved those gaps by dropping the Net Drift chart, the Vol/OI/IV columns, the
  dislocation-velocity card and the contract drawer. Flagged as a draft to finish
  against this checklist, not as the port.
- Route wiring for `/v3/flow` is already complete on all four steps (page, App.tsx
  route, Shell NAV entry, `app/v3/flow/route.ts`); the NAV entry has no `prefetch`
  URLs, which v3's no-waterfall rule wants.

No source files changed. Next step is review of the inventory, then the verbatim
logic port under `cbedge-v3/src/`.

## 2026-08-30 - Weekly Edge: wall-migration chart added to the results band

`lib/emails/weekly-edge.ts`. The 5-session wall-migration chart for Aug 24-28 now
sits in the results band, ABOVE the Core Wall auto-buy table. That order is the
argument: here are the walls, then here is what the wall bought inside them.

- New opts `showWallChart` (defaults TRUE), `wallChartUrl`, `wallChartHeadline`,
  `wallChartNote`, plus a matching plain-text block.
- Headline: "Five sessions, and price never left the walls". Note explains the
  colours (green call wall, red put wall, white spot, 391 min/session) and walks
  the week: chop between them Mon-Wed, walls stepping up ahead of the tape
  Thursday with the rally stalling into the call wall, Friday's spike tagging it
  and reverting same session. Closes with 7,711.48 spot vs 7,700 put / 7,720
  call.
- The note says the levels are RECORDED - written down at the time and
  timestamped, not redrawn afterwards. Keep that clause. A levels chart with no
  claim about when the levels were set is worth nothing as proof, and it is the
  one thing a sceptical reader will ask about first.

IMAGE: `public/wall-migration-2026-08-28.png` (1200x627, ~105 KB), served from
`https://cbedge.net/wall-migration-2026-08-28.png`.

DATED FILENAME, ON PURPOSE. A new chart ships every issue. A generic
`wall-migration.png` would be overwritten on the next push and would then
retro-change the art inside every previously sent letter still sitting in
subscribers' inboxes - last week's email would silently start showing this
week's chart. Date every issue-specific image. (The affiliate banner is
undated because it is evergreen; that is the exception, not the pattern.)

Preview regenerated: `generated/2026-08-30-weekly-edge-preview.html` / `.jpg`.

## 2026-08-30 - The Weekly Edge rebuilt for the week of Aug 31 - Sep 4

`lib/emails/weekly-edge.ts`. New issue. Markup reused; the data and one new
section changed.

Subject: "The Weekly Edge - Warsh put a September hike back on the table, and
jobs Friday decides it". Issue pill "Week of Aug 31 - Sep 4".

RECAP (Aug 24-28) - two events pulling opposite ways:
- NVIDIA Wed night: $96.2B revenue (~$4B past consensus), $89.0B data centre,
  guided ~70% revenue growth next FY vs 44% expected. Stock +~9% Thursday, best
  day since Apr 2025. CRM +~23%, CRWD +~21%.
- Friday: Warsh's FIRST Jackson Hole keynote as Chair - "predominant focus right
  now should be on prices". July PCE 3.7%, headline and core both UNCHANGED from
  June (stalled, not falling). September HIKE odds 35% -> 57%; short-end +~8bp.
- Index tiles are S&P +0.5% / Nasdaq +0.9% / RUSSELL 2000 -1.5%, not the usual
  Dow. The mega-cap-vs-small-cap gap IS the week; a flat Dow tile would hide it.
- Gold -3.3%, bitcoin -3.2% to ~$78k, VIX closed 14.35.

WEEK AHEAD - four labour prints then the jobs report: Chicago PMI/Dallas Fed Mon;
ISM Mfg + JOLTS Tue (DELL, PANW after); ADP + factory orders + Beige Book Wed
(AVGO, SNOW, HPE after); ISM Services + claims + Challenger Thu (LULU, DOCU
after); AUGUST JOBS REPORT Fri. Framing: seven days ago the argument was how big
the September cut would be, now it is whether they hike.

OIL - deliberately de-escalated. WTI ~$83.44, flat on the week, -1.2% on the
month. Market has re-rated Iran from imminent physical-supply threat to an
economic/sanctions confrontation; Goldman has Persian Gulf exports back at 15-16
mb/d (vs 22-24 pre-conflict, 5-6 at the March trough). Iran-Oman revenue-sharing
framework agreed, Tehran says that is not a reopening. Explicit line that crude
is no longer what sets overnight gap risk - the labour data is.

NEW SECTION - Core Wall auto buy (real data, gold box):

| Date  | CB    | Contract | Entry -> Peak    | Best  |
|-------|-------|----------|------------------|-------|
| 08-28 | 10:30 | 7750C    | $4.65 -> $25.15  | +441% |
| 08-26 | 12:00 | 7685C    | $1.83 -> $7.70   | +321% |
| 08-27 | 10:30 | 7730C    | $4.55 -> $14.20  | +212% |
| 08-27 | 9:45  | 7725C    | $6.95 -> $18.50  | +166% |
| 08-28 | 12:00 | 7720P    | $8.75 -> $23.00  | +163% |

Five of the fifteen the wall took. New `AutoBuyRow` type plus `showAutoBuy`,
`autoBuyRows`, `autoBuyNote` opts and a plain-text block.

TWO THINGS IN THAT SECTION ARE NOT DECORATION:
1. PEAK IS AN INTRADAY HIGH AFTER ENTRY, NOT AN EXIT. The note says so in bold.
   Presenting a peak column as realized P&L is the fastest way to make this
   letter dishonest - it is the difference between "what the wall bought" and a
   returns claim.
2. The note also gives the FULL fifteen: 6 peaked at 2x+, 14 traded above entry,
   and the 8/24 10:30 read (7630P) never ticked up at all. Printing five winners
   without that split is cherry-picking with extra steps.

DASHBOARD PLACEHOLDERS (all three render as dashed blocks, nothing stale ships):
- `DEFAULT_CONF_ROWS` emptied - confidence table is the dashed placeholder.
- Both result tiles "-" / "[fill before send]".
- `resultsNote` / `estMoveNote` are bracketed prompts.
- `showScannerProof` DEFAULT FLIPPED to `=== true` (was `!== false`) so the
  scanner card is OFF unless opted in; a new dashed "[ADD THIS WEEK'S SCANNER
  CATCH]" block renders in its place. Last week's MRNA card no longer leaks
  forward into a new issue by default.

Also: `SANS` const added (the font stack the older blocks spell out inline);
CTA headline now "Jobs Friday, with a hike on the table" and the feature list
mentions the Core Wall auto buy. Affiliate and Tradeify bands unchanged.

Preview: `generated/2026-08-30-weekly-edge-preview.html` / `.jpg`.

## 2026-08-30 - phone candles: RTH/ETH removed, and the SPX labels that were missed

Edited: `components/mobile/pages/MobileEsCandles.tsx`.

**RTH/ETH is gone.** It was added earlier today while this page still charted
ES, where the distinction is real. On SPX cash it is not: the index prints 09:30
to ~16:55 ET, so there is no globex tape for the switch to include or exclude,
and its only remaining job was hiding the last few post-close prints - a control
that has to be explained every time it is seen. Out with it: the `SessionMode`
type, `SESSIONS`, `RTH_OPEN`/`RTH_CLOSE`, `etClockOf`, the session state, the
filter in `chartCandles`, the refit dependency, the RTH badge in the header and
the SESSION section in the sheet. The sheet is back to three things. The live
tip on the newest bar is untouched.

**Labels that should have landed with the SPX switch.** An edit script aborted
partway through the previous change and took its whole batch with it, so the
page shipped SPX data under ES chrome: the shell still read "ES Candles", the
ticker chip still read "ES", and the gamma-levels hint still said "converted
from SPX to ES" for lines that are no longer converted at all. All three now say
what the page actually does. (`mobileNav.ts` was a separate write and was
already correct.)

## 2026-08-30 - phone candles are SPX cash, not ES

Edited: `components/mobile/pages/MobileEsCandles.tsx`,
`components/mobile/mobileNav.ts`.

The phone chart drew ES and converted everything else - GEX bubbles, gamma
levels, both gutter panels - through the live ES/SPX basis. That conversion is
the reason the page had a `basisOk` gate, and the reason every overlay VANISHED
whenever the pair went stale: overnight, at weekends, and in the hour before the
bell - most of the time a phone is actually open. Charting SPX itself deletes
the problem. Gamma is recorded against SPX strikes, so a bubble goes at its
strike and a wall goes at its price. Nothing to fetch, nothing to convert, and
no state where the overlays are dark because a second instrument is quiet.

- Bars now come from `useEtfCandles("SPX", ...)` - the same cash rows v3 charts,
  written by `server-v2/etf-candle-recorder.js` and read over HTTP. Verified
  live: 252 rows over 3 sessions at 5m, 412 over one at 1m, 09:30-16:55 ET.
  History depth 5 calendar days at 5m / 3 at 1m, so BUBBLE_DAYS still has two
  sessions of bars to land on across a weekend.
- `basisOk` is gone entirely, with the in-plot "SPX overlays need a live ES/SPX
  pair" note and the sheet's warning subtitle. The gutter panels now gate on the
  only honest question left - is there a ladder to draw.
- Both rails take `basis={0}`: structurally zero now, not "zero because we lack
  one".

**The 60s poll, and the live tip.** SPX cash has no candle stream on /ws/gex, so
the bars arrive on a 60s poll instead of the socket. The rows are WRITTEN once a
minute, so there is no finer SPX bar to be had - but a chart whose last bar only
moves once a minute reads as frozen. So the newest bar's close is redrawn from
the socket's `spot` frame (same index, live) with its high/low widened to
contain it, exactly as the recorder will write it. Guarded on that bar being
TODAY's: at a weekend the newest bar is a previous close and dragging it to spot
would invent a print that never happened.

Side effect worth noting: this page no longer subscribes `esCandles` /
`es1mCandles`, so `/m/es` narrows the shared socket's topic scope instead of
widening it.

**RTH/ETH, honestly relabelled.** SPX prints 09:30 to ~16:55 ET - there is no
overnight tape to include. The switch stays because the post-close tail is still
a real thing to want off a 5-minute chart, but it now means "stop at the 4:00
close" vs "keep the post-close prints", and the hint says so.

The tab is labelled SPX and titled "SPX Candles". The id and path stay `/m/es`:
they are in `DESKTOP_TO_MOBILE`, in `app/app/m/es/route.ts` and in every link
already shared - renaming a route to relabel a tab is not a trade worth making.

## 2026-08-30 - v3 check-theme: two blind spots fixed, and --muted was undeclared

Edited: `cbedge-v3/scripts/check-theme.mjs`, `cbedge-v3/src/pages/Premarket.tsx`,
`cbedge-v3/theme-baseline.json`.

The first real run of the pre-commit hook produced one true failure and a pile of
noise. Both causes are gone.

**Computed-key declarations were invisible to it.** `style={{ ["--gw-edge" as
string]: edge }}` declares a custom property, but TypeScript needs that cast
(CSSProperties has no index signature) and it puts ` as string]` between the name
and its colon, which the declaration pattern could not see past. So the check
reported `--gc-edge`, `--gw-edge` and `--gw-flip` as undefined in the very panels
that define them — the most misleading answer it could give. Second pattern
added for that form.

**`--muted` really was undeclared.** The premarket page's `.pmk` alias layer
declares `--dim` and `--dim2` but never `--muted`, and both GexChurnFeed and
GexWatchFeed style their secondary text with it. An undefined custom property
makes the whole colour declaration invalid, so those lines fell back to the
inherited colour instead of the muted one — v2's grey-text bug, running the other
way. Declared now, from `HT.muted`.

**The baseline was recorded under the old, wrong rule** — 376 violations across
twelve files, almost all of them the `.pmk` alias layer being read from a child
component, which is correct and deliberate. Reset to empty: the tree is CLEAN
under the corrected rule, so nothing is grandfathered and every file is bound
from here.

## 2026-08-29 - v3 Premarket: three tabs lazy-split, and two silent colour bugs

Edited: `cbedge-v3/src/pages/Premarket.tsx`,
`cbedge-v3/src/pages/premarket/{PostMarketTab,HistoricalRecap,CbContracts}.tsx`,
`cbedge-v3/scripts/check-theme.mjs`. Added:
`cbedge-v3/src/pages/premarket/{postMarketTab,historicalRecap,cbContracts}.css.ts`.

**The three heavy panels are `lazy()` now.** None of them is on screen when the
page opens — the post-market tab needs the tab switched, the historical recap
only appears for a date with no capture, and the contracts panel is hidden while
frozen or replaying — yet every visitor downloaded all three to look at the
pre-open view. PostMarketTab alone was 119KB of the route.

That required splitting each component's `*_CSS` constant into a sibling
`.css.ts` module, because the page concatenates every premarket stylesheet into
one `<style>` block on first paint and the cascade depends on them all arriving
together. Importing the constant from the component would drag the component
back into the entry chunk and undo the `lazy()`. Each component re-exports the
name, so nothing that imported it from there had to change. `EV_ROW_H` moved
with the stylesheet it is interpolated into — it is also read by `centerEv`'s
scroll maths, and the comment saying the two must not drift moved with it.

**`hexA()` was producing invalid CSS at nineteen call sites.** It parsed a hex,
but v3's `HOME_THEME` is v2's name for `T`, whose values are `var(--color-…)`
STRINGS. `parseInt("var(--color-accent)", 16)` is NaN, so `--cyanEdge`,
`--cyanWash`, `--posDim`, `--negDim` and the rest came out `rgba(NaN,NaN,NaN,a)`
— invalid, dropped by the browser, and the variable then resolved to nothing
wherever it was used. Now a one-line wrapper over `alpha()` from
`design/theme.ts`, which takes the token straight and keeps tracking it. `ink()`
is `alpha(T.text, a)` for the same reason. Both names kept, so the call sites
read unchanged.

**Sector Heat had two hardcoded colours** — raw RGB channel strings for green
and red. Now `T.green` / `T.red` through `alpha()`.

**check-theme's unknown-variable rule was wrong.** It resolved a `var(--x)`
against tokens.css plus the file itself, which flags a pattern that is correct
and deliberate here: the premarket page declares a v2-compatible alias layer on
`.pmk` (`--panel`, `--dim`, `--line2`, built from v3 tokens) and every component
rendered inside that page reads those names from its own file. Cross-file by
design. A variable now counts as declared if anything under `src/` or
`index.html` declares it. With that fixed the whole tree is CLEAN — zero
violations, so the baseline starts empty and the rule binds everything at once.

NOT done, and worth its own pass: `Premarket.tsx` still uses no `Page` and no
`Card` — its panel plates and gutters are hand-rolled, which is the v2 problem
arriving through ported code where `check:theme` cannot see it (the values are
correct tokens applied in the wrong place). `ChartFrame` does not apply here:
the page has no canvas, every panel is DOM/SVG.

## 2026-08-29 - v3 theme check runs on deploy and on commit, not only on the laptop

Edited: `Dockerfile`, `cbedge-v3/AGENTS.md`. Added: `.githooks/pre-commit`.

`npm run build` is not a push, and the VPS builds cbedge-v3 with `build:fast` —
`vite build` alone, no typecheck, no budgets. So a check that lives only in
`build` never runs on a push made without building first. Closed at both ends.

**Dockerfile.** The cbedge-v3 step now runs `npm run check:theme` before
`build:fast`. It reads files and matches regexes — no browser, no typecheck, no
brotli, about a second — so it is cheap enough to sit in a deploy in a way the
budget check deliberately is not. The step stays NON-FATAL: a theme violation
costs that deploy `/v3` and leaves v2 untouched, same as every other v3 build
failure.

**Pre-commit hook.** `.githooks/pre-commit`, installed once per clone with
`git config core.hooksPath .githooks` — a hook under `.git/hooks` is untracked
and would live on one machine only. It runs the check just for commits that touch
`cbedge-v3/`, and `--no-verify` skips it. Known limitation, written into the hook:
it checks the files on disk, not the staged index, so a partial `git add -p` can
disagree with it — the Dockerfile gate is the backstop for that case.

## 2026-08-29 - v3: the theme rule is now checked, not remembered

Added: `cbedge-v3/scripts/check-theme.mjs`. Edited: `cbedge-v3/package.json`,
`cbedge-v3/AGENTS.md`, `cbedge-v3/src/pages/premarket/GexProfile.tsx`.

Non-negotiable #1 said "enforced by a script, not by memory" and no such script
existed. `npm run build` now runs `check-theme` before `vite build`.

It fails on three things anywhere under `src/`:

**Colour literals** — `#rrggbb`, `rgb()`, `rgba()`, `hsl()`, `hsla()`, with
`tokens.css` the one exemption. Comments are stripped first, so a doc comment
explaining the rule is not itself a breach of it.

**Tailwind's default palette** — `text-gray-400`, `bg-zinc-900`, `border-red-500`.
Tailwind v4 still ships it, it is NOT a literal, and a hex scan waves it straight
through. It is also precisely what made v2's text come out grey on every new
page. The shade number is required by the pattern, so the app's own token
utilities (`text-muted`, `bg-surface`, `text-violet`) are untouched.

**Unknown CSS variables** — `var(--dim)`. A typo'd or leftover custom property
renders as nothing at all, with no warning. The first run of the check found
exactly that in `GexProfile.tsx`: `--dim` is a v2 variable that does not exist in
v3, so that panel's empty state was drawing with no colour. Fixed to
`var(--color-faint)`.

**A baseline, so it does not break the build it is installed into.**
`theme-baseline.json` records existing violations per file, budgets.json style:
the build fails when a file goes ABOVE its number, and every file not listed must
stay at zero. It ratchets — a file that comes in under says so and asks for
`npm run theme:update`, and a file that reaches zero is dropped and can never
regress. The FIRST run writes the baseline and passes with a loud notice; a check
that fails on day one is a check that gets switched off on day one.

Three false positives were found and fixed while testing, each worth keeping in
mind: CRLF (every file here is written on Windows, and a stray `\r` is a line
terminator to a regex, so the comment stripper silently did nothing);
`var(--color-level-${level})`, a name built by interpolation, which has nothing
to check; and `{ '--dim': x }`, a custom property declared as a JS object key.

## 2026-08-29 - v3 Multi Greek: a third of the card was chrome; ladder pans by hand

Edited: `cbedge-v3/src/board/multiGreek/MultiGreekCard.tsx`.

On a three-column-wide card the stack above the ladder — card header, panel
header, column header, TOTAL row — was taking about a third of the card, and
every row of it was one fewer strike on screen.

**Column headers and TOTAL are one block now.** They were two grids with their
own padding and their own bottom border; they are one grid with three lines per
column (expiry, date, net). Nothing was dropped.

**The panel header is one tight row.** The `BOARD` badge is gone — the board's
panel is marked by an accent border on its ticker box instead, which says the
same thing in no horizontal space and was the element pushing that row to wrap.
The ticker box is 14px in 76px (was 17px in 92px) and the paddings are halved.

**Toolbar buttons are short.** `+ Ticker 1/4` and `⚙ Board` wrapped the card
header onto a second row at this width; they are `＋ 1/4` and `⚙`, with the full
sentence in each `title`.

**No scrollbar. Grab and drag, or wheel.** The track was eating a visible slice
of the numbers. The box is still `overflow-y-auto` — only the bar is hidden, so
the wheel is unchanged — and press-and-drag now pans it like a chart. Three
details keep that from eating the cell click: a 4px threshold so a wobbly click
is still a click, pointer capture taken only once that threshold is crossed, and
a suppress flag consumed in the CLICK CAPTURE phase, since click fires after
pointerup and that is the last moment it can be stopped. A real pan also sets the
re-centring latch, so the ladder stops pulling itself back to the money under
the user's hand.

## 2026-08-29 - v3 board: cards show where they will land while you drag

Edited: `cbedge-v3/src/design/primitives/Board.tsx`.

Dragging or resizing in edit mode now draws a dashed LANDING SLOT under the
board, the card in the hand lifts off it, and faint column guides appear for the
duration of the gesture.

**Why the slot exists.** The dragged card is pinned to the pointer, but the
release runs one more compaction and the card floats up to the first free row —
so the place it is being held is very often not the place it ends up, and letting
go looks like the board jumping. The slot is computed with the exact release
maths (`compactBoard(compactBoard(draft, id))`, the same double pass as `onUp`),
so the outline cannot disagree with where the card lands: it is drawn by the code
that lands it. It is suppressed when the card is already sitting in its landing
slot — an outline directly under the card says nothing.

**Guided, not forced.** Nothing is pulled out of the hand and no gesture is
refused. The card still goes wherever the pointer puts it; the board only says,
in advance, what it will do on release.

**Guides only during a gesture.** A grid drawn the whole time is wallpaper; a
grid that appears under the hand is a ruler. Columns are otherwise invisible, so
a card taking the next column reads as the board being twitchy rather than as a
snap.

Drawn at `z-0` under the tiles, `pointer-events-none`, and every colour is a
`color-mix` on `--color-accent` / `--color-app` — no literals.

## 2026-08-29 - v3 board: the same card can be added more than once

Edited: `cbedge-v3/src/board/catalog.tsx`, `cbedge-v3/src/board/BoardPage.tsx`,
`cbedge-v3/scripts/perf-check.mjs`, `cbedge-v3/AGENTS.md`.

"+ Add card" no longer removes a card from the list once it is on the board.
Every catalog entry can be added as many times as wanted — two GEX Charts on
different bases, three Multi Greek ladders, a second calendar — and each copy
drags, resizes and removes on its own.

**Instance ids, and no migration.** A grid item's `id` is now an INSTANCE id.
The first copy of a card keeps the bare catalog id (`gex-chart`); every copy
after it gets a `#n` suffix (`gex-chart#2`). The catalog is looked up through the
new `cardTypeOf()`, which strips the suffix. Because the first instance is still
spelled exactly as it always was, every layout ever saved is still valid and
still means what it meant — no version field, no migration pass — and the
`data-card-id` selectors keep resolving. `migrateCardId()` renames the type and
leaves the suffix alone.

**Numbers count up, they do not backfill.** Removing copy 2 and adding another
gives 3, not 2. An id in a saved layout stays stable for as long as the card is
there, which is what makes per-instance state safe to add later.

**What the menu says instead of hiding a row.** Each entry carries a `×n` count
when the board already has some. A missing row was only ever a refusal; a count
is information. Copies are numbered in the card header, and only when there is
more than one — a "1" on a card with no sibling is noise.

**Dedupe on load is now per INSTANCE id, not per type**, so two of the same card
survive a reload while a genuinely corrupt blob with a repeated instance id
still gets one of them dropped.

**Known and deliberate:** a card's own settings are stored per card TYPE
(`cb-v3-mg-basis` and friends), not per instance. Two copies can be set
differently within a session, but on reload both come back on whichever was
written last. Fixing that means threading the instance id into every card's
storage keys — a change to every card, not to the board. Noted in
`cbedge-v3/AGENTS.md` under "Adding a card to the board".

`perf-check.mjs` matches the GEX Candles tile by prefix now, so a board whose
only copy is `gex-candles#2` still gets driven.

## 2026-08-29 - v3 Multi Greek: OI-only basis removed

Edited: `cbedge-v3/src/board/multiGreek/MultiGreekCard.tsx`.

The basis switch is now OI+VOL and VOL. OI-only is gone from the control.

A board that stored `oi` falls back to OI+VOL on load rather than sitting on a
basis the switch cannot show — a selected value with no button is a control that
lies about what is on screen. `Basis` in `mgMath` still types `'oi'`; only this
card's option list dropped it.

## 2026-08-29 - v3 Multi Greek: opens on the board's ticker, panels are add/remove

Edited: `cbedge-v3/src/board/multiGreek/MultiGreekCard.tsx`.

The card used to open on four hardcoded slots (SPX / SPY / QQQ / NDX). It now
opens on ONE panel — the board's own ticker — and every other panel is one the
user added.

**Panel one is the page symbol.** It reads `usePageSymbol()` rather than storing
its own ticker, so the card can never open contradicting the rest of the board.
Its header carries a small `BOARD` mark, and typing in its box calls
`setSymbol()` — it moves the whole board, because that panel IS the page symbol
rather than a copy of it.

**Up to three added panels, each removable.** A `+ Ticker n/4` button in the card
toolbar opens a one-field popover; the button greys out at four panels and says
why. Every added panel's header carries a ✕. Duplicates are refused in all
directions — against the page symbol and against the other extras — since two
identical ladders remove a comparison rather than adding one.

**Storage split, and the old blob is carried over, not dropped.** Extras live in
`cb-v3-mg-extra-tickers`; the pre-split `cb-v3-mg-tickers` is read once when the
new key is absent, and slots 2-4 of it become the extras (slot 1 is discarded —
that seat belongs to the page symbol now).

**Two duplicate paths closed.** The board ticker can be moved from anywhere (the
toolbar search, another card) onto a symbol already added here, so an effect
drops the matching extra. Removing a panel also closes the cell card if it was
read from that panel's ladder, so nothing on screen outlives the ladder behind
it.

Columns, basis, heat, the CB/CW/PW marks and the SPX-anchored expiry pick are
untouched.

## 2026-08-29 - v3 GEX Chart: FLOW is unclickable when there is no flow GEX

Edited: `cbedge-v3/src/design/primitives/Controls.tsx`,
`cbedge-v3/src/board/gexChart/GexChartCard.tsx`.

`SegGroup` options take a `disabled` flag: inert, `cursor-not-allowed`, dimmed,
and still carrying a `title` that says why. The FLOW basis sets it whenever the
current ladder has no `flowGEX` leg — which is every symbol but the one the
socket streams, since flow GEX is built from the classified tape and there is no
per-ticker tape in server-v2.

Three decisions worth keeping:

**Disabled, not hidden.** A control whose buttons appear and disappear is a
control you cannot learn, and a vanished option gives no reason for being gone.
The greyed button plus its tooltip — "No classified options tape for AMZN" — is
the honest version.

**Gated on the ladder having ARRIVED.** `flowSupported([])` is false, and an
empty ladder is the state the card is in for the first second of every load, so
testing without a length check would grey FLOW out on arrival and un-grey it a
beat later. Before any rows exist the answer is "not yet", not "no", and the
button stays live.

**A stored FLOW choice is not rewritten.** When it is the selected option AND
disabled it stays highlighted (at 50% rather than 25%, so it still reads as
selected) and the pane keeps saying it is drawing OI+VOL. Snapping the setting
back to OI+VOL would have silently destroyed the preference the first time the
board looked at a ticker, and it would come back on the next SPX board expecting
flow and finding OI+VOL. The other two options are one click away, so nothing is
stranded. `SegGroup` therefore has four visual states, not two — that is why the
class list is a small table rather than one ternary.

Typechecked against the full v3 tree: no new errors.

## 2026-08-29 - v3 GEX Chart: DEX line, three bases, call/put split, ten cards, core badge

New: `cbedge-v3/src/design/primitives/Controls.tsx`,
`cbedge-v3/src/board/gexChart/{settings.ts,values.ts,StatCards.tsx}`.
Edited: `cbedge-v3/src/board/gexChart/{gexChartRender.ts,GexChartCard.tsx}`,
`cbedge-v3/src/board/gexCandles/controls.tsx`, `cbedge-v3/src/board/chainGex.ts`,
`cbedge-v3/src/board/multiGreek/mgMath.ts`, `cbedge-v3/src/contract/frames.ts`,
`cbedge-v3/src/design/tokens.css`, `cbedge-v3/scripts/mock-server.mjs`.

The v3 card had NO toggles — it drew net GEX on OI+VOL and that was the whole
feature, because v2 drives all of this through props from the home page's own
toolbar and v3 has no home page to hang them on. The card owns them now.

**Basis — OI+VOL · VOL · FLOW.** A segmented control in the toolbar. FLOW is
gamma against the dealer's own signed inventory (`flowGEX`), which only exists
for the socket symbol: on a chain-derived ticker the chart says "No classified
flow for this symbol — showing OI+VOL" on the pane rather than falling back
silently, because bars a user has not been told are OI+VOL will be read as a
flow book. v2 falls back silently; this is the one place v3 deliberately does
more than transcribe.

**Split — NET · C/P.** One net bar per strike, or |call| up and −|put| down.
The Y scale in the split is set by the taller LEG, not by their net, or a strike
whose two sides nearly cancel would draw two bars off the top of a pane scaled
to almost nothing.

**DEX line.** v2's overlay, transcribed: `netDEX + volNetDEX` on OI+VOL,
`volNetDEX` alone on VOL, quadratic-smoothed, on its OWN scale at 60% of the
half-height with no gridlines — delta exposure is orders of magnitude off gamma
in dollars and would pin flat to the zero line on the bars' axis. Suppressed
entirely when every value is 0, since a flat line on zero reads as "delta is
balanced" rather than "there is no delta here". New `--color-dex` token: a THIRD
hue, because the line is not a bar and does not share the bars' sign convention.

**Core marked like v2.** A labelled box pinned above the bar carrying the
biggest |net| on the whole ladder — `CB`, `CB·Vol` or `CB·Flow`, since it is a
different claim on each basis. Whole-board, not the visible window, so panning
away hides the badge instead of quietly relabelling whatever is on screen.

**Expiry in the toolbar.** A pill showing which expiration the bars are, plus
the same string top-left on the pane beside the series label. The chart cannot
work it out for itself — the rows look identical whichever expiry they came from
— so the card passes it in: `GexData.expiry` on the socket, the front expiry
`chainToGex` picked otherwise.

**The ten cards.** Net GEX · Call Wall · Put Wall · Flip · CB · Max Pain · +1σ ·
−1σ · +GEX % · Bull/Bear, above the chart, each individually toggleable from a
new ⚙ Cards popover (plus a master row on/off and an All/None). Eight of the ten
are derived from the same rows on the same basis through the same accessors the
bars use, so switching to VOL moves the walls, the core and the flip with it —
v2's comment on this block says "the cards can never disagree with the chart
beneath them" and one shared definition is the only way that stays true. The
other two are `/api/em-tracker` (the weekly EM band, same row Key Levels reads)
and `/proxy/flow-history` (the classified tape, socket symbol only).

**One definition, three consumers.** `values.ts` is the whole point of the
diff: the renderer, the ten tiles and the header total all read it. Net is READ
off the wire (`netGEX + netVolGEX`) because every other v3 surface does and a
chart that recomputed its own net would be the one card able to disagree about
where the core is. The per-SIDE figures have no wire field on the volume basis
— there is no `callVolGEX` — so the split recomputes γ × contracts × spot², at
the row's OWN `spotPrice` rather than the live tick, which is what makes
`call + put === net` to the cent instead of drifting as spot moves.

**Perf.** The tiles are React and need the ladder, so the card keeps one piece
of state for them — and the spot watcher deliberately does NOT touch it. `spot`
is 10Hz; the tiles refresh on the gex frame only, which is also the only cadence
at which a wall can actually move. The chart still takes every tick imperatively.

**Contract + chain path.** `GexRow` gains `spotPrice`, `netDEX`, `volNetDEX`,
`flowGEX` — all real wire fields from `computeGexRows()`, the last three
optional because `chainGex.ts` cannot always fill them. `mgMath`'s `Leg` gains
`delta` so the chain path can compute the DEX legs for a non-socket ticker;
`flowGEX` is left ABSENT there rather than zeroed, since a column of zeroes
looks like a flat flow book and "absent" is what the fallback tests.

**Controls promoted.** `SegGroup`, `Chip`, `Popover` and `PanelSection` moved
from `gexCandles/controls.tsx` to `design/primitives/Controls.tsx`, under the
note in that file saying to move them the moment a second card wanted one. The
old path re-exports them, so no existing import changed.

**Mock.** `gexPayload()` now emits `spotPrice`, `netDEX`, `volNetDEX` and
`flowGEX`, and `/proxy/flow-history` is mocked — otherwise VOL, FLOW, the DEX
line and the Bull/Bear tile are all untestable without a backend, which is the
one thing `npm run mock` exists to prevent.

Typechecked against the full v3 tree: no new errors (the two `import.meta.env`
reports and the pre-existing `BubbleBucket` mismatch in `GexCandlesCard.tsx:408`
are present on an unmodified checkout too).

## 2026-08-29 - Earnings board: pills sized by padding, one font size across the day strip

Edited: `components/pages/EconomicCalendar.tsx`.

Two alignment complaints survived the last pass, both in the copied PNG, both
the same underlying thing: the board declared sizes in one font and html2canvas
painted them in another.

**The header pills.** They were `height:22` + `line-height:1`, the CSS way to
centre a badge, and `data-cap-center` tried to reconcile that on the clone by
swapping the height for `height:auto` and re-expressing the slack
(`height - borders - font-size`) as padding. That arithmetic only holds if the
clone measured the run in the font the painter uses, and it did not: the clone
lives in an about:blank iframe where `var(--font-mono)` resolves to nothing. The
result in the PNG was ANTICIPATED sitting low in a pill it also overflowed
sideways. The pills are now sized by symmetric `padding: 5px 10px` with no
declared height, so the box is text-plus-padding by construction and
`data-cap-center` falls to its no-height branch, which only RE-SPLITS that
padding by the measured drawing error and cannot resize the box.

**The day strip.** MONDAY rode above AUG 31 because they were 10px mono and 13px
sans, and html2canvas's `baseline` is a per-font, per-size probe - two sizes get
two different drops and separate vertically. No box-level fix reaches that; the
strip's own `data-cap-center` moves both runs together. Both runs (and the count,
and the TODAY pill) are now 12px on one family, with weight and colour carrying
the contrast instead of size.

**`MONO`.** New const naming real fallbacks after `var(--font-mono)`
(`ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`),
applied to every mono run inside the capture target. The variable still wins on
the live page; the clone now has something real to fall back to, so the box it
measures is the box the glyphs get drawn in.

## 2026-08-29 - v3 GEX rail: bare bars, all facing right

Edited: `cbedge-v3/src/board/gexCandles/GexRail.tsx`.

Stripped the rail down to tags + bars. The strike column (46px) and the dollar
value column (38px) are gone, and the diverging layout around the centre
hairline is gone with them — every bar now anchors to the same left edge and
grows RIGHT, positive or negative, with sign carried by colour alone.

Why: the chart's price axis already labels the row's height, so the strike text
was the axis printed twice; and the bar length already encodes size, so the
figure beside it was the same fact in a second notation. Removing both frees the
whole column for magnitude and lets the eye compare lengths off ONE baseline
instead of two half-width scales pointing opposite ways.

Rail width 184px → 96px. The tag column keeps its fixed 22px whether or not the
strike is tagged, so every bar starts on the same x. The exact strike and value
survive as the row's hover `title` — `fmtRail` is now title-only and prints
nothing. `spotStrike` was deleted (it only bolded the strike text) along with
the now-unused `spot` destructure.

Untouched: `buildRail`, the level picks (CB/CW/PW), the RailSink positioning and
the priority thinning pass — the rail still reads `priceToCoordinate` once per
frame and still hides rows that would collide.

## 2026-08-29 - Fix: v3 page dead on load, `Cannot access 'Ie' before initialization`

Edited: `cbedge-v3/src/board/gexCandles/settings.ts`.

The bucket-picker change put `BubbleBucket` and `BUBBLE_BUCKET_DEFAULT` at the
BOTTOM of settings.ts, beside `BUBBLE_LADDER_REQUEST` — and `DEFAULT_SETTINGS`,
250 lines above, reads `BUBBLE_BUCKET_DEFAULT` in its initialiser. `const` is
not hoisted the way `function` is: at module-evaluation time that name is still
in its temporal dead zone, so the module threw before it finished loading and
the whole route came back blank. Minified, it reads as the mangled name —
`Cannot access 'Ie' before initialization` — which says nothing about which
constant, so: **the one that throws is always the one being READ too early, not
the one doing the reading.**

The block moved above `ChartSettings`, which is also where it belongs on merit —
the interface uses the type. Nothing else changed.

`tsc` does not catch this. It is an evaluation-ORDER fact, and TypeScript is
checking types; the build was clean. Guarding against the next one is cheap
though, and worth doing before this file grows again: requiring the bundled
module and reading one field off it is a two-line smoke test that fails loudly
on exactly this class of bug.

## 2026-08-29 - v3: the bubble bucket picker (Auto / 1m / 5m), like v2

Edited: `cbedge-v3/src/board/gexCandles/settings.ts`, `chart.ts`,
`GexCandlesCard.tsx`.

v2's ES Candles has had an Auto / 1m / 5m bucket picker since the engine was
built; v3 was running permanently on Auto with no way to say otherwise. It now
has the same control, under **Layers -> Bubble bucket**.

* **`settings.ts`** - `BubbleBucket` (`1 | 5 | 'auto'`), `isBubbleBucket`,
  `isAutoBucket`, `BUBBLE_BUCKET_DEFAULT`, and a `bubbleBucket` field on
  `ChartSettings`. It is the ONLY bubble setting the card has; everything else
  about the layer is still the frozen `BUBBLES` block. `SETTINGS_V` 3 -> 4, and
  an older blob simply has no such key, falls back to `'auto'`, and that is the
  behaviour it already had - nothing needs forcing.

  v2 also accepts a legacy `'bar'` spelling of Auto. v3 has no blobs old enough
  to hold it, so it is not accepted here - the one deliberate difference between
  the two copies.

* **`chart.ts`** - `ChartDrawOpts` gains `bucketMin: 1 | 5 | null`, and
  `reportBucket` short-circuits its pixel measurement when it is set. The CHART
  owns this, not the model, because the auto answer is a question about pixels -
  how much room a dot has - and the model has no idea how wide the pane is.

  **A pin sets the RUNG, not the stride.** A forced 1m across a whole session
  still draws every Nth bucket, because 975 dots do not fit in 1500px whoever
  picked the number - so at a wide zoom a pin lands on exactly the picture Auto
  would have drawn. That is correct, and worth knowing before someone files it
  as the picker not working.

**Also fixed:** `GexCandlesCard` seeded its bucket state from
`BUBBLES.bucketCoarseMs`, a constant deleted when the bubble knobs came out - a
dangling reference that would have failed `npm run typecheck`. It now seeds from
the coarsest rung the ladder actually has, so the first frame (drawn before the
chart has measured anything) errs toward too few dots rather than a 1m firehose
replaced a frame later.

## 2026-08-29 - Bubbles: auto stops at 5m, and the sizes spread out again

Edited: `cbedge-v3/src/board/gexCandles/settings.ts`, `bubbles.ts`,
`components/dashboard/es-candles/slotStore.ts`, `EsChartCard.tsx`.

Two complaints off the live charts, both fair.

**1. Auto was allowed to pick 15m, 30m and 1h, and it looked empty.** On a wide
view those rungs draw a scatter of lonely dots with the session's shape missing
between them - technically legible, useless to read. The ladder now stops at 5m
(`bucketRungsMin: [1, 5]`). Past 5m the right answer was never a coarser BUCKET,
which throws prints away; it is the stride, which keeps the bucketing honest and
just draws every Nth. The 15/30/60 entries in `profiles` stay, because a strided
5m trail is sized by its EFFECTIVE spacing - they are still reached as sizes,
never as buckets. Full session on the fixture went from a handful of dots to
195.

**2. Everything was the same dot.** Three things were flattening the ladder and
all three were the same mistake - spending the size budget on the leader.

* **The peers were paying for the leader's boost.** `capOfSpacing` was divided
  by `topBoost` so the boosted top mark would still fit inside its bucket's
  spacing. One dot per bucket was therefore setting the size of every other dot
  in it, a 30-40% tax on the whole ladder for a mark that already has a ring and
  a glow. The leader now has its OWN share (`topOfSpacing`, 0.34) and the peers
  have theirs (`capOfSpacing`, 0.28). Both are bounds - taking the leader's
  bound off entirely was tried first and drew a continuous sausage at a tight
  zoom.
* **The curve was too kind to the middle.** Plain `sqrt` put a 5%-of-max strike
  at 22% of the range and a 30% strike at 55%, so most of the ladder sat bunched
  in the top half of the budget. `sizeCurve: 0.62` spreads it back out - 5% ->
  16%, 30% -> 48%.
* **The floor was too high.** `floorOfCap` 0.45 -> 0.25, so the small end goes
  properly small and the spread is visible at the zoom where the whole session
  is on screen. `minPx` is still the hard bottom.

**And the glow was the reason the top row looked fused.** The marks were
clearing each other by a pixel or two and then a 7px gaussian halo painted
straight across the gap. Blur is not free real estate: it now gets only the room
left beside the mark once the mark's own radius comes out of the spacing, which
at a tight zoom is zero and the glow simply does not draw. The ring still marks
the leader.

Verified in the bubble lab against `fri-pin` at three zooms: full session 5m/195
dots with visible size spread, last 2h and last 30m both discrete circles with
gaps rather than bars. Screenshot in `generated/`.

v2 and v3 carry identical numbers, as always - a change to one is a change to
both.

## 2026-08-29 - v2 ES Candles gets the v3 bubble engine

Edited: `components/dashboard/es-candles/slotStore.ts`,
`components/dashboard/es-candles/EsChartCard.tsx`.

The bubble layer on v3 GEX Candles was rebuilt over the last several entries
(spec rules, per-rung profiles, stride, local pixel measurement). This ports the
finished engine back onto v2's ES Candles so the two surfaces draw the same
thing.

**`slotStore.ts`** - the whole tunable surface is gone. `BubbleStyle`,
`BUBBLE_STYLE`, every `BUBBLE_*_RANGE`, the auto-derivation helpers, and
`BUBBLE_REF_FLOOR_FRAC` / `BUBBLE_REF_START_MIN` / `BUBBLE_REF_CUTOFF_MIN`
(the session-wide reference window that was ranking the afternoon's gamma growth
over the morning's real walls) are replaced by one frozen `BUBBLES` block
transcribed from `cbedge-v3/src/board/gexCandles/settings.ts`. The numbers are
identical on both sides and there is a note on the block saying so - **it is a
copy, so a change to one is a change to both.** `BubbleBucket` /
`isAutoBucket` / `BUBBLE_BUCKET_DEFAULT` and the `BUBBLE_DEFAULTS_V` migration
stay; the per-user slider values in saved slots are simply ignored now.

**`EsChartCard.tsx`** - the 777-line bubble block is replaced by a 246-line port
of `drawBubbles`. Same seven rules as v3:

* rung chosen from `bucketPxPerDot` measured LOCALLY at the plot midpoint, not
  off the data span (`xAtTime` clamps - that was the zoom bug),
* last print in the bucket wins,
* rank by `|netGex|` with one strike forced above and one below spot, then fill
  to `levels`,
* `r = floorPx + sqrt(|gex| / windowMax) x (capPx - floorPx)`, per-rung profile,
* the bucket leader takes `topBoost`, a white ring and the glow,
* shrink toward the floor then a few px of X jitter to clear neighbours,
* stride when the dots cannot fit, so zooming in reveals more of them.

Two v2-only wrinkles kept: every y goes through `basisAt(ts)` because the
strikes are SPX and the price axis is ES, and `spotKAt()` is rebuilt inside the
draw from `rowsRef` for the force-one-per-side rule.

Removed with the old block: the `bubbleAuto` / `bubbleLevels` / `bubbleSize` /
`bubbleFloor` / `bubbleCutoff` / `bubbleCurve` / `bubbleIntensity` state and
their panel controls, the `glowSpriteRef` sprite cache (the new path draws one
glow per bucket leader, not one per wall per column per frame), and the
`gexTodScale` import - the time-of-day gamma correction existed to patch the
session-wide ranking that no longer happens.

The Bucket picker (auto / 1m / 5m) is the only bubble control left on the panel.

## 2026-08-29 - Bubbles: zooming in adds DOTS, not size

Edited: `cbedge-v3/src/board/gexCandles/settings.ts`, `bubbles.ts`.

Zoom out and see fewer, zoom into the candles and see all of them. Two changes,
one of them a real bug.

**1. The rung threshold was set from a FULL-SIZE mark.** `bucketPxPerDot` was
`2 x capPx x topBoost + gap` — about 37px — so a 1m rung had to earn room for a
top-sized bubble before it was allowed at all. A two-hour window drew 5m, a
half-hour window drew 1m, and there was nothing in between. It is now 11px,
derived from the SMALLEST legible mark: the finer rung is allowed as soon as its
dots can be told apart, and `capOfSpacing` shrinks the marks to fit the room. So
zooming in adds dots first and size second, which is the way round you want it.
The 1m profile's cap went 5.5 -> 9 to match, since it now has to look right at
both ends of that range.

**2. `pxPerDot` was measured off the data's whole span, and `xAtTime` CLAMPS.**
A whole day of snapshots therefore reported the plot's own width no matter how
far in you were zoomed — so a bucket looked a fraction of a pixel wide, the
stride went to dozens, and zooming in threw away almost everything it should have
been revealing. Now it measures two times one bucket apart in the middle of the
plot, which is the question actually being asked. This only showed up zoomed in,
which is exactly where nobody was looking while the zoomed-out case was broken.

On the fixture at three zooms: full session 15m / 65 dots, last 2h 5m / dense,
last 30m 1m / every minute.

## 2026-08-29 - Bubbles: when the dots do not fit, draw FEWER — not smaller

Edited: `cbedge-v3/src/board/gexCandles/bubbles.ts`.

1m looked right zoomed in and horrible zoomed out, and shrinking the marks did
not fix it — which is the clue. There is a hard limit here worth stating plainly:
**975 samples across 1,500 pixels is 1.5px each, and you cannot draw 975
distinguishable circles in that.** Two 1.2px dots 1.5px apart still touch, so the
ribbon comes back whatever the size numbers say. The problem was never the size.

So when the dots cannot all fit, only some of them are drawn: every Nth bucket,
strided so the ones that ARE drawn clear each other. Nothing is faked — each
drawn dot is still one real bucket, last print and all — the trail is simply
sampled at the resolution the pane can actually show.

**The stride targets the spacing the auto rung is chosen for**, not a bare "they
do not touch" minimum. Striding to the minimum was the first attempt and it is
barely better than the ribbon: 3px dots across a session are a dotted line you
cannot read a size off, and size is the entire signal. At the auto spacing a
forced rung lands on exactly the picture auto would have drawn — which is
correct, because at that width there is only one legible answer, and pretending
otherwise is what made this look horrible zoomed out.

The size profile is then chosen for the EFFECTIVE cadence — the bucket as drawn,
not as bucketed — so a strided 1m trail is sized like the rung it is actually
showing.

Net effect: every combination of bar size, bucket and zoom now draws separated
bubbles. Forcing 1m and zooming out converges on auto; zooming back in drops the
stride to 1 and every minute is there again.

## 2026-08-29 - Bubbles: one size profile per bucket rung, plus a spacing shrink

Edited: `cbedge-v3/src/board/gexCandles/settings.ts`, `bubbles.ts`,
`tools/bubble-lab/lab.html`.

5m looked right and 1m came out as fused neon ribbons. That is not a tuning
failure, it is one number being asked two different questions: a 13px cap over 5m
dots clears its neighbours, and over 1m dots — five times as many in the same
width — it cannot. The fix is not a cleverer single number.

**`BUBBLES.profiles` is now one set of size numbers per rung**, hardcoded:

| rung | capPx | floorPx | topBoost | ringPx |
|---|---|---|---|---|
| 1m | 5.5 | 1.2 | 1.50 | 1.0 |
| 5m | 13 | 2.5 | 1.38 | 1.4 |
| 15m | 16 | 3.0 | 1.34 | 1.6 |
| 30m | 18 | 3.5 | 1.30 | 1.8 |
| 60m | 20 | 4.0 | 1.28 | 2.0 |

Each is what that bucket looks right at, at the zoom where the auto rule would
pick it. A bucket between two listed rungs takes the nearest profile BELOW, so an
unlisted one is never sized by numbers meant for something coarser.

**And the profile is then shrunk to the room that actually exists.** A profile is
right at its own zoom; force a rung the auto rule would not have picked — which
the lab exists to allow, and which a pinned setting would do every day — and the
dots land closer than the profile assumes. So the cap is also held to
`capOfSpacing` (0.42) of the measured gap between two dots. It only ever shrinks:
inert at the intended zoom, and at 1m across a whole session it turns the fused
ribbons into a fine dotted trail, which is the truthful picture of 975 samples in
1500 pixels.

Both the bucket and its pixel spacing are MEASURED in `drawBubbles` off the
snapshots themselves — median consecutive gap, not mean, so a feed outage or a
weekend is not one huge diff claiming there is far more room than there is. The
draw is told the model's decision once, by looking at it, rather than twice.

## 2026-08-29 - Bubble Lab: a bucket selector beside the bar selector

Edited: `cbedge-v3/tools/bubble-lab/lab.html`.

`auto bucket` / `1m bucket` / `5m bucket`, next to the `1m bars` / `5m bars` chip
added earlier. Two selectors because there are two timeframes on this chart and
they are not the same one: the bars are the candles, the bucket is the bubbles.

**Auto is the pixel rule the card ships with** — the smallest rung whose dots own
`bucketPxPerDot`, which is a top mark's own diameter plus the hairline. 1m and 5m
force it, and forcing is the point: a fixed bucket is correct at exactly one zoom
and the selector is how you see what it costs everywhere else. Across this
session 1m is 975 dots on 1500 pixels, which cannot help but fuse; 5m on a
half-hour view is six. Both are right somewhere and neither is right everywhere,
which is the argument for auto — now made on screen rather than asserted in a
comment.

When a forced bucket is finer than auto would allow, the caption says
`5m (tight) bucket`. That is the state where dots overlap, and it should read as
a choice rather than leave you wondering whether the size law broke.

## 2026-08-29 - Bubble Lab: a bar selector, and what it is actually for

Edited: `cbedge-v3/tools/bubble-lab/lab.html`.

A `1m bars` / `5m bars` chip in the Mode row, rolling the fixture's 1m candles up
in the page. Each cell's caption now reads `5m bars · 15m bucket · 65 dots · 4
rows · 20 strikes`, so the two timeframes on this chart are never confused for
each other again.

They are two different things and the selector is the proof: **the bars are the
candles, the bucket is the bubbles, and the bucket does not come from the bars.**
It comes from the visible span in pixels — the smallest rung whose dots own
`bucketPxPerDot`. Flip the chip and the caption changes on the left of the dot
and not on the right: same dots, same buckets, same rows, only the candles under
them redraw. If that ever stops being true, a timeframe term has crept back into
the layer, which is the bug this whole rebuild was undoing.

The roll-up is plain epoch-aligned buckets rather than the 09:30-anchored grid
`candles.ts` uses. 09:30 ET is thirty past the hour and 5 divides 30, so for
these two rungs the grids coincide exactly. They stop coinciding at 15m and up —
which is why the app rolls up the careful way and the lab does not need to, and
why this selector stops at 5m rather than growing a ladder it would then have to
get right.

## 2026-08-29 - Bubbles: rebuilt to the rules table

Edited: `cbedge-v3/src/board/gexCandles/bubbles.ts`, `settings.ts`, `chart.ts`,
`GexCandlesCard.tsx`, `tools/bubble-lab/lab.html`.

| rule | implementation |
|---|---|
| 1 bubble / timeframe | Columns bucket to a rung of `bucketRungsMin` (1/5/15/30/60m). Last print in the bucket wins — a mean would smear the very move a dot exists to show. |
| 4-10 strikes, >=1 each side | `pick()` ranks by \|netGex\|, FORCES one above spot and one below, then fills the remaining slots from the ranking. Forced first, not swapped in after: the two sides are taken before the ranking gets to spend the slots. |
| Grow with net GEX | `r = floorPx + sqrt(\|gex\| / windowMax) * (capPx - floorPx)`. One denominator for the whole window. |
| Top strike stands apart | The bucket's largest gets `topBoost` 1.38x, a bright core and a white ring. 13 x 1.38 = ~18px against ~7px peers, which is the mock. |
| Floor so old dots survive | Never below `minPx`, whatever the fit pass does. Age fades opacity only from 1.0 to `ageKeep` 0.75 — a trail that fades to nothing cannot be read for the morning, which is half of why it is drawn. |
| No overlap if possible | Same-bucket neighbours shrink toward the floor proportionally over `fitPasses`, then a pair that still cannot fit takes `jitterPx` of X nudge. Nothing is ever dropped. |
| History stays the day | Nothing spliced. `strikeMode: 'per-bar'` keeps each bucket's own picks on the axis; `'latest'` locks the Y set to the current picks and plots those strikes backward through the session. |

**The rung is chosen from PIXELS, not from a fixed 1m/5m.** 1m is right on a
half-hour view and 390 overlapping dots across a session; 5m is right on a
session and six dots on a half-hour. The layer takes the smallest rung whose
dots own at least `bucketPxPerDot` — set from the mark itself, `2 x capPx x
topBoost + gapPx`, so a full-size top mark fits between two dots and they can
never fuse. The chart reports it on range change, debounced to the rung value
rather than the span, so it fires twice a session instead of on every wheel tick.

**Gone with the rewrite:** the continuous stroke walk and everything that
propped it up — smoothing, rank hysteresis, dwell, `planSizes`, the sampled
time-to-x table. Every one of those was a patch for a renderer where a strike
dropping out for one print left a hole in a LINE. A dot that is not there for one
bucket is a gap in a chain of dots, which is what a sample looks like.

## 2026-08-29 - v3 GEX Candles: Friday's bubbles, on a weekend

Edited: `cbedge-v3/src/board/gexCandles/GexCandlesCard.tsx`.

The card drew an empty layer all weekend — which is exactly when there is most
time to look at it. Three separate reasons, all of them "the code assumes the
market is open":

**1. The expiry.** `/api/expirations` lists what is TRADEABLE, so on a Saturday
its first entry is Monday. Ask the history route for Monday's expiry and it
answers honestly with nothing, because Monday has not happened. What you want on
a Saturday is FRIDAY: the last session that traded, and the expiry its gamma was
recorded against. The default is now that Friday's date on Sat/Sun, and the
nearest tradeable expiry every other day. The date is not in the expirations
list — it has expired — and does not need to be: the route takes `expiry` as a
plain parameter and the rows are still in the table. It is added to the top of
the dropdown so the control is not showing a value it does not list, which
renders as empty and reads as broken.

**2. The reach.** 48h is enough on a Saturday and not on a Sunday evening: 48h
back from Sunday 20:00 lands at Friday 20:00, four hours after the close, so the
card reached PAST the session it was trying to show and came back holding
nothing but the frozen post-close book. On a weekend the window is now measured
— the distance back to that Friday's 04:00 ET plus an hour — instead of a
constant that cannot know what day it is. Sunday 20:00 asks for 3,900 minutes;
the route clamps at 5,760.

**3. The weekend columns.** The recorder has no market-hours gate: it republishes
the last cash book once a minute right through Saturday and Sunday. Left in, the
trail runs flat to the right of Friday's close for two days — real rows, and a
picture of nothing happening drawn wider than the day that did happen. On a
weekend the columns are scoped to that Friday's ET day and nothing else.

Weekday behaviour is untouched on all three.

## 2026-08-29 - Bubbles: they are bubbles again. Stamped on a pixel cadence, not drawn from the data

Edited: `cbedge-v3/src/board/gexCandles/bubbles.ts`.

They were called bubbles and they rendered as solid bars. A row is a chain of
separate round marks again, laid down every `2 x top + 2 x gapPx` pixels across
its span, with the gamma behind each one looked up by time at that pixel.

Both continuous versions were wrong for the same reason: **they took their
cadence from the DATA.** One stroke per snapshot at a session's zoom is a
thousand strokes across fifteen hundred pixels, so whatever the radius they
overlap into a bar - and a bar is a different claim than a trail. It says the
level was one thing for the whole stretch; the marks say it was sampled,
repeatedly, and here is what it read each time. The first attempt capped stroke
length instead (`MAX_STRETCH_R`), which broke rows into dashes the moment the
gap between snapshots exceeded the radius - the same failure from the other side.

Cadence in PIXELS fixes both at once, because pixels are the only thing constant
across zooms. Spacing derives from the mark size itself, so marks clear each
other horizontally at every zoom by exactly the hairline that separates two rows
vertically. Zoom in, more of them; zoom out, fewer; a chain of bubbles either
way, with no timeframe term anywhere and nothing to configure.

The cadence uses the frame's TOP radius rather than each mark's own, so every row
stamps at the same x positions - a weak row is a faint dotted line under a wall's
fat chain, aligned with it, and the eye can read down a column.

Deleted with the stroke walk: `MAX_SEGMENTS` and its stride budget, `placeMarks`,
and the `buildXMap`/`xOf` sampled time-to-x table. The stamp loop walks pixels
and asks `timeAtX` directly, which is the same question the other way round and
needs no table; the mark count is now bounded by the pane's width over the mark
size, so there is nothing left to cap.

## 2026-08-29 - Bubbles: no settings. Six sliders and an Auto mode become eleven numbers

Edited: `cbedge-v3/src/board/gexCandles/settings.ts`, `bubbles.ts`, `chart.ts`,
`GexCandlesCard.tsx`, `cbedge-v3/tools/bubble-lab/{entry.ts,lab.html}`,
`components/dashboard/es-candles/EsChartCard.tsx`.

The layer had six sliders, an Auto mode, and about twenty constants behind it
deciding how many rows to draw, when a level stopped counting, how much to dim a
busy chart. Every one of them was answerable and none of them was ever answered
the same way twice — which is the actual reason this never looked right. A
setting is a question you have to keep re-answering, and the chart has one right
answer at a time.

**There are no bubble settings now.** Bubbles are on or off. Everything else is
`BUBBLES` in settings.ts: eleven numbers, each one there because removing it
changes the picture in a way you can name, and the comment on it says which.

What went, and why, written down so nobody adds them back:

- **The cutoff gate.** Redundant the moment `levels` is four — the
  fourth-strongest strike on the board is worth drawing by definition, so a
  share gate on top could only ever remove a row you had asked for. Which it
  did, silently, and that is why the 30-minute cell said "nothing drawn".
- **The auto level count.** It widened 4 → 6 on a flat board. "Six sometimes" is
  not simpler than four, it is four plus a surprise.
- **Crowd trim and per-row dimming.** Both scaled the picture by the row count.
  With the row count fixed they are constants multiplied by one.
- **Rank hysteresis.** The sweep settled it: with the ranking reading the
  smoothed series, `hyst` 0 and `hyst` 16 give the same bands and the same
  breaks. The noise it was absorbing is no longer in the input. `dwell` does the
  whole job.
- **The six sliders and the Auto chip**, on both surfaces. v2's four went with
  them; its draw path takes the auto branch unconditionally now.

The lab's panel follows automatically — it builds itself from the object — so it
went from twenty-five sliders across two groups to eleven under one heading, and
it is now the only place these numbers are adjustable at all.

On the same fixture the card draws **4 rows**, which is what the setting has been
claiming since the start.

## 2026-08-28 - Bubbles: the lab found two real bugs in its first hour

Edited: `cbedge-v3/src/board/gexCandles/bubbles.ts`,
`cbedge-v3/src/board/gexCandles/settings.ts`.

First real session through the Bubble Lab (SPX, 1,440 columns, `levels` auto = 5)
and the readout said it immediately: **5 rows on screen, 25 distinct bands over
the trail, 158 row-endings.** That is the dashed-wings look, measured instead of
squinted at.

**1. The ranking was reading raw |GEX|.** Ranks 4, 5 and 6 sit inside the noise
of each other and trade places every other minute, so a row broke every time.
Rank hysteresis was treating the symptom and barely moved it — `hyst=16` still
left 20 bands and 21 breaks, and slack that wide has stopped meaning anything.

The model now **smooths first and selects second**: the dense per-strike series
is built and smoothed before any selection, and the ranking reads the smoothed
value. Same series the radius is already drawn from, so what decides a row and
what sizes it finally agree. Average row segment went from a few minutes to
**58**, and the result is now insensitive to `hyst` — which is the proof that
rank slack was never the lever.

**2. `dwell` made every row permanent.** The new minimum-row-length rule
refreshed a strike's lease for everything in the drawn set — including the
strikes that were only in the set BECAUSE they had a lease. Every row renewed
itself, forever.

It measured beautifully: 8 bands, 6 breaks over a whole session. It was
completely wrong. The eight were whatever happened to top the board in the
fixture's first minute — an overnight book of round-number strikes — and nothing
could displace them, so **the 7710 wall holding −472B into the close was not
drawn at all.** The 30-minute cell said "nothing drawn" because every selected
strike was tens of points from price.

The lease is now refreshed only by genuinely ranking inside `levels`; anything
held over spends its credit one column at a time. `smoothWindow` 2 → 5,
`dwell` 12 → 20, both from the sweep rather than from feel.

Worth saying plainly: bug 2 is one I wrote an hour earlier and would have shipped
on the strength of a number that looked like success. What caught it was the
lab's second readout — the drawn strikes were 7650/7700/7720/7730/7750/7770 while
price was at 7710 — and a two-line script that printed which of them were even
inside the visible price window. Neither is visible in a screenshot of a chart.

## 2026-08-28 - Bubble Lab: the live layer, drawn against frozen sessions, all at once

Added: `cbedge-v3/tools/bubble-lab/` (`capture.mjs`, `build.mjs`, `entry.ts`,
`lab.html`, `README.md`, `.gitignore`).
Edited: `cbedge-v3/package.json`, `cbedge-v3/src/board/gexCandles/bubbles.ts`,
`cbedge-v3/src/board/gexCandles/settings.ts`.

Every tuning round on the bubble layer has been the same loop: look at ONE live
chart, change a constant, deploy, look again tomorrow. One sample per twenty
minutes, and the sample is whatever the market did that day — so a change that
fixes a pinned Friday quietly wrecks a trend day and nobody finds out for a week.
That loop produced, in order: eleven bands when the setting said four, rows dashed
into dots, caterpillar lumps, thirty-pixel bands, and a session-wide ranking that
deleted the day's biggest wall because gamma grows into the bell. Every one of
those is visible in two seconds on a sheet of six sessions.

**`capture.mjs`** freezes a real session — the same three routes the card uses,
in the same order — into `fixtures/<name>.json`. **`build.mjs`** esbuild-bundles
`entry.ts` (which re-exports the LIVE `bubbles.ts` and `settings.ts`, nothing
copied) and inlines every fixture, so **`lab.html`** opens off `file://` with no
server. The page renders each session at three zooms — full, last 2h, last 30m —
through a linear stand-in for lightweight-charts' scales that honours the same
null-outside-the-plot contract `drawBubbles` probes for.

A mockup with sliders is what was tried before and it cannot work, for a reason
worth writing down: it is not the renderer that ships and it is not real data,
and both diverge the moment either side is touched. This bundles the actual
modules. If a cell looks right, the card looks right — the layer never sees
anything but the four functions in `BubbleGeometry`.

Sliders mutate `BUBBLE_AUTO` / `BUBBLE_STYLE` in place (they are `as const`,
which is a compile-time promise, not a runtime one) and redraw all cells; **Copy
constants** emits them in the shape `settings.ts` wants pasted. To make the two
that mattered reachable, `SMOOTH_WINDOW` and `HYST` moved out of module scope in
`bubbles.ts` and into `BUBBLE_AUTO` as `smoothWindow` / `hyst`, read per call
rather than captured at import.

Each cell prints **rows** (what a vertical slice holds — should equal `levels`)
and **strikes** (how many distinct rows the whole trail carries). Those two
diverging is exactly the eleven-band bug, and that readout would have caught it
on day one.

`npm run lab`, `npm run lab:watch`, `npm run lab:capture`. Generated output is
git-ignored; the four source files are the tool. The README lists the six
sessions worth capturing and why each one breaks something different.

## 2026-08-28 - Bubbles: top N AT EVERY MOMENT, so a level that ran the 11:00 high keeps its trail

Edited: `components/dashboard/es-candles/EsChartCard.tsx`,
`cbedge-v3/src/board/gexCandles/bubbles.ts`.

The session-wide row set fixed the eleven-band union and broke something worse:
7770 was the top GEX strike at the day's high and vanished off the chart
entirely, leaving seven rows stacked around the close.

**Ranking across the whole session cannot work, and the reason is in this repo's
own calibration.** Gamma at the top strike grows ~4.7x from the open to the bell
(`gexTodScale`, measured off six sessions of per-strike history). Rank a day's
strikes against each other on the raw number and the afternoon wins every
comparison it is in: an entire morning of real levels ranks below a mediocre
15:00 strike, and the chart quietly becomes "the last hour, drawn wide".

**So the selection is per bucket again — but only the selection.** A strike is
drawn over the stretch where it was actually in the top N, so a vertical slice
anywhere holds exactly N rows (never the union), and a wall that dominated the
11:00 high keeps its trail up at the high where it happened. Ranking within a
bucket never makes the cross-time comparison at all, so no detrend is needed for
it — 11:00's strikes are ranked against 11:00's.

**Hysteresis is what makes per-bucket selection viable.** It is the thing the
first per-snapshot version was missing: a hard top-N boundary is a coin flip for
the strikes sitting on it, ranks N and N+1 swap for a minute, both rows break,
and the trail comes out as dashes — which is exactly what the wings looked like.
An incumbent now keeps its place while it stays inside N + 2, so it takes a real
fall out of the ladder, not a tick of noise, to end a row. On v3 the cutoff also
only ever blocks a NEWCOMER, for the same reason: an incumbent dipping under the
bar for a minute would punch a hole in its own trail.

The min-per-side swap is likewise decided against THAT bucket's spot — where
price was at 11:00 is what decides which side an 11:00 row is on. And the glow is
the bucket's own leader among the drawn rows, so it shows *when* a level was the
one running the board.

Everything from the previous pass that was right is untouched: one session-wide
normaliser for the radius (rows taper instead of bulging), the smoothing pass,
one size plan per frame, thin rows. One correction to the size plan — its spacing
cap now measures every strike drawn ANYWHERE on the chart, not just the newest
column's rows. Rows come and go through the session, and two that sat a point
apart at 11:00 are the pair that actually has to fit.

## 2026-08-28 - Bubbles: one row set for the session, thin rows, smoothed. The three reasons it looked wrong

Edited: `components/dashboard/es-candles/EsChartCard.tsx`,
`components/dashboard/es-candles/slotStore.ts`,
`cbedge-v3/src/board/gexCandles/bubbles.ts`,
`cbedge-v3/src/board/gexCandles/settings.ts`.

Four levels were set and eleven bands were on the chart, half of them dashed and
all of them bulging and pinching like caterpillars. Three separate causes, none
of them a tuning problem:

**1. The row set was chosen PER SNAPSHOT.** Every column ranked its own board and
drew its own top four — so every column obeyed the count and the CHART did not,
because what you see is the UNION over the session. A strike that was top-four
for ten minutes at 10:00 and again at 15:00 put two disconnected segments on the
chart, which reads as a rendering fault rather than as information.

The set is now picked ONCE, from the whole loaded history, by each strike's PEAK
|GEX| over the session, with the min-per-side rule applied against the CURRENT
spot. `levels` means what it says: that many rows, first pixel to last, unbroken.
(v2 had a subtler version of the same bug — an EXPANDING ranking, so late
entrants started mid-chart. Same fix, and it deleted the per-bucket balance
machinery with it.)

**2. Radius was normalised against each snapshot's OWN core.** Every quiet minute
renormalised back up to full size, so a row bulged wherever its neighbours were
weak. There is one denominator now — the session's biggest — so a row is
comparable to itself an hour ago and to the row above it, and it TAPERS instead
of lumping. v3 also gained a centred 5-snapshot mean over each row's series: the
minute-to-minute wobble is drawn as a one-pixel slice and reads as noise, while
the build-and-bleed shape that carries meaning survives the window untouched.

Same class of bug on the pixel side: `placeMarks` re-derived the pane cap, the
tightest pair and the variance from whichever marks that minute happened to hold,
so a missing neighbour widened the gap, raised the cap, and fattened every mark in
that column. Sizing is now ONE plan per frame (`planSizes`), computed off the
newest snapshot. The only thing that varies along a row is that strike's own gamma
at that minute, which is the entire point of drawing a trail.

**3. The rows were twice as thick as they should be.** `topFrac` was 3% of the
pane railed to 5-15px — on an 800px pane a 15px radius is a THIRTY-pixel band.
At that size a level stops being a line you read price against and becomes a
region price is usually inside, which tells you nothing. Now 1.2% railed 2.5-6px:
rows 5-12px thick, unmistakably bands, thin enough that four of them leave the
candles legible. Both apps. The core's glow cap came down 9px -> 5px with it — the
dominant level is found by being the biggest row, not the brightest thing on the
chart.

Also gone: v3's `MAX_STRETCH_R`. It stopped each snapshot's stroke at 0.8 of its
own radius, which with thin marks is shorter than the gap between snapshots — so
the strokes no longer met and rows came out dotted. Strokes now reach half way to
their neighbours and meet exactly. A level that held for an hour is one thing for
that hour, so a solid row is also the truer picture; its thickness still carries
the history.

## 2026-08-28 - Bubbles: Auto. Every bubble setting computed from the chart, on both v2 and v3

Edited: `components/dashboard/es-candles/EsChartCard.tsx`,
`components/dashboard/es-candles/slotStore.ts`,
`components/shared/DockToolbar.tsx`,
`cbedge-v3/src/board/gexCandles/bubbles.ts`,
`cbedge-v3/src/board/gexCandles/settings.ts`,
`cbedge-v3/src/board/gexCandles/controls.tsx`,
`cbedge-v3/src/board/gexCandles/chart.ts`,
`cbedge-v3/src/board/gexCandles/GexCandlesCard.tsx`.

Every bubble slider was asking the user a question they could not answer from the
panel, because the right answer depends on things only the chart knows: how many
levels this board actually has, how far the top one is from the rest, how tall
the pane is, how close the bars and the rows land at this zoom. **Auto** computes
all of them, and is ON by default on both surfaces.

**The policy** — `BUBBLE_AUTO` in each app's settings module, with the derivation
as small pure functions beside it so it can be read and argued with in one place:

- **levels** — a strike holding at least 5% of the board's gamma is a level;
  under that it is a wing and drawing it costs a row and buys nothing. Count
  them, clamp to 4-6. Four is the resting number; a genuinely flat board widens.
- **size** — a target top radius of 3% of the pane height, railed to 5-15px, with
  each row past the fourth trimming 5% off it. On v2 auto takes
  `min(1, target / budget)` — it may ask for LESS than the pitch caps allow,
  never more, which is what stops a zoomed-in chart drawing six 20px blobs over
  the candles. The non-overlap guarantee is untouched: auto is not allowed to
  argue with it.
- **floor** (v3) — 14% of the top, 0.8-2.5px, so the weakest drawn level is
  always a visible dot and never big enough to read as a real one.
- **cutoff** (v3) — 6% of the LEADER's share rather than a fixed percent: 0.4% of
  the board means something different when the wall holds 20% than when the
  biggest strike holds 4%.
- **curve / variance** — measured off the median drawn mark's ratio to the top.
  Bunched (median near 1) and a straight-proportional law draws six
  near-identical circles, so the exponent steepens; a real wall pulls the median
  down and it goes back to linear, because the numbers already separate.
- **intensity** — a busier layer sits quieter against the candles.

Data-side values (levels, cutoff) are decided ONCE off the newest column and held
for the whole trail — re-deciding per column makes rows blink in and out as the
session scrolls past. Pixel-side values (size, floor, variance) are per frame,
because every factor they read moves with the chart.

**The sliders stay.** An `Auto` chip heads the Bubbles section on both; while it
is on the rows under it are dimmed and inert (a new `disabled` prop on v2's
`DockSlider` and v3's `Slider`). They are not hidden on purpose: the values they
hold are exactly what comes back the moment Auto is switched off, and a control
that vanishes takes that answer with it. Persisted as `bAuto` per slot on v2 and
`bubbleAuto` in the card blob on v3.

What auto never touches: what a size MEANS. Radius stays proportional to |net
GEX| against the reference under every rule above — auto moves the budget, the
floor and the exponent, never a single mark on its own.

## 2026-08-28 - Bubbles: no fused rails on Auto/1m, top 4 strikes actually lands, and the same rule on v3 GEX Candles

Edited: `components/dashboard/es-candles/EsChartCard.tsx`,
`components/dashboard/es-candles/slotStore.ts`,
`cbedge-v3/src/board/gexCandles/bubbles.ts`,
`cbedge-v3/src/board/gexCandles/settings.ts`,
`cbedge-v3/src/board/gexCandles/GexCandlesCard.tsx`.

**1. v2: Auto + 1m drew solid rails.** `colBoundFloorPx` (7px) was floored UNDER
the column-pitch cap, so on a 1m session fitted to the pane - bars ~4px apart -
every mark got a 7px radius inside a 4px slot and the rows fused into the
horizontal bars the bucket exists to prevent.

The floor was written for the MANUAL 1m/5m buckets, where the columns are
deliberately denser than the candles and the user has asked for sub-bar detail
and accepted fusing to get it. On Auto nobody asked for that: one column per
candle is exactly as much detail as the chart carries, so the pitch is now a
real constraint - `colBound` and `rxCap` both drop the floor when the bucket
follows the candle. Marks shrink to fit the bar and grow back on zoom, which is
the honest answer: a bubble cannot truthfully be wider than its own bar.

**2. v2: the top-4 default now reaches existing charts.** `topStrikes` 5 -> 4
did nothing on any browser that had opened the chart once, because `bLevels` is
persisted per slot and a saved value wins. Added a bubble-DEFAULTS stamp
(`BUBBLE_DEFAULTS_V`, `es-candles-bubble-defaults-v`): when it moves, the keys
in `BUBBLE_DEFAULT_KEYS` are DELETED from every slot blob once and the card falls
back to the constant. Deleting rather than overwriting is what keeps it honest -
the blob goes back to "never set", so the next default change reaches it too.
Runs from `readSlot` (self-healing, like `ensureMigrated`), after the migration
and before the shared seed so a stale key cannot be copied forward. Nothing else
in the blob is touched; this is not a settings reset.

**3. v3 GEX Candles: same selection rule.** `bubbleLevels` changed from PER SIDE
to a TOTAL, default 4, with `BUBBLE_MIN_PER_SIDE = 1` guaranteed. `buildBubbleModel`
now ranks the whole board once and takes the top N, then - only if a side came
out empty - swaps the weakest picked strike for the strongest one on the missing
side. One swap deep, skipped below 2 levels.

Per-side could not express "the top four": on a lopsided board the
fourth-strongest strike is often the third one above spot, and a fixed count each
way drew as many rows below spot as above whether or not they were worth drawing.
The floor keeps what the split was actually for - never a picture of only the
resistance overhead - at the cost of one mark, and only when a side would be
blank. Range is now 1-16 (the old per-side 8 in marks), the slider reads "levels"
instead of "per side", and a `SETTINGS_V` stamp in the stored blob pushes the new
default past saved values the same way v2's does.

## 2026-08-28 - ES Candles bubbles: the bucket follows the candle, and the ladder always has a side under price

Edited: `components/dashboard/es-candles/slotStore.ts`,
`components/dashboard/es-candles/EsChartCard.tsx`.

**1. The bucket is "Auto" now, and Auto is the default.** A bubble's time is its
candle's time, so the trail re-formats with the timeframe switcher instead of
having to be re-picked after it. Auto buckets by the CONTAINING BAR (`barAt()`),
which is the only setting that holds across the switcher: a fixed 5m bucket
stacks twelve columns inside a 1h candle and merges them back into the solid
rail the bucket exists to prevent, and on a 1m chart it throws four minutes out
of every five. `1m` / `5m` stay in the picker as manual overrides for sub-bar
detail on a 15m+ chart.

`BubbleBucket` gained `"auto"`; `"bar"` is the pre-rename spelling of the same
behaviour and is still accepted, still resolves to the same bucketer, and still
lights up the Auto tile in the picker - so a slot blob written before this change
keeps working and a rollback finds a blob it understands. The comparison went
from `=== "bar"` to `isAutoBucket()`, so there is one place that decides what
"follows the candle" means.

**2. The drawn strikes default to the top 4, with at least one on each side of
spot.** `BUBBLE_STYLE.topStrikes` 5 -> 4, and a new `BUBBLE_MIN_PER_SIDE = 1`
guarantee in the per-bucket selection.

The selection was a pure peak-|GEX| ranking, and gamma is routinely lopsided
enough to put all four rows above price - at which point the chart says nothing
about what is underneath it, which is half of the read. If a side comes out
empty, the weakest shown strike (which by construction is on the crowded side) is
swapped for the STRONGEST strike on the missing side, taken from the full
ranking so the row that appears is real gamma and not a nearest-strike stand-in.

It is a floor, not a split: with genuinely one-sided gamma the other three rows
still land on the heavy side, so the guarantee costs one row and only when a side
would be blank. Inert below 2 levels, where honouring it would mean the "levels"
slider drawing more rows than it says.

The swap is decided per BUCKET, not per ranking - spot travels through the ladder
while the ranking rarely moves - but the expensive half is untouched: the sort
stays behind the existing `dirty` flag and the shown Set is rebuilt only when the
swap itself changes. Spot is read in STRIKE space (the bar's close carried across
the same `basisAt()` the marks are drawn through, binary-searched off the bar
array rather than a rebuilt map), and the bubble prep cache key gained spot
quantised to 5 points - the strike pitch - so the cache sees price move without
re-sorting the ranking on every tick.

## 2026-08-28 - Premarket replay: the Post-Market build column was showing the finished day at every frame

Edited: `components/pages/premarket/PostMarketTab.tsx`,
`components/pages/premarket/postMarketData.ts`.

Scrubbing the replay moved the chain but section 3's share column did not: the
same `81% PM +36.1pp` at 09:35 as at 16:00. Nothing was stale. `useIntradayLadder`
returns the WHOLE recorded session for `etDate`, and every quantity in that
section is a function of that array - the per-strike series, the AM/MID/PM build
buckets and their colours, the board totals, the 15:00->close share column, and
outside it the day's price path, the RTH high/low and open-vs-now net GEX. The
right data was being asked the wrong question, which is worse than stale,
because it looks correct.

**The ladder is now cut at `etMin`** - the minute on screen, which on a replay
is the frame's own minute. One filter, and everything downstream follows,
because everything downstream already derived from `cols` and nothing else:
buckets that have not happened yet drop out of `activeBuckets` (and are named in
the legend as not recorded), `pmAnchor` returns null before ~15:00 so the
power-hour column reads "-" instead of a number from the future, and the build
bars grow as the scrubber moves. No new prop: it is a no-op live (`etMin` is the
wall clock, the recorder cannot be ahead of it) and frozen (`etMin` is the settle
+10, the ladder stops at 16:00). Only a replay ever moves it backwards.

**The wall log is cut the same way.** `useRecordedWalls` takes an optional
`throughMin` and filters log + events BEFORE `byLevel` is built, so the three
wall cards and the move list can never disagree about how far into the day it
is. Slot -> minute is `wallSlotMins()`, mirroring `slotMins()` in
`server-v2/walls-recorder.js` (slot 0 = 09:29, then the 15-minute 09:45-16:00
grid) - the route does not guarantee `at`, so the slot is the reliable key.

**Scrubbed back before the open**, the RTH ladder has no columns at all, so
section 3 now says so ("Nothing recorded yet at 08:15 ET - the per-minute ladder
starts at the 09:30 open") rather than drawing an empty frame that reads as a
broken recorder.

No proxy, server, recorder or endpoint change.

## 2026-08-28 - Premarket: the replay transport is docked to the bottom of the page

Edited: `components/pages/Premarket.tsx`.

Replay on /premarket already rewinds the whole page - both tabs, every level,
tile and panel, recomputed from that minute's own captured chain. The control
for it was in the wrong place: a bar under the page head, inside `.wrap`, which
scrolls away after one screen. The page is five screens tall and the thing most
worth watching build is the book on the **Post-Market** tab, well below the
fold, so scrubbing meant scrolling back up to the head for every step.

**The bar is now docked.** It is the LAST CHILD of `.pmk` - this page's own
scroll container (`height:100%; overflow:auto`) - with `position:sticky;
bottom:0`, so it is pinned to the bottom edge of the viewport for the whole
scroll and comes to rest in flow at the very end. Nothing is permanently
covered. An inner `.rplwrap` carries `.wrap`'s max-width so the transport lines
up with the page, and the cyan wash is layered over `var(--plate)` because page
content runs underneath it now.

**One row, not three.** A docked bar spends viewport permanently, so only what
earns it stays on screen: tag, step/play/step, the speed segments, the scrubber
(which shares the row now instead of owning one) and the clock. The coverage
caveats - "the page IS the replay", the +/-N-strike trim note - moved behind a
new circled-i toggle at the right end of the bar. When a session has no frames,
the reason takes the scrubber's place inline rather than leaving a dead track
spanning the bar.

Behaviour is otherwise unchanged: same frames, same speeds, same
land-on-the-last-frame default, same pause-at-the-end, same swap into
`frozenGexOf`. No proxy, server or recorder change.

**Fix, same day:** the first cut of the docked-bar comment wrote the class name
as a backticked `.pmk` INSIDE the `const CSS = \`...\`` template literal. A
backtick in a template literal closes it, so everything after it parsed as a
tagged-template call and the page threw
`TypeError: ...pmk is not a function` on mount. CSS comments in this file are
inside a template literal - no backticks in them, ever.

## 2026-08-27 - ΔGEX Board: a green/gold/red trust chip on the run stamp, and the EOD sweep no longer crosses the feed roll

Edited: `server-v2/eod-strike-gex-recorder.js`, `owner-vite/src/pages/GexGrowth.tsx`.

Tonight's board carried `run 2026-08-27 20:01:52 ET`. That stamp was real - it is
`captured_at`, taken before the first chain fetch - but it was not the 16:05
slot. The scheduler fires at `RUN_AT_MIN` (965 = 16:05) **or on any later boot the
same evening**, and the catch-up window ran to 22:00 ET. The 16:05 run did not
land, something restarted around 20:00, the 45s post-boot check fired, and the
session was recorded four hours late.

The old comment said capturing at 19:40 after a restart is "just as correct as
16:05". That is true of the OI half and false of the volume half. The upstream
feed rolls its trading day at 20:00 ET and the roll zeroes the chain's
day-volume field, so a sweep starting at 20:01 writes `OI(T-1) + Vol(empty)` as
session T's close: `vol_gex` zeroed, `net_gex` silently reduced to the OI-only
number, and the oivol delta against T-1 wrong by a full session of volume.

**1. The catch-up window now closes before the roll.** `WINDOW_CLOSE_MIN`
1320 -> 1185 (19:45 ET), fifteen minutes of margin. The cost of closing early is
"no session recorded", which the board shows; the cost of staying open was a
quietly wrong session, which it could not. Anything later is now a deliberate
`POST /proxy/eod-strike-gex-run`, not something the scheduler does on its own.

**2. A zero-volume guard, as the second line.** A board carrying open interest
and no volume anywhere is not a quiet session - a strike with 40k OI traded
something. `runSweep()` now detects that shape and writes `vol_*` as NULL rather
than as zero, so the `vol` basis reports "nothing recorded for this session"
(the read path already branches on `hasBasis`) instead of a flat zero board a
reader would take at face value. It triggers on the DATA, not the clock, so it
also catches a roll at an hour nobody expected. `net_gex` is left as computed -
it is the legacy series and never NULL, and breaking a year of level continuity
to patch a row `WINDOW_CLOSE_MIN` should have prevented is the wrong trade.

**3. Catch-up sweeps say so in the log.** Any run more than 30 minutes past the
16:05 slot logs `CATCH-UP sweep at HH:MM ET (Nm past the 16:05 slot)`. Healthy
path, never the intended one, and somebody will ask why the stamp is off.

**4. The run stamp says which phase of the day it is in, and one chip says
whether that matters - the actual ask.** A clock alone does not tell you if the
data is premarket, live, after hours or past the roll. The stamp now reads
`run 2026-08-27 20:01:52 ET - overnight`, with the phase in words from
`capturePhase()` on the US equity day in ET: 04:00-09:30 premarket, 09:30-16:00
live session, 16:00-20:00 after hours, 20:00-04:00 overnight, plus weekend.

A first pass coloured that phase directly and it read as noise, because the
phase is not the verdict. Whether "premarket" is fine or alarming depends on the
BASIS: the OI basis is *supposed* to be stamped premarket - that is the 09:25
settled-OCC re-stamp doing its job - while on any basis carrying volume the same
stamp means the number came off a session that had not traded. So the chip is
now a traffic light and one word, from `captureVerdict(iso, basis)`:

| | meaning |
|---|---|
| green `good` | captured where this basis is meant to be captured - 16:05 +/-55m for volume bases, the 09:25 re-stamp for `oi` |
| gold `late` | off-slot, but nothing about the number is damaged. Something did not run on time; the value still holds |
| red `suspect` | off-slot in a way that eats the number - volume read mid-session, before the open, or past the 20:00 feed roll |

`oi` can never be worse than `late`: the settled file does not move again until
tonight, so no capture time damages it, and "not re-stamped yet" is already
stated outright by the SETTLED / PROVISIONAL chip beside it. Every other basis
carries volume, which is a live accruing field, so its window is narrow.

The hover carries the whole story - the stamp, the phase, how many minutes past
16:05, and what specifically is wrong with the number. Tonight's row reads
red `suspect`. The prior-session tooltip gained the same phase suffix via
`fmtStampWithPhase()`, so a delta between two differently-phased captures is
visible without opening anything. `toneChip` gained a fourth tone, `info`
(`LIGHT_BLUE`), for states that are a fact rather than a verdict.

Holidays are not detected - the page has no calendar - so a holiday capture
reads as whatever its clock says, with the date beside it.

## 2026-08-27 - Fix: section 3's ladder rendered all 121 strikes instead of filling the column

Edited: `components/pages/premarket/PostMarketTab.tsx`.

The previous change gave the build-time ladder `flex:1 1 auto` so it would fill
its column. `flex-basis:auto` means the item's base size is its CONTENT - all
121 rows, ~2,500px - and a column flex container reports that as its max-content
height. The auto-sized grid row grew to fit the entire ladder, the overflow
scroller had nothing left to scroll, and section 3 became a page four screens
tall opening at strike 400 with the close nowhere near the middle.

`flex:1 1 0`. The ladder now claims no height of its own and takes only what is
left over, so it ends up exactly as tall as the wall-migration / written-vs-traded
column beside it - about 30 strikes - and the close centres in it again.
`min-height:440px` stays as the floor, and doubles as the flex item's
hypothetical size, so it (not the content) is what an auto grid row falls back
to when the right column is short.

## 2026-08-27 - Post-Market section 3: centres on the CLOSE, and fills the card

Edited: `components/pages/premarket/PostMarketTab.tsx`.

Two things about "How the book was built".

**1. It opens centred on the closing price, not on a strike near it.** The
ladder used to find the listed strike nearest spot and centre that ROW, which on
a coarse grid parks the viewport up to half a strike off - a close at 355.20 on
a 2.50 ladder put 355 in the middle. It now computes the CONTINUOUS row index of
`closePx`, interpolated between the two strikes that bracket it, so the closing
price itself lands in the middle of the space given. `closePx` is the captured
close on a frozen or replayed session and the live spot on a running one - the
same number every other grade in the tab is measured against. The button reads
"back to close" now, because that is what it does.

**2. The ladder fills the column instead of stopping at 440px.** `.chart` caps
every ladder on the page at 440, which is right for the short ones on the
Premarket tab and wrong for this one: section 3's other column carries the
wall-migration chart AND the written-vs-traded rows, so the grid row is far
taller - the ladder stopped halfway down with several hundred pixels of empty
card under it while the strikes it could not show were a scroll away. The column
is a grid item and is already stretched to the row's height; it is now a flex
column and the ladder grows into that height (`min-height:0` is what lets it
scroll rather than render all 121 rows).

- Below 1180px `.body` collapses to one column, the column's height becomes its
  own content, and a flex child with an indefinite parent ignores flex-grow - so
  the 440 cap comes back in that media query. Without it section 3 would render
  every strike at full height and become a page.
- `min-height` is the old 440, so a session where the right column happens to be
  short never shows LESS than it did before.
- Centring now re-runs on a **ResizeObserver**. The viewport height is not known
  until the sibling column has laid out, so centring once on mount would measure
  the wrong `clientHeight` and leave the close half a card high. It only fires
  while pinned, so it can never yank a reader who scrolled off to a wall.
- The 21px row pitch was a literal in the stylesheet AND in the scroll maths.
  It is one `EV_ROW_H` const now, interpolated into the CSS - a one-pixel edit
  to the CSS would otherwise have parked the close a row and a half off centre
  at the bottom of a 121-row ladder with nothing on screen explaining why.

## 2026-08-27 - Fix: /premarket blank-screened on a stray backtick in the replay CSS

Edited: `components/pages/Premarket.tsx`.

`TypeError: ....pagehead is not a function` at page load, on every build of the
replay change.

The replay bar's CSS comment explained where the transport lives by naming the
head's class in backticks - inside the `const CSS = ` template literal. The
first backtick CLOSED the literal, `.pagehead` became a member access on the
resulting string, and the next backtick opened a fresh template - so the rest
of the stylesheet parsed as a **tagged template call** on a property that does
not exist. It is valid JavaScript, which is why esbuild and the Docker build
were both perfectly happy and it only failed in the browser.

Backticks removed from the comment. Also verified by walking the literal
character by character (skipping `${...}` interpolations) that it now closes
where it should - at the `;` that ends the constant, not 270 lines early.

Rule for this file: no backticks inside CSS, POSTMARKET_CSS, HISTORICAL_CSS,
GEX_WATCH_CSS or GAMMA_BELL_CSS, comments included.

## 2026-08-27 - /premarket is replayable: the whole page, minute by minute

Added: `server-v2/premarket-replay-recorder.js`,
`components/pages/premarket/postMarketData.ts` (hooks),
`components/pages/Premarket.tsx` (transport bar + one swap branch).
Edited: `server-v2/server-with-proxy.js` (two new routes + boot line),
`server-v2/premarket-freeze-recorder.js` (one export).

The freeze already proved the shape: a captured `/proxy/snapshot` swapped in at
the ONE line where `useMobileGex` is destructured, and every memo, panel and
both tabs run unchanged. Replay is that swap fed a **series** of payloads - so
there is no replay rendering path to drift.

- **Recorder.** `premarket-replay-recorder.js` takes the SAME capture every
  **5 minutes from 04:00 to 16:25 ET** into a new `premarket_replay` table
  (PK date/symbol/minute, minute floored onto the poll grid so a restart
  upserts a slot rather than littering the timeline). It calls the freeze
  recorder's own `shapePayload()` - which is now exported for exactly this
  reason - instead of re-deriving the shape, so the two stores can never
  disagree about what "the page's inputs" are.
- **Frames keep +/-20 listed strikes around that minute's spot.** An untrimmed
  SPX 0DTE board is ~100KB; a whole session of those would not fit in one
  request, and one request is what lets the scrubber run with no per-frame
  round trip. Retention 88 calendar days (~60 sessions).
- **What survives the trim, and what doesn't - stated on screen.** Walls, gamma
  flip, total net GEX and total flow GEX are the SERVER's full-board numbers and
  pass through untouched, so the headline levels on a replayed frame are what
  the live page showed at that minute. Max pain, the DEX/vanna totals and the
  profile's / bell curve's wings are scanned off the chain by the page, so on a
  replayed frame they are over the +/-20 window. The replay bar says so rather
  than letting a narrower number pass as the full-board one.
- **Proxy routes** (read-only GETs, subscriber-gated by proxy-auth like their
  neighbours; `sessionCacheOpts` lets a browser keep a past session for a day):
  `GET /proxy/premarket-replay?date=&symbol=` (a whole session in one answer),
  `GET /proxy/premarket-replay?dates=1&limit=` (flags only, for the picker),
  `POST /proxy/premarket-replay-run` (owner-only manual frame, seeds today
  right after a deploy).
- **The page.** A `Replay` toggle beside the session picker, then a transport
  bar under the head: step back / play-pause / step forward, 0.5x-8x, a
  scrubber, and the frame's own ET clock + spot + frame count. Speeds and the
  700ms base tick are ChainReplay's and Multi Greek's numbers on purpose, so
  the three replays on the site feel like one control.
- **The clock rewinds too.** `viewMin` takes the FRAME's minute, so
  "22 min to open", the RTH-open / after-the-close label and the Post-Market
  tab's in-progress vs finished state all read as the moment being replayed. A
  replay whose clock stayed on the wall time would show 10:05's chain under
  "after the close".
- The session picker now marks dates: `>` replayable, `*` captured (freeze
  only), blank = recorded-stores recap. A replayable date drives the real tabs
  even with no freeze row. Replay wins over a frozen slot on the same date.
- SPX only and no back-fill, for the same two reasons the freeze is and cannot:
  the recorder captures the one symbol the socket carries, and nothing stores a
  past session's per-strike marks and volume.

Not touched: the live path, the frozen path, `useChainGex`, HistoricalRecap.

## 2026-08-27 - Premarket gamma bell curve: the OI tab is now OI + Vol GEX

Edited: `components/pages/premarket/gammaChartKit.ts`,
`components/pages/premarket/GammaBellCurve.tsx`.

The Gamma Bell Curve's **Basis** toggle was `OI` (strictly `net - vol`) vs
`VOL`. SPX trades nearly around the clock now, so by the time anyone opens
/premarket the volume leg is real, not empty - and stripping it out was drawing
a bell through half the board.

- **`OI` -> `OI+VOL`.** `rowNet()` on that basis is now plain
  `netGEXOf(row, "net")` (the OI leg PLUS the volume leg) instead of
  `netGEXOf(row, "net") - netGEXOf(row, "vol")`. `rowMass()` matches:
  `|call GEX| + |put GEX|` on the `net` leg, no subtraction.
- **`VOL` is unchanged and is still volume only** - `netGEXOf(row, "vol")`. The
  two tabs are now "everything on the board" vs "today's trading only", and the
  gap between them is the carried-in OI.
- Tab label, long name and tooltip updated in `BASIS_META`; the empty-state
  copy now says "Switch to OI+VOL". The stored preference key
  (`cb-premarket-gbell-basis-v1`) and its `"oi"` value are untouched, so an
  existing user lands on the new combined basis with no reset.

Scope check: `BASIS_META` / `rowNet` / `rowMass` / `useWideBins` are imported
only by `GammaBellCurve.tsx`. The Key Levels tiles on Premarket.tsx use their
own `LVL_BASIS_META` and `oiLeg()` and were NOT touched.

## 2026-08-27 - Multi Greek: the identity band is gone from the toolbar

Edited: `app/mult-greek/MultGreekClient.tsx`.

The `08-27 - 0DTE - 2026-08-27` band under the toolbar came out, so the page
chrome is one row of text again. It was a second row above the cards saying two
things already on screen: the front expiry is the first column header of every
panel, and the session is today.

It still renders while a screenshot is being taken (`isCapturing`), because an
exported PNG leaves the page behind and has nothing else to say WHICH session
and WHICH front expiry it is of - the same reason the lookup card puts its band
directly on top of the thing being captured. In replay it also carries the
rewound clock and the `recorded walls only` disclosure into the image. Say the
word if the exports should lose it too.

## 2026-08-27 - Multi Greek: all four ticker slots are typeable, defaults SPX / SPY / QQQ / NDX

Edited: `app/mult-greek/MultGreekClient.tsx`.

Three of the four panels were hardcoded to SPX / SPY / QQQ and only the 4th had
an input. Now **every panel's symbol IS an input** - type a ticker, Enter (or
click away) to load it, Esc to abandon the edit. The board defaults to
**SPX / SPY / QQQ / NDX** on a cold start and remembers the line-up after that.

- The header no longer shows a big label AND a little box repeating it: the
  input is styled as the label it replaced (17px, cyan, on a hairline box) and
  is the only control there. Across four panels that duplication was most of
  the header row.
- Persisted as one array under `mg_tickers`. The old single-slot key
  (`mg_custom_ticker`) is read once on first run and carried into the 4th slot,
  so an existing user's choice survives; it is never written again. A stored
  array that is short, long or has a junk entry contributes the slots it got
  right and the rest fall back to the default, rather than the board coming up
  empty.
- **Duplicates are refused.** Two panels on one symbol would share a React key
  AND a `strikes[ticker]` entry - one board, two cards, one set of data - so a
  commit onto a symbol another slot holds is rejected and the box snaps back to
  what the card under it is showing. An empty box means "put it back" (that
  slot's default), not "remove the panel": the board is four cards wide and
  stays that way.
- Static/delayed mode is unchanged and still not editable: the snapshot
  recorder only carries SPX / SPY / QQQ (`STATIC_TICKERS`). A caller that pins
  the line-up with the `tickers` prop (the /board single-ticker card) hides the
  inputs for the same reason - they would edit slots that are not on screen.

The line-up feeds a dozen effects that reload on change, so it is keyed off a
joined STRING rather than the array identity, and `commitSlot` reads the current
line-up and box text through refs - a callback that re-created itself on every
keystroke would re-render all four panels.

## 2026-08-27 - Multi Greek: no "+" on positive GEX, and the sign is the same colour as the figure

Edited: `app/mult-greek/MultGreekClient.tsx`.

Every GEX figure on the board carried an explicit sign, and that sign was drawn
in its OWN colour - a green "+" or a red "-" in a `<span>` ahead of the number,
which itself is blue (positive) or red (negative). Two problems in the one place
on the page with no room to spare: a "+" on every positive cell is a whole
column of ink saying what the absence of a minus already says, and a green plus
in front of a blue figure reads as two facts rather than one number.

Now: **negative gets a `-`, positive gets nothing**, and the sign is part of the
same run of text as the figure, in the cell's own colour. Applied in `fmtCell`
(the ladder cells and the column TOTAL row) and to the click card's live NET GEX
readout.

The click card's 15m / 30m / open rows keep their "+": those are CHANGES, where
`+1.2M` and `1.2M` mean different things and the plus is the reading, not
decoration. `fmtMoney` now takes a `signed` flag to say which of the two it is
formatting, defaulting to the change behaviour. The Δ stamps in the cells are
unaffected for the same reason.

## 2026-08-27 - Multi Greek: columns are 1/2/3 + an ALL toggle, and the panel header no longer hijacks a double-click

Edited: `app/mult-greek/MultGreekClient.tsx`.

**1. Double-click-to-open-the-chain is gone.** Double-clicking a panel header
opened that ticker's full-screen option chain over the four cards. It fired on
ANY double-click anywhere on that bar - including one aimed at the 4th slot's
ticker box - and it hung a permanent `Double-click for the full-screen SPX
option chain` tooltip over the first column header, which is what you actually
saw most of the time. Removed with everything behind it: the `onExpandChain`
prop, the `chainTicker` state and its Esc handler, the overlay, and the
`lazy(() => import("@/components/pages/OptionsChain"))` that fed it. The header
keeps `userSelect: none` and drops the `zoom-in` cursor. `/options-chain` is
still one nav click away, and the toolbar's Ticker Lookup is untouched.

**2. Board -> Columns is now `1 2 3` plus an ALL tile.** The 1-4 picker folded
two different questions into one number, because at 4 the last column was the
ex-0DTE TOTAL - so the only way to see the total was to also accept three expiry
columns, and "2 columns + the total" could not be asked for at all. Now:

- `1 / 2 / 3` - how many individual EXPIRY columns every panel draws
  (`mg_col_count`, clamped 1..3 on read, so an old stored `4` lands on 3).
- **ALL** - a `ToggleTile` beside it, on or off, appending the ex-0DTE TOTAL
  (`mg_show_all`, default on). 3 + ALL is the default and is the board exactly
  as it shipped; the panel is never wider than four columns either way.

**ALL now sums every expiry the panel HAS, not just the ones on screen.** That
is what the `EX-0DTE` header has always claimed, and it is what makes `1 + ALL`
a useful board rather than a duplicated column: front expiry beside the whole
book behind it. Mechanically, rows are computed over the UNION of shown +
summed dates so a hidden expiry can carry its per-strike GEX into the sum, and
`cols` is trimmed back to the drawn dates before the grid is built - a strike
that exists only in a hidden expiry gains a row (correct: it has an ALL value),
but nothing draws a column for one.

The total is now always APPENDED and never swaps itself in for the last expiry,
so `withEx0Column`'s `replaceLast` path is no longer used from here and the
live/replay split that gated it (live needed exactly 4 columns, replay needed
2+ non-0DTE) is gone - it is gated on the sum existing at all, and otherwise on
the user's toggle.

Data loading is unchanged: all four closest expiries are still fetched, so
changing the count or flipping ALL repaints immediately with no refetch.

## 2026-08-27 - Multi Greek: the ATM row gets the option chain's white rule, strike rail down to 11px

Edited: `app/mult-greek/MultGreekClient.tsx`.

**ATM is now ringed in solid white on every skin, drawn the chain's way.** The
row used to take a real `2px solid rgba(255,255,255,.55)` border, and only under
the CLASSIC skin - VIVID marked ATM with a chip and nothing else. Two problems:
a real border adds 4px to the row, so the ATM row stood taller than every other
one and the whole ladder shoved 4px every time spot crossed a strike (the rule
appeared to JUMP rather than move one row); and which strike spot is sitting on
is not a cosmetic preference a skin gets to switch off.

Now it is an INSET box-shadow ring - `inset 0 ±2px 0 #ffffff` plus the two side
edges - painted over the row, so the geometry never changes, in the same solid
`#ffffff` the option chain page uses for its ATM rule (`atmShadow` in
`OptionsChain.tsx`). Drawn for both skins. `SkinDef.atm` survives but now only
decides whether the "ATM" chip rides beside the strike as well; its doc comment
says so.

**Strike rail 13px -> 11px.** The rail is the row's label, not its reading, and
at 13 it outweighed the GEX figures beside it. The rail's own 64px track,
padding and centring are unchanged, so nothing else in the row moves.

## 2026-08-27 - Multi Greek: pick how many expiry columns the board shows

Edited: `app/mult-greek/MultGreekClient.tsx`.

**Expiry columns are now 1-4, set once for the whole board.** Multi Greek always
drew a fixed four columns. Cog -> Board -> **Columns** now takes 1, 2, 3 or 4 and
every panel follows it. Saved per browser in `localStorage` under
`mg_col_count`, clamped to 1..4 on read as well as on write, defaulting to the
full four - a user who never opens the control sees exactly what they saw
before. The bar's state readout adds `- N COL` only when it is NOT the full set,
and the cog's Board row leads with it (`3 cols - OI+VOL`), so a narrowed board
says so with the menu shut.

One setting, not one per panel: the four ladders are read ACROSS - the same
expiry column on SPX, SPY, QQQ and the 4th slot - so panels on different counts
would stop lining up and the board would stop answering the question it exists
to answer.

The number counts COLUMNS ON SCREEN, not expiries, because at the full count the
4th column is the synthetic ex-0DTE TOTAL and the 4th expiry folds into it
(`withEx0Column`). So 4 = three expiries plus the total; 3 = three expiries and
no total. A panel whose own calendar is short (or a replayed session - the
recorder keeps three expiries a sweep) just shows what it has.

Sliced once, at the panel call site, into the `cols` prop - so the rows, the
walls, the totals row, the ex-0DTE swap and the grid tracks all follow from the
same place and there is no second notion of "which columns" to keep in sync.
Nothing about data loading changed: the chain fetches and socket subscriptions
still cover the full expiry set, so changing the count repaints immediately with
no refetch.

## 2026-08-27 - Level Log: 0DTE/non-0DTE + OI+Vol/Vol-only switches, CORE means CORE, a pop-out week chart, scanner sweeps every minute

New: `server-v2/scanner-variants.js`.
Edited: `server-v2/scanner-recorder.js`, `server-v2/walls-recorder.js`,
`server-v2/server-with-proxy.js`, `components/pages/LevelLog.tsx`.

**1. CORE said two different numbers on one page.** On MSFT the Wall Migration
chart read CORE 505 under the ALL view and CORE 500 under the CORE view, same
ticker, same day. Not a data bug: the chart carried a "role" model where CORE
meant *whichever WALL carried more gamma at that slot* (505 was the call wall),
while the ticker rail, the timeline, the copied text and the CORE view all mean
the recorded `cb` strike (500). Defensible on its own terms, wrong on a page
where one word has to be one number.

The role model is gone. The chart now draws one line per RECORDED level - put
wall, call wall, CORE - each in the colour the rest of the page already uses for
it, with the corridor between the two walls shaded. CORE is drawn last, so where
it sits ON a wall (usual: the biggest node on the chain is normally also the
biggest node on one side of spot) the blue reads on top instead of one line
silently hiding under another. The 5m gamma series the roles were computed from
is no longer read by the chart.

**1b. Level colours.** CORE is gold, the call wall green, the put wall red —
everywhere the page draws a level: the rail column heads and cells, the capture
rail, the migration chart and its legend, and the timeline badges. Sourced from
`homeTheme`, not hardcoded: CORE and the put wall take `LEVEL_COLORS.cb` / `.pw`
(the same gold and red Multi Greek and the level snapshot renderer use), and the
call wall takes `ES_CANDLE_UP`. Deliberately not `LEVEL_COLORS.cw` (blue) or
`HOME_THEME.green` (which is the status palette's light blue, `#8ECAE6`) —
neither reads as GREEN beside a red put wall, which is the entire point of the
pairing.

**1c. Wall migration pops out, and does a week.** An `⤢ Expand` button in the
chart's header opens it full width at ~2.2x the height, over a scrim, Esc or
click-outside to close. Inside it, a range switch: **Today** (reuses the session
already loaded — no refetch for what is already on screen) or **5 sessions**,
which walks back weekdays from the selected date and draws the last five that
actually recorded rows.

Same component either way. `WallMigrationChart` now takes an ARRAY of day slices
instead of one day's log — one entry is the inline chart, five is the week — so
there is no second implementation to drift. Each session gets an equal slice of
the width and they all share **one** price scale, which is the point: a wall
holding its strike across the week draws as one flat run. Nothing is drawn across
a session boundary (solid divider per day) because the overnight is a gap the
level did not travel through.

`useWallDays` fetches in two waves and is best-effort throughout: the small level
logs go out for more candidate weekdays than needed, the newest five that came
back with rows are kept, and only THOSE get a 1-minute tape request — so a
holiday never costs a candle fetch. Levels render as soon as the logs land; the
tape sharpens the price line on a second pass rather than behind a spinner. The
popout honours the page's WALLS/CORE/ALL view and both variant switches, and is
mounted only while open, so the 5-session fetch never runs for a reader who did
not ask for it.

**2. Two new switches on the Level Log — four recorded variants.**

| switch | values | meaning |
|---|---|---|
| expiry scope | `0DTE` / `Non-0DTE` | `chain.expirations[0]` alone, vs every OTHER listed expiration summed per strike |
| GEX basis | `OI + Vol` / `Vol only` | `netGEX + netVolGEX`, vs `netVolGEX` alone - today's flow with the book removed |

Both default to the historical pair (0DTE + OI+Vol), so a first load is the log
this page always gave. Switching either one **re-fetches**; nothing is derived
client-side, because a different basis is a different argmax, not a re-slice of
the rows already on screen.

Recording, not computing. `scanner-recorder.js` now writes all four readings per
ticker per sweep into a **new `scanner_variants` table**, and `walls-recorder.js`
runs its whole slot pass once per variant, tagging `walls_log` / `wall_events`
with `expiry_scope` + `basis`.

`scanner_snapshots` is UNTOUCHED and still gets exactly one row per symbol per
sweep on the default variant. That was deliberate and is the same reasoning
`forward-scanner-recorder.js` documents for its own separate table: every
existing reader of that table (`walls-recorder.sampleUniverse`,
`walls-reach.getWatch` / `buildSessionRows`, `/proxy/scanner`, the forward sweep)
does `SELECT DISTINCT ON (symbol) ... ORDER BY ts DESC` and would have been
handed an arbitrary one of four rows. Nothing that worked yesterday reads
anything new.

The two bases are free - same computed rows, different wall metric. Only the
aggregate leg costs upstream calls, so it rides its own sub-cadence and is
bounded: `SCANNER_AGG_MAX_EXPIRIES` (4), `SCANNER_AGG_MAX_DTE` (45),
`SCANNER_AGG_EVERY_N_SWEEPS` (5). `SCANNER_VARIANTS_ENABLED=0` writes the legacy
row only.

**3. `/proxy/walls` takes `&scope=` and `&basis=`.** Both opt-in, both falling
back to the historical pair, on the day view, the per-symbol log and the
`&series=1` read. A request naming neither returns byte-for-byte what it always
returned. The `series=1` branch reads `scanner_snapshots` for the default variant
and `scanner_variants` for the other three, so it cannot regress on a box where
the new table is still empty.

**4. Scanner sweep 5m -> 1m.** `SCANNER_INTERVAL_MINS` defaults to 1. The walls
grid still writes on its own 15-minute slot clock - this is how FRESH the sample
under each slot is, and a 5-minute-old wall on a 15-minute grid meant a third of
the slot could already be stale. A sweep that outruns the interval is **skipped,
not queued**: the next tick is 60s away and carries fresher numbers than the one
that was dropped.

**Schema, all additive and idempotent:** `scanner_variants` (new);
`walls_log` / `wall_events` gain `expiry_scope TEXT DEFAULT '0dte'` and
`basis TEXT DEFAULT 'oivol'`, so every pre-existing row is correctly labelled as
the reading it always was. The old narrow UNIQUE constraints on both tables are
dropped **by column set, not by name** (they were created inline by CREATE TABLE,
so the name is whatever Postgres generated) and replaced by variant-aware unique
indexes - without that, three of every four writes would be swallowed by
`ON CONFLICT DO NOTHING`.

Non-0DTE and vol-only logs are recorded **forward only**; nothing reconstructs
them for past sessions, and the page says so rather than showing an empty log
that reads as a quiet session.

## 2026-08-27 - Premarket: same layout on every ticker, and Vanna stops lying

Edited: `components/pages/Premarket.tsx`,
`components/pages/premarket/chainGex.ts`,
`components/pages/premarket/PostMarketTab.tsx`.

Tightening of the "one page for every symbol" change above. Two things were
still not *the same page*, just a close relative of it.

**1. A non-SPX board had an extra row.** The overnight column grew a
`{SYM} change` stat that SPX does not have, so the column was a different height
and the card below it started at a different place depending on which symbol was
picked. Removed. The symbol's own change already has two slots on this page -
the regime KPI and the Spot tile's sub-line - and both are the ES slot on SPX
and this symbol's slot everywhere else. Same shape, different number, which is
the whole rule.

`ES change` and `NQ change` stay on **every** board, in the same two slots they
occupy on SPX. They are the market's context for whatever name is on screen.

The footer strip likewise no longer drops its ES segment on non-SPX symbols.
`gex.esFut` rides the socket's `aux` frame and is 0 on the poll path, which was
the reason for the conditional - but `/api/quotes-batch` is already pulling `/ES`
on every board for the row above, so the footer reads that instead. Identical
strip, real number.

**2. Vanna was printing a confident `$0` on any chain-poll symbol.**
`netVanna` / `netVolVanna` are published PER STRIKE by
`server-v2/computation/vex-chex.js` off a per-contract vanna. A chain that does
not carry one has **no vanna** - not a vanna of zero - and `?? 0` summed across
such a chain into a tidy `$0` that reads as "vanna nets out here" when it means
"we were never told".

- `chainGex` now reproduces `computeVexChexRow` exactly - vanna x contracts x
  spot x 100, calls +, puts - - **when** the payload carries a per-side `vanna`,
  and leaves the legs undefined when it does not.
- `totals.vanna` is `number | null`; the tile renders `—` with "no per-contract
  vanna on this feed" underneath, on both the Premarket and Post-Market tabs.

It is deliberately NOT rebuilt from Black-Scholes. The server's own `bsGreeks`
returns zero for T = 0, so a client-side rebuild would print a vanna on a 0DTE
board that the SPX board beside it does not - two tiles, same label, different
scales. DEX needs no such caveat: `netDEXOf` falls back to `calculateNetDEX`,
which rebuilds it from the raw signed deltas by the same formula the server uses,
so it is the same number either way.

**Unchanged and confirmed:** the gamma bell curve renders on every symbol - it
reads the raw legs through `rowMass`/`rowNet`, and its price labels went through
the decimals fix in the entry above. The only per-symbol difference left on the
page is content, not structure: the ES basis lines (which do not render when
`basis` is null, exactly as they already behaved), the overnight window's
instrument, and the prior-close baseline's server-side symbol allowlist.

## 2026-08-27 - Premarket / Post-Market: ONE page for every symbol (TickerBoard retired)

Edited: `components/pages/Premarket.tsx`,
`components/pages/premarket/chainGex.ts` (**new**),
`components/pages/premarket/PostMarketTab.tsx`,
`components/pages/premarket/postMarketData.ts`,
`components/pages/premarket/GammaBellCurve.tsx`,
`components/pages/premarket/TickerBoard.tsx` (tombstoned, no longer mounted).

Follow-up to the picker change earlier today. Opening the picker to the MAIN
watchlist exposed the real problem: **SPY and QQQ were never the same page.**
They were routed to `TickerBoard`, a second, smaller board carrying roughly a
third of what /premarket draws. Missing on every non-SPX symbol: the regime
strip, the GEX level rail, the six Key Levels tiles and their prior-close
migration lines, the scrolling GEX profile with DEX / vanna / call-put gamma,
the expected-range track with conviction, the gamma bell curve, sector heat,
catalysts, the playbook - and a Post-Market recap that was a summary rather
than the recap.

Now every symbol renders **the same page, both tabs, all panels.**

### How, without duplicating anything

The page was already built on ONE destructuring - `const { chain, spot, flip,
callWall, putWall, … } = gex` - with two sources behind it (the live socket, and
a frozen capture for past sessions). Everything below that line reads only those
values and cannot tell which source it got. That is what made a frozen session
the *real* page rather than a second implementation of it.

So this adds a **third source** rather than a second page:

| source | symbol | transport |
|---|---|---|
| `useMobileGex` | SPX | live socket (`lib/gexSocket`) |
| `frozenGexOf`  | SPX | that session's captured chain |
| **`useChainGex`** (new) | any ticker | `/api/expirations` + `/api/chains`, 1m poll |

`chainGex.ts` returns the same shape with **raw per-strike legs** - gamma, delta,
OI, volume, marks, IV - never a pre-summed `netGEX`. That is load bearing: the
page's OI / OI+VOL / VOL switch recomputes every leg through `lib/calculations`,
and a pre-summed row would have frozen one basis in and silently ignored the
switch (see `netGEXOf`'s fallback branch). Scale and sign match the server
calculator exactly: gamma x (OI+Vol) x S^2, calls +, puts -.

Result: an NVDA board is *this page's own code* computing NVDA's walls, CORE,
max pain, expected move, DEX and playbook from NVDA's own chain. There is no
second rendering path left to drift.

### The three server reads that were pinned to SPX

`PostMarketTab` now takes a `symbol` prop, and it is not a label - it routes:

- `useIntradayLadder(…, symbol)` - the per-minute strike ladder **and the price
  path that comes with it**. The route resolves an absent `symbol` to `$SPX`
  server-side, so a TSLA recap without it would have drawn SPX's ladder, SPX's
  intraday high/low and SPX's close under a TSLA heading.
- `useRecordedWalls(etDate, symbol)` - was hardcoded `"SPX"`.
- `useNextExpiryStructure(…, symbol)` - the SPX-in-the-URL bug fixed earlier
  today, now actually exercised by 13 more symbols.

All three already have real per-symbol data: `walls-recorder` samples the newest
scanner row per symbol, and `etf-gex-recorder` covers MAIN on its hot lane.

### Scale - the quiet half of this change

Everything on this page was written for SPX, where a level is a whole number and
"1 point" means noise. That does not survive contact with a $180 name.
`fmtPx(strike, 0)` turns a 187.50 strike into "188"; a 1-point "flat overnight"
threshold is 0.6% on NVDA. Replaced with values derived from the board itself,
each of which evaluates to **exactly the old constant on SPX**:

- `kDp` - strike decimals, read off the ladder's own step.
- `pxDp` - traded-price decimals (`spot >= 1000 ? 0 : 2`).
- `pxEps` = 0.015% of spot (was a literal `1`) - the flat/held/wall-moved tests.
- `pinEps` = 0.15% of spot (was `10`) - the magnet "pinning" pill.
- `gapEps` = 0.004% of spot (was `0.25`, one ES tick) - the flat-gap test.
- `tol` in PostMarketTab: `Math.max(3, spot*0.0005)` -> `Math.max(0.01, spot*0.0005)`;
  that absolute `3` was a 10% tolerance on a $30 name.
- `GammaBellCurve` printed every price through `nf0()` (whole numbers only) -
  now a price formatter with the same decimals rule. GEX magnitudes still use
  `fmtB`; only prices changed.

### What is still SPX-only, and says so

Named on screen rather than faked:

1. **ES basis** and every "ES 6,812" sub-line. There is no future behind AAPL,
   and a futures print run through a basis is not a cash price - that is exactly
   how a "BROKE THE PUT WALL" card once printed a low SPX never traded. The KPI
   reads `NVDA 182.40 +1.2%` instead, and the ES sub-lines simply do not render.
2. **Frozen past sessions.** The freeze captures the one symbol the socket
   carries. Picking a past date still snaps back to SPX.
3. **The overnight window's instrument.** SPX reads the ES Globex session from
   18:00; every other symbol reads **its own recorded candles** through
   `useEtfCandles` (`etf_candles`, MAIN on the hot lane, live dxLink fallback
   server-side) - the same window logic, that ticker's own extended session, and
   the header says which. ES and NQ change stay on every board as market
   context, with the symbol's own change added above them.

### Known gap - needs a server decision

**Prior-close baseline.** The page now sends `&symbol=` to
`/api/premarket-baseline`, and the route already understands it - but
`server-v2/premarket-baseline.js` has `ALLOWED_SYMBOLS = new Set(['$SPX','SPY','QQQ'])`.
So the "vs prior close" chip, the Key Levels migration lines and the "Biggest GEX
Changes" card fill in for SPX / SPY / QQQ and show their normal empty state on
the other eleven. That allowlist exists on purpose - the miss path starts a full
settled-chain ThetaData sweep per symbol and nothing coalesces a loop over them -
so widening it is a deliberate cost decision, not a typo. **Not changed here.**

`TickerBoard.tsx` is no longer imported by anything. Its header now explains why
and the file can be deleted.

## 2026-08-27 - ES Candles: the far-CB lanes go to 1-minute (and etf_candles gets a prune)

Edited: `server-v2/candle-history.js`, `server-v2/etf-candle-recorder.js`,
`server-v2/etf-gex-recorder.js`, `server-v2/state/retention-cleanup.js`.

Reverses the round-robin from the entry below. It was the wrong call, for a
concrete reason: **the GEX bubble trail buckets to ONE MINUTE**
(`BubbleBucket = 1 | 5 | 'bar'` in slotStore.ts; `minuteColsRef` is keyed by the
minute). An 8-minute column spacing does not give a coarse trail - it gives a
trail with seven empty minutes between every bubble, on a chart whose finest
setting is one. Both recorders now sweep their full roster every tick.

**Candles: one connection for the whole roster.** The round-robin existed because
`fetchIntradayCandles` opens a THROWAWAY dxLink connection per symbol - connect,
auth, subscribe, settle, tear down - and a hundred of those do not fit in 60s.
New `fetchIntradayCandlesMulti` subscribes the entire roster on ONE connection and
demultiplexes by `eventSymbol`, so the per-symbol handshake (all the round-robin
was ever rationing) disappears. The recorder now opens **one** websocket a minute
for 106 symbols, against the fourteen it opened before any of this.

The canonicalisation trap the single-symbol path documents at length applies
here too and is handled the same way: subscribe to `SPY{=1m}` and events come
back tagged `SPY{=m}`, so the demux maps canonical form -> plain ticker rather
than comparing against the string it sent. The multi form is deliberately NOT
cached - the single-symbol cache keys on `symbol|interval` with no fromTime, and
seeding it from a recorder sweep would hand a browser's one-session request
whatever window the recorder last asked for.

The boot backfill goes through the same path in chunks of 25 (five sessions a
symbol is ~5x the bars, so the whole roster in one subscription would be a very
large burst), and it now covers the wide roster too - which retires the
first-visit lazy backfill from the previous entry.

**GEX: full sweep, bounded concurrency.** No multiplexing trick available here -
each symbol is its own REST chain fetch - so the fix is parallelism: 106 serial
fetches at ~500ms is ~80s, the same 106 six at a time is ~10s. `sweep()` is a
worker pool over a shared cursor, not `Promise.all` over chunks, so one slow
symbol delays its own lane instead of the whole batch. Each worker keeps the
old per-symbol `TICKER_DELAY_MS`, so the aggregate request rate is bounded by
concurrency/(fetch + delay) - ~8/s at the defaults - rather than by how fast the
upstream can absorb a burst. Worker k starts k delays in so a tick's first
requests fan out instead of landing together. Hot lane 4 concurrent, wide 6
(`ETF_GEX_HOT_CONCURRENCY` / `ETF_GEX_WIDE_CONCURRENCY`).

**What that costs, stated up front.** `option_strike_gex_history` is the 2.9GB
table from the 2026-07 disk incident. Per-minute x 93 names at +/-25 strikes is
~6.7M rows steady state for the wide lane, against the hot lane's ~1.5M. The
narrow ladder is the one lever that scales it linearly and is why the wide
default is 25 rather than 40. If that is more disk than the box has, in order of
bluntness: `RETENTION_GEX_HISTORY_DAYS` (10 -> 5 nearly halves it, and
/es-candles only ever shows five sessions), `ETF_GEX_WIDE_STRIKE_SIDE` (25 -> 15
takes off another 40%), then trimming `ETF_GEX_WIDE_SYMBOLS`.

**etf_candles had no retention at all.** Not a regression - it never had one.
That was survivable at fourteen names (~13k rows a session, growing forever but
slowly enough that nobody looked); at ~106 names x ~960 extended-session bars it
is ~100k rows a session, ~25M a year, and "forever" became a real number. Added
to the nightly prune at `RETENTION_ETF_CANDLES_DAYS` (30) and to the VACUUM list.

Cut by the bar's own ET session `date`, NOT by a `created_at`: `date` is stamped
per bar (`ymdEtOf`) precisely so a backfill's five sessions land under their own
days, and a created_at cut would spare a week-old bar imported this morning while
deleting nothing that needs deleting. 30 days is generous on purpose -
`useEtfCandles` asks for 9 calendar days and the page plots 5 sessions - because
the cutoff exists to bound the table, not to ration the chart. No thinning tier
either: 1m bars ARE the resolution the page asks for, and the row is small.

Both ticks keep their overrun guard. If either fires regularly the concurrency
(or the feed) cannot sustain a per-minute full sweep, and the duration warning
names the knob to turn.

## 2026-08-27 - Premarket / Post-Market: the whole MAIN watchlist, and a wrong-symbol fix

Edited: `components/pages/Premarket.tsx`,
`components/pages/premarket/TickerBoard.tsx`,
`components/pages/premarket/postMarketData.ts`,
`components/pages/premarket/HistoricalRecap.tsx`.

Both tabs of `/app/premarket` - Premarket Prep and Post-Market Recap - now run
for every name in the **MAIN watchlist**, not just SPX/SPY/QQQ:

    SPX  SPY  QQQ  NDX  VIX  AAPL  AMD  AMZN  GOOGL  META  MSFT  NVDA  SPCX  TSLA

MAIN rather than an arbitrary list, because it is the roster the rest of the
stack already treats as first-class and BOTH of this page's non-socket data
sources follow it:

- the scanner sweeps MAIN on the 2-minute HOT cadence, and `walls-recorder.js`
  samples the latest scanner row *per symbol* - so Post-Market's **Level grades**
  card reads a real recorded, server-classified verdict (reject / break / pin /
  rolled over) for every symbol now offered, not just for the three that were.
- `/api/expirations` + `/api/chains` were per-ticker already; `useTickerBoard`
  has taken `ticker` as an argument since it was written.

**Nothing about the boards themselves changed.** SPX is still the only live-socket
board (ES basis, overnight range, the gap, the per-minute recorded ladder, replay);
every other name is still the one-minute chain-poll board, still says so in the
warnbar, and still renders only the panels that path can honestly fill. Listing a
symbol in the picker is not a way to give it the SPX panels.

**BUG FIXED IN THE SAME CHANGE - a SPY board was printing SPX's numbers.**
`useNextExpiryStructure` had `ticker=SPX` baked into both of its URLs. It has two
callers: the SPX tab (correct by accident) and `TickerBoard`, which renders it as
Post-Market's *"Tomorrow - after the roll"* card. So a SPY or QQQ post-market
board has been showing **SPX's** next-expiry call wall, put wall, flip and net GEX
under a SPY heading since the card was added. Silent and entirely plausible - the
numbers were real, they were just the wrong instrument's. The hook now takes a
`ticker` argument (defaulting to `"SPX"`, so the SPX callers are untouched) and
`TickerBoard` passes its own.

**Picker is a select now, not a pill row.** Fourteen pills push the session picker
and the pre/post tabs onto a second row on anything narrower than a wide desktop.
It borrows the session picker's `.dsel` shell, so the head's two one-of-many
controls look like one another. Frozen sessions stay SPX-only - the freeze
captures the one symbol the socket carries - and the other options disable rather
than render an SPX page under an NVDA label.

**Why the list is static and not `useScannerTickers()`.** The live roster (with
the owner Watchlists page's `roster_overrides` on top) comes from
`GET /proxy/scanner-tickers`, which returns one flat de-duped array with *no group
labels* - there is no runtime way to ask it which of those 169 are MAIN. The
picker therefore imports `SCANNER_MAIN` from `lib/scannerTickers.ts`. If it should
ever follow live overrides, the endpoint has to expose the buckets first. No
server or proxy file was touched by this change.

Also: `strikeDp` in `TickerBoard` is unchanged but its comment was SPY/QQQ-only;
it reads the decimal place off the ladder itself, which is what makes a $25-wide
NDX level and a half-dollar single-name strike both print correctly.

## 2026-08-27 - ES Candles: SPX candles recorded, and a WIDE far-CB gamma lane

Edited: `server-v2/etf-candle-recorder.js`, `server-v2/etf-gex-recorder.js`.

Follow-up to the ES Candles work earlier today. The picker now offers the far-CB
core roster and accepts any typed ticker, but the two recorders behind it still
covered exactly the fourteen names the picker used to have - so most symbols
charted candles under a permanently empty heatmap, and SPX had no recorded
candles at all.

Both recorders now run TWO LANES. Neither could simply grow its roster in place:
each symbol is a serial network round trip (a throwaway dxLink connection for
candles, a chain fetch for gamma), and 106 of those do not fit in a 60s tick.

- **HOT** - the scanner MAIN lane. Every tick, full ladder. Unchanged.
- **WIDE** - the rest of far-CB `CORE_TICKERS`, 93 names, ROUND-ROBIN: each tick
  takes the next `WIDE_BATCH` (default 12), so a tick's cost is bounded and the
  roster is covered every ~8 minutes.

**SPX is now a recorded candle symbol.** It was excluded on the grounds that
"SPX stays on the ES-basis pipeline", which was true while ES was the only way to
look at SPX gamma. It isn't any more. Without a recorded series every SPX chart
load fell through to the live dxLink fallback added this morning - a websocket
round trip per card per 60s poll, forever.

Note the deliberate asymmetry: `etf-gex-recorder` still excludes SPX and MUST.
There, `$SPX` already has a writer (proxy-tastytrade, every 30s off the streamed
chain) and a second one on the same key would fight it for the heatmap's
`DISTINCT ON (minute_bucket, strike) ... timestamp DESC`. For candles there is no
second writer, so recording it is simply the missing half.

**The write-volume arithmetic, because this table has form.** `etf-gex-recorder`
writes into `option_strike_gex_history` - the 2.9GB table from the 2026-07 disk
incident. Sweeping 93 extra names every minute at +/-40 strikes would have been
~10M rows on its own. Two things hold it to ~0.8M against the hot lane's ~1.5M
(so the table grows by about half, not by ten times), and BOTH are load bearing:

1. Round-robin, not a full sweep - a wide symbol writes ~49 columns a session
   instead of 390.
2. A narrower ladder - `ETF_GEX_WIDE_STRIKE_SIDE` 25 instead of 40, so 51 rows a
   write rather than 81.

The nightly prune then thins everything past `RETENTION_GEX_FULLRES_DAYS` to the
5-minute grid, which for this lane is most of what it wrote.

The trade-off, stated plainly rather than discovered later: **a wide symbol's
heatmap has a column every ~8 minutes, not every minute.** That is a coarse gamma
trail, and it is the price of covering 93 names on that table.
`ETF_GEX_WIDE_BATCH` trades coverage against resolution in either direction.

**Candles do NOT pay that cost**, which is the part that is easy to get wrong the
other way: every candle fetch replays the whole day from ET midnight, so a symbol
visited once every 8 minutes still ends the session with a complete, gapless
1-minute series. Only the newest bar or two lag.

**Lazy backfill.** A wide symbol's first visit pulls 5 days instead of today,
then reverts. The boot backfill could not be used - it is a serial loop with a
60s hard cap per symbol, which is fine for fourteen names and up to an hour and a
half of solid upstream traffic for ninety-three, starting exactly when the
process is trying to come up. First-visit backfill spreads the same work across
the round-robin at no extra request. It also closes a real hole:
`/api/snapshots/etf-candles` falls through to its live pull only when the table is
EMPTY, so a wide symbol recorded with today's bars only would have taken the
table branch and silently lost the four prior sessions the fallback was giving it.

**Two smaller things.**

- **Overrun guard on both ticks.** `setInterval` does not care whether the last
  run finished; without a guard a slow upstream turns into overlapping ticks
  piling requests onto a feed that is already struggling. A skipped tick loses
  nothing - the round-robin cursor only advances on a run that happens, and the
  forming bar is re-upserted next pass. Both log the overrun with the env var to
  turn down.
- **Expiration cache in `etf-gex-recorder`** - 30 min TTL, keyed by (symbol,
  depth) AND by ET date so a 15:50 entry cannot serve yesterday's front expiry at
  09:35. 13 hot names a minute was ~780 upstream calls an hour to re-learn the
  same string. An empty result is deliberately not cached, so a name that failed
  retries next visit instead of being written off for half an hour.

Env knobs: `ETF_GEX_WIDE=0` / `ETF_CANDLE_WIDE=0` kill either wide lane;
`ETF_*_WIDE_BATCH`, `ETF_GEX_WIDE_STRIKE_SIDE`, `ETF_*_WIDE_SYMBOLS`,
`ETF_GEX_EXPIRY_TTL_MS`.

## 2026-08-27 - GEX Change Top: live triggers, and the card leads with the peak

Edited: `server-v2/gex-change-top-recorder.js`,
`components/scanner/GexChangeTop.tsx`. No proxy/router changes - the trigger
loop is started by `startGexChangeTopRecorder()` and reads through the existing
`/proxy/gex-change-top*` endpoints unchanged.

**Live triggers.** The interval capture is a leaderboard: every 30 minutes it
asks "what are the five strongest strikes right now" and photographs the answer.
That is the wrong shape for the thing you actually watch this tab for - a strike
CROSSING into "* Very strong". A name that qualified at 10:31 and faded by 10:58
never existed as far as the board was concerned, and one that qualified at 10:31
and held showed up 29 minutes late, by which time the option had already made
its move and the card's entry basis was nonsense.

So the recorder now also runs a fast scan - `runLive()`, every
`GEX_CHANGE_TOP_LIVE_SEC` (default 60s) - whose job is detection, not ranking.
Any strike that qualifies and is not already on today's board is written the
moment it is seen, under its own exact-minute slot (`10:37`), auto-probed like
any other pick, and marked `live = TRUE` (new column, defaults FALSE so every
existing row backfills as an interval capture).

Dedupe is per (symbol, expiry, strike) per DAY, which is what keeps it cheap and
honest: a trigger fires ONCE, on the crossing, and the entry basis is the mark at
the crossing. Re-qualifying five minutes later is the same event, not a new one -
including when the entry floor rejects it, or a nickel contract that stays
qualified gets re-probed every 60s for the rest of the session. The seen-set and
the daily counter are rebuilt from the DB on the first scan of a new session day,
so a restart does not re-fire the morning's triggers.

Caps, because each capture is a `watch_options` row snapshotted every 60s until
expiry: `GEX_CHANGE_TOP_LIVE_MAX_PER_SCAN` (3) stops one violent tape from
probing twenty names in a minute, `GEX_CHANGE_TOP_LIVE_MAX_PER_DAY` (40) is the
hard ceiling. `GEX_CHANGE_TOP_LIVE=0` goes back to interval-only. The 30-minute
leaderboard is untouched and still runs; both write to the same table and the
same probe pipeline, and a strike first seen live keeps its live minute as
`first_slot` in the scorecard (MIN(slot) is lexicographic on "HH:MM", so the
earliest wall-clock minute wins, which is what the scorecard should anchor to).

On the page: live sections carry a `* LIVE TRIGGER` badge and usually hold one or
two cards, not five - said out loud, because a one-card section otherwise reads
as four missing picks. The poll dropped from 5 minutes to 60s; a 5-minute poll
threw away everything the trigger scan just bought.

**The card headlines the peak, not "now".** The flip side used to read
`in $1.20 -> now $0.35, -71%`. That number is almost always bad and almost always
beside the point: the pick is a flag on a strike, not a position anyone is still
holding at 3:55 PM. What the card has to answer is "was there a trade in it" -
entry, WHEN it triggered, and the best mark that printed afterwards.

That is max-favourable-excursion, which the scorecard has computed all along
(`max_mark` / `max_ts`, measured from the first snapshot at/after the flag) and
the card was simply not reading. The headline is now the peak %, the line under
it is `in 1.20 10:31 -> high 2.45 11:42 - +$125/ct`, and `now` survives as a small
muted line beneath - where price sits relative to the peak is worth a glance, it
just is not the number the card leads with. Trigger time comes from the
scorecard's entry snapshot, falling back to the slot itself, which for a live
card IS the minute it crossed.

The peak is marked on the chart too (green dot + dashed rule, price metric only,
nearest sample within 5 minutes or nothing) so the number above and the shape
below are visibly the same event. Cards grew 244 -> 260px for the extra line.

## 2026-08-27 - ES Candles: SPX, an RTH/ETH switch, no side panel, any ticker

Edited: `components/pages/EsCandles.tsx`, `app/es-candles/page.tsx`,
`components/dashboard/es-candles/EsChartCard.tsx`,
`components/dashboard/es-candles/symbols.tsx`, `server-v2/api-router.js`.

Four changes to the ES Candles route. Both page copies were edited - the SPA
serves `components/pages/EsCandles.tsx` (that is what `app-vite/src/App.tsx`
lazy-imports at `/es-candles`), and `app/es-candles/page.tsx` is the older Next
copy of the same screen; leaving one behind is how they drift.

**SPX is a symbol now.** Not a rename of the ES row - a second arrangement of
the same gamma. ES is the future: it trades nearly around the clock and every
strike drawn on it goes through the ES-SPX basis first, which is a live number
that drifts and freezes across a contract roll. SPX is the index the options are
actually written on, so `candles: "etf"` makes `isEs` false, `effectiveBasis()`
returns 0, and a wall at 6500 is drawn at 6500. The trade-off is the tape: the
index only prints 09:30-16:00 ET, so there is no overnight on this symbol.

`SymbolDef` grew `candleSymbol` for it and nothing else - SPX gamma is stored
under `$SPX` and its candles under `SPX`, and passing `$SPX` to the candle route
returns an empty series with no error, which is the kind of miss that reads as a
broken chart.

**RTH / ETH switch.** On the toolbar beside the ticker, and in the cog's Chart
tab for when a narrow card culls the bar. RTH is 09:30-16:00 ET. It is a filter
on the plotted bars, applied at the very last step (`rows`), and the placement is
the design:

- `rows5` stays whole, so the ES-SPX basis reconstruction still has the
  overnight prints it needs to price a wall before the open.
- The roll-up to 15m/30m/1h runs FIRST - its buckets are anchored to 09:30, so
  filtering after it cuts on real bucket boundaries. Filtering first would build
  the 09:30 bucket out of the survivors and mis-stamp every bar of the day.
- Everything downstream reads `rows` - candles, EMAs, volume, the replay frame
  grid - so one filter moves all of them and none of them learned about sessions.

Not lightweight-charts' session support, because there isn't any: its scale is
index-based, so "hide the overnight" IS "don't hand it the overnight bars", and
the 16:00 -> 09:30 gap closes by itself. Persists in the slot blob as `session`,
so on a 2-3 up row the hoisted dock's switch moves every chart - comparing ES
against SPY across two different sets of hours is not a comparison.

**The side panel is gone from the route.** The GEX rail and the 0DTE chain no
longer ride the right edge, and the Panel and Greek controls went with them; the
cards pass `sidePanel="none"`. Width was the reason - `SIDE_PANEL_SPEC` reserves
58-76px AND demands 340px of chart survive it, which on a three-up row is most of
a column, to answer a question the heatmap already answers on the same screen in
the same price space. `SidePanel`/`ChainRail` and the `sidePanel` prop are
untouched, and the /home and /board EMBEDS keep their rail toggle: one chart in a
fixed box, where width was never the problem.

**Any ticker, from the far-CB core list.** `ChartSymbol` was a closed union of
fourteen names, which is what made the picker a fixed list - a symbol not in the
type could not be selected, stored or restored. It is now `string`; `symbolDef`
synthesises the plain SPY/QQQ-shaped definition for anything it does not
recognise, so no other branch anywhere had to learn about it.

The dropdown lists the curated rows, then the far-CB `CORE_TICKERS` roster over
the new `GET /api/es-candles/tickers`, and accepts a typed ticker on Enter or via
a "chart it" row for names on no list at all. The roster is fetched once per page
load, on first open, and shared by all three cards; a failure degrades to the
curated list rather than to a broken menu.

`CORE_TICKERS` and not `getActiveRoster()` deliberately: the static array answers
without touching Postgres, and the active roster is the scanner universe plus
every customer-added ticker - right for a sweep, wrong for a picker that would
then change under you and show names someone else added.

**`/api/snapshots/etf-candles` gained a live fallback.** The recorder writes a
fixed roster, and the picker is no longer one, so most symbols now reaching that
route have no recorded rows - and an empty 200 renders as a chart that loads
forever with no reason given. A miss falls through to the same on-demand dxLink
pull the recorder itself uses (`candle-history.js`), aggregated here to the
requested bucket, clamped to dxFeed's ~7 days of 1m. It is a websocket round trip
measured in seconds, which is why it is the fallback and not the path. The
response carries `source` (`etf_candles` / `dxlink-live` / `none`) so a thin
chart can be diagnosed without reading this entry.

## 2026-08-25 - Daily Grades: the grader was 401ing on every candle pull

Edited: `server-v2/daily-grades-recorder.js`.

First live run on prod: seal fine (169 tickers, all 169 with floor/cap off the
same-day ladder), grade **0 of 169**. `fetchSessionOhlc` calls
`/proxy/candles-intraday` on the loopback with no session cookie, and
`PROXY_AUTH_REQUIRED=1` in prod means proxy-auth fail-closes every one of them
with a 401. Every ticker stored `no_candles`; the day row wrote a legitimate,
completely meaningless zero.

Fix is one header - `x-internal-token`, the same shared secret every other
in-process caller sends (`server-with-proxy.js:1354`, `em-tracker-auto-eval.js`).
`INTERNAL_HEADERS` is built once at module scope and is `{}` when the env var is
unset, so a dev box without the secret behaves exactly as before.

Also: a run that grades NOTHING now logs a `console.error` saying so in as many
words, naming 401 as the likely cause. A zeroed `daily_grade_days` row is
indistinguishable from "the board was wrong today" if you only read the numbers -
the failure has to announce itself as plumbing, because the data cannot.

## 2026-08-25 - Daily Grades: a Grades tab beside the Levels board

Edited: `owner-vite/src/pages/DailyGrades.tsx`, `owner-vite/src/lib/dailyGrades.ts`.

`/proxy/daily-grades` was already returning `grades` and `day` alongside the
seal and the page was throwing both away. Now it renders them.

**Two tabs, one fetch.** LEVELS is the board as it was sealed; GRADES is what
the session did to it. Switching is a re-render, never a refetch. The session
grade rides in the tab bar so it is visible from either side.

**GRADES tab** - eight roll-up tiles (session score and letter, points over
points-available, graded count, cap and floor held/tested, flip held, range
contained), a letter filter (A+ through F), and one row per ticker: grade pill,
score, points, the five level verdicts each with the points it earned, and the
realized O/H/L/C. Sorted by score descending with the ungraded sinking to the
bottom either way - the top of that table should be the names the board CALLED.

Verdict strings are mapped to readable labels in `OUTCOME_META`; anything not in
the map renders as the raw string, so an outcome added server-side shows up as
itself instead of a blank cell.

**The legend is now tab-aware** - what the levels ARE on one tab, what the
verdicts on them MEAN on the other, including the two rules that are easy to
misread: score is points ÷ points-AVAILABLE (a name with no flip has 100
available, not 125), and no levels / no candles store a NULL grade rather than
an F, because an F is a claim the board was wrong and there was no board.

**Empty is a state, not an error.** Before 16:20 ET there are no grades; the tab
says "This session has not been graded yet" rather than looking broken. Pasting
a board over the seal clears the grades and drops back to LEVELS - those grades
belong to the seal, not to whatever was pasted on top of it.

`DgGradeRow` / `DgDay` mirror `daily_grades` / `daily_grade_days`
column-for-column, snake_case included, because they are handed straight through
from Postgres and renaming them here would only hide where they came from.

## 2026-08-25 - Daily Grades: the board builds itself from the API at 09:26 ET

Added: `server-v2/daily-grades-levels.js`.
Edited: `server-v2/daily-grades-recorder.js`, `server-v2/server-with-proxy.js`,
`owner-vite/src/lib/dailyGrades.ts`, `owner-vite/src/pages/DailyGrades.tsx`.

No more pasted JSON. `buildSeal()` composes the whole board server-side from
data already in the API and seals it:

| level | source |
|---|---|
| floor / cap | `daily-grades-levels.js` over `eod_strike_gex.oi_call_gex` / `oi_put_gex` |
| apex (CB) | `scanner_snapshots.cb` |
| flip | `scanner_snapshots.gex_flip` |
| spot | live quote via `fetchUnderlyingQuotes`, falling back to the scanner spot |

**Why 09:26 ET.** `eod-strike-gex-recorder.js` re-stamps the ladder with SETTLED
overnight open interest at 09:25. Sealing a minute later means floor and cap are
computed from settled OI, not from yesterday's intraday guess at it. The seal
still locks at 09:30 like any other - after that only the note can change.

**The level math** (`daily-grades-levels.js`, pure, no I/O). Each side's
gamma x OI is treated as a mass distribution over strikes, and the level is read
two ways:

- *empirical percentile* - walk the cumulative GEX from the low strike up and
  interpolate where 80% (calls) / 20% (puts) of the mass has accrued.
- *moment-matched bell* - `mu +/- 0.8416 * sd` of the same distribution.

**`cap` and `floor` are the EMPIRICAL pair.** All four values ship in the
payload (`ceiling_emp`, `floor_emp`, `ceiling_bell`, `floor_bell`, plus mu/sd
per side and the strike count), so a disagreement between the methods is
inspectable instead of hidden - when they diverge, the ladder is not
bell-shaped, and that is worth seeing rather than smoothing over.

Z = 0.8416 is the inverse normal CDF at 0.80, so the two methods ask the same
question of a distribution that IS normal. `DG_LEVEL_Z` and `DG_LEVEL_PCT` move
together or the correspondence breaks - stated in the file header. Verified
against the numpy reference on randomised ladders: max absolute error 1.4e-13.

**The roster comes from the data**, not a second copy of the list: every symbol
with an OI ladder or a scanner sweep. A name with a ladder but no sweep gets
floor and cap with a null CB/flip; a name with neither is simply absent and the
page shows it as "not graded" against the live watchlist.

New route `POST /proxy/daily-grades-build[?date=&force=1]`. The scheduler now
has two latches on one tick - seal in the morning, grade after the close - kept
separate so a failed seal never blocks the grade (a board may have been POSTed
from elsewhere).

**The definitions changed, so the UI did too.** cap is no longer "the strongest
positive GEX strike" - it is where 80% of the call gamma ladder sits below, and
floor is the same read from the other end at 20%. Legend, glossary and the
rubric header all say so now.

## 2026-08-25 - Daily Grades: the board card was collapsing to three rows

Edited: `owner-vite/src/pages/DailyGrades.tsx`.

`PageShell`'s `<main>` is a FIXED-HEIGHT column flex container, so its children
shrink by default the moment they overflow it. With four blocks on the page the
board card lost the fight and squeezed the scroll box down to three visible rows
- and `max-height` could not save it, because max-height never stops a flex item
from shrinking.

Two changes, and they go together: `flexShrink: 0` on all four page blocks
(header, tiles, board, legend), and the scroll box takes `height` instead of
`max-height` - `clamp(420px, 64vh, 900px)`. The box now owns its height and the
PAGE scrolls past it, which is what the sticky header was always for. Commented
in place, since removing either half silently reintroduces the collapse.

## 2026-08-25 - Daily Grades: the apex column is labelled CB

Edited: `owner-vite/src/pages/DailyGrades.tsx`, `owner-vite/src/lib/dailyGrades.ts`,
`generated/2026-08-25-daily-grades.html`.

apex IS CB, so the column header and the legend now say CB. The payload key
stays `apex` - it is the sealed board's own wire format and renaming it would
break every seal already stored - so the mapping is stated once in the page
header comment and once in the glossary at the top of `dailyGrades.ts`, which
are the two places someone reading the code will hit it. The DB column
(`apex_lvl`) and the rubric component name are unchanged for the same reason.

## 2026-08-25 - Daily Grades recorder: per-ticker grade after the close, plus the day

Added: `server-v2/daily-grades-recorder.js`.
Edited: `server-v2/server-with-proxy.js`, `owner-vite/src/lib/dailyGrades.ts`.

**Two halves, kept apart on purpose.** SEAL: a board is sealed BEFORE the open
and stored verbatim in `daily_grade_seals`. The recorder does not compute levels
- whatever produces them POSTs to `/proxy/daily-grades-seal`. Re-POSTing a date
after 09:30 ET updates the NOTE ONLY and never the levels, because a board you
can edit mid-session is not a sealed board and grading it proves nothing
(`?force=1` exists for backfilling a session you have the original file for).
GRADE: at 16:20 ET it pulls the session O/H/L/C per sealed ticker and scores it.

**The raw session is stored beside the grade.** `gradeTicker(sealed, ohlc)` is a
PURE function - no clock, no fetch - so a rubric change is a REGRADE
(`POST /proxy/daily-grades-regrade?date=`) over stored facts, instant and
reproducible, not a refetch of 170 candle pulls. Keep it pure.

**The rubric.** Each level is scored on two questions, because either alone
lies. RESPECT: did price close back on the side the seal left it on? REACH: did
price get to the level at all? A cap price never came near was not "respected",
it was untested - and it scores BELOW one that got tagged and rejected. Tagged
and broken scores below that.

- `cap` (strongest +GEX): tagged+held 25 / untested 15 / tagged+broke 5 / gapped through 0
- `floor` (strongest -GEX): the same four, mirrored
- `flip`: held clean 25 / held after an intraday test 18 / flipped 5
- `apex` (CB): magnet - |close - apex| as % of close -> 25 / 21 / 15 / 8 / 0
- `range`: floor->cap band contained the session 25 / one side out 12 / both out 0
  (skipped when floor sits above cap - that is a legitimate board, not a range)

Score is points / points-AVAILABLE x 100, so a name with no flip is not punished
for the missing component. Letter bands are the house bands from
`_lib-pick-grade.cjs` - A+ 85 / A 72 / B 58 / C 44 / D 28 / F - deliberately, so
a grade means the same thing on both boards. `max_pts = 0` stores as status
`no_levels` with a NULL grade, never an F: an F is a claim about the board, and
there was no board. A candle pull that comes back short stores `no_candles` the
same way.

**The day row is a SUM, not a mean.** `daily_grade_days` divides summed points
by summed points-available across every graded ticker. Averaging the per-ticker
percentages instead would let a one-level ticker swing the session as hard as a
four-level one.

**Tables** (all `CREATE TABLE IF NOT EXISTS` in the recorder's `ensureSchema()`,
the convention for a recorder-owned table): `daily_grade_seals`, `daily_grades`
(PK date+symbol, carries the levels, the O/H/L/C, five outcome strings, five
point columns, the reach booleans and the letter), `daily_grade_days`.

**Session O/H/L/C** comes from `/proxy/candles-intraday` 1m bars filtered to
09:30-16:00 ET of the target date, `DAILY_GRADES_CONCURRENCY` (default 4) at a
time - dxLink opens a short-lived subscription per call, so that knob is what
decides whether ~170 names is polite or a stampede. Index roots map to their `$`
form (`SPX` -> `$SPX`), extendable with `DAILY_GRADES_STREAMER_MAP`.

**Routes** (`server-with-proxy.js`, beside the gex-levels-history pair):
`GET /proxy/daily-grades[?date=]` (seal + grades + day roll-up),
`POST /proxy/daily-grades-seal`, `POST /proxy/daily-grades-run[?date=&force=1]`,
`POST /proxy/daily-grades-regrade?date=`. The seal route reads a 2MB body -
boards for ~170 tickers overrun `readJsonBody`'s 100KB default. The page's
`DG_ENDPOINT` now points at `/proxy/daily-grades` instead of the unimplemented
`/api/daily-grades`.

**Line endings:** the earlier Daily Grades commits went out LF into a CRLF repo.
All of those files are re-emitted CRLF here, so this entry carries a whitespace
correction on `nav.ts`, `registry.ts`, `theme.ts`, `DailyGrades.tsx`,
`dailyGrades.ts` and `daily-grades/sample.ts` alongside the real change.

## 2026-08-25 - Daily Grades: level glossary corrected, dashboard scrollbar, no left accent

Edited: `owner-vite/src/pages/DailyGrades.tsx`, `owner-vite/src/lib/dailyGrades.ts`,
`generated/2026-08-25-daily-grades.html`.

**The level glossary was WRONG and is now right.** It had been written as if the
board were a support/resistance pair, which it is not:

- **cap** - the strongest POSITIVE GEX strike (was "upper level / call wall")
- **floor** - the strongest NEGATIVE GEX strike (was "lower level / put wall")
- **apex** - CB (was "the single biggest level on the board")
- **flip** - gamma flip, unchanged

The consequence is spelled out in the header of `dailyGrades.ts` because it is
easy to re-break: NOTHING assumes floor sits below cap in price. The strongest
negative strike can print above the strongest positive one, so `cap < floor` is
a legitimate board and not a data fault - it stays flagged, and the Floor->Cap
bar goes blank rather than drawing itself backwards. The legend now says so on
screen instead of leaving a blank bar unexplained.

**Scrollbar is the dashboard's own.** The board box takes `.wall-scroll`
(index.css) - cyan thumb on an inset track, the same bar the Walls table and the
ranked rail use. The browser default is a white wash that reads as chrome
sitting on top of the card. No new CSS; the class already existed.

**Left accent removed** from the seal-note callout - it now sits flush on the
inset surface like every other block on the page.

## 2026-08-25 - Daily Grades: flat SURFACE ramp, white type, board scrolls in its own box

Edited: `owner-vite/src/lib/theme.ts`, `owner-vite/src/pages/DailyGrades.tsx`,
`generated/2026-08-25-daily-grades.html`.

**New `SURFACE` export in `lib/theme.ts`** - a six-step flat surface ramp,
darkest first, each step a plane further forward: `app` #020304, `rail` #040507,
`shell` #07080b, `card` #0F1117, `card2` #14171D, `cardHi` #191B22. Additive
only; every page still on `OWNER_THEME.panelBg` is untouched.

The ramp is deliberately FLAT - opaque fills, no translucency. Daily Grades opts
in and therefore also drops `backdropFilter` on the surfaces it repaints: a blur
behind an opaque fill buys nothing but a compositor layer. Shell behind the page,
`card` for each panel, `card2` for anything inset in a card (stat tiles, the
sticky table head, the search box and the paste area), `cardHi` for row hover and
the Floor->Cap track.

**All type is white.** Every muted `ownerRgba(T.text, .28-.7)` is gone - column
heads, tile labels, the seal line, the legend, the "-" in an empty cell. State is
carried by the pills and the accent colours, never by dimming the type, so the
0.55-opacity wash on ungraded rows is gone too: those rows now read at full
strength with a `not graded` pill, which is what actually names the condition.

**The board scrolls in its own box** - `max-height: clamp(360px, 64vh, 900px)`
with `overflow: auto`, so ~169 watchlist names scroll under a sticky header
instead of running the whole page down and leaving the column heads off-screen.
The head needed an opaque fill of its own (`card2`) now that rows slide beneath
it. Horizontal scroll for narrow windows lives in the same box.

The standalone `generated/` copy of the board got the same three changes.

## 2026-08-25 - Daily Grades board on the owner site (/owner/daily-grades)

Added: `owner-vite/src/pages/DailyGrades.tsx`, `owner-vite/src/lib/dailyGrades.ts`,
`owner-vite/src/pages/daily-grades/sample.ts`, `generated/2026-08-25-daily-grades.html`.
Edited: `owner-vite/src/lib/nav.ts`, `owner-vite/src/pages/registry.ts`.

A readable levels board - one row per ticker, floor / apex / cap / flip against
spot. New page under **Market** in the owner rail.

**The roster is the watchlist.** Rows come from `useTickerUniverse()`
(`lib/tickers.ts` -> `GET /proxy/scanner-tickers`) - the same scanner universe
the ΔGEX Board runs over - NOT `Object.keys(payload.boards)`. A watchlist name
the seal didn't grade still gets a row, dimmed and flagged `not graded`, so a
short board reads as a gap instead of a clean list. A graded name that isn't on
the watchlist is off-roster and sits behind a `+N off roster` toggle rather than
quietly padding the board. `deriveRows(payload, roster, includeOffRoster)` owns
that merge.

**This is the template.** The data is not wired yet: the page renders whatever
`DgPayload` it is handed and there is exactly ONE seam for the live feed -
`loadGrades()` in `lib/dailyGrades.ts`. It probes `/api/daily-grades` (not
implemented server-side) and falls back to a bundled sealed board so the
template renders real-shaped numbers. When TT / dxLink lands, swap that function
body; for a streaming spot there is `applySpots(payload, quotes)`, which overlays
live prices while the four levels stay frozen at their sealed values. Every
delta, bar and flag recomputes off spot, so nothing in the component changes.
A "Paste JSON" drop/paste box is the manual path until then, and the header
badges say which source is on screen (Live / Imported / Sample) and whether the
watchlist itself is live or cached.

**What the board shows**

- Delta columns: percent from spot to each level, signed - positive means the
  level sits above spot. Bold inside 1%.
- Floor -> Cap bar: where spot sits in the band, white tick = spot, gold line =
  flip. Blank when the band is unusable (missing, or cap below floor).
- State pills: above flip / below flip / no flip, plus flags for `near a level`,
  `outside floor/cap`, `cap < floor` (seals really do ship inverted boards -
  KLAC and VOO in the 08-25 sample), `not graded` and `off roster`.
- Seven summary tiles, ticker search, six filters, every column sortable with
  nulls sinking to the bottom either way.

Colours all come from `lib/theme` (`OWNER_THEME`) - no hardcoded hex.

## 2026-08-25 - CB / CW / PW can fill the whole cell, not just carry a badge

Edited: `generated/2026-08-25-heatmap-tuner.html`, `app/mult-greek/MultGreekClient.tsx`.

Three ways a level cell can now be painted, and they say different things:

- **heat** - hue = SIGN, alpha = rank, exactly like every other cell; the badge
  is the only thing naming the level. What both skins still ship with.
- **level** - the whole cell takes the LEVEL's colour (gold / cyan / red) at its
  own per-level alpha. Loudest, unmissable - but the fill stops saying which way
  the gamma points, so a Put Wall and a negative-gamma cell become two different
  reds for two unrelated reasons. The ± glyph is then the only direction cue.
- **blend** - the level's colour laid OVER the heat at a low alpha. The sign
  survives underneath and the level reads as a wash on top.

Alpha is per level, because gold at full strength swamps a row in a way cyan and
red do not.

**Tuner:** a "Cell fill" select plus three alpha sliders in the CB · CW · PW
section, with the trade-off spelled out under them.

**App:** `SkinDef.levelFill` - `null` (both skins today, so the live board is
unchanged) or `{ mode, alpha }`. `levelFillBg()` composites it; "blend" is a
two-stop `linear-gradient` rather than a colour, which is the only way to lay one
translucent layer over another in a single `background` without knowing what the
layer underneath resolved to. The cell's `background` now computes the heat
first and lets the skin paint over it, so levels-only mode and the ordinary ramp
both feed the same override.

## 2026-08-25 - Tuner: rank 1/2/3 and CB/CW/PW are fully adjustable; VIVID re-tuned

Edited: `generated/2026-08-25-heatmap-tuner.html`, `app/mult-greek/MultGreekClient.tsx`.

**Tuner - two new sections replace the old "Rank floors" block.**

*Top 3 ranked cells* - the three biggest |GEX| strikes per column, which skip the
ramp and paint at a fixed alpha. Per-rank fill alpha, per-rank font weight, and
per-rank outline ring (so #2 and #3 can be marked independently of #1) with its
own width and a colour that either follows the sign or is pinned. Plus a corner
glyph per rank - star / #n / dot / none - with its own colour, size and corner.

*CB · CW · PW levels* - per-level show toggle (honoured by the preview exactly
as the live ladder honours its own), per-level colour, and an editable label for
each. The badge is fully described rather than hardcoded: ink (white / the
level's colour / dark), chip fill (dark / the level's colour / none), an
optional ring in the level colour with its own width, size, weight, radius,
padding, corner, and how far the figure clears it. The cell ring is separate,
off by default, with its own width. A live three-up badge preview sits at the
bottom of the section, each badge on the fill it usually lands on.

The export snippet now emits a whole `HEAT_SKINS` entry rather than a loose
style block, plus a marker summary.

**VIVID re-tuned to the picked values** and is now the tuner's base preset, so
what the tuner opens on IS what ships:

- ramp `base .05 / span .25 / max 1 / ease 0.4` - the low ease is the point: the
  curve rises steeply out of zero so the quiet two-thirds of a column still
  differentiate instead of flooring, and only genuinely large strikes near the cap.
- rank floors `0.95 / 0.62 / 0.40`; ranked weight steps 300 -> 600 only, because
  at this ramp the FILL already shouts which strikes are big.
- 3px radius, 0.5px inset, `2px 8px` padding, 9.5px, no tracking, white text,
  `$1.23M` money figures (was compact).

**Each skin now carries its own Intensity position and ceiling.** VIVID's ramp is
a different curve, not a louder CLASSIC, so 1.75 on one is not 1.75 on the other.
`SkinDef.intensity` holds `{ def, max }` - CLASSIC `1.75 / 3`, VIVID `3 / 4` - and
switching skins (or restoring one from `mg_heat_skin`) moves the slider there
instead of carrying a number across that nobody chose for that curve.

`SkinDef.cell.inset` is a margin, not a grid gap, on purpose: it separates the
tiles without moving the column tracks, so the header and totals rows stay
aligned with the cells whatever it is set to.

## 2026-08-25 - Delta stamp: white figure on a direction-coloured chip

Edited: `app/mult-greek/MultGreekClient.tsx`, `generated/2026-08-25-heatmap-tuner.html`.

Same fix as the level badges, applied to the OTHER marker in the cell.

`DeltaStamp` was a green/red figure on a uniform dark plate. That puts a
coloured 8px number inside a cell whose FILL is also coloured by sign - on a red
cell a red chip is two reds meaning two unrelated things - and on a VIVID fill
the dark plate was the only dark thing left on the row, so it read as a hole.

The chip is now the direction (`#16a34a` / `#dc2626`) with a WHITE figure and a
`rgba(4,8,16,.55)` inset ring. Direction moved from the ink to the chip, which
is a stronger signal at this size than 8px coloured type ever was, and the ring
is what keeps a green chip legible on a near-solid cyan wall. Rank still encodes
nothing here - only the font weight changes for #1.

The tuner's Δ chip was updated to match (it was dark ink on a saturated
green/red fill, which is the least readable pairing of the three tried).

## 2026-08-25 - CB / CW / PW badges: white text, ringed in the level colour

Edited: `app/mult-greek/MultGreekClient.tsx`, `generated/2026-08-25-heatmap-tuner.html`.

Third pass on these markers, because the first two both failed on the same cell.

- A solid chip IN the level's colour (the original) put cyan CW on a cyan cell
  and red PW on a red one - the badge vanished into the fill underneath, and
  that fill is the one you most want the label on.
- Level-coloured INK on a dark chip (yesterday's fix) stopped the vanishing but
  left three different low-contrast label colours, and gold-on-black at 8px was
  the weakest of the three.

**Now: white text on a dark chip, with a 1px inset ring in the level's colour.**
White is the same crisp read on all three badges and over any fill either skin
can produce; the ring is what says WHICH level, and the ring is the part that
can safely be gold. Nudged off the corner (`top 1 / right 2`, 3px radius, 0 3px
padding, `.04em` tracking) so it stops being clipped by the cell's rounded edge,
and the badged cell's figure clears 17px instead of 15.

The tuner's badge was updated to match, so what it previews is what ships.

## 2026-08-25 - VIVID skin: right-aligned figures, and the tuner made honest

Edited: `app/mult-greek/MultGreekClient.tsx`, `generated/2026-08-25-heatmap-tuner.html`.

**The skin now owns alignment and ink.** VIVID was shipping centred because
`textAlign: "center"` was still hardcoded on the cell - so the one thing the
14.5px padding was FOR (a shared right edge to compare magnitudes down) never
happened. `SkinDef.cell` gains `align` and `text`:

- CLASSIC - `center`, `#c3ccda` (unchanged).
- VIVID - `right`, `#e8edf5`, as picked.

Three places had to follow or the alignment would have been half-applied:
the cell's `textAlign`; the cell's `justifyContent` when Δ stamps switch it to
flex (where `textAlign` no longer places anything, so a right-aligned skin
re-centred itself the moment Δ came on); and the column TOTAL row, which now
takes the skin's padding and alignment so the total sits over the column it
totals instead of floating in the middle of it.

`HEAT_SKINS.classic.text` is the `#c3ccda` LITERAL, not `SOFT_WHITE`: the table
is evaluated at module load, above where that const is declared, so referencing
it there is a temporal-dead-zone crash on import.

**The tuner was lying about the baseline.** Its "Current app" preset was the
OPTION CHAIN cell (2x8 padding, right, 10px), never the ladder's - which is why
the shipped ladder looked nothing like what came out of it. It now carries the
two skins that actually ship, `Ladder · VIVID (live)` and `Ladder · CLASSIC`,
transcribed from `HEAT_SKINS`, and opens on VIVID; the old baseline is still
there, renamed `Chain default`. Its markers were brought in line too: the level
ring is off by default behind a new `wallRing` toggle, the badge is level-colour
ink on a dark chip, and a badged cell clears its figure out from under it.

## 2026-08-25 - Multi Greek: CB / CW / PW lose the ring, keep the label

Edited: `app/mult-greek/MultGreekClient.tsx`.

The level markers were a 2px outline in the level's colour PLUS a solid chip in
that same colour. Both failed on the cell they matter most on: a CW border is
cyan on a cyan (+GEX) cell and a PW border is red on a red one, so the ring read
as a smudge rather than a marker, and the chip - dark ink on a solid CW/PW fill -
disappeared into the cell behind it. On the VIVID skin, where the fill is near
opaque, they closed the cell in on itself.

- **The ring is gone.** No outline for CB / CW / PW. The badge names the level;
  the fill still says sign and size. The ATM box, the click-selection ring and
  the rank-1 hairline are untouched.
- **The badge is the level's colour as INK on a dark chip**, not a solid chip in
  the level's colour - legible on any fill either skin can produce. CB stays
  gold (`LEVEL_COLORS.cb`), CW cyan, PW red.
- **The value steps out of the badge's way.** A badged cell pads its figure 15px
  on the right so the chip stops landing on the last digit. Only badged cells
  pay it; every other cell keeps its full width for the number.

## 2026-08-25 - Multi Greek: CLASSIC / VIVID heat skin toggle in the cog

Edited: `app/mult-greek/MultGreekClient.tsx`.

The ladder's cell look is now DATA, not hardcoded. `HEAT_SKINS` holds two named
answers to "how is a heat cell painted" and the cog's Heat section picks one.

- **CLASSIC** - byte-for-byte what shipped: 0.02 -> 0.18 wash, rank floors
  0.90 / 0.45 / 0.25, square 4px cells, `$1.23M` values, 700/800/900 weights.
- **VIVID** - the tuner's export: ramp `base 0.07 / span 0.49 / max 1.00 /
  ease 0.85`, rank floors `1.00 / 0.81 / 0.60`, 4.5px radius with a 2px column
  gap so each cell is its own tile, `2px 14.5px` padding, 9px type tracked in
  -0.05em at weight 300 (900 on rank 1) with a text shadow to survive a
  near-opaque fill, and compact `1.2M` / `1.2B` figures so the wider padding
  still fits the number.

A skin only decides how strong the tint is, how the cell is shaped and how the
figure is written. It never touches which strike is a wall, which is rank 1, or
what the value is - both skins read the identical `ratio = |gex| / columnMax`.

**What moved to be skin-driven:** `metricBg()` takes the skin instead of
hardcoding the ramp; the local `skinRankBg()` replaces the imported `rankBg`
so levels-only mode paints CB/CW/PW at the ACTIVE skin's floors rather than the
option chain's fixed ones; `fmtCell()` writes the cell and the column TOTAL in
the skin's number language; the rank-1 ring takes the skin's hue; and the
header, totals and body grids all open the same `columnGap` so a skin with a
gap cannot knock the columns out of alignment.

**Slider ceiling follows the skin.** VIVID was tuned at 3.3x, past CLASSIC's 3x
stop, so the Intensity slider's max is 4 on VIVID and 3 on CLASSIC; switching
back to CLASSIC clamps a >3 value rather than leaving the handle off its track.

Persisted per browser under `mg_heat_skin`. Server render always starts on
CLASSIC and the saved value is applied in an effect, so hydration can't
mismatch. The tuner's `colW: 94` was deliberately NOT carried over - the
ladder's columns are `1fr` inside four side-by-side panels and a 94px floor per
column overflows the row under ~1800px.

CB/CW/PW badges, the peak star, EM badges and the delta stamp keep their own
existing toggles - a skin does not silently switch a marker off.

## 2026-08-25 - Standalone heat-cell tuner for the Multi Greek ladder + Option Chain grid

New: `generated/2026-08-25-heatmap-tuner.html`. No app files touched.

A self-contained HTML sandbox that reproduces both heat surfaces side by side -
the Multi Greek GEX ladder and the Option Chain grid - against synthetic SPX
data, with every knob that decides how a cell looks wired to a live control.

It mirrors the real math rather than approximating it: the same
`alpha = min(maxAlpha, baseAlpha + (ratio x max(intensity,1))^ease x spanAlpha)`
ramp, the same three fixed rank floors for CB / CW / PW, and the same
levels-only branch that switches the gamma wash off at the slider's bottom stop.

Adjustable:

- **Heat scale** - positive / negative color, alpha-vs-solid fill mode,
  intensity, ease exponent, base alpha, alpha span, max alpha cap.
- **Rank floors** - alpha per rank 1/2/3, levels-only toggle, rank-1 ring width.
- **Cell shape** - corner radius, grid gap, cell inset, vertical / horizontal
  padding, column min-width, row lines, ATM box.
- **Type** - font family, size, weight, rank-1 weight bump, letter spacing,
  value / empty / sign / strike-rail colors, alignment, text shadow, and an
  auto-contrast option that flips text white over hot fills.
- **Cell contents** - value format (compact $, compact, raw, % of column max,
  rank, none), decimals, and independent toggles for the colored sign glyph,
  the peak star, the CB/CW/PW badge, the delta stamp, % of column, an OI/Vol
  second line, EM strike badges, the TOTAL row, the total column and the
  mirrored right strike rail.

Five presets (Current app / Bold / Soft / Solid fill / Minimal), a ramp
inspector view showing every step of the scale in both signs, and reseedable
sample data.

**Export** emits either the settings as JSON or a paste-ready code snippet with
the new `RANK_FLOOR_ALPHA`, `rankBg()` and `metricBg()` bodies for
`lib/calculations/optionChain.ts` plus the cell style block for the grid cells
in `components/pages/OptionsChain.tsx` and `app/mult-greek/MultGreekClient.tsx`.

## 2026-08-25 - Comped access provisions the account instead of waiting for a signup

Edited: `app/api/admin/comp-access/route.ts`, `app/api/auth/signup/route.ts`,
`lib/db.ts`, `owner-vite/src/pages/Admin.tsx`. New: `lib/emails/comp-invite.ts`.

Granting a comp used to write one `comp_access` row and stop there. If that
email had no account yet the row just sat as "pending signup", and the person
on the other end had to be told to go sign up - and to spell their email
exactly the way it had been comped, or the grant pointed at nothing. Until they
did, nothing in the system said they existed.

**The grant now creates the account.** POST creates the `users` row up front
with `password_hash = NULL`, then mails a tokenized `/auth/reset-password`
link - the same one-shot token machinery `forgot-password` uses, with a 7-day
TTL instead of 1 hour. They click, pick a password, and land in a full
paid-tier account. There is no sign-up step for them at all, and no way to
mistype the address, because they never type it.

A passwordless row is not a hole: `login` verifies against a NULL hash and
fails generically, so nobody can sign into one, and "Forgot password?" on the
sign-in page reaches the same reset flow if the invite link ever expires. A
bounced invite is a nuisance, never a dead end.

**Re-comping never touches an existing account.** If a `users` row is already
there - a real customer, or a re-grant - it is left exactly as it is, and no
mail goes out. A paying subscriber must never get a "set your password" link
because their comp was extended.

**The mail is auth mail, not marketing.** `sendAuthEmail()`, so the new
`comp-invite` template ships without the unsubscribe footer, without the
List-Unsubscribe bulk headers, and without UTM params welded onto the token
URL - all three of which push a tokenized credential link to spam. Same reasons
spelled out in `lib/emails/send.ts`.

**Panel.** An "email invite" checkbox (default on) next to Grant - unchecked,
the account is still created and no mail goes out, for when you would rather
tell them yourself. The grant result now reports the mail separately from the
grant, because the comp being live says nothing about whether the email landed.
The "pending signup" badge is replaced by "no password yet" (account exists,
link unused) and "no account" (a pre-existing grant from before this change),
each with a **Resend** that mints a fresh 7-day link. `listCompAccess` carries
a `has_password` flag for it; new `PUT /api/admin/comp-access` does the resend.

`signup`'s dead-end branch for a passwordless row said "that email was
registered with Google sign-in, which has been retired" - which is now wrong
for every comped account. It splits on `google_sub` and tells a comped user the
truth: the account is already there, use "Forgot password?".

## 2026-08-25 - Condition Rail: the historical read came back empty every time

Edited: `components/scanner/ConditionRailTab.tsx`.

Pick a closed session and the whole readout was blank - headline "-", every
compare bar at zero, "No failed breaks in this cohort", "No sessions match -
loosen a criterion", all four tiles on a dash. Nothing was wrong with the data.

A closed session classifies on EIGHT OR NINE criteria at once (open type + IB
width + where it closed + which extreme printed first + which side broke +
break shape + surge + poke + the clock), and the rail seeded all of them. The
book has a few thousand sessions in it; no single one of them has ever matched
all nine, so the cohort was empty by construction. Then the second failure
landed on top: `wouldBeEmpty()` strikes out any chip that would produce an
empty cohort, and once the selection ALREADY matches nothing that is true of
every chip - so the entire rail went dead and there was no way to click out of
it. That is the "historical shows nothing" report.

Three changes.

**The seed relaxes.** `relaxToBook()` drops criteria in a fixed order - texture
first (retest, FVG, poke, volume surge), then the clock, then break shape, then
IB bias and ORB, then which side broke - until the book actually holds a
session matching what is left. The open type and the IB width bucket are never
dropped: they are what the rail is keyed on, and a read that has quietly
stopped conditioning on them is not the read that was asked for. Both the
auto-seed and the MATCH SESSION / MATCH TODAY button go through it.

**What came off is said out loud.** An orange line under the session summary
names every dropped criterion: "Relaxed - no session in this book matched the
full read. Dropped poked <0.25 ib past, no surge, ...". Clicking any of them
back on re-narrows and takes it out of the banner, so the over-specified read
is still one click away - it is just no longer the default.

**The rail can't lock itself again.** The empty-combination strike is now
skipped whenever the current cohort is empty. Striking every chip because the
selection already matches nothing is not information, it is a dead end.

Plus the thing the empty cohort was hiding: **"Each criterion on its own"**, a
new card under the headline. Every ticked criterion priced two ways - ALONE
against the unconditional book (bar, with the book's own rate as the hairline),
and WITHOUT IT, the ticked cohort with just that one removed. The gap between
"without it" and the headline is what that pick is costing. Criteria that are
thin on their own draw orange rather than blue. Sample sizes still are not
printed - the THIN / CHECK FOR BIAS rules from the Stat Prompter are unchanged.

No change to the math, to the SlimDay fields, or to the no-lookahead rule: the
book is still cut to sessions strictly before the selected date.

## 2026-08-25 - GEX Map (test lab): the wall emphasis is a summit ring, not a rule across the frame

Edited: `app/test/GexMapTab.tsx`.

First attempt at this was wrong and is reverted: call wall / put wall / magnet /
gamma flip got a thick white casing on the terrain tab, which drew three heavy
horizontal rules straight across the tape. A wall is a RIDGE on this surface -
it drifts, thickens and fades through the session - and a rule across the frame
says none of that. It also sits ON the terrain rather than describing it. Those
four lines are hairline again on every tab, exactly as they were: they mark the
strike the wall sits at, nothing more.

The emphasis now comes off the FIELD instead. After the iso-GEX contours and the
zero coastline, `TerrainField` scans the resampled grid for each side's peak and
rings it with a contour at `SUMMIT_FRAC` (0.78) of that peak - the line that
closes tightly around the summit rather than another iso level running the width
of the tape. White, 3.4 over a 6.0 dark casing, against 2.4 over 4.0 for the
index contours, so the highest gamma is the heaviest border on the map.

Both sides ring. `signed` is scaled on the session max, so the dominant side
rings at its true peak and the quieter one rings at its own; the ring says "top
of this side" and the fill's brightness still says which of the two is bigger.
`SUMMIT_MIN` (0.14) skips a side with no wall worth calling out - ringing 78% of
a nothing peak would draw a confident outline around chop.

Drawn from the same `F` grid the fill is painted from, so the ring cannot
disagree with the terrain under it.

## 2026-08-25 - Budget on a phone: the Amazon day entry, and why every field was fighting you

New: `owner-vite/src/hooks/useIsMobile.ts`.
Edited: `owner-vite/src/pages/Budget.tsx`,
`owner-vite/src/pages/budget/RealMonth.tsx`, `owner-vite/src/index.css`.

The Budget page is not read on a phone — it is TYPED INTO on a phone, and the
Amazon tab most of all. So the entry path got the work, and the layout pass came
along with it.

### The thing that made every form a fight

`field()` sets `fontSize: 14`. **iOS Safari zooms the page in whenever you focus
an input under 16px, and does not zoom back out when you leave.** So the first
tap on any field shunted the layout sideways and left it there for the rest of
the session — every subsequent tap then landed slightly wrong. 16px is a
threshold, not a preference: 15.9 still zooms.

Fixed once, globally, in `index.css` at ≤820px, with `!important` — the one
legitimate use of it here, because every one of these font sizes is an inline
style and nothing else in CSS outranks that. The same block bumps vertical
padding to 13px, putting targets over the 44px accessibility floor.

That rule alone repairs data entry on every owner page, not just this one.

### The Amazon day entry, rebuilt for a thumb

New `AmazonEntry` component. Desktop keeps the four-across row exactly as it was
— it was never the problem, and stacking it would be a downgrade with a mouse.
The phone gets its own layout:

- **Today / Yesterday chips.** It is nearly always one of the two, and
  "yesterday" through a native date picker is four taps. The date also now
  SURVIVES a save — entering a week of Flex days is the same date over and over,
  and re-picking it every time was most of the work.
- **Persistent labels.** "Pay" and "Gas" were placeholders, so they vanished the
  instant you focused the field: a mis-tap meant typing gas into pay with
  nothing on screen to say so.
- **The right keyboard.** `type="number"` gives iOS its numeric pad;
  `inputMode="decimal"` is what gives ANDROID the pad with a decimal point on it
  — its default numeric keyboard has none, which is how `12.50` becomes `1250`.
  `step="0.01"` lets cents through validation. Also applied to the Payments
  tab's amount field.
- **Live Net.** Flex pay only means something after gas comes out, and doing
  that arithmetic in your head at the kerb is how a wrong number gets saved.
- **Feedback.** A blank save used to return early and silently do nothing, and a
  successful one looked identical to it. The button now says why it is disabled,
  shows "Saving…", confirms "✓ Saved", and puts focus straight back on Pay —
  because the next thing entered is always another day's pay.

Pay and Gas stay side by side even on the phone: they are two halves of one
number, and stacking them loses that.

### The layout pass

Thirty-six hard-coded grid templates rendered at desktop width on a 390px
screen, so the page scrolled sideways and every card was clipped. A stylesheet
could not fix it — owner-vite is inline-styled end to end, so there is nothing
for a media query to hang on, and the blunt `[style*="grid"] { … !important }`
version is exactly the "GLOBAL GRID COLLAPSE" trap AGENTS.md documents: it
flattens the grids that must NOT collapse along with the ones that should.

So: `useIsMobile()` + `gridCols()`, decided per grid, three different answers.

- **Stack it** — card rows, entry forms, the category editor.
- **Keep the columns, buy the room from padding and type** — the Bzila month
  ledgers. Month + in + out + net side by side IS what you open a ledger for; at
  10px padding and 12.5px type all four fit 358px.
- **Scroll sideways inside the card** — the six-column Bzila detail (560px
  floor), Recent Transactions (480), Amazon (460), RealMonth's six tables
  (520–700, sized from their own column widths).

`gridCols()` defaults the mobile side to `minmax(0, 1fr)`, never bare `1fr`.
`1fr` is `minmax(auto, 1fr)`, and `auto` refuses to shrink below its content, so
one long merchant name pushes the column past the viewport and takes the page's
horizontal scroll with it — the most common way a "responsive" grid still
overflows on a phone.

**The calendar.** 7 × 104px = 758px, a two-screen swipe for one month, which
defeats the point of drawing a calendar rather than a list. Phone cells are
48 × 54 — 7 × 48 + gaps = 360px, a whole month inside a 390pt viewport.
`DayCell` scales its own type from the width instead of being a clipped big
cell, and shows `1.2k` where `$1,234.56` cannot fit. The overflow wrappers stay
as the 320px backstop but now start-align: a centred child wider than its
scroller has its left edge clipped UNREACHABLY in Chrome and Safari, which would
have hidden the 1st of the month.

**Tabs.** Seven pills wrapped to three ragged rows and ate a third of the first
screen. One swipeable strip now, scrollbar hidden (it rendered straight across
the pills), with end padding so the clipped last pill reads as "there's more".

Breakpoint is 820px, not 768 — small tablets and landscape phones read far
better stacked than squeezed into three 90px columns.

Caught in review: a padding replacement scoped to `BzilaPanel` leaked past the
end of the component into the shared `th()` helper, which has no `isMobile` in
scope. esbuild compiles that happily (an unresolved identifier is assumed
global) and it would have thrown at runtime on two tables. Reverted, then every
`isMobile` reference in both files was checked against the component that owns
it.
## 2026-08-25 (b) - MobilePrep: the Monday gap bug, the gap block, ES/NQ/VIX, Biggest GEX Changes

Edited: `components/mobile/pages/MobilePrep.tsx`.

The phone's Premarket view was five cards and two of the numbers on it were
blank every Monday. Same three faults the desktop page had, plus the things it
never carried at all.

### It had the Monday bug too

`session` picked the prior session as "newest dated bar before today" out of a
**2-day** `useEsCandles` window. That window is clipped to a rolling 30 HOURS,
so on a Monday premarket the Friday 16:00 bar is ~64h old and is not in it —
the scan landed on SUNDAY (Globex reopen, no RTH bars at all) and Prior close
and Gap printed `—`. Every Monday, and every day after a holiday.

Fixed the same way as the desktop: `candlePool` = the hook's un-clipped
`historical` DB read ∪ `sessionCandles`, `historyDays` 2 → 8 (`daysBack` is
CALENDAR days; the prior TRADING session is three back on a Monday, four after a
holiday). Neither de-duplicated nor sorted — every use is a min / max /
latest-ts scan, all idempotent under duplicates.

Two prior dates now, not one: `pdDate` (last session that actually traded RTH —
Friday on a Monday) and `evDate` (last date with a ≥18:00 Globex bar — Sunday).
The overnight scan is PINNED to `evDate`; with eight sessions in the pool the
old `d < today` test would have folded last Thursday evening into tonight's
range.

Prior close now names its day (`Prior close · Fri`).

### The gap block, not just a gap number

The card showed raw gap points and nothing else. It now carries what the desktop
does, in its own card:

- **PROJECTED** before 09:30 — pre-bell the front ES stands in for an open that
  has not printed, and the row says so instead of looking like a fact.
- **Fill target**, points remaining, and a **retrace bar**. "42% retraced" is a
  number you have to hold in your head; a bar is a glance. Drawn only once the
  open is printed, because before that there is no measurement to draw.
- **✓ FILLED** when price traded back through the prior close after the open,
  using the extreme in the fill direction rather than the last price, so a fill
  that already reversed still reads as filled.
- **INSIDE / OUTSIDE PD RANGE** — the read that changes how you trade it: a gap
  opening beyond yesterday's range has no reference above or below it.
- **Prior day range** as its own stat, which the phone never had.

All of it computed in ES space (every input is an ES bar, `esFut` is ES), so the
basis never enters the arithmetic; only the displayed target price is converted
to SPX, and a constant offset leaves the points alone.

### ES / NQ / VIX

The phone had no futures or vol context whatsoever, which is most of "how did we
get here" before the bell. A 3-up strip off `/api/quotes-batch` on the same 30s
cadence the desktop uses, so the two cannot disagree.

**VIX is coloured inverted** — up is red. A green VIX print would read as "good"
while meaning the opposite for an equity book, and it is the one instrument on
the screen where that flip is correct.

The percent field is `percent-change`, hyphenated — that is the TastyTrade field
name and what the desktop reads. `it.pct` is silently `undefined`.

### Biggest GEX Changes

Top five strike Δ vs the prior close, as a diverging bar list centred on the
strike column — "gamma built above spot, drained below" in one look instead of
five signed numbers to compare.

Same `/api/premarket-baseline` fetch as the desktop, **`basis=oi`**, and the
live side is the OI leg (`γ×OI×S²` = printed OI+Vol minus the volume leg). Both
matter: premarket the live chain has ~no volume while a prior-close baseline
carries yesterday's whole session, so on the OI+Vol basis every strike prints a
large negative Δ that is just the volume leg falling off — an artifact of the
basis, not a position change, and it would be the headline number on the card.

Generation-guarded and cleared on expiry change: `expiry` moves at least twice
on a cold mount, and a stale board for the previous expiry would diff today's
chain against another session's strikes — same symbol, overlapping strikes,
every number plausible, nothing on screen saying so.

The card is only ever non-empty because the board is RECORDED at 16:05 ET
(`server-v2/premarket-baseline.js`); a session with no capture says that rather
than rendering empty, which would read as "no change".

## 2026-08-24 (b) - Premarket: the Monday gap block, and a GEX baseline with no source

Edited: `components/pages/Premarket.tsx`, `server-v2/premarket-baseline.js`.

Two unrelated faults on the same card: one a date bug, one a data source that
had not existed since 2026-08-18.

### Prior close / prior day range / gap / gap-fill target were blank every Monday

`overnight` read `sessionCandles`, which is `useEsCandles`'s rolling **30 HOUR**
window — right for the chart, wrong for a prior RTH close. On a Monday
premarket the Friday 16:00 bar is ~64h old and simply is not in there, so
`pdDate` landed on **Sunday** (Globex reopen, no RTH bars at all), `pdc` and
`pd` stayed null, and four rows printed `—`: Prior RTH close (ES), Prior day
range (ES), Gap (4pm → 9:30), Gap fill target. Every Monday, and every day after
a holiday.

**Fix.** New `candlePool` = the same hook's un-clipped `historical` DB read
unioned with `sessionCandles`; `historyDays` 3 → 8, because `daysBack` is
CALENDAR days and the prior TRADING session is three of them back on a Monday
and four after a holiday. Not de-duplicated and not sorted on purpose —
everything `overnight` does with it is a min / max / latest-ts scan, all three
idempotent under duplicates, so a Map+sort at the feed's 4Hz would buy nothing.
The chart still reads `sessionCandles`; its window is unchanged.

The memo now resolves **two** prior dates, which on a Monday are different days:

- `pdDate` — the last session before today that actually **traded RTH**. Friday
  on a Monday, Thursday after a Friday holiday. Prior close and prior day range
  mean this one and nothing else.
- `evDate` — the last date before today carrying a Globex evening (≥18:00) bar.
  **Sunday** on a Monday, correctly. The overnight scan is now PINNED to it;
  inside a 30h window the old `d < today && mins >= 18:00` test collapsed to the
  same thing, but over a wider pool it would fold Friday evening into a Monday
  overnight range.

### Biggest GEX Changes: the settled sweep has returned zero rows since Theta came out

Not a page bug. `premarket-baseline.js` built the prior-close board from
`computeHistoricalGexRows`, which depends on `fetchOiHistoryTheta`,
`fetchGreeksEodHistoryTheta` and `fetchEodHistoryTheta` — all three stubbed to
benign empties in `tt-snapshot.js` when ThetaData was removed on 2026-08-18
(TastyTrade has no per-option history equivalent). So it threw
`no settle spot for <date>` on every call, `getBaseline()` walked back three
sessions and returned `ok:false`, and the card has been permanently empty since
— the same silent-deadlock shape as the localStorage snapshot it replaced, one
layer down.

Nothing else in the repo could stand in. `eod_gex` is scalars;
`eod_strike_gex` collapses every expiry onto one strike and drops 0DTE;
`option_strike_gex_history` is per-expiry but its SPX writer only ever writes
the FRONT expiry (and retention-cleanup deletes non-front expiries nightly
anyway); `premarket_freeze` stores exactly the one expiry the snapshot was
rendering, i.e. that day's 0DTE. **There is no table anywhere holding
"yesterday's ladder for today's expiry."**

**So it is RECORDED now, not reconstructed.** `captureSession()` runs at 16:05
ET — catch-up window open to 22:00 — pulls the live TastyTrade chain through
`tt-snapshot` for the next few listed expirations, runs the SAME
`computeGexRowsMultiExpiry` the rest of the app runs, and writes straight into
`premarket_baseline` / `_meta` keyed `date = today`. Next morning
`readCached()` hits on the first try and no build is attempted — same rows,
same shape, same `basis=oi` semantics, no client edit.

- Rides `startPremarketBaseline`'s existing 5-minute timer next to `warmTick`
  (writes at the close, reads back in the morning; windows do not overlap, so
  each tick is one clock check and at most one job). No new scheduler, no
  `server-with-proxy.js` change.
- `tt-snapshot` is required **lazily** — it pulls in `proxy-tastytrade`, and
  this module is required by `api-router` at load time. Nothing in the read path
  touches it.
- Three symbols (`$SPX,SPY,QQQ`), three expirations forward, 400ms pacing
  between chain pulls — all env-overridable. Three, not one, so a page on a
  non-0DTE front expiry (holiday weeks) and a recorder that missed a session
  both still have a board.
- The Theta path is **kept unchanged** as a fallback. If `DATA_SOURCE` goes back
  to theta it works again and can still backfill older dates.

### One-session cold start, said out loud

No amount of cleverness recovers a ladder nobody stored, so the card's empty
state stopped claiming the board "is published overnight and backfills on its
own" — it never did — and now names the recorder and the 16:05 capture, so a
missed close reads as a missed close instead of a dash.


## 2026-08-23 (d) - Short links: cbedge.net/x (no verb)

New: `lib/shortLinks.ts`, `app/[source]/route.ts`.
Edited: `app/[source]/[action]/route.ts`, `middleware.ts`,
`owner-vite/src/components/CampaignLinkBuilder.tsx`.

`cbedge.net/x` now works and is the link to paste in a post. It resolves to
exactly what `/x/click` resolved to — `/?utm_source=x&utm_medium=social&utm_campaign=post`
— byte for byte, so **the two-segment form still works and anything already
posted keeps counting under the same campaign.** Same for `/youtube`,
`/tiktok`, `/email`, `/newsletter`, `/discord`, `/reddit`, `/stocktwits`.

`?c=` and `?to=` behave identically on the bare form.

**The profile link stays `/x/profile` (or `/x/bio`).** The ask was for
`/x/click` to become the profile link; that would have silently re-pointed
every `/x/click` already in the wild from the post campaign to the profile one
and put a seam through the middle of the x/post history. `/x/profile` already
existed and does the job. A bio link and a post link have to stay tellable
apart — one trickles forever from people who looked you up, the other spikes
with what you wrote, and one number for both hides both.

**Why the bare form is an allowlist.** `app/[source]/route.ts` is a root-level
SINGLE dynamic segment, which unguarded swallows every unknown top-level path:
a typo like `/pricng` would stop being a 404 and start being a 302 that logs a
referral from a source called "pricng". So it answers only for sources that
have a `<source>/click` row in PLACEMENTS, and 404s otherwise. Real routes were
never at risk — Next resolves static segments before dynamic ones.

**One table, three consumers.** The PLACEMENTS table, the action list, the slug
rule and the `?to=` open-redirect guard moved into `lib/shortLinks.ts`, which
both route handlers and `middleware.ts` now import. The middleware public
pattern for the bare form is BUILT from that list rather than typed out —
a link that 302s but is gated, or is public but 404s, is the same bug twice.
It must stay an explicit alternation: `^\/[a-z0-9-]+$` would make every
single-segment path public, which is every gated page on the site
(`/es-candles`, `/scanner`, `/owner`).

The link builder now offers the bare form for the standard placements and for
any one-off source on the allowlist; an unknown one-off still gets `/click`,
since the bare route would 404 on it.

## 2026-08-23 (c) - Owner Overview: the two 2px "bars" at the bottom were collapsed cards

Edited: `owner-vite/src/pages/ControlPanel.tsx`.

Two thin horizontal lines sat at the bottom of the Overview page under the
campaign link builder, 12px apart, with nothing between them. They are the
**Flow · Ticker Visits** and **EM · Ticker Visits** cards, shrunk to zero
height — each line is that card's top and bottom border with no content
between.

Cause: the scrollable page body is a **column flex container** with
`height: 0; flex: 1; overflow-y: auto`, and flex items default to
`flex-shrink: 1`. A card normally survives that because of its automatic
minimum size — but that protection only applies while `overflow` is `visible`,
and `TickerVisitsCard` sets `overflow: hidden` on its panel for the rounded
clip. With the page content taller than the container, the shrink had to land
somewhere, and those two were the only children free to absorb it.

Fix: the scroll body now also carries `owner-page-body`, with one rule —
`.owner-page-body > * { flex-shrink: 0; }`. Nothing in a scroll container
should ever shrink; it scrolls. This covers every current and future card on
the page rather than patching the two that happened to show it.

Separately: those two cards are also **empty** — `/api/ticker-event?sinceDays=7`
returns nothing for either source, so once they have height they read "No ticker
visits recorded in this window."

## 2026-08-23 (b) - Owner Overview: hourly heatmap removed, Campaigns is a bar list

Edited: `owner-vite/src/pages/ControlPanel.tsx`, `owner-vite/src/components/AcquisitionPanel.tsx`.

**Hourly load heatmap removed** from the Overview tab. `<HourlyHeatmap />` and
its import are gone; `components/HourlyHeatmap.tsx` still exists on disk but is
no longer mounted anywhere. Nothing was read off it that the Traffic card's
live/daily buckets don't already say, and it cost its own fetch plus a 7x24 fold
of the visit log.

**Campaigns is now a ranked bar list, not a table** — same shape as "Pages being
visited": name on the left with a magnitude bar under it, counts right-aligned
in a matching column grid (`CAMPAIGN_COLS`). The bar encodes **sessions** (the
clicks the link got).

The sort moved with it, and had to: it was `paid → signups → sessions`, which
answers "which push earned customers". A ranked bar list sorted on a column
other than the one its bars draw reads as broken, so it is now
`sessions → paid → signups`. Signups / Paid / Conv. stay as columns beside the
bar, so the earnings question is still one glance away.

## 2026-08-23 - Owner Overview: kill the Intl cost behind the traffic / pages-visited lag

Edited: `owner-vite/src/pages/ControlPanel.tsx`.

Still laggy after the 2026-08-22 re-render fix. That one stopped the work from
running *every second*; it did nothing about how expensive one run is. Profiling
the Overview tab put nearly all of it in one place: **`Date#toLocaleDateString` /
`toLocaleString` called once per visit row.** Each of those calls constructs a
fresh `Intl.DateTimeFormat` internally, and the construction — not the
formatting — is the cost. `/api/page-visits?days=30&limit=20000` returns tens of
thousands of rows, and six separate passes were formatting every one of them.

**1. ET bucket keys are now arithmetic, not `Intl`.** America/New_York's UTC
offset only changes at DST boundaries, and those land on an hour mark — so one
`Intl` lookup per *UTC hour* answers for every row inside it. 30 days of visits
touch ~720 cached buckets instead of 20,000 formats; every key after that is
integer math on a shifted timestamp. New `etOffsetMs` / `etDayKeyMs` /
`etHourKeyMs` / `etYearMs`; `etDayKey`/`etDayLabel` keep their signatures and
delegate. Verified identical output against the old formatters over three years
at 7-minute steps (225,463 samples, both DST switches, zero mismatches).
Measured on one 20k-row pass: **1528ms → 51ms.**

**2. `hourBuckets` formatted every timestamp twice.** It called `hourKey(t)` for
the map read *and* again for the map write, doubling the cost of the hottest
loop on the tab. Keyed once now.

**3. `navLabelFor` rebuilt the nav table on every call.**
`NAV_GROUPS.flatMap(g => g.items).find(...)` — allocated a flattened array and
linear-scanned it, once per visit row, because `describePage()` calls it. Now a
module-level `NAV_LABEL_BY_HREF` map built once. `labelFor` inside
`overviewMetrics` had the same body and now shares it.

**4. `describePage` is memoised.** Tens of thousands of rows, a few dozen
distinct `(page_key, path, label)` triples — every row after the first for a
page is a map hit instead of a regex plus a nav lookup.

**5. `seriesFor` is memoised in both of its callers.** `KpiStrip` and
`MetricsTabSection` each called it bare, so each re-bucketed the whole visit log
on every render. `KpiStrip` is the worse of the two: its five `useLiveSeries`
hooks append a point on every poll, so it re-renders on a timer regardless of
whether `visits` changed. Both are `useMemo`d on `[gran, visits, signups]`.

**6. `onToday` no longer formats per row.** The unique-visitors-today set
compared `toLocaleDateString(...)` against today's date string for every row; it
now compares the cheap ET day key. A plain timestamp cutoff would have been
wrong — the ET day starts at a different UTC instant depending on DST — so the
key comparison stays.

Also trimmed the per-row `new Date()` allocations in the weekly/daily/monthly/
yearly bucketers in favour of `Date.parse` plus one reused `Date`.

No behavior change: same buckets, same labels, same numbers. Client-side only —
no API, proxy or server change.

## 2026-08-22 (b) - Owner Overview: fix the 1Hz re-render that made the page crawl

Edited: `owner-vite/src/pages/ControlPanel.tsx`.

The page had become very laggy. Four causes, all of them the same shape: a
one-second interval that exists to move a clock was driving work that has
nothing to do with a clock. The visit-log cards added yesterday didn't create
any of this — they made an existing problem expensive enough to feel.

**1. `overviewMetrics` was a bare IIFE.** A `setInterval` bumps
`uptimeTick`/`setTick` every second so the sidebar's uptime and "Ns ago" stay
live. That re-renders ControlPanel, and the metrics block re-ran on every tick:
a full pass over `visits` for the unique-visitors-today set, three more for the
daily/weekly series, a sort of `pageStatuses` — thousands of rows of work per
second, to redraw a clock. It also returned a **fresh object** each time, so
`OverviewSection` and every chart, bar list and table under it re-rendered at
1Hz too. Now `useMemo`, keyed on the state the numbers actually come from.

**2. The metrics object carried a per-second field.** `uptime: fmtUptime(…)`
recomputed every tick and was the one thing in the object that could never be
stable — so it alone would have defeated the memo. Nothing read it: the
destructure in `OverviewSection` never included it. Removed from the object and
the type.

**3. `OverviewSection` is now `React.memo`.** Paired with (1), and both are
needed: memoising the data alone still hands down a new object, memoising the
component alone still receives one. Together a tick that changes nothing on the
tab costs nothing on the tab.

**4. `SidebarContent` was a component declared inside render.** A new function
identity every render means React tears down and rebuilds the subtree whose type
changed — so the mobile drawer was unmounting and remounting once per second,
losing any focus or scroll inside it. Called as `{SidebarContent()}` now, which
inlines the JSX into the parent's own tree where it reconciles normally.

**Plus: the visit log no longer re-downloads every 60s.** `refresh()` runs on a
one-minute timer and was re-pulling `/api/page-visits?days=30&limit=20000` with
it. Every arrival replaces the array, which invalidates the memos in four
consumers (metrics, Top pages, Acquisition, the link builder) and makes all of
them re-derive from scratch — a visible hitch every minute, buying a fresher
view of a log that is read in 24h/7d/30d windows. Throttled to 5 minutes via a
ref that only advances on a SUCCESSFUL fetch, so a failed attempt retries on the
next refresh instead of waiting out the window.

The 1s interval itself is left alone — it is correct for what it was for, and
the fix is that it can no longer reach anything else.
## 2026-08-22 - Session picker: wire it to the history that actually exists

Edited: `components/pages/premarket/postMarketData.ts`,
`components/pages/premarket/HistoricalRecap.tsx`,
`components/pages/Premarket.tsx`.

The first cut of the picker only read the two stores the post-market tab already
used — `/proxy/walls` and the per-minute strike ladder — so anything older than
about two sessions rendered as "not retained". That was wrong about the repo:
there are per-day stores here that go back indefinitely. Three of them are now
wired in.

**`/proxy/gex-levels-history` is the spine.** `gex-levels-history-recorder.js`
writes ONE row per (date, SPX), upserted all session, and **keeps it forever** —
and back-fills its own gaps from settled ThetaData OI on boot, so a session the
live recorder missed still has a row. Per date it carries spot, call wall
(`resistance`), put wall (`support`), gamma flip (`neutral`), dollar gamma, the
call/put gamma ratio, R2/S2 and a 48-point cumulative GEX curve. New hook
`useGexLevelsHistory`.

**`/api/eod-gex`** adds what that store does not have: the 0DTE / ex-0DTE split
and the recorder's own pin (strike + share of board gamma). New hook `useEodGex`.
Note the symbol keys differ between the two tables — `SPX` in the levels store,
`$SPX` in `eod_gex` — so the date is queried without a symbol and the SPX row
picked out of the answer.

**`/api/snapshots/candles?date=&lite=1`** gives the session its real price path
(ES 5m bars, RTH). Deliberately **not** converted to SPX: a past session's basis
is not knowable from a live quote, and shifting a whole day by today's basis is
the kind of plausible-but-wrong number this page refuses to print. The range is
labelled ES and the SPX side comes from the levels store.

The recap is now five sections: settled close (four tiles + the five levels + the
cumulative gamma curve), ES session range, how the levels behaved (the wall log
grade, unchanged), where the gamma sat (the per-minute ladder — still a bonus on
recent dates, and the only panel with a retention floor), and the journal. Where
the SPX intraday path IS on file, the recap also grades whether the day held
inside the walls; where it is not, it says nothing rather than grading an SPX
wall against an ES range.

**The dropdown now lists the sessions that actually have a settled row**, newest
first, instead of a computed run of weekdays — the difference between a picker
that always lands on data and one that offers Thanksgiving. The weekday walk
stays as the fallback while the request is in flight and if it fails. The picker
and the recap issue the same URL so `dedupeFetch` collapses them into one
request; `GEX_HISTORY_LIMIT` (40 sessions, ~35KB with the curves) is defined once
in `postMarketData.ts` to keep it that way.

The curve chart is inline SVG, no library. It stretches to fill its card
(`preserveAspectRatio="none"`), so it carries no `<text>` — glyphs would smear on
a narrow screen — and every stroke uses `vectorEffect="non-scaling-stroke"`. The
level labels are ordinary HTML in the legend row under it.

Still not shown for a past date, and still on purpose: written-vs-traded, the
positioned/written split, premium, next-expiry structure. Each needs that day's
own chain with its marks, volumes and open interest, and nothing stores that per
strike per past day.


## 2026-08-22 - Premarket / Post-Market: session date picker

Edited: `components/pages/Premarket.tsx`,
`components/pages/premarket/postMarketData.ts`,
`components/pages/premarket/PostMarketTab.tsx`.
Added: `components/pages/premarket/HistoricalRecap.tsx`.

The page head gained a **session date dropdown** (right of the concept badge,
left of the Premarket / Post-Market toggle). It lists the last 15 trading
sessions, newest first, "Today" first. The choice is kept in `sessionStorage`
(`cb-premarket-date-v1`) for the session only — a date is a look-up, not a
setting — and a stored date that has aged out of the window snaps back to today.

Styling is the page's own `.pmk` theme, not a raw browser control: `.dsel` strips
the native chrome and redraws the caret from theme tokens, matching the `.tabs`
shell exactly (1px `--line2`, 9px radius, 11.5px type). `option` is repainted too
or a dark page opens a white OS menu. On a past date the control turns amber, so
"you are not looking at today" is visible without reading the label.

**Today is unchanged** — same live Premarket and Post-Market tabs, same feed,
same panels.

**A past date gets its own view** (`HistoricalRecap`), not PostMarketTab pointed
backwards. PostMarketTab reads the CURRENT chain for spot, walls, net GEX,
premium and the build-time bars; feeding it a past date would have printed
today's numbers under yesterday's headline, which is exactly what that tab's
"nothing here is synthetic" rule exists to prevent. The Pre/Post toggle is
disabled while a past date is selected and the title reads "Session Recap".

The recap renders only what is genuinely stored per date:

- **Recorded levels** — `/proxy/walls?date&symbol` (server-v2/walls-recorder.js):
  the 09:29 capture, every subsequent move of call wall / put wall / CORE, and
  every classified touch (reject / break / pin / new wall / …), plus the full
  move log. Same verdicts `/level-log` shows.
- **How the session closed** — the per-minute strike ladder for that exact day,
  via a new optional `date` argument on `useIntradayLadder`. It switches the
  route to `minutes=0&date=` (the route's own "this named day" path) and skips
  the newest-non-weekend-day heuristic, since the caller named the session.
  Retention keeps ~2 sessions, so older dates answer empty and say so rather
  than being back-filled.
- **Session journal** — the same per-date note the live tab writes. `NOTES_KEY`
  moved into `postMarketData.ts` and PostMarketTab now imports it, so one note
  per day exists across both surfaces instead of two.

A closing panel names what a past date deliberately cannot show (snapshot row,
build-time bars, written-vs-traded, positioned/written split, premium,
next-expiry structure) and why: each needs that session's own chain with its
marks, volumes and open interest, and nothing stores that per strike per past
day.

No hardcoded hex added — every colour is a `.pmk` custom property.


## 2026-08-22 - Pricing page: yearly is $400 via EDGE3, and it now shouts

Edited: `app/pricing/page.tsx`.

Yearly moves from $500 to **$400** and the promo code changes from `YEAR` to
**`EDGE3`**. The point of the change is conversion, so the yearly row stopped
being a peer of monthly and became the promoted plan:

- The yearly `PlanPrice` is wrapped in its own accent panel — 2px cyan border,
  cyan gradient fill, outer glow — with a **"Best value · Save $140"** ribbon
  notched over the top-left corner.
- `PlanPrice` gained a `highlight` prop: white bold label, 38px figure (vs 24px)
  and a cyan text-shadow. Monthly is unchanged and now reads as the quieter
  option next to it.
- Savings math spelled out under the figure: *60% off · works out to $33/mo —
  under 12 months of monthly billing.* ($45 × 12 = $540 vs $400.)
- The code box promotes `EDGE3` at heavier weight than `MONTH` and adds a second
  line, **"EDGE3 = $400 for the year"**, so the number and the code are never
  read apart.
- Checkout button label: `Subscribe yearly — $400/yr · best value`.

All color comes from `HOME_THEME` (`T.cyan`, `T.text`) — no new hardcoded hex.

Not touched: `app/api/stripe/checkout/route.ts`. It resolves plans through
`getPriceIdForPlan()` / Stripe price IDs and hardcodes no dollar amounts, so the
$400 has to exist as the `EDGE3` coupon in Stripe — the page only advertises it.


## 2026-08-21 (z) - The last cog: home's econ Panel is tabbed too, and every live cog in the app now is

Edited: `components/shared/DockToolbar.tsx`, `app/home/HomeClient.tsx`.

Swept the repo for `DockCogMenu`. Live callers, all of them now on the tabbed
`sections` API:

| Toolbar | File |
|---|---|
| Home GEX chart | `components/dashboard/GexToolbar.tsx` |
| Home heatmap | `app/home/HomeClient.tsx` |
| **Home econ Panel** | `app/home/HomeClient.tsx` — **this entry** |
| ES Candles | `components/dashboard/es-candles/EsChartCard.tsx` |
| Options Chain | `components/pages/OptionsChain.tsx` |
| Multi Greek | `app/mult-greek/MultGreekClient.tsx` |

Nothing else in `components/**` or `app/**` opens one. The universal
`GlobalToolbar` is untouched by design — it has no cog and is not a settings
surface. `app/es-candles/page.tsx` (the Next fallback copy the SPA does not
serve) still carries the old popover; it goes when that file does.

**New `DockCogSection.keepMounted`.** The econ Panel cog was the one caller
still on the `children` path, and it had a real reason: `EconCalendarPanel`
PORTALS its filter row into a node inside that menu, and `children` mode keeps
its subtree mounted while closed. Tab mode renders only the active body, so a
naive conversion would have handed the calendar a null target on every tab
switch — it falls back to rendering its own inline header, which shoves the
calendar down the page. `keepMounted` renders that section's body always,
hidden with `display: none` when its tab is not showing. Costs a mounted
subtree; use it only where a ref has to survive.

Panel cog sections: **Height** (min / half / full, with the current one in the
cap state line) · **Tab controls** (`keepMounted`, the calendar's portal
target). `paneHeight` 132 — both tabs are one row.

## 2026-08-21 (y) - Cog panels are TABBED now: one fixed-height pane, and the box never moves

Edited: `components/shared/DockToolbar.tsx`,
`components/dashboard/es-candles/EsChartCard.tsx`,
`components/pages/EsCandles.tsx`, `components/dashboard/GexToolbar.tsx`,
`app/home/HomeClient.tsx`, `components/pages/OptionsChain.tsx`,
`app/mult-greek/MultGreekClient.tsx`.

`DockCogMenu`'s `sections` mode renders **tabs over one fixed-height pane**
instead of an accordion. Same `DockCogSection[]` API, same callers, no
signature change beyond a new optional `paneHeight`.

**Why tabs and not the accordion.** The accordion's problem was never the
sections, it was what unfolding one did to the BOX: the panel grew, everything
below the row jumped, `place()` re-ran, and near the bottom of the screen the
whole panel flipped above the trigger while the cursor was already moving toward
a control. Open two rows and it grew a scrollbar, and a scrollbar inside a
popover steals the trackpad. A fixed pane cannot do any of that — the panel is
the same box on every open and for as long as it is open. The cost is honest and
accepted: a two-control tab pads with empty space.

- `activeId` replaces `openIds`; still sticky across open/close, still defaults
  to `sections[0]` without the caller naming an id.
- **The cap carries a state line** — every section's `summary` joined
  ("1 chart · 1m · Front · Vol+OI"), ellipsised to one row. That is how a tab
  you are not looking at still answers its own question, which is the job the
  accordion's per-row summary was doing. `count` rides on the tab itself.
- The tab row scrolls horizontally rather than wrapping; a second row of tabs
  would change the panel's height, which is the one thing this layout exists to
  prevent.
- `paneHeight` defaults to 262 and is clamped down only by what `place()` says
  the viewport has (`maxH - 84`, floor 150) — so the height changes when the
  WINDOW does and never mid-edit.

**ES Candles: Overlays + Indicators merged into one "Draw" tab.** They are the
card's state and the route's state respectively, but that is plumbing — to
anyone reading the chart they are the same question, and two adjacent tabs
called Overlays and Indicators is a distinction the toolbar should not be asking
about. `cogSections` now splices the route's `indicators` section into the Draw
body under a rule (gamma layer above, price layer below) and drops it from the
tab order. Tabs are **Page · Draw · Chart · Gamma · Layout** (+ Replay on the
embed), panel width 360 → 400.

Per-toolbar `paneHeight`, sized to each one's tallest tab: GEX chart 218 ·
home heatmap 150 · Options Chain 196 · Multi Greek 158.

## 2026-08-21 (x) - ES Candles panels: the toggles are chips now, the checkboxes are gone

Edited: `components/dashboard/es-candles/panelUi.tsx`,
`components/pages/EsCandles.tsx`,
`components/dashboard/es-candles/EsChartCard.tsx`.

Every on/off control inside the chart cog - the seven overlays, the EMAs, the
studies, the CB-line marker - was a pill with a 12-14px filled square in front
of the label. Two things were wrong with it in a 330px panel:

- **It read as squares, not as a list.** With four things on, the Draw section
  rendered as a field of saturated blue blocks with words beside them. The eye
  went to the blocks; the labels were the afterthought.
- **It was a second visual language inside one menu.** The other half of that
  panel is `SegGroup` pickers, which indicate state by lighting up. A checkbox
  next to a segmented control is two grammars for the same idea.

Both `PanelChip` (overlays, markers) and `EsCandles`' local `Toggle` (indicators)
are now **chips**: rounded pill, flat and grey when off, lit + cyan-bordered with
a soft glow when on - the same treatment `SegGroup` already uses, so the panel
speaks one language throughout. The checkbox's real job - "is anything on in
here?" - is already done better by the section header's live "N on" count, which
landed with the accordion.

`swatch` survives on the indicator chips and matters more without the box: it is
what tells three running EMAs apart without toggling them off one at a time.

**Two layout fixes that follow from chips hugging their labels:**

- The overlays container went from a fixed `minmax(0,1fr) minmax(0,1fr)` grid to
  a wrapping flex row. A two-track grid sized every cell to the widest chip, so
  "TPO" sat in a box built for "PDH/ON+EM" and short labels left a ragged empty
  column. Flowing packs seven overlays into three lines instead of four and
  stops the labels truncating.
- The CB-line chip inside `PanelSection` got a flex wrapper. That section is a
  grid whose cells stretch (the sliders want that), and a chip stretched to the
  full panel width stops reading as a chip.

## 2026-08-21 - Test Labs GEX Map: terrain is lit, not just tinted

Edited: `app/test/GexMapTab.tsx` (`TerrainField`).

The Terrain tab was a flat hypsometric tint: 18 quantized bands plus contour
lines. Colour said *how much*, but nothing said *how steep* — a 0.9 plateau and
a 0.9 spike painted identically, and the strongest walls read as one bright
smear rather than as structure standing off the plane.

The field is now **lit like a surface** before it is tinted.

- **Height = |gamma|**, on the same `** 0.55` curve the tint already uses, so a
  band step and a facet of the surface describe the same rise. Height is the
  magnitude, NOT the signed value: a signed surface turns the put side into a
  trench, which lights correctly but reads wrong against a ramp that says
  "bright = strong" on both sides. Call walls and put walls are both mountains;
  the colour says which. One rule holds everywhere — taller is stronger.
- **Hillshade.** Sun at upper-left, ~29° above the horizon (low on purpose — it
  is what makes a small step throw a visible face). Gradients are precomputed
  per grid node (`GX`/`GY`) at `EXAG = 22`; a grid cell is a couple of minutes
  by a fraction of a strike, so raw slope is hundredths per cell and anything
  under ~5× lights flat. Lighting itself is per pixel, bilinear from the same
  four corners and weights the field value uses, so the shading cannot slide
  off the shape it belongs to.
- **Flat ground keeps its colour.** `shd` is 0.48 on dead-flat terrain and the
  multiplier is centred to land on ~1.0 there, so only SLOPE moves a pixel:
  lit faces up to ~1.8×, shadowed faces down to 0.28×.
- **Relief earns its strength.** The shade is scaled by elevation (`relief`),
  so the noise floor of the quiet tape is not lit into fake mountains.
- **Terracing.** The bands are the physical model — stacked plates with a riser
  up to the next — and diffuse light alone rounds them off. The strip just
  below each band edge is now lit as its own near-vertical face (bright where
  downhill faces the sun, dark where it faces away). That pair of edges per
  step is what the eye reads as height. Gated on slope magnitude and elevation
  so flat chop is never embossed into structure that is not in the gamma.
- **Specular crest.** `shd ** 16` (by squaring — this runs millions of times per
  paint), gated on `|v|²`, so big walls glint and chop does not. This is the
  "obvious when it is high" term.

Nothing about the DATA changed: no renormalization, the same session-scaled
`signed` field, the same 18 bands, the same contour levels and zero coastline.
The marching-squares pass draws over the lit fill unchanged.

Preview of the shading model: `generated/2026-08-21-gex-terrain-relief.png`.

## 2026-08-21 (w) - Fix: permessage-deflate silently killed every browser WebSocket (site-wide outage)

Edited: `server-v2/websocket-server.js`.

Every dashboard page was stuck on "LOADING SPX CHAIN…", "waiting for the feed…",
"waiting for gex rows…", "waiting for levels…", and CANDLES showed OFFLINE. The
gauges still had numbers because those come from REST, which was never broken —
`/api/chains`, `/api/expirations`, `/api/levels`, `/proxy/health` and
`/proxy/snapshot` were all 200 and fast throughout.

**Symptom.** Every `wss://.../ws/gex` connection completed the handshake (101),
then died in ~2ms with close code 1006 and **zero frames delivered**. The client
reconnected, and repeated, roughly once per second, forever. `/proxy/self-metrics`
showed ~22MB/min of connect-snapshot bytes accounted while `clients` sat at 1 or
2 — the server was building and "sending" a snapshot for every one of those dead
connections. That churn is what drove RSS to 1.29GB and forced an OOM restart.

**Cause.** The `perMessageDeflate` config on the `WebSocket.Server`. Every
browser negotiates permessage-deflate, so every browser client hit it; internal
clients that don't negotiate it were fine. Proven with a paired probe run inside
the container against loopback, so Cloudflare and the tunnel were not involved:

```
deflate-OFF -> openAt 5ms, msgs: 1   (snapshot delivered)
deflate-ON  -> openAt 2ms, msgs: 0   (dead at 2ms)
```

A raw TCP socket sending no `Sec-WebSocket-Extensions` header streamed the
snapshot and held open for a full 6s.

**Why it took hours to find.** `ws.on('error', () => {})` in the connection
handler. `ws` destroys the socket on a send/compress failure and reports the
reason *only* on that event, so the one line that named the cause was thrown
away on every connection. The logs said nothing. Ruled out along the way, each
costing a round trip: Cloudflare (restarted cloudflared), the tunnel (loopback
repro), double-attach (`GEX broadcaster attached` is logged once per boot, one
container in `docker compose ps`), WS auth (`WS_AUTH_REQUIRED` is unset), and
snapshot size (374KB, well under any limit).

**Fix.** The deflate config is now behind `WS_DEFLATE`, defaulting to **off**:

- `WS_DEFLATE=off` (default) — no compression, every client works
- `WS_DEFLATE=on` — the previous tuned config (`threshold: 1024`,
  `zlibDeflateOptions: { level: 6, memLevel: 7 }`, `serverNoContextTakeover`,
  `clientNoContextTakeover`), preserved verbatim
- `WS_DEFLATE=default` — permessage-deflate with `ws`'s own defaults

It is a switch rather than a deletion because the compression was load-bearing:
these payloads are pure JSON and deflate cuts them ~80-90%, and `/ws/gex` egress
is uncacheable and counts 100% as Cloudflare "bandwidth served". **Turning it off
raises that egress roughly 5-10x.** Getting it back is the open follow-up — try
`WS_DEFLATE=default` first, since the custom zlib options are the likeliest
culprit, and verify with the paired probe before trusting it.

Worth noting: all three modes pass a local harness against a stubbed
market-state, including `on`. The failure is specific to the production process,
so it is environmental (zlib/memory) rather than a plain misconfiguration — which
is exactly why this is an env switch and not a rewrite.

Also changed: `ws.on('error')` now logs through a rate-limited `logWsError()`
(one line per distinct message per 60s, with a suppressed-count) instead of
swallowing. Unthrottled it would have been the outage's second act, at ~1
failing connection per second.

**Open thread, not addressed here:** with deflate off, the `ws` client probe
still closed at 9ms after receiving its snapshot, while the raw socket held for
6s. Re-measure once this is deployed.

## 2026-08-21 (v) - Fix: short campaign links redirected to localhost:3000

Edited: `app/[source]/[action]/route.ts`.

`cbedge.net/x/click` produced the right tags and then sent the visitor to
`https://localhost:3000/?utm_source=x&utm_medium=social&utm_campaign=post`.

The redirect was built with `new URL(to, req.nextUrl.origin)`. In production
Next sits behind the VPS proxy, so the origin it sees is the internal one it was
dialled on — `localhost:3000`. The public hostname exists only in the forwarded
headers, and the `https` in the broken URL is the giveaway: proto came from
`x-forwarded-proto` (Cloudflare) while the host came from the socket, so the two
halves were assembled from different places and neither was checked.

Now the route emits a **relative** `Location` (`/?utm_source=…`) and lets the
browser resolve it against the URL in the address bar. RFC 7231 allows a
relative reference, every browser resolves it that way, nginx passes it through
untouched (`proxy_redirect` only rewrites absolute ones), and it is correct in
local dev with no configuration — no header to trust, no protocol to guess, no
env var to keep in sync.

The `?to=` guard is unchanged and still rejects `//evil.com` and
`https://evil.com`, both of which fall back to `/`.

## 2026-08-21 (p) - Pick Study calibration arms itself: the projection rule is fitted from the study, not hand-written

Edited: `server-v2/_lib-pick-grade.cjs`,
`server-v2/gex-change-top-recorder.js`, `server-v2/server-with-proxy.js`,
`components/scanner/PickStudyTab.tsx`,
`server-v2/config/pick-proj-rule.example.json`.

**The complaint.** Calibration on the Pick Study tab has always read "no
projection rule is armed... to arm it, hit the term button on each row and drop
them into server-v2/config/pick-proj-rule.json". That is a code edit and a
redeploy to turn on a feature that is otherwise entirely data-driven, so it
never got turned on, so nothing was ever projected, so the calibration table has
been empty since the day it shipped. Shipping inert was the right call. Staying
inert forever was not a design, it was an unfinished loop.

**What changed.** The two filters the page tells you to read by eye - a bucket
must be **not thin** and must **hold** in both halves of the window - are now
code. `PG.fitRule()` runs them over every bucket of every feature and returns
the rule the study already implies. The recorder runs it after each EOD freeze
and arms it the moment the evidence clears the bar.

**The discipline did not move, it just stopped needing a human to enforce it:**

- Nothing arms under `GEX_CHANGE_TOP_FIT_MIN_PICKS` (150) graded picks, however
  good the splits look.
- A bucket that is thin, or that failed the half-split, is never used. Those are
  the two filters that kill most findings; automating past them would have been
  automating the mistake.
- Never fits on `symbol` - see the note on `BUCKETS.symbol` about tickers being
  the first thing to stop working.
- Never triple-counts the score blend: `score` is 0.6*|d| + 0.4*|%|, so when a
  score term lands, `chg` and `pctopen` are dropped. Stacking all three turns a
  6pt edge into an 18pt one that was never there.
- A term's points ARE its measured lift, clamped to +/-20. The rule can only
  claim what the table showed.
- Everything rejected comes back with a reason, and the UI lists it. A rule you
  cannot audit is a fitted model with extra steps.

**Stored in Postgres, not in the config file.** The deploy rebuilds the
container from GitHub, so a rule written to `server-v2/config/` evaporates at
the next `docker compose build` - projections would stop mid-window and the
calibration table would silently mix two regimes. New singleton table
`pick_proj_rule` (rule JSONB + `fitted_at` + `fitted_by` + the evidence it was
built from), reloaded into memory at boot so projections resume on the first
capture after a restart.

**Three tiers, highest wins:** `GEX_CHANGE_TOP_PROJ_RULE` env >
`config/pick-proj-rule.json` > the stored rule. The config file's presence also
**pins**: the auto-fit still runs and still reports, but will not overwrite a
rule you wrote by hand. Delete the file to hand control back.

**New endpoints** (writes owner-only, as proxy-auth gates every non-GET on
`/proxy/*`):

- `GET /proxy/gex-change-top-rule` - what is armed, from where, with what terms,
  the thresholds, and the last fit.
- `POST /proxy/gex-change-top-rule-fit?days=90&cohort=selected[&apply=1]` -
  without `apply` it is a **dry run**: the terms it would arm plus every bucket
  it rejected and why. With `apply=1` it stores.
- `POST /proxy/gex-change-top-rule` - `{ rule }` to pin by hand, `{ clear:true }`
  to go inert again.

**On the tab.** The calibration block leads with a status bar: armed (source,
terms as signed chips, fit date) or a progress bar reading "88/150 graded
picks". "Not armed" was a dead end; "needs 62 more picks, re-checked after every
close" is a wait with an end. Buttons: **Fit now** (preview, changes nothing),
**Fit & arm**, **Disarm**. The rejected list is collapsible and is the half
worth reading - the buckets that almost made it are where a bad rule would come
from.

**Not touched:** projections already stamped on past picks. They are stamped at
capture and never recomputed, which is the only reason calibration is a real
out-of-sample test rather than a restatement. Re-fitting changes what happens
from the next capture on; history stays as it was predicted.

**Refactor:** `getStudy()`'s bucket math moved into `bucketsFor()`, shared with
the fit, so the numbers the rule is built from are byte-identical to the ones on
screen. Had those drifted, the fit would have been quietly encoding a different
table than the one you audited.

**Knobs:** `GEX_CHANGE_TOP_AUTOFIT=0` (off), `..._FIT_DAYS` (90),
`..._FIT_MIN_PICKS` (150), `..._FIT_MIN_LIFT` (6), `..._FIT_MAX_TERMS` (8),
`..._FIT_MAX_PTS` (20).

Also fixed: `config/pick-proj-rule.example.json` was truncated mid-array and was
not valid JSON, so copying it as instructed produced a parse error and a silently
inert rule.

## 2026-08-21 (u) - Gamma flip was structurally unable to print on a put-dominant book; Open Card accents removed

Edited: `owner-vite/src/pages/GexGrowth.tsx`, `server-v2/eod-strike-gex-recorder.js`.

### The flip never showed, and it was not a data problem

The gamma flip was defined - on BOTH sides, client and server, identically - as
the zero crossing of the CUMULATIVE net GEX, walking the ladder from the lowest
strike up. That quantity is not the flip, and the failure mode is structural:

> The running total starts at 0 and ends at the book's net. On a normal chain -
> puts heavy below spot, calls heavy above - it falls through the put side,
> bottoms out, then climbs back through the call side. **It can therefore only
> return to zero if the whole book is net positive.** On any put-dominant
> session the curve is negative from the second strike to the last, there is no
> crossing to find, and the tile prints "-".

For SPX that is most days. Hence: never shows. Same root cause silently killed
the rail's `FLIP GONE` / `FLIP NEW` / `FLIP ±x` badges and most of `structScore`,
which is the `Most structural` sort - so the one sort that finds a name whose
structure moved was ranking on a term that was usually zero.

It was also **wrong when it did print**. Because the curve has to claw all the
way back from the bottom of the recorded window, where it crosses is driven by
how much far-OTM put gamma happens to sit at the low end of the ±40 strikes -
strikes nobody hedges at spot. On a long-gamma test book the old rule put the
flip at 7826, *above* the call wall.

### What it is now

Dealer gamma at a given price is dominated by the strikes NEAR that price. So
net exposure with price at `S` is the book weighted by a bell centred on `S`,
and the flip is where that local profile changes sign. Scan `S` across the
ladder, interpolate the crossings, take the one nearest spot.

Verified against synthetic books matching the reported SPX screenshot
(spot 7,641 / put wall 7,500 / call wall 7,800 / net -37B):

| book | old rule | new rule |
|---|---|---|
| put-dominant (the live case) | *(none)* | **7,717.6** - between spot and the call wall |
| call-dominant | 7,826 (above the call wall) | 7,640.3 (+ a second at 7,343, so the `2x crossing` chip fires) |
| same book on 5pt vs 10pt strikes | - | identical - the kernel is in price space, not rungs |
| SPY-like $1 strikes | - | 618.06 |
| one-signed rungs / <3 rows / all zero | - | null, no crash |

Kernel width is **smoothing, not a volatility claim**: 1% of spot, blending the
weekly and quarterly gamma this ex-0DTE ladder stacks together, floored at two
strike spacings so a wide-strike name cannot collapse onto one rung. Weights
past 4 sigma are skipped. The honest limit is in the header comment: the
textbook flip reprices every contract at candidate spots, which needs IV and
DTE; the recorder stores `|gamma| x OI` per strike and nothing else, so this is
a proxy that gets the shape and the sign right and cannot model the surface.

**The two implementations are line-for-line identical by intent** and both say
so - a rail badge that disagrees with the tile it opens is worse than neither.

### Better empty states

"No flip" now distinguishes three cases instead of one: every rung one-signed;
dealers short gamma at *every* price in the window (flip is outside it, below);
dealers long gamma at every price (outside it, above). New `gammaAtSpot` on
`Analysis` carries the sign - documented as sign-only, its magnitude is a
weighted sum with no unit and must never be printed. Every copy string that
described the old cumulative rule was rewritten to match, including the rail
badge tooltip, the structural-range zone tips and the Open Card note.

### Open Card: accent edges removed

Dropped the 3px left stripe from the five tiles and from the card itself. Five
coloured stripes in a row read as a status bar - five things going wrong -
rather than five neutral readings; the tile label already carries the colour.

## 2026-08-21 (t) - ΔGEX Board: Open Card - the five morning levels on one strip, with an SPX→ES offset

Edited: `owner-vite/src/pages/GexGrowth.tsx`.

The board answered "what changed overnight" well and "where are today's rails"
not at all - the call wall, the gamma flip, the cushion and the regime were four
separate tiles inside a collapsible Read panel, three scrolls apart, and nobody
assembles those at 09:25. **Open Card** is a single strip at the top of the
detail pane that prints the five numbers you write down before the bell.

**Placement is the point.** It sits ABOVE the big headline number, because that
headline is a Δ and a Δ is the morning's *second* question. Reading order on the
pane is now: which symbol → where the levels are → what moved → the evidence.

**The five tiles.** Call wall / gamma flip / put wall, each with its distance
from spot in both points and percent; cushion (signed points spot→flip, with the
prior session's for comparison); regime (word plus the net). All of it comes off
the same `analyzeLadder()` whole-ladder pass the Read panel uses, so the ±3%/±5%
band cannot move a single figure on the card - same guarantee, same reason: a
wall is a property of the book, not of the rows on screen.

**Verdict line is a MECHANISM, not a call.** `SPOT IN DAMPEN` / `SPOT IN AMPLIFY`
plus the sentence about what dealer hedging does there - reusing the exact
wording of `StructuralRange`'s zone tooltips so the two surfaces cannot drift.
This follows the rule `regimeCopy()` already sets out in its header comment: the
page says what the dealer book does, never what to trade. Zone prefers the
measured flip and falls back to the sign of the book when the cumulative never
crosses inside the window - flagged as inferred, not presented as a located line.

**SETTLED / PROVISIONAL is the first chip on the strip.** On the `oi` basis the
open-interest half is re-stamped at 09:25 ET off the settled OCC file; before
that it is still the provisional 16:05 read, settled through the session BEFORE
last night. A map built on it is a day stale and *looks right*, which is the
expensive kind of wrong. On any other basis the card carries an
`OI ONLY IS THE MORNING BASIS` chip - a provenance nudge, not a trade nudge.

**SPX→ES offset.** The strikes are SPX cash. Drawing a cash strike straight onto
an ES chart mis-places every level by the spread, silently. A signed points field
in the card header (`ES = SPX + offset`) prints each landmark's futures-adjusted
twin under the cash number in gold. Nothing here streams ES so it is entered by
hand, and it is persisted to `localStorage` - a number you retype every morning
is a number you eventually stop typing. Kept as the raw string, not parsed on
each keystroke, so a half-typed `-` or `1.` survives.

**`copy` button** emits the whole card as monospace-aligned plain text (symbol,
session, basis, freshness, the five numbers, the ES row) for a journal or a chat.

Toggled by a new **Open Card** button beside **Read** in the control row, on by
default, state persisted. Both `localStorage` helpers are try/catch-wrapped on
*access* as well as write - hardened profiles throw on `getItem`, and the card
must never be the reason the page fails to render. Without a recorded spot it
renders one honest line instead of a grid of dashes.

**Fixed while in there: the footer legend was lying.** It hardcoded
`OI+Vol basis` on every basis since the migration, putting it in direct
contradiction with the caveat strip at the top of the same card. It now reads
`BASIS_COPY[basis].name` (plus the leg when not net). With the Open Card also
printing its own provenance, a third surface asserting the wrong one was a
straight defect.

## 2026-08-21 (o) - One accordion cog for every toolbar: home GEX chart, home heatmap, ES Candles, Options Chain, Multi Greek

Edited: `components/shared/DockToolbar.tsx`,
`components/dashboard/GexToolbar.tsx`, `app/home/HomeClient.tsx`,
`components/pages/EsCandles.tsx`,
`components/dashboard/es-candles/EsChartCard.tsx`,
`components/pages/OptionsChain.tsx`, `app/mult-greek/MultGreekClient.tsx`.

Every cog on the app now opens the SAME thing: labelled sections that unfold in
place inside one column, each header carrying the answer to its own question.

**Why.** Folding a toolbar into a cog does not remove its dropdowns, it just
moves them inside a popover - and a floating panel opened from inside a floating
panel has no idea where its parent is. It lands on top of it, behind it, or half
off-screen; the parent's click-away has to be taught to ignore each child by
hand; and every layer's z-index has to be tuned against every other. We had that
bug on ES Candles four separate times. The accordion removes the whole class:
a section is not a layer, so it cannot be mispositioned, occluded or orphaned.
**One floating layer per page, and it is the cog panel.**

**`DockCogMenu` — two layouts, no breaking change.** `children` still renders
the original flat scrolling column, so any caller not listed above is untouched
(notably /home's econ **Panel** cog, which portals the calendar's filter row
into itself and depends on the mounted-while-closed contract; that contract
stays on the `children` path). Pass `sections?: DockCogSection[]` for the
accordion. New exports:

- `DockCogSection` - `{ id, label, summary?, count?, hint?, body }`.
  `summary` is what the section says while SHUT ("1m", "Front · Vol+OI",
  "2 charts", "off"); `count` renders as "3 on". Without them the only way to
  find which timeframe you are on is to open every row, which is the accordion's
  one failure mode - so every section added below carries one or the other.
- `DockField` - label-above-control field for use inside a section.
  `DockMenuRow` puts the label and the control on ONE line, which works for a
  flat column of buttons and fails immediately for a segmented picker or a
  slider in a 330px panel.

More than one row may be open at once, and which rows are open is sticky across
open/close - shut the menu to look at the chart, come back to the same place.
Only OPEN bodies are mounted. The default open row is `sections[0]`, resolved
lazily so no caller has to name an id.

**Converted, with the sections each one grew:**

| Toolbar | Sections |
|---|---|
| Home GEX chart (`GexToolbar`, compact) | Expiry · What the bars are (Series + Mode + Basis + EX-0DTE) · Overlays |
| Home heatmap (`HomeClient`) | Heat (intensity + side basis) · 5th column · Δ stamps |
| ES Candles | Page · Indicators · Overlays · Chart · Gamma · Layout · Replay (embed) |
| Options Chain | Grid (strikes + greek + basis) · Heat · Stamps · Replay |
| Multi Greek | Expiry · Board (basis + Δ stamps) · Heat · Tools |

Rows that answered one question between them were merged rather than carried
over one-for-one - GexToolbar's Series / Mode / Basis are three fields of "what
the bars are", not three sections you open in turn.

**ES Candles moves from the rail to the accordion.** Entry (u) gave it a
master-detail panel (nav rail + detail pane); this replaces the rendering with
the accordion and keeps the section data as-is, so `pageSections`,
`cogSections`, the merge order and `LayoutPresetButton inline` are all unchanged.
Panel width 560 → 360. Its local `SECTION_LABEL` const is gone, replaced by the
shared `DockField`.

## 2026-08-21 (n) - Campaign tracking: short links, self-tagging emails, outcome-ranked campaign table

New: `app/[source]/[action]/route.ts`, `lib/emails/utm.ts`,
`owner-vite/src/components/CampaignLinkBuilder.tsx`.
Edited: `middleware.ts`, `app/api/admin/send-email/route.ts`, `lib/emails/send.ts`,
`owner-vite/src/pages/Emails.tsx`, `owner-vite/src/components/AcquisitionPanel.tsx`,
`owner-vite/src/pages/ControlPanel.tsx`.

An untagged link is indistinguishable from someone typing the URL — it lands in
"Direct". Four pieces close that, and the shape of each is chosen so nobody has
to remember anything at post time.

### 1. Short links — `cbedge.net/x/click`

A tagged URL is 90 characters of query string. Fine inside an email where nobody
sees it, wrong everywhere a human reads the link: an X post, a YouTube
description, a bio. An ugly link gets shortened by someone else's service or
retyped without the tags, and either way the attribution is gone.

So the tags live server-side now. `/x/click` 302s to
`/?utm_source=x&utm_medium=social&utm_campaign=post`; the landing page's beacon
reads the query exactly as if it had been typed, and nothing downstream knows
the difference.

Standard placements: `x/click` · `x/profile` · `youtube/click` · `tiktok/click`
· `email/click` · `newsletter/click`, plus `/post`, `/video`, `/bio` aliases.
A platform is split into post-vs-profile on purpose: a post drives a spike you
can tie to what you wrote, a bio link trickles forever from people who looked
you up, and averaging them hides both.

Two optional params keep the common case bare: `?c=gex-thread` names a specific
push, `?to=/pricing` changes the destination.

**Route shape.** `app/[source]/[action]/route.ts` — a root-level dynamic pair,
which sounds alarming and isn't. Next resolves static segments first, so every
real route (`/docs/x`, `/app/m/gex`, `/api/…`) matches its own folder; and
`action` is checked against a six-verb allowlist, so a near-miss 404s exactly as
it would have anyway. `?to=` is validated as a same-site path — `//evil` and
`https://evil` both rejected, because a redirector that forwards anywhere is an
open redirect and this one is linked from public posts. 302 not 301: a permanent
redirect is cached by the browser and every proxy between, so re-pointing
`/x/click` later would never reach anyone who had clicked it once.

**Adding a placement usually needs no code.** An unknown source falls through to
`utm_medium=referral` under whatever name is typed, so `/hackernews/click` works
the day it's needed. The table exists only to give regular platforms the right
medium and a better campaign name than "link".

`middleware.ts` gained one public pattern for these. The verb suffix is what
keeps it from accidentally opening a real two-segment route — verified against
`/es-candles`, `/traders-dashboard`, `/app/m/gex`, `/api/chains`, `/owner/dev`.

### 2. Outbound email tags itself (`lib/emails/utm.ts`)

Both send paths rewrite every `<a href>` pointing at our own host to carry
`utm_source` / `utm_medium=email` / `utm_campaign`.

Five things it will not touch, each a way to break a live email: anything
containing `{{` (the unsubscribe and promo-code placeholders are swapped AFTER
this runs — a real URL parser percent-encodes the braces and would ship a dead
`%7BPROMO_CODE%7D` to the list); unsubscribe links by path, belt-and-braces with
that; anything already carrying `utm_source`; foreign hosts; and `src=`
attributes, so the logo and any pixel are untouched.

The rewrite is string surgery, not `new URL().toString()` — round-tripping
normalises case, ports and percent-encoding, and each of those is a chance to
break a signed link. Verified against bare `/`, an existing query, both
unsubscribe routes, both placeholder shapes, a foreign host, a `mailto:`, an
already-tagged URL, a `#hash`, both quote styles, and `img src`.

### 3. Campaign picker in the composer

A **Broadcast / Newsletter** toggle (that's `utm_source`, so the letter stops
being lumped in with one-off blasts) plus a campaign field with a live preview of
the query string the links will carry. Loading a template prefills the campaign
with the template id — stable across re-sends. Blank is meaningful: the server
slugs the subject, so a send is never untagged. The response echoes the final
tag back.

### 4. The campaign table reports outcomes, not clicks

`AcquisitionPanel`'s Campaigns section gained **Signups**, **Paid** and a
conversion column, sorted by paid → signups → sessions. That ranking answers
"which push earned customers" rather than "which got clicks", and the two orders
are routinely different.

The join: an arrival is anonymous by definition, so there is no user id on it to
match. The index is built over ALL fetched rows — not the selected window, since
someone can arrive Monday and register Thursday — keyed on the account where we
have one and the IP where we don't, and a signup counts only if the account's
`created_at` is at or after the click, with 60s of slack for clock skew. Owner
clicks excluded. **Attributed, not audited**, and the footnote says so: a shared
office IP can credit the wrong campaign, a phone switching networks loses the
link entirely.

### Naming convention

`utm_source` = where you posted it · `utm_medium` = the bucket (`social` /
`email` / `referral` / `cpc`) · `utm_campaign` = which push. Reuse the same push
name across platforms or one campaign becomes several rows that can't be
compared. Everything is slugged lowercase-hyphenated in four places that must
stay identical: `campaignSlug()` in `lib/emails/utm.ts`, `slug()` in the redirect
route, `slug()` in the link builder, `slugPreview()` in the composer.

## 2026-08-21 (m) - Levels off the toolbar, onto the Test Lab strip

Edited: `components/shared/GlobalToolbar.tsx`, `components/shared/sectionNav.ts`.

`/levels` (the whole scanner universe's CB / call wall / put wall on one page)
was holding a top-level toolbar slot for a bench view. It is out of
`NAV_ITEMS` and into `TESTLAB_SECTION` instead - same arrangement
`/strike-history` already has:

- `routes` gains `{ href: "/levels", short: "Levels", icon: "🧱" }`, placed in
  the `scanner` cluster next to Strike History, so it draws as a "Levels ↗"
  pill in the Test Lab sub-strip. That strip IS the Test Lab page's nav (the
  page has no header links of its own), so this is the link on the page.
- `paths` gains `/levels`, which is what makes the Test Lab strip stay on
  screen once you are on the page - otherwise it would be a one-way trip.
- The ROUTE is untouched: same `app/levels/page.tsx`, same `<Route>` in
  `app-vite/src/App.tsx`, still listed in the hamburger (`NavMenu`).
  `check-routes.mjs` only asserts that toolbar nav items HAVE routes, so
  dropping one is not something it can fail on.
- Existing users with `/levels` in their saved toolbar drag order lose it
  silently - `GexGroupNav` resolves saved hrefs against `NAV_ITEMS` and drops
  what it cannot find. Saved Test Lab sub-strip orders pick the new pill up the
  other way, via `reconcile()`.

## 2026-08-21 (l) - Pick Study is owner-only, and its tables sort on click

Edited: `components/scanner/scannerNav.ts`, `components/shared/sectionNav.ts`,
`components/shared/SectionSubStrip.tsx`, `components/pages/Scanner.tsx`,
`components/scanner/PickStudyTab.tsx`. Added:
`components/shared/useIsOwner.ts`, `components/shared/useTableSort.tsx`.

**Pick Study (Scanner -> Study) is hidden from customers.** It is the tuning
bench for the GEX Change Top ranking - thin buckets, in-sample splits and a
calibration block that reads "not armed" most of the time - so it is research in
progress rather than a customer view.

- `TabDef` / `SectionTab` gained an optional `ownerOnly` flag; `pickstudy` sets
  it. Nothing else in either nav registry changed, so the pill keeps its slot in
  a saved sub-strip order and flipping the flag back puts it exactly where it
  was.
- `SectionSubStrip` skips owner-only pills for everyone else (same `return null`
  path an unknown id already took, so the fit pass and the drag layout need no
  changes).
- `ScannerPage` refuses to render an owner-only tab as well, so a pasted
  `/scanner?tab=pickstudy` lands on GEX Levels instead. While `/api/auth/me` is
  still in flight it renders NOTHING rather than falling back - a flash of the
  wrong tab would also fire that tab's fetches.
- New `useIsOwner()` collapses the check GlobalToolbar, UserMenu and GexDock
  each spelled out inline (the `is_owner` claim OR a match against
  `NEXT_PUBLIC_OWNER_USER_ID`). This is CHROME ONLY - `/proxy/gex-change-top-study`
  and `/proxy/gex-change-top-calibration` are unchanged and still answer anyone
  who calls them directly. Gate them server-side if the data itself must not
  leak.

**Click any column title to sort.** New `useTableSort()` + `<SortTh>` in
`components/shared/useTableSort.tsx`, wired into both Pick Study tables (bucket
table and the calibration table, grade-count columns included).

- Cycle is desc -> asc -> off. The third click matters: these tables arrive in a
  meaningful order (buckets in the feature's own order, grades ranked A+ to F)
  and that has to be reachable without a reload.
- Nulls always sink to the bottom in both directions - a missing number is not a
  small one, and letting "-" win the top of a descending sort is the fastest way
  to misread one of these tables.
- Sorting is stable and never mutates the source array. `Holds` sorts as
  check > cross > blank; `Predicted` sorts by grade rank, not alphabetically, so
  "A+" cannot land between "A" and "B".
- The helper is generic and drop-in for the app's other hand-rolled tables: pass
  the same `th` style the table already uses and it keeps the look, adding the
  pointer cursor and the direction caret.

## 2026-08-21 (k) - Cog toolbars for ES Candles, Multi Greek and Options Chain

Edited: `components/dashboard/es-candles/EsChartCard.tsx`,
`app/mult-greek/MultGreekClient.tsx`, `components/pages/OptionsChain.tsx`,
`components/shared/DockToolbar.tsx`. Same treatment as /home in (i)/(j).

Every one of these bars now reads: identity on the left (stretching), then the
capture actions, then the cog hard against the right edge. Nothing was removed -
each control moved into a labelled `DockMenuRow` inside the cog.

- **ES Candles** (`EsChartCard`'s dock, shared by /es-candles, the home GEX card
  and the /board tile). Left: CANDLES + ES basis, LIVE/DELAYED, and a single
  badge that now reads `SPY · 5m · 380 candles` - the symbol and timeframe used
  to be readable only off the controls that just went into the cog. Cog: the
  page's Charts / Replay / Indicators / Layout group, Overlays, Symbol,
  Timeframe, Latest, heatmap expiry (DTE), GEX basis, per-card Replay, Refresh.
- **Multi Greek**. Left: status dot + message, the four tickers on screen, and
  the active basis / delta window / replay state. Cog: expiry + GO, contract
  basis, delta stamps, 4th ticker, intensity, Lookup, Replay, Refresh. The
  level-snapshot button stays out front with Snap and Discord - it produces an
  image, so it belongs with them.
- **Options Chain**. Left: title, ticker, `GEX · OI+Vol · 10%`, and the
  LIVE/REPLAY dot. Cog: ticker + GO + Recent, strike %, greek tabs, basis,
  intensity, Δ15m, Replay, Refresh. The TOTAL stat row below the dock was
  deliberately NOT folded in - the dock is `captureHide` and those figures belong
  in the screenshot.

**One real bug this exposed.** Controls inside a cog can open their own
popovers - the ES overlays checklist, the DTE lists, the ticker dropdowns, the
expiry picker - and every one of them portals to `<body>`. By containment those
are "outside" the cog, so the first click inside one slammed the cog shut
mid-interaction. `DockCogMenu`'s outside-click handler now walks up from the
click target and treats anything sitting in a fixed, raised-z layer as inside.
Threshold is 50: the ES Charts/Indicators panel sits at 60, the portalled
dropdowns at 9,999-100,000. Structural rather than a marker attribute because
these popovers live in four files written years apart and all share that shape.

Greys to white continued: the ES basis / GEX line, the status and candle-count
badges, the narrow-panel warning.


## 2026-08-21 (j) - Home: one toolbar, ghosts gone, cog last, greys to white

Edited: `app/home/HomeClient.tsx`, `components/dashboard/GexToolbar.tsx`,
`components/shared/DockToolbar.tsx`. Follow-up to (i).

**One bar, not two.** The NET GEX / CALL WALL / PUT WALL / FLIP / CB / MAX PAIN /
+-1σ / +GEX% / BULL-BEAR readouts had their own strip under the GEX toolbar.
They are now the toolbar's new `stats` slot (compact mode only), each card
`flex: 1 1 0` so the row fills the bar at any width. Fixed layout for every
compact bar now:

    cards (stretch) -> snapshot -> Discord (owner-only) -> cog

Cog moved from first to LAST so it sits hard against the right edge. The heatmap
header and the econ tab strip were reordered to match. Discord needed no gate -
`BoxDiscordBtn` already returns null for non-owners via `useIsOwner()`.

**Ghosts removed.** The 5/15/30m prior-state overlay row is out of the cog, the
`ghost` state and its pref are gone, and `chartBaselines` now polls with `""`
(idle) instead of on a toggle nothing can set. `GexToolbar`'s `showGhost*` /
`onToggleGhost*` props were made OPTIONAL rather than deleted, so any other
caller still passing them keeps compiling; `GexChart` already defaults them to
false.

**Cog menu flips up when it would go off-screen.** Reported: the econ calendar's
cog, with the panel minimised, opened a dropdown below the fold that could not be
reached. `DockCogMenu` now measures itself and opens UPWARD when it doesn't fit
under the trigger and there is more room above, clamping `maxHeight` to whichever
side it used. Two mechanical notes: the panel renders with `display:flex` the
moment it opens (parked at -9999 for one frame) because `display:none` reports a
zero height and the flip needs a real one; and `place()` runs twice - once
immediately, once on rAF after layout - for the same reason.

**Greys to white.** `SOFT_WHITE` (#c3ccda -> #fff) so every heatmap value is
white, the inline SPY/QQQ/ticker strike prefix (#5a7a98, plus the rank-1/2
brightening special case it needed - white is legible on every tier), the ATM
row's 0.82-alpha white, `DockMenuRow` labels (0.55 alpha), inactive card tabs and
the "add a card" picker (#5a7a98), the heatmap contract label and its loading
ellipsis (#8da8c2 / #5a7a98), the 5th-column Clear button, and the stat card
labels (0.75 alpha).


## 2026-08-21 (i) - Home page: every toolbar folds into a cog, heatmap columns rebuilt

Edited: `app/home/HomeClient.tsx`, `components/dashboard/GexToolbar.tsx`,
`components/shared/DockToolbar.tsx`.

**Toolbars.** All three bars on /home now carry nothing but a cog wheel plus the
snapshot / Discord buttons. Everything else moved inside the cog:

- GEX card (`GexToolbar`): expiry, Net GEX vs Call-Put, OI+Vol / Vol Only / Flow,
  the OI / DEX / Flip overlays, refresh - and the 5/15/30m prior-state ghosts,
  which /home has been passing handlers for since forever with no tile to reach
  them. Behind a new opt-in `compact` prop, so every OTHER host of `GexToolbar`
  keeps the wide bar it already had.
- Heatmap card: intensity, side basis, the delta-stamp window, refresh, and the
  new ticker-of-choice field. Identity moved to the left of the header instead -
  "GEX HEATMAP" + the contract - so the panel still says what it is showing.
- Econ / tabs card: panel height (min/half/full) and the calendar's own filter
  row, which arrives by portal from `EconCalendarPanel`.

New primitives in `DockToolbar.tsx`: `<DockCogMenu>`, `<DockMenuRow>`,
`<DockMenuDivider>`. Two things about the cog menu are load-bearing. It PORTALS
to `<body>` - every home card is `overflow: hidden` and the header rows sit
inside `<FitScale>` (a CSS transform), so an absolutely positioned panel would be
clipped and mis-scaled. And it keeps its children MOUNTED while closed (hidden
with `display:none`): the econ calendar portals its controls into the panel, and
unmounting the target would make it fall back to rendering its own inline header
every time the cog shut.

**Persistence.** One localStorage blob, `cbedge.home.toolbars.v1`, holds every
setting the three cogs expose: gex mode, data mode, OI/DEX/Flip, ghost window,
intensity, side basis, delta window, ticker of choice, econ panel height.
Browser-local, per the ask - not synced to the account. Restored in a mount
effect (not a lazy initialiser) so SSR and the first client render agree, and the
writer is gated on a `prefsReady` STATE flag rather than a ref: with a ref, the
hydrate effect would flip the flag and the writer - running in the same commit,
still holding pre-restore values - would immediately stomp the saved blob with
the defaults.

Ghosts collapsed from three booleans to one `ghost: 0 | 5 | 15 | 30` window. They
were already mutually exclusive; three booleans just made that fact unstorable.

**Heatmap columns.** Now: STRIKE | SPX NET GEX | SPX NET DEX | SPY NET GEX |
QQQ NET GEX | <TICKER> NET GEX. VOL ONLY GEX is out; the SPX columns are labelled
SPX so the six headers read as one set.

The 5th column is a ticker you type, exactly like the Multi Greek page's 4th
ticker - committed on Enter or blur, remembered per browser, default IWM, blank
switches the column off and stops the extra poll. It rides the SAME
`useDualTickerGex` call as SPY/QQQ (that hook always took an arbitrary list), so
it costs one more chain fetch and no new machinery, joins to the SPX rows by
moneyness offset rather than strike for the same reason SPY/QQQ do, and gets its
own colour scale and its own peak box.


## 2026-08-21 (h) - Post-market recap: section 7 STRIKE PATHS removed

Edited: `components/pages/premarket/PostMarketTab.tsx`.

Section 7 is gone. It never worked visually and no restyle fixed it: 25 rows,
each ~2.5h of session wide and ~22px tall, every line normalised to its own peak.
A strike that doubled and one that flatlined drew the same shape, so the panel
was 25 near-identical squiggles that answered nothing you could not get from
section 3.

Four re-designs were mocked before pulling it (all four in `generated/`:
`2026-08-21-strike-paths-4-ideas.*`, `2026-08-21-strike-paths-move-visible.*`,
`2026-08-21-strike-paths-scrolling-window.*` - direction-coded lines, a growth
heat ladder, momentum sort, indexed-to-open, two-column, step chart, event-time
axis, and a scrollable 60-minute window with a pinned strike column). Keeping
them for reference; none earned the vertical space.

Removed:

- the whole section 7 JSX block (header, `.pathlist`, the per-row SVG, the
  `.heatx` time strip under it)
- the `strikePaths` memo and its doc comment
- CSS `.pathlist`, `.prow`, `.pk`, `.pv`, `.pt` and the `.prow svg` rule

`evNear` stays - `writtenVsTraded` still reads it. The `histState === "error"`
note now points at the wall path instead of a section that no longer exists.
File is down to 1,775 lines.


## 2026-08-21 (g) - Section 3 was lying about bar length, and the AM bucket could not exist

Edited: `components/pages/premarket/PostMarketTab.tsx`. Three real bugs, all
reported off one screenshot where every far strike drew a full-length hatch.

**1. THE SCALE WAS COMPUTED OVER THE WRONG SET OF ROWS.** `maxAbsBar` was
`max |net|` over `evNear` (the +/-12 strike window) while the panel renders
`evBars` (+/-60). Any rendered strike whose gamma beat the near-window max
therefore drew past 100% of its track, and its peak ghost was explicitly
`Math.min(46, ...)` - so the hatch **clamped to exactly the same length on every
one of them**. The chart was clipping to a common ceiling and saying nothing
about it, which reads as "all these strikes peaked at the same number". They did
not.

Now: `maxAbsBar = max(|net|, |peak|)` across the **rendered** rows. Nothing
clamps, so two bars of the same length finally mean the same number. Cost: a
little resolution near the money when one far strike is enormous. Worth it.

**2. ALL BARS NOW GROW RIGHT.** The old layout mirrored negative strikes
leftwards off a centre axis, so length read in two directions and the halves
could not be compared. Sign moved into two new columns: a `+`/`-` chip
(`.sgn`, green/red) and the signed dollar value (`.netcol`). Grid is now
`54px 13px 60px 1fr 124px 76px` - strike, sign, net $, track, built-by, tag.
Negative rows also get a faintly warm track (`.track.neg`).
Added `.pmk .evrow .track` to override the premarket profile's centre-axis
`.track` gradient (higher specificity, wins regardless of sheet order) - that
gradient paints a zero line down the middle, which is meaningless once every bar
starts at the left edge.

**3. "I DON'T SEE ANY BLUE" WAS A DATA BUG, NOT A COLOUR BUG.** The buckets were
hard-wired to `[0, idxAtMin(12:00), idxAtMin(15:00), end]`, and `idxAtMin` snaps
to the NEAREST column. On a day the ladder recorder starts after noon - which
happens whenever that job restarts intraday - `idxAtMin(12:00)` returns index
**0**, so the AM move is `|vals[0] - vals[0]| = 0` for every strike and the blue
segment cannot exist. The chart looked like a session with no morning activity;
it was a session with no morning *recording*.

Now `evCover` reads the recording's real first/last ET minute, `activeBuckets`
keeps only buckets the recording covers by 5+ minutes, and `evRows` builds its
cuts from that list. The legend renders only active buckets (with their real
clock ranges), and a `warnbar` names the coverage window and which buckets were
dropped. New helper `etMinOfDay()`.


## 2026-08-21 (f) - Post-market recap: "Where premium actually went" replaces the replay scrubber

Edited: `components/pages/premarket/PostMarketTab.tsx`.

Section 6's third column was **Replay the day** - a range slider over `cols` that
re-derived net GEX / flip / CORE at the scrubbed minute. Every one of those
numbers is already printed elsewhere on the page, and the ES chart's bubble trail
rides the same frames, so the slider was a toy. Removed.

**In its place: WHERE PREMIUM ACTUALLY WENT.** The five contracts that took the
most DOLLARS today.

- `premium = today's volume x the contract's mark x 100`, per LEG, from
  `chain[].callVolume/callMark` and `putVolume/putMark`.
- **Volume, not OI** - OI is yesterday's positioning; the question this panel
  answers is what got paid for today. Stated on the panel so it can't be
  misread as a positioning number.
- Calls and puts rank separately and against each other, so one strike can
  appear twice (7,700C and 7,700P are two different trades).
- Shared bar scale, top row = 100%: the panel exists to say which contract took
  the most money, so every bar is read against the biggest.
- Header prints the whole chain's premium total (`$4.1B traded`).
- No marks on the frame -> a `warnbar` saying so, not a confident `$0`.

**Colour: calls GREEN (`--cw`), puts RED (`--pw`)** - deliberately NOT the
red-calls/green-puts of the mock. `--cw`/`--pw` are the page's call-wall /
put-wall colours; a call leg painted red here while the call wall is green two
sections up is the kind of inconsistency the theme rules exist to prevent. Flip
the two `var(--cw)`/`var(--pw)` refs in the `premiumRows` map if the mock's
convention is wanted instead.

New CSS `.premlist` / `.premrow` (`52px 1fr 54px` - label, track, dollars).
Removed dead CSS `.replay`, `.readout`, and the `rIdx` / `replayIdx` / `replay`
state and memo. Section comment is now `6. JOURNAL - ACCURACY - PREMIUM`, and
the `histState === "error"` note no longer points at a replay that no longer
exists.


## 2026-08-21 (e) - Post-market recap: full move log, strike paths as a stacked ladder

Edited: `components/pages/premarket/PostMarketTab.tsx`.

**1. "Every time a level moved today" now scrolls the whole day.** It was
`.slice(-8)` - the last eight moves, with no indication that anything had been
dropped. On a day with twenty wall changes that silently deleted the entire
morning, which is the half that explains where the day's walls came from. The
list now renders EVERY `reason === "change"` row in clock order inside a
`.mvscroll` container capped at ~9 rows (`max-height:212px`, `overflow-y:auto`,
`overscroll-behavior:contain`, thin themed scrollbar), and the header prints the
count (`... 14 moves`) so the length is visible before you scroll.

**2. Section 7 STRIKE PATHS is now one row per strike, lines only.** It was an
`auto-fill minmax(118px,1fr)` card grid, so 25 strikes wrapped across two or
three page rows - 7,685 and 7,630 ended up on different lines and the shapes
could not be compared by eye, which is the only thing that section is for.

- New `.pathlist` / `.prow` layout: `56px 1fr 94px 76px` - strike, line, net,
  tag - stacked in strike order, so the ladder reads top-to-bottom like every
  other price axis on the page and no two strikes overlap.
- **No bars, no area fill.** The `<polygon>` under each sparkline is gone; each
  row is a single `<polyline>` plus a faint baseline. Magnitude belongs to
  section 3 - each line here is still scaled to its OWN peak, and a filled shape
  reads as magnitude, which across rows is meaningless.
- One shared time axis: the SVG viewBox is a fixed `1000 x 22` stretched to the
  row width, so x is the session clock (09:30 at the left edge, close at the
  right) on every row and a 13:16 kink lines up straight down the stack. A
  `.heatx` strip under the list prints first / mid / last stamp from `cols`.
- Key strikes (call wall, put wall, flip, core) keep their tag colour and now
  also bold the strike label (`.prow.key .pk`).
- Dead CSS removed: `.sparkgrid`, `.spark`, `.sh`, `.sk`, `.sv`, `.st`.

Header subtitle updated to `N strikes around spot - 09:30 -> close - each line
scaled to its own day`.


## 2026-08-21 (d) - Level Log: wall migration chart, every ticker

Edited: `components/pages/LevelLog.tsx`.

The post-market recap's WALL MIGRATION chart (`components/pages/premarket/
PostMarketTab.tsx` -> `WallChart`) now also renders on **/level-log**, inside the
log card between the capture rail and the timeline - so it exists for **every
ticker on the rail**, not just SPX.

**Why it could not be lifted as-is.** The premarket version has no recorded
level series to read: it reconstructs the walls out of the per-minute strike
ladder (`/api/snapshots/option-strike-gex-history`) and labels itself a
"net-basis proxy" - and that ladder is SPX-only, which is exactly why the chart
never travelled.

**What this one reads instead.** `/proxy/walls?date&symbol` - the levels the
walls recorder already stores per symbol. So the lines are the log's own
`call_wall` / `put_wall` / `cb` strikes. No proxy, no second fetch: it reuses the
`log` / `events` the page had already loaded.

Two honest consequences, stated on the panel:

- `walls_log` is CHANGE-ONLY, so each level is forward-filled from its last
  written row and drawn as a **step**, never a slope. A diagonal between two
  captures would draw the level at prices it never occupied.
- Spot exists only on slots that wrote a row, plus touch/approach events. The
  price line is those captures joined up, with a tick at each one, and the
  caption prints the sample count rather than implying a tick path.

**Details.**

- Scoped by the WALLS / CORE switch like everything else on the page - it reads
  the same view-filtered rows as the rail, the timeline, the copy text and the
  PNG, so the export can never disagree with the screen.
- x is `railPct(slot)`, the same axis the capture rail uses, so a mark on the
  rail sits directly over its step in the chart. Same hour ticks, same 09:29 ->
  16:00 gutters.
- WALLS view fills the corridor between the two walls; CORE view draws the one
  line. Colors come from the page's existing `LEVEL_COLOR` map.
- Placed ABOVE the scrolling timeline on purpose: framed snapshot mode expands
  the scroll body without reflowing its siblings, so anything below it gets
  drawn over in the PNG (the same reason the reaction legend is
  `data-capture-hide`).
- `preserveAspectRatio="none"` with `vectorEffect="non-scaling-stroke"` on every
  stroke; no `<text>` or `<circle>` inside the SVG (they would come out
  stretched) - bounds, legend and time labels are HTML on top.
- Renders nothing at all when the day has no rows for the levels in view. No
  empty frame, no synthetic values.

## 2026-08-21 (c) - Multi Greek SPX spot: use the prior-close differential, not a basis

Edited: `app/mult-greek/MultGreekClient.tsx`.

The (b) build read 7625.44 with SPX's actual close at 7641.16 and ES sitting on
its own settle at 7662.50 - i.e. ES had not moved overnight, so SPX must not
have either. Subtracting a basis was the wrong shape of answer.

**The invariant, now enforced directly:**

    ES unchanged overnight  =>  SPX unchanged overnight
    SPX = spxPrevClose + (esFut - esFutPrevClose)

That cancels the basis instead of trusting one. With ES at 7662.50 the header
reads 7641.16 to the penny.

**Why the basis forms were all suspect off-hours:**

- The ws `basis` frame is CIRCULAR after the close. `marketState.spot` is set to
  `_effectiveSpot()` (= `esFut + cashBasis` out of hours), so
  `basis = esFut - spot` collapses to `-cashBasis` - a number last measured
  during RTH that carries no information about where ES is now. It was the FIRST
  rung; it is now the LAST.
- `/proxy/es-spx-basis` is a genuine simultaneous pair (our 16:00 `es_candles`
  close vs the Yahoo `^GSPC` close), so it stays as the backup - and doubles as
  the sanity check on the differential.

**New ladder** (`cash` -> `prev-close` -> `anchor-basis` -> `ws-basis` ->
`spotDisplay` -> `spot-raw`). Cash hours still short-circuit: the feed's SPX
print IS the index, no conversion.

**Mismatched-session guard.** The prior-close pair is refused unless the basis
it implies (`esPrevClose - spxPrevClose`) is plausible AND within
`MG_PAIR_ANCHOR_TOL` (25 pts) of the daily anchor. A `prevClose` that is a
session behind its partner would otherwise bake a whole day's move into every
price silently. The rejection reason is recorded, not swallowed.

**Debug payload extended** - `window.__mgSpx` / `?spxdebug=1` now also carry
`esChange` (ES off its own settle - 0 means the header must equal
`spxPrevClose`), `esPrevClose`, `spxPrevClose`, `pairBasis` and `pairRejected`.

### Still open

`_effectiveSpot()` -> `esFut + cashBasis` is the same suspect arithmetic, and it
centres the strike window, the walls and the flip for the WHOLE app off-hours -
plus, since (b), the live chain's `underlyingPrice`. If `cashBasis` is the ~37
the header implied rather than the 21.34 the closes imply, every overnight level
is off by that difference. Not touched here; server-side change, needs a
deliberate call.

## 2026-08-21 (b) - Multi Greek SPX spot: basis-tier instrumentation + chain underlyingPrice fix

Edited: `app/mult-greek/MultGreekClient.tsx`, `server-v2/proxy-tastytrade.js`.

Follow-up to the ES-derived SPX spot. Two things: you can now see WHICH rung of
the basis ladder produced the number, and the live chain stops reporting a spot
that disagrees with the strikes it just shipped.

### Why the header read ~20 pts under the ATM row

`marketState.spot` has been the CORRECTED spot for a while - `proxy-tastytrade.js`
calls `marketState.setSpot(this._effectiveSpot())`, which off-hours is
`esFut + cashBasis`. But `serveChainFromLive()` returned `underlyingPrice:
this.spot`, the RAW frozen last-RTH broker print. So overnight the chain's own
`underlyingPrice` sat at the 16:00 close while the strike window it built
(`_activeContracts` -> `_effectiveSpot`) had already moved to the ES-derived
level. The page header was reading the frozen one; the ladder was drawn around
the moving one.

- **`serveChainFromLive()` now reports `_effectiveSpot()`** as `underlyingPrice`
  (`proxy-tastytrade.js`, end of the method). Identical during RTH - the two
  values are the same expression there - so only off-hours behaviour changes,
  and it changes to agree with `marketState.spot`, the GEX math and the walls.

### Basis-tier instrumentation (client)

- `useSpxFromEs` now records which tier fired on every publish: `cash` (cash
  open, no conversion) | `ws-basis` | `anchor-basis` | `spotDisplay` |
  `spot-raw`, plus the inputs (`es`, `spot`, `basisUsed`, `wsBasis`,
  `anchorBasis`, `spotDisplay`, `cashOpen`).
- **`window.__mgSpx`** always holds the last decision - no flag needed, costs
  nothing. Read it in the console when a price looks wrong.
- **`?spxdebug=1`** on the URL (or `localStorage.mg_spx_debug = "1"`) console
  logs `[MG SPX] <tier> <price> {...}` whenever the tier or the price changes.

### Not this - the empty 1DTE column

Separate, pre-existing, unrelated to any of the above. At 16:15 ET the feed
auto-rolls `this.expiry` to the next session, so the NEXT-day expiry becomes the
only one served by `serveChainFromLive` (+-8% window, every leg must have live
data) while today's and the later ones fall through to REST and get the full
untouched ladder. Immediately after the roll `chartReady` is false and
`this.contracts` is not refreshed until the 18:00 ET session roll, so that book
is only partially in the live map -> a thin band instead of a column. Confirm
with `context: 'live' | 'rest'` in the `/api/chains` body per expiry, and check
the log for `[CHAIN-MD] batch failed` / `[OI] batch failed` (a dropped TT batch
produces the same shape: contiguous strikes with oi/vol/gamma = 0).

## 2026-08-21 - GEX Change Top: pick cards get a letter grade

Edited: `components/scanner/GexChangeTop.tsx`.

The hourly Top-5 cards said how big the GEX move was, never how the pick then
did. The scorecard below them carried peak / low / close, but you had to read
three percentages per row to judge one pick, and its headline stat (avg peak)
actively hid the failure mode: one +300% runner pays for four picks that went
straight to red and never printed green.

### Changes

- **New grade engine** (`gradePoints` / `gradeFor`, client-side, off the
  scorecard row that was already loaded). 100 points:
  peak **0-55** (best gain offered, `max_pct`), pain **0-25** (worst drawdown,
  `min_pct`), close **0-20** (`close_pct`). Bands:
  A+ >= 85, A >= 72, B >= 58, C >= 44, D >= 28, F < 28.
- **Never-green is a hard F.** `max_pct <= 0` grades F regardless of points, so
  shallow drawdown and a flat close can't launder a pick that never offered an
  exit up into a D.
- **`GradePill`** badge, sourcing its colors from `homeTheme` via `tint()` (no
  hardcoded hex). It renders on the card front beside the headline delta, on the
  flipped face beside the live P&L, and as a new first column in the scorecard
  table. Hover gives the band meaning plus the row's own peak/low/close. While
  the session is live the pill carries a "&middot;" and says provisional in the
  tooltip - peak and close can still move until the recorder freezes EOD.
- **Grade distribution strip** under the Scorecard header: A+/A/B/C/D/F counts,
  average points out of 100, and the number this was really for -
  **never green N (N%)**.
- **Fixed:** the scorecard table filtered on its own hardcoded
  `r.entry > 0.5` while the header counts used `filteredResults`, so the
  "score <= $0.50 too" toggle changed the summary line and not the rows under
  it. Table now maps `filteredResults`.

No server change - `/proxy/gex-change-top-results` already returns entry, max,
min and close. Grading is derived, so re-grading is a front-end edit.


## 2026-08-21 - Strike Growth recorder: 1-minute sweeps for the whole roster

Edited: `server-v2/strike-growth-recorder.js`.

`/replay` draws its frames from `strike_growth`, one frame per snapshot `ts`.
The full roster was swept every 5 minutes and only the MAIN "hot" list every 2,
so a single name like COIN replayed at ~53-78 frames a session while SPX had
~195. Same page, same chart, half the resolution, purely because of which lane
the ticker sat in.

### Changes

- `SWEEP_MINS` **5 -> 1**. Every scanner ticker now gets a frame per minute
  during RTH, so /replay resolution no longer depends on hot-lane membership.
- `TICKER_DELAY_MS` **600 -> 250**. Not cosmetic. The sweep is sequential and
  sleeps between tickers, so the pacing alone was 169 x 600ms = ~101s — longer
  than the 1-minute interval it now has to fit inside. The `_fullSweeping`
  guard would have skipped every other fire and the "1-minute" cadence would
  silently have been ~2 minutes. 250ms puts pacing at ~42s with headroom for
  the writes.
- Hot lane **suppressed when `HOT_MINS >= SWEEP_MINS`** (new `hotLaneActive`
  guard in `tick()`). At `SWEEP_MINS=1` the full sweep already covers MAIN every
  minute; leaving the 2-minute lane on would write those names twice per even
  minute at two `ts` values seconds apart, and `/proxy/strike-growth/frames`
  groups by `ts` — /replay would have shown a duplicate stutter-frame every
  other minute. Guarded rather than deleted, so `STRIKE_GROWTH_SWEEP_MINS=5` is
  a one-variable rollback that restores the fast lane untouched.
- Startup log now prints the pacing and says explicitly when the hot lane is
  off, instead of advertising a lane that never fires.

### Cost

~5x the row volume on `strike_growth`: ~395k/day -> ~2.0M/day, ~10M resident at
the nightly retention window. That table is already on the retention sweep in
`state/retention-cleanup.js`. If disk gets tight, cut `STRIKE_GROWTH_SWEEP_MINS`
back first — every value here is env-overridable and needs no redeploy.

### Unchanged

Per-frame coverage is the same: top `TOP_N_EACH_SIDE` (5) strikes each side by
combined net GEX, across `EXPIRIES_PER_TICKER` (3) front expiries, RTH only.
Retention, the read routes and the /replay UI were not touched.

## 2026-08-21 - ES Candles bubbles: the close and the overnight book no longer set the size scale

Edited: `components/dashboard/es-candles/slotStore.ts`,
`components/dashboard/es-candles/EsChartCard.tsx`.

The last hour — and the pre-open trail — drew at maximum size and faded
everything else on the chart to nothing. Two causes, both in the size
REFERENCE rather than in the size law:

* **The reference is a running maximum**, so any bucket that sets a new max
  draws at ratio 1 (the cap) by construction. Into the bell gamma climbs faster
  than the six-session median profile `gexTodScale` divides out, so minute after
  minute set a new detrended max and each one printed at full size — an hour of
  identical maximum marks carrying no information. That inflated max then fed
  `BUBBLE_REF_FLOOR_FRAC`, which applies to the WHOLE session, so the floor under
  the divisor rose and the morning faded out from under it.
* **Out of cash hours the clock lies.** `gexTodScale` is a 09:30–16:00 profile,
  and the history writer has no market-hours gate — it republishes the last cash
  book once a minute, frozen. An 03:00 row is a 16:00 book wearing an 03:00
  stamp, and scaling a closing-auction number by the 0.72 open anchor inflated it
  ~4.7x, which made the overnight trail the biggest thing on the chart and
  dragged the reference up with it.

Fixes:

* **Reference window** (`BUBBLE_REF_START_MIN` 09:30 / `BUBBLE_REF_CUTOFF_MIN`
  15:30). Only cash-session buckets before the closing auction may RAISE the
  reference — both the expanding running max and the session floor. Everything
  still draws. Falls back to the whole buffer when nothing is in the window yet
  (overnight chart, replay cursor parked before 09:30), since the draw is gated
  on `sessRef > 0`.
* **Out-of-hours buckets are judged on the CLOSE scale**, not the open scale —
  the book they actually are.

This is the old `BUBBLE_SCALE_CUTOFF_MIN` back, but without the cliff's mistake:
the cliff stopped MEASURING the last half hour, so every late wall clamped to one
size. The detrend is still in force — a 15:50 column is judged against
`reference x 3.10` and only clamps if it really is running ~3x above the day's
detrended peak. The window governs the divisor, not the encoding.


## 2026-08-20 (b) - GEX levels ladder: level rows no longer painted, just tagged

Edited: `components/pages/Analytics.tsx` (`TlLadder`).

The CB / CW / PW rows carried a tinted 1px border and a left-to-right colour
wash on top of their tag. Three of the ladder's rungs were painted regardless of
whether their gamma was worth the attention, and a strike that is two levels at
once could only wear one of the colours — so the wash was a lossy copy of the
tags sitting right beside it. Removed both: a level is now said once, by its
named tag next to the strike.

The spot row keeps its cyan border and wash — "where price is" is the one thing
on this ladder that must never be ambiguous. `tlHexA()` went with the wash; it
existed only to take LEVEL_COLORS down to 10% alpha for that gradient.


## 2026-08-20 - Watch This tracked results: scored from ENTRY to HIGH, not from this morning

Edited: `server-v2/far-cb-recorder.js`, `server-v2/server-with-proxy.js`
(`/proxy/far-cb-outcomes`), `components/pages/Scanner.tsx` (`WatchThisScanner`).

The tracked-results table reported the flagged contract's live NBBO mid and its
move off TODAY'S open. Both measure this morning, not the flag. A contract that
tripled since it was flagged and is now a little off its intraday high printed
red, and every number reset overnight — the one thing the column could not tell
you was whether the flag was any good.

It now reads from the flag date forward, off our own `far_cb_contract_daily`
series:

* **Entry** — the first price recorded on or after `first_flagged` (the session
  `open` where there is one, else that day's close). Carries the C/P letter.
* **High** — the highest `high` on or after `first_flagged`, with the live mid
  folded in so a contract printing its best right now shows it rather than a
  high from fifteen minutes ago (the probe only samples every `PROBE_MINS`).
* **Max %** — the move between the two.

Bars BEFORE the flag date are excluded on purpose: the backfill pulls a
contract's whole life, and a high printed a week before anyone was told about it
was never on offer. New `computeEntryHighs()` does it in one grouped query
joined to `far_cb_outcomes`; `enrichOutcomesWithQuotes()` now runs the quote
fetch and the series lookup independently, so a Theta outage empties one column
instead of all three. `opt_price` is still on the payload for the row popup —
the table just no longer shows it.

Client: `opt_open` / `opt_pct_open` replaced by `opt_entry` / `opt_entry_date` /
`opt_high` / `opt_pct_high`, three sortable columns in place of two, colSpan
11→12, and the caption rewritten to say what the columns now mean.


## 2026-08-20 (o) - No accent stripes on any card, anywhere

Edited: `components/pages/premarket/PostMarketTab.tsx`,
`components/pages/premarket/TickerBoard.tsx`,
`components/mobile/pages/MobilePrep.tsx`.

Every coloured card edge is gone — scorecard cards, positioning and tomorrow
tiles, the strike-path sparkline cards, and the phone's level-grade rows. Left
and top both.

A card's meaning lives in its label colour and its pill; a page of striped cards
reads as a page of warnings. The stripe went through three shapes (a ::before
painted by tone classes, an absolutely-positioned child, an inline border) before
the answer turned out to be none of them, and the CSS now says so where the next
person would otherwise add a fourth.

## 2026-08-20 (n) - Premarket crashed on a BACKTICK IN A CSS COMMENT

Edited: `components/pages/premarket/PostMarketTab.tsx`.

    Uncaught TypeError: Cannot read properties of undefined (reading 'right')

`POSTMARKET_CSS` is a template literal. The comment added with the left-aligned
section legends mentioned a selector in prose and wrapped it in backticks — which
ENDED the string. Everything after it parsed as code: the string literal followed
by a property access, so the bundle evaluated something like
`"...css...".sechead.right` and threw on first render, taking the whole
/premarket route down.

Premarket.tsx's own CSS block has carried a warning about exactly this since the
last time it shipped ("no backticks anywhere in this string"). POSTMARKET_CSS now
carries the same warning, naming this crash.

### And a type-check harness, because esbuild cannot see this class of bug

A bundler resolves the syntax and moves on; the error only appears at runtime.
The four files were checked with `tsc --strict` against small stubs for the `@/`
imports — that is what found it (TS2339: Property 'sechead' does not exist on
type '"\n.pmk .tabs{...}"'), and it now also confirms the CORE rename, the wall
colour tokens and the two-role wall chart are type-clean end to end.

## 2026-08-20 (m) - Wall migration: two ROLES, not three levels

Edited: `components/pages/premarket/PostMarketTab.tsx`.

Three lines (call wall, put wall, CORE) always drew CORE on top of one of the
other two — because CORE IS one of them, whichever is carrying more gamma. The
chart spent a colour and a legend entry saying the same thing twice, and the
reader had to work out which wall was hiding under the violet.

Now two series, defined as ROLES rather than levels:

- **CORE** — the heavier of the two walls at that minute (violet, thicker).
- **the other wall** — the lighter one (dim white).

When they swap, the lines swap, which is the event actually worth seeing: the
day's dominant level changing sides. The caption states how much of the session
the call side held CORE. Spot stays as the price reference.

The roles are what get smoothed, not the walls — mode-filtering call and put
separately and THEN comparing would let a smoothed strike fight an unsmoothed
magnitude and flicker the roles straight back.

### Section legends are left-aligned

`.sechead` is `justify-content: flex-start`, so a section's legend sits beside
the title it belongs to instead of being flung to the far right of a 1560px
header, where five build-time swatches read as unrelated chrome. A trailing meta
line opts back out to the right edge with `.right`.

## 2026-08-20 (l) - Post-Market §7: strike paths

Edited: `components/pages/premarket/PostMarketTab.tsx`.

A new bottom section: one sparkline per strike around spot — that strike's gamma,
minute by minute, off the ladder the tab already fetches. Treatment A from the
options mockup, on its own, because it answers a different question from the
profile above it: the profile ranks strikes AGAINST EACH OTHER, this ranks each
strike against ITS OWN day.

Each line is scaled to its own peak, on purpose. A shared scale flattens every
strike outside the biggest two or three into a straight line at zero — which is
exactly the set whose SHAPE is worth seeing: a strike that built at 10:00 and was
gone by noon would read identically to one that never traded. Magnitude is not
lost; it is printed beside the line and the profile above is the ranked view.

Cards carry the level's colour on the left edge and its tag underneath, so CALL
WALL / PUT WALL / CORE / MAX PAIN are findable in the grid at a glance. The grid
is `auto-fill`, so it uses whatever width the page has instead of a fixed column
count that gutters at 1440 and clips at 1100.

## 2026-08-20 (k) - Call wall GREEN, put wall RED, everywhere; SPY/QQQ profile opens at spot

Edited: `components/pages/Premarket.tsx`, `components/pages/premarket/PostMarketTab.tsx`,
`components/pages/premarket/TickerBoard.tsx`, `components/mobile/pages/MobilePrep.tsx`.

### The walls get their own two colours

`--cw` and `--pw` are new tokens on `.pmk`, deliberately separate from
`--pos` / `--neg`. Those two mean "positive or negative GAMMA" and belong to the
bars and the heat ramp; the walls are LEVELS. Until now they shared tokens, which
meant flipping the wall convention would have re-coloured every bar on the page.

Call wall now reads green and put wall red on every ticker and every surface —
rails, level cards, profile tags, range bar, wall-migration lines and legend,
tomorrow's map, the level-move log, and the phone board (`CW_COLOR` / `PW_COLOR`,
the same split in the mobile palette). One place to change it: those two tokens.

The phone Prep page also drops the shared `LevelsBar`: it showed the same four
numbers as the ladder directly under it, and it paints the walls on the CHART's
blue/red pole ramp — which would have put two different wall colours on one
screen.

### Level-grade accents

The accent had become an inline `borderLeftColor` on a card whose border is 1px,
so it was a hairline nobody could see. It is now the full `borderLeft`
shorthand — 4px, from the level's own colour — so the width cannot depend on the
CSS block having reached the page, which is what left the SPY/QQQ grade cards
bare.

### SPY / QQQ profile

Opens centred on spot with the same pin / un-pin-on-scroll / "back to spot"
behaviour as the SPX profile, instead of at +60 strikes where every bar is a
sliver.

## 2026-08-20 (j) - "Core Bullseye" is CORE everywhere

Edited: `components/pages/Premarket.tsx`, `components/pages/premarket/PostMarketTab.tsx`,
`components/pages/premarket/TickerBoard.tsx`, `components/mobile/pages/MobilePrep.tsx`.

Every user-facing "Core Bullseye" / "BULLSEYE" / bare "CB" now reads **CORE** —
the rail cap, the level card, the profile tag, the verdict sentence, tomorrow's
map, the phone ladder and the accuracy tile. The rail's second line is "max γ
strike" rather than a second name for the same thing. The scorecard's level key
went from "CB" to "CORE" with it, so the code and the label match.

Kept as-is: the `cb` field on the walls-recorder payload (that is the server's
name for it, and /level-log reads the same rows) and the `coreBullseye` variable
in Premarket. Comments say "CORE (CB)" once where the abbreviation still helps.

## 2026-08-20 (i) - Post-Market: wall path de-flickered, §3 opens at spot, tiles get accents

Edited: `components/pages/premarket/PostMarketTab.tsx`.

### The violet picket fence in Wall Migration

CORE is "the biggest |net| strike". On a minute where the largest positive and
the largest negative strike are within a few percent of each other it ALTERNATES
between them — two strikes sixty points apart, flipping every sample — and a line
through that is a picket fence of vertical jumps. The walls flicker the same way
at the edges of the ladder.

Two fixes:

- **Rolling MODE, five samples.** A level is a discrete strike, so the honest
  smoother is the most common value in a short window, never an average —
  averaging invents strikes that were never the wall. Ties break toward the raw
  pick so a genuine roll is not held back.
- **Step lines, not slopes.** A wall holds one strike and then jumps. A straight
  interpolation draws a diagonal through prices the level never occupied, which
  is exactly the reading this panel exists for. Spot stays a real line — it is
  the one continuous series.

And the panel now carries **its own legend** (call wall / CORE / put wall / spot).
The section legend above it is the build-time ramp and says nothing about those
four series, which is how a violet line reads as an unexplained squiggle.

### Section 3

- Opens **centred on spot** instead of at +60 strikes, with the same pin /
  un-pin-on-scroll / "back to spot" behaviour as the premarket profile.
- The ladder is 520px and sets its row's height, so the panel fills its space.
- A strike carrying under 2% of the biggest bar drops its label: "−100% 09:32"
  on a line that never held anything is false precision.

### Accents

`.tile` (positioning, tomorrow's map) now carries the same left accent the
scorecard cards do, coloured by what the tile says — sign for DEX and the roll,
amber for the flip, violet for the call/put split. A card with a bare edge reads
as a different kind of thing, and they are all the same kind of thing.

## 2026-08-20 (h) - Post-Market §3 rebuilt: build-time bars, peak marks, wall path, written-vs-traded

Edited: `components/pages/premarket/PostMarketTab.tsx`, `components/pages/Premarket.tsx`.

"09:30 vs now" is a dead question on 0DTE. The open book is ~2% of the close, so
every strike reads "+100% added" and the delta chart is a copy of the profile
sitting next to the profile. The section now asks a question the session can
answer: HOW was the book built, and is it still there.

### The profile row carries three facts

- **Build-time bar** — the same bar, segmented by WHEN its gamma arrived:
  blue 09:30–12:00, violet 12:00–15:00, amber 15:00–close, laid from the centre
  outwards in time order. The profile keeps its shape and the colour composition
  IS the change. Shares are normalised over the ABSOLUTE moves, so a strike that
  built and gave some back reads as its two moves rather than >100%.
- **High-water mark** — a tick at the strike's intraday peak, with the gamma it
  gave back hatched between mark and bar. At its peak = live level; well short of
  its own mark = abandoned, do not carry it into tomorrow.
- **The label** — "62% AM · at peak" / "71% PM · −34% 13:10".

### Three new panels

- **Wall migration** (`WallChart`) — call wall / CORE / put wall / spot over the
  session on one price axis. A level that sits while price travels is the one to
  fade; one that moves with price is dealers chasing. These are NET-basis proxies
  off the recorded ladder (the recorder stores net per strike only) and the panel
  says so — /proxy/walls in section 2 is the classified truth.
- **Written vs traded** — gamma added per strike against minutes spent at that
  strike, growing away from a centred label. Peaks that line up are a pin; peaks
  that separate mean the level was pulling.
- **Positioned vs written** (section 4) — the share of each strike's gamma that
  came from settled OI rather than today's volume. Aggregate says "mostly volume"
  and is useless; per strike it separates levels set up before the bell from ones
  written from nothing after lunch. It reads the LIVE CHAIN only, so it is the one
  panel here that still works on a day the recorder missed.

The open-vs-now overlay, its scale guard and the Δ heatmap are gone with the
question they answered. `PostMarketTab` now takes the raw `chain` prop for the
OI/volume split.

## 2026-08-20 (g) - Premarket: SPY and QQQ boards

Added: `components/pages/premarket/TickerBoard.tsx`.
Edited: `components/pages/premarket/postMarketData.ts`, `components/pages/Premarket.tsx`.

A SPX / SPY / QQQ switch sits next to the page title and is remembered for the
session. SPX is unchanged. The other two render `TickerBoard`, in the same `.pmk`
theme, with the same PRE / POST split.

### Why SPY and QQQ cannot just be a prop on the SPX page

`lib/gexSocket` carries ONE symbol and `useMobileGex` pins it to SPX's front
expiry, so these two cannot ride the live feed — and half the SPX panels exist
only because SPX has ES futures behind it and a recorder writing its ladder every
minute (ES basis, overnight range, the gap, open-vs-now, replay). A ticker prop
would have produced a page where a third of the cards said "—" forever.

What SPY and QQQ DO have, and what the board therefore carries:

| Source | Panel |
|---|---|
| `/api/expirations` + `/api/chains` (the path `useDualTickerGex` already uses) | regime, level rail, five level cards, scrolling GEX profile, expected range, playbook |
| `/proxy/walls?symbol=SPY\|QQQ` | the SAME saved, server-classified post-market grade SPX gets — both are quick tickers on /level-log |
| the next expiry's chain | tomorrow's structure |

`parseTickerBoard` computes walls / flip / CORE / max pain / EM off the raw legs
at gamma x (OI + volume) x S^2 x 0.01 x 100 — 0.01 x 100 = 1, so it lands on
exactly the same number as `netGEXOf` and the three boards are directly
comparable. Strike labels drop to 0dp because SPY/QQQ ladders are $1 wide.

It is a 60-second poll, not a tape, and the board says so — plus one line naming
the SPX-only panels that are deliberately absent rather than empty. Only the
markup switches: the SPX hooks keep running (one refcounted socket, shared with
the toolbar), so switching back is instant, and TickerBoard's poll only exists
while it is mounted.

## 2026-08-20 (f) - Post-Market: the scale guard was blocking a REAL 0DTE build

Edited: `components/pages/premarket/PostMarketTab.tsx`.

The guard added in (c) rejected anything more than 4x apart in EITHER direction.
On a live 0DTE it measured 0.1x and hid the open overlay, the biggest-strike list
and the delta heatmap, all three, with "a different book, not a different day".

It was a different day. The basis is OI + VOLUME, and at 09:29 today's contracts
have essentially no volume — the book that decides the session is written after
the bell. A 5x-20x build from open to close is the normal shape of an SPX 0DTE,
and showing it is the entire point of the panel.

The guard is now directional:

- ratio > 4 (recorded HOLDS MORE than live) stays blocked — the recorded side
  cannot legally carry more gamma than the live one unless it is a bigger book,
  which is exactly what `anyExpiry=1` used to produce.
- ratio < 0.02 stays blocked — 0.01x is the per-1% convention error
  (S^2 * 0.01 vs S^2), not a session.
- everything between is a real day and renders.

A build is now SAID rather than hidden: the section legend carries
"book grew 10.4x since 09:30" when the open ladder is under 60% of live.

## 2026-08-20 (e) - Phone build: PREP tab replaces EM

Added: `components/mobile/pages/MobilePrep.tsx`, `components/pages/premarket/postMarketData.ts`,
`app/app/m/prep/route.ts`.
Edited: `components/mobile/mobileNav.ts`, `app-vite/src/App.tsx`,
`components/pages/premarket/PostMarketTab.tsx`.

The Estimated Moves tab in the bottom bar is now **Prep** — Premarket Prep and
the Post-Market Recap on one phone screen, with the same PRE / POST switch as the
desktop page. EM was one number a day; this is the screen you actually open
before the bell and again after the close.

All three registry edits were made (the ones mobileNav's header lists): the tab,
the `lazy()` route in `App.tsx`, and `app/app/m/prep/route.ts` — miss the third
and the tab works in-app but the URL 404s on a hard refresh.

### The data layer came out of the desktop tab

`postMarketData.ts` is new but not new code: the recorded-ladder hook, the SAVED
wall grades (`/proxy/walls`) and the next-expiry structure were lifted out of
`PostMarketTab.tsx` the moment a second surface needed them. Both screens now
read the same hooks, so the phone can never disagree with the laptop about how
the day went — and the phone chunk does not pull the desktop tab's markup in to
get at them.

### Phone-specific, not a squeezed desktop page

- The desktop's horizontal level rail becomes a VERTICAL ladder: CW / CB / SPOT /
  FLIP / PW as rows, sorted high to low, distance from spot on the right. Five
  labels across 358px overlap; five rows do not, and they need no legend.
- PRE carries regime, the shared `LevelsBar`, the ladder, expected range, the
  overnight card and one base-case sentence.
- POST carries the verdict, net GEX open → now, the three recorded level grades
  (with the recorder's own reaction badge), and tomorrow's map after the roll.
- Every grid goes through `gridCols()` — the GLOBAL GRID COLLAPSE in globals.css
  would otherwise flatten them.
- The POST hooks live in a child component, so the phone spends no request on the
  recap while you are reading the morning map.

`/m/em` stays routed and `MobileEm` stays in the build — old links and bookmarks
still work, EM just no longer holds a slot in the six-tab bar. `/premarket` now
redirects a phone to `/m/prep`.

## 2026-08-20 (d) - Premarket: the GEX profile scrolls

Edited: `components/pages/Premarket.tsx`, `components/pages/premarket/PostMarketTab.tsx`.

"GEX Profile by Strike" showed ±12 strikes and nothing else existed. The walls
routinely sit outside that window, which is exactly when you want to look at
them. The panel is now the scroll container and renders ±60.

### Two windows, on purpose

Widening the single window would have changed what the chart MEANS:

- `nearBars` (±12) still sets the bar widths and still owns the 0DTE magnet. One
  monster strike 200 points out would otherwise flatten every bar near the money
  and steal the magnet tag.
- `bars` (±60) renders. The rows cost nothing until you scroll to them.

`.spotline` / `.flipline` are absolutely positioned inside the scroll box, so
they travel with their rows instead of floating over whatever happens to be in
view. `overscroll-behavior: contain` stops a flick at the end of the ladder from
scrolling the page behind it.

### Centring that does not fight you

The panel loads centred on spot and STAYS centred while it is pinned. The first
scroll by hand un-pins it, so reading a far wall is never yanked back to the
money by the next live frame; a "back to spot" button appears and re-pins. Our
own `scrollTop` writes are flagged so the scroll event they fire is not mistaken
for the user's hand.

The post-market GEX-evolution ladder gets the same treatment (same two windows,
same scroll box). Its Δ heatmap deliberately stays on the ±12 window — 121 cells
in one row is a smear, not a heatmap.

## 2026-08-20 (c) - Post-Market tab: graded off the SAVED wall log, and the evolution panel un-broken

Edited: `components/pages/premarket/PostMarketTab.tsx`.

### The GEX evolution panel was comparing two different books

`useIntradayLadder` copied `anyExpiry=1` from the bubble-trail hook. That flag
exists so a multi-DAY backfill can span expiries (each day is written under its
own front expiry); here it dropped the expiry filter and merged EVERY expiry in
the window into one slot, so the "09:30 profile" was the whole SPX board while
the live side was today's 0DTE alone. ~100x apart: the change hatch ran the full
width of every row and the biggest-strike list printed +$65B deltas.

Three fixes, deliberately overlapping:

1. Ask for the expiry by name — no `anyExpiry`. (`top` was never a parameter this
   route understands; heatmap mode always returns the full ladder. Dropped.)
2. Dedupe cells per strike per slot, so a strike written twice in one 5-minute
   bucket cannot be counted twice.
3. A SCALE GUARD that does not trust the request shape: compare the recorded and
   live ladders over the strikes they share, and if total magnitude is more than
   4x apart, hide the overlay and say why instead of drawing a confident wrong
   number. The caret width is clamped to the track as a last resort.

### The card accents had no colour

The accent was a `::before` painted by tone classes, so a card whose level had no
verdict yet drew grey and the row read as unstyled. It is now an element carrying
the LEVEL's own colour — call wall red, put wall green, CORE violet — with the
verdict in the pill, which is the part that actually changes.

### SPX core values are graded from the log that already saves them

`server-v2/walls-recorder.js` captures SPX's call wall / put wall / CORE at 09:29
and every 15 minutes to 16:00, writes only when a level MOVES, and classifies
every touch four slots later — reject / break <5 / break / broke-and-consolidated
/ new wall / pinned / rolled over. That is a real server-side grade of the day and
it was already stored; the tab was busy inventing a worse one from the last frame.

`useRecordedWalls` now reads `/proxy/walls?date&symbol=SPX` (same endpoint and
shape as `/level-log`) and the recorder's verdict WINS for those three cards:
status is the classified reaction, the line under it reads
`7,750 → 7,745 · moved 2x · 3 tags`, and the foot carries excursion, reclaim
minutes and attempts. Gamma flip and max pain are not recorded, so those two stay
path-derived. Each card states which it is. Under the scorecard, every level MOVE
of the day is listed with its prev → new strike and the spot at the time.

When the log has nothing for the date, the three cards fall back to the derived
grade and say so.

## 2026-08-20 (b) - Premarket: POST-MARKET tab

Edited: `components/pages/Premarket.tsx`.
Added: `components/pages/premarket/PostMarketTab.tsx`.

/premarket now carries two tabs on one page. The premarket tab is unchanged. The
new one answers the questions that only exist after the close: did the morning
map hold, what changed inside the day, and what does tomorrow look like once
0DTE rolls off.

### The tab itself

Auto-selects by the clock — Premarket until 09:30, Post-Market from 16:05 (the
settle, not the bell; the last frames land in those five minutes). Either is
defensible in between, so the FIRST manual click pins the choice into
`sessionStorage` and the clock never moves it again for that session.

### Six sections, no invented numbers

| # | Section | Comes from |
|---|---|---|
| 1 | Day snapshot + verdict | live chain + ES session bars |
| 2 | Level scorecard (CW/PW/flip/CB/max pain) | the intraday spot path |
| 3 | GEX evolution, 09:30 vs now | the recorded per-minute ladder |
| 4 | Positioning at the close | the same DEX/vanna/call-put math the page already runs |
| 5 | Tomorrow's map | the NEXT expiry's chain |
| 6 | Journal, level accuracy, replay | localStorage + the recorded ladder |

**The unlock is `/api/snapshots/option-strike-gex-history`** — the per-minute
ladder the ES chart's bubble trail already backfills from. The live socket keeps
no history, so without it there is no 09:30 profile and no intraday spot path,
and half of this tab could only be faked. `useIntradayLadder` reuses that hook's
two hard-won guards rather than rediscovering them: the route answers HTTP 200
even when it threw (an `error` key and no `columns`), and "today" is the newest
NON-WEEKEND day present, because the recorder has no market-hours gate and
rewrites a frozen copy of Friday all weekend. It asks for `top=60` instead of 8 —
this tab draws the whole profile, not a handful of bubbles.

**Tomorrow's map is the only panel that needs a second chain.** `/api/gex`
ignores its `expiry` param (it mirrors whatever the socket is pinned to), so the
next expiry comes from `/api/expirations` + `/api/chains` and the walls are
computed here. `structureFromChain` COPIES the per-strike formula out of
`parseExpiration` — gamma x (OI + volume) x S^2 x 0.01 x 100, put side negated —
rather than calling it, because that helper returns only the net per strike and a
call wall is per-side by definition. Same constants, so tomorrow's walls are
computed exactly the way today's are. Fetched once per tab-open, never polled.

**Nothing renders a plausible-looking placeholder.** A number that cannot be
derived shows "—" or an explicit "not recorded today" note. The scorecard is only
worth reading if a green pill means the level actually held.

### Notes

- No new socket and no new topics — the tab is fed by props off the same
  `useMobileGex` frame the premarket tab uses.
- The 09:30-vs-now profile draws ONE bar (now), a white caret at the 09:30 level
  and a hatched segment between them. The first design drew both profiles as
  filled shapes and was unreadable.
- Level accuracy writes one row per session to localStorage after 16:05 and keeps
  20; it starts empty and fills in with use.
- The journal is per-date localStorage on that device — not synced, not a server
  record.

## 2026-08-20 (a) - Premarket: one GEX level rail above the cards

Edited: `components/pages/Premarket.tsx`.

The two mockup strips (OVERNIGHT CONTEXT / EXPECTED RANGE) each drew their own
axis, so the same price sat at two different x positions one card apart. This
collapses the idea into ONE rail, mounted between the regime row and the KEY
LEVELS grid (directly above the Call Wall card): put wall, gamma flip, core
bullseye, spot, call wall, all on a single shared price domain.

- **CB = Core Bullseye** — the strike carrying the most *absolute* gamma across
  the WHOLE chain, the same definition `Board.tsx`'s levels panel uses, so the
  two surfaces can never print a different CB. It is deliberately not the "0DTE
  Magnet" card, which is capped to the +/-12-strike window the profile draws and
  can therefore miss a larger strike further out.
- Domain = min..max of the five levels + 14% padding; the put-wall..call-wall
  span is washed in behind the track.
- Captions alternate above/below in PRICE order (not by code) and are clamped to
  4%..96%, because two levels can print a few points apart and would otherwise
  overprint or run off the card edge.
- Each caption carries the level's price plus its distance from spot; SPOT
  carries its ES equivalent through the existing `basis`.
- Under 1180px the long level name is dropped and only the code remains.

No new data source: everything comes off the chain `useMobileGex` already
delivers, so the rail cannot disagree with the cards under it.

## 2026-08-19 (g) - ΔGEX Board: every basis carries its own "run at" timestamp

Edited: `server-v2/eod-strike-gex-recorder.js`, `server-v2/server-with-proxy.js`,
`owner-vite/src/pages/GexGrowth.tsx`.

### There is no single "when was this row run"

`ts` is the INSERT clock and always has been. That is not the same fact as *when
this data was true*, and on this table the two diverge two different ways:

- The sweep **paces** across ~169 symbols over several minutes, so the write
  clock is minutes later than the read for most of them.
- After the 09:25 re-stamp, `oi_*` on a row was read **the next morning** while
  `vol_*` on that same row was read at yesterday's 16:05 sweep. One row, two
  values, a full session apart.

So a single row timestamp is wrong for at least one basis every single day.

### Three capture columns

| column | stamps | set by |
|---|---|---|
| `captured_at` | oivol, vol, and oi while provisional | evening sweep |
| `oi_captured_at` | oi once settled | 09:25 re-stamp |
| `flow_captured_at` | flow | the `flow_prints` aggregate |

All three are the moment the **read started**, not the write finished — a symbol
whose chain sweep takes 40s describes the book as of when the fetch went out, and
stamping the INSERT would date it 40s late every time. `flow_captured_at` is its
own moment because the flow aggregate runs after that symbol's chain sweep
finishes, even though both land in one INSERT.

`flowCapturedAt` is reset to null when the flow read lands nothing or throws —
an absence does not get a timestamp.

### Resolution

`BASIS_STAMP` maps each basis to its COALESCE chain, and `stampExpr(basis, alias)`
builds the SQL:

    oivol / vol  →  COALESCE(captured_at, ts)
    oi           →  COALESCE(oi_captured_at, captured_at, ts)
    flow         →  COALESCE(flow_captured_at, captured_at, ts)

The `ts` tail is the fallback for rows written before these columns existed — a
coarser answer, but a true one, and better than a NULL the page has to explain.

Change route returns `capturedAt` + `prevCapturedAt` (so a Δ names both moments
it compares). Board returns a **per-symbol** `capturedAt` — the sweep paces, so a
name whose chain failed at 16:05 genuinely is reading an older moment than the
rows above it in the rail. Live sets `capturedAt` to now by definition and keeps
the prior side's recorded stamp.

Re-firing the evening sweep clears **both** `oi_stamped_date` and
`oi_captured_at` — the row is provisional again, and leaving the morning stamp
behind would date a provisional read to a pass that no longer applies to it.

### Page

New `fmtEtStamp` prints date *and* time, deliberately unlike the existing
time-only `fmtEtTime`: a bare `09:25:14` would hide exactly the
session-apart difference these stamps exist to expose. Rendered as a `run
YYYY-MM-DD HH:MM:SS ET` pill in the basis strip — always visible, not a tooltip —
with the prior session's stamp on hover.

Also fixed while here: `stampExpr` replaced a first cut that built the alias
prefix with chained `.replace(/\(/g, ...)` on the COALESCE string. It worked and
was unreadable; the column list is now explicit data.


## 2026-08-19 (f) - ΔGEX Board: Split — calls and puts on the same rung

Edited: `owner-vite/src/pages/GexGrowth.tsx`. **Client only** — no server, no
schema, no new request.

The leg picker was exclusive (Net / Calls / Puts), which meant comparing the two
legs at one strike required toggling and holding a number in your head. That is
the same "the sum is lossy, so squint and remember" problem the basis split
exists to kill, one level down.

### Why it costs nothing

The ladder is already a centred diverging bar with a rail down the middle:
negatives draw left, positives right. On `oivol` / `oi` / `vol` the call leg is
≥ 0 and the put leg ≤ 0 at *every* strike by construction — so the two legs
occupy opposite halves of the row and **cannot collide**. Drawing both is one
row, same height, no overlap, and it is the standard gamma-profile-by-strike
picture.

New leg setting `split`, alongside the existing three. Calls and Puts stay, so
the rail can still be ranked by one leg alone.

### No fetch

`split` is the only leg that is not a server-side projection. Every response
already carries the full `callGex`/`putGex` pair *alongside* whichever leg was
asked for, so Split sends `leg=net` and renders what came back. The rail
therefore still ranks by net under it — which is right, not a workaround: Split
is a decomposition OF the net, not a different ordering.

### `RailBars` grew a side

`{ v }` → `{ left, right }`, each drawn independently, so a row can carry a bar
on both sides. Single-value callers pass `{ left: min(v,0), right: max(v,0) }`,
which is byte-for-byte the old rendering — verified by rendering the component
to static markup across all seven mode × leg combinations. Colour still comes
from the SIDE, not the leg, so a bar left of the rail is red everywhere on this
page.

### Per-mode and per-basis

| combination | rendering |
|---|---|
| split, unsigned basis, levels/delta | ONE row — puts left, calls right |
| split, unsigned basis, compare | TWO rows (was → is), each carrying both legs |
| split, `flow`, levels/delta | TWO rows, one per leg — either leg can be negative there, so they cannot share a rung's sides |
| split, `flow`, compare | **not offered** — four rows a strike. The button is not rendered, same as Live on flow, rather than left lit and quietly doing something else |

Value column shows both numbers, calls over puts, matching the bars. Axis header
reads `← puts · calls →` when the legs share a row.

**Bug caught by the render harness:** compare mode drew the ghost row from prior
LEVELS but the solid row from leg DELTAS — two different quantities on one rung
at two different scales. `legPair` now keys on `mode === "delta"` rather than
`!== "levels"`, so compare is level-vs-level exactly as it is for net. `isDelta`
still treats compare as a Δ mode for the rail, which is correct there and was
the source of the confusion.

`splitBlocked()` guards the flow+compare case, and `effLeg` degrades a
already-selected `split` to `net` if the mode changes under it — so the page can
never sit in a state its own controls do not offer.


## 2026-08-19 (e) - ΔGEX Board: call vs put per strike, and the gross flow split behind the net

Edited: `server-v2/eod-strike-gex-recorder.js`, `server-v2/server-with-proxy.js`,
`server-v2/api-router.js`, `owner-vite/src/pages/GexGrowth.tsx`.

Follows (d). Two splits, one level below the basis split.

### `leg` — net / call / put, on every basis

New param on all four read routes, orthogonal to `basis`: basis picks the
contract count, leg picks which option type's gamma. `(basis, leg)` resolves
through `levelCol()` to one of twelve columns — the only place a request
parameter becomes a SQL identifier, whitelisted in the recorder (`normLeg`) and
again at the public hop (`legParam`). Verified: `leg=call, (SELECT 1)` falls
back to `net`.

`net` is call + put and that sum is lossy — a fall is equally consistent with
call gamma coming off and put gamma piling on. Compare mode told those apart in
aggregate; this tells them apart rung by rung.

**The sign means different things per basis, and that is the value:**

- `oivol` / `oi` / `vol` — legs are signed by CONVENTION (calls +, puts −, on an
  unsigned count), so the call leg is ≥ 0 and the put leg ≤ 0 at *every* strike.
  A single-leg ladder there maps WHERE that type's gamma sits; it cannot cross
  zero. The caveat strip says so on screen, because a reader arriving expecting
  a flip will not find one and the absence is arithmetic, not the book.
- `flow` — legs are signed by MEASUREMENT, so either can take either sign.
  "Dealers are short call gamma at 6400 and long put gamma at 6300" is a
  sentence only this basis can produce.

The rail ranks on the same column the ladder draws. The structural **badges
(flip, walls, sign flips) deliberately stay on the basis's NET column** whatever
the leg is set to — every one of them is a property of the two legs together,
and a monotonic single-leg running total has no crossing to find. Computing a
"flip" on a call-only ladder would return null for every symbol on the board, or
worse, a number off a curve with no zero. The badges describe the book; the
ladder describes the leg you asked for.

Date picker is now basis AND leg scoped: both dimensions have their own
migration date (legs 2026-08-18, bases 2026-08-19), so `oivol/call` and
`oivol/net` do not offer the same sessions. Live's cache key went
`symbol|basis` → `symbol|basis|leg`; without the leg it would serve a call
ladder to a put request for 60s.

### Flow gross: four columns, because a net of two opposite events hides size

New: `flow_call_buy_gex`, `flow_call_sell_gex`, `flow_put_buy_gex`,
`flow_put_sell_gex`.

`flow_call_gex` nets two opposite events — gamma the dealer took ON (the public
sold calls to them) and gamma they took OFF (the public bought). A strike where
they did 5,000 of each nets to ~zero and reads **identically to a strike nothing
traded at**. That is the same "a red bar has two stories" ambiguity compare mode
exists to fix, reappearing inside a single session.

`getFlowLadder()` now keeps the inventory gross (`callLong`/`callShort`/
`putLong`/`putShort`) instead of netting at ingest, and the legs are rolled up
FROM the components — so the identities hold by construction, not coincidence:

    call_buy + call_sell = flow_call_gex
    put_buy  + put_sell  = flow_put_gex
    all four             = flow_gex

`*_buy_gex` is always ≥ 0 (dealer long that leg), `*_sell_gex` always ≤ 0.

Worked case from the test harness — dealer short 5,000 calls and long 4,900 of
the same strike:

| reading | value |
|---|---|
| call leg NET | −20,000 (looks almost quiet) |
| call leg GROSS | 1,980,000 (huge two-way size) |
| directional | 5.3% |

### Page

Leg picker beside the basis picker (re-fetches — the rail must rank on the
column the ladder draws). Ladder column header appends the leg, so a call
ladder stops being labelled "Net GEX". Caveat strip names the leg and, on the
unsigned bases, warns that the ladder is one-sided and has no flip to read.

On `flow`, a "dealer took on" chip row shows the four gross components summed
over the rows in view (so the ±% band applies), plus a **% directional** line —
net ÷ gross. Near 1, the flow went one way and the net is the whole story. Near
0, the dealer took size on both sides and ended up flat: a busy strike a
net-only ladder draws as a quiet one. `hasGross` is reported separately from
`hasBasis`, so a flow session recorded before these columns shipped shows its
real net ladder and says the decomposition was not recorded — rather than
silently omitting the row.


## 2026-08-19 (d) - ΔGEX Board: four bases, and the day-over-day diff that was double-counting a session

Edited: `server-v2/eod-strike-gex-recorder.js`, `server-v2/server-with-proxy.js`,
`server-v2/api-router.js`, `owner-vite/src/pages/GexGrowth.tsx`.

### The bug

`eod_strike_gex` stored ONE number per strike: `net_gex`, on the OI+Vol basis
(`|γ| × (open_interest + volume)`). Its day-over-day diff was not slightly
early — it was counting a session twice.

Open interest does not settle at the close. OCC publishes overnight, so the OI
the chain carries at 16:05 on session T is the file settled through **T−1**.
Volume on the same response is **T**'s. A row is `OI(T−1) + Vol(T)`, so:

    row(T) − row(T−1) = [OI(T−1) − OI(T−2)] + [Vol(T) − Vol(T−1)]

The left bracket is the NET result of session T−1's trading. The right bracket
SUBTRACTS `Vol(T−1)` — the GROSS of that same session. T−1 appears in the Δ
twice, once net and once gross, with opposite signs. A name that traded heavy
Tuesday and quiet Wednesday printed a big negative Δ on Wednesday about nothing
that happened on Wednesday.

No scheduling change fixes that. The halves had to be stored apart.

### Four bases

New columns (all NULLABLE, **no backfill** — the chains are gone and the split
is exactly what `net_gex` threw away). `basis` is now a param on all four read
routes; anything unrecognised reads as `oivol`, so old clients are byte-identical.

| basis | column | what it is | honest Δ? |
|-------|--------|-----------|-----------|
| `oivol` | `net_gex` | `\|γ\| × (OI + volume)` — the original series, ~a year of history, still the default | no (the double-count above) |
| `oi` | `oi_gex` | `\|γ\| × open interest`, re-stamped next morning | **yes** |
| `vol` | `vol_gex` | `\|γ\| × volume` — same-session, so the LEVEL is the read | no (second difference) |
| `flow` | `flow_gex` | signed **dealer inventory** × γ, from the tape | no (session, not book) |

`net_gex` / `call_gex` / `put_gex` are still computed by the UNCHANGED
expressions, so the legacy series is bit-for-bit what it was. Consequence,
stated because someone will assert on it: `oi_gex + vol_gex` agrees with
`net_gex` only to float noise, not exactly. History continuity beat additivity.

### The 09:25 OI re-stamp

New pass (`runOiRestamp`, `POST /proxy/eod-strike-gex-restamp`) rewrites the
**previous** session's `oi_*` columns off the freshly settled file and stamps
`oi_stamped_date`. That is what makes `oi` a real ΔOI — without it `oi_gex` on
row(T) is `OI(T−1)` and the diff describes the wrong day.

UPDATE, never INSERT, and it touches nothing but `oi_*`: the evening's
`net_gex`/`vol_*` are a record of a settled close and stay as recorded. Refuses
any date ≥ today (today's OI settles tonight; stamping it "settled" would be a
load-bearing lie). Re-stamps the latest RECORDED session, not "yesterday" by
calendar, so holidays and long weekends resolve correctly. Costs one more full
chain sweep — there is no cheaper source for settled OI than the chain.

### Flow basis — the only one that knows direction

The other three sign their legs by CONVENTION (calls +, puts −, on an unsigned
count). Open interest carries no side: 40k OI on the 6400 calls is dealer-short
or dealer-long depending on who opened it, and no OI arithmetic can tell those
apart. `flow` is built from bid/ask-classified prints in `flow_prints`, mirrored
(public buys → dealer short, public sells → dealer long), so its sign is
**measured**. Both legs use the same polarity — the conversion the OI bases do
by negating the put term is already baked into the inventory's sign.

Per-expiry gamma is captured during the same chain sweep (`gammaAcc` keyed
`exp|strike`) so each expiry's inventory multiplies by ITS OWN gamma before
folding into the strike — a weekly and a LEAP at one strike are not the same γ.

Four limits, documented on screen and in `getFlowLadder()`: SPX/SPY/QQQ only
(`EOD_STRIKE_GEX_FLOW_SYMBOLS`); premium-floored, so block flow not the whole
tape; for SPY/QQQ only the near-spot front-expiry window the streamer
subscribes to; and inventory resets each morning, so it is a SESSION not a book.
Unclassified (`bucket='neutral'`) prints are dropped, not guessed — including
them would bias the whole ladder short.

### Reads

`basis` selects a column trio through `BASIS_COLS`, the only place a basis
becomes a column name. `normBasis()` whitelists it in the recorder and
`basisParam()` again in `api-router` — these identifiers are interpolated into
SQL (Postgres has no parameter form for a column name), so the gate nearest the
internet must not be the missing one. Verified: an injection string falls back
to `oivol`.

Date resolution is basis-scoped everywhere (board CTE, `listStrikeGexDates`), or
every new basis would look like it had a year of history the day it shipped, and
`flow` would list 169 names of flat zeros instead of three real ones.

`hasBasis` / `hasPrevBasis` ship pre-COALESCE, because a zero board and an
unrecorded board are pixel-identical once COALESCEd and the difference is the
whole point — "SPY had no flow" is not "we never recorded flow for SPY".

Live (`getStrikeGexLive`) serves `oivol`/`oi`/`vol` off the chain and **refuses**
`flow` rather than downgrading — a silent fallback would put an unsigned OI
number under a header claiming the sign was measured. Its cache is now keyed
`symbol|basis`; keyed on symbol alone it would serve an `oi` ladder to a `vol`
request for 60s.

### Page

Basis picker beside the mode tabs (it re-fetches — four columns, not four views
of one payload). The caveat for the active basis renders ON SCREEN, not in a
tooltip, and the strip turns gold on a Δ tab whose basis cannot honestly be
differenced — that is the exact mistake this change exists to stop. On `oi`, a
SETTLED / PROVISIONAL chip says whether the re-stamp reached both sides of the
diff. Live is hidden (not disabled) on `flow`. Switching basis clears the
session pick, since the picker is basis-scoped.


## 2026-08-19 (b) - GEX levels replay: a white spot line across the ladder

Edited: `components/pages/Analytics.tsx` (`TlLadder`) — the "GEX levels" tab of
`/replay`, both panes.

Matches the chain-ladder replay: one white rule straight across the ladder, from
the strike column to the value column, sitting at the PRICE rather than on the
nearest rung, with the price printed at its right end. The ◀ caret says which
strike price is closest to; the line says where inside that strike it actually
is — the difference between "769, roughly" and "769.9, leaning on 770".

Rows moved into their own column div (`rowsColRef`) so the line has something to
measure against, and the root became `position: relative`. Pitch is measured off
the real DOM — rows carry padding and a border, so a guessed px-per-row drifts —
from first→last / (n−1) so nothing compounds, re-measured by a ResizeObserver
only when the ladder changes size. The pixel position is DERIVED DURING RENDER,
never state fed by an effect: an effect paints the line one commit behind the
spot it is labelled with, which is invisible when idle and a visible trail
during playback. Spot is interpolated between the two strikes that bracket it,
so an uneven strike grid still lands in the right place.


## 2026-08-19 (c) - Options Chain replay: the ATM rule stopped jumping when cells filled in

Edited: `components/pages/OptionsChain.tsx` (`ChainGrid`).

Two separate things moved the white ATM box, and both were geometry, not intent.

1. **Rows sized to their contents.** The replay axis is fixed for the whole
   session, so a strike the current sweep did not record renders blank and the
   next sweep prints `+$0` in the same row. Blank cell, no line box; `+$0`, one
   line — the row grew, everything under it shifted, and the ATM rule a few rows
   away jumped. Padding rows had the same disease in reverse: rendered fully
   empty, they collapsed to 4px slivers and so never held the centre they exist
   to hold. New `ROW_MIN_H` (17) floors the sticky strike cell — the one cell
   every row has, data or padding — which floors the grid row. Count-mode cells
   that need two lines still grow past it; it is a floor, not a fixed height.

2. **The ATM row was 4px taller than every other row.** The value cells draw the
   white box with inset box-shadow specifically so it cannot shift layout — and
   then the strike cell drew its half with real `border-top` / `border-bottom`,
   adding 4px to the tallest cell in the row. So every time spot crossed a
   strike the outgoing ATM row shrank and the incoming one grew, and the rule
   lurched instead of stepping one row. Now inset, like the cells beside it. The
   box's left edge stays on the first value cell where it always was.

Neither change touches which strike is ATM, the OI call/put split, or the walls
— `nearestStrike` still follows real spot exactly.


## 2026-08-19 - GEX levels replay: the ladder stopped juddering under a walking spot

Edited: `components/pages/Analytics.tsx` (`TickerLookupCard` / `TlLadder`) — the
"GEX levels" tab of `/replay`.

Rewound, both ladders anchored on the strike nearest the LIVE spot of whichever
frame was playing. Spot walks a point or two per frame, so every few frames it
crossed to the next strike: `tlWindow` re-sliced the ±20-rung window one rung
over, `windowKey` changed, and the auto-centre effect scrolled the pane. Over a
session that read as a constant shudder — the numbers were right, the paper
under them would not sit still.

The window and the scroll now read a HELD anchor instead of spot. New
`useTlAnchor(rows, spot, resetKey)` returns spot quantised to a strike that only
advances once spot has walked `TL_ANCHOR_SLACK` (5) strikes away from it; the
window carries ±20 rungs and the pane shows ±10, so 5 strikes of drift still
leaves spot on screen with ladder either side. `resetKey` (symbol · pane ·
expiry · live-vs-rewound) forces a fresh anchor whenever the axis changes
outright, so it never centres on a rung the new ladder does not have.

`TlLadder` takes an optional `anchor` prop and centres on that row; omitted, it
centres on the spot row exactly as before, so the live path is unchanged. The
◀ spot caret, the lit row and the level chips all still read the real spot —
the marker keeps tracking price frame by frame, only the scroll holds still.

Also factored the nearest-strike scan out of `tlWindow` into `tlNearestIdx`,
which both it and the anchor hook use.


## 2026-08-18 - ΔGEX Board: three Read-panel bugs the first real SPY payload exposed

Edited: `owner-vite/src/pages/GexGrowth.tsx`.

The Read panel shipped earlier today was verified against synthetic ladders. The
first look at live SPY (`+4.61B` at the 08-14 close, `−8.31B` on 08-17) broke
three things at once. All three were WORDING that contradicted the data beside
it — the arithmetic was right throughout.

1. **A whole-book sign flip was reported as "deepening."** `regimeCopy` keyed on
   the sign of the Δ, so a book crossing zero fell through to the size wording:
   SPY read `NEGATIVE · deepening` when it had gone from long gamma to short.
   Nothing deepens from positive. A flip is now checked FIRST and gets its own
   copy — `NEGATIVE · flipped from long`, with a line naming the reversal —
   because it is a different event, not a bigger version of the same one. The
   function now takes `prevTotal` rather than `deltaNet`, since the flip test
   needs both endpoints.
2. **The gamma-flip tile asserted something the movers list disproved.** With no
   zero crossing it printed "the whole ladder is one sign," three inches above a
   list showing `776 +3.83B` and `772 −4.79B`. "The running total never reaches
   zero" and "every rung has the same sign" are different claims and I wrote the
   wrong one — a deeply short book with fat call strikes is exactly the case
   where they diverge. `Analysis` now carries `oneSided` and the tile picks the
   true message, the mixed case naming the ±40-strike window as where the flip
   probably sits.
3. **`−467%`.** The put wall went `−844.9M → −4.79B`. Correct, unreadable. New
   `growthStr()` switches to a multiple past 2× (`5.7× deeper`), inverts below
   0.5× (`2.5× smaller`), and returns `crossed zero` for sign-crossing moves,
   which have no meaningful ratio at all.

Verified: 58 assertions (up from 45), including the exact SPY numbers for the
flip case, `zero prior is not a flip`, and a mixed-sign ladder with no crossing
asserting `oneSided === false`. `tsc --noEmit` clean, `vite build` green, page
re-rendered against the real SPY figures with zero console errors.

## 2026-08-18 - ΔGEX Board: the Read panel — regime, walls, gamma flip and ranked movers, on live data

Edited: `owner-vite/src/pages/GexGrowth.tsx`,
`owner-vite/src/pages/registry.ts`, `owner-vite/src/lib/nav.ts`.
Removed from the nav/registry: the `ΔGEX Ideas` mockup page (see bottom).

The board reported WHAT CHANGED and left the reader to work out what it meant.
This adds the interpretation layer — computed in the browser from `detail.rows`,
the exact array the ladder draws, so the panel and the bars under it can never
disagree. **No new endpoint, no recorder change, no migration.**

### What it shows

- **Regime strip.** `Σ netGex` (sign → regime), `Σ prevNetGex`, the Δ, and the Δ
  as a share of `Σ|netGex|` — the only version of that number comparable to
  another symbol. Wording is a table keyed on (book sign × Δ sign), the same
  discipline `MODE_COPY` enforces for the tabs, so a label cannot drift from its
  number. Deliberately **mechanical, not advisory**: "long gamma, and thinning"
  rather than "sell premium here". The trade call is the reader's.
- **Wall tiles.** Call wall = `argmax(netGex)` above spot, put wall =
  `argmin(netGex)` below, each with its prior level, its Δ, and the Δ as a share
  of its OWN prior. Returns "—" rather than a nearest-to-zero strike when nothing
  on that side carries gamma of the expected sign — "there is no put wall today"
  is a real answer and a fabricated one reads as a level.
- **Gamma flip.** Where cumulative net GEX crosses zero, interpolated between the
  two straddling strikes, run twice (now and prior) → the migration plus the
  signed cushion from spot. Reports EVERY crossing and shows a `N× crossing`
  badge when a book crosses more than once; the level shown is the one nearest
  spot.
- **Biggest moves.** Ranked by |Δ|, each row carrying its distance from spot, its
  share of the book, and a tag: `flipped +/−`, `new +γ/−γ`, `built`, `eroded`.
  Sign flips are their own tag because a strike that crossed zero changed KIND,
  not just size — true however small its dollar Δ.
- **±3% / ±5% band.** Filters what the ladder DRAWS and what the movers rank,
  and never the regime totals, the walls or the flip — a band is a reading aid,
  and applying it to a sum would silently redefine the sum. When it hides rungs
  the ladder footer says how many, because a reader who forgot the band was on
  would read a missing wall as a wall that left.
- **`Read` toggle** collapses the whole panel.

All of it works unchanged in **live** mode: the rows are live, and the live
caveat strip already sits above it saying what that Δ is.

### Two things caught in review

- **Put walls now "deepen" and "lift"; only call walls "build" and "erode".**
  A put wall losing magnitude is LESS short gamma under price, which the tone
  colours green — a green chip reading "eroding" makes a reader stop and
  re-derive what it meant.
- **`pts()` scales precision to magnitude.** A put wall two points from spot was
  printing as `−0.0%`.

### Verified

45 assertions over the pure functions (`zeroCrossings`, `findWall`, `tagMove`,
`analyzeLadder`, `regimeCopy`), run against the compiled module — including:
no phantom crossing at the bottom rung (the running total starts at zero); all
three crossings of a whipsawing book, each interpolated; a strike exactly at
spot belonging to neither side; a deepening short tagged `built`, not `eroded`;
and the band leaving `netTotal`, `deltaNet` and both walls untouched while
dropping out-of-band movers. `tsc --noEmit` clean under owner-vite's strict
config, `vite build` green, page renders against mocked payloads with zero
console errors.

### The mockup page is gone from the nav

`ΔGEX Ideas` was a design doc with invented numbers. Its modules 1–4 are now
real and on the board, so the route and registry entries are removed. **The
orphan file `owner-vite/src/pages/GexIdeas.tsx` still needs deleting by hand** —
nothing imports it, so it is dead weight rather than a bug.

Still open from that doc: rail badges (SQL work in the board CTE), the call/put
split (schema change, no backfill possible), and 0DTE (the recorder is ex-0DTE
by design). The gamma-flip **direction convention** is also still undecided —
the panel deliberately reports the migration and the cushion as measurements and
asserts nothing about whether a rising flip is bullish, because the two
conventions in common use disagree.


## 2026-08-18 - New owner page: ΔGEX Ideas (/owner/gex-ideas) — the interpretation-layer design doc

Added: `owner-vite/src/pages/GexIdeas.tsx`.
Edited: `owner-vite/src/pages/registry.ts`, `owner-vite/src/lib/nav.ts`.

The proposal for turning the ΔGEX Board from "what changed" into "what it means",
rendered as a real owner page so it can be read at ship size next to the board it
describes. Seven modules: regime verdict strip · wall building/eroding cards ·
gamma-flip migration + cushion · ranked ΔGEX normalised by `Σ|netGex|` with
tag rules · rail badges · the three things the board genuinely cannot answer ·
a build order.

**It is a MOCKUP.** Every number is invented, nothing fetches. The page header
says so and the file header says so twice.

### Why a React route and not a .html in public/

Two reasons, and the second is the one that matters.

1. `AGENTS.md`: the live UI is React `.tsx` under a page module; a loose `.html`
   is dead-code territory by that document's own rule of thumb.
2. **Auth.** `owner-vite` is gated by `<AuthGate>` in `App.jsx` — React, inside
   `index.html`. nginx's `try_files $uri` serves a static file *before* any of
   that runs, so `owner-vite/public/anything.html` is world-readable to whoever
   has the URL. The Next side is the same story from the other direction:
   `middleware.ts`'s matcher explicitly excludes `\.html?`, so a static file in
   the root `public/` is never gated either. As a route it inherits the owner
   gate like every other page.

### Styling

Section shells are the shared `<Card variant="budget">`, so the page ages with
the rest of the app. The dense internals (the ranked table, chips, the flip
track) are class-based off ONE `<style>` block rather than a few hundred inline
objects — but every colour in that block is interpolated from `HOME_THEME` via
`rgba()`, so there is no hardcoded hex outside the two GEX polarity constants
(`POS`/`NEG`), which are the same pair `GexGrowth.tsx` pins and for the same
documented reason.

Sign is carried by side-of-centre-rail and by an explicit `+`/`−` as well as by
colour, and every state chip carries a word and a glyph — green/red alone
measures ΔE 7.4 on deutan separation, which is below the readable floor.

### Nav

`Market` group, directly under **ΔGEX Board**, glyph `◇`. The nav entry carries a
comment saying to delete the link and the page together once the modules ship —
a design doc that outlives the thing it designed is how two descriptions of one
feature start disagreeing.

### Deploy note

`owner-vite` is NOT built by the root `Dockerfile` (that one only rebuilds
`app-vite` → `public/app`). This page reaches the VPS through the separate
`owners` compose service — `docker compose build owners` — which runs
`npm run build` inside `owner-vite/Dockerfile`'s node stage.

Verified: `tsc --noEmit` clean under owner-vite's own strict config
(`noUnusedLocals` / `noUnusedParameters` included), `vite build` green, page
renders with zero console errors.


## 2026-08-18 - ΔGEX Board: Live toggle on "Prior → now" (close → the chain right now)

Added: `getStrikeGexLive()` in `server-v2/eod-strike-gex-recorder.js`,
`GET /proxy/eod-strike-gex-live` in `server-v2/server-with-proxy.js`,
`GET /api/eod-strike-gex-live` in `server-v2/api-router.js`.
Edited: `owner-vite/src/pages/GexGrowth.tsx`.

The owner ΔGEX Board was entirely end-of-day: every number on it came from the
16:05 ET sweep, so during a session it showed yesterday's close against the day
before. The **Prior → now** tab now carries a **Live** toggle that swaps the
"now" side of the OPEN symbol's ladder for the chain as it stands this second,
against that symbol's last recorded close.

### What it is — and what it is NOT

Not a Δ 1D, and the page says so on screen rather than only in a tooltip. GEX
here is the OI+Vol basis: open interest is last night's settled file and does
not move until tomorrow's, while volume starts at zero at 09:30 and accrues all
session. So live-vs-close is **today's tape building on a fixed OI base** — near
zero at the open, growing into the bell. That is the signal, but it is a
different quantity from the session-over-session Δ the other two tabs show.
A caveat strip above the split chips states this, and swaps copy for two edge
cases the server flags: `prevIsToday` (today's 16:05 sweep already landed, so
the outline IS today's close and the Δ is post-close drift) and
`marketDay === false`.

### Server

- `getStrikeGexLive(symbol, { force })` joins the symbol's **most recent single
  recorded date** (the prior side) against a fresh `gexRowsForSymbol()` +
  `windowRows()` (the now side). Same OI+Vol formula, same ±40 index window, so
  the two sides are the same definition of GEX.
- **Writes nothing.** An intraday row in `eod_strike_gex` would become
  tomorrow's Δ baseline and silently corrupt the recorded series — which is why
  this is a separate function and not `runSweep()` with a flag.
- Strikes are the **union** of both windows, not just the live one, for the same
  reason `getStrikeGexChange` FULL JOINs: a wall that came off, or fell out of
  the window as spot moved, is the biggest negative change there is.
- Response is the `getStrikeGexChange` shape plus
  `{ live, asOf, expiryCount, cached, ageMs, prevIsToday, marketDay }`, so the
  client's ladder renders it unchanged.
- **Cost control.** Each uncached read re-runs every listed expiry for one
  symbol — one slice of the nightly sweep. Results cache per symbol for
  `EOD_STRIKE_GEX_LIVE_TTL_MS` (default 60s, cache bounded at 220 entries), and
  concurrent callers share ONE in-flight sweep. `force=1` skips the cache but
  still joins an in-flight job, so a double-click on ↻ costs one sweep, not two.
- `/api/eod-strike-gex-live` is **owner-only** (unlike `-change`, which is
  subscriber): this is not a table read, and behind `subscriber` it would be a
  request amplifier aimed at our own upstream. No `date` param and no
  board-wide variant — "live" only ever means now, and 169 names live is the
  nightly sweep on a click.

### Client

- Toggle renders **only on the `compare` tab** (live IS the prior→now reading)
  and suspends itself when an older session is picked — "live vs the 8th" would
  be a spread over N sessions, not a day's build. The toggle stays lit so
  returning to the latest session restores it.
- **Headline and "biggest" chip are recomputed off the live rows.** They used to
  come from the rail row, which is the recorded close-to-close Δ — in live mode
  that would have contradicted the bars underneath it.
- The four split chips still sum exactly to the net Δ above them, now off the
  live rows (verified: `posBuilt + posPulled + negBuilt + negPulled === Σ chg`,
  including strikes that flip sign).
- Labels key off the **payload** (`detail.live`), never off the toggle's intent,
  so the few hundred ms between toggling and the fetch landing can never caption
  a live ladder as end-of-day.
- Ladder column becomes `Δ vs close`, axis `← lighter · heavier →`, header shows
  `live HH:MM:SS ET vs close YYYY-MM-DD` off the server's `asOf` (so a cached
  payload stamps when it was actually swept), plus a dim `cached Ns` marker.
- Distinct empty state: "no recorded close on file yet" points at the missing
  baseline, not at "one snapshot on file" which would name the wrong problem.
- **No auto-poll.** ↻ is the refresh, and with Live on it also forces a fresh
  sweep for the open name. Arrowing the rail costs one sweep per name you stop
  on, per minute.
- Rail stays end-of-day throughout.


## 2026-08-18 - New email template: final call — 2 spots at $300/yr, ends at midnight

Added: `lib/emails/midnight-300.ts`.
Edited: `app/api/admin/email-templates/route.ts`.

New one-click preset for the owner broadcast composer (`owner.cbedge.net` →
Emails). Same invoice-style layout and dashboard palette as `nopants-promo.ts` /
`nopants-extension.ts`, re-cut as a hard deadline drop:

- Subject: `2 spots left at $300/yr — ends tonight at midnight`.
- Pill banner reads **⏳ ENDS TONIGHT AT MIDNIGHT** instead of the extension's
  "sold out in 30 minutes" proof banner — the scarcity here is the clock, not
  the social proof.
- Hero: "2 spots left. Then the code dies." + "no extension this time" (the
  previous drop already used an extension, so promising another would burn the
  deadline's credibility).
- Invoice card unchanged in shape: $1,000.00 list, −$700.00 today, $300.00 due.
- Code is **EDGE** (NOT the NOPANTS code the previous two drops used — a fresh
  code so the old batch's redemptions can't leak into this one's 2-spot cap).
  **Must exist in Stripe as $700 off the $1,000 annual price before this sends.**
  `code`, `price`, `listPrice`, `spots` and `deadline` are all `Midnight300Opts`
  overrides, so a different code/price is a call-site change, not an edit.
- Keeps `{{UNSUBSCRIBE_URL}}` (`UNSUB_URL_PLACEHOLDER`) so the send route can
  swap in the per-recipient tokenized link.

Registered in `buildTemplates()` as id `midnight-300`, label
`⏳ Final call — 2 spots at $300/yr, ends at midnight (EDGE)`. Appended last
per the `EMAILS_HANDOFF.md` checklist, so `newestFirst()` puts it on top of the
picker.

Preview: `generated/2026-08-18-midnight-300-preview.html`.

X post assets for the same drop: `md files/midnight-300-x-post.md` (main post +
2 alts + 4 bump replies), `midnight-300-x-post.svg` and the rendered 1200x675
`midnight-300-x-post.png`, also copied to `generated/`. Same layout as the
NOPANTS post graphics, with the "sold out in 30 min" badge swapped for
**ENDS AT MIDNIGHT / 2 SPOTS · NO EXTENSION** and both spot pips shown open.


## 2026-08-18 - Ex-0DTE ladders get their own walls; Scanner level tiles get a scope chip

Edited: `server-v2/eod-gex-recorder.js`, `components/scanner/GexLevelsTab.tsx`,
`hooks/useBoardGexLadder.ts`, `components/pages/Board.tsx`.

**The problem.** The Scanner's GEX Levels tab showed two different flips with
nothing reconciling them. The `Neutral` tile at the top is `/proxy/gex` — ONE
expiry (0DTE for SPX), clipped to ±8% of spot by the proxy's contract
subscription. The ex-0DTE card lower down prints `findGexFlip()` over the whole
board minus today. Both correct, different scopes, and neither said so — which
reads as a bug. Worse, `Resistance` / `Support` had no whole-board counterpart at
all: `/proxy/gex-by-strike-multi` returned `{rows, totalNetGex, gexFlip}` per
ladder and no walls, so a board view had to borrow the 0DTE ones or show nothing.

### Server: walls on both multi-expiry ladders

`server-v2/eod-gex-recorder.js` → `computeLiveGexRowsMulti()` now adds
`callWall` / `putWall` to BOTH the `all` and `ex0dte` ladders, via the existing
`findCallWall` / `findPutWall` from `gex-calculator.js` — same definitions as
everywhere else (highest +GEX above spot, most −GEX below, OI+Vol basis).

- **Additive only.** No existing key changed shape or meaning; `/proxy/gex-by-strike-multi`
  in `server-with-proxy.js` already spreads the payload, so the route is untouched.
- Computed from the FULL merged rows, not `slimRows` — the wall pick needs
  nothing slimming drops, but running it pre-slim keeps it identical to
  `computeGexSummary`'s pick.
- `exclude` is deliberately NOT passed. That option exists so the scanner's CB
  and CW can't land on the same strike, and there is no CB on this payload.

### Client: the walls, and honest scope

`components/scanner/GexLevelsTab.tsx`

- `GexMultiLadder` / `parseMultiLadder` carry `callWall` / `putWall`. A server
  that predates the change omits them → they parse to null → the header **drops
  the segment entirely** rather than printing `—`, so a stale deploy reads as
  "this build has no walls", not "there are no walls".
- The multi-expiry card header now reads
  `N expirations, 0DTE excluded · total … · flip … · res … · sup …`.
- `AmTbrStat` gained optional `scope` (a chip beside the label) and `title`.
  `Resistance`, `Support` and `Neutral` are now chipped **0DTE** and carry
  tooltips naming the ±8% window and pointing at the ex-0DTE card. The two flips
  on that page now visibly measure different things.

`hooks/useBoardGexLadder.ts` + `components/pages/Board.tsx`

- `GexLadder` carries the walls too, and the board GEX card's `seriesLabel` shows
  the ex-0DTE ladder's OWN `CW / PW / FLIP` while EX-0DTE is on — never the
  feed's. GEX only: there is no delta wall.

**Deploy note:** the server change needs a server-v2 restart. Until then the
walls arrive absent and every consumer above degrades to not showing them.

## 2026-08-18 - /board GEX card: GEX | DEX switch + EX-0DTE toggle (four series)

Edited: `components/pages/Board.tsx`, `components/dashboard/GexChart.tsx`,
`components/dashboard/GexToolbar.tsx`, `components/shared/DockToolbar.tsx`,
`lib/calculations/calculations.ts`. New: `hooks/useBoardGexLadder.ts`.

**The change.** Two controls on the board's GEX card toolbar — a `GEX | DEX`
segmented group and an `EX-0DTE` toggle — composing into the four series asked
for: GEX, DEX, GEX ex-0DTE, DEX ex-0DTE.

**/home is untouched.** Every new `GexToolbar` prop is optional and each control
renders only when its handler is supplied. `HomeClient` passes none of them, so
its toolbar is exactly what it was.

### DEX bars

DEX was already in `GexChart` — as a thin overlay LINE on its own hidden 60%
scale (`showDex`). That answers "which way does delta lean" but not "how big is
it at this strike". New `metric?: "gex" | "dex"` prop swaps the BARS to
`netDEXOf`, on the same axis and gridlines as everything else. The overlay line
is suppressed while the bars are DEX — one number drawn twice on two scales
reads as two series that disagree.

Suppressed in DEX because they are gamma-specific, not merely unhelpful:
- the flip curve + gamma-zero line (dealer gamma repriced at 401 spots; there is
  no delta equivalent)
- the prior-state ghosts (baselines are stored net GEX — differencing them
  against delta bars subtracts two different units)
- MVC touch tracking (the whole read is about the gamma cluster; the latch is
  cleared when `metric` changes, alongside the existing `dataMode` reset)
- the `CB` peak label becomes `PEAK DEX` — Core Bullseye is a gamma name
- Flow basis falls back to OI+Vol (the tape is classified into gamma inventory;
  there is no flowDEX)

The hover tooltip in DEX shows the delta figure as the active leg with the gamma
figure on the same strike as context.

### EX-0DTE is a different DATA SOURCE, not a setting

`/ws/gex` is single-expiry **by construction** — the proxy's `_activeContracts()`
filters `c.expiration !== this.expiry`, and `computeGexRows()` carries a scope
warning that multi-expiry input keeps only the last expiry per (strike, side).
There is no frame to ask for.

New `hooks/useBoardGexLadder.ts` reads **`/proxy/gex-by-strike-multi`** — the
existing board sweep built for the /test page, which returns both the `all` and
`ex0dte` ladders (OI+Vol, summed per strike by `computeGexRowsMultiExpiry`, so
they line up with `eod_gex.total_gex_ex0dte`). **No proxy or server code was
changed** — this is a GET against an endpoint that already existed.

- Fetched ONLY while the toggle is on. The sweep is one upstream fetch per
  expiration server-side; a board nobody switches to ex-0DTE never runs one.
- Polled at 60s, matching the server's own `GEX_MULTI_TTL_MS` cache. Polling
  faster would re-read the same cache entry and buy nothing.
- While the first sweep is in flight (or if it failed) the card keeps drawing
  the live rows and the tile says `EX-0DTE…` / carries the error in its tooltip,
  rather than blanking.
- Refresh (↻) re-runs the sweep instead of re-asserting SET_EXPIRY.
- The DTE picker dims but stays live — it still drives the shared socket for
  every other card on the board.

### Slim rows, and what had to change to make them draw

The sweep's rows are `{ strike, netGEX, netVolGEX, netDEX, volNetDEX }` — no
gamma, no delta, no OI. A full SPX board is ~1500 strikes.

- **`netGEXOf` gained a fallback** (`lib/calculations/calculations.ts`): a row
  with NO gamma on either side but with `netGEX`/`netVolGEX` present is a
  pre-summed ladder, so read the composite instead of recomputing from absent
  legs (which returned 0 for every strike — an empty chart, not an error). Gated
  on `== null` for BOTH sides, so a genuine zero-gamma strike and the chart's
  densified gap-fillers still take the normal path.
- **New `netDEXOf`**, the DEX counterpart. Precomputed legs WIN here — the
  opposite priority from GEX, deliberately: `netDEX`/`volNetDEX` are what every
  existing DEX readout draws, and recomputing would put a second opinion about
  delta exposure next to the first. `calculateNetDEX` is the fallback.
- **`GexChart` now degrades instead of drawing nothing.** One short-circuited
  pass over `chain` establishes whether per-side gamma legs and `flowGEX` exist
  at all; Call−Put and the Flow basis fall back to net bars when they don't.

### Series label

New optional `seriesLabel` prop draws a small top-left caption when the bars are
anything other than plain live GEX (`NET DEX`, `NET GEX · EX-0DTE (7 exp)`). The
chart cannot infer this — whether `chain` is one expiry or a summed board is
entirely the caller's doing, and the rows look identical either way. Without it a
screenshot of an ex-0DTE board is indistinguishable from today's.

`ToggleTile` (`components/shared/DockToolbar.tsx`) gained an optional `title` so
the EX-0DTE tile can explain itself and surface a fetch error.

## 2026-08-18 - ES Candles embed: the right-edge GEX rail is now a toggle

Edited: `components/pages/EsCandles.tsx`, `components/dashboard/es-candles/slotStore.ts`.

**The problem.** `EsCandlesPage embedded` — the ES card on /board and the ES view
of /home's GEX card — passed `sidePanel="rail"` as a literal. The vertical
GEX-by-strike rail on the right edge was permanent there, with no control, and in
a 6-column board tile it eats width the candles need. The full /es-candles route
has had a None / Rail / 0DTE picker in its Charts popover all along; the embed
had nothing.

**The change.** A `Rail` button in the embedded card's own dock (passed as
`toolbarExtras`, which is where the page already injects Charts / Replay /
Indicators). Lit when the rail is on, unlit when off. Two states, not the page's
three — the 0DTE chain panel needs 340px of chart beside it and is suppressed on
width in a tile that narrow anyway, so offering it there would be a button that
mostly does nothing.

**Its own storage key**: `es-candles-side-panel-embed-v1`, via new
`readEmbedSidePanel` / `writeEmbedSidePanel` in `slotStore`. It does NOT share
`es-candles-side-panel-v1` with the full route, because the embed is a narrow box
sitting beside a full GEX chart — hiding the rail there is a decision about that
tile, and sharing the key would silently strip it from /es-candles too. Defaults
to `"rail"`, so nothing changes for anyone who never presses it.

Read in an effect, never in a `useState` initializer (this route is still
server-rendered by Next before the Vite SPA takes over). The toggle keeps a ref
mirror so the localStorage write stays outside the state updater.

## 2026-08-18 - /board: Feed Health removed, GEX card is now the whole /home panel, chain card is Multi Greek on one ticker

Edited: `components/pages/Board.tsx`, `app/mult-greek/MultGreekClient.tsx`.

**Feed Health is gone.** The `health` card type, `HealthBody`, its `health#1`
entry in `DEFAULT_LAYOUT` and the `lastByTypeRef` plumbing that existed only to
feed it are all deleted, along with the two table styles nothing else used. The
board no longer stamps an arrival time on every frame.

**The GEX card is the /home GEX panel, whole — toolbar included.** It was the
bare `GexChart` canvas on fixed defaults with no controls. It now renders the
same `GexToolbar` + `GexChart` pair `HomeClient` does, wired to the same props:

- DTE / expiry picker, Net GEX vs Call−Put, OI+Vol / Vol Only / Flow GEX
- OI / DEX / Flip overlay toggles, refresh, snap + Discord (pointed at the canvas)
- ghost overlays via `useStrikeGexHistory`, polled only while a ghost is on
- the 401-level gamma profile is now recomputed on the SELECTED `dataMode`
  instead of always `oi-vol`, so the flip curve agrees with the bars under it

The toolbar sits in `FitScale min={0.42}`, same as /home, so it scales instead of
scrolling in a narrow tile. Card is `chrome: false` (it brings its own frame) and
`singleton` (see below). Default tile grew 8×11 → 8×13 to fit the toolbar.

**Expiry is board-wide, and that is deliberate.** The DTE picker sends
`SET_EXPIRY` through `sendGex`. That command is per-CONNECTION on the shared
`/ws/gex`, so it retargets every card on the board at once — tiles, Key Levels,
ES card, Greeks panel. This reverses the page's previous "never send SET_EXPIRY"
stance, which is why the GEX card is a singleton: two pickers would fight over
one board-wide setting. The picker shows the clicked date immediately and settles
onto whatever the feed confirms, so a round trip doesn't read as a dead button.

**/home is not affected.** `HomeClient` still opens its own private `/ws/gex`
connection, so a `SET_EXPIRY` sent from /board never reaches it.

**The Options Chain card is now Multi Greek pinned to one ticker.** The `chain`
card dropped `<OptionsChainPage embed />` and mounts
`<MultGreekClient tickers={["SPX"]} />` instead — the same page /mult-greek
renders, with its toolbar, expiry picker, Δ stamps, CB/CW/PW badges, intensity
slider, replay and click-through option chain, just one panel instead of four.
The card keeps the id `chain` so saved layouts pick it up in place rather than
dropping a tile; default size 12×18 → 6×18.

**New `tickers` prop on `MultGreekClient`** (`app/mult-greek/MultGreekClient.tsx`).
Omitted, nothing changes: SPX / SPY / QQQ plus the user's 4th slot. Passed, that
list IS the line-up, and the toolbar's 4TH input is hidden because it would edit
a slot that is no longer on screen. Keyed off a normalised joined string, not
array identity, so a caller passing an inline array can't restart the chain-fetch
loop every render (the /board card passes a module-scope constant anyway).

**Feed additions.** `BoardFeed` gained `expirations: string[]` (read from the
`gex`/`snapshot` payload and from `status`/`EXPIRATIONS` frames, same as /home)
and lost `profile` and `lastByTypeRef`.

## 2026-08-18 - /board cards now mount the REAL page components, not lookalikes

Edited: `components/pages/Board.tsx`.

**The change.** The first cut of /board hand-rolled its cards — an SVG bar chart
for GEX, a `<table>` for the chain, a list for flow. They looked right and were
fed live data, but they were a second implementation of nine things that already
exist, free to drift from the pages they imitated. Every card that has a real
counterpart now mounts THAT component:

| Card | Mounts | From |
|---|---|---|
| GEX chart | `components/dashboard/GexChart.tsx` | /home |
| Greeks panel | `components/dashboard/GreeksHomePanel.tsx` | /home |
| Gauge rail | `components/dashboard/HomeGaugeRail.tsx` | /home |
| Vol GEX flow | `components/dashboard/VolGexFlowPanel.tsx` | /home |
| ES candles | `<EsCandlesPage embedded />` → `EsChartCard slot="embed"` | /es-candles |
| Options chain | `<OptionsChainPage expirySelection="key" ticker="SPX" showGrandTotal={false} />` | /options-chain |
| Flow tape | `components/dashboard/FlowTape.tsx` | /flow |
| Net premium | `components/dashboard/FlowNetPremPanel.tsx` | /flow |
| Estimated moves | `components/dashboard/EmCustomer.tsx` | /em |
| Economic calendar | `<EconCalendarPanel todayOnly hideToolbar />` | /economic-calendar |
| Scanner · GEX change top | `components/scanner/GexChangeTop.tsx` | /scanner |
| Scanner · IB stats | `components/scanner/IbStatsTab.tsx` | /scanner |
| Multi Greek | `app/mult-greek/MultGreekClient.tsx` | /mult-greek |

Three cards stay board-native because nothing mountable exists: Overview tiles,
Key Levels, Feed Health.

**`chrome: false` is back**, copied from the Options board: a component that
renders its own `<Card>` or page chrome mounts raw and gets only a slim
edit-mode strip for the grip and the ✕, instead of a header we own. Otherwise
GexChangeTop, IbStatsTab, EmCustomer and MultGreek would each show two stacked
titles.

**Two cards are singletons, for a concrete reason.** `escandles` — `EsChartCard`
namespaces its localStorage by `slot`, and `EsCandlesPage embedded` hardcodes
`slot="embed"`, so two instances would fight over ticker / interval /
indicators. `multgreek` — it is a whole page in a tile (four ticker columns plus
its own dock) and wants ~1000px of width.

**Socket discipline.** Several mounted components subscribe on their own, which
is fine because `gexSocket` is refcounted AND their topic lists are subsets of
`BOARD_TOPICS`: GreeksHomePanel `["gex","spot"]`, HomeGaugeRail `["gex"]`,
EsChartCard `["gex","spot","aux","status"]`. They ride the board's connection
rather than widening it. Anything added later must be checked the same way —
**`components/dashboard/WhaleOrdersPanel.tsx` is deliberately NOT offered as a
card** because it opens a raw UNSCOPED `/ws/gex`, which would drag the whole
tab back to the firehose while it is mounted.

**Three pages have no card, and this is not an oversight.** `/flow`, `/levels`
and `/traders-dashboard` each render their own `<PageShell>` with every panel
inline and nothing exported, so mounting one nests a page shell inside a tile.
/flow's reusable pieces (FlowTape, FlowNetPremPanel) are cards; the other two
would need real extraction first. `app/home/HomeClient.tsx` is excluded for a
different reason: it opens a raw per-mount `/ws/gex` and sends `SET_EXPIRY`,
which is exactly the connection-wide side effect this board avoids — hence
mounting `GexChart` with the board's own feed instead.

**Also worth knowing (found while mapping this):** `components/dashboard/`
`EstimatedMoves.tsx`, `GexHeatmap.tsx`, `EsCandlesCard.tsx`, `EsStatsLadder.tsx`,
`ScannerHomePanel.tsx`, `SnapshotPanel.tsx` and `components/scanner/`
`DodMoversTab.tsx`, `SemisTab.tsx` are imported by no route — dead. In
particular `EstimatedMoves.tsx` (73KB) is NOT what /em mounts; /em mounts
`EmCustomer.tsx`. `FlowTape.tsx` was also an orphan and is the one this change
resurrects.

**Verified.** `tsc --strict` clean on Board.tsx, typechecked against the real
component files so every prop name and type above is the actual signature.


## 2026-08-18 - /board: a second card board with add/remove, on the near-black palette

New: `components/pages/Board.tsx`, `app/app/board/route.ts`.
Edited: `app-vite/src/App.tsx` (lazy import + `<Route path="/board">`),
`components/shared/GlobalToolbar.tsx` (NAV_ITEMS entry).

**What it is.** A second customer dashboard on the SAME grid machinery as the
Options board — `DashGrid` + `useDashboardLayout` + `LayoutBar`. Drag a card's
header to move it, drag the corner to resize, "+ Add card" in the bar to add
one, ✕ on a card to remove it; the arrangement saves per user as a named
template in `dashboard_layouts` under the page key `"board"`. Card TYPE lives in
the id as `type#n`, so add/remove/duplicate needs no schema change.

Nine card types: Overview tiles, GEX by Strike, Key Levels, Gamma Profile,
Options Chain, Whale Flow, Estimated Moves, Economic Calendar, Feed Health.
Every number is live — nothing is hardcoded.

**Why it doesn't use PageCard / homeTheme.** This page is the near-black palette
trial: flat opaque surfaces (`--app #010102` / `--shell #020304` /
`--card #0a0b0e`), deliberately unlike homeTheme's frosted translucent panels.
It is SCOPED TO THIS PAGE (`BOARD_THEME` at the top of the file) so nothing else
in the app changes while the look is being lived with. There are no literal hex
values outside that one block. If it graduates, move those six surface values
into `homeTheme.ts` and delete `BOARD_THEME` — do not start hardcoding hex
elsewhere. Palette source: `generated/2026-08-18-dark-slate-card-theme.html`.

**One subscription for the whole page.** `useBoardFeed` opens exactly one
`subscribeGex` and fans the parsed frames out through React context. Nine cards
each calling `subscribeGex` would each re-parse the same ~100KB gex frame.

Three deliberate choices worth not re-litigating:

- **Topics are declared at module scope** as
  `BOARD_TOPICS = ["gex","spot","aux","status","flow"]`, including the scalar
  frames, which the server drops if unlisted. `flow` stays in the list even when
  the Whale Flow card is removed — the value keys the subscription effect, and
  making it depend on the card set would reconnect (clearing the replay cache)
  on every add/remove.
- **It does NOT send `SET_EXPIRY`.** That command is per-CONNECTION on a socket
  the whole tab shares, so pinning an expiry here would silently retarget the
  toolbar and every other mounted consumer. The board shows whatever expiry the
  feed is on and labels it. (`useMobileGex` does pin, which is correct for the
  phone build — it owns its route.)
- **Frame arrival times are a ref, not state.** Only Feed Health reads them and
  it already ticks its own 1s clock; publishing them as state re-rendered every
  card on the board at the feed's rate. A diagnostic panel must not become the
  page's most expensive component.

**No ES candle card.** `hooks/useEsCandles` is a large stateful hook with its own
topic set and a lightweight-charts mount; wrapping it in a resizable tile is its
own change. Gamma Profile fills the chart slot using `computeGEXProfile`, which
is pure client math on rows already in memory.

**Verified.** `tsc --strict` clean on the new file. `check-routes.mjs --dry`
reports `nav /board -> has route` and `shell /board -> has route.ts`, so the
build guard passes on both counts.

**Note found along the way.** `components/pages/Options.tsx` — the original
add/remove board and the only other `DashGrid` consumer — has had no SPA route
since `/options` was removed 2026-08-12. The file still builds and is still
reachable by import, but nothing routes to it.


## 2026-08-18 - theta-terminal removed; it took the site down and was already unused

Edited: `docker-compose.yml`, `.dockerignore`.
To delete by hand (see the deploy notes): `deploy/theta/`,
`docker-compose.staging.yml`, the root `*.jar` files.

**What happened.** A routine deploy built cleanly — Next OK, the Vite route
check passed, the SPA built, `bzila-dashboard:latest` built, and
`dashboard-dashboard-1` was recreated. Then compose aborted the whole `up`:

```
Container theta-terminal Started
Container theta-terminal Waiting
Container theta-terminal Error dependency theta-terminal failed to start
dependency failed to start: container theta-terminal is unhealthy
```

The dashboard never started, so the site went down over a container that has
nothing to do with serving it.

**Root cause — nothing to do with the deploy.** `deploy/theta/Dockerfile.theta`
only ever `ADD`ed the BOOTSTRAP jar from `download-unstable.thetadata.us`. The
bootstrap then downloaded the actual runtime jar over the network on EVERY
container boot; nothing was cached in the image and nothing was copied from the
repo (the comment said so outright). That download began returning 404:

```
WARN: Failed to download JAR file. HTTP error code: 404
ERROR: Unable to contact the server to find the correct JAR file to run,
ERROR: and there are no JAR files in the library.
```

No jar to run, no library to fall back on, crash-loop. This would have fired on
the next restart whatever was deployed — an `unstable` channel plus a boot-time
download plus no cached fallback is a time bomb, and the deploy just happened to
be the thing that pulled the pin.

**It was already dead weight.** The VPS runs `DATA_SOURCE=tt` and
`INDEX_SOURCE=dxlink`, so every live path — the GEX ladder, greeks, OI, volume,
the flow tape, `/ws/gex`, ES/NQ candles, ETF candles, spot — comes from
TastyTrade + dxLink. `server-v2/tt-snapshot.js` is the drop-in that made that
switch and is what has actually been serving all of it. ES/NQ candles never had
a Theta path at all.

**Changes**

- Removed the `theta-terminal` service, replaced in place by a comment saying
  why and what to do differently if it ever comes back.
- Removed `dashboard.depends_on: theta-terminal: condition: service_healthy`.
  That gate existed to kill a cold-start race ("Feed failed to start: fetch
  failed" -> spot:0), but the race is already handled in code —
  `server-with-proxy.js:3588-3605` retries feed start forever with backoff
  (2s -> 30s cap) and its comment literally says "Theta will come up". The gate
  was belt-and-braces that became a single point of failure. **`docker-proxy` is
  untouched.**
- `.dockerignore` now excludes `*.jar`. The Dockerfile does `COPY . .` and
  nothing excluded jars, so building from a local working copy silently baked
  ~103MB of dead ThetaData jars into the dashboard image. VPS builds from a git
  clone never hit it (they're gitignored), which is exactly why it went
  unnoticed. Deliberately NOT excluding `*.csv` or `eng.traineddata` — the OCR
  data feeds `/api/tpo-extract` and some CSVs may be read at runtime.

**Deliberately left alone.** Everything else degrades on its own and did not
need touching the same hour the site was down:

- `far-cb-recorder.js:63-82` — the only ungated live Theta call. Its circuit
  breaker returns `[]` after one failure and stops asking for 10 min; the dxLink
  backfill at `:84-91` is already the preferred path.
- `/api/owner/theta-stats` (`api-router.js:3120-3156`) — owner-only container
  metrics tile, will 500.
- `state/flow-watchdog.js` / `state/theta-restart.js` — only started under
  `useTheta()`, so already inert under `tt`.

Worth doing later as a clean sweep, not under pressure.

**Cost of the removal:** the documented one-env-var `DATA_SOURCE=theta` rollback
lever is gone for good. Everything behind `useTheta()` (Theta FPSS flow stream,
bulk greeks poll, Theta OI/volume, `INDEX_SOURCE=theta`) is now unreachable.

## 2026-08-17 - Overlay settings really do stick now (they didn't across a chart-count switch)

Edited: `components/dashboard/es-candles/slotStore.ts`,
`components/dashboard/es-candles/EsChartCard.tsx`.

Every control in the Overlays dropdown already wrote to localStorage and was
read back on mount — audited all 15, and there are zero keys written by a
control that aren't restored. But there are TWO blobs, the card's own slot and
`SHARED_SLOT`, and the chart count decides which one is read. Writes only ever
went to the active one, so the two diverged the moment both layouts got used.
Both directions were broken:

- **multi → single.** Everything set with 2-3 charts up went to SHARED, and the
  single-chart restore reads its own blob ONLY (`cfgSlot === slot ? own : …`).
  Set your overlays on a 3-up row, drop to one chart, and they are gone. This is
  the one that reads as "the overlays don't save".
- **single → multi.** `ensureSharedSeeded()` copies slot 0 into SHARED exactly
  once, when SHARED doesn't exist yet. After that, changes made in single-chart
  mode never reach SHARED — but SHARED still WINS the merge on the way back up,
  so going multi could resurrect whatever the settings happened to be when that
  seed was taken.

**Fix: mirror every write.** `saveSetting` now persists the patch to the other
namespace as well, so both blobs stay current and it stops mattering which one
is read — the last thing you touched is always what you get. The mirror does
NOT broadcast (`writeSlotQuiet`): subscribers listen on the active slot, the
primary write already notified them, and notifying the mirror too would deliver
every change twice and hand cards a patch on a slot they don't own.

`symbol` is excluded by construction — it goes through `writeSlot(slot)`
directly and never through `saveSetting`, because the per-card ticker is the
whole point of a multi-chart row.

Simulated against the real store logic, switching single → multi → single:

| step | before | after |
|---|---|---|
| set heatmap ON, TPO ON (single) | `{heatmap:T, tpo:T}` | `{heatmap:T, tpo:T}` |
| switch to 3 charts | `{heatmap:T, tpo:T}` | `{heatmap:T, tpo:T}` |
| set TPO OFF, Flip X ON (multi) | `{heatmap:T, tpo:F, flip:T}` | `{heatmap:T, tpo:F, flip:T}` |
| **back to 1 chart** | **`{heatmap:T, tpo:T}`** ← TPO reverted, Flip X lost | `{heatmap:T, tpo:F, flip:T}` |
| set heatmap OFF (single), go multi | **`{heatmap:T, …}`** ← stale seed wins | `{heatmap:F, …}` |

## 2026-08-17 - GEX bubbles: they can actually get big on a 1-minute bucket now

Edited: `components/dashboard/es-candles/slotStore.ts`,
`components/dashboard/es-candles/EsChartCard.tsx`.

**Why 1m was tiny.** The size budget was
`min(maxPx, rowPitch*0.42, colPitch*0.45)`, and the layer's own notes say
horizontal overlap is ALLOWED — a fused row is a thick tube, and thickness is
exactly what the size law encodes — with only the ROW pitch being a real
guarantee (two rows must never merge into one band). But the column pitch was
still bounding the budget without limit, which contradicted that. Adjacent 1m
columns can sit 2-3px apart, so `colPitch * 0.45` drove the whole budget under a
pixel, and `size` could not rescue it because the multiplier is applied AFTER
the `Math.min` — it was scaling a number that had already collapsed. The `rxCap`
rail had the same shape and evaluated to ~0.2px at a 2px column pitch.

**Fix: a floor under the column term** (`BUBBLE_STYLE.colBoundFloorPx = 7`),
applied to both the budget and the rail. Measured, top-of-ladder mark radius:

| scenario | size | before | after |
|---|---|---|---|
| 1m, zoomed out | 1.0x | 0.40px | **3.50px** |
| 1m, zoomed out | 2.0x | 0.80px | **7.00px** |
| 1m, mid zoom | 2.0x | 3.40px | **7.00px** |
| 1m, zoomed in | 1.0x | 6.20px | 6.20px (floor inert) |
| 5m bucket | 2.0x | 19.80px | 19.80px (unchanged) |
| bar bucket | 2.0x | 34.20px | 34.20px (unchanged) |

The floor only binds below ~15px of column pitch, so every bucket that already
had room renders identically. The row bound is untouched — the one guarantee
that matters still holds exactly.

**Size ceiling 2x -> 4x.** 2x was chosen when the column pitch still hard-bounded
the budget, so the top of the travel was mostly theoretical. There is real room
up there now.

**New `top` slider (1.00 - 3.00, default "flat" = unchanged).** An EXPONENT on
the size law: `r = maxPx * (|net GEX| / reference) ^ curve`. Above 1 the top of
the ladder keeps the full budget while the wings shrink under it, so the
dominant strikes pull away without everything growing together.

This is deliberately NOT the rank bonus this layer keeps being rescued from. A
bonus made a mark bigger for a reason unrelated to its gamma and broke the
encoding; an exponent is monotonic on [0,1], so more gamma is still strictly a
bigger mark at every setting — the scale just gets steeper. Verified monotonic
at 1.0 / 1.6 / 2.2 / 3.0.

Caveat worth knowing: at the top of the curve's travel the smallest strikes all
bottom out on `minPx` (0.8px) and stop being distinguishable from each other.
That is the intended trade — it is what "the wings shrink" means — but if the
bottom of the ladder matters to you, stay nearer "flat".

Persists per card as `bCurve`, alongside `bLevels` / `bInt` / `bSize`.

## 2026-08-17 - ES Candles: every dropdown closes on click-away; ticker search resets

Edited: `components/pages/EsCandles.tsx`,
`components/dashboard/es-candles/symbols.tsx`,
`components/dashboard/es-candles/EsChartCard.tsx`.

**Click-away.** Overlays, the DTE picker, the ticker chooser and the Layout menu
already closed on an outside click. The three PAGE-level popovers — Charts,
Replay, Indicators — did not; they only answered Escape. That was deliberate
(the panels hover over the charts, and click-away would shut the indicator menu
the instant you reached for the chart to see what you had just turned on), but
the opposite complaint wins in practice: a menu you have to go back and un-press
is a menu that will not go away, and being the only three that behaved that way
made them read as broken.

They now close on document `mousedown` outside the panel and outside the three
buttons that own it. `mousedown`, not `click`, matching the other menus — a
`click` handler fires after the target has re-rendered, so a click on a row that
removes itself lands on nothing and reads as outside.

The Layout button sits in the same row but is deliberately OUTSIDE the exclusion
wrapper, so pressing it closes the popover instead of leaving two menus open.

**Click-away does not end a running replay.** Only the Replay button and
"● Live" do that. Clicking away just hides the transport — and the Replay button
now stays lit while a replay is running, so a running-but-hidden replay is still
visible rather than being the invisible frozen chart the close-exits-replay rule
was written to prevent.

**Ticker search starts empty.** It used to keep whatever you last typed, which
is only right if your next search is a prefix of your last one. Every other time
— and the common case is picking a ticker, coming back, and wanting a different
one — the list opened pre-filtered to a stale query and the first thing you had
to do was clear a box you did not fill in. Cleared on close rather than on open,
so the menu never renders a frame of stale filtering on the way in.

**Two bugs found while reviewing it**

- `CardSlot` renders a bare `<div>` at one chart and a `<Card>` at two or three,
  so a 1↔multi switch changes the element type at that position and React
  remounts the whole card — silently resetting `replayOn`. The page's
  `replayActiveRef` is not in that subtree and stayed true, so its button went
  on claiming a replay that no longer existed; pressing it opened an empty
  transport and took two more presses to recover. Pre-existing, but the newly
  lit button turned a silent desync into a visible lie. The card now broadcasts
  `{on:false}` when a hosted transport unmounts with it.
- Dismissing by click-away skipped `NumField`'s blur clamp. React flushes
  `setPopover(null)` before the browser runs mousedown's default focus change,
  so the input was unmounted before it could receive a blur — clearing the
  Bollinger length box and then clicking the chart persisted `bbPeriod: 0` for
  the session and silently stopped the cloud drawing. Both the click-away and
  Escape paths now blur the focused field first, turning the dismiss gesture
  back into an ordinary commit. (Escape had the same hole before this change.)

## 2026-08-17 - 0DTE rail: the ladder is one interpolated field, not a stack of tiles

Edited: `components/dashboard/es-candles/ChainRail.tsx`.
Mockup of the options considered: `generated/2026-08-17-0dte-rail-interpolated.html`.

**The complaint.** The rail's colours did not line up with the bubbles on the
chart. A flat band runs midpoint-to-midpoint, so a strike at 773 painted a solid
block covering 772.5-773.5 — and the eye reads the block's EDGE as a level.
There is no level at 773.5.

(Checked first and ruled out: this was NOT a basis misalignment. The rail uses
`steadyBasisRef || effectiveBasis()` and the bubbles use `basisAt(slotTs)`,
which resolves to the live server basis for today's session by construction —
see resolution rule 1 in `buildBasisAt`. The two agree. The band geometry was
also already correct: `bandFor` centres it on the strike. The problem was purely
that the band is FLAT, so being centred bought nothing.)

**The change.** Heat mode is now ONE linear gradient down the whole ladder with
a colour stop at every strike. Consequences:

- Everything between two strikes is the interpolation of those two, so the pixel
  halfway between 773 and 774 is their average — which is the honest answer for
  a price with no contract at it.
- The brightest pixel of a row now sits exactly on its strike, lined up with
  that strike's bubble. No edge anywhere to mistake for a second level.
- A small solid core (`STRIKE_CORE_FRAC`, 0.18) keeps a strike from looking
  thinner than its neighbour just because the ramp eats it from both sides. Set
  it to 0 for a pure triangular peak.
- A 1px notch at each strike, because with a continuous field there is no band
  edge left to read a level off. This is the mark that visibly registers against
  the bubble row.

**Sign flips** are a one-line switch, `FLIP_STYLE`:

- `"seam"` (default) — a transparent stop at the exact zero-crossing between
  opposite-sign neighbours: the point where the interpolated net GEX is 0, which
  IS the gamma flip. Cyan fades out, red fades in, the dark gap lands on
  something real, and no off-scale colour is ever shown.
- `"blend"` — let the gradient run straight through. Softer, no dark band
  interrupting the field, at the cost of a few pixels of grey-purple around each
  flip (usually one or two places on the whole rail).

Both were exercised against the edge-case ladders below.

**Levels-only mode is unchanged** and stays discrete: it paints CB / Call Wall /
Put Wall and nothing else, so there is nothing to interpolate between — a
gradient would fade three named levels into the void.

Also: labels now anchor on the strike's own y rather than the band centre. On an
uneven ladder those differ, and a label has to sit on the price it names.

Cheaper than what it replaces — one gradient and one `fillRect` instead of N
`fillRect`s, on a canvas that repaints every frame.

Edge cases exercised against the real function (monotonic stop offsets, no
out-of-range offsets, no throws): plain +/-, single sign flip, alternating
flips, interleaved zeros, all-zero, single row, two rows, duplicate y, sub-pixel
pitch, huge pitch, reversed y order, off-screen y, empty ladder.

## 2026-08-17 - ES Candles: Replay no longer touches the chart until you use it

Edited: `components/dashboard/es-candles/EsChartCard.tsx`,
`components/pages/EsCandles.tsx`, `app/es-candles/page.tsx`.

**The bug.** Pressing Replay did two things at once: it opened the transport AND
it set the cursor to bar 0, so the chart collapsed to the first bar of the
session on the click. Worse, `replayOn` keyed the gamma backfill — it widened
the request window to 4 days and dropped the server-side ladder truncation — so
a stray click re-fired a ~1.6MB query, and clicking again to undo fired a second
one. An accidental press cost a full reload of the page's heaviest data, twice.

**The fix.** Replay is now two flags:

- `replayOn` — the transport panel is open.
- `replayEngaged` — the user has actually started replaying.

Opening is inert. The chart stays live, the cursor parks at the LIVE EDGE (not
at 09:30 — a transport that opens parked at the open while the chart shows the
whole session is lying about what you are looking at, and it made the first drag
jump backwards through the entire day), and nothing refetches. The transport
says `live — scrub or press play to start` while it is armed but doing nothing.

The chart is clamped only when the user unambiguously asks for it:

- moving the scrubber
- stepping a bar (back always; forward is a no-op at the live edge rather than
  a silent freeze)
- pressing play — which rewinds to the open, because "replay the session" from
  the live edge has nothing to play
- picking a different day

The RTH/ETH switch deliberately does NOT engage: it only says which bars the
cursor may travel over, so flipping it to see the range should not freeze a live
chart.

`replayTs` is the single value everything downstream reads (candles, heatmap,
bubbles, flip-cross, rail, RSI, EMA/volume, price lines), so gating it on
`replayEngaged` is what makes an untouched transport a no-op everywhere at once.
Every DATA-side use of `replayOn` moved to `replayEngaged`: the backfill window,
`needsFullLadder`, the target bubble day, the live-ingest guard, the price-line
publishers and the bar countdown.

**Three bugs found while fixing it**

- The `● Live` button cleared `replayOn` but not `replayEngaged`, so it left the
  card in a state where the live price-line publisher bailed forever — Call Wall
  / Put Wall / Flip were removed from the chart and never came back, and the
  gamma backfill stayed stuck in its wide replay shape. It now routes through a
  shared `exitReplay()`.
- `replayDay` was reset on ENTRY. It feeds `activeReplayDay`, which feeds the
  backfill's shape key unconditionally — including in live mode — so after
  replaying a past session, merely RE-OPENING the transport flipped the day back
  to today, wiped the column store and re-fired the whole backfill. Reset on
  exit instead, so the key is stable across an open.
- `● Live` is portaled into the page's Replay popover, so pressing it left the
  page believing a replay was still running: the popover stayed open over an
  empty transport and the next press of Replay was a no-op. `exitReplay` now
  broadcasts, and the page subscribes to the channel it was only ever
  broadcasting on.

Also cleaned up: `toggleReplay` was calling `broadcastReplayCmd` from INSIDE a
`setPopover` updater. That was always a lie (an updater must be pure; React may
invoke it twice, and does under StrictMode) and became a real hazard once the
page subscribed to that channel — the broadcast synchronously re-entered the
updater it was running inside. Reads the flag first, acts after.

`replayOnRef` was deleted; nothing imperative cares whether the panel is merely
open.

---

## 2026-08-17 - ES Candles: page-level perf fixes ported to the file the SPA actually renders

Edited: `components/pages/EsCandles.tsx`.

**There are two /es-candles page files and only one of them is live.**

- `components/pages/EsCandles.tsx` — the live one. `app-vite/src/App.tsx:25`
  lazy-imports it; the route is registered at `:77`.
- `app/es-candles/page.tsx` — a diverged near-copy the SPA never renders.

The performance pass earlier today put its two PAGE-level changes in the second
one. Ported here: the `toolbarButtons` memo and the rAF-throttled popover
measure. (Everything else in that pass — EsChartCard, chartMath, ChainRail,
SidePanel, useEsCandles, useEtfCandles — is shared by both files and was always
on the live path.)

The memo also had to move ABOVE the `if (embedded)` early return: a hook after a
conditional return is a rules-of-hooks violation, and it is a live one here
because the home GEX card renders this component with `embedded`.

**The two files should not both exist.** They have already drifted (the live one
has `caret`/`open` props on the dock buttons and the Layout preset button; the
dead one does not), and the drift is invisible until a change lands in the wrong
one. Worth deleting `app/es-candles/page.tsx` once someone confirms nothing
serves `cbedge.net/es-candles` on the Next side.

Correction to the previous entry's "unused hooks" note: only `useStrikeGexRate`
is genuinely unused. `useGexBubbleHistory` and `useEmLookup` are used by
`components/mobile/`, and `useStrikeGexHistory` by `HomeClient`, `GexChart` and
`StrikeDetailPopup`.

## 2026-08-17 - ES Candles: performance pass (render, draw loop, network)

Edited: `components/dashboard/es-candles/EsChartCard.tsx`, `chartMath.ts`,
`ChainRail.tsx`, `SidePanel.tsx`, `hooks/useEsCandles.ts`,
`hooks/useEtfCandles.ts`, `app/es-candles/page.tsx`.

Full audit with line numbers: `md files/2026-08-17-es-candles-perf-audit.md`.

Nothing was removed from the page. Every overlay, study and panel still works
the same way — the work that went away was work that produced no pixels.

**Render churn**

- `useEsCandles` published on TWO separate 250ms timers (`setTodayRows` and
  `setSessionTick`), so the documented 4Hz render ceiling was really 8. One
  timer now, one React batch. The publish flags accumulate across the window
  instead of being latched from the first frame in it.
- The 1,409-line overlay effect had `rows` in its dep array, so ~4x/sec it tore
  down a ResizeObserver, three DOM listeners and a time-scale subscription and
  rebuilt them (and `ro.observe()` fires a synchronous callback on every
  construction). All of that wiring moved into the chart-init effect where it is
  created once and lives as long as the chart. The data effect now only
  republishes the draw closure and asks for a paint.
- `setCrossSpx` fired on every crosshair move and `setLiveSpx` on every pan
  frame, each allocating a fresh object so React could never bail — a full
  reconciliation of the largest component in the app at pointer-event rate. Both
  badges, and the 1Hz bar countdown, are now written directly to their DOM nodes
  from the paint rAF. This is the "slow crosshair".
- `EsChartCard`, `SidePanel` and `ChainRail` are `memo()`d; the page memoises the
  toolbar node it passes down and rAF-throttles the capture-phase scroll
  listener that was measuring + re-rendering all three cards on every scroll.
- Identity guards on `setLevels`, `setRailRows`, `setEmWeekly`, `setWeeklyEm`,
  `setPrevCloses`, `setMvcHistory` and `useEtfCandles`'s `setRows` — each was
  returning a fresh object/array on every poll or frame regardless of whether
  anything had changed.
- `replayGex` scanned the whole 10k-column store in the render body; now a memo.
- The candle series takes `series.update()` for the common "only the last bar
  moved" case instead of re-mapping ~7k objects into `setData()`. Guarded by a
  hash of every bar except the tail, because `rows5` is a slotKey merge in which
  the live copy overwrites the DB copy and can revise a bar mid-array.

**Draw loop**

- ONE rAF. Fifteen call sites were calling `draw()` synchronously around the
  coalescer that already existed, and a second independent rAF loop in the 5s
  backstop was subscribed to the same pan gesture with its own handle, so one
  drag frame scheduled two full repaints plus an extra rail draw.
- The finished heatmap layer (cells + blur + crisp pass) is cached in its own
  canvas behind a fingerprint of everything that can change those pixels. A
  frame where nothing moved blits a bitmap instead of re-running the cell loop
  and, above all, the full-viewport `ctx.filter = "blur(2.5px)"` — 4-12ms on its
  own. Pre-compositing is exact, not approximate: source-over is associative.
- The cell loop called `series.priceToCoordinate()` twice per cell (50k-250k per
  frame with the full ladder), half of them provably duplicates. Now memoised
  per (basis, strike) for the frame. `slotX()` likewise ran twice per column;
  one pass now.
- Per-column max / top-3 / strike-sort is cached on the column object. For
  every column but the newest that value never changes again all session.
- `gexColor()` built an `rgba()` string per cell, which the draw then put
  through a regex + parseFloat + a second `toFixed(3)` to apply the distance
  fade — four string ops and a CSS colour parse, per cell, per frame. Replaced
  in the hot loop by `gexAlphaOf()` (numeric) + `gexPaint()` (interned palette,
  alpha quantised to 1/256). `gexColor` stays as the reference for the curve.
- `buildBasisAt()` (walks all of `mvcHistory`, binary-searches the bars per CB
  point, sorts, medians per day) and the flip-cross series (spreads and sorts
  the whole minute store, then copies-and-sorts every column's cells) are both
  viewport-independent and were rebuilt every frame. Both memoised. Bubble
  `drawOrder` moved into the prep memo that already covers its inputs.
- `chartMath.etMinutes()` constructed a NEW `Intl.DateTimeFormat` on every call,
  and it is called per CB point per frame — several ms of every repaint from one
  missing hoist. Same bug in two `dayKey` helpers inside `EsChartCard`. Fixed,
  plus small caches on `etMinutes` / `etDayKey`.
- `new URLSearchParams(location.search)` was allocated inside `draw()` to test a
  debug flag; read once at mount now.
- Map eviction no longer spreads up to 10,000 keys onto the stack.
- `ChainRail` set `ctx.font` twice per row (~400 CSS font parses per rail draw);
  labels are drawn in two batched passes now.
- TPO drew one `fillRect` per box per bin per profile; collapses to one rect per
  row when box+gap falls below ~1.5 device px.
- Glow sprites: LRU eviction instead of wiping all 96 entries at the bound, and
  coarser size quantisation mid-gesture so a zoom stops missing the cache on
  every frame and re-rendering `shadowBlur` ellipses.

**Load / network**

- The settings restore is a layout effect, so the ~1.6MB gamma backfill and the
  four other gated requests start a full paint earlier.
- `/api/eod-gex` is prefetched on mount instead of being serialized behind the
  candle load it does not depend on.
- `useEsCandles` is now `enabled: isEs` — a SPY/QQQ card was pulling nine days of
  ES history and subscribing to both ES candle streams, then discarding all of
  it. Its `candles` memo (two full `buildSlotAverages` passes over the whole
  history, 4x/sec) is opt-in via a new `withAverages` arg; this page never read
  the result.
- ETF cards no longer request the `gex` topic — the heaviest frame on the feed,
  which `ingestLive` explicitly refuses on a non-ES card.
- Poll intervals matched to how often the data actually changes: `/api/levels`
  5min -> 30min (published weekly), `/api/eod-gex` 5min -> 30min (once a day at
  the close), `/api/snapshots/etf-candles` 30s -> 60s (rows written once a
  minute). `/api/levels` TTL 2.5min -> 30min so the card's two callers share the
  entry.
- The dock (~56 elements) was built on every render of every card and thrown
  away on the two that render a ticker instead.

**Bug fixes found on the way**

- The chart-init effect's `init` was declared `async` with no `await`, so
  `cleanup = fn` landed in a microtask while the returned cleanup ran
  synchronously. Under StrictMode the first cleanup ran before the assignment
  and did nothing — leaking a ResizeObserver that kept calling `applyOptions()`
  on a removed chart for the life of the page.
- `showLevels` was a dead dependency of the overlay draw effect.

**Not changed, deliberately**

- `/proxy/es-spx-basis` (30min poll) — proxy-related, left alone pending sign-off.
- Server-side `&bucket=5m` on the gamma backfill. The response is 1-minute
  columns and the heatmap floors ~80% of them away on arrival; bucketing
  server-side would cut the page's largest response 4-5x with no visual change.
  Needs a `server-v2` change.
- Scoping `useEsCandles` to one candle topic. It halves candle bandwidth at the
  default 5m, but the narrow-then-widen on a 1m/5m toggle makes `gexSocket` take
  the `reopenWithScope()` path — a real reconnect that bounces every consumer on
  the page. Not worth it for a routine click.
- The four unused hooks (`useGexBubbleHistory`, `useStrikeGexHistory`,
  `useStrikeGexRate`, `useEmLookup`) — nothing in this page's tree imports them,
  but a full-repo check is needed before deleting.

## 2026-08-17 - Owner left rail: star favorites to pin them to the top

Edited: `components/shared/OwnerSidebar.tsx`.

The owner rail had a fixed order (Owner / Backend / Personal), so the handful of
pages actually used every day sat wherever the group happened to put them.

- Every rail link now has a star button on its right edge. It fades in on hover
  (always visible once starred) and is a real `<button>` inside the row but
  outside the `<Link>`, so clicking it toggles the star instead of navigating.
- Starred links are lifted into a new **★ FAVORITES** block rendered above all
  groups, in the order they were starred, followed by a hairline divider. A
  starred link is *removed* from its original group, so nothing is listed twice
  and no group grows a hole it can't explain. A group that ends up empty is not
  rendered at all.
- Each favorite keeps its home group's accent color (cyan / orange / green), so
  you can still tell at a glance where a pinned page came from.
- Favorites can be reordered in place: hovering a favorite reveals ▲/▼ nudges
  (hidden when there is only one favorite).
- Stored per-browser in `localStorage` under `cbedge.ownerSidebar.favorites.v1`.
  Reads happen in a `useEffect` after mount — never during render — so the SSR
  markup and the first client paint match and there is no hydration mismatch.
  A `cbedge:owner-favorites` `CustomEvent` plus the native `storage` event keep
  the desktop rail, the mobile drawer, and other tabs in sync.
- `localStorage` access is wrapped in try/catch; in private mode the stars still
  work for the session, they just don't persist.
- The group list itself (`OWNER_SIDEBAR_GROUPS`) is untouched and remains the
  single source of truth — favorites are a pure view-layer reordering, so adding
  a page there still works exactly as before.

## 2026-08-17 - GEX Levels: ex-0DTE net delta ladder + cards drag between columns

Edited: `server-v2/eod-gex-recorder.js`, `components/scanner/GexLevelsTab.tsx`.

Two unrelated changes to the Scanner → GEX Levels tab.

### 1. New card: "Net delta exposure by strike (ex-0DTE)"

The existing "Net delta exposure by strike" card is **0DTE-only** — not ex-0DTE.
Its rows come from `/proxy/gex`, which `_activeContracts()`
(`server-v2/proxy-tastytrade.js`) filters to the single front expiry
(`c.expiration !== this.expiry → continue`). There was no multi-expiry or
ex-0DTE net delta anywhere, because `/proxy/gex-by-strike-multi` shipped gamma
only.

- `slimRows()` in `eod-gex-recorder.js` now emits `netDEX` and `volNetDEX`
  alongside `netGEX`/`netVolGEX`. Nothing new is computed —
  `computeGexRowsMultiExpiry` already sums both delta legs per strike; they were
  being dropped on the way out. Cost is 2 ints per strike (~1500 strikes).
- `multiRow()` reads them instead of hardcoding `netDEX: 0`.
- `NetDeltaByStrikeChart` gained a `basis` prop (`"oi" | "oivol"`) routed through
  a new `glDexOf()` accessor, deliberately parallel to `glOiVolNet()` so the two
  delta cards can't silently drift onto different bases again. Default is `"oi"`,
  so the existing 0DTE card is byte-identical.
- New `NetDeltaMultiPanel` (same shape as its gamma sibling `NetGammaMultiPanel`:
  shared 60s poll, shared refresh button, same empty/error states) renders the
  ex-0DTE ladder on the **OI+Vol** basis, matching the gamma ladders on that same
  endpoint. Hovering a bar splits the OI and Vol legs in the tooltip. Header
  total is summed client-side — the payload's `totalNetGex` is a gamma number and
  there is no server-side delta total to borrow.
- A stale server-v2 (pre-change) returns both legs zeroed; the panel detects
  all-zero and says "redeploy server-v2" instead of drawing a convincing flat
  line.

The 0DTE net delta card's title now says `(0DTE · <expiry>)` so the pair reads
as a set, and its subtitle states the OI-only basis.

### 2. Cards can now be dragged between the two columns

Previously the left and right columns were two independent `useCardOrder()`
hooks, each with its own key union (`LeftCardKey` / `RightCardKey`) and its own
localStorage key. A card was structurally unable to leave its column — a
left-column drag could only ever produce a `LeftCardKey` — which is why only the
right column felt reorderable.

Replaced with one `useCardLayout()` hook over a single `CardKey` union and one
persisted `{ left, right }` layout:

- Drop **onto another card** → the dragged card takes that card's slot in *that
  card's* column, pushing it down. Same-column drags behave exactly as before.
- Drop **onto a column's tail strip / gutter** → append to the bottom of that
  column. A dashed "DROP HERE" strip is mounted in both columns for the duration
  of a drag; it is the only way into a column you have emptied out.
- Card drops `stopPropagation()` so they win over the column's append handler.
- Dragged key is read from `dataTransfer` (falling back to React state) so it
  survives a re-render mid-drag.
- Storage key is `gexlevels-card-layout-v1`, with a one-time migration that reads
  the two old `gexlevels-card-order-{left,right}-v3` keys instead of discarding
  an existing arrangement.
- `normalizeLayout()` drops unknown/duplicate keys and appends anything missing
  to its **default** column, so a saved layout always renders all 12 cards
  exactly once — and adding a future card still lands it at the bottom without
  bumping the storage key.

Default columns are unchanged; they are now defaults rather than a constraint.

## 2026-08-17 - Level Log timeline reads oldest → newest

Edited: `components/pages/LevelLog.tsx`.

The Scanner section's Log page (`/level-log`) printed its event timeline newest
first, so the open baseline sat at the bottom and the session had to be read
upward. Both orderings are now forward in time:

- `WallTimeline` sorts `a.slot - b.slot`, so the open baseline leads and the
  latest slot lands at the bottom.
- The within-slot tiebreak flipped with it (`kindRank`: change/open before hit).
  Newest-first wanted the hit above the change that produced it; oldest-first
  wants the change first and the tag it caused after.
- `buildLogText()` — the copy/paste export — uses the same order, since its
  contract is "ordering matches the screen".

Rendering is order-agnostic (the connector and hairline both key off
`i === entries.length - 1`), so no layout change was needed.


## 2026-08-17 - Removed the #1-#5 rank badges from the home GEX heatmap

Edited: `app/home/HomeClient.tsx`, `components/dashboard/GexHeatmap.tsx`.

The badges on the live home heatmap came from `HomeClient.tsx`, not the
dashboard component: `rankBadgeDataUri()` rasterized "#1".."#5" as an inline
SVG `<img>` and the NET GEX cell rendered it left of the value. Both the
renderer and the helper (plus its cache) are gone.

The `rank` computation in `toHeatmapRows` STAYS — it drives the row `type`
(`pos-top` / `pos-strong` / `neg-top` / `neg-red`) that colors the cells, and
the separate delta-mover ranking that feeds `DeltaStamp`. Only the visible
"#N" chip was removed, so cell shading, the ★ Core Bullseye box, the ATM
outline and the Δ stamps are unchanged.

Also removed the equivalent (unused-by-the-live-site) badge in:
`components/dashboard/GexHeatmap.tsx` — there the badge span, the
`rankSide`/`rankAbove`/`rankBelow` maps and the `rankColors` table are gone,
while the per-column cell shading (`topRanksByCol` / `topRank`), golden peak
box and pin markers stay.

## 2026-08-16 - "No statement imported" was lying about imported months

Edited: `owner-vite/src/pages/Budget.tsx`.

July reported "No statement imported" for a July that had been imported and was
visible on Real Month the same day.

The empty state was keyed off `stmtCum != null` — whether the **new** `daily`
rollup came back with rows for the month. That conflates three unrelated
states: the month was never imported, the month is imported but has no outflow
rows, and the API did not send `daily` at all. The third case is live right now
for anyone running a `dashboard` image built before `listStatementDailyTrend`
existed: the SPA is new enough to render the empty state, the API is old enough
not to send the field, and the card confidently reports that a month you
imported was never imported.

The predicate is now `months.includes(month)` — the list of months that have
statement rows, which this endpoint has returned since it was written and which
therefore survives an older API. `hasCurve` is tracked separately, so:

- not in `months` -> "No statement imported"
- in `months`, no day rows -> "No spending rows this month"

Worth stating plainly: the underlying deploy issue is not fixed by this. If
`daily` is missing the curve still cannot be drawn — the card just stops
misattributing the cause. `docker compose build dashboard && docker compose up
-d dashboard` is what makes July draw.

## 2026-08-16 - Overview spend cards moved onto imported statements

Added: `listStatementDailyTrend()` in `server-v2/_lib-db.cjs`, `daily` on
`GET /api/budget/real` in `server-v2/api-router.js`.
Edited: `owner-vite/src/pages/Budget.tsx`.

The page had two definitions of "spent" on it. The Categories tab read
`budget_statement_tx` — what actually cleared the bank. The Overview read
`budget_register` — the plan, what you expect to pay and what you typed in.
Same page, same word, different numbers, and nothing said which was which.

**Spend Pace and Where It Went now read statements.** A card headed "spent" has
to mean money that actually left the account.

Still on the register, deliberately: Safe to Spend, Weekly Balance Check, Cash
Flow and the calendar. Those are questions about the plan and about the bank
balance — bills still due, what clears before rent — not about what a category
cost. The register is the right source for those and moving them would be wrong,
not merely unnecessary.

**New: day-level statement spend.** The category trend endpoint returns month x
category, which cannot draw a day-by-day pace curve. `listStatementDailyTrend`
adds outflow grouped by `tx_date` over the same 12-month window, and the GET
response carries it as `daily`. Both the current month's curve and the typical-
month benchmark are now built from that one array, so they are guaranteed to be
the same kind of number.

**The averaging rule changed with the source, and it had to.** On the register,
a category missing from a month meant zero was spent. On statements, a month
you never imported is *unknown* — averaging it in as zero would halve every
figure. Both averages now divide by IMPORTED months (excluding the one on
screen): a month you imported where a category saw nothing still counts as a
real zero, a month you never imported does not count at all. This is the same
rule the Categories grid already used; the two surfaces finally agree.

**Empty states, because zero and unknown look identical on a chart.** With no
statement for the month, Spend Pace would have drawn a flat line along the
bottom — indistinguishable from a month of no spending. Both cards now say "No
statement imported" and point at Real Month. Both also carry "imported
statement" in the subtitle, so the source is legible next to the register-backed
cards beside them.

Verified end to end against a synthetic four-month import: SQL rollup -> daily
curve -> resampled benchmark -> per-category averages. Day 16 reads $3,420 spent
against a $3,413 typical — and the daily-tail category correctly shows less than
its typical, because only 11 days of it have happened.

## 2026-08-16 - Back to four across; Where It Went splits pie / words

Edited: `owner-vite/src/pages/Budget.tsx`.

Reverted the two-row intelligence grid to **one row of four**. `auto-fit`
collapses empty tracks, so four children means four equal columns — ~453px each
on a 1878px monitor, not the 280px minimum. Both graphic cards are sized for
that width rather than assuming it:

- **Spend Pace** viewBox 680x250 -> **450x235**. With `preserveAspectRatio` the
  whole SVG scales to the card, so an 11px label inside a 680-wide box rendered
  at 418px came out at ~7px. At 450 the viewBox is ~1:1 with the card and the
  axis text renders at the size it says.
- **Where It Went** is now pie on one side, words on the other, both `flex`
  rather than a fixed pie width, so the split holds as the card resizes.

The split is 1 : 1.15 in favour of the words, not a straight half. A true 50/50
leaves 67px for the label column at this card width, which puts "Car expenses"
straight back into an ellipsis — the clipping this card was fixed for two
changes ago. At 1:1.15 the pie is 190px and the label column 101px, which fits
every current category name.

Paying for that: the share-of-total column is gone (the pie already encodes it)
and the delta keeps only its percentage. Both dollar figures moved into the row
tooltip, which now reads "Car expenses: $445 · 14% of spend · typical month
$645 (−$200)" — the precise number belongs there once the column is 38px wide.

## 2026-08-16 - Cash Flow labels were being sliced; Projection tab removed

Edited: `owner-vite/src/pages/Budget.tsx`.

**Every x-axis label on the Cash Flow chart was losing its last character** —
"8-12" rendering as "8-1", "8-28" as "8-2". Each label sits in its own flex
cell with `overflow: hidden`, and at 17 active days across that card a cell is
~25px while a day label is ~30px. It had nothing to do with the card being too
narrow; the label simply never fit its own cell.

Two changes: labels are thinned by bucket count (`labelEvery` — every 2nd at
>10 buckets, 3rd at >16, 4th at >24) and the survivors may overflow their cell,
since their neighbours render an empty string and there is nothing to collide
with. Measured across 10/14/17/22/31 buckets the gap between shown labels is
55-98px against a ~30px label, so nothing overlaps at any bucket count.

**The In/Out legend was drawn twice** — once in the card header, once inside
`CashFlowBars` below the plot. Removed the inner one.

**The chart now fills the card.** It was a hard-coded 240px sitting next to a
~600px calendar, leaving a third of the card empty; `CashFlowBars` takes a
`height` prop now and the overview passes 430.

**Removed the Calendar / Projection toggle** from the Cashflow Calendar, along
with `ProjectionChart`, `Segmented` and `smoothPath` — all three existed only
to serve that toggle. Worth noting for the record that I ported the projection
back in earlier today on the grounds that dropping it looked accidental. It
wasn't; it was not wanted. The code is in git history if it is ever missed.

## 2026-08-16 - Where It Went: each category against its own typical month

Edited: `owner-vite/src/pages/Budget.tsx`.

Spend Pace got a typical-month benchmark; the category card did not, so it
still answered "Rent was $2,240" without the half that matters — whether
$2,240 is normal for Rent. Every legend row now carries a delta against what
that category costs in a typical month.

`categoryAvg` averages `yearRows` by month and category, excluding the month on
screen. A category missing from a past month counts as a zero for that month,
which is right here: the register covers every month it has rows for, so absent
means nothing was spent, not that nothing is known. That is the opposite of the
rule on the Categories grid, where the source is imported statements and a
missing month genuinely IS unknown — the two divisors differ because the two
data sources mean different things by "missing".

Shown as ▲/▼ with the dollar gap and the percentage, red over / green under,
with the exact typical figure in the row's tooltip. The donut centre picks it up
too: hovering a wedge shows "usually $440" under the label, and with nothing
hovered it shows the typical month's total under the month's own.

Two cases deliberately not dressed up as signal:

- **A category with no history reads "new"**, not "+100%". Its first month has
  nothing to be over or under.
- **The column only appears on the monthly view.** On a 7-day window a
  "vs typical month" delta would be comparing a week against a month and would
  read massively under every time.

Checked against the shape of the current month: Rent 2,240 vs 2,240 typical
(0%), Car expenses 445 vs 440 (▲1%), debt payoff 302 vs 291 (▲4%) — small
honest numbers rather than the noise a percentage-only column would produce.

## 2026-08-16 - Spend Pace benchmarked against a real month's shape, not a straight line

Edited: `owner-vite/src/pages/Budget.tsx`.

**The badge was always red and that was the chart's fault, not the spending's.**
Rent, the car and the debt payment clear in the first five days, so cumulative
spend jumps most of the month's total before the 6th and then crawls. Measured
against a straight-line budget ramp that is "OVER $1,654" on the 16th of every
month, forever. A warning that never turns off is not a warning.

The benchmark is now the average of the **prior months' own day-by-day
curves** — the rent step is in the reference line too, so the comparison is
like for like. Built from `yearRows` (already loaded on this tab), excluding
the month being drawn, and resampled onto the loaded month's length so a
28-day February lines up with a 31-day March by position rather than by index
— otherwise February contributes nothing to days 29-31 and drags the tail
down.

On the numbers in front of me the difference is the whole point:

| day | typical month | straight ramp |
|-----|---------------|---------------|
| 1   | $2,240        | $134          |
| 5   | $2,974        | $668          |
| 16  | $3,475        | $2,138        |
| 31  | $4,142        | $4,142        |

$3,825 spent on the 16th reads **+$1,687 over** against the straight line and
**+$351 over** against the shape. The second number is the one worth acting on.

The badge now says which reference it used — "OVER $351 vs avg", falling back
to "vs budget" when there is no history to average. The straight budget line is
still drawn, demoted to a faint dash, because what you intended is still worth
seeing next to what you do.

Also added a hover: a guide line with the day's actual and the typical month's
value at that same day, so any point in the month can be checked, not just
today.

## 2026-08-16 - Spend Pace and Where It Went get the width they needed

Edited: `owner-vite/src/pages/Budget.tsx`.

The intelligence row was four cards on one line at `minmax(280px, 1fr)`. Two of
them are stat lists and read fine narrow; two are graphics that were being
crushed. **Where It Went's legend was clipped** — `overflow: hidden` on the
legend column plus a 32px percentage cell meant "73%" was cut in half at the
right edge.

Now two rows: Safe to Spend + Weekly Balance Check at `minmax(260px)`, then
Spend Pace + Where It Went at `minmax(430px)` — roughly double the width each.

- **Spend Pace** was a 300x132 viewBox with `preserveAspectRatio="none"`, which
  stretches the axis text horizontally as the card grows. Redrawn at 680x250
  with proportional scaling, real padding, 11px axis labels and a label every
  ~3 days instead of every ~5.
- **Where It Went**: donut 132px -> 168px, centre readout up to 19px, legend
  shows 8 rows instead of 6, and the amount/percent cells are fixed-width so
  they form a column instead of drifting with label length. The `overflow:
  hidden` that did the clipping is gone; the label span already ellipsises.

## 2026-08-16 - Budget vs actual now on BOTH Categories tabs, from one component

Added: `owner-vite/src/pages/budget/CategoryBudget.tsx`.
Edited: `owner-vite/src/pages/budget/RealMonth.tsx`, `owner-vite/src/pages/Budget.tsx`.

There are two tabs called "Categories" on this page and I put the grid in the
wrong one. Page level: Overview / Payments / Real Month / **Categories** /
Amazon / Bzila / Yearly — where categories are created and budgeted. Inside
Real Month: Merchants / Where it went / Ledger / **Categories** /
Subscriptions — where I put it, because that is the component that already
loads the statement rows. Convenience of the data, not where anyone looks.

It is now on both, rendered from **one** component.

`CategoryBudget.tsx` owns the whole block: the month x category grid with
editable budgets, the three status counters, and the trend chart. The
derivation is two pure functions (`buildCategoryTrend`, `buildBudgetGrid`), so
the definition of "average" — total over months that HAVE a statement, not
months the category happened to appear in, not the whole axis — exists exactly
once. Two copies of that rule would have drifted the first time either was
touched, and the two tabs would quietly disagree about what Groceries costs.

The data is optional-injected. RealMonth already holds the `/api/budget/real`
response and passes `trend` + `months` straight in; the page-level tab passes
nothing and the component fetches once for itself. Two callers, one request
each, never both. Confirmed in the bundle: "Budget vs actual" appears exactly
once in the emitted chunk.

On the page-level tab it sits ABOVE the category editor, because "what should
this budget be" is answered by the twelve months of actuals sitting next to it.

RealMonth lost ~460 lines to the move and now imports `DONUT_RAMP`,
`DONUT_NEUTRAL` and `UNCATEGORIZED` from the new module rather than declaring
its own — the donut and the trend were already required to agree on hue, and
they now do so by construction.

Verified: `tsc --noEmit` clean for both new/edited budget modules (Budget.tsx
still carries its 7 pre-existing errors, none added), `vite build` green.

## 2026-08-16 - Budget vs actual moved onto the Categories tab

Edited: `owner-vite/src/pages/budget/RealMonth.tsx`.

The month x category grid was given its own "Budget" pill in the Real Month
view switch. It belongs on **Categories** — that tab was already the place you
go to ask what a category costs, and splitting the answer across two pills
meant the budget you set in one place and the spend you read in the other never
appeared on screen together.

The Categories tab is now three cards, widest lens first:

1. **Budget vs actual** — every category across every imported month, monthly
   budget editable in place, average + status. The three counters (on track /
   watch it / over budget) sit above it.
2. **Category trend** — one category's month-over-month line against its own
   average and its budget.
3. **This month by category** — the loaded month with a transaction count.

The `budget` view was removed from the `View` union and the pill row, so the
switch is back to five: Merchants, Where it went, Ledger, Categories,
Subscriptions.

Two labels changed to survive the merge. The bottom card was subtitled "Real
spend against the budgets on the Categories tab" — which now points at itself;
it reads "Just the loaded month… the two cards above put it in context". And
the grid's "Manage categories" button is "Add / rename categories", because
"Categories" now means two different things one word apart: this sub-tab, and
the page-level tab where categories are created and coloured. The button still
goes to the page-level one.

Verified: `tsc --noEmit` clean for RealMonth.tsx, `vite build` green, and the
emitted `Budget-*.js` chunk carries "Budget vs actual", "Category trend" and
"This month by category".

## 2026-08-16 - Correction: owner-vite IS deployed (owner.cbedge.net), + Balance Projection restored

Edited: `owner-vite/src/pages/Budget.tsx`.

**Correcting the previous entry's premise.** Earlier today I concluded that
`owner-vite/` was dead code because the root `Dockerfile` builds only
`app-vite`, `next.config.js` has no `/owner` rewrite, and
`server-with-proxy.js` never mounts it. All three of those are true and all
three are beside the point: **`owner-vite` has its own Dockerfile and its own
compose service.**

```yaml
owners:
  build:
    context: ./owner-vite      # node build stage -> nginx
  ports:
    - "127.0.0.1:8082:8082"    # Cloudflare Tunnel -> owner.cbedge.net
```

So the owner budget page lives at **owner.cbedge.net/owner/budget**, not
`cbedge.net/owner/budget`. The latter is the OLD Next route
(`app/owner/budget/page.tsx`), still served, still reachable, and a genuinely
different page: it has no Real Month tab and reads `budget_register` rather
than `budget_statement_tx`. Two budget pages on two hostnames, and the URL is
the only thing that tells them apart. That is the trap; it caught me and it is
worth a note here for next time.

Verified by building it: `npm ci && npm run build` in `owner-vite` is green,
and the emitted `Budget-*.js` chunk contains "Budget vs actual", "Category
trend", "CRUSHED IT" and "Avg month" — so the previous entry's work does ship.

**Balance Projection is back.** The port out of the Next route dropped
`ProjectionChart` — the running combined balance across the month with a hover
guide and tooltip. Its `smoothPath()` helper came across and then sat unused,
which is exactly how the omission surfaced: `tsc` had been reporting
"'smoothPath' is declared but its value is never read" and nobody had asked
why.

It is restored on the right-hand overview card behind a Calendar / Projection
toggle (`Segmented`, also ported back), matching the Next layout. The calendar
answers "what happens on the 14th"; the projection answers the one it cannot —
"does the balance go negative before payday" — which is a shape, not a cell.

Also removed the unused `range` prop from `SpendPaceCard` while in there. Net
effect on `tsc --noEmit`: 11 pre-existing errors down to 7, none introduced.

## 2026-08-16 - Budget: month-over-month category history, a Budget tab, and a Spend Pace that answers a month-shaped question

Edited: `server-v2/_lib-db.cjs`, `server-v2/api-router.js`,
`owner-vite/src/pages/budget/RealMonth.tsx`, `owner-vite/src/pages/Budget.tsx`.

Real Month could only ever see one month. Every number it showed answered "what
did this month cost" and none of them answered the question that always follows
it - **is that normal?** Three changes, one new data path underneath all of them.

**The data path.** `listStatementCategoryTrend()` rolls `budget_statement_tx` up
to one row per (month, category), outflow only - a refund posts as `direction
'in'` against the same category and would otherwise punch a hole in the curve
that reads as "you stopped buying groceries in March" rather than "one thing got
returned". `GET /api/budget/real` now returns it as `trend`, windowed to the 11
months before the loaded month plus itself. The window is anchored to the LOADED
month, not to today, so scrolling back to March shows March's run-up instead of
a curve that stops a year ago with the selected month off the right edge.

**Category trend** (Categories tab). Pills across the top pick a category; the
chart draws its spend month over month against two reference lines - its own
average, and the budget it was given. Hue is bound to the category's stable id
order, the same rule the donut uses, so a category is the same colour on both
charts. **A month with no statement imported breaks the line rather than
plotting a zero** - an unimported month and a month where you genuinely spent
nothing are the same zero in the totals and mean opposite things, and drawing
the first as the second invents a cliff that never happened.

**Budget tab** (new, between Categories and Subscriptions). Every category as a
row, every month as a column, monthly budget editable in place, average and
status on the right, and three counters on top: on track/under, watch it, over
budget. Two decisions worth naming:

- **The edit writes through to `budget_categories`** (upsert on name - the same
  write the Categories tab makes), not to localStorage. A budget set here is the
  budget everywhere, not a copy that lives in one browser and silently disagrees
  with the rest of the app.
- **Status reads the AVERAGE, never the latest month.** One expensive week is
  not a broken budget, and a row that flips red every time a quarterly bill
  lands teaches you to stop reading the colour. Bands are avg/budget: <=0.6
  crushed it, <=1.0 on track, <=1.15 watch it, above that over budget.

The average divides by **months that have a statement behind them** - not by
months where that category happened to see spend, and not by the whole axis.
Dividing by the months it appeared in would give the average size of a Travel
trip when what a budget asks is the average Travel cost per month, quiet months
included; dividing by the whole axis would count an unimported month as a zero,
which it is not. Both the tab and the trend chart read the one definition, so
they cannot disagree about what a category costs.

**Spend Pace** is now pinned to the selected month, day by day. It followed the
range tab, which on this page is "monthly" - so the card drew Jan-Dec against a
12x budget: a year-shaped answer sitting in a row of month-scoped tiles. It also
gained a second dashed ramp, **a typical month**, averaged over the months of
the year that have spend, excluding the month being drawn (averaging a
half-finished month into its own benchmark flatters it). That line is the useful
half of the card: a budget that was never once hit stops being information,
while "ahead of a normal month by $310 on the 14th" always is.

## 2026-08-16 - Ticker Lookup: "The read" no longer buried under the ladders

Edited: `components/pages/Analytics.tsx`.

The Ticker Lookup split gives its two panes a fixed height so the level chips
stay pinned and stop sliding with ladder length. That height was being ignored:
a grid item's automatic minimum size is its CONTENT, so each pane grew to the
full ladder, overflowed the container, and painted straight over the
plain-language **The read** paragraph, the OI+Vol disclaimer and the Updated
stamp underneath it.

Fix is two lines: `gridTemplateRows: "minmax(0, 1fr)"` on `.tl-split` and
`minHeight: 0` on both pane columns. With the automatic minimum released, the
fixed pane height is honored and the overflow lands where it was always meant to
- the inner ladder scroller (`flex: 1; minHeight: 0; overflowY: auto`). The read
block and the disclaimer now sit below the panes, unobstructed.

## 2026-08-16 - Intensity at minimum now means "levels only" (CB / CW / PW)

Added: `lib/calculations/heatLevels.ts`.
Edited: `components/shared/homeTheme.ts`,
`lib/calculations/optionChain.ts`,
`components/dashboard/es-candles/chartMath.ts`,
`app/mult-greek/MultGreekClient.tsx`,
`components/pages/OptionsChain.tsx`,
`components/dashboard/es-candles/EsChartCard.tsx`,
`components/dashboard/es-candles/ChainRail.tsx`.

Every Intensity slider in the app scaled the same thing - a per-column gamma
wash behind the numbers - and every one of them wasted its bottom half. Dragged
to minimum the wash didn't switch off, it collapsed toward a uniform floor tint:
every strike still painted, all of them within a couple of percent of the same
alpha. That is the least readable position the control has, and it is exactly
the position people reach for when they want LESS noise on the grid.

**The minimum stop now means something.** At the bottom of the track the heat
field is dropped entirely and only the three named levels stay lit:

- **CB** - Core Bullseye, the largest |net| strike in the column (sign-blind)
- **CW** - Call Wall, the largest +net strike
- **PW** - Put Wall, the most -net strike

CB claims its strike first; CW and PW skip it, so three labels always name three
DISTINCT strikes instead of printing one level twice. Same rule `computeWalls()`
and `deriveColumnLevels()` already used - it now lives in one module
(`lib/calculations/heatLevels.ts`) so the four surfaces that host a slider can't
drift into four different answers for "which strikes survive at the bottom".

The value readout says `LEVELS` instead of a multiplier when the slider is
there, so the mode is legible without hovering.

### The surviving cells stay HEAT-coloured

They are painted at the heat scale's three fixed rank floors - CB at rank 1, CW
at rank 2, PW at rank 3 - so a wall is still cyan when its gamma is positive and
red when it's negative, exactly as at any other slider position. Only the alpha
tiers say "these three are the levels".

Filling them gold / blue / red to match the CB/CW/PW badges was the obvious
first move and it was wrong twice over: it threw away the SIGN, which is the one
thing a gamma cell must never stop saying, and it made a Put Wall and an
ordinary red heat cell two different shades of red for two unrelated reasons.
The badge names the level; the fill says how much gamma and which way.

Those floors are now exported rather than inlined three times - `rankBg()` +
`RANK_FLOOR_ALPHA` in `lib/calculations/optionChain` (0.90 / 0.45 / 0.25, used by
the chain grid, the ES rail and Multi Greek's own `metricBg`), and
`gexRankColor()` + `GEX_RANK_ALPHA` in the ES card's `chartMath` (0.90 / 0.55 /
0.35, held higher because that heatmap composites at 0.6 over the candles).
`metricBg()` and `gexColor()` call them for their top-3 branch, so the normal
mode and levels-only mode literally cannot disagree about what a rank-1 wall
looks like.

### Per surface

- **Multi Greek** (`min 0.5`) - walls are computed for EVERY column in this
  mode, not just the front one. The badges stay front-only in normal mode
  (deliberate, for clutter), but with the field off, an unmarked column is a
  blank strip of numbers. The CB/CW/PW toolbar toggles are still honoured: a
  level switched off does not come back because the slider hit bottom. The
  rank-1 ring and the gold peak star are part of the heat field, so they go with
  it.
- **Option chain grid** (`min 0.5`) - walls read through `valueAt()`, so they
  follow the active greek tab exactly like the heat scale does. The Sigma Total
  column is ranked as its own series. Change / delta columns are left bare -
  "the wall" is a statement about gamma, not about a 15-minute delta.
- **ES Candles heatmap** (`min 0.1`) - ranked per stored column on the active
  metric through `valOf()`, so the marks track the Vol+OI / Vol toggle.
- **ES chain rail** - follows the card's slider off the same value, ranked over
  the same visible rows, so the two panels never describe different ladders.

### Notes

- `LEVEL_COLORS` in `homeTheme` is unchanged and stays what it always was: BADGE
  colours, for saying which level a strike is. Its doc comment now says so
  explicitly, since filling a cell with them is the tempting wrong move.
- The intensity CURVES (`metricBg`, `gexColor`) are otherwise untouched, and the
  levels-only gate sits at the call sites - so the maths stays honest and this
  mode is a branch you can see rather than a special case buried in an alpha
  formula.
- Not touched: `GexHeatmap.tsx` and `EsCandlesFullPanel.tsx` carry the same
  curve but have no slider (fixed 1.4 and 0.65), so they can never reach a
  minimum stop.

---

## 2026-08-16 - ES Candles: the GEX bubbles get an absolute scale, and lose their sliders

Edited: `components/dashboard/es-candles/chartMath.ts`,
`components/dashboard/es-candles/slotStore.ts`,
`components/dashboard/es-candles/EsChartCard.tsx`.

Two changes, and the second is the reason the first is possible.

### 1. Bubble size is now measured against ONE reference for the expiration

The size scale used to be self-normalising in two directions at once. The top of
the domain was the session's running maximum; the BOTTOM was the weakest strike
shown in that particular column. So every column was re-stretched to its own
range, and a quiet 11:00 ladder drew almost exactly like a loud 14:00 one. Two
bubbles on the same chart were not comparable, which is the one thing a trail of
bubbles across a session is for.

**Now:** one reference for the whole expiration - the biggest |net GEX| the board
has carried this session - and every bubble on the chart is placed against it on
a fixed log domain 1.5 decades wide. The strike holding the most gamma draws the
biggest mark; a strike with a tenth of it draws the same size at 09:45 as it
would at 15:15. A bubble changes when ITS gamma changes and never because a
neighbour's did.

The reference is still EXPANDING (frozen at print time), so nothing already on
screen can resize when a bigger wall shows up later.

### 2. 3:00-4:00 is handled by a measured profile, not a cliff

Gamma at the top strike is not stationary through the day - it climbs all
session and then runs away into the close as dealer gamma collapses onto two or
three strikes. The old code dealt with that by refusing to let any minute from
15:30 on touch the scale (`BUBBLE_SCALE_CUTOFF_MIN`). That stopped the close
from squashing the morning, but it also meant the last half hour carried no size
information at all: every closing wall clamped to the same maximum, so a genuinely
enormous 15:50 pin drew exactly like an ordinary one.

That constant is gone, replaced by `gexTodScale()` in `chartMath.ts` - the
expected |GEX| of the biggest strike at a given ET minute, as a multiple of its
midday level. The reference is carried in DETRENDED units and put back on the
clock per column, so a 15:50 wall is judged against what 15:50 normally looks
like instead of against noon.

**It is measured, not guessed.** Derived from `gex_strike_history.csv` at the
repo root - 1.25M per-strike $SPX rows over the six full sessions 2026-07-10 to
2026-07-17. Per minute, the largest |net_gex| on the board; divided by that day's
own 10:00-14:00 median; median across days. The shape came out monotone and
tight day to day:

```
09:30 0.73    11:30 1.00    13:30 1.33    15:20 2.59
10:00 0.81    12:00 0.97    14:00 1.63    15:30 2.85
10:30 0.83    12:30 1.02    14:30 2.01    15:50 3.10
11:00 0.85    13:00 1.15    15:00 2.24    16:00 3.42
```

The biggest strike into the bell carries ~4.7x the gamma it carried at the open,
every session, whatever the tape did. Re-derive it the same way if it ever drifts;
the anchors in the file are lightly smoothed to stay monotone.

### 2b. The ladder is stretched so the ranks are actually distinguishable

An absolute scale is faithful but, on its own, unreadable. A real chain's top
five strikes genuinely sit within ~2.3x of each other in |net GEX|, so a straight
log mapping drew them at **6.0 / 5.1 / 4.4 / 4.2 / 4.0 px** - a 1.5:1 spread
across the whole visible ladder, i.e. "they all look the same". That is not a bug
in the scale; reading a hierarchy needs the mapping to stretch on purpose.

So `BUBBLE_STYLE.curve` squares the log ratio, and the overall budget goes from
7px to 12px. Same five strikes now draw **8.7 / 6.4 / 4.8 / 4.3 / 3.9 px** -
2.2x on radius, ~5x on AREA, which is the channel the eye actually compares. Size
is still strictly monotone in |net GEX|, so a bigger dot is still always more
gamma; only the contrast changed.

This is not the old `curve` slider coming back. It is one calibrated constant, in
one place, and it is the number to move if the ladder ever reads flat again.

`maxPx` is additionally bounded by `rowPitch x 0.55`. Rows sit at fixed prices, so
on a zoomed-out chart the strikes can be ten pixels apart and a 12px mark would
swallow its neighbours; the whole ladder scales down with the pitch instead,
which keeps the ratios - the actual encoding - untouched. The old vertical clip
at half the strike pitch was the opposite: it flattened the top of the ladder
onto a cap while leaving everything under it alone. On a normally zoomed chart
the pitch is far wider than this and `maxPx` simply wins.

Bigger marks mean the anti-overlap stride opens up, so a row is a sparser line of
larger dots than before. That is the intended trade - the gaps are what let
several rows sit over the candles without burying them.

### 3. Every slider in the Overlays menu is gone

Top / Highlight / Contrast / Size / Max / Curve / Brightness, plus the
"Save default" and "Reset" buttons under them. They existed because the scale
they were sitting on top of never looked right two days running, so the numbers
had to be re-tuned by hand against whatever was on the screen. With an absolute
scale there is nothing left for them to correct.

They are replaced by `BUBBLE_STYLE` in `slotStore.ts` - a frozen style, with the
numbers taken off the same six sessions rather than nudged by feel:

| | | why |
|---|---|---|
| `topStrikes` | 5 | the design law: three to six rows, never sixteen |
| `highlight` | 1 | one wall, colour + glow only - it never touches radius |
| `maxPx` | 12 | radius of a strike sitting AT the reference (bounded by `rowPitch x 0.55`) |
| `curve` | 2 | the separation knob - squares the log ratio so the ranks pull apart |
| `minPx` | 0.6 | hard floor, so a wing strike stays a visible speck |
| `decades` | 1.5 | measured: rank-5 runs a median 0.44 of a column's top (p10 0.27), and a column's top a median 0.345 of the session reference - so the visible ladder spans ~1.5 decades |
| `fade` | 0.55 | opacity gradient, so magnitude reads in size AND brightness |

`topBoost` - the top-of-ladder multiplier - is deleted outright, not defaulted:
it weighted by the 4th power of a strike's rank ratio, which bent size away from
gamma for reasons that had nothing to do with gamma. `curve` survives as a
constant because it is a contrast control on a monotone mapping, not a
re-ranking (see 2b).

What the Bubbles sub-panel keeps: the **Bucket** (Bar / 1m / 5m) and the
**CB line** toggle. Both are genuine preferences rather than corrections.

The heatmap's `intensity` slider in the dock is untouched - it is not in the
Overlays menu and controls a different overlay.

### Migration

Old slot blobs still hold the seven slider keys. They are simply never read
again - nothing deletes them, so a rollback finds the user's setup where it
expects it. The legacy pre-multi-card migration no longer seeds them into fresh
slots. `es-candles-bubble-default-v1` survives only because `presetStore` still
snapshots it; the card no longer writes it.

Simulated across all six sessions, the top-5 marks hold a median
**8.7 / 6.4 / 4.8 / 4.3 / 3.9px** ladder from 09:30 to 16:00, with no blowout into
the close and no collapse at the open.

## 2026-08-16 - Options Flow: stop inventing timestamps, stop asserting moneyness

Edited: `server-v2/proxy-tastytrade.js`, `server-v2/computation/flow-processor.js`,
`server-v2/flow-print-time.selftest.js`.
Added: `server-v2/scripts/flow-prune-offhours.js`.

The /flow page on a past session looked like the feed had died mid-morning. It
had not. Two separate bugs were writing data that could not be true, and the
page was rendering it faithfully.

### 1. A print with no exchange time was stamped with the ingest clock

`stampFlowTime()` fell back to `Date.now()` whenever a dxLink TimeAndSale
arrived without a usable `time`. dxLink replays a contract's recent tape every
time a subscription is (re)established, and those replayed prints often carry no
time - so each replay wrote the print AGAIN, stamped with the moment of the
reconnect rather than the moment of the trade.

That produced rows that are impossible on their face. SPX options trade
09:30-16:15 ET; prod held SPX prints at 00:00, 02:00, 05:00, 22:00. On
2026-08-14 the 16:00 ET hour alone held **711 prints - more than the entire real
session (~280)**, which is the post-close reconnect dumping the day back into
the table.

It also quietly defeated deduplication. `flow_prints`' primary key is
`(ts, symbol, side)`, so a re-delivered print is supposed to land on the row it
already wrote. Re-stamping changed `ts` - the very column the key rests on - so
every replay inserted a fresh row. One $6.61M SPX print exists at hours 00, 01
and 08 of the same day; hours 05 and 07 of 2026-08-14 are byte-identical
aggregates (35 prints / $53,600K) of a single batch. Premium totals on the page
were inflated by whatever the replay count happened to be.

**Now:** `stampFlowTime()` returns `null` for an unusable time and the
TimeAndSale handler drops the print. A print with no exchange time carries no
information about WHEN it happened, and when is the entire point of a tape -
guessing writes a lie nothing downstream can detect, while dropping loses a row
that could never have been placed correctly and lets the primary key do the
dedup it was designed for.

Drops are counted and logged at most once a minute (`[FLOW-TIME] dropped N
print(s)...`). Silently discarding prints is exactly the change that must stay
visible if the feed ever stops sending `time` wholesale, since /flow would
otherwise go empty with no error at all. `FLOW_TS_REQUIRE_EXCHANGE=0` restores
the old fallback without a deploy.

### 2. `is_otm` claimed "in the money" whenever spot was unknown

`FlowProcessor.addPrint()` computed `isOtm` as `false` when the tracked
underlying spot was 0. `false` is a CLAIM - it says the print was in the money -
and with no spot there is nothing to make that claim from.

On 2026-08-14 the tracked spot sat at 0 through the middle of the SPX session,
so **every print from 10:00-15:00 ET was written `is_otm = false`**. With
MONEYNESS set to OTM the page then filtered out the whole midday session, and
Net Drift flatlined from 09:52 to the close on a day that had 118 prints in
hours 10 and 11. The chart was correct; its input was not.

**Now:** `null` when spot is unknown. An `is_otm = true` filter still excludes
it - correctly, the moneyness is genuinely unknown - but the row no longer
asserts the opposite, and a real ITM print is distinguishable from an untagged
one in the table. `flow-history-writer.js` already persisted a non-boolean as
SQL NULL, so no writer change was needed.

### 3. Cleanup for the rows already on disk

`server-v2/scripts/flow-prune-offhours.js` removes prints whose timestamp falls
outside the instrument's real trading window - 09:30-16:15 ET for index roots,
04:00-20:00 ET for everything else, plus all weekend rows. That rule is provable
rather than heuristic: an SPX option cannot print at 02:00 ET, so such a row is
fabricated by definition.

```
docker compose exec dashboard node server-v2/scripts/flow-prune-offhours.js \
  --from 2026-08-01 --to 2026-08-15          # dry run, prints a per-day breakdown
docker compose exec dashboard node server-v2/scripts/flow-prune-offhours.js \
  --from 2026-08-01 --to 2026-08-15 --apply  # actually deletes
```

**Dry run by default.** It deliberately does NOT collapse in-window duplicates
by `(symbol, side, price, size)` - two genuine fills of the same contract at the
same price and size in one session are ordinary, and deduping on that shape
would destroy real prints to remove fake ones. Those are reported and left
alone.

### Worth knowing

**SPX has no recorder backstop.** The boot log reads
`[TT-MULTIFLOW] streaming SPY, QQQ` and `[FLOW-RECORD] recording SPY, QQQ, AAPL,
...` - SPX is in neither roster. It rides only the `_syncTimeSaleWindow`
TimeAndSale subscription, so if that window drops mid-session SPX flow simply
stops with nothing covering it. Separately, SPX volume in `flow_prints` runs
200-400 prints/day, orders of magnitude below the real 0DTE tape;
`proxy-tastytrade.js:4518` describes the strike-growth feed claiming SPX's ATM
band and discarding its prints. Both are still open.

**The netprem cache holds per-date bins in memory.** `_netPremCache` in
`server-with-proxy.js` treats any past date as immutable, so after pruning rows
the /flow chart keeps painting the old shape until the container restarts.

## 2026-08-14 - Ticker Lookup: CB / CW / PW mark their row

Edited: `components/pages/Analytics.tsx` (`TlLadder`).

A level strike now says so two ways on one row:

- a **named tag** beside the strike - `CB` / `CW` / `PW` - replacing the
  anonymous coloured dot. Three dot colours is a legend to memorise; "CB" is not.
- a **faint wash** across the row, plus a hairline in the same colour.

The BARS are left alone - no outline, no glow. Both were tried and both fought
the one thing a bar exists to say, which is magnitude and sign. The level is
said by the row it sits in and the tag beside the strike.

### Worth knowing

**Spot outranks a level on the row chrome.** A strike that is both spot and a
level keeps the cyan row border and cyan background - "where price is" must
never be ambiguous - and still gets its tag and its lit bar.

A strike can be more than one level (core and call wall coincide often): every
match gets a tag, and the row tint takes the first by priority CB -> CW -> PW.

## 2026-08-14 - Ticker Lookup: level chips stop moving, three of them, bigger

Edited: `components/pages/Analytics.tsx`.

### The chips stopped moving

The CB / CW / PW chips slid down the page every time the ladder above them
gained a rung, and with a different strike count on the left than the right the
two panes' chips didn't line up with each other either.

The split now has a FIXED height (`clamp(460px, 64vh, 900px)`), the LADDER
scrolls inside each pane (`flex: 1; minHeight: 0; overflowY: auto` - the
`minHeight: 0` is what lets it shrink in the flex column instead of pushing the
chips out the bottom), and `TL_CHIP_ROW`'s `marginTop: auto` pins the chips to
the pane floor. Ladder length no longer moves anything.

### Gamma flip chip removed; the other three got bigger

Three chips, not four. `minmax` in the chip grid 120 -> 150px so three don't
wrap to two rows on a narrow pane, and the type went up across the board: name
10 -> 12, value 19 -> 26, distance and note 11 -> 13, `TL_CHIP_MIN_H` 92 -> 106.

Gamma flip is still computed and still stated in the plain-language read under
the split - it just no longer takes a quarter of the chip row.

### Mockup: level colour on the bar

`generated/2026-08-14-tl-level-outline-mockup.png` - the same SPX ladder three
ways: A today (small square beside the strike), B the bar outlined in the level
colour, C outline + glow + a faint row tint. Not applied to the page; it is a
decision aid.

One thing the render makes obvious: on a SMALL bar (CB at 7810) a 2px outline is
most of the bar, so the mark reads as a hollow box rather than a highlighted
value. If B or C ships, the outline wants to be 1px under some width, or drawn
just outside the bar.

## 2026-08-14 - Multi Greek: one panel's ATM row drifting out of line

Edited: `app/mult-greek/MultGreekClient.tsx`.

### What

SPY's ATM row wandered up and down a row at a time while SPX/QQQ/TSLA sat still.
With four ladders side by side the ATM row is the reading anchor - if it is not
at the same height in all four, the eye has to re-find "where is price" in each
panel before it can compare anything.

### Why

Two bugs stacked.

1. **The latch fired on gestures that moved nothing.** `userScrolledRef` was set
   by any `wheel` or `touchstart` over the panel body - including wheeling the
   PAGE with the cursor parked over a panel, or wheeling one already at its end
   stop. One stray wheel over SPY was enough.
2. **The latch was permanent.** Once set, that panel never auto-centred again.
   Every chain update adds and drops strikes at the ends of the ladder, so the
   rows slid underneath a frozen `scrollTop` - one row at a time, which is
   exactly what "moves up and down" looked like.

The other three panels kept re-centring, so only the panel that caught the wheel
drifted. Nothing about SPY specifically.

### How

- The latch now marks only when the gesture ACTUALLY moved the panel: capture
  `scrollTop`, compare it a frame later. Nothing re-renders on a wheel, so a
  change in between can only be the user. (`touchstart` -> `touchmove` for the
  same reason - a tap is not a scroll.)
- The latch is scoped to the ladder it was made on, keyed by
  `atmStrike | row count | top strike`. Scroll away and the panel stays where
  you put it; when the ladder itself changes, the position you chose no longer
  refers to anything, so it re-centres. Deliberate re-reads survive, drift
  cannot. The reset effect is declared BEFORE the centring effect so it clears
  the latch in the same commit the new ladder lands in.
- `scrollTop` is rounded. Four panels each landing on their own fraction of a
  pixel is four rows that don't quite line up.

## 2026-08-14 - Replay gets a toolbar tile

Edited: `components/shared/GlobalToolbar.tsx`.

`{ href: "/replay", label: "Replay", emoji: "⏱️" }` added to `NAV_ITEMS`,
next to Analysis - it is the same reading, made after the fact.

Note for anyone who wonders why it is not there: `GexGroupNav` hydrates the strip
order from localStorage and APPENDS items it has never seen, so an existing user
gets the tile at the END of their strip, not beside Analysis, until they drag it.
A fresh profile sees it in the declared position.

`check-routes.mjs --dry` confirms `nav /replay -> has route`; the Next shell
handler `app/app/replay/route.ts` was already in place.

## 2026-08-14 - The identity line moves onto the cards, and Multi Greek gets one

Edited: `components/pages/Analytics.tsx`, `app/mult-greek/MultGreekClient.tsx`.

### GEX levels: identity line drops below the replay transport

It was in the card header. Wrong place: that line is the one a screen capture
has to contain, and up in the header it was one crop away from being left out.
It now sits directly on top of the two ladders, under the replay bar, with a
hairline rule under it.

Order reads as cause then effect: the controls change what is drawn, the replay
bar scrubs it, the identity line states what got drawn.

The card header is now just the toolbar - ticker menu, refresh, replay toggle,
CB Edge mark - right-aligned. `showStatus` is gone: the line lives inside the
branch that already guarantees data, so the guard was restating its own
condition.

### Multi Greek: the same band, above the four cards

New line under the replay transport and directly on top of the panels, carrying
the same kinds of fact as the lookup card's: `MULTI GREEK`, each ticker with the
SPOT its panel is drawn from (the recorded sweep's spot while rewound, not the
live quote), the front expiry + DTE, the session on screen, the replay clock,
`recorded walls only` when rewound, and the mark on the right.

The front expiry comes from the first ticker's front column, labelled off the
REPLAYED date while rewound - counting DTE from today would mislabel every
rewound header. Rendered in capture mode too, so exported PNGs carry their own
context.

## 2026-08-14 - Replay tabs open rewound; Ticker Lookup collapses to one identity line

Edited: `components/pages/Replay.tsx`, `components/pages/Analytics.tsx`,
`components/pages/OptionsChain.tsx`, `app/mult-greek/MultGreekClient.tsx`.

### Every /replay tab opens already rewound

Three new INITIAL-STATE props - `TickerLookupCard({ initialReplay })`,
`MultGreekClient({ initialReplay })`, `OptionsChainPage({ initialReplay,
initialReplayScope })`. Initial state only: each page's own replay toggle still
works exactly as before, and every other mount of these components is unchanged
(all default to false / "all").

Making the user press the replay toggle on a page called /replay is asking them
to confirm the thing they navigated to.

Options Chain also opens scoped to **0DTE** - that tab is for watching the front
contract move. `replayScope` already existed with a `0dte` / `all` control; it
now takes its initial value from the host instead of being hardcoded to `all`,
so "all expiries" is still one click away.

### Ticker Lookup: three rows of context collapse into one identity line

The card said what was on screen in three places - a spot/gamma row under the
controls, the capture strip above the ladders, and the coverage caption over the
right ladder - so a screen recording had to include all three to be
self-describing.

One line now, in the card header beside `TICKER LOOKUP $SPX GEX levels`: spot,
the gamma-regime pill, `SPX - Aug 17 - 3DTE - <session date> - 09:30 ET`, the
`N expirations - excl. 0DTE (...) - recorded walls only` coverage line, and the
live-only ± Move / ATM IV. Gated on `showStatus` (not loading, not errored, has
rows) so the header does not report numbers the ladders are not drawing.

The CB Edge logo moved onto the toolbar with the picker / refresh / replay
buttons. The capture strip and the spot row are gone; three rows between the
controls and the ladders became zero.

### Replay transport moved under the ticker choices

Picking a symbol reloads the session, so the control that changes WHAT is being
replayed now sits above the one that scrubs THROUGH it. Reading order matches
cause and effect.

## 2026-08-14 - /replay is a hub: every replay, one page, four tabs

Edited: `components/pages/Replay.tsx` (rewritten).

### What

The replays were scattered and you had to remember which page hid which one:
chain ladder on /replay, GEX-levels ladders inside the /analytics Ticker Lookup,
the four-panel rewind inside /mult-greek, the full grid inside /options-chain.
/replay is now the place you go when replay itself is the thing you want.

Tabs: **Chain ladder** | **GEX levels** | **Multi Greek** | **Options chain**.

Nothing was removed from the original pages - rewinding in context is the point
of having it there. Every tab mounts the SAME component its page mounts,
imported not copied.

### How

Two shapes of tab, and the difference is the whole design:

- **Framed** (chain ladder, GEX levels) - small enough to sit in a `Card` inside
  this page's `PageShell`.
- **Full** (Multi Greek, Options Chain) - whole page components that render
  their OWN `PageShell`. Wrapping those in a second shell would double the
  padding and nest a scroller inside a scroller, so they get the tab bar and the
  rest of the viewport and nothing else. `minHeight: 0` on the column and the
  pane is what keeps their internal scroller from pushing the tab bar off-screen.

Everything but the chain ladder is `lazy()` - opening /replay should not pull
Multi Greek's and Options Chain's chunks before you pick them.

The tab lives in `#tab=<id>` so a tab is linkable and the back button works. Read
in an effect, never in the `useState` initializer - the Next server render has no
`location` and has to agree with the first client render.

Dropped the hardcoded `symbol="MSFT"` on `<ChainReplay>`. It already falls back
to MSFT-if-recorded, else the first recorded symbol, and carries its own picker;
the prop was just a second place to be wrong.

## 2026-08-14 - Ticker Lookup: capture mark above the ladders

Edited: `components/pages/Analytics.tsx`.

### What

Screen recordings of the lookup get cropped to the two ladders, and everything
identifying them - the symbol picker, the replay bar, the card title - sits
above that crop. The clip showed two GEX profiles and no ticker.

### How

A strip directly on top of the `.tl-split`, so any crop that includes the
ladders includes their identity: `SPX` in cyan on the left with the LEFT pane's
expiration beside it (`Aug 17 - 3DTE`, DTE counted from the replayed date while
rewound, same rule as the pills, plus `- replay <date>`), and the CB Edge logo
on the right at 30px.

`crossOrigin="anonymous"` on the logo, matching the footer, so html2canvas
exports bake it in instead of tainting the canvas.

## 2026-08-14 - Ex-0DTE header counts the profile, not the recording

Edited: `components/pages/Analytics.tsx`, `app/mult-greek/MultGreekClient.tsx`.

### What

The Ticker Lookup's right pane read "2 recorded expirations - excl. 0DTE" while
rewound. That number was the SESSION's recorded expiry list, which is a fact
about the recording, not about the ladder it sits beside. It now reports how
many expirations are actually in the GEX profile on screen, and it moves as you
scrub.

### How

- `tlReplayRows()` now also returns `used` — the expiries that put at least one
  cell into this frame's profile, in input order.
- `boardLabel` counts `replayRight.used` instead of `replayBoardExps`, and drops
  the word "recorded" from the count so it reads the same as the live header
  ("3 expirations - excl. 0DTE"). "recorded walls only" stays — that one is
  about strikes, and it is still true.
- New middle state: sweeps that carried nothing past 0DTE say so, and still
  report what the session holds, instead of showing a count no row supports.
- Multi Greek's ALL tooltip does the same, off `replayFrame.expiries`. Which
  COLUMNS exist stays session-level on purpose — a column set that appears and
  disappears mid-scrub is unreadable — but the count reported is per-sweep.

## 2026-08-14 - Multi Greek: the ALL (ex-0DTE) column survives replay

Edited: `app/mult-greek/MultGreekClient.tsx`.

### What

Rewinding a panel dropped the `ALL / EX-0DTE` total column. The recorded data
supported it the whole time — the `/analytics` Ticker Lookup builds the same
"ALL EXPIRATIONS - EX-0DTE" ladder off the same history and states its basis
("2 recorded expirations - excl. 0DTE"). Multi Greek just refused to draw it.

### Why it dropped

The total was gated on the panel having EXACTLY four columns
(`showEx0 = cols.length === MAX_EXP_COLS`). Live, `pickCols()` always hands over
four expiries, so the 4th slot gets swapped for the synthetic total. In replay
the columns come from what `strike-growth-recorder.js` actually stored, and that
is `EXPIRIES_PER_TICKER` (env `STRIKE_GROWTH_EXPIRIES`, default **3**). Three
columns, never four, so the gate never opened.

### How

Gate the total on the SUM being meaningful instead of on the column count:

- `ex0Dates` (the non-0DTE columns) is computed once and reused.
- `showEx0` is now true at a full 4-column set (live, unchanged) OR in replay
  when 2+ non-0DTE expiries were recorded. The 2+ floor is deliberate: a
  one-expiry sum would just duplicate that expiry's own column.
- `withEx0Column()` takes `replaceLast` (default `true`, so live is byte-for-byte
  what it was). Replay passes `false` — the total is APPENDED rather than
  swapping a column out, so a rewound panel shows its 3 recorded expiries PLUS
  ALL and keeps the same 4-column width as live. Nothing recorded gets hidden.
- `gridCols` now sizes off `displayCols`, not `cols`. Replay appends, so the two
  lengths differ there and a `cols`-sized track list would have left the new
  column unpainted. This was the trap in the change.
- The ALL header tooltip states the recorded count while rewound, mirroring the
  Ticker Lookup's disclosure.

### Not done

`STRIKE_GROWTH_EXPIRIES` left at 3. Raising it to 4 would only affect sessions
recorded from that point on (retention is ~5 trading days) and it must stay
`<= STRIKE_GROWTH_FEED_EXPIRIES` in `proxy-tastytrade.js`. This fix works on the
history that already exists.

## 2026-08-14 - ES Candles: bubbles back to round dots + the old defaults

Edited: `components/dashboard/es-candles/EsChartCard.tsx`,
`components/dashboard/es-candles/slotStore.ts`.

### What

Undid today's look changes. The chart was better before them; this puts the
mark and the defaults back and keeps only the parts that were real fixes.

### How

**Round, not oval.** `BUBBLE_ASPECT` `2.2 -> 1.0`. The horizontal stretch closed
the gaps between marks and fused every row into a continuous ribbon. The gaps
are the design — they are what lets ten rows sit over the candles without
burying them. The constant is kept (not deleted) as the one number to change if
an oval is ever wanted again.

**Defaults restored to what worked**: `topStrikes 10, highlight 1, minSize 1,
maxSize 7, curve 4, brightness 0`.

The detour worth writing down: curve was dropped to 1.0 (linear) on the theory
that size should be proportional to net GEX. It is more "correct" and it looks
worse — a proportional ladder puts real ink on eight mid strikes nobody trades
off. The steep exponent is deliberate: it collapses the middle of the ladder to
almost nothing so only the levels that matter have size. Sparse is the feature.

**Highlight boost pulled back**: `HIGHLIGHT_BOOST_TOP` `2.2 -> 1.45`,
`HIGHLIGHT_BOOST_MIN` `1.4 -> 1.15`. With `highlight 1` there is no rank span,
so the single wall takes TOP — one white-hot level, everything else ranked by
size alone. The big multipliers existed to force separation while the curve was
flat; with curve 4 the exponent does that already and a boost on top just makes
a blob.

### Kept

- The perf work (memoised bubble derivation, glow sprites, hover no longer
  repaints, cheaper per-frame measurements) — none of it is visible.
- The two no-overlap caps and the column decimation that made the 1m bucket
  usable.
- Rank-graduated boost stays in the code; it only has an effect above
  `highlight 1`.


## 2026-08-14 - ES Candles: column decimation makes the 1m bubble bucket usable

Edited: `components/dashboard/es-candles/EsChartCard.tsx`.
Preview: `generated/2026-08-14-bubble-panel-redesign.html`.

### What

On the 1m bucket every bubble row collapsed into a continuous hairline ribbon —
the 7800 wall rendered as one solid white caterpillar across the session. Not
readable as a level, and nothing about which strike or how big survived.

### How

The no-overlap cap added earlier is not sufficient on its own: it only stops
marks from touching, it does not stop them being drawn on top of each other in
the first place. At 1m over an intraday chart the column pitch falls to ~1px, so
`rx` bottomed out on its 0.35 floor and 400 near-identical hairlines merged.

Fix is to draw FEWER columns instead of thinner ones:

- `MIN_COL_PITCH_PX = 5`, `colStride = ceil(MIN_COL_PITCH_PX / colPitch)`.
- The bucket loop strides by `colStride`, and `rxCap` is computed from the
  EFFECTIVE pitch (`colPitch * colStride`) rather than the raw one, so the ovals
  grow back to a legible width instead of staying at the floor.
- Striding is anchored to the END of the array (loop runs newest → oldest) so
  the newest bucket is always drawn. The live column must never be the one that
  gets skipped.

Net effect: a row stays a dashed price level at every bucket size and every
zoom. Only the sampling density changes — 1m now reads like Bar, just with more
detail where there is room for it.

### Also

The panel-redesign preview had dead Bar/1m/5m buttons; they now drive the mock
chart and the preview strip through the same decimation, and the caption reports
the stride ("every 3rd column") so the behaviour is visible rather than implied.


## 2026-08-14 - ES Candles: fix pan/zoom lag on the chart overlay

Edited: `components/dashboard/es-candles/EsChartCard.tsx`.

### What

The page was heavy to move around — panning, zooming and even just sliding the
crosshair across the chart dragged. Four things were doing full-cost work on
every frame; all four are viewport-independent or hover-independent, so none of
it needed to be there.

### How

**1. Hover no longer repaints anything.** The `pointermove` listener on the
chart container called `schedule()` unconditionally, so every mouse movement
over the chart repainted the whole overlay canvas AND the GEX rail at the
pointer's event rate — for a gesture that changes nothing about the projection.
Now gated on `e.buttons !== 0`, which keeps the reason the listener exists
(dragging the price axis fires no `subscribeVisibleLogicalRangeChange`) and
drops the rest. `pointerup` still catches the settled state. This is the single
biggest win.

**2. The bubble derivation is memoised.** Bucketing the minute store, the
session scale, the expanding `runMax`, and the per-bucket top-N ranking depend
only on the data — but they ran inside `draw()`, which is wired to
wheel/pointermove/range-change. On a full session that is a sort of the entire
strike list per bucket, a few hundred times per frame.

- New `bubblePrepRef` caches `{mins, sessMax, runMax, shownAt, wallAt,
  strikeStep}` behind a signature: `minuteColsVerRef | metric | bucket |
  topStrikes | highlight | replayTs | bar-grid`.
- New `minuteColsVerRef`, bumped at every write to `minuteColsRef` (live frame,
  backfill, and all three clears), is the invalidation key — a landing column
  invalidates the cache immediately, so it can never serve stale gamma.
- Inside the build, the per-bucket sort is skipped unless a new peak actually
  appeared, and unchanged buckets share one `Set`/`Map` reference instead of a
  rebuilt copy.

**3. Wall glow is a sprite, not a blur.** `ctx.shadowBlur` is a per-fill
gaussian and was paid once per wall bubble per column per frame (hundreds of
blurs). Now rendered once per (size, colour, blur) into an offscreen canvas via
`glowSpriteRef` and blitted with `drawImage`. Sizes are quantised to a half
pixel so the cache stays a handful of entries; walls are always opacity 1 so the
sprite is pixel-exact.

**4. Smaller per-frame measurements.** The strike increment was being found by
flat-mapping every cell of every bucket (tens of thousands of entries) each
frame — it is data, so it moved into the memo as `strikeStep`. Column pitch is
now sampled from the newest ~40 buckets (12 gaps) instead of walking the whole
session for a value that is uniform.

No visual change: same bubbles, same ranking, same glow, same no-overlap caps.


## 2026-08-14 - ES Candles: GEX bubbles are ovals, and can no longer overlap

Edited: `components/dashboard/es-candles/EsChartCard.tsx`,
`components/dashboard/es-candles/slotStore.ts`.
Preview: `generated/2026-08-14-bubble-sizing-examples.html`.

### What

Shipped the "Restrained" preset from the sizing preview, and changed the mark
itself from a circle to a horizontally-stretched oval that is geometrically
prevented from touching its neighbours.

### How

**Oval mark.** `ctx.arc` → `ctx.ellipse` with `BUBBLE_ASPECT = 2.2`. A row now
reads as a dashed price level instead of a string of beads, which is what these
rows actually are.

**Two no-overlap caps, derived from the live projection** — not from sizes that
happen to fit. The chart zooms, so any fixed "safe" pixel number stops being
safe the moment the price scale is scrolled:

- `rx <= colPitch / 2 - 0.8` where `colPitch` is the smallest gap between two
  adjacent bucket x's. Neighbours within a row can never touch, at any bar
  spacing.
- `ry <= rowPitch / 2 - 1.5` where `rowPitch` is the chain's own strike
  increment projected through the same `priceToCoordinate` the bubbles use. Two
  rows can never touch, at any vertical zoom. Measured off the strike GRID, not
  the shown rows — the shown set changes per bucket and a cap that moved with it
  would make a row breathe as its neighbours came and went.

**Sizing (Restrained preset).**

- Defaults: `minSize` `0.4 -> 0.3`, `maxSize` `12 -> 4.5`, `brightness`
  `84 -> 88`. `curve` stays 1.0 (linear, proportional to net GEX).
- `HIGHLIGHT_BOOST_TOP` `2.6 -> 2.2`, `HIGHLIGHT_BOOST_MIN` `1.6 -> 1.4`. Top
  three walls land at 2.2x / 1.8x / 1.4x on a 4.5px base.

The previous 12px base at 2.6x was a 31px radius — a 62px band per wall, which
swallowed its neighbours at normal chart heights. With the caps in place a large
`maxSize` buys nothing but clipping, hence the smaller budget.

Saved slider blobs still win over defaults; Reset in the bubble panel picks up
the new values. The oval geometry and both caps apply regardless of settings.


## 2026-08-14 - ES Candles: bubble size back to proportional, walls carried by rank

Edited: `components/dashboard/es-candles/EsChartCard.tsx`,
`components/dashboard/es-candles/slotStore.ts`.

### What

Bubble radius is proportional to net GEX again across the whole ladder, with the
top 3 walls made obvious by their own multiplier rather than by bending the
curve for everyone.

The steep size curve (2.2, then 2.8 earlier today) made the walls dominant by
collapsing every non-wall strike onto Min — so the mid ladder carried no
magnitude information at all, which is the read it exists for.

### How

- Default `curve` `2.8 → 1` (LINEAR). A strike at half the session max now draws
  at half the size span; 25% draws at 25%. Straight proportionality to that
  bubble's own net GEX.
- All of the "top N stand out" now comes from the rank-graduated highlight
  boost, which only touches the highlighted strikes and therefore cannot flatten
  the rest: `HIGHLIGHT_BOOST_TOP` `2.1 → 2.6`, `HIGHLIGHT_BOOST_MIN`
  `1.15 → 1.6`. Even the #3 wall sits 1.6x above the proportional ladder; #1 is
  2.6x.
- Ranking, glow taper, opacity gradient, expanding as-of-bucket scale: unchanged.
- Slider ranges unchanged — `curve` still spans 0.5–8, so the old exponential
  behaviour is one drag away.

Saved slider blobs still win over defaults; hit Reset in the bubble panel to
pick up curve 1.0.


## 2026-08-14 - ES Candles: rank-graduated GEX bubble sizing

Edited: `components/dashboard/es-candles/EsChartCard.tsx`,
`components/dashboard/es-candles/slotStore.ts`.

### What

The per-strike GEX bubble rows on the ES Candles chart read flat at the top of
the ladder: the #1, #2 and #3 walls drew at nearly the same thickness, so the
dominant level did not stand out from the ones under it.

Highlighted walls are now sized by their RANK, not by a single flat multiplier,
and the factory sizing curve is steeper.

### How

- `HIGHLIGHT_BOOST` (one flat `1.35x` for every highlighted wall) replaced by
  `HIGHLIGHT_BOOST_TOP = 2.1` / `HIGHLIGHT_BOOST_MIN = 1.15`, interpolated
  linearly across the highlighted set. Rank 0 (the session's dominant wall as of
  that bucket) gets TOP; the last highlighted wall gets MIN. With Highlight = 1
  there is no span, so that single wall takes TOP.
- `wallAt` changed from `Map<slotTs, Set<strike>>` to
  `Map<slotTs, Map<strike, rankIdx>>` so the rank survives to draw time. The
  ranking itself is unchanged — still the expanding as-of-bucket peak `|GEX|`
  order, so an already-printed tube can never resize after the fact.
- Wall glow tapers with the same rank term: `shadowBlur` `22 → 12` across the
  highlighted set instead of a flat `16`.
- Defaults: `minSize` `0.5 → 0.4`, `maxSize` `9 → 12`, `curve` `2.2 → 2.8`.
- Slider headroom: `curve` max `5 → 8`, `maxSize` max `20 → 24`. Past ~4 the mid
  strikes finally collapse to Min and only the true walls grow.

Existing saved slider blobs are untouched (the restore clamp only narrows, and
both ranges widened) — the rank boost applies regardless of saved settings; hit
Reset in the bubble panel to pick up the new defaults.


## 2026-08-14 - Vol GEX Flow tab: +GEX % view

Edited: `components/dashboard/VolGexFlowPanel.tsx`,
`server-v2/server-with-proxy.js`.

### What

The Vol GEX Flow tab (home page, Economic Calendar card) gets a
`$ GEX / +GEX %` switch beside RTH/ETH. Flip to `+GEX %` and the chart becomes
the +GEX % series for the selected expiry — the same number as the home Levels
strip tile — split at 50 (orange above = long-gamma chain, cyan below = short),
with corner labels and the six stat cards re-labelled to percent stats: +GEX %
now, delta bucket in points, session high/low, time above 50%, regime.

The strip tile was point-in-time: 63% says the chain is long-gamma right now,
but not whether it climbed there from 40 or bled down from 80, and that path is
the part that trades.

Default `$ GEX`; the choice sticks for the browser session.

### How

**Served, not sampled.** The share rides along on the SAME
`/proxy/gex-vol-flow` response the chart already fetches, so it arrives complete
for the whole session on first load, is identical on every device, and follows
the expiry chooser.

**Proxy change** (`handleGexVolFlow`) — purely additive; route, params, caching
and every existing field unchanged:

- Two aggregates added to the existing final SELECT, over the same per-strike
  `latest` rows in the same pass:
  `SUM(GREATEST(net_gex + net_vol_gex, 0)) AS pos_gex` and
  `SUM(ABS(net_gex + net_vol_gex)) AS abs_gex`. The share has to be built from
  the strikes; the signed bucket total already returned can't be decomposed back
  into them, so this could not be done client-side off the old response.
- Each point gains `posGex`, `absGex`, `posPct` (0-100). `posPct` is `null`, not
  0, on a bucket with no rows, so the chart leaves a gap instead of drawing a
  dive to zero that never happened.

**Basis: `net_gex + net_vol_gex`, not `net_gex`.** `net_gex` is the OI leg ONLY
(`net_vol_gex` is the volume leg — see `gex-history-writer.js` and the `oiVol()`
helper in `lib/calculations/calculations.ts`). The Levels strip tile reads
`netGEXOf(row,'net')`, which is OI+Vol. A first pass summed the OI leg alone and
put the two badly out of step — the tab read 75% against the tile's 26%, same
chain, same minute.

**Panel:**

- **Full swap, not an overlay.** Two series stacked on one canvas was built and
  rejected: different units, different shapes, neither legible.
- **Two price scales, one series each** — `$` on the right, `%` on the left —
  so each keeps its own price formatter with no fighting over which series
  formats the axis. Only one is visible at a time. Both scales are declared in
  the chart constructor and only have `visible` flipped: adding a price scale to
  a live chart re-lays-out the pane and jumps the series. Data and visibility
  live in separate effects, so switching never rebuilds the canvas.
- **Autoscale padded around the data but always containing 50**, clamped 0-100.
  Pure data-fit would put the midline wherever it landed and make a 58-64 day
  look like a regime war; a hard 0-100 would flatten that same day to a straight
  line. The provider reads a ref, not state — lightweight-charts captures it once
  at series creation and it would otherwise close over stale data.
- Cards keep the same grid and the same order of meaning (now / change / high /
  low / regime / context) across both views, so the block doesn't have to be
  re-learned on each flip. `pctStats` is computed separately from `stats` because
  the two views cover different bucket sets — a bucket with rows but no gamma has
  a `volGex` and no `posPct`.
- "Time > 50%" counts **50-crossings**, not zero-crossings: on this series the
  regime change is the chain flipping between net long and net short gamma.
- The switch is **hidden**, not shown dead, when fewer than two buckets carry a
  `posPct` — which also gates it off on a server that predates the field, so the
  tab degrades to its previous behaviour instead of offering a toggle that draws
  nothing.

### Superseded

An earlier pass sampled `posGexPct` client-side in `HomeClient` on a 20s timer
into `sessionStorage`. It only recorded from whenever the page happened to be
opened — open the tab at 2pm and the line started at 2pm while the dollar series
showed the full session beside it. That code is gone; `app/home/HomeClient.tsx`
is back to its original state and passes no props to the panel.

## 2026-08-14 - Ticker Lookup: replay slider on both panes

Edited: `components/pages/Analytics.tsx`.

### What

The Ticker Lookup card can now be rewound. A `⏱ Replay` button next to the ↻
opens a replay bar (session picker · ◀ ▶ transport · scrubber · 0.5–8× speed ·
clock) and BOTH panes — the picked expiration and the whole board ex-0DTE —
rebuild from a recorded `strike_growth` sweep: ladders, walls, Core/Call/Put/
Flip chips, the net-GEX readouts and the plain-language read at the bottom all
follow.

Because the card is exported and mounted in two places, the Multi Greek page's
toolbar 🔍 overlay gets the same replay for free — one component, no second copy.

### How

Same route and the same shared-clock shape the Multi Greek page's replay uses:
`/proxy/strike-growth/frames-by-expiry?symbol=&date=`, one request per session
pulled up front so scrubbing never re-hits the network; `replay-meta` supplies
the session list. Sweep timestamps snap to the minute for the scrubber's steps,
and the card holds the last sweep AT OR BEFORE the clock (step-hold, never a
future reading).

**Pane scoping.** Left = the picked expiry's cells. Right = every recorded
expiry EXCEPT the session's 0DTE (the expiry landing ON the replayed date, or
the front recorded one for a root with no same-day listing) — the same
structural-board rule the live right pane follows.

**The ladder holds still.** The recorder stores the top N strikes a side PER
SWEEP, so a frame-built axis gains and loses rungs on every step and the ladder
shakes while it plays. Each pane's axis is fixed for the session (every strike
recorded in any frame, for that pane's expiries) and memoized on the session,
not rebuilt per frame.

**"Not recorded" ≠ "no gamma".** `TlLadder` takes an optional `missing` set:
strikes this sweep didn't record draw no bar and an em dash, matching the
convention the Δ 1D column already uses. A 0 bar there would be a claim about a
wall we simply didn't store.

**DTE counts from the replayed session.** The expiry pills label off the replay
date while rewound — off today, the wrong pill would be marked 0DTE.

### What's off while rewound, and why

- **± Move / ATM IV** — priced off live marks; nothing in the recording
  reconstructs them, so they read "—" rather than putting today's premium on a
  three-day-old ladder.
- **Δ 1D column and its caption** — an end-of-day series, one row per session
  close. It has nothing to say about an intraday clock.
- **The "updated" stamp** — that is the live fetch time; the replay bar's clock
  is the timestamp that matters.
- **The whole-board sweep** — paused while rewound. It is one request per
  expiration and uncapped (SPX lists 40+), and none of it is on screen. The
  cheap chain/listing polls stay on so leaving replay doesn't blank the card.

Live mode is unchanged: with replay off every value comes from the same live
path it always did.


## 2026-08-14 - Multi Greek: replay slider — all four panels on one clock

Edited: `app/mult-greek/MultGreekClient.tsx`.

### What

Multi Greek can now be rewound. A `⏱ REPLAY` toggle on the dock opens a replay
bar (session picker · ◀ ▶ transport · scrubber · 0.5–8× speed · clock) and every
panel renders from a recorded `strike_growth` sweep instead of the live chain —
values, heat, column totals, walls and the CB/CW/PW markers all follow, because
replay swaps the ROWS at the source rather than painting an overlay on live
numbers. Space toggles play/pause.

The four tickers are NOT four independent scrubbers. One shared clock drives all
of them, so "what did the board look like at 10:42" is a single question with a
single answer.

### How

**Data.** `/proxy/strike-growth/frames-by-expiry?symbol=&date=` — the same route
the Options Chain in-grid replay already uses, one request per ticker per
session, whole day pulled up front so scrubbing never re-hits the network.
`/proxy/strike-growth/replay-meta` supplies the session list, UNIONed across the
four tickers (not intersected — a day SPX recorded and the 4th slot didn't is
still worth replaying; the empty panel says so).

**The shared clock.** The recorder sweeps tickers on different lanes (2 min hot /
5 min full roster), so their timestamps do not line up. Timestamps are snapped to
the minute and unioned into one timeline (~one step per minute of session), and
each panel holds its LAST sweep at or before the clock — step-hold, not nearest,
so no panel can show a reading from the future relative to the one beside it.

**The ladder holds still.** The recorder stores the top N strikes a side PER
SWEEP, so a frame-built strike axis gains and loses rows on every step and the
whole ladder shakes. The axis is fixed for the session (union of every strike in
any frame); a strike this sweep didn't record renders `--`, not `0` — "not
recorded" and "no gamma here" are different claims.

**One ranking rule.** The per-column shading maxima / top-3 / top-5-per-side /
Core Bullseye pick were extracted out of `computeRows` into `columnStats()`, now
shared by the live path and the new `computeReplayRows()`. A rewound panel ranks
and shades by exactly the rule the live one does, and there is no second copy to
drift.

**DTE counts from the replayed session.** `colLabel()` takes an optional base
date. Without it every rewound column would carry today's DTE — and the "0DTE"
column, which is the one the ex-0DTE Total excludes, would be the wrong column.

### What's off while rewound, and why

- **Δ stamps** — their baselines come from a live grid endpoint; forced to OFF.
- **EM bands** — this week's expected move, which didn't exist in a past session.
- **Cell click card** — reads live 15m/30m/open changes; cells aren't clickable.
- **OI basis** — only `gex_now + gex_open` (OI+VOL) and `gex_now` (VOL) are
  recorded. OI-only falls back to OI+VOL, and the bar says so.
- **Coverage** — recorded walls only, ~5 trading days retention. Stated in the
  bar rather than left to be discovered from a sparse grid.

Live mode is byte-for-byte unchanged: with replay off, every panel takes the same
`computeRows` path it always did.


## 2026-08-14 - Explainer Mockup: brand mark fills the rail

Edited: `owner-vite/src/pages/SocialMedia.tsx`.

### What

The Explainer Mockup's right rail ended at the Chop Zone card, leaving a tall
block of dead space above the footer on every export. The CB Edge logo now sits
there, centred, with the `"Real Edge · Real Orderflow"` tag under it.

### How

`.xp-railmark` is `flex: 1 1 auto; min-height: 0` inside the existing
`.xp-rail` flex column, so it absorbs exactly the height the Key Levels and
Trade Plan panels leave over — nothing more. The logo is capped at
`min(72%, 320px)` wide and `100%` tall, so on a short viewport the block
collapses rather than pushing the trade plan off the card. Under the 1000px
breakpoint (where the rail goes full-width) it drops to `flex: 0 0 auto` so it
doesn't stretch on mobile.

Same asset the footer already uses (`/cb-edge-logo.png`, `crossOrigin`
"anonymous"), so html2canvas bakes it into the exported PNG with no new
CORS handling.

## 2026-08-14 - Social Media: any ticker, and every stat behind it

Edited: `server-v2/api-router.js` (`/api/social-media/daily-input` takes
`?ticker=`, new `/api/social-media/gex-chain`, ticker-aware prompts on
`trigger-map` / `day-post` / `generate`), `owner-vite/src/pages/SocialMedia.tsx`
(page-level ticker picker, stats panel, ticker threaded into every data tab).
Added: `owner-vite/src/lib/tickers.ts`.

### What

The Social Media page was SPX and nothing else — the share card said `SPX`, the
API returned keys literally named `spxSpot` / `spxPrevClose`, and the live GEX
visuals came off `/proxy/gex`, a single in-memory SPX feed. Posting a levels
card for NVDA meant doing it by hand.

Now there is one **ticker picker** in the page header, backed by the live
scanner universe (~169 symbols), and it drives every data tab: Daily Levels,
GEX Image Cards, GEX Data, Day Posts and the Explainer trigger map. The choice
is persisted (`cb-sm-ticker-v1`), so the desk comes back to the symbol it was
working on.

Alongside it, a new **all stats** panel under the Daily Input fields shows
everything the bundle returns that isn't an editable field — Core Bullseye,
prior-day and prior-week H/L, pivot, published EM and the no-long / no-short
zones — for whatever ticker is selected.

### How

**SPX is untouched.** `?ticker=SPX` (the default) takes the ORIGINAL code path
verbatim: the live in-memory `/proxy/gex` feed, same numbers, same DTE-1 chain
override. Nothing about the existing card changed. `/proxy/gex` itself was not
modified.

**Everything else is assembled from sources that were already ticker-wide.**
Nothing new had to be recorded:

| Field | Source |
|---|---|
| spot, prior close | `/api/tt-quotes?symbols=` |
| CB, walls, flip, net GEX (fallback) | `/proxy/scanner` (`scanner_snapshots`) |
| walls, flip, net GEX, ladder (primary) | `/proxy/api/tt/chains/<TICKER>` |
| expected move | ATM straddle off the same chain, then `ticker_levels.em` |
| PDH / PDL / PWH / PWL | `/api/ref-levels?symbol=` (`ref_levels`) |
| pivot, EM up/down, zones | `/api/levels?ticker=` (`ticker_levels`) |

The live chain read wins over the (up to 5-minute stale) scanner sweep whenever
it returns strikes; the sweep is the fallback for roots with a thin chain. If
the chain EM comes up dry, the published `ticker_levels` row fills it.

**`/api/social-media/gex-chain`** is the new ticker-aware sibling of `/api/gex`.
Same payload shape (`chain` / `spotPrice` / `gexFlip` / `callWall` / `putWall`),
so the ported `GexChart` and `Heatmap` render any root with no component
changes. `ticker=SPX` with no expiration delegates straight to `/api/gex`, so
the live feed stays authoritative for the symbol the desk posts most.

**Overnight H/L stays honest.** It is an ES-only 5-minute candle read, so for
any other root that slot carries the prior-day range from `ref_levels` instead
and the field relabels itself from "ES Overnight (H / L)" to "Prior Day (H / L)"
rather than silently showing ES numbers under another ticker's name.

**The AI prompts name the ticker.** `trigger-map`, `day-post` and `generate` now
take `ticker` in the POST body and cash-tag it; the system prompts no longer
assert the desk is SPX-only.

**Back-compat.** The API still returns `spxSpot` / `spxPrevClose` as mirrors of
the new generic `spot` / `prevClose`, so any consumer that wasn't updated keeps
reading the selected ticker's values instead of breaking.

**Why a new lib file.** owner-vite is a standalone Vite app whose `@` alias
points at `owner-vite/src` — it cannot import `lib/scannerTickers.ts` from the
repo root the way the Next pages do. `owner-vite/src/lib/tickers.ts` reads the
same source of truth over HTTP (`/proxy/scanner-tickers`), memoises it at module
scope and mirrors it into localStorage, so the picker is instant on the second
visit and degrades to a cached list rather than an empty one.

### Notes

- Changing the ticker clears the dirty guard, the stats and the GEX ladder, so a
  new symbol never inherits the previous one's edited fields.
- The picker accepts a free-typed root the sweep hasn't seen yet; symbols with
  no chain and no sweep row simply read `—` rather than erroring.
- Screenshot Brander and Explainer Mockup have no live data of their own and
  were left alone apart from the caption cash-tag.

## 2026-08-14 - ΔGEX Board: previous sessions + a Net GEX / Δ toggle

Edited: `server-v2/eod-strike-gex-recorder.js` (as-of `date` on both read
helpers, absolute-level aggregates, new `listStrikeGexDates`),
`server-v2/server-with-proxy.js` (`&date` on the two readers, new
`/proxy/eod-strike-gex-dates`), `server-v2/api-router.js` (pass `date`, register
`/api/eod-strike-gex-dates`), `owner-vite/src/pages/GexGrowth.tsx` (date picker,
mode tabs).
Added: `app/api/eod-strike-gex-dates/route.ts`.

### What

The board could only ever show the latest close. Retention is ~400 days, so a
year of sessions was sitting in `eod_strike_gex` with nothing able to read it.
Two additions:

- **Date picker** — any recorded session, newest first.
- **Net GEX / Δ 1 day tabs** — absolute per-strike level at that close, or the
  change against the session before it.

### How

**One payload, two readings.** Both routes already returned `netGex` (the level)
alongside `chg` (the diff), so the ladder toggle is a re-render, never a fetch.
`getStrikeGexBoard` now returns the rail's ranking twice — `net`/`absTot`/
`strikes` for Δ, `gexNet`/`gexAbs`/`gexStrikes` for levels — off the same CTE, so
the two views cannot disagree about the numbers.

**`date` is an AS-OF, not an equality match.** The latest snapshot on or before
it. A holiday, a long weekend, or a symbol that missed that particular 16:05
sweep still answers with the closest session it actually has, instead of an
empty ladder. Omitted → latest, byte-for-byte the previous behaviour.

**Validated at every hop.** `YYYY-MM-DD` or it's dropped — in the Next adapter,
in `api-router.js`, and again in the recorder's `normDate`. The proxy casts the
value to `::date`, and this is a URL a reader can type; a malformed one falls
back to latest rather than 500ing.

**Ranked twice without a cross product.** The two top-N lists are `json_agg`'d
in the query rather than LEFT JOINed as rows — joining two independent rank
lists would multiply them (top² rows per symbol, 4k+ to render 169 names). One
row per symbol.

**Level figures need no baseline.** A name on its first recorded session shows
`—` in Δ mode but a real ladder in Net GEX mode, and the "needs a second
session" message is now gated to Δ so it can't hide data that exists.

**The picker reads recorded rows, not a calendar** (`/…-dates`) — a holiday or a
failed sweep is simply not in the list.

### Note

Picking an older session switches the view to Net GEX, since "what did the board
look like on the 8th" is a level question. Returning to the newest session
restores Δ. The tabs stay live either way — it's a default, not a lock.


## 2026-08-14 - Site Guide (/guide): dashboard cards, rose headings, every page name is a link

Edited: `app/guide/page.tsx`.

### Cards

Every panel is now a plain `<Card>` on the shared dashboard surface. The left
accent bars are gone from the playbook and concept blocks, and no card carries a
per-card accent color — the hero is a Card too, not a hand-styled div.

### Headings

`#fb7185`, one step larger. That hex is the ONLY raw color literal on the page:
a deliberate product choice, declared once as `TITLE` at the top of the file
(with `LINK` = `LIGHT_BLUE` beside it) so it cannot drift section to section.
Everything else still resolves through `HOME_THEME`.

### Text

Body copy is `HOME_THEME.text` throughout. The dimmed-gray `DIM` / `DIMMER`
constants were deleted rather than lightened, so nothing can reintroduce gray
body text later.

### The guide is navigation now

Every page name in the copy is a `next/link` to that page (`PageLink`), as are
the directory rows — icon, name and route chip all navigate. The Scanner and
Test Lab pills carry the `?tab=` the section strip reads, so a pill lands on the
exact view it names, and the phone pills go to `/m/*`.

## 2026-08-14 - ΔGEX Board: ladder opens on the money

Edited: `owner-vite/src/pages/GexGrowth.tsx` (`Ladder` gains `scrollRef` + a
centring layout effect; the detail viewport now carries a ref).

### What

The ladder is ±40 strikes deep and sorted high→low, so `scrollTop: 0` put the
reader's first sight of every name at the far upside wing — 40 rungs above
spot. Every single symbol needed a scroll before it said anything. Spot now
parks in the vertical middle of the viewport on load.

### How

`Ladder` takes the scrolling viewport as `scrollRef` and centres the row it
already marks as spot:

- Positioned by **rect delta**, not `offsetTop` — the viewport is a plain div
  with no `position`, so `offsetParent` is somewhere up the card and `offsetTop`
  would measure against the wrong box.
- `useLayoutEffect`, not `useEffect` — runs before paint, so the ladder is never
  briefly seen at the top and then jumped.
- Keyed on `[rows, spotStrike]`. `rows` is a fresh array per fetch, so it
  re-centres when the symbol changes and stays put on unrelated re-renders —
  otherwise the view would yank back mid-scroll every time the poll fired.

`scrollRef` is typed structurally (`{ current: HTMLDivElement | null }`) rather
than as `React.RefObject`, which fits both the React 18 and 19 ref types without
a cast.

### Note

The spot rung itself is unchanged — still found by nearest-strike-to-spot, still
marked with the cyan border and ◀. Only the initial scroll position moved.


## 2026-08-14 - /app/replay + /app/strike-history 404 on load; build guard now catches it

Added: `app/app/replay/route.ts`, `app/app/strike-history/route.ts`.
Edited: `app-vite/scripts/check-routes.mjs` — new check (4).

### What

`/app/replay` returned the 404 page ("This page got chased off the chart") even
though the route exists in `app-vite/src/App.tsx` and `components/pages/Replay.tsx`
is intact. The route was never the problem — the SPA is client-routed, but the
FIRST request for `/app/<x>` is a plain document request that Next answers, and
every SPA route needs its own `app/app/<x>/route.ts` calling `serveSpaShell("app")`
to hand back the shell. `replay` and `strike-history` were the only two routes in
`App.tsx` without one, so both worked via in-app navigation and 404'd on a hard
refresh, a bookmark or a pasted link. Neither is in the toolbar, so direct URL is
the only way in — which is why it read as "the page doesn't exist".

### The guard

`check-routes.mjs` already failed the build for a nav item with no `<Route>`; it
did not check the other direction. Check (4) now walks every `<Route path>` in
`App.tsx` and requires a matching `app/app/<path>/route.ts`, exempting only the
`*` catch-all and the bare `/m` redirect. It runs as app-vite's `prebuild`, so
local `npm run build` and the Docker deploy both fail loudly instead of shipping
a route that only works if you never refresh. `--dry` prints a `shell <path> ->`
line per route.

## 2026-08-14 - ΔGEX Board: the missing /api adapter

Added: `app/api/eod-strike-gex-board/route.ts`.
Edited: `server-v2/api-router.js` (registered `/api/eod-strike-gex-board` and
`/api/eod-strike-gex-change`).

### What

The owner ΔGEX Board rendered `Board failed: not implemented` on every load.
Not a data problem — the 16:05 ET sweep, the `eod_strike_gex` table, the
`/proxy/eod-strike-gex-board` reader and the page itself were all already
shipped and working. The `/api` → `/proxy` adapter was the one piece nobody
wrote.

`/api/eod-strike-gex-board` existed in exactly zero places: no `route.ts`
directory, no `register()` in `api-router.js`. So the fetch fell through to the
`app/api/[...proxy]` catch-all, which answers 501 `{"error":"not implemented"}`
— the literal string the card was printing back.

### How

- New `app/api/eod-strike-gex-board/route.ts`, a `forwardGet` adapter matching
  its `eod-strike-gex-change` sibling. Passes `?top=` through after coercing it
  to a positive integer.
- Registered both `/api/eod-strike-gex-board` (auth `owner`) and
  `/api/eod-strike-gex-change` (auth `subscriber`, since it also backs the
  Ticker Lookup Δ 1D column) in `api-router.js`, so both work with
  `API_ROUTER=1` instead of depending on the Next fallthrough.
- Both send `no-store`. The data only moves once a day, but an edge cache would
  pin a stale baseline date straight across the 16:05 write.

### Note

`/api/eod-strike-gex-change` had a `route.ts`, so the detail ladder worked — but
that file's header already claimed a registration in `api-router.js` that had
never been added. It was running on the Next fallback alone. That claim is now
true.

(Re-added: this entry was written earlier today and got clobbered by a later
CHANGELOG write from a stale copy.)

## 2026-08-13 - Watch tab: detail expands inline under the row + contract probe chart

Edited: `components/pages/Scanner.tsx` — new `ProbeChart` + `OutcomeDetailPanel`,
`WatchThisScanner` detail state re-keyed, `ResultsByDay` takes the panel.
Client-only; `/proxy/far-cb-outcome-detail` is unchanged.

### What

Clicking a tracked flag opened a centered modal over the page. In the Results
view that meant the popup covered the very rows it came from — the screenshot
of IONQ sat directly on top of the Touched section it was launched from. It now
expands **inline, directly under the row you clicked**, so the row stays put and
you can open one, read it, collapse it, and keep moving down the list. Clicking
the same row again collapses it; the ✕ still closes.

The panel also gained a **contract probe chart** above the day table.

### The chart

Hand-rolled SVG, not a chart library: this renders inside a `<td>` that is
already nested in two other tables, and every charting lib on this page wants a
measured container. A `viewBox` scales without measuring anything.

- **Solid line = the contract**, left axis, green/red by net direction, one dot
  per sampled day and a fatter dot on the last point (today's 15-minute probe,
  so it moves intraday).
- **Dashed line = spot**, right axis, faint.
- **The two scales are independent and labeled as such.** A $0.23 contract
  against a $45 underlying on one axis would flatten the contract onto the
  baseline. Only the shapes are comparable, not the levels.
- **No-trade days break the line** instead of drawing a segment across a gap
  that never happened — `segments()` splits the path on nulls, matching the "—"
  the table already shows for those days.
- A dashed vertical marker with a `touched` label sits on the touch date when it
  falls inside the window.
- Header line carries first → last price and the total %.

### Row keying

`openRow` is a **UI key, not a contract key** — `day|<date>|<section>|SYM|EXP|STRIKE`
in the Results view, `flat|SYM|EXP|STRIKE` in the flat table. The same contract
can legitimately appear under both **Opened** and **Touched** on one date, and
keying by contract alone expanded both at once.

A `detailReq` counter guards the fetch: a slow response for a row you already
closed or moved past is dropped instead of painting itself into whatever row is
open now.

### Also fixed (regression from earlier today)

The blanket `<SortTh` → `<OutcomeTh` rename in the sortable-columns change also
renamed the **Pin table's** own `SortTh` call sites, which take a different
sort-key type. Restored — the rename now only applies to tags without a `col=`
prop. Caught by a type check; both tables build clean.

## 2026-08-13 - Scanner Watch tab: tracked-results table is sortable, Touched gets its own column

Edited: `components/pages/Scanner.tsx` (`WatchThisScanner` + new `OutcomeTh`,
`sortOutcomes`, `defaultOutcomeSort`). Client-side only — no endpoint change.

### What

The tracked-results table under the Watch cards was fixed in the server's order
(`first_flagged DESC`) with no way to re-order it. On the **Touched** tab that
is the wrong axis entirely: you want the most recent touch first, and the touch
date was not even a column — it was concatenated onto the status label
(`TOUCHED 2026-08-11`), so it could not be sorted or scanned down.

### How

**Every header is now clickable.** `OutcomeTh` renders the label plus a
direction caret (dim `▾` when inactive, `▲`/`▼` when it is the active key), and
clicking the active column flips direction. First click on a new column opens
**descending** for dates and numbers (newest / biggest first) and **ascending**
for Symbol. Named `OutcomeTh` rather than `SortTh` because the Pin table further
up the file already owns that name with a different key type.

**Touched is its own column**, between Closest and Status, and the status cell
is back to the bare word. Both are sortable.

**Sort resets per view.** `defaultOutcomeSort()`: Touched → `touched_date` desc,
Expired → `expiry` desc, everything else → `first_flagged` desc (the server's
own order, so All/Open look unchanged until you click).

**Nulls sink in both directions.** An untouched row has no touch date; letting
those float to the top of a descending sort would bury exactly the rows the
sort was asked for.

**Status sorts by lifecycle, not alphabet** — `open → touched → expired` via
`STATUS_RANK`, rather than the A–Z order that would read `expired, open,
touched`.

Sorting is client-side over the page the endpoint already returned (the `limit`
is applied server-side), so it re-orders the fetched rows and does not re-query.

## 2026-08-13 - Scanner Watch tab: /proxy/far-cb-outcomes no longer blocks the page

Edited: `server-v2/far-cb-recorder.js` (quote enrichment rewritten as a
background single-flight pass), `server-v2/server-with-proxy.js`
(`/proxy/far-cb-outcomes` gains `quotes=0`), `components/pages/Scanner.tsx`
(`WatchThisScanner`: Results view opts out of quotes, outcomes re-poll).

### What

Opening `/app/scanner?tab=watch` took minutes. In the network waterfall
`far-cb-outcomes?status=all&limit=100` sat pending for **2.1 minutes** and then
returned **524**, and `status=touched&limit=100` took **39.9s** — while every
other fetch on the page (`quotes-batch`, `tt-quotes`, `bzila-alerts`) queued
behind them, because a browser allows only 6 connections per host and the two
stalled requests were holding two of them.

### Why it was slow

`enrichOutcomesWithQuotes()` ran **inline inside the request, one row at a
time**: per tracked contract, a `fetchContractDailyBars()` call to Theta plus a
hardcoded `await sleep(120)`. At 100 rows that is 100 sequential vendor calls
and 12s of pure sleep before the first byte; at the Results view's 300-row
ceiling it is three times that. The 60s per-contract cache only helped once a
pass had already finished — and no pass ever finished before the proxy timed
out, so the cache stayed empty and every poll paid full price again.

### How it is fixed

**The request no longer does the work.** `computeOutcomeQuotes()` now starts (or
joins) a single background fill and `Promise.race`s it against a budget —
`FAR_CB_QUOTE_WAIT_MS`, default **2500ms**. Whatever is in the cache when the
budget expires is what ships; the pass keeps running and the next poll picks up
the rest. Cached entries are served even past their TTL: a slightly old mark
beats a blank column when a refresh is already in flight.

**The fill itself is parallel.** `FAR_CB_QUOTE_CONCURRENCY` (default 5) workers,
no per-row sleep, capped at `FAR_CB_QUOTE_MAX_PER_PASS` (default 60) contracts
per pass so a backlog fills over successive polls instead of pinning Theta.
The greeks snapshot is memoised per `(symbol, expiry)` and the queue is sorted
group-major, so parallel workers share a snapshot rather than each opening a
different one. A failed contract caches a null entry so a dead vendor is not
re-asked on every poll.

**`_quoteFill` is single-flight**, so N open scanner tabs share one pass rather
than each starting its own — previously the concurrent polls multiplied the
vendor load.

**`quotes=0`** skips enrichment entirely. `ResultsByDay` only renders per-day
counts and flag fields — it never reads `opt_price` — so the 300-row Results
fetch now sends `quotes=0` and is a straight DB read. The Tracked-results table
does show premium, so it keeps quotes on.

**Outcomes re-poll every 60s** while the tab is visible (`document.hidden`
skips it), so the contracts the background pass fills after the first response
appear without a manual refresh.

### Result

`/proxy/far-cb-outcomes` returns in <2.5s worst case and near-instantly once
warm, instead of 40s–2min-then-524. The connection-pool starvation that made
the whole Watch tab feel slow goes away with it.

### Tunables

| Env | Default | Meaning |
|-----|---------|---------|
| `FAR_CB_QUOTE_WAIT_MS` | 2500 | Max ms a request waits on the background fill |
| `FAR_CB_QUOTE_CONCURRENCY` | 5 | Parallel contract refreshes |
| `FAR_CB_QUOTE_MAX_PER_PASS` | 60 | Contracts refreshed per pass |

## 2026-08-13 - Ticker Lookup: record end-of-day per-strike GEX, show Δ 1D

New: `server-v2/eod-strike-gex-recorder.js`, `app/api/eod-strike-gex-change/route.ts`.
Edited: `server-v2/server-with-proxy.js` (defensive require + `startEodStrikeGexRecorder()`
+ two new `/proxy/*` routes), `server-v2/api-router.js` (one `register()`),
`components/pages/Analytics.tsx` (`TlLadder` Δ column, `TickerLookupCard` feed).

### What

The Ticker Lookup right pane could say where the structural gamma IS, never
what CHANGED. Nothing stored yesterday's board for anything but $SPX/SPY/QQQ.
Now a 16:05 ET job snapshots per-strike net GEX for the whole board minus 0DTE
across the full scanner watchlist (~169 symbols, roster re-resolved each sweep
so a ticker added on the Watchlists page starts recording that evening), and the
right pane grows a **Δ 1D** column plus a `Δ 1D vs close YYYY-MM-DD` baseline
line under the board label.

40 strikes above and 40 below the closing spot per symbol — sliced off the
strike INDEX like `tlWindow()`, so a $2.50 chain and a $50 chain both give 40
rungs a side. ~81 rows × 169 symbols/day. 400-day retention.

### How

**Same formula as the card, on purpose.** `/proxy/gex-by-strike-multi` already
returns this exact ladder and is deliberately NOT used — it is ThetaData-sourced
and sparse on single names, which is the documented reason the card stopped
reading it. The recorder re-implements the client's `accumulateChainGreeks()`
gex term against the same `fetchChainFull`: OI+Vol basis, same
`S² · 0.01 · 100`. Verified numerically — stubbed chain through both paths gives
byte-identical values. `Math.abs()` on each gamma is a no-op on TT data and a
guard against a signed put gamma silently flipping strikes positive.

**16:05 ET, once**, because the OI+Vol basis is half day-volume and that is only
final after the 16:00 print. Minute-poll + `_lastRunDate` claim (claimed before
the await, released if the sweep lands nothing) — same idiom as `oi-daily`.
Window stays open to 22:00 ET so an evening restart still captures the session.

**Δ is computed in Postgres, not the browser.** `getStrikeGexChange()` FULL JOINs
the two most recent snapshot DATES for the symbol — not calendar today/yesterday,
so a holiday or missed run degrades to "vs the last session we have". FULL, not
LEFT: the window follows spot, so a wall that came OFF has a prev row and no cur
row, and anchoring on cur would discard exactly the largest negative changes.
Verified against a real PG 16 instance: unwinds surface, new strikes read full
value, single-snapshot returns `prevDate: null`.

Re-fire clears the day's rows per symbol before writing — the window MOVES, so a
bare upsert would leave a day holding the union of two windows.

Client shows `—` (not 0) for a strike with no snapshot, and keeps the column off
entirely until a second session exists, so a column of zeros never gets read as
"the board didn't move".

**Proxy changes were additive only** — no existing route touched;
`proxy-tastytrade.js` is read-only (imported, not edited).

Manual fire: `POST /proxy/eod-strike-gex-run[?symbol=NVDA][&date=YYYY-MM-DD]`.
Kill switch: `EOD_STRIKE_GEX_RECORDER=0`.


## 2026-08-13 - Ticker Lookup: level chips are one uniform height

Edited: `components/pages/Analytics.tsx` (`TlLevelChip`, new `TL_CHIP_MIN_H` /
`TL_CHIP_ROW`, the `.tl-split` container and both chip rows).

### What

In the ticker-lookup popup off the Multi Greek chart, the four level cards —
CORE (CB) / CALL WALL / PUT WALL / GAMMA FLIP — were ragged. Cards grew when
their note or distance string wrapped, and the left pane's row sat at a
different height from the right pane's because the two ladders above them are
different lengths.

### How

Each chip row is now a fixed line box: the label, value, distance and note
lines carry explicit `lineHeight` values (14 / 24 / 15 / 15) and are clipped to
ONE line with `nowrap` + ellipsis, with the full string on `title` for hover.
The chip carries `minHeight: TL_CHIP_MIN_H` (92 = 14+24+15+15 + 6 gaps + 16
padding + 2 border) and `boxSizing: border-box`, so nothing can grow it.

The two rows now share one `TL_CHIP_ROW` style with `alignItems: "stretch"`
and `marginTop: "auto"`, and the `.tl-split` grid moved from
`alignItems: "start"` to `"stretch"` — so both panes are the same height and
both chip rows are pinned to the bottom, lining up across the split.

Affects the Analytics page's own `<TickerLookupCard />` too, which is the same
component.


## 2026-08-12 - GEX Map: a third field — gamma sign × delta sign

Edited: `app/test/GexMapTab.tsx` (`FIELD_MODES`, `buildModel`, `sliceModel`,
`TapeField`, `MapCard`, new `quadColor`).

### What

DEX per strike is now on the map, as a third tab beside HEATMAP and TERRAIN
rather than a layer painted over one of them. Four rounds of mockups all said
the same thing: anything drawn ON TOP of the gamma — rings, bars, hatching,
ribbons — either covers the field or is too faint to read. So the cell colour
IS the pair.

    green family  = positive gamma, dealers dampen
    rose family   = negative gamma, dealers amplify
    deep          = DEX positive  (dealers short delta · buy dips)
    light         = DEX negative  (dealers long delta · sell rips)

Two families of two, so the dampening-vs-amplifying read still lands from
across the room before you look at delta at all.

### How

`quadColor(g, d, intensity)`. The hue only COMMITS as |DEX| grows — at zero
delta a cell is the plain gamma colour of its family and slides to the corner as
delta arrives. Forcing every cell into one of four buckets by the sign of a
number that is mostly noise turns the field into a two-tone flag drawn by
rounding error. Brightness is `max(|GEX|, 0.75·|DEX|)`, and the cull runs on
that same combined magnitude: a strike carrying delta with thin gamma now
appears, which is the cell the plain heatmap drops and the whole reason the tab
is worth having. Colours were picked against live tape in a throwaway picker
mock; `WHITE_LIFT` is 0.52 because four hues need less burn-to-white than two.

The model gained `dexHeat` — signed DEX per cell, on the same geometric column
blend as the gamma, so the morning is legible in delta for the same reason it is
now legible in gamma. It is EMPTY unless `dexSurface`: the fallback DEX shape is
one ladder for the whole session, and stretching that across every column would
draw a surface the recorder never wrote. On a session without slot-aligned DEX
the tab draws the gamma and says so on the field rather than blanking or
pretending.

The four-state key renders above the chart on that tab only, and is deliberately
NOT `[data-capture-hide]` — a green/rose field is unreadable without it, so the
shared PNG has to carry it. The intensity slider now covers both cell fields.


## 2026-08-12 - GEX Map: the morning is back, and Terrain survives the snapshot

Edited: `app/test/GexMapTab.tsx` (`buildModel`, `TerrainField`),
`components/shared/CopySnapButton.tsx` (`settle`).

### What

Two things, both of them "it is there, you just cannot see it".

09:30–10:30 was rendering as an empty field. Open interest builds through a 0DTE
day, so the last hour's gamma is routinely 5–10× the first hour's; dividing
every cell by the session max put the morning at 10–15% of the scale, under the
cull threshold for most of the ladder. The tape appeared to start around lunch.

And the Terrain tab was MISSING from every PNG. html2canvas renders an `<svg>`
by serializing it to XML — a `<canvas>` serializes as an empty element, and the
terrain lives in a canvas inside a `<foreignObject>`. Everything else in the
frame is pure SVG and photographed fine, which is why it read as "the snapshot
doesn't even show the map".

### How

Each column is now divided by a geometric blend of the session max and its own:
`denom = gMax^0.4 · cMax^0.6`. w=0 is the old absolute scale; w=1 would be
per-column normalization, which is wrong on its own — a dead minute and the
closing bell would both render at full brightness and the map loses the one
thing it is read for. At 0.6 a morning column peaking at 12% of the session
lands near 42%: legible, still visibly weaker than the close, and continuous, so
no column ever steps between scales. The ratio only — `profile`, the rail and
every printed number stay absolute.

`TerrainField` takes `snap`. In capture mode it repaints the canvas at the
capture layout's width FIRST, then inlines that bitmap as an SVG `<image>` with
a data URL, which serialization does carry. Two-step on purpose: inlining the
pre-widening bitmap and stretching it would have put a smeared terrain in the
PNG. `CopySnapButton`'s wait grew a `settle()` — two frames for React's commit
and the browser's re-layout, then ~80ms for the repaint, then one more frame.
Leaving capture mode drops the bitmap and the paint effect refills the live
canvas.


## 2026-08-12 - GEX Map snapshot: the tape only

Edited: `app/test/GexMapTab.tsx` (`TapeField`, `TapeFieldCard`),
`components/shared/CopySnapButton.tsx`.

### What

The Tape Field snapshot photographed the whole card — the net DEX profile in
the left gutter and the net GEX profile rail and net GEX · session sparkline on
the right came along with it. Three side panels around a field that had been
squeezed into the middle third of the frame. The PNG is meant to be the gamma
tape: the heat/terrain field and the Net Vol GEX keel under it.

### How

`TapeField` takes a `snap` prop. It re-solves the SAME three-column layout with
two of the columns at zero — no left gutter, and a right column only wide
enough for the strike labels — so the field and the keel stretch across
everything that frees up. The viewBox is unchanged, so the PNG keeps its shape.
The strike ladder stays: it is the y-axis, not a panel, and a gamma map with no
price scale is unreadable. The removed pieces are removed from the tree, not
hidden, so nothing leaves a hole where it used to sit.

`CopySnapButton` gained optional `onBeforeCapture` / `onAfterCapture`. The
button flips capture mode on, waits two animation frames so React has committed
and the browser has laid the new geometry out (html2canvas reads the LIVE
element — a capture in the same tick photographs the old one), captures, and
flips it back in a `finally`, so a failed capture cannot strand the card in
print layout. Both props are optional; every existing caller is untouched.


## 2026-08-12 - Import photos: try every cover the page offers, not just one

Edited: `_lib-household-recipes.cjs` (`imageCandidates`, `captureImage`,
`importRecipe`, `createRecipe`), `recipe-vite/src/api.ts`,
`_lib-household-recipes.selftest.js`.

### What

Recipes were landing with letter-tile placeholders instead of photos. The
importer took exactly one image URL — `og:image` — and a TikTok `og:image` is
SIGNED and rate-limited: enough of them 403 during a bulk run to leave a
scattering of blanks, and by the time you notice, the URL has expired and there
is nothing left to retry. The same page carries two or three unsigned cover
fields in its rehydration blob the whole time.

### How

`imageCandidates(html, first)` returns up to six URLs, best first: og:image /
twitter:image, then `cover`, then `originCover` (always present, but sometimes a
black frame or a title card), then `reflowCover`, with the animated
`dynamicCover` last — a moving photo still beats a letter tile. Deduped on
origin+path, so the same frame under four signatures is one fetch, not four
identical 403s.

`captureImage` takes the list and works down it until one stores; a bare string
still works for the manual re-capture route. The list rides the draft through
the review screen, and is capped at six server-side because that makes it client
input. On the JSON-LD path the recipe's own image leads — a food blog's
og:image is occasionally a logo, and the LD image never is.

Selftests: 127 passing.

## 2026-08-12 - Quick sign-in: two people, one browser

Edited: `_lib-household.cjs` (`hh_device_pins` schema + migration, `setPin`,
`pinStatus`, `pinLogin`, `removePin`), `recipe-vite/src/api.ts`,
`recipe-vite/src/pages/Login.tsx`, `budget-vite/src/api.ts`,
`budget-vite/src/pages/Login.tsx`.

### What

Two people with two different PINs kept getting dropped back to the password
form. `hh_device_pins` was keyed on `device_hash` ALONE — one browser could hold
exactly one person's quick sign-in. Whoever set a PIN second took the row, and
`setPin` then minted a FRESH device token for them, which cut the first person's
row loose. Re-arming it bounced the other one off again. Both of them typing
email and password, forever.

### How

The key is now composite — `(device_hash, user_id)` — with a guarded migration
that widens the primary key in place on the live box. A browser keeps ONE device
token (the "this is a trusted browser" half of the credential); each person on
it gets their own row hanging off it.

`pinLogin` reads every row for the device and finds the one whose hash verifies
the digits typed — so the PIN itself picks which account opens. `setPin` refuses
a PIN another person on the same device already uses, because a collision would
make whose account opens a matter of row order. `pinStatus` returns `names[]`
and the pad greets "Brandon or Heather" instead of one name that is wrong half
the time.

The five-wrong-guesses lockout stays per BROWSER and takes everyone on it — a
wrong PIN doesn't say whose attempt it was. A correct PIN clears only its own
row's counter, so neither person can launder the other's failed guesses away.
"Turn off my PIN" now leaves the device cookie alone if the other person is
still armed on that browser.

## 2026-08-12 - Recipes: keep the whole TikTok write-up, and a third import outcome

Edited: `_lib-household-recipes.cjs` (`embeddedCaption`, `recipeSignals`,
`runJob`, `listImportMisses`), `_lib-household.cjs` (schema),
`recipe-vite/src/api.ts`, `recipe-vite/src/pages/Add.tsx`,
`_lib-household-recipes.selftest.js`.

### What

Two imports were being rejected as "not a recipe" when they weren't.

1. TikTok now ships an SEO write-up in a SEPARATE JSON field from the caption —
   ingredient notes, a numbered method, storage. The extractor took the single
   longest field, kept the marketing blurb and threw the write-up away, so the
   gate was handed a paragraph with no recipe in it and said so. Confirmed on
   the Cinnamon Sugar Hawaiian Rolls video.
2. `#EasyRecipes` never matched `\brecipe\b` — no word boundary after "Easy" —
   so a caption of nothing but food hashtags scored zero food words.

And a third outcome, because "food, but the method is spoken in the video" is
neither a failure nor a not-food: it is the one miss pile worth working by hand.

### How

`embeddedCaption` now keeps the longest FOUR prose fields instead of one, joined,
capped at 9k. Two tiers of key: named prose keys (desc/caption/content/…) at a
60-character floor, any other key at 320 AND it has to read like prose (50+
words, 3+ sentence stops, not a URL or a hex blob) — that second tier is what
catches the write-up, which sits under whatever key that week's build calls it.
Anything after the longest needs 120+ characters, which is what keeps "Sign up
to see more videos…" out. Substrings are dropped so the caption embedded in the
write-up isn't sent twice.

`normaliseCaption` splits hashtags on the case boundary (`#EasyRecipes` →
"Easy Recipes") before scoring, and `recipeSignals` returns a `food` count and
`foodNoRecipe` — food words present, no amounts and no method.

New item status `nowritten` and a job counter to match, checked BEFORE
`notRecipe` in `runJob` (the error sets both, so testing `notRecipe` first would
bury every one of them in the not-food pile). It stays out of the retry queue —
retrying fetches the same page to reach the same conclusion. The Not-imported
list sorts these first and labels them `NO RECIPE` in the warn colour; failures
and not-food follow.

Selftests: 120 passing, including the real Hawaiian rolls caption and a
long-id/long-URL page that must still return no caption.

## 2026-08-12 - Recipes: follow "full recipe" links, flag "recipe in bio", fix the day picker

Edited: `_lib-household-recipes.cjs` (`captionLinks`, `mentionsRecipeElsewhere`,
link-following in `importRecipe`, `planMeal` default), `_lib-household.cjs`
(`recipe_url`, `partial`, `partial_note`),
`recipe-vite/src/{api.ts,pages/Recipe.tsx,pages/Cookbook.tsx,pages/Week.tsx}`,
`budget-vite/src/{components/Shell.tsx,pages/Settings.tsx}`.
Verified: selftest 100 → **112 passed**; `tsc` + build clean for BOTH SPAs
(budget checked against its real source, not a copy); household boots with 31
routes.

### "Full recipe in bio" — two habits, opposite handling

**Caption links the write-up → follow it.** The blog almost certainly publishes
JSON-LD, so one extra fetch turns a summary caption into an exact recipe, for
free and better than the AI could reconstruct.

`source_url` stays the VIDEO. That is what you saved, what you'll want to watch,
and — critically — what `source_key` is derived from: swapping in the blog URL
would make a TikTok export list re-import every one of these on the next batch.
The followed page lands in `recipe_url` and shows as **Full recipe ↗** beside
**Watch**.

Aggregators (`linktr.ee`, `beacons.ai`, `stan.store`, …), socials and affiliate
shops are never followed — a bio link is a menu of buttons, and fetching one
spends an AI call on a page with no food in it. Depth is capped at one hop: a
link on a recipe page is a *related* recipe, not this one.

**Caption just says "recipe in bio" → import it FLAGGED.** `partial = true` and
`partial_note` set to the creator's own phrase, quoted rather than paraphrased.
The banner sits ABOVE the ingredients, deliberately: half a recipe you don't know
is half is worse than none, because you find out at step four with the pan hot.
Rows show `PART` in preference to `NEW` — incomplete is worth knowing before you
open it, where unreviewed can wait.

When the gate rejects such a caption outright, the miss reason quotes the phrase,
so the by-hand list can tell "the recipe is in their bio" from "this is a dog
video". One is worth chasing.

### Two bugs

- **The day picker closed itself a second after opening.** It submitted from
  `onChange`, and a native date input fires that while you are still spinning the
  wheels on iOS — so it planned whatever partial date it saw and dismissed. Now
  the value is held in state and confirmed with a **Plan it** button.
- **Planning no longer adds to the grocery list.** `planMeal`'s `withList` now
  defaults to FALSE. Planning and shopping happen at different moments: you plan
  the week on Sunday and shop on Wednesday, and a plan that silently dumps forty
  ingredients in means the list is full of things you already own by the time you
  get there. **Add all** is one tap on the recipe and belongs to the person
  deciding to shop.

### Cards

No accent edges. Today's card on Week lost its 2px left rule — a coloured edge on
one card in a column of seven reads as a defect, not emphasis; the day NAME in
accent already says it. The two warning cards lost their tinted borders for the
same reason: the colour lives in the label.

### budget.cbedge.net

`Journal` → **Cookbook**, linking to recipe.cbedge.net. Opens in a new tab so the
budget app is never replaced — losing your place mid-shop to look up a recipe is
exactly the annoyance to avoid. It renders permanently in the accent colour since
it can never be "current": it is a destination, not a location. Journal kept its
route and its data and moved to **More**, exactly as Habits and Projects did when
Todo and Lists took their slots.

### Deploy

```
git pull
docker compose build household && docker compose up -d --force-recreate household
curl -s http://127.0.0.1:3010/health          # routes: 31
docker compose build recipes budget && docker compose up -d recipes budget
```

## 2026-08-12 - Bulk import: a "Not imported" list you can copy or download

New: `listImportMisses()`, `GET /api/hh/recipes/bulk?misses=1`, a Not imported
card on the Bulk tab.
Edited: `_lib-household-recipes.cjs`, `household-routes.cjs`,
`recipe-vite/src/{api.ts,pages/Add.tsx}`.
Verified: 31 routes, endpoint 401s without a session, selftest 100 passed,
`tsc` + build clean.

### What

With 1,480 links going through in batches of 60, the ones that don't import are
the ones you actually need a record of — and they were only visible inside the
progress panel of the job that produced them. Twenty-five batches means
twenty-five panels, and nobody opens each one to copy six URLs out of it.

### How

- **One list across every job**, not per-job. Status, reason and a link out to
  the video, plus **Copy URLs** and **Download .txt**.
- **It shrinks by itself**, which is what makes it trustworthy enough to work
  from. Excluded: any URL that ever succeeded in ANY job — retry-failed and a
  re-paste both leave the old failed row behind, and showing it would send you
  chasing a recipe you already have — and any URL whose recipe now exists by
  `source_key`, which covers importing it by hand afterwards.
- **`DISTINCT ON (url)` ordered by `updated_at DESC`**, so a link tried three
  times appears once, with the reason it failed LAST rather than first.
- `failed` and `notrecipe` are returned together but tagged, because they are
  different jobs for you: a failure is worth retrying, a not-food is worth
  eyeballing first.
- The `source_key` filter runs in JS, not SQL — the key is derived in JS and this
  is a few hundred rows at most.
- The .txt is built in the browser from data already on screen: no endpoint,
  nothing to authenticate, works with no network once the card has loaded. Copy
  falls back to expanding the list when the clipboard API is blocked, which it is
  outside a secure context and in some in-app browsers.
- The card refetches on every change to the running job's counters, so a link
  that fails joins the pile while you watch and a successful retry leaves it.

## 2026-08-12 - Bulk import: skip non-recipes before they cost an AI call

Edited: `_lib-household-recipes.cjs` (`recipeSignals`, `looksLikeRecipe`, the
gate in `importRecipe`, `notrecipe` handling + a politeness pause in `runJob`),
`_lib-household.cjs`, `household-routes.cjs`,
`recipe-vite/src/{api.ts,pages/Add.tsx}`.
Verified: selftest 89 → **100 passed**, including the real garlic-bread caption
passing and a CapCut tutorial being rejected. `tsc` + build clean, 31 routes.

### What

Brandon's TikTok data export arrived: **1,480 favourites**, and only Date + Link
in it — no titles. Favourites are not a recipe list, they're everything ever
bookmarked; his includes a "Capcut" collection.

Importing all of them would have been ~$25 and ~3 hours, and most of the money
would have gone on non-recipes: each one cost a full Claude call before coming
back "that doesn't look like a recipe". That is paying an LLM to repeat what the
caption already said.

### How

- **`recipeSignals(text)`** scores the caption on four axes: amounts (`500g`,
  `2 tbsp`, `350F`), method verbs, recipe words (`ingredients`, `macros`,
  `serves`) and food nouns — reusing the HEROES list the main-ingredient guess
  already needed. **One strong signal passes, or two weak ones.**
- It runs **after** the page fetch and the caption extraction, both free, and
  **before** `aiExtract`, which is not. The fetch is what produces the caption,
  so the gate can't sit any earlier and the saving is exactly the expensive half.
  ~$25 → ~$6 on this list.
- **Deliberately generous.** A false negative is one manual import; a false
  positive is about two pence. It is a spend filter, not a classifier, and it is
  tuned in that direction on purpose.
- **The JSON-LD path is never gated.** A page that publishes `recipeIngredient`
  has already proved what it is; running a word filter over it would be pure
  downside.
- A rejection is its own outcome — item status `notrecipe`, its own counter,
  `NOT FOOD` in the progress list. Not a failure (the failure count should mean
  "the import is broken"), and **not retried**, since retrying would re-fetch the
  same page to reach the same conclusion.
- Single imports get **Import anyway** when the gate rejects them — for a video
  where the method is spoken rather than written.
- **800ms pause between items, per worker.** 1,480 links through two workers with
  no breather is a sustained hammering of one host and the fastest way to get the
  whole batch 403'd. Next to a multi-second fetch it barely shows.

### Running the export

25 batch files of 60 were generated from the export, newest first. Suggested
order: deploy, run **batch-01** as a pilot, read the saved / not-food / failed
split, and tune the word lists from real numbers before doing the other 24.

### Deploy

```
git pull
docker compose build household && docker compose up -d --force-recreate household
curl -s http://127.0.0.1:3010/health          # routes: 31
docker compose build recipes && docker compose up -d recipes
docker compose exec -T household node server-v2/scripts/backfill-recipe-derived.js
```

## 2026-08-12 - Bulk import: share-link handling, cross-batch dedupe, retry failed

Edited: `_lib-household-recipes.cjs` (`sourceKey`, `authorFromHtml`,
`handleFromUrl`, `fetchPage`, `runJob`, `retryImportJob`), `_lib-household.cjs`
(`source_key`, `hh_recipe_import_jobs.skipped`), `household-routes.cjs`,
`recipe-vite/src/{api.ts,pages/Add.tsx}`.
Renamed: `backfill-recipe-mains.js` → `backfill-recipe-derived.js` (it now fills
`source_key` as well — one command after a deploy beats two).
Verified: selftest 76 → **89 passed**; `tsc` + build clean; household boots with
31 routes.

### What

Prompted by a real question before importing a TikTok favourites export: what
happens when the same video appears in two pastes?

Answer, before this: two recipes. And a worse one nobody had noticed —
**TikTok's data export does not write the pretty URL**. Favourites come out as
`tiktokv.com/share/video/<id>`, the share sheet gives `vm.tiktok.com/<code>`, and
only the site itself writes `tiktok.com/@handle/video/<id>`. `handleFromUrl` only
knew the third shape, so a hundred-link export would have credited every single
recipe to "tiktokv.com" instead of its creator.

### How

- **`fetchPage` now returns `{ html, finalUrl }`.** A share link redirects; the
  by-line and the dedupe key both need where we LANDED, not what was pasted.
- **`sourceKey(url)`** normalises the three shapes to one identity:
  `tiktok:<id>`, `instagram:<code>`, else host + path with tracking junk and
  trailing slashes dropped. Stored on `hh_recipes.source_key`, indexed.
  **Not a unique constraint** — a duplicate should be skipped in code with a
  message, not rejected by the database in a way that fails the import row.
- **The dedupe check runs TWICE per import, deliberately.** Once before the
  fetch, which costs one indexed lookup and catches a canonical link pasted in an
  earlier batch. Once after, because `vm.tiktok.com/ZGxyz` carries no id at all —
  only the resolved URL can tell you it's something you already have. The second
  check happens after a fetch we've already paid for but before the AI call,
  which is the expensive half.
- A skip is `HAVE IT` in the progress list and its own counter — it is the
  dedupe working, not a failure, and burying it in the failure count would make
  a clean second paste look broken.
- **`handleFromUrl` was rewritten per-platform** rather than "first path segment
  that looks like a word". TikTok handles are always the `@`-prefixed segment;
  scanning loosely read `/share/video/<id>` as the handle "share", and excluding
  that word just made it grab the video id instead. Instagram only treats the
  FIRST segment as a profile, so `/reel/CxYz` is a post and not a person — the
  old test asserting `@reel` was encoding that bug and is gone.
- **`authorFromHtml`** reads `"uniqueId"` out of the rehydration blob. The page
  beats the URL because an export link has no handle in it at any point.
- **Retry failed** requeues only `failed` rows and rewinds the counters by that
  many rather than zeroing them — `done` must keep counting finished work or the
  progress bar jumps backwards. Safe to press repeatedly.

### Deploy

```
git pull
docker compose build household && docker compose up -d --force-recreate household
curl -s http://127.0.0.1:3010/health          # routes: 31
docker compose build recipes && docker compose up -d recipes
docker compose exec -T household node server-v2/scripts/backfill-recipe-derived.js
```

Run the backfill BEFORE pasting a big list — without `source_key` on the recipes
you already have, the dedupe has nothing to match against and the batch re-imports
them.

## 2026-08-12 - Cookbook: Week tab replaces Saved, ★ becomes a filter chip

New: `recipe-vite/src/pages/Week.tsx`, `GET|POST /api/hh/recipes/week`,
`getPlannedWeek` / `unplanMeal` / `moveMeal`.
Edited: `_lib-household-recipes.cjs`, `household-routes.cjs`,
`recipe-vite/src/{api.ts,App.tsx,components/Shell.tsx,pages/Cookbook.tsx,pages/Settings.tsx}`.
Verified: household boots with **31 routes**, both new endpoints 401 without a
session, selftest 76 passed, `tsc` + build clean.

### What

"Saved" was the cookbook filtered to `favorite = true` — the same component with
one prop. That is a whole tab for one boolean, on a screen where every recipe is
already saved by definition.

The distinction earns a tab in the reference app because it has a *Discover*
feed of recipes you don't own, so "saved" means you pulled one out of someone
else's stream. There is no such feed here, so the tab was carrying no weight —
and once the filter toolbar shipped this morning it was carrying none at all,
because ★ belongs next to category and main ingredient.

Meanwhile "Pick a day" wrote an `hh_meals` row you could only see by opening
budget.cbedge.net. Planning a meal felt like it went nowhere.

### How

- **★ moved into the Cookbook filter row**, leading it — it is the one filter you
  reach for without reading the others. `/saved` redirects to `/cookbook` so an
  old home-screen shortcut or a bookmark still lands somewhere sensible.
- **Week reads `hh_meals`**, the same rows the household week board writes and
  `planMeal()` creates. There is no second plan to keep in step: move something
  there and it moves here.
- **`LEFT JOIN`, not `INNER`.** A meal typed straight into budget.cbedge.net
  ("chinese takeaway") has no `recipe_id`. Dropping those would make this screen
  quietly disagree with the table it shares, and "Thursday is free" would be a
  lie — so they show, greyed and unclickable, minus the photo.
- The query is deliberately **leaner than `_lib-household-lists.cjs`'s
  `getWeek()`**: that one nests every ingredient under every meal because the
  Lists screen ticks them off. This screen needs a photo, a title and a time.
- Today gets a 2px accent left edge and nothing else. Filling the card would make
  one of seven days shout on a screen you scan.
- Dates render from split parts, never `new Date('2026-08-14')` — that parses as
  UTC and shows the day before for anyone west of Greenwich.
- ✕ unplans: deletes the `hh_meals` row and nothing else. The ingredients stay on
  the grocery list (`ON DELETE SET NULL`), because you may well still want them.

### Deploy

```
git pull
docker compose build household && docker compose up -d --force-recreate household
curl -s http://127.0.0.1:3010/health          # routes: 31
docker compose build recipes && docker compose up -d recipes
```

## 2026-08-12 - Cookbook: sort toolbar, "main ingredient", and bulk URL import

New: `main_ingredient` + `needs_review` columns, `hh_recipe_import_jobs` /
`hh_recipe_import_items`, `POST|GET /api/hh/recipes/bulk`,
`server-v2/scripts/backfill-recipe-mains.js`, a Bulk tab on Add.
Edited: `_lib-household-recipes.cjs`, `_lib-household.cjs`,
`household-routes.cjs`, `household-server.js`, `deploy/household/Dockerfile`,
`recipe-vite/src/{api.ts,pages/Cookbook.tsx,pages/Add.tsx,pages/Recipe.tsx}`.
Verified: selftest 45 → **76 passed**; `npx tsc --noEmit` and `npm run build`
clean; the household process boots with **30 routes** and every new endpoint
401s without a session.

### Sorting

Seven orders — recently added, recently changed, name, main ingredient, cook
time, most cooked, calories — resolved from a **whitelist** of fixed `ORDER BY`
fragments. There is no path from a query parameter into the query text, and the
selftest asserts every fragment is free of placeholders and statement breaks.

Server-side, like search, because sorting in the client sorts the *page* rather
than the cookbook.

Favourites no longer jump the queue. They did while "recently added" was the only
order, but a "sort by name" that silently floats four starred recipes above the
As isn't sorted by name — it's sorted by something you didn't ask for.

The toolbar is collapsed behind one line by default: three stacked filter rows on
a 390px screen push the first recipe off the fold, and most visits are "open it
and scroll".

### Main ingredient

A **stored column**, not a per-query derivation — deriving it means unpacking a
JSONB array for every row of the index screen, and you can't `ORDER BY` it
without doing that twice. Written on create, recomputed when the title or the
ingredients change.

The guess reads the **title first**. "Cheesy Butter Chicken Garlic Bread" has
sixteen ingredients and exactly one of them is the point; an ingredient-first
scan files it under *ciabatta loaf*, the line that happens to be listed first.
Only when the title yields nothing does it fall back to the best-ranked
ingredient aisle (meat → produce → dairy → …). Heroes are matched
longest-first, so a thigh recipe doesn't land under plain "chicken".

When neither is confident it stays **NULL and sorts last**. A recipe filed under
a random pantry item sorts somewhere absurd — worse than sitting in the unsorted
bucket where you can see it needs a hand.

It also became a filter facet ("chicken · 7"), because a sort you can't narrow to
is half a feature, and it took the Skill slot in the recipe stat row — a value
you can sort by but never see is a value you distrust.

### Bulk import

`POST /api/hh/recipes/bulk {urls}` takes a paste of up to 60 links — newlines,
commas, stray quotes, duplicates dropped by origin+path so the same video shared
twice imports once.

It **cannot** be one request: thirty TikToks is thirty fetches plus thirty Claude
calls, minutes of work, past nginx's 180s and long past how long a phone screen
stays awake. So the POST writes rows and returns a job id, two workers chew
through the queue, and the client polls every 2s while it runs.

Both tables are real rows, which buys three things: the progress list survives a
refresh, a failed link records its error beside its URL while the other
fifty-nine carry on, and a batch mid-flight when the process died is **resumed on
boot** — from `household-server.js` only, never from the api-router fallback
mount, because import work has no business in the trading process. Items are
claimed with `FOR UPDATE SKIP LOCKED`, so a double resume finds nothing to do
rather than importing everything twice.

**The one policy decision: bulk saves without review.** Single imports still
never touch the database until you press save. Bulk writes immediately with
`needs_review = true`.

That inconsistency is the point. A review queue you must clear before anything
lands is a queue nobody clears at thirty items — you'd sit through twenty screens
or abandon the batch and lose the lot. Saving first and flagging second means the
work is never wasted: recipes are searchable and cookable at once, "N TO REVIEW"
is a filter chip on the Cookbook, rows carry a NEW tag, and each recipe shows a
banner with one button to clear it. A wrong amount in a saved recipe is a small
annoyance; re-pasting thirty links is not.

Cancel stops the queue but lets the in-flight item finish and save — killing a
Claude call already paid for is pure waste.

### Deploy

```
git pull
docker compose build household && docker compose up -d household
curl -s http://127.0.0.1:3010/health          # routes: 30
docker compose build recipes  && docker compose up -d recipes
docker compose exec -T household node server-v2/scripts/backfill-recipe-mains.js
```

Run the backfill or the whole existing library sits in the NULL bucket and "sort
by main ingredient" looks broken on the one screen you'd check it on.

## 2026-08-12 - Household backend runs in its own container — recipe/budget deploys no longer restart the trading app

New: `server-v2/household-server.js`, `deploy/household/{Dockerfile,package.json}`,
compose service `household`.
Edited: `server-v2/api-router.js` (household mount now opt-in),
`docker-compose.yml`, `budget-vite/nginx.conf`, `recipe-vite/nginx.conf`,
`recipe-vite/README.md`.
Verified: booted the new process against an unreachable DATABASE_URL —
`/health` 200 with 29 routes registered, `/api/hh/recipes` 401 no-session,
DELETE 405, unknown path 404, and `/api/gex` 404 (proving the trading routes
genuinely are not in this binary).

### What

`/api/hh/*` used to be registered inside `api-router.js`, which meant the
cookbook and the budget app ran in the same process as the TastyTrade/dxLink
feed, the WebSocket server and every in-process recorder. Two consequences,
both bad:

1. **Deploy coupling.** `server-v2` is baked into the dashboard image, so a
   one-line fix to a recipe parser required `docker compose build dashboard` —
   a full `next build` — and a restart that dropped `/ws/gex` and made Theta
   reconnect. Today's TikTok caption fix did exactly that, twice. At 10:30am it
   would have taken the GEX feed down mid-session for a change no customer can
   see.
2. **Shared fate.** An unhandled rejection or a leak in household code — the
   recipe photo path buffers image blobs in memory — degraded the process
   recording market data. nginx already stopped these apps reaching `/ws` and
   `/proxy` at the network level; nothing stopped them sharing a heap.

### How

- **`server-v2/household-server.js`** — a small http server that mounts
  `household-routes.cjs` and nothing else. This was cheap because that module
  was already written as a mountable router taking `{ register, send, readJson }`
  and uses **no `ctx` at all**, so the three primitives were copied verbatim
  from api-router.js and everything else worked unchanged. No route is
  implemented twice.
- **Only two auth levels exist in it** — `public` and `household`. There is no
  code path from a cbedge.net session into household data because the code to
  follow one isn't in the binary; a route asking for `owner` gets a 500 rather
  than a guess.
- **`deploy/household/Dockerfile`** — its own `package.json` with `pg` and
  `dotenv`, because the entire household stack requires `pg` plus node builtins
  and nothing else. No Next, no React, no puppeteer download. Files are copied
  by EXPLICIT NAME rather than `COPY server-v2/`: the moment the image can see
  the trading modules, someone requires one and the isolation is gone silently.
- **Compose service `household`** on `127.0.0.1:3010`, `env_file: .env.local`,
  with its own healthcheck. `HH_PORT`, not `PORT` — `.env.local` sets `PORT` to
  the dashboard's 3002 and env_file is applied first, so a separate name means
  they can never collide.
- **budget-vite and recipe-vite nginx** now `set $up household:3010`. Their
  `depends_on` moved to `household`.
- **api-router.js's mount is now opt-in** behind
  `HOUSEHOLD_ROUTES_IN_DASHBOARD=1`, left unset. That exists for one situation:
  the household container is down or unbuilt and you want budget.cbedge.net back
  by pointing its nginx at `dashboard:3002`. With it on, the isolation above is
  gone — it is a fire escape, not a setting.

### What did NOT change, deliberately

**The database.** Same `DATABASE_URL`, same tables. "Add all" on a recipe still
writes `hh_list_items` rows that budget.cbedge.net reads, and both apps still
share one `hh_users` login. Splitting the data would mean building an API
between two of your own apps plus a second password — and a clean
household-vs-trading DB line doesn't exist anyway, since the budget screens read
the same tables `/owner/budget` writes.

### Deploy

The trading app does not need to restart for this. Bring the new backend up
first, then repoint the two SPAs:

```
git pull
docker compose build household && docker compose up -d household
curl -s http://127.0.0.1:3010/health        # {"ok":true,"routes":29,"db":true}

docker compose build recipes budget
docker compose up -d recipes budget
```

Confirm both apps still work (sign in, open the grocery list), then rebuild the
dashboard whenever it next suits you — after the close — to drop the now-dormant
in-process copy:

```
docker compose build dashboard && docker compose up -d dashboard
```

Until that rebuild the old image still registers the routes internally. Harmless:
nothing routes to them any more.

## 2026-08-12 - Cookbook goes dark: recipe.cbedge.net now uses the budget theme

`recipe-vite/src/theme.ts` (replaced), `src/index.css`, `index.html`,
`public/manifest.json`, the five icon PNGs, `src/components/Shell.tsx`,
`src/pages/{Recipe,Add}.tsx`, `README.md`. `npx tsc --noEmit` and
`npm run build` clean.

### What

The cookbook shipped in a warm-paper light theme, on the reasoning that a recipe
is read in a bright kitchen and food photographs better on white. That reasoning
holds in isolation and was wrong in context: this app shares a login, a grocery
list and a week board with budget.cbedge.net, and sitting next to it in cream
made one product look like two.

### How

- **`src/theme.ts` is now a verbatim copy of `budget-vite/src/theme.ts`**, plus
  the `minutes()` helper at the bottom. Copied, not imported — same rule as the
  auth screens: the apps build independently and a shared module would let a
  budget change break this build. Every page already consumed the theme through
  the same helper names (`T`, `section`, `button`, `segment`, `label`,
  `display`, `body`, `input`), so nothing else had to move.
- `index.css`, the `theme-color` meta, the manifest colours and the five icons
  all follow to `#05060A`. iOS status bar goes back to `black-translucent`;
  `color-scheme: dark` so native date pickers stop rendering a white popover.
- **The hero controls flipped from a white pill to near-black at 62% with a
  blur.** The photo is now the only light surface in the app: a white chip on it
  disappears against a plate or a bowl of cream, a dark one reads against food
  of any colour AND matches the page it scrolls into. Hairline stays white — a
  dark border on a dark chip over an unpredictable photo has no edge at all.
- **A bottom fade under the hero.** A bright rectangle butting straight into a
  near-black page reads as a rendering seam.
- Tab bar switched to budget's mono caps. Four tabs at ~97px each keep the
  0.12em tracking budget had to drop at six.
- Add's three-way mode row became a `segment()` control instead of three
  buttons: `button('primary')` is the page's one filled action and belongs on
  Import — spending it on a mode switch leaves nothing to mark the actual verb.

### Deploy

SPA only — the backend didn't change.

```
git pull && docker compose build recipes && docker compose up -d recipes
```

## 2026-08-12 - Recipe photos are copied into Postgres, and you can shoot your own

New: `hh_recipe_images` table, `GET/POST /api/hh/recipes/image`,
`server-v2/scripts/backfill-recipe-images.js`.
Edited: `server-v2/_lib-household.cjs`, `_lib-household-recipes.cjs`,
`household-routes.cjs`, `recipe-vite/src/{api.ts,pages/Cookbook.tsx,pages/Recipe.tsx}`,
`recipe-vite/nginx.conf`. `npx tsc --noEmit` clean, `npm run build` clean,
selftest 59 passed.

### What

The cookbook was storing the source page's `og:image` URL and rendering from it.
That is fine for a blog and wrong for everything else: a TikTok or Instagram
cover is a SIGNED CDN link with an expiry in the query string. It works the day
you import and 403s a day or two later, so the cookbook would have quietly
decayed into a wall of letter-tile placeholders — worst of all on exactly the
imports that just started working.

So the bytes get copied at import time, and there's now a photo picker on the
recipe screen for shooting your own.

### How

- **`hh_recipe_images`** — `recipe_id` PRIMARY KEY (one photo per recipe, and
  the upsert is a plain `ON CONFLICT`), `mime`, `bytes BYTEA`, `etag`,
  `source_url`. `ON DELETE CASCADE`, unlike the `recipe_id` backlinks on
  `hh_list_items`/`hh_meals` — an orphaned blob helps nobody, where an orphaned
  grocery item you're standing in the shop holding does.
- **A separate table, not a column on `hh_recipes`.** This is the load-bearing
  part: nothing can drag image bytes into a list query by accident. The cookbook
  index selects twenty rows to draw 64px thumbnails; with `bytes` on that row it
  would be a multi-megabyte response every time. `CARD_SELECT`/`FULL_SELECT` add
  only a correlated subquery for the etag, never the bytes.
- **`etag` is a content hash and the client appends it as `?v=`.** That is what
  makes `immutable, max-age=1 year` safe — replace a photo and the URL changes,
  so every phone refetches instead of showing last month's picture until next
  year. Without `v=` the route falls back to `max-age=60`. `If-None-Match` is
  honoured, so a phone that already has the photo gets a 304.
- **Capture runs in the BACKGROUND on create**, deliberately not awaited: saving
  a recipe must not sit on someone else's CDN for ten seconds. The gap is
  covered because `image_url` is still fresh at that moment and `imageSrc()`
  falls back to it — by the time that link expires the bytes are here. Every
  failure path in `captureImage` returns null rather than throwing, so a slow
  CDN can never roll back a saved recipe.
- **Referer header on the capture fetch.** TikTok's CDN 403s a request without
  one; sending the image's own origin is enough to look ordinary.
- **Phone upload downscales in the BROWSER** (`downscale()` in `src/api.ts`,
  canvas → 1400px → JPEG q0.82, ~200-400KB). No `sharp` in the backend: a native
  image dependency is a bigger image and a build that breaks on a base-image
  bump, to save a couple hundred KB on a picture the source already sized for
  the web. Upload rides the existing JSON reader as a data URL — the household
  backend has no multipart parser and doesn't need one. nginx
  `client_max_body_size` 2m → 16m so an oversized body fails the server's own
  8MB check with a real message instead of a bare 413.
- The file input resets `value` after each pick, or choosing the same photo
  twice after a failure fires no change event and reads as a dead button.

### Deploy

```
git pull && docker compose build dashboard && docker compose up -d dashboard
docker compose build recipes && docker compose up -d recipes
docker compose exec -T dashboard node server-v2/scripts/backfill-recipe-images.js
```

The backfill copies photos for recipes imported before this change. Run it
promptly — a signed link that expired last week can't be recovered, only
re-imported.

## 2026-08-12 - Recipe import: read the caption out of JS-rendered pages (TikTok, Instagram)

`server-v2/_lib-household-recipes.cjs` — new `metaContent()`, `embeddedCaption()`,
`handleFromUrl()`; `importRecipe()`'s fallback now builds its text from all three
sources. Verified `node server-v2/_lib-household-recipes.selftest.js` — 59 passed
(was 45).

### What

A TikTok link imported as "That doesn't look like a recipe." The pipeline was
working perfectly — key valid, page fetched (HTTP 200, 396KB) — and Claude was
right: what it got handed WAS not a recipe.

TikTok, Instagram and every other client-rendered site ship an empty `<body>`
and put the words in a JSON blob inside a `<script>`. `stripTags()` throws
`<script>` away, correctly, which meant the AI received a page of nothing while
the full recipe sat in the HTML the whole time. Confirmed on the box: no
`og:description` at all, and the entire caption — title, macros, ingredients,
method — in a `"desc"` field.

### How

- **`embeddedCaption(html)`** scans raw HTML for JSON string fields holding
  prose and takes the longest. Keys are restricted to `desc` / `description` /
  `caption`, plus Instagram's nested `edge_media_to_caption` → `text`. Matching
  a bare `"text"` key was rejected: it sweeps up button labels and menu items,
  and longest-wins would then pick a cookie-consent paragraph over the recipe.
  A 60-char floor drops SEO blurbs; `JSON.parse('"'+m+'"')` un-escapes, so `\n`
  comes back as real newlines (or the AI sees one run-on paragraph) and emoji
  surrogate pairs survive.
- **`metaContent()`** reads a `<meta>` value in either attribute order —
  `property=`/`name=` first or `content=` first. Sites are inconsistent, and the
  old inline `og:image` regex only handled one of the two.
- **`importRecipe()` fallback order is caption → meta description → page body.**
  One path covers both cases: on a JS-rendered page the body is a shell and the
  caption is everything; on an ordinary blog the extractor finds nothing and the
  body carries it. Order also decides what `aiExtract`'s 24k cap trims — the
  tail of a long blog post, never the caption we went looking for.
- **Empty-page guard.** Under 40 readable characters now throws
  "didn't return any readable text — it may block automated readers" instead of
  paying for an AI call that can only fail.
- **`handleFromUrl()`** — a TikTok/Instagram import is credited `@fit_foodie_lulu`
  rather than `tiktok.com`. That's the by-line the creator is owed, and it
  matches how the reference app reads.

### Deploy

`server-v2` is baked into the dashboard image, so this needs a rebuild, not just
a restart:

```
git pull && docker compose build dashboard && docker compose up -d dashboard
```

## 2026-08-12 - New app: recipe.cbedge.net — the cookbook, wired into the household grocery list

New: `recipe-vite/` (SPA), `server-v2/_lib-household-recipes.cjs`,
`server-v2/_lib-household-recipes.selftest.js`.
Edited: `server-v2/_lib-household.cjs` (schema), `server-v2/household-routes.cjs`
(routes), `docker-compose.yml` (the `recipes` service).
Verified: `node server-v2/_lib-household-recipes.selftest.js` — 45 passed;
`npx tsc --noEmit` clean; `npm run build` in `recipe-vite/` clean.

### What

A fourth app on the household stack, modelled on the Julienne cooking app: paste
a recipe link, get a recipe; scale it to how many you're feeding; send the
ingredients to the grocery list that already exists.

It is NOT a standalone cookbook. It shares the household auth (`hh_users` /
`hh_session` — one password, one PIN) and, deliberately, the household *tables*:

- **"Add all"** inserts real `hh_list_items` rows, aisle-sorted, at the scaled
  amount. They appear on budget.cbedge.net's grocery list immediately, because
  it is the same list. No mirror, no sync step to fall out of date.
- **"Pick a day"** inserts an `hh_meals` row, so a planned recipe lands on the
  week board with its ingredients attached to it.

Both new columns are `recipe_id ... ON DELETE SET NULL`: deleting a recipe must
not pull tortillas off a list you're standing in the shop holding, or blank out
Tuesday on the week board.

### How

**Import — structured data first, AI second.** `POST /api/hh/recipes
{action:'import'}` fetches the page (15s cap, 3MB cap, http/https only, private
address space refused so a pasted link can't probe the VPS's own network), then
looks for a `schema.org/Recipe` node in any `application/ld+json` block,
including inside `@graph`. Most food blogs publish one because Google requires
it — that path is free, instant and exact. Only when it's missing, or the node
has no ingredients (a roundup post), does the page get stripped to text and sent
to Claude. Pasted text always takes the AI path; there is nothing structured in
an Instagram caption to read.

Import **never writes to the database**. It returns a draft for the review
screen and nothing is saved until you press save there — import is the step most
likely to get something subtly wrong, and a cookbook that quietly fills with
half-read blog posts is worse than one you paste into by hand. The review screen
also says which path read it, so an AI import gets a closer look.

**Ingredients are stored three ways** —
`{ raw, qty, unit, item, aisle }`. `raw` is the line as written and is what you
read while cooking; the parsed pieces exist for two jobs only, scaling and the
grocery hand-off. The parser is deliberately conservative: "a pinch of flaky
salt" gets `qty: null` and passes through every scale factor untouched, because
you cannot double a pinch and a scaled `0.375 tsp` is worse than no number.
Aisle guessing is `_lib-household-lists.cjs`'s `guessAisle`, reused rather than
reimplemented, so an ingredient added from a recipe files itself exactly where
it would if you'd typed it on the list.

**Schema.** `hh_recipes` holds ingredients and steps as JSONB **on the recipe
row**, not in child tables. An ingredient has no life of its own — never
queried, sorted or joined outside its recipe, and always written as a complete
replacement on save. Child tables would buy ordering columns, a
delete-and-reinsert dance per save and three round trips to render one screen,
in exchange for nothing this app does. Search still reaches inside via
`ingredients::text`, which is what makes "what can I make with gochujang" work.
Created by `ensureSchema()` on the first household request after deploy — no
migration to run.

**`formatQty` exists twice**, in the server lib and in
`recipe-vite/src/pages/Recipe.tsx`. The servings stepper re-renders on every tap
and a round trip per tap would feel broken. The selftest is the shared contract
— change one, change both.

**The SPA** is `budget-vite`'s skeleton with a light palette: warm paper, serif
titles, one terracotta action per screen, photo-first recipe page (Shell drops
its header on `/r/:id` so the food is the first thing on screen). The auth
screens are copies of budget-vite's, not imports — the two apps build and deploy
independently and a shared module would let a budget change break this build.

### Deploy notes

- Service is `recipes`, nginx on `127.0.0.1:8084`, loopback only.
  `docker compose build recipes && docker compose up -d recipes`.
- First deploy also needs the tunnel hostname in `/etc/cloudflared/config.yml`
  ABOVE the catch-all 404 rule:
  `- hostname: recipe.cbedge.net` / `service: http://127.0.0.1:8084`, then
  `cloudflared tunnel route dns <tunnel> recipe.cbedge.net` and
  `systemctl restart cloudflared`.
- AI fallback needs `ANTHROPIC_API_KEY` in `.env.local` (read by the DASHBOARD
  container — the key never reaches the browser). Optional `RECIPE_AI_MODEL`,
  default `claude-sonnet-4-5`. Without it, link imports of sites with structured
  data still work and the Paste tab says so up front instead of failing after a
  20-second wait.
- nginx proxies **only** `/api` — same narrow surface as budget. This app can
  never reach `/ws` or `/proxy`, so a bug here cannot touch the trading stack.

## 2026-08-12 - SPX flow: the strike-growth feed was eating the ATM tape (Net Drift quiet half-hours, round 3)

`server-v2/proxy-tastytrade.js` — two guards in `_onEvent`. Confirmed
`node server-v2/flow-print-time.selftest.js` all-pass after the edit.

### What

/flow's Net Drift still went "strong at the open, then a step every ~30 min"
after the 2026-08-07 (persist rate) and 2026-08-10 (TS window flapping + stall
fallback) fixes. Premium-split buckets summed only ~$6-8M each on a full 0DTE
session — orders of magnitude light.

Root cause: SPX is in the strike-growth watchlist (`scanner-tickers.js` MAIN,
hot lane, 2-min sweeps). `_subscribeStrikeGrowthRoot` claims the ±20 strikes
around spot across the front 3 expirations (±~100 SPX pts — the ATM core of the
0DTE tape) into `strikeGrowthContracts`, additively, never unsubscribing. And
`_onEvent` treated membership in that map as "belongs to the recorder, not the
tape":

- TimeAndSale branch: `if (strikeGrowthContracts.has(sym) || ...) return;` —
  every tick-by-tick ATM print discarded before reaching `this.flow`.
- Trade branch: `if (strikeGrowthContracts.has(sym)) return;` — the conflated
  fallback discarded too.

So the ATM band produced ZERO flow prints from either path. What survived:
far-OTM strikes beyond the claimed band (the isolated vertical steps), plus a
short burst whenever spot moved into strikes the sweep hadn't claimed yet
(≤2 min until the next hot-lane sweep) — which is exactly the "gave up, then a
step each time SPX made new ground" shape, and why the open looked strong
(overnight gap = a band's worth of unclaimed strikes).

### How

- **TimeAndSale branch: `strikeGrowthContracts` no longer vetoes the tape.**
  The strike-growth feed only plain-subscribes (Quote/Greeks/Summary/Trade);
  it never calls `subscribeTimeSales`. A TimeAndSale event can therefore only
  exist because the flow window (`_syncTimeSaleWindow`) or ttFlow asked for
  it — routing it to the tape takes nothing away from the recorder. The
  `flowRecordContracts` check stays. Side effect, intended: ATM prints stamp
  `_tsLastPrintAt` again, so the Trade-fallback health suppression works as
  designed instead of reading permanently stalled.
- **Trade branch: the strike-growth return is now gated** on the symbol not
  being flow-routed: `strikeGrowthContracts.has(sym) && !_tsSubs.has(sym) &&
  !ttFlowContracts.has(sym) && !flowRecordContracts.has(sym)`. Scanner-only
  names (AAPL & co.) still stop there — `this.flow` runs `spxOnly:false` for
  ttFlow's sake and must not ingest them — but near-spot SPX keeps its coarse
  fallback when TimeAndSale stalls.
- Strike-growth itself is untouched: its dayVolume caching happens above both
  guards, and it never consumed TimeAndSale events.

## 2026-08-12 - GEX Map (Tape Field): strong levels read louder, older heat stops washing out

`app/test/GexMapTab.tsx`.

### What

Two complaints, one root cause — the colour ramps, not the data.

- **Strong levels are now obvious.** In Terrain the peaks used to flatten into
  one saturated plateau: the `** 0.55` elevation curve spends most of its range
  on the low end, so everything above ~a third of the session max landed in the
  last four or five bands, separated by a couple of percent of one colour. It
  now carries a summit term as well, and the iso-GEX rings at |0.34| and above
  are drawn as INDEX contours — brighter, 2.4px, over a dark under-stroke — so a
  ridge is visually distinct from the merely-elevated ground around it.
- **Older heat no longer washes out under the closing GEX.** On a 0DTE session
  gamma piles into the close, so `gMax` is set by the last half hour and the
  whole morning sits at 10–25% of scale. The old `ratio ** 1.4` alpha easing
  pushed 0.15 down to 0.07 — the morning tape rendered as a faint wash. The
  cells were always there; the curve was hiding them.

Nothing about the scales changed. Gamma is still normalized once, on the session
max, shared by the heatmap, the terrain, the profile and the rail, at every zoom
level — a given gamma still paints the same colour everywhere.

### How

- `heatAlpha()` split into two terms: base `ratio ** 0.85` (sub-linear, so real
  mid-session nodes hold a readable alpha) plus a squared `hot` term over the top
  45% of the scale worth up to +0.16 alpha, capped at 0.98. The second term is
  what preserves contrast — lifting the low end alone would have flattened the
  map. Noise is still handled by TapeField's existing cull threshold, which
  rides the Intensity slider as before.
- `gamColor()` white-lift reweighted from a flat `m * 0.28` to `0.10·m + 0.32·m²`:
  weak cells keep the pure hue and read as texture, the strongest nodes burn to a
  bright core that survives the red field around it.
- `TerrainField` fill: `band` (the existing 18-step hypsometric quantization) is
  now joined by `hot = clamp01((|v| - 0.35) / 0.65)`, which pushes summit terrain
  +0.22 further up the mix and, squared, +0.45 toward white. Dark basin →
  coloured slopes → bright ridges, instead of one plateau with lines on it.
- Contour pass: levels ≥ |0.34| get alpha `0.42 + 0.50·|lv|` at 2.4px preceded by
  a `rgba(0,0,0,0.34)` 4.0px under-stroke (a light line on a light summit is
  invisible exactly where it matters most); everything below stays hairline at
  1.4px on the old sqrt alpha. The zero coastline is unchanged.

Intensity slider semantics unchanged. No proxy code touched. No API/server
changes.

## 2026-08-12 - Multi Greek: toolbar 🔍, % positive GEX in TOTAL row, ex-0DTE total column

`app/mult-greek/MultGreekClient.tsx`.

### What

Three changes to the multi charts (/mult-greek) page:

- The Ticker Lookup 🔍 moved out of the four panel headers into the page
  toolbar, next to the Intensity slider. One page-level button — the lookup
  card has its own symbol picker, so any ticker can be entered inside it
  (opens seeded on SPX).
- The TOTAL row now shows, next to each column's NET GEX total, the % of that
  column's gross GEX that is positive (Σ pos / (Σ pos + |Σ neg|)) — green when
  ≥50%, red below — on all tickers and all columns.
- The 4th column no longer shows the 4th expiry on its own. It is now the
  ex-0DTE TOTAL: the per-strike sum of NET GEX across all fetched expirations
  excluding 0DTE (the 4th expiry's data still feeds the sum). Header reads
  "ALL · EX-0DTE"; heat shading, top-3 ranks and the ★ peak work the same as
  a real column. Its cells don't open the per-cell click card (there is no
  single expiry behind them).

### How

- New `EX0_KEY` synthetic column + `withEx0Column()` fold the ex-0DTE sums
  into the computed result (rows, maxAbs, top3, top5PerSide, mvcStrike) and
  swap the last real column out of `cols`. Applied only when a full set of 4
  columns is present — static/delayed mode (single snapshot expiry) and thin
  calendars render unchanged. CB/CW/PW walls still come from the untouched
  front-expiry computation.
- `totals` now carries `{ net, posPct }` per column; the TOTAL row renders the
  % beside the value.
- `TickerPanel` lost its `onLookup` prop and header button; the toolbar 🔍
  opens the same portal overlay.

No proxy code touched. No API/server changes.

## 2026-08-12 - Fix: Multi Greek page snapshot button hung forever, left page stuck in capture layout

`lib/snapshot.ts`, `components/shared/DataBox.tsx`.

### What

On /mult-greek the toolbar 📸 "Copy screenshot to clipboard" button silently did
nothing: no PNG on the clipboard, no error in the console, and the page was left
stuck in its shrunken fit-content capture layout until a reload. Reproduced
twice in a live audit. Root symptom: the html2canvas capture promise never
settled, so every catch/finally downstream (including `endCapture`) was skipped.

### How

- **Capture watchdog** (`lib/snapshot.ts`): `captureToCanvas` now races the
  capture against a 20s timeout (`CAPTURE_WATCHDOG_MS`, overridable per call via
  `SnapOptions.timeoutMs`). A hang becomes a normal rejection - button shows ✕,
  error reaches the console, restore paths run.
- **`SnapOptions.imageTimeout`** passthrough to html2canvas; page-scale captures
  pass 4000ms instead of html2canvas's 15s default, so one stalled image can't
  hold the capture (and the capture-layout switch) hostage.
- **`BoxSnapBtn` / `BoxDiscordBtn`** (`DataBox.tsx`): `onAfterCapture` now runs
  in an inner finally the moment rasterization settles - BEFORE the clipboard
  write / Discord upload - so the page never sits in capture layout during I/O.
  Both pass `allowTaint:false` (a tainted logo would kill the readback; the
  documented trade in SnapOptions) + `imageTimeout:4000`.
- **Clipboard fallback**: BoxSnapBtn's hand-rolled `navigator.clipboard.write`
  replaced with the shared `copyOrDownload` helper - if the write fails (e.g.
  Chrome's ~5s transient-activation window expired during a slow capture), the
  PNG downloads instead of vanishing.

No proxy code touched.

## 2026-08-11 - Emails: "Options flow is 100%" subscriber update template

`lib/emails/flow-dialed-in.ts` (new), `app/api/admin/email-templates/route.ts`.

### What

New preset for current users: **"Options flow is 100% - scanners/alerts next"**.
Announces that the options flow tape is fully accurate (every bug found and
fixed), sets the expectation that scanners + options alerts are the next focus
and are permanently a work in progress because the market keeps changing, and
closes with a plain thank-you for joining.

Layout is the standard dashboard-theme shell with a small two-row status card at
the top: "Options flow tape - 100% checkmark" (filled cyan pill) and "Scanners &
options alerts - In progress" (outlined pill). CTA points at the Flow page
(`/app/flow`). Signed "- Bzila, founder of CB Edge".

### How

Exports `flowDialedInEmail()`, `flowDialedInText()`, `FLOW_DIALED_IN_SUBJECT`
("Options flow is finally 100%"), following `lib/emails/EMAILS_HANDOFF.md` -
table layout, inline styles, `{{UNSUBSCRIBE_URL}}` kept, standard footer.
Options: `firstName`, `ctaUrl`, `email`. Registered last in `buildTemplates()`
so it lands on top of the newest-first picker.

Intended audience on the compose page: **Subscribers** (or All users).

## 2026-08-11 - Emails: NOPANTS extension template + X post assets

`lib/emails/nopants-extension.ts` (new), `app/api/admin/email-templates/route.ts`,
`md files/nopants-x-post.*`, `md files/nopants-extension-x-post.*`.

### What

The first NOPANTS batch (2 codes at $300/yr) was claimed inside 30 minutes, so
there is now a follow-up preset: **"NOPANTS extension - sold out in 30 min, 3
more at $300"**. Same dashboard-theme invoice layout as `nopants-promo`, with a
"SOLD OUT IN 30 MINUTES" proof pill above the hero, a "3 more spots. Then it's
done." headline, and final-call fine print.

Also added X post assets for both sends: `nopants-x-post.png/.svg/.md` (original
promo) and `nopants-extension-x-post.png/.svg/.md` (the extension, with a
CLAIMED / CLAIMED / 3 OPEN spot row). The `.md` files carry the post copy plus
alts and bump replies.

### How

Exports `noPantsExtensionEmail()`, `noPantsExtensionText()`,
`NOPANTS_EXTENSION_SUBJECT`, following `lib/emails/EMAILS_HANDOFF.md` (table
layout, inline styles, `{{UNSUBSCRIBE_URL}}` kept, standard footer). Registered
last in `buildTemplates()` so it sits on top of the newest-first picker.

Defaults are all overridable: `spots` (3), `soldSpots` (2), `soldMinutes` (30),
`price` (300), `listPrice` (1000), `code` ("NOPANTS"), `deadline`
("Extended through tonight at midnight."), `ctaUrl` (`/pricing`), `email`.

### Note

`NOPANTS` in Stripe needs its max-redemptions raised (2 -> 5 total) before this
send, otherwise the extension codes bounce at checkout.

## 2026-08-11 - Emails: "NOPANTS" one-day promo template ($300/yr, 2 spots)

`lib/emails/nopants-promo.ts` (new), `app/api/admin/email-templates/route.ts`.

### What

New one-click preset on the owner Emails page: **"Kids-in-school promo - $300/yr,
2 spots (NOPANTS)"**. Same concept as the prior $300 annual promo screenshot -
limited-spot banner, big price, invoice-style line items (list price struck out,
discount row, total due today), and a full-width CTA - but rendered in the CB
Edge dashboard theme (bg `#05060A`, panel `#0D1119`, cyan `#219EBC`, accent
`#8ECAE6`) instead of the green.

Copy: celebrating both kids being in school full time, `NOPANTS` code, only 2
codes released, today only / ends at midnight, and a note that last time these
went within minutes. Signed "- Bzila, founder of CB Edge".

### How

Exports `noPantsPromoEmail()`, `noPantsPromoText()`, `NOPANTS_PROMO_SUBJECT`,
following the template conventions in `lib/emails/EMAILS_HANDOFF.md`: table
layout, all inline styles, `{{UNSUBSCRIBE_URL}}` placeholder kept, standard
Unsubscribe / cbedge.net / "Market analytics, not financial advice." footer.

Everything variable is an option with a default, so the same template can be
re-used for a different run without editing the HTML: `price` (300),
`listPrice` (1000), `spots` (2), `code` ("NOPANTS"), `ctaUrl` (defaults to
`/pricing`), `email`.

Registered last in `buildTemplates()` (the picker reverses to newest-first, so it
lands on top of the template list).

### Note

The `NOPANTS` coupon must exist in Stripe before this goes out - the email only
references it.

## 2026-08-11 - Multi Greek: per-panel magnifying glass opens the Ticker Lookup card

`app/mult-greek/MultGreekClient.tsx`, `components/pages/Analytics.tsx`.

### What

Each of the four Multi Greek panel headers now carries a small magnifying glass
next to the ticker. Clicking it opens the /analytics **Ticker Lookup** card in a
full-screen overlay, seeded with THAT panel's ticker - SPX, SPY, QQQ, or the 4th
slot. Esc, the ESC/x button, or a click on the scrim closes it.

### How

The card is IMPORTED, not copied. `TickerLookupCard` in `Analytics.tsx` is now
exported and takes two optional props:

- `initialSymbol` - what it opens on (default `SPX`, unchanged for /analytics).
  The card stays uncontrolled after mount, so the trader can switch symbols
  inside the overlay without the host yanking it back.
- `embedded` - drops the `gridColumn: 1 / -1` full-width span, which is
  meaningless outside the analytics card grid.

Multi Greek pulls it in with `lazy()` (same pattern as the full-screen option
chain), so nothing loads until the first click. The overlay is portalled to
`document.body` rather than pinned to the panels row like the chain overlay -
that row is `overflow:hidden` and would clip a tall card. `key={lookupTicker}`
remounts the card when a different panel is opened, so it re-seeds instead of
keeping the previous symbol.

The header button stops `click`, `mousedown` and `dblclick` from bubbling, so a
quick double press does not also fire the header's double-click-for-chain
gesture. A screenshot capture clears the overlay, same as the chain.

### Why one component

A second GEX ladder built here would be a second opinion about the same walls.
Ticker Lookup already prices off the same TastyTrade chain and the same
`accumulateChainGreeks()` formula Multi Greek uses, so mounting the real card
means the two surfaces cannot print different CB/CW/PW for the same symbol.


## 2026-08-11 - ES Candles: CB (MVC) line is RTH-only, no overnight bridge

`components/dashboard/es-candles/EsChartCard.tsx`.

### Why

The white CB step line ran unbroken across the whole overnight session. The runs
are grouped by VALUE, not by session: when the previous day's 16:00 CB and the
current day's 09:30 CB land on the same strike, they collapse into one run and
draw as a single flat line straight through the night - a level advertised for
hours where no central band was ever computed.

### Fix

Two fences inside the CB draw block:

- **RTH window.** Any snapshot outside 09:30-16:00 ET (`etMinutes` vs
  `RTH_OPEN_MIN`/`RTH_CLOSE_MIN`) closes the open run and is skipped. The writer
  is RTH-only today, but a stray backfill or late auction row would otherwise
  anchor a run in the dark.
- **Session boundary.** An `etDayKey` change closes the run at the previous
  day's last point and starts a fresh one at the new open, so a run can never
  bridge two sessions even at an identical strike.

Result: one flat segment per RTH session, nothing drawn overnight.


## 2026-08-11 - Test Lab -> GEX Map: SPX spot ticks live, once a minute

`app/test/GexMapTab.tsx`.

### Why

The map is a RECORDED tape. `GET /api/gex-map` is fetched once per
session/expiry pick, so `levels.spot` - the big price on the regime tile, and
the white spot marker + price tag on the right rail - froze at whatever the last
written snapshot held. Slots are 5 minutes wide, so the number on screen was
routinely 5-10 minutes stale, and staler still the longer the tab sat open.

### Fix

New `useLiveSpot()` in the same file. It subscribes to the SHARED `/ws/gex`
socket (`lib/gexSocket`) with `topics: ["spot"]` and publishes to React state on
a 60s interval.

- **No new traffic.** `spot` is already a permanent member of the socket's topic
  union - `GlobalToolbar` mounts `ToolbarTicker` on every dashboard route and it
  subscribes with `["spot","aux"]`. This adds no connection and widens no scope.
- **Topics declared at module scope** (`SPOT_TOPICS`), per AGENTS.md: the value
  is joined into the subscription key, so an inline array would resubscribe on
  every render.
- **Frames land in a ref, not in state.** The broker pushes `spot` several times
  a second; only the 60s `commit()` calls `setSpot`. Without that the model - and
  the zoom-window slice under it - would rebuild on every tick for a number
  rendered to two decimals.
- Gated on `useWsLifecycle()` like every other consumer.

### Applied to the MODEL, not just the tile

`buildModel()`'s result is spread with the live spot, so the regime tile, the
gamma-flip "spot above / below" subtitle, and the white spot arrow + price line
on the right rail all read the same number.

### Only while the tape is actually live

`date === "latest"` AND the payload's `levels.asOf` is under 20 minutes old.
A past session - or the RTH scope after the close, whose tail is pinned at
16:00 - keeps its recorded spot. A live SPX print beside a finished map would be
a different moment's number in the same tile.

The tile's timestamp is the TAPE's, not the price's, so when the two diverge the
tile now appends a green `· live 1m` rather than letting a 5-minute-old slot time
label a 1-minute-old quote.


## 2026-08-11 - /owner/probe: `"4.4e-65" is out of range for type real` on refresh

`server-v2/_lib-db.cjs`.

### Root cause

Deep-OTM contracts come back from the feed with a gamma (and the greeks derived
from it) on the order of `4.414902099280869e-65`. That is a perfectly ordinary
JS number, so `num()` in the `/api/watch` probe kept it and passed it straight
into `insertWatchSnapshot`. Every greek column in `watch_snapshots` is Postgres
`REAL` (float4), whose smallest representable magnitude is ~1e-38 - `float4in`
does not round tiny values down to zero, it REJECTS them:
`"4.414902099280869e-65" is out of range for type real`. The INSERT threw, the
refresh 500'd, and the probe page showed the raw Postgres text as its error.

### Fix

Added `realOrNull()` next to the existing `clampReal()` and routed all 15 REAL
columns of `insertWatchSnapshot` through it:

- magnitude `< 1e-37` collapses to `0` (that IS the value at float4 precision)
- magnitude `> 3.4028234e38` saturates at the float4 limit instead of throwing
- `null` / `""` / `NaN` / `Infinity` stay `NULL`

`clampReal()` was left alone - it returns `0` for non-finite and is used by the
GEX-history writer where the columns are NOT NULL.

## 2026-08-11 - /level-log: white text, no slot counter, pill text centred in the PNG

`components/pages/LevelLog.tsx`, `lib/snapshot.ts`.

### Slot counter removed

`N rows · N slots skipped` is gone from the rail. The rail and the chips already
say what happened and when; a slot tally is bookkeeping.

### Every dimmed font is now white

All ~22 `opacity: 0.26-0.85` text values in the log card dropped: the eyebrows,
the times, the hour ticks, the quiet labels, the chip time / kind / level, the
GEX meta line, the direction arrow, the table headers, the empty states, the
`changes` column. Level-coloured labels keep their hue - they just stop being
faded. Nothing in the card renders below full opacity now except disabled
buttons.

### Pill text sat high in the PNG (the recurring one)

Root cause, finally: the badges centre their label the CSS way - fixed `height`
plus a matching `line-height`, so the glyphs land on the line box's optical
centre. **html2canvas does not use the line box.** It takes the text node's
bounding rect and draws at `top + fontMetrics.ascent` for the font IT resolved -
and the clone runs in an about:blank iframe where `var(--font-inter)` does not
resolve, so the fallback's ascent is not the one the live box was sized for.
The taller the line box relative to the font, the further the error throws the
glyphs; a 12px label in a 20px pill lands visibly high.

- New **gotcha 10** in `snapshot.ts`: any element opted in with `data-cap-center`
  gets its line-box centring rewritten for the capture only - `line-height: 1`,
  `height: auto`, and the difference re-expressed as symmetric vertical padding.
  Same painted height and border, but the box now hugs the text, so there is no
  leading left for a wrong ascent to mis-split. `inline-flex` is downgraded to
  `inline-block` (flex centring is its own html2canvas hazard - it lays the child
  out and then still draws from the rect's top).
- `wallBadge()` and the "Open baseline" pill carry `data-cap-center`. The live
  page is untouched; this only ever runs on the clone.

Generic on purpose - any other pill in the app that centres with height +
line-height can opt in with the same attribute.

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
