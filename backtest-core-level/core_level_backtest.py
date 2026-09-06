#!/usr/bin/env python3
"""
Core-Level MES Backtester
=========================

Strategy under test
-------------------
  ENTRY : when SPX spot comes within BAND points of the "core level"
          (the strike with the largest |GEX|), take CONTRACTS MES lots.
  STOP  : a fixed DOLLAR amount on the whole position (converted to points).
  EXITS : 1R / 2R / 3R with the stop ratcheting up behind them.

Direction is ambiguous in the raw idea, so three variants are tested:
  fade      - price above the level -> short, below -> long (magnet / pin)
  momentum  - trade the direction price is approaching from (break-through)
  long      - always buy, regardless of side

Data input
----------
Point this at your recorded live snapshots. Accepted:
  *.csv / *.tsv        one row per snapshot
  *.json / *.ndjson    list of objects, or one object per line
  *.db / *.sqlite      auto-finds the table holding the columns

Required per snapshot: a timestamp, SPX spot, and the core level.
Column names are sniffed (see SNIFF_* below); override with --col-* flags.
Optional high/low columns make the fill model far more accurate.

Run
---
  python core_level_backtest.py --selftest
  python core_level_backtest.py --data snapshots.csv --out ./results
  python core_level_backtest.py --data snaps.db --sweep --out ./results
"""

import argparse
import csv
import json
import math
import os
import random
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, time as dtime

# ----------------------------------------------------------------------------
# Contract spec
# ----------------------------------------------------------------------------
MES_DOLLARS_PER_POINT = 5.0
MES_TICK = 0.25

SNIFF_TS = ["ts", "time", "timestamp", "datetime", "created_at", "snapshot_time",
            "snapshot_ts", "captured_at", "t", "date_time", "asof"]
SNIFF_SPX = ["spx", "spx_spot", "spot", "spx_price", "underlying", "underlying_price",
             "px", "price", "last", "spxLast", "spx_last", "close"]
SNIFF_CORE = ["core", "core_level", "corelevel", "core_strike", "max_gex_strike",
              "peak_gex_strike", "max_gex", "gex_peak", "level", "key_level",
              "largest_gex_strike", "coreLevel"]
SNIFF_HIGH = ["high", "spx_high", "h", "hi"]
SNIFF_LOW = ["low", "spx_low", "l", "lo"]

RTH_OPEN = dtime(9, 30)
RTH_CLOSE = dtime(16, 0)


# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
@dataclass
class Config:
    band: float = 5.0                 # "within 5 points"
    contracts: int = 2                # 2 MES lots
    dpp: float = MES_DOLLARS_PER_POINT
    risk_dollars: float = 100.0       # stop = $ amount on the WHOLE trade
    direction: str = "fade"           # fade | momentum | long
    exit_mode: str = "ratchet"        # fixed_1r | fixed_2r | fixed_3r | scale_be | ratchet
    rth_only: bool = True
    flat_at: dtime = dtime(15, 55)
    max_trades_per_day: int = 3
    cooldown_min: int = 15
    momentum_lookback: int = 3
    commission_rt_per_contract: float = 1.24
    slippage_ticks_per_side: float = 1.0

    @property
    def stop_points(self) -> float:
        """Dollar stop on the full position -> points of SPX/ES movement."""
        return self.risk_dollars / (self.contracts * self.dpp)

    def cost_per_contract_rt(self) -> float:
        slip = self.slippage_ticks_per_side * 2 * MES_TICK * self.dpp
        return self.commission_rt_per_contract + slip

    def tag(self) -> str:
        return f"{self.direction}/{self.exit_mode}/${self.risk_dollars:.0f}"


# ----------------------------------------------------------------------------
# Data loading
# ----------------------------------------------------------------------------
def _pick(cols, candidates, override=None):
    if override:
        for c in cols:
            if c.lower() == override.lower():
                return c
        raise SystemExit(f"column '{override}' not found. available: {cols}")
    low = {c.lower(): c for c in cols}
    for cand in candidates:
        if cand.lower() in low:
            return low[cand.lower()]
    # fuzzy: substring
    for cand in candidates:
        for c in cols:
            if cand.lower() in c.lower():
                return c
    return None


def _parse_ts(v):
    if isinstance(v, datetime):
        return v
    if isinstance(v, (int, float)):
        # epoch seconds or millis
        x = float(v)
        if x > 1e12:
            x /= 1000.0
        return datetime.fromtimestamp(x)
    s = str(v).strip()
    if not s:
        return None
    if s.isdigit():
        return _parse_ts(int(s))
    s = s.replace("Z", "+00:00")
    for fmt in (None, "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S",
                "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%Y-%m-%d"):
        try:
            if fmt is None:
                d = datetime.fromisoformat(s)
            else:
                d = datetime.strptime(s, fmt)
            return d.replace(tzinfo=None)
        except Exception:
            continue
    return None


def _rows_to_snaps(rows, args):
    if not rows:
        raise SystemExit("no rows found in data file")
    cols = list(rows[0].keys())
    c_ts = _pick(cols, SNIFF_TS, args.col_ts)
    c_spx = _pick(cols, SNIFF_SPX, args.col_spx)
    c_core = _pick(cols, SNIFF_CORE, args.col_core)
    c_hi = _pick(cols, SNIFF_HIGH, args.col_high)
    c_lo = _pick(cols, SNIFF_LOW, args.col_low)
    missing = [n for n, c in (("timestamp", c_ts), ("spx", c_spx), ("core", c_core)) if not c]
    if missing:
        raise SystemExit(
            f"could not find column(s) for: {', '.join(missing)}\n"
            f"columns present: {cols}\n"
            f"use --col-ts / --col-spx / --col-core to name them explicitly."
        )
    print(f"  columns -> ts={c_ts}  spx={c_spx}  core={c_core}"
          f"{'  high=' + c_hi if c_hi else ''}{'  low=' + c_lo if c_lo else ''}")

    out = []
    bad = 0
    for r in rows:
        ts = _parse_ts(r.get(c_ts))
        try:
            spx = float(r.get(c_spx))
            core = float(r.get(c_core))
        except (TypeError, ValueError):
            bad += 1
            continue
        if ts is None or not math.isfinite(spx) or not math.isfinite(core):
            bad += 1
            continue
        if spx <= 0 or core <= 0:
            bad += 1
            continue
        hi = lo = None
        if c_hi and c_lo:
            try:
                hi, lo = float(r[c_hi]), float(r[c_lo])
            except (TypeError, ValueError, KeyError):
                hi = lo = None
        out.append({"ts": ts, "spx": spx, "core": core, "high": hi, "low": lo})
    out.sort(key=lambda x: x["ts"])
    if bad:
        print(f"  skipped {bad} unusable rows")
    return out


def load_snapshots(path, args):
    ext = os.path.splitext(path)[1].lower()
    print(f"loading {path}")
    if ext in (".csv", ".tsv", ".txt"):
        delim = "\t" if ext == ".tsv" else ","
        with open(path, newline="", encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f, delimiter=delim))
        return _rows_to_snaps(rows, args)
    if ext in (".json", ".ndjson", ".jsonl"):
        with open(path, encoding="utf-8") as f:
            txt = f.read().strip()
        if txt.startswith("["):
            data = json.loads(txt)
        else:
            data = [json.loads(l) for l in txt.splitlines() if l.strip()]
        if isinstance(data, dict):
            for v in data.values():
                if isinstance(v, list):
                    data = v
                    break
        return _rows_to_snaps(data, args)
    if ext in (".db", ".sqlite", ".sqlite3"):
        con = sqlite3.connect(path)
        con.row_factory = sqlite3.Row
        tabs = [r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','view')")]
        if args.table:
            tabs = [args.table]
        best, best_rows = None, None
        for t in tabs:
            try:
                rows = [dict(r) for r in con.execute(f'SELECT * FROM "{t}"')]
            except Exception:
                continue
            if not rows:
                continue
            cols = list(rows[0].keys())
            if _pick(cols, SNIFF_SPX, args.col_spx) and _pick(cols, SNIFF_CORE, args.col_core) \
               and _pick(cols, SNIFF_TS, args.col_ts):
                if best_rows is None or len(rows) > len(best_rows):
                    best, best_rows = t, rows
        if best is None:
            raise SystemExit(f"no table in {path} had ts/spx/core columns. tables: {tabs}")
        print(f"  using table '{best}' ({len(best_rows)} rows)")
        return _rows_to_snaps(best_rows, args)
    raise SystemExit(f"unsupported file type: {ext}")


# ----------------------------------------------------------------------------
# Engine
# ----------------------------------------------------------------------------
@dataclass
class Trade:
    day: str
    entry_ts: datetime
    exit_ts: datetime = None
    side: int = 0                # +1 long, -1 short
    entry: float = 0.0
    core: float = 0.0
    stop_pts: float = 0.0
    lots: int = 0
    gross: float = 0.0           # dollars before costs
    costs: float = 0.0
    net: float = 0.0
    r_multiple: float = 0.0
    reason: str = ""
    mae_r: float = 0.0
    mfe_r: float = 0.0


class Position:
    def __init__(self, cfg, ts, price, side, core):
        self.cfg = cfg
        self.side = side
        self.entry = price
        self.core = core
        self.R = cfg.stop_points
        self.lots = cfg.contracts
        self.stop = price - side * self.R
        self.realized = 0.0          # dollars, gross
        self.t = Trade(day=ts.strftime("%Y-%m-%d"), entry_ts=ts, side=side,
                       entry=price, core=core, stop_pts=self.R, lots=cfg.contracts)
        self.stage = 0               # ratchet stage
        self.mae = 0.0
        self.mfe = 0.0

    def r_of(self, price):
        return self.side * (price - self.entry) / self.R

    def targets(self):
        m = self.cfg.exit_mode
        if m == "fixed_1r":
            return [(1.0, self.lots)]
        if m == "fixed_2r":
            return [(2.0, self.lots)]
        if m == "fixed_3r":
            return [(3.0, self.lots)]
        # scale_be / ratchet: half off at 1R, runner to 3R
        half = max(1, self.cfg.contracts // 2)
        return [(1.0, half), (3.0, self.cfg.contracts - half)]

    def close_lots(self, price, n):
        n = min(n, self.lots)
        if n <= 0:
            return
        self.realized += self.side * (price - self.entry) * self.cfg.dpp * n
        self.lots -= n


def _segment_extremes(prev, cur):
    """Conservative price path between two snapshots."""
    if cur.get("high") is not None and cur.get("low") is not None:
        return cur["low"], cur["high"]
    a, b = prev["spx"], cur["spx"]
    return min(a, b), max(a, b)


def run(snaps, cfg):
    trades = []
    pos = None
    prev = None
    in_band_prev = False
    day = None
    day_trades = 0
    last_exit_ts = None
    recent = []

    for s in snaps:
        ts, px, core = s["ts"], s["spx"], s["core"]
        d = ts.strftime("%Y-%m-%d")
        if d != day:
            # new day: force flat
            if pos is not None and prev is not None:
                trades.append(_finalize(pos, prev["ts"], prev["spx"], "eod_rollover", cfg))
                pos = None
            day, day_trades, in_band_prev = d, 0, False
            recent = []
        recent.append(px)
        if len(recent) > cfg.momentum_lookback + 1:
            recent.pop(0)

        rth = RTH_OPEN <= ts.time() <= RTH_CLOSE
        # ---------------- manage open position ----------------
        if pos is not None:
            lo, hi = _segment_extremes(prev, s) if prev else (px, px)
            # worst-case excursion tracking
            if pos.side > 0:
                pos.mae = min(pos.mae, (lo - pos.entry) / pos.R)
                pos.mfe = max(pos.mfe, (hi - pos.entry) / pos.R)
            else:
                pos.mae = min(pos.mae, (pos.entry - hi) / pos.R)
                pos.mfe = max(pos.mfe, (pos.entry - lo) / pos.R)

            stop_hit = (lo <= pos.stop) if pos.side > 0 else (hi >= pos.stop)
            if stop_hit:
                trades.append(_finalize(pos, ts, pos.stop, "stop", cfg))
                pos, last_exit_ts = None, ts
            else:
                # targets, conservative order (stop already checked first)
                for r_mult, n in pos.targets():
                    if pos.lots <= 0:
                        break
                    tgt = pos.entry + pos.side * r_mult * pos.R
                    reached = (hi >= tgt) if pos.side > 0 else (lo <= tgt)
                    if reached and pos.stage < r_mult:
                        pos.close_lots(tgt, n)
                        pos.stage = r_mult
                        if cfg.exit_mode in ("scale_be", "ratchet") and r_mult == 1.0:
                            pos.stop = pos.entry            # breakeven
                        if cfg.exit_mode == "ratchet" and r_mult >= 2.0:
                            pos.stop = pos.entry + pos.side * (r_mult - 1.0) * pos.R
                # ratchet intermediate: at 2R move stop to 1R even without a scale-out
                if cfg.exit_mode == "ratchet" and pos is not None and pos.lots > 0:
                    rr = pos.r_of(hi if pos.side > 0 else lo)
                    if rr >= 2.0:
                        newstop = pos.entry + pos.side * 1.0 * pos.R
                        if (newstop > pos.stop) if pos.side > 0 else (newstop < pos.stop):
                            pos.stop = newstop
                if pos is not None and pos.lots <= 0:
                    trades.append(_finalize(pos, ts, px, "target", cfg))
                    pos, last_exit_ts = None, ts
            # forced flat
            if pos is not None and ts.time() >= cfg.flat_at:
                trades.append(_finalize(pos, ts, px, "flat_at_close", cfg))
                pos, last_exit_ts = None, ts

        # ---------------- entry ----------------
        dist = abs(px - core)
        in_band = dist <= cfg.band
        if pos is None and in_band and not in_band_prev:
            ok = True
            if cfg.rth_only and not rth:
                ok = False
            if ts.time() >= cfg.flat_at:
                ok = False
            if day_trades >= cfg.max_trades_per_day:
                ok = False
            if last_exit_ts and (ts - last_exit_ts) < timedelta(minutes=cfg.cooldown_min):
                ok = False
            side = _side_for(cfg, px, core, recent)
            if side == 0:
                ok = False
            if ok:
                pos = Position(cfg, ts, px, side, core)
                day_trades += 1
        in_band_prev = in_band
        prev = s

    if pos is not None and prev is not None:
        trades.append(_finalize(pos, prev["ts"], prev["spx"], "data_end", cfg))
    return trades


def _side_for(cfg, px, core, recent):
    if cfg.direction == "long":
        return 1
    if cfg.direction == "fade":
        if px > core:
            return -1
        if px < core:
            return 1
        return 0
    if cfg.direction == "momentum":
        if len(recent) < 2:
            return 0
        drift = recent[-1] - recent[0]
        if drift > 0:
            return 1
        if drift < 0:
            return -1
        return 0
    raise ValueError(cfg.direction)


def _finalize(pos, ts, price, reason, cfg):
    pos.close_lots(price, pos.lots)
    t = pos.t
    t.exit_ts = ts
    t.gross = pos.realized
    t.costs = cfg.contracts * cfg.cost_per_contract_rt()
    t.net = t.gross - t.costs
    t.r_multiple = t.net / cfg.risk_dollars if cfg.risk_dollars else 0.0
    t.reason = reason
    t.mae_r = pos.mae
    t.mfe_r = pos.mfe
    return t


# ----------------------------------------------------------------------------
# Stats
# ----------------------------------------------------------------------------
def stats(trades, cfg):
    n = len(trades)
    if n == 0:
        return {"variant": cfg.tag(), "trades": 0}
    nets = [t.net for t in trades]
    wins = [x for x in nets if x > 0]
    losses = [x for x in nets if x <= 0]
    eq, peak, dd = 0.0, 0.0, 0.0
    for x in nets:
        eq += x
        peak = max(peak, eq)
        dd = min(dd, eq - peak)
    gp = sum(wins)
    gl = -sum(losses)
    days = len({t.day for t in trades})
    mean = sum(nets) / n
    sd = (sum((x - mean) ** 2 for x in nets) / n) ** 0.5 if n > 1 else 0.0
    return {
        "variant": cfg.tag(),
        "direction": cfg.direction,
        "exit_mode": cfg.exit_mode,
        "risk_$": cfg.risk_dollars,
        "stop_pts": round(cfg.stop_points, 2),
        "trades": n,
        "days": days,
        "win_rate_%": round(100 * len(wins) / n, 1),
        "net_$": round(sum(nets), 2),
        "avg_$": round(mean, 2),
        "avg_R": round(mean / cfg.risk_dollars, 3),
        "expectancy_$/trade": round(mean, 2),
        "profit_factor": round(gp / gl, 2) if gl > 0 else float("inf"),
        "max_dd_$": round(dd, 2),
        "sd_$": round(sd, 2),
        "t_stat": round(mean / (sd / math.sqrt(n)), 2) if sd > 0 and n > 1 else 0.0,
        "avg_win_$": round(sum(wins) / len(wins), 2) if wins else 0.0,
        "avg_loss_$": round(sum(losses) / len(losses), 2) if losses else 0.0,
        "stopped_%": round(100 * sum(1 for t in trades if t.reason == "stop") / n, 1),
        "eod_flat_%": round(100 * sum(1 for t in trades if t.reason == "flat_at_close") / n, 1),
    }


# ----------------------------------------------------------------------------
# Synthetic data + self-test (verification)
# ----------------------------------------------------------------------------
def synth(days=60, magnet=0.0, seed=7, per_day=390):
    """Random-walk SPX with an optional mean-reverting pull toward the core level."""
    rnd = random.Random(seed)
    snaps = []
    px = 5000.0
    base = datetime(2026, 1, 5, 9, 30)
    for d in range(days):
        day0 = base + timedelta(days=d)
        core = round((px + rnd.gauss(0, 12)) / 5) * 5   # nearest 5-pt strike
        for m in range(per_day):
            ts = day0 + timedelta(minutes=m)
            pull = magnet * (core - px) * 0.01
            px += rnd.gauss(0, 1.1) + pull
            snaps.append({"ts": ts, "spx": px, "core": float(core), "high": None, "low": None})
    return snaps


def selftest():
    print("=" * 74)
    print("SELF-TEST  (verifies the engine detects a real edge and rejects noise)")
    print("=" * 74)
    ok = True

    cfg = Config(direction="fade", exit_mode="ratchet", risk_dollars=100.0)

    # 1. Strong magnet -> fade should be clearly profitable
    t_edge = run(synth(days=120, magnet=1.0, seed=1), cfg)
    s_edge = stats(t_edge, cfg)
    print(f"\n[1] magnet ON   fade  -> trades={s_edge['trades']:4d}  "
          f"net=${s_edge['net_$']:>9,.0f}  avgR={s_edge['avg_R']:+.3f}  t={s_edge['t_stat']:+.2f}")
    if not (s_edge["trades"] > 50 and s_edge["avg_R"] > 0):
        print("    FAIL: engine did not capture an injected mean-reversion edge"); ok = False

    # 2. Pure random walk -> edge should be ~0 or negative after costs
    t_rand = run(synth(days=120, magnet=0.0, seed=2), cfg)
    s_rand = stats(t_rand, cfg)
    print(f"[2] magnet OFF  fade  -> trades={s_rand['trades']:4d}  "
          f"net=${s_rand['net_$']:>9,.0f}  avgR={s_rand['avg_R']:+.3f}  t={s_rand['t_stat']:+.2f}")
    if abs(s_rand["t_stat"]) > 3.0:
        print("    FAIL: engine invented an edge in pure noise"); ok = False

    # 3. Inverted magnet (price repelled) -> fade should lose
    t_rep = run(synth(days=120, magnet=-1.0, seed=3), cfg)
    s_rep = stats(t_rep, cfg)
    print(f"[3] repel       fade  -> trades={s_rep['trades']:4d}  "
          f"net=${s_rep['net_$']:>9,.0f}  avgR={s_rep['avg_R']:+.3f}")
    if s_rep["avg_R"] >= s_edge["avg_R"]:
        print("    FAIL: repel case did not underperform magnet case"); ok = False

    # 4. Risk math
    c = Config(risk_dollars=100.0, contracts=2)
    assert abs(c.stop_points - 10.0) < 1e-9, "stop point math wrong"
    c2 = Config(risk_dollars=250.0, contracts=2)
    assert abs(c2.stop_points - 25.0) < 1e-9
    print(f"[4] risk math   -> $100 / 2 MES = {c.stop_points:.1f} pts  |  "
          f"$250 / 2 MES = {c2.stop_points:.1f} pts   OK")

    # 5. Stop-before-target conservatism
    s = [{"ts": datetime(2026, 1, 5, 10, 0), "spx": 5000.0, "core": 5000.0, "high": None, "low": None},
         {"ts": datetime(2026, 1, 5, 10, 1), "spx": 5000.0, "core": 5000.0, "high": 5100.0, "low": 4900.0}]
    tt = run(s, Config(direction="long", exit_mode="ratchet", risk_dollars=100.0, cooldown_min=0))
    if tt and tt[0].reason != "stop":
        print("    FAIL: ambiguous bar did not resolve to the stop"); ok = False
    else:
        print("[5] fill model  -> ambiguous bar resolves to STOP (conservative)   OK")

    print("\n" + ("SELF-TEST PASSED" if ok else "SELF-TEST FAILED"))
    return 0 if ok else 1


# ----------------------------------------------------------------------------
# Reporting
# ----------------------------------------------------------------------------
def write_outputs(rows, all_trades, outdir):
    os.makedirs(outdir, exist_ok=True)
    keys = sorted({k for r in rows for k in r}, key=lambda k: (k != "variant", k))
    p1 = os.path.join(outdir, "results.csv")
    with open(p1, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        for r in rows:
            w.writerow(r)
    p2 = os.path.join(outdir, "trades.csv")
    with open(p2, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["variant", "day", "entry_ts", "exit_ts", "side", "entry", "core",
                    "stop_pts", "lots", "gross_$", "costs_$", "net_$", "R", "reason",
                    "mae_R", "mfe_R"])
        for tag, ts_ in all_trades:
            for t in ts_:
                w.writerow([tag, t.day, t.entry_ts, t.exit_ts,
                            "long" if t.side > 0 else "short", round(t.entry, 2),
                            round(t.core, 2), round(t.stop_pts, 2), t.lots,
                            round(t.gross, 2), round(t.costs, 2), round(t.net, 2),
                            round(t.r_multiple, 3), t.reason, round(t.mae_r, 2),
                            round(t.mfe_r, 2)])
    print(f"\nwrote {p1}\nwrote {p2}")
    return p1, p2


def print_table(rows):
    if not rows:
        print("no results")
        return
    cols = ["variant", "trades", "win_rate_%", "avg_R", "expectancy_$/trade",
            "net_$", "profit_factor", "max_dd_$", "t_stat", "stopped_%"]
    widths = [max(len(c), max(len(f"{r.get(c,'')}") for r in rows)) for c in cols]
    print("\n" + "  ".join(c.ljust(w) for c, w in zip(cols, widths)))
    print("  ".join("-" * w for w in widths))
    for r in sorted(rows, key=lambda r: -(r.get("avg_R") or -9)):
        print("  ".join(f"{r.get(c,'')}".ljust(w) for c, w in zip(cols, widths)))


# ----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Core-level MES backtester")
    ap.add_argument("--data", help="snapshots file (.csv/.json/.db)")
    ap.add_argument("--out", default="./bt_results")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--sweep", action="store_true",
                    help="run all directions x exit modes x risk sizes")
    ap.add_argument("--band", type=float, default=5.0)
    ap.add_argument("--contracts", type=int, default=2)
    ap.add_argument("--risk", type=float, default=100.0, help="stop in $ on the whole trade")
    ap.add_argument("--direction", default="fade", choices=["fade", "momentum", "long"])
    ap.add_argument("--exit-mode", default="ratchet",
                    choices=["fixed_1r", "fixed_2r", "fixed_3r", "scale_be", "ratchet"])
    ap.add_argument("--max-trades-per-day", type=int, default=3)
    ap.add_argument("--cooldown-min", type=int, default=15)
    ap.add_argument("--all-hours", action="store_true", help="disable the RTH filter")
    ap.add_argument("--table", help="sqlite table name override")
    ap.add_argument("--col-ts"); ap.add_argument("--col-spx"); ap.add_argument("--col-core")
    ap.add_argument("--col-high"); ap.add_argument("--col-low")
    args = ap.parse_args()

    if args.selftest:
        return selftest()
    if not args.data:
        ap.error("--data is required (or use --selftest)")

    snaps = load_snapshots(args.data, args)
    if len(snaps) < 20:
        raise SystemExit(f"only {len(snaps)} usable snapshots - not enough to backtest")
    days = sorted({s['ts'].strftime('%Y-%m-%d') for s in snaps})
    gaps = [(snaps[i + 1]["ts"] - snaps[i]["ts"]).total_seconds()
            for i in range(min(len(snaps) - 1, 5000))]
    gaps = [g for g in gaps if 0 < g < 3600]
    med = sorted(gaps)[len(gaps) // 2] if gaps else 0
    print(f"  {len(snaps)} snapshots over {len(days)} sessions "
          f"({days[0]} -> {days[-1]}), median spacing {med:.0f}s")
    if med > 180:
        print("  WARNING: snapshot spacing > 3 min. Stops and targets can only be "
              "checked at snapshot granularity, so fills will be coarse.")

    base = dict(band=args.band, contracts=args.contracts,
                max_trades_per_day=args.max_trades_per_day,
                cooldown_min=args.cooldown_min, rth_only=not args.all_hours)

    combos = []
    if args.sweep:
        for d in ("fade", "momentum", "long"):
            for m in ("fixed_1r", "fixed_2r", "fixed_3r", "scale_be", "ratchet"):
                for r in (50.0, 100.0, 150.0, 250.0):
                    combos.append(Config(direction=d, exit_mode=m, risk_dollars=r, **base))
    else:
        for d in ("fade", "momentum", "long"):
            combos.append(Config(direction=d, exit_mode=args.exit_mode,
                                 risk_dollars=args.risk, **base))

    rows, all_trades = [], []
    for cfg in combos:
        tr = run(snaps, cfg)
        rows.append(stats(tr, cfg))
        all_trades.append((cfg.tag(), tr))
    print_table(rows)
    write_outputs(rows, all_trades, args.out)

    best = max((r for r in rows if r.get("trades", 0) >= 20),
               key=lambda r: r.get("avg_R", -9), default=None)
    print("\n" + "=" * 74)
    if best is None:
        print("Not enough trades in any variant to say anything. Need more snapshot history.")
    elif best["avg_R"] <= 0:
        print(f"No variant showed a positive edge. Best was {best['variant']} "
              f"at {best['avg_R']:+.3f} R/trade.")
    else:
        print(f"Best: {best['variant']}  {best['avg_R']:+.3f} R/trade over "
              f"{best['trades']} trades, t-stat {best['t_stat']:+.2f}")
        if abs(best["t_stat"]) < 2.0:
            print("t-stat below 2 - this is not yet distinguishable from luck.")
        if args.sweep:
            print("Note: this is the winner of a 60-cell sweep. Expect the best cell to")
            print("overstate the edge. Re-check it on data the sweep never saw.")
    print("=" * 74)
    return 0


if __name__ == "__main__":
    sys.exit(main())
