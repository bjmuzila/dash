"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// ── Icons ────────────────────────────────────────────────────────────────────
const HomeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);
const GridIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
    <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
  </svg>
);
const CalendarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);
const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

// ── Live quotes feed ─────────────────────────────────────────────────────────
const ES_DISPLAY_SYMBOL = "/ESU26";
const NQ_DISPLAY_SYMBOL = "/NQU26";

const QUOTE_SYMBOLS = [
  { sym: "AMD",              label: "AMD" },
  { sym: "META",             label: "META" },
  { sym: "SMH",              label: "SMH" },
  { sym: "NVDA",             label: "NVDA" },
  { sym: "AMZN",             label: "AMZN" },
  { sym: NQ_DISPLAY_SYMBOL,  label: "NQU" },
  { sym: "QQQ",              label: "QQQ" },
  { sym: "GOOGL",            label: "GOOGL" },
  { sym: "MSFT",             label: "MSFT" },
  { sym: "AAPL",             label: "AAPL" },
  { sym: "VIX",              label: "VIX" },
];

const WS_ALL_SYMBOLS = [
  { sym: "VIX",             label: "VIX" },
  { sym: ES_DISPLAY_SYMBOL, label: "ESU" },
  { sym: NQ_DISPLAY_SYMBOL, label: "NQU" },
  { sym: "SPX",             label: "SPX" },
  { sym: "QQQ",             label: "QQQ" },
  { sym: "SMH",             label: "SMH" },
  { sym: "NVDA",            label: "NVDA" },
  { sym: "AAPL",            label: "AAPL" },
  { sym: "META",            label: "META" },
  { sym: "MSFT",            label: "MSFT" },
  { sym: "AMD",             label: "AMD" },
  { sym: "AMZN",            label: "AMZN" },
  { sym: "GOOGL",           label: "GOOGL" },
];

const REST_SYMBOLS = WS_ALL_SYMBOLS.filter(s => !s.sym.startsWith("/") && !["VIX", "SPX"].includes(s.sym));

// Static sigma levels — replace with live calc if available
const SIGMA_LEVELS = [
  { label: "1σ",  strike: "7,595", color: "#00e5ff" },
  { label: "2σ",  strike: "7,636", color: "#00e5ff" },
  { label: "-3σ", strike: "7,513", color: "#ff4757" },
  { label: "-2σ", strike: "7,472", color: "#ff4757" },
];

function useLiveQuotes() {
  const wsLiveRef = useRef<Record<string, { lastPrice: number; prevClose: number; pctFeed: number; bidPrice: number; askPrice: number }>>({});
  const [pcts, setPcts] = useState<Record<string, number | null>>({});
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    function connect() {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      try {
        const ws = new WebSocket((process.env.NEXT_PUBLIC_WS_URL ?? "wss://vanila-8zn1.onrender.com") + "/ws/dxlink");
        wsRef.current = ws;
        ws.onopen = () => {
          ws.send(JSON.stringify({
            type: "FEED_SUBSCRIPTION",
            add: WS_ALL_SYMBOLS.flatMap(({ sym }) => [
              { type: "Quote",   symbol: sym },
              { type: "Trade",   symbol: sym },
              { type: "Summary", symbol: sym },
            ]),
          }));
        };
        ws.onclose = () => { wsRef.current = null; setTimeout(connect, 5000); };
        ws.onerror  = () => ws.close();
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type !== "FEED_DATA") return;
            (msg.data || []).forEach((e: Record<string, unknown>) => {
              const rawSym = String(e.eventSymbol || "");
              const sym = rawSym.startsWith("/ES") ? ES_DISPLAY_SYMBOL : rawSym.startsWith("/NQ") ? NQ_DISPLAY_SYMBOL : rawSym;
              if (!WS_ALL_SYMBOLS.find(s => s.sym === sym)) return;
              if (!wsLiveRef.current[sym]) wsLiveRef.current[sym] = { lastPrice: 0, prevClose: 0, pctFeed: 0, bidPrice: 0, askPrice: 0 };
              const rec = wsLiveRef.current[sym];
              const eType = String(e.eventType || "");
              if (eType === "Quote") {
                if (e.bidPrice != null) rec.bidPrice = Number(e.bidPrice);
                if (e.askPrice != null) rec.askPrice = Number(e.askPrice);
                if (e.dayPercentChange != null && Number(e.dayPercentChange) !== 0) rec.pctFeed = Number(e.dayPercentChange);
              } else if (eType === "Trade") {
                if (e.price != null && Number(e.price) > 0) rec.lastPrice = Number(e.price);
                if (e.dayPercentChange != null && Number(e.dayPercentChange) !== 0) rec.pctFeed = Number(e.dayPercentChange);
              } else if (eType === "Summary") {
                const pc = Number(e.prevDayClosePrice ?? e.prevClose ?? e.previousClose ?? 0);
                if (pc > 0) rec.prevClose = pc;
                if (e.dayPercentChange != null && Number(e.dayPercentChange) !== 0) rec.pctFeed = Number(e.dayPercentChange);
              }
            });
            setPcts(prev => {
              const next = { ...prev };
              WS_ALL_SYMBOLS.forEach(({ sym }) => {
                const rec = wsLiveRef.current[sym];
                if (!rec) return;
                if (rec.pctFeed !== 0 && Math.abs(rec.pctFeed) <= 20) { next[sym] = rec.pctFeed; return; }
                const price = rec.lastPrice || (rec.bidPrice > 0 && rec.askPrice > 0 ? (rec.bidPrice + rec.askPrice) / 2 : 0);
                if (price > 0 && rec.prevClose > 0) {
                  const pct = ((price - rec.prevClose) / rec.prevClose) * 100;
                  if (Math.abs(pct) <= 20) next[sym] = pct;
                }
              });
              return next;
            });
          } catch (_) {}
        };
      } catch (_) {}
    }
    connect();

    async function seedPrevCloses() {
      try {
        const syms = WS_ALL_SYMBOLS.map(s => s.sym).join(",");
        const r = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(syms)}`);
        if (!r.ok) return;
        const d = await r.json();
        const items: Array<Record<string, unknown>> = d?.data?.items || [];
        items.forEach(q => {
          const rawSym = String(q.symbol || "");
          const sym = rawSym.startsWith("/ES") ? ES_DISPLAY_SYMBOL : rawSym.startsWith("/NQ") ? NQ_DISPLAY_SYMBOL : rawSym;
          const prev = Number(q["prev-close"] ?? 0);
          if (prev > 0) {
            if (!wsLiveRef.current[sym]) wsLiveRef.current[sym] = { lastPrice: 0, prevClose: 0, pctFeed: 0, bidPrice: 0, askPrice: 0 };
            wsLiveRef.current[sym].prevClose = prev;
          }
        });
      } catch (_) {}
    }
    seedPrevCloses();

    async function subscribeEquities() {
      try {
        await fetch((process.env.NEXT_PUBLIC_PROXY_URL ?? "https://vanila-8zn1.onrender.com") + "/proxy/dxlink/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: REST_SYMBOLS.map(s => s.sym), feedTypes: ["Quote", "Trade", "Summary"] }),
        });
      } catch (_) {}
    }
    subscribeEquities();

    return () => wsRef.current?.close();
  }, []);

  return pcts;
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
export default function Sidebar({
  onClose,
  onOpen,
  isMobile,
  collapsed,
}: {
  onClose?: () => void;
  onOpen?: () => void;
  isMobile?: boolean;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const pcts = useLiveQuotes();

  const navItems = [
    { href: "/home",             icon: <HomeIcon />,     label: "Home" },
    { href: "/overview",         icon: <GridIcon />,     label: "Overview" },
    { href: "/expiry-calendar",  icon: <CalendarIcon />, label: "Calendar" },
  ];

  const isActive = (href: string) => pathname === href || (href === "/home" && pathname === "/");

  return (
    <nav style={{
      width: 110,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: "#07090f",
      borderRight: "1px solid rgba(255,255,255,0.06)",
      overflow: "hidden",
      fontFamily: "monospace",
    }}>

      {/* ── Nav icons ── */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 0 8px" }}>
        {navItems.map(({ href, icon, label }) => {
          const active = isActive(href);
          return (
            <a
              key={href}
              href={href}
              title={label}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 40,
                height: 40,
                borderRadius: 10,
                background: active ? "rgba(0,229,255,0.12)" : "transparent",
                border: active ? "1px solid rgba(0,229,255,0.30)" : "1px solid transparent",
                color: active ? "#00e5ff" : "#3a5570",
                textDecoration: "none",
                transition: "all 0.15s",
                boxShadow: active ? "0 0 12px rgba(0,229,255,0.18)" : "none",
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#00e5ff"; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#3a5570"; }}
            >
              {icon}
            </a>
          );
        })}
      </div>

      {/* divider */}
      <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "4px 12px" }} />

      {/* ── QUOTES label ── */}
      <div style={{ padding: "8px 12px 4px", fontSize: 9, fontWeight: 700, color: "#3a5570", letterSpacing: "0.12em", textTransform: "uppercase" }}>
        Quotes
      </div>

      {/* ── Quote rows ── */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, scrollbarWidth: "none" }}>
        {QUOTE_SYMBOLS.map(({ sym, label }) => {
          const pct = pcts[sym] ?? null;
          const up = pct !== null ? pct >= 0 : null;
          const color = pct === null ? "#3a5570" : pct < -0.01 ? "#ff4757" : "#00e676";
          const isNqu = label === "NQU";
          return (
            <div
              key={sym}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "4px 0",
                background: isNqu ? "rgba(0,229,255,0.06)" : "transparent",
                borderLeft: isNqu ? "2px solid rgba(0,229,255,0.40)" : "2px solid transparent",
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 700, color: isNqu ? "#00e5ff" : "#8da8c2", letterSpacing: "0.04em" }}>{label}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: "0.02em" }}>
                {pct !== null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—"}
              </span>
            </div>
          );
        })}
      </div>

      {/* divider */}
      <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "4px 12px" }} />

      {/* ── SIGMA section ── */}
      <div style={{ padding: "6px 12px 4px" }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "#3a5570", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>
          Sigma
        </div>
        {SIGMA_LEVELS.map(({ label, strike, color }) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" }}>
            <span style={{ fontSize: 9, color: color, fontWeight: 700, minWidth: 28 }}>{label}</span>
            <span style={{ fontSize: 10, color: "#c5d5e5", fontWeight: 700, letterSpacing: "0.02em" }}>{strike}</span>
          </div>
        ))}
      </div>

      {/* divider */}
      <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "4px 12px 0" }} />

      {/* ── Bottom: Settings + Avatar ── */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "10px 0 14px" }}>
        <button
          title="Settings"
          style={{ background: "none", border: "none", color: "#3a5570", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 6, borderRadius: 8, transition: "color 0.15s" }}
          onMouseEnter={e => (e.currentTarget.style.color = "#00e5ff")}
          onMouseLeave={e => (e.currentTarget.style.color = "#3a5570")}
        >
          <SettingsIcon />
        </button>
        {/* Avatar circle */}
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: "radial-gradient(circle at 35% 35%, #00e5ff, #0066cc)",
          boxShadow: "0 0 12px rgba(0,229,255,0.35)",
          cursor: "pointer",
          flexShrink: 0,
        }} />
      </div>
    </nav>
  );
}
