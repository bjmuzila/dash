# Core Bullseye MES — findings

**Verdict: no tradeable edge in "2 MES lots when SPX is within 5 points of the
Core Bullseye." The touch predicts volatility, not direction.**

## The data that was actually used

| source | sessions | resolution |
|---|---|---|
| `mvc_snapshots` | 62 usable (2026-06-01 -> 2026-09-04) | ~4-5 min captures, 09:30-15:55 |
| `es_candles` 1m | 31 overlapping (2026-07-09 -> 2026-09-04) | 1 min, the fill path |
| `wall_events` | 25 (2026-08-03 -> 2026-09-04) | recorder's own touch classification |

`esPrice` in `mvc_snapshots` was **discarded**: on roughly half the rows it is a
verbatim copy of `spxPrice` (basis 0.00), and on 28 of 69 sessions it swings more
than 15 points intraday, once by 106. Everything runs in SPX points instead,
paid at $5/point.

## 1. What the level does — no strategy assumptions

From `wall_events`, 138 classified touches over 25 sessions:

```
Held  (reject / pin / consolidated)   83/138 = 60.1%
Broke (break_5 / break_lt5)           19/138 = 13.8%
```

Encouraging on its own, and it is why `fade` beats `momentum` and `long`
throughout the sweep. It is not enough.

## 2. Why it is not enough

3,244 touches over 31 sessions, measuring the 60 minutes after each one in the
fade direction:

```
              p25   median    p75    p90
MFE (fav)     2.5      5.8    9.8   17.5
MAE (adv)     2.8      5.8   11.2   18.5
```

**Identical.** Median ratio 1.00. Terminal 60-minute move: median +0.50 pts,
mean -0.10, 52.3% positive. And at every stop size the adverse side is reached at
least as often as the favorable one:

| 1R | target reachable | stop reachable |
|---|---|---|
| 5 pts ($50) | 57.2% | 56.4% |
| 10 pts ($100) | 24.9% | 29.7% |
| 15 pts ($150) | 14.2% | 16.9% |
| 25 pts ($250) | 3.0% | 4.8% |

Price moves plenty after a touch — the sign is a coin flip. See
`generated/2026-09-07-cb-touch-excursion-symmetry.png`.

## 3. The sweep agrees

60 cells (3 directions x 5 exit modes x 4 stop sizes), both builds:

| build | sessions | best cell | best avg R | best t |
|---|---|---|---|---|
| capture (~4 min) | 62 | `long/fixed_3r/$50` | +0.147 | 1.02 |
| 1-minute fills | 31 | `fade/fixed_1r/$150` | +0.058 | 0.58 |

Nothing reaches t = 2. Win rates cluster at 50%, profit factors at 1.0-1.2 —
exactly what a symmetric excursion distribution produces.

## 4. Coarse fills flatter the result — measured

Same 31 sessions, same signals, only fill resolution differs:

```
mean delta (1m minus ~4m)  -0.102 R per trade
median delta               -0.091 R
cells where 1m is worse    43 / 60
best cell  +0.122 R (~4m)  ->  +0.058 R (1m)
```

So the 62-session capture-resolution numbers are inflated by roughly 0.10 R.
Adjusted, the best cell there is ~+0.05 R at t ~ 1.0 — noise. **Any future
backtest on capture-resolution data alone should assume the same haircut.**

## What would be worth testing instead

The level holding 60% of the time is real; what is missing is a reason to be on
one side. Candidates, in order of how cheap they are to test with data already
recorded:

1. **Condition on the approach.** `wall_events` separates `touch` from
   `approach`, and `rolled_over` (came close, never tagged, reversed) is a
   distinct population from a clean tag. 133 approaches are sitting unused.
2. **Condition on which side and on gamma sign.** Above vs below the CB, and
   `totalNetGEX_OI` positive vs negative, split the sample four ways — a pin in
   positive gamma is a different animal from one in negative.
3. **Trade the volatility instead of the direction.** The finding here is that a
   touch reliably precedes movement. That is an options structure, not a
   directional futures trade.
4. **Stop hunting for a bigger stop.** Every stop size fails the same way. The
   problem is not risk sizing.
