#!/usr/bin/env python3
"""
TPO forecast — GEX-aware neighbour match (extends tpo_forecast.py)
==================================================================

Same target and scoring as tpo_forecast.py (predict the full-day RTH TPO time
profile from the Initial Balance, walk-forward). The ONLY change: the k-NN
neighbour match can also use GEX features observed at ~10:30 ET, so "similar
days" means similar auction *and* similar dealer positioning.

Head-to-head on the SAME scored window:
    knn_ib     — IB features only              (the current model)
    knn_ibgex  — IB features + GEX features     (the test)
    persist    — yesterday's profile            (honest baseline)
    climo      — average day                    (context)

GEX features are leak-free: taken at the IB close, never end-of-day.

────────────────────────────────────────────────────────────────────────────
INPUT YOU MUST PROVIDE (drop into repo root; any ONE of these is enough):

  gex_preview_history.csv   (best / smallest — from preview_snapshots)
      columns: date,time,ts,spx_price,gex_flip,call_wall,put_wall
      export SQL (psql on the VPS):
        \\copy (SELECT date, time, ts, spx_price, gex_flip, call_wall, put_wall
               FROM preview_snapshots ORDER BY ts) TO 'gex_preview_history.csv' CSV HEADER

  gex_strike_history.csv    (richer — from option_strike_gex_history; walls/flip
                             reconstructed here from per-strike net_gex)
      columns: date,timestamp,spot,strike,net_gex
      export SQL:
        \\copy (SELECT date, timestamp, spot, strike, net_gex
               FROM option_strike_gex_history ORDER BY date, timestamp, strike)
               TO 'gex_strike_history.csv' CSV HEADER

Optional, adds a prior-day regime feature:
  gex_eod_history.csv       (from eod_gex)
      \\copy (SELECT date, symbol, total_gex, spot FROM eod_gex
             WHERE symbol IN ('SPX','SPXW','SPY') ORDER BY date)
             TO 'gex_eod_history.csv' CSV HEADER
────────────────────────────────────────────────────────────────────────────
"""
import os, sys, math
import numpy as np, pandas as pd
from datetime import datetime, time
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt

import tpo_forecast as T   # reuse build_session / to_density / score / GRID / theme

REPO = os.environ.get("TPO_REPO", "/mnt/user-data/uploads/spx-gex-dashboard-tt-fixed")
ES_CSV = f"{REPO}/ESU6 - 5 min - RTH.csv"
IB_CLOSE_MIN = 10 * 60 + 30           # 10:30 ET, minutes since midnight
K = T.K; MIN_HISTORY = T.MIN_HISTORY

# ── GEX feature source A: preview_snapshots-style walls/flip ───────────────────
def hhmm_to_min(s):
    try:
        h, m = str(s).split(":")[:2]; return int(h) * 60 + int(m)
    except Exception:
        return None

def load_gex_preview(path):
    df = pd.read_csv(path)
    # normalize date to YYYY-MM-DD
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    if "time" in df and df["time"].notna().any():
        df["minute"] = df["time"].map(hhmm_to_min)
    else:  # derive minute from ts (ms, UTC) -> ET is handled loosely via provided time; fall back to ts
        df["minute"] = ((df["ts"] // 60000) % (24 * 60)).astype(int)
    out = {}
    for d, g in df.groupby("date"):
        g = g.dropna(subset=["call_wall", "put_wall", "spx_price"])
        if g.empty: continue
        # row nearest to 10:30 that is AT or AFTER (>= IB close) if possible, else nearest
        g = g.assign(dmin=(g["minute"] - IB_CLOSE_MIN))
        after = g[g["dmin"] >= 0]
        row = (after.sort_values("dmin").iloc[0] if not after.empty
               else g.assign(a=g["dmin"].abs()).sort_values("a").iloc[0])
        out[d] = {"spot": float(row["spx_price"]),
                  "call_wall": float(row["call_wall"]),
                  "put_wall": float(row["put_wall"]),
                  "flip": float(row["gex_flip"]) if pd.notna(row.get("gex_flip")) else np.nan}
    return out

# ── GEX feature source B: reconstruct walls/flip from per-strike net_gex ───────
def load_gex_strike(path):
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    # stored timestamp is epoch-ms UTC; the IB-close pick must be in ET (DST-correct).
    et = pd.to_datetime(df["timestamp"], unit="ms", utc=True).dt.tz_convert("America/New_York")
    df["minute"] = et.dt.hour * 60 + et.dt.minute
    out = {}
    for d, g in df.groupby("date"):
        after = g[g["minute"] >= IB_CLOSE_MIN]
        pick = after if not after.empty else g
        ts = pick["timestamp"].min()
        snap = g[g["timestamp"] == ts]
        if snap.empty: continue
        spot = float(snap["spot"].iloc[0]) if snap["spot"].notna().any() else np.nan
        by = snap.groupby("strike")["net_gex"].sum().sort_index()
        if by.empty or math.isnan(spot): continue
        strikes = by.index.values; gex = by.values
        call_wall = strikes[np.argmax(np.where(strikes >= spot, gex, -np.inf))]     # max +gex above
        put_wall  = strikes[np.argmin(np.where(strikes <= spot, gex,  np.inf))]     # min -gex below
        cum = np.cumsum(gex); flip_i = int(np.argmin(np.abs(cum)))                  # zero-gamma cross
        out[d] = {"spot": spot, "call_wall": float(call_wall),
                  "put_wall": float(put_wall), "flip": float(strikes[flip_i])}
    return out

def load_eod(path):
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    pref = ["SPX", "SPXW", "SPY"]
    df["rank"] = df["symbol"].map(lambda s: pref.index(s) if s in pref else 9)
    df = df.sort_values(["date", "rank"]).groupby("date").first()
    return {d: {"total_gex": float(r["total_gex"]), "spot": float(r["spot"])} for d, r in df.iterrows()}

# ── GEX feature vector, normalized to be scale-consistent with IB features ─────
def gex_features(g, trail_ib):
    n = trail_ib or 1.0
    width = g["call_wall"] - g["put_wall"]
    pos = (g["spot"] - g["put_wall"]) / width if width else 0.5     # 0=at put wall, 1=at call wall
    flip_dist = (g["spot"] - g["flip"]) / n if not math.isnan(g["flip"]) else 0.0
    return np.array([
        (g["call_wall"] - g["spot"]) / n,     # room to call wall (IB units)
        (g["spot"] - g["put_wall"]) / n,      # room to put wall
        width / n,                            # wall span
        pos * 4.0,                            # position between walls (scaled ~feature range)
        flip_dist,                            # + = above flip (long-gamma / pin), - = below (short-gamma)
        1.0 if flip_dist >= 0 else -1.0,      # regime sign
    ], dtype=float)

# ── main ──────────────────────────────────────────────────────────────────────
def main():
    prev_src = f"{REPO}/gex_preview_history.csv"
    strike_src = f"{REPO}/gex_strike_history.csv"
    eod_src = f"{REPO}/gex_eod_history.csv"
    gex = {}
    if os.path.exists(prev_src):
        gex = load_gex_preview(prev_src); src = "preview_snapshots"
    elif os.path.exists(strike_src):
        gex = load_gex_strike(strike_src); src = "option_strike_gex_history"
    else:
        print("NO GEX EXPORT FOUND. Drop one of these into the repo root and re-run:\n"
              "  gex_preview_history.csv   (best)\n  gex_strike_history.csv\n"
              "See the export SQL in this file's header.")
        return
    eod = load_eod(eod_src) if os.path.exists(eod_src) else {}
    print(f"GEX source: {src} — {len(gex)} days with walls" + (f", eod {len(eod)} days" if eod else ""))

    # build ES sessions
    df = T.load(ES_CSV)
    days_all = sorted(df["date"].unique())
    sess = {}
    for d in days_all:
        s = T.build_session(df[df["date"] == d])
        if s:
            s["real"] = T.to_density(s["prices"], s["counts"], s["ib_mid"])
            sess[d] = s
    days = [d for d in days_all if d in sess]
    overlap = [d for d in days if d in gex]
    print(f"ES sessions {len(days)}  |  GEX overlap {len(overlap)}  "
          f"({overlap[0] if overlap else '-'} .. {overlap[-1] if overlap else '-'})")
    if len(overlap) < MIN_HISTORY + 30:
        print(f"⚠ only {len(overlap)} overlap days — thin for walk-forward "
              f"(want > {MIN_HISTORY + 30}). Results will be directional.")

    # IB features (reuse tpo_forecast.features) + GEX features, per day
    ibf, gxf = {}, {}
    for i, d in enumerate(days):
        s = sess[d]; prev = sess[days[i - 1]] if i > 0 else None
        win = [sess[x] for x in days[:i][-20:]]
        trail_ib = np.median([x["ib_rng"] for x in win]) if win else s["ib_rng"]
        trail_rng = np.median([x["high"] - x["low"] for x in win]) if win else 1.0
        ibf[d] = T.features(s, prev, trail_ib, trail_rng)
        if d in gex:
            f = gex_features(gex[d], trail_ib)
            if eod and prev and days[i - 1] in eod:
                pe = eod[days[i - 1]]
                f = np.append(f, np.tanh(pe["total_gex"] / 1e9))  # prior-day net-gex regime, squashed
            gxf[d] = f

    # walk-forward over the GEX-overlap window only (apples-to-apples)
    methods = ["knn_ibgex", "knn_ib", "persist", "climo"]
    recs = []
    for i, d in enumerate(days):
        if d not in gxf:
            continue
        hist = [h for h in days[:i] if h in gxf]      # need GEX history for the ibgex pool
        if len(hist) < MIN_HISTORY:
            continue
        prev = sess[days[i - 1]] if i > 0 else None

        def knn(feat_of):
            H = np.array([feat_of[x] for x in hist]); q = feat_of[d]
            mu, sd = H.mean(0), H.std(0); sd[sd == 0] = 1.0
            Hn = (H - mu) / sd; qn = (q - mu) / sd
            dist = np.sqrt(((Hn - qn) ** 2).sum(1))
            nn = np.argsort(dist)[:K]
            w = 1.0 / (dist[nn] + 1e-6); w /= w.sum()
            return (np.array([sess[hist[j]]["real"] for j in nn]) * w[:, None]).sum(0)

        ibgex_feat = {x: np.concatenate([ibf[x], gxf[x]]) for x in hist + [d]}
        preds = {
            "knn_ibgex": knn(ibgex_feat),
            "knn_ib":    knn(ibf),
            "persist":   prev["real"].copy() if prev else None,
            "climo":     np.mean([sess[x]["real"] for x in hist], 0),
        }
        real = sess[d]["real"]
        rec = {"date": d}
        for m in methods:
            if preds[m] is None: continue
            sc = T.score(preds[m], real)
            if sc:
                for k2, v in sc.items(): rec[f"{m}_{k2}"] = v
        rec["_p"] = preds; rec["_real"] = real; rec["_ibmid"] = sess[d]["ib_mid"]
        recs.append(rec)

    if not recs:
        print("No days scored — GEX overlap too short for the walk-forward warmup.")
        return
    R = pd.DataFrame([{k: v for k, v in r.items() if not k.startswith("_")} for r in recs])
    print(f"\nscored {len(R)} days (walk-forward on GEX overlap, k={K})\n")

    base = R["persist_emd"].median()
    lb = []
    for m in methods:
        if f"{m}_emd" not in R: continue
        lb.append({"method": m,
                   "EMD_med": R[f"{m}_emd"].median(), "EMD_mean": R[f"{m}_emd"].mean(),
                   "POCerr_med": R[f"{m}_poc_err"].median(), "VA_IoU_med": R[f"{m}_va_iou"].median(),
                   "JS_med": R[f"{m}_js"].median(),
                   "EMD_skill_vs_persist%": (1 - R[f"{m}_emd"].median() / base) * 100})
    LB = pd.DataFrame(lb).set_index("method")
    pd.set_option("display.width", 150, "display.float_format", lambda x: f"{x:8.3f}")
    print(LB.to_string())

    # the number that answers the question: does GEX beat IB-only, head to head?
    if "knn_ib_emd" in R and "knn_ibgex_emd" in R:
        d_emd = (R["knn_ib_emd"].median() - R["knn_ibgex_emd"].median())
        win = (R["knn_ibgex_emd"] < R["knn_ib_emd"]).mean() * 100
        print(f"\nGEX vs IB-only:  median EMD improves {d_emd:+.2f} pts "
              f"({d_emd / R['knn_ib_emd'].median() * 100:+.1f}%);  "
              f"GEX wins on {win:.0f}% of days")

    R.to_csv("/tmp/w/tpo_gex_scores.csv", index=False)
    _plot(R, LB, methods)

def _plot(R, LB, methods):
    mcol = {"knn_ibgex": T.CY, "knn_ib": T.LB, "persist": T.OR, "climo": T.GR}
    fig, ax = plt.subplots(1, 2, figsize=(12, 4.4), facecolor=T.BG)
    for a in ax: a.set_facecolor(T.PANEL); a.tick_params(colors=T.TX)
    for m in methods:
        if f"{m}_emd" not in R: continue
        v = R[f"{m}_emd"].dropna()
        ax[0].hist(v, bins=30, histtype="step", lw=2, color=mcol[m], label=f"{m} (med {v.median():.1f})")
    ax[0].set_title("EMD (pts) — lower better", color=T.TX, fontsize=10)
    ax[0].legend(fontsize=8, facecolor=T.PANEL, labelcolor=T.TX)
    if "knn_ib_emd" in R and "knn_ibgex_emd" in R:
        ax[1].scatter(R["knn_ib_emd"], R["knn_ibgex_emd"], s=10, color=T.CY, alpha=0.5)
        lim = [0, max(R["knn_ib_emd"].max(), R["knn_ibgex_emd"].max())]
        ax[1].plot(lim, lim, color=T.TX, lw=1, ls="--")
        ax[1].set_xlabel("IB-only EMD", color=T.TX); ax[1].set_ylabel("IB+GEX EMD", color=T.TX)
        ax[1].set_title("below the line = GEX helped that day", color=T.TX, fontsize=10)
    for a in ax:
        for sp in a.spines.values(): sp.set_color(T.GC)
        a.grid(True, color=T.GC, alpha=0.3)
    fig.suptitle("Does GEX-aware matching beat IB-only? (same days)", color=T.TX, fontsize=13)
    fig.tight_layout(); fig.savefig("/tmp/w/tpo_gex_compare.png", dpi=110, facecolor=T.BG); plt.close(fig)

if __name__ == "__main__":
    main()
