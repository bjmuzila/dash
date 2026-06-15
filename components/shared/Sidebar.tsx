"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import QuotesPanel from "./QuotesPanel";
import DailyEmPanel from "./DailyEmPanel";
import pkg from "../../package.json";

// ── Shared chevron-in-box button icon (matches design reference) ─────────────
function ChevronBox({ direction = "right", size = 22 }: { direction?: "left" | "right"; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {direction === "right" ? (
        <polyline points="9 7 15 12 9 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ) : (
        <polyline points="15 7 9 12 15 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      )}
    </svg>
  );
}

// ── Collapsed ticker ────────────────────────────────────────────────────────
const ES_DISPLAY_SYMBOL = "/ESU26";
const NQ_DISPLAY_SYMBOL = "/NQU26";
const WS_SYMBOLS = [
  { sym: "VIX",      label: "VIX" },
  { sym: ES_DISPLAY_SYMBOL, label: "ESU" },
  { sym: NQ_DISPLAY_SYMBOL, label: "NQU" },
  { sym: "SPX",      label: "SPX" },
  { sym: "SPCX",     label: "SPCX" },
  { sym: "QQQ",      label: "QQQ" },
  { sym: "SMH",      label: "SMH" },
  { sym: "NVDA",     label: "NVDA" },
  { sym: "AAPL",     label: "AAPL" },
  { sym: "TSLA",     label: "TSLA" },
  { sym: "META",     label: "META" },
  { sym: "MSFT",     label: "MSFT" },
  { sym: "AMD",      label: "AMD" },
  { sym: "AMZN",     label: "AMZN" },
  { sym: "GOOGL",    label: "GOOGL" },
];

const REST_SYMBOLS = WS_SYMBOLS.filter(s => !s.sym.startsWith("/") && !["VIX","SPX"].includes(s.sym));

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
              const rawSym = String(e.eventSymbol || "");
              const sym = rawSym.startsWith("/ES") ? ES_DISPLAY_SYMBOL : rawSym.startsWith("/NQ") ? NQ_DISPLAY_SYMBOL : rawSym;
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

    // Seed prevClose from REST on mount
    async function seedPrevCloses() {
      try {
        const syms = ["VIX", "SPX", "SPCX", "QQQ", "SMH", "NVDA", "AAPL", "TSLA", "META", "MSFT", "AMD", "AMZN", "GOOGL", ES_DISPLAY_SYMBOL, "/ESU6", "/ES:XCME", NQ_DISPLAY_SYMBOL, "/NQU6", "/NQ:XCME"].join(",");
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

    // Subscribe equities to proxy
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

  // Sort by % change: highest to lowest, nulls at bottom
  const sorted = WS_SYMBOLS
    .map(({ sym, label }) => ({ label, pct: rows[sym] ?? null }))
    .sort((a, b) => {
      if (a.pct === null && b.pct === null) return 0;
      if (a.pct === null) return 1;
      if (b.pct === null) return -1;
      return b.pct - a.pct;
    });

  return (
    <div style={{ flex: 1, overflowY: "auto", minHeight: 0, background: "#05080d" }}>
      {sorted.map(({ label, pct }, i) => {
        const up = pct !== null ? pct >= 0 : null;
        const color = up === null ? "#3a5570" : up ? "#00e676" : "#ff4757";
        return (
          <div
            key={label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "5px 0",
              borderBottom: "1px solid #0a1420",
              gap: 1,
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
  const bg = isOverview ? "var(--overview-bg, #05080d)" : "var(--surface, #05080d)";

  if (collapsed) {
    return (
      <nav
        style={{
          width: 36,
          display: "flex",
          flexDirection: "column",
          borderRight: `1px solid ${borderColor}`,
          background: "#05080d",
          height: "100%",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {/* Expand button */}
        <div style={{ display: "flex", justifyContent: "center", padding: "5px 0", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <button
            onClick={onOpen}
            aria-label="Expand sidebar"
            style={{ background: "none", border: "none", color: "#00e5ff", cursor: "pointer", padding: 0, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <ChevronBox direction="right" size={22} />
          </button>
        </div>

        {/* Vertical live ticker */}
        <CollapsedTicker />

        {/* Version */}
        <div style={{ flexShrink: 0, padding: "5px 2px", borderTop: "1px solid var(--border)", textAlign: "center", fontSize: 7, color: "#fff", letterSpacing: "0.04em" }}>
          v{pkg.version.split("-")[0].slice(2)}
        </div>
      </nav>
    );
  }

  return (
    <nav
      className="flex flex-col w-44 shrink-0 border-r"
      style={{ borderColor, background: "#05080d", overflow: "hidden", height: "100%" }}
    >
      {/* Header row: collapse button */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "4px 6px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <button
          onClick={onClose}
          aria-label="Collapse sidebar"
          style={{ background: "none", border: "none", color: "#00e5ff", cursor: "pointer", padding: 0, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <ChevronBox direction="left" size={22} />
        </button>
      </div>

      {/* Panels fill available space */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "#05080d" }}>
        <QuotesPanel />
        <DailyEmPanel />
      </div>

      {/* Version */}
      <div style={{ flexShrink: 0, padding: "4px 6px", borderTop: "1px solid var(--border)", textAlign: "center", fontSize: 9, color: "#fff", letterSpacing: "0.05em" }}>
        v{pkg.version}
      </div>
    </nav>
  );
}
