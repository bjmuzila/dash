# `key-levels` — Key Levels · 📏 · default 48 × 24 · `src/board/keyLevels/`

> Catalog entry: `src/board/catalog.tsx:327-338`. `id: 'key-levels'`,
> `icon: '📏'`, `label: 'Key Levels'`, `defaultSize: { w: 48, h: 24 }`,
> `Title: KeyLevelsHeading`, lazy behind `<Deferred>`.
>
> It is the **only** card in the catalog that carries a live header
> (`CardDef.Title`) — `grep -n 'Title:' src/board/catalog.tsx` returns one line.
> `KeyLevelsHeading` wraps the lazily-imported `KeyLevelsTitle` in its own
> `<Suspense fallback={<>Key Levels</>}>`, because *"a dynamic title falls back to
> the PLAIN LABEL while its chunk loads, never to a blank: the header is the only
> thing on a card that is readable before the body arrives, and a title that
> appears a beat after the card does is the board looking broken for a beat."*
>
> `CardDef.Title` must be a **component, never a render function**: *"it holds
> hooks of its own, and a function called inline from BoardPage's render would
> make them BoardPage's hooks — conditionally, which is the rules-of-hooks
> violation that only shows up when a card is added or removed."*

---

## What it is, in one paragraph

Key Levels puts every level the board knows onto one horizontal price rail: put
wall, gamma flip, max pain, the max-gamma strike (CORE), spot, call wall, and —
when it happens to fit inside the picture the gamma already drew — this week's
estimated-move high and low. Each mark is a coloured tick on the rail plus a
label block above or below it carrying the code, the name, the price and its
distance from spot in points. The span between the put wall and the call wall is
tinted, red at the floor through to level-blue at the ceiling: that tinted span is
the corridor gamma is actually defending. The card used to be six tiles in a row,
and the reason it stopped being tiles is the reason it exists: *"Tiles answer
'what is the call wall' one at a time, and the question actually being asked is
'where is price sitting inside the gamma' — which is a question about the
DISTANCES BETWEEN the levels, and six boxes cannot show a distance at all. On one
axis the gap between spot and the wall above it is a gap you can see."*

---

## File map

| File | Lines | What it owns |
|---|---:|---|
| `src/board/keyLevels/KeyLevelsCard.tsx` | 423 | The source split (socket vs chain), the live title, the EM fetch, `MAX_DIST_PCT`, mark assembly, and the 📋 Stats CopyShot target. |
| `src/board/keyLevels/LevelsAxis.tsx` | 229 | The rail itself: domain and padding, the percent mapping, the two-band alternating label placement, the collision `spread()`, the corridor gradient, the spot tick, the `ResizeObserver`. |
| `src/board/keyLevels/levelsMath.ts` | 168 | Pure arithmetic and formatting: `computeMaxPain`, `strikeDp`/`priceDp`, `fmtPx`/`fmtPts`/`fmtUsd`/`fmtPct`, `legValue`, `computeMagnet`, `wallState`, the epsilons. A straight transcription of v2's `Premarket.tsx` derivations. |

Supporting modules:

| File | Lines | Why it matters here |
|---|---:|---|
| `src/data/levels.ts` | 286 | `deriveLevels` — the one definition of a wall, a core and a flip in v3. |
| `src/data/liveGex.ts` | 186 | The SPX path: three frames, the expiry pin, the profile, the level derivation. |
| `src/board/chainGex.ts` | 129 | The non-SPX path: `/api/chains` → the identical row shape + levels. |
| `src/board/cardTitle.tsx` | 50 | `CardHeading` and `fmtContractDate`. |
| `src/data/calculations.ts` | 455 | `computeGEXProfile` (the 60-level BS spot sweep) and `findGEXFlip`. |
| `src/board/gexChart/values.ts` | 324 | `levelsOf`, `netGexOf`, `dexOf` — reused for the VOL-only clipboard row. |
| `src/shell/CopyShot.tsx` | — | `useCopyShotTargets`, `NO_TARGETS`, `CopyShotTarget`. |

`levelsMath.ts` carries three exports this card never calls — `computeMagnet`,
`wallState`, `fmtUsd`, plus `pxEpsilon`/`pinEpsilon`/`legValue`/`BASIS_LABEL`.
They are v2's Premarket derivations, kept *"so the two surfaces cannot disagree
about what a level IS."* `StatCards.tsx` on the GEX Chart imports
`computeMaxPain`, `fmtPx` and `strikeDp` from here.

---

## The data path

### Two sources, and the source *component* is the subscription

```tsx
return onSocket ? (
  <SocketLevels key={symbol} render={body} />
) : (
  <ChainLevels key={symbol} symbol={symbol} render={body} />
)
```

`SocketLevels` is a **component rather than a branch inside the card**:

> "`useField` cannot be called conditionally and subscribing to a frame the board
> is not showing is not free: the socket derives its `?topics=` from what is
> actually subscribed, so an unconditional `useField('gex')` would keep pulling
> SPX frames across the wire on a board that is looking at AMZN. **Not mounting
> the component is what unsubscribes.**"

Both are `key={symbol}` so *"a source swap remounts rather than carrying the
previous ticker's rows into the next one's first render."*

### 1. SPX — `useLiveGex()` (`src/data/liveGex.ts`)

The card reads the hook, **not the raw `gex` frame**:

> "The hook is the ONE place the walls, the CORE and the flip are derived
> (`data/levels.ts`) — this card used to pull the frame's own
> `callWall`/`putWall`/`gexFlip` and then patch them locally, which is how it and
> the premarket rail ended up printing different levels off one feed."

Frames subscribed: `gex`, `spot`, `aux`, `status` — all through `useFrame`.

| Frame | Fields read |
|---|---|
| `gex` | `data.gexRows`, `data.gexFlip`, `data.totalNetGex`, `data.expiry`, `data.updatedAt`, `ts` |
| `spot` | `data.spot`, `data.prevClose` |
| `aux` | `data.esFut` |
| `status` | `expirations[]`, `expiry` |

**The expiry pin.** As soon as the `expirations` list contains today's ET date
(`Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })` — *"a trader in
London gets New York's 0DTE"*), the hook sends:

```ts
send({ type: 'SET_EXPIRY', expiry: today })
```

> "server-v2 tracks the chosen expiry PER CONNECTION, so this has to be
> re-asserted after every reconnect — including the ones `data/socket.ts` makes
> when the topic scope changes. `send()` queues while the socket is down and
> replays on open, which is exactly that guarantee; the local `pinned` state only
> stops the effect re-sending the same request on every render."

`isZeroDte` is `expiry === today`, so a page can say "FRONT" rather than lying
with a "0DTE" badge on a weekend or holiday. (This card does not draw that badge;
its title just prints the date.)

**There is deliberately no REST fallback.** v2 carried a `/api/gex` watchdog poll
for when the socket had been silent. v3 does not:

> "server-v2 DEDUPES the `gex` frame — an unchanged chain broadcasts nothing at
> all — so 'silent' is a normal overnight state rather than evidence of a broken
> socket, and v3 answers the same problem better: the connect SNAPSHOT replays the
> whole ladder on every (re)connect, and the IndexedDB cache paints the last known
> one before that. A watchdog poll on top of those would fire nightly against a
> working feed."

### 2. Every other symbol — `/api/chains`

```ts
useQuery<unknown>(chainGexUrl(symbol), { staleMs: 15_000, pollMs: 15_000 })
```

```
/api/chains?ticker=<SYM>&range=all&live=0
```

*"15s, the cadence Multi Greek polls its ladders on. `staleMs` alone would never
refetch — it is a cache TTL, not an interval."*

`chainToGex(json)` takes `expiries[0]` — the **front expiry only** —
and returns `{ rows, ...deriveLevels(rows, spot), spot, expiry }`. Per-strike
arithmetic is `mgMath.strikeGex()`, transcribed from
`server-v2/computation/gex-calculator.js`:

```
netGEX    = (|callγ|·callOI  − |putγ|·putOI ) · spot² · 0.01 · 100
netVolGEX = (|callγ|·callVol − |putγ|·putVol) · spot² · 0.01 · 100
netDEX    =  callΔ·callOI  ·spot·100 − |putΔ|·putOI ·spot·100
volNetDEX =  callΔ·callVol ·spot·100 − |putΔ|·putVol·spot·100
```

> "No profile flip on this path: `/api/chains` rows carry no IV, so the spot
> sweep has nothing to price and `deriveLevels` falls to the next rung on its own.
> Same function, same order, one fewer answer available."

### 3. `/api/em-tracker` — this week's band

```ts
useQuery<{ rows?: EmTrackerRow[] }>(
  `/api/em-tracker?ticker=${encodeURIComponent(symbol)}`,
  { staleMs: 600_000 },
)
```

| Property | Value |
|---|---|
| Backing | Postgres, owner-gated, one row per (ticker, week) |
| Order | `ORDER BY week_start DESC` — newest first, so `rows[0]` is the current week *"once it has been struck"* |
| Fields read | `week_label`, `em`, `ref_close`, `up`, `down` (`week_start` is declared but unread) |
| `staleMs` | 600_000 |
| `pollMs` | **none** — *"Ten minutes of cache and no poll: this is a weekly number."* |

Parse:

```ts
up   = typeof row.up   === 'number' ? row.up   : (ref != null && em != null ? ref + em : null)
down = typeof row.down === 'number' ? row.down : (ref != null && em != null ? ref − em : null)
if (up == null || down == null || !(up > 0) || !(down > 0)) return null
```

*"`up` / `down` are the band's PRICES and are what the axis wants; `ref_close ± em`
is the fallback for a row imported before the bounds were being stored."*

Note the whole band is all-or-nothing: one missing bound discards both.

### HTTP-200-on-failure

`query()` throws on any non-2xx. Neither `emQ.error` nor the chain query's
`error` is read anywhere in this card, and a failed **poll** keeps the last good
value on screen by design:

> "A failed POLL keeps the last good value on screen. Blanking a chart because one
> refresh in the middle of the day 502'd is worse than showing a number that is
> thirty seconds old."

A **200 whose body is not the expected shape** — an HTML shell, `{}`, `{rows:null}`
— degrades quietly:

* `/api/em-tracker`: `emQ.data?.rows?.[0]` is `undefined` → `weeklyEm = null` →
  the two EM marks are simply not added.
* `/api/chains`: `parseChain` yields no `expiries[0]` (or `underlying <= 0`) →
  `chainToGex` returns `EMPTY_CHAIN_GEX` → `rows: []`, every level `null`,
  `spot: 0` → `emptyFeed` is true and the axis prints `Waiting for levels…`.

There is **no sentence anywhere on this card that names an HTTP failure.** Every
failure looks exactly like "no data yet."

### The refresh button

Every mounted `useQuery` registers a revalidator; `refreshAll()` empties the cache
and calls all of them. It *"refetches underneath what is already drawn and swaps
the value in when it lands"* — deliberately **not** `run()`, because run re-reads
the just-emptied cache *"so every card on the board would flash its loading state
on the way to the same numbers."*

---

## Every derived number

### The four gamma levels — derived upstream, not here

`LevelsBody` receives `callWall`, `putWall`, `core`, `flip` already computed, from
`deriveLevels` (`src/data/levels.ts`). The card's own comment lists three jobs it
used to do here and no longer does:

> * "bump a wall off the CORE when the two collided. Still happens; it is the
>   `exclude` inside `deriveLevels`. The premarket rail never did it, which is why
>   the two surfaces disagreed about the put wall."
> * "take the CORE as the biggest node within ±12 strikes of spot. That window
>   moves with price, so the CORE could jump twenty points on a quote with nothing
>   having changed in the book. It is the whole-board maximum now — the server's
>   Core Bullseye."
> * "repair an implausible flip. Also upstream, and better… This card drew NO flip
>   at all on a positive-gamma board, because every rung it had tested for a
>   cumulative crossing that does not exist there."

The definitions (`levels.ts`), on the **OI+VOL basis, always** for the axis:

```
oiVolNet(r) = (r.netGEX || 0) + (r.netVolGEX || 0)

findCore(rows)              → the strike with the largest |oiVolNet| on the WHOLE chain
findCallWall(rows,spot,ex)  → largest POSITIVE oiVolNet with strike > spot, ex excluded
findPutWall (rows,spot,ex)  → most NEGATIVE oiVolNet with strike < spot, ex excluded
```

`ex` is always `core?.strike`:

> "The CORE is very often the same strike as the call wall — the biggest node on
> the board is frequently the biggest positive node above price — and drawing both
> on one strike loses the second wall entirely, which is the level price actually
> has to get through after the core. Passing the CORE in is a no-op in the usual
> case."

**Why spot is passed in rather than taken from the frame:**

> "server-v2 computes `callWall` / `putWall` / `gexFlip` against the spot it held
> when it built the `gex` frame. Pages then drew those numbers against the newest
> `spot` frame, which ticks several times a second. Nothing re-anchored, so on a
> fast move a wall crossed to the wrong side of price — **a put wall printed ABOVE
> spot**, which `findPutWall` cannot produce and which is how the mismatch was
> first spotted."

### The flip, in preference order

```
flip = profileFlip                                   // 1
    ?? findGEXFlip(rows as ChainRow[], spot)         // 2  (default basis only)
    ?? findCumulativeFlip(rows, spot, value)         // 3
    ?? serverFlip                                    // 4
    ?? null
… then: finite && > 0, else null
```

1. **`profileFlip`** — the Black-Scholes **spot-sweep zero**. `computeGEXProfile`
   re-prices dealer gamma at **60 hypothetical levels** spanning `0.8·spot` to
   `1.2·spot`, finds every sign change, takes the one nearest spot, then
   **bisects against the real model** for up to 24 iterations down to `< 0.05`
   points.

   ```
   bsGamma(S,K,σ,T) = φ(d1) / (S·σ·√T),   d1 = (ln(S/K) + ½σ²T) / (σ√T)
   TotalGEX(S)      = Σ_rows  bsGamma(S, K, IV, T) · (callContracts − putContracts) · 100 · S²
   value            = TotalGEX(S) / 1e9        // $B per 1% move
   ```

   **One IV per strike**, averaged across the two quotes when both are live:
   *"Gamma is identical for a call and a put on the same strike + expiry (put-call
   parity) — it is a property of the contract, not of which side you look at.
   Pricing the call leg off `callIV` and the put leg off `putIV` therefore handed
   the two legs DIFFERENT gammas, so a strike holding equal call and put size
   produced non-zero net GEX purely from the skew between the two quotes."*

   The bisection is itself a fix: *"the profile is curved, so straight-line
   interpolation inside that gap was off by tens of points (that grid error, not
   the model, is what put the chart's flip line ~40pts away from the bar-based
   FLIP tile)."*

   Requires ≥ 5 rows with an IV and contracts under the basis, else `null`.

2. **`findGEXFlip`** — the per-strike sign change, interpolated:
   ```
   zero = sA + (sB − sA) · ( |a| / (|a| + |b|) )
   ```
   **Not the same quantity:** *"it finds where an individual strike's net flips
   sign, not where cumulative exposure crosses zero. Kept only because it answers
   on a chain too thin for the profile."*

3. **`findCumulativeFlip`** — walk ascending accumulating `value(r)`, test
   `prevCum < 0 && cum >= 0`, interpolate, keep the crossing **nearest spot**:
   ```
   x = prevStrike + (strike − prevStrike) · ( −prevCum / (cum − prevCum) )
   ```
   *"'first crossing walking up from the lowest strike' is the server's rule, and
   at the bottom of a ladder the running total is a few far-OTM strikes hovering
   around zero, so one positive strike down there wins the race and returns a flip
   a thousand points from the money."* It returns null more often than it looks
   like it should — on a positive-gamma board the running total never dips below
   zero — *"That is a real state, not a failure — but it is also why this cannot
   be the only answer."*

4. **`serverFlip`** — `gex.data.gexFlip`. The last fallback, not the first answer.

> "The order matters more than any one entry: whichever rung answers, BOTH
> surfaces get that same rung, which is the whole point of this module."

### Max pain — the only level still computed in this card

> "Max pain is computed here rather than read: the server does not publish it, it
> is pure open interest with no gamma in it, and no other surface draws it."

```
withOi = rows where callOI + putOI > 0
if |withOi| < 5 → null
for each candidate strike k in withOi:
  total(k) = Σ_r callOI(r)·(k − strike(r))   for strike(r) < k
           + Σ_r putOI(r) ·(strike(r) − k)   for strike(r) > k
answer = argmin total(k)
```

*"Needs a real open-interest picture — under five rows carrying OI the answer is
noise, so it returns null rather than a number someone might trade off."*
O(n²) over strikes carrying OI.

### Distances (the `note` line under each price)

```
distCall = callWall − spot          // + above
distPut  = putWall  − spot          // − below
distFlip = spot − flipShown         // ⚠ inverted relative to the other two
pain     = maxPain − spot
core     = core.strike − spot
spot     = the literal string "live"
EM       = "wk <week_label>"  or  "weekly em"
```

`fmtPts(v)` → `` `${v >= 0 ? '+' : '−'}${|v| with thousands separators} pts` ``,
zero decimals, U+2212 minus. `null`/non-finite → `—`.

**`distFlip` is `spot − flip`, not `flip − spot`.** Every other distance on the
card is `level − spot`. Nothing in the source explains the inversion; it is
stated here because a reader comparing the FLIP note to the CW/PW notes will
otherwise conclude the sign is a bug.

### Precision

```ts
strikeDp(rows, spot):            // decimals for a STRIKE, from the ladder's own step
  step = min positive adjacent |Δstrike|
  !finite(step) → spot >= 1000 ? 0 : 2
  step < 0.5 → 2 ;  step < 1 → 1 ;  else 0

priceDp(spot) = spot >= 1000 ? 0 : 2   // decimals for a TRADED price
```

`kDp` is used for PW / FLIP / PAIN / CORE / CW; `pDp` for SPOT and both EM marks.

### The axis domain

```
sorted   = marks ascending by price
span     = last.price − first.price
pad      = span > 0 ? span · PAD_FRAC          // 0.06
                    : max(1, first.price · 0.001)
lo = first.price − pad
hi = last.price  + pad
pct(v)   = ((v − lo) / (hi − lo)) · 100
```

> "A single-price axis (every level on one strike) still has to be drawable, so
> give it a nominal width rather than dividing by zero."

Printed in the toolbar as `7,608.12 – 7,694.40 · 86.28 PTS` (two decimals, always).

### Label collision

```
minGapPct = width > 0 ? min(45, (LABEL_W / width) · 100) : 12     // LABEL_W = 96
```

Measured against the real container width through a `ResizeObserver` *"rather than
a guessed percentage: at w:12 this card is ~1400px and at w:6 it is ~700px, and a
gap that works at one overlaps at the other."* The `min(45, …)` cap stops a
narrow card demanding a gap wider than the rail.

Marks alternate bands by **index in price order** — even → above, odd → below —
and the two bands are spread **independently**, *"a label above only has to clear
the other labels above it."*

`spread(positions, minGapPct)` is three passes:

1. Left to right: `if (cur − prev < gap) cur = prev + gap`.
2. Right to left from the edge, so *"a run pushed past 100% comes home instead of
   piling up off the end"*: the last one is capped at `100 − gap/2`, each earlier
   one at `next − gap`.
3. Floor everything at `gap/2`.

> "Only the LABEL moves — the tick stays on the price. A label that has been
> pushed is still unambiguous because its tick is still where the number says it
> is; a label that has been dropped is information gone."

### `MAX_DIST_PCT = 0.025` — when a level is dropped entirely

```ts
if (key !== 'spot' && spot > 0 && Math.abs(price - spot) > spot * MAX_DIST_PCT) return
```

> "The axis spans its own marks, so the FURTHEST one sets the scale for all of
> them. One level a thousand points from spot therefore does not just add a label
> out on the left — it compresses put wall, max pain, core, spot and call wall into
> a few pixels at the other end, and the card stops being able to answer the only
> question it exists for.
>
> So a level beyond this fraction of spot is not drawn at all. 2.5% is ~190 points
> on a 7,650 SPX, which comfortably contains a real day's walls, and scales on its
> own for a $214 name (~$5) — a fixed point budget would be nonsense on anything
> but the index.
>
> Dropping a level is honest here in a way it would not be in a table: this is a
> picture of where price sits inside the gamma, and something a thousand points
> away is not part of that picture. **SPOT is never dropped.**"

A mark is also silently skipped when `price == null`, non-finite, or `<= 0`.

### The EM band's second, stricter gate

The EM marks are added **only if they already fit the range the gamma marks
produced**:

```ts
lo = min(out.price), hi = max(out.price)         // over the marks already added
fits = (v) => v >= lo && v <= hi
if (fits(down)) add('emd', …)
if (fits(up))   add('emu', …)
```

> "The gamma levels set the scale. A weekly band on a quiet week sits inside them
> and is the most useful thing on the card; on a wide week it can be fifty points
> outside the put wall, and putting it on the axis would squash every level that
> matters into the middle third to make room for a number nobody is trading
> against today. So it is drawn only if it already fits the picture the gamma
> drew."

Note the asymmetry this produces: it is entirely normal to see the EM **low**
drawn and the EM **high** absent, or vice versa. Both still pass the
`MAX_DIST_PCT` test inside `add`, so the band has two gates to clear.

---

## Every control

**There are none.** Key Levels has no chips, no segmented groups, no cog, no
ticker box and no persisted settings — **no `localStorage` key, no settings blob,
no version number, and therefore nothing for a stale stored value to coerce to.**

What would be controls on another card are fixed:

| Would-be control | Fixed at | Where that is decided |
|---|---|---|
| Symbol | the board's page symbol | `usePageSymbol()` — the toolbar search, stored under `cb-v3-page-symbol` |
| Basis (axis) | `oi-vol`, always | `deriveLevels`' default `value = oiVolNet` |
| Basis (clipboard) | `vol-only`, always | `levelsOf(rows, spot, 'vol-only')` |
| Which levels | six, plus a conditional EM pair | the `add()` calls in `marks` |
| Reach | 2.5% of spot | `MAX_DIST_PCT` |

The page symbol itself is stored at `cb-v3-page-symbol` and validated on read
against `PAGE_TICKER_RE = /^[A-Z][A-Z.]{0,5}$/`; anything that fails coerces to
`'SPX'`. A switch is logged fire-and-forget to `/api/ticker-event` under source
`"home"` with event `click`; the symbol the board *opened* on logs `render` once
per mount. *"A free (non-subscriber) session gets a 403 here and that is fine —
nothing reads the response."*

### The one real interaction: 📋 Stats

Registered through `useCopyShotTargets` — *"it appears in the menu for exactly as
long as it is worth capturing… Nothing has to be registered centrally, and a card
that never registers simply is not offered."* The array is memoised and falls back
to the exported `NO_TARGETS` constant, because *"the list identity is the effect's
dependency; a fresh array literal every render republishes on every render."*

```ts
{
  id: 'key-levels-stats',
  icon: '📋',
  label: 'Stats',
  hint: 'Copy the VOL-only levels as TEXT — ticker, core, both walls, net GEX and net DEX',
  group: 'Home board',
  capture: async () => (await import('@/shell/snapshot')).copyText(text),
}
```

The payload, six lines, newline-joined:

```
Ticker: SPX
Core: 7650
Call Wall: 7700
Put Wall: 7600
Net Gex: +$1.24B
Net Dex: -$430.12M
```

**Text rather than a PNG, on purpose:**

> "this gets pasted into a Discord message and typed around. It can be quoted,
> searched, corrected and copied on again, and a phone reads it aloud. A
> screenshot of six numbers can do none of that, and it is the one thing on this
> board where the numbers ARE the content — there is no chart to look at."

**And it is VOL-ONLY, which deliberately disagrees with the axis above it:**

> "Every one of the six lines is read on the VOLUME basis — today's traded book —
> where the axis draws OI+VOL, the standing one. That is a real disagreement
> between the card and its own clipboard row, and it is the point: the line gets
> pasted into a message about what is happening TODAY, and open interest is
> yesterday's positioning carried forward."

The levels are **re-derived**, never re-implemented:
`levelsOf(rows, spot, 'vol-only')` is *"the SAME finders run against `volNet` —
one definition, other basis, never a second local derivation."*
Totals: `Σ netGexOf(r,'vol-only',false)` and `Σ dexOf(r,'vol-only')`.

The signs and the dash are different here too:

* `money()` uses **ASCII `-` and `+`**, not `fmtGexShort`'s U+2212 — *"that minus
  exists to stop a signed column jittering in a table, and outside a table it is a
  character that pastes oddly and does not match a search for '-'."*
* The plus is **explicit** on both totals: *"Positive and negative gamma are two
  different regimes and 'which one' is the first thing anyone reads off this line
  — leaving the plus to be inferred from the absence of a minus is exactly the
  ambiguity to avoid in a message someone skims."*
* `money()`'s sub-$1K branch is `toFixed(0)`, where `fmtGexShort`'s is `toFixed(2)`.
* `level()` is `v.toFixed(kDp)` — **no thousands separators**, unlike `fmtPx` on
  the axis. So the axis shows `7,650` and the clipboard shows `7650`.

The target is `NO_TARGETS` whenever `!rows.length || !(spot > 0)`, so the row
disappears from the camera menu rather than copying six em dashes.

CopyShot is owner-gated, *"and that is chrome… It is not a permission: the capture
runs entirely in the browser against pixels the viewer can already see."*

---

## Rendering

### DOM only — no canvas, no SVG

Key Levels is the most DOM-native card on the board: a stack of absolutely
positioned `<div>`s inside one `relative` wrapper. No `<canvas>`, so no
`data-cb-layer` and nothing for `scripts/perf-check.mjs` to attribute. No
`ChartFrame`, so no `IntersectionObserver` visibility gate.

### Layout constants

| Constant | Value | Meaning |
|---|---:|---|
| `LABEL_W` | 96 | label block width in px; the collision pass keeps this much clear |
| `PAD_FRAC` | 0.06 | breathing room at each end of the rail, as a fraction of span |
| `MAX_DIST_PCT` | 0.025 | a level further than this fraction of spot is not drawn |
| `NEAR_HALF` | 12 | strikes either side of spot for `computeMagnet` — **unused by this card** |
| rail height | `13px` | `rounded-full bg-raised`, at `top-1/2 -translate-y-1/2` |
| level tick | `19 × 2 px` | `rounded-full`, `zIndex: 1` |
| spot tick | `24 × 3 px` | `rounded-full bg-fg`, `zIndex: 2` |
| label offset | `calc(50% + 14px)` | `bottom-` above the rail, `top-` below it |

Every horizontal position is a **percentage, not a pixel** — *"so the strip is
happy at any card height the user drags it to."*

### Structure

```jsx
<div class="flex min-h-0 flex-1 flex-col">
  <CardToolbar>  7,608.12 – 7,694.40 · 86.28 PTS  </CardToolbar>
  <div ref={wrapRef} class="relative min-h-0 flex-1">
    <div class="absolute inset-x-0 top-1/2 h-[13px] -translate-y-1/2 overflow-hidden rounded-full bg-raised">
      {corridor && <div class="absolute inset-y-0" style={{ left, width, background: <gradient> }} />}
    </div>
    {spotPct != null && <div class="…h-[24px] w-[3px]… bg-fg" style={{ left, zIndex: 2 }} />}
    {rows.map(…)}   {/* tick + label block per mark */}
  </div>
</div>
```

The domain line lives **in the Card's header**, not on a title row of its own —
*"the Card already says 'Key Levels', and a second heading inside it is the
two-toolbar problem in a different costume."*

### The corridor gradient

Drawn only when **both** a `pw` and a `cw` mark survived:

```css
linear-gradient(to right,
  color-mix(in srgb, var(--color-level-pw) 70%, transparent),
  color-mix(in srgb, var(--color-muted)    12%, transparent) 50%,
  color-mix(in srgb, var(--color-level-cw) 70%, transparent))
```

Positioned at `left: min(from,to)%`, `width: |to − from|%`, clipped by the rail's
`overflow-hidden rounded-full`. *"That tinted span is the corridor — the part of
the axis gamma is actually defending."*

This is one of the very few places a `color-mix()` is written inline in a
component rather than coming through `design/theme.ts`'s `alpha()`; it is not a
colour literal, so it passes `check-theme.mjs` — the tokens are still the only
place a value is written.

### Colours — one token per mark

| Mark | `colourVar` | Hex in `tokens.css` | Note |
|---|---|---|---|
| `pw` — PW · Put Wall | `--color-level-pw` | `#ff5fa2` | a clay/pink, not a red |
| `flip` — FLIP · Gamma Flip | `--color-accent` | `#2f6bff` | **not** `--color-warn`, which is what the GEX Chart's Flip tile uses |
| `pain` — PAIN · Max Pain | `--color-muted` | `#e7ece9` | deliberately colourless |
| `core` — CORE · Max γ Strike | `--color-level-cb` | `#ffd166` | CB gold |
| `spot` — SPOT · Spot | `--color-fg` | `#e7ece9` | the tick is `bg-fg`, taller and on top |
| `cw` — CW · Call Wall | `--color-level-cw` | `#4d8cff` | |
| `emd` / `emu` — EM | `--color-warn` | `#ffd166` | one hue for both edges |
| rail plate | `bg-raised` | `color-mix(in srgb, #141a21 92%, #e7ece9)` | |
| domain line | `text-muted` at `opacity-60` | `#e7ece9` | |

`--color-level-*` is *"the wall palette shared by the Key Levels tiles, the Multi
Greek ladder badges and any future levels rail. cb = Core Bullseye / magnet, cw =
call wall, pw = put wall."* Both EM marks take one hue on purpose — the reasoning
attached to `--color-level-em` in `tokens.css` applies here too: *"they are the
two edges of one band, not a bullish level and a bearish one, and painting them
`--color-up` / `--color-down` would read as direction where the band is symmetric
by construction."* (Key Levels uses `--color-warn` rather than
`--color-level-em`; `--color-level-em` is the daily band on GEX Candles.)

The label block's price line is `text-fg`; the code·name line and the note line
take the mark's own colour; the optional `sub` line is `text-muted opacity-60`.
**Nothing in this card ever sets `sub`** — it exists on `AxisMark` for a caller
that wants a fourth, dimmer line ("the level's dollar gamma").

### Type scale

| Element | Class | px |
|---|---|---:|
| `CODE · NAME` | `text-3xs font-black uppercase tracking-[0.08em]` | 9 |
| Price | `tabular font-mono text-base font-extrabold` | 15 |
| Note | `tabular font-mono text-3xs` | 9 |
| `sub` (unused) | `tabular font-mono text-3xs` | 9 |
| Domain line | `tabular font-mono text-2xs` | 10 |
| Empty state | `text-xs` | 11 |

### Two structural rules

* **Spot is drawn over everything.** `zIndex: 2` against the ticks' `1` —
  *"'where price is' must never be the ambiguous mark on this card."*
* **Everything is `pointer-events-none`.** Ticks and labels alike. There is no
  hover, no tooltip and no click target anywhere on the axis.

### `stale`

```jsx
<div className={['flex min-h-0 flex-1 flex-col', emptyFeed ? 'stale' : ''].join(' ')}>
```

`emptyFeed = rows.length === 0 && !spot`. The `.stale` utility in `tokens.css` is
`opacity: 0.55; transition: opacity 120ms ease-out`.

### `data-capture-meta`

Just the symbol.

> "For the caption under a CopyShot: the shot drops the Card header, and on this
> card that header is the live `KeyLevelsTitle` — the only place the symbol
> appears."

### The live title

```
AMZN - Key Levels - 8-31-26
```

Three parts and a fixed order.

> "The date is the part that earns this file — a levels board with no expiry on it
> is a board you cannot check against a chain, and 'which expiry is this' is the
> first question asked of every gamma number in the product."

`fmtContractDate('2026-08-31')` → `8-31-26`; anything that is not an ISO date is
*"passed through untouched rather than reformatted into a guess."* An empty date
drops its separator rather than printing a dash with nothing after it.

`KeyLevelsTitle` is split by symbol **the same way the card is, and for the same
reason** — an unconditional `useField('gex')` would keep SPX frames on the wire
while the board is looking at AMZN.

> "It costs nothing extra to read the expiry twice: on SPX both readers are the
> same store subscription, and off SPX both are the same `/api/chains` URL, which
> `useQuery` dedupes to ONE request."

`ChainTitle` uses `parseChain(q.data).expiries[0]?.expiration` — parsed *"rather
than re-derived through `chainToGex()`, which would recompute every strike's gamma
to read one string"* — and it reads the same element `chainToGex` picks, *"so the
heading can never name an expiry the axis was not built from."*

### One deliberate difference from v2

> "no ES sub-line. v2 prints 'ES 6,880' under each level because its charts are ES
> futures and its levels are SPX cash. v3 dropped the futures, so a level is quoted
> in the units it is already in and the whole `/proxy/es-spx-basis` path went with
> it."

### What went with the migration

> "The `/api/premarket-baseline` fetch went with the migration notes. A level's
> note is now its DISTANCE and nothing else — 'building', 'eroding', 'deepening',
> 'rose 15' are gone, and with them the only thing that request fed. A word that
> says a wall is thickening is a second reading laid on top of a price, and this
> card is the price."

`wallState()` in `levelsMath.ts` is the surviving fossil of that feature —
*"Under 2% either way is called unchanged: a wall that moved 1% is a wall that did
not move, and labelling it 'building' reads as a signal where there is none."*
Nothing in this card calls it.

---

## Phone / expanded / replay

* **Phone.** Key Levels is **not** on the phone build. `src/mobile/pages/` mounts
  four board cards — `GexChartCard` (`MGex`), `MultiGreekCard` (`MHeat`),
  `GexCandlesCard` (`MSpx`) and `EconCalendarCard` (`MEcon`) — and Key Levels is
  not among them. There is no `/m/levels` route and the card has no `simple` prop
  or other phone variant. Eight label blocks at
  `LABEL_W = 96` need ~768px of rail before the collision pass starts stacking,
  against a 390px phone.
* **Expanded.** Generic only, via `design/primitives/Expand.tsx` — one card at a
  time, Escape to collapse. This card **benefits** from it more than most: the
  `ResizeObserver` recomputes `minGapPct` from the new width, so expanding a
  crowded axis genuinely un-crowds it rather than just scaling it up. Height is
  wasted, though: the rail is pinned to `top-1/2` and the labels sit a fixed 14px
  either side of it, so a taller card is empty above and below.
* **Replay.** **None.** No replay dock, no date parameter, no rewind. Every source
  is "now": the live socket, a 15-second chain poll, and the current week's EM row.

---

## Status and empty-state messages, verbatim

There is exactly **one** sentence on this card.

| Text | Where | When |
|---|---|---|
| `Waiting for levels…` | returned in place of the whole axis, `className="px-1 py-3 text-xs text-muted opacity-50"` | `LevelsAxis`'s `model` is `null`, i.e. `marks` is empty |

`marks` is empty when no `add()` call survived — in practice:

* before the first `gex` frame or the first `/api/chains` response lands
  (`rows: []`, `spot: 0`, every level `null`);
* after a symbol change, because the source component is remounted by `key`;
* when `/api/chains` answers with something `parseChain` cannot use
  (`EMPTY_CHAIN_GEX`);
* on a ladder where spot is known but every level is `null` or further than 2.5%
  from it — note **SPOT alone is enough** to keep the axis alive, so this state is
  rare once a real spot exists.

Everything else that is missing is missing **silently**:

| Missing thing | What is drawn |
|---|---|
| A single level (`null`, non-finite, `<= 0`) | nothing — the mark is not added |
| A level beyond `MAX_DIST_PCT` | nothing — no ghost, no edge marker |
| Both EM bounds | nothing |
| One EM bound outside `[lo, hi]` | that edge only is omitted; the other is still drawn |
| A wall with no distance | the note line reads `—` (`fmtPts(null)`) |
| Max pain with fewer than 5 OI rows | the mark is not added |
| No `pw` or no `cw` | the corridor tint is not drawn; the rail stays plain `bg-raised` |
| No spot | no spot tick (`spotPct` is `null`) |
| A failed fetch | nothing at all — no error line exists on this card |
| An empty feed (`rows.length === 0 && !spot`) | the body is dimmed to 55% by `.stale` |

The expiry in the title is likewise dropped, not em-dashed: `CardHeading` renders
the separator and the date only when `fmtContractDate` returned something.

---

## Performance notes

### Render cadence

* **SPX.** `useLiveGex` calls `useFrame` on four types. `useFrame` *"re-renders on
  every message for that type"* — and `spot` is a ~10 Hz topic. So `LevelsBody`
  re-renders about ten times a second whenever the market is live. That is the
  most expensive structural fact about this card, and it is unmitigated: there is
  no `TILE_SPOT_MS`-style throttle here the way there is on the GEX Chart, and no
  `useField` selector narrowing the subscription the way there is on the Gauge
  Rail.
* **Non-SPX.** One `useQuery` at `pollMs: 15_000`, plus the EM query with no poll.
  Two or three renders a minute.

### What runs per render, and what does not

| Work | Memoised on | Cost |
|---|---|---|
| `computeGEXProfile` (60 × n BS gammas + ≤24 bisection evals) | `[chain, spot, dataMode]` inside `useLiveGex` | **recomputes on every spot tick**, because `spot` is a dependency |
| `deriveLevels` (4 × O(n), plus the flip walk) | `[rows, spot, profile, serverFlip]` | recomputes on every spot tick |
| `computeMaxPain` — **O(n²)** | `[rows]` | only on a new ladder |
| `strikeDp` | `[rows, spot]` | recomputes on every spot tick |
| `marks` | 13 deps, including `spot` | recomputes on every spot tick |
| `weeklyEm` | `[emQ.data]` | once |
| `statsTargets` | `[rows, spot, symbol, kDp]` | recomputes on every spot tick; publishes to CopyShot |
| `model` (sort, `pct`, two `spread` passes) | `[marks, spotPrice, width]` | recomputes on every spot tick |

`computeMaxPain` is the only genuinely quadratic item and it is the only one
correctly insulated from the spot topic.

### The `ResizeObserver`

One per card, observing the axis wrapper, writing `el.clientWidth` into state.
It is the **only** thing that makes the collision gap correct at more than one
card width. Before `width` lands, `minGapPct` falls back to a flat `12`.

### Request deduplication

Off SPX, `ChainLevels` and `ChainTitle` both call
`useQuery(chainGexUrl(symbol))` with identical options. `query()` dedupes by URL —
*"Two panels asking for the same URL in the same tick make one request"* — and
two loads of the same URL *"share one promise and cannot resolve out of order."*
The same applies to a GEX Chart card on the same board with the same symbol.

### Lazy loading

Both the card and its title are separate `lazy()` imports of the same module, so
the chunk is fetched once and the title's `Suspense` resolves with it.

### No paint gate

No `ChartFrame`, no canvas, no `data-cb-layer`. An offscreen Key Levels card keeps
re-rendering at the `spot` topic's rate, and `scripts/perf-check.mjs` — which
counts repaints on tagged canvases only — cannot see it. What saves it is that a
React re-render producing an identical tree is cheap next to a canvas redraw; what
does not save it is that `computeGEXProfile` runs inside that same cadence.

---

## Gotchas

1. **`netGEX` alone is not OI+VOL.** It is the OI leg; `netVolGEX` is the volume
   leg; the axis reads their **sum**. `chainGex.ts` calls the confusion *"the
   single easiest thing to get wrong about this shape."*

2. **The axis is OI+VOL and the clipboard is VOL-only.** That disagreement is
   deliberate and documented. Do not "fix" it by aligning them.

3. **The clipboard prints `7650`, the axis prints `7,650`.** Different
   formatters: `level()` is `toFixed(kDp)`, `fmtPx` is `toLocaleString`.

4. **The clipboard uses ASCII `-`, the card uses U+2212 `−`.** "Outside a table
   [U+2212] is a character that pastes oddly and does not match a search for '-'."

5. **A level more than 2.5% from spot is not drawn at all** — no ghost, no edge
   marker, no note. `MAX_DIST_PCT` silently removes it. SPOT is exempt.

6. **The EM band has two gates,** not one: `MAX_DIST_PCT` inside `add()`, and the
   `fits(lo, hi)` test against the gamma marks' own range. Seeing one EM edge and
   not the other is normal.

7. **`distFlip` is `spot − flip`.** Every other distance on the card is
   `level − spot`. The FLIP note's sign is inverted relative to CW/PW/PAIN/CORE.

8. **The core and a wall can never share a strike** — `deriveLevels` passes the
   core as `exclude` to both wall finders. That exclusion did not exist on the
   premarket rail, *"which is why the two surfaces disagreed about the put wall."*

9. **The CORE is the whole-board maximum, not a near-spot magnet.** The ±12-strike
   window version was removed because *"its edges move with price, so a node can
   enter and leave the running on a quote rather than on any change in
   positioning, and the CORE appears to jump twenty points while nothing
   happened."* `computeMagnet` is still exported from `levelsMath.ts`; this card
   does not call it.

10. **Never re-derive walls from the frame's own `callWall`/`putWall`.** They were
    computed against the server's spot, not the one on screen, and on a fast move
    that produced a **put wall above spot**. `deriveLevels(rows, spotOnScreen)` is
    the fix, and this card reading the hook rather than the frame is how it stays
    fixed.

11. **`useLiveGex` subscribes to `spot` at ~10 Hz, and there is no throttle.**
    `computeGEXProfile` (60 Black-Scholes evaluations per row, plus up to 24
    bisection passes) is memoised on `[chain, spot, dataMode]`, so it re-runs on
    every tick. If this card ever shows up in a profile, that is where to look.

12. **The `SocketLevels` / `ChainLevels` split is the subscription.** Collapsing
    them into one component with a conditional hook, or hoisting `useField`
    unconditionally, puts SPX frames back on the wire for an AMZN board. *"Not
    mounting the component is what unsubscribes."*

13. **`CardDef.Title` must stay a component.** A render function called inline
    from `BoardPage` makes its hooks `BoardPage`'s hooks, conditionally — a
    rules-of-hooks violation that only fires when a card is added or removed.

14. **The title's Suspense fallback must stay the plain label,** never a blank or
    a spinner.

15. **Max pain is `null` under five rows carrying OI,** and it does not move with
    any basis switch — it is pure open interest.

16. **The flip's first rung is unavailable off SPX.** `/api/chains` rows carry no
    IV, so `computeGEXProfile` has nothing to price and the chain path starts at
    rung 2. The same is true, for a different reason, of the GEX Chart's stat row,
    which is why its FLIP tile *"can differ by a point or so"* from this one on
    SPX.

17. **The flip legitimately answers `null`.** `findCumulativeFlip` tests for an
    **up** crossing, and on a positive-gamma board the running total never dips
    below zero. *"That is a real state, not a failure."*

18. **`spread()` moves labels, never ticks.** Do not "fix" a label that looks
    offset — its tick is on the price, which is the point.

19. **`minGapPct` is `12` until the `ResizeObserver` fires.** The first paint of a
    crowded axis can overlap for a frame.

20. **`LABEL_W` is used twice** — as the collision budget *and* as the label
    block's actual CSS `width`. Change one and you have changed both.

21. **`AxisMark.sub` is never populated by this card.** It renders a fourth,
    dimmer line if a future caller sets it.

22. **Nothing on the axis is interactive.** Every tick and label is
    `pointer-events-none`. There is no hover readout and no tooltip.

23. **There is exactly one status sentence, `Waiting for levels…`, and no error
    line at all.** A 502, an HTML-200 and a genuinely empty market all look
    identical on this card.

24. **`.stale` needs BOTH conditions.** `emptyFeed = rows.length === 0 && !spot` —
    a card with a live spot and no ladder is not dimmed.

25. **The 📋 Stats row vanishes from the camera menu** when `!rows.length || !(spot > 0)`,
    rather than offering to copy six em dashes. Keep returning `NO_TARGETS` (the
    shared constant) rather than a fresh `[]`, or the effect republishes every
    render.
