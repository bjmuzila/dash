# Signed dealer gamma from your existing data

Answering the original question — can the four-step notional gamma calculation be
done with what this project already captures — and shipping the pieces that were
missing.

## Short answer

Steps 1, 3 and 4 are already in your codebase and already correct. Step 2 —
*signed* position size — is the only real gap, and it is a modelling problem
rather than a data-collection problem.

| Step | Status |
|---|---|
| 1. Black-Scholes gamma per option | **Have it.** `server-v2/computation/utils.js` — `bsGreeks`, `bsPrice`, `impliedVol` (Newton-Raphson with bisection fallback), Abramowitz-Stegun `erf`. Vendor gamma from the dxFeed `Greeks` event, BS as fallback. Every input present per strike: spot, strike, `yearsToExpiry()`, IV, `RISK_FREE_RATE` (0.045). |
| 2. Signed position size | **The gap.** See below. |
| 3. Contract multiplier (100) | **Have it.** |
| 4. Scale to a 1% move (`× S² × 0.01`) | **Have it.** |

### Steps 3 and 4 are already exactly your compact form

`server-v2/computation/gex-calculator.js`:

```js
const callGEX = callGamma * callOI * spot * spot;
const putGEX  = -(putGamma * putOI * spot * spot);
```

That looks like it is missing `× 100` and `× 0.01`, but `100 × 0.01 = 1`, so
`Γ × Pos × S²` **is** `Γ × Pos × 100 × S² × 0.01`. `etf-gex-recorder.js:110`
spells it out the long way and lands on the same number:

```js
const mult = spot * spot * 0.01 * 100;
```

Consistent across the SPX path, the ETF path, `mult-greek-gex-recorder.js`, and
`api-router.js:4856`. The identity is now asserted in the test suite rather than
left as folk knowledge.

## Step 2: what "signed" can and cannot mean here

Nobody outside OCC/DTCC has the actual dealer book, so every version of this is
an estimator. You have two, at very different quality levels.

**The headline numbers use a convention, not a measurement.** Walls, gamma flip,
the heatmap and `totalNetGex` all apply calls-positive / puts-negative to open
interest. It is the standard approach and it is fine as a convention, but it is
not a measured position.

**You also have genuinely signed flow, and it is better than most setups have.**
`computation/flow-gex.js` mirrors taker flow into dealer inventory, taking
exchange-true `TimeAndSale.aggressorSide` first and falling back to Lee-Ready
quote classification (`flow-processor.js:47`, with a 2500 ms quote-staleness
guard). It drops unclassifiable prints rather than letting them bias the book
short, persists to `flow_prints`, and rehydrates on boot.

### One correction to something I said earlier in the conversation

I initially said flow coverage was limited to ±2% of spot. That is wrong.
`proxy-tastytrade.js:4020`:

```js
// Near-spot contracts stream tick-by-tick TimeAndSale (handled below with
// real per-print size + aggressorSide) — don't ALSO feed the conflated
// Trade for them or every print doubles. Far-OTM strikes outside the TS
// window aren't TS-subscribed, so they still flow off Trade here.
if (FLOW_TIMESALES && this._tsSubs.has(sym)) return;
```

Every active contract gets `Quote/Greeks/Summary/Trade`. The ±2% window
(`FLOW_TS_WINDOW_PCT = 0.02`, `FLOW_TS_MAX = 120`) only *upgrades* near-spot
strikes to per-print TimeAndSale with a true aggressor flag. Strike coverage is
the whole chain.

### The three actual limitations

1. **Single expiry.** `proxy-tastytrade.js:4348` reads
   `getInventory(this.expiry)`. Inventory is keyed `date|expiration|strike`, so
   the data exists per expiry — only the active one is ever read into the GEX
   computation. Everything else accumulates and is discarded.

2. **Intraday only.** `ingestTape()` calls `dealerInventory.clear()` on the date
   roll. It is a same-session flow delta, not a book.

3. **Nothing renders it.** `totalFlowGex` is computed every recompute, broadcast
   at `server-with-proxy.js:239`, recorded into `eod_gex.total_flow_gex`, and
   exposed on an `/owner/dev` debug route. There are zero consumers in `app/`,
   `components/`, `lib/` or `hooks/`. It is dead weight that still runs — which
   matches "I don't use flow GEX anymore".

## The modelling trap, and the fix

The obvious way to build a cumulative book is to scale each day's signed flow by
an "opening fraction" estimated as ΔOI / volume, on the theory that only
position-opening flow creates lasting inventory.

**That is wrong, and I built it before catching it.** It double-counts the sign.
When ΔOI is negative (net closing) and the dealer is *buying back* a short, the
flow sign is already positive; multiplying by a negative ratio flips it and
drives the book further short. A dealer who sells 1000 calls Monday and buys
1000 back Tuesday comes out short 2000 instead of flat. That exact scenario is
now a regression test.

The insight that fixes it: **opening versus closing is a property of the taker's
intent, and it does not affect the dealer's net position at all.** Every
contract the dealer buys raises inventory and every contract they sell lowers
it, opening or closing. Direction comes from the tape. Open interest is useful
for **magnitude**, not sign.

So `reconcilePositionChange` offers three estimators:

| Mode | Formula | When |
|---|---|---|
| `flow` | signed flow | The naive mirror — what `flow-gex.js` does today. Needs a complete, correctly classified tape. |
| `oi` | `sign(flow) × abs(ΔOI)` | **Recommended.** Magnitude from exchange-reported OI, direction from the tape. The tape only has to get the sign right, so an incomplete tape stops compounding. |
| `min` | `sign(flow) × min(abs(flow), abs(ΔOI))` | Conservative floor: never claims more than both sources support. |

`turnoverRatio` (`abs(ΔOI) / volume`) survives as a **diagnostic** — it tells
you how much of your tape is position-changing versus round-tripping — but it is
explicitly not a weight.

## Data-quality issues worth knowing about

These bound how much any of this can be trusted, and they were not obvious from
the surface.

- **`FLOW_TAPE_FLOOR = 100` in your `.env.local`** (default would be 5000).
  `FlowProcessor.bucket()` returns `tape.filter(o => o.premium >= tapeFloorPremium)`,
  and that filtered tape is what feeds both `ingestTape()` and
  `writeFlowTape()`. So prints below $100 premium never reach dealer inventory
  *or* `flow_prints`. At $100 that is fairly inclusive, but cheap far-OTM 0DTE
  prints are cut — exactly where a lot of 0DTE gamma sits. Net effect: recorded
  volume understates true volume, which biases `turnoverRatio` **high**. Real
  turnover is lower than the script reports, so the naive mirror is worse than
  it looks, not better.

- **`FLOW_TAPE_CAP = 8000`** is a ring buffer. `ingestTape()` uses a WeakMap on
  the order object to count only new size per tick, so an order evicted before
  its final size is observed is undercounted. At SPX 0DTE print rates that is
  real leakage.

- **`flow_prints` PRIMARY KEY is `(ts, symbol, side)`.** Two different prints at
  the same millisecond on the same symbol and side collapse into one row via
  `ON CONFLICT ... DO UPDATE`. The writer's own comment says the PK "matches the
  FlowProcessor coalescing key", so this is intentional at the tape level — but
  it means `SUM(size)` from `flow_prints` is a lower bound on volume, not volume.

- **Volume is double-counted in every headline number.**
  `lib/calculations/calculations.ts`:

  ```ts
  function posOf(oi, vol, mode) { return mode === "vol" ? vol : oi + vol; }
  ```

  and server-side walls/flip/totals use `netGEX + netVolGEX`. Today's traded
  contracts are counted alongside OI, and they are already inside OI by the next
  day's update. If you want the textbook `Γ × OI × 100 × S² × 0.01`, that
  additive term is the thing to change. This is independent of everything else
  here and affects numbers you are using right now.

- **No historical per-strike IV or gamma is stored anywhere.** `oi_daily` has OI,
  `option_strike_gex_history` has `net_gex`/`net_vol_gex` (gamma already baked
  in, not separable), and only `gex7420.csv` keeps gamma — one call/put pair per
  expiry-timestamp. Any backtest of dealer gamma has to reconstruct gamma from
  Black-Scholes with an assumed IV. That is the weakest link in the analysis
  script, and it is why the script's headline outputs are **ratios**, which are
  invariant to the IV assumption, rather than dollar levels, which are not.

## What is in this drop

```
server-v2/computation/dealer-inventory.js   new pure module, no live wiring
scripts/dealer-gamma-reconcile.mjs          read-only DB analysis
tests/dealer-inventory.test.mjs             31 tests, all passing
```

Nothing here is wired into the live path. `dealer-inventory.js` is not imported
by any existing file, so dropping it in cannot move a number on your dashboard.

### Run the analysis first

It has to run on the VPS — your Render Postgres external host is not reachable
from this sandbox, so I could not run it against real data.

```bash
node scripts/dealer-gamma-reconcile.mjs --days 20
node scripts/dealer-gamma-reconcile.mjs --days 20 --json /tmp/recon.json
```

Every query runs inside `BEGIN TRANSACTION READ ONLY`, so it cannot write even
if it has a bug. It reads `flow_prints` and `oi_daily` only.

The output section that matters is **§2, "Does the tape overstate position
change?"**. If the mean ratio is near 1.0, the naive mirror is sound and a
cumulative book is cheap. If it is well below 1.0, use `mode: 'oi'` for anything
cumulative.

### Verification done

- 31 unit tests pass, covering the `100 × 0.01` identity against the existing
  `gex-calculator.js` expression, a step-by-step dimensional check of the 1%
  scaling, both sign conventions (including the put-leg double-flip trap and the
  `Math.abs` vendor-gamma guard), the three estimators, and the Monday-sell /
  Tuesday-buy round trip that must flatten to zero.
- The analysis script was run end to end against a stubbed `pg` driver with
  canned `oi_daily` / `flow_prints` rows, to exercise the SQL-shape assumptions
  and the fold logic. The stub was deleted afterwards — a fake `pg` in
  `node_modules` would shadow the real driver on your VPS.
- **Not verified against real data.** No DB access from here.

### If the analysis says the signal is real

Then the wiring work is, roughly in order: read `getInventory()` across all
expiries instead of `this.expiry`; generalise
`state/flow-gex-rehydrate.js` past `date = today` and a single expiration (its
query is already 90% of the way there); and add a per-strike daily volume
recorder so `turnoverRatio` gets a true denominator instead of the
premium-floored one. That last one is the only piece that needs new data
capture.
