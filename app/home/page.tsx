"use client";

import { useState, useEffect, useRef } from "react";

// ── Helpers ───────────────────────────────────────────────────────────────────
function etNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function greeting() {
  const h = etNow().getHours();
  if (h < 12) return "Good Morning,";
  if (h < 17) return "Good Afternoon,";
  return "Good Evening,";
}

function etDateStr() {
  const d = etNow();
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

function etDayStr() {
  return etNow().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
}

function isMarketOpen() {
  const d = etNow();
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= 570 && mins < 960; // 9:30–16:00
}

function minsToClose() {
  const d = etNow();
  const mins = d.getHours() * 60 + d.getMinutes();
  return Math.max(0, 960 - mins);
}

function fmtCountdown(totalMins: number) {
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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

// ── Tiny sparkline SVG ────────────────────────────────────────────────────────
function Sparkline({ values, color = "#00e5ff", accent = "#a78bfa" }: { values: number[]; color?: string; accent?: string }) {
  if (values.length < 2) return null;
  const w = 300, h = 60;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h * 0.75) - h * 0.1;
    return `${x},${y}`;
  });
  const linePath = "M " + pts.join(" L ");
  const areaPath = `M ${pts[0]} L ${pts.join(" L ")} L ${w},${h} L 0,${h} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "100%", overflow: "visible" }}>
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor={accent} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sparkGrad)" />
      <path d={linePath} fill="none" stroke="url(#lineGrad)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {/* End dot */}
      <circle cx={pts[pts.length - 1].split(",")[0]} cy={pts[pts.length - 1].split(",")[1]} r="3" fill={accent} />
    </svg>
  );
}

// ── Ring progress ─────────────────────────────────────────────────────────────
function Ring({ pct, size = 96, stroke = 7, color = "#00b4ff", trail = "rgba(255,255,255,0.06)", children }: {
  pct: number; size?: number; stroke?: number; color?: string; trail?: string; children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(1, pct / 100));
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trail} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.8s ease" }} />
      {children && (
        <foreignObject x={stroke} y={stroke} width={size - stroke * 2} height={size - stroke * 2}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", transform: "rotate(90deg)" }}>
            {children}
          </div>
        </foreignObject>
      )}
    </svg>
  );
}

// ── Session Ring (dual arc: orange to close, green session elapsed) ───────────
function SessionRing({ minsLeft, totalMins = 390 }: { minsLeft: number; totalMins?: number }) {
  const size = 120, stroke = 8;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const elapsed = totalMins - minsLeft;
  const elapsedPct = elapsed / totalMins;
  const leftPct = minsLeft / totalMins;
  const h = Math.floor(minsLeft / 60);
  const m = minsLeft % 60;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", position: "absolute" }}>
        {/* Trail */}
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
        {/* Elapsed (green) */}
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#00e676" strokeWidth={stroke - 1}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - elapsedPct)} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s ease", opacity: 0.35 }} />
        {/* Remaining (orange) */}
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#ff6b35" strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={circ * elapsedPct} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: "#fff", fontFamily: "monospace", letterSpacing: "-1px" }}>
          {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}
        </span>
        <span style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em" }}>to close</span>
      </div>
    </div>
  );
}

// ── Mini bar chart (weekly P&L) ───────────────────────────────────────────────
function WeeklyBars({ data }: { data: { day: string; val: number }[] }) {
  const max = Math.max(...data.map(d => Math.abs(d.val)), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 64, paddingBottom: 0 }}>
      {data.map((d, i) => {
        const h = Math.max(4, (Math.abs(d.val) / max) * 56);
        const isPos = d.val >= 0;
        const isToday = i === data.findIndex(x => x.day === etNow().toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" }).slice(0, 3));
        return (
          <div key={d.day} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
            <div style={{
              width: "100%", height: h,
              background: isToday
                ? (isPos ? "rgba(0,229,118,0.9)" : "rgba(255,71,87,0.9)")
                : (isPos ? "rgba(0,229,118,0.35)" : "rgba(255,71,87,0.35)"),
              borderRadius: "3px 3px 0 0",
              transition: "height 0.5s ease",
            }} />
            <span style={{ fontSize: 9, color: isToday ? "#e4e4e7" : "#475569", fontWeight: isToday ? 800 : 400 }}>{d.day}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Tool card ─────────────────────────────────────────────────────────────────
function ToolCard({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  return (
    <a href={href} style={{ textDecoration: "none" }}>
      <div style={{
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 10, padding: "18px 12px", display: "flex", flexDirection: "column",
        alignItems: "center", gap: 8, cursor: "pointer", transition: "background 0.15s, border-color 0.15s",
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,229,255,0.06)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,229,255,0.2)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)"; }}
      >
        <div style={{ color: "#94a3b8", fontSize: 20 }}>{icon}</div>
        <span style={{ fontSize: 10, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      </div>
    </a>
  );
}

// ── SVG icons ─────────────────────────────────────────────────────────────────
const Icons = {
  Heatmap: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  Flow: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 6h18M3 12h18M3 18h18"/><path d="M8 6v12M16 6v12" strokeOpacity="0.4"/>
    </svg>
  ),
  Ladder: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <line x1="8" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="16" y2="21"/>
      <line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="17" x2="16" y2="17"/>
    </svg>
  ),
  Quotes: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
    </svg>
  ),
  Levels: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>
    </svg>
  ),
  Snapshot: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  ),
};

// ── Fake sparkline data (will be replaced with live data) ─────────────────────
const SPARK_SEED = [5540, 5552, 5548, 5561, 5558, 5570, 5565, 5580, 5574, 5590, 5585, 5600];

const WEEKLY_DATA = [
  { day: "Mon", val: 420 },
  { day: "Tue", val: -180 },
  { day: "Wed", val: 650 },
  { day: "Thu", val: 310 },
  { day: "Fri", val: 0 },
  { day: "Sat", val: 0 },
  { day: "Sun", val: 0 },
];

const FOCUS_ITEMS = [
  { label: "NQM6 Scalps", done: true },
  { label: "Monitor GEX Flip", done: true },
  { label: "Premium Flow Analysis", done: false },
  { label: "Review ES Stats Ladder", done: false },
];

const TOOLS = [
  { icon: <Icons.Heatmap />, label: "Heatmap", href: "/" },
  { icon: <Icons.Flow />, label: "Opt Flow", href: "/dashboard" },
  { icon: <Icons.Ladder />, label: "Ladder", href: "/top10" },
  { icon: <Icons.Quotes />, label: "Quotes", href: "/quotes" },
  { icon: <Icons.Levels />, label: "Levels", href: "/gex" },
  { icon: <Icons.Snapshot />, label: "Snapshot", href: "/stats" },
];

// ── Page ──────────────────────────────────────────────────────────────────────
export default function HomePage() {
  const [now, setNow] = useState(new Date());
  const [spx, setSpx] = useState(0);
  const [spxChg, setSpxChg] = useState(0);
  const [esFut, setEsFut] = useState(0);
  const [netGex, setNetGex] = useState(0);
  const [mktBias, setMktBias] = useState("Loading…");
  const [sparkData, setSparkData] = useState(SPARK_SEED);
  const [minsLeft, setMinsLeft] = useState(minsToClose());
  const [focus, setFocus] = useState(FOCUS_ITEMS);
  const wsRef = useRef<WebSocket | null>(null);
  const prevSpxRef = useRef(0);

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => {
      setNow(new Date());
      setMinsLeft(minsToClose());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // WS for live SPX + ES
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
          symbols: ["$SPX", "SPX", "/ESU26", "/ES:XCME"],
          feedTypesBySymbol: {
            "$SPX": ["Quote", "Trade", "Summary"],
            "SPX":  ["Quote", "Trade", "Summary"],
            "/ESU26": ["Quote", "Trade"],
            "/ES:XCME": ["Quote", "Trade"],
          },
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
            const bid = Number(ev.bidPrice ?? 0);
            const ask = Number(ev.askPrice ?? 0);
            const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
            if (mid > 100) {
              if (prevSpxRef.current > 0) setSpxChg(((mid - prevSpxRef.current) / prevSpxRef.current) * 100);
              if (prevSpxRef.current === 0) prevSpxRef.current = mid;
              setSpx(mid);
              setSparkData(prev => [...prev.slice(-19), mid]);
            }
          }
          if ((sym === "/ESU26" || sym === "/ES:XCME") && t === "Quote") {
            const bid = Number(ev.bidPrice ?? 0);
            const ask = Number(ev.askPrice ?? 0);
            const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
            if (mid > 100) setEsFut(mid);
          }
        });
      } catch {}
    };

    ws.onclose = () => {};
    return () => { ws.close(); };
  }, []);

  // Pull net GEX from API
  useEffect(() => {
    const load = () => {
      fetch("/api/gex", { cache: "no-store" })
        .then(r => r.json())
        .then(j => {
          const g = j?.summary?.totalNetGEX ?? j?.totalNetGEX ?? 0;
          if (isFinite(g) && g !== 0) {
            setNetGex(g);
            setMktBias(g > 0 ? "Positive GEX — Pinning" : "Negative GEX — Trending");
          }
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const etTime = now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const marketOpen = isMarketOpen();
  const winPct = 78; // placeholder — wire to your P&L data

  const card: React.CSSProperties = {
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 14,
    padding: "18px 20px",
  };

  return (
    <div style={{
      height: "100%", overflow: "auto", background: "#05080d",
      fontFamily: "Arial, Helvetica, sans-serif", color: "#e4e4e7",
      padding: "20px 24px", boxSizing: "border-box",
    }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── TOP ROW: Greeting + clock / Date + market ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "start" }}>

          {/* Greeting + sparkline */}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 4, overflow: "hidden", position: "relative" }}>
            <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "55%", opacity: 0.7 }}>
              <Sparkline values={sparkData} />
            </div>
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{greeting()}</span>
            <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.5px" }}>Bzila</span>
            <span style={{ fontSize: 11, color: "#475569", fontStyle: "italic", marginTop: 2 }}>"Stay disciplined and edge the market."</span>
          </div>

          {/* Date / time / market status */}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10, minWidth: 220 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{etDateStr()}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>{etDayStr()}</div>
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 13, color: "#00e5ff", fontWeight: 800 }}>{etTime}</div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                fontSize: 9, fontWeight: 800, padding: "3px 8px", borderRadius: 4, letterSpacing: "0.1em",
                background: marketOpen ? "rgba(0,230,118,0.15)" : "rgba(255,71,87,0.12)",
                color: marketOpen ? "#00e676" : "#ff4757", border: `1px solid ${marketOpen ? "rgba(0,230,118,0.3)" : "rgba(255,71,87,0.2)"}`,
              }}>● {marketOpen ? "MARKET OPEN" : "MARKET CLOSED"}</span>
            </div>

            <div style={{ display: "flex", gap: 16 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", letterSpacing: "-0.5px" }}>
                  {spx > 0 ? spx.toFixed(2) : "—"}
                </div>
                <div style={{ fontSize: 10, color: "#64748b" }}>
                  SPX <span style={{ color: spxChg >= 0 ? "#00e676" : "#ff4757", fontWeight: 700 }}>
                    {spxChg >= 0 ? "+" : ""}{spxChg.toFixed(2)}%
                  </span>
                </div>
              </div>
              {esFut > 0 && (
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", letterSpacing: "-0.5px" }}>{esFut.toFixed(2)}</div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>ESU FUTURES</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── MIDDLE ROW ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>

          {/* Performance ring */}
          <div style={{ ...card, display: "flex", gap: 20, alignItems: "center" }}>
            <div style={{ position: "relative" }}>
              <Ring pct={winPct} size={96} stroke={7} color="#00b4ff" accent="#a78bfa">
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{winPct}</span>
                  <span style={{ fontSize: 9, color: "#64748b" }}>%</span>
                </div>
              </Ring>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Performance</div>
              <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{winPct}<span style={{ fontSize: 12, color: "#64748b" }}> %</span></div>
              <div style={{ fontSize: 11, color: "#00e5ff", fontWeight: 700, marginTop: 4 }}>Solid Edge Today!</div>
              <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
                <div>
                  <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total Trades</div>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>14</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em" }}>Profitable</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#00e676" }}>11</div>
                </div>
              </div>
            </div>
          </div>

          {/* Session timer */}
          <div style={{ ...card, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", alignSelf: "flex-start" }}>Session Timer</div>
            <SessionRing minsLeft={minsLeft} />
            <a href="/trading" style={{ textDecoration: "none" }}>
              <div style={{
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                padding: "8px 28px", borderRadius: 20, fontSize: 11, fontWeight: 800,
                color: "#fff", cursor: "pointer", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 6,
              }}>
                ▶ Start
              </div>
            </a>
          </div>

          {/* Market bias */}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em" }}>Market Bias</div>
              <a href="/gex" style={{ fontSize: 9, color: "#00e5ff", textDecoration: "none", fontWeight: 700 }}>Details →</a>
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: netGex >= 0 ? "#00e5ff" : "#ff4757" }}>{mktBias}</div>
            {/* Mini sine wave decoration */}
            <svg viewBox="0 0 200 40" style={{ width: "100%", height: 36, opacity: 0.6 }}>
              <path d="M0,20 C20,5 40,5 60,20 C80,35 100,35 120,20 C140,5 160,5 180,20 C190,27.5 195,27.5 200,20"
                fill="none" stroke={netGex >= 0 ? "#00e5ff" : "#ff4757"} strokeWidth="1.5" />
              <path d="M0,20 C25,30 50,30 75,20 C100,10 125,10 150,20 C175,30 188,30 200,20"
                fill="none" stroke="#a78bfa" strokeWidth="1" strokeOpacity="0.5" />
            </svg>
            <div>
              <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total Net GEX</div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: netGex >= 0 ? "#00e5ff" : "#ff4757" }}>
                {netGex !== 0 ? fmtMoney(netGex) : "Loading…"}
              </div>
            </div>
          </div>
        </div>

        {/* ── BOTTOM ROW ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>

          {/* Today's focus */}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em" }}>Today&apos;s Focus</div>
              <button
                onClick={() => setFocus(f => [...f, { label: "New task", done: false }])}
                style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>+</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {focus.map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
                  onClick={() => setFocus(f => f.map((x, j) => j === i ? { ...x, done: !x.done } : x))}>
                  <div style={{
                    width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                    background: item.done ? "rgba(0,180,255,0.9)" : "transparent",
                    border: `2px solid ${item.done ? "#00b4ff" : "rgba(255,255,255,0.2)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.2s",
                  }}>
                    {item.done && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1, fontWeight: 800 }}>✓</span>}
                  </div>
                  <span style={{
                    fontSize: 12, fontWeight: item.done ? 600 : 700,
                    color: item.done ? "#475569" : "#e4e4e7",
                    textDecoration: item.done ? "line-through" : "none",
                    transition: "all 0.2s",
                  }}>{item.label}</span>
                  <span style={{
                    marginLeft: "auto", fontSize: 9, fontWeight: 700,
                    color: item.done ? "#00e676" : i === focus.findIndex(x => !x.done) ? "#ffb300" : "#334155",
                  }}>
                    {item.done ? "Completed" : i === focus.findIndex(x => !x.done) ? "In Progress" : "Pending"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Weekly P&L */}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em" }}>Weekly P&amp;L</div>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#00e676", fontFamily: "monospace" }}>+$1.2k</span>
            </div>
            <WeeklyBars data={WEEKLY_DATA} />
          </div>

          {/* Trading Tools */}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em" }}>Trading Tools</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {TOOLS.map(t => <ToolCard key={t.label} {...t} />)}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
