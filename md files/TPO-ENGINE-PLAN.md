# TPO / Market Profile Engine — Build Plan

## What already exists (reuse, don't rebuild)

| Asset | Path | Gives you |
|---|---|---|
| Value Area math | `lib/valueArea.ts` | POC / VAH / VAL / LVN, fixed-bin, 70% expansion |
| Balance quadrant | `lib/balanceImbalance.ts` | Balance→Shift→Imbalance→Rebalance state machine vs prior VA |
| IB stats engine | `lib/ibStats.ts` | 3yr baked ES CSV, `buildDays()`, IB rule backtester |
| Volume profile | `app/es-candles/page.tsx` `buildVolumeProfile()` | volume-weighted POC/VAH/VAL/LVN, "Profile" toggle |
| **TPO profile** | `app/es-candles/page.tsx` `buildTpoProfile()` | **real 30-min-period TPO counts**, POC/VAH/VAL, gray-box ETH→RTH strip, "TPO" toggle |
| Session bars | `es_candles` (PG) + `useEsCandles` | 5m ES/NQ RTH, ET-session-dated |

**Gap:** TPO-count VA is already correct and rendering. What's missing is everything *downstream* of it:
- No **letters** (it's boxes, not A/B/C rows) → no single prints, no tails, no day-type shape.
- No **IB** (first two 30m periods are never isolated).
- No **rules** — nothing consumes the profile to emit a bias, target, or alert.
- No **gauges/stats** — no persistence, no backtest, no hit rates.
- `buildTpoProfile` is trapped inside `page.tsx` — it must be lifted into `lib/tpo.ts` to be reusable by the recorder, the backtester, and the signals engine.

So Phase 0 is a **lift + extend**, not a rewrite.

---

## Phase 0 — `lib/tpo.ts` (lift `buildTpoProfile` out of the page, then extend)

Move `buildTpoProfile` (currently `app/es-candles/page.tsx` ~line 132) into `lib/tpo.ts` unchanged, re-import it in the page (zero visual change), **then** add the derived fields below. Pure functions, no React — the recorder, the backtester and the signals engine all need to call this server-side.

```ts
buildTpo(bars, { tickSize, periodMin = 30, vaPct = 0.70 })
```

Returns:

```ts
{
  rows: { price, letters: string[], count: number }[]  // A,B,C… per 30m period
  poc, vah, val, mid                                    // TPO-count based (not volume)
  ibHigh, ibLow, ibRange                                // A+B periods
  periodCloses: number[]                                // NEW — needed for excess detection
  singlePrints: { price, zone: 'top'|'bottom'|'mid' }[] // count === 1
  tails:   { top: Range|null, bottom: Range|null }      // ≥2 consecutive singles at an extreme
  excess:  { top: boolean, bottom: boolean }            // tail WHOSE period closed back inside
  poor:    { high: boolean, low: boolean }              // flat stack at extreme, no tail = unfinished
  holes:   Range[]                                      // mid-profile singles = thin/fast zones
  extension: { up: number, dn: number }                 // range beyond IB
  openType: 'ODD'|'OTD'|'ORR'|'OA'                      // open-drive/test-drive/rejection-reverse/auction
  dayType: 'normal'|'normal-var'|'trend'|'double-dist'|'neutral'
  vaOverlap: number                                     // % overlap w/ prior VA
  shape: 'b'|'p'|'D'|'B'                                // profile letterform
}
```

Note the bins already carry per-period touch counts — `letters`, `singlePrints`, `tails`, and `ibHigh/ibLow` all fall straight out of the period loop that exists today (it already tracks each period's touched range). This is a small extension, not new math.

Volume profile (`computeValueArea` / `buildVolumeProfile`) stays alongside as the **confluence layer** — TPO VA vs Volume VA divergence is itself a signal (time accepted ≠ volume accepted = weak value). You render both toggles already; nobody is *comparing* them yet.

---

## Phase 1 — The if/then rulebook (`lib/tpoRules.ts`)

Every rule is `{ id, label, when(ctx), then: {bias, target, invalidation, confidence} }`. Evaluated once per bar close, emits into the existing **signals engine** (`server-v2/signals-engine.js`) so alerts land on `/home` signals feed for free.

### A. Open location (fires 9:31, sets the day's frame)

| If | Then |
|---|---|
| Open **inside** prior VA | Rotational bias. Fade VAH/VAL. Target POC. Confidence ↓ if IB wide. |
| Open **outside** prior VA, no gap (within prior range) | ~70–80% VA-return setup. Target prior VAH/VAL → POC. Invalidate on 2×30m acceptance further out. |
| Open **above prior high / below prior low** (gap) | Gap rules: hold 1st 30m outside = trend day risk. Fill-fade only if price re-enters prior range within 60m. |
| Open inside prior VA **and** prior day closed mid-VA | Balance day. Highest odds of POC magnet, lowest odds of trend. |

### B. Initial Balance (the highest-value stat block)

- **IB width percentile** vs trailing 60 sessions → `narrow` (<33%) / `normal` / `wide` (>66%).
- **Rules:**
  - Narrow IB + break with 30m acceptance → extension target **1× IB** then **2× IB**. (This is the classic; backtest it, don't trust 97%.)
  - Wide IB → fade the IB extremes toward POC; extension odds drop hard.
  - IB high formed first vs IB low formed first → track **opposite-side sweep rate** (this is the @LexxFutures-style stat; `ibStats.ts` already has the day loader to compute it).
- **Gauge:** `IB Extension` — % of IB range currently extended, ± sides, with 1×/2× target ticks.

### C. Value Area

- **VA break:** close outside VAH/VAL → `shift` (already built).
- **Acceptance:** 2 consecutive 30m TPO periods printing majority outside → `imbalance` (already built, re-key from 5m bars to 30m periods).
- **VA overlap w/ prior day:**
  - >70% overlap → balance/continuation of balance → fade edges.
  - <30% overlap → value migrated → trend continuation, don't fade.
- **VPOC migration:** 3-day POC slope. Rising POC + value higher = structurally bullish. Emit as a **bar gauge** (−100…+100).

### D. Single prints / tails

- Prior-session singles = **magnet levels**. Log to PG (`tpo_singles`) same way `gex_levels_history` is logged, so they persist as levels forever.
- **If** price enters a prior single-print zone **and** delta/flow confirms → expect **fast traverse** (thin = low resistance), not reaction. Alert type: `thin_zone_traverse`.
- **If** single prints get *filled* today (repaired) → imbalance resolved, structure neutralized.
- Tail ≥ 3 TPOs at an extreme = strong rejection → that extreme is a hard reference until broken with acceptance.

### D2. Tails vs Excess vs Single Prints — get the definitions right

These are three different things and traders (and most software) conflate them. Encode them separately:

```ts
// bin.count === 1  →  a single TPO print
singlePrint  = bin where count === 1
tail         = ≥2 CONSECUTIVE single prints at the TOP or BOTTOM extreme of the profile
excess       = a tail that was created by a REJECTION — i.e. the period that
               printed it CLOSED back inside the profile body
buyingTail   = tail at the LOW  (sellers rejected → buyers took control)
sellingTail  = tail at the HIGH (buyers rejected → sellers took control)
poorHigh/Low = the OPPOSITE: 2+ TPOs stacked flat at the extreme, NO tail.
               Unfinished auction. Very high odds of being revisited.
buyersHole   = single prints in the MIDDLE of the profile (not at an extreme)
               — a gap in acceptance, price ripped through. A "thin zone."
```

**Why the distinction matters — the trade is opposite:**

| Structure | Meaning | Rule |
|---|---|---|
| **Excess / tail** (2+ singles at extreme, closed back in) | Auction ended properly. A real high/low. | **Level holds.** Fade back toward POC. Only invalidate on acceptance beyond the tail's origin. |
| **Poor high / poor low** (flat stack at extreme, no tail) | Auction ran out of time, not buyers/sellers. Unfinished. | **Level does NOT hold.** Expect it to be taken out. Trade *toward* it. Log to `tpo_naked_poc`-style table with `repaired_at`. |
| **Buyer's/seller's hole** (singles mid-profile) | No acceptance, price traversed fast. | **Thin zone.** Price accelerates *through*, doesn't react. Never place a target inside one — targets go on the *far side*. |
| **Single-print tail base** (first single of a tail) | The origin of the impulse. | Best S/R of the three. Alert `tail_base_retest`. |

**Implementation notes / gotchas:**

- **Excess needs the period's close, not just its range.** `buildTpoProfile` currently only tracks each period's touched high/low. Add `periodClose` so you can test "did this period close back inside the body?" — without it you cannot distinguish real excess from a fast trend leg that simply left singles behind (a trend day's singles are *continuation*, not rejection — opposite trade).
- **Single prints are bin-size dependent.** At `binSize = 1` ES point you'll get plenty. Too fine → everything's a single; too coarse → none. Sweep `binSize` in the backtest (0.5 / 1 / 2 / 4) and pick by hit rate, not by eye.
- **Only profile RTH for singles.** The existing ETH→RTH strip is great visually, but ETH single prints are a liquidity artifact, not an auction failure. Compute singles/tails/excess on the **RTH profile only**; keep ETH for context.
- **Persistence is the whole point.** A tail is worth almost nothing intraday and a LOT as a naked level 3 weeks later. Table:
  ```sql
  tpo_structures(
    id, symbol, session_date,
    kind,            -- 'tail' | 'excess' | 'poor_high' | 'poor_low' | 'hole' | 'naked_poc'
    price_lo, price_hi, side,        -- 'up' | 'down'
    created_ts,
    tested_at, repaired_at,         -- nullable; recorder fills these forward
    touches int default 0
  )
  ```
  A nightly job walks new candles and marks `tested_at` / `repaired_at`. **That forward-fill is what turns this into a stats engine** — it gives you "untested tails get tested within N sessions X% of the time," which is the actual tradeable number.

**Stats to produce (these are the deliverable, not the drawing):**

- Excess-high/low **hold rate** — % of sessions where a tail extreme was not exceeded that day / that week.
- **Poor high/low repair rate + time-to-repair** — the highest-conviction MP stat there is. (Expect high; verify.)
- **Hole traverse rate** — when price enters a prior single-print hole, % of the time it crosses the entire hole without a >X-pt pause. If this is high, it changes your *target placement rules* everywhere in the app.
- **Naked POC touch rate** by age bucket (1–5 / 6–20 / 20+ sessions).
- Confluence lift: hold/repair rate **when the structure sits on a GEX wall or CB level** vs when it doesn't. This is the number that justifies the whole feature.

**UI — "Open Business" rail** (right side of `/tpo`): one row per unrepaired structure, sorted by distance from spot. Columns: kind badge (color-coded — excess = red/green, poor = amber, hole = gray), price, age in sessions, distance, historical touch-rate for that kind+age bucket. Click → drops a line on `/es-candles`.

### E. Day type (call by 10:30 ET)

```
narrow IB + IB break + one-time-framing  → TREND     → follow, buy pullbacks to value/singles
wide IB + no break                       → NORMAL    → fade extremes, POC magnet
IB break + return inside IB              → NORMAL-VAR/NEUTRAL → reduce size
2 POCs, low-vol gap between              → DOUBLE-DIST → trade away from LVN, LVN = the pivot
```

One-time-framing tracker (higher lows / lower highs on 30m) is a standalone boolean and is the single best trend confirm — build it.

### F. Confluence with what you already have

- TPO VAH/VAL **within X pts of a GEX call/put wall** → conviction multiplier (the CB Edge differentiator; nobody on X has this).
- POC vs **gamma flip** — POC below flip in negative gamma = POC is *not* a magnet, it's a trapdoor. **Invert the fade rule when net GEX < 0.**
- LVN + **CB level** confluence → highest-quality acceleration zone.
- Regime engine (HMM Chop state) → only enable fade rules in Chop; only enable extension rules in Trend.

---

## Phase 2 — UI: `/tpo` page (PageShell + Card + homeTheme)

**Top stat bar (gauges):**

1. **Day Type** — pill, colored, with confidence % and "locked at 10:32 ET".
2. **IB Extension gauge** — horizontal bar, center = IB, ticks at 1×/2× both sides, live marker.
3. **Value migration** — −100…+100 arc. Value higher / overlapping / lower.
4. **POC distance** — signed pts + % of ATR. "Magnet strength" (inverted when GEX < 0).
5. **Acceptance meter** — # of 30m periods closed outside VA / total. Fills as acceptance builds.
6. **Balance quadrant** — reuse the existing 4-quadrant widget from `/scanner`.

**Main panel:** letter-grid TPO chart (canvas, same pattern as the GEX heatmap overlay) — today + prior 2 days side-by-side, with composite profile on the right rail.

**Right rail — "Open Business":**
- Unfilled single prints (with age in sessions)
- Prior-day tails not yet retested
- Naked POCs (untested prior POCs) — *the single most tradeable persistent level in MP*
- Each row: level, age, distance, touch-rate stat.

**Stats tab:** for every rule above — sample size, hit rate, avg MFE/MAE, expectancy. **Ship no rule without this table.** Gate everything on `ibStats.ts`'s 3yr CSV first.

---

## Phase 3 — Persistence + backtest

- `scripts/backtest-tpo.mjs` — replay 3yr ES CSV through `tpo.ts` + `tpoRules.ts`, output per-rule hit rates. Mirror `backtest-signals.mjs`.
- **Lookahead guard** (learned the hard way on ICT): every rule must gate on `confirmIdx` — a 30m period's TPO row is only usable *after* that period closes. IB is not knowable until 10:30:00. Any rule >75% win rate or >3R is a bug until proven otherwise.
- PG tables: `tpo_profiles` (daily POC/VAH/VAL/IB/dayType), `tpo_singles` (naked levels, `filled_at` nullable), `tpo_naked_poc`.
- Recorder: `server-v2/tpo-recorder.js`, fires at RTH close, same shape as `eod-gex-recorder.js`.

---

## Build order

1. Lift `buildTpoProfile` → `lib/tpo.ts`, re-import in `/es-candles` (no visual change), add letters/IB/singles/tails/dayType + unit tests against a hand-checked session.
2. `scripts/backtest-tpo.mjs` — **get the real stats before building any UI.** Kill rules that don't hold.
3. `tpo_profiles` + `tpo_singles` recorder.
4. `/tpo` page: gauges → letter grid → Open Business rail.
5. Wire surviving rules into `signals-engine.js`.
6. GEX/regime confluence layer last.

**Do not skip step 2.** The X-cited numbers (97% IB exceed, 70–80% VA return) are unverified folklore; every one of them is a testable claim against data you already have on disk.
