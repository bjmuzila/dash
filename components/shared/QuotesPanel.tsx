"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// SPX intentionally excluded — use /proxy/quotes or the toolbar for SPX
const WS_SYMBOLS: Array<{ sym: string; label: string }> = [
  { sym: "VIX",           label: "VIX" },
  { sym: "/ESU26",        label: "ESU" },
  { sym: "/NQU26",        label: "NQU" },
  { sym: "SPCX",          label: "SPCX" },
  { sym: "QQQ",           label: "QQQ" },
  { sym: "SMH",           label: "SMH" },
  { sym: "AAPL",          label: "AAPL" },
  { sym: "AMD",           label: "AMD" },
  { sym: "AMZN",          label: "AMZN" },
  { sym: "GOOGL",         label: "GOOGL" },
  { sym: "META",          label: "META" },
  { sym: "MSFT",          label: "MSFT" },
  { sym: "NVDA",          label: "NVDA" },
  { sym: "TSLA",          label: "TSLA" },
];

interface QuoteRec {
  pct: number | null;
  last: number | null;
  prevClose: number | null;
}

interface SparkRec {
  sparkPre: number[];
  sparkRth: number[];
}

// ── tiny SVG sparkline ────────────────────────────────────────────────────────
function Spark({ values, color, w = 44, h = 18 }: { values: number[]; color: string; w?: number; h?: number }) {
  if (values.length < 2) return <svg width={w} height={h} />;
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const range = mx - mn || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - mn) / range) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── component ─────────────────────────────────────────────────────────────────
export default function QuotesPanel() {
  const [quotes, setQuotes]   = useState<Record<string, QuoteRec>>({});
  const [sparks, setSparks]   = useState<Record<string, SparkRec>>({});
  const [countdown, setCountdown] = useState(30);
  const [rowHeight, setRowHeight] = useState(32);
  const lastFetchRef = useRef(Date.now());

  // ── Fetch change% from /proxy/quotes (Theta-backed) ───────────────────────
  const fetchQuotes = useCallback(async () => {
    const syms = WS_SYMBOLS.map(s => s.sym).join(",");
    try {
      const r = await fetch(`/proxy/quotes?symbols=${encodeURIComponent(syms)}`);
      if (!r.ok) throw new Error("proxy/quotes failed");
      const d = await r.json();
      const items: Array<{ symbol: string; last: number; prevClose: number }> = d?.data?.items ?? [];
      const next: Record<string, QuoteRec> = {};
      items.forEach(q => {
        const sym = q.symbol;
        const last = Number(q.last) || null;
        const prev = Number(q.prevClose) || null;
        const pct = last && prev && prev > 0 ? ((last - prev) / prev) * 100 : null;
        next[sym] = { pct: pct !== null && Math.abs(pct) <= 20 ? pct : null, last, prevClose: prev };
      });
      setQuotes(next);
      lastFetchRef.current = Date.now();
    } catch {
      // Fallback to Yahoo quotes-batch
      try {
        const syms = WS_SYMBOLS.map(s => s.sym).join(",");
        const r = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(syms)}`);
        if (!r.ok) return;
        const d = await r.json();
        const items: Array<Record<string, unknown>> = d?.data?.items ?? [];
        const next: Record<string, QuoteRec> = {};
        items.forEach(q => {
          const sym = String(q.symbol ?? "");
          const last = Number(q.last) || null;
          const prev = Number(q["prev-close"] ?? q.prevClose) || null;
          const directPct = Number(q["percent-change"]);
          const pct = Number.isFinite(directPct) && Math.abs(directPct) <= 20
            ? directPct
            : last && prev && prev > 0 ? ((last - prev) / prev) * 100 : null;
          next[sym] = { pct: pct !== null && Math.abs(pct ?? 99) <= 20 ? pct : null, last, prevClose: prev };
        });
        setQuotes(next);
        lastFetchRef.current = Date.now();
      } catch {}
    }
  }, []);

  // ── Fetch sparklines from quotes-batch?spark=1 ────────────────────────────
  const fetchSparks = useCallback(async () => {
    try {
      const syms = WS_SYMBOLS.map(s => s.sym).join(",");
      const r = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(syms)}&spark=1`);
      if (!r.ok) return;
      const d = await r.json();
      const items: Array<{ symbol: string; sparkPre?: number[]; sparkRth?: number[] }> = d?.data?.items ?? [];
      const next: Record<string, SparkRec> = {};
      items.forEach(q => {
        next[q.symbol] = { sparkPre: q.sparkPre ?? [], sparkRth: q.sparkRth ?? [] };
      });
      setSparks(next);
    } catch {}
  }, []);

  // On mount: quotes immediately, sparks shortly after, then poll
  useEffect(() => {
    fetchQuotes();
    const timer = setTimeout(() => fetchSparks(), 2000);
    const quoteInterval = setInterval(fetchQuotes, 30_000);
    const sparkInterval = setInterval(fetchSparks, 3 * 60_000);
    return () => {
      clearTimeout(timer);
      clearInterval(quoteInterval);
      clearInterval(sparkInterval);
    };
  }, [fetchQuotes, fetchSparks]);

  // Countdown display
  useEffect(() => {
    const iv = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastFetchRef.current) / 1000);
      setCountdown(Math.max(0, 30 - elapsed));
    }, 500);
    return () => clearInterval(iv);
  }, []);

  const sorted = WS_SYMBOLS
    .map(({ sym, label }) => ({ sym, label, ...(quotes[sym] ?? { pct: null, last: null, prevClose: null }) }))
    .sort((a, b) => {
      if (a.pct === null && b.pct === null) return 0;
      if (a.pct === null) return 1;
      if (b.pct === null) return -1;
      return b.pct - a.pct;
    });

  const sparkH = Math.max(12, Math.floor(rowHeight * 0.55));
  const sparkW = 44;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, background: "rgba(5,10,16,.5)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 10px", borderBottom: "1px solid #0d1825", flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: "#4a6a84", fontWeight: 700, letterSpacing: ".12em" }}>QUOTES</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 8, fontVariantNumeric: "tabular-nums" }}>
          <span style={{ color: "#1a3a5a", fontSize: 7 }}>PRE</span>
          <span style={{ color: "#29b6f6", fontSize: 7 }}>RTH</span>
          <span style={{ color: countdown > 10 ? "#2a5a8a" : countdown > 5 ? "#FB8501" : "#ef4444", fontWeight: 700 }}>{countdown}s</span>
        </div>
      </div>

      {/* Rows */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {sorted.map(({ sym, label, pct }) => {
          const up = pct !== null ? pct >= 0 : null;
          const color = up === null ? "#3a5570" : up ? "#00e676" : "#ff4757";
          const arrow = up === null ? "" : up ? "▲" : "▼";
          const pctText = pct !== null ? `${arrow} ${Math.abs(pct).toFixed(2)}%` : "—";
          const sp = sparks[sym];
          const preColor = "#4a7a9a";
          const rthColor = up === null ? "#2a5a8a" : up ? "#00b854" : "#cc2233";
          return (
            <div
              key={sym}
              style={{
                display: "flex", alignItems: "center",
                padding: "0 8px", height: rowHeight,
                borderBottom: "1px solid #0a1220", flexShrink: 0,
                gap: 6,
              }}
            >
              {/* Label */}
              <span style={{ fontSize: Math.max(8, rowHeight * 0.33), fontWeight: 700, color: "#c8d8e8", letterSpacing: ".06em", minWidth: 34, flexShrink: 0 }}>{label}</span>

              {/* Pre-market sparkline (8pm–9:30am) */}
              <div style={{ flexShrink: 0, opacity: 0.75 }} title="Pre-market (8pm–9:30am ET)">
                <Spark values={sp?.sparkPre ?? []} color={preColor} w={sparkW} h={sparkH} />
              </div>

              {/* RTH sparkline (9:30am–now, resets at 9:30am) */}
              <div style={{ flexShrink: 0 }} title="RTH (9:30am ET)">
                <Spark values={sp?.sparkRth ?? []} color={rthColor} w={sparkW} h={sparkH} />
              </div>

              {/* Change % */}
              <span style={{ fontSize: Math.max(8, rowHeight * 0.36), fontWeight: 700, color, fontVariantNumeric: "tabular-nums", marginLeft: "auto", flexShrink: 0 }}>{pctText}</span>
            </div>
          );
        })}
      </div>

      {/* Row height slider */}
      <div style={{ flexShrink: 0, padding: "4px 8px", borderTop: "1px solid #0a1220", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 7, color: "#2a4a6a", letterSpacing: ".06em" }}>SIZE</span>
        <input
          type="range" min={20} max={60} step={1}
          value={rowHeight}
          onChange={e => setRowHeight(Number(e.target.value))}
          style={{ flex: 1, height: 2, accentColor: "#1e3050", cursor: "pointer" }}
        />
      </div>
    </div>
  );
}
