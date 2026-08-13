"use client";

/**
 * /scanner — three-tab scanner:
 *   GEX Change Scanner  — cross-ticker GEX anomaly leaderboard (stocks)
 *   Greeks Sensitivity  — per-strike Charm / Vanna / Gamma / TG-Imbalance for SPX
 *   Vol Pin             — IV-RV spread contraction + price range tightening → pin candidates
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HOME_THEME, LIGHT_BLUE, classicCardAccentStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";
import { ScoreInfo } from "@/components/shared/InfoTip";
import { useEsCandles, type EsCandle } from "@/hooks/useEsCandles";
import { useNqCandles } from "@/hooks/useNqCandles";
import { buildTpoStructures, baseRateFor, ageBucket, KIND_LABEL, KIND_TITLE, KIND_NOTE, KIND_MEANING, type StructureKind, type TpoStructure, type TpoSession } from "@/lib/tpo";
import { amtRead, type AmtRead, type AmtSignal, type SignalLevel } from "@/lib/amt";
import IbStatsTab from "@/components/scanner/IbStatsTab";
import ProbeButton from "@/components/scanner/ProbeButton";
import StatPrompterTab from "@/components/scanner/StatPrompterTab";
import TpoForecastCard from "@/components/scanner/TpoForecastCard";
import TpoForwardMap from "@/components/scanner/TpoForwardMap";
import TpoOpenLocation from "@/components/scanner/TpoOpenLocation";
import GexChangeTop from "@/components/scanner/GexChangeTop";
import GexPctTab from "@/components/scanner/GexPctTab";
import { readTabFromUrl, SCANNER_TAB_EVENT } from "@/components/scanner/scannerNav";

// ── shared types / helpers ────────────────────────────────────────────────────

const NEUTRAL = "#6B7280";

const fmtB = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? "-" : "+";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(0)}`;
};

const fmtInt = (n: number) => Math.round(n).toLocaleString();
const fmtChg = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()}`;

// ── style helpers ─────────────────────────────────────────────────────────────

const th: React.CSSProperties = { padding: "6px 10px", textAlign: "right", fontWeight: 700, letterSpacing: "0.05em" };
const td: React.CSSProperties = { padding: "6px 10px", textAlign: "right", color: HOME_THEME.text };

const seg = (active: boolean): React.CSSProperties => ({
  padding: "6px 14px", borderRadius: 8, fontSize: 14, cursor: "pointer", fontWeight: 700,
  border: `1px solid ${active ? HOME_THEME.cyan : "rgba(255,255,255,0.15)"}`,
  background: active ? "rgba(33,158,188,0.15)" : "transparent",
  color: active ? HOME_THEME.text : "rgba(255,255,255,0.7)",
});

const zColor = (z: number | null) =>
  z == null ? "rgba(255,255,255,0.4)"
  : Math.abs(z) >= 3 ? HOME_THEME.red
  : Math.abs(z) >= 2 ? HOME_THEME.orange
  : HOME_THEME.text;

// ── top-level tab ─────────────────────────────────────────────────────────────

type MainTab = "gex" | "strike" | "watch" | "marketquality" | "tpo" | "ibstats" | "statprompter" | "gexchangetop" | "gexpct";

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

// ══════════════════════════════════════════════════════════════════════════════
//  GREEKS SENSITIVITY SCANNER (new tab)
// ══════════════════════════════════════════════════════════════════════════════

type GreekMode = "charm" | "vanna" | "gamma" | "tg";

type GreekRow = {
  symbol: string;
  expiry: string;
  strike: number;
  latest_chg: number;
  mean_chg: number;
  sd_chg: number;
  n: number;
  z_score: number | null;
  charm_now: number;
  vanna_now: number;
  gamma_now: number;
  delta_now: number;
  spot_now: number;
  tg_score: number;
};

const MODE_META: Record<GreekMode, { label: string; accent: string; colLabel: string; subtitle: string }> = {
  charm: {
    label: "Charm (CHEX)",
    accent: HOME_THEME.cyan,
    colLabel: "Charm Δ",
    subtitle: "Delta decay momentum — strikes bleeding delta the fastest. High near 0DTE.",
  },
  vanna: {
    label: "Vanna (VEX)",
    accent: HOME_THEME.purple,
    colLabel: "Vanna Δ",
    subtitle: "Delta sensitivity to IV — ranks strikes most exposed to vol-driven delta shifts.",
  },
  gamma: {
    label: "Gamma Accel",
    accent: HOME_THEME.orange,
    colLabel: "GEX Δ",
    subtitle: "Gamma momentum — strikes with accelerating gamma build near key walls / flip zones.",
  },
  tg: {
    label: "TG Imbalance",
    accent: HOME_THEME.green,
    colLabel: "TG Score",
    subtitle: "Theta-Gamma imbalance — high |charm| × |GEX| composite: potential pin risk or explosive move zones.",
  },
};

function GreeksScanner() {
  const [rows, setRows]     = useState<GreekRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState<string | null>(null);
  const [win, setWin]       = useState<Win>(15);
  const [mode, setMode]     = useState<GreekMode>("charm");

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const u = new URL("/proxy/greek-scanner", window.location.origin);
      u.searchParams.set("window", String(win));
      u.searchParams.set("mode", mode);
      u.searchParams.set("limit", "25");
      const res = await fetch(u.toString(), { cache: "no-store" });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Server returned ${res.status} (non-JSON).`); }
      if (!j.ok) throw new Error(j.error || "load failed");
      setRows(j.rows || []);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, [win, mode]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => load(), 60_000); return () => clearInterval(t); }, [load]);

  const meta = MODE_META[mode];

  // For TG mode, show tg_score; otherwise show the metric change + z-score.
  const isTg = mode === "tg";

  return (
    <Card variant="budget" title={<span style={{ fontSize: 17 }}>Greeks Sensitivity Scanner</span>}
      subtitle={`SPX · ${meta.label} · ${win}m window${loading ? " · refreshing…" : ""}`}>

      {/* Mode selector */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        {(Object.keys(MODE_META) as GreekMode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)} style={{
            ...seg(mode === m),
            border: `1px solid ${mode === m ? MODE_META[m].accent : "rgba(255,255,255,0.15)"}`,
            background: mode === m ? `${MODE_META[m].accent}22` : "transparent",
            color: mode === m ? HOME_THEME.text : "rgba(255,255,255,0.7)",
          }}>{MODE_META[m].label}</button>
        ))}
      </div>

      {/* Window + refresh */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        {([15, 30, 60] as Win[]).map((w) => (
          <button key={w} onClick={() => setWin(w)} style={seg(win === w)}>{w}m</button>
        ))}
        <button onClick={() => load()} style={{ ...seg(false), marginLeft: 4 }}>↻</button>
        <span style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", marginLeft: 8 }}>{meta.subtitle}</span>
      </div>

      {err && (
        <div style={{ color: HOME_THEME.orange, marginBottom: 12, fontSize: 14 }}>
          {err.includes('no DB') || err.includes('503')
            ? "Recorder hasn't started yet — data appears after the first 5-min RTH snapshot."
            : err}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 14, textTransform: "uppercase" }}>
              <th style={{ ...th, textAlign: "left" }}>#</th>
              <th style={th}>Spot</th>
              <th style={th}>Strike</th>
              <th style={{ ...th, textAlign: "left" }}>Expiry</th>
              <th style={th}>{meta.colLabel}</th>
              {!isTg && <th style={th}>Avg Δ</th>}
              {!isTg && <th style={th}>z-score</th>}
              {isTg  && <th style={th}>|Charm|</th>}
              {isTg  && <th style={th}>|GEX|</th>}
              <th style={th}>Delta</th>
              <th style={th}>GEX now</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const chg    = isTg ? r.tg_score : r.latest_chg;
              const up     = chg >= 0;
              const chgCol = up ? HOME_THEME.green : HOME_THEME.red;
              const key    = `${r.symbol}-${r.expiry}-${r.strike}`;

              // Highlight strikes near spot (within 2%)
              const nearSpot = r.spot_now > 0 && Math.abs(r.strike - r.spot_now) / r.spot_now < 0.02;

              return (
                <tr key={key} style={{
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  background: nearSpot
                    ? `${meta.accent}18`
                    : i % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                }}>
                  <td style={{ ...td, textAlign: "left", color: HOME_THEME.text, fontWeight: 700 }}>
                    {i + 1}{nearSpot ? " ◆" : ""}
                  </td>
                  <td style={{ ...td, color: "rgba(255,255,255,0.7)" }}>{r.spot_now > 0 ? r.spot_now.toFixed(2) : "—"}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{r.strike}</td>
                  <td style={{ ...td, textAlign: "left", color: "rgba(255,255,255,0.6)", fontSize: 14 }}>{r.expiry}</td>
                  <td style={{ ...td, color: chgCol, fontWeight: 800 }}>{fmtB(chg)}</td>
                  {!isTg && <td style={td}>{fmtB(r.mean_chg)}</td>}
                  {!isTg && (
                    <td style={{ ...td, color: zColor(r.z_score), fontWeight: 800 }}>
                      {r.z_score == null ? "—" : `${r.z_score >= 0 ? "+" : ""}${r.z_score.toFixed(1)}σ`}
                    </td>
                  )}
                  {isTg && <td style={{ ...td, color: HOME_THEME.cyan }}>{fmtB(Math.abs(r.charm_now))}</td>}
                  {isTg && <td style={{ ...td, color: HOME_THEME.orange }}>{fmtB(Math.abs(r.gamma_now))}</td>}
                  <td style={{ ...td, color: Math.abs(r.delta_now) < 1e6 ? HOME_THEME.green : "rgba(255,255,255,0.5)" }}>
                    {fmtB(r.delta_now)}
                  </td>
                  <td style={td}>{fmtB(r.gamma_now)}</td>
                </tr>
              );
            })}
            {!rows.length && !loading && !err && (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                No data yet. The recorder runs every 5 min during RTH — needs ≥2 snapshots spanning {win}m.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div style={{ marginTop: 14, display: "flex", gap: 20, flexWrap: "wrap", fontSize: 14, color: "rgba(255,255,255,0.4)" }}>
        <span>◆ near spot (&lt;2%)</span>
        {!isTg && <span>z ≥ 2σ = <span style={{ color: HOME_THEME.orange }}>unusual</span></span>}
        {!isTg && <span>z ≥ 3σ = <span style={{ color: HOME_THEME.red }}>extreme</span></span>}
        {isTg  && <span>TG Score = |charm| × |GEX| / max(|delta|, 1M)</span>}
        <span>OI+Vol basis (canonical)</span>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  VOL PIN SCANNER (new tab)
// ══════════════════════════════════════════════════════════════════════════════

type PinRow = {
  symbol: string;
  expiry: string;
  spot: number;
  atm_strike: number;
  atm_iv: number;
  atm_call_iv: number;
  atm_put_iv: number;
  pin_strike: number | null;
  pin_strike_oi: number | null;
  day_hi: number;
  day_lo: number;
  range_pct: number;
  rv_ann: number | null;
  iv_rv_spread: number | null;
  n_snaps: number;
  spread_delta: number | null;  // negative = contracting (IV-RV closing)
  range_delta: number | null;   // negative = contracting (price range tightening)
  pin_dist_pct: number | null;
  pin_score: number;
};

function fmtPct(v: number | null, decimals = 1) {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(decimals)}%`;
}

// 0 = PINNING, 1 = SQUEEZING, 2 = WATCHING, 3 = none. Lower = higher priority.
function pinStatusRank(r: PinRow): number {
  const spreadContracting = (r.spread_delta ?? 0) < -0.005;
  const rangeContracting  = (r.range_delta ?? 0) < -0.001;
  const nearPin = r.pin_dist_pct != null && r.pin_dist_pct < 0.005;
  if (spreadContracting && rangeContracting && nearPin) return 0;
  if (spreadContracting && rangeContracting) return 1;
  if (spreadContracting || rangeContracting) return 2;
  return 3;
}

function SortTh({ label, col, sortKey, sortDir, onSort, align = "right" }: {
  label: string; col: PinSortKey; sortKey: PinSortKey; sortDir: "asc" | "desc";
  onSort: (col: PinSortKey) => void; align?: "left" | "right" | "center";
}) {
  const active = sortKey === col;
  return (
    <th
      style={{ ...th, textAlign: align, cursor: "pointer", userSelect: "none", color: active ? HOME_THEME.text : th.color }}
      onClick={() => onSort(col)}
      title="Click to sort"
    >
      {label}{active ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );
}

function PinStatus({ r }: { r: PinRow }) {
  const rank = pinStatusRank(r);
  if (rank === 0) return <span style={{ color: HOME_THEME.red, fontWeight: 800, fontSize: 14 }}>PINNING</span>;
  if (rank === 1) return <span style={{ color: HOME_THEME.orange, fontWeight: 700, fontSize: 14 }}>SQUEEZING</span>;
  if (rank === 2) return <span style={{ color: HOME_THEME.cyan, fontWeight: 600, fontSize: 14 }}>WATCHING</span>;
  return <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 14 }}>—</span>;
}

type PinSortKey = "symbol" | "spot" | "dist" | "pinOi" | "atmIv" | "rv" | "ivRv"
  | "spreadTrend" | "range" | "rangeTrend" | "status";

function pinSortValue(r: PinRow, key: PinSortKey): number | string {
  switch (key) {
    case "symbol":      return r.symbol;
    case "spot":        return r.spot;
    case "dist":        return r.pin_dist_pct ?? Infinity;
    case "pinOi":       return r.pin_strike_oi ?? -Infinity;
    case "atmIv":       return r.atm_iv ?? -Infinity;
    case "rv":          return r.rv_ann ?? -Infinity;
    case "ivRv":        return r.iv_rv_spread ?? -Infinity;
    case "spreadTrend": return r.spread_delta ?? Infinity; // most negative (most contracting) sorts first asc
    case "range":       return r.range_pct ?? -Infinity;
    case "rangeTrend":  return r.range_delta ?? Infinity;
    case "status":      return pinStatusRank(r);
  }
}

type PinEvent = {
  date: string;
  symbol: string;
  status: "PINNING" | "SQUEEZING";
  ts: string;
  spot: number | null;
  pin_strike: number | null;
  pin_dist_pct: number | null;
  iv_rv_spread: number | null;
  spread_delta: number | null;
  range_pct: number | null;
  range_delta: number | null;
};

function PinEventLog() {
  const [events, setEvents]   = useState<PinEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const u = new URL("/proxy/vol-pin-events", window.location.origin);
      u.searchParams.set("days", "14");
      u.searchParams.set("limit", "200");
      const res  = await fetch(u.toString(), { cache: "no-store" });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Server returned ${res.status} (non-JSON).`); }
      if (!j.ok) throw new Error(j.error || "load failed");
      setEvents(j.rows || []);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => load(), 90_000); return () => clearInterval(t); }, [load]);

  return (
    <Card variant="budget" title={<span style={{ fontSize: 17 }}>Pin / Squeeze Event Log</span>}
      subtitle={`First occurrence per symbol/day/status · last 14 days${loading ? " · refreshing…" : ""}`}>

      {err && (
        <div style={{ color: HOME_THEME.orange, marginBottom: 12, fontSize: 14 }}>
          {err.includes('503') || err.includes('no DB')
            ? "Recorder not yet active — events appear after the first PINNING/SQUEEZING sweep."
            : err}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 14, textTransform: "uppercase" }}>
              <th style={{ ...th, textAlign: "left" }}>Date</th>
              <th style={{ ...th, textAlign: "left" }}>Time (ET)</th>
              <th style={{ ...th, textAlign: "left" }}>Symbol</th>
              <th style={{ ...th, textAlign: "center" }}>Status</th>
              <th style={th}>Spot</th>
              <th style={th}>Pin Strike</th>
              <th style={th}>Dist</th>
              <th style={th}>IV−RV%</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={`${e.date}-${e.symbol}-${e.status}`}
                style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <td style={{ ...td, textAlign: "left" }}>{e.date}</td>
                <td style={{ ...td, textAlign: "left" }}>
                  {new Date(e.ts).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td style={{ ...td, textAlign: "left", fontWeight: 800 }}>{e.symbol}</td>
                <td style={{
                  ...td, textAlign: "center", fontWeight: 800,
                  color: e.status === "PINNING" ? HOME_THEME.red : HOME_THEME.orange,
                }}>
                  {e.status}
                </td>
                <td style={td}>{e.spot != null ? e.spot.toFixed(2) : "—"}</td>
                <td style={{ ...td, color: HOME_THEME.cyan, fontWeight: 700 }}>
                  {e.pin_strike != null ? e.pin_strike : "—"}
                </td>
                <td style={td}>{e.pin_dist_pct != null ? fmtPct(e.pin_dist_pct, 2) : "—"}</td>
                <td style={td}>{fmtPct(e.iv_rv_spread)}</td>
              </tr>
            ))}
            {!events.length && !loading && !err && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                No pin/squeeze events logged yet in the last 14 days.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function VolPinScanner() {
  const [rows, setRows]       = useState<PinRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);
  const [minSnaps, setMinSnaps] = useState(3);
  const [sortKey, setSortKey] = useState<PinSortKey>("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = useCallback((key: PinSortKey) => {
    setSortKey(prevKey => {
      if (prevKey === key) { setSortDir(d => (d === "asc" ? "desc" : "asc")); return key; }
      setSortDir("asc");
      return key;
    });
  }, []);

  const sortedRows = useMemo(() => {
    const arr = rows.slice();
    arr.sort((a, b) => {
      const av = pinSortValue(a, sortKey), bv = pinSortValue(b, sortKey);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const u = new URL("/proxy/vol-pin-scanner", window.location.origin);
      u.searchParams.set("limit", "30");
      u.searchParams.set("minSnapshots", String(minSnaps));
      const res  = await fetch(u.toString(), { cache: "no-store" });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Server returned ${res.status} (non-JSON).`); }
      if (!j.ok) throw new Error(j.error || "load failed");
      setRows(j.rows || []);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, [minSnaps]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => load(), 90_000); return () => clearInterval(t); }, [load]);

  return (
    <>
    <Card variant="budget" title={<span style={{ fontSize: 17 }}>Volatility Pin Scanner</span>}
      subtitle={`Stocks · IV-RV spread + range contraction → pin candidates${loading ? " · refreshing…" : ""}`}>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: HOME_THEME.green }}>
          min snapshots
          <select value={minSnaps} onChange={(e) => setMinSnaps(Number(e.target.value))}
            style={{ fontSize: 14, padding: "6px 10px", borderRadius: 6, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text, border: "1px solid rgba(255,255,255,0.15)" }}>
            <option value={2}>2 (early)</option>
            <option value={3}>3 (15 min)</option>
            <option value={6}>6 (30 min)</option>
            <option value={12}>12 (60 min)</option>
          </select>
        </label>
        <button onClick={() => load()} style={seg(false)}>↻ Refresh</button>
        <span style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", marginLeft: 4 }}>
          Refreshes every 90s · recorder runs every 5m during RTH
        </span>
      </div>

      {err && (
        <div style={{ color: HOME_THEME.orange, marginBottom: 12, fontSize: 14 }}>
          {err.includes('503') || err.includes('no DB')
            ? "Recorder not yet active — data appears after first RTH sweep."
            : err}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 14, textTransform: "uppercase" }}>
              <th style={{ ...th, textAlign: "left" }}>#</th>
              <SortTh label="Symbol" col="symbol" align="left" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Spot" col="spot" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <th style={th}>Pin Strike</th>
              <SortTh label="Dist" col="dist" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Pin OI" col="pinOi" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="ATM IV" col="atmIv" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="RV" col="rv" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="IV−RV%" col="ivRv" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Spread Trend" col="spreadTrend" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Range" col="range" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Range Trend" col="rangeTrend" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Status" col="status" align="center" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r, i) => {
              const spreadContracting = (r.spread_delta ?? 0) < 0;
              const rangeContracting  = (r.range_delta ?? 0) < 0;
              const isPin = spreadContracting && rangeContracting && r.pin_dist_pct != null && r.pin_dist_pct < 0.005;
              const rowBg = isPin
                ? `${HOME_THEME.red}12`
                : i % 2 ? "rgba(255,255,255,0.02)" : "transparent";

              return (
                <tr key={r.symbol} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: rowBg }}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 700, color: HOME_THEME.text }}>{i + 1}</td>
                  <td style={{ ...td, textAlign: "left", fontWeight: 800 }}>{r.symbol}</td>
                  <td style={td}>{r.spot.toFixed(2)}</td>
                  <td style={{ ...td, color: HOME_THEME.cyan, fontWeight: 700 }}>
                    {r.pin_strike != null ? r.pin_strike : "—"}
                  </td>
                  <td style={{ ...td, color: r.pin_dist_pct != null && r.pin_dist_pct < 0.005 ? HOME_THEME.red : HOME_THEME.text }}>
                    {r.pin_dist_pct != null ? fmtPct(r.pin_dist_pct, 2) : "—"}
                  </td>
                  <td style={{ ...td, color: "rgba(255,255,255,0.6)" }}>
                    {r.pin_strike_oi != null ? (r.pin_strike_oi / 1000).toFixed(0) + "K" : "—"}
                  </td>
                  <td style={{ ...td, color: HOME_THEME.orange }}>{fmtPct(r.atm_iv)}</td>
                  <td style={td}>{r.rv_ann != null ? fmtPct(r.rv_ann) : "—"}</td>
                  <td style={{ ...td, color: r.iv_rv_spread != null && r.iv_rv_spread > 0.3 ? HOME_THEME.green : HOME_THEME.text }}>
                    {fmtPct(r.iv_rv_spread)}
                  </td>
                  {/* Spread trend: negative = contracting = good for pin */}
                  <td style={{ ...td, color: spreadContracting ? HOME_THEME.green : HOME_THEME.red }}>
                    {r.spread_delta != null
                      ? `${spreadContracting ? "↓" : "↑"} ${fmtPct(Math.abs(r.spread_delta), 2)}`
                      : "—"}
                  </td>
                  <td style={td}>{fmtPct(r.range_pct, 2)}</td>
                  {/* Range trend: negative = tightening = good for pin */}
                  <td style={{ ...td, color: rangeContracting ? HOME_THEME.green : HOME_THEME.red }}>
                    {r.range_delta != null
                      ? `${rangeContracting ? "↓" : "↑"} ${fmtPct(Math.abs(r.range_delta), 2)}`
                      : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}><PinStatus r={r} /></td>
                </tr>
              );
            })}
            {!rows.length && !loading && !err && (
              <tr><td colSpan={13} style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                No data yet. Needs {minSnaps} snapshots per ticker (each 5 min apart during RTH).
                Give the recorder ~{minSnaps * 5} min after market open.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div style={{ marginTop: 14, display: "flex", gap: 20, flexWrap: "wrap", fontSize: 14, color: "rgba(255,255,255,0.4)" }}>
        <span><span style={{ color: HOME_THEME.red }}>PINNING</span> = spread ↓ + range ↓ + within 0.5% of pin strike</span>
        <span><span style={{ color: HOME_THEME.orange }}>SQUEEZING</span> = spread ↓ + range ↓</span>
        <span>Pin strike = highest OI within ±10% of spot (front expiry)</span>
        <span>RV = annualized from 5-min spot log-returns</span>
        <span>Spread Trend = IV-RV% change since session start (↓ = compressing)</span>
      </div>
    </Card>

    <div style={{ marginTop: 16 }}>
      <PinEventLog />
    </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  STRIKE QUERY SCANNER (new tab) — top movers by strike, per-ticker or ALL
// ══════════════════════════════════════════════════════════════════════════════

const SQ_FALLBACK = ["SPX", "SPY", "QQQ", "NVDA", "AAPL", "TSLA", "AMZN", "META", "MSFT", "GOOGL"];

type SqRow = {
  symbol: string;
  expiry: string;
  strike: number;
  gex_now: number;
  delta_abs: number;
  chg15: number | null;
  chg30: number | null;
  chg60: number | null;
  spot?: number | null;
};

type SqCol = "strike" | "gex_now" | "chg15" | "chg30" | "chg60" | "delta_abs";

const sqVal = (r: SqRow, c: SqCol): number => {
  const v = c === "strike" ? r.strike : r[c];
  return v == null ? 0 : Number(v);
};

function StrikeQueryScanner() {
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [symbol, setSymbol] = useState("ALL");
  const [expiry, setExpiry] = useState("ALL");
  const [expiries, setExpiries] = useState<string[]>([]);
  const [rows, setRows] = useState<SqRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [limit, setLimit] = useState(25);
  const [colSort, setColSort] = useState<{ col: SqCol; dir: "desc" | "asc" }>({ col: "gex_now", dir: "desc" });
  const [cardScope, setCardScope] = useState<"all" | "exidx">("all");
  const [dir, setDir] = useState<"all" | "pos" | "neg">("all");
  const [minOtm, setMinOtm] = useState(0);   // how far OTM the strike must sit vs spot (0 = any)

  const symbolList = watchlist.length > 0 ? watchlist : SQ_FALLBACK;

  const refreshWatchlist = useCallback(() => {
    return fetch("/proxy/strike-growth/watchlist")
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        const active: string[] = d.rows.filter((r: { active: boolean }) => r.active).map((r: { symbol: string }) => r.symbol).sort();
        if (active.length > 0) setWatchlist(active);
      })
      .catch(() => {});
  }, []);

  const toggleSort = (col: SqCol) =>
    setColSort((p) => (p.col === col ? { col, dir: p.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }));

  // watchlist once
  useEffect(() => { void refreshWatchlist(); }, [refreshWatchlist]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const targets = symbol === "ALL" ? symbolList : [symbol];
      const results = await Promise.all(
        targets.map(async (sym) => {
          try {
            const res = await fetch(`/proxy/strike-growth/by-expiry?symbol=${sym}`, { cache: "no-store" });
            const j = await res.json();
            if (!j.ok) return [] as SqRow[];
            return (j.rows as SqRow[]).map((r) => ({ ...r, symbol: sym }));
          } catch { return [] as SqRow[]; }
        })
      );
      const all = results.flat();
      setRows(all);
      const exps = [...new Set<string>(all.map((r) => r.expiry))].sort();
      setExpiries(exps);
      setExpiry((prev) => (prev === "ALL" || exps.includes(prev) ? prev : "ALL"));
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, watchlist.length]);

  useEffect(() => { load(); }, [load]);

  const INDICES = new Set(["SPX", "SPY", "QQQ", "IWM", "NDX"]);

  const otmDist = (r: SqRow) => (r.spot && r.spot > 0 ? Math.abs(r.strike - r.spot) / r.spot : 0);

  // Direction filter combining side + growth (sign of the active sort metric):
  //   Positive = strike above spot AND metric rising · Negative = below spot AND metric falling.
  const dirPass = (r: SqRow) => {
    if (!r.spot || r.spot <= 0) return false;
    const v = sqVal(r, colSort.col);
    return dir === "pos" ? (r.strike > r.spot && v > 0) : (r.strike < r.spot && v < 0);
  };

  const displayRows = (() => {
    let f = expiry === "ALL" ? rows : rows.filter((r) => r.expiry === expiry);
    if (cardScope === "exidx") f = f.filter((r) => !INDICES.has(r.symbol));
    if (minOtm > 0) f = f.filter((r) => otmDist(r) >= minOtm);
    if (dir !== "all") f = f.filter(dirPass);
    f = [...f].sort((a, b) => {
      const av = sqVal(a, colSort.col), bv = sqVal(b, colSort.col);
      const cmp = colSort.col === "strike" ? bv - av : Math.abs(bv) - Math.abs(av);
      return colSort.dir === "desc" ? cmp : -cmp;
    });
    return f.slice(0, limit);
  })();

  const showSymbol = symbol === "ALL";
  const showExpiry = expiry === "ALL";

  // Top 10 cards across all rows — ranked by active sort metric, SPX capped at 1 slot.
  const topCards = (() => {
    let base = expiry === "ALL" ? rows : rows.filter((r) => r.expiry === expiry);
    if (cardScope === "exidx") base = base.filter((r) => !INDICES.has(r.symbol));
    if (minOtm > 0) base = base.filter((r) => otmDist(r) >= minOtm);
    if (dir !== "all") base = base.filter(dirPass);
    const ranked = [...base].sort((a, b) => {
      const av = sqVal(a, colSort.col), bv = sqVal(b, colSort.col);
      return colSort.col === "strike" ? bv - av : Math.abs(bv) - Math.abs(av);
    });
    const CAP_ONE = new Set(["SPX", "SPY", "QQQ"]);
    const used = new Set<string>();
    const out: SqRow[] = [];
    for (const r of ranked) {
      if (CAP_ONE.has(r.symbol)) { if (used.has(r.symbol)) continue; used.add(r.symbol); }
      out.push(r);
      if (out.length === 10) break;
    }
    return out;
  })();

  const cols: { key: SqCol; label: string }[] = [
    { key: "strike", label: "Strike" },
    { key: "gex_now", label: "GEX Now" },
    { key: "chg15", label: "Δ 15m" },
    { key: "chg30", label: "Δ 30m" },
    { key: "chg60", label: "Δ 60m" },
    { key: "delta_abs", label: "Delta Abs" },
  ];

  const lbl: React.CSSProperties = {
    fontSize: 14, color: HOME_THEME.green, textTransform: "uppercase", letterSpacing: "0.05em",
  };

  return (
    <Card variant="budget" title={<span style={{ fontSize: 17 }}>Strike GEX Query</span>}
      subtitle={`Top movers by strike · ${symbol === "ALL" ? "all watched tickers" : symbol}${dir !== "all" ? ` · ${dir === "pos" ? "above spot · Δ↑" : "below spot · Δ↓"}` : ""}${minOtm > 0 ? ` · OTM ≥${(minOtm * 100).toFixed(0)}%` : ""}${loading ? " · loading…" : ""}`}>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={lbl}>Ticker</span>
          <ThemedSelect ariaLabel="Ticker" width={130} value={symbol} onChange={setSymbol}
            options={[{ value: "ALL", label: "ALL" }, ...symbolList.map((s) => ({ value: s, label: s }))]} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={lbl}>Expiry</span>
          <ThemedSelect ariaLabel="Expiry" width={150} value={expiry} onChange={setExpiry}
            options={[{ value: "ALL", label: "All Expiries" }, ...expiries.map((e) => ({ value: e, label: e }))]} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={lbl}>Limit</span>
          <ThemedSelect ariaLabel="Limit" width={90} value={String(limit)} onChange={(v) => setLimit(Number(v))}
            options={[10, 25, 50, 100].map((l) => ({ value: String(l), label: String(l) }))} />
        </div>
        <span style={{ color: HOME_THEME.border }}>|</span>
        <div style={{ display: "flex", gap: 6 }} title="Positive = OTM strikes above spot with rising GEX (Δ↑) · Negative = OTM strikes below spot with falling GEX (Δ↓)">
          <button onClick={() => setDir("all")} style={seg(dir === "all")}>All</button>
          <button onClick={() => setDir("pos")} style={{ ...seg(dir === "pos"), ...(dir === "pos" ? { color: HOME_THEME.green, borderColor: HOME_THEME.green } : {}) }}>Positive</button>
          <button onClick={() => setDir("neg")} style={{ ...seg(dir === "neg"), ...(dir === "neg" ? { color: HOME_THEME.red, borderColor: HOME_THEME.red } : {}) }}>Negative</button>
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
        <button onClick={() => load()} style={seg(false)}>↻ Refresh</button>
        <span style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", alignSelf: "center" }}>click a column header to sort</span>
      </div>

      {err && <div style={{ color: HOME_THEME.red, marginBottom: 12, fontSize: 14 }}>{err}</div>}

      {topCards.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontSize: 17, color: HOME_THEME.green, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Top 10 · {cols.find((c) => c.key === colSort.col)?.label} · SPX/SPY/QQQ 1 slot each
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setCardScope("all")} style={seg(cardScope === "all")}>All</button>
              <button onClick={() => setCardScope("exidx")} style={seg(cardScope === "exidx")}>All − Indices</button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
            {topCards.map((r, i) => {
              const v = sqVal(r, colSort.col);
              const pos = v >= 0;
              const metricCol = colSort.col === "strike" || colSort.col === "gex_now" || colSort.col === "delta_abs"
                ? HOME_THEME.text : pos ? HOME_THEME.green : HOME_THEME.red;
              return (
                <div key={`${r.symbol}-${r.expiry}-${r.strike}-${i}`} style={{
                  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 12px",
                  background: i % 2 ? "rgba(255,255,255,0.02)" : "rgba(33,158,188,0.06)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontWeight: 800, fontSize: 17, color: HOME_THEME.text }}>{r.symbol}</span>
                    <span style={{ fontSize: 14, color: "rgba(255,255,255,0.4)" }}>#{i + 1}</span>
                  </div>
                  <div style={{ fontSize: 14, color: HOME_THEME.cyan, fontWeight: 700, margin: "2px 0" }}>
                    ${r.strike} <span style={{ color: "rgba(255,255,255,0.4)", fontWeight: 400 }}>{r.expiry}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: metricCol }}>
                    {colSort.col === "strike" ? r.strike : fmtB(v)}
                  </div>
                  <div style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>
                    {cols.find((c) => c.key === colSort.col)?.label}
                  </div>
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
              {showSymbol && <th style={{ ...th, textAlign: "left" }}>Symbol</th>}
              {showExpiry && <th style={{ ...th, textAlign: "left" }}>Expiry</th>}
              <th style={th}>OTM%</th>
              {cols.map((c) => {
                const active = colSort.col === c.key;
                const arrow = active ? (colSort.dir === "desc" ? " ↓" : " ↑") : " ⇅";
                return (
                  <th key={c.key} onClick={() => toggleSort(c.key)} style={{
                    ...th, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
                    color: active ? HOME_THEME.cyan : HOME_THEME.green,
                  }}>
                    {c.label}<span style={{ opacity: active ? 1 : 0.4, fontSize: 14 }}>{arrow}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r, i) => (
              <tr key={`${r.symbol}-${r.expiry}-${r.strike}-${i}`}
                style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                {showSymbol && <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{r.symbol}</td>}
                {showExpiry && <td style={{ ...td, textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 14 }}>{r.expiry}</td>}
                <td style={{ ...td, color: otmDist(r) * 100 >= 5 ? HOME_THEME.orange : "rgba(255,255,255,0.7)" }}>
                  {r.spot ? `${(otmDist(r) * 100).toFixed(1)}%` : "—"}
                </td>
                <td style={{ ...td, fontWeight: 700 }}>{r.strike}</td>
                <td style={td}>{fmtB(r.gex_now)}</td>
                <td style={{ ...td, color: r.chg15 == null ? HOME_THEME.text : r.chg15 >= 0 ? HOME_THEME.green : HOME_THEME.red }}>{r.chg15 == null ? "—" : fmtB(r.chg15)}</td>
                <td style={{ ...td, color: r.chg30 == null ? HOME_THEME.text : r.chg30 >= 0 ? HOME_THEME.green : HOME_THEME.red }}>{r.chg30 == null ? "—" : fmtB(r.chg30)}</td>
                <td style={{ ...td, color: r.chg60 == null ? HOME_THEME.text : r.chg60 >= 0 ? HOME_THEME.green : HOME_THEME.red }}>{r.chg60 == null ? "—" : fmtB(r.chg60)}</td>
                <td style={td}>{fmtB(r.delta_abs)}</td>
              </tr>
            ))}
            {!displayRows.length && !loading && !err && (
              <tr><td colSpan={cols.length + 1 + (showSymbol ? 1 : 0) + (showExpiry ? 1 : 0)} style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                No rows yet. Needs recorder history for the selected ticker(s).
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * A modal must escape its Card, or it is not a modal.
 *
 * `position: fixed` resolves against the viewport ONLY while no ancestor has a
 * transform, filter, backdrop-filter, perspective, will-change or contain — any
 * of those makes that ancestor the containing block instead. Every PageCard
 * surface in homeTheme sets `backdropFilter: blur(16px)`, and `.card-hover` adds
 * a `transform` on hover, so an overlay rendered inside a Card had `inset: 0`
 * cover THE CARD. It looked centered because it was — centered on a card sitting
 * a couple of screens down, which is exactly the scroll-to-find-it symptom.
 *
 * Portaling to <body> puts the overlay outside every card, so fixed means fixed.
 * Use this for any dialog added to this page; styling it differently will not
 * help, because the bug is in the ancestor chain rather than the overlay.
 */
function ModalPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  // document only exists after mount — this page is prerendered by Next as well
  // as run in the Vite SPA, and SSR must render nothing rather than throw.
  useEffect(() => { setHost(document.body); }, []);
  if (!host) return null;
  return createPortal(children, host);
}

// ══════════════════════════════════════════════════════════════════════════════
//  WATCH THIS (new tab) — farther-out CB level: highest GEX strike within 30d
//  expirations sitting unusually far OTM vs spot, scanner universe
// ══════════════════════════════════════════════════════════════════════════════

type WatchRow = {
  symbol: string;
  strike: number;
  expiry: string;
  gex_value: number;
  gex_value_vol?: number | null;
  spot: number;
  otm_pct: number;
  dte_days: number;
  date: string;
};

type OutcomeRow = {
  symbol: string;
  strike: number;
  expiry: string;
  first_flagged: string;
  spot_at_flag: number;
  otm_pct_at_flag: number;
  side: "above" | "below";
  last_checked: string | null;
  last_spot: number | null;
  closest_pct: number | null;
  touched: boolean;
  touched_date: string | null;
  status: "open" | "touched" | "expired";
  // The flagged OTM contract itself — live mid + % vs today's open, so the
  // table carries the stats the row popup used to hide. Null once expired.
  opt_type?: "C" | "P" | null;
  opt_price?: number | null;
  opt_open?: number | null;
  opt_pct_open?: number | null;
};

/**
 * Tracked-results view selector. The first four are server-side status filters
 * on the flat table; "results" is a client-side roll-up of every tracked flag
 * grouped by calendar date (opened / touched / expired counts per day).
 */
type OutcomeView = "all" | "open" | "touched" | "expired" | "results";

type DayBucket = {
  date: string;
  opened: OutcomeRow[];
  touched: OutcomeRow[];
  expired: OutcomeRow[];
};

/** Dates arrive as YYYY-MM-DD, but expiry can carry a time — normalise to the day. */
const ymd = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/**
 * One flag can land in up to three different days: the day it was flagged
 * (opened), the day spot reached the strike (touched), and the day it expired
 * untouched. Newest day first.
 */
function groupOutcomesByDay(rows: OutcomeRow[]): DayBucket[] {
  const map = new Map<string, DayBucket>();
  const bucket = (d: string): DayBucket => {
    let b = map.get(d);
    if (!b) { b = { date: d, opened: [], touched: [], expired: [] }; map.set(d, b); }
    return b;
  };
  for (const r of rows) {
    const flagged = ymd(r.first_flagged);
    if (flagged) bucket(flagged).opened.push(r);
    const touched = ymd(r.touched_date);
    if (touched) bucket(touched).touched.push(r);
    if (r.status === "expired") {
      const exp = ymd(r.expiry);
      if (exp) bucket(exp).expired.push(r);
    }
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

type OutcomeDetailDay = {
  date: string;
  spot: number;
  spotPctChg: number | null;
  contractClose: number | null;
  contractDollarChg: number | null;
  contractPctChg: number | null;
};

type OutcomeDetail = {
  ok: boolean;
  error?: string;
  symbol: string;
  strike: number;
  expiry: string;
  type: "C" | "P";
  firstFlagged: string;
  spotAtFlag: number;
  otmPctAtFlag: number;
  status: "open" | "touched" | "expired";
  touched: boolean;
  touchedDate: string | null;
  days: OutcomeDetailDay[];
};

function WatchThisScanner() {
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);

  const [outcomes, setOutcomes] = useState<OutcomeRow[]>([]);
  const [outcomeStatus, setOutcomeStatus] = useState<OutcomeView>("all");

  // "Results" view — every tracked flag bucketed by calendar date.
  const [resultRows, setResultRows] = useState<OutcomeRow[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsErr, setResultsErr] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const [detail, setDetail] = useState<OutcomeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  const openDetail = useCallback(async (o: OutcomeRow) => {
    setDetail(null); setDetailErr(null); setDetailLoading(true);
    try {
      const qs = new URLSearchParams({ symbol: o.symbol, strike: String(o.strike), expiry: o.expiry }).toString();
      const res = await fetch(`/proxy/far-cb-outcome-detail?${qs}`, { cache: "no-store" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "load failed");
      setDetail(j);
    } catch (e: any) {
      setDetailErr(String(e?.message || e));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => { setDetail(null); setDetailErr(null); }, []);

  const [newTicker, setNewTicker] = useState("");
  const [addStatus, setAddStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [adding, setAdding] = useState(false);

  // When this page is iframed inside the GexDock drawer (?embed=1), internal
  // links must break out to the top-level window (target="_top") instead of
  // navigating inside the iframe — otherwise the destination page renders its
  // own full chrome (GlobalToolbar + sidebar + another GexDock) nested inside
  // the already-embedded drawer.
  const [isEmbed, setIsEmbed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsEmbed(new URLSearchParams(window.location.search).get("embed") === "1");
  }, []);

  const addTicker = useCallback(async () => {
    const symbol = newTicker.trim().toUpperCase();
    if (!symbol) return;
    setAdding(true); setAddStatus(null);
    try {
      const res = await fetch("/api/far-cb-tickers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Add failed");
      setAddStatus({ kind: "ok", msg: `${symbol} added — appears after the next sweep.` });
      setNewTicker("");
    } catch (e: any) {
      setAddStatus({ kind: "err", msg: String(e?.message || e) });
    } finally {
      setAdding(false);
    }
  }, [newTicker]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/proxy/far-cb-watch?limit=50", { cache: "no-store" });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Server returned ${res.status} (non-JSON).`); }
      if (!j.ok) throw new Error(j.error || "load failed");
      setRows(j.rows || []);
      setThreshold(j.threshold ?? null);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, []);

  const loadOutcomes = useCallback(async () => {
    if (outcomeStatus === "results") return;
    try {
      const res = await fetch(`/proxy/far-cb-outcomes?status=${outcomeStatus}&limit=100`, { cache: "no-store" });
      const j = await res.json();
      if (j.ok) setOutcomes(j.rows || []);
    } catch {}
  }, [outcomeStatus]);

  // Results needs every row regardless of status so the per-day counts are
  // complete; 300 is the endpoint's ceiling. quotes=0 because ResultsByDay only
  // renders per-day counts and the flag fields — it never touches opt_price, so
  // there is no reason to make the server price 300 contracts for it.
  const loadResults = useCallback(async () => {
    setResultsLoading(true); setResultsErr(null);
    try {
      const res = await fetch("/proxy/far-cb-outcomes?status=all&limit=300&quotes=0", { cache: "no-store" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "load failed");
      setResultRows(j.rows || []);
    } catch (e: any) {
      setResultsErr(String(e?.message || e));
    } finally {
      setResultsLoading(false);
    }
  }, []);

  const dayBuckets = useMemo(() => groupOutcomesByDay(resultRows), [resultRows]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => load(), 120_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { loadOutcomes(); }, [loadOutcomes]);
  // The server now answers /far-cb-outcomes from a quote cache it fills in the
  // background, so the first response can carry blank premium columns for
  // contracts it hadn't priced yet. Re-poll while the tab is visible to pick
  // them up; hidden tabs skip it so a backgrounded window costs nothing.
  useEffect(() => {
    if (outcomeStatus === "results") return;
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      loadOutcomes();
    }, 60_000);
    return () => clearInterval(t);
  }, [outcomeStatus, loadOutcomes]);
  useEffect(() => { if (outcomeStatus === "results") loadResults(); }, [outcomeStatus, loadResults]);

  return (
    <Card variant="budget" title={<span style={{ fontSize: 17 }}>Watch This — Far CB</span>}
      subtitle={`Highest GEX strike within 30d expirations, far OTM vs spot · scanner universe${threshold != null ? ` · >${threshold}% OTM` : ""}${loading ? " · refreshing…" : ""}`}>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={() => load()} style={seg(false)}>↻ Refresh</button>
        <span style={{ fontSize: 14, color: HOME_THEME.text }}>
          Refreshes every 2m · recorder sweeps every 30m during RTH
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          value={newTicker}
          onChange={(e) => setNewTicker(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addTicker(); }}
          placeholder="Add a ticker (e.g. RDDT)"
          maxLength={6}
          style={{
            fontSize: 14, padding: "7px 10px", borderRadius: 6, width: 160,
            background: "rgba(0,0,0,0.30)", color: HOME_THEME.text,
            border: "1px solid rgba(255,255,255,0.15)", colorScheme: "dark",
          }}
        />
        <button onClick={addTicker} disabled={adding || !newTicker.trim()} style={seg(false)}>
          {adding ? "Adding…" : "+ Add"}
        </button>
        {addStatus && (
          <span style={{ fontSize: 14, color: addStatus.kind === "ok" ? LIGHT_BLUE : HOME_THEME.red }}>
            {addStatus.msg}
          </span>
        )}
      </div>

      {err && (
        <div style={{ color: HOME_THEME.orange, marginBottom: 12, fontSize: 14 }}>
          {err.includes("no DB") || err.includes("503")
            ? "Recorder hasn't run yet — data appears after the first RTH sweep."
            : err}
        </div>
      )}

      {!rows.length && !loading && !err && (
        <div style={{ padding: 24, textAlign: "center", color: HOME_THEME.text }}>
          Nothing flagged right now — no watchlist ticker has an unusually far-OTM dominant CB level.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {rows.map((r) => {
          const up = r.gex_value >= 0;
          const chainHref = `/options-chain?symbol=${encodeURIComponent(r.symbol)}&expiry=${encodeURIComponent(r.expiry)}&strike=${r.strike}`;
          return (
            <div key={`${r.symbol}-${r.expiry}-${r.strike}`} style={{
              borderRadius: 12,
              padding: "14px 16px",
              background: `rgba(13,17,25,0.20)`,
              backdropFilter: "blur(20px)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontWeight: 800, fontSize: 14, color: up ? HOME_THEME.green : HOME_THEME.red }}>{r.symbol}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: up ? HOME_THEME.green : HOME_THEME.red, opacity: 0.85 }}>${r.spot.toFixed(2)}</span>
                </span>
                <span style={{ fontSize: 14, fontWeight: 800, color: LIGHT_BLUE, letterSpacing: "0.05em" }}>WATCH THIS</span>
              </div>
              <div style={{ fontSize: 14, color: LIGHT_BLUE, fontWeight: 700, marginBottom: 4 }}>
                ${r.strike} <span style={{ color: HOME_THEME.text, fontWeight: 400 }}>· {r.expiry} · {r.dte_days}d</span>
              </div>
              <div style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.5, marginBottom: 8 }}>
                Highest GEX level for {r.symbol} is the ${r.strike} strike ({r.expiry}), {r.otm_pct.toFixed(0)}% away from spot (${r.spot.toFixed(2)}) —
                farther out than the usual near-the-money CB. {up ? "Call-side" : "Put-side"} dominant.
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: up ? HOME_THEME.green : HOME_THEME.red }}>
                    <span style={{ color: HOME_THEME.text, opacity: 0.6, fontWeight: 600, fontSize: 14 }}>OI+VOL </span>
                    {fmtB(r.gex_value)}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: (r.gex_value_vol ?? 0) >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                    <span style={{ color: HOME_THEME.text, opacity: 0.6, fontWeight: 600, fontSize: 14 }}>VOL </span>
                    {r.gex_value_vol != null ? fmtB(r.gex_value_vol) : "—"}
                  </span>
                </span>
                <a
                  href={chainHref}
                  target={isEmbed ? "_top" : undefined}
                  rel={isEmbed ? "noopener" : undefined}
                  style={{ fontSize: 14, color: LIGHT_BLUE, fontWeight: 700, textDecoration: "none" }}
                >
                  View chain →
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 20, flexWrap: "wrap", fontSize: 14, color: HOME_THEME.text }}>
        <span>Basis: OI+Vol net GEX (canonical) · single highest |GEX| strike per ticker across expiries ≤30 DTE</span>
        <span>Flagged when that strike is &gt;{threshold ?? 15}% away from spot</span>
      </div>

      {/* Tracked results — did the flagged strike ever get touched? */}
      <div style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.text }}>Tracked results</span>
          <div style={{ display: "flex", gap: 6 }}>
            {(["all", "open", "touched", "expired", "results"] as const).map((s) => (
              <button key={s} onClick={() => setOutcomeStatus(s)} style={seg(outcomeStatus === s)}>
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 14, color: HOME_THEME.text }}>
            {outcomeStatus === "results"
              ? "One row per date · how many flags opened, were touched, and expired that day · click a date to expand"
              : "Graded daily ~16:10 ET · no win/loss — just whether spot reached the strike · Opt Price = flagged contract's NBBO mid, % since its own open (live rows only)"}
          </span>
        </div>

        {outcomeStatus === "results" ? (
          <ResultsByDay
            days={dayBuckets}
            loading={resultsLoading}
            err={resultsErr}
            openDay={openDay}
            onToggleDay={(d) => setOpenDay((cur) => (cur === d ? null : d))}
            onPickRow={openDetail}
          />
        ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 14, textTransform: "uppercase" }}>
                <th style={{ ...th, textAlign: "left" }}>Symbol</th>
                <th style={th}>Strike</th>
                <th style={{ ...th, textAlign: "left" }}>Expiry</th>
                <th style={{ ...th, textAlign: "left" }}>Flagged</th>
                <th style={th}>Opt Price</th>
                <th style={th}>% Since Open</th>
                <th style={th}>Flagged Spot</th>
                <th style={th}>OTM at flag</th>
                <th style={th}>Closest</th>
                <th style={{ ...th, textAlign: "left" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((o, i) => (
                <tr key={`${o.symbol}-${o.expiry}-${o.strike}`}
                  onClick={() => openDetail(o)}
                  title="Click for day-by-day detail"
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                    cursor: "pointer",
                  }}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{o.symbol}</td>
                  <td style={{ ...td, fontWeight: 700, color: o.side === "above" ? HOME_THEME.green : HOME_THEME.red }}>${o.strike}</td>
                  <td style={{ ...td, textAlign: "left", color: HOME_THEME.text, fontSize: 14 }}>{o.expiry}</td>
                  <td style={{ ...td, textAlign: "left", color: HOME_THEME.text, fontSize: 14 }}>{o.first_flagged}</td>
                  <td style={{ ...td, fontWeight: 700, color: o.opt_price != null ? LIGHT_BLUE : HOME_THEME.text }}>
                    {o.opt_price != null
                      ? `$${o.opt_price.toFixed(2)}${o.opt_type ? ` ${o.opt_type}` : ""}`
                      : "—"}
                  </td>
                  <td style={{
                    ...td, fontWeight: 700,
                    color: o.opt_pct_open == null ? HOME_THEME.text : o.opt_pct_open >= 0 ? HOME_THEME.green : HOME_THEME.red,
                  }}>
                    {o.opt_pct_open == null
                      ? "—"
                      : `${o.opt_pct_open >= 0 ? "▲" : "▼"} ${Math.abs(o.opt_pct_open).toFixed(1)}%`}
                  </td>
                  <td style={td}>${o.spot_at_flag.toFixed(2)}</td>
                  <td style={td}>{o.otm_pct_at_flag.toFixed(0)}%</td>
                  <td style={{ ...td, color: o.closest_pct != null && o.closest_pct < 1 ? LIGHT_BLUE : HOME_THEME.text }}>
                    {o.closest_pct != null ? `${o.closest_pct.toFixed(1)}%` : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "left" }}>
                    <span style={{
                      fontSize: 14, fontWeight: 800, letterSpacing: "0.05em",
                      color: o.status === "touched" ? LIGHT_BLUE : o.status === "expired" ? HOME_THEME.text : HOME_THEME.green,
                    }}>
                      {o.status === "touched" ? `TOUCHED ${o.touched_date ?? ""}` : o.status.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
              {!outcomes.length && (
                <tr><td colSpan={10} style={{ padding: 20, textAlign: "center", color: HOME_THEME.text }}>
                  No tracked flags yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {(detailLoading || detail || detailErr) && (
        <ModalPortal>
        <div
          onClick={closeDetail}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(720px, 100%)", maxHeight: "80vh", overflowY: "auto",
              borderRadius: 12, padding: "18px 20px",
              background: "rgba(13,17,25,0.97)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.text }}>
                  {detail ? `${detail.symbol} · $${detail.strike} ${detail.type === "C" ? "Call" : "Put"} · ${detail.expiry}` : "Loading…"}
                </div>
                {detail && (
                  <>
                    <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.75, marginTop: 2 }}>
                      Flagged {detail.firstFlagged} at spot ${detail.spotAtFlag.toFixed(2)} ({detail.otmPctAtFlag.toFixed(0)}% OTM) ·{" "}
                      <span style={{ color: detail.status === "touched" ? LIGHT_BLUE : detail.status === "expired" ? HOME_THEME.text : HOME_THEME.green, fontWeight: 700 }}>
                        {detail.status === "touched" ? `TOUCHED ${detail.touchedDate ?? ""}` : detail.status.toUpperCase()}
                      </span>
                    </div>
                    {/* Past sessions are the contract's own daily bars; today is
                        our 15-minute probe. A day the contract never traded has
                        no bar, so it stays "—" until the probe covers it. */}
                    <div style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.55, marginTop: 2 }}>
                      Daily bars from the contract&apos;s own tape · today sampled every 15m · no-trade days show —
                    </div>
                  </>
                )}
              </div>
              <button onClick={closeDetail} style={{ ...seg(false), padding: "4px 10px" }}>✕</button>
            </div>

            {detailLoading && (
              <div style={{ padding: 24, textAlign: "center", color: HOME_THEME.text }}>Loading day-by-day detail…</div>
            )}
            {detailErr && (
              <div style={{ padding: 24, textAlign: "center", color: HOME_THEME.orange }}>{detailErr}</div>
            )}
            {detail && !detail.days.length && (
              <div style={{ padding: 24, textAlign: "center", color: HOME_THEME.text }}>No daily bars yet.</div>
            )}
            {detail && !!detail.days.length && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 14, textTransform: "uppercase" }}>
                      <th style={{ ...th, textAlign: "left" }}>Date</th>
                      <th style={th}>Spot</th>
                      <th style={th}>Spot Δ%</th>
                      <th style={th}>Contract</th>
                      <th style={th}>Contract Δ$</th>
                      <th style={th}>Contract Δ%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.days.map((d, i) => (
                      <tr key={d.date} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                        <td style={{ ...td, textAlign: "left" }}>{d.date}</td>
                        <td style={td}>${d.spot.toFixed(2)}</td>
                        <td style={{ ...td, color: d.spotPctChg == null ? HOME_THEME.text : d.spotPctChg >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                          {d.spotPctChg == null ? "—" : `${d.spotPctChg >= 0 ? "+" : ""}${d.spotPctChg.toFixed(2)}%`}
                        </td>
                        <td style={td}>{d.contractClose == null ? "—" : `$${d.contractClose.toFixed(2)}`}</td>
                        <td style={{ ...td, color: d.contractDollarChg == null ? HOME_THEME.text : d.contractDollarChg >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                          {d.contractDollarChg == null ? "—" : `${d.contractDollarChg >= 0 ? "+" : ""}$${d.contractDollarChg.toFixed(2)}`}
                        </td>
                        <td style={{ ...td, color: d.contractPctChg == null ? HOME_THEME.text : d.contractPctChg >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                          {d.contractPctChg == null ? "—" : `${d.contractPctChg >= 0 ? "+" : ""}${d.contractPctChg.toFixed(2)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        </ModalPortal>
      )}
    </Card>
  );
}

// ── Results view: one row per date, expanding into opened / touched / expired ──

const RESULT_SECTIONS = [
  { key: "opened"  as const, label: "Opened",  color: HOME_THEME.green,
    note: "flagged for the first time on this date" },
  { key: "touched" as const, label: "Touched", color: LIGHT_BLUE,
    note: "spot reached the flagged strike on this date" },
  { key: "expired" as const, label: "Expired", color: HOME_THEME.orange,
    note: "expired on this date without ever being touched" },
];

function ResultsByDay({
  days, loading, err, openDay, onToggleDay, onPickRow,
}: {
  days: DayBucket[];
  loading: boolean;
  err: string | null;
  openDay: string | null;
  onToggleDay: (date: string) => void;
  onPickRow: (o: OutcomeRow) => void;
}) {
  const count = (n: number, color: string) => (
    <span style={{ fontWeight: 800, color: n ? color : "rgba(255,255,255,0.35)" }}>{n}</span>
  );

  if (err) {
    return <div style={{ padding: 20, textAlign: "center", color: HOME_THEME.orange }}>{err}</div>;
  }
  if (loading && !days.length) {
    return <div style={{ padding: 20, textAlign: "center", color: HOME_THEME.text }}>Loading results…</div>;
  }
  if (!days.length) {
    return <div style={{ padding: 20, textAlign: "center", color: HOME_THEME.text }}>No tracked flags yet.</div>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 14, textTransform: "uppercase" }}>
            <th style={{ ...th, textAlign: "left" }}>Date</th>
            <th style={th}>Opened</th>
            <th style={th}>Touched</th>
            <th style={th}>Expired</th>
            <th style={{ ...th, width: 30 }} />
          </tr>
        </thead>
        <tbody>
          {days.map((d, i) => {
            const isOpen = openDay === d.date;
            return (
              <Fragment key={d.date}>
                <tr
                  onClick={() => onToggleDay(d.date)}
                  title="Click to expand this date"
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    background: isOpen ? "rgba(33,158,188,0.10)" : i % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <td style={{ ...td, textAlign: "left", fontWeight: 700, color: isOpen ? LIGHT_BLUE : HOME_THEME.text }}>
                    {d.date}
                  </td>
                  <td style={td}>{count(d.opened.length, HOME_THEME.green)}</td>
                  <td style={td}>{count(d.touched.length, LIGHT_BLUE)}</td>
                  <td style={td}>{count(d.expired.length, HOME_THEME.orange)}</td>
                  <td style={{ ...td, color: "rgba(255,255,255,0.45)" }}>{isOpen ? "▾" : "▸"}</td>
                </tr>

                {isOpen && (
                  <tr style={{ background: "rgba(0,0,0,0.20)" }}>
                    <td colSpan={5} style={{ padding: "12px 10px 18px" }}>
                      <div style={{ display: "grid", gap: 16 }}>
                        {RESULT_SECTIONS.map((sec) => {
                          const rows = d[sec.key];
                          return (
                            <div key={sec.key}>
                              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                                <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.05em", color: sec.color }}>
                                  {sec.label.toUpperCase()} · {rows.length}
                                </span>
                                <span style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.65 }}>{sec.note}</span>
                              </div>

                              {!rows.length ? (
                                <div style={{ padding: "8px 10px", fontSize: 14, color: "rgba(255,255,255,0.35)" }}>
                                  None
                                </div>
                              ) : (
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                                  <thead>
                                    <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 14, textTransform: "uppercase" }}>
                                      <th style={{ ...th, textAlign: "left" }}>Symbol</th>
                                      <th style={th}>Strike</th>
                                      <th style={{ ...th, textAlign: "left" }}>Expiry</th>
                                      <th style={{ ...th, textAlign: "left" }}>Flagged</th>
                                      <th style={th}>Flagged Spot</th>
                                      <th style={th}>OTM at flag</th>
                                      <th style={th}>Closest</th>
                                      <th style={{ ...th, textAlign: "left" }}>Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map((o, j) => (
                                      <tr
                                        key={`${sec.key}-${o.symbol}-${o.expiry}-${o.strike}`}
                                        onClick={() => onPickRow(o)}
                                        title="Click for day-by-day detail"
                                        style={{
                                          borderTop: "1px solid rgba(255,255,255,0.06)",
                                          background: j % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                                          cursor: "pointer",
                                        }}
                                      >
                                        <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{o.symbol}</td>
                                        <td style={{ ...td, fontWeight: 700, color: o.side === "above" ? HOME_THEME.green : HOME_THEME.red }}>
                                          ${o.strike}
                                        </td>
                                        <td style={{ ...td, textAlign: "left" }}>{o.expiry}</td>
                                        <td style={{ ...td, textAlign: "left" }}>{o.first_flagged}</td>
                                        <td style={td}>${o.spot_at_flag.toFixed(2)}</td>
                                        <td style={td}>{o.otm_pct_at_flag.toFixed(0)}%</td>
                                        <td style={{ ...td, color: o.closest_pct != null && o.closest_pct < 1 ? LIGHT_BLUE : HOME_THEME.text }}>
                                          {o.closest_pct != null ? `${o.closest_pct.toFixed(1)}%` : "—"}
                                        </td>
                                        <td style={{ ...td, textAlign: "left" }}>
                                          <span style={{
                                            fontSize: 14, fontWeight: 800, letterSpacing: "0.05em",
                                            color: o.status === "touched" ? LIGHT_BLUE : o.status === "expired" ? HOME_THEME.text : HOME_THEME.green,
                                          }}>
                                            {o.status === "touched" ? `TOUCHED ${o.touched_date ?? ""}` : o.status.toUpperCase()}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  MARKET QUALITY TERMINAL (new tab) — 5-pillar global market score
// ══════════════════════════════════════════════════════════════════════════════

type Pillars = {
  volatility: { score: number; weight: number; weighted: number; vixLevel: number | null; vixLevelLabel: string; vixTrend: string; ivPercentile: number | null; iv1yLabel: string; putCall: number | null; putCallLabel: string };
  trend: { score: number; weight: number; weighted: number; regime: string; spyVs20: boolean | null; spyVs50: boolean | null; spyVs200: boolean | null; qqqVs50: boolean | null; rsi14: number | null };
  breadth: { score: number; weight: number; weighted: number; aboveCount: number; total: number; pct200: number | null; pct20: number | null; participation: string; nyseAd: { display: string; label: string }; sectors: { symbol: string; above: boolean | null }[] };
  momentum: { score: number; weight: number; weighted: number; positiveCount: number; total: number; spread: number | null; leader: { symbol: string; chg5d: number } | null; laggard: { symbol: string; chg5d: number } | null; rotation: string };
  macro: { score: number; weight: number; weighted: number; tltLast: number | null; tltTrend: string; uupTrend: string; uup5d: number | null; tenYield: number | null; tenYieldTrend: string; dxy: number | null; dxyTrend: string };
};

type ExecItem = { label: string; value: string; sub: string; tone: boolean | null };

type MqData = {
  asOf: string;
  globalScore: number;
  decision: "YES" | "CAUTION" | "NO";
  banner: { label: string; tone: "green" | "cyan" | "orange" | "red"; sizing: string; sizeLabel: string; sizeNote: string };
  event: {
    fomc: { isToday: boolean; label: string | null; nextDate: string | null; daysAway: number | null };
    fedStance: { stance: string; range: string };
    geopolitical: { label: string; tone: string } | null;
  };
  pillars: Pillars;
  executionWindow: { score: number; items: ExecItem[] };
  sectorBars: { symbol: string; name: string; chg5d: number | null }[];
  headline: string;
  body: string;
  suggestedAction: string;
  assessment: string;
  source: string;
};

const TONE_COLOR: Record<string, string> = {
  green: HOME_THEME.green, cyan: HOME_THEME.cyan, orange: HOME_THEME.orange, red: HOME_THEME.red,
};

const scoreColor = (score: number) =>
  score >= 75 ? HOME_THEME.green : score >= 60 ? HOME_THEME.cyan : score >= 40 ? HOME_THEME.orange : HOME_THEME.red;

function RingGauge({ score, label, sub }: { score: number; label: string; sub: string }) {
  const size = 108, stroke = 9, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = clamp01(score / 100);
  const dash = c * pct;
  const color = scoreColor(score);
  // End-cap dot position
  const angle = -90 + pct * 360;
  const rad = (angle * Math.PI) / 180;
  const cx = size / 2 + r * Math.cos(rad);
  const cy = size / 2 + r * Math.sin(rad);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width={size} height={size} style={{ overflow: "visible" }}>
        <defs>
          <filter id={`glow-${label}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" /><feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} strokeDasharray="2 5" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${c - dash}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
          filter={`url(#glow-${label})`} style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
        {pct > 0.02 && <circle cx={cx} cy={cy} r={4} fill="#fff" />}
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={15} fontWeight={800} fill={HOME_THEME.text}>
          {Math.round(score)}
        </text>
      </svg>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.06em", color: HOME_THEME.text, textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 14, color: HOME_THEME.text }}>{sub}</div>
      </div>
    </div>
  );
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

function MqPanel({ title, accent, children }: { title: string; accent: string; score: number; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px", background: `rgba(13,17,25,0.25)` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.05em", color: accent, textTransform: "uppercase" }}>{title}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </div>
  );
}

function MqRow({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
      <span style={{ color: HOME_THEME.text }}>{label}</span>
      <span style={{ fontWeight: 700, color: valueColor ?? HOME_THEME.text }}>{value}</span>
    </div>
  );
}

function MarketQualityScanner() {
  const [data, setData] = useState<MqData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/scanner/market-quality", { cache: "no-store" });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Server returned ${res.status} (non-JSON).`); }
      if (j.error) throw new Error(j.error);
      setData(j.data);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => load(), 60_000); return () => clearInterval(t); }, [load]);

  const copyAssessment = () => {
    if (!data) return;
    navigator.clipboard?.writeText(data.assessment).then(() => {
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1500);
    }).catch(() => {});
  };

  if (err) {
    return (
      <Card variant="budget" title={<span style={{ fontSize: 17 }}>Market Quality Terminal</span>} subtitle="Global market regime score">
        <div style={{ color: HOME_THEME.red, fontSize: 14 }}>{err}</div>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card variant="budget" title={<span style={{ fontSize: 17 }}>Market Quality Terminal</span>} subtitle="Loading…">
        <div style={{ color: HOME_THEME.text, fontSize: 14, padding: 24, textAlign: "center" }}>Fetching live index / sector data…</div>
      </Card>
    );
  }

  const { globalScore, decision, banner, event, pillars, executionWindow, sectorBars, headline, body, suggestedAction } = data;
  const bannerColor = TONE_COLOR[banner.tone];
  const decisionColor = decision === "YES" ? HOME_THEME.green : decision === "CAUTION" ? HOME_THEME.orange : HOME_THEME.red;
  const asOfLocal = new Date(data.asOf).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

  const maxAbsBar = Math.max(1, ...sectorBars.map((b) => Math.abs(b.chg5d ?? 0)));

  const execToneColor = (tone: boolean | null) => tone == null ? HOME_THEME.orange : tone ? HOME_THEME.green : HOME_THEME.red;

  return (
    <Card variant="budget" title={<span style={{ fontSize: 17 }}>Market Quality Terminal</span>}
      subtitle={`Global market regime score · ${asOfLocal}${loading ? " · refreshing…" : ""}`}>

      {/* Decision + Banner + global score + 5 rings + Position Size */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center", marginBottom: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 90 }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: HOME_THEME.text, textTransform: "uppercase", letterSpacing: "0.06em" }}>Decision</span>
          <div style={{
            borderRadius: 8, padding: "8px 18px", fontSize: 14, fontWeight: 800, letterSpacing: "0.04em",
            color: decisionColor, border: `1px solid ${decisionColor}55`, background: `${decisionColor}15`,
          }}>{decision}</div>
          <span style={{ fontSize: 14, color: HOME_THEME.text }}>Swing Trading</span>
        </div>

        <div style={{
          borderRadius: 12, padding: "14px 20px", minWidth: 150,
          border: `1px solid ${bannerColor}55`, background: `${bannerColor}15`,
        }}>
          <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.1em", color: bannerColor }}>{banner.label}</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: HOME_THEME.text, lineHeight: 1.1 }}>{globalScore}<span style={{ fontSize: 17, color: HOME_THEME.text }}>/100</span></div>
          <div style={{ fontSize: 14, color: bannerColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{banner.sizing}</div>
        </div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <RingGauge score={pillars.volatility.score} label="Volatility" sub="25%" />
          <RingGauge score={pillars.trend.score} label="Trend" sub="20%" />
          <RingGauge score={pillars.breadth.score} label="Breadth" sub="20%" />
          <RingGauge score={pillars.momentum.score} label="Momentum" sub="25%" />
          <RingGauge score={pillars.macro.score} label="Macro" sub="10%" />
        </div>

        <div style={{
          borderRadius: 12, padding: "14px 20px", minWidth: 140, marginLeft: "auto",
          border: `1px solid ${HOME_THEME.border}`, background: "rgba(13,17,25,0.35)",
        }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: HOME_THEME.text, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Position Size</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: bannerColor, letterSpacing: "0.04em" }}>{banner.sizeLabel}</div>
          <div style={{ fontSize: 14, color: HOME_THEME.text }}>{banner.sizeNote}</div>
        </div>
      </div>

      {/* FOMC / event banner */}
      {event.fomc.label && (
        <div style={{
          borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 14, fontWeight: 600,
          color: HOME_THEME.text, background: `${HOME_THEME.orange}12`, border: `1px solid ${HOME_THEME.orange}45`,
        }}>
          <span style={{ fontWeight: 800, color: HOME_THEME.orange }}>⚠ {event.fomc.label}</span>
          {" — Fed decision at 2:00 PM ET. Fed stance: "}{event.fedStance.stance}{" at "}{event.fedStance.range}{". Press conference at 2:30 PM."}
        </div>
      )}

      {/* 5 detail panels */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 24 }}>
        <MqPanel title="Volatility" accent={HOME_THEME.orange} score={pillars.volatility.score}>
          <MqRow label="VIX Level" value={pillars.volatility.vixLevel ?? "—"} valueColor={HOME_THEME.text} />
          <MqRow label="VIX Trend" value={pillars.volatility.vixTrend} valueColor={pillars.volatility.vixTrend === "Rising" ? HOME_THEME.red : pillars.volatility.vixTrend === "Falling" ? HOME_THEME.green : HOME_THEME.text} />
          <MqRow label="VIX 1Y %ile" value={pillars.volatility.ivPercentile != null ? `${pillars.volatility.ivPercentile}th` : "—"} valueColor={HOME_THEME.text} />
          <MqRow label="Put/Call" value={`${pillars.volatility.putCall ?? "—"} · ${pillars.volatility.putCallLabel}`} valueColor={pillars.volatility.putCallLabel === "Fear elevated" ? HOME_THEME.red : pillars.volatility.putCallLabel === "Complacent" ? HOME_THEME.green : HOME_THEME.text} />
        </MqPanel>

        <MqPanel title="Trend" accent={HOME_THEME.cyan} score={pillars.trend.score}>
          <MqRow label="SPX vs 20D" value={pillars.trend.spyVs20 == null ? "—" : pillars.trend.spyVs20 ? "▲ Intact" : "▼ Weak"} valueColor={pillars.trend.spyVs20 ? HOME_THEME.green : HOME_THEME.red} />
          <MqRow label="SPX vs 50D" value={pillars.trend.spyVs50 == null ? "—" : pillars.trend.spyVs50 ? "▲ Intact" : "▼ Weak"} valueColor={pillars.trend.spyVs50 ? HOME_THEME.green : HOME_THEME.red} />
          <MqRow label="SPX vs 200D" value={pillars.trend.spyVs200 == null ? "—" : pillars.trend.spyVs200 ? "▲ Intact" : "▼ Weak"} valueColor={pillars.trend.spyVs200 ? HOME_THEME.green : HOME_THEME.red} />
          <MqRow label="QQQ vs 50D" value={pillars.trend.qqqVs50 == null ? "—" : pillars.trend.qqqVs50 ? "▲ Intact" : "▼ Correcting"} valueColor={pillars.trend.qqqVs50 ? HOME_THEME.green : HOME_THEME.red} />
          <MqRow label="Regime" value={pillars.trend.regime} valueColor={pillars.trend.regime === "Bullish" ? HOME_THEME.green : pillars.trend.regime === "Bearish" ? HOME_THEME.red : HOME_THEME.orange} />
          <MqRow label="RSI-14" value={pillars.trend.rsi14 ?? "—"} valueColor={HOME_THEME.text} />
        </MqPanel>

        <MqPanel title="Breadth" accent={HOME_THEME.red} score={pillars.breadth.score}>
          <MqRow label="% > 50D MA" value={`${pillars.breadth.total ? Math.round((pillars.breadth.aboveCount / pillars.breadth.total) * 100) : 0}%`} valueColor={HOME_THEME.text} />
          <MqRow label="% > 200D MA" value={pillars.breadth.pct200 != null ? `${pillars.breadth.pct200}%` : "—"} valueColor={HOME_THEME.text} />
          <MqRow label="% > 20D MA" value={pillars.breadth.pct20 != null ? `${pillars.breadth.pct20}%` : "—"} valueColor={HOME_THEME.text} />
          <MqRow label="Sector A/D" value={`${pillars.breadth.nyseAd.display} · ${pillars.breadth.nyseAd.label}`} valueColor={pillars.breadth.nyseAd.label === "Positive" ? HOME_THEME.green : pillars.breadth.nyseAd.label === "Negative" ? HOME_THEME.red : HOME_THEME.orange} />
          <MqRow label="Participation" value={pillars.breadth.participation} valueColor={pillars.breadth.participation === "Broad" ? HOME_THEME.green : pillars.breadth.participation === "Narrow" ? HOME_THEME.red : HOME_THEME.orange} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {pillars.breadth.sectors.map((s) => (
              <span key={s.symbol} style={{
                fontSize: 14, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                color: s.above == null ? HOME_THEME.text : s.above ? HOME_THEME.green : HOME_THEME.red,
                background: s.above == null ? "transparent" : s.above ? `${HOME_THEME.green}18` : `${HOME_THEME.red}18`,
              }}>
                {s.symbol} {s.above == null ? "—" : s.above ? "↑" : "↓"}
              </span>
            ))}
          </div>
        </MqPanel>

        <MqPanel title="Momentum" accent={HOME_THEME.green} score={pillars.momentum.score}>
          <MqRow label="Sectors +" value={`${pillars.momentum.positiveCount}/${pillars.momentum.total}`} valueColor={HOME_THEME.text} />
          <MqRow label="Spread" value={pillars.momentum.spread != null ? `${pillars.momentum.spread}%` : "—"} valueColor={HOME_THEME.text} />
          <MqRow label="Leader" value={pillars.momentum.leader ? `${pillars.momentum.leader.symbol} +${pillars.momentum.leader.chg5d}%` : "—"} valueColor={HOME_THEME.green} />
          <MqRow label="Laggard" value={pillars.momentum.laggard ? `${pillars.momentum.laggard.symbol} ${pillars.momentum.laggard.chg5d}%` : "—"} valueColor={HOME_THEME.red} />
          <MqRow label="Rotation" value={pillars.momentum.rotation} valueColor={HOME_THEME.text} />
        </MqPanel>

        <MqPanel title="Macro" accent={LIGHT_BLUE} score={pillars.macro.score}>
          <MqRow label="FOMC" value={event.fomc.isToday ? "TODAY · Event risk!" : event.fomc.nextDate ? `${event.fomc.nextDate} · ${event.fomc.daysAway}d away` : "—"} valueColor={event.fomc.isToday ? HOME_THEME.red : HOME_THEME.text} />
          <MqRow label="10Y Yield" value={pillars.macro.tenYield != null ? `${pillars.macro.tenYield}% ${pillars.macro.tenYieldTrend}` : "—"} valueColor={pillars.macro.tenYieldTrend === "Rising" ? HOME_THEME.red : pillars.macro.tenYieldTrend === "Falling" ? HOME_THEME.green : HOME_THEME.text} />
          <MqRow label="DXY" value={pillars.macro.dxy != null ? `${pillars.macro.dxy} ${pillars.macro.dxyTrend}` : "—"} valueColor={pillars.macro.dxyTrend === "Strengthening" ? HOME_THEME.red : pillars.macro.dxyTrend === "Weakening" ? HOME_THEME.green : HOME_THEME.text} />
          <MqRow label="Fed Stance" value={`${event.fedStance.stance} ${event.fedStance.range}`} valueColor={HOME_THEME.text} />
          <MqRow label="Geopolitical" value={event.geopolitical ? `${event.geopolitical.label} · ${event.geopolitical.tone}` : "None flagged"} valueColor={event.geopolitical ? HOME_THEME.orange : HOME_THEME.text} />
        </MqPanel>
      </div>

      {/* Execution window + sector performance + scoring weights */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(260px, 1.3fr) minmax(220px, 1fr)", gap: 16 }}>
        <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.green, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Execution Window
            </span>
            <span style={{ fontSize: 14, fontWeight: 800, color: scoreColor(executionWindow.score) }}>{executionWindow.score}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {executionWindow.items.map((it) => (
              <div key={it.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ color: HOME_THEME.text }}>{it.label}</span>
                <span style={{ fontWeight: 700, color: execToneColor(it.tone) }}>{it.value} <span style={{ fontSize: 14, fontWeight: 500 }}>{it.sub}</span></span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px" }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.green, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
            Sector Performance (5-Day)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sectorBars.map((b) => {
              const v = b.chg5d ?? 0;
              const pos = v >= 0;
              const widthPct = (Math.abs(v) / maxAbsBar) * 100;
              return (
                <div key={b.symbol} style={{ display: "grid", gridTemplateColumns: "48px 1fr 60px", alignItems: "center", gap: 8, fontSize: 14 }}>
                  <span style={{ fontWeight: 700, color: HOME_THEME.text }}>{b.symbol}</span>
                  <div style={{ position: "relative", height: 14, background: "rgba(255,255,255,0.05)", borderRadius: 4 }}>
                    <div style={{
                      position: "absolute", top: 0, bottom: 0, left: pos ? "0%" : undefined, right: pos ? undefined : "0%",
                      width: `${widthPct}%`, background: pos ? HOME_THEME.green : HOME_THEME.red, borderRadius: 4, opacity: 0.85,
                    }} />
                  </div>
                  <span style={{ textAlign: "right", fontWeight: 700, color: pos ? HOME_THEME.green : HOME_THEME.red }}>
                    {pos ? "+" : ""}{v.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px" }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.green, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
            Scoring Weights
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ color: HOME_THEME.text, fontSize: 14, textTransform: "uppercase" }}>
                <th style={{ textAlign: "left", padding: "4px 0" }}>Pillar</th>
                <th style={{ textAlign: "right", padding: "4px 0" }}>Score</th>
                <th style={{ textAlign: "right", padding: "4px 0" }}>Weight</th>
                <th style={{ textAlign: "right", padding: "4px 0" }}>Wtd</th>
              </tr>
            </thead>
            <tbody>
              {([
                ["Volatility", pillars.volatility.score, pillars.volatility.weight, pillars.volatility.weighted],
                ["Trend", pillars.trend.score, pillars.trend.weight, pillars.trend.weighted],
                ["Breadth", pillars.breadth.score, pillars.breadth.weight, pillars.breadth.weighted],
                ["Momentum", pillars.momentum.score, pillars.momentum.weight, pillars.momentum.weighted],
                ["Macro", pillars.macro.score, pillars.macro.weight, pillars.macro.weighted],
              ] as [string, number, number, number][]).map(([name, score, weight, wtd]) => (
                <tr key={name} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={{ padding: "5px 0", color: HOME_THEME.text }}>{name}</td>
                  <td style={{ textAlign: "right", color: scoreColor(score), fontWeight: 700 }}>{score}</td>
                  <td style={{ textAlign: "right", color: HOME_THEME.text }}>{Math.round(weight * 100)}%</td>
                  <td style={{ textAlign: "right", color: HOME_THEME.text, fontWeight: 700 }}>{wtd}</td>
                </tr>
              ))}
              <tr style={{ borderTop: `1px solid ${HOME_THEME.cyan}55` }}>
                <td style={{ padding: "6px 0", color: HOME_THEME.cyan, fontWeight: 800 }}>Total</td>
                <td style={{ textAlign: "right", color: HOME_THEME.text }}>—</td>
                <td style={{ textAlign: "right", color: HOME_THEME.text }}>100%</td>
                <td style={{ textAlign: "right", color: HOME_THEME.cyan, fontWeight: 800 }}>{globalScore}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 3, fontSize: 14 }}>
            <span style={{ color: HOME_THEME.green, fontWeight: 700 }}>60-100: YES (press risk)</span>
            <span style={{ color: HOME_THEME.orange, fontWeight: 700 }}>40-59: CAUTION (selective)</span>
            <span style={{ color: HOME_THEME.red, fontWeight: 700 }}>&lt;40: NO (preserve capital)</span>
          </div>
        </div>
      </div>

      {/* AI-generated assessment */}
      <div style={{ marginTop: 20, borderRadius: 12, border: `1px solid ${HOME_THEME.cyan}30`, padding: "14px 16px", background: `${HOME_THEME.cyan}0A` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: HOME_THEME.cyan, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            ⚡ AI-Generated Market Assessment
          </span>
          <button onClick={copyAssessment} style={{ ...seg(false), fontSize: 14, padding: "4px 10px" }}>
            {copyStatus === "copied" ? "Copied ✓" : "Copy Shot"}
          </button>
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: decisionColor, marginBottom: 8 }}>{headline}</div>
        <div style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.6, marginBottom: 10 }}>{body}</div>
        <div style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.6, fontStyle: "italic" }}>{suggestedAction}</div>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  TPO STRUCTURES — Market Profile "open business"
//
//  Replaces the old Balance/Imbalance quadrant classifier. That panel answered
//  "what state is today in?"; this one answers the question that actually pays:
//  "which prior-session levels are still unfinished, and how often does THIS KIND
//  of level get revisited?"
//
//  Excess holds. Poor highs get taken out. Holes get accelerated through.
//  They are opposite trades — see lib/tpo.ts for the full taxonomy.
// ══════════════════════════════════════════════════════════════════════════════

const KIND_COLOR: Record<StructureKind, string> = {
  excess_high: HOME_THEME.red,
  excess_low: HOME_THEME.red,
  tail_high: HOME_THEME.orange,
  tail_low: HOME_THEME.orange,
  poor_high: HOME_THEME.orange,
  poor_low: HOME_THEME.orange,
  hole: NEUTRAL,
  naked_poc: LIGHT_BLUE,
};

const pctOrDash = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);

// ── 5-day TPO letter profile ─────────────────────────────────────────────────
// The last 5 RTH sessions, side by side on ONE shared price axis, drawn as real
// TPO letter charts (MotiveWave / Sierra style):
//
//   • one cell per period per price bin, lettered A, B, C… from the 09:30 open
//   • periods 0–1 (the Initial Balance, 09:30–10:30) are RED
//   • every later period is BLUE
//   • the POC row is ORANGE
//   • the 70% value area is shaded
//   • H / L / P (POC) / M (mid) tagged off the right of each profile
//
// RTH only — Globex is deliberately excluded. Overnight single prints are a thin
// -book artifact, not an auction failure, and folding them in poisons the tails/
// excess/poor-high stats that the rest of this tab is built on.
//
// Canvas, not SVG: 5 sessions × ~14 periods × ~60 bins is several thousand cells,
// and that many DOM nodes re-rendering on every WS tick is exactly the kind of
// main-thread stall that froze this tab before.

const TPO_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const IB_PERIODS = 2; // 09:30–10:30

const VIEW_H = 660;  // fixed viewport; the profile pans/zooms INSIDE it

function TpoLetterProfile({ sessions, spot, binSize, levels }: {
  sessions: TpoSession[]; spot: number | null; binSize: number; levels?: TpoStructure[];
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(1180);

  // ── view state ────────────────────────────────────────────────────────────
  // `split` is the "expanded profile" mode: instead of collapsing every letter
  // to the left (a histogram), each letter is drawn in the COLUMN OF ITS OWN
  // PERIOD — so column 3 is always period C, whether or not C traded there.
  // That leaves gaps, and the gaps are the point: you can read the auction's
  // development through TIME, which is the whole reason Steidlmayer used
  // letters instead of bars.
  const [split, setSplit] = useState(false);
  // On-chart structure callouts for the CURRENT session. The 3px colored spine
  // next to each profile was technically the same information and nobody could
  // read it — an excess high and a poor high are opposite trades and looked
  // identical. Named boxes with leader lines, MotiveWave-annotation style.
  const [labels, setLabels] = useState(true);
  const [zx, setZx] = useState(1);   // horizontal zoom (cell width)
  const [zy, setZy] = useState(1);   // vertical zoom (price resolution)
  const [ox, setOx] = useState(0);   // pan offsets, px
  const [oy, setOy] = useState(0);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  type Hit = { s: TpoStructure; color: string; x0: number; x1: number; yTop: number; yBot: number };
  const hitsRef = useRef<Hit[]>([]);
  const [hover, setHover] = useState<{ hit: Hit; x: number; y: number } | null>(null);

  // Re-anchor on Reset and whenever the session count changes — "Reset" that
  // dumps you on a 30-day-old profile isn't a reset.
  const anchorRef = useRef(true);
  useEffect(() => { anchorRef.current = true; }, [sessions.length, split]);

  const reset = useCallback(() => {
    anchorRef.current = true;
    setZx(1); setZy(1); setOx(0); setOy(0);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 1180));
    ro.observe(el);
    setW(el.clientWidth || 1180);
    return () => ro.disconnect();
  }, []);

  // Wheel zoom, anchored on the cursor so the price under the pointer stays put.
  // Registered natively (not via onWheel) because React's synthetic wheel handler
  // is passive — preventDefault() there is a no-op and the page scrolls instead.
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = e.deltaY < 0 ? 1.12 : 1 / 1.12;

      if (e.shiftKey) {
        setZx((z) => {
          const nz = Math.max(0.4, Math.min(6, z * k));
          setOx((o) => mx - ((mx - o) * nz) / z);
          return nz;
        });
      } else {
        setZy((z) => {
          const nz = Math.max(0.4, Math.min(8, z * k));
          setOy((o) => my - ((my - o) * nz) / z);
          return nz;
        });
      }
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !sessions.length) return;

    const lo = Math.min(...sessions.map((d) => d.low));
    const hi = Math.max(...sessions.map((d) => d.high));
    if (!(hi > lo)) return;

    const AXIS = 58, TOP = 14, BOT = 26, GUTTER = 118;
    const rows = Math.max(1, Math.round((hi - lo) / binSize));

    const baseRh = Math.max(5, Math.min(11, (VIEW_H - TOP - BOT) / rows));
    const rh = baseRh * zy;
    const cw = Math.max(4, (baseRh - 0.5) * zx);

    const DPR = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * DPR; cv.height = VIEW_H * DPR;
    cv.style.width = "100%"; cv.style.height = `${VIEW_H}px`;
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, w, VIEW_H);

    const y = (p: number) => TOP + oy + ((hi - p) / binSize) * rh;
    const vis = (py: number) => py > TOP - rh && py < VIEW_H - BOT + rh;

    // ── plot area is clipped so nothing pans over the price axis ────────────
    // ── anchor pass ─────────────────────────────────────────────────────────
    // At 30 sessions the strip is several canvases wide and ~a year of price
    // range tall, so ox/oy = 0 opens on the OLDEST profile with spot nowhere on
    // screen. Whenever the session count changes (or Reset is hit) we jump the
    // view to the newest profile, vertically centered on spot, then bail — the
    // state change re-runs this effect and the real draw happens on that pass.
    if (anchorRef.current) {
      anchorRef.current = false;
      const totalW = sessions.reduce(
        (a, d) => a + (split ? d.periods : (d.maxCount || 1)) * cw + GUTTER, 0,
      );
      const wantOx = Math.min(0, w - AXIS - 10 - totalW);
      const wantOy = spot != null
        ? VIEW_H / 2 - TOP - ((hi - spot) / binSize) * rh
        : 0;
      if (Math.abs(wantOx - ox) > 0.5 || Math.abs(wantOy - oy) > 0.5) {
        setOx(wantOx); setOy(wantOy);
        return;
      }
    }

    g.save();
    g.beginPath();
    g.rect(AXIS, 0, w - AXIS, VIEW_H - BOT + 14);
    g.clip();

    let x = AXIS + 10 + ox;

    // Callouts are collected during the session walk and painted AFTER it, so a
    // box never ends up under the next session's letters.
    type Callout = { s: TpoStructure; color: string; yTop: number; yBot: number; x0: number; x1: number; today: boolean };
    const callouts: Callout[] = [];
    const lastDate = sessions[sessions.length - 1]?.date;

    for (const d of sessions) {
      const cols = split ? d.periods : (d.maxCount || 1);
      const wid = cols * cw;

      if (x + wid + GUTTER > 0 && x < w) {
        if (vis(y(d.vah)) || vis(y(d.val))) {
          g.fillStyle = "rgba(255,255,255,0.055)";
          g.fillRect(x - 3, y(d.vah) - rh / 2, wid + 8, y(d.val) - y(d.vah) + rh);
        }

        g.font = `${Math.max(6, Math.floor(Math.min(rh, cw) - 1.5))}px ui-monospace, monospace`;
        g.textBaseline = "middle";
        g.textAlign = "center";

        for (const b of d.bins) {
          const cy = y(b.price);
          if (!vis(cy)) continue;
          b.periods.forEach((pi, i) => {
            // collapsed → pack left by order; split → park in the period's column
            const cx = x + (split ? pi : i) * cw;
            let fill: string, txt: string;
            if (Math.abs(b.price - d.poc) < 1e-9) { fill = "#F2A93B"; txt = "#3d2405"; }
            else if (pi < IB_PERIODS) { fill = HOME_THEME.red; txt = "#ffffff"; }
            else { fill = "#5B9BD5"; txt = "#0b1a26"; }
            g.fillStyle = fill;
            g.fillRect(cx, cy - rh / 2 + 0.5, cw - 1.2, rh - 1);
            if (rh >= 7 && cw >= 6) {
              g.fillStyle = txt;
              g.fillText(TPO_LETTERS[pi % TPO_LETTERS.length], cx + (cw - 1.2) / 2, cy);
            }
          });
        }

        g.textAlign = "left";
        g.font = "10px ui-monospace, monospace";
        const tag = (price: number, color: string, label: string, len: number) => {
          if (!vis(y(price))) return;
          g.strokeStyle = color; g.lineWidth = 1;
          g.beginPath(); g.moveTo(x + wid + 4, y(price)); g.lineTo(x + wid + len, y(price)); g.stroke();
          g.fillStyle = color;
          g.fillText(label, x + wid + len + 4, y(price));
        };
        tag(d.poc, "#F2A93B", `P: ${d.poc.toFixed(2)}`, 46);
        tag(d.mid, HOME_THEME.red, `M: ${d.mid.toFixed(2)}`, 34);
        tag(d.high, "rgba(140,190,235,0.8)", `H: ${d.high.toFixed(2)}`, 26);
        tag(d.low, "rgba(140,190,235,0.8)", `L: ${d.low.toFixed(2)}`, 26);

        for (const s of d.structures) {
          if (s.kind === "naked_poc") continue;
          g.fillStyle = KIND_COLOR[s.kind];
          g.fillRect(x - 6, y(s.priceHi) - rh / 2, 3, y(s.priceLo) - y(s.priceHi) + rh);

          const yTop = y(s.priceHi) - rh / 2;
          const yBot = y(s.priceLo) + rh / 2;
          if (yBot > TOP - rh && yTop < VIEW_H - BOT + rh) {
            // Hover regions for EVERY session (the spine is already drawn for
            // all of them); the outlined band is only painted on today's.
            callouts.push({
              s, color: KIND_COLOR[s.kind], yTop, yBot,
              x0: x - 8, x1: x + wid + 4, today: d.date === lastDate,
            });
          }
        }

        g.fillStyle = "rgba(255,255,255,0.9)";
        g.font = "10px ui-sans-serif, system-ui";
        g.textAlign = "left";
        g.fillText(d.date.slice(5), x, VIEW_H - 10);
      }

      x += wid + GUTTER;
    }

    // ── structure bands ─────────────────────────────────────────────────────
    // The BOX stays on the chart; the text card moved to hover. Five sessions'
    // worth of always-on cards was more annotation than profile — and the cards
    // had to be de-collided away from their own bands to fit, which is exactly
    // when a label stops pointing at the thing it labels.
    if (labels) {
      for (const c of callouts) {
        if (!c.today) continue;
        g.strokeStyle = c.color;
        g.lineWidth = 1.5;
        g.fillStyle = `${c.color}1F`;
        const bh = Math.max(4, c.yBot - c.yTop);
        g.beginPath();
        g.roundRect(c.x0, c.yTop, c.x1 - c.x0, bh, 4);
        g.fill();
        g.stroke();
      }
    }

    // Hit regions in CSS px, read by the pointer-move handler. Stored in a ref
    // (not state) on purpose: hover must not re-run this draw.
    hitsRef.current = callouts.map((c) => ({
      s: c.s, color: c.color, x0: c.x0, x1: c.x1, yTop: c.yTop, yBot: c.yBot,
    }));

    if (spot != null && vis(y(spot))) {
      g.strokeStyle = HOME_THEME.green;
      g.setLineDash([5, 4]);
      g.beginPath(); g.moveTo(AXIS, y(spot)); g.lineTo(w - 4, y(spot)); g.stroke();
      g.setLineDash([]);
      g.fillStyle = HOME_THEME.green;
      g.font = "10px ui-monospace, monospace";
      g.textAlign = "right";
      g.fillText(spot.toFixed(2), w - 6, y(spot) - 7);
    }

    // ── open-business levels: unfinished structures drawn ACROSS the strip ──
    // (naked POC / poor high-low / excess / hole), dashed, colored by kind, so
    // "open business" lives on the chart instead of a separate table.
    if (levels && levels.length) {
      g.save();
      for (const st of levels) {
        const pr = (st.priceLo + st.priceHi) / 2;
        const py = y(pr);
        if (!vis(py)) continue;
        const col = KIND_COLOR[st.kind] || "#ffffff";
        g.setLineDash([5, 4]); g.globalAlpha = 0.5; g.strokeStyle = col; g.lineWidth = 1;
        g.beginPath(); g.moveTo(AXIS, py); g.lineTo(w - 4, py); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
        g.font = "700 10px ui-monospace, monospace"; g.textAlign = "right"; g.textBaseline = "bottom";
        g.fillStyle = col;
        g.fillText(`${KIND_LABEL[st.kind]} ${pr.toFixed(2)}`, w - 6, py - 1);
      }
      g.restore();
    }

    g.restore();

    // ── price axis, drawn OUTSIDE the clip so it never scrolls away ─────────
    g.fillStyle = "#0b0f14";
    g.fillRect(0, 0, AXIS, VIEW_H);
    g.font = "10px ui-monospace, monospace";
    g.textBaseline = "middle";
    g.textAlign = "left";
    const stepBins = Math.max(1, Math.round(28 / rh));
    for (let i = 0; i <= rows; i += stepBins) {
      const p = hi - i * binSize;
      const py = y(p);
      if (!vis(py)) continue;
      g.strokeStyle = "rgba(255,255,255,0.05)";
      g.beginPath(); g.moveTo(AXIS, py); g.lineTo(w - 4, py); g.stroke();
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.fillText(p.toFixed(2), 4, py);
    }
  }, [sessions, spot, binSize, w, split, labels, zx, zy, ox, oy, levels]);

  const btn = (active: boolean): React.CSSProperties => ({
    padding: "3px 10px", borderRadius: 6, fontSize: 14, cursor: "pointer", fontWeight: 700,
    border: `1px solid ${active ? HOME_THEME.cyan : "rgba(255,255,255,0.15)"}`,
    background: active ? "rgba(33,158,188,0.15)" : "transparent",
    color: active ? HOME_THEME.text : HOME_THEME.text,
  });

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => setSplit(false)} style={btn(!split)}>Collapsed</button>
        <button onClick={() => setSplit(true)} style={btn(split)}>Split / expanded</button>
        <span style={{ width: 10 }} />
        <button onClick={() => setLabels((v) => !v)} style={btn(labels)}>Labels</button>
        <span style={{ width: 10 }} />
        <button onClick={() => setZy((z) => Math.min(8, z * 1.25))} style={btn(false)}>Price +</button>
        <button onClick={() => setZy((z) => Math.max(0.4, z / 1.25))} style={btn(false)}>Price −</button>
        <button onClick={() => setZx((z) => Math.min(6, z * 1.25))} style={btn(false)}>Width +</button>
        <button onClick={() => setZx((z) => Math.max(0.4, z / 1.25))} style={btn(false)}>Width −</button>
        <button onClick={reset} style={btn(false)}>Reset</button>
        <span style={{ fontSize: 14, color: HOME_THEME.text, marginLeft: 4 }}>
          drag to pan · wheel = price zoom · shift+wheel = width zoom · hover a structure for detail
        </span>
      </div>

      <canvas
        ref={ref}
        onPointerDown={(e) => {
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ox, oy };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) {
            if (hover) setHover(null);
            setOx(d.ox + (e.clientX - d.x));
            setOy(d.oy + (e.clientY - d.y));
            return;
          }
          const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
          const mx = e.clientX - r.left, my = e.clientY - r.top;
          // 3px pad: a 1-pt poor high is ~5px tall and otherwise un-hoverable.
          const hit = hitsRef.current.find(
            (h) => mx >= h.x0 - 3 && mx <= h.x1 + 3 && my >= h.yTop - 3 && my <= h.yBot + 3,
          );
          if (!hit) { if (hover) setHover(null); return; }
          if (hover?.hit.s.id !== hit.s.id || hover.x !== mx) setHover({ hit, x: mx, y: my });
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        style={{
          display: "block", width: "100%", height: VIEW_H,
          background: "#0b0f14", borderRadius: 10,
          cursor: drag.current ? "grabbing" : hover ? "pointer" : "grab",
          touchAction: "none",
        }}
      />

      {hover && (
        <div style={{
          position: "absolute", pointerEvents: "none", zIndex: 5,
          left: Math.min(hover.x + 14, Math.max(0, w - 290)),
          top: Math.min(hover.y + 12, VIEW_H - 92),
          width: 268, padding: "9px 11px", borderRadius: 8,
          background: "rgba(11,15,20,0.96)",
          border: `1px solid ${hover.hit.color}`,
          boxShadow: `0 6px 20px rgba(0,0,0,0.5), inset 0 0 0 999px ${hover.hit.color}1A`,
        }}>
          <div style={{ color: hover.hit.color, fontWeight: 700, fontSize: 12 }}>
            {KIND_TITLE[hover.hit.s.kind]}
          </div>
          <div style={{ color: HOME_THEME.text, fontSize: 12, marginTop: 3, lineHeight: 1.35 }}>
            {KIND_NOTE[hover.hit.s.kind]}
          </div>
          <div style={{
            color: HOME_THEME.text, fontSize: 12, marginTop: 5,
            fontVariantNumeric: "tabular-nums",
          }}>
            {hover.hit.s.date} ·{" "}
            {hover.hit.s.priceHi > hover.hit.s.priceLo
              ? `${hover.hit.s.priceLo.toFixed(2)}–${hover.hit.s.priceHi.toFixed(2)}`
              : hover.hit.s.priceLo.toFixed(2)}
          </div>
        </div>
      )}
    </div>
  );
}

// Badge column widened from 110px: the rail now carries the plain-English
// KIND_TITLE ("Poor low — unfinished") instead of the terse "poor lo", so the
// row states the trade without a hover.
const GRID = "210px 1fr 60px 76px 96px 62px";

function StructureRow({ s, spot, base }: {
  s: TpoStructure;
  spot: number | null;
  base: { rate: number | null; n: number; scope: "bucket" | "kind" | "none" };
}) {
  const color = KIND_COLOR[s.kind];
  const band = s.priceHi > s.priceLo
    ? `${s.priceLo.toFixed(2)}–${s.priceHi.toFixed(2)}`
    : s.priceLo.toFixed(2);
  const mid = (s.priceLo + s.priceHi) / 2;
  const dist = spot != null ? mid - spot : null;

  // The base rate describes the KIND at this AGE — never this specific level.
  // Spelling that out in the tooltip because the old column ("TEST %") read like
  // a per-level probability, which it never was.
  const baseTip =
    base.scope === "none"
      ? `Not enough graded ${KIND_LABEL[s.kind]} structures yet to quote a rate (n=${base.n}).`
      : `${Math.round((base.rate ?? 0) * 100)}% of ${KIND_LABEL[s.kind]} structures ${
          base.scope === "bucket" ? `aged ${ageBucket(s.ageSessions)}` : "(all ages)"
        } were eventually tested — n=${base.n}. This is a base rate for the TYPE, not a probability for this level.`;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: GRID,
      gap: 8, alignItems: "center",
      padding: "9px 12px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      fontSize: 14,
    }}>
      <span title={KIND_MEANING[s.kind]} style={{
        justifySelf: "start", fontSize: 14, fontWeight: 700,
        padding: "2px 9px", borderRadius: 999, cursor: "help",
        whiteSpace: "nowrap",
        color, border: `1px solid ${color}55`, background: `${color}1A`,
      }}>{KIND_TITLE[s.kind]}</span>

      <span style={{ color: HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>{band}</span>
      <span style={{ color: HOME_THEME.text }}>{s.ageSessions}d</span>
      <span style={{
        color: dist == null ? HOME_THEME.text : dist >= 0 ? HOME_THEME.green : HOME_THEME.red,
        fontVariantNumeric: "tabular-nums",
      }}>
        {dist == null ? "—" : `${dist >= 0 ? "+" : ""}${dist.toFixed(2)}`}
      </span>

      <span title={baseTip} style={{ cursor: "help", display: "flex", alignItems: "baseline", gap: 5 }}>
        <span style={{ color: base.rate == null ? HOME_THEME.text : HOME_THEME.text }}>
          {s.kind === "hole" ? "—" : pctOrDash(base.rate)}
        </span>
        {s.kind !== "hole" && base.rate != null && (
          <span style={{ fontSize: 14, color: HOME_THEME.text }}>n={base.n}</span>
        )}
      </span>

      <span style={{ color: s.testedAt ? HOME_THEME.orange : HOME_THEME.text }}>
        {s.testedAt ? `${s.touches}×` : "untested"}
      </span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  AMT — Auction Market Theory read + live signals (over the TPO profile)
// ══════════════════════════════════════════════════════════════════════════════
//
// Renders lib/amt.ts's AmtRead: a headline read (day type / IB width / state /
// bias) plus a signal rail. A signal fires "LIVE" when spot is within a small
// pad of its trigger price — that liveness is computed HERE per tick so the
// heavy structure scan never re-runs on a WS tick.

const LEVEL_RANK: Record<SignalLevel, number> = { action: 0, watch: 1, info: 2 };
const LEVEL_COLOR: Record<SignalLevel, string> = {
  action: HOME_THEME.orange,
  watch: LIGHT_BLUE,
  info: HOME_THEME.text,
};
const dirGlyph = (d: AmtSignal["dir"]) =>
  d === "up" ? { g: "▲", c: HOME_THEME.green } : d === "down" ? { g: "▼", c: HOME_THEME.red } : { g: "◆", c: HOME_THEME.text };

function AmtSignalRow({ s, spot, livePad }: { s: AmtSignal; spot: number | null; livePad: number }) {
  const live = s.trigger != null && spot != null && Math.abs(spot - s.trigger) <= livePad;
  const dist = s.trigger != null && spot != null ? s.trigger - spot : null;
  const lvlColor = LEVEL_COLOR[s.level];
  const dg = dirGlyph(s.dir);
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "70px 1fr 96px",
      gap: 10, alignItems: "start", padding: "9px 12px",
      borderRadius: 8,
      border: `1px solid ${live ? HOME_THEME.green : "rgba(255,255,255,0.08)"}`,
      background: live ? `${HOME_THEME.green}14` : "rgba(255,255,255,0.02)",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{
          fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase",
          color: lvlColor, border: `1px solid ${lvlColor}55`, background: `${lvlColor}18`,
          borderRadius: 5, padding: "2px 6px", textAlign: "center",
        }}>{s.level}</span>
        {live && (
          <span style={{ fontSize: 12, fontWeight: 800, color: HOME_THEME.green, textAlign: "center", letterSpacing: "0.04em" }}>
            ● LIVE
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: HOME_THEME.text, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: dg.c }}>{dg.g}</span>{s.title}
        </span>
        <span style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.45 }}>{s.detail}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "right", fontSize: 14 }}>
        <span style={{ color: HOME_THEME.text, fontWeight: 700 }}>
          {s.trigger != null ? s.trigger.toFixed(2) : "—"}
        </span>
        <span style={{ color: HOME_THEME.text }}>
          {s.target != null ? `→ ${s.target.toFixed(2)}` : "trail"}
        </span>
        {dist != null && (
          <span style={{ color: HOME_THEME.text }}>
            {dist >= 0 ? "+" : ""}{dist.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

function AmtPanel({ amt, spot, binSize }: { amt: AmtRead; spot: number | null; binSize: number }) {
  // Live pad: 2 bins or ~0.12% of price, whichever is larger — enough to catch a
  // level as spot approaches it without lighting up the whole rail.
  const livePad = Math.max(binSize * 2, (spot ?? 0) * 0.0012);

  const signals = useMemo(() => {
    const withLive = amt.signals.map((s) => {
      const live = s.trigger != null && spot != null && Math.abs(spot - s.trigger) <= livePad;
      const dist = s.trigger != null && spot != null ? Math.abs(s.trigger - spot) : Infinity;
      return { s, live, dist };
    });
    return withLive
      .sort((a, b) =>
        (Number(b.live) - Number(a.live)) ||
        (LEVEL_RANK[a.s.level] - LEVEL_RANK[b.s.level]) ||
        (a.dist - b.dist))
      .map((x) => x.s);
  }, [amt.signals, spot, livePad]);

  const liveCount = signals.filter((s) => s.trigger != null && spot != null && Math.abs(spot - s.trigger) <= livePad).length;

  const ibColor = amt.ibClass === "narrow" ? HOME_THEME.orange : amt.ibClass === "wide" ? HOME_THEME.cyan : HOME_THEME.text;
  const stateColor =
    amt.state === "imbalance_up" || amt.state === "shift_up" ? HOME_THEME.green
    : amt.state === "imbalance_down" || amt.state === "shift_down" ? HOME_THEME.red
    : LIGHT_BLUE;

  if (!amt.ok) {
    return (
      <Card variant="budget" title={<span style={{ fontSize: 17, color: HOME_THEME.cyan }}>AMT — auction read &amp; live signals</span>}>
        <div style={{ padding: 20, textAlign: "center", color: HOME_THEME.text, fontSize: 14 }}>
          {amt.reason}
        </div>
      </Card>
    );
  }

  const tile = (label: string, value: React.ReactNode, note?: string, color?: string) => (
    <div style={{
      padding: "10px 12px", borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)",
      display: "flex", flexDirection: "column", gap: 3, minWidth: 0,
    }}>
      <span style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: HOME_THEME.text }}>{label}</span>
      <span style={{ fontSize: 17, fontWeight: 800, color: color ?? HOME_THEME.text }}>{value}</span>
      {note && <span style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.4 }}>{note}</span>}
    </div>
  );

  return (
    <Card variant="budget"
      title={<span style={{ fontSize: 17, color: HOME_THEME.cyan }}>AMT — auction read &amp; live signals</span>}
      subtitle={`Day-timeframe read vs prior value${liveCount ? ` · ${liveCount} live` : ""}${spot != null ? ` · spot ${spot.toFixed(2)}` : ""}`}>

      {/* headline read */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
        {tile("Day type", amt.dayType.label, amt.dayType.note)}
        {tile("IB width", amt.ibRatio != null ? `${amt.ibClass} · ${amt.ibRatio.toFixed(2)}×` : "building", "vs recent-median IB", ibColor)}
        {tile("State", amt.stateLabel.split(" — ")[0], amt.stateLabel.split(" — ")[1], stateColor)}
        {tile("Opening", amt.opening?.label ?? "—", amt.opening?.note)}
      </div>

      {/* bias banner */}
      <div style={{
        padding: "10px 14px", borderRadius: 10, marginBottom: 14,
        border: `1px solid ${stateColor}40`, background: `${stateColor}0F`,
        fontSize: 14, fontWeight: 600, color: HOME_THEME.text, lineHeight: 1.5,
      }}>
        {amt.bias}
        <div style={{ fontSize: 14, fontWeight: 400, color: HOME_THEME.text, marginTop: 4 }}>{amt.location}</div>
      </div>

      {/* signal rail — collapsed by default; the header is the toggle */}
      <details>
        <summary style={{
          display: "flex", alignItems: "center", gap: 10, cursor: "pointer", listStyle: "none",
          padding: "8px 12px", borderRadius: 10,
          border: `1px solid ${(liveCount ? HOME_THEME.green : HOME_THEME.orange)}40`,
          background: `${liveCount ? HOME_THEME.green : HOME_THEME.orange}0F`,
          borderLeft: `3px solid ${liveCount ? HOME_THEME.green : HOME_THEME.orange}`,
        }}>
          <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: HOME_THEME.text }}>
            Signals &amp; Alerts
          </span>
          <span style={{
            fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase",
            padding: "2px 8px", borderRadius: 999,
            color: liveCount ? HOME_THEME.green : HOME_THEME.text,
            border: `1px solid ${liveCount ? HOME_THEME.green : "rgba(255,255,255,0.25)"}`,
            background: liveCount ? `${HOME_THEME.green}1A` : "rgba(255,255,255,0.04)",
          }}>
            {liveCount ? `● ${liveCount} live` : `${signals.length} armed`}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 13, color: HOME_THEME.text }}>tap to expand</span>
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 10 }}>
          {signals.map((s) => <AmtSignalRow key={s.id} s={s} spot={spot} livePad={livePad} />)}
          {!signals.length && (
            <div style={{ padding: 16, textAlign: "center", color: HOME_THEME.text, fontSize: 14 }}>
              No actionable auction signals yet — waiting on IB and structure to form.
            </div>
          )}
        </div>
      </details>

    </Card>
  );
}

function TpoStructuresScanner() {
  const [instr, setInstr] = useState<"ESU" | "NQU">("ESU");
  const [kindFilter, setKindFilter] = useState<"all" | "extremes" | "holes">("all");
  const [nSessions, setNSessions] = useState<5 | 10 | 30>(5);

  // CALENDAR days to pull vs RTH SESSIONS to draw — not the same number. 30
  // sessions needs ~45 calendar days once weekends and holidays are removed;
  // asking for 30 quietly hands back ~21 profiles. Scaled with the selector so
  // the 5-day view doesn't drag a month of bars out of SQLite for nothing.
  const historyDays = nSessions <= 5 ? 14 : nSessions <= 10 ? 22 : 46;

  const es = useEsCandles(instr === "ESU", historyDays);
  const nq = useNqCandles(instr === "NQU", historyDays);
  const { candles: liveCandles, historical } = instr === "ESU" ? es : nq;

  const allCandles = useMemo(() => {
    const map = new Map<string, EsCandle>();
    for (const c of historical) map.set(c.slotKey, c as EsCandle);
    for (const c of liveCandles) map.set(c.slotKey, c as EsCandle);
    return [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
  }, [liveCandles, historical]);

  const candles = useMemo(() => {
    const tag = instr === "ESU" ? "ESU" : "NQU";
    const filtered = allCandles.filter((c) => (c.symbol ?? "").toUpperCase().includes(tag));
    return filtered.length ? filtered : allCandles;
  }, [allCandles, instr]);

  // Coarse key — the structure scan is a multi-day walk and must NOT re-run on
  // every intrabar WS tick. (Recomputing a full multi-day profile scan per tick
  // is what froze this tab the last time; keep it keyed to bar COUNT only.)
  const barCountKey = useMemo(() => {
    const last = candles[candles.length - 1];
    return `${candles.length}:${last?.date ?? ""}`;
  }, [candles]);

  const binSize = instr === "NQU" ? 5 : 1;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const res = useMemo(() => buildTpoStructures(candles, binSize), [barCountKey, binSize]);

  const spot = candles[candles.length - 1]?.close ?? null;
  const today = res.sessions[res.sessions.length - 1] ?? null;

  // AMT read is derived from the already-memoized structure scan, so it only
  // recomputes once per bar (via `res`), never per WS tick. Signal liveness (spot
  // vs trigger) is computed inside AmtPanel at render, so alerts still react live.
  const amt = useMemo(() => amtRead(res), [res]);

  const open = useMemo(() => {
    const rows = res.open.filter((s) => {
      if (kindFilter === "holes") return s.kind === "hole";
      if (kindFilter === "extremes") return s.kind !== "hole";
      return true;
    });
    if (spot == null) return rows;
    return [...rows].sort((a, b) => {
      const da = Math.abs((a.priceLo + a.priceHi) / 2 - spot);
      const db = Math.abs((b.priceLo + b.priceHi) / 2 - spot);
      return da - db;
    });
  }, [res, kindFilter, spot]);

  const enoughHistory = res.sessions.length >= 2;

  const shown = res.sessions.slice(-nSessions);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── TPO profile + open-business levels drawn on the chart ────────── */}
      <Card variant="budget"
        title={<span style={{ fontSize: 17, color: LIGHT_BLUE }}>TPO profile + open levels — last {shown.length} session{shown.length === 1 ? "" : "s"}</span>}
        subtitle={`${instr} · ${binSize}-pt bins · 30-min periods · RTH · dashed lines = unfinished business (${open.length})`}>

        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => setInstr("ESU")} style={seg(instr === "ESU")}>ESU</button>
          <button onClick={() => setInstr("NQU")} style={seg(instr === "NQU")}>NQU</button>
          <span style={{ width: 12 }} />
          {([5, 10, 30] as const).map((n) => (
            <button key={n} onClick={() => setNSessions(n)} style={seg(nSessions === n)}>{n}D</button>
          ))}
        </div>

        {!shown.length && (
          <div style={{ padding: 24, textAlign: "center", color: HOME_THEME.text, fontSize: 14 }}>
            Waiting on RTH candles.
          </div>
        )}
        {!!shown.length && <TpoLetterProfile sessions={shown} spot={spot} binSize={binSize} levels={open.slice(0, 12)} />}

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12, fontSize: 13, color: HOME_THEME.text }}>
          <span><b style={{ color: KIND_COLOR.naked_poc }}>naked POC</b> — magnet</span>
          <span><b style={{ color: KIND_COLOR.poor_high }}>poor hi/lo</b> — unfinished, target</span>
          <span><b style={{ color: KIND_COLOR.excess_high }}>excess</b> — rejection, holds</span>
          <span><b style={{ color: KIND_COLOR.hole }}>hole</b> — thin, runs through</span>
          <span>· dashed lines = the {open.length} open structures nearest spot</span>
        </div>
      </Card>


      {/* ── AMT auction read — top; signals collapsed inside it ──────────── */}
      <AmtPanel amt={amt} spot={spot} binSize={binSize} />

      {/* ── Forecast one-liner (paired with the auction read) ────────────── */}
      <TpoForecastCard instr={instr} />

      {/* ── RTH open vs prior day + prior week + open naked levels ────────── */}
      {enoughHistory && <TpoOpenLocation res={res} spot={spot} candles={candles} />}

      {/* ── Structure stats — collapsed by default ───────────────────────── */}
      <details>
        <summary style={{ cursor: "pointer", listStyle: "none", fontSize: 15, fontWeight: 800, color: HOME_THEME.cyan, padding: "12px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.09)" }}>
          Structure stats <span style={{ fontSize: 12, fontWeight: 600, color: HOME_THEME.text, textTransform: "uppercase", letterSpacing: "0.05em" }}>· base rates by kind · tap to expand</span>
        </summary>
        <Card variant="budget" title={<span style={{ fontSize: 17, color: HOME_THEME.cyan }}>Structure stats</span>}
          subtitle={`${res.sessions.length} sessions loaded · graded once ≥1 later session exists`}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 44px 62px 70px 56px", gap: 6, padding: "4px 0 6px", borderBottom: "1px solid rgba(255,255,255,0.12)", fontSize: 14, color: HOME_THEME.text, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            <span>kind</span><span>n</span><span>test %</span><span>repair %</span><span>med d</span>
          </div>
          {res.stats.filter((s) => s.n > 0).map((s) => {
            const bks = res.buckets.filter((b) => b.kind === s.kind && b.n > 0);
            return (
              <div key={s.kind} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "7px 0" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 44px 62px 70px 56px", gap: 6, fontSize: 14 }}>
                  <span style={{ color: KIND_COLOR[s.kind], fontWeight: 700 }}>{KIND_LABEL[s.kind]}</span>
                  <span style={{ color: HOME_THEME.text }}>{s.n}</span>
                  <span style={{ color: HOME_THEME.text }}>{pctOrDash(s.testRate)}</span>
                  <span style={{ color: HOME_THEME.text }}>{pctOrDash(s.repairRate)}</span>
                  <span style={{ color: HOME_THEME.text }}>{s.medSessionsToTest ?? "—"}</span>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                  {bks.map((b) => (
                    <span key={b.bucket} style={{ fontSize: 14, color: HOME_THEME.text }}>{b.bucket} <b>{pctOrDash(b.testRate)}</b> n={b.n}</span>
                  ))}
                </div>
              </div>
            );
          })}
          {!res.stats.some((s) => s.n > 0) && (
            <div style={{ padding: 16, color: HOME_THEME.text, fontSize: 14 }}>Not enough history loaded to grade anything yet.</div>
          )}
        </Card>
      </details>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  PAGE SHELL — tab switcher
// ══════════════════════════════════════════════════════════════════════════════

export default function ScannerPage() {
  const [tab, setTab] = useState<MainTab>("gex");

  // Deep link support: /scanner?tab=ibstats opens straight on that tab. Read in
  // an effect (not useSearchParams) so the page stays prerenderable and there's
  // no hydration mismatch — the default tab renders first, then swaps on mount.
  useEffect(() => {
    const fromUrl = readTabFromUrl();
    if (fromUrl) setTab(fromUrl as MainTab);
  }, []);

  // The GlobalToolbar's Scanner sub-strip links to /scanner?tab=… . While we are
  // already on /scanner that is a query-string-only navigation, which React
  // Router does not remount for — the URL would change and the visible tab
  // wouldn't. The strip fires SCANNER_TAB_EVENT on click; flip the tab here.
  useEffect(() => {
    const onTab = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) setTab(id as MainTab);
    };
    window.addEventListener(SCANNER_TAB_EVENT, onTab);
    return () => window.removeEventListener(SCANNER_TAB_EVENT, onTab);
  }, []);

  return (
    <PageShell>
      {tab === "gex"    && <GexScanner />}
      {tab === "strike" && <StrikeQueryScanner />}
      {tab === "watch"  && <WatchThisScanner />}
      {tab === "marketquality" && <MarketQualityScanner />}
      {tab === "tpo" && <TpoStructuresScanner />}
      {tab === "ibstats" && <IbStatsTab />}
      {tab === "statprompter" && <StatPrompterTab />}
      {tab === "gexchangetop" && <GexChangeTop />}
      {tab === "gexpct" && <GexPctTab />}
    </PageShell>
  );
}
