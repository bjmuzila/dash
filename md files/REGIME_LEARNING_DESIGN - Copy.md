# Regime Engine: Persistent Learning Architecture

## Current State
- Stateless 20-bar refits every 60s (alert recorder) or ~10 bars (client)
- No DB persistence; loses fit on reload/restart
- Transition matrix recalculates from scratch each cycle
- No validation loop; no feedback on regime call accuracy

## Target State
- **30D rolling window** persisted in Postgres
- **Daily refit** (1x/day, off-market) on 30D historical + live candles
- **Validation loop** — measure if yesterday's regime calls were accurate (did Trend → actual up move?)
- **Adaptive transitions** — adjust transition matrix if prediction accuracy drops below threshold
- **Client-side caching** — fetch latest fit at session start, don't recompute every 60s

---

## Architecture

### 1. Data Layer (Postgres)
```
regime_fits (per ticker)
├── ticker (ES, NQ, SPX, SPY)
├── fit_timestamp (when refit happened)
├── hmm_params (JSON: means[], covs[], transitions[], weights[])
├── decoded_path (JSON: array of labels for each historical bar)
├── stationary_dist (JSON: {Trend%, Chop%, Panic%})
├── accuracy_metrics (JSON: {precision, recall, f1, hit_rate})
└── version (for rollback)

regime_validation_log (per refit)
├── ticker
├── refit_date
├── regime_label (Trend/Chop/Panic on day N)
├── actual_return_pct (day N+1 or N+5 close)
├── predicted_correctly (bool)
├── confidence (hmm probability)
└── notes (for tuning alerts)
```

### 2. Trainer (server-v2/regime-trainer.js)
**Trigger:** Daily 5:00 AM ET (before market open) via cron or manual `/admin/retrain-regimes`

**Flow:**
```
1. Fetch 30D candles + today (DB + TT/Theta)
2. Fit HMM on 30D log-returns (Baum-Welch, same as now)
3. Run Viterbi decoder → decoded_path for all 30 days
4. Calculate stationary distribution from transition matrix
5. Store fit + metrics in regime_fits
6. Validate: compare previous day's regime label vs actual return
   → store in regime_validation_log
7. If accuracy < 65% (configurable): flag alert in admin panel
8. Broadcast new fit to connected clients via WS
```

### 3. Client (app/test/page.tsx → useRegimeFit)
**On mount:**
```
1. Query /api/regime-fit?ticker=ES (returns latest regime_fits row)
2. Cache in React state
3. Use stored hmm_params for all UI (charts, state pills, tree, etc.)
4. Listen to WS "regime-fit-updated" → refetch if stale
```

**No more client-side refits.** Charts shade from stored `decoded_path`, not recomputed every 60s.

### 4. Alert Recorder (server-v2/regime-alert-recorder.js)
**Change:** Use server's stored fit + decoded_path, not refit each cycle
```
- On new candle: fetch latest regime_fits
- Use stored transition matrix to project confidence
- CONFIRM_BARS debounce → open/close alerts (already in place)
- No more wobble from constant refits
```

---

## Key Decisions

| Decision | Why |
|----------|-----|
| 30D window | Enough history for HMM to learn regimes; weekly refresh tunes to current market |
| Daily refit at 5 AM | Off-market; no live chop noise; fits close-to-close returns cleanly |
| Store decoded_path | Validation: compare day N's label vs day N+1 return; no recompute on every load |
| Accuracy threshold 65% | If regime calls fail >35% of the time, something broke (alert admin) |
| Broadcast on refit | Clients reload fit, charts update once/day, not every 60s |
| Keep CONFIRM_BARS | Still debounce alert opens (prevents noise), but from stable stored fit, not wobbling refit |

---

## Validation / Feedback Loop

**After daily refit, measure:**
- **Hit rate:** % of times regime matched next-day direction
  - Trend + positive return = HIT
  - Chop + sideways (±0.5%) = HIT
  - Panic + volatility (ATR > threshold) = HIT
- **Confidence vs accuracy:** Do high-confidence regimes actually win more?
- **Transition accuracy:** Did the predicted next regime actually occur?

**Red flags:**
- Hit rate <65% → regime labels not predictive; may need longer window or different HMM K
- Accuracy dropped sharply day-over-day → market structure changed; may need more frequent refit or adaptive threshold

---

## Integration Checklist

- [ ] Add `regime_fits` + `regime_validation_log` tables (migrations/)
- [ ] Build trainer cron job (server-v2/regime-trainer.js)
- [ ] Add `/api/regime-fit` endpoint
- [ ] Add `/api/regime-retrain` (admin only, manual trigger)
- [ ] Update `useRegimeFit()` hook to fetch from API, not compute client-side
- [ ] Remove client-side refit from RegimeEngineTab
- [ ] Update alert recorder to use stored fit
- [ ] Add admin panel card showing last refit + accuracy metrics
- [ ] Add WS broadcast on successful refit
- [ ] Add validation visualization (next day: did regime call win? why/why not?)

---

## Tomorrow with Opus

Start with **Data Layer** (migrations + schema) and **Trainer** (trainer.js + cron wiring). Then **Client integration** (hook + API endpoint).

---

# Pairs Regime Engine: Co-Equal HMM Addition

## Overview
A second, independent HMM running in parallel to the market regime detector. Instead of market macro (Trend/Chop/Panic), the pairs HMM learns regimes from **spread behavior**:
- **MeanRevert**: Spread oscillating around its mean (reversion trades likely to win)
- **Drift**: Spread trending away from mean (reversion fades; avoid or size down)
- **Stuck**: Spread flat or low vol (no edge, low confidence)

**Usage:** Both regimes inform position size and entry conviction. Market regime + pairs regime must align for max confidence.

---

## Architecture

### 1. Data Layer (Postgres) — Additions

```
pairs_regime_fits (per pair, per ticker window)
├── pair_id (ES-SPX, NQ-NDX, etc.)
├── fit_timestamp
├── lookback_bars (20 for intraday 5m, or 60 for daily)
├── hmm_params (JSON: means[], covs[], transitions[], weights[])
├── decoded_path (JSON: labels [MeanRevert|Drift|Stuck] for each bar)
├── stationary_dist (JSON: {MeanRevert%, Drift%, Stuck%})
├── accuracy_metrics (JSON: {spread_reversion_hit%, drift_accuracy%, auc})
├── observable_config (JSON: {type: 'spread_zscore', half_life: 20, threshold: 1.5})
├── version
└── notes (e.g., "ES β=0.75 vs SPX at 5m")

pairs_validation_log (per refit)
├── pair_id
├── refit_date
├── regime_label (MeanRevert/Drift/Stuck at bar N)
├── spread_zscore (observed spread at bar N)
├── mean_revert_happened (bool: did spread contract 5 bars later?)
├── drift_continued (bool: did spread keep drifting?)
├── confidence_percentile
├── notes
```

### 2. Observables & State Design

**Spread construction:**
```
spread_t = P1_t - β * P2_t
β = covariance(P1, P2) / variance(P2)   [or rolling 20-bar beta]
```

**Observable streams** (choose 1-2 per fit):
- **Spread returns**: `log(spread_t / spread_t-1)` — raw momentum
- **Zscore**: `(spread_t - MA20) / σ20` — distance from mean
- **Half-life**: OU mean-reversion half-life (decay speed)
- **Spread momentum**: `(spread_t - spread_t-5) / ATR` — signed range
- **Volatility regime**: `realized_vol_t / MA_vol` — spread chop level

**3-state HMM:**
```
MeanRevert: 
  - Low spread zscore variance (oscillating tightly around mean)
  - Fast mean-reversion half-life (< 15 bars)
  - High reversion hit rate next 5 bars

Drift:
  - Increasing zscore magnitude (moving away)
  - Slow half-life (> 30 bars, stuck trend)
  - Reversion fades next 5 bars; continue-drift wins

Stuck:
  - Low spread volatility, no clear direction
  - Ambiguous half-life
  - Neutral next-bar prediction
```

### 3. Trainer (server-v2/pairs-regime-trainer.js)

**Trigger:** Daily 4:30 AM ET (30 min before market; runs in parallel with market regime trainer)

**Flow:**
```
1. For each tracked pair (ES-SPX, NQ-NDX, etc.):
   a. Fetch 30D 5m candles for both legs (TT/Theta)
   b. Calculate β via rolling 20-bar covariance
   c. Build spread_t = P1_t - β*P2_t for all 30D bars
   d. Compute observable (e.g., zscore or half-life) for each bar
   e. Fit HMM (K=3: MeanRevert/Drift/Stuck) via Baum-Welch
   f. Viterbi decode → decoded_path (labels for all 30D bars)
   g. Validate: for each bar N, check if regime predicted reversion/drift correctly
      - MeanRevert: count if spread reversed 5 bars later (zscore flipped sign or halved)
      - Drift: count if spread continued drifting
      - Hit rate = % correct
   h. Store fit + metrics in pairs_regime_fits
   i. Broadcast to clients via WS "pairs-regime-updated"

2. If accuracy < 60%: flag alert (pair may be decorrelating or broken)
```

**Observable choice logic:**
```
if half_life < 15:  observable = "zscore" (mean-reverting pair)
elif half_life > 40: observable = "zscore + momentum" (drift-prone pair)
else: observable = "balanced" (mix both)
```

### 4. Client Integration (app/test/page.tsx → usePairsRegimeFit)

**New hook:**
```typescript
const { regime, confidence, zscore, halfLife } = usePairsRegimeFit(pair)
// regime: "MeanRevert" | "Drift" | "Stuck"
// confidence: 0–1 (state probability)
// zscore, halfLife: current observables for UI display
```

**Flow:**
```
1. On mount: fetch /api/pairs-regime-fit?pair=ES-SPX
2. Cache in React state
3. On new candle: 
   - Update zscore/half-life via real-time quote
   - Use stored HMM transition matrix to project regime confidence
4. Listen to WS "pairs-regime-updated" → refetch fit if refit happened
```

**UI additions:**
```
- Regime pill: "MeanRevert (92%)" or "Drift (65%)"
- Spread chart: overlay zscore band (±1σ, ±2σ)
- Confidence sparkline: did regime prediction win yesterday?
- Half-life gauge: how fast does this pair revert?
```

### 5. Signal Gating: Market Regime × Pairs Regime

**High conviction entry:**
```
IF market_regime == "Chop" AND pairs_regime == "MeanRevert" AND zscore > 1.5:
   size = base_size * 1.0 (full conviction)
ELSE IF market_regime == "Trend" AND pairs_regime == "MeanRevert":
   size = base_size * 0.6 (ride the trend, but pair fights it)
ELSE IF market_regime == ANY AND pairs_regime == "Drift":
   size = 0 (wait, spread is trending; no reversion edge)
ELSE:
   size = 0 (unknown state)
```

**Confidence score:**
```
entry_confidence = (market_regime_prob + pairs_regime_prob) / 2
                 * reversion_hit_rate_yesterday
```

---

## Data Layer Additions (Migrations)

```sql
CREATE TABLE pairs_regime_fits (
  id SERIAL PRIMARY KEY,
  pair_id VARCHAR(50) NOT NULL,
  fit_timestamp TIMESTAMP NOT NULL,
  lookback_bars INT DEFAULT 300,  -- 300 * 5m = 25h, 1.5D of data
  hmm_params JSONB NOT NULL,      -- {means, covs, transitions, weights, K}
  decoded_path JSONB NOT NULL,    -- [0,0,1,1,2,0,0,...] state sequence
  stationary_dist JSONB NOT NULL, -- {MeanRevert%, Drift%, Stuck%}
  accuracy_metrics JSONB NOT NULL,-- {revert_hit%, drift_hit%, stuck_neutral%}
  observable_config JSONB NOT NULL,-- {type, half_life_window, zscore_threshold}
  version INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(pair_id, fit_timestamp)
);

CREATE TABLE pairs_validation_log (
  id SERIAL PRIMARY KEY,
  pair_id VARCHAR(50) NOT NULL,
  refit_date DATE NOT NULL,
  bar_timestamp TIMESTAMP NOT NULL,
  regime_label VARCHAR(20) NOT NULL,  -- MeanRevert/Drift/Stuck
  spread_zscore DECIMAL(10,4),
  mean_revert_happened BOOLEAN,
  drift_continued BOOLEAN,
  confidence_percentile INT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX(pair_id, refit_date)
);

CREATE INDEX ON pairs_regime_fits(pair_id, fit_timestamp DESC);
```

---

## Key Decisions

| Decision | Why |
|----------|-----|
| 30D lookback (same as market regime) | Consistency; pairs co-adapt with market macro regimes |
| 5m candles, not daily | Pairs spread noise is higher; 5m shows cleaner OU mean-reversion |
| 3 states (MeanRevert/Drift/Stuck) | Simpler than market (Trend/Chop/Panic); easier to interpret spread behavior |
| Daily 4:30 AM refit | Before market open; avoids overnight gap noise in spread |
| Zscore + half-life observables | Zscore = current distance from mean; half-life = speed of reversion |
| 60% accuracy threshold | Pairs correlation can break; flag if regime prediction fails |
| Broadcast on refit | Clients cache new fit; no per-bar recalculation |
| Signal gating (both regimes) | Market says "buy", pairs says "drift"? Don't trade. Both must agree. |

---

## Validation & Feedback

**Post-refit checks:**
- **Reversion hit rate:** If MeanRevert regime, did spread revert 5 bars later?
- **Drift accuracy:** If Drift regime, did spread continue drifting?
- **Pair stability:** Did the pair's β change > 20% week-over-week? (correlation decay)
- **Regime prediction accuracy:** Did yesterday's regime call match today's actual spread behavior?

**Red flags:**
- Hit rate < 55% → pair may be decorrelating; alert admin
- Accuracy < 50% → flip a coin; regime is noise, disable trading
- β volatility > 30% → pair correlation broken; remove from tracker

---

## Integration Checklist

- [ ] Add `pairs_regime_fits` + `pairs_validation_log` tables (migrations/)
- [ ] Build pairs trainer (server-v2/pairs-regime-trainer.js)
- [ ] Wire cron job: daily 4:30 AM ET
- [ ] Add `/api/pairs-regime-fit?pair=ES-SPX` endpoint
- [ ] Add `/api/pairs-regime-retrain` (admin manual trigger)
- [ ] Build `usePairsRegimeFit()` hook
- [ ] Add pairs regime pill + zscore chart to /test page
- [ ] Add validation visualization (did regime call win?)
- [ ] Add WS broadcast "pairs-regime-updated"
- [ ] Update signal gating logic: market_regime × pairs_regime
- [ ] Add admin panel: pairs fit health + accuracy metrics
- [ ] Add β stability tracker (alert if > 20% swing)

---

## Deployment Order

1. **Phase 1 (Data + Trainer):** Migrations, pairs-regime-trainer.js, cron wiring
2. **Phase 2 (Validation):** Backtest pairs regimes against last 60D; log accuracy
3. **Phase 3 (Client):** usePairsRegimeFit hook, UI pills, zscore overlay
4. **Phase 4 (Gating):** Integrate into signal logic; test position sizing
5. **Phase 5 (Live):** Paper trade ES-SPX spread; monitor accuracy 1 week
6. **Phase 6 (Scale):** Add NQ-NDX, SPY-SPX variants
