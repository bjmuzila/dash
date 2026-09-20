# Options Flow — `/flow`

**Route:** `<Route path="/flow" element={<Flow />} />` in `src/App.tsx`.
**Mounted by:** `const Flow = lazy(() => import('@/pages/Flow'))` — lazy like every route except the landing page, per App.tsx's rule 1: *"A route that is in the entry chunk is a route every user downloads whether they visit it or not."*
**Rail entry:** `{ to: '/flow', label: 'Flow', icon: '🌊' }` in `NAV` (`src/shell/Shell.tsx`), sitting between Replay and Scanner. **No `prefetch` array** — see "The data path → What the rail does not warm".
**Production URL:** `voltick.cbedge.net/v3/flow`. A hard refresh is served by `app/v3/flow/route.ts` in the v2 repo (step 4 of AGENTS.md's four-step "Adding a page").
**v2 original:** `/app/flow`, `components/pages/Flow.tsx`. The spec is `docs/parity/flow.md` — **214 rows, one per rendered value** — and the page header says the file *"is finished when every one of them is on screen."*

**Sources:**

| File | Lines |
|---|---|
| `src/pages/Flow.tsx` | 819 |
| `src/data/flowMath.ts` | 703 |
| `src/data/flowData.ts` | 618 |
| `src/pages/flow/ContractDrawer.tsx` | 538 |
| `src/pages/flow/NetDriftChart.tsx` | 417 |
| `src/pages/flow/FlowTape.tsx` | 273 |
| `src/contract/frames.ts` | 258 |

Supporting, read but not owned: `src/data/api.ts` (239), `src/data/hooks.ts` (75), `src/data/dislocationVelocity.ts` (64), `src/design/theme.ts` (471), `src/design/tokens.css` (716), `src/design/primitives/{Page,ChartFrame,Card,Controls,DatePicker}.tsx`, `src/shell/Shell.tsx` (739), `src/App.tsx` (249), `AGENTS.md`, `budgets.json`.

---

## What it is, in one paragraph

`/flow` is the options-flow tape and the chart that summarises it. Every print the server's flow processor coalesces into an "order" lands here: time, side, strike, spot at print, type, size, cost per contract, premium, and then three columns pulled live off the chain (volume, open interest, implied vol), a live moneyness figure, DTE, expiry and a bullish/bearish read. Above the tape sits **Net Drift (Premium)** — cumulative net call premium and cumulative net put premium, one point per minute across the whole session, with that minute's contract volume docked underneath and the underlying's own path drawn as a thin overlay behind them. Between the two sits a single-number **Dislocation Velocity** read on SPX 1-minute bars. The page has two views: **By Ticker**, driven by a watchlist of chips, and **Combined**, which puts every ticker on one tape and gets its totals out of SQL rather than by summing a capped table. A filter card (side, type, min premium, min size, expiry, DTE window, moneyness) drives both, plus a one-click `0–7DTE ≥$500K OTM` preset. Any print at or above **$500,000** premium is a "whale": it renders bold with a `▸` and clicking it expands a **contract drawer** in place, underneath the row, charting that one contract with the fill marked and since-fill peak/trough tracked. A session date picker rewinds the whole page to any past day.

---

## File map

| File | Lines | What it owns |
|---|---|---|
| `src/pages/Flow.tsx` | 819 | The page. All state (date, view, scope, watchlist, active ticker, the eight filters, chart span, the expanded row key, recents), the URL-param reads, the merge/scope/filter pipeline, the totals choice, the two presets, the Net Drift card shell with its legend, the Dislocation Velocity card, the `PremiumSplit` four-tile block, `Field` and `NumField`. |
| `src/data/flowMath.ts` | 703 | **Pure.** No React, no fetch, no DOM. Every threshold, every format, the ET session maths, `dteOf`, the filter chain, `mergeTape`, `buildNetSeries`, `buildSpotSeries`, the totals, the recents localStorage layer. |
| `src/data/flowData.ts` | 618 | **The REST side.** `useTick`, `useFlowHistory`, `useCombinedHistory`, `usePremSplit`, `useNetPremBins`, `useContractStats`, `useLiveSpots`, `useMinuteBars`. Four of the seven cannot be a plain `useQuery` and the header says why. |
| `src/pages/flow/FlowTape.tsx` | 273 | The fifteen-column print grid and its row. Pure presentation — every input arrives as a prop. Lazy-loads `ContractDrawer`. |
| `src/pages/flow/ContractDrawer.tsx` | 538 | The whale expansion: the per-contract chart (close line, volume, fill/peak/trough price lines, BOUGHT/SOLD marker), the since-fill tracking, the four KPI tiles. |
| `src/pages/flow/NetDriftChart.tsx` | 417 | The imperative lightweight-charts instance: two drift lines, the volume histogram, the hidden-scale spot overlay, and the crosshair tooltip that lists what printed in that minute. |
| `src/contract/frames.ts` | 258 | The wire contract. `FlowTapePrint`, `FlowData`, `FlowFrame` — transcribed field-for-field from `server-v2/computation/flow-processor.js`. |

### Why the tape is its own module

`FlowTape.tsx`'s header:

> Lifted out of `pages/Flow.tsx` unchanged so the board's Flow Tape card is the SAME tape rather than a second one that looks like it. Two copies of a table with this many columns, this many tooltips and a drawer hanging off every whale row is two places for a column to go wrong, and the board card is exactly where nobody would notice.

The board consumer is `src/board/catalog.tsx` → `FlowTapeCard` (`lazy(() => import('./flowTape/FlowTapeCard'))`, catalog line 34, rendered at line 302). The board's **Net Premium** card (`NetPremiumCard`, catalog line 32) is the other consumer of this page's machinery — it uses `useFlowHistory`, which is why that hook's `switching` state is seeded from `enabled` rather than `false` (see "Gotchas").

It is a CSS grid, not the `Table` primitive, and the header is explicit about why:

> It is a grid rather than the Table primitive: a row here can EXPAND into a contract drawer, and a `<tbody>` that grows a full-width panel between two rows is a colspan trick that fights every other thing Table does well.

### What is deliberately NOT v2

From the page header comment:

> * **the socket.** Live prints arrive as the `flow` frame through `useFrame`; this page opens nothing (non-negotiable 2).
> * **the charts.** Both go through `ChartFrame`, honour its visibility signal and tag their canvases (non-negotiables 4, 5, 6).
> * **the palette.** Every colour is a token. v2's `C.green` was a LIGHT BLUE and its bullish accent was a hand-typed hex beside it; here bullish is `--color-up` and that is the end of it.

And one **recorded departure** (`docs/parity/flow.md`, Appendix 1):

> the tape status badge has two states, not three — a page that does not own the socket cannot honestly report RECONNECTING.

The maths were transcribed rather than re-derived, and the header says what that bought:

> The maths, the thresholds and the wording were transcribed into `src/data/flowMath.ts` rather than re-derived here — re-deriving from a description is exactly how the previous attempt lost the chart, three columns and the whole drawer.

---

## The panels, top to bottom

`Flow()` returns `<Page title="Options Flow">` (the scrolling variant — `fill` is **not** passed, so `Page` renders `flex flex-col gap-3 p-4`). Children in order: the view row, the Filters card, `netDriftCard`, the Dislocation Velocity card, the Combined-only Premium Split card, and the tape card. There is one alternate layout: `?chartonly=1`.

### 0. `?chartonly=1` — the capture embed

```tsx
const [chartOnly] = useState(() => urlParam('chartonly') === '1')
```

When set, `Flow()` returns early:

```tsx
<Page fill>
  <div id="flow-chart-capture" className="flex min-h-0 flex-1 flex-col p-3">
    {netDriftCard}
  </div>
</Page>
```

Only the Net Drift card renders. Inside `netDriftCard`, `chartOnly` additionally suppresses the RTH/24H `SegGroup` and the `PremiumSplit`. The `id="flow-chart-capture"` is the handle a screenshot job targets. Note this is read **once, into state, at mount** — changing the query string later does not toggle it without a reload.

### 1. The view row

**`By Ticker` / `Combined`** — `SegGroup<View>` at `size="touch"` (34px minimum hit target). Default `'ticker'`. State: React only, `useState<View>('ticker')`. Nothing persists it.

Switching to Combined widens two things and narrows nothing:

| | By Ticker | Combined |
|---|---|---|
| Min Premium ceiling | `PREMIUM_MAX` = **1 000 000** | `PREMIUM_MAX_COMBINED` = **5 000 000** |
| Min Premium step | `PREMIUM_STEP` = **10 000** | `PREMIUM_STEP_COMBINED` = **50 000** |
| Tape source | `useFlowHistory(active, …)` | `useCombinedHistory(date, …)` |
| Totals source | `sumTotals(tapeRows)` over the capped tape | `totalsFromSplit(combinedSplit)` — exact SQL |
| Extra column | — | leading `Ticker` column |
| Scope control | — | `All` / `All − Indices` |

A guard clamps the slider on the way back down:

```tsx
useEffect(() => {
  if (view === 'ticker' && minPremium > PREMIUM_MAX) setMinPremium(PREMIUM_MAX)
}, [view, minPremium])
```

**The `0–7DTE ≥$500K OTM` chip** — `applyBigOtmPreset()` sets, in one click: `view='combined'`, `scope='all'`, `side='all'`, `optType='all'`, `minSize=0`, `expiry='all'`, `minPremium=500_000`, `dteMin=0`, `dteMax=7`, `otmOnly=true`. The chip lights when `bigOtmActive`, which tests only five of those: `view === 'combined' && minPremium === 500_000 && dteMin === 0 && dteMax === 7 && otmOnly`. Its tooltip: `Combined · 0–7 DTE · ≥$500K premium · OTM only`. The `$500K` floor is `WHALE_FLOOR` — *"Matches the Big-OTM preset's floor."*

**Session** — a `DatePicker`, not `<input type="date">`, and the comment in place says why:

> Not `<input type="date">`: that field is the OS's, mm/dd/yyyy and a platform calendar, and it was the one control on this page that did not look like the app. Same value contract ("YYYY-MM-DD"), so the handler below is unchanged apart from losing the event.

`max={todayYmdET()}` — no future dates. `onChange={(v) => setDate(v || todayYmdET())}` — clearing snaps back to today. Default `todayYmdET()`. When `date !== todayYmdET()`, two extra elements appear: a `Today` chip and a badge reading **`HISTORICAL`** on `bg-raised text-accent`.

`isToday = date === todayYmdET()` is the single most load-bearing derived boolean on the page. It gates: whether the live socket tape is merged at all (`mergeTape`), whether `useCombinedHistory` / `usePremSplit` poll, whether `useNetPremBins` runs an interval and whether it sends `?since=`, and which of three strings the empty states print.

### 2. The Filters card

`<Card title="Options Flow — Filters" actions={<Chip label="Reset" …/>}>`. The Reset chip's tooltip is `Side, type, premium, size, expiry, DTE and moneyness back to defaults`; `resetFilters()` sets `side='all'`, `optType='all'`, `minPremium=DEFAULT_MIN_PREMIUM`, `minSize=0`, `expiry='all'`, `dteMin=0`, `dteMax=null`, `otmOnly=true`. It does **not** touch view, scope, date, active ticker or chart span.

A one-line blurb sits above the fields and swaps with the view:

* Combined: `Every ticker on one tape. Choose the scope, then filter.`
* By Ticker: `Live order flow off the shared feed. Pick a watched ticker to drive the chart + tape.`

**Scope (Combined only)** — `SegGroup<Scope>`, `All` / `All − Indices`, default `'all'`. `'exIdx'` drops any print whose normalized root is in `INDEX_TICKERS`:

```ts
export const INDEX_TICKERS: ReadonlySet<string> = new Set(['SPX', 'NDX', 'RUT', 'XSP', 'VIX', 'DJX'])
```

**Watchlist (By Ticker only)** — `Field label={`Watchlist (${tickerList.length})`}`. `tickerList` seeds from `DEFAULT_TICKERS`:

```ts
['SPX','SPY','QQQ','META','TSLA','AMZN','AAPL','NVDA','MSFT','GOOGL','AMD','NDX']
```

Twelve chips, one lit. Beside them: a 28-unit-wide `<input list="flow-ticker-suggestions">` (uppercasing on every keystroke, `autoComplete="off"`, `spellCheck={false}`, placeholder `+ add ticker`), a `<datalist>` of the twelve defaults, a `GO` button disabled while the input is blank, and a `Recent ▾` dropdown when there is anything to show.

`selectTicker(raw)` uppercases and trims, appends to `tickerList` if new (**the list only ever grows — there is no remove**), sets `active`, clears the input and pushes onto recents.

The Recent dropdown's blur handler carries a timing note:

```tsx
onBlur={() => setTimeout(() => setRecentOpen(false), 120)}
```
> The blur is delayed so the dropdown's own mousedown lands first — without it the panel closes before the click.

The rows themselves fire on `onMouseDown`, not `onClick`, for the same reason.

**The eight filter fields** live in `grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3`:

| Field | Control | Default | Notes |
|---|---|---|---|
| Side | `SegGroup` ALL / BUY / SELL | `'all'` | |
| Type | `SegGroup` ALL / CALL / PUT | `'all'` | values `'all' \| 'C' \| 'P'` — the wire uses the two characters, never `'call'`/`'put'` |
| Min Premium | `<input type="range">`, full width, `accent-[var(--color-accent)]` | `DEFAULT_MIN_PREMIUM` = **15 000** | spans two columns at `sm`+; label shows `Any` at 0, else `fmtPremium` |
| Min Size | `NumField`, `min=0` | `0` | contracts |
| Expiry | `Select` with `All` + every expiry seen in the merged tape, sorted | `'all'` | carries the `0DTE` toggle button |
| Min DTE | `NumField` | `0` | days |
| Max DTE | `NumField` | `null` | **`0` is a real value** |
| Moneyness | `SegGroup` ALL / OTM | `'otm'` (i.e. `otmOnly = true`) | |

Two of these carry comments worth keeping:

*Max DTE*
> `0` is a real value here (0DTE only) and must not be coerced to "unset" — only an empty string means unset.

```tsx
onChange={(v) => setDteMax(v === '' ? null : Number(v))}
```

*The 0DTE button*
> Toggle off leaves the DTE bounds alone; toggle on clears them, because an expiry and a DTE window are two ways of saying the same thing and they fight.

```tsx
if (expiry === nearestExpiry) { setExpiry('all'); return }
setExpiry(nearestExpiry); setDteMin(0); setDteMax(null)
```

`nearestExpiry` is *"today's expiration if there is one, else the soonest future one"* — the first option `>= today` (ET, `en-CA` formatting) out of the active view's expiry list, falling back to the **last** option when every listed expiry is in the past. Disabled with tooltip `no expirations loaded` when the list is empty; otherwise `0DTE / nearest expiry: <ISO>`.

### 3. Net Drift (Premium) — the card shell

Title: `Net Drift (Premium) — <active>` with the ticker in `text-accent`, plus `· loading…` in `text-xs text-muted` while `netSwitching`.

The card is `flush`, and in Combined view it is **hidden, not unmounted**:

```tsx
className={view !== 'ticker' && !chartOnly ? 'hidden' : undefined}
```
> Kept MOUNTED in Combined view (hidden, not unmounted) so the once-created chart keeps its instance.

The body gets `.stale` while `netSwitching` — `opacity: 0.55; transition: opacity 120ms ease-out` from tokens.css.

**The legend row**, centred, `text-xs font-semibold`, `gap-6`: `● Calls <fmtPremium(lastCall)>` in `NET_DRIFT_CALL`; `● Puts <fmtPremium(lastPut)>` in `NET_DRIFT_PUT`; `Net <fmtPremium(lastCall + lastPut)>` in `text-muted`; `─ <active> <fmtSpot(spotSeries.last)>` in `text-muted` with the dash at `opacity-40`, drawn only when `spotSeries.last > 0`; then the RTH/24H `SegGroup` (suppressed under `chartonly`). The legend colours are v2's, not v3's — *"The legend names the lines, so it takes the lines' colours — v2's pair, not v3's directional one."*

**The span switch**: `RTH` (title `Regular trading hours only (9:30–4:00 ET)`) and `24H` (title `Full session — includes pre-open and the overnight global session`). Default `'rth'`. React state only. When `chartSpan === '24h'` **and** `netSeries.hasData`, a centred caption prints the derived window: `<fmtEtHm(openSec)>–<fmtEtHm(closeSec)> ET` — `en-GB`, 24-hour, ET.

**The height wrapper** carries the loudest warning on the page:

```tsx
{/* MUST be a flex column: NetDriftChart's root is `flex-1 min-h-0`, and
    so is the ChartFrame element lightweight-charts autoSizes to. In a
    plain block wrapper both resolve to auto height, the canvas collapses
    to a sliver and the drift lines render as a flat smear at the top of
    the card. */}
<div className="flex h-[420px] min-h-[420px] w-full flex-col">
```

**420px fixed**, both `h-` and `min-h-`.

### 4. Dislocation Velocity · SPX 1m

An untitled `Card`. Left: the label `Dislocation Velocity · SPX 1m` at `text-2xs uppercase tracking-[0.08em] text-muted`, and under it `dv.velocity.toFixed(2)` at `text-3xl font-bold leading-tight tabular` — `text-up` when positive, `text-down` when negative, `text-muted` at exactly zero or with no reading. Right, `text-xs tabular text-muted`: `z <z.toFixed(1)> · clv <clv.toFixed(2)>` and beneath it the regime word.

Regime colouring: `text-muted` for `quiet` (and for no reading at all), `text-accent` for `two-sided`, else `text-up`/`text-down` by the sign of velocity.

With no bars yet the three numbers are `—` and the regime line reads **`building bars…`**.

### 5. Premium Split

Rendered twice, from one component, with different captions:

* **By Ticker** — inside the Net Drift card, caption `(Filtered Tape)`.
* **Combined** — its own `flush` Card titled `Premium Split — <combinedLabel>`, caption `(Full Session — SQL)`.

Four tiles: `BUY CALLS`, `BUY PUTS`, `SELL CALL`, `SELL PUT` (note the singular on the two SELL labels — that is what the source says). Each carries a `▲ BULL` / `▼ BEAR` tag, the premium at `text-lg font-bold tabular`, and a horizontal bar. Grid is `grid-cols-2` rising to `lg:grid-cols-4`.

The direction is the point:
> Buy/sell × call/put, coloured and heat-barred by DIRECTIONAL BIAS — so "sell puts" reads bullish, which is the whole reason this is four tiles and not a two-way split.

Bar length: `pct = Math.max(2, (value / max) * 100)` where `max = Math.max(1, …the four values)`.
> A 2% floor so a zero tile still shows a sliver — an empty track and a missing track look the same and one of them is a bug.

### 6. The tape card

A `flush` `Card` with a hand-rolled header strip (`border-b border-line px-4 py-3`):

* `Flow Tape — <tapeLabel>` at `text-sm font-bold uppercase tracking-[0.12em] text-fg`. `tapeLabel` is `active` in By Ticker, else `combinedLabel` (`All Tickers` or `All − Indices`).
* `loading…` while `historySwitching` (By Ticker only).
* `<count> orders`, `Total <prem>`, `Calls <callPrem>` in `text-up`, `Puts <putPrem>` in `text-down` — all `tabular`.
* A right-aligned badge: `LIVE` / `WAITING` on today, or `<date> · HISTORICAL` on a past date. Colour is `bg-raised text-accent` when `!isToday || status === 'LIVE'`, and `bg-raised text-down` otherwise — i.e. **only a live-today `WAITING` turns the badge red.**

Then `<Tape …/>`.

---

## The tape, column by column

`GRID` — fifteen fixed widths, 1116px minimum:

```ts
const GRID = '78px 56px 84px 72px 46px 74px 88px 96px 74px 68px 58px 66px 44px 88px 74px'
const GRID_COMBINED = `64px ${GRID}`   // Ticker column prepended
```

`minWidth` on the inner div: **1180** in Combined, **1116** in By Ticker, inside `overflow-x-auto`.

| # | Header | Align | Source | Format | Tooltip |
|---|---|---|---|---|---|
| 0* | Ticker | left | `o.tickerNorm` | `text-accent font-semibold` | — |
| 1 | Time | left | `o.ts` | `fmtTime` → `09:31:04 AM` ET | — |
| 2 | Side | left | `o.side` | uppercased, `text-up`/`text-down` by buy/sell | — |
| 3 | Strike | right | `o.strike` | `toLocaleString()` | — |
| 4 | Spot | right | `o.spot` | `fmtSpot`, 2dp, `—` at 0/undefined | — |
| 5 | Type | center | `o.type` | `C` / `P`, side-coloured | — |
| 6 | Size | right | `o.size` | `toLocaleString()` + ` ×<fills>` at `text-2xs` when `fills > 1` | `<n> fills aggregated` |
| 7 | Cost/Ctr | right | `o.price` | `fmtContractCost` = `price × 100` | `Cost of one contract (price × 100)` |
| 8 | Premium | right | `o.premium` | `fmtPremium`; whales get `▸ ` and `text-sm font-black` | — |
| 9 | Vol | right | `stat.vol` | `fmtStat` | `Contract's traded volume TODAY (live, not at print time)` |
| 10 | OI | right | `stat.oi` | `fmtStat`, `text-muted` | `Contract's current open interest` |
| 11 | IV | right | `stat.iv` | `(iv * 100).toFixed(1) + '%'` | `Current implied volatility` |
| 12 | % OTM | right | derived | `toFixed(1) + '%'` | `Strike vs LIVE underlying spot. + = OTM, − = now ITM` |
| 13 | DTE | right | `dteOf(o.expiration, date)` | `<n>d` | `Calendar days to expiration` |
| 14 | Expiry | right | `o.expiration` | raw ISO or `—` | — |
| 15 | Bias | center | `isBullish(side, type)` | `▲ BULL` / `▼ BEAR` | — |

\* Combined view only.

**% OTM** is the one derived cell, and it uses **live** spot, not the print's:

```ts
const liveSpot = spotByTicker[o.tickerNorm] ?? o.spot ?? 0
const otmPct = liveSpot > 0 && o.strike
  ? ((o.type === 'C' ? o.strike - liveSpot : liveSpot - o.strike) / liveSpot) * 100
  : null
```

Units: percent of live spot. Positive = still OTM (`text-accent`), negative = has gone ITM since the print (`text-down`), `null` = `—` in `text-muted`. The per-row tooltip: `Strike <k> vs live spot <x.xx> — now ITM` / `— OTM`, or `No live spot yet`.

`useLiveSpots`'s docstring explains why this column needs its own fetch at all:
> A print's own `spot` is frozen at print time, so a strike that has since gone ITM would still read as OTM without this.

**Row identity and the whale gate:**

```ts
const identity = printIdentity(o)          // `${o.ts}|${o.symbol}|${o.side}`
const whale = Number(o.premium || 0) >= WHALE_FLOOR   // 500_000
```

> The EXPANSION key is the print's identity, never its index: the tape re-sorts on every refresh, and an index-keyed drawer would silently re-point at whatever print landed in that slot.

> A whale is a print big enough to be worth inspecting. Only these expand; making every row expandable would invite a chain fetch for $50K of noise.

A whale row gets `cursor-pointer`, `role="button"`, `tabIndex={0}`, an Enter/Space handler and the tooltip `Click to expand contract detail`. When open it takes `background: alpha(T.cyan, 0.1)` and `outline: 1px solid alpha(T.cyan, 0.4)` — `T.cyan` is `var(--color-accent)` = `#2f6bff`. Every row gets `hover:bg-raised`.

The React key is `` `${o.ts}-${o.symbol}-${i}` `` — index-suffixed, so it is *not* the identity key; the identity is used only for the expansion.

**The footer**, when `totalRows > cap`:

```
Showing newest 800 of 12,418 — tighten filters to narrow.
```

`cap` defaults to `MAX_TAPE_ROWS` = **800**, but is a prop, *"because the page and the board card cap at different numbers"* — the slicing itself is the caller's.

---

## The contract drawer

Lazy inside a lazy: `FlowTape.tsx` does `lazy(() => import('@/pages/flow/ContractDrawer'))`, wrapped in a `<Suspense>` whose fallback is the literal string `Loading contract detail…` on a `border-b border-line px-4 py-3 text-xs text-muted` line. So the drawer's code — which drags a second lightweight-charts mount with it — is not downloaded until the first whale row is clicked.

It renders in place, inside the tape's flow, on `alpha(T.cyan, 0.05)`:
> Clicking a whale row (premium ≥ WHALE_FLOOR) opens this directly underneath it rather than in a modal: the tape stays on screen, so the print being inspected can be compared against the ones around it.

**Header:** `↳ <TICKER> <strike><C|P> · <expiry> · <n> DTE` with the DTE at `opacity-60`, then `▲ BULL` / `▼ BEAR`.

**Timeframes** — `Today` and `All`:

* `Today` — title `The session this print landed in`. `start = end = fillDate`.
* `All` — title `Since the print (<fillDate>) → now`. `start = fillDate`, `end = todayEt`.

Default `'today'`. `All` is **not rendered at all** when `sameDay` (`fillDate === todayEt`):
> With a same-day print the two timeframes are identical, so All is not offered — it would be a button that redraws the same chart.

And there is no 30D/90D, deliberately:
> Both timeframes are anchored to the print … and both are intraday. There is deliberately no 30D/90D: history from BEFORE the order printed says nothing about how the order did, and it drags the price axis until the interesting part is a flat line.

Plus a `▲ Collapse` button, title `Collapse`.

**The since-fill tracking:**

```ts
const after = bars.filter((b) => b.time >= order.ts - 60_000)
const noPostFill = !after.length
const scope = noPostFill ? bars.slice(-1) : after
peak   = max(b.high ?? b.close)   over scope
trough = min(b.low  ?? b.close)   over scope
current = scope[scope.length - 1].close
pct(p) = ((p - fillPrice) / fillPrice) * 100        // percent
```

Note the **60-second lead-in** on the filter — the bar containing the fill counts. And the fallback:
> If nothing is at or after the fill (an order in the last bar of the day), fall back to the latest close and FLAG it, rather than reporting a peak that predates the order.

**DTE in the drawer** is recomputed locally against the print's own session, with a note about the bug it fixes:
> Measured against the PRINT's own session, so this figure agrees with the DTE column in the row above it. v2 computed the two differently — local midnight here, UTC midnight there — and they disagreed on every historical row.

**The four KPI tiles** (right rail, 230px at `lg`+, stacked above it):

| Tile | Value | Note line | Accent |
|---|---|---|---|
| `Since Fill` | `fmtPct(currentPct)` | `<fmtUsd(fillPrice)> → <fmtUsd(current)>` + ` · latest close` when `noPostFill` | border tinted `T.green` when `currentPct >= 0` |
| `Peak / Trough` | `fmtPct(peakPct)` in `text-up` `/` `fmtPct(troughPct)` in `text-down` | `<fmtUsd(peak)> / <fmtUsd(trough)>`, or `no bars after the print yet` / `no bars since fill` | — |
| `Vol / OI` | `(vol / oi).toFixed(2)` | `<vol> vol · <oi> oi` | `T.orange`, value in `text-warn` |
| `IV · % OTM` | `<iv×100>%` · `<otm>%` | `<size> ct · <fmtUsd(premium)>` + ` · now ITM` when `otmPct < 0` | — |

Tile borders take `alpha(accent, 0.4)`. `Kpi`'s prop comment: *"Tints the tile's edge. A token string, never a literal."*

**The drawer chart.** Close line (`--color-series-5` `#7fb0ff`, width 2) plus a volume histogram on its own `'vol'` scale docked at `scaleMargins { top: 0.8, bottom: 0 }`; the right price scale gets `{ top: 0.08, bottom: 0.26 }`. Volume bars near the fill (within `5 * 60_000` ms either side) are `--color-warn` `#ffd166`; the rest are `--color-series-5` at 45%. Three dashed price lines (`lineStyle: 2`, `lineWidth: 1`, `axisLabelVisible: false`): fill in `--color-warn`, peak in `--color-up`, trough in `--color-down`. Markers: `BOUGHT $x.xx` (`arrowUp`, `belowBar`) or `SOLD $x.xx` (`arrowDown`, `aboveBar`) in `--color-warn` on the fill bar; `PEAK $x.xx` (`arrowDown`, `aboveBar`, `--color-up`) and `TROUGH $x.xx` (`arrowUp`, `belowBar`, `--color-down`). It calls `fitContent()`, unlike the Net Drift chart.

Two notes on the drawing: *"The guides come from bar HIGHS/LOWS while the line is CLOSES, so a peak guide sitting above the line is correct — it is the intraday extreme, not a bug."* And *"Theta can emit two bars inside one interval across a session boundary, and lightweight-charts throws on duplicate or unordered times"* — hence the `seen` `Set` dedupe.

The axis formatter switches on `multiDay` (`last.time - first.time > 86_400_000`): `Sep 3, 2 PM` when multi-day, `02:14 PM` otherwise. Because the formatter closes over `multiDay` at creation, the whole `ChartFrame` is keyed on it:

```tsx
<ChartFrame key={multiDay ? 'multi' : 'intraday'} …/>
```
> multiDay only flips when the timeframe changes; the formatter closes over it at creation, so the chart is rebuilt when it does — otherwise the axis labels quietly go on lying.

Canvases are tagged `data-cb-layer="contract"` (non-negotiable 6).

**Drawer states, verbatim:**

| Condition | Text | Class |
|---|---|---|
| in flight | `Loading contract history…` | `text-xs text-faint` |
| threw | `Contract history unavailable (<message>).` | `text-xs text-down` |
| `bars.length === 0`, `tf==='today'` | `No traded bars for this contract this session.` | `text-xs text-faint` |
| `bars.length === 0`, `tf==='all'` | `No traded bars for this contract since the print.` | `text-xs text-faint` |

The error message is the upstream's, sliced to 160 characters:
> The route puts the upstream message in `error` on a 502 — surface it instead of a bare "HTTP 502", which says nothing about what broke.

---

## The Net Drift chart

Imperative, per non-negotiable 4. Created once inside `ChartFrame`'s `onMount`; every later update is `setData` on the library's own series. `lightweight-charts` is imported **dynamically** inside `onMount`:

> lightweight-charts is imported DYNAMICALLY. It is the single heaviest thing this route touches and the route chunk has an 80KB brotli budget; a static import would spend most of it before the page has drawn a row.

*(That 80KB figure is the comment's; the actual line in `budgets.json` today is `"route": 59100`.)*

### Series and scales

| Series | Type | Colour | Scale | Margins |
|---|---|---|---|---|
| Calls | Line, width 2, `lastValueVisible` | `--color-netdrift-call` `#3ddc8e` | `right` | `{ top: 0.04, bottom: 0.16 }` |
| Puts | Line, width 2, `lastValueVisible` | `--color-netdrift-put` `#ff6b7a` | `right` | same |
| Volume | Histogram, `priceFormat: 'volume'` | per-bar: call/put token at **55% alpha** | `'vol'` | `{ top: 0.86, bottom: 0 }` |
| Spot overlay | Line, width 1, no crosshair marker | `--color-fg` at **38%** | `'spot'` (hidden) | `{ top: 0.08, bottom: 0.20 }` |

Grid lines are `--color-line` at 35%; borders at 55%; `textColor` is `--color-muted`; background `transparent`.

Two comments pin the margins:
> Keep the two bands adjacent — every point of gap between `vol.top` and `1 - right.bottom` is vertical range the lines pay for and nothing draws in.

> Its own scale id => an OVERLAY price scale, which is not rendered — so the index level never lands on the premium axis. Thin and washed out on purpose: this is context behind the drift lines, not a fourth thing competing with them.

`localization.priceFormatter` is `fmtPremium`, so the right axis reads `$1.23M`. Both `timeScale.tickMarkFormatter` and `localization.timeFormatter` are set, and the comment says why both:
> The axis ticks. `localization.timeFormatter` below only reaches the crosshair label, so both are needed to get an ET axis.

Canvases tagged `data-cb-layer="netdrift"`:
> These canvases are the library's, but they are the ones that paint on this page's behalf, so `scripts/perf-check.mjs` has to be able to see them — an untagged canvas is measured as nothing at all.

### The axis is pinned, never fitted

```ts
chart.timeScale().setVisibleRange({ from: s.openSec, to: s.closeSec })
```
> Pin the axis to the computed window. Deliberately NOT `fitContent()`, which trims the trailing whitespace and re-scrolls — floating the day's shape to the right and re-scaling it on every poll.

Wrapped in a `try/catch`: *"an empty or single-point range throws; the next poll fixes it"*.

### Visibility gating

Per non-negotiable 5, and it is a **gate, not a throttle**:

```tsx
useEffect(() => {
  if (!visibleRef.current) { pendingRef.current = series; return }
  apply(series)
}, [series])
```

`onVisibility(v)` flushes `pendingRef` and `pendingSpotRef` on the way back in. *"A hidden card queues its latest series and applies it on the way back in, so nothing is lost and nothing is drawn into a canvas no one can see."*

### The hover tooltip

`subscribeCrosshairMove` fires on every pointer move; the handler is created once and reads refs so it never closes over a stale render.

Suppressed (`setTip(null)`) when: the pointer leaves the pane, the time is not a number, there is no `NetBin` for that minute, the bin's `callVol` and `putVol` are both 0, or `ordersByMin` has nothing for the minute.

**Positioning is imperative** — `left = x + 16`, flipped to `x - tipW - 16` when it would overflow the host, `top = y - 10`, both floored at 4px, written straight to `style`. *"The pointer moves far more often than the minute under it changes, and re-rendering a list on every mousemove to move it sixteen pixels is the kind of thing that makes a page feel heavy for no visible reason."* React state is only touched when the minute actually changes (`prev.timeSec === t ? prev : {…}`).

**Content:** a header line with the ET `HH:MM`, the minute's spot in `tabular text-xs text-muted` when `> 0`, and on the right `OTM · <n> print` / `prints`. Then up to `TIP_MAX_ROWS` = **8** rows, biggest premium first — each a `border-l-[3px]` stripe (`border-up`/`border-down`) over `alpha(bull ? T.green : T.red, 0.08)`, reading `▲ BUY  6300C ×42  $1.05M` — and, if there are more, `+<n> more…`. The 8% wash *"has no token of its own — it is this one row's tint, not a surface — so it comes through `alpha()`, which is still the token underneath."*

---

## The data path

### The socket — one frame, read not opened

```tsx
const flowFrame = useFrame<FlowFrame>('flow')
const liveTape = useMemo(() => flowFrame?.data.tape ?? [], [flowFrame])
const status: 'LIVE' | 'WAITING' = flowFrame ? 'LIVE' : 'WAITING'
```

`useFrame` re-renders on every `flow` message. The page never touches `socket.ts`; topic scoping is derived from what is subscribed (non-negotiable 2, proved by `npm run check:ws`).

`FlowFrame`:

```ts
interface FlowData {
  symbol: string
  windowMs: number
  asOf: number
  callBuyVol: number; callSellVol: number
  putBuyVol: number;  putSellVol: number
  netPremium: number
  buyPct: number
  prints: number
  tape: FlowTapePrint[]
}
```

Of these, **`/flow` reads only `tape`.** The eight scalars ride along unused on this page.

`FlowTapePrint` is transcribed from `flow-processor.js`'s `addPrint()` and carries a warning:
> The earlier version of this interface was written from a sample and got three things wrong that cost `/v3/flow` its Spot column, its sweep counter and its row identity. Do not narrow this again without reading `flow-processor.js`.

Three fields the page leans on hardest:

* **`symbol`** — the dxFeed streamer symbol (`.SPXW260731P6300`). *"Load-bearing three times over"*: two-thirds of the dedupe key, the drawer's remembered-row key, and the `?symbol=` the option-history route needs *"because reconstructing a root server-side can only guess between SPX monthlies and SPXW weeklies."*
* **`isOtm`** — ⚠ **tri-state**, `boolean | null`. `null` means the spot was unknown. `false` is a claim. `passesFilters` uses `!o.isOtm`, which correctly rejects `null` — *"An unknown moneyness is not an OTM print."* The dated incident: *"On 2026-08-14 a stuck spot wrote `is_otm=false` for the whole midday SPX session and an OTM-only filter deleted the day."*
* **`underlying`** — the display root **post-`displayUnderlying()`**, so `"SPXW"`, not `"SPX"`. Everything on the page normalizes through `normTicker`.

`ROOT_TO_TICKER` handles the suffixes — *"Streamer roots carry suffixes a chip does not (SPX streams as `SPXW`)"*:

```ts
{ SPXW: 'SPX', NDXP: 'NDX', RUTW: 'RUT', XSPW: 'XSP' }
```

### The endpoints

| URL | Hook | Cadence | Stale / cache | Failure |
|---|---|---|---|---|
| `/proxy/flow-history?underlying=&date=&minPremium=&limit=1000` | `useFlowHistory` | once per (ticker, date, floor) + every **45 000 ms** | no api.ts cache — raw `fetch` | sets `error`; keeps the tape on screen |
| `/proxy/flow-history?…&limit=20000` | `useFlowHistory` | once per (ticker, date, floor) only | raw `fetch` | sets `error` |
| `/proxy/flow-history?limit=2000&date=&minPremium=` | `useCombinedHistory` | `useQuery`, `staleMs: 4_000`, `pollMs: 15_000` **only when `isToday`** | api.ts cache | `useQuery` keeps the last good value |
| `/proxy/flow-premsplit?date=&underlying=ALL&exIdx=&minPremium=&minSize=&side=&type=&expiry=&dteMin=&dteMax=&otmOnly=` | `usePremSplit` | `useQuery`, `staleMs: 6_000`, `pollMs: 15_000` when `isToday` | api.ts cache | last good value |
| `/proxy/flow-netprem?underlying=&bin=60&date=&minPremium=1000&…&since=` | `useNetPremBins` | immediate, then **5 000 ms** while `isToday` | `sessionStorage` warm start | sets `error`; keeps bins |
| `/proxy/contract-stats?groups=<ROOT:EXP,…>` | `useContractStats` | 200 ms kick, then **20 000 ms** | none | silent; prior stats retained |
| `/proxy/quotes?symbols=…` | `useLiveSpots` | 200 ms kick, then **15 000 ms** | none | falls through to the next row |
| `/api/quotes-batch?symbols=…` | `useLiveSpots` (fallback) | on `/proxy/quotes` failure | none | silent; prior spots retained |
| `/proxy/option-history?ticker=&expiry=&strike=&type=&start=&end=&symbol=` | `ContractDrawer` | once per (contract, timeframe) | none | message surfaced in the panel |

Every call uses `credentials: 'same-origin'`.

**Past sessions are immutable.** `useCombinedHistory`'s comment: *"Past sessions are immutable — only the live edge needs advancing."* So `pollMs` is spread in conditionally, and `useNetPremBins` skips `setInterval` entirely when `!isToday`.

### What the rail does *not* warm

`/flow` has no `prefetch` in `NAV`. The neighbouring entries show what one looks like (`/replay` warms `/proxy/strike-growth/replay-meta`, `/scanner` warms `/proxy/gex-change-top`), and `/level-log`'s comment spells out the general rule this page falls under: a URL keyed on state the rail cannot know is not worth warming. Here, every one of the six entry requests carries the ticker, the date **and** the whole filter querystring, so a hover would warm a URL the click is unlikely to ask for.

There is also nothing to warm through `api.ts` for four of the seven hooks: `useFlowHistory`, `useNetPremBins`, `useContractStats` and `useLiveSpots` all use a raw `fetch`, so a warmed `api.ts` entry would never be read back — the exact failure `/economic-calendar`'s NAV comment records for its own feeds.

### `useFlowHistory` — the two-stage backfill

```
limit=1000  →  paints immediately
limit=20000 →  lands behind it and REPLACES the slice
```

Both are fired at once; a `full` flag guards the ordering.
> The `full` flag guards the ordering — if the big pull wins the race, the small one is stale and must not clobber it.

`minPremium` is pushed to SQL *"so the server's 20k cap keeps the BIGGEST prints across the whole session rather than the most recent slice."*

It is **per-ticker**, not a bare newest-N: *"with the full roster recording an unfiltered cap drops a single ticker's early prints — it looks like 'history starts at 11am', with no error."*

**The debounce does not apply to the first run:**
```ts
const kick = setTimeout(run, wasFirst ? 0 : 400)
```
> The first run fires immediately: the 400ms debounce exists for slider drags, and paying it on mount just delays first paint for nothing.

**And it polls**, at `HISTORY_POLL_MS = 45_000`, merging rather than replacing, and skipping entirely while `document.visibilityState === 'hidden'`. The reason is the best paragraph in the file:

> This used to fetch exactly once per (ticker, date, floor) and then rely entirely on the socket's `flow` frame for everything after page load. That is fine right up until the socket goes quiet — and then the tape freezes at the moment the page opened and there is NOTHING on screen that says so. A market that has genuinely stopped printing and a feed that has stopped arriving look identical, which is the worst property a live panel can have.

The refresh merge keys on `printIdentity` with **persisted winning** — *"since it is the coalesced version"*.

### `useNetPremBins` — warm start plus incremental

The cache key is the **exact filter querystring**:

```ts
qs({ underlying: active, bin: 60, date, minPremium: CHART_MIN_PREMIUM, ...filterParams(f) })
```

`sessionStorage` key: `cb-v3-flow-netbins`, shape `{ key: string, bins: NetBin[] }` — **one slot, not a map**, so only the most recent querystring is warm.

> Keyed on the querystring so a different ticker/date/filter can never show the wrong session.

Quota failures are swallowed: *"a lost warm start costs one paint, not correctness"*.

**The incremental `since`:**

```ts
const since = isToday && last
  ? Math.min(last.sec - 2 * BIN_SEC, nowSec - NET_LATE_SEC)
  : null
const merged = since != null
  ? [...prev.filter((b) => b.sec < since), ...j.bins]
  : j.bins
```

`NET_LATE_SEC = 15 * 60` = 900 s, and it mirrors the server:

> Mirrors `NETPREM_LATE_MS` in `server-v2/server-with-proxy.js`. The server re-scans that window for prints that arrived late (a replayed batch carries older EXCHANGE timestamps) and then filters its response to `sec >= since` — so this value has to be at least as wide, or the client throws away exactly the bins the server just went and fetched. Keep the two in step.

**The chart's floor is not the tape's slider:**

```ts
export const CHART_MIN_PREMIUM = 1_000
```
> The chart tracks full directional positioning (the whole hundreds-of-millions of OTM flow in a day), so it aggregates everything above a tiny noise floor no matter how high the whale slider is set. Cranking Min Premium for the tape must not flatline the chart.

Every *other* filter is tracked, so the chart still moves with the filter panel.

An `error` flag exists specifically because silence was indistinguishable from calm:
> A poll that came back wrong used to be swallowed whole: the chart kept the bins it had and drew a flat line to the horizon, which is EXACTLY what a quiet market looks like. A dead endpoint must not be indistinguishable from no prints.

*(⚠ `useNetPremBins`'s `error` is returned but `Flow.tsx` destructures only `{ bins, switching }` — see Gotchas.)*

### `usePremSplit` — the `underlying=ALL` that is not decoration

```ts
`/proxy/flow-premsplit?${qs({ date, underlying: 'ALL', exIdx: scope === 'exIdx' ? 1 : undefined, … })}`
```

> `underlying=ALL` is REQUIRED and is not decoration: server-v2's `parseFlowFilters()` defaults a missing `?underlying` to SPX, so a Combined request that omitted it silently got SPX-only totals back under an "All Tickers" heading — for the four split cards AND for the tape header's count / Total / Calls / Puts, which prefer this response. Same for `exIdx`, which the server ignored entirely until it was wired up.

### `useContractStats` — grouped, ranked, merged

Groups are `<ROOT>:<EXPIRY>` pairs, comma-joined, built from the **visible** rows only:

```ts
counts.sort((a,b) => b[1] - a[1]).slice(0, MAX_GROUPS).map(([k]) => k).sort().join(',')
```

`MAX_GROUPS = 16` — *"Mirrors `CONTRACT_STATS_MAX_GROUPS` server-side; asking for more is truncated."*

> Groups are RANKED by how many rows want each one, so the MAX_GROUPS cap drops the long tail of one-off expiries rather than an arbitrary slice.
>
> The response is MERGED, never replaced: a group that scrolls off keeps its last-known values, so scrolling back does not flash an em dash. A failed poll leaves prior stats in place for the same reason.

⚠ **The join key changes shape between request and lookup**: groups go out as `ROOT:EXPIRY` (colon) and are read back as `stats[`${root}|${expiration}`]` (pipe), then `group[`${strike}|${type}`]`. That is the server's response shape, not a bug, but it is the kind of thing that looks like one.

### `useLiveSpots` — two sources, second as fallback

`/proxy/quotes` first, `/api/quotes-batch` second. Both parse `d?.data?.items ?? []`, keeping `{ symbol → last }` where `last > 0`, and **merge** into prior state. 200 ms kick, 15 s interval.

The fallback ordering is not arbitrary, and `Flow.tsx` explains it at the point of use:
> A print's own `spot` is the SPX level on every frame, so the newest live print is the freshest source; `/proxy/quotes` returns `last=0` for the SPX index, which is why it is the fallback and not the other way round.

### `useMinuteBars` — local OHLC, deliberately isolated

```ts
export function useMinuteBars(price: number | undefined, maxBars = 90): MinuteBar[]
```

Buckets on `Math.floor(Date.now() / 60000)`. On rollover it seals the previous bar and opens a new one; within a minute it extends `high`/`low` and overwrites `close`. Capped at 90 bars (`slice(-maxBars)`).

> Deliberately isolated from any shared candle store so it can never touch the 5-minute bars. Coarse — roughly one sample per tick — which is fine for the dislocation-velocity impulse read and would not be for a chart.

### `useTick` — the slow clock

`useTick(ms = 15_000)` is exported from `flowData.ts` but **is not called by `/flow`**. Its docstring is still the clearest statement of the freshness problem here: *"a card that only re-renders on a socket frame cannot report that the socket frames stopped — its 'last print 3m ago' would freeze at 3m and stay there all afternoon."*

---

## Every derived number

### The merge

```ts
mergeTape(history, live, isToday)
```
Map keyed on `printIdentity(o)` = `` `${o.ts}|${o.symbol}|${o.side}` `` — *"Same identity `flow_prints` uses as its PRIMARY KEY."* History is written first, live **overwrites** it, and live is merged **only when `isToday`**:
> on a historical date the socket is still pushing the current session and must not bleed into it.

Result is sorted ascending by `ts`. The page then `.reverse()`s for display (newest first) but keeps `filteredAsc` — *"OLDEST first — feeds the chart's hover index."*

### The filter chain

`passesFilters(o, f, sessionYmd)`, in order (*"Order is v2's, and it matters only for cost, not for the answer"*):

1. `side !== 'all' && o.side !== side` → reject
2. `optType !== 'all' && o.type !== optType` → reject
3. `otmOnly && !o.isOtm` → reject (**rejects `null`**)
4. `Number(o.premium || 0) < minPremium` → reject
5. `Number(o.size || 0) < minSize` → reject
6. `expiry !== 'all' && o.expiration !== expiry` → reject
7. if `dteMin > 0 || dteMax != null`: `d = dteOf(o.expiration, sessionYmd)`; **`null` → reject**, `d < dteMin` → reject, `dteMax != null && d > dteMax` → reject

> a null DTE is REJECTED whenever any DTE bound is set — an undated print cannot be shown to satisfy "0 to 7 days".

The ticker/scope gate is applied by the caller *before* this, not inside it.

### DTE

```ts
dteOf(expiration, sessionYmd) = Math.round(
  (Date.parse(`${expiration}T00:00:00Z`) - Date.parse(`${sessionYmd}T00:00:00Z`)) / 86_400_000
)
```

Units: whole calendar days. **Measured against the session being viewed, not against "today"** — and the docstring names the exact failure:

> Measuring from today's midnight made every past session's 0DTE flow go negative on lookback (a 7/29 expiry viewed on 7/30 scored −1), so any active DTE filter — including the 0–7DTE ≥$500K preset, whose `dteMin` of 0 rejects anything negative — silently dropped the whole 0DTE tape for that day. It looked correct live and wrong the moment the date rolled over.
>
> Both sides parse as UTC midnight so the subtraction is a clean whole-day count with no DST/offset drift. Keep in step with `buildFlowPrintsWhere()`'s `dteMin`/`dteMax` SQL in `server-v2/server-with-proxy.js` — or the chart and the tape will disagree about what "0DTE" means for a historical date.

### ET session bounds

```ts
etWallToUtcSec(y, m, d, hh, mm):
  guess = Date.UTC(y, m-1, d, hh, mm)
  asET  = new Date(guess).toLocaleString('en-US', { timeZone: 'America/New_York' })
  asUTC = new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' })
  return floor((guess + (asUTC - asET)) / 1000)
```

> Every bound below is a WALL-CLOCK ET time converted to UTC seconds, and the conversion corrects a UTC guess against the ET offset rather than assuming one. That is what makes it survive both DST transitions without a table.

`rthBoundsForYmd(ymd)` → 9:30 and 16:00 ET as UTC seconds. `etDayBoundsForYmd(ymd)` → 00:00 and 24:00 ET, *"the hard outer clamp for the 24H axis: `flow_prints.date` is stamped with the ET day at write time, so a row on date D can carry any ts inside D — pre-open, RTH, or the Cboe global session in the evening — and nothing outside it."*

### `buildNetSeries` — the cumulative walk

`BIN_SEC = 60`. *"Fixed bins give a proportional x-axis."*

**Window:**
* RTH span → 9:30–16:00 for the session date.
* 24H span → widen `[lo, hi]` to the extent of the returned bins, **clamped to the ET calendar day**, then snapped: `openSec = floor(lo/60)*60`, `closeSec = ceil(hi/60)*60`.

> clamped to the ET calendar day so one mis-stamped ts cannot stretch the axis across a week, then SNAPPED to the bin grid — the loop steps by `BIN_SEC` from `openSec`, and an unaligned start would miss every bin by a constant offset. RTH always stays inside the window, so the familiar 9:30–4:00 shape is still there.
>
> 24H exists because SPX now trades nearly around the clock: a day whose only prints landed at 08:58 and 21:30 drew as a flat zero line on the RTH grid, which silently discarded both.

**The walk**, `t` from `openSec` to `closeSec` inclusive, step 60:

```
call += b.callNet     (cumulative, dollars)
put  += b.putNet      (cumulative, dollars)
volPts.value = b.callVol + b.putVol       (contracts)
volPts.lean  = callVol >= putVol ? 'up' : 'down'    // ties count as up
```

A bin with no data still advances the cumulative totals by 0 — the line is flat there, not broken.

**The fill horizon** is the single subtlest number on the page:

```ts
const horizon = Math.max(nowSec + BIN_SEC, lastDataSec)
// point drawn when (b || t <= horizon), else whitespace
```

> Whitespace exists for ONE reason: to hold the axis open across the part of the session that has not happened yet. It must never open a hole in the middle of a line, and `nowSec` on its own is not a safe edge for that. This is v2's recurring "gaps in the chart" bug and it has two causes, both of which put REAL bins past "now": **clock skew** (*"`nowSec` is the BROWSER's clock. A machine a few minutes behind the server turned every bin in that window into whitespace — a break in the line that opened and closed as the clock drifted, which is exactly the 'ever so often' part"*) and **the late-print re-scan** (*"The server re-stamps late prints back into their own minute (`NET_LATE_SEC`), so a poll can legitimately return a bin stamped ahead of where the client thinks the session edge is"*). So the horizon is the LATER of the clock edge and the last bin that actually carries data.

`lastCall` / `lastPut` are the final cumulative values — what the legend prints. `Net` is their **sum**, not a difference: put premium arrives already signed on the wire.

### `buildSpotSeries` — the overlay

**Pass 1** — keep bins whose `spot` is finite and `> 0` and which land inside `[openSec, closeSec]`, snapped to the minute grid.

**Pass 2** — the robust band:

```ts
med = median(values)
mad = median(|v - med| for all v)
tol = min(med * SPOT_BAND_MAX, max(mad * SPOT_MAD_K, med * SPOT_BAND_MIN))
drop any bin with |v - med| > tol
```

```ts
const SPOT_MAD_K   = 8      // half-width of the keep band, in MADs
const SPOT_BAND_MIN = 0.015 // 1.5% of the median — floor
const SPOT_BAND_MAX = 0.12  // 12% of the median — ceiling
```

> `spot` is not clean … a stuck quote has already mislabelled a whole midday SPX session once. The server's per-bin mean handles a single bad print inside a minute; it does nothing about a minute that is wholly wrong, and because the overlay is autoscaled ONE 2× outlier flattens the real intraday range into a straight line and draws the rest as square-wave spikes.
>
> MAD rather than a fixed percent because it ADAPTS — a wide-range day widens the band on its own, so a real selloff is not clipped. Clamped to [1.5%, 12%] of the median so a dead-flat session cannot collapse the band to nothing and an outlier-heavy one cannot blow it wide open.

**Pass 3** — the same grid walk as `buildNetSeries`, with the same horizon, carrying the last level forward:

> A minute with no print carries the last known level forward rather than being dropped — the level did not stop existing because nobody traded, and a held value keeps the line on the grid instead of letting the series interpolate a straight diagonal across the gap.
>
> Nothing is held BACKWARD: before the first bin that carried a spot there is whitespace, not a flat lead-in inventing an opening level.

And the reason it reads bins at all rather than the tape: *"It used to be derived from the raw tape (`/proxy/flow-history`), and that tape is capped at the newest 20k rows. On a busy ticker the cap lands mid-morning, so the overlay began at 10:50 while the drift lines — fed by the uncapped aggregate — began at 9:30: two lines on one x-axis covering different spans."*

Returns `{ pts, last }`; `last` is 0 when nothing survived either pass, which is what hides the `─ <ticker> <spot>` legend item.

### `ordersByMin` — the tooltip index

```ts
for (const o of filtered) {
  if (!o.isOtm) continue               // the tooltip lists OTM prints only
  const minSec = Math.floor(o.ts / 1000 / BIN_SEC) * BIN_SEC
  idx.get(minSec)?.push(o) ?? idx.set(minSec, [o])
}
// each bucket sorted by premium descending
```

Two known quirks, deliberately preserved:
> Built from `filtered` (the ACTIVE-TICKER list) exactly as v2 built it, which has two consequences worth knowing rather than quietly fixing: it respects the tape's Min Premium slider while the line behind it uses the fixed chart floor, and in Combined view it still lists the active ticker's prints. Both are recorded in `docs/parity/flow.md`, Appendix 1.

### Totals

```ts
totals = view === 'combined' && combinedSplit
  ? totalsFromSplit(combinedSplit)   // exact, whole filtered session, from SQL
  : sumTotals(tapeRows)              // sum of the capped tape
```

> Combined prefers the SQL split — exact, over the full filtered session — and falls back to summing the capped tape only while that request is in flight.

`sumTotals` produces `{ count, prem, callPrem, putPrem, buyCall, buyPut, sellCall, sellPut }`, all in dollars, `count` in orders. `totalsFromSplit` widens the SQL shape with `callPrem = buyCall + sellCall` and `putPrem = buyPut + sellPut`.

### Dislocation velocity

`useMinuteBars(liveSpx)` → `pushDV(state, bar, { lambda: 0.05, zThresh: 2 })`, folded from `initDV()` over every bar on every render. `gate` stays at its default **0.5**.

```
range = max(high - low, 0)
clv   = range > 0 ? 2 * ((close - low) / range) - 1 : 0      // [-1, 1]
mean  = n === 0 ? range : λ·range + (1-λ)·prevMean
dev   = range - prevMean                                     // against the PRIOR mean
var   = n === 0 ? 0 : λ·dev² + (1-λ)·prevVar
z     = sd > 1e-9 ? (range - mean) / sd : 0
directional = |clv| >= gate
hot         = z >= zThresh
velocity    = hot && directional ? z · clv : 0
regime      = !hot ? 'quiet' : directional ? (clv > 0 ? 'impulse-up' : 'impulse-down') : 'two-sided'
```

Units: `z` is standard deviations of bar range; `clv` is dimensionless in `[-1, 1]`; `velocity` is their product, so also dimensionless.

> Transcribed verbatim from v2's `lib/dislocationVelocity.ts`. Forty lines, no dependencies, and every constant load-bearing — re-deriving it from the description would have produced a different indicator with the same name.

**`liveSpx`** — the price fed into the bars — prefers the newest live print's own `spot`:

```ts
for (const o of liveTape) if (o.spot && o.ts > ts) { ts = o.ts; px = o.spot }
return px || spxSpotFallback['SPX']
```

### The formats

| Function | Rule | Example |
|---|---|---|
| `fmtPremium` | `≥1M → $x.xxM`, `≥1K → $x.xK`, else `$x` (0dp). Negatives get `-`; positives get no sign | `$1.23M`, `-$45.6K`, `$789` |
| `fmtStat` | `null`/non-finite → `—`; `≥1M → x.xM`; `≥10K → x.xK`; else `toLocaleString()` | `1.2M`, `45.6K`, `8,401` |
| `fmtContractCost` | `price × 100`, same M/K ladder, 2dp at the bottom | `$1.25K`, `$42.50` |
| `fmtStrike` / `roundStrike` | round to thousandths | `505`, `502.5` |
| `fmtSpot` | 2dp fixed, `—` at 0 or undefined | `6,301.44` |
| `fmtTime` | `en-US`, ET, 2-digit h/m/s | `09:31:04 AM` |
| `fmtEtHm` | `en-GB`, ET, 24-hour | `08:58` |
| `fmtAgo` | `<60s → Ns`; `<60m → Nm`; else `Nh Mm` | `12s`, `5m`, `1h 4m` |
| `fmtPct` | always signed, 1dp | `+12.3%`, `-4.0%` |
| `fmtUsd` | M/K ladder, 2dp at the bottom, **sign preserved through the divide** | `$1.23M`, `$7.89` |
| `fmtNum` | `toLocaleString()`, `—` for null | `8,401` |

Three carry notes worth keeping. **`fmtStat`**: *"Note the 10K threshold, not 1K: four-digit volumes stay readable in full"*, and on `null`, *"render an em dash rather than 0, which would read as a real 'no interest here'."* **`roundStrike`**: *"a 505 call arrives as `504.99999999999994`. Every real strike is a multiple of 1/1000, so rounding to thousandths is lossless and kills the artifact … prints already archived hold the original float and are never swept, so display and lookups both have to round as well."* **`fmtAgo`**: *"Coarse on purpose … a minute count is the granularity anyone actually acts on."*

`STALE_AFTER_SEC = 180` — three minutes, exported from `flowMath.ts` for the board cards. It is **not** consumed by `/flow` itself.
> Not an error — a genuinely quiet name goes minutes between prints and that is information too. It is the line past which "nothing is happening" and "nothing is arriving" stop being distinguishable by looking.

---

## Controls, defaults and where state lives

| Control | Default | Lives in |
|---|---|---|
| `?chartonly=1` | off | **query string**, read once at mount into state |
| `?ticker=<T>` | `DEFAULT_TICKERS[0]` = `SPX` | **query string**, read once at mount (uppercased) |
| `?dteMax=<n>` | `null` | **query string**, read once at mount; non-finite / empty → `null` |
| Session date | `todayYmdET()` | React state |
| View | `'ticker'` | React state |
| Scope | `'all'` | React state |
| Watchlist | `DEFAULT_TICKERS` (12) | React state — grows only |
| Active ticker | `?ticker` or `SPX` | React state |
| Recent tickers | `[]` until hydrated | **`localStorage`**, key `cb-v3-flow-recent-tickers`, shape `string[]`, capped at `RECENT_TICKERS_MAX = 7` |
| Side / Type | `'all'` / `'all'` | React state |
| Min Premium | `15_000` | React state |
| Min Size | `0` | React state |
| Expiry | `'all'` | React state |
| Min DTE / Max DTE | `0` / `null` | React state |
| Moneyness | OTM (`otmOnly = true`) | React state |
| Chart span | `'rth'` | React state |
| Expanded row | `null` | React state, keyed on `printIdentity` |
| Net-drift bins warm start | — | **`sessionStorage`**, key `cb-v3-flow-netbins`, shape `{ key, bins }` |
| Rail icon order | `NAV` order | **`localStorage`**, key `cb-v3-rail-order` (Shell's, not this page's) |

**Nothing but the three URL params and the two browser-storage keys survives a reload.** The view, the filters, the date and the chart span all reset.

The recents list is hydrated after mount, on purpose:

```tsx
// Hydrated after mount so a server render and the first client render agree.
useEffect(() => setRecentTickers(loadRecentTickers()), [])
```

`pushRecentTicker` de-dupes, puts the new ticker first, slices to 7, and swallows a quota error: *"a lost recents list is not worth an error"*.

---

## Rendering

**Everything except the two charts is DOM.** The tape is a CSS grid of `<div>`s; the Premium Split is four flex tiles with a `<div>` bar; the DV card is two text columns. Two `<canvas>` surfaces exist, both created by lightweight-charts inside a `ChartFrame`, both tagged:

* `data-cb-layer="netdrift"` — the Net Drift chart
* `data-cb-layer="contract"` — the drawer chart (only after a whale row is opened)

`ChartFrame` reports visibility three ways (`handle.visible()`, `onVisibility`, `data-visible` on the element) with a **200px `rootMargin`** — *"a card is painted just before it is scrolled into view rather than a frame after."* Both charts on this page use the `onVisibility` edge callback.

### Colour tokens used

| Token | Hex (tokens.css) | Where |
|---|---|---|
| `--color-bg` | `#0a0d10` | page canvas |
| `--color-surface` | `#0e1216` | `Card` plate, tooltip |
| `--color-surface2` | `#141a21` | Premium Split tiles, KPI tiles, inputs |
| `--color-raised` | `color-mix(in srgb, #141a21 92%, #e7ece9)` | row hover, badges, split bar track |
| `--color-line` | `#1e2630` | every border and divider |
| `--color-fg` | `#e7ece9` | primary text; spot overlay at 38% |
| `--color-muted` | `#e7ece9` | labels, axis ticks (same white today) |
| `--color-faint` | `#c0c5c3` | drawer loading/empty copy |
| `--color-up` | `#3ddc8e` | BUY, Calls total, BULL, peak guide |
| `--color-down` | `#ff6b7a` | SELL, Puts total, BEAR, trough guide, WAITING badge |
| `--color-accent` | `#2f6bff` | ticker names, `% OTM` positive, open-row wash/outline, the range slider (`accent-[var(--color-accent)]`), the `two-sided` regime |
| `--color-warn` | `#ffd166` | fill price line, fill marker, near-fill volume bars, `Vol / OI` tile |
| `--color-netdrift-call` | `#3ddc8e` | Calls line + legend; volume histogram at 55% |
| `--color-netdrift-put` | `#ff6b7a` | Puts line + legend; volume histogram at 55% |
| `--color-series-5` | `#7fb0ff` | drawer close line; away-from-fill volume at 45% |

The Net Drift pair is **pinned to v2's values and must not follow v3's semantic pair**:

> Carried across from v2 VERBATIM — `components/pages/Flow.tsx` draws them with `BUY_GREEN` (#22c55e) and `HOME_THEME.red` (#ef4444), and "the same colour as the v2 lines" is the spec (Brandon, 2026-08-31). Deliberately NOT `--color-up`/`--color-down` … The minute-volume histogram under the lines takes the same two at 55%, which is v2's `rgba(34,197,94,.55)` / `rgba(239,68,68,.55)` exactly.

Note the token values today are `#3ddc8e` / `#ff6b7a`, not the `#22c55e` / `#ef4444` the comment names — the semantic and net-drift greens were reconciled on 2026-09-10 (*"THE POSITIVE IS SETTLED (Brandon, 2026-09-10)"*), and the tokens stay separate anyway: *"Matching values is agreement today, not a merge."*

Colours reach JS three ways, never as a literal: `T.*` / `alpha()` (which emit `color-mix(in srgb, var(--color-…) N%, transparent)`) for DOM, and `tokenHex()` / `tokenHexAlpha()` (which resolve the computed value to `#rrggbb` / `#rrggbbaa`) for the chart library, which cannot take a CSS variable.

### Type scale

Everything comes off tokens.css: `--text-3xs` 9px (the `×<fills>` suffix, the 0DTE button), `--text-2xs` 10px (field labels, chips, badges, column heads), `--text-xs` 11px (tape cells, legend, notes), `--text-sm` 13px (tape header, tooltip, touch controls), `--text-lg` 18px (Premium Split values, page title), plus `text-3xl` on the DV number. `.tabular` is on every numeric cell.

### Layout constants

| Constant | Value | Where |
|---|---|---|
| Net Drift chart height | `h-[420px] min-h-[420px]` | the flex wrapper in `Flow.tsx` |
| Tape min width | 1116px / 1180px (Combined) | `FlowTape.tsx` |
| Tape column template | 15 (or 16) fixed px widths | `GRID` / `GRID_COMBINED` |
| Filter grid | `repeat(auto-fit, minmax(150px, 1fr))` | `Flow.tsx` |
| Drawer chart min height | `min-h-[300px]` | `ContractDrawer.tsx` |
| Drawer KPI rail | `lg:grid-cols-[1fr_230px]` | `ContractDrawer.tsx` |
| Tooltip min width | `min-w-[230px]` | `NetDriftChart.tsx` |
| Tooltip offset | +16px x, −10px y, `Math.max(4, …)` | `NetDriftChart.tsx` |
| Recent dropdown | `min-w-[120px]`, `top-[calc(100%+4px)]`, `z-50` | `Flow.tsx` |
| Split bar height | `h-1.5` | `Flow.tsx` |

---

## Phone behaviour

**`/flow` is not in `DESKTOP_TO_MOBILE`.** That map has exactly three entries:

```ts
{ '/board': '/m/gex', '/traders-dashboard': '/m/gex', '/em': '/m/em' }
```

and the comment above it names this page explicitly:

> ONLY routes listed here redirect a phone; everything else (Analysis, **Flow**, Replay, Scanner, Premarket) keeps rendering its desktop layout, because there is no phone build of it and a cramped real page beats a redirect to an unrelated one.

So a phone opening `/v3/flow` gets the desktop page inside the full `Shell` (rail and toolbar included — those are dropped only on `/m/*`). Practically:

* **The tape horizontally scrolls.** `overflow-x-auto` around a 1116px-minimum grid on a 390px screen — the exact failure `mobileNav.ts` cites for refusing a chain tab: *"a horizontal scroll over a table you cannot see two columns of at once, which is not the page, it is a picture of the page."*
* **The controls are already touch-sized.** Every `SegGroup` and every view-row `Chip` passes `size="touch"` (`min-h-[34px] px-3 py-1.5 text-sm`, *"where both platforms' guidelines land"*). The watchlist chips and the `Reset` action do **not**, so they stay at the board's 10px density.
* **The Net Drift chart is fixed at 420px tall** and full width, so it survives; the drawer's KPI rail collapses from the 230px side column to a stacked block (`grid-cols-1` → `lg:grid-cols-[1fr_230px]`), and the Premium Split reflows `grid-cols-2` → `lg:grid-cols-4`.
* **The 0DTE ≥$500K preset chip is the one-tap phone workflow** — the only control that sets seven pieces of state at once.

There is no `useIsPhone()` call anywhere in these files.

---

## Status and empty-state messages, verbatim

| String | Where | When |
|---|---|---|
| `LIVE` | tape header badge, `text-accent` | `isToday` and a `flow` frame has arrived |
| `WAITING` | tape header badge, `text-down` | `isToday` and no `flow` frame yet |
| `<date> · HISTORICAL` | tape header badge, `text-accent` | `!isToday` |
| `HISTORICAL` | badge beside the date picker | `!isToday` |
| `loading…` | tape header | By Ticker, `historySwitching` |
| `· loading…` | Net Drift card title | `netSwitching` |
| `No <ticker> flow recorded for <date>.` | under the Net Drift chart | `!netSeries.hasData && !isToday` |
| `No <ticker> flow yet for the current filters.` | under the Net Drift chart | `!hasData`, `isToday`, `status === 'LIVE'` |
| `Connecting to feed…` | under the Net Drift chart | `!hasData`, `isToday`, `status === 'WAITING'` |
| `No <label> flow recorded for <date>.` | in place of the tape | `totalRows === 0 && !isToday` |
| `No <label> flow matches the current filters.` | in place of the tape | `totalRows === 0`, `isToday`, `status === 'LIVE'` |
| `Connecting to feed…` | in place of the tape | `totalRows === 0`, `isToday`, `status === 'WAITING'` |
| `Showing newest <cap> of <total> — tighten filters to narrow.` | tape footer | `totalRows > cap` |
| `building bars…` | DV regime line | no `dv` reading yet |
| `Loading contract detail…` | the drawer's `Suspense` fallback | the chunk is still downloading |
| `Loading contract history…` | inside the drawer | the option-history fetch is in flight |
| `Contract history unavailable (<msg>).` | inside the drawer, `text-down` | the fetch threw |
| `No traded bars for this contract this session.` | inside the drawer | `bars.length === 0`, `tf === 'today'` |
| `No traded bars for this contract since the print.` | inside the drawer | `bars.length === 0`, `tf === 'all'` |
| `Every ticker on one tape. Choose the scope, then filter.` | filter card blurb | Combined |
| `Live order flow off the shared feed. Pick a watched ticker to drive the chart + tape.` | filter card blurb | By Ticker |
| `no expirations loaded` | 0DTE button tooltip | no expiry options |
| `<n> fills aggregated` | Size cell tooltip | `fills > 1` |
| `No live spot yet` | `% OTM` tooltip | `liveSpot === 0` |
| `Click to expand contract detail` | row tooltip | whale rows only |
| `Any` | Min Premium label | `minPremium === 0` |
| `OTM · <n> prints` | chart tooltip header | always, when the tip is up |
| `+<n> more…` | chart tooltip | `orders.length > 8` |

Note the **two different "no flow" wordings**: the chart says *"…flow yet for the current filters"*, the tape *"…flow matches the current filters."* That is what the source says in each place.

---

## Performance and bundle notes

**Chunking.** `vite.config.ts` keeps manual chunking minimal: React gets its own chunk, everything else code-splits by route via `lazy()`. *"Do NOT add vendor grouping 'for tidiness' — a shared vendor chunk means one dependency change invalidates the cache for all of them."*

**This route's chunks:**

1. `Flow-*.js` — `Flow.tsx` + `FlowTape.tsx` + `flowMath.ts` + `flowData.ts`, measured against `"route": 59100` brotli bytes.
2. `ContractDrawer-*.js` — split out by `lazy()` inside `FlowTape.tsx`, downloaded only on the first whale click.
3. `lightweight-charts` — dynamically imported inside **both** `onMount`s, so it is a third chunk shared with every other charting route rather than route weight.

`budgets.json` lines that apply:

```json
"entry": 38900,
"react": 55000,
"route": 59100,
"css": 8500,
"html": 2600,
"totalInitial": 108400
```

The budget file's own framing: *"These are set close to current reality on purpose — a budget with 4x headroom enforces nothing."* And the ratchet block:

```json
"ratchet": { "slack": 0.15, "enforce": false }
```

`npm run build` fails on an over-budget chunk; `npm run build:fast` (what the Dockerfile runs) does not — *"Budgets are meant to fail a commit, not a deploy."*

**Per-frame machinery.** The page has no `requestAnimationFrame` loop of its own. Repaint pressure is three things: the Net Drift chart, gated by `onVisibility` (pushes queued, not throttled, while hidden); the drawer chart, same gate and not mounted at all until a whale is clicked; and the crosshair tooltip, positioned by direct `style.left`/`style.top` writes and re-rendered only on a minute change.

`budgets.json`'s perf limits, which `scripts/perf-check.mjs` enforces against `data-cb-layer` canvases:

```json
"idleRepaintsPerFrame": 0.15,
"offscreenRepaints": 0,
"interactionRepaints": 10
```

> `offscreenRepaints` is a hard zero: a card scrolled out of view must not paint at all. `interactionRepaints` is the other half of the guard — a gate that suppressed everything would pass every other line here.

⚠ **`/flow` is a route, not a board card**, so it carries no `data-card-id` and the per-card attribution in `perf-check.mjs` does not see it directly. What it *does* see is the board's `FlowTapeCard` and `NetPremiumCard`, which run the same code.

**Render cost.** The heaviest React work is the memo chain: `mergeTape` (a Map over up to ~20 000 history rows plus the live tape, then a sort) re-runs whenever `history`, `liveTape` or `isToday` changes — and `liveTape` changes on **every socket `flow` frame**. `filteredAsc`, `filtered` and `visibleRows` hang off it. The 800-row cap bounds the DOM; the merge and filter passes are not capped.

**Network cost, steady state, By Ticker on today:** one `/proxy/flow-netprem` every 5 s, one `/proxy/flow-history?limit=1000` every 45 s (suppressed when hidden), one `/proxy/contract-stats` every 20 s, one `/proxy/quotes` every 15 s plus a second `/proxy/quotes` for the SPX fallback — the page calls `useLiveSpots(['SPX'])` separately from `useLiveSpots(visibleTickers)`, so **two independent 15-second polls** run whenever SPX is not already on screen.

---

## Gotchas

1. **`useNetPremBins` returns an `error` flag that `/flow` throws away.** The hook exists in its current shape because *"A dead endpoint must not be indistinguishable from no prints"* — but `Flow.tsx` destructures `const { bins: netBins, switching: netSwitching } = useNetPremBins(…)`. Same for `useFlowHistory`, whose `error` is also documented (*"so a caller can say 'the feed is down' instead of drawing a flat line"*) and also dropped. A dead `/proxy/flow-netprem` on this page still draws a flat line and says nothing.

2. **`?chartonly`, `?ticker` and `?dteMax` are read once, at mount, into state.** They are not two-way bound. Changing the URL without a reload does nothing, and changing the ticker in the UI does not update the URL — so unlike `/level-log`, `/scanner`, `/economic-calendar` and `/feedback`, **`/flow` is not a shareable-state route** beyond the initial preset.

3. **The chart's premium floor and the tape's are different numbers on purpose.** `CHART_MIN_PREMIUM = 1_000` vs a slider defaulting to `15_000` and reaching `5_000_000`. Crank the slider and the tape empties while the chart is unchanged. That is the design; the tooltip, however, is built from `filtered` and therefore *does* follow the slider — the chart line and its own tooltip can disagree about what exists in a minute.

4. **The tooltip lists the active ticker's prints even in Combined view.** `ordersByMin` is built from `filtered`, not `filteredCombined`. Recorded in `docs/parity/flow.md` Appendix 1, deliberately not fixed.

5. **`isOtm` is tri-state.** Never write `o.isOtm === false` to mean "ITM". `null` means unknown. The 2026-08-14 stuck-spot incident is why the filter is spelled `!o.isOtm`.

6. **`dteOf` measures against the session date, not today.** Any new consumer that reaches for `Date.now()` here reintroduces the bug where a past session's 0DTE tape silently vanished under the preset.

7. **`0` is a real Max DTE.** Only `''` means unset. `Number(v) || 0` anywhere near `dteMax` would break 0DTE-only filtering — which is exactly why `minSize` and `dteMin` use that idiom and `dteMax` does not.

8. **The Net Drift card is `hidden`, not unmounted, in Combined view.** Its chart instance, its socket-driven re-renders and its polls all keep running. `useNetPremBins` is passed `enabled = view === 'ticker'`, so the *fetches* stop — but the mounted chart and the 420px reserved box do not go away.

9. **The 420px wrapper must stay a flex column.** A plain block wrapper collapses the canvas to a sliver and the drift lines render *"as a flat smear at the top of the card."*

10. **Never call `fitContent()` on the Net Drift chart.** The visible range is pinned to `[openSec, closeSec]` precisely so the day's shape does not float right and re-scale on every 5-second poll.

11. **`NET_LATE_SEC` and the server's `NETPREM_LATE_MS` must move together.** A narrower client window throws away exactly the late bins the server just went and fetched.

12. **`underlying=ALL` on `/proxy/flow-premsplit` is load-bearing.** Omit it and the server silently returns SPX-only totals under an "All Tickers" heading.

13. **The watchlist only grows.** There is no remove control, and `tickerList` is not persisted — so a stray typo is stuck for the session and gone after a reload, while the same typo *does* persist in `cb-v3-flow-recent-tickers`.

14. **`cb-v3-flow-netbins` is a single slot.** Switching ticker, date or any filter overwrites the one cached payload, so only the most recent querystring gets a warm start.

15. **`useContractStats` sends `ROOT:EXPIRY` and reads back `ROOT|EXPIRY`.** Colon out, pipe in. That mismatch is the server's response shape.

16. **Two independent SPX spot polls.** `useLiveSpots(visibleTickers)` and `useLiveSpots(['SPX'])` are separate hook instances with separate 15-second intervals and separate state. Neither shares the other's cache — they bypass `api.ts` entirely.

17. **The status badge has two states, not three.** No `RECONNECTING` — *"a page that does not own the socket cannot honestly report RECONNECTING."*

18. **`status` only ever becomes `LIVE`, never returns to `WAITING`.** `flowFrame` is whatever the store last held for `'flow'`; once a frame has landed it stays. A socket that dies mid-session leaves the badge reading `LIVE` — which is precisely why `useFlowHistory` grew its 45-second poll.

19. **The Reset chip does not reset the view, scope, date, ticker or chart span.** Only the eight filter fields.

20. **`PremiumSplit`'s two SELL labels are singular** (`SELL CALL`, `SELL PUT`) while the BUY pair is plural (`BUY CALLS`, `BUY PUTS`). Carried from v2.

21. **`useTick` and `STALE_AFTER_SEC` are exported here but unused by `/flow`.** They exist for the board cards that share this module. Do not assume this page reports staleness — it does not.

