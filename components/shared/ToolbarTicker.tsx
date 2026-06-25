"use client";

import { useEffect, useRef, useState } from "react";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import NquQuotePill from "@/components/dashboard/NquQuotePill";

/**
 * ToolbarTicker — self-contained live VIX / ESU / SPX inline quotes for the
 * global toolbar, plus the NQU pill (which carries the 16-symbol dropdown).
 *
 * Data is sourced independently of any page: ESU/SPX/VIX come from the broker
 * dxLink feed over /ws/gex (esFut/esFutPrevClose, vix/vixPrevClose,
 * spot/prevClose), seeded once from /api/quotes-batch so values show before the
 * first socket frame. This mirrors the old standalone TopBar so the toolbar
 * works on every route without reading the home page's local WS state.
 */

const ES_FEED_SYMBOLS = ["/ESU26", "/ESU6"];
const NQ_FEED_SYMBOLS = ["/NQU26", "/NQ:XCME"];

const UP = "#1FD98A";
const DOWN = "#EF4444";
const MUTED = "#5a7a99";

interface Quote {
  price: number;
  prev: number;
}

function fmt(v: number, decimals = 2) {
  if (!v || !isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtEsQuarter(v: number) {
  if (!v || !isFinite(v)) return "—";
  const r = Math.round(v * 4) / 4;
  return r.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Returns null when the baseline is missing or implausibly far from price.
function chg(price: number, prev: number) {
  if (!price || !prev) return null;
  if (Math.abs(price - prev) / prev > 0.2) return null;
  const c = price - prev;
  const pct = (c / prev) * 100;
  const sign = c >= 0 ? "+" : "";
  return { text: `${sign}${c.toFixed(2)} (${sign}${pct.toFixed(2)}%)`, up: c >= 0 };
}

// One inline label + price (+ change) unit, styled to match the old home ticker.
function Pill({
  label,
  price,
  prev,
  color = "#fff",
  quarter = false,
}: {
  label: string;
  price: number;
  prev: number;
  color?: string;
  quarter?: boolean;
}) {
  const c = chg(price, prev);
  return (
    <span style={{ display: "flex", alignItems: "baseline", gap: 4, flexShrink: 0, whiteSpace: "nowrap" }}>
      <span style={{ fontSize: 15, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
        {label}
      </span>
      <span style={{ fontFamily: "monospace", fontSize: 23, fontWeight: 800, color }}>
        {price > 0 ? (quarter ? fmtEsQuarter(price) : fmt(price)) : "—"}
      </span>
      {c && (
        <span className="ticker-chg" style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 800, color: c.up ? UP : DOWN }}>
          {c.text}
        </span>
      )}
    </span>
  );
}

const Divider = () => (
  <span className="ticker-div" style={{ color: "rgba(255,255,255,0.18)", fontSize: 12, flexShrink: 0 }}>
    │
  </span>
);

export default function ToolbarTicker() {
  // Scale the whole ticker row as one unit so it shrinks/grows together
  // instead of individual pills squishing/clipping.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  useEffect(() => {
    const fit = () => {
      const wrap = wrapRef.current, row = rowRef.current;
      if (!wrap || !row) return;
      const avail = wrap.clientWidth;
      // Undo the current transform to recover the row's true natural width.
      const natural = row.getBoundingClientRect().width / (scaleRef.current || 1);
      const next = natural > 0 ? Math.max(0.85, Math.min(1, avail / natural)) : 1;
      if (Math.abs(next - scaleRef.current) > 0.005) {
        scaleRef.current = next;
        setScale(next);
      }
    };
    const ro = new ResizeObserver(fit);
    if (wrapRef.current) ro.observe(wrapRef.current);
    fit();
    // Re-fit shortly after mount once fonts/prices have laid out.
    const t = setTimeout(fit, 100);
    window.addEventListener("resize", fit);
    return () => { ro.disconnect(); clearTimeout(t); window.removeEventListener("resize", fit); };
  });

  const shouldConnect = useWsLifecycle();
  const shouldConnectRef = useRef(shouldConnect);
  shouldConnectRef.current = shouldConnect;

  const [es, setEs] = useState<Quote>({ price: 0, prev: 0 });
  const [spx, setSpx] = useState<Quote>({ price: 0, prev: 0 });
  const [vix, setVix] = useState<Quote>({ price: 0, prev: 0 });

  // Mutable live cache — avoids a render on every socket tick.
  const live = useRef({ esPrice: 0, esPrev: 0, spxPrice: 0, spxPrev: 0, vixPrice: 0, vixPrev: 0 });

  const push = () => {
    const L = live.current;
    const esP = L.esPrice > 0 ? Math.round(L.esPrice * 4) / 4 : 0;
    const esPv = L.esPrev > 0 ? Math.round(L.esPrev * 4) / 4 : 0;
    setEs({ price: esP, prev: esPv });
    // Expose live SPX so other pages can sync to the same number.
    if (typeof window !== "undefined") {
      if (!window.__gexAppState) window.__gexAppState = { chain: [], spotPrice: 0, esPrice: 0, expiration: "", gexFlip: null };
      if (L.spxPrice > 0) window.__gexAppState.spotPrice = L.spxPrice;
      window.__gexAppState.esPrice = esP;
    }
    setSpx({ price: L.spxPrice, prev: L.spxPrev });
    setVix({ price: L.vixPrice, prev: L.vixPrev });
  };

  // ── seed from quotes-batch once ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const symbols = ["SPX", "VIX", ...ES_FEED_SYMBOLS, ...NQ_FEED_SYMBOLS].join(",");
        const r = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(symbols)}`);
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const items: Array<Record<string, unknown>> = d?.data?.items || [];
        items.forEach((q) => {
          const sym = String(q.symbol || "").split(":")[0];
          const price = parseFloat(String(q.mark || q.last || 0));
          const prev = parseFloat(String(q["prev-close"] || q.prevClose || 0));
          if (sym === "SPX" || sym === "$SPX") {
            if (price > 0 && live.current.spxPrice === 0) live.current.spxPrice = price;
            if (prev > 0 && live.current.spxPrev === 0) live.current.spxPrev = prev;
          }
          // ESU baseline is owned by the /ws/gex broker feed — intentionally not
          // seeded from Yahoo here (mixing sources flashed a wrong day-change).
          if (sym === "VIX" || sym === "$VIX.X" || sym === "$VIX") {
            if (price > 0 && live.current.vixPrice === 0) live.current.vixPrice = price;
            if (prev > 0 && live.current.vixPrev === 0) live.current.vixPrev = prev;
          }
        });
        push();
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── live ESU / VIX / SPX from /ws/gex ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    let ws: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const applyAux = (a: Record<string, unknown>) => {
      const esFut = Number(a.esFut ?? 0);
      const esPrev = Number(a.esFutPrevClose ?? 0);
      const v = Number(a.vix ?? 0);
      const vPrev = Number(a.vixPrevClose ?? 0);
      if (esFut > 0) live.current.esPrice = esFut;
      if (esPrev > 0) live.current.esPrev = esPrev;
      if (v > 0) live.current.vixPrice = v;
      if (vPrev > 0) live.current.vixPrev = vPrev;
    };
    const applySpot = (s: Record<string, unknown>) => {
      const spot = Number(s.spot ?? 0);
      const prev = Number(s.prevClose ?? 0);
      if (spot > 0) live.current.spxPrice = spot;
      if (prev > 0) live.current.spxPrev = prev;
    };

    const connect = () => {
      if (closed || !shouldConnectRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      try { ws = new WebSocket(`${proto}//${window.location.host}/ws/gex`); }
      catch { schedule(); return; }

      ws.onmessage = (evt) => {
        try {
          const m = JSON.parse(String(evt.data));
          const d = m?.data ?? {};
          if (m?.type === "snapshot") { applyAux(d); applySpot(d); }
          else if (m?.type === "aux") applyAux(d);
          else if (m?.type === "spot") applySpot(d);
          else return;
          push();
        } catch { /* ignore */ }
      };
      ws.onerror = () => { try { ws?.close(); } catch { /* ignore */ } };
      ws.onclose = () => { if (!closed) schedule(); };
    };
    const schedule = () => {
      if (closed || !shouldConnectRef.current) return;
      if (reconnect) clearTimeout(reconnect);
      reconnect = setTimeout(connect, 2000);
    };

    if (shouldConnect) connect();
    return () => {
      closed = true;
      if (reconnect) clearTimeout(reconnect);
      if (ws) {
        ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => { try { ws?.close(); } catch { /* ignore */ } };
        else { ws.onopen = null; try { ws.close(); } catch { /* ignore */ } }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldConnect]);

  return (
    <div ref={wrapRef} style={{ width: "100%", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <div
        ref={rowRef}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          whiteSpace: "nowrap",
          flexShrink: 0,
          width: "max-content",
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        <Pill label="VIX" price={vix.price} prev={vix.prev} color="#e8c060" />
        <Divider />
        <Pill label="ESU" price={es.price} prev={es.prev} quarter />
        <Divider />
        <Pill label="SPX" price={spx.price} prev={spx.prev} />
        <Divider />
        {/* NQU pill + 16-symbol "all quotes" dropdown */}
        <NquQuotePill />
      </div>
    </div>
  );
}
