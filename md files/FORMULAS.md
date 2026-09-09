# CB Edge — Formula Reference

Every quantitative formula, constant and threshold used by the live app, extracted from source.
Generated 2026-09-09.

**Scope:** `lib/`, `lib/calculations/`, `server-v2/computation/`, `server-v2/_lib-*.cjs` and the
recorder/engine scripts in `server-v2/`. Dead code (`Vanilla/`, root `*.html`, `server/`) is excluded.

---

## 0. Conventions

| Symbol | Meaning |
|---|---|
| `S` / `spot` | Underlying price (SPX cash or ES) |
| `K` / `strike` | Option strike |
| `T` | Time to expiry, in years |
| `σ` / `vol` / `IV` | Implied volatility (decimal, 1.00 = 100%) |
| `r` | Risk-free rate — **default `0.045`** everywhere |
| `OI` | Open interest (contracts) |
| `100` | Contract multiplier (shares per contract) |
| `N(x)` | Standard normal CDF |
| `φ(x)` | Standard normal PDF |
| `clamp(x,a,b)` | `min(b, max(a, x))` |
| `clamp01(x)` | `clamp(x, 0, 1)` |

**Sign conventions**

- **OI-basis GEX:** calls always **positive**, puts always **negative** (`Math.abs(gamma)` applied first, then signed by side).
- **Flow / dealer-inventory basis:** **both legs positive gamma** — the sign already lives in the signed contract count (`+` = dealer long, `−` = dealer short).
- **Contract-count basis:** `posOf(oi, vol, mode)` — `mode="vol"` → `vol` only; `mode="net"` (default) → `oi + vol`.

**Two GEX scalings coexist in the codebase** (both are used, deliberately):

```
reduced form   : GEX = Γ · Position · S²                    (gex-calculator.js, calculations.ts)
explicit form  : GEX = Γ · Position · 100 · S² · 0.01       (optionChain.ts, dealer-inventory.js)
```
They are algebraically identical because `100 × 0.01 = 1`. Both express **dollar gamma per 1% move**.

---

## 1. Black-Scholes core

**Source:** `server-v2/computation/utils.js` — `bsGreeks`, `bsPrice`, `impliedVol`, `normCdf`

```
d1    = ( ln(S/K) + (r + σ²/2)·T ) / ( σ·√T )
d2    = d1 − σ·√T

delta = N(d1)                    (call)
delta = N(d1) − 1                (put)
gamma = φ(d1) / ( S · σ · √T )
vega  = S · φ(d1) · √T           (per 1.00 = 100 vol pts)

theta_call = −( S·φ(d1)·σ ) / (2·√T)  −  r·K·e^(−rT)·N(d2)
theta_put  = −( S·φ(d1)·σ ) / (2·√T)  +  r·K·e^(−rT)·N(−d2)

vanna = −φ(d1) · ( d2 / σ )                                    ∂delta/∂σ
charm = −φ(d1) · ( 2rT − d2·σ·√T ) / ( 2·T·σ·√T )              ∂delta/∂t (per year)
```
All greeks return `0` if `S ≤ 0 || K ≤ 0 || T ≤ 0 || σ ≤ 0`.

**Normal PDF / CDF**
```
φ(x)      = e^(−x²/2) / √(2π)
N(x)      = 0.5 · ( 1 + erf( x/√2 ) )
```
`erf` via Abramowitz–Stegun 7.1.26:
```
t = 1 / (1 + 0.3275911·|x|)
y = 1 − ((((1.061405429·t − 1.453152027)·t + 1.421413741)·t − 0.284496736)·t + 0.254829592)·t·e^(−x²)
erf(x) = sign(x)·y
```

**Price**
```
call = S·N(d1) − K·e^(−rT)·N(d2)
put  = K·e^(−rT)·N(−d2) − S·N(−d1)
```
If `T ≤ 0 || σ ≤ 0` → intrinsic only (`max(S−K,0)` / `max(K−S,0)`).

**Implied volatility** — `impliedVol`
- Newton–Raphson: seed `σ = 0.20`, max **50** iterations, `σ ← σ − (bsPrice(σ) − price)/vega`, converge at `|diff| < 1e-4`; abort if `vega ≤ 1e-8` or `σ ∉ (0, 5]`.
- Bisection fallback: `lo = 1e-3`, `hi = 5`, max **100** iterations, tol `1e-4`.
- Returns `NaN` if `price < intrinsic` or any of `price, S, K, T ≤ 0`.

**Client-side gamma only** — `lib/calculations/calculations.ts` → `bsGamma(S,K,vol,T)` uses `r = q = 0`:
```
d1    = ( ln(S/K) + 0.5·vol²·T ) / ( vol·√T )
gamma = φ(d1) / ( S · vol · √T )
```

### Time to expiry

**Source:** `utils.js` → `yearsToExpiry`; `calculations.ts` → `rthFractionLeft`, `yearsTo`

```
expiry instant        ≈ 20:00 UTC on the expiration date
if (exp − now) > 3,600,000 ms:
    T = (exp − now) / (365 · 24 · 3600 · 1000)
else (last hour / 0DTE):
    open = 9.5·3600 s, close = 16·3600 s (ET), len = close − open  (= 23,400 s)
    rthFracLeft = clamp( (close − nowSec)/len, 0, 1 )
    days        = max(rthFracLeft, 1/78)        # 1/78 = one 5-min bar of the 78-bar session
    T           = days / 262                     # 262 trading days/year
```
Client profile model:
```
TRADING_PER_CALENDAR_DAY = 252/365
t0DTE     = max(rthFractionLeft(), 1/78) / 262
yearsTo(dte) = dte ≤ 0 ? t0DTE : (dte · 252/365) / 262
```

---

## 2. Gamma Exposure (GEX)

**Source:** `server-v2/computation/gex-calculator.js` → `computeGexRows`; `lib/calculations/calculations.ts`

### Per-strike

```
callGEX      =  |callGamma| · callPos · S²
putGEX       = −|putGamma|  · putPos  · S²
netGEX       =  callGEX + putGEX

netVolGEX    =  callGamma·callVolume·S²  −  putGamma·putVolume·S²
```
where `callPos/putPos = posOf(OI, volume, mode)`.

**Option-chain grid variant** — `lib/calculations/optionChain.ts` → `parseExpiration` (explicit scaling):
```
cnt(side) = (dataMode === "vol-only" ? 0 : OI) + volume
gex    = ( callGamma·callCnt − putGamma·putCnt ) · S² · 0.01 · 100
volGex = ( callGamma·callVol − putGamma·putVol ) · S² · 0.01 · 100
dex    = ( |callDelta|·callCnt − |putDelta|·putCnt ) · S · 100
chex   = ( −callTheta·callCnt + putTheta·putCnt )   · S · 100     ← theta-exposure, named "chex"
vex    = ( callVega·callCnt − putVega·putCnt )      · S · 100
oi     = callOI − putOI
callPrem = markCall · callVolume · 100
putPrem  = markPut  · putVolume  · 100
prem     = callPrem − putPrem
```
Mark fallback chain: `mark → (bid+ask)/2 → last → close → price → mid`.

### Directional volume GEX (dealer-signed)

```
callTot      = callBuyVol + callSellVol
callDealerVol = ((callBuyVol − callSellVol) / callTot) · callVolume      (0 if callTot = 0)
putDealerVol  = ((putBuyVol  − putSellVol)  / putTot)  · putVolume
netVolGexDir  = callGamma·callDealerVol·S² + putGamma·putDealerVol·S²    ← no put sign flip
```
Falls back to `netVolGEX` when no flow inventory exists at the strike.

### Delta exposure (DEX)

```
netDEX    = callDelta·callOI·S·100 − |putDelta|·putOI·S·100
volNetDEX = callDelta·callVol·S·100 − |putDelta|·putVol·S·100
```
Client fallback (`calculateNetDEX`): `(callDelta·callPos − putDelta·putPos) · S · 100`.
Cumulative DEX = running sum of `netDEX` for all strikes `≤ atmStrike`, ascending.

### Flow GEX (measured dealer inventory)

```
flowCallGEX = callGamma · inv.callNet · S²
flowPutGEX  = putGamma  · inv.putNet  · S²
flowGEX     = flowCallGEX + flowPutGEX          ← both legs positive gamma
```

### Vanna / Charm exposure (VEX / CHEX)

**Source:** `server-v2/computation/vex-chex.js` — `mult = 100·S`, `gexMult = S²`

```
netVanna (vex)  = callVanna·callOI·mult  − putVanna·putOI·mult
netVolVanna     = callVanna·callVol·mult − putVanna·putVol·mult
chex            = callCharm·callOI·mult  − putCharm·putOI·mult
volChex         = callCharm·callVol·mult − putCharm·putVol·mult
```
Running totals (`accumulateExposureTotals`): calls add, puts subtract, for delta/vega/VEX/CHEX;
legacy `totalCharmCall += −theta·contracts·mult`, `totalCharmPut += +theta·contracts·mult`.

### Gamma flip / zero-gamma

**Server** — `findGexFlip(gexRows, spot, {nearest, maxDistancePct})`, basis `oiVolNet = netGEX + netVolGEX`:
```
walk strikes ascending, cum += oiVolNet
crossing up  : prevCum < 0 && cum ≥ 0
crossing down: prevCum > 0 && cum ≤ 0            (nearest mode only)
at = prevStrike + (strike − prevStrike) · ( −prevCum / (cum − prevCum) )
band = maxDistancePct > 0 ? spot·maxDistancePct/100 : ∞
→ nearest mode returns the crossing minimizing |crossing − spot| within band
→ default (legacy) mode returns the FIRST negative→positive crossing
```

**Client** — `findGEXFlip(chain, spot)`:
```
zero = strikeA + (strikeB − strikeA) · ( |a| / (|a| + |b|) )
rounded to 0.1; exact-zero rows snap to the strike; result must be > 0 else null
→ returns the crossing nearest spot
```

**Dealer-gamma flip** — `dealer-inventory.js` → `dealerGammaFlip`:
```
t        = v0 / (v0 − v1)
crossing = k0 + t·(k1 − k0)
→ crossing with the smallest |crossing − spot|; null if < 2 rows
```

**Profile model flip** — `calculations.ts` → `computeGEXProfile`:
```
levels = linspace(0.8·spot, 1.2·spot, N = 60)
ivOf(row) = (callIV + putIV)/2 if both > 0, else whichever is quoted   ← one IV per strike
net(S) = Σ_strikes (callContracts − putContracts) · 100 · S² · bsGamma(S, K, ivOf, yearsTo(dte))  / 1e9
```
Units: **$B per 1% move**. Requires ≥ 5 rows with `IV > 0` and `contracts > 0`, else `null`.
Coarse linear bracket `z = levels[i+1] − (levels[i+1]−levels[i])·b/(b−a)`, then **bisection**,
max **24** iterations or bracket `< 0.05` pts; final rounded to 2 dp.

### Walls

**Server** — `findCallWall` / `findPutWall`, metric selected by `basis`:

| basis | metric |
|---|---|
| `oivol` (default) | `netGEX + netVolGEX` |
| `oi` | `netGEX` |
| `vol` | `netVolGEX` |
| `oiRaw` | `callOI` / `−putOI` (no gamma weighting) |

```
deadZone = max(minDistance, spot · minDistancePct / 100)      (both default 0)
call wall: argmax(metric) over strikes > spot + deadZone with metric > 0
put  wall: argmin(metric) over strikes < spot − deadZone with metric < 0
exclude: one strike (usually CB) removed before selection so CB and wall can't collapse
```

**Client** (`calculations.ts`, no dead zone): call wall = `argmax(callGEX)`; put wall = `argmax(|putGEX|)`.

**Heat-level walls** — `lib/calculations/heatLevels.ts` → `columnWalls`:
```
CB = strike with max |net|            (sign-blind)
CW = strike with max  net  , excluding CB's strike   (null if none)
PW = strike with min  net  , excluding CB's strike   (null if none)
WALL_RANK = { cb: 1, cw: 2, pw: 3 }
INTENSITY_MIN = { chain: 0.5, esCandles: 0.1 }
atMinIntensity(v, min) = !isFinite(v) || v ≤ min + 1e-6
```

### Totals and normalization

```
totalNetGex  = Σ (netGEX + netVolGEX)
totalFlowGex = Σ flowGEX
totalVEX     = Σ (vex ?? netVanna) ;  totalCHEX = Σ chex
totalAbs           = Σ |netGEX + netVolGEX|
normalizedGexPct   = |netGEX + netVolGEX| / totalAbs · 100
```

**Multi-expiry ladder** — `computeGexRowsMultiExpiry`: additive fields summed per strike
(`callOI, putOI, callVolume, putVolume, callGEX, putGEX, netGEX, netVolGEX, netVolGexDir, flowGEX,
flowCallGEX, flowPutGEX, netDEX, volNetDEX, netVanna, netVolVanna, chex, volChex`);
per-contract fields taken from the **nearest-dated** expiry at that strike. `flowInventory` not accepted.

**Display formatting** — `formatGEX`: `≥1e9 → $X.XXB`, `≥1e6 → $X.XXM`, else `$X.XXK`, sign-prefixed.

**Strike densify** — `densifyChainRows(chain, step=5)`: fills `floor(min/step)·step … ceil(max/step)·step`.

---

## 3. Dealer inventory

**Source:** `server-v2/computation/dealer-inventory.js`

Constants: `CONTRACT_MULTIPLIER = 100`, `ONE_PCT = 0.01`

```
notionalGammaPer1Pct(Γ, Position, S) = Γ · Position · 100 · S² · 0.01
                                     = Γ · Position · S²           (reduced)

signedPosition:  callNet = callBuyVol − callSellVol
                 putNet  = putBuyVol  − putSellVol
turnoverRatio(ΔOI, vol)  = min(1, |ΔOI| / vol)      (0 if vol ≤ 0)
```
Taker buy ⇒ dealer short (negative); taker sell ⇒ dealer long (positive).

**Position-change reconciliation** — `reconcilePositionChange(signed, oiDelta, mode)`,
`f = signed flow`, `d = |ΔOI|`, `dir = sign(f)`:

| mode | dealerΔ |
|---|---|
| `flow` | `f` |
| `oi` (default) | `dir · d` |
| `min` | `dir · min(|f|, d)` |

`dealerΔ = 0` when `f = 0`.

**Per-strike / book**
```
call$      = notionalGammaPer1Pct(|callGamma|, callNet, S)
put$       = notionalGammaPer1Pct(|putGamma|,  putNet,  S)
netGamma$  = call$ + put$                     ← both positive gamma
totalGamma$= Σ netGamma$
coverage   = withGamma / n
```
`accumulateBook` keys on `expiration|strike`, drops entries with `expiration < asOf`.

### DTE buckets

**Source:** `server-v2/computation/dte-buckets.js`

| key | label | minDte | maxDte |
|---|---|---|---|
| `0dte` | 0DTE | 0 | 0 |
| `near` | Near | 1 | 7 |
| `front` | Front | 8 | 30 |
| `mid` | Mid | 31 | 90 |
| `back` | Back | 91 | — |

```
MEASURABLE_MAX_DTE = env DEALER_GAMMA_MEASURABLE_DTE || 7
dte = round( (Date(expiration) − Date(sessionDate)) / 86,400,000 )

conventionStrikeGamma = nG(|callΓ|, callOi, S) − nG(|putΓ|, putOi, S)     (calls +, puts −)
measuredStrikeGamma   = nG(|callΓ|, pos.callNet, S) + nG(|putΓ|, pos.putNet, S)

coverage = measuredStrikes / strikes
basis    = 'convention' | (coverage ≥ 0.5 ? 'measured' : 'partial')

zeroDte = netGamma of '0dte'
net     = Σ bucket.netGamma
gross   = Σ |bucket.netGamma|
ex0dte  = net − zeroDte
shareOfGross(netGamma, gross) = |netGamma| / gross
```

### Gross gamma churn

**Source:** `server-v2/_lib-gex-gross.cjs`

```
gross_now  = Σ (|call_gex| + |put_gex|)                      (today)
gross_prev = Σ (|prev_call_gex| + |prev_put_gex|)
churn      = Σ (|call_gex − prev_call_gex| + |put_gex − prev_put_gex|)
churn_call = Σ |call_gex − prev_call_gex|
churn_put  = Σ |put_gex  − prev_put_gex|
build      = gross_now − gross_prev
churnPct   = 100 · churn / gross_prev
buildPct   = 100 · build / gross_prev
buildShare = build / churn          ∈ [−1, +1]   (0 if churn ≤ 0)
callShare  = churn_call / churn
heat       = churn ÷ that ticker's trailing clean-session average churn   (1.0 = normal day)
```
Baseline filters: `is_opex` = Friday AND day-of-month ∈ [15,21]; `is_earnings` = session falls in
the earnings-exclusion window (after-bell → `{anchor, anchor+1}`; pre-market → `{anchor−1, anchor}`;
unknown → union); `clean = !is_opex && !is_earnings && gross_prev ≥ minGross`.

Label from `buildShare`: `≥0.6` gamma added · `≤−0.6` gamma pulled off · `≥0.2` more added than pulled ·
`≤−0.2` more pulled than added · else rotated in place.
UI scale: `{normal: 1, hot: 2, extreme: 4, provisionalMaxPct: 100}`.

---

## 4. Order flow

**Source:** `server-v2/computation/flow-processor.js`, `flow-gex.js`, `lib/calculations/flow.ts`

### Aggressor-side inference (Lee-Ready + tick rule)

```
QUOTE_FRESH_MS = 2500

mid = (bid + ask)/2
inside spread (bid < price < ask)  — always trusted:
    price > mid → buy ; price < mid → sell ; price = mid → mid
at/outside spread — only if quote age ≤ 2500 ms:
    price ≥ ask → buy ; price ≤ bid → sell ; else mid
otherwise tick rule: price > lastTrade → buy ; < → sell ; = → unknown
```

### Print / order aggregation

```
premium = price · size · 100
bullish = (side=="buy" && isCall) || (side=="sell" && !isCall)   → "bull" else "bear"
isOtm   = isCall ? strike > spot : strike < spot                 (null if spot ≤ 0)

coalescing: same streamerSymbol + side + action within coalesceMs
    newPrice = (oldPrice·oldSize + price·size) / (oldSize + size)
    newSize  = oldSize + size ;  premium accumulates
```

| Constant | Default | Meaning |
|---|---|---|
| `FLOW_COALESCE_MS` | 5000 | Merge window for sweep/block consolidation |
| `FLOW_WINDOW_MS` | 300,000 (5 min) | Rolling aggregation window |
| `FLOW_TAPE_CAP` | 8000 | Max tape entries |
| `FLOW_TAPE_FLOOR` | $5,000 | Premium noise floor for the displayed tape |
| `maxPrints` | 50,000 | Hard cap on retained raw prints |

```
buyVol   = callBuyVol + putBuyVol
sellVol  = callSellVol + putSellVol
totalVol = buyVol + sellVol
buyPct   = buyVol / totalVol · 100
netPremium = Σ(buy premiums) − Σ(sell premiums)
```

### Flow summary (client)

```
ratio = totalCallPremium / totalPutPremium          (∞ if put premium = 0)
ratio > 1.1 → "calls" ; ratio < 0.9 → "puts" ; else "neutral"
recency window default = 5 · 60 · 1000 ms
```

### Order-book / options-flow imbalance

**Source:** `lib/obook-compute.ts`, `server-v2/_lib-obook.cjs`

```
deltaMag(o)  = 0.35 if OTM else 0.55                        ← |Δ| proxy, no per-print greeks
isBullish(o) = isCall ? isBought : !isBought
delta       += (isBullish ? +1 : −1) · size · 100 · deltaMag(o)

prem = callPrem + putPrem
ratio(a,b) = a/b        → "X.XX×", or "—" if b ≤ 0
spotMovePct = (last − open)/open · 100
net_e = bullPrem_e − bearPrem_e                             (per expiration)
bar pct = round( |net_e| / max(1, max|net|) · 100 )
bounce floor = top-2 front-tenor strikes by sold-put premium; floorPrem = Σ their premium
lean = delta ≥ 0 ? "net long" : "net short"
```
Formatting: `fmtM(n) = "$" + (|n|/1e6).toFixed(1) + "M"`; `fmtK(n) = ±round(|n|/1000) + "K"`.

---

## 5. Expected move, condors, basis

### Estimated move (ATM straddle)

**Source:** `lib/calculations/estimated-moves.ts` → `calcEstimatedMove`; `calculations.ts` → `calculateDailyEstimatedMove`

```
atmStrike        = round(spot / 5) · 5
callMid          = (callBid + callAsk)/2 ;  putMid = (putBid + putAsk)/2
straddleMid      = (callMid + putMid) / 2
estimatedMove    = round( straddleMid · 0.84 · 100 ) / 100          ← 0.84 = straddle→1σ constant
estimatedMovePct = round( (estimatedMove / spot) · 10000 ) / 100
upperBound       = round( (spot + estimatedMove) · 100 ) / 100
lowerBound       = round( (spot − estimatedMove) · 100 ) / 100
daysTo(exp)      = ceil( (Date(exp + "T16:00:00") − now) / 86,400,000 )
```
ES/NQ price formatting rounds to the **0.25** tick: `n = round(num·4)/4`.

### EM tracker hit/miss

**Source:** `lib/em-tracker/computeResult.ts`
```
up = row.up ?? (ref_close + em) ; down = row.down ?? (ref_close − em)
hit  ⟺  high ≤ up  AND  low ≥ down
```

### Iron condor

**Source:** `lib/em-condor/compute.ts`

```
put_short  = roundDown(down, inc)         call_short = roundUp(up, inc)
put_long   = roundDown(put_short − wing, inc)
call_long  = roundUp(call_short + wing, inc)
valid ⟺ put_long < put_short < call_short < call_long
roundTo(v, step, mode): q = v/step ; n = floor|ceil|round(q) ; result = round(n·step·100)/100
```

**Economics** (`mult = 100`, `qty = 1` by default)
```
credit        = net_credit || (put_credit + call_credit)
put_width     = put_short − put_long ;  call_width = call_long − call_short
widest        = max(put_width, call_width)
max_profit    = credit · mult · qty
max_loss      = (widest − credit) · mult · qty
credit_pct    = credit / widest
roc           = credit / (widest − credit)
breakeven_low = put_short − credit
breakeven_high= call_short + credit
```

**Settlement**
```
putLoss   = min(put_short − put_long, max(0, put_short − settle))
callLoss  = min(call_long − call_short, max(0, settle − call_short))
intrinsic = putLoss + callLoss
pnl_per_condor = (credit − intrinsic) · mult
pnl            = pnl_per_condor · qty
cushion        = min(call_short − settle, settle − put_short)
outcome: intrinsic = 0 → max_win ; either leg at full width → max_loss ;
         pnl_per_condor ≥ 0 → partial_win ; else partial_loss
touched: weekLow ≤ put_short → put ; weekHigh ≥ call_short → call
```

**Strike increments** — SPX 5 · NDX 10 · XSP 1 · ES* 5 · NQ* 10 · SPY/QQQ/IWM/SMH 1 ·
AAPL/AMD/AMZN/GOOGL 1 · META 5 · MSFT 5 · NVDA 1 · TSLA 5 · COIN 5 · HOOD 1 · NFLX 1 · PLTR 1 · **default 1**

**Default wings (pts)** — SPX 25 · NDX 100 · XSP 5 · ES* 25 · NQ* 100 · SPY 5 · QQQ 5 · IWM 3 · SMH 5 ·
AAPL 5 · AMD 5 · AMZN 5 · GOOGL 5 · META 20 · MSFT 15 · NVDA 5 · TSLA 15 · COIN 20 · HOOD 5 · NFLX 3 ·
PLTR 3 · **fallback `inc · 5`**

### ES ↔ SPX basis

**Source:** `server-v2/es-spx-basis.js`
```
basis = round( (esClose_16:00ET − spxClose_^GSPC) · 100 ) / 100
plausible ⟺ 0 < basis < 250
CACHE_MS = 3,600,000 (1 h) ;  history over the latest 30 es_candles 16:00 bars
impliedSPX = esPrice − basis
```

### ES gap math

**Source:** `lib/esGapMath.js` / `.ts`, `server-v2/es-gap-tracker.js`
```
prior_close = prior day's 15:55 ET bar close
open_0930   = today's 09:30 ET bar open
gap_pts     = open_0930 − prior_close
gapDir      = >0 up · <0 down · =0 flat

extremeToward = (open_0930 > prior_close) ? sessionLow : sessionHigh
gapAbs   = |open_0930 − prior_close|            (0 → pct 100, filled true)
traveled = gapUp ? (open_0930 − extreme) : (extreme − open_0930)
pct      = clamp( traveled/gapAbs · 100, 0, 100 )
filled   = pct ≥ 100 − 1e-9
```
Tracker: 5-minute aligned polling, RTH `[570, close)` where close = 780 (half day) or 960;
25,000 ms startup probe delay; NYSE/Cboe holidays and 13:00 early closes hard-coded 2026–2027.

---

## 6. Market profile — TPO, Value Area, structures

**Source:** `lib/tpo.ts`, `lib/valueArea.ts`, `lib/tpo-forecast-compute.ts`

### TPO construction
```
TPO_PERIOD_MS = 30 · 60,000 = 1,800,000 ms       (30-min letter periods, A = 09:30 ET)
binSize       = 1 point (default)
floorBin(p)   = floor(p / binSize) · binSize
```
Each 30-min period touching a bin adds **one** TPO to that bin (time, not volume).
Minimum viability: ≥ 3 distinct bins and ≥ 6 raw 5m bars.

### POC and 70% Value Area
```
pocIdx = argmax(count)                    (ties keep the lower price)
poc    = bins[pocIdx].price
total  = Σ bins[i].value
target = total · vaPct                    vaPct = 0.70
loI = hiI = pocIdx ; acc = bins[pocIdx].value
while acc < target and (loI > 0 or hiI < n−1):
    below = loI>0   ? bins[loI−1].value : −1
    above = hiI<n−1 ? bins[hiI+1].value : −1
    if above ≥ below: hiI++ ; acc += max(0, above)     ← ties expand upward
    else:             loI-- ; acc += max(0, below)
VAH = bins[hiI].price ;  VAL = bins[loI].price
```
Identical algorithm applied to TPO counts, bar volume, and forecast density (`vaBand`).

**Volume-profile binning** — `computeValueArea`:
```
b0 = floorBin(low) ; b1 = floorBin(high)
n  = max(1, round((b1−b0)/binSize) + 1)
per = bar.volume / n , added to each bin from b0 to b1
```

**Low-volume node (LVN):** the local minimum (`v[i] < v[i−1] && v[i] < v[i+1]`, excluding edges)
with the globally smallest volume; `null` if none.

### TPO structures
`TOUCH_PAD = 0.25` (one ES tick). Singles = bins with `count == 1`; contiguous runs grouped.

| Structure | Rule |
|---|---|
| **Excess High** | run of ≥2 singles reaching the top bin AND `hiPeriod.close < runLow` (rejected) |
| **Tail High** | same run but `hiPeriod.close ≥ runLow` (continuation) |
| **Poor High** | no run at top AND `bins[top].count ≥ 2` |
| **Excess/Tail/Poor Low** | mirrored, using `loPeriod.close > runHigh` |
| **Hole** | single-run touching neither extreme; side `up` if `runLow ≥ poc` else `down` |
| **Naked POC** | always emitted, zero-width band at `poc` |

**Forward-fill grading**
```
hit band     = [priceLo − 0.25, priceHi + 0.25]
tested       = bar.high ≥ lo && bar.low ≤ hi
repaired     = *_high/naked_poc(up): bar.high > priceHi ; *_low: bar.low < priceLo
               hole: a later session trades fully above AND fully below
               naked_poc: repaired the instant it is tested
touches      = count of distinct later sessions with an intersecting bar
ageSessions  = (#sessions) − 1 − creationIndex
ageBucket    = ≤5 → "0-5d" ; ≤20 → "6-20d" ; else "20d+"
testRate     = tested / n ;  repairRate = repaired / n
medSessionsToTest = median(sessions between creation and testedAt)
MIN_N = 5    ← base rate falls back age-bucket → kind → null (render a dash, never a fake 0%)
gradable ⟺ ageSessions ≥ 1
```

### TPO k-NN forecast

**Source:** `lib/tpo-forecast-compute.ts`
```
BIN = 1 ; GRID_LO = −100 ; GRID_HI = +100 ; GRID_N = 201
K = 25 ; LIVE_MIN = 40 ; IB_CLOSE_MIN = 630 (10:30 ET)

density[idx] += count where idx = round((price − anchor − GRID_LO)/BIN) ; then density /= Σcount
```
**Feature vector** (5-dim, all normalized by trailing 20-session medians `trailIb`, `trailRng`):
```
f1 = ibRng / trailIb
f2 = (day_open − ibMid) / ibRng
f3 = (open − prev.close) / trailIb              gap
f4 = (prev.poc − ibMid) / trailIb
f5 = prevRng / trailRng
```
**Standardization / distance / weights**
```
mu[j] = mean(feat[:,j])
sd[j] = sqrt( mean( (feat[:,j] − mu[j])² ) )     population; floored to 1 if 0
d_i   = sqrt( Σ_j (fn_i[j] − qn[j])² )
w_i   = (1/(d_i + 1e-6)) / Σ_j (1/(d_j + 1e-6))          over the K = 25 nearest
predicted density = Σ w_i · density_i
confidence = clamp(0, 100, round( 100 · (1 − meanK / medAll) ))
```

---

## 7. Initial Balance

### IB definition
```
IB window   = 09:30–10:30 ET  (minutes 570–630, first two 30-min TPO periods, 12 × 5m bars)
ibHigh/ibLow= max(high)/min(low) over that window
ibRange     = ibHigh − ibLow
ibMid       = (ibHigh + ibLow)/2
closeLoc    = (ibClose − ibLow) / ibRange           ∈ [0,1]
closeZone   = ≥0.75 top25 · ≤0.25 bot25 · else mid50
bias        = ibClose > ibMid ? "H" : ibClose < ibMid ? "L" : null
first       = whichever of ibHigh/ibLow printed at the earlier bar index
Inner ORB   = first 3 IB bars (09:30–09:45, min < 585)
ES_TICK     = 0.25
```

### IB width classification

**Source:** `lib/ibStats.ts` `classifyWidth`, `lib/ibDaily.ts`, `server-v2/_lib-ibdaily.cjs`
```
atr    = mean( dayHigh − dayLow ) over trailing 14 sessions      (simple range, not true range)
avgIb  = mean( ibWidth ) over trailing 20 sessions
narrow ⟺ width < 0.5·atr  OR  width < 0.75·avgIb
wide   ⟺ width > 1.5·atr  OR  width > 1.25·avgIb
else normal
requires ≥ 14 trailing sessions (ibDaily) / ≥ 5 samples (ibStats)
```

**Open type** (vs prior day `pdh`/`pdl`)
```
dayOpen > pdh          → OAR-H
dayOpen < pdl          → OAR-L
dayOpen > (pdh+pdl)/2  → HIR
else                   → LIR
```

### Break, fail, extension math

**Source:** `lib/ibStats.ts`
```
break        = post-IB 5m bar CLOSE outside [ibLow, ibHigh]     (min ≥ 630)
touch        = wick only (high > ibHigh / low < ibLow)
failed       = close comes back inside within 6 post-break bars (≤ 30 min)
retest       = price within 2 · ES_TICK = 0.5 pts of the broken level while close still holds outside
volSurge     = break bar volume > mean(IB bar volume)

fav  = dir>0 ? high − lvl : lvl − low ;  mfe = max(fav)
adv  = dir>0 ? lvl − low  : high − lvl ;  mae = max(adv)
rExt = mfe / ibWidth ;  rAdv = mae / ibWidth
hit[t] = mfe ≥ t · ibWidth       for t ∈ {0.5, 1, 1.5, 2}
fadeMid  = price returns to ibMid after the fail
fadeOpp  = price reaches the opposite IB extreme after the fail
```

**Fib variants**
```
Variant A: fibALvl = dir>0 ? ibHigh − 0.25·width : ibLow + 0.25·width
           cont = later exceeds running extreme ; fail = later trades to ibMid
           mfe(A) = (runningExtreme − fibALvl)/width
Variant B: imp = |running − lvl| must exceed 0.25·width
           pb  = dir>0 ? running − 0.25·imp : running + 0.25·imp
```

**Fail outcome** (priority order, `mfePts = rExt · width`)
1. `recovered` — `mfePts > peakBeforeFail`
2. `full_rotation` — `fadeOpp`
3. `to_mid` — `fadeMid`
4. `chop`

**Helpers:** `avg(a) = Σa/n` · `med(a) = sorted[floor(n/2)]` (lower-middle) · `rate(n,d) = 100·n/d`.

### IB 14-rule scoreboard

**Source:** `lib/ibDaily.ts` → `gradeRules`

| # | Rule | In play | Hit |
|---|---|---|---|
| 1 | Midpoint close bias | `bias` set | `firstTouchSide == bias` |
| 2 | Formation order + midpoint | `bias` set AND confluent (`first=L,bias=H` or `first=H,bias=L`) | `firstTouchSide == bias` |
| 3 | Single break continuation | close break occurred | opposite side never wick-touched |
| 4 | IB width → day type | `widthBucket` known | `wide ⇒ bothBroke`, else `singleBreak` |
| 5 | Breakout entry + volume | close break | `ext10` |
| 6 | Failed breakout fade | close break AND failed | `fadeOpp` |
| 7 | 15m FVG inside IB | `fvg` set | `firstTouchSide` matches (bull→H, bear→L) |
| 8 | Retest continuation | close break AND retest | `retestCont` |
| 9 | Extension ≥ 1× width | close break | `ext10` |
| 10 | Close location (strong) | `top25 & first=L` or `bot25 & first=H` | `firstTouchSide` matches zone |
| 11 | Open type + IB width | both known | `singleBreak` |
| 12 | Inner ORB + alignment | `orbDir` and `bias` set | `firstTouchSide == bias` |
| 13 | Time filter | close break, `breakMin` known | `ext10` |
| 14 | Contained day | `containedAt2` | `!containedBrokeLate` |

```
ext targets: ext05/ext10/ext15/ext20 ⟺ running extreme reaches lvl ± t·ibWidth, t ∈ {0.5,1,1.5,2}
15m FVG inside IB: bull ⟺ b15[i].low > b15[i−2].high ; bear ⟺ b15[i].high < b15[i−2].low
containedAt2      = no post-IB close breaks the IB before minute 840 (14:00 ET)
time buckets      = breakMin ≤ 660 early · ≤ 780 midday · else late
```

### Bayesian evidence blending

**Source:** `lib/ibBlend.ts`

| Constant | Value | Meaning |
|---|---|---|
| `PRIOR_K` | 40 | Shrinkage strength (sessions to outweigh the base rate) |
| `BACKOFF_K` | 25 | Sessions for the exact cohort to outweigh the stacked estimate |
| `PAIR_MIN` | 40 | Min joint sample size for λ calibration |
| `LAMBDA_LO / HI` | 0.1 / 1 | λ clamp bounds |
| `CALIB_FLOOR` | 0.25 | Min `\|w_i + w_j\|` (log-odds) for a calibration pair |
| `CLAMP` | 1e-4 | Probability clamp before logit |

```
logit(p) = ln( q/(1−q) ),  q = clamp(p, 1e-4, 1−1e-4)
sigmoid(x) = 1/(1 + e^(−x))
p0  = count(out)/rowCount ;  l0 = logit(p0)
shrunk_i = ( PRIOR_K·p0 + n_i·raw_i ) / ( PRIOR_K + n_i )
w_i      = logit(shrunk_i) − l0

λ  = median over pairs (i,j) with |w_i+w_j| ≥ 0.25 and n_ij ≥ 40 of
         ( logit(p_ij_shrunk) − l0 ) / ( w_i + w_j )
     fallback λ = 1/√(max(1, #criteria)) ;  then clamp to [0.1, 1]

p_stacked = sigmoid( l0 + λ·Σ w_i )
exact     = exactK / exactN
joined    = exactN > 0 ? ( exactN·exact + 25·p_stacked ) / ( exactN + 25 ) : p_stacked
```
`deepestSupported(min = 30)`: greedily drop the criterion freeing the most sessions until `n ≥ min`
or one criterion remains; returns the plain conditional rate `k/n`.

---

## 8. Balance / imbalance and AMT

### Quadrant state machine

**Source:** `lib/balanceImbalance.ts`

| Constant | Value | Meaning |
|---|---|---|
| `RTH_OPEN / RTH_CLOSE` | 570 / 960 | 09:30 / 16:00 ET, minutes of day |
| `CONFIRM_BARS` | 2 | Consecutive bars outside reference VA to escalate shift → imbalance |
| `SETTLE_BARS` | 2 | Trailing leg count for contraction test |
| `CONTRACTION_RATIO` | 0.6 | Imbalance → rebalance trigger |

```
inVA ⟺ val ≤ close ≤ vah                     (reference = PRIOR RTH session's value area)
inVA                                     → state = balance, reset streak/legs
outside, side flipped or was balance     → state = shift, streak = 1, shiftEvents++
outside, same side                       → streak++, legRanges.push(high − low)
    shift  && streak ≥ 2                 → state = imbalance, imbalanceReached++
    imbalance && legRanges.length > 2:
        recentAvg = mean(last 2 legs) ; priorAvg = mean(earlier legs)
        → rebalance  ⟺  priorAvg > 0 && recentAvg < priorAvg · 0.6

foundNewValue     = last close still outside reference VA (given a shift occurred)
revertedToBalance = last close back inside reference VA
shiftToImbalanceRate    = daysWithImbalance / daysWithShift
imbalanceToNewValueRate = foundNewValue days / daysWithImbalance
imbalanceToRevertRate   = reverted days / daysWithImbalance
```

### AMT read

**Source:** `lib/amt.ts` → `amtRead` (`pad = binSize`)
```
avgIbRange = median(trailing ≤ 20 sessions' ibRange, nulls/zeros excluded)
ibRatio    = today.ibRange / avgIbRange
ibClass    = < 0.75 narrow · > 1.25 wide · else average

reUp  = today.high > today.ibHigh + pad
reDn  = today.low  < today.ibLow  − pad
rangeExt = both | up | down | none
```

**Day type (ibClass × rangeExt):** narrow+ext → Trend/RE · narrow+none → Coiled ·
wide+both → Neutral two-sided · wide+none → Normal rotational · wide+one → Normal modest extension ·
average+one → Normal variation · average+both → Neutral two-sided · average+none → Balancing

**Balance state vs prior VA**
```
imbalance_up   ⟺ today.val > prior.vah + pad
imbalance_down ⟺ today.vah < prior.val − pad
shift_up       ⟺ today.poc > prior.vah
shift_down     ⟺ today.poc < prior.val
else balance
```

**Opening type (approx)**
```
rng     = high − low
fromLow = (open − low) / rng
≤ 0.15 → Open-Drive ↑ · ≥ 0.85 → Open-Drive ↓ · else Open-Auction / rotational
```

### AMT day type (failLevels variant)

**Source:** `lib/failLevels.ts` → `computeIb`, `computeAmt` (`IB_OPEN = 570`, `IB_END = 630`)
```
range = ib.high − ib.low || 1 ; ext = max(0, close − ib.high, ib.low − close) ; extMult = ext/range
trend-up      : brokeHigh & !brokeLow & close > ib.high
trend-down    : brokeLow  & !brokeHigh & close < ib.low
reversal-down : brokeHigh & close < ib.low
reversal-up   : brokeLow  & close > ib.high
balance       : both broke, or IB locked with no clean break
forming       : IB not yet locked (before 10:30 ET)
```

---

## 9. Volume Spread Analysis (VSA)

**Source:** `lib/vsa.ts` → `classifyBar`, `slotBaseline`

| Constant | Value | Meaning |
|---|---|---|
| `hiRvol` | 1.8 | RVOL at/above which effort is heavy |
| `loRvol` | 0.6 | RVOL at/below which there is no effort |
| `smallBody` | 0.3 | body/range at/below which no ground was gained |
| `bigBody` | 0.7 | body/range at/above which ground was gained |
| `lookbackDays` | 10 | Prior sessions feeding the per-slot baseline |

```
range    = high − low
bodyPct  = |close − open| / range            (0 if range ≤ 0)
closePos = (close − low) / range             (0.5 if range ≤ 0)
baseline = median( that "HH:MM" slot's volume over ≤ 10 prior sessions )   needs ≥ 3 sessions
           slot volume per date = MAX of recorded volumes (cumulative-candle safe)
rvol     = baseline > 0 ? volume/baseline : 0

churn  ⟺ rvol ≥ 1.8 AND bodyPct ≤ 0.3      (high effort, no result — absorption)
thin   ⟺ rvol ≤ 0.6 AND bodyPct ≥ 0.7      (no effort, big result — unopposed)
normal   otherwise (includes rvol = 0, i.e. baseline unknown)
```
Forming bars (`timestamp > formingBefore`) are skipped so a partial bar never reads as "thin".

---

## 10. ICT concepts

**Source:** `lib/calculations/ictConcepts.ts`

### Fair Value Gap
```
bullish FVG ⟺ c.low  > a.high   [and, if requireCloseConfirm, b.close > a.high]
                top = c.low  , bottom = a.high
bearish FVG ⟺ c.high < a.low    [and b.close < a.low]
                top = a.low  , bottom = c.high
where a = candle i−2, b = i−1, c = i ; startTs = a.ts, ts = c.ts

width filter (widthMode):
   ticks   : (top − bottom) ≥ minWidth · tick      default 4 × 0.25 = 1.00 ES pt
   points  : (top − bottom) ≥ minWidth
   percent : (top − bottom)/bottom · 100 ≥ minWidth
```
**Mitigation** (`mitigationPct = 0.5`, `mitigation = "wick"`)
```
fillLevel = bull ? top − (top−bottom)·0.5 : bottom + (top−bottom)·0.5
probe     = mitigation=="close" ? k.close : (bull ? k.low : k.high)
into      = bull ? probe ≤ fillLevel : probe ≥ fillLevel
first into → mitigated ; second into → retouched, endTs set
```
**Break / inversion (IFVG)**
```
through = bull ? k.close < bottom : k.close > top
SWEEP_WINDOW_MS = 15 · 60,000 = 15 min (3 × 5m bars)
if through AND a liquidity sweep occurred within 15 min → inverted, activeDir flips, box stays alive
else → spent, endTs = k.ts
post-inversion: closing back through the NEW activeDir side ends the box
```

### Displacement
```
lookback = 14 ; mult = 1.6
avg  = mean( high−low over the 14 bars before i )
body = |close − open|
strong ⟺ avg > 0 AND body ≥ avg · 1.6
consecutive same-direction strong candles merge into one leg
bodyRatio = max(body/avg) across the merged leg
```

### Order blocks
```
walk back up to 6 candles from the displacement start to the last opposite-colored candle (ob)
swept        ⟺ bull OB: ob.low  < prev.low   |  bear OB: ob.high > prev.high
hasImbalance ⟺ bull: c3.low > a.high  |  bear: c3.high < a.low     (a = obIdx+1, c3 = obIdx+3)
valid        = swept AND hasImbalance
confirmTs    = max(displacement.endTs, c3.ts)         ← no lookahead
mitigated    ⟺ a later candle trades into [ob.low, ob.high]
violated     ⟺ bull: close < ob.low  |  bear: close > ob.high
```

### Swing pivots
```
k = 2 (5-bar fractal)
pivot high ⟺ high[i] > high[j] for all j ∈ [i−k, i+k], j ≠ i
pivot low  ⟺ low[i]  < low[j]  for all j
confirmIdx = i + k        ← pivot not tradeable until k bars later
```

### Market structure (BOS / CHoCH / MSS)
```
avgBody = mean(|close − open|) over all candles
bullish break (close > lastHigh.price, confirmed):
    trend == "bear" → body ≥ avgBody · 1.6 ? MSS : CHOCH
    else            → BOS
bearish break: mirrored
```

### Liquidity pools (BSL / SSL)
```
tol = tolTicks · tick = 4 · 0.25 = 1.0 pt
cluster pivots when |price_j − price_i| ≤ tol ; pool price = mean of cluster; count = cluster size
confirmTs = latest constituent pivot's confirmTs
swept ⟺ BSL: high > price + tol ; SSL: low < price − tol   (after confirmTs)
freshness window = 30 · 60 · 60,000 ms = 30 hours
sort by (count desc, ts desc)
```

### Premium / discount and OTE
```
dealing range = most recent confirmed swing high & low
eq   = (high + low) / 2                     equilibrium; above = premium, below = discount
span = high − low
dir  = hi.idx > lo.idx ? "bull" : "bear"
OTE (bull leg) : from = high − span·0.62 ,  to = high − span·0.79
OTE (bear leg) : from = low  + span·0.62 ,  to = low  + span·0.79
```
IRL = FVGs/OBs fully inside `[range.low, range.high]` and still live;
ERL = the range's own extremes.

### Kill zones and macros (ET)

| id | label | start | end |
|---|---|---|---|
| `asia` | Asian Killzone | 20:00 (1200) | 24:00 (1440) |
| `london` | London Killzone | 02:00 (120) | 05:00 (300) |
| `nyam` | NY AM Killzone | 07:00 (420) | 10:00 (600) |
| `nypm` | NY PM Killzone | 13:30 (810) | 16:00 (960) |
| `silver1` | Silver Bullet AM | 10:00 (600) | 11:00 (660) |
| `silver2` | Silver Bullet PM | 14:00 (840) | 15:00 (900) |
| `macroAm` | NY AM Macro | 09:50 (590) | 10:10 (610) |
| `macroPm` | NY PM Macro | 13:10 (790) | 13:40 (820) |

Active ⟺ `startMin ≤ etMinutes(ts) < endMin` (wrap-aware for the Asian window).

**Turtle Soup raid windows** — `ictPlays.ts` → `TURTLE_RAID_WINDOWS`

| id | label | start | end |
|---|---|---|---|
| `londonOpen` | London open | 02:00 (120) | 02:30 (150) |
| `londonInj` | London injection | 03:45 (225) | 04:08 (248) |
| `nyam1` | NY AM manipulation | 08:14 (494) | 08:38 (518) |
| `nyam2` | NY AM manipulation | 09:23 (563) | 09:45 (585) |
| `lunch` | Lunch liquidity raid | 12:45 (765) | 13:08 (788) |
| `nypm` | NY PM raid | 14:15 (855) | 14:38 (878) |

### Other ICT detectors

```
Daily bias    : mid = (priorHigh + priorLow)/2 ; last > mid → bull, < mid → bear, else neutral
Inducement    : scan 12 bars after a pivot's confirmIdx
                high pivot: c.high > p.price && c.close < p.price → bear
                low  pivot: c.low  < p.price && c.close > p.price → bull
Turtle Soup   : pool.count ≥ 2 ; BSL: high > price+tol && close < price → bear
                                 SSL: low  < price−tol && close > price → bull
Judas Swing   : opens = [120, 570] ET, 60-min window, ≥ 3 bars
                MIN_LEG = 0.25 , MIN_BACK = 0.20   (fractions of window range)
                bear ⟺ hiTs < loTs && (hi−open) ≥ range·0.25 && (open−last) ≥ range·0.20
                bull ⟺ loTs < hiTs && (open−lo) ≥ range·0.25 && (last−open) ≥ range·0.20
Breaker       : most recent OB with ob.ts < s.ts and ob.dir ≠ s.dir; retest bar overlaps the OB zone
CISD          : minRun = 3 same-colored candles; flip ⟺ next.close crosses back through runOpen
2022 Model    : sweep → MSS → FVG, each link within 10 · 300,000 ms = 50 minutes
PO3 / AMD     : accumulation 20:00 ET (prior) – 02:00 ET ; manipulation 02:00–07:00 ;
                distribution 09:30–16:00 ; distDir = last NY close vs (accHigh+accLow)/2
CRT           : second-to-last completed hourly bucket → hi/lo/eq; first bar to sweep either extreme
```

### ICT play construction

**Source:** `lib/calculations/ictPlays.ts`
```
n   = min(14, candles.length − 1)
TR_i= max( high−low , |high − prevClose| , |low − prevClose| )
ATR = max(1, mean(TR over last n))
buf = max(1, ATR · 0.15)

structural stop:
   bull: lvl = max(confirmed lows below entry)  (fallback entry − ATR) ; stop = min(lvl − buf, entry − buf)
   bear: lvl = min(confirmed highs above entry) (fallback entry + ATR) ; stop = max(lvl + buf, entry + buf)

risk       = |entry − stop|
targets    = entry ± r·risk    for PLAY_TARGET_RS = [1, 2, 3]
RR         = |targets.last − entry| / risk        (= 3 for the standard ladder)

grading: fav = bull ? high−entry : entry−low ; mfe = max(fav) ; r = fav/risk
   hitR = min(3, max(hitR, floor(r))) once r ≥ 1
   stop and target on the same bar → resolves as the STOP (conservative)
   won  ⟺ (no stop && r ≥ 3) OR (stop hit && mfeR ≥ 1)
   lost ⟺ stop hit && mfeR < 1
   mfeR = mfe / risk
```
Lifecycle: `tfMin = 5`, `barMs = 300,000`, `maxOpenBars = 24` (~2 h), `keepResolvedBars = 6`, `limit = 4`.
Duplicates collapse on `(kind, dir, round(entry))`.

**Turtle Soup play model**
```
tol = max(0.25, ATR · 0.05) ; RAID_WAIT = 24 bars ; FVG_WAIT = 6 bars
raid taken   ⟺ high > p.price + tol (high pivot) | low < p.price − tol (low pivot)
failed break ⟺ close back through the level ; raid must land inside a TURTLE_RAID_WINDOW
entry = midpoint of the first matching reversal FVG within 6 bars that is traded back into
        ("consequent encroachment"), else the raid candle's close
stop  = bull: raidLow − buf ; bear: raidHigh + buf
```

---

## 11. Confidence scoring

**Source:** `lib/confidenceScore.ts` (mirrored in `server-v2/_lib-confidence.cjs`)

### Structural factors
```
distScale     = isFinite(intradayRange) && > 0 ? intradayRange : emSize
distance      = level − price
proximity     = clamp01( 1 − |distance| / distScale )
gexMagnitude  = clamp01( |netGexAtLevel| / totalAbsNetGEX )
flipProximity = clamp01( 1 − |price − gexFlip| / distScale )
dexBias       = clamp( netDexAtLevel / totalAbsNetGEX, −1, 1 )
timeWeight    = clamp01( 1 − sessionProgress · 0.6 )               1.0 at open → 0.4 at close
gexRank       = clamp01(ctx.gexRank ?? 1)

regime        = netGexAtLevel > 0 ? positive : < 0 ? negative : flat
posGamma      = positive → 1 , flat → 0.4 , negative → 0
negGamma      = negative → 1 , flat → 0.4 , positive → 0
dexTowardLevel= sign(distance) == sign(netDex) ? |dexBias| : 0
dexOpposes    = sign(distance) != sign(netDex) ? |dexBias| : 0
```

### Live rule prior
```
hit   = 0.15 + 0.45·proximity + 0.25·gexMagnitude + 0.10·timeWeight + 0.10·dexTowardLevel
        (+ 0.05·gexMagnitude if isOpexOr0DTE)                     clamp [0, 0.95]

chop  = 0.15 + 0.45·posGamma·gexMagnitude + 0.25·proximity·posGamma
        (+ 0.10·posGamma if isOpexOr0DTE)                         clamp [0, 0.90]

pivot = 0.10 + 0.35·posGamma·gexMagnitude·gexRank + 0.25·proximity + 0.20·dexOpposes
        (− 0.15·flipProximity when regime == negative)            clamp [0, 0.90]

break = 0.05 + 0.40·negGamma·gexMagnitude + 0.25·proximity·negGamma
        + 0.20·dexTowardLevel·negGamma + 0.15·flipProximity·negGamma
        − 0.20·posGamma·gexMagnitude·gexRank                      clamp [0, 0.90]
```

### Historical blend and anchoring

Study base rates (`STUDY`): `reach = 0.75`, `pivot = 0.55`, `chop = 0.26`, `break = 0.17`,
`openAtMVCPivot = 0.85`, `ivLow = 16`, `ivHigh = 45`.

```
historyWeight = clamp( 0.65 · n/(n+10), 0, 0.65 )         n = 5 → 0.217 · n = 15 → 0.39 · cap 0.65
x = (1 − historyWeight)·prior.x + historyWeight·rate.x      for hit, pivot, chop

rejection adjustment (when rejectionRate finite):
    decay = clamp01( 1 − sessionsSinceDefense · 0.08 )     −8% per session since last defense
    boost = clamp01(rejectionRate) · decay
    conf  = clamp( sampleSize/(sampleSize+6), 0, 1 )
    pivot = clamp( pivot + 0.30·boost·conf, 0, 0.95 )
    break = clamp( break − 0.25·boost·conf, 0, 0.90 )
    note fires at rejectionRate ≥ 0.6 and conf ≥ 0.4

study anchoring (ANCHOR = 0.5):
    hit = 0.5·0.75 + 0.5·hit ; pivot = 0.5·0.55 + 0.5·pivot
    chop= 0.5·0.26 + 0.5·chop; break = 0.5·0.17 + 0.5·break

open-at-MVC:
    pivot = 0.7·0.85 + 0.3·pivot ;  hit = max(hit, 0.9)
```

### Two-stage output
```
hitPct   = round(hit · 100)                              ← stage 1, stands alone
condSum  = pivot + chop + break                          ← stage 2, conditional on a hit
pivotPct = round(pivot/condSum · 100)
brkPct   = round(break/condSum · 100)
chopPct  = 100 − pivotPct − brkPct                       ← remainder absorbs rounding
(condSum ≤ 0 → 33 / 34 / 33)
netWallBias = pivotPct − brkPct        ∈ [−100, 100]     ≥ +25 lean defense · ≤ −25 respect the break
```

### Day classification and analog stats

**Source:** `lib/confidence-compute.ts`

| Constant | Value | Meaning |
|---|---|---|
| `HIT_PTS` | 8 | SPX pts within the level to count as a touch |
| `PIVOT_PTS` | 10 | Reversal ≥ this after touch = pivot |
| `CHOP_BAND` | 15 | Stayed within ± this of the level = chop |
| `ANALOG_GEX_TOL` | 0.25 | GEX-dominance similarity window |
| `ANALOG_MAX` | 120 | Prior days scanned |
| `EM_FALLBACK_FRACT` | 0.004 | EM proxy = 0.4% of price when no intraday range |
| `EM_FLOOR_FRACT` | 0.006 | EM floor = 0.6% of price |
| `APPROACH_PTS` | 40 | Within this of the level (untouched) = "approaching" |
| `REJECT_CLUSTER_PTS` | 15 | Analog MVC strike within this = same cluster |
| `FIRST_15M` | 15/390 ≈ 0.03846 | Session-progress fraction defining "the open" |
| `CACHE_TTL_MS` | 60,000 | Response cache lifetime |

```
touchedIdx = first i with |spx[i] − level| ≤ 8      (else "miss")
outcome = maxAway ≥ 10 → pivot ; maxBand ≤ 15 → chop ; else hit
brokeThrough = approachFromBelow ? (last − level > 8) : (level − last > 8)

intradayRange   = (max(spx) − min(spx)) / 2
proxScale       = max(intradayRange, refPrice · 0.003)
emSize          = max( emOverride ?? (intradayRange > 0 ? intradayRange : refPrice·0.004),
                       refPrice · 0.006 )
sessionProgress = clamp01( (nowMin − 570) / (960 − 570) )

curGexMag     = |netGex| / totalAbsNetGEX
hitRate       = (hits + pivots + chops) / sampleSize
pivotRate     = pivots / sampleSize
chopRate      = chops / sampleSize
rejectionRate = clusterRejections / clusterTouches        (same-cluster ±15 pts only)
gexRank       = clamp( 1 − rank·0.2, 0.2, 1 )             rank 0 → 1.0, 1 → 0.8, …, floor 0.2
```
**Scenario archetypes:** `approaching`, `untouched`, `squeeze` (neg-γ pivot), `cascade` (neg-γ break),
`chop`, `reversal` (pos-γ pivot), `false-break` (pos-γ break with `overshoot ≥ 10` and `maxAway ≥ 8`),
`breakout`, `pinned`.

### Confidence checkpoints

**Source:** `lib/confidenceCheckpoints.ts`
```
HIT_PTS = 8 ; TIERS = [5, 10, 15] ; MATCH_WINDOW = ±20 min
checkpoints (ET) = 09:45 (585) , 10:30 (630) , 12:00 (720)

distAt   = |spxAt − strike|
closest  = min |spx − strike| from (checkpoint − 20 min) onward, discarded if > strike · 0.5
hit      = closest ≤ 8
tiers[t] = closest ≤ t
hitRate    = hits / samples ;  avgClosest = mean(closest) ;  tierRate_t = count(tiers[t]) / samples
```
7-day tracker uses the 7 most recent completed ET dates, cached 21,600 s (6 h) per calendar day.

---

## 12. GEX Pulse score

**Source:** `lib/gexPulse.ts`
```
score = clamp( round( Σ of 8 signed contributions ), −100, 100 )
scaled(dist, spot, span, weight) = round( sign(dist) · weight · clamp(|dist|/(spot·span), 0.25, 1) )
```

| # | Component | Max | Rule |
|---|---|---|---|
| 1 | Center of Balance | ±16 | `scaled(spot − cb, spot, 0.004, 16)`; label "at CB" if `\|d\| < spot·0.0006` |
| 2 | Call Wall | ±10 | `room = (cw − spot)/spot`: `<0 → +8`, `>0.008 → +10`, `>0.002 → +5`, else `−4` |
| 3 | Put Wall | ±14 | `cushion = (spot − pw)/spot`: `<0 → −14`, `>0.008 → +14`, `>0.002 → +7`, else `−10` |
| 4 | Gamma Flip | ±20 | straddling (`\|d\| < spot·0.0008`) → `round(sign(d)·4)`; else `scaled(d, spot, 0.005, 20)` |
| 5 | Net GEX | ±18 | `round(clamp(netGex/2,−1,1)·12)` + `(Δ15m > 0 ? +6 : < 0 ? −6 : 0)` |
| 6 | Net DEX | ±12 | `round(clamp(netDex/2,−1,1)·12)`; "flat" label if `\|netDex\| < 0.15` |
| 7 | Δ GEX 15m | ±14 | `round(clamp(d/0.5,−1,1)·14)`; labels at `±0.25`; `null` baseline → 0 |
| 8 | GEX % | ±8 | `q ≥ 88 → −8` · `≥ 60 → +5` · `≥ 40 → 0` · `≥ 15 → −4` · else `−8` |

```
tone   = score > 15 → up · < −15 → dn · else neu
bias   = UPSIDE / DOWNSIDE / BALANCED
conf   = |score| ≥ 60 Strong · ≥ 30 Moderate · else Weak
regime = straddling → TRANSITION · (gexPct ≥ 88 && |score| < 30) → PINNED
         · aboveFlip → POSITIVE GAMMA · else NEGATIVE GAMMA
tgtUp  = (cb != null && spot < cb) ? cb : callWall
tgtDn  = (cb != null && spot > cb) ? cb : putWall
invalid= flip
```

---

## 13. Fail levels (LAF / LBF)

**Source:** `lib/failLevels.ts` → `scanLevel`, `detectTriggers`

Reference levels: ON high/low, PDH/PDL, PWH/PWL. RTH 570–960 min ET.
`attemptCap`: 2 for PWH/PWL, ∞ otherwise.

| Constant | Value | Meaning |
|---|---|---|
| `PROBE_MIN_PTS` | 0.5 | Below this = noise, not a sweep |
| `PROBE_MAX_PTS` | 12 | Beyond this = acceptance, not a sweep |
| `WICK_MIN_PCT` | 0.5 | Reclaim bar must reject ≥ 50% of its range |
| `ACCEPT_CLOSES` | 2 | Consecutive closes beyond = acceptance (no fade) |
| `STOP_BUFFER_PTS` | 1.5 | MFE stop beyond the sweep extreme |
| `bufferPts` | 0.5 | Level-break buffer |
| `confirmBars` | 2 | Scan window |
| `FRESH_BARS` | 4 | Trigger stays "active" ~20 min at 5m bars |
| `maxDays` | 20 | Trading days scanned for fail-rate stats |

```
fail requires ALL of:
  1) PROBE_MIN_PTS ≤ |extreme − price| ≤ PROBE_MAX_PTS
  2) fewer than 2 consecutive closes beyond the level within lookEnd = min(len−1, i + confirmBars + 2)
  3) reclaim bar closes back inside, wickPct = wick/barRange ≥ 0.5, plus lower-high (LAF)
     / higher-low (LBF) structure vs the probe extreme

riskPts   = |extreme − entry|   (floored at PROBE_MIN_PTS)     ← 1R
stopPrice = extreme ± 1.5 away from entry
ft        = running max favorable excursion until the stop is hit
maxR      = ft / riskPts
dir       = above ? −1 : +1
oppDist   = |entry − oppositeLevel|
t1 = entry + dir·oppDist·0.5 ; t2 = entry + dir·oppDist ; t3 = entry + dir·oppDist·2
tiersHit  = 3/2/1/0 by which target (entry + dir·ft) reached
failRate  = fails / tests   per level kind
```

**Entry triggers** (`buf = 0.5`, `rrTarget(entry, stop, m) = entry + (entry − stop)·m`)

| Trigger | Setup | Stop | Target |
|---|---|---|---|
| A | Break & retest long (ONH/PDH) | `min(level − buf, retestLow) − buf` | `rrTarget(·, 2)` |
| D | Breakdown & retest short (ONL/PDL) | `max(level + buf, retestHigh) + buf` | `rrTarget(·, 2)` |
| E | Poor-high rejection short | `probeHigh + buf` | `rrTarget(·, 2)` |
| E' | Poor-low reclaim long | `probeLow − buf` | `rrTarget(·, 2)` |
| C / C' | IB extension long/short (clears IB **and** ON extreme) | `ib.low − buf` / `ib.high + buf` | `entry ± (ib.high − ib.low)·2` |
| F | Balance→imbalance break (prior 2 bars inside ON range) | opposite ON extreme ± buf | `rrTarget(·, 1.5)` |

---

## 14. Dislocation velocity

**Source:** `lib/dislocationVelocity.ts` → `pushDV`
```
lambda = 0.06 ; gate = 0.5 ; zThresh = 2

range  = max(high − low, 0)
clv    = range > 0 ? 2·((close − low)/range) − 1 : 0          ∈ [−1, 1]

mean_t = n == 0 ? range : λ·range + (1−λ)·mean_(t−1)
dev    = range − mean_(t−1)                                    ← deviation vs PRIOR mean
var_t  = n == 0 ? 0 : λ·dev² + (1−λ)·var_(t−1)
sd     = √var_t
z      = sd > 1e-9 ? (range − mean_t)/sd : 0

directional = |clv| ≥ 0.5
hot         = z ≥ 2
velocity    = (hot && directional) ? z·clv : 0
regime      = !hot → quiet · directional → (clv > 0 ? impulse-up : impulse-down) · else two-sided
```

---

## 15. Momentum Bias Index

**Source:** `lib/momentumBias.js` → `getMomentumBiasIndex`

Defaults: `momentumLength = 10`, `biasLength = 5`, `smoothLength = 10`,
`impulseBoundaryLength = 30`, `stdDevMultiplier = 3.0`, `smoothIndicator = true`.

```
WMA(series, L)[i] = Σ_{k=0}^{L−1} series[i−L+1+k]·(k+1) / ( L·(L+1)/2 )
HMA(series, L)    = WMA( 2·WMA(series, ⌊L/2⌋) − WMA(series, L), ⌊√L⌋ )
EMA(v, span)      : α = 2/(span+1) ; ema[i] = α·v + (1−α)·ema[i−1]     (adjust = False)

momentum[i] = close[i] − close[i − 10]
hlEma       = EMA(high − low, 10), floored at 1e-10
stdDev[i]   = ( momentum[i] / hlEma[i] ) · 100

momUp   = max(stdDev, 0) ;  momDown = min(stdDev, 0)
sumUp   = rolling sum(momUp, 5) ;  sumDown = rolling sum(momDown, 5)     (NaN until window full)

upBias   = max( HMA(sumUp, 10), 0 )
downBias = max( HMA(−sumDown, 10), 0 )                    (unsmoothed: sumUp / −sumDown)

avgBias  = (upBias + downBias)/2
avgEma   = EMA(avgBias, 30)
avgStd   = rolling population stdev(avgBias, 30)          ddof = 0
boundary = avgEma + avgStd · 3.0

crossunder(x)[i] = x[i] < x[i−1] && x[i−1] ≥ x[i−2]
bullishTp = crossunder(downBias) && downBias > boundary && downBias > upBias
bearishTp = crossunder(upBias)   && upBias   > boundary && upBias   > downBias
```

---

## 16. Daily grades scorecard

**Source:** `server-v2/daily-grades-scorecard.js`

| Constant | Value | Meaning |
|---|---|---|
| `SCORECARD_VERSION` | 2 | Schema version |
| `FLIP_CHOP_PCT` | 0.25 | % from flip defining "transition" |
| `DIST_SWEET_LO / HI` | 0.30 / 1.00 | % distance sweet band for wall relevance |
| `DIST_FAR_PCT` | 3.00 | Beyond this, wall quality decays to 0 |
| `EM_FALLBACK_PCT` | 1.00 | EM fallback % when none on file |
| `BREAK_FOLLOW_EM` | 0.25 | Break "followed through" if it extends ≥ 25% of EM past the wall |
| `STAB_HOLD_PCT` | 0.15 | Overnight drift ≤ this = "held" |
| `STAB_CHASE_PCT` | 0.50 | Drift ≥ this in price's direction = "chasing" |
| `MIN_WEIGHT` | 0.25 | Floor on any component weight |
| `COMPONENT_PTS` | 25 | Points per component before weighting |

```
GRADE_BANDS(pts): ≥85 A+ · ≥72 A · ≥58 B · ≥44 C · ≥28 D · else F
pctTo(spot, level) = (level − spot)/spot · 100
ramp(x, x0,y0, x1,y1) = linear interpolation, clamped outside [x0, x1]
weightOf(q, fallback = 1) = clamp(q ?? fallback, 0.25, 1)
```

**Regime** (`readRegime`)
```
flipDistPct = pctTo(spot, flip) ; side = flipDistPct < 0 ? "above" : "below"
|flipDistPct| < 0.25 → transition , conf = clamp( 0.20 + 0.25·(|flipDistPct|/0.25), 0, 1 )
only netGex known    → sign(netGex) , conf = 0.45
only flip known      → above ? positive : negative , conf = clamp( ramp(|d|, 0.25,0.35, 1.5,0.7), 0, 1 )
both known, disagree → transition , conf = 0.35
both known, agree    → sign(netGex) , conf = clamp( ramp(|d|, 0.25,0.55, 1.5,1.0), 0, 1 )
```

**Wall quality** — `QUALITY_WEIGHTS = { dist: 0.30, size: 0.22, conc: 0.16, em: 0.14, stab: 0.12, conf: 0.06 }`
```
sizeScore = clamp( log10(peak / median_live_side) / log10(20), 0, 1 )        needs ≥ 3 live values
concScore : share = peak/(peak + left + right) ; clamp( (share − 1/3)/(2/3), 0, 1 )
distScore : d = |distPct|
            d < 0.30       → ramp(d, 0, 0.30, 0.30, 1.0)
            0.30 ≤ d ≤ 1.00 → 1
            d > 1.00       → ramp(d, 1.00, 1.0, 3.00, 0)
emScore   : ratio = |distPct|/emPct ; ≤0.8 → 1 · ≤1.2 → 0.8 · else ramp(ratio, 1.2,0.8, 2.5,0.1)
            (null EM → neutral 0.6)
confluence: step pairs by magnitude ≥1000 → (100,50) · ≥200 → (50,25) · ≥50 → (10,5) ·
            ≥10 → (5,1) · else (1,0.5) ; tol = max(v·0.0004, minor·0.06)
            major → 1 · minor → 0.7 · else 0.35
stability : driftPct = (level − prevLevel)/prevLevel · 100
            |driftPct| ≤ 0.15 → held (1.0)
            else if |movePct| > 0.05: sameWay && |driftPct| ≥ 0.50 → chasing (0.35)
                                      !sameWay → firming (0.85)
            else → drift (0.6)
quality = weighted mean of present sub-scores using QUALITY_WEIGHTS
```

**The call** (`reactionCall`)
```
side = nearer of cap/floor by |dist_pct|
regime unknown        → none
regime transition     → low_conviction
regime negative       → expect_break
near.stability chasing→ expect_break
nearQ ≥ 0.55          → fade_first_test
else                  → low_conviction
callConf = clamp( 0.55·regimeConf + 0.45·nearWallQuality, 0, 1 )      (0 if call == none)
```

**Setup score** (premarket)
```
weights: regime.conf 0.30 · cap.quality 0.25 · floor.quality 0.25 · apex.quality 0.10 · flipQuality 0.10
flipQuality = clamp( 0.6·regime.conf + 0.4·distScore(flipDistPct), 0, 1 )     (0.5 fallback)
setup = 100 · weighted_mean(present parts) ; setup_grade = GRADE_BANDS(setup)
```

**Post-close grading** (0–25 pts per component)

| Regime | Outcome → points |
|---|---|
| Positive | `tagged_held 25` · `untested_held 15` · `tagged_broke 5` · `gapped_through 0` |
| Negative | `broke_accelerated 25` · `gapped_ran 22` · `absorbed 16` · `broke_reverted 10` · `untested_quiet 8` |
| Transition | `chop_held 22` · `chop_broke 8` · `chop_gapped 4` |

```
followed = beyond ≥ 0.25 · emAbs , where beyond = |close − level| if closed outside else 0

gradeRegime:
    rangePct = (high − low)/open · 100 ; dirRatio = |close − open|/(high − low) ; em = emPct || 1.00
    positive  : quiet = rangePct ≤ 1.15·em ; directional = dirRatio ≤ 0.60
    negative  : quiet = rangePct ≥ 0.95·em ; directional = dirRatio ≥ 0.50
    transition: quiet = rangePct ≤ em      ; directional = dirRatio ≤ 0.45
    hits = quiet + directional → 2: regime_held 25 · 1: regime_partial 14 · 0: regime_failed 4

gradeReaction:
    low_conviction  : contained (inside cap/floor) + quiet ((high−low)/open·100 ≤ em)
                      → 2 hits call_hit 25 · 1 call_partial 13 · 0 call_missed 5
    fade_first_test : not reached → call_untested 12 · closed through → call_missed 4 · held → call_hit 25
    expect_break    : not reached → call_untested 9 · reached not through → call_missed 6
                      · through & followed → call_hit 25 · through not followed → call_partial 13
```

---

## 17. Pick grade (GEX-change top)

**Source:** `server-v2/_lib-pick-grade.cjs`
```
peak (max_pct) : ≥150 → 55 · ≥100 → 50 · ≥50 → 42 · ≥30 → 33 · ≥20 → 26 · ≥10 → 18 · >0 → 8 · else 0
pain (min_pct, default −25): ≥−10 → 25 · ≥−20 → 20 · ≥−30 → 15 · ≥−45 → 9 · ≥−60 → 4 · else 0
close (close_pct, default 8): ≥50 → 20 · ≥20 → 16 · ≥0 → 11 · ≥−20 → 6 · ≥−50 → 2 · else 0
pts = peak + pain + close
neverGreen = !(max_pct > 0) → grade forced to F
GRADE_BANDS: ≥85 A+ · ≥72 A · ≥58 B · ≥44 C · ≥28 D · else F ;  isGood = {A+, A, B}
```

**Feature buckets** — `dte` 0/1/2-4/5-9/10+ · `slot` <600 / <690 / <810 / <900 / 15:00+ ·
`entry` <1 / <2 / <5 / ≥5 · `otm%` <7 / <10 / <15 / ≥15 · `rank` 1..6+ · `nsamp` ≤2 / ≤5 / ≤11 / 12+ ·
`gexopen` <50k / <250k / <1M / 1M+ · `pctopen` <50 / <100 / <200 / 200+ ·
`chg` <500k / <1M / <3M / 3M+ · `z` <1 / <2 / <3 / 3+

**Projection / auto-fit**
```
pts   = BASE(50) + Σ matching term.pts , clamped [0, 100]
MIN_PICKS = 150 ; MIN_LIFT = 6 ; MAX_TERMS = 8 ; MAX_PTS = 20 (per-term clamp)
bucket qualifies ⟺ !thin && holds === true (survived a half-split) && |lift| ≥ 6
terms sorted by |lift| desc, top 8 kept, each clamped to ±20
(the 'score' bucket, if used, excludes the redundant 'chg'/'pctopen' buckets)
```

---

## 18. Vol-pin detection

**Source:** `server-v2/vol-pin-recorder.js`

| Constant | Value | Meaning |
|---|---|---|
| `SWEEP_MINS` | 5 | Snapshot cadence (min) |
| `TICKER_DELAY` | 800 ms | Delay between per-ticker fetches |
| `MAX_ACTIVE` | 30 | Watchlist cap |
| `PIN_SEARCH_PCT` | 0.10 | ±10% of spot strike window for the pin search |
| Excluded | SPX, NDX, VIX, RUT, XSP | No dealer-hedging pin mechanics |

```
atm_strike = argmin |strike − spot| among calls
atm_iv     = (atm_call_iv + atm_put_iv)/2  if both > 0, else whichever is non-zero
pin_strike = argmax (callOI + putOI) over strikes ∈ [spot·0.90, spot·1.10]

day_hi = max(stored, spot) ; day_lo = min(stored, spot)
range_pct = (day_hi − day_lo) / day_lo

returns[i]        = ln( spot[i] / spot[i−1] )        over the last ≤ 24 five-min snapshots (needs ≥ 3)
variance          = Σ(returns − mean)² / (n − 1)     sample variance
RV_ANNUAL_FACTOR  = √( 252 · round(390 / SWEEP_MINS) ) = √(252·78) ≈ 140.4
rv_ann            = √variance · RV_ANNUAL_FACTOR
iv_rv_spread      = (atm_iv − rv_ann) / atm_iv       (null if rv missing or atm_iv ≤ 0)

over the last minSnaps = 3 snapshots:
spread_delta = latest.iv_rv_spread − oldest.iv_rv_spread
range_delta  = latest.range_pct    − oldest.range_pct
pin_dist_pct = |spot − pin_strike| / spot

PINNING   ⟺ spread_delta < −0.005 && range_delta < −0.001 && pin_strike > 0 && pin_dist_pct < 0.005
SQUEEZING ⟺ spread_delta < −0.005 && range_delta < −0.001  (pin-distance test fails)
else null
```

---

## 19. Display / threshold coloring

**Source:** `lib/calculations/gexThreshold.ts`

| Constant | Value | Meaning |
|---|---|---|
| `fillAlpha` | 0.53 | Above-threshold cell opacity |
| `dimAlpha` | 0.035 | Below-threshold cell opacity |
| `cbAlpha` | 0.53 | Core Bullseye marker opacity |
| `wallAlpha` | 1 | Wall opacity |
| `wallBoost` | 0.6 | Wall fill saturation/luminance push (0 = raw hue) |
| `wallRim` | 0.8 | Wall outline lightness (0 = matches fill, 1 = near-white) |
| `wallRimW` | 2 px | Wall outline width |
| `wallGlow` | 0.65 | Wall glow intensity |
| `cbOutlineW` | 1 px | CB outline width |
| `TH_AT_MIN` | 4 | Threshold % at the slider's quiet position |

```
share      = |value| / gross · 100          gross = Σ|GEX| over the column (sign-blind denominator)
filled     ⟺ share ≥ thPct , at fillAlpha ; else dimAlpha ; "transparent" if value = 0 or gross ≤ 0
thresholdPct(intensity, min, max):
    t = clamp( (intensity − min)/(max − min), 0, 1 )
    threshold% = TH_AT_MIN · (1 − t)         top of track → 0% , bottom → 4%
    e.g. track [0.5, 3], intensity 1.75 → t = 0.5 → 2.00%

boostHex(hex, a = 0.6): TARGET_L = 0.6 ; newS = s + (1−s)·a ; newL = l + (0.6−l)·a·0.9 + a·0.06
rimHex(hex, a = 0.8)  : newS = s·(1 − a·0.55) ; newL = l + (0.97 − l)·a
inkOn(hex, a)         : L = (0.299R + 0.587G + 0.114B)/255
                        L·a + 0.03·(1−a) > 0.55 → dark ink #0a1016 , else #ffffff
wall glow             : blur1 = round(4 + wallGlow·12) px @ rgba(base, 0.30 + wallGlow·0.5)
                        blur2 = round(1 + wallGlow·3)  px @ rgba(base, 0.55 + wallGlow·0.45)
```

**Chain-grid heat tint** — `lib/calculations/optionChain.ts` → `metricBg`, `rankBg`
```
RANK_FLOOR_ALPHA: rank 1 = 0.90 · rank 2 = 0.45 · rank 3 = 0.25
otherwise: ratio = min(|value|/maxValue, 1)
           eased = ( ratio · max(intensity, 0.1) )^1.4
           alpha = min( 0.18, 0.02 + eased·0.16 )
color: value ≥ 0 → rgba(41,182,246,α)  ·  value < 0 → rgba(255,71,87,α)
```

**GEX bubble overlay** — `lib/gexBubbleModel.ts` (`BUBBLES.*` defined in `slotStore.ts`)
```
stride  = spacingPx > 0 ? max(1, ceil(BUBBLES.bucketPxPerDot / spacingPx)) : 1
mins    = max(1, round(bucketMinutes · stride))
spacing = spacingPx · stride
room    = spacing > 0 ? BUBBLES.capOfSpacing · spacing : pr.capPx
capPx   = max( BUBBLES.minPx, min(pr.capPx, room) · capScale )
topRoom = spacing > 0 ? BUBBLES.topOfSpacing · spacing : pr.capPx · pr.topBoost
topCapPx= max( capPx, min(pr.capPx·pr.topBoost, topRoom) · capScale )
spare   = spacing > 0 ? spacing/2 − topCapPx : BUBBLES.glowMaxPx
floorPx = max( BUBBLES.minPx, min(pr.floorPx, capPx · BUBBLES.floorOfCap) )
glowPx  = max( 0, min(BUBBLES.glowMaxPx, spare) )

ratio   = windowMax > 0 ? min(1, |net|/windowMax) : 0        ← ONE shared denominator per window
base    = floorPx + ratio^BUBBLES.sizeCurve · (capPx − floorPx)
radius  = isTop ? min(base·topBoost, topCapPx) : base

fit: up to fitPasses shrink passes — room = Δy − gapPx ;
     if (rA + rB) > room: f = room > 0 ? room/(rA+rB) : 0 ; r ← max(minPx, r·f)
     still overlapping → x-jitter ±jitterPx, alternating

minOpacity = 1 − BUBBLES.fade
alpha      = (isTop ? 1 : minOpacity + ratio·(1 − minOpacity)) · age
age        = BUBBLES.ageKeep + (1 − BUBBLES.ageKeep) · ( (bucketTs − firstTs) / max(1, spanMs) )
```

---

## 20. Session times and calendar

**Source:** `lib/marketSession.ts` (+ constants echoed in `ibStats.ts`, `ibDaily.ts`, `balanceImbalance.ts`)

| Window | ET | Minutes of day |
|---|---|---|
| RTH | 09:30 – 16:00 | 570 – 960 |
| Initial Balance | 09:30 – 10:30 | 570 – 630 |
| Inner ORB | 09:30 – 09:45 | 570 – 585 |
| Contained-day cutoff | 14:00 | 840 |
| Half-day close | 13:00 | 780 |
| Time buckets | early ≤ 11:00 · midday ≤ 13:00 · else late | ≤ 660 · ≤ 780 |

**SPX / Globex feed live window** (`isSpxFeedLive`)
```
daily maintenance break : 16:00 – 18:00 ET (960 – 1080) — closed every day
Saturday                : closed
Sunday                  : open from 20:00 ET (≥ 1200)
Friday                  : open until 16:00 ET (< 960), then closed for the weekend
Mon–Thu                 : open except the maintenance break
```

**US market holidays** (`isHoliday`) — fixed: Jan 1, Jul 4, Dec 25, each weekend-observed
(Sat → preceding Fri, Sun → following Mon). Floating (`firstDay` = weekday of the 1st, 0 = Sun):
```
MLK           = 3rd Monday Jan  : day = 15 + ((8 − firstDay) mod 7)
Presidents    = 3rd Monday Feb  : same formula
Memorial      = last Monday May : lastMonday = lastDayOfMonth − ((weekday(lastDay) + 1) mod 7)
Labor         = 1st Monday Sep  : day = 1 + ((8 − firstDay) mod 7)
Thanksgiving  = 4th Thursday Nov: day = 22 + ((5 − firstDay) mod 7)
isTradingDay  = !weekend && !isHoliday
```

---

## 21. Statistical primitives

| Primitive | Formula | Where |
|---|---|---|
| Mean | `Σx / n` | ibStats `avg`, ibDaily, VSA baselines |
| Median (lower-middle) | `sorted[floor(n/2)]` | `tpo-forecast-compute.ts`, `amt.ts`, `ibStats.ts` |
| Median (averaged for even n) | `n%2 ? s[m] : (s[m−1]+s[m])/2`, `m = n>>1` | `ibBlend.ts`, `vsa.ts` |
| Population stdev | `√( mean( (x − μ)² ) )`, floored to 1 | `tpo-forecast-compute.ts` (k-NN z-scoring) |
| Sample variance | `Σ(x − μ)² / (n − 1)` | `vol-pin-recorder.js` (RV) |
| Rolling population stdev | ddof = 0 over 30 bars | `momentumBias.js` |
| EWMA mean / variance | `λ·x + (1−λ)·prev`, `λ = 0.06` | `dislocationVelocity.ts` |
| EMA | `α = 2/(span+1)`, adjust = False | `momentumBias.js` |
| WMA / HMA | see §15 | `momentumBias.js` |
| Logit / sigmoid | `ln(q/(1−q))` / `1/(1+e^−x)` | `ibBlend.ts` |
| RVOL | `volume / median(same-slot volume, trailing sessions)` | `vsa.ts` |
| Shrinkage | `(K·p0 + n·raw)/(K + n)` | `ibBlend.ts` (`K = 40`) |
| Saturating weight | `0.65 · n/(n+10)`, `n/(n+6)` | `confidenceScore.ts` |
| k-NN inverse-distance | `w_i = (1/(d_i+1e-6)) / Σ(1/(d_j+1e-6))` | `tpo-forecast-compute.ts` |
| Percentile-style capture | 70% contiguous value-area expansion | `tpo.ts`, `valueArea.ts` |

---

## 22. Source file index

| Area | File |
|---|---|
| Black-Scholes, IV, time-to-expiry | `server-v2/computation/utils.js` |
| GEX ladder, flip, walls, totals | `server-v2/computation/gex-calculator.js` |
| VEX / CHEX | `server-v2/computation/vex-chex.js` |
| Dealer inventory, notional gamma | `server-v2/computation/dealer-inventory.js` |
| DTE buckets | `server-v2/computation/dte-buckets.js` |
| Flow tape, aggressor inference | `server-v2/computation/flow-processor.js` |
| Flow GEX accumulator | `server-v2/computation/flow-gex.js` |
| Gross gamma churn | `server-v2/_lib-gex-gross.cjs` |
| Client GEX / profile / DEX / EM | `lib/calculations/calculations.ts` |
| GEX summary wrapper | `lib/calculations/gex.ts` |
| Chain grid cells + heat tint | `lib/calculations/optionChain.ts` |
| Threshold coloring | `lib/calculations/gexThreshold.ts` |
| Heat-level wall selection | `lib/calculations/heatLevels.ts` |
| GEX bubble overlay | `lib/gexBubbleModel.ts` |
| GEX Pulse score | `lib/gexPulse.ts` |
| Estimated moves | `lib/calculations/estimated-moves.ts` |
| EM tracker result | `lib/em-tracker/computeResult.ts` |
| Iron condor | `lib/em-condor/compute.ts` |
| Flow summary | `lib/calculations/flow.ts` |
| Order-book imbalance | `lib/obook-compute.ts`, `server-v2/_lib-obook.cjs` |
| ES↔SPX basis | `server-v2/es-spx-basis.js` |
| ES gap math | `lib/esGapMath.js` / `.ts`, `server-v2/es-gap-tracker.js` |
| TPO profile & structures | `lib/tpo.ts` |
| Value area / LVN | `lib/valueArea.ts` |
| TPO k-NN forecast | `lib/tpo-forecast-compute.ts` |
| AMT read | `lib/amt.ts` |
| Balance / imbalance | `lib/balanceImbalance.ts` |
| IB backtest engine | `lib/ibStats.ts` |
| IB daily results + 14 rules | `lib/ibDaily.ts`, `server-v2/_lib-ibdaily.cjs` |
| Bayesian blending | `lib/ibBlend.ts` |
| VSA | `lib/vsa.ts` |
| ICT concepts | `lib/calculations/ictConcepts.ts` |
| ICT plays / R math | `lib/calculations/ictPlays.ts` |
| Confidence prior + blend | `lib/confidenceScore.ts`, `server-v2/_lib-confidence.cjs` |
| Confidence day classification | `lib/confidence-compute.ts` |
| Confidence checkpoints | `lib/confidenceCheckpoints.ts` |
| Fail levels / triggers | `lib/failLevels.ts` |
| Dislocation velocity | `lib/dislocationVelocity.ts` |
| Momentum bias index | `lib/momentumBias.js` |
| Daily grades scorecard | `server-v2/daily-grades-scorecard.js` |
| Pick grade | `server-v2/_lib-pick-grade.cjs` |
| Vol-pin detection | `server-v2/vol-pin-recorder.js` |
| Session times / holidays | `lib/marketSession.ts` |
