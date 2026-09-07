#!/usr/bin/env python3
"""
Build the snapshot file core_level_backtest.py reads, from mvc_snapshots.

  mvc_snapshots.csv  timestamp,date,time,core_oivol,core_vol,spx,es,...
  es_1m.csv          timestamp,date,open,high,low,close        (optional)
      ->
  snapshots.csv      ts,spx,core[,high,low]

EVERYTHING IS IN SPX POINTS, on purpose.

The strategy is defined as "SPX within 5 points of the core level", and
`spx` and the core strike come off the SAME capture row, so comparing them
involves no assumption at all. P&L is then paid at $5/point, which is exact for
MES to the extent an SPX point equals an ES point — true intraday to well under
a tick, and the position is flat by the close either way.

The `esPrice` column in mvc_snapshots is NOT used. It is unreliable: on roughly
half the rows it is a verbatim copy of `spxPrice` (basis 0.00), and on 28 of 69
sessions it swings by more than 15 points intraday, once by 106. Deriving the
basis properly (mvc `spx` vs the ES bar close at the same minute) gives sensible
session medians -- -47.9 in July decaying to -6.2 by September, which is the
futures basis behaving normally -- but still a 5.8-point p5-p95 spread WITHIN a
session, which is capture-synchronisation noise, not real basis movement. On a
5-point trigger band that noise would swamp the signal, so no per-row basis is
applied anywhere.

Two builds:

  no --es   one row per capture (~4-5 min), prices and level both straight from
            the row. 62 sessions. Clean signal, coarse fills — the engine sees
            only capture endpoints and resolves an ambiguous move to the stop.

  --es      ES 1-minute bars mapped into SPX space with a PER-SESSION MEDIAN
            basis (a constant per day, robust to the stale rows above), giving
            real high/low for fills. 31 sessions — es_candles only reaches back
            to 2026-07-09.

Run both. If they disagree, the fill model is doing the work, not the strategy.

  python build_from_mvc.py --mvc mvc_snapshots.csv -o snap_capture.csv
  python build_from_mvc.py --mvc mvc_snapshots.csv --es es_1m.csv -o snap_1m.csv
"""
import argparse, bisect, csv, datetime, statistics, sys
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
MATCH_TOLERANCE_S = 90


def parse_ts(v):
    s = str(v).strip()
    if not s:
        return None
    if s.lstrip("-").isdigit() and len(s) >= 10:
        x = int(s)
        return datetime.datetime.fromtimestamp(x / 1000 if x > 1e12 else x, ET)
    try:
        d = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d.astimezone(ET) if d.tzinfo else d.replace(tzinfo=ET)


def fnum(r, k):
    try:
        v = float(r[k])
        return v if v > 0 else None
    except (TypeError, ValueError, KeyError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mvc", required=True)
    ap.add_argument("--es", help="es_candles 1m export. Omit for capture-resolution.")
    ap.add_argument("-o", "--out", default="snapshots.csv")
    ap.add_argument("--core-col", default="core_oivol",
                    help="core_oivol (OI+volume, default) or core_vol (volume only)")
    ap.add_argument("--all-hours", dest="rth_only", action="store_false", default=True)
    a = ap.parse_args()

    caps, no_core = [], 0
    with open(a.mvc, newline="", encoding="utf-8-sig") as f:
        rd = csv.DictReader(f)
        if a.core_col not in (rd.fieldnames or []):
            sys.exit(f"--core-col {a.core_col!r} not in {rd.fieldnames}")
        for r in rd:
            dt = parse_ts(r.get("timestamp"))
            core, spx = fnum(r, a.core_col), fnum(r, "spx")
            if dt is None or spx is None:
                continue
            if core is None:
                no_core += 1
                continue
            caps.append((dt, spx, core))
    caps.sort(key=lambda x: x[0])
    if not caps:
        sys.exit(f"no usable captures in {a.mvc}")

    by_date = {}
    for dt, spx, core in caps:
        by_date.setdefault(dt.date(), []).append((dt, spx, core))

    def core_at(dt):
        day = by_date.get(dt.date())
        if not day:
            return None
        ts_ = [t for t, _, _ in day]
        i = bisect.bisect_right(ts_, dt) - 1
        return day[i][2] if i >= 0 else None

    def in_rth(dt):
        return datetime.time(9, 30) <= dt.time() <= datetime.time(16, 0)

    out = []
    note = ""

    if not a.es:
        for dt, spx, core in caps:
            if a.rth_only and not in_rth(dt):
                continue
            out.append((dt, spx, core, None, None))
        note = "capture resolution, no intra-capture high/low"
    else:
        bars = []
        with open(a.es, newline="", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                dt = parse_ts(r.get("timestamp"))
                try:
                    o, h, l, c = (float(r["open"]), float(r["high"]),
                                  float(r["low"]), float(r["close"]))
                except (TypeError, ValueError, KeyError):
                    continue
                if dt is None or h < l:
                    continue
                bars.append((dt, h, l, c))
        bars.sort(key=lambda x: x[0])
        if not bars:
            sys.exit(f"no usable bars in {a.es}")
        bt = [b[0] for b in bars]

        # Per-session median basis (spx - es), robust to the stale-row problem.
        samples = {}
        for dt, spx, _core in caps:
            i = bisect.bisect_left(bt, dt)
            best, bg = None, None
            for j in (i - 1, i):
                if 0 <= j < len(bars):
                    g = abs((bt[j] - dt).total_seconds())
                    if bg is None or g < bg:
                        best, bg = j, g
            if best is not None and bg <= MATCH_TOLERANCE_S:
                samples.setdefault(dt.date(), []).append(spx - bars[best][3])
        basis = {d: statistics.median(v) for d, v in samples.items() if len(v) >= 5}
        if not basis:
            sys.exit("could not derive a session basis — do the two exports overlap?")

        for dt, h, l, c in bars:
            if a.rth_only and not in_rth(dt):
                continue
            b = basis.get(dt.date())
            core = core_at(dt)
            if b is None or core is None:
                continue
            out.append((dt, c + b, core, h + b, l + b))
        note = "1-minute fills, ES mapped to SPX by per-session median basis"

    if not out:
        sys.exit("nothing to write — check the exports overlap in time")

    with open(a.out, "w", newline="") as f:
        w = csv.writer(f)
        has_hl = out[0][3] is not None
        w.writerow(["ts", "spx", "core"] + (["high", "low"] if has_hl else []))
        for dt, spx, core, h, l in out:
            row = [dt.strftime("%Y-%m-%d %H:%M:%S"), round(spx, 2), round(core, 2)]
            if has_hl:
                row += [round(h, 2), round(l, 2)]
            w.writerow(row)

    days = sorted({dt.strftime("%Y-%m-%d") for dt, *_ in out})
    dist = [abs(s - k) for _, s, k, _, _ in out]
    within = sum(1 for d in dist if d <= 5)
    print(f"captures         : {len(caps):,} over {len(by_date)} sessions"
          + (f"   [{no_core} with no core]" if no_core else ""))
    print(f"output           : {len(out):,} rows over {len(days)} sessions "
          f"({days[0]} -> {days[-1]})  [{note}]")
    print(f"median |SPX-core|: {statistics.median(dist):.1f} pts")
    print(f"within 5 pts     : {within:,}/{len(out):,} = {100*within/len(out):.1f}% of rows")
    print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
