# `gauge-rail` — Gauge Rail · 🎚️ · default 48 × 20 · `src/board/gaugeRail/`

> Catalog entry: `src/board/catalog.tsx:212-226`. `id: 'gauge-rail'`,
> `icon: '🎚️'`, `label: 'Gauge Rail'`, `defaultSize: { w: 48, h: 20 }`, lazy
> behind `<Deferred>`.
>
> The catalog comment explains the footprint: *"v2's home-page gauge strip, minus
> its IB Direction tile. A one-row card: w 12 / h 5 is the strip shape it is
> drawn for — five tiles sharing the full board width, tall enough for a label, a
> meter, a value and its 15-minute change line and no taller."* The numbers in
> that sentence are the pre-doubling units; the grid has been doubled twice
> (12/32 → 24/16 → 48/8), so `48 × 20` is the same card it always was.
>
> No `Title` component — the header is the plain catalog label; the card's own
> toolbar adds `OI+VOL` and `SPX · 9-19-26`.

---

## What it is, in one paragraph

The Gauge Rail is a single row of five segmented LED meters, side by side, across
the full width of the board. Each one is a label, a 30-segment bar, a value and a
small "▲ $0.42B / 15m" change line underneath. Between them they answer five
questions about the option book right now: how much net dealer gamma there is,
how much net dealer delta, what share of today's *traded* gamma is call-side, how
fast gamma is being added or pulled, and how much net gamma has changed in the
last fifteen minutes. It is v2's home-page segmented-LED strip carried into v3 as
a board card, and the one structural difference is that v2 draws six tiles where
this draws five — the sixth, IB Direction, was dropped at Brandon's request
(2026-09-03) and its removal is what makes this a single-source card: *"every
number below comes from ONE gex frame plus that frame's own history."*

---

## File map

| File | Lines | What it owns |
|---|---:|---|
| `src/board/gaugeRail/GaugeRailCard.tsx` | 699 | Everything: the frame reducer (`readSnap`/`sameSnap`), the history model (seed + live buckets), all five derived readings, all four meter scales, the ring-buffer hook, the SVG meter, the formatters, the tiles and the card shell. |

There is no second file. Unlike the GEX Chart (six files) or Key Levels (three),
the Gauge Rail is one module.

Supporting modules it reads:

| File | Lines | Why it matters here |
|---|---:|---|
| `src/board/gexChart/values.ts` | 324 | `netGexOf` and `dexOf` — the shared per-strike accessors. |
| `src/data/hooks.ts` | 75 | `useField` — a *derived-value* subscription that re-renders only on change. |
| `src/data/api.ts` | 239 | `useQuery` for the one seed request. |
| `src/contract/frames.ts` | 258 | `GexFrame` / `GexRow`, including the optional `netDEX` / `volNetDEX` legs. |
| `src/design/theme.ts` | 471 | `T.*`, `alpha()`, `GEX_POS`, `GEX_NEG`. |
| `src/board/gexCandles/gexHistory.ts` | — | `etDay(ts)` — `YYYY-MM-DD` in America/New_York. |
| `src/board/cardTitle.tsx` | 50 | `fmtContractDate` — `2026-09-19` → `9-19-26`. |
| `src/data/symbol.tsx` | 111 | `SOCKET_SYMBOL = 'SPX'`. |
| `src/data/calculations.ts` | 455 | Not imported. Its `ChainRow`/`callGEXOf`/`putGEXOf` family is the *server-parity* definition the shared accessors were transcribed from. |

---

## The data path

### It is SPX, always

There is no page-symbol hook here. The card hard-codes `SOCKET_SYMBOL` in its
toolbar and its capture meta, and reads the `gex` frame directly. The `gex` topic
carries exactly one underlying, and the card has no chain fallback — unlike the
GEX Chart and Key Levels, which both have a `/api/chains` path. Change the board
ticker to AMZN and this card still shows SPX, and says `SPX` on its face.

### 1. The `gex` WebSocket frame — the live half

```ts
const snap = useField<GexFrame, Snap | null>('gex', readSnap, sameSnap)
```

`useField`, not `useFrame`: `useFrame` "re-renders on every message for that
type; `useField` re-renders only when the value you actually read changes, which
for a 10Hz feed rendering a price to 2dp is a large difference"
(`src/data/hooks.ts:264-271`). The card is a DOM card, not a canvas, so it takes
the React path rather than `watchFrame`.

Fields read off `GexData`: `gexRows`, `updatedAt`, `expiry`. **Not** `totals`.

### Why not `totals` — the wire-contract rule

v2's rail reads the socket's `totals` blob (`totalGEXOiVol`, `totalDeltaOiVol`,
…). v3's `GexData.totals` is typed `unknown`, and

> "nothing in src/ may reach for a field `contract/frames.ts` does not carry."

So the rail sums the ROWS instead, through the same accessors the GEX Chart card
and its ten stat tiles use:

```
GEX = Σ netGexOf(r, 'oi-vol', false) = Σ (netGEX + netVolGEX)
DEX = Σ dexOf(r, 'oi-vol')           = Σ (netDEX + volNetDEX)
```

> "That is not a reinterpretation. It is the identical definition server-v2's own
> `greeks-ts-writer.js` uses when it records the greeks series this card seeds
> itself from, so the seeded past and the live present are the same quantity —
> and the rail can never disagree with the Net GEX tile on the GEX Chart card
> sitting next to it on the board."

### 2. `/api/snapshots/greeks` — the seed

```ts
useQuery<{ rows?: GreeksRow[] }>(
  `/api/snapshots/greeks?date=${etDay(Date.now())}&limit=5000`,
  { staleMs: 600_000 },
)
```

| Property | Value |
|---|---|
| Method | GET, `credentials: 'same-origin'` (via `query()`) |
| Query params | `date` = today in ET (`en-CA`, `America/New_York`, so `YYYY-MM-DD`); `limit` = 5000 |
| `staleMs` | 600_000 (ten minutes) |
| `pollMs` | **none** |
| Shape | `{ rows: [{ timestamp, gex, dex }] }` |
| Units | `gex` / `dex` arrive **already in $B** |

No poll is deliberate: *"the socket keeps the series current, the seed only fills
in what happened before the card mounted."* Remember that `staleMs` is a cache
TTL and not an interval (`src/data/api.ts:20-27`) — with no `pollMs`, this fires
once per mount and never again except through the toolbar's `refreshAll()`.

Parse (`parseSeed`):

* `timestamp` must be `> 0` or the row is skipped entirely.
* `ts < 1e12` is treated as **seconds** and multiplied by 1000. (The same rule is
  applied to `updatedAt` on the live frame.)
* `gex` / `dex` go through `num()`, which returns `0` for anything non-finite.
* Sorted ascending by `ts`.

### Why the seed exists at all

> "Two tiles (the rate, and the 15-minute change) and two meter SCALES are
> functions of today's history, not of the current frame. Built from live frames
> alone they would read `--` for the first fifteen minutes after the card is
> added, which is most of the time anyone spends looking at a board."

### HTTP-200-on-failure

`query()` throws on any non-2xx (`` `${res.status} ${res.statusText} — ${url}` ``)
and a failed fetch is cached as an error. But this card **never reads
`seedQ.error`**: `parseSeed(undefined)` returns `[]`, so a failed seed degrades
silently to a live-only history. The visible consequence is that the Rate and
Δ15m tiles read `--` until enough live points accumulate, and the two level
meters self-scale to the live extremes alone.

A **200 carrying something that is not an array of rows** — an HTML shell, an
empty object, `{ rows: null }` — is handled by the same `Array.isArray(rows)`
guard and is likewise indistinguishable from "no history". There is no sentence
anywhere on this card that names a fetch failure.

### The merge — seed BEHIND live, never interleaved

```ts
const history = useMemo<Point[]>(() => {
  if (!seed.length) return live
  const firstLive = live[0]?.ts
  if (firstLive == null) return seed
  return [...seed.filter((p) => p.ts < firstLive), ...live]
}, [seed, live])
```

> "the recorder writes once a minute and the socket lands whenever it lands, so
> overlapping the two would put two samples of the same minute in the series and
> let a rate be computed across a span of a couple of seconds."

Live points are bucketed at `BUCKET_MS = 15_000` — one point per 15-second
bucket, the newest wins — and the array is capped at `MAX_POINTS = 1500`, which
is "a full RTH session at BUCKET_MS" (6.5 h × 240 buckets/h = 1560, so the cap
bites just before the close on a fully-attended session).

---

## Every derived number

### From one frame — `readSnap`

```ts
for (const r of rows) {
  gex         += netGexOf(r, 'oi-vol', false)          // $
  dex         += dexOf(r, 'oi-vol')                    // $
  callVolGamma += |r.callGamma| · r.callVolume         // contracts·γ
  putVolGamma  += |r.putGamma|  · r.putVolume
}
totVol = callVolGamma + putVolGamma

snap.gex         = gex / 1e9                            // $B
snap.dex         = dex / 1e9                            // $B
snap.gammaPctVol = totVol > 0 ? 100·callVolGamma/totVol : null   // %
snap.ts          = updatedAt > 0 ? (updatedAt < 1e12 ? ×1000 : as-is) : Date.now()
snap.expiry      = frame.data.expiry ?? ''
```

`readSnap` returns `null` when `gexRows` is missing or empty.

**`gammaPctVol` is v2's calculation, transcribed:** the CALL share of vol-only
gamma, weighted by **gamma × CONTRACTS, not dollar gamma** —

> "it answers 'which side is today's volume in', and weighting by spot² would
> make it drift with the index instead."

### `sameSnap` — and the timestamp that is deliberately excluded

```ts
function sameSnap(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  return a.gex === b.gex && a.dex === b.dex
      && a.gammaPctVol === b.gammaPctVol && a.expiry === b.expiry
}
```

> "⚠ `ts` is deliberately NOT compared. The gex frame carries a fresh `updatedAt`
> on every push, so a snapshot that included it would be a new object several
> times a second even when not one number on the rail had moved — and `useField`
> would re-render the card, and the effect below would append a point, on every
> frame. Comparing only the VALUES makes the rail sample on movement, and the
> timestamp it keeps is then the moment the reading last actually changed, which
> is also the honest x for a per-minute rate."

This is the single most load-bearing line in the file: it is simultaneously the
render throttle, the history sampler and the definition of the rate's x-axis.

### Tile 1 — `Gamma (Net GEX)`

* **Value** `snap.gex`, $B, `fmtB` → `+$1.24B` / `−$0.87B` (U+2212 minus).
* **Meter** signed, `midT = 0.5`.
* **Position** `signedT(v, scale) = clamp(0.5 + v/(2·scale), 0, 1)`.
* **Scale** `gexScale = max(|gex|, max over history |p.gex|)`, floored at 1.
  *"The two level meters self-scale to today's biggest absolute reading, so a
  quiet day still uses the whole meter."*
* **Colour** `GEX_POS` when `>= 0`, `GEX_NEG` when `< 0`, `T.cyan` when null.
* **Title** `Net dealer gamma across the streamed expiry, OI+VOL basis — the same total the GEX Chart card puts in its Net GEX tile`

### Tile 2 — `Delta (DEX)`

Identical machinery on `snap.dex` with its own `dexScale`.
Title: `Net dealer delta exposure — same rows, same basis as the gamma tile`.

### Tile 3 — `Gamma % 0DTE (Vol)`

* **Value** `snap.gammaPctVol`, 0–100, `fmtPct` → `63%`.
* **Meter** `kind: 'pct'`, `midT = 0`, so it fills **from the left edge** and
  draws no centre tick.
* **Position** `clamp(v/100, 0, 1)`.
* **Scale** a literal `100` (so the deadband is 1 percentage point).
* **Colour** `GEX_POS` at `>= 50`, else `GEX_NEG`.
* **Title** `Call share of today's VOLUME gamma. Above 50%, the day's traded gamma is call-side`

### Tile 4 — `Net GEX Rate / min`

The most involved number on the card.

```ts
const MIN_SPAN_MS = 30_000
const MAX_SPAN_MS = 180_000
target   = now − 60_000
eligible = history.filter(p => 30_000 <= now − p.ts <= 180_000)
if (!eligible.length) return null
atOrBefore = eligible.filter(p => p.ts <= target)
ref  = atOrBefore.length ? last(atOrBefore) : eligible[0]
span = now − ref.ts
if (!(span >= MIN_SPAN_MS)) return null
rate = ((gex − ref.gex) / (span / 60_000)) · 1000        // $B/min → $M/min
```

Units: **$M of gamma-per-1%-move per minute.**

> "Normalising rather than assuming the reference sits exactly 60s back is what
> keeps it honest: the series is bucketed and the feed's cadence drifts, so a raw
> last-minus-reference would silently scale with however stale the reference
> happened to be. A too-short span is rejected outright — dividing a small Δ by a
> few seconds manufactures an enormous rate out of feed jitter."

**The unit is millions, not billions, and that is a decision with a reason:**

> "A per-minute slice of the book is two or three orders of magnitude smaller than
> the book: in billions an ordinary minute reads `+$0.02B/m` and most of the day
> rounds to zero. Whole millions, because the sub-million digit is feed jitter
> and a fixed unit keeps the tile from twitching as the value ticks."

`fmtRate(0)` → the bare string `0M/m` (no sign, no dollar). Otherwise
`` `${v >= 0 ? '+' : '−'}$${Math.round(|v|).toLocaleString('en-US')}M/m` ``.

**Its scale is a p99, not a max:**

```ts
for each adjacent pair in history with (cur.ts − prev.ts) >= 5_000:
  perMin = (|cur.gex − prev.gex| / ((cur.ts−prev.ts)/60_000)) · 1000
  if finite && perMin > 0: moves.push(perMin)
moves.sort(asc)
p99 = moves[min(len−1, floor(len·0.99))] ?? 0
rateScale = max(50, p99, |gexRate ?? 0|)
```

> "the p99 of today's per-minute moves rather than the raw max, so one absurd
> print cannot define the whole meter, floored so a dead tape does not turn feed
> noise into a full-scale swing. Exact zeros are dropped — long flat stretches
> (pre-open, lunch) would otherwise drag the percentile down until the meter
> pegged on any tick."

**And its position is square-root compressed** — the only tile that is:

```ts
mag   = sqrt(clamp(|gexRate| / rateScale, 0, 1)) / 2
rateT = clamp(0.5 + (gexRate >= 0 ? mag : −mag), 0, 1)
```

> "Per-minute GEX moves are heavily tailed: a calm minute and a headline burst
> differ by two orders of magnitude, so under the linear mapping the level tiles
> use, any scale large enough to show the burst leaves every ordinary minute
> inside the first segment. sqrt spreads that range out — 1% of scale still
> lights a segment, 25% reaches halfway, and only a genuine full-scale burst pegs
> it."

### Tile 5 — `0DTE GEX Δ 15m`

```ts
cutoff = now − 15·60_000
past   = history.filter(p => p.ts <= cutoff)
ref    = past.length ? last(past) : history[0]
gexChg = gex − ref.gex                                  // $B
```

Note the fallback to `history[0]` — unlike the rate, this one will answer off a
history shorter than its window, using the oldest sample there is. (Contrast the
15-minute *change line* below, which will not.)

Its scale is the largest single **step** in the series, floored:

```ts
chgScale = max(0.05, |gexChg|, max over adjacent pairs |cur.gex − prev.gex|)
```

Title: `Net GEX now against net GEX fifteen minutes ago`.

### The 15-minute change line — `useDelta15m`

Drawn under **every** tile's value, and it is emphatically not `value − prevValue`:

> "It is driven by a per-tile ring buffer of one-minute samples (`useDelta15m`).
> `value − prevValue` would report the change since the last socket frame and
> label it a fifteen-minute move, which is the failure v2's comment on this block
> warns about. Until the ring reaches back fifteen minutes the line draws NOTHING
> rather than a short-window change wearing the wrong label."

Mechanism:

* Keyed by the tile's **label string** (`LABELS.gamma` … `LABELS.gexChg`) — those
  constants are both the ring keys and the on-screen labels.
* A **5-second timer** samples; at most **one sample per wall-clock minute
  bucket** per key (`Math.floor(ts / 60_000)`).
* Ring length `RING_MINUTES = 16` — *"just enough to always reach back across
  `WINDOW_MS`."*
* Non-finite or `null` values are skipped entirely (no sample written).
* Lookup: `target = Date.now() − 15·60_000 + 30_000` — *"the current value minus
  the newest sample at or before the 15-minute mark, with a half-minute tolerance
  for a full ring whose oldest sample sits a few seconds shy of it."*
* No sample reaching that far back → `null` → the caller renders nothing at all.

Sampling is on a timer rather than on the render cadence *"because socket frames
arrive faster and irregularly, and the timer is what makes the spacing one
minute."*

### The deadband

```ts
flat = |d| < g.scale · DEADBAND_FRACTION       // 0.01
```

*"A move smaller than this share of a tile's full scale reads as flat."* A flat
line draws `—` in `T.muted` at 50% opacity; otherwise `▲` / `▼` plus the
unsigned magnitude in `T.green` / `T.red`. Note each tile's deadband is a
different absolute size, because each tile's `scale` is.

### Formatting summary

| Function | Output | Used by |
|---|---|---|
| `fmtB` | `+$1.24B` / `−$1.24B` | Gamma, Delta, Δ15m |
| `fmtPct` | `63%` | Gamma % |
| `fmtRate` | `+$1,240M/m`, or `0M/m` | Rate |
| `fmtAbsB` | `$1.24B` | change line, Gamma/Delta/Δ15m |
| `fmtAbsPct` | `63%` | change line, Gamma % |
| `fmtAbsRate` | `$1,240M/m` | change line, Rate |

The unsigned `fmtAbs*` family exists because on the change line *"its ▲/▼ carries
the sign."* The minus is **U+2212** throughout, *"so a signed value does not
jitter as it crosses zero."*

---

## Every control

**There are none.** The Gauge Rail has no chips, no segmented groups, no cog, no
ticker box and no persisted settings. There is no `localStorage` key and no
settings blob, so there is nothing for an old stored value to coerce to.

Everything that would be a control on another card is fixed here:

| Would-be control | Fixed at | Why |
|---|---|---|
| Symbol | `SOCKET_SYMBOL` = `SPX` | The `gex` topic carries one underlying and there is no chain fallback. |
| Basis | `oi-vol` | Stated on the card's own toolbar, and it is the basis `greeks-ts-writer.js` records in, so the seed and the live present are the same quantity. |
| Lookback | `WINDOW_MS` = 15 min | Baked into two tiles and the change line. |
| Segments | `SEGMENTS` = 30 | See below. |
| Which tiles | five, in a fixed order | The sixth (IB Direction) was dropped 2026-09-03. |

The toolbar carries two **readouts**, not controls:

```jsx
<span className="text-2xs font-bold uppercase tracking-[0.08em] text-muted">OI+VOL</span>
<span className="tabular text-2xs font-semibold text-accent">
  SPX{snap?.expiry ? ` · ${fmtContractDate(snap.expiry)}` : ''}
</span>
```

`fmtContractDate('2026-09-19')` → `9-19-26`. Anything that is not an ISO date is
*"passed through untouched rather than reformatted into a guess."* With no
expiry yet, the clause is dropped entirely rather than printed as an em dash.

### The one tunable with a dated reason

```ts
/**
 * Segments per meter.
 *
 * 30, not the original 20 (2026-09-04): at 20 the bars are wide enough that a
 * near-full-scale reading reads as one solid slab rather than a meter. Thinner
 * LEDs keep the segmented look at both ends of the range, and give the fill
 * enough resolution that a few percent of scale is a visible step.
 */
const SEGMENTS = 30
```

---

## Rendering

### DOM + inline SVG. No canvas.

There is no `<canvas>` and no `data-cb-layer` on this card, so
`scripts/perf-check.mjs` — which "counts REPAINTS PER ANIMATION FRAME on every
canvas v3 owns (the ones tagged `data-cb-layer`)" — does not measure it at all.
It is React DOM plus five inline `<svg>` elements.

### Constants

```ts
const BILLION            = 1e9
const MINUTE_MS          = 60_000
const WINDOW_MS          = 15 * MINUTE_MS   // 900_000
const RING_MINUTES       = 16
const DEADBAND_FRACTION  = 0.01
const BUCKET_MS          = 15_000
const MAX_POINTS         = 1500
const SEGMENTS           = 30

const METER_W   = 118
const METER_H   = 30
const METER_PAD = 5
const METER_GAP = 1.5
const SEG_H     = 22
const SEG_Y     = 4
```

### The meter

```ts
segW = (METER_W − METER_PAD·2 − METER_GAP·(SEGMENTS−1)) / SEGMENTS
     = (118 − 10 − 43.5) / 30
     ≈ 2.15 px
```

Each segment is an `<rect>` at `x = METER_PAD + i·(segW + METER_GAP)`,
`y = SEG_Y`, `height = SEG_H`, `rx = 1`.

> "1, not 2: at ~2.15px wide a 2px radius rounds a bar into a pill."

Lit range:

```ts
tv      = t != null && finite ? clamp(t, 0, 1) : midT
litFrom = kind === 'pct' ? 0   : min(tv, midT)
litTo   = kind === 'pct' ? tv  : max(tv, midT)
on      = has && e > litFrom + 1e-6 && s < litTo − 1e-6      // s,e = i/N, (i+1)/N
```

So a **signed** meter fills from the centre outward in whichever direction the
value points, and a **pct** meter fills from the left edge.

* **Lit** fill = the tile's colour, plus `filter: drop-shadow(0 0 2px <colour @ 80%>)`.
* **Unlit** fill = `alpha(T.text, 0.07)`.
* **Centre tick** (signed only): a 1.8 × `SEG_H + 6` rect at
  `midX = METER_PAD + midT·(METER_W − METER_PAD·2)`, filled `alpha(T.text, 0.92)`
  with a `0 0 3px` drop shadow at `alpha(T.text, 0.55)`.

The SVG is **stretched**:

```jsx
<svg viewBox="0 0 118 30" preserveAspectRatio="none" aria-hidden
     className="block h-[30px] w-full shrink-0" />
```

> "The SVG is STRETCHED to the tile's width (`preserveAspectRatio none`) so five
> tiles share a row evenly and the meter never decides how wide a tile has to be."

`aria-hidden` because the value beneath it is the accessible text.

### Colour tokens

Every colour goes through `design/theme.ts`, which hands out `var(--color-…)` and
`color-mix()` strings — the sanctioned bridge, since AGENTS.md non-negotiable 1
bans colour literals outside `tokens.css`.

| Used as | Token constant | CSS custom property | Hex in `tokens.css` |
|---|---|---|---|
| Positive reading | `GEX_POS` | `--color-gex-pos` | `#4d8cff` |
| Negative reading | `GEX_NEG` | `--color-gex-neg` | `#ff5fa2` |
| Null reading (meter colour) | `T.cyan` | `--color-accent` | `#2f6bff` |
| Value text, centre tick, unlit segments | `T.text` | `--color-fg` | `#e7ece9` |
| `--` value, label | `T.faint` / `text-muted` | `--color-faint` / `--color-muted` | `#c0c5c3` / `#e7ece9` |
| Change line, up | `T.green` | `--color-up` | `#3ddc8e` |
| Change line, down | `T.red` | `--color-down` | `#ff6b7a` |
| Change line, flat + `/ 15m` | `T.muted` | `--color-muted` | `#e7ece9` |
| Toolbar ticker | `text-accent` | `--color-accent` | `#2f6bff` |
| Tile plate / border | `bg-raised` / `border-line` | `--color-raised` / `--color-line` | `color-mix(in srgb, #141a21 92%, #e7ece9)` / `#1e2630` |

`GEX_POS`/`GEX_NEG` are the **bubble** pair — *"these are the bubble hues the ES
chart already uses, so a positive strike is the same blue in the chain as it is on
the candles."* Note they are **not** `--color-gexbar-pos`/`-neg` (`#4d8cff` /
`#ffd166`), which is what the GEX Chart's *bars* use: the blue happens to match,
the negative does not. `tokens.css` explains that split: *"v2 draws its bubbles
blue/RED and its home-page GEX chart bars blue/AMBER."*

`alpha(color, a)` is `color-mix(in srgb, <token> <pct>%, transparent)` — *"a
hand-typed `rgba(48,209,88,.08)` would be a literal AND would stop tracking the
token the moment the token moved."*

### Type scale

Per AGENTS.md rule 1, sizes come from the scale and never from a bracket value:

| Element | Class | px |
|---|---|---:|
| Tile label | `text-3xs font-bold uppercase tracking-[0.08em]` at `opacity-70`, `min-h-[22px]` | 9 |
| Value | `tabular truncate font-mono text-sm font-extrabold` | 13 |
| Change line | `tabular text-2xs font-bold` | 10 |
| Toolbar | `text-2xs` | 10 |

### Layout

```jsx
<div className="flex min-h-0 flex-1 flex-col" data-capture-meta="…">
  <CardToolbar> OI+VOL   SPX · 9-19-26 </CardToolbar>
  <div className="flex min-h-0 flex-1 items-stretch gap-1.5 overflow-hidden">
    {gauges.map(g => <Cell key={g.label} g={g} />)}
  </div>
</div>
```

Each `Cell` is
`flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-sm border border-line bg-raised px-1.5 py-1.5`.
`flex-1` + `min-w-0` is what lets five tiles share the width evenly and shrink
below their content width rather than wrapping or scrolling.

`CardToolbar` **portals into the Card header** — "a card gets one bar of controls
and it is the header it already has." Card bodies used to draw their own row of
buttons under the header, so "every card with settings showed two stacked bars."

### `data-capture-meta`

```
SPX · 9-19-26 · OI+VOL
```

> "The caption under a CopyShot reads `Gauge Rail · <time> · <this>`. The contract
> date is what makes a shared PNG of this card still mean something later."

---

## Phone / expanded / replay

* **Phone.** The Gauge Rail is **not** on the phone build. `src/mobile/pages/`
  mounts four board cards — `GexChartCard` (`MGex`), `MultiGreekCard` (`MHeat`),
  `GexCandlesCard` (`MSpx`) and `EconCalendarCard` (`MEcon`) — and the rail is
  not among them. There is no `/m/gauges` route and the card carries no `simple`
  prop. Five 30-segment meters sharing a 390px width
  would be ~78px per tile.
* **Expanded.** Generic only — every card can be expanded to fill the page area
  via `design/primitives/Expand.tsx`, one at a time, Escape to collapse. Nothing
  about this card changes when expanded; the SVG meters stretch (they already
  have `preserveAspectRatio="none"` and `w-full`), the value and label text do
  not. Because `defaultSize.h` is 20 grid rows (160px), an expanded Gauge Rail is
  mostly empty vertical space.
* **Replay.** **None.** No replay dock, no date parameter, no rewind. The seed
  URL's `date` is always `etDay(Date.now())` — there is no path that asks for a
  past session.
* **Offscreen.** No `ChartFrame`, so no `IntersectionObserver` gate. An offscreen
  Gauge Rail keeps re-rendering on every `sameSnap`-distinct frame. What *is*
  gated is the 5-second ring sampler (see below).

---

## Status and empty-state messages, verbatim

The Gauge Rail has **no sentences at all** — no "Waiting for the feed…", no
error line, no skeleton. It has exactly two empty states, both per-tile:

| State | What is drawn |
|---|---|
| **No value** (`g.value == null` or non-finite) | The value reads `--` (two ASCII hyphens, *not* an em dash) in `T.faint` at `opacity-50`. The meter draws all 30 segments **unlit** at `alpha(T.text, 0.07)`, positioned at `midT`, and the meter colour falls back to `T.cyan`. |
| **No 15-minute reference** (`delta15m[key] == null`) | `Delta15m` returns `null` — **nothing at all** is rendered, not even a placeholder row. |
| **Flat** (`\|d\| < scale · 0.01`) | `—` (U+2014) in `T.muted` at `opacity-50`, followed by `/ 15m`. |
| **Moving** | `▲ $0.42B` or `▼ $0.42B` in `T.green` / `T.red`, followed by a muted `/ 15m`. |

`--` appears on:

* **all five tiles** before the first `gex` frame lands (`snap === null`);
* **Gamma %** whenever nothing has traded (`totVol === 0` → `null`);
* **Rate** whenever `history.length < 2`, or no sample sits in the 30 s – 180 s
  eligibility window, or the chosen reference's span is under 30 s;
* **Δ15m** whenever history is empty.

On the change line, the colour rule is narrow on purpose:

> "Only the magnitude carries the up/down accent; `/ 15m` stays muted, so the
> colour reads as the direction of the move rather than as part of the label."

The toolbar's expiry clause is **dropped**, not em-dashed, when `snap?.expiry` is
falsy — the same rule `multiStatusLine` follows elsewhere in the repo ("so a stale
deploy reads as 'this build has no walls' instead of 'there are no walls'").

---

## Performance notes

### The render budget

The card re-renders on:

1. A `gex` frame whose **values** differ from the last one (`sameSnap`). Not on
   every frame — this is the whole reason `ts` is excluded from the comparison.
2. `setLive` — which runs inside an effect keyed on `snap`, so it is bounded by
   (1), then bucketed at 15 s.
3. `setRings` inside `useDelta15m` — at most once per wall-clock minute per key,
   from a 5 s timer.
4. `seedQ` resolving, once.

### The visibility rule, applied to a timer

```ts
const fire = () => { if (document.visibilityState !== 'hidden') sample() }
const id = setInterval(fire, 5_000)
document.addEventListener('visibilitychange', onVisible)   // fires sample() on the way back
```

> "Same rule `useQuery`'s `pollMs` and VolGexFlow's `usePoll` follow: a hidden tab
> does not sample. This one fires every FIVE seconds and writes React state on a
> card whose rings only ever move once a minute, so a backgrounded board was
> re-rendering the rail twelve times for every bucket it could possibly fill. One
> tick on the way back in catches the gap up."

Note `setRings` returns `prev` unchanged when nothing was written (`changed`
stays false), so the 12-per-minute redundant ticks were already bailing out of
React — the fix was about the *state write attempt*, and the twelve `sample()`
closures it allocated, not about twelve full re-renders.

### The unbounded-work shapes

Three of the four scales walk the whole `history` array on every render:

| Memo | Work | Deps |
|---|---|---|
| `gexScale` | O(n) max | `[history, gex]` |
| `dexScale` | O(n) max | `[history, dex]` |
| `chgScale` | O(n) over adjacent pairs | `[history, gexChg]` |
| `rateScale` | O(n) build + **O(n log n) sort** | `[history, gexRate]` |
| `gexChg` | O(n) filter | `[gex, history, now]` |
| `gexRate` | two O(n) filters | `[gex, history, now]` |

`history` is capped at `MAX_POINTS = 1500` plus however many seed rows precede
the first live point (`limit=5000` on the seed request, so worst case ~6500
points). `rateScale`'s sort is the heaviest single item and it re-runs whenever
`history` changes — which is once per 15-second bucket, not per frame.

`now` is `snap?.ts ?? newest?.ts ?? Date.now()`. Because `snap.ts` is the moment
the reading last *changed*, `gexChg` and `gexRate` are stable memos between
movements rather than recomputing against a walking clock.

### Reference stability

`history` is a `useMemo` that returns `live` **by reference** when the seed is
empty, and `seed` by reference when there are no live points yet, so the common
warm-up path does not allocate.

`ringInputs` is memoised on the five values so `useDelta15m` does not see a new
object every render.

### What it does not do

* No canvas, so nothing to gate through `ChartFrame` and nothing for
  `perf-check.mjs` to attribute.
* No `requestAnimationFrame` loop.
* No `ResizeObserver`.
* One HTTP request per mount, no poll, deduped by URL with every other reader of
  the same URL.

---

## Gotchas

1. **This card is SPX, whatever the board ticker says.** No `usePageSymbol`, no
   chain fallback. Unlike the GEX Chart and Key Levels, there is no second path —
   and the toolbar prints `SPX` so the disagreement is visible rather than silent.

2. **Never add `ts` to `sameSnap`.** It is the render throttle, the history
   sampler *and* the x-axis of the rate, all in one omission. Comparing it puts
   the card back to several re-renders a second and lets the rate be computed
   across a span of a couple of seconds.

3. **Do not read `GexData.totals`.** v2's rail does; v3's wire contract types it
   `unknown`, and "nothing in src/ may reach for a field `contract/frames.ts` does
   not carry." Summing the rows through the shared accessors is what keeps this
   card and the GEX Chart's Net GEX tile in lockstep.

4. **The seed and the live series must never interleave.** The recorder writes
   once a minute and the socket lands whenever it lands; overlapping them lets a
   rate be computed across two samples of the same minute. Seed is filtered to
   `p.ts < firstLive`.

5. **The Rate tile is in MILLIONS while its neighbours are in BILLIONS.** That is
   deliberate and the tooltip says so. In billions an ordinary minute reads
   `+$0.02B/m` and most of the day rounds to zero.

6. **The Rate meter is the only sqrt-compressed one.** A reading halfway along the
   meter is 25% of scale, not 50%. Do not read it against the other four as if
   they shared a mapping.

7. **Every tile's deadband is a different absolute size,** because
   `DEADBAND_FRACTION` is a fraction of that tile's own `scale`, and three of the
   four scales are self-scaling. A 0.4 % move on Gamma % (scale 100) is 1 pp; on
   Gamma (scale = today's max |GEX|) it could be hundreds of millions.

8. **Two different 15-minute numbers live on one tile.** `0DTE GEX Δ 15m` is the
   *value*, computed from `history` with a fallback to the oldest point there is;
   the `▲ … / 15m` line under it is `useDelta15m`'s ring-buffer delta of that
   value, which refuses to answer without a sample reaching back 15 minutes. So
   tile 5 can show a number while its own change line shows nothing.

9. **The ring buffers are keyed by the on-screen label string.** Rename a label in
   `LABELS` and you silently reset that tile's ring for every open board. The
   constants' own comment names both jobs: *"Stable keys for the per-tile ring
   buffers. Also the on-screen labels."*

10. **A failed seed is silent.** There is no error line anywhere on this card.
    `parseSeed(undefined)` is `[]`, and the visible symptom is two tiles reading
    `--` for longer than they should and two meters scaling to live extremes only.

11. **`--` is two ASCII hyphens, not an em dash.** The flat change line uses
    U+2014 `—` and the signed values use U+2212 `−`. Three different dashes on one
    card, each with a job.

12. **`gammaPctVol` is contract-weighted, not dollar-weighted.** `γ × contracts`,
    no `spot²`. Weighting by dollar gamma "would make it drift with the index."

13. **`updatedAt` may be seconds.** Both `readSnap` and `parseSeed` apply the same
    `ts < 1e12 → ×1000` rule. A feed that starts sending milliseconds where it
    used to send seconds needs no change; one that sends microseconds would break
    both.

14. **`MAX_POINTS = 1500` at `BUCKET_MS = 15_000` is 6h15m.** A fully-attended RTH
    session (6h30m) will drop its earliest live buckets before the close. That
    only affects the two self-scaling level meters and `rateScale`'s percentile —
    the two windowed tiles look back 15 minutes.

15. **Nothing here is persisted.** No `localStorage` key, no settings version, no
    per-instance state. Two Gauge Rails on one board are byte-identical, and
    `placeNewCard` will size the second to match the first.

16. **An offscreen Gauge Rail still re-renders.** The only visibility gate on this
    card is the 5-second ring sampler. There is no `ChartFrame`, so the
    board-wide "a card nobody can see does not paint" rule does not reach it —
    and `perf-check.mjs` cannot see it either, because it has no `data-cb-layer`
    canvas to attribute repaints to.

17. **The sixth tile is not coming back by accident.** IB Direction was dropped at
    Brandon's request (2026-09-03) and it was also *"the one tile on the rail with
    nothing to do with the option book — it came off the ES candle feed through a
    hook of its own."* Re-adding it re-introduces a second data source and the
    single-source property goes with it.

18. **`SEGMENTS` is 30 and was 20.** Changing it changes `segW`, and at 20 the
    bars are wide enough that a near-full-scale reading "reads as one solid slab
    rather than a meter." If you raise it much past 30, `rx={1}` starts rounding
    sub-2px bars into pills again.
