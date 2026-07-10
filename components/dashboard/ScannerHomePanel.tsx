"use client";

/**
 * ScannerHomePanel — self-contained home-dashboard tab panel extracted from
 * /scanner (app/scanner/page.tsx). Brings over ONLY:
 *   1. GEX Change Scanner — cross-ticker GEX anomaly leaderboard.
 *   2. Watch This — Far CB — highest-GEX far-OTM strike per ticker + tracked
 *      touch outcomes.
 *
 * No toolbar/nav/page-shell — fills whatever box it's placed in, with an
 * internal scroll area so it behaves inside a compact home-grid tab. Fetches
 * from the same /proxy + /api endpoints the full scanner page uses; no new
 * data plumbing was added.
 *
 * Zero required props: <ScannerHomePanel />
 */

import { useCallback, useEffect, useState } from "react";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";

// ── shared style/format helpers (ported from app/scanner/page.tsx) ──────────

const fmtB = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? "-" : "+";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(0)}`;
};

const th: React.CSSProperties = { padding: "5px 8px", textAlign: "right", fontWeight: 700, letterSpacing: "0.05em", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "5px 8px", textAlign: "right", color: HOME_THEME.text };

const seg = (active: boolean): React.CSSProperties => ({
  padding: "5px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: 700,
  border: `1px solid ${active ? HOME_THEME.cyan : "rgba(255,255,255,0.15)"}`,
  background: active ? "rgba(33,158,188,0.15)" : "transparent",
  color: active ? HOME_THEME.text : "rgba(255,255,255,0.7)",
  whiteSpace: "nowrap",
});

const zColor = (z: number | null) =>
  z == null ? "rgba(255,255,255,0.4)"
  : Math.abs(z) >= 3 ? HOME_THEME.red
  : Math.abs(z) >= 2 ? HOME_THEME.orange
  : HOME_THEME.text;

// ══════════════════════════════════════════════════════════════════════════
//  GEX CHANGE SCANNER  (app/scanner/page.tsx lines ~168-399)
// ══════════════════════════════════════════════════════════════════════════

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
};
type Win = 5 | 15 | 30 | 60;
type GexSort = "z" | "abs" | "otm" | "pct";
type ColSort = { col: "latest_chg" | "mean_chg" | "z" | "otm_dist" | "pct_open"; dir: "desc" | "asc" } | null;

function GexScannerPanel() {
  const [rows, setRows] = useState<GexRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [win, setWin] = useState<Win>(15);
  const [sort, setSort] = useState<GexSort>("z");
  const [minZ, setMinZ] = useState(0);
  const [colSort, setColSort] = useState<ColSort>(null);
  const [moneyness, setMoneyness] = useState<"all" | "otm">("all");
  const [minOtm, setMinOtm] = useState(0.02);

  const toggleColSort = (col: "latest_chg" | "mean_chg" | "z" | "otm_dist" | "pct_open") => {
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
    }
  };

  const displayRows = colSort
    ? [...rows].sort((a, b) => {
        const av = colSortValue(a, colSort.col);
        const bv = colSortValue(b, colSort.col);
        return colSort.dir === "desc" ? bv - av : av - bv;
      })
    : rows;

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const u = new URL("/proxy/strike-growth/scanner", window.location.origin);
      u.searchParams.set("window", String(win));
      u.searchParams.set("sort", sort);
      u.searchParams.set("minZ", String(minZ));
      u.searchParams.set("limit", "25");
      if (moneyness === "otm") u.searchParams.set("minOtm", String(minOtm));
      const res = await fetch(u.toString(), { cache: "no-store" });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Server returned ${res.status} (non-JSON). Recorder may not have run yet.`); }
      if (!j.ok) throw new Error(j.error || "load failed");
      setRows(j.rows || []);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, [win, sort, minZ, moneyness, minOtm]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => load(), 60_000); return () => clearInterval(t); }, [load]);

  return (
    <Card variant="budget" padding={12}
      subtitle={`Stocks only · biggest ${win}m moves${sort === "z" ? " ranked by anomaly" : " by size"}${moneyness === "otm" ? ` · OTM only (≥${(minOtm * 100).toFixed(0)}%)` : ""}${loading ? " · refreshing…" : ""}`}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {([5, 15, 30, 60] as Win[]).map((w) => (
            <button key={w} onClick={() => setWin(w)} style={seg(win === w)}>{w}m</button>
          ))}
        </div>
        <span style={{ color: HOME_THEME.border }}>|</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setSort("z")} style={seg(sort === "z")}>Unusual (z)</button>
          <button onClick={() => setSort("abs")} style={seg(sort === "abs")}>Biggest</button>
          <button onClick={() => setSort("otm")} style={seg(sort === "otm")}>OTM-wt</button>
          <button onClick={() => setSort("pct")} style={seg(sort === "pct")}>%vs open</button>
        </div>
        <span style={{ color: HOME_THEME.border }}>|</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setMoneyness("all")} style={seg(moneyness === "all")}>All</button>
          <button onClick={() => setMoneyness("otm")} style={seg(moneyness === "otm")}>OTM</button>
        </div>
        {moneyness === "otm" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: HOME_THEME.orange }}>
            min OTM
            <select value={minOtm} onChange={(e) => setMinOtm(Number(e.target.value))}
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text, border: "1px solid rgba(255,255,255,0.15)" }}>
              <option value={0.02}>2%+</option>
              <option value={0.05}>5%+</option>
              <option value={0.10}>10%+</option>
              <option value={0.15}>15%+</option>
              <option value={0.20}>20%+</option>
            </select>
          </label>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: HOME_THEME.green }}>
          min z
          <select value={minZ} onChange={(e) => setMinZ(Number(e.target.value))}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text, border: "1px solid rgba(255,255,255,0.15)" }}>
            <option value={0}>any</option>
            <option value={1.5}>1.5+</option>
            <option value={2}>2.0+</option>
            <option value={3}>3.0+</option>
          </select>
        </label>
        <button onClick={() => load()} style={seg(false)}>↻</button>
      </div>

      {err && <div style={{ color: HOME_THEME.red, marginBottom: 10, fontSize: 12 }}>{err}</div>}

      <div style={{ overflow: "auto", maxHeight: "100%" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 11, textTransform: "uppercase", position: "sticky", top: 0, background: HOME_THEME.panel, zIndex: 1 }}>
              <th style={{ ...th, textAlign: "left" }}>#</th>
              <th style={{ ...th, textAlign: "left" }}>Symbol</th>
              <th style={th}>Spot</th>
              <th style={th}>Strike</th>
              <th style={{ ...th, textAlign: "left" }}>Expiry</th>
              {(["latest_chg", "mean_chg", "z"] as const).map((col) => {
                const label = col === "latest_chg" ? `${win}m Δ` : col === "mean_chg" ? "Avg Δ" : "z-score";
                const active = colSort?.col === col;
                const arrow = active ? (colSort!.dir === "desc" ? " ↓" : " ↑") : " ⇅";
                return (
                  <th key={col} onClick={() => toggleColSort(col)} style={{ ...th, cursor: "pointer", color: active ? HOME_THEME.cyan : HOME_THEME.green, userSelect: "none" }}>
                    {label}<span style={{ opacity: active ? 1 : 0.4 }}>{arrow}</span>
                  </th>
                );
              })}
              {([
                { col: "otm_dist" as const, label: "OTM%" },
                { col: "pct_open" as const, label: "%vsOpen" },
              ]).map(({ col, label }) => {
                const active = colSort?.col === col;
                const arrow = active ? (colSort!.dir === "desc" ? " ↓" : " ↑") : " ⇅";
                return (
                  <th key={col} onClick={() => toggleColSort(col)} style={{ ...th, cursor: "pointer", color: active ? HOME_THEME.cyan : HOME_THEME.green, userSelect: "none" }}>
                    {label}<span style={{ opacity: active ? 1 : 0.4 }}>{arrow}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r, i) => {
              const up = r.latest_chg >= 0;
              const col = up ? HOME_THEME.green : HOME_THEME.red;
              const otmPct = (r.otm_dist ?? 0) * 100;
              return (
                <tr key={`${r.symbol}-${r.expiry}-${r.strike}`}
                  style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                  <td style={{ ...td, textAlign: "left", color: HOME_THEME.text, fontWeight: 700 }}>{i + 1}</td>
                  <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{r.symbol}</td>
                  <td style={{ ...td, color: "rgba(255,255,255,0.7)" }}>{r.spot > 0 ? r.spot.toFixed(2) : "—"}</td>
                  <td style={td}>{r.strike}</td>
                  <td style={{ ...td, textAlign: "left", color: "rgba(255,255,255,0.7)" }}>{r.expiry}</td>
                  <td style={{ ...td, color: col, fontWeight: 800 }}>{fmtB(r.latest_chg)}</td>
                  <td style={td}>{fmtB(r.mean_chg)}</td>
                  <td style={{ ...td, color: zColor(r.z), fontWeight: 800 }}>
                    {r.z == null ? "—" : `${r.z >= 0 ? "+" : ""}${r.z.toFixed(1)}σ`}
                  </td>
                  <td style={{ ...td, color: otmPct >= 5 ? HOME_THEME.orange : "rgba(255,255,255,0.7)" }}>{otmPct.toFixed(1)}%</td>
                  <td style={{ ...td, color: r.pct_open == null ? "rgba(255,255,255,0.4)" : r.pct_open >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                    {r.pct_open == null ? "—" : `${r.pct_open >= 0 ? "+" : ""}${r.pct_open.toFixed(0)}%`}
                  </td>
                </tr>
              );
            })}
            {!rows.length && !loading && (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                No qualifying moves yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  WATCH THIS — FAR CB  (app/scanner/page.tsx lines ~1372-1774)
// ══════════════════════════════════════════════════════════════════════════

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
};

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

function WatchThisPanel() {
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);

  const [outcomes, setOutcomes] = useState<OutcomeRow[]>([]);
  const [outcomeStatus, setOutcomeStatus] = useState<"all" | "open" | "touched" | "expired">("all");

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
    try {
      const res = await fetch(`/proxy/far-cb-outcomes?status=${outcomeStatus}&limit=100`, { cache: "no-store" });
      const j = await res.json();
      if (j.ok) setOutcomes(j.rows || []);
    } catch {}
  }, [outcomeStatus]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => load(), 120_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { loadOutcomes(); }, [loadOutcomes]);

  return (
    <Card variant="budget" padding={12}
      subtitle={`Highest GEX strike ≤30d, far OTM vs spot · EM watchlist${threshold != null ? ` · >${threshold}% OTM` : ""}${loading ? " · refreshing…" : ""}`}>

      {err && (
        <div style={{ color: HOME_THEME.orange, marginBottom: 10, fontSize: 12 }}>
          {err.includes("no DB") || err.includes("503")
            ? "Recorder hasn't run yet — data appears after the first RTH sweep."
            : err}
        </div>
      )}

      {!rows.length && !loading && !err && (
        <div style={{ padding: 16, textAlign: "center", color: HOME_THEME.text, fontSize: 12 }}>
          Nothing flagged right now — no watchlist ticker has an unusually far-OTM dominant CB level.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginBottom: 16 }}>
        {rows.map((r) => {
          const up = r.gex_value >= 0;
          const chainHref = `/options-chain?symbol=${encodeURIComponent(r.symbol)}&expiry=${encodeURIComponent(r.expiry)}&strike=${r.strike}`;
          return (
            <div key={`${r.symbol}-${r.expiry}-${r.strike}`} style={{
              borderRadius: 10,
              padding: "10px 12px",
              background: `radial-gradient(circle at 50% 0%, rgba(126,211,252,0.08) 0%, transparent 60%), rgba(13,17,25,0.20)`,
              backdropFilter: "blur(20px)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontWeight: 800, fontSize: 12, color: up ? HOME_THEME.green : HOME_THEME.red }}>{r.symbol}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: up ? HOME_THEME.green : HOME_THEME.red, opacity: 0.85 }}>${r.spot.toFixed(2)}</span>
                </span>
                <span style={{ fontSize: 10, fontWeight: 800, color: LIGHT_BLUE, letterSpacing: "0.05em" }}>WATCH</span>
              </div>
              <div style={{ fontSize: 12, color: LIGHT_BLUE, fontWeight: 700, marginBottom: 4 }}>
                ${r.strike} <span style={{ color: HOME_THEME.text, fontWeight: 400 }}>· {r.expiry} · {r.dte_days}d</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: up ? HOME_THEME.green : HOME_THEME.red }}>
                    <span style={{ color: HOME_THEME.text, opacity: 0.6, fontWeight: 600 }}>OI+V </span>
                    {fmtB(r.gex_value)}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: (r.gex_value_vol ?? 0) >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                    <span style={{ color: HOME_THEME.text, opacity: 0.6, fontWeight: 600 }}>V </span>
                    {r.gex_value_vol != null ? fmtB(r.gex_value_vol) : "—"}
                  </span>
                </span>
                <a href={chainHref} style={{ fontSize: 11, color: LIGHT_BLUE, fontWeight: 700, textDecoration: "none" }}>
                  Chain →
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: HOME_THEME.text }}>Tracked results</span>
          <div style={{ display: "flex", gap: 4 }}>
            {(["all", "open", "touched", "expired"] as const).map((s) => (
              <button key={s} onClick={() => setOutcomeStatus(s)} style={seg(outcomeStatus === s)}>
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflow: "auto", maxHeight: 280 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 11, textTransform: "uppercase", position: "sticky", top: 0, background: HOME_THEME.panel, zIndex: 1 }}>
                <th style={{ ...th, textAlign: "left" }}>Symbol</th>
                <th style={th}>Strike</th>
                <th style={{ ...th, textAlign: "left" }}>Expiry</th>
                <th style={{ ...th, textAlign: "left" }}>Flagged</th>
                <th style={th}>Spot@flag</th>
                <th style={th}>OTM@flag</th>
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
                  <td style={{ ...td, textAlign: "left", color: HOME_THEME.text }}>{o.expiry}</td>
                  <td style={{ ...td, textAlign: "left", color: HOME_THEME.text }}>{o.first_flagged}</td>
                  <td style={td}>${o.spot_at_flag.toFixed(2)}</td>
                  <td style={td}>{o.otm_pct_at_flag.toFixed(0)}%</td>
                  <td style={{ ...td, color: o.closest_pct != null && o.closest_pct < 1 ? LIGHT_BLUE : HOME_THEME.text }}>
                    {o.closest_pct != null ? `${o.closest_pct.toFixed(1)}%` : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "left" }}>
                    <span style={{
                      fontSize: 11, fontWeight: 800, letterSpacing: "0.05em",
                      color: o.status === "touched" ? LIGHT_BLUE : o.status === "expired" ? HOME_THEME.text : HOME_THEME.green,
                    }}>
                      {o.status === "touched" ? `TOUCHED ${o.touched_date ?? ""}` : o.status.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
              {!outcomes.length && (
                <tr><td colSpan={8} style={{ padding: 16, textAlign: "center", color: HOME_THEME.text }}>
                  No tracked flags yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(detailLoading || detail || detailErr) && (
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
              width: "min(640px, 100%)", maxHeight: "80vh", overflowY: "auto",
              borderRadius: 12, padding: "16px 18px",
              background: "rgba(13,17,25,0.97)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: HOME_THEME.text }}>
                  {detail ? `${detail.symbol} · $${detail.strike} ${detail.type === "C" ? "Call" : "Put"} · ${detail.expiry}` : "Loading…"}
                </div>
                {detail && (
                  <div style={{ fontSize: 11, color: HOME_THEME.text, opacity: 0.75, marginTop: 2 }}>
                    Flagged {detail.firstFlagged} at spot ${detail.spotAtFlag.toFixed(2)} ({detail.otmPctAtFlag.toFixed(0)}% OTM) ·{" "}
                    <span style={{ color: detail.status === "touched" ? LIGHT_BLUE : detail.status === "expired" ? HOME_THEME.text : HOME_THEME.green, fontWeight: 700 }}>
                      {detail.status === "touched" ? `TOUCHED ${detail.touchedDate ?? ""}` : detail.status.toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              <button onClick={closeDetail} style={{ ...seg(false), padding: "3px 8px" }}>✕</button>
            </div>

            {detailLoading && (
              <div style={{ padding: 20, textAlign: "center", color: HOME_THEME.text, fontSize: 12 }}>Loading day-by-day detail…</div>
            )}
            {detailErr && (
              <div style={{ padding: 20, textAlign: "center", color: HOME_THEME.orange, fontSize: 12 }}>{detailErr}</div>
            )}
            {detail && !detail.days.length && (
              <div style={{ padding: 20, textAlign: "center", color: HOME_THEME.text, fontSize: 12 }}>No daily bars yet.</div>
            )}
            {detail && !!detail.days.length && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 11, textTransform: "uppercase" }}>
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
      )}
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//  HOME PANEL — internal sub-tab toggle between the two extracted scanners
// ══════════════════════════════════════════════════════════════════════════

type SubTab = "gex" | "watch";

export default function ScannerHomePanel() {
  const [subTab, setSubTab] = useState<SubTab>("gex");

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexShrink: 0 }}>
        <button onClick={() => setSubTab("gex")} style={seg(subTab === "gex")}>GEX Scanner</button>
        <button onClick={() => setSubTab("watch")} style={seg(subTab === "watch")}>Watch This — Far CB</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {subTab === "gex" ? <GexScannerPanel /> : <WatchThisPanel />}
      </div>
    </div>
  );
}
