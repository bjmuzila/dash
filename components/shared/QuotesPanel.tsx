"use client";

import { useEffect, useRef, useState } from "react";
import { getClientProxyBase, getClientWsUrl } from "@/lib/clientRuntime";

// All symbols — indices/futures always streamed, equities subscribed on mount
const ES_DISPLAY_SYMBOL = "/ESU26";
const NQ_DISPLAY_SYMBOL = "/NQU26";
const WS_SYMBOLS: Array<{ sym: string; label: string }> = [
  { sym: "VIX",      label: "VIX" },
  { sym: ES_DISPLAY_SYMBOL, label: "ESU" },
  { sym: NQ_DISPLAY_SYMBOL, label: "NQU" },
  { sym: "SPX",      label: "SPX" },
  { sym: "SPCX",     label: "SPCX" },
  { sym: "QQQ",      label: "QQQ" },
  { sym: "SMH",      label: "SMH" },
  { sym: "AAPL",     label: "AAPL" },
  { sym: "AMD",      label: "AMD" },
  { sym: "AMZN",     label: "AMZN" },
  { sym: "GOOGL",    label: "GOOGL" },
  { sym: "META",     label: "META" },
  { sym: "MSFT",     label: "MSFT" },
  { sym: "NVDA",     label: "NVDA" },
  { sym: "TSLA",     label: "TSLA" },
];

// Equities need to be explicitly subscribed on mount (proxy doesn't pre-subscribe them)
const REST_SYMBOLS = WS_SYMBOLS.filter(s => !s.sym.startsWith("/") && !["VIX","SPX"].includes(s.sym));

const ALL_SYMBOLS = WS_SYMBOLS.map(s => ({ sym: s.sym, label: s.label }));

interface LiveRec {
  pct: number | null;
}

function quoteNumber(q: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(q[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function pctFromQuote(q: Record<string, unknown>) {
  const directPct = quoteNumber(q, "percent-change", "changePercent", "netPercentChange", "netPercentChangeInDouble", "pctChange", "dayPercentChange");
  if (directPct != null && Math.abs(directPct) <= 20) return directPct;

  const last = quoteNumber(q, "last", "lastPrice", "mark", "mark-price", "price", "close", "closePrice");
  const prev = quoteNumber(q, "prev-close", "prevClose", "previousClose", "prevDayClosePrice", "close-price", "closePrice");
  if (last != null && prev != null && prev > 0) {
    const pct = ((last - prev) / prev) * 100;
    if (Number.isFinite(pct) && Math.abs(pct) <= 20) return pct;
  }

  const change = quoteNumber(q, "change", "netChange", "dayChange", "tradeChange");
  if (change != null && prev != null && prev > 0) {
    const pct = (change / prev) * 100;
    if (Number.isFinite(pct) && Math.abs(pct) <= 20) return pct;
  }

  return null;
}

// ─── component ───────────────────────────────────────────────────────────────
export default function QuotesPanel() {
  const wsLiveRef = useRef<Record<string, { lastPrice: number; prevClose: number; pctFeed: number; bidPrice: number; askPrice: number }>>({});
  const [rows, setRows] = useState<Record<string, number | null>>({});
  const [ts, setTs] = useState("");
  const [countdown, setCountdown] = useState(30);
  const wsRef = useRef<WebSocket | null>(null);
  const lastUpdateRef = useRef(Date.now());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── dxlink WS for all symbols ───────────────────────────────────────────────
  useEffect(() => {
    async function connect() {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      try {
        const ws = new WebSocket(getClientWsUrl());
        wsRef.current = ws;

        ws.onopen = () => {
          // Register with proxy's subscription filter
          ws.send(JSON.stringify({
            type: "subscribe",
            symbols: WS_SYMBOLS.map(s => s.sym),
          }));
        };

        ws.onclose = () => {
          wsRef.current = null;
          reconnectTimerRef.current = setTimeout(() => { void connect(); }, 5000);
        };
        ws.onerror = () => ws.close();

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type !== "FEED_DATA") return;
            const events: unknown[] = msg.data || [];

            const normalize = (raw: string): string => {
              if (raw.startsWith("/ES")) return ES_DISPLAY_SYMBOL;
              if (raw.startsWith("/NQ")) return NQ_DISPLAY_SYMBOL;
              return raw;
            };

            events.forEach((ev: unknown) => {
              const e = ev as Record<string, unknown>;
              const sym = normalize(String(e.eventSymbol || ""));
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

              const directPct = Number(e.dayPercentChange ?? e.changePercent ?? e["percent-change"] ?? e.netPercentChange ?? e.netPercentChangeInDouble ?? 0);
              if (directPct !== 0 && Number.isFinite(directPct) && Math.abs(directPct) <= 20) rec.pctFeed = directPct;
            });

            // recompute WS rows
            // Only sanity-check manually computed pct (not dxFeed's own dayPercentChange)
            const sane = (price: number, prev: number) => prev > 0 && Math.abs(price - prev) / prev < 0.20;
            setRows(prev => {
              const next = { ...prev };
              WS_SYMBOLS.forEach(({ sym }) => {
                const rec = wsLiveRef.current[sym];
                if (!rec) return;
                // Trust dxFeed's own pctFeed directly — no sanity check needed
                if (rec.pctFeed !== 0 && Math.abs(rec.pctFeed) <= 20) { next[sym] = rec.pctFeed; return; }
                const price = rec.lastPrice || (rec.bidPrice > 0 && rec.askPrice > 0 ? (rec.bidPrice + rec.askPrice) / 2 : 0);
                if (price > 0 && sane(price, rec.prevClose)) {
                  const pct = ((price - rec.prevClose) / rec.prevClose) * 100;
                  if (Math.abs(pct) <= 20) next[sym] = pct;
                }
              });
              return next;
            });

            const now = new Date();
            setTs(`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`);
            lastUpdateRef.current = Date.now();
            setCountdown(30);
          } catch (_) {}
        };
      } catch (_) {}
    }

    void connect();

    // Seed prevClose for WS symbols from REST on mount so sane() check passes immediately
    async function seedPrevCloses() {
      try {
        const syms = ["VIX", "SPX", "SPCX", "QQQ", "SMH", "AAPL", "AMD", "AMZN", "GOOGL", "META", "MSFT", "NVDA", "TSLA", ES_DISPLAY_SYMBOL, "/ESU6", "/ES:XCME", NQ_DISPLAY_SYMBOL, "/NQU26", "/NQ:XCME"].join(",");
        const r = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(syms)}`);
        if (!r.ok) return;
        const d = await r.json();
        const items: Array<Record<string, unknown>> = d?.data?.items || [];
        items.forEach(q => {
          const rawSym = String(q.symbol || "");
          const sym = rawSym.startsWith("/ES") ? ES_DISPLAY_SYMBOL : rawSym.startsWith("/NQ") ? NQ_DISPLAY_SYMBOL : rawSym;
          const prev = Number(q["prev-close"] ?? q.prevClose ?? q.previousClose ?? q.prevDayClosePrice ?? 0);
          if (prev > 0) {
            if (!wsLiveRef.current[sym]) wsLiveRef.current[sym] = { lastPrice: 0, prevClose: 0, pctFeed: 0, bidPrice: 0, askPrice: 0 };
            wsLiveRef.current[sym].prevClose = prev;
          }
          const pct = pctFromQuote(q);
          if (pct != null) {
            if (!wsLiveRef.current[sym]) wsLiveRef.current[sym] = { lastPrice: 0, prevClose: 0, pctFeed: 0, bidPrice: 0, askPrice: 0 };
            wsLiveRef.current[sym].pctFeed = pct;
          }
        });
      } catch (_) {}
    }
    seedPrevCloses();

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  // ── Subscribe equities to proxy so they stream on the WS ──────────────────
  useEffect(() => {
    async function subscribeEquities() {
      try {
        // Seed current prices from REST first so panel isn't empty on load
          const syms = [...REST_SYMBOLS.map(s => s.sym), ES_DISPLAY_SYMBOL, "/ESU6", "/ES:XCME", NQ_DISPLAY_SYMBOL, "/NQU26", "/NQ:XCME"].join(",");
        const r = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(syms)}`);
        if (r.ok) {
          const d = await r.json();
          const items: Array<Record<string, unknown>> = d?.data?.items || [];
          setRows(prev => {
            const next = { ...prev };
            items.forEach(q => {
              const rawSym = String(q.symbol || "");
              const sym = rawSym.startsWith("/ES") ? ES_DISPLAY_SYMBOL : rawSym.startsWith("/NQ") ? NQ_DISPLAY_SYMBOL : rawSym;
              if (!REST_SYMBOLS.find(s => s.sym === sym)) return;
              const last = Number(q.last ?? 0);
              const prev2 = Number(q["prev-close"] ?? q.prevClose ?? q.previousClose ?? q.prevDayClosePrice ?? 0);
              const pct = pctFromQuote(q);
              if (pct != null) {
                next[sym] = pct;
              } else if (last > 0 && prev2 > 0 && Math.abs(last - prev2) / prev2 < 0.20) {
                const pct2 = ((last - prev2) / prev2) * 100;
                next[sym] = pct2;
              }
            });
            return next;
          });
        }

        // Tell proxy to subscribe these symbols to dxFeed — they'll stream on WS from now on
        await fetch(getClientProxyBase() + "/proxy/dxlink/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbols: REST_SYMBOLS.map(s => s.sym),
            feedTypes: ["Quote", "Trade", "Summary"],
          }),
        });
      } catch (_) {}
    }
    subscribeEquities();
  }, []);

  // 30-second countdown timer
  useEffect(() => {
    lastUpdateRef.current = Date.now(); // Reset on mount
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastUpdateRef.current) / 1000);
      const remaining = Math.max(0, 30 - elapsed);
      setCountdown(remaining);
      // Reset countdown every 30s even if no data (maintains timer)
      if (remaining === 0) {
        lastUpdateRef.current = Date.now();
      }
    }, 250);
    return () => clearInterval(interval);
  }, []);

  const sortedRows = ALL_SYMBOLS
    .map(({ sym, label }) => ({ sym, label, pct: rows[sym] ?? null }))
    .sort((a, b) => {
      if (a.pct === null && b.pct === null) return 0;
      if (a.pct === null) return 1;
      if (b.pct === null) return -1;
      return b.pct - a.pct;
    });

  const [rowHeight, setRowHeight] = useState(28);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, background: "rgba(5,10,16,.5)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 10px", borderBottom: "1px solid #0d1825", flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: "#4a6a84", fontWeight: 700, letterSpacing: ".12em" }}>QUOTES</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 8, fontVariantNumeric: "tabular-nums" }}>
          <span style={{ color: ts ? "#1e3050" : "#29b6f6" }}>{ts || "LIVE"}</span>
          <span style={{ color: countdown > 10 ? "#2a5a8a" : countdown > 5 ? "#f97316" : "#ef4444", fontWeight: 700 }}>{countdown}s</span>
        </div>
      </div>

      {/* Rows — fill all available space */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {sortedRows.map(({ sym, label, pct }) => {
          const up = pct !== null ? pct >= 0 : null;
          const color = up === null ? "#3a5570" : up ? "#00e676" : "#ff4757";
          const arrow = up === null ? "" : up ? "▲" : "▼";
          const pctText = pct !== null ? `${arrow} ${Math.abs(pct).toFixed(2)}%` : "—";
          return (
            <div
              key={sym}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: `0 10px`, height: rowHeight,
                borderBottom: "1px solid #0a1220", flexShrink: 0,
              }}
            >
              <span style={{ fontSize: Math.max(8, rowHeight * 0.36), fontWeight: 700, color: "#ffffff", letterSpacing: ".08em" }}>{label}</span>
              <span style={{ fontSize: Math.max(9, rowHeight * 0.42), fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{pctText}</span>
            </div>
          );
        })}
      </div>

      {/* Row height slider */}
      <div style={{ flexShrink: 0, padding: "4px 8px", borderTop: "1px solid #0a1220", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 7, color: "#2a4a6a", letterSpacing: ".06em" }}>SIZE</span>
        <input
          type="range" min={16} max={56} step={1}
          value={rowHeight}
          onChange={e => setRowHeight(Number(e.target.value))}
          style={{ flex: 1, height: 2, accentColor: "#1e3050", cursor: "pointer" }}
        />
      </div>
    </div>
  );
}
