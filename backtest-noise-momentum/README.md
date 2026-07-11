# Noise-Area Momentum Breakout + GEX Regime Overlay — backtest

`node backtest.mjs` — reads the ESU6 5-min RTH CSV, prints results to stdout and
writes `results.txt`, `results.json`, `equity_curve.csv`, `trades.csv`.

## GEX regime overlay

Drop a `gex.csv` next to `backtest.mjs` to activate the regime section.
Rule (per prior-day EOD, no lookahead):

- **netGex > deadband  → FADE** (long gamma: pinning / mean-revert toward flip, sell walls)
- **netGex < -deadband → FOLLOW** (short gamma: trend / breakout)
- **|netGex| ≤ deadband → skip the day**

Optional `useWalls` gate (fade only): long only near/below the put wall, short
only near/above the call wall. Fade trades take profit at the gamma flip.

### gex.csv schema (header required)

```
day,netGex,flip,callWall,putWall
20231103,-1.2e9,4360,4400,4320
20231106,3.4e9,4375,4390,4360
```

- `day` = `YYYYMMDD` (dashes ok). Must line up with the bar dates.
- `netGex` = signed net dealer gamma. **Only its sign vs `gexDeadband` matters**, so any
  consistent unit works ($/pt, contracts, normalized).
- `flip`, `callWall`, `putWall` = price levels. If they're **SPX**, set `CFG.gexBasis`
  (ES = SPX + basis) or add a per-day `basis` column. If already **ES**, leave basis 0.
- Levels are optional — sign-only still runs the fade/follow switch (wall gate + flip TP just disable).

### Getting the data out of CB Edge

Prior-day EOD net GEX + flip + walls is what you already persist. Export daily rows from
`gex_levels_history` (or `eod_gex`) via `/proxy/gex-levels-history`, one row per session,
save as `gex.csv` here. Use the **prior day's** values — the engine already shifts by one day.

## Key CONFIG knobs (top of backtest.mjs)

- `useRegime` — auto-set true inside the regime grid; leave false for the base runs.
- `gexDeadband` — dead zone around flip where you stand aside.
- `useWalls`, `wallTolPts` — wall-proximity gate for fades.
- `fadeTargetFlip` — take profit at the flip on fades.
- `gexBasis` — ES–SPX basis if levels are SPX.
- costs, vol target, leverage cap — as before.
