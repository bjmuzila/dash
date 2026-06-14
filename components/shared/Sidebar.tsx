"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import QuotesPanel from "./QuotesPanel";
import DailyEmPanel from "./DailyEmPanel";
import pkg from "../../package.json";

// ── Collapsed ticker ────────────────────────────────────────────────────────
const WS_SYMBOLS = [
  { sym: "VIX",      label: "VIX" },
  { sym: "/ES:XCME", label: "ES" },
  { sym: "/NQ:XCME", label: "NQ" },
  { sym: "SPX",      label: "SPX" },
  { sym: "QQQ",      label: "QQQ" },
  { sym: "NVDA",     label: "NVDA" },
  { sym: "AAPL",     label: "AAPL" },
  { sym: "TSLA",     label: "TSLA" },
  { sym: "META",     label: "META" },
  { sym: "MSFT",     label: "MSFT" },
  { sym: "AMD",      label: "AMD" },
  { sym: "AMZN",     label: "AMZN" },
];

function CollapsedTicker() {
  const wsLiveRef = useRef<Record<string, { lastPrice: number; prevClose: number; pctFeed: number; bidPrice: number; askPrice: number }>>({});
  const [rows, setRows] = useState<Record<string, number | null>>({});
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
            add: WS_SYMBOLS.flatMap(({ sym }) => [
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
              const sym = String(e.eventSymbol || "");
              if (!WS_SYMBOLS.find(s => s.sym === sym)) return;
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
            setRows(prev => {
              const next = { ...prev };
              WS_SYMBOLS.forEach(({ sym }) => {
                const rec = wsLiveRef.current[sym];
                if (!rec) return;
                if (rec.pctFeed !== 0 && Math.abs(rec.pctFeed) <= 20) { next[sym] = rec.pctFeed; return; }
                const price = rec.lastPrice || (rec.bidPrice > 0 && rec.askPrice > 0 ? (rec.bidPrice + rec.askPrice) / 2 : 0);
                if (price > 0 && rec.prevClose > 0 && Math.abs(price - rec.prevClose) / rec.prevClose < 0.20) {
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
    return () => wsRef.current?.close();
  }, []);

  const items = WS_SYMBOLS.map(({ sym, label }) => ({ label, pct: rows[sym] ?? null }));
  // duplicate for seamless loop
  const doubled = [...items, ...items];

  return (
    <div style={{ flex: 1, overflow: "hidden", position: "relative", minHeight: 0 }}>
      <style>{`
        @keyframes scrollUp {
          0%   { transform: translateY(0); }
          100% { transform: translateY(-50%); }
        }
        .ticker-track {
          animation: scrollUp ${items.length * 2.2}s linear infinite;
        }
        .ticker-track:hover { animation-play-state: paused; }
      `}</style>
      <div className="ticker-track" style={{ display: "flex", flexDirection: "column" }}>
        {doubled.map(({ label, pct }, i) => {
          const up = pct !== null ? pct >= 0 : null;
          const color = up === null ? "#3a5570" : up ? "#00e676" : "#ff4757";
          return (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "6px 0",
                borderBottom: "1px solid #0a1420",
                gap: 2,
              }}
            >
              <span style={{ fontSize: 8, fontWeight: 700, color: "#7a9ab8", letterSpacing: ".06em" }}>{label}</span>
              <span style={{ fontSize: 9, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
                {pct !== null ? `${pct >= 0 ? "▲" : "▼"}${Math.abs(pct).toFixed(1)}%` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sidebar ─────────────────────────────────────────────────────────────────
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
  const isOverview = pathname === "/";

  const borderColor = isOverview ? "var(--overview-border, var(--border))" : "var(--border)";
  const bg = isOverview ? "var(--overview-bg, var(--surface))" : "var(--surface)";

  if (collapsed) {
    return (
      <nav
        style={{
          width: 36,
          display: "flex",
          flexDirection: "column",
          borderRight: `1px solid ${borderColor}`,
          background: bg,
          height: "100%",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {/* Expand button */}
        <div style={{ display: "flex", justifyContent: "center", padding: "6px 0", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <button
            onClick={onOpen}
            aria-label="Expand sidebar"
            style={{ background: "none", border: "1px solid #1e3050", borderRadius: 4, color: "#00e5ff", fontSize: 13, cursor: "pointer", padding: "2px 5px", lineHeight: 1.4 }}
          >
            ▶
          </button>
        </div>

        {/* Vertical live ticker */}
        <CollapsedTicker />

        {/* Version */}
        <div style={{ flexShrink: 0, padding: "5px 2px", borderTop: "1px solid var(--border)", textAlign: "center", fontSize: 7, color: "#1e3050", letterSpacing: "0.04em" }}>
          v{pkg.version.split("-")[0].slice(2)}
        </div>
      </nav>
    );
  }

  return (
    <nav
      className="flex flex-col w-44 shrink-0 border-r"
      style={{ borderColor, background: bg, overflow: "hidden", height: "100%" }}
    >
      {/* Header row: collapse button */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "6px 8px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <button
          onClick={onClose}
          aria-label="Collapse sidebar"
          style={{ background: "none", border: "1px solid #1e3050", borderRadius: 4, color: "#00e5ff", fontSize: 13, cursor: "pointer", padding: "2px 7px", lineHeight: 1.4 }}
        >
          ◀
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1 min-h-0" />

      {/* Sticky bottom panels */}
      <div style={{ flexShrink: 0, overflowY: "auto", maxHeight: "60vh" }}>
        <QuotesPanel />
        <DailyEmPanel />
      </div>

      {/* Version */}
      <div style={{ flexShrink: 0, padding: "6px 8px", borderTop: "1px solid var(--border)", textAlign: "center", fontSize: 9, color: "#2a4a6a", letterSpacing: "0.05em" }}>
        v{pkg.version}
      </div>
    </nav>
  );
}
