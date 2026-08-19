# Changelog

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
