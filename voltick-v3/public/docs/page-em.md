# `/em` — Estimated Moves

**Route:** `/em` (served at `voltick.cbedge.net/v3/em`; the router `basename` is `/v3`). **Mounted by:** `src/App.tsx` — `const Em = lazy(() =>
import('@/pages/Em'))`, `<Route path="/em" element={<Em />} />`. Also mounted full-bleed on the phone as `/m/em` (`src/mobile/pages/MEm.tsx`,
`<MobileShell chrome="bare"><Em /></MobileShell>`). **Rail entry:** `NAV` in `src/shell/Shell.tsx`:

```ts
// Prefetches the default chip's levels row on hover — the page's own lookup
// reads it back out of the api.ts cache, so the click lands on data that is
// already home. See src/pages/em/emData.ts (LEVELS_STALE_MS).
{ to: '/em', label: 'Est. Moves', icon: '↔️', prefetch: ['/api/levels?ticker=SPX'] }
```

placed immediately before `/economic-calendar` — *"Next to Est. Moves on purpose — both are pre-open prep, read once before the bell rather than
watched."*

**Sources**

| File | Lines | What it owns |
|---|---:|---|
| `src/pages/Em.tsx` | 504 | The page: header, the search form + chip row, the four result cards, the hit-rate meter, the CopyShot target, the palette re-key, `PLATE` / `LABEL` / `Tile` |
| `src/pages/em/emData.ts` | 333 | `loadEm()` — the whole lookup; the alias fan-out, the zones fallback chain, the win-rate merge, the recent-record walk, `val` / `emNumber` / `fmtUpdated` / `trackEmLookup` |
| `src/data/dailyEm.ts` | 132 | The **DAILY** band — a different number entirely; `useDailyEm`, `parseDailyEm`, `dailyEmUrl`. **Not used by this page**; documented here for contrast |
| `src/data/levels.ts` | 286 | The derived GEX levels (call wall / put wall / CORE / flip). Shares the word "levels" and the `/api/levels` neighbourhood but is a different quantity; documented here for contrast |

Supporting: `src/data/api.ts` (239), `src/design/primitives/Card.tsx` (238), `src/design/primitives/Page.tsx` (38), `src/design/theme.ts` (471),
`src/design/tokens.css` (716), `src/shell/CopyShot.tsx` (556), `src/mobile/MobileShell.tsx` (119), `src/mobile/mobileNav.ts` (141).

---

## What it is, in one paragraph

Type a ticker, get this week's **estimated move** and the levels built on it. One search box, ten quick-pick chips, and — once a lookup lands — five
stacked cards: the four headline numbers (Close, EM, Up, Down) with an all-time EM hit-rate meter under them; the **Buy Zone** and **Sell Zone** pairs
(near / far); the **weekly Pivot**; this week's EM measured against its own 4-week and 12-week averages; and a Recent Track Record showing last week's
HIT/MISS plus the trailing-five hit rate. It is a **weekly, published** number — the levels row is computed once a week by a server-side publisher,
not derived on the client — and the page is REST-only: *"This page opens no socket and mounts no canvas: it is REST-only, so non-negotiables 4, 5 and
6 have nothing to bite on here."* It is a 1:1 port of v2's `/app/em` (`components/dashboard/EmCustomer.tsx`) against the checklist in
`docs/parity/em.md`: *"The maths, the thresholds, the label wording and the row ordering are transcribed from v2; only the palette and the render
layer are new."*

---

## The three deliberate departures from v2

### 1. The palette was re-keyed onto v3 tokens (Brandon, **2026-08-31**)

v2 hardcoded five colours *"that are in no token file"* — `#cbd5e1`, `#e8c060`, `#00e676`, `#ff5a6a`, `#ffc107` — *"and used two different reds and
two different greens for the same semantic."* The mapping is written out once in the page header so it stays legible:

| Meaning | v3 | v2 was |
|---|---|---|
| Close | `CAL.previous` | `#cbd5e1` |
| EM | `T.orange` | `#e8c060` |
| Up · Buy Zone · HIT · ≥65% | `MOVE_UP` | `#00e676` |
| Down · Sell Zone · MISS | `MOVE_DOWN` | `#ff5a6a` **and** `#EF4444` |
| 50–64% hit rate | `CAL.medium` | `#ffc107` |

> The two-reds and two-greens inconsistency collapses by construction: the Sell Zone's border and its text are now one colour, and the sub-50%
> threshold is the same colour in the hit-rate meter as it is in the track record.

That is why `hitRateColor` is **one function used twice** (the meter and the track record), where v2 had *"two DIFFERENT colour sets… for the same two
cut points."*

### 2. The URL is the source of truth (Brandon, **2026-08-31**)

> v2 read `?ticker=` on mount and never wrote it back, so a looked-up page could not be shared by copying the address bar. Here every lookup goes
> through the query string, which also makes back/forward work for free.

### 3. The snapshot button moved to the toolbar camera

v2 put a 📸 inside the result header (`BoxSnapBtn`, **html2canvas**). v3 *"HAS the capture now (`shell/snapshot.ts` — no dependency; the browser does
the rendering) but not the button: there is one camera in this app and it lives in the toolbar."* The page **publishes** its result block to that
camera's menu *"the moment a ticker has actually been looked up, which is the only moment there is anything worth photographing."*

`parity-check-em.mjs` still carries `D/snapshot` as a **KNOWN DEPARTURE (`soft`)**: *"the capability came across, the chrome moved."* See
`docs/parity/em.md` Part D.

There is also a **fourth** departure, inside the data layer, recorded separately — see **No waterfall** below.

---

## The data path

Every request goes through `query()` in `src/data/api.ts`. Two stale windows:

```ts
/** Levels are published weekly; a short window makes the nav prefetch count. */
const LEVELS_STALE_MS = 10_000
/** The enrichment set changes once a week too. */
const ENRICH_STALE_MS = 60_000
```

### Endpoints

| Endpoint | Params | Stale | Fired | Response read | On failure |
|---|---|---:|---|---|---|
| `/api/levels` | `ticker` | `10_000` | **awaited** — the core row | `Levels` — every numeric field a **formatted string** | a throw → `new Error('Lookup failed')`, which is the banner text |
| `/api/em-zones` | `ticker` | `10_000` | only when the row has no zones, or there is no row | `Levels`-shaped, or `{ error }` | `null`; if there was no row either → `No levels published for {SYM} yet.` |
| `/api/em/ticker-em-stats` | `ticker` | `60_000` | fired **first**, awaited last | `{ recentAvg, midAvg, sampleSize }` | `.catch(() => null)` → the averages card does not render |
| `/api/em-tracker` | *(no params)* | `60_000` | fired first | `{ summary: [{ ticker, hits, evaluated }] }` | `.catch(() => null)` → no win rate |
| `/api/em-tracker/history` | *(no params)* | `60_000` | fired first | `{ tallies: { [ticker]: { hits, total } } }` | `.catch(() => null)` |
| `/api/em-tracker` | `ticker` — **once per alias** | `60_000` | fired first | `{ rows: [{ week_label, week_start, result }] }` | `.catch(() => null)` per alias; missing sets are skipped |
| `/api/ticker-event` | — (POST body `{ ticker, event: 'click', source: 'em' }`) | — | after data lands | — | *"tracking must never throw"* |

### Prefetch wired in `src/shell/Shell.tsx`

`prefetch: ['/api/levels?ticker=SPX']`, fired on `onPointerEnter` of the rail icon. The contract between the two is explicit on both sides:

* `Shell.tsx`: *"Prefetches the default chip's levels row on hover — the page's own lookup reads it back out of the api.ts cache, so the click lands
  on data that is already home."*
* `emData.ts`: *"v2 reads `/api/levels` with `cache: 'no-store'`. Here it goes through `query()` with a 10s stale window so the rail's
  `preload('/api/levels?ticker=SPX')` on hover actually pays for itself. The levels row is published once a week; ten seconds is not a staleness
  anyone can observe."*

Note the prefetch only warms **SPX**. Any other chip or typed ticker is a cold lookup.

### No waterfall — the one deliberate departure in the data layer

> v2 awaits `/api/levels` and only THEN fires the four enrichment requests, even though not one of them needs anything from the levels row — every URL
> is built from the symbol, which is known on the first line. That is a two-stage waterfall, and **v3's non-negotiable 3 forbids it**. Here the
> enrichment wave is started BEFORE the levels read is awaited. Same requests, same results, one round trip less.

In code:

```ts
const statsP   = query(`/api/em/ticker-em-stats?ticker=${e}`, …).catch(() => null)
const trackerP = Promise.all([query('/api/em-tracker', …), query('/api/em-tracker/history', …)]).then(…)
const rowsP    = fetchTrackerRows(sym)

let row
try { row = await query(`/api/levels?ticker=${e}`, { staleMs: LEVELS_STALE_MS }) }
catch { throw new Error('Lookup failed') }
…
const [stats, tracker, rows] = await Promise.all([statsP, trackerP, rowsP])
```

*"All are individually swallowed: no single failing endpoint may take the page down — the core row still renders."*

### Poll cadence

**There is none.** No `pollMs`, no `setInterval`, no visibility handler. A lookup is a one-shot. The reasoning is in the rail comment — this is
*"pre-open prep, read once before the bell rather than watched"* — and in the stale windows: the levels row is published **weekly**.

The only re-run paths are: the URL changing (`?ticker=`), or a re-submit of the same ticker (handled explicitly — see **controls**).

### Out-of-order protection

```ts
const seq = useRef(0)
const mine = ++seq.current
…
if (seq.current !== mine) return
```

*"Guards against an out-of-order response overwriting a newer lookup — a fast chip-click after a slow one would otherwise repaint the old ticker."*
The guard wraps the success path, the error path **and** the `finally` that clears `loading`.

---

## The four pieces of business logic that are not obvious from the screen

`emData.ts`'s header names them, because *"re-deriving is where detail goes missing"*:

### 1. The ESU/ESM + NQU/NQM alias fan-out

```ts
const TRACKER_ALIASES: Record<string, string[]> = {
  ESU: ['ESU', 'ESM'],
  NQU: ['NQU', 'NQM'],
}
```

> Futures are RECORDED under their internal month code and DISPLAYED under the front code, so the tracker has to be asked for both.

And a documented asymmetry, carried across rather than papered over:

> NOTE this is the CLIENT fan-out only. `/api/levels` does its own, wider aliasing **server-side** (ES, ESM, ESU6, ESU26, /ES → ESU and the NQ
> equivalents) and `/api/em/ticker-em-stats` does **NONE** — which is why **ESU can show a hit rate and no historical average in the same render**.
> That asymmetry is v2's; it is recorded here rather than papered over.

The fan-out is used in two places: `fetchTrackerRows` (one request per alias, results concatenated) and the win-rate merge (`candidates` for both the
live summary row and the history tally).

### 2. The win-rate merge

Two sources, **two different field names for the same idea**:

```ts
const liveHits  = liveRow?.hits ?? 0
const liveEval  = liveRow?.evaluated ?? 0     // live table:   `evaluated`
const histHits  = hist?.hits ?? 0
const histTotal = hist?.total ?? 0            // history JSON: `total`
winRate = { hits: histHits + liveHits, evaluated: histTotal + liveEval, hit_rate: hits / evaluated }
```

> The field names differ between the two sources on purpose — `total` in the history JSON, `evaluated` in the live table. **Reading one for the other
> is silent and produces a plausible wrong number.**

`winRate` is `null` unless `totalEval > 0`, and the card simply does not render the meter.

### 3. The zones fallback chain

```
row exists?
  ├─ no  → fetchZones(sym)
  │         ├─ null → throw `No levels published for {SYM} yet.`
  │         └─ ok   → data = zones
  └─ yes → data = row
            └─ if (!row.buy_near && !row.sell_near && !row.pivot)
                 → fetchZones(sym); if ok → data = { ...data, ...zones }
```

* *"No published row at all — still try on-demand zones, which are static for the week. EM only exists once the weekly publisher has computed it, so a
  brand new ticker shows zones now and EM after the next weekend run."*
* *"Fill zones in on demand when the published row has EM but no zones — the long-tail names are not pre-published with them. **The on-demand fields
  WIN over the published row; that is v2's merge order.**"*
* `fetchZones` treats a `{ error }` body as `null`.

### 4. EM values arrive as comma-formatted STRINGS

> EM values arrive as comma-formatted STRINGS ("7,711.76"). **Every consumer must strip the commas before `parseFloat`** — `parseFloat("7,711.76")` is
> **7**.

```ts
export function emNumber(v) {
  const n = parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
```

This is the single most dangerous field convention on the page: the `Levels` interface types **every** numeric field as `string | null`, and the only
place a number is actually needed (the historical-average comparison) goes through `emNumber`. Everything else is printed raw via `val()`.

---

## `REMOVED IN v2, DO NOT RE-ADD`

Verbatim from the file header:

> `/api/confidence` and its "CB Confidence" tile. The route returns `score: ConfidenceResult` (an object) where the reader expected a scalar, so
> `Number(object)` was NaN, `Number.isFinite` was false, and **the tile never rendered on any surface, ever**. It was also the most expensive request in
> the set — **a 120-session server-side scan per lookup**, for a value that was thrown away. **If the tile is wanted, fix the ROUTE to return a scalar
> first.**

---

## Panel by panel

The page renders inside `<Page>` (the scrolling variant), in a single column: `mx-auto flex w-full max-w-[720px] flex-col gap-4 pb-12`. **720px max
width**, centred — which is what lets the same component serve `/m/em` unchanged.

### 1. Header

* The logo: `<img src="/cb-edge-logo.png" className="mx-auto -mb-4 block h-36 w-auto">`. *"Served from the v2 public/ root, which is the same
  origin."* The `-mb-4` deliberately pulls the title up into the logo's whitespace.
* `<h1>` — **Weekly Estimated Move & Zones**, `text-xl font-extrabold text-fg` (24px).
* `<p>` — **Enter a ticker to see this week's estimated move and the buy / sell zones.** `text-sm text-fg`.

### 2. Search card (`<Card expandable={false}>`)

* A `<form>` whose submit calls `submit(input)`.
* The input: `placeholder="Enter ticker  (e.g. SPX, NDX, AAPL)"`, `aria-label="Ticker"`, `spellCheck={false}`, `autoCapitalize="characters"`,
  `min-w-[200px] flex-1 … text-base uppercase tracking-wide`. The uppercase is **visual**; the actual uppercasing happens in `submit`.
* The button: `Get Levels`, or `Loading…` while a lookup is in flight. Disabled when `busy = loading || !input.trim()`, with `disabled:opacity-45
  disabled:cursor-not-allowed`. Border and ink are `border-accent` / `text-accent`; background `alpha(T.cyan, 0.1)`.
* The chip row: one pill per entry of `POPULAR`, centred and wrapping. The active chip (`ticker === s`) takes `border-accent` and `alpha(T.cyan,
  0.16)`; the rest `border-line` and `alpha(T.cyan, 0.07)`.

```ts
/** The quick-pick chips, in this exact order. v2's POPULAR, unchanged. */
export const POPULAR = ['SPX', 'NDX', 'ESU', 'NQU', 'SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'MSFT'] as const
```

### 3. Error banner

Rendered only when `error` is set: `rounded-md border px-4 py-3.5 text-center text-sm`, with `borderColor: alpha(MOVE_DOWN, 0.25)`, `background:
alpha(MOVE_DOWN, 0.08)`, `color: MOVE_DOWN`. The text is the thrown message, verbatim.

### 4. Empty state

`{!snap && !error && !loading}` → **Enter a ticker above to view its weekly levels.**, `py-10 text-center text-sm text-fg`.

Note the condition: an in-flight first lookup shows **nothing at all** in the body (the button carries `Loading…`), because `snap` is cleared at the
start of `run()`.

### 5. Result header row

Only when `snap && data && !loading`. It is the top of the `shotRef` block.

| Element | Content | Class |
|---|---|---|
| Ticker | `data.label \|\| data.ticker \|\| ticker` | `text-2xl font-extrabold tracking-tight text-fg` (32px) |
| Week | `Week of {data.exp_label}` — omitted when absent | `text-xs font-bold uppercase tracking-widest text-fg` |
| Stamp | `Updated {fmtUpdated(data.updated_at)}` — `ml-auto`, omitted when absent | `text-xs text-fg` |

### 6. `Estimated Move` card — Part E

Four `Tile`s in `grid-cols-2 gap-2.5 sm:grid-cols-4`:

| Tile | Value | Colour | Token |
|---|---|---|---|
| `Close` | `val(data.close)` | `CAL.previous` | `--color-cal-previous` `#c0c5c3` |
| `EM` | `val(data.em)` | `T.orange` | `--color-warn` `#ffd166` |
| `Up` | `val(data.up)` | `MOVE_UP` | `--color-move-up` `#4d8cff` |
| `Down` | `val(data.down)` | `MOVE_DOWN` | `--color-move-down` `#ff6b7a` |

> v2 was a fixed `repeat(4,1fr)` at every width, rescued on narrow screens only by `globals.css`'s GLOBAL GRID COLLAPSE — **which v3 does not have**.
> Two columns below 640px is the explicit replacement.

Under the tiles, when `winRate != null`, the **EM Hit Rate** block:

```
winPct = Math.round(winRate.hit_rate * 100)
losses = winRate.evaluated - winRate.hits
```

* `{winPct}% Hit` at `text-xl` in `hitRateColor(winPct)`.
* A three-part legend: `Miss ({losses})` · `{winPct}%` · `Hit ({winRate.hits})`, `text-2xs text-fg`.
* A 1px-tall rounded track (`alpha(T.text, 0.1)`) filled to `{winPct}%` with `linear-gradient(90deg, MOVE_DOWN, MOVE_DOWN, MOVE_UP)` and
  `transition-[width] duration-500`. *"Three stops, two of them the same colour, so the bar stays 'miss' for its first half and only then ramps. v2's
  shape, v3's colours."*

### 7. `Buy Zone` / `Sell Zone` — Part F

Two `Card`s in `grid-cols-1 gap-3.5 sm:grid-cols-2`, each with `style={{ borderColor: alpha(color, 0.25) }}` and a coloured title.

| Card | Colour | Hint |
|---|---|---|
| `Buy Zone` | `MOVE_UP` | *Support area — bias long while price holds above.* |
| `Sell Zone` | `MOVE_DOWN` | *Resistance area — bias short while price stays below.* |

Each holds two `ZoneLine`s — `Near` (`val(data.buy_near)` / `val(data.sell_near)`) and `Far` (`val(data.buy_far)` / `val(data.sell_far)`). Both are
`font-mono text-xl font-bold` in the zone colour; **`Far` carries `opacity-70`**. Each line has a `border-t border-line` above it.

### 8. `Pivot` card

```
PIVOT. v2 fetches it, merges it, tests it in the zones fallback — and renders it
nowhere; the styles for it are still in the file, wired to nothing. Brandon,
2026-08-31: keep it. The data was always on the wire; now it is on the screen.
2026-09-07: it was a bare line floating between the zone row and the averages —
it is a Card like everything else on the page now.
```

A `Card` titled `Pivot` containing one plate labelled `Weekly Pivot` with `val(data.pivot)` in `font-mono text-xl font-bold text-fg`.

Note `pivot` is also load-bearing in the **zones fallback test** (`const hasZones = row.buy_near || row.sell_near || row.pivot`), which is why it was
fetched in v2 even though it was never drawn.

### 9. `vs Historical EM Average` card — Part G

Returns `null` entirely when `!emStats || (recentAvg == null && midAvg == null)`.

Two `avgTile`s in `grid-cols-1 gap-2.5 sm:grid-cols-2`: `vs 4-Wk Avg` (`emStats.recentAvg`) and `vs 12-Wk Avg` (`emStats.midAvg`).

```
emVal  = emNumber(data.em)              ← comma-stripped
diff   = emVal − avg
pct    = (diff / avg) × 100
arrow  = diff > 0 ? '▲' : '▼'
colour = diff > 0 ? MOVE_UP : MOVE_DOWN
label  = `{name} ({avg.toLocaleString('en-US', { maximumFractionDigits: 2 })})`
value  = `{arrow} {Math.abs(pct).toFixed(1)}%`
```

A tile with no usable pair renders `--` at `text-base`.

> The arrow means **"this week's EM is WIDER than its average"**, not "good". Green on a bigger expected move is v2's choice; kept so the two pages
> cannot disagree while both are up.

Below the tiles, when `sampleSize > 0`: `Based on {n} week{s} of recorded data`, `text-2xs uppercase tracking-widest text-fg`.

### 10. `Recent Track Record` card — Part H

Returns `null` when `recentRec` is absent. Two plates in `grid-cols-1 gap-2.5 sm:grid-cols-2`:

* **`Last Week ({rec.lastLabel})`** — the parenthetical is dropped when there is no label. Value is `HIT` or `MISS` in `font-mono text-xl font-bold`,
  coloured `MOVE_UP` / `MOVE_DOWN`. Border `alpha(resultCol, 0.3)`. > A null result renders MISS — **the test is `=== "hit"`**. v2's.
* **`Last {rec.last5Total} Wk{s} Hit %`** — `{pct}%` in `hitRateColor(pct)`, plus `{last5Hits} / {last5Total} hit` underneath at `text-2xs`. Border
  `alpha(pctCol, 0.3)`. `pct = last5Total > 0 ? round(last5Hits / last5Total × 100) : 0`.

The record itself is built by walking the alias-merged tracker rows:

```ts
const evaluated = rows.filter(r => r.result === 'hit' || r.result === 'miss')
const newest = evaluated[0]           // bound, not indexed twice
const last5 = evaluated.slice(0, 5)
```

> Bind the newest row rather than indexing twice: under `noUncheckedIndexedAccess` an index read is `T | undefined` however sure the length check above
> made us, and the binding is what narrows it.

Note `last5Total` is the **number of evaluated rows available**, capped at 5 — so the card can legitimately read `Last 3 Wks Hit %`.

### 11. Disclaimer

`Levels are published weekly and are informational only — not financial advice.` — `text-center text-xs leading-relaxed text-fg`.

---

## Every derived number

| Number | Formula | Unit | Source |
|---|---|---|---|
| `Close` | printed raw | price string | `/api/levels.close` |
| `EM` | printed raw | points | `/api/levels.em` |
| `Up` | printed raw | price | `/api/levels.up` (server-computed `close + em`) |
| `Down` | printed raw | price | `/api/levels.down` |
| `Buy Near` / `Buy Far` | printed raw | price | `/api/levels` or `/api/em-zones` |
| `Sell Near` / `Sell Far` | printed raw | price | same |
| `Weekly Pivot` | printed raw | price | same |
| EM Hit Rate % | `round((histHits + liveHits) / (histTotal + liveEval) × 100)` | % | `/api/em-tracker` summary + `/api/em-tracker/history` tallies |
| `Miss (n)` | `winRate.evaluated − winRate.hits` | weeks | derived |
| `vs 4-Wk Avg` | `((emNumber(em) − recentAvg) / recentAvg) × 100`, printed `\|·\|` to 1dp with ▲/▼ | % | `/api/em/ticker-em-stats` |
| `vs 12-Wk Avg` | same against `midAvg` | % | same |
| `Based on n weeks` | `emStats.sampleSize` | weeks | same |
| Last week HIT/MISS | `rows[0].result === 'hit'` over rows filtered to `hit`/`miss` | — | `/api/em-tracker?ticker=` (per alias) |
| Last N Wks Hit % | `round(last5Hits / last5Total × 100)`, `last5 = evaluated.slice(0, 5)` | % | same |
| `hitRateColor(pct)` | `≥65 → MOVE_UP`, `≥50 → CAL.medium`, else `MOVE_DOWN` | — | both thresholds are **v2's, to the number** |

### The formatters

```ts
val(v)        → '--' for null / undefined / '', otherwise the RAW STRING
emNumber(v)   → parseFloat(v.replace(/,/g, '')) or null
fmtUpdated(t) → "Aug 28, 04:19 PM"
```

`fmtUpdated` is **browser-local, not ET** — *"v2's behaviour, kept so the two pages agree while both are up. An unparseable timestamp renders as '',
which leaves the bare word 'Updated' on screen; also v2's."*

`val()` never parses. Every price on the page is the server's formatting, printed through unchanged — which is why thousands separators appear exactly
as the publisher wrote them and why `emNumber` exists for the one place a number is genuinely needed.

### `trackEmLookup`

Fire-and-forget, `sendBeacon` when available, `fetch(..., { keepalive: true })` otherwise, body `{ ticker, event: 'click', source: 'em' }` to
`/api/ticker-event`. *"Never blocks, never throws — transcribed from v2's `lib/trackTicker.ts` rather than imported, because v3 imports nothing from
the v2 tree."*

It fires **only after data has come back**: *"so lookups that find nothing do not skew the counts."*

---

## Weekly EM vs the DAILY band — the contrast

Two numbers, two modules, two questions. They must never be read as one figure printed twice, and both files say so.

### The weekly band — this page

| | |
|---|---|
| Source | `/api/levels` (+ `/api/em-zones` fallback), `src/pages/em/emData.ts` |
| Cadence | **published once a week** by a server-side publisher |
| Anchored to | `close` — the prior week's close |
| Shape | `close`, `em`, `up`, `down`, `buy_near/far`, `sell_near/far`, `pivot`, `exp_label` |
| Units | formatted **strings** with thousands separators |
| Evaluated against | that **week's** high and low, by `em_tracker` → the HIT/MISS record |
| Consumers | `/em`, `/m/em`, and the GEX matrix's `emStrikes` (which reads only `close` + `em` from `/api/levels`) |
| Stale window | `LEVELS_STALE_MS = 10_000` |
| Poll | none |

The GEX matrix (`/options-chain`) uses **this** number: `useChainData` reads `/api/levels?ticker=…`, keeps it only when both `em > 0` and `close > 0`,
and snaps `close ± em` and `close ± 2·em` onto visible strikes for its `EM ±1σ` / `EM ±2σ` rail tags — **and only for current-week expirations**
(`isCurrentWeekExp`), because *"The stored weekly EM only applies to current-week expirations."*

### The daily band — `src/data/dailyEm.ts`

The header opens by drawing the line explicitly:

> **This is NOT the ±1σ the GEX Chart's stat tiles show.** Those read `/api/em-tracker`: the WEEKLY band, published once a week and evaluated against
> that week's high and low. This is the **DAILY** one — the front expiry's ATM straddle, anchored to the **PREVIOUS SESSION'S CLOSE**. Two different
> questions, two different numbers, and anything drawing this one labels it so the pair can never be read as one figure printed twice.

| | |
|---|---|
| Source | `/api/daily-em?ticker={SYM}[&date={ISO}]` |
| Cadence | **frozen per ET session**, server-side (`server-v2/daily-em.js`) |
| Anchored to | `refClose` — the **previous session's** close |
| Shape | `{ date, refClose, em, up, down, expiry, method, recordedAt }` — all **numbers** |
| `method` | `'straddle'` on a 0DTE book, `'iv'` when there was time left to price |
| Stale / poll | `DAILY_EM_STALE_MS = 300_000`, `DAILY_EM_POLL_MS = 300_000` |
| Consumers | the GEX Candles card's price rails — **not this page** |

Three things about it that matter to anyone comparing the two:

* **Nothing is computed client-side, and it cannot be.** *"The band is computed and FROZEN server-side: the first read of an ET session writes the
  row, every read after that is served from it. That is deliberate and it is the whole feature — a band recomputed client-side would drift all session
  as the straddle decays, so two traders looking at the same chart at 10:00 and 14:00 would be looking at two different lines and the earlier one
  could never be referred back to. **'Price rejected the EM high' has to mean something an hour later.**"*
* **There is no fallback.** *"Neither the socket's GEX rows nor the candles carry an IV or a mark, so there is no straddle on the client to price. No
  row, no rails — which is the honest answer, not a degraded one."*
* **The 5-minute poll is not about staleness.** *"The row does not change once written. The poll exists so the FIRST read of the day — which is what
  writes it — actually happens on a board that was left open overnight, rather than the chart sitting rail-less until somebody reloads."*

`parseDailyEm` requires **all four** of `refClose`, `em`, `up`, `down` to be finite and positive, or it returns `null`: *"A row carrying a magnitude
but no anchor is not a band that can be drawn — **half a level is worse than none, because it still looks like a level**."*

And the `date` parameter is **read-only by construction**: *"a past band cannot be reconstructed from a live chain, so the route never writes one. A
replayed session that predates the table therefore answers with no band, and the chart draws no rails — which is right. Drawing TODAY's band over a
rewound Tuesday would be a level that is simply false, and false is worse than absent."*

`useDailyEm(symbol, enabled, date)` passes a **null URL** when disabled — *"which is what stops the request from firing at all rather than firing and
being thrown away."*

### `src/data/levels.ts` — a third thing that shares the word

Not an expected move at all. This module derives the **GEX levels** — call wall, put wall, CORE (Core Bullseye) and the gamma flip — as **pure
functions of `(rows, spot)`**. It is in this doc only because "levels" is an overloaded word in this codebase and `/api/levels` (the weekly EM row) is
a completely different endpoint from anything here.

Why it exists:

> This module exists because there were three of each. Home's Key Levels card, the Premarket rail and the non-SPX chain path each derived the call
> wall, the put wall, the CORE and the gamma flip their own way, off the same feed, and then printed them under the same labels — so the board could
> show CORE 7,680 beside a premarket rail showing CORE 7,650, and **a put wall ABOVE spot**.

Points of contrast worth holding next to the EM page:

* **The basis is OI+VOL, always.** `oiVolNet(r) = netGEX + netVolGEX`. *"That is the server's `oiVolNet()`, the heatmap's NET GEX column and the
  chart's default toggle, so the levels land where the bars say they should."*
* **Spot is passed in, not taken from the frame.** *"server-v2 computes callWall / putWall / gexFlip against the spot it held when it built the `gex`
  frame. Pages then drew those numbers against the newest `spot` frame, which ticks several times a second… on a fast move a wall crossed to the wrong
  side of price — a put wall printed ABOVE spot, which `findPutWall` cannot produce and which is how the mismatch was first spotted."*
* **CORE is the WHOLE chain, not a window.** Two definitions lived under one label; the windowed one *"is the unstable one — its edges move with
  price, so a node can enter and leave the running on a quote rather than on any change in positioning, and the CORE appears to jump twenty points
  while nothing happened."*
* **`exclude` keeps CORE and the call wall from collapsing onto one strike**, *"which is the level price actually has to get through after the core."*
* **The flip has a four-rung preference order** — `profileFlip` (the Black-Scholes spot-sweep zero) → `findGEXFlip` (per-strike sign change) →
  `findCumulativeFlip` (the zero crossing **nearest spot**) → the server's own value. *"The order matters more than any one entry: whichever rung
  answers, BOTH surfaces get that same rung, which is the whole point of this module."*
* `findCumulativeFlip` returns `null` more often than it looks like it should — *"the test is an UP crossing (`prevCum < 0 && cum >= 0`), and on a
  positive-gamma board the running total never dips below zero… That is a real state, not a failure."*
* **⚠ FLOW is not a level basis.** *"A wall is a place the standing or traded book puts gamma, and the dealer's signed tape inventory is a different
  quantity that happens to share a unit."*

None of `levels.ts` runs on `/em`.

---

## Every control

| Control | What it does | Default | Where the state lives |
|---|---|---|---|
| Ticker input | free text; uppercased and trimmed on submit | `?ticker=` from the URL, else `''` | React state (`input`) — **not** persisted |
| `Get Levels` / form submit | `submit(raw)` → `setParams({ ticker })`, and directly re-runs when the ticker is unchanged | — | **the query string** (`?ticker=SPX`) is the source of truth |
| `POPULAR` chips (×10) | `submit(s)` for that symbol | `SPX NDX ESU NQU SPY QQQ AAPL NVDA TSLA MSFT` | same |
| Browser back / forward | changes `?ticker=`, which re-runs the lookup | — | the query string, *"which also makes back/forward work for free"* |

That is the entire control surface. **Nothing on this page is stored in `localStorage`, and nothing is stored server-side** — the only persistence is
the URL.

### The re-submit rule

```ts
const submit = (raw: string) => {
  const sym = raw.trim().toUpperCase()
  if (!sym) return
  if (sym === lastRun.current) void run(sym)   // ← the effect will not fire
  setParams({ ticker: sym })
}
```

> A re-submit of the SAME ticker leaves the query string untouched, so the effect above will not fire — re-run it directly, the way v2's button did.

The URL-watching effect is:

```ts
useEffect(() => {
  if (urlTicker && urlTicker !== lastRun.current) void run(urlTicker)
}, [urlTicker, run])
```

`lastRun` is set at the **start** of `run()`, not at the end, so the effect cannot double-fire on its own write-back.

The board symbol from `data/symbol.tsx` is **not** used here. `/em` is the one page in this doc set with its own ticker box, and that is why the phone
shell gives it `chrome="bare"` (see below).

---

## Rendering and design tokens

### No canvas, no socket, no chart

*"This page opens no socket and mounts no canvas: it is REST-only, so non-negotiables 4, 5 and 6 have nothing to bite on here."* No `ChartFrame`, no
`data-cb-layer`, no `watchFrame`, no `useField`. Everything is Tailwind utilities over v3's token classes plus a handful of inline `style` objects for
the computed colours.

### The shared bits

```ts
/** v2's stat plate: a sunken well inside a card. */
const PLATE: CSSProperties = { background: alpha(T.bg, 0.6) }

// Labels were `text-muted opacity-70`. Brandon, 2026-09-07: "make gray font
// white" — the plate labels, hints and stamps on this page are all text-fg now.
const LABEL = 'mb-1.5 text-2xs font-bold uppercase tracking-widest text-fg'
```

`Tile` is `rounded-md border border-line px-2 py-3 text-center` + `PLATE`, with the `LABEL` above and a `font-mono text-xl font-bold` value in the
tile's colour.

The **2026-09-07 "make gray font white"** pass is the same instinct as `/chain`'s 2026-09-08 `INK` rule: on the dark-slate surfaces a dimmed label
reads as smudged rather than as secondary. Every label, hint, stamp and count on `/em` is `text-fg`.

### Token table

| Used as | theme export | Token | Hex in `tokens.css` |
|---|---|---|---|
| `Close` tile | `CAL.previous` | `--color-cal-previous` | `#c0c5c3` |
| `EM` tile | `T.orange` | `--color-warn` | `#ffd166` |
| `Up`, Buy Zone, `HIT`, `≥65%` | `MOVE_UP` | `--color-move-up` | `#4d8cff` |
| `Down`, Sell Zone, `MISS`, `<50%`, the error banner | `MOVE_DOWN` | `--color-move-down` | `#ff6b7a` |
| `50–64%` hit rate | `CAL.medium` | `--color-impact-medium` | `#ffd166` |
| Buttons and chips (`text-accent`, `border-accent`) | `T.cyan` | `--color-accent` | `#2f6bff` |
| All text | `text-fg` | `--color-fg` | `#e7ece9` |
| Card / plate borders | `border-line` | `--color-line` | `#1e2630` |
| The sunken plate | `alpha(T.bg, 0.6)` | `--color-bg` @ 60% | `#0a0d10` |
| The hit-rate track | `alpha(T.text, 0.1)` | `--color-fg` @ 10% | — |

Note `CAL.medium` and `T.orange` resolve to the **same hex** (`#ffd166`) today, via `--color-impact-medium` and `--color-warn`. They stay separate
tokens: the EM tile is a magnitude, the 50–64% band is an impact rung.

Type sizes all come from the scale: `text-2xs` 10px, `text-xs` 11px, `text-sm` 13px, `text-base` 15px, `text-xl` 24px, `text-2xl` 32px.

### Layout constants and breakpoints

| Constant | Value |
|---|---|
| Column max width | `max-w-[720px]`, centred, `gap-4`, `pb-12` |
| Logo | `h-36` (144px), `-mb-4` |
| Tile grid | `grid-cols-2` → `sm:grid-cols-4` (EM), `grid-cols-1` → `sm:grid-cols-2` (zones, averages, record) |
| The `sm:` breakpoint | Tailwind's **640px** — the explicit replacement for v2's global grid collapse |
| Hit-rate bar | `h-1`, `transition-[width] duration-500` |
| Card | `expandable={false}` on **every** card on this page |

### Per-frame / perf machinery

There is none, and there is nothing to have: no animation frame, no interval, no observer, no virtualisation. The only memo is `shotTargets`, and that
exists for a correctness reason rather than a performance one (see below). The page repaints when a lookup lands and not otherwise.

### The CopyShot target

```ts
const shotTargets = useMemo<CopyShotTarget[]>(
  () => snap && data && !loading
    ? [{
        id: 'em:result',
        icon: '↔️',
        label: 'Estimated Move',
        group: 'This page',
        meta: `${data.label || sym}${data.exp_label ? ` · Week of ${data.exp_label}` : ''}`,
        file: `em-${sym}`,
        resolve: () => shotRef.current,
      }]
    : NO_TARGETS,
  [snap, data, loading, sym],
)
useCopyShotTargets(shotTargets)
```

* **One target**, spanning the result block — *"v2 captured 'from the result header down' — ticker, week, stamp, then every card. Same span here."*
* **Nothing is published until a lookup has landed**, *"so the menu never offers a shot of the empty state."*
* `NO_TARGETS` rather than `[]` is required by the CopyShot contract: *"an array literal every render republishes on every render."*
* `meta` supplies the caption tail — this page has **no** `data-capture-meta` attribute, so the target's `meta` field is what names the ticker and the
  week under the PNG. *"Same caption shape every card uses: name · time · ticker · week."*
* `file` names the download `em-{SYM}`.

---

## Replay behaviour

**There is none.** `/em` has no replay transport, no `ReplayDock` mount, no `ReplayStamp`, no `/replay` tab, and no date control of any kind. It
always shows the **current** published week.

The nearest thing to a historical view is the Recent Track Record card, which is a *record of outcomes*, not a rewind of the page — and the daily band
module (`dailyEm.ts`) does accept a `date` parameter for past sessions, but that is **read-only by construction** and is consumed by the GEX Candles
card, never here.

---

## Phone behaviour

`/em` is one of the six tabs in the phone build, and the **only** page in this doc set that has one.

```ts
{ id: 'em', path: '/m/em', label: 'Moves', title: 'Estimated Moves', icon: '↔️' }
```

`src/mobile/pages/MEm.tsx` is 21 lines and the whole of it is:

```tsx
export default function MEm() {
  return (
    <MobileShell chrome="bare">
      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <Em />
      </Suspense>
    </MobileShell>
  )
}
```

with the reasoning above it:

> The v3 page, unchanged. It is already a single 720px-max column that scrolls, which is a phone layout that happens to also work on a desktop, and it
> carries its OWN ticker box — so the shell adds no header and no symbol control here. **Both would be a second way to set the same thing.**

That is `chrome="bare"` doing its job. From `MobileShell.tsx`:

> `chrome="bare"` is the other case: `/m/em` renders a v3 PAGE, which already draws its own chrome. It gets no Card at all — **an outer header over a
> page that has one is the same doubled bar seen from the other side.**

Other phone facts that apply:

* `DESKTOP_TO_MOBILE` maps **`'/em': '/m/em'`**, so a phone opening `/v3/em` is `replace`d to the tab. `MOBILE_TO_DESKTOP` maps `'/m/em': '/em'` for
  the long-press "Desktop site" action.
* The session opt-out lives in `sessionStorage` under **`cb-v3-force-desktop`** — *"it is an escape hatch for one look at the full board, not a
  setting."* Both read and write treat a private-mode throw as "off".
* `Shell.tsx` drops the rail and the toolbar on `/m/*`, and hides the board's `SPX` chip and `TickerPicker` there. Neither matters to this page, since
  it never reads the board symbol.
* The page's own responsive rules — `grid-cols-2 sm:grid-cols-4`, `grid-cols-1 sm:grid-cols-2`, `flex-wrap` on the form and the chip row,
  `min-w-[200px] flex-1` on the input — are what make the desktop component work unchanged at 390px. The **two-column EM tile grid below 640px is the
  explicit replacement** for v2's global grid collapse.
* A hard refresh on `/v3/m/em` is answered by `app/v3/m/[tab]/route.ts` in the v2 repo — one dynamic segment, *"deliberately not a catch-all under
  `/v3`, which would swallow `/v3/assets/*.js` and hand back HTML."*

The `/m/em` tab is the reason `/em` must stay a single narrow column. Widening it, or adding a sidebar, breaks the phone tab silently.

---

## Status and empty-state messages, verbatim

| When | Message | Where / styling |
|---|---|---|
| Nothing looked up yet | `Enter a ticker above to view its weekly levels.` | `py-10 text-center text-sm text-fg` |
| While a lookup is in flight | `Loading…` | the submit button's label; the body shows nothing |
| Idle submit label | `Get Levels` | the submit button |
| `/api/levels` was not OK | `Lookup failed` | error banner, `MOVE_DOWN` |
| No published row **and** no on-demand zones | `No levels published for {SYM} yet.` | error banner |
| Any other thrown non-`Error` | `Lookup failed` | the `catch` falls back to this string |
| A missing level value | `--` | `val()` — every tile, zone line and the pivot |
| A historical-average tile with no usable pair | `--` | `text-base text-fg` |
| Last week with a null result | `MISS` | **the test is `=== 'hit'`** |
| `updated_at` unparseable | `Updated ` (the bare word, no date) | `fmtUpdated` returns `''` — v2's behaviour |

Header / card titles, verbatim:

* `Weekly Estimated Move & Zones`
* `Enter a ticker to see this week's estimated move and the buy / sell zones.`
* `Estimated Move` · `EM Hit Rate` · `{n}% Hit` · `Miss ({n})` · `Hit ({n})`
* `Buy Zone` / `Support area — bias long while price holds above.`
* `Sell Zone` / `Resistance area — bias short while price stays below.`
* `Near` · `Far`
* `Pivot` / `Weekly Pivot`
* `vs Historical EM Average` · `vs 4-Wk Avg ({avg})` · `vs 12-Wk Avg ({avg})` · `Based on {n} week(s) of recorded data`
* `Recent Track Record` · `Last Week ({label})` · `Last {n} Wk(s) Hit %` · `{n} / {n} hit`
* `Week of {exp_label}` · `Updated {stamp}`
* `Levels are published weekly and are informational only — not financial advice.`

The `/api/em-zones` route's own `{ error }` body is **never shown** — `fetchZones` converts it to `null` and the caller decides what to say.

---

## Performance and bundle

* **The route is `lazy()`** in `App.tsx` (rule 1: *"A route that is in the entry chunk is a route every user downloads whether they visit it or
  not."*). `App.tsx`'s own note: *"`/em` — Estimated Moves. A 1:1 port of v2's `/app/em` against the checklist in `docs/parity/em.md`; REST-only,
  opens no socket, mounts no canvas."*
* **`/m/em` re-uses the same chunk.** `MEm.tsx` `lazy()`s `@/pages/Em`, so the phone tab's own chunk is *"layout and nothing else"* — the same pattern
  the rest of the phone build uses (*"a fix to a card is a fix to the phone"*). A user who has visited `/em` arrives at `/m/em` with it cached, and
  vice versa.
* **This is the lightest route in the tree.** No chart library, no canvas, no socket binding, no data table. Its dependencies are React, the router,
  `api.ts`, two primitives and the theme.
* `budgets.json` (brotli bytes) — measured against **`route: 59100`**:

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

  *"These are set close to current reality on purpose — a budget with 4x headroom enforces nothing."* `npm run budgets:ratchet` pulls them back down.
  A route this small is precisely the case the SLACK report exists for, and `enforce: false` keeps that report from failing a commit.
* `budgets.json`'s `perf` block (`idleRepaintsPerFrame 0.15`, `offscreenRepaints 0`, `interactionRepaints 10`) counts repaints on canvases tagged
  `data-cb-layer`. **This page owns none.**
* **`theme-baseline.json` lists neither `src/pages/Em.tsx` nor `src/pages/em/emData.ts`.** Both are at **zero** recorded violations of non-negotiable
  #1 and *"can never regress"* — no colour literals, no Tailwind palette shades, no off-scale type sizes. That is what the 2026-08-31 palette re-key
  bought: every one of v2's five hardcoded hexes is now a token.
* The only avoidable cost in a lookup is the **six parallel requests** (levels, zones-if-needed, stats, tracker summary, tracker history, and one
  tracker-rows request per alias — two for ESU/NQU). All but the levels read are individually `catch`-swallowed and all carry a 60 s stale window, so
  a chip-hopping session mostly hits the `api.ts` cache.
* The one removed cost is `/api/confidence` — *"the most expensive request in the set — a **120-session server-side scan per lookup**, for a value
  that was thrown away."*

---

## Gotchas

1. **EM values are comma-formatted STRINGS.** `parseFloat("7,711.76")` is **7**. Use `emNumber()`, always. The `Levels` interface types every numeric
   field as `string | null` precisely so a bare `parseFloat` looks wrong at the call site.
2. **`val()` prints the raw string and never parses.** Every price on the page is the publisher's own formatting. Do not "normalise" it.
3. **`total` vs `evaluated`.** The history JSON says `total`, the live tracker table says `evaluated`. *"Reading one for the other is silent and
   produces a plausible wrong number."*
4. **On-demand zones WIN over the published row.** `data = { ...data, ...zones }` — that is v2's merge order and the fallback test (`buy_near ||
   sell_near || pivot`) depends on it.
5. **`pivot` participates in the zones test even though v2 never drew it.** Remove it from the test and a row carrying only a pivot stops triggering
   the on-demand zones fetch.
6. **ESU can legitimately show a hit rate and no historical average in the same render.** `/api/levels` aliases server-side, `/api/em-tracker` is
   aliased client-side by `TRACKER_ALIASES`, and `/api/em/ticker-em-stats` does **no** aliasing at all. That asymmetry is v2's and is deliberately not
   papered over.
7. **A `null` last-week result renders `MISS`.** The test is `=== 'hit'`. v2's behaviour; do not "fix" it to render a third state without changing v2
   too.
8. **Tracker rows are sorted lexicographically on `week_start ?? week_label`.** That is correct only because `week_start` is ISO `YYYY-MM-DD`; *"the
   `week_label` fallback ('8/28') sorts wrongly. **v2's behaviour and v2's latent bug, transcribed rather than quietly fixed.**"*
9. **`last5Total` is the number of evaluated rows available, capped at 5** — so `Last 3 Wks Hit %` is a legitimate label, not a bug.
10. **The enrichment wave must stay AHEAD of the levels await.** Moving it below the `await` silently reintroduces v2's two-stage waterfall and breaks
    non-negotiable 3.
11. **`LEVELS_STALE_MS = 10_000` is what makes `NAV.prefetch` pay.** Set it to 0 (or switch to `cache: 'no-store'` like v2) and the rail's
    `preload('/api/levels?ticker=SPX')` becomes a request nobody reads.
12. **`lastRun` is set at the START of `run()`.** That is what stops the URL effect from double-firing on its own `setParams` write-back, and what
    makes the same-ticker re-submit path necessary.
13. **A same-ticker re-submit does not change the URL**, so it must call `run()` directly. Remove that line and pressing `Get Levels` twice does
    nothing.
14. **`seq` guards the success path, the error path AND the `finally`.** A slow lookup resolving after a fast one must not clear `loading` for the
    newer request either.
15. **`/api/confidence` must not be re-added** until the route returns a **scalar**. It never rendered, on any surface, ever, and it cost a
    120-session scan per lookup.
16. **`trackEmLookup` fires only after data lands**, so failed lookups do not skew the counts. It must never throw and must never be awaited.
17. **`fmtUpdated` is browser-local, not ET.** That is v2's behaviour, kept on purpose. An unparseable stamp leaves the bare word `Updated` on screen
    — also v2's.
18. **The weekly EM and the daily EM are different numbers.** `/api/levels` (weekly, published, anchored to last week's close) vs `/api/daily-em`
    (daily, frozen per session, anchored to the previous session's close, from the front expiry's ATM straddle). Anything drawing one must label it.
    Never put them in the same tile group.
19. **The daily band cannot be recomputed on the client and must never be.** *"A band recomputed client-side would drift all session as the straddle
    decays… 'Price rejected the EM high' has to mean something an hour later."* And there is no IV or mark on the socket to price one from anyway.
20. **`parseDailyEm` requires all four prices.** *"Half a level is worse than none, because it still looks like a level."*
21. **`/api/daily-em?date=` never writes.** A rewound session that predates the table gets no band, and that is correct — *"false is worse than
    absent."*
22. **`src/data/levels.ts` is a different concept entirely** despite the name collision with `/api/levels`. It derives call wall / put wall / CORE /
    flip from GEX rows, always on the **OI+VOL** basis, always against the **spot on screen**. FLOW is not a level basis there.
23. **The EM tile grid must keep its `sm:` step.** v2 relied on a global grid collapse in `globals.css` that v3 does not have; `grid-cols-2
    sm:grid-cols-4` is the explicit replacement and is what keeps `/m/em` readable at 390px.
24. **Do not add a header or a symbol control to `/m/em`.** `chrome="bare"` is deliberate: the page carries its own ticker box, and a shell header
    over it is *"the same doubled bar seen from the other side."*
25. **Do not widen the 720px column.** `/m/em` is the same component; the narrow column is the phone layout.
26. **`NO_TARGETS`, not `[]`, when there is nothing to photograph.** A fresh array literal republishes the CopyShot registry on every render.
27. **The green ▲ on the historical-average tile means "wider than average", not "good".** It is v2's choice and is kept so the two pages cannot
    disagree while both are up.
28. **Step 4 of "Adding a page" applies here too.** `app/v3/em/route.ts` must exist in the v2 repo calling `serveSpaShell("v3")`, or
    `/v3/em?ticker=NVDA` — which is exactly the shareable link the 2026-08-31 URL change exists to create — **404s on a cold open**.
