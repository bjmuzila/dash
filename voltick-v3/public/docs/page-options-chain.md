# `/options-chain` — the GEX heat MATRIX

**Route:** `/options-chain` (served at `voltick.cbedge.net/v3/options-chain`; the router's `basename` is `/v3`, set in `src/App.tsx`). **Mounted by:**
`src/App.tsx` — `const OptionsChain = lazy(() => import('@/pages/OptionsChain'))`, `<Route path="/options-chain" element={<OptionsChain />} />`. Also
mounted **already rewound** as the `options-chain` tab of `/replay` (`src/pages/Replay.tsx`, `<OptionsChain initialReplay initialReplayScope="0dte"
/>`). **Rail entry:** `NAV` in `src/shell/Shell.tsx` — `{ to: '/options-chain', label: 'Options Chain', icon: '⛓️', prefetch:
['/api/expirations?ticker=SPX'] }`.

**Sources**

| File | Lines | What it owns |
|---|---:|---|
| `src/pages/OptionsChain.tsx` | 838 | The page shell: toolbar, the ⚙ cog popover, focus chips, the ATM scroll rescue, the replay dock mount, the two CopyShot targets, the two empty states, `useRefreshButton` |
| `src/pages/optionsChain/useChainData.ts` | 1130 | Every fetch, every poll, every derivation, replay state, focus selection, near-core, the whole public surface of the page's data |
| `src/pages/optionsChain/ChainMatrix.tsx` | 1016 | The grid itself — DOM, no canvas. Header row, strike rails, ⅀ Total, ghost tracks, heat/level/near-core fill decisions, ★ / ✕ markers |
| `src/pages/optionsChain/chainMath.ts` | 558 | `parseExpiration` (the five greek formulas), CB/CW/PW, ranks + scales, the sticky window centre, key-expiry picker, the fallback calendar |
| `src/pages/optionsChain/heatSkins.ts` | 237 | The two skins as data: ramps, rank floors, level fill, the CB wash gradient, per-skin cell geometry, the localStorage key |
| `src/pages/optionsChain/LadderModal.tsx` | 788 | The `⛶ Ladder` single-column replay — its own data path, spot tween, row geometry, and the `embedded` shape `/replay` uses |
| `src/pages/optionsChain/ReplayBar.tsx` | 246 | The replay transport that renders into `ReplayDock` |
| `src/pages/optionsChain/StrikeHoverCard.tsx` | 200 | The per-strike card a cell click opens: call/put volume, OI, premium, and the DoD net-GEX line |
| `src/pages/optionsChain/pickers.tsx` | 191 | `ChainDropdown` — the portalled value list used by the % strikes picker and the replay date picker |
| `src/pages/optionsChain/format.ts` | 169 | Every number's exact wording — `fmtMoney`, `fmtCount`, `fmtChg`, `fmtExpHeader`, the replay clocks |
| `src/pages/optionsChain/marketSession.ts` | 142 | ET calendar, holidays, `isSessionLive()` / `isSpxFeedLive()` — the two poll gates |

Supporting files this page depends on: `src/data/api.ts` (239), `src/data/symbol.tsx` (111), `src/design/theme.ts` (471), `src/design/tokens.css`
(716), `src/design/primitives/ReplayDock.tsx` (212), `src/design/primitives/ReplayStamp.tsx` (178), `src/design/primitives/Controls.tsx` (647),
`src/shell/CopyShot.tsx` (556), `src/shell/snapshot.ts` (1236).

---

## What it is, in one paragraph

This is **not** a calls-and-puts ladder. It is a **GEX matrix**: one column per expiration laid side by side across a *shared* strike axis, with every
cell painted by a heat skin so a column of gamma reads as a gradient rather than as a list of numbers. Seven lenses (`gex`, `dex`, `chex`, `vex`,
`oi`, `vol`, `prem`) change what the cell *is*; three contract bases (`OI + Vol`, `Vol Only`, `OI Only`) change what the greek is computed from; a ⅀
Total column sums every rendered expiry **except the session's 0DTE**; clicking a column header or a strike rail focuses that expiry/strike and dims
(or hides) everything else; and a replay transport rewinds the entire grid through the session's recorded net-GEX snapshots. The header comment states
the job in one line: `/options-chain` answers *"where is the gamma"*. `/chain` — a separate route — answers *"what is this contract quoted at"*. The
page opens **no WebSocket**: it is REST plus polling, which is why it reads `data/api.ts` and not `data/hooks.ts`.

---

## The four deliberate departures from v2

Transcribed from the page header, because they are the things a reader coming from `/app/options-chain` will look for and not find:

1. **The ticker is not a control on this page at all.** The app toolbar owns the board symbol (`src/data/symbol.tsx`) and the page follows it via
   `usePageSymbol()`. v2's ticker dropdown, its GO button and its Recent list are gone; the picker with its favourites moved to
   `design/primitives/TickerPicker.tsx` where the whole board reads it. *"v2 had those controls because v2 had no board symbol."*
2. **`ContractFlowPopup` is NOT ported.** In v2 it is unreachable — `ChainMatrix` destructures `onCellClick` and never calls it, so `contractPopup`
   can never become non-null. *"Porting dead UI (and a chart library with it) would be inventing a feature, not preserving one."* Recorded in Part N
   of the parity spec.
3. **The Δ CHANGE columns are gone** (Live / 15m / 30m / 60m off `/proxy/strike-growth`). Dropped at Brandon's call on **2026-08-30**, *end to end* —
   control, state, fetch and column — rather than left as plumbing nothing can reach.
4. **The Δ15m STAMPS are gone** (front-expiry 15-minute net-GEX chips off `/api/mult-greek-gex-grid`). Same date, same reasoning.

3 and 4 are recorded as **declared departures** in the spec and reported as such by `scripts/parity-check-chain.mjs`, *"so the checker says they went
rather than quietly scoring them as a pass."*

---

## The data path

Every read goes through `query()` in `src/data/api.ts`, wrapped by a local helper in `useChainData.ts`:

```ts
async function get<T>(url: string, staleMs = 0): Promise<T | null> {
  try { return await query<T>(url, { staleMs }) } catch { return null }
}
```

`query()` throws on a non-OK response and caches by URL; every read here wants *"give me the value or nothing"* rather than an exception, and the live
ones want to go and ask again — hence `staleMs 0` as the default.

### Endpoints

| Endpoint | Query params | When | Stale window | Response shape read | On failure |
|---|---|---|---|---|---|
| `/api/chains` | `ticker`, `expiration`, `range=all`, plus `&noCache=1` when busting | `loadChain()` — mount, ticker change, basis change, ↻ Now, and the 60s poll. **One request per column, all in `Promise.all`** | `0` | `{ data: { underlyingPrice, items: [{ "expiration-date", strikes: [{ "strike-price", call:{…}, put:{…} }] }] } }` | `get` returns null → that column parses to an empty `cells` map. If **no** column has cells: `chainError = "No live chain payload returned for {TICKER}."`. A thrown error in the whole block: `"Live chain load failed for {TICKER}."` |
| `/api/expirations` | `ticker` | On every `activeTicker` change (ticker change **only** — see the gotcha) | `30_000` | `{ data: { items: [{ "expiration-date": "YYYY-MM-DD" }] } }` | Silently keeps the fabricated fallback calendar from `buildExpiries()` |
| `/proxy/gex` | `basis=flow`, `&noCache=1` when busting | Only when `dataMode === 'flow'` **and** ticker is `SPX` | `0` | `{ gexRows: [{ strike, flowGEX }] }` | Empty map → every flow cell reads 0 |
| `/proxy/oi-change` | `symbol` | Only while `greekMode === 'oi'`; re-fires on `activeTicker` and `refreshSeed` | `0` | `{ ok, rows: [{ expiry, strike, callOI, putOI, callChg, putChg }], date, prevDate }` | `{ map: empty, date: null, prevDate: null }` → the provenance chip reads `OI snapshot not recorded` |
| `/api/levels` | `ticker` | On `activeTicker` / `refreshSeed` | `0` | a row with `em` and `close` as strings | `emLevels = null` → no EM tags on the rails |
| `/proxy/strike-dod` | `limit=2000` | On `activeTicker` / `refreshSeed`; filtered client-side to the active ticker | `0` | `{ rows: DodRow[] }` | `dodRows = []` → the hover card's Δ block reads `— (top-mover strike only)` |
| `/proxy/strike-growth/replay-meta` | `symbol` | Only while `replay.on`; re-fires on ticker change | `0` | `{ dates: string[] }` (sliced to 10 chars) | `"Could not load recorded sessions."`; empty list → `"No recorded sessions for {TICKER}."` |
| `/proxy/strike-growth/frames-by-expiry` | `symbol`, `date` | One request per `(symbol, session)` while replaying | `0` | `{ ok, error?, expiries: string[], frames: [{ ts, spot, cells: [[expIdx, strike, net, vol], …] }] }` | `"Could not load frames."`; `!ok` or empty → `j.error` or `"No recorded frames for {TICKER} on {DATE}."` |
| `/proxy/strike-growth/replay-meta` (no `symbol`) | — | `LadderModal` mount only | `0` | `{ ok, symbols: string[] }` | `"Could not load recorded symbols."` |
| `/proxy/strike-growth/frames` | `symbol`, `date` | `LadderModal` — one net per strike for the **front active expiry** | `0` | `{ ok, error?, frames: [{ ts, spot, strikes: [{strike, net}], expiry?, expiryCount? }], expiries: string[] }` | `"Could not load frames."` / `j.error` / `"No data."` |

### Prefetch wired in `src/shell/Shell.tsx`

```ts
{ to: '/options-chain', label: 'Options Chain', icon: '⛓️', prefetch: ['/api/expirations?ticker=SPX'] }
```

Fired on `onPointerEnter` of the rail link (`item.prefetch?.forEach((u) => preload(u))`). Because the page's own expirations read carries `staleMs:
30_000`, the warmed cache entry is actually **read back** rather than stepped over — the same contract `/chain`'s seed relies on. Note that the chain
payload itself is **not** prefetched: its URL depends on the expiry list that has not arrived yet.

### Poll cadence

```ts
setInterval(() => {
  const exp = selectedExpiryRef.current
  if (!exp || !activeTicker) return
  const isSpx = activeTicker.toUpperCase() === 'SPX'
  const live = isSpx ? isSpxFeedLive() : isSessionLive()
  if (live) void loadChain(activeTicker, exp, false)
}, 60_000)
```

* **60 s**, and only while the feed is live.
* `isSessionLive()` — 09:30–16:00 ET on a trading day. Everything except SPX.
* `isSpxFeedLive()` — SPX rides the extended week: Sunday 20:00 ET → Friday 16:00 ET, **minus a daily 16:00–18:00 ET maintenance break**, Saturday
  closed.
* **No `noCache`** on the poll: *"the server chain cache absorbs repeats across clients and its TTL still refreshes intraday OI/greek drift."*
* Outside the window the greeks *stay stale rather than being overwritten* — *"there is no point re-fetching a frozen book."*

### Load discipline

`loadChain(ticker, startExp, bustCache = false, force = false)`:

* `loadInFlightRef` — an overlapping load returns immediately.
* `LOAD_MIN_INTERVAL_MS = 5000` — a non-forced load inside 5 s of the last one is dropped.
* `loadTokenRef` — the generation counter. A response whose token is stale is discarded before it writes anything.
* Columns are fetched **in parallel** (`Promise.all` over `targets`) and committed in a **single commit**: `expColumnsRef.current = results`, then
  `setRefreshSeed(s => s + 0.01)`. *"Not column-by-column as each resolves — that was a visible domino fill — and the OLD grid stays on screen until
  the new data is ready, so there is no flash of empty cells either. This is also v3 non-negotiable #3."*
* `EXP_COLUMNS = 14` — the sequential window of expirations rendered side by side. `expirySelection === 'key'` instead picks exactly 0DTE / 1DTE /
  nearest Friday / nearest third Friday (`pickKeyExpirations`).
* **Empty slots are kept** (`expColumnsRef.current = results`, not `cols`) *"so the grid holds its width."*

### Load progress

`loadProgress` drives a 3px cyan bar above the toolbar: **8** at fetch start, **100** on success, **0** after an 800 ms `setTimeout`. On failure it
goes straight to 0.

---

## Panel by panel

### 1. Load bar

A 3px strip, `background: T.bg`, filled `T.cyan` to `${loadProgress}%` with `transition: 'width 0.3s ease'`. Rendered only while `loadProgress > 0`,
`flexShrink: 0`.

### 2. Toolbar (pinned, `shrink-0 border-b border-line bg-bg`)

Left cluster — identity, all `whiteSpace: nowrap` inside a horizontally scrollable row with `scrollbarWidth: 'none'`:

| Element | Content | Notes |
|---|---|---|
| Page name | `Options Chain` | 12px, weight 800, `T.cyan`, `letterSpacing 0.14em`, uppercase |
| Ticker | `c.activeTicker` | 13px/800, `T.cyan`, `var(--font-mono)` |
| Mode line | `{GREEK} · {BASIS LABEL} · {N}%` | 10px/800, `T.text`. *"The three facts the folded-away controls used to spell out."* |
| Live dot | 7px circle + `LIVE` / `REPLAY` | `T.green` live, `T.orange` when `replay.frame` is non-null |
| FOCUS chip | `FOCUS: {n} exp + {n} strikes ✕` | Only while `hasSel`. It is the **only** way out of a selection. Carries `data-capture-hide` |
| DIM/HIDE chip | `◧ DIM REST` / `◱ HIDE REST` | Only while `hasSel`. Also `data-capture-hide` |
| ΔOI provenance | `ΔOI {date} vs {prevDate}` / `OI {date} · no prior snapshot yet` / `OI snapshot not recorded` | 9.5px. Only on the `oi` tab. Cyan when a baseline exists, `T.muted` otherwise |

Right cluster:

* **`↻ Now`** — an *action*, not a setting, so it stands outside the cog. Four states from `useRefreshButton`, with a **1800 ms** revert and a
  `lockedRef` re-entrancy guard: `↻ Now` → `↻ Refreshing…` → `✓ Refreshed` (`T.green`) or `✗ Failed` (`T.red`) → `↻ Now`. Disabled while refreshing,
  opacity 0.6, `cursor: not-allowed`.
* **The cog** — label is a live summary: `⚙ {N}% · {GREEK} · {skin label lowercased} · {'levels' | 'X.XXx'}`. `aria-label="Options chain settings"` —
  *"Same aria-label v2's DockCogMenu gives its cog. It is what `scripts/parity-check-chain.mjs` opens on BOTH pages."* **Do not rename it.**

### 3. The ⚙ settings popover (`Popover`, `align="right"`, width **316px**)

Three `PanelSection`s.

**Grid**

* `Strikes` — `ChainDropdown` over `DISPLAY_PERCENTS = [5, 10, 15, 20, 25, 30, 50, 100]`, rendered as `"{v}% strikes"`.
* `Greek` — `SegGroup` over `GREEK_MODES = ['gex','dex','chex','vex','oi','vol','prem']`, uppercased. **Pinned to GEX while replaying**, and rendered
  *inert* (`opacity 0.4`, `pointerEvents: none`) rather than hidden *"so the tabs do not vanish and reappear"*. Title in that state: `GEX only in
  replay — DEX/CHEX/VEX/OI/VOL/PREM are not recorded`.
* `Basis` — `SegGroup` over three of the four `DATA_MODES`:
  * `OI + Vol` (`oi-vol`) — the default.
  * `Vol Only` (`vol-only`) — today's tape, settled book zeroed.
  * `OI Only` (`oi-only`) — **disabled while replay is on**, title `OI-only net GEX is not recorded — replay carries the OI+Vol net and the
    pure-volume series only`; otherwise `Net GEX from OPEN INTEREST alone — the settled book, with today's volume term zeroed`.
  * `flow` (`Flow GEX`) is **deliberately absent from the control** — v2 filters it out too — but `parseExpiration` still implements it.

**Heat**

* `Intensity` — a range input, `min = INTENSITY_MIN.chain = 0.5`, `max = HEAT_SKINS[skin].intensity.max` (classic 3, vivid 4), `step = 0.01`,
  `accentColor: T.cyan`, 110px × 3px. Readout is `LEVELS` at the bottom stop, otherwise `{x.xx}x` in mono cyan. Hint: *"Heat intensity. At the minimum
  stop the gamma wash switches off and only CB / CW / PW stay marked."*
* `Near core` — an ON/OFF button plus a `ChainDropdown` over `NEAR_CORE_PCTS = [25, 33, 40, 50, 60, 75, 90]`, rendered `"≥ {v}% of core"`.
* `Skin` — `SegGroup` `CLASSIC` / `VIVID`.

**Replay**

* One button: `▶ Replay` / `■ Exit Replay`, title *"Rewind the grid itself through the session's recorded net-GEX snapshots"*.

### 4. The replay dock

`{c.replay.on && <ReplayDock><ReplayBar … /></ReplayDock>}`. `ReplayDock` portals the bar to the bottom of the page column via `ReplayDockHost`
(mounted in `Shell.tsx`). It is **in flow, not `position: fixed`**, so it *shrinks* the grid rather than covering the strikes nearest the money.
Detailed below under **Replay**.

### 5. The body — three mutually exclusive states

```
if (replay.on && !replay.frame)      → EmptyState (replay)
else if (!visibleStrikes.length)     → EmptyState (no chain)
else                                 → <div position:relative> [scroller > ChainMatrix] + ReplayStampLayer
```

The scroller: `flex: 1, overflow: auto, minHeight: 0, padding: '0 10px 10px'`. **No top padding** — *"A sticky `top:0` header inside a padded scroll
container sticks to the CONTENT edge, leaving a band where rows scroll through ABOVE the header and show behind it. The breathing room is `marginTop`
on the grid, which correctly scrolls away."* (`marginTop: 8` on the grid.)

The `position: relative` wrapper exists so the replay stamp pins to the **pane**, not to the scrolling content — *"a mark that scrolls away with the
rows is a mark that is not in the recording thirty seconds later."*

### 6. `ChainMatrix` — the grid

A single CSS grid. Template:

```
${STRIKE_COL}px
  ${renderIdx.map(() => `minmax(${isCountMode ? 84 : 78}px, 1fr)`)}
  ${showTotalCol ? `minmax(${isCountMode ? 92 : 88}px, 1.15fr)` : ''}
  ${STRIKE_COL}px
  ${ghostTemplate}
```

Constants: `STRIKE_COL = 56`, `ROW_MIN_H = 17`, `HDR_BG = T.panel`, `MONO = 'var(--font-mono)'`, `borderRadius: 12`, `overflow: clip`, `border: 1px
solid T.border`, `borderTop: 2px solid alpha(T.cyan, 0.85)`, `background: T.panelBg`.

**Reserved (ghost) tracks sit AFTER the mirrored strike rail, not before it.** Two things fall out of that: the right-hand strike numbers stay beside
the data they mirror, and everything the grid actually draws ends up in one unbroken block on the left — which is what lets a screenshot stop at the
first reserved track (`data-capture-trim`) and still contain both rails.

Rows are `display: contents` wrappers, which is why a padding row still emits one cell per track — *"a row short of a cell would pull the next row's
first cell up and shear the grid."*

#### Two pieces of geometry that are transcribed rather than tidied

* **The ATM rule is an INSET BOX-SHADOW, never a border.** A real 2px top and bottom border adds 4px to the tallest cell in the row, *"so every time
  spot crossed a strike the old ATM row shrank and the new one grew, shoving the whole ladder — the white rule appeared to jump rather than move one
  row."* Shadows on the ATM row: `inset 0 2px 0 T.text`, `inset 0 -2px 0 T.text`, plus `inset 2px 0 0 T.text` on the first rendered column and `inset
  -2px 0 0 T.text` on the ⅀ cell.
* **Rows have a MIN-HEIGHT floor on the sticky strike cell** (`ROW_MIN_H = 17` in `railBase`). Grid rows size to content, *"so without it a row's
  height is a function of what happens to be IN it, and under replay a strike gaining a value grows its row and shifts everything below it."*

Because this is DOM and not canvas, v3 non-negotiables 4–6 (`ChartFrame`, `data-cb-layer`, visibility) *"do not apply: there is nothing here that
paints on an animation frame."* What **does** apply is #1 — every colour is a token through `T` / `alpha()` / a declared `var()` name.

#### Header row

* Left corner cell: `Strike`, sticky `left: 0; top: 0; zIndex: 6`.
* One header per rendered expiry: `fmtExpHeader(expiration)` → `"Mon 06-23"` (parsed as **UTC** deliberately — *"'2026-07-01' read in a negative
  offset becomes Jun 30 locally, and an expiry column headed with the wrong day is the single most confusing thing this grid can print"*), plus the
  **column total** of the active greek across the visible window, coloured `T.green` / `T.red`. Clicking toggles focus; shift-click solos. Selected
  header gets `inset 0 -2px 0 T.cyan` and a stronger cyan gradient; unselected headers under a selection drop to `opacity: 0.3`.
* ⅀ Total header: `Total`, or `selSpanLabel([...selExps])` when expiries are picked — *"'Sel 3' told you how many expiries were picked and nothing
  about which"* — one expiry prints its own `M/D`, several print `first-last` **in calendar order, not click order**. Below it, `grandVisibleTotal` in
  green/red.
* Right corner cell: `Strike`, sticky `right: 0`.
* Then `ghostCells('hdr', true)`; the first one carries **`data-capture-trim`**.

#### Strike rails (both sides, sticky)

10px mono, right-aligned, `fmtStrike` (integers bare, fractions to 2dp). ATM takes `T.cyan` and weight 700; every other strike takes `CHAIN.strike` =
`alpha(T.text, 0.92)`. Clicking toggles the strike focus; shift-click solos. A selected strike gets a cyan gradient plus `inset ∓2px 0 0 T.cyan`. An
unselected strike under a strike selection drops to `opacity: 0.28`. The **left rail's ATM row carries `atmRowRef`** — that is the element both scroll
effects measure.

Right-rail padding is asymmetric on purpose: `'2px 5px 2px 10px'` — *"extra left padding on the right rail keeps the number off the Total column's
value; 5px on the outer edge matches the left."*

**EM tags** ride in the rail (`marginRight: auto`), 8px:

| Tag | Condition | Tooltip |
|---|---|---|
| `ATM` | `strike === nearestStrike` | `At-the-money — nearest strike to spot ({spot.toFixed(2)})` |
| `EM +1σ` / `EM −1σ` | `anyCurrentWeek && strike === emStrikes.u1/d1` | `1× weekly expected move up/down ({close} ± {em})` |
| `EM +2σ` / `EM −2σ` | `… u2/d2` | `2× weekly expected move up/down ({close} ± {2·em})` |

*"EM rows draw no marker line — the tag beside the strike is the whole signal, and the CLOSE (band-centre) marker is gone entirely."*

#### Cells

Padding `'3px 6px'` in count mode, `'2px 8px'` otherwise. Font is the skin's (`CELL.fontSize`), `var(--font-mono)`, right-aligned, `letterSpacing:
'0'`. Weight comes off `CELL.weight` indexed by rank: `[rank 1, ranks 2–3, unranked]`. A null value renders `·` in `CHAIN.none` (`T.flat`).

Each cell's click handler opens the `StrikeHoverCard` at the click coordinates; title is `Click for volume / OI / net premium`.

Opacity under a focus selection: a cell stays lit only if **both** its column and its row survive — `opacity: strikeDim || (selMode &&
!selExps.has(col.expiration)) ? 0.13 : 1`, `transition: opacity .12s`.

#### The OI and VOL cells (count mode)

Both tabs ladder identically, from `oiSides(strike, atm)`:

* above ATM → **calls only**;
* below ATM → **puts only**;
* at the ATM strike (the pivot) → **both**, and only there do the `C` / `P` letters appear.

*"Showing both everywhere meant half of every cell was the deep-ITM mirror of a strike on the other side of the ladder — high OI, no information, and
it doubled the row height for nothing."*

* `OiChgLine` prints **only the day-over-day change**, never the settled level. *"The tab exists to show what moved overnight, and the level sat right
  beside the delta drowning it in digits."* Ink is near-white (`alpha(T.text, 0.96)`) because *"a red number on a red background was the one thing you
  could not read"* — direction is carried twice over, by the leading `+`/`−` and by the tint beneath. `chg === null` renders `—` so *"we don't know"*
  never reads as *"unchanged"*.
* `VolLine` prints today's traded count **unsigned** — *"Volume is a LEVEL, not a change, so ΔOI's leading +/− would be noise here — every figure
  would wear a '+'."* An untraded strike prints `·`.

A cell reads as empty (`·`) only when the side(s) **actually rendered** are flat: `volHasAny = (sides.call && volCell.callVol) || (sides.put &&
volCell.putVol)` — *"an ITM put below a call-only strike must not keep an otherwise-flat call cell from reading as '·'."*

#### The ⅀ Total column

* **What it sums:** per strike, across every *rendered* expiration **except 0DTE**, where "0DTE" means the expiry equal to the **session being shown**
  (`sessionDate || etDateKey(etToday())`) — *"so replaying Tuesday excludes Tuesday's 0DTE and not Friday's."*
* **With expiries picked**, it sums exactly those — 0DTE included, because *"an explicit pick outranks the default exclusion"* — and says so in its
  header.
* Ranked as its **own column**: `totalScale = { max: totalAbs[0] ?? 1, top3: totalAbs.slice(0,3) }`.
* It has its **own Core**: `totalMvc` = the strike with the largest `|⅀|`, marked with ★ and tooltip `CB - Core Bullseye — highest |⅀ {GREEK}|`.
* `borderLeft: 2px solid alpha(T.cyan, selMode ? 0.8 : 0.35)`.
* It **dims for a strike pick only** — *"The ⅀ column answers an expiry selection by RE-SUMMING."*
* Dropped entirely when `showTotalCol === false`, i.e. replay in `0dte` scope: *"that set is empty, so the column is dropped rather than printed as a
  column of zeros that reads as 'no gamma' instead of 'not summed'."*

### 7. `StrikeHoverCard`

Opened by a **click** (it was named "hover" in v2 and opened by a click there too; *"the name is kept so the parity spec and the code use one word"*).
Portalled to `document.body`, `zIndex: 1000`, width **246px**, clamped to `Math.min(Math.max(8, x + 16), vw - 262)` × `Math.min(Math.max(8, y + 16),
vh - 240)`. Closes on outside `mousedown` (registered after a `setTimeout(…, 0)` so the opening click does not immediately close it) and on `Escape`.

Contents:

* Head: `{TICKER} {strike.toLocaleString()}` + `fmtExpHeader(expiration)` + `✕`.
* Two `SideBlock`s side by side — **CALLS** in `GEX_POS`, **PUTS** in `GEX_NEG` — each with `Volume` (`fmtHoverInt`), `OI`, and `Net Prem`
  (`fmtHoverUsd`).
* `Net Prem (C−P)` = `cell.callPrem - cell.putPrem`, coloured by sign.
* A Day-over-Day block off `/proxy/strike-dod`:
  * with a match: `Δ GEX vs Yest` (`fmtHoverSigned(dod.delta)`) and `Yest → Now`.
  * without: `Δ GEX vs Yest` / `— (top-mover strike only)`. *"/proxy/strike-dod returns ONE row per ticker, at the strike that moved most versus
    yesterday, so every other strike legitimately has no baseline and says so rather than printing a zero."*

The page matches a DoD row on `d.strike === hoverCell.strike && (!d.expiry || d.expiry === col.expiration)`.

### 8. `LadderModal` — the `⛶ Ladder` button

**A different data path on purpose.** `/proxy/strike-growth/frames` returns ONE net per strike for the **front active expiry**, where
`/frames-by-expiry` returns the whole matrix. *"The ladder is the front contract's profile moving through the day; the grid is every expiry at one
instant. Both read the same recorder."*

Shape: a portalled overlay at `zIndex: 9999`, scrim `alpha(SHADOW, 0.72)`, plate `width: min(760px, 100%)`, `borderRadius: 14`. Heading `Option Chain
Replay` / *"Play back the recorded per-strike net-GEX profile through the session."* Escape closes (only in the modal shape — see `embedded`).

Its own controls:

* Symbol readout + `TickerPicker` over **the recorder's symbol list**, not the board's. *"A session can only be replayed for a root the recorder
  actually swept."* It **seeds** from the caller's symbol and does not lock: the picker still switches to any root the recorder swept.
* A themed `Select` over recorded dates (`menuZ: 10000` — *"this modal portals at z 9999; POP_Z (250) would put the list behind its own scrim"*), plus
  a `{n} session(s)` readout with the tooltip *"Recorded sessions held for {SYM}. Server-side retention decides this, not the chart."*
* `▶ Play` / `❚❚ Pause`, `SPEEDS = [0.5, 1, 2, 4, 8]`, `BASE_MS = 700`.
* `Scale` — `frame` (rescale each snapshot to its own peak) vs `day` (fixed session-wide scale). `denom = (axisLock || scaleMode === 'day' ? maxAbs :
  frameMax) || 1`.
* `ReplayLock` — on this surface the lock **forces `day` scaling** and the picker goes inert, *"showing 'day' as the live answer and dims, rather than
  lying about a setting that is not in force."*
* A scrubber (`accentColor: LIGHT_BLUE`) and `Frame {i+1} / {n}`.

Two pieces of behaviour transcribed rather than simplified:

* **The spot line's vertical position is DERIVED DURING RENDER, not held in state.** Measured in a layout effect it sat one commit behind the `spot`
  the label printed in the same paint — *"invisible at rest, and tens of strikes out during playback."*
* **The spot TWEEN lands exactly on the frame's spot in its cleanup.** *"An interrupted tween otherwise leaves the displayed spot SHORT of the frame
  it was heading for, the next tween starts from that shortfall, and the error compounds — one dropped frame is invisible, a few hundred is how the
  dashed line ends up dozens of strikes from the price."* Scrubbing snaps instantly (`if (!playing) { animSpot.current = target; … }`) because
  *"animating here would restart a fresh tween on every intermediate frame while dragging, stacking overlapping tweens that overshoot"*. Tween
  duration `Math.min(BASE_MS / speed, 450)`, ease `1 - (1-t)²`.

Row geometry is **measured**, not assumed: `pitch = (lastMid - top0) / (n - 1)`, re-measured through a `ResizeObserver`, *"never a guessed px-per-row
constant, so there is no compounding rounding error."* `spotTop` interpolates the continuous row index between the two bracketing strikes and parks
one row past the edge rather than clamping.

Bars: `POS = MOVE_UP` (*"v2 used HOME_THEME.green here, which is a light blue"*), `NEG = T.red`; 12px tall, `borderRadius '3px 0 0 3px'` on the
negative side and `'0 3px 3px 0'` on the positive, `opacity 0.9`; strike gutter 56px, value gutter 68px, value via `fmtGex` (no `$`).

The whole ladder list is `useMemo`'d *"so a tween tick (which re-renders ~60×/s purely to move the spot line) does not reconcile several hundred bar
rows."*

The dashed spot line carries **no CSS transition** — *"The JS tween above already eases `spot`; a transition on top of it re-starts every animation
frame, so the line permanently trails its own label."*

`embedded` renders the bare body (for `/replay`'s "Chain ladder" tab): no overlay, no plate, no heading pair, no ✕, **and no Escape handler** —
*"Escape in a page that is not a modal has nothing to dismiss, and stealing the key from whatever else wants it is worse than not binding it."* In the
embedded shape the transport goes into `ReplayDock`; in the modal it stays put, because *"a modal owns its own bottom edge."*

---

## Every derived number, with its formula

### `parseExpiration` — the five greek formulas (`chainMath.ts`)

Transcribed **verbatim** from v2's `lib/calculations/optionChain.ts`. *"These are the numbers the whole grid is, and a formula rewritten 'the same
way' is how the same strike ends up reading two values on two pages."*

Contract counts per side:

```
contracts = OI + volume           (basis 'oi-vol')
          = volume                (basis 'vol-only'  — the OI term is zeroed)
          = OI                    (basis 'oi-only'   — the volume term is zeroed)
```

With `S` = `underlyingPrice` from the payload (0 if absent), `cc` / `pc` the call/put contract counts, and `live = cc > 0 || pc > 0`:

| Field | Formula | Unit |
|---|---|---|
| `gex` | `(γc·cc − γp·pc) · S² · 0.01 · 100` | dollars of gamma exposure per 1% move |
| `dex` | `(|Δc|·cc − |Δp|·pc) · S · 100` | dollars of delta exposure |
| `chex` | `(−θc·cc + θp·pc) · S · 100` | dollars of charm/theta exposure |
| `vex` | `(νc·cc − νp·pc) · S · 100` | dollars of vega exposure |
| `oi` | `callOI − putOI` | contracts, **signed** |
| `volGex` | `(γc·cVol − γp·pVol) · S² · 0.01 · 100` | dollars — **raw volume, regardless of basis** |
| `callPrem` | `markOf(call) × cVol × 100` | dollars |
| `putPrem` | `markOf(put) × pVol × 100` | dollars |
| `prem` | `callPrem − putPrem` | dollars, signed |

* When `dataMode === 'flow'`, `gex` is read straight out of `flowGexMap` (`/proxy/gex?basis=flow`), not computed. `!live` → every greek is 0.
* `markOf` falls back **mark → mark-price → (bid+ask)/2 → last → last-price → close → price → mid**. *"Same ladder as v2."*
* `volGex` is computed from raw call/put volume **regardless of `dataMode`**, *"so the OI+Vol view can still flag the biggest pure-volume gamma
  peak."*
* `oi` is always the settled book — *"the Vol-only toggle changes the GEX basis, and must not blank out the tab that is about positioning."*
* `prem` is **basis-independent on purpose**: premium is `mark × TODAY'S VOLUME`, so the Vol Only toggle — which only zeroes open interest out of the
  greek contract counts — *"can neither change it nor blank it out."*
* The group filter: `items` whose `"expiration-date"` prefix matches the requested date. If **no** group matches, **every** group is used — *"v2 does
  this, and it is what makes a payload that omits the echo of the requested date still parse."*

### `valueAt(col, strike)` — what every scale and total reads

```
greekMode === 'oi'   → oiSideChange(snapshot, strike, nearestStrike)   (null if no snapshot row)
greekMode === 'vol'  → volSideValue(cell, strike, nearestStrike)
greekMode === 'prem' → cell.prem || null       ← a zero-premium strike reads as ABSENT
otherwise            → cell[greekMode]
```

`cell.prem || null` is load-bearing: *"A strike with zero premium on both sides has not traded, so it reads as ABSENT ('·') the way an untraded VOL
cell does — which also keeps the dead wings out of the column heat scale and the ⅀ totals."*

* `oiSideChange` = `callChg` above ATM, `−putChg` below (negated so it colours as a put), `callChg − putChg` at the pivot. *"The colour a cell wears
  and the figure it shows can never disagree."*
* `volSideValue` = `callVol` above ATM, `−putVol` below, `callVol − putVol` at the pivot. *"Volume itself is never negative — the sign here is purely
  the SIDE."* The **cell prints the unsigned count**; the signed value only colours it and feeds the totals.

### Scales and ranks

```ts
scaleOf(values) → { max: sorted[0] ?? 1, top3: sorted.slice(0, 3) }   // |v|, zeros excluded
rankOf(value, top3) → index of |value| in top3, +1, or 0
```

`colScales` is computed per column **over the visible strikes only**, so each expiration colours against its own scale.

### The CORE (★)

`coreCols` — per column, the visible strike with the highest `|valueAt|`, plus that `|value|`:

* `mvcByCol[i]` = the strike (the ★).
* `coreAbsByCol[i]` = the magnitude — **NEAR CORE's denominator**.

It follows the **active tab**, not GEX. From the header comment: *"It used to be pinned to GEX and the ★ was suppressed on every other tab, on the
reading that 'MVC' is a gamma definition. That left six tabs with the page's loudest mark missing and no answer at all to 'which strike is this tab's
biggest' — the question the mark exists to answer."* Its tooltip names the tab: `CB - Core Bullseye — highest |{ΔOI | GEX | DEX | …}|`.

### The volume-GEX peak (✕)

`volMvcByCol[i]` = the visible strike with the largest `|cell.volGex|`. Drawn **only** when `greekMode === 'gex' && dataMode === 'oi-vol'`. This one
**stays GEX-only** — *"'the volume-GEX peak' is a statement about gamma specifically."* It is coloured by the **sign of that volume-only GEX**
(`CHAIN.signUp` / `CHAIN.signDown`), because *"a fixed-red ✕ said 'negative' on every strike it landed on."* Tooltip: `Highest volume GEX ({fmtMoney})
— positive|negative gamma`.

### CB / CW / PW (levels-only)

`columnWalls(rows)` over `{strike, net: valueAt(col, strike) ?? 0}`:

* **CB** — Core Bullseye: the largest `|net|` strike (sign-blind).
* **CW** — Call Wall: the largest `+net` strike that is **not** CB.
* **PW** — Put Wall: the most `−net` strike that is **not** CB.
* `cbAbs` — `|net|` at CB, carried out with the strikes.

`null` rather than a fallback when a side is empty or holds only CB: *"repeating CB under a wall label reads as two levels agreeing when it is one
level counted twice."*

`WALL_RANK = { cb: 1, cw: 2, pw: 3 }` — *"CB is the column's biggest |net| by definition, so it is rank 1 whatever the heat scale would have said; CW
and PW take 2 and 3 to keep the three tiers visibly ordered."*

### NEAR CORE

```ts
isNearCore(value, cbAbs, threshold) → |value| / cbAbs >= threshold      // sign-blind
nearCoreThreshold = clamp((nearCorePct || 0) / 100, 0, 0.99)
```

It is a **filter on the heat, not a fill of its own**. On, only the strikes carrying that share or more of their column's core keep the ordinary
sign-coloured Intensity fill; everything under the threshold is left bare. Three rules stated in the source:

* **Gold is the core's, and only the core's.** *"A near-core strike is not a level and is not a second core — where it is painted, it is painted
  exactly as it would have been with the filter off."*
* **CB / CW / PW are exempt.** *"A level keeps its own paint whatever the threshold is set to, so turning the dial can never make a wall disappear."*
  The wall check comes **first** in the fill expression.
* Sign-blind on purpose: *"a put wall at 60% of a call-side Core is exactly the kind of strike the question is about."*

The ⅀ column gets its own denominator (`totalCoreAbs`) — *"near-core in ⅀ means 'a real fraction of the summed Core', not of any one expiry's."*

Note also recorded in the source: because `columnWalls` picks CB as the largest `|net|` over the same visible strikes `scaleOf` takes its max from,
*"'≥ 50% of core' and '≥ 50% of the column max' are the same cut. The core wording is kept because the core is the thing on screen you are comparing
against."*

### The strike window

`buildVisibleStrikes(allStrikes, centerStrike, displayPercent)`:

* `displayPercent >= 100` → every strike, descending.
* otherwise `targetCount = max(11, round(n × pct/100))`, **forced odd** (`+1` if even) so a true middle row exists; `wing = (targetCount - 1) / 2`.
* Output runs **high → low**, with `null` padding where the chain runs out on one side *"so the centre stays put whatever the window size."* A `null`
  renders a full-width empty row.

`autoDisplayPercent`:

* In replay → **100**. *"Replay's strike universe is ALREADY a filtered set — the recorder stores only the top strikes a side, so taking 10% of it
  would hide walls the whole feature exists to show."*
* Live: if `displayPercent === 10` and that would give fewer than 10 rows, use **20**.

**Auto window per ticker:** an effect on `activeTicker` sets `displayPercent` to **10 for SPX and 50 for everything else**. The reasoning is explicit:
*"SPX lists thousands of strikes across the expiries this grid draws side by side, so 10% is already a deep ladder there and a wider window costs real
frames. A single-name chain is a fraction of that, and 30% cut the window off before the strikes that matter — 50% is the one that opens on something
worth reading."* It re-applies on every ticker change; the % control still overrides it for the ticker on screen.

### The sticky window centre

`RECENTER_EVERY_STRIKES = 5`. `pickCenterStrike(allStrikes, nearestStrike, anchor, anchorKey)` re-centres only when the true ATM index has moved ≥ 5
**strike steps** from the anchor.

*"Without this the window re-centres the instant spot crosses a strike midpoint, so the whole ladder slides a row while you are reading it, and on a
chippy tape it can slide back and forth across one boundary indefinitely."*

Crucially: **the ATM ROW itself is not anchored.** `nearestStrike` stays the true nearest strike, so the ATM highlight, the OI/VOL side split and the
EM tags all keep following real spot. Only the *centre* is sticky, so the ATM row drifts up to N−1 rows off the middle between re-centres — and *"the
smallest window is 11 rows (wing 5), so it can never drift out of view."*

`anchorKey = `${activeTicker}|${replayFrame ? `replay:${date}:${scope}` : 'live'}`` — *"Two chains can list the same strike price (SPY 500, QQQ 500),
so an anchor from another ticker or another replay session is discarded rather than silently reused."* The anchor is held as **state**, not a ref
mutated during render; `pickCenterStrike` is ONE function called by both the render and the persisting effect, because *"written as two copies of the
same comparison, the anchor only caught up on the render AFTER the one that crossed the threshold."*

### EM band strikes

From `/api/levels` (`em`, `close` as strings → `parseFloat`), snapped onto the visible strikes with `nearestStrikeTo`:

```
close, d1 = close − em, u1 = close + em, d2 = close − 2·em, u2 = close + 2·em
```

Rendered only when `anyCurrentWeek` — `isCurrentWeekExp(iso)` tests Mon–Fri of the current ET week (Sunday belongs to the week just ended → next
Monday). *"The stored weekly EM only applies to current-week expirations."*

### Formatters (`format.ts`)

| Function | Output | Note |
|---|---|---|
| `fmtMoney(v)` | `+$1.23M` / `-$45.6K` / `+$789`; zero → `+$0` | *"That is not a bug — the column is signed gamma and a bare '$0' reads as 'no data'."* |
| `fmtCount(v)` | `12.4K`, `1.2M`, unsigned, no `$` | OI and volume are **contract counts** |
| `fmtChg(v)` | `+1.2K` / `-430`; flat → `·` | *"on any given morning most strikes genuinely did not change and a wall of '+0' buries the ones that did"* |
| `fmtDeltaChip(d)` | `+$12M`, `−<$1M` | Uses **U+2212 MINUS**, not a hyphen |
| `fmtExpHeader(iso)` | `Mon 06-23` | Parsed as **UTC** |
| `fmtReplayClock(iso)` | `HH:MM:SS` in `America/New_York`, 24h | |
| `fmtClockHm(iso)` | `HH:MM` ET | The ladder's clock |
| `fmtStampDate(ymd)` | `Fri Jul 31` | Parsed at **noon UTC** so no off-by-one day |
| `fmtExpiryShort(ymd)` | `Jul 31` | |
| `fmtGex(v)` | `1.23B` / `4.5M` / `678K` — no `$` | The ladder's bar value |
| `fmtHoverUsd` / `fmtHoverSigned` / `fmtHoverInt` | `$1.23M` / `+$1.23M` / `1,234` | |
| `skinFig(text, plusSign)` | strips a leading `+` when the skin says so | |
| `fmtStrike(s)` | integers bare, fractions to 2dp | |

**Do not merge these with the premarket page's `format.ts`** — *"its fmtUsd prints millions at zero decimals and this one at two. Merging them would
change one page's numbers to tidy up the other's."*

---

## Every control

| Control | What it does | Default | Where the state lives |
|---|---|---|---|
| Board ticker (app toolbar) | Drives `activeTicker` through `usePageSymbol()` | `SPX` | `localStorage` `cb-v3-page-symbol` (in `data/symbol.tsx`) |
| `Strikes` (% window) | `displayPercent` → `buildVisibleStrikes` | `10` for SPX, `50` otherwise, re-applied on each ticker change | React state only — **not persisted** |
| `Greek` | `greekMode`, drives `valueAt` | `gex` | React state. Forced to `gex` while replay is on; the pre-replay value is stashed in `preReplayModes` and restored on exit |
| `Basis` | `dataMode`, drives `parseExpiration`; triggers a forced re-fetch | `oi-vol` | React state (mount-skipped effect) |
| `Intensity` | `intensity` → `skinMetricBg`; at the bottom stop switches to levels-only | skin's `intensity.def` — classic `1.75`, vivid `3` | React state; **switching skin moves the slider to the new skin's default** |
| `Near core` ON/OFF | `nearCore` | `false` | `localStorage` `cb.chain.nearCore` — `'1'` / `'0'` |
| `Near core` threshold | `nearCorePct` | `50` | `localStorage` `cb.chain.nearCorePct` — a number string. **Setting it also turns the feature ON** |
| `Skin` | `heatSkin` + `intensity` reset | `vivid` (`CHAIN_DEFAULT_SKIN`) | `localStorage` `chain_heat_skin` (`CHAIN_HEAT_SKIN_KEY`) |
| `↻ Now` | `doRefresh()` → forced, cache-busting `loadChain` + `refreshSeed += 1` | — | Transient state in `useRefreshButton` |
| Expiry header click | Toggle expiry focus; **shift-click = solo** | empty | `selExps: Set<string>` |
| Strike rail click | Toggle strike focus; **shift-click = solo** | empty | `selStrikes: Set<number>` |
| `FOCUS … ✕` | `clearSel()` | — | — |
| `DIM REST` / `HIDE REST` | `hideUnsel` | `false`, and **reset to `false` whenever the selection empties** | React state only — deliberately **not** persisted |
| `▶ Replay` / `■ Exit Replay` | `replay.on` | `false` (or `initialReplay` from `/replay`) | React state |
| Replay date | `replay.date` | first entry of `replay.dates` | React state |
| `Exp` scope `0DTE` / `All exp` | `replay.scope` | `all` (or `initialReplayScope`) | React state |
| Replay `◀` / `▶`/`❚❚` / `▶` / scrubber | `replay.idx`, `replay.playing` | idx = **last** frame on load | React state |
| Replay `Speed` | `REPLAY_SPEEDS = [0.5, 1, 2, 4, 8]` | `1` | React state |
| `🔒 Axis` (grid) | Switches off the ATM scroll rescue | `false` | React state in `OptionsChain.tsx` — *"Held here rather than in `useChainData` because the scroller it governs is this component's."* |
| `⛶ Ladder` | Opens `LadderModal` | closed | React state |
| Cell click | Opens `StrikeHoverCard` | closed | React state (`hoverCell`) |

Nothing on this page lives in the query string.

---

## Rendering, skins and design tokens

### DOM, not canvas

There is no `<canvas>`, no `ChartFrame`, no `data-cb-layer` anywhere on this page. Non-negotiables 4, 5 and 6 have nothing to bite on. `npm run perf`
measures canvases tagged `data-cb-layer`, so it is silent about this page by construction.

### The two skins (`heatSkins.ts`)

A skin owns the **ramp**, the **rank floors** and the **level fill**. A host owns the **cell geometry** — *"because this grid's cells are 10px mono in
a dense table with sticky rails and the Multi Greek ladder's are 9px figures in four side-by-side panels."* **Nothing about the maths is in the
skin.** Both skins read the identical `ratio = |value| / columnMax`.

```ts
alpha = min(ramp.max, ramp.base + (ratio × max(intensity, 1)) ^ ramp.ease × ramp.span)
```

| | `classic` | `vivid` |
|---|---|---|
| `ramp.base` | 0.02 | 0.05 |
| `ramp.span` | 0.16 | 0.25 |
| `ramp.max` | 0.18 | 1 |
| `ramp.ease` | 1.4 | **0.4** |
| `rank` floors (1/2/3) | `[0.9, 0.45, 0.25]` | `[0.95, 0.62, 0.4]` |
| `levelFill` | `null` | `{ mode: 'blend', alpha: { cb: 0.85, cw: 1, pw: 1 } }` |
| `intensity` | `{ def: 1.75, max: 3 }` | `{ def: 3, max: 4 }` |
| cell radius / inset | `0` / `0` | `3` / `0.5` (a **margin**, not a grid gap) |
| cell font size | 10 | 9.5 |
| cell text | `CHAIN.ink` (= `T.text`) | `T.text` |
| weights `[r1, r2-3, unranked]` | `[400, 400, 400]` | `[600, 600, 300]` |
| `signColors` | `true` | `false` |
| `plusSign` | `true` | `false` |
| `align` | `baseline` | `center` |
| shadow | — | `0 1px 2px alpha(SHADOW, 0.85)` |

* Vivid's **low ease (0.4)** is what separates it from "turn the alpha up": *"the curve rises steeply out of zero, so the quiet two-thirds of a column
  still differentiate instead of all sitting on the floor, and only the genuinely large strikes approach the cap."*
* Vivid drops the coloured `+`/`−` because *"at this ramp a cell can be a full-strength negative tile, and a green '+' on it is the unreadable case.
  Direction is carried by the tint."* It also drops the `+` glyph entirely — *"a whole column of ink saying what the absence of a minus already says,
  in the one place with no room to spare."*
* Vivid's `inset` is a **0.5px margin, not a grid gap**: *"it separates the tiles without moving the column tracks, so the sticky header and the
  strike rails stay aligned."* It is **not applied on the ATM row** — *"that rule is an inset shadow on every cell in the row, and a margin would
  break it into dashes."*
* CLASSIC's entry is *"byte-for-byte the chain as it shipped — switching skins must be reversible to exactly the old page."*
* Switching skins **moves the Intensity slider** to the new skin's `def`: *"the ramps are different shapes, so 1.75 on one is not 1.75 on the other
  and carrying a number across lands somewhere nobody chose."*

### The CB wash

CB used to be a **flat gold layer** over the whole cell. *"That was the bug: a Core strike below spot is negative, but at .85 the gold buried the red
and a short-gamma Core looked exactly like a long-gamma one."* The fix is a directional gradient:

```
CB_WASH_ANGLE = '112deg'   CB_WASH_HOLD = 26%   CB_WASH_END = 66%
linear-gradient(112deg, <solid gold> 0%, <gold @ skin alpha> 26%, <gold @ 0> 66%), <heat beneath>
```

`112deg` and not `135deg` *"because the cell is ~7× wider than it is tall: a true diagonal would clear the gold within the first two characters."* CW
and PW stay a flat two-stop wash — *"their colour IS the sign (blue call wall, red put wall), so there is nothing underneath for them to hide. Only CB
gets the directional gradient, because gold is the one level colour that carries no direction of its own."*

`"blend"` is expressed as a `linear-gradient` rather than a colour because *"it is the only way to composite one translucent layer over another in a
single `background` without knowing what the layer underneath resolved to."*

### Colour tokens actually used

Every colour reaches the page through `src/design/theme.ts`, which is `var(--color-…)` underneath. Hexes below are the declared values in
`src/design/tokens.css`.

| Used as | theme export | Token | Hex |
|---|---|---|---|
| Positive gamma fill | `GEX_POS` | `--color-gex-pos` | `#4d8cff` |
| Negative gamma fill | `GEX_NEG` | `--color-gex-neg` | `#ff5fa2` |
| CB (Core Bullseye) fill / ★ | `LEVEL_COLORS.cb` | `--color-level-cb` | `#ffd166` |
| CW (Call Wall) fill | `LEVEL_COLORS.cw` | `--color-level-cw` | `#4d8cff` |
| PW (Put Wall) fill | `LEVEL_COLORS.pw` | `--color-level-pw` | `#ff5fa2` |
| ★ ink on a solid level tile | `LEVEL_ON_SOLID` | `--color-app` | `#0a0d10` |
| Page accent, ATM strike, headers | `T.cyan` | `--color-accent` | `#2f6bff` |
| Replay everything (dock, bar, stamp) | `T.orange` | `--color-warn` | `#ffd166` |
| Positive column total, ✓ Refreshed | `T.green` | `--color-up` | `#3ddc8e` |
| Negative column total, ✗ Failed | `T.red` | `--color-down` | `#ff6b7a` |
| Cell ink | `CHAIN.ink` = `T.text` | `--color-fg` | `#e7ece9` |
| Strike rail ink | `CHAIN.strike` = `alpha(T.text, .92)` | `--color-fg` @ 92% | — |
| Empty cell `·` | `CHAIN.none` = `T.flat` | `--color-flat` | `#c0c5c3` |
| ★ ring on CLASSIC | `CHAIN.mvc` = `T.purple` | `--color-dex` | `#6aa0ff` |
| Sign glyphs | `CHAIN.signUp` / `signDown` | `--color-up` / `--color-down` | `#3ddc8e` / `#ff6b7a` |
| Empty-state copy | `CHAIN.empty` = `T.muted` | `--color-muted` | `#e7ece9` |
| Sticky header / rail plate | `T.panel` | `--color-surface` | `#0e1216` |
| Grid plate | `T.panelBg` | `--color-surface2` | `#141a21` |
| Borders | `T.border` | `--color-line` | `#1e2630` |
| Page canvas | `T.bg` | `--color-bg` | `#0a0d10` |
| Drop shadows, marker stroke | `SHADOW` | `--color-shadow` | `#000000` |
| Ladder positive bars | `MOVE_UP` | `--color-move-up` | `#4d8cff` |
| Ladder accents / replay chip | `LIGHT_BLUE` | `--color-series-5` | `#7fb0ff` |

Type sizes come from `tokens.css`'s scale: `--text-3xs` 9px, `--text-2xs` 10px, `--text-xs` 11px, `--text-sm` 13px, `--text-base` 15px, `--text-lg`
18px, `--text-xl` 24px, `--text-2xl` 32px.

### Marker legibility

`MARKER_EDGE` is applied to the ★ (CLASSIC) and the ✕:

```ts
{ WebkitTextStrokeWidth: '1px', WebkitTextStrokeColor: SHADOW,
  paintOrder: 'stroke fill',
  textShadow: `0 0 3px ${alpha(T.text, 0.9)}, 0 0 1px ${SHADOW}` }
```

*"Gold-on-blue and red-on-red both wash out at 10px, so both glyphs get a hard dark edge (`paint-order: stroke`, so the stroke sits OUTSIDE the fill
and does not eat the glyph) plus a light halo."*

On a skin that **fills** levels (vivid), the ★ is instead pinned absolutely to `top: 1, left: 2` in `LEVEL_ON_SOLID` ink — *"which is exactly where
`levelFillBg` holds the CB wash at FULL gold… A gold star on a gold tile is an invisible star."* **No halo there**: *"the corner is solid gold under
the glyph, so the ★ already has its own ground and a glow just softens it."* And no ring: *"a 2px ring on a gold tile reads as a smudge, not a marker.
CLASSIC keeps it — nothing else marks CB there."*

### Per-frame / perf machinery

* **`useDeferredValue(intensity)`** — the grid reads `deferredIntensity`. *"React commits the slider urgently and repaints the ~560-cell matrix on a
  lower-priority pass it can interrupt."* Note that `levelsOnly` is derived from the **deferred** value too, so the levels-only switchover rides the
  same low-priority pass.
* **`ChainMatrix` is `memo`'d** — *"so transient parent state (the load bar, an Intensity slider commit) never re-renders ~560 cells. It re-renders
  only when its own data props change — which, thanks to the hook's `useMemo`/`useCallback`, is exactly 'when the chain data changed.'"*
* Every derived array (`colScales`, `coreCols`, `mvcByCol`, `coreAbsByCol`, `volMvcByCol`, `visibleStrikes`, `allStrikes`, `replayAxis`,
  `replayColumns`) is memoised, and `valueAt` is a `useCallback` — which is what makes the memo above hold.
* The ladder modal memoises its whole row list against `[allStrikes, netByStrike, denom]` so a ~60Hz tween tick does not reconcile it.

### The two CopyShot targets

Published through `useCopyShotTargets` (`src/shell/CopyShot.tsx`), consumed by the toolbar's camera:

| id | Label | File | Resolves to |
|---|---|---|---|
| `chain:page` | `Options Chain` (⛓️) | `options-chain` | `pageRef.current` — the whole `<main>` |
| `chain:grid` | `Chain grid only` (▦) | `options-chain-grid` | `chainScrollRef.current?.firstElementChild` — **the grid, not the scroll port** |

*"Two, because there are two things you take a picture of this page for."* The grid target hands over the grid and not the scroll port because *"the
ladder is taller than the window, and a shot of the scroll port is a shot of whichever strikes happened to be showing."*

Both resolve at **click time, not capture time**: *"the grid is behind two early returns (the replay empty state and the no-strikes state), so a ref
read at publish time is stale about as often as not."*

Capture contract attributes used here (see `src/shell/snapshot.ts`):

* `data-capture-meta` on `<main>`: `` `${activeTicker} · ${greekMode.toUpperCase()} · ${displayPercent}% strikes` `` — *"The caption's tail.
  Everything the toolbar says about what this grid IS, so a shot of the grid alone still answers it."*
* `data-capture-hide` on the FOCUS and DIM/HIDE chips — *"they are CONTROLS, and a screenshot of the grid should not carry the buttons that were used
  to set it up — the ⅀ header already names the expiries the focus picked, in dates."*
* `data-capture-trim` on the **first ghost cell of the header row** — the picture stops at that element's left edge, *"so a hidden-column shot frames
  what is on screen instead of the empty space held open beside it."*

---

## Replay behaviour

### Entry

`replay.on` is either toggled from the cog or passed in as `initialReplay` (that is how `/replay` mounts the page, with `initialReplayScope="0dte"`).
The prop is **initial state only** — *"the cog's toggle still works, so exiting replay from inside the tab behaves normally."*

### What replay swaps, and where

**Replay swaps `columns` at the source.** *"Everything downstream — the window, the scales, the markers, the totals — is written against `ExpColumn[]`
and has no idea where the numbers came from, so rewinding costs no branch at any of those call sites."*

```ts
const columns = replayFrame ? replayColumns : liveColumns
const spot    = replayFrame ? (replayFrame.spot > 0 ? replayFrame.spot : liveSpot) : liveSpot
```

The spot is the **spot as recorded** — *"that is the point of a rewind. Falls back to live only if the frame carried no usable price."*

### What is and is not recorded

`strike_growth` records **GEX only**, and only the OI+Vol net plus the pure-volume series. So:

* `greekMode` is **pinned to `gex`** while replaying and restored on exit (`preReplayModes`). Deliberately *not* a silent disable — *"the tiles stay
  visible and inert, with a reason."*
* `OI + Vol` ↔ `Vol Only` **stays live** in replay: `strike_growth` records both bases, *"so the toggle means the same thing rewound as it does
  live."*
* `OI Only` is **disabled** with a title saying why.
* `flow` and `oi-only` fall back to reading the OI+Vol net *"rather than silently rendering an empty grid on a basis that looks available."*
* Every other field on a replayed cell is **zero, not a live value** — *"a live DEX beside a 30-minutes-ago GEX is the exact confusion replay exists
  to avoid."*

### The frames

One request per `(symbol, session)`: *"the whole day is pulled up front so scrubbing is instant and never re-hits the network mid-drag."* On a date
change the previous session is **dropped immediately** — *"holding it while the new day loads would render one date's grid under another date's
label."* On load the index lands on the **last** frame: *"entering replay from a live chain, the nearest thing to what was just on screen is the most
recent snapshot."*

Wire shape: `cells: [[expiryIndex, strike, net, vol], …]`, with `expiries` as the index table. Parsed into `Map<"exp|strike", {net, vol}>` plus the
`expiries` each frame actually carried.

### The fixed session axis

```ts
replayAxis = { strikes: [...], expiries: [...] }   // every strike/expiry in ANY frame, scoped
```

*"This is the difference between a replay you can read and one that shakes. The recorder stores the top N strikes a side PER SWEEP, so building the
axis from the current frame makes rows enter and leave at both ends on every step. A strike this frame did not record simply renders blank in its
row."*

Scope is applied **first**: in `0dte` the axis covers only that expiry, *"or every strike that was ever a wall in a LATER expiry survives as a
permanently blank row and the one column on screen is lost in whitespace."*

Columns likewise come from the **session** axis, not the frame — *"per-frame columns made the grid reflow horizontally every time an expiry dropped
out of a sweep."*

### 0DTE resolution

`replayZeroDteExp` = the expiry equal to the replayed date, else the **earliest** recorded expiry. `replayZeroDteIsExact` says which of the two it is.
*"Roots without a same-day listing never have one, so fall back to the earliest expiry recorded — the front contract, which is what '0DTE' means for
that root on that day. Surfaced in the bar so a fallback is never mistaken for a true same-day expiry"* — the bar prints `{exp} — front recorded
expiry; this root had no same-day listing`.

### Layout under replay

* `gridCols = columns.length` (live: `max(columns.length, key ? 4 : seqColumns)`).
* `showTotalCol = !(replayFrame && scope === '0dte')`.
* `layoutExpCols = replayAllExpiries.length` — *"Size the rewound grid for the session's FULL expiry count in either scope, so switching 0DTE↔All
  changes which columns are on screen and nothing else."* Live passes 0, which disables the ghost-track mechanism entirely.
* Ghost tracks: `layoutBase = max(layoutExpCols, hideCols ? layoutIdx.length : 0)`, `ghostExpCols = max(0, layoutBase - renderIdx.length)`, plus one
  ghost for a dropped ⅀ column. *"Expiry tracks are 1fr, so they divide the container: drop from 4 columns to 1 and that one inflates to the full grid
  width, which is not a filtered view of the same chain — it is a different-looking page."*

### Playback

`REPLAY_BASE_MS = 700` at 1×; the interval is `REPLAY_BASE_MS / speed`. **It stops at the last frame rather than looping** — *"a session that silently
restarts reads as live data jumping backwards."* Pressing play from the end rewinds to 0 first: *"Replaying from the end would show one frame and
stop, which reads as broken."*

### The ATM scroll rescue, and the 🔒 Axis lock

```ts
if (axisLock) return
if (!replay.frame || !replay.playing) return
const band = viewH * 0.2                       // dead zone: the middle 60%
if (rowTop >= band && rowTop <= viewH - band) return
container.scrollTop = el.offsetTop - viewH / 2 + el.clientHeight / 2
```

*"The session axis is fixed, which is what makes the grid hold still — but it also means the ATM row walks down a stationary ladder as the session
runs, and over a full day it can walk clean off screen."* Two rules stop it becoming the jitter it replaced: **it scrolls, it never reflows**, and it
fires only when the ATM row has actually left the middle 60% — *"a rescue every few minutes of playback, not a nudge every frame."* It is gated on
`playing` *"because while paused or scrubbing the user is driving"*, and off entirely under `axisLock`: *"Stepping back and forth over the same few
minutes is exactly when a scroll you did not ask for reads as the grid jumping, and it is exactly when the rescue is least needed."*

The separate **load-time centring** effect keys on `` `${activeTicker}|${selectedExpiry}|${visibleStrikes.length}` `` and runs inside a
`requestAnimationFrame`.

### The transport bar (`ReplayBar`)

Left to right: `Replay` (orange, uppercase) · date `ChainDropdown` · `Exp` scope buttons · `◀` · `▶`/`❚❚` · `▶` · scrubber (`accentColor: T.orange`,
`minWidth: 160`) · `Speed` × 5 · `🔒 Axis` · `|` · frame clock `HH:MM:SS ET` (mono, 800) · `spot {n.nn}` · `frame i / n` · the coverage line ·
loading/error · spacer · `⛶ Ladder`.

**The coverage line is stated twice over**, and that is deliberate. `strike_growth` records only the top N strikes a side per sweep, *"so the grid
looks like the live chain while being a record of the WALLS — without the 'recorded walls only' line and the cells-this-frame count, a missing strike
reads as 'no gamma there' rather than 'the recorder never stored that strike'."*

```
· recorded walls only · {scope description} · {shown}/{axis.strikes × max(1, axis.expiries)} cells this frame · GEX only
```

The denominator **shrinks with the scope** *"instead of implying the 0DTE view is missing the other expiries' cells."*

Scope switching leaves `idx` untouched: *"the clock you are parked on is the thing being examined, and losing it to change what is summed would be the
wrong trade."*

### The replay stamp

`ReplayStampLayer` is drawn over the pane at `left: 12, top: 8`, `pointerEvents: none`, with:

* `symbol` = `activeTicker`
* `expiryLabel` = `fmtExpiryShort(zeroDteExp)` in `0dte` scope only
* `zeroDte` = `scope === '0dte' && zeroDteIsExact`
* `extraExpiries` = `allExpiries.length - 1` in `0dte` scope
* `dateLabel` = `fmtStampDate(replay.date)`
* `clockLabel` = `` `${fmtReplayClock(frame.ts)} ET` ``
* `note` = `recorded walls only`

*"A rewound chain looks exactly like a live one, so a recording of one that does not say so is the single worst way this page can be misread."* The
stamp rides the **pane**, not the chrome, because *"a recording is a crop of the pane, and a caption that lives in the page chrome above it is one
crop away from being gone."*

### Selection invalidation

```ts
useEffect(() => { clearSel() }, [activeTicker, selectedExpiry, replayDate, replayScope, clearSel])
useEffect(() => { if (!hasSel) setHideUnsel(false) }, [hasSel])
```

*"A focus selection is about the columns/strikes on screen — a new ticker, a new expiry window or a jump in/out of replay invalidates it."* And HIDE
is reset with it, which is what makes the **next** pick start on DIM. That is explicitly **not** a remembered preference: *"clicking a column header
is a 'show me this one' gesture, and having the rest of the board vanish because of a choice made in some earlier session is a page that looks
broken."*

Leaving replay (or switching ticker) also drops the frames *"so the next entry does not flash the previous symbol's frames under the new ticker."*

---

## Phone behaviour

**There is no `/m/chain` tab.** It existed for one day and was removed on **2026-09-03** — the note is still in `src/mobile/mobileNav.ts`:

> *"NO CHAIN TAB (2026-09-03, removed the day after it landed). The v3 options chain is a strike
> ladder with up to a dozen numeric columns read ACROSS; at 390px it is a horizontal scroll over a
> table you cannot see two columns of at once, which is not the page, it is a picture of the page. It
> stays a desktop screen until there is a phone DESIGN for it rather than the desktop one made
> narrow. `/v3/options-chain` is untouched."*

Consequences:

* `DESKTOP_TO_MOBILE` has no `/options-chain` entry, so **a phone opening `/v3/options-chain` gets the desktop page**, not a redirect. *"Everything
  else keeps rendering its desktop layout, because there is no phone build of it and a cramped real page beats a redirect to an unrelated one."*
* On `/m/*` routes `Shell.tsx` drops the rail and the toolbar, and hides the board's `SPX` chip and `TickerPicker` (`{!mobile && …}`) — but none of
  that applies here, since the page is only reachable on the desktop route.
* The page itself makes no `useIsPhone()` call. Its one concession to narrow widths is the toolbar's `overflowX: 'auto'` with `scrollbarWidth:
  'none'`.

⚠ `AGENTS.md` still lists `/m/chain → pages/OptionsChain` in its phone-build table. **That row is stale** — `mobileNav.ts` and `App.tsx` are the
truth.

---

## Status and empty-state messages, verbatim

### Page body

| When | Heading | Body |
|---|---|---|
| `replay.on && !replay.frame && replay.loading` | `Loading recorded session…` (in `T.orange`) | `{TICKER} · {date}` |
| `replay.on && !replay.frame && !loading` | `Nothing recorded to replay for {TICKER}` (in `T.orange`) | `{replay.err or 'No snapshots for this ticker yet.'} The recorder keeps roughly five trading days and only covers tickers on the scanner watchlist.` |
| `!visibleStrikes.length && chainError` | `No Live Chain Data` | the `chainError` string |
| `!visibleStrikes.length && !chainError` | `Select ticker, expiry & % strikes` | `Then click ↻ Now to load the chain` |

Both states render through `EmptyState`: centred, `maxWidth: 460`, heading 14px/700, body 12px/`lineHeight 1.5`, ink `CHAIN.empty`.

### Error strings set by the data layer

* `No live chain payload returned for {TICKER}.`
* `Live chain load failed for {TICKER}.`
* `Could not load recorded sessions.`
* `No recorded sessions for {TICKER}.`
* `Could not load frames.`
* `No recorded frames for {TICKER} on {DATE}.`

### Toolbar

* Refresh button: `↻ Now` / `↻ Refreshing…` / `✓ Refreshed` / `✗ Failed`.
* OI provenance chip: `ΔOI {date} vs {prevDate}` / `OI {date} · no prior snapshot yet` / `OI snapshot not recorded`.
* Live dot: `LIVE` / `REPLAY`.

### Replay bar

* Clock placeholder when there is no frame: `--:--:--`; spot placeholder `spot —`.
* `· loading…` (cyan) while `replay.loading`.
* `· {err}` (red) when not loading and an error is set.
* `· recorded walls only · … cells this frame · GEX only`.

### In the grid

* `·` — a cell with no value (`CHAIN.none`).
* `—` — an `OiChgLine` with `chg === null`, i.e. **no stored baseline**; also a column header with no column, and the column total when there is no
  column.
* `Strike` — both corner cells.
* `Total` / `{M/D}` / `{M/D}-{M/D}` — the ⅀ header.

### Ladder modal

* `Loading…`
* `No recorded frames for {SYMBOL} on {DATE or 'this date'}.`
* `Could not load recorded symbols.` / `Could not load recorded dates.` / `Could not load frames.` / `No data.`
* `{n} session` / `{n} sessions`
* `Frame {i} / {n}`

---

## Performance and bundle

* **The route is `lazy()`** in `App.tsx` — rule 1: *"A route that is in the entry chunk is a route every user downloads whether they visit it or
  not."* Chunk names fall out of file names, *"which is what makes an over-budget route legible in `check-budgets.mjs` output."*
* `/replay` reuses **the same chunk**: *"three of the four tabs `lazy()` into the SAME chunks `/options-chain` and `/analytics` already load."*
  `LadderModal` is separately `lazy()`'d there so opening `/replay` does not pull the chain's chunk down before a tab is picked.
* **`budgets.json` lines that bind this page** (all **brotli** bytes, enforced by `scripts/check-budgets.mjs` on every `npm run build`):

  ```json
  "entry":        38900,
  "react":        55000,
  "route":        59100,
  "data":         78000,
  "css":           8500,
  "html":          2600,
  "totalInitial": 108400,
  "ratchet": { "slack": 0.15, "enforce": false }
  ```

  This page is measured against **`route` = 59100**. The `data` line is for `data-*` manual chunks
  (today only `data-seasonality`) and has nothing to do with this route. *"Raising a number is a
  deliberate decision that shows up in a diff… LOWERING one matters just as much"* — `npm run
  budgets:ratchet`. A budget carrying more than `slack` (15%) headroom is reported as SLACK, but
  `enforce: false` keeps that from failing a build.
* **`perf` limits** in `budgets.json` (`idleRepaintsPerFrame 0.15`, `offscreenRepaints 0`, `interactionRepaints 10`) count repaints on canvases tagged
  `data-cb-layer`. **This page owns none**, so the guard is structurally silent here.
* **`theme-baseline.json`** grandfathers this page's remaining violations of non-negotiable #1 — these are the numbers a build fails on if they go
  **up**:

  | File | Baseline |
  |---|---:|
  | `src/pages/OptionsChain.tsx` | 15 |
  | `src/pages/optionsChain/ChainMatrix.tsx` | 15 |
  | `src/pages/optionsChain/StrikeHoverCard.tsx` | 9 |
  | `src/pages/optionsChain/ReplayBar.tsx` | 4 |
  | `src/pages/optionsChain/pickers.tsx` | 3 |
  | `src/pages/optionsChain/heatSkins.ts` | 2 |

  (`useChainData.ts`, `chainMath.ts`, `format.ts`, `marketSession.ts` and `LadderModal.tsx` are at
  **zero** and can never regress.) Almost all of the remainder is rule 4 — raw numeric `fontSize`
  values like `fontSize: 12`, `fontSize: 9.5`, `fontSize: 11.5` — not colour literals.
  **Never raise a number to make a build pass.**
* The grid is roughly **560 cells** at the default window; that number is the budget the `useDeferredValue` + `memo` pair is sized against.

---

## Gotchas

1. **The expirations effect depends on `activeTicker` ONLY.** `loadChain` is stable and `selectedExpiry` is read through a ref — *"listing it here is
   what caused v2's infinite fetch loop."* Do not add it to the dep array.
2. **The OI snapshot is ticker-gated in exactly one place.** Its map keys are `expiry|strike` with **no symbol in them**, so without the `oiSnapshot`
   gate *"the previous ticker's ΔOI renders under the new ticker's chain for a whole round trip, indistinguishable from real data."* One place to
   gate, *"so the matrix and the provenance label can never disagree about which ticker they are describing."*
3. **`refreshSeed` is the commit signal, not a value.** `expColumnsRef` is a ref; `liveColumns` is a `useMemo` that depends on `refreshSeed`.
   `loadChain` bumps it by `0.01` and `doRefresh` by `1`. Remove it and the grid stops updating while looking completely correct.
4. **`fmtMoney(0)` is `+$0`, on purpose.** Do not "fix" it to `$0` — the column is signed gamma and a bare `$0` reads as *no data*.
5. **The ATM rule must stay an inset box-shadow.** A real border resizes the row and shoves the whole ladder each time spot crosses a strike.
6. **The scroll container must keep `padding: '0 10px 10px'` with no top padding.** Top padding makes the sticky header stick to the content edge and
   rows scroll visibly above it. Breathing room is `marginTop: 8` on the grid.
7. **Ghost tracks go AFTER the right strike rail.** Put them before it and the right-hand strike numbers get pushed to the far edge and
   `data-capture-trim` stops framing both rails.
8. **A padding row still renders one cell per track.** Rows are `display: contents`; a short row shears the grid.
9. **`nearCore` is a filter, never a fill.** The wall check comes first, so the dial can never make a CB/CW/PW disappear, and a near-core strike is
   painted exactly as it would have been with the filter off. **Gold is the core's alone.**
10. **The ★ follows the active tab; the ✕ does not.** `coreCols` reads `valueAt`, so the ★ is the PREM core on the PREM tab. `volMvcByCol` is GEX-only
    by design, and only drawn on `gex` + `oi-vol`.
11. **`cell.prem || null`** — a genuinely zero-premium strike must read as absent, or the dead wings poison the column scale and the ⅀ totals.
12. **Replay is GEX-only and it says so three times** (the pinned greek tab with its title, the disabled `OI Only` basis, and the `GEX only` line in
    the bar). Non-recorded greeks are **zero**, not live values.
13. **`flow` and `oi-only` silently read the OI+Vol net in replay.** That is the deliberate fallback, and the Basis control's title is what tells the
    user.
14. **Do not add an `aria-label` change to the cog.** `scripts/parity-check-chain.mjs` opens both pages' settings menus by `aria-label="Options chain
    settings"`.
15. **The market-session holiday table is knowingly incomplete.** Good Friday and Juneteenth are absent and there is no early-close (13:00) handling.
    *"Widening it here would make the chain poll on a day v2 skips (or vice versa)… so it comes across as-is and gets fixed on both sides at once or
    not at all."*
16. **`buildExpiries()` is a fabricated calendar.** It exists only until `/api/expirations` resolves. *"Never offer one of these as a real listing:
    NVDA has no Monday weeklies, and picking one returns an empty chain."*
17. **`ChainDropdown` rows fire on `pointerdown`, not `click`.** `useAnchor` repositions the menu on any scroll in the **capture** phase, *"so a list
    that moved a few pixels between press and release left the two events on different rows — and `click` only fires when they match, so the pick
    silently did nothing."*
18. **`ChainDropdown` portals to `<body>` and must carry `POPOVER_SAFE_ATTR`.** Without it the ⚙ `Popover` reads the pointerdown on a row as a click
    outside itself, closes, and takes the menu down before the pick registers.
19. **The Ladder modal's `Select` needs `menuZ: 10000`.** The modal portals at z 9999 and `POP_Z` is 250, so the default would put the list behind its
    own scrim.
20. **The ladder's `setPlaying(false)` at the end lives in its own effect, not inside the `setIdx` updater.** *"Updaters must be pure (StrictMode
    invokes them twice), and setting state from inside one double-fires the pause."*
21. **Do not add a CSS transition to the ladder's spot line.** The JS tween already eases it; a transition restarts every frame and the line
    permanently trails its own label.
22. **The ladder tween's cleanup assignment (`animSpot.current = target`) is load-bearing.** Removing it makes the displayed spot drift by compounding
    shortfalls.
23. **`DIM`/`HIDE` is deliberately not persisted.** It resets whenever the selection empties.
24. **`/proxy/strike-dod` is fetched with `limit=2000` and filtered client-side** to the active ticker — and it only ever carries the single top-mover
    strike per ticker, which is why the hover card's fallback says `— (top-mover strike only)` rather than printing a zero.
