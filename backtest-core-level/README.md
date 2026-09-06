# Core Bullseye MES Backtest

**Strategy:** when SPX comes within 5 points of the Core Bullseye (the largest
|net GEX| strike), take 2 MES lots. Dollar stop on the whole trade; 1R / 2R / 3R
with the stop ratcheting up behind them.

## Correction to the first pass

The first version of this concluded there were only 11 sessions of history. That
was wrong — it was reading `option_strike_gex_history`, the raw per-strike tape,
which `scripts/db-prune.sql` holds to a 10-day rolling window.

The CB has been recorded durably the whole time, in `walls-recorder.js`:

| table | what it holds | pruned? |
|---|---|---|
| `walls_log` | CB / call wall / put wall per 15-min slot, with `spot`. Change-only, slot 0 pins the daily baseline. **Immutable once written.** | no |
| `wall_events` | every CB **touch** and **approach**, with a classified `reaction`, `excursion_pts`, `reclaim_min` | no |
| `es_candles` | ES OHLC, `intervalMinutes = 1` | no (explicit do-not-prune) |

And the touch band is already the exact one being tested:

```js
// walls-recorder.js
const CORE_TOUCH_PTS = 5;
// CORE gets a hard 5-POINT floor on index-scale names: spot coming within
// 5 points of the CORE is an event, full stop.
```

So the setup has been instrumented and classified this whole time. `wall_events`
is, on its own, a record of what happens after every touch — no backtest needed
to read it.

## Order of operations

**1. Export from the VPS** — `export-walls-core.sql` writes three CSVs to `/tmp/`:

```bash
psql "$DATABASE_URL" -f export-walls-core.sql
```

**2. Read the level's actual behavior first**, before any strategy assumptions:

```bash
python analyze_touches.py wall_events_core.csv
```

Counts how often a touch rejects, pins, consolidates or breaks, plus the
excursion distribution. Nothing to curve-fit — no entry, stop or target in it.
If the level mostly holds, fade is the variant to expect; if it mostly breaks,
momentum is. This is the honest read, and it comes for free.

**3. Then backtest:**

```bash
python build_from_walls.py --walls walls_core.csv --es es_1m.csv -o snapshots_es.csv
python core_level_backtest.py --selftest
python core_level_backtest.py --data snapshots_es.csv --sweep --out ./results
```

## Why the merge step exists

The CB is an SPX strike; the trade is MES. `build_from_walls.py`:

- carries the change-only `walls_log` level forward within each date (never
  across the overnight gap),
- derives the ES-SPX basis at each 15-min slot from `spot - es_close`, and
  interpolates it **within a date only** — the basis jumps overnight on carry,
  dividends and contract roll, so a bar is never handed yesterday's basis,
- translates the level into ES space and emits one row per **1-minute ES bar**
  with real high/low.

Result: P&L is actual ES points at $5/pt rather than SPX points assumed
equivalent, and stops/targets fill against 1-minute bars instead of 15-minute
endpoints. The 15-minute grid still limits *when a signal can appear*; it no
longer limits how the trade is filled.

## Files

| file | |
|---|---|
| `export-walls-core.sql` | pull `walls_log` / `wall_events` / `es_candles` off the VPS |
| `analyze_touches.py` | what the level actually did, straight from `wall_events` |
| `build_from_walls.py` | walls + ES 1m -> `snapshots_es.csv` (ES space) |
| `core_level_backtest.py` | the backtester. `--selftest` validates the engine |
| `build_core_snapshots.py` | the old path: per-strike CSV -> snapshots. Kept for the July export |
| `export-core-level.sql` | the old 10-day export. Superseded by `export-walls-core.sql` |

## Variants

Since 2026-08-27 every slot is recorded four times: `expiry_scope` (`0dte` /
`agg`) x `basis` (`oivol` / `vol`). Rows before that are labelled `0dte`/`oivol`,
so **that pair is the only one continuous across the full history** — it is what
the export defaults to. Test the others separately once you have enough of them;
do not mix them in one sample.

## Reading the sweep honestly

`--sweep` runs 60 cells. The best of 60 will look good on noise. `--selftest`
demonstrates the engine finds a genuine +0.138 R edge (t=2.85) when one is
injected and reports nothing on a random walk, so the machinery is trustworthy —
but a single winning cell still is not. Rules of thumb:

- under ~60 sessions, treat everything as a hypothesis
- a t-stat under 2 is not distinguishable from luck
- prefer a result that holds across neighbouring cells (adjacent stop sizes, both
  fade and momentum) over one that spikes in a single cell
- re-check the survivor on sessions the sweep never saw

## Engine rules

Entries fire on **crossing into** the band, not on every bar inside it. One
position at a time, max 3/day, 15-min cooldown, RTH only, flat at 15:55. Costs:
$1.24 RT/contract + 1 tick slippage per side. When a bar's range contains both
the stop and the target, **the stop wins**.

Stop distance = `risk_$ / (contracts x $5)`. At 2 MES lots, **$100 risk = 10
points**, $250 = 25 points. Worth noting the band is 5 points wide, so a $100
stop risks two band-widths to make one — which is why the ratchet variants stop
out most of the time.

## Known limits

- **Signal timing is on a 15-minute grid.** `walls_log` samples at 09:29 then
  every 15 min, and each slot is only as fresh as the last scanner sweep (<=5m).
  A touch that happens and reverses inside one slot is invisible.
- **`walls_log` is change-only.** Slot 0 is the baseline; a missing slot means
  "unchanged", not "no data". `build_from_walls.py` carries forward accordingly.
- **Point-in-time integrity holds** — these were recorded live off
  `scanner_snapshots`, not recomputed after the fact.
