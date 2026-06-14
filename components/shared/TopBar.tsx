"use client";

import { useEffect, useRef, useState } from "react";
import SnapButton from "./SnapButton";

// ─── types ───────────────────────────────────────────────────────────────────
interface QuoteData {
  price: number;
  changeBaseline: number; // what to compare against for the +/- display
}

interface GexRow2 {
  mvcOI: string;
  mvcVol: string;
  gexFlip: string;
  peaks: string[];
}

interface TodayCloses {
  es: number;
  spx: number;
  date: string; // ET date yyyy-mm-dd
}

const TOPBAR_ROW1_PADDING = "9px 14px";
const TOPBAR_ROW2_PADDING = "6px 14px";
const TOPBAR_PILL_PADDING = "6px 12px";
const TOPBAR_LABEL_SIZE = 10;
const TOPBAR_VALUE_SIZE = 16;
const TOPBAR_CHANGE_SIZE = 12;

// ─── helpers ─────────────────────────────────────────────────────────────────
function fmt(v: number, decimals = 2) {
  if (!v || !isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtChg(price: number, baseline: number) {
  if (!price || !baseline) return null;
  // Sanity check: baseline must be within 20% of price to be valid
  if (Math.abs(price - baseline) / baseline > 0.20) return null;
  const chg = price - baseline;
  const pct = (chg / baseline) * 100;
  const sign = chg >= 0 ? "+" : "";
  return { text: `${sign}${chg.toFixed(2)} (${sign}${pct.toFixed(2)}%)`, up: chg >= 0 };
}

function etNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function etDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function etClock() {
  const d = etNow();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function etSession() {
  const d = etNow();
  const mins = d.getHours() * 60 + d.getMinutes();
  if (mins >= 570 && mins < 960) return "RTH";   // 9:30 – 16:00
  if (mins >= 960 && mins < 1020) return "AH";   // 16:00 – 17:00
  return "EXTH";
}

// 9:30am–4:00pm ET
function isRTH() {
  const d = etNow();
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= 570 && mins < 960;
}

// ~4:00pm window (16:00–16:02) — capture today's closes
function isCloseCapture() {
  const d = etNow();
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= 960 && mins < 962;
}

function loadTodayCloses(): TodayCloses | null {
  try {
    const raw = localStorage.getItem("todayCloses");
    if (!raw) return null;
    const parsed: TodayCloses = JSON.parse(raw);
    // Clear if stale — must match today's ET date
    const today = etDateStr(etNow());
    if (parsed.date !== today) {
      localStorage.removeItem("todayCloses");
      return null;
    }
    return parsed;
  } catch (_) { return null; }
}

function saveTodayCloses(es: number, spx: number) {
  try {
    localStorage.setItem("todayCloses", JSON.stringify({
      es, spx, date: etDateStr(etNow()),
    }));
  } catch (_) {}
}

// ─── component ───────────────────────────────────────────────────────────────
export default function TopBar() {
  const [clock, setClock] = useState("—");
  const [session, setSession] = useState("ET");
  const [ddOpen, setDdOpen] = useState(false);
  const [ttLive, setTtLive] = useState(false);

  const [es, setEs] = useState<QuoteData>({ price: 0, changeBaseline: 0 });
  const [spx, setSpx] = useState<QuoteData>({ price: 0, changeBaseline: 0 });
  const [vix, setVix] = useState<QuoteData>({ price: 0, changeBaseline: 0 });

  const [row2, setRow2] = useState<GexRow2>({ mvcOI: "—", mvcVol: "—", gexFlip: "--", peaks: [] });

  const wsRef = useRef<WebSocket | null>(null);

  // mutable live data — not state, avoids render on every tick
  const live = useRef({
    esPrice:    0,   // from Trade or Quote mid
    spxPrice:   0,   // from Trade or Quote mid — live RTH only
    vixPrice:   0,
    esPrev:     0,   // Summary prevDayClosePrice
    spxPrev:    0,
    vixPrev:    0,
  });

  // persisted close references
  const closesRef = useRef<{ es: number; spx: number }>({ es: 0, spx: 0 });

  // ── clock ──
  useEffect(() => {
    const tick = () => { setClock(etClock()); setSession(etSession()); };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── seed prev-closes from batch quotes on mount ──
  useEffect(() => {
    async function seed() {
      try {
        // Try sessionStorage first (set by vanilla app)
        const cached = JSON.parse(sessionStorage.getItem("prevCloses_v3") || "null");
        if (cached?.es > 0 && cached?.spx > 0) {
          live.current.esPrev  = cached.es;
          live.current.spxPrev = cached.spx;
          live.current.vixPrev = cached.vix || 0;
        }

        // Also try todayCloses for after-hours baseline
        const tc = loadTodayCloses();
        if (tc) closesRef.current = { es: tc.es, spx: tc.spx };

        // Fetch quotes-batch to get mark prices + prev-close
        const r = await fetch("/api/quotes-batch");
        if (!r.ok) return;
        const d = await r.json();
        const items: Array<Record<string, unknown>> = d?.data?.items || [];
        items.forEach((q) => {
          const sym = String(q.symbol || "").split(":")[0];
          // prefer mark (TT key), fallback to last
          const price = parseFloat(String(q.mark || q.last || 0));
          const prev  = parseFloat(String(q["prev-close"] || q.prevClose || 0));
          if (sym === "SPX" || sym === "$SPX") {
            if (price > 0 && live.current.spxPrice === 0) live.current.spxPrice = price;
            if (prev  > 0 && live.current.spxPrev  === 0) live.current.spxPrev  = prev;
          }
          if (sym.startsWith("/ES")) {
            if (price > 0 && live.current.esPrice === 0) live.current.esPrice = price;
            if (prev  > 0 && live.current.esPrev  === 0) live.current.esPrev  = prev;
          }
          if (sym === "VIX" || sym === "$VIX.X" || sym === "$VIX") {
            if (price > 0 && live.current.vixPrice === 0) live.current.vixPrice = price;
            if (prev  > 0 && live.current.vixPrev  === 0) live.current.vixPrev  = prev;
          }
        });
        pushPrices();
      } catch (_) {}
    }
    seed();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── WS dxlink ──
  useEffect(() => {
    const SYMS = ["/ES:XCME", "SPX", "VIX"];

    function connect() {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      try {
        const ws = new WebSocket((process.env.NEXT_PUBLIC_WS_URL ?? "wss://vanila-8zn1.onrender.com") + "/ws/dxlink");

        wsRef.current = ws;

        ws.onopen = () => {
          setTtLive(true);
          ws.send(JSON.stringify({
            type: "FEED_SUBSCRIPTION",
            add: SYMS.flatMap((sym) => [
              { type: "Trade",   symbol: sym },
              { type: "Quote",   symbol: sym },
              { type: "Summary", symbol: sym },
            ]),
          }));
        };

        ws.onclose = () => { setTtLive(false); wsRef.current = null; setTimeout(connect, 5000); };
        ws.onerror = () => ws.close();

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type !== "FEED_DATA") return;
            (msg.data as unknown[]).forEach((raw) => {
              const e = raw as Record<string, unknown>;
              const sym   = String(e.eventSymbol || "");
              const eType = String(e.eventType   || "");
              const n = (k: string) => {
                const v = Number(e[k]);
                return isFinite(v) && v > 0 ? v : 0;
              };

              if (sym === "/ES:XCME") {
                if (eType === "Trade"   && n("price"))               live.current.esPrice = n("price");
                if (eType === "Quote"   && n("bidPrice") && n("askPrice"))
                  live.current.esPrice = (n("bidPrice") + n("askPrice")) / 2;
                if (eType === "Summary" && n("prevDayClosePrice"))   live.current.esPrev  = n("prevDayClosePrice");
              }
              if (sym === "SPX") {
                if (eType === "Trade"   && n("price"))               live.current.spxPrice = n("price");
                if (eType === "Quote"   && n("bidPrice") && n("askPrice"))
                  live.current.spxPrice = (n("bidPrice") + n("askPrice")) / 2;
                if (eType === "Summary" && n("prevDayClosePrice"))   live.current.spxPrev  = n("prevDayClosePrice");
              }
              if (sym === "VIX") {
                if (eType === "Trade"   && n("price"))               live.current.vixPrice = n("price");
                if (eType === "Quote"   && n("bidPrice") && n("askPrice"))
                  live.current.vixPrice = (n("bidPrice") + n("askPrice")) / 2;
                if (eType === "Summary" && n("prevDayClosePrice"))   live.current.vixPrev  = n("prevDayClosePrice");
              }

              // Capture today's closes at 4pm window
              if (isCloseCapture()) {
                const esNow  = live.current.esPrice;
                const spxNow = live.current.spxPrice;
                if (esNow > 0 && spxNow > 0) {
                  saveTodayCloses(esNow, spxNow);
                  closesRef.current = { es: esNow, spx: spxNow };
                }
              }
            });
            pushPrices();
          } catch (_) {}
        };
      } catch (_) {}
    }

    connect();
    return () => wsRef.current?.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pushPrices() {
    const L = live.current;
    const C = closesRef.current;

    // ── ES ──
    const esPrice = L.esPrice;
    const esPrev  = L.esPrev || 0;
    setEs({ price: esPrice, changeBaseline: esPrev });

    // Keep esPrice available for SnapButton
    if (typeof window !== "undefined" && window.__gexAppState) {
      window.__gexAppState.esPrice = esPrice;
    }

    // ── SPX ──
    // RTH: use live $SPX quote directly, baseline = prev-close
    // After hours: implied from ES using spread, baseline = today's SPX close
    let spxDisplay  = 0;
    let spxBaseline = 0;

    if (isRTH()) {
      spxDisplay  = L.spxPrice;
      spxBaseline = L.spxPrev || 0;
    } else {
      // After hours — convert ES to implied SPX
      const esClose  = C.es  || esPrev;            // today's 4pm ES close (or prev-close fallback)
      const spxClose = C.spx || L.spxPrev || 0;   // today's 4pm SPX close
      if (esPrice > 0 && esClose > 0 && spxClose > 0) {
        const spread = esClose - spxClose;
        spxDisplay  = esPrice - spread;
        spxBaseline = spxClose; // change vs today's close after hours
      } else if (L.spxPrice > 0) {
        // fallback: last known SPX price
        spxDisplay  = L.spxPrice;
        spxBaseline = L.spxPrev || 0;
      }
    }
    setSpx({ price: spxDisplay, changeBaseline: spxBaseline });

    // ── VIX ──
    setVix({ price: L.vixPrice, changeBaseline: L.vixPrev });
  }

  // ── Row 2: GEX live via SSE ──
  useEffect(() => {
    const es = new EventSource("/api/insights/gex/stream");

    es.onmessage = (evt) => {
      try {
        const d = JSON.parse(evt.data);
        const data = d?.data || d;
        const netGex   = data?.netGex      ?? data?.totalNetGEX;
        const flip     = data?.gammaFlip   ?? data?.gammaZero ?? data?.gexFlip;
        const callWall = data?.callWall;
        const mvcStr   = data?.mvcStrike   ?? data?.mvc?.strike;
        setRow2({
          mvcOI:   mvcStr   ? String(mvcStr) : "—",
          mvcVol:  netGex   != null ? (netGex / 1e9).toFixed(2) + "B" : "—",
          gexFlip: flip     ? Number(flip).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "--",
          peaks:   callWall ? [String(callWall)] : [],
        });
      } catch (_) {}
    };

    es.onerror = () => { es.close(); };
    return () => es.close();
  }, []);

  // ── close dropdown on outside click ──
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("#topbar-dd-root")) setDdOpen(false);
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, []);

  const esChg  = fmtChg(es.price,  es.changeBaseline);
  const spxChg = fmtChg(spx.price, spx.changeBaseline);
  const vixChg = fmtChg(vix.price, vix.changeBaseline);

  return (
    <div
      style={{
        flexDirection: "column",
        height: "auto",
        padding: 0,
        position: "relative",
        zIndex: 1000,
        background: "linear-gradient(180deg,#0f1622 0%,#0a0f16 100%)",
        boxShadow: "inset 0 -1px 0 #1e3050",
        flexShrink: 0,
        display: "flex",
      }}
    >
      {/* ── ROW 1 ── */}
      <div
        className="topbar-row1"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          padding: TOPBAR_ROW1_PADDING,
          width: "100%",
          boxSizing: "border-box",
          borderBottom: "1px solid #0d1825",
          minWidth: 0,
        }}
      >
        {/* Logo */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 7, background: "rgba(0,229,255,.08)", border: "1px solid rgba(0,229,255,.25)", color: "#00e5ff", fontSize: 12, fontWeight: 700 }}>
            SPX
          </span>
          <span style={{ color: "#5a7a99", fontSize: 18 }}>/</span>
          <span style={{ color: "#e8edf5", fontSize: 18 }}>GEX</span>
        </div>

        {/* Clock + VIX */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, padding: TOPBAR_PILL_PADDING, border: "1px solid #1e3050", borderRadius: 999, background: "rgba(7,16,27,.8)" }}>
          <span suppressHydrationWarning style={{ fontSize: TOPBAR_VALUE_SIZE, fontWeight: 700, color: "#e8edf5", fontVariantNumeric: "tabular-nums", letterSpacing: ".05em", minWidth: 96, display: "inline-block" }}>
            {clock}
          </span>
          <span style={{ fontSize: TOPBAR_LABEL_SIZE, color: "#5a7a99", letterSpacing: ".14em", textTransform: "uppercase", minWidth: 34 }}>
            {session}
          </span>
          <span style={{ color: "#1e3050" }}>|</span>
          <span style={{ fontSize: TOPBAR_LABEL_SIZE, color: "#3a5570", letterSpacing: ".14em", textTransform: "uppercase" }}>VIX</span>
          <span style={{ fontSize: TOPBAR_VALUE_SIZE, fontWeight: 700, color: "#e8c060", fontVariantNumeric: "tabular-nums" }}>
            {vix.price > 0 ? fmt(vix.price) : "—"}
          </span>
          {vixChg && <span style={{ fontSize: TOPBAR_CHANGE_SIZE, color: vixChg.up ? "#00e676" : "#ff4757" }}>{vixChg.text}</span>}
        </div>

        {/* ES | SPX */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, padding: TOPBAR_PILL_PADDING, border: "1px solid #1e3050", borderRadius: 999, background: "rgba(7,16,27,.8)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span style={{ fontSize: TOPBAR_LABEL_SIZE, color: "#3a5570", letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 700 }}>ES</span>
            <span style={{ fontSize: TOPBAR_VALUE_SIZE, fontWeight: 700, color: "#e8edf5", fontVariantNumeric: "tabular-nums" }}>
              {es.price > 0 ? fmt(es.price) : "—"}
            </span>
            {esChg && <span style={{ fontSize: TOPBAR_CHANGE_SIZE, fontWeight: 600, color: esChg.up ? "#00e676" : "#ff4757", fontVariantNumeric: "tabular-nums" }}>{esChg.text}</span>}
          </div>
          <span style={{ color: "#1e3050" }}>|</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span style={{ fontSize: TOPBAR_LABEL_SIZE, color: "#3a5570", letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 700 }}>SPX</span>
            <span style={{ fontSize: TOPBAR_VALUE_SIZE, fontWeight: 700, color: "#e8edf5", fontVariantNumeric: "tabular-nums" }}>
              {spx.price > 0 ? fmt(spx.price) : "—"}
            </span>
            {spxChg && <span style={{ fontSize: TOPBAR_CHANGE_SIZE, fontWeight: 600, color: spxChg.up ? "#00e676" : "#ff4757", fontVariantNumeric: "tabular-nums" }}>{spxChg.text}</span>}
          </div>
        </div>

        {/* Right: logo + actions + TT LIVE + dropdown */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <SnapButton mode="share" />
          <SnapButton mode="save" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bzilatrades-logo.png" alt="BzilaTrades" style={{ height: 42, width: "auto", objectFit: "contain" }} />
          <div id="topbar-dd-root" style={{ position: "relative" }}>
            <button
              onClick={(e) => { e.stopPropagation(); setDdOpen((v) => !v); }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 12, fontWeight: 700, letterSpacing: ".08em",
                padding: "5px 10px",
                border: `1px solid ${ttLive ? "rgba(255,179,0,.4)" : "#1e3050"}`,
                borderRadius: 3,
                background: "#07101b",
                color: ttLive ? "#ffb300" : "#5a7a99",
                cursor: "pointer", height: 34,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: ttLive ? "#ffb300" : "#3a5570", display: "inline-block", flexShrink: 0 }} />
              {ttLive ? "TT LIVE" : "TT"}
              <span style={{ fontSize: 16, lineHeight: 1, color: ttLive ? "rgba(255,179,0,.6)" : "#3a5570" }}>⋮</span>
            </button>
            {ddOpen && (
              <div style={{ position: "fixed", top: 46, right: 8, background: "#0a0f16", border: "1px solid #1a2a3a", borderRadius: 3, minWidth: 240, zIndex: 999999, boxShadow: "0 6px 20px rgba(0,0,0,.9)" }}>
                <div style={{ padding: "6px 10px", borderBottom: "1px solid #1a2a3a", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: ttLive ? "#00e676" : "#ff5252", display: "inline-block" }} />
                  <span style={{ fontSize: 11, color: ttLive ? "#00e676" : "#ff5252", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" }}>
                    {ttLive ? "TT Connected" : "TT Disconnected"}
                  </span>
                </div>
                <div style={{ padding: "6px 10px", fontSize: 10, color: "#3a5570", borderBottom: "1px solid #1a2a3a" }}>
                  Mode: {isRTH() ? "RTH (live SPX)" : "After-hours (ES implied)"}<br />
                  ES close: {closesRef.current.es > 0 ? fmt(closesRef.current.es) : "—"} &nbsp;|&nbsp; SPX close: {closesRef.current.spx > 0 ? fmt(closesRef.current.spx) : "—"}
                </div>
                <div style={{ padding: "6px 10px", fontSize: 10, color: "#3a5570" }}>
                  ES prev: {es.changeBaseline > 0 ? fmt(es.changeBaseline) : "—"} &nbsp;|&nbsp; SPX prev: {live.current.spxPrev > 0 ? fmt(live.current.spxPrev) : "—"}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── ROW 2 ── only rendered when there's content */}
      {row2.peaks.length > 0 && (
        <div className="topbar-row2" style={{ display: "flex", alignItems: "center", gap: 16, padding: TOPBAR_ROW2_PADDING, borderTop: "1px solid #0d1825", background: "rgba(5,10,16,.7)", flexShrink: 0 }}>
          <span style={{ fontSize: TOPBAR_LABEL_SIZE, color: "#ffb300", letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 700, flexShrink: 0 }}>Peak GEX</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {row2.peaks.map((p, i) => (
              <span key={i} style={{ fontSize: TOPBAR_LABEL_SIZE, color: "#fff", padding: "3px 8px", background: "#0a1628", border: "1px solid #1e3050", borderRadius: 2 }}>{p}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
