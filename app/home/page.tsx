"use client";

import { useState, useEffect, useRef } from "react";

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
const QUOTES = [
  { sym: "AMD",   chg: "+6.92%", pos: true },
  { sym: "META",  chg: "+4.63%", pos: true },
  { sym: "SMH",   chg: "+4.16%", pos: true },
  { sym: "NVDA",  chg: "+3.36%", pos: true },
  { sym: "AMZN",  chg: "+3.27%", pos: true },
  { sym: "NQU",   chg: "+3.01%", pos: true, active: true },
  { sym: "QQQ",   chg: "+2.98%", pos: true },
  { sym: "GOOGL", chg: "+2.71%", pos: true },
  { sym: "MSFT",  chg: "+2.31%", pos: true },
  { sym: "AAPL",  chg: "+1.76%", pos: true },
];

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
  const [spx, setSpx] = useState(7554.29);
  const [spxChg, setSpxChg] = useState(122.83);
  const [spxChgPct, setSpxChgPct] = useState(1.65);
  const [esFut, setEsFut] = useState(7562.0);
  const [netGex, setNetGex] = useState(15790000000);
  const [vix, setVix] = useState(16.20);
  const [activeTab, setActiveTab] = useState<"calendar" | "snapshot">("calendar");
  const wsRef = useRef<WebSocket | null>(null);
  const prevSpxRef = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL
      ? process.env.NEXT_PUBLIC_WS_URL + "/ws/dxlink"
      : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/dxlink`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({
          type: "subscribe",
          symbols: ["$SPX", "SPX", "/ESU26", "/ES:XCME", "VIX"],
          feedTypesBySymbol: { "$SPX": ["Quote","Trade","Summary"], "SPX": ["Quote","Trade","Summary"], "/ESU26": ["Quote","Trade"], "/ES:XCME": ["Quote","Trade"], "VIX": ["Quote","Trade"] },
        }));
      } catch {}
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type !== "FEED_DATA") return;
        (msg.data as Array<Record<string, unknown>>).forEach(ev => {
          const sym = String(ev.eventSymbol ?? "");
          const t = ev.eventType;
          if ((sym === "$SPX" || sym === "SPX") && t === "Quote") {
            const bid = Number(ev.bidPrice ?? 0), ask = Number(ev.askPrice ?? 0);
            const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
            if (mid > 100) {
              if (prevSpxRef.current > 0) { const chg = mid - prevSpxRef.current; setSpxChg(chg); setSpxChgPct((chg / prevSpxRef.current) * 100); }
              if (prevSpxRef.current === 0) prevSpxRef.current = mid;
              setSpx(mid);
            }
          }
          if ((sym === "/ESU26" || sym === "/ES:XCME") && t === "Quote") {
            const bid = Number(ev.bidPrice ?? 0), ask = Number(ev.askPrice ?? 0);
            const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
            if (mid > 100) setEsFut(mid);
          }
          if (sym === "VIX" && t === "Quote") {
            const v = Number(ev.bidPrice ?? ev.lastPrice ?? 0);
            if (v > 0) setVix(v);
          }
        });
      } catch {}
    };
    ws.onclose = () => {};
    return () => { ws.close(); };
  }, []);

  useEffect(() => {
    const load = () => {
      fetch("/api/gex", { cache: "no-store" })
        .then(r => r.json())
        .then(j => { const g = j?.summary?.totalNetGEX ?? j?.totalNetGEX ?? 0; if (isFinite(g) && g !== 0) setNetGex(g); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const etTime = now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

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
        <div style={{ display: "flex", flexDirection: "column", gap: 20, width: "100%", alignItems: "center", color: C.muted, marginBottom: 20 }}>
          <span style={{ color: "#fff", cursor: "pointer" }}><GridIcon /></span>
          <span style={{ cursor: "pointer", transition: "color 0.15s" }} onMouseEnter={e => (e.currentTarget.style.color = "#fff")} onMouseLeave={e => (e.currentTarget.style.color = C.muted)}>
            <CalendarIcon />
          </span>
        </div>
        <div style={{ width: 32, height: 1, background: "rgba(255,255,255,0.10)", marginBottom: 16 }} />

        {/* Quotes */}
        <div style={{ flex: 1, width: "100%", overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 0, scrollbarWidth: "none" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.15em", position: "sticky", top: 0, background: "rgba(5,6,10,0.8)", backdropFilter: "blur(8px)", width: "100%", textAlign: "center", padding: "8px 0", zIndex: 10 }}>Quotes</div>
          {QUOTES.map(q => (
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
            <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: C.red }}>-8.37%</span>
          </div>
          <div style={{ width: 32, height: 1, background: "rgba(255,255,255,0.10)", margin: "8px 0" }} />
          <div style={{ fontSize: 9, fontWeight: 700, color: C.orange, textTransform: "uppercase", letterSpacing: "0.15em", textAlign: "center", padding: "4px 0" }}>Est Move</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "6px 0", marginBottom: 8 }}>
            <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: C.cyan }}>ESU</span>
            <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: "#fff" }}>±40.50</span>
          </div>
        </div>

        {/* Bottom */}
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 20, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.05)", width: "100%" }}>
          <span style={{ color: C.muted, cursor: "pointer", transition: "color 0.15s" }} onMouseEnter={e => (e.currentTarget.style.color = "#fff")} onMouseLeave={e => (e.currentTarget.style.color = C.muted)}>
            <SettingsIcon />
          </span>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: `linear-gradient(135deg, ${C.purple}, ${C.cyan})`, boxShadow: "0 0 20px -5px rgba(139,92,246,0.3)", cursor: "pointer" }} />
        </div>
      </aside>

      {/* ── MAIN ──────────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", minWidth: 0 }}>

        {/* ── HEADER ──────────────────────────────────────────────────────── */}
        <header style={{
          height: 64, flexShrink: 0, display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: "0 24px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(0,0,0,0.10)", backdropFilter: "blur(12px)", position: "relative", zIndex: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                SPX <span style={{ color: C.muted, fontWeight: 400 }}>/ GEX</span>
              </span>
              <div style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.10)", padding: "4px 10px", borderRadius: 4, fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#fff", boxShadow: "0 0 20px -5px rgba(0,240,255,0.3)" }}>
                {etTime}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>VIX</span>
              <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: C.orange }}>{vix.toFixed(2)}</span>
              <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 500, color: C.red }}>-1.48 (-8.37%)</span>
            </div>
            <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.10)" }} />
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>ESU</span>
              <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: "#fff" }}>{esFut > 0 ? esFut.toFixed(2) : "7,562.00"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>SPX</span>
              <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: "#fff" }}>{spx > 0 ? spx.toFixed(2) : "7,554.29"}</span>
              <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 500, color: spxChg >= 0 ? C.green : C.red }}>
                {spxChg >= 0 ? "+" : ""}{spxChg.toFixed(2)} ({spxChgPct >= 0 ? "+" : ""}{spxChgPct.toFixed(2)}%)
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>MVC</span>
              <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: C.cyan }}>7,600</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>FLIP</span>
              <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: C.orange }}>7,491</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, background: "rgba(0,240,255,0.10)", padding: "4px 12px", borderRadius: 4, border: "1px solid rgba(0,240,255,0.20)", boxShadow: "0 0 20px -5px rgba(0,240,255,0.3)" }}>
              <span style={{ fontSize: 9, color: "#fff", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>NET GEX</span>
              <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: C.cyan }}>{fmtMoney(netGex)}</span>
            </div>
            <button style={{
              background: "rgba(139,92,246,0.20)", color: C.purple, border: "1px solid rgba(139,92,246,0.30)",
              padding: "4px 12px", fontSize: 10, fontWeight: 700, borderRadius: 4,
              display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
              boxShadow: "0 0 20px -5px rgba(139,92,246,0.3)",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.cyan, display: "inline-block", animation: "pulse 2s infinite" }} />
              TT LIVE
            </button>
          </div>
        </header>

        {/* ── BODY ──────────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "row", padding: "24px", gap: 24, minHeight: 0, overflow: "hidden" }}>

          {/* LEFT COLUMN */}
          <div style={{ width: "55%", display: "flex", flexDirection: "column", gap: 24, minWidth: 0, height: "100%" }}>

            {/* GEX CHART — float card */}
            <div style={{
              background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)",
              borderRadius: 16, padding: 24, display: "flex", flexDirection: "column",
              height: 400, flexShrink: 0,
              border: "1px solid rgba(255,255,255,0.03)",
              boxShadow: "0 4px 24px -10px rgba(0,0,0,0.6)",
            }}>
              {/* Chart Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  <span style={{ color: C.cyan }}><BarChart2 /></span>
                  Net Strike Gamma Exposure
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button style={{ background: "rgba(255,255,255,0.10)", color: "#fff", padding: "2px 8px", fontSize: 10, borderRadius: 4, border: "none", cursor: "pointer" }}>ALL</button>
                    <button style={{ color: C.muted, padding: "2px 8px", fontSize: 10, background: "none", border: "none", cursor: "pointer" }}>0DTE 6/15</button>
                    <button style={{ background: "rgba(0,240,255,0.20)", color: C.cyan, border: `1px solid rgba(0,240,255,0.50)`, padding: "2px 8px", fontSize: 10, borderRadius: 4, cursor: "pointer", boxShadow: "0 0 20px -5px rgba(0,240,255,0.3)" }}>1DTE 6/16</button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 0, fontSize: 9, fontWeight: 700, color: C.muted, background: "rgba(0,0,0,0.40)", padding: 4, borderRadius: 6, border: "1px solid rgba(255,255,255,0.05)" }}>
                    <span style={{ background: C.panel, color: C.cyan, padding: "2px 8px", borderRadius: 4 }}>Net GEX</span>
                    <span style={{ padding: "2px 4px", cursor: "pointer" }}>Call - Put</span>
                    <span style={{ padding: "2px 4px", cursor: "pointer" }}>OI + Vol</span>
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "monospace", marginBottom: 8, padding: "0 8px", flexShrink: 0 }}>
                <div style={{ display: "flex", gap: 16 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: C.cyan }}>
                    <span style={{ width: 8, height: 8, background: C.cyan, borderRadius: 2, display: "inline-block", boxShadow: "0 0 8px rgba(0,240,255,0.8)" }} />
                    + GEX
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: C.orange }}>
                    <span style={{ width: 8, height: 8, background: C.orange, borderRadius: 2, display: "inline-block", boxShadow: "0 0 8px rgba(249,115,22,0.8)" }} />
                    - GEX
                  </span>
                </div>
                <span style={{ color: C.muted }}>Units in Billions ($B)</span>
              </div>

              {/* Chart */}
              <div style={{ flex: 1, position: "relative", width: "100%", minHeight: 0 }}>
                {/* Y-axis */}
                <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: 9, fontFamily: "monospace", color: C.muted, alignItems: "flex-end", zIndex: 20, pointerEvents: "none", paddingBottom: 20 }}>
                  {["+$6.00B","+$4.00B","+$2.00B","0","-$2.00B","-$4.00B","-$6.00B"].map((l, i) => (
                    <span key={i} style={{ color: i < 3 ? C.cyan : i === 3 ? C.muted : C.orange }}>{l}</span>
                  ))}
                </div>
                <svg viewBox="0 0 800 300" preserveAspectRatio="none" style={{ width: "100%", height: "100%", paddingRight: 48, paddingBottom: 24, boxSizing: "border-box" }}>
                  <defs>
                    <linearGradient id="cyanBarGrad" x1="0" y1="1" x2="0" y2="0">
                      <stop offset="0%" stopColor="#0284C7"/><stop offset="100%" stopColor="#00F0FF"/>
                    </linearGradient>
                    <linearGradient id="orangeBarGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#C2410C"/><stop offset="100%" stopColor="#F97316"/>
                    </linearGradient>
                  </defs>
                  <line x1="0" y1="50" x2="800" y2="50" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
                  <line x1="0" y1="100" x2="800" y2="100" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
                  <line x1="0" y1="200" x2="800" y2="200" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
                  <line x1="0" y1="250" x2="800" y2="250" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
                  <line x1="380" y1="0" x2="380" y2="300" stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="4 4"/>
                  <line x1="0" y1="150" x2="800" y2="150" stroke="rgba(255,255,255,0.2)" strokeWidth="2"/>
                  <g fill="url(#cyanBarGrad)">
                    <rect x="30" y="145" width="25" height="5"/><rect x="65" y="140" width="25" height="10"/>
                    <rect x="100" y="140" width="25" height="10"/><rect x="135" y="130" width="25" height="20"/>
                    <rect x="170" y="135" width="25" height="15"/><rect x="205" y="120" width="25" height="30"/>
                    <rect x="240" y="130" width="25" height="20"/><rect x="275" y="140" width="25" height="10"/>
                    <rect x="310" y="140" width="25" height="10"/>
                    <rect x="345" y="20" width="25" height="130" fill="#00F0FF" style={{ filter: "drop-shadow(0 0 8px rgba(0,240,255,0.6))" }}/>
                    <rect x="380" y="80" width="25" height="70"/><rect x="415" y="90" width="25" height="60"/>
                    <rect x="450" y="110" width="25" height="40"/><rect x="485" y="60" width="25" height="90"/>
                    <rect x="520" y="50" width="25" height="100"/><rect x="555" y="30" width="25" height="120"/>
                    <rect x="590" y="80" width="25" height="70"/><rect x="625" y="110" width="25" height="40"/>
                    <rect x="660" y="100" width="25" height="50"/><rect x="695" y="25" width="25" height="125" fill="#00F0FF"/>
                  </g>
                  <g fill="url(#orangeBarGrad)">
                    <rect x="30" y="150" width="25" height="30"/><rect x="65" y="150" width="25" height="25"/>
                    <rect x="100" y="150" width="25" height="30"/><rect x="135" y="150" width="25" height="45"/>
                    <rect x="170" y="150" width="25" height="50"/><rect x="205" y="150" width="25" height="60"/>
                    <rect x="240" y="150" width="25" height="55"/><rect x="275" y="150" width="25" height="40"/>
                    <rect x="310" y="150" width="25" height="35"/><rect x="345" y="150" width="25" height="10"/>
                  </g>
                </svg>
                {/* X-axis labels */}
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 48, display: "flex", justifyContent: "space-between", padding: "0 30px", fontSize: 10, fontFamily: "monospace", color: C.muted, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 8 }}>
                  {["7450","7500","7554","7600","7650"].map((l, i) => (
                    <span key={i} style={{ color: i === 2 ? "#fff" : C.muted, fontWeight: i === 2 ? 700 : 400 }}>{l}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* TABS — float card */}
            <div style={{
              background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)",
              borderRadius: 16, display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.03)",
              boxShadow: "0 4px 24px -10px rgba(0,0,0,0.6)",
            }}>
              {/* Tab headers */}
              <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.10)", padding: "0 16px", flexShrink: 0 }}>
                {(["calendar","snapshot"] as const).map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "12px 16px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
                    background: "none", border: "none", cursor: "pointer",
                    color: activeTab === tab ? C.cyan : C.muted,
                    borderBottom: activeTab === tab ? `2px solid ${C.cyan}` : "2px solid transparent",
                    marginBottom: -1,
                    transition: "color 0.15s",
                  }}>
                    {tab === "calendar" ? <CalendarIcon /> : <ActivityIcon />}
                    {tab === "calendar" ? "Economic Calendar" : "Snapshot Flow"}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, overflowY: "auto", padding: 24, scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.05) transparent" }}>
                {activeTab === "calendar" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 9, fontFamily: "monospace", color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                        Date: 2026-06-15
                        <span style={{ background: "rgba(0,240,255,0.20)", color: C.cyan, padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700 }}>TODAY</span>
                      </div>
                      <button style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", color: "#fff", fontSize: 10, padding: "4px 8px", borderRadius: 4, cursor: "pointer" }}>Sync Now</button>
                    </div>
                    {[
                      { time: "2:41", ampm: "AM", title: "The President departs The White House", desc: "en route to Joint Base Andrews" },
                      { time: "3:01", ampm: "AM", title: "The President arrives", desc: "at Joint Base Andrews" },
                      { time: "9:56", ampm: "AM", title: "The President arrives at Geneva Airport", desc: "en route to Evian Resort, France" },
                    ].map((ev, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 40, paddingTop: 2 }}>
                          <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#fff" }}>{ev.time}</span>
                          <span style={{ fontSize: 8, textTransform: "uppercase", fontWeight: 700, color: C.muted }}>{ev.ampm}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0, borderLeft: "1px solid rgba(255,255,255,0.10)", paddingLeft: 16, position: "relative", paddingBottom: 4 }}>
                          <div style={{ position: "absolute", left: -3.5, top: 6, width: 6, height: 6, borderRadius: "50%", background: C.purple, boxShadow: "0 0 20px -5px rgba(139,92,246,0.3)" }} />
                          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                            <span style={{ fontSize: 8, background: "rgba(139,92,246,0.20)", color: C.purple, padding: "2px 6px", borderRadius: 3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>PRESIDENT</span>
                            <span style={{ fontSize: 8, background: "rgba(255,255,255,0.10)", color: "#fff", padding: "2px 6px", borderRadius: 3, fontWeight: 700 }}>USD</span>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 2 }}>{ev.title}</div>
                          <div style={{ fontSize: 10, color: C.muted }}>{ev.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {activeTab === "snapshot" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      {[
                        { label: "P/C VOL RATIO", val: "12.60", color: C.red },
                        { label: "B/B RATIO", val: "1.06", color: C.green },
                        { label: "BULL VOL", val: "38", color: C.green },
                        { label: "BEAR VOL", val: "30", color: C.red },
                      ].map(m => (
                        <div key={m.label} style={{ background: "rgba(0,0,0,0.20)", border: "1px solid rgba(255,255,255,0.05)", padding: 12, borderRadius: 8, textAlign: "center" }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{m.label}</div>
                          <div style={{ fontSize: 28, fontWeight: 700, color: m.color, lineHeight: 1 }}>{m.val}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ background: "rgba(0,0,0,0.20)", border: "1px solid rgba(255,255,255,0.05)", padding: 16, borderRadius: 8, display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
                        <span style={{ color: C.green }}>144.8K Net Bullish</span>
                        <span style={{ color: C.red }}>137.2K Net Bearish</span>
                      </div>
                      <div style={{ width: "100%", height: 8, borderRadius: 4, overflow: "hidden", display: "flex" }}>
                        <div style={{ background: C.green, height: "100%", width: "51.3%" }} />
                        <div style={{ background: C.red, height: "100%", width: "48.7%" }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ width: "45%", display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>
            <div style={{
              background: "rgba(13,17,25,0.45)", backdropFilter: "blur(16px)",
              borderRadius: 16, display: "flex", flexDirection: "column", flex: 1, height: "100%", overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.03)",
              boxShadow: "0 4px 24px -10px rgba(0,0,0,0.6)",
            }}>
              {/* Heatmap header */}
              <div style={{ padding: 24, borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 16, flexShrink: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    <span style={{ color: C.cyan }}><LayersIcon /></span>
                    LIVE GEX HEATMAP
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, color: C.muted }}>
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
                  <thead style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", position: "sticky", top: 0, zIndex: 10, background: "rgba(10,13,20,0.90)", backdropFilter: "blur(8px)" }}>
                    <tr>
                      {["Strike","Net GEX","Vol Only","DEX","VEX","Delta W. GEX"].map((h, i) => (
                        <th key={h} style={{ padding: "12px 16px", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: i === 0 ? "left" : "right", color: i === 5 ? C.cyan : C.muted }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {HEATMAP_ROWS.map((row, idx) => {
                      const isAtm = row.type === "atm";
                      const isPosTop = row.type === "pos-top";
                      const isNegTop = row.type === "neg-top";
                      const isPosStrong = row.type === "pos-strong";
                      const isNegRed = row.type === "neg-red";
                      const isNeg = row.type === "neg" || row.type === "neg-red" || row.type === "neg-top";

                      // Gradient divider after ATM row
                      const showDivider = idx > 0 && HEATMAP_ROWS[idx - 1]?.type === "atm";

                      const rowStyle: React.CSSProperties = {
                        borderBottom: isAtm
                          ? "1px solid rgba(0,240,255,0.40)"
                          : "1px solid rgba(255,255,255,0.05)",
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
                            <td key={colIdx} style={{ ...base, fontWeight: 700, color: isAtm ? C.cyan : isPosTop || isPosStrong ? "#fff" : C.muted }}>
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
                        let cellColor = isAtm ? C.cyan : isNegV ? C.red : "rgba(255,255,255,0.80)";
                        let cellBorder = "none";
                        let cellFw: React.CSSProperties["fontWeight"] = 400;

                        // Highlight hotspot cells
                        if ((isPosTop || isPosStrong) && !isNegV && (colIdx === 1 || colIdx === 3)) {
                          cellBg = "rgba(14,116,144,0.30)";
                          cellBorder = "1px solid rgba(0,240,255,0.20)";
                          cellColor = isPosTop ? "#fff" : C.cyan;
                          cellFw = 700;
                        }
                        if (isNegRed && isNegV && (colIdx === 1 || colIdx === 3)) {
                          cellBg = "rgba(76,29,36,1)";
                          cellBorder = "1px solid rgba(239,68,68,0.15)";
                          cellColor = "#fff";
                          cellFw = 700;
                        }
                        if (isNegTop && (colIdx === 1 || colIdx === 3)) {
                          cellBg = "rgba(76,29,36,1)";
                          cellBorder = "1px solid rgba(239,68,68,0.15)";
                          cellColor = colIdx === 1 ? C.orange : "#fff";
                          cellFw = 700;
                        }
                        if (isAtm) { cellFw = 700; }
                        if (colIdx === 5) {
                          cellBg = "rgba(0,0,0,0.20)";
                          cellColor = isAtm ? C.cyan : isNegV ? C.red : isNeg ? C.red : "rgba(255,255,255,0.80)";
                        }

                        return (
                          <td key={colIdx} style={{ ...base, background: cellBg, border: cellBorder, fontWeight: cellFw, color: cellColor, borderRadius: cellBorder !== "none" ? 4 : 0 }}>
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
                            style={rowStyle}
                            onMouseEnter={e => { if (!isAtm) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}
                            onMouseLeave={e => { if (!isAtm) (e.currentTarget as HTMLElement).style.background = isAtm ? "linear-gradient(to right, rgba(0,240,255,0.08), rgba(0,240,255,0.04), rgba(0,240,255,0.08))" : "transparent"; }}
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
      `}</style>
    </div>
  );
}
