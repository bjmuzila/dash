"use client";

import { useEffect, useRef, useState } from "react";

// ── Symbol definitions ───────────────────────────────────────────────────────

const US_FUTURES = [
  { sym: "/ES:XCME",  label: "S&P 500",     wsKey: "/ES:XCME" },
  { sym: "/NQ:XCME",  label: "Nasdaq 100",  wsKey: "/NQ:XCME" },
  { sym: "/RTY:XCME", label: "Russell 2000", wsKey: "/RTY:XCME" },
  { sym: "/YM:XCME",  label: "Dow Jones",   wsKey: "/YM:XCME" },
];

// Europe & Asia — scraped from Yahoo Finance (delayed), keyed by Yahoo symbol
const EUROPE = [
  { sym: "^GDAXI",  label: "German DAX" },
  { sym: "^STOXX50E", label: "Euro Stoxx 50" },
  { sym: "^STOXX",  label: "Euro Stoxx 600" },
  { sym: "^FCHI",   label: "CAC 40" },
  { sym: "^FTSE",   label: "FTSE 100" },
];

const ASIA = [
  { sym: "^N225",   label: "Nikkei 225" },
  { sym: "000001.SS", label: "SSE Comp" },
  { sym: "^HSI",    label: "Hang Seng" },
];

const YAHOO_SYMS = [...EUROPE, ...ASIA];

const COMMODITIES = [
  { sym: "/CL:XNYM", label: "Crude Oil",   wsKey: "/CL:XNYM" },
  { sym: "/HG:XCEC", label: "Copper",      wsKey: "/HG:XCEC" },
  { sym: "/NG:XNYM", label: "Natural Gas", wsKey: "/NG:XNYM" },
];

const RISK_ASSETS = [
  { sym: "/GC:XCEC", label: "Gold",        wsKey: "/GC:XCEC" },
  { sym: "/VX:XCBF", label: "VIX Futures", wsKey: "/VX:XCBF" },
];

const FIXED_FX_CRYPTO = [
  { sym: "/ZN:XCBT",   label: "10Y",     wsKey: "/ZN:XCBT" },
  { sym: "/ZB:XCBT",   label: "30Y",     wsKey: "/ZB:XCBT" },
  { sym: "DX/Y:NYB",   label: "USD",     wsKey: "DX/Y:NYB" },
  { sym: "EURUSD:FX",  label: "EURO",    wsKey: "EURUSD:FX" },
  { sym: "USDJPY:FX",  label: "YEN",     wsKey: "USDJPY:FX" },
  { sym: "GBPUSD:FX",  label: "POUND",   wsKey: "GBPUSD:FX" },
  { sym: "/BTC:XCME",  label: "BITCOIN", wsKey: "/BTC:XCME" },
];

// SPX is populated from DXLink as a key data point for RV sigma
const SPX_SYM = "SPX";

// All WS symbols
const ALL_WS = [
  ...US_FUTURES,
  ...COMMODITIES,
  ...RISK_ASSETS,
  ...FIXED_FX_CRYPTO,
  { sym: SPX_SYM, label: "SPX", wsKey: SPX_SYM },
];

// No equity-style symbols — all are futures/indices streamed directly via WS
const EQUITY_SYMS: typeof RISK_ASSETS = [];

// ── Types ────────────────────────────────────────────────────────────────────

interface LiveRec {
  lastPrice: number;
  prevClose: number;
  pctFeed:   number;
  bidPrice:  number;
  askPrice:  number;
  change:    number; // raw point change
}

interface QuoteRow {
  price:  number | null;
  change: number | null;
  pct:    number | null;
}

type QuoteMap = Record<string, QuoteRow>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number | null, decimals = 2): string {
  if (v == null || !isFinite(v) || v === 0) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtChg(v: number | null): string {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  const arrow = v >= 0 ? "▲" : "▼";
  return `${arrow}${Math.abs(v).toFixed(2)}%`;
}

function chgColor(v: number | null): string {
  if (v == null) return "#3a5570";
  return v >= 0 ? "#00e676" : "#ff4757";
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <tr>
      <td
        colSpan={4}
        style={{
          background: "#0c1825",
          color: "#00e5ff",
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          padding: "6px 10px",
          borderBottom: "1px solid #0d1e2e",
        }}
      >
        {title}
      </td>
    </tr>
  );
}

function QuoteRowEl({
  label,
  row,
  decimals = 2,
}: {
  label: string;
  row: QuoteRow | undefined;
  decimals?: number;
}) {
  const price  = row?.price  ?? null;
  const change = row?.change ?? null;
  const pct    = row?.pct    ?? null;
  const color  = chgColor(pct ?? change);

  return (
    <tr style={{ borderBottom: "1px solid #08111a" }}>
      <td style={{ padding: "6px 10px", color: "#c8d8e8", fontSize: 12, fontWeight: 500 }}>{label}</td>
      <td style={{ padding: "6px 10px", color: "#e8edf5", fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
        {fmt(price, decimals)}
      </td>
      <td style={{ padding: "6px 10px", color, fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
        {fmtChg(change)}
      </td>
      <td style={{ padding: "6px 10px", color, fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
        {fmtPct(pct)}
      </td>
    </tr>
  );
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid #0d1e2e" }}>
          <th style={{ padding: "5px 10px", color: "#3a5570", fontSize: 10, textAlign: "left", letterSpacing: ".08em", width: "40%" }}>INSTRUMENT</th>
          <th style={{ padding: "5px 10px", color: "#3a5570", fontSize: 10, textAlign: "right", letterSpacing: ".08em", width: "20%" }}>PRICE</th>
          <th style={{ padding: "5px 10px", color: "#3a5570", fontSize: 10, textAlign: "right", letterSpacing: ".08em", width: "20%" }}>CHANGE</th>
          <th style={{ padding: "5px 10px", color: "#3a5570", fontSize: 10, textAlign: "right", letterSpacing: ".08em", width: "20%" }}>%</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

// ── RV Sigma panel ───────────────────────────────────────────────────────────

interface SigmaRow {
  label: string;
  value: number | null;
}

function RVSigmaPanel({ spxPrice, spxPrev }: { spxPrice: number | null; spxPrev: number | null }) {
  const rows: SigmaRow[] = [];

  if (spxPrice && spxPrev) {
    const daily1Sigma = spxPrice * 0.01; // rough 1% daily sigma placeholder
    rows.push({ label: "Sigma Value",    value: daily1Sigma });
    rows.push({ label: "Fair Value",     value: spxPrice });
    rows.push({ label: "3 Sigma Up",     value: spxPrice + daily1Sigma * 3 });
    rows.push({ label: "2 Sigma Up",     value: spxPrice + daily1Sigma * 2 });
    rows.push({ label: "1 Sigma Up",     value: spxPrice + daily1Sigma });
    rows.push({ label: "Previous Close", value: spxPrev });
    rows.push({ label: "1 Sigma Dn",     value: spxPrice - daily1Sigma });
    rows.push({ label: "2 Sigma Dn",     value: spxPrice - daily1Sigma * 2 });
    rows.push({ label: "3 Sigma Dn",     value: spxPrice - daily1Sigma * 3 });
  } else {
    const labels = ["Sigma Value","Fair Value","3 Sigma Up","2 Sigma Up","1 Sigma Up","Previous Close","1 Sigma Dn","2 Sigma Dn","3 Sigma Dn"];
    labels.forEach(l => rows.push({ label: l, value: null }));
  }

  return (
    <div style={{ border: "1px solid #0d1e2e", borderRadius: 4, overflow: "hidden", background: "#060d15" }}>
      <div style={{ padding: "6px 10px", background: "#0c1825", borderBottom: "1px solid #0d1e2e", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: "#00e5ff", fontWeight: 700, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase" }}>Daily RV Sigma Levels</span>
        <div style={{ display: "flex", gap: 16 }}>
          <span style={{ color: "#3a5570", fontSize: 10, letterSpacing: ".06em" }}>SPX</span>
          <span style={{ color: "#3a5570", fontSize: 10, letterSpacing: ".06em" }}>ES EQUIV.</span>
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {rows.map(({ label, value }) => {
            const isClose = label === "Previous Close";
            const isUpLevel   = label.includes("Up");
            const isDnLevel   = label.includes("Dn");
            const labelColor  = isUpLevel ? "#00e676" : isDnLevel ? "#ff4757" : isClose ? "#ffb300" : "#c8d8e8";
            const valueStr    = value != null ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
            // ES equiv: SPX + ~50 spread (rough)
            const esEquiv     = value != null ? (value + 50).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—";
            return (
              <tr key={label} style={{ borderBottom: "1px solid #08111a" }}>
                <td style={{ padding: "5px 10px", fontSize: 11, color: labelColor, fontWeight: isClose ? 700 : 500 }}>{label}</td>
                <td style={{ padding: "5px 10px", fontSize: 11, color: "#e8edf5", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{valueStr}</td>
                <td style={{ padding: "5px 10px", fontSize: 11, color: "#7a9ab8", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{esEquiv}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Premarket Positioning table ──────────────────────────────────────────────

function PositioningPanel({ esRow, spxRow }: { esRow: QuoteRow | undefined; spxRow: QuoteRow | undefined }) {
  // Derive overnight sentiment from ES % change
  const esPct = esRow?.pct ?? null;
  let sentiment = "—";
  if (esPct != null) {
    if (esPct > 0.5) sentiment = "Bullish";
    else if (esPct < -0.5) sentiment = "Bearish";
    else sentiment = "Neutral / Mixed";
  }

  const esChg = esRow?.change ?? null;

  // Overnight range proxy
  const overnightRange = esChg != null ? Math.abs(esChg).toFixed(2) + " pts" : "—";

  return (
    <div style={{ border: "1px solid #0d1e2e", borderRadius: 4, overflow: "hidden", background: "#060d15" }}>
      <div style={{ padding: "6px 10px", background: "#0c1825", borderBottom: "1px solid #0d1e2e" }}>
        <span style={{ color: "#00e5ff", fontWeight: 700, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase" }}>Premarket Positioning</span>
      </div>
      <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px" }}>
        {/* Left col */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <div style={{ fontSize: 9, color: "#3a5570", letterSpacing: ".1em", marginBottom: 3 }}>EXPECTED OVERNIGHT ACTION</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: esPct == null ? "#3a5570" : esPct > 0 ? "#00e676" : esPct < 0 ? "#ff4757" : "#e8edf5" }}>
              {esPct == null ? "—" : esPct > 0 ? `Gap Up ~${esPct.toFixed(2)}%` : esPct < 0 ? `Gap Down ~${(esPct).toFixed(2)}%` : "Flat Open"}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 9, color: "#3a5570", letterSpacing: ".1em", marginBottom: 4 }}>INVENTORY</div>
            <div style={{ display: "grid", gridTemplateColumns: "80px 80px 80px", gap: 4, marginBottom: 4 }}>
              {["POSTURE","DELTA","VOLUME"].map(h => (
                <div key={h} style={{ fontSize: 9, color: "#2a4a6a", letterSpacing: ".06em" }}>{h}</div>
              ))}
            </div>
            {[["Overall","—","—","avg"],["Large (>5 lot)","—","—",""],["Small","—","—",""]].map(([name, posture, delta, vol]) => (
              <div key={name} style={{ display: "grid", gridTemplateColumns: "80px 80px 80px auto", gap: 4, marginBottom: 2 }}>
                <span style={{ fontSize: 11, color: "#7a9ab8" }}>{name}</span>
                <span style={{ fontSize: 11, color: "#3a5570" }}>{posture}</span>
                <span style={{ fontSize: 11, color: "#3a5570" }}>{delta}</span>
                <span style={{ fontSize: 11, color: "#3a5570" }}>{vol}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right col */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 9, color: "#3a5570", letterSpacing: ".1em", marginBottom: 3 }}>OVERNIGHT SENTIMENT</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: esPct == null ? "#3a5570" : esPct > 0 ? "#00e676" : esPct < 0 ? "#ff4757" : "#e8edf5" }}>
              {sentiment}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#3a5570", letterSpacing: ".1em", marginBottom: 3 }}>OVERNIGHT RANGE</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e8edf5", fontVariantNumeric: "tabular-nums" }}>
              {overnightRange}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#3a5570", letterSpacing: ".1em", marginBottom: 3 }}>PROFILE SHAPE</div>
            <div style={{ fontSize: 13, color: "#3a5570" }}>—</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function PremarketPage() {
  const wsLiveRef = useRef<Record<string, LiveRec>>({});
  const [quotes, setQuotes] = useState<QuoteMap>({});
  const [yahooQuotes, setYahooQuotes] = useState<QuoteMap>({});
  const [ts, setTs] = useState("");
  const [wsLive, setWsLive] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // ── DXLink WebSocket ────────────────────────────────────────────────────────
  useEffect(() => {
    function connect() {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      try {
        const ws = new WebSocket(
          (process.env.NEXT_PUBLIC_WS_URL ?? "wss://vanila-8zn1.onrender.com") + "/ws/dxlink"
        );
        wsRef.current = ws;

        ws.onopen = () => {
          setWsLive(true);
          ws.send(JSON.stringify({
            type: "FEED_SUBSCRIPTION",
            add: ALL_WS.flatMap(({ wsKey }) => [
              { type: "Quote",   symbol: wsKey },
              { type: "Trade",   symbol: wsKey },
              { type: "Summary", symbol: wsKey },
            ]),
          }));
        };

        ws.onclose = () => { setWsLive(false); wsRef.current = null; setTimeout(connect, 5000); };
        ws.onerror = () => ws.close();

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type !== "FEED_DATA") return;

            (msg.data as unknown[]).forEach((raw) => {
              const e = raw as Record<string, unknown>;
              const sym   = String(e.eventSymbol || "");
              const eType = String(e.eventType   || "");

              const found = ALL_WS.find(s => s.wsKey === sym);
              if (!found) return;

              const key = found.sym;
              if (!wsLiveRef.current[key]) {
                wsLiveRef.current[key] = { lastPrice: 0, prevClose: 0, pctFeed: 0, bidPrice: 0, askPrice: 0, change: 0 };
              }
              const rec = wsLiveRef.current[key];

              if (eType === "Quote") {
                if (e.bidPrice != null) rec.bidPrice = Number(e.bidPrice);
                if (e.askPrice != null) rec.askPrice = Number(e.askPrice);
                if (e.dayPercentChange != null && Number(e.dayPercentChange) !== 0) rec.pctFeed = Number(e.dayPercentChange);
              } else if (eType === "Trade") {
                if (e.price != null && Number(e.price) > 0) rec.lastPrice = Number(e.price);
                if (e.dayPercentChange != null && Number(e.dayPercentChange) !== 0) rec.pctFeed = Number(e.dayPercentChange);
                if (e.change != null) rec.change = Number(e.change);
              } else if (eType === "Summary") {
                const pc = Number(e.prevDayClosePrice ?? e.prevClose ?? e.previousClose ?? 0);
                if (pc > 0) rec.prevClose = pc;
                if (e.dayPercentChange != null && Number(e.dayPercentChange) !== 0) rec.pctFeed = Number(e.dayPercentChange);
              }
            });

            setQuotes(() => {
              const next: QuoteMap = {};
              ALL_WS.forEach(({ sym }) => {
                const rec = wsLiveRef.current[sym];
                if (!rec) return;

                const price = rec.lastPrice || (rec.bidPrice > 0 && rec.askPrice > 0 ? (rec.bidPrice + rec.askPrice) / 2 : 0);
                let pct: number | null = null;
                let change: number | null = null;

                if (rec.pctFeed !== 0 && Math.abs(rec.pctFeed) <= 50) {
                  pct = rec.pctFeed;
                } else if (price > 0 && rec.prevClose > 0 && Math.abs(price - rec.prevClose) / rec.prevClose < 0.30) {
                  pct = ((price - rec.prevClose) / rec.prevClose) * 100;
                }

                if (rec.change !== 0) {
                  change = rec.change;
                } else if (price > 0 && rec.prevClose > 0) {
                  change = price - rec.prevClose;
                }

                next[sym] = {
                  price:  price > 0 ? price : null,
                  change: change,
                  pct:    pct,
                };
              });
              return next;
            });

            const now = new Date();
            setTs(`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`);
          } catch (_) {}
        };
      } catch (_) {}
    }

    connect();

    // Seed prev closes from REST
    async function seedRest() {
      try {
        const syms = ALL_WS.map(s => s.sym).join(",");
        const r = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(syms)}`);
        if (!r.ok) return;
        const d = await r.json();
        const items: Array<Record<string, unknown>> = d?.data?.items || [];
        items.forEach(q => {
          const qsym = String(q.symbol || "");
          const found = ALL_WS.find(s => s.sym === qsym || s.wsKey === qsym);
          if (!found) return;
          const key = found.sym;
          const prev = Number(q["prev-close"] ?? 0);
          const last = Number(q.last ?? q.mark ?? 0);
          if (!wsLiveRef.current[key]) {
            wsLiveRef.current[key] = { lastPrice: 0, prevClose: 0, pctFeed: 0, bidPrice: 0, askPrice: 0, change: 0 };
          }
          if (prev > 0) wsLiveRef.current[key].prevClose = prev;
          if (last > 0 && wsLiveRef.current[key].lastPrice === 0) wsLiveRef.current[key].lastPrice = last;
        });
      } catch (_) {}
    }
    seedRest();

    // Subscribe equity symbols to proxy
    async function subscribeEquities() {
      try {
        await fetch(
          (process.env.NEXT_PUBLIC_PROXY_URL ?? "https://vanila-8zn1.onrender.com") +
            "/proxy/dxlink/subscribe",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbols: EQUITY_SYMS.map(s => s.sym),
              feedTypes: ["Quote", "Trade", "Summary"],
            }),
          }
        );
      } catch (_) {}
    }
    subscribeEquities();

    return () => wsRef.current?.close();
  }, []);

  // ── Yahoo Finance polling for Europe / Asia (60s interval) ─────────────────
  useEffect(() => {
    const syms = YAHOO_SYMS.map(s => s.sym).join(",");

    async function poll() {
      try {
        const r = await fetch(`/api/yahoo-quotes?symbols=${encodeURIComponent(syms)}`);
        if (!r.ok) return;
        const data: Record<string, { price: number | null; change: number | null; pct: number | null }> = await r.json();
        setYahooQuotes(data);
      } catch (_) {}
    }

    poll();
    const id = setInterval(poll, 60_000);
    return () => clearInterval(id);
  }, []);

  // Merge: Yahoo fills Europe/Asia; DXLink fills everything else
  const allQuotes: QuoteMap = { ...quotes };
  YAHOO_SYMS.forEach(({ sym }) => {
    if (yahooQuotes[sym]) allQuotes[sym] = yahooQuotes[sym];
  });

  const spxRow = quotes[SPX_SYM];
  const spxPrice = spxRow?.price ?? null;
  const spxPrev = wsLiveRef.current[SPX_SYM]?.prevClose ?? null;
  const esRow   = quotes["/ES:XCME"];

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        background: "#05080d",
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ color: "#00e5ff", fontSize: 13, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", margin: 0 }}>
            Premarket Positioning
          </h1>
          <span style={{ fontSize: 11, color: "#3a5570" }}>As of {dateStr} · 7:00 AM central</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 3,
              background: wsLive ? "#0c2a1e" : "#1a0a0a",
              color: wsLive ? "#00e676" : "#ff4757",
              letterSpacing: ".08em",
            }}
          >
            {wsLive ? "● LIVE" : "● CONNECTING"}
          </span>
          {ts && <span style={{ fontSize: 10, color: "#1e3050", fontVariantNumeric: "tabular-nums" }}>{ts}</span>}
        </div>
      </div>

      {/* ── Main grid ──────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, flex: 1, minHeight: 0 }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Premarket Positioning summary */}
          <PositioningPanel esRow={esRow} spxRow={spxRow} />

          {/* Global Markets – US Futures */}
          <div style={{ border: "1px solid #0d1e2e", borderRadius: 4, overflow: "hidden", background: "#060d15" }}>
            <div style={{ padding: "6px 10px", background: "#0c1825", borderBottom: "1px solid #0d1e2e" }}>
              <span style={{ color: "#00e5ff", fontWeight: 700, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase" }}>Global Markets</span>
            </div>
            <TableShell>
              <SectionHeader title="US Futures" />
              {US_FUTURES.map(({ sym, label }) => (
                <QuoteRowEl key={sym} label={label} row={allQuotes[sym]} />
              ))}
              <SectionHeader title="Europe" />
              {EUROPE.map(({ sym, label }) => (
                <QuoteRowEl key={sym} label={label} row={allQuotes[sym]} />
              ))}
              <SectionHeader title="Asia" />
              {ASIA.map(({ sym, label }) => (
                <QuoteRowEl key={sym} label={label} row={allQuotes[sym]} />
              ))}
            </TableShell>
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* RV Sigma */}
          <RVSigmaPanel spxPrice={spxPrice} spxPrev={spxPrev || null} />

          {/* Commodities, Risk Assets, Fixed Income / FX / Crypto */}
          <div style={{ border: "1px solid #0d1e2e", borderRadius: 4, overflow: "hidden", background: "#060d15" }}>
            <div style={{ padding: "6px 10px", background: "#0c1825", borderBottom: "1px solid #0d1e2e" }}>
              <span style={{ color: "#00e5ff", fontWeight: 700, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase" }}>Other Markets</span>
            </div>
            <TableShell>
              <SectionHeader title="Commodities" />
              {COMMODITIES.map(({ sym, label }) => (
                <QuoteRowEl key={sym} label={label} row={allQuotes[sym]} />
              ))}
              <SectionHeader title="Risk Assets" />
              {RISK_ASSETS.map(({ sym, label }) => (
                <QuoteRowEl key={sym} label={label} row={allQuotes[sym]} />
              ))}
              <SectionHeader title="Fixed Income / FX / Crypto" />
              {FIXED_FX_CRYPTO.map(({ sym, label }) => (
                <QuoteRowEl key={sym} label={label} row={allQuotes[sym]} />
              ))}
            </TableShell>
          </div>
        </div>
      </div>
    </div>
  );
}
