"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { usePageLoadStatus } from "@/lib/pageStatus";

// ── Symbol definitions ───────────────────────────────────────────────────────

// US Futures symbols
const US_FUTURES = [
  { sym: "/ES:XCME",  label: "S&P 500",      wsKey: "/ES:XCME",  yahooSym: "ES=F" },
  { sym: "/NQ:XCME",  label: "Nasdaq 100",   wsKey: "/NQ:XCME",  yahooSym: "NQ=F" },
  { sym: "/RTY:XCME", label: "Russell 2000", wsKey: "/RTY:XCME", yahooSym: "RTY=F" },
  { sym: "/YM:XCME",  label: "Dow Jones",    wsKey: "/YM:XCME",  yahooSym: "YM=F" },
];

const SPX_SYM = "SPX";
const ALL_WS = [
  ...US_FUTURES,
  { sym: SPX_SYM, label: "SPX", wsKey: SPX_SYM },
  { sym: "VIX",   label: "VIX", wsKey: "VIX" },
];

// Yahoo Finance (delayed ~15min) — everything else
const EUROPE = [
  { sym: "^GDAXI",    label: "German DAX" },
  { sym: "^STOXX50E", label: "Euro Stoxx 50" },
  { sym: "^STOXX",    label: "Euro Stoxx 600" },
  { sym: "^FCHI",     label: "CAC 40" },
  { sym: "^FTSE",     label: "FTSE 100" },
];

const ASIA = [
  { sym: "^N225",     label: "Nikkei 225" },
  { sym: "000001.SS", label: "SSE Comp" },
  { sym: "^HSI",      label: "Hang Seng" },
];

const COMMODITIES = [
  { sym: "CL=F",  label: "Crude Oil" },
  { sym: "HG=F",  label: "Copper" },
  { sym: "NG=F",  label: "Natural Gas" },
];

const RISK_ASSETS = [
  { sym: "GC=F",  label: "Gold" },
  { sym: "^VIX",  label: "VIX Futures" },
];

const FIXED_FX_CRYPTO = [
  { sym: "ZN=F",   label: "10Y" },
  { sym: "ZB=F",   label: "30Y" },
  { sym: "DX-Y.NYB", label: "USD" },
  { sym: "EURUSD=X", label: "EURO" },
  { sym: "JPY=X",    label: "YEN" },
  { sym: "GBPUSD=X", label: "POUND" },
  { sym: "BTC-USD",  label: "BITCOIN" },
];

const INDEX_YAHOO = [
  { sym: "^GSPC", wsKey: SPX_SYM },
  { sym: "^VIX",  wsKey: "VIX" },
];

const YAHOO_SYMS = [
  ...US_FUTURES.map(({ yahooSym }) => ({ sym: yahooSym })),
  ...INDEX_YAHOO,
  ...EUROPE, ...ASIA, ...COMMODITIES, ...RISK_ASSETS, ...FIXED_FX_CRYPTO,
];

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
  time?:  number | null;
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
  if (v == null) return "#ffffff";
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
          <th style={{ padding: "5px 10px", color: "#ffffff", fontSize: 10, textAlign: "left", letterSpacing: ".08em", width: "40%" }}>INSTRUMENT</th>
          <th style={{ padding: "5px 10px", color: "#ffffff", fontSize: 10, textAlign: "right", letterSpacing: ".08em", width: "20%" }}>PRICE</th>
          <th style={{ padding: "5px 10px", color: "#ffffff", fontSize: 10, textAlign: "right", letterSpacing: ".08em", width: "20%" }}>CHANGE</th>
          <th style={{ padding: "5px 10px", color: "#ffffff", fontSize: 10, textAlign: "right", letterSpacing: ".08em", width: "20%" }}>%</th>
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
    <div style={{ background: "#060d15" }}>
      <div style={{ padding: "3px 10px", display: "flex", justifyContent: "flex-end", gap: 16, borderBottom: "1px solid #0d1e2e" }}>
        <span style={{ color: "#ffffff", fontSize: 10, letterSpacing: ".06em" }}>SPX</span>
        <span style={{ color: "#ffffff", fontSize: 10, letterSpacing: ".06em" }}>ES EQUIV.</span>
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
                <td style={{ padding: "5px 10px", fontSize: 11, color: "#e8edf5", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{esEquiv}</td>
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
    <div style={{ background: "#060d15" }}>
      <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px" }}>
        {/* Left col */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <div style={{ fontSize: 9, color: "#ffffff", letterSpacing: ".1em", marginBottom: 3 }}>EXPECTED OVERNIGHT ACTION</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: esPct == null ? "#3a5570" : esPct > 0 ? "#00e676" : esPct < 0 ? "#ff4757" : "#e8edf5" }}>
              {esPct == null ? "—" : esPct > 0 ? `Gap Up ~${esPct.toFixed(2)}%` : esPct < 0 ? `Gap Down ~${(esPct).toFixed(2)}%` : "Flat Open"}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 9, color: "#ffffff", letterSpacing: ".1em", marginBottom: 4 }}>INVENTORY</div>
            <div style={{ display: "grid", gridTemplateColumns: "80px 80px 80px", gap: 4, marginBottom: 4 }}>
              {["POSTURE","DELTA","VOLUME"].map(h => (
                <div key={h} style={{ fontSize: 9, color: "#ffffff", letterSpacing: ".06em" }}>{h}</div>
              ))}
            </div>
            {[["Overall","—","—","avg"],["Large (>5 lot)","—","—",""],["Small","—","—",""]].map(([name, posture, delta, vol]) => (
              <div key={name} style={{ display: "grid", gridTemplateColumns: "80px 80px 80px auto", gap: 4, marginBottom: 2 }}>
                <span style={{ fontSize: 11, color: "#e8edf5" }}>{name}</span>
                <span style={{ fontSize: 11, color: "#ffffff" }}>{posture}</span>
                <span style={{ fontSize: 11, color: "#ffffff" }}>{delta}</span>
                <span style={{ fontSize: 11, color: "#ffffff" }}>{vol}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right col */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 9, color: "#ffffff", letterSpacing: ".1em", marginBottom: 3 }}>OVERNIGHT SENTIMENT</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: esPct == null ? "#3a5570" : esPct > 0 ? "#00e676" : esPct < 0 ? "#ff4757" : "#e8edf5" }}>
              {sentiment}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#ffffff", letterSpacing: ".1em", marginBottom: 3 }}>OVERNIGHT RANGE</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e8edf5", fontVariantNumeric: "tabular-nums" }}>
              {overnightRange}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#ffffff", letterSpacing: ".1em", marginBottom: 3 }}>PROFILE SHAPE</div>
            <div style={{ fontSize: 13, color: "#ffffff" }}>—</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function PremarketPage() {
  usePageLoadStatus({ pageKey: "premarket", pageLabel: "Premarket", path: "/premarket" });
  const [quotes, setQuotes] = useState<QuoteMap>({});
  const [yahooQuotes, setYahooQuotes] = useState<QuoteMap>({});
  const [yahooTs, setYahooTs] = useState("");
  const [ts, setTs] = useState("");
  const pageRef = useRef<HTMLDivElement>(null);


  // ── Yahoo Finance polling for Europe / Asia (60s interval) ─────────────────
  const pollYahoo = useCallback(async () => {
    const syms = YAHOO_SYMS.map(s => s.sym).join(",");
    try {
      const r = await fetch(`/api/yahoo-quotes?symbols=${encodeURIComponent(syms)}&_=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`Yahoo quotes failed: ${r.status}`);
      const data: QuoteMap = await r.json();
      setYahooQuotes(data);
      const latestYahooTime = Object.values(data).reduce((latest, row) => Math.max(latest, row?.time ?? 0), 0);
      const displayTime = latestYahooTime > 0 ? new Date(latestYahooTime * 1000) : new Date();
      setYahooTs(displayTime.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
    } catch (_) {
      throw _;
    }
  }, []);

  const { trigger, label: btnLabel, style: btnStyle } = useRefreshButton(pollYahoo);

  useEffect(() => {
    pollYahoo().catch(() => {});
    const id = setInterval(() => { pollYahoo().catch(() => {}); }, 60_000);
    return () => clearInterval(id);
  }, [pollYahoo]);

  // Merge: DXLink takes priority; Yahoo fills gaps
  const allQuotes: QuoteMap = { ...quotes };
  // Yahoo fallbacks for RTY/YM — only use if DXLink has no price
  US_FUTURES.forEach(({ yahooSym, wsKey }) => {
    if (yahooQuotes[yahooSym]?.price) allQuotes[wsKey] = yahooQuotes[yahooSym];
  });
  INDEX_YAHOO.forEach(({ sym, wsKey }) => {
    if (yahooQuotes[sym]?.price) allQuotes[wsKey] = yahooQuotes[sym];
  });
  // Yahoo is authoritative for Europe/Asia/commodities/etc
  [...EUROPE, ...ASIA, ...COMMODITIES, ...RISK_ASSETS, ...FIXED_FX_CRYPTO].forEach(({ sym }) => {
    if (yahooQuotes[sym]) allQuotes[sym] = yahooQuotes[sym];
  });

  const spxRow = allQuotes[SPX_SYM];
  const spxPrice = spxRow?.price ?? null;
  const spxPrev = spxPrice != null && spxRow?.change != null ? spxPrice - spxRow.change : null;
  const esRow   = allQuotes["/ES:XCME"];

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const asOf = yahooTs ? `${dateStr} - ${yahooTs} ET` : `${dateStr} - fetching Yahoo...`;

  return (
    <div
      ref={pageRef}
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
          <span style={{ fontSize: 11, color: "#ffffff" }}>As of {asOf}</span>
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
          {ts && <span style={{ fontSize: 10, color: "#ffffff", fontVariantNumeric: "tabular-nums" }}>{ts}</span>}
          <button onClick={trigger} style={{ ...btnStyle }}>{btnLabel}</button>
          <BoxSnapBtn targetRef={pageRef} label="📷" />
          <BoxDiscordBtn targetRef={pageRef} message={`📊 Premarket Positioning — ${new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false})} ET`} />
        </div>
      </div>

      {/* ── Main grid ──────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, flex: 1, minHeight: 0 }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Premarket Positioning summary */}
          <div style={{ border: "1px solid #0d1e2e", borderRadius: 4, overflow: "hidden", background: "#060d15" }}>
            <div style={{ padding: "6px 10px", background: "#0c1825", borderBottom: "1px solid #0d1e2e", display: "flex", alignItems: "center" }}>
              <span style={{ color: "#00e5ff", fontWeight: 700, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", flex: 1 }}>Premarket Positioning</span>
            </div>
            <PositioningPanel esRow={esRow} spxRow={spxRow} />
          </div>

          {/* Global Markets – US Futures */}
          <div style={{ border: "1px solid #0d1e2e", borderRadius: 4, overflow: "hidden", background: "#060d15" }}>
            <div style={{ padding: "6px 10px", background: "#0c1825", borderBottom: "1px solid #0d1e2e", display: "flex", alignItems: "center" }}>
              <span style={{ color: "#00e5ff", fontWeight: 700, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", flex: 1 }}>Global Markets</span>
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
          <div style={{ border: "1px solid #0d1e2e", borderRadius: 4, overflow: "hidden", background: "#060d15" }}>
            <div style={{ padding: "6px 10px", background: "#0c1825", borderBottom: "1px solid #0d1e2e", display: "flex", alignItems: "center" }}>
              <span style={{ color: "#00e5ff", fontWeight: 700, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", flex: 1 }}>Daily RV Sigma Levels</span>
            </div>
            <RVSigmaPanel spxPrice={spxPrice} spxPrev={spxPrev || null} />
          </div>

          {/* Commodities, Risk Assets, Fixed Income / FX / Crypto */}
          <div style={{ border: "1px solid #0d1e2e", borderRadius: 4, overflow: "hidden", background: "#060d15" }}>
            <div style={{ padding: "6px 10px", background: "#0c1825", borderBottom: "1px solid #0d1e2e", display: "flex", alignItems: "center" }}>
              <span style={{ color: "#00e5ff", fontWeight: 700, fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", flex: 1 }}>Other Markets</span>
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
