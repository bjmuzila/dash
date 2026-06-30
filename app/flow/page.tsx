"use client";

// ─────────────────────────────────────────────────────────────────────────────
// /flow — raw options-flow tape with heavy filtering.
//
// Fed by the server `flow` WS message on /ws/gex (same feed as FlowTape /
// SignalsPanel): each message carries the full capped tape (oldest-first) as
// data.tape: FlowOrder[]. Connection is gated by useWsLifecycle (bandwidth /
// idle / background pause) exactly like the home page.
//
// Theme: PageShell + Card + HOME_THEME only. No raw color literals.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { HOME_THEME, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import type { FlowOrder } from "@/hooks/useSpxFlow";

// ── Sentiment colors keyed off side+type (matches FlowTape semantics) ──────────
const C = HOME_THEME;
const BULLISH = C.green; // call buy / put sell
const BEARISH = C.red; //   put buy / call sell

function actionColor(o: FlowOrder): string {
  if (o.side === "buy") return o.type === "C" ? BULLISH : BEARISH;
  return o.type === "C" ? BEARISH : BULLISH; // sell
}

function fmtPremium(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function dteOf(o: FlowOrder): number | null {
  if (!o.expiration) return null;
  const exp = new Date(`${o.expiration}T00:00:00`);
  if (Number.isNaN(exp.getTime())) return null;
  const now = new Date();
  const days = Math.round((exp.getTime() - new Date(now.toDateString()).getTime()) / 86_400_000);
  return days;
}

// ── Filter state shape ─────────────────────────────────────────────────────────
type SideFilter = "all" | "buy" | "sell";
type TypeFilter = "all" | "C" | "P";

const PREMIUM_PRESETS = [0, 50_000, 100_000, 250_000, 500_000, 1_000_000] as const;

export default function FlowPage() {
  const shouldConnect = useWsLifecycle();
  const [orders, setOrders] = useState<FlowOrder[]>([]);
  const [status, setStatus] = useState<"LIVE" | "RECONNECTING" | "WAITING">("WAITING");

  // ── Filters ──
  const [ticker, setTicker] = useState("");
  const [side, setSide] = useState<SideFilter>("all");
  const [optType, setOptType] = useState<TypeFilter>("all");
  const [minPremium, setMinPremium] = useState<number>(0);
  const [minSize, setMinSize] = useState<number>(0);
  const [strikeMin, setStrikeMin] = useState<string>("");
  const [strikeMax, setStrikeMax] = useState<string>("");
  const [expiry, setExpiry] = useState<string>("all");
  const [maxDte, setMaxDte] = useState<string>("");
  const [otmOnly, setOtmOnly] = useState(false);

  // ── WS: mirror the home-page /ws/gex pattern, but only keep the flow tape. ──
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

    const connect = () => {
      if (unmountedRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/ws/gex`;
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch { scheduleReconnect(); return; }
      wsRef.current = ws;
      ws.onopen = () => setStatus("LIVE");
      ws.onmessage = (evt) => handleMessage(String(evt.data));
      ws.onerror = () => { try { ws.close(); } catch {} };
      ws.onclose = () => { setStatus("RECONNECTING"); scheduleReconnect(); };
    };

    if (shouldConnect) connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => { try { ws.close(); } catch {} };
        else { ws.onopen = null; try { ws.close(); } catch {} }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldConnect]);

  // ── Distinct values for the dropdowns, derived from live data. ──
  const expiryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) if (o.expiration) set.add(o.expiration);
    return [...set].sort();
  }, [orders]);

  // ── Apply filters (newest-first). ──
  const filtered = useMemo(() => {
    const tkr = ticker.trim().toUpperCase();
    const sMin = strikeMin === "" ? null : Number(strikeMin);
    const sMax = strikeMax === "" ? null : Number(strikeMax);
    const dteCap = maxDte === "" ? null : Number(maxDte);

    const rows = orders.filter((o) => {
      if (tkr && !(o.underlying ?? "").toUpperCase().includes(tkr)) return false;
      if (side !== "all" && o.side !== side) return false;
      if (optType !== "all" && o.type !== optType) return false;
      if (otmOnly && !o.isOtm) return false;
      if (Number(o.premium || 0) < minPremium) return false;
      if (Number(o.size || 0) < minSize) return false;
      if (sMin != null && o.strike < sMin) return false;
      if (sMax != null && o.strike > sMax) return false;
      if (expiry !== "all" && o.expiration !== expiry) return false;
      if (dteCap != null) {
        const d = dteOf(o);
        if (d == null || d > dteCap) return false;
      }
      return true;
    });
    return rows.reverse();
  }, [orders, ticker, side, optType, otmOnly, minPremium, minSize, strikeMin, strikeMax, expiry, maxDte]);

  // ── Summary of the filtered set. ──
  const totals = useMemo(() => {
    let prem = 0, callPrem = 0, putPrem = 0;
    for (const o of filtered) {
      prem += o.premium || 0;
      if (o.type === "C") callPrem += o.premium || 0; else putPrem += o.premium || 0;
    }
    return { count: filtered.length, prem, callPrem, putPrem };
  }, [filtered]);

  function resetFilters() {
    setTicker(""); setSide("all"); setOptType("all"); setMinPremium(0);
    setMinSize(0); setStrikeMin(""); setStrikeMax(""); setExpiry("all");
    setMaxDte(""); setOtmOnly(false);
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
    color: C.green, marginBottom: 4, display: "block",
  };
  const fieldStyle: React.CSSProperties = { ...homeInputStyle, width: "100%" };
  const segWrapStyle: React.CSSProperties = {
    display: "flex", border: `1px solid ${C.border}`, borderRadius: 6,
    background: "rgba(0,0,0,0.4)", overflow: "hidden",
  };
  function segBtn(active: boolean): React.CSSProperties {
    return {
      flex: 1, padding: "8px 6px", fontSize: 11, fontWeight: 700, cursor: "pointer",
      textTransform: "uppercase", letterSpacing: "0.06em", border: "none",
      background: active ? C.cyan : "transparent",
      color: active ? C.bg : C.muted,
    };
  }

  const GRID = "70px 56px 1fr 90px 90px 80px 90px 70px";

  return (
    <PageShell>
      {/* ── Filters ─────────────────────────────────────────────────── */}
      <Card accent="cyan" title="Options Flow — Filters" subtitle="Live order flow off the /ws/gex feed.">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 14,
          }}
        >
          <div>
            <label style={labelStyle}>Ticker</label>
            <input
              style={fieldStyle}
              placeholder="e.g. SPX"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
            />
          </div>

          <div>
            <label style={labelStyle}>Side</label>
            <div style={segWrapStyle}>
              {(["all", "buy", "sell"] as SideFilter[]).map((s) => (
                <button key={s} style={segBtn(side === s)} onClick={() => setSide(s)}>{s}</button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Type</label>
            <div style={segWrapStyle}>
              {([["all", "All"], ["C", "Call"], ["P", "Put"]] as [TypeFilter, string][]).map(([v, lbl]) => (
                <button key={v} style={segBtn(optType === v)} onClick={() => setOptType(v)}>{lbl}</button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Min Premium</label>
            <select style={fieldStyle} value={String(minPremium)} onChange={(e) => setMinPremium(Number(e.target.value))}>
              {PREMIUM_PRESETS.map((p) => (
                <option key={p} value={p}>{p === 0 ? "Any" : fmtPremium(p)}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Min Size</label>
            <input
              style={fieldStyle}
              type="number"
              min={0}
              placeholder="contracts"
              value={minSize || ""}
              onChange={(e) => setMinSize(Number(e.target.value) || 0)}
            />
          </div>

          <div>
            <label style={labelStyle}>Strike Min</label>
            <input style={fieldStyle} type="number" placeholder="—" value={strikeMin} onChange={(e) => setStrikeMin(e.target.value)} />
          </div>

          <div>
            <label style={labelStyle}>Strike Max</label>
            <input style={fieldStyle} type="number" placeholder="—" value={strikeMax} onChange={(e) => setStrikeMax(e.target.value)} />
          </div>

          <div>
            <label style={labelStyle}>Expiry</label>
            <select style={fieldStyle} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              <option value="all">All</option>
              {expiryOptions.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Max DTE</label>
            <input style={fieldStyle} type="number" min={0} placeholder="days" value={maxDte} onChange={(e) => setMaxDte(e.target.value)} />
          </div>

          <div>
            <label style={labelStyle}>Moneyness</label>
            <div style={segWrapStyle}>
              <button style={segBtn(!otmOnly)} onClick={() => setOtmOnly(false)}>All</button>
              <button style={segBtn(otmOnly)} onClick={() => setOtmOnly(true)}>OTM</button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              onClick={resetFilters}
              style={{
                width: "100%", padding: "8px 6px", fontSize: 11, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                border: `1px solid ${C.border}`, borderRadius: 6,
                background: "rgba(255,255,255,0.04)", color: C.text,
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </Card>

      {/* ── Tape ────────────────────────────────────────────────────── */}
      <Card accent="purple" padding={0} style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* header row: summary + status */}
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 12, padding: "14px 20px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 22, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text }}>
              Flow Tape
            </span>
            <span style={{ fontSize: 12, color: C.muted }}>
              <strong style={{ color: C.text }}>{totals.count.toLocaleString()}</strong> orders
            </span>
            <span style={{ fontSize: 12, color: C.muted }}>
              Total <strong style={{ color: C.text }}>{fmtPremium(totals.prem)}</strong>
            </span>
            <span style={{ fontSize: 12, color: C.muted }}>
              Calls <strong style={{ color: BULLISH }}>{fmtPremium(totals.callPrem)}</strong>
            </span>
            <span style={{ fontSize: 12, color: C.muted }}>
              Puts <strong style={{ color: BEARISH }}>{fmtPremium(totals.putPrem)}</strong>
            </span>
          </div>
          <span
            style={{
              fontSize: 11, fontFamily: "monospace", padding: "2px 10px", borderRadius: 4,
              background: status === "LIVE" ? "rgba(142,202,230,0.12)" : "rgba(239,68,68,0.12)",
              color: status === "LIVE" ? C.cyan : C.red,
            }}
          >
            {status}
          </span>
        </div>

        {/* column heads */}
        <div
          style={{
            display: "grid", gridTemplateColumns: GRID, gap: 8,
            padding: "8px 20px", borderBottom: `1px solid ${C.border}`,
            fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
            color: C.muted, flexShrink: 0,
          }}
        >
          <span>Time</span>
          <span>Side</span>
          <span>Underlying</span>
          <span style={{ textAlign: "right" }}>Strike</span>
          <span style={{ textAlign: "center" }}>Type</span>
          <span style={{ textAlign: "right" }}>Size</span>
          <span style={{ textAlign: "right" }}>Premium</span>
          <span style={{ textAlign: "right" }}>Expiry</span>
        </div>

        {/* rows */}
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 360px)" }}>
          {filtered.length === 0 ? (
            <p style={{ fontSize: 13, padding: 24, color: C.muted }}>
              {status === "LIVE" ? "No flow matches the current filters." : "Connecting to feed…"}
            </p>
          ) : (
            filtered.map((o, i) => {
              const col = actionColor(o);
              return (
                <div
                  key={`${o.ts}-${o.symbol}-${i}`}
                  style={{
                    display: "grid", gridTemplateColumns: GRID, gap: 8,
                    padding: "6px 20px", borderBottom: `1px solid ${C.border}`,
                    fontSize: 12, fontFamily: "monospace", alignItems: "center",
                  }}
                >
                  <span style={{ color: C.muted }}>{fmtTime(o.ts)}</span>
                  <span style={{ color: o.side === "buy" ? BULLISH : BEARISH, fontWeight: 700 }}>
                    {o.side.toUpperCase()}
                  </span>
                  <span style={{ color: C.text }}>{o.underlying ?? "—"}</span>
                  <span style={{ textAlign: "right", color: C.text }}>{o.strike.toLocaleString()}</span>
                  <span style={{ textAlign: "center", color: col, fontWeight: 700 }}>{o.type}</span>
                  <span style={{ textAlign: "right", color: C.text }}>{o.size.toLocaleString()}</span>
                  <span style={{ textAlign: "right", color: col, fontWeight: 700 }}>{fmtPremium(o.premium)}</span>
                  <span style={{ textAlign: "right", color: C.muted }}>{o.expiration ?? "—"}</span>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </PageShell>
  );
}
