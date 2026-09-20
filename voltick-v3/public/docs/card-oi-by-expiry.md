# `oi-by-expiry` — **OI by Expiration** · 📅 · default grid `w 24 × h 40` · `src/board/oiByExpiry/`

| | |
|---|---|
| **Catalog id** | `oi-by-expiry` (`src/board/catalog.tsx`) |
| **Label** | `OI by Expiration` |
| **Icon** | 📅 |
| **Default size** | `{ w: 24, h: 40 }` — half the board (`BOARD_COLS` 48) and 40 rows of `BOARD_ROW_H` 8px |
| **Source folder** | `src/board/oiByExpiry/` |
| **Loaded** | `lazy()` in the catalog, `<Deferred>` fallback is a blank `<div className="min-h-0 flex-1" />` |
| **Ticker** | none. SPX (`SOCKET_SYMBOL`) always. |
| **Descends from** | the scanner's GEX Levels **card 5**, `key: 'oiExpiry'`, titled there *"Open interest by expiration"* with the subtitle `` `${symbol} · nearest ${OI_EXPIRY_MAX} listed expirations` `` |

The catalog entry states the design change and the size in one breath:

> The scanner's GEX Levels card 5, with its two side-by-side mini charts folded into **ONE column per date** — call and put on the same column and the same scale, which is the comparison the card exists for and the one the scanner's version makes you do by eye across two panes.
>
> No ticker of its own, for the same reason Net Vol GEX Flow has none: the expiration list comes from `/proxy/gex`, the shared index feed, so this card is SPX whatever the board symbol says.
>
> 24 x 40 — half the board width is what twelve date columns plus their DTE row need before the ticks collide, and OPRA open interest is a once-a-day figure that does not earn a tall pane.

---

## What it is, in one paragraph

A bar chart of **open interest**, in contracts, one column per upcoming SPX expiration — the nearest twelve. Each column carries the call open interest and the put open interest for that date, on **one shared scale**, so the question the card exists to answer — *at this date, how does call OI compare to put OI?* — is the first thing you read rather than something you reconstruct from two charts a chart's width apart. Three modes: **GROUPED** puts the two legs side by side in the column, **STACKED** puts them in one bar with puts underneath, and **NET C−P** draws the signed difference above and below a zero line. The nearest expiry is marked with a dashed vertical rule labelled `0DTE` — or `FRONT` when the nearest listed date is not actually today, which is most weekends. Above the chart the toolbar carries the total call OI, total put OI and the put/call ratio across everything shown, plus the time the sweep landed. Open interest is an OPRA figure posted **once a day, around 06:30 ET, reflecting the prior close**, so this card does not poll at all: it sweeps once per ET day, caches the result in the browser, and the toolbar's `Refresh` is the only way past the cache.

---

## File map

| File | Lines | What it owns |
|---|---:|---|
| `src/board/oiByExpiry/OiByExpiryCard.tsx` | 325 | The card. The two hops, the run-generation guard, the mode switch and its localStorage, the header totals and stamp, the `ChartFrame` wiring and the three-way visibility gate, every status line. |
| `src/board/oiByExpiry/oiByExpiryRender.ts` | 429 | The canvas. `mountOiByExpiry()`, the palette read, the per-mode scale, gridlines, bars and their gradients, the front-expiry marker, the two tick rows, the series line, the hover readout and its hit test. Also `fmtContracts` / `fmtOiFull` / `fmtExpiryTick` / `dteOf`. |
| `src/pages/scanner/gexLevelsData.ts` | 1078 | `EP_GEX`, `EP_CHAINS`, `gexUrl()`, `chainsUrl()`, `loadOiByExpiration()`, `CHAINS_STALE_MS`, `OI_NO_EXPIRATIONS`. |
| `src/pages/scanner/gexLevels.ts` | 2632 | `OI_EXPIRY_MAX`, `OI_EXPIRY_CACHE_PREFIX`, `oiExpiryTargets()`, `sumChainOi()`, the three cache functions, `todayEtDate()`, the `OiByExpiryRow` / `OiExpiryCache` / `GexLevelsSnapshot` types. |
| `src/data/api.ts` | 239 | `useQuery` for hop 1, `query()` for each of hop 2's twelve legs. |
| `src/design/primitives/ChartFrame.tsx` | 211 | The visibility-gated container. |
| `src/board/chainGex.ts` | 129 | **Not imported by this card.** The *other* `/api/chains` consumer — see "Two parsers for one endpoint". |
| `src/design/tokens.css` | 716 | Every colour the palette read resolves. |

> Line counts are `wc -l` against the tree at `voltick-v3/`.

### Two parsers for one endpoint

`/api/chains` is read by two entirely separate parsers in this repo, and this card uses the scanner's:

| Parser | File | Reads | Produces |
|---|---|---|---|
| `sumChainOi(json, expiry)` | `pages/scanner/gexLevels.ts` | `data.items[].strikes[].{call,put}['open-interest' \|\| openInterest]` | `{ callOI, putOI }` — two integers |
| `parseChain(json)` → `chainToGex()` | `board/multiGreek/mgMath.ts` → `board/chainGex.ts` | `data.underlyingPrice`, `data.items[]['expiration-date']`, `strikes[]['strike-price']`, gamma/delta/OI/volume/mark | a full `GexRow[]` ladder plus walls, core and flip |

`chainGex.ts`'s header is the reason the second one exists at all:

> The WebSocket streams one underlying. Every card that reads `gex` / `spot` is therefore SPX-only unless it has a second path, and this is that path.

This card needs neither the ladder nor the levels — only two sums per expiry — so it takes the cheaper parser. The two also address the endpoint differently: `chainGexUrl()` passes `&live=0` and no `&expiration=`; `chainsUrl(symbol, expiry)` passes `&expiration=` and **no `live` flag at all**.

---

## The data path

### Hop 1 — the expiration list

```
GET /proxy/gex
```

`gexUrl()` — **no query params at all**. "B18 — no query params at all. The feed's symbol and expiry are the server's choice."

```ts
const snapQ = useQuery<GexLevelsSnapshot>(gexUrl(), { staleMs: 60_000 })
```

| Property | Value | Why |
|---|---|---|
| Poll | **none** | "Long stale window and no poll: the listed expirations for an index change once a day, when one rolls off." |
| Stale window | `60_000` | A remount inside a minute serves the cached body. |
| Dedupe | by URL | Everything else on the board or the scanner reading `/proxy/gex` shares this response. |

Only one field is read:

```ts
const list = snapQ.data?.expirations
const expirations = Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string' && !!e) : []
const expiryKey = expirations.join(',')
```

The full wire type (`GexLevelsSnapshot`) also carries `symbol`, `spot`, `expiry`, `gexRows`, `callWall`, `putWall`, `gexFlip`, `totalNetGex`, `updatedAt` — **none of which this card reads**.

Note the scanner tab's `/proxy/gex` runs a **15s** poll (`GEX_POLL_MS`, "a LIVE 0DTE feed: the walls, the flip and $Gamma all move on it"). This card deliberately does not, because it only wants the calendar.

### Hop 2 — the twelve chains, all at once

```
GET /api/chains?ticker=SPX&expiration=<YYYY-MM-DD>&range=all
```

`chainsUrl(symbol, expiry)`. "`range=all` is a literal, sent on every call; both other params are `encodeURIComponent`'d." **No `live=0` here** — unlike the Multi Greek ladder's and `chainGex.ts`'s calls.

```ts
const targets = oiExpiryTargets(expirations)         // lexicographic sort, then .slice(0, 12)
const settled = await Promise.allSettled(targets.map(e => fetchOiTotalsForExpiry('SPX', e)))
```

| Property | Value | Why |
|---|---|---|
| Fan-out | `Promise.allSettled` over **all twelve at once** | not serial |
| Poll | **none** | OPRA OI is a once-daily figure |
| Stale window | `CHAINS_STALE_MS = 0` | see below |
| Real cache | `localStorage`, keyed per symbol, **stamped with an ET calendar day** | |

Why the in-memory window is zero:

> `/api/chains` is the ONE v2 fetch with no `cache` option (B173) — it rides the browser's default HTTP cache. It gets a ZERO in-memory window here on purpose: the real cache is the per-ET-day localStorage entry (`readFreshOiExpiryCache`), and the only thing that ever gets past that is the card's Refresh, which exists precisely to force a re-pull. **An in-memory window would swallow it.**

### The waterfall is real, and it stays

Both the card and the data module argue the point rather than hiding it.

From the card:

> `/proxy/gex` first, for `expirations`, then all twelve `/api/chains` AT ONCE. The second hop genuinely cannot be named without the first — it is the one loader on the scanner tab with that shape, and the same is true here.
>
> Non-negotiable 3 is about a route fanning out serially when it could fan out in parallel; the twelve chains do go together, and the one request in front of them is a small cached JSON the board's other consumers share through `useQuery`'s dedupe whenever anything else on screen has asked for it. It is still a hop, and it is **why the card says "Waiting for the expiration list…" rather than pretending to be loading bars it does not yet know the names of.**

From `gexLevelsData.ts`:

> v3 non-negotiable 4 forbids awaiting request A to build request B's URL FROM A VALUE THE CLIENT ALREADY HAD. This one is not that… `/api/chains` is addressed PER EXPIRY (`&expiration=YYYY-MM-DD`). It has no "give me every expiry" mode from this call site — **It is not a value the client already had; it is data.**

### The loader's order of operations — v2's, exactly

`loadOiByExpiration(symbol, expirations, force = false)`:

1. **BAIL** (return, touching nothing) when there is no symbol or no expirations. `{ rows: [], fromCache: false, loadedAt: null, skipped: true, rejected: [] }`. "A snapshot that never lands leaves the card at 'no data yet' forever, which is v2's behaviour."
2. Unless `force`, answer from **today's** localStorage cache without a request. `force` is the card's Refresh and skips **this step only**.
3. `oiExpiryTargets` — a lexicographic sort of `YYYY-MM-DD` (also chronological for that format), then the nearest 12.
4. `Promise.allSettled` over all twelve **at once**. Only fulfilled legs are kept, paired back to their target **by index**.
5. If **nothing** resolved, throw `"no expirations resolved"` (`OI_NO_EXPIRATIONS`) — the card's one error line. **A partial result is not an error.**
6. Write the cache, stamped with today's ET date.

`OiByExpirationLoad`:

```ts
{
  rows: OiByExpiryRow[]     // one per expiry whose leg RESOLVED. Server order is the target order.
  fromCache: boolean        // true when today's ET cache answered and NO request was made at all
  loadedAt: number | null   // ms; null ONLY on the `skipped` path
  skipped: boolean          // v2's bail
  rejected: string[]        // expiries whose leg REJECTED
}
```

`rejected` is v3's addition:

> v2 drops them silently — a chart of 12 bars quietly becomes a chart of 9 with nothing saying so. Reported here because it costs nothing… **Not a behaviour change: the rows are the same rows.**

### The cache

| Property | Value |
|---|---|
| Key | `` `gexlevels-oi-by-expiry-v1:${symbol}` `` → in practice `gexlevels-oi-by-expiry-v1:SPX` |
| Value | `{ date: "YYYY-MM-DD", symbol: "SPX", rows: OiByExpiryRow[] }` |
| Validity | `parsed?.date && parsed?.symbol === symbol` **and** `cached.date === todayEtDate()` |
| `todayEtDate()` | `new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())` — "`en-CA` purely because it yields ISO ordering; nothing about this is Canadian." |
| Failure | every read and write is wrapped in `try/catch` — "localStorage unavailable — just won't cache, and it refetches every mount." |

Why a day and not a TTL — `gexLevels.ts` header note 8 and `gexLevelsData.ts` header note 3:

> OPRA OPEN INTEREST IS A ONCE-DAILY VALUE, posted ~06:30 ET and reflecting the prior close. The OI-by-expiration card therefore does not ride the 15s poll at all: it caches per ET DAY in localStorage and only the card's own Refresh forces a re-pull.

> **THE `date` OF THE OI CACHE IS AN ET CALENDAR DAY, NOT A TTL.**

And from the card itself:

> A card that re-swept twelve full chains every minute would be spending real upstream budget to redraw the same twelve bars.

There is **no version bump path**: the `v1` in the prefix is the only version marker, and a stored blob from a different shape would be read as-is (the check is only `date` + `symbol`), then handed straight to the renderer.

### Response shape, exactly as parsed

`sumChainOi(json, expiry)`:

```jsonc
{
  "data": {
    "items": [
      {
        "expiration-date": "2026-09-19",   // sliced to 10 chars and compared
        "strikes": [
          { "call": { "open-interest": 12045 }, "put": { "open-interest": 8800 } }
        ]
      }
    ]
  }
}
```

```ts
const oi = (o) => o ? parseInt(String(o['open-interest'] ?? o.openInterest ?? 0), 10) || 0 : 0
for (const group of items) {
  const groupExp = String(g['expiration-date'] ?? '').slice(0, 10)
  if (groupExp && groupExp !== expiry.slice(0, 10)) continue
  for (const item of g.strikes ?? []) { callOI += oi(it.call); putOI += oi(it.put) }
}
```

Three things to notice:

- **Both key spellings are accepted**: hyphenated `open-interest` first, then camelCase `openInterest`, then `0`.
- `parseInt(String(…), 10) || 0` — a string, a float, `null` and `undefined` all land on an integer; `NaN` becomes `0`.
- **A group with an EMPTY `expiration-date` is counted**, not skipped, because the guard is `if (groupExp && groupExp !== …)`. The source says so:

  > A group whose `expiration-date` is present AND different is skipped — an **EMPTY** `expiration-date` is therefore **counted**, which is v2's behaviour and matters when the upstream omits the field.

- Anything that is not an array where an array was expected becomes `[]`; the sums simply come back `0`.

### HTTP-200-on-failure

`query()` throws only on `!res.ok`. `/api/chains` and `/proxy/gex` have **no `ok:false` envelope handling anywhere in this card's path**, so:

- A soft-failed `/proxy/gex` that returns 200 with no `expirations` array → `expirations` is `[]` → `sweep` returns early → the card sits on **`Waiting for the expiration list…`** forever, with no error.
- A soft-failed `/api/chains` that returns 200 with no `data.items` → `sumChainOi` returns `{ callOI: 0, putOI: 0 }` → that expiry becomes a **column of zero-height bars**, counted as a *fulfilled* leg, and **not** listed in `rejected`. `hi` stays 0 for that column and the scale takes `(hi || 1) * 1.15`.
- Only a **non-2xx** puts an expiry into `rejected`, and only if **all twelve** are non-2xx does the card show its error line.

One more loss is named in `gexLevelsData.ts`, about a sibling feed but relevant to the whole file:

> **THE MULTI FEED'S CONTENT-TYPE GUARD CANNOT BE REPRODUCED EXACTLY.** v2 inspects `res.headers` BEFORE parsing, so an un-redeployed server-v2 — where the request falls through to Next's HTML 404 — gets a useful sentence instead of `Unexpected token '<'`. **`query()` hides the Response.**

### The run-generation guard

```ts
const runRef = useRef(0)
const run = ++runRef.current
…
if (run !== runRef.current) return   // in BOTH .then and .catch
```

> A stale sweep must not overwrite a newer one — twelve parallel chain fetches take long enough that a ↻ can land mid-flight.

And `skipped` touches nothing but `loading`:

```ts
if (load.skipped) { setOi(prev => ({ ...prev, loading: false })); return }
```

> `skipped` is the loader's own bail (no symbol, no expirations). It touches nothing, exactly as v2 does, so the card keeps saying "waiting" rather than flashing an empty chart.

### The sweep's dependency is a string, not a callback

```ts
useEffect(() => { sweep(false) }, [expiryKey])   // eslint-disable-next-line react-hooks/exhaustive-deps
```

> `expiryKey` rather than `sweep`: the callback is rebuilt on every render that produces a new `expirations` array, and depending on it would re-run a twelve-request sweep for a list that had not changed.

---

## Every derived number

### Totals, in the toolbar

| Number | Formula | Unit |
|---|---|---|
| Total call OI | `Σ r.callOI` over the rows on screen | contracts |
| Total put OI | `Σ r.putOI` | contracts |
| `P/C` | `call > 0 ? put / call : null`, rendered `.toFixed(2)` | ratio |

All three are across **the expirations shown**, which is at most twelve and may be fewer if legs rejected.

### The scale — three modes, three maxima, one place

```ts
for (const r of rows) {
  if (mode === 'stacked')   hi = max(hi, r.callOI + r.putOI)
  else if (mode === 'net') { const v = r.callOI - r.putOI; hi = max(hi, v); lo = min(lo, v) }
  else                      hi = max(hi, r.callOI, r.putOI)   // grouped
}
const maxV = (hi || 1) * 1.15
const minV = lo * 1.15
const span = maxV - minV || 1
const y0   = PAD_T + cH * (maxV / span)          // the value-zero line in pixels
const yv   = (v) => y0 - (v / span) * cH
```

> Stacked is measured on the SUM, grouped on the taller LEG, net on the signed difference — three modes, three maxima, one place they are decided.

> 1.15 headroom, the same reason the GEX chart keeps 1.25: the tallest bar must not touch the frame, and the series line lives up there.

In **grouped** and **stacked**, `lo` stays 0, so `minV` is 0 and `y0` lands at `PAD_T + cH` — the bottom of the plot.

### Bar heights

| Mode | Call bar | Put bar |
|---|---|---|
| `grouped` | `max(1, (callOI / span) · cH)` at `x − groupW − 1`, top `y0 − ch` | `max(1, (putOI / span) · cH)` at `x + 1`, top `y0 − ph` |
| `stacked` | drawn **second**, at `x − soloW/2`, top `y0 − ph − ch` | drawn **first**, at `x − soloW/2`, top `y0 − ph` |
| `net` | one bar of `v = callOI − putOI`; top `v >= 0 ? yv(v) : y0`, height `max(1, \|yv(v) − y0\|)`, hue `v >= 0 ? call : put` | — |

Widths:

```ts
const groupW = Math.max(2, slot * 0.34)
const soloW  = Math.max(3, slot * 0.5)
```

Stacking order is deliberate: "**Puts on the bottom so the stack reads the same way round as the grouped mode's colours: blue above amber, calls above puts.**"

Every bar has a `max(1, …)` floor, so a strictly-positive-but-tiny OI is still a visible sliver — and a genuine zero also draws 1px in grouped/stacked (the `bar()` helper's own `if (h < 0.5) return` never fires because of the floor).

### Column geometry, shared by draw and hit test

```ts
function geometry(width) {
  const n = Math.max(1, model.rows.length)
  const slot = (width - PAD_L - PAD_R) / n
  return { slot, cx: (i) => PAD_L + slot * (i + 0.5) }
}
```

Hit test: `i = clamp(Math.floor((mx - PAD_L) / slot), 0, n - 1)`, only inside `[PAD_L, width − PAD_R] × [PAD_T, height − PAD_B]`.

### Gridlines

```ts
function niceStep(range, divisions = 4) {   // "gexChartRender's"
  const rough = Math.max(range / divisions, 1e-9)
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  for (const s of [1, 2, 5, 10]) if (s * mag >= rough) return s * mag
  return mag * 10
}
const step  = niceStep(span)
const first = Math.ceil(minV / step) * step
for (let g = first; g <= maxV * 1.001; g += step) { … }
```

A gridline is the **zero line** when `Math.abs(g) < step / 2` — that one gets `0.9` alpha and `0.8` lineWidth and is labelled `'0'`; the others get `0.55` alpha and `0.5` lineWidth and are labelled `fmtContracts(g)`.

> Same rule as the GEX chart: the LINE may reach the frame, its LABEL may not — the bottom strip is the tick rows' and a value landing on them is the one collision this chart can produce.

So the line is drawn whenever `PAD_T − 1 ≤ y ≤ PAD_T + cH + 1`, but the label is skipped when `y < PAD_T + 8 || y > PAD_T + cH − 24`.

### DTE

```ts
export function dteOf(ymd: string, todayEt: string): number | null {
  const a = Date.parse(`${todayEt}T00:00:00Z`)
  const b = Date.parse(`${ymd}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.max(0, Math.round((b - a) / 86_400_000))
}
```

> Both dates are parsed as **UTC midnight** so the subtraction is whole days and cannot be shifted by the viewer's own offset — the ET date string is already the answer to "what day is it where the market is".

Clamped at 0 — a past expiry reads `0d`, never negative. Returns `null` on an unparseable string, and a `null` DTE simply omits that tick.

*(Note: `mgMath.ts`'s `daysBetween()` solves the same problem with **noon** UTC on both sides. Two functions, two conventions, same answer for well-formed dates.)*

### Formatters

```ts
fmtContracts(v)   // |v| ≥ 1e6 → "1.4M" (1dp) · |v| ≥ 1e3 → "128K" (rounded, 0dp) · else String(Math.round(a))
fmtOiFull(v)      // Math.round(v).toLocaleString('en-US') → "12,045"
fmtExpiryTick(ymd)// "2026-09-19" → "9/19"; the raw string on a miss
```

`fmtContracts` takes the **absolute value**, so a negative net bar's gridline label prints unsigned. "**Contracts, not dollars — never a `$` on this chart.**" The axis has room for "the day and the month and nothing else."

### Hover readout

Three lines, rebuilt every `pointermove`:

```
`${expiry}${dte == null ? '' : `  ${dte}d`}`
`C ${fmtOiFull(callOI)}   P ${fmtOiFull(putOI)}`
`Total ${fmtOiFull(callOI + putOI)}${pc == null ? '' : `   P/C ${pc.toFixed(2)}`}`
```

with `pc = callOI > 0 ? putOI / callOI : null`.

Box geometry: `bw = maxTextWidth + 14`, `bh = 14 · lines.length + 8` (= 50 for three lines), positioned at `clamp(hover.x + 12, PAD_L, W − PAD_R − bw)` / `clamp(hover.y − bh − 8, PAD_T, PAD_T + cH − bh)`. Plate `withAlpha(p.surface, 1)` at `globalAlpha 0.95`, 1px `p.line` stroke on a half-pixel offset, first line at `0.95` ink and the rest at `0.8`.

### The header stamp

```ts
new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }).format(new Date(oi.loadedAt))
```

`loadedAt` is `Date.now()` at the moment the load settled — **including the cache path**, where no request was made. So the stamp is "when this card last got an answer", not "when OPRA published".

---

## Every control

| Control | What it does | Default | Stored | Old / bad value coerces to |
|---|---|---|---|---|
| **`SegGroup` mode** | `GROUPED` / `STACKED` / `NET C−P` | `grouped` | `localStorage` key **`cb-v3-oi-by-expiry-mode`**, the bare string | `raw === 'stacked' \|\| raw === 'net' \|\| raw === 'grouped' ? raw : 'grouped'` — **anything else, including `null`, a throw, or a value from a future build, becomes `grouped`** |
| **`Refresh`** | `sweep(true)` — skips **step 2 only** (the cache read), re-fans all twelve chains | — | — | — |

The `SegGroup`'s own tooltips, verbatim:

| Element | `title` |
|---|---|
| The group | `Call and put side by side in one column, stacked into one bar, or the signed difference` |
| `GROUPED` | `Both legs side by side in the date’s column, on one scale` *(note: a typographic apostrophe U+2019 in `date’s`)* |
| `STACKED` | `One bar per date, puts under calls — total OI at a glance` |
| `NET C−P` | `Call OI minus put OI. Above the line the calls outweigh the puts at that date` |

Other toolbar tooltips:

| Element | `title` |
|---|---|
| Total call figure | `Total call open interest across the expirations shown` |
| Total put figure | `Total put open interest across the expirations shown` |
| `P/C` | `Put/call open interest ratio across the expirations shown` |
| The stamp | `OPRA open interest is published once a day, around 06:30 ET, and reflects the prior close — so this is fetched once per trading day and cached in this browser. Refresh forces a re-pull` |
| `Refresh` button | `Force a re-pull, skipping today's cache` |

The mode store is described as "One blob, tiny, same shape as the rest," and both read and write are `try/catch`'d — "best-effort — the in-memory choice still drives this session."

### Storage keys, complete

| Key | Owner | Shape |
|---|---|---|
| `cb-v3-oi-by-expiry-mode` | this card | `'grouped'` \| `'stacked'` \| `'net'` |
| `gexlevels-oi-by-expiry-v1:SPX` | `pages/scanner/gexLevels.ts` | `{ date, symbol, rows }` — **shared with the scanner tab's card 5** |

The second is not this card's to own. Refreshing here refreshes the scanner's card 5 for the rest of the day, and vice versa.

### There is deliberately no ticker control

From the card header:

> Same reasoning the Net Vol GEX Flow card carries: the expiration list comes from `/proxy/gex`, which is the shared index feed, and this card is about the index book. **A ticker control here would be a control that changes nothing.**

`SOCKET_SYMBOL` (`'SPX'`, from `data/symbol.tsx`) is passed to `loadOiByExpiration` and into the model's `symbol` field, where it prints in the series line.

---

## Rendering

**Canvas.** `mountOiByExpiry(container)` creates one `<canvas>`, tags it, sets the container to `position: relative` if it is `static`, and sets `cursor: crosshair`.

```ts
canvas.dataset.cbLayer = 'oi-by-expiry'   // "Marks this as a canvas v3 CODE owns — non-negotiable 6."
```

### Layout constants

| Constant | Value | Note |
|---|---:|---|
| `PAD_L` | 16 | |
| `PAD_R` | 16 | gridline labels are right-pinned inside this |
| `PAD_T` | 22 | the series line sits at `PAD_T − 8` |
| `PAD_B` | 36 | "Two rows of tick text live down here: the date, and the DTE under it." |
| `cW` | `W − PAD_L − PAD_R` | |
| `cH` | `H − PAD_T − PAD_B` | |
| `slot` | `cW / max(1, rows.length)` | |
| `groupW` | `max(2, slot · 0.34)` | |
| `soloW` | `max(3, slot · 0.5)` | |
| Headroom | `× 1.15` | GEX chart keeps 1.25 |
| Date tick baseline | `PAD_T + cH + 16` | `bold 11px ui-monospace` |
| DTE tick baseline | `PAD_T + cH + 28` | `bold 9px ui-monospace` |
| `dteStride` | `rows.length <= 14 ? 1 : 2` | |
| Front marker label | `PAD_T + 10`, x clamped to `[PAD_L + 18, PAD_L + cW − 18]` | |
| Draw bail | `if (W < 10 \|\| H < 10) return` | |
| DPR | `window.devicePixelRatio \|\| 1`, `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` | |

Fonts, all from the type scale (non-negotiable 1 requires canvas to "read the number off the same scale rather than typing one"):

| Element | Font |
|---|---|
| Gridline labels, date ticks | `bold 11px ui-monospace, monospace` |
| Front marker label, DTE ticks, series line | `bold 9px ui-monospace, monospace` |
| Hover readout | `bold 10px ui-monospace, monospace` |

### It is the GEX Chart's language, deliberately

> Same padding shape, same right-pinned gridline labels in bold 11px mono, same dashed marker for the near edge, same blue/amber pair the bars use for positive and negative — here calls and puts, which is the same idea one axis over. **A board with both cards on it should read as one instrument, and the only way to get that is to copy the numbers rather than approximate them.**

### Palette — read from tokens, once per draw

```ts
function readPalette(el) {
  return {
    call:    hexToRgb(cssVar(el, '--color-gexbar-pos'), [41, 182, 246]),
    put:     hexToRgb(cssVar(el, '--color-gexbar-neg'), [255, 179, 0]),
    fg:      hexToRgb(cssVar(el, '--color-fg'),        [255, 255, 255]),
    line:    hexToRgb(cssVar(el, '--color-line'),      [35, 39, 46]),
    surface: hexToRgb(cssVar(el, '--color-surface'),   [15, 17, 23]),
  }
}
```

| Role | Token | Hex in `tokens.css` | RGB fallback in code |
|---|---|---|---|
| Calls | `--color-gexbar-pos` | `#4d8cff` | `[41, 182, 246]` |
| Puts | `--color-gexbar-neg` | `#ffd166` | `[255, 179, 0]` |
| Text, ticks, front marker | `--color-fg` | `#e7ece9` | `[255, 255, 255]` |
| Gridlines, hover border | `--color-line` | `#1e2630` | `[35, 39, 46]` |
| Hover plate | `--color-surface` | `#0e1216` | `[15, 17, 23]` |

The toolbar's two totals use the same two tokens inline: `style={{ color: 'var(--color-gexbar-pos)' }}` and `'var(--color-gexbar-neg)'`. The `P/C` figure is `text-muted`, the stamp `text-muted opacity-60`, the `Refresh` ink `text-accent`, the error line `text-down`.

> ⚠️ The RGB fallbacks in `readPalette` are **not** today's token values — they are v2's `#29b6f6` / `#ffb300` / white / `#23272e` / `#0f1117`. They only apply when `getComputedStyle` cannot resolve the property, so in the app they never fire; in a test renderer or before the stylesheet is live, they do.

Why calls take the positive hue:

> Calls take the positive hue and puts the negative one because that is what the eye has already learned from the chart above — **not because a call is "good".**

*(The scanner's own card 5 uses a different pair: `CALL_LEG_COLOR = V2.accent` and `PUT_LEG_COLOR = V2.red`. This card deliberately speaks the GEX Chart's language instead.)*

### `withAlpha` and the no-literal rule

```ts
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
function withAlpha(c, a) { return `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}${hex2(a * 255)}` }
```

The header explains why this exists rather than an `rgba()` template or `alpha()`:

> Where [`gexChartRender.ts`] then hand-writes an `rgba(…)` template, this one does NOT: **check-theme counts that as a colour literal, and the older file only passes because it is already recorded in `theme-baseline.json`.** `withAlpha` here composes an `#rrggbbaa` string out of the channels it already read, so **no colour SYNTAX appears in this file at all and there is nothing for the baseline to hold.**
>
> (8-digit hex rather than the theme's `alpha()` for one reason: `alpha()` emits `color-mix()`, and **a canvas that cannot parse a colour keeps the PREVIOUS fill silently instead of throwing** — not a failure mode worth buying for a chart whose two legs are told apart by hue.)

`theme-baseline.json` is the grandfathering file AGENTS.md describes: "violations that already existed are grandfathered per file, the build fails when a file goes ABOVE its number, and a file that reaches zero is dropped and can never regress. **Never raise a number to make a build pass.**"

### Bar gradients

```ts
const grad = ctx.createLinearGradient(0, top, 0, top + h)
if (hot) { grad.addColorStop(0, withAlpha(p.fg, 0.98)); grad.addColorStop(1, withAlpha(c, 0.72)) }
else     { grad.addColorStop(0, withAlpha(c,  0.90)); grad.addColorStop(1, withAlpha(c, 0.20)) }
```

> The GEX chart's gradient, same values: lit at the far end, fading toward the axis, and the hovered column swaps to a near-white ramp rather than an outline. **Nothing here is scaled by magnitude — that lightening reads as "this strike is hot", and on a date axis there is no hot date.**

### The front-expiry marker

Dashed `[5, 5]`, `withAlpha(p.fg, 0.45)`, 1px, full plot height at `cx(0)`, label centred at `PAD_T + 10` in `withAlpha(p.fg, 0.85)`:

```ts
ctx.fillText(dte === 0 ? '0DTE' : 'FRONT', clamp(cx(0), PAD_L + 18, PAD_L + cW - 18), PAD_T + 10)
```

> Labelled `0DTE` only when it really is today; otherwise `FRONT`. A weekend or a holiday makes the nearest listed expiry days away, and **a column headed "0DTE" on a Sunday is a chart telling a small lie every weekend.**

A `null` DTE (unparseable date) also lands on `FRONT`, since `null !== 0`.

Everything from the bars through the front marker is drawn inside `ctx.save()` / `ctx.clip()` on `rect(PAD_L, PAD_T, cW, cH)`; the ticks, the series line and the hover readout are drawn after `ctx.restore()`.

### The tick rows

```ts
// Date row: every column, ink 0.95 when hovered else 0.62
rows.forEach((r, i) => { ctx.fillStyle = withAlpha(p.fg, hover?.i === i ? 0.95 : 0.62); ctx.fillText(fmtExpiryTick(r.expiry), cx(i), PAD_T + cH + 16) })
// DTE row: every dteStride-th column, ink 0.30
```

> Every other one past fourteen columns: **the DTE line is a hint, and a row of overlapping hints is worse than no row at all.**

With `OI_EXPIRY_MAX = 12` the stride is always 1 in practice; the branch exists for a wider list.

*(The scanner's card 5 thins its ticks with a different rule — `showTickEveryNth(i, n, TICK_CAP_OI_EXPIRY = 8)`. This card's is its own.)*

### The series line

```ts
[model.symbol, isNet ? 'CALL − PUT OPEN INTEREST BY EXPIRATION' : 'OPEN INTEREST BY EXPIRATION', 'CONTRACTS']
  .filter(Boolean).join(' · ')
```

drawn left-aligned at `(PAD_L + 2, PAD_T - 8)` in `withAlpha(p.fg, 0.55)`. So: `SPX · OPEN INTEREST BY EXPIRATION · CONTRACTS`, or `SPX · CALL − PUT OPEN INTEREST BY EXPIRATION · CONTRACTS` in net mode.

> Named on the series line, so a CopyShot says which book this is.

### CopyShot

```tsx
data-capture-meta={[SOCKET_SYMBOL, 'OI by expiration', stamp ? `${stamp} ET` : ''].filter(Boolean).join(' · ')}
```

`src/shell/snapshot.ts` drops every card's own header from every shot, so this attribute is how the symbol and the stamp reach the caption strip. Example caption: `OI by Expiration · Sep 20, 14:02 ET · SPX · OI by expiration · 09:31 ET`.

---

## Per-frame / perf machinery

There is **no tick path at all**:

> OI moves once a day and the mode switch is a click, so there is no tick path here at all — the model is rebuilt from state and painted.

### The model

```ts
modelRef.current = { rows: oi.rows, mode, todayEt: todayEtDate(), symbol: SOCKET_SYMBOL }
paint()
```

Rebuilt in an effect keyed on `[oi.rows, mode, paint]`. `EMPTY_OI_MODEL = { rows: [], mode: 'grouped', todayEt: '', symbol: '' }`; `EMPTY_OI_ROWS` is a module-level constant — "ONE empty array, not a fresh one per render — see the note in `GexChartCard`."

### Visibility — the same three-part gate as `useCanvasRenderer`

```ts
const paint = () => {
  if (!handleRef.current) return
  if (!visibleRef.current) { missedRef.current = true; return }
  missedRef.current = false
  handleRef.current.setModel(modelRef.current)
}
onMount:      visibleRef.current = frame.visible(); created.setModel(modelRef.current)   // "Replay whatever arrived before the frame mounted."
onResize:     if (!visibleRef.current) { missedRef.current = true; return } handleRef.current?.redraw()
onVisibility: visibleRef.current = visible; if (visible && missedRef.current) paint()
```

`ChartFrame` supplies the signal. Its `rootMargin` defaults to `'200px'` — "a card is painted just before it is scrolled into view rather than a frame after" — and it publishes `data-visible="1"|"0"`, which is "how `scripts/perf-check.mjs` tells an idle card from a hidden one." Resize is debounced at `debounceMs: 80`.

### Redraw triggers

| Trigger | Path |
|---|---|
| New rows, or a mode change | effect → `paint()` → `setModel()` → `draw()` |
| Container resize | `ChartFrame`'s debounced `onResize` → `redraw()` → `draw()` |
| Becoming visible with a missed paint | `onVisibility` → `paint()` |
| **Every `pointermove` inside the plot** | `onMove` → `draw()` |
| Pointer leaving the plot, or the canvas | `onMove`/`onLeave` → `draw()` once |

The hover path is the only high-frequency one, and it repaints the **entire canvas** each time. `budgets.json` allows `perf.interactionRepaints: 10`.

`setModel` also clears a stale hover: "A shorter list can leave the hovered index past the end."

`destroy()` removes both listeners and the canvas.

---

## Status and empty-state messages, verbatim

All three empty/error lines are `pointer-events-none` overlays absolutely positioned over the chart box. Precedence, top to bottom:

| # | Condition | Element | Text |
|---|---|---|---|
| 1 | `oi.err` | `absolute left-1 right-1 top-1 truncate text-2xs text-down opacity-80` | `` `Open-interest sweep failed — ${oi.err}` `` |
| 2 | `empty && oi.loading` | `absolute left-1 top-1 text-2xs text-muted opacity-50` | `` `Summing open interest across ${SOCKET_SYMBOL}'s nearest expirations…` `` → **`Summing open interest across SPX's nearest expirations…`** |
| 3 | `empty && !loading && expirations.length` | same | `No expirations resolved` |
| 4 | `empty && !loading && !expirations.length` | same | `Waiting for the expiration list…` |
| 5 | `!empty && oi.rejected.length` | `absolute left-1 right-1 top-1 truncate text-2xs text-muted opacity-60` | `` `${n} expiration${n === 1 ? '' : 's'} did not answer` `` → `1 expiration did not answer` / `3 expirations did not answer` |

`empty` is `!oi.rows.length`.

`oi.err` is whatever `loadOiByExpiration` threw, `e instanceof Error ? e.message : String(e)`. The one message the loader itself produces is **`no expirations resolved`** (`OI_NO_EXPIRATIONS`), so the full line reads `Open-interest sweep failed — no expirations resolved`. A `query()` throw reads like `Open-interest sweep failed — 502 Bad Gateway — /api/chains?ticker=SPX&expiration=2026-09-19&range=all`.

Line 5 exists because of v2's silent drop:

> The loader drops a rejected leg and keeps the rest, which would otherwise turn twelve bars into nine with nothing saying so.

### Toolbar slots

| Slot | State | Text |
|---|---|---|
| Total call | `empty` | `—` |
| Total call | otherwise | `fmtOiFull(totals.call)` → `1,204,551` |
| Total put | `empty` | `—` |
| `P/C` | `totals.pc == null` | `P/C —` |
| `P/C` | otherwise | `` `P/C ${pc.toFixed(2)}` `` |
| Stamp | `oi.loading` | `Sweeping…` |
| Stamp | a `loadedAt` and `fromCache` | `` `${stamp} ET · cached` `` → `09:31 ET · cached` |
| Stamp | a `loadedAt`, fresh | `` `${stamp} ET` `` |
| Stamp | no `loadedAt` yet | `OPRA OI` |
| Button | always | `Refresh` |

### On the canvas

| Slot | Text |
|---|---|
| Front marker, `dte === 0` | `0DTE` |
| Front marker, otherwise (including a null DTE) | `FRONT` |
| Series line | `SPX · OPEN INTEREST BY EXPIRATION · CONTRACTS` |
| Series line, net mode | `SPX · CALL − PUT OPEN INTEREST BY EXPIRATION · CONTRACTS` (U+2212) |
| Zero gridline label | `0` |
| Other gridline labels | `fmtContracts(g)` → `128K`, `1.4M` |
| Date ticks | `fmtExpiryTick(r.expiry)` → `9/19` |
| DTE ticks | `` `${dte}d` `` → `0d`, `7d` |
| Hover, line 1 | `` `2026-09-19  4d` `` (two spaces) |
| Hover, line 2 | `` `C 1,204,551   P 998,120` `` (three spaces) |
| Hover, line 3 | `` `Total 2,202,671   P/C 0.83` `` |

With **no rows at all**, `draw()` returns immediately after `clearRect` — the canvas is genuinely blank and one of lines 2–4 above is what the user reads.

---

## Performance notes

- **Thirteen requests per ET day, in the worst case.** One `/proxy/gex` (deduped with every other consumer on the board) plus twelve `/api/chains`, once. Every mount after that inside the same ET day answers from `localStorage` with **zero** requests.
- **Neither hop polls.** `/proxy/gex` has `staleMs: 60_000` and no `pollMs`; `/api/chains` has `staleMs: 0` and no `pollMs`. `staleMs` is a TTL, not an interval (`data/api.ts`) — nothing here refreshes on a timer, by design.
- **The twelve legs go together**, not in sequence. `Promise.allSettled`, one `await`.
- **A partial answer is kept.** Nine fulfilled legs out of twelve draws nine bars and says so, rather than failing.
- **A hidden card does not paint**, and `budgets.json`'s `perf.offscreenRepaints` is a **hard zero**: "a card scrolled out of view must not paint at all." `perf.idleRepaintsPerFrame` is `0.15` — easy here, because the idle path has no tick at all.
- **`perf.interactionRepaints` is `10`** and the hover path is a full-canvas repaint per `pointermove`. This is the card's only real per-frame cost.
- **`readPalette` runs once per `draw()`** — five `getComputedStyle` reads. At hover rate that is five style reads per pointer event; it is the one measurable thing in the draw loop.
- **`sizeCanvas` is inline**, not the shared helper: `canvas.width/height` are reassigned on every draw, which resets the backing store each time. Cheap at these sizes, but it is a full allocation per repaint.
- **`data-cb-layer="oi-by-expiry"`** is set at creation, so `scripts/perf-check.mjs` can attribute every repaint to this card — non-negotiable 6.
- **Chunking.** The card is `lazy()`. It pulls in `pages/scanner/gexLevels(.Data).ts`, which are side-effect-free const/function modules that Rollup tree-shakes; `budgets.json` caps `route` at 59,100 brotli bytes and a chunk over budget fails the build.

---

## Gotchas

1. **The cache key is an ET calendar day, not a TTL.** A tab left open across midnight ET will re-sweep on its next mount; a tab open all day never will, no matter how long it sits there.
2. **The card does not poll and must not start.** OPRA publishes once, ~06:30 ET, for the *prior* close. "A card that re-swept twelve full chains every minute would be spending real upstream budget to redraw the same twelve bars."
3. **`CHAINS_STALE_MS` is 0 on purpose.** An in-memory window would swallow the Refresh button's whole reason for existing.
4. **`force` skips the cache read only**, not the sweep. There is no way to clear the cache from the UI other than by overwriting it with a successful sweep.
5. **The localStorage cache is shared with the scanner tab's card 5.** Refreshing here refreshes there for the rest of the day.
6. **The cache has no shape validation.** `loadOiExpiryCache` checks only `date` and `symbol`; a blob from a different `rows` shape would be handed to the renderer as-is. The `v1` in the prefix is the only version marker and nothing bumps it.
7. **A soft-failed `/api/chains` becomes a zero-height column, not a rejection.** `sumChainOi` returns `{0, 0}` for a 200 with no `data.items`, the leg counts as fulfilled, and nothing in the UI says the date is empty rather than genuinely unwritten.
8. **A soft-failed `/proxy/gex` leaves the card on `Waiting for the expiration list…` forever**, with no error and no retry — there is no poll behind it.
9. **An empty `expiration-date` on a chain group is COUNTED, not skipped.** `if (groupExp && groupExp !== …)`. That is v2's behaviour and it matters when the upstream omits the field.
10. **`sumChainOi` accepts both key spellings** (`open-interest` and `openInterest`) and `parseInt`s through a `String()`. Anything unparseable silently becomes `0`.
11. **`rejected` is v3's addition and the only thing standing between "nine bars" and "twelve bars".** v2 dropped them silently. Do not remove the line.
12. **Only a total failure is an error.** One resolved leg out of twelve is a chart with one bar and no error line.
13. **The run-generation guard is load-bearing.** Twelve parallel fetches take long enough for a Refresh to land mid-flight; without `runRef` a stale sweep would overwrite a newer one.
14. **The sweep effect depends on `expiryKey`, a joined string, not on `sweep`.** Depending on the callback would re-fire twelve requests on any render that produced a new array with identical contents. The `eslint-disable` above it is deliberate.
15. **`skipped` must touch nothing but `loading`.** Otherwise the card flashes an empty chart instead of waiting.
16. **`loadedAt` is stamped on the cache path too.** The header time is "when this card last got an answer", not "when OPRA published" — which is why the tooltip spells the publication schedule out.
17. **`FRONT` vs `0DTE` is not cosmetic.** A column headed `0DTE` on a Sunday is a chart telling a small lie every weekend.
18. **`dteOf` clamps at 0** and returns `null` on an unparseable date; a `null` also falls through to `FRONT`.
19. **`dteOf` uses UTC *midnight*; `mgMath.daysBetween` uses UTC *noon*.** Two conventions in one repo for the same job.
20. **No `rgba()`, no `color-mix()`, no hex literal may enter `oiByExpiryRender.ts`.** `withAlpha` builds `#rrggbbaa` byte by byte precisely so `check-theme` finds nothing and `theme-baseline.json` has nothing to hold. Note also that `alpha()` would emit `color-mix()`, which a canvas silently ignores — keeping the *previous* fill rather than throwing.
21. **`tokenHex`-style lookups fail quietly.** `cssVar` returns `''` for a missing property and `hexToRgb` then falls back to a **v2-era RGB triple**, not today's token. Rename `--color-gexbar-pos` and the bars turn `#29b6f6` with no error anywhere.
22. **Bars have a 1px floor.** A zero-OI column still draws a sliver in grouped and stacked modes.
23. **`niceStep` is copied from `gexChartRender.ts`, not imported.** Two copies, same values.
24. **The gridline `continue` skips the LABEL, not the line.** Reordering those two statements would let a value land on the tick rows.
25. **Every `pointermove` repaints the whole canvas.** There is no dirty-rect or layer split.
26. **`canvas.width`/`height` are reassigned on every draw**, which clears and reallocates the backing store each repaint.
27. **The `#n` instance suffix is not threaded in.** A second copy of this card reads the same `cb-v3-oi-by-expiry-mode` key and the same OI cache, so two copies can only ever differ by nothing.
28. **`chainGex.ts` is a neighbour, not a dependency.** It parses the same endpoint into a completely different shape for the cards that need a ladder. Do not "consolidate" the two parsers without deciding which `/api/chains` URL shape wins — one sends `live=0`, the other sends `expiration=`.
