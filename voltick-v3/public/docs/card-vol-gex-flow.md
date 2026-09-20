# `vol-gex-flow` — **Net Vol GEX Flow (Today)** · 🌀 · default grid `w 24 × h 56` · `src/board/volGexFlow/`

| | |
|---|---|
| **Catalog id** | `vol-gex-flow` (`src/board/catalog.tsx`) |
| **Label** | `Net Vol GEX Flow (Today)` |
| **Icon** | 🌀 |
| **Default size** | `{ w: 24, h: 56 }` — half the board (`BOARD_COLS` 48) and 56 rows of `BOARD_ROW_H` 8px |
| **Source folder** | `src/board/volGexFlow/` |
| **Loaded** | `lazy()` in the catalog, `<Deferred>` fallback is a blank `<div className="min-h-0 flex-1" />` |
| **Also mounted at** | `/v3/scanner?tab=gexlevels` — the *same component*, not a copy |
| **Ticker** | none, and none coming. SPX/`$SPX` always. |

The catalog's own entry says why the size is what it is:

> 24 x 56 is the panel's own shape: the scanner gives it a fixed 460px box and half the board width is what the header row (picker, two segmented switches, the bucket note, the stamp and refresh) needs before it wraps.

and why there is no ticker:

> No ticker of its own and none coming. `/proxy/gex-vol-flow` is what the strike-GEX recorder writes and that recorder runs on the index, so this card is SPX whatever the board symbol says.

---

## What it is, in one paragraph

Every 30 seconds, a server-side recorder writes down the whole SPX option chain's **volume-only** gamma exposure — the net dollar gamma implied by *today's traded contracts*, ignoring open interest entirely. This card charts that number across the session as a single baseline series: green above zero (today's flow is adding long gamma, which dampens the tape) and red below it (adding short gamma, which amplifies). A second view on the same data swaps the dollar series for **+GEX %** — the share of the chain's total |net GEX| that is positive — split at 50% instead of at zero, with `LONG GAMMA` and `SHORT GAMMA` labelled in the corners. Six tiles above the chart carry the current value, the change over the last bucket, the session high and low with their times, a count of sign flips (regime changes), and the spot with the strike count. An expiry picker narrows the recording to the front expiry, all expiries, or one named date; a session switch cuts to regular hours or the whole ET day. It is a transcription of v2's `VolGexFlowPanel.tsx` (card 12 of the scanner's GEX Levels tab), deliberately faithful **including two of v2's bugs**.

---

## File map

| File | Lines | What it owns |
|---|---:|---|
| `src/board/volGexFlow/VolGexFlowCard.tsx` | 474 | The panel. `usePoll`, the six-tile block, the `lightweight-charts` mount inside `ChartFrame`, the three controls, the two failure-mode side effects, the scrim. `VolGexFlowCard` is a three-line alias for `VolGexFlowPanel`. |
| `src/pages/scanner/gexLevels.ts` | 2632 | Shared **types, maths, copy, colour and persistence**. Everything named `VOL_FLOW_*` / `volFlow*` / `pctPointsOf` / `pctAutoscaleRange` / `etTimeFromSec` / `fmtGexAxis` / `fmtPctAxis` / `readPctView` / `writePctView` lives here. Side-effect-free consts and pure functions, so Rollup tree-shakes the other eleven cards' worth. |
| `src/pages/scanner/gexLevelsData.ts` | 1078 | The **URL builder and the loader** — `EP_GEX_VOL_FLOW`, `volGexFlowUrl()`, `loadVolGexFlow()`, `VolFlowLoad`. Owns "exactly one thing: the URLs, and what comes back off them." |
| `src/data/api.ts` | 239 | `query()` — dedupe by URL, in-memory cache with a stale window, and the `refreshAll()` broadcast. |
| `src/design/primitives/ChartFrame.tsx` | 211 | The visibility-gated container this chart mounts into. |
| `src/board/chart-render.ts` | 301 | **Not used by this card.** The repo's minimal hand-rolled canvas renderer (`useCanvasRenderer`, `drawCandles`, `drawDivergingBars`, `drawLines`). This card uses `lightweight-charts` instead — see "Why `chart-render.ts` is not in the picture". |
| `src/design/tokens.css` | 716 | Every colour, including the `--color-v2-*` leg the scanner runs on. |

> Line counts are `wc -l` against the tree at `voltick-v3/`.

### One component, two surfaces

From the card's header comment:

> THE SAME COMPONENT, not a second implementation. `/v3/scanner?tab=gexlevels` mounts `<VolGexFlowPanel />` from this file and so does the home board; there is one picker, one session switch, one $/% toggle, one fetch, one poll and one canvas, and the two surfaces cannot drift.

and why it lives in `board/` rather than in the scanner route:

> It moved HERE rather than the card importing the scanner tab because that import would pull the whole gexlevels route — eleven other charts, its layout store, its history table — into the board's chunk for one panel (non-negotiable 7). It still reaches into `pages/scanner/gexLevels(.Data)` for the maths, the copy and the loader: both are side-effect-free modules of exported consts and pure functions, so Rollup drops the eleven cards' worth this panel does not name. **Watch the board's number on the next `npm run build` all the same — a budget is the only thing that proves that sentence.**

### Why `chart-render.ts` is not in the picture

`src/board/chart-render.ts` is the repo's *other* charting path: a `useCanvasRenderer()` hook that creates a plain `<canvas>` tagged `data-cb-layer="canvas"`, plus three pure draw functions. Its header explains the reasoning for its existence ("No chart library: v3 has none installed… picking one blind is a worse risk than forty lines of canvas 2D") and its visibility contract:

> This is an on-demand renderer: it paints when told to, and a live topic tells it to several times a second, forever, whether or not the card is on screen. On a scrolling board most cards are not. So a draw requested while hidden is not performed — it is remembered, and performed once on the way back into view.
>
> **PASS `onVisibility` TO `<ChartFrame>`.** Without it this hook never learns it is hidden and paints exactly as it used to — no error, no warning, just an offscreen card spending frame budget.

This card imports none of it. It uses `lightweight-charts` (`createChart`, `BaselineSeries`, `ColorType`), and hand-rolls the same visibility discipline itself (`visibleRef` + `pendingRef` + `onVisibility`). The structural parallel is exact and deliberate; the code is not shared.

---

## The data path

### The one request

```
GET /proxy/gex-vol-flow?bin=30&session={rth|eth}&{scope=all | scope=front | expiry=<ISO>}
```

Built by `volGexFlowUrl(pick, session)` in `gexLevelsData.ts`. Param order is v2's: `bin`, `session`, then **exactly one** scope clause.

| Param | Value | Notes |
|---|---|---|
| `bin` | always `30` (`BIN_SEC`) | "the floor the endpoint enforces AND the recorder's write cadence, so every bucket holds exactly one row" |
| `session` | `rth` or `eth` | from the session switch |
| scope | `scope=front` \| `scope=all` \| `expiry=<encoded ISO>` | from the picker. The two sentinels are `__front__` / `__all__` and "can never collide with a real pick because neither parses as a date" |
| `symbol` | **deliberately not sent** | the route reads it and defaults to `$SPX` (`server-with-proxy.js:1177`) because `option_strike_gex_history` is multi-symbol; v2 never sends it. "Adding it would be a new decision about which underlying card 12 charts, and card 12 is shared with /home." |

### Cadence and windows

| Property | Value | Source |
|---|---|---|
| Poll | `VOL_FLOW_POLL_MS = 15_000` | "Half the bucket width, so a new bucket is on screen within one poll." |
| Stale window | `NO_STORE_STALE_MS = 10_000` | The remount-dedupe window. |
| Hidden-tab behaviour | tick **skipped** while hidden, one fires immediately on the way back | the local `usePoll` hook |
| Dedupe | by URL, inside `query()` | the scanner's entry loader fires this alongside its own five and both readers share one promise |

`usePoll` is a **local copy** of the scanner tab's hook, not an import:

> A local copy of the scanner tab's hook rather than an import from it: this module must not reach into that route (see the chunking note above), and the hook is twenty lines of `setInterval` with no state of its own to share.

The 10s stale window has its own dated history in `gexLevelsData.ts`:

> This was `0` until **2026-09-03**, on the reasoning that v2 sent `{ cache: "no-store" }` and `staleMs: 0` is the `query()` equivalent. **That reasoning was WRONG**, and a network trace of `/v3/scanner` proved it: every feed on the page fired TWICE on one load.
>
> The two are not equivalent. `no-store` is an HTTP-cache directive on a fetch v2 made ONCE PER MOUNT and then held in component state — v2 never asked twice because it never re-ran the fetch. `staleMs: 0` disables `query()`'s in-memory reuse, so every remount, every StrictMode double-invoke and every rail `preload()` that lands before the component mounts costs a SECOND full round trip.
>
> 10s is chosen against the poll cadence, not plucked… the poll itself still bypasses this (`useQuery`'s tick passes `staleMs: 0` deliberately: the point of a poll is to go and ask again), and so does the ↻ button.

Note this card does **not** go through `useQuery`. It calls `loadVolGexFlow()` → `query()` directly and drives its own poll, so the global `refreshAll()` broadcast does not reach it — but the URL-keyed cache still does, so a `refreshAll()` that empties the cache makes this card's next tick a real round trip.

Also recorded in `gexLevelsData.ts`: **there is no `AbortController` anywhere** in either v2 file or here. `query()` "makes the race unwinnable a different way, by ADDRESSING STALENESS WITH THE URL. Two loads of the SAME url share one promise and cannot resolve out of order. Two loads of DIFFERENT urls — a session or expiry switch on card 12 — still can, exactly as in v2."

### Response shape, exactly as parsed

```ts
interface VolFlowResponse {
  ok?: boolean
  reason?: string          // 'no-db' gets its own sentence; every other value collapses
  scope?: string           // echoed, not read
  session?: string         // echoed, not read
  expiry?: string | null   // → resolvedExpiry, labels the "Front · Jul 31" option
  binSec?: number          // echoed, not read
  expiries?: ExpiryInfo[]  // → the picker's rows, in SERVER order
  points?: VolFlowPoint[]  // → the series
}

interface ExpiryInfo { expiry: string; rows: number; lastTs: number }

interface VolFlowPoint {
  ts: number               // EPOCH MILLISECONDS on the wire
  spot: number
  volGex: number           // the $ series
  oiGex: number            // on the wire, READ BY NOTHING
  combined: number         // on the wire, READ BY NOTHING
  dVol: number | null      // the Δ Last Bucket tile
  strikes: number
  posGex?: number          // on the wire, READ BY NOTHING
  absGex?: number          // on the wire, READ BY NOTHING
  posPct?: number | null   // 0–100; null on a bucket with no rows
}
```

The dead fields are kept on the type on purpose:

> `oiGex`, `combined`, `posGex` and `absGex` are on the wire and are read by nothing — only `ts`, `spot`, `volGex`, `dVol`, `strikes` and `posPct` reach the screen. They are kept on the type because the endpoint sends them and a reader comparing the two should not have to wonder whether they were dropped by accident.

`lastTs` on `ExpiryInfo` is likewise never rendered.

### HTTP-200-on-failure — the whole point of this section

`loadVolGexFlow()`:

```ts
try {
  const j = await query<VolFlowResponse | null>(volGexFlowUrl(pick, session), { staleMs: NO_STORE_STALE_MS })
  if (j?.ok === false) {
    return { status: 'rejected', error: volFlowReasonText(j.reason, copy), updatedAt: Date.now() }
  }
  return { status: 'ok', points: …, expiries: …, resolvedExpiry: j?.expiry ?? null, updatedAt: Date.now() }
} catch (e) {
  return { status: 'failed', error: errText(e) }
}
```

From the source:

> v2 **NEVER CHECKS `res.ok`** on this one — it goes straight to `r.json()`, which is safe in practice because the route answers `ok:false` with a **200** (`server-with-proxy.js:1184`, the `no-db` branch) and reserves non-2xx for its outer 500 (`{error, detail}`, no `ok` field). `query()` throws on the non-2xx, so that 500 now lands in `failed` with a status message instead of in `rejected` with "Feed unavailable" — strictly more informative, and **the only path where the two versions differ**.

`volFlowReasonText` is a two-branch ladder: `reason === 'no-db'` → `History DB unavailable`; **every other reason, including a missing one** → `Feed unavailable`.

### Two failure modes, two different side effects

This is the behaviour most likely to be "simplified" by accident. `apply()` in the card:

| `status` | Points | Expiry list / resolved expiry | `updatedAt` stamp | `error` |
|---|---|---|---|---|
| `ok` | replaced | replaced | **advanced** | cleared |
| `rejected` (body said `ok:false`) | **cleared** | **kept at previous values** | **advanced** | set |
| `failed` (request threw) | **kept — last good series stays under the scrim** | kept | **not advanced** | set |

> A failing feed goes on ticking the "updated" time, which is worth knowing before trusting it.

> v2 wrote those two branches deliberately and the difference is visible. Modelled below as separate variants so step 3 cannot merge them by accident.

`loading` is set true **only** on a pick/session change, never by the 15s tick:

```ts
useEffect(() => { setLoading(true); void load() }, [load])   // load is keyed on pick + session
usePoll(() => void load(), VOL_FLOW_POLL_MS)                 // does not touch loading
```

### Polls pause on a hidden tab — and v2's wake-on-visible came for free

> v2 ran the 15s /proxy/gex poll, the 60s multi poll and card 12's 15s flow poll at FULL RATE in a background tab (B274); `query()`'s `pollMs` skips a tick while `document.visibilityState` is `hidden` and fires one immediately on the way back. That last half is EXACTLY what `VolGexFlowPanel.tsx:211–212` hand-rolled — the tab's only `document.visibilityState` reference, and the one that made a poll MORE eager rather than pausing anything.

`background: true` is **not** set on any of these feeds: "every one of these feeds is a current-value read where a missed tick is repaired by the next one, which is the only condition that would justify it."

---

## Every derived number

### The two series

```ts
volFlowDollarSeries(points) = points.map(p => ({ time: Math.floor(p.ts / 1000), value: p.volGex }))
volFlowPctSeries(pctPoints) = pctPoints.map(p => ({ time: Math.floor(p.ts / 1000), value: p.posPct }))
pctPointsOf(points)         = points.filter(p => p.posPct != null && Number.isFinite(p.posPct))
```

`lightweight-charts` wants **UNIX seconds**; the wire carries **milliseconds**. `Math.floor` everywhere, never `Math.round`.

Units: `volGex` is **dollars of net gamma from today's volume**; `posPct` is a **percentage, 0–100**.

The two views cover **different bucket sets**, which is why the stats are two functions and not one:

> a bucket with rows but no gamma at all has a `volGex` and no `posPct`.

### `computeVolFlowStats(points)` — the $ view

| Field | Formula | Unit |
|---|---|---|
| `last` | `points[points.length - 1]` | — |
| `high` | `{ v, at }` at the index where a **strict `>`** scan first found the max | $, ms |
| `low` | `{ v, at }` at the index where a **strict `<`** scan first found the min | $, ms |
| `flips` | count of `i ≥ 1` where `(prev < 0 && cur >= 0) \|\| (prev >= 0 && cur < 0)` | count |

> Both extremes use a STRICT comparison in the reduce, so the **FIRST** extreme wins a tie. `flips` counts zero crossings with zero on the **POSITIVE** side — each one is a regime change between dampening and amplifying.

Returns `null` for an empty array.

Zero-counts-as-positive is one of three places the tab does it, and the file header warns against fixing one alone:

> ZERO COUNTS AS POSITIVE, three times over, and each one is load-bearing: `curveSignOf(0) === 1`…, the EOD bar ladder is `v >= 0`, and **card 12's flip counter treats `0` as the positive side**. Do not "fix" one without the other two.

### `computeVolFlowPctStats(pctPoints)` — the % view

| Field | Formula | Unit |
|---|---|---|
| `last` | `{ v: lastVal, ts, strikes }` | %, ms, count |
| `d` | `vals.length > 1 ? lastVal − vals[len-2] : null` | percentage points |
| `high` / `low` | same strict-comparison scan | %, ms |
| `abovePct` | `(count of v >= 50) / vals.length × 100` | % of buckets |
| `flips` | crossings of **50**, same `>= / <` boundary | count |

> `flips` counts crossings of 50, not 0 — on this series the regime change is the chain flipping between net long and net short gamma. Same `>= / <` boundary, so **exactly 50 is the long side**.

`VOL_FLOW_PCT_BASELINE = 50` — "The % series splits here, not at zero: 50% is a balanced chain."

### `pctAutoscaleRange(vals)` — the % axis

```ts
PCT_AUTOSCALE_PAD = 5
lo = max(0,   min(50, ...vals) − 5)
hi = min(100, max(50, ...vals) + 5)
// empty array → { minValue: 0, maxValue: 100 }
```

From the file header, note 10:

> CARD 12'S % SERIES AUTOSCALE ALWAYS CONTAINS 50. Pure data-fit would make a 58–64 day look like a regime war; a hard 0–100 would flatten the same day into a straight line. `pctAutoscaleRange` pads by 5 either side of the data, clamps to 0–100, and forces 50 inside the range.

It is read through a **ref**, not state:

> v2 reads its values from a REF, not state, because the provider is captured once at series creation and would otherwise close over a stale array — step 3 must keep that, whatever it stores the values in.

### Formatters

```ts
fmtGex(v, digits = 2)   // the scanner's, NOT mgMath's
  null/non-finite → '—'
  |v| ≥ 1e12 → `${sign}${(a/1e12).toFixed(digits)}T`
  |v| ≥ 1e9  → `…B`
  |v| ≥ 1e6  → `…M`
  |v| ≥ 1e3  → `${sign}${(a/1e3).toFixed(0)}K`      // ZERO dp, always
  else       → `${sign}${a.toFixed(0)}`
  // sign is U+2212 MINUS SIGN, never an ASCII hyphen. No '$' prefix.

fmtGexAxis(p) = fmtGex(p, 1)   // the price axis uses ONE decimal; the tiles use two
fmtPctAxis(p) = `${p.toFixed(0)}%`
etTimeFromSec(sec) = etHourMinute(sec * 1000)
etHourMinute(ms)   = toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })
shortExpiry(iso)   = "2026-07-31" → "Jul 31", parsed at UTC NOON so the label cannot slip a day west of UTC
EM_DASH            = '—'  (U+2014)
```

There are **two `fmtGex` functions on this screen** and both ship. From note 6 of the `gexLevels.ts` header:

> `fmtBn` ("1.24bn", "412.7M", ASCII minus, no K or T tier) formats every SVG axis, tooltip and history cell on cards 1–11. `fmtGex` ("1.24B", "−413K", U+2212 minus, T/B/M/K) formats card 12's six tiles and its price axis. They are DIFFERENT COLUMNS, not a duplication: card 12 is a shared component — the same panel renders on /home, where `fmtGex` mirrors the Levels strip's `fmtMoneyB`. **Collapsing them here would silently re-format the home page.** Spec open question 10 asks Brandon which becomes the house format; until that is answered both ship.

(Note: `mgMath.ts`'s `fmtGex` is a *third* function of that name in the repo, with a `$` prefix and a `{sign, text}` return — see `card-multi-greek.md`.)

### The six tiles

`VOL_FLOW_TILE_COUNT = 6`. The order of meaning is fixed across both views — **now / change / high / low / regime / context** — "so the eye doesn't have to re-learn the block when you flip the switch."

#### `$ GEX` view — `volFlowDollarTiles(stats)`

| # | Label | Value | Sub | Colour |
|---|---|---|---|---|
| 1 | `Net Vol GEX` | `fmtGex(last.volGex)` | `etTimeFromSec(floor(last.ts/1000))` | `last.volGex >= 0 ? V2.up : V2.red` |
| 2 | `Δ Last Bucket` | `—` when `dVol == null`, else `` `${dVol > 0 ? '+' : ''}${fmtGex(dVol)}` `` | `30s` (`BIN_LABEL`) | `(dVol ?? 0) >= 0 ? V2.up : V2.red` |
| 3 | `Session High` | `fmtGex(high.v)` | `etTimeFromSec(…)` | **`V2.up`, unconditionally** |
| 4 | `Session Low` | `fmtGex(low.v)` | `etTimeFromSec(…)` | `low.v < 0 ? V2.red : T.text` |
| 5 | `Sign Flips` | `String(flips)` | `flips === 0 ? 'one regime' : 'regime changes'` | `flips > 0 ? V2.orange : V2.cyan` |
| 6 | `Spot` | `last.spot ? last.spot.toFixed(2) : '—'` | `` `${last.strikes} strikes` `` | `V2.cyan` |

Two asymmetries are v2's and are preserved:

> Session High is inked positive UNCONDITIONALLY — a session whose high is still negative reads as positive. Session Low falls back to plain text when it is non-negative; it is the only tile on the tab with a neutral fallback ink, and High has no mirroring guard. **Spec open question 11.**

Tile 6 uses a **falsy** test "so a genuine spot of 0 prints an em dash." Tile 2's `+` is added only when **strictly** positive; a negative takes its U+2212 from `fmtGex`. "At exactly zero this prints `0` inked positive, which is consistent — unlike the % view's version below."

#### `+GEX %` view — `volFlowPctTiles(s)`

| # | Label | Value | Sub | Colour |
|---|---|---|---|---|
| 1 | `+GEX %` | `` `${last.v.toFixed(0)}%` `` | `etTimeFromSec(…)` | `pctInk(last.v)` |
| 2 | `Δ Last Bucket` | `—` when `d == null`, else `` `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}pt` `` | `30s` | `(d ?? 0) >= 0 ? V2.up : V2.red` |
| 3 | `Session High` | `` `${high.v.toFixed(0)}%` `` | `etTimeFromSec(…)` | **`V2.up`** |
| 4 | `Session Low` | `` `${low.v.toFixed(0)}%` `` | `etTimeFromSec(…)` | **`V2.red`** |
| 5 | `Time > 50%` | `` `${abovePct.toFixed(0)}%` `` | `flips === 0 ? 'one regime' : \`${flips} regime changes\`` | `abovePct >= 50 ? V2.up : V2.red` |
| 6 | `Regime` | `last.v >= 50 ? 'LONG γ' : 'SHORT γ'` (γ is U+03B3) | `` `${last.strikes} strikes` `` | `pctInk(last.v)` |

Tile 5 carries the flip **count in its sub-label** where the $ view puts the count in the value and a bare noun in the sub.

#### 🐛 Transcribed v2 bug #1 — tile 2 in the % view

```ts
// BUG (v2): the sign GLYPH and the INK disagree at exactly zero. The label
// ternary is `> 0` and the colour ternary is `>= 0`, so a delta of exactly
// zero renders "−0.0pt" — a minus sign — inked positive. Transcribed as
// v2 writes it; step 3 decides. (VolGexFlowPanel.tsx:441.)
```

So **at exactly zero the % view prints `−0.0pt` in the positive colour.** This is intentional fidelity, not an oversight.

#### 🐛 Transcribed v2 bug #2 — the bucket note

The card header says:

> the panel header says "30s buckets · today ET" while the scanner card's subtitle says "5m buckets" — the panel sends `bin=BIN_SEC` = 30 and v2's subtitle never caught up

`BIN_LABEL` is derived, so the panel is right: `BIN_SEC < 60 ? '30s' : '0.5m'` — "Buckets are sub-minute, so `BIN_SEC / 60` would render '0.5m'."

#### Placeholders

```ts
VOL_FLOW_TILE_PLACEHOLDER = { label: '—', value: '—', sub: '', color: T.text }
```

Six of them are rendered whenever `tiles` is empty. "**Six placeholder tiles keep the block's height fixed so the chart never moves.**" (B317)

### The picker's rows — `volFlowExpiryOptions(expiries, resolvedExpiry)`

Always exactly two sentinels, then one row per reported expiry **in the server's array order, not sorted client-side**:

| Row | `value` | `label` |
|---|---|---|
| 1 | `__front__` | `` `Front · ${shortExpiry(resolvedExpiry)}` ``, or bare `Front` before the first response resolves one |
| 2 | `__all__` | `All expiries` |
| 3…n | the ISO date | `` `${shortExpiry(e.expiry)} · ${e.rows.toLocaleString()} rows` `` → `Jul 31 · 1,204 rows` |

> The list is whatever the endpoint reports as ACTUALLY HAVING ROWS TODAY, so **a pick can never produce an empty chart** — and before the first response only the two sentinels exist.

---

## Every control

| Control | Primitive | Options | Default | Where stored | Changes the URL? | Old / bad value coerces to |
|---|---|---|---|---|---|---|
| **Expiry picker** | `Select` (`ariaLabel="Expiration"`, `menuWidth="w-36"`, custom `triggerClassName`) | two sentinels + one row per reported expiry | `VOL_FLOW_DEFAULT_PICK` = `__front__` | **nowhere** — React state, per mount | ✅ scope clause | n/a — nothing is persisted |
| **Session** | `SegGroup<VolFlowSession>` | `RTH` then `ETH` | `VOL_FLOW_DEFAULT_SESSION` = `'rth'` | **nowhere** — React state | ✅ `&session=` | n/a |
| **View** | `SegGroup<'dollar'\|'pct'>` | `$ GEX` then `+GEX %` | `$ GEX` (`readPctView()` → `false`) | `sessionStorage` key **`cbedge.volGexFlow.pctView`** (`PCT_VIEW_STORAGE_KEY`), `'1'` = pct | ❌ **never** | anything that is not the string `'1'` → `$ GEX` |
| **Refresh** | `PanelRefresh` button, label `Refresh` (`PANEL_REFRESH_LABEL`) | — | — | — | no, refires the same URL | — |

Why RTH is the default:

> RTH is the default because the overnight stretch has no new prints — values persist until the chain resets, which draws a long flat line and a phantom step that read as signal but aren't.

Session tooltips: `RTH` → `Regular hours — 09:30–16:00 ET`; `ETH` → `Extended — the whole ET day, including the overnight tail`.

View tooltips: `$ GEX` → `Net vol GEX in dollars — the signed flow series`; `+GEX %` → `Share of the selected expiry's |net GEX| (OI+Vol) that is positive — the same number as the home Levels strip's +GEX % tile. Above 50% = long-gamma chain.`

### The view toggle must never reach the URL

Stated in three places. In the card:

```ts
// THE VIEW TOGGLE NEVER REACHES THE URL. It is presentation over the same
// response — `pctPointsOf` filters the buckets that carry a posPct and the
// chart swaps which series and which price scale is visible. Only `pick` and
// `session` are in `volGexFlowUrl`; if this joined them, a toggle would become
// a request. (Data module § 11.)
```

and in the data module: "**It must NOT reach `volGexFlowUrl`, or a toggle becomes a request.**"

### The storage split is unexplained, and that is recorded

> `sessionStorage`, NOT localStorage — per browser tab, cleared when the tab closes. It is the only sessionStorage key in Part B; the card layout and the OI cache both use localStorage, **with no stated reason for the split** (spec "Do not port" 26).

### `writePctView` takes the value *before* the toggle

```ts
export function writePctView(prev: boolean): void {
  sessionStorage.setItem(PCT_VIEW_STORAGE_KEY, prev ? '0' : '1')
}
```

"`prev` is the value BEFORE the toggle — v2 writes inside the state updater." The call site passes the old value and then sets the new one:

```ts
onChange={(v) => {
  const next = v === 'pct'
  if (next === pctView) return
  writePctView(pctView)   // the OLD value
  setPctView(next)
}}
```

Both reads and writes are wrapped in `try/catch` — "sessionStorage unavailable — the view just won't be remembered."

### The view switch is always rendered

```tsx
{/* ALWAYS rendered: an earlier version hid it whenever the window held
    no posPct rows, so the feature vanished on a weekend. */}
```

and in `gexLevels.ts`:

> ALWAYS rendered: an earlier version hid the control whenever the window held no `posPct` rows, so the whole feature vanished on a weekend and **read as the change having been rolled back**.

### The updated stamp

```tsx
{updatedAt != null && <span className="tabular ml-auto text-2xs text-muted">{etTimeFromSec(Math.floor(updatedAt / 1000))}</span>}
```

Omitted entirely before the first response. `ml-auto` pushes it and the Refresh button to the right of the header row.

---

## Rendering

### Canvas, via `lightweight-charts`, inside `ChartFrame`

This is **the only `<canvas>` in the whole GEX Levels transcription** — the other eleven cards are hand-rolled inline SVG. The chart is created imperatively in `ChartFrame`'s `onMount` and never re-created.

```ts
h.el.querySelectorAll('canvas').forEach((canvas) => canvas.setAttribute('data-cb-layer', 'volflow'))
```

> v3 non-negotiable 7 [tagging]. `lightweight-charts` creates the canvases, so they are tagged the moment it has: **v2 tagged nothing at all** (B302).

`gexLevelsData.ts` § 12 lists everything v2's version arrived with that v3 forbids: no `data-cb-layer`, no visibility guard anywhere, and a `ResizeObserver` + rAF pump that ran whenever mounted "whether or not the card is on screen."

### Chart options — `volFlowChartOptions()`

| Option | Value | Note |
|---|---|---|
| `background` | `transparent` | |
| `textColor` | `tokenHex('--color-fg')` → `#e7ece9` | |
| `gridColor` | `tokenHexAlpha('--color-fg', 0.05)` | "v2's grid wash was white at 5%" |
| `borderColor` | `tokenHexAlpha('--color-fg', 0.1)` | "its borders were white at 10%" |
| `attributionLogo` | `false` | |
| `handleScale` / `handleScroll` | `false` / `false` | "No pan, no zoom — the opposite of the four strike charts on this same tab, which implement bespoke wheel-zoom and drag-pan. Spec 'Do not port' 29 asks for one model" |
| `crosshair.mode` | `0` | |
| `timeVisible` / `secondsVisible` | `true` / `false` | |
| `tickMarkFormatter`, `timeFormatter`, `localization.priceFormatter` | `etTimeFromSec` / `etTimeFromSec` / `fmtGexAxis` | |

`attributionLogo: false` means the TradingView mark is off inside the pane. **The credit is a licence condition**, and `ChartFrame.tsx` says where it goes instead:

> THE CREDIT IS NOT OPTIONAL. It is a condition of the library's licence, so moving it is fine and removing it is not: any card that turns the built-in mark off has to render `<TvAttribution />`.

*(As written, this card sets `attributionLogo: false` and does not render `TvAttribution` in its own markup.)*

### The two series

Both are `BaselineSeries` and both take the same six colours; only the split differs.

```ts
VOL_FLOW_SCALES = {
  dollar: { priceScaleId: 'right', baseValue: 0 },
  pct:    { priceScaleId: 'left',  baseValue: 50 },
}
VOL_FLOW_SERIES_SHAPE = {
  lineWidth: 2,
  priceLineVisible: false,
  scaleMargins: { top: 0.12, bottom: 0.14 },
}
VOL_FLOW_PCT_MIN_MOVE = 0.1
```

Why a Baseline series at all:

> net vol GEX is a POLARITY measure — the sign IS the signal — and a baseline series splits the fill at zero natively, so the sign is read from colour and side without a legend lookup.

Why two scales, both declared up front:

> Two scales rather than one shared: each carries exactly one series, so each keeps its own price formatter ($ vs %) with no fighting over which series formats the axis. **Both are declared at construction and only `visible` is toggled — adding a price scale to a live chart re-lays-out the pane and jumps the series.**

The bottom scale margin exists because "lightweight-charts would clip the [lowest price tick] label in half" at the canvas edge.

### Colours — tokens, resolved to hex at mount

`volFlowSeriesColors()`:

| Series option | Value |
|---|---|
| `topLineColor` | `tokenHex('--color-v2-refresh')` |
| `topFillColor1` / `topFillColor2` | the same at **0.32** / **0.02** alpha |
| `bottomLineColor` | `tokenHex('--color-v2-red')` |
| `bottomFillColor1` / `bottomFillColor2` | the same at **0.02** / **0.32** alpha |

Token names, **not `var()` strings**, and the warning attached to them:

> THESE ARE CUSTOM-PROPERTY NAMES, NOT `var()` STRINGS. `tokenHex()` looks each one up on the computed style at mount and returns `'transparent'` for a name it cannot find — **it does NOT throw**. So a rename or a deletion of either token below paints card 12's chart blank with no error anywhere. Both are declared in `src/design/tokens.css`; keep them named there.

> **2026-09-03**: these were `'--color-move-up'` / `'--color-move-down'`. The scanner runs on v2's palette, and these two MUST resolve to the same values `V2.up` and `V2.red` hand to the six stat tiles beside the chart — otherwise the series and its own tiles disagree about the sign of the same number.

Resolve them at **mount, not per frame**: "Call them at MOUNT, not per frame."

#### Token reference

| Alias in code | Token | Hex in `tokens.css` | Where used |
|---|---|---|---|
| `V2.up` | `--color-v2-refresh` | `#3ddc8e` | positive tiles, `topLineColor`, corner label `LONG GAMMA` |
| `V2.red` | `--color-v2-red` | `#ff6b7a` | negative tiles, `bottomLineColor`, corner label `SHORT GAMMA`, error scrim ink |
| `V2.cyan` | `--color-v2-cyan` | `#6aa0ff` | tiles 5–6 in the $ view, non-error scrim ink |
| `V2.orange` | `--color-v2-orange` | `#ffd166` | `Sign Flips` when `> 0` |
| `V2.bg` | `--color-v2-bg` | `#0a0d10` | the scrim's plate, at 72% alpha |
| `T.text` | `--color-fg` | `#e7ece9` | placeholder tiles; the neutral `Session Low` fallback |
| chrome | `--color-line` | `#1e2630` | tile borders, control borders |
| chrome | `--color-muted` / `--color-faint` | `#e7ece9` / `#c0c5c3` | tile labels / tile sub-labels |
| chrome | `--color-accent` | `#2f6bff` | the `Refresh` button's ink |

> ⚠️ The **code comments** name v2's original hexes — `V2.up` #1FD98A, `V2.red` #EF4444, `V2.pos` #22C55E, `V2.accent` #7dd3fc. The **tokens as declared today** resolve to the values in the table above. The comments record v2's provenance, not the current pixel. Read `tokens.css` for the value; read the comment for the reason.

The colour-collapse history is dated in the `gexLevels.ts` header:

> **THE COLOUR COLLAPSE IS REVERSED (Brandon, 2026-09-03).** Step 2 collapsed this tab's three positives onto `MOVE_UP`… That is undone: `/v3/scanner` renders v2's PALETTE, not v3's semantics… The ONE collision that is dropped is `HOME_THEME.green` #8ECAE6 doing three unrelated jobs, and it does not appear on this tab's ladders at all — **only card 12's flow series (`pctInk`, the tiles and `TOKEN.up`) painted it, and those are SIGNS, so they take `V2.up`.**

`pctInk(v) = v >= 50 ? V2.up : V2.red`.

### Layout

```
flex h-full min-h-0 flex-col gap-2
├─ header row      flex flex-wrap items-center gap-2.5
│    title · Select · SegGroup(session) · SegGroup(view) · bucketNote · [stamp ml-auto] · Refresh
├─ VolFlowTiles    grid shrink-0 grid-cols-3 gap-1   (6 tiles → 3 × 2)
└─ chart box       relative flex min-h-[200px] flex-1 flex-col
     ├─ VolFlowChart → <div className="relative min-h-0 flex-1"><ChartFrame className="absolute inset-0" /></div>
     ├─ corner labels (pct view only)
     └─ scrim (absolute inset-0) when volFlowScrimVisible()
```

| Constant | Value |
|---|---|
| Chart box minimum height | `min-h-[200px]` |
| Tile grid | `grid-cols-3`, 6 tiles |
| Corner label — long | `absolute left-2.5 top-1.5`, `alpha(signColor(1), 0.85)` |
| Corner label — short | `absolute bottom-6 left-2.5`, `alpha(signColor(-1), 0.85)` |
| Scrim plate | `alpha(V2.bg, 0.72)` — "v2's scrim is `HOME_THEME.bg` at 72% — that is `V2.bg`, the carried-over v2 canvas, **NOT v3's own `T.bg`**" |

Corner labels are `pointer-events-none` and only rendered in the % view:

> B311/B312 — corner labels instead of a legend, % view only: with one series on screen the question is which side of 50 you are on.

### The scrim covers the chart only

```tsx
{/* B313 — the scrim covers the CHART only; the six tiles above it stay
    visible and keep showing their last values. */}
{/* The gate counts the $ series' buckets in BOTH views — an empty % view
    lands on the same "no snapshots" scrim the $ view already shows. */}
```

---

## Per-frame / perf machinery

### The visibility signal

`ChartFrame` offers three ways to learn about visibility; this card uses **`onVisibility`**, with the initial state read off the handle:

```ts
const onMount = (h: ChartHandle) => { visibleRef.current = h.visible(); … }

onVisibility={(visible) => {
  visibleRef.current = visible
  if (visible && pendingRef.current) { pendingRef.current = false; sync() }
}}
```

and `sync()` bails early while hidden:

```ts
if (!visibleRef.current) { pendingRef.current = true; return }
```

> A chart nobody can see does not paint. The skipped push is replayed by `onVisibility` on the way back in.

`ChartFrame`'s visibility is **deliberately generous** — `rootMargin` defaults to `'200px'`, "so a card is painted just before it is scrolled into view rather than a frame after. The gate exists to skip work nobody will see, not to save the last hundred pixels of scroll." It also starts **optimistic** (`onScreen = true`) because "the observer's first callback is asynchronous, and a first paint that is thrown away costs far less than a card that renders blank for a frame on every single mount."

`ChartFrame` also publishes `data-visible="1"|"0"` on its element, which is "how `scripts/perf-check.mjs` tells an idle card from a hidden one."

### The rAF size pump

```ts
VOL_FLOW_SIZE_PUMP_FRAMES = 120

const applySize = () => {
  const w = h.el.clientWidth, height = h.el.clientHeight
  if (w > 0 && height > 0 && (w !== lastW || height !== lastH)) { lastW = w; lastH = height; chart.applyOptions({ width: w, height }) }
}
const pump = () => { applySize(); if ((lastW === 0 || lastH === 0) && tries++ < 120) raf = requestAnimationFrame(pump) }
```

> B310 — the rAF pump. **A chart created inside a flex box that has not laid out yet has a width of 0 and would otherwise never recover.**

The pump stops as soon as both dimensions are non-zero, or after 120 frames (~2s at 60Hz). It is cancelled in the cleanup. `ChartFrame`'s debounced `onResize` (default `debounceMs: 80`) then calls the same `applySize` through `sizeRef`.

### The view swap never rebuilds the chart

```ts
dollar.applyOptions({ visible: !s.pctView })
pct.applyOptions({ visible: s.pctView })
chart.applyOptions({
  rightPriceScale: { visible: !s.pctView, borderColor: border },
  leftPriceScale:  { visible: s.pctView,  borderColor: border },
})
```

> B309 — the view swap only flips visibility and which scale is showing; **it never tears the canvas down and rebuilds it.**

### `stateRef` and `pctValsRef`

`sync` is a `useCallback` with an **empty dependency array**; the current props are read out of `stateRef.current`, which is reassigned on every render. `pctValsRef` exists because `autoscaleInfoProvider` "is captured once at series creation and would otherwise close over a stale array."

### `fitContent()` is wrapped

```ts
try { chart.timeScale().fitContent() } catch { /* not laid out yet */ }
```

---

## Status and empty-state messages, verbatim

### The scrim

`volFlowScrimVisible(loading, err, pointCount)` → `loading || !!err || (pointCount === 0 && !loading)`.

`volFlowScrimText(err, loading, pctView, session)` — **precedence order: error, then loading, then the two empty states**:

| Condition | Text | Ink |
|---|---|---|
| `err === 'no-db'` reason | `History DB unavailable` | `V2.red` |
| any other `ok:false` reason, or none | `Feed unavailable` | `V2.red` |
| a thrown request (non-2xx, network) | the thrown message — e.g. `500 Internal Server Error — /proxy/gex-vol-flow?bin=30&session=rth&scope=front` | `V2.red` |
| `loading` and `$ GEX` view | `Loading net vol GEX history…` | `V2.cyan` |
| `loading` and `+GEX %` view | `Loading +GEX % history…` | `V2.cyan` |
| settled, empty, `RTH` | `No snapshots in today's RTH window — try ETH` | `V2.cyan` |
| settled, empty, `ETH` | `No snapshots recorded yet today` | `V2.cyan` |

> Branch 3 is the only empty state on the tab that names its own remedy.

`volFlowScrimInk(err) = err ? V2.red : V2.cyan`.

### Headings and inline copy

| Slot | Text |
|---|---|
| Title, `$ GEX` view | `Net Vol GEX Flow` (`VOL_FLOW_COPY.titleDollar`) |
| Title, `+GEX %` view | `+GEX % of Chain` (`VOL_FLOW_COPY.titlePct`) |
| Bucket note | `30s buckets · today ET` (`BIN_LABEL` + literal) |
| Corner, top-left (% view) | `LONG GAMMA` |
| Corner, bottom-left (% view) | `SHORT GAMMA` |
| Picker sentinel 1 | `Front` or `` `Front · ${shortExpiry(resolvedExpiry)}` `` |
| Picker sentinel 2 | `All expiries` |
| Session buttons | `RTH` · `ETH` |
| View buttons | `$ GEX` · `+GEX %` |
| Refresh button | `Refresh` |
| Select aria-label | `Expiration` |
| Any tile with no stats | label `—`, value `—`, empty sub |
| `Spot` tile with a falsy spot | `—` |
| Either `Δ Last Bucket` with a null delta | `—` |

Note the **card title in the board frame** is the catalog's `Net Vol GEX Flow (Today)`; the panel's own in-body title is `Net Vol GEX Flow` / `+GEX % of Chain`. The alias comment says why the panel must not add a second heading:

> A thin alias: the board draws the frame, the title and the ✕, so the card IS the panel and nothing here may add a second heading inside one.

---

## Performance notes

- **One request, one poll, one canvas.** 15s, half the 30s bucket, so "a newly written bucket is on screen within one poll rather than up to a full bucket late." Deduped by URL with the scanner tab's entry loader, which fires the same `volGexFlowUrl(VOL_FLOW_FRONT, 'rth')` in `gexLevelsPreloadUrls()`.
- **A hidden tab does not poll**, and fires one catch-up tick on return.
- **A hidden card does not paint.** `sync()` records a pending push and replays it on the way back into view. `budgets.json`'s `perf.offscreenRepaints` is a **hard zero** — "a card scrolled out of view must not paint at all" — and the canvases are tagged `data-cb-layer="volflow"` so `scripts/perf-check.mjs` can attribute repaints to this card.
- `perf.idleRepaintsPerFrame` is `0.15` and `perf.interactionRepaints` is `10`; the second exists because "a gate that suppressed everything would pass every other line here."
- **The chart is never rebuilt.** Both series and both price scales are created once; the view toggle flips `visible` flags only.
- **Colours are resolved once, at mount.** `tokenHex`/`tokenHexAlpha` do a `getComputedStyle` lookup; calling them per frame would be a layout read per frame.
- **The rAF pump is bounded** at 120 frames and cancelled on unmount.
- **`setData` replaces the whole series on every response.** There is no incremental `.update()` here; at 30s buckets over a full ETH day that is at most ~2,880 points, which is well inside what `lightweight-charts` handles in one push.
- **Chunking.** The card is `lazy()` and pulls `lightweight-charts` with it. The header explicitly asks you to watch the board's brotli number after a build; `budgets.json` caps `route` at 59,100 and `totalInitial` at 108,400 brotli bytes, and a chunk over budget **fails the build**.

---

## Gotchas

1. **This is one component on two surfaces.** A change here lands on `/v3/scanner?tab=gexlevels` *and* on the home board. Spec open question 12.
2. **The view toggle must never reach the URL.** Add `pctView` to `volGexFlowUrl` and a presentational switch becomes a network request.
3. **The route answers failures with HTTP 200.** `ok:false` + a `reason` is the normal failure shape; only the outer 500 throws. Any rewrite that starts checking `res.ok` and stops checking `j.ok` will silently render an error body as an empty chart.
4. **`rejected` and `failed` are different on purpose.** `rejected` clears the series and *still advances* the updated stamp; `failed` keeps the last good series and *does not* advance it. Merging them loses a real signal.
5. **`loading` is set only on a pick/session change.** The 15s tick must not set it, or the scrim would flash every fifteen seconds.
6. **Two transcribed v2 bugs ship deliberately.** The % view's `Δ Last Bucket` prints `−0.0pt` in the positive colour at exactly zero; the scanner card's subtitle still says "5m buckets" where the panel correctly says "30s buckets". Both are marked in the source. Do not "fix" either without the decision that owns it.
7. **Zero is on the positive side, three times over** on this tab. `flips` in the $ view, the EOD bar ladder, and `curveSignOf(0)`. Fixing one alone is a bug.
8. **Session High is inked positive unconditionally**; Session Low has a neutral fallback and High has no mirror. Open question 11, not an accident.
9. **`Spot` uses a falsy test**, so a genuine spot of exactly 0 prints an em dash rather than `0.00`.
10. **`TOKEN.up` / `TOKEN.down` are custom-property *names*.** Rename or delete `--color-v2-refresh` or `--color-v2-red` and `tokenHex` returns `'transparent'` — the chart paints blank, silently, with no error anywhere.
11. **The comments name v2's hexes, not today's.** `V2.up` is commented `#1FD98A` and resolves to `#3ddc8e`. Trust `tokens.css` for the value.
12. **The scrim plate is `V2.bg`, not `T.bg`.** They happen to be the same value today (`#0a0d10`); the comment says which one is meant.
13. **`bin` must stay 30.** Going 1:1 with the recorder is only safe because it writes on a fixed 30s grid slot. "Under the older drifting throttle this pairing produced 'the shark tooth': buckets that caught two writes threw one away, and neighbours that caught none dropped a point entirely."
14. **Do not add a `symbol` param.** The route defaults to `$SPX`; sending one "would be a new decision about which underlying card 12 charts, and card 12 is shared with /home."
15. **Do not add a price scale after construction.** Both are declared at mount and only `visible` is toggled — adding one to a live chart re-lays-out the pane and jumps the series.
16. **`pctAutoscaleRange` must be fed from a ref.** The provider is captured once at series creation; state would go stale.
17. **The wire is milliseconds, the chart wants seconds.** Every conversion is `Math.floor(ms / 1000)`.
18. **The picker is unsorted on purpose.** Server order, because that order is "whatever the endpoint reports as actually having rows today."
19. **The view switch is always rendered**, even on a weekend when no bucket carries a `posPct`. Hiding it once made the whole feature look rolled back.
20. **`sessionStorage`, not `localStorage`.** The view resets when the tab closes; the split has no stated reason and is recorded as spec "Do not port" 26.
21. **Nothing about this card is persisted except the view.** Pick and session reset to `__front__` / `rth` on every mount, on both surfaces.
22. **This card does not use `useQuery`**, so `refreshAll()` (the toolbar's ↻) does not directly revalidate it — it only empties the shared cache, which the next 15s tick then misses.
23. **`data-cb-layer` is applied after `createChart` returns**, by querying the container for canvases. A future `lightweight-charts` that creates a canvas lazily would escape the tag and vanish from `perf-check`.
24. **`attributionLogo: false` is set and `<TvAttribution />` is not rendered by this card.** The library's licence requires a visible link somewhere; `ChartFrame.tsx` provides the component for it.
25. **`chart-render.ts` is not this card's renderer.** Anyone grepping for the board's canvas code will find it; it belongs to other cards. The parallel visibility machinery here is a reimplementation, not a reuse.
26. **A second copy on the board shares everything.** The `#n` instance suffix is not threaded into this card (the catalog's `render` takes no `instanceId` for it), and the only persisted value is a single `sessionStorage` key — so two copies always show the same view.
