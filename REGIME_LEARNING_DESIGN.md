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
