"use client";

import { useState, useEffect, useRef } from "react";
import SnapshotPanel from "@/components/dashboard/SnapshotPanel";
import EconCalendarPanel from "@/components/dashboard/EconCalendarPanel";
import Subscriber, { type SubscriberState } from "@/lib/subscriber";

// ── Helpers ───────────────────────────────────────────────────────────────────
function etNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function isMarketOpen() {
  const d = etNow();
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= 570 && mins < 960;
}

function fmtMoney(v: number) {
  if (!isFinite(v)) return "--";
  const s = v >= 0 ? "+" : "-";
  const a = Math.abs(v);
  if (a >= 1e9) return s + "$" + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(1) + "K";
  return s + "$" + a.toFixed(0);
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const BarChart2 = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);
const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);
const ActivityIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
  </svg>
);
const LayersIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>
  </svg>
);
const HomeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);
const GridIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
  </svg>
);
const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);
const RotateCcwIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.91"/>
  </svg>
);

// ── Data ──────────────────────────────────────────────────────────────────────
const SIDEBAR_SYMBOLS = ["AMD", "META", "SMH", "NVDA", "AMZN", "NQU", "QQQ", "GOOGL", "MSFT", "AAPL"];
const DEFAULT_QUOTES = SIDEBAR_SYMBOLS.map(sym => ({ sym, chg: "—", pos: true, active: sym === "NQU" }));

const HEATMAP_ROWS = [
  { strike: "7,600", rank: 2, rankColor: "#8B94A7", netGex: "$63.72M", volOnly: "$63.72M", dex: "$25.82M", vex: "$73.62M", dwGex: "$9.90M", type: "pos-strong" },
  { strike: "7,595", netGex: "$8.01M",   volOnly: "$8.01M",   dex: "$3.46M",   vex: "$9.47M",   dwGex: "$1.47M",   type: "neutral" },
  { strike: "7,590", rank: 3, rankColor: "#F97316", netGex: "-$21.77M", volOnly: "$10.16M", dex: "-$50.32M", vex: "$12.32M", dwGex: "$2.15M", type: "neg-red" },
  { strike: "7,585", netGex: "$9.86M",   volOnly: "$9.86M",   dex: "$4.70M",   vex: "$12.13M",  dwGex: "$2.27M",   type: "neutral" },
  { strike: "7,580", netGex: "$9.38M",   volOnly: "$9.38M",   dex: "$4.80M",   vex: "$11.97M",  dwGex: "$2.59M",   type: "neutral" },
  { strike: "7,575", rank: 5, rankColor: "#8B94A7", netGex: "$13.32M",  volOnly: "$13.32M",  dex: "$6.05M",   vex: "$16.63M",  dwGex: "$3.31M",   type: "neutral" },
  { strike: "7,570", rank: 1, rankColor: "#F97316", netGex: "$200.41M", volOnly: "$11.71M",  dex: "$118.50M", vex: "$15.84M",  dwGex: "$4.13M",   type: "pos-top" },
  { strike: "7,565", netGex: "$12.04M",  volOnly: "$12.04M",  dex: "$7.73M",   vex: "$16.77M",  dwGex: "$4.74M",   type: "neutral" },
  { strike: "7,560", rank: 4, rankColor: "#8B94A7", netGex: "$13.65M",  volOnly: "$13.65M",  dex: "$8.65M",   vex: "$19.04M",  dwGex: "$5.39M",   type: "neutral" },
  { strike: "7,555", atm: true, rank: 2, rankColor: "#8B94A7", netGex: "$20.27M", volOnly: "$20.27M", dex: "$14.26M", vex: "$29.17M", dwGex: "$8.90M", type: "atm" },
  { strike: "7,550", rank: 4, rankColor: "#8B94A7", netGex: "-$11.19M", volOnly: "-$11.19M", dex: "-$8.14M",  vex: "-$16.22M", dwGex: "-$5.03M",  type: "neg" },
  { strike: "7,545", netGex: "-$1.82M",  volOnly: "-$1.82M",  dex: "-$1.33M",  vex: "-$2.63M",  dwGex: "-$803.30K", type: "neg" },
  { strike: "7,540", netGex: "-$2.19M",  volOnly: "-$2.19M",  dex: "-$1.25M",  vex: "-$2.91M",  dwGex: "-$724.10K", type: "neg" },
  { strike: "7,535", netGex: "$420.98K", volOnly: "$420.98K", dex: "$878.09K", vex: "$798.86K", dwGex: "$377.88K",  type: "neutral" },
  { strike: "7,530", rank: 3, rankColor: "#F97316", netGex: "-$19.35M", volOnly: "-$19.35M", dex: "-$11.95M", vex: "-$25.73M", dwGex: "-$6.38M",  type: "neg-red" },
  { strike: "7,525", rank: 5, rankColor: "#8B94A7", netGex: "-$9.03M",  volOnly: "-$9.03M",  dex: "-$5.17M",  vex: "-$11.61M", dwGex: "-$2.57M",  type: "neg" },
  { strike: "7,520", rank: 1, rankColor: "#F97316", netGex: "-$47.34M", volOnly: "-$3.92M",  dex: "-$27.74M", vex: "-$5.00M",  dwGex: "-$1.08M",  type: "neg-top" },
  { strike: "7,515", netGex: "-$3.28M",  volOnly: "-$3.28M",  dex: "-$1.87M",  vex: "-$4.09M",  dwGex: "-$811.00K", type: "neg" },
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  const [now, setNow] = useState(new Date());
  const [sidebarQuotes, setSidebarQuotes] = useState(DEFAULT_QUOTES);
  const [spx, setSpx] = useState(7554.29);
  const [spxChg, setSpxChg] = useState(122.83);
  const [spxChgPct, setSpxChgPct] = useState(1.65);
  const [esFut, setEsFut] = useState(7562.0);
  const [netGex, setNetGex] = useState(15790000000);
  const [vix, setVix] = useState(16.20);
  const [callWall, setCallWall] = useState<number | null>(null);
  const [putWall, setPutWall] = useState<number | null>(null);
  const [gexFlip, setGexFlip] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"calendar" | "snapshot" | "spxflow">("calendar");
  const [showPageMenu, setShowPageMenu] = useState(false);
  const [rawChain, setRawChain] = useState<SubscriberState["chain"]>([]);
  const [heatmapData, setHeatmapData] = useState<{ strike: string; netGex: string; volOnly: string; dex: string; vex: string; dwGex: string; type: string; rank?: number; rankColor?: string; atm?: boolean }[]>(HEATMAP_ROWS);
  const [chartMode, setChartMode] = useState<"net-gex" | "call-put" | "oi-vol" | "vol-only" | "oi-overlay" | "net-dex" | "gex-flip">("net-gex");
  const [selectedExpiry, setSelectedExpiry] = useState<"0dte" | "1dte">("1dte");
  const prevSpxRef = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const subscriber = Subscriber.getInstance();
    subscriber.init();

    // Subscribe to state updates
    const unsubscribe = subscriber.subscribe((state: SubscriberState) => {
      if (state.spotPrice > 100) {
        const prev = prevSpxRef.current;
        if (prev > 0) {
          const chg = state.spotPrice - prev;
          setSpxChg(chg);
          setSpxChgPct((chg / prev) * 100);
        }
        if (prev === 0) prevSpxRef.current = state.spotPrice;
        setSpx(state.spotPrice);
      }
      setEsFut(state.esFutures);
      setVix(state.vix);
      setNetGex(state.netGex);
      setCallWall(state.callWall);
      setPutWall(state.putWall);
      setGexFlip(state.gexFlip);

      if (state.chain.length > 0) {
        setRawChain(state.chain);
      }
    });

    return () => {
      unsubscribe();
      subscriber.disconnect();
    };
  }, []);

  // ── Task #13: Sidebar quotes poll ─────────────────────────────────────────────
  useEffect(() => {
    const fetchQuotes = async () => {
      try {
        const syms = SIDEBAR_SYMBOLS.join(",");
        const res = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(syms)}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const items: Array<{ symbol: string; mark?: number; "prev-day-close"?: number; last?: number }> = Array.isArray(json?.data?.items) ? json.data.items : [];
        if (!items.length) return;
        setSidebarQuotes(SIDEBAR_SYMBOLS.map(sym => {
          const q = items.find(i => i.symbol === sym || i.symbol === `${sym}:XCIS`);
          if (!q) return { sym, chg: "—", pos: true, active: sym === "NQU" };
          const price = q.mark ?? q.last ?? 0;
          const prev = q["prev-day-close"] ?? 0;
          const pct = prev > 0 ? ((price - prev) / prev) * 100 : 0;
          const pos = pct >= 0;
          return { sym, chg: `${pos ? "+" : ""}${pct.toFixed(2)}%`, pos, active: sym === "NQU" };
        }));
      } catch { /* non-fatal */ }
    };
    fetchQuotes();
    const t = setInterval(fetchQuotes, 30_000);
    return () => clearInterval(t);
  }, []);

  // ── Task #7 Step 3 + Task #9: Filter heatmap by expiry, apply live colors ────
  useEffect(() => {
    if (rawChain.length === 0) return;

    const spot = spx || 7554;
    const atmStrike = rawChain.reduce((best, r) =>
      Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best
    ).strike;

    // Filter by DTE: 0DTE = dte <= 0 or dte === 1 (same-day); 1DTE = dte <= 1
    const filtered = rawChain.filter(r => {
      if (selectedExpiry === "0dte") return r.dte <= 1;
      return r.dte <= 2; // 1DTE = include 0+1
    });

    const source = filtered.length > 0 ? filtered : rawChain;

    // Sort descending (highest strike first) for display
    const sortedAll = [...source].sort((a, b) => b.strike - a.strike);

    // Window: 20 above + ATM + 20 below spot
    const atmIdx = sortedAll.findIndex(r => r.strike === atmStrike);
    const winStart = Math.max(0, atmIdx - 20);
    const winEnd = Math.min(sortedAll.length - 1, atmIdx + 20);
    const sorted = sortedAll.slice(winStart, winEnd + 1);

    // Find top pos/neg for rank badges
    const sorted_by_abs_gex = [...sorted].sort((a, b) => Math.abs(b.netGEX) - Math.abs(a.netGEX));
    const topPos = sorted_by_abs_gex.filter(r => r.netGEX > 0).slice(0, 5).map(r => r.strike);
    const topNeg = sorted_by_abs_gex.filter(r => r.netGEX < 0).slice(0, 5).map(r => r.strike);
    const posRanks = Object.fromEntries(topPos.map((s, i) => [s, i + 1]));
    const negRanks = Object.fromEntries(topNeg.map((s, i) => [s, i + 1]));

    const fmt = (v: number) => {
      const a = Math.abs(v);
      const sign = v < 0 ? "-" : "";
      if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
      if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
      if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
      return `${sign}$${a.toFixed(0)}`;
    };

    const rows = sorted.map(r => {
      const isAtm = r.strike === atmStrike;
      const isPosTop = posRanks[r.strike] === 1;
      const isNegTop = negRanks[r.strike] === 1;
      const rank = posRanks[r.strike] ?? negRanks[r.strike];
      const rankColor = rank && rank <= 2 ? "#F97316" : rank ? "#8B94A7" : undefined;

      let type = "neutral";
      if (isAtm) type = "atm";
      else if (isPosTop) type = "pos-top";
      else if (isNegTop) type = "neg-top";
      else if (r.netGEX > 0 && posRanks[r.strike]) type = "pos-strong";
      else if (r.netGEX < 0 && negRanks[r.strike]) type = "neg-red";
      else if (r.netGEX < 0) type = "neg";

      return {
        strike: r.strike.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
        netGex: fmt(r.netGEX),
        volOnly: fmt(r.netVolGEX),
        dex: fmt(r.netDEX),
        vex: "—",
        dwGex: fmt(r.volNetDEX),
        type,
        rank: rank ?? undefined,
        rankColor,
        atm: isAtm,
      };
    });

    setHeatmapData(rows);
  }, [rawChain, selectedExpiry, spx]);


  const etTime = now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  // ── Task #8: Compute GEX chart bars from live chain ───────────────────────────
  const chartBars = (() => {
    if (rawChain.length === 0) return null;

    // Filter by expiry (same logic as heatmap)
    const filtered = rawChain.filter(r =>
      selectedExpiry === "0dte" ? r.dte <= 1 : r.dte <= 2
    );
    const source = filtered.length > 0 ? filtered : rawChain;
    const sorted = [...source].sort((a, b) => a.strike - b.strike);

    // Pick value to chart based on chartMode
    const getVal = (r: typeof sorted[0]) => {
      if (chartMode === "vol-only") return r.netVolGEX;
      if (chartMode === "net-dex") return r.netDEX;
      if (chartMode === "call-put") return r.callGEX - Math.abs(r.putGEX);
      return r.netGEX; // net-gex, oi-vol, oi-overlay, gex-flip all default to netGEX
    };

    const vals = sorted.map(r => getVal(r));
    const maxAbs = Math.max(...vals.map(Math.abs), 1);

    // Trim to ~40 strikes centered on spot
    const spot = spx || sorted[Math.floor(sorted.length / 2)]?.strike || 7500;
    const atmIdx = sorted.reduce((bi, r, i) => Math.abs(r.strike - spot) < Math.abs(sorted[bi].strike - spot) ? i : bi, 0);
    const half = 20;
    const start = Math.max(0, atmIdx - half);
    const end = Math.min(sorted.length - 1, atmIdx + half);
    const slice = sorted.slice(start, end + 1);
    const sliceVals = vals.slice(start, end + 1);

    const CHART_W = 800;
    const CHART_H = 300;
    const ZERO_Y = CHART_H / 2; // zero line at midpoint
    const barW = Math.max(10, Math.floor(CHART_W / (slice.length + 2)) - 2);
    const spacing = Math.floor(CHART_W / (slice.length + 1));

    // Find peak pos bar for label
    let peakPosBar: { x: number; y: number; strike: number } | null = null as { x: number; y: number; strike: number } | null;
    let peakPosVal = 0;

    const bars = slice.map((r, i) => {
      const v = sliceVals[i];
      const x = spacing * (i + 0.5);
      const heightPct = Math.abs(v) / maxAbs;
      const barH = Math.max(2, heightPct * (CHART_H / 2 - 20));
      const isPos = v >= 0;
      const y = isPos ? ZERO_Y - barH : ZERO_Y;
      const fill = isPos ? "url(#cyanBarGrad)" : "url(#goldBarGrad)";
      const glow = isPos
        ? "drop-shadow(0 0 6px rgba(0,240,255,0.5))"
        : "drop-shadow(0 0 6px rgba(234,179,8,0.5))";
      const highlight = Math.abs(v) > maxAbs * 0.5;

      if (isPos && Math.abs(v) > peakPosVal) {
        peakPosVal = Math.abs(v);
        peakPosBar = { x, y, strike: r.strike };
      }

      return { x, y, barH, barW, fill: highlight ? (isPos ? "#00F0FF" : "url(#goldBarBright)") : fill, glow: highlight ? glow : undefined, strike: r.strike, isPos };
    });

    // Peak label based on chartMode
    const peakLabel = (() => {
      if (chartMode === "net-gex" || chartMode === "oi-vol") return callWall ? `${callWall.toLocaleString()}` : null;
      if (chartMode === "vol-only") {
        const top = [...source].sort((a, b) => Math.abs(b.netVolGEX) - Math.abs(a.netVolGEX))[0];
        return top ? `${top.strike.toLocaleString()}` : null;
      }
      if (chartMode === "net-dex") {
        const top = [...source].sort((a, b) => Math.abs(b.netDEX) - Math.abs(a.netDEX))[0];
        return top ? `${top.strike.toLocaleString()}` : null;
      }
      const ppb = peakPosBar as { x: number; y: number; strike: number } | null;
      return ppb ? `${ppb.strike.toLocaleString()}` : null;
    })();

    return { bars, peakPosBar: peakPosBar as { x: number; y: number; strike: number } | null, peakLabel, spot };
  })();

  // ── Styles ──────────────────────────────────────────────────────────────────
  const C = {
    bg: "#05060A",
    panel: "#0D1119",
    cyan: "#00F0FF",
    purple: "#8B5CF6",
    orange: "#F97316",
    green: "#10B981",
    red: "#EF4444",
    muted: "#8B94A7",
  };

  const floatSection: React.CSSProperties = {
    position: "relative",
    padding: "0",
  };

  const gradDivider: React.CSSProperties = {
    height: 1,
    background: "linear-gradient(to right, transparent, rgba(0,240,255,0.08), rgba(139,92,246,0.08), transparent)",
    margin: "0",
  };

  return (
    <div style={{
      height: "100%", width: "100%", overflow: "hidden",
      background: C.bg,
      backgroundImage: "radial-gradient(circle at 15% 50%, rgba(0,240,255,0.02) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(139,92,246,0.03) 0%, transparent 50%)",
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      color: "#fff",
      display: "flex",
      flexDirection: "row",
    }}>

      {/* ── SIDEBAR ────────────────────────────────────────────────────────── */}
      <aside style={{
        width: 85, flexShrink: 0, display: "flex", flexDirection: "column",
        padding: "24px 0", alignItems: "center", zIndex: 20, position: "relative",
        background: "rgba(0,0,0,0.10)", backdropFilter: "blur(12px)",
        borderRight: "1px solid rgba(255,255,255,0.05)",
      }}>
        {/* Logo */}
        <div style={{
          width: 48, height: 48, background: "rgba(0,240,255,0.10)", borderRadius: 12,
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          boxShadow: "0 0 20px -5px rgba(0,240,255,0.3)", border: "1px solid rgba(0,240,255,0.2)",
          marginBottom: 24, color: C.cyan,
        }}>
          <HomeIcon />
        </div>

        {/* Nav */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20, width: "100%", alignItems: "center", color: "#fff", marginBottom: 20, position: "relative" }}>
          <span style={{ color: "#fff", cursor: "pointer", position: "relative" }} onClick={() => setShowPageMenu(!showPageMenu)}>
            <GridIcon />
            {showPageMenu && (
              <div style={{ position: "absolute", left: 60, top: -100, background: "rgba(13,17,25,0.95)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8, minWidth: 180, maxHeight: 400, overflowY: "auto", zIndex: 100 }}>
                {["Overview", "Premarket", "Database", "Insider", "ETF", "Move", "Options Chain", "Multi Greek", "Trading", "Logs", "Personal", "Legging", "Expiry Calendar"].map(page => (
                  <div key={page} onClick={() => { setShowPageMenu(false); window.location.href = `/${page.toLowerCase().replace(/\s+/g, "-")}`; }} style={{ padding: "12px 16px", cursor: "pointer", color: "#fff", fontSize: 13, transition: "background 0.15s", borderBottom: "1px solid rgba(255,255,255,0.05)" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,240,255,0.10)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    {page}
                  </div>
                ))}
              </div>
            )}
          </span>
          <span style={{ cursor: "pointer", transition: "color 0.15s" }} onMouseEnter={e => (e.currentTarget.style.color = "#fff")} onMouseLeave={e => (e.currentTarget.style.color = "#fff")}>
            <CalendarIcon />
          </span>
        </div>
        <div style={{ width: 32, height: 1, background: "rgba(255,255,255,0.10)", marginBottom: 16 }} />

        {/* Quotes */}
        <div style={{ flex: 1, width: "100%", overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 0, scrollbarWidth: "none" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.15em", position: "sticky", top: 0, background: "rgba(5,6,10,0.8)", backdropFilter: "blur(8px)", width: "100%", textAlign: "center", padding: "8px 0", zIndex: 10 }}>Quotes</div>
          {sidebarQuotes.map(q => (
            <div key={q.sym} style={{
              display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer",
              padding: "6px 0", width: "100%", transition: "background 0.15s",
              background: q.active ? "rgba(255,255,255,0.05)" : "transparent",
              borderLeft: q.active ? `2px solid ${C.cyan}` : "2px solid transparent",
            }}
              onMouseEnter={e => { if (!q.active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={e => { if (!q.active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "#fff" }}>{q.sym}</span>
              <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: q.pos ? C.green : C.red }}>{q.chg}</span>
            </div>
          ))}
          <div style={{ width: 32, height: 1, background: "rgba(255,255,255,0.10)", margin: "8px 0" }} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", padding: "6px 0", width: "100%" }}>
            <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: C.red }}>VIX</span>
            <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: C.red }}>{vix > 0 ? vix.toFixed(2) : "—"}</span>
          </div>
          <div style={{ width: 32, height: 1, background: "rgba(255,255,255,0.10)", margin: "8px 0" }} />
          <div style={{ fontSize: 9, fontWeight: 700, color: C.purple, textTransform: "uppercase", letterSpacing: "0.12em", textAlign: "center", padding: "4px 0" }}>Sigma</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "4px 0", marginBottom: 8, width: "100%" }}>
            {[
              { label: "1σ", val: "7,595", color: C.cyan },
              { label: "2σ", val: "7,636", color: C.purple },
              { label: "-1σ", val: "7,513", color: C.cyan },
              { label: "-2σ", val: "7,472", color: C.purple },
            ].map(s => (
              <div key={s.label} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ fontFamily: "monospace", fontSize: 9, fontWeight: 700, color: s.color, opacity: 0.7 }}>{s.label}</span>
                <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: "#fff" }}>{s.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom */}
        <div className="grad-divider-sidebar-t" style={{ marginTop: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 20, paddingTop: 16, width: "100%" }}>
          <span style={{ color: "#fff", cursor: "pointer", transition: "color 0.15s" }} onMouseEnter={e => (e.currentTarget.style.color = "#fff")} onMouseLeave={e => (e.currentTarget.style.color = "#fff")}>
            <SettingsIcon />
          </span>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: `linear-gradient(135deg, ${C.purple}, ${C.cyan})`, boxShadow: "0 0 20px -5px rgba(139,92,246,0.3)", cursor: "pointer" }} />
        </div>
      </aside>

      {/* ── MAIN ──────────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", minWidth: 0 }}>

        {/* ── BODY ──────────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "row", padding: "24px", gap: 32, minHeight: 0, overflow: "hidden" }}>

          {/* LEFT COLUMN */}
          <div style={{ width: "55%", display: "flex", flexDirection: "column", gap: 0, minWidth: 0, height: "100%", overflow: "hidden" }}>

            {/* GEX CHART */}
            <div style={{
              background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)",
              borderRadius: 16, padding: 24, display: "flex", flexDirection: "column",
              height: 400, flexShrink: 0,
            }}>
              {/* Chart Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  <span style={{ color: C.cyan }}><BarChart2 /></span>
                  Net Strike Gamma Exposure
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end", width: "100%" }}>
                  <button onClick={() => setSelectedExpiry("0dte")} style={{ color: "#fff", padding: "4px 10px", fontSize: 10, background: selectedExpiry === "0dte" ? "rgba(0,240,255,0.25)" : "rgba(255,255,255,0.02)", border: "none", cursor: "pointer", textTransform: "uppercase", fontWeight: 600, boxShadow: selectedExpiry === "0dte" ? "0 0 20px -5px rgba(0,240,255,0.3)" : "none" }}>0DTE 6/15</button>
                  <button onClick={() => setSelectedExpiry("1dte")} style={{ background: selectedExpiry === "1dte" ? "rgba(0,240,255,0.25)" : "rgba(255,255,255,0.02)", color: C.cyan, border: "none", padding: "4px 10px", fontSize: 10, borderRadius: 4, cursor: "pointer", boxShadow: selectedExpiry === "1dte" ? "0 0 20px -5px rgba(0,240,255,0.3)" : "none", textTransform: "uppercase", fontWeight: 600 }}>1DTE 6/16</button>
                  <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.10)", margin: "0 4px" }} />
                  <button onClick={() => setChartMode("net-gex")} style={{ color: chartMode === "net-gex" ? C.cyan : "#fff", padding: "4px 10px", fontSize: 10, background: chartMode === "net-gex" ? "rgba(0,240,255,0.10)" : "rgba(255,255,255,0.02)", border: "none", cursor: "pointer", textTransform: "uppercase", fontWeight: 600 }}>Net GEX</button>
                  <button onClick={() => setChartMode("call-put")} style={{ color: chartMode === "call-put" ? C.cyan : "#fff", padding: "4px 10px", fontSize: 10, background: chartMode === "call-put" ? "rgba(0,240,255,0.10)" : "rgba(255,255,255,0.02)", border: "none", cursor: "pointer", textTransform: "uppercase", fontWeight: 600 }}>Call - Put</button>
                  <button onClick={() => setChartMode("oi-vol")} style={{ color: chartMode === "oi-vol" ? C.cyan : "#fff", padding: "4px 10px", fontSize: 10, background: chartMode === "oi-vol" ? "rgba(0,240,255,0.10)" : "rgba(255,255,255,0.02)", border: "none", cursor: "pointer", textTransform: "uppercase", fontWeight: 600 }}>OI + Vol</button>
                  <button onClick={() => setChartMode("vol-only")} style={{ color: chartMode === "vol-only" ? C.cyan : "#fff", padding: "4px 10px", fontSize: 10, background: chartMode === "vol-only" ? "rgba(0,240,255,0.10)" : "rgba(255,255,255,0.02)", border: "none", cursor: "pointer", textTransform: "uppercase", fontWeight: 600 }}>Vol Only</button>
                  <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.10)", margin: "0 4px" }} />
                  <button onClick={() => setChartMode("oi-overlay")} style={{ color: chartMode === "oi-overlay" ? C.cyan : "#fff", padding: "4px 10px", fontSize: 10, background: chartMode === "oi-overlay" ? "rgba(0,240,255,0.10)" : "rgba(255,255,255,0.02)", border: "none", cursor: "pointer", textTransform: "uppercase", fontWeight: 600 }}>+ OI Overlay</button>
                  <button onClick={() => setChartMode("net-dex")} style={{ color: chartMode === "net-dex" ? C.cyan : "#fff", padding: "4px 10px", fontSize: 10, background: chartMode === "net-dex" ? "rgba(0,240,255,0.10)" : "rgba(255,255,255,0.02)", border: "none", cursor: "pointer", textTransform: "uppercase", fontWeight: 600 }}>+ Net DEX</button>
                  <button onClick={() => setChartMode("gex-flip")} style={{ color: chartMode === "gex-flip" ? C.cyan : "#fff", padding: "4px 10px", fontSize: 10, background: chartMode === "gex-flip" ? "rgba(0,240,255,0.10)" : "rgba(255,255,255,0.02)", border: "none", cursor: "pointer", textTransform: "uppercase", fontWeight: 600 }}>+ GEX Flip</button>
                </div>
              </div>

              {/* Legend */}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "monospace", marginBottom: 8, padding: "0 8px", flexShrink: 0 }}>
                <div style={{ display: "flex", gap: 16 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: C.cyan }}>
                    <span style={{ width: 8, height: 8, background: C.cyan, borderRadius: 2, display: "inline-block", boxShadow: "0 0 8px rgba(0,240,255,0.8)" }} />
                    + GEX
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#EAB308" }}>
                    <span style={{ width: 8, height: 8, background: "#EAB308", borderRadius: 2, display: "inline-block", boxShadow: "0 0 8px rgba(234,179,8,0.7)" }} />
                    - GEX
                  </span>
                </div>
                <span style={{ color: "#fff" }}>Units in Billions ($B)</span>
              </div>

              {/* Chart */}
              <div style={{ flex: 1, position: "relative", width: "100%", minHeight: 0 }}>
                {/* Y-axis */}
                <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: 9, fontFamily: "monospace", color: "#fff", alignItems: "flex-end", zIndex: 20, pointerEvents: "none", paddingBottom: 20 }}>
                  {["+$6.00B","+$4.00B","+$2.00B","0","-$2.00B","-$4.00B","-$6.00B"].map((l, i) => (
                    <span key={i} style={{ color: i < 3 ? C.cyan : i === 3 ? "#fff" : C.orange }}>{l}</span>
                  ))}
                </div>
                <svg viewBox="0 0 800 300" preserveAspectRatio="none" style={{ width: "100%", height: "100%", paddingRight: 48, paddingBottom: 24, boxSizing: "border-box" }}>
                  <defs>
                    <linearGradient id="cyanBarGrad" x1="0" y1="1" x2="0" y2="0">
                      <stop offset="0%" stopColor="#0284C7"/><stop offset="100%" stopColor="#00F0FF"/>
                    </linearGradient>
                    <linearGradient id="goldBarGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#CA8A04"/><stop offset="100%" stopColor="#EAB308"/>
                    </linearGradient>
                    <linearGradient id="goldBarBright" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#D97706"/><stop offset="100%" stopColor="#FCD34D"/>
                    </linearGradient>
                    <linearGradient id="strikeGradCyan" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(0,217,255,0.4)"/><stop offset="100%" stopColor="rgba(0,217,255,0.1)"/>
                    </linearGradient>
                  </defs>
                  {/* Grid lines */}
                  <line x1="0" y1="50"  x2="800" y2="50"  stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
                  <line x1="0" y1="100" x2="800" y2="100" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
                  <line x1="0" y1="200" x2="800" y2="200" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
                  <line x1="0" y1="250" x2="800" y2="250" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
                  {/* Zero line */}
                  <line x1="0" y1="150" x2="800" y2="150" stroke="rgba(255,255,255,0.2)" strokeWidth="2"/>

                  {/* Live bars from chain data (Task #8) */}
                  {chartBars ? (
                    <>
                      {chartBars.bars.map((b, i) => (
                        <rect
                          key={`bar-${i}`}
                          x={b.x - b.barW / 2}
                          y={b.y}
                          width={b.barW}
                          height={b.barH}
                          fill={b.fill}
                          style={b.glow ? { filter: b.glow } : undefined}
                        />
                      ))}
                      {/* Peak strike label (Task #8 Step 3, Task #7 Step 5) */}
                      {(() => {
                        const pb = chartBars.peakPosBar;
                        if (!pb || !chartBars.peakLabel) return null;
                        return (
                          <>
                            <rect x={pb.x - 18} y={Math.max(2, pb.y - 18)} width={36} height={14} fill="url(#strikeGradCyan)" rx="2"/>
                            <text x={pb.x} y={Math.max(12, pb.y - 7)} textAnchor="middle" fontSize="10" fontFamily="monospace" fill={C.cyan} fontWeight="700">
                              {chartBars.peakLabel}
                            </text>
                          </>
                        );
                      })()}
                    </>
                  ) : (
                    /* Fallback static bars while loading */
                    <>
                      <g fill="url(#cyanBarGrad)">
                        <rect x="345" y="20" width="25" height="130" fill="#00F0FF" style={{ filter: "drop-shadow(0 0 8px rgba(0,240,255,0.6))" }}/>
                        <rect x="380" y="80" width="25" height="70"/>
                        <rect x="695" y="25" width="25" height="125" fill="#00F0FF"/>
                      </g>
                      <rect x="333" y="5" width="24" height="14" fill="url(#strikeGradCyan)" rx="2"/>
                      <text x="345" y="14" textAnchor="middle" fontSize="11" fontFamily="monospace" fill={C.cyan} fontWeight="700">7,570</text>
                    </>
                  )}
                </svg>
                {/* X-axis labels */}
                <div className="grad-divider-t" style={{ position: "absolute", bottom: 0, left: 0, right: 48, display: "flex", justifyContent: "space-between", padding: "8px 30px 0", fontSize: 10, fontFamily: "monospace", color: "#fff" }}>
                  {["7450","7500","7554","7600","7650"].map((l, i) => (
                    <span key={i} style={{ color: i === 2 ? "#fff" : "#fff", fontWeight: i === 2 ? 700 : 400 }}>{l}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* TABS */}
            <div style={{
              background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)",
              borderRadius: 16, display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden", marginTop: 24,
            }}>
              {/* Tab headers */}
              <div className="grad-divider-b" style={{ display: "flex", padding: "0 0", flexShrink: 0 }}>
                {([
                  { id: "calendar", label: "Economic Calendar", icon: <CalendarIcon /> },
                  { id: "snapshot", label: "Snapshot Flow", icon: <ActivityIcon /> },
                  { id: "spxflow", label: "SPX Flow", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg> },
                ] as const).map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "12px 16px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
                    background: "none", border: "none", cursor: "pointer",
                    color: activeTab === tab.id ? C.cyan : "#fff",
                    borderBottom: activeTab === tab.id ? `2px solid ${C.cyan}` : "2px solid transparent",
                    marginBottom: -1,
                    transition: "color 0.15s",
                  }}>
                    {tab.icon}{tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, overflowY: "auto", padding: 24, scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.05) transparent" }}>
                {activeTab === "calendar" && (
                  <div style={{ margin: -24, height: "calc(100% + 48px)" }}>
                    <EconCalendarPanel />
                  </div>
                )}
                {activeTab === "snapshot" && (
                  <div style={{ margin: -24, height: "calc(100% + 48px)" }}>
                    <SnapshotPanel />
                  </div>
                )}
                {activeTab === "spxflow" && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, opacity: 0.4 }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="1.5" strokeLinecap="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: "0.15em" }}>Coming Soon</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ width: "45%", display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>

            {/* 2-row ticker — top of right panel */}
            <div className="grad-divider-b" style={{ flexShrink: 0, paddingBottom: 16, marginBottom: 16, position: "relative" }}>
              {/* Row 1 */}
              <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 6, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    SPX <span style={{ color: "#fff", fontWeight: 400 }}>/ GEX</span>
                  </span>
                  <div style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.10)", padding: "3px 10px", borderRadius: 4, fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: "#fff" }}>
                    {etTime}
                  </div>
                </div>
                <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.02)" }} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>VIX</span>
                  <span style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: "#fff" }}>{vix.toFixed(2)}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 500, color: C.red }}>-1.48 (-8.37%)</span>
                </div>
                <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.02)" }} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>ESU</span>
                  <span style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 800, color: "#fff" }}>{esFut > 0 ? esFut.toFixed(2) : "7,562.00"}</span>
                </div>
                <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.02)" }} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>SPX</span>
                  <span style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 800, color: "#fff" }}>{spx > 0 ? spx.toFixed(2) : "7,554.29"}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 500, color: spxChg >= 0 ? C.green : C.red }}>
                    {spxChg >= 0 ? "+" : ""}{spxChg.toFixed(2)} ({spxChgPct >= 0 ? "+" : ""}{spxChgPct.toFixed(2)}%)
                  </span>
                </div>
              </div>
              {/* Row 2 */}
              <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.02)", flexShrink: 0 }} />
                {/* Call Wall */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontSize: 9, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>CW</span>
                  <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: C.cyan }}>{callWall ? callWall.toLocaleString() : "—"}</span>
                </div>
                {/* Put Wall */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontSize: 9, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>PW</span>
                  <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: C.orange }}>{putWall ? putWall.toLocaleString() : "—"}</span>
                </div>
                {/* GEX Flip */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontSize: 9, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>FLIP</span>
                  <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: netGex >= 0 ? C.green : C.red }}>{gexFlip ? gexFlip.toLocaleString() : "—"}</span>
                </div>
                <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.02)", flexShrink: 0 }} />
                </div>
                {/* MVC Snapshot button — right aligned */}
                <button style={{
                  background: "rgba(0,240,255,0.08)", border: "1px solid rgba(0,240,255,0.20)",
                  color: C.cyan, fontSize: 9, fontWeight: 700, padding: "3px 10px", borderRadius: 4,
                  cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em",
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  MVC Snapshot
                </button>
              </div>
            </div>

            {/* Heatmap */}
            <div style={{
              background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)",
              borderRadius: 16, display: "flex", flexDirection: "column", flex: 1, overflow: "hidden",
            }}>
              {/* Heatmap header */}
              <div className="grad-divider-b" style={{ paddingBottom: 16, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    <span style={{ color: C.cyan }}><LayersIcon /></span>
                    LIVE GEX HEATMAP
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#fff" }}>
                    {/* camera icon */}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ cursor: "pointer" }}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    {/* message icon */}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ cursor: "pointer" }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    {/* x icon */}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ cursor: "pointer" }}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </div>
                </div>
                {/* Intensity slider */}
                <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  <span style={{ color: "#fff" }}>Intensity</span>
                  <div style={{ flex: 1, height: 4, background: "rgba(0,0,0,0.4)", borderRadius: 4, position: "relative", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: "80%", background: C.cyan, borderRadius: 4, boxShadow: "0 0 20px -5px rgba(0,240,255,0.3)" }} />
                    <div style={{ position: "absolute", top: "50%", left: "80%", transform: "translate(-50%,-50%)", width: 12, height: 12, background: "#fff", borderRadius: "50%", boxShadow: "0 0 10px rgba(255,255,255,0.8)", cursor: "pointer" }} />
                  </div>
                  <span style={{ color: C.cyan }}>0.40x</span>
                  <span style={{ color: C.cyan, cursor: "pointer" }}><RotateCcwIcon /></span>
                </div>
              </div>

              {/* Table */}
              <div style={{ flex: 1, overflow: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.05) transparent" }}>
                <table style={{ width: "100%", textAlign: "right", fontSize: 11, fontFamily: "monospace", whiteSpace: "nowrap", borderCollapse: "collapse" }}>
                  <thead style={{ fontSize: 9, color: "#fff", textTransform: "uppercase", letterSpacing: "0.1em", position: "sticky", top: 0, zIndex: 10, background: "rgba(13,17,25,0.95)" }}>
                    <tr>
                      {["Strike","Net GEX","Vol Only","DEX","VEX","Delta W. GEX"].map((h, i) => (
                        <th key={h} style={{ padding: "12px 16px", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.06)", textAlign: i === 0 ? "left" : "right", color: i === 5 ? C.cyan : "#fff" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapData.map((row, idx) => {
                      const isAtm = row.type === "atm";
                      const isPosTop = row.type === "pos-top";
                      const isNegTop = row.type === "neg-top";
                      const isPosStrong = row.type === "pos-strong";
                      const isNegRed = row.type === "neg-red";
                      const isNeg = row.type === "neg" || row.type === "neg-red" || row.type === "neg-top";

                      // Find highest Net GEX
                      const gexVals = heatmapData.map(r => {
                        const val = r.netGex.replace(/[$,MKB]/g, "");
                        const mult = r.netGex.includes("B") ? 1000 : r.netGex.includes("M") ? 1 : 0.001;
                        return parseFloat(val) * mult;
                      });
                      const maxGex = Math.max(...gexVals);
                      const currentGexVal = parseFloat(row.netGex.replace(/[$,MKB]/g, "")) * (row.netGex.includes("B") ? 1000 : row.netGex.includes("M") ? 1 : 0.001);
                      const isHighestGex = currentGexVal === maxGex && currentGexVal > 0;

                      // Gradient divider after ATM row
                      const showDivider = idx > 0 && heatmapData[idx - 1]?.type === "atm";

                      const rowStyle: React.CSSProperties = {
                        borderBottom: isAtm
                          ? "none"
                          : "none",
                        background: isAtm
                          ? "linear-gradient(to right, rgba(0,240,255,0.08), rgba(0,240,255,0.04), rgba(0,240,255,0.08))"
                          : "transparent",
                        transition: "background 0.15s",
                        position: "relative",
                      };

                      const cellVal = (val: string, colIdx: number) => {
                        const isNegVal = val.startsWith("-");
                        const isPosVal = !isNegVal && val !== "—";
                        const base: React.CSSProperties = { padding: "10px 16px", textAlign: colIdx === 0 ? "left" : "right" };

                        if (colIdx === 0) {
                          return (
                            <td key={`${row.strike}-strike`} style={{ ...base, fontWeight: 700, color: isAtm ? C.cyan : isPosTop || isPosStrong ? "#fff" : "#fff" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {val}
                                {isAtm && <span style={{ color: C.cyan, fontWeight: 900, fontSize: 10, fontFamily: "sans-serif", letterSpacing: "0.1em" }}>ATM</span>}
                                {row.rank && (
                                  <span style={{ background: row.rankColor, color: row.rankColor === "#F97316" ? "#000" : "#fff", padding: "1px 6px", borderRadius: 3, fontSize: 8, fontWeight: 700 }}>#{row.rank}</span>
                                )}
                              </div>
                            </td>
                          );
                        }

                        // Color logic per column
                        const vals = [row.netGex, row.volOnly, row.dex, row.vex, row.dwGex];
                        const v = vals[colIdx - 1];
                        const isNegV = v?.startsWith("-");
                        const isPosV = v && !isNegV;

                        let cellBg = "transparent";
                        let cellColor = isAtm ? "#fff" : isNegV ? "rgba(0,180,255,0.55)" : "rgba(255,255,255,0.80)";
                        let cellBorder = "none";
                        let cellFw: React.CSSProperties["fontWeight"] = 400;

                        // Highlight hotspot cells
                        if ((isPosTop || isPosStrong) && !isNegV && (colIdx === 1 || colIdx === 3)) {
                          cellBg = "rgba(14,116,144,0.30)";
                          cellBorder = "1px solid rgba(0,240,255,0.20)";
                          cellColor = isPosTop ? "#fff" : "#00D9FF";
                          cellFw = 700;
                        }
                        if (isNegRed && isNegV && (colIdx === 1 || colIdx === 3)) {
                          cellBg = "rgba(0,60,100,0.45)";
                          cellBorder = "1px solid rgba(0,180,255,0.15)";
                          cellColor = C.cyan;
                          cellFw = 700;
                        }
                        if (isNegTop && (colIdx === 1 || colIdx === 3)) {
                          cellBg = "rgba(0,60,100,0.45)";
                          cellBorder = "1px solid rgba(0,180,255,0.15)";
                          cellColor = colIdx === 1 ? C.cyan : "#fff";
                          cellFw = 700;
                        }
                        if (isAtm) { cellFw = 700; }
                        if (colIdx === 5) {
                          cellBg = "rgba(0,0,0,0.20)";
                          cellColor = isAtm ? "#fff" : isNegV ? "rgba(0,180,255,0.55)" : isNeg ? "rgba(0,180,255,0.55)" : "rgba(255,255,255,0.80)";
                        }

                        return (
                          <td key={`${row.strike}-${colIdx}`} style={{ ...base, background: cellBg, border: cellBorder, fontWeight: cellFw, color: cellColor, borderRadius: cellBorder !== "none" ? 4 : 0 }}>
                            {v}
                          </td>
                        );
                      };

                      return (
                        <>
                          {showDivider && (
                            <tr key={`div-${idx}`}>
                              <td colSpan={6} style={{ padding: 0, height: 1, background: "linear-gradient(to right, transparent, rgba(0,240,255,0.15), rgba(139,92,246,0.10), transparent)" }} />
                            </tr>
                          )}
                          <tr key={row.strike}
                            className={isAtm ? "heatmap-row-atm" : "heatmap-row"}
                            style={rowStyle}
                            onMouseEnter={e => { if (!isAtm) (e.currentTarget as HTMLElement).style.background = "rgba(0,200,255,0.04)"; }}
                            onMouseLeave={e => { if (!isAtm) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                          >
                            {[row.strike, row.netGex, row.volOnly, row.dex, row.vex, row.dwGex].map((v, ci) => cellVal(String(v), ci))}
                          </tr>
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .grad-divider-b {
          position: relative;
        }
        .grad-divider-b::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(to right, transparent 0%, rgba(255,255,255,0.10) 30%, rgba(255,255,255,0.13) 50%, rgba(255,255,255,0.10) 70%, transparent 100%);
          pointer-events: none;
        }
        .grad-divider-t {
          position: relative;
        }
        .grad-divider-t::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(to right, transparent 0%, rgba(255,255,255,0.10) 30%, rgba(255,255,255,0.13) 50%, rgba(255,255,255,0.10) 70%, transparent 100%);
          pointer-events: none;
        }
        .grad-divider-sidebar-b::after {
          content: '';
          position: absolute;
          bottom: 0; left: 12px; right: 12px;
          height: 1px;
          background: linear-gradient(to right, transparent, rgba(255,255,255,0.10) 50%, transparent);
          pointer-events: none;
        }
        .grad-divider-sidebar-t {
          position: relative;
        }
        .grad-divider-sidebar-t::before {
          content: '';
          position: absolute;
          top: 0; left: 12px; right: 12px;
          height: 1px;
          background: linear-gradient(to right, transparent, rgba(255,255,255,0.10) 50%, transparent);
          pointer-events: none;
        }
        .tab-active-border {
          border-bottom: 2px solid #00F0FF !important;
        }
        .tab-inactive-border {
          border-bottom: 2px solid transparent !important;
        }
        .heatmap-row {
          position: relative;
        }
        .heatmap-row::after {
          content: '';
          position: absolute;
          bottom: 0; left: 8px; right: 8px;
          height: 1px;
          background: linear-gradient(to right, transparent 0%, rgba(255,255,255,0.07) 25%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.07) 75%, transparent 100%);
          pointer-events: none;
        }
        .heatmap-row-atm {
          position: relative;
        }
        .heatmap-row-atm::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(to right, transparent 0%, rgba(0,240,255,0.25) 30%, rgba(0,240,255,0.40) 50%, rgba(0,240,255,0.25) 70%, transparent 100%);
          pointer-events: none;
          z-index: 1;
        }
        .heatmap-row-atm::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(to right, transparent 0%, rgba(0,240,255,0.25) 30%, rgba(0,240,255,0.40) 50%, rgba(0,240,255,0.25) 70%, transparent 100%);
          pointer-events: none;
          z-index: 1;
        }
      `}</style>
    </div>
  );
}
