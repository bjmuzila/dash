"use client";

/**
 * /scanner — the scanner page.
 *
 * Tabs (see components/scanner/scannerNav.ts for the bar itself):
 *   GEX Levels      — SqueezeMetrics-style GEX dashboard (moved here from the
 *                     Test Lab page 2026-08-16; lives in components/scanner/GexLevelsTab)
 *   GEX Change Top  — biggest cross-ticker GEX movers
 *   Pick Study      — what the graded GEX Change Top picks had in common at
 *                     capture (components/scanner/PickStudyTab)
 *   Strike Query    — top movers by strike, per-ticker or ALL
 *   TPO Structures  — Market Profile "open business" + AMT read
 *   IB Stats        — initial-balance statistics
 *   Watch This      — farther-out CB levels + outcome tracking
 *
 * MOVED OUT 2026-08-16 (now Test Lab tabs, /test?tab=…):
 *   GEX Scanner    -> components/scanner/GexScannerTab
 *   GEX%           -> components/scanner/GexPctTab
 *   Market Quality -> components/scanner/MarketQualityTab
 *   Stat Prompter  -> components/scanner/StatPrompterTab
 *   Strike History -> /strike-history is a Test Lab section route now
 * Those files still live under components/scanner/ — the folder is the feature
 * family, not the page that happens to host the tab.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";
import { useEsCandles, type EsCandle } from "@/hooks/useEsCandles";
import { useNqCandles } from "@/hooks/useNqCandles";
import { buildTpoStructures, baseRateFor, ageBucket, KIND_LABEL, KIND_TITLE, KIND_NOTE, KIND_MEANING, type StructureKind, type TpoStructure, type TpoSession } from "@/lib/tpo";
import { amtRead, type AmtRead, type AmtSignal, type SignalLevel } from "@/lib/amt";
import IbStatsTab from "@/components/scanner/IbStatsTab";
import TpoForecastCard from "@/components/scanner/TpoForecastCard";
import TpoForwardMap from "@/components/scanner/TpoForwardMap";
import TpoOpenLocation from "@/components/scanner/TpoOpenLocation";
import GexChangeTop from "@/components/scanner/GexChangeTop";
import PickStudyTab from "@/components/scanner/PickStudyTab";
import GexLevelsTab from "@/components/scanner/GexLevelsTab";
import { fmtB, NEUTRAL, seg, td, th, zColor } from "@/components/scanner/scannerStyles";
import { readTabFromUrl, SCANNER_TABS, SCANNER_TAB_EVENT } from "@/components/scanner/scannerNav";
import { useIsOwner } from "@/components/shared/useIsOwner";


// ── top-level tab ─────────────────────────────────────────────────────────────

type MainTab = "gexlevels" | "gexchangetop" | "pickstudy" | "strike" | "tpo" | "ibstats" | "watch";

// Lookback window, in minutes. Declared here rather than in GexScannerTab (which
// also owns a copy) because GreeksScanner below still uses it and that tab did
// not move.
type Win = 5 | 15 | 30 | 60;

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
  // The flagged OTM contract itself, measured FROM THE FLAG — what it cost the
  // day it was flagged and the best it has printed since. Not the live mid and
  // not its move off this morning's open: the flag is a thesis with a date on
  // it, so the only honest scoreboard runs from that date. `opt_price` is the
  // live mid, still carried for the popup; the table does not show it.
  opt_type?: "C" | "P" | null;
  opt_price?: number | null;
  opt_entry?: number | null;
  opt_entry_date?: string | null;
  opt_high?: number | null;
  opt_pct_high?: number | null;
};

/**
 * Tracked-results view selector. The first four are server-side status filters
 * on the flat table; "results" is a client-side roll-up of every tracked flag
 * grouped by calendar date (opened / touched / expired counts per day).
 */
type OutcomeView = "all" | "open" | "touched" | "expired" | "results";

// ── tracked-results table sorting ────────────────────────────────────────────
// Every column header is clickable. Sorting is client-side over the rows the
// endpoint already returned — the server orders by first_flagged DESC and the
// limit is applied there, so this re-orders the fetched page, it does not go
// back for more rows.
type OutcomeSortKey =
  | "symbol" | "strike" | "expiry" | "first_flagged" | "opt_entry" | "opt_high" | "opt_pct_high"
  | "spot_at_flag" | "otm_pct_at_flag" | "closest_pct" | "touched_date" | "status";

type OutcomeSort = { key: OutcomeSortKey; dir: "asc" | "desc" };

/** open → touched → expired, so a status sort reads as a lifecycle, not A–Z. */
const STATUS_RANK: Record<OutcomeRow["status"], number> = { open: 0, touched: 1, expired: 2 };

const OUTCOME_SORT_VALUE: Record<OutcomeSortKey, (r: OutcomeRow) => string | number | null> = {
  symbol:          (r) => r.symbol,
  strike:          (r) => Number(r.strike),
  expiry:          (r) => ymd(r.expiry) ?? r.expiry ?? null,
  first_flagged:   (r) => ymd(r.first_flagged) ?? null,
  opt_entry:       (r) => r.opt_entry ?? null,
  opt_high:        (r) => r.opt_high ?? null,
  opt_pct_high:    (r) => r.opt_pct_high ?? null,
  spot_at_flag:    (r) => Number(r.spot_at_flag),
  otm_pct_at_flag: (r) => Number(r.otm_pct_at_flag),
  closest_pct:     (r) => r.closest_pct ?? null,
  touched_date:    (r) => ymd(r.touched_date),
  status:          (r) => STATUS_RANK[r.status] ?? 99,
};

/**
 * Nulls always sink to the bottom, in BOTH directions — an untouched row has no
 * touched date, and floating those to the top of a descending sort would bury
 * the rows the sort was asked for.
 */
function sortOutcomes(rows: OutcomeRow[], sort: OutcomeSort): OutcomeRow[] {
  const pick = OUTCOME_SORT_VALUE[sort.key];
  const mul = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = pick(a);
    const bv = pick(b);
    const aNull = av == null || av === "";
    const bNull = bv == null || bv === "";
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * mul;
    return String(av).localeCompare(String(bv)) * mul;
  });
}

/** The sort a view lands on before the user clicks anything. */
const defaultOutcomeSort = (view: OutcomeView): OutcomeSort =>
  view === "touched"
    ? { key: "touched_date", dir: "desc" }   // newest touch first
    : view === "expired"
      ? { key: "expiry", dir: "desc" }
      : { key: "first_flagged", dir: "desc" }; // matches the server's own order

/**
 * Clickable column header for the tracked-results table. Named apart from the
 * Pin table's own `SortTh` above — different sort-key type, different table.
 */
function OutcomeTh({
  label, sortKey, sort, onSort, align = "right",
}: {
  label: string;
  sortKey: OutcomeSortKey;
  sort: OutcomeSort;
  onSort: (k: OutcomeSortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      title={`Sort by ${label}`}
      style={{
        ...th,
        textAlign: align,
        cursor: "pointer",
        userSelect: "none",
        whiteSpace: "nowrap",
        color: active ? LIGHT_BLUE : undefined,
      }}
    >
      {label}
      <span style={{ opacity: active ? 1 : 0.25, marginLeft: 4 }}>
        {active ? (sort.dir === "asc" ? "▲" : "▼") : "▾"}
      </span>
    </th>
  );
}

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

/** Stable identity for one tracked contract, used to key the expanded row. */
const outcomeKey = (o: OutcomeRow) => `${o.symbol}|${o.expiry}|${o.strike}`;

// ── probe card ───────────────────────────────────────────────────────────────
// The owner site's /owner/probe card, ported here so a tracked flag reads
// EXACTLY like a probed contract: same palette, same mono type, same header
// (ticker · strike badge, expiry sub, big ▲/▼ %, "in → high · $/ct"), same chart,
// same hint footer, same "⧉ Copy image" PNG. The colors are literals rather
// than theme tokens on purpose — `captureFlagCard` serializes the SVG standalone
// and any var() reference would resolve to nothing off-DOM.
const PROBE_ICE = "#8ECAE6";
const PROBE_GRN = "#30d158";
const PROBE_RED = "#ff5b5b";
const PROBE_TXT = "#ffffff";
const PROBE_MUTED = "rgba(255,255,255,0.62)";
const PROBE_BG = "#05060a";
const PROBE_BORDER = "rgba(255,255,255,0.1)";
const PROBE_MONO = '"Courier New", monospace';

/** Owner-card tone: green above water, red below, white flat/unknown. */
const probeTone = (v: number | null) => (v == null ? PROBE_TXT : v > 0 ? PROBE_GRN : v < 0 ? PROBE_RED : PROBE_TXT);
const probePx = (v: number | null) => (v == null ? "—" : v.toFixed(2));

/**
 * Header numbers for one tracked flag: the contract's first traded mark is the
 * basis (what taking the flag would have cost) and the BEST mark it has printed
 * since is the second leg — the flag is graded on the peak it offered, not on
 * whatever it happens to be worth right now, because a flag that ran +150% and
 * gave it all back still handed you the +150%. P/L is per single contract
 * (×100). `mark` stays the field name so the card and the PNG capture read one
 * shape; it carries the high, and `last` keeps the live mark for reference.
 */
function probeStats(days: OutcomeDetailDay[]) {
  const vals = days.map((d) => d.contractClose).filter((v): v is number => v != null && Number.isFinite(v));
  if (!vals.length) return null;
  const entry = vals[0], last = vals[vals.length - 1], mark = Math.max(...vals);
  return {
    entry,
    mark,
    last,
    pct: entry > 0 ? ((mark - entry) / entry) * 100 : null,
    dollars: (mark - entry) * 100,
  };
}

/** Expiry in the owner card's format: "Sep 18, 26". */
const probeExp = (v: string) => {
  const t = Date.parse(`${String(v).slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "2-digit" })
    : v;
};

/**
 * captureFlagCard — PNG of one flag card, ported from the owner probe page.
 *
 * The chart is already an SVG with hardcoded colors, so it rasterizes cleanly
 * through an <img> + canvas. The header is painted on with fillText rather than
 * cloned from the DOM, which keeps the export identical across browsers instead
 * of inheriting whatever the page computed. Clipboard only — nothing is written
 * to disk.
 */
async function captureFlagCard(chartId: string, meta: {
  ticker: string; badge: string; exp: string; pct: number | null;
  entry: number | null; mark: number | null; dollars: number | null; hint: string;
}): Promise<boolean> {
  const svg = document.getElementById(chartId) as SVGSVGElement | null;
  if (!svg) return false;
  const SCALE = 2, CW = 1000, HEAD = 132, CH = HEAD + 360;
  const MONO = PROBE_MONO;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", "960");
  clone.setAttribute("height", "340");
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("svg rasterize failed"));
      img.src = url;
    });

    const cv = document.createElement("canvas");
    cv.width = CW * SCALE; cv.height = CH * SCALE;
    const ctx = cv.getContext("2d");
    if (!ctx) return false;
    ctx.scale(SCALE, SCALE);

    ctx.fillStyle = "#0d1119";
    ctx.fillRect(0, 0, CW, CH);
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.strokeRect(0.5, 0.5, CW - 1, CH - 1);

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = PROBE_TXT;
    ctx.font = `800 26px ${MONO}`;
    ctx.fillText(meta.ticker, 26, 44);
    const tw = ctx.measureText(meta.ticker).width;
    ctx.font = `700 15px ${MONO}`;
    ctx.fillStyle = PROBE_ICE;
    ctx.fillText(meta.badge, 26 + tw + 12, 43);

    ctx.font = `13px ${MONO}`;
    ctx.fillStyle = PROBE_TXT;
    ctx.fillText(meta.exp, 26, 68);

    ctx.font = `800 34px ${MONO}`;
    ctx.fillStyle = probeTone(meta.pct);
    ctx.fillText(meta.pct == null ? "—" : `${meta.pct >= 0 ? "▲" : "▼"} ${Math.abs(meta.pct).toFixed(1)}%`, 26, 110);

    ctx.font = `15px ${MONO}`;
    ctx.fillStyle = PROBE_TXT;
    const line = `IN ${probePx(meta.entry)} → HIGH ${probePx(meta.mark)}`;
    ctx.fillText(line, 210, 108);
    if (meta.dollars != null) {
      ctx.fillStyle = probeTone(meta.dollars);
      ctx.font = `700 15px ${MONO}`;
      ctx.fillText(` ${meta.dollars >= 0 ? "+" : "−"}$${Math.abs(meta.dollars).toFixed(0)}/ct`, 210 + ctx.measureText(line).width + 14, 108);
    }

    ctx.drawImage(img, 20, HEAD - 8, 960, 340);

    ctx.font = `12px ${MONO}`;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(meta.hint, 26, CH - 14);

    const png: Blob | null = await new Promise((res) => cv.toBlob(res, "image/png"));
    if (!png) return false;

    const C = (window as unknown as { ClipboardItem?: new (i: Record<string, Blob>) => unknown }).ClipboardItem;
    if (!C || !navigator.clipboard || !("write" in navigator.clipboard)) return false;
    await (navigator.clipboard as unknown as { write: (d: unknown[]) => Promise<void> })
      .write([new C({ "image/png": png })]);
    return true;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── probe chart ──────────────────────────────────────────────────────────────
/**
 * The flagged contract's own price series — the "probe" chart. Past sessions
 * are the contract's daily bars; today's point is the 15-minute probe, so the
 * last dot moves intraday.
 *
 * This is the SAME treatment as the owner site's /owner/probe card, ported
 * verbatim onto the tracked-flag day series: ice-blue line over a fading wash,
 * three gridlines with a right-hand price rail, a dashed reference at the price
 * the contract was flagged at, the session high marked green and the low red,
 * the last mark in a pill tinted by P/L, and a hover crosshair whose readout
 * carries the date, the price and the $ P/L per contract.
 *
 * Price only, exactly like the owner card — spot is NOT drawn. It would need a
 * second independent scale (the contract is worth a couple of dollars, spot is
 * worth hundreds) and the day-by-day table directly below already carries spot,
 * spot Δ% and the contract Δ$/Δ% for every row on this chart.
 *
 * Hand-rolled SVG rather than a chart library: this renders inside a table cell
 * that is already inside two other tables, and every charting lib on this page
 * wants a measured container. A viewBox scales without measuring anything.
 */
function ProbeChart({ days, touchedDate, chartId }: { days: OutcomeDetailDay[]; touchedDate: string | null; chartId: string }) {
  const W = 960, H = 340, PADL = 12, PADR = 78, PADT = 26, PADB = 30;
  // The owner card's exact palette, hardcoded for the same reason it is there:
  // `captureFlagCard` serializes this SVG standalone for the PNG, and a theme
  // token that resolved to a CSS var would come out empty off-DOM.
  const ICE = PROBE_ICE, GRN = PROBE_GRN, RED = PROBE_RED;
  const MONO = PROBE_MONO;
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const n = days.length;
  // A no-trade day has no bar. Those days keep their slot on the x axis (the
  // timeline stays even) but carry no point, so the line BREAKS there rather
  // than drawing a straight segment across a gap that never happened.
  const pts = days
    .map((d, i) => ({ i, date: d.date, v: d.contractClose }))
    .filter((p) => p.v != null && Number.isFinite(p.v)) as { i: number; date: string; v: number }[];

  if (pts.length < 2) {
    return (
      <div style={{
        padding: "34px 0", textAlign: "center", fontFamily: MONO, fontSize: 13,
        color: HOME_THEME.text, opacity: 0.5, marginBottom: 14,
      }}>
        Not enough history yet — the contract needs a second session on the tape.
      </div>
    );
  }

  const ys = pts.map((p) => p.v);
  const hi = Math.max(...ys), lo = Math.min(...ys);
  const hiP = pts[ys.indexOf(hi)], loP = pts[ys.indexOf(lo)];

  // The contract's price on the day it was flagged is this chart's break-even:
  // it is what you would have paid to take the flag. It has to stay on-canvas
  // or the line the P/L is measured from reads as off-screen.
  const entry = pts[0].v;
  let minY = Math.min(lo, entry), maxY = Math.max(hi, entry);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const gpad = (maxY - minY) * 0.1; minY -= gpad; maxY += gpad;

  const sx = (i: number) => PADL + (n <= 1 ? 0 : i / (n - 1)) * (W - PADL - PADR);
  const sy = (v: number) => H - PADB - ((v - minY) / (maxY - minY || 1)) * (H - PADT - PADB);

  const segs: { i: number; v: number }[][] = [];
  {
    let cur: { i: number; v: number }[] = [];
    days.forEach((d, i) => {
      const v = d.contractClose;
      if (v == null || !Number.isFinite(v)) { if (cur.length) segs.push(cur); cur = []; return; }
      cur.push({ i, v });
    });
    if (cur.length) segs.push(cur);
  }
  const dOf = (s: { i: number; v: number }[]) =>
    s.map((p, k) => `${k ? "L" : "M"}${sx(p.i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const areaOf = (s: { i: number; v: number }[]) =>
    s.length < 2 ? "" : `${dOf(s)} L${sx(s[s.length - 1].i).toFixed(1)},${H - PADB} L${sx(s[0].i).toFixed(1)},${H - PADB} Z`;

  const last = pts[pts.length - 1].v;
  const up = last >= entry;
  const pillFill = up ? GRN : RED;
  const touchIdx = touchedDate ? days.findIndex((d) => d.date === ymd(touchedDate)) : -1;

  // Dates arrive as YYYY-MM-DD. Parse as UTC noon so a local timezone west of
  // Greenwich cannot roll the label back a day.
  const fmtD = (d: string) => {
    const t = Date.parse(`${d}T12:00:00Z`);
    return Number.isFinite(t) ? new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }) : d;
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const el = svgRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * W;               // client px → viewBox units
    const raw = ((vx - PADL) / (W - PADL - PADR)) * (n - 1);
    let best = 0, bd = Infinity;                                        // snap to the nearest DAY THAT TRADED
    pts.forEach((p, k) => { const d = Math.abs(p.i - raw); if (d < bd) { bd = d; best = k; } });
    setHover(best);
  };

  const hp = hover == null ? null : pts[hover];
  const hpl = hp == null ? null : (hp.v - entry) * 100;
  const hx = hp == null ? 0 : sx(hp.i);
  const tipW = 168, tipFlip = hx + 12 + tipW > W - PADR;                // flip left near the right rail

  return (
    <div>
      <svg
        ref={svgRef}
        id={chartId}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Contract price probe"
      >
        <defs>
          <linearGradient id={`${chartId}-wash`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ICE} stopOpacity={0.22} />
            <stop offset="100%" stopColor={ICE} stopOpacity={0} />
          </linearGradient>
        </defs>

        {[hi, (hi + lo) / 2, lo].map((v, i) => (
          <g key={i}>
            <line x1={PADL} y1={sy(v)} x2={W - PADR} y2={sy(v)} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
            <text x={W - PADR + 10} y={sy(v) + 4} fontSize={12} fill={PROBE_TXT} fontFamily={MONO}>{v.toFixed(2)}</text>
          </g>
        ))}

        {segs.map((s, i) => <path key={`a${i}`} d={areaOf(s)} fill={`url(#${chartId}-wash)`} />)}

        {/* Touched marker — the session spot first reached the flagged strike. */}
        {touchIdx >= 0 && (
          <>
            <line x1={sx(touchIdx)} x2={sx(touchIdx)} y1={PADT} y2={H - PADB}
              stroke={LIGHT_BLUE} strokeWidth={1} strokeDasharray="3 3" opacity={0.65} />
            <text x={sx(touchIdx) + 5} y={PADT + 10} fontSize={11} fill={LIGHT_BLUE} fontFamily={MONO} letterSpacing="1">TOUCHED</text>
          </>
        )}

        <line x1={PADL} y1={sy(entry)} x2={W - PADR} y2={sy(entry)} stroke="rgba(255,255,255,0.40)" strokeWidth={1} strokeDasharray="3 5" />
        <text x={PADL + 4} y={sy(entry) - 7} fontSize={11} fill={PROBE_TXT} fontFamily={MONO} letterSpacing="1">FLAGGED {entry.toFixed(2)}</text>

        {segs.map((s, i) => (
          <path key={`l${i}`} d={dOf(s)} fill="none" stroke={ICE} strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        <circle cx={sx(hiP.i)} cy={sy(hi)} r={3.4} fill="none" stroke={GRN} strokeWidth={1.6} />
        <text x={sx(hiP.i)} y={sy(hi) - 11} fontSize={12} fill={GRN} fontFamily={MONO} textAnchor="middle">H {hi.toFixed(2)}</text>
        <circle cx={sx(loP.i)} cy={sy(lo)} r={3.4} fill="none" stroke={RED} strokeWidth={1.6} />
        <text x={sx(loP.i)} y={sy(lo) + 18} fontSize={12} fill={RED} fontFamily={MONO} textAnchor="middle">L {lo.toFixed(2)}</text>

        <text x={PADL} y={H - 8} fontSize={12} fill={PROBE_TXT} fontFamily={MONO}>{fmtD(days[0]?.date ?? "")}</text>
        <text x={W - PADR} y={H - 8} fontSize={12} fill={PROBE_TXT} fontFamily={MONO} textAnchor="end">{fmtD(days[n - 1]?.date ?? "")}</text>

        <circle cx={sx(pts[pts.length - 1].i)} cy={sy(last)} r={3.6} fill={pillFill} />
        <rect x={W - PADR + 4} y={sy(last) - 11} width={62} height={22} rx={5} fill={pillFill} />
        <text x={W - PADR + 35} y={sy(last) + 4} fontSize={13} fontWeight={700} fill="#06090d" fontFamily={MONO} textAnchor="middle">{last.toFixed(2)}</text>

        {hp != null && (
          <g>
            <line x1={hx} y1={PADT} x2={hx} y2={H - PADB} stroke="rgba(255,255,255,0.32)" strokeWidth={1} strokeDasharray="2 3" />
            <circle cx={hx} cy={sy(hp.v)} r={4} fill="#05060a" stroke={ICE} strokeWidth={2} />
            <g transform={`translate(${tipFlip ? hx - 12 - tipW : hx + 12},${Math.max(PADT, sy(hp.v) - 46)})`}>
              <rect width={tipW} height={44} rx={7} fill="rgba(10,13,20,0.96)" stroke="rgba(48,209,88,0.45)" strokeWidth={1} />
              <text x={12} y={18} fontSize={11} fill={PROBE_TXT} fontFamily={MONO} letterSpacing="1">{hp.date}</text>
              <text x={12} y={35} fontSize={15} fontWeight={700} fill={PROBE_TXT} fontFamily={MONO}>${hp.v.toFixed(2)}</text>
              {hpl != null && (
                <text x={92} y={35} fontSize={13} fontWeight={700} fill={hpl >= 0 ? GRN : RED} fontFamily={MONO}>
                  {hpl >= 0 ? "+" : "−"}${Math.abs(hpl).toFixed(0)}
                </text>
              )}
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

/**
 * The expanded detail for one tracked flag. Rendered INLINE under the row that
 * was clicked (it used to be a centered modal) so the row it belongs to stays
 * on screen and you can open one, read it, and move down the list.
 */
function OutcomeDetailPanel({
  detail, loading, err, onClose,
}: {
  detail: OutcomeDetail | null;
  loading: boolean;
  err: string | null;
  onClose: () => void;
}) {
  const [shot, setShot] = useState<"idle" | "ok" | "bad">("idle");

  const stats = detail ? probeStats(detail.days) : null;
  const badge = detail ? `${detail.strike % 1 ? detail.strike : Math.round(detail.strike)}${detail.type}` : "";
  // DOM id for the capture — the SVG is fetched by id, so it has to be unique
  // per open card and free of the "." a fractional strike carries.
  const chartId = `flag-chart-${(detail ? `${detail.symbol}-${badge}-${ymd(detail.expiry) ?? detail.expiry}` : "x").replace(/[^A-Za-z0-9-]/g, "")}`;
  const hint = detail
    ? `Contract mark · daily bars · flagged @ ${probePx(stats?.entry ?? null)}${detail.touchedDate ? ` · touched ${detail.touchedDate}` : ""} · today sampled every 15m`
    : "";

  const empty: React.CSSProperties = {
    padding: "40px 0", textAlign: "center", color: PROBE_MUTED, fontSize: 12, fontFamily: PROBE_MONO,
  };
  const lbl: React.CSSProperties = {
    color: PROBE_MUTED, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 3,
  };
  const chip = (fg: string, bg: string, bd: string): React.CSSProperties => ({
    fontFamily: PROBE_MONO, fontSize: 12, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
    marginLeft: 6, color: fg, background: bg, border: `1px solid ${bd}`,
  });

  return (
    <div style={{
      background: PROBE_BG,
      border: "1px solid rgba(33,158,188,0.5)",
      borderRadius: 10,
      padding: 14,
      margin: "2px 0 8px",
      maxWidth: 940,
    }}>
      {/* Header — ticker + strike badge + status, mirroring the owner card. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontFamily: PROBE_MONO, fontSize: 18, fontWeight: 800, color: PROBE_TXT }}>
            {detail ? detail.symbol : "…"}
          </span>
          {detail && (
            <span style={detail.type === "C"
              ? chip(PROBE_ICE, "rgba(142,202,230,0.12)", "rgba(142,202,230,0.4)")
              : chip(HOME_THEME.orange, "rgba(251,133,1,0.12)", "rgba(251,133,1,0.4)")}>
              {badge}
            </span>
          )}
          {detail && (
            <span style={
              detail.status === "touched" ? chip(PROBE_ICE, "rgba(142,202,230,0.12)", "rgba(142,202,230,0.45)")
              : detail.status === "expired" ? chip(PROBE_RED, "rgba(255,91,91,0.12)", "rgba(255,91,91,0.45)")
              : chip(PROBE_GRN, "rgba(48,209,88,0.12)", "rgba(48,209,88,0.45)")
            }>
              {detail.status === "touched" ? `Touched ${detail.touchedDate ?? ""}` : detail.status.toUpperCase()}
            </span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{ background: "none", border: "none", color: PROBE_TXT, cursor: "pointer", fontSize: 17, lineHeight: 1, padding: "0 2px" }}
        >×</button>
      </div>

      <div style={{ fontFamily: PROBE_MONO, fontSize: 12, color: PROBE_MUTED, marginTop: 3 }}>
        {detail
          ? `${probeExp(detail.expiry)} · flagged ${detail.firstFlagged} at spot $${detail.spotAtFlag.toFixed(2)} (${detail.otmPctAtFlag.toFixed(0)}% OTM)`
          : "Loading…"}
      </div>

      {/* Big row — ▲/▼ % over "in → high · $/ct", per single contract (×100).
          The percentage is the PEAK the flag offered, measured from the flag
          price; the live mark trails it as a muted "now" so the card still says
          where the contract is today. */}
      {stats && (
        <div style={{ margin: "10px 0 8px" }}>
          <div style={{ fontFamily: PROBE_MONO, fontSize: 24, fontWeight: 800, lineHeight: 1, color: probeTone(stats.pct) }}>
            {stats.pct == null ? "—" : `${stats.pct >= 0 ? "▲" : "▼"} ${Math.abs(stats.pct).toFixed(1)}%`}
          </div>
          <div style={{ fontFamily: PROBE_MONO, fontSize: 14, color: PROBE_TXT, marginTop: 6 }}>
            <span style={lbl}>in</span>{probePx(stats.entry)}
            <span style={{ color: PROBE_MUTED, margin: "0 6px" }}>→</span>
            <span style={lbl}>high</span>{probePx(stats.mark)}
            <span style={{ fontWeight: 700, color: probeTone(stats.dollars) }}>
              {` · ${stats.dollars >= 0 ? "+" : "−"}$${Math.abs(stats.dollars).toFixed(0)}/ct`}
            </span>
            <span style={{ color: PROBE_MUTED, marginLeft: 10 }}>
              <span style={lbl}>now</span>{probePx(stats.last)}
            </span>
          </div>
        </div>
      )}

      {/* Chart well — same divider, toolbar and hint footer as the owner card. */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${PROBE_BORDER}` }}>
        {detail && !!detail.days.length && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 10 }}>
            <button
              type="button"
              title="Copy this card to the clipboard as a PNG"
              onClick={(e) => {
                e.stopPropagation();
                void captureFlagCard(chartId, {
                  ticker: detail.symbol,
                  badge,
                  exp: probeExp(detail.expiry),
                  pct: stats?.pct ?? null,
                  entry: stats?.entry ?? null,
                  mark: stats?.mark ?? null,
                  dollars: stats?.dollars ?? null,
                  hint,
                }).then((ok) => {
                  setShot(ok ? "ok" : "bad");
                  setTimeout(() => setShot("idle"), 1600);
                });
              }}
              style={{
                fontFamily: PROBE_MONO, fontSize: 12, fontWeight: 700, cursor: "pointer",
                padding: "4px 10px", borderRadius: 6,
                color: shot === "ok" ? PROBE_GRN : shot === "bad" ? PROBE_RED : PROBE_TXT,
                border: `1px solid ${shot === "ok" ? "rgba(48,209,88,0.6)" : shot === "bad" ? "rgba(255,91,91,0.6)" : "rgba(142,202,230,0.35)"}`,
                background: shot === "ok" ? "rgba(48,209,88,0.14)" : shot === "bad" ? "rgba(255,91,91,0.12)" : "rgba(142,202,230,0.08)",
              }}
            >
              {shot === "ok" ? "✓ Copied" : shot === "bad" ? "✗ Copy failed" : "⧉ Copy image"}
            </button>
          </div>
        )}

        {loading && <div style={empty}>Loading day-by-day detail…</div>}
        {err && <div style={{ ...empty, color: HOME_THEME.orange }}>{err}</div>}
        {detail && !detail.days.length && <div style={empty}>No daily bars yet.</div>}

        {detail && !!detail.days.length && (
          <>
            <ProbeChart days={detail.days} touchedDate={detail.touchedDate} chartId={chartId} />
            {/* Past sessions are the contract's own daily bars; today is our
                15-minute probe. A day the contract never traded has no bar, so
                it stays "—" until the probe covers it. */}
            <div style={{ marginTop: 8, fontFamily: PROBE_MONO, fontSize: 12, color: PROBE_MUTED, letterSpacing: "0.04em" }}>
              {hint} · no-trade days show —
            </div>
          </>
        )}
      </div>

      {detail && !!detail.days.length && (
        <>
          <div style={{ overflowX: "auto", marginTop: 14 }}>
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
        </>
      )}
    </div>
  );
}

function WatchThisScanner() {
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);

  const [outcomes, setOutcomes] = useState<OutcomeRow[]>([]);
  const [outcomeStatus, setOutcomeStatus] = useState<OutcomeView>("all");
  const [sort, setSort] = useState<OutcomeSort>(() => defaultOutcomeSort("all"));

  // Switching view resets the sort to that view's default — the Touched tab
  // wants newest-touch-first, which is not what the All tab wants.
  useEffect(() => { setSort(defaultOutcomeSort(outcomeStatus)); }, [outcomeStatus]);

  const onSort = useCallback((key: OutcomeSortKey) => {
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        // First click on a new column: dates and numbers open descending
        // (newest / biggest first), symbol opens A–Z.
        : { key, dir: key === "symbol" ? "asc" : "desc" }
    );
  }, []);

  const sortedOutcomes = useMemo(() => sortOutcomes(outcomes, sort), [outcomes, sort]);

  // "Results" view — every tracked flag bucketed by calendar date.
  const [resultRows, setResultRows] = useState<OutcomeRow[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsErr, setResultsErr] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const [detail, setDetail] = useState<OutcomeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  // Which row is expanded. One at a time, keyed by a UI-unique string rather
  // than the contract, because the Results view can list the SAME contract in
  // both the Opened and Touched sections of a date — keying by contract alone
  // would open both.
  const [openRow, setOpenRow] = useState<string | null>(null);
  // Guards against a slow response for a row you already closed (or moved past)
  // painting itself into whatever row is open now.
  const detailReq = useRef(0);

  const closeDetail = useCallback(() => {
    detailReq.current += 1;
    setOpenRow(null); setDetail(null); setDetailErr(null); setDetailLoading(false);
  }, []);

  const openDetail = useCallback(async (uiKey: string, o: OutcomeRow) => {
    if (openRow === uiKey) { closeDetail(); return; } // second click on the same row closes it
    const req = ++detailReq.current;
    setOpenRow(uiKey);
    setDetail(null); setDetailErr(null); setDetailLoading(true);
    try {
      const qs = new URLSearchParams({ symbol: o.symbol, strike: String(o.strike), expiry: o.expiry }).toString();
      const res = await fetch(`/proxy/far-cb-outcome-detail?${qs}`, { cache: "no-store" });
      const j = await res.json();
      if (detailReq.current !== req) return;
      if (!j.ok) throw new Error(j.error || "load failed");
      setDetail(j);
    } catch (e: any) {
      if (detailReq.current !== req) return;
      setDetailErr(String(e?.message || e));
    } finally {
      if (detailReq.current === req) setDetailLoading(false);
    }
  }, [openRow, closeDetail]);

  // The panel is rendered inline under whichever row is open, in whichever
  // table that row lives in — built once here so both call sites stay in sync.
  const detailPanel = (
    <OutcomeDetailPanel detail={detail} loading={detailLoading} err={detailErr} onClose={closeDetail} />
  );

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
  // renders per-day counts and the flag fields — it never touches the contract
  // columns, so there is no reason to make the server price 300 contracts for it.
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
              : "Graded daily ~16:10 ET · no win/loss — just whether spot reached the strike · Entry = the flagged contract's price the day it was flagged, High = the best it has printed since, Max % = the move between them · click any column to sort"}
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
            openRow={openRow}
            detailPanel={detailPanel}
          />
        ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ color: HOME_THEME.green, textAlign: "right", fontSize: 14, textTransform: "uppercase" }}>
                <OutcomeTh label="Symbol"       sortKey="symbol"          sort={sort} onSort={onSort} align="left" />
                <OutcomeTh label="Strike"       sortKey="strike"          sort={sort} onSort={onSort} />
                <OutcomeTh label="Expiry"       sortKey="expiry"          sort={sort} onSort={onSort} align="left" />
                <OutcomeTh label="Flagged"      sortKey="first_flagged"   sort={sort} onSort={onSort} align="left" />
                <OutcomeTh label="Entry"        sortKey="opt_entry"       sort={sort} onSort={onSort} />
                <OutcomeTh label="High"         sortKey="opt_high"        sort={sort} onSort={onSort} />
                <OutcomeTh label="Max %"        sortKey="opt_pct_high"    sort={sort} onSort={onSort} />
                <OutcomeTh label="Flagged Spot" sortKey="spot_at_flag"    sort={sort} onSort={onSort} />
                <OutcomeTh label="OTM at flag"  sortKey="otm_pct_at_flag" sort={sort} onSort={onSort} />
                <OutcomeTh label="Closest"      sortKey="closest_pct"     sort={sort} onSort={onSort} />
                <OutcomeTh label="Touched"      sortKey="touched_date"    sort={sort} onSort={onSort} align="left" />
                <OutcomeTh label="Status"       sortKey="status"          sort={sort} onSort={onSort} align="left" />
              </tr>
            </thead>
            <tbody>
              {sortedOutcomes.map((o, i) => {
                const rk = `flat|${outcomeKey(o)}`;
                const isOpen = openRow === rk;
                return (
                <Fragment key={rk}>
                <tr
                  onClick={() => openDetail(rk, o)}
                  title={isOpen ? "Click to collapse" : "Click for day-by-day detail"}
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    background: isOpen ? "rgba(33,158,188,0.10)" : i % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                    cursor: "pointer",
                  }}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{o.symbol}</td>
                  <td style={{ ...td, fontWeight: 700, color: o.side === "above" ? HOME_THEME.green : HOME_THEME.red }}>${o.strike}</td>
                  <td style={{ ...td, textAlign: "left", color: HOME_THEME.text, fontSize: 14 }}>{o.expiry}</td>
                  <td style={{ ...td, textAlign: "left", color: HOME_THEME.text, fontSize: 14 }}>{o.first_flagged}</td>
                  {/* Entry carries the C/P letter — it is the first cell that
                      names the contract, and repeating it on High would say the
                      same thing twice on one row. */}
                  <td
                    style={{ ...td, fontWeight: 700 }}
                    title={o.opt_entry_date ? `First price recorded ${o.opt_entry_date}` : undefined}
                  >
                    {o.opt_entry != null
                      ? `$${o.opt_entry.toFixed(2)}${o.opt_type ? ` ${o.opt_type}` : ""}`
                      : "—"}
                  </td>
                  <td style={{ ...td, fontWeight: 700, color: o.opt_high != null ? LIGHT_BLUE : HOME_THEME.text }}>
                    {o.opt_high != null ? `$${o.opt_high.toFixed(2)}` : "—"}
                  </td>
                  {/* Max % can only be negative if the contract never traded
                      above its entry — the high is taken from the flag date on,
                      so it includes the entry bar itself. */}
                  <td style={{
                    ...td, fontWeight: 700,
                    color: o.opt_pct_high == null ? HOME_THEME.text : o.opt_pct_high >= 0 ? HOME_THEME.green : HOME_THEME.red,
                  }}>
                    {o.opt_pct_high == null
                      ? "—"
                      : `${o.opt_pct_high >= 0 ? "▲" : "▼"} ${Math.abs(o.opt_pct_high).toFixed(1)}%`}
                  </td>
                  <td style={td}>${o.spot_at_flag.toFixed(2)}</td>
                  <td style={td}>{o.otm_pct_at_flag.toFixed(0)}%</td>
                  <td style={{ ...td, color: o.closest_pct != null && o.closest_pct < 1 ? LIGHT_BLUE : HOME_THEME.text }}>
                    {o.closest_pct != null ? `${o.closest_pct.toFixed(1)}%` : "—"}
                  </td>
                  {/* Touched date is its own column now so it can be sorted on
                      — it used to be glued onto the status label. */}
                  <td style={{ ...td, textAlign: "left", color: o.touched_date ? LIGHT_BLUE : HOME_THEME.text, whiteSpace: "nowrap" }}>
                    {ymd(o.touched_date) ?? "—"}
                  </td>
                  <td style={{ ...td, textAlign: "left" }}>
                    <span style={{
                      fontSize: 14, fontWeight: 800, letterSpacing: "0.05em",
                      color: o.status === "touched" ? LIGHT_BLUE : o.status === "expired" ? HOME_THEME.text : HOME_THEME.green,
                    }}>
                      {o.status.toUpperCase()}
                    </span>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={12} style={{ padding: "0 0 0 10px", background: "rgba(0,0,0,0.20)" }}>
                      {detailPanel}
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
              {!outcomes.length && (
                <tr><td colSpan={12} style={{ padding: 20, textAlign: "center", color: HOME_THEME.text }}>
                  No tracked flags yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

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
  days, loading, err, openDay, onToggleDay, onPickRow, openRow, detailPanel,
}: {
  days: DayBucket[];
  loading: boolean;
  err: string | null;
  openDay: string | null;
  onToggleDay: (date: string) => void;
  /** (uiKey, row) — uiKey identifies the clicked ROW, not the contract. */
  onPickRow: (uiKey: string, o: OutcomeRow) => void;
  openRow: string | null;
  /** Rendered inline under whichever row `openRow` names. */
  detailPanel: ReactNode;
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
                                    {rows.map((o, j) => {
                                      // Section-scoped: one contract can appear
                                      // under both Opened and Touched on the
                                      // same date, and only the clicked one
                                      // should expand.
                                      const rk = `day|${d.date}|${sec.key}|${outcomeKey(o)}`;
                                      const isOpen = openRow === rk;
                                      return (
                                      <Fragment key={rk}>
                                      <tr
                                        onClick={() => onPickRow(rk, o)}
                                        title={isOpen ? "Click to collapse" : "Click for day-by-day detail"}
                                        style={{
                                          borderTop: "1px solid rgba(255,255,255,0.06)",
                                          background: isOpen ? "rgba(33,158,188,0.10)" : j % 2 ? "rgba(255,255,255,0.02)" : "transparent",
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
                                      {isOpen && (
                                        <tr>
                                          <td colSpan={8} style={{ padding: "0 0 0 10px", background: "rgba(0,0,0,0.25)" }}>
                                            {detailPanel}
                                          </td>
                                        </tr>
                                      )}
                                      </Fragment>
                                      );
                                    })}
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

/** Tabs scannerNav marks ownerOnly — never rendered for anyone else. */
const OWNER_ONLY_TABS = new Set<MainTab>(
  SCANNER_TABS.filter((t) => t.ownerOnly).map((t) => t.id as MainTab),
);

export default function ScannerPage() {
  // /scanner opens on GEX Change Top (2026-08-21). Any ?tab= in the URL still
  // wins — the deep-link effect below overrides this on mount.
  const [tab, setTab] = useState<MainTab>("gexchangetop");
  // The sub-strip already hides owner-only pills; this is the other half, so a
  // pasted /scanner?tab=pickstudy URL doesn't open one. `loaded` matters: auth
  // resolves a tick after mount, and bouncing before it does would kick the
  // owner off their own tab on every hard refresh.
  const { isOwner, loaded: authLoaded } = useIsOwner();
  const ownerGated = OWNER_ONLY_TABS.has(tab) && !isOwner;
  // While auth is still resolving, an owner-gated tab renders NOTHING rather
  // than falling back — a flash of the wrong tab that then swaps is worse than
  // an empty beat, and it would also fire that tab's fetches.
  const visibleTab: MainTab | null = ownerGated ? (authLoaded ? "gexchangetop" : null) : tab;

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
      {visibleTab === "gexlevels" && <GexLevelsTab />}
      {visibleTab === "gexchangetop" && <GexChangeTop />}
      {visibleTab === "pickstudy" && <PickStudyTab />}
      {visibleTab === "strike" && <StrikeQueryScanner />}
      {visibleTab === "tpo" && <TpoStructuresScanner />}
      {visibleTab === "ibstats" && <IbStatsTab />}
      {visibleTab === "watch" && <WatchThisScanner />}
    </PageShell>
  );
}
