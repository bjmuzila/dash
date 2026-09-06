#!/usr/bin/env python3
"""
Merge the durable Core Bullseye history with the ES 1-minute path into the
snapshot file core_level_backtest.py reads.

  walls_core.csv   date,ts,slot,core,spot,gex_value,reason   (change-only, 15m grid)
  es_1m.csv        timestamp,date,open,high,low,close        (epoch ms, ES 1m)
      ->
  snapshots_es.csv ts,spx,core,high,low                      (everything in ES points)

Why ES space: the CB is an SPX strike but the trade is MES. Translating the
level into ES with the live basis means P&L is real ES points at $5/pt instead
of SPX points assumed to be equivalent, and the 1-minute bars give honest
stop/target fills instead of 15-minute endpoints.

  python build_from_walls.py --walls walls_core.csv --es es_1m.csv -o snapshots_es.csv
"""
import argparse, bisect, csv, datetime, statistics, sys
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
MATCH_TOLERANCE_S = 90     # how close an ES bar must be to a walls slot to set basis


def parse_ts(v):
    s = str(v).strip()
    if not s:
        return None
    if s.isdigit():
        x = int(s)
        return datetime.datetime.fromtimestamp(x / 1000 if x > 1e12 else x, ET)
    try:
        d = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d.astimezone(ET) if d.tzinfo else d.replace(tzinfo=ET)


def load_walls(path):
    """(datetime, core_spx, spot_spx) per slot, change-only carried forward per date."""
    rows = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            dt = parse_ts(r.get("ts"))
            try:
                core = float(r["core"]); spot = float(r["spot"])
            except (TypeError, ValueError, KeyError):
                continue
            if dt is None:
                continue
            rows.append((dt, core, spot, r.get("date") or dt.strftime("%Y-%m-%d")))
    rows.sort(key=lambda x: x[0])
    if not rows:
        sys.exit(f"no usable rows in {path}")
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--walls", required=True)
    ap.add_argument("--es", required=True)
    ap.add_argument("-o", "--out", default="snapshots_es.csv")
    ap.add_argument("--rth-only", action="store_true", default=True)
    ap.add_argument("--all-hours", dest="rth_only", action="store_false")
    a = ap.parse_args()

    walls = load_walls(a.walls)

    bars = []
    with open(a.es, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            dt = parse_ts(r.get("timestamp") or r.get("ts"))
            try:
                o, h, l, c = (float(r["open"]), float(r["high"]),
                              float(r["low"]), float(r["close"]))
            except (TypeError, ValueError, KeyError):
                continue
            if dt is None or not h >= l:
                continue
            bars.append((dt, o, h, l, c))
    bars.sort(key=lambda x: x[0])
    if not bars:
        sys.exit(f"no usable bars in {a.es}")
    bar_ts = [b[0] for b in bars]

    # ── basis anchors: SPX spot minus the ES close at the same minute ────────
    anchors = []
    unmatched = 0
    for dt, core, spot, _d in walls:
        i = bisect.bisect_left(bar_ts, dt)
        best, bestgap = None, None
        for j in (i - 1, i):
            if 0 <= j < len(bars):
                gap = abs((bar_ts[j] - dt).total_seconds())
                if bestgap is None or gap < bestgap:
                    best, bestgap = j, gap
        if best is None or bestgap > MATCH_TOLERANCE_S:
            unmatched += 1
            continue
        anchors.append((dt, spot - bars[best][4]))
    if not anchors:
        sys.exit("no walls slot could be matched to an ES bar — check the two "
                 "exports cover the same dates and timezone")
    # Anchors are grouped BY DATE: the ES-SPX basis jumps overnight (carry,
    # dividends, contract roll), so a bar is never given yesterday's basis.
    by_date = {}
    for t, b in anchors:
        by_date.setdefault(t.date(), []).append((t, b))

    def basis_at(dt):
        day = by_date.get(dt.date())
        if not day:
            return None
        ts_ = [t for t, _ in day]
        i = bisect.bisect_left(ts_, dt)
        if i == 0:
            return day[0][1]
        if i >= len(day):
            return day[-1][1]
        (t0, b0), (t1, b1) = day[i - 1], day[i]
        span = (t1 - t0).total_seconds()
        if span <= 0:
            return b0
        w = (dt - t0).total_seconds() / span
        return b0 + w * (b1 - b0)

    # ── carry the CB level forward, per date ────────────────────────────────
    wall_ts = [w[0] for w in walls]

    def core_at(dt):
        i = bisect.bisect_right(wall_ts, dt) - 1
        if i < 0:
            return None
        w = walls[i]
        if w[0].date() != dt.date():          # never carry a level overnight
            return None
        return w[1]

    out = []
    for dt, _o, h, l, c in bars:
        if a.rth_only and not (datetime.time(9, 30) <= dt.time() <= datetime.time(16, 0)):
            continue
        core_spx = core_at(dt)
        if core_spx is None:
            continue
        b = basis_at(dt)
        if b is None:
            continue
        out.append((dt, c, core_spx - b, h, l))

    if not out:
        sys.exit("no bars overlapped the CB history")

    with open(a.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ts", "spx", "core", "high", "low"])
        for dt, c, core_es, h, l in out:
            w.writerow([dt.strftime("%Y-%m-%d %H:%M:%S"), round(c, 2),
                        round(core_es, 2), round(h, 2), round(l, 2)])

    days = sorted({dt.strftime("%Y-%m-%d") for dt, *_ in out})
    dist = [abs(c - k) for _, c, k, _, _ in out]
    within = sum(1 for d in dist if d <= 5)
    bas = [b for _, b in anchors]
    print(f"walls slots        : {len(walls):,}" + (f"  ({unmatched} with no ES bar)" if unmatched else ""))
    print(f"ES 1m bars         : {len(bars):,}")
    print(f"merged snapshots   : {len(out):,} over {len(days)} sessions "
          f"({days[0]} -> {days[-1]})")
    print(f"ES-SPX basis       : median {statistics.median(bas):+.1f}  "
          f"min {min(bas):+.1f}  max {max(bas):+.1f}")
    print(f"median |ES - core| : {statistics.median(dist):.1f} pts")
    print(f"within 5 pts       : {within:,}/{len(out):,} = {100*within/len(out):.1f}%")
    print(f"wrote {a.out}")
    if len(days) < 60:
        print(f"\nNOTE: {len(days)} sessions. Under ~60 the sweep is still mostly noise.")


if __name__ == "__main__":
    main()
