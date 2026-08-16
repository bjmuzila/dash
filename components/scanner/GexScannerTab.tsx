"use client";

/**
 * GEX Change Scanner — cross-ticker GEX anomaly leaderboard (stocks).
 *
 * Lived inline in components/pages/Scanner.tsx until 2026-08-16, when the tab
 * moved from /scanner to the Test Lab page (/test?tab=gex). Extracted to its
 * own module rather than imported across the two page files: TestLab importing
 * Scanner (which now imports GexLevelsTab out of TestLab) would be an import
 * cycle AND would fuse both pages' chunks into one.
 *
 * Body unchanged from the original.
 */

import { useCallback, useEffect, useState } from "react";
import { HOME_THEME, classicCardAccentStyle } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import { ScoreInfo } from "@/components/shared/InfoTip";
import ProbeButton from "@/components/scanner/ProbeButton";
import { fmtB, seg, td, th, zColor } from "@/components/scanner/scannerStyles";

// ══════════════════════════════════════════════════════════════════════════════
//  GEX CHANGE SCANNER (original tab)
// ══════════════════════════════════════════════════════════════════════════════

type GexRow = {
  symbol: string;
  expiry: string;
  strike: number;
  latest_chg: number;
  mean_chg: number;
  sd_chg: number;
  n: number;
  z: number | null;
  spot: number;
  otm_dist: number;
  weighted_chg: number;
  pct_open: number | null;
  score?: number;   // combined 0.6·|Δ|+0.4·|%| blend (0..100), from backend when present
};
type Win = 5 | 15 | 30 | 60;
type GexSort = "z" | "abs" | "otm" | "pct" | "score";
type ColSort = { col: "latest_chg" | "mean_chg" | "z" | "otm_dist" | "pct_open" | "score"; dir: "desc" | "asc" } | null;
type GexSignal = "very" | "strong" | "relative" | null;

// Threshold badge (image spec: Strong = big $ Δ, Big relative = big %, Very strong = both).
function SignalBadge({ s }: { s: GexSignal }) {
  if (s === "very")     return <span style={{ color: "#FFD166", fontWeight: 800, fontSize: 14, whiteSpace: "nowrap" }}>★ Very strong</span>;
  if (s === "strong")   return <span style={{ color: HOME_THEME.cyan, fontWeight: 700, fontSize: 14 }}>Strong</span>;
  if (s === "relative") return <span style={{ color: HOME_THEME.orange, fontWeight: 700, fontSize: 14 }}>Big %</span>;
  return <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 14 }}>—</span>;
}

function GexScanner() {
  const [rows, setRows] = useState<GexRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [win, setWin] = useState<Win>(15);
  const [sort, setSort] = useState<GexSort>("abs"); // default: biggest |Δ GEX|
  const [minZ, setMinZ] = useState(0);
  const [colSort, setColSort] = useState<ColSort>(null);
  // Default "build": only strikes whose OWN side is growing (above spot & Δ↑ = call
  // wall building; below spot & Δ↓ = put wall building). A huge Δ↓ above spot is
  // decay, not a signal — it gets excluded.
  const [dir, setDir] = useState<"all" | "pos" | "neg" | "build">("build");
  const [minOtm, setMinOtm] = useState(0.05);   // default: 5%+ OTM
  const [minExpiry, setMinExpiry] = useState("");
  const [maxExpiry, setMaxExpiry] = useState("");
  // Adjustable signal thresholds (user settings, persisted). Image defaults:
  // Strong ≥ $500k Δ, Big-relative ≥ 30% vs open.
  const [minDollar, setMinDollar] = useState<number>(() =>
    typeof window !== "undefined" ? Number(localStorage.getItem("scanner.minDollar")) || 500_000 : 500_000);
  const [minPct, setMinPct] = useState<number>(() =>
    typeof window !== "undefined" ? Number(localStorage.getItem("scanner.minPct")) || 30 : 30);
  useEffect(() => { try { localStorage.setItem("scanner.minDollar", String(minDollar)); } catch {} }, [minDollar]);
  useEffect(() => { try { localStorage.setItem("scanner.minPct", String(minPct)); } catch {} }, [minPct]);

  // Combined score: use backend value when present, else min-max normalize the
  // visible rows and blend 0.6·|Δ| + 0.4·|%| → 0..100 (image spec).
  const maxAbs = Math.max(1, ...rows.map(r => Math.abs(r.latest_chg || 0)));
  const maxPct = Math.max(1, ...rows.map(r => Math.abs(r.pct_open || 0)));
  const scoreOf = (r: GexRow) =>
    r.score != null ? r.score
    : (0.6 * (Math.abs(r.latest_chg || 0) / maxAbs) + 0.4 * (Math.abs(r.pct_open || 0) / maxPct)) * 100;
  const classify = (r: GexRow): GexSignal => {
    const bigAbs = Math.abs(r.latest_chg) >= minDollar;
    const bigPct = r.pct_open != null && Math.abs(r.pct_open) >= minPct;
    return bigAbs && bigPct ? "very" : bigAbs ? "strong" : bigPct ? "relative" : null;
  };

  const toggleColSort = (col: NonNullable<ColSort>["col"]) => {
    setColSort(prev =>
      prev?.col === col
        ? { col, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { col, dir: "desc" }
    );
  };

  const colSortValue = (r: GexRow, col: NonNullable<ColSort>["col"]) => {
    switch (col) {
      case "z": return r.z ?? 0;
      case "latest_chg": return r.latest_chg;
      case "mean_chg": return r.mean_chg;
      case "otm_dist": return r.otm_dist ?? 0;
      case "pct_open": return r.pct_open ?? -Infinity;
      case "score": return scoreOf(r);
    }
  };

  const expiryFilteredRows = rows.filter((r) => {
    if (minExpiry && r.expiry < minExpiry) return false;
    if (maxExpiry && r.expiry > maxExpiry) return false;
    return true;
  });

  // Top 10 cards: always biggest |Δ GEX| in the window, independent of table sort.
  const topBySize = [...expiryFilteredRows]
    .sort((a, b) => Math.abs(b.latest_chg || 0) - Math.abs(a.latest_chg || 0))
    .slice(0, 10);

  const displayRows = colSort
    ? [...expiryFilteredRows].sort((a, b) => {
        const av = colSortValue(a, colSort.col);
        const bv = colSortValue(b, colSort.col);
        return colSort.dir === "desc" ? bv - av : av - bv;
      })
    : sort === "score"
      ? [...expiryFilteredRows].sort((a, b) => scoreOf(b) - scoreOf(a))
      : expiryFilteredRows;

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const u = new URL("/proxy/strike-growth/scanner", window.location.origin);
      u.searchParams.set("window", String(win));
      u.searchParams.set("sort", sort);
      u.searchParams.set("minZ", String(minZ));
      u.searchParams.set("limit", "25");
      if (dir !== "all") u.searchParams.set("dir", dir);
      if (minOtm > 0) u.searchParams.set("minOtm", String(minOtm));
      const res = await fetch(u.toString(), { cache: "no-store" });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Server returned ${res.status} (non-JSON). Recorder may not have run yet.`); }
      if (!j.ok) throw new Error(j.error || "load failed");
      setRows(j.rows || []);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, [win, sort, minZ, dir, minOtm]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => load(), 60_000); return () => clearInterval(t); }, [load]);

  return (
    <Card variant="budget" title={<span style={{ fontSize: 17 }}>GEX Change Scanner</span>}
      subtitle={`Stocks only · biggest ${win}m moves${sort === "z" ? " ranked by anomaly" : sort === "score" ? " ranked by combined score" : " by size"}${dir !== "all" ? ` · ${dir === "pos" ? "above spot · Δ↑" : dir === "neg" ? "below spot · Δ↓" : "building walls only"}` : ""}${minOtm > 0 ? ` · OTM ≥${(minOtm * 100).toFixed(0)}%` : ""}${loading ? " · refreshing…" : ""}`}>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {([5, 15, 30, 60] as Win[]).map((w) => (
            <button key={w} onClick={() => setWin(w)} style={seg(win === w)}>{w}m</button>
          ))}
        </div>
        <span style={{ color: HOME_THEME.border }}>|</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setSort("z")} style={seg(sort === "z")}>Most unusual (z)</button>
          <button onClick={() => setSort("abs")} style={seg(sort === "abs")}>Biggest (size)</button>
          <button onClick={() => setSort("otm")} style={seg(sort === "otm")}>OTM-weighted</button>
          <button onClick={() => setSort("pct")} style={seg(sort === "pct")}>% vs open</button>
          <button onClick={() => setSort("score")} style={seg(sort === "score")}>Best overall</button>
        </div>
        <span style={{ color: HOME_THEME.border }}>|</span>
        <div style={{ display: "flex", gap: 6 }} title="Building = the strike's own side is growing: above spot with rising GEX (call wall building) OR below spot with falling GEX (put wall building). A big Δ↓ above spot is decay, not a signal — excluded.">
          <button onClick={() => setDir("build")} style={{ ...seg(dir === "build"), ...(dir === "build" ? { color: HOME_THEME.green, borderColor: HOME_THEME.green } : {}) }}>Building</button>
          <button onClick={() => setDir("all")} style={seg(dir === "all")}>All</button>
          <button onClick={() => setDir("pos")} style={{ ...seg(dir === "pos"), ...(dir === "pos" ? { color: HOME_THEME.green, borderColor: HOME_THEME.green } : {}) }}>Call wall ↑</button>
          <button onClick={() => setDir("neg")} style={{ ...seg(dir === "neg"), ...(dir === "neg" ? { color: HOME_THEME.red, borderColor: HOME_THEME.red } : {}) }}>Put wall ↑</button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: HOME_THEME.orange }} title="How far OTM the strike must sit vs spot">
          min OTM
          <select value={minOtm} onChange={(e) => setMinOtm(Number(e.target.value))}
            style={{ fontSize: 14, padding: "6px 10px", borderRadius: 6, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text, border: "1px solid rgba(255,255,255,0.15)" }}>
            <option value={0}>any</option>
            <option value={0.02}>2%+</option>
            <option value={0.05}>5%+</option>
            <option value={0.10}>10%+</option>
            <option value={0.15}>15%+</option>
            <option value={0.20}>20%+</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: HOME_THEME.green }}>
          min z
          <select value={minZ} onChange={(e) => setMinZ(Number(e.target.value))}
            style={{ fontSize: 14, padding: "6px 10px", borderRadius: 6, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text, border: "1px solid rgba(255,255,255,0.15)" }}>
            <option value={0}>any</option>
            <option value={1.5}>1.5+</option>
            <option value={2}>2.0+</option>
            <option value={3}>3.0+</option>
          </select>
        </label>
        <span style={{ color: HOME_THEME.border }}>|</span>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: HOME_THEME.cyan }} title="Strong signal: |Δ GEX| at or above this — real money moving">
          strong ≥ $
          <select value={minDollar} onChange={(e) => setMinDollar(Number(e.target.value))}
            style={{ fontSize: 14, padding: "6px 10px", borderRadius: 6, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text, border: "1px solid rgba(255,255,255,0.15)" }}>
            <option value={250_000}>250K</option>
            <option value={500_000}>500K</option>
            <option value={1_000_000}>1M</option>
            <option value={2_000_000}>2M</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: HOME_THEME.orange }} title="Big relative: |% vs open| at or above this — big % jump even on smaller strikes">
          big % ≥
          <select value={minPct} onChange={(e) => setMinPct(Number(e.target.value))}
            style={{ fontSize: 14, padding: "6px 10px", borderRadius: 6, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text, border: "1px solid rgba(255,255,255,0.15)" }}>
            <option value={20}>20%</option>
            <option value={30}>30%</option>
            <option value={50}>50%</option>
            <option value={75}>75%</option>
          </select>
        </label>
        <span style={{ color: HOME_THEME.border }}>|</span>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: HOME_THEME.cyan }}>
          min expiry
          <input type="date" value={minExpiry} onChange={(e) => setMinExpiry(e.target.value)}
            style={{ fontSize: 14, padding: "5px 8px", borderRadius: 6, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text, border: "1px solid rgba(255,255,255,0.15)" }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: HOME_THEME.cyan }}>
          max expiry
          <input type="date" value={maxExpiry} onChange={(e) => setMaxExpiry(e.target.value)}
            style={{ fontSize: 14, padding: "5px 8px", borderRadius: 6, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text, border: "1px solid rgba(255,255,255,0.15)" }} />
        </label>
        {(minExpiry || maxExpiry) && (
          <button onClick={() => { setMinExpiry(""); setMaxExpiry(""); }} style={seg(false)}>Clear</button>
        )}
        <button onClick={() => load()} style={seg(false)}>↻ Refresh</button>
      </div>

      {err && <div style={{ color: HOME_THEME.red, marginBottom: 12 }}>{err}</div>}

      {/* Top 10 by size — biggest |Δ GEX| in the window, always sorted by size regardless of table sort */}
      {!!topBySize.length && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: HOME_THEME.orange, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 10 }}>
            Top 10 · biggest {win}m size
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
            {topBySize.map((r, i) => {
              const up = r.latest_chg >= 0;
              const col = up ? HOME_THEME.green : HOME_THEME.red;
              const sig = classify(r);
              const otmPct = (r.otm_dist ?? 0) * 100;
              return (
                <div
                  key={`card-${r.symbol}-${r.expiry}-${r.strike}`}
                  className="card-hover"
                  style={{
                    ...classicCardAccentStyle,
                    padding: "12px 14px",
                    background: sig === "very" ? "rgba(255,209,102,0.10)" : (classicCardAccentStyle as any).background,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontWeight: 800, fontSize: 17, color: HOME_THEME.text }}>
                      <span style={{ color: "rgba(255,255,255,0.35)", marginRight: 6 }}>{i + 1}</span>{r.symbol}
                    </span>
                    <span style={{ fontSize: 14, color: "rgba(255,255,255,0.6)" }}>{r.strike}</span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: col, lineHeight: 1.2 }}>{fmtB(r.latest_chg)}</div>
                  <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
                    {r.expiry} · spot {r.spot > 0 ? r.spot.toFixed(2) : "—"}
                  </div>
                  <div style={{ display: "flex", gap: 10, fontSize: 14, marginTop: 6, flexWrap: "wrap" }}>
                    <span style={{ color: HOME_THEME.orange }}>OTM {otmPct.toFixed(1)}%</span>
                    <span style={{ color: r.pct_open == null ? "rgba(255,255,255,0.4)" : r.pct_open >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                      {r.pct_open == null ? "—" : `${r.pct_open >= 0 ? "+" : ""}${r.pct_open.toFixed(0)}% vs open`}
                    </span>
                    <span style={{ color: HOME_THEME.cyan, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      score {scoreOf(r).toFixed(0)}
                      <ScoreInfo align={i % 5 >= 3 ? "right" : "left"} />
                    </span>
                  </div>
                  <div style={{ marginTop: 6 }}><SignalBadge s={sig} /></div>
                  {/* Owner-only: record this strike into the watch tracker */}
                  <ProbeButton symbol={r.symbol} expiry={r.expiry} strike={r.strike} spot={r.spot} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 14, textTransform: "uppercase" }}>
              <th style={{ ...th, textAlign: "left" }}>#</th>
              <th style={{ ...th, textAlign: "left" }}>Symbol</th>
              <th style={th}>Spot</th>
              <th style={th}>Strike</th>
              <th style={{ ...th, textAlign: "left" }}>Expiry</th>
              {(["latest_chg", "mean_chg", "z"] as const).map((col, idx) => {
                const label = col === "latest_chg" ? `${win}m Δ` : col === "mean_chg" ? "Avg Δ" : "z-score";
                const active = colSort?.col === col;
                const arrow = active ? (colSort!.dir === "desc" ? " ↓" : " ↑") : " ⇅";
                return (
                  <th key={col} onClick={() => toggleColSort(col)} style={{
                    ...th,
                    cursor: "pointer",
                    color: active ? HOME_THEME.cyan : HOME_THEME.green,
                    userSelect: "none",
                    whiteSpace: "nowrap",
                  }}>
                    {label}<span style={{ opacity: active ? 1 : 0.4, fontSize: 14 }}>{arrow}</span>
                  </th>
                );
              })}
              {([
                { col: "otm_dist" as const, label: "OTM%" },
                { col: "pct_open" as const, label: "%vsOpen" },
                { col: "score" as const, label: "Score" },
              ]).map(({ col, label }) => {
                const active = colSort?.col === col;
                const arrow = active ? (colSort!.dir === "desc" ? " ↓" : " ↑") : " ⇅";
                return (
                  <th key={col} onClick={() => toggleColSort(col)} style={{
                    ...th,
                    cursor: "pointer",
                    color: active ? HOME_THEME.cyan : HOME_THEME.green,
                    userSelect: "none",
                    whiteSpace: "nowrap",
                  }}>
                    {label}<span style={{ opacity: active ? 1 : 0.4, fontSize: 14 }}>{arrow}</span>
                    {col === "score" && <> <ScoreInfo align="right" side="bottom" /></>}
                  </th>
                );
              })}
              <th style={{ ...th, textAlign: "center" }}>Signal</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r, i) => {
              const up = r.latest_chg >= 0;
              const col = up ? HOME_THEME.green : HOME_THEME.red;
              const otmPct = (r.otm_dist ?? 0) * 100;
              const sig = classify(r);
              return (
                <tr key={`${r.symbol}-${r.expiry}-${r.strike}`}
                  style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: sig === "very" ? "rgba(255,209,102,0.10)" : i % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                  <td style={{ ...td, textAlign: "left", color: HOME_THEME.text, fontWeight: 700 }}>{i + 1}</td>
                  <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{r.symbol}</td>
                  <td style={{ ...td, color: "rgba(255,255,255,0.7)" }}>{r.spot > 0 ? r.spot.toFixed(2) : "—"}</td>
                  <td style={td}>{r.strike}</td>
                  <td style={{ ...td, textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 14 }}>{r.expiry}</td>
                  <td style={{ ...td, color: col, fontWeight: 800 }}>{fmtB(r.latest_chg)}</td>
                  <td style={td}>{fmtB(r.mean_chg)}</td>
                  <td style={{ ...td, color: zColor(r.z), fontWeight: 800 }}>
                    {r.z == null ? "—" : `${r.z >= 0 ? "+" : ""}${r.z.toFixed(1)}σ`}
                  </td>
                  <td style={{ ...td, color: otmPct >= 5 ? HOME_THEME.orange : "rgba(255,255,255,0.7)" }}>
                    {otmPct.toFixed(1)}%
                  </td>
                  <td style={{ ...td, color: r.pct_open == null ? "rgba(255,255,255,0.4)" : r.pct_open >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                    {r.pct_open == null ? "—" : `${r.pct_open >= 0 ? "+" : ""}${r.pct_open.toFixed(0)}%`}
                  </td>
                  <td style={{ ...td, color: HOME_THEME.cyan, fontWeight: 800 }}>{scoreOf(r).toFixed(0)}</td>
                  <td style={{ ...td, textAlign: "center" }}><SignalBadge s={sig} /></td>
                </tr>
              );
            })}
            {!rows.length && !loading && (
              <tr><td colSpan={12} style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                No qualifying moves yet. Needs ≥3 snapshots spanning the window — give the recorder ~{win + 10} min of history.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div style={{ marginTop: 14, display: "flex", gap: 20, flexWrap: "wrap", fontSize: 14, color: "rgba(255,255,255,0.4)" }}>
        <span>Score = 0.6·|Δ| + 0.4·|% vs open|, normalized 0–100</span>
        <span><span style={{ color: HOME_THEME.cyan }}>Strong</span> = |Δ| ≥ {fmtB(minDollar).replace("+", "")}</span>
        <span><span style={{ color: HOME_THEME.orange }}>Big %</span> = |% vs open| ≥ {minPct}%</span>
        <span><span style={{ color: "#FFD166" }}>★ Very strong</span> = both (highest conviction)</span>
      </div>
    </Card>
  );
}

export default GexScanner;
