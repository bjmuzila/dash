#!/usr/bin/env python3
"""
Summarize wall_events CORE touches — the system's own record of what happened
each time SPX came within 5 points of the Core Bullseye.

This is not a backtest. It has no entry, stop or target in it, so it cannot be
curve-fit: it just counts how the level actually behaved. Read it before
trusting any strategy result.

  python analyze_touches.py wall_events_core.csv
"""
import argparse, collections, csv, statistics, sys

# Reactions the recorder assigns (walls-recorder.js).
TOUCH = ["reject", "break_lt5", "break_5", "consolidated", "pin", "new_wall"]
APPROACH = ["reached", "rolled_over", "stalled"]


def bar(n, total, width=28):
    return "#" * int(round(width * n / total)) if total else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    a = ap.parse_args()

    rows = list(csv.DictReader(open(a.src, newline="", encoding="utf-8-sig")))
    if not rows:
        sys.exit("no rows")

    touches = [r for r in rows if (r.get("kind") or "touch") == "touch"]
    approaches = [r for r in rows if r.get("kind") == "approach"]
    days = sorted({r["date"] for r in rows if r.get("date")})

    print(f"{len(rows):,} CORE events over {len(days)} sessions "
          f"({days[0]} -> {days[-1]})" if days else f"{len(rows):,} events")
    print(f"  {len(touches):,} touches (within 5 pts), "
          f"{len(approaches):,} approaches that never tagged")
    if days:
        print(f"  {len(touches)/len(days):.1f} touches per session")

    for label, group, order in (("TOUCHES", touches, TOUCH),
                                ("APPROACHES", approaches, APPROACH)):
        if not group:
            continue
        c = collections.Counter((r.get("reaction") or "unresolved") for r in group)
        print(f"\n{label}  (n={len(group):,})")
        for k in order + [x for x in c if x not in order]:
            if k not in c:
                continue
            print(f"  {k:<14} {c[k]:>5}  {100*c[k]/len(group):>5.1f}%  {bar(c[k], len(group))}")

    exc = []
    for r in touches:
        try:
            exc.append(abs(float(r["excursion_pts"])))
        except (TypeError, ValueError, KeyError):
            pass
    if exc:
        exc.sort()
        print(f"\nExcursion after a touch (pts, n={len(exc):,})")
        for q, name in ((0.25, "p25"), (0.5, "median"), (0.75, "p75"), (0.9, "p90")):
            print(f"  {name:<7} {exc[min(len(exc)-1, int(q*len(exc)))]:.2f}")

    rec = []
    for r in touches:
        try:
            rec.append(float(r["reclaim_min"]))
        except (TypeError, ValueError, KeyError):
            pass
    if rec:
        print(f"\nMedian reclaim time: {statistics.median(rec):.0f} min (n={len(rec):,})")

    # The read that matters for the strategy: does the level repel or get run?
    n = len(touches)
    if n:
        held = sum(1 for r in touches
                   if r.get("reaction") in ("reject", "pin", "consolidated"))
        broke = sum(1 for r in touches
                    if r.get("reaction") in ("break_5", "break_lt5"))
        print(f"\nHeld (reject/pin/consolidated): {held}/{n} = {100*held/n:.1f}%")
        print(f"Broke (break_5/break_lt5):      {broke}/{n} = {100*broke/n:.1f}%")
        print("\nA level that mostly HOLDS favours the fade variant; one that mostly")
        print("BREAKS favours momentum. Neither is an edge on its own — the payoff")
        print("still has to clear the stop, which is what the backtest measures.")


if __name__ == "__main__":
    main()
