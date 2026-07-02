"use client";

// ─────────────────────────────────────────────────────────────────────────────
// /flow — per-ticker Net Premium (Net Drift) view + raw flow tape.
//
// Fed by the server `flow` WS message on /ws/gex (same feed as FlowTape /
// SignalsPanel): each message carries the full capped tape (oldest-first) as
// data.tape: FlowOrder[]. Connection is gated by useWsLifecycle (bandwidth /
// idle / background pause) exactly like the home page. Today's persisted tape is
// backfilled once from /proxy/flow-history and merged with the live tape.
//
// Layout: Filters (watchlist chips + add, side/type/premium slider/size/expiry/
// moneyness) → Net Premium chart (cumulative net call vs net put premium for the
// ACTIVE ticker, lightweight-charts) → raw Flow Tape (active ticker, threshold).
//
// Theme: PageShell + Card + HOME_THEME only. No raw color literals beyond the
// green buy accent (HOME_THEME.green is a light blue, so buys use a true green).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, LineSeries, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi, UTCTimestamp, LineData } from "lightweight-charts";
import { HOME_THEME, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import type { FlowOrder } from "@/hooks/useSpxFlow";

const C = HOME_THEME;
const BUY_GREEN = "#22c55e";
const BULLISH = BUY_GREEN; // calls / buys
const BEARISH = C.red; //     puts / sells

function fmtPremium(val: number): string {
  const a = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

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

// ── Filter state ────────────────────────────────────────────────────────────
type SideFilter = "all" | "buy" | "sell";
type TypeFilter = "all" | "C" | "P";

const PREMIUM_MAX = 1_000_000;

const DEFAULT_TICKERS = [
  "SPX", "SPY", "QQQ", "META", "TSLA", "AMZN", "AAPL", "NVDA", "MSFT", "GOOGL", "AMD", "NDX",
] as const;

export default function FlowPage() {
  const shouldConnect = useWsLifecycle();
  const [orders, setOrders] = useState<FlowOrder[]>([]);
  const [status, setStatus] = useState<"LIVE" | "RECONNECTING" | "WAITING">("WAITING");

  // ── Watchlist + active (chart-focused) ticker ──
  const [tickerList, setTickerList] = useState<string[]>([...DEFAULT_TICKERS]);
  const [active, setActive] = useState<string>(DEFAULT_TICKERS[0]);
  const [tickerInput, setTickerInput] = useState("");

  // ── Other filters ──
  const [side, setSide] = useState<SideFilter>("all");
  const [optType, setOptType] = useState<TypeFilter>("all");
  const [minPremium, setMinPremium] = useState<number>(50_000);
  const [minSize, setMinSize] = useState<number>(0);
  const [expiry, setExpiry] = useState<string>("all");
  const [dteMin, setDteMin] = useState<number>(0);
  const [dteMax, setDteMax] = useState<number | null>(null);
  const [otmOnly, setOtmOnly] = useState(false);

  const [history, setHistory] = useState<FlowOrder[]>([]);

  // ── Backfill today's persisted flow once on mount. ──
  useEffect(() => {
    let cancelled = false;
    fetch("/proxy/flow-history")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j || !Array.isArray(j.tape)) return;
        setHistory(j.tape as FlowOrder[]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── WS: /ws/gex, keep only the flow tape. ──
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

  // ── Merge persisted ∪ live tape, deduped by coalescing key (live wins). ──
  const merged = useMemo(() => {
    const byKey = new Map<string, FlowOrder>();
    for (const o of history) byKey.set(`${o.ts}|${o.symbol}|${o.side}`, o);
    for (const o of orders) byKey.set(`${o.ts}|${o.symbol}|${o.side}`, o);
    return [...byKey.values()].sort((a, b) => a.ts - b.ts);
  }, [history, orders]);

  const expiryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of merged) if (o.underlying && normTicker(o.underlying) === active && o.expiration) set.add(o.expiration);
    return [...set].sort();
  }, [merged, active]);

  // ── Rows for the ACTIVE ticker only, with all filters (newest-first). ──
  const filtered = useMemo(() => {
    const rows = merged.filter((o) => {
      if (normTicker(o.underlying) !== active) return false;
      if (side !== "all" && o.side !== side) return false;
      if (optType !== "all" && o.type !== optType) return false;
      if (otmOnly && !o.isOtm) return false;
      if (Number(o.premium || 0) < minPremium) return false;
      if (Number(o.size || 0) < minSize) return false;
      if (expiry !== "all" && o.expiration !== expiry) return false;
      if (dteMin > 0 || dteMax != null) {
        const d = dteOf(o);
        if (d == null) return false;
        if (d < dteMin) return false;
        if (dteMax != null && d > dteMax) return false;
      }
      return true;
    });
    return rows.reverse();
  }, [merged, active, side, optType, otmOnly, minPremium, minSize, expiry, dteMin, dteMax]);

  // ── Net Premium (Net Drift) series for the active ticker. ──
  // Cumulative signed premium: buy = +, sell = −. One point per second (last
  // cumulative value in that second) to satisfy lightweight-charts' unique/
  // ascending time requirement. Filters (side/type excluded so the chart always
  // shows both sides) — but premium/size/expiry/dte/otm DO apply for consistency
  // with the tape's "what am I looking at" framing.
  const netSeries = useMemo(() => {
    const bySec = new Map<number, { call: number; put: number }>();
    let call = 0, put = 0;
    for (const o of merged) {
      if (normTicker(o.underlying) !== active) continue;
      if (otmOnly && !o.isOtm) continue;
      if (Number(o.size || 0) < minSize) continue;
      if (expiry !== "all" && o.expiration !== expiry) continue;
      if (dteMin > 0 || dteMax != null) {
        const d = dteOf(o);
        if (d == null) continue;
        if (d < dteMin) continue;
        if (dteMax != null && d > dteMax) continue;
      }
      const signed = (o.side === "buy" ? 1 : -1) * (o.premium || 0);
      if (o.type === "C") call += signed; else put += signed;
      bySec.set(Math.floor(o.ts / 1000), { call, put });
    }
    const secs = [...bySec.keys()].sort((a, b) => a - b);
    const callPts: LineData[] = secs.map((s) => ({ time: s as UTCTimestamp, value: bySec.get(s)!.call }));
    const putPts: LineData[] = secs.map((s) => ({ time: s as UTCTimestamp, value: bySec.get(s)!.put }));
    const lastCall = callPts.length ? callPts[callPts.length - 1].value : 0;
    const lastPut = putPts.length ? putPts[putPts.length - 1].value : 0;
    return { callPts, putPts, lastCall, lastPut };
  }, [merged, active, otmOnly, minSize, expiry, dteMin, dteMax]);

  // ── lightweight-charts setup ──
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const callSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const putSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    const host = chartHostRef.current;
    if (!host) return;
    host.innerHTML = "";
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(255,255,255,.70)",
        fontFamily: "Inter, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,.05)" },
        horzLines: { color: "rgba(255,255,255,.05)" },
      },
      rightPriceScale: { visible: true, borderColor: "rgba(255,255,255,.10)" },
      leftPriceScale: { visible: false },
      timeScale: { borderColor: "rgba(255,255,255,.10)", timeVisible: true, secondsVisible: false },
      localization: {
        priceFormatter: (p: number) => fmtPremium(p),
        timeFormatter: (time: unknown) =>
          typeof time === "number"
            ? new Date(time * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })
            : "",
      },
    });
    const callSeries = chart.addSeries(LineSeries, { color: BULLISH, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    const putSeries = chart.addSeries(LineSeries, { color: BEARISH, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    chartRef.current = chart;
    callSeriesRef.current = callSeries;
    putSeriesRef.current = putSeries;
    return () => { chart.remove(); chartRef.current = null; callSeriesRef.current = null; putSeriesRef.current = null; };
  }, []);

  // Push data whenever the active-ticker series changes.
  useEffect(() => {
    callSeriesRef.current?.setData(netSeries.callPts);
    putSeriesRef.current?.setData(netSeries.putPts);
    if (netSeries.callPts.length) chartRef.current?.timeScale().fitContent();
  }, [netSeries]);

  // ── Summary of the filtered tape. ──
  const totals = useMemo(() => {
    let prem = 0, callPrem = 0, putPrem = 0;
    for (const o of filtered) {
      prem += o.premium || 0;
      if (o.type === "C") callPrem += o.premium || 0; else putPrem += o.premium || 0;
    }
    return { count: filtered.length, prem, callPrem, putPrem };
  }, [filtered]);

  // Net premium split (macro call/put positioning) from the drift lines.
  const split = useMemo(() => {
    const c = Math.abs(netSeries.lastCall), p = Math.abs(netSeries.lastPut);
    const tot = c + p || 1;
    return { callPct: (c / tot) * 100, putPct: (p / tot) * 100 };
  }, [netSeries]);

  function resetFilters() {
    setSide("all"); setOptType("all"); setMinPremium(50_000); setMinSize(0);
    setExpiry("all"); setDteMin(0); setDteMax(null); setOtmOnly(false);
  }

  function addTicker() {
    const t = tickerInput.trim().toUpperCase();
    if (!t) return;
    setTickerList((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setActive(t);
    setTickerInput("");
  }

  // ── Styles ──
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
    color: C.green, marginBottom: 4, display: "block",
  };
  const fieldStyle: React.CSSProperties = { ...homeInputStyle, width: "100%" };
  const segWrapStyle: React.CSSProperties = {
    display: "flex", border: `1px solid ${C.border}`, borderRadius: 6, background: "rgba(0,0,0,0.4)", overflow: "hidden",
  };
  function segBtn(activeState: boolean): React.CSSProperties {
    return {
      flex: 1, padding: "8px 6px", fontSize: 11, fontWeight: 700, cursor: "pointer",
      textTransform: "uppercase", letterSpacing: "0.06em", border: "none",
      background: activeState ? C.cyan : "transparent", color: activeState ? C.bg : C.muted,
    };
  }

  const GRID = "78px 56px 90px 80px 90px 100px 90px";

  return (
    <PageShell className="no-card-lift">
      {/* ── Filters ─────────────────────────────────────────────────── */}
      <Card accent="cyan" title="Options Flow — Filters" subtitle="Live order flow off the /ws/gex feed. Pick a watched ticker to drive the chart + tape.">
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Watchlist ({tickerList.length})</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {tickerList.map((t) => {
              const on = t === active;
              return (
                <button
                  key={t}
                  className="flow-chip"
                  onClick={() => setActive(t)}
                  style={{
                    padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer",
                    letterSpacing: "0.04em", borderRadius: 6,
                    border: `1px solid ${on ? C.cyan : C.border}`,
                    background: on ? C.cyan : "rgba(0,0,0,0.4)",
                    color: on ? C.bg : C.text,
                  }}
                >
                  {t}
                </button>
              );
            })}
            <input
              style={{ ...homeInputStyle, width: 120 }}
              placeholder="+ add ticker"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addTicker(); }}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
          <div>
            <label style={labelStyle}>Side</label>
            <div style={segWrapStyle}>
              {(["all", "buy", "sell"] as SideFilter[]).map((s) => (
                <button key={s} className="flow-chip" style={segBtn(side === s)} onClick={() => setSide(s)}>{s}</button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Type</label>
            <div style={segWrapStyle}>
              {([["all", "All"], ["C", "Call"], ["P", "Put"]] as [TypeFilter, string][]).map(([v, lbl]) => (
                <button key={v} className="flow-chip" style={segBtn(optType === v)} onClick={() => setOptType(v)}>{lbl}</button>
              ))}
            </div>
          </div>

          <div style={{ gridColumn: "span 2" }}>
            <label style={labelStyle}>Min Premium <span style={{ color: C.cyan }}>{minPremium === 0 ? "Any" : fmtPremium(minPremium)}</span></label>
            <input
              style={{ width: "100%", accentColor: C.cyan }}
              type="range" min={0} max={PREMIUM_MAX} step={10_000}
              value={minPremium}
              onChange={(e) => setMinPremium(Number(e.target.value))}
            />
          </div>

          <div>
            <label style={labelStyle}>Min Size</label>
            <input style={fieldStyle} type="number" min={0} placeholder="contracts" value={minSize || ""} onChange={(e) => setMinSize(Number(e.target.value) || 0)} />
          </div>

          <div>
            <label style={labelStyle}>Expiry</label>
            <select style={fieldStyle} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              <option value="all">All</option>
              {expiryOptions.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Min DTE</label>
            <input style={fieldStyle} type="number" min={0} placeholder="days" value={dteMin || ""} onChange={(e) => setDteMin(Number(e.target.value) || 0)} />
          </div>

          <div>
            <label style={labelStyle}>Max DTE</label>
            <input style={fieldStyle} type="number" min={0} placeholder="days" value={dteMax ?? ""} onChange={(e) => setDteMax(e.target.value === "" ? null : Number(e.target.value))} />
          </div>

          <div>
            <label style={labelStyle}>Moneyness</label>
            <div style={segWrapStyle}>
              <button className="flow-chip" style={segBtn(!otmOnly)} onClick={() => setOtmOnly(false)}>All</button>
              <button className="flow-chip" style={segBtn(otmOnly)} onClick={() => setOtmOnly(true)}>OTM</button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              className="flow-chip"
              onClick={resetFilters}
              style={{
                width: "100%", padding: "8px 6px", fontSize: 11, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                border: `1px solid ${C.border}`, borderRadius: 6, background: "rgba(255,255,255,0.04)", color: C.text,
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </Card>

      {/* ── Net Premium chart ───────────────────────────────────────── */}
      <Card accent="orange" padding={0}>
        <div style={{ padding: "16px 20px 8px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.02em" }}>
            Net Drift (Premium) — <span style={{ color: C.cyan }}>{active}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 26, justifyContent: "center", padding: "0 12px 10px", fontSize: 13, fontWeight: 700, flexWrap: "wrap" }}>
          <span style={{ color: BULLISH }}>● Calls {fmtPremium(netSeries.lastCall)}</span>
          <span style={{ color: BEARISH }}>● Puts {fmtPremium(netSeries.lastPut)}</span>
          <span style={{ color: C.muted }}>Net {fmtPremium(netSeries.lastCall + netSeries.lastPut)}</span>
        </div>
        <div ref={chartHostRef} style={{ height: 340, width: "100%" }} />
        {netSeries.callPts.length === 0 && (
          <p style={{ fontSize: 13, padding: "0 20px 12px", color: C.muted, textAlign: "center" }}>
            {status === "LIVE" ? `No ${active} flow yet for the current filters.` : "Connecting to feed…"}
          </p>
        )}
        {/* Net premium split bar (macro call/put positioning) */}
        <div style={{ padding: "6px 20px 20px" }}>
          <label style={labelStyle}>Net Premium Split (Calls vs Puts)</label>
          <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}`, fontSize: 11, fontWeight: 800 }}>
            <div style={{ width: `${split.callPct}%`, background: BULLISH, color: C.bg, display: "flex", alignItems: "center", padding: "0 8px", whiteSpace: "nowrap" }}>
              C {fmtPremium(Math.abs(netSeries.lastCall))}
            </div>
            <div style={{ width: `${split.putPct}%`, background: BEARISH, color: "#fff", display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 8px", whiteSpace: "nowrap" }}>
              {fmtPremium(Math.abs(netSeries.lastPut))} P
            </div>
          </div>
        </div>
      </Card>

      {/* ── Tape ────────────────────────────────────────────────────── */}
      <Card accent="purple" padding={0} style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 20px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 22, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text }}>Flow Tape — {active}</span>
            <span style={{ fontSize: 12, color: C.muted }}><strong style={{ color: C.text }}>{totals.count.toLocaleString()}</strong> orders</span>
            <span style={{ fontSize: 12, color: C.muted }}>Total <strong style={{ color: C.text }}>{fmtPremium(totals.prem)}</strong></span>
            <span style={{ fontSize: 12, color: C.muted }}>Calls <strong style={{ color: BULLISH }}>{fmtPremium(totals.callPrem)}</strong></span>
            <span style={{ fontSize: 12, color: C.muted }}>Puts <strong style={{ color: BEARISH }}>{fmtPremium(totals.putPrem)}</strong></span>
          </div>
          <span style={{ fontSize: 11, fontFamily: "monospace", padding: "2px 10px", borderRadius: 4, background: status === "LIVE" ? "rgba(142,202,230,0.12)" : "rgba(239,68,68,0.12)", color: status === "LIVE" ? C.cyan : C.red }}>
            {status}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, padding: "8px 20px", borderBottom: `1px solid ${C.border}`, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted, flexShrink: 0 }}>
          <span>Time</span>
          <span>Side</span>
          <span style={{ textAlign: "right" }}>Strike</span>
          <span style={{ textAlign: "center" }}>Type</span>
          <span style={{ textAlign: "right" }}>Size</span>
          <span style={{ textAlign: "right" }}>Premium</span>
          <span style={{ textAlign: "right" }}>Expiry</span>
        </div>

        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 360px)" }}>
          {filtered.length === 0 ? (
            <p style={{ fontSize: 13, padding: 24, color: C.muted }}>
              {status === "LIVE" ? `No ${active} flow matches the current filters.` : "Connecting to feed…"}
            </p>
          ) : (
            filtered.map((o, i) => {
              const sideColor = o.side === "buy" ? BULLISH : BEARISH;
              return (
                <div key={`${o.ts}-${o.symbol}-${i}`} style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, padding: "8px 20px", borderBottom: `1px solid ${C.border}`, fontSize: 15, fontFamily: "monospace", alignItems: "center" }}>
                  <span style={{ color: C.muted }}>{fmtTime(o.ts)}</span>
                  <span style={{ color: sideColor, fontWeight: 700 }}>{o.side.toUpperCase()}</span>
                  <span style={{ textAlign: "right", color: C.text }}>{o.strike.toLocaleString()}</span>
                  <span style={{ textAlign: "center", color: sideColor, fontWeight: 700 }}>{o.type}</span>
                  <span style={{ textAlign: "right", color: C.text }} title={o.fills && o.fills > 1 ? `${o.fills} fills aggregated` : undefined}>
                    {o.size.toLocaleString()}
                    {o.fills && o.fills > 1 ? <span style={{ color: C.muted, fontSize: 11 }}> ×{o.fills}</span> : null}
                  </span>
                  <span style={{ textAlign: "right", color: sideColor, fontWeight: 700 }}>{fmtPremium(o.premium)}</span>
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
