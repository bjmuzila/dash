"use client";

/**
 * /scanner — three-tab scanner:
 *   GEX Change Scanner  — cross-ticker GEX anomaly leaderboard (stocks)
 *   Greeks Sensitivity  — per-strike Charm / Vanna / Gamma / TG-Imbalance for SPX
 *   Vol Pin             — IV-RV spread contraction + price range tightening → pin candidates
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { HOME_THEME, LIGHT_BLUE, classicCardAccentStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";
import { useEsCandles, type EsCandle } from "@/hooks/useEsCandles";
import { useNqCandles } from "@/hooks/useNqCandles";
import { computeValueArea } from "@/lib/valueArea";
import { classifyDay, backtestQuadrants, sessionDates, rthBarsForDate, CONFIRM_BARS, type Quadrant } from "@/lib/balanceImbalance";

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

type MainTab = "overview" | "gex" | "greeks" | "volpin" | "strike" | "oi" | "watch" | "marketquality" | "balance";

// ══════════════════════════════════════════════════════════════════════════════
//  OVERVIEW / LANDING (default tab) — cards explaining each scanner
// ══════════════════════════════════════════════════════════════════════════════

type ScanMeta = {
  tab: Exclude<MainTab, "overview">;
  title: string;
  accent: string;
  scope: string;
  what: string;
  tells: string;
};

const SCAN_META: ScanMeta[] = [
  {
    tab: "gex",
    title: "GEX Change Scanner",
    accent: HOME_THEME.cyan,
    scope: "Stocks · cross-ticker",
    what: "Ranks strikes across the whole ticker universe by how much their GEX has moved in the last 5–60 minutes, either by raw size or by z-score vs their own recent history.",
    tells: "Where dealer hedging pressure is building fastest right now — the strikes seeing unusually large, non-routine gamma shifts.",
  },
  {
    tab: "greeks",
    title: "Greeks Sensitivity Scanner",
    accent: HOME_THEME.purple,
    scope: "SPX · per-strike",
    what: "Tracks Charm (delta decay), Vanna (vol-driven delta), Gamma acceleration, and a combined Theta-Gamma imbalance score, per strike.",
    tells: "Which strikes are heating up fastest on delta decay or vol sensitivity — used to spot 0DTE pin risk or zones primed for an explosive move.",
  },
  {
    tab: "volpin",
    title: "Vol Pin Scanner",
    accent: HOME_THEME.orange,
    scope: "Stocks · IV/RV + range",
    what: "Watches IV-RV spread contraction and intraday price-range tightening together, versus each ticker's highest-OI strike.",
    tells: "Classic pre-pin signatures — vol crush plus range compression near a magnet strike — flagging PINNING / SQUEEZING / WATCHING candidates into expiry.",
  },
  {
    tab: "strike",
    title: "Strike Query Scanner",
    accent: HOME_THEME.green,
    scope: "Any ticker · drill-down",
    what: "Ad-hoc lookup of GEX-now and 15/30/60m change per strike, for one ticker or the whole watchlist, sortable by any column.",
    tells: "A quick manual drill-down into exactly which strikes are gaining or losing GEX right now — the tool for \"what's happening at this specific strike.\"",
  },
  {
    tab: "oi",
    title: "OI Change Scanner",
    accent: HOME_THEME.red,
    scope: "EM watchlist (~380 names)",
    what: "Compares today's posted open interest to the prior session's, OTM-only, across the full EM watchlist.",
    tells: "Where new positioning built or unwound overnight — an early read on fresh dealer/positioning changes before the day's price action confirms it.",
  },
  {
    tab: "watch",
    title: "Watch This — Far CB",
    accent: LIGHT_BLUE,
    scope: "EM watchlist · 30d expiries",
    what: "Flags the single highest-GEX strike per ticker (≤30 DTE) when it sits unusually far OTM vs spot, then tracks whether spot ever reaches it.",
    tells: "A structurally dominant level that's currently far from price — worth watching, with a running record of whether it ever gets touched.",
  },
  {
    tab: "marketquality",
    title: "Market Quality Terminal",
    accent: HOME_THEME.orange,
    scope: "Broad market · 5 pillars",
    what: "A single 0–100 Global Market Score blending Volatility, Trend, Breadth, Momentum, and Macro (bonds/dollar) pillars from live index and sector-ETF data.",
    tells: "Whether the overall tape is a favorable, cautious, or risk-off environment for sizing new trades — a top-down regime check before you drill into any single ticker.",
  },
  {
    tab: "balance",
    title: "Balance / Imbalance",
    accent: LIGHT_BLUE,
    scope: "ESU / NQU · Auction Market Theory",
    what: "Classifies today's session into 4 quadrants (Balance / Shift / Imbalance / Re-balance) against the prior RTH day's Value Area (POC/VAH/VAL, volume-profile derived).",
    tells: "Whether price is rangebound in value, breaking value, trending away from it, or hunting new value — plus a historical grade of whether Shifts actually confirm into Imbalance and whether Imbalance actually finds new value.",
  },
];

function ScannerOverview({ onSelect }: { onSelect: (t: MainTab) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
      {SCAN_META.map((s) => (
        <div
          key={s.tab}
          onClick={() => onSelect(s.tab)}
          className="card-hover"
          style={{ ...classicCardAccentStyle, cursor: "pointer", padding: "18px 20px" }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontWeight: 800, fontSize: 18, color: HOME_THEME.text }}>{s.title}</span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: s.accent, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 10 }}>
            {s.scope}
          </div>
          <div style={{ fontSize: 17, color: "rgba(255,255,255,0.75)", lineHeight: 1.5, marginBottom: 10 }}>
            {s.what}
          </div>
          <div style={{ fontSize: 17, color: HOME_THEME.text, lineHeight: 1.5, fontWeight: 600 }}>
            <span style={{ color: s.accent, fontWeight: 800 }}>Tells you: </span>{s.tells}
          </div>
        </div>
      ))}
    </div>
  );
}

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
};
type Win = 5 | 15 | 30 | 60;
type GexSort = "z" | "abs" | "otm" | "pct";
type ColSort = { col: "latest_chg" | "mean_chg" | "z"; dir: "desc" | "asc" } | null;

function GexScanner() {
  const [rows, setRows] = useState<GexRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [win, setWin] = useState<Win>(15);
  const [sort, setSort] = useState<GexSort>("z");
  const [minZ, setMinZ] = useState(0);
  const [colSort, setColSort] = useState<ColSort>(null);

  const toggleColSort = (col: "latest_chg" | "mean_chg" | "z") => {
    setColSort(prev =>
      prev?.col === col
        ? { col, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { col, dir: "desc" }
    );
  };

  const displayRows = colSort
    ? [...rows].sort((a, b) => {
        const av = colSort.col === "z" ? (a.z ?? 0) : (colSort.col === "latest_chg" ? a.latest_chg : a.mean_chg);
        const bv = colSort.col === "z" ? (b.z ?? 0) : (colSort.col === "latest_chg" ? b.latest_chg : b.mean_chg);
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
      const res = await fetch(u.toString(), { cache: "no-store" });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Server returned ${res.status} (non-JSON). Recorder may not have run yet.`); }
      if (!j.ok) throw new Error(j.error || "load failed");
      setRows(j.rows || []);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, [win, sort, minZ]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => load(), 60_000); return () => clearInterval(t); }, [load]);

  return (
    <Card variant="budget" title="GEX Change Scanner"
      subtitle={`Stocks only · biggest ${win}m moves${sort === "z" ? " ranked by anomaly" : " by size"}${loading ? " · refreshing…" : ""}`}>

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
        </div>
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
        <button onClick={() => load()} style={seg(false)}>↻ Refresh</button>
      </div>

      {err && <div style={{ color: HOME_THEME.red, marginBottom: 12 }}>{err}</div>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
          <thead>
            <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 13, textTransform: "uppercase" }}>
              <th style={{ ...th, textAlign: "left" }}>#</th>
              <th style={{ ...th, textAlign: "left" }}>Symbol</th>
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
                    {label}<span style={{ opacity: active ? 1 : 0.4, fontSize: 12 }}>{arrow}</span>
                  </th>
                );
              })}
              <th style={th}>OTM%</th>
              <th style={th}>%vsOpen</th>
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
                </tr>
              );
            })}
            {!rows.length && !loading && (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                No qualifying moves yet. Needs ≥3 snapshots spanning the window — give the recorder ~{win + 10} min of history.
              </td></tr>
            )}
          </tbody>
        </table>
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
    <Card variant="budget" title="Greeks Sensitivity Scanner"
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
        <div style={{ color: HOME_THEME.orange, marginBottom: 12, fontSize: 15 }}>
          {err.includes('no DB') || err.includes('503')
            ? "Recorder hasn't started yet — data appears after the first 5-min RTH snapshot."
            : err}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
          <thead>
            <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 13, textTransform: "uppercase" }}>
              <th style={{ ...th, textAlign: "left" }}>#</th>
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
              <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                No data yet. The recorder runs every 5 min during RTH — needs ≥2 snapshots spanning {win}m.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div style={{ marginTop: 14, display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
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

function PinStatus({ r }: { r: PinRow }) {
  const spreadContracting = (r.spread_delta ?? 0) < -0.005;
  const rangeContracting  = (r.range_delta ?? 0) < -0.001;
  const nearPin = r.pin_dist_pct != null && r.pin_dist_pct < 0.005;

  if (spreadContracting && rangeContracting && nearPin) {
    return <span style={{ color: HOME_THEME.red, fontWeight: 800, fontSize: 13 }}>PINNING</span>;
  }
  if (spreadContracting && rangeContracting) {
    return <span style={{ color: HOME_THEME.orange, fontWeight: 700, fontSize: 13 }}>SQUEEZING</span>;
  }
  if (spreadContracting || rangeContracting) {
    return <span style={{ color: HOME_THEME.cyan, fontWeight: 600, fontSize: 13 }}>WATCHING</span>;
  }
  return <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>—</span>;
}

function VolPinScanner() {
  const [rows, setRows]       = useState<PinRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);
  const [minSnaps, setMinSnaps] = useState(3);

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
    <Card variant="budget" title="Volatility Pin Scanner"
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
        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginLeft: 4 }}>
          Refreshes every 90s · recorder runs every 5m during RTH
        </span>
      </div>

      {err && (
        <div style={{ color: HOME_THEME.orange, marginBottom: 12, fontSize: 15 }}>
          {err.includes('503') || err.includes('no DB')
            ? "Recorder not yet active — data appears after first RTH sweep."
            : err}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
          <thead>
            <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 13, textTransform: "uppercase" }}>
              <th style={{ ...th, textAlign: "left" }}>#</th>
              <th style={{ ...th, textAlign: "left" }}>Symbol</th>
              <th style={th}>Spot</th>
              <th style={th}>Pin Strike</th>
              <th style={th}>Dist</th>
              <th style={th}>Pin OI</th>
              <th style={th}>ATM IV</th>
              <th style={th}>RV</th>
              <th style={th}>IV−RV%</th>
              <th style={th}>Spread Trend</th>
              <th style={th}>Range</th>
              <th style={th}>Range Trend</th>
              <th style={{ ...th, textAlign: "center" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
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
      <div style={{ marginTop: 14, display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
        <span><span style={{ color: HOME_THEME.red }}>PINNING</span> = spread ↓ + range ↓ + within 0.5% of pin strike</span>
        <span><span style={{ color: HOME_THEME.orange }}>SQUEEZING</span> = spread ↓ + range ↓</span>
        <span>Pin strike = highest OI within ±10% of spot (front expiry)</span>
        <span>RV = annualized from 5-min spot log-returns</span>
        <span>Spread Trend = IV-RV% change since session start (↓ = compressing)</span>
      </div>
    </Card>
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

  const displayRows = (() => {
    let f = expiry === "ALL" ? rows : rows.filter((r) => r.expiry === expiry);
    if (cardScope === "exidx") f = f.filter((r) => !INDICES.has(r.symbol));
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
    fontSize: 13, color: HOME_THEME.green, textTransform: "uppercase", letterSpacing: "0.05em",
  };

  return (
    <Card variant="budget" title="Strike GEX Query"
      subtitle={`Top movers by strike · ${symbol === "ALL" ? "all watched tickers" : symbol}${loading ? " · loading…" : ""}`}>

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
        <button onClick={() => load()} style={seg(false)}>↻ Refresh</button>
        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", alignSelf: "center" }}>click a column header to sort</span>
      </div>

      {err && <div style={{ color: HOME_THEME.red, marginBottom: 12, fontSize: 15 }}>{err}</div>}

      {topCards.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: HOME_THEME.green, textTransform: "uppercase", letterSpacing: "0.05em" }}>
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
                    <span style={{ fontWeight: 800, fontSize: 16, color: HOME_THEME.text }}>{r.symbol}</span>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>#{i + 1}</span>
                  </div>
                  <div style={{ fontSize: 14, color: HOME_THEME.cyan, fontWeight: 700, margin: "2px 0" }}>
                    ${r.strike} <span style={{ color: "rgba(255,255,255,0.4)", fontWeight: 400 }}>{r.expiry}</span>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: metricCol }}>
                    {colSort.col === "strike" ? r.strike : fmtB(v)}
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>
                    {cols.find((c) => c.key === colSort.col)?.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
          <thead>
            <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 13, textTransform: "uppercase" }}>
              {showSymbol && <th style={{ ...th, textAlign: "left" }}>Symbol</th>}
              {showExpiry && <th style={{ ...th, textAlign: "left" }}>Expiry</th>}
              {cols.map((c) => {
                const active = colSort.col === c.key;
                const arrow = active ? (colSort.dir === "desc" ? " ↓" : " ↑") : " ⇅";
                return (
                  <th key={c.key} onClick={() => toggleSort(c.key)} style={{
                    ...th, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
                    color: active ? HOME_THEME.cyan : HOME_THEME.green,
                  }}>
                    {c.label}<span style={{ opacity: active ? 1 : 0.4, fontSize: 12 }}>{arrow}</span>
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
                <td style={{ ...td, fontWeight: 700 }}>{r.strike}</td>
                <td style={td}>{fmtB(r.gex_now)}</td>
                <td style={{ ...td, color: r.chg15 == null ? HOME_THEME.text : r.chg15 >= 0 ? HOME_THEME.green : HOME_THEME.red }}>{r.chg15 == null ? "—" : fmtB(r.chg15)}</td>
                <td style={{ ...td, color: r.chg30 == null ? HOME_THEME.text : r.chg30 >= 0 ? HOME_THEME.green : HOME_THEME.red }}>{r.chg30 == null ? "—" : fmtB(r.chg30)}</td>
                <td style={{ ...td, color: r.chg60 == null ? HOME_THEME.text : r.chg60 >= 0 ? HOME_THEME.green : HOME_THEME.red }}>{r.chg60 == null ? "—" : fmtB(r.chg60)}</td>
                <td style={td}>{fmtB(r.delta_abs)}</td>
              </tr>
            ))}
            {!displayRows.length && !loading && !err && (
              <tr><td colSpan={cols.length + (showSymbol ? 1 : 0) + (showExpiry ? 1 : 0)} style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                No rows yet. Needs recorder history for the selected ticker(s).
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  OI CHANGE SCANNER (new tab) — day-over-day OTM open-interest change, EM watchlist
// ══════════════════════════════════════════════════════════════════════════════

type OiRow = {
  symbol: string;
  expiry: string;
  strike: number;
  opt_type: "C" | "P";
  oi_now: number;
  oi_prev: number;
  oi_chg: number;
  oi_chg_pct: number | null;
  spot: number;
  otm_dist_pct: number | null;
  date: string;
};

type OiSide = "all" | "call" | "put";
type OiDir = "all" | "up" | "down";

function OiChangeScanner() {
  const [rows, setRows] = useState<OiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [side, setSide] = useState<OiSide>("all");
  const [dir, setDir] = useState<OiDir>("all");
  const [limit, setLimit] = useState(100);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const u = new URL("/proxy/oi-change", window.location.origin);
      u.searchParams.set("side", side);
      u.searchParams.set("dir", dir);
      u.searchParams.set("limit", String(limit));
      const res = await fetch(u.toString(), { cache: "no-store" });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Server returned ${res.status} (non-JSON).`); }
      if (!j.ok) throw new Error(j.error || "load failed");
      setRows(j.rows || []);
    } catch (e: any) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  }, [side, dir, limit]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => load(), 120_000); return () => clearInterval(t); }, [load]);

  const asOfDate = rows[0]?.date;

  return (
    <Card variant="budget" title="OI Change Scanner"
      subtitle={`Day-over-day OTM open interest · EM watchlist${asOfDate ? ` · as of ${asOfDate}` : ""}${loading ? " · refreshing…" : ""}`}>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setSide("all")} style={seg(side === "all")}>All</button>
          <button onClick={() => setSide("call")} style={seg(side === "call")}>Calls</button>
          <button onClick={() => setSide("put")} style={seg(side === "put")}>Puts</button>
        </div>
        <span style={{ color: HOME_THEME.border }}>|</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setDir("all")} style={seg(dir === "all")}>Biggest |Δ|</button>
          <button onClick={() => setDir("up")} style={seg(dir === "up")}>Builds only</button>
          <button onClick={() => setDir("down")} style={seg(dir === "down")}>Unwinds only</button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: HOME_THEME.green }}>
          rows
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
            style={{ fontSize: 14, padding: "6px 10px", borderRadius: 6, background: "rgba(0,0,0,0.4)", color: HOME_THEME.text, border: "1px solid rgba(255,255,255,0.15)" }}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </label>
        <button onClick={() => load()} style={seg(false)}>↻ Refresh</button>
      </div>

      {err && (
        <div style={{ color: HOME_THEME.orange, marginBottom: 12, fontSize: 15 }}>
          {err.includes("no DB") || err.includes("503")
            ? "Recorder hasn't posted today's OI yet — Theta publishes OI ~06:30 ET, retried every 30m."
            : err}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
          <thead>
            <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 13, textTransform: "uppercase" }}>
              <th style={{ ...th, textAlign: "left" }}>#</th>
              <th style={{ ...th, textAlign: "left" }}>Symbol</th>
              <th style={{ ...th, textAlign: "left" }}>Type</th>
              <th style={th}>Strike</th>
              <th style={{ ...th, textAlign: "left" }}>Expiry</th>
              <th style={th}>OTM Dist</th>
              <th style={th}>OI Prev</th>
              <th style={th}>OI Now</th>
              <th style={th}>ΔOI</th>
              <th style={th}>Δ%</th>
              <th style={th}>Spot</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const up = r.oi_chg >= 0;
              const chgCol = up ? HOME_THEME.green : HOME_THEME.red;
              const isCall = r.opt_type === "C";
              return (
                <tr key={`${r.symbol}-${r.expiry}-${r.strike}-${r.opt_type}`}
                  style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                  <td style={{ ...td, textAlign: "left", color: HOME_THEME.text, fontWeight: 700 }}>{i + 1}</td>
                  <td style={{ ...td, textAlign: "left", fontWeight: 800 }}>{r.symbol}</td>
                  <td style={{ ...td, textAlign: "left", color: isCall ? HOME_THEME.green : HOME_THEME.red, fontWeight: 700 }}>
                    {isCall ? "CALL" : "PUT"}
                  </td>
                  <td style={{ ...td, fontWeight: 700 }}>{r.strike}</td>
                  <td style={{ ...td, textAlign: "left", color: "rgba(255,255,255,0.7)", fontSize: 14 }}>{r.expiry}</td>
                  <td style={{ ...td, color: (r.otm_dist_pct ?? 0) <= 3 ? HOME_THEME.orange : "rgba(255,255,255,0.7)" }}>
                    {r.otm_dist_pct == null ? "—" : `${r.otm_dist_pct.toFixed(1)}%`}
                  </td>
                  <td style={{ ...td, color: "rgba(255,255,255,0.6)" }}>{fmtInt(r.oi_prev)}</td>
                  <td style={td}>{fmtInt(r.oi_now)}</td>
                  <td style={{ ...td, color: chgCol, fontWeight: 800 }}>{fmtChg(r.oi_chg)}</td>
                  <td style={{ ...td, color: r.oi_chg_pct == null ? "rgba(255,255,255,0.4)" : r.oi_chg_pct >= 0 ? HOME_THEME.green : HOME_THEME.red }}>
                    {r.oi_chg_pct == null ? "—" : `${r.oi_chg_pct >= 0 ? "+" : ""}${r.oi_chg_pct.toFixed(0)}%`}
                  </td>
                  <td style={{ ...td, color: "rgba(255,255,255,0.7)" }}>{r.spot.toFixed(2)}</td>
                </tr>
              );
            })}
            {!rows.length && !loading && !err && (
              <tr><td colSpan={11} style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                No data yet. OI posts once daily ~06:30 ET — the recorder sweeps the ~380-name EM watchlist and retries every 30m until it's posted.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div style={{ marginTop: 14, display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
        <span>OTM only · calls strike&gt;spot, puts strike&lt;spot</span>
        <span>ΔOI = today&apos;s posted OI − prior session&apos;s OI</span>
        <span>Ranked by |ΔOI| · EM watchlist (~380 names) · ≤45 DTE</span>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  WATCH THIS (new tab) — farther-out CB level: highest GEX strike within 30d
//  expirations sitting unusually far OTM vs spot, EM watchlist
// ══════════════════════════════════════════════════════════════════════════════

type WatchRow = {
  symbol: string;
  strike: number;
  expiry: string;
  gex_value: number;
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

function WatchThisScanner() {
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);

  const [outcomes, setOutcomes] = useState<OutcomeRow[]>([]);
  const [outcomeStatus, setOutcomeStatus] = useState<"all" | "open" | "touched" | "expired">("all");

  const [newTicker, setNewTicker] = useState("");
  const [addStatus, setAddStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [adding, setAdding] = useState(false);

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
    <Card variant="budget" title={<span style={{ fontSize: 20 }}>Watch This — Far CB</span>}
      subtitle={`Highest GEX strike within 30d expirations, far OTM vs spot · EM watchlist${threshold != null ? ` · >${threshold}% OTM` : ""}${loading ? " · refreshing…" : ""}`}>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={() => load()} style={seg(false)}>↻ Refresh</button>
        <span style={{ fontSize: 13, color: HOME_THEME.text }}>
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
        <div style={{ color: HOME_THEME.orange, marginBottom: 12, fontSize: 15 }}>
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
              background: `radial-gradient(circle at 50% 0%, rgba(126,211,252,0.08) 0%, transparent 60%), rgba(13,17,25,0.20)`,
              backdropFilter: "blur(20px)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontWeight: 800, fontSize: 18, color: HOME_THEME.text }}>{r.symbol}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: LIGHT_BLUE, letterSpacing: "0.05em" }}>WATCH THIS</span>
              </div>
              <div style={{ fontSize: 15, color: LIGHT_BLUE, fontWeight: 700, marginBottom: 4 }}>
                ${r.strike} <span style={{ color: HOME_THEME.text, fontWeight: 400 }}>· {r.expiry} · {r.dte_days}d</span>
              </div>
              <div style={{ fontSize: 14, color: HOME_THEME.text, lineHeight: 1.5, marginBottom: 8 }}>
                Highest GEX level for {r.symbol} is the ${r.strike} strike ({r.expiry}), {r.otm_pct.toFixed(0)}% away from spot (${r.spot.toFixed(2)}) —
                farther out than the usual near-the-money CB. {up ? "Call-side" : "Put-side"} dominant.
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: up ? HOME_THEME.green : HOME_THEME.red }}>{fmtB(r.gex_value)}</span>
                <a href={chainHref} style={{ fontSize: 14, color: LIGHT_BLUE, fontWeight: 700, textDecoration: "none" }}>
                  View chain →
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13, color: HOME_THEME.text }}>
        <span>Basis: OI+Vol net GEX (canonical) · single highest |GEX| strike per ticker across expiries ≤30 DTE</span>
        <span>Flagged when that strike is &gt;{threshold ?? 15}% away from spot</span>
      </div>

      {/* Tracked results — did the flagged strike ever get touched? */}
      <div style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: HOME_THEME.text }}>Tracked results</span>
          <div style={{ display: "flex", gap: 6 }}>
            {(["all", "open", "touched", "expired"] as const).map((s) => (
              <button key={s} onClick={() => setOutcomeStatus(s)} style={seg(outcomeStatus === s)}>
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 13, color: HOME_THEME.text }}>
            Graded daily ~16:10 ET · no win/loss — just whether spot reached the strike
          </span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
            <thead>
              <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 13, textTransform: "uppercase" }}>
                <th style={{ ...th, textAlign: "left" }}>Symbol</th>
                <th style={th}>Strike</th>
                <th style={{ ...th, textAlign: "left" }}>Expiry</th>
                <th style={{ ...th, textAlign: "left" }}>Flagged</th>
                <th style={th}>OTM at flag</th>
                <th style={th}>Closest</th>
                <th style={{ ...th, textAlign: "left" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((o, i) => (
                <tr key={`${o.symbol}-${o.expiry}-${o.strike}`}
                  style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{o.symbol}</td>
                  <td style={{ ...td, fontWeight: 700 }}>${o.strike}</td>
                  <td style={{ ...td, textAlign: "left", color: HOME_THEME.text, fontSize: 14 }}>{o.expiry}</td>
                  <td style={{ ...td, textAlign: "left", color: HOME_THEME.text, fontSize: 14 }}>{o.first_flagged}</td>
                  <td style={td}>{o.otm_pct_at_flag.toFixed(0)}%</td>
                  <td style={{ ...td, color: o.closest_pct != null && o.closest_pct < 1 ? LIGHT_BLUE : HOME_THEME.text }}>
                    {o.closest_pct != null ? `${o.closest_pct.toFixed(1)}%` : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "left" }}>
                    <span style={{
                      fontSize: 13, fontWeight: 800, letterSpacing: "0.05em",
                      color: o.status === "touched" ? LIGHT_BLUE : o.status === "expired" ? HOME_THEME.text : HOME_THEME.green,
                    }}>
                      {o.status === "touched" ? `TOUCHED ${o.touched_date ?? ""}` : o.status.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
              {!outcomes.length && (
                <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: HOME_THEME.text }}>
                  No tracked flags yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  MARKET QUALITY TERMINAL (new tab) — 5-pillar global market score
// ══════════════════════════════════════════════════════════════════════════════

type Pillars = {
  volatility: { score: number; weight: number; weighted: number; vixLevel: number | null; vixTrend: string; ivPercentile: number | null; putCall: number | null };
  trend: { score: number; weight: number; weighted: number; regime: string; spyVs20: boolean | null; spyVs50: boolean | null; spyVs200: boolean | null; qqqVs50: boolean | null; rsi14: number | null };
  breadth: { score: number; weight: number; weighted: number; aboveCount: number; total: number; participation: string; sectors: { symbol: string; above: boolean | null }[] };
  momentum: { score: number; weight: number; weighted: number; positiveCount: number; total: number; spread: number | null; leader: { symbol: string; chg5d: number } | null; laggard: { symbol: string; chg5d: number } | null; rotation: string };
  macro: { score: number; weight: number; weighted: number; tltLast: number | null; tltTrend: string; uupTrend: string; uup5d: number | null };
};

type MqData = {
  asOf: string;
  globalScore: number;
  banner: { label: string; tone: "green" | "cyan" | "orange" | "red"; sizing: string };
  pillars: Pillars;
  sectorBars: { symbol: string; name: string; chg5d: number | null }[];
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
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={28} fontWeight={800} fill={HOME_THEME.text}>
          {Math.round(score)}
        </text>
      </svg>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.06em", color: HOME_THEME.text, textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{sub}</div>
      </div>
    </div>
  );
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

function MqPanel({ title, accent, children }: { title: string; accent: string; score: number; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px", background: `radial-gradient(circle at 50% 0%, ${accent}14 0%, transparent 65%), rgba(13,17,25,0.25)` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.05em", color: accent, textTransform: "uppercase" }}>{title}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </div>
  );
}

function MqRow({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
      <span style={{ color: "rgba(255,255,255,0.55)" }}>{label}</span>
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
      <Card variant="budget" title="Market Quality Terminal" subtitle="Global market regime score">
        <div style={{ color: HOME_THEME.red, fontSize: 14 }}>{err}</div>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card variant="budget" title="Market Quality Terminal" subtitle="Loading…">
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, padding: 24, textAlign: "center" }}>Fetching live index / sector data…</div>
      </Card>
    );
  }

  const { globalScore, banner, pillars, sectorBars, assessment } = data;
  const bannerColor = TONE_COLOR[banner.tone];
  const asOfLocal = new Date(data.asOf).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

  const maxAbsBar = Math.max(1, ...sectorBars.map((b) => Math.abs(b.chg5d ?? 0)));

  return (
    <Card variant="budget" title="Market Quality Terminal"
      subtitle={`Global market regime score · ${asOfLocal}${loading ? " · refreshing…" : ""}`}>

      {/* Banner + global score + 5 rings */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center", marginBottom: 22 }}>
        <div style={{
          borderRadius: 12, padding: "14px 20px", minWidth: 150,
          border: `1px solid ${bannerColor}55`, background: `${bannerColor}15`,
        }}>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.1em", color: bannerColor }}>{banner.label}</div>
          <div style={{ fontSize: 34, fontWeight: 800, color: HOME_THEME.text, lineHeight: 1.1 }}>{globalScore}<span style={{ fontSize: 16, color: "rgba(255,255,255,0.4)" }}>/100</span></div>
          <div style={{ fontSize: 12, color: bannerColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{banner.sizing}</div>
        </div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <RingGauge score={pillars.volatility.score} label="Volatility" sub="25%" />
          <RingGauge score={pillars.trend.score} label="Trend" sub="20%" />
          <RingGauge score={pillars.breadth.score} label="Breadth" sub="20%" />
          <RingGauge score={pillars.momentum.score} label="Momentum" sub="25%" />
          <RingGauge score={pillars.macro.score} label="Macro" sub="10%" />
        </div>
      </div>

      {pillars.volatility.putCall == null && (
        <div style={{
          borderRadius: 8, padding: "8px 14px", marginBottom: 18, fontSize: 12, fontWeight: 700,
          color: HOME_THEME.orange, background: `${HOME_THEME.orange}15`, border: `1px solid ${HOME_THEME.orange}40`,
        }}>
          ⚠ PUT/CALL RATIO UNAVAILABLE — USING NEUTRAL SCORE
        </div>
      )}

      {/* 5 detail panels */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 24 }}>
        <MqPanel title="Volatility" accent={HOME_THEME.orange} score={pillars.volatility.score}>
          <MqRow label="VIX Level" value={pillars.volatility.vixLevel ?? "—"} />
          <MqRow label="VIX Trend" value={pillars.volatility.vixTrend} valueColor={pillars.volatility.vixTrend === "Rising" ? HOME_THEME.red : pillars.volatility.vixTrend === "Falling" ? HOME_THEME.green : HOME_THEME.text} />
          <MqRow label="VIX IV %ile" value={pillars.volatility.ivPercentile != null ? `${pillars.volatility.ivPercentile}%` : "—"} />
          <MqRow label="Put/Call" value="N/A" valueColor="rgba(255,255,255,0.35)" />
        </MqPanel>

        <MqPanel title="Trend" accent={HOME_THEME.cyan} score={pillars.trend.score}>
          <MqRow label="Regime" value={pillars.trend.regime} valueColor={pillars.trend.regime === "Bullish" ? HOME_THEME.green : pillars.trend.regime === "Bearish" ? HOME_THEME.red : HOME_THEME.orange} />
          <MqRow label="SPY vs 20D" value={pillars.trend.spyVs20 == null ? "—" : pillars.trend.spyVs20 ? "▲" : "▼"} valueColor={pillars.trend.spyVs20 ? HOME_THEME.green : HOME_THEME.red} />
          <MqRow label="SPY vs 50D" value={pillars.trend.spyVs50 == null ? "—" : pillars.trend.spyVs50 ? "▲" : "▼"} valueColor={pillars.trend.spyVs50 ? HOME_THEME.green : HOME_THEME.red} />
          <MqRow label="SPY vs 200D" value={pillars.trend.spyVs200 == null ? "—" : pillars.trend.spyVs200 ? "▲" : "▼"} valueColor={pillars.trend.spyVs200 ? HOME_THEME.green : HOME_THEME.red} />
          <MqRow label="QQQ vs 50D" value={pillars.trend.qqqVs50 == null ? "—" : pillars.trend.qqqVs50 ? "▲" : "▼"} valueColor={pillars.trend.qqqVs50 ? HOME_THEME.green : HOME_THEME.red} />
          <MqRow label="RSI-14" value={pillars.trend.rsi14 ?? "—"} />
        </MqPanel>

        <MqPanel title="Breadth" accent={HOME_THEME.red} score={pillars.breadth.score}>
          <MqRow label="Sectors > 50D" value={`${pillars.breadth.aboveCount}/${pillars.breadth.total}`} />
          <MqRow label="Participation" value={pillars.breadth.participation} valueColor={pillars.breadth.participation === "Broad" ? HOME_THEME.green : pillars.breadth.participation === "Narrow" ? HOME_THEME.red : HOME_THEME.orange} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {pillars.breadth.sectors.map((s) => (
              <span key={s.symbol} style={{
                fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                color: s.above == null ? "rgba(255,255,255,0.35)" : s.above ? HOME_THEME.green : HOME_THEME.red,
                background: s.above == null ? "transparent" : s.above ? `${HOME_THEME.green}18` : `${HOME_THEME.red}18`,
              }}>
                {s.symbol} {s.above == null ? "—" : s.above ? "↑" : "↓"}
              </span>
            ))}
          </div>
        </MqPanel>

        <MqPanel title="Momentum" accent={HOME_THEME.green} score={pillars.momentum.score}>
          <MqRow label="Positive (5D)" value={`${pillars.momentum.positiveCount}/${pillars.momentum.total}`} />
          <MqRow label="Spread" value={pillars.momentum.spread != null ? `${pillars.momentum.spread}%` : "—"} />
          <MqRow label="Leader" value={pillars.momentum.leader ? `${pillars.momentum.leader.symbol} +${pillars.momentum.leader.chg5d}%` : "—"} valueColor={HOME_THEME.green} />
          <MqRow label="Laggard" value={pillars.momentum.laggard ? `${pillars.momentum.laggard.symbol} ${pillars.momentum.laggard.chg5d}%` : "—"} valueColor={HOME_THEME.red} />
          <MqRow label="Rotation" value={pillars.momentum.rotation} />
        </MqPanel>

        <MqPanel title="Macro" accent={LIGHT_BLUE} score={pillars.macro.score}>
          <MqRow label="TLT (Bonds)" value={pillars.macro.tltLast != null ? `$${pillars.macro.tltLast}` : "—"} />
          <MqRow label="Bond 20D" value={pillars.macro.tltTrend} valueColor={pillars.macro.tltTrend === "Rising" ? HOME_THEME.green : pillars.macro.tltTrend === "Falling" ? HOME_THEME.red : HOME_THEME.text} />
          <MqRow label="Dollar 20D" value={pillars.macro.uupTrend} valueColor={pillars.macro.uupTrend === "Strengthening" ? HOME_THEME.red : pillars.macro.uupTrend === "Weakening" ? HOME_THEME.green : HOME_THEME.text} />
          <MqRow label="UUP Chg (5D)" value={pillars.macro.uup5d != null ? `${pillars.macro.uup5d >= 0 ? "+" : ""}${pillars.macro.uup5d}%` : "—"} />
        </MqPanel>
      </div>

      {/* Sector performance + scoring weights */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1.3fr) minmax(220px, 1fr)", gap: 16 }}>
        <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: HOME_THEME.green, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
            Sector Performance (5-Day)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sectorBars.map((b) => {
              const v = b.chg5d ?? 0;
              const pos = v >= 0;
              const widthPct = (Math.abs(v) / maxAbsBar) * 100;
              return (
                <div key={b.symbol} style={{ display: "grid", gridTemplateColumns: "48px 1fr 60px", alignItems: "center", gap: 8, fontSize: 12 }}>
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
          <div style={{ fontSize: 13, fontWeight: 800, color: HOME_THEME.green, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
            Scoring Weights
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, textTransform: "uppercase" }}>
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
                  <td style={{ textAlign: "right", color: "rgba(255,255,255,0.6)" }}>{Math.round(weight * 100)}%</td>
                  <td style={{ textAlign: "right", color: HOME_THEME.text, fontWeight: 700 }}>{wtd}</td>
                </tr>
              ))}
              <tr style={{ borderTop: `1px solid ${HOME_THEME.cyan}55` }}>
                <td style={{ padding: "6px 0", color: HOME_THEME.cyan, fontWeight: 800 }}>Total</td>
                <td style={{ textAlign: "right", color: "rgba(255,255,255,0.3)" }}>—</td>
                <td style={{ textAlign: "right", color: "rgba(255,255,255,0.6)" }}>100%</td>
                <td style={{ textAlign: "right", color: HOME_THEME.cyan, fontWeight: 800 }}>{globalScore}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* AI-generated assessment */}
      <div style={{ marginTop: 20, borderRadius: 12, border: `1px solid ${HOME_THEME.cyan}30`, padding: "14px 16px", background: `${HOME_THEME.cyan}0A` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: HOME_THEME.cyan, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            ⚡ AI-Generated Market Assessment
          </span>
          <button onClick={copyAssessment} style={{ ...seg(false), fontSize: 11, padding: "4px 10px" }}>
            {copyStatus === "copied" ? "Copied ✓" : "Copy Shot"}
          </button>
        </div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.85)", lineHeight: 1.6 }}>{assessment}</div>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  BALANCE / IMBALANCE (new tab) — Auction Market Theory quadrant classifier
// ══════════════════════════════════════════════════════════════════════════════

const QUADRANT_META: Record<Quadrant, { label: string; color: string }> = {
  balance: { label: "Balance", color: HOME_THEME.green },
  shift: { label: "Shift", color: HOME_THEME.orange },
  imbalance: { label: "Imbalance", color: HOME_THEME.red },
  rebalance: { label: "Re-balance", color: LIGHT_BLUE },
};

function QuadrantCell({ q, title, sub, active }: { q: Quadrant; title: string; sub: string; active: boolean }) {
  const meta = QUADRANT_META[q];
  return (
    <div style={{
      borderRadius: 10,
      padding: "12px 14px",
      border: `1px solid ${active ? meta.color : "rgba(255,255,255,0.1)"}`,
      background: active ? `${meta.color}22` : "rgba(255,255,255,0.02)",
      transition: "all 0.2s",
    }}>
      <div style={{ fontWeight: 800, fontSize: 15, color: active ? meta.color : HOME_THEME.text, marginBottom: 2 }}>
        {title}{active ? " ●" : ""}
      </div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{sub}</div>
    </div>
  );
}

function BalanceImbalanceScanner() {
  const [instr, setInstr] = useState<"ESU" | "NQU">("ESU");

  const es = useEsCandles(instr === "ESU", 25);
  const nq = useNqCandles(instr === "NQU", 25);
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

  // Fine-grained key (reacts to every price tick, not just new bars) — only
  // used for TODAY's live quadrant read, which should update the instant
  // price crosses VAH/VAL rather than waiting for the bar to close.
  const candlesKey = useMemo(() => {
    const n = candles.length;
    const last = candles[n - 1];
    const lc = last ? Math.round(last.close * 4) : 0;
    return `${n}:${last?.slotKey ?? ""}:${lc}`;
  }, [candles]);

  // Coarse key — only changes when a bar is ADDED (new 5m bar, or more
  // history loads), not on every intrabar price tick. The prior-day Value
  // Area and the multi-day backtest are both static/slow-changing; recomputing
  // them on every WS tick (the original bug) re-ran a full multi-day scan with
  // a brand-new Intl.DateTimeFormat per bar comparison, which is what froze
  // the tab (and, since it's synchronous on the main thread, the whole
  // dashboard) on click.
  const barCountKey = useMemo(() => {
    const last = candles[candles.length - 1];
    return `${candles.length}:${last?.date ?? ""}`;
  }, [candles]);

  const dates = useMemo(() => sessionDates(candles), [barCountKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = dates[dates.length - 1] ?? null;
  const prevDate = dates.length >= 2 ? dates[dates.length - 2] : null;
  const binSize = instr === "NQU" ? 5 : 1;

  const va = useMemo(() => {
    if (!prevDate) return null;
    const prevBars = rthBarsForDate(candles, prevDate);
    return prevBars.length >= 5 ? computeValueArea(prevBars, binSize) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barCountKey, prevDate, binSize]);

  const day = useMemo(() => {
    if (!today || !va) return null;
    return classifyDay(candles, today, va);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candlesKey, today, va]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const backtest = useMemo(() => backtestQuadrants(candles, binSize), [barCountKey, binSize]);

  const current = day?.current ?? null;
  const lastClose = candles[candles.length - 1]?.close ?? null;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const changes = day?.points.filter((p) => p.changed) ?? [];

  return (
    <Card variant="budget" title="Balance / Imbalance"
      subtitle={`${instr} · Auction Market Theory vs. prior RTH Value Area${prevDate ? ` (${prevDate})` : ""}`}>

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <button onClick={() => setInstr("ESU")} style={seg(instr === "ESU")}>ESU</button>
        <button onClick={() => setInstr("NQU")} style={seg(instr === "NQU")}>NQU</button>
      </div>

      {!va && (
        <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
          Needs at least one full prior RTH session of candles to build a Value Area — give the feed a day of history.
        </div>
      )}

      {va && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 20, marginBottom: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <QuadrantCell q="balance" title="1. Balance" sub="Efficient market · rangebound · lower vol" active={current?.quadrant === "balance"} />
              <QuadrantCell q="shift" title="2. Shift" sub="Break of value · buyers/sellers overpower" active={current?.quadrant === "shift"} />
              <QuadrantCell q="rebalance" title="4. Re-balance" sub="Hunting new value, or revisiting old value" active={current?.quadrant === "rebalance"} />
              <QuadrantCell q="imbalance" title="3. Imbalance" sub="Trending · OI flushes · disagreement on value" active={current?.quadrant === "imbalance"} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
              <div style={{ fontSize: 13, color: HOME_THEME.green, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Prior-day Value Area
              </div>
              <div style={{ fontSize: 15, color: HOME_THEME.text }}>VAH <b style={{ color: HOME_THEME.cyan }}>{va.vah.toFixed(2)}</b></div>
              <div style={{ fontSize: 15, color: HOME_THEME.text }}>POC <b style={{ color: LIGHT_BLUE }}>{va.poc.toFixed(2)}</b></div>
              <div style={{ fontSize: 15, color: HOME_THEME.text }}>VAL <b style={{ color: HOME_THEME.cyan }}>{va.val.toFixed(2)}</b></div>
              <div style={{ fontSize: 15, color: HOME_THEME.text, marginTop: 6 }}>
                Last <b>{lastClose?.toFixed(2) ?? "—"}</b>
                {current?.side && (
                  <span style={{ color: QUADRANT_META[current.quadrant].color, fontWeight: 700, marginLeft: 8 }}>
                    {current.side === "up" ? "above VAH" : "below VAL"}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: current ? QUADRANT_META[current.quadrant].color : HOME_THEME.text, marginTop: 4 }}>
                {current ? QUADRANT_META[current.quadrant].label : "—"}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: HOME_THEME.green, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Today&apos;s quadrant transitions
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {changes.map((p, i) => (
                <div key={i} style={{
                  fontSize: 13, padding: "4px 10px", borderRadius: 6,
                  border: `1px solid ${QUADRANT_META[p.quadrant].color}55`,
                  color: QUADRANT_META[p.quadrant].color, fontWeight: 700,
                }}>
                  {new Date(p.ts).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })}
                  {" · "}{QUADRANT_META[p.quadrant].label}{" @ "}{p.close.toFixed(2)}
                </div>
              ))}
              {!changes.length && <span style={{ fontSize: 14, color: "rgba(255,255,255,0.4)" }}>No transitions yet today.</span>}
            </div>
          </div>

          <div style={{ paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 13, color: HOME_THEME.green, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Historical outcome ({backtest.days.length} sessions graded)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Days with a Shift</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: HOME_THEME.text }}>{backtest.daysWithShift}</div>
              </div>
              <div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Shift → confirmed Imbalance</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: HOME_THEME.orange }}>{pct(backtest.shiftToImbalanceRate)}</div>
              </div>
              <div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Imbalance → closed on new value</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: HOME_THEME.red }}>{pct(backtest.imbalanceToNewValueRate)}</div>
              </div>
              <div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Imbalance → reverted to Balance</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: LIGHT_BLUE }}>{pct(backtest.imbalanceToRevertRate)}</div>
              </div>
            </div>
          </div>
        </>
      )}

      <div style={{
        marginTop: 18, padding: "10px 14px", borderRadius: 10,
        border: `1px solid ${HOME_THEME.orange}30`, background: `${HOME_THEME.orange}0A`,
        fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.5,
      }}>
        <b style={{ color: HOME_THEME.orange }}>Approximate volume profile: </b>
        the feed only gives us one total volume number per 5m bar, not volume-by-price — we don&apos;t actually know
        where inside the bar&apos;s high-low range that volume traded. The VA/POC above spread each bar&apos;s volume
        evenly across its H-L range as an estimate, not real per-tick volume-at-price. Once ThetaData adds futures
        tick data, this switches to a true tick-built profile.
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
        <span>VA = 70% volume, POC-centered, built from the prior RTH session&apos;s 5m bars</span>
        <span>Imbalance confirms after {CONFIRM_BARS} bars sustained beyond VA · Re-balance = leg range contracts vs its own recent bars</span>
        <span>Heuristic first pass — thresholds tunable in lib/balanceImbalance.ts</span>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  PAGE SHELL — tab switcher
// ══════════════════════════════════════════════════════════════════════════════

export default function ScannerPage() {
  const [tab, setTab] = useState<MainTab>("overview");

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 20px", borderRadius: 8, fontSize: 15, cursor: "pointer", fontWeight: 700,
    border: `1px solid ${active ? HOME_THEME.cyan : "rgba(255,255,255,0.1)"}`,
    background: active ? "rgba(33,158,188,0.15)" : "transparent",
    color: active ? HOME_THEME.text : "rgba(255,255,255,0.55)",
    transition: "all 0.15s",
  });

  return (
    <PageShell>
      {/* Top-level tabs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <button onClick={() => setTab("overview")} style={tabStyle(tab === "overview")}>Overview</button>
        <button onClick={() => setTab("gex")}    style={tabStyle(tab === "gex")}>GEX Scanner</button>
        <button onClick={() => setTab("greeks")} style={tabStyle(tab === "greeks")}>Greeks Sensitivity</button>
        <button onClick={() => setTab("volpin")} style={{
          ...tabStyle(tab === "volpin"),
          border: `1px solid ${tab === "volpin" ? HOME_THEME.purple : "rgba(255,255,255,0.1)"}`,
          background: tab === "volpin" ? `${HOME_THEME.purple}22` : "transparent",
        }}>Vol Pin</button>
        <button onClick={() => setTab("strike")} style={tabStyle(tab === "strike")}>Strike Query</button>
        <button onClick={() => setTab("oi")} style={{
          ...tabStyle(tab === "oi"),
          border: `1px solid ${tab === "oi" ? HOME_THEME.orange : "rgba(255,255,255,0.1)"}`,
          background: tab === "oi" ? `${HOME_THEME.orange}22` : "transparent",
        }}>OI Change</button>
        <button onClick={() => setTab("watch")} style={{
          ...tabStyle(tab === "watch"),
          border: `1px solid ${tab === "watch" ? LIGHT_BLUE : "rgba(255,255,255,0.1)"}`,
          background: tab === "watch" ? `${LIGHT_BLUE}22` : "transparent",
        }}>Watch This</button>
        <button onClick={() => setTab("marketquality")} style={{
          ...tabStyle(tab === "marketquality"),
          border: `1px solid ${tab === "marketquality" ? HOME_THEME.orange : "rgba(255,255,255,0.1)"}`,
          background: tab === "marketquality" ? `${HOME_THEME.orange}22` : "transparent",
        }}>Market Quality</button>
        <button onClick={() => setTab("balance")} style={{
          ...tabStyle(tab === "balance"),
          border: `1px solid ${tab === "balance" ? LIGHT_BLUE : "rgba(255,255,255,0.1)"}`,
          background: tab === "balance" ? `${LIGHT_BLUE}22` : "transparent",
        }}>Balance / Imbalance</button>
      </div>

      {tab === "overview" && <ScannerOverview onSelect={setTab} />}
      {tab === "gex"    && <GexScanner />}
      {tab === "greeks" && <GreeksScanner />}
      {tab === "volpin" && <VolPinScanner />}
      {tab === "strike" && <StrikeQueryScanner />}
      {tab === "oi"     && <OiChangeScanner />}
      {tab === "watch"  && <WatchThisScanner />}
      {tab === "marketquality" && <MarketQualityScanner />}
      {tab === "balance" && <BalanceImbalanceScanner />}
    </PageShell>
  );
}
