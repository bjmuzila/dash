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

---

# Addendum — the first-touch-of-a-NEW-core rule (2026-09-07)

Brandon's actual rule is narrower than what was tested above: a signal only when
price reaches a **newly migrated** core for the first time — the red dots on the
Wall Migration chart — not every re-entry into the 5-point band.

Implemented as `--trigger new_core` (first tag after the core moves to a
different strike) and `--trigger new_core_approach` (same, but only when price
was OUTSIDE the band at the moment of migration, so price had to travel to the
level). Verified against the chart: 2026-09-04 produces 5 first-touch events,
matching the dots.

## Most red dots are the level moving to price, not price moving to the level

| | per session |
|---|---|
| core migrations | 12.2 |
| first touches of a new core | 6.6 |
| ...where price actually travelled to it | **2.6** |

On 2026-09-04, 1 of the 5 dots. This distinction matters: a core migrating onto
price is the gamma peak being redrawn where price already is, not a level being
defended.

## The direction convention was wrong

`fade` in the original engine trades TOWARD the level (magnet). The data says the
opposite: price tagging the core from below is **rejected downward**. A fourth
direction was added — `reject`, trade AWAY from the level — and it sweeps the top
of the strict trigger.

## And the two sides are not symmetric

`--trigger new_core_approach`, split by which side price approached from:

**Core ABOVE price — price rallies into it — SHORT the rejection**

| build | best cell | n | win | avg R | PF | t |
|---|---|---|---|---|---|---|
| 31 sessions, 1-min fills | `reject/fixed_3r/$50` | 55 | 40.0% | **+0.257** | 1.38 | 1.07 |
| 62 sessions, capture res | `reject/fixed_3r/$50` | 65 | 36.9% | +0.206 | 1.30 | 0.95 |

**Core BELOW price — price falls into it — the setup as described**

| build | best cell | n | win | avg R | PF | t |
|---|---|---|---|---|---|---|
| 31 sessions, 1-min fills | `fade/fixed_2r/$100` | 20 | 50.0% | +0.123 | 1.26 | 0.45 |
| 62 sessions, capture res | `fade/fixed_3r/$250` | 30 | 43.3% | +0.082 | 1.29 | 0.51 |

`reject` — the long bounce off support, which is the trade as described — does
not reach the top four on either build. The edge, such as it is, lives on the
short side.

## Why this one is worth another look

Three things separate it from everything else tested:

1. **The direction is the same on both builds.** `reject` wins on 1-minute and
   capture resolution alike.
2. **1-minute fills IMPROVE it** (+0.257 vs +0.206). In every other
   configuration finer fills cost about 0.10 R — this is the only case that
   moves the other way, so it is not a coarse-fill artifact.
3. **The mechanism is coherent.** The largest gamma strike sitting above price
   is resistance. Selling a rally into freshly-migrated resistance is a normal
   thing for a market to do.

## Why it is still not a green light

`reject/fixed_3r/$50`, 55 trades over 23 sessions, net $706 ($12.84/trade):

```
profitable sessions        13 / 23
drop the best 1 session    $12.84 -> $9.20 /trade
drop the best 3 sessions   $12.84 -> $2.04 /trade
leave-one-day-out          $9.20 to $19.36 /trade
session bootstrap 95% CI   [-$8.86, +$37.62]   P(>0) = 0.87
```

Three sessions of 23 carry most of the result and the confidence interval
straddles zero. t = 1.07. This is a lead, not a finding.

## What would settle it

The sample is the binding constraint — 55 trades. `mvc_snapshots` keeps growing
and `es_candles` 1m only starts 2026-07-09, so the overlap widens by one session
a day. Re-run the same cell in a couple of months; if `reject` on the
core-above-price side is still near +0.25 R with n over 150, that is a real
result. In the meantime the honest read is that the original 5-point-band rule
has no edge, and the narrower one has a plausible short-side lead that has not
cleared significance.

Commands:

```bash
python core_level_backtest.py --data snap_1m.csv --sweep \
  --trigger new_core_approach --side from_below --cooldown-min 0 --max-trades-per-day 12
```
