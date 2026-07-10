"use client";

// WhaleOrdersPanel — the home "Whale" tab. This is the /flow page's
// "0–7DTE ≥$500K OTM" Combined preset, rendered as JUST the order list (no
// net-premium chart, no filter UI). Same data path as the /flow Combined tape:
//   • persisted day tape via /proxy/flow-history (all tickers, ≥$500K floor)
//   • live multi-ticker prints via the shared /ws/gex `flow` message
// merged + deduped, then locked to the preset: OTM only, premium ≥ $500K,
// 0–7 DTE. Newest print first.

import { useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import type { FlowOrder } from "@/hooks/useSpxFlow";

const C = HOME_THEME;
const BULLISH = "#22c55e"; // buy calls / sell puts
const BEARISH = C.red;     // sell calls / buy puts

// ── Whale preset (matches app/flow/page.tsx applyBigOtmPreset) ──
const PREMIUM_FLOOR = 500_000;
const DTE_MIN = 0;
const DTE_MAX = 7;
const MAX_ROWS = 300;

// Streamer roots carry suffixes chips don't (SPX streams as "SPXW", etc.).
const ROOT_TO_TICKER: Record<string, string> = { SPXW: "SPX", NDXP: "NDX", RUTW: "RUT", XSPW: "XSP" };
function normTicker(u: string | null | undefined): string {
  const up = (u ?? "").toUpperCase();
  return ROOT_TO_TICKER[up] ?? up;
}

function dteOf(o: FlowOrder): number | null {
  if (!o.expiration) return null;
  const exp = new Date(`${o.expiration}T00:00:00`);
  if (Number.isNaN(exp.getTime())) return null;
  const now = new Date();
  return Math.round((exp.getTime() - new Date(now.toDateString()).getTime()) / 86_400_000);
}

function fmtPremium(val: number): string {
  const a = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}
function isBullish(side: string, type: string): boolean {
  const buy = side === "buy", call = type === "C";
  return (buy && call) || (!buy && !call);
}

function todayYmdET(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

const GRID = "70px 52px 46px 34px 66px 60px 58px 92px 78px 66px";

export default function WhaleOrdersPanel() {
  const shouldConnect = useWsLifecycle();
  const [history, setHistory] = useState<FlowOrder[]>([]);
  const [orders, setOrders] = useState<FlowOrder[]>([]);
  const [status, setStatus] = useState<"LIVE" | "RECONNECTING" | "WAITING">("WAITING");
  const date = todayYmdET();

  // ── Persisted day tape (all tickers, ≥$500K pushed to the server so its 20k
  // cap keeps the biggest prints across the whole session). Polled every 15s. ──
  useEffect(() => {
    if (!shouldConnect) return;
    let cancelled = false;
    const load = () =>
      fetch(`/proxy/flow-history?limit=20000&date=${date}&minPremium=${PREMIUM_FLOOR}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (!cancelled && j && Array.isArray(j.tape)) setHistory(j.tape as FlowOrder[]); })
        .catch(() => {});
    const kick = setTimeout(load, 300);
    const id = setInterval(load, 15_000);
    return () => { cancelled = true; clearTimeout(kick); clearInterval(id); };
  }, [date, shouldConnect]);

  // ── Live multi-ticker prints off the shared /ws/gex `flow` message. ──
  const unmountedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldConnectRef = useRef(shouldConnect);
  shouldConnectRef.current = shouldConnect;

  useEffect(() => {
    unmountedRef.current = false;

    const handleMessage = (raw: string) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw); } catch { return; }
      if (String(msg.type ?? "") !== "flow") return;
      const data = (msg.data && typeof msg.data === "object" ? msg.data : msg) as Record<string, unknown>;
      const tape = data.tape as FlowOrder[] | undefined;
      if (Array.isArray(tape)) setOrders(tape);
    };

    const scheduleReconnect = () => {
      if (unmountedRef.current || !shouldConnectRef.current) return;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(connect, 2000);
    };

    function connect() {
      if (unmountedRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      let ws: WebSocket;
      try { ws = new WebSocket(`${proto}//${window.location.host}/ws/gex`); } catch { scheduleReconnect(); return; }
      wsRef.current = ws;
      ws.onopen = () => setStatus("LIVE");
      ws.onmessage = (evt) => handleMessage(String(evt.data));
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onclose = () => { setStatus("RECONNECTING"); scheduleReconnect(); };
    }

    if (shouldConnect) connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(); } catch {} }
    };
  }, [shouldConnect]);

  // ── Merge persisted ∪ live, dedup by coalescing key (live wins), preset filter. ──
  const rows = useMemo(() => {
    const byKey = new Map<string, FlowOrder>();
    for (const o of history) byKey.set(`${o.ts}|${o.symbol}|${o.side}`, o);
    for (const o of orders) byKey.set(`${o.ts}|${o.symbol}|${o.side}`, o);
    const merged = [...byKey.values()].filter((o) => {
      if (!o.isOtm) return false;
      if (Number(o.premium || 0) < PREMIUM_FLOOR) return false;
      const d = dteOf(o);
      if (d == null || d < DTE_MIN || d > DTE_MAX) return false;
      return true;
    });
    merged.sort((a, b) => b.ts - a.ts); // newest first
    return merged;
  }, [history, orders]);

  // ── Live spot per ticker for the % OTM column. Sourced from Theta /proxy/quotes
  //    (Yahoo /api/quotes-batch fallback), polled every 15s, so % OTM reflects the
  //    LIVE underlying — not FlowOrder.spot, which is frozen at print time. ──
  const [spotByTicker, setSpotByTicker] = useState<Record<string, number>>({});
  const tickerKey = useMemo(() => {
    const set = new Set<string>();
    for (const o of rows) { const t = normTicker(o.underlying); if (t) set.add(t); }
    return [...set].sort().join(",");
  }, [rows]);
  useEffect(() => {
    if (!shouldConnect || !tickerKey) return;
    let cancelled = false;
    const apply = (map: Record<string, number>) => {
      if (!cancelled && Object.keys(map).length) setSpotByTicker((prev) => ({ ...prev, ...map }));
    };
    const parse = (items: Array<Record<string, unknown>>) => {
      const map: Record<string, number> = {};
      for (const q of items) {
        const last = Number(q.last);
        const sym = String(q.symbol ?? "").toUpperCase();
        if (sym && last > 0) map[sym] = last;
      }
      return map;
    };
    const load = async () => {
      try {
        const r = await fetch(`/proxy/quotes?symbols=${encodeURIComponent(tickerKey)}`);
        if (!r.ok) throw new Error("proxy/quotes failed");
        const d = await r.json();
        apply(parse(d?.data?.items ?? []));
      } catch {
        try {
          const r = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(tickerKey)}`);
          if (!r.ok) return;
          const d = await r.json();
          apply(parse(d?.data?.items ?? []));
        } catch { /* leave prior spots in place */ }
      }
    };
    const kick = setTimeout(load, 200);
    const id = setInterval(load, 15_000);
    return () => { cancelled = true; clearTimeout(kick); clearInterval(id); };
  }, [tickerKey, shouldConnect]);

  const totals = useMemo(() => {
    let prem = 0, callPrem = 0, putPrem = 0;
    for (const o of rows) {
      const p = o.premium || 0;
      prem += p;
      if (o.type === "C") callPrem += p; else putPrem += p;
    }
    return { count: rows.length, prem, callPrem, putPrem };
  }, [rows]);

  const visible = rows.slice(0, MAX_ROWS);

  const headerCell: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted,
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* ── Summary header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px", flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.text }}>Whale Flow</span>
          <span style={{ fontSize: 10, color: C.muted }}>0–7 DTE · ≥$500K · OTM</span>
          <span style={{ fontSize: 11, color: C.muted }}><strong style={{ color: C.text }}>{totals.count.toLocaleString()}</strong> orders</span>
          <span style={{ fontSize: 11, color: C.muted }}>Calls <strong style={{ color: BULLISH }}>{fmtPremium(totals.callPrem)}</strong></span>
          <span style={{ fontSize: 11, color: C.muted }}>Puts <strong style={{ color: BEARISH }}>{fmtPremium(totals.putPrem)}</strong></span>
        </div>
        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", padding: "2px 8px", borderRadius: 4, background: status === "LIVE" ? "rgba(142,202,230,0.14)" : "rgba(239,68,68,0.12)", color: status === "LIVE" ? C.cyan : C.red }}>
          {status}
        </span>
      </div>

      {/* ── Column headers ── */}
      <div style={{ overflowX: "auto", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ minWidth: 690 }}>
          <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 6, padding: "6px 10px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: "rgba(10,13,20,0.96)", zIndex: 1 }}>
            <span style={headerCell}>Time</span>
            <span style={headerCell}>Ticker</span>
            <span style={headerCell}>Side</span>
            <span style={{ ...headerCell, textAlign: "center" }}>Type</span>
            <span style={{ ...headerCell, textAlign: "right" }}>Strike</span>
            <span style={{ ...headerCell, textAlign: "right" }}>% OTM</span>
            <span style={{ ...headerCell, textAlign: "right" }}>Size</span>
            <span style={{ ...headerCell, textAlign: "right" }}>Premium</span>
            <span style={{ ...headerCell, textAlign: "right" }}>Expiry</span>
            <span style={{ ...headerCell, textAlign: "center" }}>Bias</span>
          </div>

          {/* ── Rows ── */}
          {visible.length === 0 ? (
            <p style={{ fontSize: 12, padding: 20, color: C.muted }}>
              {status === "LIVE" ? "No whale prints yet today (0–7 DTE, ≥$500K, OTM)." : "Connecting to feed…"}
            </p>
          ) : (
            visible.map((o, i) => {
              const sideColor = o.side === "buy" ? BULLISH : BEARISH;
              const bull = isBullish(o.side, o.type);
              const d = dteOf(o);
              // Live moneyness: prefer the polled live spot, fall back to the
              // print-time spot until quotes load. + = OTM, − = now ITM.
              const liveSpot = spotByTicker[normTicker(o.underlying)] ?? o.spot ?? 0;
              const otmPct = liveSpot > 0 && o.strike
                ? ((o.type === "C" ? o.strike - liveSpot : liveSpot - o.strike) / liveSpot) * 100
                : null;
              return (
                <div key={`${o.ts}-${o.symbol}-${i}`} style={{ display: "grid", gridTemplateColumns: GRID, gap: 6, padding: "6px 10px", borderBottom: `1px solid ${C.border}`, fontSize: 12, fontFamily: "var(--font-mono)", alignItems: "center" }}>
                  <span style={{ color: C.muted }}>{fmtTime(o.ts)}</span>
                  <span style={{ color: C.cyan, fontWeight: 700 }}>{normTicker(o.underlying)}</span>
                  <span style={{ color: sideColor, fontWeight: 700 }}>{o.side.toUpperCase()}</span>
                  <span style={{ textAlign: "center", color: sideColor, fontWeight: 700 }}>{o.type}</span>
                  <span style={{ textAlign: "right", color: C.text }}>{o.strike.toLocaleString()}</span>
                  <span
                    style={{ textAlign: "right", fontWeight: 700, color: otmPct == null ? C.muted : otmPct >= 0 ? C.cyan : BEARISH }}
                    title={liveSpot > 0 ? `Strike ${o.strike} vs live spot ${liveSpot.toFixed(2)} — ${otmPct != null && otmPct < 0 ? "now ITM" : "OTM"}` : "No live spot yet"}
                  >
                    {otmPct == null ? "—" : `${otmPct.toFixed(1)}%`}
                  </span>
                  <span style={{ textAlign: "right", color: C.text }} title={o.fills && o.fills > 1 ? `${o.fills} fills aggregated` : undefined}>
                    {o.size.toLocaleString()}{o.fills && o.fills > 1 ? <span style={{ color: C.muted, fontSize: 10 }}> ×{o.fills}</span> : null}
                  </span>
                  <span style={{ textAlign: "right", color: sideColor, fontWeight: 700 }}>{fmtPremium(o.premium)}</span>
                  <span style={{ textAlign: "right", color: C.muted }}>{o.expiration ?? "—"}{d != null ? <span style={{ color: "rgba(255,255,255,0.35)" }}> · {d}d</span> : null}</span>
                  <span style={{ textAlign: "center", fontWeight: 800, color: bull ? BULLISH : BEARISH }}>{bull ? "▲" : "▼"}</span>
                </div>
              );
            })
          )}
          {rows.length > MAX_ROWS && (
            <p style={{ fontSize: 11, padding: "8px 10px", color: C.muted, textAlign: "center" }}>
              Showing newest {MAX_ROWS} of {rows.length.toLocaleString()} whale prints.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
