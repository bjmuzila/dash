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

## Where the history actually is

Confirmed on the VPS, 2026-09-06:

| source | sessions | range | resolution |
|---|---|---|---|
| **`mvc_snapshots`** | **73** | 2026-05-26 -> 2026-09-04 | ~80-96 captures/session, 09:30-15:55 (~4-5 min) |
| `walls_log` / `wall_events` | 25 | 2026-08-03 -> 2026-09-04 | 15-min slots, with classified touch reactions |
| `option_strike_gex_history` | 11 | rolling | 1 min, per-strike — pruned to 10 days |

`mvc_snapshots` is the primary source and it carries `spxPrice` **and** `esPrice`
on the same row, so the ES-SPX basis is measured rather than modelled.
5,159 of 5,232 rows have ES; 5,175 have a usable core.

`walls_log` is the cross-check: shorter, but `wall_events` classifies every
5-point touch as reject / pin / consolidated / break_5 / break_lt5 with no
strategy assumptions in it.

Base rate worth knowing before anything else: the grader reports **62 of 73
sessions touched the CB**. The signal fires ~85% of days, so this was never a
selectivity edge — whatever is there has to come from what price does *after*
the touch.

## Order of operations

**1. Export from the VPS** — `export-mvc-core.sql` writes to `/root/cb-export/`:

```bash
psql "$DATABASE_URL" -f export-mvc-core.sql
```

**2. Read the level's actual behavior first**, before any strategy assumptions:

```bash
python analyze_touches.py wall_events_core.csv
```

Counts how often a touch rejects, pins, consolidates or breaks, plus the
excursion distribution. Nothing to curve-fit. If the level mostly holds, expect
fade to be the variant; if it mostly breaks, momentum.

**3. Merge and backtest:**

```bash
python build_from_mvc.py --mvc mvc_snapshots.csv --es es_1m.csv -o snapshots_es.csv
python core_level_backtest.py --selftest
python core_level_backtest.py --data snapshots_es.csv --sweep --out ./results
```

`--core-col core_vol` runs the volume-only CB instead of the OI+volume default.
Run them as separate samples; do not mix.

## Why the merge step exists

The CB is an SPX strike; the trade is MES. `build_from_mvc.py`:

- carries the CB forward from each capture, never across the overnight gap,
- takes the basis as `spx - es` from each capture directly, interpolating
  between captures **within a date only** — it jumps overnight on carry,
  dividends and contract roll,
- translates the level into ES space and emits one row per **1-minute ES bar**
  with real high/low.

P&L is then actual ES points at $5/pt, and stops fill against 1-minute bars
instead of 4-minute capture endpoints. The ~4-5 minute capture cadence still
bounds *when a signal can appear*; it no longer bounds how the trade is filled.
Verified round-trip: |ES - core_es| matches |SPX - core_spx| at every capture.

## Files

| file | |
|---|---|
| `export-mvc-core.sql` | pull `mvc_snapshots` + `walls_log` / `wall_events` / `es_candles` off the VPS |
| `build_from_mvc.py` | MVC captures + ES 1m -> `snapshots_es.csv` (ES space). **The main path** |
| `export-walls-core.sql` | walls-only export, superseded by `export-mvc-core.sql` |
| `analyze_touches.py` | what the level actually did, straight from `wall_events` |
| `build_from_walls.py` | walls + ES 1m -> snapshots. The 25-session cross-check path |
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

- **Signal timing is bounded by the capture cadence.** `mvc_snapshots` runs
  ~4-5 min; `walls_log` 15 min. A touch that happens and reverses inside one
  interval is invisible to the signal, even though the fill path is 1-minute.
- **`walls_log` is change-only.** Slot 0 is the baseline; a missing slot means
  "unchanged", not "no data". `build_from_walls.py` carries forward accordingly.
- **73 sessions is a starting sample, not a verdict.** A t-stat under 2 across
  73 sessions is still luck. Prefer results that hold across neighbouring cells.
- **Point-in-time integrity holds** — these were recorded live off
  `scanner_snapshots`, not recomputed after the fact.
