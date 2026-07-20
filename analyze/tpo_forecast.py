#!/usr/bin/env python3
"""
TPO time-profile forecaster + scorer  (research prototype)
==========================================================

Target: the FULL-DAY RTH TPO *time* profile (one touch per 30-min period per
price bin -- TIME, not volume), the same object lib/tpo.ts::buildTpoSession
produces as `bins[]`.

Decision moment: end of the Initial Balance (first two 30-min periods, ~10:30
ET). From IB-only features we predict the shape of the whole day's profile,
then score the prediction against what actually printed by the close.

Everything is walk-forward: day t is predicted using ONLY days < t. No lookahead.

Input : ESU6 5-min RTH CSV  ->  "YYYYMMDD HHMMSS,open,high,low,close,volume"
Output: scores CSV, leaderboard, summary md, and PNG plots.

This mirrors the TS period/bin logic on purpose so results transfer to the app:
  period key   = floor(epoch_ms / 30min)              (:00/:30 boundaries, ET-safe)
  touched bins = floor(lo/bin) .. floor(hi/bin)        (one touch per period)
  POC          = max-count bin ; VA grows 70% from POC toward the taller side
  IB           = periods 0 and 1
"""
import sys, math
import numpy as np, pandas as pd
from datetime import datetime, time
from scipy.stats import wasserstein_distance
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ── theme (matches components/shared/homeTheme.ts) ────────────────────────────
CY, OR, GR, RD, LB, TX = "#219EBC", "#FB8501", "#8ECAE6", "#EF4444", "#7dd3fc", "#e8edf2"
BG, PANEL, GC = "#0b0f14", "#111820", "#243040"

BIN   = 1.0        # ES bin size (points) -- lib/tpo.ts default
VAPCT = 0.70
RTH_START, RTH_END = time(9, 30), time(16, 0)   # 09:30 .. 16:00 ET
PERIOD_MS = 30 * 60_000
GRID = np.arange(-100.0, 100.0 + BIN, BIN)       # offset axis vs IB-mid (points)
GZERO = np.where(GRID == 0.0)[0][0]
K = 25             # neighbours
MIN_HISTORY = 80   # days required before we predict at all
IB_PERIODS = 2

# ── load ──────────────────────────────────────────────────────────────────────
def load(path):
    rows = []
    with open(path) as f:
        for ln in f:
            ln = ln.strip()
            if not ln: continue
            ts, o, h, l, c, v = ln.split(",")
            dt = datetime.strptime(ts, "%Y%m%d %H%M%S")
            rows.append((dt, float(o), float(h), float(l), float(c), float(v)))
    df = pd.DataFrame(rows, columns=["dt", "o", "h", "l", "c", "v"])
    df["date"] = df["dt"].dt.strftime("%Y-%m-%d")
    t = df["dt"].dt.time
    df = df[(t >= RTH_START) & (t < RTH_END)].reset_index(drop=True)
    df["epoch_ms"] = df["dt"].values.astype("datetime64[ms]").astype("int64")
    return df

# ── one session's TPO profile (mirror of lib/tpo.ts) ──────────────────────────
def build_session(g):
    g = g.sort_values("epoch_ms")
    # collapse 5m bars -> 30-min periods (lo/hi/close), ordered
    per = {}
    for _, r in g.iterrows():
        k = (r.epoch_ms // PERIOD_MS) * PERIOD_MS
        p = per.get(k)
        if p is None:
            per[k] = {"lo": r.l, "hi": r.h, "close": r.c, "ts": k, "last": r.epoch_ms}
        else:
            p["lo"] = min(p["lo"], r.l); p["hi"] = max(p["hi"], r.h)
            if r.epoch_ms >= p["last"]:
                p["close"] = r.c; p["last"] = r.epoch_ms
    periods = [per[k] for k in sorted(per)]
    if len(periods) < 3:
        return None

    floor = lambda x: math.floor(x / BIN) * BIN
    touched = {}
    for idx, p in enumerate(periods):
        b0, b1 = floor(p["lo"]), floor(p["hi"])
        b = b0
        while b <= b1 + 1e-9:
            touched.setdefault(round(b, 4), []).append(idx)
            b += BIN
    prices = np.array(sorted(touched))
    counts = np.array([len(touched[p]) for p in prices], dtype=float)
    if len(prices) < 3:
        return None

    poc_i = int(counts.argmax())
    tot, target = counts.sum(), counts.sum() * VAPCT
    lo_i = hi_i = poc_i; acc = counts[poc_i]
    while acc < target and (lo_i > 0 or hi_i < len(prices) - 1):
        below = counts[lo_i - 1] if lo_i > 0 else -1
        above = counts[hi_i + 1] if hi_i < len(prices) - 1 else -1
        if above >= below: hi_i += 1; acc += max(0, above)
        else:              lo_i -= 1; acc += max(0, below)

    ib = periods[:IB_PERIODS]
    ib_hi = max(p["hi"] for p in ib); ib_lo = min(p["lo"] for p in ib)
    ib_mid = (ib_hi + ib_lo) / 2.0
    ib_rng = ib_hi - ib_lo

    return {
        "prices": prices, "counts": counts,
        "poc": prices[poc_i], "vah": prices[hi_i], "val": prices[lo_i],
        "high": g.h.max(), "low": g.l.min(), "open": g.iloc[0].o, "close": g.iloc[-1].c,
        "ib_hi": ib_hi, "ib_lo": ib_lo, "ib_mid": ib_mid, "ib_rng": ib_rng,
        "n_periods": len(periods),
    }

# ── density on the shared offset grid (price - ib_mid), normalized to sum 1 ────
def to_density(prices, counts, anchor):
    off = prices - anchor
    dens = np.zeros_like(GRID)
    idx = np.round((off - GRID[0]) / BIN).astype(int)
    ok = (idx >= 0) & (idx < len(GRID))
    for i, cnt in zip(idx[ok], counts[ok]):
        dens[i] += cnt
    s = dens.sum()
    return dens / s if s > 0 else dens

# ── value-area interval from a density (contiguous grow from peak) ────────────
def va_interval(dens, pct=VAPCT):
    if dens.sum() <= 0: return (0.0, 0.0)
    poc = int(dens.argmax()); lo = hi = poc; acc = dens[poc]; tot = dens.sum()
    while acc < tot * pct and (lo > 0 or hi < len(dens) - 1):
        below = dens[lo - 1] if lo > 0 else -1
        above = dens[hi + 1] if hi < len(dens) - 1 else -1
        if above >= below: hi += 1; acc += max(0, above)
        else:              lo -= 1; acc += max(0, below)
    return (GRID[lo], GRID[hi])

def overlap_pct(a, b):
    lo, hi = max(a[0], b[0]), min(a[1], b[1])
    inter = max(0.0, hi - lo)
    union = (max(a[1], b[1]) - min(a[0], b[0]))
    return inter / union if union > 0 else 0.0   # IoU

# ── scoring: predicted vs realized densities on GRID ──────────────────────────
def js_div(p, q, eps=1e-9):
    p = p + eps; q = q + eps; p /= p.sum(); q /= q.sum()
    m = 0.5 * (p + q)
    kl = lambda a, b: np.sum(a * np.log(a / b))
    return 0.5 * kl(p, m) + 0.5 * kl(q, m)

def score(pred, real):
    if pred.sum() <= 0 or real.sum() <= 0:
        return None
    emd = wasserstein_distance(GRID, GRID, pred, real)          # points
    poc_err = abs(GRID[int(pred.argmax())] - GRID[int(real.argmax())])
    va = overlap_pct(va_interval(pred), va_interval(real)) * 100.0
    js = js_div(pred, real)
    return {"emd": emd, "poc_err": poc_err, "va_iou": va, "js": js}

# ── feature vector known at IB close (10:30) ──────────────────────────────────
def features(s, prev, trail_ib_med, trail_rng_med):
    gap = (s["open"] - prev["close"]) if prev else 0.0
    ib_norm = s["ib_rng"] / trail_ib_med if trail_ib_med else 1.0
    open_in_ib = (s["open"] - s["ib_mid"]) / s["ib_rng"] if s["ib_rng"] else 0.0
    prev_poc_off = (prev["poc"] - s["ib_mid"]) if prev else 0.0
    prev_rng = (prev["high"] - prev["low"]) if prev else 0.0
    prev_rng_norm = prev_rng / trail_rng_med if trail_rng_med else 1.0
    return np.array([ib_norm, open_in_ib, gap / (trail_ib_med or 1),
                     prev_poc_off / (trail_ib_med or 1), prev_rng_norm], dtype=float)

# ── main walk-forward ─────────────────────────────────────────────────────────
def main(path):
    df = load(path)
    dates = sorted(df["date"].unique())
    sess = {}
    for d in dates:
        s = build_session(df[df["date"] == d])
        if s: sess[d] = s
    days = [d for d in dates if d in sess]
    print(f"loaded {len(days)} RTH sessions  {days[0]} .. {days[-1]}")

    # precompute realized densities (centered on each day's own IB mid)
    for d in days:
        s = sess[d]
        s["real"] = to_density(s["prices"], s["counts"], s["ib_mid"])

    feats, recs = {}, []
    methods = ["knn", "persist", "climo"]
    for i, d in enumerate(days):
        s = sess[d]; prev = sess[days[i - 1]] if i > 0 else None
        hist = days[:i]
        # trailing medians (last 20 sessions) for normalization
        win = [sess[x] for x in hist[-20:]]
        trail_ib = np.median([x["ib_rng"] for x in win]) if win else s["ib_rng"]
        trail_rng = np.median([x["high"] - x["low"] for x in win]) if win else 1.0
        feats[d] = features(s, prev, trail_ib, trail_rng)
        if len(hist) < MIN_HISTORY:
            continue

        # standardize features on history only
        H = np.array([feats[x] for x in hist])
        mu, sd = H.mean(0), H.std(0); sd[sd == 0] = 1.0
        Hn = (H - mu) / sd
        qn = (feats[d] - mu) / sd

        # --- predictions on the offset grid ---
        preds = {}
        # k-NN: average realized offset-profiles of nearest IB-feature days
        dist = np.sqrt(((Hn - qn) ** 2).sum(1))
        nn = np.argsort(dist)[:K]
        stack = np.array([sess[hist[j]]["real"] for j in nn])
        # weight neighbours by inverse distance
        w = 1.0 / (dist[nn] + 1e-6); w /= w.sum()
        preds["knn"] = (stack * w[:, None]).sum(0)
        # persistence: yesterday's realized offset profile
        preds["persist"] = prev["real"].copy()
        # climatology: mean of ALL prior realized offset profiles
        preds["climo"] = np.mean([sess[x]["real"] for x in hist], 0)

        rec = {"date": d}
        for m in methods:
            sc = score(preds[m], s["real"])
            if sc:
                for k2, v in sc.items(): rec[f"{m}_{k2}"] = v
        rec["_preds"] = preds; rec["_real"] = s["real"]; rec["_ibmid"] = s["ib_mid"]
        recs.append(rec)

    R = pd.DataFrame([{k: v for k, v in r.items() if not k.startswith("_")} for r in recs])
    print(f"scored {len(R)} days (walk-forward, k={K}, min_history={MIN_HISTORY})\n")

    # ── leaderboard ──
    lb = []
    for m in methods:
        lb.append({
            "method": m,
            "EMD_med(pts)":   R[f"{m}_emd"].median(),
            "EMD_mean":       R[f"{m}_emd"].mean(),
            "POCerr_med":     R[f"{m}_poc_err"].median(),
            "VA_IoU_med(%)":  R[f"{m}_va_iou"].median(),
            "JS_med":         R[f"{m}_js"].median(),
        })
    LB = pd.DataFrame(lb).set_index("method")
    # skill vs persistence on EMD
    base = R["persist_emd"].median()
    LB["EMD_skill_vs_persist(%)"] = (1 - LB["EMD_med(pts)"] / base) * 100
    pd.set_option("display.width", 140, "display.float_format", lambda x: f"{x:8.3f}")
    print(LB.to_string())

    R.to_csv("/tmp/w/tpo_scores.csv", index=False)
    plots(R, recs, methods, LB)
    summary(R, LB, methods, days)
    return R, LB

# ── plots ─────────────────────────────────────────────────────────────────────
def plots(R, recs, methods, LB):
    mcol = {"knn": CY, "persist": OR, "climo": GR}
    # (1) score distributions
    fig, ax = plt.subplots(1, 3, figsize=(15, 4.2), facecolor=BG)
    for a in ax: a.set_facecolor(PANEL)
    for metric, a, title, better in [
        ("emd", ax[0], "Earth-Mover Distance (pts) — lower better", "lo"),
        ("poc_err", ax[1], "POC offset error (pts) — lower better", "lo"),
        ("va_iou", ax[2], "Value-Area IoU (%) — higher better", "hi")]:
        for m in methods:
            vals = R[f"{m}_{metric}"].dropna()
            a.hist(vals, bins=40, histtype="step", lw=2, color=mcol[m],
                   label=f"{m} (med {vals.median():.1f})")
        a.set_title(title, color=TX, fontsize=10)
        a.tick_params(colors=TX); a.legend(fontsize=8, facecolor=PANEL, labelcolor=TX)
        for sp in a.spines.values(): sp.set_color(GC)
        a.grid(True, color=GC, alpha=0.3)
    fig.suptitle("TPO profile forecast — score distributions (walk-forward)", color=TX, fontsize=13)
    fig.tight_layout(); fig.savefig("/tmp/w/tpo_scores.png", dpi=110, facecolor=BG); plt.close(fig)

    # (2) sample-day overlays: pick best/typical/worst knn days by EMD
    order = R.sort_values("knn_emd").reset_index(drop=True)
    picks = [("best", order.iloc[0]["date"]),
             ("median", order.iloc[len(order)//2]["date"]),
             ("worst", order.iloc[-1]["date"])]
    byd = {r["date"]: r for r in recs}
    fig, ax = plt.subplots(1, 3, figsize=(15, 4.6), facecolor=BG)
    for (tag, d), a in zip(picks, ax):
        r = byd[d]; a.set_facecolor(PANEL)
        px = GRID + r["_ibmid"]
        a.fill_between(px, r["_real"], color=TX, alpha=0.18, step="mid", label="realized")
        a.step(px, r["_real"], color=TX, lw=1.4, where="mid")
        a.step(px, r["_preds"]["knn"], color=CY, lw=2, where="mid", label="k-NN pred")
        a.step(px, r["_preds"]["persist"], color=OR, lw=1.2, where="mid", alpha=0.8, label="persist")
        a.set_title(f"{tag}: {d}  (EMD {R[R.date==d]['knn_emd'].iloc[0]:.1f} pts)", color=TX, fontsize=10)
        a.tick_params(colors=TX); a.legend(fontsize=8, facecolor=PANEL, labelcolor=TX)
        for sp in a.spines.values(): sp.set_color(GC)
        a.grid(True, color=GC, alpha=0.25)
    fig.suptitle("Predicted vs realized TPO profile — sample days (price axis)", color=TX, fontsize=13)
    fig.tight_layout(); fig.savefig("/tmp/w/tpo_samples.png", dpi=110, facecolor=BG); plt.close(fig)

def summary(R, LB, methods, days):
    best = LB["EMD_med(pts)"].idxmin()
    with open("/tmp/w/TPO_FORECAST_SUMMARY.md", "w") as f:
        f.write("# TPO time-profile forecast — prototype results\n\n")
        f.write(f"- Data: {len(days)} RTH sessions, {days[0]} → {days[-1]} (ESU6 5-min)\n")
        f.write(f"- Predict the full-day TPO profile from the Initial Balance (first two 30-min periods)\n")
        f.write(f"- Walk-forward, k-NN k={K}, min history {MIN_HISTORY} days, scored on {len(R)} days\n")
        f.write(f"- Aligned on each day's IB midpoint; scored on a shared ±100pt offset grid\n\n")
        f.write("## Leaderboard\n\n```\n" + LB.to_string() + "\n```\n\n")
        f.write(f"**Best by median EMD: `{best}`.** ")
        f.write("EMD is in ES points — the average 'cost' to slide the predicted profile onto the realized one; "
                "POC error is how far the predicted peak lands from the real peak; VA IoU is value-area overlap.\n\n")
        f.write("## Read\n\n")
        f.write("- If k-NN beats **persist** (yesterday's profile) and **climo** (the average day) on EMD, the IB features carry real shape information.\n")
        f.write("- Persistence is the honest bar: beating it is the whole game. Climatology says how much a day differs from the average day at all.\n")
        f.write("- Next: swap the k-NN pool for GEX/DEX-aware features, add a per-day confidence (neighbour distance), and record live so the sample grows.\n")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/mnt/user-data/uploads/spx-gex-dashboard-tt-fixed/ESU6 - 5 min - RTH.csv")
