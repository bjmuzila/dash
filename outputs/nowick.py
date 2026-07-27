import pandas as pd, numpy as np, sys, os

TICK = 0.25
HZ = [1, 2, 3, 5]
OUT = "/home/claude/out"
os.makedirs(OUT, exist_ok=True)

def load(path):
    df = pd.read_csv(path, header=None,
                     names=["ts", "o", "h", "l", "c", "v"],
                     dtype={"ts": str})
    dt = pd.to_datetime(df.ts, format="%Y%m%d %H%M%S")
    df["dt"] = dt
    mins = dt.dt.hour * 60 + dt.dt.minute
    # Globex session: 18:00 ET -> 17:00 ET next day
    df["sess"] = (dt.dt.normalize() + pd.to_timedelta((mins >= 1080).astype(int), unit="D"))
    df["off"] = (mins - 1080) % 1440
    return df

def agg(g):
    return pd.Series({"o": g.o.iloc[0], "h": g.h.max(), "l": g.l.min(),
                      "c": g.c.iloc[-1], "v": g.v.sum(), "dt": g.dt.iloc[0]})

def resample(df, tf):
    if tf == "1d":
        keys = [df.sess]
    elif tf == "4h":
        keys = [df.sess, df.off // 240]
    elif tf == "1h":
        keys = [df.sess, df.off // 60]
    gb = df.groupby(keys, sort=True)
    b = pd.DataFrame({
        "o": gb.o.first(), "h": gb.h.max(), "l": gb.l.min(),
        "c": gb.c.last(), "v": gb.v.sum(), "dt": gb.dt.first(),
        "n": gb.c.size(),
    }).reset_index(drop=False)
    b = b.sort_values("dt").reset_index(drop=True)
    b["sess"] = b["sess"] if "sess" in b else pd.NaT
    return b

def tstat(x):
    x = np.asarray(x, float)
    x = x[~np.isnan(x)]
    if len(x) < 2 or x.std(ddof=1) == 0:
        return np.nan
    return x.mean() / (x.std(ddof=1) / np.sqrt(len(x)))

def analyze(bars, tf, sym, rows, sigrows):
    b = bars.copy()
    for col in ["o", "h", "l", "c"]:
        b[col] = (b[col] / TICK).round() * TICK
    b["rng"] = b.h - b.l
    b = b[b.rng > 0].reset_index(drop=True)
    b["body"] = (b.c - b.o).abs() / b.rng
    # ATR(14) on this timeframe, for normalized returns
    tr = pd.concat([b.h - b.l, (b.h - b.c.shift()).abs(), (b.l - b.c.shift()).abs()], axis=1).max(axis=1)
    b["atr"] = tr.rolling(14).mean()

    for k in HZ:
        b[f"f{k}"] = b.c.shift(-k) - b.c
    b["mfe1"] = b.h.shift(-1) - b.c
    b["mae1"] = b.l.shift(-1) - b.c

    sigs = {"bull (close==high)": (b.c == b.h) & (b.c > b.o),
            "bear (close==low)":  (b.c == b.l) & (b.c < b.o)}

    total = len(b)
    # ---- unconditional baseline, direction-signed by prior candle dir ----
    for name, mask in sigs.items():
        d = 1 if name.startswith("bull") else -1
        s = b[mask]
        base = b
        rec = {"sym": sym, "tf": tf, "signal": name, "n": len(s),
               "base_rate_pct": round(100 * len(s) / total, 3), "universe": total}
        for k in HZ:
            r = d * s[f"f{k}"].dropna()
            rb = d * base[f"f{k}"].dropna()
            rec[f"h{k}_mean_pt"] = round(r.mean(), 3) if len(r) else np.nan
            rec[f"h{k}_med_pt"] = round(r.median(), 3) if len(r) else np.nan
            rec[f"h{k}_sd"] = round(r.std(ddof=1), 2) if len(r) > 1 else np.nan
            rec[f"h{k}_win_pct"] = round(100 * (r > 0).mean(), 1) if len(r) else np.nan
            rec[f"h{k}_t"] = round(tstat(r), 2) if len(r) else np.nan
            rec[f"h{k}_base_mean_pt"] = round(rb.mean(), 3)
            rec[f"h{k}_base_win_pct"] = round(100 * (rb > 0).mean(), 1)
            rec[f"h{k}_edge_pt"] = round(r.mean() - rb.mean(), 3) if len(r) else np.nan
        mfe = d * s["mfe1"] if d == 1 else -(s["mae1"])
        mae = d * s["mae1"] if d == 1 else -(s["mfe1"])
        rec["mfe1_mean_pt"] = round(mfe.mean(), 2) if len(s) else np.nan
        rec["mae1_mean_pt"] = round(mae.mean(), 2) if len(s) else np.nan
        # body terciles
        if len(s) >= 30:
            try:
                q = pd.qcut(s.body.rank(method="first"), 3, labels=["lo", "mid", "hi"])
                for lab, grp in s.groupby(q, observed=True):
                    rec[f"body_{lab}_h1_mean_pt"] = round((d * grp.f1).mean(), 3)
            except ValueError:
                pass
        rows.append(rec)

        sr = s.copy()
        sr["sym"], sr["tf"], sr["signal"] = sym, tf, name
        sigrows.append(sr[["sym", "tf", "signal", "dt", "o", "h", "l", "c", "body", "atr"] + [f"f{k}" for k in HZ]])
    return b

def main():
    files = {"ES": "/mnt/user-data/uploads/Downloads/ESU6 - 1 min - ETH.csv",
             "NQ": "/mnt/user-data/uploads/Downloads/NQU6 - 1 min - ETH.csv"}
    rows, sigrows, yearly, hourly = [], [], [], []
    for sym, path in files.items():
        df = load(path)
        print(f"{sym}: {len(df):,} 1-min bars  {df.dt.min()} -> {df.dt.max()}", flush=True)
        for tf in ["1h", "4h", "1d"]:
            bars = resample(df, tf)
            b = analyze(bars, tf, sym, rows, sigrows)
            print(f"  {sym} {tf}: {len(b):,} bars", flush=True)
            bull = (b.c == b.h) & (b.c > b.o)
            bear = (b.c == b.l) & (b.c < b.o)
            yr = pd.DataFrame({"year": b.dt.dt.year, "bull": bull, "bear": bear, "all": 1})
            g = yr.groupby("year").sum().reset_index()
            g["sym"], g["tf"] = sym, tf
            yearly.append(g)
            if tf == "1h":
                hr = pd.DataFrame({"hour": b.dt.dt.hour, "bull": bull, "bear": bear, "all": 1})
                gh = hr.groupby("hour").sum().reset_index()
                gh["sym"] = sym
                hourly.append(gh)

    summ = pd.DataFrame(rows)
    summ.to_csv(f"{OUT}/nowick_summary.csv", index=False)
    pd.concat(sigrows).to_csv(f"{OUT}/nowick_signals.csv", index=False)
    pd.concat(yearly).to_csv(f"{OUT}/nowick_by_year.csv", index=False)
    pd.concat(hourly).to_csv(f"{OUT}/nowick_by_hour.csv", index=False)
    pd.set_option("display.width", 250, "display.max_columns", 100)
    print("\n=== SUMMARY ===")
    cols = ["sym", "tf", "signal", "n", "base_rate_pct"] + \
           [f"h{k}_{s}" for k in HZ for s in ["mean_pt", "win_pct", "t", "base_mean_pt", "base_win_pct", "edge_pt"]]
    print(summ[cols].to_string(index=False))
    print("\n=== MFE/MAE next bar ===")
    print(summ[["sym", "tf", "signal", "n", "mfe1_mean_pt", "mae1_mean_pt"]].to_string(index=False))
    bc = [c for c in summ.columns if c.startswith("body_")]
    if bc:
        print("\n=== body tercile -> next-bar mean (pts) ===")
        print(summ[["sym", "tf", "signal"] + bc].to_string(index=False))
    for tf in ["1h", "4h", "1d"]:
        for sym in files:
            sub = summ[(summ.tf == tf) & (summ.sym == sym)]
            for _, r in sub.iterrows():
                if r["n"] < 30:
                    print(f"!! LOW SAMPLE: {sym} {tf} {r['signal']} n={r['n']}")

main()
