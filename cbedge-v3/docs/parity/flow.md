# Parity inventory — Flow

**What this is.** One line per value the v2 page renders, with where it comes
from, how it is formatted, what changes its colour, and what it shows when the
value is missing. It is the SPEC for the v3 port: the v3 page is finished when
every row here is ticked, and not before.

**Why it exists.** The failure mode this document prevents is rebuilding a page
from scratch — re-deciding what it contains at the same time as building it.
Both jobs were already done in v2. This file finishes the first one so the
second is only construction.

**Scope.** v2's `components/pages/Flow.tsx` (1534 lines, routed at `/app/flow`
via `app-vite/src/App.tsx` line 88) plus everything it renders:

| File | Lines | Why it is in scope |
|---|---|---|
| `components/pages/Flow.tsx` | 1534 | the page |
| `components/dashboard/ContractDrawer.tsx` | 515 | the expanded whale row — rendered inline in the tape |
| `hooks/useContractStats.ts` | 152 | source of the Vol / OI / IV columns and the live `% OTM` spot |
| `lib/dislocationVelocity.ts` | 42 | the maths behind the Dislocation Velocity card |
| `components/shared/ThemedDatePicker.tsx` | — | the Session control |
| `app/globals.css` `@media (max-width: 899px)` | 485–528 | the phone layout the page's class hooks opt into |

**Total: 214 checklist rows.**

| Part | Covers | Rows |
|---|---|---|
| A | Page frame, URL params, `chartonly` capture mode, class hooks | 13 |
| B | Top bar — view tabs, Big-OTM preset, session date | 11 |
| C | Filters card — header, Scope (combined) / Watchlist (ticker) | 15 |
| D | Filters card — the eight-control filter grid | 17 |
| E | Net Drift chart card — header, legend, span toggle, axis note, empty | 15 |
| F | Net Drift chart — series, scales, axes, formatters, visible range | 17 |
| G | Net Drift chart — crosshair tooltip | 13 |
| H | Premium Split — the four cards (shared by both views) | 11 |
| I | Dislocation Velocity card | 9 |
| J | Combined Premium Split card | 3 |
| K | Flow Tape — header bar and totals | 11 |
| L | Flow Tape — column headers (16 columns) | 18 |
| M | Flow Tape — row cells, whale treatment, empty + overflow states | 24 |
| N | ContractDrawer — header, KPI rail, contract chart | 25 |
| O | Data plumbing — endpoints, polling, caches, merge, sort order | 22 |
| — | Appendix: v2 bugs, v3 contract gaps, decisions needed before build | — |

**Column meanings**

- **Source** — the endpoint AND the field underneath it, or the exact
  client-side formula where the value is derived. `/proxy/flow-netprem →
  bins[].callNet` is a source; "the net premium" is not.
- **Format & units** — decimal places, sign prefix, `$`, `%`, `d`, `×`.
  What the code actually does, not what looks sensible.
- **Threshold / colour rule** — every condition that changes a colour, a weight
  or the wording. This is where detail goes missing when a page is described
  rather than transcribed.
- **Empty / loading** — literally what renders when the value is not there.

---

## v2 colour constants

`components/shared/homeTheme.ts` (`HOME_THEME as C` inside Flow.tsx), plus the
four literals Flow.tsx declares itself.

| Token | Value | Note |
|---|---|---|
| `C.bg` | `#05060A` | |
| `C.panel` | `#0D1119` | |
| `C.cyan` | `#219EBC` | the "active control" colour throughout this page |
| `C.purple` | `#126783` | a dark teal, not a violet — unused on this page |
| `C.orange` | `#FB8501` | drawer fill line, fill-bar volume tint, Vol/OI tile |
| `C.green` | `#8ECAE6` | **a light blue** — used only for filter LABELS and the drawer's price line |
| `C.red` | `#EF4444` | |
| `C.muted` | `#FFFFFF` | identical to `C.text`; "muted" is achieved with `opacity`, not hue |
| `C.text` | `#FFFFFF` | |
| `C.border` | `rgba(255,255,255,0.10)` | |
| `C.panelBg` | `rgba(13,17,25,0.45)` | |
| `DOCK_THEME.activeTile` | `linear-gradient(180deg, rgba(33,158,188,.16), rgba(33,158,188,.04))` | active segmented-control tile |
| `DOCK_THEME.activeBorder` | `rgba(33,158,188,.3)` | |
| `DOCK_THEME.activeGlow` | `0 0 14px rgba(33,158,188,.22)` | |

**Declared in `Flow.tsx` itself** (these are the literals the v3 theme check
will reject — every one needs a token):

| Name | Value | Used for |
|---|---|---|
| `BUY_GREEN` / `BULLISH` | `#22c55e` | calls, buys, bullish bias. **Deliberately not `C.green`**, which is a light blue |
| `BEARISH` | `C.red` = `#EF4444` | puts, sells, bearish bias |
| `VOL_GREEN` | `rgba(34,197,94,0.55)` | volume histogram bar, call-heavy minute |
| `VOL_RED` | `rgba(239,68,68,0.55)` | volume histogram bar, put-heavy minute |

**Declared in `ContractDrawer.tsx`:** `BULL = #22c55e`, `BEAR = C.red`.

**Ad-hoc rgba literals** (all need tokens in v3): `rgba(0,0,0,0.4)` (control and
split-card fill), `rgba(0,0,0,0.35)` (drawer KPI tile / chart well),
`rgba(255,255,255,0.04)` (Reset + preset button fill), `rgba(255,255,255,0.06)`
(split heat-bar track), `rgba(255,255,255,.05)` (chart grid lines),
`rgba(255,255,255,.10)` (chart axis borders), `rgba(255,255,255,.08)` (tooltip
header rule), `rgba(33,158,188,0.10)` (expanded row fill),
`rgba(33,158,188,0.4)` (expanded row outline), `rgba(33,158,188,0.05)` (drawer
fill), `rgba(33,158,188,0.5)` (tooltip top rule), `rgba(142,202,230,0.12)`
(status badge fill), `rgba(142,202,230,0.45)` (drawer volume bars),
`rgba(239,68,68,0.12)` (status badge fill, disconnected), `rgba(6,12,18,0.98)`
(Recent dropdown), `rgba(10,13,20,0.96)` (tooltip), `rgba(34,197,94,0.08)` /
`rgba(239,68,68,0.08)` (tooltip row tints), `rgba(34,197,94,0.4)` /
`rgba(251,133,1,0.4)` (drawer KPI tile borders), `#fff` (tooltip innerHTML).

## v2 shared inline styles

Declared once in `Flow.tsx`, referenced by name throughout the tables below.

- `labelStyle` = `14px / 700 / letterSpacing .08em / uppercase / C.green / marginBottom 4 / display block`
- `fieldStyle` = `homeInputStyle` + `width:100%`, where `homeInputStyle` =
  `14px · padding 8px 12px · 1px C.border · radius 6 · bg rgba(0,0,0,.4) · C.text · outline none`
- `segWrapStyle` = `flex · 1px C.border · radius 6 · bg rgba(0,0,0,.4) · overflow hidden`
- `segBtn(active)` = `flex 1 · padding 8px 6px · 14px/700 · uppercase · letterSpacing .06em ·
  border none · bg (active ? DOCK_THEME.activeTile : transparent) · color (active ? C.cyan : C.text) ·
  boxShadow (active ? DOCK_THEME.activeGlow : none) · transition all .15s`
- `GRID` (ticker view, 15 columns) =
  `78px 56px 84px 72px 46px 74px 88px 96px 74px 68px 58px 66px 44px 88px 74px`
- `GRID_COMBINED` (16 columns) = `64px ` + `GRID`

## v2 numeric constants

| Constant | Value | Meaning |
|---|---|---|
| `WHALE_FLOOR` | `500_000` | premium at or above which a print is bold + click-to-expand |
| `PREMIUM_MAX` | `1_000_000` | Min Premium slider ceiling, **ticker view** |
| `DEFAULT_MIN_PREMIUM` | `15_000` | tape floor at mount and after Reset |
| `CHART_MIN_PREMIUM` | `1_000` | Net Drift floor — **decoupled** from the slider |
| `BIN_SEC` | `60` | chart bucket width, seconds |
| `NET_LATE_SEC` | `900` (15 min) | how far back every incremental `?since` poll re-asks. Mirrors server `NETPREM_LATE_MS` |
| `MAX_TAPE_ROWS` | `800` | rendered row cap; totals still span the full set |
| `TAPE_FLUSH_MS` | `2000` | WS tape coalescing window |
| `RECENT_TICKERS_MAX` | `7` | |
| `useMinuteBars` `maxBars` | `90` | DV bar ring buffer |
| chart host height | `340` px | |
| tape `minWidth` | `1116` ticker / `1180` combined | inside `overflow-x:auto` |

## v2 formatters — transcribe these exactly

| Fn | Rule |
|---|---|
| `fmtPremium(v)` | `a=abs(v)`, `sign = v<0 ? "-" : ""`. `a ≥ 1e6` → `{sign}${(a/1e6).toFixed(2)}M`; `a ≥ 1e3` → `{sign}${(a/1e3).toFixed(1)}K`; else `{sign}${a.toFixed(0)}`. **No `+` on positives.** |
| `fmtStat(v)` | `null`/non-finite → `"—"`; `≥1e6` → `{(v/1e6).toFixed(1)}M`; `≥10_000` → `{(v/1e3).toFixed(1)}K`; else `v.toLocaleString()`. Note the **10K** (not 1K) threshold |
| `fmtContractCost(price)` | `cost = price*100`. `≥1e6` → `$X.XXM`; `≥1e3` → `$X.XK`; else `$X.XX` |
| `fmtSpot(spot)` | falsy (incl. `0`) → `"—"`; else `toLocaleString(undefined, {min:2, max:2})` |
| `fmtTime(ts)` | `toLocaleTimeString("en-US", {timeZone:"America/New_York", hour:"2-digit", minute:"2-digit", second:"2-digit"})` → `"09:31:04 AM"` |
| `fmtEtHm(sec)` | `Intl.DateTimeFormat("en-GB", {tz ET, hour:"2-digit", minute:"2-digit", hour12:false})` → `"08:58"`. **en-GB, 24h** — different locale from `fmtTime` |
| `isBullish(side,type)` | `(buy && call) \|\| (!buy && !call)` — buy calls and sell puts are bullish |
| `dteOf(o, sessionYmd)` | `null` if no `expiration` or unparsable; else `round((Date.parse(exp+"T00:00:00Z") − Date.parse(sessionYmd+"T00:00:00Z")) / 86_400_000)`. **Measured against the SESSION DATE being viewed, not today** — see Appendix |
| `normTicker(u)` | `upper(u)`, then `{SPXW→SPX, NDXP→NDX, RUTW→RUT, XSPW→XSP}` |
| `todayYmdET()` | ET `Y-MM-DD` via `Intl` parts |
| `etWallToUtcSec(y,m,d,hh,mm)` | DST-safe: UTC guess corrected by (`asUTC` − `asET`) round-trip through `toLocaleString` |

`INDEX_TICKERS` (post-`normTicker`) = `SPX, NDX, RUT, XSP, VIX, DJX`.
`DEFAULT_TICKERS` = `SPX, SPY, QQQ, META, TSLA, AMZN, AAPL, NVDA, MSFT, GOOGL, AMD, NDX` (12, in that order — the watchlist chip order).

---

# Part A — Page frame, URL params, capture mode

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Page shell | `<PageShell className="no-card-lift flow-root">` | `homeShellStyle` + `homeContentStyle`, `overflow:auto`, `alignItems:stretch`, no `maxWidth` cap — cards run full window width | `no-card-lift` disables the `.card-hover` transform on this page | n/a |
| `flow-root` class hook | class only | — | Scopes the `@media (max-width:899px)` block in `globals.css` 487–526 | n/a |
| `flow-topbar` phone rule | `globals.css` 487–494 | `flex-wrap:nowrap`, `overflow-x:auto`, `gap:8px`, `padding-bottom:2px`, children `flex:0 0 auto` | ≤899px only | n/a |
| `flow-filters` phone rule | `globals.css` 497–508 | card padding → `8px 10px`, radius → `10px`; the Card's **title block is hidden** (`> div:first-child { display:none }`); watchlist block gets `max-height:84px; overflow-y:auto` | ≤899px only | n/a |
| `flow-filter-grid` phone rule | `globals.css` 510–525 | 2-up grid, `gap:8px`; labels `10px`, `margin-bottom:2px`; inputs/selects/buttons `min-height:30px`, `padding:4px 8px`, `12px`; `span 2` preserved | ≤899px only | n/a |
| `flow-chip` hover | `globals.css` 285 | `filter: brightness(1.15)` | every segmented button, watchlist chip, preset, GO, Recent, Today, Reset, RTH/24H carries `className="flow-chip"` | n/a |
| `.flow-tape-row` hover rule | `globals.css` 289–294 | `background-color: rgba(33,158,188,0.12)`, `transition .1s` | **DEAD in v2** — the tape row `<div>` does not carry the class. Port the hover, do not port the dead wiring. See Appendix | n/a |
| `contract-drawer-grid` phone rule | `globals.css` 528 | `grid-template-columns: 1fr` — chart stacks above the KPI rail | ≤899px only | n/a |
| URL param `?chartonly=1` | `urlParam("chartonly") === "1"`, read once into state at mount | boolean | Hides: top bar, filters card, span toggle, ticker-view Premium Split, Dislocation Velocity card, Flow Tape card. Leaves ONLY the Net Drift chart card | n/a |
| URL param `?ticker=SPX` | `urlParam("ticker")?.toUpperCase()` | string | Initial `active` ticker. Falls back to `DEFAULT_TICKERS[0]` = `"SPX"`. **Not added to `tickerList`** — so a `?ticker=` value outside the 12 defaults is active with no chip to click back to | defaults to `SPX` |
| URL param `?dteMax=0` | `urlParam("dteMax")` | number | Initial `dteMax`; `null` when absent, empty, or non-finite. Comment notes OTM-only is already the default | `null` |
| Chart capture wrapper | `<div id="flow-chart-capture">` | `display:` `none` when `view !== "ticker"`, `block` when `chartOnly`, else `contents` | `contents` keeps the chart card a direct flex child of PageShell; `block` because html2canvas cannot walk `display:contents`. **`none` still keeps the chart mounted**, so the once-created lightweight-chart instance survives a Combined round-trip | n/a |
| Card surface | every card is `<Card variant="budget">` | `classicCardAccentStyle`: `radial-gradient(circle at 50% 0%, rgba(33,158,188,0.07) 0%, transparent 55%)` over `C.panelBg`, `1px C.border` | The `accent` prop is **dead in v2** (`PageCard.tsx` ignores it). Do not port a per-card accent colour | n/a |

**Sort order.** Top bar → Filters → Net Drift chart (with Premium Split inside,
ticker view) → Dislocation Velocity → Combined Premium Split (combined view
only) → Flow Tape.

---

# Part B — Top bar (hidden entirely when `chartOnly`)

Container: `flex; align:center; gap:12; wrap; flexShrink:0`, `className="flow-topbar"`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "By Ticker" tab | `view` state | `segBtn(view === "ticker")` inside `segWrapStyle` capped at `maxWidth:320` | Active → `DOCK_THEME.activeTile` bg, `C.cyan` text, `activeGlow`. Inactive → transparent bg, `C.text` | default view |
| "Combined" tab | `view` state | same | same | — |
| "0–7DTE ≥$500K OTM" preset button | `applyBigOtmPreset()` | `padding 8px 14px; 14px/800; uppercase; letterSpacing .05em; radius 6; nowrap`. `title="Combined · 0–7 DTE · ≥$500K premium · OTM only"` | Active → border `C.cyan`, bg `rgba(255,255,255,0.08)`, text `C.cyan`. Inactive → border `C.border`, bg `rgba(255,255,255,0.04)`, text `C.text` | always renders |
| Preset — what it sets | click handler | — | `view="combined"`, `scope="all"`, `side="all"`, `optType="all"`, `minSize=0`, `expiry="all"`, `minPremium=500_000`, `dteMin=0`, `dteMax=7`, `otmOnly=true` | n/a |
| Preset — active test | `bigOtmActive` | — | `view === "combined" && minPremium === 500_000 && dteMin === 0 && dteMax === 7 && otmOnly`. **`scope`, `side`, `optType`, `minSize`, `expiry` are NOT part of the test** — the button reads active with e.g. Side=buy applied | n/a |
| "Session" label | static | `14px/700; letterSpacing .08em; uppercase; C.green` | none | n/a |
| Session date picker | `<ThemedDatePicker value={date} onChange={v => setDate(v \|\| todayYmdET())} width={170} />` | `YYYY-MM-DD`; initial value `todayYmdET()` | Clearing the picker snaps back to today rather than an empty state | initial = today ET |
| "Today" button | `setDate(todayYmdET())` | `padding 6px 12px; 14px/700; letterSpacing .04em; radius 6; 1px C.border; bg rgba(0,0,0,.4); color C.cyan` | Rendered **only when `!isToday`** | absent on today |
| "HISTORICAL" badge | `!isToday` | `14px; mono; padding 2px 10px; radius 4` | bg `rgba(142,202,230,0.12)`, text `C.cyan` | absent on today |
| `isToday` derivation | `date === todayYmdET()` | boolean | Gates: live WS merge, all 5s/15s polls, the `?since` incremental, the Today button, the HISTORICAL badge, and the tape status badge wording | n/a |
| Historical behaviour | — | — | On a past date the live WS tape is **excluded from both merges** (`if (isToday) for (const o of orders) …`), so live SPX prints can never bleed into a historical session | n/a |

---

# Part C — Filters card: header, Scope / Watchlist

Wrapper: `<div className="flow-filters">` → `<div style={{flex:"1 1 480px", minWidth:0, zIndex: recentOpen ? 200 : undefined}}>` → `<Card variant="budget" title=… subtitle=… style={{flexShrink:0, height:"100%"}}>`.
Hidden entirely when `chartOnly`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card title | static | `"Options Flow — Filters"` — `14px/800; letterSpacing .12em; uppercase; C.text`, `marginBottom:16` | Hidden on ≤899px | always |
| Card subtitle — ticker view | static | `"Live order flow off the /ws/gex feed. Pick a watched ticker to drive the chart + tape."` — `12px; C.green` | rendered when `view === "ticker"` | always |
| Card subtitle — combined view | static | `"Every ticker on one tape. Choose the scope, then filter."` | rendered when `view === "combined"` | always |
| "Scope" label (combined) | static | `labelStyle` | block wrapped in `marginBottom:18` | combined view only |
| "All" scope button | `scope` | `segBtn(scope === "all")`, wrap capped `maxWidth:360` | active-tile rule | default |
| "All − Indices" scope button | `scope` | `segBtn(scope === "exIdx")` | Excludes `INDEX_TICKERS` from the tape **client-side**. See Appendix — the server ignores it for the Premium Split | — |
| "Watchlist (N)" label (ticker) | `tickerList.length` | `labelStyle`, N = raw integer, starts at **12** | ticker view only | always ≥12 |
| Watchlist chips | `tickerList.map` | `padding 6px 12px; 14px/700; letterSpacing .04em; radius 6; transition all .15s` | Active (`t === active`) → border `DOCK_THEME.activeBorder`, bg `activeTile`, text `C.cyan`, `activeGlow`. Inactive → border `C.border`, bg `rgba(0,0,0,.4)`, text `C.text` | chips always present |
| Chip order | insertion order | — | Twelve defaults in `DEFAULT_TICKERS` order, then anything added, appended. **Never sorted, never de-duplicated after add** (add is guarded by `includes`) | n/a |
| "+ add ticker" input | `tickerInput` | `homeInputStyle` + `width:120; textTransform:uppercase`; `list="flow-ticker-suggestions"`; `autoComplete=off`; `spellCheck=false`; value force-uppercased on change | `Enter` calls `addTicker()` | placeholder `"+ add ticker"` |
| Suggestion datalist | `DEFAULT_TICKERS` | 12 `<option>` values | Only the twelve defaults are suggested — recents are not | n/a |
| "GO" button | `addTicker()` | `padding 6px 12px; 14px/800; letterSpacing .06em; radius 6; 1px C.border; bg rgba(0,0,0,.4); color C.cyan` | Disabled when `!tickerInput.trim()`: `cursor:not-allowed`, `opacity:.45` | n/a |
| "Recent ▾" button | `recentTickers.length > 0` | `padding 6px 12px; 14px/700; letterSpacing .04em; radius 6; 1px C.border; bg rgba(0,0,0,.4); color C.text` | Hidden entirely when the recents list is empty. `onBlur` closes after a **120 ms** timeout so the mousedown lands first | absent on first ever visit |
| Recent dropdown panel | `localStorage["flow-recent-tickers-v1"]` | `position:absolute; top:calc(100% + 4px); left:0; zIndex:200; minWidth:120; radius 6; 1px C.border; bg rgba(6,12,18,0.98); boxShadow 0 10px 24px rgba(0,0,0,0.6)` | Row for the active ticker gets `DOCK_THEME.activeTile` bg + `C.cyan` text; others transparent + `C.text`. Rows are `7px 12px; 14px/700`, full width, left aligned | list hydrated in a post-mount effect (SSR-safe) — empty on first render |
| Recents write rule | `pushRecentTicker` | most-recent-first, deduped, `slice(0, 7)` | Written on **every** `selectTicker()` — chip click, GO, Enter, and dropdown pick. Wrapped in try/catch; a quota failure is silent | `[]` on parse failure |

---

# Part D — Filters card: the filter grid

Container: `<div className="flow-filter-grid">`, `grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:14`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| "Side" label | static | `labelStyle` | | |
| Side buttons | `side` ∈ `all \| buy \| sell` | Three `segBtn(side === s)` — **the label is the raw state string, lowercase in the source, uppercased by CSS** → renders `ALL BUY SELL` | active-tile rule | default `all` |
| "Type" label | static | `labelStyle` | | |
| Type buttons | `optType` ∈ `all \| C \| P` | Explicit label map: `all→"All"`, `C→"Call"`, `P→"Put"`; uppercased by CSS → `ALL CALL PUT` | active-tile rule | default `all` |
| "Min Premium {value}" label | `minPremium` | `labelStyle` + inline `<span style={{color:C.cyan}}>`; value is `"Any"` when `0`, else `fmtPremium(minPremium)` | value span always `C.cyan` | default `$15.0K` |
| Min Premium slider | `<input type="range">` | `width:100%; accentColor:C.cyan`; `min=0`; `max = view==="combined" ? 5_000_000 : 1_000_000`; `step = view==="combined" ? 50_000 : 10_000`; cell spans `gridColumn: span 2` | Switching combined→ticker with `minPremium > 1_000_000` clamps to `1_000_000` via an effect | — |
| "Min Size" label | static | `labelStyle` | | |
| Min Size input | `minSize` | `fieldStyle`, `type=number`, `min=0`, `placeholder="contracts"`; renders `""` when `0`; `Number(v) \|\| 0` on change | none | placeholder `contracts` |
| "Expiry" label + 0DTE button | static + `nearestExpiry` | Label is `labelStyle` with the 0DTE button nested INSIDE the `<label>`: `segBtn(active)` + `marginLeft:8; padding:1px 8px; fontSize:10` | Active when `nearestExpiry && expiry === nearestExpiry`. `disabled` when `nearestExpiry == null` | — |
| 0DTE button title | dynamic | `"0DTE / nearest expiry: {nearestExpiry}"` or `"no expirations loaded"` | | |
| 0DTE click behaviour | handler | — | If already `expiry === nearestExpiry` → `setExpiry("all")` (toggle off, leaves DTE alone). Else → `setExpiry(nearestExpiry)`, `setDteMin(0)`, `setDteMax(null)` | no-op when `nearestExpiry == null` |
| `nearestExpiry` derivation | `expiryOptions` (ticker) or `combinedExpiryOptions` (combined) | — | `opts.find(x => x >= todayET) ?? opts[opts.length-1]`. **Compared to today ET, not to the viewed `date`** — see Appendix | `null` when the option list is empty |
| Expiry select | `expiry` | `fieldStyle`; `<option value="all">All</option>` then one option per `YYYY-MM-DD` | Options are the **distinct `expiration` values present in the merged tape**, ascending — not a chain call. So the list grows as history lands | `All` only, until the tape loads |
| "Min DTE" label + input | `dteMin` | `labelStyle`; `fieldStyle`, `type=number`, `min=0`, `placeholder="days"`; renders `""` when `0` | `dteMin > 0` is the "active" test everywhere (0 means unset) | placeholder `days` |
| "Max DTE" label + input | `dteMax` | same, but `value={dteMax ?? ""}` and `""` → `null` on change | `null` means unset; **`0` is a real value** (0DTE only) and must not be coerced away | placeholder `days` |
| "Moneyness" label + buttons | `otmOnly` | `labelStyle`; two `segBtn` — `"All"` (`!otmOnly`) and `"OTM"` (`otmOnly`) | **Default is `OTM` (true)** | default OTM |
| "Reset" button | `resetFilters()` | Cell is `flex; alignItems:flex-end`. Button `width:100%; padding 8px 6px; 14px/700; uppercase; letterSpacing .06em; 1px C.border; radius 6; bg rgba(255,255,255,0.04); C.text` | Resets `side→all`, `optType→all`, `minPremium→15_000`, `minSize→0`, `expiry→all`, `dteMin→0`, `dteMax→null`, `otmOnly→true`. **Does NOT reset** `view`, `scope`, `date`, `chartSpan`, `active`, or `tickerList` | n/a |

---

# Part E — Net Drift chart card: chrome

`<Card variant="budget" padding={0} style={{flexShrink:0, opacity: netSwitching ? 0.55 : 1, transition:"opacity .15s"}}>`

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card dimming | `netSwitching` | whole card `opacity: .55`, `transition: opacity .15s` | `netSwitching` is true only when the filter key changed AND `sessionStorage` had no warm-start bins for it | — |
| Title | static + `active` | `"Net Drift (Premium) — {active}"`, `17px/800; letterSpacing .02em`, centered, `padding 16px 20px 8px` | `{active}` painted `C.cyan` | always |
| Title loading suffix | `netSwitching` | `" · loading…"`, `marginLeft:8; 14px/700; C.muted` | shown only while `netSwitching` | absent |
| Legend row | — | `flex; gap:26; justify:center; align:center; padding 0 12px 10px; 14px/700; wrap` | | |
| "● Calls {v}" | `netSeries.lastCall` (cumulative call net at the last walked bin) | `fmtPremium` | `BULLISH` (`#22c55e`) | `$0` before data |
| "● Puts {v}" | `netSeries.lastPut` | `fmtPremium` | `BEARISH` (`C.red`) | `$0` |
| "Net {v}" | `lastCall + lastPut` | `fmtPremium` | `C.muted` — **no directional colour on the net figure** | `$0` |
| "RTH" span button | `chartSpan` | `segBtn(chartSpan === "rth")` in a `segWrapStyle` span of `width:132`. `title="Regular trading hours only (9:30–4:00 ET)"` | Hidden when `chartOnly` | default `rth` |
| "24H" span button | `chartSpan` | `segBtn(chartSpan === "24h")`. `title="Full session — includes pre-open and the overnight global session"` | Hidden when `chartOnly` | — |
| 24H axis window note | `fmtEtHm(openSec)` / `fmtEtHm(closeSec)` | `"{HH:MM}–{HH:MM} ET"` — `13px; mono; C.muted`; centered; `padding 0 20px 8px`; `margin:0` | Rendered **only** when `chartSpan === "24h" && netSeries.hasData` | absent |
| Chart host | `<div ref={chartHostRef}>` | `height:340; width:100%`; `position:relative` set imperatively | | |
| Empty message — historical | `!netSeries.hasData && !isToday` | `"No {active} flow recorded for {date}."` | `14px; C.muted`; centered; `padding 0 20px 12px` | this IS the empty state |
| Empty message — live, no match | `!hasData && isToday && status === "LIVE"` | `"No {active} flow yet for the current filters."` | same | |
| Empty message — connecting | `!hasData && isToday && status !== "LIVE"` | `"Connecting to feed…"` | same | |
| Premium Split (nested) | `view === "ticker" && !chartOnly` | Part H, rendered INSIDE this card at the bottom | not rendered in Combined view or capture mode | — |

---

# Part F — Net Drift chart: series, scales, series data

lightweight-charts v5 (`createChart`, `chart.addSeries(LineSeries, …)`). Created
**once** on mount (`useEffect(…, [])`) and never recreated.

| Item | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Chart options — layout | `createChart` | `autoSize:true`; background `ColorType.Solid` **transparent**; `textColor: C.text`; `fontFamily: "Inter, system-ui, sans-serif"` | | |
| Chart options — grid | | `vertLines` and `horzLines` both `rgba(255,255,255,.05)` | | |
| Chart options — price scales | | `rightPriceScale: {visible:true, borderColor:"rgba(255,255,255,.10)"}`; `leftPriceScale: {visible:false}` | | |
| Right scale margins | | `scaleMargins: {top: 0.08, bottom: 0.26}` | leaves the bottom quarter for the volume overlay | |
| Vol scale margins | | overlay scale id `"vol"`, `scaleMargins: {top: 0.82, bottom: 0}` | docks the histogram to the bottom ~18% | |
| Time scale | | `borderColor rgba(255,255,255,.10)`, `timeVisible:true`, `secondsVisible:false` | | |
| Axis tick formatter | `tickMarkFormatter` | ET `toLocaleTimeString("en-US", {hour:"2-digit", minute:"2-digit"})` | non-numeric time → `""` | |
| Crosshair time formatter | `localization.timeFormatter` | same ET `hh:mm` | affects only the crosshair label | |
| Price formatter | `localization.priceFormatter` | `fmtPremium` | so the price axis reads `$1.20M`, not `1200000` | |
| Calls series | `netSeries.callPts` | `LineSeries`, `lineWidth:2`, `priceLineVisible:false`, `lastValueVisible:true` | colour `BULLISH` | whitespace points past "now" |
| Puts series | `netSeries.putPts` | `LineSeries`, same options | colour `BEARISH` | whitespace past "now" |
| Volume series | `netSeries.volPts` | `HistogramSeries`, `priceScaleId:"vol"`, `priceFormat:{type:"volume"}`, `priceLineVisible:false`, `lastValueVisible:false` | Per-bar colour: `callVol >= putVol ? VOL_GREEN : VOL_RED`. **Ties paint green** | whitespace past "now" |
| Cumulative walk | `netSeries` memo | For `t` from `openSec` to `closeSec` step `60`: if a bin exists, `call += b.callNet`, `put += b.putNet`. Push `{time:t, value:call}` / `{time:t, value:put}` while `t <= nowSec + BIN_SEC`; past that push bare `{time:t}` (whitespace) | So the axis spans the whole session before the data fills it | `hasData = netBins.length > 0` |
| Volume bar value | | `cv + pv` (call size + put size in that minute), `0` when the bin is missing | | whitespace past "now" |
| RTH span bounds | `rthBoundsToday()` / `rthBoundsForYmd(date)` | `openSec` = 09:30 ET, `closeSec` = 16:00 ET of the viewed session | DST-safe via `etWallToUtcSec` | |
| 24H span bounds | `netBins` extent, clamped | Start from the RTH bounds; widen `lo` down to the earliest bin `≥ ET-day 00:00`, `hi` up to the latest bin `≤ ET-day 24:00`; then `openSec = floor(lo/60)*60`, `closeSec = ceil(hi/60)*60` | Grid-snapping is required — the walk steps by 60 from `openSec` and an unaligned start misses every bin by a constant offset. RTH always stays inside the window | falls back to plain RTH when no bins |
| Visible range | `chart.timeScale().setVisibleRange({from: openSec, to: closeSec})` | wrapped in try/catch | Deliberately **not `fitContent()`** — that trims trailing whitespace and re-scrolls, floating the data to the right | |

---

# Part G — Net Drift chart: crosshair tooltip

A hand-built `<div>` appended to the chart host, positioned in
`subscribeCrosshairMove`, content set via `innerHTML`.

| Item | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Container | imperative DOM | `position:absolute; display:none; pointerEvents:none; zIndex:20; minWidth:230; padding:0; borderRadius:12; overflow:hidden; fontSize:14; lineHeight:1.4; whiteSpace:nowrap; fontFamily:var(--font-mono)` | bg `radial-gradient(circle at 50% 0%, rgba(33,158,188,0.10) 0%, transparent 60%), rgba(10,13,20,0.96)`; `1px solid C.border`; `borderTop: 2px solid rgba(33,158,188,0.5)`; `boxShadow 0 10px 30px rgba(0,0,0,.55)`; `backdropFilter: blur(6px)` | `display:none` |
| Show condition | crosshair param | — | Hidden unless ALL of: `param.point` truthy, `time` is a number, a `NetBin` exists at that time, `!(callVol === 0 && putVol === 0)`, and the per-minute order index has **≥1 order** | `display:none` |
| Header — time | `param.time` | ET `hh:mm` `toLocaleTimeString("en-US", {hour:"2-digit", minute:"2-digit"})` | `#fff`, `17px`, weight 500 | — |
| Header — count | `orders.length` | `"OTM · {n} print"` + `"s"` unless `n === 1` | `#fff`, `14px`, mono, `letterSpacing .06em` | — |
| Header row style | | `flex; align:center; justify:space-between; padding 9px 12px; borderBottom 1px solid rgba(255,255,255,.08)` | | |
| Body container | | `padding 8px 10px; mono; 14px; flex column; gap 5` | | |
| Row — max shown | `MAX_ROWS = 8` | first 8 of the minute's orders | | |
| Row — order | index build | sorted by `premium` **descending** (biggest first) | | |
| Row — chrome | per order | `flex; align:center; gap:8; borderLeft 3px solid {col}; borderRadius 0 6px 6px 0; padding 5px 8px` | `col = isBullish ? BULLISH : BEARISH`; tint `rgba(34,197,94,0.08)` / `rgba(239,68,68,0.08)` | |
| Row — arrow | `isBullish` | `"▲"` / `"▼"`, `width:12; textAlign:center; fontWeight:700` | coloured `col` | |
| Row — side | `o.side` | `"BUY"` / `"SELL"`, `width:32; fontWeight:700` | coloured `col` — **note this is `side`, while the arrow is `bias`; a SELL PUT shows `▼`-coloured green with the word SELL** | |
| Row — contract | | `"{strike.toLocaleString()}{type} ×{size.toLocaleString()}"`, `flex:1` | `#fff` | |
| Row — premium | `o.premium` | `fmtPremium` | coloured `col` | |
| Overflow line | `orders.length > 8` | `"+{n − 8} more…"`, `#fff; mono; 14px; padding 4px 8px 0` | omitted at ≤8 | |
| Positioning | `param.point` | `left = x + 16`; if `left + tipWidth > hostWidth` then `left = x − tipWidth − 16`; clamped `≥4`. `top = max(4, y − 10)` | | |
| Order index source | `filtered` (the **active-ticker** filtered list) | bucket = `floor(o.ts / 1000 / 60) * 60`; **`isOtm` rows only** | Rebuilt whenever `netSeries` or `filtered` changes. Consequences: the tooltip respects the tape's `minPremium` slider while the bins behind the line use `CHART_MIN_PREMIUM`, and in Combined view it still lists the ACTIVE ticker's prints. See Appendix | tooltip hides when the bucket is empty |

---

# Part H — Premium Split (four cards)

`renderPremiumSplit()` — one function, two call sites (inside the chart card in
ticker view; inside its own card in combined view).

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Section label | static | `"Premium Split (Filtered Tape)"` in ticker view; `"Premium Split (Full Session — SQL)"` in combined view. `labelStyle` | The wording is load-bearing — it tells the user whether the numbers are the capped client tape or the exact SQL aggregate | always |
| Container | | `padding: "6px 20px 20px"`; grid `repeat(4, 1fr)`, `gap:10` | | |
| Card 1 label | static | `"BUY CALLS"` | `bull = true` | |
| Card 2 label | static | `"BUY PUTS"` | `bull = false` | |
| Card 3 label | static | `"SELL CALL"` — **singular, transcribe verbatim** | `bull = false` | |
| Card 4 label | static | `"SELL PUT"` — **singular** | `bull = true` (sell puts are bullish) | |
| Card values | `totals.buyCall / buyPut / sellCall / sellPut` | `fmtPremium`, `20px/800`, mono | coloured `BULLISH` when `bull`, else `BEARISH` | `$0` |
| Bias badge | `c.bull` | `"▲ BULL"` / `"▼ BEAR"`, `14px/800; letterSpacing .06em` | same colour as the value | always |
| Label chrome | | `14px/800; letterSpacing .08em; uppercase; C.muted` | | |
| Heat bar | value vs max | `max = Math.max(1, ...four values)`; `pct = Math.max(2, value/max*100)` — **floor of 2%** so a zero card still shows a sliver. Track `height:6; radius:3; bg rgba(255,255,255,0.06)`; fill `width:{pct}%; height:100%; radius:3; background:{colour}` | | 2% sliver at zero |
| Card chrome | | `1px C.border; radius 8; bg rgba(0,0,0,0.4); padding 12px 14px; flex column; gap 8` | | |

---

# Part I — Dislocation Velocity card

`<Card variant="budget" style={{flexShrink:0}}>`. Hidden when `chartOnly`.
Rendered in **both** views.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card label | static | `"Dislocation Velocity · SPX 1m"`, `12px; letterSpacing .08em; uppercase; C.muted` | | always |
| Velocity value | `dv.velocity` | `toFixed(2)`, `32px/800; lineHeight 1.1` | `> 0` → `BUY_GREEN`; `< 0` → `C.red`; `=== 0` or no `dv` → `C.muted` | `"—"` |
| z readout | `dv.z` | `"z {z.toFixed(1)}"` | `13px; mono; C.muted`, right-aligned | `"z —"` |
| clv readout | `dv.clv` | `"· clv {clv.toFixed(2)}"` | same line, same style | `"clv —"` |
| Regime line | `dv.regime` | one of `impulse-up \| impulse-down \| two-sided \| quiet`, printed verbatim, `fontWeight:700` | `quiet` or no `dv` → `C.muted`; `two-sided` → `C.cyan`; otherwise `velocity > 0 ? BUY_GREEN : C.red` | `"building bars…"` |
| DV parameters | `pushDV(st, bar, {lambda: 0.05, zThresh: 2})` | `gate` defaults to `0.5` and is **not** overridden | `hot = z >= 2`; `directional = |clv| >= 0.5`; `velocity = hot && directional ? z*clv : 0`; `regime = !hot ? "quiet" : directional ? (clv>0 ? "impulse-up" : "impulse-down") : "two-sided"` | — |
| DV maths | `lib/dislocationVelocity.ts` | `range = max(high−low, 0)`; `clv = range>0 ? 2*((close−low)/range) − 1 : 0`; EWMA `mean` (seeded to the first `range`), EWMA `var` taken against the PRIOR mean; `z = sd > 1e-9 ? (range−mean)/sd : 0` | The whole bar history is **replayed from scratch** on every render of the memo | `n=0` → `z=0`, regime `quiet` |
| Bar source | `useMinuteBars(liveSpx, 90)` | Bars built in component state from a live spot poll: minute key = `floor(Date.now()/60000)`; rollover seals the previous bar and opens a new one; same minute extends `high`/`low`/`close`. Ring-buffered to 90 | Coarse — roughly one sample per poll, so `high`/`low` are near-degenerate on a slow feed | `[]` at mount |
| `liveSpx` source | newest `o.spot` across the LIVE WS `orders` (max `ts`), falling back to `useLiveSpots(["SPX"])["SPX"]` | number | Comment records that `/proxy/quotes` returns `last=0` for the SPX index, so the fallback is normally empty and the WS spot is the real source. **On a historical date `orders` is not merged but IS still populated**, so this card keeps reading live SPX regardless of the Session date | `0` → no bars → `dv` undefined |

---

# Part J — Combined Premium Split card

Rendered only when `view === "combined"` (not gated on `chartOnly` in the
source, but `chartOnly` forces `view` reads elsewhere — see Appendix).

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Card | | `<Card variant="budget" padding={0} style={{flexShrink:0}}>` | | |
| Title | `combinedLabel` | `"Premium Split — {label}"`, `17px/800; letterSpacing .02em`, centered, `padding 16px 20px 4px`; label painted `C.cyan` | `combinedLabel = scope === "exIdx" ? "All − Indices" : "All Tickers"` | always in combined view |
| Body | `renderPremiumSplit()` | Part H, with the `(Full Session — SQL)` wording | | four `$0` cards until the split lands |

---

# Part K — Flow Tape: header bar

`<Card variant="budget" padding={0} style={{flexShrink:0}}>`; header row
`flex; align:center; justify:space-between; gap:12; padding 14px 20px;
borderBottom 1px C.border; wrap`. Hidden when `chartOnly`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Title | `view` | `"Flow Tape — {combinedLabel \| active}"`, `17px/800; letterSpacing .12em; uppercase; C.text` | | always |
| "loading…" | `historySwitching` | `14px/700; C.muted` | Rendered **only in ticker view** — the combined backfill has no equivalent indicator | absent |
| "{n} orders" | `totals.count` | `toLocaleString()` in `<strong style={{color:C.text}}>`, the word `orders` in `C.muted`, `14px` | | `0 orders` |
| "Total {v}" | `totals.prem` | `fmtPremium` bold `C.text`; label `C.muted` | | `$0` |
| "Calls {v}" | `totals.callPrem` | `fmtPremium` bold | `BULLISH` | `$0` |
| "Puts {v}" | `totals.putPrem` | `fmtPremium` bold | `BEARISH` | `$0` |
| Left cluster chrome | | `flex; gap:22; align:baseline; wrap` | | |
| Status badge — text | `isToday` | `isToday ? status : "{date} · HISTORICAL"` where `status ∈ LIVE \| RECONNECTING \| WAITING` | `14px; mono; padding 2px 10px; radius 4` | `WAITING` before the socket opens |
| Status badge — colour | `!isToday \|\| status === "LIVE"` | — | True → bg `rgba(142,202,230,0.12)`, text `C.cyan`. False → bg `rgba(239,68,68,0.12)`, text `C.red`. **A historical date always paints cyan even while the socket is down** | |
| Totals — combined source | `view === "combined" && combinedSplit` | `/proxy/flow-premsplit → split` | `count`, `prem` straight through; `callPrem = buyCall + sellCall`; `putPrem = buyPut + sellPut`; the four split values passed through | falls back to the client sum below while the request is in flight |
| Totals — client source | otherwise | summed over `tapeRows` | `prem += premium`; `type === "C"` → `callPrem` and `buyCall`/`sellCall` by `side`; else `putPrem` and `buyPut`/`sellPut`. `count = tapeRows.length` | Sums the **full filtered list**, not the 800 rendered rows |

---

# Part L — Flow Tape: column headers

Scroll wrapper: `<div style={{overflowX:"auto"}}>` → `<div style={{minWidth: view === "combined" ? 1180 : 1116}}>`.
Header row: `grid` on `GRID`/`GRID_COMBINED`, `gap:8; padding 8px 20px;
borderBottom 1px C.border; 14px/700; letterSpacing .06em; uppercase; C.muted; flexShrink:0`.

| # | Header | Width | Align | `title` tooltip |
|---|---|---|---|---|
| 0 | `Ticker` — **combined view only** | `64px` | left | — |
| 1 | `Time` | `78px` | left | — |
| 2 | `Side` | `56px` | left | — |
| 3 | `Strike` | `84px` | right | — |
| 4 | `Spot` | `72px` | right | — |
| 5 | `Type` | `46px` | center | — |
| 6 | `Size` | `74px` | right | — |
| 7 | `Cost/Ctr` | `88px` | right | `"Cost of one contract (price × 100)"` |
| 8 | `Premium` | `96px` | right | — |
| 9 | `Vol` | `74px` | right | `"Contract's traded volume TODAY (live, not at print time)"` |
| 10 | `OI` | `68px` | right | `"Contract's current open interest"` |
| 11 | `IV` | `58px` | right | `"Current implied volatility"` |
| 12 | `% OTM` | `66px` | right | `"Strike vs LIVE underlying spot. + = OTM, − = now ITM"` |
| 13 | `DTE` | `44px` | right | `"Calendar days to expiration"` |
| 14 | `Expiry` | `88px` | right | — |
| 15 | `Bias` | `74px` | center | — |

Two more rows for this part:

| Item | Rule |
|---|---|
| Column count | 15 in ticker view, 16 in combined (the `Ticker` column is prepended, not swapped in) |
| Horizontal scroll | The grid is fixed-width; the card scrolls horizontally rather than reflowing. The `minWidth` values are the sum of the track widths plus gaps |

---

# Part M — Flow Tape: rows

Row container: `grid` on the same template; `gap:8; padding 8px 20px;
borderBottom 1px C.border; fontSize 14; fontFamily var(--font-mono); alignItems center`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Ticker cell (combined) | `normTicker(o.underlying)` | raw string | `C.cyan`, weight 700 | — |
| Time | `fmtTime(o.ts)` | ET `hh:mm:ss AM/PM` | `C.muted` | — |
| Side | `o.side.toUpperCase()` | `BUY` / `SELL` | `sideColor = side === "buy" ? BULLISH : BEARISH`, weight 700 | — |
| Strike | `o.strike.toLocaleString()` | thousands separator, no decimals unless present | `C.text`, right | — |
| Spot | `fmtSpot(o.spot)` | 2 dp with separators — **the spot AT PRINT TIME, frozen** (not the live spot the `% OTM` column uses) | `C.muted`, right | `"—"` when `spot` is absent or 0 |
| Type | `o.type` | `C` / `P` | `sideColor`, weight 700, center — **the option type is coloured by BUY/SELL, not by call/put** | — |
| Size | `o.size.toLocaleString()` | + `" ×{o.fills}"` in `C.muted` at `12px` when `fills > 1` | Cell `title="{fills} fills aggregated"` when `fills > 1`, otherwise no title | — |
| Cost/Ctr | `fmtContractCost(o.price)` | `price × 100` | `C.text`, right | — |
| Premium | `fmtPremium(o.premium)` | prefixed `"▸ "` when whale | `sideColor`; `fontWeight: whale ? 900 : 700`; `fontSize: whale ? 16 : 15`. `whale = premium >= 500_000` | — |
| Vol | `lookupStat(o)?.vol` via `fmtStat` | `1.2M` / `12.3K` / `9,876` | `C.text`, right | `"—"` when the chain snapshot has no entry (pre-open, or a strike outside the snapshot) |
| OI | `lookupStat(o)?.oi` via `fmtStat` | same | `C.muted`, right | `"—"` |
| IV | `lookupStat(o)?.iv` | `{(iv*100).toFixed(1)}%` — the API returns a decimal | `C.text`, right | `"—"` when `iv == null` |
| % OTM | derived | `{otmPct.toFixed(1)}%` — **no `+` sign on positives** | `null` → `C.muted`; `>= 0` → `C.cyan`; `< 0` → `BEARISH`. weight 700 | `"—"` |
| % OTM formula | | `liveSpot > 0 && strike` → `((type === "C" ? strike − liveSpot : liveSpot − strike) / liveSpot) * 100`, else `null` | `liveSpot = spotByTicker[ticker] ?? o.spot ?? 0` — live spot first, print-time spot as fallback | |
| % OTM tooltip | | `liveSpot > 0` → `"Strike {strike} vs live spot {liveSpot.toFixed(2)} — {now ITM \| OTM}"`; else `"No live spot yet"` | "now ITM" only when `otmPct != null && otmPct < 0` | |
| DTE | `dteOf(o, date)` | `"{d}d"` | `C.muted`, right | `"—"` when null |
| Expiry | `o.expiration` | raw `YYYY-MM-DD` | `C.muted`, right | `"—"` |
| Bias | `isBullish(o.side, o.type)` | `"▲ BULL"` / `"▼ BEAR"` | `biasColor = bull ? BULLISH : BEARISH`; weight 800, `fontSize 14`, center | — |
| Whale interaction | `premium >= 500_000` | `cursor:pointer`, `role="button"`, `tabIndex={0}`, `title="Click to expand contract detail"`; `Enter`/`Space` toggle (with `preventDefault`) | Non-whale rows get `cursor:default` and **no** role/tabIndex/title — they are not focusable | — |
| Expanded row chrome | `expandedKey === identity` | `background: rgba(33,158,188,0.10)`; `outline: 1px solid rgba(33,158,188,0.4)` | | |
| Row identity | | `identity = "{ts}\|{symbol}\|{side}"` — same key the merge dedupes on | Deliberately **not** index-based: the tape re-sorts on every refresh and an index-keyed drawer would silently re-point at a different print | |
| React key | | `"{ts}-{symbol}-{i}"` (index included) | Only the React key uses `i`; the expansion key must not | |
| Empty tape — historical | `tapeRows.length === 0 && !isToday` | `"No {combinedLabel \| active} flow recorded for {date}."` | `14px; padding 24; C.muted` | this IS the empty state |
| Empty tape — live | `isToday && status === "LIVE"` | `"No {label} flow matches the current filters."` | same | |
| Empty tape — connecting | `isToday && status !== "LIVE"` | `"Connecting to feed…"` | same | |
| Overflow footer | `tapeRows.length > 800` | `"Showing newest 800 of {n} — tighten filters to narrow."` — both numbers `toLocaleString()` | `14px; padding 10px 20px; C.muted`; centered | absent at ≤800 |

---

# Part N — ContractDrawer (the expanded whale row)

Rendered directly beneath the clicked row, inside the tape.
Container: `borderBottom 1px C.border; background rgba(33,158,188,0.05); padding 12px 20px`.

| Label as shown | Source | Format & units | Threshold / colour rule | Empty or loading state |
|---|---|---|---|---|
| Header line | props | `"↳ {ticker} {strike.toLocaleString()}{type} · {expiration}"`, `14px/800; letterSpacing .1em; uppercase; C.text` | | `expiration` renders `"—"` when absent |
| Header DTE | drawer-local `dte` | `" · {n} DTE"`, `C.muted` at `opacity .6` | **Computed differently from the tape's DTE column**: `round((Date.parse(exp+"T00:00:00") − new Date(new Date().toDateString())) / 86_400_000)` — local midnight, relative to TODAY, not the session date. A historical row's drawer DTE will not match its row DTE | omitted when null |
| Header bias | `(side === "buy") === (type === "C")` | `"▲ BULL"` / `"▼ BEAR"`, `marginLeft:8` | `BULL` (`#22c55e`) / `BEAR` (`C.red`) | |
| "Today" timeframe button | `tf` | `12px/700; padding 4px 9px; radius 5; letterSpacing .04em; uppercase` | Active → `1px C.cyan`, bg `DOCK_THEME.activeTile`, text `C.cyan`. Inactive → `1px C.border`, bg `rgba(0,0,0,.4)`, text `C.text`. `title="The session this alert printed in"` | default `today` |
| "All" timeframe button | `tf` | same | **Hidden when `sameDay`** (the print's ET date equals today's) — All would redraw the identical chart. `title="Since the alert ({fillDate}) → now"` | absent on a same-day print |
| "▲ Collapse" button | `onClose` | `12px/700; padding 4px 9px; radius 5; 1px C.border; bg rgba(0,0,0,.4); C.muted`. `title="Collapse"` | | always |
| Body grid | | `grid-template-columns: 1fr 230px; gap:12; alignItems:stretch` | Collapses to `1fr` at ≤899px (`.contract-drawer-grid`) | |
| Chart well | | `position:relative; 1px C.border; radius 8; bg rgba(0,0,0,0.35); padding 8; minHeight 300; flex column` | | |
| Watermark | `/cb-edge-logo.png` | `position:absolute; top 12; left 12; height 26; width auto; opacity .18; pointerEvents:none; zIndex 2; userSelect:none`; `alt=""`, `aria-hidden` | Must not eat pan/zoom drags | |
| Chart — loading | `loading` | `"Loading contract history…"`, `12px; C.muted; opacity .6; padding 20` | | this IS the loading state |
| Chart — error | `err` | `"Contract history unavailable ({err})."` | `C.red`. `err` is the upstream message from the route's `error` field, `slice(0,160)`, or `"HTTP {status}"` | |
| Chart — no bars | `!bars.length` | `"No traded bars for this contract {this session \| since the alert}."` | `C.muted; opacity .6` | wording switches on `tf` |
| KPI: "Since Fill" value | `track.currentPct` | `fmtPct` = `"{+|}{v.toFixed(1)}%"` — **explicit `+` on positives** | `>= 0` → `BULL`, `< 0` → `BEAR`, no track → `C.muted`. Tile border becomes `rgba(34,197,94,0.4)` when `currentPct >= 0`, else `C.border` | `"—"` |
| KPI: "Since Fill" note | | `"{fmtUsd(fillPrice)} → {fmtUsd(current)}"`, + `" · latest close"` when `noPostFill` | `12px; C.muted; opacity .5; mono` | shows the fill price alone when no track |
| KPI: "Peak / Trough" | `track.peakPct` / `troughPct` | `"{peak} / {trough}"` at `14px`, separated by a `C.muted opacity .3` slash | peak `BULL`, trough `BEAR` | `"—" / "—"` |
| KPI: "Peak / Trough" note | | `"{fmtUsd(peak)} / {fmtUsd(trough)}"`; `"no bars after the alert yet"` when `noPostFill`; `"no bars since fill"` when no track | | |
| KPI: "Vol / OI" value | `stat.vol / stat.oi` | `(vol/oi).toFixed(2)` at `14px` | `C.orange`. Tile border forced to `rgba(251,133,1,0.4)` | `"—"` when either is null, **or when `oi === 0`** (the guard is `stat?.oi` truthiness) |
| KPI: "Vol / OI" note | | `"{fmtNum(vol)} vol · {fmtNum(oi)} oi"` — `fmtNum` = `toLocaleString()`, `"—"` when null/non-finite | | `"— vol · — oi"` |
| KPI: "IV · % OTM" | `stat.iv`, `liveSpot` | `"{(iv*100).toFixed(1)}%"` `·` `"{otmPct.toFixed(1)}%"`, `14px` | IV plain; OTM `>= 0` → `C.cyan`, `< 0` → `BEAR`, null → `C.muted` | `"—"` each side |
| KPI: "IV · % OTM" note | | `"{size.toLocaleString()} ct · {fmtUsd(premium)}"` + `" · now ITM"` when `otmPct < 0` | | |
| KPI tile chrome | | `1px C.border; radius 8; bg rgba(0,0,0,0.35); padding 10px 12px`. Label `12px; uppercase; letterSpacing .08em; C.muted; opacity .6`. Value `17px/800; mono; marginTop 4`. Note `12px; C.muted; opacity .5; mono; marginTop 2` | | |
| `track` derivation | `bars` at/after `order.ts − 60_000` | `peak = max(high ?? close)`, `trough = min(low ?? close)`, `current = last close in scope`; `pct(p) = ((p − fillPrice)/fillPrice)*100` | If nothing is at/after the fill, `scope = bars.slice(-1)` and `noPostFill = true` — so a last-bar-of-day alert reports the latest close rather than a peak that predates the order | `null` when no bars or `fillPrice <= 0` |
| Contract chart — series | `bars` | `LineSeries` of `close`, `lineWidth 2`, colour **`C.green`** (the light blue) | Separate chart instance from the Net Drift one; same v5 setup, `CrosshairMode.Normal`, `rightOffset: 4` | |
| Contract chart — volume | `bars[].volume` | `HistogramSeries` on the `"vol"` overlay scale, `scaleMargins {top:0.8, bottom:0}`; right scale `{top:0.08, bottom:0.26}` | Bar colour `C.orange` when `|b.time − fillTs| < 5 min`, else `rgba(142,202,230,0.45)` | `0` when `volume` absent |
| Contract chart — price lines | | Three dashed (`lineStyle: 2`, `lineWidth: 1`, `axisLabelVisible: false`) horizontal lines: fill `C.orange`, peak `BULL`, trough `BEAR` | Guides come from bar HIGHS/LOWS while the line is CLOSES, so the peak guide sitting above the line is correct | omitted when the value is not finite |
| Contract chart — markers | `createSeriesMarkers` | Fill: `belowBar` `arrowUp` on buy, `aboveBar` `arrowDown` on sell, colour `C.orange`, text `"BOUGHT \| SOLD {fmtUsd(fillPrice)}"`. Peak: `aboveBar` `arrowDown`, `BULL`, `"PEAK {v}"`. Trough: `belowBar` `arrowUp`, `BEAR`, `"TROUGH {v}"`. Sorted ascending by time | Fill bar = first bar with `time >= fillTs − 60_000`, else `bars[0]` | |
| Contract chart — axes | | `fitContent()` after data. `multiDay` = span > 24h → tick format `{month:"short", day:"numeric", hour:"numeric"}`, else `hh:mm` ET. Crosshair always `"MMM D, hh:mm"` ET. `priceFormatter: $X.XX` | The chart is **rebuilt** when `multiDay` flips (the formatter closes over it) | |
| Contract chart — dedupe | | Duplicate/unordered `time` values are dropped (`seen` set) before `setData` | Theta can emit two bars inside one interval across a session boundary; lightweight-charts throws on duplicates | |
| Data fetch | `/proxy/option-history?ticker=&expiry=&strike=&type=&start=&end=&symbol=` | `start = fillDate` (the print's own ET date); `end = tf === "today" ? fillDate : todayEt`; `symbol` is the row's own dxFeed streamer symbol | Server picks the interval from the span: `≤3d → 5m`, `≤10d → 15m`, `≤30d → 1h`, else `4h`. Primary source dxLink candles | `bars: []` on failure |

---

# Part O — Data plumbing

Not rendered values, but every one of these changes what the rendered values
say. Each is a checklist row.

| Item | Source | Behaviour | Notes |
|---|---|---|---|
| WebSocket | `wss?://{host}/ws/gex?topics=flow` | Own connection, hand-rolled in the page (not `lib/gexSocket`) | v3 rule 2 forbids this — the port must go through `src/data/hooks.ts` |
| WS gating | `useWsLifecycle()` | Connect only while `shouldConnect`; bandwidth / idle / background pause | |
| WS message filter | `msg.type === "flow"` | reads `msg.data.tape` (or `msg.tape`) as `FlowOrder[]` — the FULL capped tape, oldest-first, re-sent up to 2×/s | |
| WS coalescing | `TAPE_FLUSH_MS = 2000` | Latest frame wins; applied on a 2 s interval. **First frame after each (re)connect flushes immediately** | Losing intermediate frames is safe — each is a full snapshot |
| WS reconnect | `setTimeout(connect, 2000)` | `onclose` → `status = "RECONNECTING"` then reconnect; `onerror` → close | Unmount teardown nulls the handlers and closes, handling the CONNECTING race |
| `status` values | | `"WAITING"` initial → `"LIVE"` on open → `"RECONNECTING"` on close | Never returns to WAITING |
| Ticker history backfill | `GET /proxy/flow-history?underlying={active}&limit={n}&date={date}[&minPremium={n}]` → `{date, tape: FlowOrder[]}` | Two-stage: `limit=1000` paints immediately, `limit=20000` lands behind it and replaces. A `full` flag stops the small pull clobbering the big one if it loses the race | Server caps `limit` at 20000 and caches 4 s |
| Backfill debounce | | First run fires at `0 ms`; every later run at `400 ms` (`historyFirstRunRef`) | So dragging the premium slider does not fire one full-session query per step |
| Backfill skip | `view === "combined"` | Skipped entirely, `historySwitching` cleared | Racing it against the combined pull is what made Combined take ~a minute |
| Backfill deps | `[active, date, minPremium, view]` | | `minPremium` is pushed to SQL so the 20k cap keeps the biggest prints across the whole session |
| `historySwitching` | | Set true on entry, false on either response or either failure | Drives the header "loading…" |
| Net-drift bins | `GET /proxy/flow-netprem?underlying&bin=60&date&[side]&[type]&minPremium=1000&[expiry]&[dteMin]&[dteMax]&[otmOnly=1][&since]` → `{date, binSec, partial, bins:[{sec, callNet, putNet, callVol, putVol}]}` | Server aggregates in SQL over the whole session — not subject to the tape's 20k cap | |
| Net-drift floor | `minPremium` is hardcoded to `CHART_MIN_PREMIUM` (1000) | The chart tracks every other filter but NOT the whale sliders | `minPremium`/`minSize` are deliberately excluded from the effect deps |
| Net-drift poll | `5000 ms`, **today only** | Past sessions are static | |
| Net-drift incremental | `since = min(lastBin.sec − 2*60, nowSec − 900)` when the key is unchanged and bins exist | Merge: `[...prev.filter(b => b.sec < since), ...incoming]` | `since` must be at least as wide as the server's `NETPREM_LATE_MS` or the client discards the bins the server just re-scanned |
| Net-drift warm start | `sessionStorage["flow-netbins-v1"]` = `{key, bins}` — a **single** entry | On a key change, paint the cached bins instantly and skip `netSwitching`; otherwise set `netSwitching = true`. Written on every successful load | Keyed on the exact filter querystring so a different ticker/date never shows the wrong session |
| Net-drift skip | `view === "combined"` | No polling in Combined view | |
| Combined backfill | `GET /proxy/flow-history?limit=2000&date={date}[&minPremium]` | 400 ms debounce, then `15000 ms` poll (today only) | 2k rows is display-only; the totals come from the split endpoint |
| Combined split | `GET /proxy/flow-premsplit?date&[exIdx=1]&[side]&[type]&[minPremium]&[minSize]&[expiry]&[dteMin]&[dteMax]&[otmOnly]` → `{date, split:{count, prem, buyCall, buyPut, sellCall, sellPut}}` | 400 ms debounce, `15000 ms` poll (today only); cleared to `null` when leaving Combined | **Two server-side bugs — see Appendix** |
| Contract stats | `GET /proxy/contract-stats?groups=SPX:2026-07-24,NVDA:2026-08-15` → `{stats: {"{ROOT}\|{expiry}": {"{strike}\|{type}": {vol, oi, iv, mark}}}}` | Grouped by `(root, expiry)` over the **visible** rows only, ranked by row count, capped at `MAX_GROUPS = 16`; 200 ms kick then `20000 ms` poll | Results are **merged, never replaced** — a group scrolling off keeps its last values so scrolling back does not flash `"—"`. A failed poll leaves prior stats in place |
| Live spots | `GET /proxy/quotes?symbols=…` → `data.items[].{symbol,last}`, falling back to `GET /api/quotes-batch?symbols=…` | 200 ms kick, `15000 ms` poll; merged, never replaced; only `last > 0` entries kept | Only fetched for tickers actually on screen |
| Merge (ticker) | `merged` | `Map` keyed `"{ts}\|{symbol}\|{side}"`; history first, then live `orders` **only when `isToday`** (live wins); sorted `ts` ASC | |
| Merge (combined) | `mergedCombined` | Same key, `combinedHistory` then live `orders` when `isToday`; sorted `ts` ASC | |
| Client filter chain | `filteredAsc` / `filteredCombined` | In order: ticker match (or `exIdx` exclusion) → `side` → `type` → `otmOnly` → `premium >= minPremium` → `size >= minSize` → `expiry` → DTE window (`dteOf` vs the SESSION date; a null DTE is **rejected** whenever any DTE bound is set) | Both use `Number(o.premium \|\| 0)` and `Number(o.size \|\| 0)` |
| Sort order | | Merge is `ts` ascending; the tape reverses it → **newest first**. `filteredAsc` (ascending) feeds the chart's per-minute order index | |
| Row cap | `visibleRows = tapeRows.slice(0, 800)` | Only `visibleRows` drive `useContractStats` and `useLiveSpots` — a few calls regardless of tape size | |
| `expiryOptions` | distinct `o.expiration` over `merged` where `normTicker(underlying) === active` | ascending string sort | |
| `combinedExpiryOptions` | distinct `o.expiration` over `mergedCombined`, honouring `scope` | ascending | |
| `FlowOrder` shape (v2) | `hooks/useSpxFlow.ts` | `ts, symbol, underlying?, expiration?, strike, type("C"\|"P"), side("buy"\|"sell"), action, bucket, price, size, premium, isOtm, fills?, spot?, iv?, oi?, volume?` | `/proxy/flow-history` returns exactly this minus `fills`/`iv`/`oi`/`volume` (they come from the live WS only) |

---

# Appendix 1 — v2 behaviours that are bugs

Transcribe the logic verbatim per the porting rule, but these need a decision
before build, not after. Each one is a place where "port it exactly" and "port
it correctly" disagree.

1. **`/proxy/flow-premsplit` ignores `exIdx` entirely.**
   `parseFlowFilters()` in `server-v2/server-with-proxy.js:949` hardcodes
   `exIdx: false`, and `handleFlowPremSplit` uses the parsed object directly.
   The client sends `exIdx=1` for the "All − Indices" scope and the server drops
   it. **The tape honours the scope client-side; the Premium Split above it does
   not.**

2. **`/proxy/flow-premsplit` defaults `underlying` to `SPX`.**
   Same function, line 938. The Combined view sends no `underlying` param, so
   the split it gets back is **SPX-only** while the card header says
   "All Tickers". The four Combined split cards, and the `count` / `Total` /
   `Calls` / `Puts` figures in the tape header (which prefer the SQL split), are
   therefore SPX numbers over a market-wide tape.

3. **`.flow-tape-row` is dead CSS.** `globals.css:289–294` defines the row hover
   highlight; no element in `Flow.tsx` carries the class. The tape has no hover
   affordance today.

4. **`chartOnly` does not force `view`.** `?chartonly=1` hides the view tabs but
   leaves `view` at its default `"ticker"`. It is unreachable-but-not-impossible
   for a capture to land in Combined (the chart wrapper's `display:none`), which
   would capture an empty node.

5. **The chart tooltip and the chart line disagree on the premium floor.** The
   bins behind the line use `CHART_MIN_PREMIUM` (1 000); the per-minute order
   index the tooltip lists is built from `filtered`, which uses the tape's
   `minPremium` slider (default 15 000). Raise the slider and a minute can show
   a tall volume bar with a tooltip that lists nothing — the tooltip's own
   `orders.length === 0` guard then hides it.

6. **The tooltip is active in Combined view.** The index is built from
   `filtered` (active ticker), not `tapeRows`. The chart is `display:none` in
   Combined so this is invisible today, but it is wired that way.

7. **`nearestExpiry` compares against today, not the viewed session.** On a
   historical date the "0DTE" button selects the soonest expiry **≥ today**,
   which for a past session is a future expiry, not that session's 0DTE.

8. **The drawer's DTE and the tape's DTE use different bases.** Tape:
   `dteOf(o, date)` — UTC midnight, relative to the viewed session. Drawer:
   local-midnight arithmetic relative to today. They disagree on any historical
   row, and can disagree by a day near a timezone boundary even live.

9. **Dislocation Velocity ignores the Session date.** It reads the live WS
   `orders` array for its SPX spot regardless of `date`, so on a historical
   session the card shows today's live impulse under a historical page.

10. **`?ticker=` does not join the watchlist.** An out-of-list ticker is active
    with no chip, so there is no way back to it after clicking another chip
    (short of the Recent dropdown, which `selectTicker` does populate — but only
    once the user clicks something).

---

# Appendix 2 — v3 contract gaps

These are the reasons a naive port loses columns. Each one needs an answer in
the build step, and the answer is a row on this checklist, not a silent drop.

| v2 needs | v3 has today | Gap |
|---|---|---|
| `FlowOrder.symbol` | `FlowTapePrint` has no `symbol` (`src/contract/frames.ts:128`) | The merge dedupe key, the React key, the expansion identity and `/proxy/option-history`'s `symbol` param are all built from it |
| `FlowOrder.type: "C" \| "P"` | `FlowTapePrint.type: 'call' \| 'put' \| string` | Every colour rule, the Type column, `isBullish`, and the `dteOf`/premium-split branches compare against `"C"` |
| `FlowOrder.fills` | absent | The `×N` sweep suffix and its tooltip |
| `FlowOrder.spot` | absent | The `Spot` column and the `% OTM` fallback |
| `FlowOrder.iv / oi / volume` | absent | Not actually used by the tape (it uses `useContractStats`), but worth confirming before relying on the frame |
| Multi-ticker live tape | `src/data/symbol.tsx` states the `flow` frame is SPX prints only | The Combined view's live half, and any non-SPX ticker's live half. History still comes from `/proxy/flow-history` for any ticker |
| `useContractStats` / `useLiveSpots` | no equivalent in `src/data/` | `Vol`, `OI`, `IV`, `% OTM`, and the drawer's Vol/OI and IV tiles — 5 columns and 2 KPI tiles |
| `useWsLifecycle` | v3 socket owns its own lifecycle | Confirm the v3 socket already does bandwidth/idle/background pause before dropping the gate |
| lightweight-charts | v3 charts go through `ChartFrame` (imperative, visibility-gated, `data-cb-layer`) | Both charts — Net Drift and the drawer's contract chart. The crosshair tooltip must be re-hosted inside the `ChartFrame` element |
| `ContractDrawer` | absent | 25 rows of Part N |
| `lib/dislocationVelocity` | absent | Part I. 42 lines, no dependencies — transcribe as-is into `src/data/` |
| `ThemedDatePicker` | check `src/design/primitives/Controls.tsx` | The Session control |
| `localStorage` / `sessionStorage` caches | v3 has `src/data/cache.ts` (last-known-state) | Decide whether recents and the netbins warm start go through it or stay raw |

**The current `cbedge-v3/src/pages/Flow.tsx` (30 593 bytes) is a prior port that
resolved most of the above by dropping them** — its own header comment lists the
Net Drift canvas chart, the per-contract Vol/OI/IV poller and the dislocation
velocity indicator as "machinery [that] does not exist on this side of the
port". That is the failure this document exists to stop. Treat that file as a
draft to be finished against this checklist, not as the port.

---

# Appendix 3 — route wiring status

All four steps already exist for `/v3/flow`; none needs adding.

| Step | File | Status |
|---|---|---|
| 1 | `cbedge-v3/src/pages/Flow.tsx` | exists (partial — see Appendix 2) |
| 2 | `cbedge-v3/src/App.tsx:29,54` — `lazy()` + `<Route path="/flow">` | done |
| 3 | `cbedge-v3/src/shell/Shell.tsx:53` — `{ to: '/flow', label: 'Flow', icon: '🌊' }` | done, **no `prefetch` URLs** — v3 rule 3 (no request waterfalls, `preload()` on nav intent) wants `/proxy/flow-history` and `/proxy/flow-netprem` listed here |
| 4 | `app/v3/flow/route.ts` (480 bytes) | done |
