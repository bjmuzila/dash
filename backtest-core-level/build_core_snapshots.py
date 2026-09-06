#!/usr/bin/env python3
"""
Build core-level snapshots for the backtester.

Input : per-strike GEX history  (date,timestamp,spot,strike,net_gex)
        - the gex_strike_history.csv export, or
        - a fresh export of option_strike_gex_history (see export-core-level.sql)
Output: snapshots_core.csv  (ts,spx,core)  where core = the strike with the
        largest |net_gex| in that snapshot.

  python build_core_snapshots.py gex_strike_history.csv -o snapshots_core.csv
"""
import argparse, collections, csv, datetime, statistics, sys
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("-o", "--out", default="snapshots_core.csv")
    ap.add_argument("--rth-only", action="store_true",
                    help="keep only 09:30-16:00 ET snapshots")
    a = ap.parse_args()

    best = {}   # ts -> [spot, strike, abs_gex]
    n = 0
    with open(a.src, newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        need = {"timestamp", "spot", "strike", "net_gex"}
        if not need.issubset({c.lower() for c in r.fieldnames}):
            sys.exit(f"expected columns {sorted(need)}, got {r.fieldnames}")
        for row in r:
            n += 1
            try:
                t = int(row["timestamp"])
                g = abs(float(row["net_gex"]))
                k = float(row["strike"])
                s = float(row["spot"])
            except (TypeError, ValueError):
                continue
            cur = best.get(t)
            if cur is None or g > cur[2]:
                best[t] = [s, k, g]

    rows = []
    for t in sorted(best):
        s, k, _ = best[t]
        dt = datetime.datetime.fromtimestamp(t / 1000, ET)
        if a.rth_only and not (datetime.time(9, 30) <= dt.time() <= datetime.time(16, 0)):
            continue
        rows.append((dt, s, k))

    if not rows:
        sys.exit("no snapshots produced")

    with open(a.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ts", "spx", "core"])
        for dt, s, k in rows:
            w.writerow([dt.strftime("%Y-%m-%d %H:%M:%S"), round(s, 2), k])

    days = sorted({dt.strftime("%Y-%m-%d") for dt, _, _ in rows})
    dist = [abs(s - k) for _, s, k in rows]
    within = sum(1 for d in dist if d <= 5)
    gaps = sorted((rows[i + 1][0] - rows[i][0]).total_seconds()
                  for i in range(len(rows) - 1))
    gaps = [g for g in gaps if 0 < g < 3600]
    print(f"{n:,} strike rows -> {len(rows):,} snapshots over {len(days)} sessions "
          f"({days[0]} -> {days[-1]})")
    print(f"median snapshot spacing: {gaps[len(gaps)//2]:.0f}s" if gaps else "")
    print(f"median |spot - core|: {statistics.median(dist):.1f} pts")
    print(f"within 5 pts: {within:,}/{len(rows):,} = {100*within/len(rows):.1f}% of snapshots")
    print(f"wrote {a.out}")
    if len(days) < 60:
        print(f"\nWARNING: {len(days)} sessions is not enough to backtest. "
              f"You want 100+ before any result means anything.")


if __name__ == "__main__":
    main()
